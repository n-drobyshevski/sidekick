"""MTTR & SLA page: remediation performance for the loaded OS findings.

A consumer page (like Reports / Exports): it reads the findings a scan stored in session
state on the OS vulnerabilities page — it never fetches on its own. The per-severity widget
and KPI hero need flat per-finding data (timestamps); the trend charts read the persistent
MTTR history file, so they show up even before a scan in the current session.
"""

import pandas as pd
import streamlit as st

from wiz_dashboard.domain import domain_rules, metrics
from wiz_dashboard.domain.formatting import format_duration
from wiz_dashboard.ui import charts
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui import scan
from wiz_dashboard.ui.pages import _derived


def page():
    ui.render_page_header("MTTR & SLA", "Remediation performance for OS findings")
    _body()


@st.fragment
def _body() -> None:
    """Everything below the header, as one fragment. The Domain selectbox scopes every
    metric and trend on the page (the KPI badges read the trend via ``_prev_from_trend``),
    so the regions can't rerun independently of each other — but they *can* rerun
    independently of the app chrome: changing the domain reruns only this body, skipping
    the sidebar/scan/nav script. Zero-arg by design: fragment args are captured at the
    last full run, so all inputs are re-read here via session state and cached getters."""
    df, sig = _derived.display_view()
    nodes = st.session_state.get("os_nodes")
    scope = _derived.display_scope()
    if scope:
        st.caption(
            f"Showing {' + '.join(s.title() for s in scope)} — the display filter "
            "(Settings) applies to every metric and trend on this page."
        )

    # Domain scope (Settings → Domains): one domain at a time — an MTTR verdict is
    # ambiguous when two domains' findings are pooled. Offered only when domains are
    # configured AND the ledger already classifies rows into at least one of them.
    items, rules_version = _derived.domains_config()
    domain_mttr = _derived.ledger_domain_mttr_cached(scope, rules_version) if items else {}
    domain_sel = None
    if domain_mttr:
        names = [n for n in domain_rules.domain_names(items) if n in domain_mttr]
        choice = st.selectbox(
            "Domain",
            ["All domains", *names],
            key="mttr_domain",
            help="Scope every metric and trend on this page to one triage domain.",
        )
        if choice and choice != "All domains":
            domain_sel = choice

    # Prefer the durable ledger: MTTR computed from lifecycles observed across ALL saved
    # scans (so vulns that disappeared between scans count as resolved). Fall back to the
    # current scan's snapshot when the base is still empty.
    if domain_sel:
        ledger_mttr = domain_mttr.get(domain_sel, ({}, {}))
    else:
        ledger_mttr = _derived.ledger_mttr_cached(scope)
    ledger_has = bool(ledger_mttr and ledger_mttr[0])

    # Trend: ledger-reconstructed open/resolved/median over time, with the legacy daily
    # MTTR history as a fallback before the base has data. (The legacy history file is
    # whole-scan medians and can't be severity- or domain-filtered; the ledger trend is
    # the scoped source and wins whenever the base has data.)
    if domain_sel:
        trend_df = _derived.ledger_trend_domain_cached(scope, rules_version, domain_sel)
        trend = trend_df
    else:
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
        source = (
            f"MTTR source: durable base, scoped to the {domain_sel} domain."
            if domain_sel
            else "MTTR source: durable base. Lifecycles observed across all saved "
                 "scans (a vuln that disappears between scans counts as resolved)."
        )
        _kpi_and_posture(per_sev, overall, source, prev_kpis)
        # Per-severity detail is demoted to an expander: Median MTTR above is the hero.
        # show_overall=False keeps the widget to just the table (the hero stat already
        # carries median / resolved / open).
        with st.expander("Per-severity breakdown", expanded=False):
            ui.render_mttr_widget(df, mttr=(per_sev, overall), show_overall=False)
    elif not df.empty and scan.loaded_shape(nodes) != "grouped":
        per_sev, overall = _derived.mttr_cached(sig, df)
        _kpi_and_posture(
            per_sev,
            overall,
            "MTTR source: current scan only. Run scans over time to build the "
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

    if domain_mttr and not domain_sel:
        _by_domain_section(items, domain_mttr, scope, rules_version)

    ui.section_label("MTTR trend (median over time)")
    charts.mttr_trend(trend)

    ui.section_label("Open vs resolved (over time)")
    charts.open_resolved_trend(trend)


def _by_domain_section(items, domain_mttr, scope, rules_version) -> None:
    """Per-domain remediation posture: one row per triage domain, busiest first.

    The leadership read ("which team is behind"): open load, resolved volume, median
    MTTR and the same In-SLA verdict the headline uses — per domain. Unassigned sorts
    last regardless of size; it's the triage backlog, not a team."""
    ui.section_label("By domain")
    rows = []
    for name in domain_rules.domain_names(items):
        if name not in domain_mttr:
            continue
        per_sev, overall = domain_mttr[name]
        sla, _oldest = metrics.overall_sla_oldest(per_sev)
        rows.append({
            "Domain": name,
            "Open": int(overall.get("open", 0)),
            "Resolved": int(overall.get("resolved", 0)),
            "Median MTTR": format_duration(overall.get("mttr_median")),
            "In SLA %": round(sla) if sla is not None else None,
        })
    rows.sort(key=lambda r: (r["Domain"] == domain_rules.UNASSIGNED, -r["Open"]))
    st.dataframe(
        pd.DataFrame(rows),
        hide_index=True,
        width="stretch",
        column_config={
            "In SLA %": st.column_config.ProgressColumn(
                "In SLA", min_value=0, max_value=100, format="%d%%",
                help="Share of resolved findings remediated within their SLA target.",
            ),
        },
    )
    base = _derived.ledger_base_domains_cached(scope, rules_version)
    compacted = (
        int((base["asset_name"] == "(compacted)").sum())
        if base is not None and not base.empty and "asset_name" in base.columns
        else 0
    )
    if compacted:
        st.caption(
            f"{compacted:,} compacted resolved finding(s) predate their asset data and "
            "are counted under Unassigned."
        )


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


def _hero(per_sev, overall, source, prev=None) -> None:
    """The page hero: Median MTTR at display scale (the metric this page exists for),
    with the four complementary stats demoted to a quiet mini-stat strip beneath it.
    Each metric keeps its absolute + % change vs the previous scan (``prev`` from
    ``_prev_from_trend``), shown only where a historical baseline exists. ``source`` is
    the plain-text data-source line rendered under the hero value."""
    prev = prev or {}
    sla, oldest = metrics.overall_sla_oldest(per_sev)
    med = overall.get("mttr_median")
    resolved_cur = int(overall.get("resolved", 0))
    open_cur = int(overall.get("open", 0))

    med_item = {"label": "Median MTTR", "value": format_duration(med), "sub": source,
                "help": "Median days from first detection to remediation."}
    pm = prev.get("median_days")
    if med is not None and not pd.isna(med) and pm:  # truthy base avoids /0
        dd = float(med) - float(pm)
        med_item.update(delta=dd, abs_text=format_duration(abs(dd)), pct=dd / pm * 100)

    sla_item = {"label": "In SLA", "value": (f"{sla:.0f}%" if sla is not None else "—"),
                "inverse": False,
                "help": "Share of resolved findings remediated within their SLA target."}
    ps = prev.get("sla_pct")
    if sla is not None and ps:
        # In SLA is itself a %, so its change reads in whole percentage points — matching the
        # whole-% value, so a sub-point move shows a neutral ±0 instead of a misleading
        # "−0pp", and there's no confusing relative "% of a %".
        sla_item.update(delta=round(float(sla) - float(ps)), delta_suffix="pp")

    oldest_item = {"label": "Oldest open", "value": format_duration(oldest),
                   "help": "90th-percentile age of currently-open findings."}
    po_age = prev.get("oldest_open_days")
    if oldest is not None and po_age:
        dd = float(oldest) - float(po_age)
        oldest_item.update(delta=dd, abs_text=format_duration(abs(dd)), pct=dd / po_age * 100)

    res_item = {"label": "Resolved", "value": f"{resolved_cur:,}", "inverse": False,
                "help": "Findings with a recorded remediation."}
    pr = prev.get("resolved")
    if pr is not None:
        res_item.update(delta=resolved_cur - pr,
                        pct=((resolved_cur - pr) / pr * 100) if pr else None)

    open_item = {"label": "Open", "value": f"{open_cur:,}",
                 "help": "Findings still awaiting remediation."}
    po = prev.get("open")
    if po is not None:
        open_item.update(delta=open_cur - po,
                         pct=((open_cur - po) / po * 100) if po else None)

    ui.hero_stat(med_item, [sla_item, oldest_item, res_item, open_item])


def _kpi_and_posture(per_sev, overall, source_caption, prev=None) -> None:
    """The Median MTTR hero + the SLA-posture bars, side by side (2 columns).

    Both data paths (durable base / current scan) share this layout; only the source
    line under the hero value differs. ``prev`` carries previous-scan values for the
    change badges."""
    kpi_col, posture_col = st.columns(2, gap="large")
    with kpi_col:
        _hero(per_sev, overall, source_caption, prev)
    with posture_col:
        ui.section_label("SLA posture")
        ui.sla_posture(per_sev)
        st.caption(
            "Share of resolved findings that met their SLA target, per severity, on the same "
            "90/70 policy as the breakdown table below (green ≥90%, amber ≥70%, red below). The "
            "median time-to-remediate shows as context, not the verdict."
        )
