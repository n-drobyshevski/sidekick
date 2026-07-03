"""Cached data access for the dashboard (st.cache_data over os_vulns.fetch_findings)."""

import logging

import streamlit as st

import os_vulns
from wiz_dashboard.config import DEFAULT_CACHE_TTL_MINUTES, load_wiz_config
from wiz_dashboard.data import cache as disk_cache
from wiz_dashboard.data import demo
from wiz_dashboard.data.transform import coerce_results

logger = logging.getLogger(__name__)


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
                   _progress=None):
    """Fetch + normalize findings, memoized for the configured TTL.

    Cache key is (dry_run, use_config, sample_shape, sample_seq) -- never the secret. The
    OS page's "Show individual findings" degroup path calls ``fetch_findings.clear()`` to
    force a re-fetch within the TTL. ``sample_shape`` selects the dry-run sample ("grouped"
    mirrors the real API; "flat" keeps MTTR/SLA data)
    and is ignored in live mode. ``sample_seq`` steps the *flat* dry-run sample through the
    evolving demo snapshots (see ``data.demo``) so scan-over-scan badges show non-zero
    deltas offline; ``0`` is the unchanged baseline. On a live-fetch failure we fall back to
    the on-disk snapshot (with a visible "stale data" warning) so the UI degrades gracefully
    instead of silently pretending a cached scan is fresh.

    ``_progress`` (optional ``callable(pages_done, findings_so_far, total)``) reports live
    pagination progress on a live fetch. The leading underscore keeps it out of the
    ``st.cache_data`` key, so a cache hit stays instant and the callback simply doesn't fire.
    """
    cfg = load_wiz_config() if use_config else None
    try:
        if dry_run and sample_shape == "flat":
            raw = demo.evolving_flat_sample(sample_seq)
        else:
            raw = os_vulns.fetch_findings(dry_run=dry_run, config=cfg,
                                          sample_shape=sample_shape, progress=_progress)
    except TimeoutError as exc:
        return _use_disk_cache_or_raise("The Wiz API did not respond in time", exc)
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

