"""Migration bundle export — the whole ledger history as one portable JSON file.

The GAS rebuild (``gas/``) stores the identical logical schema in Sheets + Drive, and
its Data page can ingest this bundle to carry the Streamlit deployment's history over
(first_seen dates, resolved episodes, reopen counts, MTTR trend). The bundle holds the
shared-semantics ledger tables only: ``raw_path`` (a local filesystem path) and
``observations`` are storage-specific and stay behind — imported scans arrive sealed
on the GAS side, and sealed scans never carry observations there.
"""

import json
from datetime import datetime, timezone

from wiz_dashboard.data import history, ledger

BUNDLE_KIND = "wiz-sidekick-migration"
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
