"""Cached data access for the dashboard (st.cache_data over os_vulns.fetch_findings)."""

import streamlit as st

import os_vulns
from wiz_dashboard.config import DEFAULT_CACHE_TTL_MINUTES, load_wiz_config
from wiz_dashboard.data import cache as disk_cache
from wiz_dashboard.data import demo
from wiz_dashboard.data.transform import coerce_results


@st.cache_data(ttl=DEFAULT_CACHE_TTL_MINUTES * 60, show_spinner=False)
def fetch_findings(dry_run: bool = True, use_config: bool = False,
                   sample_shape: str = "grouped", sample_seq: int = 0):
    """Fetch + normalize findings, memoized for the configured TTL.

    Cache key is (dry_run, use_config, sample_shape, sample_seq) -- never the secret. The
    "Refresh" button calls ``fetch_findings.clear()`` to force a re-fetch. ``sample_shape``
    selects the dry-run sample ("grouped" mirrors the real API; "flat" keeps MTTR/SLA data)
    and is ignored in live mode. ``sample_seq`` steps the *flat* dry-run sample through the
    evolving demo snapshots (see ``data.demo``) so scan-over-scan badges show non-zero
    deltas offline; ``0`` is the unchanged baseline. On a live-fetch failure we fall back to
    the on-disk snapshot so the UI degrades gracefully.
    """
    cfg = load_wiz_config() if use_config else None
    try:
        if dry_run and sample_shape == "flat":
            raw = demo.evolving_flat_sample(sample_seq)
        else:
            raw = os_vulns.fetch_findings(dry_run=dry_run, config=cfg, sample_shape=sample_shape)
    except Exception:
        snapshot = disk_cache.load_cache()
        if snapshot is not None:
            return coerce_results(snapshot)
        raise
    results = coerce_results(raw)
    if not dry_run and results is not None:
        disk_cache.save_cache(results)
    return results
