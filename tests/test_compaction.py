"""Tests for retention compaction (sealed floor + resolved episodes).

The headline guarantee is *stats identity*: MTTR/SLA/trend numbers must be
bit-identical before and after compaction. Everything else — sealed deletes refused,
checkpoint-seeded rebuilds, reopen-after-prune parity — protects the delete→rebuild
and reconcile semantics the ledger already had.
"""

import sqlite3

import pandas as pd
import pytest

from wiz_dashboard import config
from wiz_dashboard.data import ledger
from wiz_dashboard.data import settings as user_settings
from wiz_dashboard.domain.lifecycle import mttr_from_ledger

NOW = pd.Timestamp("2026-07-01T00:00:00Z")
RETENTION = 30  # cutoff 2026-06-01 with NOW above

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
    """3 old flat scans (sealable) + 2 recent flat scans (always protected).

    Lifecycle coverage: a1 stays OPEN throughout; a3 resolves via the API in o1;
    a2 resolves by disappearance in o2 (so its ``last_scan_id`` stays o1 — the
    subtle case for the episode-conversion criterion).
    """
    ledger.persist_flat_scan(
        [_a1(),
         _rec("a2", "CRITICAL", first="2026-01-01T00:00:00Z"),
         _rec("a3", "MEDIUM", first="2025-12-20T00:00:00Z",
              resolved="2026-01-02T00:00:00Z")],
        mode="dry-run", db_path=db, scan_id=O1,
    )
    ledger.persist_flat_scan([_a1()], mode="dry-run", db_path=db, scan_id=O2)
    ledger.persist_flat_scan([_a1()], mode="dry-run", db_path=db, scan_id=O3)
    ledger.persist_flat_scan([_a1()], mode="dry-run", db_path=db, scan_id=R1)
    ledger.persist_flat_scan([_a1()], mode="dry-run", db_path=db, scan_id=R2)


def _stats(db):
    return mttr_from_ledger(ledger.load_open_and_resolved(db), now=NOW)


def _raw_paths(db):
    df = ledger.load_scans_df(db)
    return {r["scan_id"]: r["raw_path"] for _, r in df.iterrows()}


# --------------------------------------------------------------------------- #
#  Identity — the headline guarantee
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("scope", [None, ["HIGH"], ["CRITICAL", "MEDIUM"]])
def test_compact_preserves_stats_exactly(tmp_path, scope):
    db = _db(tmp_path)
    _seed_history(db)
    before_mttr = _stats(db)
    before_trend = ledger.load_trend_df(db, severities=scope)

    result = ledger.compact_ledger(RETENTION, db_path=db, now=NOW)

    assert result["no_op"] is False
    assert result["scans_sealed"] == 3
    assert result["episodes_created"] == 2  # a2 (disappeared), a3 (api)
    assert result["floor_scan_id"] == O3
    assert ledger._stats_equal(before_mttr, _stats(db))
    after_trend = ledger.load_trend_df(db, severities=scope)
    pd.testing.assert_frame_equal(before_trend, after_trend)


def test_compact_prunes_artifacts_and_keeps_scan_rows(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    paths_before = _raw_paths(db)

    result = ledger.compact_ledger(RETENTION, db_path=db, now=NOW)

    scans = ledger.load_scans_df(db).set_index("scan_id")
    assert len(scans) == 5  # sealed rows are kept forever
    assert set(scans[scans["sealed"] == 1].index) == {O1, O2, O3}
    for sid in (O1, O2, O3):
        assert scans.loc[sid, "raw_path"] is None or pd.isna(scans.loc[sid, "raw_path"])
        assert not (paths_before[sid] and pd.notna(paths_before[sid])
                    and __import__("pathlib").Path(paths_before[sid]).exists())
    for sid in (R1, R2):
        assert pd.notna(scans.loc[sid, "raw_path"])  # protected: archive survives

    conn = sqlite3.connect(db)
    try:
        obs_scans = {r[0] for r in conn.execute("SELECT DISTINCT scan_id FROM observations")}
        episodes = {r[0]: r for r in conn.execute(
            "SELECT vuln_key, resolution_src, superseded_by_scan FROM resolved_episodes"
        )}
        live = {r[0] for r in conn.execute("SELECT vuln_key FROM vuln_ledger")}
    finally:
        conn.close()
    assert obs_scans == {R1, R2}
    assert set(episodes) == {"id:a2", "id:a3"}
    assert episodes["id:a2"][1] == "disappeared"
    assert episodes["id:a3"][1] == "api"
    assert all(e[2] is None for e in episodes.values())
    assert live == {"id:a1"}  # open rows always stay live
    assert result["observations_pruned"] > 0

    base = ledger.load_base_df(db).set_index("vuln_key")
    assert base.loc["id:a2", "asset_name"] == "(compacted)"
    assert base.loc["id:a2", "status"] == "RESOLVED"
    assert base.loc["id:a1", "asset_name"] == "vm-1"  # live rows keep full detail


def test_compact_dry_run_mutates_nothing(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    before_base = ledger.load_base_df(db)
    paths = _raw_paths(db)

    preview = ledger.compact_ledger(RETENTION, db_path=db, dry_run=True, now=NOW)

    assert preview["dry_run"] is True and preview["no_op"] is False
    assert preview["scans_sealed"] == 3 and preview["episodes_created"] == 2
    assert preview["archive_bytes_freed"] > 0
    scans = ledger.load_scans_df(db)
    assert int(scans["sealed"].sum()) == 0
    pd.testing.assert_frame_equal(before_base, ledger.load_base_df(db))
    for p in paths.values():
        assert __import__("pathlib").Path(p).exists()


def test_compact_is_idempotent_noop(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    first = ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    assert first["no_op"] is False
    second = ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    assert second["no_op"] is True
    assert len(ledger.load_scans_df(db)) == 5


def test_compact_none_retention_is_off(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    assert ledger.compact_ledger(None, db_path=db, now=NOW)["no_op"] is True
    assert int(ledger.load_scans_df(db)["sealed"].sum()) == 0


def test_compact_clamps_to_min_retention(tmp_path):
    """A 1-day window must not seal the protected recent scans: the clamp to
    RETENTION_MIN_DAYS plus the last-two-flat-scans guard keep R1/R2 unsealed."""
    db = _db(tmp_path)
    _seed_history(db)
    result = ledger.compact_ledger(1, db_path=db, now=NOW)
    scans = ledger.load_scans_df(db).set_index("scan_id")
    assert result["scans_sealed"] == 3
    assert not scans.loc[R1, "sealed"] and not scans.loc[R2, "sealed"]
    row = ledger.load_latest_flat_scan_row(db)
    assert row["scan_id"] == R2
    assert ledger._read_raw_payload(row["raw_path"]) is not None  # quick-refresh baseline


def test_previous_severity_counts_unchanged_by_compaction(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    before = ledger.previous_severity_counts(db)
    ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    assert ledger.previous_severity_counts(db) == before


# --------------------------------------------------------------------------- #
#  Delete interactions
# --------------------------------------------------------------------------- #
def test_sealed_delete_refused(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    before = ledger.load_base_df(db)
    with pytest.raises(ledger.SealedScanError):
        ledger.delete_scans([O2], db_path=db)
    pd.testing.assert_frame_equal(before, ledger.load_base_df(db))
    assert len(ledger.load_scans_df(db)) == 5


def test_post_floor_delete_equals_never_persisted(tmp_path):
    """The keystone invariant above the floor: compact → persist P1,P2 → delete P1
    must equal compact → persist P2 only."""
    p1, p2 = "2026-07-02T00:00:00Z", "2026-07-03T00:00:00Z"
    dbs = {}
    for name in ("a", "b"):
        db = tmp_path / f"{name}.db"
        _seed_history(db)
        ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
        dbs[name] = db
    # A: P1 (re-lists a1, introduces b1) then P2 (a1 only -> b1 disappears), delete P1.
    ledger.persist_flat_scan([_a1(), _rec("b1", "LOW", first="2026-07-01T12:00:00Z")],
                             mode="dry-run", db_path=dbs["a"], scan_id=p1)
    ledger.persist_flat_scan([_a1()], mode="dry-run", db_path=dbs["a"], scan_id=p2)
    ledger.delete_scans([p1], db_path=dbs["a"])
    # B: P2 only.
    ledger.persist_flat_scan([_a1()], mode="dry-run", db_path=dbs["b"], scan_id=p2)

    rows_a = sorted(ledger.load_open_and_resolved(dbs["a"]), key=lambda r: r["vuln_key"])
    rows_b = sorted(ledger.load_open_and_resolved(dbs["b"]), key=lambda r: r["vuln_key"])
    assert rows_a == rows_b
    pd.testing.assert_frame_equal(
        ledger.load_trend_df(dbs["a"]), ledger.load_trend_df(dbs["b"])
    )
    scans_a = ledger.load_scans_df(dbs["a"])
    assert set(scans_a["scan_id"]) == {O1, O2, O3, R1, R2, p2}
    assert set(scans_a.loc[scans_a["sealed"] == 1, "scan_id"]) == {O1, O2, O3}


def test_delete_all_unsealed_keeps_compacted_baseline(tmp_path):
    db = _db(tmp_path)
    _seed_history(db)
    ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    ledger.delete_scans([R1, R2], db_path=db)
    scans = ledger.load_scans_df(db)
    assert set(scans["scan_id"]) == {O1, O2, O3}
    base = ledger.load_base_df(db).set_index("vuln_key")
    # a1 comes back from the checkpoint (it was OPEN at the floor, never episodized);
    # a2/a3 stay as episodes.
    assert set(base.index) == {"id:a1", "id:a2", "id:a3"}
    assert base.loc["id:a1", "status"] == "OPEN"
    assert base.loc["id:a1", "asset_name"] == "vm-1"


# --------------------------------------------------------------------------- #
#  Reopen / re-list collisions with pruned rows
# --------------------------------------------------------------------------- #
def test_reopen_after_prune(tmp_path):
    reopen_scan = "2026-07-02T00:00:00Z"
    db = _db(tmp_path)
    _seed_history(db)
    ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    pre_reopen_trend = ledger.load_trend_df(db)

    # a2 is active again — its ledger row is gone (episode). Control DB: identical
    # history, never compacted.
    control = tmp_path / "control.db"
    _seed_history(control)
    for target in (db, control):
        deltas = ledger.persist_flat_scan(
            [_a1(), _rec("a2", "CRITICAL", first="2026-01-01T00:00:00Z")],
            mode="dry-run", db_path=target, scan_id=reopen_scan,
        )
        assert deltas == {"new_count": 0, "resolved_count": 0, "reopened_count": 1}

    conn = sqlite3.connect(db)
    try:
        row = conn.execute(
            "SELECT status, reopened_count FROM vuln_ledger WHERE vuln_key='id:a2'"
        ).fetchone()
        superseded = conn.execute(
            "SELECT superseded_by_scan FROM resolved_episodes WHERE vuln_key='id:a2'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert row == ("OPEN", 1)
    assert superseded == reopen_scan

    fixed_now = pd.Timestamp("2026-07-03T00:00:00Z")
    compacted = mttr_from_ledger(ledger.load_open_and_resolved(db), now=fixed_now)
    uncompacted = mttr_from_ledger(ledger.load_open_and_resolved(control), now=fixed_now)
    assert ledger._stats_equal(compacted, uncompacted)

    # Deleting the reopening scan restores the episode (supersession re-derived: none).
    ledger.delete_scans([reopen_scan], db_path=db)
    conn = sqlite3.connect(db)
    try:
        assert conn.execute(
            "SELECT COUNT(*) FROM vuln_ledger WHERE vuln_key='id:a2'"
        ).fetchone()[0] == 0
        assert conn.execute(
            "SELECT superseded_by_scan FROM resolved_episodes WHERE vuln_key='id:a2'"
        ).fetchone()[0] is None
    finally:
        conn.close()
    pd.testing.assert_frame_equal(pre_reopen_trend, ledger.load_trend_df(db))


def test_relisted_resolution_keeps_episode_authoritative(tmp_path):
    """The API re-lists an already-counted resolution after its row was compacted:
    the uncompacted ledger would keep the old row and count nothing — parity demands
    the episode stays and no fresh RESOLVED row double-counts."""
    relist_scan = "2026-07-02T00:00:00Z"
    db = _db(tmp_path)
    _seed_history(db)
    ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    control = tmp_path / "control.db"
    _seed_history(control)

    relist = [_a1(), _rec("a3", "MEDIUM", first="2025-12-20T00:00:00Z",
                          resolved="2026-01-02T00:00:00Z")]
    for target in (db, control):
        deltas = ledger.persist_flat_scan(relist, mode="dry-run", db_path=target,
                                          scan_id=relist_scan)
        assert deltas == {"new_count": 0, "resolved_count": 0, "reopened_count": 0}

    conn = sqlite3.connect(db)
    try:
        assert conn.execute(
            "SELECT COUNT(*) FROM vuln_ledger WHERE vuln_key='id:a3'"
        ).fetchone()[0] == 0
        assert conn.execute(
            "SELECT superseded_by_scan FROM resolved_episodes WHERE vuln_key='id:a3'"
        ).fetchone()[0] is None
    finally:
        conn.close()
    fixed_now = pd.Timestamp("2026-07-03T00:00:00Z")
    assert ledger._stats_equal(
        mttr_from_ledger(ledger.load_open_and_resolved(db), now=fixed_now),
        mttr_from_ledger(ledger.load_open_and_resolved(control), now=fixed_now),
    )


# --------------------------------------------------------------------------- #
#  Severity-scope fidelity across the floor
# --------------------------------------------------------------------------- #
def test_scoped_disappearance_resolves_across_the_floor(tmp_path):
    """m1 (MEDIUM) was last covered by a now-sealed unscoped scan; HIGH-only scans in
    between must not resolve it, and the first post-floor scan that covers MEDIUM
    again must — via the checkpoint's last_scan_id + the sealed scans' stored scope."""
    db = _db(tmp_path)
    ledger.persist_flat_scan(
        [_rec("h1", "HIGH", first="2026-01-01T00:00:00Z"),
         _rec("m1", "MEDIUM", first="2026-01-01T00:00:00Z")],
        mode="dry-run", db_path=db, scan_id=O1,  # unscoped: covers MEDIUM
    )
    for sid in (O2, R1, R2):  # HIGH-only: m1's absence is expected, not resolution
        ledger.persist_flat_scan(
            [_rec("h1", "HIGH", first="2026-01-01T00:00:00Z")],
            mode="dry-run", db_path=db, scan_id=sid,
            scanned_severities=("HIGH",),
        )
    result = ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    assert result["scans_sealed"] == 2  # O1, O2 (R1/R2 protected)
    base = ledger.load_base_df(db).set_index("vuln_key")
    assert base.loc["id:m1", "status"] == "OPEN"  # never falsely resolved

    # First post-floor scan covering MEDIUM again, m1 absent -> resolves now.
    ledger.persist_flat_scan(
        [_rec("h1", "HIGH", first="2026-01-01T00:00:00Z")],
        mode="dry-run", db_path=db, scan_id="2026-07-02T00:00:00Z",
    )
    base = ledger.load_base_df(db).set_index("vuln_key")
    assert base.loc["id:m1", "status"] == "RESOLVED"
    assert base.loc["id:m1", "resolution_src"] == "disappeared"


# --------------------------------------------------------------------------- #
#  Refusals and crash safety
# --------------------------------------------------------------------------- #
def test_missing_candidate_archive_refuses_before_mutation(tmp_path):
    from pathlib import Path

    db = _db(tmp_path)
    _seed_history(db)
    Path(_raw_paths(db)[O2]).unlink()
    before = ledger.load_base_df(db)
    with pytest.raises(ledger.LedgerRebuildError):
        ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    pd.testing.assert_frame_equal(before, ledger.load_base_df(db))
    assert int(ledger.load_scans_df(db)["sealed"].sum()) == 0


def test_identity_check_failure_rolls_back_and_restores(tmp_path, monkeypatch):
    from pathlib import Path

    db = _db(tmp_path)
    _seed_history(db)
    before = ledger.load_base_df(db)
    paths = _raw_paths(db)
    monkeypatch.setattr(ledger, "_stats_equal", lambda a, b: False)
    with pytest.raises(ledger.LedgerRebuildError):
        ledger.compact_ledger(RETENTION, db_path=db, now=NOW)
    monkeypatch.undo()
    pd.testing.assert_frame_equal(before, ledger.load_base_df(db))
    assert int(ledger.load_scans_df(db)["sealed"].sum()) == 0
    for p in paths.values():
        assert Path(p).exists()  # files are only unlinked after a successful commit
    assert not Path(str(db) + ".bak").exists()


# --------------------------------------------------------------------------- #
#  Schema migration
# --------------------------------------------------------------------------- #
def test_schema_v3_migrates_to_v4(tmp_path):
    db = _db(tmp_path)
    conn = sqlite3.connect(db)
    try:
        conn.executescript(
            """
            CREATE TABLE scans (scan_id TEXT PRIMARY KEY, ts TEXT NOT NULL,
                mode TEXT NOT NULL, shape TEXT NOT NULL, total INTEGER NOT NULL,
                new_count INTEGER DEFAULT 0, resolved_count INTEGER DEFAULT 0,
                reopened_count INTEGER DEFAULT 0, raw_path TEXT, severities TEXT);
            CREATE TABLE vuln_ledger (vuln_key TEXT PRIMARY KEY, cve TEXT, severity TEXT,
                asset_id TEXT, asset_name TEXT, asset_type TEXT, cloud TEXT,
                first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, status TEXT NOT NULL,
                resolved_at TEXT, resolution_src TEXT, reopened_count INTEGER DEFAULT 0,
                first_scan_id TEXT, last_scan_id TEXT);
            CREATE TABLE observations (scan_id TEXT NOT NULL, vuln_key TEXT NOT NULL,
                present INTEGER NOT NULL, severity TEXT, status TEXT,
                PRIMARY KEY (scan_id, vuln_key));
            CREATE TABLE schema_meta (version INTEGER NOT NULL);
            INSERT INTO schema_meta (version) VALUES (3);
            INSERT INTO scans VALUES ('2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z',
                'dry-run', 'flat', 0, 0, 0, 0, NULL, NULL);
            """
        )
        conn.commit()
    finally:
        conn.close()

    ledger.init_db(db)

    conn = sqlite3.connect(db)
    try:
        assert (conn.execute("SELECT version FROM schema_meta").fetchone()[0]
                == ledger.SCHEMA_VERSION)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(scans)")}
        assert "sealed" in cols
        assert conn.execute(
            "SELECT sealed FROM scans WHERE scan_id='2026-05-01T00:00:00Z'"
        ).fetchone()[0] == 0  # historical scans read as unsealed
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        assert {"resolved_episodes", "compactions"} <= tables
    finally:
        conn.close()


def test_pre_v4_db_readable_without_migration(tmp_path):
    """A v3 DB opened by a read-only loader (no init_db) must not crash on the missing
    episodes table — the union is skipped when the table is absent."""
    db = _db(tmp_path)
    conn = sqlite3.connect(db)
    try:
        conn.executescript(
            """
            CREATE TABLE scans (scan_id TEXT PRIMARY KEY, ts TEXT NOT NULL,
                mode TEXT NOT NULL, shape TEXT NOT NULL, total INTEGER NOT NULL,
                new_count INTEGER DEFAULT 0, resolved_count INTEGER DEFAULT 0,
                reopened_count INTEGER DEFAULT 0, raw_path TEXT, severities TEXT);
            CREATE TABLE vuln_ledger (vuln_key TEXT PRIMARY KEY, cve TEXT, severity TEXT,
                asset_id TEXT, asset_name TEXT, asset_type TEXT, cloud TEXT,
                first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, status TEXT NOT NULL,
                resolved_at TEXT, resolution_src TEXT, reopened_count INTEGER DEFAULT 0,
                first_scan_id TEXT, last_scan_id TEXT);
            CREATE TABLE observations (scan_id TEXT NOT NULL, vuln_key TEXT NOT NULL,
                present INTEGER NOT NULL, severity TEXT, status TEXT,
                PRIMARY KEY (scan_id, vuln_key));
            CREATE TABLE schema_meta (version INTEGER NOT NULL);
            INSERT INTO schema_meta (version) VALUES (3);
            INSERT INTO vuln_ledger VALUES ('id:x1', 'CVE-2026-1', 'HIGH', NULL, 'vm-1',
                NULL, NULL, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', 'OPEN',
                NULL, NULL, 0, 's1', 's1');
            """
        )
        conn.commit()
    finally:
        conn.close()
    base = ledger.load_base_df(db)
    assert len(base) == 1
    assert ledger.load_open_and_resolved(db)[0]["vuln_key"] == "id:x1"


# --------------------------------------------------------------------------- #
#  Retention settings
# --------------------------------------------------------------------------- #
def test_retention_settings_defaults_and_roundtrip():
    assert user_settings.get_retention_days() == config.DEFAULT_RETENTION_DAYS
    assert user_settings.get_auto_compact() is True

    user_settings.set_retention_days(365)
    assert user_settings.get_retention_days() == 365
    user_settings.set_retention_days(1)  # clamped to the guardrail
    assert user_settings.get_retention_days() == config.RETENTION_MIN_DAYS
    user_settings.set_retention_days(None)  # off
    assert user_settings.get_retention_days() is None

    user_settings.set_auto_compact(False)
    assert user_settings.get_auto_compact() is False
