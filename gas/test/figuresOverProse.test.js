// The pure half of the three figures this package took OUT of sentences on `#/mttr`.
//
// Ported from gas_devsecops/test/figuresOverProse.test.js — the MTTR half of it. That file's
// other two sections cover `fixNextView` (executive.js) and `vendorWaitReading` (an axisBar
// this register does not draw), so neither ports; `slaEdgeLegend` is exercised in
// `test/mttrAging.test.js` beside the view that builds its input, which is where the target
// numbers it reads come from.
//
// The claim this package makes is that the clock page carries the same facts with far fewer
// words: a four-tile hand-rolled `.hero-minis` band became `statRow`s with meters, five
// SLA-edge paragraphs became one legend line, and a trend chart a screen below the fold got a
// sparkline beside the figure it qualifies. Every one of those swaps moved a DECISION out of a
// paragraph and into a model — and a decision inside a picture is the kind a screenshot review
// passes and a reader is misled by. This file holds those decisions.
//
// NO DOM (vitest.config.ts sets no `environment`), which is why each is a pure function on the
// page module rather than a fragment of a render closure. Where a claim is about what the page
// DRAWS rather than what it decides, it is asserted against the page's source text, the way
// `test/chartTable.test.js` and `test/mttrAging.test.js` already do.
//
// EVERY GUARD BELOW IS PERTURBED. CLAUDE.md: "a guard that fires on nothing is a finding, not a
// pass" — so each `describe` reproduces the tempting rewrite INLINE and shows it giving the
// wrong answer on the same input, rather than asserting the rule from a comment.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  halfLifeTrendPoints, meterPctFor, rateView, slaEdgeLegend,
} from "../src/client/js/pages/mttr.js";

const MTTR_SRC = readFileSync(
  new URL("../src/client/js/pages/mttr.js", import.meta.url), "utf8",
);

// =========================================================================================
//  1. meterPctFor — the Number(null) trap, wearing a meter
// =========================================================================================

describe("meterPctFor: an unmeasured rate draws NO meter, never an empty one", () => {
  it("gives a measured rate its own percentage, zero included", () => {
    // 0 of 10 resolved findings inside their window IS a measurement, and an empty track is
    // its picture. This is the one case that must NOT be refused.
    expect(meterPctFor(rateView(0, 10, "10 resolved"))).toBe(0);
    expect(meterPctFor(rateView(47.2, 36, "36 resolved"))).toBe(47.2);
    expect(meterPctFor(rateView(100, 15, "15 open"))).toBe(100);
  });

  it("refuses a rate with no population at all", () => {
    // `baseEmpty`: nothing has closed, so there is no resolved population to take a share of.
    const empty = rateView(null, 0, "0 resolved");
    expect(empty.baseEmpty).toBe(true);
    expect(meterPctFor(empty)).toBeNull();
  });

  it("refuses a rate the server never computed over a population that IS there", () => {
    const uncomputed = rateView(undefined, 12, "12 resolved");
    expect(uncomputed.baseEmpty).toBe(false);
    expect(uncomputed.measured).toBe(false);
    expect(meterPctFor(uncomputed)).toBeNull();
  });

  it("refuses nothing at all rather than throwing", () => {
    expect(meterPctFor(null)).toBeNull();
    expect(meterPctFor(undefined)).toBeNull();
    expect(meterPctFor({})).toBeNull();
  });

  // PERTURBATION. `ui/data.js`'s `meter()` opens with `Number(value) || 0`, so the tempting
  // one-liner at the call site — hand it `rate.value` and let the component sort it out —
  // paints a 0% track beside the words "not measured": a picture asserting that nothing is in
  // SLA, over a population nobody measured. Reproduced here so the failure is visible rather
  // than described.
  it("is not a vacuous guard — the cast-through rewrite paints a confident zero", () => {
    const meterFill = (v) => Number(v) || 0; // ui/data.js's own first line
    const empty = rateView(null, 0, "0 resolved");

    // The rewrite: pass the rate's value straight through.
    expect(meterFill(empty.value)).toBe(0);
    expect(Number.isFinite(meterFill(empty.value))).toBe(true);
    // The guard: no meter is built at all, so there is no track to read a zero off.
    expect(meterPctFor(empty)).toBeNull();

    // And it is not merely that null is falsy — every absent shape CLAUDE.md names does it.
    for (const absent of [null, undefined, "", [], false]) {
      expect(meterFill(absent), `meter(${JSON.stringify(absent)}) fills to`).toBe(0);
    }
  });

  it("the page hands the meter this decision and never the raw rate", () => {
    // Five call sites on this page: the four hero stat rows that carry a meter, and the SLA
    // table's two rate cells (through `rateMeter`). None of them may reach for `rate.value`.
    expect(MTTR_SRC).toMatch(/const pct = meterPctFor\(rate\);/);
    expect(MTTR_SRC).not.toMatch(/meter\(rate\.value/);
    expect((MTTR_SRC.match(/meterPctFor\(/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});

// =========================================================================================
//  2. slaEdgeLegend — five paragraphs as one line of the payload's own numbers
// =========================================================================================
//
// `test/mttrAging.test.js` exercises this against a real `agingView` result. What is held HERE
// is the one thing that cannot be seen from that side: that a target the payload never carried
// is refused before any cast, so the line can never read "null d" or "0 d" for a severity that
// simply has no deadline.

describe("slaEdgeLegend never prints a deadline nobody set", () => {
  it("says \"no target\" for every shape of absence, and never a number", () => {
    for (const absent of [null, undefined, "", [], false]) {
      const line = slaEdgeLegend([{ sev: "UNKNOWN", target: absent }]);
      expect(line, JSON.stringify(absent)).toBe("UNKNOWN no target");
      expect(line, JSON.stringify(absent)).not.toMatch(/null|undefined|NaN|0 d/);
    }
  });

  // PERTURBATION. The obvious form is `e.target ?? "no target"`, which only catches null and
  // undefined; `Number(e.target)` with a `|| ` fallback is worse still. Both print a deadline
  // for a severity that has none — and "UNKNOWN 0 d" is a claim that every UNKNOWN finding is
  // late the moment it is detected.
  it("is not a vacuous guard — the ?? and the cast-through forms each invent a deadline", () => {
    for (const absent of ["", [], false]) {
      // `??` passes a blank string, an empty array and `false` straight through.
      const nullish = absent ?? "no target";
      expect(String(nullish), JSON.stringify(absent)).not.toBe("no target");
      // The cast-through form turns every one of them into a confident zero.
      expect(Number(absent) || 0, JSON.stringify(absent)).toBe(0);
      // The guard refuses BEFORE the cast, through the same `num()` allowlist every figure in
      // this register goes through.
      expect(slaEdgeLegend([{ sev: "UNKNOWN", target: absent }])).toBe("UNKNOWN no target");
    }
  });
});

// =========================================================================================
//  3. halfLifeTrendPoints — one array, two pictures
// =========================================================================================

describe("halfLifeTrendPoints: the sparkline and the line chart read the SAME series", () => {
  const trends = {
    trend: [
      { date: "2026-06-01", km_median_days: 199 },
      { date: "2026-06-08", km_median_days: null },
      { date: "2026-06-15", km_median_days: 204 },
    ],
  };

  it("keeps every point that carries a date, gaps included", () => {
    const points = halfLifeTrendPoints(trends);
    expect(points).toHaveLength(3);
    // A NULL READING IS A GAP, NOT A ROW TO DROP. Dropping it here would compress time and get
    // the slope wrong in both pictures — `ui/sparkline.js`'s own rule, applied one level up,
    // where the array is chosen.
    expect(points[1].km_median_days).toBeNull();
  });

  it("drops a slot with no date, because the x axis IS the date", () => {
    const points = halfLifeTrendPoints({ trend: [{ km_median_days: 12 }, ...trends.trend] });
    expect(points).toHaveLength(3);
    expect(points.every((p) => p.date)).toBe(true);
  });

  it("answers an empty series for a payload that carries no trend at all", () => {
    expect(halfLifeTrendPoints(null)).toEqual([]);
    expect(halfLifeTrendPoints({})).toEqual([]);
    expect(halfLifeTrendPoints({ trend: "not an array" })).toEqual([]);
    // The state the page is genuinely in between its two RPCs: the summary has landed and the
    // trend has not. The aside draws its caption, not a line, and never throws.
    expect(halfLifeTrendPoints({ history: [], trend: [] })).toEqual([]);
  });

  // PERTURBATION. The point of hoisting this was that the aside and the chart cannot disagree.
  // Filtering independently in each renderer is what the page did before, and the two filters
  // drift the moment one of them gains a condition — here, the obvious "only plot what was
  // measured", which the sparkline would then draw over a compressed axis while the chart
  // below it kept the gaps.
  it("is not a vacuous guard — a second, tighter filter changes the picture's shape", () => {
    const measuredOnly = trends.trend.filter((p) => p && p.date && p.km_median_days !== null);
    expect(measuredOnly).toHaveLength(2);
    expect(halfLifeTrendPoints(trends)).toHaveLength(3);
    // Two readings over three dates is a different slope from two readings over two.
    expect(measuredOnly.length).not.toBe(halfLifeTrendPoints(trends).length);
  });

  it("the page derives the series ONCE and hands it to the header", () => {
    // `renderHero` calls `trendAside(halfLifeTrendPoints(trends))` on the same `trends` object
    // `renderCharts` plots, rather than each filtering its own copy.
    expect(MTTR_SRC).toContain("trendAside(halfLifeTrendPoints(trends))");
    expect(MTTR_SRC).toContain("const values = list.map((p) => p.km_median_days);");
  });
});
