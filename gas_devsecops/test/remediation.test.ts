// D4 — Kaplan–Meier. Port of the KM-relevant sections of gas/test/remediation.test.ts
// (describe blocks: kmMedian, kaplanMeier, kmQuantileFromCurve — ~186 of gas/'s 785 lines),
// plus a new brick-fixture parity suite the gas/ file has no equivalent of (brick/devsecops
// is a second, independently-implemented oracle — see test/fixtures/brick/km.json).
//
// Dropped from gas/'s file, and why: everything outside the KM engine (mttrPercentiles,
// resolutionBuckets, openPastSla/openPastSlaFromRecords, actionableView, awaitingVendorFix,
// the latency clocks, baseRowNoFix/recordNoFix) is out of scope for this package — remediation.ts
// here ports ONLY kmCurve/kmQuantileFromCurve/kmMedianFromCurve/kaplanMeier/kmMedian (see that
// file's header). Within the KM-relevant material, the ONE deliberate drop is EOL: the
// "isEndOfLifeName / recordEol" describe block and the "EOL findings excluded from the MTTR
// KPI" describe block (which drives kaplanMeier directly) are both gone — a code register has
// no host OS to be end-of-life, so isEndOfLifeName/recordEol don't exist here to test.

import { describe, expect, it } from "vitest";
import {
  kaplanMeier,
  kmMedian,
  kmMedianFromCurve,
  kmQuantileFromCurve,
  type KMPoint,
  type RemediationRow,
} from "../src/domain/remediation";
import { OVERALL } from "../src/domain/config";
import { brickFixture, expectParity } from "./helpers";

// Ledger-base projections: a resolved row carries a finite mttr_days; an open row
// carries a finite age_days and an open status. (severity | status | mttr_days | age_days.)
const res = (mttr_days: number | null, severity = "HIGH") => ({
  severity,
  status: "RESOLVED",
  mttr_days,
  age_days: null,
});
const open = (age_days: number | null, severity = "HIGH", status = "OPEN") => ({
  severity,
  status,
  mttr_days: null,
  age_days,
});

describe("kmMedian", () => {
  it("all resolved: crosses at the known event time", () => {
    // events 1,2,3,4 (no censoring). S: t1 = 1-1/4 = .75; t2 = .75*(1-1/3) = .5 <= .5 -> 2.
    expect(kmMedian([res(1), res(2), res(3), res(4)])).toBe(2);
  });

  it("exact-0.5 tie returns that event time", () => {
    // events 1,2: t1 n=2 d=1 S = 1-1/2 = .5 <= .5 -> 1.
    expect(kmMedian([res(1), res(2)])).toBe(1);
  });

  it("all open (censored) -> null; empty -> null", () => {
    expect(kmMedian([open(5), open(10)])).toBeNull();
    expect(kmMedian([])).toBeNull();
  });

  it("heavy censoring keeping S > 0.5 -> null", () => {
    // one event at 5, four censored at 6,7,8,9: t5 n=5 d=1 S=.8 > .5, no later event -> null.
    expect(kmMedian([res(5), open(6), open(7), open(8), open(9)])).toBeNull();
  });

  it("censoring after the median does not move it", () => {
    // events 1,1,1,2: t1 n=4 d=3 S = 1-3/4 = .25 <= .5 -> 1.
    expect(kmMedian([res(1), res(1), res(1), res(2)])).toBe(1);
    // add a censored obs at 10 (after the median): t1 n=5 d=3 S = 1-3/5 = .4 <= .5 -> still 1.
    expect(kmMedian([res(1), res(1), res(1), res(2), open(10)])).toBe(1);
  });
});

describe("kaplanMeier", () => {
  it("all resolved: full curve, median, and RMST mean equal the naive mean", () => {
    // events 1,2,3,4 (no censoring). S drops .75/.5/.25/0 over risk sets 4/3/2/1.
    const km = kaplanMeier([res(1), res(2), res(3), res(4)]);
    expect(km.curve).toEqual([
      { t: 1, s: 0.75, atRisk: 4, events: 1 },
      { t: 2, s: 0.5, atRisk: 3, events: 1 },
      { t: 3, s: 0.25, atRisk: 2, events: 1 },
      { t: 4, s: 0, atRisk: 1, events: 1 },
    ]);
    expect(km.median).toBe(2); // first S <= .5
    expect(km.medianLowerBound).toBeNull(); // median known
    expect(km.restrictionTime).toBe(4); // τ = max observed
    // RMST = 1·1 + .75·1 + .5·1 + .25·1 + 0·0 = 2.5.
    expect(km.mean).toBe(2.5);
    expect(km.meanTruncated).toBe(false); // S(τ) = 0
    expect(km.naiveMean).toBe(2.5);
    expect(km.naiveMedian).toBe(2.5);
    expect(km.events).toBe(4);
    expect(km.censored).toBe(0);
    expect(km.total).toBe(4);
  });

  it("exact-0.5 crossing: median at the tie, mean is the curve area", () => {
    // events 1,2: t1 n=2 d=1 S=.5 (<= .5 -> median 1); t2 n=1 d=1 S=0.
    const km = kaplanMeier([res(1), res(2)]);
    expect(km.median).toBe(1);
    // RMST = 1·1 + .5·1 = 1.5.
    expect(km.mean).toBe(1.5);
    expect(km.meanTruncated).toBe(false);
  });

  it("heavy censoring: null median with a lower bound, truncated RMST", () => {
    // one event at 5, four censored at 6,7,8,9. t5 n=5 d=1 S=.8 (> .5, no later event).
    const km = kaplanMeier([res(5), open(6), open(7), open(8), open(9)]);
    expect(km.curve).toEqual([{ t: 5, s: 0.8, atRisk: 5, events: 1 }]);
    expect(km.median).toBeNull();
    expect(km.medianLowerBound).toBe(9); // "> 9d" — the max observed time
    expect(km.restrictionTime).toBe(9);
    // RMST = 1·5 + .8·(9-5) = 5 + 3.2 = 8.2, a lower bound since S(τ) = .8 > 0.
    expect(km.mean).toBe(8.2);
    expect(km.meanTruncated).toBe(true);
    expect(km.naiveMean).toBe(5); // only the one resolved sample
    expect(km.naiveMedian).toBe(5);
    expect(km.events).toBe(1);
    expect(km.censored).toBe(4);
    expect(km.total).toBe(5);
  });

  it("all censored: empty curve, null median/mean, lower bound at max age", () => {
    const km = kaplanMeier([open(5), open(10)]);
    expect(km.curve).toEqual([]);
    expect(km.median).toBeNull();
    expect(km.medianLowerBound).toBe(10);
    expect(km.mean).toBeNull();
    expect(km.restrictionTime).toBe(10);
    expect(km.meanTruncated).toBe(false);
    expect(km.naiveMean).toBeNull();
    expect(km.naiveMedian).toBeNull();
    expect(km.events).toBe(0);
    expect(km.censored).toBe(2);
    expect(km.total).toBe(2);
  });

  it("ties at a single event time: one point, median = mean = that time", () => {
    // three events at 5: t5 n=3 d=3 S=0. Curve is a single drop straight to 0.
    const km = kaplanMeier([res(5), res(5), res(5)]);
    expect(km.curve).toEqual([{ t: 5, s: 0, atRisk: 3, events: 3 }]);
    expect(km.median).toBe(5);
    // RMST = 1·5 + 0·0 = 5.
    expect(km.mean).toBe(5);
    expect(km.meanTruncated).toBe(false);
  });

  it("empty: all nulls, counts 0", () => {
    expect(kaplanMeier([])).toEqual({
      curve: [],
      median: null,
      medianLowerBound: null,
      mean: null,
      restrictionTime: null,
      meanTruncated: false,
      naiveMean: null,
      naiveMedian: null,
      events: 0,
      censored: 0,
      total: 0,
    });
  });

  it("kmMedian is the estimator's .median", () => {
    const rows = [res(1), res(2), res(3), res(4)];
    expect(kmMedian(rows)).toBe(kaplanMeier(rows).median);
  });

  // THIS TEST CARRIES AN EXPLICIT TIMEOUT BECAUSE IT IS LEGITIMATELY SLOW, not because it is
  // flaky. `kaplanMeier` costs about 7us per row and this feeds it 200k of them, so it measures
  // ~2.8s on a 4-core x64 box — against vitest's 5s default, which is only 1.7x headroom. On a
  // smaller machine (a 2-vCPU cloud shell, a shared CI runner) that tips over and the suite
  // fails on a claim that is still perfectly true. The generous budget below is the honest fix:
  // nothing about the assertion is weakened, only the clock it is judged against.
  //
  // N STAYS AT 200k, and shrinking it would be the wrong way to make this fast. The argument
  // limit is a function of the available stack, so it MOVES with the engine and the
  // environment — measured at 125,275 on node 22 / x64, but lower where the stack is smaller
  // and higher where it is larger. Tuning N toward that number would calibrate the test to one
  // machine and risk it silently ceasing to test anything on another.
  //
  // For fast feedback this is no longer the only guard: `test/util.test.ts` asserts the same
  // regression directly against `maxNum` / `minNum` / `pushAll` in ~15ms. What THIS test adds,
  // and why it stays, is coverage of a spread written inline somewhere on the estimator's own
  // path, where no helper would be involved to catch it.
  it("large risk set does not overflow the call stack (regression: Math.max(...times) spread)", () => {
    // The risk set holds one observation per finding, so a real register is tens of thousands
    // of entries. Spreading it into Math.max/Math.min ("Math.max(...times)") overflows the call
    // stack once the array is large — the crash that took down the Executive view (which asks
    // for every severity, maximizing the set). 200k rows is well past that spread limit; maxNum
    // must fold it with a two-arg reduce instead. Guards against reintroducing the spread.
    const N = 200_000;
    const rows: RemediationRow[] = [];
    for (let i = 0; i < N; i++) rows.push(res((i % 500) + 1));
    const km = kaplanMeier(rows);
    expect(km.total).toBe(N);
    expect(km.events).toBe(N);
    expect(km.restrictionTime).toBe(500); // maxNum(times) — the largest mttr_days
  }, 30_000);
});

describe("kmQuantileFromCurve", () => {
  // Synthetic staircase with exact-binary survivals, so the threshold ties are float-clean (0.10
  // is not a binary fraction — a real KM product landing "on" 0.10 can drift either side of it).
  const curve: KMPoint[] = [
    { t: 2, s: 0.5, atRisk: 4, events: 1 },
    { t: 4, s: 0.25, atRisk: 2, events: 1 },
    { t: 6, s: 0.0625, atRisk: 1, events: 1 },
  ];

  it("returns the first t whose survival has fallen to <= 1 - q (inclusive)", () => {
    expect(kmQuantileFromCurve(curve, 0.5)).toBe(2);  // S <= 0.50 at t=2 (exact tie)
    expect(kmQuantileFromCurve(curve, 0.75)).toBe(4); // S <= 0.25 at t=4 (exact tie)
    expect(kmQuantileFromCurve(curve, 0.9)).toBe(6);  // p90: S <= 0.10 first at t=6; 0.25 skipped
  });

  it("delegates the median: q=0.5 equals kmMedianFromCurve", () => {
    const c = kaplanMeier([res(1), res(2), res(3), res(4)]).curve;
    expect(kmQuantileFromCurve(c, 0.5)).toBe(kmMedianFromCurve(c));
    expect(kmMedianFromCurve(c)).toBe(2);
  });

  it("null when survival never falls to 1 - q (heavy censoring) or the curve is empty", () => {
    // one event at 5, four censored: S stalls at 0.8, reaching neither 0.5 nor 0.1.
    const censored = kaplanMeier([res(5), open(6), open(7), open(8), open(9)]).curve;
    expect(kmQuantileFromCurve(censored, 0.9)).toBeNull();
    expect(kmQuantileFromCurve(censored, 0.5)).toBeNull();
    expect(kmQuantileFromCurve([], 0.9)).toBeNull();
  });
});

// ------------------------------------------------------------------- brick second-oracle parity
//
// brick/devsecops/metrics.py::kaplan_meier is itself "a port of gas/'s kaplanMeier" (its own
// docstring), independently implemented in PySpark and exported by
// brick/devsecops/export_fixtures.py to test/fixtures/brick/km.json: 12 hand-derived cases
// (brick/tests/test_km.py), each carrying per-severity rows AND an OVERALL row pooling every
// severity. brick's fixture rows are the shape "silver_findings produces" — {severity,
// mttr_days, age_days}, no status — so toRemediationRow below infers status the same way
// brick's own km_curve does: mttr_days present -> an event (RESOLVED); else -> censored at
// age_days (OPEN). That is exactly resolvedMttr/openAge's own test (a finite mttr_days makes a
// row an event regardless of status; only a null mttr_days sends it to the censored/openAge
// path), so the inferred status reproduces brick's per-row classification exactly.
//
// Field-name mapping (gas/'s KMResult names -> brick's km.json names), as specified for this
// package: median<->km_median, medianLowerBound<->km_median_lower_bound, mean<->km_rmst,
// meanTruncated<->km_truncated, events<->km_events, censored<->km_censored,
// restrictionTime<->km_restriction_time. (naiveMean/naiveMedian/curve/total have no counterpart
// in the fixture and are not compared here.)

interface BrickKmInput {
  severity: string;
  mttr_days: number | null;
  age_days: number | null;
}

interface BrickKmExpected {
  severity: string;
  km_restriction_time: number | null;
  km_events: number;
  km_censored: number;
  km_median: number | null;
  km_rmst: number | null;
  km_truncated: boolean;
  km_median_lower_bound: number | null;
}

interface BrickKmCase {
  name: string;
  input: BrickKmInput[];
  expected: BrickKmExpected[];
}

interface BrickKmFixture {
  version: number;
  source: string;
  cases: BrickKmCase[];
}

function toRemediationRow(r: BrickKmInput): RemediationRow {
  return {
    severity: r.severity,
    status: r.mttr_days !== null && r.mttr_days !== undefined ? "RESOLVED" : "OPEN",
    mttr_days: r.mttr_days,
    age_days: r.age_days,
  };
}

describe("kaplanMeier against the brick/devsecops PySpark oracle (test/fixtures/brick/km.json)", () => {
  const fx = brickFixture<BrickKmFixture>("km");

  it("fixture shape: 12 cases, each carrying an OVERALL row", () => {
    expect(fx.cases).toHaveLength(12);
    for (const c of fx.cases) {
      expect(c.expected.some((e) => e.severity === OVERALL)).toBe(true);
    }
  });

  for (const c of fx.cases) {
    it(c.name, () => {
      const rows = c.input.map(toRemediationRow);
      for (const exp of c.expected) {
        const subset = exp.severity === OVERALL ? rows : rows.filter((r) => r.severity === exp.severity);
        const got = kaplanMeier(subset);
        expectParity(
          {
            median: got.median,
            medianLowerBound: got.medianLowerBound,
            mean: got.mean,
            meanTruncated: got.meanTruncated,
            events: got.events,
            censored: got.censored,
            restrictionTime: got.restrictionTime,
          },
          {
            median: exp.km_median,
            medianLowerBound: exp.km_median_lower_bound,
            mean: exp.km_rmst,
            meanTruncated: exp.km_truncated,
            events: exp.km_events,
            censored: exp.km_censored,
            restrictionTime: exp.km_restriction_time,
          },
          1e-9,
        );
      }
    });
  }
});
