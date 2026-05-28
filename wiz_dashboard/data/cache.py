"""On-disk "last known good" snapshot of the most recent results."""

import datetime
import json
from pathlib import Path

from wiz_dashboard.config import CACHE_FILENAME, DEFAULT_CACHE_TTL_MINUTES


def save_cache(results, filename: str = CACHE_FILENAME) -> None:
    try:
        obj = {
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "results": results,
        }
        Path(filename).write_text(
            json.dumps(obj, indent=2, default=str, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        # Never fail the app over a cache-write problem.
        pass


def load_cache(
    filename: str = CACHE_FILENAME, max_age_minutes: int = DEFAULT_CACHE_TTL_MINUTES
):
    p = Path(filename)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        ts = data.get("ts")
        if not ts:
            return data.get("results")
        try:
            dt = datetime.datetime.fromisoformat(ts)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
        except Exception:
            return data.get("results")
        now = datetime.datetime.now(datetime.timezone.utc)
        if (
            max_age_minutes is not None
            and ((now - dt).total_seconds() / 60.0) > max_age_minutes
        ):
            return None
        return data.get("results")
    except Exception:
        return None


def clear_cache(filename: str = CACHE_FILENAME) -> None:
    try:
        p = Path(filename)
        if p.exists():
            p.unlink()
    except Exception:
        pass
