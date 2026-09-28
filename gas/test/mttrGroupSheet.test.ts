// THE MTTR SPLIT'S ROW SHEET, SERVER HALF: a row opened from the split has to be the SAME
// population on both of the sheet's requests as on the row it was opened from.
//
// The sheet (`pages/mttr.js` `openSplitSheet`) asks two endpoints for one row:
// `getMttrGroup` for its remediation by severity and `getRegisterRows` for its findings, each
// with the header scope AND the row's bucket (`pages/_splitSheet.js` `splitSheetRequests`,
// whose own test pins the requests). Three ways that breaks with no error anywhere:
//
//   1. A SUPPORT GROUP LEAKING ACROSS DOMAINS. A group can span domains; the row under a domain
//      scope counted only its part inside that domain. A sheet that asked for the group alone
//      would list — and time — findings from domains the header says are not on screen.
//   2. TWO SPELLINGS OF "(none)" DISAGREEING. The split and `getMttrGroup` say "(none)", the
//      register's group filter says NONE_GROUP; if either side keys the bucket differently the
//      sheet opens on a different set than its row counted.
//   3. A ROW'S FIGURES POISONING THE SCOPE'S. `getMttrGroup` reuses `mttrData`; a row filter
//      read off the params would let one group's figures land in the whole scope's "mttr12"
//      entry. It is an argument, and the recorded cache keys below hold it to that.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RISK_RULE } from "../src/domain/program";
import type { Rec } from "../src/domain/util";
import { NONE_GROUP } from "../../gas_shared/domain/rowGroups";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-01T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const H = vi.hoisted(() => ({
  base: [] as Record<string, unknown>[],
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
  loadScanRows: () => [{ scan_id: "scan-flat", ts: iso(NOW), mode: "full", shape: "flat", total: 1 }],
  loadTrend: () => [],
  latestFlatScanRow: () => null,
}));
vi.mock("../src/server/historyStore", () => ({ loadHistory: () => [] }));
vi.mock("../src/server/findings", () => ({ currentScan: () => null, distinct: () => [] }));
vi.mock("../src/server/settingsStore", () => ({
  getShowNoFix: () => true,
  getIncludeEol: () => true,
  getDomains: () => ({ items: [] }),
  getDisplaySeverities: () => ["CRITICAL", "HIGH"],
  getRiskRule: () => ({ version: 0, rule: { ...DEFAULT_RISK_RULE } }),
  getColdZone: () => ({ mode: "fixed", coldAfterDays: 90, targetSharePct: 20, floorDays: 14 }),
}));
// The subscription → support group join, as the real map resolves it: sub-c maps to nothing,
// which is the "(none)" bucket.
vi.mock("../src/server/supportGroups", () => ({
  attachSupportGroups: (rows: Rec[]) => {
    const MAP: Record<string, string> = { "sub-a": "Platform SRE", "sub-b": "Payments Ops" };
    for (const r of rows) {
      const sg = MAP[String(r["subscription_ext_id"] ?? "")];
      if (sg) r["_supportGroup"] = sg;
    }
  },
}));
// The Wiz/Domain tag, read off a fixture-only `biz` field. A row without one resolves by rule
// (none configured → Unassigned) or, with no attribution input at all, to Not attributable.
vi.mock("../src/server/bizDomains", () => ({
  attachBizDomains: (rows: Rec[]) => {
    for (const r of rows) r["_bizDomain"] = String(r["biz"] ?? "");
  },
}));
vi.mock("../src/server/errorLog", () => ({ recordError: () => {}, recentErrors: () => [] }));

import { getMttr, getMttrGroup, getMttrPage, getRegisterRows } from "../src/server/api";

let seq = 0;
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    vuln_key: "k" + seq,
    cve: "CVE-2026-" + String(1000 + seq),
    severity: "HIGH",
    asset_id: "asset-1",
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

/** `openSplitSheet`'s two requests for one row — the same shape `splitSheetRequests` builds. */
function sheetRequests(dimension: string, group: string, scope: Rec) {
  const column = { domain: "domain", supportGroup: "support_group", asset: "asset_name" }[dimension]!;
  const none = dimension !== "domain" && group === "(none)";
  const base = { domain: scope["domain"] ?? "", supportGroup: scope["supportGroup"] ?? "", severities: null };
  return {
    mttr: { ...base, groupBy: dimension, groupValue: group },
    register: { ...base, groupBy: column, groupValue: none ? NONE_GROUP : group },
  };
}

/** Assert every row of the split opens on exactly its own population, on both requests. */
function expectRowsMatchSheets(scope: Rec, expectDimension: string) {
  const { dimension, rows } = splitRows(scope);
  expect(dimension).toBe(expectDimension);
  expect(rows.length).toBeGreaterThan(1);
  for (const r of rows) {
    const group = String(r["group"]);
    const open = Number(r["open"] ?? 0);
    const closed = Number(r["resolved"] ?? 0);
    const req = sheetRequests(dimension, group, scope);

    const mttr = ok<Rec>(getMttrGroup(req.mttr));
    const perSev = (mttr["perSev"] ?? {}) as Record<string, Rec>;
    const sevOpen = Object.values(perSev).reduce((a, s) => a + Number(s["open"] ?? 0), 0);
    expect(mttr["rowCount"], `${group}: per-severity population`).toBe(open + closed);
    expect(sevOpen, `${group}: per-severity open`).toBe(open);

    const all = ok<Rec>(getRegisterRows({ ...req.register, status: "all" }));
    const openList = ok<Rec>(getRegisterRows({ ...req.register, status: "open" }));
    expect(all["total"], `${group}: findings listed`).toBe(open + closed);
    expect(openList["total"], `${group}: open findings listed`).toBe(open);
  }
}

beforeEach(() => {
  // Open ages are wall-clock relative; a pinned clock lets two calls compare byte for byte.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  H.base = [];
  H.keys = [];
  H.version += 1;
  seq = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a split row's sheet opens on exactly the row's population", () => {
  it("by domain — a tagged domain, Unassigned and Not attributable", () => {
    H.base = [
      ...times(3, () => row()),
      ...times(2, () => resolved()),
      ...times(2, () => row({ biz: "", subscription_ext_id: "sub-b" })),
      ...times(1, () => resolved({ biz: "", subscription_ext_id: "sub-b" })),
      // Compacted history: no name, no subscription, no tags — Not attributable, resolved only.
      ...times(2, () => resolved({
        biz: "", asset_name: "(compacted)", asset_id: null,
        subscription_name: null, subscription_ext_id: null,
      })),
    ];
    const groups = splitRows({}).rows.map((r) => r["group"]);
    expect(groups).toEqual(expect.arrayContaining(["Payments", "Unassigned", "Not attributable"]));
    expectRowsMatchSheets({}, "domain");
  });

  // THE CASE THE FEATURE WAS ASKED FOR: under a domain scope, only that domain's support
  // groups — on the table and on every sheet opened from it.
  it("by support group inside a domain — never the group's findings in another domain", () => {
    H.base = [
      ...times(3, () => row({ subscription_ext_id: "sub-a" })),
      ...times(2, () => resolved({ subscription_ext_id: "sub-a" })),
      ...times(2, () => row({ subscription_ext_id: "sub-b" })),
      ...times(2, () => row({ subscription_ext_id: "sub-c" })), // maps to no group → (none)
      // Platform SRE in ANOTHER domain: must reach neither the row nor its sheet.
      ...times(5, () => row({ subscription_ext_id: "sub-a", biz: "Retail" })),
      ...times(4, () => resolved({ subscription_ext_id: "sub-a", biz: "Retail" })),
    ];
    const { rows } = splitRows({ domain: "Payments" });
    expect(rows.map((r) => r["group"])).toEqual(["Platform SRE", "Payments Ops", "(none)"]);
    expect(rows[0]!["open"]).toBe(3);
    expectRowsMatchSheets({ domain: "Payments" }, "supportGroup");
  });

  it("by asset inside a support group, the nameless (none) bucket included", () => {
    H.base = [
      ...times(3, () => row({ asset_name: "host-01" })),
      ...times(1, () => resolved({ asset_name: "host-01" })),
      ...times(2, () => row({ asset_name: "host-02" })),
      ...times(2, () => row({ asset_name: null })),
      // Same host name under another support group: not this group's asset.
      ...times(4, () => row({ asset_name: "host-01", subscription_ext_id: "sub-b" })),
    ];
    expectRowsMatchSheets({ supportGroup: "Platform SRE" }, "asset");
  });
});

describe("getMttrGroup", () => {
  it("refuses a dimension it does not know rather than widening to the scope", () => {
    H.base = [row()];
    const res = getMttrGroup({ groupBy: "subscription", groupValue: "sub-a" });
    expect(res.ok).toBe(false);
  });

  it("serves a domain row from the scope's own entry — it IS that header scope", () => {
    H.base = [row(), row({ biz: "Retail" })];
    ok(getMttrGroup({ groupBy: "domain", groupValue: "Payments" }));
    expect(H.keys.map((k) => k.ns)).toEqual(["mttr12"]);
    expect(H.keys[0]!.params["domain"]).toBe("Payments");
  });

  // Spec 3 of the header: a row request must never compute into "mttr12", and "mttr12" must
  // answer exactly as it did without the row — same key, same payload.
  it("keeps a group row out of the scope's entry and leaves getMttr unchanged", () => {
    H.base = [
      ...times(3, () => row({ subscription_ext_id: "sub-a" })),
      ...times(2, () => row({ subscription_ext_id: "sub-b" })),
    ];
    const before = ok(getMttr({ domain: "Payments" }));
    H.keys = [];
    ok(getMttrGroup({ domain: "Payments", groupBy: "supportGroup", groupValue: "Platform SRE" }));
    expect(H.keys.map((k) => k.ns)).toEqual(["mttrGroup2"]);
    expect(H.keys[0]!.params).toMatchObject({
      domain: "Payments", supportGroup: "", groupBy: "supportGroup", groupValue: "Platform SRE",
    });
    H.keys = [];
    expect(ok(getMttr({ domain: "Payments", groupBy: "supportGroup", groupValue: "Platform SRE" })))
      .toEqual(before);
    expect(H.keys.map((k) => k.params)).toEqual([expect.not.objectContaining({ groupBy: expect.anything() })]);
  });
});

// WHY A GROUP IS LISTED UNDER A DOMAIN. A support group has no domain of its own — each finding
// takes its asset's — so the sheet shows the spread across EVERY domain, with the route (tag or
// rule) and the assets, not just the slice the header domain selected.
describe("getMttrGroup — the domains a row's findings resolve to", () => {
  const domainsOf = (p: Rec) => (ok<Rec>(getMttrGroup(p))["domains"] ?? []) as Rec[];

  it("lists every domain a support group spans, ignoring the header domain", () => {
    H.base = [
      ...times(3, () => row({ subscription_ext_id: "sub-a", asset_name: "pay-01" })),
      ...times(2, () => resolved({ subscription_ext_id: "sub-a", asset_name: "pay-01" })),
      ...times(4, () => row({ subscription_ext_id: "sub-a", biz: "Retail", asset_name: "shop-01" })),
      ...times(1, () => row({ subscription_ext_id: "sub-a", biz: "Retail", asset_name: "shop-02" })),
      // Untagged, no rule configured: Unassigned, by no route at all.
      ...times(1, () => row({ subscription_ext_id: "sub-a", biz: "", asset_name: "misc-01" })),
      // Another group's findings in Payments: not this row's.
      ...times(6, () => row({ subscription_ext_id: "sub-b" })),
    ];
    const domains = domainsOf({
      domain: "Payments", groupBy: "supportGroup", groupValue: "Platform SRE",
    });
    // Most findings first; a tie (five each here) falls back to the domain's name.
    expect(domains).toEqual([
      { domain: "Payments", source: "tag", findings: 5, open: 3, assetCount: 1, assets: ["pay-01"] },
      { domain: "Retail", source: "tag", findings: 5, open: 5, assetCount: 2, assets: ["shop-01", "shop-02"] },
      { domain: "Unassigned", source: "none", findings: 1, open: 1, assetCount: 1, assets: ["misc-01"] },
    ]);
    // The row itself still counts only its Payments slice.
    const payRow = splitRows({ domain: "Payments" }).rows.find((r) => r["group"] === "Platform SRE")!;
    expect(payRow["open"]).toBe(3);
  });

  it("an asset row: its findings' domains, inside the support group it was drawn under", () => {
    H.base = [
      ...times(2, () => row({ asset_name: "host-01" })),
      ...times(1, () => row({ asset_name: "host-01", biz: "Retail" })),
      // Same name under another support group: not this asset row.
      ...times(4, () => row({ asset_name: "host-01", subscription_ext_id: "sub-b", biz: "Other" })),
    ];
    const domains = domainsOf({
      supportGroup: "Platform SRE", groupBy: "asset", groupValue: "host-01",
    });
    expect(domains.map((d) => [d["domain"], d["findings"]])).toEqual([["Payments", 2], ["Retail", 1]]);
  });

  it("carries nothing for a domain row — it IS a domain", () => {
    H.base = [row()];
    expect(ok<Rec>(getMttrGroup({ groupBy: "domain", groupValue: "Payments" }))["domains"]).toBeUndefined();
  });
});
