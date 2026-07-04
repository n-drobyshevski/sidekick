"""Durable scan archive + deduplicated vulnerability ledger (SQLite).

This is the persistence layer behind correct MTTR. Every scan is saved to a ``scans``
row (raw JSON archived alongside), reconciled into a per-vulnerability ``vuln_ledger``
(the deduplicated base), and logged per-scan in ``observations``. The pure diff lives in
``domain.reconcile``; this module only loads the prior ledger, calls it, and writes the
result in one transaction.

Functions take ``db_path=None`` (defaulting to ``config.DATA_DIR / config.LEDGER_DB_FILENAME``)
so tests can point at a ``tmp_path``. Writes never assume the DB exists — ``init_db`` is
idempotent and lazy.
"""

import gzip
import json
import logging
import os
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from wiz_dashboard import config
from wiz_dashboard.domain import reconcile
from wiz_dashboard.domain.severity import normalize_severity
from wiz_dashboard.data import snapshot
from wiz_dashboard.data.transform import extract_nodes

logger = logging.getLogger(__name__)

# v2: dropped ``vuln_ledger.latest_json`` — a full finding payload per row that nothing
# ever read (the raw archive keeps the complete finding), yet dominated the DB's size and
# was deserialized on every persist and every Scan History load.
SCHEMA_VERSION = 2

# gzip trades a once-per-scan compression cost for ~10x smaller archives; level 6 because
# higher levels barely shrink JSON further while getting markedly slower.
_GZIP_LEVEL = 6
_GZIP_MAGIC = b"\x1f\x8b"

LEDGER_COLUMNS = [
    "vuln_key", "cve", "severity", "asset_id", "asset_name", "asset_type", "cloud",
    "first_seen", "last_seen", "status", "resolved_at", "resolution_src",
    "reopened_count", "first_scan_id", "last_scan_id",
]

_SCANS_COLUMNS = [
    "scan_id", "ts", "mode", "shape", "total",
    "new_count", "resolved_count", "reopened_count", "raw_path",
]


# --------------------------------------------------------------------------- #
#  Paths + connection
# --------------------------------------------------------------------------- #
def _resolve(db_path):
    return Path(db_path) if db_path else config.DATA_DIR / config.LEDGER_DB_FILENAME


def _archive_dir(db_path):
    # Keep the raw archive next to the DB so a tmp_path test stays self-contained.
    return _resolve(db_path).parent / config.SCAN_ARCHIVE_DIRNAME


def _connect(db_path):
    path = _resolve(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # 30s busy timeout (not the 5s default): the one-time v1->v2 migration rewrites the
    # whole vuln_ledger table, and a concurrent session must wait it out, not error.
    conn = sqlite3.connect(str(path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db(db_path=None) -> None:
    """Create the schema (idempotent) and the data/archive directories."""
    conn = _connect(db_path)
    try:
        with conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS scans (
                    scan_id TEXT PRIMARY KEY,
                    ts TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    shape TEXT NOT NULL,
                    total INTEGER NOT NULL,
                    new_count INTEGER DEFAULT 0,
                    resolved_count INTEGER DEFAULT 0,
                    reopened_count INTEGER DEFAULT 0,
                    raw_path TEXT
                );
                CREATE TABLE IF NOT EXISTS vuln_ledger (
                    vuln_key TEXT PRIMARY KEY,
                    cve TEXT,
                    severity TEXT,
                    asset_id TEXT,
                    asset_name TEXT,
                    asset_type TEXT,
                    cloud TEXT,
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    status TEXT NOT NULL,
                    resolved_at TEXT,
                    resolution_src TEXT,
                    reopened_count INTEGER DEFAULT 0,
                    first_scan_id TEXT,
                    last_scan_id TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_ledger_status ON vuln_ledger(status);
                CREATE INDEX IF NOT EXISTS idx_ledger_severity ON vuln_ledger(severity);
                CREATE TABLE IF NOT EXISTS observations (
                    scan_id TEXT NOT NULL,
                    vuln_key TEXT NOT NULL,
                    present INTEGER NOT NULL,
                    severity TEXT,
                    status TEXT,
                    PRIMARY KEY (scan_id, vuln_key)
                );
                CREATE INDEX IF NOT EXISTS idx_obs_scan ON observations(scan_id);
                CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
                """
            )
            if conn.execute("SELECT COUNT(*) FROM schema_meta").fetchone()[0] == 0:
                conn.execute("INSERT INTO schema_meta (version) VALUES (?)", (SCHEMA_VERSION,))
        _migrate(conn)
    finally:
        conn.close()
    _archive_dir(db_path).mkdir(parents=True, exist_ok=True)


def _migrate(conn) -> None:
    """Upgrade an existing DB to ``SCHEMA_VERSION`` in place.

    v1 → v2 drops ``vuln_ledger.latest_json``. ``BEGIN IMMEDIATE`` + a version re-check
    keep concurrent sessions from racing the migration; the VACUUM that actually reclaims
    the dropped column's space is best-effort (it can't run inside a transaction and may
    lose a lock race) — a skipped VACUUM just defers reclamation to the next start.
    """
    row = conn.execute("SELECT version FROM schema_meta").fetchone()
    if row is None or row[0] >= SCHEMA_VERSION:
        return
    try:
        conn.execute("BEGIN IMMEDIATE")
    except sqlite3.OperationalError:
        # Another session holds the write lock (most likely running this very
        # migration). Don't fail the caller — v1 stays readable/writable with the
        # extra column ignored, and the next init_db retries.
        logger.warning("Schema migration deferred: database is locked by another session.")
        return
    try:
        row = conn.execute("SELECT version FROM schema_meta").fetchone()
        if row is not None and row[0] < SCHEMA_VERSION:
            cols = {r[1] for r in conn.execute("PRAGMA table_info(vuln_ledger)")}
            if "latest_json" in cols:
                try:
                    conn.execute("ALTER TABLE vuln_ledger DROP COLUMN latest_json")
                except sqlite3.OperationalError:
                    # SQLite < 3.35 has no DROP COLUMN: rebuild the table without it.
                    keep = ",".join(LEDGER_COLUMNS)
                    conn.execute("ALTER TABLE vuln_ledger RENAME TO vuln_ledger_v1")
                    conn.execute(
                        """
                        CREATE TABLE vuln_ledger (
                            vuln_key TEXT PRIMARY KEY,
                            cve TEXT,
                            severity TEXT,
                            asset_id TEXT,
                            asset_name TEXT,
                            asset_type TEXT,
                            cloud TEXT,
                            first_seen TEXT NOT NULL,
                            last_seen TEXT NOT NULL,
                            status TEXT NOT NULL,
                            resolved_at TEXT,
                            resolution_src TEXT,
                            reopened_count INTEGER DEFAULT 0,
                            first_scan_id TEXT,
                            last_scan_id TEXT
                        )
                        """
                    )
                    conn.execute(
                        f"INSERT INTO vuln_ledger ({keep}) SELECT {keep} FROM vuln_ledger_v1"
                    )
                    conn.execute("DROP TABLE vuln_ledger_v1")
                    conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_ledger_status ON vuln_ledger(status)"
                    )
                    conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_ledger_severity ON vuln_ledger(severity)"
                    )
            conn.execute("UPDATE schema_meta SET version=?", (SCHEMA_VERSION,))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    try:
        conn.execute("VACUUM")
    except Exception:
        logger.warning("Post-migration VACUUM skipped; space reclaimed on a later start.",
                       exc_info=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- #
#  Internal read/write helpers
# --------------------------------------------------------------------------- #
def _existing_scan_deltas(conn, scan_id):
    """Return stored deltas if this exact scan is already saved (idempotency), else None."""
    row = conn.execute(
        "SELECT new_count, resolved_count, reopened_count FROM scans WHERE scan_id=?",
        (scan_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "new_count": row["new_count"],
        "resolved_count": row["resolved_count"],
        "reopened_count": row["reopened_count"],
    }


def _latest_scan(conn):
    row = conn.execute("SELECT scan_id, ts FROM scans ORDER BY ts DESC LIMIT 1").fetchone()
    return (row["scan_id"], row["ts"]) if row else None


def _load_ledger_map(conn):
    # Explicit columns (not *): on a not-yet-migrated v1 DB this must not haul the
    # dropped-in-v2 latest_json blobs (a full findings payload) into every reconcile.
    cols = ",".join(LEDGER_COLUMNS)
    return {r["vuln_key"]: dict(r) for r in conn.execute(f"SELECT {cols} FROM vuln_ledger")}


def _upsert_ledger(conn, rows):
    placeholders = ",".join("?" for _ in LEDGER_COLUMNS)
    conn.executemany(
        f"INSERT OR REPLACE INTO vuln_ledger ({','.join(LEDGER_COLUMNS)}) "
        f"VALUES ({placeholders})",
        [tuple(row.get(c) for c in LEDGER_COLUMNS) for row in rows],
    )


def _archive_raw(db_path, scan_id, payload):
    """Write the raw scan JSON, gzipped; returns the path or None (never raises).

    Atomic (tmp + ``os.replace``): a half-written archive must never be left behind —
    delete→rebuild refuses to run when a survivor's archive is unreadable. ``json.dump``
    streams into the gzip handle so the ~100s-of-MB serialized text never exists in
    memory alongside the payload.
    """
    tmp = None
    try:
        safe = re.sub(r"[^0-9A-Za-z._-]", "", scan_id) or "scan"
        path = _archive_dir(db_path) / f"{safe}.json.gz"
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=_GZIP_LEVEL) as fh:
            json.dump(payload, fh, default=str, ensure_ascii=False)
        os.replace(tmp, path)
        return str(path)
    except Exception:
        logger.warning("Failed to archive raw scan %s", scan_id, exc_info=True)
        if tmp is not None:
            Path(tmp).unlink(missing_ok=True)
        return None


# --------------------------------------------------------------------------- #
#  Writers
# --------------------------------------------------------------------------- #
def persist_flat_scan(records, *, mode, raw=None, db_path=None, scan_id=None,
                      disappearance_mode=None, df=None):
    """Save a flat per-finding scan and reconcile the ledger. Returns scan deltas.

    Idempotent: saving a scan whose ``scan_id`` already exists is a no-op (returns the
    stored deltas). ``scan_id`` defaults to the current UTC second.

    ``df`` (optional): the already-parsed findings DataFrame for this scan. When given,
    a parsed-frame snapshot is written beside the raw archive so app start-up can restore
    the frame without re-parsing 100k+ nested nodes (see ``data.snapshot``). Replay paths
    (delete→rebuild) pass no ``df``; survivors' existing snapshots stay valid because
    their data is unchanged, and nothing in the rebuild depends on snapshots.
    """
    records = list(records)
    db_path = _resolve(db_path)
    init_db(db_path)
    scan_id = scan_id or _now_iso()
    scan_ts = scan_id
    if disappearance_mode is None:
        disappearance_mode = config.DISAPPEARANCE_RESOLUTION

    conn = _connect(db_path)
    try:
        existing = _existing_scan_deltas(conn, scan_id)
        if existing is not None:
            return existing
        prev = _latest_scan(conn)
        prev_scan_id = prev[0] if prev else None
        prev_scan_ts = prev[1] if prev else None
        existing_ledger = _load_ledger_map(conn)

        updated, observations, deltas = reconcile.reconcile(
            records, existing_ledger, scan_id, scan_ts, prev_scan_id,
            disappearance_mode=disappearance_mode, prev_scan_ts=prev_scan_ts,
        )
        raw_path = _archive_raw(db_path, scan_id, raw if raw is not None else records)
        if df is not None and raw_path:
            snapshot.write_snapshot(raw_path, df)  # best-effort; start-up fast path

        with conn:
            conn.execute(
                f"INSERT INTO scans ({','.join(_SCANS_COLUMNS)}) "
                f"VALUES ({','.join('?' for _ in _SCANS_COLUMNS)})",
                (scan_id, scan_ts, mode, "flat", len(records),
                 deltas["new_count"], deltas["resolved_count"], deltas["reopened_count"],
                 raw_path),
            )
            _upsert_ledger(conn, updated.values())
            if observations:
                conn.executemany(
                    "INSERT OR REPLACE INTO observations "
                    "(scan_id, vuln_key, present, severity, status) VALUES (?,?,?,?,?)",
                    [(o["scan_id"], o["vuln_key"], o["present"], o["severity"], o["status"])
                     for o in observations],
                )
        return deltas
    finally:
        conn.close()


def persist_grouped_scan(nodes, *, mode, raw=None, db_path=None, scan_id=None):
    """Archive a grouped-by-asset scan WITHOUT per-vuln reconciliation.

    Grouped responses carry per-asset severity counts but no per-finding identity or
    timestamps, so they can't advance lifecycles. We still record the scan (for the
    history) and archive the raw payload. Returns zero deltas.
    """
    db_path = _resolve(db_path)
    init_db(db_path)
    scan_id = scan_id or _now_iso()
    zero = {"new_count": 0, "resolved_count": 0, "reopened_count": 0}
    conn = _connect(db_path)
    try:
        if _existing_scan_deltas(conn, scan_id) is not None:
            return zero
        raw_path = _archive_raw(db_path, scan_id, raw if raw is not None else nodes)
        with conn:
            conn.execute(
                f"INSERT INTO scans ({','.join(_SCANS_COLUMNS)}) "
                f"VALUES ({','.join('?' for _ in _SCANS_COLUMNS)})",
                (scan_id, scan_id, mode, "grouped", len(nodes), 0, 0, 0, raw_path),
            )
        return zero
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
#  Deletion / rebuild
# --------------------------------------------------------------------------- #
class LedgerRebuildError(RuntimeError):
    """A scan deletion can't rebuild the ledger (e.g. a surviving flat scan's archived
    payload is missing). Raised BEFORE any data is mutated, so the delete is refused."""


def _is_gzip(path) -> bool:
    """Whether the file starts with the gzip magic bytes (content, not extension —
    ``scans.raw_path`` may point at a pre-compression plain ``.json`` archive)."""
    with open(path, "rb") as fh:
        return fh.read(2) == _GZIP_MAGIC


def _read_raw_payload(raw_path):
    """Load an archived scan payload from disk; None if absent/unreadable.

    Reads both gzipped (current) and plain-JSON (pre-compression) archives, sniffed by
    magic bytes, so data dirs written before the gzip change stay readable forever.
    A stored plain path whose file was since compacted to ``.gz`` (stale session state,
    or a DB restored from ``.bak`` after a compaction) resolves to the sibling."""
    if not raw_path:
        return None
    p = Path(raw_path)
    if not p.exists():
        sibling = p.with_name(p.name + ".gz") if p.suffix != ".gz" else None
        if sibling is None or not sibling.exists():
            return None
        p = sibling
    try:
        if _is_gzip(p):
            with gzip.open(p, "rt", encoding="utf-8") as fh:
                return json.load(fh)
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Failed to read archived scan payload %s", raw_path, exc_info=True)
        return None


def _records_from_payload(payload):
    """Reconstruct a flat scan's per-finding records from its archived payload.

    Returns the raw nested nodes — the same shape ``ui.scan._persist_scan`` feeds a live
    persist (``vuln_key``/``field`` walk nested dicts), so delete->rebuild replay stays
    byte-faithful with the original reconciliation without a frame round-trip."""
    return extract_nodes(payload) or []


def _restore_db(db_path, bak):
    """Restore the DB from a snapshot, clearing WAL sidecars so SQLite doesn't replay a
    stale write-ahead log over the restored file. Removes the snapshot afterwards."""
    for suffix in ("-wal", "-shm"):
        try:
            Path(str(db_path) + suffix).unlink(missing_ok=True)
        except Exception:
            pass
    shutil.copy2(bak, db_path)
    bak.unlink(missing_ok=True)


def _reinsert_scan_row(db_path, row):
    """Re-insert a scans row verbatim from its stored columns. Used when a grouped
    survivor's archive is missing — grouped scans never touch the vuln ledger, so the
    row alone (preserving total/mode/shape) is a faithful rebuild."""
    conn = _connect(db_path)
    try:
        with conn:
            conn.execute(
                f"INSERT INTO scans ({','.join(_SCANS_COLUMNS)}) "
                f"VALUES ({','.join('?' for _ in _SCANS_COLUMNS)})",
                tuple(row.get(c) for c in _SCANS_COLUMNS),
            )
    finally:
        conn.close()


def delete_scan(scan_id, db_path=None) -> dict:
    """Delete one scan (convenience wrapper over ``delete_scans``)."""
    return delete_scans([scan_id], db_path=db_path)


def delete_scans(scan_ids, db_path=None) -> dict:
    """Delete saved scans and rebuild the derived ledger by replaying the survivors.

    The result is identical to a ledger that had only ever seen the surviving scans.
    Returns ``{"deleted", "scans", "tracked"}``. Raises ``LedgerRebuildError`` (before
    mutating) if a surviving *flat* scan's archived payload can't be replayed.
    Exception-safe: validates replayability and snapshots the DB before mutating,
    restoring it if the rebuild raises.
    """
    targets = {s for s in (scan_ids or []) if s}
    db_path = _resolve(db_path)
    zero = {"deleted": 0, "scans": 0, "tracked": 0}
    if not targets or not db_path.exists():
        return zero

    conn = _connect(db_path)
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM scans ORDER BY ts ASC, scan_id ASC"
        )]
    finally:
        conn.close()
    present = {r["scan_id"] for r in rows if r["scan_id"] in targets}
    if not present:
        return zero
    survivors = [r for r in rows if r["scan_id"] not in present]

    # Pre-load + validate every survivor's payload BEFORE mutating anything.
    replay = []
    for r in survivors:
        payload = _read_raw_payload(r["raw_path"])
        if payload is None and r["shape"] == "flat":
            raise LedgerRebuildError(
                f"Cannot delete: the archived payload for surviving scan "
                f"{r['scan_id']} is missing, so the ledger can't be rebuilt."
            )
        replay.append((r, payload))

    # Snapshot the DB (checkpoint WAL first so the copy is a complete database).
    bak = Path(str(db_path) + ".bak")
    cp = _connect(db_path)
    try:
        cp.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        cp.close()
    shutil.copy2(db_path, bak)

    try:
        # Wipe the derived tables, then replay survivors in ts order.
        conn = _connect(db_path)
        try:
            with conn:
                conn.execute("DELETE FROM vuln_ledger")
                conn.execute("DELETE FROM observations")
                conn.execute("DELETE FROM scans")
        finally:
            conn.close()

        for r, payload in replay:
            if r["shape"] == "grouped":
                if payload is None:
                    logger.warning(
                        "Grouped survivor %s has no archived payload; preserving its scans row "
                        "from stored columns (grouped scans don't affect the ledger).",
                        r["scan_id"],
                    )
                    _reinsert_scan_row(db_path, r)
                else:
                    persist_grouped_scan(
                        extract_nodes(payload), mode=r["mode"], raw=payload,
                        db_path=db_path, scan_id=r["scan_id"],
                    )
            else:
                # Replay uses the current config.DISAPPEARANCE_RESOLUTION (same as the original
                # persist, which never overrides it); it isn't stored per-scan.
                persist_flat_scan(
                    _records_from_payload(payload), mode=r["mode"], raw=payload,
                    db_path=db_path, scan_id=r["scan_id"],
                )
    except Exception:
        _restore_db(db_path, bak)
        raise
    else:
        bak.unlink(missing_ok=True)

    # Replay re-archives survivors in the current (gzipped) format; a pre-compression
    # survivor's stored raw_path therefore changes (.json -> .json.gz). Drop the
    # superseded plain files so rebuilds don't strand orphans (best-effort; the parsed-
    # frame snapshot is shared by both paths and stays).
    conn = _connect(db_path)
    try:
        fresh_paths = {
            r["scan_id"]: r["raw_path"]
            for r in conn.execute("SELECT scan_id, raw_path FROM scans")
        }
    finally:
        conn.close()
    for r in survivors:
        old, new = r["raw_path"], fresh_paths.get(r["scan_id"])
        if old and new and old != new:
            try:
                Path(old).unlink(missing_ok=True)
            except Exception:
                logger.warning("Couldn't remove superseded archive %s", old, exc_info=True)

    # Remove the deleted scans' archived payloads and their parsed-frame snapshots
    # (best-effort; survivors keep theirs — guard on BOTH their pre-replay and freshly
    # re-archived paths, since replay may have moved a legacy survivor to .json.gz).
    survivor_paths = {r["raw_path"] for r in survivors if r["raw_path"]}
    survivor_paths.update(p for p in fresh_paths.values() if p)
    for r in rows:
        if r["scan_id"] in present and r["raw_path"] and r["raw_path"] not in survivor_paths:
            try:
                Path(r["raw_path"]).unlink(missing_ok=True)
                snapshot.snapshot_path_for(r["raw_path"]).unlink(missing_ok=True)
            except Exception:
                logger.warning("Couldn't remove archived scan %s", r["raw_path"], exc_info=True)

    scans_df = load_scans_df(db_path)
    base_df = load_base_df(db_path)
    return {
        "deleted": len(present),
        "scans": 0 if scans_df.empty else len(scans_df),
        "tracked": 0 if base_df.empty else len(base_df),
    }


# --------------------------------------------------------------------------- #
#  Readers
# --------------------------------------------------------------------------- #
def load_scans_df(db_path=None) -> pd.DataFrame:
    """All saved scans, newest first (``ts`` as a UTC datetime)."""
    path = _resolve(db_path)
    if not path.exists():
        return pd.DataFrame(columns=_SCANS_COLUMNS)
    conn = _connect(db_path)
    try:
        df = pd.read_sql_query("SELECT * FROM scans", conn)
    finally:
        conn.close()
    if df.empty:
        return df
    df["ts"] = pd.to_datetime(df["ts"], errors="coerce", utc=True)
    return df.sort_values("ts", ascending=False).reset_index(drop=True)


def load_latest_scan_row(db_path=None):
    """Metadata of the most recent saved scan (``scans``-table row) or ``None``.

    The metadata-first read behind the start-up fast path: gives ``scan_id`` /
    ``raw_path`` / ``shape`` / ``total`` without touching (or parsing) the archived JSON,
    so hydration can restore from the parsed-frame snapshot and defer the raw payload."""
    df = load_scans_df(db_path)
    if df is None or df.empty:
        return None
    return df.iloc[0]  # newest-first


def load_latest_flat_scan_row(db_path=None):
    """Metadata of the most recent saved FLAT scan, or ``None``.

    The incremental quick refresh needs a per-finding baseline to merge into; the newest
    scan overall may be grouped-by-asset, which has no mergeable per-finding payload —
    so the baseline lookup filters on shape."""
    df = load_scans_df(db_path)
    if df is None or df.empty:
        return None
    flat = df[df["shape"] == "flat"]
    if flat.empty:
        return None
    return flat.iloc[0]  # newest-first


def load_latest_scan_payload(db_path=None):
    """Return ``(payload, row)`` for the most recent saved scan, or ``(None, None)``.

    ``payload`` is that scan's archived raw findings (re-readable for an offline redraw);
    ``row`` is its ``scans``-table metadata (``ts``, ``mode``, ``total``, ``shape`` …).
    No Wiz query — this is the durable-base read behind the sidebar "Refresh", which
    redraws from already-saved data instead of taking a new measurement. ``(None, None)``
    when no scan has ever been saved or its archived payload is missing/unreadable.
    """
    df = load_scans_df(db_path)
    if df is None or df.empty:
        return None, None
    row = df.iloc[0]  # load_scans_df is newest-first
    return _read_raw_payload(row.get("raw_path")), row


def load_base_df(db_path=None) -> pd.DataFrame:
    """The vulnerability ledger with computed ``mttr_days`` and open ``age_days``."""
    path = _resolve(db_path)
    if not path.exists():
        return pd.DataFrame(columns=LEDGER_COLUMNS + ["mttr_days", "age_days"])
    conn = _connect(db_path)
    try:
        # Explicit columns (not *): keeps a not-yet-migrated v1 DB from shipping its
        # latest_json blobs into the Scan History frame (and its CSV export).
        df = pd.read_sql_query(f"SELECT {','.join(LEDGER_COLUMNS)} FROM vuln_ledger", conn)
    finally:
        conn.close()
    if df.empty:
        return df
    now = pd.Timestamp.now(tz="UTC")
    first = pd.to_datetime(df["first_seen"], errors="coerce", utc=True)
    resolved = pd.to_datetime(df["resolved_at"], errors="coerce", utc=True)
    df["first_seen"] = first
    df["last_seen"] = pd.to_datetime(df["last_seen"], errors="coerce", utc=True)
    df["resolved_at"] = resolved
    df["mttr_days"] = (resolved - first).dt.total_seconds() / 86400
    df["age_days"] = ((now - first).dt.total_seconds() / 86400).where(resolved.isna())
    return df


def load_open_and_resolved(db_path=None):
    """Minimal ledger rows for ``lifecycle.mttr_from_ledger`` (list of dicts)."""
    path = _resolve(db_path)
    if not path.exists():
        return []
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            "SELECT vuln_key, severity, first_seen, status, resolved_at FROM vuln_ledger"
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


def previous_severity_counts(db_path=None) -> dict:
    """Per-severity finding counts of the *previous* flat scan (the second-to-last).

    The scan-over-scan baseline for the severity breakdown's change badges, read from the
    durable ``observations`` log so it survives across sessions — unlike the in-session
    ``os_prev_counts`` (empty until a second scan in the *same* session). This mirrors how
    the MTTR KPIs read their baseline from the durable trend, so the severity badges show
    as soon as two scans have ever been saved. Counts only vulns that were *present* in
    that scan (``present=1`` — disappearance rows are excluded) and folds raw severities
    through ``normalize_severity`` so the keys match ``count_by_severity``. Grouped scans
    write no observations, so the baseline is always the prior *flat* scan. Returns ``{}``
    when fewer than two flat scans exist.
    """
    path = _resolve(db_path)
    if not path.exists():
        return {}
    conn = _connect(db_path)
    try:
        flat_ids = [
            r["scan_id"]
            for r in conn.execute(
                "SELECT scan_id FROM scans WHERE shape='flat' ORDER BY ts"
            ).fetchall()
        ]
        if len(flat_ids) < 2:
            return {}
        rows = conn.execute(
            "SELECT severity, COUNT(*) AS n FROM observations "
            "WHERE scan_id=? AND present=1 GROUP BY severity",
            (flat_ids[-2],),
        ).fetchall()
    finally:
        conn.close()
    counts: dict = {}
    for r in rows:
        sev = normalize_severity(r["severity"])
        counts[sev] = counts.get(sev, 0) + int(r["n"])
    return counts


def load_trend_df(db_path=None) -> pd.DataFrame:
    """Open / resolved / median-MTTR / In-SLA% / oldest-open over time, from the ledger.

    For each saved flat scan timestamp, counts ledger vulns open vs resolved *as of* that
    instant and the median MTTR of everything resolved by then — plus the In-SLA share and
    the oldest-open age (max over severities of the p90 open age), matching the headline
    KPIs (see ``metrics.overall_sla_oldest``). A self-consistent cumulative trend that
    feeds ``charts.mttr_trend`` / ``charts.open_resolved_trend`` and the KPI change badges.
    """
    cols = ["date", "open", "resolved", "median_days", "sla_pct", "oldest_open_days"]
    scans = load_scans_df(db_path)
    base = load_base_df(db_path)
    if scans.empty or base.empty:
        return pd.DataFrame(columns=cols)
    flat_ts = sorted(t for t in scans.loc[scans["shape"] == "flat", "ts"] if pd.notna(t))
    if not flat_ts:
        return pd.DataFrame(columns=cols)
    first = base["first_seen"]
    resolved_at = base["resolved_at"]
    mttr = base["mttr_days"]
    sev = base["severity"].map(normalize_severity)
    target = sev.map(config.SLA_TARGETS)  # NaN where the severity has no SLA target
    rows = []
    for ts in flat_ts:
        resolved_mask = resolved_at.notna() & (resolved_at <= ts)
        open_mask = (first <= ts) & (resolved_at.isna() | (resolved_at > ts))
        med = mttr[resolved_mask].median()

        # In-SLA %: of everything resolved-by-ts that has both timestamps, the share whose
        # MTTR met its severity target (no-target severities count against — mirrors _hero).
        has_mttr = resolved_mask & mttr.notna()
        denom = int(has_mttr.sum())
        within = int((has_mttr & target.notna() & (mttr <= target)).sum())
        sla_pct = (within / denom * 100) if denom else None

        # Oldest open: max over severities of the p90 open age (ts − first_seen) as of ts.
        ages = (ts - first).dt.total_seconds() / 86400
        p90s = [
            ages[open_mask & (sev == s)].quantile(0.9)
            for s in config.SEVERITY_ORDER
            if (open_mask & (sev == s)).any()
        ]
        oldest = max(p90s) if p90s else None

        rows.append(
            {
                "date": ts,
                "open": int(open_mask.sum()),
                "resolved": int(resolved_mask.sum()),
                "median_days": (round(float(med), 3) if pd.notna(med) else None),
                "sla_pct": (round(float(sla_pct), 1) if sla_pct is not None else None),
                "oldest_open_days": (round(float(oldest), 3) if oldest is not None else None),
            }
        )
    return pd.DataFrame(rows, columns=cols)


# --------------------------------------------------------------------------- #
#  Maintenance
# --------------------------------------------------------------------------- #
def compact_archives(db_path=None) -> dict:
    """Gzip any pre-compression plain-JSON scan archives in place (one-time upgrade).

    Correctness never depends on this — ``_read_raw_payload`` sniffs and reads both
    formats — it only reclaims the ~10x disk difference for scans archived before the
    gzip change. Per-file: stream to ``<path>.gz`` (tmp + ``os.replace``), verify the
    new file reads back, repoint ``scans.raw_path``, then unlink the plain file. The
    parsed-frame snapshot pairs with both paths (same stem), so it is untouched.
    Never raises; failures are logged and counted. Returns
    ``{"compressed", "skipped", "failed"}``.
    """
    counts = {"compressed": 0, "skipped": 0, "failed": 0}
    db_path = _resolve(db_path)
    if not db_path.exists():
        return counts
    try:
        # Also the schema-migration hook for read-only deployments: init_db is otherwise
        # reached only from the persist writers, and a dashboard used purely to review
        # existing history would never shed its v1 latest_json bloat.
        init_db(db_path)
        conn = _connect(db_path)
        try:
            rows = conn.execute(
                "SELECT scan_id, raw_path FROM scans WHERE raw_path IS NOT NULL"
            ).fetchall()
        finally:
            conn.close()
    except Exception:
        # Never let start-up maintenance take the app down over a corrupt/locked DB.
        logger.warning("Archive compaction skipped: ledger unreadable.", exc_info=True)
        return counts
    all_paths = {r["raw_path"] for r in rows}
    for r in rows:
        old = Path(r["raw_path"])
        try:
            if not old.exists() or _is_gzip(old):
                counts["skipped"] += 1
                continue
            new = old.with_name(old.name + ".gz")
            if str(new) in all_paths:
                # The target name is another scan's live archive (a sanitized-scan_id
                # collision) — never clobber it; reads-both keeps the plain file valid.
                logger.warning("Archive compaction skipped for %s: %s belongs to "
                               "another scan.", old, new)
                counts["skipped"] += 1
                continue
            tmp = new.with_name(new.name + ".tmp")
            try:
                with open(old, "rb") as src, gzip.open(
                    tmp, "wb", compresslevel=_GZIP_LEVEL
                ) as dst:
                    shutil.copyfileobj(src, dst)
                os.replace(tmp, new)
            finally:
                Path(tmp).unlink(missing_ok=True)
            if _read_raw_payload(str(new)) is None:  # verify before dropping the original
                Path(new).unlink(missing_ok=True)
                counts["failed"] += 1
                continue
            conn = _connect(db_path)
            try:
                with conn:
                    conn.execute(
                        "UPDATE scans SET raw_path=? WHERE scan_id=?",
                        (str(new), r["scan_id"]),
                    )
            finally:
                conn.close()
            old.unlink(missing_ok=True)
            counts["compressed"] += 1
        except Exception:
            logger.warning("Couldn't compact archive %s", old, exc_info=True)
            counts["failed"] += 1
    if counts["compressed"] or counts["failed"]:
        logger.info("Archive compaction: %s", counts)
    return counts
