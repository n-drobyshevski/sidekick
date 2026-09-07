// SCAN HISTORY, WAVE C: the movement as a picture, the KPI band's three series, and one
// defect the picture found.
//
// WHAT IS ACTUALLY AT RISK HERE, and none of it is pixels:
//
//   1. A LATENT ReferenceError THAT ONLY A NON-EMPTY MOVEMENT COULD REACH. `CAUSE_COLUMNS`
//      was a `const` declared inside `renderHistory` BELOW the `try { paint(await promise) }`
//      that reads it, so the first paint hit it in its temporal dead zone. Every path into it
//      runs through `movementBlock`, which returns early when a register has no
//      decomposition — and that is the only state the dev seed can produce (its saved scans
//      span 14 days; the window is 28). On a tenant with a real movement the page threw out
//      of `paint`, the catch around the fetch swallowed it, and the WHOLE PAGE rendered
//      "Couldn't load scan history." — a fetch failure reported for a rendering bug. Measured
//      by shortening `MOVEMENT_WINDOW_DAYS` to 7 in a throwaway edit and loading the page.
//      The guard below is STRUCTURAL, not a check for that one name: any `const` declared in
//      that function after the await is the same defect with a different identifier.
//   2. THE TWO READINGS OF ONE PAYLOAD MUST REFUSE TOGETHER. `movementView` (the words) and
//      `movementBarsModel` (the picture) are drawn for the same register in the same block. A
//      payload one can read and the other cannot would print a chart under an empty-branch
//      notice, or an empty chart under a sentence. They share `readFigures`; this file proves
//      they agree on every shape that refusal was written for.
//   3. A SPARKLINE THAT PLOTS A MISSING SCAN ON THE FLOOR. `Number(null)` is 0 and it is
//      finite (CLAUDE.md, three times); the KPI band's `tracked` series is a SUM of two
//      fields, which is where a half-missing point becomes a half-total that looks like a
//      measurement.
//
// The Chart.js config is inspected the way `test/charts.test.js` and
// `test/capacityChart.test.js` inspect every other wrapper — `chart.js` mocked with a
// stand-in that records the `(canvas, config)` pair — because there is no jsdom here and the
// claims are about the config a renderer would consume, not about a rendering.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { movementBarsModel, movementView } from "../src/client/js/pages/historyModel.js";
import {
  kmMedianPoints, kmSparkCaption, kpiSparkSeries, sparkCaption,
} from "../src/client/js/pages/history.js";
import { sparkPath } from "../../gas_shared/ui/sparkline.js";

const HISTORY_SRC = readFileSync(
  new URL("../src/client/js/pages/history.js", import.meta.url), "utf8",
);
const BUNDLE_SRC = readFileSync(
  new URL("../src/client/js/chartsBundle.js", import.meta.url), "utf8",
);

const state = vi.hoisted(() => ({ calls: [] }));

vi.mock("chart.js", () => {
  class FakeChart {
    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      state.calls.push(config);
    }
    destroy() {}
    static register() {}
    static getChart() { return undefined; }
  }
  const component = () => {};
  return {
    Chart: FakeChart,
    ArcElement: component,
    BarController: component,
    BarElement: component,
    CategoryScale: component,
    Filler: component,
    Legend: component,
    LinearScale: component,
    LineController: component,
    LineElement: component,
    PieController: component,
    PointElement: component,
    Tooltip: component,
  };
});

function fakeCanvas() {
  return {
    setAttribute(name, value) { this[name] = value; },
    getContext: () => null,
    closest: () => null,
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

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

/** Where the zero rule lands in the fake plot below. */
const ZERO_X = 300;

/**
 * Run a `zeroReferenceLine` plugin against a plot with a known geometry, and report where its
 * label was actually painted. The plugin draws a filled box then the text, so the box's x is
 * the placement — which is the whole of what is being checked, and the only thing a "is the
 * plugin in the list" assertion cannot see.
 */
function runZeroRule(plugin) {
  let box = null;
  let text = null;
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText: (t) => ({ width: t.length * 6 }),
    fillRect: (x) => { box = x; },
    fillText: (t) => { text = t; },
  };
  plugin.afterDatasetsDraw({
    ctx,
    scales: { x: { getPixelForValue: () => ZERO_X } },
    chartArea: { top: 100, bottom: 300, left: 40, right: 560 },
  });
  return { x: box, text };
}

/** The balanced window from test/movementDecomposition.test.ts, as shipped — the same fixture
 *  test/historyModel.test.js pins the SENTENCE against, so the picture and the words below are
 *  read off one payload rather than off two that were tuned separately. */
const BALANCED = {
  scope: "sca",
  arrivals: 1, observed: 1, bounded: 1, reopened: 0,
  outsideGate: 1, netChange: -1, measured: 1, administrative: 1,
  unattributed: 0, identityGap: 0, identityHolds: true,
  scansInWindow: 2, skippedScans: 0, partialCounts: 0, unplacedRows: 0,
};

/** The shape the dev harness actually produced once the window was short enough to reach one:
 *  30 arrivals, nothing closed by observation, 40 dated gone by absence. Two of the three
 *  registers here have no resolved state to fetch at all, so this — not BALANCED — is the
 *  normal case, and it is the one where the measured half is the empty one. */
const SEEDED_SCA = {
  scope: "sca",
  arrivals: 30, observed: 0, bounded: 40, reopened: 0,
  outsideGate: 0, netChange: -10, measured: 0, administrative: 40,
  unattributed: 0, identityGap: 0, identityHolds: true,
  scansInWindow: 2, skippedScans: 0, partialCounts: 0, unplacedRows: 0,
};

// =========================================================================================
//  The model: four causes, signed once
// =========================================================================================

describe("movementBarsModel turns six figures into one signed series", () => {
  it("puts arrivals and returns above the line and the two resolutions below it", () => {
    const m = movementBarsModel(SEEDED_SCA);
    expect(m.rows.map((r) => r.cause)).toEqual([
      "Arrivals", "Returned", "Closed by observation", "Dated gone by absence",
    ]);
    expect(m.rows.map((r) => r.value)).toEqual([30, 0, 0, -40]);
    // THE MAGNITUDE IS NOT THE EFFECT. "40 findings" is what the row is about; −40 is what it
    // did to the open count, and the table behind the chart publishes both columns.
    expect(m.rows.map((r) => r.count)).toEqual([30, 0, 0, 40]);
  });

  it("names which half every row belongs to, in words, on the row itself", () => {
    const halves = movementBarsModel(SEEDED_SCA).rows.map((r) => r.half);
    expect(halves).toEqual(["Added", "Added", "Measured remediation", "Administrative"]);
  });

  it("keeps the administrative row's provenance verbatim — an upper bound, not a date", () => {
    const rows = movementBarsModel(SEEDED_SCA).rows;
    expect(rows[3].basis).toMatch(/upper bound on the date, not a measurement/);
    // ...and the measured one says the opposite thing, in the words movementView already used.
    expect(rows[2].basis).toBe("the API reported the finding resolved");
  });

  it("direct-labels the net and states both halves in the headline the card prints", () => {
    expect(movementBarsModel(SEEDED_SCA).headline)
      .toBe("Open moved −10 · measured remediation 0 · administrative 40");
    expect(movementBarsModel(SEEDED_SCA).net).toBe(-10);
    // A gaining register signs the other way, and 0 stays bare — `signed`'s rule.
    expect(movementBarsModel({ ...SEEDED_SCA, netChange: 4 }).headline).toContain("Open moved +4");
    expect(movementBarsModel({ ...SEEDED_SCA, netChange: 0 }).headline).toContain("Open moved 0");
  });

  it("never emits a negative zero, so a table cell reads 0 rather than -0", () => {
    const m = movementBarsModel({ ...SEEDED_SCA, observed: 0, bounded: 0 });
    for (const r of m.rows) expect(Object.is(r.value, -0), `${r.cause} is -0`).toBe(false);
  });
});

describe("the picture and the words refuse the same payloads (rule 2 above)", () => {
  it("both read the balanced window", () => {
    expect(movementView(BALANCED, null).empty).toBeUndefined();
    expect(movementBarsModel(BALANCED)).not.toBeNull();
  });

  it("both refuse a payload with a figure that was never a number", () => {
    // `Number(null)` is 0 and it is finite; every one of these would otherwise draw a bar at
    // the origin inside a chart about a window nobody decomposed.
    for (const bad of [null, "", [], false, undefined, NaN, {}]) {
      const one = movementView({ ...BALANCED, netChange: bad }, "note");
      const other = movementBarsModel({ ...BALANCED, netChange: bad });
      expect(one.empty, `netChange ${JSON.stringify(bad)}`).toBe("note");
      expect(other, `netChange ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("both refuse a payload that predates the figure entirely", () => {
    for (const payload of [null, undefined, "", 0, {}, { arrivals: 1 }]) {
      expect(movementView(payload, "note").empty, JSON.stringify(payload)).toBe("note");
      expect(movementBarsModel(payload), JSON.stringify(payload)).toBeNull();
    }
  });

  /**
   * PERTURBATION, reproduced inline: the tempting rewrite is for the picture to refuse on its
   * OWN, shorter, list — it only needs four of the five figures to draw four bars, so
   * `netChange` looks droppable. It is not: the net is the rule's label and the sentence's
   * last clause, and a model that read four figures where the words read five would draw a
   * chart under an empty-branch notice on exactly the payload the refusal exists for.
   */
  it("a four-figure allowlist would draw a chart the words had already refused", () => {
    const missingNet = { ...BALANCED, netChange: null };
    const defective = ["arrivals", "observed", "bounded", "reopened"]
      .every((k) => Number.isFinite(missingNet[k]));
    expect(defective, "the four-figure list would have accepted it").toBe(true);
    expect(movementView(missingNet, "note").empty).toBe("note");
    expect(movementBarsModel(missingNet), "the five-figure list refuses it").toBeNull();
  });
});

// =========================================================================================
//  The chart
// =========================================================================================

async function draw(rows, opts) {
  const charts = await loadCharts();
  const canvas = fakeCanvas();
  charts.movementBars(canvas, rows, opts || {});
  return { cfg: state.calls[state.calls.length - 1], canvas, charts };
}

describe("movementBars draws the four causes about a zero line", () => {
  it("is one dataset of signed values, labelled by cause, in the model's order", async () => {
    const m = movementBarsModel(SEEDED_SCA);
    const { cfg } = await draw(m.rows, { net: m.net });
    expect(cfg.type).toBe("bar");
    expect(cfg.options.indexAxis).toBe("y");
    expect(cfg.data.labels).toEqual([
      "Arrivals", "Returned", "Closed by observation", "Dated gone by absence",
    ]);
    expect(cfg.data.datasets).toHaveLength(1);
    expect(cfg.data.datasets[0].data).toEqual([30, 0, 0, -40]);
    // No zero floor on the value axis: it would clip every negative bar, which is the half of
    // this chart that is remediation.
    expect(cfg.options.scales.x.beginAtZero).toBeUndefined();
  });

  it("prints the CAUSE on the category axis, never the row's index", async () => {
    // THE DEFECT THIS PINS, measured in the browser before the override went in: `baseOptions`
    // gives the y axis `callback: localeNum`, which is right for the value axis every other
    // wrapper puts there and wrong the moment `indexAxis: "y"` makes it a category scale —
    // Chart.js hands a category tick its INDEX, so the four bars were labelled 0, 1, 2, 3 and
    // the vocabulary that IS the picture was nowhere on the canvas.
    const m = movementBarsModel(SEEDED_SCA);
    const { cfg } = await draw(m.rows, { net: m.net });
    const tick = cfg.options.scales.y.ticks.callback;
    expect(typeof tick).toBe("function");
    expect([0, 1, 2, 3].map((i) => tick(i, i))).toEqual([
      "Arrivals", "Returned", "Closed by observation", "Dated gone by absence",
    ]);
    // An index the model has no row for falls back to the value rather than throwing.
    expect(tick(9, 9)).toBe(9);
  });

  it("colours by the row's own sign, so a bar cannot keep the other side's fill", async () => {
    const m = movementBarsModel(SEEDED_SCA);
    const { cfg, charts } = await draw(m.rows, { net: m.net });
    const fills = cfg.data.datasets[0].backgroundColor;
    expect(Array.isArray(fills)).toBe(true);
    expect(fills[0]).toBe(fills[1]); // both additions
    expect(fills[3]).not.toBe(fills[0]); // the removal
    // The removals take this register's accent INK, never the fill-only accent.
    expect(fills[3]).toBe(charts.ACCENT);
    expect(charts.ACCENT).not.toBe("#ffcb13");
  });

  it("labels the zero rule with the net, on the far side of the top bar", async () => {
    // MEASURED IN THE BROWSER FIRST: drawn on `zeroReferenceLine`'s default side, the label
    // sat on top of the arrivals bar — which is the first row by construction, since
    // `movementBarsModel` orders the additions first. So the placement is exercised here, not
    // just the plugin's presence: a check that the plugin is in the list passes against the
    // defect it was added to fix.
    const m = movementBarsModel(SEEDED_SCA);
    const { cfg } = await draw(m.rows, { net: m.net });
    expect(cfg.plugins.map((pl) => pl.id))
      .toEqual(["zeroReferenceLine", "divergingBarLabels"]);
    const drawn = runZeroRule(cfg.plugins[0]);
    expect(drawn.text).toBe("net -10");
    // The top bar grows RIGHT (arrivals is positive), so the label is left of the rule.
    expect(drawn.x, "the net label was drawn over the top bar").toBeLessThan(ZERO_X);
  });

  it("takes the other side when the top bar grows the other way", async () => {
    const rows = movementBarsModel(SEEDED_SCA).rows.map((r) => ({ ...r, value: -r.value || 0 }));
    const { cfg } = await draw(rows, { net: 10 });
    const drawn = runZeroRule(cfg.plugins[0]);
    expect(drawn.x).toBeGreaterThan(ZERO_X);
  });

  it("says nothing about a net it was not given, rather than labelling the rule 0", async () => {
    const m = movementBarsModel(SEEDED_SCA);
    const { canvas } = await draw(m.rows, {});
    expect(canvas["aria-label"]).not.toContain("Net");
  });

  it("draws nothing rather than throwing when there are no rows", async () => {
    const charts = await loadCharts();
    const canvas = fakeCanvas();
    expect(() => charts.movementBars(canvas, [], {})).not.toThrow();
    expect(() => charts.movementBars(canvas, null, {})).not.toThrow();
    expect(state.calls[state.calls.length - 1].data.labels).toEqual([]);
    expect(canvas["aria-label"]).toContain("none");
  });
});

describe("the chart's text alternative carries every figure and every direction", () => {
  it("states each cause with its signed effect, and the net", async () => {
    const m = movementBarsModel(SEEDED_SCA);
    const { canvas } = await draw(m.rows, { net: m.net, subject: "Dependencies (SCA) — what moved the open count" });
    expect(canvas.role).toBe("img");
    const label = canvas["aria-label"];
    expect(label).toContain("Dependencies (SCA) — what moved the open count");
    expect(label).toContain("Arrivals +30");
    expect(label).toContain("Dated gone by absence -40");
    expect(label).toContain("Net -10");
  });

  it("names the row's own provenance in the hover card, not just its size", async () => {
    const m = movementBarsModel(SEEDED_SCA);
    const { cfg } = await draw(m.rows, { net: m.net });
    expect(cfg.options.plugins.tooltip.enabled).toBe(false);
    expect(cfg.options.plugins.tooltip.callbacks.label({ dataIndex: 3 }))
      .toContain("upper bound on the date, not a measurement");
    expect(cfg.options.plugins.tooltip.callbacks.label({ dataIndex: 9 })).toBe("");
  });

  it("builds a two-key legend rather than inheriting the first row's fill", async () => {
    // `monthlyCapacityBars`'s finding, applied here: Chart.js reads `backgroundColor[0]` for a
    // per-bar fill, so the one key it generates is whichever colour row 0 happens to take.
    const m = movementBarsModel(SEEDED_SCA);
    const { cfg } = await draw(m.rows, { net: m.net });
    const labels = cfg.options.plugins.legend.labels.generateLabels();
    expect(labels.map((l) => l.text)).toEqual(["Added to the open count", "Removed from it"]);
    expect(() => cfg.options.plugins.legend.onClick()).not.toThrow();
  });

  it("is reachable from the charts bundle, which is a second list that can rot", () => {
    // A wrapper missing from chartsBundle.js builds, ships, and throws "not a function" inside
    // chartCard's catch — reaching the browser as "Chart unavailable in this deployment" with
    // nothing in the console. That is how monthlyCapacityBars failed on its first run.
    expect(BUNDLE_SRC.match(/movementBars/g) || []).toHaveLength(2);
  });
});

describe("the page hands the chart and its figures table the SAME array", () => {
  it("names one `rows` binding and passes it to both", () => {
    expect(HISTORY_SRC).toMatch(/const rows = bars\.rows;/);
    expect(HISTORY_SRC).toMatch(/api\.movementBars\(canvas, rows, \{/);
    const from = HISTORY_SRC.indexOf("const rows = bars.rows;");
    expect(from).toBeGreaterThan(-1);
    // Shorthand, and that is the point: the binding handed to the wrapper is the identical
    // reference handed to the table, in the same statement — not a second walk over the model.
    const model = HISTORY_SRC.slice(HISTORY_SRC.indexOf("model: chartTableModel({", from));
    expect(model.slice(0, 120)).toMatch(/columns: CAUSE_COLUMNS, rows \}/);
  });

  it("keeps every column the two cause tables used to publish, plus the signed effect", () => {
    // A chart replacing two tables may not quietly drop what they said. "Cause" and "Findings"
    // are theirs verbatim; "How it was counted" is the renamed "How the date was arrived at"
    // (two of the four rows are not resolutions and have no date to arrive at); "Which half"
    // is what the two SEPARATE TABLES used to say by being separate.
    for (const label of [
      "Cause", "Which half", "Effect on the open count", "Findings", "How it was counted",
    ]) {
      expect(HISTORY_SRC, `the movement table lost its ${label} column`)
        .toContain('label: "' + label + '"');
    }
  });
});

// =========================================================================================
//  The defect the picture found
// =========================================================================================

describe("failure of presence: renderHistory declares no const the first paint can outrun", () => {
  it("has no `const` inside renderHistory below the awaited first paint", () => {
    const fn = HISTORY_SRC.slice(HISTORY_SRC.indexOf("export async function renderHistory("));
    const after = fn.slice(fn.indexOf("paint(await promise);"));
    const hits = [...after.matchAll(/^ {2}const ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    expect(
      hits,
      "a const declared in renderHistory after the await is in its temporal dead zone when "
      + "paint runs, and every reader of it is a function paint reaches: "
      + hits.join(", "),
    ).toEqual([]);
  });

  it("is not a vacuous sweep — the pattern finds the declaration that was there", () => {
    // The exact shape that shipped, at the exact indent renderHistory's own body uses.
    const shipped = "    paint(await promise);\n  } catch (e) {\n  }\n\n"
      + "  const CAUSE_COLUMNS = [\n  ];\n";
    const after = shipped.slice(shipped.indexOf("paint(await promise);"));
    expect([...after.matchAll(/^ {2}const ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]))
      .toEqual(["CAUSE_COLUMNS"]);
  });

  it("and CAUSE_COLUMNS is at module scope, where nothing can reach it early", () => {
    expect(HISTORY_SRC).toMatch(/^const CAUSE_COLUMNS = \[/m);
  });
});

// =========================================================================================
//  The KPI band's four series
// =========================================================================================

const TREND = [
  { date: "2026-01-01", open: 10, resolved: 0, km_median_days: null },
  { date: "2026-01-02", open: 8, resolved: 2, km_median_days: 4 },
  { date: "2026-01-03", open: 6, resolved: 4, km_median_days: 5 },
];

describe("kpiSparkSeries: absent is never zero, and a gap keeps its place", () => {
  it("reads the four series off the payload's own points, in order", () => {
    const s = kpiSparkSeries(TREND);
    expect(s.open).toEqual([10, 8, 6]);
    expect(s.resolved).toEqual([0, 2, 4]);
    // The half-life line, gap included: the first date's curve never reached half, and
    // `trend.withKmMedian` already shipped that as `km_median_days: null`.
    expect(s.kmMedian).toEqual([null, 4, 5]);
    // tracked = open + resolved: the rows first seen by that date, which is exactly what the
    // "Tracked (all-time)" card counts — and on the dev seed the last point (416 + 138) lands
    // on the card's own 554.
    expect(s.tracked).toEqual([10, 10, 10]);
  });

  it("refuses a point BY TYPE before any cast, on either half of the sum", () => {
    for (const bad of [null, undefined, "", [], false, "n/a", {}]) {
      const withBadOpen = kpiSparkSeries([{ open: bad, resolved: 2 }]);
      const withBadResolved = kpiSparkSeries([{ open: 2, resolved: bad }]);
      expect(withBadOpen.open, `open ${JSON.stringify(bad)}`).toEqual([null]);
      expect(withBadOpen.tracked, `tracked from open ${JSON.stringify(bad)}`).toEqual([null]);
      expect(withBadResolved.tracked, `tracked from resolved ${JSON.stringify(bad)}`)
        .toEqual([null]);
    }
  });

  it("keeps a measured zero, which is a reading and not a gap", () => {
    expect(kpiSparkSeries([{ open: 0, resolved: 0 }]).tracked).toEqual([0]);
    expect(kpiSparkSeries([{ open: 0, resolved: 0 }]).open).toEqual([0]);
  });

  /**
   * PERTURBATION, reproduced inline the way `contracts/relativeAge.js` does it: the tempting
   * one-liner is `Number(p.open) + Number(p.resolved)`. `Number(null)` is 0 AND finite, so a
   * scan that never recorded one half is plotted as a HALF-TOTAL — a point on the line that
   * looks exactly like a measurement, half the height of its neighbours, dragging the whole
   * series' scale with it.
   */
  it("the cast-first sum would plot a half-measured point as a real one", () => {
    const half = [{ open: 400, resolved: null }];
    const defective = half.map((p) => Number(p.open) + Number(p.resolved));
    expect(defective).toEqual([400]); // ...and 400 is a plausible tracked count
    expect(Number.isFinite(defective[0])).toBe(true);
    expect(kpiSparkSeries(half).tracked).toEqual([null]); // the gap the picture must show
  });

  it("survives a payload with no trend at all", () => {
    for (const bad of [null, undefined, "", 0, {}]) {
      expect(kpiSparkSeries(bad).open, JSON.stringify(bad)).toEqual([]);
      expect(kpiSparkSeries(bad).kmMedian, JSON.stringify(bad)).toEqual([]);
    }
  });

  /**
   * A SKIPPED DATE IS A GAP HERE AND A DROPPED POINT AT THE FOOT OF THE PAGE, and the two
   * pictures differ on purpose. `kmMedianPoints` FILTERS `km_median_days: null` because the
   * Chart.js line plots against a real date axis and can simply not draw those dates. A
   * sparkline has only slots: filtering there would compress 208 dates into 3 and draw a
   * slope over an interval nothing measured. So the same masked series goes two ways, and
   * this is the case that says which is which.
   */
  it("keeps the skipped dates as slots, where the dated chart drops them", () => {
    const s = kpiSparkSeries(TREND);
    expect(s.kmMedian).toHaveLength(3);
    expect(sparkPath(s.kmMedian).gaps).toBe(1);
    expect(kmMedianPoints(TREND).map((p) => p.y)).toEqual([4, 5]); // the dated line, filtered
  });

  it("refuses a half-life reading BY TYPE before any cast — a gap, never a 0-day half-life", () => {
    for (const bad of [null, undefined, "", [], false, "n/a", {}]) {
      expect(kpiSparkSeries([{ km_median_days: bad }]).kmMedian, JSON.stringify(bad))
        .toEqual([null]);
    }
    // The cast-first rewrite this refuses, reproduced: `Number(null)` is 0 and it is finite,
    // so every skipped date would plot as a register that remediates half its findings the
    // day it finds them — the flattering direction, and 205 of 208 points on the dev seed.
    expect([null, 4].map((v) => Number(v))).toEqual([0, 4]);
    expect(Number.isFinite(Number(null))).toBe(true);
  });
});

describe("the half-life sparkline names the instant it was read at", () => {
  /**
   * THE FIGURE AND THE LINE ARE NOT THE SAME INSTANT. The card above is `kpis.km`, fitted at
   * REQUEST TIME over every visible row; each reading on the line is fitted as of a saved
   * scan, replaying `awaitingFixAsOf` for that date, with any date whose curve never reached
   * half dropped. On the dev seed the card says "at least 297 days" and the line is flat at
   * 199. Without the anchor that gap reads as an arithmetic error rather than as two
   * different measurements, which is the whole reason this function exists rather than the
   * card just calling `sparkCaption`.
   */
  it("appends the anchor to a measured series", () => {
    expect(kmSparkCaption(sparkPath([199, 199, 199])))
      .toBe("3 readings, flat at 199 days — as of each saved scan");
  });

  it("formats in days, matching the tile above it — not the bare counts the other three take", () => {
    // `fmtDays` is the prose/tile duration format; `fmtCount` (sparkCaption's default) would
    // print "41 to 12" over a card reading "41 days".
    expect(kmSparkCaption(sparkPath([41, 12]))).toBe("2 readings, 41 days to 12 days — as of each saved scan");
  });

  it("names the gaps, so 205 unmeasured dates cannot read as a flat line", () => {
    expect(kmSparkCaption(sparkPath([null, null, 4, 5])))
      .toBe("2 of 4 readings measured, 4 days to 5 days — as of each saved scan");
  });

  it("dates nothing when nothing was read — an anchor on an empty series is a scan that never happened", () => {
    expect(kmSparkCaption(sparkPath([]))).toBe("Not measured");
    expect(kmSparkCaption(sparkPath([null, null]))).toBe("Not measured");
    expect(kmSparkCaption(null)).toBe("Not measured");
  });

  it("one reading is still anchored — it is a reading, and it came from a scan", () => {
    expect(kmSparkCaption(sparkPath([199]))).toBe("One reading, 199 days — as of each saved scan");
  });

  /**
   * PERTURBATION, reproduced inline the way `contracts/relativeAge.js` does it: a caption
   * that is just `sparkCaption(model, fmtDays)`. Every assertion about readings, gaps and
   * range still passes; what is lost is the one sentence that keeps a reader from reading
   * "at least 297 days" over a line flat at 199 as a contradiction.
   */
  it("a caption without the anchor would say nothing false and still leave the gap unexplained", () => {
    const model = sparkPath([199, 199, 199]);
    const withoutAnchor = sparkCaption(model, (d) => `${d} days`);
    expect(withoutAnchor).toBe("3 readings, flat at 199 days");
    expect(kmSparkCaption(model)).not.toBe(withoutAnchor);
    expect(kmSparkCaption(model)).toMatch(/as of each saved scan$/);
  });

  it("and the card actually passes it — the DOM half read as text", () => {
    expect(HISTORY_SRC).toMatch(/caption: kmSparkCaption/);
    expect(HISTORY_SRC).toMatch(/series\.kmMedian/);
  });
});

describe("sparkCaption says what the picture left out", () => {
  it("counts the readings and names the range on a measured series", () => {
    expect(sparkCaption(sparkPath([10, 8, 6]))).toBe("3 readings, 10 to 6");
  });

  it("names the gaps rather than letting the empty part read as flat", () => {
    // The dev seed's own shape on the KM line: 3 of 208 dates carry a half-life, because the
    // curve does not reach half on any earlier one.
    const model = sparkPath([null, null, 4, 5]);
    expect(sparkCaption(model)).toBe("2 of 4 readings measured, 4 to 5");
  });

  it("says a flat series is flat rather than printing one endpoint twice", () => {
    expect(sparkCaption(sparkPath([41, 41, 41]))).toBe("3 readings, flat at 41");
  });

  it("refuses to describe a shape nothing measured", () => {
    expect(sparkCaption(sparkPath([]))).toBe("Not measured");
    expect(sparkCaption(sparkPath([null, null]))).toBe("Not measured");
    expect(sparkCaption(null)).toBe("Not measured");
    expect(sparkCaption(sparkPath([7]))).toBe("One reading, 7");
  });

  it("pluralizes one reading rather than reading '1 readings'", () => {
    // Reachable through the gap branch: one measured slot beside one that was not.
    expect(sparkCaption(sparkPath([7, null]))).toBe("One reading, 7");
  });
});

// =========================================================================================
//  The four fates, where they were applied
// =========================================================================================

describe("the page's words ride one level down, and its honesty statements do not", () => {
  it("the section note is the movement label's tip lines, not a paragraph", () => {
    expect(HISTORY_SRC).not.toMatch(/class: "section-note"/);
    const label = HISTORY_SRC.slice(HISTORY_SRC.indexOf('sectionLabel("What moved the number"'));
    expect(label.slice(0, 900)).toMatch(/term: "movement"/);
    expect(label.slice(0, 900)).toMatch(/The window is per register/);
  });

  it("the saved-scan denominator is on the heading AND in data-denominator (R3)", () => {
    const fn = HISTORY_SRC.slice(HISTORY_SRC.indexOf("function scansHeading("));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/three rows per sync, one /);
    expect(body).toMatch(/heading\.setAttribute\("data-denominator", denominator\)/);
    // The COUNTS stay on the surface: a table without its own row count cannot be checked.
    expect(HISTORY_SRC).toMatch(/scan \$\{pluralize\(sorted\.length, "row"\)\} across/);
  });

  it("keeps every honesty statement on the surface", () => {
    // Each of these is a KEEP: a task constraint or a statement about what was not measured.
    // A tip is where a reader settles a word, never where a refusal to measure is filed.
    for (const claim of [
      "Watching since",                       // when the observation window opens
      "could not be placed",                  // the spiral's unplaced rows
      "unplaced, not zero",                   // ...and what that is not
      "covered fewer than all three",         // the partial-sweep line
      "is not published on this page",        // the series this page does not carry
      '"Experimental"',                       // the spiral is unfinished and says so
    ]) {
      expect(HISTORY_SRC, `"${claim}" left the surface`).toContain(claim);
    }
    // The movement's two: printed from the model, verbatim, and only when non-zero.
    expect(HISTORY_SRC).toMatch(/block\.view\.sentences\.slice\(1\)/);
    expect(movementView({ ...BALANCED, identityGap: 2 }, null).sentences.join(" "))
      .toMatch(/do not balance by \+2 — that gap is published, not hidden/);
    expect(movementView(BALANCED, null).sentences.join(" "))
      .toMatch(/open finding sits outside the current gate and was not measured/);
  });

  it("draws no severity axis and spends no fill-only accent (gates 4 and 7)", () => {
    expect(HISTORY_SRC).not.toContain("#ffcb13");
    expect(HISTORY_SRC).not.toMatch(/var\(--accent\)/);
  });
});
