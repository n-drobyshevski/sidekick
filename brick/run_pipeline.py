"""Databricks entry point: Wiz API -> bronze -> silver -> three gold metric tables.

Run it as a Job (Python file task) or paste it into a notebook. Parameters come from
``dbutils.widgets`` when they exist and environment variables otherwise, so the same file
runs on a cluster and on a laptop.

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
import uuid
from typing import Optional

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

from brick import metrics
from brick.config import DEFAULT_FETCH_SEVERITIES, DEFAULT_RISK_RULE, RiskRule
from brick.ingest import DEFAULT_AUTH_URL, fetch_findings, get_token, secret

BRONZE_TABLE = "findings_raw"
SILVER_TABLE = "findings"
GOLD_MTTR = "metrics_mttr"
GOLD_PROGRAM = "metrics_program"
GOLD_CAPACITY = "metrics_capacity"


def param(name: str, default: str = "") -> str:
    """A job parameter: widget first, then environment variable, then the default."""
    try:
        dbutils = globals()["dbutils"]  # injected into notebook globals
        value = dbutils.widgets.get(name)
        if value:
            return value
    except Exception:  # noqa: BLE001 -- not on a cluster, or the widget is not defined
        pass
    return os.environ.get(name.upper(), default)


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
    namespace: str,
    scan_id: str,
    scan_ts: str,
    rule: RiskRule = DEFAULT_RISK_RULE,
) -> None:
    """Silver + the three gold tables for one scan."""
    bronze = spark.table(f"{namespace}.{BRONZE_TABLE}").filter(f"scan_id = '{scan_id}'")

    silver = metrics.classify_risk(metrics.silver_findings(bronze), rule).cache()
    silver.write.mode("append").saveAsTable(f"{namespace}.{SILVER_TABLE}")

    mttr = metrics.with_scan_columns(metrics.mttr_by_severity(silver), scan_id, scan_ts)
    mttr.write.mode("append").saveAsTable(f"{namespace}.{GOLD_MTTR}")

    program = metrics.with_scan_columns(metrics.confusion_matrix(silver), scan_id, scan_ts)
    program = program.withColumn("risk_rule", F.lit(rule.sentence()))
    program.write.mode("append").saveAsTable(f"{namespace}.{GOLD_PROGRAM}")

    capacity = metrics.with_scan_columns(
        metrics.capacity_by_month(silver, scan_ts), scan_id, scan_ts
    )
    capacity.write.mode("append").saveAsTable(f"{namespace}.{GOLD_CAPACITY}")

    print(f"[{scan_id}] risk rule: {rule.sentence()}")
    metrics.order_by_severity(
        program.select(
            "severity", "coverage_pct", "efficiency_pct", "prevalence_pct", "signal_coverage_pct"
        )
    ).show(truncate=False)
    silver.unpersist()


def main(scan_id: Optional[str] = None) -> None:
    spark = get_spark()
    catalog = param("catalog", "main")
    schema = param("schema", "wiz")
    namespace = f"{catalog}.{schema}"
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {namespace}")

    scan_id = scan_id or f"scan-{uuid.uuid4().hex[:12]}"
    scan_ts = utc_now_iso()

    count = ingest_to_bronze(spark, f"{namespace}.{BRONZE_TABLE}", scan_id, scan_ts)
    if not count:
        return
    print(f"[{scan_id}] ingested {count} findings at {scan_ts}")
    build_metrics(spark, namespace, scan_id, scan_ts)


if __name__ == "__main__":
    main()
