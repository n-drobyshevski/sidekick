"""Cached data access for the dashboard (st.cache_data over os_vulns.fetch_findings)."""

import logging

import streamlit as st

import os_vulns
from wiz_dashboard.config import DEFAULT_CACHE_TTL_MINUTES, load_wiz_config
from wiz_dashboard.data import cache as disk_cache
from wiz_dashboard.data import demo
from wiz_dashboard.data.settings import api_severity_filter
from wiz_dashboard.data.transform import coerce_results
from wiz_dashboard.domain.severity import normalize_severity

logger = logging.getLogger(__name__)


def _filter_sample_nodes(raw, severities):
    """Apply the severity scope to a dry-run *flat* sample envelope.

    Live scans filter server-side; offline the scope must still visibly work, so the
    demo nodes are filtered post-load by normalized severity. Returns a new envelope
    (nodes themselves are shared, not copied). Grouped samples carry per-severity
    *counts*, not per-finding rows, and pass through unfiltered elsewhere.
    """
    if severities is None:
        return raw
    scope = set(severities)
    try:
        nodes = raw["data"]["vulnerabilityFindings"]["nodes"]
    except (KeyError, TypeError):
        return raw
    kept = [n for n in nodes if normalize_severity(n.get("severity")) in scope]
    return {"data": {"vulnerabilityFindings": {"nodes": kept}}}


def _use_disk_cache_or_raise(reason: str, exc: Exception):
    """Shared fallback: return the coerced disk snapshot, or re-raise a friendly error.

    On success, surfaces a visible ``st.warning`` (not just a log line) so the analyst
    knows they're looking at a stale, previously-saved scan rather than fresh live data --
    Streamlit replays this warning on every cache hit for this result, not just the miss
    that triggered it, so the "stale data" banner stays up for as long as the fallback
    result stays cached. When no snapshot exists, re-raises ``exc``'s type with a message
    that says so plainly, chained to the original for a full traceback.
    """
    snapshot = disk_cache.load_cache()
    if snapshot is None:
        logger.warning("%s; no disk cache available", reason, exc_info=True)
        message = (
            f"{reason}, and no previously saved scan is available to fall back to. "
            "Check your network connection / Wiz credentials and try again."
        )
        try:
            raise type(exc)(message) from exc
        except TypeError:
            # Some exception types don't accept a single string arg -- fall back to a
            # plain RuntimeError rather than letting that construction failure mask the
            # real error.
            raise RuntimeError(message) from exc
    logger.warning("%s; falling back to disk cache", reason, exc_info=True)
    saved_at = disk_cache.peek_saved_at()
    st.warning(
        f"⚠️ {reason}. Showing the last saved scan from **{saved_at}** instead of live data.",
        icon="⚠️",
    )
    return coerce_results(snapshot)


# max_entries bounds how many pickled result sets the cache retains: at 100k+ findings
# each entry is hundreds of MB, so old sample-shape/seq variants must not accumulate.
@st.cache_data(ttl=DEFAULT_CACHE_TTL_MINUTES * 60, show_spinner=False, max_entries=2)
def fetch_findings(dry_run: bool = True, use_config: bool = False,
                   sample_shape: str = "grouped", sample_seq: int = 0,
                   severities: tuple = None, _progress=None):
    """Fetch + normalize findings, memoized for the configured TTL.

    Cache key is (dry_run, use_config, sample_shape, sample_seq, severities) -- never the
    secret. The OS page's "Show individual findings" degroup path calls
    ``fetch_findings.clear()`` to force a re-fetch within the TTL. ``sample_shape`` selects
    the dry-run sample ("grouped" mirrors the real API; "flat" keeps MTTR/SLA data)
    and is ignored in live mode. ``sample_seq`` steps the *flat* dry-run sample through the
    evolving demo snapshots (see ``data.demo``) so scan-over-scan badges show non-zero
    deltas offline; ``0`` is the unchanged baseline. On a live-fetch failure we fall back to
    the on-disk snapshot (with a visible "stale data" warning) so the UI degrades gracefully
    instead of silently pretending a cached scan is fresh.

    ``severities`` (canonical ordered tuple from ``settings.get_fetch_severities``, or
    ``None`` for all) scopes the pull: live mode filters server-side via ``filterBy``
    (the whole point — smaller payloads, faster scans); dry-run filters the flat sample
    post-load so the setting visibly works offline. A scope covering every selectable
    severity emits no filter and is byte-identical to the unscoped call. Being a real
    cache-key argument, a scope change is a natural cache miss — no ``.clear()`` needed.

    ``_progress`` (optional ``callable(pages_done, findings_so_far, total)``) reports live
    pagination progress on a live fetch. The leading underscore keeps it out of the
    ``st.cache_data`` key, so a cache hit stays instant and the callback simply doesn't fire.
    """
    cfg = load_wiz_config() if use_config else None
    api_values = api_severity_filter(severities) if severities is not None else None
    try:
        if dry_run and sample_shape == "flat":
            raw = _filter_sample_nodes(
                demo.evolving_flat_sample(sample_seq),
                severities if api_values is not None else None,
            )
        else:
            extra = {"severity": api_values} if api_values is not None else None
            raw = os_vulns.fetch_findings(dry_run=dry_run, config=cfg,
                                          sample_shape=sample_shape, progress=_progress,
                                          extra_filter_by=extra)
    except TimeoutError as exc:
        return _use_disk_cache_or_raise("The Wiz API did not respond in time", exc)
    except os_vulns.WizDeltaFilterError as exc:
        # The tenant rejected the injected filterBy — with a severity scope that means
        # the severity filter itself. Serving the stale disk snapshot here would silently
        # mask a misconfiguration, so surface the specific cause instead.
        raise RuntimeError(
            "The Wiz tenant rejected the severity-scoped query. Set the scan scope to "
            "all severities in Settings and re-run, or verify the tenant supports the "
            "vulnerabilityFindings severity filter."
        ) from exc
    except RuntimeError as exc:
        msg = str(exc)
        if "wiz_sdk not installed" in msg:
            raise RuntimeError(
                "The wiz_sdk package is not installed. Run: pip install wiz_sdk "
                "(see https://docs.wiz.io/docs/python-sdk for the private index URL), "
                "or switch to dry-run mode by removing credentials from wiz_config.json."
            ) from exc
        # Auth / permission errors from the SDK surface as RuntimeError
        if any(k in msg.lower() for k in ("auth", "unauthorized", "forbidden", "credentials")):
            raise RuntimeError(
                f"Authentication failed: {msg}. "
                "Check that wiz_client_id and wiz_client_secret in wiz_config.json are correct "
                "and that the service account has the required permissions."
            ) from exc
        return _use_disk_cache_or_raise(f"Live fetch failed ({msg})", exc)
    except Exception as exc:
        return _use_disk_cache_or_raise(f"Unexpected error during fetch ({exc})", exc)

    results = coerce_results(raw)
    if results is None or not isinstance(results, (dict, list)):
        raise ValueError(
            f"Wiz API returned an unexpected response type ({type(raw).__name__}). "
            "The SDK result could not be converted to a usable format — "
            "please report this with the SDK version."
        )
    if not dry_run and results is not None:
        disk_cache.save_cache(results)
    return results


def fetch_findings_delta(since_iso, *, has_creds: bool, sample_seq: int = 0,
                         severities: tuple = None, _progress=None):
    """Fetch only findings changed since ``since_iso`` — the incremental-refresh read.

    Deliberately UNCACHED (no ``st.cache_data``): a delta is one or two requests and must
    always be fresh — a memoized delta could re-apply stale changes over a newer baseline.
    Also deliberately NO disk-cache fallback: ``last_results.json`` holds a stale *full*
    snapshot, and serving that as a "delta" would let delta-wins merging regress newer
    baseline fields — so failures raise instead of degrading. ``WizDeltaFilterError``
    (tenant rejected the ``updatedAt`` filter) propagates untouched so the orchestrator
    can disable the feature with a specific message.

    Live mode injects ``{"updatedAt": {"after": since_iso}}`` on top of the baseline
    ``filterBy`` (which keeps ``status`` incl. RESOLVED, so resolutions are returned as
    RESOLVED nodes). Dry-run returns the offline demo delta for ``sample_seq``.

    ``severities`` MUST be the **baseline scan's stored scope** (see
    ``ledger.parse_severities``), never the current Settings value: the merged result has
    to stay coherent with the baseline it's merged into. ``None`` means unscoped.
    """
    if not has_creds:
        return _filter_sample_nodes(demo.incremental_flat_sample(sample_seq), severities)
    cfg = load_wiz_config()
    extra = {"updatedAt": {"after": since_iso}}
    api_values = api_severity_filter(severities) if severities is not None else None
    if api_values is not None:
        extra["severity"] = api_values
    raw = os_vulns.fetch_findings(
        dry_run=False, config=cfg, progress=_progress,
        extra_filter_by=extra,
    )
    results = coerce_results(raw)
    if results is None or not isinstance(results, (dict, list)):
        raise ValueError(
            f"Wiz API returned an unexpected delta response type ({type(raw).__name__})."
        )
    return results

