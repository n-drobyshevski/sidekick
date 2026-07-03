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
from wiz_dashboard.data.transform import extract_nodes, nodes_to_dataframe, coerce_results
from wiz_dashboard.domain.metrics import calculate_mttr, overall_sla_oldest
from wiz_dashboard.models import schema
from wiz_dashboard.ui import components as ui
from wiz_dashboard.ui.pages import _derived

logger = logging.getLogger(__name__)

# Share of the scan progress bar given to the API fetch. Fetching dominates a live scan's
# wall clock (hundreds of thousands of findings over a paginated connection), so it gets
# the bulk of the bar; the remainder is stepped through the parse/persist phases below.
_FETCH_SHARE = 0.7
_PHASE_PARSE = 0.75
_PHASE_TABLE = 0.85
_PHASE_PERSIST = 0.95


def _fetch_fraction(found: int, total) -> float | None:
    """Overall-bar fraction for ``found`` of ``total`` fetched findings.

    Returns ``None`` when the server didn't report a usable total — the caller must then
    skip the bar rather than invent a percentage."""
    if not isinstance(total, (int, float)) or total <= 0:
        return None
    return min(found / total, 1.0) * _FETCH_SHARE


def freshness_caption(meta, scans_df) -> str:
    """The sidebar freshness line.

    Prefers this session's scan (``meta`` = ``last_scan_meta``). When there's no in-session
    scan but the durable base already holds scans, summarise its most recent one, so a page
    rendered from saved data never reads a misleading "No scan yet". Only when nothing exists
    anywhere does it prompt the first scan. ``scans_df`` is ``ledger.load_scans_df()`` (newest
    first) or ``None`` (callers skip the read when ``meta`` is present)."""
    if meta:
        return f"Last scan · {meta['count']:,} findings · {meta['at']}"
    if scans_df is not None and not getattr(scans_df, "empty", True):
        row = scans_df.iloc[0]
        ts = row.get("ts")
        when = ts.strftime("%Y-%m-%d %H:%M UTC") if pd.notna(ts) else "unknown time"
        return f"Saved base · {int(row.get('total', 0)):,} findings · last scan {when}"
    return "No scan yet. Click **Run scan** to load findings."


def _drop_deferred_payloads() -> None:
    """Free any stashed deferred-download payloads (see ``ui.deferred_download``).

    A fresh data load invalidates them anyway (their sig embeds the old token); dropping
    them here keeps multi-megabyte CSV/JSON blobs from outliving the data they describe."""
    for key in [k for k in st.session_state if str(k).endswith("_payload")]:
        st.session_state.pop(key, None)


def run_scan(force: bool, has_creds: bool, sample_shape: str | None = None) -> None:
    """Fetch findings (dry-run without creds), parse them, and store in session state.

    ``force`` clears the fetch cache first (the OS page's "Show individual findings"
    degroup path, which must re-fetch the flat sample even within the cache TTL). Writes
    ``os_nodes`` / ``os_df`` / ``os_raw`` / ``os_prev_counts`` / ``os_counts`` and
    ``last_scan_meta``, records the MTTR snapshot, and invalidates the cached history so
    the trend reflects it. Errors are surfaced with a downloadable traceback instead of
    crashing the page.

    Contrast with ``reload_scan`` (the sidebar "Refresh"), which redraws from the last
    *saved* scan and writes no new snapshot.

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
        with st.status("Running scan…", expanded=True) as status:
            mode_label = "Wiz API" if has_creds else "sample data"
            status.update(label=f"Connecting to {mode_label}…")
            # Dry-run sample shape (ignored live): "grouped" mirrors the real API;
            # "flat" keeps per-finding MTTR/SLA data. An explicit override (e.g. the
            # degroup button) wins; otherwise use the sidebar toggle, defaulting flat so
            # the first scan carries the lifecycle data the headline MTTR/SLA lens needs.
            shape = sample_shape or st.session_state.get("dry_run_shape", "flat")
            # In dry-run, step a per-session sequence so each scan returns a different
            # synthetic snapshot (see data.demo) — that's what makes the scan-over-scan
            # severity badges show non-zero deltas offline. seq 0 is the unchanged baseline;
            # advance *after* reading so the first scan is the familiar SAMPLE_RESULTS.
            sample_seq = 0
            if not has_creds:
                sample_seq = int(st.session_state.get("dry_run_seq", 0))
                st.session_state["dry_run_seq"] = sample_seq + 1

            # One progress bar for the whole scan, living inside the status container.
            # The fetch drives it via totalCount when the server reports one; the
            # parse/persist phases step through the remainder so the bar always ends full.
            bar = st.progress(0.0, text="Querying Wiz…")

            # Live fetch pages through the cursor connection; surface each page as it lands
            # so a multi-thousand-finding scan shows steady progress instead of a stalled
            # "Querying Wiz…". Fires only on a live cache-miss (dry-run/cache-hit are instant).
            def _on_page(pages, found, total):
                noun = "page" if pages == 1 else "pages"
                status.update(label=f"Querying Wiz… {found:,} findings across {pages} {noun}")
                frac = _fetch_fraction(found, total)
                # Without a server-reported total the label alone carries progress --
                # never show a made-up percentage.
                if frac is not None:
                    bar.progress(frac, text=f"Fetched {found:,} of {int(total):,} findings")

            status.update(label="Querying Wiz…")
            results = fetch_findings(
                dry_run=not has_creds, use_config=has_creds,
                sample_shape=shape, sample_seq=sample_seq,
                _progress=_on_page if has_creds else None,
            )
            if results is None:
                status.update(label="Scan produced no output", state="error")
                st.error("Scan produced no output. Check credentials or os_vulns.py.")
                return
            status.update(label="Parsing findings…")
            bar.progress(_PHASE_PARSE, text="Parsing findings…")
            nodes = extract_nodes(results)
            status.update(label=f"Building findings table ({len(nodes):,} findings)…")
            bar.progress(_PHASE_TABLE, text=f"Building findings table ({len(nodes):,} findings)…")
            df = nodes_to_dataframe(nodes)
            status.update(label="Computing severity & MTTR metrics…")
            # The scan's identity doubles as the durable idempotency key (persist) and the
            # cross-session cache token: every session that later loads this scan keys its
            # cached derivations on the same string, so counts/MTTR compute once per scan,
            # not once per browser session (see _derived.df_token / counts_cached).
            # Microsecond resolution: two scans in the same second must not share an
            # identity, or the second would be served the first's cached derivations.
            scan_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            token = f"saved:{scan_id}"
            shape_kind = "grouped" if schema.is_grouped_shape(nodes) else "flat"
            st.session_state["os_nodes"] = nodes
            st.session_state["os_df"] = df
            st.session_state["os_raw"] = results
            st.session_state["os_shape"] = shape_kind
            st.session_state["os_scan_id"] = scan_id
            st.session_state["os_raw_path"] = None  # this session already holds nodes/raw
            st.session_state["os_df_token"] = token
            _drop_deferred_payloads()
            st.session_state["os_prev_counts"] = prev
            st.session_state["os_counts"] = _derived.counts_cached(token, df)
            st.session_state["last_scan_meta"] = {
                "count": len(nodes),
                "mode": "live" if has_creds else "dry-run",
                "at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            }
            status.update(label="Saving scan & reconciling ledger…")
            bar.progress(_PHASE_PERSIST, text="Saving scan & reconciling ledger…")
            _persist_scan(nodes, df, results, mode="live" if has_creds else "dry-run",
                          scan_id=scan_id)
            _record_mttr_snapshot(df, st.session_state["os_counts"])
            _derived.history_cached.clear()  # a fresh snapshot was just written; reflect it
            bar.progress(1.0, text=f"Loaded {len(nodes):,} findings")
            bar.empty()  # the collapsed status line carries the final message
            status.update(label=f"Loaded {len(nodes):,} findings", state="complete")
    except Exception as exc:  # noqa: BLE001 -- surfaced to the user with a traceback
        ui.show_exception(
            exc,
            title="The scan couldn't finish.",
            hint="Check your Wiz credentials in `wiz_config.json`, or run a dry-run with "
            "sample data. Your previously loaded findings are unchanged.",
        )
        return
    ui.show_toast(f"Loaded {len(nodes):,} findings", "success")


def _hydrate_from_saved(row, *, clear_caches: bool) -> int:
    """Rebuild the ``os_*`` session state from the most recent *saved* scan's metadata row.

    The shared core behind both the sidebar "Refresh" (``reload_scan``) and the
    fresh-session auto-load (``autoload_latest_scan``). No Wiz query, no ledger row, no
    MTTR point — it can never add a data point.

    Flat scans take the fast path: the parsed frame comes from the shared cross-session
    loader (``_derived.scan_frame_cached`` — disk snapshot first, JSON archive fallback
    with snapshot backfill) and the raw nested nodes are DEFERRED (``os_nodes`` /
    ``os_raw`` = ``None``) until something actually needs their contents — drill-down or
    raw export — via ``ensure_nodes``/``ensure_raw``. Grouped scans parse the payload
    eagerly: they're the small case and their render walks the nodes.

    ``clear_caches`` re-reads the durable derivations — wanted for the explicit Refresh
    (pick up external changes), deliberately skipped on autoload: a fresh session changes
    no durable data, and the clears are process-global, so doing them per new tab would
    thrash every other session's warm caches.

    Returns the finding count; raises when neither snapshot nor archive is loadable
    (callers decide how to surface it).
    """
    scan_id = str(row.get("scan_id"))
    raw_path = row.get("raw_path")
    shape = str(row.get("shape") or "flat")
    token = f"saved:{scan_id}"  # scan-keyed, NOT per-session — see run_scan
    source = None
    if shape == "grouped":
        payload = _derived.raw_payload_cached(scan_id, raw_path)
        if payload is None:
            raise FileNotFoundError(f"Archived scan payload missing or unreadable: {raw_path}")
        raw = coerce_results(payload)
        nodes = extract_nodes(raw)
        df = nodes_to_dataframe(nodes)
    else:
        df, source = _derived.scan_frame_cached(scan_id, raw_path)
        nodes = None
        raw = None

    prev = st.session_state.get("os_counts", {})
    st.session_state["os_nodes"] = nodes
    st.session_state["os_df"] = df
    st.session_state["os_raw"] = raw
    st.session_state["os_shape"] = shape
    st.session_state["os_scan_id"] = scan_id
    st.session_state["os_raw_path"] = raw_path
    st.session_state["os_df_token"] = token
    _drop_deferred_payloads()
    st.session_state["os_prev_counts"] = prev
    st.session_state["os_counts"] = _derived.counts_cached(token, df)
    ts = row.get("ts")
    when = (
        ts.strftime("%Y-%m-%d %H:%M UTC")
        if ts is not None and pd.notna(ts)
        else datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    )
    count = int(row.get("total") or len(df))
    st.session_state["last_scan_meta"] = {
        "count": count,
        "mode": row.get("mode", "unknown"),
        "at": when,
    }
    if clear_caches:
        _derived.clear_ledger_caches()
        _derived.history_cached.clear()
    if source == "archive":
        # The slow path ran (old archive with no snapshot yet) — it backfilled one, so
        # say so; the snapshot fast path stays silent by design.
        ui.show_toast("Rebuilt findings from the raw archive — wrote a snapshot for "
                      "faster start-up next time.", "info")
    return count


def ensure_raw():
    """The raw response envelope for the loaded scan, hydrating it on first use.

    The flat-scan fast path defers this (100MB-scale JSON parse) — only the raw-JSON
    export needs the envelope. ``None`` when nothing is loadable."""
    raw = st.session_state.get("os_raw")
    if raw is not None:
        return raw
    scan_id = st.session_state.get("os_scan_id")
    raw_path = st.session_state.get("os_raw_path")
    if not scan_id or not raw_path:
        return None
    payload = _derived.raw_payload_cached(scan_id, raw_path)
    if payload is None:
        return None
    raw = coerce_results(payload)
    st.session_state["os_raw"] = raw
    return raw


def ensure_nodes() -> list:
    """The raw nested node list for the loaded scan, hydrating it on first use.

    Only node *contents* need this (drill-down's raw view, exports); routing/counts run
    off the frame and the ``os_shape`` key. Returns ``[]`` when nothing is loadable."""
    nodes = st.session_state.get("os_nodes")
    if nodes is not None:
        return nodes
    raw = ensure_raw()
    nodes = extract_nodes(raw) if raw is not None else []
    st.session_state["os_nodes"] = nodes
    return nodes


def loaded_shape(nodes=None) -> str:
    """``"flat"`` or ``"grouped"`` for the loaded scan, without forcing lazy nodes to load.

    Prefers the ``os_shape`` key (stamped by every session writer); falls back to
    sniffing the nodes for sessions seeded directly (tests, legacy state)."""
    shape = st.session_state.get("os_shape")
    if shape in ("flat", "grouped"):
        return shape
    ns = nodes if nodes is not None else st.session_state.get("os_nodes")
    return "grouped" if ns and schema.is_grouped_shape(ns) else "flat"


def reload_scan() -> None:
    """Redraw the in-session view from the most recent *saved* scan — the sidebar "Refresh".

    Unlike ``run_scan``, this performs **no Wiz query and writes no new snapshot**: it
    re-reads the latest scan archived in the durable base, rebuilds the ``os_*`` session
    state from it, and recomputes the view. Repeated clicks therefore never add duplicate
    ledger rows or same-day MTTR points — it's a pure read. Clears the cached ledger
    derivations (and the history cache) so consumer pages re-read the latest saved base.
    When nothing has ever been saved, it nudges the user to run a scan first.
    """
    row = ledger.load_latest_scan_row()
    if row is None:
        ui.show_toast("Nothing to refresh yet — run a scan first to save findings.", "warning")
        return
    try:
        count = _hydrate_from_saved(row, clear_caches=True)
    except Exception as exc:  # noqa: BLE001 -- surfaced to the user with a traceback
        ui.show_exception(
            exc,
            title="The view couldn't be refreshed.",
            hint="The last saved scan couldn't be reloaded. Run a fresh scan to re-query "
            "Wiz, or check the durable base under `data/`.",
        )
        return
    ui.show_toast(f"Refreshed from the last saved scan · {count:,} findings", "success")


def autoload_latest_scan() -> bool:
    """Hydrate a fresh session from the most recent saved scan so the app opens on data.

    On a new session nothing is loaded, so the dashboard would otherwise greet the user with
    an empty state even when prior scans are saved. This silently rebuilds the ``os_*`` state
    from the latest archived scan — no Wiz query, no new snapshot, no toast (the sidebar
    freshness line already announces it). A no-op (returns ``False``) when findings are
    already loaded, when nothing has ever been saved, or once it has tried this session — the
    ``_autoload_tried`` flag stops the empty-base case re-reading SQLite on every rerun.
    Returns ``True`` only when it loaded a scan into the session.
    """
    # os_scan_id (not just os_nodes) guards the loaded state: on the lazy fast path
    # os_nodes stays None, and the old truthiness check would re-fire every rerun.
    if (
        st.session_state.get("os_scan_id")
        or st.session_state.get("os_nodes")
        or st.session_state.get("_autoload_tried")
    ):
        return False
    st.session_state["_autoload_tried"] = True
    row = ledger.load_latest_scan_row()  # metadata only — never parses the archive
    if row is None:
        return False
    try:
        total = int(row.get("total") or 0)
        label = f"Loading saved scan · {total:,} findings…" if total else "Loading saved scan…"
        with st.spinner(label):
            _hydrate_from_saved(row, clear_caches=False)
    except Exception:  # noqa: BLE001 -- a bad archive must not block app startup
        logger.warning("Auto-load of the latest saved scan failed", exc_info=True)
        return False
    return True


def _persist_scan(nodes, df, results, *, mode, db_path=None, scan_id=None) -> None:
    """Save this scan to the durable base and reconcile the vulnerability ledger.

    Grouped-by-asset responses are archived but skip per-vuln reconciliation (no
    per-finding identity/timestamps). Mirrors ``_record_mttr_snapshot``'s contract:
    never breaks a scan — a failure here is logged and surfaced as a toast only. Sets
    ``scan_deltas`` (``{new_count, resolved_count, reopened_count}``) for the UI and
    clears the cached ledger derivations so consumer pages reflect the new scan.
    """
    try:
        if schema.is_grouped_shape(nodes):
            deltas = ledger.persist_grouped_scan(
                nodes, mode=mode, raw=results, db_path=db_path, scan_id=scan_id
            )
        else:
            # The raw nodes carry everything reconciliation reads (vuln_key/field walk
            # nested dicts), so skip materializing 100k+ wide row-dicts from the frame.
            # ledger._records_from_payload feeds replay the same shape — keep them in sync.
            # Passing df writes the parsed-frame snapshot other sessions start up from.
            deltas = ledger.persist_flat_scan(
                nodes, mode=mode, raw=results, db_path=db_path, scan_id=scan_id, df=df
            )
        st.session_state["scan_deltas"] = deltas
        _derived.clear_ledger_caches()
        _derived.clear_scan_resources()  # a new scan changes which frame is "latest"
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
