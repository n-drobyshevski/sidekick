"""Static configuration: cache settings, severity taxonomy, SLA targets."""

import json
from pathlib import Path
from typing import Dict

# ---- Local result cache (disk "last known good" snapshot) ----
CACHE_FILENAME = "last_results.json"
DEFAULT_CACHE_TTL_MINUTES = 60

# ---- Severity taxonomy ----
SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"]
# Light-theme severity palette: Altair renders charts to SVG and can't read CSS vars,
# so these single hex values are tuned to stay legible (>=3:1 as graphical marks) on a
# white background (notably MEDIUM is #d97706 — the old #eab308 was ~1.6:1 on white).
# Mirrored as --sev-* CSS tokens in assets/styles.css for the custom-HTML badges/cards.
SEVERITY_COLORS = {
    "CRITICAL": "#dc2626",
    "HIGH": "#ea580c",
    "MEDIUM": "#d97706",
    "LOW": "#2563eb",
    "INFO": "#64748b",
    "UNKNOWN": "#475569",
}
# Glyphs give severity a non-color signal (accessibility) in labels and tables,
# so meaning isn't carried by color alone.
SEVERITY_GLYPHS = {
    "CRITICAL": "🔴",
    "HIGH": "🟠",
    "MEDIUM": "🟡",
    "LOW": "🔵",
    "INFO": "⚪",
    "UNKNOWN": "⚫",
}
# Standard VM SLAs (days). Tweak per your remediation policy.
SLA_TARGETS = {"CRITICAL": 7, "HIGH": 14, "MEDIUM": 30, "LOW": 90, "INFO": 180}

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


def load_wiz_config(path: str = "wiz_config.json") -> Dict:
    """Load optional Wiz credentials from JSON; returns {} if absent or invalid."""
    p = Path(path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
