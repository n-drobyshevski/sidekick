"""Altair charts for the dashboard.

Colors come from ``config.SEVERITY_COLORS`` (tuned for a light background). We do NOT
register a global Altair theme: ``st.altair_chart`` applies Streamlit's built-in
(light) chart theme by default, which keeps axes, gridlines and text legible. Mark
colors set explicitly here are preserved on top of it.
"""

import altair as alt
import pandas as pd
import streamlit as st

from wiz_dashboard.config import SEVERITY_COLORS, SEVERITY_ORDER

# Matches .streamlit/config.toml primaryColor and --accent in styles.css.
ACCENT = "#2563eb"


# --------------------------------------------------------------------------- #
#  Severity breakdown — horizontal bar with always-visible value labels
# --------------------------------------------------------------------------- #
def build_severity_chart(counts: dict, *, selectable: bool = False):
    """Build the severity bar chart, or return None when there is nothing to plot.

    When ``selectable`` is True a point-selection parameter is attached to the bars so
    Streamlit's ``on_select`` reports clicks (used by the OS page to cross-filter the
    findings table). The selection keys on the uppercase ``severity`` field."""
    order = [s for s in SEVERITY_ORDER if counts.get(s, 0)]
    if not order:
        return None

    total = sum(int(counts.get(s, 0)) for s in order) or 1
    data = pd.DataFrame(
        {
            "severity": order,
            "label": [s.title() for s in order],
            "count": [int(counts.get(s, 0)) for s in order],
            "pct": [int(counts.get(s, 0)) / total for s in order],
        }
    )
    labels = [s.title() for s in order]
    base = alt.Chart(data).encode(
        x=alt.X("count:Q", title=None, axis=alt.Axis(tickMinStep=1)),
        y=alt.Y("label:N", sort=labels, title=None),
    )
    bars = base.mark_bar(cornerRadiusEnd=3, height=18).encode(
        color=alt.Color(
            "severity:N",
            scale=alt.Scale(domain=order, range=[SEVERITY_COLORS[s] for s in order]),
            legend=None,
        ),
        tooltip=[
            alt.Tooltip("label:N", title="Severity"),
            alt.Tooltip("count:Q", title="Findings"),
            alt.Tooltip("pct:Q", title="Share", format=".0%"),
        ],
    )
    if selectable:
        # Point selection on the severity field so a bar click is captured by
        # st.altair_chart(on_select=...). dblclick clears it.
        bars = bars.add_params(
            alt.selection_point(name="sevsel", fields=["severity"], on="click", clear="dblclick")
        )
    # Value labels at the bar end (color left to Streamlit's light theme so they
    # stay legible). Counts are also in the tooltip.
    text = base.mark_text(align="left", baseline="middle", dx=4, fontSize=11).encode(
        text=alt.Text("count:Q", format=",")
    )
    return (bars + text).properties(height=max(len(order) * 34, 80))


def severity_bar(counts: dict) -> None:
    """Horizontal bar chart of finding counts by severity, colored per severity."""
    chart = build_severity_chart(counts)
    if chart is None:
        st.caption("No findings to chart.")
        return
    st.altair_chart(chart, width="stretch")


def _selected_severities(event) -> list:
    """Pull uppercase severities out of a Streamlit altair selection event.

    The event's ``selection`` is a mapping of param-name -> list of selected point
    dicts; we don't care which param, just collect every point's ``severity``. Defensive
    about dict vs attribute access since the exact shape varies across versions."""
    sel = getattr(event, "selection", None)
    if sel is None and isinstance(event, dict):
        sel = event.get("selection")
    if not sel:
        return []
    groups = sel.values() if isinstance(sel, dict) else []
    out = []
    for points in groups:
        if not isinstance(points, list):
            continue
        for p in points:
            sev = p.get("severity") if isinstance(p, dict) else None
            if sev:
                out.append(str(sev).upper())
    # Preserve first-seen order, de-duplicated.
    seen = set()
    return [s for s in out if not (s in seen or seen.add(s))]


def severity_bar_select(counts: dict, *, key: str):
    """Render the severity bar with click-to-select.

    Returns ``(rendered, chosen)``: ``rendered`` is False when there's nothing to chart;
    ``chosen`` is the uppercase severities the user has clicked (a single click selects
    one bar). The caller drives the findings filter from ``chosen`` — the chart only
    *reports* clicks, it doesn't own the filter state."""
    chart = build_severity_chart(counts, selectable=True)
    if chart is None:
        st.caption("No findings to chart.")
        return False, []
    event = st.altair_chart(chart, width="stretch", on_select="rerun", key=key)
    return True, _selected_severities(event)


# --------------------------------------------------------------------------- #
#  MTTR trend — median days to remediate over time
# --------------------------------------------------------------------------- #
def _daily(history, value_cols):
    """Collapse a timestamped trend to one row per UTC day (latest reading wins).

    The durable-base trend (``ledger.load_trend_df``) stamps ``date`` with the full
    per-scan timestamp, so several scans in a day render as sub-day points — a noisy
    hourly axis — and an all-null value slice reaches Vega as an empty domain (the
    "Infinite extent for field" console warning). Flooring to the UTC day, keeping the
    most recent reading per day (matching ``history``'s latest-wins-per-day contract)
    and dropping rows with no finite value in ``value_cols`` fixes both. Returns a clean,
    day-floored, date-sorted (tz-naive) frame, or an empty frame when nothing finite
    remains so callers fall back to their caption / ``None`` path.
    """
    cols = ["date", *value_cols]
    if history is None or getattr(history, "empty", True) or "date" not in history.columns:
        return pd.DataFrame(columns=cols)
    work = history.copy()
    work["date"] = pd.to_datetime(work["date"], errors="coerce", utc=True)
    present = [c for c in value_cols if c in work.columns]
    for c in present:
        work[c] = pd.to_numeric(work[c], errors="coerce")
    work = work.dropna(subset=["date"])
    if present:  # keep only rows carrying at least one finite plotted value
        work = work[work[present].notna().any(axis=1)]
    if work.empty:
        return pd.DataFrame(columns=cols)
    work = work.sort_values("date")
    work["date"] = work["date"].dt.floor("D")
    # most recent reading per UTC day; sibling columns ride along from that row
    daily = work.groupby("date", as_index=False).last()
    daily["date"] = daily["date"].dt.tz_localize(None)  # naive midnight -> clean temporal axis
    return daily.reset_index(drop=True)


def _distinct_days(history, value_cols) -> int:
    """How many distinct daily points a trend will plot (0 when nothing finite)."""
    return len(_daily(history, value_cols))


_SPARSE_NOTE = "Only one day of scans so far — the trend fills in as you scan across more days."


def build_mttr_trend(history):
    """Build the median-MTTR-over-time line chart, or None when there's no finite history.

    Aggregated to one point per UTC day (see ``_daily``) so frequent same-day scans don't
    crowd the axis into hours, and an empty/all-null domain never reaches Vega."""
    daily = _daily(history, ["median_days"])
    if daily.empty:
        return None
    tooltip = [
        alt.Tooltip("date:T", title="Date", format="%b %d, %Y"),
        alt.Tooltip("median_days:Q", title="Median days", format=".1f"),
    ]
    if "resolved" in daily.columns:
        tooltip.append(alt.Tooltip("resolved:Q", title="Resolved"))
    if "open" in daily.columns:
        tooltip.append(alt.Tooltip("open:Q", title="Open"))
    return (
        alt.Chart(daily)
        .mark_line(
            color=ACCENT,
            strokeWidth=2,
            point=alt.OverlayMarkDef(color=ACCENT, size=55),
        )
        .encode(
            # yearmonthdate binds ticks to day boundaries (data is already one-per-day),
            # so a narrow range can't fall back to a noisy hourly axis and a wide range
            # auto-thins to whole days.
            x=alt.X(
                "yearmonthdate(date):T",
                title="Date",
                axis=alt.Axis(format="%b %d", labelOverlap=True),
            ),
            y=alt.Y(
                "median_days:Q",
                title="Median days to remediate",
                scale=alt.Scale(zero=True),
            ),
            tooltip=tooltip,
        )
        .properties(height=220)
    )


def mttr_trend(history) -> None:
    """Line chart of daily median MTTR. Falls back to a caption when empty, and notes the
    single-day case so a lone point doesn't read as a broken chart."""
    chart = build_mttr_trend(history)
    if chart is None:
        st.caption("No MTTR history yet — it builds up as you run scans over time.")
        return
    st.altair_chart(chart, width="stretch")
    if _distinct_days(history, ["median_days"]) < 2:
        st.caption(_SPARSE_NOTE)


def build_open_resolved_trend(df):
    """Open vs resolved counts over time as two lines, distinguished by BOTH color and dash
    (so the series read without relying on color). Aggregated to one point per UTC day."""
    daily = _daily(df, ["open", "resolved"])
    value_cols = [c for c in ("open", "resolved") if c in daily.columns]
    if daily.empty or not value_cols:
        return None
    long = daily.melt(
        id_vars="date", value_vars=value_cols, var_name="series", value_name="count"
    ).dropna(subset=["count"])
    if long.empty:
        return None
    return (
        alt.Chart(long)
        .mark_line(point=True, strokeWidth=2)
        .encode(
            x=alt.X(
                "yearmonthdate(date):T",
                title="Date",
                axis=alt.Axis(format="%b %d", labelOverlap=True),
            ),
            y=alt.Y("count:Q", title=None, scale=alt.Scale(zero=True)),
            color=alt.Color(
                "series:N",
                title=None,
                scale=alt.Scale(domain=["open", "resolved"], range=["#ea580c", "#16a34a"]),
                legend=alt.Legend(orient="bottom"),
            ),
            # Same field + same legend as color so Vega merges them into ONE legend whose
            # symbols show the dash too (no "Conflicting legend property disable" warning).
            strokeDash=alt.StrokeDash(
                "series:N",
                scale=alt.Scale(domain=["open", "resolved"], range=[[1, 0], [4, 3]]),
                legend=alt.Legend(orient="bottom"),
            ),
            tooltip=[
                alt.Tooltip("date:T", title="Date", format="%b %d, %Y"),
                alt.Tooltip("series:N", title="Series"),
                alt.Tooltip("count:Q", title="Count"),
            ],
        )
        .properties(height=220)
    )


def open_resolved_trend(df, *, empty="No trend data yet.") -> None:
    chart = build_open_resolved_trend(df)
    if chart is None:
        st.caption(empty)
        return
    st.altair_chart(chart, width="stretch")
    if _distinct_days(df, ["open", "resolved"]) < 2:
        st.caption(_SPARSE_NOTE)
