"""Golden fixtures for the migration import: the ORIGINAL Python ledger computes the
expected outcome, because the import is defined as "the unified history compacted at
the import floor".

Each scenario builds one SQLite DB: the "streamlit era" scans are persisted and
exported with migrate.build_migration_bundle (the real exporter), the "GAS era"
scans are persisted on top, and ledger.compact_ledger seals the streamlit prefix —
producing exactly the tables the TS importBundleCore must reach when it seeds from
the bundle and replays the GAS scans.

Run from the repo root: python gas/test/export_migration_fixture.py
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from wiz_dashboard.data import history, ledger, migrate  # noqa: E402
from export_ledger_fixtures import SCAN_COLS, node, scrub  # noqa: E402

OUT = Path(__file__).parent / "fixtures"
NOW = "2026-07-01T00:00:00Z"

# Unlike export_ledger_fixtures, episodes here KEEP compaction_id: the bundle carries
# it verbatim, and the test normalizes only the ids minted by the import itself.
EPISODE_COLS = ["vuln_key", "cve", "severity", "first_seen", "resolved_at",
                "resolution_src", "reopened_count", "compaction_id", "superseded_by_scan"]


def envelope(records):
    return {"data": {"vulnerabilityFindings": {"nodes": records}}}


def dump(db):
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
        episodes = [
            {c: r[c] for c in EPISODE_COLS}
            for r in conn.execute("SELECT * FROM resolved_episodes ORDER BY vuln_key")
        ]
        cmp_ids = [
            r["compaction_id"]
            for r in conn.execute("SELECT compaction_id FROM compactions ORDER BY ts ASC")
        ]
        checkpoint = ledger._load_latest_checkpoint(conn)
    finally:
        conn.close()
    return {"scans": scans, "ledger": vulns, "episodes": episodes,
            "compaction_ids": cmp_ids, "checkpoint": checkpoint}


def persist(db, scan_id, records):
    ledger.persist_flat_scan(records, mode="live", raw=envelope(records),
                             db_path=db, scan_id=scan_id)


# --------------------------------------------------------------------------- #
#  Scenario A — uncompacted streamlit bundle, overlapping GAS history
# --------------------------------------------------------------------------- #
# Vulns: A persists across both eras (first_seen backdate), B resolved in the
# streamlit era then re-listed by GAS (reopen), C open in the streamlit era and
# absent from GAS (resolution by disappearance at the first GAS scan), E settled
# before the import floor (episode conversion), D born in the GAS era (plain new).

T1, T2, T3 = "2026-01-05T06:00:00Z", "2026-01-12T06:00:00Z", "2026-01-20T06:00:00Z"
T4, T5 = "2026-06-10T06:00:00Z", "2026-06-20T06:00:00Z"

A_OPEN = node("A", "CVE-A", "CRITICAL", "OPEN", "vm-a", first="2025-12-20T00:00:00Z")
B_OPEN = node("B", "CVE-B", "HIGH", "OPEN", "vm-b", first="2026-01-02T00:00:00Z")
B_RESOLVED = node("B", "CVE-B", "HIGH", "RESOLVED", "vm-b", first="2026-01-02T00:00:00Z",
                  resolved="2026-01-10T00:00:00Z")
C_OPEN = node("C", "CVE-C", "MEDIUM", "OPEN", "vm-c")
E_RESOLVED = node("E", "CVE-E", "HIGH", "RESOLVED", "vm-e", first="2026-01-02T00:00:00Z",
                  resolved="2026-01-15T00:00:00Z")
D_OPEN = node("D", "CVE-D", "CRITICAL", "OPEN", "vm-d")

STREAMLIT_A = {T1: [A_OPEN, B_OPEN, C_OPEN],
               T2: [A_OPEN, B_RESOLVED, C_OPEN],
               T3: [A_OPEN, C_OPEN, E_RESOLVED]}
GAS_A = {T4: [A_OPEN, B_OPEN, D_OPEN],
         T5: [A_OPEN, B_OPEN, D_OPEN]}


def scenario_a():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.db"
        hist = Path(tmp) / "mttr_history.json"
        for sid, recs in STREAMLIT_A.items():
            persist(db, sid, recs)
        history.record_snapshot(5.0, resolved=3, open_=10, counts={"HIGH": 13},
                                filename=str(hist), when="2026-01-20", sla_pct=90.0,
                                oldest_open_days=45.0)
        history.record_snapshot(4.0, resolved=4, open_=9, counts={"HIGH": 13},
                                filename=str(hist), when="2026-06-15")
        bundle = migrate.build_migration_bundle(db, hist)

        for sid, recs in GAS_A.items():
            persist(db, sid, recs)
        compact = ledger.compact_ledger(30, db_path=db, now=NOW)
        assert not compact["no_op"], "scenario A compaction must not be a no-op"
        assert compact["floor_scan_id"] == T3, compact
        expected = dump(db)

        # Deleting a post-floor (GAS) scan must replay cleanly from the checkpoint —
        # the exact guarantee the synthetic import checkpoint has to give.
        delete_result = ledger.delete_scans([T4], db_path=db)
        after_delete = dump(db)

    return {
        "bundle": bundle,
        "gas_scans": [{"id": sid, "records": recs} for sid, recs in GAS_A.items()],
        "expected": expected,
        "delete_t4": {"id": T4, "result": delete_result, "after": after_delete},
    }


# --------------------------------------------------------------------------- #
#  Scenario B — the streamlit ledger was already compacted before export
# --------------------------------------------------------------------------- #
# X settles in the sealed streamlit prefix (episode already in the bundle), Z
# settles at the import floor (converted by the import), Y persists across both
# eras, W is GAS-born.

U1, U2 = "2025-11-01T06:00:00Z", "2025-11-10T06:00:00Z"
U3, U4 = "2026-01-10T06:00:00Z", "2026-01-20T06:00:00Z"
U5, U6 = "2026-06-10T06:00:00Z", "2026-06-20T06:00:00Z"

X_OPEN = node("X", "CVE-X", "HIGH", "OPEN", "vm-x", first="2025-10-20T00:00:00Z")
X_RESOLVED = node("X", "CVE-X", "HIGH", "RESOLVED", "vm-x", first="2025-10-20T00:00:00Z",
                  resolved="2025-11-05T00:00:00Z")
Y_OPEN = node("Y", "CVE-Y", "CRITICAL", "OPEN", "vm-y", first="2025-10-25T00:00:00Z")
Z_OPEN = node("Z", "CVE-Z", "MEDIUM", "OPEN", "vm-z")
Z_RESOLVED = node("Z", "CVE-Z", "MEDIUM", "RESOLVED", "vm-z",
                  resolved="2026-01-18T00:00:00Z")
W_OPEN = node("W", "CVE-W", "HIGH", "OPEN", "vm-w")

STREAMLIT_B = {U1: [X_OPEN, Y_OPEN], U2: [X_RESOLVED, Y_OPEN],
               U3: [Y_OPEN, Z_OPEN], U4: [Y_OPEN, Z_RESOLVED]}
GAS_B = {U5: [Y_OPEN, W_OPEN], U6: [Y_OPEN, W_OPEN]}


def scenario_b():
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "ledger.db"
        for sid, recs in STREAMLIT_B.items():
            persist(db, sid, recs)
        # First compaction (the streamlit deployment's own): cutoff between U2 and
        # U3 seals U1/U2 and converts X into an episode.
        first = ledger.compact_ledger(200, db_path=db, now=NOW)
        assert not first["no_op"] and first["floor_scan_id"] == U2, first
        bundle = migrate.build_migration_bundle(db, Path(tmp) / "no_history.json")

        for sid, recs in GAS_B.items():
            persist(db, sid, recs)
        # Second compaction at the import floor (U4).
        second = ledger.compact_ledger(30, db_path=db, now=NOW)
        assert not second["no_op"] and second["floor_scan_id"] == U4, second
        expected = dump(db)

    return {
        "bundle": bundle,
        "gas_scans": [{"id": sid, "records": recs} for sid, recs in GAS_B.items()],
        "expected": expected,
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "migration_bundle.json").write_text(json.dumps(scrub({
        "now": NOW,
        "scenario_a": scenario_a(),
        "scenario_b": scenario_b(),
    }), indent=1))
    print("wrote migration_bundle.json")


if __name__ == "__main__":
    main()
