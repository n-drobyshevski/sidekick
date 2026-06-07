"""Wiz security dashboard — entry point.

Run with:  streamlit run app.py

Uses the native multipage API (st.navigation / st.Page). Page implementations live
in wiz_dashboard/ui/pages/; shared logic in wiz_dashboard/{config,data,domain,models}.
"""

import streamlit as st

from wiz_dashboard.config import load_wiz_config
from wiz_dashboard.ui import scan, theme
from wiz_dashboard.ui.pages import (
    _derived,
    exports,
    mttr,
    os_vulns,
    overview,
    reports,
    scan_history,
)

st.set_page_config(
    page_title="Wiz Dashboard",
    page_icon=None,
    layout="wide",
    initial_sidebar_state="expanded",
)
theme.load_css()


def _sidebar_extras() -> bool:
    """Sidebar: brand, global scan trigger + freshness, density toggle, creds footer.

    Returns whether Wiz credentials are present. Runs before ``nav.run()``, so a scan
    triggered here populates session state before the active page renders — every page
    (not just OS vulnerabilities) can kick off and immediately reflect a scan.
    """
    cfg = load_wiz_config()
    has_creds = bool(cfg.get("wiz_client_id") and cfg.get("wiz_client_secret"))

    # Seed the density toggle from the URL (?dense=1) before the widget instantiates so
    # the preference survives a browser reload.
    if "dense" not in st.session_state:
        st.session_state["dense"] = st.query_params.get("dense") == "1"

    run = refresh = False
    with st.sidebar:
        st.markdown(
            '<div class="sidebar-brand">Wiz Dashboard'
            '<div class="sub">Security observability</div></div>',
            unsafe_allow_html=True,
        )
        # Global scan trigger — the same scan.run_scan the OS page calls (one writer of
        # the os_* session state), reachable from every page.
        with st.container(horizontal=True):
            run = st.button("Run scan", type="primary", key="sidebar_run")
            refresh = st.button("Refresh", key="sidebar_refresh")
        # Placeholder filled AFTER the scan below, so the freshness line reflects the run
        # that may happen this same pass (rendering it inline here would lag by one click).
        freshness = st.empty()

        # Dry-run sample shape — only meaningful without credentials (live ignores it).
        # "Grouped" mirrors the real grouped-by-asset API response (severity counts only);
        # "Flat" uses the per-finding sample so MTTR / SLA / ledger demo offline. Stored as
        # st.session_state["dry_run_shape"] and read by scan.run_scan on the next scan.
        if not has_creds:
            st.session_state.setdefault("dry_run_shape", "grouped")
            # Let other views move this toggle (e.g. the grouped page's "Show individual
            # findings" button requests "flat"). The page can't set the widget key
            # directly — this sidebar widget is built before the page runs — so it stashes
            # a cross-run flag we consume here, deleting the widget key so `default=` re-applies.
            pending = st.session_state.pop("_pending_dry_run_shape", None)
            if pending in ("grouped", "flat"):
                st.session_state["dry_run_shape"] = pending
                st.session_state.pop("dry_run_shape_label", None)
            shape_label = st.segmented_control(
                "Dry-run sample",
                options=["Grouped (realistic)", "Flat (MTTR demo)"],
                default="Grouped (realistic)"
                if st.session_state["dry_run_shape"] == "grouped"
                else "Flat (MTTR demo)",
                key="dry_run_shape_label",
                help="Without credentials the dashboard uses sample data. **Grouped** "
                "mirrors the real Wiz response (per-asset severity counts). **Flat** uses "
                "per-finding sample data so MTTR, SLA and the ledger populate. Pick a shape, "
                "then **Run scan**.",
            )
            st.session_state["dry_run_shape"] = (
                "flat" if shape_label == "Flat (MTTR demo)" else "grouped"
            )

        dense = st.toggle(
            "Compact density",
            key="dense",
            help="Tighten table row height and metric padding to fit more on screen. "
            "Your choice is remembered via the URL (?dense=1).",
        )

        pill = (
            '<span class="status-pill status-ok">Credentials loaded</span>'
            if has_creds
            else '<span class="status-pill status-warn">No credentials</span>'
        )
        st.markdown(f'<div class="sidebar-footer">{pill}</div>', unsafe_allow_html=True)

    st.query_params["dense"] = "1" if dense else "0"
    theme.apply_density(dense)

    # Run AFTER the sidebar renders (so the scan's st.status progress appears in the main
    # area, where the data lands) and BEFORE nav.run() (so the active page sees the data).
    if run or refresh:
        scan.run_scan(force=refresh, has_creds=has_creds)

    # Freshness line: prefer this session's scan; otherwise summarise the durable base's
    # last scan so a page rendered from saved data doesn't falsely read "No scan yet".
    meta = st.session_state.get("last_scan_meta")
    scans = None if meta else _derived.ledger_scans_cached()
    freshness.caption(scan.freshness_caption(meta, scans))

    return has_creds


def main() -> None:
    st.session_state["has_creds"] = _sidebar_extras()

    # Build the Page objects once and share them so consumer pages (Overview) can render
    # st.page_link to them. OS vulnerabilities stays the default landing page; existing
    # url_path deep-links are preserved.
    pages = {
        "Overview": st.Page(
            overview.page, title="Overview", icon=":material/dashboard:", url_path="overview"
        ),
        "OS vulnerabilities": st.Page(
            os_vulns.page,
            title="OS vulnerabilities",
            icon=":material/dns:",
            url_path="wiz_os",
            default=True,
        ),
        "MTTR & SLA": st.Page(
            mttr.page, title="MTTR & SLA", icon=":material/trending_up:", url_path="mttr"
        ),
        "Scan History": st.Page(
            scan_history.page,
            title="Scan History",
            icon=":material/history:",
            url_path="scan_history",
        ),
        "Reports": st.Page(
            reports.page, title="Reports", icon=":material/bar_chart:", url_path="reports"
        ),
        "Exports": st.Page(
            exports.page, title="Exports", icon=":material/download:", url_path="exports"
        ),
    }
    st.session_state["_pages"] = pages

    nav = st.navigation(
        {
            "": [pages["Overview"]],
            "Security": [
                pages["OS vulnerabilities"],
                pages["MTTR & SLA"],
                pages["Scan History"],
            ],
            "Data": [pages["Reports"], pages["Exports"]],
        }
    )
    nav.run()


main()
