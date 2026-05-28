"""Wiz Dashboard — Streamlit shell with shadcn-inspired sidebar nav.


Single-file scaffold for multiple pages. To add a page:
  1. Add an entry to PAGES with a unique key, label, and section.
  2. Implement a render function and register it in PAGE_RENDERERS.


The 'Wiz OS Vulnerabilities' page is fully implemented; others are stubs.
"""

import streamlit as st
from html import escape as html_escape, unescape as html_unescape
import urllib.parse

import time
import random
import runpy
import sys
import io
import contextlib
import json
import ast
import traceback
import os
import re
import datetime
from pathlib import Path
import pandas as pd
import textwrap

# ---------- Page config ----------
st.set_page_config(
    page_title="Wiz Dashboard",
    page_icon=None,
    layout="wide",
    initial_sidebar_state="expanded",
)


# ---------- Theme (light + dark aware via light-dark()) ----------
st.markdown(
    """
<style>
    /* === Enable light-dark() === */
    :root, .stApp { color-scheme: light dark; }


    /* === Semantic tokens (auto-adapt to theme) === */
    :root {
        --surface-1:        light-dark(rgba(0,0,0,0.025),  rgba(255,255,255,0.025));
        --surface-1-hover:  light-dark(rgba(0,0,0,0.05),   rgba(255,255,255,0.05));
        --surface-2:        light-dark(rgba(0,0,0,0.04),   rgba(255,255,255,0.04));
        --sidebar-bg:       light-dark(rgba(248,248,250,0.98), rgba(10,10,11,0.98));
        --border-1:         light-dark(rgba(0,0,0,0.08),   rgba(255,255,255,0.06));
        --border-2:         light-dark(rgba(0,0,0,0.14),   rgba(255,255,255,0.12));
        --border-dashed:    light-dark(rgba(0,0,0,0.14),   rgba(255,255,255,0.1));
        --text-1:           light-dark(rgba(0,0,0,0.9),    rgba(255,255,255,1));
        --text-2:           light-dark(rgba(0,0,0,0.65),   rgba(250,250,250,0.65));
        --text-3:           light-dark(rgba(0,0,0,0.5),    rgba(250,250,250,0.5));
        --text-muted:       light-dark(rgba(0,0,0,0.4),    rgba(250,250,250,0.4));
        --nav-hover:        light-dark(rgba(0,0,0,0.05),   rgba(255,255,255,0.05));
        --nav-active:       light-dark(rgba(0,0,0,0.08),   rgba(255,255,255,0.08));
        --nav-active-hover: light-dark(rgba(0,0,0,0.11),   rgba(255,255,255,0.11));
        --btn-primary-bg:       light-dark(#0a0a0a, #ffffff);
        --btn-primary-fg:       light-dark(#ffffff, #0a0a0a);
        --btn-primary-bg-hover: light-dark(#27272a, #e5e5e5);
    }


    /* === Typography === */
    html, body, [class*="css"], .stApp {
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI',
                     Roboto, 'Helvetica Neue', sans-serif;
        font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
    }
    h1, h2, h3, h4 { font-weight: 600; letter-spacing: -0.02em; }
    h1 { font-size: 1.5rem; margin: 0; }
    h2 { font-size: 1.125rem; }
    h3 { font-size: 1rem; }


    /* === Container === */
    .block-container {
        padding-top: 1.5rem !important;
        padding-bottom: 2rem !important;
        max-width: 1500px;
        transition: max-width 0.15s ease;
    }
    /* Compact density */
    .stApp[data-density="compact"] .metric-card { padding: 6px 10px; }
    .stApp[data-density="compact"] .metric-value { font-size: 1.125rem; }
    .stApp[data-density="compact"] .mttr-row { padding: 5px 0; }
    .stApp[data-density="compact"] [data-testid="stDataFrame"] tbody tr { height: 28px; }


    /* === Page header === */
    .page-header {
        display: flex; align-items: flex-end; justify-content: space-between;
        gap: 24px; padding-bottom: 16px; margin-bottom: 20px;
        border-bottom: 1px solid var(--border-1);
    }
    .subtitle {
        color: var(--text-3);
        font-size: 0.8125rem;
        margin-top: 4px;
    }


    /* === Section label === */
    .section-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-muted);
        margin: 1rem 0 0.5rem 0;
    }


    /* === Metric cards === */
    .metric-card {
        background: var(--surface-1);
        border: 1px solid var(--border-1);
        padding: 10px 14px;
        border-radius: 8px;
        transition: border-color 0.15s ease;
    }
    .metric-card:hover { border-color: var(--border-2); }
    .metric-label {
        display: flex; align-items: center; gap: 6px;
        font-size: 0.6875rem;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-2);
        margin-bottom: 6px;
    }
    .metric-value {
        font-size: 1.375rem;
        font-weight: 600;
        letter-spacing: -0.02em;
        line-height: 1.1;
        color: var(--text-1);
        display: flex; align-items: baseline; gap: 6px;
    }
    .metric-delta { font-size: 0.75rem; font-weight: 500; }
    .delta-up   { color: #dc2626; }  /* more vulns = bad */
    .delta-down { color: #16a34a; }
    .delta-flat { color: var(--text-3); }
    .sev-dot {
        display: inline-block;
        width: 7px; height: 7px;
        border-radius: 2px;
        flex-shrink: 0;
    }


    /* === Status pill (saturated colors work on both themes) === */
    .status-pill {
        display: inline-flex; align-items: center;
        padding: 3px 9px;
        border-radius: 5px;
        font-size: 0.7rem;
        font-weight: 500;
    }
    .status-ok   { background: rgba(34,197,94,0.12);  color: #16a34a; }
    .status-warn { background: rgba(234,179,8,0.12);  color: #ca8a04; }


    /* === Hide Streamlit built-in icons === */
    [data-testid="stAlert"] svg,
    .stAlert svg,
    [data-testid="stNotification"] svg,
    [data-testid="stTooltipIcon"],
    [data-testid="stWidgetLabelHelp"],
    [data-testid="stMetricDeltaIcon-Up"],
    [data-testid="stMetricDeltaIcon-Down"],
    [data-baseweb="form-control-help"] svg { display: none !important; }
    [data-testid="stAlert"] > div:first-child,
    .stAlert > div:first-child { padding-left: 0 !important; }


    /* === Alerts (less boxy, theme-aware) === */
    [data-testid="stAlert"] {
        background: var(--surface-1) !important;
        border: 1px solid var(--border-1) !important;
        border-left: 3px solid currentColor !important;
        border-radius: 6px !important;
        padding: 8px 12px !important;
        font-size: 0.8125rem !important;
    }


    /* === SIDEBAR === */
    [data-testid="stSidebar"] {
        background: var(--sidebar-bg);
        border-right: 1px solid var(--border-1);
    }
    [data-testid="stSidebar"] > div:first-child { padding-top: 1.25rem; }
    [data-testid="stSidebar"] .block-container { padding: 1rem 0.75rem; }


    .sidebar-brand {
        padding: 4px 12px 16px 12px;
        font-size: 0.875rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--text-1);
        border-bottom: 1px solid var(--border-1);
        margin-bottom: 12px;
    }
    .sidebar-brand .sub {
        font-size: 0.7rem;
        font-weight: 400;
        color: var(--text-3);
        margin-top: 2px;
    }


    [data-testid="stSidebar"] .section-label {
        margin: 12px 12px 6px 12px;
        font-size: 0.65rem;
    }


    /* Sidebar nav buttons */
    [data-testid="stSidebar"] .stButton { margin: 0; }
    [data-testid="stSidebar"] .stButton button {
        background: transparent !important;
        border: none !important;
        color: var(--text-2) !important;
        text-align: left !important;
        justify-content: flex-start !important;
        padding: 6px 12px !important;
        height: auto !important;
        min-height: 32px !important;
        font-size: 0.8125rem !important;
        font-weight: 450 !important;
        border-radius: 6px !important;
        margin: 1px 0 !important;
        width: 100% !important;
        box-shadow: none !important;
        transition: background 0.1s ease, color 0.1s ease !important;
    }
    [data-testid="stSidebar"] .stButton button:hover {
        background: var(--nav-hover) !important;
        color: var(--text-1) !important;
    }
    [data-testid="stSidebar"] .stButton button[kind="primary"] {
        background: var(--nav-active) !important;
        color: var(--text-1) !important;
        font-weight: 500 !important;
    }
    [data-testid="stSidebar"] .stButton button[kind="primary"]:hover {
        background: var(--nav-active-hover) !important;
    }


    .sidebar-footer {
        position: sticky; bottom: 0;
        padding: 12px;
        border-top: 1px solid var(--border-1);
        margin-top: 20px;
        font-size: 0.7rem;
        color: var(--text-3);
    }


    /* === Tabs === */
    [data-testid="stTabs"] [data-baseweb="tab-list"] {
        gap: 2px;
        border-bottom: 1px solid var(--border-1);
    }
    [data-testid="stTabs"] [data-baseweb="tab"] {
        padding: 8px 14px;
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--text-2);
    }
    [data-testid="stTabs"] [aria-selected="true"] { color: var(--text-1); }


    /* === Main buttons === */
    .main .stButton button {
        border-radius: 6px;
        font-weight: 500;
        font-size: 0.8125rem;
        padding: 4px 12px;
        min-height: 32px;
        height: auto;
        border: 1px solid var(--border-1);
        background: var(--surface-1);
        color: var(--text-1);
    }
    .main .stButton button:hover {
        background: var(--surface-1-hover);
        border-color: var(--border-2);
    }
    .main .stButton button[kind="primary"] {
        background: var(--btn-primary-bg) !important;
        color: var(--btn-primary-fg) !important;
        border: none !important;
    }
    .main .stButton button[kind="primary"]:hover {
        background: var(--btn-primary-bg-hover) !important;
    }
    /* Ensure main buttons sit inline and have spacing to avoid overlap */
    .main .stButton { display: inline-block; margin-right: 8px; }


    /* === Inputs === */
    .stTextInput input,
    .stMultiSelect [data-baseweb="select"] > div {
        border-radius: 6px;
        font-size: 0.8125rem;
        min-height: 32px;
    }
    .stTextInput label, .stMultiSelect label, .stSelectbox label {
        font-size: 0.75rem !important;
        color: var(--text-2) !important;
        margin-bottom: 4px !important;
    }


    /* === Dataframe === */
    [data-testid="stDataFrame"] {
        border: 1px solid var(--border-1);
        border-radius: 8px;
        overflow: hidden;
    }


    /* === Dividers === */
    hr { margin: 1rem 0; border-color: var(--border-1); }


    /* === Empty state === */
    .empty-state {
        text-align: center;
        padding: 4rem 1rem;
        border: 1px dashed var(--border-dashed);
        border-radius: 12px;
        background: var(--surface-1);
    }
    .empty-state h3 { margin: 0 0 4px 0; font-weight: 500; font-size: 1rem; color: var(--text-1); }
    .empty-state p  { color: var(--text-3); margin: 0 0 12px 0; font-size: 0.8125rem; }
    .empty-state code {
        font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
        font-size: 0.75rem;
        background: var(--surface-2);
        padding: 1px 5px;
        border-radius: 3px;
    }


    /* === Captions === */
    [data-testid="stCaption"] {
        font-size: 0.7rem;
        color: var(--text-3);
    }


    /* === MTTR widget === */
    .mttr-card {
        background: var(--surface-1);
        border: 1px solid var(--border-1);
        border-radius: 10px;
        padding: 14px 16px;
        margin-bottom: 16px;
    }
    .mttr-head {
        display: flex; align-items: flex-start; justify-content: space-between;
        padding-bottom: 12px; margin-bottom: 8px;
        border-bottom: 1px solid var(--border-1);
    }
    .mttr-title { font-size: 0.8125rem; font-weight: 600; color: var(--text-1); }
    .mttr-sub   { font-size: 0.7rem; color: var(--text-3); margin-top: 2px; }
    .mttr-big   { display: flex; align-items: baseline; gap: 8px; }
    .mttr-big-val {
        font-size: 1.5rem; font-weight: 600;
        letter-spacing: -0.02em; color: var(--text-1);
        font-variant-numeric: tabular-nums;
    }
    .mttr-big-lbl { font-size: 0.7rem; color: var(--text-3); }


    .mttr-row {
        display: grid;
        grid-template-columns: 100px 1fr 70px 80px 70px;
        gap: 12px; align-items: center;
        padding: 8px 0;
        font-size: 0.8125rem;
        border-bottom: 1px solid var(--border-1);
    }
    .mttr-row:last-child { border-bottom: none; }
    .mttr-sev    { display: flex; align-items: center; gap: 8px; font-weight: 500; color: var(--text-1); }
    .mttr-bar    {
        position: relative; height: 6px;
        background: var(--surface-2);
        border-radius: 3px;
    }
    .mttr-bar-fill {
        position: absolute; left: 0; top: 0; bottom: 0;
        border-radius: 3px;
        transition: width 0.3s ease;
    }
    .mttr-bar-marker {
        position: absolute; top: -3px; bottom: -3px;
        width: 2px; background: var(--text-2); opacity: 0.55;
    }
    .mttr-val    { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-1); }
    .mttr-sla    {
        text-align: right; font-variant-numeric: tabular-nums;
        color: var(--text-3); font-size: 0.75rem;
    }
    .mttr-pct    {
        text-align: right; font-variant-numeric: tabular-nums;
        font-weight: 500; font-size: 0.75rem;
    }
    .mttr-pct-ok   { color: #16a34a; }
    .mttr-pct-warn { color: #ca8a04; }
    .mttr-pct-bad  { color: #dc2626; }
    .mttr-row-head {
        font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--text-muted); padding-bottom: 6px;
        border-bottom: 1px solid var(--border-1);
    }


    /* === Severity chips (filter) === */
    .chips-wrap { margin-bottom: 8px; }


    /* === Skeleton loader === */
    .skel {
        background: var(--surface-2);
        border-radius: 4px;
        animation: skel 1.4s ease-in-out infinite;
    }
    .skel-line { height: 10px; margin-bottom: 6px; }
    .skel-line.tall { height: 22px; width: 55%; }
    .skel-line.short { width: 35%; }
    @keyframes skel {
        0%, 100% { opacity: 0.45; }
        50%      { opacity: 0.9; }
    }
</style>
""",
    unsafe_allow_html=True,
)


# ============================================================
#  ROUTING
# ============================================================
PAGES = {
    "wiz_os": {"label": "OS vulnerabilities", "section": "Security"},
    "cloud": {"label": "Cloud misconfigurations", "section": "Security"},
    "identity": {"label": "Identity findings", "section": "Security"},
    "reports": {"label": "Reports", "section": "Data"},
    "exports": {"label": "Exports", "section": "Data"},
}
DEFAULT_PAGE = "wiz_os"


# ============================================================
#  BACKEND
# ============================================================
def _run_os_vulns_internal(dry_run=True, use_config=False, config=None):
    """Fetch findings by importing os_vulns directly (no subprocess/runpy)."""
    if use_config and config is None:
        try:
            config = load_wiz_config()
        except Exception:
            config = None
    try:
        import os_vulns

        results = os_vulns.fetch_findings(
            dry_run=dry_run, config=config if use_config else None
        )
    except Exception:
        return None
    return coerce_results(results)


from wiz_dashboard.config import (  # noqa: E402 -- re-export of relocated logic
    CACHE_FILENAME,
    DEFAULT_CACHE_TTL_MINUTES,
    SEVERITY_COLORS,
    SEVERITY_ORDER,
    SLA_TARGETS,
    load_wiz_config,
)


from wiz_dashboard.data.transform import (  # noqa: E402 -- re-export of relocated logic
    coerce_results,
    extract_nodes,
    nodes_to_dataframe,
)


# Optional HTML sanitization helpers (use bleach if available)
try:
    import bleach
except Exception:
    bleach = None


_HTML_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(text):
    if not isinstance(text, str):
        return text
    if "<" not in text:
        return text
    try:
        return html_unescape(_HTML_TAG_RE.sub("", text))
    except Exception:
        return _HTML_TAG_RE.sub("", text)


def sanitize_html(html_text, allow_style=False):
    """Sanitize HTML for safe rendering. If `bleach` is installed we'll use
    it; otherwise fall back to stripping tags. When `allow_style=True` the
    'style' attribute is permitted on `div`/`span` so internal widgets that
    rely on inline styles (bar widths/markers) continue to render.
    """
    if not isinstance(html_text, str):
        return ""
    # Remove any <script>...</script> blocks entirely to avoid leaving
    # script text content behind.
    html_text = re.sub(
        r"<\s*script[^>]*>.*?<\s*/\s*script\s*>", "", html_text, flags=re.I | re.S
    )
    if bleach is not None:
        # Try to create a CSS sanitizer if available to allow 'style'
        css_sanitizer = None
        try:
            from bleach.css_sanitizer import CSSSanitizer

            css_sanitizer = CSSSanitizer()
        except Exception:
            try:
                from bleach.sanitizer import CSSSanitizer

                css_sanitizer = CSSSanitizer()
            except Exception:
                css_sanitizer = None

        # build a conservative allowlist of tags
        allowed_tags = list(getattr(bleach.sanitizer, "ALLOWED_TAGS", [])) or list(
            getattr(bleach, "ALLOWED_TAGS", [])
        )
        for t in ("div", "span", "br", "strong", "em", "b", "i", "u", "p"):
            if t not in allowed_tags:
                allowed_tags.append(t)
        allowed_attrs = {"*": ["class"]}
        if allow_style and css_sanitizer is not None:
            allowed_attrs.setdefault("div", []).append("style")
            allowed_attrs.setdefault("span", []).append("style")
        # If style is requested but no CSS sanitizer is available, avoid
        # allowing style to prevent NoCssSanitizerWarning; fallback to
        # stripping tags instead.
        try:
            if allow_style and css_sanitizer is not None:
                return bleach.clean(
                    html_text,
                    tags=allowed_tags,
                    attributes=allowed_attrs,
                    strip=True,
                    css_sanitizer=css_sanitizer,
                )
            elif allow_style and css_sanitizer is None:
                return strip_html(html_text)
            else:
                return bleach.clean(
                    html_text, tags=allowed_tags, attributes=allowed_attrs, strip=True
                )
        except Exception:
            return strip_html(html_text)
    else:
        if allow_style:
            # remove script blocks but retain inline styles
            return re.sub(
                r"<\s*script[^>]*>.*?<\s*/\s*script\s*>",
                "",
                html_text,
                flags=re.I | re.S,
            )
        return strip_html(html_text)


# ------------------
# Caching helpers
# ------------------
# CACHE_FILENAME / DEFAULT_CACHE_TTL_MINUTES come from wiz_dashboard.config (imported above).


def save_cache(results, filename: str = CACHE_FILENAME) -> None:
    try:
        obj = {
            "ts": datetime.datetime.utcnow()
            .replace(tzinfo=datetime.timezone.utc)
            .isoformat(),
            "results": results,
        }
        Path(filename).write_text(
            json.dumps(obj, indent=2, default=str, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        # Don't fail the whole app for cache write issues
        pass


def load_cache(
    filename: str = CACHE_FILENAME, max_age_minutes: int = DEFAULT_CACHE_TTL_MINUTES
):
    p = Path(filename)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        ts = data.get("ts")
        if not ts:
            return data.get("results")
        try:
            dt = datetime.datetime.fromisoformat(ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
        except Exception:
            # best-effort parse
            try:
                dt = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
                    tzinfo=datetime.timezone.utc
                )
            except Exception:
                return data.get("results")
        now = datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc)
        if (
            max_age_minutes is not None
            and ((now - dt).total_seconds() / 60.0) > max_age_minutes
        ):
            return None
        return data.get("results")
    except Exception:
        return None


def clear_cache(filename: str = CACHE_FILENAME) -> None:
    try:
        p = Path(filename)
        if p.exists():
            p.unlink()
    except Exception:
        pass


def get_findings_with_cache(
    dry_run=True,
    use_config=False,
    force=False,
    cache_ttl_minutes: int = DEFAULT_CACHE_TTL_MINUTES,
):
    """Return (results, used_cache:bool). If not force and a valid cache
    exists, return it; otherwise run the live fetch and persist the cache.
    """
    if not force:
        cached = load_cache(max_age_minutes=cache_ttl_minutes)
        if cached is not None:
            return cached, True

    results = _run_os_vulns_internal(dry_run=dry_run, use_config=use_config)
    if results is not None:
        try:
            save_cache(results)
        except Exception:
            pass
    return results, False


## ============================================================
#  HELPERS — severity / formatting
# ============================================================
# SEVERITY_ORDER / SEVERITY_COLORS / SLA_TARGETS come from wiz_dashboard.config (imported above).


from wiz_dashboard.domain.severity import (  # noqa: E402 -- re-export of relocated logic
    count_by_severity,
    normalize_severity,
)


from wiz_dashboard.domain.formatting import format_duration  # noqa: E402


from wiz_dashboard.domain.metrics import calculate_mttr  # noqa: E402


# ============================================================
#  UI components
# ============================================================
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


def show_toast(message, kind="success", duration=2500):
    colors = {
        "success": "#16a34a",
        "info": "#2563eb",
        "warning": "#eab308",
        "error": "#dc2626",
    }
    bg = colors.get(kind, "#16a34a")
    nid = f"t{int(time.time()*1000)}{random.randint(0,9999)}"
    safe = html_escape(str(message))
    snippet = f"""
    <div id="{nid}" style="position:fixed; top:18px; right:18px; z-index:9999;">
        <div style="background:{bg}; color:#fff; padding:8px 14px; border-radius:6px;
                    box-shadow:0 4px 14px rgba(0,0,0,0.25);
                    font-family:-apple-system,Inter,sans-serif;
                    font-size:0.8125rem; font-weight:500;">{safe}</div>
    </div>
    <script>(function(){{const e=document.getElementById('{nid}');
        if(e) setTimeout(()=>e.remove(),{duration});}})();</script>"""
    try:
        # Embed the HTML via a data URI in an iframe (replacement for
        # components.v1.html). This avoids relying on the deprecated API.
        src = "data:text/html;charset=utf-8," + urllib.parse.quote(snippet)
        st.iframe(src, height=96, scrolling=False)
    except Exception:
        st.write(message)


def show_exception(exc: Exception, title: str = "Error") -> None:
    """Display an exception message with an expandable traceback and download.


    Use this helper anywhere we catch exceptions to surface errors to the user
    with a collapsible stack trace and an option to download the details.
    """
    try:
        tb = traceback.format_exc()
    except Exception:
        tb = str(exc)

    # Primary visible error
    st.error(f"{title}: {str(exc)}")

    # Show details in an expander so users can inspect the full traceback
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


def severity_chips(df, key="sev_filter"):
    """Toggleable severity filter chips. Returns the active set."""
    if key not in st.session_state:
        # init from URL if present
        sev_param = st.query_params.get("sev", "")
        if sev_param:
            st.session_state[key] = {
                s for s in sev_param.upper().split(",") if s in SEVERITY_ORDER
            }
        else:
            st.session_state[key] = set(SEVERITY_ORDER)

    counts = count_by_severity(df)
    cols = st.columns(len(SEVERITY_ORDER))
    for col, sev in zip(cols, SEVERITY_ORDER):
        with col:
            active = sev in st.session_state[key]
            label = f"{sev.title()} · {counts.get(sev, 0)}"
            if st.button(
                label,
                key=f"chip_{sev}_{key}",
                type="primary" if active else "secondary",
                width="stretch",
            ):
                if active:
                    st.session_state[key].discard(sev)
                else:
                    st.session_state[key].add(sev)
                # persist to URL
                st.query_params["sev"] = ",".join(sorted(st.session_state[key]))
                st.rerun()
    return st.session_state[key]


def render_mttr_widget(df):
    """MTTR card with per-severity rows, SLA bars and compliance."""
    per_sev, overall = calculate_mttr(df)
    if not per_sev:
        st.markdown(
            '<div class="empty-state">'
            "<h3>No remediation timestamps</h3>"
            "<p>MTTR needs <code>firstSeenAt</code> + <code>resolvedAt</code> "
            "(or a <code>status</code> field) on findings.</p>"
            "</div>",
            unsafe_allow_html=True,
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

        # Bar fill = MTTR, marker = SLA. Scale capped at 2x SLA.
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

    # Dedent the generated HTML to avoid leading spaces/newlines which
    # Markdown treats as an indented code block (causing tags to display
    # as literal text). Then sanitize and render via st.markdown so the
    # global page CSS and theme variables apply.
    dedented = textwrap.dedent(html_full).lstrip()
    sanitized = sanitize_html(dedented, allow_style=True)
    sanitized = sanitized.strip()
    try:
        st.markdown(sanitized, unsafe_allow_html=True)
    except Exception:
        st.markdown(
            "<pre>" + html_escape(strip_html(sanitized)) + "</pre>",
            unsafe_allow_html=True,
        )


# ============================================================
#  SIDEBAR (shadcn-style nav)
# ============================================================
def render_sidebar():
    if "current_page" not in st.session_state:
        # Restore from URL if present
        page_param = st.query_params.get("page", DEFAULT_PAGE)
        st.session_state.current_page = (
            page_param if page_param in PAGES else DEFAULT_PAGE
        )

    with st.sidebar:
        # Brand
        st.markdown(
            '<div class="sidebar-brand">Wiz Dashboard'
            '<div class="sub">Security observability</div>'
            "</div>",
            unsafe_allow_html=True,
        )

        # Group pages by section, preserving insertion order
        sections = {}
        for key, meta in PAGES.items():
            sections.setdefault(meta["section"], []).append((key, meta["label"]))

        for section, items in sections.items():
            section_label(section)
            for key, label in items:
                active = st.session_state.current_page == key
                clicked = st.button(
                    label,
                    key=f"nav_{key}",
                    type="primary" if active else "secondary",
                    width="stretch",
                )
                if clicked and not active:
                    st.session_state.current_page = key
                    st.query_params["page"] = key
                    st.rerun()

        # Density toggle
        section_label("Preferences")
        dense = st.toggle(
            "Compact density",
            value=st.session_state.get("dense", False),
            key="dense_toggle",
        )
        if dense != st.session_state.get("dense", False):
            st.session_state.dense = dense
            st.rerun()

        # Inject density attribute on .stApp
        density = "compact" if st.session_state.get("dense", False) else "comfortable"
        st.markdown(
            f"<script>document.querySelector('.stApp').setAttribute('data-density','{density}');</script>",
            unsafe_allow_html=True,
        )

        # Footer: credentials status
        cfg = load_wiz_config()
        has_creds = bool(cfg.get("wiz_client_id") and cfg.get("wiz_client_secret"))
        pill = (
            '<span class="status-pill status-ok">Credentials loaded</span>'
            if has_creds
            else '<span class="status-pill status-warn">No credentials</span>'
        )
        st.markdown(
            f'<div class="sidebar-footer">{pill}</div>',
            unsafe_allow_html=True,
        )

    return has_creds


# ============================================================
#  PAGE HEADER
# ============================================================
def render_page_header(title, subtitle, actions=None):
    """Compact page header with title left, action buttons right.


    actions: list of (label, btn_type, key) tuples. Results land in
             st.session_state[f'_action_{key}'] for the caller to read.
    """
    actions = actions or []
    left, right = st.columns([2, 3])
    with left:
        st.markdown(
            f"<div><h1>{html_escape(title)}</h1>"
            f'<div class="subtitle">{html_escape(subtitle)}</div></div>',
            unsafe_allow_html=True,
        )
    with right:
        if actions:
            cols = st.columns(len(actions))
            for col, (label, btn_type, key) in zip(cols, actions):
                with col:
                    st.session_state[f"_action_{key}"] = st.button(
                        label,
                        type=btn_type,
                        key=key,
                        width="content",
                    )
    st.markdown(
        '<hr style="margin-top:8px;margin-bottom:16px;" />', unsafe_allow_html=True
    )


# ============================================================
#  PAGE: OS vulnerabilities
# ============================================================
def page_wiz_os(has_creds):
    render_page_header(
        "OS vulnerabilities",
        "CVEs discovered on host workloads via Wiz Security Graph",
        actions=[
            ("Refresh", "secondary", "os_refresh"),
            ("Run scan", "primary", "os_run"),
        ],
    )

    # --- run / refresh handling ---
    # If Refresh clicked, mark a forced run and clear the in-memory preview.
    if st.session_state.get("_action_os_refresh"):
        st.session_state["_force_os_run"] = True
        st.session_state.pop("os_df", None)
        st.session_state.pop("os_counts", None)
        st.session_state.pop("os_prev_counts", None)
        # Auto-trigger a run so Refresh immediately updates data
        st.session_state["_action_os_run"] = True

    if st.session_state.get("_action_os_run"):
        force = bool(st.session_state.pop("_force_os_run", False))
        with st.spinner("Querying Wiz…" if not force else "Forcing live scan…"):
            try:
                results, used_cache = get_findings_with_cache(
                    dry_run=not has_creds, use_config=has_creds, force=force
                )
            except Exception as e:
                # Surface the error with traceback and keep the UI stable
                show_exception(e, title="Run scan failed")
                results = None
                used_cache = False
        if results is None:
            st.error("Scan produced no output. Check OS_vulns.py and credentials.")
        else:
            # snapshot for delta computation
            prev = st.session_state.get("os_counts", {})
            nodes = extract_nodes(results)
            df = nodes_to_dataframe(nodes)
            st.session_state.os_df = df
            st.session_state.os_raw_results = results
            st.session_state.os_prev_counts = prev
            st.session_state.os_counts = count_by_severity(df)
            show_toast(
                f"Loaded {len(nodes):,} findings" + (" (cached)" if used_cache else ""),
                "success",
            )

    df = st.session_state.get("os_df", pd.DataFrame())

    # --- empty state ---
    if df.empty:
        st.markdown(
            '<div class="empty-state">'
            "<h3>No findings loaded</h3>"
            "<p>Click <b>Run scan</b> to query Wiz. "
            "Without credentials a dry-run with sample data is used.</p>"
            "</div>",
            unsafe_allow_html=True,
        )
        # Skeleton preview so the page doesn't feel empty
        section_label("Severity breakdown")
        cols = st.columns(6)
        for c in cols:
            with c:
                metric_skeleton()
        return

    # --- severity metric cards with deltas ---
    section_label("Severity breakdown")
    counts = count_by_severity(df)
    prev = st.session_state.get("os_prev_counts", {})
    cols = st.columns(len(SEVERITY_ORDER))
    for col, sev in zip(cols, SEVERITY_ORDER):
        with col:
            cur = counts.get(sev, 0)
            pcur = prev.get(sev, None)
            delta = (cur - pcur) if pcur is not None else None
            metric_card(
                sev.title(), f"{cur:,}", color=SEVERITY_COLORS[sev], delta=delta
            )

    # --- MTTR widget ---
    section_label("Remediation performance")
    render_mttr_widget(df)

    # --- filter chips ---
    section_label("Filter")
    active_sevs = severity_chips(df, key="os_sev_filter")

    # --- table ---
    section_label("Findings")
    if "severity" in df.columns:
        view = df[df["severity"].apply(normalize_severity).isin(active_sevs)]
    else:
        view = df
    if view.empty:
        st.caption("No findings match the current filter.")
    else:
        # Surface the most useful columns first if present
        preferred = [
            c
            for c in [
                "severity",
                "name",
                "vulnerability.name",
                "vulnerability.id",
                "vulnerableAsset.name",
                "vulnerableAsset.type",
                "firstSeenAt",
                "resolvedAt",
                "status",
                "fixedVersion",
            ]
            if c in view.columns
        ]
        rest = [c for c in view.columns if c not in preferred and not c.startswith("_")]
        st.dataframe(
            view[preferred + rest], width="stretch", hide_index=True, height=520
        )
        st.caption(f"{len(view):,} of {len(df):,} findings shown.")


# ============================================================
#  STUB PAGES
# ============================================================
def _stub(title, subtitle):
    render_page_header(title, subtitle)
    st.markdown(
        '<div class="empty-state">'
        f"<h3>{html_escape(title)} — coming soon</h3>"
        "<p>This page is a placeholder. Wire up a query and render below.</p>"
        "</div>",
        unsafe_allow_html=True,
    )


def page_cloud(has_creds):
    _stub(
        "Cloud misconfigurations", "IaC and runtime config drift from cloud baselines"
    )


def page_identity(has_creds):
    _stub("Identity findings", "Excess privileges, stale roles, and risky IAM bindings")


def page_reports(has_creds):
    _stub("Reports", "Scheduled and ad-hoc security reporting")


def page_exports(has_creds):
    _stub("Exports", "Download findings as CSV, JSON, or push to S3")


PAGE_RENDERERS = {
    "wiz_os": page_wiz_os,
    "cloud": page_cloud,
    "identity": page_identity,
    "reports": page_reports,
    "exports": page_exports,
}


# ============================================================
#  MAIN
# ============================================================
def main():
    try:
        has_creds = render_sidebar()
        page_key = st.session_state.get("current_page", DEFAULT_PAGE)
        renderer = PAGE_RENDERERS.get(page_key, page_wiz_os)
        renderer(has_creds)
    except Exception as e:
        # Catch any unexpected error from rendering and display details
        show_exception(e, title="Unhandled error")


if __name__ == "__main__":
    main()
