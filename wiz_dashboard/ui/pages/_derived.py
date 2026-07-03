"""Shared, cached derivations over a loaded findings DataFrame.

The pure domain functions stay un-decorated (and unit-tested directly); these thin
wrappers memoize their results so reruns that don't change the data don't recompute
counts/MTTR or re-read the history file from disk. The leading-``_`` on ``_df`` tells
Streamlit to key only on ``sig`` instead of hashing the frame.

These live here (rather than inside a single page) so every page that needs them shares
one cache: the OS-vulnerabilities scan clears ``history_cached`` after writing a snapshot,
and the MTTR page must observe that same invalidation.
"""

import streamlit as st

from wiz_dashboard.data import history, ledger, snapshot
from wiz_dashboard.data.transform import df_signature, extract_nodes, nodes_to_dataframe
from wiz_dashboard.domain import lifecycle
from wiz_dashboard.domain.metrics import calculate_mttr
from wiz_dashboard.domain.severity import count_by_severity


def df_token(df, prefix: str = "os") -> str:
    """Cheap cache key for a loaded findings frame.

    The session writers (``ui.scan``) stamp a fresh ``{prefix}_df_token`` whenever they
    load data, so pages key the cached derivations on a session-state lookup instead of
    re-hashing the whole frame every rerun (``df_signature`` walks every cell — a real
    per-rerun cost at 100k+ rows). When no writer stamped a token (tests seeding
    ``{prefix}_df`` directly), fall back to one ``df_signature`` hash and memoize it for
    the rest of the session."""
    key = f"{prefix}_df_token"
    token = st.session_state.get(key)
    if not token:
        token = df_signature(df)
        st.session_state[key] = token
    return token


# ---- Cross-session loaders for the saved scan (st.cache_resource = one shared object
# per process, zero-copy access). These are what make a browser refresh / second tab
# near-instant: the first session pays the disk read, every later session gets the same
# in-memory frame. Cleared by ui.scan._persist_scan (new scan) and the Scan History
# delete flow, so a stale scan can never keep being served.
@st.cache_resource(show_spinner=False, max_entries=1)
def raw_payload_cached(scan_id: str, raw_path: str):
    """Parsed archived JSON envelope for one saved scan (lazy ``os_nodes``/``os_raw``
    hydration + grouped-scan rendering). ``None`` when missing/unreadable. max_entries=1:
    at 100k+ findings one envelope is already hundreds of MB — never hold two."""
    return ledger._read_raw_payload(raw_path)


@st.cache_resource(show_spinner=False, max_entries=2)
def scan_frame_cached(scan_id: str, raw_path):
    """Shared READ-ONLY parsed frame for a saved flat scan → ``(df, source)``.

    Snapshot fast path (``data.snapshot``); falls back to parsing the JSON archive and
    then backfills the missing snapshot so the *next* cold start is fast. ``source`` is
    ``"snapshot"`` or ``"archive"`` (callers may surface the slow path). Raises when both
    the snapshot and the archive are unreadable — the exception is not cached.

    The returned frame is shared across ALL sessions: consumers must never mutate it
    in place (every current consumer filters/copies; keep it that way)."""
    df = snapshot.read_snapshot(raw_path) if raw_path else None
    if df is not None:
        return df, "snapshot"
    payload = raw_payload_cached(scan_id, raw_path)
    if payload is None:
        raise FileNotFoundError(f"Archived scan payload missing or unreadable: {raw_path}")
    df = nodes_to_dataframe(extract_nodes(payload))
    if raw_path and not df.empty:
        snapshot.write_snapshot(raw_path, df)  # best-effort backfill for older archives
    return df, "archive"


def clear_scan_resources() -> None:
    """Drop the shared saved-scan objects (frame + raw payload). Call after any write or
    delete that changes which scan is 'latest', so no session keeps serving stale data."""
    scan_frame_cached.clear()
    raw_payload_cached.clear()


@st.cache_data(show_spinner=False)
def counts_cached(sig: str, _df):
    return count_by_severity(_df)


@st.cache_data(show_spinner=False)
def mttr_cached(sig: str, _df):
    return calculate_mttr(_df)


@st.cache_data(show_spinner=False)
def history_cached():
    return history.load_history()


# ---- Durable ledger derivations (cleared by ui.scan._persist_scan after each scan) ----
# These read the SQLite base rather than the in-session DataFrame, so MTTR/History pages
# reflect lifecycles observed across ALL saved scans, not just the current one.
@st.cache_data(show_spinner=False)
def ledger_mttr_cached():
    return lifecycle.mttr_from_ledger(ledger.load_open_and_resolved())


@st.cache_data(show_spinner=False)
def ledger_scans_cached():
    return ledger.load_scans_df()


@st.cache_data(show_spinner=False)
def ledger_base_cached():
    return ledger.load_base_df()


@st.cache_data(show_spinner=False)
def ledger_trend_cached():
    return ledger.load_trend_df()


@st.cache_data(show_spinner=False)
def previous_severity_counts_cached():
    """Durable previous-flat-scan per-severity counts — the cross-session baseline for the
    severity breakdown's change badges (cheap on the OS page's filter-fragment reruns)."""
    return ledger.previous_severity_counts()


def clear_ledger_caches() -> None:
    """Invalidate every durable-ledger derivation. Call after any write OR delete that
    changes the SQLite base so consumer pages (Scan History / MTTR) reflect it."""
    for cached in (
        ledger_mttr_cached,
        ledger_scans_cached,
        ledger_base_cached,
        ledger_trend_cached,
        previous_severity_counts_cached,
    ):
        cached.clear()
