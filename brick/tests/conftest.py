"""One SparkSession for the whole brick suite, with Delta enabled, and one register to read.

There used to be an identical ``spark`` fixture in each test module. That worked while nothing
needed Delta, and stopped working the moment the ledger tests did, for a reason worth writing
down: **Delta's SQL extensions can only be installed when a session is built, and its JARs can
only be added when the JVM is launched.** ``SparkSession.builder.getOrCreate()`` returns whatever
session already exists, so whichever test module happened to run first decided whether the entire
suite could use Delta -- and alphabetical ordering is not a design.

So the session is built once, here, before any module asks for one. ``PYSPARK_SUBMIT_ARGS`` is set
at import time because by the time a fixture body runs it may already be too late.

``live_tables`` is here for the same reason: it is real pipeline output, every panel and notebook
test wants it, and building it twice would double the slowest thing the suite does. It used to
live in ``test_dashboard.py``, which no longer exists.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

BRICK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BRICK_DIR.parent
sys.path.insert(0, str(BRICK_DIR))

DELTA_PACKAGE = "io.delta:delta-spark_2.12:3.2.0"

# Spark's 1g default is not enough for this suite. In local mode the driver JVM is also the
# executor, so one heap carries the metastore, the Delta log state of every table the run has
# created, and the aggregation buffers -- and the gold frames are wide: the confusion matrix,
# seven more of it for rule sensitivity, and capacity over two populations, all unioned before
# a single write. `test_rebuild_reproduces_the_live_ledger` replays every bronze scan through
# that, and was dying on "SparkOutOfMemoryError: No enough memory for aggregation".
#
# Like --packages, this can only be set before the JVM starts: spark.driver.memory is read by
# spark-submit at launch and setting it on the builder afterwards is silently ignored.
DRIVER_MEMORY = "4g"

# Must happen at import, before anything can launch the JVM: --packages is read by spark-submit
# when the JVM starts, and jars cannot be added to one that is already running.
os.environ.setdefault(
    "PYSPARK_SUBMIT_ARGS",
    f"--packages {DELTA_PACKAGE} --driver-memory {DRIVER_MEMORY} pyspark-shell",
)


@pytest.fixture(scope="session")
def spark(tmp_path_factory):
    """The shared session. Delta-enabled, UTC, single-partition for deterministic tests."""
    pytest.importorskip(
        "pyspark", reason="brick tests need pyspark: pip install -r brick/requirements.txt"
    )
    from pyspark.sql import SparkSession

    # Warehouse and metastore go to a temp directory, not the working tree. Spark defaults both
    # to ./spark-warehouse and ./metastore_db, which means a run that is interrupted leaves
    # table directories behind that the next run's fresh metastore knows nothing about --
    # DROP DATABASE cannot clean what it cannot see, and creating the table then fails with
    # DELTA_CREATE_TABLE_WITH_NON_EMPTY_LOCATION. Isolating per run makes that impossible
    # rather than merely unlikely, and keeps test debris out of the repo entirely.
    root = tmp_path_factory.mktemp("spark")
    builder = (
        SparkSession.builder.master("local[1]")
        .appName("brick-tests")
        .config("spark.sql.warehouse.dir", str(root / "warehouse"))
        .config(
            "javax.jdo.option.ConnectionURL",
            f"jdbc:derby:;databaseName={root / 'metastore_db'};create=true",
        )
        # Capacity buckets by UTC calendar month and MTTR is a UTC-to-UTC difference, exactly
        # as the pipeline sets it -- a session on local time would shift findings between
        # months and make the fixtures disagree with production for no visible reason.
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.ui.enabled", "false")
        .config("spark.sql.shuffle.partitions", "1")
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config(
            "spark.sql.catalog.spark_catalog",
            "org.apache.spark.sql.delta.catalog.DeltaCatalog",
        )
    )
    try:
        from delta import configure_spark_with_delta_pip

        session = configure_spark_with_delta_pip(builder).getOrCreate()
    except ImportError:
        # delta-spark absent: the pure-transform tests still run, and the ones that genuinely
        # need a Delta table skip themselves.
        session = builder.getOrCreate()
    yield session
    session.stop()


LIVE_SCHEMA = "dash"
LIVE_SCOPE = "os"
LIVE_SEVERITIES = ["CRITICAL", "HIGH"]


@pytest.fixture(scope="session")
def live_tables(spark):
    """Two real scans of the committed Wiz response, driven through the real pipeline.

    Driven through ``run_pipeline.build_metrics`` rather than by calling the metric transforms
    directly. An earlier version did the latter, which quietly made every consumer a test of a
    *second* implementation: a panel could pass here and still reference a column production
    never writes.

    Two scans, not one, and the second is truncated to the first half of the register -- so the
    tail resolves by *disappearance* and ``resolution_src`` / ``resolved_disappeared`` carry real
    numbers rather than being trivially empty. That is the v2 behaviour most likely to be wrong,
    so it is the one the fixture guarantees is exercised.

    Session-scoped and idempotent: it drops the database before creating it (a run interrupted
    halfway leaves tables the next fresh metastore cannot see) and again on the way out, and
    because it is built once no second module can re-drop it underneath a running test.
    """
    pytest.importorskip("delta", reason="live_tables needs delta-spark for the ledger tables")
    from pyspark.sql import functions as F

    import run_pipeline
    from ingest import extract_nodes

    nodes = extract_nodes(json.loads((REPO_ROOT / "os_vulns_response_exemple.json").read_text()))
    spark.sql(f"DROP DATABASE IF EXISTS {LIVE_SCHEMA} CASCADE")
    spark.sql(f"CREATE DATABASE {LIVE_SCHEMA}")
    tables = run_pipeline.resolve_tables(LIVE_SCHEMA, LIVE_SCOPE, argv=[])
    run_pipeline.ensure_tables(spark, tables)

    def scan(scan_id, scan_ts, payload):
        rows = [(scan_id, scan_ts, LIVE_SCOPE, i, json.dumps(n)) for i, n in enumerate(payload)]
        spark.createDataFrame(
            rows, "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"
        ).withColumn("scan_ts", F.col("scan_ts").cast("timestamp")).write.format("delta").mode(
            "append"
        ).option("mergeSchema", "true").saveAsTable(tables.bronze)
        run_pipeline.build_metrics(
            spark, tables, scan_id, scan_ts, LIVE_SCOPE, severities=LIVE_SEVERITIES
        )

    scan("scan-1", "2026-06-01T00:00:00Z", nodes)
    scan("scan-2", "2026-07-01T00:00:00Z", nodes[: max(1, len(nodes) // 2)])

    yield spark, tables
    spark.sql(f"DROP DATABASE IF EXISTS {LIVE_SCHEMA} CASCADE")
