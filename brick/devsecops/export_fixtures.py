"""Golden-fixture exporter: runs the REAL PySpark ``metrics.py`` transforms over literal,
in-script row lists and dumps ``{input, params, expected}`` JSON for the TypeScript port's
parity suites in ``gas_devsecops/test/``.

This is a SECOND, independent oracle alongside ``gas/``'s hand-written vitest suites: the
TS port of the devsecops analytics is checked against Spark's own arithmetic, not against a
number typed by hand into this file. Every value in the fixtures below comes out of a
``DataFrame.collect()`` -- nothing here is a hand-computed expectation.

No Delta, no ``ingest``, no tenant, no Parquet: the SparkSession built here carries no Delta
jars (contrast ``brick/devsecops/tests/conftest.py``, which sets ``PYSPARK_SUBMIT_ARGS`` with
a Delta package at import time -- this script does not import that module), and every input
row is a literal Python value written directly below. That makes the whole file reviewable in
a diff and runnable anywhere PySpark runs, without a Databricks cluster or a live tenant.

Run from the repo root (needs a local PySpark 3.5.x + a JRE). Measured working recipe --
Docker, ``python:3.11-slim`` (NOT 3.12: PySpark 3.5's ``toPandas()`` still imports
``distutils.version.LooseVersion``, removed in 3.12 -- that only breaks two unrelated
``brick/tests/test_km.py`` assertions and nothing this script calls, but there is no reason to
carry the mismatch):

    docker run --rm -v <repo>:/repo -w /repo python:3.11-slim sh -c "
      apt-get update -qq && apt-get install -y -qq default-jre-headless >/dev/null &&
      pip install -q 'pyspark>=3.5,<4' pandas &&
      python brick/devsecops/export_fixtures.py"

Regenerate whenever ``brick/devsecops/metrics.py`` changes; the fixtures are committed so the
TS tests run without a PySpark toolchain.
"""

from __future__ import annotations

import datetime
import json
import math
import sys
from pathlib import Path

DEVSECOPS_DIR = Path(__file__).resolve().parent
REPO_ROOT = DEVSECOPS_DIR.parents[1]
# This IS the devsecops directory -- metrics.py's own `from config import ...` needs it on the
# path, and (deliberately) nothing above it: brick/ and brick/devsecops/ both define modules
# named `metrics` and `config`, and importing the wrong pair is a full page of plausible wrong
# numbers, not an error. See config.py's own MODULE_VERSION comment.
sys.path.insert(0, str(DEVSECOPS_DIR))

import metrics  # noqa: E402
from config import (  # noqa: E402
    DEFAULT_RISK_RULE,
    DEFAULT_SAST_RISK_RULE,
)

OUT = REPO_ROOT / "gas_devsecops" / "test" / "fixtures" / "brick"


# --------------------------------------------------------------------------- Spark session
def spark_session():
    """A plain local SparkSession -- no Delta extensions, no catalog, no jars.

    Contrast ``brick/devsecops/tests/conftest.py``: that fixture sets ``PYSPARK_SUBMIT_ARGS``
    with the Delta package *at import time*, because Delta's SQL extensions can only be
    installed when the JVM launches. This script never imports that module and never asks for
    Delta, so none of that applies -- every function this exporter calls (``metrics.py``) is a
    pure ``DataFrame -> DataFrame`` transform with no table I/O.
    """
    from pyspark.sql import SparkSession

    return (
        SparkSession.builder.master("local[1]")
        .appName("devsecops-fixture-export")
        # Capacity buckets by UTC calendar month and MTTR is a UTC-to-UTC difference -- see
        # metrics.capacity_by_month's own docstring. A session on local time would shift
        # findings between months and silently disagree with the pipeline.
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.ui.enabled", "false")
        .config("spark.sql.shuffle.partitions", "1")
        .config("spark.sql.adaptive.enabled", "false")
        .config("spark.driver.memory", "1g")
        .getOrCreate()
    )


# ------------------------------------------------------------------------------- JSON helpers
def scrub(obj):
    """NaN / Spark ``Row`` / ``datetime`` -> JSON-safe (None / plain python / ISO-8601 string).

    Mirrors ``gas/test/export_fixtures.py::scrub``, adapted for what ``DataFrame.collect()``
    hands back rather than what pandas does: a Spark timestamp column collects as a naive
    ``datetime.datetime`` in the session's configured timezone (UTC, set above), not a
    ``pd.Timestamp``.
    """
    if obj is None:
        return None
    if isinstance(obj, bool):
        return obj
    # MUST precede the (list, tuple) check: pyspark.sql.Row is a tuple subclass, so a Row
    # caught by that branch first silently degrades to a positional array with its field
    # names discarded -- exactly the kind of wrong that looks like a result. Measured: an
    # earlier version of this function did that to every "expected" row in all four fixtures.
    if hasattr(obj, "asDict"):  # pyspark.sql.Row
        return scrub(obj.asDict(recursive=True))
    if isinstance(obj, dict):
        return {str(k): scrub(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [scrub(v) for v in obj]
    if isinstance(obj, float):
        return None if math.isnan(obj) else obj
    if isinstance(obj, datetime.datetime):
        return obj.strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(obj, datetime.date):
        return obj.isoformat()
    return obj


def rows(df, *order_by):
    """``df`` -> a JSON-safe list of row dicts, ordered for a deterministic diff."""
    ordered = df.orderBy(*order_by) if order_by else df
    return [scrub(r) for r in ordered.collect()]


def dump(name, payload):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(scrub(payload), indent=1, sort_keys=False))
    cases = payload.get("cases", [])
    print(f"wrote brick/{name}.json ({len(cases)} case{'s' if len(cases) != 1 else ''})")


# ------------------------------------------------------------------------- bronze -> silver
#: Every CVE-shaped node built below carries these defaults; ``**over`` replaces exactly the
#: keys a case cares about, matching brick/devsecops/tests/test_metrics.py::node.
CVE_NODE_DEFAULTS = {
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


def cve_node(**over):
    base = dict(CVE_NODE_DEFAULTS)
    base.update(over)
    return base


def unknown_cve_node(**over):
    """A finding nothing was ever captured for -- every exploit signal NULL."""
    return cve_node(hasCisaKevExploit=None, hasExploit=None, epssProbability=None, **over)


SAST_NODE_DEFAULTS = {
    "id": "s-1",
    "name": "Weakness",
    "status": "OPEN",
    "severity": "HIGH",
    "originalSeverity": "HIGH",
    "filePath": "src/A.java",
    "startLine": 10,
    "codeLibraryLanguage": ["JAVA"],
    "origin": "SAST_SCANNER",
    "resolutionReason": None,
    "resource": {"id": "r-1", "name": "org/repo/main", "type": "REPOSITORY_BRANCH"},
    "weaknesses": [],
    "aiAnalysis": {"verdict": None},
}


def sast_node(**over):
    base = json.loads(json.dumps(SAST_NODE_DEFAULTS))  # deep copy; nested dicts are shared
    base.update(over)
    return base


def bronze(spark, nodes, scan_ts, scope):
    data = [("scan-1", scan_ts, scope, i, json.dumps(n)) for i, n in enumerate(nodes)]
    return spark.createDataFrame(
        data, "scan_id STRING, scan_ts STRING, scope STRING, seq LONG, node_json STRING"
    ).withColumn("scan_ts", metrics.F.col("scan_ts").cast("timestamp"))


def silver(spark, nodes, scan_ts, scope="sca"):
    """Nodes -> bronze -> silver, exercising the real parse path (``metrics.silver_findings``,
    which dispatches to ``metrics.silver_sast`` for ``scope="sast"``)."""
    return metrics.silver_findings(bronze(spark, nodes, scan_ts, scope), scope)


# ================================================================================ km.json
#
# Transcribed from brick/devsecops/tests/test_km.py (byte-identical to brick/tests/test_km.py),
# one case per test function -- ``test_censoring_after_the_last_event_extends_the_rmst`` builds
# two distinct curves (short/long), so it is split into two cases here. Spark must agree with
# the hand arithmetic in those tests; see the work-package report for the pytest run that
# checks it.


def km_rows(pairs, severity="HIGH"):
    """``(duration, is_event)`` pairs -> literal lifecycle records, the shape
    ``metrics._with_durations`` produces: an event carries ``mttr_days``, a censored
    observation carries ``age_days``, never both."""
    return [
        {
            "severity": severity,
            "mttr_days": float(d) if event else None,
            "age_days": None if event else float(d),
        }
        for d, event in pairs
    ]


def km_case(spark, name, records):
    df = spark.createDataFrame(
        [(r["severity"], r["mttr_days"], r["age_days"]) for r in records],
        "severity STRING, mttr_days DOUBLE, age_days DOUBLE",
    )
    out = metrics.kaplan_meier(df)
    return {"name": name, "input": records, "expected": rows(out, "severity")}


def export_km(spark):
    cases = [
        km_case(spark, "survival_curve_and_median",
                km_rows([(5, True), (6, False), (8, True)])),
        km_case(spark, "km_median_exceeds_the_naive_median",
                km_rows([(5, True), (6, False), (8, True)])),
        km_case(spark, "rmst_is_the_area_under_the_staircase",
                km_rows([(5, True), (6, False), (8, True)])),
        km_case(spark, "survival_landing_exactly_on_half_is_a_median",
                km_rows([(15, True), (21, True), (60, False), (90, False)])),
        km_case(spark, "median_is_null_under_heavy_censoring",
                km_rows([(5, True), (100, False), (100, False), (100, False)])),
        km_case(spark, "all_censored_yields_no_curve_but_keeps_the_counts",
                km_rows([(10, False), (20, False)])),
        km_case(spark, "a_wiped_out_risk_set_drives_survival_to_zero",
                km_rows([(3, True), (3, True)])),
        km_case(spark, "censoring_after_the_last_event_extends_the_rmst_short",
                km_rows([(10, True)])),
        km_case(spark, "censoring_after_the_last_event_extends_the_rmst_long",
                km_rows([(10, True), (50, False)])),
        km_case(spark, "overall_row_pools_every_severity",
                km_rows([(5, True), (6, False)], "HIGH") + km_rows([(8, True)], "CRITICAL")),
        km_case(spark, "rows_with_no_time_at_all_drop_out",
                km_rows([(5, True)], "HIGH")
                + [{"severity": "HIGH", "mttr_days": None, "age_days": None}]),
        km_case(spark, "km_columns_land_on_the_gold_table",
                km_rows([(5, True), (6, False), (8, True)])),
    ]
    dump("km", {
        "version": 1,
        "source": "metrics.kaplan_meier",
        "generated_by": "brick/devsecops/export_fixtures.py",
        "cases": cases,
    })


# =========================================================================== capacity.json
#
# One literal population spanning April - July: 10 opens in April (4 resolved in May, 1 in
# June), 2 opens in June, plus 2 high-risk (CISA KEV) lifecycles so the high-risk population is
# non-empty. ``now`` = July, so July is the partial current month with no activity of its own
# and ``observed_from`` = June 1st, so April and May are reconstructed -- both flags land on a
# real row without inventing one.

CAP_SCAN_TS = "2026-07-01T00:00:00Z"
CAP_OBSERVED_FROM = "2026-06-01T00:00:00Z"


def capacity_nodes():
    nodes = []
    for i in range(10):
        resolved = None
        if i < 4:
            resolved = "2026-05-15T00:00:00Z"
        elif i == 4:
            resolved = "2026-06-20T00:00:00Z"
        nodes.append(cve_node(
            id=f"apr-{i}", firstDetectedAt="2026-04-05T00:00:00Z", resolvedAt=resolved,
        ))
    for i in range(2):
        nodes.append(cve_node(id=f"jun-{i}", firstDetectedAt="2026-06-10T00:00:00Z"))
    nodes.append(cve_node(
        id="hi-apr", firstDetectedAt="2026-04-10T00:00:00Z",
        resolvedAt="2026-05-20T00:00:00Z", hasCisaKevExploit=True,
    ))
    nodes.append(cve_node(
        id="hi-jun", firstDetectedAt="2026-06-15T00:00:00Z", hasCisaKevExploit=True,
    ))
    return nodes


def export_capacity(spark):
    nodes = capacity_nodes()
    classified = metrics.classify_risk(
        silver(spark, nodes, CAP_SCAN_TS), DEFAULT_RISK_RULE
    ).cache()
    classified.count()

    closed_observed_rows = [
        {"month": "2026-05-01T00:00:00Z", "closed_observed": 5},
        {"month": "2026-06-01T00:00:00Z", "closed_observed": 99},
    ]
    closed_observed = spark.createDataFrame(
        [(r["month"], r["closed_observed"]) for r in closed_observed_rows],
        "month STRING, closed_observed LONG",
    ).withColumn("month", metrics.F.col("month").cast("timestamp"))

    cases = [
        {
            "name": "by_month_no_horizon",
            "input": {"nodes": nodes},
            "params": {"now": CAP_SCAN_TS, "observed_from": None, "high_risk_only": False},
            "expected": rows(metrics.capacity_by_month(classified, CAP_SCAN_TS), "month"),
        },
        {
            "name": "by_month_observed_from",
            "input": {"nodes": nodes},
            "params": {
                "now": CAP_SCAN_TS, "observed_from": CAP_OBSERVED_FROM, "high_risk_only": False,
            },
            "expected": rows(
                metrics.capacity_by_month(
                    classified, CAP_SCAN_TS, observed_from=CAP_OBSERVED_FROM
                ),
                "month",
            ),
        },
        {
            "name": "by_month_high_risk_only",
            "input": {"nodes": nodes},
            "params": {
                "now": CAP_SCAN_TS, "observed_from": CAP_OBSERVED_FROM, "high_risk_only": True,
            },
            "expected": rows(
                metrics.capacity_by_month(
                    classified, CAP_SCAN_TS, high_risk_only=True,
                    observed_from=CAP_OBSERVED_FROM,
                ),
                "month",
            ),
        },
        {
            "name": "by_month_closed_observed",
            "input": {"nodes": nodes, "closed_observed": closed_observed_rows},
            "params": {"now": CAP_SCAN_TS, "observed_from": None, "high_risk_only": False},
            "expected": rows(
                metrics.capacity_by_month(
                    classified, CAP_SCAN_TS, closed_observed=closed_observed
                ),
                "month",
            ),
        },
        {
            "name": "populations",
            "input": {"nodes": nodes, "closed_observed": closed_observed_rows},
            "params": {"now": CAP_SCAN_TS, "observed_from": CAP_OBSERVED_FROM},
            "expected": rows(
                metrics.capacity_populations(
                    classified, CAP_SCAN_TS, observed_from=CAP_OBSERVED_FROM,
                    closed_observed=closed_observed,
                ),
                "population", "month",
            ),
        },
    ]
    dump("capacity", {
        "version": 1,
        "source": "metrics.capacity_by_month, metrics.capacity_populations",
        "generated_by": "brick/devsecops/export_fixtures.py",
        "cases": cases,
    })


# ========================================================================== confusion.json
#
# Two populations: a CVE one (RiskRule, 14 lifecycles) and a SAST one (SastRiskRule, 6
# lifecycles). Both carry high-risk, low-risk AND unclassified (no-signal-at-all) rows, so the
# "unclassified sits outside the 2x2" behaviour and the lo/hi bounds are pinned on real Spark
# output. The SAST population specifically exercises CWE_ANCESTORS (CWE-23 -> CWE-22, a
# Top-25 member) and an unmapped CWE (CWE-601, in neither the Top 25 nor CWE_ANCESTORS), so
# ``cwe_unmapped`` in the signal breakdown is nonzero.

CVE_CONFUSION_SCAN_TS = "2026-06-01T00:00:00Z"
CVE_RESOLVED_AT = "2026-05-01T00:00:00Z"


def confusion_cve_nodes():
    return [
        # CRITICAL split, so the per-severity confusion rows are exercised too.
        cve_node(id="c-tp", severity="CRITICAL", hasCisaKevExploit=True,
                 status="RESOLVED", resolvedAt=CVE_RESOLVED_AT),
        cve_node(id="c-fn", severity="CRITICAL", hasCisaKevExploit=True),
        # HIGH: one TP per signal, so the OR is exercised (the gas/test/program.test.ts shape).
        cve_node(id="h-tp-kev", hasCisaKevExploit=True,
                 status="RESOLVED", resolvedAt=CVE_RESOLVED_AT),
        cve_node(id="h-tp-exploit", hasExploit=True,
                 status="RESOLVED", resolvedAt=CVE_RESOLVED_AT),
        cve_node(id="h-tp-epss", epssProbability=0.42,
                 status="RESOLVED", resolvedAt=CVE_RESOLVED_AT),
        # FP: observed low, remediated anyway.
        cve_node(id="h-fp-1", status="RESOLVED", resolvedAt=CVE_RESOLVED_AT),
        cve_node(id="h-fp-2", status="RESOLVED", resolvedAt=CVE_RESOLVED_AT),
        cve_node(id="h-fp-3", status="RESOLVED", resolvedAt=CVE_RESOLVED_AT),
        # FN: high risk, still open.
        cve_node(id="h-fn-kev", hasCisaKevExploit=True),
        cve_node(id="h-fn-epss", epssProbability=0.9),
        # TN: low risk, still open.
        cve_node(id="h-tn-1"),
        cve_node(id="h-tn-2"),
        # Unclassified, one on each side of remediation.
        unknown_cve_node(id="h-unknown-remediated", status="RESOLVED",
                          resolvedAt=CVE_RESOLVED_AT),
        unknown_cve_node(id="h-unknown-open"),
    ]


def confusion_sast_nodes():
    return [
        # High via the CWE ancestor hop: CWE-23 (Relative Path Traversal) is a child of Top-25
        # member CWE-22 and would not match by id alone. Open -> FN. AI verdict never captured,
        # but "any fired" beats "any missing" -- classifies high, not unknown.
        sast_node(id="s-high-cwe-ancestor", weaknesses=[{"id": "CWE-23"}],
                  severity="HIGH", status="OPEN"),
        # High via the AI verdict alone. Its CWE (CWE-601) is observed but unmapped -- neither
        # in the Top 25 nor in CWE_ANCESTORS -- so this also counts toward cwe_unmapped.
        # Remediated -> TP.
        sast_node(id="s-high-ai-verdict", weaknesses=[{"id": "CWE-601"}], severity="MEDIUM",
                  status="RESOLVED", aiAnalysis={"verdict": "TRUE_POSITIVE"}),
        # High via severity alone -- no CWE and no AI verdict captured, but CRITICAL still
        # fires: positive evidence stands on its own. Open -> FN.
        sast_node(id="s-high-critical", weaknesses=[], severity="CRITICAL", status="OPEN"),
        # Every signal OBSERVED and none fired -> low. CWE-601 again, so a second unmapped hit.
        # Remediated -> FP.
        sast_node(id="s-low-everything-observed", weaknesses=[{"id": "CWE-601"}],
                  severity="LOW", status="RESOLVED",
                  aiAnalysis={"verdict": "FALSE_POSITIVE"}),
        # No signal captured at all -- the correctness trap, applied per row. One open, one
        # remediated, so both unknown_open and unknown_remediated are nonzero.
        sast_node(id="s-unknown-open", weaknesses=[], severity="LOW", status="OPEN"),
        sast_node(id="s-unknown-remediated", weaknesses=[], severity="LOW", status="RESOLVED"),
    ]


def confusion_case(name, classified, rule, rule_label):
    matrix = metrics.order_by_severity(metrics.confusion_matrix(classified))
    breakdown = metrics.signal_breakdown(classified, rule).collect()[0]
    sensitivity = rows(metrics.rule_sensitivity(classified, rule), "rule_label")
    return {
        "name": name,
        "params": {"rule": rule_label, "rule_sentence": rule.sentence()},
        "expected": {
            "confusion_matrix": rows(matrix),
            "signal_breakdown": scrub(breakdown),
            "rule_sensitivity": sensitivity,
        },
    }


def export_confusion(spark):
    cve_nodes = confusion_cve_nodes()
    cve_classified = metrics.classify_risk(
        silver(spark, cve_nodes, CVE_CONFUSION_SCAN_TS), DEFAULT_RISK_RULE
    ).cache()
    cve_classified.count()
    cve_case = confusion_case(
        "cve_population", cve_classified, DEFAULT_RISK_RULE, "DEFAULT_RISK_RULE"
    )
    cve_case["input"] = {"nodes": cve_nodes}

    sast_nodes = confusion_sast_nodes()
    sast_classified = metrics.classify_risk(
        silver(spark, sast_nodes, CVE_CONFUSION_SCAN_TS, scope="sast"), DEFAULT_SAST_RISK_RULE
    ).cache()
    sast_classified.count()
    sast_case = confusion_case(
        "sast_population", sast_classified, DEFAULT_SAST_RISK_RULE, "DEFAULT_SAST_RISK_RULE"
    )
    sast_case["input"] = {"nodes": sast_nodes}

    dump("confusion", {
        "version": 1,
        "source": "metrics.confusion_matrix, metrics.signal_breakdown, "
                  "metrics.rule_sensitivity, metrics.classify_risk",
        "generated_by": "brick/devsecops/export_fixtures.py",
        "cases": [cve_case, sast_case],
    })


# ======================================================================= asset_profile.json
#
# A lifecycle frame built directly (the shape metrics.asset_profile reads, matching
# brick/devsecops/tests/test_devsecops.py::lifecycle_rows/v5_frame) rather than routed through
# silver_findings: asset_profile's inputs are the ledger's own post-classification columns, not
# a raw API node. Five real assets across three languages (JAVA x2, PYTHON x1, GO x2) plus two
# RUBY rows with no asset id, so the "findings with no asset are dropped" count is exercised.
#
# Most assets carry a finding whose ``first_detected_at`` predates ``ASSET_OBSERVED_FROM`` --
# NOT incidental. A first pass here put every ``first_detected_at`` inside the observed window,
# which measured `open_at_start = 0` for every asset (nothing was open *before* the window
# started) and left every capacity column (`net_pct`, `verdict`, `mmcr_p50`,
# `falling_behind_pct`/`maintaining_pct`/`gaining_pct`, `assets_flowing`) null even with
# `observed_from` set -- `window_months` alone does not make a capacity figure computable; a
# pre-window backlog to measure against does. repo-b and repo-e are left as newly-discovered
# assets (first seen inside the window) on purpose, so both shapes are on the page: an asset
# with a real verdict and one still too young to have one.

ASSET_SCHEMA = (
    "vuln_key STRING, asset_id STRING, language STRING, severity STRING, "
    "first_detected_at STRING, resolved_at STRING, is_open BOOLEAN, "
    "mttr_days DOUBLE, age_days DOUBLE, risk_class STRING"
)
ASSET_FIELDS = (
    "vuln_key", "asset_id", "language", "severity", "first_detected_at", "resolved_at",
    "is_open", "mttr_days", "age_days", "risk_class",
)
ASSET_NOW = "2026-08-01T00:00:00Z"
ASSET_OBSERVED_FROM = "2025-11-01T00:00:00Z"

ASSET_ROWS = [
    # repo-a: backlog predates the window (Oct 2025); one of the four closes inside it.
    ("id:1", "repo-a", "JAVA", "HIGH", "2025-10-01T00:00:00Z", None,
     True, None, 304.0, "high"),
    ("id:2", "repo-a", "JAVA", "HIGH", "2025-10-01T00:00:00Z", None,
     True, None, 304.0, "high"),
    ("id:3", "repo-a", "JAVA", "HIGH", "2025-10-01T00:00:00Z", None,
     True, None, 304.0, "low"),
    ("id:4", "repo-a", "JAVA", "HIGH", "2025-10-01T00:00:00Z", "2025-12-10T00:00:00Z",
     False, 70.0, None, "high"),
    # repo-b: newly discovered inside the window -- no pre-window backlog, so its net_pct and
    # verdict stay NULL. Deliberate: a young asset is a real shape, not a gap to fill.
    ("id:5", "repo-b", "JAVA", "HIGH", "2026-03-01T00:00:00Z", None,
     True, None, 153.0, "low"),
    # repo-c: backlog predates the window; one of the three closes inside it.
    ("id:6", "repo-c", "PYTHON", "HIGH", "2025-10-10T00:00:00Z", None,
     True, None, 295.0, "high"),
    ("id:7", "repo-c", "PYTHON", "HIGH", "2025-10-10T00:00:00Z", None,
     True, None, 295.0, "high"),
    ("id:8", "repo-c", "PYTHON", "MEDIUM", "2025-10-20T00:00:00Z", "2026-01-15T00:00:00Z",
     False, 87.0, None, "low"),
    # repo-d: backlog predates the window; one of the two (both CRITICAL/high) closes inside it.
    ("id:9", "repo-d", "GO", "CRITICAL", "2025-10-20T00:00:00Z", None,
     True, None, 285.0, "high"),
    ("id:10", "repo-d", "GO", "CRITICAL", "2025-10-25T00:00:00Z", "2026-02-01T00:00:00Z",
     False, 99.0, None, "high"),
    # repo-e: newly discovered inside the window, like repo-b -- the second "too young" asset.
    ("id:11", "repo-e", "GO", "LOW", "2026-06-01T00:00:00Z", None,
     True, None, 61.0, "low"),
    # No asset id (a NULL and an empty string) -- dropped by metrics._with_assets.
    ("id:12", None, "RUBY", "HIGH", "2025-10-15T00:00:00Z", None,
     True, None, 290.0, "high"),
    ("id:13", "", "RUBY", "HIGH", "2025-10-15T00:00:00Z", None,
     True, None, 290.0, "high"),
]


def build_asset_df(spark):
    df = spark.createDataFrame(ASSET_ROWS, ASSET_SCHEMA)
    return (
        df.withColumn("first_detected_at", metrics.F.col("first_detected_at").cast("timestamp"))
        .withColumn("resolved_at", metrics.F.col("resolved_at").cast("timestamp"))
    )


def export_asset_profile(spark):
    df = build_asset_df(spark).cache()
    df.count()
    input_rows = [dict(zip(ASSET_FIELDS, r)) for r in ASSET_ROWS]

    cases = [
        {
            "name": "observed_from_none",
            "input": {"rows": input_rows},
            "params": {"now": ASSET_NOW, "observed_from": None},
            "expected": rows(
                metrics.asset_profile_populations(df, ASSET_NOW, observed_from=None),
                "population", "asset_group",
            ),
        },
        {
            "name": "observed_from_set",
            "input": {"rows": input_rows},
            "params": {"now": ASSET_NOW, "observed_from": ASSET_OBSERVED_FROM},
            "expected": rows(
                metrics.asset_profile_populations(
                    df, ASSET_NOW, observed_from=ASSET_OBSERVED_FROM
                ),
                "population", "asset_group",
            ),
        },
    ]
    dump("asset_profile", {
        "version": 1,
        "source": "metrics.asset_profile_populations "
                  "(metrics.asset_profile, metrics._asset_half_life)",
        "generated_by": "brick/devsecops/export_fixtures.py",
        "cases": cases,
    })


# ------------------------------------------------------------------------------------- main
def main():
    import pyspark

    print(f"pyspark {pyspark.__version__}")
    spark = spark_session()
    try:
        export_km(spark)
        export_capacity(spark)
        export_confusion(spark)
        export_asset_profile(spark)
    finally:
        spark.stop()
    print("all brick fixtures written to", OUT)


if __name__ == "__main__":
    main()
