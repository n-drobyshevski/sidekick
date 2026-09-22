// THE REMEDIATION SPLIT'S SERVER HALF: which dimension a scope picks, and what the by-asset
// split's cap keeps, drops and admits to dropping.
//
// The split's three dimensions are chosen by `cachedMttrGroupSplit` and nothing else, and the
// three endpoints that serve the section (`getMttrPage`, `getMttrByDomainTrend`,
// `getExecutivePage`) all go through it. Four ways this layer breaks, none of them visible in a
// domain-layer test:
//
//   1. THE WRONG DIMENSION FOR A SCOPE. A support-group scope that still answered "by domain"
//      is not an error — it is the OLD, working behaviour, so nothing throws and no figure is
//      wrong. It is just no longer the question the scope asks.
//   2. A CAP WITH NO CONFESSION. Assets are estate-sized; a top-20 that shipped without `cut`
//      would read as the whole estate, and a team would conclude they own twenty hosts.
//   3. THE THREE ENDPOINTS DISAGREEING. They must land on the same cache entry key-for-key or
//      the trend RPC recomputes cold what the page already warmed — invisible except as
//      latency, which is why it went unnoticed for as long as the ternary was copied.
//   4. A CACHE KEY THAT OMITS A FIELD THE COMPUTE READS. The classic: a payload scoped to one
//      support group served from another's entry, for up to the TTL.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RISK_RULE } from "../src/domain/program";
import type { Rec } from "../src/domain/util";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-01T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const H = vi.hoisted(() => ({
  base: [] as Record<string, unknown>[],
  scans: [] as Record<string, unknown>[],
  /** Every namespace + params object `cached` was handed this run, in call order. */
  keys: [] as { ns: string; params: Rec }[],
  showNoFix: true,
  version: 0,
}));

vi.mock("../src/server/sheetsDb", () => ({
  TABS: { scans: { name: "scans", headers: [] }, vulnLedger: { name: "vuln_ledger", headers: [] } },
  TAB_HEADERS: {}, SCHEMA_VERSION: 1,
  readAll: () => [], readTail: () => [], overwrite: () => {}, appendRows: () => {},
  cellUsage: () => ({ total: 0, tabs: {} }), ensureTabs: () => {},
}));

// A passthrough that RECORDS. Every spec recomputes (so no spec answers the next one's
// question), and the recorded keys are what specs 3 and 4 above read.
vi.mock("../src/server/serverCache", () => ({
  BUILD_ID: "test",
  cached: (ns: string, params: unknown, compute: () => unknown) => {
    H.keys.push({ ns, params: params as Rec });
    return compute();
  },
  dataVersion: () => String(H.version),
}));
vi.mock("../src/server/readModelStore", () => ({
  durablyCached: (_ns: string, _params: unknown, compute: () => unknown) => compute(),
  duringWarm: <T,>(fn: () => T): T => fn(),
  sweepReadModels: () => 0,
}));
vi.mock("../src/server/ledgerStore", () => ({
  loadBaseRows: () => H.base.map((r) => ({ ...r })),
  loadScanRows: () => H.scans.map((r) => ({ ...r })),
  loadTrend: () => [],
  latestFlatScanRow: () => null,
}));
vi.mock("../src/server/historyStore", () => ({ loadHistory: () => [] }));
vi.mock("../src/server/findings", () => ({ currentScan: () => null, distinct: () => [] }));
vi.mock("../src/server/settingsStore", () => ({
  getShowNoFix: () => H.showNoFix,
  getIncludeEol: () => true,
  getDomains: () => ({ items: [] }),
  getDisplaySeverities: () => ["CRITICAL", "HIGH"],
  getRiskRule: () => ({ version: 0, rule: { ...DEFAULT_RISK_RULE } }),
  getColdZone: () => ({ mode: "fixed", coldAfterDays: 90, targetSharePct: 20, floorDays: 14 }),
}));

// THE REAL JOIN, NOT A SHORTCUT. `_supportGroup` is not a ledger column — it is resolved from
// the row's SUBSCRIPTION identity through the Wiz/provisioning map, and that detail is the whole
// reason compacted episodes never reach the asset split. A mock that read a made-up `owner_sg`
// column off the row would hand every compacted row a support group and quietly make the
// "compacted rows can't arrive here" spec below test nothing at all.
vi.mock("../src/server/supportGroups", () => ({
  attachSupportGroups: (rows: Rec[]) => {
    const MAP: Record<string, string> = { "sub-a": "Platform SRE", "sub-b": "Payments" };
    for (const r of rows) {
      const token = String(r["subscription_ext_id"] ?? r["subscription_name"] ?? "");
      const sg = MAP[token];
      if (sg) r["_supportGroup"] = sg;
    }
  },
}));
vi.mock("../src/server/bizDomains", () => ({
  attachBizDomains: (rows: Rec[]) => { for (const r of rows) r["_bizDomain"] = ""; },
}));
vi.mock("../src/server/errorLog", () => ({
  recordError: () => {}, recentErrors: () => [],
}));

import { getExecutivePage, getMttrByDomainTrend, getMttrPage } from "../src/server/api";

// --------------------------------------------------------------------------------------- //
//  Fixture
// --------------------------------------------------------------------------------------- //

/** One finding on an asset. Open unless `resolved_at` says otherwise. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
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
    subscription_name: "sub-a",
    subscription_ext_id: "sub-a",
    has_kev: false,
    has_exploit: false,
    epss: 0,
    ...over,
  };
}

/** `n` open findings on one asset, in one subscription. */
function openOn(asset: string, n: number, over: Record<string, unknown> = {}) {
  return Array.from({ length: n }, (_, i) =>
    row({ vuln_key: `${asset}-o${i}`, asset_name: asset, asset_id: asset, ...over }));
}

/** `n` resolved findings on one asset — closed 30 days after they were first seen. */
function resolvedOn(asset: string, n: number, over: Record<string, unknown> = {}) {
  return Array.from({ length: n }, (_, i) => row({
    vuln_key: `${asset}-r${i}`,
    asset_name: asset,
    asset_id: asset,
    status: "RESOLVED",
    first_seen: iso(NOW - 60 * DAY),
    resolved_at: iso(NOW - 30 * DAY),
    ...over,
  }));
}

function split(p?: Rec): Rec {
  const res = getMttrPage(p);
  expect(res.error ?? "", "endpoint threw").toBe("");
  expect(res.ok).toBe(true);
  return (res.data as Rec)["byDomain"] as Rec;
}

const names = (s: Rec) => ((s["rows"] as Rec[]) ?? []).map((r) => String(r["group"]));

beforeEach(() => {
  H.base = [];
  H.scans = [{ scan_id: "scan-flat", ts: iso(NOW), mode: "full", shape: "flat", total: 1 }];
  H.keys = [];
  H.showNoFix = true;
  H.version += 1;
});

// --------------------------------------------------------------------------------------- //
//  1. The dimension follows the scope
// --------------------------------------------------------------------------------------- //

describe("the split's dimension follows the scope", () => {
  beforeEach(() => {
    H.base = [...openOn("host-01", 3), ...openOn("host-02", 2)];
  });

  it("splits by domain when nothing is scoped", () => {
    expect(split({})["dimension"]).toBe("domain");
  });

  it("splits by support group inside a domain", () => {
    expect(split({ domain: "Payments" })["dimension"]).toBe("supportGroup");
  });

  // The change this file exists for: a support-group scope used to answer "by domain".
  it("splits by ASSET inside a support group", () => {
    expect(split({ supportGroup: "Platform SRE" })["dimension"]).toBe("asset");
  });

  // scopeKinds() makes the two mutually exclusive, so this is unreachable from the UI — but the
  // narrower scope is the one a reader picked most recently, and an endpoint should not depend
  // on a client invariant to answer coherently.
  it("prefers the narrower scope if a caller somehow sets both", () => {
    expect(split({ domain: "Payments", supportGroup: "Platform SRE" })["dimension"])
      .toBe("asset");
  });
});

// --------------------------------------------------------------------------------------- //
//  2. What the by-asset split contains
// --------------------------------------------------------------------------------------- //

describe("the by-asset split", () => {
  it("lists the scoped support group's assets, busiest backlog first", () => {
    H.base = [
      ...openOn("host-small", 1),
      ...openOn("host-big", 5),
      ...openOn("host-mid", 3),
    ];
    expect(names(split({ supportGroup: "Platform SRE" })))
      .toEqual(["host-big", "host-mid", "host-small"]);
  });

  // Open leads because the section is about the backlog a team is carrying; resolved breaks a
  // tie so a busy host outranks an idle one of the same size.
  it("breaks an equal backlog by resolved work", () => {
    H.base = [
      ...openOn("host-idle", 2),
      ...openOn("host-busy", 2), ...resolvedOn("host-busy", 4),
    ];
    expect(names(split({ supportGroup: "Platform SRE" })))
      .toEqual(["host-busy", "host-idle"]);
  });

  it("keeps another support group's assets out of the split", () => {
    H.base = [
      ...openOn("sre-host", 3),
      ...openOn("pay-host", 9, { subscription_name: "sub-b", subscription_ext_id: "sub-b" }),
    ];
    expect(names(split({ supportGroup: "Platform SRE" }))).toEqual(["sre-host"]);
  });

  // The same "(none)" bucket the by-support-group split uses, and sorted the same way: an
  // unnamed tail is real and gets a row, but it never leads a table about named hosts.
  it("buckets a nameless asset as (none) and sorts it last however big it is", () => {
    H.base = [
      ...openOn("host-01", 1),
      ...openOn("", 9, { asset_name: null }),
    ];
    expect(names(split({ supportGroup: "Platform SRE" }))).toEqual(["host-01", "(none)"]);
  });

  // No `domain` alias: only mttrByDomainData writes one, and both clients read `group ?? domain`.
  it("writes the generic group label only", () => {
    H.base = [...openOn("host-01", 2), ...openOn("host-02", 1)];
    const rows = (split({ supportGroup: "Platform SRE" })["rows"] as Rec[]) ?? [];
    expect(rows.every((r) => !("domain" in r))).toBe(true);
  });
});

// --------------------------------------------------------------------------------------- //
//  3. The cap, and admitting to it
// --------------------------------------------------------------------------------------- //

describe("the cap on an estate-sized dimension", () => {
  /** 25 assets: the Nth carries N open findings, so rank order is host-25 … host-01. */
  const estate = () => Array.from({ length: 25 }, (_, i) =>
    openOn(`host-${String(i + 1).padStart(2, "0")}`, i + 1)).flat();

  it("lists the top 20 by open backlog and no more", () => {
    H.base = estate();
    const s = split({ supportGroup: "Platform SRE" });
    expect(names(s)).toHaveLength(20);
    expect(names(s)[0]).toBe("host-25");
    expect(names(s).at(-1)).toBe("host-06");
  });

  // Spec 2 at the top of this file. Without these three numbers the table reads as the estate.
  it("reports exactly what it dropped", () => {
    H.base = estate();
    const cut = split({ supportGroup: "Platform SRE" })["cut"] as Rec;
    // host-05 … host-01: five assets carrying 5+4+3+2+1 open findings.
    expect(cut).toEqual({ groups: 5, open: 15, resolved: 0 });
  });

  // `cut.resolved` is not decoration: mttr.js adds it to the pooled "Other" bar it derives from
  // the rows it was sent, and those are the kept 20. A tail whose resolved work is entirely past
  // the cap would otherwise have the server drawing a series the client omits.
  it("counts the dropped tail's resolved work, not just its backlog", () => {
    H.base = [...estate(), ...resolvedOn("host-01", 7)];
    const cut = split({ supportGroup: "Platform SRE" })["cut"] as Rec;
    expect(cut["resolved"]).toBe(7);
  });

  it("reports a zero cut rather than nothing when the estate fits", () => {
    H.base = [...openOn("host-01", 2), ...openOn("host-02", 1)];
    expect(split({ supportGroup: "Platform SRE" })["cut"])
      .toEqual({ groups: 0, open: 0, resolved: 0 });
  });

  // The two uncapped dimensions compute no cut at all, and `mttrGroupTableSlice` normalises that
  // absence to null on the way out — so the client has ONE thing to test rather than an
  // undefined it would have to tell apart from a zero. "Nothing fell off" and "nothing could
  // have" are both silence on the page; the difference is only that the second is not a claim
  // this endpoint would be entitled to make.
  it("reports no cut for the operator-configured dimensions", () => {
    H.base = [...openOn("host-01", 2), ...openOn("host-02", 1)];
    expect(split({})["cut"]).toBeNull();
    expect(split({ domain: "Payments" })["cut"]).toBeNull();
  });
});

// --------------------------------------------------------------------------------------- //
//  4. Compacted episodes
// --------------------------------------------------------------------------------------- //

// Compaction replaces an episode's asset identity with the "(compacted)" placeholder AND drops
// its subscription. The support-group join reads the subscription, so such a row never resolves
// a group and the scope filter has already removed it before the asset key is written. There is
// no "(compacted)" bucket to design, and no filter guarding against one — which is exactly the
// kind of fact that rots silently, hence these two specs rather than a comment.
describe("compacted episodes", () => {
  const compacted = (over: Record<string, unknown> = {}) => row({
    vuln_key: "compacted-1",
    asset_name: "(compacted)",
    asset_id: null,
    subscription_name: null,
    subscription_ext_id: null,
    ...over,
  });

  it("never reaches the asset split, because the support-group join cannot place them", () => {
    H.base = [...openOn("host-01", 2), ...openOn("host-02", 1), compacted()];
    expect(names(split({ supportGroup: "Platform SRE" }))).toEqual(["host-01", "host-02"]);
  });

  // The perturbation that makes the spec above mean something: the placeholder name is not what
  // excludes it — the missing subscription is. Restore the subscription and it buckets like any
  // other row, under the placeholder name.
  it("does bucket if it somehow carries a subscription, under the placeholder name", () => {
    H.base = [
      ...openOn("host-01", 2),
      compacted({ subscription_name: "sub-a", subscription_ext_id: "sub-a" }),
    ];
    expect(names(split({ supportGroup: "Platform SRE" })))
      .toEqual(["host-01", "(compacted)"]);
  });
});

// --------------------------------------------------------------------------------------- //
//  5. The cache key, and the three endpoints agreeing on it
// --------------------------------------------------------------------------------------- //

describe("the by-asset cache entry", () => {
  const assetKeys = () => H.keys.filter((k) => k.ns === "mttrByAsset1");

  beforeEach(() => {
    H.base = [...openOn("host-01", 2), ...openOn("host-02", 1)];
  });

  it("keys on exactly the params the compute reads", () => {
    split({ supportGroup: "Platform SRE", severities: ["HIGH"] });
    expect(assetKeys()).toHaveLength(1);
    expect(Object.keys(assetKeys()[0].params).sort())
      .toEqual(["severities", "showNoFix", "supportGroup"]);
    expect(assetKeys()[0].params["supportGroup"]).toBe("Platform SRE");
  });

  // Omitting `domain` is safe only because the compute never reads it. If that ever changes,
  // this spec is the one that has to fail.
  it("omits the domain, which the compute does not read", () => {
    const a = split({ supportGroup: "Platform SRE" });
    const b = split({ supportGroup: "Platform SRE", domain: "Payments" });
    expect(assetKeys()[0].params).toEqual(assetKeys()[1].params);
    expect(names(a)).toEqual(names(b));
  });

  it("separates one support group's entry from another's", () => {
    split({ supportGroup: "Platform SRE" });
    split({ supportGroup: "Payments" });
    expect(assetKeys()[0].params["supportGroup"])
      .not.toBe(assetKeys()[1].params["supportGroup"]);
  });

  it("separates the show-no-fix states", () => {
    split({ supportGroup: "Platform SRE" });
    H.showNoFix = false;
    split({ supportGroup: "Platform SRE" });
    expect(assetKeys()[0].params["showNoFix"]).not.toBe(assetKeys()[1].params["showNoFix"]);
  });

  // Spec 3 at the top of this file. The MTTR page fires getMttrPage and getMttrByDomainTrend
  // with the same params and the Executive page reads the same split; all three must land on
  // ONE entry, or the second recomputes cold what the first warmed.
  it("is reached identically by all three endpoints that serve the section", () => {
    const p = { supportGroup: "Platform SRE", severities: ["HIGH"] };
    getMttrPage(p);
    getMttrByDomainTrend(p);
    getExecutivePage(p);
    const keys = assetKeys();
    expect(keys).toHaveLength(3);
    expect(keys[1].params).toEqual(keys[0].params);
    expect(keys[2].params).toEqual(keys[0].params);
  });

  // The other side of the same coin: the two unscoped/domain-scoped dimensions must NOT be
  // computed under a support-group scope, or the page pays for a split nobody draws.
  it("is the only split computed under a support-group scope", () => {
    split({ supportGroup: "Platform SRE" });
    const namespaces = H.keys.map((k) => k.ns);
    expect(namespaces).toContain("mttrByAsset1");
    expect(namespaces).not.toContain("mttrByDomain14");
    expect(namespaces).not.toContain("mttrBySupportGroup2");
  });
});
