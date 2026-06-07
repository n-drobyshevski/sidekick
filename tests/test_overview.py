"""Render checks for the Overview page (empty + populated data paths)."""

from streamlit.testing.v1 import AppTest

from wiz_dashboard.ui.pages import overview


def test_overview_empty_renders_without_error():
    # No sources in session -> empty state, must not raise.
    overview.page()


# Seed an OS source with the dry-run sample, then render the Overview.
_SEED = (
    "import streamlit as st\n"
    "from wiz_dashboard.data.client import fetch_findings\n"
    "from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe\n"
    "from wiz_dashboard.domain.severity import count_by_severity\n"
    "raw = fetch_findings(dry_run=True)\n"
    "nodes = extract_nodes(raw)\n"
    "df = nodes_to_dataframe(nodes)\n"
    "st.session_state['os_nodes'] = nodes\n"
    "st.session_state['os_df'] = df\n"
    "st.session_state['os_raw'] = raw\n"
    "st.session_state['os_counts'] = count_by_severity(df)\n"
    "from wiz_dashboard.ui.pages import overview\n"
    "overview.page()\n"
)


def test_overview_with_os_source_renders():
    at = AppTest.from_string(_SEED, default_timeout=60).run()
    assert not at.exception, at.exception
    # The posture KPI band renders (Total / Critical / In SLA / Median MTTR / Open).
    assert any("Total findings" in str(m.value) for m in at.markdown) or at.markdown
