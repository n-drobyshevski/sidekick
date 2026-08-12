"""Every number the notebooks show, and the one place that decides which scan they show it for.

Spark in, a small frame out. No plotting, no HTML, no metric maths that ``metrics.py`` already
owns -- a panel joins, filters and shapes; it does not re-derive.

--------------------------------------------------------------------------------------------
THE RULE THIS MODULE EXISTS FOR: **the scan pin is a property of the session, not of a query.**

The gold tables are appended, never overwritten, so every read has to name a scan or it silently
blends every run that has ever happened into one plausible-looking chart. Rather than repeat
``scan_id = (SELECT max_by(scan_id, scan_ts) ...)`` in every cell and hope, ``context()``
registers session temp views that are *already* pinned, scoped and severity-filtered:

    v_mttr  v_program  v_capacity  v_findings  v_scans  v_lifecycles     <- one scan
    v_mttr_all  v_program_all  v_findings_all                            <- deliberately not

``max_by(scan_id, scan_ts)`` appears exactly once in this file and nowhere else in the repo. The
three ``_all`` views are the only unpinned surface and are named so a reader can see it.

The consequence worth having: **no SQL in any notebook interpolates a widget**, so the test
suite can execute each shipped cell's SQL verbatim against real pipeline output.
--------------------------------------------------------------------------------------------

Two traps that are invisible until they are wrong:

* ``OVERALL`` is not a member of ``SEVERITY_ORDER``, so a bare ``severity IN (...)`` filter
  deletes the row every hero on every page reads. The views keep it explicitly.
* ``SLA_TARGETS`` has no ``UNKNOWN`` key, so ``sla_target`` is NULL there, ``mttr_days <= NULL``
  is NULL, and ``sum(when(...).otherwise(0))`` turns that into a **0** that ``safe_pct`` happily
  divides into ``0.0%``. Published data already carries that. The views null it back out, and
  anything counting "open past SLA" excludes rows with no target from both sides.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

import dbx
import ledger as ledger_mod
import metrics
import run_pipeline
from config import (
    DEFAULT_CATALOG,
    DEFAULT_SCHEMA,
    EPSS_PRIORITY_THRESHOLD,
    OVERALL,
    POPULATION_ALL,
    POPULATION_HIGH_RISK,
    SEVERITY_ORDER,
    SLA_TARGETS,
    rule_for_scope,
)

# See config.PIPELINE_VERSION: every module in a deployment must come from the same upload.
MODULE_VERSION = "1.0-devsecops"

SEVERITIES: Tuple[str, ...] = tuple(SEVERITY_ORDER)

#: What a notebook may group by. An allow-list of real columns, not a regex: the value is
#: interpolated into SQL, and a regex would cheerfully pass a syntactically valid identifier
#: that is not a column on any table we own.
GROUP_DIMENSIONS: Tuple[str, ...] = (
    "subscription_name",
    "asset_type",
    "cloud",
    "asset_name",
    "cve",
    "component",
    "severity",
    # Code registers only, NULL everywhere else -- `language` is the ecosystem (P2P v5's asset
    # category) and `cwe` the weakness class. Listed unconditionally rather than per scope: the
    # allow-list exists to stop SQL injection through a widget, and a dimension that is all
    # NULL for a scope produces one honest UNKNOWN group rather than an error.
    "language",
    "cwe",
)

#: Dimensions a notebook may ask "can this register be attributed at all" about.
ATTRIBUTION_DIMENSIONS: Tuple[str, ...] = (
    "subscription_name",
    "subscription_ext_id",
    "asset_type",
    "cloud",
    "asset_name",
)

AGE_BUCKETS = ("0-7d", "8-30d", "31-90d", "90+d")
RESOLUTION_BUCKETS = ("<=1d", "2-7d", "8-30d", "31-90d", "90+d")

#: Panels that legitimately read more than one scan. Everything else must return exactly one
#: ``scan_id``, and a test parametrised over this list is what keeps that true.
UNPINNED_PANELS = frozenset(
    {
        "trend",
        "severity_trend",
        "open_past_sla_trend",
        "group_trend",
        "scan_log",
        "all_time",
        "week_delta",
        "severity_cards",
        "movement",
        "table_inventory",
        "run_health",
        "scan_pin_check",
    }
)

#: Panels computed from the ledger, which is current state (MERGEd) and carries no ``scan_id``
#: at all. Pinned by construction of the source rather than by a predicate.
LEDGER_PANELS = frozenset(
    {
        "km_by",
        "mttr_contribution",
        "sla_extras",
        "km_curve_points",
        "time_to_resolve_buckets",
        "open_age_buckets",
        "rule_sweep",
        "capacity",
        "group_mix",
        "group_severity",
        "attributability",
        "coverage_by_group",
        "risk_mix",
        "quadrant",
        "signal_clauses",
        "exploit_tiles",
        "all_time",
        "weakness_mix",
        # The v5 views select from the pinned gold table but do not carry `scan_id` forward --
        # the columns a reader wants are the rates, and the pin is a property of the view.
        "asset_profile",
        "asset_density",
        "asset_footholds",
        "asset_capacity",
    }
)


# ------------------------------------------------------------------------------ the context


@dataclass(frozen=True)
class Ctx:
    """Everything a cell needs to know, resolved once."""

    tables: run_pipeline.Tables
    namespace: str
    scope: str
    scan_id: str
    scan_ts: str
    severities: Tuple[str, ...]
    params: Mapping[str, str]
    #: `RiskRule` for a CVE register, `SastRiskRule` for `sast`. See config.rule_for_scope.
    rule: Any

    def param(self, name: str, default: str = "") -> str:
        """A page widget's value. Page widgets live here rather than as fields, so adding one
        to a notebook does not mean editing a frozen dataclass in another file."""
        value = self.params.get(name, "")
        return value if value else default

    def int_param(self, name: str, default: int) -> int:
        try:
            return int(self.param(name, str(default)))
        except ValueError:
            return default


#: Declared by every notebook. ``table_prefix`` takes ``-`` for "no prefix at all", because
#: ``run_pipeline.param`` is ``widget or env or default`` and an empty string is falsy -- so a
#: cleared widget means "use the default", not "use nothing".
# `catalog` and `schema` default to the deployment's own namespace (config.DEFAULT_CATALOG /
# DEFAULT_SCHEMA) rather than to nothing. A read-only page should open on the register, not on
# a blank widget and a stack trace. The write path keeps its no-default rule -- see config.
#
# **A widget that already exists keeps its old value.** Databricks does not overwrite a widget
# on re-declaration, so changing a default here does nothing for a notebook somebody has
# already run: they have to Remove all widgets and re-run cell 1, or pass `namespace=` to
# `context()`. That is the "unreliable widget resolution" anyone who hits it will describe.
BASE_WIDGETS: Dict[str, Tuple[str, Optional[Sequence[str]]]] = {
    "catalog": (DEFAULT_CATALOG, None),
    "schema": (DEFAULT_SCHEMA, None),
    "scope": ("sca", ("sca", "sast")),
    "table_prefix": ("", None),
    "severities": ("CRITICAL,HIGH", None),
    "scan_id": ("", None),
    "module_path": ("", None),
    # Empty means catalog-backed, which is the normal deployment. Set it to the directory a
    # PoC run wrote with `--data_path` and `catalog`/`schema` stop being read at all.
    "data_path": ("", None),
    # The CSV register. Set it to the directory `--csv_path` / `--export_csv` wrote and the
    # page reads the export instead of any table -- which is what a deployment with no catalog
    # and no volume actually has. Beats `data_path`, which beats `catalog`/`schema`.
    "csv_path": ("", None),
}

_EMPTY_PREFIX_SENTINEL = "-"


def declare_widgets(**page: Any) -> None:
    """Create this notebook's widgets: the base set, plus whatever the page adds.

    One kwarg convention and only one: ``name=(default, choices_or_None)``. A dropdown when
    there are choices, a text box when there are not.

    Off Databricks ``dbx.get_dbutils()`` returns ``None`` and this is a no-op, which is what
    lets the same cell 1 run under pytest.
    """
    dbutils = dbx.get_dbutils()
    if dbutils is None:
        return
    for name, spec in {**BASE_WIDGETS, **page}.items():
        default, choices = spec if isinstance(spec, tuple) else (spec, None)
        try:
            if choices:
                dbutils.widgets.dropdown(name, str(default), [str(c) for c in choices], name)
            else:
                dbutils.widgets.text(name, str(default), name)
        except Exception:  # noqa: BLE001 -- widget already exists with a different type
            pass


def _param(name: str, default: str = "") -> str:
    """``run_pipeline.param`` with ``argv`` forced empty.

    ``param()`` reads ``sys.argv[1:]`` **before** the widget. A notebook's driver process does
    not have an empty argv, so a stray ``--schema=`` on it would silently beat what the reader
    typed into the widget. There is no notebook case where argv should win, so it never does.

    (The environment fallback below it still applies: ``param`` falls through to
    ``os.environ[NAME.upper()]``, and ``SCOPE`` / ``ROWS`` / ``MONTHS`` are all plausible
    ambient variables on a job cluster. Page widget names are prefixed to stay clear of that.)
    """
    return run_pipeline.param(name, default, argv=[])


def context(
    spark: SparkSession,
    argv: Optional[list] = None,
    *,
    tables: Optional[run_pipeline.Tables] = None,
    namespace: Optional[str] = None,
    ensure: bool = True,
    **page_defaults: str,
) -> Ctx:
    """Resolve the run, register the views, and hand back the frozen context.

    Also calls ``run_pipeline.check_deployment()``. Nothing else in a read-only notebook does,
    and without it the MODULE_VERSION lockstep guard -- the thing that exists because a
    half-updated folder once ingested 137,870 findings and then died -- would only ever run for
    someone doing a scan.

    ``tables`` is the local-test route and nothing else: a local SparkSession cannot write a
    three-level name at all (see the README's "Running it locally").

    ``namespace`` is the same route, plus one real notebook use: **overriding a stale widget.**
    Databricks keeps a widget's value once it exists, so a notebook that was run before
    ``BASE_WIDGETS`` changed still resolves the old ``catalog``/``schema`` and reads a namespace
    that no longer holds the tables -- with no error, because an empty page is a valid result.
    Passing ``namespace='<catalog>.<schema>'`` skips widget resolution entirely and is the
    quickest way to prove that is what happened. Removing and re-adding the widgets is the
    permanent fix; this is the diagnosis.

    ``ensure`` creates the ledger and scan-log tables when they are missing, so a deployment
    that has never run a scan opens on an empty page instead of TABLE_OR_VIEW_NOT_FOUND. It is
    the one write a read-only notebook makes, it touches no data, and it is idempotent. Pass
    ``ensure=False`` where even that is unwanted -- a viewer holding SELECT and nothing else on
    a register that has never been scanned.
    """
    run_pipeline.check_deployment()

    argv = [] if argv is None else argv
    prefix = _param("table_prefix")
    if prefix == _EMPTY_PREFIX_SENTINEL:
        argv = list(argv) + ["--table_prefix="]

    scope = run_pipeline.resolve_scope(argv=argv)
    csv_path = _param("csv_path")
    if tables is None and csv_path:
        # The CSV register. Everything below is unchanged, because `csvstore.load` hands back a
        # `Tables` of session temp views named exactly as the tables would be -- so the views,
        # the panels and every notebook `%sql` cell cannot tell the difference. `ensure` is
        # skipped for the obvious reason: there is nothing here to create, and a CSV export is
        # not something a reader should be able to grow a Delta table beside.
        import csvstore

        prefix = _param("table_prefix", run_pipeline.default_table_prefix(scope))
        tables = csvstore.load(
            spark, csv_path, "" if prefix == _EMPTY_PREFIX_SENTINEL else prefix
        )
        ensure = False
    elif tables is None:
        # `data_path` selects the storage mode for the pages exactly as it does for a run: set,
        # the register lives in a directory and there is no catalog to resolve. See
        # `run_pipeline.resolve_data_path` and the README's PoC storage section.
        data_path = run_pipeline.resolve_data_path(argv=argv)
        namespace = "" if data_path else (namespace or run_pipeline.resolve_namespace(argv=argv))
        tables = run_pipeline.resolve_tables(namespace, scope, argv=argv, data_path=data_path)
    namespace = namespace or ""

    if ensure:
        # The two lifecycle tables are created by `reconcile_scan`, so on a deployment where the
        # pipeline has never run they do not exist and every view built below dies with
        # TABLE_OR_VIEW_NOT_FOUND -- in cell 1, before the page can say "nothing scanned yet".
        # `ensure_tables` checks existence first, so this is a no-op in the normal case and
        # needs no privilege beyond SELECT; only a never-run deployment tries to CREATE, and
        # there a PERMISSION_DENIED naming the grant is the right thing to see.
        run_pipeline.ensure_tables(spark, tables)
    severities = tuple(
        s for s in run_pipeline.parse_severities(_param("severities")) or SEVERITY_ORDER
    )
    severities = tuple(s for s in SEVERITY_ORDER if s in severities) or SEVERITIES

    scan_id, scan_ts = _resolve_scan(spark, tables, scope)
    params = {name: _param(name, default) for name, default in page_defaults.items()}

    ctx = Ctx(
        tables=tables,
        namespace=namespace,
        scope=scope,
        scan_id=scan_id,
        scan_ts=scan_ts,
        severities=severities,
        params=params,
        # Not DEFAULT_RISK_RULE: a SAST register classified under it reads 100%
        # unclassified, which looks like a register with no exploit data rather than
        # like the wrong rule.
        rule=rule_for_scope(scope),
    )
    register_views(spark, ctx)
    return ctx


def _resolve_scan(spark, tables, scope) -> Tuple[str, str]:
    """The scan every pinned view is pinned to. **The only ``max_by`` in the repo.**"""
    override = _param("scan_id")
    row = (
        spark.table(tables.mttr)
        .where(F.col("scope") == scope)
        .selectExpr("max_by(scan_id, scan_ts) AS s", "max(scan_ts) AS ts")
        .collect()
    )
    latest_id = row[0]["s"] if row else None
    latest_ts = row[0]["ts"] if row else None
    if override:
        ts = (
            spark.table(tables.mttr)
            .where(F.col("scan_id") == override)
            .selectExpr("max(scan_ts) AS ts")
            .collect()
        )
        if not ts or ts[0]["ts"] is None:
            raise RuntimeError(f"scan_id={override!r} is not in {tables.mttr}")
        return override, ts[0]["ts"].isoformat()
    if latest_id is None:
        raise RuntimeError(
            f"{tables.mttr} has no rows for scope={scope!r} -- run the pipeline "
            "(notebook 06) before opening a read notebook."
        )
    return latest_id, latest_ts.isoformat()


def register_views(spark: SparkSession, ctx: Ctx) -> None:
    """The nine session views. Everything downstream reads these and nothing else.

    Built through the DataFrame API rather than ``CREATE VIEW ... SELECT``: ``SELECT * EXCEPT``
    is a Databricks SQL extension open-source Spark cannot parse, and the tests run on
    open-source Spark. The result is the same object either way -- a session temp view that a
    ``%sql`` cell reads by name.
    """
    pinned = (F.col("scan_id") == ctx.scan_id) & (F.col("scope") == ctx.scope)
    scoped = F.col("scope") == ctx.scope
    keeps_overall = F.col("severity").isin(*ctx.severities) | (F.col("severity") == OVERALL)
    sev_only = F.col("severity").isin(*ctx.severities)

    def ranked(frame: DataFrame) -> DataFrame:
        return frame.withColumn("sev_rank", _rank_column())

    def sla_fixed(frame: DataFrame) -> DataFrame:
        """NULL out the SLA columns where there is no target to be compliant with.

        ``SLA_TARGETS`` has no ``UNKNOWN`` key, so the target is NULL, ``mttr_days <= NULL`` is
        NULL, and ``sum(when(...).otherwise(0))`` turns that into a **0** that ``safe_pct``
        divides into a confident ``0.0%``. The published rows already carry it; this is where
        it stops.
        """
        # OVERALL is the deliberate exception: it carries no single target (each row inside it
        # has its own), but its sla_pct is real -- total compliant over total resolved, computed
        # in one pass by `mttr_by_severity`. Nulling it out here would blank the headline.
        fabricated = F.col("sla_target").isNull() & (F.col("severity") != OVERALL)
        return frame.withColumn(
            "sla_compliant", F.when(~fabricated, F.col("sla_compliant"))
        ).withColumn("sla_pct", F.when(~fabricated, F.col("sla_pct")))

    mttr = spark.table(ctx.tables.mttr)
    ranked(sla_fixed(mttr.where(pinned & keeps_overall))).createOrReplaceTempView("v_mttr")
    ranked(sla_fixed(mttr.where(scoped & keeps_overall))).createOrReplaceTempView("v_mttr_all")

    program = spark.table(ctx.tables.program)
    ranked(program.where(pinned & keeps_overall)).createOrReplaceTempView("v_program")
    ranked(program.where(scoped & keeps_overall)).createOrReplaceTempView("v_program_all")

    # The capacity table carries every month twice, once per `population`, so a view over it
    # MUST pick one -- an unfiltered `v_capacity` would double every count and turn the
    # `SELECT DISTINCT` in program_headline into two rows. Split rather than filtered at each
    # call site, so forgetting the predicate is impossible rather than merely unlikely.
    #
    # A table written by 2.0 has no `population` column *at all* -- not NULL, absent -- because
    # it arrives by schema evolution on the first 2.1+ write, and a register that has not been
    # re-scanned since has never had one. Every row in such a table is an all-findings row,
    # which is exactly what the README's upgrade note says to assume; applying it here rather
    # than leaving it to each reader means the page opens on real numbers instead of dying in
    # cell 1 with `UNRESOLVED_COLUMN population`, an error naming neither the version that wrote
    # the table nor the scan that would fix it. The coalesce covers the other half of the same
    # upgrade: rows that DO have the column but land NULL, mixed in beside 2.1 rows.
    capacity_raw = spark.table(ctx.tables.capacity)
    capacity_table = capacity_raw.withColumn(
        "population",
        F.lit(POPULATION_ALL)
        if "population" not in capacity_raw.columns
        else F.coalesce(F.col("population"), F.lit(POPULATION_ALL)),
    ).where(pinned)
    capacity_table.where(F.col("population") == POPULATION_ALL).createOrReplaceTempView(
        "v_capacity"
    )
    capacity_table.where(
        F.col("population") == POPULATION_HIGH_RISK
    ).createOrReplaceTempView("v_capacity_high_risk")

    # P2P v5's asset family, split by population for exactly the same reason capacity is: the
    # table carries every asset group twice and an unfiltered view would double every count.
    #
    # Absent on a register last scanned before 2.3, and absent rather than empty -- so the view
    # is skipped instead of failing cell 1. A page that reads it then dies naming `v_assets`,
    # which is a better error than one naming a table nobody has heard of.
    if run_pipeline.table_exists(spark, ctx.tables.assets):
        assets_table = spark.table(ctx.tables.assets).where(pinned)
        assets_table.where(F.col("population") == POPULATION_ALL).createOrReplaceTempView(
            "v_assets"
        )
        assets_table.where(
            F.col("population") == POPULATION_HIGH_RISK
        ).createOrReplaceTempView("v_assets_high_risk")

    silver = _silver_frame(spark, ctx)
    silver.where(pinned & sev_only).createOrReplaceTempView("v_findings")
    silver.where(scoped & sev_only).createOrReplaceTempView("v_findings_all")

    # The run log. One row per run, never appended to twice, so there is nothing to pin.
    spark.table(ctx.tables.scans).where(scoped).createOrReplaceTempView("v_scans")

    # The ledger is MERGEd current state and carries no scan_id -- pinned by construction of the
    # table, not by a predicate. `now_ts` is the *scan's* timestamp, not wall-clock: every age,
    # every censoring time and both bucket charts are measured as of the scan whose numbers sit
    # above them on the page, or the notebook quietly contradicts itself.
    metrics.classify_risk(
        ledger_mod.lifecycle_frame(
            spark.table(ctx.tables.ledger).where(F.col("scope") == ctx.scope), ctx.scan_ts
        ),
        ctx.rule,
    ).where(F.col("severity").isin(*ctx.severities)).createOrReplaceTempView("v_lifecycles")


def _silver_frame(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """The per-scan findings snapshot behind ``v_findings`` / ``v_findings_all``.

    Read from the silver table when there is one, and **derived from bronze when there is not**.
    A path-backed register does not persist silver -- it is a pure projection of bronze, so
    storing it would be a second copy of data the register already holds -- and this is the one
    place that has to know. ``metrics.silver_findings`` is the same function the pipeline
    writes silver with, so the two routes cannot disagree about what a finding is.

    The classification is applied with ``ctx.rule`` rather than the rule the scan ran under,
    which matches how ``v_lifecycles`` is built two blocks below: changing the rule in a
    notebook should move both or neither.
    """
    if run_pipeline.table_exists(spark, ctx.tables.silver):
        return spark.table(ctx.tables.silver)
    bronze = spark.table(ctx.tables.bronze).where(F.col("scope") == ctx.scope)
    return metrics.classify_risk(metrics.silver_findings(bronze, ctx.scope), ctx.rule)


def _rank_column(column: str = "severity"):
    """One definition of severity ordering, derived from ``SEVERITY_ORDER``, used everywhere.

    ``metrics.order_by_severity`` ranks OVERALL at ``len(SEVERITY_ORDER) + 1``; so does this.
    Hand-inlined ``CASE ... ELSE 6`` expressions in three places is how the three end up
    disagreeing about where OVERALL sorts, which is a bug nobody sees until a screenshot.
    """
    pairs = []
    for index, sev in enumerate(SEVERITY_ORDER):
        pairs.extend([F.lit(sev), F.lit(index)])
    return F.coalesce(F.create_map(*pairs)[F.col(column)], F.lit(len(SEVERITY_ORDER) + 1))


def lifecycles(spark: SparkSession, ctx: Ctx, *, cache: bool = True) -> DataFrame:
    """The lifecycle frame behind ``v_lifecycles``.

    Cached on request because almost every by-dimension, distribution and sweep panel scans it,
    and on a register that ingested 137,870 findings that is the difference between a page and
    a coffee break. The cost lands on whichever cell touches it first, not on ``context()`` --
    opening a notebook should not cost a full ledger scan before anything renders.
    """
    frame = spark.table("v_lifecycles")
    return frame.cache() if cache else frame


def _check_dimension(dim: str, allowed: Sequence[str] = GROUP_DIMENSIONS) -> str:
    if dim not in allowed:
        raise ValueError(
            f"{dim!r} is not a grouping dimension; pick one of {', '.join(allowed)}"
        )
    return dim


# --------------------------------------------------------------------------- one-row panels


def posture(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """The headline: how fast risk closes, over how much of the register."""
    return spark.sql(
        """
        SELECT km_median, km_median_lower_bound, km_rmst, km_truncated,
               km_events + km_censored AS tracked, resolved, open, sla_pct
        FROM v_mttr WHERE severity = 'OVERALL'
        """
    )


def mttr_headline(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Hero and minis for the MTTR page, both clocks side by side."""
    return spark.sql(
        """
        SELECT km_median, km_median_lower_bound, mttr_median, sla_pct,
               open_age_p90, open, resolved, resolved_api, resolved_disappeared,
               km_events + km_censored AS tracked
        FROM v_mttr WHERE severity = 'OVERALL'
        """
    )


def program_headline(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Coverage and efficiency with their published ranges, plus the capacity summary.

    ``capacity_by_month`` cross-joins its scan-level summary onto every month row, so those
    columns arrive N times over. ``LIMIT 1`` after a ``DISTINCT`` is what makes this a one-row
    frame rather than a one-row frame that happens to work when there is one month.
    """
    program = spark.sql(
        """
        SELECT coverage_pct, coverage_lo, coverage_hi,
               efficiency_pct, efficiency_lo, efficiency_hi,
               prevalence_pct, signal_coverage_pct,
               tp, fp, fn, tn, unknown_remediated, unknown_open,
               high_risk, not_high_risk, classified, unknown, total
        FROM v_program WHERE severity = 'OVERALL'
        """
    )
    capacity = spark.sql(
        "SELECT DISTINCT mmcr_mean, one_in_n, net_total, overall_verdict FROM v_capacity"
    ).limit(1)
    return program.crossJoin(capacity)


def register_totals(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Tracked / open / resolved for the KPI band.

    "Tracked" is ``km_events + km_censored``, i.e. lifecycles with a measurable duration --
    the same population every KM figure on the page is computed over. ``all_time`` uses a plain
    ``count(*)``, which is a slightly larger number for a slightly different question, and the
    two pages label themselves accordingly rather than pretending to agree.
    """
    return spark.sql(
        """
        SELECT km_events + km_censored AS tracked, open, resolved
        FROM v_mttr WHERE severity = 'OVERALL'
        """
    )


def last_scan(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """What the pinned scan covered, and how stale it is."""
    return spark.sql(
        f"""
        SELECT scan_ts, scan_id, scope, severities, total,
               (unix_timestamp(current_timestamp()) - unix_timestamp(scan_ts)) / 86400.0
                   AS age_days
        FROM v_scans WHERE scan_id = '{ctx.scan_id}'
        """
    )


def week_delta(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Change in the KM median against the newest scan at least seven days older.

    ``max_by`` over the eligible window, not ``ORDER BY ... LIMIT 1``: the newest eligible scan
    can have a NULL median (survival never reached 50%), and a plain ordering would pick it and
    produce a NULL delta that renders as "±0" -- a flat reading where the honest answer is "no
    comparable baseline". Returns no row in that case.
    """
    return spark.sql(
        f"""
        WITH baseline AS (
          SELECT max_by(km_median, scan_ts) AS prev_km, max(scan_ts) AS prev_ts
          FROM v_mttr_all
          WHERE severity = 'OVERALL'
            AND scan_ts <= timestamp('{ctx.scan_ts}') - INTERVAL 7 DAYS
            AND km_median IS NOT NULL
        ), now AS (
          SELECT km_median AS km FROM v_mttr WHERE severity = 'OVERALL'
        )
        SELECT now.km, baseline.prev_km, baseline.prev_ts, now.km - baseline.prev_km AS delta
        FROM now JOIN baseline ON baseline.prev_km IS NOT NULL
        """
    )


def all_time(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """The register as a whole, not as of one scan -- the Scan history KPI band.

    All four figures come from the ledger so they share one population. The published
    ``OVERALL`` row would not: it is computed once by the pipeline over every severity that was
    scanned, and no read-time filter can narrow it, so mixing it in here would put one filtered
    number beside three unfiltered ones.
    """
    return spark.sql(
        """
        SELECT count(*) AS tracked,
               count_if(resolved_at IS NULL) AS open,
               count_if(resolved_at IS NOT NULL) AS resolved,
               (SELECT count(*) FROM v_scans) AS scans,
               (SELECT min(scan_ts) FROM v_scans) AS first_scan_ts,
               (SELECT max(scan_ts) FROM v_scans) AS last_scan_ts
        FROM v_lifecycles
        """
    )


def movement(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """New / resolved / reopened / persisting since the previous scan.

    ``persisting`` is counted off the **ledger**, not as ``scans.total - new_count``.
    ``scans.total`` is a silver row count -- one row per finding the API returned -- while the
    deltas are lifecycle counts, and subtracting one from the other mixes grains in a direction
    nobody would notice.

    It reads the ledger table rather than ``v_lifecycles`` because ``last_scan_id`` is a
    bookkeeping column that ``lifecycle_frame`` deliberately does not project -- the metric
    transforms have no business seeing it.
    """
    return spark.sql(
        f"""
        SELECT s.new_count, s.resolved_count, s.reopened_count,
               (SELECT count(*) FROM {ctx.tables.ledger}
                 WHERE scope = '{ctx.scope}' AND last_scan_id = '{ctx.scan_id}'
                   AND resolved_at IS NULL)
                 - s.new_count AS persisting,
               (SELECT count(*) FROM v_scans WHERE scan_ts < s.scan_ts) > 0 AS has_previous
        FROM v_scans s WHERE s.scan_id = '{ctx.scan_id}'
        """
    )


def exploit_tiles(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Exploitability over *open* lifecycles, with what was never captured beside it.

    One finding can carry several signals, so these do not partition anything. Internet
    exposure is not ingested at all and so is not a column here: the notebook renders that tile
    as "not captured", which is what GAS does when its own exposure flag is unknown.
    """
    return spark.sql(
        f"""
        SELECT count(*) AS open,
               count_if(has_kev) AS kev,
               count_if(has_exploit) AS exploit,
               count_if(epss >= {EPSS_PRIORITY_THRESHOLD}) AS high_epss,
               count_if(has_kev IS NULL) AS kev_missing,
               count_if(has_exploit IS NULL) AS exploit_missing,
               count_if(epss IS NULL) AS epss_missing
        FROM v_lifecycles WHERE resolved_at IS NULL
        """
    )


def rule_sentence(ctx: Ctx) -> str:
    """The high-risk rule in words, straight off the dataclass."""
    return ctx.rule.sentence()


def signal_clauses(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Per-clause fired and never-captured counts. See ``metrics.signal_breakdown``."""
    return metrics.signal_breakdown(spark.table("v_lifecycles"), ctx.rule)


# ------------------------------------------------------------------------- severity panels


def severity_open(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Open count per severity, OVERALL excluded -- the tile row."""
    return spark.sql(
        "SELECT severity, open, sev_rank FROM v_mttr WHERE severity <> 'OVERALL' ORDER BY sev_rank"
    )


def severity_cards(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Per severity: open now, resolved, tracked, and the move since the previous scan.

    Reads **two** scans by design -- a delta needs a baseline -- so it comes off ``v_mttr_all``
    and is on the deliberately-unpinned list. ``tracked`` is derived (``resolved + open``); the
    gold table publishes no ``total`` column.
    """
    return spark.sql(
        f"""
        WITH prev AS (
          SELECT severity, max_by(open, scan_ts) AS prev_open
          FROM v_mttr_all
          WHERE scan_ts < timestamp('{ctx.scan_ts}') AND severity <> 'OVERALL'
          GROUP BY severity
        )
        SELECT m.severity, m.open, m.resolved, m.resolved + m.open AS total,
               m.open - prev.prev_open AS delta_open, m.sev_rank
        FROM v_mttr m LEFT JOIN prev USING (severity)
        WHERE m.severity <> 'OVERALL'
        ORDER BY m.sev_rank
        """
    )


def severity_table(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """The remediation-by-severity grid, with both clocks and the resolution-source split."""
    extras = sla_extras(spark, ctx)
    published = spark.sql(
        """
        SELECT severity, km_median, km_median_lower_bound, mttr_median, sla_target, sla_pct,
               open, resolved, resolved_api, resolved_disappeared, open_age_p50, open_age_p90,
               sev_rank
        FROM v_mttr WHERE severity <> 'OVERALL'
        """
    )
    return (
        published.join(extras, "severity", "left")
        .orderBy("sev_rank")
        .drop("sev_rank")
    )


def sla_extras(spark: SparkSession, ctx: Ctx, dim: str = "severity") -> DataFrame:
    """``open_past_sla`` and the naive p90, per severity or per any other dimension.

    Computed here rather than read off the gold table because the gold table has neither. It is
    also the one place the "rename the dimension into the severity slot" trick must **not** be
    used: ``mttr_by_severity`` looks the SLA target up from whatever sits in ``severity``, so a
    subscription name there yields a NULL target, a zeroed ``sla_compliant`` and a fabricated
    ``0.0%`` for every group. Each row keeps its own severity's target instead.

    Rows with no target (UNKNOWN) leave **both** sides of the ratio. ``age_days > NULL`` is NULL
    and would otherwise quietly count them as inside SLA.
    """
    _check_dimension(dim)
    frame = spark.table("v_lifecycles").withColumn(
        "sla_target", metrics.sla_target_col(F.col("severity"))
    )
    has_target = F.col("sla_target").isNotNull()
    return frame.groupBy(dim).agg(
        F.count(
            F.when(has_target & F.col("resolved_at").isNull() & (F.col("age_days") > F.col("sla_target")), 1)
        )
        .cast("long")
        .alias("open_past_sla"),
        F.count(F.when(has_target & F.col("resolved_at").isNull(), 1))
        .cast("long")
        .alias("open_with_target"),
        F.percentile("mttr_days", 0.9).alias("mttr_p90"),
    )


# ------------------------------------------------------------------------- by-dimension


def km_by(spark: SparkSession, ctx: Ctx, dim: str, top_n: Optional[int] = None) -> DataFrame:
    """MTTR per group, by running the real per-severity transform over a renamed dimension.

    ``metrics.mttr_by_severity`` -- not ``kaplan_meier``, which emits no ``resolved`` / ``open``
    / ``mttr_median`` at all; those come from ``_mttr_aggs`` inside it.

    The trick is that ``mttr_by_severity`` groups by whatever is called ``severity`` and is
    otherwise dimension-agnostic. That is worth a test rather than a comment, because if it ever
    stops being true this breaks *silently* into plausible wrong numbers -- see
    ``test_panels.py::test_km_by_overall_matches_the_real_transform``.

    Its SLA columns are dropped on the way out: they would be computed against a target looked
    up from a subscription name. ``sla_extras`` supplies the real ones.
    """
    _check_dimension(dim)
    frame = spark.table("v_lifecycles")
    overall_km = (
        metrics.mttr_by_severity(frame)
        .where(F.col("severity") == OVERALL)
        .select(F.col("km_median").alias("overall_km_median"))
    )
    renamed = frame.withColumn("_real_severity", F.col("severity")).withColumn(
        "severity", F.coalesce(F.col(dim), F.lit("(none)"))
    )
    out = (
        metrics.mttr_by_severity(renamed)
        # mttr_by_severity unions an OVERALL row of its own, which in this frame is a group
        # name nobody has. It is the same number as the real OVERALL row, and it would sort
        # into the middle of an alphabetical list of subscriptions.
        .where(F.col("severity") != OVERALL)
        .drop("sla_target", "sla_compliant", "sla_pct", "oldest_open_days")
        .withColumnRenamed("severity", dim)
        .crossJoin(overall_km)
    )
    out = out.orderBy(F.col("open").desc_nulls_last(), F.col(dim))
    return out.limit(top_n) if top_n else out


def mttr_contribution(spark: SparkSession, ctx: Ctx, dim: str, top_n: int = 8) -> DataFrame:
    """How many finding-days each group costs relative to the register's own median.

    ``resolved x (group median - overall median)``: a group can be slow and irrelevant, or
    average and enormous. This is the axis that says which one is dragging the headline, and it
    is the reason the chart's zero rule is drawn solid -- zero here is an origin, not a target.
    """
    frame = km_by(spark, ctx, dim)
    return (
        frame.withColumn(
            "excess_finding_days",
            F.col("resolved") * (F.col("km_median") - F.col("overall_km_median")),
        )
        .where(F.col("excess_finding_days").isNotNull())
        .orderBy(F.abs(F.col("excess_finding_days")).desc())
        .limit(top_n)
        .select(dim, "excess_finding_days", "km_median", "overall_km_median", "resolved")
    )


def group_mix(spark: SparkSession, ctx: Ctx, dim: str, top_n: int = 5) -> DataFrame:
    """Open lifecycles by group: the biggest ``top_n``, and everything else folded into one.

    Folded, not truncated. A pie whose slices do not sum to the total is a pie that lies about
    the total, and the palette only has five hues that survive a colourblind check.
    """
    _check_dimension(dim)
    counts = (
        spark.table("v_lifecycles")
        .where(F.col("resolved_at").isNull())
        .groupBy(F.coalesce(F.col(dim), F.lit("(none)")).alias("group_value"))
        .agg(F.count(F.lit(1)).cast("long").alias("open"))
        .orderBy(F.col("open").desc(), "group_value")
    )
    top = counts.limit(top_n).withColumn("is_other", F.lit(False))
    names = [r["group_value"] for r in top.select("group_value").collect()]
    rest = counts.where(~F.col("group_value").isin(*names)) if names else counts
    other = (
        rest.agg(F.sum("open").cast("long").alias("open"))
        .where(F.col("open").isNotNull())
        .withColumn("group_value", F.lit("Other"))
        .withColumn("is_other", F.lit(True))
        .select("group_value", "open", "is_other")
    )
    return top.unionByName(other)


def group_palette(spark: SparkSession, ctx: Ctx, dim: str, top_n: int = 5) -> List[str]:
    """The canonical group order: biggest first, then ``Other``.

    One source of truth for *which group is which colour*, because a group has to keep its hue
    across the pie and the trend or the two charts cannot be read together. GAS solves this the
    same way (``groupPalette`` returns a Map). Sorting the names alphabetically at each call
    site is the bug this exists to prevent -- it looks right in each chart and is wrong across
    the pair.
    """
    rows = group_mix(spark, ctx, dim, top_n).collect()
    ordered = [r["group_value"] for r in rows if not r["is_other"]]
    if any(r["is_other"] for r in rows):
        ordered.append("Other")
    return ordered


def group_trend(spark: SparkSession, ctx: Ctx, dim: str, top_n: int = 5) -> DataFrame:
    """Open **findings** per group, per scan.

    Findings, not lifecycles: the ledger holds no history by scan, so this comes off silver,
    which is each scan's API snapshot. The difference is real and the caption says so -- a
    group's series drops when its findings stop being *returned*, which is usually but not
    always the same day they were remediated.
    """
    _check_dimension(dim)
    top = [r["group_value"] for r in group_mix(spark, ctx, dim, top_n).collect() if not r["is_other"]]
    listed = ", ".join(f"'{g}'" for g in top) or "''"
    return spark.sql(
        f"""
        SELECT scan_ts,
               CASE WHEN coalesce({dim}, '(none)') IN ({listed})
                    THEN coalesce({dim}, '(none)') ELSE 'Other' END AS group_value,
               count_if(is_open) AS open
        FROM v_findings_all
        GROUP BY scan_ts, group_value
        ORDER BY scan_ts, group_value
        """
    )


def group_severity(spark: SparkSession, ctx: Ctx, dim: str, top_n: int = 12) -> DataFrame:
    """Open lifecycles as a tidy ``group x severity x open``.

    Tidy rather than pre-pivoted so the chart editor's pivot table can do the pivot -- which is
    the one place a picker genuinely beats code, because the reader gets to swap the axes. The
    severity ordering rides along as ``sev_rank`` so the columns come out in taxonomy order
    rather than alphabetically.
    """
    _check_dimension(dim)
    groups = [
        r["group_value"] for r in group_mix(spark, ctx, dim, top_n).collect() if not r["is_other"]
    ]
    return (
        spark.table("v_lifecycles")
        .where(F.col("resolved_at").isNull())
        .withColumn("group_value", F.coalesce(F.col(dim), F.lit("(none)")))
        .where(F.col("group_value").isin(*groups) if groups else F.lit(True))
        .groupBy("group_value", "severity")
        .agg(F.count(F.lit(1)).cast("long").alias("open"))
        .withColumn("sev_rank", _rank_column())
        .orderBy(F.col("open").desc(), "sev_rank")
    )


def risk_mix(spark: SparkSession, ctx: Ctx, dim: str, top_n: int = 12) -> DataFrame:
    """Group x {High risk, Not high risk, No captured signal}, tidy, for a 100% stacked bar.

    Three *named* categories, deliberately not severity: the severity ramp fails a categorical
    colourblind check, and a stacked bar is exactly the chart where a reader has to tell two
    adjacent fills apart.
    """
    _check_dimension(dim)
    groups = [
        r["group_value"] for r in group_mix(spark, ctx, dim, top_n).collect() if not r["is_other"]
    ]
    label = (
        F.when(F.col("risk_class") == "high", F.lit("High risk"))
        .when(F.col("risk_class") == "low", F.lit("Not high risk"))
        .otherwise(F.lit("No captured signal"))
    )
    return (
        spark.table("v_lifecycles")
        .withColumn("group_value", F.coalesce(F.col(dim), F.lit("(none)")))
        .where(F.col("group_value").isin(*groups) if groups else F.lit(True))
        .withColumn("risk_label", label)
        .groupBy("group_value", "risk_label")
        .agg(F.count(F.lit(1)).cast("long").alias("lifecycles"))
        .orderBy("group_value", "risk_label")
    )


def coverage_by_group(spark: SparkSession, ctx: Ctx, dim: str) -> DataFrame:
    """Where the backlog sits, and how much of each group the risk rule could even classify."""
    _check_dimension(dim)
    return (
        spark.table("v_lifecycles")
        .withColumn("group_value", F.coalesce(F.col(dim), F.lit("(none)")))
        .groupBy("group_value")
        .agg(
            F.count(F.lit(1)).cast("long").alias("lifecycles"),
            F.count_if(F.col("resolved_at").isNull()).cast("long").alias("open"),
            F.count_if(F.col("resolved_at").isNotNull()).cast("long").alias("resolved"),
            F.count_if(F.col("risk_class") == "high").cast("long").alias("high_risk"),
            F.count_if(F.col("risk_class") == "unknown").cast("long").alias("unclassified"),
            F.max("age_days").alias("oldest_open_days"),
        )
        .withColumn(
            "signal_coverage_pct",
            metrics.safe_pct(
                F.col("lifecycles") - F.col("unclassified"), F.col("lifecycles")
            ),
        )
        .orderBy(F.col("open").desc())
    )


def attributability(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Can this register be attributed to an owner at all?

    GAS answers this against value-chain rules and support-group tags. brick ingests neither,
    so the honest version measures the raw material: for each dimension that *is* captured, how
    much of it is populated and how many distinct values it takes. A dimension that is 100%
    populated with three values attributes nothing; one that is 40% populated is not a map.
    """
    frame = spark.table("v_lifecycles")
    total = frame.count()
    rows = []
    for dim in ATTRIBUTION_DIMENSIONS:
        if dim not in frame.columns:
            continue
        rows.append(
            frame.agg(
                F.lit(dim).alias("dimension"),
                F.count(F.col(dim)).cast("long").alias("populated"),
                F.lit(total).cast("long").alias("lifecycles"),
                F.countDistinct(F.col(dim)).cast("long").alias("distinct_values"),
            ).withColumn("populated_pct", metrics.safe_pct(F.col("populated"), F.col("lifecycles")))
        )
    out = rows[0]
    for extra in rows[1:]:
        out = out.unionByName(extra)
    return out.orderBy(F.col("populated_pct").desc_nulls_last())


# ------------------------------------------------------------------------------ trends


def trend(spark: SparkSession, ctx: Ctx, columns: Sequence[str], *, family: str = "mttr",
          by: str = OVERALL) -> DataFrame:
    """A per-scan series off one of the ``_all`` views. Deliberately unpinned; hence the name.

    ``by`` is a severity, or ``OVERALL``. Note what the caption has to say when it is a subset:
    the ``OVERALL`` row was computed once by the pipeline over everything that was scanned, and
    no read-time filter narrows it.
    """
    view = {"mttr": "v_mttr_all", "program": "v_program_all"}[family]
    listed = ", ".join(columns)
    return spark.sql(
        f"SELECT scan_ts, severity, {listed} FROM {view} "
        f"WHERE severity = '{by}' ORDER BY scan_ts"
    )


def severity_trend(spark: SparkSession, ctx: Ctx, column: str = "open") -> DataFrame:
    """One column per severity, per scan -- the multi-line severity chart, already pivoted."""
    return (
        spark.table("v_mttr_all")
        .where(F.col("severity") != OVERALL)
        .groupBy("scan_ts")
        .pivot("severity", list(ctx.severities))
        .agg(F.first(column))
        .orderBy("scan_ts")
    )


def open_past_sla_trend(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Open findings past their SLA target, per scan.

    Off silver, because that is the only thing brick keeps per scan -- so this counts the
    findings the API *returned* that day, while the tile above it counts ledger lifecycles,
    which include everything that has since disappeared. The two will not agree, and the gap is
    exactly what the README calls "the size of what v1 was missing". The caption says so; do
    not quietly reconcile them.

    Rows with no SLA target leave both sides.
    """
    targets = ", ".join(f"'{sev}', {days}" for sev, days in SLA_TARGETS.items())
    return spark.sql(
        f"""
        WITH t AS (
          SELECT scan_ts, is_open, age_days, map({targets})[severity] AS sla_target
          FROM v_findings_all
        )
        SELECT scan_ts,
               count_if(is_open AND sla_target IS NOT NULL AND age_days > sla_target)
                   AS open_past_sla,
               count_if(is_open AND sla_target IS NOT NULL) AS open_with_target
        FROM t GROUP BY scan_ts ORDER BY scan_ts
        """
    )


def scan_log(spark: SparkSession, ctx: Ctx, rows: int = 25) -> DataFrame:
    """The saved scans, newest first.

    ``LIMIT`` inside an ordered query, never inside an unordered view: a cap without an ordering
    caps an arbitrary subset and then sorts *that*, which looks exactly like the right answer.

    The deltas are formatted as **signed strings**. A native result grid cannot colour a cell,
    and the sign is what carries the meaning anyway -- which is the more accessible encoding of
    the two.
    """
    return spark.sql(
        f"""
        SELECT scan_ts, scope, severities, total,
               format_string('+%d', new_count) AS new_findings,
               format_string('-%d', resolved_count) AS resolved_findings,
               reopened_count, scan_id
        FROM v_scans ORDER BY scan_ts DESC, scan_id DESC LIMIT {int(rows)}
        """
    )


# ------------------------------------------------------------------------- distributions


def km_curve_points(spark: SparkSession, ctx: Ctx, severity: str = OVERALL):
    """The survival staircase and its four markers, for one severity.

    Computed with ``metrics.km_curve`` -- the same code path ``kaplan_meier`` uses for the
    published ``km_median`` -- so the 50% crossing of this curve and the number in the hero
    above it cannot disagree. (They do legitimately differ when the reader has selected a
    severity subset: the published OVERALL row is over everything that was scanned. The caption
    carries that.)
    """
    frame = spark.table("v_lifecycles")
    curve, _ = metrics.km_curve(frame)
    summary = metrics.mttr_by_severity(frame).where(F.col("severity") == severity).collect()
    row = summary[0].asDict() if summary else {}
    markers = [
        {"key": "naive_median", "value": row.get("mttr_median")},
        {"key": "median", "value": row.get("km_median")},
        {"key": "mean", "value": row.get("km_rmst")},
    ]
    return curve.where(F.col("severity") == severity).orderBy("t"), markers


def _bucket_column(value, edges: Sequence[float], labels: Sequence[str]):
    expr = F.when(value <= edges[0], F.lit(labels[0]))
    for i, edge in enumerate(edges[1:], start=1):
        expr = expr.when(value <= edge, F.lit(labels[i]))
    return expr.otherwise(F.lit(labels[-1]))


def open_age_buckets(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """How long the open backlog has been open, bucketed as GAS buckets it.

    Tidy -- ``bucket x severity x findings`` -- rather than pivoted, for two reasons. The chart
    editor stacks a tidy frame by a "group by" column, which is one setting instead of one per
    severity; and the column set stays fixed no matter which severities this scan happened to
    contain, so ``OUTPUT_COLUMNS`` can be a contract rather than a guess.

    The edges are inclusive on the left of each label -- exactly 7.0 days is ``0-7d``, 7.01 is
    ``8-30d`` -- the same inclusive convention ``_mttr_aggs`` uses for in-SLA. Every open
    lifecycle lands in exactly one bucket.
    """
    return _bucketed(
        spark.table("v_lifecycles").where(F.col("resolved_at").isNull()),
        F.col("age_days"), [7, 30, 90], AGE_BUCKETS,
    )


def time_to_resolve_buckets(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """How long closed lifecycles took, bucketed as GAS buckets them. Tidy, as above."""
    return _bucketed(
        spark.table("v_lifecycles").where(F.col("mttr_days").isNotNull()),
        F.col("mttr_days"), [1, 7, 30, 90], RESOLUTION_BUCKETS,
    )


def _bucketed(frame: DataFrame, value, edges, labels) -> DataFrame:
    ranks = F.create_map(*[x for i, b in enumerate(labels) for x in (F.lit(b), F.lit(i))])
    return (
        frame.withColumn("bucket", _bucket_column(value, edges, labels))
        .groupBy("bucket", "severity")
        .agg(F.count(F.lit(1)).cast("long").alias("findings"))
        .withColumn("bucket_rank", ranks[F.col("bucket")])
        .withColumn("sev_rank", _rank_column())
        .orderBy("bucket_rank", "sev_rank")
        .select("bucket", "bucket_rank", "severity", "sev_rank", "findings")
    )


# ------------------------------------------------------------------------------ programme


def quadrant(spark: SparkSession, ctx: Ctx, which: str = "fn") -> DataFrame:
    """The lifecycles behind one cell of the confusion matrix.

    GAS puts a drill-down behind every cell and a CSV button beside it. Here the native result
    grid *is* that: it sorts, filters and exports, and it does all three better than anything
    this repo would write.
    """
    classes = {
        "tp": ("high", False),
        "fp": ("low", False),
        "fn": ("high", True),
        "tn": ("low", True),
        "unknown_remediated": ("unknown", False),
        "unknown_open": ("unknown", True),
    }
    if which not in classes:
        raise ValueError(f"{which!r} is not a matrix cell; pick one of {', '.join(classes)}")
    risk, still_open = classes[which]
    frame = spark.table("v_lifecycles").where(F.col("risk_class") == risk)
    frame = frame.where(
        F.col("resolved_at").isNull() if still_open else F.col("resolved_at").isNotNull()
    )
    return frame.select(
        "cve", "component", "severity", "asset_name", "subscription_name",
        "first_detected_at", "resolved_at", "has_kev", "has_exploit", "epss", "age_days",
        "mttr_days",
    ).orderBy(F.col("age_days").desc_nulls_last())


# The seven non-empty subsets live in `metrics.subsets_for`, which both this page and the gold
# table `metrics.rule_sensitivity` writes walk. One definition, because two would drift and the
# failure would be a page whose sweep disagrees with the published table about what
# "KEV or EPSS" means -- and it now has to answer for two different rules besides.


def rule_sweep(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Coverage and efficiency under each of the seven possible high-risk rules.

    Which rule is ``active`` is decided by **comparing each subset against ``ctx.rule``**, never
    by a hardcoded label -- otherwise changing ``config.DEFAULT_RISK_RULE`` silently fills in
    the wrong point.

    Classified once per subset over a cached frame rather than seven independent reads: this is
    the most expensive page in the set and seven full ledger scans is how it gets abandoned.
    """
    frame = lifecycles(spark, ctx)
    out = None
    # `subsets_for` picks the right seven for whichever rule this scope uses, so a SAST page
    # sweeps {CWE, AI verdict, CRITICAL} and a CVE page sweeps {KEV, exploit, EPSS} through
    # exactly this code, and it is the same definition the gold table walks.
    for label, rule, _flags, is_active in metrics.subsets_for(ctx.rule):
        row = (
            metrics.confusion_matrix(metrics.classify_risk(frame, rule))
            .where(F.col("severity") == OVERALL)
            .select(
                F.lit(label).alias("label"),
                F.lit(is_active).alias("active"),
                "coverage_pct", "coverage_lo", "coverage_hi",
                "efficiency_pct", "efficiency_lo", "efficiency_hi",
                "high_risk", "unknown",
            )
        )
        out = row if out is None else out.unionByName(row)
    return out


def capacity(spark: SparkSession, ctx: Ctx, months: int = 12, high_risk_only: bool = False):
    """Monthly close rate, either over everything or over the high-risk population only.

    Both come straight off the published table now. This function used to recompute the
    high-risk variant here, because ``metrics.capacity_by_month`` had taken the flag since v2
    and ``run_pipeline`` never passed it -- so the gold table only ever held the all-findings
    figure. The pipeline now writes both, tagged by ``population``, which is where the
    distinction belongs: a number recomputed in the presentation layer is one the SQL surface
    cannot see and the next reader has to rediscover.

    ``closed_observed`` is only on the all-findings rows. Reconciliation's resolution count
    carries no risk label, so against the high-risk population it would cross-check a different
    set of findings -- the column is selected only where it means something.
    """
    view = "v_capacity" if not high_risk_only else "v_capacity_high_risk"
    observed = "closed_observed," if not high_risk_only else ""
    return spark.sql(
        f"""
        SELECT month, open_at_start, opened, closed, {observed} mmcr, net, net_pct,
               verdict,
               CASE WHEN reconstructed THEN 'reconstructed'
                    WHEN partial THEN 'in progress' ELSE '' END AS tag
        FROM {view} ORDER BY month DESC LIMIT {int(months)}
        """
    )


# ------------------------------------------------------- P2P v5: assets at risk


def asset_profile(spark: SparkSession, ctx: Ctx, high_risk_only: bool = True) -> DataFrame:
    """P2P v5's asset table: density, footholds, half-life and capacity, per ecosystem.

    Straight off the published gold table, like ``capacity`` and for the same reason -- a number
    recomputed in the presentation layer is one the SQL surface cannot see.

    ``high_risk_only`` defaults to **True**, which is the opposite of ``capacity``'s default and
    is deliberate: v5's density chart (Fig. 10) counts everything, but every question the page
    is actually for -- where is the foothold, who is falling behind -- is asked about high-risk
    findings. The all-findings rows are one argument away for the density comparison.
    """
    view = "v_assets_high_risk" if high_risk_only else "v_assets"
    return spark.sql(
        f"""
        SELECT asset_group, assets, open_findings,
               density_p25, density_p50, density_p75,
               assets_with_high_risk_pct, assets_with_high_risk,
               asset_coverage_p50, km_median_days, km_median_lower_bound,
               mmcr_p50, falling_behind_pct, maintaining_pct, gaining_pct,
               assets_flowing, window_months
        FROM {view}
        ORDER BY CASE WHEN asset_group = '{OVERALL}' THEN 0 ELSE 1 END, assets DESC
        """
    )


def asset_density(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """The density distribution alone, both populations side by side (v5 Fig. 10).

    Two populations on one frame because that comparison is the finding: an ecosystem whose
    total density is high but whose high-risk density is not is a triage problem, and one where
    the two are close is a supply-chain problem. Reading them off two separate tables is how
    nobody notices.
    """
    return spark.sql(
        f"""
        SELECT asset_group, population, assets, density_p25, density_p50, density_p75
        FROM (
            SELECT * FROM v_assets
            UNION ALL
            SELECT * FROM v_assets_high_risk
        )
        ORDER BY CASE WHEN asset_group = '{OVERALL}' THEN 0 ELSE 1 END,
                 asset_group, population
        """
    )


def asset_footholds(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """v5 Fig. 11 as a frame: what share of each ecosystem's repositories offers a way in.

    v5's own framing, and the reason this is a headline rather than a column: "it's often said
    that just one opening is needed to successfully compromise a system". 70% of Windows
    systems and 40% of Linux systems cleared that bar in their sample. The number here is not
    comparable to theirs -- different population, different positive class, see the README --
    but the question is the same one.
    """
    return spark.sql(
        f"""
        SELECT asset_group, assets, assets_with_high_risk,
               assets_with_high_risk_pct, km_median_days
        FROM v_assets_high_risk
        WHERE asset_group <> '{OVERALL}'
        ORDER BY assets_with_high_risk_pct DESC NULLS LAST, assets DESC
        """
    )


def asset_capacity(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """v5 Fig. 21: the share of repositories falling behind, keeping up and gaining ground.

    NULL rather than zero for every column here when the register does not know when it started
    watching -- these are rates per watched month, and a register with no scan log has no such
    month. ``assets_flowing`` is how many repositories the verdict rests on, and ``window_months``
    how long a window: both are on the frame so a confident-looking split over three assets and
    one month cannot pass for a trend.
    """
    return spark.sql(
        f"""
        SELECT asset_group, assets_flowing, window_months, mmcr_p50,
               falling_behind_pct, maintaining_pct, gaining_pct
        FROM v_assets_high_risk
        ORDER BY CASE WHEN asset_group = '{OVERALL}' THEN 0 ELSE 1 END,
                 falling_behind_pct DESC NULLS LAST
        """
    )


def weakness_mix(spark: SparkSession, ctx: Ctx, limit: int = 15) -> DataFrame:
    """The static-analysis register by weakness class: how many, and how many are high risk.

    ``cwe`` holds a comma-separated list, so this splits and explodes it -- a finding with two
    weaknesses is counted under both, and the counts therefore do NOT sum to the register. Said
    here because a table of counts that does not add up is otherwise read as a partition.

    Empty for every scope but ``sast``, which have no CWE at all.
    """
    return spark.sql(
        f"""
        SELECT weakness,
               count(*) AS lifecycles,
               sum(CASE WHEN risk_class = 'high' THEN 1 ELSE 0 END) AS high_risk,
               sum(CASE WHEN risk_class = 'unknown' THEN 1 ELSE 0 END) AS unclassified,
               sum(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS open
        FROM (
            SELECT explode(split(cwe, ',')) AS weakness, risk_class, resolved_at
            FROM v_lifecycles WHERE cwe IS NOT NULL AND cwe <> ''
        )
        GROUP BY weakness
        ORDER BY high_risk DESC, lifecycles DESC
        LIMIT {int(limit)}
        """
    )


# --------------------------------------------------------------------------- run & verify


def table_inventory(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Every table this deployment owns, with what is actually in it.

    ``scan_id`` is special-cased rather than looped over uniformly: the ledger is MERGEd
    current state and has ``first_scan_id`` / ``last_scan_id`` instead, and the run log has a
    ``scan_id`` but none of the gold columns.

    A table that does not exist is reported as a row with a NULL count rather than skipped or
    raised on. A path-backed register has no silver by design, and "silver: absent" is the
    honest thing for an inventory to say -- a page that dies with TABLE_OR_VIEW_NOT_FOUND, or
    that quietly lists seven tables where there were eight, is worse in both directions.
    """
    latest = {
        ctx.tables.bronze: "max_by(scan_id, scan_ts)",
        ctx.tables.silver: "max_by(scan_id, scan_ts)",
        ctx.tables.mttr: "max_by(scan_id, scan_ts)",
        ctx.tables.program: "max_by(scan_id, scan_ts)",
        ctx.tables.capacity: "max_by(scan_id, scan_ts)",
        ctx.tables.sensitivity: "max_by(scan_id, scan_ts)",
        ctx.tables.assets: "max_by(scan_id, scan_ts)",
        ctx.tables.scans: "max_by(scan_id, scan_ts)",
        ctx.tables.ledger: "max(last_scan_id)",
    }
    ts = {ctx.tables.ledger: "max(last_seen)"}
    out = None
    for table, scan_expr in latest.items():
        ts_expr = ts.get(table, "max(scan_ts)")
        if run_pipeline.table_exists(spark, table):
            row = spark.sql(
                f"SELECT '{table}' AS table_name, count(*) AS rows, "
                f"{scan_expr} AS latest_scan_id, {ts_expr} AS latest_ts FROM {table}"
            )
        else:
            row = spark.sql(
                f"SELECT '{table}' AS table_name, CAST(NULL AS BIGINT) AS rows, "
                f"CAST(NULL AS STRING) AS latest_scan_id, CAST(NULL AS TIMESTAMP) AS latest_ts"
            )
        out = row if out is None else out.unionByName(row)
    return out


def scan_pin_check(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """Do the four gold tables and the ledger agree on which scan is the latest?

    They disagree when a run died between two writes. The pipeline refuses to start in that
    state; this surfaces it *before* the next run hits it, and before somebody reads a page
    whose halves come from different scans.
    """
    return spark.sql(
        f"""
        SELECT 'context' AS source, '{ctx.scan_id}' AS scan_id
        UNION ALL SELECT 'metrics_mttr', (SELECT max_by(scan_id, scan_ts) FROM {ctx.tables.mttr})
        UNION ALL SELECT 'metrics_program',
                         (SELECT max_by(scan_id, scan_ts) FROM {ctx.tables.program})
        UNION ALL SELECT 'metrics_capacity',
                         (SELECT max_by(scan_id, scan_ts) FROM {ctx.tables.capacity})
        UNION ALL SELECT 'metrics_sensitivity',
                         (SELECT max_by(scan_id, scan_ts) FROM {ctx.tables.sensitivity})
        UNION ALL SELECT 'scans', (SELECT max_by(scan_id, scan_ts) FROM {ctx.tables.scans})
        UNION ALL SELECT 'vuln_ledger', (SELECT max(last_scan_id) FROM {ctx.tables.ledger})
        """
    )


def run_health(spark: SparkSession, ctx: Ctx) -> DataFrame:
    """One row per scan: what each gold table holds for it, and whether the ledger saw it."""
    return spark.sql(
        f"""
        SELECT s.scan_id, s.scan_ts, s.total,
               (SELECT count(*) FROM {ctx.tables.mttr} m WHERE m.scan_id = s.scan_id) AS mttr_rows,
               (SELECT count(*) FROM {ctx.tables.program} p
                 WHERE p.scan_id = s.scan_id) AS program_rows,
               (SELECT count(*) FROM {ctx.tables.capacity} c
                 WHERE c.scan_id = s.scan_id) AS capacity_rows,
               (SELECT count(*) FROM {ctx.tables.ledger} l
                 WHERE l.last_scan_id = s.scan_id) AS ledger_rows
        FROM v_scans s ORDER BY s.scan_ts DESC
        """
    )


# --------------------------------------------------------------------------------- contract
#
# What every panel returns. A test runs each one against real pipeline output and compares --
# the descendant of the dashboard suite's "every encoded field is a real column", and the thing
# that keeps a notebook cell from naming a column that quietly stopped existing.

OUTPUT_COLUMNS: Dict[str, Tuple[str, ...]] = {
    "posture": (
        "km_median", "km_median_lower_bound", "km_rmst", "km_truncated", "tracked",
        "resolved", "open", "sla_pct",
    ),
    "mttr_headline": (
        "km_median", "km_median_lower_bound", "mttr_median", "sla_pct", "open_age_p90",
        "open", "resolved", "resolved_api", "resolved_disappeared", "tracked",
    ),
    "program_headline": (
        "coverage_pct", "coverage_lo", "coverage_hi", "efficiency_pct", "efficiency_lo",
        "efficiency_hi", "prevalence_pct", "signal_coverage_pct", "tp", "fp", "fn", "tn",
        "unknown_remediated", "unknown_open", "high_risk", "not_high_risk", "classified",
        "unknown", "total", "mmcr_mean", "one_in_n", "net_total", "overall_verdict",
    ),
    "register_totals": ("tracked", "open", "resolved"),
    "last_scan": ("scan_ts", "scan_id", "scope", "severities", "total", "age_days"),
    "week_delta": ("km", "prev_km", "prev_ts", "delta"),
    "all_time": ("tracked", "open", "resolved", "scans", "first_scan_ts", "last_scan_ts"),
    "movement": ("new_count", "resolved_count", "reopened_count", "persisting", "has_previous"),
    "exploit_tiles": (
        "open", "kev", "exploit", "high_epss", "kev_missing", "exploit_missing", "epss_missing",
    ),
    "severity_open": ("severity", "open", "sev_rank"),
    "severity_cards": ("severity", "open", "resolved", "total", "delta_open", "sev_rank"),
    "severity_table": (
        "severity", "km_median", "km_median_lower_bound", "mttr_median", "sla_target",
        "sla_pct", "open", "resolved", "resolved_api", "resolved_disappeared",
        "open_age_p50", "open_age_p90", "open_past_sla", "open_with_target", "mttr_p90",
    ),
    "sla_extras": ("severity", "open_past_sla", "open_with_target", "mttr_p90"),
    "mttr_contribution": ("excess_finding_days", "km_median", "overall_km_median", "resolved"),
    "group_mix": ("group_value", "open", "is_other"),
    "group_trend": ("scan_ts", "group_value", "open"),
    "open_age_buckets": ("bucket", "bucket_rank", "severity", "sev_rank", "findings"),
    "time_to_resolve_buckets": ("bucket", "bucket_rank", "severity", "sev_rank", "findings"),
    "group_severity": ("group_value", "severity", "sev_rank", "open"),
    "severity_trend": ("scan_ts",),
    "signal_clauses": ("kev", "exploit", "epss", "any_of"),
    "risk_mix": ("group_value", "risk_label", "lifecycles"),
    "coverage_by_group": (
        "group_value", "lifecycles", "open", "resolved", "high_risk", "unclassified",
        "oldest_open_days", "signal_coverage_pct",
    ),
    "attributability": (
        "dimension", "populated", "lifecycles", "distinct_values", "populated_pct",
    ),
    "open_past_sla_trend": ("scan_ts", "open_past_sla", "open_with_target"),
    "scan_log": (
        "scan_ts", "scope", "severities", "total", "new_findings", "resolved_findings",
        "reopened_count", "scan_id",
    ),
    "rule_sweep": (
        "label", "active", "coverage_pct", "coverage_lo", "coverage_hi", "efficiency_pct",
        "efficiency_lo", "efficiency_hi", "high_risk", "unknown",
    ),
    "capacity": (
        "month", "open_at_start", "opened", "closed", "closed_observed", "mmcr", "net",
        "net_pct", "verdict", "tag",
    ),
    "quadrant": (
        "cve", "component", "severity", "asset_name", "subscription_name",
        "first_detected_at", "resolved_at", "has_kev", "has_exploit", "epss", "age_days",
        "mttr_days",
    ),
    "table_inventory": ("table_name", "rows", "latest_scan_id", "latest_ts"),
    "scan_pin_check": ("source", "scan_id"),
    "run_health": (
        "scan_id", "scan_ts", "total", "mttr_rows", "program_rows", "capacity_rows",
        "ledger_rows",
    ),
    # P2P v5. `window_months` and `assets_flowing` are on the contract deliberately: they are
    # what stops a confident-looking capacity split over three assets and one month passing
    # for a trend, so a page must not be able to drop them.
    "asset_profile": (
        "asset_group", "assets", "open_findings", "density_p25", "density_p50", "density_p75",
        "assets_with_high_risk_pct", "assets_with_high_risk", "asset_coverage_p50",
        "km_median_days", "km_median_lower_bound", "mmcr_p50", "falling_behind_pct",
        "maintaining_pct", "gaining_pct", "assets_flowing", "window_months",
    ),
    "asset_density": (
        "asset_group", "population", "assets", "density_p25", "density_p50", "density_p75",
    ),
    "asset_footholds": (
        "asset_group", "assets", "assets_with_high_risk", "assets_with_high_risk_pct",
        "km_median_days",
    ),
    "asset_capacity": (
        "asset_group", "assets_flowing", "window_months", "mmcr_p50", "falling_behind_pct",
        "maintaining_pct", "gaining_pct",
    ),
    "weakness_mix": ("weakness", "lifecycles", "high_risk", "unclassified", "open"),
}
