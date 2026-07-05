"""MTTR & SLA page: remediation performance for the loaded OS findings.

A consumer page (like Reports / Exports): it reads the findings a scan stored in session
state on the OS vulnerabilities page — it never fetches on its own. The per-severity widget
and KPI hero need flat per-finding data (timestamps); the trend charts read the persistent
MTTR history file, so they show up even before a scan in the current session.
"""

import pandas as pd
import streamlit as st

from wiz_dashboard.config import SEVERITY_COLORS
from wiz_dashboard.domain import metrics
from wiz_dashboard.domain.formatting import format_duration
from wiz_dashboard.ui import charts
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui import scan
from wiz_dashboard.ui.pages import _derived


def page():
    ui.render_page_header("MTTR & SLA", "Remediation performance for OS findings")

    df, sig = _derived.display_view()
    nodes = st.session_state.get("os_nodes")
    scope = _derived.display_scope()
    if scope:
        st.caption(
            f"Showing {' + '.join(s.title() for s in scope)} — the display filter "
            "(Settings) applies to every metric and trend on this page."
        )

    # Prefer the durable ledger: MTTR computed from lifecycles observed across ALL saved
    # scans (so vulns that disappeared between scans count as resolved). Fall back to the
    # current scan's snapshot when the base is still empty.
    ledger_mttr = _derived.ledger_mttr_cached(scope)
    ledger_has = bool(ledger_mttr and ledger_mttr[0])

    # Trend: ledger-reconstructed open/resolved/median over time, with the legacy daily
    # MTTR history as a fallback before the base has data. (The legacy history file is
    # whole-scan medians and can't be severity-filtered; the ledger trend above is the
    # scoped source and wins whenever the base has data.)
    trend_df = _derived.ledger_trend_cached(scope)
    history_df = _derived.history_cached()
    trend = trend_df if (trend_df is not None and not trend_df.empty) else history_df
    no_trend = trend is None or getattr(trend, "empty", True)
    prev_kpis = _prev_from_trend(trend)  # previous-scan baseline for the KPI change badges

    if not ledger_has and df.empty and no_trend:
        ui.empty_state(
            "No remediation data yet",
            "Run a scan on the **OS vulnerabilities** page first. Every scan is saved to "
            "the durable base, and MTTR is computed from the resulting lifecycles.",
        )
        return

    if ledger_has:
        per_sev, overall = ledger_mttr
        _kpi_and_posture(
            per_sev,
            overall,
            "MTTR source: **durable base**. Lifecycles observed across all saved scans "
            "(a vuln that disappears between scans counts as resolved).",
            prev_kpis,
        )
        # Per-severity detail is demoted to an expander: the SLA-posture bullets above are
        # the hero. show_overall=False keeps the widget to just the table (the Key metrics
        # card already carries median / resolved / open).
        with st.expander("Per-severity breakdown", expanded=False):
            ui.render_mttr_widget(df, mttr=(per_sev, overall), show_overall=False)
    elif not df.empty and scan.loaded_shape(nodes) != "grouped":
        per_sev, overall = _derived.mttr_cached(sig, df)
        _kpi_and_posture(
            per_sev,
            overall,
            "MTTR source: **current scan only**. Run scans over time to build the "
            "durable base and get lifecycle-accurate MTTR.",
            prev_kpis,
        )
        with st.expander("Per-severity breakdown", expanded=False):
            ui.render_mttr_widget(df, mttr=(per_sev, overall), show_overall=False)
    elif not df.empty:  # grouped-by-asset shape — no per-finding timestamps
        st.info(
            "The loaded response is **grouped-by-asset**, which omits the per-finding "
            "first-detected / resolved timestamps MTTR and SLA need. Showing the trend "
            "history below; re-run with a flat (per-finding) response for the breakdown."
        )

    ui.section_label("MTTR trend (median over time)")
    charts.mttr_trend(trend)

    ui.section_label("Open vs resolved (over time)")
    charts.open_resolved_trend(trend)


def _prev_from_trend(trend):
    """Previous-scan baseline (``median_days``/``sla_pct``/``oldest_open_days`` floats,
    ``resolved``/``open`` ints) from the second-to-last trend row, or ``{}`` when there's
    no prior snapshot. Missing columns (older history files) simply yield no badge."""
    if trend is None or getattr(trend, "empty", True) or len(trend) < 2:
        return {}
    row = trend.iloc[-2]
    out = {}
    for k in ("median_days", "sla_pct", "oldest_open_days"):
        if k in trend.columns and pd.notna(row.get(k)):
            out[k] = float(row[k])
    for k in ("resolved", "open"):
        if k in trend.columns and pd.notna(row.get(k)):
            out[k] = int(row[k])
    return out


def _hero(per_sev, overall, prev=None) -> None:
    """Headline remediation KPIs as a stat-list card. Each metric carries an absolute + %
    change vs the previous scan (``prev`` from ``_prev_from_trend``), shown only where a
    historical baseline exists."""
    prev = prev or {}
    sla, oldest = metrics.overall_sla_oldest(per_sev)
    med = overall.get("mttr_median")
    resolved_cur = int(overall.get("resolved", 0))
    open_cur = int(overall.get("open", 0))

    med_item = {"label": "Median MTTR", "value": format_duration(med),
                "accent": "var(--accent)",
                "help": "Median days from first detection to remediation."}
    pm = prev.get("median_days")
    if med is not None and not pd.isna(med) and pm:  # truthy base avoids /0
        dd = float(med) - float(pm)
        med_item.update(delta=dd, abs_text=format_duration(abs(dd)), pct=dd / pm * 100)

    sla_item = {"label": "In SLA", "value": (f"{sla:.0f}%" if sla is not None else "—"),
                "accent": "#16a34a", "inverse": False,
                "help": "Share of resolved findings remediated within their SLA target."}
    ps = prev.get("sla_pct")
    if sla is not None and ps:
        # In SLA is itself a %, so its change reads in whole percentage points — matching the
        # whole-% value, so a sub-point move shows a neutral ±0 instead of a misleading
        # "−0pp", and there's no confusing relative "% of a %".
        sla_item.update(delta=round(float(sla) - float(ps)), delta_suffix="pp")

    oldest_item = {"label": "Oldest open", "value": format_duration(oldest),
                   "accent": SEVERITY_COLORS["HIGH"],
                   "help": "90th-percentile age of currently-open findings."}
    po_age = prev.get("oldest_open_days")
    if oldest is not None and po_age:
        dd = float(oldest) - float(po_age)
        oldest_item.update(delta=dd, abs_text=format_duration(abs(dd)), pct=dd / po_age * 100)

    res_item = {"label": "Resolved", "value": f"{resolved_cur:,}",
                "accent": "#16a34a", "inverse": False,
                "help": "Findings with a recorded remediation."}
    pr = prev.get("resolved")
    if pr is not None:
        res_item.update(delta=resolved_cur - pr,
                        pct=((resolved_cur - pr) / pr * 100) if pr else None)

    open_item = {"label": "Open", "value": f"{open_cur:,}",
                 "accent": SEVERITY_COLORS["HIGH"],
                 "help": "Findings still awaiting remediation."}
    po = prev.get("open")
    if po is not None:
        open_item.update(delta=open_cur - po,
                         pct=((open_cur - po) / po * 100) if po else None)

    ui.stat_list_card([med_item, sla_item, oldest_item, res_item, open_item])


def _kpi_and_posture(per_sev, overall, source_caption, prev=None) -> None:
    """Headline KPI stat-list card + the SLA-posture bars, side by side (2 columns).

    Both data paths (durable base / current scan) share this layout; only the source
    caption under the KPI card differs. ``prev`` carries previous-scan values for the KPI
    change badges. Each column: heading → content → footnote caption, so the tops align."""
    kpi_col, posture_col = st.columns(2, gap="large")
    with kpi_col:
        ui.section_label("Key metrics")
        _hero(per_sev, overall, prev)
        st.caption(source_caption)
    with posture_col:
        ui.section_label("SLA posture")
        ui.sla_posture(per_sev)
        st.caption(
            "Share of resolved findings that met their SLA target, per severity, on the same "
            "90/70 policy as the breakdown table below (green ≥90%, amber ≥70%, red below). The "
            "median time-to-remediate shows as context, not the verdict."
        )
