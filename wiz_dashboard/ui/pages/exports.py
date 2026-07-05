"""Exports page: download each loaded findings source as CSV or raw JSON.

Every source that has been scanned gets its own CSV + raw-JSON download, each
stamped with export metadata. Payloads are built on demand at scale (see
``deferred_download``) — encoding a 100k-row CSV or JSON dump on every rerun is
exactly the cost this page used to pay for downloads nobody clicked.
"""

import json
from datetime import datetime, timezone

import streamlit as st

from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui import scan
from wiz_dashboard.ui.pages import _derived, _findings


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def page():
    ui.render_page_header("Exports", "Download any loaded findings source as CSV or JSON")

    sources = _findings.loaded_sources()
    if not sources:
        ui.empty_state(
            "Nothing to export",
            "Run a scan on the **OS vulnerabilities** page first.",
        )
        return

    if _derived.display_scope():
        st.caption(
            "CSV exports follow the display filter (Settings). Raw JSON is always the "
            "verbatim API payload of the last scan."
        )

    for label, info in sources.items():
        df, raw, prefix = info["df"], info["raw"], info["prefix"]
        clean = df[[c for c in df.columns if not str(c).startswith("_")]]
        token = info["sig"]  # display-scoped token from loaded_sources

        def build_csv(clean=clean):
            return clean.to_csv(index=False).encode("utf-8")

        # On the start-up fast path the raw envelope is deferred (os_raw is None while
        # its archive is loadable) — the builder hydrates it on click via ensure_raw,
        # so visiting this page never forces the 100MB-scale JSON parse.
        raw_available = raw is not None or (
            prefix == "os" and bool(st.session_state.get("os_raw_path"))
        )

        def build_json(raw=raw, label=label, prefix=prefix):
            if raw is None and prefix == "os":
                raw = scan.ensure_raw()
            # exported_at is stamped when the payload is actually built.
            payload = {"exported_at": _stamp(), "source": label, "findings": raw}
            return json.dumps(payload, indent=2, default=str, ensure_ascii=False).encode("utf-8")

        ui.section_label(label)
        c1, c2 = st.columns(2)
        with c1:
            ui.deferred_download(
                "Download CSV",
                build_csv,
                file_name=f"{prefix}_findings.csv",
                mime="text/csv",
                width="stretch",
                key=f"{prefix}_export_csv",
                row_count=len(clean),
                sig=token,
            )
        with c2:
            ui.deferred_download(
                "Download raw JSON",
                build_json,
                file_name=f"{prefix}_findings.json",
                mime="application/json",
                width="stretch",
                disabled=not raw_available,
                key=f"{prefix}_export_json",
                row_count=len(clean),
                sig=token,
            )
        st.caption(f"{len(clean):,} findings · {len(clean.columns)} columns.")
