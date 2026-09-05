"""Tests for the Databricks metric transforms, against a local SparkSession.

The oracles are ported, not invented: the confusion-matrix block is the hand-counted register
from ``gas/test/program.test.ts``, and the MTTR block is the ``resolved_sample`` case from
``tests/test_metrics.py``. If these numbers move, the pipeline has stopped agreeing with the
dashboards.

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


# The modules are plain top-level files, so their own directory goes on the path -- the same
# arrangement the Databricks side uses. REPO_ROOT is still needed for the response fixture.
BRICK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BRICK_DIR.parent
sys.path.insert(0, str(BRICK_DIR))

import metrics  # noqa: E402
from config import DEFAULT_RISK_RULE, OVERALL, RiskRule  # noqa: E402
from ingest import extract_nodes  # noqa: E402

SCAN_ID = "test-scan"
# Fixed "now", so open-age percentiles and the capacity month grid are deterministic.
SCAN_TS = "2026-07-01T00:00:00Z"


# ------------------------------------------------------------------ fixture builders


def node(**over) -> dict:
    """A finding with every signal observed-and-negative -- an explicit `low`."""
    base = {
        "id": "f-1",
        "name": "CVE-2026-0001",
        "severity": "HIGH",
        "status": "OPEN",
        "firstDetectedAt": "2026-04-01T00:00:00Z",
        "resolvedAt": None,
        "hasCisaKevExploit": False,
        "hasExploit": False,
        "epssProbability": 0.01,
    }
    base.update(over)
    return base


def unknown_node(**over) -> dict:
    """A finding nothing was ever captured for -- an explicit `unknown`."""
    return node(
        hasCisaKevExploit=None, hasExploit=None, epssProbability=None, **over
    )


def silver(spark, nodes, scan_ts: str = SCAN_TS, scope: str = "os"):
    """Nodes -> bronze -> silver, exercising the real parse path."""
    rows = [(SCAN_ID, scan_ts, scope, json.dumps(n)) for n in nodes]
    bronze = spark.createDataFrame(
        rows, "scan_id STRING, scan_ts STRING, scope STRING, node_json STRING"
    ).withColumn("scan_ts", metrics.F.col("scan_ts").cast("timestamp"))
    return metrics.silver_findings(bronze)


def rows_by_severity(df, key: str = "severity") -> dict:
    return {r[key]: r.asDict() for r in df.collect()}


def materialized(df):
    """Cache a frame and force it, for one that several tests share.

    A DataFrame in a module-scoped fixture is still a plan, so without this every consumer
    recomputes it and hoisting buys nothing.
    """
    df = df.cache()
    df.count()
    return df


# ------------------------------------------------------------------------- severity


def test_normalize_severity(spark):
    df = spark.createDataFrame(
        [("informational",), ("INFO",), ("high",), ("weird",), (None,)], "s STRING"
    )
    got = [r[0] for r in df.select(metrics.normalize_severity(metrics.F.col("s"))).collect()]
    assert got == ["INFO", "INFO", "HIGH", "UNKNOWN", "UNKNOWN"]


# ------------------------------------------------------------ risk classification


def test_classify_risk_three_valued(spark):
    cases = [
        ("kev fires", node(hasCisaKevExploit=True), "high"),
        ("exploit fires", node(hasExploit=True), "high"),
        ("epss over threshold fires", node(epssProbability=0.42), "high"),
        ("epss exactly at threshold fires", node(epssProbability=0.1), "high"),
        ("everything observed, nothing fired", node(), "low"),
        ("nothing captured", unknown_node(), "unknown"),
    ]
    df = silver(spark, [n for _, n, _ in cases])
    got = [r["risk_class"] for r in metrics.classify_risk(df, DEFAULT_RISK_RULE).collect()]
    assert got == [expected for _, _, expected in cases]


def test_missing_signal_is_unknown_not_low(spark):
    """The trap, as a regression test.

    KEV and exploit both observed-false, EPSS never captured. Calling this `low` is what
    silently inflates efficiency and deflates coverage at the same time.
    """
    df = silver(spark, [node(epssProbability=None)])
    assert metrics.classify_risk(df, DEFAULT_RISK_RULE).collect()[0]["risk_class"] == "unknown"

    # ...but with EPSS disabled, the remaining signals fully decide it.
    rule = RiskRule(kev=True, exploit=True, epss=False)
    assert metrics.classify_risk(df, rule).collect()[0]["risk_class"] == "low"


def test_empty_rule_decides_nothing(spark):
    df = silver(spark, [node(hasCisaKevExploit=True)])
    rule = RiskRule(kev=False, exploit=False, epss=False)
    assert metrics.classify_risk(df, rule).collect()[0]["risk_class"] == "unknown"


# ------------------------------------------ coverage & efficiency: the worked example


@pytest.fixture(scope="module")
def worked_example_nodes():
    """The 12-lifecycle register from gas/test/program.test.ts, hand-counted:

        3  high risk, remediated          -> TP = 3
        3  not high risk, remediated      -> FP = 3
        2  high risk, still open          -> FN = 2
        2  not high risk, still open      -> TN = 2
        1  no captured signal, remediated -> unknown_remediated = 1
        1  no captured signal, open       -> unknown_open       = 1
                                             classified = 10, unknown = 2, total = 12
    """
    resolved = {"status": "RESOLVED", "resolvedAt": "2026-05-01T00:00:00Z"}
    return [
        # TP -- one per signal, so the OR is exercised.
        node(hasCisaKevExploit=True, **resolved),
        node(hasExploit=True, **resolved),
        node(epssProbability=0.42, **resolved),
        # FP -- observed low, remediated anyway.
        node(**resolved),
        node(**resolved),
        node(**resolved),
        # FN -- high risk, still open.
        node(hasCisaKevExploit=True),
        node(epssProbability=0.9),
        # TN -- low risk, still open.
        node(),
        node(),
        # Unclassified, one on each side.
        unknown_node(**resolved),
        unknown_node(),
    ]


@pytest.fixture(scope="module")
def worked_example_frame(spark, worked_example_nodes):
    """The 12-lifecycle register, parsed and classified once.

    Three tests below built this identically: the confusion-matrix oracle, the sensitivity
    oracle, and the frame-is-left-alone guard. Sharing it is safe -- a DataFrame is immutable,
    and the guard that checks ``rule_sensitivity`` does not disturb ``risk_class`` reads the
    column before and after within its own body, so it still proves exactly what it did.
    """
    return materialized(
        metrics.classify_risk(silver(spark, worked_example_nodes), DEFAULT_RISK_RULE)
    )


@pytest.fixture(scope="module")
def worked_example(worked_example_frame):
    return rows_by_severity(metrics.confusion_matrix(worked_example_frame))["OVERALL"]


def test_confusion_quadrants(worked_example):
    m = worked_example
    assert (m["tp"], m["fp"], m["fn"], m["tn"]) == (3, 3, 2, 2)
    assert m["unknown_remediated"] == 1
    assert m["unknown_open"] == 1


def test_confusion_totals_reconcile(worked_example):
    """Nothing is lost or double-counted."""
    m = worked_example
    assert m["classified"] == 10
    assert m["unknown"] == 2
    assert m["total"] == 12
    assert m["tp"] + m["fp"] + m["fn"] + m["tn"] + m["unknown"] == 12
    assert m["remediated"] + m["open"] == 12
    assert m["remediated"] == 7  # 3 TP + 3 FP + 1 unknown
    assert m["open"] == 5  # 2 FN + 2 TN + 1 unknown


def test_coverage_and_bounds(worked_example):
    m = worked_example
    assert m["coverage_pct"] == pytest.approx(60.0)  # 3 / 5
    assert m["coverage_lo"] == pytest.approx(50.0)  # 3 / 6
    assert m["coverage_hi"] == pytest.approx(100 * 4 / 6)  # 4 / 6


def test_efficiency_and_bounds(worked_example):
    m = worked_example
    assert m["efficiency_pct"] == pytest.approx(50.0)  # 3 / 6
    assert m["efficiency_lo"] == pytest.approx(100 * 3 / 7)
    assert m["efficiency_hi"] == pytest.approx(100 * 4 / 7)


def test_prevalence_and_signal_coverage(worked_example):
    m = worked_example
    assert m["prevalence_pct"] == pytest.approx(50.0)  # 5 / 10
    assert m["signal_coverage_pct"] == pytest.approx(100 * 10 / 12)


def test_coverage_and_efficiency_are_not_transposed(worked_example):
    """They differ by construction here (60 vs 50), so a swapped denominator cannot pass."""
    assert worked_example["coverage_pct"] != worked_example["efficiency_pct"]


def test_confusion_by_severity_splits_and_totals(spark):
    nodes = [
        node(severity="CRITICAL", hasCisaKevExploit=True, status="RESOLVED"),
        node(severity="HIGH", hasCisaKevExploit=True),
        node(severity="HIGH"),
    ]
    df = metrics.classify_risk(silver(spark, nodes), DEFAULT_RISK_RULE)
    by_sev = rows_by_severity(metrics.confusion_matrix(df))
    assert by_sev["CRITICAL"]["tp"] == 1
    assert by_sev["HIGH"]["fn"] == 1
    assert by_sev["HIGH"]["tn"] == 1
    assert by_sev["OVERALL"]["total"] == 3
    assert by_sev["OVERALL"]["coverage_pct"] == pytest.approx(50.0)  # 1 TP / (1 TP + 1 FN)


def test_signal_breakdown_counts_overlaps_and_gaps(spark):
    nodes = [
        node(hasCisaKevExploit=True, hasExploit=True),  # fires twice, counted once in any_of
        node(epssProbability=0.5),
        unknown_node(),
    ]
    df = metrics.classify_risk(silver(spark, nodes), DEFAULT_RISK_RULE)
    got = metrics.signal_breakdown(df, DEFAULT_RISK_RULE).collect()[0].asDict()
    assert got["kev"] == 1
    assert got["exploit"] == 1
    assert got["epss"] == 1
    assert got["any_of"] == 2  # the first row fires on two signals but is one finding
    assert got["kev_missing"] == 1
    assert got["epss_missing"] == 1


# ------------------------------------------------------------------ rule sensitivity
#
# Coverage and efficiency are scored against the rule, not against observed exploitation, so
# "how much of the headline is the rule" is part of the headline. The worked example is reused
# because its twelve lifecycles fire on different signals -- the subsets genuinely disagree,
# which is what makes the assertions below load-bearing rather than decorative.


@pytest.fixture(scope="module")
def sensitivity(worked_example_frame):
    return {
        r["rule_label"]: r.asDict()
        for r in metrics.rule_sensitivity(worked_example_frame, DEFAULT_RISK_RULE).collect()
    }


def test_rule_sensitivity_covers_every_non_empty_subset(sensitivity):
    assert set(sensitivity) == {label for label, *_ in metrics.RULE_SUBSETS}
    assert len(metrics.RULE_SUBSETS) == 7  # 2^3 - 1: the empty rule decides nothing


def test_rule_sensitivity_marks_exactly_the_configured_rule(sensitivity):
    active = [label for label, row in sensitivity.items() if row["active"]]
    assert active == ["All three"]
    assert sensitivity["All three"]["rule_sentence"] == DEFAULT_RISK_RULE.sentence()
    assert sensitivity["KEV only"]["rule_sentence"] == "CISA KEV"
    # The threshold is inherited from the active rule, not swept -- only the signals vary.
    assert all(r["epss_threshold"] == DEFAULT_RISK_RULE.epss_threshold
               for r in sensitivity.values())


def test_rule_sensitivity_agrees_with_the_headline_on_the_active_row(sensitivity):
    """The `All three` row must reproduce the worked example exactly, or the table is
    reporting something other than the metric it sits beside."""
    row = sensitivity["All three"]
    assert (row["tp"], row["fp"], row["fn"], row["tn"]) == (3, 3, 2, 2)
    assert row["coverage_pct"] == pytest.approx(60.0)
    assert row["efficiency_pct"] == pytest.approx(50.0)


def test_rule_sensitivity_subsets_genuinely_disagree(sensitivity):
    """Hand-counted over the same twelve lifecycles.

    KEV alone finds one of the two KEV rows remediated (TP=1) and one still open (FN=1), and
    calls the other eight classified rows low -- five of which were remediated. EPSS alone
    lands on the same shape via different findings. Exploit alone fires on one remediated row
    and nothing open at all, so its coverage is a perfect 100% over a high-risk population of
    one -- which is exactly the trap the `high_risk` column exists to expose.
    """
    assert sensitivity["KEV only"]["coverage_pct"] == pytest.approx(50.0)  # 1 / 2
    assert sensitivity["KEV only"]["efficiency_pct"] == pytest.approx(100 / 6)  # 1 / 6
    assert sensitivity["EPSS only"]["coverage_pct"] == pytest.approx(50.0)
    assert sensitivity["EPSS only"]["efficiency_pct"] == pytest.approx(100 / 6)

    exploit = sensitivity["Exploit only"]
    assert exploit["coverage_pct"] == pytest.approx(100.0)
    assert exploit["high_risk"] == 1
    assert exploit["efficiency_pct"] == pytest.approx(100 / 6)
    # 100% coverage reads better than the active rule's 60% and is worth less. Efficiency and
    # the size of the high-risk population are what say so.
    assert exploit["coverage_pct"] > sensitivity["All three"]["coverage_pct"]
    assert exploit["efficiency_pct"] < sensitivity["All three"]["efficiency_pct"]
    assert exploit["high_risk"] < sensitivity["All three"]["high_risk"]


def test_rule_sensitivity_never_folds_a_missing_signal_into_low(sensitivity):
    """The two unclassified lifecycles have no signal at all, so they stay unclassified under
    every subset -- the correctness trap, applied per row rather than once."""
    assert all(row["unknown"] == 2 for row in sensitivity.values())
    assert all(row["classified"] == 10 for row in sensitivity.values())


def test_rule_sensitivity_leaves_the_input_frame_alone(worked_example_frame):
    """It reclassifies seven times over a frame the caller has already classified, so it must
    not disturb the caller's `risk_class`."""
    df = worked_example_frame
    before = sorted(r["risk_class"] for r in df.collect())
    metrics.rule_sensitivity(df, DEFAULT_RISK_RULE).collect()
    assert sorted(r["risk_class"] for r in df.collect()) == before


def test_rule_sensitivity_marks_nothing_active_for_an_unmatched_rule(spark):
    """A rule with no signals classifies nothing, so no subset is it."""
    df = metrics.classify_risk(silver(spark, [node()]), DEFAULT_RISK_RULE)
    empty = RiskRule(kev=False, exploit=False, epss=False)
    rows = metrics.rule_sensitivity(df, empty).collect()
    assert not any(r["active"] for r in rows)


# --------------------------------------------------------------------- MTTR and SLA


def test_mttr_matches_the_dashboard_oracle(spark):
    """The `resolved_sample` case from tests/test_metrics.py: one HIGH resolved after
    exactly 7 days, one HIGH still open."""
    nodes = [
        node(
            id="a",
            severity="HIGH",
            status="RESOLVED",
            firstDetectedAt="2026-04-01T00:00:00Z",
            resolvedAt="2026-04-08T00:00:00Z",
        ),
        node(
            id="b",
            severity="HIGH",
            status="OPEN",
            firstDetectedAt="2026-05-01T00:00:00Z",
            resolvedAt=None,
        ),
    ]
    by_sev = rows_by_severity(metrics.mttr_by_severity(silver(spark, nodes)))
    high = by_sev["HIGH"]
    assert high["open"] == 1
    assert high["resolved"] == 1
    assert high["mttr_median"] == pytest.approx(7.0)
    assert high["mttr_mean"] == pytest.approx(7.0)
    assert high["sla_target"] == 14
    assert high["sla_pct"] == pytest.approx(100.0)

    overall = by_sev["OVERALL"]
    assert overall["resolved"] == 1
    assert overall["open"] == 1
    assert overall["sla_pct"] == pytest.approx(100.0)


def test_sla_compliance_is_inclusive_of_the_target_day(spark):
    """Resolved exactly on the target day counts as met -- `<=`, not `<`."""
    nodes = [
        node(  # CRITICAL target is 7 days; resolved at exactly 7.0
            severity="CRITICAL",
            status="RESOLVED",
            firstDetectedAt="2026-04-01T00:00:00Z",
            resolvedAt="2026-04-08T00:00:00Z",
        ),
        node(  # ...and one an hour late, which must not count
            severity="CRITICAL",
            status="RESOLVED",
            firstDetectedAt="2026-04-01T00:00:00Z",
            resolvedAt="2026-04-08T01:00:00Z",
        ),
    ]
    critical = rows_by_severity(metrics.mttr_by_severity(silver(spark, nodes)))["CRITICAL"]
    assert critical["sla_compliant"] == 1
    assert critical["sla_pct"] == pytest.approx(50.0)


def test_mttr_is_fractional_days_not_calendar_days(spark):
    nodes = [
        node(
            status="RESOLVED",
            firstDetectedAt="2026-04-01T00:00:00Z",
            resolvedAt="2026-04-01T08:00:00Z",
        )
    ]
    high = rows_by_severity(metrics.mttr_by_severity(silver(spark, nodes)))["HIGH"]
    assert high["mttr_median"] == pytest.approx(8 / 24)


def test_open_age_percentiles_measured_from_scan_ts(spark):
    """Ages are as of the scan, so a stored row means the same thing whenever it is read."""
    nodes = [
        node(id=str(i), firstDetectedAt=f"2026-06-{day:02d}T00:00:00Z")
        for i, day in enumerate([1, 11, 21])
    ]
    high = rows_by_severity(metrics.mttr_by_severity(silver(spark, nodes, SCAN_TS)))["HIGH"]
    # 2026-07-01 minus 2026-06-01 / -11 / -21 = 30, 20, 10 days.
    assert high["open_age_p50"] == pytest.approx(20.0)
    # Linear interpolation at (n-1)*0.9 = 1.8 between 20 and 30 -> 28.0, matching pandas.
    assert high["open_age_p90"] == pytest.approx(28.0)
    assert rows_by_severity(metrics.mttr_by_severity(silver(spark, nodes, SCAN_TS)))["OVERALL"][
        "oldest_open_days"
    ] == pytest.approx(28.0)


def test_empty_denominator_is_null_not_zero(spark):
    """A rate over an empty population is unknown. 0% would be indistinguishable from
    'nothing to remediate', which is the opposite verdict."""
    high = rows_by_severity(metrics.mttr_by_severity(silver(spark, [node()])))["HIGH"]
    assert high["resolved"] == 0
    assert high["sla_pct"] is None
    assert high["mttr_median"] is None

    df = metrics.classify_risk(silver(spark, [node()]), DEFAULT_RISK_RULE)
    matrix = rows_by_severity(metrics.confusion_matrix(df))["HIGH"]
    assert matrix["efficiency_pct"] is None  # nothing remediated at all
    assert matrix["coverage_pct"] is None  # no high-risk findings at all


def test_resolved_status_without_timestamp_is_remediated_but_has_no_mttr(spark):
    """The two clocks differ on purpose: coverage/efficiency read `status`, MTTR reads
    `resolvedAt`. Both source implementations behave exactly this way."""
    nodes = [node(status="RESOLVED", resolvedAt=None, hasCisaKevExploit=True)]
    df = metrics.classify_risk(silver(spark, nodes), DEFAULT_RISK_RULE)
    assert rows_by_severity(metrics.confusion_matrix(df))["HIGH"]["tp"] == 1
    high = rows_by_severity(metrics.mttr_by_severity(df))["HIGH"]
    assert high["resolved"] == 0
    assert high["mttr_median"] is None


# ----------------------------------------------------------- the actionable aggregate


def actionable_frame(spark, rows):
    """A minimal lifecycle-shaped frame: the three columns the second clock aggregates.

    Built directly rather than through ``lifecycle_frame`` because what is under test here is
    the aggregate, not the derivation -- that is pinned in ``test_ledger.py`` against the real
    reconciler.
    """
    return spark.createDataFrame(
        rows,
        "severity STRING, mttr_actionable_days DOUBLE, actionable_age_days DOUBLE, "
        "awaiting_vendor_fix BOOLEAN",
    )


def test_the_actionable_clock_takes_the_same_kind_of_median_its_neighbour_does(spark):
    """``F.percentile``, never ``percentile_approx``, so the two clocks cannot report two
    different kinds of median for the same severity on the same row of the same table."""
    rows = [
        ("CRITICAL", 10.0, None, False),
        ("CRITICAL", 20.0, None, False),
        ("CRITICAL", 30.0, None, False),
        ("HIGH", None, 40.0, True),
    ]
    got = rows_by_severity(metrics.actionable_mttr_by_severity(actionable_frame(spark, rows)))

    assert got["CRITICAL"]["mttr_actionable_median"] == pytest.approx(20.0)
    assert got["CRITICAL"]["mttr_actionable_mean"] == pytest.approx(20.0)
    # count() ignores NULLs, so this is the population the second clock could price at all.
    assert got["CRITICAL"]["actionable_resolved"] == 3
    assert got["HIGH"]["actionable_resolved"] == 0
    assert got["HIGH"]["awaiting_vendor_fix_count"] == 1
    assert got["HIGH"]["actionable_age_p90"] == pytest.approx(40.0)

    # OVERALL is its own pass over every row, the same convention `mttr_by_severity` uses --
    # not a mean of the per-severity answers, which would weight a severity of one like a
    # severity of a thousand.
    assert got[OVERALL]["actionable_resolved"] == 3
    assert got[OVERALL]["mttr_actionable_median"] == pytest.approx(20.0)
    assert got[OVERALL]["awaiting_vendor_fix_count"] == 1


def test_the_actionable_sla_is_inclusive_and_read_from_the_severity(spark):
    """CRITICAL's target is 7 days, and resolved ON the target day counts as met -- the same
    rule ``_mttr_aggs`` applies to the exposure clock, so the two percentages are comparable."""
    rows = [("CRITICAL", 7.0, None, False), ("CRITICAL", 7.5, None, False)]
    got = rows_by_severity(metrics.actionable_mttr_by_severity(actionable_frame(spark, rows)))

    assert got["CRITICAL"]["actionable_sla_compliant"] == 1
    assert got["CRITICAL"]["actionable_sla_pct"] == pytest.approx(50.0)
    # A rate over an empty population is unknown, not 0%.
    empty = rows_by_severity(
        metrics.actionable_mttr_by_severity(actionable_frame(spark, [("HIGH", None, 3.0, False)]))
    )
    assert empty["HIGH"]["actionable_sla_pct"] is None


def test_the_actionable_aggregate_cannot_be_run_over_a_snapshot(spark):
    """Why this is a second function rather than a wider ``mttr_by_severity``.

    ``run_pipeline.build_metrics`` calls that one TWICE -- over the ledger lifecycles and over
    the silver snapshot, so the two can be published side by side as ``snap_*``. Silver is one
    scan's payload and has no ``fix_observed_at``, no ``actionable_from`` and no
    ``awaiting_vendor_fix``; it cannot have them, because they are cross-scan facts. Widening
    the shared function would fail on the snapshot half, and the natural repair -- a coalesce,
    or a column-existence check -- would publish a single-scan figure under the same name as a
    whole-ledger one.
    """
    with pytest.raises(Exception) as exc:
        metrics.actionable_mttr_by_severity(silver(spark, [node()])).collect()
    assert "mttr_actionable_days" in str(exc.value)


# ----------------------------------------------------------------- resolution sources


def test_resolution_sources_split_stated_from_inferred(spark):
    """The audit trail for the inference v2 rests on.

    A `disappeared` resolution was never stated by Wiz -- we concluded it from the finding no
    longer being returned. That is the right call, but it is still a conclusion, and a reader
    has to be able to see how much of the number rests on it.
    """
    rows = spark.createDataFrame(
        [
            ("CRITICAL", "api"),
            ("CRITICAL", "disappeared"),
            ("CRITICAL", "disappeared"),
            ("HIGH", "api"),
            ("HIGH", None),  # still open: neither
        ],
        "severity STRING, resolution_src STRING",
    )
    got = {r["severity"]: r.asDict() for r in metrics.resolution_sources(rows).collect()}

    assert got["CRITICAL"]["resolved_api"] == 1
    assert got["CRITICAL"]["resolved_disappeared"] == 2
    assert got["HIGH"]["resolved_api"] == 1
    assert got["HIGH"]["resolved_disappeared"] == 0
    assert got["OVERALL"]["resolved_api"] == 2
    assert got["OVERALL"]["resolved_disappeared"] == 2


# --------------------------------------------------------------------------- capacity


@pytest.fixture(scope="module")
def capacity_nodes():
    """Three months of activity, hand-counted:

        April  : 10 opened,  0 closed.  open_at_start = 0
        May    :  0 opened,  4 closed.  open_at_start = 10 -> mmcr 40%, net +4  (+40%)
        June   :  2 opened,  1 closed.  open_at_start = 6  -> mmcr 16.6%, net -1 (-16.6%)
        July   :  0 opened,  0 closed.  open_at_start = 7  -> the partial current month
    """
    nodes = []
    for i in range(10):
        resolved = None
        if i < 4:
            resolved = "2026-05-15T00:00:00Z"
        elif i == 4:
            resolved = "2026-06-20T00:00:00Z"
        nodes.append(
            node(id=f"apr-{i}", firstDetectedAt="2026-04-05T00:00:00Z", resolvedAt=resolved)
        )
    for i in range(2):
        nodes.append(node(id=f"jun-{i}", firstDetectedAt="2026-06-10T00:00:00Z"))
    return nodes


#: The horizon three of the capacity tests share: months before it were never watched.
OBSERVED_FROM = "2026-06-01T00:00:00Z"


@pytest.fixture(scope="module")
def capacity_silver(spark, capacity_nodes):
    """The capacity register's silver frame. Seven tests below want exactly this one."""
    return materialized(silver(spark, capacity_nodes))


@pytest.fixture(scope="module")
def capacity_frame(capacity_silver):
    """``capacity_by_month`` with no horizon -- the default reading, computed once."""
    return materialized(metrics.capacity_by_month(capacity_silver, SCAN_TS))


@pytest.fixture(scope="module")
def capacity_frame_observed(capacity_silver):
    """The same register seen from ``OBSERVED_FROM``, computed once."""
    return materialized(
        metrics.capacity_by_month(capacity_silver, SCAN_TS, observed_from=OBSERVED_FROM)
    )


@pytest.fixture(scope="module")
def capacity_months(capacity_frame):
    return {str(r["month"])[:7]: r.asDict() for r in capacity_frame.collect()}


def test_capacity_backlog_and_close_rate(capacity_months):
    assert capacity_months["2026-04"]["open_at_start"] == 0
    assert capacity_months["2026-04"]["opened"] == 10
    assert capacity_months["2026-05"]["open_at_start"] == 10
    assert capacity_months["2026-05"]["closed"] == 4
    assert capacity_months["2026-05"]["mmcr"] == pytest.approx(40.0)
    assert capacity_months["2026-06"]["open_at_start"] == 6
    assert capacity_months["2026-06"]["mmcr"] == pytest.approx(100 / 6)


def test_capacity_verdicts_use_the_dead_band(capacity_months):
    assert capacity_months["2026-05"]["net"] == 4
    assert capacity_months["2026-05"]["verdict"] == "gaining"
    assert capacity_months["2026-06"]["net"] == -1
    assert capacity_months["2026-06"]["verdict"] == "falling-behind"
    # April had nothing open to close, so there is no rate and no verdict to draw.
    assert capacity_months["2026-04"]["mmcr"] is None
    assert capacity_months["2026-04"]["verdict"] == "keeping-up"


def test_capacity_marks_the_current_month_partial_and_excludes_it(capacity_months):
    assert capacity_months["2026-07"]["partial"] is True
    assert capacity_months["2026-05"]["partial"] is False
    # Counted months are May and June only: April has no rate, July is partial.
    assert capacity_months["2026-05"]["months_counted"] == 2
    assert capacity_months["2026-05"]["mmcr_mean"] == pytest.approx((40.0 + 100 / 6) / 2)
    assert capacity_months["2026-05"]["one_in_n"] == pytest.approx(
        100 / ((40.0 + 100 / 6) / 2)
    )
    # net_total spans every month, partial ones included: 5 closed - 12 opened.
    assert capacity_months["2026-05"]["net_total"] == -7


def test_capacity_marks_months_before_the_first_scan_reconstructed(capacity_frame_observed):
    """Months we never watched are inferred from the API's dates, not measured.

    Without the flag a register three weeks old shows two years of confident monthly
    throughput, which is the same class of error as drawing a NULL as a zero bar.
    """
    months = {str(r["month"])[:7]: r.asDict() for r in capacity_frame_observed.collect()}
    assert months["2026-04"]["reconstructed"] is True
    assert months["2026-05"]["reconstructed"] is True
    assert months["2026-06"]["reconstructed"] is False
    assert months["2026-07"]["reconstructed"] is False


def test_reconstructed_months_do_not_drive_the_headline_rate(
    capacity_frame, capacity_frame_observed
):
    """"We close about 1 in N" is a claim about throughput we actually measured."""
    # Without a horizon, May and June both count. With one, only June is measured.
    assert capacity_frame.collect()[0]["months_counted"] == 2
    row = capacity_frame_observed.collect()[0]
    assert row["months_counted"] == 1
    assert row["mmcr_mean"] == pytest.approx(100 / 6)


def test_capacity_without_a_horizon_calls_nothing_reconstructed(capacity_frame):
    """Before any scan is logged there is no horizon, and claiming one would be invented."""
    rows = capacity_frame.collect()
    assert all(r["reconstructed"] is False for r in rows)
    assert all(r["closed_observed"] is None for r in rows)


def test_capacity_joins_the_observed_close_count(spark, capacity_silver):
    """The cross-check rides alongside `closed` rather than replacing it.

    They are two routes to the same number -- one from resolved_at, one from what
    reconciliation actually counted. Publishing both is what lets a reader spot a divergence.
    """
    observed = spark.createDataFrame(
        [("2026-05-01T00:00:00Z", 4), ("2026-06-01T00:00:00Z", 99)],
        "month STRING, closed_observed LONG",
    ).withColumn("month", metrics.F.col("month").cast("timestamp"))
    df = metrics.capacity_by_month(capacity_silver, SCAN_TS, closed_observed=observed)
    months = {str(r["month"])[:7]: r.asDict() for r in df.collect()}
    assert months["2026-05"]["closed"] == 4
    assert months["2026-05"]["closed_observed"] == 4
    # A divergence stays visible instead of being reconciled away.
    assert months["2026-06"]["closed"] == 1
    assert months["2026-06"]["closed_observed"] == 99
    # A month reconciliation never saw is NULL, not 0.
    assert months["2026-04"]["closed_observed"] is None


def test_capacity_small_swing_is_keeping_up(spark):
    """A net movement inside the +/-2% band must not flip the verdict."""
    nodes = [node(id=f"o-{i}", firstDetectedAt="2026-04-05T00:00:00Z") for i in range(100)]
    nodes.append(
        node(id="c", firstDetectedAt="2026-04-05T00:00:00Z", resolvedAt="2026-05-10T00:00:00Z")
    )
    months = {
        str(r["month"])[:7]: r.asDict()
        for r in metrics.capacity_by_month(silver(spark, nodes), SCAN_TS).collect()
    }
    assert months["2026-05"]["net_pct"] == pytest.approx(100 / 101)
    assert months["2026-05"]["verdict"] == "keeping-up"


def test_capacity_high_risk_only_narrows_the_population(spark):
    nodes = [
        node(id="hi", hasCisaKevExploit=True, firstDetectedAt="2026-04-05T00:00:00Z"),
        node(id="lo", firstDetectedAt="2026-04-05T00:00:00Z"),
    ]
    df = metrics.classify_risk(silver(spark, nodes), DEFAULT_RISK_RULE)
    months = {
        str(r["month"])[:7]: r.asDict()
        for r in metrics.capacity_by_month(df, SCAN_TS, high_risk_only=True).collect()
    }
    assert months["2026-04"]["opened"] == 1


def test_capacity_populations_stacks_both_and_labels_every_row(spark):
    """The published table carries the all-findings backlog and the P2P v3 high-risk net flow.
    An unfiltered read of it would double every count, so every row says which it is."""
    nodes = [
        node(id="hi", hasCisaKevExploit=True, firstDetectedAt="2026-04-05T00:00:00Z"),
        node(id="lo", firstDetectedAt="2026-04-05T00:00:00Z"),
    ]
    df = metrics.classify_risk(silver(spark, nodes), DEFAULT_RISK_RULE)
    rows = metrics.capacity_populations(df, SCAN_TS).collect()

    assert {r["population"] for r in rows} == {"all", "high_risk"}
    opened = {
        (r["population"], str(r["month"])[:7]): r["opened"] for r in rows
    }
    assert opened[("all", "2026-04")] == 2
    assert opened[("high_risk", "2026-04")] == 1
    # Same month grid here because both populations start in April; that is a property of these
    # nodes, not a guarantee -- each grid is built from its own earliest first_detected_at.
    assert opened[("all", "2026-07")] == 0


def test_capacity_populations_withhold_closed_observed_from_high_risk(spark):
    """Reconciliation's count carries no risk label, so against the high-risk population it
    would cross-check a different set of findings. NULL beats a misleading number."""
    nodes = [
        node(
            id="hi",
            hasCisaKevExploit=True,
            firstDetectedAt="2026-04-05T00:00:00Z",
            resolvedAt="2026-05-15T00:00:00Z",
        ),
        node(
            id="lo",
            firstDetectedAt="2026-04-05T00:00:00Z",
            resolvedAt="2026-05-20T00:00:00Z",
        ),
    ]
    observed = spark.createDataFrame(
        [("2026-05-01T00:00:00Z", 2)], "month STRING, closed_observed LONG"
    ).withColumn("month", metrics.F.col("month").cast("timestamp"))
    df = metrics.classify_risk(silver(spark, nodes), DEFAULT_RISK_RULE)
    rows = metrics.capacity_populations(df, SCAN_TS, closed_observed=observed).collect()

    by_key = {(r["population"], str(r["month"])[:7]): r.asDict() for r in rows}
    assert by_key[("all", "2026-05")]["closed_observed"] == 2
    assert by_key[("high_risk", "2026-05")]["closed"] == 1
    assert by_key[("high_risk", "2026-05")]["closed_observed"] is None


def test_capacity_populations_says_nothing_when_nothing_is_high_risk(capacity_silver):
    """`capacity_nodes` is entirely low risk. An empty high-risk population writes no rows --
    it does not write a row of zeros, which would read as measured throughput of nothing."""
    df = metrics.classify_risk(capacity_silver, DEFAULT_RISK_RULE)
    rows = metrics.capacity_populations(df, SCAN_TS).collect()
    assert {r["population"] for r in rows} == {"all"}


def test_observation_window(spark):
    df = silver(spark, [node(firstDetectedAt="2026-06-01T00:00:00Z")])
    got = metrics.observation_window_days(df, SCAN_TS).collect()[0][0]
    assert got == pytest.approx(30.0)


# ------------------------------------------------------------------- the real payload


def test_committed_wiz_fixture_parses_end_to_end(spark):
    """The real response shape, straight from the repo fixture -- no network, no mocks."""
    payload = json.loads((REPO_ROOT / "os_vulns_response_exemple.json").read_text())
    nodes = extract_nodes(payload)
    assert nodes, "fixture should contain findings"

    df = metrics.classify_risk(silver(spark, nodes), DEFAULT_RISK_RULE)
    parsed = df.collect()
    assert len(parsed) == len(nodes)
    # Nothing silently dropped to NULL by the parse.
    assert all(r["severity"] in {"CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"} for r in parsed)
    assert all(r["first_detected_at"] is not None for r in parsed)
    assert any(r["risk_class"] == "high" for r in parsed)

    overall = rows_by_severity(metrics.confusion_matrix(df))["OVERALL"]
    assert overall["total"] == len(nodes)
    metrics.mttr_by_severity(df).collect()
    metrics.capacity_by_month(df, SCAN_TS).collect()


def test_scope_travels_from_bronze_into_silver_and_gold(spark):
    """A row must say which population it describes even when read outside its own table --
    otherwise an OS row and an all-types row are indistinguishable after a UNION."""
    df = metrics.classify_risk(silver(spark, [node()], scope="os"), DEFAULT_RISK_RULE)
    assert df.collect()[0]["scope"] == "os"

    gold = metrics.with_scan_columns(metrics.confusion_matrix(df), SCAN_ID, SCAN_TS, "os")
    row = rows_by_severity(gold)["OVERALL"]
    assert row["scope"] == "os"
    assert row["scan_id"] == SCAN_ID


def test_severity_ordering_puts_overall_last(spark):
    nodes = [node(severity="LOW"), node(severity="CRITICAL"), node(severity="HIGH")]
    ordered = [
        r["severity"]
        for r in metrics.order_by_severity(
            metrics.mttr_by_severity(silver(spark, nodes))
        ).collect()
    ]
    assert ordered == ["CRITICAL", "HIGH", "LOW", "OVERALL"]
