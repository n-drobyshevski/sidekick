"""AppTest smoke + dry-run scan for the new st.navigation entry point (app.py)."""

from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parent.parent / "app.py")


def _at():
    return AppTest.from_file(APP, default_timeout=30)


def test_app_loads_default_page():
    at = _at().run()
    assert not at.exception
    assert any("OS vulnerabilities" in m.value for m in at.markdown)


def test_dry_run_scan_renders_severity_cards():
    at = _at().run()
    at.button(key="os_run").click().run()
    assert not at.exception
    # The flat dry-run sample has one CRITICAL finding -> severity cards render.
    assert any("Critical" in m.value for m in at.markdown)


def test_dry_run_scan_then_exports_has_data():
    at = _at().run()
    at.button(key="os_run").click().run()
    assert not at.exception
    assert "os_df" in at.session_state
    df = at.session_state["os_df"]
    assert not df.empty


def test_finding_dialog_body_renders():
    # AppTest can't click a canvas dataframe row, but it can run the dialog body.
    script = (
        "from wiz_dashboard.ui.pages.os_vulns import _finding_dialog\n"
        "_finding_dialog("
        "{'name': 'CVE-2026-1', 'severity': 'CRITICAL', "
        "'vulnerableAsset.name': 'vm-sample', 'fixedVersion': '1.2.3'}, "
        "{'id': 'n0', 'severity': 'CRITICAL'})\n"
    )
    at = AppTest.from_string(script, default_timeout=30).run()
    assert not at.exception
