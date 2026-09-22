// MTTR delayed entry (left truncation) — the estimator package. This register's clock does not
// start at zero: a finding that was already 90 days old the day this register started scanning
// enters the risk set at age 90, not age 0, because nothing before that day was ever observable.
// `kaplanMeier(rows, opts)` (remediation.ts) is the estimator this file pins; see its own
// docstring and `kaplanMeierExtended`'s for the algorithm this file is verifying by hand.
//
// Five things this file has to show, each its own describe block:
//   1. risk-set membership under delayed entry, INCLUDING the entry === t boundary (strict <);
//   2. exit <= entry rows are excluded outright (events, censored, AND risk set) and counted;
//   3. the Gebski et al. reliability cut, both "first event already fails" and "passes for a
//      while, then fails mid-curve", with median/q25/q75 read off the CUT curve only;
//   4. RMST under an opts.horizonDays cap, including its interaction with the reliability cut;
//   5. "legacy identical": kaplanMeier(rows) — no opts, no entry_days on any row — reproduces a
//      COPIED-VERBATIM oracle of the pre-package algorithm, on randomized input.

import { describe, expect, it } from "vitest";
import {
  kaplanMeier,
  kmCurve,
  kmMedianFromCurve,
  type KMPoint,
  type KMResult,
  type RemediationRow,
} from "../src/domain/remediation";
import { RESOLVED_STATUSES } from "../src/domain/config";
import { mean, median } from "../src/domain/util";

// A resolved row at `mttr_days = t`, entering observation at `entry` on its own clock (0 = no
// delayed entry). An open row at `age_days = t` likewise.
const res = (t: number, entry = 0, severity = "HIGH"): RemediationRow => ({
  severity,
  status: "RESOLVED",
  mttr_days: t,
  age_days: null,
  entry_days: entry,
});
const open = (t: number, entry = 0, severity = "HIGH"): RemediationRow => ({
  severity,
  status: "OPEN",
  mttr_days: null,
  age_days: t,
  entry_days: entry,
});

// A KM curve is a RUNNING PRODUCT (kmQuantileFromCurve's own CROSSING_EPSILON comment, and
// test/kmCrossing.test.ts, establish exactly this): a hand-typed fraction literal like `2/3`
// and the algorithm's own `1 * (1 - 1/3)` are mathematically equal but not always bit-identical
// doubles. Every survival value this file hand-derives is checked with this helper — t/atRisk/
// events (always exact integers) via strict equality, s via a tight tolerance — rather than a
// brittle whole-array `toEqual` against typed-out fractions.
function expectCurveClose(
  actual: KMPoint[],
  expected: { t: number; s: number; atRisk: number; events: number }[],
): void {
  expect(actual, "curve length").toHaveLength(expected.length);
  expected.forEach((e, i) => {
    expect(actual[i]?.t, `point ${i} t`).toBe(e.t);
    expect(actual[i]?.atRisk, `point ${i} atRisk`).toBe(e.atRisk);
    expect(actual[i]?.events, `point ${i} events`).toBe(e.events);
    expect(actual[i]?.s, `point ${i} s`).toBeCloseTo(e.s, 12);
  });
}

// ------------------------------------------------------------------- 1. risk-set membership

describe("delayed entry: risk-set membership, including the entry === t boundary", () => {
  // Five findings, hand-picked so the risk set at each event time has to be worked by hand:
  //   S1  entry 0, event at  4         S2  entry 0, censored at 20
  //   S3  entry 2, event at  8         S4  entry 4, event at  8   <- entry EQUALS S1's event (4)
  //   S5  entry 0, censored at 30
  //
  // At t=4 (S1's own event): candidates need entry < 4 <= exit.
  //   S1  entry 0 < 4, exit  4 >= 4  -> AT RISK (the event itself)
  //   S2  entry 0 < 4, exit 20 >= 4  -> AT RISK (still open, censored later)
  //   S3  entry 2 < 4, exit  8 >= 4  -> AT RISK
  //   S4  entry 4 < 4 is FALSE       -> NOT YET ENTERED (the boundary this test exists for:
  //                                     S4's entry lands exactly on S1's event time, and the
  //                                     rule is entry < t STRICTLY, so S4 is excluded from the
  //                                     risk set at t=4 despite entry "already being 4")
  //   S5  entry 0 < 4, exit 30 >= 4  -> AT RISK
  //   atRisk(4) = 4, d(4) = 1 (S1).  S(4) = 1 * (1 - 1/4) = 3/4 = 0.75.
  //
  // At t=8 (S3 and S4's events): candidates need entry < 8 <= exit.
  //   S1  exit 4 < 8   -> already exited, excluded
  //   S2  entry 0 < 8, exit 20 >= 8  -> AT RISK
  //   S3  entry 2 < 8, exit  8 >= 8  -> AT RISK (its own event)
  //   S4  entry 4 < 8, exit  8 >= 8  -> AT RISK now (entry 4 < 8, unlike at t=4) (its own event)
  //   S5  entry 0 < 8, exit 30 >= 8  -> AT RISK
  //   atRisk(8) = 4, d(8) = 2 (S3, S4).  S(8) = 0.75 * (1 - 2/4) = 0.75 * 0.5 = 0.375.
  const rows: RemediationRow[] = [
    res(4, 0), // S1
    open(20, 0), // S2
    res(8, 2), // S3
    res(8, 4), // S4 — entry equals S1's event time
    open(30, 0), // S5
  ];

  it("matches the hand-derived curve exactly, including the entry===t exclusion", () => {
    const km = kaplanMeier(rows, {});
    expectCurveClose(km.curve, [
      { t: 4, s: 0.75, atRisk: 4, events: 1 },
      { t: 8, s: 0.375, atRisk: 4, events: 2 },
    ]);
    expect(km.events).toBe(3); // S1, S3, S4
    expect(km.censored).toBe(2); // S2, S5
    expect(km.total).toBe(5);
    expect(km.excludedPreEntry).toBe(0); // every exit > its own entry here
    expect(km.maxObserved).toBe(30); // S5's exit
    expect(km.median).toBe(8); // first t with S <= 0.5
  });

  it("without any entry_days at all, the same shape collapses to the ordinary risk set", () => {
    // Same five exit times, entry 0 throughout: kmCurve's own #{exit >= t} should agree with
    // the entry-aware #{entry < t <= exit} whenever every entry is 0 and every t > 0 (see
    // remediation.ts's kmCurveEntry comment on why the two coincide there). atRisk(4) is 5 here
    // (not 4): with no entry concept at all, S4 counts from t=0, unlike the entry-aware curve
    // above where its own entry (4) excludes it from that same instant.
    const exits = [4, 20, 8, 8, 30];
    const events = [4, 8, 8];
    expectCurveClose(kmCurve(events, exits), [
      { t: 4, s: 0.8, atRisk: 5, events: 1 },
      { t: 8, s: 0.4, atRisk: 4, events: 2 },
    ]);
  });
});

// ------------------------------------------------------------------- 2. exit <= entry exclusion

describe("delayed entry: exit <= entry rows are excluded outright", () => {
  it("an event at-or-before its own entry never becomes an event, censored obs, or risk-set member", () => {
    const rows: RemediationRow[] = [
      res(5, 5), // exit == entry: resolved exactly when we started watching it -> excluded
      res(3, 5), // exit < entry: resolved before we could have seen it -> excluded
      open(5, 5), // same idea, censored side: already this old at entry -> excluded
      res(10, 5), // exit > entry: a genuine, observed event
    ];
    const km = kaplanMeier(rows, {});
    expect(km.excludedPreEntry).toBe(3);
    expect(km.events).toBe(1);
    expect(km.censored).toBe(0);
    expect(km.total).toBe(1);
    expect(km.curve).toEqual([{ t: 10, s: 0, atRisk: 1, events: 1 }]);
    expect(km.maxObserved).toBe(10); // the excluded rows never enter the observed population
  });

  it("excludedPreEntry is 0 whenever nothing is excluded, even in extended mode", () => {
    const km = kaplanMeier([res(1), res(2)], {});
    expect(km.excludedPreEntry).toBe(0);
  });
});

// ------------------------------------------------------------------- 3. the reliability cut
//
// Gebski et al. (Int J Epidemiol 2018): a KM curve is reliable at event time t while its risk
// set n(t) >= max(10, 50*S(t-)) — one more event could not move survival by more than 2 points.
// Near S=1 that requires n(t) >= 50, which is why a handful of rows always fails immediately;
// showing a genuine mid-curve cut takes a big enough population that the shape below builds
// with plain arithmetic (one event per day, so S(k) telescopes to a clean fraction) rather than
// picking 100 arbitrary numbers by hand.

/** `count` resolved rows, one event per day at t = 1..count, entry 0 throughout. */
function dailyEvents(count: number, severity = "HIGH"): RemediationRow[] {
  return Array.from({ length: count }, (_, i) => res(i + 1, 0, severity));
}

describe("delayed entry: the reliability cut (Gebski et al.)", () => {
  it("a small population fails at the very first event: reliableUntil null, curve cut to empty", () => {
    // The classic 4-row curve (test/remediation.test.ts's own fixture): atRisk never exceeds 4,
    // far under the n(t) >= 50 the metric requires at S(t-)=1. Its FULL curve has a perfectly
    // good median (2) — the cut says that reaching it here is not something to trust.
    const rows = [res(1), res(2), res(3), res(4)];
    const uncut = kaplanMeier(rows, {}); // opts.minRisk not set -> full curve ships
    expect(uncut.median).toBe(2);
    expect(uncut.reliableUntil).toBeNull(); // "no cut" reading of null: minRisk was never asked

    const cut = kaplanMeier(rows, { minRisk: true });
    expect(cut.reliableUntil).toBeNull(); // "the first event already fails" reading
    expect(cut.curve).toEqual([]);
    expect(cut.median).toBeNull();
    expect(cut.q25).toBeNull();
    expect(cut.q75).toBeNull();
    // legacy median-null convention was "the max observed time"; under minRisk it is the
    // honest "median > last reliable time" — and here nothing at all was reliable.
    expect(cut.medianLowerBound).toBe(cut.maxObserved);
  });

  it("a 100-row population passes for a while, then fails: reliableUntil cuts mid-curve", () => {
    // 100 rows, entry 0, one event per day t=1..99, plus one row censored far out (t=1000) so
    // the risk set never empties before the events do. With exactly one exit per day and no
    // other censoring in between, survival telescopes to the closed form S(k) = (100-k)/100,
    // and n(k) (the risk set going into day k's event) = 101-k. Both are checkable by hand:
    //   n(k) = 100 - (k-1) rows haven't exited yet going into day k (k-1 events already
    //          happened on days 1..k-1, the far-out row never has).
    //   S(k) = Π_{i=1..k} (1 - 1/n(i)) = Π_{i=1..k} (1 - 1/(101-i)) = (100-k)/100 (telescoping:
    //          each factor is (100-i)/(101-i), and consecutive terms cancel).
    // Reliability requires n(k) >= max(10, 50*S(k-1)), S(k-1) = (101-k)/100:
    //   50*S(k-1) = (101-k)/2, and n(k) = 101-k, so n(k) >= 50*S(k-1) reduces to 1 >= 1/2 —
    //   ALWAYS true. The 50*S branch never fires here; only the absolute floor of 10 can, at
    //   n(k) = 101-k < 10, i.e. k > 91 -> first failure at k=92 (n=9). reliableUntil is the
    //   last PASSING event, k=91 (n(91)=10, threshold max(10, 50*S(90))=max(10,9.166..)=10,
    //   10 >= 10 passes).
    const rows: RemediationRow[] = [...dailyEvents(99), open(1000, 0)];
    const full = kaplanMeier(rows, {}); // uncut, for comparison
    expect(full.curve).toHaveLength(99);

    const cut = kaplanMeier(rows, { minRisk: true });
    expect(cut.reliableUntil).toBe(91);
    expect(cut.curve).toHaveLength(91);
    expect(cut.curve.every((p) => p.t <= 91)).toBe(true);
    // The median (S <= 0.5 at t=50, since S(t)=(100-t)/100) sits comfortably inside the
    // reliable region, so the cut does not hide it here.
    expect(cut.median).toBe(50);
  });

  it("a censoring cliff pulls the cut in front of the median: q25 survives it, q75/median don't", () => {
    // Same telescoping shape as above (N=100, S(k)=(100-k)/100), but only through day 40 —
    // then 40 of the 60 remaining rows are censored all at once on day 41 (a "cliff"), and the
    // other 20 become events on days 42..61. n(t) for t=1..40 is 101-t exactly as before (no
    // exits before day 41), so every one of those 40 events passes reliability by the same
    // algebra as the previous test (n(k) always exceeds 50*S(k-1) while N=100 > 50).
    //
    // At t=42 (the first post-cliff event): S(40) = 60/100 = 0.6 (censoring never moves S), and
    // n(42) = 20 (only the un-censored 20 remain at risk; the cliff's 40 exited on day 41 < 42).
    // Required: n(42) >= max(10, 50*0.6) = 30. 20 < 30 -> FAILS. reliableUntil = 40, the last
    // passing (and in fact only) event before the cliff.
    const phase1 = dailyEvents(40); // events at t = 1..40
    const cliff = Array.from({ length: 40 }, () => open(41, 0)); // censored together at t=41
    const phase2 = Array.from({ length: 20 }, (_, i) => res(42 + i, 0)); // events t = 42..61
    const rows = [...phase1, ...cliff, ...phase2];
    expect(rows).toHaveLength(100);

    const cut = kaplanMeier(rows, { minRisk: true });
    expect(cut.reliableUntil).toBe(40);
    expect(cut.curve).toHaveLength(40);

    // S(t) = (100-t)/100 through the reliable region (t <= 40).
    // q25 (25% fixed): S(t) <= 0.75 first at t=25 -- inside the cut (25 <= 40) -> present.
    expect(cut.q25).toBe(25);
    // median (S <= 0.5, t=50) and q75 (S <= 0.25, t=75) both fall PAST the cut at t=40 -> both
    // are unreached WITHIN the trusted curve, even though the full population (ignoring the
    // cliff) would eventually have crossed both.
    expect(cut.median).toBeNull();
    expect(cut.q75).toBeNull();
    expect(cut.medianLowerBound).toBe(40); // "median > 40", the honest reliable-range statement

    // Without the cut, the same rows DO cross both eventually (the full 60-event curve, cliff
    // included as censoring only, still reaches every quantile) — the cut is what withholds
    // them, not an absence of data. Past the cliff the closed form changes, though: the cliff
    // removes 40 rows from the risk set WITHOUT any event (censoring divides n(t), not S(t)),
    // so phase 2 starts a FRESH telescoping product over its own 20-row pool rather than
    // continuing "(100-t)/100": after the i-th phase-2 event (t = 41+i), S = S(40) * (20-i)/20
    // = 0.6*(20-i)/20 = (60-3i)/100 (exact fraction, since 0.6 = S(40) = 60/100).
    //   median (S <= 0.5): 60-3i <= 50 -> i >= 10/3 -> i=4 -> t = 41+4 = 45. (i=3 gives 51/100.)
    //   q75    (S <= 0.25): 60-3i <= 25 -> i >= 35/3 -> i=12 -> t = 41+12 = 53. (i=11 gives 27/100.)
    const uncut = kaplanMeier(rows, {});
    expect(uncut.median).toBe(45);
    expect(uncut.q75).toBe(53);
  });
});

// ------------------------------------------------------------------- 4. horizon RMST

describe("delayed entry: RMST under opts.horizonDays", () => {
  it("τ is capped at horizonDays when that is the binding constraint", () => {
    // The classic 1,2,3,4 curve: S drops .75/.5/.25/0 at t=1,2,3,4. horizonDays=2.5, no
    // minRisk, so reliableUntil is null (not requested) and τ = min(2.5, maxObserved=4) = 2.5.
    // RMST = 1*(1-0) + .75*(2-1) + .5*(2.5-2) = 1 + .75 + .25 = 2.0 (the t=3,t=4 points never
    // enter the integral — rmstToTau stops at the first curve point past τ).
    const km = kaplanMeier([res(1), res(2), res(3), res(4)], { horizonDays: 2.5 });
    expect(km.restrictionTime).toBe(2.5);
    expect(km.mean).toBeCloseTo(2.0, 10);
    expect(km.meanTruncated).toBe(true); // S(2.5) = 0.5 > 0: RMST is a lower bound at this τ
    expect(km.maxObserved).toBe(4); // the uncapped figure survives alongside τ
  });

  it("τ is capped at the reliability cut when that binds tighter than the horizon", () => {
    // Reuse the 100-row, cliff-at-41 population from the reliability describe block:
    // reliableUntil = 40. horizonDays=60 (looser than the cut) -> τ = min(60, 40) = 40, not 60.
    const phase1 = dailyEvents(40);
    const cliff = Array.from({ length: 40 }, () => open(41, 0));
    const phase2 = Array.from({ length: 20 }, (_, i) => res(42 + i, 0));
    const rows = [...phase1, ...cliff, ...phase2];

    const km = kaplanMeier(rows, { horizonDays: 60, minRisk: true });
    expect(km.reliableUntil).toBe(40);
    expect(km.restrictionTime).toBe(40); // the cut bound, not the horizon
    // RMST to τ=40 over S(t)=(100-t)/100, t=1..40, one-day rectangles:
    //   Σ_{k=1}^{40} S(k-1) = Σ_{k=0}^{39} (100-k)/100 = (1/100) * Σ_{m=61}^{100} m
    //                       = (1/100) * (61+100)*40/2 = (1/100)*3220 = 32.2.
    expect(km.mean).toBeCloseTo(32.2, 9);
    expect(km.meanTruncated).toBe(true); // S(40) = 0.6 > 0
  });

  it("with no horizonDays, τ stays the max observed time (legacy default), even under minRisk", () => {
    const rows = [...dailyEvents(99), open(1000, 0)];
    const km = kaplanMeier(rows, { minRisk: true }); // no horizonDays
    expect(km.reliableUntil).toBe(91);
    expect(km.restrictionTime).toBe(1000); // τ = maxObserved, unconstrained by the cut
    expect(km.maxObserved).toBe(1000);
  });
});

// ------------------------------------------------------------------- 5. legacy identical
//
// "kaplanMeier(rows)" — no opts, no entry_days on any row — must reproduce the pre-package
// algorithm exactly. remediation.ts's own dispatch guarantees this by routing to a verbatim
// copy of that algorithm (kaplanMeierLegacy); this test verifies it independently against a
// SEPARATE copy of the same pre-package algorithm, so the two copies have to agree rather than
// the test simply re-deriving remediation.ts's own internal routing.

/** Mulberry32 — a tiny, seeded, deterministic PRNG, so this property test is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The pre-package algorithm, copied verbatim (in spirit — same operations, same order) from
 * remediation.ts as it stood before this file's package, kept independent of
 * `kaplanMeierLegacy` so this test is a real cross-check rather than a tautology.
 */
function legacyOracle(rows: RemediationRow[]): KMResult {
  // isOpen: the same "not one of the resolved/closed statuses" test remediation.ts's own
  // (unexported) isOpen applies, reusing the shared status vocabulary rather than re-guessing
  // it — the thing under independent verification here is the ESTIMATOR, not this vocabulary.
  const isOpen = (status: unknown) => !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
  const events: number[] = [];
  const censored: number[] = [];
  for (const row of rows) {
    const m = row.mttr_days;
    if (typeof m === "number" && Number.isFinite(m)) {
      events.push(m);
      continue;
    }
    if (isOpen(row.status)) {
      const a = row.age_days;
      if (typeof a === "number" && Number.isFinite(a)) censored.push(a);
    }
  }
  const times = events.concat(censored);
  const total = events.length + censored.length;
  const restrictionTime = times.length ? Math.max(...times) : null;
  const naiveMean = mean(events);
  const naiveMedian = median(events);

  if (!events.length) {
    return {
      curve: [],
      median: null,
      medianLowerBound: restrictionTime,
      mean: null,
      restrictionTime,
      meanTruncated: false,
      naiveMean,
      naiveMedian,
      events: 0,
      censored: censored.length,
      total,
    };
  }

  const curve = kmCurve(events, times);
  const median_ = kmMedianFromCurve(curve);
  const tau = restrictionTime!;
  let rmst = 0;
  let prevT = 0;
  let prevS = 1;
  for (const p of curve) {
    rmst += prevS * (p.t - prevT);
    prevT = p.t;
    prevS = p.s;
  }
  rmst += prevS * (tau - prevT);

  return {
    curve,
    median: median_,
    medianLowerBound: median_ === null ? restrictionTime : null,
    mean: rmst,
    restrictionTime,
    meanTruncated: prevS > 0,
    naiveMean,
    naiveMedian,
    events: events.length,
    censored: censored.length,
    total,
  };
}

// resolvedMttr/isOpen in remediation.ts treat status case-insensitively and gate censoring on
// isOpen(status) rather than "not resolved-and-finite-mttr"; the oracle above mirrors that
// exactly (RESOLVED rows never fall through to the age_days branch even with a null mttr_days,
// matching resolvedMttr/openAge's own contract), so random rows exercise the same branches.
function randomRow(rand: () => number): RemediationRow {
  const severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "weird"];
  const severity = severities[Math.floor(rand() * severities.length)];
  const bucket = rand();
  if (bucket < 0.45) {
    // Resolved with a finite mttr_days (an event).
    const mttr = Math.round(rand() * 500 * 100) / 100;
    return { severity, status: "RESOLVED", mttr_days: mttr, age_days: null };
  }
  if (bucket < 0.85) {
    // Open with a finite age_days (censored).
    const age = Math.round(rand() * 500 * 100) / 100;
    return { severity, status: "OPEN", mttr_days: null, age_days: age };
  }
  if (bucket < 0.93) {
    // Resolved with no captured mttr_days — contributes to neither clock.
    return { severity, status: "RESOLVED", mttr_days: null, age_days: null };
  }
  // Open with no captured age_days — contributes to neither clock either.
  return { severity, status: "OPEN", mttr_days: null, age_days: null };
}

describe("legacy identity: kaplanMeier(rows) with no opts and no entry_days", () => {
  it("matches a from-scratch copy of the pre-package algorithm across 200 random populations", () => {
    const rand = mulberry32(0xc0ffee);
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rand() * 40);
      const rows: RemediationRow[] = Array.from({ length: n }, () => randomRow(rand));
      const got = kaplanMeier(rows); // no second argument at all
      const want = legacyOracle(rows);
      expect(got, `trial ${trial}, n=${n}`).toEqual(want);
    }
  });

  it("an explicit entry_days of 0 (present but zero) is the same as omitting it entirely", () => {
    // Bullet 1's normalization rule (absent/null/<=0 -> 0) applied to the DISPATCH decision
    // too: a row carrying entry_days: 0 must not accidentally route into the extended
    // algorithm and diverge from a row that omits the field, since 0 means "no delayed entry"
    // either way.
    const withZero: RemediationRow[] = [
      { severity: "HIGH", status: "RESOLVED", mttr_days: 5, age_days: null, entry_days: 0 },
      { severity: "HIGH", status: "OPEN", mttr_days: null, age_days: 12, entry_days: null },
    ];
    const withoutField: RemediationRow[] = [
      { severity: "HIGH", status: "RESOLVED", mttr_days: 5, age_days: null },
      { severity: "HIGH", status: "OPEN", mttr_days: null, age_days: 12 },
    ];
    expect(kaplanMeier(withZero)).toEqual(kaplanMeier(withoutField));
    expect(kaplanMeier(withZero)).toEqual(legacyOracle(withoutField));
  });
});

// ------------------------------------------------------------------- worked example (hand-checked)
//
// A small, fully hand-traceable left-truncation example in the lifelines/`Surv(start, stop,
// event)` convention (entry/exit per subject, at-risk membership entry < t <= exit) — the
// "reproduce a worked example by hand" cross-check. Six subjects, chosen so every risk set and
// every survival step is exact fractions rather than something requiring a solver:
//
//   subject   entry   exit   event?
//     A         0       3      yes
//     B         0       6      no (censored)
//     C         2       5      yes
//     D         3       7      yes
//     E         4       7      yes
//     F         5       9      no (censored)
//
// Event times: 3, 5, 7 (7 is a tie between D and E).
//
// t=3 (A's event): entry<3<=exit — A(0<3,3>=3) yes; B(0<3,6>=3) yes; C(2<3,5>=3) yes;
//   D(3<3 false) not yet entered; E(4<3 false) no; F(5<3 false) no.
//   atRisk=3, d=1 (A). S(3) = 1 * (1 - 1/3) = 2/3.
//
// t=5 (C's event): A already exited (3<5). entry<5<=exit — B(0<5,6>=5) yes; C(2<5,5>=5) yes;
//   D(3<5,7>=5) yes; E(4<5,7>=5) yes; F(5<5 false) not yet entered.
//   atRisk=4, d=1 (C). S(5) = (2/3) * (1 - 1/4) = (2/3)*(3/4) = 1/2.
//
// t=7 (D and E's tied event): A, C already exited. entry<7<=exit — B(0<7,6>=7 false) already
//   exited (censored at 6 < 7); D(3<7,7>=7) yes; E(4<7,7>=7) yes; F(5<7,9>=7) yes.
//   atRisk=3, d=2 (D, E). S(7) = (1/2) * (1 - 2/3) = (1/2)*(1/3) = 1/6.
//
// median: first S <= 0.5 is t=5 (exact tie, inclusive crossing). maxObserved = 9 (F).
describe("worked example (hand-checked, lifelines Surv(start, stop, event) convention)", () => {
  it("reproduces the by-hand curve and median exactly", () => {
    const rows: RemediationRow[] = [
      res(3, 0), // A
      open(6, 0), // B
      res(5, 2), // C
      res(7, 3), // D
      res(7, 4), // E
      open(9, 5), // F
    ];
    const km = kaplanMeier(rows, {});
    // Thirds and sixths are not exact binary fractions, so — same reasoning as
    // expectCurveClose's own comment — these are checked with tolerance rather than a bare
    // `toEqual` against typed-out fraction literals.
    expectCurveClose(km.curve, [
      { t: 3, s: 2 / 3, atRisk: 3, events: 1 },
      { t: 5, s: 1 / 2, atRisk: 4, events: 1 },
      { t: 7, s: 1 / 6, atRisk: 3, events: 2 },
    ]);
    expect(km.median).toBe(5);
    expect(km.maxObserved).toBe(9);
    expect(km.events).toBe(4);
    expect(km.censored).toBe(2);
    expect(km.excludedPreEntry).toBe(0);
  });
});
