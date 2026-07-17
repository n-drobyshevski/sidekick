import { describe, expect, it } from "vitest";
import {
  RESOLUTION_BUCKET_LABELS,
  actionableView,
  awaitingVendorFix,
  fastLaneSplit,
  kmMedian,
  mttrPercentiles,
  openPastSla,
  openPastSlaFromRecords,
  resolutionBuckets,
} from "../src/domain/remediation";
import { quantile } from "../src/domain/util";

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

describe("fastLaneSplit", () => {
  it("boundary at exactly 3.0d is fast lane; tail median over the remainder", () => {
    const out = fastLaneSplit([res(1), res(3), res(5), res(9)], 3);
    expect(out.total).toBe(4);
    expect(out.fastLane).toBe(2); // 1 and 3.0 (<= 3)
    expect(out.fastLanePct).toBe(50);
    expect(out.tailCount).toBe(2);
    expect(out.tailMedian).toBe(7); // median [5, 9]
  });

  it("all fast lane -> tailCount 0 / tailMedian null; all tail -> pct 0", () => {
    const allFast = fastLaneSplit([res(0.5), res(1), res(3)], 3);
    expect(allFast.fastLane).toBe(3);
    expect(allFast.tailCount).toBe(0);
    expect(allFast.tailMedian).toBeNull();

    const allTail = fastLaneSplit([res(10), res(20)]);
    expect(allTail.fastLane).toBe(0);
    expect(allTail.fastLanePct).toBe(0);
    expect(allTail.tailMedian).toBe(15);
  });

  it("empty -> total 0 / pct null; honors a custom threshold", () => {
    expect(fastLaneSplit([])).toEqual({
      total: 0,
      fastLane: 0,
      fastLanePct: null,
      tailCount: 0,
      tailMedian: null,
    });
    expect(fastLaneSplit([res(4), res(6)], 5).fastLane).toBe(1); // 4 <= 5, 6 > 5
    // default threshold is now 1 day (DEFAULT_FAST_LANE_DAYS)
    const dflt = fastLaneSplit([res(0.5), res(1), res(2)]);
    expect(dflt.fastLane).toBe(2); // 0.5 and 1 (<= 1)
    expect(dflt.tailCount).toBe(1);
    expect(dflt.tailMedian).toBe(2); // median [2]
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
