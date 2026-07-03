"""Tests for the SQLite scan archive + vulnerability ledger."""

import sqlite3

import os_vulns

from wiz_dashboard.data import ledger
from wiz_dashboard.models import schema


def _db(tmp_path):
    return tmp_path / "ledger.db"


def _flat_records(app):
    nodes = app.extract_nodes(os_vulns.SAMPLE_RESULTS)
    return app.nodes_to_dataframe(nodes).to_dict("records")


def test_init_creates_schema(tmp_path):
    db = _db(tmp_path)
    ledger.init_db(db)
    assert db.exists()
    assert ledger.load_scans_df(db).empty
    assert ledger.load_base_df(db).empty
    assert ledger.load_open_and_resolved(db) == []


def test_persist_flat_scan_roundtrip(tmp_path, app):
    db = _db(tmp_path)
    deltas = ledger.persist_flat_scan(
        _flat_records(app), mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
        db_path=db, scan_id="2026-05-29T10:00:00Z",
    )
    assert deltas["new_count"] == 17
    base = ledger.load_base_df(db)
    assert len(base) == 17
    scans = ledger.load_scans_df(db)
    assert len(scans) == 1
    assert scans["total"].iloc[0] == 17
    # 13 of the 17 sample findings carry a resolvedAt -> resolved via the API.
    assert int((base["status"] == "RESOLVED").sum()) == 13
    assert deltas["resolved_count"] == 13


def test_idempotent_resave(tmp_path, app):
    db = _db(tmp_path)
    recs = _flat_records(app)
    ledger.persist_flat_scan(recs, mode="dry-run", db_path=db, scan_id="2026-05-29T10:00:00Z")
    before = ledger.load_base_df(db).set_index("vuln_key").loc["id:dry-c1", "first_seen"]
    ledger.persist_flat_scan(recs, mode="dry-run", db_path=db, scan_id="2026-05-29T10:00:00Z")
    assert len(ledger.load_scans_df(db)) == 1  # still one scan
    after = ledger.load_base_df(db).set_index("vuln_key").loc["id:dry-c1", "first_seen"]
    assert before == after  # first_seen not corrupted by the re-save


def test_grouped_scan_skips_ledger(tmp_path):
    # A clean grouped-by-asset node (analytics counts, no per-finding severity/timestamps).
    db = _db(tmp_path)
    nodes = [
        {
            "id": "g1",
            "vulnerableAsset": {"name": "vm-1", "type": "VIRTUAL_MACHINE"},
            "analytics": {"criticalSeverityFindingCount": 5, "totalFindingCount": 5},
        }
    ]
    assert schema.is_grouped_shape(nodes)
    deltas = ledger.persist_grouped_scan(
        nodes, mode="dry-run", db_path=db, scan_id="2026-05-29T11:00:00Z"
    )
    assert deltas == {"new_count": 0, "resolved_count": 0, "reopened_count": 0}
    scans = ledger.load_scans_df(db)
    assert len(scans) == 1
    assert scans["shape"].iloc[0] == "grouped"
    assert ledger.load_base_df(db).empty


def test_two_scans_disappearance_resolves(tmp_path):
    # Scan 1 has an open finding; scan 2 omits it -> resolved by disappearance.
    db = _db(tmp_path)
    rec = {"id": "x1", "name": "CVE-2026-1", "severity": "HIGH",
           "vulnerableAsset.name": "vm-1", "firstDetectedAt": "2026-05-01T00:00:00Z"}
    ledger.persist_flat_scan([rec], mode="dry-run", db_path=db, scan_id="2026-05-01T00:00:00Z")
    d2 = ledger.persist_flat_scan([], mode="dry-run", db_path=db, scan_id="2026-05-04T00:00:00Z")
    assert d2["resolved_count"] == 1
    base = ledger.load_base_df(db).set_index("vuln_key")
    assert base.loc["id:x1", "status"] == "RESOLVED"
    assert base.loc["id:x1", "resolution_src"] == "disappeared"


def test_previous_severity_counts(tmp_path):
    """The durable per-severity baseline for the breakdown's change badges is the *previous*
    flat scan (second-to-last): empty until two flat scans exist, counting only vulns that
    were *present* in that scan (normalized severity, mixed-case folded), and excluding the
    present=0 disappearance rows.  Persisting across sessions is what makes the severity
    badges show on a session's first scan, mirroring how the MTTR KPIs read their baseline.
    """
    db = _db(tmp_path)
    assert ledger.previous_severity_counts(db) == {}  # no scans yet -> no baseline

    scan1 = [
        {"id": "a1", "name": "CVE-2026-1", "severity": "CRITICAL", "vulnerableAsset.name": "vm-1"},
        {"id": "a2", "name": "CVE-2026-2", "severity": "high", "vulnerableAsset.name": "vm-1"},
        {"id": "a3", "name": "CVE-2026-3", "severity": "High", "vulnerableAsset.name": "vm-2"},
    ]
    ledger.persist_flat_scan(scan1, mode="dry-run", db_path=db, scan_id="2026-05-01T00:00:00Z")
    assert ledger.previous_severity_counts(db) == {}  # one scan -> still no "previous"

    scan2 = [
        {"id": "a1", "name": "CVE-2026-1", "severity": "CRITICAL", "vulnerableAsset.name": "vm-1"},
        {"id": "a4", "name": "CVE-2026-4", "severity": "MEDIUM", "vulnerableAsset.name": "vm-3"},
    ]
    ledger.persist_flat_scan(scan2, mode="dry-run", db_path=db, scan_id="2026-05-02T00:00:00Z")
    # previous = scan1's present counts; mixed-case "high"/"High" fold to one HIGH bucket.
    assert ledger.previous_severity_counts(db) == {"CRITICAL": 1, "HIGH": 2}

    scan3 = [
        {"id": "a1", "name": "CVE-2026-1", "severity": "CRITICAL", "vulnerableAsset.name": "vm-1"},
    ]
    ledger.persist_flat_scan(scan3, mode="dry-run", db_path=db, scan_id="2026-05-03T00:00:00Z")
    # previous is now scan2; the a2/a3 disappearances logged under scan2 are present=0 and
    # must NOT inflate the HIGH bucket — only vulns actually seen in scan2 count.
    assert ledger.previous_severity_counts(db) == {"CRITICAL": 1, "MEDIUM": 1}


def test_previous_severity_counts_ignores_grouped(tmp_path):
    """Grouped scans write no observations, so they never serve as the baseline — the
    'previous' stays the prior *flat* scan even when a grouped scan is saved between."""
    db = _db(tmp_path)
    flat1 = [{"id": "a1", "name": "CVE-2026-1", "severity": "CRITICAL",
              "vulnerableAsset.name": "vm-1"}]
    ledger.persist_flat_scan(flat1, mode="dry-run", db_path=db, scan_id="2026-05-01T00:00:00Z")
    grouped = [{"id": "g1", "vulnerableAsset": {"name": "vm-9", "type": "VIRTUAL_MACHINE"},
                "analytics": {"criticalSeverityFindingCount": 5, "totalFindingCount": 5}}]
    ledger.persist_grouped_scan(grouped, mode="dry-run", db_path=db, scan_id="2026-05-02T00:00:00Z")
    flat2 = [{"id": "a2", "name": "CVE-2026-2", "severity": "LOW",
              "vulnerableAsset.name": "vm-2"}]
    ledger.persist_flat_scan(flat2, mode="dry-run", db_path=db, scan_id="2026-05-03T00:00:00Z")
    # Two flat scans + one grouped between them: previous flat = flat1.
    assert ledger.previous_severity_counts(db) == {"CRITICAL": 1}


def test_load_trend_df_shape(tmp_path, app):
    db = _db(tmp_path)
    ledger.persist_flat_scan(
        _flat_records(app), mode="dry-run", db_path=db, scan_id="2026-05-29T10:00:00Z"
    )
    trend = ledger.load_trend_df(db)
    assert list(trend.columns) == [
        "date", "open", "resolved", "median_days", "sla_pct", "oldest_open_days"
    ]
    assert len(trend) == 1
    assert trend["resolved"].iloc[0] == 13
    assert trend["open"].iloc[0] == 4
    assert trend["median_days"].iloc[0] is not None
    # In-SLA% is a 0–100 share; oldest-open is a non-negative age (both reconstructed).
    assert 0.0 <= trend["sla_pct"].iloc[0] <= 100.0
    assert trend["oldest_open_days"].iloc[0] >= 0
    # The reconstructed In-SLA% matches the per-severity helper over the full base (a single
    # scan ts means resolved-by-ts == all resolved, so the two coincide exactly).
    from wiz_dashboard.domain import lifecycle, metrics

    per_sev, _ = lifecycle.mttr_from_ledger(ledger.load_open_and_resolved(db))
    sla_helper, _ = metrics.overall_sla_oldest(per_sev)
    assert round(float(trend["sla_pct"].iloc[0]), 1) == round(float(sla_helper), 1)


# ---------------------------------------------------------------------------
#  delete_scans tests
# ---------------------------------------------------------------------------

def _ledger_rows(db):
    """Raw vuln_ledger rows (lifecycle truth), ordered for stable comparison."""
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM vuln_ledger ORDER BY vuln_key")]
    finally:
        conn.close()


def _scan_deltas(db):
    """scans rows projected to the comparable columns (raw_path/path excluded)."""
    cols = ["scan_id", "ts", "mode", "shape", "total",
            "new_count", "resolved_count", "reopened_count"]
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return [
            {c: r[c] for c in cols}
            for r in conn.execute("SELECT * FROM scans ORDER BY ts ASC, scan_id ASC")
        ]
    finally:
        conn.close()


# Three flat scans. x1 persists throughout; x2 only in s1; x3 only in s2 (the deleted one).
_S1 = [
    {"id": "x1", "name": "CVE-2026-1", "severity": "HIGH", "vulnerableAsset.name": "vm-1",
     "firstDetectedAt": "2026-05-01T00:00:00Z"},
    {"id": "x2", "name": "CVE-2026-2", "severity": "LOW", "vulnerableAsset.name": "vm-2",
     "firstDetectedAt": "2026-05-01T00:00:00Z"},
]
_S2 = [
    {"id": "x1", "name": "CVE-2026-1", "severity": "HIGH", "vulnerableAsset.name": "vm-1"},
    {"id": "x3", "name": "CVE-2026-3", "severity": "CRITICAL", "vulnerableAsset.name": "vm-3",
     "firstDetectedAt": "2026-05-02T00:00:00Z"},
]
_S3 = [
    {"id": "x1", "name": "CVE-2026-1", "severity": "HIGH", "vulnerableAsset.name": "vm-1"},
]


def _build(db, scans):
    """Persist a list of (scan_id, records) flat scans into a fresh db."""
    for scan_id, recs in scans:
        ledger.persist_flat_scan(recs, mode="dry-run", db_path=db, scan_id=scan_id)


def test_delete_middle_scan_equals_never_persisted(tmp_path):
    full = tmp_path / "full" / "ledger.db"
    direct = tmp_path / "direct" / "ledger.db"
    _build(full, [("2026-05-01T00:00:00Z", _S1),
                  ("2026-05-02T00:00:00Z", _S2),
                  ("2026-05-03T00:00:00Z", _S3)])
    _build(direct, [("2026-05-01T00:00:00Z", _S1),
                    ("2026-05-03T00:00:00Z", _S3)])

    summary = ledger.delete_scans(["2026-05-02T00:00:00Z"], db_path=full)

    assert summary["deleted"] == 1
    assert summary["scans"] == 2
    # The rebuilt ledger and scan deltas are identical to a ledger that never saw s2.
    assert _ledger_rows(full) == _ledger_rows(direct)
    assert _scan_deltas(full) == _scan_deltas(direct)


def test_delete_latest_scan_equals_prior_state(tmp_path):
    full = tmp_path / "full" / "ledger.db"
    only1 = tmp_path / "only1" / "ledger.db"
    _build(full, [("2026-05-01T00:00:00Z", _S1), ("2026-05-03T00:00:00Z", _S3)])
    _build(only1, [("2026-05-01T00:00:00Z", _S1)])

    ledger.delete_scans(["2026-05-03T00:00:00Z"], db_path=full)

    assert _ledger_rows(full) == _ledger_rows(only1)


def test_delete_all_scans_empties_everything(tmp_path):
    db = tmp_path / "ledger.db"
    _build(db, [("2026-05-01T00:00:00Z", _S1), ("2026-05-03T00:00:00Z", _S3)])

    summary = ledger.delete_scans(
        ["2026-05-01T00:00:00Z", "2026-05-03T00:00:00Z"], db_path=db
    )

    assert summary == {"deleted": 2, "scans": 0, "tracked": 0}
    assert ledger.load_scans_df(db).empty
    assert ledger.load_base_df(db).empty
    assert ledger.load_open_and_resolved(db) == []
    conn = sqlite3.connect(str(db))
    try:
        assert conn.execute("SELECT COUNT(*) FROM observations").fetchone()[0] == 0
    finally:
        conn.close()


def test_delete_unknown_scan_id_is_noop(tmp_path):
    db = tmp_path / "ledger.db"
    _build(db, [("2026-05-01T00:00:00Z", _S1)])
    before = _ledger_rows(db)
    summary = ledger.delete_scans(["nope"], db_path=db)
    assert summary == {"deleted": 0, "scans": 0, "tracked": 0}
    assert _ledger_rows(db) == before


def test_delete_scan_unresolves_disappearance(tmp_path):
    # s1 has an open vuln; s2 omits it -> resolved by disappearance. Deleting s2 must
    # reopen it (the resolution only existed because s2 showed its absence).
    db = tmp_path / "ledger.db"
    rec = {"id": "x1", "name": "CVE-2026-1", "severity": "HIGH",
           "vulnerableAsset.name": "vm-1", "firstDetectedAt": "2026-05-01T00:00:00Z"}
    ledger.persist_flat_scan([rec], mode="dry-run", db_path=db, scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan([], mode="dry-run", db_path=db, scan_id="2026-05-04T00:00:00Z")
    assert ledger.load_base_df(db).set_index("vuln_key").loc["id:x1", "status"] == "RESOLVED"

    ledger.delete_scans(["2026-05-04T00:00:00Z"], db_path=db)

    base = ledger.load_base_df(db).set_index("vuln_key")
    assert base.loc["id:x1", "status"] == "OPEN"
    assert base.loc["id:x1", "resolution_src"] is None


def test_delete_grouped_scan_leaves_flat_lifecycle(tmp_path):
    full = tmp_path / "full" / "ledger.db"
    direct = tmp_path / "direct" / "ledger.db"
    grouped = [{"id": "g1", "vulnerableAsset": {"name": "vm-9", "type": "VIRTUAL_MACHINE"},
                "analytics": {"criticalSeverityFindingCount": 5, "totalFindingCount": 5}}]

    ledger.persist_flat_scan(_S1, mode="dry-run", db_path=full, scan_id="2026-05-01T00:00:00Z")
    ledger.persist_grouped_scan(grouped, mode="dry-run", raw=grouped, db_path=full,
                                scan_id="2026-05-02T00:00:00Z")
    ledger.persist_flat_scan(_S3, mode="dry-run", db_path=full, scan_id="2026-05-03T00:00:00Z")
    _build(direct, [("2026-05-01T00:00:00Z", _S1), ("2026-05-03T00:00:00Z", _S3)])

    summary = ledger.delete_scans(["2026-05-02T00:00:00Z"], db_path=full)

    assert summary["deleted"] == 1
    scan_ids = set(ledger.load_scans_df(full)["scan_id"])
    assert "2026-05-02T00:00:00Z" not in scan_ids
    assert _ledger_rows(full) == _ledger_rows(direct)


def test_delete_removes_target_archive_keeps_survivors(tmp_path):
    db = tmp_path / "ledger.db"
    ledger.persist_flat_scan(_S1, mode="dry-run", raw={"data": {"vulnerabilityFindings":
                             {"nodes": _S1}}}, db_path=db, scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan(_S3, mode="dry-run", raw={"data": {"vulnerabilityFindings":
                             {"nodes": _S3}}}, db_path=db, scan_id="2026-05-03T00:00:00Z")
    scans = ledger.load_scans_df(db).set_index("scan_id")
    s1_raw = scans.loc["2026-05-01T00:00:00Z", "raw_path"]
    s3_raw = scans.loc["2026-05-03T00:00:00Z", "raw_path"]
    assert s1_raw and s3_raw

    ledger.delete_scans(["2026-05-03T00:00:00Z"], db_path=db)

    from pathlib import Path as _P
    assert not _P(s3_raw).exists()   # deleted scan's archive removed
    assert _P(s1_raw).exists()       # survivor's archive retained


def test_missing_survivor_archive_refuses_and_leaves_db_unchanged(tmp_path):
    # If a SURVIVING flat scan's archive is gone, the delete must refuse before mutating.
    db = tmp_path / "ledger.db"
    ledger.persist_flat_scan(_S1, mode="dry-run", db_path=db, scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan(_S2, mode="dry-run", db_path=db, scan_id="2026-05-02T00:00:00Z")
    ledger.persist_flat_scan(_S3, mode="dry-run", db_path=db, scan_id="2026-05-03T00:00:00Z")

    # Remove a survivor's (s2's) archive, then try to delete s3.
    scans = ledger.load_scans_df(db).set_index("scan_id")
    from pathlib import Path as _P
    _P(scans.loc["2026-05-02T00:00:00Z", "raw_path"]).unlink()
    before = _ledger_rows(db)

    import pytest
    with pytest.raises(ledger.LedgerRebuildError):
        ledger.delete_scans(["2026-05-03T00:00:00Z"], db_path=db)

    # Nothing changed: all three scans + the ledger are intact, no .bak left behind.
    assert len(ledger.load_scans_df(db)) == 3
    assert _ledger_rows(db) == before
    assert not _P(str(db) + ".bak").exists()


def test_rebuild_failure_restores_from_snapshot(tmp_path, monkeypatch):
    db = tmp_path / "ledger.db"
    _build(db, [("2026-05-01T00:00:00Z", _S1), ("2026-05-03T00:00:00Z", _S3)])
    before = _ledger_rows(db)

    # Force the replay to blow up after the wipe; the snapshot must restore the DB.
    def _boom(*a, **k):
        raise RuntimeError("replay exploded")
    monkeypatch.setattr(ledger, "persist_flat_scan", _boom)

    import pytest
    with pytest.raises(RuntimeError):
        ledger.delete_scans(["2026-05-03T00:00:00Z"], db_path=db)

    assert _ledger_rows(db) == before                 # fully restored
    from pathlib import Path as _P
    assert not _P(str(db) + ".bak").exists()           # snapshot cleaned up


def test_delete_grouped_survivor_missing_archive_keeps_total(tmp_path):
    # A grouped survivor whose archive is gone must keep its stored findings count
    # (not silently reset to 0) — grouped scans don't affect the ledger.
    db = tmp_path / "ledger.db"
    grouped = [{"id": "g1", "vulnerableAsset": {"name": "vm-9", "type": "VIRTUAL_MACHINE"},
                "analytics": {"criticalSeverityFindingCount": 5, "totalFindingCount": 5}}]
    ledger.persist_grouped_scan(grouped, mode="dry-run", raw=grouped, db_path=db,
                                scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan(_S1, mode="dry-run", db_path=db, scan_id="2026-05-02T00:00:00Z")
    gpath = ledger.load_scans_df(db).set_index("scan_id").loc["2026-05-01T00:00:00Z", "raw_path"]
    from pathlib import Path as _P
    _P(gpath).unlink()  # lose the grouped survivor's archive

    ledger.delete_scans(["2026-05-02T00:00:00Z"], db_path=db)  # delete the flat scan

    scans = ledger.load_scans_df(db).set_index("scan_id")
    assert "2026-05-01T00:00:00Z" in scans.index
    assert int(scans.loc["2026-05-01T00:00:00Z", "total"]) == 1  # preserved, not 0
    assert scans.loc["2026-05-01T00:00:00Z", "shape"] == "grouped"


def test_corrupt_survivor_archive_refuses(tmp_path):
    # A surviving flat scan whose archive is unreadable JSON must refuse the delete
    # before mutating (same guarantee as a missing archive).
    db = tmp_path / "ledger.db"
    ledger.persist_flat_scan(_S1, mode="dry-run", db_path=db, scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan(_S2, mode="dry-run", db_path=db, scan_id="2026-05-02T00:00:00Z")
    ledger.persist_flat_scan(_S3, mode="dry-run", db_path=db, scan_id="2026-05-03T00:00:00Z")
    bpath = ledger.load_scans_df(db).set_index("scan_id").loc["2026-05-02T00:00:00Z", "raw_path"]
    from pathlib import Path as _P
    _P(bpath).write_text("}{ not json", encoding="utf-8")  # corrupt a survivor's archive
    before = _ledger_rows(db)

    import pytest
    with pytest.raises(ledger.LedgerRebuildError):
        ledger.delete_scans(["2026-05-03T00:00:00Z"], db_path=db)

    assert len(ledger.load_scans_df(db)) == 3
    assert _ledger_rows(db) == before
    assert not _P(str(db) + ".bak").exists()


def test_persist_from_raw_nodes_matches_records_path(tmp_path, app):
    # A live scan now feeds reconcile the raw nested nodes; the flattened-records shape
    # (the old path, still what replayed pre-change archives used) must yield the
    # identical base and deltas — vuln_key/field read both shapes.
    nodes = app.extract_nodes(os_vulns.SAMPLE_RESULTS)
    db_nodes, db_records = tmp_path / "nodes.db", tmp_path / "records.db"
    d_nodes = ledger.persist_flat_scan(
        nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
        db_path=db_nodes, scan_id="2026-05-29T10:00:00Z",
    )
    d_records = ledger.persist_flat_scan(
        _flat_records(app), mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
        db_path=db_records, scan_id="2026-05-29T10:00:00Z",
    )
    assert d_nodes == d_records
    cols = ["vuln_key", "severity", "status", "first_seen", "resolved_at", "reopened_count"]
    base_nodes = ledger.load_base_df(db_nodes)[cols].sort_values("vuln_key").reset_index(drop=True)
    base_records = ledger.load_base_df(db_records)[cols].sort_values("vuln_key").reset_index(drop=True)
    assert base_nodes.equals(base_records)


def test_delete_rebuild_replays_raw_nodes_faithfully(tmp_path, app):
    # Two scans persisted from raw nodes; deleting the middle one replays the survivor
    # from its archived payload via extract_nodes — the rebuilt base must equal a fresh
    # single-scan persist of that survivor.
    nodes = app.extract_nodes(os_vulns.SAMPLE_RESULTS)
    db = _db(tmp_path)
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-29T10:00:00Z")
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-30T10:00:00Z")
    ledger.delete_scans(["2026-05-29T10:00:00Z"], db_path=db)

    fresh = _db(tmp_path.joinpath("fresh"))
    fresh.parent.mkdir(exist_ok=True)
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=fresh, scan_id="2026-05-30T10:00:00Z")
    cols = ["vuln_key", "severity", "status", "first_seen", "resolved_at"]
    rebuilt = ledger.load_base_df(db)[cols].sort_values("vuln_key").reset_index(drop=True)
    expected = ledger.load_base_df(fresh)[cols].sort_values("vuln_key").reset_index(drop=True)
    assert rebuilt.equals(expected)


def test_persist_with_df_writes_snapshot_and_delete_removes_it(tmp_path, app):
    from wiz_dashboard.data import snapshot

    nodes = app.extract_nodes(os_vulns.SAMPLE_RESULTS)
    df = app.nodes_to_dataframe(nodes)
    db = _db(tmp_path)
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-29T10:00:00Z", df=df)
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-30T10:00:00Z", df=df)
    scans = ledger.load_scans_df(db).set_index("scan_id")
    snap_old = snapshot.snapshot_path_for(scans.loc["2026-05-29T10:00:00Z", "raw_path"])
    snap_new = snapshot.snapshot_path_for(scans.loc["2026-05-30T10:00:00Z", "raw_path"])
    assert snap_old.exists() and snap_new.exists()
    # The snapshot restores the very frame that was persisted.
    restored = snapshot.read_snapshot(scans.loc["2026-05-30T10:00:00Z", "raw_path"])
    assert restored.equals(df)

    ledger.delete_scans(["2026-05-29T10:00:00Z"], db_path=db)
    assert not snap_old.exists()   # deleted scan's snapshot removed…
    assert snap_new.exists()       # …survivor keeps its own


def test_rebuild_works_with_snapshots_absent(tmp_path, app):
    # Snapshots are a start-up cache, never a correctness dependency: a delete->rebuild
    # over archives that never had snapshots must succeed unchanged.
    nodes = app.extract_nodes(os_vulns.SAMPLE_RESULTS)
    db = _db(tmp_path)
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-29T10:00:00Z")
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-30T10:00:00Z")
    summary = ledger.delete_scans(["2026-05-29T10:00:00Z"], db_path=db)
    assert summary["scans"] == 1
    assert len(ledger.load_base_df(db)) == 17


def test_load_latest_scan_row_metadata_only(tmp_path, app):
    db = _db(tmp_path)
    assert ledger.load_latest_scan_row(db) is None
    nodes = app.extract_nodes(os_vulns.SAMPLE_RESULTS)
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-29T10:00:00Z")
    row = ledger.load_latest_scan_row(db)
    assert row["scan_id"] == "2026-05-29T10:00:00Z"
    assert row["shape"] == "flat"
    assert int(row["total"]) == 17
    assert row["raw_path"]
