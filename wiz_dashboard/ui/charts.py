"""Altair charts for the dashboard (severity-colored to match the palette)."""

import altair as alt
import pandas as pd
import streamlit as st

from wiz_dashboard.config import SEVERITY_COLORS, SEVERITY_ORDER


def build_severity_chart(counts: dict):
    """Build the severity bar chart, or return None when there is nothing to plot."""
    order = [s for s in SEVERITY_ORDER if counts.get(s, 0)]
    if not order:
        return None

    data = pd.DataFrame(
        {
            "severity": order,
            "label": [s.title() for s in order],
            "count": [int(counts.get(s, 0)) for s in order],
        }
    )
    labels = [s.title() for s in order]
    return (
        alt.Chart(data)
        .mark_bar(cornerRadiusEnd=3, height=18)
        .encode(
            x=alt.X("count:Q", title=None, axis=alt.Axis(tickMinStep=1)),
            y=alt.Y("label:N", sort=labels, title=None),
            color=alt.Color(
                "severity:N",
                scale=alt.Scale(domain=order, range=[SEVERITY_COLORS[s] for s in order]),
                legend=None,
            ),
            tooltip=[
                alt.Tooltip("label:N", title="Severity"),
                alt.Tooltip("count:Q", title="Findings"),
            ],
        )
        .properties(height=max(len(order) * 34, 80))
    )


def severity_bar(counts: dict) -> None:
    """Horizontal bar chart of finding counts by severity, colored per severity."""
    chart = build_severity_chart(counts)
    if chart is None:
        st.caption("No findings to chart.")
        return
    st.altair_chart(chart, use_container_width=True)


def build_mttr_trend(history):
    """Build the median-MTTR-over-time line chart, or None when there's no history."""
    if history is None or getattr(history, "empty", True):
        return None
    return (
        alt.Chart(history)
        .mark_line(color="#2563eb", point=alt.OverlayMarkDef(color="#2563eb", size=45))
        .encode(
            x=alt.X("date:T", title=None),
            y=alt.Y(
                "median_days:Q",
                title="Median days to remediate",
                scale=alt.Scale(zero=True),
            ),
            tooltip=[
                alt.Tooltip("date:T", title="Date"),
                alt.Tooltip("median_days:Q", title="Median days", format=".1f"),
                alt.Tooltip("resolved:Q", title="Resolved"),
                alt.Tooltip("open:Q", title="Open"),
            ],
        )
        .properties(height=220)
    )


def mttr_trend(history) -> None:
    """Line chart of daily median MTTR. Falls back to a caption when empty."""
    chart = build_mttr_trend(history)
    if chart is None:
        st.caption("No MTTR history yet — it builds up as you run scans over time.")
        return
    st.altair_chart(chart, use_container_width=True)
