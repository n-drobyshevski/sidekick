"""Structure, not pixels -- the contract ``test_charts.py`` used to hold for the matplotlib set.

Nothing here renders anything. Every assertion is about ``fig.data`` and ``fig.layout``, which
is the whole reason the GAS-specific shapes are Plotly rather than notebook chart metadata: a
``Figure`` is an object a test can interrogate, and an undocumented ``+cell`` visualization key
is not.

Two invariants are mechanised here for the first time in this repo. ``charts.py`` asserted the
first one by looking for words in ``ax.texts``; the second was only ever a docstring and a code
review:

* **NULL is not zero** -- a missing value is an annotated gap, contributes no bar, puts ``None``
  in a series rather than ``0.0``, and takes the fill off any line it appears in.
* **Severity is never carried by colour alone** -- anything painted a severity fill has to name
  that severity somewhere, and two series in one chart have to differ in dash or symbol.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

pytest.importorskip("plotly")
pd = pytest.importorskip("pandas")

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import figures as fg  # noqa: E402
from config import SEVERITY_COLORS, SEVERITY_ORDER, SLA_TARGETS  # noqa: E402


# ------------------------------------------------------------------------------- fixtures


@pytest.fixture
def mttr_rows():
    """CRITICAL deliberately has nothing resolved, so its median is NULL rather than fast."""
    return pd.DataFrame(
        {
            "severity": ["CRITICAL", "HIGH", "MEDIUM"],
            "km_median": [None, 21.0, 9.0],
            "mttr_median": [None, 18.0, 8.0],
            "sla_target": [SLA_TARGETS["CRITICAL"], SLA_TARGETS["HIGH"], SLA_TARGETS["MEDIUM"]],
            "color": [SEVERITY_COLORS[s] for s in ("CRITICAL", "HIGH", "MEDIUM")],
        }
    )


@pytest.fixture
def trend_rows():
    return pd.DataFrame(
        {
            "scan_ts": pd.to_datetime(["2026-06-01", "2026-07-01", "2026-08-01"]),
            "km_median": [12.0, None, 18.0],
            "mttr_median": [9.0, 10.0, 11.0],
            "open": [400, 380, 410],
            "resolved": [20, 45, 30],
        }
    )


def _bar(fig):
    return [t for t in fig.data if t.type == "bar"][0]


# ---------------------------------------------------------------------- NULL is not zero


def test_a_null_median_gets_words_and_no_bar(mttr_rows):
    """"No resolved findings yet" and "closed instantly" must not draw the same mark."""
    fig = fg.bars_with_reference(
        mttr_rows, value="km_median", label="severity", reference="sla_target"
    )
    bar = _bar(fig)
    assert bar.x[0] == 0 and bar.text[0] == "", "a NULL row must contribute no visible bar"
    notes = [a.text for a in fig.layout.annotations]
    assert any("no resolved findings" in n for n in notes), notes
    # ...and the category keeps its slot, so the axis still names it.
    assert list(bar.y) == ["CRITICAL", "HIGH", "MEDIUM"]


def test_a_mid_series_null_is_none_not_zero(trend_rows):
    fig = fg.trend(
        trend_rows, "scan_ts", [fg.Series("km_median", "Median MTTR (KM)")], y_unit="days"
    )
    y = list(fig.data[0].y)
    assert y[1] is None, y
    assert 0.0 not in y
    assert fig.data[0].connectgaps is False


def test_a_series_with_a_gap_loses_its_fill(trend_rows):
    """Plotly closes a fill polygon to y=0 either side of a gap, so a filled series with a NULL
    renders the gap as a collapse to zero -- the exact confusion the rule forbids."""
    gapped = fg.trend(trend_rows, "scan_ts", [fg.Series("km_median", "KM", fill=True)])
    assert gapped.data[0].fill in (None, "none")

    whole = fg.trend(trend_rows, "scan_ts", [fg.Series("mttr_median", "Naive", fill=True)])
    assert whole.data[0].fill == "tozeroy"


def test_a_null_survival_marker_is_omitted_rather_than_drawn_at_zero():
    curve = pd.DataFrame({"t": [1.0, 5.0, 20.0], "s": [0.9, 0.6, 0.4]})
    fig = fg.survival(
        curve,
        [
            {"label": "Median (KM, all)", "color": fg.ACCENT, "symbol": "triangle-up",
             "value": 20.0, "s": 40},
            {"label": "Median (closed)", "color": fg.INK, "symbol": "circle", "value": None},
        ],
    )
    names = [t.name for t in fig.data]
    assert "Median (KM, all)" in names
    assert "Median (closed)" not in names


def test_the_trend_says_out_loud_that_a_gap_is_not_a_zero(trend_rows):
    fig = fg.trend(trend_rows, "scan_ts", [fg.Series("km_median", "KM")])
    notes = [a.text for a in fig.layout.annotations]
    assert any("not zero" in n for n in notes), notes


# -------------------------------------------------------------- colour is never the only cue


def test_every_severity_symbol_is_distinct_and_covers_the_taxonomy():
    for sev in SEVERITY_ORDER:
        assert sev in fg.SEV_SYMBOL
    symbols = [fg.SEV_SYMBOL[s] for s in SEVERITY_ORDER]
    assert len(set(symbols)) == len(symbols), symbols


def test_a_severity_coloured_trace_names_its_severity():
    """The ramp fails a categorical colourblind check -- HIGH and MEDIUM are 1.6 ΔE apart under
    deuteranopia -- so anything wearing a severity fill has to say which one it is."""
    frame = pd.DataFrame(
        {
            "scan_ts": pd.to_datetime(["2026-06-01", "2026-07-01"]),
            "CRITICAL": [3, 4],
            "HIGH": [30, 28],
        }
    )
    series = fg.severity_series({"CRITICAL": "CRITICAL", "HIGH": "HIGH"}, SEVERITY_COLORS)
    fig = fg.trend(frame, "scan_ts", series)
    for trace in fig.data:
        colour = trace.line.color
        if colour in SEVERITY_COLORS.values():
            sev = [s for s, c in SEVERITY_COLORS.items() if c == colour][0]
            assert sev.lower() in (trace.name or "").lower(), (sev, trace.name)


def test_two_series_in_one_chart_differ_by_more_than_hue(trend_rows):
    fig = fg.trend(
        trend_rows,
        "scan_ts",
        [
            fg.Series("open", "Open", "#b91c1c", "solid", "circle"),
            fg.Series("resolved", "Resolved", "#15803d", "6,4", "square"),
        ],
    )
    dashes = {t.line.dash for t in fig.data}
    symbols = {t.marker.symbol for t in fig.data}
    assert len(dashes) > 1 or len(symbols) > 1


def test_a_severity_bar_carries_its_name_on_the_axis(mttr_rows):
    fig = fg.bars_with_reference(mttr_rows, value="km_median", label="severity")
    bar = _bar(fig)
    assert list(bar.marker.color) == list(mttr_rows["color"])
    assert set(bar.y) == set(mttr_rows["severity"])


def test_the_group_palette_is_the_five_that_survive_the_check():
    assert fg.CATEGORICAL == ["#2563eb", "#0d9488", "#90396a", "#7fba04", "#f66bb9"]
    assert fg.OTHER_COLOR == "#94a3b8"


# ------------------------------------------------------------------------ reference rules


def test_the_bullet_ticks_sit_on_each_severitys_own_target(mttr_rows):
    fig = fg.bars_with_reference(
        mttr_rows, value="km_median", label="severity", reference="sla_target"
    )
    ticks = [t for t in fig.data if t.type == "scatter"][0]
    assert list(ticks.x) == [SLA_TARGETS[s] for s in mttr_rows["severity"]]


def test_the_ranked_rule_is_dashed_and_the_diverging_rule_is_solid(mttr_rows):
    """Dashed is a threshold you are measured against. Solid is an origin. A group sitting at
    the register's median is not passing or failing anything."""
    ranked = fg.bars_with_reference(
        mttr_rows.dropna(subset=["km_median"]),
        value="km_median", label="severity",
        reference_style="rule", overall=14.0,
    )
    assert [s.line.dash for s in ranked.layout.shapes] == ["4,3"]
    assert any("overall" in a.text for a in ranked.layout.annotations)

    rows = pd.DataFrame({"g": ["x", "y"], "excess": [120.0, -40.0]})
    diverging = fg.diverging_bars(rows, value="excess", label="g")
    assert [s.line.dash for s in diverging.layout.shapes] == ["solid"]
    assert any("at overall median" in a.text for a in diverging.layout.annotations)


def test_diverging_labels_are_signed(mttr_rows):
    rows = pd.DataFrame({"g": ["x", "y"], "excess": [120.0, -40.0]})
    fig = fg.diverging_bars(rows, value="excess", label="g")
    assert list(_bar(fig).text) == ["+120", "-40"]


# ------------------------------------------------------------------------------- scatter


@pytest.fixture
def sweep_rows():
    return pd.DataFrame(
        {
            "coverage_pct": [60.0, 40.0],
            "efficiency_pct": [50.0, 70.0],
            "label": ["All three", "KEV only"],
            "active": [True, False],
            "coverage_lo": [50.0, 30.0],
            "coverage_hi": [66.0, 45.0],
            "efficiency_lo": [45.0, 60.0],
            "efficiency_hi": [55.0, 80.0],
        }
    )


def test_only_the_active_rule_carries_uncertainty(sweep_rows):
    """The published lo/hi bounds are the width of the unclassified population's doubt, and the
    rule in force is the one whose doubt the reader is living with."""
    fig = fg.scatter_bounds(
        sweep_rows, lo_x="coverage_lo", hi_x="coverage_hi",
        lo_y="efficiency_lo", hi_y="efficiency_hi",
    )
    active = [t for t in fig.data if t.marker.symbol == "diamond"]
    others = [t for t in fig.data if t.marker.symbol == "circle-open"]
    assert len(active) == 1
    assert active[0].error_x.array and active[0].error_y.arrayminus
    assert all(not t.error_x.array for t in others)


def test_the_scatter_labels_directly_instead_of_using_a_legend(sweep_rows):
    fig = fg.scatter_bounds(sweep_rows)
    assert fig.layout.showlegend is False
    labels = {a.text for a in fig.layout.annotations}
    assert set(sweep_rows["label"]) <= labels


def test_the_scatter_axes_are_pinned_to_the_full_percentage_range(sweep_rows):
    fig = fg.scatter_bounds(sweep_rows)
    assert tuple(fig.layout.xaxis.range) == (0, 104)
    assert tuple(fig.layout.yaxis.range) == (0, 104)


def test_a_baseline_is_drawn_as_a_labelled_rule(sweep_rows):
    fig = fg.scatter_bounds(sweep_rows, baseline=18.5, baseline_label="random baseline")
    assert any(s.y0 == 18.5 for s in fig.layout.shapes)
    assert any("random baseline" in a.text for a in fig.layout.annotations)


# ----------------------------------------------------------------------------- survival


def test_the_survival_curve_is_a_staircase_anchored_at_one():
    curve = pd.DataFrame({"t": [1.0, 5.0, 20.0], "s": [0.9, 0.6, 0.4]})
    fig = fg.survival(curve, [])
    trace = fig.data[0]
    assert trace.line.shape == "hv", "survival is constant between events"
    assert trace.x[0] == 0 and trace.y[0] == 100
    assert tuple(fig.layout.yaxis.range) == (0, 100)
    assert fig.layout.yaxis.ticksuffix == "%"


# ---------------------------------------------------------------------------------- pie


def test_the_pie_is_a_pie():
    """GAS's note, and it holds here: the total already lives in the KPI band above."""
    slices = pd.DataFrame({"label": ["a", "b", "c"], "value": [50, 45, 5]})
    fig = fg.pie(slices)
    assert fig.data[0].hole == 0
    assert fig.data[0].marker.line.color == "#ffffff"
    assert fig.data[0].marker.line.width == 1.5


def test_only_wide_enough_slices_carry_an_on_arc_label():
    slices = pd.DataFrame({"label": ["a", "b", "c"], "value": [50, 45, 5]})
    text = list(fg.pie(slices).data[0].text)
    assert text[:2] == ["50%", "45%"]
    assert text[2] == "", "a 5% slice is narrower than its own label"


def test_ink_on_a_fill_is_chosen_by_contrast_not_by_habit():
    """Two of the five categorical hues are light enough that white text fails on them."""
    assert fg.on_fill_ink("#2563eb") == "#ffffff"
    assert fg.on_fill_ink("#90396a") == "#ffffff"
    assert fg.on_fill_ink("#7fba04") == "#0a0a0a"
    assert fg.on_fill_ink("#f66bb9") == "#0a0a0a"


# --------------------------------------------------------------------------------- chrome


ALL_FIGURES = "trend bars diverging survival scatter pie".split()


@pytest.fixture
def one_of_each(mttr_rows, trend_rows, sweep_rows):
    curve = pd.DataFrame({"t": [1.0, 5.0], "s": [0.9, 0.4]})
    groups = pd.DataFrame({"g": ["x", "y"], "excess": [120.0, -40.0]})
    slices = pd.DataFrame({"label": ["a", "b"], "value": [7, 3]})
    return {
        "trend": fg.trend(trend_rows, "scan_ts", [fg.Series("mttr_median", "Naive")]),
        "bars": fg.bars_with_reference(mttr_rows, value="km_median", label="severity"),
        "diverging": fg.diverging_bars(groups, value="excess", label="g"),
        "survival": fg.survival(curve, []),
        "scatter": fg.scatter_bounds(sweep_rows),
        "pie": fg.pie(slices),
    }


@pytest.mark.parametrize("name", ALL_FIGURES)
def test_every_figure_wears_the_same_chrome(name, one_of_each):
    fig = one_of_each[name]
    assert fig.layout.font.family == fg.FONT_FAMILY
    assert fig.layout.hoverlabel.bgcolor == "#0a0a0a"
    assert fig.layout.transition.duration == 0, "a notebook output is drawn once"
    if name == "pie":
        return
    assert fig.layout.yaxis.gridcolor == "#e6e6e9"
    assert fig.layout.yaxis.ticks == ""
    assert fig.layout.yaxis.showline is False, "the gridlines already carry the scale"
    assert fig.layout.xaxis.linecolor == "#e6e6e9"


@pytest.mark.parametrize("name", ["bars", "diverging"])
def test_bar_charts_drop_the_category_axis_grid(name, one_of_each):
    """A gridline between two categories separates nothing."""
    assert one_of_each[name].layout.yaxis.showgrid is False


def test_no_figure_animates(one_of_each):
    """There is nothing for a prefers-reduced-motion alternative to undo, and the pinned
    transition is what keeps it that way."""
    for fig in one_of_each.values():
        assert fig.layout.transition.duration == 0


# ------------------------------------------------------------------------------ formatting


@pytest.mark.parametrize(
    "days,expected",
    [
        (0.02, "<1h"),
        (0.4, "10h"),
        (23.7 / 24, "1d"),
        (2.3, "2d 7h"),
        (6.98, "1w"),
        (10.5, "1w 3.5d"),
        (21.0, "3w"),
        (None, "—"),
        (float("nan"), "—"),
    ],
)
def test_durations_read_the_way_people_say_them(days, expected):
    assert fg.fmt_duration(days) == expected


def test_the_day_axis_spells_its_months_out(trend_rows):
    """``strftime("%b")`` is locale-dependent; a cluster in another locale would silently
    relabel every trend axis."""
    fig = fg.trend(trend_rows, "scan_ts", [fg.Series("open", "Open")])
    assert list(fig.layout.xaxis.ticktext) == ["01-jun-2026", "01-jul-2026", "01-aug-2026"]
    assert all(isinstance(v, int) for v in fig.layout.xaxis.tickvals)


def test_the_day_axis_is_linear_in_elapsed_time(trend_rows):
    """A categorical date axis spaces a daily run and a six-month gap identically."""
    fig = fg.trend(trend_rows, "scan_ts", [fg.Series("open", "Open")])
    xs = list(fig.data[0].x)
    assert xs == [fg.epoch_day(v) for v in trend_rows["scan_ts"]]
    assert xs[1] - xs[0] == 30 and xs[2] - xs[1] == 31


def test_a_caption_survives_rendering():
    """A notebook output has no assistive-technology surface, so the text alternative is a
    visible caption. The mechanism is lost; the content is not."""
    fig = fg.pie(pd.DataFrame({"label": ["a"], "value": [1]}))
    fg.describe(fig, "One group, all of it.")
    html = fg.render(fig)  # off Databricks, render returns the HTML instead of displaying
    assert "One group, all of it." in html


def test_every_figure_carries_its_own_copy_of_plotly():
    """Each ``displayHTML`` output is its own sandboxed iframe, with no access to a script some
    other cell loaded.

    The obvious optimisation -- inline plotly.js once, pass ``include_plotlyjs=False``
    afterwards -- makes the second figure and every one after it render as **blank space**, and
    a blank iframe raises nothing, so it fails silently on every page below the first chart.
    It cost about 3 MB a figure to be right, and the wrong version looks identical in review.
    """
    first = fg.render(fg.pie(pd.DataFrame({"label": ["a"], "value": [1]})))
    second = fg.render(fg.pie(pd.DataFrame({"label": ["b"], "value": [2]})))
    for html in (first, second):
        assert "Plotly" in html
        assert len(html) > 500_000, "plotly.js is not inlined in this output"
