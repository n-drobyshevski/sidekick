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

import streamlit as st

from wiz_dashboard.config import SELECTABLE_SEVERITIES, SEVERITY_GLYPHS
from wiz_dashboard.data import ledger, settings
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui import scan


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
