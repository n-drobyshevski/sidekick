"""Migration bundle export — the whole ledger history as one portable JSON file.

The GAS rebuild (``gas/``) stores the identical logical schema in Sheets + Drive, and
its Data page can ingest this bundle to carry the Streamlit deployment's history over
(first_seen dates, resolved episodes, reopen counts, MTTR trend). The bundle holds the
shared-semantics ledger tables only: ``raw_path`` (a local filesystem path) and
``observations`` are storage-specific and stay behind — imported scans arrive sealed
on the GAS side, and sealed scans never carry observations there.
"""

import gzip
import json
from datetime import datetime, timezone

from wiz_dashboard.data import history, ledger

BUNDLE_KIND = "wiz-sidekick-migration"
# Deep, settled-and-old history split off a windowed export. A distinct kind so the GAS
# importer refuses it as a live import (it only ingests BUNDLE_KIND) — it's a keepsake.
ARCHIVE_KIND = "wiz-sidekick-migration-archive"
BUNDLE_VERSION = 1

# ``scans`` minus raw_path (matches SCAN_COLS in gas/test/export_ledger_fixtures.py).
BUNDLE_SCAN_COLUMNS = [
    "scan_id", "ts", "mode", "shape", "total",
    "new_count", "resolved_count", "reopened_count", "severities", "sealed",
]
BUNDLE_EPISODE_COLUMNS = [
    "vuln_key", "cve", "severity", "first_seen", "resolved_at",
    "resolution_src", "reopened_count", "compaction_id", "superseded_by_scan",
]
_HISTORY_COLUMNS = ["date", "median_days", "resolved", "open", "total",
                    "sla_pct", "oldest_open_days"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _db_exists(db_path) -> bool:
    return ledger._resolve(db_path).exists()


def build_migration_bundle(db_path=None, history_filename=history.HISTORY_FILENAME) -> dict:
    """Assemble the bundle dict (JSON-serializable, importable by the GAS Data page).

    A missing DB yields empty tables rather than an error — the MTTR history file can
    still carry data worth migrating. An existing DB is migrated to the current schema
    first (``init_db`` is idempotent) so every bundle column exists.
    """
    scans, vulns, episodes = [], [], []
    if _db_exists(db_path):
        ledger.init_db(db_path)
        conn = ledger._connect(db_path)
        try:
            scans = [
                {c: r[c] for c in BUNDLE_SCAN_COLUMNS}
                for r in conn.execute("SELECT * FROM scans ORDER BY ts ASC, scan_id ASC")
            ]
            vulns = [
                {c: r[c] for c in ledger.LEDGER_COLUMNS}
                for r in conn.execute("SELECT * FROM vuln_ledger ORDER BY vuln_key")
            ]
            episodes = [
                {c: r[c] for c in BUNDLE_EPISODE_COLUMNS}
                for r in conn.execute("SELECT * FROM resolved_episodes ORDER BY vuln_key")
            ]
        finally:
            conn.close()
    mttr_history = [
        {c: r.get(c) for c in _HISTORY_COLUMNS} for r in history._read(history_filename)
    ]
    return {
        "kind": BUNDLE_KIND,
        "version": BUNDLE_VERSION,
        "exported_at": _now_iso(),
        "schema_version": ledger.SCHEMA_VERSION,
        "scans": scans,
        "ledger": vulns,
        "episodes": episodes,
        "mttr_history": mttr_history,
    }


def bundle_counts(db_path=None, history_filename=history.HISTORY_FILENAME) -> dict:
    """Cheap COUNT(*)s for the Exports page caption — never creates a missing DB."""
    counts = {"scans": 0, "vulns": 0, "episodes": 0}
    if _db_exists(db_path):
        conn = ledger._connect(db_path)
        try:
            for key, table in (("scans", "scans"), ("vulns", "vuln_ledger"),
                               ("episodes", "resolved_episodes")):
                try:
                    counts[key] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                except Exception:
                    counts[key] = 0
        finally:
            conn.close()
    counts["history"] = len(history._read(history_filename))
    return counts


def bundle_json_bytes(db_path=None, history_filename=history.HISTORY_FILENAME) -> bytes:
    """The bundle as compact UTF-8 JSON bytes (the download payload)."""
    payload = build_migration_bundle(db_path, history_filename)
    return json.dumps(payload, default=str, ensure_ascii=False).encode("utf-8")


# --------------------------------------------------------------------- windowed split
#
# A full-history bundle can reach hundreds of MB (up to ~200k ledger rows + ~200k
# episodes) — too large for the GAS single-request import, and beyond what the
# Sheets-backed ledger can hold/operate. The windowed split carries the LIVE working set
# (open vulns + recently-resolved) plus the FULL MTTR trend (small, precomputed) into the
# app, and sets the deep, settled-and-old remainder aside as a downloadable archive.


def _settled_before(resolved_at, cutoff_iso: str) -> bool:
    """True for a row that resolved strictly before the cutoff (canonical ISO-Z sorts
    lexicographically, matching how the rest of the codebase compares timestamps)."""
    return bool(resolved_at) and str(resolved_at) < cutoff_iso


def build_split_bundles(
    db_path=None, history_filename=history.HISTORY_FILENAME, cutoff_iso: str | None = None
) -> tuple[dict, dict]:
    """Partition the full bundle into ``(live, archive)`` at ``cutoff_iso``.

    A row is archived iff it is settled-and-old: a ledger row with ``status == "RESOLVED"``
    and ``resolved_at < cutoff``, or an episode with ``resolved_at < cutoff``. Everything
    else — every open vuln, every recent resolution, all scans, and the whole MTTR history —
    stays live. The two bundles are an exact, lossless partition of the ledger/episode rows.
    ``cutoff_iso=None`` puts everything in ``live`` (archive empty).
    """
    full = build_migration_bundle(db_path, history_filename)
    live_ledger, arch_ledger, live_eps, arch_eps = [], [], [], []
    for r in full["ledger"]:
        old = cutoff_iso is not None and r.get("status") == "RESOLVED" and _settled_before(
            r.get("resolved_at"), cutoff_iso
        )
        (arch_ledger if old else live_ledger).append(r)
    for r in full["episodes"]:
        old = cutoff_iso is not None and _settled_before(r.get("resolved_at"), cutoff_iso)
        (arch_eps if old else live_eps).append(r)

    live = {
        "kind": BUNDLE_KIND,
        "version": BUNDLE_VERSION,
        "exported_at": full["exported_at"],
        "schema_version": full["schema_version"],
        "scans": full["scans"],
        "ledger": live_ledger,
        "episodes": live_eps,
        "mttr_history": full["mttr_history"],
    }
    archive = {
        "kind": ARCHIVE_KIND,
        "version": BUNDLE_VERSION,
        "exported_at": full["exported_at"],
        "schema_version": full["schema_version"],
        "scans": [],
        "ledger": arch_ledger,
        "episodes": arch_eps,
        "mttr_history": [],
    }
    return live, archive


def split_counts(db_path=None, history_filename=history.HISTORY_FILENAME,
                 cutoff_iso: str | None = None) -> dict:
    """Cheap COUNT(*)s for the split — live vs archive, without materializing any rows."""
    out = {"live_vulns": 0, "archive_vulns": 0, "live_episodes": 0, "archive_episodes": 0,
           "scans": 0, "history": len(history._read(history_filename))}
    if not _db_exists(db_path):
        return out
    conn = ledger._connect(db_path)
    try:
        out["scans"] = conn.execute("SELECT COUNT(*) FROM scans").fetchone()[0]
        if cutoff_iso is None:
            out["live_vulns"] = conn.execute("SELECT COUNT(*) FROM vuln_ledger").fetchone()[0]
            out["live_episodes"] = conn.execute(
                "SELECT COUNT(*) FROM resolved_episodes").fetchone()[0]
            return out
        old_led = ("status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_at < ?")
        old_ep = ("resolved_at IS NOT NULL AND resolved_at < ?")
        out["archive_vulns"] = conn.execute(
            f"SELECT COUNT(*) FROM vuln_ledger WHERE {old_led}", (cutoff_iso,)).fetchone()[0]
        out["live_vulns"] = conn.execute(
            f"SELECT COUNT(*) FROM vuln_ledger WHERE NOT ({old_led})", (cutoff_iso,)).fetchone()[0]
        out["archive_episodes"] = conn.execute(
            f"SELECT COUNT(*) FROM resolved_episodes WHERE {old_ep}", (cutoff_iso,)).fetchone()[0]
        out["live_episodes"] = conn.execute(
            f"SELECT COUNT(*) FROM resolved_episodes WHERE NOT ({old_ep})",
            (cutoff_iso,)).fetchone()[0]
    finally:
        conn.close()
    return out


def live_bundle_json_bytes(db_path=None, history_filename=history.HISTORY_FILENAME,
                           cutoff_iso: str | None = None) -> bytes:
    """The live (importable) half of the split as compact UTF-8 JSON bytes."""
    live, _ = build_split_bundles(db_path, history_filename, cutoff_iso)
    return json.dumps(live, default=str, ensure_ascii=False).encode("utf-8")


def archive_bundle_gz_bytes(db_path=None, history_filename=history.HISTORY_FILENAME,
                            cutoff_iso: str | None = None) -> bytes:
    """The archived (settled-and-old) half, gzipped — it is the large part."""
    _, archive = build_split_bundles(db_path, history_filename, cutoff_iso)
    return gzip.compress(json.dumps(archive, default=str, ensure_ascii=False).encode("utf-8"))
