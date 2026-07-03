"""On-disk "last known good" snapshot of the most recent results."""

import datetime
import gzip
import json
import logging
import os
import re
from pathlib import Path

from wiz_dashboard.config import CACHE_FILENAME, DEFAULT_CACHE_TTL_MINUTES

logger = logging.getLogger(__name__)

# Matches the archive writer's choice (data.ledger): level 6 is where gzip's
# ratio-vs-speed trade-off flattens out for repetitive JSON.
_GZIP_LEVEL = 6
_GZIP_MAGIC = b"\x1f\x8b"


def _resolve_existing(filename):
    """The snapshot path to read: ``filename`` itself, or — when a ``.gz`` name is
    missing — its pre-compression plain twin, so an upgrade keeps the last-known-good
    snapshot instead of silently starting cold. ``None`` when neither exists."""
    p = Path(filename)
    if p.exists():
        return p
    if p.suffix == ".gz":
        legacy = p.with_name(p.name.removesuffix(".gz"))
        if legacy.exists():
            return legacy
    return None


def _open_text(path):
    """Text handle over a snapshot file, transparently gunzipping when the CONTENT is
    gzip (magic bytes, not extension) so plain pre-compression files stay readable."""
    p = Path(path)
    with open(p, "rb") as fh:
        magic = fh.read(2)
    if magic == _GZIP_MAGIC:
        return gzip.open(p, "rt", encoding="utf-8")
    return open(p, "r", encoding="utf-8")


def save_cache(results, filename: str = CACHE_FILENAME) -> bool:
    """Write the snapshot. Never raises; logs and returns False on failure."""
    tmp = None
    try:
        obj = {
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "results": results,
        }
        # Compact JSON (pretty-printing roughly doubles the dump time of a snapshot
        # nothing human reads), streamed through gzip so the full scan's findings cost
        # ~10x less disk and no second in-memory serialized copy. Dict order keeps
        # "ts" first — peek_saved_at reads only the head. Atomic (tmp + os.replace):
        # compressing a full scan takes seconds, and a crash mid-write must not
        # truncate the previous last-known-good snapshot.
        p = Path(filename)
        tmp = p.with_name(p.name + ".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=_GZIP_LEVEL) as fh:
            json.dump(obj, fh, default=str, ensure_ascii=False)
        os.replace(tmp, p)
        if p.suffix == ".gz":
            # This snapshot supersedes a pre-compression plain twin — reclaim it (it
            # is a full uncompressed findings payload) instead of shadowing it forever.
            p.with_name(p.name.removesuffix(".gz")).unlink(missing_ok=True)
        return True
    except Exception:
        # Never fail the app over a cache-write problem -- but make it visible.
        logger.warning("Failed to write cache snapshot to %s", filename, exc_info=True)
        if tmp is not None:
            try:
                Path(tmp).unlink(missing_ok=True)
            except Exception:
                pass
        return False


def _read_snapshot(filename):
    """Parse the snapshot dict, falling back from a corrupt ``.gz`` (e.g. a write that
    predates the atomic tmp+replace) to a still-valid plain twin. ``None`` if neither
    exists or parses."""
    p = _resolve_existing(filename)
    if p is None:
        return None
    candidates = [p]
    if p.suffix == ".gz":
        twin = p.with_name(p.name.removesuffix(".gz"))
        if twin.exists():
            candidates.append(twin)
    for c in candidates:
        try:
            with _open_text(c) as fh:
                return json.load(fh)
        except Exception:
            logger.warning("Failed to read cache snapshot from %s", c, exc_info=True)
    return None


def load_cache(
    filename: str = CACHE_FILENAME, max_age_minutes: int = DEFAULT_CACHE_TTL_MINUTES
):
    try:
        data = _read_snapshot(filename)
        if data is None:
            return None
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
    make a simple "when was this saved" check as slow as a full cache load. Gzip keeps
    this property: ``read(4096)`` decompresses only the leading chunk.

    Never raises and never returns None -- falls back to "an unknown time" so callers can
    always interpolate it into a sentence without their own None-check.
    """
    try:
        p = _resolve_existing(filename)
        if p is None:
            return "an unknown time"
        with _open_text(p) as fh:
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
        p.unlink(missing_ok=True)
        if p.suffix == ".gz":  # also drop a pre-compression plain twin
            p.with_name(p.name.removesuffix(".gz")).unlink(missing_ok=True)
    except Exception:
        pass
