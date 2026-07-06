import { describe, expect, it } from "vitest";
import {
  episodeEligible,
  parseSeverities,
  selectSealCandidates,
  serializeSeverities,
  statsEqual,
} from "../src/domain/compaction";
import type { LedgerRow } from "../src/domain/reconcile";
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

describe("statsEqual", () => {
  it("tolerates null-vs-NaN and nests", () => {
    expect(statsEqual({ a: NaN, b: [1, null] }, { a: null, b: [1, NaN] })).toBe(true);
    expect(statsEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(statsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(statsEqual([1, 2], [1, 2])).toBe(true);
    expect(statsEqual([1, 2], [2, 1])).toBe(false);
  });
});
