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

    # ---- Domains (rule-based triage) ------------------------------------------------ #
    _domains_section.render()

    # ---- Data retention ------------------------------------------------------------ #
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
            _confirm_compact(int(days))

    # ---- Saved state -------------------------------------------------------------- #
    ui.section_label("Saved settings")
    st.markdown(
        f"<div>Pulling from Wiz:&nbsp; {_badges(saved_fetch)}</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        f"<div>Showing in the interface:&nbsp; {_badges(saved_display)}</div>",
        unsafe_allow_html=True,
    )
    if st.session_state.get("has_creds") is False:
        st.caption(
            "Dry-run mode: the scan scope filters the bundled sample data, so you can "
            "preview the behavior without credentials."
        )


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
