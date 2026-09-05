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
series, are in direct tension, and are meaningless apart -- so both are always emitted
together. ``gas/src/domain/program.ts`` is the reference implementation.

-------------------------------------------------------------------------------------------
P2P IS THE SOURCE OF THE FORMULAS, NOT A BENCHMARK THESE NUMBERS CAN BE READ AGAINST.
P2P scores a remediation strategy against an *independent* ground truth -- exploitation
observed in the wild, which lands on roughly 2-5% of CVEs. We have no such ground truth, only
the signals in ``RiskRule``. So "high risk" here is **our own prioritization rule**, and this
matrix measures what the register did against that rule rather than against reality. It is
the same move the Kenna product makes, and it is fine -- as long as nobody quotes the number
as if it were P2P's. Three things follow:

  * The published industry figures (v2's 70% coverage at 18.5% efficiency, v4's finding that
    most firms never cross 50% efficiency) are NOT a peer for ours. Their positive class is
    far rarer than ours, so our efficiency reads higher and means less.
  * The baseline that IS a peer is computed here and published beside every rate:
    ``prevalence_pct``, the efficiency a program picking findings at RANDOM would score.
    Read efficiency against that, never against 18.5%.
  * ``config.SCOPES`` pins ``hasFix: true``, which keeps awaiting-vendor-fix findings out of
    coverage's denominator. Deliberate, and one more reason the baselines are not comparable.

Two further departures from how P2P counts, neither of them wrong but both worth knowing:
rows are **finding-instances** (one per ``vuln_key`` = CVE x component x asset), so a CVE on
5,000 hosts weighs 5,000; and the matrix is **cumulative over the whole ledger**, not scoped
to a period, so the appended per-scan series is a to-date curve rather than a monthly one.
-------------------------------------------------------------------------------------------

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
    ArrayType,
    BooleanType,
    DoubleType,
    LongType,
    StringType,
    StructField,
    StructType,
)

from config import (
    AI_VERDICTS_HIGH,
    ASSET_GROUP_UNKNOWN,
    CWE_ANCESTORS,
    DEFAULT_SCOPE,
    EXPLOITED_CWES,
    NET_CAPACITY_BAND_PCT,
    OVERALL,
    POPULATION_ALL,
    POPULATION_HIGH_RISK,
    RESOLUTION_API,
    RESOLUTION_DISAPPEARED,
    RESOLVED_STATUSES,
    RiskRule,
    SastRiskRule,
    SEVERITY_ORDER,
    SLA_TARGETS,
    SOURCES,
)

# See config.PIPELINE_VERSION: every runtime module must come from the same upload.
MODULE_VERSION = "1.0-devsecops"

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
        # Only asked for by the scopes that group on it -- see ingest._ARTIFACT_SCOPES. An
        # ARRAY because the SAST node proves the sibling field is one (`["JAVA"]`), and because
        # `from_json` degrades a wrong guess to NULL rather than failing: if this is a scalar
        # server-side, the column reads NULL and every asset row falls into the single UNKNOWN
        # group, which is visible on the page rather than silently wrong.
        StructField(
            "artifactType",
            StructType([StructField("codeLibraryLanguage", ArrayType(StringType()))]),
        ),
    ]
)

# The static-analysis node. A different connection, so a different shape -- and notably no
# timestamps and none of the three exploit signals. See ingest.SAST_QUERY.
SAST_NODE_SCHEMA = StructType(
    [
        StructField("id", StringType()),
        StructField("name", StringType()),
        StructField("status", StringType()),
        # The one timestamp ``SASTFinding`` has (see ``ingest._SAST_QUERY_TEMPLATE``). Declared
        # StringType and cast in the projection, exactly like ``firstDetectedAt`` above: a
        # TimestampType field here would put date parsing inside ``from_json``, where a value it
        # cannot read takes the whole node to NULL rather than the one column.
        StructField("createdAt", StringType()),
        StructField("severity", StringType()),
        StructField("originalSeverity", StringType()),
        StructField("filePath", StringType()),
        StructField("startLine", LongType()),
        StructField("codeLibraryLanguage", ArrayType(StringType())),
        StructField("origin", StringType()),
        StructField("resolutionReason", StringType()),
        StructField(
            "resource",
            StructType(
                [
                    StructField("id", StringType()),
                    StructField("name", StringType()),
                    StructField("type", StringType()),
                ]
            ),
        ),
        StructField("weaknesses", ArrayType(StructType([StructField("id", StringType())]))),
        StructField("aiAnalysis", StructType([StructField("verdict", StringType())])),
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


def sla_target_col(severity: Column) -> Column:
    """The SLA target in days for a severity, or NULL for one that has none.

    Public because the notebook layer needs it: ``ledger.lifecycle_frame`` does not carry
    ``sla_target``, and a panel that wants "open past SLA" per subscription has to apply each
    row's *own* severity target rather than the group's.

    ``UNKNOWN`` is deliberately absent from ``SLA_TARGETS`` and so maps to NULL. Every consumer
    has to keep it NULL rather than letting it collapse to 0 -- see ``safe_pct``.
    """
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


def silver_findings(bronze: DataFrame, scope: str = DEFAULT_SCOPE) -> DataFrame:
    """Typed, metric-ready rows from the bronze ``node_json`` payload.

    Expects ``scan_id`` (string), ``scan_ts`` (timestamp), ``scope`` (string) and ``node_json``
    (string). ``scan_ts`` doubles as "now" for open-age: ages are measured as of the scan that
    observed the finding, so a table row means the same thing whenever it is read back.
    ``scope`` rides along so a row still says which population it came from after a UNION.

    ``scope`` also chooses the projection, because two scopes read a different API connection
    and therefore a different node shape. This is one of exactly two dispatch sites on
    ``Source.kind``; the other is ``ingest.query_for``. Both projections emit the **same
    columns**, which is what keeps ``ledger.py`` unaware that a second source exists.
    """
    if SOURCES.get(scope, SOURCES[DEFAULT_SCOPE]).kind == "sast":
        return silver_sast(bronze)

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
        # Static-analysis inputs: NULL here, present so both projections emit the same columns.
        F.lit(None).cast("string").alias("cwe"),
        _first_language(F.col("node.artifactType.codeLibraryLanguage")).alias("language"),
        F.lit(None).cast("string").alias("ai_verdict"),
    )

    return _with_durations(df)


def _first_language(column: Column) -> Column:
    """The ecosystem, as a single value, from a field the API returns as an array.

    First rather than exploded: P2P v5 groups each asset into exactly one category, and a
    finding that reports two languages would otherwise be counted in both and double every
    density figure. An empty array is NULL, not an empty string -- ``asset_profile`` coalesces
    NULL into a single UNKNOWN group, and "" would sit beside it as a second one.
    """
    return F.when(F.size(column) > 0, F.element_at(column, 1))


def _with_durations(df: DataFrame) -> DataFrame:
    """``mttr_days`` and ``age_days``, shared by both silver projections.

    Seconds / 86400, never calendar days -- matching metrics._summarize and
    ledgerCore.baseRows, so a fix eight hours after detection reads as 0.33 days.
    """
    mttr_days = (
        F.unix_timestamp("resolved_at") - F.unix_timestamp("first_detected_at")
    ) / SECONDS_PER_DAY
    age_days = (
        F.unix_timestamp("scan_ts") - F.unix_timestamp("first_detected_at")
    ) / SECONDS_PER_DAY

    return df.withColumn("mttr_days", mttr_days).withColumn(
        "age_days", F.when(F.col("resolved_at").isNull(), age_days)
    )


def silver_sast(bronze: DataFrame) -> DataFrame:
    """The same silver columns, projected from a ``sastFindings`` node.

    Three of the mappings are worth stating out loud, because the column names were chosen for
    the CVE register and mean something adjacent here:

    ``cve``        the weakness title ("SQL Injection"), not an identifier. Reused rather than
                   paralleled: it is the column every existing panel groups on to answer "what
                   kind of thing is this", and that question has the same answer here. The
                   identifier-shaped value lives in ``cwe``.
    ``component``  the file path. The located artefact, which is what ``detailedName`` is for a
                   package.
    ``asset_*``    the repository branch, from ``resource``. A plain object rather than the
                   union ``vulnerableAsset`` is, so none of the FETCH_ASSET_FIELDS trouble
                   applies and these columns are populated unconditionally.

    **Three columns are unconditionally NULL**: ``has_kev``, ``has_exploit`` and ``epss``. That
    is the point of ``config.SastRiskRule`` existing at all, and under ``RiskRule`` every row
    here would classify `unknown` -- correctly, and uselessly.

    **The clock is half measured and half inferred, and the row says which half.**
    ``first_detected_at`` is the API's own ``createdAt`` -- a real birth date, which the ledger
    prefers over the scan that first saw the finding. ``resolved_at`` stays NULL, because
    ``SASTFinding`` has no ``resolvedAt`` (see ``config.SAST_FETCH_RESOLVED``): a death date
    arrives only when a later scan stops returning the finding, and lands with
    ``resolution_src = 'disappeared'`` so a reader can discount it by the scan interval.
    A scan taken before ``createdAt`` was selected holds no such column in bronze, so
    ``first_detected_at`` is NULL there and the ledger falls back to observation.

    ``fix_date`` is NULL and stays NULL. A weakness in first-party code has no vendor to ship a
    fix, so there is no second clock to start -- the same reason ``_BASE``'s ``hasFix`` is left
    off this scope's filter.
    """
    node = F.from_json(F.col("node_json"), SAST_NODE_SCHEMA).alias("node")
    seq = F.col("seq") if "seq" in bronze.columns else F.lit(None).cast("long")
    parsed = bronze.select("scan_id", "scan_ts", "scope", seq.alias("seq"), node)

    null_ts = F.lit(None).cast("timestamp")
    df = parsed.select(
        F.col("scan_id"),
        F.col("scan_ts"),
        F.col("scope"),
        F.col("seq"),
        F.col("node.id").alias("finding_id"),
        F.col("node.name").alias("cve"),
        F.col("node.filePath").alias("component"),
        # `originalSeverity` is the scanner's own call before any Wiz policy adjusted it, so it
        # is the fallback rather than the primary -- the register should read the severity the
        # programme is actually managing to.
        normalize_severity(
            F.coalesce(F.col("node.severity"), F.col("node.originalSeverity"))
        ).alias("severity"),
        F.col("node.status").alias("status"),
        is_open(F.col("node.status")).alias("is_open"),
        F.col("node.createdAt").cast("timestamp").alias("first_detected_at"),
        null_ts.alias("last_detected_at"),
        null_ts.alias("resolved_at"),
        null_ts.alias("fix_date"),
        F.lit(None).cast("string").alias("fixed_version"),
        F.col("node.resource.id").alias("asset_id"),
        F.col("node.resource.name").alias("asset_name"),
        F.col("node.resource.type").alias("asset_type"),
        F.lit(None).cast("string").alias("cloud"),
        F.lit(None).cast("string").alias("subscription_name"),
        F.lit(None).cast("string").alias("subscription_ext_id"),
        F.lit(None).cast("boolean").alias("has_kev"),
        F.lit(None).cast("boolean").alias("has_exploit"),
        F.lit(None).cast("double").alias("epss"),
        # Comma-separated rather than an array: see config.LEDGER_COLUMNS. Sorted so the same
        # set of weaknesses always produces the same string, which matters because this value
        # is merged into the ledger and compared against the previous scan's.
        _joined_cwes(F.col("node.weaknesses")).alias("cwe"),
        _first_language(F.col("node.codeLibraryLanguage")).alias("language"),
        F.upper(F.trim(F.col("node.aiAnalysis.verdict"))).alias("ai_verdict"),
    )

    return _with_durations(df)


def _joined_cwes(weaknesses: Column) -> Column:
    """``weaknesses[].id`` as a sorted, comma-separated string -- NULL when there are none.

    NULL, not "": the CWE clause treats an absent weakness as *not observed*, which makes the
    finding unclassified rather than low risk. That is the module header's correctness trap
    applied to a second rule.
    """
    ids = F.array_sort(F.array_distinct(F.filter(
        F.transform(weaknesses, lambda w: F.trim(w["id"])),
        lambda x: x.isNotNull() & (F.length(x) > 0),
    )))
    return F.when(F.size(ids) > 0, F.array_join(ids, ","))


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


def km_curve(df: DataFrame):
    """The Kaplan-Meier staircase itself, per severity plus OVERALL, and the raw totals.

    Returns ``(curve, totals)``:

    * ``curve`` -- one row per distinct *event* time: ``severity, t, events, at_risk, s``.
      This is the survival function S(t) as a step function; between two rows it is flat, so a
      chart draws it with a stepped-after line and nothing else.
    * ``totals`` -- ``severity, km_restriction_time, km_events, km_censored``, computed before
      the curve narrows to event times.

    Split out of ``kaplan_meier`` rather than reimplemented for the notebook layer, because the
    two must not be able to disagree: a staircase whose 50% crossing landed somewhere other than
    the published ``km_median`` would be worse than no staircase at all. ``kaplan_meier``
    consumes exactly this.

    Note what ``totals`` can and cannot be recovered from ``curve``: ``km_restriction_time`` is
    the longest observed duration over *all* observations, and the longest-lived observation is
    usually still open, so ``max(curve.t) < km_restriction_time`` is the normal case, not a bug.
    Likewise the censored rows leave no row of their own. That is why both come back together.
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
        F.sum("_is_event").cast("long").alias("events"),
        F.count(F.lit(1)).cast("long").alias("_n_here"),
    )

    # atRisk = everything at or beyond this time, i.e. a reverse cumulative count.
    descending = (
        Window.partitionBy("severity")
        .orderBy(F.col("_duration").desc())
        .rowsBetween(Window.unboundedPreceding, Window.currentRow)
    )
    at_time = at_time.withColumn("at_risk", F.sum("_n_here").over(descending))

    # The curve is defined at event times only; a time with no event does not step it down.
    curve = at_time.filter((F.col("events") > 0) & (F.col("at_risk") > 0))
    factor = 1 - (F.col("events") / F.col("at_risk"))

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
            "s",
            F.when(F.col("_zeroed") == 1, F.lit(0.0)).otherwise(
                F.exp(F.sum(F.log(F.col("_factor"))).over(ascending))
            ),
        )
    )
    curve = curve.withColumnRenamed("_duration", "t").select(
        "severity", "t", "events", "at_risk", "s"
    )
    return curve, totals


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
    curve, totals = km_curve(df)

    # RMST rectangles: S_{k-1} · (t_k − t_{k-1}), anchored at t_0 = 0, S_0 = 1.
    step = Window.partitionBy("severity").orderBy("t")
    prev_s = F.lag("s", 1, 1.0).over(step)
    prev_t = F.lag("t", 1, 0.0).over(step)
    curve = curve.withColumn("_area", prev_s * (F.col("t") - prev_t))

    summary = curve.groupBy("severity").agg(
        # `<= 0.5 + eps`, not `<= 0.5`. The reference implementation multiplies the survival
        # factors directly and relies on an *inclusive* crossing to catch an exact tie -- and a
        # tie is the common case, e.g. 0.75 x (1 - 1/3) is exactly 0.5 in IEEE. Substituting
        # exp(Σ log f) for the product yields 0.5000000000000001 for that same curve, which
        # fails a bare `<= 0.5` and reports "no median" for a register whose median is real.
        F.min(F.when(F.col("s") <= 0.5 + SURVIVAL_TIE_EPS, F.col("t"))).alias("km_median"),
        F.sum("_area").alias("_area_sum"),
        F.max_by("s", "t").alias("_s_final"),
        F.max("t").alias("_t_final"),
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
    work = df.withColumn("sla_target", sla_target_col(F.col("severity")))

    per_sev = work.groupBy("severity").agg(*_mttr_aggs()).withColumn(
        "sla_target", sla_target_col(F.col("severity"))
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


def _cve_clauses(rule: RiskRule) -> List[tuple]:
    """``(name, fired, observed)`` per enabled signal of the CVE rule."""
    # A NaN EPSS is as good as absent; `isNotNull() & ...` short-circuits so NULL stays FALSE.
    epss_observed = F.col("epss").isNotNull() & ~F.isnan(F.col("epss"))

    clauses = []
    if rule.kev:
        clauses.append(
            ("kev", F.col("has_kev").eqNullSafe(True), F.col("has_kev").isNotNull())
        )
    if rule.exploit:
        clauses.append(
            ("exploit", F.col("has_exploit").eqNullSafe(True), F.col("has_exploit").isNotNull())
        )
    if rule.epss:
        clauses.append(
            (
                "epss",
                epss_observed & (F.col("epss") >= F.lit(rule.epss_threshold)),
                epss_observed,
            )
        )
    return clauses


def cwe_matches_exploited(cwe: Column) -> Column:
    """True when any of a finding's CWEs -- or a documented ancestor of one -- is in the list.

    The ancestor hop is what makes this usable at all: scanners report leaves (CWE-23, Relative
    Path Traversal) and the Top 25 holds interior nodes (CWE-22, Path Traversal). See
    ``config.CWE_ANCESTORS`` for why that map is deliberately incomplete and what it costs.
    """
    ids = F.split(cwe, ",")
    lifted = F.transform(
        ids, lambda c: F.coalesce(F.create_map(*_ancestor_pairs())[c], c)
    )
    listed = F.array(*[F.lit(c) for c in sorted(EXPLOITED_CWES)])
    return F.arrays_overlap(F.array_union(ids, lifted), listed)


def _ancestor_pairs() -> List[Column]:
    pairs: List[Column] = []
    for child, parent in sorted(CWE_ANCESTORS.items()):
        pairs.extend([F.lit(child), F.lit(parent)])
    return pairs


def _sast_clauses(rule: SastRiskRule) -> List[tuple]:
    """``(name, fired, observed)`` per enabled signal of the static-analysis rule.

    Each signal's *observed* test is the one that decides whether a finding can be classified
    at all, and each is deliberately strict: a blank CWE, a missing AI verdict and an UNKNOWN
    severity are all "never captured", not "captured as no".
    """
    cwe = F.col("cwe")
    cwe_observed = cwe.isNotNull() & (F.length(F.trim(cwe)) > 0)
    verdict = F.col("ai_verdict")
    verdict_observed = verdict.isNotNull() & (F.length(F.trim(verdict)) > 0)
    severity_observed = F.col("severity").isNotNull() & (F.col("severity") != "UNKNOWN")

    clauses = []
    if rule.cwe:
        clauses.append(("cwe", cwe_observed & cwe_matches_exploited(cwe), cwe_observed))
    if rule.ai_verdict:
        listed = F.array(*[F.lit(v) for v in sorted(AI_VERDICTS_HIGH)])
        clauses.append(
            (
                "ai_verdict",
                verdict_observed & F.array_contains(listed, verdict),
                verdict_observed,
            )
        )
    if rule.critical:
        clauses.append(
            (
                "critical",
                severity_observed & (F.col("severity") == "CRITICAL"),
                severity_observed,
            )
        )
    return clauses


def rule_clauses(rule) -> List[tuple]:
    """The enabled signals of either rule, as ``(name, fired, observed)`` triples.

    The two rules differ in what they read and in nothing else, so this is the only place that
    knows which is which. Everything downstream -- the three-valued classifier, the signal
    breakdown, the sensitivity sweep -- is written once against these triples, which is what
    stops the correctness trap in the module header from having to be got right twice.
    """
    return _sast_clauses(rule) if isinstance(rule, SastRiskRule) else _cve_clauses(rule)


def classify_risk(df: DataFrame, rule) -> DataFrame:
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

    clauses = rule_clauses(rule)
    fired: List[Column] = [c[1] for c in clauses]
    observed: List[Column] = [c[2] for c in clauses]

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


#: Every signal either rule can carry, in the order the breakdown reports them. Fixed rather
#: than derived from the rule, so a disabled signal is a 0 rather than a missing column -- the
#: frame's shape must not change when somebody turns a clause off.
SIGNAL_NAMES = ("kev", "exploit", "epss", "cwe", "ai_verdict", "critical")


def signal_breakdown(df: DataFrame, rule) -> DataFrame:
    """How many rows each enabled clause fires on, and how many never captured it.

    The clauses are OR'd, so a row can be counted under several: these do NOT sum to
    ``any_of``, and any report showing them must say so rather than presenting a partition.

    ``<signal>_missing`` is the number that decides whether the rate above it is worth reading.
    Two of them are load-bearing for the static-analysis rule in particular:

      ``ai_verdict_missing`` equal to the row count means the field is not being returned, or
      ``config.AI_VERDICTS_HIGH`` holds the wrong strings -- both of which silence the clause
      without any other symptom.
      ``cwe_unmapped`` counts findings that HAVE a CWE which matched neither the Top 25 nor a
      documented ancestor of it. Those classify `low`, so this is the size of the gap in
      ``config.CWE_ANCESTORS`` measured in findings.
    """
    enabled = {name: (fired, observed) for name, fired, observed in rule_clauses(rule)}

    def count_when(condition: Column, alias: str) -> Column:
        return F.sum(F.when(condition, 1).otherwise(0)).cast("long").alias(alias)

    false_col = F.lit(False)
    aggs: List[Column] = []
    for name in SIGNAL_NAMES:
        fired = enabled[name][0] if name in enabled else false_col
        aggs.append(count_when(fired, name))
    aggs.append(count_when(F.col("risk_class") == "high", "any_of"))
    for name in SIGNAL_NAMES:
        missing = ~enabled[name][1] if name in enabled else false_col
        aggs.append(count_when(missing, f"{name}_missing"))

    cwe_observed = F.col("cwe").isNotNull() & (F.length(F.trim(F.col("cwe"))) > 0)
    aggs.append(
        count_when(
            (cwe_observed & ~cwe_matches_exploited(F.col("cwe")))
            if "cwe" in enabled
            else false_col,
            "cwe_unmapped",
        )
    )
    return df.agg(*aggs)


# The seven non-empty signal subsets, in the order ``gas/src/domain/program.ts::ruleSensitivity``
# uses. The single-signal labels say "only" where GAS says just "KEV" -- brick's notebook layer
# chose the clearer wording first and `panels.rule_sweep` walks this tuple through
# `subsets_for`, so the two surfaces here cannot drift apart even though the wording differs
# slightly from GAS's.
RULE_SUBSETS = (
    ("KEV only", True, False, False),
    ("Exploit only", False, True, False),
    ("EPSS only", False, False, True),
    ("KEV or exploit", True, True, False),
    ("KEV or EPSS", True, False, True),
    ("Exploit or EPSS", False, True, True),
    ("All three", True, True, True),
)

# The same seven subsets over the static-analysis rule's three signals, in the same order. The
# table matters more here than it does for the CVE register, not less: that rule at least reads
# somebody else's prediction about exploitation, where this one reads a weakness class and a
# severity somebody typed. How much of a SAST coverage figure is the rule is the first question
# to ask about it.
SAST_RULE_SUBSETS = (
    ("CWE only", True, False, False),
    ("AI verdict only", False, True, False),
    ("CRITICAL only", False, False, True),
    ("CWE or AI verdict", True, True, False),
    ("CWE or CRITICAL", True, False, True),
    ("AI verdict or CRITICAL", False, True, True),
    ("All three", True, True, True),
)


def subsets_for(active) -> List[tuple]:
    """``(label, rule, flag_columns, active)`` for each of the seven non-empty subsets.

    ``flag_columns`` names the booleans that describe the rule on each row, and they differ
    between the two rules because the signals do -- ``rule_kev``/``rule_exploit``/``rule_epss``
    against ``rule_cwe``/``rule_ai_verdict``/``rule_critical``. That is fine and deliberate: the
    sensitivity table is per-scope, so no single table ever holds both shapes.
    """
    if isinstance(active, SastRiskRule):
        rows = []
        for label, cwe, ai_verdict, critical in SAST_RULE_SUBSETS:
            rule = SastRiskRule(cwe=cwe, ai_verdict=ai_verdict, critical=critical)
            rows.append((
                label,
                rule,
                {"rule_cwe": cwe, "rule_ai_verdict": ai_verdict, "rule_critical": critical},
                (cwe, ai_verdict, critical)
                == (active.cwe, active.ai_verdict, active.critical),
            ))
        return rows

    rows = []
    for label, kev, exploit, epss in RULE_SUBSETS:
        rule = RiskRule(
            kev=kev, exploit=exploit, epss=epss, epss_threshold=active.epss_threshold
        )
        rows.append((
            label,
            rule,
            {
                "rule_kev": kev,
                "rule_exploit": exploit,
                "rule_epss": epss,
                "epss_threshold": rule.epss_threshold,
            },
            # The three booleans only, matching program.ts -- the threshold is inherited, so it
            # cannot be what distinguishes the active row.
            (kev, exploit, epss) == (active.kev, active.exploit, active.epss),
        ))
    return rows


def rule_sensitivity(df: DataFrame, active) -> DataFrame:
    """Coverage and efficiency under each of the seven non-empty signal subsets.

    Port of ``gas/src/domain/program.ts::ruleSensitivity``. One row per subset, carrying the
    full confusion matrix plus the flags describing the rule that produced it, with the
    currently-configured rule marked ``active``. The EPSS threshold is inherited from ``active``
    rather than swept, so the only thing varying across rows is which signals are switched on --
    same as the reference implementation, which compares the three booleans and nothing else.

    **This is rule sensitivity, not strategy comparison, and the distinction is the reason the
    table exists.** P2P vol. 9's Figure 19 plots candidate remediation strategies against an
    independent ground truth -- exploitation observed in the wild. We have no such ground truth,
    only these same signals, so each subset here is scored against itself and no subset can come
    out "wrong": a narrow rule simply reports a high rate over a small high-risk population.
    What it does answer is the question a reader of a rule-defined metric genuinely needs --
    **how much of the headline is the rule rather than the register?** ``high_risk`` and
    ``unknown`` ride along on every row precisely so that a subset which buys efficiency by
    shrinking the positive class, or by pushing rows into ``unknown``, cannot hide it.

    Seven aggregations over a frame the caller has already cached, all of them the same
    ``_matrix_aggs`` the headline uses -- linear in the register, so it is computed
    unconditionally rather than behind a flag. The *plan* is correspondingly seven times wider,
    which costs nothing on a cluster and is very visible in the local test suite; if that ever
    needs fixing, the shape to reach for is one pass emitting all seven subsets' counts as
    columns, not a flag that lets the table go missing.
    """
    frames: List[DataFrame] = []
    for label, rule, flags, is_active in subsets_for(active):
        # classify_risk overwrites `risk_class`, so a frame already classified under the active
        # rule is a valid input -- which is what the caller has.
        frame = (
            classify_risk(df, rule)
            .groupBy(F.lit(label).alias("rule_label"))
            .agg(*_matrix_aggs())
        )
        for column, value in flags.items():
            frame = frame.withColumn(column, F.lit(value))
        frames.append(
            frame.withColumn("rule_sentence", F.lit(rule.sentence())).withColumn(
                "active", F.lit(is_active)
            )
        )
    return _finalize_matrix(functools.reduce(DataFrame.unionByName, frames))


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


def capacity_populations(
    df: DataFrame,
    now_ts: str,
    *,
    observed_from=None,
    closed_observed: Optional[DataFrame] = None,
) -> DataFrame:
    """``capacity_by_month`` over both populations, stacked and tagged with ``population``.

    P2P v3 defines net remediation capacity over the **high-risk** population, and the
    reference implementation is called that way on its production surface
    (``gas/src/server/api.ts:859`` passes ``highRiskOnly: true``). This pipeline published only
    the all-findings figure, which answers "how much of the backlog moves" but not the question
    P2P actually asks -- "are we closing high risk faster than it arrives". The two routinely
    disagree, and which one you meant is not recoverable from a single unlabelled number, so
    both are emitted and every reader has to say which.

    Needs ``risk_class`` for the high-risk half, so run ``classify_risk`` first.

    Two things that are deliberately not shared between the halves:

    * **``closed_observed`` is attached to the ``all`` rows only.** It is reconciliation's own
      resolution count, and reconciliation does not label risk -- so against the high-risk rows
      it would be a cross-check between two different populations, which is worse than no
      cross-check at all. It stays NULL there rather than inviting the comparison.
    * **The month grid is built per population**, from that population's own earliest
      ``first_detected_at``. A register whose first high-risk finding arrived a year after its
      first finding has a shorter high-risk series, which is the honest shape.

    A register with no high-risk lifecycles at all contributes no ``high_risk`` rows -- the
    grid is empty, so there is nothing to say and nothing is said.
    """
    every = capacity_by_month(
        df, now_ts, observed_from=observed_from, closed_observed=closed_observed
    ).withColumn("population", F.lit(POPULATION_ALL))
    high = capacity_by_month(
        df,
        now_ts,
        high_risk_only=True,
        observed_from=observed_from,
        closed_observed=None,
    ).withColumn("population", F.lit(POPULATION_HIGH_RISK))
    return every.unionByName(high)


# ---------------------------------------------------------- P2P v5: assets at risk
#
# The four families above are vulnerability-centric, which is how P2P volumes 1-4 count. Volume
# 5 changes the unit: "vulnerability management is often asset-centric ... the fact that we
# manage vulnerabilities in assets rather than in a vacuum requires us to know where risk isn't,
# where it is now, and where it will eventually be."
#
# For a code register the asset is the repository branch, and v5's asset *categories* -- it
# compares Windows against Linux against network appliances -- become the ecosystem. The
# analogy holds where it matters: a category is a group of assets that behave alike for reasons
# that are about the platform rather than about the team looking after them.
#
# What v5 measures, and what each column below is:
#
#   asset prevalence      how many assets are in scope at all              (v5 p.7)
#   vulnerability density how many findings live on a typical asset        (v5 Fig 10)
#   the foothold rate     what share of assets offer at least one          (v5 Fig 11)
#                         open high-risk finding -- "it's often said that
#                         just one opening is needed"
#   remediation coverage  per asset, not per finding                       (v5 Fig 13)
#   remediation velocity  the half-life of a finding on this kind of asset (v5 Fig 15)
#   remediation capacity  what share of assets are falling behind /        (v5 Figs 20, 21)
#                         maintaining / gaining ground
#
# The same warning that applies to `metrics_capacity` applies here: rows are written per
# population, so an unfiltered read counts every asset twice.


def _asset_group(column: Column = None) -> Column:
    """The asset category, with NULL folded into a single named group.

    A NULL language is common and means different things -- an `os` register has none, and a
    code register has none for a finding whose artifact type was not returned -- but on a page
    they are all "we do not know", and one named group says so where a NULL silently drops the
    row out of a `groupBy`.
    """
    return F.coalesce(column if column is not None else F.col("language"),
                      F.lit(ASSET_GROUP_UNKNOWN))


def _with_assets(df: DataFrame) -> DataFrame:
    """Only the findings that belong to an asset.

    Findings with no asset at all are dropped rather than collapsed into a NULL asset: they
    would otherwise merge into a single enormous phantom asset and dominate every percentile.
    That is the honest shape for an `os` register while ``config.FETCH_ASSET_FIELDS`` is off --
    it has no asset ids, so the table comes back empty and says nothing rather than something
    wrong.
    """
    return df.filter(
        F.col("asset_id").isNotNull() & (F.length(F.trim(F.col("asset_id"))) > 0)
    )


def _per_asset(rows: DataFrame, observed_from=None) -> DataFrame:
    """One row per asset: its density, its foothold, its coverage and its net flow.

    The whole v5 family is an aggregate over *this* frame, which is why it is computed once.
    Expects a frame already narrowed by ``_with_assets``.
    """
    # The window we actually watched. Before it, opens and closes are back-dated from the API's
    # own dates rather than observed -- the same distinction `capacity_by_month` draws with
    # `reconstructed`, and the reason the capacity columns below go NULL without it.
    window_start = F.lit(observed_from).cast("timestamp") if observed_from else None

    high_open = (F.col("risk_class") == "high") & F.col("is_open")
    if window_start is None:
        opened_in_window = F.lit(None).cast("long")
        closed_in_window = F.lit(None).cast("long")
        open_at_start = F.lit(None).cast("long")
    else:
        opened_in_window = F.sum(
            F.when(F.col("first_detected_at") >= window_start, 1).otherwise(0)
        ).cast("long")
        closed_in_window = F.sum(
            F.when(F.col("resolved_at") >= window_start, 1).otherwise(0)
        ).cast("long")
        open_at_start = F.sum(
            F.when(
                (F.col("first_detected_at") < window_start)
                & (F.col("resolved_at").isNull() | (F.col("resolved_at") >= window_start)),
                1,
            ).otherwise(0)
        ).cast("long")

    per_asset = rows.groupBy(
        F.col("asset_id"), _asset_group().alias("asset_group")
    ).agg(
        F.sum(F.when(F.col("is_open"), 1).otherwise(0)).cast("long").alias("density"),
        F.max(F.when(high_open, F.lit(True)).otherwise(F.lit(False))).alias("has_foothold"),
        F.sum(F.when((F.col("risk_class") == "high") & ~F.col("is_open"), 1).otherwise(0))
        .cast("long")
        .alias("tp"),
        F.sum(F.when((F.col("risk_class") == "high") & F.col("is_open"), 1).otherwise(0))
        .cast("long")
        .alias("fn"),
        opened_in_window.alias("opened"),
        closed_in_window.alias("closed"),
        open_at_start.alias("open_at_start"),
    )

    # An asset with no high-risk findings at all has no coverage -- NULL, not 0%, for the same
    # reason `safe_pct` returns NULL over an empty denominator. Including it as a zero would
    # drag the median down with assets that had nothing to remediate.
    return per_asset.withColumn(
        "asset_coverage_pct", safe_pct(F.col("tp"), F.col("tp") + F.col("fn"))
    ).withColumn(
        "net_pct", safe_pct(F.col("closed") - F.col("opened"), F.col("open_at_start"))
    ).withColumn(
        "verdict", F.when(F.col("net_pct").isNotNull(), _verdict(F.col("net_pct")))
    )


def _asset_aggs(window_months: Column) -> List[Column]:
    """The aggregate list, shared by the per-group and OVERALL passes so they cannot drift."""
    verdict = F.col("verdict")

    def share(condition: Column, alias: str) -> Column:
        return safe_pct(
            F.sum(F.when(condition, 1).otherwise(0)).cast("long"),
            F.sum(F.when(verdict.isNotNull(), 1).otherwise(0)).cast("long"),
        ).alias(alias)

    return [
        F.count(F.lit(1)).cast("long").alias("assets"),
        # v5 Fig 10 reports the 25th, 50th and 75th percentile of findings per asset, because
        # the distribution is far too skewed for a mean to describe (v5: "many with <10 but
        # some >1000"). F.percentile interpolates the way pandas does -- see the module header.
        F.percentile("density", 0.25).alias("density_p25"),
        F.percentile("density", 0.5).alias("density_p50"),
        F.percentile("density", 0.75).alias("density_p75"),
        F.sum("density").cast("long").alias("open_findings"),
        # v5 Fig 11: "just one opening is needed to successfully compromise a system".
        safe_pct(
            F.sum(F.when(F.col("has_foothold"), 1).otherwise(0)).cast("long"),
            F.count(F.lit(1)).cast("long"),
        ).alias("assets_with_high_risk_pct"),
        # The median asset's coverage, over the assets that have any high-risk finding to cover.
        F.percentile("asset_coverage_pct", 0.5).alias("asset_coverage_p50"),
        F.sum(F.when(F.col("asset_coverage_pct").isNotNull(), 1).otherwise(0))
        .cast("long")
        .alias("assets_with_high_risk"),
        # v5 Fig 20, "median proportion of vulnerabilities closed per month", per asset and then
        # medianed across the group. NULL when the observation window is unknown.
        F.percentile(
            safe_pct(F.col("closed"), F.col("open_at_start")) / window_months, 0.5
        ).alias("mmcr_p50"),
        # v5 Fig 21, as three shares that sum to 100 over the assets with a defined net flow.
        share(verdict == "falling-behind", "falling_behind_pct"),
        share(verdict == "keeping-up", "maintaining_pct"),
        share(verdict == "gaining", "gaining_pct"),
        F.sum(F.when(verdict.isNotNull(), 1).otherwise(0)).cast("long").alias("assets_flowing"),
    ]


def asset_profile(
    df: DataFrame,
    now_ts: str,
    *,
    observed_from=None,
    high_risk_only: bool = False,
) -> DataFrame:
    """P2P v5's asset-centric family, one row per asset category plus an OVERALL row.

    Expects the lifecycle frame with ``risk_class`` -- run ``classify_risk`` first.

    ``observed_from`` is the earliest scan on record, exactly as ``capacity_by_month`` takes it.
    Without it the three capacity columns and ``mmcr_p50`` are **NULL rather than computed**:
    every one of them is a rate per unit of watched time, and a register that has not recorded
    when it started watching cannot produce one. Reconstructed capacity is the specific thing
    the capacity table refuses to headline, and this table refuses it too.

    ``km_median_days`` is deliberately absent from the aggregate list and joined on separately:
    Kaplan-Meier is a per-group scan over an ordered event table, not something expressible as
    an aggregate beside a percentile.

    **The cost, since it is the second most expensive thing a run does after rule sensitivity.**
    ``asset_profile_populations`` calls this twice, and each call runs one ``kaplan_meier`` --
    which is a windowed survival scan over the ledger -- plus two grouped aggregations. Like the
    sensitivity sweep it is computed unconditionally rather than behind a flag, for the same
    reason: a table that can go missing is a table nobody can trend. ``bench_pipeline.py
    --attribute`` times it separately, which is the way to find out whether it matters on a
    register the size of yours.
    """
    rows = df.filter(F.col("risk_class") == "high") if high_risk_only else df
    # Both halves read the SAME population. `_per_asset` drops findings with no asset, and the
    # half-life has to drop them too -- otherwise a group's density is computed over its
    # repositories while its half-life is computed over those plus every asset-less finding
    # that happens to share the ecosystem, and the two columns on one row describe two
    # different sets.
    rows = _with_assets(rows)
    per_asset = _per_asset(rows, observed_from)

    if observed_from is None:
        window_months = F.lit(None).cast("double")
    else:
        months = (
            F.unix_timestamp(F.lit(now_ts).cast("timestamp"))
            - F.unix_timestamp(F.lit(observed_from).cast("timestamp"))
        ) / (SECONDS_PER_DAY * 30.4375)
        # A window shorter than a month would divide a month's throughput by a fraction and
        # report a rate nobody could have achieved. Floored at one, and `window_months` is
        # published so a reader can see how little time the number rests on.
        window_months = F.greatest(months, F.lit(1.0))

    per_group = per_asset.groupBy("asset_group").agg(*_asset_aggs(window_months))
    overall = per_asset.groupBy(F.lit(OVERALL).alias("asset_group")).agg(
        *_asset_aggs(window_months)
    )
    profile = per_group.unionByName(overall)

    half_life = _asset_half_life(rows)
    return (
        profile.join(half_life, "asset_group", "left")
        .withColumn("window_months", window_months)
        .withColumn(
            "population",
            F.lit(POPULATION_HIGH_RISK if high_risk_only else POPULATION_ALL),
        )
    )


def _asset_half_life(df: DataFrame) -> DataFrame:
    """``km_median_days`` per asset category, including the OVERALL row.

    v5 Fig 15 calls this the half-life -- the point at which half the findings on this kind of
    asset have been closed -- which is exactly the Kaplan-Meier median the MTTR family already
    publishes, computed per category instead of per severity. Same function, so the two cannot
    disagree about what a median is.

    **``kaplan_meier`` emits the OVERALL row itself** -- ``km_curve`` duplicates every row under
    that label before it aggregates -- so there is nothing to union here. Adding one produced
    two OVERALL rows, which a ``groupBy`` on the way out silently collapsed and a join silently
    doubled.
    """
    return kaplan_meier(df.withColumn("severity", _asset_group())).select(
        F.col("severity").alias("asset_group"),
        F.col("km_median").alias("km_median_days"),
        F.col("km_median_lower_bound").alias("km_median_lower_bound"),
    )


def asset_profile_populations(
    df: DataFrame, now_ts: str, *, observed_from=None
) -> DataFrame:
    """``asset_profile`` over both populations, stacked and tagged with ``population``.

    Same shape and same reasoning as ``capacity_populations``: `all` answers "how much does a
    typical repository carry", `high_risk` answers the question v5 actually asks about
    remediation, the two routinely disagree, and which one an unlabelled number meant is not
    recoverable afterwards. **Every read of this table must filter on ``population``.**
    """
    every = asset_profile(df, now_ts, observed_from=observed_from)
    high = asset_profile(df, now_ts, observed_from=observed_from, high_risk_only=True)
    return every.unionByName(high)


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
