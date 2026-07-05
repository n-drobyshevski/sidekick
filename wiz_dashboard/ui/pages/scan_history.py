"""Scan History page: the durable base of vulnerabilities tracked across scans.

A consumer page (like MTTR / Reports): it reads the SQLite ledger that every scan writes
to (via ``ui.scan._persist_scan``) and never fetches on its own. This is where the saved
scans, the deduplicated vulnerability base, and the lifecycle-derived MTTR live — the
data that makes MTTR correct over time.
"""

import logging

import pandas as pd
import streamlit as st

from wiz_dashboard.config import SEVERITY_COLORS, SEVERITY_GLYPHS, SEVERITY_ORDER
from wiz_dashboard.data import ledger
from wiz_dashboard.domain import domain_rules
from wiz_dashboard.domain.formatting import format_duration
from wiz_dashboard.domain.severity import normalize_severity, normalize_severity_series
from wiz_dashboard.ui import charts
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui.pages import _derived

logger = logging.getLogger(__name__)

_CVE_RE = r"CVE-\d{4}-\d+"

# Lifecycle-first column order for the base table (only those present are shown).
_BASE_PREFERRED = [
    "severity", "cve", "asset_name", "asset_type", "cloud", "domain", "status",
    "first_seen", "resolved_at", "age_days", "mttr_days",
    "resolution_src", "reopened_count", "last_seen",
]
_BASE_LABELS = {
    "asset_name": "Asset", "asset_type": "Type", "cloud": "Cloud", "domain": "Domain",
    "status": "Status", "resolution_src": "Resolved via", "reopened_count": "Reopened",
    "last_seen": "Last seen",
}


def page():
    ui.render_page_header(
        "Scan History",
        "Durable base of vulnerabilities tracked across scans — the source of correct MTTR",
    )

    scope = _derived.display_scope()
    scans = _derived.ledger_scans_cached()
    items, rules_version = _derived.domains_config()
    # Warm the shared base cache HERE, serially: the KPI and base-table fragments
    # below run on parallel threads and both need it — one page-scope read turns
    # their getter calls into hits instead of two concurrent cold misses.
    if items:
        _derived.ledger_base_domains_cached(scope, rules_version)
    else:
        _derived.ledger_base_cached(scope)

    if scans is None or scans.empty:
        ui.empty_state(
            "No scans saved yet",
            "Run a scan from the sidebar or the **OS vulnerabilities** page — every scan "
            "is saved here and reconciled into the vulnerability base.",
        )
        return

    if scope:
        st.caption(
            f"Showing {' + '.join(s.title() for s in scope)} — KPIs, the vulnerability "
            "base and the trends follow the display filter (Settings). The saved-scans "
            "table always lists every scan."
        )

    _kpis()

    ui.section_label("Saved scans")
    _scans_and_delete()
    # A dialog opened during a fragment rerun won't render (see the OS-page drilldown),
    # so the delete button inside the fragment stashes the selection and full-reruns;
    # the confirm dialog opens here, at app scope. pop (not get): an X-dismissal must
    # not reopen the dialog on the next rerun.
    pending = st.session_state.pop("sh_delete_pending", None)
    if pending:
        _confirm_delete(scans, pending)

    ui.section_label("Vulnerability base (ledger)")
    _base_table()

    _trend_charts()


@ui.parallel_fragment
def _scans_and_delete() -> None:
    """Saved-scans table + delete button as one fragment: row (de)selection reruns only
    this region, not the whole page. Zero-arg — the scans frame is re-read via the
    cached getter (a hit), never captured as a fragment argument. Parallel-safe: the
    only session-state write (``sh_delete_pending``) happens on a button click, i.e.
    during a sequential fragment rerun, and the confirm dialog opens from page()."""
    scans = _derived.ledger_scans_cached()
    selected = _scans_table(scans)
    _delete_controls(scans, selected)


@ui.parallel_fragment
def _trend_charts() -> None:
    """Trend charts as a parallel fragment: the ledger-trend reconstruction is the
    heaviest cold-path computation on this page, so on the full rerun right after a
    scan persist / delete / compaction it overlaps with the KPI and table sections
    instead of serializing behind them. Writes no session-state keys."""
    trend = _derived.ledger_trend_cached(_derived.display_scope())
    ui.section_label("Open vs resolved (over time)")
    charts.open_resolved_trend(trend)
    ui.section_label("MTTR trend (median over time)")
    charts.mttr_trend(trend)


@ui.parallel_fragment
def _kpis() -> None:
    """KPI band as a parallel fragment: on a full rerun its ledger-MTTR read runs
    concurrently with the other sections. Writes no session-state keys."""
    scope = _derived.display_scope()
    items, rules_version = _derived.domains_config()
    base = (
        _derived.ledger_base_domains_cached(scope, rules_version)
        if items
        else _derived.ledger_base_cached(scope)
    )
    _, overall = _derived.ledger_mttr_cached(scope)
    tracked = 0 if base is None or base.empty else len(base)
    open_n = int((base["status"] == "OPEN").sum()) if tracked else 0
    resolved_n = int((base["status"] == "RESOLVED").sum()) if tracked else 0
    median = overall.get("mttr_median") if overall else None
    ui.kpi_row(
        [
            {"label": "Tracked (all-time)", "value": f"{tracked:,}", "accent": "var(--accent)",
             "help": "Distinct vulnerabilities ever observed across all saved scans."},
            {"label": "Currently open", "value": f"{open_n:,}", "accent": SEVERITY_COLORS["HIGH"],
             "help": "Vulnerabilities still awaiting remediation."},
            {"label": "Resolved all-time", "value": f"{resolved_n:,}", "accent": "#16a34a",
             "inverse": False,
             "help": "Remediated — resolved by the API or by disappearing from a later scan."},
            {"label": "Median MTTR", "value": format_duration(median), "accent": "var(--accent)",
             "inverse": False,
             "help": "Median days from first seen to resolved, across the durable base."},
        ]
    )


def _selected_scan_ids(scans, rows) -> list:
    """Map dataframe selection row positions to ``scan_id``s, dropping any out-of-range
    index. The dataframe's selection state can outlive a delete that shrank the table,
    so a stored position may point past the current frame — that maps to no scan, never
    an ``IndexError``."""
    n = len(scans)
    ids = scans["scan_id"]
    return [ids.iloc[i] for i in (rows or []) if 0 <= i < n]


def _scans_table(scans) -> list:
    """Render the saved-scans table (multi-row selectable) and return the selected
    ``scan_id``s. Selection indices are positional in ``scans`` (newest first); the
    widget key carries a nonce so a delete (which shrinks the table) discards the now-
    stale selection instead of carrying a past-the-end index into the smaller frame."""
    cols = [c for c in ("ts", "mode", "shape", "total", "new_count", "resolved_count",
                        "reopened_count", "severities", "sealed") if c in scans.columns]
    view = scans[cols]
    if "severities" in view.columns:
        # Render the stored scope as readable text; NULL (unscoped) reads "All".
        view = view.assign(
            severities=view["severities"].map(
                lambda s: (" + ".join(x.title() for x in ledger.parse_severities(s) or ())
                           or "All")
            )
        )
    if "sealed" in view.columns:
        # Glyph + word, not color: sealed rows are part of the compacted baseline.
        view = view.assign(
            sealed=view["sealed"].map(lambda v: "🔒 Sealed" if v else "")
        )
    event = st.dataframe(
        view,
        hide_index=True,
        width="stretch",
        on_select="rerun",
        selection_mode="multi-row",
        key=f"sh_scans_{st.session_state.get('sh_scans_nonce', 0)}",
        column_config={
            "ts": st.column_config.DatetimeColumn("When", format="YYYY-MM-DD HH:mm"),
            "mode": st.column_config.TextColumn("Mode"),
            "shape": st.column_config.TextColumn("Shape"),
            "total": st.column_config.NumberColumn("Findings"),
            "new_count": st.column_config.NumberColumn("＋ New", help="First seen in this scan"),
            "resolved_count": st.column_config.NumberColumn(
                "－ Resolved", help="Resolved in this scan (incl. disappeared)"
            ),
            "reopened_count": st.column_config.NumberColumn("↺ Reopened"),
            "severities": st.column_config.TextColumn(
                "Scope", help="Severities this scan pulled from Wiz ('All' = unscoped)"
            ),
            "sealed": st.column_config.TextColumn(
                "Sealed",
                help="Part of the compacted baseline — raw archive pruned; the scan "
                     "can no longer be deleted (Settings → Data retention).",
            ),
        },
    )
    rows = (event.selection.get("rows") if event and event.selection else None) or []
    return _selected_scan_ids(scans, rows)


def _delete_controls(scans, selected_ids) -> None:
    """A primary "Delete selected" button that opens the confirm dialog.

    Sealed scans are excluded up front (with a caption saying so) — the backend would
    refuse them anyway (``SealedScanError``), but the UI shouldn't offer a delete it
    knows will be refused."""
    if not selected_ids:
        return
    if "sealed" in scans.columns:
        sealed_ids = set(scans.loc[scans["sealed"].astype(bool), "scan_id"])
        sealed_picked = [s for s in selected_ids if s in sealed_ids]
        if sealed_picked:
            st.caption(
                f"{len(sealed_picked)} selected scan(s) are sealed (compacted "
                "baseline) and can't be deleted."
            )
        selected_ids = [s for s in selected_ids if s not in sealed_ids]
        if not selected_ids:
            return
    if st.button(f"Delete selected ({len(selected_ids)})", type="primary", key="sh_delete"):
        # Stash + full rerun instead of opening the dialog here: this runs inside the
        # saved-scans fragment, and a dialog opened during a fragment rerun won't
        # render. page() pops the stash and opens the confirm at app scope.
        st.session_state["sh_delete_pending"] = list(selected_ids)
        st.rerun()


@st.dialog("Delete scans?")
def _confirm_delete(scans, selected_ids) -> None:
    st.write(
        f"Delete **{len(selected_ids)}** scan(s)? This rebuilds the vulnerability ledger "
        "and recomputes MTTR as if the scan(s) never ran."
    )
    chosen = scans[scans["scan_id"].isin(selected_ids)]
    for _, r in chosen.iterrows():
        when = r["ts"].strftime("%Y-%m-%d %H:%M") if pd.notna(r["ts"]) else str(r["scan_id"])
        total = f"{int(r['total']):,} findings" if pd.notna(r.get("total")) else "? findings"
        st.markdown(f"- **{when}** · {r['mode']} · {total}")
    c1, c2 = st.columns(2)
    if c1.button("Cancel", key="sh_del_cancel", width="stretch"):
        st.rerun()
    if c2.button("Delete", type="primary", key="sh_del_confirm", width="stretch"):
        if _perform_delete(selected_ids) is not None:
            # The delete shrank the table; bump the dataframe key so the now-stale
            # positional row-selection is discarded instead of indexing past the frame.
            st.session_state["sh_scans_nonce"] = (
                st.session_state.get("sh_scans_nonce", 0) + 1
            )
        st.rerun()


@ui.parallel_fragment
def _base_table() -> None:
    """Filter toolbar + paginated base table as one fragment: every filter / search /
    pager / download interaction reruns only this region. Zero-arg — the base is
    re-read via the cached getters (hits), never captured as a fragment argument.
    Parallel-safe: writes only its own keys (``sh_base_*`` pager, ``sh_csv_payload``),
    and only on widget interaction (sequential fragment reruns)."""
    scope = _derived.display_scope()
    items, rules_version = _derived.domains_config()
    base = (
        _derived.ledger_base_domains_cached(scope, rules_version)
        if items
        else _derived.ledger_base_cached(scope)
    )
    if base is None or base.empty:
        st.info("No vulnerabilities in the base yet — grouped-by-asset scans don't populate it.")
        return

    compacted_n = (
        int((base["asset_name"] == "(compacted)").sum())
        if "asset_name" in base.columns else 0
    )
    if compacted_n:
        st.caption(
            f"{compacted_n:,} resolved finding(s) are compacted: their timestamps, "
            "severity and CVE are exact (all stats include them), but per-asset "
            "detail and raw JSON are no longer available."
        )

    # Normalize severities once per rerun (vectorized) and reuse for both the option
    # list and the row mask below, instead of a per-row map over the whole base twice.
    norm_sev = normalize_severity_series(base["severity"])
    with st.container(horizontal=True):
        statuses = sorted(base["status"].dropna().unique().tolist())
        status_sel = st.multiselect("Status", statuses, default=statuses, key="sh_status")
        present = set(norm_sev.unique())
        sev_opts = [s for s in SEVERITY_ORDER if s in present]
        sev_sel = st.multiselect("Severity", sev_opts, default=sev_opts, key="sh_sev")
        domain_sel = []
        if "domain" in base.columns:
            # Priority order (Unassigned last), matching the OS-page filter.
            present_domains = set(base["domain"].dropna().unique())
            domain_opts = [
                n for n in domain_rules.domain_names(_derived.domains_config()[0])
                if n in present_domains
            ]
            if domain_opts:
                domain_sel = st.multiselect(
                    "Domain", domain_opts, key="sh_domain", placeholder="All"
                )
    query = st.text_input(
        "Search", key="sh_q", placeholder="Filter by CVE or asset name",
        label_visibility="collapsed",
    )

    view = base
    if status_sel:
        view = view[view["status"].isin(status_sel)]
    if sev_sel:
        view = view[norm_sev.loc[view.index].isin(sev_sel)]
    if domain_sel and "domain" in view.columns:
        view = view[view["domain"].isin(domain_sel)]
    if query:
        hay = (
            view["cve"].astype(str) + " " + view["asset_name"].astype(str)
        ).str.lower()
        view = view[hay.str.contains(query.lower(), regex=False, na=False)]

    if view.empty:
        st.info("No vulnerabilities match the current filters.")
        return

    # Slice server-side before rendering: st.dataframe re-serializes whatever frame it's
    # handed to the browser on every rerun, so the all-time base must never ship whole.
    reset_token = f"{len(base)}|{len(view)}|{view.index[0]}|{view.index[-1]}"
    page_view = ui.paginate(view, "sh_base", reset_token=reset_token)
    display, cfg = _base_display(page_view)
    st.dataframe(display, hide_index=True, width="stretch", height=460, column_config=cfg)
    st.caption(f"{len(view):,} of {len(base):,} vulnerabilities")
    ui.deferred_download(
        "Download CSV",
        lambda: view.to_csv(index=False).encode("utf-8"),
        file_name="vuln_base.csv",
        mime="text/csv",
        key="sh_csv",
        row_count=len(view),
        sig=reset_token,
    )


def _base_display(view):
    cols = [c for c in _BASE_PREFERRED if c in view.columns]
    df = view[cols].copy()
    cfg = {}
    if "severity" in df.columns:
        df["severity"] = df["severity"].map(_sev_glyph)
        cfg["severity"] = st.column_config.TextColumn("Severity")
    if "cve" in df.columns:
        nonnull = df["cve"].dropna().astype(str)
        if len(nonnull) == len(df) and nonnull.str.fullmatch(_CVE_RE, case=False).all():
            df["cve"] = "https://nvd.nist.gov/vuln/detail/" + df["cve"].astype(str)
            cfg["cve"] = st.column_config.LinkColumn(
                "CVE", help="Open on the NVD", display_text=f"({_CVE_RE})"
            )
        else:
            cfg["cve"] = st.column_config.TextColumn("CVE")
    for col, label in (("first_seen", "First seen"), ("resolved_at", "Resolved"),
                       ("last_seen", "Last seen")):
        if col in df.columns:
            cfg[col] = st.column_config.DatetimeColumn(label, format="YYYY-MM-DD")
    if "age_days" in df.columns:
        cfg["age_days"] = st.column_config.NumberColumn(
            "Age (days)", format="%.1f", help="Days open (now − first seen)."
        )
    if "mttr_days" in df.columns:
        cfg["mttr_days"] = st.column_config.NumberColumn(
            "MTTR (days)", format="%.1f", help="Days from first seen to resolved."
        )
    for col, label in _BASE_LABELS.items():
        if col in df.columns and col not in cfg:
            if col == "reopened_count":
                cfg[col] = st.column_config.NumberColumn(label)
            else:
                cfg[col] = st.column_config.TextColumn(label)
    return df, cfg


def _sev_glyph(value):
    if not isinstance(value, str) or not value:
        return value
    return f"{SEVERITY_GLYPHS.get(normalize_severity(value), '')} {value}".strip()


def _perform_delete(scan_ids):
    """Delete scans, rebuild the ledger, refresh caches, and toast. Returns the summary
    dict, or None if the rebuild was refused (surfaced as a warning)."""
    try:
        summary = ledger.delete_scans(scan_ids)
    except ledger.LedgerRebuildError as exc:
        ui.show_toast(str(exc), "warning")
        return None
    except Exception:  # noqa: BLE001 -- a locked/unwritable DB shouldn't crash the page
        logger.warning("Failed to delete scans %s", scan_ids, exc_info=True)
        ui.show_toast("Couldn't delete the selected scan(s) — the base was left unchanged.",
                      "error")
        return None
    _derived.clear_ledger_caches()
    # The shared saved-scan objects may belong to a deleted scan — drop them so no
    # session keeps serving a frame whose archive/snapshot no longer exists.
    _derived.clear_scan_resources()
    ui.show_toast(
        f"Deleted {summary['deleted']} scan(s); ledger rebuilt — "
        f"{summary['scans']} scans, {summary['tracked']:,} tracked vulns",
        "success",
    )
    return summary
