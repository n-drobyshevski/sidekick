// THE KAPLAN-MEIER CROSSING TOLERANCE — S(t) is a running product, and the running product
// and a threshold built by plain subtraction can round to opposite sides of the same real
// number.
//
// CLAUDE.md's own example, pinned here: ten events at t = 1..10 with no censoring give
// S(9) = 0.10000000000000002, while the p90 threshold `1 - 0.9` evaluates to
// 0.09999999999999998 — two separate representation errors leaning opposite ways, so a bare
// `s <= threshold` skips the crossing at t=9 and reports 10 instead. `kmQuantileFromCurve`
// compares `p.s <= threshold + CROSSING_EPSILON` for exactly this reason (both defined
// together in remediation.ts). Ported from gas/test/kmCrossing.test.ts — this estimator is
// byte-identical between the two registers (this file's header says so).

import { describe, expect, it } from "vitest";

import {
  CROSSING_EPSILON,
  kaplanMeier,
  kmCurve,
  kmQuantileFromCurve,
  type KMPoint,
  type RemediationRow,
} from "../src/domain/remediation";

/** A resolved row at `mttr_days = t` — the shape kaplanMeier reads for an event. */
function resolved(t: number): RemediationRow {
  return { severity: "CRITICAL", status: "RESOLVED", mttr_days: t, age_days: null };
}

describe("the crossing epsilon, on CLAUDE.md's own example", () => {
  // Ten events at t = 1..10, nothing censored. Exact arithmetic gives S(k) = (10-k)/10, so
  // the p90 (S <= 0.10) is 9 and the median (S <= 0.5) is 5.
  const TEN = Array.from({ length: 10 }, (_, i) => resolved(i + 1));

  it("reports p90 = 9 and median = 5", () => {
    // KMResult has no p90 field of its own (unlike the median) — every caller derives it by
    // calling kmQuantileFromCurve(curve, 0.9) off the same curve, so that is what this test
    // reads too rather than a field that does not exist.
    const km = kaplanMeier(TEN);
    expect(kmQuantileFromCurve(km.curve, 0.9)).toBe(9);
    expect(km.median).toBe(5);
    expect(km.events).toBe(10);
    expect(km.censored).toBe(0);
    expect(km.total).toBe(10);
    // A known median publishes no lower bound: a figure beside its own floor invites a
    // comparison that means nothing.
    expect(km.medianLowerBound).toBeNull();
  });

  it("PERTURBATION: a bare `s <= threshold` reports 10, because the ULP leans the wrong way",
    () => {
      const times = TEN.map((r) => r.mttr_days as number);
      const curve = kmCurve(times, times);
      const bare = (c: readonly KMPoint[], q: number): number | null => {
        const threshold = 1 - q;
        for (const p of c) if (p.s <= threshold) return p.t; // the defective comparison
        return null;
      };
      // The two representation errors lean opposite ways, which is the whole finding: the
      // running product lands ABOVE 0.1 and the threshold lands BELOW it.
      const s9 = curve.filter((p) => p.t === 9)[0]!.s;
      expect(s9).toBeGreaterThan(1 - 0.9);
      expect(s9 - 0.1).toBeLessThan(CROSSING_EPSILON);
      expect(bare(curve, 0.9)).toBe(10);
      expect(kmQuantileFromCurve(curve, 0.9)).toBe(9);
    });

  it("is a tolerance, not a shift — a curve landing at 0.1 + 1e-6 does not cross", () => {
    // A synthetic point standing in for the real curve: only `s` and `t` matter to
    // kmQuantileFromCurve, so atRisk/events are filler. 1e-6 is a thousand times
    // CROSSING_EPSILON (1e-9) — if the epsilon rescued this point too, it would be a SHIFT of
    // the threshold rather than a tolerance for float rounding, and every p90 would silently
    // report events a whole day-bucket later than measured.
    const farAbove: KMPoint[] = [{ t: 9, s: 0.1 + 1e-6, atRisk: 2, events: 1 }];
    expect(kmQuantileFromCurve(farAbove, 0.9)).toBeNull();

    // The genuine ULP case, for contrast: same shape, an epsilon-sized gap, and it does cross.
    const oneUlpAbove: KMPoint[] = [{ t: 9, s: 0.1 + 1e-10, atRisk: 2, events: 1 }];
    expect(kmQuantileFromCurve(oneUlpAbove, 0.9)).toBe(9);
  });
});
