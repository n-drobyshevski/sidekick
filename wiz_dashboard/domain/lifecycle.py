"""Cross-scan vulnerability identity and ledger-sourced MTTR.

``vuln_key`` gives each finding a stable identity across scans, so the same vulnerability
on the same asset reconciles from one scan to the next. ``mttr_from_ledger`` computes the
same ``(per_sev, overall)`` contract as ``metrics.calculate_mttr`` — but from the observed
lifecycles in the durable ledger (first seen → resolved) rather than a single scan
snapshot, which is what makes MTTR correct when remediation shows up as a finding simply
disappearing between scans.
"""

import hashlib

import pandas as pd

from wiz_dashboard.domain.metrics import _summarize
from wiz_dashboard.domain.severity import normalize_severity


def _present(v) -> bool:
    """True when a value is a real, non-empty scalar (treats NaN/NaT/'' as missing).

    ``df.to_dict("records")`` turns absent cells into ``float('nan')``, which is truthy —
    so callers must not test raw truthiness. This is the single gate for that.
    """
    if v is None:
        return False
    try:
        if not isinstance(v, (list, dict)) and pd.isna(v):
            return False
    except (TypeError, ValueError):
        pass
    if isinstance(v, str) and not v.strip():
        return False
    return True


def field(record, *keys) -> str:
    """First present value among dotted keys, tolerating nested ``vulnerableAsset`` dicts.

    Accepts both the flattened ``vulnerableAsset.name`` columns produced by
    ``nodes_to_dataframe`` and the nested ``{"vulnerableAsset": {"name": ...}}`` raw node.
    Returns ``""`` when nothing matches.
    """
    for k in keys:
        v = record.get(k)
        if _present(v):
            return str(v)
    va = record.get("vulnerableAsset")
    if isinstance(va, dict):
        for k in keys:
            v = va.get(k.split(".")[-1])
            if _present(v):
                return str(v)
    return ""


def vuln_key(record) -> str:
    """Stable cross-scan identity for a finding.

    Prefers the Wiz finding ``id`` (stable per finding) → ``"id:<id>"``. Falls back to a
    sha1 over the semantic identity (CVE + asset id/name + type + cloud + component) →
    ``"h:<hash>"`` so the same vuln on the same asset still reconciles when no id is
    present (e.g. the dry-run sample's assets carry only a name).
    """
    fid = record.get("id")
    if isinstance(fid, str) and fid.strip():
        return f"id:{fid.strip()}"

    cve = field(record, "name")
    asset = field(record, "vulnerableAsset.id", "assetId") or field(
        record, "vulnerableAsset.name"
    )
    atype = field(record, "vulnerableAsset.type", "type")
    cloud = field(record, "vulnerableAsset.cloudPlatform", "cloudPlatform")
    component = field(record, "detailedName", "detailedNameV2")
    basis = "|".join([cve, asset, atype, cloud, component])
    return "h:" + hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]


def mttr_from_ledger(ledger_rows, *, now=None):
    """Compute ``(per_sev, overall)`` from durable ledger lifecycle rows.

    ``ledger_rows``: iterable of mappings with ``severity``, ``first_seen``, ``status``
    and ``resolved_at``. MTTR-days = ``resolved_at - first_seen``; open age =
    ``now - first_seen``. Returns the exact shape of ``metrics.calculate_mttr`` so the
    MTTR hero, ``render_mttr_widget`` and ``sla_posture`` render it unchanged. Returns
    ``({}, {})`` when there are no rows.
    """
    rows = list(ledger_rows)
    if not rows:
        return {}, {}
    df = pd.DataFrame(rows)
    work = pd.DataFrame(index=df.index)
    work["_sev"] = (
        df["severity"].apply(normalize_severity)
        if "severity" in df.columns
        else "UNKNOWN"
    )
    work["_first_seen"] = pd.to_datetime(df.get("first_seen"), errors="coerce", utc=True)
    work["_resolved"] = pd.to_datetime(df.get("resolved_at"), errors="coerce", utc=True)
    return _summarize(work, now=now)
