"""Golden-fixture exporter: runs the ORIGINAL Python domain code over scenario inputs
and dumps {input, expected} JSON for the TypeScript parity suites in gas/test/.

Run from the repo root (needs pandas installed):
    python gas/test/export_fixtures.py

Regenerate whenever the Python domain layer changes; the fixtures are committed so the
TS tests run without a Python toolchain.
"""

import json
import math
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from wiz_dashboard.data.ledger import parse_severities, serialize_severities, _trend_from_frames
from wiz_dashboard.data.transform import extract_nodes, merge_nodes
from wiz_dashboard.domain.domain_rules import (
    assign_domain,
    compile_domains,
    domain_names,
    validate_domains,
)
from wiz_dashboard.domain.lifecycle import field, mttr_from_ledger, vuln_key
from wiz_dashboard.domain.metrics import calculate_mttr, overall_sla_oldest
from wiz_dashboard.domain.reconcile import _tags_json, reconcile
from wiz_dashboard.domain.severity import normalize_severity

OUT = Path(__file__).parent / "fixtures"
NOW = "2026-07-01T00:00:00Z"


def scrub(obj):
    """NaN/NaT/numpy scalars -> JSON-safe (None / plain python)."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {str(k): scrub(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [scrub(v) for v in obj]
    if isinstance(obj, float):
        return None if math.isnan(obj) else obj
    if hasattr(obj, "item"):  # numpy scalar
        return scrub(obj.item())
    if isinstance(obj, pd.Timestamp):
        return obj.strftime("%Y-%m-%dT%H:%M:%SZ")
    return obj


def dump(name, payload):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(scrub(payload), indent=1, sort_keys=False))
    print(f"wrote {name}.json")


# ---------------------------------------------------------------------------- severity
sev_inputs = [
    "CRITICAL", "critical", " high ", "INFORMATIONAL", "informational", "Info", "MEDIUM",
    "LOW", "UNKNOWN", "bogus", "", "   ", None, 42, "HIGHER", "critical\n",
]
dump("severity", {
    "cases": [{"input": s, "expected": normalize_severity(s)} for s in sev_inputs],
})

# ---------------------------------------------------------------------------- vuln_key
key_records = [
    {"id": "abc-123", "name": "CVE-2024-0001"},
    {"id": "  abc-123  "},
    {"id": ""},
    {"name": "CVE-2024-0001",
     "vulnerableAsset.id": "vm-1", "vulnerableAsset.type": "VIRTUAL_MACHINE",
     "vulnerableAsset.cloudPlatform": "AWS", "detailedName": "openssl"},
    {"name": "CVE-2024-0001",
     "vulnerableAsset": {"id": "vm-1", "type": "VIRTUAL_MACHINE", "cloudPlatform": "AWS"},
     "detailedName": "openssl"},
    {"name": "CVE-2024-0002", "vulnerableAsset": {"name": "worker-7"},
     "detailedNameV2": "vim"},
    {"name": "CVE-2024-0003"},
    {},
    {"name": "CVE-2024-0004", "assetId": "asset-9", "type": "VM", "cloudPlatform": "azure",
     "detailedNameV2": "python"},
    {"name": "CVE-Ünïcode", "vulnerableAsset": {"name": "sërver"}},
]
dump("vuln_key", {
    "cases": [{"input": r, "expected": vuln_key(r)} for r in key_records],
})

# ------------------------------------------------------------------------------- field
field_cases = [
    {"record": {"vulnerableAsset.name": "vm-a"}, "keys": ["vulnerableAsset.name"]},
    {"record": {"vulnerableAsset": {"name": "vm-b"}}, "keys": ["vulnerableAsset.name"]},
    {"record": {"vulnerableAsset.name": "", "vulnerableAsset": {"name": "vm-c"}},
     "keys": ["vulnerableAsset.name"]},
    {"record": {"a": None, "b": "x"}, "keys": ["a", "b"]},
    {"record": {"a": float("nan"), "b": "y"}, "keys": ["a", "b"]},
    {"record": {}, "keys": ["missing"]},
    {"record": {"n": 0}, "keys": ["n"]},
    {"record": {"n": False}, "keys": ["n"]},
]
dump("field", {
    "cases": [
        {"input": c, "expected": field(c["record"], *c["keys"])} for c in field_cases
    ],
})

# --------------------------------------------------------------------------- tags_json
tags_cases = [
    {"vulnerableAsset": {"tags": {"env": "prod", "team": "core"}}},
    {"vulnerableAsset": {"tags": {"b": "2", "a": "1"}}},
    {"vulnerableAsset.tags.env": "prod", "vulnerableAsset.tags.team": "core"},
    {"vulnerableAsset.tags.empty": "", "vulnerableAsset.tags.gone": None},
    {"vulnerableAsset": {"tags": {}}},
    {"vulnerableAsset": {"tags": {"only": None}}},
    {},
    {"vulnerableAsset": {"tags": {"num": 3, "flag": True}}},
    {"vulnerableAsset": {"tags": {"uni": "ünïcode"}}},
]
dump("tags_json", {
    "cases": [{"input": r, "expected": _tags_json(r)} for r in tags_cases],
})

# --------------------------------------------------------------------------- reconcile
def run_reconcile(name, records, ledger, scan_id, scan_ts, prev_scan_id, **kw):
    updated, obs, deltas = reconcile(records, ledger, scan_id, scan_ts, prev_scan_id, **kw)
    return {
        "name": name,
        "input": {
            "records": records, "ledger": ledger, "scan_id": scan_id,
            "scan_ts": scan_ts, "prev_scan_id": prev_scan_id,
            "options": {k: v for k, v in kw.items()},
        },
        "expected": {"ledger": updated, "observations": obs, "deltas": deltas},
    }


T1 = "2026-06-01T06:00:00Z"
T2 = "2026-06-08T06:00:00Z"
T3 = "2026-06-15T06:00:00Z"

rec_a = {
    "id": "f-1", "name": "CVE-2024-1111", "severity": "CRITICAL", "status": "OPEN",
    "firstDetectedAt": "2026-05-20T12:30:45Z",
    "vulnerableAsset": {
        "id": "vm-1", "name": "api-server-1", "type": "VIRTUAL_MACHINE",
        "cloudPlatform": "AWS", "subscriptionName": "prod-sub",
        "subscriptionExternalId": "123", "tags": {"env": "prod"},
    },
}
rec_b = {
    "id": "f-2", "name": "CVE-2024-2222", "severity": "high", "status": "RESOLVED",
    "firstDetectedAt": "2026-05-25T00:00:00Z", "resolvedAt": "2026-05-30T10:00:00+02:00",
    "vulnerableAsset": {"id": "vm-2", "name": "db-1", "type": "VIRTUAL_MACHINE",
                        "cloudPlatform": "Azure"},
}
rec_c_flat = {
    "name": "CVE-2024-3333", "severity": "MEDIUM", "status": "OPEN",
    "vulnerableAsset.id": "vm-3", "vulnerableAsset.name": "worker-1",
    "vulnerableAsset.type": "VIRTUAL_MACHINE", "vulnerableAsset.cloudPlatform": "GCP",
    "vulnerableAsset.tags.env": "stage",
}
rec_dup = {"id": "f-1", "name": "CVE-2024-1111", "severity": "LOW", "status": "OPEN"}

scenarios = []
# 1: first scan — new, api-resolved, in-scan duplicate, future firstDetectedAt clamps.
scenarios.append(run_reconcile(
    "first_scan", [rec_a, rec_b, rec_c_flat, rec_dup,
                   {"id": "f-4", "name": "CVE-2024-4444", "severity": "HIGH",
                    "status": "OPEN", "firstDetectedAt": "2026-07-09T00:00:00Z"}],
    {}, T1, T1, None,
))
led1 = scenarios[0]["expected"]["ledger"]

# 2: second scan — persist f-1 (earlier api first), disappearance of vm-3, reopen f-2.
scenarios.append(run_reconcile(
    "second_scan",
    [
        {**rec_a, "firstDetectedAt": "2026-05-18T00:00:00Z"},
        {"id": "f-2", "name": "CVE-2024-2222", "severity": "HIGH", "status": "OPEN",
         "firstDetectedAt": "2026-05-25T00:00:00Z",
         "vulnerableAsset": {"id": "vm-2", "name": "db-1", "type": "VIRTUAL_MACHINE",
                             "cloudPlatform": "Azure"}},
    ],
    led1, T2, T2, T1,
))

# 3: midpoint disappearance mode.
scenarios.append(run_reconcile(
    "midpoint_disappearance", [rec_a], led1, T2, T2, T1,
    disappearance_mode="midpoint", prev_scan_ts=T1,
))

# 4: severity-scope guard — MEDIUM not scanned, so vm-3 must NOT resolve.
scenarios.append(run_reconcile(
    "scope_guard", [rec_a, {"id": "f-2", "name": "CVE-2024-2222", "severity": "HIGH",
                            "status": "OPEN"}],
    led1, T2, T2, T1, scanned_severities=["CRITICAL", "HIGH"],
))

# 5: per-severity prev-scan map — MEDIUM last covered by T1 scan, resolves now.
led2 = scenarios[1]["expected"]["ledger"]
scenarios.append(run_reconcile(
    "prev_by_severity",
    [{**rec_a, "status": "OPEN"}],
    led2, T3, T3, "2026-06-08T06:00:00Z",
    scanned_severities=["CRITICAL", "MEDIUM"],
    prev_scan_id_by_severity={"CRITICAL": T2, "MEDIUM": T1},
))

# 6: reopened vuln stays resolved when API still says resolved.
scenarios.append(run_reconcile(
    "resolved_relisted", [rec_b], scenarios[1]["expected"]["ledger"], T3, T3, T2,
))
dump("reconcile", {"scenarios": scenarios})

# ----------------------------------------------------------------------------- metrics
metrics_records = [
    {"severity": "CRITICAL", "firstDetectedAt": "2026-06-01T00:00:00Z",
     "resolvedAt": "2026-06-05T12:00:00Z"},
    {"severity": "CRITICAL", "firstDetectedAt": "2026-06-10T00:00:00Z"},
    {"severity": "CRITICAL", "firstDetectedAt": "2026-06-02T00:00:00Z",
     "resolvedAt": "2026-06-20T00:00:00Z"},
    {"severity": "HIGH", "firstDetectedAt": "2026-05-01T00:00:00Z",
     "resolvedAt": "2026-05-10T00:00:00Z"},
    {"severity": "high", "firstDetectedAt": "2026-04-01T00:00:00Z"},
    {"severity": "HIGH", "firstDetectedAt": "2026-03-01T00:00:00Z"},
    {"severity": "HIGH", "firstDetectedAt": "2026-06-25T00:00:00Z"},
    {"severity": "MEDIUM", "firstDetectedAt": "bogus"},
    {"severity": "INFORMATIONAL", "firstDetectedAt": "2026-06-01T00:00:00Z",
     "resolvedAt": "2026-06-02T00:00:00Z"},
    {"severity": None, "firstDetectedAt": "2026-06-01T00:00:00Z"},
]
now_ts = pd.Timestamp(NOW)
per_sev, overall = calculate_mttr(pd.DataFrame(metrics_records))
# calculate_mttr has no `now` parameter; recompute deterministically via _summarize path:
from wiz_dashboard.domain.metrics import _summarize  # noqa: E402
work = pd.DataFrame(metrics_records)
work["_sev"] = work["severity"].apply(normalize_severity)
work["_first_seen"] = pd.to_datetime(work["firstDetectedAt"], errors="coerce", utc=True)
work["_resolved"] = pd.to_datetime(work["resolvedAt"], errors="coerce", utc=True)
per_sev, overall = _summarize(work, now=now_ts)
sla, oldest = overall_sla_oldest(per_sev)
dump("metrics", {
    "now": NOW,
    "records": metrics_records,
    "expected": {"per_sev": per_sev, "overall": overall,
                 "overall_sla_oldest": {"sla_pct": sla, "oldest_days": oldest}},
})

# no-first-seen column → ({}, {})
ps2, ov2 = calculate_mttr(pd.DataFrame([{"severity": "HIGH", "status": "OPEN"}]))
dump("metrics_no_first_seen", {
    "records": [{"severity": "HIGH", "status": "OPEN"}],
    "expected": {"per_sev": ps2, "overall": ov2},
})

# ------------------------------------------------------------------- mttr_from_ledger
ledger_rows = [
    {"severity": "CRITICAL", "first_seen": "2026-06-01T00:00:00Z", "status": "RESOLVED",
     "resolved_at": "2026-06-04T00:00:00Z"},
    {"severity": "CRITICAL", "first_seen": "2026-06-10T00:00:00Z", "status": "OPEN",
     "resolved_at": None},
    {"severity": "HIGH", "first_seen": "2026-05-01T00:00:00Z", "status": "RESOLVED",
     "resolved_at": "2026-05-25T00:00:00Z"},
    {"severity": "HIGH", "first_seen": "2026-02-01T00:00:00Z", "status": "OPEN",
     "resolved_at": None},
    {"severity": "LOW", "first_seen": None, "status": "OPEN", "resolved_at": None},
]
lp, lo = mttr_from_ledger(ledger_rows, now=now_ts)
dump("mttr_from_ledger", {
    "now": NOW, "rows": ledger_rows, "expected": {"per_sev": lp, "overall": lo},
})

# ------------------------------------------------------------------------ domain rules
domain_items = [
    {"name": "Payments", "rules": [
        {"conditions": [{"type": "tag", "key": "team", "value": "payments"}]},
        {"conditions": [{"type": "name_regex", "pattern": "^pay-"}]},
    ]},
    {"name": "Data Platform", "rules": [
        {"conditions": [
            {"type": "subscription", "values": ["data-prod", "555"]},
            {"type": "tag", "key": "env", "value": "prod"},
        ]},
    ]},
    {"name": "AnyTag", "rules": [
        {"conditions": [{"type": "tag", "key": "owner", "value": None}]},
    ]},
    {"name": "BadRegex", "rules": [
        {"conditions": [{"type": "name_regex", "pattern": "("}]},
    ]},
    {"name": "EmptyRule", "rules": [{"conditions": []}]},
]
domain_records = [
    {"vulnerableAsset.name": "pay-gateway-1", "vulnerableAsset.tags.env": "prod"},
    {"vulnerableAsset": {"name": "PAY-batch", "tags": {"team": "PAYMENTS "}}},
    {"vulnerableAsset.name": "etl-1", "vulnerableAsset.subscriptionName": "Data-Prod",
     "vulnerableAsset.tags.env": "PROD"},
    {"vulnerableAsset.name": "etl-2", "vulnerableAsset.subscriptionName": "data-prod",
     "vulnerableAsset.tags.env": "stage"},
    {"vulnerableAsset.name": "misc", "vulnerableAsset.tags.owner": ""},
    {"asset_name": "pay-ledger", "subscription_name": None,
     "tags_json": "{\"team\": \"payments\"}"},
    {"asset_name": "(compacted)"},
    {"asset_name": "etl-3", "subscription_ext_id": "555",
     "tags_json": "{\"env\": \"prod\"}"},
    {"vulnerableAsset.name": "nothing-matches"},
]
compiled = compile_domains(domain_items)
dump("domain_rules", {
    "items": domain_items,
    "records": domain_records,
    "expected": {
        "assignments": [assign_domain(r, compiled) for r in domain_records],
        "names": domain_names(domain_items),
    },
})

invalid_items = [
    "not-a-dict",
    {"name": "  "},
    {"name": "Unassigned", "rules": [{"conditions": [{"type": "tag", "key": "a"}]}]},
    {"name": "A,B", "rules": []},
    {"name": "Dup", "rules": [{"conditions": [{"type": "bogus"}]}]},
    {"name": "dup", "rules": [
        {"conditions": [{"type": "tag", "key": " "}]},
        {"conditions": [{"type": "name_regex", "pattern": "x" * 201}]},
        {"conditions": [{"type": "name_regex", "pattern": "("}]},
        {"conditions": [{"type": "subscription", "values": []}]},
    ]},
]
dump("domain_rules_validate", {
    "items": invalid_items,
    "expected": validate_domains(invalid_items),
})

# --------------------------------------------------------------------------- transform
envelopes = [
    {"data": {"vulnerabilityFindings": {"nodes": [{"id": "a"}, {"id": "b"}]}}},
    {"data": {"somethingElse": {"nodes": [{"id": "c"}]}}},
    {"nodes": [{"id": "d"}]},
    [{"data": {"vulnerabilityFindings": {"nodes": [{"id": "e"}]}}},
     {"data": {"vulnerabilityFindings": {"nodes": [{"id": "f"}]}}}],
    json.dumps({"data": {"vulnerabilityFindings": {"nodes": [{"id": "g"}]}}}),
    None,
    [],
]
dump("extract_nodes", {
    "cases": [{"input": e, "expected": extract_nodes(e)} for e in envelopes],
})

baseline = [{"id": "k1", "v": 1}, {"id": "k2", "v": 1}, {"id": "k3", "v": 1}]
delta = [{"id": "k2", "v": 2}, {"id": "k4", "v": 2}, {"id": "k4", "v": 3}]
dump("merge_nodes", {
    "baseline": baseline, "delta": delta,
    "expected": merge_nodes(baseline, delta),
})

# ------------------------------------------------------------------- severities scope
scope_cases = [
    ["CRITICAL", "HIGH"],
    ["HIGH", "CRITICAL"],
    ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"],
    ["INFORMATIONAL"],
    ["bogus", "HIGH"],
    [],
    None,
]
dump("severities_scope", {
    "serialize": [{"input": s, "expected": serialize_severities(s)} for s in scope_cases],
    "parse": [
        {"input": t, "expected": list(parse_severities(t)) if parse_severities(t) else None}
        for t in ['["CRITICAL","HIGH"]', '["HIGH"]', '["bogus"]', "not-json", "", None,
                  '{"a":1}', '["INFORMATIONAL"]']
    ],
})

# -------------------------------------------------------------------------------- trend
scans_rows = [
    {"scan_id": "s1", "ts": "2026-06-01T06:00:00Z", "shape": "flat"},
    {"scan_id": "s2", "ts": "2026-06-08T06:00:00Z", "shape": "flat"},
    {"scan_id": "sg", "ts": "2026-06-10T06:00:00Z", "shape": "grouped"},
    {"scan_id": "s3", "ts": "2026-06-15T06:00:00Z", "shape": "flat"},
]
base_rows = []
for sev, first, resolved in [
    ("CRITICAL", "2026-05-20T00:00:00Z", "2026-06-05T00:00:00Z"),
    ("CRITICAL", "2026-06-02T00:00:00Z", None),
    ("HIGH", "2026-05-01T00:00:00Z", "2026-06-12T00:00:00Z"),
    ("HIGH", "2026-06-09T00:00:00Z", None),
    ("MEDIUM", "2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z"),
    ("LOW", "2026-06-14T00:00:00Z", None),
    ("UNKNOWN", "2026-06-01T00:00:00Z", None),
]:
    f = pd.Timestamp(first)
    r = pd.Timestamp(resolved) if resolved else pd.NaT
    base_rows.append({
        "severity": sev, "first_seen": first, "resolved_at": resolved,
        "mttr_days": ((r - f).total_seconds() / 86400) if resolved else None,
    })

scans_df = pd.DataFrame(scans_rows)
scans_df["ts"] = pd.to_datetime(scans_df["ts"], utc=True)
base_df = pd.DataFrame(base_rows)
base_df["first_seen"] = pd.to_datetime(base_df["first_seen"], utc=True)
base_df["resolved_at"] = pd.to_datetime(base_df["resolved_at"], utc=True)
base_df["mttr_days"] = base_df["mttr_days"].astype(float)

trend_all = _trend_from_frames(scans_df, base_df).to_dict("records")
trend_scoped = _trend_from_frames(scans_df, base_df, ["CRITICAL", "HIGH"]).to_dict("records")
dump("trend", {
    "scans": scans_rows,
    "base": base_rows,
    "expected": {"all": trend_all, "scoped_critical_high": trend_scoped},
})

print("all fixtures written to", OUT)
