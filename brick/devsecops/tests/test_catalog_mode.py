"""Do three-level ``catalog.schema.table`` names work against a local Spark? Measured here.

The mirror of ``brick/tests/test_catalog_mode.py``, over this fork's ``sca`` register. The
claim under test is the OS fork's README ("Running it locally") and ``panels.tables``'
docstring, which this fork copied verbatim: *"saveAsTable against a three-level
catalog.schema.table name needs Unity Catalog -- a local Spark can only write two-level
names."* Every local test in this suite builds a two-level namespace on the strength of it, so
the catalog-mode path -- the mode this register is meant to be deployed in -- is exercised
nowhere but on a cluster.

That claim is wrong in its subject and wrong in its reason, and one narrower thing in its
neighbourhood is true. What this module pins, all of it measured on this box against
delta-spark 3.3.2 on Spark 3.5.9:

* ``spark_catalog`` **is** a catalog and it is the one the conftest configures -- the
  ``DeltaCatalog`` plugin is installed *as* the session catalog, so ``spark_catalog.<schema>``
  is a real, writable three-level namespace with no Unity Catalog anywhere.
* ``saveAsTable`` takes a three-level name, and so do ``spark.table``,
  ``spark.catalog.tableExists``, ``spark.catalog.databaseExists``, ``CREATE SCHEMA``,
  ``CREATE TABLE ... CLUSTER BY``, ``MERGE INTO``, ``DELETE FROM`` and ``OPTIMIZE``. That is
  every statement the pipeline issues except one.
* The exception is the **Python ``DeltaTable`` API**: ``DeltaTable.createIfNotExists(...)
  .tableName(...)`` and ``DeltaTable.forName(...)`` parse their argument as a two-part
  ``TableIdentifier`` and fail on the second dot with ``[PARSE_SYNTAX_ERROR]``. It is a
  delta-spark-OSS limitation rather than a Spark one and rather than a Unity Catalog one --
  the failing statement is a *parse*, before any catalog has been consulted.
  ``create_clustered`` is the only production function that touches that API, so it is the only
  thing standing between this suite and a three-level register.
* **Not measured here, and not claimed:** whether DBR's Delta parses three parts in that same
  builder. There is no Databricks on this box, and the current deployment cannot answer it
  either -- it runs in ``--data_path`` mode, where ``create_clustered`` is handed a
  ``delta.`<path>``` reference and never sees a catalog name at all.
* A catalog with **no plugin registered** -- ``hive_metastore``, ``preprod_sec``, any name at
  all -- is what actually fails, and it does so in three different voices depending on which
  statement meets it first. None of them says "catalog not found"; the closest is
  ``REQUIRES_SINGLE_PART_NAMESPACE``, which reports the *session* catalog complaining that it
  was handed two namespace parts.

Read together: what a local Spark cannot do is reach a *named* catalog, not write a *three-part
name*.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

pytest.importorskip("delta", reason="catalog mode needs delta-spark for the ledger tables")

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import metrics  # noqa: E402
import run_pipeline  # noqa: E402
from config import rule_for_scope  # noqa: E402
from ingest import extract_nodes  # noqa: E402
from ledger import LEDGER_SCHEMA  # noqa: E402

#: Every test here shares one schema and one register, so they share one xdist worker too.
#: Without this the module-scoped fixtures below would be rebuilt per test, and one of them is
#: two whole pipeline runs.
pytestmark = pytest.mark.xdist_group("catalog_mode")

CATALOG = "spark_catalog"
SCHEMA = "uc_probe"
NAMESPACE = f"{CATALOG}.{SCHEMA}"
SCOPE = "sca"
SEVERITIES = ["CRITICAL", "HIGH"]

#: The same synthetic ungrouped SCA capture ``conftest.live_tables`` reads. See its header for
#: why the grouped ``sca_response.json`` cannot drive a pipeline.
LIVE_FIXTURE = "sca_findings_example.json"

#: Findings in that fixture. Named rather than inlined because the end-to-end assertions below
#: divide it (the second scan is truncated to half).
FIXTURE_FINDINGS = 54

#: A catalog name with no ``spark.sql.catalog.<name>`` plugin behind it. Two of them, because
#: the interesting property is "unregistered", not "called hive_metastore" -- the README's own
#: local-run example passes the first and `resolve_namespace`'s error message recommends it.
UNREGISTERED_CATALOGS = ("hive_metastore", "preprod_sec")


def render_ddl(schema) -> str:
    """A ``StructType`` as a column list. ``StructType.toDDL`` is Scala-only in PySpark 3.5.

    ``simpleString()`` is the SQL spelling of a type -- ``bigint``, ``timestamp``,
    ``array<string>`` -- so nested types render correctly and there is no type-name table here
    to get wrong. ``NOT NULL`` is carried explicitly because the ledger's ``vuln_key`` has it
    and it is what the MERGE key rests on.
    """
    return ", ".join(
        f"{field.name} {field.dataType.simpleString()}" + ("" if field.nullable else " NOT NULL")
        for field in schema.fields
    )


def create_clustered_by_ddl(spark, table: str, schema, attr: str) -> None:
    """``create_clustered``'s table, created through SQL DDL instead of the ``DeltaTable`` builder.

    Same schema, same ``CLUSTERING`` spec, same deletion-vector property -- read from
    ``run_pipeline.CLUSTERING`` rather than restated, so this cannot drift from what production
    creates. It exists only because the builder cannot parse the three-level name (see
    ``test_the_delta_builder_is_the_one_thing_that_cannot_parse_a_three_level_name``); everything
    downstream of it is the real pipeline.
    """
    if run_pipeline.table_exists(spark, table):
        return
    if isinstance(schema, str):
        schema = spark.createDataFrame([], schema).schema
    cluster_by, deletion_vectors = run_pipeline.CLUSTERING[attr]
    spark.sql(
        f"CREATE TABLE IF NOT EXISTS {table} ({render_ddl(schema)}) USING DELTA "
        f"CLUSTER BY ({cluster_by}) TBLPROPERTIES "
        f"(delta.enableDeletionVectors = {'true' if deletion_vectors else 'false'})"
    )


@pytest.fixture(scope="module")
def uc_schema(spark):
    """The three-level namespace, created by the production ``ensure_schema`` and dropped after."""
    spark.sql(f"DROP DATABASE IF EXISTS {NAMESPACE} CASCADE")
    run_pipeline.ensure_schema(spark, NAMESPACE)
    yield NAMESPACE
    spark.sql(f"DROP DATABASE IF EXISTS {NAMESPACE} CASCADE")


# ------------------------------------------------------------------ parameters and the schema


def test_resolve_namespace_joins_the_catalog_to_the_schema():
    assert run_pipeline.resolve_namespace(
        argv=[f"--catalog={CATALOG}", f"--schema={SCHEMA}"]
    ) == NAMESPACE


def test_ensure_schema_creates_a_schema_under_the_session_catalog(spark, uc_schema):
    """And ``databaseExists`` answers for the three-part name rather than falling through.

    Worth pinning separately: ``ensure_schema`` wraps that call in a bare ``except`` whose
    comment says "can't tell; fall through and let CREATE decide". If it were raising here, the
    guard the function exists for -- not asking for CREATE SCHEMA when the schema is already
    there -- would be silently dead on this platform.
    """
    assert spark.catalog.databaseExists(NAMESPACE) is True
    assert SCHEMA in [row.namespace for row in spark.sql(f"SHOW SCHEMAS IN {CATALOG}").collect()]


def test_the_session_catalog_is_the_one_the_conftest_installed(spark):
    """`spark_catalog` is not a name the test invented -- it is Spark's own current catalog."""
    assert spark.catalog.currentCatalog() == CATALOG
    assert (
        spark.conf.get("spark.sql.catalog.spark_catalog")
        == "org.apache.spark.sql.delta.catalog.DeltaCatalog"
    )


def test_resolve_tables_qualifies_every_table_with_the_catalog():
    tables = run_pipeline.resolve_tables(NAMESPACE, SCOPE, argv=[])
    for attr in ("bronze", "silver", "ledger", "scans", "mttr", "program", "capacity",
                 "sensitivity"):
        name = getattr(tables, attr)
        assert name.startswith(f"{NAMESPACE}."), name
        assert name.count(".") == 2, name
    assert tables.ledger == f"{NAMESPACE}.wiz_sca_vuln_ledger"


# ------------------------------------------------------------------------------ the one refusal


def test_the_delta_builder_is_the_one_thing_that_cannot_parse_a_three_level_name(spark, uc_schema):
    """``ensure_tables`` fails, and it fails inside ``DeltaTable``'s name parser.

    This is the whole of the local three-level story. ``create_clustered`` hands the table name
    to ``DeltaTable.createIfNotExists(spark).tableName(...)``, and delta-spark OSS parses it with
    Spark's two-part ``TableIdentifier`` grammar -- so it consumes ``spark_catalog.uc_probe`` and
    then meets a dot it has no rule for. The error is a *parse* error about an identifier, not an
    authorization error and not a missing catalog: nothing here has looked for the table yet.

    Pinned as a refusal rather than routed around, because the day a delta-spark upgrade parses
    three-part names is the day this suite can drop ``create_clustered_by_ddl`` -- and this test
    failing is how that day announces itself.
    """
    from pyspark.errors import ParseException

    tables = run_pipeline.resolve_tables(NAMESPACE, SCOPE, argv=[])
    with pytest.raises(ParseException) as exc:
        run_pipeline.ensure_tables(spark, tables)
    assert "PARSE_SYNTAX_ERROR" in str(exc.value)
    assert tables.ledger in str(exc.value)
    # The caret lands on the second dot: the parser accepted `<catalog>.<schema>` as a whole
    # identifier and stopped there.
    assert f"pos {len(NAMESPACE)}" in str(exc.value)
    assert not run_pipeline.table_exists(spark, tables.ledger)


def test_the_same_builder_takes_the_two_level_name(spark, uc_schema):
    """The control. Two parts parse, so the failure above is about the arity and nothing else."""
    from delta.tables import DeltaTable

    spark.sql(f"USE {NAMESPACE}")
    try:
        DeltaTable.createIfNotExists(spark).tableName(
            f"{SCHEMA}.builder_two_level"
        ).addColumns(spark.createDataFrame([], "vuln_key STRING NOT NULL").schema).clusterBy(
            "vuln_key"
        ).execute()
    finally:
        spark.sql("USE spark_catalog.default")
    assert spark.catalog.tableExists(f"{NAMESPACE}.builder_two_level")


# --------------------------------------------------------- everything else takes three parts


def test_every_other_statement_the_pipeline_issues_takes_a_three_level_name(spark, uc_schema):
    """DDL, append, read, exists, MERGE, DELETE and OPTIMIZE -- all against ``a.b.c``.

    These are the statements ``create_clustered``, ``write_append``, ``table_exists``,
    ``merge_ledger``, ``clear_scan`` and ``maintain`` issue. Every one of them is Spark's own
    or Delta's SQL surface, and every one of them resolves three parts.
    """
    table = f"{NAMESPACE}.three_part_probe"
    spark.sql(
        f"CREATE TABLE IF NOT EXISTS {table} (vuln_key STRING NOT NULL, n INT) USING DELTA "
        f"CLUSTER BY (vuln_key) TBLPROPERTIES (delta.enableDeletionVectors = true)"
    )
    assert run_pipeline.table_exists(spark, table)
    assert spark.catalog.tableExists(table)

    spark.createDataFrame([("a", 1), ("b", 2)], "vuln_key STRING, n INT").write.format(
        "delta"
    ).mode("append").option("mergeSchema", "true").saveAsTable(table)
    assert spark.table(table).count() == 2

    spark.createDataFrame([("a", 9), ("c", 3)], "vuln_key STRING, n INT").createOrReplaceTempView(
        "three_part_src"
    )
    spark.sql(
        f"MERGE INTO {table} AS target USING three_part_src AS source "
        f"ON target.vuln_key = source.vuln_key "
        f"WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *"
    )
    assert spark.table(table).count() == 3
    assert spark.table(table).filter("vuln_key = 'a'").collect()[0]["n"] == 9

    spark.sql(f"DELETE FROM {table} WHERE vuln_key = 'b'")
    assert spark.table(table).count() == 2
    spark.sql(f"OPTIMIZE {table}")

    detail = spark.sql(f"DESCRIBE DETAIL {table}").collect()[0]
    assert detail["clusteringColumns"] == ["vuln_key"]
    assert detail["properties"]["delta.enableDeletionVectors"] == "true"


@pytest.fixture(scope="module")
def three_level_register(spark, uc_schema):
    """Two real scans of the committed SCA fixture into a three-level register.

    The same route ``conftest.live_tables`` takes -- bronze append by ``saveAsTable``, then
    ``run_pipeline.build_metrics`` for silver, the ledger MERGE, the ``scans`` row and the four
    gold tables -- with every table name three parts long. The only substitution is
    ``create_clustered_by_ddl`` for ``create_clustered``, which is the single call the previous
    test showed cannot parse the name.
    """
    tables = run_pipeline.resolve_tables(NAMESPACE, SCOPE, argv=[])
    nodes = extract_nodes(json.loads((BRICK_DIR / LIVE_FIXTURE).read_text()))
    assert len(nodes) == FIXTURE_FINDINGS, "the committed fixture changed size; re-measure below"

    create_clustered_by_ddl(spark, tables.ledger, LEDGER_SCHEMA, "ledger")
    # The ledger now exists, so `ensure_tables`' own `create_clustered` is a no-op and its
    # second half -- the `scans` table, created by an empty-frame `saveAsTable` -- runs for real
    # against the three-level name.
    run_pipeline.ensure_tables(spark, tables)
    create_clustered_by_ddl(spark, tables.bronze, run_pipeline.BRONZE_TABLE_SCHEMA, "bronze")

    from pyspark.sql import functions as F

    def scan(scan_id, scan_ts, payload):
        rows = [(scan_id, scan_ts, SCOPE, i, json.dumps(n)) for i, n in enumerate(payload)]
        spark.createDataFrame(
            rows, "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"
        ).withColumn("scan_ts", F.col("scan_ts").cast("timestamp")).write.format("delta").mode(
            "append"
        ).option("mergeSchema", "true").saveAsTable(tables.bronze)
        # Silver has no declared schema anywhere -- it is whatever `metrics.silver_findings`
        # projects -- so it is created here from that same projection, under the same
        # scope-appropriate rule `build_metrics` resolves, exactly as it does one line before it
        # writes it.
        create_clustered_by_ddl(
            spark,
            tables.silver,
            metrics.classify_risk(
                metrics.silver_findings(
                    spark.table(tables.bronze).filter(f"scan_id = '{scan_id}'"), SCOPE
                ),
                rule_for_scope(SCOPE),
            ).schema,
            "silver",
        )
        run_pipeline.build_metrics(
            spark, tables, scan_id, scan_ts, SCOPE, severities=SEVERITIES, summary=False
        )

    scan("uc-scan-1", "2026-06-01T00:00:00Z", nodes)
    scan("uc-scan-2", "2026-07-01T00:00:00Z", nodes[: max(1, len(nodes) // 2)])
    return tables


def test_a_whole_register_lands_under_three_level_names(spark, three_level_register):
    """Every table exists and carries rows, and both scans reconciled and committed.

    The numbers are the ones ``conftest.live_tables`` produces at *two* levels. Asserting them
    here is what makes this more than a smoke test -- a three-level register is not merely
    writable, it is the same register.
    """
    tables = three_level_register
    for attr in ("bronze", "silver", "ledger", "scans", "mttr", "program", "capacity",
                 "sensitivity"):
        name = getattr(tables, attr)
        assert name.count(".") == 2, name
        assert run_pipeline.table_exists(spark, name), name
        assert spark.table(name).count() > 0, name

    ledger = spark.table(tables.ledger)
    assert ledger.count() == FIXTURE_FINDINGS

    scans = {r["scan_id"]: r for r in spark.table(tables.scans).collect()}
    assert set(scans) == {"uc-scan-1", "uc-scan-2"}
    assert scans["uc-scan-1"]["total"] == FIXTURE_FINDINGS
    assert scans["uc-scan-1"]["new_count"] == FIXTURE_FINDINGS
    assert scans["uc-scan-2"]["total"] == FIXTURE_FINDINGS // 2
    assert scans["uc-scan-2"]["new_count"] == 0
    assert scans["uc-scan-1"]["severities"] == "CRITICAL,HIGH"

    # The truncated second scan is what makes the reconcile do real work rather than trivially
    # agreeing with itself: the tail of the fixture is gone, so it resolves by *disappearance*.
    assert scans["uc-scan-2"]["resolved_count"] > 0
    assert (
        ledger.filter("resolution_src = 'disappeared'").count()
        == scans["uc-scan-2"]["resolved_count"]
    )


def test_the_three_level_ledger_kept_its_clustering(spark, three_level_register):
    """The register is physically what production creates, not merely readable."""
    detail = spark.sql(f"DESCRIBE DETAIL {three_level_register.ledger}").collect()[0]
    assert detail["clusteringColumns"] == ["vuln_key"]
    assert detail["properties"]["delta.enableDeletionVectors"] == "true"


def test_a_scan_recorded_under_three_level_names_reads_back_through_recorded_scan(
    spark, three_level_register
):
    """The idempotency guard resolves the three-level ``scans`` table too."""
    assert run_pipeline.recorded_scan(spark, three_level_register, "uc-scan-2") is not None
    assert run_pipeline.recorded_scan(spark, three_level_register, "never-ran") is None
    assert run_pipeline.ledger_already_merged(spark, three_level_register, "uc-scan-2")


# ------------------------------------------------------------------- the negative: no plugin


@pytest.mark.parametrize("catalog", UNREGISTERED_CATALOGS)
def test_an_unregistered_catalog_is_not_reached_at_all(spark, catalog):
    """A catalog with no ``spark.sql.catalog.<name>`` plugin. Three statements, three voices.

    Recorded exactly, because this is the failure the README should be describing and none of
    the three says "catalog not found":

    * ``spark.catalog.databaseExists`` **does not raise** -- it returns ``False``, which is why
      ``ensure_schema`` proceeds to CREATE rather than short-circuiting;
    * ``CREATE SCHEMA`` dies inside Spark's own error formatter
      (``[INTERNAL_ERROR] Undefined error message parameter for error class:
      '_LEGACY_ERROR_TEMP_1055'``), and ``ensure_schema`` re-raises that as its
      "grant this principal CREATE SCHEMA" message -- which is a *misdiagnosis* worth knowing
      about: the catalog does not exist, so no grant would help;
    * ``table_exists`` and ``saveAsTable`` are refused by the *session* catalog, which reports
      ``REQUIRES_SINGLE_PART_NAMESPACE`` / "Couldn't find a catalog to handle the identifier".
      Spark has fallen back to ``spark_catalog`` and read ``<catalog>.<schema>`` as a two-part
      namespace inside it -- it never looked for a catalog by that name.
    """
    from pyspark.errors import AnalysisException

    namespace = run_pipeline.resolve_namespace(
        argv=[f"--catalog={catalog}", f"--schema={SCHEMA}"]
    )
    tables = run_pipeline.resolve_tables(namespace, SCOPE, argv=[])

    assert spark.catalog.databaseExists(namespace) is False

    with pytest.raises(RuntimeError) as schema_exc:
        run_pipeline.ensure_schema(spark, namespace)
    assert f"Schema {namespace} does not exist and could not be created" in str(schema_exc.value)
    assert schema_exc.value.__cause__ is not None
    assert namespace in str(schema_exc.value.__cause__)

    with pytest.raises(AnalysisException) as exists_exc:
        run_pipeline.table_exists(spark, tables.ledger)
    assert "REQUIRES_SINGLE_PART_NAMESPACE" in str(exists_exc.value)
    assert "spark_catalog requires a single-part namespace" in str(exists_exc.value)

    with pytest.raises(AnalysisException) as write_exc:
        spark.createDataFrame([], run_pipeline.SCANS_SCHEMA).write.format("delta").mode(
            "append"
        ).saveAsTable(tables.scans)
    assert "Couldn't find a catalog to handle the identifier" in str(write_exc.value)
    assert tables.scans in str(write_exc.value)
