"""Pure unit tests for the domain rule engine (no Streamlit).

Covers the documented matching semantics matrix, the priority/first-wins contract,
fail-closed behavior for malformed input, the compacted-episode guard, and parity
between the per-record and the two vectorized evaluation paths.
"""

import json

import pandas as pd
import pytest

from wiz_dashboard.data.transform import nodes_to_dataframe
from wiz_dashboard.domain import domain_rules as dr


def _domain(name, *rules):
    return {"id": f"dom-{name.lower()}", "name": name,
            "rules": [{"conditions": list(conds)} for conds in rules]}


def tag(key, value=None):
    return {"type": "tag", "key": key, "value": value}


def rx(pattern):
    return {"type": "name_regex", "pattern": pattern}


def sub(*values):
    return {"type": "subscription", "values": list(values)}


def sg(*values):
    return {"type": "support_group", "values": list(values)}


def _node(name="web-prod-01", tags=None, subscription=None, sub_ext=None, fid=None):
    va = {"name": name, "type": "VIRTUAL_MACHINE", "cloudPlatform": "AWS"}
    if tags is not None:
        va["tags"] = tags
    if subscription is not None:
        va["subscriptionName"] = subscription
    if sub_ext is not None:
        va["subscriptionExternalId"] = sub_ext
    return {"id": fid or f"f-{name}", "name": "CVE-2024-0001", "severity": "HIGH",
            "vulnerableAsset": va}


def assign(items, record):
    return dr.assign_domain(record, dr.compile_domains(items))


# ------------------------------------------------------------------ conditions
def test_tag_value_match_is_case_insensitive_on_value_only():
    items = [_domain("Pay", [tag("team", "payments")])]
    assert assign(items, _node(tags={"team": "PAYMENTS"})) == "Pay"
    assert assign(items, _node(tags={"team": " payments "})) == "Pay"
    # tag KEY is case-sensitive
    assert assign(items, _node(tags={"Team": "payments"})) == dr.UNASSIGNED


def test_tag_key_exists_matches_any_value_including_empty():
    items = [_domain("Tagged", [tag("tier")])]
    assert assign(items, _node(tags={"tier": "data"})) == "Tagged"
    assert assign(items, _node(tags={"tier": ""})) == "Tagged"
    assert assign(items, _node(tags={"other": "x"})) == dr.UNASSIGNED
    assert assign(items, _node()) == dr.UNASSIGNED


def test_regex_uses_search_semantics_and_ignorecase():
    items = [_domain("Web", [rx("prod-0[0-9]$")])]
    assert assign(items, _node(name="WEB-PROD-01")) == "Web"
    assert assign(items, _node(name="db-prod-011")) == dr.UNASSIGNED


def test_invalid_regex_never_matches():
    items = [_domain("Broken", [rx("(unclosed")])]
    assert assign(items, _node(name="(unclosed anything")) == dr.UNASSIGNED


def test_subscription_any_of_matches_name_and_external_id():
    items = [_domain("Prod", [sub("Core-Prod", "gcp-proj-x")])]
    assert assign(items, _node(subscription="core-prod")) == "Prod"
    assert assign(items, _node(sub_ext="GCP-PROJ-X")) == "Prod"
    assert assign(items, _node(subscription="staging")) == dr.UNASSIGNED


def test_support_group_matches_live_attached_field_case_insensitively():
    # The support group is attached live as _supportGroup before assignment; the
    # value compares trimmed + case-insensitive, like the subscription condition.
    items = [_domain("Supply", [sg("CS-SUPPLY-MONITORING", "CS-OTHER")])]
    node = _node(name="vm-1")
    assert assign(items, {**node, "_supportGroup": "cs-supply-monitoring"}) == "Supply"
    assert assign(items, {**node, "_supportGroup": " CS-OTHER "}) == "Supply"
    # a raw nested shape and the ledger column form both resolve
    assert assign(items, {"vulnerableAsset": {"supportGroup": "CS-SUPPLY-MONITORING"}}) == "Supply"
    assert assign(items, {"asset_name": "led", "support_group": "CS-OTHER"}) == "Supply"
    # non-match and absent field stay Unassigned
    assert assign(items, {**node, "_supportGroup": "UNKNOWN-GROUP"}) == dr.UNASSIGNED
    assert assign(items, node) == dr.UNASSIGNED


# ------------------------------------------------------------ rule combination
def test_and_within_rule_or_across_rules():
    items = [_domain("A",
                     [tag("env", "prod"), rx("^web-")],       # rule 1: AND
                     [sub("legacy")])]                        # rule 2
    assert assign(items, _node(name="web-1", tags={"env": "prod"})) == "A"
    # AND fails when one condition fails…
    assert assign(items, _node(name="db-1", tags={"env": "prod"})) == dr.UNASSIGNED
    # …but the second rule can still claim it.
    assert assign(items, _node(name="db-1", subscription="legacy")) == "A"


def test_priority_first_match_wins():
    items = [_domain("First", [tag("env", "prod")]),
             _domain("Second", [tag("env", "prod")])]
    assert assign(items, _node(tags={"env": "prod"})) == "First"


def test_empty_rules_and_malformed_conditions_never_match():
    assert assign([_domain("NoRules")], _node()) == dr.UNASSIGNED
    assert assign([{"name": "Empty", "rules": [{"conditions": []}]}],
                  _node()) == dr.UNASSIGNED
    # a malformed condition poisons its whole rule (fail closed, not fail open)
    items = [{"name": "Poisoned",
              "rules": [{"conditions": [tag("env", "prod"), {"type": "nope"}]}]}]
    assert assign(items, _node(tags={"env": "prod"})) == dr.UNASSIGNED


# ------------------------------------------------------------------ validation
def test_validate_domains_error_catalogue():
    errors = dr.validate_domains([
        {"name": "", "rules": []},
        {"name": "Unassigned", "rules": [{"conditions": [tag("k")]}]},
        {"name": "A,B", "rules": [{"conditions": [tag("k")]}]},
        {"name": "Dup", "rules": [{"conditions": [rx("(bad")]}]},
        {"name": "dup", "rules": [{"conditions": [sub()]}]},
        {"name": "Long", "rules": [{"conditions": [rx("x" * 201)]}]},
        {"name": "SG", "rules": [{"conditions": [sg()]}]},
    ])
    text = "\n".join(errors)
    assert "name is required" in text
    assert "reserved" in text
    assert "commas" in text
    assert "does not compile" in text
    assert "duplicate name" in text
    assert "at least one subscription" in text
    assert "at least one support group" in text
    assert "longer than" in text


def test_validate_ok_for_well_formed_items():
    items = [_domain("Pay", [tag("team", "payments")], [sub("core-prod")]),
             _domain("Web", [rx("^web-")])]
    assert dr.validate_domains(items) == []


def test_domain_names_priority_order_plus_unassigned():
    items = [_domain("B", [tag("k")]), _domain("A", [tag("k")])]
    assert dr.domain_names(items) == ["B", "A", dr.UNASSIGNED]


# ---------------------------------------------------------------- vectorized
ITEMS = [
    _domain("Payments", [tag("team", "payments")], [sub("core-prod")]),
    _domain("Web", [rx("^web-"), tag("env", "prod")]),
    _domain("Everything-Staging", [sub("staging")]),
]

NODES = [
    _node(name="web-prod-01", tags={"team": "payments", "env": "prod"}, fid="f1"),
    _node(name="web-prod-02", tags={"env": "prod"}, fid="f2"),
    _node(name="db-prod-01", subscription="core-prod", fid="f3"),
    _node(name="web-stage-01", tags={"env": "staging"}, subscription="staging", fid="f4"),
    _node(name="batch-fn-01", fid="f5"),
    {"id": "f6", "name": "CVE-2024-9999", "severity": "LOW",
     "vulnerableAsset": {"name": "cache-01", "type": "VM", "cloudPlatform": "GCP",
                         "tags": None}},
]
EXPECTED = ["Payments", "Web", "Payments", "Everything-Staging",
            dr.UNASSIGNED, dr.UNASSIGNED]


def test_assign_domains_frame_matches_expected_and_per_record_parity():
    compiled = dr.compile_domains(ITEMS)
    df = nodes_to_dataframe(NODES)
    got = dr.assign_domains_frame(df, compiled)
    assert list(got) == EXPECTED
    # parity: vectorized == per-record over the flattened records
    for rec, want in zip(df.to_dict("records"), EXPECTED):
        assert dr.assign_domain(rec, compiled) == want
    # parity: per-record over the RAW nested nodes too
    for node, want in zip(NODES, EXPECTED):
        assert dr.assign_domain(node, compiled) == want


def test_assign_domains_frame_handles_flattened_tag_columns_only():
    # every node carries a tags dict → json_normalize emits only tags.* columns
    nodes = [_node(name="a", tags={"team": "payments"}, fid="x1"),
             _node(name="b", tags={"team": "web"}, fid="x2")]
    df = nodes_to_dataframe(nodes)
    compiled = dr.compile_domains([_domain("Pay", [tag("team", "payments")])])
    assert list(dr.assign_domains_frame(df, compiled)) == ["Pay", dr.UNASSIGNED]


def test_assign_domains_frame_empty_df():
    out = dr.assign_domains_frame(pd.DataFrame(), dr.compile_domains(ITEMS))
    assert out.empty


# ---------------------------------------------------------------- ledger path
def _ledger_df(rows):
    base = {"vuln_key": "k", "cve": "CVE-1", "severity": "HIGH", "asset_id": None,
            "asset_name": None, "asset_type": None, "cloud": None,
            "subscription_name": None, "subscription_ext_id": None, "tags_json": None}
    return pd.DataFrame([{**base, **r} for r in rows])


def test_assign_domains_ledger_all_condition_types():
    df = _ledger_df([
        {"asset_name": "web-prod-01", "tags_json": json.dumps({"env": "prod"})},
        {"asset_name": "db-01", "subscription_name": "core-prod"},
        {"asset_name": "x", "subscription_ext_id": "staging"},
        {"asset_name": "batch-01"},
        {"asset_name": "y", "tags_json": "{not json"},
    ])
    got = dr.assign_domains_ledger(df, dr.compile_domains(ITEMS))
    assert list(got) == ["Web", "Payments", "Everything-Staging",
                         dr.UNASSIGNED, dr.UNASSIGNED]


def test_assign_domains_ledger_support_group_vectorized_parity():
    items = [_domain("Supply", [sg("CS-SUPPLY-MONITORING")])]
    df = _ledger_df([
        {"asset_name": "a", "support_group": "cs-supply-monitoring"},
        {"asset_name": "b", "support_group": "OTHER"},
        {"asset_name": "c"},
    ])
    compiled = dr.compile_domains(items)
    got = dr.assign_domains_ledger(df, compiled)
    assert list(got) == ["Supply", dr.UNASSIGNED, dr.UNASSIGNED]
    # vectorized == per-record
    for rec, want in zip(df.to_dict("records"), got):
        assert dr.assign_domain(rec, compiled) == want


def test_compacted_episode_rows_are_pinned_unassigned():
    # a greedy regex that would match anything, incl. the placeholder
    items = [_domain("Greedy", [rx(".")])]
    df = _ledger_df([
        {"asset_name": "(compacted)"},
        {"asset_name": "real-asset"},
    ])
    got = dr.assign_domains_ledger(df, dr.compile_domains(items))
    assert list(got) == [dr.UNASSIGNED, "Greedy"]


def test_ledger_null_inputs_only_name_regex_can_classify():
    items = [_domain("ByName", [rx("^legacy-")]),
             _domain("ByTag", [tag("env", "prod")])]
    df = _ledger_df([{"asset_name": "legacy-app-1"}, {"asset_name": "other"}])
    got = dr.assign_domains_ledger(df, dr.compile_domains(items))
    assert list(got) == ["ByName", dr.UNASSIGNED]
