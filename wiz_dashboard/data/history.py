"""Persistent MTTR history — one snapshot per UTC day (latest wins).

Each successful scan with a computable median appends/updates today's point, so a
median-days-over-time trend accumulates across runs. Stored as a small JSON list
next to the app (git-ignored).
"""

import datetime
import json
import logging
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

HISTORY_FILENAME = "mttr_history.json"
_COLUMNS = ["date", "median_days", "resolved", "open", "total", "sla_pct", "oldest_open_days"]


def _today_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def _read(filename: str):
    p = Path(filename)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        logger.warning("Failed to read MTTR history from %s", filename, exc_info=True)
        return []


def _write(filename: str, records) -> bool:
    try:
        Path(filename).write_text(json.dumps(records, indent=2), encoding="utf-8")
        return True
    except Exception:
        # Never fail a scan over a history-write problem -- but make it visible.
        logger.warning("Failed to write MTTR history to %s", filename, exc_info=True)
        return False


def record_snapshot(
    median_days,
    resolved=0,
    open_=0,
    counts=None,
    filename: str = HISTORY_FILENAME,
    when: str | None = None,
    sla_pct=None,
    oldest_open_days=None,
) -> bool:
    """Upsert today's MTTR snapshot (one point per UTC day; the latest wins).

    ``sla_pct`` (In-SLA %) and ``oldest_open_days`` are optional headline KPIs stored so the
    MTTR page can show their scan-over-scan change; older snapshots simply omit them.
    Returns True on a successful write, False if the snapshot couldn't be persisted.
    """
    date = when or _today_iso()
    records = [r for r in _read(filename) if r.get("date") != date]
    records.append(
        {
            "date": date,
            "median_days": round(float(median_days), 3),
            "resolved": int(resolved),
            "open": int(open_),
            "total": int(sum(counts.values())) if counts else 0,
            "sla_pct": (round(float(sla_pct), 1) if sla_pct is not None else None),
            "oldest_open_days": (
                round(float(oldest_open_days), 3) if oldest_open_days is not None else None
            ),
        }
    )
    records.sort(key=lambda r: r.get("date", ""))
    return _write(filename, records)


def load_history(filename: str = HISTORY_FILENAME) -> pd.DataFrame:
    """Return the history as a DataFrame sorted by date (empty if none/unreadable)."""
    records = _read(filename)
    if not records:
        return pd.DataFrame(columns=_COLUMNS)
    df = pd.DataFrame(records)
    df["date"] = pd.to_datetime(df.get("date"), errors="coerce")
    return df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
