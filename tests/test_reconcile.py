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


def test_scoped_scan_leaves_out_of_scope_open_row_untouched():
    # Wide scan sees a MEDIUM; a later Critical+High-scoped scan must NOT resolve it by
    # disappearance — its severity simply wasn't scanned.
    led, _, _ = reconcile.reconcile([_rec("a"), _rec("m", sev="MEDIUM")], {}, S1, S1, None)
    led, obs, d = reconcile.reconcile(
        [_rec("a")], led, S2, S2, S1, scanned_severities={"CRITICAL", "HIGH"}
    )
    row = led["id:m"]
    assert row["status"] == "OPEN"
    assert row["resolved_at"] is None
    assert d["resolved_count"] == 0
    # No phantom present=0 observation for the unscanned severity either.
    assert all(o["vuln_key"] != "id:m" for o in obs)


def test_scoped_scan_still_resolves_in_scope_disappearance():
    # Regression: scoping must not weaken normal disappearance for scanned severities.
    led, _, _ = reconcile.reconcile([_rec("a", sev="HIGH")], {}, S1, S1, None)
    led, _, d = reconcile.reconcile(
        [], led, S2, S2, S1, scanned_severities={"CRITICAL", "HIGH"}
    )
    assert led["id:a"]["status"] == "RESOLVED"
    assert led["id:a"]["resolution_src"] == "disappeared"
    assert d["resolved_count"] == 1


def test_unscoped_scan_behavior_unchanged():
    # scanned_severities=None must be byte-identical to the pre-scope behavior.
    led_a, obs_a, d_a = reconcile.reconcile([_rec("a")], {}, S1, S1, None)
    led_b, obs_b, d_b = reconcile.reconcile(
        [_rec("a")], {}, S1, S1, None, scanned_severities=None, prev_scan_id_by_severity=None
    )
    assert (led_a, obs_a, d_a) == (led_b, obs_b, d_b)


def test_widen_again_resolves_finding_that_vanished_while_unscanned():
    # Sequence: wide S1 (MEDIUM appears) -> scoped S2, S3 (MEDIUM unscanned, vanishes
    # meanwhile) -> wide S4. The MEDIUM must resolve on S4 via the per-severity prev map,
    # even though its last_scan_id (S1) no longer equals the plain prev_scan_id (S3).
    S4 = "2026-05-04T00:00:00Z"
    ch = {"CRITICAL", "HIGH"}
    led, _, _ = reconcile.reconcile([_rec("a"), _rec("m", sev="MEDIUM")], {}, S1, S1, None)
    led, _, _ = reconcile.reconcile([_rec("a")], led, S2, S2, S1, scanned_severities=ch)
    led, _, _ = reconcile.reconcile([_rec("a")], led, S3, S3, S2, scanned_severities=ch)
    assert led["id:m"]["status"] == "OPEN"  # paused, not falsely resolved

    # Wide scan S4: for MEDIUM the last scan that covered it was S1.
    prev_map = {"CRITICAL": S3, "HIGH": S3, "MEDIUM": S1, "LOW": S1, "INFO": S1}
    led, _, d = reconcile.reconcile(
        [_rec("a")], led, S4, S4, S3, prev_scan_id_by_severity=prev_map
    )
    row = led["id:m"]
    assert row["status"] == "RESOLVED"
    assert row["resolution_src"] == "disappeared"
    assert row["resolved_at"] == S4  # conservative: first scan that could observe it
    assert d["resolved_count"] == 1
    assert led["id:a"]["status"] == "OPEN"  # survivor untouched


def test_widen_again_keeps_surviving_out_of_scope_row_open():
    # Same widen sequence, but the MEDIUM is still present on the wide scan: it must be
    # re-listed as OPEN with last_seen advanced, never resolved.
    S4 = "2026-05-04T00:00:00Z"
    ch = {"CRITICAL", "HIGH"}
    led, _, _ = reconcile.reconcile([_rec("a"), _rec("m", sev="MEDIUM")], {}, S1, S1, None)
    led, _, _ = reconcile.reconcile([_rec("a")], led, S2, S2, S1, scanned_severities=ch)
    prev_map = {"CRITICAL": S2, "HIGH": S2, "MEDIUM": S1, "LOW": S1, "INFO": S1}
    led, _, d = reconcile.reconcile(
        [_rec("a"), _rec("m", sev="MEDIUM")], led, S4, S4, S2,
        prev_scan_id_by_severity=prev_map,
    )
    row = led["id:m"]
    assert row["status"] == "OPEN"
    assert row["last_seen"] == S4
    assert d["resolved_count"] == 0


def test_make_row_carries_rule_inputs_from_nested_and_dotted_records():
    nested = {
        "id": "n1", "name": "CVE-2026-2", "severity": "HIGH",
        "vulnerableAsset": {
            "name": "vm-2", "type": "VM",
            "subscriptionName": "core-prod",
            "subscriptionExternalId": "gcp-proj-x",
            "tags": {"env": "prod", "team": "platform"},
        },
    }
    dotted = _rec(
        "d1",
        **{
            "vulnerableAsset.subscriptionName": "staging",
            "vulnerableAsset.tags.env": "staging",
        },
    )
    led, _, _ = reconcile.reconcile([nested, dotted], {}, S1, S1, None)
    row = led["id:n1"]
    assert row["subscription_name"] == "core-prod"
    assert row["subscription_ext_id"] == "gcp-proj-x"
    assert row["tags_json"] == '{"env": "prod", "team": "platform"}'  # sorted keys
    row = led["id:d1"]
    assert row["subscription_name"] == "staging"
    assert row["tags_json"] == '{"env": "staging"}'


def test_rule_inputs_refresh_on_next_scan_and_keep_prior_when_omitted():
    led, _, _ = reconcile.reconcile(
        [_rec("a", **{"vulnerableAsset.subscriptionName": "old-sub",
                      "vulnerableAsset.tags.env": "prod"})],
        {}, S1, S1, None,
    )
    # next scan re-lists the finding with a new subscription and NO tags
    led, _, _ = reconcile.reconcile(
        [_rec("a", **{"vulnerableAsset.subscriptionName": "new-sub"})],
        led, S2, S2, S1,
    )
    row = led["id:a"]
    assert row["subscription_name"] == "new-sub"          # latest observation wins
    assert row["tags_json"] == '{"env": "prod"}'          # prior kept when omitted


def test_tags_json_none_when_asset_has_no_tags():
    led, _, _ = reconcile.reconcile([_rec("a")], {}, S1, S1, None)
    assert led["id:a"]["tags_json"] is None
    assert led["id:a"]["subscription_name"] is None


def test_reconcile_does_not_mutate_existing_ledger():
    # The prior ledger is copied per-row (not deepcopied) — reconcile must still never
    # write through to its input, or an in-memory caller would see phantom updates.
    led1, _, _ = reconcile.reconcile([_rec("a")], {}, S1, S1, None)
    frozen = {k: dict(v) for k, v in led1.items()}
    reconcile.reconcile(
        [_rec("a", status="RESOLVED", resolvedAt=S2)], led1, S2, S2, S1
    )
    assert led1 == frozen  # input ledger untouched by the second reconcile
