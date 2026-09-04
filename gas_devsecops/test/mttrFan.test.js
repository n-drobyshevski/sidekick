// THE FAN OF SURVIVAL CURVES ON `#/mttr`, AND WHAT HAS TO BE TRUE OF EACH CARD.
//
// `test/pagesProgram.test.js` already owns `mttrSeverityRows` — the SUMMARY table under the
// fan — and this package may not edit it, so the fan's own view model is held here instead.
// The two are deliberately separate assertions over the same estimate: the table is three
// statistics per severity, the fan is the staircase those three were read off, and
// `test/kmPerSev.test.ts` is what holds the server end of "one estimate, two views".
//
// WHY A PURE VIEW MODEL AT ALL. This project's vitest run sets no `environment` (no jsdom,
// no `document`), so everything that can be WRONG about a card has to live outside the DOM
// half: which severities get a card, in what order, and what each card's caption SAYS. The
// caption is the load-bearing half — see the colour note below.
//
// COLOUR IS NEVER THE CUE. Six curves in one grid is where "severity never carries meaning by
// colour alone" (PRODUCT.md, Accessibility) bites hardest: the red/orange/amber band sits 1.6
// apart under deuteranopia. Each card therefore carries the severity badge (dot + word) and a
// caption that states the half-life in words, and it is the CAPTION this file pins, because a
// caption that silently became "—" would leave the colour doing the work alone.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { severityCurvesView } from "../src/client/js/pages/mttr.js";

// A bare-bones `chart.js` stand-in that records every `new Chart(canvas, config)` pair, so the
// fan's marker LABELS can be read off the config the way Chart.js would consume it. Same shape
// as `test/charts.test.js`'s harness (a protected file this package may not edit, hence a
// second copy rather than a shared import); `mttr.js` reaches Chart.js only through the lazy
// `chartsLoader`, so the static import above is unaffected by this mock.
const state = vi.hoisted(() => ({ calls: [] }));
vi.mock("chart.js", () => {
  class FakeChart {
    constructor(canvas, config) { state.calls.push(config); }
    destroy() {}
    static register() {}
    static getChart() { return undefined; }
  }
  const component = () => {};
  return {
    Chart: FakeChart, ArcElement: component, BarController: component, BarElement: component,
    CategoryScale: component, Filler: component, Legend: component, LinearScale: component,
    LineController: component, LineElement: component, PieController: component,
    PointElement: component, Tooltip: component,
  };
});
function fakeCanvas() {
  return {
    setAttribute() {}, getContext: () => null, closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
}
async function loadCharts() {
  vi.resetModules();
  state.calls = [];
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.document = {
    createElement: () => ({ getContext: () => null, setAttribute() {}, style: {} }),
  };
  return import("../src/client/js/charts.js");
}

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

const SRC = readFileSync(new URL("../src/client/js/pages/mttr.js", import.meta.url), "utf8");

/** A shipKM-narrowed curve, the shape `readModels.ts::shipKM` puts on the wire. */
function km(over) {
  return {
    curve: [{ t: 1, s: 0.9 }, { t: 7, s: 0.6 }, { t: 30, s: 0.4 }],
    median: 12,
    medianLowerBound: null,
    p90: 44,
    mean: 15,
    meanTruncated: false,
    restrictionTime: 30,
    events: 6,
    censored: 4,
    total: 10,
    ...over,
  };
}

// CRITICAL crosses half; HIGH never does (bound only); LOW is measured but slow. MEDIUM, INFO
// and UNKNOWN are absent from the payload entirely — the server only emits a severity that had
// rows, and this is the case that proves the view does not invent a card for the other three.
const REMEDIATION = {
  kmPerSev: {
    CRITICAL: km({ median: 5, medianLowerBound: null, events: 3, censored: 1, total: 4 }),
    HIGH: km({ median: null, medianLowerBound: 68, events: 1, censored: 3, total: 4 }),
    LOW: km({ median: 41, medianLowerBound: null, events: 2, censored: 0, total: 2 }),
  },
  kmMedianPerSev: { CRITICAL: 5, HIGH: null, LOW: 41 },
  kmLowerBoundPerSev: { CRITICAL: null, HIGH: 68, LOW: null },
};

describe("severityCurvesView — one card per severity that has a curve", () => {
  it("emits a card only for the severities the payload actually carries", () => {
    const cards = severityCurvesView(REMEDIATION, SEVERITIES);
    expect(cards.map((c) => c.sev)).toEqual(["CRITICAL", "HIGH", "LOW"]);
  });

  it("keeps severity order rather than the payload's key order", () => {
    // A payload whose keys arrived worst-last still draws worst-first: the fan is read as a
    // sequence, and a grid that ordered itself by whatever the server serialised would put
    // LOW at the top on one load and CRITICAL on the next.
    const shuffled = {
      kmPerSev: {
        LOW: REMEDIATION.kmPerSev.LOW,
        CRITICAL: REMEDIATION.kmPerSev.CRITICAL,
        HIGH: REMEDIATION.kmPerSev.HIGH,
      },
    };
    expect(severityCurvesView(shuffled, SEVERITIES).map((c) => c.sev))
      .toEqual(["CRITICAL", "HIGH", "LOW"]);
  });

  it("the caption says 'at least N' where the median is null and only a bound is real", () => {
    const cards = severityCurvesView(REMEDIATION, SEVERITIES);
    const high = cards.find((c) => c.sev === "HIGH");
    expect(high.caption).toContain("at least 68 days");
    expect(high.half.isLowerBound).toBe(true);
    // And the measured cases do NOT get the prefix — "at least 5 days" would be a weaker
    // claim than the one the estimator actually made.
    const crit = cards.find((c) => c.sev === "CRITICAL");
    expect(crit.caption).toContain("5 days");
    expect(crit.caption).not.toContain("at least");
    expect(crit.half.isLowerBound).toBe(false);
  });

  it("the caption prints the censoring split, so a card is never a curve with no denominator", () => {
    const high = severityCurvesView(REMEDIATION, SEVERITIES).find((c) => c.sev === "HIGH");
    expect(high.caption).toContain("1 event,");
    expect(high.caption).toContain("3 censored");
    const crit = severityCurvesView(REMEDIATION, SEVERITIES).find((c) => c.sev === "CRITICAL");
    expect(crit.caption).toContain("3 events,");
  });

  it("says 'not measured' rather than printing an em dash where neither number exists", () => {
    // PRODUCT.md's corollary, on a card: never a zero, and never a dash, that means unknown.
    const cards = severityCurvesView({
      kmPerSev: { INFO: km({ median: null, medianLowerBound: null, events: 0, censored: 5, total: 5 }) },
    }, SEVERITIES);
    expect(cards).toHaveLength(1);
    expect(cards[0].caption).toContain("not measured");
    expect(cards[0].caption).not.toContain("—");
    expect(cards[0].half.measured).toBe(false);
  });

  it("skips a severity whose curve has no steps rather than drawing an empty axis", () => {
    // An axis with no staircase asserts "measured, and flat"; the severity simply had nothing
    // to plot. The stat maps still list it, which is why the filter reads the CURVE.
    const cards = severityCurvesView({
      kmPerSev: {
        CRITICAL: km({ curve: [] }),
        HIGH: km({ curve: null }),
        LOW: REMEDIATION.kmPerSev.LOW,
      },
      kmMedianPerSev: { CRITICAL: null, HIGH: null, LOW: 41 },
    }, SEVERITIES);
    expect(cards.map((c) => c.sev)).toEqual(["LOW"]);
  });

  it("hands on the SAME curve reference the chart is drawn from", () => {
    // ui/chartTable.js's one rule: the table and the canvas are built from one array, named
    // once. A view model that copied or re-derived the points would be the first place the
    // two could disagree.
    const cards = severityCurvesView(REMEDIATION, SEVERITIES);
    expect(cards[0].curve).toBe(REMEDIATION.kmPerSev.CRITICAL.curve);
  });

  it("degrades to no cards at all on an absent payload", () => {
    expect(severityCurvesView(null, SEVERITIES)).toEqual([]);
    expect(severityCurvesView({}, SEVERITIES)).toEqual([]);
    expect(severityCurvesView({ kmPerSev: {} }, SEVERITIES)).toEqual([]);
  });
});

// =========================================================================================
//  The fan's own source shape
// =========================================================================================

describe("the fan is wired the way the rest of the page's charts are", () => {
  // PERTURBATION (run 2026-09-04, then reverted): the `chartTable({...})` call inside the fan's
  // card builder in src/client/js/pages/mttr.js was replaced with `null` — five canvases with
  // no keyboard route and no figures behind them. Observed, in the PROTECTED
  // test/chartTable.test.js rather than here, which is why that file is the one that holds the
  // rule and this file only restates the wiring:
  //
  //   FAIL  test/chartTable.test.js > every chart canvas ships a data-table alternative >
  //         each page builds exactly one chartTable per canvas
  //     AssertionError: mttr.js builds 3 canvas(es) and 2 chartTable(s):
  //     expected 2 to be 3 // Object.is equality
  //
  //   Test Files  1 failed (1) ; Tests  2 failed | 15 passed (17)
  //
  // The second failure in that run is the register-wide canvas COUNT (`expected 9 to be 8`),
  // which this package cannot fix without editing a protected file — see the handback.
  it("draws its cards with the shared survivalCurve wrapper, in a severity colour", () => {
    expect(SRC).toContain("charts.survivalCurve(");
    // The severity palette is READ off the stylesheet (sevPalette), never retyped here —
    // CLAUDE.md: the severity palette is byte-identical across all four surfaces.
    expect(SRC).toContain("sevPalette");
    expect(SRC).toMatch(/color:\s*palette\.colors\[/);
  });

  it("never spends the fill-only accent as a chart series", () => {
    // DESIGN.md's Split-Accent Rule: #ffcb13 is 1.52:1 and cannot carry a 2px line. Restated
    // here because THIS package added six new series to the page.
    expect(SRC).not.toContain("#ffcb13");
  });

  it("labels every card with the severity badge, so colour is never the only cue", () => {
    expect(SRC).toContain("sevBadge(card.sev)");
  });

  it("names the severity in the card's marker legend, never \"all\"", async () => {
    // MEASURED, 2026-09-04 on `#/mttr` at the dev seed: every one of the five cards drew a
    // legend reading "Mean (KM · RMST, all)". On a per-severity small multiple that word is
    // false — the diamond on the CRITICAL card is CRITICAL's own restricted mean over 25
    // findings, not the register's over 554 — and a legend that misnames its own population is
    // exactly the failure PRODUCT.md's sixth principle exists to stop: a figure that does not
    // say what it measured over.
    const charts = await loadCharts();
    charts.survivalCurve(
      fakeCanvas(),
      [{ t: 1, s: 0.9 }, { t: 30, s: 0.5 }],
      { median: 12, mean: 20 },
      { color: "#dc2626", subject: "for CRITICAL findings", scope: "CRITICAL" },
    );
    const cfg = state.calls[state.calls.length - 1];
    const labels = cfg.data.datasets.slice(1).map((d) => d.label);
    expect(labels).toEqual(["Median (KM, CRITICAL)", "Mean (KM · RMST, CRITICAL)"]);
    for (const l of labels) expect(l).not.toContain("all");
    // The staircase takes the severity fill; the markers stay accent ink whatever the line is.
    expect(cfg.data.datasets[0].borderColor).toBe("#dc2626");
    expect(cfg.data.datasets[1].backgroundColor).toBe(charts.ACCENT);
  });

  it("leaves the OVERALL curve's labels byte-identical when no scope is named", async () => {
    // The register-wide curve above the fan, and the one on `#/secrets`, are estimated over
    // all findings and must keep saying so. `test/charts.test.js` pins "Median (KM, all)"
    // directly; this is the same claim from the other side of the change.
    const charts = await loadCharts();
    charts.survivalCurve(fakeCanvas(), [{ t: 1, s: 0.9 }], {
      naiveMedian: 5, median: 6, naiveMean: 8, mean: 9,
    });
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.data.datasets.slice(1).map((d) => d.label)).toEqual([
      "Median (closed)", "Median (KM, all)", "Mean (closed)", "Mean (KM · RMST, all)",
    ]);
  });

  it("never rewrites the closed-only markers, whose parenthetical is a method not a population", async () => {
    // PERTURBATION (run 2026-09-04, then reverted): `scopeSuffix: "all)"` was added to the two
    // naive markers as well, on the reasoning that every label should name its severity.
    // Observed: the closed-only markers came back as "Median (CRITICAL)" / "Mean (CRITICAL)",
    // which deletes the one word telling a reader they are the naive, closed-only statistics
    // sitting beside the Kaplan-Meier ones. Failure:
    //
    //   FAIL  test/mttrFan.test.js > ... > never rewrites the closed-only markers, whose
    //         parenthetical is a method not a population
    //     AssertionError: expected [ 'Median (CRITICAL)', …(3) ] to deeply equal
    //     [ 'Median (closed)', …(3) ]     -"Median (closed)"  +"Median (CRITICAL)"
    //
    //   Test Files  1 failed (1) ; Tests  1 failed | 14 passed (15)
    const charts = await loadCharts();
    charts.survivalCurve(
      fakeCanvas(),
      [{ t: 1, s: 0.9 }],
      { naiveMedian: 5, median: 6, naiveMean: 8, mean: 9 },
      { scope: "CRITICAL" },
    );
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.data.datasets.slice(1).map((d) => d.label)).toEqual([
      "Median (closed)", "Median (KM, CRITICAL)", "Mean (closed)", "Mean (KM · RMST, CRITICAL)",
    ]);
  });

  it("the module header no longer claims the per-severity curve is absent", () => {
    // The defect this package closed: the page said, in prose, that the payload carried no
    // per-severity curve — and it was right until `kmPerSev` shipped.
    expect(SRC).not.toMatch(/there is no per-severity `curve` in the/);
    expect(SRC).toContain("THE PER-SEVERITY CURVES ARE ON THE WIRE");
  });
});
