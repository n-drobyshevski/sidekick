"""Re-register a lake's on-disk Delta tables after a fresh session boots, and pre-create the
clustered table shapes the local ``DeltaTable`` builder cannot.

Spark's in-memory catalog (no ``enableHiveSupport()``, see ``brick/tests/conftest.py``) lives
and dies with the ``SparkSession`` -- so a table that was ``CREATE TABLE``-d under
``spark_catalog.wiz.wiz_os_vuln_ledger`` in one process is, to a fresh process pointed at the
same warehouse directory, just a directory again: the Delta log on disk still has every commit,
but nothing in the new session's catalog knows the name. :func:`reregister` is exactly the
migration recipe ``brick/README.md`` ("Moving it into the lake later") already documents for
moving a register into a *real* catalog -- ``CREATE TABLE ... USING DELTA LOCATION`` -- run here
on every local boot instead of once, because a local session has no catalog that persists any
other way.

**Managed on first boot, external after.** The very first ``ensure_tables``/``create_clustered``
call in a lake creates each table as *managed* (no ``LOCATION`` given -- Spark chooses the path
under the warehouse). Every reregistration after a restart uses ``LOCATION`` explicitly, which
makes the table *external* from that point on. The practical difference: locally, a
``DROP TABLE`` on a reregistered table removes the catalog entry and leaves the Delta directory
on disk untouched -- unlike the managed table it started as, which ``DROP TABLE`` would have
deleted outright. Nothing here relies on either behaviour; it is a caveat for whoever runs
``DROP TABLE`` by hand against a restarted lake.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pyspark.sql import SparkSession

#: The only catalog name that resolves locally -- see ``brick/tests/test_catalog_mode.py``:
#: a *named* catalog (``hive_metastore``, a Unity Catalog name) has no
#: ``spark.sql.catalog.<name>`` plugin registered against a local session and is never reached;
#: only ``spark_catalog``, which the session config points at ``DeltaCatalog``, is real here.
LOCAL_CATALOG = "spark_catalog"


def namespace(schema: str) -> str:
    """``spark_catalog.<schema>`` -- the only three-level namespace root that works locally."""
    return f"{LOCAL_CATALOG}.{schema}"


def table_dirs(lake: "Path | str", schema: str) -> list:
    """Every directory under ``<lake>/<schema>.db/`` that is itself a Delta table.

    Driven by ``listdir``, not by asking any catalog for a table list -- the catalog is exactly
    what a fresh session does not have. ``_delta_log`` is the one thing every Delta table
    directory has and nothing else does, so its presence is the whole test. Spark's own
    warehouse convention is what puts tables here in the first place: a managed table in schema
    ``s`` lands at ``<warehouse>/s.db/<table>``, and ``spark.sql.warehouse.dir`` is set to
    ``lake`` by ``devlake.session.build``.
    """
    schema_dir = Path(lake) / f"{schema}.db"
    if not schema_dir.is_dir():
        return []
    return sorted(
        p for p in schema_dir.iterdir() if p.is_dir() and (p / "_delta_log").is_dir()
    )


def reregister(spark: "SparkSession", lake: "Path | str", schema: str) -> list:
    """Make every on-disk Delta table under ``<lake>/<schema>.db/`` visible again.

    ``CREATE SCHEMA IF NOT EXISTS`` for the schema itself, then one
    ``CREATE TABLE IF NOT EXISTS ... USING DELTA LOCATION '<abs path>'`` per directory
    :func:`table_dirs` finds. ``IF NOT EXISTS`` on both statements is what makes this safe to
    run on every boot, including the first one, when the schema and its tables do not exist yet
    and there is nothing to reregister.

    Returns the fully-qualified names it registered (or confirmed already registered).
    """
    ns = namespace(schema)
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {ns}")
    registered = []
    for table_dir in table_dirs(lake, schema):
        full_name = f"{ns}.{table_dir.name}"
        spark.sql(
            f"CREATE TABLE IF NOT EXISTS {full_name} USING DELTA LOCATION '{table_dir.resolve()}'"
        )
        registered.append(full_name)
    return registered


def _render_ddl(schema) -> str:
    """A ``StructType`` as a ``CREATE TABLE`` column list.

    Copied from ``brick/tests/test_catalog_mode.py::render_ddl`` rather than imported: that
    module lives under ``brick``'s own ``tests/`` directory, on a ``sys.path`` this package must
    not assume is set up, and importing test code from library code would run the guard
    backwards regardless. ``simpleString()`` is ``StructType.toDDL``'s SQL spelling -- Scala-only
    in PySpark 3.5 -- so nested types render correctly with no hand-rolled type-name table to get
    wrong.
    """
    return ", ".join(
        f"{field.name} {field.dataType.simpleString()}" + ("" if field.nullable else " NOT NULL")
        for field in schema.fields
    )


def precreate_clustered(spark: "SparkSession", run_pipeline_module, tables) -> list:
    """Create every clustered table production's ``create_clustered`` cannot, by SQL DDL.

    ``create_clustered`` (the function ``ensure_tables`` and ``build_metrics`` both call) makes
    its table through the Python ``DeltaTable.createIfNotExists(spark).tableName(...)`` builder,
    and that builder parses its argument with Spark's two-part ``TableIdentifier`` grammar --
    ``spark_catalog.wiz.wiz_os_vuln_ledger`` fails ``[PARSE_SYNTAX_ERROR]`` on the second dot, a
    delta-spark-OSS limitation with nothing to do with the catalog or the schema (see
    ``brick/tests/test_catalog_mode.py``,
    ``test_the_delta_builder_is_the_one_thing_that_cannot_parse_a_three_level_name``). This
    function creates the same physical table -- same schema, same ``CLUSTER BY``, same
    ``delta.enableDeletionVectors`` -- through SQL DDL instead, which parses a three-level name
    fine; ``DESCRIBE DETAIL`` on the result is byte-identical to what the builder would have
    produced. Because ``create_clustered`` (and everything that calls it) short-circuits on
    ``table_exists``, pre-creating a table this way before ``main()`` runs makes production code
    run unchanged from there on -- it finds the table already there and never calls the builder.

    Iterates ``run_pipeline_module.CLUSTERING`` -- ``ledger`` and ``bronze`` -- and skips
    whichever already exist, reading each one's declared schema straight off ``brick``
    (``ledger.LEDGER_SCHEMA``, ``run_pipeline.BRONZE_TABLE_SCHEMA``). There is no ``silver`` here
    to skip any more: silver is not a Delta table at all -- it is a projection
    derived from ``bronze`` in memory (``metrics.silver_findings``), so it has no on-disk shape
    to precreate. ``metrics`` (the gold + scan-log table) is unclustered and needs no entry here
    either; it is created the way ``scans`` used to be, as an empty declared frame that gains its
    gold columns through ``mergeSchema`` on first write.

    Returns the table references it created.
    """
    ledger_mod = run_pipeline_module.ledger_mod
    declared_schemas = {
        "ledger": ledger_mod.LEDGER_SCHEMA,
        "bronze": run_pipeline_module.BRONZE_TABLE_SCHEMA,
    }
    created = []
    for attr in run_pipeline_module.CLUSTERING:
        table = getattr(tables, attr)
        if run_pipeline_module.table_exists(spark, table):
            continue
        table_schema = declared_schemas.get(attr)
        if table_schema is None:
            # Every current CLUSTERING entry (ledger, bronze) has a declared schema above; this
            # guards a future clustered table added without one rather than firing today.
            continue
        if isinstance(table_schema, str):
            table_schema = spark.createDataFrame([], table_schema).schema
        cluster_by, deletion_vectors = run_pipeline_module.CLUSTERING[attr]
        spark.sql(
            f"CREATE TABLE IF NOT EXISTS {table} ({_render_ddl(table_schema)}) USING DELTA "
            f"CLUSTER BY ({cluster_by}) TBLPROPERTIES "
            f"(delta.enableDeletionVectors = {'true' if deletion_vectors else 'false'})"
        )
        created.append(table)
    return created
