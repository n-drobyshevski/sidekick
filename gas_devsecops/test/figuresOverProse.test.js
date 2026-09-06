// The pure half of the four figures Wave A took OUT of sentences.
//
// Wave A's claim is that the front door and the clock page carry the same facts with far
// fewer words: five severity tiles became one bar, five counts inside a sentence became one
// `axisBar`, six SLA-edge paragraphs became one legend line, and two rates that were prose
// became `statRow`s with meters. Every one of those swaps moved a DECISION out of a paragraph
// and into a model — and a decision inside a picture is the kind that a screenshot review
// passes and a reader is misled by. This file holds the four decisions.
//
// NO DOM (vitest.config.ts sets no `environment`), which is the house style here and is why
// each of these four is a pure function on the page module rather than a fragment of a render
// closure. Where a claim is about what the page DRAWS rather than what it decides, it is
// asserted against the page's source text, the way `pagesLit.test.js` and `mttrAging.test.js`
// already do.
//
// EVERY GUARD BELOW IS PERTURBED. CLAUDE.md: "a guard that fires on nothing is a finding, not
// a pass" — so each `describe` reproduces the tempting rewrite INLINE and shows it giving the
// wrong answer on the same input, rather than asserting the rule from a comment.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fixNextView } from "../src/client/js/pages/executive.js";
import {
  VENDOR_WAIT_VALUES, halfLifeTrendPoints, meterPctFor, rateView, slaEdgeLegend,
  vendorWaitReading,
} from "../src/client/js/pages/mttr.js";

const MTTR_SRC = readFileSync(
  new URL("../src/client/js/pages/mttr.js", import.meta.url), "utf8",
);
const EXEC_SRC = readFileSync(
  new URL("../src/client/js/pages/executive.js", import.meta.url), "utf8",
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

  // PERTURBATION. `ui/data.js`'s meter() opens with `Number(value) || 0`, so the tempting
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
    // Three call sites: the two hero stat rows and the SLA table's two rate cells (through
    // `rateMeter`). None of them may reach for `rate.value` directly.
    expect(MTTR_SRC).toMatch(/const pct = meterPctFor\(rate\);/);
    expect(MTTR_SRC).not.toMatch(/meter\(rate\.value/);
    expect((MTTR_SRC.match(/meterPctFor\(/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});

// =========================================================================================
//  2. slaEdgeLegend — six paragraphs as one line of the payload's own numbers
// =========================================================================================

describe("slaEdgeLegend: the deadlines come from the payload, and a missing one says so", () => {
  const edges = [
    { sev: "CRITICAL", target: 7, bucket: 0, exact: true },
    { sev: "HIGH", target: 14, bucket: 1, exact: false },
    { sev: "MEDIUM", target: 30, bucket: 1, exact: true },
    { sev: "LOW", target: 90, bucket: 2, exact: true },
    { sev: "INFO", target: 180, bucket: 3, exact: false },
  ];

  it("prints every severity in the order the bars are stacked, with its own target", () => {
    expect(slaEdgeLegend(edges)).toBe(
      "CRITICAL 7 d · HIGH 14 d · MEDIUM 30 d · LOW 90 d · INFO 180 d",
    );
  });

  it("follows an edited deadline rather than a literal", () => {
    // Settings writes SLA_TARGETS; `agingView` reads them out of the payload. A legend that
    // hard-coded 7/14/30/90/180 would be a second place for them to drift, silently.
    const moved = slaEdgeLegend([{ sev: "CRITICAL", target: 3 }, { sev: "HIGH", target: 21 }]);
    expect(moved).toBe("CRITICAL 3 d · HIGH 21 d");
    expect(moved).not.toContain("7 d");
  });

  it("says \"no target\" for a severity with no deadline, and never \"null d\"", () => {
    const line = slaEdgeLegend([
      { sev: "CRITICAL", target: 7 }, { sev: "UNKNOWN", target: null },
    ]);
    expect(line).toBe("CRITICAL 7 d · UNKNOWN no target");
    expect(line).not.toMatch(/null|undefined|NaN/);
    // No target is exactly WHY that severity has no edge — dropping the row would delete the
    // finding rather than report it.
    expect(line).toContain("UNKNOWN");
  });

  it("draws no legend at all where there are no bars", () => {
    expect(slaEdgeLegend([])).toBeNull();
    expect(slaEdgeLegend(null)).toBeNull();
    expect(slaEdgeLegend(undefined)).toBeNull();
  });

  // PERTURBATION. The one-line version — `e.sev + " " + e.target + " d"` — is what anyone
  // writing this fresh would type, and it renders a severity with no deadline as "UNKNOWN
  // null d": a deadline of null days, which is a figure rather than an absence.
  it("is not a vacuous guard — the cast-through rewrite prints a null deadline", () => {
    const naive = (list) => list.map((e) => e.sev + " " + e.target + " d").join(" · ");
    const withGap = [{ sev: "CRITICAL", target: 7 }, { sev: "UNKNOWN", target: null }];
    expect(naive(withGap)).toContain("UNKNOWN null d");
    expect(slaEdgeLegend(withGap)).not.toContain("null");

    // `Number(null)` is 0, so the other tempting rewrite is worse: a zero-day deadline.
    const cast = (list) => list.map((e) => e.sev + " " + Number(e.target) + " d").join(" · ");
    expect(cast(withGap)).toContain("UNKNOWN 0 d");
  });

  it("the six per-severity sentences are gone from the page", () => {
    // What was there: one `<li>` per severity, each ~22 words, differing only in a name and a
    // number. `agingView.edges[].sentence` is still on the MODEL (nothing asserts it here —
    // `test/mttrAging.test.js` owns it) but no longer on the surface.
    expect(MTTR_SRC).not.toMatch(/vm\.edges\.map\(\(e\) => el\("li"/);
    expect(MTTR_SRC).toMatch(/slaEdgeLegend\(vm\.edges\)/);
  });
});

// =========================================================================================
//  3. vendorWaitReading — five counts in a sentence become one bar
// =========================================================================================

describe("vendorWaitReading: the bar partitions the population exactly once", () => {
  const segments = {
    events: 240, zeroAtOrigin: 32, censored: 112, closedBeforeFix: 48, unmeasured: 7,
  };

  it("names four values and totals them, and nothing else", () => {
    const r = vendorWaitReading(segments);
    expect(r.values).toEqual(VENDOR_WAIT_VALUES);
    expect(r.counts).toEqual({
      "Fix observed": 240,
      "Open, no fix": 112,
      "Closed before a fix": 48,
      "No readable origin": 7,
    });
    expect(r.total).toBe(240 + 112 + 48 + 7);
  });

  it("keeps zeroAtOrigin OUT of the bar, because it is a subset of the fixes observed", () => {
    const r = vendorWaitReading(segments);
    expect(Object.values(r.counts)).not.toContain(32);
    // The shares are taken against `total`, so the sum of the four is exactly the population.
    const summed = Object.values(r.counts).reduce((a, b) => a + b, 0);
    expect(summed).toBe(r.total);
  });

  it("hatches the unmeasured value and only that one", () => {
    const r = vendorWaitReading(segments);
    expect(Object.keys(r.unknowns)).toEqual(["No readable origin"]);
    expect(r.unknowns["No readable origin"]).toBe(7);
    // The whole of that value is unestablished, so the segment hatches end to end.
    expect(r.unknowns["No readable origin"]).toBe(r.counts["No readable origin"]);
  });

  it("declares a zero it was sent, and a zero for a field the server never sent", () => {
    const partial = vendorWaitReading({ events: 5 });
    expect(partial.counts["Open, no fix"]).toBe(0);
    expect(partial.total).toBe(5);
    // The whole block missing is still four zeros rather than a throw: `actionableClockView`
    // decides whether to draw it at all, and it only calls this with `view.segments` present.
    expect(vendorWaitReading(null).total).toBe(0);
    expect(vendorWaitReading(undefined).counts["Fix observed"]).toBe(0);
  });

  // PERTURBATION. "Available at detection" reads like a fifth outcome and the plan for this
  // wave listed it as one — it is not: it is a subset of `events`, and adding it as a segment
  // counts 32 rows twice, inflates the denominator every share is read against, and leaves the
  // four real segments summing to less than the bar.
  it("is not a vacuous guard — zeroAtOrigin as a fifth segment double-counts", () => {
    const r = vendorWaitReading(segments);
    const withSubset = { ...r.counts, "Available at detection": segments.zeroAtOrigin };
    const inflated = Object.values(withSubset).reduce((a, b) => a + b, 0);

    expect(inflated).toBe(r.total + 32);
    expect(inflated).not.toBe(r.total);
    // And the visible cost: "Fix observed" would read 60.5% of the population instead of 62.3%
    // while 32 of the rows it counts are drawn a second time beside it.
    expect(r.counts["Fix observed"] / r.total).not.toBeCloseTo(
      r.counts["Fix observed"] / inflated, 5,
    );
  });

  // PERTURBATION 2. `Number(undefined)` is 0 and finite, so a cast-first reading cannot tell
  // "the server sent no `unmeasured` field" from "the server measured zero" — but here BOTH
  // are drawn as an absent hatch, so the guard that matters is the opposite one: a non-numeric
  // value must not become a count. `num(v, 0)` refuses by type before the cast.
  it("is not a vacuous guard — a non-numeric segment is not a count", () => {
    const cast = (v) => Number(v) || 0;
    expect(cast(["3"])).toBe(3); // Number(["3"]) is 3 — a one-element array reads as a count
    const weird = vendorWaitReading({ events: ["3"], censored: 4 });
    expect(weird.counts["Fix observed"]).toBe(0);
    expect(weird.total).toBe(4);
  });

  it("the page hands axisSegments this reading and builds no second copy of it", () => {
    expect(MTTR_SRC).toMatch(/const reading = vendorWaitReading\(s\);/);
    expect(MTTR_SRC).toMatch(/bar\.paint\(axisSegments\(reading, reading\.values\)\)/);
    // The 50-word sentence it replaced named all five counts in a row.
    expect(MTTR_SRC).not.toContain("The vendor-wait population divides as:");
  });
});

// =========================================================================================
//  4. halfLifeTrendPoints — one array, two pictures
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
    // A NULL READING IS A GAP, NOT A ROW TO DROP. Dropping it here would compress time and
    // get the slope wrong in both pictures — `ui/sparkline.js`'s own rule, applied one level
    // up, where the array is chosen.
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

  it("the page derives it ONCE and hands the same array to both renderers", () => {
    expect(MTTR_SRC).toMatch(/const trendPoints = halfLifeTrendPoints\(payload && payload\.trends\)/);
    expect(MTTR_SRC).toMatch(/renderHero\(mttr, first, trendPoints\)/);
    expect(MTTR_SRC).toMatch(/renderTrend\(trendPoints\)/);
    // And neither renderer re-derives it: two occurrences only — the declaration and the
    // one call in `paint`.
    expect((MTTR_SRC.match(/halfLifeTrendPoints\(/g) || []).length).toBe(2);
  });
});

// =========================================================================================
//  5. The front door's ranked line — the short form, and what it must not replace
// =========================================================================================

describe("fixNextView.rankedShort: the two numbers on the surface", () => {
  const payload = (over) => ({
    mttr: { rowCount: 554, overall: { resolved: 138, open: 416 }, remediation: {} },
    fixNext: {
      groups: [], ranked: 47, openTotal: 416, limit: 8,
      unranked: { noFix: 40, unvalidated: 99, insideSla: 12, other: 218 },
      ...over,
    },
  });

  it("states the ranked count and the population it came out of", () => {
    const view = fixNextView(payload(), { latestSync: {} });
    expect(view.rankedShort).toBe("47 of 416 open findings ranked");
  });

  it("keeps the full accounting on the model for the disclosure under it", () => {
    const view = fixNextView(payload(), { latestSync: {} });
    // A list captioned "top 8" and nothing else has quietly deleted the rest of the backlog —
    // which is why the sentence survives the compression, one level down rather than gone.
    expect(view.unrankedSentence).toContain("47 of 416 open findings are ranked above");
    expect(view.unrankedSentence).toContain("40 awaiting a vendor fix");
    expect(view.unrankedSentence).toContain("12 still inside their SLA window");
  });

  it("agrees with the sentence it summarises, on every payload", () => {
    // The failure this catches is the two drifting: a short line computed from one field and
    // a sentence from another would let the surface and the disclosure state different totals.
    for (const over of [
      { ranked: 0, openTotal: 416 },
      { ranked: 1, openTotal: 1 },
      { ranked: 8, openTotal: 12 },
    ]) {
      const view = fixNextView(payload(over), { latestSync: {} });
      expect(view.unrankedSentence.startsWith(
        view.rankedShort.replace(/ ranked$/, " are ranked above"),
      ), `"${view.rankedShort}" does not lead "${view.unrankedSentence}"`).toBe(true);
    }
  });

  it("singularises with the population, not with the ranked count", () => {
    const one = fixNextView(payload({ ranked: 0, openTotal: 1 }), { latestSync: {} });
    expect(one.rankedShort).toBe("0 of 1 open finding ranked");
  });

  it("the page draws the short line and files the sentence behind a disclosure", () => {
    expect(EXEC_SRC).toMatch(/view\.rankedShort/);
    expect(EXEC_SRC).toMatch(/disclosure\(\s*\n?\s*"Why the rest are not ranked"/);
    // The 23-word link caveat is off the surface entirely — the field stays for
    // test/executiveFixNext.test.js, which is where the claim belongs.
    expect(EXEC_SRC).toMatch(/linkNote:/);
    expect(EXEC_SRC).not.toMatch(/append\(el\("p", \{ class: "small muted" \}, view\.linkNote\)\)/);
  });
});

// =========================================================================================
//  6. What may not leave the surface (R2)
// =========================================================================================
//
// The risk this whole wave carries is a tip becoming the ONLY carrier of an honesty
// statement. These are the specific words this pass moved prose around, checked against the
// page source rather than against a screenshot.

describe("the honesty statements stayed on the page, not in a tip", () => {
  it("the front door still prints \"at least\" and \"Not measured\" as the hero's value", () => {
    // Both come from `kmHalfLifeView`, which executive.js imports rather than restating —
    // the value is the surface and the tip only explains it.
    expect(EXEC_SRC).toMatch(/kmHalfLifeView/);
    expect(MTTR_SRC).toMatch(/value: "at least " \+ fmtDays\(bound\)/);
    expect(MTTR_SRC).toMatch(/value: "Not measured"/);
  });

  // THE CLAIM, AND THE DRAFT IT REPLACED. Both heroes first routed the label's tip to
  // `lower-bound` whenever the value was a bound and to `half-life` otherwise — the term
  // moving with the state. Reviewed and reversed: the trigger sits on the words "Remediation
  // half-life", so the entry Enter navigates to is that figure's own definition on every
  // paint. A definition is a control (DESIGN.md), and a control whose destination changes
  // with this week's data is one a reader cannot learn. The state-specific sentence LEADS the
  // lines instead, which is `figureCard`'s own shape for a denominator.
  //
  // `lower-bound` is NOT orphaned by this: it stays in the book, `helpContent.test.js` still
  // holds its id, and the Key sheet lists every entry.
  it("both heroes route their label's tip to the figure's own term, in every state", () => {
    for (const [name, src] of [["executive", EXEC_SRC], ["mttr", MTTR_SRC]]) {
      const fn = src.slice(src.indexOf("function heroHelp("));
      const body = fn.slice(0, fn.indexOf("\n  }\n"));
      expect(body, `${name}'s heroHelp is not in the file`).toBeTruthy();
      expect(
        /term: "lower-bound"/.test(body),
        `${name}'s hero label routes to lower-bound on a bound — the label says "Remediation `
        + "half-life\", so its term is half-life whatever the value reads",
      ).toBe(false);
      // Every branch that returns a help shape names the one term.
      const terms = [...body.matchAll(/term: "([a-z0-9-]+)"/g)].map((m) => m[1]);
      expect(terms.length, `${name}'s heroHelp returns no term at all`).toBeGreaterThan(0);
      expect(new Set(terms), `${name}'s heroHelp routes to more than one entry`)
        .toEqual(new Set(["half-life"]));
    }
  });

  it("the bound and not-measured sentences still LEAD the hero's tip lines", () => {
    // The term staying put is only correct because the specific reading is still said first —
    // otherwise a censored register's hero would offer a general definition and nothing about
    // the bound it is actually showing.
    expect(EXEC_SRC).toMatch(/The survival curve never falls to half within the observed/);
    expect(EXEC_SRC).toMatch(/This is “not measured”, not zero/);
    expect(MTTR_SRC).toMatch(/The curve never falls to half within the observed window/);
  });

  it("the aging chart still prints the undated count beside its denominator", () => {
    expect(MTTR_SRC).toMatch(/" · " \+ fmtCount\(vm\.unaged\) \+ " undated"/);
  });

  it("the awaiting-a-vendor row still prints the refused count", () => {
    expect(MTTR_SRC).toMatch(/fmtCount\(awaiting\.notApplicable\) \+ " refused"/);
  });

  it("the SLA-consumed section still prints what its bars left out", () => {
    // `slaConsumedCaption` names the rows past the window and the rows with no window; both
    // are populations the bars cannot show, so the caption is the only place either appears.
    expect(MTTR_SRC).toMatch(/slaConsumedCaption\(vm\.block\)/);
  });

  it("the fix-next cap is still a line on the page", () => {
    expect(EXEC_SRC).toMatch(/if \(view\.cutNote\) fixHost\.append/);
  });

  it("the vendor-wait bar still states the zero-length waits in words", () => {
    expect(MTTR_SRC).toMatch(/of the fixes observed were already available at/);
    expect(MTTR_SRC).toMatch(/a zero-length wait, not a missing one/);
  });
});
