"""Persistent MTTR history — one snapshot per UTC day (latest wins).

Each successful scan with a computable median appends/updates today's point, so a
median-days-over-time trend accumulates across runs. Stored as a small JSON list
next to the app (git-ignored).
"""

import datetime
import json
from pathlib import Path

import pandas as pd

HISTORY_FILENAME = "mttr_history.json"
_COLUMNS = ["date", "median_days", "resolved", "open", "total"]


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
        return []


def _write(filename: str, records) -> None:
    try:
        Path(filename).write_text(json.dumps(records, indent=2), encoding="utf-8")
    except Exception:
        # Never fail a scan over a history-write problem.
        pass


def record_snapshot(
    median_days,
    resolved=0,
    open_=0,
    counts=None,
    filename: str = HISTORY_FILENAME,
    when: str | None = None,
) -> None:
    """Upsert today's MTTR snapshot (one point per UTC day; the latest wins)."""
    date = when or _today_iso()
    records = [r for r in _read(filename) if r.get("date") != date]
    records.append(
        {
            "date": date,
            "median_days": round(float(median_days), 3),
            "resolved": int(resolved),
            "open": int(open_),
            "total": int(sum(counts.values())) if counts else 0,
        }
    )
    records.sort(key=lambda r: r.get("date", ""))
    _write(filename, records)


def load_history(filename: str = HISTORY_FILENAME) -> pd.DataFrame:
    """Return the history as a DataFrame sorted by date (empty if none/unreadable)."""
    records = _read(filename)
    if not records:
        return pd.DataFrame(columns=_COLUMNS)
    df = pd.DataFrame(records)
    df["date"] = pd.to_datetime(df.get("date"), errors="coerce")
    return df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
