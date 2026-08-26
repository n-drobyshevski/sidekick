// The Settings impact payload, and the one property that matters most about it: the cube the
// browser re-aggregates must produce the SAME breakdown as counting the rows directly. If those
// two ever disagree, the classifier card lies while you drag the threshold and tells the truth
// only after you save — the exact failure the cube exists to prevent.

import { describe, expect, it } from "vitest";
import {
  breakdownFromCube,
  buildRiskCube,
  emptyCube,
  epssBin,
  EPSS_BINS,
  epssHistogram,
  scanAges,
  severityCensus,
  toggleImpact,
  wouldSeal,
} from "../src/domain/settingsImpact";
import { signalBreakdown, type RiskRow, type RiskRule } from "../src/domain/program";

/** A deterministic population with every tri-state combination represented. */
function population(n = 600): RiskRow[] {
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const rows: RiskRow[] = [];
  for (let i = 0; i < n; i++) {
    const u = rnd();
    rows.push({
      severity: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"][i % 5]!,
      status: i % 7 === 0 ? "resolved" : "open",
      has_kev: u < 0.1 ? true : u < 0.85 ? false : null,
      has_exploit: rnd() < 0.2 ? true : rnd() < 0.9 ? false : null,
      epss: rnd() < 0.12 ? null : Math.round(rnd() * 100) / 100,
    });
  }
  return rows;
}

const RULES: RiskRule[] = [
  { kev: true, exploit: true, epss: true, epssThreshold: 0.1 },
  { kev: true, exploit: true, epss: true, epssThreshold: 0 },
  { kev: true, exploit: true, epss: true, epssThreshold: 1 },
  { kev: true, exploit: false, epss: true, epssThreshold: 0.5 },
  { kev: false, exploit: true, epss: false, epssThreshold: 0.1 },
  { kev: false, exploit: false, epss: true, epssThreshold: 0.07 },
  { kev: false, exploit: false, epss: false, epssThreshold: 0.1 },
];

describe("the cube reproduces signalBreakdown", () => {
  const rows = population();
  const cube = buildRiskCube(rows);

  it("counts every row exactly once", () => {
    expect(cube.total).toBe(rows.length);
    let n = 0;
    for (const cell of Object.values(cube.cells)) {
      n += cell.noEpss + cell.epss.reduce((a, b) => a + b, 0);
    }
    expect(n).toBe(rows.length);
  });

  for (const rule of RULES) {
    it(`agrees on ${JSON.stringify(rule)}`, () => {
      expect(breakdownFromCube(cube, rule)).toEqual(signalBreakdown(rows, rule));
    });
  }

  // The bin edges are where a float bug hides: 0.07 * 100 is 7.000000000000001.
  it("agrees at every 0.01 threshold the control can produce", () => {
    for (let i = 0; i <= 100; i++) {
      const rule: RiskRule = { kev: true, exploit: true, epss: true, epssThreshold: i / 100 };
      expect(breakdownFromCube(cube, rule), `threshold ${i / 100}`)
        .toEqual(signalBreakdown(rows, rule));
    }
  });

  it("never lets a missing signal read as a negative one", () => {
    const rows2: RiskRow[] = [
      { severity: "HIGH", status: "open", has_kev: null, has_exploit: null, epss: null },
    ];
    const b = breakdownFromCube(buildRiskCube(rows2), RULES[0]!);
    expect(b).toEqual(signalBreakdown(rows2, RULES[0]!));
    expect(b.anyOf).toBe(0);
    expect(b).toMatchObject({ kevMissing: 1, exploitMissing: 1, epssMissing: 1 });
  });

  it("reports no missing counts for a clause that is switched off", () => {
    const rows2: RiskRow[] = [
      { severity: "HIGH", status: "open", has_kev: null, has_exploit: null, epss: null },
    ];
    const off: RiskRule = { kev: false, exploit: false, epss: false, epssThreshold: 0.1 };
    expect(breakdownFromCube(buildRiskCube(rows2), off))
      .toMatchObject({ kevMissing: 0, exploitMissing: 0, epssMissing: 0, anyOf: 0 });
  });
});

describe("epssBin", () => {
  // This used to assert `EPSS_BINS - 1` — that a perfect score clamps into the [0.99, 1.00)
  // bin. Measurement falsified the claim behind it: with 1.0 clamped there, a threshold of
  // 1.00 took its cut ABOVE that bin and counted zero rows, while signalBreakdown counted
  // every row scoring exactly 1.0. The extra top bin exists to close that gap, so 1.0 now
  // lands in a bin of its own.
  it("gives a perfect score its own bin, so a 1.00 threshold can still find it", () => {
    expect(epssBin(1)).toBe(EPSS_BINS);
    expect(epssBin(0.999)).toBe(EPSS_BINS - 1);
  });
  it("puts 0 in the first bin", () => {
    expect(epssBin(0)).toBe(0);
  });
  it("is left-closed: a score on a bin edge belongs to the higher bin", () => {
    expect(epssBin(0.1)).toBe(10);
    expect(epssBin(0.0999)).toBe(9);
  });
});

describe("epssHistogram", () => {
  const cube = buildRiskCube(population());
  it("preserves the total across the coarser buckets", () => {
    const h = epssHistogram(cube, 20);
    expect(h.buckets.reduce((a, b) => a + b, 0) + h.unmeasured).toBe(cube.total);
  });
  it("keeps the never-measured rows out of the buckets entirely", () => {
    const only: RiskRow[] = [
      { severity: "HIGH", status: "open", has_kev: false, has_exploit: false, epss: null },
    ];
    const h = epssHistogram(buildRiskCube(only), 20);
    expect(h.unmeasured).toBe(1);
    expect(h.buckets.every((b) => b === 0)).toBe(true);
  });
  it("is empty for an empty cube", () => {
    const h = epssHistogram(emptyCube(), 20);
    expect(h.unmeasured).toBe(0);
    expect(h.buckets).toHaveLength(20);
  });
});

describe("toggleImpact", () => {
  const rows = [
    { n: true, e: false }, { n: true, e: true }, { n: false, e: true },
    { n: false, e: false }, { n: false, e: false },
  ];
  const got = toggleImpact(rows, (r) => r.n, (r) => r.e);

  it("counts each toggle's own population", () => {
    expect(got).toMatchObject({ total: 5, noFix: 2, eol: 2 });
  });

  // The whole reason `either` is reported rather than left to the page to add up.
  it("reports the union, which is smaller than the sum when the sets overlap", () => {
    expect(got.either).toBe(3);
    expect(got.either).toBeLessThan(got.noFix + got.eol);
  });
});

describe("severityCensus", () => {
  it("counts the unfiltered population, so a filter change can be previewed", () => {
    const rows = [{ s: "HIGH" }, { s: "HIGH" }, { s: "LOW" }];
    expect(severityCensus(rows, (r) => r.s)).toEqual({ HIGH: 2, LOW: 1 });
  });
  it("is empty for no rows rather than throwing", () => {
    expect(severityCensus([], () => "HIGH")).toEqual({});
  });
});

describe("scanAges", () => {
  const NOW = Date.parse("2026-08-26T00:00:00Z");
  const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
  const scans = [
    { ts: day(400), sealed: 1 as const },
    { ts: day(200), sealed: 1 as const },
    { ts: day(100), sealed: 0 as const },
    { ts: day(10), sealed: 0 as const },
    { ts: day(1), sealed: 0 as const },
  ];

  it("reads newest-first, because loadScanRows hands them over oldest-first", () => {
    expect(scanAges(scans, NOW).map((a) => a.ageDays)).toEqual([1, 10, 100, 200, 400]);
  });

  it("pins the two most recent — the floor sealing never crosses", () => {
    expect(scanAges(scans, NOW).map((a) => a.pinned)).toEqual([true, true, false, false, false]);
  });

  it("survives an unparseable timestamp instead of rendering NaN", () => {
    expect(scanAges([{ ts: "not a date", sealed: 0 }], NOW)[0]!.ageDays).toBe(0);
  });
});

describe("wouldSeal", () => {
  const NOW = Date.parse("2026-08-26T00:00:00Z");
  const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
  const ages = scanAges([
    { ts: day(400), sealed: 1 },
    { ts: day(300), sealed: 0 },
    { ts: day(200), sealed: 0 },
    { ts: day(10), sealed: 0 },
    { ts: day(1), sealed: 0 },
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
