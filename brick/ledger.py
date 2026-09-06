"""Cross-scan lifecycle reconciliation, as pure PySpark ``DataFrame -> DataFrame`` transforms.

This is what v1 did not have. v1 measured each scan in isolation, so a vulnerability's whole
history was whatever one snapshot's ``firstDetectedAt`` / ``resolvedAt`` happened to say. The
failure that mattered: a finding remediated by simply **disappearing** between scans -- which is
the ordinary shape of remediation, because Wiz stops returning what is no longer there -- was
never counted as resolved at all. Coverage under-reported, MTTR under-reported, and the capacity
table's ``closed`` column missed those closures entirely.

The ledger fixes it by giving every finding a durable identity (``vuln_key``) and remembering it
across runs: first seen, still here, gone. Metrics then come from observed lifecycles rather than
from a snapshot.

Ported from ``gas/src/domain/reconcile.ts``, which is the reference implementation of these rules
and the most complete of the three surfaces. (``wiz_dashboard/domain/reconcile.py`` is the older
port of the same lifecycle and agrees on all five branches, but it does not carry the vendor-fix
clock or the monotone risk-signal merge -- so where the two differ, GAS wins.)

Same split as everywhere else: everything here is pure, and ``run_pipeline`` is the thin layer
that loads the prior ledger, calls ``reconcile`` and MERGEs the result. That is what lets the
lifecycle rules be tested against a local ``SparkSession`` with no Delta table, no cluster and no
API in the way.

Lifecycle rules, all five:

  * **First sighting**   -> OPEN, ``first_seen = min(firstDetectedAt, scan_ts)``
  * **Persisting**       -> advance ``last_seen``; ``first_seen`` stays earliest-known
  * **API-resolved**     -> ``resolvedAt`` present, or status in RESOLVED_STATUSES
  * **Disappearance**    -> was OPEN, was in the previous scan covering its severity, absent now
  * **Reopen**           -> a RESOLVED finding is active again; a new episode begins

Three different update disciplines coexist here, and mixing them up is the easiest way to get a
wrong number out of this module:

  * **latest-observation-wins** for severity, cve and the asset attributes
  * **sticky first-wins, reset by a reopen** for the vendor-fix clock
  * **monotone, never reset** for the exploit-intelligence signals

The one structural difference from the TypeScript: that implementation walks records in a loop,
this one is a single full outer join. Same rules, expressed as columns.
"""

from __future__ import annotations

from typing import Dict, Optional, Sequence

from pyspark.sql import Column, DataFrame, SparkSession, Window
from pyspark.sql import functions as F
from pyspark.sql.types import (
    BooleanType,
    DoubleType,
    IntegerType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

from config import (
    DISAPPEARANCE_RESOLUTION,
    HAS_VENDOR_FIX,
    LEDGER_COLUMNS,
    RESOLUTION_API,
    RESOLUTION_DISAPPEARED,
    SCOPES_PINNING_HAS_FIX,
    STATUS_OPEN,
    STATUS_RESOLVED,
)
from metrics import SECONDS_PER_DAY

# The ledger's stored schema. Timestamps rather than the ISO strings the SQLite ledger keeps:
# Delta has a real timestamp type, metrics.py already does its arithmetic in
# ``unix_timestamp`` seconds, and a stored string would mean re-parsing on every read.
# See config.PIPELINE_VERSION: every runtime module must come from the same upload.
MODULE_VERSION = "2.3"

LEDGER_SCHEMA = StructType(
    [
        StructField("vuln_key", StringType(), False),
        StructField("scope", StringType()),
        StructField("cve", StringType()),
        StructField("component", StringType()),
        StructField("severity", StringType()),
        StructField("asset_id", StringType()),
        StructField("asset_name", StringType()),
        StructField("asset_type", StringType()),
        StructField("cloud", StringType()),
        StructField("subscription_name", StringType()),
        StructField("subscription_ext_id", StringType()),
        StructField("first_seen", TimestampType()),
        StructField("last_seen", TimestampType()),
        StructField("status", StringType()),
        StructField("resolved_at", TimestampType()),
        StructField("resolution_src", StringType()),
        StructField("reopened_count", IntegerType()),
        StructField("first_scan_id", StringType()),
        StructField("last_scan_id", StringType()),
        StructField("fix_date", TimestampType()),
        StructField("fix_observed_at", TimestampType()),
        # Nullable on purpose, forever. See the correctness trap at the top of metrics.py:
        # a NULL means the signal was never captured, which is NOT the same as observed-absent.
        StructField("has_kev", BooleanType()),
        StructField("has_exploit", BooleanType()),
        StructField("epss", DoubleType()),
        StructField("risk_observed_at", TimestampType()),
    ]
)

# What ``reconcile`` reports about each row it touched, alongside the row itself. Three
# independent booleans rather than one label, because a finding can be born already resolved --
# Wiz returns it with a resolvedAt we have never seen before -- and that is both a new lifecycle
# and a resolution. A single "change" column would have to pick one and lose the other.
CHANGE_COLUMNS = ["is_new", "is_resolved_now", "is_reopened"]


# --------------------------------------------------------------------------------- identity


def _present(col: Column) -> Column:
    """Whether a value counts as really there.

    Port of ``lifecycle._present``: NULL is absent, and so is a string with nothing but
    whitespace in it. The distinction matters because an empty asset name must not silently
    become part of a hash basis -- it would collide every nameless asset into one identity.
    """
    return col.isNotNull() & (F.length(F.trim(col)) > 0)


def _field(col: Column) -> Column:
    """Port of ``lifecycle.field``: the value verbatim when present, else the empty string.

    Verbatim, not trimmed -- the Python returns ``str(v)`` unchanged once it has decided the
    value is present, and the hash basis has to agree with it character for character.
    """
    return F.when(_present(col), col).otherwise(F.lit(""))


def vuln_key(df: DataFrame) -> DataFrame:
    """Add ``vuln_key``: stable identity for a finding across scans.

    Port of ``gas/src/domain/lifecycle.ts::vulnKey``. Prefers the Wiz finding id, which is
    stable per finding. Falls back to a hash over the semantic identity -- CVE, asset, type,
    cloud, component -- so the same vulnerability on the same asset still reconciles when no id
    came back.

    The ``id:`` / ``h:`` prefixes are part of the contract: they keep the two identity schemes in
    separate namespaces, so a finding that starts arriving with an id cannot silently collide
    with the hash that was standing in for it.
    """
    asset = F.when(_present(F.col("asset_id")), F.col("asset_id")).otherwise(
        _field(F.col("asset_name"))
    )
    basis = F.concat_ws(
        "|",
        _field(F.col("cve")),
        asset,
        _field(F.col("asset_type")),
        _field(F.col("cloud")),
        _field(F.col("component")),
    )
    return df.withColumn(
        "vuln_key",
        F.when(
            _present(F.col("finding_id")),
            F.concat(F.lit("id:"), F.trim(F.col("finding_id"))),
        ).otherwise(
            # sha1 hex truncated to 16 chars, matching the Python's hexdigest()[:16].
            F.concat(F.lit("h:"), F.substring(F.sha1(basis), 1, 16))
        ),
    )


def observed(silver: DataFrame) -> DataFrame:
    """This scan's findings, keyed by ``vuln_key`` and deduplicated to one row per key.

    Duplicates within a single scan mean Wiz returned the same finding twice, which does happen
    across page boundaries -- and the two copies can disagree, so which one wins is a real
    decision rather than a formality.

    ``reconcile.ts`` takes the **first** record and skips the rest. "First" is a property of a
    loop, and Spark rows have no inherent order, so bronze carries a ``seq`` column recording
    the order the API returned each finding in. That makes first-wins exactly reproducible here,
    and -- because it is stored rather than recomputed -- it stays reproducible when
    ``--rebuild_ledger`` replays the same bronze rows years later.

    Bronze written by v1 has no ``seq``. Those rows sort last and fall back to a content-based
    order that is deterministic but not authentically "first": still open, then most recently
    detected, then lowest finding id. Preferring the open copy is the conservative half of that
    -- a duplicate should not be able to assert a resolution its twin disagrees with.
    """
    keyed = vuln_key(silver)
    rank = F.row_number().over(
        Window.partitionBy("vuln_key").orderBy(
            F.col("seq").asc_nulls_last(),
            F.col("is_open").desc(),
            F.col("last_detected_at").desc_nulls_last(),
            F.col("finding_id").asc_nulls_last(),
        )
    )
    return keyed.withColumn("_rank", rank).filter(F.col("_rank") == 1).drop("_rank")


# ---------------------------------------------------------------------------- reconciliation


def _midpoint(prev_ts: Column, scan_ts: Column) -> Column:
    """Halfway between two timestamps, to the second.

    Port of ``reconcile._midpoint_iso``. Falls back to whichever side parses, so a missing
    previous timestamp degrades to the scan timestamp rather than to NULL -- a resolution with no
    date would drop straight out of every MTTR calculation.
    """
    mid = ((F.unix_timestamp(prev_ts) + F.unix_timestamp(scan_ts)) / 2).cast("long")
    return F.coalesce(F.to_timestamp(F.from_unixtime(mid)), scan_ts, prev_ts)


def _keep(new: Column, old: Column) -> Column:
    """Latest observation wins, but only when there IS one.

    Port of the ``field(rec, ...) || row.x`` idiom in ``reconcile.ts``: a blank value in the
    current scan must never erase what an earlier scan saw. Used for the asset/display
    attributes only -- the risk signals get the very different treatment below.
    """
    return F.when(_present(new.cast("string")), new).otherwise(old)


# ------------------------------------------------------------------- exploit intelligence
#
# Port of ``gas/src/domain/reconcile.ts::mergeRiskSignals``, and deliberately NOT the
# latest-observation-wins treatment severity and the asset fields get. The merge is monotone,
# idempotent and order-independent: booleans go null -> false -> true and never back, ``epss``
# keeps the PEAK observed value, and ``risk_observed_at`` keeps the earliest witnessing scan.
#
# Three reasons, all load-bearing here:
#
#   * Exploit knowledge is monotone in reality. A CVE does not become un-exploited, and KEV
#     entries are effectively never withdrawn. EPSS genuinely decays, so peak EPSS is a
#     deliberate choice -- coverage asks "was this something you should have prioritized",
#     not "is it still scary today".
#   * It keeps the high-risk label monotone, so a finding cannot silently leave the coverage
#     denominator between scans. That matters more in brick than anywhere else: the gold
#     tables are APPENDED, so a scan that quietly re-classified an old finding would leave
#     last week's published coverage row disagreeing with this week's for reasons that have
#     nothing to do with remediation. The trend would rewrite its own history.
#   * A resolved row therefore freezes at its peak known risk -- the conservative reading, in
#     which coverage never under-counts what we ought to have fixed.
#
# Order-independence is also what makes ``--rebuild_ledger`` safe: replaying bronze converges
# on the same state regardless of the order the scans come back in.


def _observed_epss(col: Column) -> Column:
    """EPSS as an observation: NULL when absent, and NaN counts as absent.

    Mirrors ``Number.isFinite`` in ``observeRiskSignals`` and the same NaN guard
    ``metrics.classify_risk`` already makes -- a NaN must not read as a captured value.
    """
    return F.when(col.isNotNull() & ~F.isnan(col), col)


def _merge_bool_signal(new: Column, old: Column) -> Column:
    """null -> false -> true, and never back down."""
    return F.when(new.isNotNull() & (old.isNull() | new), new).otherwise(old)


def _merge_peak(new: Column, old: Column) -> Column:
    """Keep the highest EPSS ever observed."""
    return F.when(new.isNotNull() & (old.isNull() | (new > old)), new).otherwise(old)


#: How many offending rows the guard collects before it names them. A refusal has to say WHICH
#: population it was handed, and one row can only name one scope; three names every scope either
#: fork has while keeping the check a LIMIT -- no shuffle, no full scan, no aggregate.
_FOREIGN_SCOPE_SAMPLE = 3


def _refuse_foreign_scope(prior: DataFrame, current: DataFrame, scope: str) -> None:
    """Refuse a prior ledger or an observation that belongs to another population.

    Disappearance-resolution reads absence as remediation, so a ledger from another scope is not
    a mislabelled input: it is a register that resolves itself. Every row of scope A is missing
    from a scan of scope B **by construction**, so reconciling one against the other marks the
    whole prior remediated, with real resolution dates and a plausible-looking delta. The failure
    is not an error, it is a remediation programme that never happened.

    Today each scope writes its own tables (``default_table_prefix``), so the prior is per-scope
    by construction and this can only fire on a caller that hand-assembles frames. That is the
    point. ``gas_devsecops`` keeps three scopes in ONE tab and had to filter the prior itself; the
    lesson it wrote down is that reconcile must not trust a calling convention for this, because
    the convention is invisible at the call site and its violation is silent.

    NULL is not foreign, and neither is silence: the golden ``reconcile.json`` prior states no
    scope, and a frame with no ``scope`` column at all is making no claim about its population.
    Only a stated, differing scope is refused.
    """
    for side, df in (("prior", prior), ("observation", current)):
        if "scope" not in df.columns:
            continue
        found = (
            df.select("scope")
            .filter(F.col("scope").isNotNull() & (F.col("scope") != F.lit(scope)))
            .limit(_FOREIGN_SCOPE_SAMPLE)
            .collect()
        )
        if found:
            names = ", ".join(sorted({str(r["scope"]) for r in found}))
            raise RuntimeError(
                f"reconcile(scope={scope!r}) was handed {side} rows carrying scope {names!r}. "
                f"Absence is remediation here, and every {names!r} row is absent from a "
                f"{scope!r} scan by construction, so this would resolve them all as fixed. "
                f"Filter the {side} to scope {scope!r} before reconciling it."
            )


def reconcile(
    prior: DataFrame,
    current: DataFrame,
    *,
    scan_id: str,
    scan_ts: str,
    scope: str,
    prev_scan_id: Optional[str] = None,
    prev_scan_ts: Optional[str] = None,
    prev_scan_id_by_severity: Optional[Dict[str, str]] = None,
    scanned_severities: Optional[Sequence[str]] = None,
    disappearance: str = DISAPPEARANCE_RESOLUTION,
) -> DataFrame:
    """Reconcile one scan against the prior ledger.

    Returns only the rows this scan **touched** -- new, updated or newly resolved -- carrying the
    full ``LEDGER_COLUMNS`` plus the three ``CHANGE_COLUMNS`` flags. Untouched rows are left out
    entirely so the MERGE downstream rewrites as little as possible; a ledger row nobody observed
    and nobody resolved should not even be republished.

    Args:
        prior: the existing ledger (may be empty, but must have the ledger schema).
        current: this scan's findings from ``observed()`` -- one row per ``vuln_key``.
        scan_id / scan_ts: identity and timestamp of this scan.
        scope: the vulnerability population (``os`` / ``all``), stamped on every row so it stays
            self-describing after a UNION -- and refused, rather than assumed, when the prior or
            the observations state a different one (``_refuse_foreign_scope``).
        prev_scan_id: the immediately-previous scan, or None for the very first scan (in which
            case nothing can have disappeared, because there is no "before" to vanish from).
        prev_scan_ts: needed only for ``disappearance="midpoint"``.
        prev_scan_id_by_severity: the most recent prior scan that *covered* each severity. A
            finding that vanished while its severity went unscanned must still resolve on the
            first scan that covers it again, and this map is what makes that possible.
        scanned_severities: this scan's severity scope, or None for unscoped. Out-of-scope OPEN
            rows are exempt from disappearance -- see the guard below.
        disappearance: ``"scan_ts"`` or ``"midpoint"``.

    Raises:
        RuntimeError: if any prior row or any observation states a scope other than ``scope``.
            Before the join, because the join is where the damage happens.
    """
    _refuse_foreign_scope(prior, current, scope)

    now = F.lit(scan_ts).cast("timestamp")
    prev_ts = F.lit(prev_scan_ts).cast("timestamp") if prev_scan_ts else now

    p = prior.select([F.col(c).alias(f"p_{c}") for c in LEDGER_COLUMNS])
    o = current.select(
        F.col("vuln_key").alias("o_vuln_key"),
        F.col("cve").alias("o_cve"),
        F.col("component").alias("o_component"),
        F.col("severity").alias("o_severity"),
        F.col("asset_id").alias("o_asset_id"),
        F.col("asset_name").alias("o_asset_name"),
        F.col("asset_type").alias("o_asset_type"),
        F.col("cloud").alias("o_cloud"),
        F.col("subscription_name").alias("o_subscription_name"),
        F.col("subscription_ext_id").alias("o_subscription_ext_id"),
        F.col("first_detected_at").alias("o_first_detected_at"),
        F.col("resolved_at").alias("o_resolved_at"),
        F.col("is_open").alias("o_is_open"),
        F.col("fix_date").alias("o_fix_date"),
        F.col("fixed_version").alias("o_fixed_version"),
        F.col("has_kev").alias("o_has_kev"),
        F.col("has_exploit").alias("o_has_exploit"),
        F.col("epss").alias("o_epss"),
    )
    j = p.join(o, p["p_vuln_key"] == o["o_vuln_key"], "full_outer")

    seen = F.col("o_vuln_key").isNotNull()
    known = F.col("p_vuln_key").isNotNull()

    # "The API says this is done": either it handed us a resolution timestamp, or its status is
    # one of the resolved spellings. Mirrors reconcile.ts's apiSaysResolved, and note it reads
    # status via is_open -- exactly the same test metrics.is_open makes.
    api_resolved = seen & (F.col("o_resolved_at").isNotNull() | ~F.col("o_is_open"))

    is_new = seen & ~known
    # A genuine reopen: we had it down as resolved and it is active again. Not merely re-listed
    # -- a still-resolved finding coming back in the payload is the API repeating itself, not the
    # vulnerability returning.
    is_reopened = seen & known & (F.col("p_status") == STATUS_RESOLVED) & ~api_resolved

    # Disappearance. Three conditions have to hold at once, and each one is load-bearing.
    if prev_scan_id is None:
        # The first scan of a register cannot resolve anything by absence: every finding in the
        # world is "absent from the previous scan" when there is no previous scan.
        disappeared = F.lit(False)
    else:
        expected_prev = F.lit(prev_scan_id)
        if prev_scan_id_by_severity:
            pairs = []
            for sev, sid in prev_scan_id_by_severity.items():
                pairs.extend([F.lit(sev), F.lit(sid)])
            expected_prev = F.coalesce(
                F.create_map(*pairs)[F.col("p_severity")], F.lit(prev_scan_id)
            )
        in_scope = (
            F.lit(True)
            if scanned_severities is None
            else F.col("p_severity").isin(*sorted(set(scanned_severities)))
        )
        disappeared = (
            ~seen
            & known
            & (F.col("p_status") == STATUS_OPEN)
            # The severity scope guard. --severities defaults to CRITICAL,HIGH, so without this
            # every MEDIUM row in the ledger would "vanish" on the first scoped scan and
            # mass-resolve. Absence of something nobody looked for is not evidence.
            & in_scope
            # Only a finding that was in the IMMEDIATELY previous covering scan can be said to
            # have disappeared from it. A row last seen three scans ago already had its
            # disappearance adjudicated back then; re-resolving it now would move its resolved_at
            # forward every single run.
            & (F.col("p_last_scan_id") == expected_prev)
        )

    touched = j.filter(seen | disappeared)

    # ---- first_seen ----
    # For a PERSISTING row this is earliest-known and must never drift later: a revised, later
    # firstDetectedAt is Wiz changing its own mind, and taking it would silently shorten every
    # MTTR that follows.
    #
    # A NEW row and a REOPENED one share the other formula, min(API first, scan ts) -- which is
    # why reopen needs no branch of its own. The difference that matters is what it does NOT
    # consult: the prior row's first_seen. The earliest-known chain is deliberately broken at a
    # reopen, so the new episode is measured on its own terms rather than from a date that
    # belongs to a vulnerability we already closed once. Note this is the one place first_seen
    # can move *later* (reconcile.ts:340 does the same).
    episode_start = F.least(
        F.coalesce(F.col("o_first_detected_at"), now), now
    )
    first_seen = (
        F.when(is_new | is_reopened, episode_start)
        .when(
            seen & (F.col("p_status") == STATUS_OPEN),
            F.least(
                F.col("p_first_seen"),
                F.coalesce(F.col("o_first_detected_at"), F.col("p_first_seen")),
            ),
        )
        .otherwise(F.col("p_first_seen"))
    )

    # ---- status, resolved_at, resolution_src ----
    pre_status = F.when(is_new | is_reopened, F.lit(STATUS_OPEN)).otherwise(F.col("p_status"))
    # An API resolution only closes a row that is currently open. A row already RESOLVED keeps
    # its original resolved_at: the first resolution is the one that happened.
    closes_now = api_resolved & (pre_status == STATUS_OPEN)

    resolved_ts = (
        _midpoint(prev_ts, now) if disappearance == "midpoint" else now
    )

    status = (
        F.when(closes_now | disappeared, F.lit(STATUS_RESOLVED))
        .otherwise(pre_status)
    )
    resolved_at = (
        F.when(closes_now, F.coalesce(F.col("o_resolved_at"), now))
        .when(disappeared, resolved_ts)
        .when(is_reopened, F.lit(None).cast("timestamp"))
        .otherwise(F.col("p_resolved_at"))
    )
    resolution_src = (
        F.when(closes_now, F.lit(RESOLUTION_API))
        .when(disappeared, F.lit(RESOLUTION_DISAPPEARED))
        .when(is_reopened, F.lit(None).cast("string"))
        .otherwise(F.col("p_resolution_src"))
    )

    # ---- vendor-fix clock: sticky first-wins, and reset by a reopen ----
    # Port of reconcile.ts's seedFix. Only ever fills an empty field, never overwrites: the
    # first moment a fix was known to exist is the one the actionable clock will want. A reopen
    # clears it, because the previous episode's fix says nothing about this one -- which is
    # exactly where it diverges from the risk signals, that survive a reopen untouched.
    fix_signal = seen & (_present(F.col("o_fixed_version")) | F.col("o_fix_date").isNotNull())
    base_fix_date = F.when(is_new | is_reopened, F.lit(None).cast("timestamp")).otherwise(
        F.col("p_fix_date")
    )
    base_fix_observed = F.when(is_new | is_reopened, F.lit(None).cast("timestamp")).otherwise(
        F.col("p_fix_observed_at")
    )
    fix_date = F.when(
        seen & base_fix_date.isNull() & F.col("o_fix_date").isNotNull(), F.col("o_fix_date")
    ).otherwise(base_fix_date)
    fix_observed_at = F.when(seen & base_fix_observed.isNull() & fix_signal, now).otherwise(
        base_fix_observed
    )

    # ---- exploit intelligence: monotone, and it does NOT reset on reopen ----
    obs_epss = _observed_epss(F.col("o_epss"))
    witnessed = seen & (
        F.col("o_has_kev").isNotNull() | F.col("o_has_exploit").isNotNull() | obs_epss.isNotNull()
    )
    risk_observed_at = F.when(
        witnessed, F.least(F.coalesce(F.col("p_risk_observed_at"), now), now)
    ).otherwise(F.col("p_risk_observed_at"))

    # A disappeared row was, by definition, not seen: its last_seen and last_scan_id stay where
    # they were. Overwriting them with this scan would claim we observed something we did not.
    return touched.select(
        F.coalesce(F.col("o_vuln_key"), F.col("p_vuln_key")).alias("vuln_key"),
        F.lit(scope).alias("scope"),
        # severity and cve are latest-observation-wins outright, matching reconcile.ts:364-365
        # -- the normalized severity is never blank, and a cve the API has stopped naming
        # should not be kept alive by an older scan.
        F.when(seen, F.col("o_cve")).otherwise(F.col("p_cve")).alias("cve"),
        _keep(F.col("o_component"), F.col("p_component")).alias("component"),
        F.when(seen, F.col("o_severity")).otherwise(F.col("p_severity")).alias("severity"),
        _keep(F.col("o_asset_id"), F.col("p_asset_id")).alias("asset_id"),
        _keep(F.col("o_asset_name"), F.col("p_asset_name")).alias("asset_name"),
        _keep(F.col("o_asset_type"), F.col("p_asset_type")).alias("asset_type"),
        _keep(F.col("o_cloud"), F.col("p_cloud")).alias("cloud"),
        _keep(F.col("o_subscription_name"), F.col("p_subscription_name")).alias(
            "subscription_name"
        ),
        _keep(F.col("o_subscription_ext_id"), F.col("p_subscription_ext_id")).alias(
            "subscription_ext_id"
        ),
        first_seen.alias("first_seen"),
        F.when(seen, now).otherwise(F.col("p_last_seen")).alias("last_seen"),
        status.alias("status"),
        resolved_at.alias("resolved_at"),
        resolution_src.alias("resolution_src"),
        F.when(is_reopened, F.coalesce(F.col("p_reopened_count"), F.lit(0)) + 1)
        .otherwise(F.coalesce(F.col("p_reopened_count"), F.lit(0)))
        .cast("int")
        .alias("reopened_count"),
        F.when(is_new, F.lit(scan_id)).otherwise(F.col("p_first_scan_id")).alias(
            "first_scan_id"
        ),
        F.when(seen, F.lit(scan_id)).otherwise(F.col("p_last_scan_id")).alias("last_scan_id"),
        fix_date.alias("fix_date"),
        fix_observed_at.alias("fix_observed_at"),
        _merge_bool_signal(F.col("o_has_kev"), F.col("p_has_kev")).alias("has_kev"),
        _merge_bool_signal(F.col("o_has_exploit"), F.col("p_has_exploit")).alias("has_exploit"),
        _merge_peak(obs_epss, F.col("p_epss")).alias("epss"),
        risk_observed_at.alias("risk_observed_at"),
        is_new.alias("is_new"),
        (closes_now | disappeared).alias("is_resolved_now"),
        is_reopened.alias("is_reopened"),
    )


def empty_ledger(spark: SparkSession) -> DataFrame:
    """An empty frame with the ledger schema -- the prior state on the very first run."""
    return spark.createDataFrame([], LEDGER_SCHEMA)


# ------------------------------------------------------------------------- metric contract


def _scope_in(scopes) -> Column:
    """A per-ROW scope predicate over ``config``'s scope sets, never NULL.

    Per row rather than per call, and that is a decision rather than a convenience.
    ``run_pipeline.build_metrics`` hands ``lifecycle_frame`` the whole ledger table without
    narrowing it, and every ledger row already carries the ``scope`` column that exists
    precisely so a row stays self-describing after a UNION. Reading the column keeps the answer
    right for a frame holding more than one population -- which is what a UNIONed read of two
    registers would be -- and it cannot be passed a scope that disagrees with the rows it is
    applied to.

    ``isin`` returns NULL for a NULL scope, so it is coalesced: ``awaiting_vendor_fix`` is a
    published boolean, and a NULL there would read as "not awaiting" in some SQL and as
    "unknown" in the rest.
    """
    if not scopes:
        return F.lit(False)
    return F.coalesce(F.col("scope").isin(*sorted(scopes)), F.lit(False))


def lifecycle_frame(ledger: DataFrame, now_ts: str) -> DataFrame:
    """Project the ledger into the column contract ``metrics.py`` already consumes.

    This is the join between the two halves of v2, and it is deliberately the only thing that
    knows about both. Because it produces exactly the columns ``silver_findings`` produces,
    ``kaplan_meier``, ``mttr_by_severity``, ``classify_risk``, ``confusion_matrix`` and
    ``capacity_by_month`` all run against observed lifecycles **without a single change to their
    maths** -- so v2 cannot quietly disagree with v1 about what a median is. The only thing that
    changes is where the lifecycles come from.

    Two columns are worth naming:

    ``first_detected_at`` is the ledger's ``first_seen``, which is the earliest evidence we have
    rather than whatever the current payload claims -- that is the whole point of persisting it.

    ``is_open`` is derived from ``status``, and here it agrees with ``resolved_at`` by
    construction: the ledger never records a resolution without a date. The snapshot path cannot
    promise that (a finding can be status-RESOLVED with no timestamp), which is one more way the
    two disagree in v1's favour.

    Five more columns carry the **actionable clock**: ``fix_available_at``,
    ``actionable_from``, ``mttr_actionable_days``, ``actionable_age_days`` and
    ``awaiting_vendor_fix``. ``mttr_days`` above answers "how long did this finding live";
    these answer "how long could anybody have done something about it", which is the question
    an SLA is actually about. The two differ by however long the register waited on a vendor,
    and they are published side by side rather than one replacing the other -- the gap is the
    part of the exposure the remediation programme never owned. ``config.HAS_VENDOR_FIX`` and
    ``config.SCOPES_PINNING_HAS_FIX`` hold the reasoning; the derivation is below.
    """
    now = F.lit(now_ts).cast("timestamp")
    mttr_days = (
        F.unix_timestamp("resolved_at") - F.unix_timestamp("first_seen")
    ) / SECONDS_PER_DAY
    age_days = (F.unix_timestamp(now) - F.unix_timestamp(F.col("first_seen"))) / SECONDS_PER_DAY

    # ---- the second clock ----------------------------------------------------------------
    # Which scopes these two predicates cover, and why they are two rather than one, is
    # written down in `config.HAS_VENDOR_FIX` / `config.SCOPES_PINNING_HAS_FIX`.
    vendor = _scope_in(HAS_VENDOR_FIX)
    # A blank fix clock inside a `hasFix`-pinned population is evidence of an OLD fix, not of
    # a missing one: the filter would not have returned the row otherwise. It is a
    # construction rather than a guess, and one-sided -- see config.SCOPES_PINNING_HAS_FIX --
    # so it lands on the harsh side: the actionable clock collapses onto the exposure clock
    # for these rows instead of inventing a later start nothing can evidence.
    pinned_fix = F.when(_scope_in(SCOPES_PINNING_HAS_FIX), F.col("first_seen"))
    # `fix_observed_at` is the fallback and not an equal: it is the scan that first SAW a fix
    # exist, which is an upper bound on when the fix appeared. Preferring `fix_date` and
    # falling back to it keeps the actionable clock conservative -- it never credits a team
    # with time it did not have.
    fix_available_at = F.when(
        vendor, F.coalesce(F.col("fix_date"), F.col("fix_observed_at"), pinned_fix)
    )
    # The clamp, and it is the whole reason this is `greatest` and not a coalesce: a fix that
    # shipped before we ever saw the finding does not start the clock in the past. `greatest`
    # ignores NULLs, so a row with no `first_seen` starts at the fix.
    actionable_from = F.when(
        fix_available_at.isNotNull(), F.greatest(F.col("first_seen"), fix_available_at)
    )
    mttr_actionable_days = (
        F.unix_timestamp("resolved_at") - F.unix_timestamp(actionable_from)
    ) / SECONDS_PER_DAY
    actionable_age_days = (
        F.unix_timestamp(now) - F.unix_timestamp(actionable_from)
    ) / SECONDS_PER_DAY
    # Open, in a scope that HAS a vendor, with no fix available yet. All three conjuncts are
    # load-bearing; dropping the middle one is the mutation `tests/test_ledger.py` prices.
    awaiting_vendor_fix = F.coalesce(
        (F.col("status") == STATUS_OPEN) & vendor & fix_available_at.isNull(), F.lit(False)
    )

    return ledger.select(
        F.col("vuln_key"),
        F.col("scope"),
        F.col("cve"),
        F.col("component"),
        F.col("severity"),
        F.col("asset_id"),
        F.col("asset_name"),
        F.col("asset_type"),
        F.col("cloud"),
        F.col("subscription_name"),
        F.col("subscription_ext_id"),
        F.col("status"),
        F.col("resolution_src"),
        F.col("reopened_count"),
        F.col("fix_date"),
        F.col("fix_observed_at"),
        F.col("risk_observed_at"),
        F.col("first_seen").alias("first_detected_at"),
        F.col("last_seen").alias("last_detected_at"),
        F.col("resolved_at"),
        (F.col("status") == STATUS_OPEN).alias("is_open"),
        F.col("has_kev"),
        F.col("has_exploit"),
        F.col("epss"),
        mttr_days.alias("mttr_days"),
        F.when(F.col("resolved_at").isNull(), age_days).alias("age_days"),
        fix_available_at.alias("fix_available_at"),
        actionable_from.alias("actionable_from"),
        mttr_actionable_days.alias("mttr_actionable_days"),
        F.when(F.col("resolved_at").isNull(), actionable_age_days).alias("actionable_age_days"),
        awaiting_vendor_fix.alias("awaiting_vendor_fix"),
    )
