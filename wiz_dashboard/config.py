"""Static configuration: cache settings, severity taxonomy, SLA targets."""

import json
from pathlib import Path
from typing import Dict

# ---- Local result cache (disk "last known good" snapshot) ----
# Gzipped: the snapshot is a full scan's findings (~100s of MB plain), rewritten on
# every live fetch. data.cache reads the pre-compression plain file as a fallback.
CACHE_FILENAME = "last_results.json.gz"
DEFAULT_CACHE_TTL_MINUTES = 60

# ---- Severity taxonomy ----
SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"]
# Standard VM SLAs (days). Tweak per your remediation policy.
SLA_TARGETS = {"CRITICAL": 7, "HIGH": 14, "MEDIUM": 30, "LOW": 90, "INFO": 180}

# ---- User-adjustable severity scope (Settings page; persisted in data/settings.json) ----
# UNKNOWN is a local normalization bucket, never an API value — not user-selectable.
SELECTABLE_SEVERITIES = tuple(s for s in SEVERITY_ORDER if s != "UNKNOWN")
# Fresh-install defaults for what scans pull from Wiz and what the UI shows.
DEFAULT_FETCH_SEVERITIES = ("CRITICAL", "HIGH")
DEFAULT_DISPLAY_SEVERITIES = ("CRITICAL", "HIGH")
# App severity -> Wiz API enum for the GraphQL filterBy.severity filter (the API spells
# INFO as INFORMATIONAL; domain.severity normalizes the reverse direction).
API_SEVERITY_VALUES = {
    "CRITICAL": "CRITICAL",
    "HIGH": "HIGH",
    "MEDIUM": "MEDIUM",
    "LOW": "LOW",
    "INFO": "INFORMATIONAL",
}

# Statuses (from the API side) that mean a finding is remediated/closed — the MTTR
# stop-clock. Shared by metrics.calculate_mttr and the ledger reconciliation.
RESOLVED_STATUSES = {"RESOLVED", "REMEDIATED", "FIXED", "CLOSED"}

# ---- Durable scan archive + vulnerability ledger (correct MTTR across scans) ----
# Every scan is saved here and reconciled into a deduplicated per-vulnerability base, so
# MTTR is computed from observed lifecycles instead of a single snapshot. Git-ignored.
DATA_DIR = Path("data")
LEDGER_DB_FILENAME = "ledger.db"  # SQLite base, under DATA_DIR
SCAN_ARCHIVE_DIRNAME = "scans"  # raw per-scan JSON, under DATA_DIR
# How to timestamp a resolution inferred from a vuln disappearing between scans:
#   "scan_ts"  -> the scan it was first absent (conservative; default)
#   "midpoint" -> halfway between the previous and current scan
DISAPPEARANCE_RESOLUTION = "scan_ts"

# ---- Retention / compaction of old, closed data (Settings page; data.ledger) ----
# Scans older than the retention window are "sealed": their resolved vulns roll up into
# exact episode rows (MTTR/SLA/trend stay bit-identical) and their per-scan artifacts
# (observations, raw archive, snapshot) are pruned. Sealed scans can't be deleted.
DEFAULT_RETENTION_DAYS = 180
RETENTION_MIN_DAYS = 30  # guardrail: never seal anything younger than this
# The newest flat scan is the quick-refresh merge baseline (raw archive must survive);
# the second-newest feeds the severity change badges from its observations.
MIN_UNSEALED_FLAT_SCANS = 2


def load_wiz_config(path: str = "wiz_config.json") -> Dict:
    """Load optional Wiz credentials from JSON; returns {} if absent or invalid."""
    p = Path(path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
