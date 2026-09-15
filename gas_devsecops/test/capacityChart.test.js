// The capacity chart: the eight-column month table redrawn as two bars a month.
//
// WHAT IS ACTUALLY AT RISK HERE, and it is not the pixels. `charts.monthlyCapacityBars` makes
// three claims a screenshot cannot check:
//
//   1. A MONTH NOBODY WATCHED IS DRAWN DIFFERENTLY. `capacityView` marks a month `partial`
//      (still running) or `reconstructed` (it ended before this register started watching, so
//      its figures were rebuilt rather than observed) and sets `measured: false` for either.
//      Those bars take this design system's hatch — its one mark for "this part is not a
//      measurement" — and a flat fill on them would be the chart asserting eight
//      measurements nobody made. On the dev seed EVERY month is one of the two, so the
//      difference is invisible in a screenshot: both states look the same when only one is
//      present.
//   2. THE LEGEND SHOWS THE SERIES' OWN COLOUR, NOT THE FIRST MONTH'S FILL. Chart.js's
//      default `generateLabels` reads `backgroundColor[0]` when a dataset's fill is per-bar,
//      so a register whose OLDEST month happens to be reconstructed would show both series
//      keys hatched. Measured on this seed before the override went in: both keys hatched.
//   3. THE TEXT ALTERNATIVE CARRIES EVERY FIGURE AND EVERY MARK. `hatchPattern` degrades to
//      the flat colour where there is no 2d context (a headless run, a browser refusing
//      `createPattern`), so the hatch can never be the only carrier of "not observed".
//
// The Chart.js config is inspected the way `test/charts.test.js` inspects every other wrapper
// — `chart.js` mocked with a stand-in that records the `(canvas, config)` pair — with ONE
// addition this file needs and that one does not: a canvas whose `getContext("2d")` really
// answers `createPattern`, so a hatched fill is DISTINGUISHABLE from a flat one. With
// `charts.test.js`'s `getContext: () => null` fake, `hatchPattern` returns its argument and
// claim 1 above cannot be tested at all — the two states become the same string.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const CHARTS_SRC = readFileSync(new URL("../src/client/js/charts.js", import.meta.url), "utf8");
const PROGRAM_SRC = readFileSync(
  new URL("../src/client/js/pages/program.js", import.meta.url), "utf8",
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

/** A tile context that records nothing and refuses nothing — enough for hatchPattern's draw. */
function tileContext() {
  return {
    fillStyle: "", strokeStyle: "", lineWidth: 0,
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  };
}

/**
 * A canvas that can really mint a pattern, so `hatchPattern(canvas, "#71717a")` comes back as
 * an object rather than as the string it was handed. That difference is the whole of claim 1.
 */
function patternCanvas() {
  return {
    setAttribute(name, value) { this[name] = value; },
    getContext: () => ({ createPattern: (tile, repeat) => ({ hatchOf: repeat }) }),
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
}

async function loadCharts({ reducedMotion = false } = {}) {
  vi.resetModules();
  state.calls = [];
  globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };
  globalThis.document = {
    createElement: () => ({ getContext: () => tileContext(), setAttribute() {}, style: {} }),
  };
  return import("../src/client/js/charts.js");
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

/**
 * Four months in `capacityView(...).months` shape: two observed, one reconstructed, one
 * partial — so both unmeasured kinds and the measured kind are all present at once, which is
 * exactly what the dev seed cannot offer (there, all eight months are unmeasured).
 */
function months() {
  return [
    { month: "2026-01", openAtStart: 100, opened: 40, closed: 55, net: 15, verdict: "gaining", verdictLabel: "Gaining", marks: ["reconstructed"], measured: false, mmcr: { text: "55%" } },
    { month: "2026-02", openAtStart: 85, opened: 30, closed: 30, net: 0, verdict: "keeping-up", verdictLabel: "Keeping up", marks: [], measured: true, mmcr: { text: "35.3%" } },
    { month: "2026-03", openAtStart: 85, opened: 50, closed: 20, net: -30, verdict: "falling-behind", verdictLabel: "Falling behind", marks: [], measured: true, mmcr: { text: "23.5%" } },
    { month: "2026-04", openAtStart: 115, opened: 12, closed: 4, net: -8, verdict: "falling-behind", verdictLabel: "Falling behind", marks: ["partial"], measured: false, mmcr: { text: "3.5%" } },
  ];
}

async function draw(opts) {
  const charts = await loadCharts(opts);
  const canvas = patternCanvas();
  charts.monthlyCapacityBars(canvas, months(), {});
  return { cfg: state.calls[state.calls.length - 1], canvas, charts };
}

// =========================================================================================
//  The series
// =========================================================================================

describe("monthlyCapacityBars plots the two series the section compares", () => {
  it("is a grouped bar chart of arrivals against closures, one label per month", async () => {
    const { cfg } = await draw();
    expect(cfg.type).toBe("bar");
    expect(cfg.data.labels).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(cfg.data.datasets.map((d) => d.label)).toEqual(["Arrived", "Closed"]);
    expect(cfg.data.datasets[0].data).toEqual([40, 30, 50, 12]);
    expect(cfg.data.datasets[1].data).toEqual([55, 30, 20, 4]);
    // Neither axis is stacked: the question is arrivals AGAINST closures, and a stack would
    // draw their sum, which is not a quantity this page has any use for.
    expect(cfg.options.scales.x.stacked).toBeUndefined();
    expect(cfg.options.scales.y.stacked).toBeUndefined();
  });

  it("plots the rows it was handed, in order, with nothing filtered out", async () => {
    const { cfg } = await draw();
    expect(cfg.data.labels).toHaveLength(months().length);
    expect(cfg.data.datasets[0].data).toHaveLength(months().length);
  });

  it("draws nothing rather than throwing when there are no months", async () => {
    const charts = await loadCharts();
    const canvas = patternCanvas();
    expect(() => charts.monthlyCapacityBars(canvas, [], {})).not.toThrow();
    expect(() => charts.monthlyCapacityBars(canvas, null, {})).not.toThrow();
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.data.labels).toEqual([]);
  });
});

// =========================================================================================
//  Claim 1: a month nobody watched is hatched
// =========================================================================================

describe("an unobserved month is hatched, and only an unobserved one", () => {
  it("gives each bar its own fill, hatched exactly where measured is false", async () => {
    const { cfg } = await draw();
    for (const ds of cfg.data.datasets) {
      expect(Array.isArray(ds.backgroundColor), `${ds.label} has one fill for every month`)
        .toBe(true);
      expect(ds.backgroundColor).toHaveLength(4);
      // reconstructed, observed, observed, partial
      expect(typeof ds.backgroundColor[0]).toBe("object"); // hatched
      expect(typeof ds.backgroundColor[1]).toBe("string"); // flat
      expect(typeof ds.backgroundColor[2]).toBe("string");
      expect(typeof ds.backgroundColor[3]).toBe("object"); // hatched
      expect(ds.backgroundColor[0]).toEqual({ hatchOf: "repeat" });
      expect(ds.backgroundColor[3]).toEqual({ hatchOf: "repeat" });
    }
  });

  /**
   * PERTURBATION, reproduced inline rather than described: the tempting simplification is one
   * fill per SERIES —
   *
   *     backgroundColor: ARRIVED_FILL
   *
   * — which is what every other bar wrapper in this file does and what a reviewer would read
   * as tidier. It is also how eight rebuilt months come to look like eight measurements. The
   * two shapes are told apart by whether the fill is an array at all, so the case above is
   * the guard; this one shows the rewrite passing an "is it the right colour" check while
   * losing the only mark that says the month was not observed.
   */
  it("a per-series fill would satisfy a colour check and lose the mark entirely", async () => {
    const { cfg } = await draw();
    const perSeries = cfg.data.datasets[0].backgroundColor[1]; // the flat arrivals colour
    expect(typeof perSeries).toBe("string");
    // The defective shape: one string for the whole dataset.
    const defective = { backgroundColor: perSeries };
    expect(Array.isArray(defective.backgroundColor)).toBe(false);
    // Nothing about it can tell an observed month from a rebuilt one — which is the failure.
    const kinds = new Set(months().map((m) => m.measured));
    expect(kinds.size).toBe(2);
    expect(new Set([defective.backgroundColor]).size).toBe(1);
  });

  it("takes the closures in this register's accent INK, never the fill-only accent", async () => {
    const { cfg, charts } = await draw();
    expect(cfg.data.datasets[1].backgroundColor[1]).toBe(charts.ACCENT);
    expect(charts.ACCENT).not.toBe("#ffcb13");
    expect(cfg.data.datasets[0].backgroundColor[1]).not.toBe(charts.ACCENT);
  });
});

// =========================================================================================
//  Claim 2: the legend
// =========================================================================================

describe("the legend names three things, and the hatch is one of them", () => {
  it("builds its own labels rather than inheriting the first month's fill", async () => {
    const { cfg } = await draw();
    const labels = cfg.options.plugins.legend.labels.generateLabels();
    expect(labels.map((l) => l.text)).toEqual([
      "Arrived", "Closed", "Not observed — reconstructed or partial",
    ]);
    // The two series keys take the FLAT colour even though month 0 is hatched — the defect
    // this override exists for.
    expect(typeof labels[0].fillStyle).toBe("string");
    expect(typeof labels[1].fillStyle).toBe("string");
    expect(labels[1].fillStyle).toBe(cfg.data.datasets[1].backgroundColor[1]);
    // And the third key is the hatch itself, so the mark has a word beside it.
    expect(labels[2].fillStyle).toEqual({ hatchOf: "repeat" });
  });

  it("stands the legend's click handler down", async () => {
    const { cfg } = await draw();
    expect(typeof cfg.options.plugins.legend.onClick).toBe("function");
    expect(() => cfg.options.plugins.legend.onClick()).not.toThrow();
  });
});

// =========================================================================================
//  Claim 3: the text alternative
// =========================================================================================

describe("the text alternative carries every figure and every mark", () => {
  it("states each month's arrivals, closures and net", async () => {
    const { canvas } = await draw();
    const label = canvas["aria-label"];
    expect(canvas.role).toBe("img");
    expect(label).toContain("2026-02 30 arrived, 30 closed, net 0");
    expect(label).toContain("2026-03 50 arrived, 20 closed, net -30");
    // A gain is signed, so a reader is never left to infer the direction from the order.
    expect(label).toContain("net +15");
  });

  it("says in WORDS which months were not observed, and which mark each carries", async () => {
    const { canvas } = await draw();
    const label = canvas["aria-label"];
    expect(label).toContain("2026-01 (reconstructed, not observed)");
    expect(label).toContain("2026-04 (partial, not observed)");
    // …and never says it of a month that was.
    expect(label).not.toContain("2026-02 (");
    expect(label).not.toContain("2026-03 (");
  });

  it("says “none” rather than nothing for an empty series", async () => {
    const charts = await loadCharts();
    const canvas = patternCanvas();
    charts.monthlyCapacityBars(canvas, [], {});
    expect(canvas["aria-label"]).toContain("none");
  });
});

// =========================================================================================
//  The wrapper's house rules
// =========================================================================================

describe("it obeys the same rules every other wrapper in charts.js does", () => {
  it("honours prefers-reduced-motion, through baseOptions", async () => {
    const { cfg } = await draw({ reducedMotion: true });
    expect(cfg.options.animation).toBe(false);
    const on = await draw({ reducedMotion: false });
    expect(on.cfg.options.animation).toEqual({ duration: 300 });
  });

  it("direct-labels the net above each month's pair", async () => {
    const { cfg } = await draw();
    expect(cfg.plugins.map((p) => p.id)).toContain("netGroupLabels");
  });

  it("routes its tooltip through the app's one hover card, and names the mark in it", async () => {
    const { cfg } = await draw();
    expect(cfg.options.plugins.tooltip.enabled).toBe(false);
    const after = cfg.options.plugins.tooltip.callbacks.afterLabel({ dataIndex: 0 });
    expect(after).toContain("net +15");
    expect(after).toContain("rebuilt, not observed");
    expect(cfg.options.plugins.tooltip.callbacks.afterLabel({ dataIndex: 1 }))
      .not.toContain("not observed");
  });

  it("never spends the fill-only accent as a literal in charts.js", () => {
    expect(CHARTS_SRC).not.toMatch(/["']#ffcb13["']/);
  });
});

// =========================================================================================
//  The call site: one array, two readings
// =========================================================================================

describe("the page hands the chart and its table the SAME array", () => {
  it("names one `months` binding and passes it to both, in the same statement", () => {
    // `ui/chartTable.js`'s one rule, checked at the call site the way
    // `test/chartTable.test.js` checks the others: a table derived a second time from the
    // payload is how a chart and its "equivalent" table start disagreeing.
    expect(PROGRAM_SRC).toMatch(/const months = view\.months;/);
    expect(PROGRAM_SRC).toMatch(/api\.monthlyCapacityBars\(canvas, months, \{\}\)/);
    // From the binding, not from the first chartTableModel in the file — `capacityView` also
    // names a local `months` up in the view-model half, and the sensitivity section's own
    // table sits between the two.
    const from = PROGRAM_SRC.indexOf("const months = view.months;");
    expect(from).toBeGreaterThan(-1);
    const model = PROGRAM_SRC.slice(PROGRAM_SRC.indexOf("model: chartTableModel({", from));
    expect(model.slice(0, model.indexOf("}),"))).toMatch(/rows: months,/);
  });

  it("keeps every column the eight-column table used to publish", () => {
    // A chart replacing a table may not quietly drop what the table said. These are the
    // labels of the columns that were there before the change, verbatim.
    for (const label of [
      "Month", "Open at start", "Arrived", "Closed", "Net", "Close rate", "Verdict", "Measured",
    ]) {
      expect(PROGRAM_SRC, `the capacity table lost its ${label} column`)
        .toContain('label: "' + label + '"');
    }
  });

  it("is reachable from the charts bundle, which is a second list that can rot", () => {
    // `chartsBundle.js` re-exports charts.js onto a global by hand; a wrapper missing from
    // that list builds fine, ships fine and throws "not a function" at the call site — which
    // is what happened on this wrapper's first run, and reached the browser as "Chart
    // unavailable in this deployment" with no error anywhere.
    expect(BUNDLE_SRC.match(/monthlyCapacityBars/g) || []).toHaveLength(2);
  });
});
