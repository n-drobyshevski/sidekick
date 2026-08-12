"""Plotly figures for a Databricks notebook, drawn the way the GAS app draws them.

Pure rendering: every function takes a **pandas** frame (or a plain list of rows) and returns a
``plotly.graph_objects.Figure``. No Spark, no I/O, no ``fig.show()`` -- ``render()`` is the only
thing that puts a figure on screen, and it is one function so the whole notebook set changes its
rendering strategy in one place.

Plotly rather than matplotlib because Databricks renders it live in the cell: pan, hover, legend
toggling. Plotly rather than the native chart editor for *these* shapes because each of them
carries its argument in how the mark is drawn -- a NULL that must be a gap, a reference rule with
a label, a staircase, direct labels, uncertainty bounds -- and none of that survives a chart
picker. It is also the only layer where the two rules below can be *tested*: they are properties
of a ``Figure``, not of undocumented notebook cell metadata.

The two rules, restated because they shape everything here:

* **NULL is not zero.** ``metrics.safe_pct`` returns NULL for an empty denominator on purpose. A
  severity with nothing resolved gets an annotated gap, never a zero-height bar -- a zero bar
  reads as "closed instantly", the opposite of "we have never closed one". A *filled* line has
  the same problem in slower motion: Plotly closes the fill polygon down to y=0 at either side of
  a gap, so a NULL region reads as a value collapsing. A series that contains a NULL therefore
  loses its fill (see ``Series.resolved_fill``).
* **Severity is never carried by colour alone.** ``config.SEVERITY_COLORS`` is a heat ramp that
  fails a categorical colourblind check -- HIGH ``#ea580c`` and MEDIUM ``#d97706`` sit ΔE 1.6
  apart under deuteranopia. Every severity series also gets its own marker symbol
  (``SEV_SYMBOL``), and every mark is named by a tick, a trace name or a text label.

Chrome is ported from ``gas/src/client/js/charts.js`` so the two surfaces look like one product:
system sans at 12px, hairline gridlines with no tick marks, no y-axis line, legend off unless it
differentiates by *shape*, ink-black hover, durations through ``fmt_duration`` ("2d 7h", never
"2.3 days"), and a linear whole-epoch-day x-axis so horizontal distance is proportional to
elapsed time.

On motion: a Plotly figure in a notebook output is drawn once, statically. There is no entry
animation to offer a ``prefers-reduced-motion`` alternative to, and ``transition`` is pinned to
zero so none can be introduced by accident.
"""

from __future__ import annotations

import datetime as _dt
import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

import plotly.graph_objects as go

from config import SEVERITY_ORDER

# See config.PIPELINE_VERSION: every module in a deployment must come from the same upload.
MODULE_VERSION = "1.0-devsecops"

# ------------------------------------------------------------------------------- tokens
#
# Chrome only. The severity *fills* deliberately are not here -- they live in
# config.SEVERITY_COLORS with the measured colourblind note attached, and are imported by the
# callers that need them. What is new here is presentation that has no business bumping
# PIPELINE_VERSION: the darkened severity text ramp, the status trio, and the group palette.

FONT_FAMILY = (
    '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, '
    '"Helvetica Neue", sans-serif'
)
FONT_SIZE = 12
INK = "#0a0a0a"
INK2 = "rgba(0,0,0,0.65)"
HAIRLINE = "#e6e6e9"
ACCENT = "#2563eb"
SURFACE = "#ffffff"

#: Severity text tokens -- for a *label*, never for a mark. DESIGN.md's Two-Token Severity Rule:
#: the fill ramp fails 4.5:1 as text on its own pale tint, so text is a darkened sibling.
SEVERITY_TEXT = {
    "CRITICAL": "#b91c1c",
    "HIGH": "#c2410c",
    "MEDIUM": "#b45309",
    "LOW": "#1d4ed8",
    "INFO": "#475569",
    "UNKNOWN": "#334155",
}

#: OK / warn / bad, always on a low-alpha tint of the same hue.
STATUS = {"ok": "#15803d", "warn": "#a16207", "bad": "#b91c1c"}

#: The group palette, mirrored from ``gas/src/client/styles.css`` ``--cat-*``. Five, not more,
#: on purpose: eight failed the colourblind check hard (violet ≈ blue under deuteranopia).
#: Callers cap at five and fold the tail into a neutral Other.
CATEGORICAL = ["#2563eb", "#0d9488", "#90396a", "#7fba04", "#f66bb9"]
OTHER_COLOR = "#94a3b8"

#: Redundant coding for severity, so identity never rests on the heat ramp.
#: Same shapes as charts.js SEV_POINT_STYLE, translated to Plotly's symbol names.
SEV_SYMBOL = {
    "CRITICAL": "circle",
    "HIGH": "triangle-up",
    "MEDIUM": "square",
    "LOW": "diamond",
    "INFO": "star",
    "UNKNOWN": "x",
    "OVERALL": "circle-open",
}

#: Eight point styles for five hues, so a pooled "Other" still gets its own.
GROUP_SYMBOLS = [
    "circle",
    "triangle-up",
    "square",
    "diamond",
    "star",
    "x",
    "triangle-down",
    "cross",
]

#: The four survival markers, in the order GAS lists them.
KM_MARKERS = [
    {"key": "naive_median", "label": "Median (closed)", "color": INK, "symbol": "circle"},
    {"key": "median", "label": "Median (KM, all)", "color": ACCENT, "symbol": "triangle-up"},
    {"key": "naive_mean", "label": "Mean (closed)", "color": INK, "symbol": "square"},
    {"key": "mean", "label": "Mean (KM · RMST, all)", "color": ACCENT, "symbol": "diamond"},
]

_NULL_NOTE = "no resolved findings yet"


# ---------------------------------------------------------------------------- formatting


def fmt_duration(days: Optional[float]) -> str:
    """A duration as GAS writes it: ``"1w 3.5d"`` / ``"2d 7h"`` / ``"10h"`` / ``"<1h"``.

    Never ``"2.3 days"``. A decimal day is a unit nobody carries around in their head, and the
    figure is read aloud in stand-ups.
    """
    if days is None or (isinstance(days, float) and math.isnan(days)):
        return "—"
    days = float(days)
    if days < 0:
        return "—"

    if days < 1:
        hours = round(days * 24)
        if hours >= 24:  # rounded all the way up
            return "1d"
        return f"{hours}h" if hours >= 1 else "<1h"

    if days < 7:
        whole = int(days)
        hours = round((days - whole) * 24)
        if hours >= 24:  # e.g. 6.98d rounds to 7d, which is a week
            whole, hours = whole + 1, 0
        if whole >= 7:
            return fmt_duration(float(whole))
        return f"{whole}d" if hours == 0 else f"{whole}d {hours}h"

    weeks = int(days // 7)
    rest = days - weeks * 7
    return f"{weeks}w" if round(rest, 1) == 0 else f"{weeks}w {rest:.1f}d"


_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")


def fmt_day(epoch_day: float) -> str:
    """``19_539 -> "01-jul-2023"``. Lowercase three-letter month, locale-independent.

    ``strftime("%b")`` is locale-dependent and title-cased; a cluster in another locale would
    silently change every axis. Spelling the months out is the whole fix.
    """
    date = _dt.date(1970, 1, 1) + _dt.timedelta(days=int(round(epoch_day)))
    return f"{date.day:02d}-{_MONTHS[date.month - 1]}-{date.year}"


def epoch_day(value) -> float:
    """A timestamp -- ``datetime``, ``date``, pandas ``Timestamp`` or ISO string -- as a whole
    UTC epoch day. Trend x-axes are linear in this unit so horizontal distance is proportional
    to elapsed time; a categorical date axis would space a daily run and a monthly gap equally.
    """
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, str):
        value = _dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if isinstance(value, _dt.datetime):
        value = value.date()
    if isinstance(value, _dt.date):
        return (value - _dt.date(1970, 1, 1)).days
    raise TypeError(f"cannot read {value!r} as a date")


def on_fill_ink(fill: str) -> str:
    """Ink for a label sitting *on* a coloured fill: near-black or white, whichever reads.

    WCAG relative luminance, same test GAS's ``onFillText`` makes: use white unless white would
    drop below 3:1 against the fill, in which case use ink. The two lightest categorical hues
    (the green and the pink) are exactly why this is not a constant.
    """
    fill = fill.lstrip("#")
    channels = [int(fill[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    white_ratio = 1.05 / (luminance + 0.05)
    return "#ffffff" if white_ratio >= 3 else INK


# -------------------------------------------------------------------------------- chrome


def base_layout(
    *,
    height: int = 240,
    y_title: str = "",
    x_title: str = "",
    showlegend: bool = False,
    bar_axis: Optional[str] = None,
) -> Dict[str, Any]:
    """The chrome every figure wears, ported from ``charts.js::baseOptions``.

    ``bar_axis`` names the *category* axis of a bar chart, whose gridlines come off: a gridline
    between two categories separates nothing.
    """
    font = {"family": FONT_FAMILY, "size": FONT_SIZE, "color": INK2}
    axis = {
        "tickfont": font,
        "gridcolor": HAIRLINE,
        "ticks": "",
        "zeroline": False,
        "automargin": True,
    }
    layout: Dict[str, Any] = {
        "font": font,
        "height": height,
        "margin": {"l": 8, "r": 8, "t": 8, "b": 8},
        "paper_bgcolor": SURFACE,
        "plot_bgcolor": SURFACE,
        "showlegend": showlegend,
        # Legends differentiate by shape, not only by colour -- so the swatch has to be the
        # marker itself rather than a colour chip.
        "legend": {
            "font": font,
            "orientation": "h",
            "yanchor": "top",
            "y": -0.18,
            "x": 0,
            "itemsizing": "constant",
            "bgcolor": "rgba(0,0,0,0)",
        },
        "hoverlabel": {
            "bgcolor": INK,
            "bordercolor": INK,
            "font": {"family": FONT_FAMILY, "size": FONT_SIZE, "color": "#ffffff"},
        },
        # A notebook output is drawn once. Pinning this to zero keeps it that way, so there is
        # never an animation for prefers-reduced-motion to have to undo.
        "transition": {"duration": 0},
        "xaxis": dict(axis, title={"text": x_title, "font": font}, linecolor=HAIRLINE),
        # The y-axis line comes off entirely; the gridlines already carry the scale.
        "yaxis": dict(axis, title={"text": y_title, "font": font}, showline=False),
    }
    if bar_axis == "x":
        layout["xaxis"]["showgrid"] = False
    elif bar_axis == "y":
        layout["yaxis"]["showgrid"] = False
    return layout


def day_axis(days: Sequence[float], *, max_ticks: int = 8) -> Dict[str, Any]:
    """Tick values and labels for a linear epoch-day x-axis.

    Explicit ticks rather than a ``tickformat``: the axis is numeric (see ``epoch_day``) and the
    label spelling is locale-independent by construction (see ``fmt_day``).
    """
    ordered = sorted({int(round(d)) for d in days})
    if not ordered:
        return {}
    stride = max(1, math.ceil(len(ordered) / max_ticks))
    picked = ordered[::stride]
    if ordered[-1] not in picked:
        picked.append(ordered[-1])
    return {"tickmode": "array", "tickvals": picked, "ticktext": [fmt_day(d) for d in picked]}


def reference_rule(
    fig: go.Figure,
    value: float,
    label: str,
    *,
    axis: str = "x",
    dashed: bool = True,
) -> go.Figure:
    """A reference line with an inked chip, the way ``charts.js`` draws both of its rules.

    Dashed means *a threshold you are being measured against* (an SLA target, the overall
    median). Solid means *an origin* -- the zero of a diverging scale, which is not a threshold
    and must not look like one.
    """
    line = {"color": INK, "width": 1.5, "dash": "4,3" if dashed else "solid"}
    if axis == "x":
        fig.add_vline(x=value, line=line)
        fig.add_annotation(
            x=value, y=1, yref="paper", text=label, showarrow=False,
            xanchor="left", yanchor="top", xshift=6,
            font={"family": FONT_FAMILY, "size": 11, "color": "#ffffff"},
            bgcolor=INK, borderpad=3,
        )
    else:
        fig.add_hline(y=value, line=line)
        fig.add_annotation(
            x=0, y=value, xref="paper", text=label, showarrow=False,
            xanchor="left", yanchor="bottom", yshift=4,
            font={"family": FONT_FAMILY, "size": 11, "color": "#ffffff"},
            bgcolor=INK, borderpad=3,
        )
    return fig


def annotate_null(fig: go.Figure, x, y, text: str = _NULL_NOTE, **kwargs) -> go.Figure:
    """Draw the *absence* of a value as words, at the position the value would have had.

    The one thing that must never happen here is a zero. "Nothing has been resolved yet" and
    "everything was resolved instantly" are opposite facts and would draw the same bar.
    """
    fig.add_annotation(
        x=x, y=y, text=text, showarrow=False,
        font={"family": FONT_FAMILY, "size": 11, "color": INK2},
        **kwargs,
    )
    return fig


def describe(fig: go.Figure, text: str) -> go.Figure:
    """Attach the prose alternative that ``render()`` prints under the chart.

    ``charts.js`` puts this in an ``aria-label`` on the canvas. A notebook output is an iframe
    with no assistive-technology surface to hang one on, so the content survives as a **visible
    caption** even though the mechanism cannot. It is the more useful half anyway: it names
    every series and its value, which is exactly what someone reads out of a chart.
    """
    meta = dict(fig.layout.meta or {})
    meta["description"] = text
    fig.update_layout(meta=meta)
    return fig


def render(fig: go.Figure) -> Optional[str]:
    """Put a figure on the notebook screen, and its caption under it.

    **The only place the Databricks rendering strategy lives.** Three routes exist and only one
    is safe by construction:

    * ``fig.show()`` relies on Plotly auto-detecting a Databricks renderer. It usually works and
      is not guaranteed to.
    * ``include_plotlyjs="cdn"`` needs the browser to reach ``cdn.plot.ly``. A workspace behind a
      proxy that blocks CDNs gets a blank output -- the same constraint that made the GAS app
      bundle Chart.js rather than link it. Not viable.
    * inlining ``plotly.js`` always works, and costs about 3 MB **per figure**.

    That last cost is not avoidable by inlining once and passing ``include_plotlyjs=False``
    afterwards, which is the obvious optimisation and is wrong here: **each ``displayHTML``
    output is its own sandboxed iframe**, with no access to a script another cell loaded. The
    second figure and every one after it would render as blank space -- silently, since a blank
    iframe raises nothing. So every figure carries its own copy.

    Off Databricks (pytest, a plain shell) there is no ``displayHTML``, so this returns the HTML
    instead of raising -- the figure functions stay testable without a notebook.
    """
    import plotly.io as pio

    html = pio.to_html(fig, include_plotlyjs=True, full_html=False)
    caption = (fig.layout.meta or {}).get("description")
    if caption:
        html += (
            f'<p style="font:400 12px {FONT_FAMILY};color:{INK2};margin:10px 0 0;'
            f'max-width:70ch">{caption}</p>'
        )
    display_html = _display_html()
    if display_html is None:
        return html
    display_html(html)
    return None


def _display_html():
    """Databricks injects ``displayHTML`` into a *notebook's* globals, never into a module's."""
    try:
        from IPython import get_ipython  # type: ignore[import-not-found]

        return get_ipython().user_ns["displayHTML"]
    except Exception:  # noqa: BLE001 -- not in a Databricks notebook
        return None


# --------------------------------------------------------------------------------- trend


@dataclass(frozen=True)
class Series:
    """One line on a trend chart.

    ``dash`` and ``symbol`` are not decoration: two series that differ only in hue are
    unreadable to a deuteranope and illegible in a printout, so every trend carries both.
    """

    column: str
    label: str
    color: str = ACCENT
    dash: str = "solid"
    symbol: str = "circle"
    fill: bool = False

    def resolved_fill(self, values: Sequence[Optional[float]]) -> Optional[str]:
        """``"tozeroy"`` only when the series has no gap to mis-draw.

        Plotly closes a fill polygon down to y=0 on either side of a gap, so a filled series
        with a NULL in it renders the gap as a collapse to zero -- the exact confusion the NULL
        rule forbids, on the chart that cites it hardest. A series with a gap loses its fill.
        """
        if not self.fill:
            return None
        return None if any(v is None for v in values) else "tozeroy"


def _clean(value) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    return float(value)


def trend(
    frame,
    x: str,
    series: Sequence[Series],
    *,
    y_range: Optional[Sequence[float]] = None,
    y_unit: str = "findings",
    height: int = 240,
) -> go.Figure:
    """Every trend chart in the notebook set: one, two or six lines over a day axis.

    ``frame`` is a pandas frame with a timestamp-ish ``x`` column and one column per series.
    Gaps are gaps: a NULL is ``None`` in the y array with ``connectgaps=False``, never 0.
    """
    days = [epoch_day(v) for v in frame[x]]
    fig = go.Figure()
    for spec in series:
        values = [_clean(v) for v in frame[spec.column]]
        show_points = len(values) <= 40
        fig.add_trace(
            go.Scatter(
                x=days,
                y=values,
                name=spec.label,
                mode="lines+markers" if show_points else "lines",
                connectgaps=False,
                line={"color": spec.color, "width": 2, "dash": spec.dash},
                marker={"color": spec.color, "symbol": spec.symbol, "size": 7},
                fill=spec.resolved_fill(values),
                fillcolor="rgba(37, 99, 235, 0.08)",
                hovertemplate=("%{customdata}<br>" + spec.label + ": %{y}<extra></extra>"),
                customdata=[fmt_day(d) for d in days],
            )
        )
        if any(v is None for v in values):
            annotate_null(
                fig, x=0.5, y=1.02, text="gaps are scans with no value, not zero",
                xref="paper", yref="paper", xanchor="center",
            )

    layout = base_layout(height=height, y_title=y_unit, showlegend=len(series) > 1)
    layout["xaxis"].update(day_axis(days))
    layout["hovermode"] = "x unified"
    if y_range is not None:
        layout["yaxis"]["range"] = list(y_range)
    fig.update_layout(**layout)
    return fig


def severity_series(columns: Dict[str, str], colors: Dict[str, str]) -> List[Series]:
    """Build one ``Series`` per severity, each with its own symbol.

    ``columns`` maps severity -> column name. The symbol is the point of this helper: colour
    alone cannot carry six severities off a heat ramp.
    """
    out = []
    for sev in SEVERITY_ORDER:
        if sev not in columns:
            continue
        out.append(
            Series(
                column=columns[sev],
                label=sev.title(),
                color=colors[sev],
                symbol=SEV_SYMBOL[sev],
            )
        )
    return out


def group_series(order: Sequence[str]) -> List["Series"]:
    """One ``Series`` per group, in the canonical order ``panels.group_palette`` returns.

    Hue *and* symbol come from position in that order, so a group looks the same in the pie and
    in the trend. ``Other`` is always the neutral grey and always last -- it is a pool, not a
    group, and colouring it like one invites reading it as the sixth-biggest.
    """
    out = []
    for i, name in enumerate(order):
        pooled = name == "Other"
        out.append(
            Series(
                column=name,
                label=name,
                color=OTHER_COLOR if pooled else CATEGORICAL[i % len(CATEGORICAL)],
                symbol=GROUP_SYMBOLS[i % len(GROUP_SYMBOLS)],
            )
        )
    return out


# ------------------------------------------------------------------------------ survival


def survival(curve, markers: Sequence[Dict[str, Any]], *, height: int = 300) -> go.Figure:
    """S(t): the share of findings still open, as a staircase.

    ``curve`` is a pandas frame of ``t`` (days) and ``s`` (0..1), one row per event time.
    ``line_shape="hv"`` is the whole point -- survival is constant between events, and a
    straight interpolation would draw findings closing on days nothing happened.

    Each marker is its **own trace** so the legend differentiates by shape. A marker whose value
    is NULL -- a median that was never reached, which is the normal case under heavy censoring --
    contributes no trace at all rather than a point at zero.
    """
    weeks = [t / 7.0 for t in curve["t"]]
    share = [float(s) * 100 for s in curve["s"]]
    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=[0] + weeks,
            y=[100] + share,
            name="S(t)",
            mode="lines",
            line={"color": ACCENT, "width": 2, "shape": "hv"},
            showlegend=False,
            hovertemplate="%{customdata}: %{y:.0f}% still open<extra></extra>",
            customdata=[fmt_duration(0)] + [fmt_duration(t) for t in curve["t"]],
        )
    )
    for marker in markers:
        value = _clean(marker.get("value"))
        if value is None:
            continue
        fig.add_trace(
            go.Scatter(
                x=[value / 7.0],
                y=[float(marker.get("s", 50))],
                name=marker["label"],
                mode="markers",
                marker={"color": marker["color"], "symbol": marker["symbol"], "size": 11},
                hovertemplate=(
                    f"{marker['label']}: {fmt_duration(value)}"
                    " (%{y:.0f}% still open)<extra></extra>"
                ),
            )
        )
    layout = base_layout(height=height, y_title="% still open", x_title="weeks", showlegend=True)
    layout["yaxis"].update({"range": [0, 100], "ticksuffix": "%"})
    layout["xaxis"]["rangemode"] = "tozero"
    fig.update_layout(**layout)
    return fig


# ---------------------------------------------------------------------------------- bars


def _colors(rows, column: str, labels: Sequence[str],
            order: Optional[Sequence[str]] = None) -> List[str]:
    """Per-bar colour: the caller's column if it has one, otherwise the group palette.

    Severity charts pass their own (``config.SEVERITY_COLORS``). A by-group chart does not, and
    the fallback matters twice over. Painting every bar one accent throws away identity a chart
    library gives for free -- but colouring by *position in this chart* is worse, because two
    charts of the same groups sorted differently then disagree about which group is teal.

    So ``order`` is the canonical group order (``panels.group_palette``) and colour comes from a
    group's place in **that**, not in whatever this particular chart is sorted by.
    """
    if column in rows:
        return list(rows[column])
    if order:
        index = {name: i for i, name in enumerate(order)}
        return [
            OTHER_COLOR if name == "Other"
            else CATEGORICAL[index.get(name, len(index)) % len(CATEGORICAL)]
            for name in labels
        ]
    return [CATEGORICAL[i % len(CATEGORICAL)] for i in range(len(labels))]


def bars_with_reference(
    rows,
    *,
    value: str,
    label: str,
    color: str = "color",
    order: Optional[Sequence[str]] = None,
    reference: Optional[str] = None,
    reference_style: str = "tick",
    overall: Optional[float] = None,
    overall_label: str = "",
    x_title: str = "",
    height: int = 240,
) -> go.Figure:
    """Horizontal bars, optionally measured against something.

    Two GAS charts in one, because they are the same chart:

    * ``reference_style="tick"`` puts a per-row tick at each row's own ``reference`` value --
      the SLA bullet, where every severity has a different target.
    * ``reference_style="rule"`` (with ``overall``) draws one dashed rule across all rows -- the
      ranked "Median MTTR by group" chart, measured against the register's own median.

    A NULL value gets an annotated gap where its bar would be, and no bar.
    """
    labels = list(rows[label])
    values = [_clean(v) for v in rows[value]]
    colors = _colors(rows, color, labels, order)

    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            x=[v if v is not None else 0 for v in values],
            y=labels,
            orientation="h",
            marker={"color": colors},
            # The bar is labelled with its own duration, so the value never depends on reading
            # a colour or eyeballing the axis.
            text=[fmt_duration(v) if v is not None else "" for v in values],
            textposition="outside",
            textfont={"family": FONT_FAMILY, "size": 11, "color": INK2},
            showlegend=False,
            hovertemplate="%{y}: %{text}<extra></extra>",
        )
    )
    # Zero-width bars for the NULL rows: the category keeps its slot and its tick label, and the
    # words go where the bar would have been.
    for name, v in zip(labels, values):
        if v is None:
            annotate_null(fig, x=0, y=name, xanchor="left", xshift=6)

    if reference_style == "tick" and reference is not None:
        targets = [_clean(t) for t in rows[reference]]
        fig.add_trace(
            go.Scatter(
                x=[t for t in targets if t is not None],
                y=[n for n, t in zip(labels, targets) if t is not None],
                mode="markers",
                marker={
                    "symbol": "line-ns",
                    "color": INK,
                    "size": 18,
                    "line": {"color": INK, "width": 2},
                },
                name="SLA target",
                showlegend=True,
                hovertemplate="%{y} SLA target: %{customdata}<extra></extra>",
                customdata=[fmt_duration(t) for t in targets if t is not None],
            )
        )

    layout = base_layout(
        height=height, x_title=x_title, showlegend=reference_style == "tick", bar_axis="y"
    )
    layout["yaxis"]["autorange"] = "reversed"
    fig.update_layout(**layout)

    if reference_style == "rule" and overall is not None:
        reference_rule(fig, overall, overall_label or f"overall {fmt_duration(overall)}")
    return fig


def diverging_bars(
    rows,
    *,
    value: str,
    label: str,
    color: str = "color",
    order: Optional[Sequence[str]] = None,
    zero_label: str = "at overall median",
    x_title: str = "excess finding·days vs overall median",
    height: int = 240,
) -> go.Figure:
    """Bars either side of an origin -- how much each group drags the headline.

    The rule at zero is **solid**, not dashed. Dashed reads as a threshold you are being
    measured against; this is an origin, and the difference matters because a group sitting at
    the overall median is not passing or failing anything.

    Signed labels sit on each bar's **outer** end so they never land on the rule.
    """
    labels = list(rows[label])
    values = [_clean(v) or 0.0 for v in rows[value]]
    colors = _colors(rows, color, labels, order)

    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            x=values,
            y=labels,
            orientation="h",
            marker={"color": colors},
            text=[f"{'+' if v > 0 else ''}{v:,.0f}" for v in values],
            textposition="outside",
            textfont={"family": FONT_FAMILY, "size": 11, "color": INK2},
            showlegend=False,
            hovertemplate="%{y}: %{text} finding·days<extra></extra>",
        )
    )
    layout = base_layout(height=height, x_title=x_title, bar_axis="y")
    layout["yaxis"]["autorange"] = "reversed"
    fig.update_layout(**layout)
    reference_rule(fig, 0, zero_label, dashed=False)
    return fig


# ------------------------------------------------------------------------------- scatter


def scatter_bounds(
    points,
    *,
    x: str = "coverage_pct",
    y: str = "efficiency_pct",
    label: str = "label",
    active: str = "active",
    lo_x: Optional[str] = None,
    hi_x: Optional[str] = None,
    lo_y: Optional[str] = None,
    hi_y: Optional[str] = None,
    baseline: Optional[float] = None,
    baseline_label: str = "random baseline",
    height: int = 300,
) -> go.Figure:
    """Coverage against efficiency, with the published uncertainty on the point that counts.

    Every point is a candidate high-risk rule; the active one is a filled diamond carrying the
    ``coverage_lo/hi`` and ``efficiency_lo/hi`` bounds as error bars -- the unclassified
    population's range, which is the honest width of both rates. Alternatives are hollow.

    Direct labels with leader lines, no legend: a legend for a dozen one-point series is a
    lookup table, and the whole question here is *which point is which rule*.
    """
    fig = go.Figure()
    rows = list(zip(points[x], points[y], points[label], points[active]))
    idx_active = [i for i, r in enumerate(rows) if r[3]]

    others = [r for r in rows if not r[3]]
    if others:
        fig.add_trace(
            go.Scatter(
                x=[r[0] for r in others],
                y=[r[1] for r in others],
                mode="markers",
                marker={
                    "symbol": "circle-open",
                    "color": OTHER_COLOR,
                    "size": 10,
                    "line": {"color": OTHER_COLOR, "width": 1.5},
                },
                showlegend=False,
                hovertemplate="%{customdata}<br>coverage %{x:.1f}%"
                " · efficiency %{y:.1f}%<extra></extra>",
                customdata=[r[2] for r in others],
            )
        )
    for i in idx_active:
        row = rows[i]
        error_x = error_y = None
        if lo_x and hi_x:
            error_x = {
                "type": "data",
                "symmetric": False,
                "array": [_clean(points[hi_x][i]) - row[0]],
                "arrayminus": [row[0] - _clean(points[lo_x][i])],
                "color": ACCENT,
                "thickness": 1.5,
            }
        if lo_y and hi_y:
            error_y = {
                "type": "data",
                "symmetric": False,
                "array": [_clean(points[hi_y][i]) - row[1]],
                "arrayminus": [row[1] - _clean(points[lo_y][i])],
                "color": ACCENT,
                "thickness": 1.5,
            }
        fig.add_trace(
            go.Scatter(
                x=[row[0]],
                y=[row[1]],
                mode="markers",
                marker={"symbol": "diamond", "color": ACCENT, "size": 13},
                error_x=error_x,
                error_y=error_y,
                showlegend=False,
                hovertemplate=f"{row[2]} (in force)<br>coverage %{{x:.1f}}%"
                " · efficiency %{y:.1f}%<extra></extra>",
            )
        )

    # Direct labels, decluttered top-down the way charts.js does it: walk the points from the
    # top and push any label that would land within a line-height of the previous one further
    # down, then join it back to its point with a hairline leader. Without this the interesting
    # rules -- which cluster, because they mostly agree -- print on top of each other.
    plot_height = height - 70  # axis titles and tick labels take the rest
    placed: List[float] = []
    for row in sorted(rows, key=lambda r: -r[1]):
        anchor = (1 - row[1] / 104) * plot_height
        target = anchor
        if placed and target < placed[-1] + 13:
            target = placed[-1] + 13
        placed.append(target)
        fig.add_annotation(
            x=row[0], y=row[1], text=row[2], showarrow=True, arrowhead=0,
            arrowcolor=HAIRLINE, arrowwidth=1, ax=22, ay=target - anchor, xanchor="left",
            font={
                "family": FONT_FAMILY,
                "size": 11,
                "color": "#171717" if row[3] else INK2,
            },
        )

    layout = base_layout(
        height=height, x_title="coverage %", y_title="efficiency %", showlegend=False
    )
    layout["xaxis"].update({"range": [0, 104], "ticksuffix": "%"})
    layout["yaxis"].update({"range": [0, 104], "ticksuffix": "%"})
    fig.update_layout(**layout)
    if baseline is not None:
        reference_rule(fig, baseline, baseline_label, axis="y")
    return fig


# ----------------------------------------------------------------------------------- pie


def pie(slices, *, label: str = "label", value: str = "value", height: int = 240) -> go.Figure:
    """Group share as a pie -- deliberately not a doughnut.

    GAS's note, and it holds here: the total already lives in the KPI band above, so a hole
    with nothing in it is a hole. Slice borders are page-white so adjacent hues never blend, and
    the on-arc percentage appears only where a slice is wide enough to hold it -- with its ink
    picked per slice, because two of the five categorical hues are light enough that white
    would fail on them.
    """
    labels = list(slices[label])
    values = [float(v) for v in slices[value]]
    colors = list(slices["color"]) if "color" in slices else (
        CATEGORICAL[: len(labels)] + [OTHER_COLOR] * max(0, len(labels) - len(CATEGORICAL))
    )
    total = sum(values) or 1
    fig = go.Figure(
        go.Pie(
            labels=labels,
            values=values,
            hole=0,
            sort=False,
            direction="clockwise",
            marker={"colors": colors, "line": {"color": "#ffffff", "width": 1.5}},
            # Only slices at or above 8% of the sweep carry a label; below that the text is
            # wider than the arc and lands on its neighbours.
            text=[f"{v / total * 100:.0f}%" if v / total >= 0.08 else "" for v in values],
            textinfo="text",
            textposition="inside",
            insidetextfont={
                "family": FONT_FAMILY,
                "size": 11,
                "color": [on_fill_ink(c) for c in colors],
            },
            hovertemplate="%{label}<br>%{value:,} (%{percent})<extra></extra>",
        )
    )
    layout = base_layout(height=height, showlegend=True)
    layout["legend"].update({"orientation": "v", "x": 1.02, "y": 0.5, "yanchor": "middle"})
    fig.update_layout(**layout)
    return fig


# --------------------------------------------------------- P2P v5: assets at risk


def density_range(rows, *, label: str = "asset_group", height: int = 260) -> go.Figure:
    """v5 Fig. 10: the p25–p75 spread of findings per asset, with the median marked.

    A range and a dot, not a bar. v5's own reason for reporting three percentiles is that the
    distribution is far too skewed for a single number -- its sample runs from under 10 findings
    per asset to over 1,000 -- and a bar chart of medians would hide exactly the spread that
    makes the comparison worth drawing.

    The median dot is labelled with its own value, so nothing here depends on reading a position
    off an axis, and the range line carries a marker at each end rather than relying on the line
    alone.
    """
    labels = list(rows[label])
    lo = [_clean(v) for v in rows["density_p25"]]
    mid = [_clean(v) for v in rows["density_p50"]]
    hi = [_clean(v) for v in rows["density_p75"]]

    fig = go.Figure()
    for name, low, high in zip(labels, lo, hi):
        if low is None or high is None:
            continue
        fig.add_trace(
            go.Scatter(
                x=[low, high],
                y=[name, name],
                mode="lines+markers",
                line={"color": HAIRLINE, "width": 6},
                marker={"symbol": "line-ns", "size": 12, "color": INK2,
                        "line": {"color": INK2, "width": 2}},
                showlegend=False,
                hovertemplate=f"{name} p25–p75: %{{x:,.0f}}<extra></extra>",
            )
        )
    fig.add_trace(
        go.Scatter(
            x=[v for v in mid if v is not None],
            y=[n for n, v in zip(labels, mid) if v is not None],
            mode="markers+text",
            marker={"symbol": "circle", "size": 11, "color": ACCENT},
            text=[f"{v:,.0f}" for v in mid if v is not None],
            textposition="top center",
            textfont={"family": FONT_FAMILY, "size": 11, "color": INK2},
            name="median",
            showlegend=True,
            hovertemplate="%{y} median: %{x:,.0f}<extra></extra>",
        )
    )
    for name, value in zip(labels, mid):
        if value is None:
            annotate_null(fig, x=0, y=name, text="no assets", xanchor="left", xshift=6)

    layout = base_layout(
        height=height, x_title="open findings per asset", showlegend=True, bar_axis="y"
    )
    layout["yaxis"]["autorange"] = "reversed"
    fig.update_layout(**layout)
    return fig


#: Falling behind / keeping up / gaining, in the order a reader scans them and with the
#: severity-free status palette -- this is a verdict, not a severity, and must not borrow the
#: heat ramp. Each carries a hatch as well as a hue, because three adjacent bar segments are
#: exactly where colour-only encoding fails.
_VERDICT_SPLIT = (
    ("falling_behind_pct", "falling behind", STATUS["bad"], "/"),
    ("maintaining_pct", "keeping up", STATUS["warn"], ""),
    ("gaining_pct", "gaining ground", STATUS["ok"], "\\"),
)


def capacity_split(rows, *, label: str = "asset_group", height: int = 240) -> go.Figure:
    """v5 Fig. 21: what share of each category's assets is falling behind, keeping up, gaining.

    A 100% stacked bar, and the one chart here where the three segments have to be told apart
    at a glance -- so each carries a hatch pattern as well as a colour, and each segment is
    labelled with its own percentage where it is wide enough to hold one.

    A category whose assets have no defined net flow -- which is every category when the
    register has no scan log, see ``metrics.asset_profile`` -- gets an annotated gap rather than
    three zero-width segments that would read as a clean three-way split of nothing.
    """
    labels = list(rows[label])
    fig = go.Figure()
    for column, name, color, hatch in _VERDICT_SPLIT:
        values = [_clean(v) for v in rows[column]]
        fig.add_trace(
            go.Bar(
                x=[v if v is not None else 0 for v in values],
                y=labels,
                orientation="h",
                name=name,
                marker={
                    "color": color,
                    "pattern": {"shape": hatch, "fgcolor": "#ffffff", "size": 5},
                    "line": {"color": "#ffffff", "width": 1},
                },
                text=[f"{v:.0f}%" if v is not None and v >= 12 else "" for v in values],
                textposition="inside",
                insidetextfont={"family": FONT_FAMILY, "size": 11,
                                "color": on_fill_ink(color)},
                hovertemplate="%{y} " + name + ": %{x:.1f}%<extra></extra>",
            )
        )

    undefined = [
        name
        for name, value in zip(labels, [_clean(v) for v in rows[_VERDICT_SPLIT[0][0]]])
        if value is None
    ]
    for name in undefined:
        annotate_null(fig, x=0, y=name, text="no observation window", xanchor="left", xshift=6)

    layout = base_layout(height=height, x_title="share of assets", showlegend=True, bar_axis="y")
    layout["yaxis"]["autorange"] = "reversed"
    layout["barmode"] = "stack"
    layout["xaxis"]["range"] = [0, 100]
    fig.update_layout(**layout)
    return fig
