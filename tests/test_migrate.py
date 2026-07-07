"""Tests for the migration-bundle exporter (wiz_dashboard.data.migrate)."""

import gzip
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


# ------------------------------------------------------------------- windowed split

_CUTOFF = "2026-03-01T00:00:00Z"  # A resolved 2026-05-28 (live), B resolved 2025-12-30 (old)


def _keys(rows):
    return sorted(r["vuln_key"] for r in rows)


def test_split_is_a_lossless_partition(tmp_path):
    db = _db(tmp_path)
    _seed(db)
    ledger.compact_ledger(30, db_path=db, now=NOW)  # create some episodes to split too
    hist = tmp_path / "none.json"
    full = migrate.build_migration_bundle(db, hist)
    live, arch = migrate.build_split_bundles(db, hist, _CUTOFF)

    for table in ("ledger", "episodes"):
        assert _keys(live[table]) + _keys(arch[table]) == sorted(_keys(full[table])), table
        live_keys, arch_keys = set(_keys(live[table])), set(_keys(arch[table]))
        assert not (live_keys & arch_keys), f"{table} overlaps"
    # Scans and MTTR history ride entirely in the live half; archive carries neither.
    assert live["scans"] == full["scans"]
    assert live["mttr_history"] == full["mttr_history"]
    assert arch["scans"] == [] and arch["mttr_history"] == []
    assert live["kind"] == migrate.BUNDLE_KIND
    assert arch["kind"] == migrate.ARCHIVE_KIND


def test_split_keeps_open_and_recent_archives_settled_old(tmp_path):
    db = _db(tmp_path)
    _seed(db)
    live, arch = migrate.build_split_bundles(db, _db(tmp_path).with_name("none.json"), _CUTOFF)

    # Every archived row is settled-and-old; every live row is open or recently resolved.
    for r in arch["ledger"]:
        assert r["status"] == "RESOLVED" and r["resolved_at"] < _CUTOFF
    for r in live["ledger"]:
        assert r["status"] != "RESOLVED" or (r["resolved_at"] or "9") >= _CUTOFF
    for r in arch["episodes"]:
        assert r["resolved_at"] < _CUTOFF
    # B resolved 2025-12-30 lands in the archive; A (2026-05-28) and open C/E stay live.
    assert "B" not in " ".join(_keys(live["ledger"]))  # crude: no B vuln in live
    arch_cves = {r["cve"] for r in arch["ledger"]}
    assert "CVE-B" in arch_cves


def test_split_none_cutoff_is_all_live(tmp_path):
    db = _db(tmp_path)
    _seed(db)
    hist = _db(tmp_path).with_name("none.json")
    full = migrate.build_migration_bundle(db, hist)
    live, arch = migrate.build_split_bundles(db, hist, None)
    assert _keys(live["ledger"]) == _keys(full["ledger"])
    assert arch["ledger"] == [] and arch["episodes"] == []


def test_split_counts_match_bundles(tmp_path):
    db = _db(tmp_path)
    _seed(db)
    ledger.compact_ledger(30, db_path=db, now=NOW)
    hist = _db(tmp_path).with_name("none.json")
    live, arch = migrate.build_split_bundles(db, hist, _CUTOFF)
    sc = migrate.split_counts(db, hist, _CUTOFF)
    assert sc["live_vulns"] == len(live["ledger"])
    assert sc["archive_vulns"] == len(arch["ledger"])
    assert sc["live_episodes"] == len(live["episodes"])
    assert sc["archive_episodes"] == len(arch["episodes"])
    assert sc["scans"] == len(live["scans"])


def test_live_and_archive_download_bytes(tmp_path):
    db = _db(tmp_path)
    _seed(db)
    hist = _db(tmp_path).with_name("none.json")
    live = json.loads(migrate.live_bundle_json_bytes(db, hist, _CUTOFF).decode("utf-8"))
    assert live["kind"] == migrate.BUNDLE_KIND
    raw = gzip.decompress(migrate.archive_bundle_gz_bytes(db, hist, _CUTOFF))
    arch = json.loads(raw.decode("utf-8"))
    assert arch["kind"] == migrate.ARCHIVE_KIND


# --------------------------------------------------------------- slim-open live bundle


def test_slim_open_reduces_open_rows_only(tmp_path):
    db = _db(tmp_path)
    _seed(db)  # C, E are OPEN; A resolved 2026-05-28 (live-recent); B resolved 2025-12-30
    hist = _db(tmp_path).with_name("none.json")
    full_live, _ = migrate.build_split_bundles(db, hist, _CUTOFF, slim_open=False)
    slim_live, slim_arch = migrate.build_split_bundles(db, hist, _CUTOFF, slim_open=True)

    # Same rows either way (slim drops fields, never rows) — partition stays lossless.
    assert _keys(slim_live["ledger"]) == _keys(full_live["ledger"])

    by_status = {r.get("status"): r for r in full_live["ledger"]}
    for r in slim_live["ledger"]:
        if r.get("first_seen") is not None and set(r) == {"vuln_key", "first_seen"}:
            continue  # a slimmed open row
        # Anything not slimmed must be a resolved row carried in full.
        assert r.get("status") == "RESOLVED"

    # Every open row is reduced to exactly {vuln_key, first_seen}; resolved rows stay full.
    open_keys = {r["vuln_key"] for r in full_live["ledger"] if r.get("status") != "RESOLVED"}
    assert open_keys  # sanity: there ARE open rows to slim (C, E)
    for r in slim_live["ledger"]:
        if r["vuln_key"] in open_keys:
            assert set(r) == {"vuln_key", "first_seen"}
        else:
            assert "tags_json" in r  # resolved row kept full fidelity

    # No tags_json leaks from any slimmed open row; the archive keeps full rows.
    assert not any("tags_json" in r for r in slim_live["ledger"]
                   if r["vuln_key"] in open_keys)
    if slim_arch["ledger"]:
        assert all("tags_json" in r for r in slim_arch["ledger"])
    # Episodes / scans / history are untouched by slimming.
    assert slim_live["episodes"] == full_live["episodes"]
    assert slim_live["scans"] == full_live["scans"]
    assert slim_live["mttr_history"] == full_live["mttr_history"]


def test_slim_open_shrinks_bytes_dramatically(tmp_path):
    # A ledger of open rows each carrying a fat tags_json — the real-world bloat.
    db = _db(tmp_path)
    fat_tags = [_node(f"F{i}", f"CVE-{i}", "HIGH", "OPEN", f"vm-{i}") for i in range(200)]
    for n in fat_tags:
        n["vulnerableAsset"]["tags"] = {f"tag_{k}": "x" * 200 for k in range(20)}
    ledger.persist_flat_scan(
        fat_tags, mode="live", db_path=db, scan_id="2026-06-20T06:00:00Z",
        raw={"data": {"vulnerabilityFindings": {"nodes": fat_tags}}},
    )
    hist = _db(tmp_path).with_name("none.json")
    full = len(migrate.live_bundle_json_bytes(db, hist, _CUTOFF, slim_open=False))
    slim = len(migrate.live_bundle_json_bytes(db, hist, _CUTOFF, slim_open=True))
    assert slim * 4 < full, f"slim={slim} not << full={full}"
