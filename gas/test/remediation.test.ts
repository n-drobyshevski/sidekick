import { describe, expect, it } from "vitest";
import {
  RESOLUTION_BUCKET_LABELS,
  actionableView,
  awaitingVendorFix,
  baseRowNoFix,
  isEndOfLifeName,
  kaplanMeier,
  kmMedian,
  kmMedianFromCurve,
  kmQuantileFromCurve,
  latencySegments,
  latencyView,
  mttrPercentiles,
  openPastSla,
  openPastSlaFromRecords,
  recordEol,
  recordNoFix,
  resolutionBuckets,
} from "../src/domain/remediation";
import type { KMPoint } from "../src/domain/remediation";
import { baseRows, emptyState, type LedgerState } from "../src/domain/ledgerCore";
import { emptyRiskSignals, type LedgerRow } from "../src/domain/reconcile";
import { quantile, type Rec } from "../src/domain/util";

// Base-row projections carrying the actionable-clock fields the new fns read (a superset of
// RemediationRow, so they also drop straight into openPastSla/kmMedian for the naive view).
// A resolved row has an mttr on both clocks; an open row has an age on both. An awaiting row
// is OPEN with null actionable fields — outside every clock, still in the open count.
const bRes = (mttr_days: number | null, mttr_actionable_days: number | null, severity = "HIGH") => ({
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
) => ({
  severity,
  status: "OPEN",
  mttr_days: null,
  age_days,
  mttr_actionable_days: null,
  actionable_age_days,
  awaiting_vendor_fix,
});

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
  // flaky — and the 30_000 that used to be here was NOT real headroom: vitest.config.ts's own
  // `testTimeout` is already 30_000, so restating it added nothing, and the two numbers that
  // comment cited ("vitest's 5s default", "~2.8s measured on a 4-core x64 box") were both
  // stale by the time anyone next looked. Re-measured 2026-09-05 on this machine (node 24/x64,
  // 8 logical cores): this file run alone (the `pure` project, isolate:false) took 5.9s / 13.2s
  // / 13.8s across three consecutive runs — already a >2x spread on an otherwise idle box.
  // Under `test:exact` (GAS_TEST_FULL_ISOLATION=1, isolate:true, sharing one process with all
  // 69 files) it got both slower and more variable: 12.3s / 19.5s / 26.8s / 25.6s across four
  // runs — the worst of those left 3.2s of headroom under the OLD 30s budget, on an UNLOADED
  // dev machine, not a busy CI box. A prior pass on this exact defect bisected it to
  // environment sensitivity rather than a regression (a clean-HEAD worktree of the pre-wave
  // commit, same node_modules, also flipped pass/fail run-to-run with none of this wave's code
  // present) — consistent with the variance re-measured here. 120_000 below matches the budget
  // `gas_devsecops/test/remediation.test.ts` already uses for its own N=200,000 cases (see its
  // STRESS_TIMEOUT_MS comment) — more than 4x the worst wall time measured above, not a number
  // raised until red went away.
  //
  // N STAYS AT 200k, and shrinking it would be the wrong way to make this fast. The argument
  // limit is a function of the available stack, so it MOVES with the engine and the
  // environment — measured at 125,275 on node 22 / x64, but lower where the stack is smaller
  // and higher where it is larger. Tuning N toward that number would calibrate the test to one
  // machine and risk it silently ceasing to test anything on another.
  //
  // RENAMED. This used to be named as the regression guard itself
  // ("large risk set does not overflow the call stack (regression: Math.max(...times)
  // spread)"), which was false at this N under this suite's own pool: a worker_thread's
  // default V8 stack tolerates a far larger argument spread than the main thread's, so 200k
  // rows never got near the real limit here (measured — see `test/util.test.ts`'s header —
  // clean up to 490,000, RangeError only from 498,321). Verified directly: reverting `maxNum`
  // to `Math.max(...times)` and rerunning this test at N=200_000 (as-is) produced a clean
  // PASS, no overflow and no timeout.
  //
  // `test/util.test.ts` is now the guard that actually bites: `maxNum`/`minNum`/`pushAll` are
  // exercised directly at N=2,000,000, comfortably past the measured boundary, in under a
  // second total. THIS test keeps its own, different claim — kaplanMeier stays correct and
  // fast at register scale (200k rows, matching the Executive view's full-severity risk
  // set) — which util.test.ts's plain-number arrays cannot exercise, since they never touch
  // the estimator. If a future edit deletes util.test.ts's fast guard, this is the test that
  // would need one added back in its place before the deletion is safe.
  it("large risk set completes at register scale without timing out (spread regression is guarded directly in util.test.ts)", () => {
    // The risk set holds one observation per finding, so a real register is tens of thousands
    // of entries. Spreading it into Math.max/Math.min ("Math.max(...times)") overflows the call
    // stack once the array is large enough — the crash that took down the Executive view (which
    // asks for every severity, maximizing the set) — which is why `maxNum` folds instead. That
    // specific regression is what `test/util.test.ts` guards directly and fast; this test's own
    // job is the broader end-to-end claim that the estimator is correct and performant at
    // register scale, including any spread written inline on this path that no helper would
    // catch.
    const N = 200_000;
    const rows: ReturnType<typeof res>[] = [];
    for (let i = 0; i < N; i++) rows.push(res((i % 500) + 1));
    const km = kaplanMeier(rows);
    expect(km.total).toBe(N);
    expect(km.events).toBe(N);
    expect(km.restrictionTime).toBe(500); // maxNum(times) — the largest mttr_days
  }, 120_000);
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

// ------------------------------------------------------------------ latency clocks
//
// The complement of every other clock in this file: the wait for a fix to EXIST, with rows
// still awaiting one as the censored population rather than an excluded one. Timestamps are
// real ISO strings (not pre-baked day counts) because the derivation is what is under test —
// the rollout boundary, the negative-latency clamp, and the origin swap all live in it.
//
// REMEDIATION_ROLLOUT_ISO is 2026-07-01, so every measured row is first seen on or after it.
describe("latencyView / latencySegments", () => {
  const NOW = Date.parse("2026-08-01T00:00:00Z"); // 31 days after 2026-07-01
  type LatRow = Parameters<typeof latencyView>[0][number] & {
    mttr_days: number | null;
    age_days: number | null;
    awaiting_vendor_fix: boolean;
  };
  const lat = (over: Partial<LatRow>): LatRow => ({
    severity: "HIGH",
    status: "OPEN",
    first_seen: "2026-07-01T00:00:00Z",
    published_date: null,
    fix_available_at: null,
    resolved_at: null,
    reopened_count: 0,
    // Not read by the latency clocks (they key off isOpen/fix_available_at); carried so the
    // same rows can be run through baseRowNoFix, the show-no-fix toggle's own predicate.
    awaiting_vendor_fix: false,
    // Carried so the SAME objects also feed the from-detection clock, which is what makes
    // the differential test below a comparison rather than two unrelated numbers.
    mttr_days: null,
    age_days: null,
    ...over,
  });

  // Four findings whose two clocks disagree on purpose: the fix landed early and the team
  // was slow (A, D) or the fix landed late and the team was fast (C). Latencies 2/4/6/8,
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

  it("a legacy pre-rollout row is unmeasured, not a zero", () => {
    // baseRows sets fix_available_at = first_seen for these, because the old hasFix-only
    // ingestion guaranteed a fix existed. That is an assumption, not an observation, and
    // counting it as a zero-day wait would drag every quantile down.
    const rows = [
      lat({ first_seen: "2026-06-15T00:00:00Z", fix_available_at: "2026-06-15T00:00:00Z" }),
    ];
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
    // The competing risk: the host went away, or Wiz stopped returning it. We stopped being
    // able to observe a fix at that moment, so that is where the observation ends — and it
    // is counted apart from a genuine still-awaiting row.
    const rows = [
      lat({ status: "RESOLVED", resolved_at: "2026-07-11T00:00:00Z", mttr_days: 10 }),
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
      lat({ first_seen: "2026-06-22T00:00:00Z" }), // pre-rollout -> unmeasured
      lat({}), lat({}), lat({}), // censored at 31
    ];
    const km = kaplanMeier(latencyView(rows, "detection", NOW));
    expect(km.events).toBe(1);
    expect(km.censored).toBe(3);
    expect(km.median).toBeNull(); // S(5) = 1 - 1/4 = 0.75, never reaches 0.5
    expect(km.medianLowerBound).toBe(31);
  });

  it("the disclosure origin measures the vendor's wait, not ours", () => {
    // Published 06-01, we found it 07-01, the fix landed 07-11. The vendor took 40 days;
    // we waited 10 of them. Same row, same estimator, two origins.
    const rows = [
      lat({ published_date: "2026-06-01T00:00:00Z", fix_available_at: "2026-07-11T00:00:00Z" }),
    ];
    expect(kmMedian(latencyView(rows, "detection", NOW))).toBe(10);
    expect(kmMedian(latencyView(rows, "disclosure", NOW))).toBe(40);
  });

  it("a row with no publication date is unmeasured on the disclosure clock only", () => {
    const rows = [lat({ fix_available_at: "2026-07-11T00:00:00Z" })];
    expect(latencySegments(rows, "detection", NOW)).toMatchObject({ events: 1, unmeasured: 0 });
    expect(latencySegments(rows, "disclosure", NOW)).toMatchObject({ events: 0, unmeasured: 1 });
  });

  it("a reopened row is unmeasured on the disclosure clock only", () => {
    // A reopen resets the fix clock (per-episode) and first_seen with it, so the detection
    // pair stays coherent. Publication does not reset (per-CVE), so pairing THIS episode's
    // fix against the original publication would measure a wait that never happened.
    const rows = [
      lat({
        published_date: "2026-06-01T00:00:00Z",
        fix_available_at: "2026-07-11T00:00:00Z",
        reopened_count: 1,
      }),
    ];
    expect(latencySegments(rows, "detection", NOW)).toMatchObject({ events: 1, unmeasured: 0 });
    expect(latencySegments(rows, "disclosure", NOW)).toMatchObject({ events: 0, unmeasured: 1 });
  });

  it("segments account for every row, and agree with the estimator's own counts", () => {
    const rows = [
      ...fourClocks(), // 4 events
      lat({}), lat({}), // 2 censored (open, awaiting)
      lat({ status: "RESOLVED", resolved_at: "2026-07-11T00:00:00Z" }), // 1 closed-before-fix
      lat({ first_seen: "2026-06-15T00:00:00Z" }), // 1 unmeasured (pre-rollout)
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

  // Why api.ts computes latency over a population the show-no-fix toggle has NOT narrowed.
  // baseRowNoFix is that toggle's predicate, and the rows it removes are exactly this
  // metric's censored population — so routing latency through visibleBase() would leave only
  // the findings that got a fix and report how fast the fixed ones were fixed. If someone
  // later "fixes the inconsistency" by filtering here, this test is what stops them.
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

    // Now apply the toggle's own predicate, as visibleBase would.
    const narrowed = rows.filter((r) => !baseRowNoFix(r));
    expect(latencySegments(narrowed, "detection", NOW)).toMatchObject({ events: 1, censored: 0 });
    // Every censored observation is gone, so the curve falls straight to zero on its single
    // event and the metric reports a 2-day vendor wait against a register that has been
    // waiting at least a month. That is the bias, in one number.
    expect(kmMedian(latencyView(narrowed, "detection", NOW))).toBe(2);
  });

  // The sibling of the Math.max(...times) regression above, on the latency path. Same shape
  // as that test on purpose — many rows, FEW distinct event times — because kmCurve is
  // O(distinct times x observations): 200k rows with 200k distinct times is quadratic and
  // would time out for a reason that has nothing to do with what is being guarded; the 500
  // distinct fix dates below (not 200k) are what keeps this test testing the estimator
  // instead of testing Date arithmetic. (This paragraph used to sit two tests up, above
  // "the show-no-fix filter..." — a 4-row fixture with no N and no distinct-times question —
  // moved here to where the thing it describes actually is.)
  //
  // Carries the same kind of explicit timeout as kaplanMeier's "large risk set" test above,
  // for the same reason: re-measured 2026-09-05 under `test:exact` (GAS_TEST_FULL_ISOLATION=1,
  // isolate:true, all 69 files), this test alone took 24.2s / 11.2s / 29.1s / 17.3s across
  // four runs — the worst leaving under a second of headroom against the OLD 30_000 budget,
  // which (like the sibling test's) was only vitest.config.ts's own default restated, not
  // real margin. N STAYS AT 200k for the same reason it does above — this test's claim IS
  // "register-sized", and shrinking the register shrinks the claim, not the runtime. 120_000
  // matches `gas_devsecops/test/remediation.test.ts`'s STRESS_TIMEOUT_MS for its own
  // N=200,000 cases — more than 4x the worst wall time measured above.
  //
  // NOT A SPREAD-REGRESSION GUARD, same as the "large risk set" test above and for the same
  // reason: this also runs its rows through `kaplanMeier` -> `maxNum`, but at N=200_000 under
  // the `pool: "threads"` worker this suite runs in, that spread never gets near the measured
  // boundary (clean up to 490,000, RangeError only from 498,321 — see `test/util.test.ts`'s
  // header). The name below states the claim this test actually holds: the projection and the
  // estimator stay correct at register scale. `test/util.test.ts` is the fast, direct guard
  // against the spread itself, at N=2,000,000; if it is ever deleted, that coverage needs
  // restoring before this test can be trusted to stand in for it.
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
  }, 120_000);
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
  });

  it("openTotal 0 -> pctOfOpen null; severity is normalized", () => {
    expect(awaitingVendorFix([])).toEqual({ perSev: {}, overall: 0, openTotal: 0, pctOfOpen: null });
    // All resolved: no open rows -> null share, not a fake 0%.
    expect(awaitingVendorFix([bRes(3, 3, "HIGH")])).toEqual({
      perSev: {},
      overall: 0,
      openTotal: 0,
      pctOfOpen: null,
    });
    // "weird" normalizes to UNKNOWN.
    const out = awaitingVendorFix([bOpen(5, null, true, "weird")]);
    expect(out.perSev).toEqual({ UNKNOWN: 1 });
    expect(out.overall).toBe(1);
    expect(out.pctOfOpen).toBe(100);
  });
});

describe("baseRowNoFix", () => {
  it("is true only for awaiting-vendor-fix rows; resolved / fixed rows are never hidden", () => {
    // Awaiting (open, no fix) -> no-fix; open-with-fix and resolved carry awaiting=false.
    expect(baseRowNoFix(bOpen(5, null, true))).toBe(true);
    expect(baseRowNoFix(bOpen(5, 5, false))).toBe(false); // open, fix available
    expect(baseRowNoFix(bRes(3, 3))).toBe(false); // resolved -> awaiting always false
  });
});

describe("recordNoFix", () => {
  // REMEDIATION_ROLLOUT_ISO = 2026-07-01; a record first seen before it had a fix by
  // construction. Post-rollout, a record is no-fix unless it carries fixedVersion or fixDate.
  const POST = "2026-07-05T00:00:00Z";
  const PRE = "2026-06-01T00:00:00Z";

  it("open + no fix, post-rollout -> true", () => {
    expect(recordNoFix({ status: "OPEN", firstDetectedAt: POST })).toBe(true);
  });
  it("fixedVersion present -> false", () => {
    expect(recordNoFix({ status: "OPEN", firstDetectedAt: POST, fixedVersion: "1.2.3" })).toBe(false);
  });
  it("fixDate present -> false", () => {
    expect(recordNoFix({ status: "OPEN", firstDetectedAt: POST, fixDate: "2026-07-06T00:00:00Z" })).toBe(false);
  });
  it("pre-rollout legacy row -> false (fixed by construction)", () => {
    expect(recordNoFix({ status: "OPEN", firstDetectedAt: PRE })).toBe(false);
  });
  it("resolved -> false (resolved rows are never hidden)", () => {
    expect(recordNoFix({ status: "RESOLVED", firstDetectedAt: POST })).toBe(false);
  });
});

describe("recordNoFix ↔ baseRow.awaiting_vendor_fix agreement", () => {
  // The frame predicate (recordNoFix, over dotted scan records) and the durable predicate
  // (baseRowNoFix, over ledgerCore.baseRows' awaiting_vendor_fix) must classify the SAME
  // underlying finding identically — including across the pre/post rollout boundary. Each
  // scenario pairs a frame record with the ledger row reconcile() would produce for it.
  const mkLedgerRow = (over: Partial<LedgerRow>): LedgerRow => ({
    vuln_key: "k", cve: null, severity: "HIGH",
    asset_id: null, asset_name: null, asset_type: null, cloud: null,
    first_seen: null, last_seen: null, status: "OPEN", resolved_at: null,
    resolution_src: null, reopened_count: 0, first_scan_id: null, last_scan_id: null,
    subscription_name: null, subscription_ext_id: null, tags_json: null,
    fix_date: null, fix_observed_at: null, published_date: null, ...emptyRiskSignals(),
    ...over,
  });

  const scenarios: { name: string; rec: Rec; ledger: Partial<LedgerRow> }[] = [
    {
      name: "open, no fix, post-rollout (awaiting)",
      rec: { status: "OPEN", firstDetectedAt: "2026-07-05T00:00:00Z" },
      ledger: { first_seen: "2026-07-05T00:00:00Z", status: "OPEN" },
    },
    {
      name: "open, no fix, PRE-rollout (legacy = fixed)",
      rec: { status: "OPEN", firstDetectedAt: "2026-06-01T00:00:00Z" },
      ledger: { first_seen: "2026-06-01T00:00:00Z", status: "OPEN" },
    },
    {
      name: "open, fixedVersion -> fix_observed_at seeded (post-rollout)",
      rec: { status: "OPEN", firstDetectedAt: "2026-07-05T00:00:00Z", fixedVersion: "1.2.3" },
      ledger: { first_seen: "2026-07-05T00:00:00Z", status: "OPEN", fix_observed_at: "2026-07-06T00:00:00Z" },
    },
    {
      name: "open, fixDate (post-rollout)",
      rec: { status: "OPEN", firstDetectedAt: "2026-07-05T00:00:00Z", fixDate: "2026-07-06T00:00:00Z" },
      ledger: {
        first_seen: "2026-07-05T00:00:00Z", status: "OPEN",
        fix_date: "2026-07-06T00:00:00Z", fix_observed_at: "2026-07-06T00:00:00Z",
      },
    },
    {
      name: "resolved, no fix, post-rollout",
      rec: { status: "RESOLVED", firstDetectedAt: "2026-07-05T00:00:00Z" },
      ledger: {
        first_seen: "2026-07-05T00:00:00Z", status: "RESOLVED", resolved_at: "2026-07-08T00:00:00Z",
      },
    },
  ];

  it("both predicates classify every scenario identically across the rollout boundary", () => {
    const state: LedgerState = emptyState();
    scenarios.forEach((s, i) => {
      state.ledger[`k${i}`] = mkLedgerRow({ ...s.ledger, vuln_key: `k${i}` });
    });
    const rows = baseRows(state, Date.parse("2026-07-17T00:00:00Z"));
    const byKey = Object.fromEntries(rows.map((r) => [r.vuln_key, r]));
    scenarios.forEach((s, i) => {
      const br = byKey[`k${i}`];
      // The durable derivation and the durable predicate agree by construction...
      expect(baseRowNoFix(br), `${s.name}: baseRowNoFix vs awaiting`).toBe(br.awaiting_vendor_fix);
      // ...and the frame predicate matches the durable one for the same finding.
      expect(recordNoFix(s.rec), `${s.name}: recordNoFix vs baseRow`).toBe(br.awaiting_vendor_fix);
    });
    // Sanity: the boundary is actually exercised — the two open/no-fix rows split on it.
    expect(recordNoFix(scenarios[0].rec)).toBe(true); // post-rollout awaiting
    expect(recordNoFix(scenarios[1].rec)).toBe(false); // pre-rollout legacy
  });
});

describe("isEndOfLifeName / recordEol", () => {
  it("matches the EOL-OS notice name across hyphen/case/spacing variants", () => {
    expect(isEndOfLifeName("End-Of-life version of operating system")).toBe(true);
    expect(isEndOfLifeName("end of life operating system")).toBe(true);
    expect(isEndOfLifeName("End-of-Life Operating System detected")).toBe(true);
  });
  it("does not match CVEs or unrelated names", () => {
    expect(isEndOfLifeName("CVE-2024-1234")).toBe(false);
    expect(isEndOfLifeName("End of life for a library")).toBe(false); // no "operating system"
    expect(isEndOfLifeName("Operating system misconfiguration")).toBe(false); // no "end of life"
    expect(isEndOfLifeName("")).toBe(false);
    expect(isEndOfLifeName(null)).toBe(false);
    expect(isEndOfLifeName(42)).toBe(false);
  });
  it("recordEol fires on the flag or the notice name", () => {
    expect(recordEol({ isOperatingSystemEndOfLife: true, name: "CVE-2024-1" })).toBe(true);
    expect(recordEol({ name: "End-Of-life version of operating system" })).toBe(true);
    expect(recordEol({ isOperatingSystemEndOfLife: false, name: "CVE-2024-1" })).toBe(false);
    expect(recordEol({ name: "CVE-2024-1" })).toBe(false);
  });
});

describe("EOL findings excluded from the MTTR KPI", () => {
  // filterEolBase drops a notice finding by its base-row `cve` (= the finding name). This proves an
  // old open EOL notice inflates the Kaplan–Meier median (the MTTR hero KPI) until it is filtered
  // out — so with the toggle off, EOL findings no longer affect the KPI.
  const eolRow = {
    severity: "HIGH", status: "OPEN", mttr_days: null, age_days: 1000,
    cve: "End-Of-life version of operating system",
  };
  const rows = [{ ...res(10), cve: "CVE-1" }, { ...res(20), cve: "CVE-2" }, eolRow];

  it("an old open EOL notice raises the KM median until it is filtered out", () => {
    // With the EOL notice censored at 1000d in the risk set, the curve crosses 0.5 at the 20d event.
    expect(kaplanMeier(rows).median).toBe(20);
    // Excluding it (the exact predicate filterEolBase applies to `cve`) drops the median to 10d.
    const visible = rows.filter((r) => !isEndOfLifeName(r.cve));
    expect(kaplanMeier(visible).median).toBe(10);
  });
});
