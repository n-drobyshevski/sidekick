// The three Program-lane pages, held to the claims they make.
//
// Each page is a PURE VIEW MODEL plus a thin DOM layer, and this file only ever touches the
// first half — there is no jsdom in this project (vitest.config.ts sets no `environment`), so
// the half that can be WRONG is deliberately the half that is DOM-free. The same bargain
// `ui/tableModel.js` and `test/charts.test.js` already strike.
//
// WHAT IS BEING PINNED, and why each one is worth a test rather than a convention:
//
//   * A Kaplan-Meier result with no median must publish `medianLowerBound` as "at least N",
//     flagged. Rendering it as a bare number would state a median nobody observed; collapsing
//     it to a dash would throw away a true statement. Both failures look fine on screen.
//   * A rate over a zero denominator is not zero percent. `NaN%` announces itself; a
//     confident `0%` does not, and that is the one that ships.
//   * Every rate travels with the base it was taken over. A percentage whose denominator is
//     invisible is the failure this whole register is built to avoid.
//   * `ai_verdict` reads 0% coverage in this tenant. That 0% is a MEASUREMENT — it is the
//     only thing separating "the AI agreed with nothing" from "nobody asked the AI" — so a
//     view that quietly drops an all-zero row deletes the finding.
//   * The actionable clock is SCA-only. sast and secrets have no vendor to wait on, so their
//     actionable clock is their MTTR by construction and a register-wide figure would be two
//     thirds a restatement of it.
//   * The unclassified rows sit OUTSIDE the confusion matrix's four cells. Folded into a
//     corner they become indistinguishable from a measurement.
//   * A capacity month that was partial or reconstructed must say so, or a month nobody was
//     watching reads as one that was measured.
//   * None of the three still calls `renderStub` — that call is what emits `p.stub-status`,
//     and leaving it behind would ship a wired page still announcing it has no data.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  executiveHeroView, executiveMovementView, executiveRegisterView, executiveSeverityView,
} from "../src/client/js/pages/executive.js";
import {
  actionableClockView, awaitingView, fmtCount, fmtDays, kmHalfLifeView, mttrHeroView,
  mttrSeverityRows, rateView, resolutionBucketView, rmstView, slaSeverityRows,
} from "../src/client/js/pages/mttr.js";
import {
  boundedRateView, capacityView, confusionView, coverageEfficiencyView, sensitivityView,
  signalBreakdownView,
} from "../src/client/js/pages/program.js";

const SRC = {
  executive: readFileSync(new URL("../src/client/js/pages/executive.js", import.meta.url), "utf8"),
  mttr: readFileSync(new URL("../src/client/js/pages/mttr.js", import.meta.url), "utf8"),
  program: readFileSync(new URL("../src/client/js/pages/program.js", import.meta.url), "utf8"),
};

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

// --------------------------------------------------------------------------- fixtures

/** A KM result whose curve DOES fall to half. */
function kmWithMedian() {
  return {
    curve: [{ t: 3, s: 0.8 }, { t: 12, s: 0.5 }, { t: 40, s: 0.2 }],
    median: 12,
    medianLowerBound: null,
    p90: 40,
    mean: 18.5,
    meanTruncated: false,
    restrictionTime: 40,
    events: 30,
    censored: 12,
    total: 42,
  };
}

/** A KM result under heavy censoring: no median, a lower bound instead. This is the normal
 *  state of a young register carrying more open findings than closed ones. */
function kmCensored() {
  return {
    curve: [{ t: 3, s: 0.94 }, { t: 20, s: 0.71 }],
    median: null,
    medianLowerBound: 41.4,
    p90: null,
    mean: 33.2,
    meanTruncated: true,
    restrictionTime: 41.4,
    events: 6,
    censored: 180,
    total: 186,
  };
}

function mttrPayload(km) {
  return {
    rowCount: 186,
    overall: { resolved: 6, open: 180, mttr_median: 9 },
    slaPct: 50,
    oldestDays: 120,
    perSev: {
      CRITICAL: {
        resolved: 4, open: 20, sla_target: 7, sla_compliant: 2, sla_pct: 50,
        open_age_p50: 30, open_age_p90: 90, mttr_mean: 8, mttr_median: 6,
      },
      HIGH: {
        resolved: 0, open: 60, sla_target: 30, sla_compliant: 0, sla_pct: null,
        open_age_p50: 12, open_age_p90: 44, mttr_mean: null, mttr_median: null,
      },
    },
    remediation: {
      pctiles: { perSev: {}, overall: { p50: 9, p90: 40, count: 6 } },
      buckets: {
        labels: ["≤1d", "2–7d", "8–30d", "31–90d", "90+d"],
        perSev: { CRITICAL: [1, 1, 2, 0, 0], HIGH: [0, 0, 1, 1, 0] },
        total: 6,
      },
      km,
      kmMedianPerSev: { CRITICAL: 6, HIGH: null },
      kmP90PerSev: { CRITICAL: 22, HIGH: null },
      kmLowerBoundPerSev: { CRITICAL: null, HIGH: 44 },
      openPastSla: {
        perSev: {
          CRITICAL: { open: 20, breached: 11, pct: 55, target: 7 },
          HIGH: { open: 60, breached: 0, pct: 0, target: 30 },
        },
        overall: { open: 80, breached: 11, pct: 13.75 },
      },
      awaiting: { perSev: { HIGH: 4 }, overall: 4, openTotal: 180, pctOfOpen: 2.2, notApplicable: 3 },
      actionable: {
        scope: "sca",
        rowCount: 61,
        notMeasured: 125,
        openPastSla: { perSev: {}, overall: { open: 40, breached: 3, pct: 7.5 } },
        km: kmCensored(),
        vendorLatency: {
          median: 5,
          medianLowerBound: null,
          mean: 8,
          meanTruncated: false,
          restrictionTime: 60,
          events: 20,
          censored: 41,
          total: 61,
          segments: {
            events: 20, censored: 35, closedBeforeFix: 4, zeroAtOrigin: 9, unmeasured: 2,
            total: 61,
          },
        },
      },
    },
    signalCoverage: {},
  };
}

/** `api_getExecutivePage`'s shape — the hero arrives through `execMttrSlice`, which ships
 *  the two scalars and nothing else. */
function execPayload(km) {
  return {
    asOf: 1_770_000_000_000,
    scope: null,
    mttr: {
      rowCount: 186,
      overall: { resolved: 6, open: 180 },
      remediation: { km: { median: km.median, medianLowerBound: km.medianLowerBound } },
    },
    byScope: {
      dimension: "scope",
      rows: [
        { group: "sca", kmMedian: 12, open: 90 },
        { group: "sast", kmMedian: null, open: 60 },
        { group: "secrets", kmMedian: 3, open: 30 },
      ],
    },
    severityCounts: { counts: { CRITICAL: 20, HIGH: 60, LOW: 100 }, open: 180, total: 186 },
    weekTrend: { current: 12, previous: 9, deltaDays: 3, days: 7 },
  };
}

function matrixFixture() {
  return {
    tp: 12, fp: 30, fn: 48, tn: 210,
    unknownRemediated: 5, unknownOpen: 95,
    classified: 300, unknown: 100, total: 400,
    remediated: 47, open: 353, highRisk: 60, notHighRisk: 240,
    coverage: { point: 20, lo: 7.7, hi: 26.1 },
    efficiency: { point: 28.6, lo: 25.5, hi: 36.2 },
    prevalence: 20,
    signalCoveragePct: 75,
  };
}

/** `signalCoverage` as this tenant actually reads it: `ai_verdict` applies to every SAST row
 *  and was captured on none of them — a measured 0%, not an absence. */
function signalCoverageFixture() {
  return {
    has_kev: { applicable: 240, measured: 240, missing: 0, coveragePct: 100, notApplicable: 160, total: 400 },
    has_exploit: { applicable: 240, measured: 238, missing: 2, coveragePct: 99.2, notApplicable: 160, total: 400 },
    epss: { applicable: 240, measured: 200, missing: 40, coveragePct: 83.3, notApplicable: 160, total: 400 },
    ai_verdict: { applicable: 160, measured: 0, missing: 160, coveragePct: 0, notApplicable: 240, total: 400 },
    validation_state: { applicable: 0, measured: 0, missing: 0, coveragePct: null, notApplicable: 400, total: 400 },
  };
}

function capacityFixture() {
  return {
    months: [
      {
        month: "2025-11", openAtStart: 0, opened: 40, closed: 0, mmcr: null, net: -40,
        netPct: null, verdict: "keeping-up", partial: false, reconstructed: true, scanClosed: null,
      },
      {
        month: "2025-12", openAtStart: 40, opened: 10, closed: 12, mmcr: 30, net: 2,
        netPct: 5, verdict: "gaining", partial: false, reconstructed: false, scanClosed: 12,
      },
      {
        month: "2026-01", openAtStart: 38, opened: 20, closed: 4, mmcr: 10.5, net: -16,
        netPct: -42.1, verdict: "falling-behind", partial: true, reconstructed: false, scanClosed: 4,
      },
    ],
    mmcrMean: 30,
    oneInN: 3.33,
    netTotal: -54,
    verdict: "gaining",
    monthsCounted: 1,
  };
}

/** Every rate view on all three pages must answer to this shape. */
function expectRateShape(rate, where) {
  expect(rate, where + ": no rate view at all").toBeTruthy();
  expect(Object.prototype.hasOwnProperty.call(rate, "denominator"), where + ": no denominator field")
    .toBe(true);
  expect(Object.prototype.hasOwnProperty.call(rate, "denominatorLabel"), where + ": no denominator label")
    .toBe(true);
  expect(typeof rate.denominatorLabel, where + ": denominator label is not a string").toBe("string");
  expect(rate.denominatorLabel.length, where + ": empty denominator label").toBeGreaterThan(0);
  expect(rate.text, where + ": rate text is not a string").toBeTypeOf("string");
  expect(rate.text, where + ": NaN reached the screen").not.toMatch(/NaN/);
}

// ------------------------------------------------------------- the lower-bound half-life

describe("a curve that never reaches half", () => {
  it("publishes the lower bound as \"at least N\" and flags it", () => {
    const view = kmHalfLifeView(kmCensored());
    expect(view.isLowerBound).toBe(true);
    expect(view.value).toMatch(/^at least /);
    expect(view.value).toContain("41");
    expect(view.measured).toBe(true);
    expect(view.days).toBe(41.4);
  });

  it("does not prefix a median that WAS observed", () => {
    const view = kmHalfLifeView(kmWithMedian());
    expect(view.isLowerBound).toBe(false);
    expect(view.value).toBe("12 days");
  });

  it("says \"Not measured\" rather than zero when there is neither", () => {
    for (const km of [null, undefined, {}, { median: null, medianLowerBound: null }]) {
      const view = kmHalfLifeView(km);
      expect(view.measured).toBe(false);
      expect(view.isLowerBound).toBe(false);
      expect(view.value).toBe("Not measured");
      expect(view.value).not.toMatch(/^0/);
    }
  });

  it("reaches the MTTR hero, with the censored count beside it", () => {
    const view = mttrHeroView(mttrPayload(kmCensored()));
    expect(view.isLowerBound).toBe(true);
    expect(view.value).toMatch(/^at least /);
    expect(view.censored).toBe(180);
    expect(view.events).toBe(6);
    expect(view.qualifier).toContain("180");
    expect(view.qualifier).toMatch(/censored/);
  });

  it("reaches the Executive hero through execMttrSlice's two scalars", () => {
    const view = executiveHeroView(execPayload(kmCensored()));
    expect(view.isLowerBound).toBe(true);
    expect(view.value).toMatch(/^at least /);
    // The estimator's own censored count is NOT in that slice, and the view says so rather
    // than passing resolved/open off as it.
    expect(view.censoredKnown).toBe(false);
    expect(view.qualifier).toContain("still open");
  });

  it("still measures when the median is genuinely observed", () => {
    const view = executiveHeroView(execPayload(kmWithMedian()));
    expect(view.isLowerBound).toBe(false);
    expect(view.value).toBe("12 days");
  });
});

describe("the restricted mean", () => {
  it("earns a ≥ when survival never reached zero", () => {
    const view = rmstView(kmCensored());
    expect(view.truncated).toBe(true);
    expect(view.text.startsWith("≥")).toBe(true);
  });

  it("is a bare figure when it is not truncated", () => {
    const view = rmstView(kmWithMedian());
    expect(view.truncated).toBe(false);
    expect(view.text).not.toContain("≥");
  });

  it("is \"Not measured\", not zero, with no events", () => {
    expect(rmstView({ mean: null, meanTruncated: false }).text).toBe("Not measured");
  });
});

// ------------------------------------------------------------------------ rates and bases

describe("a rate over nothing", () => {
  it("is \"not measured\" — never NaN%, never a confident 0%", () => {
    for (const rate of [
      rateView(null, 0, "0 resolved"),
      rateView(50, 0, "0 resolved"),
      rateView(undefined, 12, "12 resolved"),
      boundedRateView({ point: null, lo: null, hi: null }, 0, "0 findings"),
      boundedRateView({ point: 40, lo: 10, hi: 60 }, 0, "0 findings"),
    ]) {
      expect(rate.measured).toBe(false);
      expect(rate.text).toBe("not measured");
      expect(rate.text).not.toMatch(/NaN/);
      expect(rate.text).not.toBe("0%");
    }
  });

  it("still shows a REAL zero, because that one is a measurement", () => {
    expect(rateView(0, 60, "60 open").text).toBe("0%");
    expect(rateView(0, 60, "60 open").measured).toBe(true);
    expect(boundedRateView({ point: 0, lo: 0, hi: 0 }, 60, "60 open").text).toBe("0%");
  });

  it("carries the base it would have been taken over even when it cannot be taken", () => {
    const rate = rateView(null, 0, "0 resolved");
    expectRateShape(rate, "empty rate");
    expect(rate.denominator).toBe(0);
  });
});

describe("every rate view emits its denominator", () => {
  it("on the MTTR page", () => {
    const mttr = mttrPayload(kmCensored());
    const sla = slaSeverityRows(mttr, SEVERITIES);
    expect(sla.length).toBeGreaterThan(0);
    for (const row of sla) {
      expectRateShape(row.inSla, "sla:" + row.sev + ":inSla");
      expectRateShape(row.pastSla, "sla:" + row.sev + ":pastSla");
    }
    // The two denominators in one row are DIFFERENT populations, and mixing them is the
    // mistake the shape exists to stop.
    const critical = sla.filter((r) => r.sev === "CRITICAL")[0];
    expect(critical.inSla.denominator).toBe(4);
    expect(critical.pastSla.denominator).toBe(20);

    const buckets = resolutionBucketView(mttr.remediation.buckets);
    for (const row of buckets.rows) expectRateShape(row.share, "bucket:" + row.label);
    expect(buckets.rows[0].share.denominator).toBe(6);

    expectRateShape(awaitingView(mttr).share, "awaiting");
    expectRateShape(actionableClockView(mttr).coverage, "actionable coverage");
  });

  it("on the Executive page", () => {
    const view = executiveRegisterView(execPayload(kmWithMedian()).byScope);
    for (const row of view.rows) expectRateShape(row.share, "register:" + row.scope);
    // The base is the open backlog across the registers in the payload, not everything
    // ever tracked and not the register the reader is scoped to.
    expect(view.totalOpen).toBe(180);
    expect(view.rows[0].share.denominator).toBe(180);
    expect(view.rows[0].share.text).toBe("50%");
  });

  it("on the Coverage & efficiency page", () => {
    const view = coverageEfficiencyView(matrixFixture());
    expectRateShape(view.coverage, "coverage");
    expectRateShape(view.efficiency, "efficiency");
    expectRateShape(view.classifiedShare, "classified share");
    // Coverage is over classified high risk (tp + fn); efficiency over classified
    // remediations (tp + fp). They are not the same base and never share a label.
    expect(view.coverage.denominator).toBe(60);
    expect(view.efficiency.denominator).toBe(42);

    const cap = capacityView(capacityFixture());
    expectRateShape(cap.mmcrMean, "mmcr mean");
    for (const m of cap.months) expectRateShape(m.mmcr, "capacity:" + m.month);

    for (const row of signalBreakdownView({}, signalCoverageFixture(), 400).rows) {
      expect(Object.prototype.hasOwnProperty.call(row, "denominator"), row.name).toBe(true);
      expect(typeof row.denominatorLabel).toBe("string");
    }
    expectRateShape(confusionView(matrixFixture()).unclassified.share, "unclassified share");
  });

  it("and each page renders one as a [data-denominator] node", () => {
    for (const [name, src] of Object.entries(SRC)) {
      expect(src, name + " renders no [data-denominator] node").toContain("data-denominator");
    }
  });

  it("publishes the coverage and efficiency bounds, never the point alone", () => {
    const view = coverageEfficiencyView(matrixFixture());
    expect(view.coverage.hasBounds).toBe(true);
    expect(view.coverage.boundsText).toBe("7.7% to 26.1%");
    expect(view.efficiency.hasBounds).toBe(true);
    expect(view.efficiency.boundsText).toBe("25.5% to 36.2%");
  });

  it("drops the bracket only when nothing is unclassified", () => {
    const clean = { ...matrixFixture(), unknownRemediated: 0, unknownOpen: 0 };
    clean.coverage = { point: 20, lo: 20, hi: 20 };
    const view = coverageEfficiencyView(clean);
    expect(view.coverage.hasBounds).toBe(false);
    expect(view.coverage.boundsText).toBe(null);
  });
});

// ------------------------------------------------------------------------ signal coverage

describe("ai_verdict at zero percent", () => {
  const view = signalBreakdownView(
    { fired: { kev: 12, aiVerdict: 0 }, missing: { epss: 40, aiVerdict: 160 }, anyOf: 60, cweUnmapped: 7 },
    signalCoverageFixture(),
    400,
  );
  const row = (name) => view.rows.filter((r) => r.name === name)[0];

  it("is a row, not an omission", () => {
    expect(view.rows.map((r) => r.name)).toContain("aiVerdict");
    expect(row("aiVerdict")).toBeTruthy();
  });

  it("renders the zero as a measurement, with the rows it applied to beside it", () => {
    const ai = row("aiVerdict");
    expect(ai.coverageState).toBe("measured");
    expect(ai.coveragePct).toBe(0);
    expect(ai.coverageText).toBe("0%");
    expect(ai.missing).toBe(160);
    expect(ai.denominator).toBe(160);
    expect(ai.denominatorLabel).toContain("160");
  });

  it("keeps \"not applicable\" a different answer from zero", () => {
    // validation_state applies to no row in an sca/sast scope: `coveragePct` is null, which
    // is "we did not look here", not "we looked and found none".
    const na = signalBreakdownView({}, {
      ...signalCoverageFixture(),
      ai_verdict: { applicable: 0, measured: 0, missing: 0, coveragePct: null, notApplicable: 400, total: 400 },
    }, 400).rows.filter((r) => r.name === "aiVerdict")[0];
    expect(na.coverageState).toBe("not-applicable");
    expect(na.coverageText).toBe("not applicable");
    expect(na.coverageText).not.toBe("0%");
  });

  it("marks the clauses that rest on a column which is never missing", () => {
    expect(row("cwe").coverageState).toBe("always-present");
    expect(row("critical").coverageState).toBe("always-present");
  });

  it("keeps the fired counts apart from the high-risk total, because they overlap", () => {
    expect(view.anyOf).toBe(60);
    expect(view.rows.reduce((a, r) => a + r.fired, 0)).not.toBe(view.anyOf);
    expect(view.cweUnmapped).toBe(7);
  });
});

// -------------------------------------------------------------------- the actionable clock

describe("the actionable clock", () => {
  const mttr = mttrPayload(kmCensored());

  it("is labelled SCA-only wherever it is read", () => {
    const view = actionableClockView(mttr);
    expect(view.appliesTo).toBe("sca");
    expect(view.coversRegister).toBe(false);
    expect(view.scopeLabel).toMatch(/sca only/i);
    expect(view.heading).toMatch(/sca only/i);
  });

  it("names the two registers it declines to price, and why", () => {
    const view = actionableClockView(mttr);
    expect(view.note).toMatch(/SAST/);
    expect(view.note).toMatch(/secrets/);
    expect(view.note).toMatch(/construction/);
    expect(view.notMeasured).toBe(125);
    expect(view.rowCount).toBe(61);
    // The coverage figure's base is the SCA-plus-refused population, not the register.
    expect(view.coverage.denominator).toBe(186);
  });

  it("REFUSES a register-wide framing rather than obliging one", () => {
    expect(() => actionableClockView(mttr, { registerWide: true })).toThrow(/SCA-only/);
    expect(() => actionableClockView(mttr, { registerWide: true })).toThrow(/construction/);
  });

  it("keeps its label even when the payload carries no actionable block", () => {
    const view = actionableClockView({ remediation: {} });
    expect(view.show).toBe(false);
    expect(view.appliesTo).toBe("sca");
    expect(view.coversRegister).toBe(false);
  });
});

// ------------------------------------------------------------------ the confusion matrix

describe("the confusion matrix", () => {
  const view = confusionView(matrixFixture());

  it("has exactly four cells and they are the classified ones", () => {
    expect(view.cells).toHaveLength(4);
    expect(view.cells.map((c) => c.key).sort()).toEqual(["fn", "fp", "tn", "tp"]);
    expect(view.cellTotal).toBe(view.classified);
  });

  it("holds the unclassified rows OUTSIDE those four cells", () => {
    expect(view.unclassified.insideMatrix).toBe(false);
    expect(view.unclassified.total).toBe(100);
    expect(view.unclassified.remediated).toBe(5);
    expect(view.unclassified.open).toBe(95);
    // The load-bearing assertion: nothing unclassified leaked into a corner. Fold
    // `unknownOpen` into `tn` (the tempting corner) and this is what catches it.
    expect(view.cellTotal).not.toBe(view.total);
    expect(view.total - view.cellTotal).toBe(view.unclassified.total);
    for (const cell of view.cells) {
      expect(cell.value, cell.key + " swallowed the unclassified open rows")
        .not.toBe(matrixFixture().tn + matrixFixture().unknownOpen);
    }
  });

  it("reports the unclassified share over the whole population", () => {
    expect(view.unclassified.share.denominator).toBe(400);
    expect(view.unclassified.share.text).toBe("25%");
  });
});

// ------------------------------------------------------------------------------ capacity

describe("monthly capacity", () => {
  const view = capacityView(capacityFixture());
  const month = (m) => view.months.filter((x) => x.month === m)[0];

  it("marks a reconstructed month as not measured", () => {
    expect(month("2025-11").marks).toContain("reconstructed");
    expect(month("2025-11").measured).toBe(false);
  });

  it("marks the current, still-running month as partial", () => {
    expect(month("2026-01").marks).toContain("partial");
    expect(month("2026-01").measured).toBe(false);
  });

  it("leaves a fully observed month unmarked", () => {
    expect(month("2025-12").marks).toEqual([]);
    expect(month("2025-12").measured).toBe(true);
  });

  it("counts what it could not measure, so the headline's sample is checkable", () => {
    expect(view.unmeasuredCount).toBe(2);
    expect(view.monthsCounted).toBe(1);
    expect(view.mmcrMean.denominator).toBe(1);
    expect(view.mmcrMean.denominatorLabel).toContain("month");
  });

  it("gives a month with nothing open a null close rate, not a zero", () => {
    expect(month("2025-11").mmcr.measured).toBe(false);
    expect(month("2025-11").mmcr.text).toBe("not measured");
  });

  it("carries each month's verdict as words, not as a colour", () => {
    expect(month("2026-01").verdictLabel).toBe("Falling behind");
    expect(month("2025-12").verdictLabel).toBe("Gaining");
  });
});

// --------------------------------------------------------------- the rest of the payload

describe("the executive page's own blocks", () => {
  it("shows a tile per severity, open-only, and says what the tiles count", () => {
    const view = executiveSeverityView(execPayload(kmWithMedian()), SEVERITIES);
    expect(view.show).toBe(true);
    expect(view.tiles.map((t) => t.sev)).toEqual(SEVERITIES);
    // A level with no open findings is still a tile: a missing tile reads as a failed render.
    expect(view.tiles.filter((t) => t.sev === "MEDIUM")[0].count).toBe(0);
    expect(view.open).toBe(180);
  });

  it("orders the three registers by open backlog and dashes an unobservable half-life", () => {
    const view = executiveRegisterView(execPayload(kmWithMedian()).byScope);
    expect(view.rows.map((r) => r.scope)).toEqual(["sca", "sast", "secrets"]);
    expect(view.rows[1].kmText).toBe("—");
    expect(view.rows[1].boundNotShipped).toBe(true);
    expect(view.anyBoundMissing).toBe(true);
  });

  it("says what the movement badge is movement OF, and refuses one it cannot compute", () => {
    const up = executiveMovementView({ current: 12, previous: 9, deltaDays: 3, days: 7 });
    expect(up.show).toBe(true);
    expect(up.direction).toBe("up");
    expect(up.label).toMatch(/slower/);
    expect(up.label).toMatch(/last week/);

    const none = executiveMovementView(null);
    expect(none.show).toBe(false);
    expect(none.reason).toMatch(/week/);
  });
});

describe("the per-severity clock", () => {
  const rows = mttrSeverityRows(mttrPayload(kmCensored()), SEVERITIES);

  it("gives a severity whose curve never reached half its own lower bound", () => {
    const high = rows.filter((r) => r.sev === "HIGH")[0];
    expect(high.half.isLowerBound).toBe(true);
    expect(high.half.value).toMatch(/^at least /);
  });

  it("prints a measured median plainly", () => {
    const crit = rows.filter((r) => r.sev === "CRITICAL")[0];
    expect(crit.half.isLowerBound).toBe(false);
    expect(crit.half.value).toBe("6 days");
  });
});

describe("rule sensitivity", () => {
  it("groups the sweep per scope, because one rule cannot classify both", () => {
    const view = sensitivityView({
      sca: {
        sentence: "KEV or EPSS >= 0.1",
        points: [
          { label: "KEV only", coverage: 10, efficiency: 40, highRisk: 30, unknown: 100, active: false },
          { label: "KEV or EPSS", coverage: 20, efficiency: 28.6, highRisk: 60, unknown: 100, active: true },
        ],
      },
      sast: { sentence: "CWE Top 25", points: [] },
    });
    expect(view.show).toBe(true);
    expect(view.groups.map((g) => g.scope).sort()).toEqual(["sast", "sca"]);
    const sca = view.groups.filter((g) => g.scope === "sca")[0];
    expect(sca.points.filter((p) => p.active)).toHaveLength(1);
    expect(sca.label).toContain("SCA");
  });

  it("is empty rather than invented when no register carries a rule", () => {
    expect(sensitivityView({}).show).toBe(false);
    expect(sensitivityView(null).show).toBe(false);
  });
});

// -------------------------------------------------------------------------- formatting

describe("the day and count formatters", () => {
  it("give an em dash for absent, never a zero", () => {
    for (const v of [null, undefined, NaN, "nonsense"]) {
      expect(fmtDays(v)).toBe("—");
      expect(fmtCount(v)).toBe("—");
    }
  });

  it("keep a real zero", () => {
    expect(fmtDays(0)).toBe("0 days");
    expect(fmtCount(0)).toBe("0");
  });

  it("singularise one day", () => {
    expect(fmtDays(1)).toBe("1 day");
  });
});

// -------------------------------------------------------------------------- the stubs

describe("the three pages are wired", () => {
  it("none of them still calls renderStub", () => {
    for (const [name, src] of Object.entries(SRC)) {
      expect(src, name + " still calls renderStub").not.toMatch(/renderStub/);
      expect(src, name + " still imports the stub body").not.toMatch(/_stub\.js/);
    }
  });

  it("each of them calls its own page RPC", () => {
    expect(SRC.executive).toContain("api_getExecutivePage");
    expect(SRC.mttr).toContain("api_getMttrPage");
    expect(SRC.program).toContain("api_getProgramPage");
  });

  it("reaches the charts through the lazy loader rather than importing the bundle", () => {
    // Matched on the IMPORT, not on the word: all three name chartsLoader.js in prose, and
    // an earlier version of this test failed on the Executive header's own explanation of it.
    const imports = (src) => [...src.matchAll(/^import[\s\S]*?from "([^"]+)";$/gm)].map((m) => m[1]);
    for (const name of ["mttr", "program"]) {
      expect(imports(SRC[name]), name + " does not reach the charts lazily")
        .toContain("../chartsLoader.js");
      expect(imports(SRC[name]), name + " imports charts.js eagerly").not.toContain("../charts.js");
    }
    // The landing page draws no chart at all, so the front door never fetches the bundle.
    expect(imports(SRC.executive)).not.toContain("../chartsLoader.js");
    expect(imports(SRC.executive)).not.toContain("../charts.js");
  });

  it("spends the accent as ink only through charts.ACCENT, never as the raw fill token", () => {
    for (const [name, src] of Object.entries(SRC)) {
      expect(src, name + " hard-codes the fill-only accent").not.toContain("#ffcb13");
    }
  });
});
