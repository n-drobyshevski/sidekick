// Port of gas/test/settingsImpact.test.ts's severityCensus/scanAges/wouldSeal cases, plus new
// coverage for strandedOpenCount — the one figure gas/ never had to compute (see
// src/domain/settingsImpact.ts's header for why this register needs it and gas/ does not).
//
// No fixture: every case here is small enough to construct inline, the same way gas/'s own
// severityCensus/scanAges/wouldSeal tests do (only its risk-cube tests use a generated
// population).

import { describe, expect, it } from "vitest";
import { MIN_UNSEALED_FLAT_SCANS, SCOPES, SEVERITY_ORDER, type Scope } from "../src/domain/config";
import {
  scanAges,
  severityCensus,
  strandedOpenCount,
  wouldSeal,
  type ScopeCensus,
} from "../src/domain/settingsImpact";

describe("severityCensus", () => {
  it("counts the unfiltered population, so a filter change can be previewed", () => {
    const rows = [
      { s: "HIGH", o: true }, { s: "HIGH", o: false }, { s: "LOW", o: true },
    ];
    expect(severityCensus(rows, (r) => r.s, (r) => r.o))
      .toEqual({ all: { HIGH: 2, LOW: 1 }, open: { HIGH: 1, LOW: 1 } });
  });

  it("is empty for no rows rather than throwing", () => {
    expect(severityCensus([], () => "HIGH", () => true)).toEqual({ all: {}, open: {} });
  });
});

describe("scanAges", () => {
  const NOW = Date.parse("2026-08-26T00:00:00Z");
  const day = (n: number, scope: Scope = "sca") => ({
    scope, ts: new Date(NOW - n * 86_400_000).toISOString(),
  });
  const scans = [
    { ...day(400), sealed: 1 as const },
    { ...day(200), sealed: 1 as const },
    { ...day(100), sealed: 0 as const },
    { ...day(10), sealed: 0 as const },
    { ...day(1), sealed: 0 as const },
  ];

  it("reads newest-first, because loadScanRows hands them over oldest-first", () => {
    expect(scanAges(scans, NOW).map((a) => a.ageDays)).toEqual([1, 10, 100, 200, 400]);
  });

  it("defaults keepRecent off config.MIN_UNSEALED_FLAT_SCANS, not a private literal", () => {
    expect(MIN_UNSEALED_FLAT_SCANS).toBe(2);
    expect(scanAges(scans, NOW).map((a) => a.pinned)).toEqual([true, true, false, false, false]);
  });

  it("honors an explicit keepRecent override", () => {
    expect(scanAges(scans, NOW, 1).map((a) => a.pinned)).toEqual([true, false, false, false, false]);
  });

  it("carries each tick's own scope, for the one shared lane", () => {
    const mixed = [
      { scope: "sca" as const, ts: day(30).ts, sealed: 0 as const },
      { scope: "sast" as const, ts: day(30).ts, sealed: 0 as const },
      { scope: "secrets" as const, ts: day(30).ts, sealed: 0 as const },
    ];
    expect(scanAges(mixed, NOW).map((a) => a.scope).sort())
      .toEqual(["sast", "sca", "secrets"]);
  });

  it("survives an unparseable timestamp instead of rendering NaN", () => {
    expect(scanAges([{ scope: "sca" as const, ts: "not a date", sealed: 0 as const }], NOW)[0]!.ageDays)
      .toBe(0);
  });
});

describe("wouldSeal", () => {
  const NOW = Date.parse("2026-08-26T00:00:00Z");
  const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
  const ages = scanAges([
    { scope: "sca" as const, ts: day(400), sealed: 1 as const },
    { scope: "sca" as const, ts: day(300), sealed: 0 as const },
    { scope: "sast" as const, ts: day(200), sealed: 0 as const },
    { scope: "secrets" as const, ts: day(10), sealed: 0 as const },
    { scope: "sca" as const, ts: day(1), sealed: 0 as const },
  ], NOW);

  it("counts only unsealed scans past the window", () => {
    expect(wouldSeal(ages, 180)).toBe(2);
  });

  it("never counts an already-sealed scan twice", () => {
    expect(wouldSeal(ages, 1)).toBe(2); // the 300 and 200 day scans; 400 is sealed
  });

  it("never counts the pinned two, however old the window says", () => {
    expect(wouldSeal(ages, 0)).toBe(2);
  });

  it("seals nothing when the window is off", () => {
    expect(wouldSeal(ages, null)).toBe(0);
  });
});

describe("strandedOpenCount", () => {
  /** A scope's census with a given open-by-severity map; `total`/`all` are not read by
   *  strandedOpenCount, so they are filled with harmless placeholders. */
  function census(openBySeverity: Record<string, number>): ScopeCensus {
    const openTotal = Object.values(openBySeverity).reduce((a, b) => a + b, 0);
    return { total: openTotal, openTotal, bySeverity: { all: {}, open: openBySeverity } };
  }

  const full: Record<Scope, ScopeCensus> = {
    sca: census({ CRITICAL: 5, HIGH: 10, MEDIUM: 3 }),
    sast: census({ CRITICAL: 2, HIGH: 4 }),
    secrets: census({ HIGH: 1, LOW: 6, INFO: 2 }),
  };

  it("strands nothing for the saved, unnarrowed default — every scope kept, every gate open", () => {
    const got = strandedOpenCount(
      full,
      [...SCOPES],
      { sca: [], sast: [], secrets: [] },
    );
    expect(got).toEqual({ total: 0, byScope: { sca: 0, sast: 0, secrets: 0 } });
  });

  it("strands every open row in a scope dropped from the draft entirely", () => {
    const got = strandedOpenCount(
      full,
      ["sca", "sast"], // secrets dropped
      { sca: [], sast: [] },
    );
    expect(got.byScope.secrets).toBe(9); // 1 + 6 + 2
    expect(got.byScope.sca).toBe(0);
    expect(got.byScope.sast).toBe(0);
    expect(got.total).toBe(9);
  });

  it("strands only the open rows at severities the narrowed gate no longer requests", () => {
    const got = strandedOpenCount(
      full,
      [...SCOPES],
      { sca: ["CRITICAL", "HIGH"], sast: [], secrets: [] }, // sca narrowed off MEDIUM
    );
    expect(got.byScope.sca).toBe(3); // the MEDIUM rows
    expect(got.byScope.sast).toBe(0);
    expect(got.byScope.secrets).toBe(0);
    expect(got.total).toBe(3);
  });

  it("[] means every severity: widening a scope back to unfiltered strands nothing there", () => {
    const got = strandedOpenCount(
      full,
      [...SCOPES],
      { sca: [], sast: ["CRITICAL"], secrets: [] }, // sast narrowed, sca/secrets unfiltered
    );
    expect(got.byScope.sca).toBe(0);
    expect(got.byScope.secrets).toBe(0);
    expect(got.byScope.sast).toBe(4); // the HIGH rows
  });

  it("combines a dropped scope with a narrowed one in the same draft", () => {
    const got = strandedOpenCount(
      full,
      ["sast", "secrets"], // sca dropped entirely
      { sast: ["CRITICAL"], secrets: [] }, // sast also narrowed off HIGH
    );
    expect(got.byScope.sca).toBe(18); // the whole scope: 5 + 10 + 3
    expect(got.byScope.sast).toBe(4); // the HIGH rows
    expect(got.byScope.secrets).toBe(0);
    expect(got.total).toBe(22);
  });

  it("is zero for a scope absent from the census entirely, rather than throwing", () => {
    const partial: Partial<Record<Scope, ScopeCensus>> = { sca: full.sca };
    const got = strandedOpenCount(partial, ["sca"], { sca: ["CRITICAL"] });
    // HIGH + MEDIUM stranded (only CRITICAL still requested); sast/secrets absent from the
    // census entirely, so they read 0 rather than throwing.
    expect(got.byScope).toEqual({ sca: 13, sast: 0, secrets: 0 });
    expect(got.total).toBe(13);
  });

  it("a severity outside severityOrder can never be requested, so it always strands once narrowed", () => {
    // UNKNOWN is SEVERITY_ORDER's own local normalization bucket (severity.ts) — never
    // user-selectable, so it can never appear in a draft's fetchSeverities. Once a scope is
    // narrowed at all, any UNKNOWN-severity open rows are stranded along with the rest.
    expect(SEVERITY_ORDER).toContain("UNKNOWN");
    const withUnknown: Record<Scope, ScopeCensus> = {
      ...full,
      sca: census({ CRITICAL: 5, UNKNOWN: 1 }),
    };
    const got = strandedOpenCount(withUnknown, [...SCOPES], { sca: ["CRITICAL"], sast: [], secrets: [] });
    expect(got.byScope.sca).toBe(1);
  });
});
