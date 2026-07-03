"""On-disk snapshot of a scan's *parsed* findings DataFrame.

Written beside the raw JSON archive at scan time (``data/scans/<id>.json`` →
``data/scans/<id>.df.pkl``) so app start-up can restore the frame directly instead of
re-running ``json.loads`` + ``pd.json_normalize`` over 100k+ nested nodes — the two
steps that dominate a cold start on a large tenant.

Pickle (not parquet/feather) is deliberate: the flattened Wiz frame carries list- and
list-of-dict object cells that Arrow either rejects or round-trips as ndarray cells,
while pickle preserves those, the category dtypes, and the RangeIndex the drill-down's
positional row→node mapping relies on. The file is app-written and app-read on the same
machine, so pickle's trust caveat doesn't apply. A versioned wrapper + fail-to-``None``
reads mean a pandas upgrade or corrupt file can never brick start-up — callers fall back
to the JSON archive and rewrite the snapshot.
"""

import logging
import os
import pickle
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

SNAPSHOT_VERSION = 1
_SUFFIX = ".df.pkl"


def snapshot_path_for(raw_path) -> Path:
    """The snapshot path that belongs to a raw archive path (same directory + stem)."""
    p = Path(raw_path)
    return p.with_name(p.stem + _SUFFIX)


def write_snapshot(raw_path, df) -> str | None:
    """Write ``df`` as the parsed-frame snapshot for ``raw_path``'s scan.

    Atomic (tmp file + ``os.replace``) because two sessions may backfill the same
    missing snapshot concurrently. Never raises; returns the path or ``None``.
    """
    path = snapshot_path_for(raw_path)
    tmp = path.with_name(path.name + ".tmp")
    try:
        payload = {"version": SNAPSHOT_VERSION, "pandas": pd.__version__, "df": df}
        with open(tmp, "wb") as fh:
            pickle.dump(payload, fh, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, path)
        return str(path)
    except Exception:
        logger.warning("Failed to write frame snapshot %s", path, exc_info=True)
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
        return None


def read_snapshot(raw_path):
    """Load the parsed-frame snapshot for ``raw_path``'s scan.

    Returns the DataFrame, or ``None`` when the snapshot is missing, unreadable, from a
    different snapshot version, or doesn't hold a DataFrame — callers must treat ``None``
    as "re-parse the JSON archive" (and may backfill via ``write_snapshot``).
    """
    if not raw_path:
        return None
    path = snapshot_path_for(raw_path)
    if not path.exists():
        return None
    try:
        with open(path, "rb") as fh:
            payload = pickle.load(fh)
        if not isinstance(payload, dict) or payload.get("version") != SNAPSHOT_VERSION:
            return None
        df = payload.get("df")
        return df if isinstance(df, pd.DataFrame) else None
    except Exception:
        logger.warning("Failed to read frame snapshot %s", path, exc_info=True)
        return None
