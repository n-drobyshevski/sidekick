"""Static configuration: cache settings, severity taxonomy, SLA targets."""

import json
from pathlib import Path
from typing import Dict

# ---- Local result cache (disk "last known good" snapshot) ----
CACHE_FILENAME = "last_results.json"
DEFAULT_CACHE_TTL_MINUTES = 60

# ---- Severity taxonomy ----
SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"]
SEVERITY_COLORS = {
    "CRITICAL": "#ef4444",
    "HIGH": "#f97316",
    "MEDIUM": "#eab308",
    "LOW": "#3b82f6",
    "INFO": "#6b7280",
    "UNKNOWN": "#4b5563",
}
# Standard VM SLAs (days). Tweak per your remediation policy.
SLA_TARGETS = {"CRITICAL": 7, "HIGH": 14, "MEDIUM": 30, "LOW": 90, "INFO": 180}


def load_wiz_config(path: str = "wiz_config.json") -> Dict:
    """Load optional Wiz credentials from JSON; returns {} if absent or invalid."""
    p = Path(path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
