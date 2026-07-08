// End-to-end wiring for the Support Group feature: a refreshed subscription→group map
// flows through attachSupportGroups onto records, then drives filtering (findings),
// grouping (insights), and domain assignment (the support_group condition) — the three
// surfaces the UI exposes. settingsStore is mocked so no GAS globals are needed.

import { beforeEach, describe, expect, it, vi } from "vitest";

// A fixed map stands in for a refreshed graphSearch result.
const MAP = {
  "prod-account": "CS-CORE",
  "111122223333": "CS-CORE",
  "dev-account": "CS-SANDBOX",
  "core-prod": "CS-SUPPLY-MONITORING",
};

vi.mock("../src/server/settingsStore", () => ({
  getSupportGroupMap: () => ({ version: 1, map: MAP }),
}));

import { attachSupportGroups } from "../src/server/supportGroups";
import { applyFilters, distinct } from "../src/server/findings";
import { groupTree } from "../src/domain/insights";
import { assignDomain, compileDomains } from "../src/domain/domainRules";

// Frame-shaped records (dotted keys), the shape findings.currentScan produces.
function frame() {
  return [
    { _sev: "CRITICAL", status: "OPEN", "vulnerableAsset.name": "web-prod-01",
      "vulnerableAsset.subscriptionName": "prod-account" },
    { _sev: "HIGH", status: "OPEN", "vulnerableAsset.name": "db-replica-02",
      "vulnerableAsset.subscriptionExternalId": "111122223333" },
    { _sev: "LOW", status: "RESOLVED", "vulnerableAsset.name": "dev-box-03",
      "vulnerableAsset.subscriptionName": "dev-account" },
    { _sev: "MEDIUM", status: "OPEN", "vulnerableAsset.name": "etl-04",
      "vulnerableAsset.subscriptionName": "core-prod" },
    { _sev: "HIGH", status: "OPEN", "vulnerableAsset.name": "orphan-05",
      "vulnerableAsset.subscriptionName": "unmapped-sub" },
  ];
}

describe("support-group end-to-end wiring", () => {
  let records: ReturnType<typeof frame>;
  beforeEach(() => {
    records = frame();
    attachSupportGroups(records as unknown as Record<string, unknown>[]);
  });

  it("attaches _supportGroup by subscription name and external id", () => {
    expect(records.map((r) => (r as Record<string, unknown>)["_supportGroup"] ?? null)).toEqual([
      "CS-CORE", "CS-CORE", "CS-SANDBOX", "CS-SUPPLY-MONITORING", null,
    ]);
  });

  it("surfaces the joined groups as sorted filter options", () => {
    expect(distinct(records as unknown as Record<string, unknown>[], "_supportGroup")).toEqual([
      "CS-CORE", "CS-SANDBOX", "CS-SUPPLY-MONITORING",
    ]);
  });

  it("filters findings to selected support groups", () => {
    const kept = applyFilters(records as unknown as Record<string, unknown>[], {
      supportGroups: ["CS-CORE", "CS-SUPPLY-MONITORING"],
    });
    expect(kept.map((r) => r["vulnerableAsset.name"])).toEqual([
      "web-prod-01", "db-replica-02", "etl-04",
    ]);
  });

  it("groups findings by support group (breakdown dimension)", () => {
    const tree = groupTree(records as unknown as Record<string, unknown>[], ["supportGroup"]);
    const byKey = Object.fromEntries(tree.map((n) => [n.key, n.total]));
    expect(byKey["CS-CORE"]).toBe(2);
    expect(byKey["CS-SUPPLY-MONITORING"]).toBe(1);
    expect(byKey["(none)"]).toBe(1); // the unmapped subscription
  });

  it("assigns a domain from a support_group condition on the attached field", () => {
    const compiled = compileDomains([
      { name: "Supply Monitoring", rules: [
        { conditions: [{ type: "support_group", values: ["CS-SUPPLY-MONITORING"] }] },
      ] },
    ]);
    const assigned = records.map((r) => assignDomain(r as unknown as Record<string, unknown>, compiled));
    expect(assigned).toEqual([
      "Unassigned", "Unassigned", "Unassigned", "Supply Monitoring", "Unassigned",
    ]);
  });
});
