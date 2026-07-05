"""Shared, cached derivations over a loaded findings DataFrame.

The pure domain functions stay un-decorated (and unit-tested directly); these thin
wrappers memoize their results so reruns that don't change the data don't recompute
counts/MTTR or re-read the history file from disk. The leading-``_`` on ``_df`` tells
Streamlit to key only on ``sig`` instead of hashing the frame.

These live here (rather than inside a single page) so every page that needs them shares
one cache: the OS-vulnerabilities scan clears ``history_cached`` after writing a snapshot,
and the MTTR page must observe that same invalidation.
"""

import pandas as pd
import streamlit as st

from wiz_dashboard import config
from wiz_dashboard.data import history, ledger, settings, snapshot
from wiz_dashboard.data.transform import df_signature, extract_nodes, nodes_to_dataframe
from wiz_dashboard.domain import domain_rules, lifecycle
from wiz_dashboard.domain.metrics import calculate_mttr
from wiz_dashboard.domain.severity import (
    count_by_severity,
    normalize_severity,
    normalize_severity_series,
)


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


# ---- Display filter (Settings → "shown in the interface") -------------------------- #
# The persisted display scope hides out-of-scope severities from EVERY view and
# analytic ("hide everywhere"); the data stays in session state and the ledger, so
# widening the scope brings it straight back. UNKNOWN (unclassifiable) rows are never
# hidden: they signal a normalization surprise, and hiding anomalies would be dishonest.
def display_scope():
    """The persisted display filter, or ``None`` when it covers every severity."""
    scope = settings.get_display_severities()
    return None if set(scope) == set(config.SELECTABLE_SEVERITIES) else scope


def scope_keep(scope) -> set:
    """The severities a scope keeps visible (the scope itself + UNKNOWN)."""
    return set(scope) | {"UNKNOWN"}


@st.cache_data(show_spinner=False)
def display_df_cached(sig: str, _scope, _df):
    """``_df`` filtered to the display scope. ``sig`` embeds the scope (see
    ``display_view``); ``_scope``/``_df`` stay out of the cache key."""
    if not _scope or _df is None or getattr(_df, "empty", True) or "severity" not in _df.columns:
        return _df
    return _df[normalize_severity_series(_df["severity"]).isin(scope_keep(_scope))]


def display_view(prefix: str = "os"):
    """``(df, sig)`` for the loaded findings frame under the display scope.

    The drop-in replacement for reading ``{prefix}_df`` from session state directly:
    pages MUST key downstream cached derivations on the returned ``sig``, never on
    ``df_token`` of the filtered frame (``df_token`` reads the session token stamped for
    the FULL frame and would collide the two)."""
    full = st.session_state.get(f"{prefix}_df")
    full = full if full is not None else pd.DataFrame()
    base_sig = df_token(full, prefix)
    scope = display_scope()
    if not scope or full.empty:
        return full, base_sig
    sig = f"{base_sig}|show:{','.join(scope)}"
    return display_df_cached(sig, scope, full), sig


def filter_counts(counts, scope):
    """A per-severity count dict restricted to the display scope (UNKNOWN kept)."""
    if not counts or not scope:
        return counts
    keep = scope_keep(scope)
    return {k: v for k, v in counts.items() if k in keep}


# ---- Domain triage (Settings → "Domains") ------------------------------------------ #
# The domain assignment is never stored: it is derived from the persisted rule inputs
# + the CURRENT rules. Every cached derivation below keys on the settings
# ``domains.version`` token (bumped on each save), so a rule edit self-invalidates on
# the next rerun — the same freshness mechanism as ``display_scope()``. When no domains
# are configured the feature is invisible: ``domain_view`` is a passthrough and pages
# render no domain widgets.
def domains_config():
    """``(items, version)`` — one settings read per call; ``[]`` disables the feature."""
    d = settings.get_domains()
    return d["items"], d["version"]


@st.cache_data(show_spinner=False)
def domain_frame_cached(sig: str, rules_version: int, _df):
    """``_df`` with a ``domain`` column appended (``df.assign`` — the shared cached
    frame is never mutated; the copy is paid once per ``(sig, rules_version)``)."""
    compiled = domain_rules.compile_domains(settings.get_domains()["items"])
    return _df.assign(domain=domain_rules.assign_domains_frame(_df, compiled))


def domain_view(df, sig):
    """``(df_with_domain, sig')`` for a loaded findings frame under the current rules.

    ``sig'`` embeds the rules version so every downstream cache (counts, MTTR,
    pagination reset tokens) keys correctly across rule edits. Passthrough (same
    ``df``/``sig``) when no domains are configured or the frame is empty."""
    items, version = domains_config()
    if not items or df is None or getattr(df, "empty", True):
        return df, sig
    sig2 = f"{sig}|dom:{version}"
    return domain_frame_cached(sig2, version, df), sig2


@st.cache_data(show_spinner=False)
def ledger_base_domains_cached(scope=None, rules_version: int = 0):
    """``ledger_base_cached(scope)`` with a ``domain`` column (compacted episodes pin
    to Unassigned). Passthrough copy semantics match ``domain_frame_cached``."""
    df = ledger_base_cached(scope)
    if df is None or df.empty:
        return df
    compiled = domain_rules.compile_domains(settings.get_domains()["items"])
    return df.assign(domain=domain_rules.assign_domains_ledger(df, compiled))


@st.cache_data(show_spinner=False)
def ledger_domain_mttr_cached(scope=None, rules_version: int = 0):
    """``{domain_name: (per_sev, overall)}`` from the durable ledger, per domain.

    Domains appear in priority order (then Unassigned) and only when they have rows."""
    df = ledger_base_domains_cached(scope, rules_version)
    if df is None or df.empty or "domain" not in df.columns:
        return {}
    items, _ = domains_config()
    out = {}
    for name in domain_rules.domain_names(items):
        sub = df[df["domain"] == name]
        if sub.empty:
            continue
        rows = sub[["vuln_key", "severity", "first_seen", "status", "resolved_at"]]
        out[name] = lifecycle.mttr_from_ledger(rows.to_dict("records"))
    return out


@st.cache_data(show_spinner=False)
def ledger_trend_domain_cached(scope=None, rules_version: int = 0, domain: str = ""):
    """The ledger trend (open/resolved/median/SLA over time) restricted to one domain.

    Same shape as ``ledger_trend_cached`` (feeds the same charts); computed by
    filtering the domain-annotated base frame and reusing the pure trend builder."""
    base = ledger_base_domains_cached(scope, rules_version)
    if base is None or base.empty or "domain" not in base.columns:
        return pd.DataFrame()
    return ledger._trend_from_frames(ledger_scans_cached(), base[base["domain"] == domain])


def clear_domain_caches() -> None:
    """Drop domain-derived caches after a rules save/reorder/delete. Correctness does
    not depend on this (the version key already isolates entries); it just bounds
    memory and drops dead entries eagerly."""
    for cached in (domain_frame_cached, ledger_base_domains_cached,
                   ledger_domain_mttr_cached, ledger_trend_domain_cached):
        cached.clear()


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
# reflect lifecycles observed across ALL saved scans, not just the current one. Each takes
# the display scope as a cache-key argument (pass ``display_scope()``); ``None`` means
# unfiltered, and both variants can stay warm side by side.
@st.cache_data(show_spinner=False)
def ledger_mttr_cached(scope=None):
    rows = ledger.load_open_and_resolved()
    if scope:
        keep = scope_keep(scope)
        rows = [r for r in rows if normalize_severity(r.get("severity")) in keep]
    return lifecycle.mttr_from_ledger(rows)


@st.cache_data(show_spinner=False)
def ledger_scans_cached():
    return ledger.load_scans_df()


@st.cache_data(show_spinner=False)
def ledger_base_cached(scope=None):
    df = ledger.load_base_df()
    if scope and not df.empty and "severity" in df.columns:
        df = df[normalize_severity_series(df["severity"]).isin(scope_keep(scope))]
    return df


@st.cache_data(show_spinner=False)
def ledger_trend_cached(scope=None):
    return ledger.load_trend_df(severities=scope)


@st.cache_data(show_spinner=False)
def previous_severity_counts_cached(scope=None):
    """Durable previous-flat-scan per-severity counts — the cross-session baseline for the
    severity breakdown's change badges (cheap on the OS page's filter-fragment reruns)."""
    return filter_counts(ledger.previous_severity_counts(), scope)


def clear_ledger_caches() -> None:
    """Invalidate every durable-ledger derivation. Call after any write OR delete that
    changes the SQLite base so consumer pages (Scan History / MTTR) reflect it."""
    for cached in (
        ledger_mttr_cached,
        ledger_scans_cached,
        ledger_base_cached,
        ledger_trend_cached,
        previous_severity_counts_cached,
        # composers over ledger_base_cached — a new scan changes ledger contents,
        # hence the domain assignments derived over it
        ledger_base_domains_cached,
        ledger_domain_mttr_cached,
        ledger_trend_domain_cached,
    ):
        cached.clear()
