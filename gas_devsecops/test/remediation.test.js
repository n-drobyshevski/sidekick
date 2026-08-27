// The censoring-aware clock, and the numbers it refuses to invent.

import { describe, expect, it } from "vitest";
import {
  awaitingVendorFix, kaplanMeier, kmCurve, kmMedianFromCurve, kmQuantileFromCurve,
  mttrPercentiles, openAgePercentiles, openPastSla, resolutionBuckets,
} from "../src/domain/remediation";

/** A resolved row that took `d` days. */
const closed = (d, severity = "CRITICAL") =>
  ({ severity, status: "RESOLVED", mttr_days: d, age_days: null });

/** An open row `d` days old — a right-censored observation. */
const open = (d, severity = "CRITICAL") =>
  ({ severity, status: "OPEN", mttr_days: null, age_days: d });

describe("Kaplan-Meier, and why the naive median is not enough", () => {
  it("censoring pulls the estimate ABOVE the closed-only median", () => {
    // THE WHOLE REASON THIS MODULE EXISTS. Three findings closed fast; seven have been open
    // far longer and are still open. The closed-only median describes the three that had
    // time to close and says nothing about the seven.
    const rows = [closed(1), closed(2), closed(3), ...Array.from({ length: 7 }, () => open(200))];
    const km = kaplanMeier(rows);
    expect(km.naiveMedian).toBe(2);      // the biased answer: "we fix things in two days"
    expect(km.median).toBeNull();        // survival never falls to half — 70% never closed
    expect(km.medianLowerBound).toBe(200); // so publish the floor, not "—" and not 2
    expect(km.events).toBe(3);
    expect(km.censored).toBe(7);
  });

  it("agrees with the naive median when nothing is censored", () => {
    // The estimator is not a different answer, it is the same answer under a weaker
    // assumption. With no open rows the two must coincide.
    const rows = [closed(2), closed(4), closed(6), closed(8)];
    const km = kaplanMeier(rows);
    // S drops 1 -> .75 -> .5 -> .25 -> 0 at t = 2,4,6,8, so the crossing is t=4.
    expect(km.median).toBe(4); // smallest event time with S(t) <= 0.5
    expect(km.naiveMedian).toBe(5); // linear interpolation between 4 and 6
    expect(km.meanTruncated).toBe(false); // survival reached 0 by τ
  });

  it("publishes a lower bound when nothing has closed at all", () => {
    // Not "MTTR unknown". Every open finding sets a floor.
    const km = kaplanMeier([open(30), open(400), open(90)]);
    expect(km.median).toBeNull();
    expect(km.medianLowerBound).toBe(400);
    expect(km.mean).toBeNull();
    expect(km.events).toBe(0);
    expect(km.total).toBe(3);
  });

  it("flags a truncated RMST as a lower bound", () => {
    // S(τ) > 0 means survival never reached zero inside the observation window, so the
    // restricted mean is an underestimate and the page must render it with a ">=".
    const km = kaplanMeier([closed(10), open(100)]);
    expect(km.meanTruncated).toBe(true);
    expect(km.restrictionTime).toBe(100);
    expect(km.mean).toBeGreaterThan(10);
  });

  it("computes the RMST as the area under the staircase", () => {
    // Two events, no censoring: S drops 1 -> 0.5 at t=2, 0.5 -> 0 at t=4.
    // RMST = 1*(2-0) + 0.5*(4-2) + 0*(4-4) = 3.
    const km = kaplanMeier([closed(2), closed(4)]);
    expect(km.mean).toBe(3);
    expect(km.meanTruncated).toBe(false);
  });

  it("drops a row with neither a lifetime nor an age from every count", () => {
    // Not evidence in either direction, so it is not in the denominator either.
    const km = kaplanMeier([closed(5), { severity: "HIGH", status: "OPEN", mttr_days: null, age_days: null }]);
    expect(km.total).toBe(1);
    expect(km.censored).toBe(0);
  });

  it("returns an empty result rather than throwing on no rows", () => {
    const km = kaplanMeier([]);
    expect(km.curve).toEqual([]);
    expect(km.restrictionTime).toBeNull();
    expect(km.total).toBe(0);
  });
});

describe("the curve itself", () => {
  it("drops by d/atRisk at each distinct event time", () => {
    const curve = kmCurve([2, 2, 5], [2, 2, 5, 9]);
    expect(curve[0]).toMatchObject({ t: 2, atRisk: 4, events: 2 });
    expect(curve[0].s).toBeCloseTo(0.5, 10); // 1 - 2/4
    expect(curve[1]).toMatchObject({ t: 5, atRisk: 2, events: 1 });
    expect(curve[1].s).toBeCloseTo(0.25, 10); // 0.5 * (1 - 1/2)
  });

  it("returns the crossing time on an exact tie", () => {
    const curve = kmCurve([2, 4], [2, 4]);
    expect(kmMedianFromCurve(curve)).toBe(2); // S(2) is exactly 0.5, inclusive crossing
  });

  it("gives the p90 the same censoring-aware treatment", () => {
    // AND pins the float-tolerance correction. S(t) here is exactly (10-t)/10, so S(9) is
    // 0.1 and the p90 is 9 — but the running product yields 0.10000000000000002, which the
    // source's exact `<=` rejects, reporting 10. See CROSSING_EPSILON.
    const curve = kmCurve([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], Array.from({ length: 10 }, (_, i) => i + 1));
    expect(curve[8].s).not.toBe(0.1); // the accumulated value really is off by one ULP
    expect(kmQuantileFromCurve(curve, 0.9)).toBe(9);
    expect(kmQuantileFromCurve(curve, 0.5)).toBe(5);
  });

  it("returns null rather than a number when survival never falls that far", () => {
    const curve = kmCurve([5], [5, 100, 100, 100]);
    expect(kmMedianFromCurve(curve)).toBeNull(); // S(5) = 0.75
  });
});

describe("the denominators the page has to print", () => {
  it("counts the resolved sample beside every percentile", () => {
    const p = mttrPercentiles([closed(1), closed(3), closed(11), open(500)]);
    expect(p.overall.count).toBe(3); // NOT 4 — the open row is not in this statistic
    expect(p.overall.p50).toBe(3);
    expect(p.perSev.CRITICAL.count).toBe(3);
  });

  it("splits percentiles by severity", () => {
    const p = mttrPercentiles([closed(2, "CRITICAL"), closed(40, "LOW"), closed(60, "LOW")]);
    expect(p.perSev.CRITICAL.p50).toBe(2);
    expect(p.perSev.LOW.p50).toBe(50);
    expect(p.perSev.HIGH).toBeUndefined(); // absent, not zero
  });

  it("buckets time-to-close with <= edges", () => {
    const b = resolutionBuckets([closed(1), closed(7), closed(30), closed(90), closed(91)]);
    expect(b.perSev.CRITICAL).toEqual([1, 1, 1, 1, 1]);
    expect(b.total).toBe(5);
  });

  it("describes the OPEN half too", () => {
    // A page showing only what got fixed is describing the wrong half of the register.
    const a = openAgePercentiles([open(10), open(20), open(300), closed(1)]);
    expect(a.overall.count).toBe(3);
    expect(a.overall.p50).toBe(20);
  });
});

describe("the aged backlog", () => {
  it("breaches strictly past the target, which is the dual of in-SLA", () => {
    // CRITICAL is 7 days, shared byte-identically with gas/ and brick/devsecops.
    const sla = openPastSla([open(8, "CRITICAL"), open(7, "CRITICAL")]);
    expect(sla.perSev.CRITICAL.target).toBe(7);
    expect(sla.perSev.CRITICAL.breached).toBe(1); // 8 > 7 breaches; exactly 7 does not
    expect(sla.perSev.CRITICAL.open).toBe(2);
    expect(sla.overall.pct).toBe(50);
  });

  it("never scores a severity that has no target", () => {
    // An unset target is not a met one. Saying "0% breached" for UNKNOWN would claim a
    // compliance nobody defined.
    const sla = openPastSla([open(9999, "UNKNOWN")]);
    expect(sla.perSev.UNKNOWN.target).toBeNull();
    expect(sla.perSev.UNKNOWN.breached).toBe(0);
    expect(sla.overall.breached).toBe(0);
  });

  it("scores nothing when nothing is open", () => {
    const sla = openPastSla([closed(3)]);
    expect(sla.overall.open).toBe(0);
    expect(sla.overall.pct).toBeNull(); // null, not 0 — there is no sample to score
  });
});

describe("awaiting a vendor", () => {
  const row = (over) => ({ scope: "sca", status: "OPEN", awaiting_vendor_fix: false, ...over });

  it("takes its denominator from the scopes that HAVE a vendor", () => {
    // Counting SAST and secrets into the denominator would report a share of a population
    // the question does not apply to — and baseRows already guarantees their flag is false,
    // so they would only ever dilute it.
    const r = awaitingVendorFix([
      row({ awaiting_vendor_fix: true }),
      row({}),
      row({ scope: "sast" }),
      row({ scope: "secrets" }),
    ]);
    expect(r.openWithVendor).toBe(2); // not 4
    expect(r.count).toBe(1);
    expect(r.pct).toBe(50);
  });

  it("ignores resolved rows", () => {
    const r = awaitingVendorFix([row({ status: "RESOLVED", awaiting_vendor_fix: true })]);
    expect(r.openWithVendor).toBe(0);
    expect(r.pct).toBeNull();
  });
});
