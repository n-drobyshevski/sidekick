"""Settings page: the severity scope for Wiz pulls and for what the UI displays.

Two persisted controls (``data/settings.json`` via ``data.settings``):

* **Scan scope** — which severities every scan pulls from the Wiz API (server-side
  ``filterBy`` → smaller payloads, faster scans). Applies on the next full scan.
* **Display filter** — which of the pulled severities every page and analytic shows
  (hide-everywhere semantics; always a subset of the scan scope).

Guardrails: each control needs at least one severity; turning Critical off is allowed
but carries an explicit caution. Consequences are stated in place — narrowing the scan
scope pauses lifecycle tracking for the excluded severities (they are kept OPEN in the
ledger, never falsely resolved; see ``domain.reconcile``).
"""

import logging

import streamlit as st

from wiz_dashboard.config import (
    DEFAULT_RETENTION_DAYS,
    RETENTION_MIN_DAYS,
    SELECTABLE_SEVERITIES,
    SEVERITY_GLYPHS,
)
from wiz_dashboard.data import ledger, settings
from wiz_dashboard.domain.formatting import format_bytes
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui import scan
from wiz_dashboard.ui.pages import _derived, _domains_section

logger = logging.getLogger(__name__)


def _sev_option_label(sev: str) -> str:
    # Glyph + text: two non-color signals, matching the app's severity convention.
    return f"{SEVERITY_GLYPHS.get(sev, '')} {sev.title()}".strip()


def _badges(scope) -> str:
    return "".join(ui.severity_badge_html(s.title()) for s in scope)


def _pending_scope_notice(saved_fetch) -> None:
    """When the saved scan scope differs from the scope of the latest saved flat scan,
    say the on-screen data was measured differently — and how to fix it."""
    row = ledger.load_latest_flat_scan_row()
    if row is None:
        return
    scanned = ledger.parse_severities(row.get("severities"))
    saved = None if settings.api_severity_filter(saved_fetch) is None else tuple(saved_fetch)
    if saved != scanned:
        st.info(
            "The data currently loaded was scanned with a different scope "
            f"({scan.scope_label(scanned) or 'all severities'}). "
            "Run a full scan to apply the saved scan scope.",
            icon=":material/info:",
        )


def page():
    ui.render_page_header(
        "Settings", "What the dashboard pulls from Wiz and shows on every page."
    )

    if st.session_state.pop("_settings_saved_toast", False):
        ui.show_toast("Settings saved — the scan scope applies on the next full scan",
                      "success")
    compact_toast = st.session_state.pop("_settings_compact_toast", None)
    if compact_toast:
        ui.show_toast(compact_toast, "success")
    purge_toast = st.session_state.pop("_settings_purge_toast", None)
    if purge_toast:
        ui.show_toast(purge_toast, "success")

    _severity_scope()

    # ---- Domains (rule-based triage) ------------------------------------------------ #
    _domains_section.render()

    # ---- Data retention ------------------------------------------------------------ #
    _retention()
    # A dialog opened during a fragment rerun won't render, so the "Compact now" button
    # inside the retention fragment stashes the window and full-reruns; the confirm
    # opens here, at app scope. pop (not get): an X-dismissal must not reopen it.
    pending = st.session_state.pop("_compact_pending", None)
    if pending is not None:
        _confirm_compact(pending)

    # ---- Purge by severity --------------------------------------------------------- #
    _purge_by_severity()
    purge_pending = st.session_state.pop("_purge_pending", None)
    if purge_pending:
        _confirm_purge(purge_pending)

    # ---- Saved state -------------------------------------------------------------- #
    ui.section_label("Saved settings")
    st.markdown(
        f"<div>Pulling from Wiz:&nbsp; {_badges(settings.get_fetch_severities())}</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        "<div>Showing in the interface:&nbsp; "
        f"{_badges(settings.get_display_severities())}</div>",
        unsafe_allow_html=True,
    )
    if st.session_state.get("has_creds") is False:
        st.caption(
            "Dry-run mode: the scan scope filters the bundled sample data, so you can "
            "preview the behavior without credentials."
        )


@st.fragment
def _severity_scope() -> None:
    """Scan-scope pills, display pills and Save as ONE fragment: the display pills'
    options derive from the scan-scope selection, so the two must rerun together —
    but toggling a pill no longer reruns the whole script. Save's ``st.rerun()``
    (app scope by default) still propagates the persisted change everywhere."""
    saved_fetch = settings.get_fetch_severities()
    saved_display = settings.get_display_severities()
    _pending_scope_notice(saved_fetch)

    # ---- Scan scope --------------------------------------------------------------- #
    ui.section_label("Scan scope")
    st.caption(
        "Severities pulled from the Wiz API on every scan. Fewer severities means "
        "faster scans and smaller payloads. Takes effect on the next full scan."
    )
    fetch_sel = st.pills(
        "Severities to pull",
        options=list(SELECTABLE_SEVERITIES),
        default=[s for s in saved_fetch],
        selection_mode="multi",
        format_func=_sev_option_label,
        key="settings_fetch_sevs",
        label_visibility="collapsed",
    )
    fetch_sel = list(fetch_sel or [])
    st.caption(
        "Narrowing the scope pauses lifecycle tracking for the excluded severities: "
        "they stay open in the scan history — never falsely marked resolved — and "
        "MTTR/trend analytics stop advancing for them until they're scanned again."
    )
    if not fetch_sel:
        st.warning("Select at least one severity — a scan needs something to pull.",
                   icon="⚠️")
    elif "CRITICAL" not in fetch_sel:
        st.warning(
            "Critical findings will not be pulled. They will not appear anywhere in "
            "the dashboard until you re-enable them and run a scan.",
            icon="⚠️",
        )

    # ---- Display filter ----------------------------------------------------------- #
    ui.section_label("Display")
    st.caption(
        "Which of the pulled severities every page and metric shows. Hidden severities "
        "stay in the scan history and return the moment they're re-enabled."
    )
    display_options = [s for s in SELECTABLE_SEVERITIES if s in fetch_sel]
    display_sel = []
    if display_options:
        # The widget's stored selection may reference severities just removed from the
        # scan scope above — prune BEFORE the widget is instantiated.
        stored = st.session_state.get("settings_display_sevs")
        if stored is not None:
            st.session_state["settings_display_sevs"] = [
                s for s in stored if s in display_options
            ]
        display_sel = st.pills(
            "Severities to show",
            options=display_options,
            default=[s for s in saved_display if s in display_options],
            selection_mode="multi",
            format_func=_sev_option_label,
            key="settings_display_sevs",
            label_visibility="collapsed",
        )
        display_sel = list(display_sel or [])
        if not display_sel:
            st.warning("Select at least one severity to show.", icon="⚠️")
        elif "CRITICAL" in fetch_sel and "CRITICAL" not in display_sel:
            st.warning(
                "Critical findings will be pulled but hidden from every page and "
                "metric until re-enabled here.",
                icon="⚠️",
            )
    else:
        st.caption("Pick at least one severity to pull first.")

    # ---- Save --------------------------------------------------------------------- #
    invalid = not fetch_sel or not display_sel
    if st.button("Save settings", type="primary", key="settings_save", disabled=invalid,
                 icon=":material/save:"):
        settings.set_fetch_severities(tuple(fetch_sel))
        settings.set_display_severities(tuple(display_sel))
        st.session_state["_settings_saved_toast"] = True
        st.rerun()


@st.fragment
def _retention() -> None:
    """Retention toggles + Save/Compact as one fragment. The compact confirm is a
    dialog, which can't open during a fragment rerun — "Compact now" stashes the
    window in ``_compact_pending`` and full-reruns; ``page()`` opens the dialog."""
    ui.section_label("Data retention")
    st.caption(
        "Scans older than the retention window are **sealed**: every chart and "
        "MTTR/SLA number stays exact, but per-asset detail, raw scan JSON and the "
        "ability to delete those scans are permanently removed. The two most recent "
        "full scans always stay."
    )
    saved_days = settings.get_retention_days()
    enabled = st.toggle(
        "Compact old data", value=saved_days is not None, key="settings_retention_on"
    )
    days = st.number_input(
        "Retention window (days)",
        min_value=RETENTION_MIN_DAYS,
        max_value=3650,
        value=int(saved_days or DEFAULT_RETENTION_DAYS),
        step=30,
        key="settings_retention_days",
        disabled=not enabled,
    )
    auto = st.toggle(
        "Compact automatically after each scan",
        value=settings.get_auto_compact(),
        key="settings_auto_compact",
        disabled=not enabled,
        help="Runs right after a scan is saved; does nothing until history is older "
             "than the retention window.",
    )
    with st.container(horizontal=True):
        if st.button("Save retention", key="settings_retention_save",
                     icon=":material/save:"):
            settings.set_retention_days(int(days) if enabled else None)
            settings.set_auto_compact(bool(auto))
            ui.show_toast("Retention settings saved", "success")
        if st.button("Compact now", key="settings_compact_now", disabled=not enabled,
                     icon=":material/compress:"):
            st.session_state["_compact_pending"] = int(days)
            st.rerun()


@st.dialog("Compact old data?")
def _confirm_compact(days: int) -> None:
    """Dry-run preview → explicit confirm → real compaction with a reclaimed-space toast.

    The preview runs the identical selection + checkpoint replay as the real thing
    (``dry_run=True``), so the numbers the user confirms are exact, not estimates.
    """
    try:
        preview = ledger.compact_ledger(days, dry_run=True)
    except ledger.LedgerRebuildError as exc:
        st.error(str(exc))
        if st.button("Close", key="settings_compact_close"):
            st.rerun()
        return
    if preview["no_op"]:
        st.info(
            f"Nothing to compact — no sealable scans are older than {days} days "
            "(the two most recent full scans always stay)."
        )
        if st.button("Close", key="settings_compact_close"):
            st.rerun()
        return
    st.write(
        f"**{preview['scans_sealed']}** scan(s) will be sealed and "
        f"**{preview['episodes_created']}** closed finding(s) rolled up into the "
        f"compacted baseline, pruning {preview['observations_pruned']:,} observation "
        f"row(s) and about {format_bytes(preview['archive_bytes_freed'])} of archives. "
        "MTTR, SLA and every trend stay exactly the same."
    )
    st.warning(
        "Per-asset detail and raw JSON for the sealed scans are removed permanently, "
        "and sealed scans can no longer be deleted from the history.",
        icon="⚠️",
    )
    c1, c2 = st.columns(2)
    if c1.button("Cancel", key="settings_compact_cancel", width="stretch"):
        st.rerun()
    if c2.button("Compact", type="primary", key="settings_compact_confirm",
                 width="stretch"):
        try:
            result = ledger.compact_ledger(days)
        except ledger.LedgerRebuildError as exc:
            ui.show_toast(str(exc), "warning")
            st.rerun()
            return
        except Exception:  # noqa: BLE001 -- a locked DB shouldn't crash the page
            logger.warning("Compaction failed", exc_info=True)
            ui.show_toast("Compaction failed — the base was left unchanged.", "error")
            st.rerun()
            return
        _derived.clear_ledger_caches()
        freed = result["archive_bytes_freed"] + result["db_bytes_freed"]
        st.session_state["_settings_compact_toast"] = (
            f"Compacted {result['scans_sealed']} scan(s) — "
            f"{result['episodes_created']} closed finding(s) rolled up, "
            f"{format_bytes(freed)} reclaimed. Stats verified identical."
        )
        st.rerun()


@st.fragment
def _purge_by_severity() -> None:
    """Pick severities to erase, then Purge — one fragment. Like "Compact now", the
    button stashes the selection and full-reruns; ``page()`` opens the confirm dialog at
    app scope (a dialog can't open during a fragment rerun)."""
    ui.section_label("Purge by severity")
    st.caption(
        "Permanently erase whole severity classes from storage — every stored "
        "vulnerability of the selected severities, across the ledger, the compacted "
        "baseline and the raw scan archives. Use it to keep only the severities worth "
        "retaining (e.g. purge everything below Critical). Unlike compacting, this is "
        "**lossy**: MTTR, SLA and every trend recompute without the removed severities."
    )
    remove = st.pills(
        "Severities to remove",
        options=list(SELECTABLE_SEVERITIES),
        default=[],
        selection_mode="multi",
        format_func=_sev_option_label,
        key="settings_purge_sevs",
        label_visibility="collapsed",
    )
    remove = list(remove or [])
    keep = [s for s in SELECTABLE_SEVERITIES if s not in remove]
    if remove:
        st.markdown(
            f"<div>After purging, the base keeps:&nbsp; {_badges(keep)}"
            "&nbsp; plus any unclassified findings.</div>",
            unsafe_allow_html=True,
        )
    all_selected = not keep
    if all_selected:
        st.warning("Keep at least one severity — a purge can't empty the whole base.",
                   icon="⚠️")
    if st.button("Purge now", key="settings_purge_now", icon=":material/delete_sweep:",
                 disabled=not remove or all_selected):
        st.session_state["_purge_pending"] = list(remove)
        st.rerun()


@st.dialog("Purge severities from storage?")
def _confirm_purge(severities) -> None:
    """Dry-run preview → explicit confirm → real purge. The preview reads and filters
    every archive, so the counts the user confirms are exact."""
    try:
        preview = ledger.purge_severities(severities, dry_run=True)
    except ledger.LedgerRebuildError as exc:
        st.error(str(exc))
        if st.button("Close", key="settings_purge_close"):
            st.rerun()
        return
    labels = ", ".join(s.title() for s in preview["severities"])
    if preview["no_op"]:
        st.info(f"Nothing to purge — no stored vulnerabilities have severity {labels}.")
        if st.button("Close", key="settings_purge_close"):
            st.rerun()
        return
    st.write(
        f"Permanently remove **{labels}** from storage: "
        f"**{preview['vulns_removed']:,}** vulnerability row(s), "
        f"**{preview['episodes_removed']:,}** compacted finding(s) and "
        f"**{preview['observations_removed']:,}** observation(s), rewriting "
        f"**{preview['scans_rewritten']}** raw scan archive(s) and freeing about "
        f"{format_bytes(preview['archive_bytes_freed'])}."
    )
    st.warning(
        "This is permanent and lossy: the removed findings are erased from the raw "
        "archives, and MTTR, SLA and every trend recompute without these severities. "
        "Unlike compacting, the numbers WILL change.",
        icon="⚠️",
    )
    c1, c2 = st.columns(2)
    if c1.button("Cancel", key="settings_purge_cancel", width="stretch"):
        st.rerun()
    if c2.button("Purge", type="primary", key="settings_purge_confirm", width="stretch"):
        try:
            result = ledger.purge_severities(severities)
        except ledger.LedgerRebuildError as exc:
            ui.show_toast(str(exc), "warning")
            st.rerun()
            return
        except Exception:  # noqa: BLE001 -- a locked DB shouldn't crash the page
            logger.warning("Purge failed", exc_info=True)
            ui.show_toast("Purge failed — storage was left unchanged.", "error")
            st.rerun()
            return
        _derived.clear_ledger_caches()
        # Archives and parsed-frame snapshots changed on disk — drop any shared handles.
        _derived.clear_scan_resources()
        freed = result["archive_bytes_freed"] + result["db_bytes_freed"]
        st.session_state["_settings_purge_toast"] = (
            f"Purged {labels} — {result['vulns_removed']:,} vuln(s) removed, "
            f"{format_bytes(freed)} reclaimed."
        )
        st.rerun()
