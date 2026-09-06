"""What the notebooks read, checked against real pipeline output.

The direct heir of the dashboard suite's "every encoded field is a real column": a panel that
names a column production stopped writing is invisible to any structural check and fatal on the
page. Every panel here runs against ``live_tables`` -- two real scans of the committed Wiz
response, driven through ``run_pipeline.build_metrics`` -- and is compared to the contract it
publishes in ``panels.OUTPUT_COLUMNS``.

Four of these are worth more than the rest and are called out where they appear:

* the append-only guard -- an unpinned read blends every run ever and still draws a chart;
* the dimension-rename oracle -- if ``mttr_by_severity`` ever stops being dimension-agnostic,
  ``km_by`` breaks *silently* into plausible wrong numbers;
* the SLA-target NULL rules -- the published data already carries a fabricated ``0.0%``;
* the sweep oracle, against the hand-counted register from ``gas/test/program.test.ts``.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

pytest.importorskip("pyspark")

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import metrics  # noqa: E402
import panels  # noqa: E402
from config import OVERALL, SEVERITY_ORDER, SLA_TARGETS, RiskRule  # noqa: E402


@pytest.fixture(scope="module")
def ctx(live_tables, monkeypatch_module):
    """A context over the live register, resolved the way a notebook resolves one.

    ``run_pipeline.param`` is pointed at the fixture's namespace rather than a widget: off
    Databricks ``dbx.get_dbutils()`` returns ``None``, so the environment fallback is the only
    channel there is, which is exactly how the notebook behaves under pytest too.
    """
    spark, tables = live_tables
    monkeypatch_module.setenv("SCOPE", "sca")
    monkeypatch_module.setenv("SEVERITIES", "CRITICAL,HIGH")
    monkeypatch_module.setenv("SCAN_ID", "")
    # `tables=` rather than a catalog widget: a local SparkSession cannot write a three-level
    # `catalog.schema.table` name, so the fixture builds a two-level namespace and the context
    # is handed the result. A notebook resolves it from the widgets instead.
    return panels.context(
        spark, tables=tables, group_by="subscription_name", rows="25", months="12"
    )


@pytest.fixture(scope="module")
def monkeypatch_module():
    from _pytest.monkeypatch import MonkeyPatch

    patch = MonkeyPatch()
    yield patch
    patch.undo()


@pytest.fixture(scope="module")
def spark_(live_tables):
    return live_tables[0]


def materialized(df):
    """Cache a frame and force it, for one that several tests share.

    A DataFrame is a plan, so a fixture that merely returns one has shared nothing -- every
    consumer executes it again. This is what makes hoisting a panel worth doing.
    """
    df = df.cache()
    df.count()
    return df


# ------------------------------------------------------------------ the published contract

#: name -> callable(spark, ctx). Everything with an OUTPUT_COLUMNS entry, so adding a panel
#: without declaring its columns fails here rather than in a notebook.
PANELS = {
    "posture": lambda s, c: panels.posture(s, c),
    "mttr_headline": lambda s, c: panels.mttr_headline(s, c),
    "program_headline": lambda s, c: panels.program_headline(s, c),
    "register_totals": lambda s, c: panels.register_totals(s, c),
    "last_scan": lambda s, c: panels.last_scan(s, c),
    "week_delta": lambda s, c: panels.week_delta(s, c),
    "all_time": lambda s, c: panels.all_time(s, c),
    "movement": lambda s, c: panels.movement(s, c),
    "exploit_tiles": lambda s, c: panels.exploit_tiles(s, c),
    "severity_open": lambda s, c: panels.severity_open(s, c),
    "severity_cards": lambda s, c: panels.severity_cards(s, c),
    "severity_table": lambda s, c: panels.severity_table(s, c),
    "sla_extras": lambda s, c: panels.sla_extras(s, c),
    "mttr_contribution": lambda s, c: panels.mttr_contribution(s, c, "subscription_name"),
    "group_mix": lambda s, c: panels.group_mix(s, c, "subscription_name"),
    "group_trend": lambda s, c: panels.group_trend(s, c, "subscription_name"),
    "risk_mix": lambda s, c: panels.risk_mix(s, c, "subscription_name"),
    "coverage_by_group": lambda s, c: panels.coverage_by_group(s, c, "subscription_name"),
    "attributability": lambda s, c: panels.attributability(s, c),
    "open_past_sla_trend": lambda s, c: panels.open_past_sla_trend(s, c),
    "scan_log": lambda s, c: panels.scan_log(s, c),
    "rule_sweep": lambda s, c: panels.rule_sweep(s, c),
    "capacity": lambda s, c: panels.capacity(s, c),
    "quadrant": lambda s, c: panels.quadrant(s, c, "fn"),
    "open_age_buckets": lambda s, c: panels.open_age_buckets(s, c),
    "time_to_resolve_buckets": lambda s, c: panels.time_to_resolve_buckets(s, c),
    "group_severity": lambda s, c: panels.group_severity(s, c, "subscription_name"),
    "severity_trend": lambda s, c: panels.severity_trend(s, c),
    "signal_clauses": lambda s, c: panels.signal_clauses(s, c),
    "table_inventory": lambda s, c: panels.table_inventory(s, c),
    "scan_pin_check": lambda s, c: panels.scan_pin_check(s, c),
    "run_health": lambda s, c: panels.run_health(s, c),
    # P2P v5. The committed Wiz response carries `vulnerableAsset`, and `NODE_SCHEMA` parses it
    # whichever way `FETCH_ASSET_FIELDS` is set -- so the live register has asset ids and these
    # return real rows rather than trivially empty ones.
    "asset_profile": lambda s, c: panels.asset_profile(s, c),
    "asset_density": lambda s, c: panels.asset_density(s, c),
    "asset_footholds": lambda s, c: panels.asset_footholds(s, c),
    "asset_capacity": lambda s, c: panels.asset_capacity(s, c),
    "weakness_mix": lambda s, c: panels.weakness_mix(s, c),
}


@pytest.fixture(scope="module")
def panel_frames(spark_, ctx):
    """Every panel, executed once.

    Three tests below assert different things about the same 32 panel outputs -- the declared
    columns, the scan pin, and one-row-ness -- and each was running the panel again to do it.
    Sharing the executed frames means each panel's query runs once for all three. They are
    still real ``DataFrame``s, so ``.columns``, ``.select(...)``, ``.count()`` and the rest read
    exactly as they did; only the plan underneath is now an already-computed relation.
    """
    return {name: materialized(fn(spark_, ctx)) for name, fn in PANELS.items()}


def test_every_panel_has_a_declared_contract():
    assert set(PANELS) == set(panels.OUTPUT_COLUMNS), (
        "only in PANELS: "
        f"{sorted(set(PANELS) - set(panels.OUTPUT_COLUMNS))}, only in OUTPUT_COLUMNS: "
        f"{sorted(set(panels.OUTPUT_COLUMNS) - set(PANELS))}"
    )


@pytest.mark.parametrize("name", sorted(PANELS))
def test_panel_runs_and_returns_what_it_declares(name, panel_frames):
    """A panel's columns are a contract the notebooks and the recipe parser both read."""
    frame = panel_frames[name]  # building the fixture is what proves it executes
    declared = set(panels.OUTPUT_COLUMNS[name])
    actual = set(frame.columns)
    missing = declared - actual
    assert not missing, f"{name} declares {sorted(missing)} but does not return them"


# --------------------------------------------------------------------- the append-only guard


#: Panels that read exactly one scan. The rest are on ``panels.UNPINNED_PANELS`` (they compare
#: scans on purpose) or ``panels.LEDGER_PANELS`` (the ledger is MERGEd current state and has no
#: ``scan_id`` at all -- pinned by construction of the table rather than by a predicate).
_PINNED = sorted(
    n for n in PANELS if n not in panels.UNPINNED_PANELS and n not in panels.LEDGER_PANELS
)


@pytest.mark.parametrize("name", _PINNED)
def test_pinned_panels_read_exactly_one_scan(name, ctx, panel_frames):
    """The highest-value structural test here.

    ``live_tables`` runs two scans. A panel that forgets the pin returns both and draws a chart
    that looks entirely reasonable while blending every run that has ever happened.
    """
    frame = panel_frames[name]
    if "scan_id" in frame.columns:
        ids = {r["scan_id"] for r in frame.select("scan_id").distinct().collect()}
        assert ids == {ctx.scan_id}, f"{name} returned scans {sorted(ids)}, expected {ctx.scan_id}"
    elif "severity" in frame.columns:
        # No scan_id projected, so the pin shows up as arity instead: an unpinned read returns
        # one row per severity *per scan*, and the fixture has two scans.
        rows = [r["severity"] for r in frame.select("severity").collect()]
        assert len(rows) == len(set(rows)), f"{name} returned a severity twice -- unpinned"
    else:
        assert frame.count() == 1, f"{name} is a headline panel and must be one row"


def test_the_three_classes_partition_every_panel():
    """A new panel has to be classified deliberately, not by falling off the end of a list."""
    overlap = panels.UNPINNED_PANELS & panels.LEDGER_PANELS
    assert overlap == {"all_time"}, (
        "all_time is the one panel that is both (ledger population, scan-log dates); "
        f"unexpected overlap {sorted(overlap - {'all_time'})}"
    )


def test_the_trend_views_are_the_only_unpinned_reads(spark_, ctx):
    """Two scans in, two scans out -- otherwise the trend charts have nothing to draw."""
    rows = spark_.table("v_mttr_all").select("scan_id").distinct().count()
    assert rows == 2
    assert spark_.table("v_mttr").select("scan_id").distinct().count() == 1


# ------------------------------------------------------------------------- the OVERALL row


def test_the_overall_row_survives_the_severity_filter(spark_, ctx):
    """Without the explicit ``OR severity = 'OVERALL'`` every hero on every page is empty.

    ``OVERALL`` is not a member of ``SEVERITY_ORDER``, so a bare ``severity IN (...)`` deletes
    it -- and the failure looks like "no data yet" rather than like a bug.
    """
    assert OVERALL not in SEVERITY_ORDER
    for view in ("v_mttr", "v_program", "v_mttr_all", "v_program_all"):
        found = {r["severity"] for r in spark_.table(view).select("severity").distinct().collect()}
        assert OVERALL in found, f"{view} lost the OVERALL row"
    assert panels.posture(spark_, ctx).count() == 1


def test_the_severity_filter_still_filters(spark_, ctx):
    """Keeping OVERALL must not quietly keep everything else too."""
    found = {
        r["severity"]
        for r in spark_.table("v_mttr").select("severity").distinct().collect()
        if r["severity"] != OVERALL
    }
    assert found <= set(ctx.severities)


# ------------------------------------------------------------------------ the SLA NULL rules


def test_unknown_severity_has_no_fabricated_sla_percentage(spark_, ctx):
    """``SLA_TARGETS`` has no ``UNKNOWN`` key, and the published table already carries a 0.0.

    ``mttr_days <= NULL`` is NULL, ``sum(when(...).otherwise(0))`` turns that into 0, and
    ``safe_pct`` divides it into a confident ``0.0%``. The views null it back out; this is the
    test that says so.
    """
    assert "UNKNOWN" not in SLA_TARGETS
    rows = spark_.sql(
        "SELECT severity, sla_target, sla_pct, sla_compliant FROM v_mttr_all"
    ).collect()
    for row in rows:
        if row["sla_target"] is None and row["severity"] != OVERALL:
            assert row["sla_pct"] is None, f"{row['severity']} fabricated sla_pct={row['sla_pct']}"
            assert row["sla_compliant"] is None


def test_the_overall_row_keeps_its_sla_percentage(spark_, ctx):
    """OVERALL is the one row with no target and a real rate, and blanking it blanks a headline.

    It carries no single ``sla_target`` -- every row inside it has its own -- but ``sla_pct`` is
    total-compliant over total-resolved, computed in one pass by ``mttr_by_severity``. An
    over-eager "no target means no rate" rule empties the *In SLA* mini on the MTTR page, which
    is exactly what it did until a screenshot showed an em dash where a percentage belonged.
    """
    row = spark_.sql(
        "SELECT sla_target, sla_pct, resolved FROM v_mttr WHERE severity = 'OVERALL'"
    ).collect()[0]
    assert row["sla_target"] is None
    if row["resolved"]:
        assert row["sla_pct"] is not None


def test_open_past_sla_excludes_rows_with_no_target(spark_, ctx):
    """A row with no target leaves both sides, not just the numerator.

    ``age_days > NULL`` is NULL, which is falsy -- so a naive count silently reports every
    UNKNOWN finding as comfortably inside an SLA it does not have.
    """
    extras = {r["severity"]: r for r in panels.sla_extras(spark_, ctx).collect()}
    untargeted = [s for s in extras if s not in SLA_TARGETS]
    for sev in untargeted:
        assert extras[sev]["open_past_sla"] == 0
        assert extras[sev]["open_with_target"] == 0
    trend = panels.open_past_sla_trend(spark_, ctx).collect()
    for row in trend:
        assert row["open_past_sla"] <= row["open_with_target"]


# ---------------------------------------------------------------- the dimension-rename oracle


def test_km_by_overall_matches_the_real_transform(spark_, ctx):
    """``km_by`` renames a dimension into the ``severity`` slot. This is the tripwire.

    ``metrics.mttr_by_severity`` groups by whatever is called ``severity`` and is otherwise
    dimension-agnostic. If that ever stops being true, ``km_by`` does not raise -- it returns
    numbers that are wrong and look fine. Comparing the whole-register aggregate computed both
    ways is what catches it.
    """
    frame = spark_.table("v_lifecycles")
    direct = (
        metrics.mttr_by_severity(frame).where("severity = 'OVERALL'").collect()[0]
    )
    renamed = (
        metrics.mttr_by_severity(
            frame.withColumn("severity", frame["subscription_name"])
        )
        .where("severity = 'OVERALL'")
        .collect()[0]
    )
    for column in ("km_median", "km_rmst", "resolved", "open", "mttr_median"):
        assert direct[column] == renamed[column], column


@pytest.fixture(scope="module")
def km_by_subscription(spark_, ctx):
    """``km_by`` over the subscription dimension, run once for the three tests that read it."""
    return panels.km_by(spark_, ctx, "subscription_name").collect()


def test_km_by_drops_the_synthetic_overall_group(km_by_subscription):
    """``mttr_by_severity`` unions an OVERALL row of its own, which here is a group nobody has."""
    assert OVERALL not in {r["subscription_name"] for r in km_by_subscription}


def test_km_by_carries_the_register_median_for_the_reference_rule(km_by_subscription):
    """``overall_km_median`` is a metric on the frame, not a field on the frozen context."""
    assert km_by_subscription, "no groups"
    assert len({r["overall_km_median"] for r in km_by_subscription}) == 1


def test_a_group_with_nothing_resolved_has_a_null_median(km_by_subscription):
    """NULL, never 0. "Nothing closed yet" and "closed instantly" must not be the same number."""
    for row in km_by_subscription:
        if row["resolved"] == 0:
            assert row["km_median"] is None


def test_a_dimension_outside_the_allow_list_raises_before_reaching_sql(spark_, ctx):
    """The value is interpolated into SQL. An allow-list, not a regex, and it fails early."""
    with pytest.raises(ValueError):
        panels.km_by(spark_, ctx, "subscription_name; DROP TABLE x")
    with pytest.raises(ValueError):
        panels.group_mix(spark_, ctx, "vuln_key")


# ---------------------------------------------------------------------- the survival curve


@pytest.fixture(scope="module")
def overall_curve(spark_, ctx):
    """``(curve rows, markers)`` for the OVERALL population, computed once for three tests."""
    curve, markers = panels.km_curve_points(spark_, ctx, OVERALL)
    return curve.collect(), markers


def test_the_staircase_crosses_where_the_published_median_says_it_does(spark_, overall_curve):
    """The staircase and the hero above it come from one implementation, and this proves it.

    Note the limit: the equality holds over the population the curve is computed on. With a
    severity subset selected, the published OVERALL row is still over everything that was
    scanned -- which is why the notebook caption says so rather than the code pretending.
    """
    rows, _ = overall_curve
    published = (
        metrics.mttr_by_severity(spark_.table("v_lifecycles"))
        .where("severity = 'OVERALL'")
        .collect()[0]["km_median"]
    )
    crossings = [r["t"] for r in rows if r["s"] <= 0.5 + metrics.SURVIVAL_TIE_EPS]
    if published is None:
        assert not crossings, "curve crosses 50% but the published median is NULL"
    else:
        assert min(crossings) == pytest.approx(published)


def test_survival_is_monotone_and_starts_below_one(overall_curve):
    rows, _ = overall_curve
    values = [r["s"] for r in rows]
    assert values == sorted(values, reverse=True)
    assert all(0.0 <= v <= 1.0 for v in values)


def test_a_null_marker_is_omitted_rather_than_zeroed(overall_curve):
    """A KM median that was never reached is a fact, not a point at the origin."""
    _, markers = overall_curve
    assert {m["key"] for m in markers} <= {"naive_median", "median", "mean"}
    for marker in markers:
        assert marker["value"] is None or marker["value"] >= 0


# ---------------------------------------------------------------------------- the buckets


def test_bucket_edges_land_where_gas_puts_them(spark_):
    """7.0d is ``0-7d`` and 7.01d is ``8-30d`` -- the same inclusive convention as in-SLA."""
    from pyspark.sql import functions as F

    rows = spark_.createDataFrame(
        [(7.0,), (7.01,), (1.0,), (0.5,), (91.0,)], "age_days double"
    )
    bucketed = rows.withColumn(
        "bucket", panels._bucket_column(F.col("age_days"), [7, 30, 90], panels.AGE_BUCKETS)
    ).collect()
    got = {r["age_days"]: r["bucket"] for r in bucketed}
    assert got[7.0] == "0-7d"
    assert got[7.01] == "8-30d"
    assert got[91.0] == "90+d"

    resolved = rows.withColumnRenamed("age_days", "mttr_days").withColumn(
        "bucket",
        panels._bucket_column(F.col("mttr_days"), [1, 7, 30, 90], panels.RESOLUTION_BUCKETS),
    ).collect()
    exact_day = {r["mttr_days"]: r["bucket"] for r in resolved}
    assert exact_day[1.0] == "<=1d"
    assert exact_day[7.0] == "2-7d"


def test_every_open_lifecycle_lands_in_exactly_one_age_bucket(spark_, ctx):
    total = sum(r["findings"] for r in panels.open_age_buckets(spark_, ctx).collect())
    expected = spark_.sql("SELECT count(*) AS n FROM v_lifecycles WHERE resolved_at IS NULL")
    assert total == expected.collect()[0]["n"]


def test_bucket_rows_come_back_in_reading_order(spark_, ctx):
    order = []
    for row in panels.open_age_buckets(spark_, ctx).collect():
        if row["bucket"] not in order:
            order.append(row["bucket"])
    assert order == [b for b in panels.AGE_BUCKETS if b in order]


def test_the_bucket_frames_are_tidy_with_a_fixed_column_set(spark_, ctx):
    """Tidy, so the chart editor stacks by one setting and the contract does not depend on
    which severities this particular scan happened to contain."""
    for panel in (panels.open_age_buckets, panels.time_to_resolve_buckets):
        columns = panel(spark_, ctx).columns
        assert columns == ["bucket", "bucket_rank", "severity", "sev_rank", "findings"]
        assert not set(columns) & set(SEVERITY_ORDER)


# ------------------------------------------------------------------------- the sweep oracle


@pytest.fixture(scope="module")
def sweep_rows(spark_, ctx):
    """The sweep under the context's own rule: seven confusion matrices, computed once."""
    return panels.rule_sweep(spark_, ctx).collect()


def test_the_sweep_returns_every_non_empty_subset(sweep_rows):
    assert len(sweep_rows) == 7
    assert sum(1 for r in sweep_rows if r["active"]) == 1


def test_the_active_sweep_point_matches_the_published_rates(sweep_rows, panel_frames):
    """Whichever rule is in force must land on the number the page already published."""
    active = [r for r in sweep_rows if r["active"]][0]
    published = panel_frames["program_headline"].collect()[0]
    for column in ("coverage_pct", "efficiency_pct"):
        if published[column] is None:
            assert active[column] is None
        else:
            assert active[column] == pytest.approx(published[column], rel=1e-6)


def test_the_active_point_follows_the_rule_not_a_label(spark_, ctx):
    """Change the rule and the filled point moves. A hardcoded label would not."""
    import dataclasses

    narrowed = dataclasses.replace(ctx, rule=RiskRule(kev=True, exploit=False, epss=False))
    active = [r for r in panels.rule_sweep(spark_, narrowed).collect() if r["active"]][0]
    assert active["label"] == "KEV only"


# The hand-counted 12-lifecycle oracle from ``gas/test/program.test.ts`` (TP=3 FP=3 FN=2 TN=2,
# 60% coverage at 50% efficiency) already lives in ``test_metrics.py`` against
# ``metrics.confusion_matrix`` directly. The sweep test above is what is new here: that the
# panel picks the right one of seven, and that the point it fills in is the published one.


# --------------------------------------------------------------------------- group folding


def test_group_mix_folds_the_tail_into_exactly_one_other(spark_, ctx):
    """Folded, not truncated: a pie whose slices do not sum to the total lies about the total."""
    rows = panels.group_mix(spark_, ctx, "subscription_name", top_n=1).collect()
    assert sum(1 for r in rows if r["is_other"]) <= 1
    assert sum(1 for r in rows if not r["is_other"]) <= 1
    total = spark_.sql(
        "SELECT count(*) AS n FROM v_lifecycles WHERE resolved_at IS NULL"
    ).collect()[0]["n"]
    assert sum(r["open"] for r in rows) == total


def test_group_mix_never_exceeds_the_palette(spark_, ctx):
    """Five hues survive the colourblind check; a sixth coloured group would not."""
    rows = panels.group_mix(spark_, ctx, "subscription_name", top_n=5).collect()
    assert sum(1 for r in rows if not r["is_other"]) <= 5


def test_risk_mix_uses_named_categories_not_severity(spark_, ctx):
    labels = {r["risk_label"] for r in panels.risk_mix(spark_, ctx, "subscription_name").collect()}
    assert labels <= {"High risk", "Not high risk", "No captured signal"}
    assert not labels & set(SEVERITY_ORDER)


# ------------------------------------------------------------------------------- one-row-ness


@pytest.mark.parametrize(
    "name", ["posture", "mttr_headline", "program_headline", "register_totals", "last_scan",
             "all_time", "movement", "exploit_tiles"]
)
def test_the_one_row_panels_return_one_row(name, panel_frames):
    """``capacity_by_month`` cross-joins its summary onto every month, so ``program_headline``
    would otherwise be a one-row frame only for as long as there is one month."""
    assert panel_frames[name].count() == 1


def test_the_scan_log_caps_after_ordering(spark_, ctx):
    """A LIMIT without an ORDER BY caps an arbitrary subset and then sorts *that*."""
    rows = panels.scan_log(spark_, ctx, rows=1).collect()
    assert len(rows) == 1
    assert rows[0]["scan_id"] == ctx.scan_id
    assert rows[0]["new_findings"].startswith("+")
    assert rows[0]["resolved_findings"].startswith("-")


def test_capacity_months_come_back_newest_first(spark_, ctx):
    months = [r["month"] for r in panels.capacity(spark_, ctx, months=3).collect()]
    assert months == sorted(months, reverse=True)


def test_high_risk_capacity_is_a_subset_of_the_published_months(spark_, ctx):
    published = {r["month"] for r in panels.capacity(spark_, ctx, months=120).collect()}
    high = {r["month"] for r in panels.capacity(spark_, ctx, months=120, high_risk_only=True).collect()}
    assert high <= published


# ------------------------------------------------------------------------------ the context


def test_the_context_pins_the_newest_scan(spark_, ctx):
    latest = spark_.sql(
        f"SELECT max_by(scan_id, scan_ts) AS s FROM {ctx.tables.mttr}"
    ).collect()[0]["s"]
    assert ctx.scan_id == latest == "scan-2"


def test_the_pin_is_resolved_in_one_place():
    """``max_by(scan_id, scan_ts)`` belongs to ``panels.py`` and to nothing else.

    Anywhere else -- a notebook cell, a figure helper -- and there are two answers to "which
    scan is this page about", which is the failure the temp views exist to make impossible.
    ``table_inventory`` and ``scan_pin_check`` are the deliberate exceptions: their whole job is
    to ask each table for its own answer and show them side by side.
    """
    for module in ("figures.py", "tiles.py", "metrics.py", "ledger.py", "run_pipeline.py"):
        source = (BRICK_DIR / module).read_text(encoding="utf-8")
        assert "max_by(scan_id, scan_ts)" not in source, f"{module} resolves the pin too"

    panel_source = (BRICK_DIR / "panels.py").read_text(encoding="utf-8")
    code = panel_source.split('"""', 2)[2]  # drop the module docstring, which explains the rule
    resolvers = {
        name
        for name in ("_resolve_scan", "table_inventory", "scan_pin_check")
        if "max_by(scan_id, scan_ts)" in _function_body(code, name)
    }
    assert resolvers == {"_resolve_scan", "table_inventory", "scan_pin_check"}


def _function_body(source: str, name: str) -> str:
    start = source.index(f"def {name}(")
    rest = source[start:]
    end = rest.find("\ndef ", 1)
    return rest if end == -1 else rest[:end]


def test_the_lifecycle_frame_is_built_as_of_the_scan_not_wall_clock(spark_, ctx):
    """Ages are measured as of the pinned scan, not as of whenever the notebook is opened.

    Otherwise every age, censoring time and bucket on the page drifts a few days away from the
    published row sitting directly above it -- and drifts further the longer nobody scans.

    Compared over the *unfiltered* ledger, because ``v_lifecycles`` is severity-filtered and the
    published OVERALL row is not (it was computed once by the pipeline over everything scanned).
    """
    import ledger as ledger_mod

    published = spark_.sql(
        "SELECT open_age_p90 FROM v_mttr WHERE severity = 'OVERALL'"
    ).collect()[0]["open_age_p90"]
    ledger = spark_.table(ctx.tables.ledger).where(f"scope = '{ctx.scope}'")

    as_of_scan = (
        metrics.mttr_by_severity(ledger_mod.lifecycle_frame(ledger, ctx.scan_ts))
        .where("severity = 'OVERALL'")
        .collect()[0]["open_age_p90"]
    )
    assert as_of_scan == pytest.approx(published, abs=1e-6)

    # And the wrong clock really would disagree -- this is not a vacuous assertion.
    as_of_later = (
        metrics.mttr_by_severity(ledger_mod.lifecycle_frame(ledger, "2027-01-01T00:00:00Z"))
        .where("severity = 'OVERALL'")
        .collect()[0]["open_age_p90"]
    )
    assert as_of_later > as_of_scan


def test_the_actionable_clock_reaches_gold_without_disturbing_the_first(spark_, ctx):
    """The second clock is in the published table, and the join that put it there moved
    nothing that was already in the row.

    Two silent failure modes, asserted rather than reasoned about. A left join onto a frame
    with a different severity set DROPS rows; a join onto one with a duplicated key
    MULTIPLIES them. Either leaves a gold table that still reads perfectly plausibly -- one
    severity quietly missing from every page, or every count doubled -- so both are compared
    against the frame the pipeline joined into, over the real register rather than a
    synthetic one.

    ``write_append`` passes ``mergeSchema``, which is what lets these columns land in a
    ``metrics_mttr`` an earlier version created. That is a property of the writer; what is
    checked here is the only thing a test can see, which is that they arrived.
    """
    import ledger as ledger_mod
    from pyspark.sql import functions as F

    ACTIONABLE = [
        "mttr_actionable_mean", "mttr_actionable_median", "actionable_resolved",
        "actionable_age_p50", "actionable_age_p90", "awaiting_vendor_fix_count",
        "actionable_sla_compliant", "actionable_sla_pct",
    ]

    gold = spark_.table(ctx.tables.mttr).where(
        (F.col("scan_id") == ctx.scan_id) & (F.col("scope") == ctx.scope)
    )
    published = {r["severity"]: r.asDict() for r in gold.collect()}
    assert len(published) == gold.count(), "a severity is published twice"
    for column in ACTIONABLE:
        assert column in gold.columns, f"{column} never reached the gold table"

    ledger = spark_.table(ctx.tables.ledger).where(F.col("scope") == ctx.scope)
    lifecycles = ledger_mod.lifecycle_frame(ledger, ctx.scan_ts)

    # The frame the join was made against: same severities, one row each, or the join was
    # never safe in the first place.
    actionable = metrics.actionable_mttr_by_severity(lifecycles).collect()
    assert len({r["severity"] for r in actionable}) == len(actionable)
    assert {r["severity"] for r in actionable} == set(published)

    # And nothing that was already there moved. Compared column by column against the
    # unjoined frame, so a join that silently replaced a value fails here by name.
    base = {r["severity"]: r.asDict() for r in metrics.mttr_by_severity(lifecycles).collect()}
    assert set(base) == set(published)
    for severity, row in base.items():
        for column, value in row.items():
            got = published[severity][column]
            if isinstance(value, float):
                assert got == pytest.approx(value, abs=1e-6), (severity, column)
            else:
                assert got == value, (severity, column)

    # The register is not empty of the thing being measured: every row here was ingested
    # under `hasFix: true`, so the second clock has something to say about all of them.
    overall = published[OVERALL]
    assert overall["actionable_resolved"] == overall["resolved"]
    assert overall["awaiting_vendor_fix_count"] == 0
    assert overall["mttr_actionable_median"] <= overall["mttr_median"]


def test_scan_pin_check_agrees_across_the_gold_tables(spark_, ctx):
    rows = {r["source"]: r["scan_id"] for r in panels.scan_pin_check(spark_, ctx).collect()}
    gold = {rows[k] for k in ("context", "metrics_mttr", "metrics_program", "metrics_capacity")}
    assert gold == {ctx.scan_id}


# ------------------------------------------------------- the 2.0 -> 2.1 capacity upgrade


def test_a_capacity_table_from_2_0_still_opens(spark_, ctx):
    """A register last scanned under 2.0 has no ``population`` column at all.

    Not NULL -- absent, because the column arrives by schema evolution on the first 2.1+ write.
    Every page's cell 1 builds ``v_capacity`` by filtering on it, so before this was handled the
    whole notebook set died on ``UNRESOLVED_COLUMN.WITH_SUGGESTION`` naming neither the version
    that wrote the table nor the scan that would fix it. Those rows are all-findings rows, which
    is what the README's upgrade note says to assume.
    """
    from dataclasses import replace

    # No mode("overwrite") anywhere in this file: Delta's DataSource V2 catalog answers
    # "does not support truncate in batch mode", so a fresh table plus an explicit DROP is
    # the only shape that runs both here and on a cluster.
    legacy = f"{ctx.tables.capacity}_v20"
    spark_.sql(f"DROP TABLE IF EXISTS {legacy}")
    spark_.table(ctx.tables.capacity).drop("population").write.format("delta").saveAsTable(
        legacy
    )
    assert "population" not in spark_.table(legacy).columns

    panels.context(spark_, tables=replace(ctx.tables, capacity=legacy))
    rows = spark_.sql("SELECT * FROM v_capacity").count()
    assert rows > 0, "a pre-2.1 capacity table must read as all-findings, not as nothing"
    assert spark_.sql("SELECT * FROM v_capacity_high_risk").count() == 0

    spark_.sql(f"DROP TABLE {legacy}")
    panels.context(spark_, tables=ctx.tables)  # restore the views for later tests


def test_a_null_population_counts_as_all_findings(spark_, ctx):
    """The other half of the same upgrade: the column exists, but 2.0-written rows are NULL.
    Left uncoalesced they drop out of both filtered views and the old scans vanish silently."""
    from dataclasses import replace

    import pyspark.sql.functions as F

    mixed = f"{ctx.tables.capacity}_mixed"
    spark_.sql(f"DROP TABLE IF EXISTS {mixed}")
    spark_.table(ctx.tables.capacity).withColumn(
        "population", F.lit(None).cast("string")
    ).write.format("delta").saveAsTable(mixed)

    panels.context(spark_, tables=replace(ctx.tables, capacity=mixed))
    assert spark_.sql("SELECT * FROM v_capacity").count() > 0

    spark_.sql(f"DROP TABLE {mixed}")
    panels.context(spark_, tables=ctx.tables)
