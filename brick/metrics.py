"""The metrics, as pure PySpark ``DataFrame -> DataFrame`` transforms.

No I/O, no ``dbutils``, no ``SparkSession`` construction -- everything here is testable against
a local session, which is the point.

Four families, ported from the existing implementations rather than reinvented. ``gas/`` is the
most complete surface and the standard; where it and the older ``wiz_dashboard/domain/`` port
disagree, GAS wins.

  MTTR / SLA   ``gas/src/domain/metrics.ts::summarize``
               (= ``wiz_dashboard/domain/metrics.py::_summarize``)
  Coverage     Completeness / recall. Of all HIGH-RISK vulnerabilities, what share did we
               remediate?  TP / (TP + FN).
  Efficiency   Precision. Of everything we remediated, what share was actually high-risk?
               TP / (TP + FP).
  Capacity     Mean Monthly Close Rate and net flow -- can we close faster than risk arrives?

Coverage and efficiency come from the Cisco Kenna / Cyentia "Prioritization to Prediction"
series and are in direct tension: v2's industry baseline is 70% coverage at 18.5% efficiency.
They are meaningless apart, so both are always emitted together.
``gas/src/domain/program.ts`` is the reference implementation.

-------------------------------------------------------------------------------------------
THE CORRECTNESS TRAP, stated once because it shapes the whole module:
**unknown is not the same as not-high-risk.** A finding whose exploit signal was never captured
must never count as low risk -- that single mistake inflates efficiency's denominator and
deflates coverage's numerator at the same time, silently. So ``has_kev`` / ``has_exploit`` /
``epss`` stay nullable all the way through, unclassified rows leave BOTH sides of every rate,
and the published lo/hi bounds are what the unclassified population could do to each rate.
Never ``coalesce(has_kev, False)``.
-------------------------------------------------------------------------------------------
"""

from __future__ import annotations

import functools
import operator
from typing import List, Optional

from pyspark.sql import Column, DataFrame, Window
from pyspark.sql import functions as F
from pyspark.sql.types import (
    BooleanType,
    DoubleType,
    StringType,
    StructField,
    StructType,
)

from config import (
    NET_CAPACITY_BAND_PCT,
    OVERALL,
    RESOLUTION_API,
    RESOLUTION_DISAPPEARED,
    RESOLVED_STATUSES,
    RiskRule,
    SEVERITY_ORDER,
    SLA_TARGETS,
)

# See config.PIPELINE_VERSION: every runtime module must come from the same upload.
MODULE_VERSION = "2.0"

SECONDS_PER_DAY = 86400

# Tolerance for the Kaplan-Meier median crossing. See kaplan_meier() for why a survival
# probability needs one at all.
SURVIVAL_TIE_EPS = 1e-9

# The subset of the Wiz finding node this pipeline reads. Extra keys in the payload are
# ignored by ``from_json``, so widening the ingest query never breaks the parse.
NODE_SCHEMA = StructType(
    [
        StructField("id", StringType()),
        StructField("name", StringType()),
        StructField("detailedName", StringType()),
        StructField("severity", StringType()),
        StructField("status", StringType()),
        StructField("firstDetectedAt", StringType()),
        StructField("lastDetectedAt", StringType()),
        StructField("resolvedAt", StringType()),
        StructField("fixDate", StringType()),
        StructField("fixedVersion", StringType()),
        StructField("hasExploit", BooleanType()),
        StructField("hasCisaKevExploit", BooleanType()),
        StructField("epssProbability", DoubleType()),
        StructField(
            "vulnerableAsset",
            StructType(
                [
                    StructField("id", StringType()),
                    StructField("type", StringType()),
                    StructField("name", StringType()),
                    StructField("cloudPlatform", StringType()),
                    StructField("subscriptionName", StringType()),
                    StructField("subscriptionExternalId", StringType()),
                ]
            ),
        ),
    ]
)


# --------------------------------------------------------------------------- helpers


def safe_pct(numerator: Column, denominator: Column) -> Column:
    """``numerator / denominator * 100``, or NULL when there is nothing to divide by.

    NULL, never 0. A rate over an empty population is unknown, and rendering it as 0% is a
    lie the reader cannot detect -- 0% coverage and "no high-risk findings" look identical.
    """
    return F.when(denominator > 0, numerator / denominator * 100)


def normalize_severity(col: Column) -> Column:
    """Wiz severity -> the register's taxonomy. INFORMATIONAL folds to INFO; anything
    unrecognised (including NULL) becomes UNKNOWN rather than being dropped."""
    upper = F.upper(F.trim(F.coalesce(col, F.lit(""))))
    return (
        F.when(upper.isin("INFORMATIONAL", "INFO"), F.lit("INFO"))
        .when(upper.isin(*[s for s in SEVERITY_ORDER if s != "UNKNOWN"]), upper)
        .otherwise(F.lit("UNKNOWN"))
    )


def is_open(status: Column) -> Column:
    """The open/remediated test the rest of the domain uses: a finding is open unless its
    status says otherwise. Note this reads *status*, while the MTTR clock reads
    ``resolved_at`` -- a finding can be status-RESOLVED with no timestamp, in which case it
    counts as remediated for coverage/efficiency but contributes no MTTR. Both source
    implementations behave exactly this way."""
    return ~F.upper(F.coalesce(status, F.lit(""))).isin(*sorted(RESOLVED_STATUSES))


def _sla_target_col(severity: Column) -> Column:
    pairs: List[Column] = []
    for sev, days in SLA_TARGETS.items():
        pairs.extend([F.lit(sev), F.lit(days)])
    return F.create_map(*pairs)[severity]


def order_by_severity(df: DataFrame, column: str = "severity") -> DataFrame:
    """Sort rows into SEVERITY_ORDER with the OVERALL aggregate last."""
    pairs: List[Column] = []
    for index, sev in enumerate(SEVERITY_ORDER):
        pairs.extend([F.lit(sev), F.lit(index)])
    rank = F.coalesce(F.create_map(*pairs)[F.col(column)], F.lit(len(SEVERITY_ORDER) + 1))
    return df.orderBy(rank, column)


# ---------------------------------------------------------------------------- silver


def silver_findings(bronze: DataFrame) -> DataFrame:
    """Typed, metric-ready rows from the bronze ``node_json`` payload.

    Expects ``scan_id`` (string), ``scan_ts`` (timestamp), ``scope`` (string) and ``node_json``
    (string). ``scan_ts`` doubles as "now" for open-age: ages are measured as of the scan that
    observed the finding, so a table row means the same thing whenever it is read back.
    ``scope`` rides along so a row still says which population it came from after a UNION.
    """
    node = F.from_json(F.col("node_json"), NODE_SCHEMA).alias("node")
    # `seq` records the order the API returned each finding in, so a duplicate within one scan
    # can be resolved first-wins the way reconcile.ts does it. Bronze written by v1 has no such
    # column; NULL then means "order unknown" and ledger.observed falls back accordingly.
    seq = F.col("seq") if "seq" in bronze.columns else F.lit(None).cast("long")
    parsed = bronze.select("scan_id", "scan_ts", "scope", seq.alias("seq"), node)

    first_detected = F.col("node.firstDetectedAt").cast("timestamp")
    resolved = F.col("node.resolvedAt").cast("timestamp")

    df = parsed.select(
        F.col("scan_id"),
        F.col("scan_ts"),
        F.col("scope"),
        F.col("seq"),
        F.col("node.id").alias("finding_id"),
        F.col("node.name").alias("cve"),
        F.col("node.detailedName").alias("component"),
        normalize_severity(F.col("node.severity")).alias("severity"),
        F.col("node.status").alias("status"),
        is_open(F.col("node.status")).alias("is_open"),
        first_detected.alias("first_detected_at"),
        F.col("node.lastDetectedAt").cast("timestamp").alias("last_detected_at"),
        resolved.alias("resolved_at"),
        F.col("node.fixDate").cast("timestamp").alias("fix_date"),
        F.col("node.fixedVersion").alias("fixed_version"),
        F.col("node.vulnerableAsset.id").alias("asset_id"),
        F.col("node.vulnerableAsset.name").alias("asset_name"),
        F.col("node.vulnerableAsset.type").alias("asset_type"),
        F.col("node.vulnerableAsset.cloudPlatform").alias("cloud"),
        F.col("node.vulnerableAsset.subscriptionName").alias("subscription_name"),
        F.col("node.vulnerableAsset.subscriptionExternalId").alias("subscription_ext_id"),
        # Nullable on purpose -- see the module header. NULL means never captured.
        F.col("node.hasCisaKevExploit").alias("has_kev"),
        F.col("node.hasExploit").alias("has_exploit"),
        F.col("node.epssProbability").alias("epss"),
    )

    # Seconds / 86400, never calendar days -- matching metrics._summarize and
    # ledgerCore.baseRows, so a fix eight hours after detection reads as 0.33 days.
    mttr_days = (
        F.unix_timestamp("resolved_at") - F.unix_timestamp("first_detected_at")
    ) / SECONDS_PER_DAY
    age_days = (
        F.unix_timestamp("scan_ts") - F.unix_timestamp("first_detected_at")
    ) / SECONDS_PER_DAY

    return df.withColumn("mttr_days", mttr_days).withColumn(
        "age_days", F.when(F.col("resolved_at").isNull(), age_days)
    )


# ------------------------------------------------------------------------ MTTR / SLA


def _mttr_aggs() -> List[Column]:
    """The aggregate list, shared by the per-severity and OVERALL passes so the two can
    never drift apart."""
    return [
        # count() ignores NULLs, so `resolved` is exactly the population with a measurable
        # MTTR: both a first-detected and a resolved timestamp.
        F.avg("mttr_days").alias("mttr_mean"),
        F.percentile("mttr_days", 0.5).alias("mttr_median"),
        F.count("mttr_days").cast("long").alias("resolved"),
        F.sum(F.when(F.col("resolved_at").isNull(), 1).otherwise(0)).cast("long").alias("open"),
        # age_days is non-NULL only for open rows, so these are open-age percentiles.
        # percentile() is the exact aggregate: it interpolates linearly at (n-1)*q, matching
        # pandas .median()/.quantile(0.9). percentile_approx does NOT, and would quietly
        # disagree with the dashboard.
        F.percentile("age_days", 0.5).alias("open_age_p50"),
        F.percentile("age_days", 0.9).alias("open_age_p90"),
        # In-SLA is inclusive: resolved on the target day counts as met.
        F.sum(F.when(F.col("mttr_days") <= F.col("sla_target"), 1).otherwise(0))
        .cast("long")
        .alias("sla_compliant"),
    ]


def kaplan_meier(df: DataFrame) -> DataFrame:
    """Censoring-aware time-to-remediate, per severity plus OVERALL.

    Port of ``gas/src/domain/remediation.ts::kaplanMeier``.

    The naive median is computed over resolved findings only, which is survivorship bias with a
    respectable name: the findings that take longest are disproportionately the ones still open,
    so excluding them makes remediation look faster than it is, and the bias grows exactly when
    a programme is falling behind. Kaplan-Meier keeps those findings in the risk set as
    **right-censored** observations -- "not closed *yet*" is evidence, just not the same evidence
    as "closed at day 40".

    Events are resolved rows at ``mttr_days``; censored rows are open findings at ``age_days``.
    A row with neither drops out of both. Then, over distinct event times ascending:

        atRisk(t) = #{observations with duration >= t}      (events AND censored)
        d(t)      = #{events at exactly t}
        S(t)      = Π (1 - d/atRisk)

    Emits:

    * ``km_median`` -- smallest event time where ``S(t) <= 0.5``. **NULL when survival never
      falls that far**, which happens whenever more than half the findings are still open. That
      is not a failure, it is the honest answer, and ``km_median_lower_bound`` then carries the
      longest observed time so a reader can say "> 90d" instead of inventing a number.
    * ``km_rmst`` -- restricted mean survival time, the area under the staircase out to
      τ = the longest observed time. ``km_truncated`` marks S(τ) > 0, meaning the RMST is a
      lower bound rather than a mean.
    """
    work = df.withColumn(
        "_duration", F.coalesce(F.col("mttr_days"), F.col("age_days"))
    ).withColumn("_is_event", F.col("mttr_days").isNotNull().cast("int"))
    work = work.filter(F.col("_duration").isNotNull())

    # Per-severity and OVERALL in one pass: duplicate every row under the OVERALL label.
    work = work.select("severity", "_duration", "_is_event").unionByName(
        work.select(F.lit(OVERALL).alias("severity"), "_duration", "_is_event")
    )

    # τ and the raw counts, before the curve narrows to event times only.
    totals = work.groupBy("severity").agg(
        F.max("_duration").alias("km_restriction_time"),
        F.sum("_is_event").cast("long").alias("km_events"),
        F.sum(1 - F.col("_is_event")).cast("long").alias("km_censored"),
    )

    # One row per distinct observed time: how many events landed on it, how many observations
    # sit exactly there.
    at_time = work.groupBy("severity", "_duration").agg(
        F.sum("_is_event").cast("long").alias("_d"),
        F.count(F.lit(1)).cast("long").alias("_n_here"),
    )

    # atRisk = everything at or beyond this time, i.e. a reverse cumulative count.
    descending = (
        Window.partitionBy("severity")
        .orderBy(F.col("_duration").desc())
        .rowsBetween(Window.unboundedPreceding, Window.currentRow)
    )
    at_time = at_time.withColumn("_at_risk", F.sum("_n_here").over(descending))

    # The curve is defined at event times only; a time with no event does not step it down.
    curve = at_time.filter((F.col("_d") > 0) & (F.col("_at_risk") > 0))
    factor = 1 - (F.col("_d") / F.col("_at_risk"))

    ascending = (
        Window.partitionBy("severity")
        .orderBy("_duration")
        .rowsBetween(Window.unboundedPreceding, Window.currentRow)
    )
    # S is a running product, and Spark has no product aggregate. exp(Σ log f) is the standard
    # substitute, but log(0) is NULL in Spark and sum() skips NULLs -- so a step that wipes out
    # the whole risk set (d == atRisk) would be silently ignored and survival would stay
    # positive after everything had been remediated. Carry a sticky zero flag instead.
    curve = (
        curve.withColumn("_factor", factor)
        .withColumn("_zeroed", F.max((F.col("_factor") <= 0).cast("int")).over(ascending))
        .withColumn(
            "_s",
            F.when(F.col("_zeroed") == 1, F.lit(0.0)).otherwise(
                F.exp(F.sum(F.log(F.col("_factor"))).over(ascending))
            ),
        )
    )

    # RMST rectangles: S_{k-1} · (t_k − t_{k-1}), anchored at t_0 = 0, S_0 = 1.
    step = Window.partitionBy("severity").orderBy("_duration")
    prev_s = F.lag("_s", 1, 1.0).over(step)
    prev_t = F.lag("_duration", 1, 0.0).over(step)
    curve = curve.withColumn("_area", prev_s * (F.col("_duration") - prev_t))

    summary = curve.groupBy("severity").agg(
        # `<= 0.5 + eps`, not `<= 0.5`. The reference implementation multiplies the survival
        # factors directly and relies on an *inclusive* crossing to catch an exact tie -- and a
        # tie is the common case, e.g. 0.75 x (1 - 1/3) is exactly 0.5 in IEEE. Substituting
        # exp(Σ log f) for the product yields 0.5000000000000001 for that same curve, which
        # fails a bare `<= 0.5` and reports "no median" for a register whose median is real.
        F.min(F.when(F.col("_s") <= 0.5 + SURVIVAL_TIE_EPS, F.col("_duration"))).alias(
            "km_median"
        ),
        F.sum("_area").alias("_area_sum"),
        F.max_by("_s", "_duration").alias("_s_final"),
        F.max("_duration").alias("_t_final"),
    )

    out = totals.join(summary, "severity", "left")
    # ...plus the final rectangle S_m · (τ − t_m), which is what carries the censored tail.
    out = out.withColumn(
        "km_rmst",
        F.when(
            F.col("_area_sum").isNotNull(),
            F.col("_area_sum")
            + F.col("_s_final") * (F.col("km_restriction_time") - F.col("_t_final")),
        ),
    ).withColumn(
        # Survival never reached zero by τ, so the RMST is a floor, not a mean. Say so.
        "km_truncated",
        F.coalesce(F.col("_s_final") > 0, F.lit(False)),
    ).withColumn(
        # Only meaningful when the median was never reached; otherwise it is noise.
        "km_median_lower_bound",
        F.when(F.col("km_median").isNull(), F.col("km_restriction_time")),
    )

    return out.drop("_area_sum", "_s_final", "_t_final")


def mttr_by_severity(df: DataFrame) -> DataFrame:
    """MTTR, open age and SLA compliance per severity, plus an OVERALL row.

    Port of ``wiz_dashboard/domain/metrics.py::_summarize`` and ``overall_sla_oldest``.
    """
    work = df.withColumn("sla_target", _sla_target_col(F.col("severity")))

    per_sev = work.groupBy("severity").agg(*_mttr_aggs()).withColumn(
        "sla_target", _sla_target_col(F.col("severity"))
    )
    # The OVERALL SLA percentage is total-compliant over total-resolved, not a mean of the
    # per-severity percentages -- each row carries its own target, so one pass gets it right.
    overall = (
        work.groupBy(F.lit(OVERALL).alias("severity"))
        .agg(*_mttr_aggs())
        .withColumn("sla_target", F.lit(None).cast("int"))
    )

    combined = per_sev.unionByName(overall).withColumn(
        "sla_pct", safe_pct(F.col("sla_compliant"), F.col("resolved"))
    )

    # "Oldest open" as the headline KPI defines it: the worst per-severity p90, not the p90
    # over everything. Only meaningful on the OVERALL row.
    oldest = per_sev.agg(F.max("open_age_p90").alias("oldest_open_days"))
    combined = combined.crossJoin(oldest).withColumn(
        "oldest_open_days",
        F.when(F.col("severity") == OVERALL, F.col("oldest_open_days")),
    )

    # The censoring-aware estimate rides alongside the naive one. `mttr_median` stays because
    # it is what the Streamlit dashboard shows and dropping it would make the two surfaces
    # incomparable -- but `km_median` is the one to report, and it is normally larger.
    return combined.join(kaplan_meier(df), "severity", "left")


def resolution_sources(df: DataFrame) -> DataFrame:
    """How each severity's resolutions were learned, per severity plus OVERALL.

    Needs ``resolution_src``, so it only means anything over a ledger frame -- a snapshot has no
    idea how it came to know a finding was closed.

    This is the audit trail for the inference v2 rests on. ``disappeared`` resolutions were never
    stated by Wiz; we concluded them from a finding no longer being returned. That is the right
    call -- the alternative is v1, which counted them as open forever -- but it is still a
    conclusion, and a register whose closures are overwhelmingly inferred is telling you
    something about the data source rather than about the security programme. Publishing the
    split is what lets a reader notice.
    """
    counts = [
        F.sum(F.when(F.col("resolution_src") == RESOLUTION_API, 1).otherwise(0))
        .cast("long")
        .alias("resolved_api"),
        F.sum(F.when(F.col("resolution_src") == RESOLUTION_DISAPPEARED, 1).otherwise(0))
        .cast("long")
        .alias("resolved_disappeared"),
    ]
    per_sev = df.groupBy("severity").agg(*counts)
    overall = df.groupBy(F.lit(OVERALL).alias("severity")).agg(*counts)
    return per_sev.unionByName(overall)


# ------------------------------------------------- risk classification + confusion matrix


def classify_risk(df: DataFrame, rule: RiskRule) -> DataFrame:
    """Add ``risk_class`` in {high, low, unknown} -- three-valued, and the order matters.

      1. any enabled signal FIRES            -> "high"     positive evidence stands on its
                                                           own, whatever else is missing
      2. else any enabled signal NOT OBSERVED -> "unknown"  never manufacture a negative out
                                                           of missing data -- this is the trap
      3. else                                 -> "low"      every enabled signal was observed
                                                           and none of them fired

    Step 2 before step 3 is the whole thing. A row with KEV=false, exploit=false and an EPSS
    that was never captured is **unknown**, not low; calling it low is precisely how a naive
    implementation over-states efficiency.

    A rule with no signals enabled decides nothing, so everything is unknown and the numbers
    read "100% unclassified". Honest state beats a hidden fallback to the default rule.
    """
    if rule.is_empty():
        return df.withColumn("risk_class", F.lit("unknown"))

    kev_observed = F.col("has_kev").isNotNull()
    exploit_observed = F.col("has_exploit").isNotNull()
    # A NaN EPSS is as good as absent; `isNotNull() & ...` short-circuits so NULL stays FALSE.
    epss_observed = F.col("epss").isNotNull() & ~F.isnan(F.col("epss"))

    fired: List[Column] = []
    observed: List[Column] = []
    if rule.kev:
        fired.append(F.col("has_kev").eqNullSafe(True))
        observed.append(kev_observed)
    if rule.exploit:
        fired.append(F.col("has_exploit").eqNullSafe(True))
        observed.append(exploit_observed)
    if rule.epss:
        fired.append(epss_observed & (F.col("epss") >= F.lit(rule.epss_threshold)))
        observed.append(epss_observed)

    any_fired = functools.reduce(operator.or_, fired)
    any_missing = functools.reduce(operator.or_, [~o for o in observed])

    return df.withColumn(
        "risk_class",
        F.when(any_fired, F.lit("high"))
        .when(any_missing, F.lit("unknown"))
        .otherwise(F.lit("low")),
    )


def _matrix_aggs() -> List[Column]:
    """The six counts. The unclassified pair is kept OUTSIDE the 2x2 so it can never be
    mistaken for a quadrant."""
    high = F.col("risk_class") == "high"
    low = F.col("risk_class") == "low"
    unknown = F.col("risk_class") == "unknown"
    open_ = F.col("is_open")

    def count_when(condition: Column, alias: str) -> Column:
        return F.sum(F.when(condition, 1).otherwise(0)).cast("long").alias(alias)

    return [
        count_when(high & ~open_, "tp"),  # high risk, remediated     -- the work that mattered
        count_when(low & ~open_, "fp"),  # not high risk, remediated -- effort spent elsewhere
        count_when(high & open_, "fn"),  # high risk, still open     -- unremediated risk
        count_when(low & open_, "tn"),  # not high risk, still open -- correctly deprioritized
        count_when(unknown & ~open_, "unknown_remediated"),
        count_when(unknown & open_, "unknown_open"),
    ]


def _finalize_matrix(df: DataFrame) -> DataFrame:
    """Derive totals and both rates from the six counts.

    The bounds are the extreme re-labellings of the unclassified rows, and their width IS the
    size of the doubt:

      coverage = TP / (TP + FN)
        lo  every unclassified-OPEN row was really high risk (worst case, they join FN)
        hi  every unclassified-REMEDIATED row was really high risk (they join TP)

      efficiency = TP / (TP + FP)      -- unclassified-open rows cannot affect it at all
        lo  every unclassified-remediated row was NOT high risk (they join FP)
        hi  every unclassified-remediated row WAS high risk (they join TP)
    """
    tp, fp, fn, tn = (F.col(c) for c in ("tp", "fp", "fn", "tn"))
    unknown_remediated = F.col("unknown_remediated")
    unknown_open = F.col("unknown_open")

    return (
        df.withColumn("classified", tp + fp + fn + tn)
        .withColumn("unknown", unknown_remediated + unknown_open)
        .withColumn("total", F.col("classified") + F.col("unknown"))
        .withColumn("remediated", tp + fp + unknown_remediated)
        .withColumn("open", fn + tn + unknown_open)
        .withColumn("high_risk", tp + fn)
        .withColumn("not_high_risk", fp + tn)
        .withColumn("coverage_pct", safe_pct(tp, tp + fn))
        .withColumn("coverage_lo", safe_pct(tp, tp + fn + unknown_open))
        .withColumn(
            "coverage_hi",
            safe_pct(tp + unknown_remediated, tp + unknown_remediated + fn),
        )
        .withColumn("efficiency_pct", safe_pct(tp, tp + fp))
        .withColumn("efficiency_lo", safe_pct(tp, tp + fp + unknown_remediated))
        .withColumn(
            "efficiency_hi",
            safe_pct(tp + unknown_remediated, tp + fp + unknown_remediated),
        )
        # The share of classified findings that are high risk -- exactly the efficiency a
        # program picking findings at RANDOM would score. Efficiency at or below prevalence
        # means the program is not prioritizing at all, which is what turns efficiency from a
        # number into a verdict.
        .withColumn("prevalence_pct", safe_pct(F.col("high_risk"), F.col("classified")))
        # The honesty number: every rate above is conditional on it.
        .withColumn("signal_coverage_pct", safe_pct(F.col("classified"), F.col("total")))
    )


def confusion_matrix(df: DataFrame) -> DataFrame:
    """Per-severity confusion matrices with coverage and efficiency, plus an OVERALL row.

    Expects ``risk_class`` (from ``classify_risk``) and ``is_open``. "Remediated" is the same
    status test the rest of the domain uses, so it includes findings Wiz reported as resolved
    without a timestamp.
    """
    per_sev = df.groupBy("severity").agg(*_matrix_aggs())
    overall = df.groupBy(F.lit(OVERALL).alias("severity")).agg(*_matrix_aggs())
    return _finalize_matrix(per_sev.unionByName(overall))


def signal_breakdown(df: DataFrame, rule: RiskRule) -> DataFrame:
    """How many rows each enabled clause fires on, and how many never captured it.

    The clauses are OR'd, so a row can be counted under several: these do NOT sum to
    ``any_of``, and any report showing them must say so rather than presenting a partition.
    """
    epss_observed = F.col("epss").isNotNull() & ~F.isnan(F.col("epss"))

    def count_when(condition: Column, alias: str) -> Column:
        return F.sum(F.when(condition, 1).otherwise(0)).cast("long").alias(alias)

    false_col = F.lit(False)
    return df.agg(
        count_when(F.col("has_kev").eqNullSafe(True) if rule.kev else false_col, "kev"),
        count_when(
            F.col("has_exploit").eqNullSafe(True) if rule.exploit else false_col, "exploit"
        ),
        count_when(
            (epss_observed & (F.col("epss") >= F.lit(rule.epss_threshold)))
            if rule.epss
            else false_col,
            "epss",
        ),
        count_when(F.col("risk_class") == "high", "any_of"),
        count_when(F.col("has_kev").isNull() if rule.kev else false_col, "kev_missing"),
        count_when(
            F.col("has_exploit").isNull() if rule.exploit else false_col, "exploit_missing"
        ),
        count_when(~epss_observed if rule.epss else false_col, "epss_missing"),
    )


# -------------------------------------------------------------------------- capacity


def capacity_by_month(
    df: DataFrame,
    now_ts: str,
    *,
    high_risk_only: bool = False,
    observed_from=None,
    closed_observed: Optional[DataFrame] = None,
) -> DataFrame:
    """Monthly remediation capacity: how much of the backlog closes per month, and whether
    closures keep up with arrivals.

    Buckets the findings' own ``first_detected_at`` / ``resolved_at`` by **UTC calendar
    month**, which sidesteps scan cadence entirely -- months are wall-clock intervals and
    every row carries wall-clock dates. (Set ``spark.sql.session.timeZone`` to UTC; the
    pipeline does.)

    ``high_risk_only`` restricts to high-risk lifecycles, the population P2P v3 defines net
    remediation capacity over. It needs ``risk_class``, so run ``classify_risk`` first.

    ``observed_from`` is the timestamp of the earliest scan on record. Months before it are
    marked ``reconstructed``: their opens and closes are back-dated from the API's own
    ``firstDetectedAt`` / ``resolvedAt``, not watched by us. That distinction is the difference
    between measured capacity and inferred capacity, and v1 could not draw it -- so a register
    three weeks old showed two years of confident monthly throughput. Pass ``None`` and every
    month reads as observed, which is only honest before any scan has been logged.

    ``closed_observed`` is an optional ``(month, closed_observed)`` frame counting the
    resolutions reconciliation itself recorded, bucketed by the month of the scan that found
    them. It is the independent cross-check on ``closed``, which is derived from ``resolved_at``
    instead. The two should broadly track each other; where they do not, one of them is wrong,
    and the only way a reader can notice is if both are on the table.
    """
    rows = df.filter(F.col("first_detected_at").isNotNull())
    if high_risk_only:
        rows = rows.filter(F.col("risk_class") == "high")

    now = F.lit(now_ts).cast("timestamp")
    current_month = F.date_trunc("month", now)

    # The month grid, built lazily from a one-row bounds frame so no driver round-trip is
    # needed. Months with no activity must still appear -- a silent gap reads as a good month.
    grid = (
        rows.agg(F.date_trunc("month", F.min("first_detected_at")).alias("start"))
        .select(
            F.explode(
                F.sequence(F.col("start"), current_month, F.expr("INTERVAL 1 MONTH"))
            ).alias("month")
        )
    )

    opened = rows.groupBy(
        F.date_trunc("month", F.col("first_detected_at")).alias("month")
    ).agg(F.count(F.lit(1)).cast("long").alias("opened"))
    closed = (
        rows.filter(F.col("resolved_at").isNotNull())
        .groupBy(F.date_trunc("month", F.col("resolved_at")).alias("month"))
        .agg(F.count(F.lit(1)).cast("long").alias("closed"))
    )

    months = (
        grid.join(opened, "month", "left")
        .join(closed, "month", "left")
        .fillna(0, subset=["opened", "closed"])
    )

    # open_at_start = everything opened before this month, minus everything closed before it.
    # Algebraically the same as counting rows with first < start and (resolved is null or
    # resolved >= start), but O(n) instead of a cross join. The window is unpartitioned by
    # design: there is one row per month, so this is tens of rows, not millions.
    before = Window.orderBy("month").rowsBetween(Window.unboundedPreceding, -1)
    open_at_start = F.coalesce(F.sum("opened").over(before), F.lit(0)) - F.coalesce(
        F.sum("closed").over(before), F.lit(0)
    )

    months = (
        months.withColumn("open_at_start", open_at_start)
        # Mean Monthly Close Rate: the share of the open backlog closed this month. The P2P v3
        # headline is that a typical organisation closes about 1 in 10, whatever its size.
        .withColumn("mmcr", safe_pct(F.col("closed"), F.col("open_at_start")))
        .withColumn("net", F.col("closed") - F.col("opened"))
        .withColumn("net_pct", safe_pct(F.col("closed") - F.col("opened"), F.col("open_at_start")))
        # The current month is not over. Never extrapolated, and excluded from the mean --
        # otherwise the headline dips every time you look early in a month.
        .withColumn("partial", F.col("month") == current_month)
    )
    months = months.withColumn("verdict", _verdict(F.col("net_pct")))

    # Months that predate the first scan were never watched -- their activity is reconstructed
    # from the API's dates. Flagged, not dropped: the backlog they describe is real and
    # open_at_start depends on them, but "we closed 40 in March" is not evidence of capacity
    # when nobody was looking in March.
    if observed_from is None:
        months = months.withColumn("reconstructed", F.lit(False))
    else:
        first_observed_month = F.date_trunc("month", F.lit(observed_from).cast("timestamp"))
        months = months.withColumn("reconstructed", F.col("month") < first_observed_month)

    if closed_observed is None:
        months = months.withColumn("closed_observed", F.lit(None).cast("long"))
    else:
        months = months.join(
            closed_observed.select(
                F.col("month"), F.col("closed_observed").cast("long").alias("closed_observed")
            ),
            "month",
            "left",
        )

    # Scan-grain summary attached to every month row, so one table answers both "how did July
    # go" and "are we gaining ground overall" without a second read.
    #
    # Reconstructed months are excluded alongside partial ones, and for the same reason: the
    # headline "we close about 1 in N" is a claim about throughput we measured. On a register
    # whose history was rebuilt from bronze this can leave few months standing, or none --
    # which is why `months_counted` is published beside it. A small honest sample beats a large
    # confident one built out of months nobody watched.
    counted = months.filter(
        ~F.col("partial") & ~F.col("reconstructed") & F.col("mmcr").isNotNull()
    )
    summary = counted.agg(
        F.avg("mmcr").alias("mmcr_mean"),
        F.avg("net_pct").alias("mean_net_pct"),
        F.count(F.lit(1)).cast("long").alias("months_counted"),
    ).crossJoin(months.agg(F.sum("net").cast("long").alias("net_total")))

    summary = summary.withColumn(
        # The P2P v3 idiom: "we close about 1 in N of the backlog each month".
        "one_in_n",
        F.when(F.col("mmcr_mean") > 0, 100 / F.col("mmcr_mean")),
    ).withColumn(
        "overall_verdict",
        F.when(F.col("months_counted") > 0, _verdict(F.col("mean_net_pct"))),
    ).drop("mean_net_pct")

    return months.crossJoin(summary)


def _verdict(net_pct: Column) -> Column:
    """gaining / keeping-up / falling-behind, with a dead band around zero so a one-finding
    swing cannot flip a month's verdict."""
    return (
        F.when(
            net_pct.isNull() | (F.abs(net_pct) <= NET_CAPACITY_BAND_PCT),
            F.lit("keeping-up"),
        )
        .when(net_pct > 0, F.lit("gaining"))
        .otherwise(F.lit("falling-behind"))
    )


def observation_window_days(df: DataFrame, now_ts: str) -> DataFrame:
    """Age in days of the register's observation window -- context for the capacity table."""
    now = F.lit(now_ts).cast("timestamp")
    return df.agg(
        (
            (F.unix_timestamp(now) - F.unix_timestamp(F.min("first_detected_at")))
            / SECONDS_PER_DAY
        ).alias("observation_window_days")
    )


def with_scan_columns(df: DataFrame, scan_id: str, scan_ts: str, scope: str) -> DataFrame:
    """Stamp a gold frame with the scan it came from, so re-runs accumulate into a trend
    instead of overwriting each other, and with the scope so the row says which population it
    describes even when read outside its own table."""
    return (
        df.withColumn("scan_id", F.lit(scan_id))
        .withColumn("scan_ts", F.lit(scan_ts).cast("timestamp"))
        .withColumn("scope", F.lit(scope))
    )
