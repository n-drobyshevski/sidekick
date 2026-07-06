"""Wiz security dashboard — entry point.

Run with:  streamlit run app.py

Uses the native multipage API (st.navigation / st.Page). Page implementations live
in wiz_dashboard/ui/pages/; shared logic in wiz_dashboard/{config,data,domain,models}.
"""

from pathlib import Path

import pandas as pd
import streamlit as st

import os_vulns as os_vulns_module
from wiz_dashboard.config import load_wiz_config
from wiz_dashboard.data import ledger
from wiz_dashboard.ui import scan, theme
from wiz_dashboard.ui.pages import (
    _derived,
    exports,
    mttr,
    os_vulns,
    reports,
    scan_history,
    settings as settings_page,
)

# Brand wordmark asset, resolved package-relative (like theme.CSS_PATH) so it loads
# regardless of the directory `streamlit run` is launched from.
LOGO_PATH = Path(__file__).resolve().parent / "wiz_dashboard" / "assets" / "logo.svg"

st.set_page_config(
    page_title="Wiz Sidekick",
    page_icon=None,
    layout="wide",
    initial_sidebar_state="expanded",
)
theme.load_css()


def _sidebar_extras() -> bool:
    """Sidebar: brand wordmark (st.logo, above the nav), a Scan zone (global trigger +
    mode hint + freshness), a Display zone (sample shape + density), and the creds footer.

    Returns whether Wiz credentials are present. Runs before ``nav.run()``, so a scan
    triggered here populates session state before the active page renders — every page
    (not just OS vulnerabilities) can kick off and immediately reflect a scan.
    """
    # Brand wordmark in the sidebar header slot. st.logo renders ABOVE the auto-generated
    # nav (which owns the top of st.sidebar), so identity sits at the very top of the rail
    # and the previously-blank top gap is reclaimed; it also shows in the app's top-left.
    st.logo(str(LOGO_PATH), size="large")

    cfg = load_wiz_config()
    has_creds = bool(
        cfg.get("wiz_client_id")
        and cfg.get("wiz_client_secret")
        and os_vulns_module.WizAPIClient is not None
    )

    run = refresh = False
    with st.sidebar:
        # --- Scan: the rail's first body zone. Streamlit renders sidebar content BELOW the
        # auto nav, so "first" means first under the nav; the brand moved up to st.logo to
        # free this slot. This is the app's sole scan trigger (the OS page deliberately drops
        # its own, see os_vulns.render). No keyboard accelerator — Streamlit exposes no
        # first-class button keybinding; the placement fix shortens the mouse trip instead. ---
        st.markdown('<div class="sidebar-section-label">Scan</div>', unsafe_allow_html=True)
        # Global scan controls, reachable from every page: "Run scan" is the single writer
        # of the os_* session state (scan.run_scan — queries Wiz, saves a snapshot);
        # "Refresh" is a reader (scan.reload_scan — redraws from the last saved scan, no
        # query, no new snapshot).
        with st.container(horizontal=True):
            run = st.button(
                "Run scan",
                type="primary",
                key="sidebar_run",
                icon=":material/play_arrow:",
                use_container_width=True,
            )
            refresh = st.button(
                "Refresh",
                key="sidebar_refresh",
                icon=":material/refresh:",
                use_container_width=True,
                help="Reload the view from the last saved scan and recompute — without "
                "re-querying Wiz or recording a new snapshot. Use **Run scan** to take a "
                "fresh measurement.",
            )
        # Quick refresh: the incremental measurement — one updatedAt-filtered query merged
        # into the saved baseline. Needs a flat baseline to merge into; disabled (with the
        # reason as help text) rather than hidden so the capability stays discoverable.
        scans_df = _derived.ledger_scans_cached()
        has_flat_baseline = (
            scans_df is not None and not scans_df.empty
            and (scans_df["shape"] == "flat").any()
        )
        delta_unsupported = bool(st.session_state.get("_delta_unsupported"))
        if delta_unsupported:
            quick_help = "This Wiz tenant rejected the incremental query — use Run scan."
        elif not has_flat_baseline:
            quick_help = "Needs a baseline: run a full scan first."
        else:
            quick_help = (
                "Fetch only findings changed since the last scan and merge them into the "
                "saved baseline — seconds instead of minutes. **Cannot detect findings "
                "deleted from Wiz** (e.g. decommissioned hosts); run a full scan "
                "periodically to reconcile removals."
            )
        quick = st.button(
            "Quick refresh",
            key="sidebar_quick",
            icon=":material/update:",
            use_container_width=True,
            disabled=delta_unsupported or not has_flat_baseline,
            help=quick_help,
        )
        # Mode hint AT the action: what Run scan will do before the click (live query vs.
        # dry-run sample). Deliberately states the mode and effect ONLY — the credential
        # state belongs to the footer pill and what's loaded belongs to the freshness line
        # below, so no single fact is printed in the rail more than once.
        st.caption("Live · queries Wiz" if has_creds else "Dry-run · loads sample data")
        # Severity scope AT the action too: what the next Run scan will pull. Text-only
        # (no color semantics); silent when the scope covers everything.
        scope_text = scan.scope_label(scan.current_fetch_scope())
        if scope_text:
            st.caption(f"Scope: {scope_text}")
        # Periodic-reconciliation nudge: when the freshest data is an incremental merge,
        # say how stale the deletion picture is (quick refresh can't observe removals).
        if has_flat_baseline:
            flat_rows = scans_df[scans_df["shape"] == "flat"]
            if "incremental" in str(flat_rows.iloc[0].get("mode", "")):
                full_rows = flat_rows[
                    ~flat_rows["mode"].astype(str).str.contains("incremental", na=False)
                ]
                if not full_rows.empty and pd.notna(full_rows.iloc[0]["ts"]):
                    age = (pd.Timestamp.now(tz="UTC") - full_rows.iloc[0]["ts"]).days
                    noun = "day" if age == 1 else "days"
                    st.caption(
                        f"Last full scan {age} {noun} ago — deletions reconcile only "
                        "on full scans."
                    )
        # Placeholder filled AFTER the scan below, so the freshness line reflects the run
        # that may happen this same pass (rendering it inline here would lag by one click).
        freshness = st.empty()

        # role="status" so a screen reader announces the credential/mode state, matching how
        # DESIGN.md treats status pills; the visible text already carries the non-color signal.
        pill = (
            '<span class="status-pill status-ok" role="status" '
            'aria-label="Credential status: credentials loaded, live mode">'
            "Credentials loaded</span>"
            if has_creds
            else '<span class="status-pill status-warn" role="status" '
            'aria-label="Credential status: no credentials, running in dry-run mode with '
            'sample data">No credentials</span>'
        )
        st.markdown(f'<div class="sidebar-footer">{pill}</div>', unsafe_allow_html=True)

    # Run AFTER the sidebar renders(so the scan's st.status progress appears in the main
    # area, where the data lands) and BEFORE nav.run() (so the active page sees the data).
    # Run scan takes a NEW measurement (queries Wiz, saves a snapshot); Refresh only
    # redraws from the last saved scan (no query, no new snapshot) — two distinct jobs.
    # With neither clicked, a fresh session auto-hydrates from the last saved scan so the
    # dashboard opens on data instead of an empty state (silent; once per session).
    if run:
        scan.run_scan(force=False, has_creds=has_creds)
    elif quick:
        scan.run_incremental_scan(has_creds=has_creds)
    elif refresh:
        scan.reload_scan()
    else:
        scan.autoload_latest_scan()

    # Freshness line: prefer this session's scan; otherwise summarise the durable base's
    # last scan so a page rendered from saved data doesn't falsely read "No scan yet".
    meta = st.session_state.get("last_scan_meta")
    scans = None if meta else _derived.ledger_scans_cached()
    freshness.caption(scan.freshness_caption(meta, scans))

    return has_creds


@st.cache_resource
def _compact_legacy_archives() -> dict:
    """One-time (per process) upgrade of pre-gzip plain-JSON scan archives. Never
    raises and reads-both means it's purely a disk-space reclaim — see
    ``ledger.compact_archives``. Piggybacks the v5 domain-rule-input backfill (also
    best-effort; see ``ledger.backfill_rule_inputs``)."""
    if not ledger.needs_startup_maintenance():
        return {"compressed": 0, "skipped": 0, "failed": 0}
    counts = ledger.compact_archives()
    ledger.backfill_rule_inputs()
    return counts


def main() -> None:
    _compact_legacy_archives()
    st.session_state["has_creds"] = _sidebar_extras()

    # Build the Page objects once and share them so consumer pages can render
    # st.page_link to them. OS vulnerabilities stays the default landing page; existing
    # url_path deep-links are preserved.
    pages = {
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
        "Settings": st.Page(
            settings_page.page,
            title="Settings",
            icon=":material/settings:",
            url_path="settings",
        ),
    }
    st.session_state["_pages"] = pages

    nav = st.navigation(
        {
            "Security": [
                pages["OS vulnerabilities"],
                pages["MTTR & SLA"],
                pages["Scan History"],
            ],
            "Data": [pages["Reports"], pages["Exports"]],
            "Preferences": [pages["Settings"]],
        }
    )
    nav.run()


main()
