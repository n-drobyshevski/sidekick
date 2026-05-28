"""Reusable Streamlit UI components: metric cards, MTTR widget, headers, toasts."""

import textwrap
import traceback
from html import escape as html_escape

import streamlit as st

from wiz_dashboard.config import SEVERITY_COLORS, SEVERITY_ORDER
from wiz_dashboard.domain.formatting import format_duration
from wiz_dashboard.domain.metrics import calculate_mttr
from wiz_dashboard.domain.severity import count_by_severity
from wiz_dashboard.ui.sanitize import sanitize_html, strip_html

_TOAST_ICONS = {"success": "✅", "info": "ℹ️", "warning": "⚠️", "error": "🚨"}


def metric_card(label, value, color=None, delta=None, delta_suffix=""):
    """Compact metric card with optional severity dot and trend delta."""
    dot = f'<span class="sev-dot" style="background:{color};"></span>' if color else ""
    delta_html = ""
    if delta is not None:
        try:
            d = float(delta)
            if d > 0:
                delta_html = f'<span class="metric-delta delta-up">▲ {abs(int(d)) if d.is_integer() else f"{d:.1f}"}{delta_suffix}</span>'
            elif d < 0:
                delta_html = f'<span class="metric-delta delta-down">▼ {abs(int(d)) if d.is_integer() else f"{abs(d):.1f}"}{delta_suffix}</span>'
            else:
                delta_html = (
                    f'<span class="metric-delta delta-flat">— 0{delta_suffix}</span>'
                )
        except Exception:
            pass
    st.markdown(
        f'<div class="metric-card">'
        f'<div class="metric-label">{dot}{html_escape(label)}</div>'
        f'<div class="metric-value">{value}{delta_html}</div>'
        f"</div>",
        unsafe_allow_html=True,
    )


def metric_skeleton():
    """Skeleton placeholder for a metric card (use while loading)."""
    st.markdown(
        '<div class="metric-card">'
        '<div class="skel skel-line short"></div>'
        '<div class="skel skel-line tall"></div>'
        "</div>",
        unsafe_allow_html=True,
    )


def section_label(text):
    st.markdown(
        f'<div class="section-label">{html_escape(text)}</div>', unsafe_allow_html=True
    )


def empty_state(title, body):
    """Shared empty/placeholder panel. `body` may contain trusted inline HTML."""
    st.markdown(
        '<div class="empty-state">'
        f"<h3>{html_escape(title)}</h3>"
        f"<p>{body}</p>"
        "</div>",
        unsafe_allow_html=True,
    )


def show_toast(message, kind="success", duration=2500):
    """Native toast. `duration` is accepted for call-site compatibility (unused)."""
    st.toast(str(message), icon=_TOAST_ICONS.get(kind))


def show_exception(exc: Exception, title: str = "Error") -> None:
    """Display an error with an expandable traceback and a download button."""
    try:
        tb = traceback.format_exc()
    except Exception:
        tb = str(exc)

    st.error(f"{title}: {str(exc)}")

    with st.expander("Show error details", expanded=False):
        try:
            st.code(tb, language="text")
        except Exception:
            st.text(tb)
        try:
            st.download_button(
                "Download error details",
                data=tb,
                file_name="error.txt",
                mime="text/plain",
            )
        except Exception:
            pass


def render_mttr_widget(df):
    """MTTR card with per-severity rows, SLA bars and compliance."""
    per_sev, overall = calculate_mttr(df)
    if not per_sev:
        empty_state(
            "No remediation timestamps",
            "MTTR needs <code>firstSeenAt</code> + <code>resolvedAt</code> "
            "(or a <code>status</code> field) on findings.",
        )
        return

    rows = []
    for sev in SEVERITY_ORDER:
        d = per_sev.get(sev)
        if not d:
            continue
        color = SEVERITY_COLORS[sev]
        mttr = d["mttr_median"]  # median is more honest than mean for skewed VM data
        sla = d["sla_target"]
        pct = d["sla_pct"]

        if sla and mttr is not None:
            scale_max = sla * 2
            fill_pct = min(mttr / scale_max * 100, 100)
            mark_pct = (sla / scale_max) * 100
            fill_color = color if mttr <= sla else "#dc2626"
        else:
            fill_pct, mark_pct, fill_color = 0, 0, color

        if pct is None:
            pct_cls, pct_str = "mttr-pct", "—"
        elif pct >= 90:
            pct_cls, pct_str = "mttr-pct mttr-pct-ok", f"{pct:.0f}%"
        elif pct >= 70:
            pct_cls, pct_str = "mttr-pct mttr-pct-warn", f"{pct:.0f}%"
        else:
            pct_cls, pct_str = "mttr-pct mttr-pct-bad", f"{pct:.0f}%"

        marker_html = (
            f'<div class="mttr-bar-marker" style="left:{mark_pct:.1f}%;"></div>'
            if sla
            else ""
        )

        rows.append(f"""
        <div class="mttr-row" title="resolved: {d['resolved']} · open: {d['open']} · within SLA: {d['sla_compliant']}">
            <div class="mttr-sev"><span class="sev-dot" style="background:{color};"></span>{sev.title()}</div>
            <div class="mttr-bar">
                <div class="mttr-bar-fill" style="width:{fill_pct:.1f}%; background:{fill_color};"></div>
                {marker_html}
            </div>
            <div class="mttr-val">{format_duration(mttr)}</div>
            <div class="mttr-sla">{f"SLA {sla}d" if sla else "—"}</div>
            <div class="{pct_cls}">{pct_str}</div>
        </div>""")

    header_row = """
    <div class="mttr-row mttr-row-head">
        <div>Severity</div>
        <div>MTTR vs SLA</div>
        <div style="text-align:right;">Median</div>
        <div style="text-align:right;">Target</div>
        <div style="text-align:right;">In SLA</div>
    </div>"""

    overall_str = format_duration(overall["mttr_median"])
    html_full = f"""
    <div class="mttr-card">
        <div class="mttr-head">
            <div>
                <div class="mttr-title">Mean Time to Remediate</div>
                <div class="mttr-sub">{overall['resolved']:,} resolved · {overall['open']:,} open · median across all severities</div>
            </div>
            <div class="mttr-big">
                <span class="mttr-big-val">{overall_str}</span>
                <span class="mttr-big-lbl">overall median</span>
            </div>
        </div>
        {header_row}
        {''.join(rows)}
    </div>
    """

    # Dedent so Markdown doesn't treat the HTML as an indented code block.
    dedented = textwrap.dedent(html_full).lstrip()
    sanitized = sanitize_html(dedented, allow_style=True).strip()
    try:
        st.markdown(sanitized, unsafe_allow_html=True)
    except Exception:
        st.markdown(
            "<pre>" + html_escape(strip_html(sanitized)) + "</pre>",
            unsafe_allow_html=True,
        )


def render_page_header(title, subtitle):
    """Compact page header: title + subtitle, followed by a divider."""
    st.markdown(
        f"<div><h1>{html_escape(title)}</h1>"
        f'<div class="subtitle">{html_escape(subtitle)}</div></div>',
        unsafe_allow_html=True,
    )
    st.markdown(
        '<hr style="margin-top:8px;margin-bottom:16px;" />', unsafe_allow_html=True
    )
