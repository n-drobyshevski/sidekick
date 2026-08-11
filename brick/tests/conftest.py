"""One SparkSession for the whole brick suite, with Delta enabled.

There used to be an identical ``spark`` fixture in each test module. That worked while nothing
needed Delta, and stopped working the moment the ledger tests did, for a reason worth writing
down: **Delta's SQL extensions can only be installed when a session is built, and its JARs can
only be added when the JVM is launched.** ``SparkSession.builder.getOrCreate()`` returns whatever
session already exists, so whichever test module happened to run first decided whether the entire
suite could use Delta -- and alphabetical ordering is not a design.

So the session is built once, here, before any module asks for one. ``PYSPARK_SUBMIT_ARGS`` is set
at import time because by the time a fixture body runs it may already be too late.
"""

from __future__ import annotations

import os

import pytest

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
