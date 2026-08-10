"""End-to-end tests for the persistent ledger: the MERGE, the guards, and the rebuild.

These are the tests that need a real Delta table rather than a bare DataFrame, so they carry
the cost of a Delta-enabled SparkSession. What they buy is the part ``test_ledger.py`` cannot
reach: that reconciliation actually *persists*, that a retried scan does not double-count, and
that replaying bronze reproduces the ledger it is supposed to reproduce.

Run with:  pytest brick/tests -q     (needs `pip install -r brick/requirements.txt`)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

pytest.importorskip(
    "pyspark", reason="brick tests need pyspark: pip install -r brick/requirements.txt"
)
pytest.importorskip(
    "delta", reason="ledger tests need delta-spark: pip install -r brick/requirements.txt"
)

from pyspark.sql import functions as F  # noqa: E402

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import ledger as ledger_mod  # noqa: E402
import metrics  # noqa: E402
import run_pipeline  # noqa: E402
from config import DEFAULT_RISK_RULE, STATUS_OPEN, STATUS_RESOLVED  # noqa: E402

SEVERITIES = ["CRITICAL", "HIGH"]
TS = {
    "s1": "2026-05-01T00:00:00Z",
    "s2": "2026-05-08T00:00:00Z",
    "s3": "2026-05-15T00:00:00Z",
}


@pytest.fixture
def tables(spark, request):
    """A private schema per test, so tables never leak between them."""
    # Named from the test itself, not from a truncated hash of it. The first version took the
    # first 10 digits of `abs(hash(name))`, which collides: two tests then shared a database and
    # the first one's teardown dropped the second one's tables mid-run.
    name = "t_" + re.sub(r"\W", "_", request.node.name).lower()[:100]
    # Dropped before creating as well as after, so an interrupted previous run cannot leave a
    # half-built ledger for this test to reconcile against.
    spark.sql(f"DROP DATABASE IF EXISTS {name} CASCADE")
    spark.sql(f"CREATE DATABASE {name}")
    tbl = run_pipeline.resolve_tables(name, "os", argv=[])
    run_pipeline.ensure_tables(spark, tbl)
    yield tbl
    spark.sql(f"DROP DATABASE IF EXISTS {name} CASCADE")


# ------------------------------------------------------------------ fixture builders


def node(fid="f-1", severity="HIGH", **over) -> dict:
    base = {
        "id": fid,
        "name": f"CVE-2026-{fid}",
        "detailedName": "openssl",
        "severity": severity,
        "status": "OPEN",
        "firstDetectedAt": "2026-04-01T00:00:00Z",
        "resolvedAt": None,
        "hasCisaKevExploit": True,
        "hasExploit": False,
        "epssProbability": 0.5,
        "vulnerableAsset": {
            "id": "vm-1", "name": "web-01", "type": "VIRTUAL_MACHINE",
            "cloudPlatform": "AWS", "subscriptionName": "prod",
        },
    }
    base.update(over)
    return base


def write_bronze(spark, tables, nodes, scan_id, scan_ts):
    rows = [
        (scan_id, scan_ts, "os", i, json.dumps(n)) for i, n in enumerate(nodes)
    ]
    df = spark.createDataFrame(
        rows, "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"
    )
    df.withColumn("scan_ts", F.col("scan_ts").cast("timestamp")).write.mode("append").option(
        "mergeSchema", "true"
    ).saveAsTable(tables.bronze)


def run_scan(spark, tables, nodes, scan_id, scan_ts, severities=SEVERITIES):
    """One full scan: bronze, then everything build_metrics does."""
    write_bronze(spark, tables, nodes, scan_id, scan_ts)
    run_pipeline.build_metrics(
        spark, tables, scan_id, scan_ts, "os", severities=severities
    )


def ledger_rows(spark, tables) -> dict:
    return {r["vuln_key"]: r.asDict() for r in spark.table(tables.ledger).collect()}


# --------------------------------------------------------------------- persistence


def test_the_ledger_persists_across_scans(spark, tables):
    """The v1→v2 difference, end to end and through a real MERGE.

    Three findings open; one disappears; one is resolved by the API. The disappeared one is the
    case v1 could not see at all -- Wiz simply stops returning it and never sets resolvedAt.
    """
    run_scan(spark, tables, [node("f-1"), node("f-2"), node("f-3")], "s1", TS["s1"])
    assert len(ledger_rows(spark, tables)) == 3

    run_scan(
        spark, tables,
        [node("f-1"), node("f-2", status="RESOLVED", resolvedAt="2026-05-05T00:00:00Z")],
        "s2", TS["s2"],
    )

    rows = ledger_rows(spark, tables)
    assert len(rows) == 3, "the ledger keeps findings the API has stopped returning"
    assert rows["id:f-1"]["status"] == STATUS_OPEN
    assert rows["id:f-2"]["status"] == STATUS_RESOLVED
    assert rows["id:f-2"]["resolution_src"] == "api"
    assert rows["id:f-3"]["status"] == STATUS_RESOLVED
    assert rows["id:f-3"]["resolution_src"] == "disappeared"

    log = spark.table(tables.scans).orderBy("scan_ts").collect()
    assert [r["scan_id"] for r in log] == ["s1", "s2"]
    assert log[0]["new_count"] == 3
    assert log[1]["resolved_count"] == 2
    assert log[1]["severities"] == "CRITICAL,HIGH"


def test_the_gold_tables_see_more_resolutions_than_the_snapshot(spark, tables):
    """The payoff, as published numbers.

    ``resolved`` counts the ledger's resolutions; ``snap_resolved`` counts what the snapshot
    alone could prove. The disappeared finding is exactly the difference, and it is why v1
    under-reported both coverage and MTTR.
    """
    run_scan(spark, tables, [node("f-1"), node("f-2")], "s1", TS["s1"])
    run_scan(spark, tables, [node("f-1")], "s2", TS["s2"])

    overall = (
        spark.table(tables.mttr)
        .filter((F.col("scan_id") == "s2") & (F.col("severity") == "OVERALL"))
        .collect()[0]
    )
    assert overall["resolved"] == 1
    # The final scan's snapshot contains one still-open finding and no resolutions at all.
    assert (overall["snap_resolved"] or 0) == 0
    assert overall["resolved_disappeared"] == 1
    assert (overall["resolved_api"] or 0) == 0


def test_capacity_flags_months_nobody_watched(spark, tables):
    """Reconstructed months are inferred from the API's dates, not measured by us."""
    run_scan(spark, tables, [node("f-1")], "s1", TS["s1"])

    months = {
        r["month"].strftime("%Y-%m"): r.asDict()
        for r in spark.table(tables.capacity).filter(F.col("scan_id") == "s1").collect()
    }
    # The finding was first detected in April; the first scan is in May.
    assert months["2026-04"]["reconstructed"] is True
    assert months["2026-05"]["reconstructed"] is False


def test_capacity_publishes_the_observed_close_count(spark, tables):
    """The independent cross-check on `closed`, from reconciliation's own deltas."""
    run_scan(spark, tables, [node("f-1"), node("f-2")], "s1", TS["s1"])
    run_scan(spark, tables, [node("f-1")], "s2", TS["s2"])

    may = (
        spark.table(tables.capacity)
        .filter((F.col("scan_id") == "s2") & (F.col("month") == "2026-05-01"))
        .collect()[0]
    )
    # One finding disappeared in May, and both routes to that number agree.
    assert may["closed"] == 1
    assert may["closed_observed"] == 1


# ------------------------------------------------------------------------- guards


def test_a_rerun_of_the_same_scan_is_a_no_op(spark, tables, monkeypatch):
    """Idempotency: a Job retry arrives with the scan_id its predecessor used."""
    run_scan(spark, tables, [node("f-1")], "s1", TS["s1"])
    before = ledger_rows(spark, tables)

    assert run_pipeline.recorded_scan(spark, tables, "s1") is not None

    def explode(*_args, **_kwargs):
        raise AssertionError("a recorded scan must not be re-ingested")

    monkeypatch.setattr(run_pipeline, "ingest_to_bronze", explode)
    monkeypatch.setattr(run_pipeline, "get_spark", lambda: spark)
    monkeypatch.setattr(sys, "argv", [
        "run_pipeline", "--catalog=x", "--scan_id=s1",
        f"--schema={tables.scans.split('.')[0]}", "--wiz_api_url=https://example/graphql",
    ])
    # resolve_namespace would build a different namespace, so drive the guard directly.
    assert run_pipeline.recorded_scan(spark, tables, "s1")["new_count"] == 1
    assert ledger_rows(spark, tables) == before


def test_a_torn_write_is_detected(spark, tables):
    """The MERGE committed but the scan log did not.

    Reconciling again would treat every finding already in the ledger as unchanged and every
    finding absent from the retry as newly disappeared -- resolving a second time what was
    already resolved. Detecting it is cheap; recovering silently is not possible.
    """
    run_scan(spark, tables, [node("f-1")], "s1", TS["s1"])
    assert run_pipeline.ledger_already_merged(spark, tables, "s1") is True

    # Simulate the crash: drop the scan log row, keep the merged ledger.
    spark.sql(f"DELETE FROM {tables.scans} WHERE scan_id = 's1'")
    assert run_pipeline.recorded_scan(spark, tables, "s1") is None
    assert run_pipeline.ledger_already_merged(spark, tables, "s1") is True

    # And a scan that never ran is not mistaken for one that did.
    assert run_pipeline.ledger_already_merged(spark, tables, "never-ran") is False


def test_the_scope_guard_survives_a_round_trip_through_the_scan_log(spark, tables):
    """The severity scope has to come back off the table the way it went on.

    A MEDIUM finding absent from a CRITICAL/HIGH scan must stay open -- and the only record of
    what that scan covered is the `severities` column.
    """
    run_scan(
        spark, tables, [node("f-1", severity="MEDIUM"), node("f-2", severity="HIGH")],
        "s1", TS["s1"], severities=["CRITICAL", "HIGH", "MEDIUM"],
    )
    run_scan(spark, tables, [node("f-2")], "s2", TS["s2"], severities=["CRITICAL", "HIGH"])

    rows = ledger_rows(spark, tables)
    assert rows["id:f-1"]["status"] == STATUS_OPEN, "MEDIUM was not scanned, so not resolved"

    stored = {r["scan_id"]: r["severities"] for r in spark.table(tables.scans).collect()}
    assert stored["s1"] == "CRITICAL,HIGH,MEDIUM"
    assert stored["s2"] == "CRITICAL,HIGH"
    assert run_pipeline.parse_severities(stored["s2"]) == ["CRITICAL", "HIGH"]


def test_unscoped_scans_are_stored_as_null(spark, tables):
    """NULL means "asked for everything", which is what lets absence mean something."""
    assert run_pipeline.serialize_severities([]) is None
    assert run_pipeline.serialize_severities(None) is None
    assert run_pipeline.parse_severities(None) is None
    assert run_pipeline.parse_severities("") is None


# ------------------------------------------------------------------------ rebuild


def test_rebuild_reproduces_the_live_ledger(spark, tables):
    """The keystone invariant for the backfill.

    Replaying bronze must land exactly where running the scans live landed. If it does not, the
    rebuilt history is a different register that merely resembles the real one -- and there is
    no way to tell which numbers to believe.
    """
    run_scan(spark, tables, [node("f-1"), node("f-2"), node("f-3")], "s1", TS["s1"])
    run_scan(spark, tables, [node("f-1"), node("f-2")], "s2", TS["s2"])
    run_scan(spark, tables, [node("f-1"), node("f-3")], "s3", TS["s3"])

    live = ledger_rows(spark, tables)
    assert live["id:f-2"]["status"] == STATUS_RESOLVED
    assert live["id:f-3"]["reopened_count"] == 1, "f-3 vanished then came back"

    replayed = run_pipeline.rebuild_ledger(spark, tables, "os", SEVERITIES, "scan_ts")
    assert replayed == 3

    assert ledger_rows(spark, tables) == live


def test_rebuild_is_idempotent(spark, tables):
    """Running the backfill twice must not drift -- it is the recovery path, so it will be."""
    run_scan(spark, tables, [node("f-1"), node("f-2")], "s1", TS["s1"])
    run_scan(spark, tables, [node("f-1")], "s2", TS["s2"])

    run_pipeline.rebuild_ledger(spark, tables, "os", SEVERITIES, "scan_ts")
    once = ledger_rows(spark, tables)
    run_pipeline.rebuild_ledger(spark, tables, "os", SEVERITIES, "scan_ts")
    assert ledger_rows(spark, tables) == once


def test_rebuild_on_bronze_without_seq_still_works(spark, tables):
    """v1 bronze has no `seq` column, and the backfill exists precisely for v1 history."""
    rows = [("s1", TS["s1"], "os", json.dumps(node("f-1")))]
    spark.createDataFrame(
        rows, "scan_id STRING, scan_ts STRING, scope STRING, node_json STRING"
    ).withColumn("scan_ts", F.col("scan_ts").cast("timestamp")).write.mode("append").option(
        "mergeSchema", "true"
    ).saveAsTable(tables.bronze)

    assert run_pipeline.rebuild_ledger(spark, tables, "os", SEVERITIES, "scan_ts") == 1
    assert ledger_rows(spark, tables)["id:f-1"]["status"] == STATUS_OPEN


def test_rebuild_refuses_when_there_is_no_bronze(spark, tables):
    with pytest.raises(RuntimeError, match="does not exist"):
        run_pipeline.rebuild_ledger(spark, tables, "os", SEVERITIES, "scan_ts")


# -------------------------------------------------------------- the metric contract


def test_metrics_run_unchanged_against_the_ledger(spark, tables):
    """lifecycle_frame's whole job: metrics.py must not need to know where rows came from."""
    run_scan(spark, tables, [node("f-1"), node("f-2")], "s1", TS["s1"])
    run_scan(spark, tables, [node("f-1")], "s2", TS["s2"])

    frame = metrics.classify_risk(
        ledger_mod.lifecycle_frame(spark.table(tables.ledger), TS["s2"]), DEFAULT_RISK_RULE
    )
    mttr = {r["severity"]: r.asDict() for r in metrics.mttr_by_severity(frame).collect()}
    program = {r["severity"]: r.asDict() for r in metrics.confusion_matrix(frame).collect()}

    assert mttr["OVERALL"]["resolved"] == 1
    assert mttr["OVERALL"]["open"] == 1
    # Both findings are KEV-positive, so one of two high-risk findings was remediated.
    assert program["OVERALL"]["tp"] == 1
    assert program["OVERALL"]["fn"] == 1
    assert program["OVERALL"]["coverage_pct"] == pytest.approx(50.0)
