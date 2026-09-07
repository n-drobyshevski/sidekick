// THE SENTENCE THAT SAYS WHICH HALF OF THE MOVEMENT WAS WORK.
//
// `movementView` reads `program.movementDecomposition`. Two of its three jobs are refusals,
// and both are the quiet kind:
//
//   - A GAP SENTENCE PRINTED WHEN THERE IS NO GAP. "The books do not balance by 0" trains a
//     reader to skip the one line that matters on the day it is non-zero.
//   - A CONFIDENT ZERO OVER A PAYLOAD NOBODY DECOMPOSED. An older cached entry carries no
//     movement block at all; coercing that into the sentence prints five measurements of a
//     window that was never measured. The server's own note travels verbatim instead —
//     it is the only thing that knows WHY it declined.
//
// Plain .js and pure, for the reason mttrPaintPlan.test.js and populationLine.test.js write out.

import { describe, expect, it } from "vitest";

import { findEntry } from "../src/client/js/helpContent.js";
import {
  kmSparkCaption, kpiSparkSeries, kpiView, movementView, resolvedSharePct,
} from "../src/client/js/pages/historyModel.js";

/** The balanced wide-then-narrow window from test/program.test.ts, as the payload ships it. */
const BALANCED = {
  arrivals: 1, observed: 1, bounded: 1, reopened: 0,
  outsideGate: 1, netChange: -1, measured: 1, administrative: 1,
  unattributed: 0, identityGap: 0, identityHolds: true,
  scansInWindow: 2, skippedScans: 0, partialCounts: 0, unplacedRows: 0,
};

describe("the sentence for a balanced window", () => {
  it("names both halves and the direction the count moved", () => {
    const v = movementView(BALANCED, null);
    expect(v.sentences[0]).toBe(
      "Arrivals 1, closed by observation 1, dated gone by absence 1, returned 0; "
      + "the open count moved −1. Of that movement, 1 is measured remediation and "
      + "1 is administrative.",
    );
  });

  it("keeps the two halves in separate tables, never one total", () => {
    const v = movementView(BALANCED, null);
    expect(v.measuredRows).toHaveLength(1);
    expect(v.measuredRows[0].count).toBe(1);
    expect(v.measuredRows[0].cause).toBe("Closed by observation");
    expect(v.administrativeRows).toHaveLength(1);
    expect(v.administrativeRows[0].count).toBe(1);
    // The administrative row says how the date was arrived at, because "gone by 12 Aug" and
    // "resolved 12 Aug" are the same pixel width (CLAUDE.md).
    expect(v.administrativeRows[0].basis).toMatch(/upper bound/);
  });

  it("puts the gate exclusion in the aside, not in either table", () => {
    const v = movementView(BALANCED, null);
    expect(v.sentence).toContain(
      "1 open finding sits outside the current gate and was not measured by the last scan.",
    );
    expect(v.asideRows[0]).toEqual({
      label: "Open, outside the last scan's severity gate", count: 1,
    });
    for (const row of [...v.measuredRows, ...v.administrativeRows]) {
      expect(row.count).toBe(1); // ...and never 2 — the stock is not folded into a flow
    }
  });

  it("says nothing about the gate when nothing sits outside it", () => {
    const v = movementView({ ...BALANCED, outsideGate: 0 }, null);
    expect(v.sentence).not.toMatch(/outside the current gate/);
    expect(v.asideRows).toEqual([]);
  });

  it("pluralizes the gate line rather than reading '1 findings sit'", () => {
    const v = movementView({ ...BALANCED, outsideGate: 4 }, null);
    expect(v.sentence).toContain(
      "4 open findings sit outside the current gate and were not measured by the last scan.",
    );
  });
});

describe("the gap sentence appears only when the gap is non-zero", () => {
  it("is absent on a window whose books balance", () => {
    const v = movementView(BALANCED, null);
    expect(v.sentence).not.toMatch(/do not balance/);
    expect(v.sentences).toHaveLength(2); // the movement sentence and the gate aside
  });

  it("is published, signed, on a window whose books do not", () => {
    // The perturbation from test/program.test.ts: the newest scan forgot one arrival.
    const v = movementView(
      { ...BALANCED, arrivals: 0, identityGap: 1, identityHolds: false }, null,
    );
    expect(v.sentence).toContain(
      "The books do not balance by +1 — that gap is published, not hidden.",
    );
    // Signed both ways: the direction of the disagreement is the readable part.
    const other = movementView({ ...BALANCED, identityGap: -3 }, null);
    expect(other.sentence).toContain("do not balance by −3");
  });
});

describe("the empty branch", () => {
  const NOTE = "One scan only — a movement is a difference between two of them.";

  it("carries the server's note verbatim", () => {
    for (const payload of [null, undefined, "", 0, {}]) {
      const v = movementView(payload, NOTE);
      expect(v.empty, JSON.stringify(payload)).toBe(NOTE);
      expect(v.sentence).toBeUndefined();
    }
  });

  it("refuses a payload missing a figure rather than printing a zero for it", () => {
    // `Number(null)` is 0 and it is finite; every one of these would otherwise render as a
    // measured "0" inside a sentence about a window nobody decomposed.
    for (const bad of [null, "", [], false, undefined]) {
      const v = movementView({ ...BALANCED, netChange: bad }, NOTE);
      expect(v.empty, `netChange ${JSON.stringify(bad)}`).toBe(NOTE);
    }
    expect(movementView({ ...BALANCED, arrivals: undefined }, NOTE).empty).toBe(NOTE);
  });

  it("still says something when the server sent no note either", () => {
    const v = movementView(null, null);
    expect(v.empty).toBe("No movement decomposition in this payload.");
  });
});

// =========================================================================================
//  kpiView — one statistic under the half-life label, not two
// =========================================================================================

describe("kpiView never reads kpis.medianMttr", () => {
  // The dev-seed shape the real defect shipped with (this module's own doc comment): a plain
  // closed-only median of 93 days sitting under a card whose only line was the Kaplan–Meier
  // series, which on the SAME population had no median yet — only a lower bound of 297 days.
  const KPIS = {
    tracked: 554, open: 416, resolvedAllTime: 138,
    medianMttr: 93, kmMedian: null, kmMedianLowerBound: 297,
  };

  it("the fourth card publishes the KM figure, not the naive median beside it", () => {
    expect(kpiView(KPIS).halfLife.value).toBe("at least 297 days");
  });

  it("removing medianMttr from the payload changes nothing — it was never read", () => {
    const withoutNaive = kpiView({ ...KPIS, medianMttr: undefined });
    expect(withoutNaive.halfLife).toEqual(kpiView(KPIS).halfLife);
  });

  it("the label this card carries names the SAME statistic the half-life entry defines", () => {
    // `history.js` hardcodes `glossaryTip("Remediation half-life", "half-life")` — pinning
    // the entry's own term here, and pinning the literal string in test/historyDom.test.js,
    // is what keeps the two from drifting apart silently.
    expect(findEntry("half-life").term).toBe("Remediation half-life");
  });

  it("PERTURBATION PROOF: a rewrite reading kpis.medianMttr under this label prints the WRONG statistic", () => {
    // The tempting one-line "simplification" this fix removes: reading the naive median
    // straight off the payload for the card the KM line is fitted for.
    function defectiveHalfLifeValue(kpis) {
      return kpis.medianMttr + " days";
    }
    const defective = defectiveHalfLifeValue(KPIS);
    const shipped = kpiView(KPIS).halfLife.value;
    // Captured failing output: the naive figure and the KM figure disagree outright on this
    // population — "93 days" is a real number, over the wrong 138-row closed-only slice, and
    // it is not even in the same units of confidence as "at least 297 days" (a censored
    // lower bound over all 554 rows).
    expect(defective).toBe("93 days");
    expect(shipped).toBe("at least 297 days");
    expect(shipped).not.toBe(defective);
  });
});

// =========================================================================================
//  kpiSparkSeries — the four series, gaps kept as gaps
// =========================================================================================

describe("kpiSparkSeries — tracked is open+resolved, and a gap stays a gap", () => {
  const TREND = [
    { date: "2026-01-01", open: 10, resolved: 2, km_median_days: 5 },
    { date: "2026-01-02", open: null, resolved: 3, km_median_days: null }, // open missing
    { date: "2026-01-03", open: 8, resolved: null, km_median_days: null }, // resolved missing
    { date: "2026-01-04", open: 7, resolved: 5, km_median_days: 6 },
  ];

  it("tracked sums open+resolved only where BOTH halves are measured", () => {
    const s = kpiSparkSeries(TREND);
    expect(s.tracked).toEqual([12, null, null, 12]);
    expect(s.open).toEqual([10, null, 8, 7]);
    expect(s.resolved).toEqual([2, 3, null, 5]);
    expect(s.halfLife).toEqual([5, null, null, 6]);
  });

  it("an empty or non-array trend answers with four empty series, not a throw", () => {
    for (const bad of [null, undefined, [], "nope"]) {
      const s = kpiSparkSeries(bad);
      expect(s.tracked, JSON.stringify(bad)).toEqual([]);
      expect(s.halfLife, JSON.stringify(bad)).toEqual([]);
    }
  });

  it("PERTURBATION PROOF: (open||0)+(resolved||0) prints a 0 where the real one keeps null", () => {
    function defectiveTracked(points) {
      return points.map((p) => (p.open || 0) + (p.resolved || 0));
    }
    const defective = defectiveTracked(TREND);
    // The defective shape: a missing half reads as a fully MEASURED total (a 0 for the
    // missing side), so index 1 (open missing) reads 3 instead of a gap and index 2
    // (resolved missing) reads 8 instead of a gap.
    expect(defective).toEqual([12, 3, 8, 12]);
    const real = kpiSparkSeries(TREND).tracked;
    expect(real).toEqual([12, null, null, 12]);
    expect(real).not.toEqual(defective);
  });
});

// =========================================================================================
//  kmSparkCaption — anchored to the last DATED reading
// =========================================================================================

describe("kmSparkCaption anchors the caption to the last MEASURED reading's own date", () => {
  it("names the date of the last measured reading, walking back past a trailing mask", () => {
    const trend = [
      { date: "2026-08-01", km_median_days: 41 },
      { date: "2026-08-08", km_median_days: 39 },
      // The mask: the curve never reached half as of this later scan, so it is a gap — and
      // NOT the anchor, even though it is the trend's own last row.
      { date: "2026-08-15", km_median_days: null },
    ];
    expect(kmSparkCaption(trend)).toBe(
      "2 of 3 readings measured, 41 days to 39 days — as of 2026-08-08",
    );
  });

  it("anchors a single reading too, even though sparkCaption alone never sees a date", () => {
    const trend = [
      { date: "2026-08-01", km_median_days: null },
      { date: "2026-08-08", km_median_days: 41 },
    ];
    expect(kmSparkCaption(trend)).toBe("One reading, 41 days — as of 2026-08-08");
  });

  it("says 'Not measured' with no anchor at all when nothing was measured", () => {
    const trend = [
      { date: "2026-08-01", km_median_days: null },
      { date: "2026-08-08", km_median_days: null },
    ];
    expect(kmSparkCaption(trend)).toBe("Not measured");
  });

  it("refuses a non-array input rather than throwing", () => {
    expect(kmSparkCaption(null)).toBe("Not measured");
    expect(kmSparkCaption(undefined)).toBe("Not measured");
  });
});

// =========================================================================================
//  resolvedSharePct — the Resolved card's denominator
// =========================================================================================

describe("resolvedSharePct refuses a zero base", () => {
  it("is null when nothing has been tracked, never a fake 0%", () => {
    expect(resolvedSharePct({ tracked: 0, resolvedAllTime: 0 })).toBeNull();
  });

  it("computes the share over a real base", () => {
    expect(resolvedSharePct({ tracked: 554, resolvedAllTime: 138 }))
      .toBeCloseTo((138 / 554) * 100, 8);
  });

  it("PERTURBATION PROOF: a naive division prints NaN instead of refusing", () => {
    function naiveSharePct(k) {
      return (k.resolvedAllTime / k.tracked) * 100;
    }
    expect(naiveSharePct({ tracked: 0, resolvedAllTime: 0 })).toBeNaN();
    expect(resolvedSharePct({ tracked: 0, resolvedAllTime: 0 })).toBeNull();
    expect(naiveSharePct({ tracked: undefined, resolvedAllTime: 5 })).toBeNaN();
    expect(resolvedSharePct({ tracked: undefined, resolvedAllTime: 5 })).toBeNull();
  });
});
