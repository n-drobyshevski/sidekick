"""Exports page: download each loaded findings source as CSV or raw JSON.

Every source that has been scanned gets its own CSV + raw-JSON download, each
stamped with export metadata.
"""

import json
from datetime import datetime, timezone

import streamlit as st

from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui.pages import _findings


def page():
    ui.render_page_header("Exports", "Download any loaded findings source as CSV or JSON")

    sources = _findings.loaded_sources()
    if not sources:
        ui.empty_state(
            "Nothing to export",
            "Run a scan on the **OS vulnerabilities** page first.",
        )
        return

    exported_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for label, info in sources.items():
        df, raw, prefix = info["df"], info["raw"], info["prefix"]
        clean = df[[c for c in df.columns if not str(c).startswith("_")]]

        ui.section_label(label)
        c1, c2 = st.columns(2)
        with c1:
            st.download_button(
                "Download CSV",
                data=clean.to_csv(index=False).encode("utf-8"),
                file_name=f"{prefix}_findings.csv",
                mime="text/csv",
                width="stretch",
                key=f"{prefix}_export_csv",
            )
        with c2:
            payload = {"exported_at": exported_at, "source": label, "findings": raw}
            st.download_button(
                "Download raw JSON",
                data=json.dumps(payload, indent=2, default=str, ensure_ascii=False).encode("utf-8"),
                file_name=f"{prefix}_findings.json",
                mime="application/json",
                width="stretch",
                disabled=raw is None,
                key=f"{prefix}_export_json",
            )
        st.caption(f"{len(clean):,} findings · {len(clean.columns)} columns · exported_at {exported_at}.")
