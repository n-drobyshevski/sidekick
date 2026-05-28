"""Wiz security dashboard — entry point.

Run with:  streamlit run app.py

Uses the native multipage API (st.navigation / st.Page). Page implementations live
in wiz_dashboard/ui/pages/; shared logic in wiz_dashboard/{config,data,domain,models}.
"""

import streamlit as st

from wiz_dashboard.config import load_wiz_config
from wiz_dashboard.ui import theme
from wiz_dashboard.ui.pages import cloud, exports, identity, os_vulns, reports

st.set_page_config(
    page_title="Wiz Dashboard",
    page_icon=None,
    layout="wide",
    initial_sidebar_state="expanded",
)
theme.load_css()


def _sidebar_extras() -> bool:
    """Brand, density toggle and credentials footer. Returns whether creds are present."""
    with st.sidebar:
        st.markdown(
            '<div class="sidebar-brand">Wiz Dashboard'
            '<div class="sub">Security observability</div></div>',
            unsafe_allow_html=True,
        )
    dense = st.sidebar.toggle(
        "Compact density", value=st.session_state.get("dense", False), key="dense"
    )

    cfg = load_wiz_config()
    has_creds = bool(cfg.get("wiz_client_id") and cfg.get("wiz_client_secret"))
    pill = (
        '<span class="status-pill status-ok">Credentials loaded</span>'
        if has_creds
        else '<span class="status-pill status-warn">No credentials</span>'
    )
    st.sidebar.markdown(
        f'<div class="sidebar-footer">{pill}</div>', unsafe_allow_html=True
    )
    theme.apply_density(dense)
    return has_creds


def main() -> None:
    st.session_state["has_creds"] = _sidebar_extras()

    nav = st.navigation(
        {
            "Security": [
                st.Page(
                    os_vulns.page,
                    title="OS vulnerabilities",
                    url_path="wiz_os",
                    default=True,
                ),
                st.Page(
                    cloud.page, title="Cloud misconfigurations", url_path="cloud"
                ),
                st.Page(identity.page, title="Identity findings", url_path="identity"),
            ],
            "Data": [
                st.Page(reports.page, title="Reports", url_path="reports"),
                st.Page(exports.page, title="Exports", url_path="exports"),
            ],
        }
    )
    nav.run()


main()
