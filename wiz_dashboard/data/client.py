"""Cached data access for the remaining Python spec/helpers."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from functools import wraps
from typing import Any, Callable

import os_vulns
from wiz_dashboard.config import DEFAULT_CACHE_TTL_MINUTES, load_wiz_config
from wiz_dashboard.data import cache as disk_cache
from wiz_dashboard.data import demo
from wiz_dashboard.data.settings import api_severity_filter
from wiz_dashboard.data.transform import coerce_results
from wiz_dashboard.domain.severity import normalize_severity

logger = logging.getLogger(__name__)


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float


def _ttl_cache(ttl_seconds: int, max_entries: int = 2):
    """Small in-process TTL cache with an explicit ``.clear()`` hook."""

    def decorator(func: Callable):
        cache: dict[tuple[Any, ...], _CacheEntry] = {}

        @wraps(func)
        def wrapper(*args, **kwargs):
            key = args + tuple(sorted(kwargs.items()))
            now = time.monotonic()
            entry = cache.get(key)
            if entry is not None and entry.expires_at > now:
                return entry.value
            if entry is not None:
                cache.pop(key, None)
            value = func(*args, **kwargs)
            if len(cache) >= max_entries:
                oldest_key = min(cache.items(), key=lambda item: item[1].expires_at)[0]
                cache.pop(oldest_key, None)
            cache[key] = _CacheEntry(value=value, expires_at=now + ttl_seconds)
            return value

        def clear() -> None:
            cache.clear()

        wrapper.clear = clear
        return wrapper

    return decorator


def _filter_sample_nodes(raw, severities):
    """Apply the severity scope to a dry-run flat sample envelope."""
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
    """Return the coerced disk snapshot, or re-raise a friendly error."""
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
            raise RuntimeError(message) from exc
    logger.warning("%s; falling back to disk cache", reason, exc_info=True)
    return coerce_results(snapshot)


@_ttl_cache(ttl_seconds=DEFAULT_CACHE_TTL_MINUTES * 60, max_entries=2)
def fetch_findings(
    dry_run: bool = True,
    use_config: bool = False,
    sample_shape: str = "grouped",
    sample_seq: int = 0,
    severities: tuple = None,
    _progress=None,
):
    """Fetch + normalize findings, memoized for the configured TTL."""
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
            raw = os_vulns.fetch_findings(
                dry_run=dry_run,
                config=cfg,
                sample_shape=sample_shape,
                progress=_progress,
                extra_filter_by=extra,
            )
    except TimeoutError as exc:
        return _use_disk_cache_or_raise("The Wiz API did not respond in time", exc)
    except os_vulns.WizDeltaFilterError as exc:
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


def fetch_findings_delta(
    since_iso,
    *,
    has_creds: bool,
    sample_seq: int = 0,
    severities: tuple = None,
    _progress=None,
):
    """Fetch only findings changed since ``since_iso``."""
    if not has_creds:
        return _filter_sample_nodes(demo.incremental_flat_sample(sample_seq), severities)
    cfg = load_wiz_config()
    extra = {"updatedAt": {"after": since_iso}}
    api_values = api_severity_filter(severities) if severities is not None else None
    if api_values is not None:
        extra["severity"] = api_values
    raw = os_vulns.fetch_findings(
        dry_run=False,
        config=cfg,
        progress=_progress,
        extra_filter_by=extra,
    )
    results = coerce_results(raw)
    if results is None or not isinstance(results, (dict, list)):
        raise ValueError(
            f"Wiz API returned an unexpected delta response type ({type(raw).__name__})."
        )
    return results
