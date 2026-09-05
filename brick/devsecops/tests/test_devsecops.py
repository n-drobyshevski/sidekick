"""The code registers: the ``sca`` scope, the ``sast`` source, and P2P v5's asset family.

Three things are being pinned here, and they fail differently:

* **``sca`` needs no new maths.** It reads the same GraphQL connection ``os`` does, so the whole
  P2P stack applies unchanged. The test for that is that its filter is right and its findings
  project through the ordinary silver path -- if either drifts, the register measures the wrong
  population and every number stays plausible.
* **``sast`` is a second node shape behind the same column contract.** Its projection must emit
  exactly the columns the CVE one does, because that is what keeps ``ledger.py`` unaware there
  are two sources. A missing column is an error; an extra one is a schema mismatch on the
  MERGE, days later.
* **The static-analysis rule is ours, and its edges are where it goes wrong.** The CWE hierarchy
  gap and the never-captured-is-not-negative rule both have their own tests, because both fail
  as confident numbers rather than as exceptions.

The fixtures are the committed captures in ``brick/devsecops/``, which are this tenant's real
responses -- so the shapes here are the shapes the API actually returns.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

pytest.importorskip(
    "pyspark", reason="brick tests need pyspark: pip install -r brick/requirements.txt"
)

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

from pyspark.sql import functions as F  # noqa: E402

import ingest  # noqa: E402
import metrics  # noqa: E402
from config import (  # noqa: E402
    CWE_ANCESTORS,
    DEFAULT_RISK_RULE,
    DEFAULT_SAST_RISK_RULE,
    EXPLOITED_CWES,
    LEDGER_COLUMNS,
    SastRiskRule,
    rule_for_scope,
)

#: The reference queries and captured responses sit beside the modules in this fork, not in a
#: subdirectory of them -- this IS the devsecops directory.
DEVSECOPS = BRICK_DIR
SCAN_TS = "2026-08-01T00:00:00Z"


def sast_nodes():
    payload = json.loads((DEVSECOPS / "sast_response.json").read_text())
    return ingest.extract_nodes(payload)


def sca_nodes():
    payload = json.loads((DEVSECOPS / "sca_response.json").read_text())
    return ingest.extract_nodes(payload)


def bronze(spark, nodes, scope):
    rows = [("scan-1", SCAN_TS, scope, i, json.dumps(n)) for i, n in enumerate(nodes)]
    return spark.createDataFrame(
        rows, "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"
    ).withColumn("scan_ts", F.col("scan_ts").cast("timestamp"))


# --------------------------------------------------------------------- the captured shapes


def test_the_committed_captures_are_readable_json():
    """They were committed as ``.py`` files holding JSON, which cannot be imported at all --
    `null` and `false` are not Python. Renamed, and pinned so they stay that way."""
    assert len(sast_nodes()) == 40
    assert len(sca_nodes()) == 10


def test_extract_nodes_finds_the_sast_connection():
    """``sastFindings`` is a connection ``extract_nodes`` has never seen by name. It falls back
    to "any connection under ``data``", which is what makes a second source free here."""
    nodes = sast_nodes()
    assert nodes[0]["resource"]["type"] == "REPOSITORY_BRANCH"
    assert nodes[0]["weaknesses"][0]["id"].startswith("CWE-")


# -------------------------------------------------------------------------- the sast source


def test_both_projections_emit_the_same_columns(spark):
    """**The invariant the whole design rests on.**

    ``ledger.py`` reconciles whatever silver hands it, by column name, and knows nothing about
    sources. A column present in one projection and not the other surfaces as a Delta schema
    mismatch on the MERGE -- long after ingest, naming neither the source nor the column.
    """
    from ingest import extract_nodes

    cve = metrics.silver_findings(bronze(spark, sca_nodes(), "sca"), "sca")
    sast = metrics.silver_findings(bronze(spark, sast_nodes(), "sast"), "sast")
    assert cve.columns == sast.columns
    assert extract_nodes  # imported for the module's own use above; keeps linters quiet


def test_the_sast_projection_maps_the_fields_it_reuses(spark):
    """Three silver columns mean something adjacent for SAST, and the mapping is deliberate --
    see ``metrics.silver_sast``. Pinned so a later reader cannot 'fix' one of them."""
    frame = metrics.silver_findings(bronze(spark, sast_nodes(), "sast"), "sast")
    row = frame.where(F.col("cve") == "SQL Injection").first()
    assert row is not None
    assert row["component"].endswith(".java")          # filePath, not a package name
    assert row["asset_type"] == "REPOSITORY_BRANCH"    # resource, not vulnerableAsset
    assert row["language"] == "JAVA"


def test_the_sast_projection_leaves_the_cve_signals_null(spark):
    """Not false. Under ``RiskRule`` every SAST finding is therefore `unknown`, which is the
    honest reading -- and the reason ``SastRiskRule`` exists rather than being a nicety."""
    frame = metrics.silver_findings(bronze(spark, sast_nodes(), "sast"), "sast")
    nulls = frame.where(
        F.col("has_kev").isNotNull()
        | F.col("has_exploit").isNotNull()
        | F.col("epss").isNotNull()
    )
    assert nulls.count() == 0

    classified = metrics.classify_risk(frame, DEFAULT_RISK_RULE)
    assert classified.where(F.col("risk_class") != "unknown").count() == 0


def test_weaknesses_become_a_sorted_comma_separated_string(spark):
    """An array survives neither the CSV register nor a spreadsheet, and the ledger MERGE
    compares this value against the previous scan's -- so the same set must always render the
    same way."""
    frame = metrics.silver_findings(bronze(spark, sast_nodes(), "sast"), "sast")
    values = {r["cwe"] for r in frame.select("cwe").distinct().collect()}
    assert "CWE-79" in values
    for value in values:
        assert value is None or value == ",".join(sorted(value.split(",")))


def test_the_ledger_carries_the_static_analysis_inputs():
    """They cannot be recovered afterwards: a finding resolved by disappearance is gone from
    the API, so a signal not written down at observation time is lost. Same argument as
    ``has_kev``, and the same place to keep it."""
    for column in ("cwe", "language", "ai_verdict"):
        assert column in LEDGER_COLUMNS


# ------------------------------------------------------------------ the static-analysis rule


def sast_row(spark, **over):
    base = {
        "vuln_key": "id:w-1",
        "cwe": None,
        "ai_verdict": None,
        "severity": "HIGH",
        "is_open": True,
    }
    base.update(over)
    return spark.createDataFrame(
        [base],
        "vuln_key STRING, cwe STRING, ai_verdict STRING, severity STRING, is_open BOOLEAN",
    )


def verdict(spark, rule=DEFAULT_SAST_RISK_RULE, **over):
    return metrics.classify_risk(sast_row(spark, **over), rule).first()["risk_class"]


def test_a_top_25_weakness_is_high_risk(spark):
    assert verdict(spark, cwe="CWE-89") == "high"


def test_a_child_weakness_is_lifted_to_its_top_25_ancestor(spark):
    """The weakest joint in the rule, so it has the most explicit test.

    Scanners report leaves and the Top 25 holds interior nodes: the committed SAST capture
    contains CWE-23 (Relative Path Traversal), a child of Top-25 member CWE-22. Without the
    ancestor hop it would classify `low`, and a path traversal reading as not-high-risk is
    exactly the kind of wrong that never looks wrong.
    """
    assert "CWE-23" not in EXPLOITED_CWES
    assert CWE_ANCESTORS["CWE-23"] == "CWE-22"
    assert verdict(spark, cwe="CWE-23") == "high"


def test_an_unmapped_weakness_is_low_and_is_counted(spark):
    """``config.CWE_ANCESTORS`` is deliberately incomplete, so this case is normal rather than
    exceptional -- and it costs coverage's numerator silently. ``signal_breakdown`` publishes
    ``cwe_unmapped`` precisely so the size of that gap is on the page.

    Isolated to the CWE clause. Under the full rule the same row reads `unknown` instead,
    because the AI verdict was never captured -- which is correct, and is the next test.
    """
    cwe_only = SastRiskRule(cwe=True, ai_verdict=False, critical=False)
    assert verdict(spark, cwe_only, cwe="CWE-99999") == "low"
    assert verdict(spark, cwe_only, cwe="CWE-89") == "high"

    frame = metrics.classify_risk(sast_row(spark, cwe="CWE-99999"), cwe_only)
    breakdown = metrics.signal_breakdown(frame, cwe_only).first()
    assert breakdown["cwe_unmapped"] == 1
    assert breakdown["cwe"] == 0


def test_one_missing_signal_makes_the_whole_row_unknown(spark):
    """Step 2 of ``classify_risk`` beating step 3, on the static-analysis rule.

    A weakness that matched nothing and a severity that is not CRITICAL are both observed
    negatives -- but the AI verdict was never captured, so this row is not evidence of low
    risk. Calling it low is exactly how a naive implementation over-states efficiency, and the
    unclassified population is what the published ``_lo`` / ``_hi`` bounds are made of.
    """
    assert verdict(spark, cwe="CWE-99999") == "unknown"
    assert verdict(spark, cwe="CWE-99999", ai_verdict="NOT_EXPLOITABLE") == "low"


def test_a_finding_with_no_signal_at_all_is_unknown(spark):
    """The module header's correctness trap, applied to the second rule. A weakness nobody
    classified, no AI verdict and an UNKNOWN severity is not evidence of low risk."""
    assert verdict(spark, severity="UNKNOWN") == "unknown"


def test_severity_alone_decides_when_it_is_the_only_signal_observed(spark):
    """A CRITICAL with nothing else captured is `high` -- positive evidence stands on its own,
    whatever else is missing. That is step 1 of ``classify_risk`` beating step 2, and it is the
    ordering the whole three-valued scheme depends on."""
    assert verdict(spark, severity="CRITICAL") == "high"
    # ...but a HIGH with nothing else captured is unknown, not low: the other two clauses are
    # enabled and neither was observed.
    assert verdict(spark, severity="HIGH") == "unknown"


def test_an_ai_verdict_fires_and_an_unrecognised_one_does_not(spark):
    assert verdict(spark, ai_verdict="EXPLOITABLE", cwe="CWE-99999") == "high"
    assert verdict(spark, ai_verdict="NOT_EXPLOITABLE", cwe="CWE-99999") == "low"


def test_an_empty_rule_classifies_nothing(spark):
    """Honest state beats a hidden fallback to the default rule -- the same behaviour
    ``RiskRule`` has, and for the same reason."""
    empty = SastRiskRule(cwe=False, ai_verdict=False, critical=False)
    assert empty.is_empty()
    assert verdict(spark, empty, cwe="CWE-89") == "unknown"


def test_the_rule_is_chosen_by_scope():
    """Getting this wrong is not an error, it is a full page of plausible numbers: the CVE rule
    over a SAST register reports 100% unclassified and looks like missing data."""
    assert rule_for_scope("sca") is DEFAULT_RISK_RULE
    assert rule_for_scope("sast") is DEFAULT_SAST_RISK_RULE
    # An unknown scope falls back to the CVE rule rather than raising, which is right: the
    # caller that would raise is `resolve_scope`, one layer up, and it already has.
    assert rule_for_scope("nope") is DEFAULT_RISK_RULE


def test_the_sensitivity_sweep_follows_the_rule_it_is_given(spark):
    """Seven subsets either way, over the right three signals, with exactly one marked active.

    The table matters more for SAST than for the CVE registers, not less -- that rule reads a
    weakness class and a severity somebody typed, so "how much of this is the rule" is the
    first question to ask of any figure it produces.
    """
    frame = metrics.classify_risk(
        sast_row(spark, cwe="CWE-89", severity="CRITICAL"), DEFAULT_SAST_RISK_RULE
    )
    sweep = metrics.rule_sensitivity(frame, DEFAULT_SAST_RISK_RULE).collect()
    assert len(sweep) == 7
    assert sum(1 for r in sweep if r["active"]) == 1
    assert {r["rule_label"] for r in sweep} >= {"CWE only", "AI verdict only", "All three"}
    # The SAST flags, not the CVE ones -- the two shapes never share a table.
    assert "rule_cwe" in sweep[0].asDict()
    assert "rule_kev" not in sweep[0].asDict()


# ------------------------------------------------------------------------- the sca scope


def test_the_sca_filter_targets_the_code_stage_of_the_default_branch(spark):
    got = ingest.build_filter("sca")
    assert got["codeToCloudPipelineStage"] == ["CODE"]
    assert got["isDefaultBranch"] == {"equals": True}
    assert got["status"] == ["OPEN", "RESOLVED"]


def test_sca_asks_for_the_two_asset_members_it_actually_returns():
    """``config.FETCH_ASSET_FIELDS`` is off because a union member this tenant lacks fails the
    whole request. That is an argument for asking for fewer members, not none -- and the
    committed SCA capture is the evidence that these two resolve."""
    members = ingest.asset_members("sca")
    assert members == ("VulnerableAssetBase", "VulnerableAssetRepositoryBranch")
    # A scope with no override falls back to FETCH_ASSET_FIELDS, which is off -- so the
    # narrowing is an explicit statement about `sca`, not a default that happens to apply.
    assert ingest.asset_members("sast") == ()

    query = ingest.query_for("sca")
    assert "... on VulnerableAssetRepositoryBranch" in query
    # The eleven members this register never returns are not asked for, which is the whole
    # reason the request survives where brick's would not.
    assert "... on VulnerableAssetVirtualMachine" not in query
    # The ecosystem column P2P v5 groups on, asked for only where it is read.
    assert "codeLibraryLanguage" in query


def test_a_source_that_cannot_filter_severity_filters_it_here_instead():
    """``--severities`` is recorded in the scan log and drives the disappearance guard, so a run
    that ingested MEDIUM rows while claiming to have scanned CRITICAL,HIGH would hand the next
    reconcile a scope its own data contradicts. If ``SASTFindingFilters`` turns out to have no
    `severity` key, this is what keeps the two honest."""
    keep = ingest._severity_gate(["CRITICAL", "HIGH"])
    assert keep({"severity": "HIGH"}) is True
    assert keep({"severity": "MEDIUM"}) is False
    # `originalSeverity` is the same fallback `silver_sast` reads, so the gate and the
    # projection cannot disagree about what a node's severity is.
    assert keep({"severity": None, "originalSeverity": "CRITICAL"}) is True
    # Neither: kept, and lands as UNKNOWN. A row somebody can see beats a row nobody can.
    assert keep({"severity": None}) is True
    # An unscoped run has nothing to gate on.
    assert ingest._severity_gate([]) is None


def sast_node(**over):
    """A minimal ``sastFindings`` node -- the fields ``silver_sast`` reads and nothing else."""
    node = {
        "id": "f-1",
        "name": "SQL Injection",
        "status": "OPEN",
        "severity": "HIGH",
        "filePath": "a/B.java",
        "weaknesses": [{"id": "CWE-89"}],
        "resource": {"id": "r1", "name": "org/repo/main", "type": "REPOSITORY_BRANCH"},
    }
    node.update(over)
    return node


def test_the_sast_query_selects_the_birth_date():
    """``createdAt`` has to be in BOTH places or it reads NULL and nothing complains.

    Two independent halves: the GraphQL document decides whether the field arrives in bronze,
    and ``SAST_NODE_SCHEMA`` decides whether ``from_json`` keeps it. Drop either and
    ``first_detected_at`` is silently NULL for every SAST row -- the ledger falls back to
    observation, every figure still renders, and the register quietly goes back to dating its
    findings from when we happened to look.
    """
    assert "createdAt" in ingest.SAST_QUERY
    assert "createdAt" in metrics.SAST_NODE_SCHEMA.fieldNames()


def test_asking_sast_for_resolved_findings_would_report_its_age_as_its_mttr(spark):
    """**Why ``config.SAST_FETCH_RESOLVED`` is off, measured rather than asserted.**

    This test used to be named ``..._would_report_zero_day_mttr`` and it encoded a claim that
    has since been falsified. The claim was that ``ingest.SAST_QUERY`` selects no timestamps,
    so an already-resolved finding is born and closed in the same instant and reports exactly
    0.0 days. A live probe against the tenant (2026-08-27, recorded in the repo's CLAUDE.md)
    found ``SASTFinding.createdAt`` -- a non-null ``DateTime!``, filterable and sortable -- and
    the query now selects it, so the old arithmetic no longer runs.

    The conclusion survives; the number moves, and moves in the worse direction. There is still
    no ``resolvedAt`` on the type, so an API-resolved finding lands:

        first_seen  = least(coalesce(createdAt, now), now) = createdAt
        resolved_at = coalesce(NULL, now)                  = now
        mttr_days   = now - createdAt = the finding's AGE at the moment we first looked

    A flat 0.0 at least looks broken. This looks like a measurement: a weakness fixed within a
    day two years ago reports 730 days, and the Kaplan-Meier median is set by the register's own
    start date rather than by any remediation programme. One end is measured, the other is
    fabricated, and the difference between them measures neither.

    (The second live reason is not visible from here: ``status: RESOLVED`` returns zero rows
    against this tenant, so the filter would not even deliver the population it appears to ask
    for. Both reasons are in ``config.SAST_FETCH_RESOLVED``.)

    Turn the flag on if a ``resolvedAt`` appears on the type -- not before.
    """
    import datetime as dt

    import ledger as ledger_mod
    from config import SAST_FETCH_RESOLVED

    # 30 days before SCAN_TS, which is 2026-08-01.
    created_at = "2026-07-02T00:00:00Z"
    node = sast_node(id="f-resolved", status="RESOLVED", createdAt=created_at)
    silver = metrics.silver_findings(bronze(spark, [node], "sast"), "sast")
    touched = ledger_mod.reconcile(
        ledger_mod.empty_ledger(spark),
        ledger_mod.observed(silver),
        scan_id="scan-1",
        scan_ts=SCAN_TS,
        scope="sast",
    )
    row = touched.first()
    assert row["status"] == "RESOLVED"
    # The birth date is the API's. The death date is this scan, because there is nothing else
    # to read -- and `api`, so nothing downstream flags it as an inference a reader might
    # discount.
    assert row["first_seen"] == dt.datetime(2026, 7, 2)
    assert row["resolved_at"] == dt.datetime(2026, 8, 1)
    assert row["resolution_src"] == "api"

    ledger_rows = touched.select(*ledger_mod.LEDGER_SCHEMA.fieldNames())
    mttr = ledger_mod.lifecycle_frame(ledger_rows, SCAN_TS).first()["mttr_days"]
    # 30 days: the age, not a remediation time, and emphatically not the old 0.0.
    assert mttr == pytest.approx(30.0)
    assert mttr != 0.0

    # ...which is why the register does not ask for these findings in the first place.
    assert SAST_FETCH_RESOLVED is False
    assert "status" not in ingest.build_filter("sast")


def test_sast_first_seen_prefers_the_api_birth_date_over_the_scan(spark):
    """**The payoff.** A SAST finding resolved by disappearance now reports a real MTTR.

    Two scans a day apart, over a finding the API says was created 30 days before the first.
    The second scan does not return it, so ``reconcile`` resolves it by absence. If
    ``first_seen`` came from observation -- the old behaviour, when the query selected no
    timestamps -- this would report ~1 day: the scan interval, and nothing about the weakness.
    It reports ~31 instead, which is the 30 days the finding existed before anybody looked plus
    the interval within which it went away.

    The death date is still an upper bound whose error is the scan interval, which is what
    ``resolution_src = 'disappeared'`` is for. The birth date is not an estimate at all.
    """
    import datetime as dt

    import ledger as ledger_mod

    created_at = "2026-07-02T00:00:00Z"  # 30 days before scan 1
    scan_2_ts = "2026-08-02T00:00:00Z"  # one day after scan 1

    node = sast_node(createdAt=created_at)
    silver = metrics.silver_findings(bronze(spark, [node], "sast"), "sast")
    after_1 = ledger_mod.reconcile(
        ledger_mod.empty_ledger(spark),
        ledger_mod.observed(silver),
        scan_id="scan-1",
        scan_ts=SCAN_TS,
        scope="sast",
    ).select(*ledger_mod.LEDGER_SCHEMA.fieldNames())

    first = after_1.first()
    assert first["first_seen"] == dt.datetime(2026, 7, 2)
    assert first["status"] == "OPEN"

    # Scan 2 sees nothing at all -- the truncation that makes the disappearance pass fire.
    empty = metrics.silver_findings(bronze(spark, [], "sast"), "sast")
    after_2 = ledger_mod.reconcile(
        after_1,
        ledger_mod.observed(empty),
        scan_id="scan-2",
        scan_ts=scan_2_ts,
        scope="sast",
        prev_scan_id="scan-1",
    )
    row = after_2.first()
    assert row["status"] == "RESOLVED"
    assert row["resolution_src"] == "disappeared"
    # Not re-derived from the second scan: the birth date the API gave us, unchanged.
    assert row["first_seen"] == dt.datetime(2026, 7, 2)
    assert row["resolved_at"] == dt.datetime(2026, 8, 2)

    ledger_rows = after_2.select(*ledger_mod.LEDGER_SCHEMA.fieldNames())
    mttr = ledger_mod.lifecycle_frame(ledger_rows, scan_2_ts).first()["mttr_days"]
    assert mttr == pytest.approx(31.0)


def test_a_sast_node_with_no_created_at_still_lands(spark):
    """The committed capture predates the column, and that is the retroactivity case.

    Bronze holds only the fields the query asked for, so a scan taken before ``createdAt`` was
    selected -- and every node in ``sast_response.json`` -- projects ``first_detected_at`` as
    NULL. Nothing may break on that: the ledger falls back to the observation date, exactly as
    it did before this column existed. If this test ever fails it means the projection started
    requiring a field that half the register's history does not have.
    """
    import ledger as ledger_mod

    nodes = sast_nodes()
    silver = metrics.silver_findings(bronze(spark, nodes, "sast"), "sast")
    assert silver.count() == len(nodes)
    # Every one of them, not merely "some": the fixture has no `createdAt` anywhere in it, so
    # this also pins the gold built from it as unmoved by this change.
    assert silver.where(F.col("first_detected_at").isNotNull()).count() == 0

    touched = ledger_mod.reconcile(
        ledger_mod.empty_ledger(spark),
        ledger_mod.observed(silver),
        scan_id="scan-1",
        scan_ts=SCAN_TS,
        scope="sast",
    )
    assert touched.count() == len(nodes)
    # Observation, because there is nothing better to fall back to.
    assert touched.where(F.col("first_seen") != F.lit(SCAN_TS).cast("timestamp")).count() == 0


def test_each_scope_queries_its_own_connection():
    assert "vulnerabilityFindings(" in ingest.query_for("sca")
    assert "sastFindings(" in ingest.query_for("sast")
    with pytest.raises(RuntimeError, match="unknown scope"):
        ingest.query_for("nope")


# ------------------------------------------------------------------- P2P v5: assets at risk


def lifecycle_rows(spark, rows):
    """A minimal lifecycle frame -- the columns ``asset_profile`` reads and nothing else."""
    return spark.createDataFrame(
        rows,
        "vuln_key STRING, asset_id STRING, language STRING, severity STRING, "
        "first_detected_at TIMESTAMP, resolved_at TIMESTAMP, is_open BOOLEAN, "
        "mttr_days DOUBLE, age_days DOUBLE, risk_class STRING",
    )


def v5_frame(spark):
    """Two Java repos and one Python one, with a hand-countable shape.

      repo-a  JAVA    3 open (2 high), 1 resolved high   -> foothold, coverage 1/3
      repo-b  JAVA    1 open low                          -> no foothold, no coverage
      repo-c  PYTHON  2 open high                         -> foothold, coverage 0/2
    """
    import datetime as dt

    def ts(day):
        return dt.datetime(2026, 1, day)

    rows = [
        ("id:1", "repo-a", "JAVA", "HIGH", ts(1), None, True, None, 200.0, "high"),
        ("id:2", "repo-a", "JAVA", "HIGH", ts(1), None, True, None, 200.0, "high"),
        ("id:3", "repo-a", "JAVA", "HIGH", ts(1), None, True, None, 200.0, "low"),
        ("id:4", "repo-a", "JAVA", "HIGH", ts(1), ts(11), False, 10.0, None, "high"),
        ("id:5", "repo-b", "JAVA", "HIGH", ts(1), None, True, None, 200.0, "low"),
        ("id:6", "repo-c", "PYTHON", "HIGH", ts(1), None, True, None, 200.0, "high"),
        ("id:7", "repo-c", "PYTHON", "HIGH", ts(1), None, True, None, 200.0, "high"),
    ]
    return lifecycle_rows(spark, rows)


def by_group(frame, population="all"):
    return {
        r["asset_group"]: r.asDict()
        for r in frame.where(F.col("population") == population).collect()
    }


def test_there_is_exactly_one_row_per_group_and_population(spark):
    """The grain, asserted directly, because every other test in this block reads the frame
    through a dict keyed on ``asset_group`` -- which collapses a duplicate silently.

    That is not hypothetical: ``kaplan_meier`` emits its own OVERALL row, so unioning a second
    one produced two OVERALL rows per population and nothing here noticed.
    """
    frame = metrics.asset_profile_populations(v5_frame(spark), SCAN_TS)
    keys = [(r["asset_group"], r["population"]) for r in frame.collect()]
    assert len(keys) == len(set(keys)), sorted(keys)
    assert sorted(k for k, p in keys if p == "all") == ["JAVA", "OVERALL", "PYTHON"]


def test_density_is_open_findings_per_asset(spark):
    """v5 Fig 10. Percentiles rather than a mean, because the distribution is far too skewed
    for a mean to describe -- v5's own sample runs from under 10 to over 1000 per asset."""
    groups = by_group(metrics.asset_profile_populations(v5_frame(spark), SCAN_TS))
    assert groups["JAVA"]["assets"] == 2
    # repo-a has 3 open, repo-b has 1: median 2.
    assert groups["JAVA"]["density_p50"] == 2.0
    assert groups["PYTHON"]["density_p50"] == 2.0
    assert groups["OVERALL"]["assets"] == 3
    assert groups["OVERALL"]["open_findings"] == 6


def test_the_foothold_rate_counts_assets_not_findings(spark):
    """v5 Fig 11: "just one opening is needed". repo-a and repo-c have an open high-risk
    finding; repo-b does not."""
    groups = by_group(metrics.asset_profile_populations(v5_frame(spark), SCAN_TS))
    assert groups["JAVA"]["assets_with_high_risk_pct"] == 50.0
    assert groups["PYTHON"]["assets_with_high_risk_pct"] == 100.0
    assert round(groups["OVERALL"]["assets_with_high_risk_pct"], 1) == 66.7


def test_per_asset_coverage_skips_assets_with_nothing_to_cover(spark):
    """An asset with no high-risk finding has no coverage -- NULL, not 0%. Counting it as zero
    would drag the median down with assets that were never in the race."""
    groups = by_group(metrics.asset_profile_populations(v5_frame(spark), SCAN_TS))
    # Only repo-a and repo-c have high-risk lifecycles: 1/3 and 0/2, so the median is 16.67.
    assert groups["OVERALL"]["assets_with_high_risk"] == 2
    assert round(groups["OVERALL"]["asset_coverage_p50"], 2) == 16.67
    assert groups["JAVA"]["assets_with_high_risk"] == 1


def test_capacity_is_null_when_the_observation_window_is_unknown(spark):
    """Every capacity column here is a rate per watched month. A register with no scan log has
    no watched month, and reconstructed capacity is the specific thing brick refuses to
    headline -- so these are NULL rather than computed from the API's own back-dated dates."""
    groups = by_group(metrics.asset_profile_populations(v5_frame(spark), SCAN_TS))
    overall = groups["OVERALL"]
    assert overall["window_months"] is None
    assert overall["mmcr_p50"] is None
    assert overall["falling_behind_pct"] is None
    assert overall["assets_flowing"] == 0
    # ...while the columns that do not depend on time are still there.
    assert overall["density_p50"] is not None


def test_capacity_verdicts_are_shares_of_the_assets_that_have_one(spark):
    """v5 Fig 21, with the same dead band around zero the monthly table uses -- a one-finding
    swing must not flip an asset between falling behind and gaining ground."""
    frame = metrics.asset_profile_populations(
        v5_frame(spark), SCAN_TS, observed_from="2026-01-05T00:00:00Z"
    )
    overall = by_group(frame)["OVERALL"]
    assert overall["window_months"] is not None
    shares = [
        overall["falling_behind_pct"],
        overall["maintaining_pct"],
        overall["gaining_pct"],
    ]
    assert overall["assets_flowing"] > 0
    assert round(sum(s for s in shares if s is not None), 6) == 100.0


def test_half_life_is_the_same_kaplan_meier_the_mttr_table_publishes(spark):
    """v5 Fig 15 calls it a half-life; it is the KM median per asset category. Same function
    as the severity table's, so the two cannot disagree about what a median is."""
    groups = by_group(metrics.asset_profile_populations(v5_frame(spark), SCAN_TS))
    # PYTHON has closed nothing, so more than half its findings are still open and there is no
    # median -- reported as a lower bound rather than invented.
    assert groups["PYTHON"]["km_median_days"] is None
    assert groups["PYTHON"]["km_median_lower_bound"] is not None


def test_both_populations_are_written_and_they_differ(spark):
    """Every read must filter on ``population``, so the test that it is worth filtering on is
    that the two halves are not the same numbers."""
    frame = metrics.asset_profile_populations(v5_frame(spark), SCAN_TS)
    every = by_group(frame, "all")
    high = by_group(frame, "high_risk")
    assert every["OVERALL"]["open_findings"] == 6
    assert high["OVERALL"]["open_findings"] == 4
    # repo-b holds only a low-risk finding, so it is not an asset of the high-risk population.
    assert high["JAVA"]["assets"] == 1


def test_findings_with_no_asset_are_dropped_rather_than_merged(spark):
    """An `os` register has no asset ids while ``config.FETCH_ASSET_FIELDS`` is off. Folding
    them into one NULL asset would produce a single enormous phantom repository that dominated
    every percentile; an empty table says nothing, which is correct."""
    import datetime as dt

    frame = lifecycle_rows(
        spark,
        [("id:1", None, None, "HIGH", dt.datetime(2026, 1, 1), None, True, None, 1.0, "high")],
    )
    assert metrics.asset_profile_populations(frame, SCAN_TS).count() == 0
