"""Shared scan action — the single writer of the OS findings session state.

Extracted from the OS vulnerabilities page so both that page's local "Run scan" button
and the global sidebar scan trigger run the *identical* logic: fetch + parse findings,
populate the ``os_*`` session keys, record the MTTR history snapshot, and stamp
``last_scan_meta`` for the sidebar freshness indicator. Keeping this in one place means
the scan's side-effects can never drift between the two entry points.
"""

import logging
from datetime import datetime, timezone

import pandas as pd
import streamlit as st

from wiz_dashboard.data import history, ledger
from wiz_dashboard.data.client import fetch_findings
from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe
from wiz_dashboard.domain.metrics import calculate_mttr, overall_sla_oldest
from wiz_dashboard.domain.severity import count_by_severity
from wiz_dashboard.models import schema
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui.pages import _derived

logger = logging.getLogger(__name__)


def freshness_caption(meta, scans_df) -> str:
    """The sidebar freshness line.

    Prefers this session's scan (``meta`` = ``last_scan_meta``). When there's no in-session
    scan but the durable base already holds scans, summarise its most recent one, so a page
    rendered from saved data never reads a misleading "No scan yet". Only when nothing exists
    anywhere does it prompt the first scan. ``scans_df`` is ``ledger.load_scans_df()`` (newest
    first) or ``None`` (callers skip the read when ``meta`` is present)."""
    if meta:
        return (
            f"Last scan · {meta['count']:,} findings · {meta['mode']} · {meta['at']}"
        )
    if scans_df is not None and not getattr(scans_df, "empty", True):
        row = scans_df.iloc[0]
        ts = row.get("ts")
        when = ts.strftime("%Y-%m-%d %H:%M UTC") if pd.notna(ts) else "unknown time"
        return (
            f"Saved base · {int(row.get('total', 0)):,} findings · "
            f"{row.get('mode', 'dry-run')} · last scan {when}"
        )
    return "No scan yet. Click **Run scan** to load findings."


def run_scan(force: bool, has_creds: bool, sample_shape: str | None = None) -> None:
    """Fetch findings (dry-run without creds), parse them, and store in session state.

    ``force`` clears the fetch cache first (the "Refresh" path). Writes ``os_nodes`` /
    ``os_df`` / ``os_raw`` / ``os_prev_counts`` / ``os_counts`` and ``last_scan_meta``,
    records the MTTR snapshot, and invalidates the cached history so the trend reflects
    it. Errors are surfaced with a downloadable traceback instead of crashing the page.

    ``sample_shape`` overrides the dry-run sample shape for this one fetch (e.g. the
    grouped view's "Show individual findings" button forces ``"flat"``); when ``None``
    it falls back to the sidebar's ``dry_run_shape`` selection. Ignored in live mode.
    """
    if force:
        fetch_findings.clear()
    prev = st.session_state.get("os_counts", {})
    try:
        # st.status shows the scan as discrete steps; if the block raises, Streamlit
        # marks the status "error" automatically and we surface the traceback below.
        with st.status("Running scan…", expanded=False) as status:
            status.update(label="Querying Wiz…")
            # Dry-run sample shape (ignored live): "grouped" mirrors the real API;
            # "flat" keeps per-finding MTTR/SLA data. An explicit override (e.g. the
            # degroup button) wins; otherwise use the sidebar toggle, defaulting grouped.
            shape = sample_shape or st.session_state.get("dry_run_shape", "grouped")
            # In dry-run, step a per-session sequence so each scan returns a different
            # synthetic snapshot (see data.demo) — that's what makes the scan-over-scan
            # severity badges show non-zero deltas offline. seq 0 is the unchanged baseline;
            # advance *after* reading so the first scan is the familiar SAMPLE_RESULTS.
            sample_seq = 0
            if not has_creds:
                sample_seq = int(st.session_state.get("dry_run_seq", 0))
                st.session_state["dry_run_seq"] = sample_seq + 1
            results = fetch_findings(
                dry_run=not has_creds, use_config=has_creds,
                sample_shape=shape, sample_seq=sample_seq,
            )
            if results is None:
                status.update(label="Scan produced no output", state="error")
                st.error("Scan produced no output. Check credentials or os_vulns.py.")
                return
            status.update(label="Parsing findings…")
            nodes = extract_nodes(results)
            status.update(label=f"Building table ({len(nodes):,} findings)…")
            df = nodes_to_dataframe(nodes)
            status.update(label="Computing metrics…")
            st.session_state["os_nodes"] = nodes
            st.session_state["os_df"] = df
            st.session_state["os_raw"] = results
            st.session_state["os_prev_counts"] = prev
            st.session_state["os_counts"] = count_by_severity(df)
            st.session_state["last_scan_meta"] = {
                "count": len(nodes),
                "mode": "live" if has_creds else "dry-run",
                "at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            }
            status.update(label="Saving scan & reconciling ledger…")
            _persist_scan(nodes, df, results, mode="live" if has_creds else "dry-run")
            _record_mttr_snapshot(df, st.session_state["os_counts"])
            _derived.history_cached.clear()  # a fresh snapshot was just written; reflect it
            status.update(label=f"Loaded {len(nodes):,} findings", state="complete")
    except Exception as exc:  # noqa: BLE001 -- surfaced to the user with a traceback
        ui.show_exception(exc, title="Run scan failed")
        return
    ui.show_toast(f"Loaded {len(nodes):,} findings", "success")


def _persist_scan(nodes, df, results, *, mode, db_path=None) -> None:
    """Save this scan to the durable base and reconcile the vulnerability ledger.

    Grouped-by-asset responses are archived but skip per-vuln reconciliation (no
    per-finding identity/timestamps). Mirrors ``_record_mttr_snapshot``'s contract:
    never breaks a scan — a failure here is logged and surfaced as a toast only. Sets
    ``scan_deltas`` (``{new_count, resolved_count, reopened_count}``) for the UI and
    clears the cached ledger derivations so consumer pages reflect the new scan.
    """
    try:
        if schema.is_grouped_shape(nodes):
            deltas = ledger.persist_grouped_scan(nodes, mode=mode, raw=results, db_path=db_path)
        else:
            deltas = ledger.persist_flat_scan(
                df.to_dict("records"), mode=mode, raw=results, db_path=db_path
            )
        st.session_state["scan_deltas"] = deltas
        _derived.clear_ledger_caches()
    except Exception:
        logger.warning("Failed to persist scan to ledger", exc_info=True)
        ui.show_toast("Couldn't save this scan to the durable base.", "warning")


def _record_mttr_snapshot(df, counts, filename=None) -> None:
    """Persist today's overall median MTTR + In-SLA% + oldest-open (only when a median can
    be computed). These back the MTTR-trend charts and the KPI change badges."""
    try:
        per_sev, overall = calculate_mttr(df)
        median = overall.get("mttr_median")
        if median is None or pd.isna(median):
            return
        sla_pct, oldest = overall_sla_oldest(per_sev)
        ok = history.record_snapshot(
            median_days=float(median),
            resolved=overall.get("resolved", 0),
            open_=overall.get("open", 0),
            counts=counts,
            filename=filename or history.HISTORY_FILENAME,
            sla_pct=sla_pct,
            oldest_open_days=oldest,
        )
        if not ok:
            ui.show_toast("Couldn't save the MTTR snapshot, so the trend may be stale.", "warning")
    except Exception:
        logger.warning("Failed to record MTTR snapshot", exc_info=True)
        ui.show_toast("Couldn't record the MTTR snapshot for this scan.", "warning")
