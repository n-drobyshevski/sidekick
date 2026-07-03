"""On-disk "last known good" snapshot of the most recent results."""

import datetime
import json
import logging
import re
from pathlib import Path

from wiz_dashboard.config import CACHE_FILENAME, DEFAULT_CACHE_TTL_MINUTES

logger = logging.getLogger(__name__)


def save_cache(results, filename: str = CACHE_FILENAME) -> bool:
    """Write the snapshot. Never raises; logs and returns False on failure."""
    try:
        obj = {
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "results": results,
        }
        Path(filename).write_text(
            json.dumps(obj, indent=2, default=str, ensure_ascii=False), encoding="utf-8"
        )
        return True
    except Exception:
        # Never fail the app over a cache-write problem -- but make it visible.
        logger.warning("Failed to write cache snapshot to %s", filename, exc_info=True)
        return False


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
        logger.warning("Failed to read cache snapshot from %s", filename, exc_info=True)
        return None


def peek_saved_at(filename: str = CACHE_FILENAME) -> str:
    """Best-effort human-readable timestamp of the on-disk snapshot, for UI messaging.

    Reads only the first few KB of the file and regex-extracts the leading ``"ts"`` field
    -- ``save_cache`` always writes it first -- instead of ``json.loads``-ing the whole
    file, which can be very large (a full scan's worth of findings) and would otherwise
    make a simple "when was this saved" check as slow as a full cache load.

    Never raises and never returns None -- falls back to "an unknown time" so callers can
    always interpolate it into a sentence without their own None-check.
    """
    try:
        with open(filename, "r", encoding="utf-8") as fh:
            head = fh.read(4096)
        match = re.search(r'"ts"\s*:\s*"([^"]+)"', head)
        if not match:
            return "an unknown time"
        dt = datetime.datetime.fromisoformat(match.group(1))
        return dt.strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return "an unknown time"


def clear_cache(filename: str = CACHE_FILENAME) -> None:
    try:
        p = Path(filename)
        if p.exists():
            p.unlink()
    except Exception:
        pass
