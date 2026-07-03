"""Pure cross-scan reconciliation — the heart of correct MTTR.

Given the current scan's findings and the prior ledger, this produces the updated ledger,
a per-scan ``observations`` log and the scan deltas. It has NO database or Streamlit
dependency so it is exhaustively unit-testable; ``data.ledger`` is the thin layer that
loads the prior ledger, calls ``reconcile`` and writes the result in one transaction.

Lifecycle rules:
  * First sighting      → OPEN, ``first_seen = min(API firstDetectedAt, scan ts)``.
  * Persisting (OPEN)   → advance ``last_seen``; keep ``first_seen`` earliest-known.
  * API-resolved        → ``resolvedAt`` present or status in ``RESOLVED_STATUSES``.
  * Disappearance       → was OPEN and present in the *immediately previous* scan but
                          absent now → resolved at the current scan ts (the usual
                          real-world remediation signal).
  * Reopen              → a RESOLVED vuln reappears as *active* (API not resolved) →
                          OPEN again, ``reopened_count++``, ``first_seen`` reset to start
                          a new episode.
"""

from datetime import datetime, timezone

import pandas as pd

from wiz_dashboard.config import RESOLVED_STATUSES
from wiz_dashboard.domain.lifecycle import field, vuln_key
from wiz_dashboard.domain.severity import normalize_severity


def _clean(v):
    """Return ``None`` for missing/NaN/NaT/empty scalars, else the value unchanged."""
    if v is None:
        return None
    try:
        if not isinstance(v, (list, dict)) and pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, str) and not v.strip():
        return None
    return v


def _parse(ts):
    """Parse an ISO timestamp (``Z`` or offset) to an aware UTC datetime, or ``None``."""
    ts = _clean(ts)
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    s = str(ts).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt):
    """Canonical UTC ISO (``…Z``) for an aware datetime, or ``None``."""
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _min_iso(*values):
    """Earliest of the given timestamp values, as canonical ISO (``None`` if all empty)."""
    parsed = [d for d in (_parse(v) for v in values) if d is not None]
    return _iso(min(parsed)) if parsed else None


def _midpoint_iso(a, b):
    """Canonical ISO halfway between two timestamps (falls back to whichever parses)."""
    da, db = _parse(a), _parse(b)
    if da is None or db is None:
        return _iso(db) or _iso(da)
    return _iso(da + (db - da) / 2)


def _make_row(record, key, sev, first_seen, scan_id, scan_ts):
    return {
        "vuln_key": key,
        "cve": _clean(record.get("name")),
        "severity": sev,
        "asset_id": field(record, "vulnerableAsset.id") or None,
        "asset_name": field(record, "vulnerableAsset.name") or None,
        "asset_type": field(record, "vulnerableAsset.type") or None,
        "cloud": field(record, "vulnerableAsset.cloudPlatform") or None,
        "first_seen": first_seen,
        "last_seen": scan_ts,
        "status": "OPEN",
        "resolved_at": None,
        "resolution_src": None,
        "reopened_count": 0,
        "first_scan_id": scan_id,
        "last_scan_id": scan_id,
    }


def reconcile(
    current_records,
    existing_ledger,
    scan_id,
    scan_ts,
    prev_scan_id,
    *,
    disappearance_mode="scan_ts",
    prev_scan_ts=None,
):
    """Reconcile one flat scan against the prior ledger.

    Args:
        current_records: list of dict, one per finding (flat shape; dotted or nested keys).
        existing_ledger: ``{vuln_key: row}`` loaded from the durable base.
        scan_id / scan_ts: identity + timestamp of this scan (ISO; usually equal).
        prev_scan_id: the immediately-previous scan's id, or ``None`` for the first scan.
        disappearance_mode: ``"scan_ts"`` (default) or ``"midpoint"`` for the inferred
            resolution timestamp; ``prev_scan_ts`` is required for ``"midpoint"``.

    Returns:
        ``(updated_ledger, observations, deltas)`` where ``deltas`` is
        ``{new_count, resolved_count, reopened_count}``.
    """
    # Ledger rows are flat dicts of scalars, so a per-row shallow copy gives the same
    # don't-mutate-the-input guarantee as deepcopy at a fraction of the cost (deepcopy
    # walked every cell of a 100k+-row ledger on every scan).
    updated = {key: dict(row) for key, row in existing_ledger.items()}
    seen = set()
    observations = []
    new_count = resolved_count = reopened_count = 0

    scan_ts_iso = _iso(_parse(scan_ts)) or str(scan_ts)

    for rec in current_records:
        key = vuln_key(rec)
        if key in seen:  # duplicate finding within the same scan — first wins
            continue
        seen.add(key)

        sev = normalize_severity(_clean(rec.get("severity")))
        api_first = (
            _clean(rec.get("firstDetectedAt"))
            or _clean(rec.get("firstSeenAt"))
            or _clean(rec.get("createdAt"))
        )
        api_status = str(_clean(rec.get("status")) or "").upper()
        api_resolved = (
            _clean(rec.get("resolvedAt"))
            or _clean(rec.get("remediatedAt"))
            or _clean(rec.get("fixedAt"))
        )
        api_says_resolved = bool(api_resolved) or api_status in RESOLVED_STATUSES

        row = updated.get(key)
        if row is None:
            first_seen = _min_iso(api_first, scan_ts_iso) or scan_ts_iso
            row = _make_row(rec, key, sev, first_seen, scan_id, scan_ts_iso)
            updated[key] = row
            new_count += 1
        elif row["status"] == "RESOLVED" and not api_says_resolved:
            # Genuine reopen: a previously-resolved vuln is active again. Start a new
            # episode so the next resolution measures THIS episode, not the original.
            row["status"] = "OPEN"
            row["resolved_at"] = None
            row["resolution_src"] = None
            row["reopened_count"] = int(row.get("reopened_count", 0)) + 1
            row["first_seen"] = _min_iso(api_first, scan_ts_iso) or scan_ts_iso
            row["last_seen"] = scan_ts_iso
            row["last_scan_id"] = scan_id
            reopened_count += 1
        else:
            # Persisting (OPEN) or a still-resolved finding being re-listed. Keep
            # first_seen earliest-known; never let it drift later.
            if row["status"] == "OPEN":
                row["first_seen"] = (
                    _min_iso(row.get("first_seen"), api_first) or row.get("first_seen")
                )
            row["last_seen"] = scan_ts_iso
            row["last_scan_id"] = scan_id

        # Latest observation wins for display attributes.
        row["severity"] = sev
        row["cve"] = _clean(rec.get("name"))
        row["asset_id"] = field(rec, "vulnerableAsset.id") or row.get("asset_id")
        row["asset_name"] = field(rec, "vulnerableAsset.name") or row.get("asset_name")
        row["asset_type"] = field(rec, "vulnerableAsset.type") or row.get("asset_type")
        row["cloud"] = field(rec, "vulnerableAsset.cloudPlatform") or row.get("cloud")

        # API-declared resolution closes a currently-open row.
        if api_says_resolved and row["status"] == "OPEN":
            row["status"] = "RESOLVED"
            row["resolved_at"] = _iso(_parse(api_resolved)) if api_resolved else scan_ts_iso
            row["resolution_src"] = "api"
            resolved_count += 1

        observations.append(
            {
                "scan_id": scan_id,
                "vuln_key": key,
                "present": 1,
                "severity": sev,
                "status": row["status"],
            }
        )

    # Disappearance: OPEN vulns present in the immediately-previous scan but absent now.
    if prev_scan_id is not None:
        for key, row in updated.items():
            if key in seen or row["status"] == "RESOLVED":
                continue
            if row.get("last_scan_id") != prev_scan_id:
                continue
            if disappearance_mode == "midpoint" and prev_scan_ts:
                row["resolved_at"] = _midpoint_iso(prev_scan_ts, scan_ts_iso)
            else:
                row["resolved_at"] = scan_ts_iso
            row["status"] = "RESOLVED"
            row["resolution_src"] = "disappeared"
            resolved_count += 1
            observations.append(
                {
                    "scan_id": scan_id,
                    "vuln_key": key,
                    "present": 0,
                    "severity": row.get("severity"),
                    "status": "RESOLVED",
                }
            )

    deltas = {
        "new_count": new_count,
        "resolved_count": resolved_count,
        "reopened_count": reopened_count,
    }
    return updated, observations, deltas
