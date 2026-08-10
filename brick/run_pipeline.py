"""Databricks entry point: Wiz API -> bronze -> silver -> three gold metric tables.

Run it as a Job (Python file task) or call ``main()`` from a notebook. Parameters resolve in
this order, so the same file works in all three places:

    1. ``--name=value`` on the command line   -- how a Job's Python file task receives them
    2. ``dbutils.widgets.get(name)``          -- how a notebook receives them
    3. the ``NAME`` environment variable      -- how a laptop receives them

Tables written (all appended, never overwritten -- each run adds a ``scan_id`` so the gold
tables accumulate into a trend):

    <catalog>.<schema>.findings_raw       bronze   scan_id, scan_ts, node_json
    <catalog>.<schema>.findings           silver   typed findings + mttr_days / age_days
    <catalog>.<schema>.metrics_mttr       gold     scan_id x severity (+ OVERALL)
    <catalog>.<schema>.metrics_program    gold     scan_id x severity (+ OVERALL)
    <catalog>.<schema>.metrics_capacity   gold     scan_id x month

Bronze keeps the finding as a JSON string: a Wiz schema change can then never fail ingest,
and silver is just the typed projection of whatever arrived.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Run as a script (a Job's Python file task), sys.path[0] is brick/, not the repo root, so
# `import brick` fails before anything else happens. Put the repo root on the path first.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pyspark.sql import SparkSession  # noqa: E402
from pyspark.sql import functions as F  # noqa: E402

from brick import dbx, metrics  # noqa: E402
from brick.config import DEFAULT_FETCH_SEVERITIES, DEFAULT_RISK_RULE, RiskRule  # noqa: E402
from brick.ingest import DEFAULT_AUTH_URL, fetch_findings, get_token, secret  # noqa: E402

BRONZE_TABLE = "findings_raw"
SILVER_TABLE = "findings"
GOLD_MTTR = "metrics_mttr"
GOLD_PROGRAM = "metrics_program"
GOLD_CAPACITY = "metrics_capacity"

# These tables usually land in a schema shared with other teams, where bare names like
# `findings` and `metrics_capacity` are an obvious collision risk. Prefixed by default;
# pass --table_prefix= (empty) to opt out.
DEFAULT_TABLE_PREFIX = "wiz_"

# Catalog, schema and prefix are interpolated straight into SQL, so they are checked rather
# than trusted. They come from an operator, not an attacker -- but `--schema=wiz;DROP ...`
# should fail with a clear message instead of doing something surprising.
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PREFIX = re.compile(r"^[A-Za-z0-9_]*$")


@dataclass(frozen=True)
class Tables:
    """The five fully-qualified table names one run writes to."""

    bronze: str
    silver: str
    mttr: str
    program: str
    capacity: str


def param(name: str, default: str = "", argv: Optional[list] = None) -> str:
    """A job parameter: ``--name=value``, then a widget, then ``$NAME``, then the default."""
    prefix = f"--{name}="
    for arg in argv if argv is not None else sys.argv[1:]:
        if arg.startswith(prefix):
            return arg[len(prefix) :]
    return dbx.widget(name) or os.environ.get(name.upper(), default)


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_spark() -> SparkSession:
    spark = SparkSession.builder.appName("wiz-vulnerability-metrics").getOrCreate()
    # Capacity buckets by UTC calendar month and MTTR is a UTC-to-UTC difference; a cluster
    # left on local time would silently shift findings between months.
    spark.conf.set("spark.sql.session.timeZone", "UTC")
    return spark


def ingest_to_bronze(spark: SparkSession, table: str, scan_id: str, scan_ts: str) -> int:
    """Fetch every finding and append it to bronze. Returns the row count."""
    api_url = param("wiz_api_url")
    if not api_url:
        raise RuntimeError("wiz_api_url is required, e.g. https://api.<region>.app.wiz.io/graphql")
    scope = param("secret_scope") or None
    requested = param("severities") or ",".join(DEFAULT_FETCH_SEVERITIES)
    severities = [s for s in requested.split(",") if s.strip()]

    token = get_token(
        secret(scope, "wiz-client-id", "WIZ_CLIENT_ID"),
        secret(scope, "wiz-client-secret", "WIZ_CLIENT_SECRET"),
        auth_url=param("wiz_auth_url") or DEFAULT_AUTH_URL,
    )

    rows = [
        (scan_id, scan_ts, json.dumps(node))
        for node in fetch_findings(api_url, token, severities=severities)
    ]
    if not rows:
        print(f"[{scan_id}] Wiz returned no findings for severities={severities}")
        return 0

    bronze = spark.createDataFrame(rows, "scan_id STRING, scan_ts STRING, node_json STRING")
    bronze.withColumn("scan_ts", bronze["scan_ts"].cast("timestamp")).write.mode(
        "append"
    ).saveAsTable(table)
    return len(rows)


def build_metrics(
    spark: SparkSession,
    tables: Tables,
    scan_id: str,
    scan_ts: str,
    rule: RiskRule = DEFAULT_RISK_RULE,
) -> None:
    """Silver + the three gold tables for one scan."""
    bronze = spark.table(tables.bronze).filter(f"scan_id = '{scan_id}'")

    silver = metrics.classify_risk(metrics.silver_findings(bronze), rule).cache()
    silver.write.mode("append").saveAsTable(tables.silver)

    mttr = metrics.with_scan_columns(metrics.mttr_by_severity(silver), scan_id, scan_ts)
    mttr.write.mode("append").saveAsTable(tables.mttr)

    program = metrics.with_scan_columns(metrics.confusion_matrix(silver), scan_id, scan_ts)
    program = program.withColumn("risk_rule", F.lit(rule.sentence()))
    program.write.mode("append").saveAsTable(tables.program)

    capacity = metrics.with_scan_columns(
        metrics.capacity_by_month(silver, scan_ts), scan_id, scan_ts
    )
    capacity.write.mode("append").saveAsTable(tables.capacity)

    print(f"[{scan_id}] risk rule: {rule.sentence()}")
    metrics.order_by_severity(
        program.select(
            "severity", "coverage_pct", "efficiency_pct", "prevalence_pct", "signal_coverage_pct"
        )
    ).show(truncate=False)
    silver.unpersist()


def resolve_namespace(argv: Optional[list] = None) -> str:
    """``<catalog>.<schema>``, with the catalog required -- there is no safe default for it.

    A default that succeeds is worse than none here. `main` exists in most Unity Catalog
    metastores, is a production catalog in plenty of organisations, and usually carries broad
    USE CATALOG grants -- so forgetting the parameter would quietly land CVEs-against-named-hosts
    somewhere permissive rather than failing.
    """
    catalog = param("catalog", argv=argv)
    if not catalog:
        raise RuntimeError(
            "catalog is required -- pass --catalog=<name> (or set the widget / $CATALOG). "
            "Prefer a catalog scoped to security data over a shared one; on a workspace "
            "without Unity Catalog, pass --catalog=hive_metastore."
        )
    schema = param("schema", "wiz", argv=argv)
    for label, value in (("catalog", catalog), ("schema", schema)):
        if not IDENTIFIER.match(value):
            raise RuntimeError(f"{label} {value!r} is not a valid identifier")
    return f"{catalog}.{schema}"


def resolve_tables(namespace: str, argv: Optional[list] = None) -> Tables:
    """The five table names, prefixed so they can share a schema with other teams' tables."""
    prefix = param("table_prefix", DEFAULT_TABLE_PREFIX, argv=argv)
    if not PREFIX.match(prefix):
        raise RuntimeError(f"table_prefix {prefix!r} is not a valid identifier fragment")

    def qualify(name: str) -> str:
        return f"{namespace}.{prefix}{name}"

    return Tables(
        bronze=qualify(BRONZE_TABLE),
        silver=qualify(SILVER_TABLE),
        mttr=qualify(GOLD_MTTR),
        program=qualify(GOLD_PROGRAM),
        capacity=qualify(GOLD_CAPACITY),
    )


def ensure_schema(spark: SparkSession, namespace: str) -> None:
    """Create the schema, but only when it is actually missing.

    An unconditional ``CREATE SCHEMA IF NOT EXISTS`` looks harmless and is not: in a shared
    organisation catalog a service principal typically holds CREATE TABLE on one schema and
    no CREATE SCHEMA on the catalog, so the statement fails with PERMISSION_DENIED against a
    schema that already exists and is perfectly writable. Checking first means the job needs
    the privilege only when it genuinely has to create something.
    """
    try:
        if spark.catalog.databaseExists(namespace):
            return
    except Exception:  # noqa: BLE001 -- can't tell; fall through and let CREATE decide
        pass
    try:
        spark.sql(f"CREATE SCHEMA IF NOT EXISTS {namespace}")
    except Exception as exc:  # noqa: BLE001 -- re-raised with the parameter named
        raise RuntimeError(
            f"Schema {namespace} does not exist and could not be created. Either create it "
            f"first, or grant this principal CREATE SCHEMA on the catalog."
        ) from exc


def main(scan_id: Optional[str] = None) -> None:
    # Resolve parameters before touching Spark: a missing one should fail in milliseconds,
    # not after a cluster has warmed up and an API fetch has run.
    namespace = resolve_namespace()
    tables = resolve_tables(namespace)

    spark = get_spark()
    ensure_schema(spark, namespace)

    scan_id = scan_id or f"scan-{uuid.uuid4().hex[:12]}"
    scan_ts = utc_now_iso()

    count = ingest_to_bronze(spark, tables.bronze, scan_id, scan_ts)
    if not count:
        return
    print(f"[{scan_id}] ingested {count} findings at {scan_ts}")
    build_metrics(spark, tables, scan_id, scan_ts)


if __name__ == "__main__":
    main()
