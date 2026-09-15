// The view models ported from gas_devsecops/src/client/js/pages/mttr.js into this app's own
// `pages/mttr.js` — `kmHalfLifeView`, `rateView`, `kmP90View`, `meterPctFor`, `rmstView`. No
// DOM (these are the DOM-free half on purpose), so this file is plain Node assertions on the
// exported functions, the same house style `gas_devsecops/test/figuresOverProse.test.js` uses
// for the same functions.
//
// THE DEFECT THIS PACKAGE REMOVES, restated exactly. `pages/mttr.js`'s own `kmMedianText`
// printed `"> " + fmtSpan(km.medianLowerBound)` for a curve that never reached 50% — the WRONG
// GLYPH. Heavy censoring means the true median is AT LEAST that far out (an inclusive lower
// bound); ">" claims something the estimator never showed. `kmHalfLifeView` fixes the wording
// at both of that formatter's old call sites (this page's own hero, and `executive.js`'s).
//
// EVERY GUARD BELOW IS PERTURBED, per CLAUDE.md: "a guard that fires on nothing is a finding,
// not a pass." Each risky case reproduces the tempting rewrite inline and shows it giving the
// wrong answer on the same input, rather than asserting the rule from a comment.

import { describe, expect, it } from "vitest";

import {
  kmHalfLifeView, kmP90View, meterPctFor, rateView, rmstView,
} from "../src/client/js/pages/mttr.js";

// A shipped KMResult shape (src/domain/remediation.ts) with only the fields each test reads —
// real payloads carry more (`curve`, `events`, `censored`, `total`, `naiveMedian`, …).
function km(fields) {
  return { median: null, medianLowerBound: null, mean: null, meanTruncated: false, ...fields };
}

// =========================================================================================
//  kmHalfLifeView — three claims, three strings, and the bound's own wording
// =========================================================================================

describe("kmHalfLifeView: a measured median", () => {
  it("prints the day count in prose, unflagged", () => {
    const view = kmHalfLifeView(km({ median: 12 }));
    expect(view.measured).toBe(true);
    expect(view.isLowerBound).toBe(false);
    expect(view.value).toBe("12 days");
    expect(view.days).toBe(12);
  });

  it("singularises a one-day median", () => {
    expect(kmHalfLifeView(km({ median: 1 })).value).toBe("1 day");
  });
});

describe("kmHalfLifeView: a curve that never reaches half", () => {
  it("publishes the lower bound as \"at least N days\" and flags it", () => {
    // `fmtDays` rounds to a whole day at or above 10 (see ui/figures.js's header for why
    // both grains exist) — 41.4 becomes "41 days" here, same as it would in prose anywhere
    // else on this page. `days` still carries the exact, unrounded bound.
    const view = kmHalfLifeView(km({ median: null, medianLowerBound: 41.4 }));
    expect(view.isLowerBound).toBe(true);
    expect(view.measured).toBe(true);
    expect(view.value).toMatch(/^at least /);
    expect(view.value).toBe("at least 41 days");
    expect(view.days).toBe(41.4);
  });

  it("keeps one decimal below the 10-day rounding threshold", () => {
    const view = kmHalfLifeView(km({ median: null, medianLowerBound: 6.4 }));
    expect(view.value).toBe("at least 6.4 days");
  });

  // THE GLYPH THIS PACKAGE REPLACES. The old `kmMedianText` printed `"> 41d"` (`fmtSpan`'s own
  // format) — a stronger, wrong claim (strictly beyond, rather than at least). Reproduced here
  // as the defective rewrite and shown to disagree with the shipped view on the same input.
  it("is not the old '>' glyph, and the old glyph would have said something falser", () => {
    const bound = 41.4;
    const oldWrongForm = `> ${bound.toFixed(1)}d`; // pages/mttr.js's fmtSpan-based old copy
    const view = kmHalfLifeView(km({ median: null, medianLowerBound: bound }));
    expect(view.value).not.toBe(oldWrongForm);
    expect(view.value).not.toContain(">");
    expect(view.value).toBe("at least 41 days");
  });
});

describe("kmHalfLifeView: nothing to rest on", () => {
  it("says \"Not measured\" rather than zero, for every shape of absence", () => {
    for (const input of [null, undefined, {}, km({ median: null, medianLowerBound: null })]) {
      const view = kmHalfLifeView(input);
      expect(view.measured).toBe(false);
      expect(view.isLowerBound).toBe(false);
      expect(view.value).toBe("Not measured");
      expect(view.days).toBeNull();
      // Not a zero in disguise — CLAUDE.md's exact trap, one door over.
      expect(view.value).not.toMatch(/^0/);
    }
  });
});

// =========================================================================================
//  rateView — a rate is not a rate without its base, and Number(null) is 0 (and finite)
// =========================================================================================

describe("rateView: a real base, including a measured zero", () => {
  it("reports a measured zero as a real rate, not an absence", () => {
    const rate = rateView(0, 10, "10 resolved");
    expect(rate.measured).toBe(true);
    expect(rate.baseEmpty).toBe(false);
    expect(rate.text).toBe("0%");
  });

  it("formats a real rate to one decimal", () => {
    expect(rateView(47.2, 36, "36 resolved").text).toBe("47.2%");
  });
});

describe("rateView: baseEmpty — nothing has been measured to take it over", () => {
  it("rateView(undefined, 0, …) reads \"not measured\" with baseEmpty: true", () => {
    const rate = rateView(undefined, 0, "0 resolved");
    expect(rate.baseEmpty).toBe(true);
    expect(rate.measured).toBe(false);
    expect(rate.text).toBe("not measured");
    expect(rate.value).toBeNull();
  });

  it("carries a default emptyLabel, and honours a caller's own", () => {
    expect(rateView(null, 0, "0 resolved").emptyLabel)
      .toBe("nothing has been measured to take it over");
    expect(rateView(null, 0, "0 resolved", "no backlog was open").emptyLabel)
      .toBe("no backlog was open");
  });
});

describe("rateView: a real base the server did not compute a rate over", () => {
  it("is unmeasured but NOT baseEmpty — a different state from an empty population", () => {
    const rate = rateView(undefined, 12, "12 resolved");
    expect(rate.baseEmpty).toBe(false);
    expect(rate.measured).toBe(false);
    expect(rate.denominator).toBe(12);
  });
});

// PERTURBATION, exactly as the brief asks: `Number(pct) || 0` — the tempting cast-through
// shortcut at a call site that skips `rateView` — prints a confident "0%" for the same input
// `rateView` correctly refuses. Shown FAILING the assertion a reader would want to hold,
// rather than merely described.
describe("rateView's whole reason to exist — the cast-through rewrite fails the same check", () => {
  it("Number(pct) || 0 prints 0% and FAILS the not-measured assertion rateView passes", () => {
    const pctFromServer = undefined; // "the server did not compute this rate" — never a number
    const denominator = 0; // "nothing has been measured to take it over" — baseEmpty too

    // The defective, uncorrected form a call site could have written instead of rateView():
    const naiveText = `${Number(pctFromServer) || 0}%`;
    expect(naiveText).toBe("0%"); // confident, and wrong — nobody measured a 0% anything here

    // rateView() gives the honest answer over the identical inputs:
    const rate = rateView(pctFromServer, denominator, "0 resolved");
    expect(rate.text).toBe("not measured");
    expect(rate.baseEmpty).toBe(true);

    // The two disagree, which is the whole point: asserting the naive form ALSO says
    // "not measured" must fail, proving this test would catch a regression back to it.
    expect(() => expect(naiveText).toBe("not measured")).toThrow();
  });
});

// =========================================================================================
//  kmP90View — adapted for THIS register's shape (kmP90 is a sibling of km, not km.p90)
// =========================================================================================

describe("kmP90View: adapted signature — (p90, km), not gas_devsecops's (km) alone", () => {
  it("takes remediation.kmP90 separately, because this server ships it as a sibling of km", () => {
    // src/server/api.ts: `remediation = { ..., km, kmP90: kmQuantileFromCurve(...), ... }` —
    // kmP90 is NOT nested on the KMResult the way gas_devsecops's schema nests it.
    const view = kmP90View(41, km({ events: 6 }));
    expect(view.measured).toBe(true);
    expect(view.value).toBe("41 days");
    expect(view.days).toBe(41);
  });

  it("prints the sub-line ONLY when a value exists", () => {
    const measured = kmP90View(41, km({ events: 6 }));
    expect(measured.note).toBe("nine in ten close by here");

    const curveTooShort = kmP90View(null, km({ events: 6 }));
    expect(curveTooShort.measured).toBe(false);
    expect(curveTooShort.note).not.toBe("nine in ten close by here");
    expect(curveTooShort.note).toMatch(/never reaches nine in ten/);

    const nothingClosed = kmP90View(null, km({ events: 0 }));
    expect(nothingClosed.measured).toBe(false);
    expect(nothingClosed.note).not.toBe("nine in ten close by here");
    expect(nothingClosed.note).toMatch(/nothing has closed/);
  });

  it("is not the Number(null)-is-0 trap — a blank p90 does not print \"0 days\"", () => {
    // `num("")` refuses a blank hand-edited cell BEFORE any cast; `Number("")` is 0 and finite.
    const view = kmP90View("", km({ events: 6 }));
    expect(view.measured).toBe(false);
    expect(view.value).not.toBe("0 days");
  });
});

// =========================================================================================
//  meterPctFor and rmstView — ported unchanged; a thin confirmation they survived the port
// =========================================================================================

describe("meterPctFor: unchanged from gas_devsecops — no meter for an unmeasured rate", () => {
  it("fills a measured rate, zero included", () => {
    expect(meterPctFor(rateView(0, 10, "10 resolved"))).toBe(0);
  });

  it("draws no meter at all for baseEmpty or uncomputed", () => {
    expect(meterPctFor(rateView(null, 0, "0 resolved"))).toBeNull();
    expect(meterPctFor(rateView(undefined, 12, "12 resolved"))).toBeNull();
    expect(meterPctFor(null)).toBeNull();
  });
});

describe("rmstView: unchanged from gas_devsecops — this register's KMResult carries the same fields", () => {
  it("prints the restricted mean, flagged when survival never reached zero", () => {
    const view = rmstView(km({ mean: 30, meanTruncated: true, restrictionTime: 45 }));
    expect(view.measured).toBe(true);
    expect(view.truncated).toBe(true);
    expect(view.text).toBe("≥ 30 days");
    expect(view.restrictionTime).toBe(45);
  });

  it("says \"Not measured\" with no events", () => {
    const view = rmstView(km({ mean: null }));
    expect(view.measured).toBe(false);
    expect(view.text).toBe("Not measured");
  });
});
