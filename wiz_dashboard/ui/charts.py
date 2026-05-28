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
