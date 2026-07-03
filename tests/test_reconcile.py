"""Tests for the pure cross-scan reconciliation — the heart of correct MTTR."""

from wiz_dashboard.domain import reconcile

S1 = "2026-05-01T00:00:00Z"
S2 = "2026-05-02T00:00:00Z"
S3 = "2026-05-03T00:00:00Z"


def _rec(fid, sev="HIGH", **kw):
    r = {
        "id": fid,
        "name": "CVE-2026-1",
        "severity": sev,
        "vulnerableAsset.name": "vm-1",
        "vulnerableAsset.type": "VIRTUAL_MACHINE",
    }
    r.update(kw)
    return r


def test_appear_persist_disappear_resolves():
    led, _, d1 = reconcile.reconcile([_rec("a")], {}, S1, S1, None)
    assert d1["new_count"] == 1
    assert led["id:a"]["status"] == "OPEN"
    first_seen = led["id:a"]["first_seen"]

    led, _, _ = reconcile.reconcile([_rec("a")], led, S2, S2, S1)
    assert led["id:a"]["status"] == "OPEN"
    assert led["id:a"]["first_seen"] == first_seen  # unchanged while persisting
    assert led["id:a"]["last_seen"] == S2  # advanced

    led, _, d3 = reconcile.reconcile([], led, S3, S3, S2)  # A absent now
    row = led["id:a"]
    assert row["status"] == "RESOLVED"
    assert row["resolved_at"] == S3
    assert row["resolution_src"] == "disappeared"
    assert d3["resolved_count"] == 1


def test_reopen_increments_and_resets_episode():
    led, _, _ = reconcile.reconcile([_rec("a")], {}, S1, S1, None)
    led, _, _ = reconcile.reconcile([], led, S2, S2, S1)  # disappears -> resolved
    assert led["id:a"]["status"] == "RESOLVED"
    led, _, d = reconcile.reconcile([_rec("a")], led, S3, S3, S2)  # reappears active
    row = led["id:a"]
    assert row["status"] == "OPEN"
    assert row["resolved_at"] is None
    assert row["reopened_count"] == 1
    assert row["first_seen"] == S3  # new episode starts here
    assert d["reopened_count"] == 1


def test_api_resolved_status_honored():
    led, _, d = reconcile.reconcile(
        [_rec("a", status="RESOLVED", resolvedAt="2026-05-01T12:00:00Z")],
        {}, S1, S1, None,
    )
    row = led["id:a"]
    assert row["status"] == "RESOLVED"
    assert row["resolution_src"] == "api"
    assert row["resolved_at"] == "2026-05-01T12:00:00Z"
    assert d["resolved_count"] == 1


def test_already_resolved_finding_re_listed_does_not_reopen():
    # A finding the API keeps returning WITH resolvedAt must stay resolved across scans
    # (no spurious reopen, no double-count) — otherwise re-running a static scan corrupts.
    rec = _rec("a", status="RESOLVED", resolvedAt="2026-05-01T12:00:00Z")
    led, _, _ = reconcile.reconcile([rec], {}, S1, S1, None)
    led, _, d = reconcile.reconcile([rec], led, S2, S2, S1)
    row = led["id:a"]
    assert row["status"] == "RESOLVED"
    assert row["reopened_count"] == 0
    assert d["reopened_count"] == 0
    assert d["resolved_count"] == 0  # not re-counted


def test_first_seen_takes_earlier_api_value():
    led, _, _ = reconcile.reconcile(
        [_rec("a", firstDetectedAt="2026-03-01T00:00:00Z")], {}, S1, S1, None
    )
    assert led["id:a"]["first_seen"] == "2026-03-01T00:00:00Z"


def test_disappearance_skips_when_not_in_prev_scan():
    # A vuln last seen in S1 must NOT be resolved by a disappearance at S3 whose prev is S2.
    led, _, _ = reconcile.reconcile([_rec("a")], {}, S1, S1, None)  # a open, last_scan=S1
    led, _, _ = reconcile.reconcile([_rec("b")], led, S2, S2, None)  # no disappearance pass
    assert led["id:a"]["status"] == "OPEN"
    assert led["id:a"]["last_scan_id"] == S1
    led, _, d = reconcile.reconcile([_rec("b")], led, S3, S3, S2)  # prev=S2; a last_scan=S1
    assert led["id:a"]["status"] == "OPEN"  # not in prev scan -> not resolved
    assert d["resolved_count"] == 0


def test_midpoint_resolution_timestamp():
    led, _, _ = reconcile.reconcile([_rec("a")], {}, S1, S1, None)
    led, _, _ = reconcile.reconcile(
        [], led, S3, S3, S1, disappearance_mode="midpoint", prev_scan_ts=S1
    )
    # halfway between S1 (05-01) and S3 (05-03) is S2 (05-02).
    assert led["id:a"]["resolved_at"] == S2


def test_nan_resolvedat_from_dataframe_does_not_resolve():
    # df.to_dict("records") gives NaN (truthy!) for absent resolvedAt — must stay OPEN.
    rec = _rec("a", resolvedAt=float("nan"), status="OPEN")
    led, _, d = reconcile.reconcile([rec], {}, S1, S1, None)
    assert led["id:a"]["status"] == "OPEN"
    assert d["resolved_count"] == 0


def test_reconcile_does_not_mutate_existing_ledger():
    # The prior ledger is copied per-row (not deepcopied) — reconcile must still never
    # write through to its input, or an in-memory caller would see phantom updates.
    led1, _, _ = reconcile.reconcile([_rec("a")], {}, S1, S1, None)
    frozen = {k: dict(v) for k, v in led1.items()}
    reconcile.reconcile(
        [_rec("a", status="RESOLVED", resolvedAt=S2)], led1, S2, S2, S1
    )
    assert led1 == frozen  # input ledger untouched by the second reconcile
