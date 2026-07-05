"""Overview page: an at-a-glance security posture across all loaded findings.

A pure consumer page (no scanning of its own — the global sidebar / OS page own that).
It composes the existing building blocks: severity counts and MTTR from the shared
``_derived`` caches, the severity bar, the SLA bullet small-multiples, and the MTTR
trend. Aggregates across every loaded source (today just OS, but designed to grow).
"""

import html as _html

import pandas as pd
import streamlit as st

from wiz_dashboard.config import SEVERITY_COLORS, SEVERITY_ORDER
from wiz_dashboard.domain.formatting import format_duration
from wiz_dashboard.models import schema
from wiz_dashboard.ui import charts
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui.pages import _derived, _findings


def page():
    ui.render_page_header("Overview", "Security posture across your loaded findings")

    sources = _findings.loaded_sources()
    if not sources:
        ui.empty_state(
            "Nothing loaded yet",
            "Run a scan from the **sidebar** (or the OS vulnerabilities page) to populate "
            "the dashboard. Without credentials a dry-run with sample data is used.",
        )
        return

    counts, per_sev, overall, grouped_only = _aggregate(sources)

    _hero(counts, per_sev, overall)
    _attention(per_sev, grouped_only)

    history = _derived.history_cached()
    left, right = st.columns(2)
    with left:
        ui.section_label("Severity distribution")
        charts.severity_bar(counts)
    with right:
        ui.section_label("MTTR trend (daily median)")
        charts.mttr_trend(history)

    ui.section_label("SLA posture")
    st.caption(
        "Share of resolved findings that met their SLA target, per severity "
        "(green ≥90%, amber ≥70%, red below)."
    )
    ui.sla_posture(per_sev)

    _quick_links()


# --------------------------------------------------------------------------- #
#  Aggregation across loaded sources
# --------------------------------------------------------------------------- #
def _source_counts(info):
    """Severity counts for one source, handling both response shapes.

    Flat (per-finding) -> ``count_by_severity``; grouped-by-asset -> the analytics
    block via ``schema.severity_counts_from_groups`` (matches the OS page)."""
    nodes = st.session_state.get(f"{info['prefix']}_nodes")
    if nodes and schema.is_grouped_shape(nodes):
        groups = [g for g in schema.parse_nodes(nodes) if isinstance(g, schema.AssetGroup)]
        return schema.severity_counts_from_groups(groups), True
    df = info["df"]
    # info["sig"] is the display-scoped token from loaded_sources — never df_token the
    # filtered frame (that reads the FULL frame's session token and collides the caches).
    return _derived.counts_cached(info["sig"], df), False


def _aggregate(sources):
    """Return (agg_counts, per_sev, overall, grouped_only) across all loaded sources.

    Counts sum across sources (both shapes). MTTR/SLA is computed on the concatenation
    of the flat (per-finding) sources only — grouped responses omit the timestamps it
    needs. ``grouped_only`` is True when every loaded source is grouped (so the MTTR
    sections explain why they're empty)."""
    agg_counts = {}
    flat_frames = []
    flat_tokens = []
    grouped_count = 0
    for info in sources.values():
        counts, grouped = _source_counts(info)
        for sev, n in counts.items():
            agg_counts[sev] = agg_counts.get(sev, 0) + int(n)
        if grouped:
            grouped_count += 1
        elif info["df"] is not None and not info["df"].empty:
            flat_frames.append(info["df"])
            flat_tokens.append(info["sig"])

    if flat_frames:
        combined = pd.concat(flat_frames, ignore_index=True)
        # Key the concatenation on its parts' tokens — hashing the combined frame would
        # reintroduce the full-frame walk the tokens exist to avoid.
        combined_sig = "|".join(flat_tokens) + f":{len(combined)}"
        per_sev, overall = _derived.mttr_cached(combined_sig, combined)
    else:
        per_sev, overall = {}, {}
    grouped_only = grouped_count == len(sources)
    return agg_counts, per_sev, overall, grouped_only


# --------------------------------------------------------------------------- #
#  Sections
# --------------------------------------------------------------------------- #
def _overall_sla_pct(per_sev):
    compliant = sum(d.get("sla_compliant", 0) for d in per_sev.values())
    resolved = sum(d.get("resolved", 0) for d in per_sev.values())
    return (compliant / resolved * 100) if resolved else None


def _hero(counts, per_sev, overall) -> None:
    total = sum(counts.values())
    sla = _overall_sla_pct(per_sev)
    ui.kpi_row(
        [
            {"label": "Total findings", "value": f"{total:,}", "accent": "var(--accent)"},
            {"label": "Critical", "value": f"{counts.get('CRITICAL', 0):,}",
             "glyph_html": ui.sev_dot_html("CRITICAL"), "accent": SEVERITY_COLORS["CRITICAL"]},
            {"label": "In SLA", "value": (f"{sla:.0f}%" if sla is not None else "—"),
             "accent": "#16a34a", "inverse": False,
             "help": "Share of resolved findings remediated within their SLA target."},
            {"label": "Median MTTR", "value": format_duration(overall.get("mttr_median")),
             "accent": "var(--accent)",
             "help": "Median days from first detection to remediation."},
            {"label": "Open", "value": f"{int(overall.get('open', 0)):,}",
             "accent": SEVERITY_COLORS["HIGH"], "help": "Findings still awaiting remediation."},
        ]
    )


def _attention(per_sev, grouped_only) -> None:
    """A 'needs attention' callout. Meaning is carried by the text + a CSS status dot
    (a redundant, non-emoji colour signal) — not colour alone."""
    items = []
    crit = per_sev.get("CRITICAL", {})
    if crit.get("open"):
        items.append(("danger", f"{crit['open']} critical finding(s) still open"))
    for sev in SEVERITY_ORDER:
        d = per_sev.get(sev, {})
        pct = d.get("sla_pct")
        if pct is not None and pct < 70 and d.get("resolved"):
            items.append(("warn", f"{sev.title()} is missing SLA — {pct:.0f}% remediated in target"))
    p90s = [d.get("open_age_p90") for d in per_sev.values() if d.get("open_age_p90") is not None]
    if p90s:
        items.append(("info", f"Oldest open finding (p90 age): {format_duration(max(p90s))}"))

    def _line(kind, msg):
        return (
            f'<div class="attn-row"><span class="attn-dot attn-dot--{kind}"></span>'
            f'<span>{_html.escape(msg)}</span></div>'
        )

    with st.container(border=True):
        if items:
            st.markdown("**Needs attention**")
            st.markdown("".join(_line(k, m) for k, m in items), unsafe_allow_html=True)
        elif grouped_only:
            st.markdown(
                "**Needs attention** — MTTR & SLA need per-finding timestamps, which the "
                "loaded grouped-by-asset response omits. Severity counts are shown above."
            )
        else:
            st.markdown("**Status**")
            st.markdown(
                _line("ok", "All clear — every severity is within its SLA target."),
                unsafe_allow_html=True,
            )


def _quick_links() -> None:
    """Jump-to links into the detail pages (uses the Page objects app.py shares)."""
    pages = st.session_state.get("_pages", {})
    targets = [
        ("OS vulnerabilities", ":material/dns:"),
        ("MTTR & SLA", ":material/trending_up:"),
        ("Reports", ":material/bar_chart:"),
    ]
    available = [(name, icon) for name, icon in targets if name in pages]
    if not available:
        return
    ui.section_label("Jump to")
    for col, (name, icon) in zip(st.columns(len(available)), available):
        with col:
            st.page_link(pages[name], label=name, icon=icon)
