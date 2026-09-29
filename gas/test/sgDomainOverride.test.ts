// SUPPORT GROUP → DOMAIN OVERRIDES (settings `supportGroupDomains`, currentDomain.ts rule 3).
// An admin corrects a group the host vote put in the wrong domain — or confirms a group that
// sits in CROSS on purpose because the CROSS team runs its hosts — and every page follows.
//
// Mocks as in mttrGroupSheet.test.ts, plus a stateful overrides store, the lock and the admin gate.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RISK_RULE } from "../src/domain/program";
import type { Rec } from "../src/domain/util";
import { NONE_GROUP } from "../../gas_shared/domain/rowGroups";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-01T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const H = vi.hoisted(() => ({
  base: [] as Record<string, unknown>[],
  /** The stored overrides, and whether the caller is an admin. */
  sgd: [] as Record<string, unknown>[],
  admin: true,
  keys: [] as { ns: string; params: Record<string, unknown> }[],
  version: 0,
}));

vi.mock("../src/server/sheetsDb", () => ({
  TABS: { scans: { name: "scans", headers: [] }, vulnLedger: { name: "vuln_ledger", headers: [] } },
  TAB_HEADERS: {}, SCHEMA_VERSION: 1,
  readAll: () => [], readTail: () => [], overwrite: () => {}, appendRows: () => {},
  cellUsage: () => ({ total: 0, tabs: {} }), ensureTabs: () => {},
}));
// A passthrough that RECORDS, so every spec recomputes and spec 3 can read the keys.
vi.mock("../src/server/serverCache", () => ({
  BUILD_ID: "test",
  cached: (ns: string, params: unknown, compute: () => unknown) => {
    H.keys.push({ ns, params: params as Record<string, unknown> });
    return compute();
  },
  dataVersion: () => String(H.version),
  currentStamp: () => "stamp-" + H.version,
}));
vi.mock("../src/server/readModelStore", () => ({
  durablyCached: (_ns: string, _params: unknown, compute: () => unknown) => compute(),
  duringWarm: <T,>(fn: () => T): T => fn(),
  sweepReadModels: () => 0,
}));
vi.mock("../src/server/ledgerStore", () => ({
  loadBaseRows: () => H.base.map((r) => ({ ...r })),
  readBaseRows: () => H.base.map((r) => ({ ...r })),
  loadScanRows: () => [{ scan_id: "scan-flat", ts: iso(NOW), mode: "full", shape: "flat", total: 1 }],
  loadTrend: () => [],
  latestFlatScanRow: () => null,
}));
vi.mock("../src/server/historyStore", () => ({ loadHistory: () => [] }));
vi.mock("../src/server/findings", () => ({
  currentScan: () => null, distinct: () => [], invalidateFrameMemo: () => {},
}));
vi.mock("../src/server/settingsStore", () => ({
  getShowNoFix: () => true,
  getIncludeEol: () => true,
  getDomains: () => ({ items: [] }),
  getSupportGroupDomains: () => ({ version: 0, items: H.sgd }),
  // The real store bumps the data version on save; the mock bumps the stamp the same way.
  setSupportGroupDomains: (items: Record<string, unknown>[]) => { H.sgd = items; H.version += 1; },
  getDisplaySeverities: () => ["CRITICAL", "HIGH"],
  getRiskRule: () => ({ version: 0, rule: { ...DEFAULT_RISK_RULE } }),
  getColdZone: () => ({ mode: "fixed", coldAfterDays: 90, targetSharePct: 20, floorDays: 14 }),
}));
// The subscription → support group join, as the real map resolves it: sub-c maps to nothing,
// which is the "(none)" bucket.
vi.mock("../src/server/supportGroups", () => {
  const m = {
  attachSupportGroups: (rows: Rec[]) => {
    const MAP: Record<string, string> = { "sub-a": "Platform SRE", "sub-b": "Payments Ops", "sub-d": "Retail Ops" };
    for (const r of rows) {
      const sg = MAP[String(r["subscription_ext_id"] ?? "")];
      if (sg) r["_supportGroup"] = sg;
    }
  },
};
  // The read-only per-row lookup currentDomains uses: the same fake join, answered
  // on a copy rather than written onto the row.
  return { ...m, supportGroupResolver: () => (r: Rec) => {
    const probe: Rec = { ...r };
    delete probe["_supportGroup"];
    m.attachSupportGroups([probe]);
    return String(probe["_supportGroup"] ?? "");
  } };
});
// The Wiz/Domain tag, read off a fixture-only `biz` field. A row without one resolves by rule
// (none configured → Unassigned) or, with no attribution input at all, to Not attributable.
vi.mock("../src/server/bizDomains", () => ({
  configuredDomainTagKey: () => "Wiz/Domain",
  attachBizDomains: (rows: Rec[]) => {
    for (const r of rows) r["_bizDomain"] = String(r["biz"] ?? "");
  },
}));
vi.mock("../src/server/errorLog", () => ({ recordError: () => {}, recentErrors: () => [] }));

vi.mock("../src/server/locks", () => ({
  LedgerBusyError: class extends Error {},
  withScriptLock: <T,>(fn: () => T): T => fn(),
  recoverIfNeeded: () => {},
}));
// The admin gate is the one thing under test from access.ts; everything else stays real.
vi.mock("../src/server/access", async (orig) => ({
  ...(await orig<typeof import("../src/server/access")>()),
  canEditUsers: () => H.admin,
  check: () => ({ allowed: true, email: "admin@example.com", reason: H.admin ? "admin" : "listed" }),
}));

import { getMttrGroup, getMttrPage, getRegisterRows, saveSupportGroupDomain } from "../src/server/api";

let seq = 0;
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    vuln_key: "k" + seq,
    cve: "CVE-2026-" + String(1000 + seq),
    severity: "HIGH",
    asset_name: "host-01",
    asset_type: "VIRTUAL_MACHINE",
    cloud: "AWS",
    first_seen: iso(NOW - 300 * DAY),
    last_seen: iso(NOW),
    status: "OPEN",
    resolved_at: null,
    resolution_src: null,
    reopened_count: 0,
    first_scan_id: "scan-flat",
    last_scan_id: "scan-flat",
    subscription_name: "sub-a",
    subscription_ext_id: "sub-a",
    has_kev: false,
    has_exploit: false,
    epss: 0,
    observed: true,
    seen_age_days: null,
    biz: "Payments",
    ...over,
    // One asset per NAME unless a spec says otherwise — the current-domain rules key on the
    // asset, so a fixture where every row shared one `asset_id` would be one host.
    asset_id: "asset_id" in over ? over["asset_id"] : (over["asset_name"] === null ? null
      : "id-" + String(over["asset_name"] ?? "host-01")),
  };
}
const resolved = (over: Record<string, unknown> = {}) => row({
  status: "RESOLVED",
  first_seen: iso(NOW - 60 * DAY),
  resolved_at: iso(NOW - 30 * DAY),
  mttr_days: 30,
  ...over,
});
const times = (n: number, make: () => Record<string, unknown>) => Array.from({ length: n }, make);

function ok<T = Rec>(res: { ok: boolean; data?: unknown; error?: string }): T {
  expect(res.error ?? "", "endpoint threw").toBe("");
  expect(res.ok).toBe(true);
  return res.data as T;
}

function splitRows(scope: Rec): { dimension: string; rows: Rec[] } {
  const byDomain = ok<Rec>(getMttrPage(scope))["byDomain"] as Rec;
  return { dimension: String(byDomain["dimension"]), rows: byDomain["rows"] as Rec[] };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  H.base = [];
  H.keys = [];
  H.sgd = [];
  H.admin = true;
  H.version += 1;
  seq = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// Platform SRE: two hosts in Retail, one in Payments → the vote pins it to Retail.
function estate() {
  H.base = [
    ...times(2, () => row({ subscription_ext_id: "sub-a", asset_name: "pay-01" })),
    ...times(3, () => row({ subscription_ext_id: "sub-a", biz: "Retail", asset_name: "shop-01" })),
    ...times(1, () => row({ subscription_ext_id: "sub-a", biz: "Retail", asset_name: "shop-02" })),
    ...times(2, () => row({ subscription_ext_id: "sub-b", asset_name: "ops-01" })),
    ...times(1, () => row({ subscription_ext_id: "sub-d", biz: "Retail", asset_name: "shop-09" })),
    ...times(1, () => row({ subscription_ext_id: "sub-c", biz: "CROSS", asset_name: "x-01" })),
  ];
}
const groupsUnder = (domain: string) => splitRows({ domain }).rows.map((r) => r["group"]);
const domainsOfGroup = (g: string) => new Set(
  (ok<Rec>(getRegisterRows({ status: "all", groupBy: "support_group", groupValue: g }))["rows"] as Rec[])
    .map((r) => r["domain"]));

describe("saveSupportGroupDomain", () => {
  it("moves the group, with every finding it carries, to the domain an admin sets", () => {
    estate();
    expect(groupsUnder("Retail")).toContain("Platform SRE");
    const res = ok<Rec>(saveSupportGroupDomain({ group: "Platform SRE", domain: "Payments", reason: "wrong_tag" }));
    expect(res["saved"]).toBe(true);
    expect(groupsUnder("Retail")).not.toContain("Platform SRE");
    expect(groupsUnder("Payments")).toContain("Platform SRE");
    expect(domainsOfGroup("Platform SRE")).toEqual(new Set(["Payments"]));
    expect(ok<Rec>(getMttrGroup({ domain: "Payments", groupBy: "supportGroup", groupValue: "Platform SRE" }))["countedDomain"])
      .toBe("Payments");
  });

  it("records who set it, when, and why", () => {
    estate();
    ok(saveSupportGroupDomain({ group: "Platform SRE", domain: "Retail", reason: "cross_team", note: "run by CROSS" }));
    expect(H.sgd).toEqual([expect.objectContaining({
      group: "Platform SRE", domain: "Retail", reason: "cross_team", note: "run by CROSS",
      by: "admin@example.com", at: new Date(NOW).toISOString(),
    })]);
  });

  it("resets to the automatic domain with domain: null", () => {
    estate();
    ok(saveSupportGroupDomain({ group: "Platform SRE", domain: "Payments", reason: "wrong_tag" }));
    ok(saveSupportGroupDomain({ group: "Platform SRE", domain: null }));
    expect(H.sgd).toEqual([]);
    expect(domainsOfGroup("Platform SRE")).toEqual(new Set(["Retail"]));
  });

  it("keeps one override per group — a second save replaces the first", () => {
    estate();
    ok(saveSupportGroupDomain({ group: "Platform SRE", domain: "Payments", reason: "wrong_tag" }));
    ok(saveSupportGroupDomain({ group: "Platform SRE", domain: "CROSS", reason: "cross_team" }));
    expect(H.sgd.map((o) => [o["group"], o["domain"]])).toEqual([["Platform SRE", "CROSS"]]);
  });

  it("refuses a caller who is not an admin, and stores nothing", () => {
    estate();
    H.admin = false;
    const res = saveSupportGroupDomain({ group: "Platform SRE", domain: "Payments", reason: "wrong_tag" });
    expect(res.ok).toBe(false);
    expect(H.sgd).toEqual([]);
  });

  it("refuses a domain no finding can land in, the two tails, and a missing reason", () => {
    estate();
    for (const bad of [
      { group: "Platform SRE", domain: "Nowhere", reason: "wrong_tag" },
      { group: "Platform SRE", domain: "Unassigned", reason: "wrong_tag" },
      { group: "Platform SRE", domain: "Not attributable", reason: "wrong_tag" },
      { group: "Platform SRE", domain: "Payments", reason: "because" },
      { group: "", domain: "Payments", reason: "wrong_tag" },
    ]) {
      const res = ok<Rec>(saveSupportGroupDomain(bad));
      expect(res["saved"], JSON.stringify(bad)).toBe(false);
      expect((res["errors"] as string[]).length).toBeGreaterThan(0);
    }
    expect(H.sgd).toEqual([]);
  });
});
