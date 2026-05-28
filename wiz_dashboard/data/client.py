"""Cached data access for the dashboard (st.cache_data over os_vulns.fetch_findings)."""

import streamlit as st

import os_vulns
from wiz_dashboard.config import DEFAULT_CACHE_TTL_MINUTES, load_wiz_config
from wiz_dashboard.data import cache as disk_cache
from wiz_dashboard.data.transform import coerce_results


@st.cache_data(ttl=DEFAULT_CACHE_TTL_MINUTES * 60, show_spinner=False)
def fetch_findings(dry_run: bool = True, use_config: bool = False):
    """Fetch + normalize findings, memoized for the configured TTL.

    Cache key is (dry_run, use_config) -- never the secret. The "Refresh" button
    calls ``fetch_findings.clear()`` to force a re-fetch. On a live-fetch failure we
    fall back to the on-disk snapshot so the UI degrades gracefully.
    """
    cfg = load_wiz_config() if use_config else None
    try:
        raw = os_vulns.fetch_findings(dry_run=dry_run, config=cfg)
    except Exception:
        snapshot = disk_cache.load_cache()
        if snapshot is not None:
            return coerce_results(snapshot)
        raise
    results = coerce_results(raw)
    if not dry_run and results is not None:
        disk_cache.save_cache(results)
    return results
