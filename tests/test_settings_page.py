"""AppTest checks for the Settings page + the display filter across consumer pages."""

import json

from streamlit.testing.v1 import AppTest

from wiz_dashboard import config
from wiz_dashboard.data import settings
from wiz_dashboard.ui.pages import settings as settings_page


def _settings_file():
    return config.DATA_DIR / settings.SETTINGS_FILENAME


def test_settings_page_renders_bare():
    # No ledger, no session — the page must still render (it depends on no scan data).
    settings_page.page()


def _run(script):
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    return at


def _widget(at, key):
    """Find a widget by key across the page (st.pills surfaces as ButtonGroup)."""
    return next(e for e in at.main if getattr(e, "key", None) == key)


def test_settings_page_shows_controls_and_defaults():
    at = _run(
        "from wiz_dashboard.ui.pages import settings as sp\n"
        "sp.page()\n"
    )
    assert any("Settings" in t.value for t in at.title)
    assert list(_widget(at, "settings_fetch_sevs").value) == ["CRITICAL", "HIGH"]
    assert list(_widget(at, "settings_display_sevs").value) == ["CRITICAL", "HIGH"]


def test_save_persists_both_scopes():
    at = _run(
        "from wiz_dashboard.ui.pages import settings as sp\n"
        "sp.page()\n"
    )
    _widget(at, "settings_fetch_sevs").set_value(["CRITICAL", "HIGH", "MEDIUM"])
    at.run()
    assert not at.exception
    save = [b for b in at.get("button") if b.key == "settings_save"][0]
    save.click()
    at.run()
    assert not at.exception
    on_disk = json.loads(_settings_file().read_text(encoding="utf-8"))
    assert on_disk["fetch_severities"] == ["CRITICAL", "HIGH", "MEDIUM"]
    # Display stays the saved subset (Critical+High) of the widened pull scope.
    assert on_disk["display_severities"] == ["CRITICAL", "HIGH"]


def test_empty_selection_blocks_save():
    at = _run(
        "from wiz_dashboard.ui.pages import settings as sp\n"
        "sp.page()\n"
    )
    _widget(at, "settings_fetch_sevs").set_value([])
    at.run()
    assert not at.exception
    save = [b for b in at.get("button") if b.key == "settings_save"][0]
    assert save.disabled
    assert not _settings_file().exists()  # nothing was written
    assert any("at least one severity" in w.value for w in at.warning)


def test_critical_off_warns_but_allows_save():
    at = _run(
        "from wiz_dashboard.ui.pages import settings as sp\n"
        "sp.page()\n"
    )
    _widget(at, "settings_fetch_sevs").set_value(["HIGH"])
    at.run()
    assert not at.exception
    assert any("Critical findings will not be pulled" in w.value for w in at.warning)
    save = [b for b in at.get("button") if b.key == "settings_save"][0]
    assert not save.disabled


def test_display_filter_hides_severities_on_consumer_pages():
    # Seed a full-severity frame, display-filter to Critical only: the OS page's counts
    # and the MTTR page must exclude everything else ("hide everywhere").
    at = _run(
        "import streamlit as st\n"
        "from wiz_dashboard import config\n"
        "from wiz_dashboard.data import settings\n"
        "from wiz_dashboard.data.client import fetch_findings\n"
        "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
        "settings.set_fetch_severities(config.SELECTABLE_SEVERITIES)\n"
        "settings.set_display_severities(('CRITICAL',))\n"
        "raw = fetch_findings(dry_run=True, sample_shape='flat',"
        " severities=config.SELECTABLE_SEVERITIES)\n"
        "nodes = extract_nodes(raw)\n"
        "df = nodes_to_dataframe(nodes)\n"
        "st.session_state['os_nodes'] = nodes\n"
        "st.session_state['os_df'] = df\n"
        "st.session_state['os_shape'] = 'flat'\n"
        "from wiz_dashboard.ui.pages import _derived\n"
        "shown, sig = _derived.display_view()\n"
        "st.session_state['full_n'] = len(df)\n"
        "st.session_state['shown_sevs'] = sorted(set(shown['severity']))\n"
        "from wiz_dashboard.ui.pages import os_vulns, mttr\n"
        "os_vulns.render(has_creds=False)\n"
        "mttr.page()\n"
    )
    shown = at.session_state["shown_sevs"]
    assert "CRITICAL" in shown
    assert not {"HIGH", "MEDIUM", "LOW"} & set(shown)
    # The hidden-findings caption names the active filter.
    assert any("display filter" in c.value for c in at.caption)


def test_retention_controls_render_with_defaults():
    at = _run(
        "from wiz_dashboard.ui.pages import settings as sp\n"
        "sp.page()\n"
    )
    assert _widget(at, "settings_retention_on").value is True  # retention ON by default
    assert _widget(at, "settings_retention_days").value == 180
    assert _widget(at, "settings_auto_compact").value is True
    compact = [b for b in at.get("button") if b.key == "settings_compact_now"][0]
    assert not compact.disabled


def test_save_retention_persists():
    at = _run(
        "from wiz_dashboard.ui.pages import settings as sp\n"
        "sp.page()\n"
    )
    _widget(at, "settings_retention_days").set_value(365)
    _widget(at, "settings_auto_compact").set_value(False)
    at.run()
    assert not at.exception
    [b for b in at.get("button") if b.key == "settings_retention_save"][0].click()
    at.run()
    assert not at.exception
    on_disk = json.loads(_settings_file().read_text(encoding="utf-8"))
    assert on_disk["retention_days"] == 365
    assert on_disk["auto_compact"] is False


def test_retention_off_persists_none_and_disables_compact_now():
    at = _run(
        "from wiz_dashboard.ui.pages import settings as sp\n"
        "sp.page()\n"
    )
    _widget(at, "settings_retention_on").set_value(False)
    at.run()
    assert not at.exception
    compact = [b for b in at.get("button") if b.key == "settings_compact_now"][0]
    assert compact.disabled
    [b for b in at.get("button") if b.key == "settings_retention_save"][0].click()
    at.run()
    assert not at.exception
    on_disk = json.loads(_settings_file().read_text(encoding="utf-8"))
    assert on_disk["retention_days"] is None


def test_display_view_all_hidden_yields_empty_state():
    at = _run(
        "import streamlit as st\n"
        "import pandas as pd\n"
        "from wiz_dashboard.data import settings\n"
        "settings.set_fetch_severities(('CRITICAL', 'HIGH'))\n"
        "settings.set_display_severities(('CRITICAL',))\n"
        "st.session_state['os_df'] = pd.DataFrame("
        "  {'severity': ['HIGH', 'HIGH'], 'name': ['a', 'b']})\n"
        "st.session_state['os_shape'] = 'flat'\n"
        "from wiz_dashboard.ui.pages import os_vulns\n"
        "os_vulns.render(has_creds=False)\n"
    )
    assert any("hidden by the display filter" in m.value for m in at.markdown)
