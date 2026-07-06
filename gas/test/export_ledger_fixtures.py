"""End-to-end ledger golden fixtures: drive the ORIGINAL SQLite ledger through
persist -> delete -> compact scenarios and dump the resulting tables, so the TS
in-memory LedgerState core can replay the identical sequence and compare.

Run from the repo root: python gas/test/export_ledger_fixtures.py
"""

import json
import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from wiz_dashboard.data import ledger

OUT = Path(__file__).parent / "fixtures"
NOW = "2026-07-01T00:00:00Z"

# Shared-semantics scan columns (raw_path/obs refs are storage-specific).
SCAN_COLS = ["scan_id", "ts", "mode", "shape", "total", "new_count", "resolved_count",
             "reopened_count", "severities", "sealed"]
EPISODE_COLS = ["vuln_key", "cve", "severity", "first_seen", "resolved_at",
                "resolution_src", "reopened_count", "superseded_by_scan"]


def scrub(obj):
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {str(k): scrub(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [scrub(v) for v in obj]
    if isinstance(obj, float):
        return None if math.isnan(obj) else obj
    if hasattr(obj, "item"):
        return scrub(obj.item())
    return obj


def dump_tables(db):
    conn = ledger._connect(db)
    try:
        scans = [
            {c: r[c] for c in SCAN_COLS}
            for r in conn.execute("SELECT * FROM scans ORDER BY ts ASC, scan_id ASC")
        ]
        vulns = {
            r["vuln_key"]: {c: r[c] for c in ledger.LEDGER_COLUMNS}
            for r in conn.execute("SELECT * FROM vuln_ledger")
        }
        obs = [
            dict(r) for r in conn.execute(
                "SELECT scan_id, vuln_key, present, severity, status FROM observations "
                "ORDER BY scan_id, vuln_key"
            )
        ]
        episodes = [
            {c: r[c] for c in EPISODE_COLS}
            for r in conn.execute("SELECT * FROM resolved_episodes ORDER BY vuln_key")
        ]
    finally:
        conn.close()
    return {"scans": scans, "ledger": vulns, "observations": obs, "episodes": episodes}


def node(fid, cve, sev, status, asset, first=None, resolved=None, **extra):
    n = {
        "id": fid, "name": cve, "severity": sev, "status": status,
        "vulnerableAsset": {"id": asset, "name": f"{asset}-name",
                            "type": "VIRTUAL_MACHINE", "cloudPlatform": "AWS"},
    }
    if first:
        n["firstDetectedAt"] = first
    if resolved:
        n["resolvedAt"] = resolved
    n.update(extra)
    return n


S1, S2, S3, S4 = ("2026-01-01T06:00:00Z", "2026-01-08T06:00:00Z",
                  "2026-06-01T06:00:00Z", "2026-06-15T06:00:00Z")

SCAN_1 = [
    node("A", "CVE-A", "CRITICAL", "OPEN", "vm-a", first="2025-12-20T00:00:00Z"),
    node("B", "CVE-B", "HIGH", "RESOLVED", "vm-b", first="2025-12-01T00:00:00Z",
         resolved="2025-12-30T12:00:00Z"),
]
SCAN_2 = [
    node("A", "CVE-A", "CRITICAL", "OPEN", "vm-a", first="2025-12-20T00:00:00Z"),
    node("C", "CVE-C", "HIGH", "OPEN", "vm-c"),
    node("D", "CVE-D", "MEDIUM", "OPEN", "vm-d", first="2026-01-02T00:00:00Z",
         resolved="2026-01-05T00:00:00Z"),
]
SCAN_3 = [
    node("A", "CVE-A", "CRITICAL", "RESOLVED", "vm-a", first="2025-12-20T00:00:00Z",
         resolved="2026-05-28T00:00:00Z"),
    node("C", "CVE-C", "HIGH", "OPEN", "vm-c"),
]
SCAN_4 = [
    node("C", "CVE-C", "HIGH", "OPEN", "vm-c"),
    node("E", "CVE-E", "CRITICAL", "OPEN", "vm-e"),
]


def build_db(tmp):
    db = Path(tmp) / "ledger.db"
    steps = {}
    ledger.persist_flat_scan(SCAN_1, mode="live", raw={"data": {"vulnerabilityFindings": {"nodes": SCAN_1}}}, db_path=db, scan_id=S1)
    steps["after_scan1"] = dump_tables(db)
    ledger.persist_flat_scan(SCAN_2, mode="live", raw={"data": {"vulnerabilityFindings": {"nodes": SCAN_2}}}, db_path=db, scan_id=S2)
    steps["after_scan2"] = dump_tables(db)
    ledger.persist_flat_scan(SCAN_3, mode="live", raw={"data": {"vulnerabilityFindings": {"nodes": SCAN_3}}}, db_path=db, scan_id=S3)
    steps["after_scan3"] = dump_tables(db)
    ledger.persist_flat_scan(SCAN_4, mode="live", raw={"data": {"vulnerabilityFindings": {"nodes": SCAN_4}}}, db_path=db, scan_id=S4)
    steps["after_scan4"] = dump_tables(db)
    return db, steps


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # --- persist + delete (uncompacted) ------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        db, steps = build_db(tmp)
        res = ledger.delete_scans([S2], db_path=db)
        steps["after_delete_scan2"] = dump_tables(db)
        steps["delete_result"] = res
        (OUT / "ledger_flow.json").write_text(json.dumps(scrub({
            "now": NOW,
            "scans": {"s1": {"id": S1, "records": SCAN_1}, "s2": {"id": S2, "records": SCAN_2},
                      "s3": {"id": S3, "records": SCAN_3}, "s4": {"id": S4, "records": SCAN_4}},
            "steps": steps,
        }), indent=1))
        print("wrote ledger_flow.json")

    # --- compaction + post-compaction delete --------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        db, steps = build_db(tmp)
        dry = ledger.compact_ledger(30, db_path=db, dry_run=True, now=NOW)
        real = ledger.compact_ledger(30, db_path=db, now=NOW)
        after_compact = dump_tables(db)
        conn = ledger._connect(db)
        try:
            checkpoint = ledger._load_latest_checkpoint(conn)
        finally:
            conn.close()
        # deleting a sealed scan must refuse
        sealed_error = None
        try:
            ledger.delete_scans([S1], db_path=db)
        except ledger.SealedScanError as exc:
            sealed_error = str(exc)
        # deleting a post-floor scan replays from the checkpoint
        del_res = ledger.delete_scans([S3], db_path=db)
        after_delete = dump_tables(db)
        (OUT / "ledger_compaction.json").write_text(json.dumps(scrub({
            "now": NOW, "retention_days": 30,
            "scans": {"s1": {"id": S1, "records": SCAN_1}, "s2": {"id": S2, "records": SCAN_2},
                      "s3": {"id": S3, "records": SCAN_3}, "s4": {"id": S4, "records": SCAN_4}},
            "expected": {
                "dry_run": dry, "real": {k: v for k, v in real.items()
                                         if k not in ("archive_bytes_freed", "db_bytes_freed")},
                "after_compact": after_compact,
                "checkpoint": checkpoint,
                "sealed_delete_error": sealed_error,
                "delete_s3_result": del_res,
                "after_delete_s3": after_delete,
            },
        }), indent=1))
        print("wrote ledger_compaction.json")


if __name__ == "__main__":
    main()
