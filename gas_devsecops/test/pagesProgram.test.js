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
  accountingView, actionableClockView, awaitingView, endOfLifeExclusionNote, fmtCount, fmtDays,
  kmHalfLifeView, mttrHeroView,
  mttrSeverityRows, PAST_CUT_HELP, rateView, resolutionBucketView, rmstView, slaSeverityRows,
  survivalAxisNote, trackingSinceView, WINDOW_LINE_HELP, windowLineView,
} from "../src/client/js/pages/mttr.js";
import {
  boundedRateView, capacityView, confusionView, coverageEfficiencyView, sensitivityView,
  signalBreakdownView,
} from "../src/client/js/pages/program.js";
import { fmtDate } from "../src/client/js/ui.js";
import { absentText } from "../../gas_shared/ui/figures.js";

const SRC = {
  executive: readFileSync(new URL("../src/client/js/pages/executive.js", import.meta.url), "utf8"),
  mttr: readFileSync(new URL("../src/client/js/pages/mttr.js", import.meta.url), "utf8"),
  program: readFileSync(new URL("../src/client/js/pages/program.js", import.meta.url), "utf8"),
};

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

// --------------------------------------------------------------------------- fixtures

/** A KM result whose curve DOES fall to half. `q25` rides along (kmHalfLifeView's "median"
 *  state still carries it, for the per-severity table's own "25% fixed" column). */
function kmWithMedian() {
  return {
    curve: [{ t: 3, s: 0.8 }, { t: 12, s: 0.5 }, { t: 40, s: 0.2 }],
    median: 12,
    medianLowerBound: null,
    q25: 5,
    reliableUntil: null,
    p90: 40,
    mean: 18.5,
    meanTruncated: false,
    restrictionTime: 40,
    events: 30,
    censored: 12,
    total: 42,
  };
}

/**
 * A KM result under heavy censoring, past the reliability cut with no q25 either — the
 * "quartile-bound" state (MTTR delayed-entry package): not even a quarter of what was tracked
 * has closed within the reliable window. `reliableUntil` equals `medianLowerBound` here on
 * purpose — the real shape every server call site ships once `opts.minRisk` runs (`readModels
 * .ts`'s `medianLowerBound = reliableUntil ?? maxObserved`), not the pre-package "longest
 * thing observed" bound this fixture used to represent. This is the normal state of a young
 * register carrying more open findings than closed ones.
 */
function kmCensored() {
  return {
    curve: [{ t: 3, s: 0.94 }, { t: 20, s: 0.71 }],
    median: null,
    medianLowerBound: 41.4,
    q25: null,
    reliableUntil: 41.4,
    p90: null,
    mean: 33.2,
    meanTruncated: true,
    restrictionTime: 41.4,
    events: 6,
    censored: 180,
    total: 186,
  };
}

/** A KM result past the median but with a real 25th-percentile reading — the "quartile" state:
 *  a quarter of what was tracked has closed, even though half has not. */
function kmQuartile() {
  return {
    curve: [{ t: 3, s: 0.9 }, { t: 18, s: 0.76 }, { t: 44, s: 0.6 }],
    median: null,
    medianLowerBound: 44,
    q25: 18,
    reliableUntil: 44,
    p90: null,
    mean: 30,
    meanTruncated: true,
    restrictionTime: 44,
    events: 9,
    censored: 31,
    total: 40,
  };
}

/** No number at all — the "unmeasured" state. */
function kmUnmeasured() {
  return {
    curve: [],
    median: null,
    medianLowerBound: null,
    q25: null,
    reliableUntil: null,
    p90: null,
    mean: null,
    meanTruncated: false,
    restrictionTime: null,
    events: 0,
    censored: 0,
    total: 0,
  };
}

function mttrPayload(km) {
  return {
    rowCount: 186,
    // The window-line fixture: 27 days, 26 Aug 2026 -> 22 Sep 2026 — see `windowLineView`'s
    // own worked example in mttr.js's doc comment, which uses this exact pair.
    asOf: Date.parse("2026-09-22T00:00:00.000Z"),
    scope: null,
    trackingSince: { sca: "2026-08-26T00:00:00.000Z", sast: "2026-09-01T00:00:00.000Z" },
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
      // `mttrSeverityRows` reads THIS now, not the three flat maps above (which stay on the
      // fixture because the real payload still carries them too — see that function's own
      // comment). CRITICAL is "median" state; HIGH is "quartile" (a real q25, unlike
      // `kmCensored()`'s own "quartile-bound"), so the per-severity tests below exercise both.
      kmPerSev: {
        CRITICAL: { median: 6, medianLowerBound: null, q25: 3, reliableUntil: null },
        HIGH: { median: null, medianLowerBound: 44, q25: 18, reliableUntil: 44 },
      },
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
 *  `{median, medianLowerBound, q25, reliableUntil, events, total, excludedPreEntry}` (MTTR
 *  delayed-entry package, then the measurement-window package) and nothing else. `byScope` rows
 *  carry `kmQ25`/`kmMedianLowerBound` alongside `kmMedian` for the same reason
 *  (`execGroupSlice`). `asOf` is AFTER both `trackingSince` dates below it — 22 Sep 2026, the
 *  same "now" `mttrPayload`'s own fixture uses, 27 days past its sca tracking start — so the
 *  window-line tests exercise a real, positive span rather than a clock running backwards. */
function execPayload(km) {
  return {
    asOf: Date.parse("2026-09-22T00:00:00.000Z"),
    scope: null,
    trackingSince: { sca: "2026-08-26T00:00:00.000Z", sast: "2026-09-01T00:00:00.000Z" },
    mttr: {
      rowCount: 186,
      overall: { resolved: 6, open: 180 },
      remediation: {
        km: {
          median: km.median, medianLowerBound: km.medianLowerBound,
          q25: km.q25 ?? null, reliableUntil: km.reliableUntil ?? null,
          events: km.events ?? 0, total: km.total ?? 0,
          excludedPreEntry: km.excludedPreEntry ?? 0,
        },
      },
    },
    byScope: {
      dimension: "scope",
      rows: [
        { group: "sca", kmMedian: 12, kmQ25: 5, kmMedianLowerBound: null, open: 90 },
        { group: "sast", kmMedian: null, kmQ25: null, kmMedianLowerBound: null, open: 60 },
        { group: "secrets", kmMedian: 3, kmQ25: 1, kmMedianLowerBound: null, open: 30 },
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
    // The one fully observed month (2025-12) closed 12, so the count headline and the rate
    // headline describe the same single month — which is the invariant the page relies on.
    closedPerMonthMean: 12,
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
  // FOUR STATES NOW (MTTR delayed-entry package) — see `kmHalfLifeView`'s own doc comment.
  // "at least N days" / "≥ N d" is RETIRED for the half-life: no branch below may print either.

  it("[median] a measured median prints plainly, with q25 riding along for the table column", () => {
    const view = kmHalfLifeView(kmWithMedian());
    expect(view).toEqual({
      measured: true, value: "12 days", isLowerBound: false, days: 12,
      q25Days: 5, state: "median", secondary: null,
    });
  });

  it("[quartile] no median but a real q25 says \"Not reached\", never \"at least\"", () => {
    const view = kmHalfLifeView(kmQuartile());
    expect(view).toEqual({
      measured: true, value: "Not reached", isLowerBound: true, days: null,
      q25Days: 18, state: "quartile", secondary: "25% fixed within 18 days",
    });
    expect(view.value).not.toMatch(/at least|≥/);
  });

  it("[quartile-bound] neither median nor q25, but a reliable floor > 0, still says \"Not reached\"", () => {
    const view = kmHalfLifeView(kmCensored());
    expect(view).toEqual({
      measured: true, value: "Not reached", isLowerBound: true, days: null,
      // 41.4 rounds to a whole day at or above 10 — `fmtDays`'s own rule (`ui/figures.js`).
      q25Days: null, state: "quartile-bound", secondary: "under 25% fixed within 41 days",
    });
    expect(view.value).not.toMatch(/at least|≥/);
  });

  it("[quartile-bound] falls back to medianLowerBound when reliableUntil is absent (legacy shape)", () => {
    const view = kmHalfLifeView({ median: null, q25: null, medianLowerBound: 68 });
    expect(view.state).toBe("quartile-bound");
    expect(view.value).toBe("Not reached");
    expect(view.secondary).toBe("under 25% fixed within 68 days");
  });

  it("[unmeasured] says \"Not measured\" rather than zero when there is no number at all", () => {
    for (const km of [
      null, undefined, {}, kmUnmeasured(), { median: null, medianLowerBound: null },
      { median: null, medianLowerBound: 0, q25: null, reliableUntil: 0 },
    ]) {
      const view = kmHalfLifeView(km);
      expect(view.measured).toBe(false);
      expect(view.isLowerBound).toBe(false);
      expect(view.value).toBe("Not measured");
      expect(view.state).toBe("unmeasured");
      expect(view.secondary).toBeNull();
      expect(view.value).not.toMatch(/^0/);
    }
  });

  it("reaches the MTTR hero, with the censored count beside it", () => {
    const view = mttrHeroView(mttrPayload(kmCensored()));
    expect(view.isLowerBound).toBe(true);
    expect(view.value).toBe("Not reached");
    expect(view.censored).toBe(180);
    expect(view.events).toBe(6);
    expect(view.qualifier).toContain("180");
    expect(view.qualifier).toMatch(/censored/);
  });

  it("reaches the Executive hero through execMttrSlice's widened four-field slice", () => {
    const view = executiveHeroView(execPayload(kmCensored()));
    expect(view.isLowerBound).toBe(true);
    expect(view.value).toBe("Not reached");
    expect(view.secondary).toBe("under 25% fixed within 41 days");
    // The estimator's own censored count is NOT in that slice, and the view says so rather
    // than passing resolved/open off as it.
    expect(view.censoredKnown).toBe(false);
    expect(view.qualifier).toContain("still open");
  });

  it("the Executive hero reaches the quartile state too, when the payload carries a q25", () => {
    const view = executiveHeroView(execPayload(kmQuartile()));
    expect(view.state).toBe("quartile");
    expect(view.value).toBe("Not reached");
    expect(view.secondary).toBe("25% fixed within 18 days");
  });

  it("still measures when the median is genuinely observed", () => {
    const view = executiveHeroView(execPayload(kmWithMedian()));
    expect(view.isLowerBound).toBe(false);
    expect(view.value).toBe("12 days");
  });
});

describe("trackingSinceView — \"Tracking since <date>\", printed once beside the hero", () => {
  it("reads its own scope's date when the page is scoped to one register, via the register's own fmtDate", () => {
    const view = trackingSinceView({
      scope: "sca",
      trackingSince: { sca: "2026-08-26T00:00:00.000Z", sast: "2026-09-01T00:00:00.000Z" },
    });
    expect(view.show).toBe(true);
    expect(view.text).toContain("earlier fixes are not visible");
    // fmtDate (gas_shared/ui/format.js) is sv-SE/Europe-Paris, YYYY-MM-DD — the SAME formatter
    // history.js's own "Watching since" line already uses, so the two pages read one date.
    expect(view.text).toContain(fmtDate("2026-08-26T00:00:00.000Z"));
  });

  it("reads the EARLIEST scope's date across an all-scopes view", () => {
    const view = trackingSinceView({
      scope: null,
      trackingSince: {
        sca: "2026-08-26T00:00:00.000Z", sast: "2026-09-01T00:00:00.000Z",
        secrets: "2026-09-10T00:00:00.000Z",
      },
    });
    expect(view.text).toContain(fmtDate("2026-08-26T00:00:00.000Z"));
  });

  it("shows nothing when the payload carries no tracking start at all", () => {
    expect(trackingSinceView({ scope: null, trackingSince: {} }).show).toBe(false);
    expect(trackingSinceView({ scope: "sca", trackingSince: {} }).show).toBe(false);
    expect(trackingSinceView(null).show).toBe(false);
  });
});

// ------------------------------------------------------------------- the measurement window

describe("windowLineView — the observation window itself, printed under \"Tracking since\"", () => {
  it("states start, end, span and the estimator's own sample size", () => {
    const view = windowLineView(mttrPayload(kmWithMedian()), kmWithMedian());
    expect(view.show).toBe(true);
    // 2026-08-26 (sca's own tracking start — the register is scoped to nothing, so the
    // EARLIEST of the two scopes in the fixture) to 2026-09-22 (asOf) is 27 days.
    expect(view.text).toBe(
      "Window " + fmtDate("2026-08-26T00:00:00.000Z") + " → " + fmtDate("2026-09-22T00:00:00.000Z")
      + " (27 days) · 30 fixes seen · 42 findings watched",
    );
  });

  it("reads its own scope's tracking start when the page is scoped to one register", () => {
    const scoped = { ...mttrPayload(kmWithMedian()), scope: "sast" };
    const view = windowLineView(scoped, kmWithMedian());
    // sast's own start (2026-09-01), not the earlier sca one — 21 days to 2026-09-22.
    expect(view.text).toContain(fmtDate("2026-09-01T00:00:00.000Z"));
    expect(view.text).toContain("(21 days)");
  });

  it("singular \"1 day\" when the span floors to exactly one whole day", () => {
    const payload = {
      ...mttrPayload(kmWithMedian()),
      trackingSince: { sca: "2026-09-21T00:00:00.000Z" },
      asOf: Date.parse("2026-09-22T00:00:00.000Z"),
    };
    const view = windowLineView(payload, kmWithMedian());
    expect(view.text).toContain("(1 day)");
    expect(view.text).not.toContain("(1 days)");
  });

  it("\"(under a day)\" replaces \"(0 days)\" for a register scanned twice in one day", () => {
    const payload = {
      ...mttrPayload(kmWithMedian()),
      trackingSince: { sca: "2026-09-22T00:00:00.000Z" },
      asOf: Date.parse("2026-09-22T06:00:00.000Z"),
    };
    const view = windowLineView(payload, kmWithMedian());
    expect(view.text).toContain("(under a day)");
    expect(view.text).not.toMatch(/\(0 days?\)/);
  });

  it("appends the pre-entry exclusion clause only when something was actually excluded", () => {
    const withExclusion = windowLineView(
      mttrPayload(kmWithMedian()),
      { ...kmWithMedian(), excludedPreEntry: 7 },
    );
    expect(withExclusion.text).toContain("· 7 closed before watching began");

    // Zero is not a qualifier — a "· 0 closed before watching began" clause would dress a
    // measured zero up as an exclusion that never happened.
    const withoutExclusion = windowLineView(
      mttrPayload(kmWithMedian()),
      { ...kmWithMedian(), excludedPreEntry: 0 },
    );
    expect(withoutExclusion.text).not.toContain("closed before watching began");
  });

  it("is hidden exactly when trackingSinceView is — no tracking start, no window line either", () => {
    expect(windowLineView({ scope: null, trackingSince: {}, asOf: 123 }, kmWithMedian()).show)
      .toBe(false);
    expect(windowLineView(null, kmWithMedian()).show).toBe(false);
  });

  it("is hidden when asOf cannot be read, even with a real tracking start", () => {
    const payload = { ...mttrPayload(kmWithMedian()), asOf: null };
    expect(windowLineView(payload, kmWithMedian()).show).toBe(false);
  });

  it("reaches the MTTR hero and the Executive hero off the SAME km the half-life reads", () => {
    // Not a DOM assertion — this file has no jsdom — but the two callers (renderHero on both
    // pages) hand this exact (`payload`-shaped object, km) pair to `windowLineView`, and this
    // pins that the pure function itself agrees across both payload shapes: MTTR's own `mttr`
    // object and Executive's whole `payload` both carry `{trackingSince, scope, asOf}` at their
    // own level, per `trackingSinceView`'s own doc comment.
    const mttrView = windowLineView(mttrPayload(kmWithMedian()), kmWithMedian());
    const exec = execPayload(kmWithMedian());
    const execView = windowLineView(exec, exec.mttr.remediation.km);
    expect(mttrView.show).toBe(true);
    expect(execView.show).toBe(true);
    expect(execView.text).toContain("30 fixes seen");
    expect(execView.text).toContain("42 findings watched");
  });
});

describe("survivalAxisNote — the curve's own axis is age, not the calendar", () => {
  it("cites the real window and the real reliability cut when both are known", () => {
    const note = survivalAxisNote(mttrPayload(kmCensored()), kmCensored());
    expect(note).toContain("27-day window");
    // kmCensored()'s reliableUntil is 41.4, rounded.
    expect(note).toContain("41 days");
    expect(note).toMatch(/age, not the calendar/);
  });

  it("falls back to the shorter, numberless sentence when reliableUntil is null", () => {
    const note = survivalAxisNote(mttrPayload(kmUnmeasured()), kmUnmeasured());
    expect(note).toMatch(/age, not the calendar/);
    expect(note).not.toMatch(/\d/);
  });

  it("falls back when there is no tracking window to cite either", () => {
    const note = survivalAxisNote({ scope: null, trackingSince: {} }, kmCensored());
    expect(note).not.toMatch(/\d/);
  });
});

// --------------------------------------------------------- the row-accounting block

/** The plan's own worked example (mttr-plan.md): 50,326 findings, 1,162 fixes used inside the
 *  reliable window, 38 seen past the 340-day cut, 49,125 still open, one resolved before this
 *  register looked, none with no readable clock, and 737 late entrants at a 431-day median
 *  age. `events` is `1,162 + 38` — the pre-cut total `remediation.ts`'s KMResult documents. */
function accountingKm(overrides) {
  return {
    events: 1200,
    censored: 49125,
    excludedPreEntry: 1,
    total: 50325,
    rowsIn: 50326,
    noClock: 0,
    eventsPastCut: 38,
    reliableUntil: 340.4,
    lateEntrants: 737,
    lateEntryMedianAge: 431,
    ...overrides,
  };
}

describe("accountingView — where every row the estimate started from went", () => {
  it("the worked example: five rows that sum exactly to the header total", () => {
    const view = accountingView({ remediation: { km: accountingKm() } });
    expect(view.show).toBe(true);
    expect(view.total).toBe(50326);
    const sum = view.rows.reduce((a, r) => a + r.count, 0);
    expect(sum).toBe(view.total);
    expect(view.rows.map((r) => [r.label, r.count])).toEqual([
      ["Fixes used", 1162],
      ["Fixes past the cut", 38],
      ["Still open", 49125],
      ["Closed before watching", 1],
      ["No readable clock", 0],
    ]);
  });

  it("every row's own reconciliation check: the sum-to-header invariant holds on many shapes", () => {
    const shapes = [
      accountingKm(),
      accountingKm({ eventsPastCut: 0, reliableUntil: 12 }), // a cut that excluded nothing
      accountingKm({ reliableUntil: null, eventsPastCut: 0 }), // no cut requested at all
      { events: 4, censored: 0, excludedPreEntry: 0, rowsIn: 4, noClock: 0, eventsPastCut: 0,
        reliableUntil: null, lateEntrants: 0, lateEntryMedianAge: null }, // kmUnmeasured-shaped
      { events: 0, censored: 0, excludedPreEntry: 0, rowsIn: 0, noClock: 0, eventsPastCut: 0,
        reliableUntil: null, lateEntrants: 0, lateEntryMedianAge: null }, // an unread ledger
    ];
    for (const km of shapes) {
      const view = accountingView({ remediation: { km } });
      const sum = view.rows.reduce((a, r) => a + r.count, 0);
      expect(sum, JSON.stringify(km)).toBe(view.total);
    }
  });

  it("\"Fixes past the cut\" carries the reliable-window day count and the glossary tip", () => {
    const view = accountingView({ remediation: { km: accountingKm() } });
    const row = view.rows.find((r) => r.key === "pastCut");
    expect(row.note).toContain("340");
    expect(row.note).toContain("not in the median");
    expect(row.tip).toBe(PAST_CUT_HELP);
  });

  it("\"Closed before watching\" reuses WINDOW_LINE_HELP rather than a second copy of the sentence", () => {
    const view = accountingView({ remediation: { km: accountingKm() } });
    const row = view.rows.find((r) => r.key === "closedBeforeWatching");
    expect(row.tip).toBe(WINDOW_LINE_HELP);
  });

  it("hides \"Fixes past the cut\" only when nothing was ever cut — reliableUntil null AND eventsPastCut 0", () => {
    const noCut = accountingView({
      remediation: { km: accountingKm({ reliableUntil: null, eventsPastCut: 0 }) },
    });
    expect(noCut.rows.some((r) => r.key === "pastCut")).toBe(false);
    // Still balances: the whole 1,200 events read as "Fixes used" when nothing was cut.
    expect(noCut.rows.find((r) => r.key === "used").count).toBe(1200);
    expect(noCut.rows.reduce((a, r) => a + r.count, 0)).toBe(noCut.total);
  });

  it("prints \"Fixes past the cut\" even at a measured zero, once a cut actually ran", () => {
    const zeroCut = accountingView({
      remediation: { km: accountingKm({ reliableUntil: 12, eventsPastCut: 0 }) },
    });
    const row = zeroCut.rows.find((r) => r.key === "pastCut");
    expect(row).toBeTruthy();
    expect(row.count).toBe(0);
  });

  it("keeps \"Fixes past the cut\" visible even when reliableUntil is null because the FIRST event already failed reliability", () => {
    // remediation.ts's own docstring: reliableUntil reads null two ways — no cut requested, or
    // the cut ran and its first event already failed. In the second case eventsPastCut equals
    // every event, and hiding the row on `reliableUntil === null` alone would delete that count
    // from the visible breakdown entirely — the exact silent disappearance this block exists to
    // rule out. `eventsPastCut > 0` is what tells the two apart on this shape alone.
    const firstEventFails = accountingView({
      remediation: {
        km: accountingKm({ reliableUntil: null, eventsPastCut: 1200, events: 1200 }),
      },
    });
    const row = firstEventFails.rows.find((r) => r.key === "pastCut");
    expect(row).toBeTruthy();
    expect(row.count).toBe(1200);
    expect(firstEventFails.rows.find((r) => r.key === "used").count).toBe(0);
    expect(firstEventFails.rows.reduce((a, r) => a + r.count, 0)).toBe(firstEventFails.total);
  });

  it("every count is a real number, never a dash, even when it is zero", () => {
    // excludedPreEntry and noClock are both a measured zero here, not an absence — every one
    // of the five rows still has to print "0", never `absentText`, so the row itself carries a
    // real `number`, not null/undefined, for `fmtCount` to render.
    const view = accountingView({
      remediation: {
        km: accountingKm({
          excludedPreEntry: 0, noClock: 0, censored: 49126, rowsIn: 50326,
        }),
      },
    });
    for (const row of view.rows) {
      expect(typeof row.count).toBe("number");
      expect(Number.isFinite(row.count)).toBe(true);
    }
    expect(view.rows.reduce((a, r) => a + r.count, 0)).toBe(view.total);
  });

  it("the onboarding-backlog line only shows when lateEntrants > 0, and phrases the median as asked", () => {
    const view = accountingView({ remediation: { km: accountingKm() } });
    expect(view.lateEntrantsLine).toBe(
      "737 were already open when watching began (median age at entry 431 days).",
    );
    const none = accountingView({
      remediation: { km: accountingKm({ lateEntrants: 0, lateEntryMedianAge: null }) },
    });
    expect(none.lateEntrantsLine).toBeNull();
    const one = accountingView({
      remediation: { km: accountingKm({ lateEntrants: 1, lateEntryMedianAge: 5 }) },
    });
    expect(one.lateEntrantsLine).toBe(
      "1 was already open when watching began (median age at entry 5 days).",
    );
  });

  it("is not shown at all when there is no KM result on the payload", () => {
    expect(accountingView({ remediation: {} }).show).toBe(false);
    expect(accountingView(null).show).toBe(false);
    expect(accountingView({}).show).toBe(false);
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

  it("publishes the close rate as a count too, over the same months", () => {
    // "About one in 3.33 a month" is 12 findings on this register and would be 1,200 on a
    // bigger one. The count is what a reader staffs against, and it is only readable beside
    // the rate because both are averaged over `monthsCounted` — the same single month here.
    expect(view.closedPerMonthMean).toBe(12);
    expect(view.closedPerMonthText).toBe("12");
    expect(view.monthsCounted).toBe(1);
  });

  it("keeps the tenth below ten, so a barely-moving register is not drawn as a stopped one", () => {
    const slow = capacityView({ ...capacityFixture(), closedPerMonthMean: 0.4 });
    expect(slow.closedPerMonthText).toBe("0.4");
    const fast = capacityView({ ...capacityFixture(), closedPerMonthMean: 1234.56 });
    expect(fast.closedPerMonthText).toBe("1,235");
  });

  it("refuses the count when no month was fully observed, rather than printing a zero", () => {
    const unwatched = capacityView({
      ...capacityFixture(), closedPerMonthMean: null, mmcrMean: null, monthsCounted: 0,
    });
    expect(unwatched.closedPerMonthMean).toBeNull();
    expect(unwatched.closedPerMonthText).toBe(absentText);
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

  it("orders the three registers by open backlog and marks an unobservable half-life honestly", () => {
    const view = executiveRegisterView(execPayload(kmWithMedian()).byScope);
    expect(view.rows.map((r) => r.scope)).toEqual(["sca", "sast", "secrets"]);
    // sast carries no kmMedian, kmQ25 or kmMedianLowerBound in the fixture — genuinely
    // nothing measured, so kmHalfLifeView reads it as "unmeasured", not a bare dash any more.
    expect(view.rows[1].kmText).toBe("Not measured");
    expect(view.rows[1].half.state).toBe("unmeasured");
  });

  it("the byScope table reaches the quartile and quartile-bound states too", () => {
    const view = executiveRegisterView({
      dimension: "scope",
      rows: [
        { group: "sca", kmMedian: null, kmQ25: 18, kmMedianLowerBound: 44, open: 90 },
        { group: "sast", kmMedian: null, kmQ25: null, kmMedianLowerBound: 41.4, open: 60 },
      ],
    });
    expect(view.rows[0].half.state).toBe("quartile");
    expect(view.rows[0].kmText).toBe("Not reached");
    expect(view.rows[1].half.state).toBe("quartile-bound");
    expect(view.rows[1].kmText).toBe("Not reached");
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

  it("gives a severity whose curve never reached half its own quartile reading, never \"at least\"", () => {
    const high = rows.filter((r) => r.sev === "HIGH")[0];
    expect(high.half.isLowerBound).toBe(true);
    expect(high.half.value).toBe("Not reached");
    expect(high.half.state).toBe("quartile");
    // The "25% fixed" column reads this — see `renderSeverity`'s dataTable.
    expect(high.q25).toBe(18);
  });

  it("prints a measured median plainly", () => {
    const crit = rows.filter((r) => r.sev === "CRITICAL")[0];
    expect(crit.half.isLowerBound).toBe(false);
    expect(crit.half.value).toBe("6 days");
    expect(crit.half.state).toBe("median");
    expect(crit.q25).toBe(3);
  });

  it("\"Fixes in window\" reads kmPerSev[sev].events, and em-dashes a severity with no curve at all", () => {
    const withGap = mttrSeverityRows({
      perSev: {
        CRITICAL: { resolved: 4, open: 20 },
        // MEDIUM has resolved/open stats but no curve at all — never priced by the estimator,
        // as opposed to priced-and-zero. `mttrSeverityRows`'s own comment names this branch.
        MEDIUM: { resolved: 1, open: 5 },
      },
      remediation: {
        kmPerSev: {
          CRITICAL: { median: 6, medianLowerBound: null, q25: 3, reliableUntil: null, events: 4 },
          // HIGH got a curve, but nothing closed inside the window — a MEASURED zero, not a gap.
          HIGH: { median: null, medianLowerBound: null, q25: null, reliableUntil: null, events: 0 },
        },
      },
    }, SEVERITIES);
    const crit = withGap.find((r) => r.sev === "CRITICAL");
    const high = withGap.find((r) => r.sev === "HIGH");
    const med = withGap.find((r) => r.sev === "MEDIUM");
    expect(crit.fixesInWindow).toBe(4);
    expect(fmtCount(crit.fixesInWindow)).toBe("4");
    expect(high.fixesInWindow).toBe(0);
    expect(fmtCount(high.fixesInWindow)).toBe("0");
    expect(med.fixesInWindow).toBeNull();
    expect(fmtCount(med.fixesInWindow)).toBe(absentText);
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
        .toContain("../../../../../gas_shared/ui/chartsLoader.js");
      expect(imports(SRC[name]), name + " imports charts.js eagerly").not.toContain("../charts.js");
    }
    // The landing page draws no chart at all, so the front door never fetches the bundle.
    expect(imports(SRC.executive)).not.toContain("../../../../../gas_shared/ui/chartsLoader.js");
    expect(imports(SRC.executive)).not.toContain("../charts.js");
  });

  it("spends the accent as ink only through charts.ACCENT, never as the raw fill token", () => {
    for (const [name, src] of Object.entries(SRC)) {
      expect(src, name + " hard-codes the fill-only accent").not.toContain("#ffcb13");
    }
  });
});

// =========================================================================================
//  endOfLifeExclusionNote — one sentence, five pages
// =========================================================================================
//
// The MTTR & SLA page, the Executive, Scan history, Coverage & efficiency and Secrets each draw
// a figure the same switch narrows. Five hand-written sentences would be five chances for one
// of them to describe a different population than it measured, so there is one — and these
// cases are mostly about the two things it must never do: claim more than it narrowed, and say
// anything at all about a tenant whose lifecycle tag this register never learned.

describe("endOfLifeExclusionNote", () => {
  const block = (over) => ({ excluded: false, repos: 0, excludedRepos: 0, excludedRows: 0, ...over });

  it("says nothing when no repository here is retired, in EITHER setting", () => {
    // `unmeasurableNote`'s rule — a sentence about zero repositories is noise — and it is also
    // the honest reading where the lifecycle tag matched nothing: nothing known, nothing said.
    expect(endOfLifeExclusionNote(block({ repos: 0, excluded: false }))).toBeNull();
    expect(endOfLifeExclusionNote(block({ repos: 0, excluded: true }))).toBeNull();
    expect(endOfLifeExclusionNote(null)).toBeNull();
    expect(endOfLifeExclusionNote(undefined)).toBeNull();
    // A payload that predates the block entirely.
    expect(endOfLifeExclusionNote({})).toBeNull();
  });

  // Perturbation, run and reverted: returning null whenever `excluded` is false — the
  // "nothing was removed, so there is nothing to say" reading — fails this case with
  // `expected null to contain 'still counted'`, and takes the discoverability of the whole
  // setting with it.
  it("OFF, it says the retired repositories are in the figure and where the switch is", () => {
    const note = endOfLifeExclusionNote(block({ repos: 3 }));
    expect(note).toContain("3 repositories");
    expect(note).toContain("still counted in these figures");
    expect(note).toContain("Deadlines");
    expect(note).not.toContain("left out");
  });

  it("ON, it says what left and how much went with it", () => {
    const note = endOfLifeExclusionNote(
      block({ excluded: true, repos: 3, excludedRepos: 3, excludedRows: 41 }),
    );
    expect(note).toContain("3 repositories left out of these figures");
    expect(note).toContain("41 findings");
    // THE LIMIT OF THE CLAIM, in the same breath. It is the one promise true in all four
    // combinations of the two switches: neither ever touches a count of what is open.
    expect(note).toContain("Still counted in every count of what is open");
  });

  // Perturbation, run and reverted: hard-coding "these figures" in place of the `what`
  // parameter fails this case with `expected '…these figures…' to contain 'the half-life
  // figures'` — and on the Executive that sentence would claim the severity tiles moved,
  // which is exactly what the builder there takes care not to do.
  it("NAMES THE FAMILY IT REACHES, because the pages do not all narrow the same figures", () => {
    const on = { excluded: true, repos: 2, excludedRepos: 2, excludedRows: 9 };
    expect(endOfLifeExclusionNote(block(on), "the half-life figures"))
      .toContain("left out of the half-life figures");
    expect(endOfLifeExclusionNote(block({ repos: 2 }), "the capacity rates"))
      .toContain("still counted in the capacity rates");
  });

  it("counts in singular where one repository or one finding is what happened", () => {
    expect(endOfLifeExclusionNote(block({ repos: 1 }))).toContain("1 repository here is");
    expect(endOfLifeExclusionNote(
      block({ excluded: true, repos: 1, excludedRepos: 1, excludedRows: 1 }),
    )).toContain("1 repository left out of these figures as end of life, with 1 finding.");
  });

  // Perturbation, run and reverted: `Number(block.repos || 0)` in place of `num` fails this
  // case on `{}` with `expected 'NaN repositories…' to be null`.
  it("reads the count through this package's refuse-before-cast reader, never a bare cast", () => {
    for (const repos of [null, undefined, {}, NaN, [], false]) {
      expect(endOfLifeExclusionNote(block({ repos })), String(repos)).toBeNull();
    }
    // A numeric string is a value `num` accepts everywhere else in this package, so it is not
    // a refusal here either — the guard is against null, junk and NaN, not against a shape
    // the rest of the app already reads.
    expect(endOfLifeExclusionNote(block({ repos: "3" }))).toContain("3 repositories");
  });
});
