"""MTTR / SLA analytics computed from a findings DataFrame."""

import pandas as pd

from wiz_dashboard.config import RESOLVED_STATUSES, SEVERITY_ORDER, SLA_TARGETS
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
    """MTTR by severity for ONE scan. Returns (per_sev_dict, overall_dict).

    Single-scan path: trusts the API's first-seen / resolved timestamps within this
    response. The durable, lifecycle-based equivalent is ``lifecycle.mttr_from_ledger``;
    both share ``_summarize`` so the output contract is identical.
    """
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
            .isin(RESOLVED_STATUSES)
        )
        work.loc[~resolved_mask, "_resolved"] = pd.NaT

    return _summarize(work)


def _summarize(work, *, now=None):
    """Reduce a frame with ``_sev`` / ``_first_seen`` / ``_resolved`` (UTC) to
    ``(per_sev, overall)``.

    Shared by ``calculate_mttr`` (single scan) and ``lifecycle.mttr_from_ledger`` (the
    durable base) so both emit the same shape ``render_mttr_widget`` / ``sla_posture``
    consume. ``now`` defaults to the current UTC instant (overridable for deterministic
    tests of open-age percentiles).
    """
    if work is None or work.empty:
        return {}, {}

    work = work.copy()
    if now is None:
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


def overall_sla_oldest(per_sev):
    """Overall In-SLA % and oldest-open age (days) from a per-severity summary, matching
    the headline KPIs: SLA = total within-target ÷ total resolved (×100); oldest = the max
    over severities of the p90 open age. Returns ``(sla_pct | None, oldest_days | None)``.

    ``ledger.load_trend_df`` reconstructs the same two quantities from the base directly
    (per scan date) for the trend / KPI change badges — keep the definitions in sync."""
    compliant = sum(d.get("sla_compliant", 0) for d in per_sev.values())
    resolved = sum(d.get("resolved", 0) for d in per_sev.values())
    sla = (compliant / resolved * 100) if resolved else None
    p90s = [d.get("open_age_p90") for d in per_sev.values() if d.get("open_age_p90") is not None]
    oldest = max(p90s) if p90s else None
    return sla, oldest
