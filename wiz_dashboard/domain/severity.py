"""Severity normalization and counting."""

import pandas as pd

from wiz_dashboard.config import SEVERITY_ORDER

_ALIASES = {"INFORMATIONAL": "INFO"}


def normalize_severity(sev):
    if not isinstance(sev, str):
        return "UNKNOWN"
    s = sev.upper().strip()
    if s in ("INFORMATIONAL", "INFO"):
        return "INFO"
    return s if s in SEVERITY_ORDER else "UNKNOWN"


def normalize_severity_series(s: pd.Series) -> pd.Series:
    """Vectorized ``normalize_severity`` over a Series (one pass, no ``.apply``).

    Element-for-element equivalent to ``s.apply(normalize_severity)``:
    non-strings and unrecognized values become ``"UNKNOWN"``; ``"INFORMATIONAL"``
    maps to ``"INFO"``. Returned values are plain ``str`` (object dtype) so callers
    that build dicts get the same keys as the scalar path.
    """
    norm = s.astype("string").str.upper().str.strip().replace(_ALIASES)
    norm = norm.where(norm.isin(SEVERITY_ORDER), "UNKNOWN")
    return norm.fillna("UNKNOWN").astype(object)


def count_by_severity(df):
    if df.empty or "severity" not in df.columns:
        return {}
    return normalize_severity_series(df["severity"]).value_counts().to_dict()
