"""Exports page: download each loaded findings source as CSV or raw JSON.

Every source that has been scanned gets its own CSV + raw-JSON download, each
stamped with export metadata. Payloads are built on demand at scale (see
``deferred_download``) — encoding a 100k-row CSV or JSON dump on every rerun is
exactly the cost this page used to pay for downloads nobody clicked.
"""

import json
from datetime import datetime, timedelta, timezone

import streamlit as st

from wiz_dashboard.data import migrate
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui import scan
from wiz_dashboard.ui.pages import _derived, _findings


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _migration_section():
    """Full-history bundle for the GAS rebuild's Data page importer.

    Reads the SQLite ledger + mttr_history.json from disk, so it renders (and stays
    downloadable) even when no findings source is loaded in this session.
    """
    counts = migrate.bundle_counts()
    ui.section_label("Migration")
    empty = counts["scans"] == 0 and counts["history"] == 0
    ui.deferred_download(
        "Download migration bundle",
        migrate.bundle_json_bytes,
        file_name=f"wiz_migration_bundle_{_stamp()[:10]}.json",
        mime="application/json",
        key="migration_bundle",
        row_count=counts["vulns"],
        sig=f"{counts['scans']}:{counts['vulns']}:{counts['episodes']}:{counts['history']}",
        disabled=empty,
    )
    st.caption(
        f"{counts['scans']:,} scans · {counts['vulns']:,} tracked vulnerabilities · "
        f"{counts['episodes']:,} resolved episodes · {counts['history']:,} MTTR history "
        "points. Full history in one file — best for small ledgers (the GAS import is a "
        "single request; very large bundles won't fit). Raw scan archives stay on this machine."
    )

    # Windowed split for large ledgers: carry the live working set + full MTTR trend into
    # GAS, keep the deep settled-and-old history as a downloadable archive.
    with st.expander("Windowed split (for large ledgers)", expanded=False):
        days = st.number_input(
            "Keep resolved history from the last N days", min_value=1, value=365, step=30,
            key="migration_split_days", disabled=empty,
            help="Open vulnerabilities and anything resolved within this window stay in the "
            "live bundle; older resolved vulns/episodes go to the archive. MTTR trend is "
            "always carried in full.",
        )
        cutoff_iso = (
            datetime.now(timezone.utc) - timedelta(days=int(days))
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        slim_open = st.checkbox(
            "Slim open vulnerabilities (recommended when GAS scans Wiz)", value=True,
            key="migration_slim_open", disabled=empty,
            help="Open vulns import as just an ID + first-seen date; your next GAS scan refills "
            "their detail and keeps the age. This can shrink the live bundle by an order of "
            "magnitude. Leave off only if GAS won't scan Wiz.",
        )
        sc = migrate.split_counts(cutoff_iso=cutoff_iso)
        stamp = _stamp()[:10]
        sig = (f"{int(days)}:{int(slim_open)}:{sc['live_vulns']}:{sc['archive_vulns']}:"
               f"{sc['live_episodes']}:{sc['archive_episodes']}:{sc['history']}")
        st.caption(
            f"**Live bundle** — {sc['scans']:,} scans · {sc['live_vulns']:,} vulnerabilities · "
            f"{sc['live_episodes']:,} recent episodes · {sc['history']:,} MTTR points"
            + (" (open vulns slimmed to ID + first-seen)." if slim_open else ".")
            + f" **Archive** — {sc['archive_vulns']:,} settled vulnerabilities · "
            f"{sc['archive_episodes']:,} old episodes."
        )
        ui.deferred_download(
            "Download live bundle (import this on GAS)",
            lambda: migrate.live_bundle_json_bytes(cutoff_iso=cutoff_iso, slim_open=slim_open),
            file_name=f"wiz_migration_live_{stamp}.json",
            mime="application/json",
            key="migration_live",
            row_count=sc["live_vulns"],
            sig=sig,
            disabled=empty,
        )
        ui.deferred_download(
            "Download full-history archive (.json.gz — keep for records)",
            lambda: migrate.archive_bundle_gz_bytes(cutoff_iso=cutoff_iso),
            file_name=f"wiz_migration_archive_{stamp}.json.gz",
            mime="application/gzip",
            key="migration_archive",
            row_count=sc["archive_vulns"],
            sig=sig,
            disabled=empty or sc["archive_vulns"] + sc["archive_episodes"] == 0,
        )


def page():
    ui.render_page_header("Exports", "Download any loaded findings source as CSV or JSON")

    _migration_section()

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
