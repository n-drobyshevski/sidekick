// D4 (Kaplan–Meier) ported the KM-relevant sections of gas/test/remediation.test.ts
// (describe blocks: kmMedian, kaplanMeier, kmQuantileFromCurve — ~186 of gas/'s 785 lines),
// plus a brick-fixture parity suite gas/'s file has no equivalent of (brick/devsecops is a
// second, independently-implemented oracle — see test/fixtures/brick/km.json).
//
// D4b ports the rest: mttrPercentiles, resolutionBuckets, openPastSla/openPastSlaFromRecords,
// actionableView, awaitingVendorFix, the latency clocks, and baseRowNoFix/recordNoFix — see
// src/domain/remediation.ts's header for the full DIVERGENCE list this drags in (no
// REMEDIATION_ROLLOUT_ISO / ROLLOUT_MS / published_date; scope-gated awaiting/no-fix
// predicates; opts.scope filters). Two describe blocks stay dropped on purpose:
//   - "isEndOfLifeName / recordEol" and "EOL findings excluded from the MTTR KPI" — a code
//     register has no host OS to be end-of-life, so those predicates don't exist here.
//   - "recordNoFix ↔ baseRow.awaiting_vendor_fix agreement" — gas/'s version built its ledger
//     row via ledgerCore.baseRows(emptyState()), a derivation this package doesn't own (no
//     ledgerCore.ts in this tree; the equivalent lives in lifecycle.ts, owned by a concurrent
//     package). Ported below as a hand-built-row equivalent instead of reaching into that
//     module mid-edit — see "recordNoFix vs baseRowNoFix agreement".
//   - the "disclosure" latency-origin tests ("the disclosure origin measures the vendor's
//     wait...", "a row with no publication date is unmeasured on the disclosure clock only",
//     "a reopened row is unmeasured on the disclosure clock only") — this register's ledger
//     has no published_date column, so that clock has no data source (see LatencyOrigin's
//     DIVERGENCE note in remediation.ts).
//   - "a legacy pre-rollout row is unmeasured, not a zero" — no rollout boundary exists here;
//     replaced below with the boundary that DOES exist (no first_seen captured at all).

import { describe, expect, it } from "vitest";
import {
  actionableView,
  awaitingVendorFix,
  baseRowNoFix,
  kaplanMeier,
  kmMedian,
  kmMedianFromCurve,
  kmQuantileFromCurve,
  latencySegments,
  latencyView,
  mttrPercentiles,
  openPastSla,
  openPastSlaFromRecords,
  recordNoFix,
  resolutionBuckets,
  RESOLUTION_BUCKET_LABELS,
  type KMPoint,
  type RemediationRow,
} from "../src/domain/remediation";
import { OVERALL, type Scope } from "../src/domain/config";
import type { BaseRow } from "../src/domain/ledgerTypes";
import { quantile, type Rec } from "../src/domain/util";
import { brickFixture, expectParity } from "./helpers";

/**
 * The per-test budget for the two N=200,000 stress cases below, and it is deliberately far
 * above `vitest.config.ts`'s 30s.
 *
 * THAT 30s IS A HANG-CATCHER, and its stated premise — "the slowest file is well under a
 * second, so if a test takes 30s something is genuinely stuck" — is FALSE for these two.
 * Measured on this machine (node 22 / x64, 8 logical cores), running this file alone:
 * 17.6s and 19.1s. Under the full suite's `isolate: false` worker sharing they were observed
 * at 31.3s and 40.6s, and 45.4s once — i.e. they cross 30s on load alone, while doing exactly
 * what they are supposed to do.
 *
 * This was settled by bisection rather than argued: a clean-HEAD `git worktree` of the commit
 * that had been green minutes earlier reproduced the same failure with none of the day's new
 * code in it (transform 2.07s -> 54.68s, import 4.79s -> 90.27s on identical source), so the
 * machine moved and the change did not. Raising the budget here is therefore not papering over
 * a regression; it is removing a hang-catcher from two tests that are legitimately slow.
 *
 * N MUST NOT SHRINK TO MAKE THIS FAST — see the note above the first test. This comment used
 * to add "N=200,000 IS the claim being made (it must sit past the engine's argument-spread
 * limit on any machine)" as the reason; that reason was false, measured directly: under this
 * suite's own `pool: "threads"`, a bare argument spread returns cleanly through 490,000
 * elements and only throws from 498,321 on, so 200,000 sits well UNDER the limit here, not
 * past it (see `test/util.test.ts`'s header for the full measurement, and that file for the
 * guard that now actually sits past the limit, at N=2,000,000). The real reason N must not
 * shrink is simpler and still holds: N=200,000 IS the register-scale claim these two tests
 * make about `kaplanMeier` itself, and shrinking the register shrinks that claim, not just
 * the runtime.
 */
const STRESS_TIMEOUT_MS = 120_000;

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

// Base-row projections carrying the actionable-clock fields the D4b functions read (a superset
// of RemediationRow, so they also drop straight into openPastSla/kmMedian for the naive view).
// A resolved row has an mttr on both clocks; an open row has an age on both. An awaiting row is
// OPEN with null actionable fields — outside every clock, still in the open count. `scope`
// defaults to "sca" because the actionable/awaiting-vendor-fix machinery is a vendor-fix
// concept that only means something there (D4b rule 3) — override it to exercise the
// sast/secrets guard.
const bRes = (
  mttr_days: number | null,
  mttr_actionable_days: number | null,
  severity = "HIGH",
  scope: Scope = "sca",
) => ({
  scope,
  severity,
  status: "RESOLVED",
  mttr_days,
  age_days: null,
  mttr_actionable_days,
  actionable_age_days: null,
  awaiting_vendor_fix: false,
});
const bOpen = (
  age_days: number | null,
  actionable_age_days: number | null,
  awaiting_vendor_fix = false,
  severity = "HIGH",
  scope: Scope = "sca",
) => ({
  scope,
  severity,
  status: "OPEN",
  mttr_days: null,
  age_days,
  mttr_actionable_days: null,
  actionable_age_days,
  awaiting_vendor_fix,
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
  // NOT A SPREAD-REGRESSION GUARD, despite the name this test used to carry ("large risk set
  // does not overflow the call stack (regression: Math.max(...times) spread)"). That name was
  // false under this suite's own pool: `vitest.config.ts` runs every test in a real
  // worker_thread, whose default V8 stack tolerates a far larger argument spread than the main
  // thread's — measured directly (a temporary vitest test, in-pool, deleted after use): a bare
  // `Math.max(...arr)` / `push(...arr)` returns cleanly through 490,000 elements and only
  // throws from 498,321 on. 200,000 never gets close. Verified: reverting `maxNum` to
  // `Math.max(...times)` and rerunning this test at N=200_000 (as-is) produces a clean pass,
  // no overflow and no timeout.
  //
  // `test/util.test.ts` is the guard that actually bites: `maxNum`/`minNum`/`pushAll` are
  // exercised directly at N=2,000,000 — comfortably past the measured boundary — in under a
  // second total, with the full measurement and margin reasoning in its header comment. THIS
  // test keeps a different, real claim: kaplanMeier stays correct and fast at register scale
  // (200k rows, one observation per finding). If util.test.ts's fast guard is ever deleted,
  // that is the coverage this test's name used to promise but cannot deliver at this N, and it
  // would need restoring before relying on this one in its place.
  it("large risk set completes at register scale without timing out (spread regression is guarded directly in util.test.ts)", () => {
    // The risk set holds one observation per finding, so a real register is tens of thousands
    // of entries. Spreading it into Math.max/Math.min ("Math.max(...times)") overflows the call
    // stack once the array is large enough — the crash that took down the Executive view (which
    // asks for every severity, maximizing the set) — which is why `maxNum` folds instead. That
    // specific regression is what `test/util.test.ts` guards directly and fast; this test's own
    // job is the broader end-to-end claim that the estimator is correct and performant at
    // register scale.
    const N = 200_000;
    const rows: RemediationRow[] = [];
    for (let i = 0; i < N; i++) rows.push(res((i % 500) + 1));
    const km = kaplanMeier(rows);
    expect(km.total).toBe(N);
    expect(km.events).toBe(N);
    expect(km.restrictionTime).toBe(500); // maxNum(times) — the largest mttr_days
  }, STRESS_TIMEOUT_MS);
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

// ------------------------------------------------------------------- D4b: everything else

describe("mttrPercentiles", () => {
  it("p50 / p90 match quantile over resolved mttr_days, per sev + overall", () => {
    const rows = [res(1), res(2), res(3), res(4)];
    const { perSev, overall } = mttrPercentiles(rows);
    expect(perSev.HIGH).toEqual({
      p50: quantile([1, 2, 3, 4], 0.5), // 2.5
      p90: quantile([1, 2, 3, 4], 0.9), // 3.7
      count: 4,
    });
    expect(overall).toEqual({ p50: quantile([1, 2, 3, 4], 0.5), p90: quantile([1, 2, 3, 4], 0.9), count: 4 });
  });

  it("excludes open / null-mttr rows; empty sample -> nulls and count 0", () => {
    const { perSev, overall } = mttrPercentiles([res(5, "CRITICAL"), open(40, "CRITICAL"), res(null, "LOW")]);
    expect(perSev.CRITICAL).toEqual({ p50: 5, p90: 5, count: 1 });
    expect(perSev.LOW).toBeUndefined();
    expect(overall.count).toBe(1);
    expect(mttrPercentiles([])).toEqual({ perSev: {}, overall: { p50: null, p90: null, count: 0 } });
  });

  it("opts.scope narrows the population before computing (D4b rule 4)", () => {
    const rows = [
      { ...res(2, "HIGH"), scope: "sca" as const },
      { ...res(2, "HIGH"), scope: "sca" as const },
      { ...res(100, "HIGH"), scope: "sast" as const }, // would drag the sca percentile way up
    ];
    const scaOnly = mttrPercentiles(rows, { scope: "sca" });
    expect(scaOnly.perSev.HIGH).toEqual({ p50: 2, p90: 2, count: 2 });
    const all = mttrPercentiles(rows);
    expect(all.perSev.HIGH.count).toBe(3);
  });
});

describe("resolutionBuckets", () => {
  it("buckets at <= edges 1/7/30/90 (inclusive-low); 90.0001 -> 90+d", () => {
    const { perSev, total, labels } = resolutionBuckets([
      res(0.5), res(1), // bucket 0 (<= 1)
      res(1.01), res(7), // bucket 1 (<= 7)
      res(7.01), res(30), // bucket 2 (<= 30)
      res(30.01), res(90), // bucket 3 (<= 90)
      res(90.0001), res(400), // bucket 4 (90+)
    ]);
    expect(perSev.HIGH).toEqual([2, 2, 2, 2, 2]);
    expect(total).toBe(10);
    expect(labels).toBe(RESOLUTION_BUCKET_LABELS);
    expect(labels).toHaveLength(5);
  });

  it("per-sev counts sum to total; open / null-mttr rows excluded", () => {
    const { perSev, total } = resolutionBuckets([
      res(2, "CRITICAL"), // bucket 1 (<= 7)
      res(50, "LOW"), // bucket 3 (<= 90)
      open(5, "HIGH"), // open — excluded
      res(null, "MEDIUM"), // null mttr — excluded
    ]);
    expect(perSev.CRITICAL).toEqual([0, 1, 0, 0, 0]);
    expect(perSev.LOW).toEqual([0, 0, 0, 1, 0]);
    expect(perSev.HIGH).toBeUndefined();
    expect(perSev.MEDIUM).toBeUndefined();
    expect(total).toBe(2);
    const summed = Object.values(perSev)
      .flat()
      .reduce((a, b) => a + b, 0);
    expect(summed).toBe(total);
  });

  it("opts.scope narrows the population before bucketing (D4b rule 4)", () => {
    const rows = [
      { ...res(0.5, "HIGH"), scope: "sca" as const },
      { ...res(400, "HIGH"), scope: "sast" as const },
    ];
    const scaOnly = resolutionBuckets(rows, { scope: "sca" });
    expect(scaOnly.total).toBe(1);
    expect(scaOnly.perSev.HIGH).toEqual([1, 0, 0, 0, 0]);
  });
});

describe("openPastSla", () => {
  it("strict > boundary: age exactly == target is NOT breached", () => {
    // CRITICAL target = 7. age 7 -> in SLA; age 7.01 -> breached.
    const out = openPastSla([open(7, "CRITICAL"), open(7.01, "CRITICAL")]);
    expect(out.perSev.CRITICAL).toEqual({ open: 2, breached: 1, pct: 50, target: 7 });
  });

  it("no-target severity (UNKNOWN) never breaches; target is null", () => {
    // "WEIRD" normalizes to UNKNOWN, which has no SLA target.
    const out = openPastSla([open(999, "UNKNOWN"), open(999, "WEIRD")]);
    expect(out.perSev.UNKNOWN).toEqual({ open: 2, breached: 0, pct: 0, target: null });
    expect(out.overall).toEqual({ open: 2, breached: 0, pct: 0 });
  });

  it("resolved and null-age rows are ignored; overall pct null when open === 0", () => {
    const out = openPastSla([res(999, "CRITICAL"), open(null, "CRITICAL"), res(5, "HIGH")]);
    expect(out.overall).toEqual({ open: 0, breached: 0, pct: null });
    expect(out.perSev).toEqual({});
  });

  it("overall sums breached / open across severities", () => {
    const out = openPastSla([
      open(10, "CRITICAL"), // 10 > 7 -> breached
      open(3, "CRITICAL"), // 3 <= 7 -> in SLA
      open(40, "MEDIUM"), // 40 > 30 -> breached
      open(999, "UNKNOWN"), // no target -> never
    ]);
    expect(out.overall).toEqual({ open: 4, breached: 2, pct: 50 });
    expect(out.perSev.CRITICAL).toEqual({ open: 2, breached: 1, pct: 50, target: 7 });
    expect(out.perSev.MEDIUM).toEqual({ open: 1, breached: 1, pct: 100, target: 30 });
  });

  it("opts.scope narrows the population before scoring the backlog (D4b rule 4)", () => {
    const rows = [
      { ...open(10, "CRITICAL"), scope: "sca" as const }, // breached
      { ...open(999, "CRITICAL"), scope: "sast" as const }, // also breached, other scope
    ];
    const scaOnly = openPastSla(rows, { scope: "sca" });
    expect(scaOnly.overall).toEqual({ open: 1, breached: 1, pct: 100 });
    const all = openPastSla(rows);
    expect(all.overall.open).toBe(2);
  });
});

describe("openPastSlaFromRecords", () => {
  it("counts breached open frame records against an injected now", () => {
    const now = Date.parse("2026-07-16T00:00:00Z");
    const records = [
      { severity: "CRITICAL", status: "OPEN", firstSeenAt: "2026-06-01T00:00:00Z" }, // 45d > 7 -> breached
      { severity: "CRITICAL", status: "OPEN", firstSeenAt: "2026-07-14T00:00:00Z" }, // 2d -> in SLA
      { severity: "MEDIUM", status: "OPEN", firstSeenAt: "2026-05-01T00:00:00Z" }, // 76d > 30 -> breached
      { severity: "CRITICAL", status: "RESOLVED", firstSeenAt: "2020-01-01T00:00:00Z" }, // resolved -> ignored
      { status: "OPEN", firstSeenAt: "2020-01-01T00:00:00Z" }, // no severity -> UNKNOWN, no target -> skipped
      { severity: "CRITICAL", status: "OPEN" }, // no firstSeen -> skipped
    ];
    expect(openPastSlaFromRecords(records, now)).toBe(2);
  });

  it("returns 0 with no records or no first-seen column", () => {
    expect(openPastSlaFromRecords([], Date.now())).toBe(0);
    expect(openPastSlaFromRecords([{ severity: "CRITICAL", status: "OPEN" }], Date.now())).toBe(0);
  });
});

describe("actionableView", () => {
  it("projects the actionable clock onto mttr_days/age_days; severity+status pass through", () => {
    const rows = [
      bRes(20, 3, "CRITICAL"), // resolved: from-detection 20d, actionable 3d
      bOpen(50, 8), // open: from-detection 50d, actionable 8d
      bOpen(40, null, true, "MEDIUM"), // awaiting: actionable fields null
    ];
    expect(actionableView(rows)).toEqual([
      { severity: "CRITICAL", status: "RESOLVED", mttr_days: 3, age_days: null },
      { severity: "HIGH", status: "OPEN", mttr_days: null, age_days: 8 },
      { severity: "MEDIUM", status: "OPEN", mttr_days: null, age_days: null },
    ]);
  });
});

describe("openPastSla over actionableView", () => {
  it("measures from the actionable age and drops awaiting rows (null actionable age)", () => {
    // CRITICAL target = 7. All three are past SLA on the from-detection age; only the
    // second is past it on the actionable clock, and the awaiting row has no clock at all.
    const rows = [
      bOpen(40, 3, false, "CRITICAL"), // fix arrived late: actionable 3d -> in SLA
      bOpen(60, 10, false, "CRITICAL"), // actionable 10d > 7 -> breached
      bOpen(99, null, true, "CRITICAL"), // awaiting: excluded entirely
    ];
    // Naive view breaches all three (every from-detection age > 7).
    expect(openPastSla(rows).overall).toEqual({ open: 3, breached: 3, pct: 100 });
    // Actionable view: awaiting row drops out (null age), and the late-fixed row is in SLA.
    const actionable = openPastSla(actionableView(rows));
    expect(actionable.overall).toEqual({ open: 2, breached: 1, pct: 50 });
    expect(actionable.perSev.CRITICAL).toEqual({ open: 2, breached: 1, pct: 50, target: 7 });
  });
});

describe("kmMedian naive vs actionable strata", () => {
  it("differ when the two clocks disagree on the same resolved set", () => {
    // Same four findings; from-detection mttrs 1..4 (median 2), actionable mttrs 10..40
    // (a late-available fix shifts every event right), so the KM medians land apart.
    const rows = [bRes(1, 10), bRes(2, 20), bRes(3, 30), bRes(4, 40)];
    expect(kmMedian(rows)).toBe(2); // from-detection: crosses .5 at t=2
    expect(kmMedian(actionableView(rows))).toBe(20); // actionable: crosses .5 at t=20
  });
});

describe("awaitingVendorFix", () => {
  it("counts awaiting rows per sev + overall; pctOfOpen is their share of all open", () => {
    const rows = [
      bOpen(5, null, true, "CRITICAL"), // awaiting
      bOpen(5, 5, false, "CRITICAL"), // open, fix available -> not awaiting
      bOpen(5, null, true, "HIGH"), // awaiting
      bRes(3, 3, "HIGH"), // resolved -> not open, ignored
    ];
    const out = awaitingVendorFix(rows);
    expect(out.perSev).toEqual({ CRITICAL: 1, HIGH: 1 });
    expect(out.overall).toBe(2);
    expect(out.openTotal).toBe(3); // three OPEN rows
    expect(out.pctOfOpen).toBeCloseTo((2 / 3) * 100);
    expect(out.notApplicable).toBe(0); // every row above is scope "sca"
  });

  it("openTotal 0 -> pctOfOpen null; severity is normalized", () => {
    expect(awaitingVendorFix([])).toEqual({
      perSev: {}, overall: 0, openTotal: 0, pctOfOpen: null, notApplicable: 0,
    });
    // All resolved: no open rows -> null share, not a fake 0%.
    expect(awaitingVendorFix([bRes(3, 3, "HIGH")])).toEqual({
      perSev: {}, overall: 0, openTotal: 0, pctOfOpen: null, notApplicable: 0,
    });
    // "weird" normalizes to UNKNOWN.
    const out = awaitingVendorFix([bOpen(5, null, true, "weird")]);
    expect(out.perSev).toEqual({ UNKNOWN: 1 });
    expect(out.overall).toBe(1);
    expect(out.pctOfOpen).toBe(100);
    expect(out.notApplicable).toBe(0);
  });

  // D4b rule 3: sast/secrets have no vendor to wait on, so a non-sca row is never counted as
  // awaiting a vendor fix — even when its own awaiting_vendor_fix flag reads true (the
  // scenario an upstream derivation bug would produce).
  it("sast rows never count as awaiting, even with awaiting_vendor_fix wrongly set true", () => {
    const rows = [
      bOpen(5, null, true, "CRITICAL", "sast"), // wrongly-flagged sast row -> notApplicable
      bOpen(5, null, true, "HIGH", "sca"), // genuinely awaiting sca row
    ];
    const out = awaitingVendorFix(rows);
    expect(out.perSev).toEqual({ HIGH: 1 });
    expect(out.overall).toBe(1);
    expect(out.openTotal).toBe(2); // both rows are open, for context
    expect(out.notApplicable).toBe(1);
  });

  it("secrets rows never count as awaiting either", () => {
    const rows = [bOpen(5, null, true, "MEDIUM", "secrets")];
    const out = awaitingVendorFix(rows);
    expect(out.perSev).toEqual({});
    expect(out.overall).toBe(0);
    expect(out.openTotal).toBe(1);
    expect(out.notApplicable).toBe(1);
  });

  it("a non-sca row with no fix signal set is simply not awaiting (openTotal still counts it)", () => {
    const rows = [bOpen(5, null, false, "LOW", "sast")];
    const out = awaitingVendorFix(rows);
    expect(out).toEqual({ perSev: {}, overall: 0, openTotal: 1, pctOfOpen: 0, notApplicable: 0 });
  });

  it("opts.scope narrows the population before computing (D4b rule 4)", () => {
    const rows = [
      bOpen(5, null, true, "CRITICAL", "sca"),
      bOpen(5, null, true, "HIGH", "sca"),
    ];
    const scaOnly = awaitingVendorFix(rows, { scope: "sca" });
    expect(scaOnly.overall).toBe(2);
    const noneMatch = awaitingVendorFix(rows, { scope: "sast" });
    expect(noneMatch.overall).toBe(0);
    expect(noneMatch.openTotal).toBe(0);
  });
});

describe("baseRowNoFix", () => {
  it("is true only for awaiting, open, SCA rows; resolved / fixed rows are never hidden", () => {
    expect(baseRowNoFix(bOpen(5, null, true))).toBe(true); // scope defaults to "sca"
    expect(baseRowNoFix(bOpen(5, 5, false))).toBe(false); // open, fix available
    expect(baseRowNoFix(bRes(3, 3))).toBe(false); // resolved -> awaiting always false
  });

  it("is false for a non-sca scope even when awaiting_vendor_fix is (wrongly) true (D4b rule 3)", () => {
    expect(baseRowNoFix(bOpen(5, null, true, "MEDIUM", "sast"))).toBe(false);
    expect(baseRowNoFix(bOpen(5, null, true, "MEDIUM", "secrets"))).toBe(false);
  });
});

describe("recordNoFix", () => {
  it("open + no fix -> true", () => {
    expect(recordNoFix({ status: "OPEN" })).toBe(true);
  });
  it("fixedVersion present -> false", () => {
    expect(recordNoFix({ status: "OPEN", fixedVersion: "1.2.3" })).toBe(false);
  });
  it("fixDate present -> false", () => {
    expect(recordNoFix({ status: "OPEN", fixDate: "2026-07-06T00:00:00Z" })).toBe(false);
  });
  it("resolved -> false (resolved rows are never hidden)", () => {
    expect(recordNoFix({ status: "RESOLVED" })).toBe(false);
  });

  // D4b rule 3: a record explicitly tagged with a non-sca scope is never no-fix.
  it("scope !== sca -> false, even with no fix signal at all", () => {
    expect(recordNoFix({ status: "OPEN", scope: "sast" })).toBe(false);
    expect(recordNoFix({ status: "OPEN", scope: "secrets" })).toBe(false);
  });
  it("no scope tag at all still applies the fixed-signal test (absent scope survives)", () => {
    expect(recordNoFix({ status: "OPEN" })).toBe(true);
    expect(recordNoFix({ status: "OPEN", fixedVersion: "1.0" })).toBe(false);
  });
  it("scope === sca is treated the same as no scope tag", () => {
    expect(recordNoFix({ status: "OPEN", scope: "sca" })).toBe(true);
    expect(recordNoFix({ status: "OPEN", scope: "sca", fixedVersion: "1.0" })).toBe(false);
  });
});

describe("recordNoFix vs baseRowNoFix agreement", () => {
  // The frame predicate (recordNoFix, over dotted scan records) and the durable predicate
  // (baseRowNoFix, over a ledger-derived BaseRow) must classify the SAME underlying finding
  // identically. DIVERGENCE from gas/'s version of this test: gas/ built its ledger row via
  // ledgerCore.baseRows(emptyState()) and asserted against that derivation's OWN output; the
  // equivalent derivation here (lifecycle.ts) is a concurrently-edited package this one does
  // not own, so this pins the predicate PAIR directly against hand-built rows encoding the
  // same scenarios, rather than reaching into a derivation mid-edit.
  const scenarios: {
    name: string;
    rec: Rec;
    base: Pick<BaseRow, "scope" | "awaiting_vendor_fix">;
  }[] = [
    {
      name: "sca, open, no fix -> awaiting",
      rec: { scope: "sca", status: "OPEN" },
      base: { scope: "sca", awaiting_vendor_fix: true },
    },
    {
      name: "sca, open, fixedVersion present -> has a fix",
      rec: { scope: "sca", status: "OPEN", fixedVersion: "1.2.3" },
      base: { scope: "sca", awaiting_vendor_fix: false },
    },
    {
      name: "sca, resolved -> never hidden",
      rec: { scope: "sca", status: "RESOLVED" },
      base: { scope: "sca", awaiting_vendor_fix: false },
    },
    {
      name: "sast, open, no fix -> STILL not awaiting, even if the flag was set wrong",
      rec: { scope: "sast", status: "OPEN" },
      base: { scope: "sast", awaiting_vendor_fix: true },
    },
    {
      name: "secrets, open, no fix -> STILL not awaiting",
      rec: { scope: "secrets", status: "OPEN" },
      base: { scope: "secrets", awaiting_vendor_fix: true },
    },
  ];

  it("both predicates classify every scenario identically", () => {
    scenarios.forEach((s) => {
      expect(recordNoFix(s.rec), s.name).toBe(baseRowNoFix(s.base));
    });
  });
});

// ------------------------------------------------------------------ latency clocks
//
// The complement of every other clock in this file: the wait for a fix to EXIST, with rows
// still awaiting one as the censored population rather than an excluded one. Timestamps are
// real ISO strings (not pre-baked day counts) because the derivation is what is under test.
//
// DIVERGENCE from gas/'s version: no REMEDIATION_ROLLOUT_ISO boundary exists in this register
// (D4b rule 2), so tests that exercised it are replaced with the boundary that DOES exist here
// — a row whose first_seen was never captured at all. The "disclosure" origin has no tests here
// either, for the same reason LatencyOrigin dropped it: no published_date column to anchor to.
describe("latencyView / latencySegments", () => {
  const NOW = Date.parse("2026-08-01T00:00:00Z");
  type LatRow = Parameters<typeof latencyView>[0][number] & {
    scope: Scope;
    mttr_days: number | null;
    age_days: number | null;
    awaiting_vendor_fix: boolean;
  };
  const lat = (over: Partial<LatRow>): LatRow => ({
    scope: "sca",
    severity: "HIGH",
    status: "OPEN",
    first_seen: "2026-07-01T00:00:00Z",
    fix_available_at: null,
    resolved_at: null,
    // Not read by the latency clocks (they key off isOpen/fix_available_at); carried so the
    // same rows can be run through baseRowNoFix, the show-no-fix toggle's own predicate.
    awaiting_vendor_fix: false,
    // Carried so the SAME objects also feed the from-detection clock, which is what makes the
    // differential test below a comparison rather than two unrelated numbers.
    mttr_days: null,
    age_days: null,
    ...over,
  });

  // Four findings whose two clocks disagree on purpose: the fix landed early and the team was
  // slow (A, D) or the fix landed late and the team was fast (C). Latencies 2/4/6/8,
  // from-detection mttrs 20/10/8/30.
  const fourClocks = (): LatRow[] => [
    lat({ fix_available_at: "2026-07-03T00:00:00Z", resolved_at: "2026-07-21T00:00:00Z", status: "RESOLVED", mttr_days: 20 }),
    lat({ fix_available_at: "2026-07-05T00:00:00Z", resolved_at: "2026-07-11T00:00:00Z", status: "RESOLVED", mttr_days: 10 }),
    lat({ fix_available_at: "2026-07-07T00:00:00Z", resolved_at: "2026-07-09T00:00:00Z", status: "RESOLVED", mttr_days: 8 }),
    lat({ fix_available_at: "2026-07-09T00:00:00Z", resolved_at: "2026-07-31T00:00:00Z", status: "RESOLVED", mttr_days: 30 }),
  ];

  it("measures the wait for a fix to exist, not the wait to deploy one", () => {
    // Latency events 2,4,6,8: S(2)=3/4=.75, S(4)=.75*(2/3)=.5 -> crosses at 4.
    // From-detection events 8,10,20,30: S(8)=.75, S(10)=.5 -> crosses at 10.
    // Same four rows, same estimator, two different questions.
    const rows = fourClocks();
    expect(kmMedian(latencyView(rows, "detection", NOW))).toBe(4);
    expect(kmMedian(rows)).toBe(10);
  });

  it("a row with no captured origin is unmeasured, not a zero (D4b rule 2: no rollout boundary here)", () => {
    // gas/ exempted a pre-REMEDIATION_ROLLOUT_ISO row via ROLLOUT_MS (the old hasFix-only
    // ingestion guaranteed a fix existed for those). This register has no such migration
    // boundary — first_seen is either captured or it isn't, and "isn't" is the only way to be
    // unmeasured now.
    const rows = [lat({ first_seen: null })];
    expect(latencyView(rows, "detection", NOW)).toEqual([]);
    const seg = latencySegments(rows, "detection", NOW);
    expect(seg).toMatchObject({ total: 1, unmeasured: 1, events: 0, censored: 0 });
  });

  it("a fix that predates detection is a zero-length wait, not a negative one", () => {
    // Wiz's upstream fixDate routinely predates our first sight of the finding.
    const rows = [
      lat({ first_seen: "2026-07-10T00:00:00Z", fix_available_at: "2026-07-02T00:00:00Z" }),
    ];
    expect(latencyView(rows, "detection", NOW)).toEqual([
      { severity: "HIGH", status: "RESOLVED", mttr_days: 0, age_days: null },
    ]);
    expect(latencySegments(rows, "detection", NOW)).toMatchObject({ events: 1, zeroAtOrigin: 1 });
  });

  it("a finding still awaiting a fix is censored at now, never dropped", () => {
    const rows = [lat({})]; // open, no fix, first seen 07-01; NOW is 08-01
    expect(latencyView(rows, "detection", NOW)).toEqual([
      { severity: "HIGH", status: "OPEN", mttr_days: null, age_days: 31 },
    ]);
    expect(latencySegments(rows, "detection", NOW)).toMatchObject({ censored: 1, events: 0 });
  });

  it("a finding that closed before any fix appeared is censored at its resolution", () => {
    // The competing risk: the repository went away, or Wiz stopped returning it. We stopped
    // being able to observe a fix at that moment, so that is where the observation ends — and
    // it is counted apart from a genuine still-awaiting row.
    const rows = [
      lat({ status: "RESOLVED", resolved_at: "2026-07-11T00:00:00Z" }),
    ];
    expect(latencyView(rows, "detection", NOW)).toEqual([
      { severity: "HIGH", status: "OPEN", mttr_days: null, age_days: 10 },
    ]);
    expect(latencySegments(rows, "detection", NOW)).toMatchObject({
      closedBeforeFix: 1, censored: 0, events: 0,
    });
  });

  it("reports '> N d' rather than inventing a median when most are still awaiting", () => {
    const rows = [
      lat({ fix_available_at: "2026-07-06T00:00:00Z" }), // event at 5
      lat({ first_seen: null }), // no origin captured -> unmeasured
      lat({}), lat({}), lat({}), // censored at 31
    ];
    const km = kaplanMeier(latencyView(rows, "detection", NOW));
    expect(km.events).toBe(1);
    expect(km.censored).toBe(3);
    expect(km.median).toBeNull(); // S(5) = 1 - 1/4 = 0.75, never reaches 0.5
    expect(km.medianLowerBound).toBe(31);
  });

  it("segments account for every row, and agree with the estimator's own counts", () => {
    const rows = [
      ...fourClocks(), // 4 events
      lat({}), lat({}), // 2 censored (open, awaiting)
      lat({ status: "RESOLVED", resolved_at: "2026-07-11T00:00:00Z" }), // 1 closed-before-fix
      lat({ first_seen: null }), // 1 unmeasured (no origin captured)
    ];
    const seg = latencySegments(rows, "detection", NOW);
    expect(seg).toEqual({
      events: 4, censored: 2, closedBeforeFix: 1, zeroAtOrigin: 0, unmeasured: 1, total: 8,
    });
    // Nothing falls between the two: every row is in exactly one bucket...
    expect(seg.events + seg.censored + seg.closedBeforeFix + seg.unmeasured).toBe(seg.total);
    // ...and the estimator's own split matches, with closed-before-fix riding as censored.
    const km = kaplanMeier(latencyView(rows, "detection", NOW));
    expect(km.events).toBe(seg.events);
    expect(km.censored).toBe(seg.censored + seg.closedBeforeFix);
  });

  // NOT A SPREAD-REGRESSION GUARD, same reason as the "large risk set" test above: this also
  // runs its rows through `kaplanMeier` -> `maxNum`, but at N=200_000, under the pool this
  // suite actually runs in, that spread never gets near the measured boundary (clean to
  // 490,000, RangeError only from 498,321 — see `test/util.test.ts`'s header). The name below
  // states the claim this test actually holds. `test/util.test.ts` is the fast, direct guard
  // against the spread itself, at N=2,000,000.
  it("register-sized population survives the projection and the estimator (not a spread-regression guard — see util.test.ts)", () => {
    const N = 200_000;
    const base = Date.parse("2026-07-01T00:00:00Z");
    // 500 distinct fix dates, precomputed: toISOString() per row would dominate the test.
    const fixes = Array.from({ length: 500 }, (_, i) => new Date(base + (i + 1) * 86_400_000).toISOString());
    const rows: LatRow[] = [];
    for (let i = 0; i < N; i++) rows.push(lat({ fix_available_at: fixes[i % 500] }));
    const km = kaplanMeier(latencyView(rows, "detection", NOW));
    expect(km.total).toBe(N);
    expect(km.events).toBe(N);
    expect(km.restrictionTime).toBe(500); // the largest latency, in days
  }, STRESS_TIMEOUT_MS);

  // Why api.ts should compute latency over a population the show-no-fix toggle has NOT
  // narrowed. baseRowNoFix is that toggle's predicate, and the rows it removes are exactly
  // this metric's censored population — so routing latency through a no-fix-filtered view
  // would leave only the findings that got a fix and report how fast the fixed ones were
  // fixed. If someone later "fixes the inconsistency" by filtering here, this test is what
  // stops them.
  it("the show-no-fix filter would delete the entire censored population", () => {
    const rows = [
      lat({ fix_available_at: "2026-07-03T00:00:00Z", awaiting_vendor_fix: false }), // event at 2
      lat({ awaiting_vendor_fix: true }), // awaiting -> censored at 31
      lat({ awaiting_vendor_fix: true }), // awaiting -> censored at 31
      lat({ awaiting_vendor_fix: true }), // awaiting -> censored at 31
    ];
    const full = latencySegments(rows, "detection", NOW);
    expect(full).toMatchObject({ events: 1, censored: 3 });
    // S(2) = 1 - 1/4 = 0.75, so the honest answer is "no median yet, > 31 d".
    const km = kaplanMeier(latencyView(rows, "detection", NOW));
    expect(km.median).toBeNull();
    expect(km.medianLowerBound).toBe(31);

    // Now apply the toggle's own predicate, as a no-fix-filtered view would.
    const narrowed = rows.filter((r) => !baseRowNoFix(r));
    expect(latencySegments(narrowed, "detection", NOW)).toMatchObject({ events: 1, censored: 0 });
    // Every censored observation is gone, so the curve falls straight to zero on its single
    // event and the metric reports a 2-day vendor wait against a register that has been
    // waiting at least a month. That is the bias, in one number.
    expect(kmMedian(latencyView(narrowed, "detection", NOW))).toBe(2);
  });

  it("opts.scope narrows the population before computing (D4b rule 4)", () => {
    const rows = [
      lat({ fix_available_at: "2026-07-03T00:00:00Z", scope: "sca" }), // event at 2
      lat({ fix_available_at: "2026-07-05T00:00:00Z", scope: "sast" }), // event at 4
    ];
    const scaOnly = latencyView(rows, "detection", NOW, { scope: "sca" });
    expect(scaOnly).toHaveLength(1);
    expect(scaOnly[0].mttr_days).toBe(2);
    const all = latencyView(rows, "detection", NOW);
    expect(all).toHaveLength(2);
  });
});
