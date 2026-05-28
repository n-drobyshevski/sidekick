"""Severity normalization and counting."""

from wiz_dashboard.config import SEVERITY_ORDER


def normalize_severity(sev):
    if not isinstance(sev, str):
        return "UNKNOWN"
    s = sev.upper().strip()
    if s in ("INFORMATIONAL", "INFO"):
        return "INFO"
    return s if s in SEVERITY_ORDER else "UNKNOWN"


def count_by_severity(df):
    if df.empty or "severity" not in df.columns:
        return {}
    return df["severity"].apply(normalize_severity).value_counts().to_dict()
