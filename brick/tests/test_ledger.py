"""Tests for the cross-scan lifecycle rules -- the thing v2 exists for.

The oracles are not invented. ``gas/src/domain/reconcile.ts`` is the standard, and the strongest
of these tests replay its own golden fixture (``gas/test/fixtures/reconcile.json``) scenario by
scenario -- input records, prior ledger, expected ledger, expected deltas. If a number here
moves, this port has stopped agreeing with the reference about what a vulnerability's life
looks like.

The headline case is ``test_a_finding_that_disappears_is_resolved``: a finding present in one
scan and absent from the next is remediation, and v1 could not see it at all.

Run with:  pytest brick/tests -q     (needs `pip install -r brick/requirements.txt`)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

pytest.importorskip(
    "pyspark", reason="brick tests need pyspark: pip install -r brick/requirements.txt"
)

from pyspark.sql import functions as F  # noqa: E402

BRICK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BRICK_DIR.parent
sys.path.insert(0, str(BRICK_DIR))

import ledger  # noqa: E402
import metrics  # noqa: E402
from config import STATUS_OPEN, STATUS_RESOLVED  # noqa: E402

SCAN_1 = "scan-1"
SCAN_2 = "scan-2"
SCAN_3 = "scan-3"
TS_1 = "2026-05-01T00:00:00Z"
TS_2 = "2026-05-08T00:00:00Z"
TS_3 = "2026-05-15T00:00:00Z"


# ------------------------------------------------------------------ fixture builders


def node(**over) -> dict:
    base = {
        "id": "f-1",
        "name": "CVE-2026-0001",
        "detailedName": "openssl",
        "severity": "HIGH",
        "status": "OPEN",
        "firstDetectedAt": "2026-04-01T00:00:00Z",
        "resolvedAt": None,
        "hasCisaKevExploit": False,
        "hasExploit": False,
        "epssProbability": 0.01,
        "vulnerableAsset": {
            "id": "vm-1",
            "name": "web-01",
            "type": "VIRTUAL_MACHINE",
            "cloudPlatform": "AWS",
            "subscriptionName": "prod",
        },
    }
    base.update(over)
    return base


def observed(spark, nodes, scan_id=SCAN_1, scan_ts=TS_1, scope="os"):
    """Nodes -> bronze -> silver -> keyed observations, exercising the real parse path."""
    rows = [(scan_id, scan_ts, scope, json.dumps(n)) for n in nodes]
    bronze = spark.createDataFrame(
        rows, "scan_id STRING, scan_ts STRING, scope STRING, node_json STRING"
    ).withColumn("scan_ts", F.col("scan_ts").cast("timestamp"))
    return ledger.observed(metrics.silver_findings(bronze))


def apply(spark, prior, nodes, *, scan_id, scan_ts, prev_scan_id=None, prev_scan_ts=None,
          scanned_severities=None, prev_scan_id_by_severity=None, disappearance="scan_ts"):
    """Reconcile one scan and return the resulting full ledger (touched rows merged in).

    Mirrors what run_pipeline's MERGE does, so a test can chain scans the way a real
    register does without needing a Delta table.
    """
    touched = ledger.reconcile(
        prior,
        observed(spark, nodes, scan_id=scan_id, scan_ts=scan_ts),
        scan_id=scan_id,
        scan_ts=scan_ts,
        scope="os",
        prev_scan_id=prev_scan_id,
        prev_scan_ts=prev_scan_ts,
        scanned_severities=scanned_severities,
        prev_scan_id_by_severity=prev_scan_id_by_severity,
        disappearance=disappearance,
    ).cache()
    merged = touched.drop(*ledger.CHANGE_COLUMNS)
    keys = [r["vuln_key"] for r in merged.select("vuln_key").collect()]
    untouched = prior.filter(~F.col("vuln_key").isin(keys)) if keys else prior
    return untouched.unionByName(merged), touched


def by_key(df) -> dict:
    return {r["vuln_key"]: r.asDict() for r in df.collect()}


def deltas(touched) -> dict:
    row = touched.agg(
        F.sum(F.col("is_new").cast("int")).alias("new_count"),
        F.sum(F.col("is_resolved_now").cast("int")).alias("resolved_count"),
        F.sum(F.col("is_reopened").cast("int")).alias("reopened_count"),
    ).collect()[0]
    return {k: int(row[k] or 0) for k in ("new_count", "resolved_count", "reopened_count")}


@pytest.fixture(scope="module")
def first_scan(spark):
    """Scan 1 of the one-finding register: ``(state, touched)``, built once.

    Fifteen tests below open with exactly this scan and then apply a second one to it. Each was
    rebuilding it -- bronze, silver, observed, reconcile, collect -- for an answer that cannot
    differ, which made a shared prologue the most-executed Spark job in the file.

    ``state`` is materialised rather than merely returned, because a DataFrame handed to a
    fixture is still a plan: without this, every test that chained off it would recompute the
    scan anyway and the fixture would buy nothing. ``touched`` is already cached and collected
    inside ``apply``. Both are immutable, so sharing them across tests is safe.
    """
    state, touched = apply(
        spark, ledger.empty_ledger(spark), [node()], scan_id=SCAN_1, scan_ts=TS_1
    )
    state = state.cache()
    state.count()
    return state, touched


# ------------------------------------------------------------------------- identity


def test_vuln_key_prefers_the_finding_id(spark):
    got = by_key(observed(spark, [node(id="f-42")]))
    assert list(got) == ["id:f-42"]


def test_vuln_key_falls_back_to_a_hash_of_the_semantic_identity(spark):
    """No finding id -- the same vuln on the same asset must still reconcile."""
    got = list(by_key(observed(spark, [node(id=None)])))
    assert len(got) == 1 and got[0].startswith("h:")
    # Stable across runs: the same inputs must produce the same key, or every scan would
    # look like a register of brand-new findings.
    again = list(by_key(observed(spark, [node(id=None)])))
    assert got == again


def test_vuln_key_distinguishes_the_same_cve_on_different_assets(spark):
    a = node(id=None, vulnerableAsset={"id": "vm-1", "name": "web-01", "type": "VM"})
    b = node(id=None, vulnerableAsset={"id": "vm-2", "name": "web-02", "type": "VM"})
    assert len(by_key(observed(spark, [a, b]))) == 2


def test_vuln_key_matches_the_reference_implementation(spark):
    """The surfaces must agree on identity, or their numbers are not comparable.

    ``gas/src/domain/lifecycle.ts::vulnKey`` is the standard; it cannot be imported from
    Python, but ``wiz_dashboard.domain.lifecycle.vuln_key`` is a line-for-line port of the
    same rule, so cross-checking against it catches drift in this port either way. Run over
    the committed Wiz response, so it is real payload shapes rather than invented ones.
    """
    lifecycle = pytest.importorskip(
        "wiz_dashboard.domain.lifecycle",
        reason="cross-check needs the repo root importable",
    )
    payload = json.loads(
        (REPO_ROOT / "os_vulns_response_exemple.json").read_text(encoding="utf-8")
    )
    from ingest import extract_nodes

    nodes = extract_nodes(payload)
    assert nodes, "fixture should contain findings"

    expected = {lifecycle.vuln_key(n) for n in nodes}
    got = set(by_key(observed(spark, nodes)))
    assert got == expected


# ------------------------------------------------------- conformance with the GAS fixture
#
# gas/test/fixtures/reconcile.json is the golden fixture the TypeScript reconciler is tested
# against: real input records, a prior ledger, and the exact expected ledger and deltas for
# six scenarios. Replaying it here is the strongest evidence available that this port agrees
# with the standard, because nothing about it was written to suit this implementation.

FIXTURE = REPO_ROOT / "gas" / "test" / "fixtures" / "reconcile.json"

# The fixture predates the vendor-fix and exploit-intelligence columns, and carries tags_json,
# which brick does not ingest. Comparison is therefore over the lifecycle fields it does
# specify -- which is precisely the part this fixture exists to pin down.
FIXTURE_FIELDS = [
    "vuln_key", "cve", "severity", "asset_id", "asset_name", "asset_type", "cloud",
    "subscription_name", "subscription_ext_id", "first_seen", "last_seen", "status",
    "resolved_at", "resolution_src", "reopened_count", "first_scan_id", "last_scan_id",
]


def _dotted(rec: dict, *keys):
    """The fixture's ``field()`` equivalent: dotted key, or the nested vulnerableAsset dict.

    The records mix both shapes on purpose. brick's own ingest only ever produces the nested
    one, but the reconciler must not care, and the fixture checks that it doesn't.
    """
    for k in keys:
        v = rec.get(k)
        if v not in (None, ""):
            return v
    va = rec.get("vulnerableAsset")
    if isinstance(va, dict):
        for k in keys:
            v = va.get(k.split(".")[-1])
            if v not in (None, ""):
                return v
    return None


def _observed_from_records(spark, records):
    """The fixture's records as an ``observed()`` frame, in input order.

    Built directly rather than through ``silver_findings``: the fixture deliberately includes
    flattened ``vulnerableAsset.id`` records that the Wiz API never returns and brick's JSON
    parse is not meant to handle. What is under test here is the reconciler.
    """
    rows = []
    for i, r in enumerate(records):
        status = str(r.get("status") or "")
        resolved = r.get("resolvedAt") or r.get("remediatedAt") or r.get("fixedAt")
        rows.append(
            {
                "seq": i,
                "finding_id": r.get("id"),
                "cve": r.get("name"),
                "component": _dotted(r, "detailedName", "detailedNameV2"),
                "severity_raw": r.get("severity"),
                "status": status,
                "first_detected_at": r.get("firstDetectedAt")
                or r.get("firstSeenAt")
                or r.get("createdAt"),
                "last_detected_at": r.get("lastDetectedAt"),
                "resolved_at": resolved,
                "asset_id": _dotted(r, "vulnerableAsset.id", "assetId"),
                "asset_name": _dotted(r, "vulnerableAsset.name"),
                "asset_type": _dotted(r, "vulnerableAsset.type", "type"),
                "cloud": _dotted(r, "vulnerableAsset.cloudPlatform", "cloudPlatform"),
                "subscription_name": _dotted(r, "vulnerableAsset.subscriptionName"),
                "subscription_ext_id": _dotted(
                    r, "vulnerableAsset.subscriptionExternalId", "vulnerableAsset.subscriptionId"
                ),
                "fix_date": r.get("fixDate"),
                "fixed_version": r.get("fixedVersion"),
                "has_kev": r.get("hasCisaKevExploit"),
                "has_exploit": r.get("hasExploit"),
                "epss": r.get("epssProbability"),
            }
        )
    schema = (
        "seq LONG, finding_id STRING, cve STRING, component STRING, severity_raw STRING, "
        "status STRING, first_detected_at STRING, last_detected_at STRING, "
        "resolved_at STRING, asset_id STRING, asset_name STRING, asset_type STRING, "
        "cloud STRING, subscription_name STRING, subscription_ext_id STRING, "
        "fix_date STRING, fixed_version STRING, has_kev BOOLEAN, has_exploit BOOLEAN, "
        "epss DOUBLE"
    )
    df = spark.createDataFrame(rows, schema) if rows else spark.createDataFrame([], schema)
    df = (
        df.withColumn("severity", metrics.normalize_severity(F.col("severity_raw")))
        .withColumn("is_open", metrics.is_open(F.col("status")))
        .withColumn("first_detected_at", F.col("first_detected_at").cast("timestamp"))
        .withColumn("last_detected_at", F.col("last_detected_at").cast("timestamp"))
        .withColumn("resolved_at", F.col("resolved_at").cast("timestamp"))
        .withColumn("fix_date", F.col("fix_date").cast("timestamp"))
        .drop("severity_raw")
    )
    return ledger.observed(df)


def _prior_from_fixture(spark, rows):
    """The fixture's prior ledger as a ledger frame, ISO strings cast to timestamps."""
    if not rows:
        return ledger.empty_ledger(spark)
    payload = []
    for r in rows.values():
        payload.append(
            {c: r.get(c) for c in FIXTURE_FIELDS if c not in ("reopened_count",)}
            | {"reopened_count": int(r.get("reopened_count") or 0)}
        )
    schema = ", ".join(
        f"{c} INT" if c == "reopened_count" else f"{c} STRING" for c in FIXTURE_FIELDS
    )
    df = spark.createDataFrame(payload, schema)
    for ts in ("first_seen", "last_seen", "resolved_at"):
        df = df.withColumn(ts, F.col(ts).cast("timestamp"))
    # Columns the fixture does not carry, at their empty values. Derived from the schema rather
    # than listed: GAS's fixture covers the lifecycle fields and brick's ledger has always held
    # a few more (scope, component, the fix clock, the risk signals, and now the
    # static-analysis inputs). A hand-written list here means every column added to the ledger
    # breaks the golden-fixture replay with an UNRESOLVED_COLUMN a hundred lines long.
    for field in ledger.LEDGER_SCHEMA.fields:
        if field.name not in df.columns:
            df = df.withColumn(field.name, F.lit(None).cast(field.dataType))
    return df.select(*[f.name for f in ledger.LEDGER_SCHEMA.fields])


def _iso(v):
    return v.strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(v, "strftime") else v


#: The golden scenarios, read once at import. Both the parametrize range and every case's body
#: want them, and re-reading the file per case parsed it seven times over.
SCENARIOS = json.loads(FIXTURE.read_text(encoding="utf-8"))["scenarios"]


@pytest.mark.parametrize("index", range(len(SCENARIOS)))
def test_matches_the_gas_reconcile_fixture(spark, index):
    """Replay one golden scenario and compare the resulting ledger and deltas exactly."""
    scenario = SCENARIOS[index]
    inp, expected = scenario["input"], scenario["expected"]
    options = inp.get("options") or {}

    touched = ledger.reconcile(
        _prior_from_fixture(spark, inp["ledger"]),
        _observed_from_records(spark, inp["records"]),
        scan_id=inp["scan_id"],
        scan_ts=inp["scan_ts"],
        scope="os",
        prev_scan_id=inp.get("prev_scan_id"),
        prev_scan_ts=options.get("prev_scan_ts"),
        prev_scan_id_by_severity=options.get("prev_scan_id_by_severity"),
        scanned_severities=options.get("scanned_severities"),
        disappearance=options.get("disappearance_mode", "scan_ts"),
    ).cache()

    # The fixture's expected ledger is the FULL post-scan state; reconcile returns only what
    # it touched, so untouched prior rows are carried over the way the MERGE will carry them.
    got = {r["vuln_key"]: r.asDict() for r in touched.drop(*ledger.CHANGE_COLUMNS).collect()}
    merged = {k: dict(v) for k, v in inp["ledger"].items()}
    merged.update(got)

    assert set(merged) == set(expected["ledger"]), scenario["name"]
    for key, want in expected["ledger"].items():
        have = merged[key]
        for field_name in FIXTURE_FIELDS:
            expected_value = want.get(field_name)
            if field_name == "reopened_count":
                expected_value = int(expected_value or 0)
            assert _iso(have.get(field_name)) == expected_value, (
                f"{scenario['name']} / {key} / {field_name}"
            )

    assert deltas(touched) == expected["deltas"], scenario["name"]


# ---------------------------------------------------------------------- lifecycle rules


def test_first_sighting_opens_a_lifecycle(spark):
    state, touched = apply(spark, ledger.empty_ledger(spark), [node()],
                           scan_id=SCAN_1, scan_ts=TS_1)
    row = by_key(state)["id:f-1"]
    assert row["status"] == STATUS_OPEN
    assert row["first_scan_id"] == SCAN_1 and row["last_scan_id"] == SCAN_1
    # first_seen is min(API firstDetectedAt, scan ts) -- the API's date is earlier here, and
    # taking the scan ts instead would erase a month of the finding's real age.
    assert row["first_seen"].strftime("%Y-%m-%d") == "2026-04-01"
    assert deltas(touched) == {"new_count": 1, "resolved_count": 0, "reopened_count": 0}


def test_a_finding_that_disappears_is_resolved(spark, first_scan):
    """THE v2 case. v1 could not see this at all.

    Wiz stops returning a finding once it is remediated and never sets resolvedAt. In v1 that
    vulnerability stayed open forever; here its absence from the next scan closes it.
    """
    state, _ = first_scan
    state, touched = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2,
                           prev_scan_id=SCAN_1, prev_scan_ts=TS_1)

    row = by_key(state)["id:f-1"]
    assert row["status"] == STATUS_RESOLVED
    assert row["resolution_src"] == "disappeared"
    assert row["resolved_at"].strftime("%Y-%m-%dT%H:%M:%SZ") == TS_2
    # It was NOT observed in scan 2, so last_seen must not advance -- claiming otherwise
    # would say we saw something we did not.
    assert row["last_seen"].strftime("%Y-%m-%dT%H:%M:%SZ") == TS_1
    assert row["last_scan_id"] == SCAN_1
    assert deltas(touched) == {"new_count": 0, "resolved_count": 1, "reopened_count": 0}


def test_disappearance_can_be_dated_at_the_midpoint(spark, first_scan):
    state, _ = first_scan
    state, _ = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1,
                     prev_scan_ts=TS_1, disappearance="midpoint")
    # Halfway through the 7-day gap between 05-01 and 05-08.
    assert by_key(state)["id:f-1"]["resolved_at"].strftime("%Y-%m-%d") == "2026-05-04"


def test_an_unscanned_severity_never_disappears(spark):
    """The guard that stops --severities=CRITICAL,HIGH from mass-resolving the register.

    A MEDIUM row absent from a scan that only asked for CRITICAL and HIGH has not been
    remediated -- nobody looked for it. Without this the first scoped scan would close every
    MEDIUM finding at once and report it as a triumph.
    """
    state, _ = apply(spark, ledger.empty_ledger(spark), [node(severity="MEDIUM")],
                     scan_id=SCAN_1, scan_ts=TS_1)
    state, touched = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2,
                           prev_scan_id=SCAN_1, scanned_severities=["CRITICAL", "HIGH"])

    assert by_key(state)["id:f-1"]["status"] == STATUS_OPEN
    assert deltas(touched)["resolved_count"] == 0


def test_a_severity_resolves_once_its_scope_returns(spark):
    """The other half of the scope guard: pausing a lifecycle must not lose it.

    MEDIUM goes unscanned in scan 2, then is covered again in scan 3 and is gone. It must
    resolve against the last scan that actually covered it, not be stuck open forever.
    """
    state, _ = apply(spark, ledger.empty_ledger(spark), [node(severity="MEDIUM")],
                     scan_id=SCAN_1, scan_ts=TS_1)
    state, _ = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1,
                     scanned_severities=["CRITICAL", "HIGH"])
    state, touched = apply(
        spark, state, [], scan_id=SCAN_3, scan_ts=TS_3, prev_scan_id=SCAN_2,
        scanned_severities=["CRITICAL", "HIGH", "MEDIUM"],
        # MEDIUM was last covered by scan 1, not by scan 2.
        prev_scan_id_by_severity={"MEDIUM": SCAN_1, "CRITICAL": SCAN_2, "HIGH": SCAN_2},
    )

    row = by_key(state)["id:f-1"]
    assert row["status"] == STATUS_RESOLVED and row["resolution_src"] == "disappeared"
    assert deltas(touched)["resolved_count"] == 1


def test_a_resolved_row_is_not_re_resolved(spark, first_scan):
    """Once closed, a finding's resolved_at is history and must not move.

    Guarded by status rather than by the previous-scan check -- see the next test for that one.
    """
    state, _ = first_scan
    state, _ = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    resolved_at = by_key(state)["id:f-1"]["resolved_at"]

    state, touched = apply(spark, state, [], scan_id=SCAN_3, scan_ts=TS_3, prev_scan_id=SCAN_2)
    assert by_key(state)["id:f-1"]["resolved_at"] == resolved_at
    assert deltas(touched)["resolved_count"] == 0


def test_a_row_that_missed_the_previous_scan_does_not_disappear(spark):
    """Only a finding in the immediately-previous *covering* scan can vanish from it.

    This isolates the ``last_scan_id == expected_prev`` guard, which the resolved-row case
    above never reaches. The finding is still OPEN and in scope, and is absent -- but its last
    sighting was scan 1 while the previous scan was scan 2, so scan 2 already had its chance to
    adjudicate the absence and declined (MEDIUM was out of scope then). Resolving it now, with
    no per-severity map to say otherwise, would be guessing.

    The conservative fallback is deliberate: ``reconcile.ts`` leaves such a row open rather
    than dating a resolution it cannot place. ``test_a_severity_resolves_once_its_scope_returns``
    is the same situation *with* the map, and there it does resolve.
    """
    state, _ = apply(spark, ledger.empty_ledger(spark), [node(severity="MEDIUM")],
                     scan_id=SCAN_1, scan_ts=TS_1)
    # Scan 2 covers CRITICAL/HIGH only: the MEDIUM row is exempt and stays OPEN at scan 1.
    state, _ = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1,
                     scanned_severities=["CRITICAL", "HIGH"])
    assert by_key(state)["id:f-1"]["last_scan_id"] == SCAN_1

    # Scan 3 covers MEDIUM again, but without a per-severity map the guard compares against
    # scan 2 -- which this row was never part of.
    state, touched = apply(spark, state, [], scan_id=SCAN_3, scan_ts=TS_3, prev_scan_id=SCAN_2,
                           scanned_severities=["CRITICAL", "HIGH", "MEDIUM"])

    assert by_key(state)["id:f-1"]["status"] == STATUS_OPEN
    assert deltas(touched)["resolved_count"] == 0


def test_nothing_disappears_on_the_very_first_scan(first_scan):
    """No previous scan means nothing has a "before" to have vanished from."""
    _, touched = first_scan
    assert deltas(touched)["resolved_count"] == 0


def test_api_resolution_closes_the_row(spark, first_scan):
    state, _ = first_scan
    state, touched = apply(
        spark, state,
        [node(status="RESOLVED", resolvedAt="2026-05-05T00:00:00Z")],
        scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1,
    )
    row = by_key(state)["id:f-1"]
    assert row["status"] == STATUS_RESOLVED
    assert row["resolution_src"] == "api"
    # The API's own date, not the scan's -- we know exactly when this one closed.
    assert row["resolved_at"].strftime("%Y-%m-%d") == "2026-05-05"
    assert deltas(touched)["resolved_count"] == 1


def test_a_re_listed_resolution_is_not_counted_twice(spark, first_scan):
    """The API repeating itself is not a second remediation."""
    resolved = node(status="RESOLVED", resolvedAt="2026-05-05T00:00:00Z")
    state, _ = first_scan
    state, _ = apply(spark, state, [resolved], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    state, touched = apply(spark, state, [resolved], scan_id=SCAN_3, scan_ts=TS_3,
                           prev_scan_id=SCAN_2)

    assert deltas(touched)["resolved_count"] == 0
    assert by_key(state)["id:f-1"]["resolved_at"].strftime("%Y-%m-%d") == "2026-05-05"


def test_a_reopen_starts_a_new_episode(spark, first_scan):
    """A resolved finding that is active again reopens, and its clock is recomputed.

    ``first_seen`` becomes ``min(API firstDetectedAt, scan ts)`` -- the same formula a first
    sighting uses, which is why the port needs no separate branch for it. Wiz still reports the
    original firstDetectedAt here, so the reopened episode inherits that date rather than
    starting at the reopen scan. That is the reference implementation's behaviour
    (``reconcile.py:218``), and the two surfaces have to agree.
    """
    state, _ = first_scan
    state, _ = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    state, touched = apply(spark, state, [node()], scan_id=SCAN_3, scan_ts=TS_3,
                           prev_scan_id=SCAN_2)

    row = by_key(state)["id:f-1"]
    assert row["status"] == STATUS_OPEN
    assert row["reopened_count"] == 1
    assert row["resolved_at"] is None and row["resolution_src"] is None
    assert row["first_seen"].strftime("%Y-%m-%d") == "2026-04-01"
    assert deltas(touched) == {"new_count": 0, "resolved_count": 0, "reopened_count": 1}


def test_a_reopen_recomputes_first_seen_rather_than_keeping_it(spark):
    """What "new episode" actually buys, stated as a difference from the persisting branch.

    A persisting row's ``first_seen`` is monotone-earliest and can never move later. A reopen
    is recomputed from the API instead, so the earliest-known chain is deliberately broken: the
    finding here was first seen on 03-01, and the reopened episode starts from the 04-01 the
    API now reports. Without that, the next resolution's MTTR would include the months the
    vulnerability was legitimately closed.
    """
    state, _ = apply(spark, ledger.empty_ledger(spark),
                     [node(firstDetectedAt="2026-03-01T00:00:00Z")],
                     scan_id=SCAN_1, scan_ts=TS_1)
    assert by_key(state)["id:f-1"]["first_seen"].strftime("%Y-%m-%d") == "2026-03-01"

    state, _ = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    state, _ = apply(spark, state, [node(firstDetectedAt="2026-04-01T00:00:00Z")],
                     scan_id=SCAN_3, scan_ts=TS_3, prev_scan_id=SCAN_2)

    assert by_key(state)["id:f-1"]["first_seen"].strftime("%Y-%m-%d") == "2026-04-01"


def test_first_seen_never_drifts_later(spark, first_scan):
    """Wiz revising firstDetectedAt forward must not shorten the finding's measured life."""
    state, _ = first_scan
    state, _ = apply(spark, state, [node(firstDetectedAt="2026-04-20T00:00:00Z")],
                     scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    assert by_key(state)["id:f-1"]["first_seen"].strftime("%Y-%m-%d") == "2026-04-01"


def test_first_seen_moves_earlier_when_the_api_learns_more(spark, first_scan):
    """Earliest-known, in both directions: a genuinely earlier date is new evidence."""
    state, _ = first_scan
    state, _ = apply(spark, state, [node(firstDetectedAt="2026-03-01T00:00:00Z")],
                     scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    assert by_key(state)["id:f-1"]["first_seen"].strftime("%Y-%m-%d") == "2026-03-01"


def test_persisting_advances_last_seen_only(spark, first_scan):
    state, _ = first_scan
    state, touched = apply(spark, state, [node()], scan_id=SCAN_2, scan_ts=TS_2,
                           prev_scan_id=SCAN_1)
    row = by_key(state)["id:f-1"]
    assert row["status"] == STATUS_OPEN
    assert row["last_seen"].strftime("%Y-%m-%dT%H:%M:%SZ") == TS_2
    assert row["last_scan_id"] == SCAN_2
    assert row["first_scan_id"] == SCAN_1
    assert deltas(touched) == {"new_count": 0, "resolved_count": 0, "reopened_count": 0}


def test_a_finding_born_resolved_is_both_new_and_resolved(spark):
    """One scan can open and close a lifecycle at once, and both deltas must count it.

    This is why the change flags are three booleans rather than one label.
    """
    _, touched = apply(
        spark, ledger.empty_ledger(spark),
        [node(status="RESOLVED", resolvedAt="2026-04-15T00:00:00Z")],
        scan_id=SCAN_1, scan_ts=TS_1,
    )
    assert deltas(touched) == {"new_count": 1, "resolved_count": 1, "reopened_count": 0}


def test_untouched_rows_are_not_republished(spark):
    """A row nobody observed and nobody resolved should not even reach the MERGE."""
    state, _ = apply(spark, ledger.empty_ledger(spark),
                     [node(id="f-1", severity="MEDIUM"), node(id="f-2")],
                     scan_id=SCAN_1, scan_ts=TS_1)
    _, touched = apply(spark, state, [node(id="f-2")], scan_id=SCAN_2, scan_ts=TS_2,
                       prev_scan_id=SCAN_1, scanned_severities=["CRITICAL", "HIGH"])
    # f-1 is MEDIUM and out of scope: exempt from disappearance, so untouched entirely.
    assert list(by_key(touched)) == ["id:f-2"]


# ------------------------------------------------------------ the risk-signal contract


def test_null_risk_signals_are_never_coerced_to_false(spark):
    """The correctness trap, at the ledger boundary this time.

    A finding whose exploit signals were never captured must stay unclassified all the way
    through -- calling it low risk inflates efficiency and deflates coverage at once.
    """
    unknown = node(hasCisaKevExploit=None, hasExploit=None, epssProbability=None)
    state, _ = apply(spark, ledger.empty_ledger(spark), [unknown], scan_id=SCAN_1, scan_ts=TS_1)
    row = by_key(state)["id:f-1"]
    assert row["has_kev"] is None and row["has_exploit"] is None and row["epss"] is None

    frame = ledger.lifecycle_frame(state, TS_2)
    from config import DEFAULT_RISK_RULE

    assert metrics.classify_risk(frame, DEFAULT_RISK_RULE).collect()[0]["risk_class"] == "unknown"


def test_a_previously_observed_signal_survives_a_scan_that_lost_it(spark):
    """Retaining a known value is not the same as manufacturing one.

    A scan that failed to capture EPSS is not evidence that the finding has no EPSS, and a
    disappeared finding can never be re-observed -- so the last thing we actually saw stands.
    """
    state, _ = apply(spark, ledger.empty_ledger(spark), [node(epssProbability=0.42)],
                     scan_id=SCAN_1, scan_ts=TS_1)
    state, _ = apply(spark, state, [node(epssProbability=None)], scan_id=SCAN_2, scan_ts=TS_2,
                     prev_scan_id=SCAN_1)
    assert by_key(state)["id:f-1"]["epss"] == pytest.approx(0.42)


def test_exploit_booleans_are_monotone(spark):
    """null -> false -> true, and never back down.

    The distinguishing case is true -> false: latest-observation-wins would demote the finding
    out of the high-risk population, and because the gold tables are APPENDED that would leave
    last week's published coverage disagreeing with this week's for a reason unrelated to any
    remediation. Exploit knowledge does not decay -- a CVE does not become un-exploited.
    """
    state, _ = apply(spark, ledger.empty_ledger(spark),
                     [node(hasCisaKevExploit=True, hasExploit=True)],
                     scan_id=SCAN_1, scan_ts=TS_1)
    state, _ = apply(spark, state, [node(hasCisaKevExploit=False, hasExploit=False)],
                     scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)

    row = by_key(state)["id:f-1"]
    assert row["has_kev"] is True
    assert row["has_exploit"] is True


def test_exploit_booleans_climb_from_false_to_true(spark):
    """The other direction is genuine news and must be taken."""
    state, _ = apply(spark, ledger.empty_ledger(spark), [node(hasCisaKevExploit=False)],
                     scan_id=SCAN_1, scan_ts=TS_1)
    assert by_key(state)["id:f-1"]["has_kev"] is False

    state, _ = apply(spark, state, [node(hasCisaKevExploit=True)], scan_id=SCAN_2,
                     scan_ts=TS_2, prev_scan_id=SCAN_1)
    assert by_key(state)["id:f-1"]["has_kev"] is True


def test_epss_keeps_the_peak_observed_value(spark):
    """EPSS genuinely decays, and peak is a deliberate choice.

    The question coverage asks is "was this something you should have prioritized", not "is it
    still scary today". Taking the latest value would let a finding drift out of the coverage
    denominator on its own.
    """
    state, _ = apply(spark, ledger.empty_ledger(spark), [node(epssProbability=0.42)],
                     scan_id=SCAN_1, scan_ts=TS_1)
    state, _ = apply(spark, state, [node(epssProbability=0.05)], scan_id=SCAN_2, scan_ts=TS_2,
                     prev_scan_id=SCAN_1)
    assert by_key(state)["id:f-1"]["epss"] == pytest.approx(0.42)

    state, _ = apply(spark, state, [node(epssProbability=0.77)], scan_id=SCAN_3, scan_ts=TS_3,
                     prev_scan_id=SCAN_2)
    assert by_key(state)["id:f-1"]["epss"] == pytest.approx(0.77)


def test_risk_signals_are_not_reset_by_a_reopen(spark):
    """Exploit availability belongs to the vulnerability, not to the episode.

    This is the explicit divergence from the vendor-fix clock, which does reset -- see
    ``test_the_fix_clock_resets_on_reopen``.
    """
    state, _ = apply(spark, ledger.empty_ledger(spark), [node(hasCisaKevExploit=True)],
                     scan_id=SCAN_1, scan_ts=TS_1)
    state, _ = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    state, _ = apply(spark, state, [node(hasCisaKevExploit=None)], scan_id=SCAN_3,
                     scan_ts=TS_3, prev_scan_id=SCAN_2)

    row = by_key(state)["id:f-1"]
    assert row["reopened_count"] == 1
    assert row["has_kev"] is True


def test_risk_observed_at_keeps_the_earliest_witnessing_scan(spark, first_scan):
    state, _ = first_scan
    state, _ = apply(spark, state, [node()], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    assert by_key(state)["id:f-1"]["risk_observed_at"].strftime("%Y-%m-%dT%H:%M:%SZ") == TS_1


def test_a_scan_carrying_no_signals_does_not_witness_anything(spark):
    """risk_observed_at dates the first real signal, not the first sighting."""
    blind = node(hasCisaKevExploit=None, hasExploit=None, epssProbability=None)
    state, _ = apply(spark, ledger.empty_ledger(spark), [blind], scan_id=SCAN_1, scan_ts=TS_1)
    assert by_key(state)["id:f-1"]["risk_observed_at"] is None

    state, _ = apply(spark, state, [node()], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    assert by_key(state)["id:f-1"]["risk_observed_at"].strftime("%Y-%m-%dT%H:%M:%SZ") == TS_2


# ------------------------------------------------------------------ the vendor-fix clock
#
# Nothing in v2 reads these columns yet -- the actionable clock is out of scope. They are
# captured because they cannot be recovered afterwards: once a finding disappears from the
# API, a fix signal nobody wrote down is gone for good.


def test_the_fix_clock_is_sticky_first_wins(spark):
    """The first moment a fix was known to exist is the one worth keeping."""
    state, _ = apply(spark, ledger.empty_ledger(spark),
                     [node(fixDate="2026-04-10T00:00:00Z", fixedVersion="1.2.3")],
                     scan_id=SCAN_1, scan_ts=TS_1)
    row = by_key(state)["id:f-1"]
    assert row["fix_date"].strftime("%Y-%m-%d") == "2026-04-10"
    assert row["fix_observed_at"].strftime("%Y-%m-%dT%H:%M:%SZ") == TS_1

    # A later scan reporting a different fix date must not overwrite the original.
    state, _ = apply(spark, state, [node(fixDate="2026-04-20T00:00:00Z", fixedVersion="1.2.4")],
                     scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    row = by_key(state)["id:f-1"]
    assert row["fix_date"].strftime("%Y-%m-%d") == "2026-04-10"
    assert row["fix_observed_at"].strftime("%Y-%m-%dT%H:%M:%SZ") == TS_1


def test_fix_observed_at_records_a_version_with_no_date(spark):
    """A fixedVersion is a fix signal even when the API gives no fixDate."""
    state, _ = apply(spark, ledger.empty_ledger(spark), [node(fixedVersion="1.2.3")],
                     scan_id=SCAN_1, scan_ts=TS_1)
    row = by_key(state)["id:f-1"]
    assert row["fix_date"] is None
    assert row["fix_observed_at"].strftime("%Y-%m-%dT%H:%M:%SZ") == TS_1


def test_a_finding_with_no_fix_signal_records_nothing(first_scan):
    state, _ = first_scan
    row = by_key(state)["id:f-1"]
    assert row["fix_date"] is None and row["fix_observed_at"] is None


def test_the_fix_clock_resets_on_reopen(spark):
    """The previous episode's fix says nothing about this one.

    The divergence from the risk signals, which survive a reopen untouched.
    """
    fixed = node(fixDate="2026-04-10T00:00:00Z", fixedVersion="1.2.3")
    state, _ = apply(spark, ledger.empty_ledger(spark), [fixed], scan_id=SCAN_1, scan_ts=TS_1)
    state, _ = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)
    # Reopens with no fix signal at all: the old fix must not carry over.
    state, _ = apply(spark, state, [node()], scan_id=SCAN_3, scan_ts=TS_3, prev_scan_id=SCAN_2)

    row = by_key(state)["id:f-1"]
    assert row["reopened_count"] == 1
    assert row["fix_date"] is None and row["fix_observed_at"] is None


# ------------------------------------------------------------------ the metric contract


def test_reconcile_emits_exactly_the_ledger_columns(spark):
    """The MERGE uses ``UPDATE SET *`` / ``INSERT *``, which match the source to the target by
    name. A column added to one side and not the other fails on the warehouse, not here --
    unless here.
    """
    from config import LEDGER_COLUMNS

    _, touched = apply(spark, ledger.empty_ledger(spark), [node()],
                       scan_id=SCAN_1, scan_ts=TS_1)
    assert touched.columns == LEDGER_COLUMNS + ledger.CHANGE_COLUMNS
    assert [f.name for f in ledger.LEDGER_SCHEMA.fields] == LEDGER_COLUMNS


def test_lifecycle_frame_matches_the_silver_contract(first_scan):
    """metrics.py runs unchanged against the ledger only if the columns line up exactly."""
    state, _ = first_scan
    frame = set(ledger.lifecycle_frame(state, TS_2).columns)
    silver_contract = {
        "severity", "first_detected_at", "last_detected_at", "resolved_at", "is_open",
        "mttr_days", "age_days", "has_kev", "has_exploit", "epss", "cve", "component",
        "asset_id", "asset_name", "asset_type", "cloud", "subscription_name", "scope",
    }
    missing = silver_contract - frame
    assert not missing, f"lifecycle_frame is missing {sorted(missing)}"


def test_mttr_is_measured_from_the_ledgers_own_dates(spark, first_scan):
    """The payoff: a disappearance-resolved finding contributes a real MTTR.

    Under v1 this finding has no resolvedAt, so it contributes nothing to MTTR and sits in the
    open backlog forever. Here it closes at scan 2 and measures 37 days from 2026-04-01.
    """
    state, _ = first_scan
    state, _ = apply(spark, state, [], scan_id=SCAN_2, scan_ts=TS_2, prev_scan_id=SCAN_1)

    frame = ledger.lifecycle_frame(state, TS_2)
    row = frame.collect()[0]
    assert row["mttr_days"] == pytest.approx(37.0)
    assert row["is_open"] is False
    assert row["age_days"] is None


def test_open_findings_carry_an_age_and_no_mttr(first_scan):
    state, _ = first_scan
    row = ledger.lifecycle_frame(state, TS_2).collect()[0]
    assert row["mttr_days"] is None
    assert row["age_days"] == pytest.approx(37.0)


def test_duplicates_within_one_scan_collapse_to_one_row(spark):
    """Wiz repeating a finding across page boundaries must not double-count it."""
    got = observed(spark, [node(), node()])
    assert got.count() == 1


def test_a_duplicate_pair_resolves_to_the_open_row(spark):
    """When a scan disagrees with itself, believe the more conservative half."""
    got = observed(
        spark, [node(status="RESOLVED", resolvedAt="2026-05-05T00:00:00Z"), node()]
    )
    assert got.count() == 1
    assert got.collect()[0]["is_open"] is True
