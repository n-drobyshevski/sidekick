"""Tests for the severity purge (lossy: drop whole severity classes from storage).

Unlike compaction, a purge deliberately CHANGES the stats — the purged severities
vanish. The guarantees under test are: every trace (live rows, episodes, observations,
archive findings, checkpoint rows) is removed together; a later delete→rebuild never
resurrects the purged severities; the kept severities are untouched; and the operation
is crash-safe (DB + archives restored on failure).
"""

import sqlite3
from pathlib import Path

import pandas as pd
import pytest

from wiz_dashboard.data import ledger
from wiz_dashboard.domain.severity import normalize_severity

NOW = pd.Timestamp("2026-07-01T00:00:00Z")
RETENTION = 30

O1, O2, O3 = "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"
R1, R2 = "2026-06-20T00:00:00Z", "2026-06-25T00:00:00Z"


def _db(tmp_path):
    return tmp_path / "ledger.db"


def _rec(rid, sev="HIGH", asset="vm-1", first=None, resolved=None):
    r = {"id": rid, "name": f"CVE-2026-{rid}", "severity": sev,
         "vulnerableAsset.name": asset}
    if first:
        r["firstDetectedAt"] = first
    if resolved:
        r["resolvedAt"] = resolved
    return r


def _a1(**kw):
    return _rec("a1", "HIGH", first="2026-01-01T00:00:00Z", **kw)


def _seed_history(db):
    """Same shape as the compaction suite: 3 old + 2 recent flat scans, with a1 HIGH
    (open), a2 CRITICAL (disappears in o2), a3 MEDIUM (api-resolved in o1)."""
    ledger.persist_flat_scan(
        [_a1(),
         _rec("a2", "CRITICAL", first="2026-01-01T00:00:00Z"),
         _rec("a3", "MEDIUM", first="2025-12-20T00:00:00Z",
              resolved="2026-01-02T00:00:00Z")],
        mode="dry-run", db_path=db, scan_id=O1,
    )
    ledger.persist_flat_scan([_a1(),
                              _rec("a2", "CRITICAL", first="2026-01-01T00:00:00Z")],
                             mode="dry-run", db_path=db, scan_id=O2)
    ledger.persist_flat_scan([_a1()], mode="dry-run", db_path=db, scan_id=O3)
    ledger.persist_flat_scan([_a1()], mode="dry-run", db_path=db, scan_id=R1)
    ledger.persist_flat_scan([_a1()], mode="dry-run", db_path=db, scan_id=R2)


def _sevs(db):
    return set(ledger.load_base_df(db)["severity"].map(normalize_severity))


def _archive_sevs(db):
    """Every severity present across all unsealed raw archives on disk."""
    found = set()
    for _, r in ledger.load_scans_df(db).iterrows():
        payload = ledger._read_raw_payload(r["raw_path"])
        if payload is None:
            continue
        for n in ledger.extract_nodes(payload):
            found.add(ledger._node_severity(n))
    return found


# --------------------------------------------------------------------------- #
#  Basic purge
# --------------------------------------------------------------------------- #
def test_purge_removes_severity_everywhere(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    assert {"HIGH", "MEDIUM", "CRITICAL"} <= _sevs(db)

    result = ledger.purge_severities(["MEDIUM", "HIGH"], db_path=db)

    assert result["no_op"] is False
    assert sorted(result["severities"]) == ["HIGH", "MEDIUM"]
    assert result["vulns_removed"] >= 2  # a1 (HIGH), a3 (MEDIUM)
    base = ledger.load_base_df(db)
    remaining = set(base["severity"])
    assert "HIGH" not in remaining and "MEDIUM" not in remaining
    assert "CRITICAL" in remaining  # a2 kept
    assert "HIGH" not in _archive_sevs(db)  # archives rewritten
    assert "MEDIUM" not in _archive_sevs(db)


def test_purge_keeps_only_critical(tmp_path):
    """The motivating case: keep only Critical."""
    db = _db(tmp_path)
    _seed_history(db)
    ledger.purge_severities(["HIGH", "MEDIUM", "LOW", "INFO"], db_path=db)
    assert set(ledger.load_base_df(db)["severity"]) == {"CRITICAL"}


def test_purge_observations_removed(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    result = ledger.purge_severities(["HIGH"], db_path=db)
    assert result["observations_removed"] > 0
    conn = sqlite3.connect(db)
    try:
        assert conn.execute(
            "SELECT COUNT(*) FROM observations WHERE severity='HIGH'"
        ).fetchone()[0] == 0
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
#  No resurrection through delete→rebuild
# --------------------------------------------------------------------------- #
def test_delete_after_purge_does_not_resurrect(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    ledger.purge_severities(["HIGH"], db_path=db)
    # Deleting a scan replays the (rewritten) archives from the checkpoint — HIGH must
    # not come back.
    ledger.delete_scans([O3], db_path=db)
    assert "HIGH" not in set(ledger.load_base_df(db)["severity"])
    assert "HIGH" not in _archive_sevs(db)


# --------------------------------------------------------------------------- #
#  Compaction interplay (episodes + checkpoint)
# --------------------------------------------------------------------------- #
def test_purge_after_compaction_drops_episodes_and_checkpoint(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    # a3 (MEDIUM) is now a resolved episode; the checkpoint carries sealed ledger state.
    base = ledger.load_base_df(db).set_index("vuln_key")
    assert base.loc["id:a3", "severity"] == "MEDIUM"

    result = ledger.purge_severities(["MEDIUM"], db_path=db)
    assert result["episodes_removed"] == 1

    conn = sqlite3.connect(db)
    try:
        assert conn.execute(
            "SELECT COUNT(*) FROM resolved_episodes WHERE severity='MEDIUM'"
        ).fetchone()[0] == 0
        cp = ledger._decode_checkpoint(conn.execute(
            "SELECT checkpoint FROM compactions WHERE checkpoint IS NOT NULL "
            "ORDER BY ts DESC LIMIT 1"
        ).fetchone()[0])
    finally:
        conn.close()
    assert all(row.get("severity") != "MEDIUM" for row in cp["ledger"])
    assert "MEDIUM" not in set(ledger.load_base_df(db)["severity"])

    # And a delete that reseeds from the checkpoint still shows no MEDIUM.
    ledger.delete_scans([R2], db_path=db)
    assert "MEDIUM" not in set(ledger.load_base_df(db)["severity"])


# --------------------------------------------------------------------------- #
#  Dry run / no-op
# --------------------------------------------------------------------------- #
def test_purge_dry_run_mutates_nothing(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    before = ledger.load_base_df(db)
    before_archives = _archive_sevs(db)

    preview = ledger.purge_severities(["HIGH"], db_path=db, dry_run=True)

    assert preview["dry_run"] is True and preview["no_op"] is False
    assert preview["vulns_removed"] >= 1
    assert preview["scans_rewritten"] >= 1
    pd.testing.assert_frame_equal(before, ledger.load_base_df(db))
    assert _archive_sevs(db) == before_archives


def test_purge_absent_severity_is_noop(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)  # no LOW findings anywhere
    result = ledger.purge_severities(["LOW"], db_path=db)
    assert result["no_op"] is True
    assert result["vulns_removed"] == 0
    assert set(ledger.load_base_df(db)["severity"]) == {"HIGH", "CRITICAL", "MEDIUM"}


def test_purge_empty_selection_is_noop(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    assert ledger.purge_severities([], db_path=db)["no_op"] is True


# --------------------------------------------------------------------------- #
#  Refusal + crash safety
# --------------------------------------------------------------------------- #
def test_missing_archive_refuses_before_mutation(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    paths = {r["scan_id"]: r["raw_path"]
             for _, r in ledger.load_scans_df(db).iterrows()}
    Path(paths[O2]).unlink()
    before = ledger.load_base_df(db)
    with pytest.raises(ledger.LedgerRebuildError):
        ledger.purge_severities(["HIGH"], db_path=db)
    pd.testing.assert_frame_equal(before, ledger.load_base_df(db))


def test_rebuild_failure_restores_db_and_archives(tmp_path, monkeypatch):
    db = _db(tmp_path)
    _seed_history(db)
    before = ledger.load_base_df(db)
    before_archives = _archive_sevs(db)

    def boom(*a, **k):
        raise RuntimeError("rebuild blew up")

    monkeypatch.setattr(ledger, "_rebuild_from_replay", boom)
    with pytest.raises(RuntimeError):
        ledger.purge_severities(["HIGH"], db_path=db)
    monkeypatch.undo()

    pd.testing.assert_frame_equal(before, ledger.load_base_df(db))
    assert _archive_sevs(db) == before_archives  # archives restored
    assert not Path(str(db) + ".bak").exists()
    # No leftover per-file backups.
    assert not list(Path(db).parent.rglob("*.purgebak"))


# --------------------------------------------------------------------------- #
#  Stats recompute as if never scanned
# --------------------------------------------------------------------------- #
def test_purge_equals_never_scanned(tmp_path):
    """Purging HIGH must yield the same ledger as a history that only ever had the
    non-HIGH findings."""
    purged = tmp_path / "purged.db"
    _seed_history(purged)
    ledger.purge_severities(["HIGH"], db_path=purged)

    # Control: identical history minus every HIGH finding (a1).
    control = tmp_path / "control.db"
    ledger.persist_flat_scan(
        [_rec("a2", "CRITICAL", first="2026-01-01T00:00:00Z"),
         _rec("a3", "MEDIUM", first="2025-12-20T00:00:00Z",
              resolved="2026-01-02T00:00:00Z")],
        mode="dry-run", db_path=control, scan_id=O1,
    )
    ledger.persist_flat_scan([_rec("a2", "CRITICAL", first="2026-01-01T00:00:00Z")],
                             mode="dry-run", db_path=control, scan_id=O2)
    for sid in (O3, R1, R2):
        ledger.persist_flat_scan([], mode="dry-run", db_path=control, scan_id=sid)

    rows_p = sorted(ledger.load_open_and_resolved(purged), key=lambda r: r["vuln_key"])
    rows_c = sorted(ledger.load_open_and_resolved(control), key=lambda r: r["vuln_key"])
    assert rows_p == rows_c
