// Program performance's own view models — `confusionView`, `boundedRateView` and
// `confusionSeverityRows` — held to the claims they make. This project has no jsdom
// (vitest.config.ts sets no `environment`), so this file only ever touches the DOM-free half;
// `test/quadPages.test.js` holds the cross itself and `test/quadAction.test.js` holds the
// corner drill-down, so this file is the arithmetic underneath both plus the by-severity
// table `renderMatrix` now draws from `confusionBySeverity`'s `perSev`.
//
// WHAT IS BEING PINNED:
//
//   * A rate over a zero denominator is not zero percent — `boundedRateView` says "not
//     measured", never a confident 0% and never `NaN%`.
//   * `hasBounds` is false only when nothing was unclassified (lo === point === hi); the
//     bounds text reads "X% to Y%", never a bare range with no word.
//   * `confusionView`'s four cells sum to `classified`, never to `total` — the unclassified
//     rows are a SIBLING of the array, never folded into a corner.
//   * The by-severity rows read each rate against `classified` for THAT severity: a null
//     `coverage.point` (nothing scored high risk for that severity) reads "not measured"; a
//     genuinely measured zero reads "0.0%", not "0%" — the one-decimal convention this whole
//     page already uses everywhere else via `pct` (`pct1`).

import { describe, expect, it } from "vitest";

import {
  boundedRateView, confusionSeverityRows, confusionView, programHeroView,
} from "../src/client/js/pages/program.js";

function matrixFixture(over) {
  return {
    tp: 12, fp: 30, fn: 48, tn: 210,
    unknownRemediated: 5, unknownOpen: 95,
    classified: 300, unknown: 100, total: 400,
    remediated: 47, open: 353, highRisk: 60, notHighRisk: 240,
    coverage: { point: 20, lo: 7.7, hi: 26.1 },
    efficiency: { point: 28.6, lo: 25.5, hi: 36.2 },
    prevalence: 20,
    signalCoveragePct: 75,
    ...over,
  };
}

// =========================================================================================
//  boundedRateView
// =========================================================================================

describe("boundedRateView: a rate over nothing", () => {
  it("is \"not measured\" — never NaN%, never a confident 0%", () => {
    for (const rate of [
      boundedRateView({ point: null, lo: null, hi: null }, 0, "0 findings"),
      boundedRateView({ point: 40, lo: 10, hi: 60 }, 0, "0 findings"),
      boundedRateView(null, 12, "12 findings"),
    ]) {
      expect(rate.measured).toBe(false);
      expect(rate.text).toBe("not measured");
      expect(rate.text).not.toMatch(/NaN/);
      expect(rate.text).not.toBe("0%");
    }
  });

  it("still shows a REAL zero, because that one is a measurement", () => {
    const rate = boundedRateView({ point: 0, lo: 0, hi: 0 }, 60, "60 classified");
    expect(rate.measured).toBe(true);
    expect(rate.text).toBe("0.0%");
  });

  it("carries the base it would have been taken over even when it cannot be taken", () => {
    const rate = boundedRateView(null, 0, "0 findings");
    expect(rate.denominator).toBe(0);
    expect(rate.denominatorLabel).toBe("0 findings");
    expect(rate.baseEmpty).toBe(true);
  });
});

describe("boundedRateView: the bounds text", () => {
  it("publishes \"X% to Y%\" when the point is a genuine re-labelling range", () => {
    const rate = boundedRateView({ point: 60, lo: 40, hi: 80 }, 200, "200 classified");
    expect(rate.hasBounds).toBe(true);
    expect(rate.boundsText).toBe("40.0% to 80.0%");
  });

  it("collapses to no bounds when nothing was unclassified (lo === point === hi)", () => {
    const rate = boundedRateView({ point: 60, lo: 60, hi: 60 }, 200, "200 classified");
    expect(rate.hasBounds).toBe(false);
    expect(rate.boundsText).toBeNull();
  });

  it("never publishes bounds text for an unmeasured rate", () => {
    const rate = boundedRateView({ point: null, lo: null, hi: null }, 0, "0 findings");
    expect(rate.hasBounds).toBe(false);
    expect(rate.boundsText).toBeNull();
  });
});

// =========================================================================================
//  confusionView
// =========================================================================================

describe("confusionView", () => {
  it("sums the four cells to classified, never to total", () => {
    const view = confusionView(matrixFixture());
    expect(view.cellTotal).toBe(300);
    expect(view.classified).toBe(300);
    expect(view.total).toBe(400);
    expect(view.cellTotal).not.toBe(view.total);
  });

  it("holds the unclassified pair OUTSIDE the cells array, marked as such", () => {
    const view = confusionView(matrixFixture());
    expect(view.unclassified.insideMatrix).toBe(false);
    expect(view.unclassified.remediated).toBe(5);
    expect(view.unclassified.open).toBe(95);
    expect(view.unclassified.total).toBe(100);
    expect(view.cells.some((c) => c.key === "unknownRemediated" || c.key === "unknownOpen"))
      .toBe(false);
  });

  it("takes the unclassified share against total, and says so", () => {
    const view = confusionView(matrixFixture());
    expect(view.unclassified.share.measured).toBe(true);
    expect(view.unclassified.share.denominator).toBe(400);
    expect(view.unclassified.share.text).toBe("25.0%");
  });

  it("says \"not measured\" for the unclassified share of an empty register", () => {
    const view = confusionView(matrixFixture({
      tp: 0, fp: 0, fn: 0, tn: 0, unknownRemediated: 0, unknownOpen: 0,
      classified: 0, unknown: 0, total: 0,
    }));
    expect(view.unclassified.share.measured).toBe(false);
    expect(view.unclassified.share.text).toBe("not measured");
  });
});

// =========================================================================================
//  confusionSeverityRows — confusionBySeverity's perSev, drawn for the first time
// =========================================================================================

function perSevFixture() {
  return {
    CRITICAL: {
      tp: 10, fp: 2, fn: 0, tn: 3, unknownRemediated: 0, unknownOpen: 0,
      classified: 15, unknown: 0, total: 15,
      coverage: { point: null, lo: null, hi: null },
      efficiency: { point: 83.333, lo: 83.333, hi: 83.333 },
    },
    HIGH: {
      tp: 0, fp: 5, fn: 0, tn: 20, unknownRemediated: 0, unknownOpen: 5,
      classified: 25, unknown: 5, total: 30,
      coverage: { point: 0, lo: 0, hi: 20 },
      efficiency: { point: 0, lo: 0, hi: 20 },
    },
  };
}

describe("confusionSeverityRows: null coverage vs. a measured zero", () => {
  const rows = confusionSeverityRows(perSevFixture());
  const bySev = Object.fromEntries(rows.map((r) => [r.sev, r]));

  it("reads \"not measured\" when the severity has no high-risk cell to score coverage over", () => {
    // CRITICAL's fn+tp base for coverage is (tp=10, fn=0) — a real base — but the fixture's
    // own coverage.point is null (nothing classified high risk AND still open to measure
    // against), which is exactly what confusionBySeverity ships when a severity's coverage
    // sub-denominator (tp+fn) never applies.
    expect(bySev.CRITICAL.coverage.measured).toBe(false);
    expect(bySev.CRITICAL.coverage.text).toBe("not measured");
  });

  it("reads \"0.0%\" for a genuinely measured zero — not \"0%\"", () => {
    expect(bySev.HIGH.coverage.measured).toBe(true);
    expect(bySev.HIGH.coverage.text).toBe("0.0%");
    expect(bySev.HIGH.efficiency.measured).toBe(true);
    expect(bySev.HIGH.efficiency.text).toBe("0.0%");
  });

  it("reads each rate against classified for THAT severity, not tp+fn/tp+fp", () => {
    expect(bySev.CRITICAL.classified).toBe(15);
    expect(bySev.CRITICAL.coverage.denominator).toBe(15);
    expect(bySev.CRITICAL.efficiency.denominator).toBe(15);
    expect(bySev.CRITICAL.efficiency.text).toBe("83.3%");
  });

  it("carries the unclassified count per severity", () => {
    expect(bySev.CRITICAL.unclassified).toBe(0);
    expect(bySev.HIGH.unclassified).toBe(5);
  });

  it("emits one row per severity the payload actually carries, in the payload's own order", () => {
    expect(rows.map((r) => r.sev)).toEqual(["CRITICAL", "HIGH"]);
  });

  it("emits nothing for an empty perSev, rather than a row of zeroes", () => {
    expect(confusionSeverityRows({})).toEqual([]);
    expect(confusionSeverityRows(null)).toEqual([]);
  });
});

// =========================================================================================
//  programHeroView — the pair `renderHero` now hands to `pageHeader({hero, aside, stats})`
// =========================================================================================
//
// Ported in the SAME shape as gas_devsecops's own `coverageEfficiencyView`: coverage and
// efficiency are the same `boundedRateView` calls `renderHero` always made, and `beatsRandom`
// is the one new decision — a THREE-STATE verdict, not a boolean, because "not prioritising"
// is a strong enough claim to need both halves of the comparison measured.

describe("programHeroView", () => {
  it("carries the same coverage/efficiency boundedRateView already computes", () => {
    const view = programHeroView({ matrix: matrixFixture() });
    expect(view.coverage.text).toBe("20.0%");
    expect(view.coverage.hasBounds).toBe(true);
    expect(view.efficiency.text).toBe("28.6%");
  });

  it("reads the prevalence floor, or says it was not measured", () => {
    expect(programHeroView({ matrix: matrixFixture() }).prevalenceText).toBe("20.0%");
    expect(programHeroView({ matrix: matrixFixture({ prevalence: null }) }).prevalenceText)
      .toBe("not measured");
  });

  it("verdicts efficiency against prevalence only on 'at or below', never on 'better'", () => {
    // Efficiency (28.6%) beats prevalence (20%): no verdict chip should fire, which is
    // `beatsRandom: true` — the chip is drawn only when the flag is FALSE.
    expect(programHeroView({ matrix: matrixFixture() }).beatsRandom).toBe(true);

    // Efficiency AT prevalence is "at or below" — the inequality is strict (`>`), so equal
    // reads as false, not as a tie with no verdict.
    expect(programHeroView({
      matrix: matrixFixture({ efficiency: { point: 20, lo: 20, hi: 20 }, prevalence: 20 }),
    }).beatsRandom).toBe(false);

    // Efficiency BELOW prevalence.
    expect(programHeroView({
      matrix: matrixFixture({ efficiency: { point: 10, lo: 10, hi: 10 }, prevalence: 20 }),
    }).beatsRandom).toBe(false);
  });

  it("gives no verdict at all when either half is unmeasured", () => {
    expect(programHeroView({
      matrix: matrixFixture({ efficiency: { point: null, lo: null, hi: null } }),
    }).beatsRandom).toBeNull();
    expect(programHeroView({
      matrix: matrixFixture({ prevalence: null }),
    }).beatsRandom).toBeNull();
  });

  it("reads a missing matrix as nothing measured, rather than throwing", () => {
    const view = programHeroView({});
    expect(view.coverage.measured).toBe(false);
    expect(view.efficiency.measured).toBe(false);
    expect(view.beatsRandom).toBeNull();
  });
});
