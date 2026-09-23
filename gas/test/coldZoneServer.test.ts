// THE COLD ZONE'S SERVER HALF: the ledger clock, the per-severity observation map, the durable
// cache key and the two endpoints that read them.
//
// `domain/coldZone.ts` is tested by hand cases against a clock the test hands it. Nothing there
// can catch the four ways this layer breaks instead, and every one of them is silent:
//
//   1. A CACHE KEY THAT OMITS A FIELD THE COMPUTE READS. `durablyCached` has NO TTL, so a
//      missing field does not go stale for an hour — it answers with the old value until some
//      later commit happens to rewrite the file. An operator who switches to relative mode and
//      reloads would read the fixed mode's verdicts back, forever, with no symptom.
//   2. A WALL CLOCK WEARING A LEDGER'S LABEL. Every figure in this model is "how long since
//      something happened". Dated by `Date.now()` it would grow each time the page was opened,
//      and a register nobody had synced would drift into the cold zone on its own.
//   3. A GROUPED SCAN COUNTED AS AN OBSERVATION. Grouped scans write no per-finding
//      observations at all, so one would mark a whole estate "still seen" on the strength of a
//      row that never looked at a finding.
//   4. THE EXECUTIVE SHIPPING THE WHOLE PROFILE. The card draws one number out of the totals;
//      the per-asset and per-group arrays are the Cold zone page's, and a landing page carrying
//      them pays for them on every load.

import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RISK_RULE } from "../src/domain/program";
import { newestFlatScanBySeverity, type ScanRow } from "../src/domain/ledgerCore";
import type { Rec } from "../src/domain/util";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-01T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const H = vi.hoisted(() => ({
  base: [] as Record<string, unknown>[],
  scans: [] as Record<string, unknown>[],
  cold: { mode: "fixed", coldAfterDays: 90, targetSharePct: 20, floorDays: 14 },
  ruleVersion: 0,
  version: 0,
  // Every params object `durablyCached` was handed this run, in call order.
  keys: [] as { ns: string; params: Rec }[],
  // When set, the cold-zone compute fails the way a Drive service error makes it fail.
  coldThrows: false,
  // Operation labels `errorLog.recordError` was handed this run.
  recorded: [] as string[],
  // What `durablyPeek` finds stored, by namespace — empty means every entry is cold.
  peek: new Map<string, unknown>(),
}));

// Sheets/Drive never load: this file is about the read model, and api.ts's import graph reaches
// both. Same treatment as test/registerRows.test.ts.
vi.mock("../src/server/sheetsDb", () => ({
  TABS: { scans: { name: "scans", headers: [] }, vulnLedger: { name: "vuln_ledger", headers: [] } },
  TAB_HEADERS: {}, SCHEMA_VERSION: 1,
  readAll: () => [], readTail: () => [], overwrite: () => {}, appendRows: () => {},
  cellUsage: () => ({ total: 0, tabs: {} }), ensureTabs: () => {},
}));

// `cached` is a passthrough so every spec recomputes. `dataVersion` is REAL state here rather
// than a constant, because the two memos under test key on it — a fake that never moved would
// let one spec's clock answer the next spec's question.
vi.mock("../src/server/serverCache", () => ({
  BUILD_ID: "test",
  cached: (_ns: string, _params: unknown, compute: () => unknown) => compute(),
  currentStamp: () => "stamp-" + H.version,
  dataVersion: () => String(H.version),
}));

// The durable layer, recording every key before computing — this is what spec 1 above reads.
vi.mock("../src/server/readModelStore", () => ({
  durablyCached: (ns: string, params: unknown, compute: () => unknown) => {
    H.keys.push({ ns, params: params as Rec });
    if (ns === "coldZone1" && H.coldThrows) throw new Error("Erreur liée à un service : Drive");
    return compute();
  },
  durablyPeek: (ns: string) => H.peek.get(ns),
  duringWarm: <T,>(fn: () => T): T => fn(),
  sweepReadModels: () => 0,
}));

vi.mock("../src/server/ledgerStore", () => ({
  loadBaseRows: () => H.base.map((r) => ({ ...r })),
  loadScanRows: () => H.scans.map((r) => ({ ...r })),
  latestFlatScanRow: () => null,
}));
vi.mock("../src/server/findings", () => ({ currentScan: () => null, distinct: () => [] }));
vi.mock("../src/server/settingsStore", () => ({
  getShowNoFix: () => true,
  getIncludeEol: () => true,
  getDomains: () => ({ items: [] }),
  getDisplaySeverities: () => ["CRITICAL", "HIGH"],
  getRiskRule: () => ({ version: H.ruleVersion, rule: { ...DEFAULT_RISK_RULE } }),
  getColdZone: () => ({ ...H.cold }),
}));
// The live join: `_supportGroup` is not a ledger column, so a row carries whatever the map
// says. `owner_sg` here stands in for the map so a spec can put two assets in one group.
vi.mock("../src/server/supportGroups", () => ({
  attachSupportGroups: (rows: Rec[]) => {
    for (const r of rows) r["_supportGroup"] = String(r["owner_sg"] ?? "");
  },
}));
vi.mock("../src/server/bizDomains", () => ({
  attachBizDomains: (rows: Rec[]) => { for (const r of rows) r["_bizDomain"] = ""; },
}));
vi.mock("../src/server/errorLog", () => ({
  recordError: (op: string) => { H.recorded.push(op); },
  recentErrors: () => [],
}));

import { bootstrapIfWarm, getColdZonePage, getExecutivePage, warmReadModels } from "../src/server/api";

// --------------------------------------------------------------------------------------- //
//  Fixture
// --------------------------------------------------------------------------------------- //

/** One finding on an asset, open unless `resolvedAt` says otherwise. */
function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    vuln_key: "k",
    cve: "CVE-2026-0001",
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
    has_kev: false,
    has_exploit: false,
    epss: 0,
    owner_sg: "Platform SRE",
    ...over,
  };
}

function scan(over: Partial<ScanRow>): Record<string, unknown> {
  return {
    scan_id: "scan-flat", ts: iso(NOW), mode: "full", shape: "flat",
    total: 1, new_count: 0, resolved_count: 0, reopened_count: 0,
    raw_ref: null, obs_ref: null, severities: null, sealed: 0,
    ...over,
  };
}

function ask(p?: Rec): Rec {
  const res = getColdZonePage(p);
  expect(res.error ?? "", "endpoint threw").toBe("");
  expect(res.ok).toBe(true);
  return res.data as Rec;
}

beforeEach(() => {
  // A NEW VERSION EVERY SPEC. Both memos under test key on `dataVersion()`, so without this
  // the second spec in a block would read the first one's clock — which is precisely the bug
  // the memo is shaped to avoid inside a single execution.
  H.version += 1;
  H.keys.length = 0;
  H.coldThrows = false;
  H.recorded.length = 0;
  H.peek.clear();
  H.ruleVersion = 0;
  H.cold = { mode: "fixed", coldAfterDays: 90, targetSharePct: 20, floorDays: 14 };
  H.base = [
    // Idle for 200 days and still scanned: cold under the default 90-day window.
    row({ vuln_key: "k-cold-1", asset_id: "asset-cold", asset_name: "cold-host" }),
    row({
      vuln_key: "k-cold-2", asset_id: "asset-cold", asset_name: "cold-host",
      status: "RESOLVED", resolved_at: iso(NOW - 200 * DAY), resolution_src: "api",
    }),
    // Touched last week: warm.
    row({
      vuln_key: "k-warm-1", asset_id: "asset-warm", asset_name: "warm-host",
      owner_sg: "Data Platform",
    }),
    row({
      vuln_key: "k-warm-2", asset_id: "asset-warm", asset_name: "warm-host",
      owner_sg: "Data Platform",
      status: "RESOLVED", resolved_at: iso(NOW - 7 * DAY), resolution_src: "api",
    }),
  ];
  H.scans = [
    scan({ scan_id: "scan-old", ts: iso(NOW - 250 * DAY) }),
    scan({ scan_id: "scan-flat", ts: iso(NOW) }),
  ];
});

// --------------------------------------------------------------------------------------- //
//  1. newestFlatScanBySeverity — the observation map
// --------------------------------------------------------------------------------------- //

describe("newestFlatScanBySeverity", () => {
  const s = (over: Partial<ScanRow>) => scan(over) as unknown as ScanRow;

  it("answers the newest scan for every severity when the scope is unscoped", () => {
    const out = newestFlatScanBySeverity([
      s({ scan_id: "a", ts: iso(NOW - DAY) }),
      s({ scan_id: "b", ts: iso(NOW) }),
    ]);
    expect(Object.keys(out).sort()).toEqual(
      ["CRITICAL", "HIGH", "INFO", "LOW", "MEDIUM", "UNKNOWN"],
    );
    expect(out["HIGH"]).toEqual({ scan_id: "b", ts: iso(NOW) });
  });

  it("keys by the canonical severity names, never by what the scan cell happened to spell", () => {
    const out = newestFlatScanBySeverity([
      s({ scan_id: "a", ts: iso(NOW), severities: '["CRITICAL", "HIGH"]' }),
    ]);
    expect(Object.keys(out).sort()).toEqual(["CRITICAL", "HIGH"]);
  });

  it("LEAVES a severity with no covering scan OUT rather than writing a null scan_id", () => {
    // Absence is the input coldZone reads as "undecidable, so observed". A placeholder would
    // turn "we cannot tell" into the accusing claim.
    const out = newestFlatScanBySeverity([
      s({ scan_id: "a", ts: iso(NOW), severities: '["CRITICAL"]' }),
    ]);
    expect("HIGH" in out).toBe(false);
    expect(out["CRITICAL"]).toEqual({ scan_id: "a", ts: iso(NOW) });
  });

  it("does NOT let a CRITICAL-only sweep overwrite HIGH's older covering scan", () => {
    // The whole reason the map is per severity: the morning after a CRITICAL-only sweep, HIGH
    // is still answered by the last scan that actually covered HIGH.
    const out = newestFlatScanBySeverity([
      s({ scan_id: "full", ts: iso(NOW - DAY), severities: null }),
      s({ scan_id: "crit", ts: iso(NOW), severities: '["CRITICAL"]' }),
    ]);
    expect(out["CRITICAL"]!.scan_id).toBe("crit");
    expect(out["HIGH"]!.scan_id).toBe("full");
  });

  it("IGNORES grouped scans entirely — they write no observations", () => {
    const out = newestFlatScanBySeverity([
      s({ scan_id: "flat", ts: iso(NOW - 10 * DAY) }),
      s({ scan_id: "grouped", ts: iso(NOW), shape: "grouped" }),
    ]);
    expect(out["HIGH"]).toEqual({ scan_id: "flat", ts: iso(NOW - 10 * DAY) });
  });

  it("answers an empty map when every scan on record is grouped", () => {
    expect(newestFlatScanBySeverity([s({ scan_id: "g", shape: "grouped" })])).toEqual({});
    expect(newestFlatScanBySeverity([])).toEqual({});
  });
});

// --------------------------------------------------------------------------------------- //
//  2. The ledger clock
// --------------------------------------------------------------------------------------- //

describe("the ledger clock", () => {
  it("dates the model by the newest FLAT scan, and says so", () => {
    const d = ask();
    expect(d["asOfSource"]).toBe("scan");
    expect(d["asOf"]).toBe(NOW);
    expect(d["observedFrom"]).toBe(iso(NOW - 250 * DAY));
    expect(Date.parse((d["coldZone"] as Rec)["as_of"] as string)).toBe(NOW);
  });

  it("ignores a grouped scan newer than every flat one", () => {
    H.scans.push(scan({ scan_id: "g", ts: iso(NOW + 30 * DAY), shape: "grouped" }));
    const d = ask();
    expect(d["asOf"]).toBe(NOW);
    expect(d["asOfSource"]).toBe("scan");
  });

  it("falls back to the wall clock with no flat scan on record, and PUBLISHES the fallback", () => {
    H.scans = [scan({ scan_id: "g", shape: "grouped" })];
    const before = Date.now();
    const d = ask();
    expect(d["asOfSource"]).toBe("wallClock");
    expect(d["asOf"] as number).toBeGreaterThanOrEqual(before);
    // No flat scan means no start of watching either, so nothing derived can be measured.
    expect(d["observedFrom"]).toBeNull();
    expect((d["coldZone"] as Rec)["measurable"]).toBe(false);
    expect((d["coldZone"] as Rec)["totals"]).toBeNull();
  });

  it("still reports what it looked at when it refuses to measure", () => {
    H.scans = [];
    const cold = ask()["coldZone"] as Rec;
    expect(cold["measurable"]).toBe(false);
    expect(cold["row_count"]).toBe(4);
    expect(cold["assets"]).toBeNull();
  });
});

// --------------------------------------------------------------------------------------- //
//  3. The payload
// --------------------------------------------------------------------------------------- //

describe("getColdZonePage", () => {
  it("ships the clock, the classifier and the profile", () => {
    const d = ask();
    expect(Object.keys(d).sort()).toEqual([
      "asOf", "asOfSource", "coldZone", "observedFrom", "rowCount", "rule", "ruleSentence",
      "toggles",
    ]);
    expect(d["rowCount"]).toBe(4);
    expect(d["toggles"]).toEqual({ showNoFix: true, includeEol: true });
    expect(typeof d["ruleSentence"]).toBe("string");
    expect(d["rule"]).toEqual({ ...DEFAULT_RISK_RULE });
  });

  it("measures the seeded estate: one cold asset, one warm, both observed", () => {
    const cold = ask()["coldZone"] as Rec;
    const totals = cold["totals"] as Rec;
    expect(cold["measurable"]).toBe(true);
    expect(cold["cold_after_days"]).toBe(90);
    expect(totals["assets"]).toBe(2);
    expect(totals["assets_unobserved"]).toBe(0);
    expect(totals["cold_assets"]).toBe(1);
    expect(totals["warm_assets"]).toBe(1);
  });

  it("rolls up by support group at the UNSCOPED view — the join is not scope-conditional", () => {
    // `scopedBaseRows` attaches `_supportGroup` only under a scope; this model rolls up by it
    // always, so without its own unconditional call every asset would land in one bucket.
    const groups = (ask()["coldZone"] as Rec)["groups"] as Rec[];
    expect(groups.map((g) => g["support_group"]).sort()).toEqual(["Data Platform", "Platform SRE"]);
  });

  it("moves its verdicts when the operator narrows the window", () => {
    H.cold = { ...H.cold, coldAfterDays: 7 };
    const totals = (ask()["coldZone"] as Rec)["totals"] as Rec;
    expect(totals["cold_assets"]).toBe(2);
  });

  it("draws a derived line in relative mode and publishes what was asked for beside it", () => {
    H.cold = { mode: "relative", coldAfterDays: 90, targetSharePct: 50, floorDays: 1 };
    const cold = ask()["coldZone"] as Rec;
    expect(cold["mode"]).toBe("relative");
    expect(cold["fixed_after_days"]).toBe(90);
    expect(cold["target_share_pct"]).toBe(50);
    expect(cold["eligible_assets"]).toBe(2);
  });
});

// --------------------------------------------------------------------------------------- //
//  4. The durable cache key
// --------------------------------------------------------------------------------------- //

describe("the durable cache key", () => {
  const coldKey = () => H.keys.find((k) => k.ns === "coldZone1")!;

  it("is written under its own namespace", () => {
    ask();
    expect(coldKey()).toBeDefined();
  });

  it("carries ALL FOUR cold fields — the durable layer has no TTL to age a miss out", () => {
    ask();
    const p = coldKey().params;
    expect(p["coldZoneMode"]).toBe("fixed");
    expect(p["coldAfterDays"]).toBe(90);
    expect(p["coldTargetSharePct"]).toBe(20);
    expect(p["coldFloorDays"]).toBe(14);
  });

  it("carries the scope, the severity list, both toggles and the rule VERSION", () => {
    ask({ domain: "Payments", supportGroup: "Platform SRE", severities: ["CRITICAL"] });
    const p = coldKey().params;
    expect(p["domain"]).toBe("Payments");
    expect(p["supportGroup"]).toBe("Platform SRE");
    expect(p["severities"]).toEqual(["CRITICAL"]);
    expect(p["showNoFix"]).toBe(true);
    expect(p["includeEol"]).toBe(true);
    expect(p["riskRuleVersion"]).toBe(0);
  });

  it("changes when ONLY the mode changes — the failure this key exists to stop", () => {
    ask();
    const fixed = JSON.stringify(coldKey().params);
    H.keys.length = 0;
    H.cold = { ...H.cold, mode: "relative" };
    ask();
    expect(JSON.stringify(coldKey().params)).not.toBe(fixed);
  });

  it.each([
    ["coldAfterDays", { coldAfterDays: 45 }],
    ["coldTargetSharePct", { targetSharePct: 35 }],
    ["coldFloorDays", { floorDays: 21 }],
  ])("changes when only %s changes", (_label, patch) => {
    ask();
    const before = JSON.stringify(coldKey().params);
    H.keys.length = 0;
    H.cold = { ...H.cold, ...patch };
    ask();
    expect(JSON.stringify(coldKey().params)).not.toBe(before);
  });

  it("lists the four in a FIXED order, so the Executive's rebuilt params match key for key", () => {
    ask();
    const names = Object.keys(coldKey().params).filter((k) => k.startsWith("cold"));
    expect(names).toEqual([
      "coldZoneMode", "coldAfterDays", "coldTargetSharePct", "coldFloorDays",
    ]);
  });
});

// --------------------------------------------------------------------------------------- //
//  5. The Executive slice
// --------------------------------------------------------------------------------------- //

describe("the Executive slice", () => {
  function exec(p?: Rec): Rec {
    const res = getExecutivePage(p);
    expect(res.error ?? "", "endpoint threw").toBe("");
    return res.data as Rec;
  }

  it("ships the headline and the clock it was dated by", () => {
    const d = exec();
    expect(d["coldZoneAsOfSource"]).toBe("scan");
    const cold = d["coldZone"] as Rec;
    expect(cold["measurable"]).toBe(true);
    expect((cold["totals"] as Rec)["cold_assets"]).toBe(1);
  });

  it("NEVER ships the per-asset or per-group arrays", () => {
    // The card draws one figure out of the totals; the arrays are the Cold zone page's, and a
    // landing page carrying them pays for them on every load.
    const cold = exec()["coldZone"] as Rec;
    expect("assets" in cold).toBe(false);
    expect("groups" in cold).toBe(false);
    expect("bucket_edges" in cold).toBe(false);
  });

  it("reads the SAME cached entry — one profile per request, not two", () => {
    exec();
    expect(H.keys.filter((k) => k.ns === "coldZone1")).toHaveLength(1);
  });

  it("rebuilds the params so the key matches the one the Cold zone page asks for", () => {
    const p = { domain: "Payments", supportGroup: "Platform SRE", severities: ["CRITICAL"] };
    exec(p);
    const fromExec = JSON.stringify(H.keys.find((k) => k.ns === "coldZone1")!.params);
    H.keys.length = 0;
    ask(p);
    expect(JSON.stringify(H.keys.find((k) => k.ns === "coldZone1")!.params)).toBe(fromExec);
  });

  it("publishes wallClock on the Executive too, rather than hiding the fallback", () => {
    H.scans = [];
    expect(exec()["coldZoneAsOfSource"]).toBe("wallClock");
  });

  // ------------------------------------------------------------------------------------- //
  //  The newest card on the DEFAULT landing page cannot be what takes the page down
  // ------------------------------------------------------------------------------------- //
  //
  // This is the only Executive slice whose compute reaches Drive on a miss: the durable layer's
  // halves are total, but `coldZoneData` walks the base rows, which loads the ledger, which reads
  // the snapshot. Before the guard a service error there came back out of `api_getExecutivePage`
  // and the client painted "Couldn't load remediation data." over the whole page — the hero, the
  // fix-next list, the severity tiles and MTTR by domain — for the sake of one card.
  describe("a cold-zone failure costs the card, not the page", () => {
    it("still answers ok, with every other slice intact", () => {
      H.coldThrows = true;
      const res = getExecutivePage();
      expect(res.ok).toBe(true);
      expect(res.error ?? "").toBe("");
      const d = res.data as Rec;
      expect(d["mttr"]).toBeTruthy();
      expect(d["severityCounts"]).toBeTruthy();
      expect(d["byDomain"]).toBeTruthy();
    });

    // `coldShareView` decides from the shape that arrived, never from a flag, so null lands on
    // the same not-measured notice the card draws with no flat scan on record (pinned in
    // test/executiveView.test.js).
    it("ships a null slice rather than omitting the keys", () => {
      H.coldThrows = true;
      const d = getExecutivePage().data as Rec;
      expect("coldZone" in d).toBe(true);
      expect(d["coldZone"]).toBeNull();
      expect(d["coldZoneAsOfSource"]).toBeNull();
    });

    it("records the failure for Diagnostics instead of swallowing it", () => {
      H.coldThrows = true;
      getExecutivePage();
      expect(H.recorded).toContain("executiveColdZone");
    });

    it("the Cold zone PAGE still reports the failure — it is that page's whole payload", () => {
      H.coldThrows = true;
      const res = getColdZonePage();
      expect(res.ok).toBe(false);
    });
  });
});

// --------------------------------------------------------------------------------------- //
//  The warm order
// --------------------------------------------------------------------------------------- //
//
// Read as source rather than by running the warm: `warmReadModelsInner` touches every read-model
// in the app, and a spec that ran it would be pinning the whole server's wiring to assert one
// ordering.
//
// THE WARM RUNS UNDER A 270 s BUDGET and stops warming when it runs out, so ORDER IS PRIORITY.
// This spec used to pin the cold zone LAST, so the heaviest model could only ever starve itself.
// Measured after a deploy (every key cold at once), that order warmed 19 of 27 entries and left
// the Display subset's `insights` and both cold-zone entries cold — exactly what the default
// landing page reads — and Executive took 85–150 s to open. The order now follows what
// `getExecutivePage` reads, in the scope the pages request, and a pass that runs out hands the
// rest to a continuation trigger instead of leaving it cold for four hours.
describe("the warm order puts the landing page first", () => {
  const API_SRC = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
  const labels = [...API_SRC.matchAll(/\n\s*warm\("([A-Za-z]+)"/g)].map((m) => m[1]);
  const EXECUTIVE = ["mttr", "mttrByDomain", "execWeekTrend", "execSevCounts", "insights", "coldZone"];
  const REST = ["mttrTrend", "program", "programTrend", "mttrBySupportGroup", "grouping",
    "attribution", "scanHistory", "storageStats"];

  it("has the warm set this spec thinks it has", () => {
    expect([...labels].sort()).toEqual(["bootstrap", ...EXECUTIVE, ...REST].sort());
  });

  it("warms the bootstrap core first", () => {
    expect(labels[0]).toBe("bootstrap");
  });

  it("warms everything Executive reads before anything it does not", () => {
    const lastExec = Math.max(...EXECUTIVE.map((l) => labels.indexOf(l)));
    const firstRest = Math.min(...REST.map((l) => labels.indexOf(l)));
    expect(lastExec).toBeLessThan(firstRest);
  });

  it("warms the Display-severity scope the pages send before the all-severities one", () => {
    const subset = API_SRC.indexOf("scopes.push([...display]);");
    const all = API_SRC.indexOf("scopes.push(null);");
    expect(subset).toBeGreaterThan(-1);
    expect(all).toBeGreaterThan(subset);
  });

  it("hands a cut-out pass to a continuation instead of dropping it", () => {
    expect(API_SRC).toMatch(/if \(skipped\) \{\s*scheduleWarmContinuation\(/);
  });
});

// --------------------------------------------------------------------------------------- //
//  A warm that runs out of budget continues on a trigger
// --------------------------------------------------------------------------------------- //
//
// Measured after a deploy: one pass warmed 19 of 27 entries and left the rest cold until the
// next scheduled fire, four hours later. The cut-out now schedules a one-shot hop instead —
// bounded, so an entry that alone outlasts the execution cap cannot chain forever.
describe("a warm that runs out of budget", () => {
  type Trig = { handler: string; after: number };
  let triggers: Trig[];
  let store: Map<string, string>;

  beforeEach(() => {
    triggers = [];
    store = new Map();
    vi.stubGlobal("ScriptApp", {
      newTrigger: (handler: string) => ({
        timeBased: () => ({ after: (after: number) => ({ create: () => { triggers.push({ handler, after }); } }) }),
      }),
      getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.handler, t })),
      deleteTrigger: (x: { t: Trig }) => { triggers = triggers.filter((t) => t !== x.t); },
    });
    vi.stubGlobal("CacheService", {
      getScriptCache: () => ({
        get: (k: string) => store.get(k) ?? null,
        put: (k: string, v: string) => { store.set(k, v); },
        remove: (k: string) => { store.delete(k); },
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("computes nothing past the budget and schedules exactly one continuation", () => {
    warmReadModels(0);
    expect(H.keys).toEqual([]);
    expect(triggers).toEqual([{ handler: "trigger_continueWarm", after: 1_000 }]);
    warmReadModels(0); // the next cut-out replaces the pending hop rather than stacking one
    expect(triggers).toHaveLength(1);
  });

  it("stops chaining after six hops on the same cache stamp", () => {
    for (let i = 0; i < 6; i++) warmReadModels(0);
    expect(triggers).toHaveLength(1);
    triggers = [];
    warmReadModels(0);
    expect(triggers).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------- //
//  doGet's inline bootstrap never computes
// --------------------------------------------------------------------------------------- //
//
// Computing a cold core inside doGet held the page for ~20 s after a deploy, blank where the
// boot splash used to be. The inline path peeks; cold means the client asks over the RPC.
describe("bootstrapIfWarm", () => {
  it("fails soft on a cold core without computing it", () => {
    const res = bootstrapIfWarm();
    expect(res.ok).toBe(false);
    expect(res.errorKind).toBe("cold");
    expect(H.keys.filter((k) => k.ns.startsWith("bootstrapCore"))).toEqual([]);
    expect(H.recorded).toEqual([]); // cold is not a fault; nothing lands in the error log
  });

  it("peeks at the same entry the RPC path reads", () => {
    const API_SRC = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
    expect(API_SRC).toContain("durablyCached(BOOT_CORE, bootCoreParams(), bootstrapCore)");
    expect(API_SRC).toContain("durablyPeek(BOOT_CORE, bootCoreParams())");
  });
});

// --------------------------------------------------------------------------------------- //
//  The Executive's slice timings reach the execution log
// --------------------------------------------------------------------------------------- //
//
// A cold Executive load was measured at 146 s with the cold zone at under half a second of it.
// This line is how the rest gets attributed, so a refactor that drops a slice from it would
// silently blind the next measurement.
describe("getExecutivePage timing line", () => {
  it("logs one line naming every slice, in milliseconds", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = getExecutivePage({ domain: "", supportGroup: "", severities: null });
    expect(res.ok).toBe(true);
    const lines = log.mock.calls
      .map((c) => String(c[0]))
      .filter((l: string) => l.includes('"stage":"executive"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]!).sort()).toEqual(
      ["byDomain", "coldZone", "insights", "mttr", "severityCounts", "stage", "weekTrend"],
    );
    for (const [k, v] of Object.entries(lines[0]!)) if (k !== "stage") expect(typeof v).toBe("number");
    log.mockRestore();
  });
});

// --------------------------------------------------------------------------------------- //
//  Scoping runs once per execution, not once per read-model
// --------------------------------------------------------------------------------------- //
//
// A scoped Executive composes five read-models, and each used to redo the whole scoping pass
// over the full base (the support-group join, a tags_json parse per row, the domain rules).
// `scopedBaseRows` now scopes once per (cache stamp, scope) and hands out copies.
describe("scopedBaseRows", () => {
  const scopedLines = (log: ReturnType<typeof vi.spyOn>) =>
    log.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('"stage":"scopedBase"'));

  it("scopes once per scope for a whole scoped Executive load", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(getExecutivePage({ domain: "", supportGroup: "Platform SRE", severities: null }).ok).toBe(true);
    expect(scopedLines(log)).toHaveLength(1);
    expect(getExecutivePage({ domain: "", supportGroup: "Data Platform", severities: null }).ok).toBe(true);
    expect(scopedLines(log)).toHaveLength(2);
    log.mockRestore();
  });

  it("does not scope at all for the whole register", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(getExecutivePage({ domain: "", supportGroup: "", severities: null }).ok).toBe(true);
    expect(scopedLines(log)).toHaveLength(0);
    log.mockRestore();
  });

  it("answers a repeat of the same scope the same way (copies, not shared rows)", () => {
    const p = { domain: "", supportGroup: "Platform SRE", severities: null };
    const first = getExecutivePage(p);
    const second = getExecutivePage(p);
    expect(second.data).toEqual(first.data);
  });
});
