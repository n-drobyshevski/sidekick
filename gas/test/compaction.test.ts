import { describe, expect, it } from "vitest";
import {
  episodeEligible,
  parseSeverities,
  selectSealCandidates,
  serializeSeverities,
  statsEqual,
} from "../src/domain/compaction";
import { emptyRiskSignals, type LedgerRow } from "../src/domain/reconcile";
import { compactLedgerCore, toEpisodeRow } from "../src/domain/maintenance";
import {
  baseRows,
  emptyState,
  persistFlatScan,
  type LedgerState,
  type ScanRow,
} from "../src/domain/ledgerCore";
import { DEFAULT_DOMAIN_TAG_KEY, domainOfTags } from "../src/domain/domainTag";
import { recordTags } from "../src/domain/domainRules";
import { resolveDomainName } from "../src/domain/resolveDomain";
import { type Rec } from "../src/domain/util";
import { fixture } from "./helpers";

describe("severity scope (fixture parity)", () => {
  const fx = fixture("severities_scope");
  fx.serialize.forEach((c: any, i: number) => {
    it(`serialize ${i}`, () => {
      expect(serializeSeverities(c.input)).toBe(c.expected);
    });
  });
  fx.parse.forEach((c: any, i: number) => {
    it(`parse ${i}`, () => {
      expect(parseSeverities(c.input)).toEqual(c.expected);
    });
  });
});

describe("selectSealCandidates", () => {
  const rows = [
    { scan_id: "s1", ts: "2026-01-01T00:00:00Z", shape: "flat" },
    { scan_id: "s2", ts: "2026-02-01T00:00:00Z", shape: "grouped" },
    { scan_id: "s3", ts: "2026-03-01T00:00:00Z", shape: "flat" },
    { scan_id: "s4", ts: "2026-04-01T00:00:00Z", shape: "flat" },
    { scan_id: "s5", ts: "2026-05-01T00:00:00Z", shape: "flat" },
  ];
  it("seals the old prefix but protects the last two flat scans", () => {
    const out = selectSealCandidates(rows, Date.parse("2026-12-01T00:00:00Z"));
    expect(out.map((r) => r.scan_id)).toEqual(["s1", "s2", "s3"]);
  });
  it("stops at the first scan newer than cutoff (prefix rule)", () => {
    const out = selectSealCandidates(rows, Date.parse("2026-01-15T00:00:00Z"));
    expect(out.map((r) => r.scan_id)).toEqual(["s1"]);
  });
  it("stops at unparseable timestamps", () => {
    const bad = [{ scan_id: "x", ts: "junk", shape: "flat" }, ...rows];
    expect(selectSealCandidates(bad, Date.parse("2026-12-01T00:00:00Z"))).toEqual([]);
  });
});

describe("episodeEligible", () => {
  const base: LedgerRow = {
    vuln_key: "k", cve: null, severity: "HIGH", asset_id: null, asset_name: null,
    asset_type: null, cloud: null, first_seen: "2026-01-01T00:00:00Z",
    last_seen: null, status: "RESOLVED", resolved_at: "2026-02-01T00:00:00Z",
    resolution_src: "api", reopened_count: 0, first_scan_id: null, last_scan_id: null,
    subscription_name: null, subscription_ext_id: null, tags_json: null,
    fix_date: null, fix_observed_at: null, ...emptyRiskSignals(),
    published_date: null,
  };
  const floor = Date.parse("2026-03-01T00:00:00Z");
  it("resolved before the floor -> eligible", () => {
    expect(episodeEligible(base, floor)).toBe(true);
  });
  it("open or resolved after the floor -> not eligible", () => {
    expect(episodeEligible({ ...base, status: "OPEN", resolved_at: null }, floor)).toBe(false);
    expect(episodeEligible({ ...base, resolved_at: "2026-04-01T00:00:00Z" }, floor)).toBe(false);
  });
});

describe("toEpisodeRow carries vendor-fix fields", () => {
  const live: LedgerRow = {
    vuln_key: "k", cve: null, severity: "HIGH", asset_id: null, asset_name: null,
    asset_type: null, cloud: null, first_seen: "2026-07-04T00:00:00Z",
    last_seen: "2026-07-18T00:00:00Z", status: "RESOLVED", resolved_at: "2026-07-18T00:00:00Z",
    resolution_src: "api", reopened_count: 0, first_scan_id: null, last_scan_id: null,
    subscription_name: null, subscription_ext_id: null, tags_json: null,
    fix_date: "2026-07-10T00:00:00Z", fix_observed_at: "2026-07-08T00:00:00Z",
    published_date: "2026-06-01T00:00:00Z",
    ...emptyRiskSignals(),
  };
  it("preserves fix_date and fix_observed_at through episode conversion", () => {
    const ep = toEpisodeRow(live, "cmp-1");
    expect(ep.fix_date).toBe("2026-07-10T00:00:00Z");
    expect(ep.fix_observed_at).toBe("2026-07-08T00:00:00Z");
  });
  // Same argument one tier over: compaction seals RESOLVED rows, and a resolved row that
  // got its fix is exactly the disclosure clock's event population. Drop the column here
  // and the metric thins out silently as the retention floor advances.
  it("preserves published_date through episode conversion", () => {
    expect(toEpisodeRow(live, "cmp-1").published_date).toBe("2026-06-01T00:00:00Z");
  });
  it("a live row that never carried a publication date seals as null, not as a guess", () => {
    expect(toEpisodeRow({ ...live, published_date: null }, "cmp-1").published_date).toBeNull();
  });
});

describe("statsEqual", () => {
  it("tolerates null-vs-NaN and nests", () => {
    expect(statsEqual({ a: NaN, b: [1, null] }, { a: null, b: [1, NaN] })).toBe(true);
    expect(statsEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(statsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(statsEqual([1, 2], [1, 2])).toBe(true);
    expect(statsEqual([1, 2], [2, 1])).toBe(false);
  });
});

// ---------------------------------------------------------------- tags through compaction

// THE DEFECT THIS SECTION EXISTS FOR. `EpisodeRow` had no `tags_json` column at all, so every
// resolved lifecycle past the retention floor lost the `Wiz/Domain` tag it was attributed by —
// silently, because the stats-identity gate had no attribution leg to notice. Auto-compact
// defaults ON and resolved lifecycles are exactly the MTTR denominator, so the by-domain
// figures would have thinned out as the floor advanced while the gate reported green.
describe("compaction preserves the domain tag", () => {
  const fx = fixture("ledger_compaction");
  const ids = ["s1", "s2", "s3", "s4"] as const;
  const now = Date.parse(fx.now);
  // The two lifecycles the fixture converts to episodes; see ledgerFlow.test.ts.
  const CONVERTED = ["id:B", "id:D"];

  // Every asset in the fixture, tagged. `B` and `D` are the ones that get compacted, so a tag
  // on them is the one that has to survive; the rest hold the figure's denominator up.
  function tagged(records: any[]): any[] {
    return records.map((r) => ({
      ...r,
      vulnerableAsset: { ...r.vulnerableAsset, tags: { "Wiz/Domain": "SAP" } },
    }));
  }

  function build(): { state: LedgerState; obsCountByScan: Record<string, number> } {
    const state = emptyState();
    const obsCountByScan: Record<string, number> = {};
    for (const key of ids) {
      const scan = fx.scans[key];
      const { observations } = persistFlatScan(state, tagged(scan.records), {
        mode: "live",
        scanId: scan.id,
      });
      obsCountByScan[scan.id] = observations.length;
    }
    return { state, obsCountByScan };
  }

  const readPayload = (row: ScanRow) => {
    const key = ids.find((k) => fx.scans[k].id === row.scan_id);
    return key ? { data: { vulnerabilityFindings: { nodes: tagged(fx.scans[key].records) } } } : null;
  };

  // The gate's attribution leg, recomputed here rather than exported from maintenance.ts: the
  // point is to hold the SHAPE of the invariant, and a test that called the very function under
  // test would pass whatever that function happened to count.
  function attribution(state: LedgerState): { bagged: number; domained: number } {
    let bagged = 0;
    let domained = 0;
    for (const r of baseRows(state, now)) {
      if (r.tags_json) bagged += 1;
      if (domainOfTags(recordTags(r as unknown as Rec), DEFAULT_DOMAIN_TAG_KEY)) domained += 1;
    }
    return { bagged, domained };
  }

  function compact(state: LedgerState, obsCountByScan: Record<string, number>) {
    return compactLedgerCore(state, fx.retention_days, null, readPayload, {
      now, compactionId: "cmp-tags", obsCountByScan,
    });
  }

  it("carries tags_json onto the episode rows it creates", () => {
    const { state, obsCountByScan } = build();
    const applied = compact(state, obsCountByScan).state!;
    expect(applied.episodes.map((e) => e.vuln_key).sort()).toEqual(CONVERTED);
    for (const e of applied.episodes) {
      expect(JSON.parse(String(e.tags_json))["Wiz/Domain"]).toBe("SAP");
    }
  });

  it("resolves the same domain off a compacted episode as off the live row", () => {
    // The behaviour that actually matters: `resolveDomain` reads the bag back out of a base row
    // whose asset name is now the "(compacted)" placeholder, so the row keeps its domain rather
    // than falling through to the rules it can no longer match, or to Not attributable.
    const { state, obsCountByScan } = build();
    const before = new Map(
      baseRows(state, now).map((r) => [r.vuln_key, resolveDomainName(r as unknown as Rec, [])]),
    );
    const applied = compact(state, obsCountByScan).state!;
    for (const r of baseRows(applied, now)) {
      if (!CONVERTED.includes(r.vuln_key)) continue;
      expect(r.asset_name).toBe("(compacted)");
      expect(resolveDomainName(r as unknown as Rec, [])).toBe(before.get(r.vuln_key));
      expect(resolveDomainName(r as unknown as Rec, [])).toBe("SAP");
    }
  });

  it("leaves the gate's attribution figures byte-identical", () => {
    const { state, obsCountByScan } = build();
    const before = attribution(state);
    const applied = compact(state, obsCountByScan).state!;
    expect(before.bagged).toBeGreaterThan(0); // or the assertion below proves nothing
    expect(attribution(applied)).toEqual(before);
  });

  it("the gate's leg has teeth: dropping tags_json off the episodes moves it", () => {
    // The regression this leg is FOR, staged by hand. Before `tags_json` joined `EpisodeRow`
    // this was compaction's actual behaviour, and the three legs the gate had at the time all
    // reported green through it.
    const { state, obsCountByScan } = build();
    const before = attribution(state);
    const applied = compact(state, obsCountByScan).state!;
    const stripped: LedgerState = {
      ...applied,
      episodes: applied.episodes.map((e) => ({ ...e, tags_json: null })),
    };
    expect(attribution(stripped)).not.toEqual(before);
    expect(before.domained - attribution(stripped).domained).toBe(CONVERTED.length);
  });
});
