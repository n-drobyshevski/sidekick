"""Render checks for the Reports / Exports pages.

Bare-mode covers the empty (pre-scan) path; an AppTest script covers the full
data path (report preview + download, per-source CSV/JSON exports).
"""

from streamlit.testing.v1 import AppTest

from wiz_dashboard.ui.pages import exports, reports


def test_empty_pages_render_without_error():
    # No scan in session -> each page shows its empty state without raising.
    reports.page()
    exports.page()


# A reusable preamble that seeds session state with dry-run sample data for a source,
# then we render the page(s) under test.
_SEED = (
    "import streamlit as st\n"
    "from wiz_dashboard.data.client import fetch_findings\n"
    "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
    "from wiz_dashboard.domain.severity import count_by_severity\n"
    "def seed(prefix, fetch):\n"
    "    raw = fetch(dry_run=True)\n"
    "    nodes = extract_nodes(raw)\n"
    "    df = nodes_to_dataframe(nodes)\n"
    "    st.session_state[prefix + '_nodes'] = nodes\n"
    "    st.session_state[prefix + '_df'] = df\n"
    "    st.session_state[prefix + '_raw'] = raw\n"
    "    st.session_state[prefix + '_counts'] = count_by_severity(df)\n"
)


def _run(script):
    at = AppTest.from_string(_SEED + script, default_timeout=60).run()
    assert not at.exception, at.exception
    return at


def test_reports_and_exports_with_os_source():
    at = _run(
        "seed('os', fetch_findings)\n"
        "from wiz_dashboard.ui.pages import reports, exports\n"
        "reports.page()\n"
        "exports.page()\n"
    )
    # 1 report download + 1 source x (CSV + JSON) = 3 download buttons.
    assert len(at.get("download_button")) >= 3
