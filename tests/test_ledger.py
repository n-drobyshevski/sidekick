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


def test_backfill_rule_inputs_fills_null_rows_from_snapshot(tmp_path, app):
    db = _db(tmp_path)
    records = [
        {"id": "b1", "name": "CVE-2026-1", "severity": "HIGH",
         "vulnerableAsset.name": "vm-1",
         "vulnerableAsset.subscriptionName": "core-prod",
         "vulnerableAsset.tags.env": "prod"},
        {"id": "b2", "name": "CVE-2026-2", "severity": "LOW",
         "vulnerableAsset.name": "vm-2"},
    ]
    ledger.persist_flat_scan(
        records, mode="dry-run",
        raw={"data": {"vulnerabilityFindings": {"nodes": [
            {"id": "b1", "name": "CVE-2026-1", "severity": "HIGH",
             "vulnerableAsset": {"name": "vm-1", "subscriptionName": "core-prod",
                                 "tags": {"env": "prod"}}},
            {"id": "b2", "name": "CVE-2026-2", "severity": "LOW",
             "vulnerableAsset": {"name": "vm-2"}},
        ]}}},
        db_path=db, scan_id="2026-05-29T10:00:00Z",
    )
    # simulate pre-v5 rows: null out the persisted inputs
    conn = sqlite3.connect(db)
    try:
        conn.execute("UPDATE vuln_ledger SET subscription_name=NULL, "
                     "subscription_ext_id=NULL, tags_json=NULL")
        conn.commit()
    finally:
        conn.close()

    counts = ledger.backfill_rule_inputs(db)
    assert counts["updated"] == 1  # only b1 has inputs to restore
    base = ledger.load_base_df(db)
    b1 = base[base["vuln_key"] == "id:b1"].iloc[0]
    assert b1["subscription_name"] == "core-prod"
    assert b1["tags_json"] == '{"env": "prod"}'


def test_backfill_rule_inputs_never_raises_without_data(tmp_path):
    assert ledger.backfill_rule_inputs(tmp_path / "nope.db") == {"updated": 0}
    db = _db(tmp_path)
    ledger.init_db(db)
    assert ledger.backfill_rule_inputs(db) == {"updated": 0}


def test_needs_startup_maintenance_false_without_db(tmp_path):
    assert ledger.needs_startup_maintenance(tmp_path / "nope.db") is False


def test_needs_startup_maintenance_true_for_legacy_plain_archive(tmp_path, app):
    db = _db(tmp_path)
    ledger.persist_flat_scan(
        _flat_records(app), mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
        db_path=db, scan_id="2026-05-29T10:00:00Z",
    )
    conn = sqlite3.connect(db)
    try:
        conn.execute(
            "UPDATE vuln_ledger SET subscription_name='known', "
            "subscription_ext_id='known', tags_json='{}'"
        )
        conn.commit()
    finally:
        conn.close()
    assert ledger.needs_startup_maintenance(db) is False
    _make_legacy_plain(db, "2026-05-29T10:00:00Z")
    assert ledger.needs_startup_maintenance(db) is True


def test_needs_startup_maintenance_true_for_pending_domain_backfill(tmp_path, app):
    db = _db(tmp_path)
    ledger.persist_flat_scan(
        _flat_records(app), mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
        db_path=db, scan_id="2026-05-29T10:00:00Z",
    )
    conn = sqlite3.connect(db)
    try:
        conn.execute(
            "UPDATE vuln_ledger SET subscription_name=NULL, "
            "subscription_ext_id=NULL, tags_json=NULL"
        )
        conn.commit()
    finally:
        conn.close()
    assert ledger.needs_startup_maintenance(db) is True


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


# --------------------------------------------------------------------------- #
#  Gzipped archives + schema v2 (latest_json dropped)
# --------------------------------------------------------------------------- #
def _make_legacy_plain(db, scan_id):
    """Rewrite a scan's gzipped archive as pre-compression plain JSON and repoint its
    ``scans.raw_path`` — the exact on-disk state of a data dir written before the
    gzip change (upgrade fixture)."""
    import gzip
    from pathlib import Path

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT raw_path FROM scans WHERE scan_id=?", (scan_id,)
        ).fetchone()
        gz = Path(row["raw_path"])
        plain = gz.with_name(gz.name.removesuffix(".gz"))
        with gzip.open(gz, "rt", encoding="utf-8") as fh:
            plain.write_text(fh.read(), encoding="utf-8")
        gz.unlink()
        conn.execute("UPDATE scans SET raw_path=? WHERE scan_id=?", (str(plain), scan_id))
        conn.commit()
    finally:
        conn.close()
    return plain


def test_archive_is_gzip_and_roundtrips(tmp_path, app):
    db = _db(tmp_path)
    ledger.persist_flat_scan(_flat_records(app), mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-29T10:00:00Z")
    raw_path = ledger.load_scans_df(db)["raw_path"].iloc[0]
    assert raw_path.endswith(".json.gz")
    with open(raw_path, "rb") as fh:
        assert fh.read(2) == b"\x1f\x8b"
    payload, _row = ledger.load_latest_scan_payload(db)
    assert payload == os_vulns.SAMPLE_RESULTS


def test_legacy_plain_json_archive_still_readable(tmp_path, app):
    # A pre-gzip data dir (plain .json archives) keeps working with zero migration:
    # the reader sniffs content, not extension.
    db = _db(tmp_path)
    ledger.persist_flat_scan(_flat_records(app), mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-29T10:00:00Z")
    plain = _make_legacy_plain(db, "2026-05-29T10:00:00Z")
    assert plain.suffix == ".json"
    payload, row = ledger.load_latest_scan_payload(db)
    assert payload == os_vulns.SAMPLE_RESULTS
    assert row["raw_path"] == str(plain)


def test_replay_migrates_legacy_survivor_archive(tmp_path, app):
    # Delete/rebuild replays survivors through the current writer, so a legacy plain
    # survivor comes out re-archived as .json.gz with the superseded .json removed.
    from pathlib import Path

    nodes = app.extract_nodes(os_vulns.SAMPLE_RESULTS)
    db = _db(tmp_path)
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-29T10:00:00Z")
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-30T10:00:00Z")
    plain = _make_legacy_plain(db, "2026-05-29T10:00:00Z")

    ledger.delete_scans(["2026-05-30T10:00:00Z"], db_path=db)

    survivor = ledger.load_scans_df(db).set_index("scan_id").loc["2026-05-29T10:00:00Z"]
    assert survivor["raw_path"].endswith(".json.gz")
    assert Path(survivor["raw_path"]).exists()
    assert not plain.exists()  # superseded plain archive cleaned up
    assert len(ledger.load_base_df(db)) == 17


def test_schema_v1_migrates_to_v2(tmp_path, app):
    # Hand-build a v1 DB (latest_json column + data, schema_meta version=1) and assert
    # init_db upgrades it in place without losing rows.
    db = _db(tmp_path)
    conn = sqlite3.connect(db)
    try:
        conn.executescript(
            """
            CREATE TABLE scans (scan_id TEXT PRIMARY KEY, ts TEXT NOT NULL,
                mode TEXT NOT NULL, shape TEXT NOT NULL, total INTEGER NOT NULL,
                new_count INTEGER DEFAULT 0, resolved_count INTEGER DEFAULT 0,
                reopened_count INTEGER DEFAULT 0, raw_path TEXT);
            CREATE TABLE vuln_ledger (vuln_key TEXT PRIMARY KEY, cve TEXT, severity TEXT,
                asset_id TEXT, asset_name TEXT, asset_type TEXT, cloud TEXT,
                first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, status TEXT NOT NULL,
                resolved_at TEXT, resolution_src TEXT, reopened_count INTEGER DEFAULT 0,
                first_scan_id TEXT, last_scan_id TEXT, latest_json TEXT);
            CREATE INDEX idx_ledger_status ON vuln_ledger(status);
            CREATE INDEX idx_ledger_severity ON vuln_ledger(severity);
            CREATE TABLE observations (scan_id TEXT NOT NULL, vuln_key TEXT NOT NULL,
                present INTEGER NOT NULL, severity TEXT, status TEXT,
                PRIMARY KEY (scan_id, vuln_key));
            CREATE TABLE schema_meta (version INTEGER NOT NULL);
            INSERT INTO schema_meta (version) VALUES (1);
            INSERT INTO scans VALUES ('2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z',
                'dry-run', 'flat', 1, 1, 0, 0, NULL);
            INSERT INTO vuln_ledger VALUES ('id:x1', 'CVE-2026-1', 'HIGH', NULL, 'vm-1',
                NULL, NULL, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', 'OPEN',
                NULL, NULL, 0, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z',
                '{"id": "x1"}');
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
        cols = {r[1] for r in conn.execute("PRAGMA table_info(vuln_ledger)")}
        assert "latest_json" not in cols
        scan_cols = {r[1] for r in conn.execute("PRAGMA table_info(scans)")}
        assert "severities" in scan_cols  # v3 lands in the same migration pass
    finally:
        conn.close()
    base = ledger.load_base_df(db)
    assert len(base) == 1
    assert base["vuln_key"].iloc[0] == "id:x1"
    # The migrated DB is fully writable: a follow-up scan reconciles normally.
    ledger.persist_flat_scan(
        [{"id": "x1", "name": "CVE-2026-1", "severity": "HIGH",
          "vulnerableAsset.name": "vm-1"}],
        mode="dry-run", db_path=db, scan_id="2026-05-02T00:00:00Z",
    )
    assert len(ledger.load_scans_df(db)) == 2


def test_compact_archives_gzips_legacy_in_place(tmp_path, app):
    from pathlib import Path

    nodes = app.extract_nodes(os_vulns.SAMPLE_RESULTS)
    db = _db(tmp_path)
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-29T10:00:00Z")
    ledger.persist_flat_scan(nodes, mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-30T10:00:00Z")
    plain = _make_legacy_plain(db, "2026-05-29T10:00:00Z")

    counts = ledger.compact_archives(db)
    assert counts == {"compressed": 1, "skipped": 1, "failed": 0}
    scans = ledger.load_scans_df(db).set_index("scan_id")
    migrated = scans.loc["2026-05-29T10:00:00Z", "raw_path"]
    assert migrated.endswith(".json.gz")
    assert Path(migrated).exists()
    assert not plain.exists()
    payload, _row = ledger.load_latest_scan_payload(db)
    assert payload == os_vulns.SAMPLE_RESULTS
    # Second run is a no-op.
    assert ledger.compact_archives(db) == {"compressed": 0, "skipped": 2, "failed": 0}


def test_compact_archives_never_raises_on_corrupt_db(tmp_path):
    # Start-up maintenance must not take the app down: a truncated/schemaless
    # ledger.db yields zero counts, not an exception.
    db = _db(tmp_path)
    db.write_bytes(b"not a sqlite database")
    assert ledger.compact_archives(db) == {"compressed": 0, "skipped": 0, "failed": 0}


def test_compact_archives_migrates_v1_schema(tmp_path):
    # compact_archives is the migration hook for read-only deployments (persist is the
    # only other init_db caller): a v1 DB gets its latest_json dropped at app start
    # even if no new scan is ever run.
    db = _db(tmp_path)
    conn = sqlite3.connect(db)
    try:
        conn.executescript(
            """
            CREATE TABLE scans (scan_id TEXT PRIMARY KEY, ts TEXT NOT NULL,
                mode TEXT NOT NULL, shape TEXT NOT NULL, total INTEGER NOT NULL,
                new_count INTEGER DEFAULT 0, resolved_count INTEGER DEFAULT 0,
                reopened_count INTEGER DEFAULT 0, raw_path TEXT);
            CREATE TABLE vuln_ledger (vuln_key TEXT PRIMARY KEY, cve TEXT, severity TEXT,
                asset_id TEXT, asset_name TEXT, asset_type TEXT, cloud TEXT,
                first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, status TEXT NOT NULL,
                resolved_at TEXT, resolution_src TEXT, reopened_count INTEGER DEFAULT 0,
                first_scan_id TEXT, last_scan_id TEXT, latest_json TEXT);
            CREATE TABLE observations (scan_id TEXT NOT NULL, vuln_key TEXT NOT NULL,
                present INTEGER NOT NULL, severity TEXT, status TEXT,
                PRIMARY KEY (scan_id, vuln_key));
            CREATE TABLE schema_meta (version INTEGER NOT NULL);
            INSERT INTO schema_meta (version) VALUES (1);
            INSERT INTO vuln_ledger VALUES ('id:x1', 'CVE-2026-1', 'HIGH', NULL, 'vm-1',
                NULL, NULL, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', 'OPEN',
                NULL, NULL, 0, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', '{}');
            """
        )
        conn.commit()
    finally:
        conn.close()

    # load_base_df must exclude the v1 blob column even BEFORE migration (Scan History
    # renders — and CSV-exports — this frame).
    assert "latest_json" not in ledger.load_base_df(db).columns

    ledger.compact_archives(db)
    conn = sqlite3.connect(db)
    try:
        assert (conn.execute("SELECT version FROM schema_meta").fetchone()[0]
                == ledger.SCHEMA_VERSION)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(vuln_ledger)")}
        assert "latest_json" not in cols
    finally:
        conn.close()


def test_read_raw_payload_falls_back_to_gz_sibling(tmp_path, app):
    # A stored plain raw_path whose file was compacted to .gz (stale session state, or
    # a DB restored from .bak after a compaction) resolves to the sibling archive.
    db = _db(tmp_path)
    ledger.persist_flat_scan(_flat_records(app), mode="dry-run", raw=os_vulns.SAMPLE_RESULTS,
                             db_path=db, scan_id="2026-05-29T10:00:00Z")
    gz_path = ledger.load_scans_df(db)["raw_path"].iloc[0]
    stale_plain = gz_path.removesuffix(".gz")
    conn = sqlite3.connect(db)
    try:
        conn.execute("UPDATE scans SET raw_path=?", (stale_plain,))
        conn.commit()
    finally:
        conn.close()
    payload, _row = ledger.load_latest_scan_payload(db)
    assert payload == os_vulns.SAMPLE_RESULTS


def _mk(fid, sev="HIGH", status="OPEN", resolved_at=None):
    node = {
        "id": fid, "name": f"CVE-2026-{fid}", "severity": sev, "status": status,
        "vulnerableAsset": {"name": "vm-1", "type": "VIRTUAL_MACHINE"},
        "firstDetectedAt": "2026-05-01T00:00:00Z",
    }
    if resolved_at:
        node["resolvedAt"] = resolved_at
    return node


def test_merged_incremental_never_false_resolves_and_replays(tmp_path):
    from wiz_dashboard.data.transform import merge_nodes

    db = _db(tmp_path)
    # Full baseline scan A: v1 and v2 open.
    baseline = [_mk("v1"), _mk("v2")]
    ledger.persist_flat_scan(baseline, mode="live", raw={"data": {"vulnerabilityFindings": {"nodes": baseline}}},
                             db_path=db, scan_id="2026-07-01T10:00:00Z")
    # Incremental scan B: delta = v2 resolved (API-declared) + v3 new; merged over A.
    delta = [_mk("v2", status="RESOLVED", resolved_at="2026-07-02T09:00:00Z"), _mk("v3")]
    merged = merge_nodes(baseline, delta)
    deltas = ledger.persist_flat_scan(
        merged, mode="incremental",
        raw={"data": {"vulnerabilityFindings": {"nodes": merged}}},
        db_path=db, scan_id="2026-07-02T10:00:00Z",
    )
    assert deltas == {"new_count": 1, "resolved_count": 1, "reopened_count": 0}

    base = ledger.load_base_df(db).set_index("vuln_key")
    # v1 was untouched by the delta but re-listed by the merge: it must stay OPEN —
    # the disappearance branch is structurally inert on a merged persist.
    assert base.loc["id:v1", "status"] == "OPEN"
    assert base.loc["id:v2", "status"] == "RESOLVED"
    assert base.loc["id:v2", "resolution_src"] == "api"
    assert base.loc["id:v3", "status"] == "OPEN"
    # Change-badge baseline reads scan A's observation set (full set was written).
    prev_counts = ledger.previous_severity_counts(db)
    assert prev_counts == {"HIGH": 2}

    # The merged archive is a full faithful payload: deleting the incremental scan
    # replays A alone and lands exactly on A's state.
    ledger.delete_scans(["2026-07-02T10:00:00Z"], db_path=db)
    base = ledger.load_base_df(db).set_index("vuln_key")
    assert set(base.index) == {"id:v1", "id:v2"}
    assert (base["status"] == "OPEN").all()


# --------------------------------------------------------------------------- #
#  Severity scope (schema v3: scans.severities)
# --------------------------------------------------------------------------- #
def test_serialize_parse_severities_roundtrip():
    assert ledger.serialize_severities(None) is None
    assert ledger.parse_severities(None) is None
    assert ledger.parse_severities("not json") is None
    text = ledger.serialize_severities(("HIGH", "CRITICAL"))
    assert ledger.parse_severities(text) == ("CRITICAL", "HIGH")  # canonical order
    # Full selectable scope IS an unscoped scan — collapses to NULL.
    from wiz_dashboard import config
    assert ledger.serialize_severities(config.SELECTABLE_SEVERITIES) is None


def test_persist_records_severity_scope_column(tmp_path):
    db = _db(tmp_path)
    ledger.persist_flat_scan([_mk("v1")], mode="dry-run", db_path=db,
                             scan_id="2026-05-01T00:00:00Z",
                             scanned_severities=("CRITICAL", "HIGH"))
    ledger.persist_flat_scan([_mk("v2")], mode="dry-run", db_path=db,
                             scan_id="2026-05-02T00:00:00Z")
    scans = ledger.load_scans_df(db).set_index("scan_id")
    assert ledger.parse_severities(scans.loc["2026-05-01T00:00:00Z", "severities"]) == \
        ("CRITICAL", "HIGH")
    assert scans.loc["2026-05-02T00:00:00Z", "severities"] is None  # unscoped -> NULL


def test_scoped_scan_never_false_resolves_unscanned_severity(tmp_path):
    # Wide scan (HIGH + MEDIUM open), then a Critical+High-scoped scan that naturally
    # omits the MEDIUM: it must stay OPEN, while a genuinely-disappeared HIGH resolves.
    db = _db(tmp_path)
    wide = [_mk("h1", sev="HIGH"), _mk("m1", sev="MEDIUM")]
    ledger.persist_flat_scan(wide, mode="dry-run", db_path=db,
                             scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan([], mode="dry-run", db_path=db,
                             scan_id="2026-05-02T00:00:00Z",
                             scanned_severities=("CRITICAL", "HIGH"))
    base = ledger.load_base_df(db).set_index("vuln_key")
    assert base.loc["id:m1", "status"] == "OPEN"          # unscanned -> untouched
    assert base.loc["id:h1", "status"] == "RESOLVED"       # in-scope -> disappeared
    assert base.loc["id:h1", "resolution_src"] == "disappeared"


def test_widen_after_scoped_scans_resolves_vanished_medium(tmp_path):
    # [wide, scoped, scoped, wide]: a MEDIUM present only in scan 1 must resolve on
    # scan 4 (the first scan that could observe its absence), not leak OPEN forever.
    db = _db(tmp_path)
    ch = ("CRITICAL", "HIGH")
    ledger.persist_flat_scan([_mk("h1", sev="HIGH"), _mk("m1", sev="MEDIUM")],
                             mode="dry-run", db_path=db, scan_id="2026-05-01T00:00:00Z")
    ledger.persist_flat_scan([_mk("h1", sev="HIGH")], mode="dry-run", db_path=db,
                             scan_id="2026-05-02T00:00:00Z", scanned_severities=ch)
    ledger.persist_flat_scan([_mk("h1", sev="HIGH")], mode="dry-run", db_path=db,
                             scan_id="2026-05-03T00:00:00Z", scanned_severities=ch)
    assert ledger.load_base_df(db).set_index("vuln_key").loc["id:m1", "status"] == "OPEN"

    ledger.persist_flat_scan([_mk("h1", sev="HIGH")], mode="dry-run", db_path=db,
                             scan_id="2026-05-04T00:00:00Z")  # wide again
    base = ledger.load_base_df(db).set_index("vuln_key")
    assert base.loc["id:m1", "status"] == "RESOLVED"
    assert base.loc["id:m1", "resolution_src"] == "disappeared"
    assert base.loc["id:h1", "status"] == "OPEN"  # survivor untouched


def test_delete_rebuild_replays_severity_scope_faithfully(tmp_path):
    # Wide scan A, scoped scan B (MEDIUM legitimately absent), plus an unrelated scan C.
    # Deleting C replays A and B; the rebuild must NOT mass-resolve the MEDIUM (the
    # false-resolution regression a scope-blind replay would produce).
    db = _db(tmp_path)
    wide = [_mk("h1", sev="HIGH"), _mk("m1", sev="MEDIUM")]
    ledger.persist_flat_scan(wide, mode="dry-run",
                             raw={"data": {"vulnerabilityFindings": {"nodes": wide}}},
                             db_path=db, scan_id="2026-05-01T00:00:00Z")
    scoped = [_mk("h1", sev="HIGH")]
    ledger.persist_flat_scan(scoped, mode="dry-run",
                             raw={"data": {"vulnerabilityFindings": {"nodes": scoped}}},
                             db_path=db, scan_id="2026-05-02T00:00:00Z",
                             scanned_severities=("CRITICAL", "HIGH"))
    third = [_mk("h1", sev="HIGH")]
    ledger.persist_flat_scan(third, mode="dry-run",
                             raw={"data": {"vulnerabilityFindings": {"nodes": third}}},
                             db_path=db, scan_id="2026-05-03T00:00:00Z",
                             scanned_severities=("CRITICAL", "HIGH"))

    ledger.delete_scans(["2026-05-03T00:00:00Z"], db_path=db)

    base = ledger.load_base_df(db).set_index("vuln_key")
    assert base.loc["id:m1", "status"] == "OPEN"  # scope survived the replay
    disappeared = base[base["resolution_src"] == "disappeared"]
    assert disappeared.empty
    # The surviving scoped scan still carries its stored scope.
    scans = ledger.load_scans_df(db).set_index("scan_id")
    assert ledger.parse_severities(scans.loc["2026-05-02T00:00:00Z", "severities"]) == \
        ("CRITICAL", "HIGH")


def test_schema_v2_migrates_to_v3(tmp_path):
    # Hand-build a v2 DB (no scans.severities, version=2); init_db must add the column,
    # bump the version, and read historical rows as unscoped (NULL).
    db = _db(tmp_path)
    conn = sqlite3.connect(db)
    try:
        conn.executescript(
            """
            CREATE TABLE scans (scan_id TEXT PRIMARY KEY, ts TEXT NOT NULL,
                mode TEXT NOT NULL, shape TEXT NOT NULL, total INTEGER NOT NULL,
                new_count INTEGER DEFAULT 0, resolved_count INTEGER DEFAULT 0,
                reopened_count INTEGER DEFAULT 0, raw_path TEXT);
            CREATE TABLE vuln_ledger (vuln_key TEXT PRIMARY KEY, cve TEXT, severity TEXT,
                asset_id TEXT, asset_name TEXT, asset_type TEXT, cloud TEXT,
                first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, status TEXT NOT NULL,
                resolved_at TEXT, resolution_src TEXT, reopened_count INTEGER DEFAULT 0,
                first_scan_id TEXT, last_scan_id TEXT);
            CREATE TABLE observations (scan_id TEXT NOT NULL, vuln_key TEXT NOT NULL,
                present INTEGER NOT NULL, severity TEXT, status TEXT,
                PRIMARY KEY (scan_id, vuln_key));
            CREATE TABLE schema_meta (version INTEGER NOT NULL);
            INSERT INTO schema_meta (version) VALUES (2);
            INSERT INTO scans VALUES ('2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z',
                'dry-run', 'flat', 1, 1, 0, 0, NULL);
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
        assert "severities" in cols
        assert conn.execute(
            "SELECT severities FROM scans WHERE scan_id='2026-05-01T00:00:00Z'"
        ).fetchone()[0] is None
    finally:
        conn.close()
    # The migrated DB accepts a scoped follow-up scan.
    ledger.persist_flat_scan([_mk("v1")], mode="dry-run", db_path=db,
                             scan_id="2026-05-02T00:00:00Z",
                             scanned_severities=("CRITICAL", "HIGH"))
    assert len(ledger.load_scans_df(db)) == 2


def test_load_latest_flat_scan_row_skips_grouped(tmp_path):
    db = _db(tmp_path)
    assert ledger.load_latest_flat_scan_row(db) is None
    ledger.persist_flat_scan([_mk("v1")], mode="live",
                             raw={"data": {"vulnerabilityFindings": {"nodes": [_mk("v1")]}}},
                             db_path=db, scan_id="2026-07-01T10:00:00Z")
    # A newer grouped scan must not be offered as a merge baseline.
    grouped = [{"id": "g1", "vulnerableAsset": {"name": "vm-1"},
                "analytics": {"criticalSeverityFindingCount": 1, "totalFindingCount": 1}}]
    ledger.persist_grouped_scan(grouped, mode="live", db_path=db,
                                scan_id="2026-07-02T10:00:00Z")
    row = ledger.load_latest_scan_row(db)
    assert row["shape"] == "grouped"          # newest overall is grouped…
    flat_row = ledger.load_latest_flat_scan_row(db)
    assert flat_row["scan_id"] == "2026-07-01T10:00:00Z"  # …but the baseline is the flat one
