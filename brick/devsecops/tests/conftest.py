"""One SparkSession for the whole devsecops suite, with Delta enabled, and one register to read.

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
#: This fork lives one directory deeper than brick/, so the repo root is one hop further up.
#: Only the GAS golden fixture is read from there -- everything else is beside these tests.
REPO_ROOT = BRICK_DIR.parents[1]
sys.path.insert(0, str(BRICK_DIR))

# 3.3 rather than 3.2, and the reason is `run_pipeline.maintain`. The open-source OPTIMIZE path
# clusters with a Hilbert curve, and 3.2 asserts its way out of a table clustered by a single
# column -- "Cannot do Hilbert clustering by zero or one column!" -- so OPTIMIZE on the ledger
# (CLUSTER BY vuln_key) is unrunnable there. 3.3 fixes it, and runs on the same Spark 3.5.
#
# The alternative was to give every clustered table a second key it does not need, which would
# have let an open-source implementation detail choose the physical layout of the register. The
# cluster's Delta comes from DBR, where single-column CLUSTER BY is the documented shape.
DELTA_PACKAGE = "io.delta:delta-spark_2.12:3.3.2"

# Spark 3.5's own docs claim only Java 8/11/17 -- Java 21 support is advertised starting at
# Spark 4.0. Measured here on OpenJDK 21.0.10: session start, a Delta write/read, and OPTIMIZE
# on a single-column CLUSTER BY table (the exact path this suite depends on, see the comment
# above) all ran clean, no reflective-access stack trace, no added flags. The full suite ran on
# it too -- 568/569 passed (one pre-existing failure in test_csvstore.py, unrelated to the JVM:
# a Delta v2-catalog "does not support truncate in batch mode" error that `import_bundle.py`
# already documents and works around elsewhere; csvstore.py just doesn't use that workaround
# yet). So this fixture does not gate the JVM version -- a guard here would block a setup that
# measurably works. If a future JDK does break this, the fix is JAVA_HOME pointed at a Java
# 8/11/17 install, not a silent hang: Spark on an unsupported JVM fails loudly at session
# construction.

# Spark's 1g default is not enough for this suite. In local mode the driver JVM is also the
# executor, so one heap carries the catalog, the Delta log state of every table the run has
# created, and the aggregation buffers -- and the gold frames are wide: the confusion matrix,
# seven more of it for rule sensitivity, and capacity over two populations. Each is computed
# once and written; `test_rebuild_reproduces_the_live_ledger` replays every bronze scan through
# all of it, and was dying on "SparkOutOfMemoryError: No enough memory for aggregation".
#
# Under xdist the number to size is not the heap but the heaps: a worker is a whole JVM, so
# four of them at 4g want 16g of a machine that may not have it, and the swapping costs more
# than the parallelism gains. `test_ledger_pipeline.py` passes whole at 1500m now that the
# summary is no longer recomputing every gold frame, so 2g has real headroom, and four of
# those fit where one comfortable one did not.
#
# Like --packages, this can only be set before the JVM starts: spark.driver.memory is read by
# spark-submit at launch and setting it on the builder afterwards is silently ignored. xdist
# sets PYTEST_XDIST_WORKER_COUNT in each worker's environment before conftest is imported, so
# it is readable here.
DRIVER_MEMORY = "4g" if int(os.environ.get("PYTEST_XDIST_WORKER_COUNT", "1")) == 1 else "2g"

# Must happen at import, before anything can launch the JVM: --packages is read by spark-submit
# when the JVM starts, and jars cannot be added to one that is already running.
os.environ.setdefault(
    "PYSPARK_SUBMIT_ARGS",
    f"--packages {DELTA_PACKAGE} --driver-memory {DRIVER_MEMORY} pyspark-shell",
)

# Spark resolves the driver's address by looking the machine's hostname up, and in a container
# with no matching entry in /etc/hosts that lookup can stall before failing over to the
# loopback address it was always going to use. Naming it outright skips the wait. Also read at
# JVM start, hence the placement.
os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")


@pytest.fixture(scope="session")
def spark(tmp_path_factory):
    """The shared session. Delta-enabled, UTC, single-partition for deterministic tests."""
    pytest.importorskip(
        "pyspark", reason="brick tests need pyspark: pip install -r brick/requirements.txt"
    )
    from pyspark.sql import SparkSession

    # The warehouse goes to a temp directory, not the working tree. Spark defaults it to
    # ./spark-warehouse, which means a run that is interrupted leaves table directories behind
    # that the next run's fresh catalog knows nothing about -- DROP DATABASE cannot clean what
    # it cannot see, and creating the table then fails with
    # DELTA_CREATE_TABLE_WITH_NON_EMPTY_LOCATION. Isolating per run makes that impossible
    # rather than merely unlikely, and keeps test debris out of the repo entirely.
    #
    # There is no metastore to isolate alongside it. Nothing here calls enableHiveSupport(), so
    # `spark.sql.catalogImplementation` is `in-memory` and the catalog lives and dies with the
    # session -- a run leaves no metastore_db and no derby.log behind. (This used to also set
    # `javax.jdo.option.ConnectionURL` at a temp Derby database. It was never read.)
    root = tmp_path_factory.mktemp("spark")
    builder = (
        SparkSession.builder.master("local[1]")
        .appName("brick-tests")
        .config("spark.sql.warehouse.dir", str(root / "warehouse"))
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
        # ---------------------------------------------------------------- test-only economics
        # None of these change a result. Every one of them is about the fact that this suite
        # runs thousands of queries over a few dozen rows each, so its cost is planning,
        # scheduling and bookkeeping rather than data.
        #
        # AQE re-plans a query between stages using runtime statistics. That is worth real
        # money on a cluster and is pure overhead on frames this small, where there is nothing
        # to learn and one partition to learn it about.
        .config("spark.sql.adaptive.enabled", "false")
        .config("spark.default.parallelism", "1")
        .config("spark.rdd.compress", "false")
        .config("spark.databricks.delta.snapshotPartitions", "1")
        # The UI is off, but the listeners behind it are not: Spark still accumulates a job,
        # stage and SQL-execution history in the driver heap for a web page nobody will load.
        # Over a suite this long that is a steadily growing structure and the GC that comes
        # with it.
        .config("spark.ui.showConsoleProgress", "false")
        .config("spark.ui.retainedJobs", "1")
        .config("spark.ui.retainedStages", "1")
        .config("spark.ui.retainedTasks", "1")
        .config("spark.sql.ui.retainedExecutions", "1")
    )
    # `configure_spark_with_delta_pip` used to wrap the builder here, in a try/except that
    # tolerated delta-spark being absent. It only sets `spark.jars.packages`, which the two
    # extension configs above already cover explicitly and which is in any case too late to
    # matter -- the jars arrive via --packages when spark-submit launches the JVM, long before
    # a builder config is read. Nothing was lost by dropping it, including the tolerance: the
    # tests that genuinely need Delta still skip themselves, via the `importorskip("delta")`
    # in `live_tables` below and at the top of the modules that write Delta tables.
    session = builder.getOrCreate()
    yield session
    session.stop()


#: The modules that read ``live_tables``, pinned to one xdist worker between them.
LIVE_TABLES_GROUP = frozenset({"test_panels", "test_notebooks"})


def pytest_collection_modifyitems(config, items):
    """Pin the two ``live_tables`` modules to one xdist worker. Leave everything else free.

    Under ``--dist loadgroup`` an item with an ``xdist_group`` marker goes to the worker that
    owns that group, and an item without one is handed out per test. Which of the two a module
    wants is a question about cost, never about correctness: a worker gets its own
    ``SparkSession``, its own in-memory catalog and its own warehouse directory, so splitting a
    module across workers can only rebuild its module-scoped fixtures, never corrupt them.

    So only the expensive case is pinned. ``live_tables`` is two full pipeline runs and is
    session-scoped, which under xdist means *once per worker* -- letting its two readers land
    on different workers would build the whole register twice. Everything else is cheaper to
    rebuild than to serialise, and that includes the two modules that dominate the wall clock:
    ``test_ledger_pipeline`` and ``test_import_bundle`` build a private database per test and
    hold no module-scoped state at all, so their tests spread across every free worker.
    """
    if not config.pluginmanager.hasplugin("xdist"):
        return
    for item in items:
        if item.path.stem in LIVE_TABLES_GROUP:
            item.add_marker(pytest.mark.xdist_group("live_tables"))


LIVE_SCHEMA = "code"
LIVE_SCOPE = "sca"
LIVE_SEVERITIES = ["CRITICAL", "HIGH"]

#: The findings the live register is built from.
#:
#: **Synthetic, and labelled as such where it lives.** The captured `sca_response.json` is the
#: *grouped* query -- one row per repository with severity counts -- so it has no per-finding
#: rows and cannot drive a pipeline. `sca_findings_example.json` is what the ungrouped query
#: returns, synthesised over the repository branches and cloud platforms the real capture does
#: contain. See its header.
LIVE_FIXTURE = "sca_findings_example.json"


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

    nodes = extract_nodes(json.loads((BRICK_DIR / LIVE_FIXTURE).read_text()))
    spark.sql(f"DROP DATABASE IF EXISTS {LIVE_SCHEMA} CASCADE")
    spark.sql(f"CREATE DATABASE {LIVE_SCHEMA}")
    tables = run_pipeline.resolve_tables(LIVE_SCHEMA, LIVE_SCOPE, argv=[])
    run_pipeline.ensure_tables(spark, tables)

    def scan(scan_id, scan_ts, payload):
        # Stands in for `ingest_to_bronze`, so it creates bronze the way that does -- with its
        # clustering spec. `ensure_tables` deliberately does not create bronze; see its docstring.
        run_pipeline.create_clustered(
            spark, tables.bronze, run_pipeline.BRONZE_TABLE_SCHEMA, "bronze"
        )
        rows = [(scan_id, scan_ts, LIVE_SCOPE, i, json.dumps(n)) for i, n in enumerate(payload)]
        spark.createDataFrame(
            rows, "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"
        ).withColumn("scan_ts", F.col("scan_ts").cast("timestamp")).write.format("delta").mode(
            "append"
        ).option("mergeSchema", "true").saveAsTable(tables.bronze)
        run_pipeline.build_metrics(
            spark, tables, scan_id, scan_ts, LIVE_SCOPE,
            severities=LIVE_SEVERITIES, summary=False,
        )

    scan("scan-1", "2026-06-01T00:00:00Z", nodes)
    scan("scan-2", "2026-07-01T00:00:00Z", nodes[: max(1, len(nodes) // 2)])

    yield spark, tables
    spark.sql(f"DROP DATABASE IF EXISTS {LIVE_SCHEMA} CASCADE")
