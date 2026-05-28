"""MTTR / SLA analytics computed from a findings DataFrame."""

import pandas as pd

from wiz_dashboard.config import SEVERITY_ORDER, SLA_TARGETS
from wiz_dashboard.domain.severity import normalize_severity


def _find_col(df, *candidates):
    """Return first column whose name contains any candidate (case-insensitive)."""
    cols = {c.lower(): c for c in df.columns}
    for cand in candidates:
        for low, orig in cols.items():
            if cand.lower() in low:
                return orig
    return None


def calculate_mttr(df):
    """MTTR by severity. Returns (per_sev_dict, overall_dict)."""
    if df.empty:
        return {}, {}

    first_seen_col = _find_col(df, "firstSeenAt", "firstDetectedAt", "createdAt")
    resolved_col = _find_col(df, "resolvedAt", "remediatedAt", "fixedAt")
    status_col = _find_col(df, "status")

    if not first_seen_col:
        return {}, {}

    work = df.copy()
    work["_sev"] = (
        work["severity"].apply(normalize_severity)
        if "severity" in work.columns
        else "UNKNOWN"
    )
    work["_first_seen"] = pd.to_datetime(work[first_seen_col], errors="coerce", utc=True)
    # When there is no resolved timestamp, build a tz-aware all-NaT column so the
    # subtraction below stays tz-consistent. (The previous `else pd.NaT` produced a
    # tz-naive column and crashed on tz-aware minus tz-naive under pandas >= 2.)
    if resolved_col:
        work["_resolved"] = pd.to_datetime(work[resolved_col], errors="coerce", utc=True)
    else:
        work["_resolved"] = pd.Series(
            pd.NaT, index=work.index, dtype="datetime64[ns, UTC]"
        )

    # If status exists but no resolved timestamp, only count closed findings
    if status_col and not resolved_col:
        resolved_mask = (
            work[status_col]
            .astype(str)
            .str.upper()
            .isin({"RESOLVED", "REMEDIATED", "FIXED", "CLOSED"})
        )
        work.loc[~resolved_mask, "_resolved"] = pd.NaT

    now = pd.Timestamp.now(tz="UTC")
    work["_mttr_days"] = (
        work["_resolved"] - work["_first_seen"]
    ).dt.total_seconds() / 86400
    work["_age_days"] = (now - work["_first_seen"]).dt.total_seconds() / 86400

    per_sev = {}
    for sev in SEVERITY_ORDER:
        sub = work[work["_sev"] == sev]
        if sub.empty:
            continue
        resolved = sub.dropna(subset=["_mttr_days"])
        open_ = sub[sub["_resolved"].isna() & sub["_first_seen"].notna()]
        target = SLA_TARGETS.get(sev)
        within_sla = (
            (resolved["_mttr_days"] <= target).sum()
            if target and not resolved.empty
            else 0
        )
        per_sev[sev] = {
            "mttr_mean": resolved["_mttr_days"].mean() if not resolved.empty else None,
            "mttr_median": (
                resolved["_mttr_days"].median() if not resolved.empty else None
            ),
            "resolved": len(resolved),
            "open": len(open_),
            "open_age_p50": open_["_age_days"].median() if not open_.empty else None,
            "open_age_p90": (
                open_["_age_days"].quantile(0.9) if not open_.empty else None
            ),
            "sla_target": target,
            "sla_compliant": int(within_sla),
            "sla_pct": (
                (within_sla / len(resolved) * 100)
                if not resolved.empty and target
                else None
            ),
        }

    overall = {
        "mttr_mean": work.dropna(subset=["_mttr_days"])["_mttr_days"].mean(),
        "mttr_median": work.dropna(subset=["_mttr_days"])["_mttr_days"].median(),
        "resolved": int(work["_resolved"].notna().sum()),
        "open": int(work["_resolved"].isna().sum()),
    }
    return per_sev, overall
