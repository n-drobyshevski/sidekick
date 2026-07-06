"""Tests for the migration-bundle exporter (wiz_dashboard.data.migrate)."""

import json

from wiz_dashboard.data import history, ledger, migrate


def _db(tmp_path):
    return tmp_path / "ledger.db"


def _node(fid, cve, sev, status, asset, first=None, resolved=None):
    n = {
        "id": fid, "name": cve, "severity": sev, "status": status,
        "vulnerableAsset": {"id": asset, "name": f"{asset}-name",
                            "type": "VIRTUAL_MACHINE", "cloudPlatform": "AWS"},
    }
    if first:
        n["firstDetectedAt"] = first
    if resolved:
        n["resolvedAt"] = resolved
    return n


S1, S2, S3, S4 = ("2026-01-01T06:00:00Z", "2026-01-08T06:00:00Z",
                  "2026-06-01T06:00:00Z", "2026-06-15T06:00:00Z")
NOW = "2026-07-01T00:00:00Z"


def _seed(db):
    scans = {
        S1: [_node("A", "CVE-A", "CRITICAL", "OPEN", "vm-a", first="2025-12-20T00:00:00Z"),
             _node("B", "CVE-B", "HIGH", "RESOLVED", "vm-b", first="2025-12-01T00:00:00Z",
                   resolved="2025-12-30T12:00:00Z")],
        S2: [_node("A", "CVE-A", "CRITICAL", "OPEN", "vm-a", first="2025-12-20T00:00:00Z"),
             _node("C", "CVE-C", "HIGH", "OPEN", "vm-c")],
        S3: [_node("A", "CVE-A", "CRITICAL", "RESOLVED", "vm-a", first="2025-12-20T00:00:00Z",
                   resolved="2026-05-28T00:00:00Z"),
             _node("C", "CVE-C", "HIGH", "OPEN", "vm-c")],
        S4: [_node("C", "CVE-C", "HIGH", "OPEN", "vm-c"),
             _node("E", "CVE-E", "CRITICAL", "OPEN", "vm-e")],
    }
    for sid, records in scans.items():
        ledger.persist_flat_scan(
            records, mode="live", db_path=db, scan_id=sid,
            raw={"data": {"vulnerabilityFindings": {"nodes": records}}},
        )


def test_empty_bundle_without_db(tmp_path):
    bundle = migrate.build_migration_bundle(_db(tmp_path), tmp_path / "none.json")
    assert bundle["kind"] == migrate.BUNDLE_KIND
    assert bundle["version"] == migrate.BUNDLE_VERSION
    assert bundle["schema_version"] == ledger.SCHEMA_VERSION
    assert bundle["scans"] == []
    assert bundle["ledger"] == []
    assert bundle["episodes"] == []
    assert bundle["mttr_history"] == []
    # And it must not have created the DB as a side effect.
    assert not _db(tmp_path).exists()


def test_bundle_tables_match_ledger(tmp_path):
    db = _db(tmp_path)
    _seed(db)
    bundle = migrate.build_migration_bundle(db, tmp_path / "none.json")

    assert [s["scan_id"] for s in bundle["scans"]] == [S1, S2, S3, S4]
    for s in bundle["scans"]:
        assert sorted(s) == sorted(migrate.BUNDLE_SCAN_COLUMNS)
        assert "raw_path" not in s
        assert s["sealed"] == 0

    keys = {r["vuln_key"] for r in bundle["ledger"]}
    base = ledger.load_base_df(db)
    assert keys == set(base["vuln_key"])
    for r in bundle["ledger"]:
        assert sorted(r) == sorted(ledger.LEDGER_COLUMNS)
    assert bundle["episodes"] == []


def test_bundle_carries_sealed_scans_and_episodes(tmp_path):
    db = _db(tmp_path)
    _seed(db)
    res = ledger.compact_ledger(30, db_path=db, now=NOW)
    assert not res["no_op"]

    bundle = migrate.build_migration_bundle(db, tmp_path / "none.json")
    sealed = [s for s in bundle["scans"] if s["sealed"] == 1]
    assert len(sealed) == res["scans_sealed"]
    assert len(bundle["episodes"]) == res["episodes_created"]
    for e in bundle["episodes"]:
        assert sorted(e) == sorted(migrate.BUNDLE_EPISODE_COLUMNS)
        assert e["compaction_id"]


def test_bundle_includes_history(tmp_path):
    hist = tmp_path / "mttr_history.json"
    history.record_snapshot(4.25, resolved=10, open_=40, counts={"HIGH": 50},
                            filename=str(hist), when="2026-06-01", sla_pct=88.0,
                            oldest_open_days=61.5)
    history.record_snapshot(3.5, resolved=12, open_=38, counts={"HIGH": 50},
                            filename=str(hist), when="2026-06-02")
    bundle = migrate.build_migration_bundle(_db(tmp_path), hist)
    assert [h["date"] for h in bundle["mttr_history"]] == ["2026-06-01", "2026-06-02"]
    assert bundle["mttr_history"][0]["sla_pct"] == 88.0
    assert bundle["mttr_history"][1]["oldest_open_days"] is None


def test_bundle_counts_and_json_round_trip(tmp_path):
    db = _db(tmp_path)
    hist = tmp_path / "mttr_history.json"
    empty = migrate.bundle_counts(db, hist)
    assert empty == {"scans": 0, "vulns": 0, "episodes": 0, "history": 0}

    _seed(db)
    history.record_snapshot(2.0, filename=str(hist), when="2026-06-20")
    counts = migrate.bundle_counts(db, hist)
    assert counts["scans"] == 4 and counts["history"] == 1
    assert counts["vulns"] > 0

    parsed = json.loads(migrate.bundle_json_bytes(db, hist).decode("utf-8"))
    assert parsed["kind"] == migrate.BUNDLE_KIND
    assert len(parsed["scans"]) == counts["scans"]
    assert len(parsed["ledger"]) == counts["vulns"]
