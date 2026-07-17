// Actionable-clock derivations in baseRows/withDerived (ledgerCore.ts). The SLA/MTTR
// clock starts when a vendor fix is available, not at detection; awaiting-vendor-fix
// rows carry null actionable fields so they drop out of every clock. REMEDIATION_ROLLOUT_ISO
// is "2026-07-01T00:00:00Z" — rows first seen before it are legacy (fix available as of
// first_seen by construction of the old hasFix-only filter).

import { describe, expect, it } from "vitest";
import { baseRows, emptyState, type LedgerState } from "../src/domain/ledgerCore";
import type { LedgerRow } from "../src/domain/reconcile";

const NOW = Date.parse("2026-07-25T00:00:00Z");

function row(over: Partial<LedgerRow>): LedgerRow {
  return {
    vuln_key: "id:x", cve: "CVE-2026-1", severity: "HIGH", asset_id: null,
    asset_name: null, asset_type: null, cloud: null, first_seen: null, last_seen: null,
    status: "OPEN", resolved_at: null, resolution_src: null, reopened_count: 0,
    first_scan_id: null, last_scan_id: null, subscription_name: null,
    subscription_ext_id: null, tags_json: null, fix_date: null, fix_observed_at: null,
    ...over,
  };
}

function derive(over: Partial<LedgerRow>) {
  const state: LedgerState = emptyState();
  const r = row({ ...over, vuln_key: "id:x" });
  state.ledger["id:x"] = r;
  return baseRows(state, NOW)[0];
}

describe("withDerived actionable clock", () => {
  it("legacy resolved: fix available as of first_seen; mttr from first_seen", () => {
    const d = derive({
      first_seen: "2026-05-01T00:00:00Z",
      status: "RESOLVED",
      resolved_at: "2026-05-10T00:00:00Z",
    });
    expect(d.fix_available_at).toBe("2026-05-01T00:00:00Z");
    expect(d.actionable_from).toBe("2026-05-01T00:00:00Z");
    expect(d.mttr_actionable_days).toBeCloseTo(9, 6);
    expect(d.actionable_age_days).toBeNull();
    expect(d.awaiting_vendor_fix).toBe(false);
  });

  it("legacy open: not awaiting; actionable age runs from first_seen", () => {
    const d = derive({ first_seen: "2026-06-01T00:00:00Z", status: "OPEN" });
    expect(d.fix_available_at).toBe("2026-06-01T00:00:00Z");
    expect(d.actionable_from).toBe("2026-06-01T00:00:00Z");
    expect(d.awaiting_vendor_fix).toBe(false);
    expect(d.actionable_age_days).toBeCloseTo(54, 6); // 2026-06-01 → 2026-07-25
    expect(d.mttr_actionable_days).toBeNull();
  });

  it("post-rollout awaiting: no fix available → null actionable fields, flagged awaiting", () => {
    const d = derive({ first_seen: "2026-07-10T00:00:00Z", status: "OPEN" });
    expect(d.fix_available_at).toBeNull();
    expect(d.actionable_from).toBeNull();
    expect(d.mttr_actionable_days).toBeNull();
    expect(d.actionable_age_days).toBeNull();
    expect(d.awaiting_vendor_fix).toBe(true);
  });

  it("late-fix clamp: fix appears after detection → clock starts at the fix", () => {
    const d = derive({
      first_seen: "2026-07-05T00:00:00Z",
      status: "RESOLVED",
      resolved_at: "2026-07-20T00:00:00Z",
      fix_date: "2026-07-12T00:00:00Z",
      fix_observed_at: "2026-07-11T00:00:00Z",
    });
    expect(d.fix_available_at).toBe("2026-07-12T00:00:00Z");
    expect(d.actionable_from).toBe("2026-07-12T00:00:00Z");
    expect(d.mttr_actionable_days).toBeCloseTo(8, 6); // 07-12 → 07-20
    expect(d.awaiting_vendor_fix).toBe(false);
  });

  it("fix-before-detection clamp: clock never starts before first_seen", () => {
    const d = derive({
      first_seen: "2026-07-10T00:00:00Z",
      status: "RESOLVED",
      resolved_at: "2026-07-15T00:00:00Z",
      fix_date: "2026-07-02T00:00:00Z", // fix predates our detection
    });
    expect(d.fix_available_at).toBe("2026-07-02T00:00:00Z");
    expect(d.actionable_from).toBe("2026-07-10T00:00:00Z"); // clamped to detection
    expect(d.mttr_actionable_days).toBeCloseTo(5, 6); // 07-10 → 07-15
  });

  it("post-rollout row whose fix was only observed (fixedVersion, no fixDate)", () => {
    const d = derive({
      first_seen: "2026-07-05T00:00:00Z",
      status: "OPEN",
      fix_observed_at: "2026-07-09T00:00:00Z",
    });
    expect(d.fix_available_at).toBe("2026-07-09T00:00:00Z");
    expect(d.actionable_from).toBe("2026-07-09T00:00:00Z"); // max(07-05, 07-09)
    expect(d.awaiting_vendor_fix).toBe(false);
    expect(d.actionable_age_days).toBeCloseTo(16, 6); // 07-09 → 07-25
  });

  it("rehydrated episode carries fix_date/fix_observed_at into the derivation", () => {
    const state: LedgerState = emptyState();
    state.episodes.push({
      vuln_key: "id:ep", cve: "CVE-2026-9", severity: "HIGH",
      first_seen: "2026-07-04T00:00:00Z", resolved_at: "2026-07-18T00:00:00Z",
      resolution_src: "api", reopened_count: 0, compaction_id: "cmp",
      superseded_by_scan: null, fix_date: "2026-07-10T00:00:00Z",
      fix_observed_at: "2026-07-08T00:00:00Z",
    });
    const d = baseRows(state, NOW).find((r) => r.vuln_key === "id:ep")!;
    expect(d.fix_available_at).toBe("2026-07-10T00:00:00Z"); // post-rollout → fix_date
    expect(d.actionable_from).toBe("2026-07-10T00:00:00Z");
    expect(d.mttr_actionable_days).toBeCloseTo(8, 6); // 07-10 → 07-18
    expect(d.awaiting_vendor_fix).toBe(false);
  });
});
