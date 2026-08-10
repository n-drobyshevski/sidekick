"""Chart tests.

Structure, not pixels: how many bars, where the target tick sits, what happens to a NULL. A
figure is a data claim, and these assert the claim is the one the numbers support.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

pytest.importorskip(
    "matplotlib", reason="brick chart tests need matplotlib: pip install -r brick/requirements.txt"
)
pytest.importorskip("pandas")

import matplotlib  # noqa: E402

matplotlib.use("Agg")  # no display in CI; must be set before pyplot is touched

import pandas as pd  # noqa: E402

BRICK_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRICK_DIR))

import charts  # noqa: E402
from config import SEVERITY_COLORS, SLA_TARGETS  # noqa: E402


def mttr_frame(**overrides) -> pd.DataFrame:
    """Two severities plus OVERALL. CRITICAL has nothing resolved -- the NULL case."""
    rows = [
        {
            "severity": "CRITICAL", "resolved": 0, "open": 3,
            "mttr_median": None, "mttr_mean": None,
            "km_median": None, "km_median_lower_bound": 90.0, "km_rmst": None, "km_events": 0,
            "open_age_p50": 40.0, "open_age_p90": 90.0,
            "sla_target": 7, "sla_compliant": 0, "sla_pct": None, "oldest_open_days": None,
        },
        {
            "severity": "HIGH", "resolved": 4, "open": 2,
            "mttr_median": 18.0, "mttr_mean": 19.0,
            "km_median": 21.0, "km_median_lower_bound": None, "km_rmst": 20.0, "km_events": 4,
            "open_age_p50": 10.0, "open_age_p90": 30.0,
            "sla_target": 14, "sla_compliant": 1, "sla_pct": 25.0, "oldest_open_days": None,
        },
        {
            "severity": "OVERALL", "resolved": 4, "open": 5,
            "mttr_median": 18.0, "mttr_mean": 19.0,
            "km_median": 21.0, "km_median_lower_bound": None, "km_rmst": 20.0, "km_events": 4,
            "open_age_p50": 20.0, "open_age_p90": 60.0,
            "sla_target": None, "sla_compliant": 1, "sla_pct": 25.0, "oldest_open_days": 90.0,
        },
    ]
    frame = pd.DataFrame(rows)
    for key, value in overrides.items():
        frame[key] = value
    return frame


def program_frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "severity": "HIGH", "coverage_pct": 60.0, "efficiency_pct": 50.0,
                "coverage_lo": 50.0, "coverage_hi": 66.7,
                "efficiency_lo": 42.9, "efficiency_hi": 57.1,
                "prevalence_pct": 50.0, "signal_coverage_pct": 83.3,
            },
            {
                "severity": "OVERALL", "coverage_pct": 60.0, "efficiency_pct": 50.0,
                "coverage_lo": 50.0, "coverage_hi": 66.7,
                "efficiency_lo": 42.9, "efficiency_hi": 57.1,
                "prevalence_pct": 50.0, "signal_coverage_pct": 83.3,
            },
        ]
    )


def bars(ax):
    from matplotlib.patches import Rectangle

    return [p for p in ax.patches if isinstance(p, Rectangle) and p.get_width() > 0]


# ------------------------------------------------------------------- the NULL rule


def test_null_median_draws_no_bar_and_says_why():
    """The one that matters. A zero-length bar for 'nothing resolved yet' reads as 'closed
    instantly' -- the exact opposite of the truth."""
    fig = charts.mttr_sla_chart(mttr_frame())
    ax = fig.axes[0]

    assert len(bars(ax)) == 1, "only HIGH has a median; CRITICAL must not get a bar"
    assert bars(ax)[0].get_width() == pytest.approx(21.0)

    texts = " ".join(t.get_text() for t in ax.texts)
    assert "no resolved findings" in texts
    assert "3 open" in texts, "the gap should still say how much is sitting there"


def test_null_open_age_is_annotated_not_plotted():
    frame = mttr_frame()
    frame.loc[frame["severity"] == "HIGH", ["open_age_p50", "open_age_p90"]] = None
    ax = charts.open_age_chart(frame).axes[0]
    assert "nothing open" in " ".join(t.get_text() for t in ax.texts)


def test_empty_rows_stay_on_the_chart():
    """Regression, caught only by looking at a rendered PNG. A row whose sole mark is a 'no
    data' annotation contributes no artist to autoscale, so the row was being cropped out of
    the figure entirely -- reading as an oversight rather than as empty. And the annotation was
    anchored to data x=0, which is off-screen whenever the axis does not start at zero."""
    frame = mttr_frame()
    frame.loc[frame["severity"] == "HIGH", ["open_age_p50", "open_age_p90"]] = None
    # An axis that starts far from zero -- the case that hid the annotation.
    frame.loc[frame["severity"] == "CRITICAL", ["open_age_p50", "open_age_p90"]] = [80.0, 95.0]

    ax = charts.open_age_chart(frame).axes[0]
    bottom, top = ax.get_ylim()
    ticks = ax.get_yticks()
    assert min(ticks) >= bottom and max(ticks) <= top, "a severity row was cropped out"

    empty = [t for t in ax.texts if "nothing open" in t.get_text()]
    assert empty, "the empty row must say so"

    # The property that matters is visibility, so check the rendered box, not the anchor.
    fig = ax.get_figure()
    fig.canvas.draw()
    text_box = empty[0].get_window_extent(fig.canvas.get_renderer())
    axes_box = ax.get_window_extent()
    assert text_box.x0 >= axes_box.x0 - 1, "annotation rendered off the left of the plot"
    assert text_box.x1 <= axes_box.x1 + 1, "annotation rendered off the right of the plot"


# ------------------------------------------------------------------------- MTTR chart


def test_sla_target_tick_sits_at_the_configured_target():
    ax = charts.mttr_sla_chart(mttr_frame()).axes[0]
    xs = {round(line.get_xdata()[0], 3) for line in ax.lines if len(set(line.get_xdata())) == 1}
    assert SLA_TARGETS["HIGH"] in xs
    assert SLA_TARGETS["CRITICAL"] in xs


def test_breach_is_labelled_in_words_not_only_colour():
    """HIGH's median is 21d against a 14d target. Severity and status never carry meaning by
    colour alone -- especially here, where the palette fails a categorical CVD check."""
    ax = charts.mttr_sla_chart(mttr_frame()).axes[0]
    assert "over 14d SLA" in " ".join(t.get_text() for t in ax.texts)


def test_within_sla_is_not_flagged():
    frame = mttr_frame()
    frame.loc[frame["severity"] == "HIGH", "km_median"] = 9.0
    ax = charts.mttr_sla_chart(frame).axes[0]
    assert "▲" not in " ".join(t.get_text() for t in ax.texts)


def test_bars_plot_the_km_median_not_the_naive_one():
    """The naive median is closed-only and biased low; the bar must be the censoring-aware
    figure or the chart quietly argues the opposite of what KM is for."""
    ax = charts.mttr_sla_chart(mttr_frame()).axes[0]
    assert bars(ax)[0].get_width() == pytest.approx(21.0)  # km_median, not mttr_median 18.0


def test_unreached_median_is_stated_as_a_bound_not_drawn_as_a_bar():
    """More than half still open means the median does not exist yet. Falling back to the
    closed-only rows here would reintroduce exactly the bias KM removes."""
    frame = mttr_frame()
    frame.loc[frame["severity"] == "HIGH", "km_median"] = None
    frame.loc[frame["severity"] == "HIGH", "km_median_lower_bound"] = 45.0
    ax = charts.mttr_sla_chart(frame).axes[0]

    assert not bars(ax), "no bar when the median was never reached"
    texts = " ".join(t.get_text() for t in ax.texts)
    assert "over half still open" in texts
    assert "> 45d" in texts


def test_subtitle_shows_km_beside_naive():
    """The gap between them is the survivorship bias, and it is the argument for KM."""
    subtitle = " ".join(t.get_text() for t in charts.mttr_sla_chart(mttr_frame()).texts)
    assert "KM median 21.0d" in subtitle
    assert "naive (closed-only) 18.0d" in subtitle


def test_overall_is_a_subtitle_not_a_bar():
    """An aggregate bar beside the bars it aggregates reads as one more component."""
    fig = charts.mttr_sla_chart(mttr_frame())
    ax = fig.axes[0]
    assert [t.get_text() for t in ax.get_yticklabels()] == ["CRITICAL", "HIGH"]
    assert "overall KM median 21.0d" in " ".join(t.get_text() for t in fig.texts)


def test_the_encoding_key_survives_the_headline():
    """The subtitle carries both. A reader who cannot tell what the vertical tick means cannot
    read the chart, however good the overall number is."""
    fig = charts.mttr_sla_chart(mttr_frame())
    subtitle = " ".join(t.get_text() for t in fig.texts)
    assert "SLA target" in subtitle
    assert "overall KM median" in subtitle


def test_severities_are_named_on_the_axis():
    """Identity must not depend on hue: config.SEVERITY_COLORS is a heat ramp that fails a
    categorical colourblind check, so the tick labels are load-bearing."""
    ax = charts.mttr_sla_chart(mttr_frame()).axes[0]
    assert set(t.get_text() for t in ax.get_yticklabels()) == {"CRITICAL", "HIGH"}


def test_bars_use_the_shared_severity_palette():
    ax = charts.mttr_sla_chart(mttr_frame()).axes[0]
    from matplotlib.colors import to_hex

    assert to_hex(bars(ax)[0].get_facecolor()) == SEVERITY_COLORS["HIGH"]


# ------------------------------------------------------- coverage / efficiency chart


def test_bounds_are_drawn_as_error_bars():
    """The width of the bracket IS the size of the doubt. A bare point hides it."""
    ax = charts.coverage_efficiency_chart(program_frame()).axes[0]
    containers = [c for c in ax.containers if hasattr(c, "has_xerr")]
    assert containers, "expected an errorbar container for OVERALL"
    assert containers[0].has_xerr and containers[0].has_yerr


def test_prevalence_baseline_is_drawn_and_labelled():
    ax = charts.coverage_efficiency_chart(program_frame()).axes[0]
    horizontals = [
        line.get_ydata()[0]
        for line in ax.lines
        if len(set(line.get_ydata())) == 1 and len(line.get_xdata()) == 2
    ]
    assert 50.0 in [round(y, 3) for y in horizontals]
    labels = " ".join(t.get_text() for t in ax.get_legend().get_texts())
    assert "random-selection baseline" in labels


def test_points_are_labelled_with_their_severity():
    ax = charts.coverage_efficiency_chart(program_frame()).axes[0]
    texts = {t.get_text() for t in ax.texts}
    assert "HIGH" in texts and "OVERALL" in texts


def test_axes_are_percentages_not_autoscaled():
    """A rate axis that autoscales to 48-52% turns noise into a mountain."""
    ax = charts.coverage_efficiency_chart(program_frame()).axes[0]
    assert ax.get_xlim() == (-4, 104)
    assert ax.get_ylim() == (-4, 104)


# --------------------------------------------------------------------- no dual axis


@pytest.mark.parametrize(
    "chart",
    ["mttr_sla_chart", "open_age_chart", "coverage_efficiency_chart"],
)
def test_no_chart_has_a_second_y_scale(chart):
    """Two y-scales on one plot invent a relationship that is not in the data. The in-SLA
    percentage is annotated as text for exactly this reason."""
    frame = program_frame() if chart == "coverage_efficiency_chart" else mttr_frame()
    fig = getattr(charts, chart)(frame)
    assert len(fig.axes) == 1
