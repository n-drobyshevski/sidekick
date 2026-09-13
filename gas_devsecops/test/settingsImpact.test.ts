// Port of gas/test/settingsImpact.test.ts's severityCensus/scanAges/wouldSeal cases, plus new
// coverage for strandedOpenCount — the one figure gas/ never had to compute (see
// src/domain/settingsImpact.ts's header for why this register needs it and gas/ does not) — and,
// added in P6b, ageHistogram/atOrBelow: the day-axis twin of gas/'s EPSS cube.
//
// No fixture: every case here is small enough to construct inline, the same way gas/'s own
// severityCensus/scanAges/wouldSeal tests do (only its risk-cube tests use a generated
// population).

import { describe, expect, it } from "vitest";
import {
  AGE_HISTOGRAM_CAP_DAYS, MIN_UNSEALED_FLAT_SCANS, SCOPES, SEVERITY_ORDER, SLA_TARGETS,
  type Scope,
} from "../src/domain/config";
import { openPastSla, type RemediationRow } from "../src/domain/remediation";
import {
  ageHistogram,
  atOrBelow,
  scanAges,
  severityCensus,
  strandedOpenCount,
  wouldSeal,
  type AgeBin,
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

describe("ageHistogram / atOrBelow", () => {
  type Row = { severity: string; status: string; age_days: number | null };
  const isOpen = (r: Row) => r.status === "OPEN";

  // A deliberately small cap (40, not the real 730) so "exact at every integer window" is a
  // fast, readable loop. Ages are chosen to straddle every edge that matters: exact-day values,
  // fractional values either side of an integer target, day 0, the cap itself, and one row past
  // it (overCap) per severity. HIGH also carries a resolved row (must never be counted at all)
  // and an unaged one (must never be counted as day 0).
  const CAP = 40;
  const rows: Row[] = [
    { severity: "HIGH", status: "OPEN", age_days: 0 },
    { severity: "HIGH", status: "OPEN", age_days: 0.4 },
    { severity: "HIGH", status: "OPEN", age_days: 13.5 }, // ceil -> day 14: NOT a breach at target 14
    { severity: "HIGH", status: "OPEN", age_days: 14.0 }, // ceil -> day 14: exactly at target 14
    { severity: "HIGH", status: "OPEN", age_days: 14.0000001 }, // ceil -> day 15: a breach at target 14
    { severity: "HIGH", status: "OPEN", age_days: 39.9 }, // ceil -> day 40: exactly at the cap
    { severity: "HIGH", status: "OPEN", age_days: 45 }, // past the cap -> overCap
    { severity: "HIGH", status: "OPEN", age_days: null }, // unaged
    { severity: "HIGH", status: "RESOLVED", age_days: 5 }, // not open -> excluded entirely
    { severity: "LOW", status: "OPEN", age_days: 2 },
    { severity: "LOW", status: "OPEN", age_days: 2 },
    { severity: "LOW", status: "OPEN", age_days: 100 }, // past the cap -> overCap
    { severity: "INFO", status: "OPEN", age_days: null }, // unaged only: no finite-aged rows at all
  ];

  const hist = ageHistogram(rows, (r) => r.severity, isOpen, (r) => r.age_days, CAP);

  it("is exact at every integer window from 0 to capDays, not merely close", () => {
    for (const sev of ["HIGH", "LOW"]) {
      const bin = hist[sev]!;
      const finiteOpenTotal = atOrBelow(bin, CAP) + bin.overCap;
      for (let t = 0; t <= CAP; t++) {
        const direct = rows.filter((r) =>
          r.severity === sev && isOpen(r) &&
          typeof r.age_days === "number" && Number.isFinite(r.age_days) && r.age_days > t,
        ).length;
        expect(finiteOpenTotal - atOrBelow(bin, t)).toBe(direct);
      }
    }
  });

  it("agrees with openPastSla at the canonical SLA_TARGETS, so the two paths cannot drift", () => {
    // The real cap (730) comfortably covers every SLA_TARGETS value (max 180, INFO) — the
    // agreement has to hold at the cap this endpoint actually ships, not the test's small one.
    const remediationRows: RemediationRow[] = rows.map((r) => ({
      severity: r.severity, status: r.status, mttr_days: null, age_days: r.age_days,
    }));
    const expected = openPastSla(remediationRows);
    const hist730 = ageHistogram(rows, (r) => r.severity, isOpen, (r) => r.age_days);

    for (const [sev, target] of Object.entries(SLA_TARGETS)) {
      const wantBreached = expected.perSev[sev]?.breached ?? 0;
      const bin = hist730[sev];
      if (!bin) {
        expect(wantBreached).toBe(0);
        continue;
      }
      const finiteOpenTotal = atOrBelow(bin, AGE_HISTOGRAM_CAP_DAYS) + bin.overCap;
      expect(finiteOpenTotal - atOrBelow(bin, target)).toBe(wantBreached);
    }
  });

  it("never counts an unaged row inside any window -- the Number(null)=0 trap", () => {
    const bin = hist["HIGH"]!;
    expect(bin.unaged).toBe(1);
    // Day 0 holds exactly the one row genuinely aged 0 -- not that row plus the unaged one,
    // which is what Number(null) coercing to 0 would have produced.
    expect(atOrBelow(bin, 0)).toBe(1);
    expect(atOrBelow(bin, CAP)).toBe(6); // every finite-aged HIGH row at or under the cap
  });

  it("names a row past capDays as overCap rather than folding or extrapolating it into counts", () => {
    const high = hist["HIGH"]!;
    const low = hist["LOW"]!;
    expect(high.overCap).toBe(1); // the age=45 row
    expect(low.overCap).toBe(1); // the age=100 row
    // The array never grows to accommodate an overCap row.
    expect(high.from + high.counts.length - 1).toBeLessThanOrEqual(CAP);
    expect(atOrBelow(high, CAP)).toBe(6); // unchanged by the overCap row
  });

  it("truncates leading/trailing zero days; from + counts round-trips the same answers", () => {
    const low = hist["LOW"]!;
    // Both LOW rows share day 2; nothing before or after it is stored.
    expect(low.from).toBe(2);
    expect(low.counts).toEqual([2]);
    for (let t = 0; t <= CAP; t++) {
      const direct = rows.filter((r) =>
        r.severity === "LOW" && isOpen(r) &&
        typeof r.age_days === "number" && Number.isFinite(r.age_days) && r.age_days <= t,
      ).length;
      expect(atOrBelow(low, t)).toBe(direct);
    }
  });

  it("emits empty counts for a (scope, severity) pair with no open rows in cap, not a dense zero array", () => {
    const info = hist["INFO"]!;
    expect(info).toEqual({ counts: [], from: 0, overCap: 0, unaged: 1 });
    expect(atOrBelow(info, 0)).toBe(0);
    expect(atOrBelow(info, CAP)).toBe(0);
  });

  it("omits a severity with no open rows at all rather than inventing an empty entry", () => {
    // MEDIUM never appears in `rows` at all (open or resolved), so no bucket is created for it.
    expect(hist["MEDIUM"]).toBeUndefined();
  });

  it("excludes resolved rows entirely, even from unaged/overCap, not just from counts", () => {
    // The resolved HIGH row (age_days: 5) would land at day 5 (ceil(5) = 5) if it were counted;
    // the only OPEN rows at or under day 5 are day 0 (age 0) and day 1 (age 0.4, ceil -> 1). If
    // the resolved row leaked in, this would read 3.
    const high = hist["HIGH"]!;
    expect(atOrBelow(high, 5)).toBe(2);
  });

  it("defaults capDays to config.AGE_HISTOGRAM_CAP_DAYS (730) when none is passed", () => {
    expect(AGE_HISTOGRAM_CAP_DAYS).toBe(730);
    const defaulted = ageHistogram(rows, (r) => r.severity, isOpen, (r) => r.age_days);
    const explicit = ageHistogram(rows, (r) => r.severity, isOpen, (r) => r.age_days, AGE_HISTOGRAM_CAP_DAYS);
    expect(defaulted).toEqual(explicit);
  });
});
