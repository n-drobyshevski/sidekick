"""Tests for cross-scan vuln identity and ledger-based MTTR (lifecycle module)."""

import pandas as pd

from wiz_dashboard.domain import lifecycle


def test_vuln_key_prefers_id():
    assert lifecycle.vuln_key({"id": "dry-c1", "name": "CVE-2026-1001"}) == "id:dry-c1"


def test_vuln_key_hash_fallback_is_stable_and_asset_specific():
    a = {
        "name": "CVE-2026-1",
        "vulnerableAsset.name": "web-01",
        "vulnerableAsset.type": "VIRTUAL_MACHINE",
        "vulnerableAsset.cloudPlatform": "AWS",
    }
    b = dict(a)
    c = {**a, "vulnerableAsset.name": "web-02"}
    ka, kb, kc = lifecycle.vuln_key(a), lifecycle.vuln_key(b), lifecycle.vuln_key(c)
    assert ka.startswith("h:")
    assert ka == kb  # same record -> same key
    assert ka != kc  # different asset -> different key


def test_vuln_key_ignores_nan_id():
    # df.to_dict("records") yields NaN for a missing id; it must not become "id:nan".
    key = lifecycle.vuln_key(
        {"id": float("nan"), "name": "CVE-2026-9", "vulnerableAsset.name": "vm"}
    )
    assert key.startswith("h:")


def test_field_treats_nan_as_missing_and_reads_nested():
    assert lifecycle.field({"vulnerableAsset.name": float("nan")}, "vulnerableAsset.name") == ""
    assert lifecycle.field({"vulnerableAsset": {"name": "vm-1"}}, "vulnerableAsset.name") == "vm-1"


def test_mttr_from_ledger_matches_known_fixture():
    now = pd.Timestamp("2026-05-01T00:00:00Z")
    rows = [
        {"severity": "HIGH", "first_seen": "2026-04-01T00:00:00Z",
         "status": "RESOLVED", "resolved_at": "2026-04-08T00:00:00Z"},  # 7d
        {"severity": "HIGH", "first_seen": "2026-04-10T00:00:00Z",
         "status": "OPEN", "resolved_at": None},
    ]
    per, overall = lifecycle.mttr_from_ledger(rows, now=now)
    assert per["HIGH"]["resolved"] == 1
    assert per["HIGH"]["open"] == 1
    assert per["HIGH"]["mttr_median"] == 7.0
    assert per["HIGH"]["sla_target"] == 14
    assert per["HIGH"]["sla_pct"] == 100.0
    assert overall["resolved"] == 1
    assert overall["open"] == 1


def test_mttr_from_ledger_empty():
    assert lifecycle.mttr_from_ledger([]) == ({}, {})
