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

import base64
import gzip
import json
import logging
import os
import re
import shutil
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from wiz_dashboard import config
from wiz_dashboard.domain import reconcile
from wiz_dashboard.domain.lifecycle import mttr_from_ledger
from wiz_dashboard.domain.severity import normalize_severity
from wiz_dashboard.data import snapshot
from wiz_dashboard.data.transform import extract_nodes

logger = logging.getLogger(__name__)

# v2: dropped ``vuln_ledger.latest_json`` — a full finding payload per row that nothing
# ever read (the raw archive keeps the complete finding), yet dominated the DB's size and
# was deserialized on every persist and every Scan History load.
# v3: added ``scans.severities`` — the severity scope a scan was fetched with (JSON array;
# NULL = all severities), so reconciliation never resolves-by-disappearance a severity
# that simply wasn't scanned, and delete→rebuild replays stay scope-faithful.
# v4: retention/compaction — ``scans.sealed`` plus the ``resolved_episodes`` and
# ``compactions`` tables (see the "Compaction" section below). Sealed scans keep their
# ``scans`` row forever (the trend x-axis and Scan History need the timestamps) but lose
# their raw archive, snapshot and observations; their resolved vulns live on as exact
# episode rows so MTTR/SLA/trend stay bit-identical.
SCHEMA_VERSION = 4

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
    "new_count", "resolved_count", "reopened_count", "raw_path", "severities",
]


# --------------------------------------------------------------------------- #
#  Severity-scope (de)serialization for the ``scans.severities`` column
# --------------------------------------------------------------------------- #
def serialize_severities(sevs):
    """Canonical JSON for a scan's severity scope; ``None`` means "all severities".

    A scope covering every selectable severity IS an unscoped scan (the fetch emits no
    filter), so it collapses to ``None`` — keeping full-scope scans byte-identical to
    pre-v3 history in every reader.
    """
    if sevs is None:
        return None
    vals = {normalize_severity(s) for s in sevs if isinstance(s, str)}
    vals &= set(config.SELECTABLE_SEVERITIES)
    if not vals or vals == set(config.SELECTABLE_SEVERITIES):
        return None
    return json.dumps([s for s in config.SEVERITY_ORDER if s in vals])


def parse_severities(text):
    """Inverse of ``serialize_severities``: ordered tuple, or ``None`` for all/invalid."""
    if not isinstance(text, str) or not text:
        return None
    try:
        vals = json.loads(text)
    except Exception:
        return None
    if not isinstance(vals, list):
        return None
    chosen = {normalize_severity(v) for v in vals if isinstance(v, str)}
    out = tuple(s for s in config.SEVERITY_ORDER if s in chosen)
    return out or None


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
                    raw_path TEXT,
                    severities TEXT,
                    sealed INTEGER NOT NULL DEFAULT 0
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
                CREATE TABLE IF NOT EXISTS resolved_episodes (
                    vuln_key TEXT PRIMARY KEY,
                    cve TEXT,
                    severity TEXT,
                    first_seen TEXT NOT NULL,
                    resolved_at TEXT NOT NULL,
                    resolution_src TEXT,
                    reopened_count INTEGER NOT NULL DEFAULT 0,
                    compaction_id TEXT NOT NULL,
                    superseded_by_scan TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_episodes_severity
                    ON resolved_episodes(severity);
                CREATE TABLE IF NOT EXISTS compactions (
                    compaction_id TEXT PRIMARY KEY,
                    ts TEXT NOT NULL,
                    floor_scan_id TEXT,
                    floor_ts TEXT,
                    scans_sealed INTEGER DEFAULT 0,
                    episodes_created INTEGER DEFAULT 0,
                    observations_pruned INTEGER DEFAULT 0,
                    archive_bytes_freed INTEGER DEFAULT 0,
                    db_bytes_freed INTEGER DEFAULT 0,
                    checkpoint TEXT
                );
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

    v1 → v2 drops ``vuln_ledger.latest_json``; v2 → v3 adds ``scans.severities``
    (nullable — every historical scan correctly reads as unscoped); v3 → v4 adds
    ``scans.sealed`` (default 0 — no historical scan is sealed until a compaction runs;
    the ``resolved_episodes``/``compactions`` tables come from ``init_db``'s idempotent
    DDL). ``BEGIN IMMEDIATE``
    + a version re-check keep concurrent sessions from racing the migration; the VACUUM
    that actually reclaims the v1 dropped column's space is best-effort (it can't run
    inside a transaction and may lose a lock race) — a skipped VACUUM just defers
    reclamation to the next start.
    """
    row = conn.execute("SELECT version FROM schema_meta").fetchone()
    if row is None or row[0] >= SCHEMA_VERSION:
        return
    dropped_latest_json = False
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
                dropped_latest_json = True
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
            scan_cols = {r[1] for r in conn.execute("PRAGMA table_info(scans)")}
            if "severities" not in scan_cols:
                conn.execute("ALTER TABLE scans ADD COLUMN severities TEXT")
            if "sealed" not in scan_cols:
                conn.execute(
                    "ALTER TABLE scans ADD COLUMN sealed INTEGER NOT NULL DEFAULT 0"
                )
            conn.execute("UPDATE schema_meta SET version=?", (SCHEMA_VERSION,))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    if not dropped_latest_json:
        return  # v2→v3 only adds a column; nothing to reclaim.
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


def _prev_scan_id_by_severity(conn):
    """``{severity: scan_id}`` of the most recent prior scan whose scope covered it.

    Feeds ``reconcile``'s per-severity disappearance guard: a finding that vanished while
    its severity went unscanned must still resolve on the first scan that covers it again.
    NULL / unparseable ``severities`` means unscoped (covers everything), so an
    all-unscoped history maps every severity to the latest scan id — exactly the legacy
    single ``prev_scan_id`` guard. Mirrors ``_latest_scan``'s newest-first-by-ts ordering
    and, like it, considers scans of every shape (a grouped scan interposing between flat
    scans blocks disappearance resolution today; the map preserves that conservatism).
    """
    remaining = set(config.SEVERITY_ORDER)
    mapping = {}
    for r in conn.execute("SELECT scan_id, severities FROM scans ORDER BY ts DESC"):
        scope = parse_severities(r["severities"])
        covered = set(remaining) if scope is None else remaining & set(scope)
        for sev in covered:
            mapping[sev] = r["scan_id"]
        remaining -= covered
        if not remaining:
            break
    return mapping or None


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


def _chunked(seq, size=500):
    """Yield ``seq`` in slices small enough for a SQLite ``IN (…)`` parameter list."""
    seq = list(seq)
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def _reconcile_episode_collisions(conn, updated, existing_ledger, deltas, scan_id):
    """Restore uncompacted semantics when a scan re-lists a vuln whose ledger row was
    compacted into ``resolved_episodes``.

    ``reconcile`` never saw the pruned row, so it classified the finding as NEW. Two
    cases, mirroring what the uncompacted ledger would have done:

    * The finding is active again (row OPEN) → a genuine **reopen**: seed
      ``reopened_count`` from the episode, reclassify the delta new→reopened, and mark
      the episode superseded (excluded from stats — exactly like reopen overwriting the
      resolved row). ``first_seen`` needs no fix-up: reconcile's new-row formula is
      identical to its reopen formula (``min(API first, scan ts)``).
    * The API re-listed an old, already-counted **resolution** (row born RESOLVED) →
      the uncompacted ledger would have kept the old row and counted nothing: drop the
      fresh row and undo its new/resolved deltas; the episode stays authoritative.

    Mutates ``updated``/``deltas`` in place and updates episode rows on ``conn``
    (caller's transaction).
    """
    new_keys = [k for k in updated if k not in existing_ledger]
    if not new_keys:
        return
    episode_reopens = {}
    for chunk in _chunked(new_keys):
        rows = conn.execute(
            "SELECT vuln_key, reopened_count FROM resolved_episodes "
            f"WHERE superseded_by_scan IS NULL AND vuln_key IN "
            f"({','.join('?' for _ in chunk)})",
            chunk,
        )
        episode_reopens.update(
            {r["vuln_key"]: int(r["reopened_count"] or 0) for r in rows}
        )
    for key, prior_reopens in episode_reopens.items():
        row = updated[key]
        if row.get("status") == "OPEN":
            row["reopened_count"] = prior_reopens + 1
            deltas["new_count"] -= 1
            deltas["reopened_count"] += 1
            conn.execute(
                "UPDATE resolved_episodes SET superseded_by_scan=? WHERE vuln_key=?",
                (scan_id, key),
            )
        else:
            updated.pop(key)
            deltas["new_count"] -= 1
            deltas["resolved_count"] -= 1


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
                      disappearance_mode=None, df=None, scanned_severities=None):
    """Save a flat per-finding scan and reconcile the ledger. Returns scan deltas.

    Idempotent: saving a scan whose ``scan_id`` already exists is a no-op (returns the
    stored deltas). ``scan_id`` defaults to the current UTC second.

    ``df`` (optional): the already-parsed findings DataFrame for this scan. When given,
    a parsed-frame snapshot is written beside the raw archive so app start-up can restore
    the frame without re-parsing 100k+ nested nodes (see ``data.snapshot``). Replay paths
    (delete→rebuild) pass no ``df``; survivors' existing snapshots stay valid because
    their data is unchanged, and nothing in the rebuild depends on snapshots.

    ``scanned_severities`` (optional): the severity scope this scan was fetched with
    (``None`` = all). Recorded on the ``scans`` row and passed to ``reconcile`` so
    out-of-scope OPEN rows are never falsely resolved by disappearance.
    """
    records = list(records)
    db_path = _resolve(db_path)
    init_db(db_path)
    scan_id = scan_id or _now_iso()
    scan_ts = scan_id
    if disappearance_mode is None:
        disappearance_mode = config.DISAPPEARANCE_RESOLUTION
    severities_text = serialize_severities(scanned_severities)
    scope = parse_severities(severities_text)  # canonical tuple, or None for unscoped

    conn = _connect(db_path)
    try:
        existing = _existing_scan_deltas(conn, scan_id)
        if existing is not None:
            return existing
        prev = _latest_scan(conn)
        prev_scan_id = prev[0] if prev else None
        prev_scan_ts = prev[1] if prev else None
        prev_by_sev = _prev_scan_id_by_severity(conn) if prev_scan_id is not None else None
        existing_ledger = _load_ledger_map(conn)

        updated, observations, deltas = reconcile.reconcile(
            records, existing_ledger, scan_id, scan_ts, prev_scan_id,
            disappearance_mode=disappearance_mode, prev_scan_ts=prev_scan_ts,
            scanned_severities=(set(scope) if scope is not None else None),
            prev_scan_id_by_severity=prev_by_sev,
        )
        raw_path = _archive_raw(db_path, scan_id, raw if raw is not None else records)
        if df is not None and raw_path:
            snapshot.write_snapshot(raw_path, df)  # best-effort; start-up fast path

        with conn:
            _reconcile_episode_collisions(conn, updated, existing_ledger, deltas, scan_id)
            conn.execute(
                f"INSERT INTO scans ({','.join(_SCANS_COLUMNS)}) "
                f"VALUES ({','.join('?' for _ in _SCANS_COLUMNS)})",
                (scan_id, scan_ts, mode, "flat", len(records),
                 deltas["new_count"], deltas["resolved_count"], deltas["reopened_count"],
                 raw_path, severities_text),
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


def persist_grouped_scan(nodes, *, mode, raw=None, db_path=None, scan_id=None,
                         scanned_severities=None):
    """Archive a grouped-by-asset scan WITHOUT per-vuln reconciliation.

    Grouped responses carry per-asset severity counts but no per-finding identity or
    timestamps, so they can't advance lifecycles. We still record the scan (for the
    history) and archive the raw payload — including its severity scope, for an honest
    Scan History. Returns zero deltas.
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
                (scan_id, scan_id, mode, "grouped", len(nodes), 0, 0, 0, raw_path,
                 serialize_severities(scanned_severities)),
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


class SealedScanError(LedgerRebuildError):
    """A delete targeted a sealed (compacted) scan. Sealed scans' raw archives are gone,
    so their effects can never be un-replayed — the delete is refused before any
    mutation, the same honest posture the delete design took for ``mttr_history.json``."""


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


def _snapshot_db(db_path) -> Path:
    """Copy the DB to ``<db>.bak`` (checkpointing the WAL first so the copy is a
    complete database) and return the snapshot path. Shared crash-safety net of the
    delete→rebuild and compaction paths; pair with ``_restore_db`` on failure."""
    bak = Path(str(db_path) + ".bak")
    cp = _connect(db_path)
    try:
        cp.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        cp.close()
    shutil.copy2(db_path, bak)
    return bak


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
    mutating) if a surviving *flat* scan's archived payload can't be replayed, and
    ``SealedScanError`` if a target is sealed (compacted scans have no archive left to
    un-replay). Exception-safe: validates replayability and snapshots the DB before
    mutating, restoring it if the rebuild raises.

    On a compacted DB the rebuild starts from the compaction checkpoint instead of
    empty tables: sealed ``scans`` rows are never wiped, the checkpoint's ledger state
    (minus keys already converted to ``resolved_episodes`` — their stats live there)
    seeds ``vuln_ledger``, episode supersessions are reset (all superseding scans are
    post-floor by construction, so replay re-derives them deterministically), and only
    unsealed survivors are replayed. The keystone invariant becomes
    ``build [floor, s1, s3] == build [floor, s1, s2, s3] then delete s2``.
    """
    targets = {s for s in (scan_ids or []) if s}
    db_path = _resolve(db_path)
    zero = {"deleted": 0, "scans": 0, "tracked": 0}
    if not targets or not db_path.exists():
        return zero

    # Migrate first: the replay below writes v3 columns (scans.severities) through
    # _reinsert_scan_row before any persist_* call gets a chance to run init_db.
    init_db(db_path)
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
    sealed_targets = sorted(
        r["scan_id"] for r in rows if r["scan_id"] in present and r.get("sealed")
    )
    if sealed_targets:
        raise SealedScanError(
            f"Cannot delete sealed scan(s) {', '.join(sealed_targets)}: they are part "
            f"of the compacted baseline (their raw archives were pruned), so their "
            f"effects can no longer be un-replayed."
        )
    survivors = [r for r in rows if r["scan_id"] not in present]

    # Pre-load + validate every UNSEALED survivor's payload BEFORE mutating anything.
    # Sealed survivors are never replayed — the compaction checkpoint carries their
    # cumulative effect, and their scans rows stay in place untouched.
    replay = []
    for r in survivors:
        if r.get("sealed"):
            continue
        payload = _read_raw_payload(r["raw_path"])
        if payload is None and r["shape"] == "flat":
            raise LedgerRebuildError(
                f"Cannot delete: the archived payload for surviving scan "
                f"{r['scan_id']} is missing, so the ledger can't be rebuilt."
            )
        replay.append((r, payload))

    # Snapshot the DB (checkpoint WAL first so the copy is a complete database).
    bak = _snapshot_db(db_path)

    try:
        # Wipe the derived tables (sealed scans rows are the compacted baseline — they
        # stay), seed the ledger from the compaction checkpoint, then replay unsealed
        # survivors in ts order. Keys already converted to resolved_episodes are NOT
        # seeded — their stats live in the episode table, and a post-floor scan that
        # re-lists one flows through the same reopen-collision path as a live scan.
        conn = _connect(db_path)
        try:
            with conn:
                conn.execute("DELETE FROM vuln_ledger")
                conn.execute("DELETE FROM observations")
                conn.execute("DELETE FROM scans WHERE sealed=0")
                checkpoint = _load_latest_checkpoint(conn)
                if checkpoint is not None:
                    episode_keys = {
                        r["vuln_key"]
                        for r in conn.execute("SELECT vuln_key FROM resolved_episodes")
                    }
                    _upsert_ledger(
                        conn,
                        [row for row in checkpoint.get("ledger", [])
                         if row.get("vuln_key") not in episode_keys],
                    )
                    # Supersessions were derived from post-floor scans; the surviving
                    # post-floor scans re-derive them during replay below.
                    conn.execute(
                        "UPDATE resolved_episodes SET superseded_by_scan=NULL"
                    )
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
                        scanned_severities=parse_severities(r.get("severities")),
                    )
            else:
                # Replay uses the current config.DISAPPEARANCE_RESOLUTION (same as the original
                # persist, which never overrides it); it isn't stored per-scan. The severity
                # scope IS stored per-scan and must ride along, or a rebuild would falsely
                # mass-resolve severities the original scan never covered.
                persist_flat_scan(
                    _records_from_payload(payload), mode=r["mode"], raw=payload,
                    db_path=db_path, scan_id=r["scan_id"],
                    scanned_severities=parse_severities(r.get("severities")),
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
#  Compaction (retention: seal old scans, keep stats exact)
# --------------------------------------------------------------------------- #
# A compaction run picks a retention horizon at a flat-scan boundary and "seals"
# everything older: the ledger state as of that floor is serialized into a checkpoint
# (the new replay floor for delete→rebuild), fully-settled RESOLVED ledger rows become
# compact ``resolved_episodes`` rows (exact ``severity/first_seen/resolved_at`` — the
# only fields MTTR/SLA/trend math reads, so the numbers stay bit-identical), and the
# sealed scans' observations, raw archives and parsed-frame snapshots are pruned.
# Sealed ``scans`` rows are kept forever (trend x-axis, Scan History, prev-scan maps)
# with ``raw_path`` NULLed; sealed scans can never be deleted (``SealedScanError``).

CHECKPOINT_VERSION = 1


def _table_exists(conn, name) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def _encode_checkpoint(cp: dict) -> str:
    raw = json.dumps(cp, ensure_ascii=False, default=str).encode("utf-8")
    return base64.b64encode(gzip.compress(raw, _GZIP_LEVEL)).decode("ascii")


def _decode_checkpoint(text):
    if not text:
        return None
    try:
        return json.loads(gzip.decompress(base64.b64decode(text)).decode("utf-8"))
    except Exception:
        logger.warning("Unreadable compaction checkpoint blob.", exc_info=True)
        return None


def _load_latest_checkpoint(conn):
    """The most recent compaction's checkpoint dict, or ``None`` (never compacted).

    Only the latest compaction row carries a blob — each new floor supersedes the
    previous one (``compact_ledger`` NULLs older blobs), so this is authoritative."""
    if not _table_exists(conn, "compactions"):
        return None
    row = conn.execute(
        "SELECT checkpoint FROM compactions WHERE checkpoint IS NOT NULL "
        "ORDER BY ts DESC, compaction_id DESC LIMIT 1"
    ).fetchone()
    return _decode_checkpoint(row["checkpoint"]) if row else None


def _stats_equal(a, b) -> bool:
    """Deep equality for the ``(per_sev, overall)`` MTTR stats shape, treating the
    missing-value family (None/NaN/NaT) as equal to itself."""
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_stats_equal(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(_stats_equal(x, y) for x, y in zip(a, b))
    try:
        if pd.isna(a) and pd.isna(b):
            return True
    except (TypeError, ValueError):
        pass
    return a == b


def _select_seal_candidates(rows, cutoff):
    """The contiguous ts-ordered prefix of ``rows`` eligible for sealing.

    Stops at the first scan newer than ``cutoff`` (sealed history must stay a prefix —
    a gap would break checkpoint replay) and never reaches the last
    ``config.MIN_UNSEALED_FLAT_SCANS`` flat scans: the newest flat scan is the quick-
    refresh merge baseline (its raw archive must survive) and the second-newest feeds
    ``previous_severity_counts`` from its observations."""
    flat_ids = [r["scan_id"] for r in rows if r["shape"] == "flat"]
    protected = set(flat_ids[-config.MIN_UNSEALED_FLAT_SCANS:]) if flat_ids else set()
    candidates = []
    for r in rows:
        if r["scan_id"] in protected:
            break
        ts = pd.to_datetime(r["ts"], errors="coerce", utc=True)
        if pd.isna(ts) or ts > cutoff:
            break
        candidates.append(r)
    return candidates


def _sealed_file_sizes(rows) -> int:
    """Total on-disk bytes of the given scans' raw archives + parsed-frame snapshots."""
    total = 0
    for r in rows:
        rp = r.get("raw_path")
        if not rp:
            continue
        for p in (Path(rp), snapshot.snapshot_path_for(rp)):
            try:
                if p.exists():
                    total += p.stat().st_size
            except Exception:
                pass
    return total


def _build_checkpoint(rows, newly, prev_checkpoint, floor_row) -> dict:
    """Replay the sealed prefix in a throwaway DB to capture the exact ledger state as
    of the floor scan.

    The live ``vuln_ledger`` already has post-floor effects baked in, so the state must
    be *re-derived*: seed a temp DB with the previous checkpoint's ledger plus the
    already-sealed ``scans`` rows (their ids feed the prev-scan/severity maps), then run
    the newly-sealed scans through the production ``persist_*`` writers — the identical
    code path delete→rebuild replays, so the checkpoint is byte-faithful by
    construction. Raises ``LedgerRebuildError`` (before the caller mutates anything)
    when a newly-sealed flat scan's archive is unreadable. The temp replay re-archives
    payloads under a temp dir; it is removed afterwards.
    """
    tmp_dir = Path(tempfile.mkdtemp(prefix="wiz-compact-"))
    tmp_db = tmp_dir / "checkpoint.db"
    try:
        init_db(tmp_db)
        conn = _connect(tmp_db)
        try:
            with conn:
                if prev_checkpoint is not None:
                    _upsert_ledger(conn, prev_checkpoint.get("ledger", []))
                for r in rows:
                    if r.get("sealed"):
                        conn.execute(
                            f"INSERT INTO scans ({','.join(_SCANS_COLUMNS)}) "
                            f"VALUES ({','.join('?' for _ in _SCANS_COLUMNS)})",
                            tuple(r.get(c) for c in _SCANS_COLUMNS),
                        )
        finally:
            conn.close()
        for r in newly:
            payload = _read_raw_payload(r["raw_path"])
            scope = parse_severities(r.get("severities"))
            if r["shape"] == "flat":
                if payload is None:
                    raise LedgerRebuildError(
                        f"Cannot compact: the archived payload for scan "
                        f"{r['scan_id']} is missing or unreadable."
                    )
                persist_flat_scan(
                    _records_from_payload(payload), mode=r["mode"], raw=payload,
                    db_path=tmp_db, scan_id=r["scan_id"], scanned_severities=scope,
                )
            elif payload is None:
                # Grouped scans never touch the ledger; the row alone is faithful.
                _reinsert_scan_row(tmp_db, r)
            else:
                persist_grouped_scan(
                    extract_nodes(payload), mode=r["mode"], raw=payload,
                    db_path=tmp_db, scan_id=r["scan_id"], scanned_severities=scope,
                )
        conn = _connect(tmp_db)
        try:
            ledger_rows = [
                dict(r) for r in conn.execute(
                    f"SELECT {','.join(LEDGER_COLUMNS)} FROM vuln_ledger"
                )
            ]
        finally:
            conn.close()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    return {
        "version": CHECKPOINT_VERSION,
        "floor_scan_id": floor_row["scan_id"] if floor_row else None,
        "floor_ts": floor_row["ts"] if floor_row else None,
        "ledger": ledger_rows,
    }


def compact_ledger(retention_days, *, db_path=None, dry_run=False, now=None) -> dict:
    """Seal scans older than ``retention_days`` and roll their closed vulns into exact
    episode rows; prune the sealed scans' observations, raw archives and snapshots.

    Returns a result dict: ``{no_op, dry_run, scans_sealed, episodes_created,
    observations_pruned, archive_bytes_freed, db_bytes_freed, floor_scan_id,
    floor_ts}``. ``dry_run=True`` computes the identical preview (including the
    checkpoint replay, so the numbers are exact) without mutating anything.
    ``retention_days=None`` and never-below ``config.RETENTION_MIN_DAYS`` are the
    policy guardrails; ``now`` is overridable for deterministic tests.

    Correctness discipline: the checkpoint is built BEFORE any mutation (unreadable
    sealed archive → ``LedgerRebuildError``, nothing touched); all DB mutation happens
    in ONE transaction that recomputes the MTTR and trend stats through the same
    connection and ROLLS BACK on any difference (the executable "identical stats"
    guarantee); the DB is snapshotted to ``<db>.bak`` first (same net as
    delete→rebuild); files are unlinked only after COMMIT so a restored DB never points
    at deleted archives. Callers must run ``_derived.clear_ledger_caches()`` after a
    non-no-op run.
    """
    result = {
        "no_op": True, "dry_run": bool(dry_run), "scans_sealed": 0,
        "episodes_created": 0, "observations_pruned": 0,
        "archive_bytes_freed": 0, "db_bytes_freed": 0,
        "floor_scan_id": None, "floor_ts": None,
    }
    if retention_days is None:
        return result
    retention_days = max(int(retention_days), config.RETENTION_MIN_DAYS)
    db_path = _resolve(db_path)
    if not db_path.exists():
        return result
    init_db(db_path)

    now_ts = pd.Timestamp(now) if now is not None else pd.Timestamp.now(tz="UTC")
    if now_ts.tzinfo is None:
        now_ts = now_ts.tz_localize("UTC")
    cutoff = now_ts - pd.Timedelta(days=retention_days)

    conn = _connect(db_path)
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM scans ORDER BY ts ASC, scan_id ASC"
        )]
        prev_checkpoint = _load_latest_checkpoint(conn)
        live_ledger = _load_ledger_map(conn)
    finally:
        conn.close()
    if not rows:
        return result

    candidates = _select_seal_candidates(rows, cutoff)
    sealed_prefix = [r for r in rows if r.get("sealed")]
    if [r["scan_id"] for r in candidates[:len(sealed_prefix)]] != [
        r["scan_id"] for r in sealed_prefix
    ]:
        # A raised retention moved the cutoff inside the already-sealed region;
        # sealing anything now would break prefix contiguity — nothing to do.
        return result
    newly = [r for r in candidates if not r.get("sealed")]
    if not newly:
        return result

    flat_candidates = [r for r in candidates if r["shape"] == "flat"]
    floor_row = flat_candidates[-1] if flat_candidates else None
    checkpoint = _build_checkpoint(rows, newly, prev_checkpoint, floor_row)

    # Episode conversion: a checkpoint-RESOLVED row is converted only when its live
    # state is untouched post-floor — still RESOLVED with the same resolved_at, and
    # last seen by a sealed scan. That deliberately excludes rows disappearance-
    # resolved BY a post-floor scan (checkpoint says OPEN): their resolution depends
    # on a still-deletable scan, so they must stay replayable in the live ledger.
    sealed_ids = {r["scan_id"] for r in candidates}
    episodes = []
    for cp_row in checkpoint["ledger"]:
        if cp_row.get("status") != "RESOLVED":
            continue
        live = live_ledger.get(cp_row.get("vuln_key"))
        if (
            live is None  # already an episode from a prior compaction
            or live.get("status") != "RESOLVED"
            or live.get("resolved_at") != cp_row.get("resolved_at")
            or live.get("last_scan_id") not in sealed_ids
        ):
            continue
        episodes.append(live)

    newly_ids = [r["scan_id"] for r in newly]
    conn = _connect(db_path)
    try:
        obs_count = 0
        for chunk in _chunked(newly_ids):
            obs_count += conn.execute(
                "SELECT COUNT(*) FROM observations WHERE scan_id IN "
                f"({','.join('?' for _ in chunk)})",
                chunk,
            ).fetchone()[0]
    finally:
        conn.close()

    result.update(
        no_op=False, scans_sealed=len(newly), episodes_created=len(episodes),
        observations_pruned=obs_count,
        archive_bytes_freed=_sealed_file_sizes(newly),
        floor_scan_id=checkpoint["floor_scan_id"], floor_ts=checkpoint["floor_ts"],
    )
    if dry_run:
        return result

    bak = _snapshot_db(db_path)
    compaction_id = uuid.uuid4().hex
    conn = _connect(db_path)
    try:
        before_mttr = mttr_from_ledger(_open_and_resolved(conn), now=now_ts)
        before_trend = _trend_df(conn)
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("UPDATE compactions SET checkpoint=NULL")
        conn.execute(
            "INSERT INTO compactions (compaction_id, ts, floor_scan_id, floor_ts, "
            "scans_sealed, episodes_created, observations_pruned, "
            "archive_bytes_freed, db_bytes_freed, checkpoint) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (compaction_id, _now_iso(), checkpoint["floor_scan_id"],
             checkpoint["floor_ts"], len(newly), len(episodes), obs_count, 0, 0,
             _encode_checkpoint(checkpoint)),
        )
        for chunk in _chunked(newly_ids):
            conn.execute(
                "UPDATE scans SET sealed=1, raw_path=NULL WHERE scan_id IN "
                f"({','.join('?' for _ in chunk)})",
                chunk,
            )
        conn.executemany(
            "INSERT OR REPLACE INTO resolved_episodes "
            "(vuln_key, cve, severity, first_seen, resolved_at, resolution_src, "
            "reopened_count, compaction_id, superseded_by_scan) "
            "VALUES (?,?,?,?,?,?,?,?,NULL)",
            [(e["vuln_key"], e.get("cve"), e.get("severity"), e.get("first_seen"),
              e.get("resolved_at"), e.get("resolution_src"),
              int(e.get("reopened_count") or 0), compaction_id) for e in episodes],
        )
        conn.executemany(
            "DELETE FROM vuln_ledger WHERE vuln_key=?",
            [(e["vuln_key"],) for e in episodes],
        )
        for chunk in _chunked(newly_ids):
            conn.execute(
                "DELETE FROM observations WHERE scan_id IN "
                f"({','.join('?' for _ in chunk)})",
                chunk,
            )
        after_mttr = mttr_from_ledger(_open_and_resolved(conn), now=now_ts)
        after_trend = _trend_df(conn)
        if not _stats_equal(before_mttr, after_mttr) or not before_trend.equals(
            after_trend
        ):
            raise LedgerRebuildError(
                "Compaction aborted: MTTR/SLA/trend stats would change — rolled back."
            )
        conn.execute("COMMIT")
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        conn.close()
        _restore_db(db_path, bak)
        raise
    conn.close()
    bak.unlink(missing_ok=True)

    # Post-commit, best-effort: drop the sealed scans' files, then reclaim DB space.
    freed = 0
    for r in newly:
        rp = r.get("raw_path")
        if not rp:
            continue
        for p in (Path(rp), snapshot.snapshot_path_for(rp)):
            try:
                if p.exists():
                    freed += p.stat().st_size
                    p.unlink()
            except Exception:
                logger.warning("Couldn't remove sealed artifact %s", p, exc_info=True)
    result["archive_bytes_freed"] = freed

    cp = _connect(db_path)
    try:
        cp.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        cp.close()
    size_before = db_path.stat().st_size
    try:
        vac = _connect(db_path)
        try:
            vac.execute("VACUUM")
        finally:
            vac.close()
    except Exception:
        logger.warning("Post-compaction VACUUM skipped.", exc_info=True)
    result["db_bytes_freed"] = max(0, size_before - db_path.stat().st_size)

    conn = _connect(db_path)
    try:
        with conn:
            conn.execute(
                "UPDATE compactions SET archive_bytes_freed=?, db_bytes_freed=? "
                "WHERE compaction_id=?",
                (result["archive_bytes_freed"], result["db_bytes_freed"],
                 compaction_id),
            )
    finally:
        conn.close()
    return result


# --------------------------------------------------------------------------- #
#  Readers
# --------------------------------------------------------------------------- #
# Compacted resolved vulns re-enter the readers below through a UNION with
# ``resolved_episodes``. Two guards keep the union exactly equal to the uncompacted
# ledger: superseded episodes are out (a reopen overwrote them — same as the uncompacted
# overwrite-on-reopen), and any key with a live ``vuln_ledger`` row is out (one row per
# key, the live row is authoritative). The NOT EXISTS is belt-and-braces — compaction
# deletes converted rows in the same transaction — but keeps every replay path honest.
_EPISODE_FILTER = (
    "FROM resolved_episodes e WHERE e.superseded_by_scan IS NULL "
    "AND NOT EXISTS (SELECT 1 FROM vuln_ledger v WHERE v.vuln_key = e.vuln_key)"
)


def _has_episodes(conn) -> bool:
    """Whether the episodes table exists (a pre-v4 DB opened read-only lacks it)."""
    return _table_exists(conn, "resolved_episodes")


def _scans_df(conn) -> pd.DataFrame:
    df = pd.read_sql_query("SELECT * FROM scans", conn)
    if df.empty:
        return df
    df["ts"] = pd.to_datetime(df["ts"], errors="coerce", utc=True)
    return df.sort_values("ts", ascending=False).reset_index(drop=True)


def load_scans_df(db_path=None) -> pd.DataFrame:
    """All saved scans, newest first (``ts`` as a UTC datetime)."""
    path = _resolve(db_path)
    if not path.exists():
        return pd.DataFrame(columns=_SCANS_COLUMNS)
    conn = _connect(db_path)
    try:
        return _scans_df(conn)
    finally:
        conn.close()


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


def _base_df(conn) -> pd.DataFrame:
    # Explicit columns (not *): keeps a not-yet-migrated v1 DB from shipping its
    # latest_json blobs into the Scan History frame (and its CSV export). Compacted
    # resolved vulns ride along with placeholder asset fields — '(compacted)' is a
    # visible, honest degradation, not a silent hole in the stats.
    cols = ",".join(LEDGER_COLUMNS)
    query = f"SELECT {cols} FROM vuln_ledger"
    if _has_episodes(conn):
        query += (
            " UNION ALL SELECT e.vuln_key, e.cve, e.severity,"
            " NULL AS asset_id, '(compacted)' AS asset_name,"
            " NULL AS asset_type, NULL AS cloud,"
            " e.first_seen, e.resolved_at AS last_seen, 'RESOLVED' AS status,"
            " e.resolved_at, e.resolution_src, e.reopened_count,"
            " NULL AS first_scan_id, NULL AS last_scan_id "
            + _EPISODE_FILTER
        )
    df = pd.read_sql_query(query, conn)
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


def load_base_df(db_path=None) -> pd.DataFrame:
    """The vulnerability ledger (live rows + compacted episodes) with computed
    ``mttr_days`` and open ``age_days``."""
    path = _resolve(db_path)
    if not path.exists():
        return pd.DataFrame(columns=LEDGER_COLUMNS + ["mttr_days", "age_days"])
    conn = _connect(db_path)
    try:
        return _base_df(conn)
    finally:
        conn.close()


def _open_and_resolved(conn):
    query = "SELECT vuln_key, severity, first_seen, status, resolved_at FROM vuln_ledger"
    if _has_episodes(conn):
        query += (
            " UNION ALL SELECT e.vuln_key, e.severity, e.first_seen,"
            " 'RESOLVED' AS status, e.resolved_at " + _EPISODE_FILTER
        )
    return [dict(r) for r in conn.execute(query).fetchall()]


def load_open_and_resolved(db_path=None):
    """Minimal ledger rows (live + compacted episodes) for
    ``lifecycle.mttr_from_ledger`` (list of dicts)."""
    path = _resolve(db_path)
    if not path.exists():
        return []
    conn = _connect(db_path)
    try:
        return _open_and_resolved(conn)
    finally:
        conn.close()


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


def _trend_df(conn, severities=None) -> pd.DataFrame:
    return _trend_from_frames(_scans_df(conn), _base_df(conn), severities)


def load_trend_df(db_path=None, severities=None) -> pd.DataFrame:
    """Open / resolved / median-MTTR / In-SLA% / oldest-open over time, from the ledger.

    For each saved flat scan timestamp, counts ledger vulns open vs resolved *as of* that
    instant and the median MTTR of everything resolved by then — plus the In-SLA share and
    the oldest-open age (max over severities of the p90 open age), matching the headline
    KPIs (see ``metrics.overall_sla_oldest``). A self-consistent cumulative trend that
    feeds ``charts.mttr_trend`` / ``charts.open_resolved_trend`` and the KPI change badges.
    Compacted episodes participate through ``load_base_df``'s union, and sealed scans
    keep their ``scans`` row, so the trend is unchanged by compaction.

    ``severities`` (optional iterable) restricts the trend to those severities plus
    UNKNOWN — the display-filter path. ``None`` computes over everything.
    """
    return _trend_from_frames(load_scans_df(db_path), load_base_df(db_path), severities)


def _trend_from_frames(scans, base, severities=None) -> pd.DataFrame:
    cols = ["date", "open", "resolved", "median_days", "sla_pct", "oldest_open_days"]
    if severities is not None and not base.empty:
        keep = set(severities) | {"UNKNOWN"}
        base = base[base["severity"].map(normalize_severity).isin(keep)]
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
