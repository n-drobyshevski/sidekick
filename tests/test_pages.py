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


def test_paginate_large_frame_slices_and_flips_pages():
    # 1,200 rows > every page size: the pager must slice server-side, page forward on
    # Next, and snap back to page 1 when the reset token (data/filters) changes.
    script = (
        "import pandas as pd\n"
        "import streamlit as st\n"
        "from wiz_dashboard.ui import components\n"
        "df = pd.DataFrame({'a': range(1200)})\n"
        "tok = st.session_state.get('tok', 't0')\n"
        "page = components.paginate(df, 'tpg', reset_token=tok)\n"
        "st.session_state['out'] = (len(page), int(page['a'].iloc[0]))\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert at.session_state["out"] == (250, 0)  # default 250/page, first page

    next_btn = [b for b in at.get("button") if b.key == "tpg_pnext"][0]
    next_btn.click()
    at.run()
    assert not at.exception, at.exception
    assert at.session_state["out"] == (250, 250)  # second page

    at.session_state["tok"] = "t1"  # simulates new data / changed filters
    at.run()
    assert at.session_state["out"] == (250, 0)  # snapped back to the first page


def test_deferred_download_two_step_above_threshold():
    # Above the row threshold the payload is built only on the Prepare click, then the
    # real download button appears; below it (covered by the exports test above) the
    # one-click button renders directly.
    script = (
        "import streamlit as st\n"
        "from wiz_dashboard.ui import components\n"
        "st.session_state['builds'] = st.session_state.get('builds', 0)\n"
        "def build():\n"
        "    st.session_state['builds'] += 1\n"
        "    return b'payload-bytes'\n"
        "components.deferred_download('Download CSV', build, file_name='x.csv',\n"
        "    mime='text/csv', key='big_dl', row_count=50_000, sig='tok1')\n"
    )
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, at.exception
    assert len(at.get("download_button")) == 0  # nothing built eagerly
    assert at.session_state["builds"] == 0

    prepare = [b for b in at.get("button") if b.key == "big_dl_prepare"][0]
    prepare.click()
    at.run()
    assert not at.exception, at.exception
    assert at.session_state["builds"] == 1  # built exactly once, on demand
    assert len(at.get("download_button")) == 1

    at.run()  # further reruns reuse the stashed payload
    assert at.session_state["builds"] == 1
    assert len(at.get("download_button")) == 1
