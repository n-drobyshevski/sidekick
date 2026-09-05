// Port of gas/test/compaction.test.ts, scoped to compaction.ts's five standalone functions
// (serializeSeverities, parseSeverities, selectSealCandidates, episodeEligible, statsEqual) —
// see compaction.ts's header for why compactLedgerCore / toEpisodeRow (gas/'s maintenance.ts)
// and the domain-tag compaction suite (gas/test/compaction.test.ts's second half, which drives
// those two plus domainTag.ts/domainRules.ts/resolveDomain.ts — none ported here) are out of
// D9's scope.
//
// severities_scope.json is byte-identical between gas/ and this package (diffed before writing
// this file) — severity strings carry no ledger-column rename, so serializeSeverities /
// parseSeverities are pinned verbatim against it, same as gas/'s own test.
//
// ledger_compaction.json IS gas/'s own fixture (OS-vuln shaped: vuln_key/cve/asset_id, no
// scope column) — it was generated for gas/'s compactLedgerCore integration test, not for
// compaction.ts's standalone functions, and the D9 brief says never regenerate or edit it. So
// rather than replaying the whole compaction pipeline (out of scope, see above), the tests
// below read the fixture's own sub-fields directly and pin selectSealCandidates / episodeEligible
// against the exact seal set and floor the fixture's `expected` block already records — every
// number below is read off the fixture, not invented.

import { describe, expect, it } from "vitest";
import {
  episodeEligible,
  parseSeverities,
  selectSealCandidates,
  serializeSeverities,
  statsEqual,
} from "../src/domain/compaction";
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

  // Byte-stability: serialize(parse(x)) === x for every fixture string that is ITSELF a
  // canonical serialize() output (the "serialize" section's non-null `expected` values —
  // json.dumps-style ", "-separated text). The "parse" section's inputs are deliberately
  // compact/malformed ("[\"CRITICAL\",\"HIGH\"]", "bogus", "INFORMATIONAL") to test parse's
  // tolerance, so they are not themselves canonical and round-tripping them would only prove
  // parse+serialize together RENORMALIZE, which is a different (also true, but not this) claim.
  it("serialize(parse(x)) === x for every canonical fixture string", () => {
    const canonical: string[] = fx.serialize
      .map((c: any) => c.expected)
      .filter((s: unknown): s is string => typeof s === "string");
    expect(canonical.length).toBeGreaterThan(0); // or this proves nothing
    for (const s of canonical) {
      expect(serializeSeverities(parseSeverities(s))).toBe(s);
    }
  });
});

describe("selectSealCandidates (ledger_compaction.json fixture parity)", () => {
  const fx = fixture("ledger_compaction");
  const rows = fx.expected.after_compact.scans.map((s: any) => ({ scan_id: s.scan_id, ts: s.ts }));
  const DAY_MS = 86_400_000;
  const cutoffMs = Date.parse(fx.now) - fx.retention_days * DAY_MS;

  it("seals exactly the scans the fixture marks sealed:1, protecting the newest MIN_UNSEALED_FLAT_SCANS", () => {
    const sealedIds = fx.expected.after_compact.scans
      .filter((s: any) => s.sealed === 1)
      .map((s: any) => s.scan_id);
    expect(sealedIds).toEqual(["2026-01-01T06:00:00Z", "2026-01-08T06:00:00Z"]); // read off the fixture
    const out = selectSealCandidates(rows, cutoffMs);
    expect(out.map((r: any) => r.scan_id)).toEqual(sealedIds);
  });

  it("the newest candidate's ts is the fixture's own floor_ts", () => {
    const out = selectSealCandidates(rows, cutoffMs);
    expect(out[out.length - 1]!.ts).toBe(fx.expected.real.floor_ts);
    expect(out[out.length - 1]!.ts).toBe(fx.expected.dry_run.floor_ts);
  });

  it("stops at the first scan newer than cutoff (prefix rule)", () => {
    const out = selectSealCandidates(rows, Date.parse("2026-01-05T00:00:00Z"));
    expect(out.map((r: any) => r.scan_id)).toEqual(["2026-01-01T06:00:00Z"]);
  });

  it("stops at unparseable timestamps", () => {
    const bad = [{ scan_id: "x", ts: "junk" }, ...rows];
    expect(selectSealCandidates(bad, cutoffMs)).toEqual([]);
  });

  it("no shape column: the last MIN_UNSEALED_FLAT_SCANS rows are still protected without a shape filter first", () => {
    // gas/'s version computed the protected set from `rows.filter(shape === "flat")` before
    // taking the tail; a naive drop of that filter without also dropping the intermediate list
    // (rather than folding straight into `rows`) could protect the wrong set, or none at all,
    // when a row carries no `shape`. Three rows, MIN_UNSEALED_FLAT_SCANS = 2: the oldest must
    // seal and the newest two must stay protected even with a cutoff that would otherwise pass
    // all three.
    const rows3 = [
      { scan_id: "a", ts: "2020-01-01T00:00:00Z" },
      { scan_id: "b", ts: "2020-02-01T00:00:00Z" },
      { scan_id: "c", ts: "2020-03-01T00:00:00Z" },
    ];
    expect(selectSealCandidates(rows3, Date.parse("2030-01-01T00:00:00Z")).map((r) => r.scan_id))
      .toEqual(["a"]);
  });
});

describe("episodeEligible (ledger_compaction.json fixture parity)", () => {
  const fx = fixture("ledger_compaction");
  const floorMs = Date.parse(fx.expected.real.floor_ts);

  // The two lifecycles the fixture actually converts to episodes (expected.after_compact.episodes)
  // and the three that stay live (expected.after_compact.ledger) — every input below is a
  // status/resolved_at pair read straight off the fixture's own expected block.
  it("the fixture's converted episodes (id:B, id:D) are eligible against its own floor", () => {
    for (const ep of fx.expected.after_compact.episodes) {
      expect(episodeEligible({ status: "RESOLVED", resolved_at: ep.resolved_at }, floorMs)).toBe(true);
    }
    expect(fx.expected.after_compact.episodes.map((e: any) => e.vuln_key).sort()).toEqual(["id:B", "id:D"]);
  });

  it("the fixture's still-live rows are NOT eligible against its own floor", () => {
    for (const [key, row] of Object.entries(fx.expected.after_compact.ledger) as [string, any][]) {
      expect(episodeEligible({ status: row.status, resolved_at: row.resolved_at }, floorMs)).toBe(false);
    }
    expect(Object.keys(fx.expected.after_compact.ledger).sort()).toEqual(["id:A", "id:C", "id:E"]);
  });

  it("resolved before the floor -> eligible; open, or resolved after the floor -> not", () => {
    const floor = Date.parse("2026-03-01T00:00:00Z");
    expect(episodeEligible({ status: "RESOLVED", resolved_at: "2026-02-01T00:00:00Z" }, floor)).toBe(true);
    expect(episodeEligible({ status: "OPEN", resolved_at: null }, floor)).toBe(false);
    expect(episodeEligible({ status: "RESOLVED", resolved_at: "2026-04-01T00:00:00Z" }, floor)).toBe(false);
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
