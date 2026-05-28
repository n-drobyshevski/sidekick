"""Exports page: download the currently loaded findings as CSV or raw JSON."""

import json

import streamlit as st

from wiz_dashboard.ui import components as ui


def page():
    ui.render_page_header("Exports", "Download the loaded findings as CSV or JSON")

    df = st.session_state.get("os_df")
    raw = st.session_state.get("os_raw")

    if df is None or df.empty:
        ui.empty_state(
            "Nothing to export",
            "Run a scan on the <b>OS vulnerabilities</b> page first.",
        )
        return

    clean = df[[c for c in df.columns if not c.startswith("_")]]
    ui.section_label("Download")
    c1, c2 = st.columns(2)
    with c1:
        st.download_button(
            "Download CSV",
            data=clean.to_csv(index=False).encode("utf-8"),
            file_name="os_findings.csv",
            mime="text/csv",
            width="stretch",
        )
    with c2:
        st.download_button(
            "Download raw JSON",
            data=json.dumps(raw, indent=2, default=str, ensure_ascii=False).encode("utf-8"),
            file_name="os_findings.json",
            mime="application/json",
            width="stretch",
            disabled=raw is None,
        )

    ui.section_label("Preview")
    st.dataframe(clean, width="stretch", hide_index=True, height=400)
    st.caption(f"{len(clean):,} findings ready to export.")
