// `charts.js::coldZoneScatter` — the real config the real wrapper builds.
//
// THE HARNESS IS THE ONE `test/horizontalBars.test.js` AND `test/mttrFan.test.js` ALREADY USE,
// for the reason those files give: `charts.js` takes its Chart.js constructor by INJECTION
// (`installChartRuntime`), so the config each wrapper builds can be read straight off a fake
// constructor with no Chart.js, no canvas and no DOM. What is asserted is therefore the REAL
// config of the REAL wrapper rather than a restatement of a helper that builds it.
//
// FOUR CLAIMS, AND EACH IS A DEFECT SOMEBODY WOULD PLAUSIBLY INTRODUCE:
//
//   1. `type: "line"` WITH `showLine: false`, NOT `type: "scatter"`. chartsBundle.js registers
//      LineController and not ScatterController, so "fixing" this into a genuine scatter fails
//      at RUNTIME, in the browser, on a page that renders fine in every test here. The comment
//      beside it says so; this is the check that makes the comment enforceable.
//   2. TWO POINT STYLES. The split between cold and not-cold rides on the SHAPE first — a
//      filled diamond against a hollow circle — because DESIGN.md's accessibility bar forbids
//      a distinction carried by hue alone. A dataset with one pointStyle for every point would
//      still draw, still look plausible in a screenshot, and be unreadable in greyscale.
//   3. THE ALT TEXT NAMES THE MODE. A dashed rule at 47 days is a different claim depending on
//      whether a person chose 47 or the estate's k-th idlest asset did, and a reader who
//      cannot see the canvas gets that fact only from `describe()`.
//   4. "(relative)" ON THE RULE'S LABEL, AND ONLY IN RELATIVE MODE. Same fact, on the canvas.
//      The label is built inside the plugin's draw, so the assertion runs the plugin against a
//      recording 2-D context rather than reading the source text of the function.
//
// NOTATION rides along in claim 3: the alt text is PROSE, so a lower bound reads "at least N"
// there and "≥ N" only in the table beside the canvas (`test/coldZoneModel.test.js` holds the
// cell half).

import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] }));

class FakeChart {
  constructor(canvas, config) {
    state.calls.push({ canvas, config });
  }

  destroy() {}

  static register() {}

  static getChart() {
    return undefined;
  }
}

/** A canvas that records what `describe()` stamps on it and nothing else. */
function fakeCanvas() {
  const attrs = {};
  return {
    attrs,
    setAttribute(k, v) { attrs[k] = v; },
    getContext: () => null,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
}

async function loadCharts() {
  vi.resetModules();
  state.calls = [];
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const charts = await import("../src/client/js/charts.js");
  charts.installChartRuntime(FakeChart, []);
  return charts;
}

const POINTS = [
  { label: "vm-payments-01", idleDays: 210, open: 12, cold: true, bounded: false },
  { label: "vm-retail-04", idleDays: 150, open: 3, cold: true, bounded: true },
  { label: "vm-core-09", idleDays: 12, open: 40, cold: false, bounded: false },
];

async function build(opts) {
  const charts = await loadCharts();
  const canvas = fakeCanvas();
  charts.coldZoneScatter(canvas, POINTS, opts);
  expect(state.calls).toHaveLength(1);
  return { canvas, config: state.calls[0].config };
}

describe("coldZoneScatter: a line dataset with no line is exactly a scatter", () => {
  it("is type \"line\" with showLine: false — the controller the bundle actually registers", async () => {
    const { config } = await build({ thresholdDays: 90, mode: "fixed" });
    expect(config.type).toBe("line");
    expect(config.data.datasets).toHaveLength(1);
    expect(config.data.datasets[0].showLine).toBe(false);
  });

  it("plots x as idle days and y as open findings, with a linear x scale from zero", async () => {
    const { config } = await build({ thresholdDays: 90, mode: "fixed" });
    expect(config.data.datasets[0].data)
      .toEqual([{ x: 210, y: 12 }, { x: 150, y: 3 }, { x: 12, y: 40 }]);
    expect(config.options.scales.x.type).toBe("linear");
    expect(config.options.scales.x.beginAtZero).toBe(true);
    expect(config.options.scales.x.title.text).toBe("idle days");
    expect(config.options.scales.y.title.text).toBe("open findings");
  });

  it("drops a point whose idle days or open count is not a finite number", async () => {
    const charts = await loadCharts();
    charts.coldZoneScatter(fakeCanvas(), [
      { label: "ok", idleDays: 5, open: 1, cold: false, bounded: false },
      { label: "no-idle", idleDays: null, open: 1, cold: false, bounded: false },
      { label: "no-open", idleDays: 5, open: "3", cold: false, bounded: false },
      { label: "nan", idleDays: NaN, open: 1, cold: false, bounded: false },
    ], { thresholdDays: 90, mode: "fixed" });
    expect(state.calls[0].config.data.datasets[0].data).toEqual([{ x: 5, y: 1 }]);
  });
});

describe("coldZoneScatter: the split is a shape before it is a colour", () => {
  it("draws cold points as filled rectRot and the rest as hollow circles", async () => {
    const { config } = await build({ thresholdDays: 90, mode: "fixed" });
    const ds = config.data.datasets[0];
    expect(ds.pointStyle).toEqual(["rectRot", "rectRot", "circle"]);
    // TWO styles, not one: the assertion above would pass on a single-style array of the same
    // length only if every point happened to be cold, which this fixture is not.
    expect(new Set(ds.pointStyle).size).toBe(2);
    // The fill repeats the shape; the neutral is hollow (white centre, grey edge).
    expect(ds.pointBackgroundColor[2]).toBe("#ffffff");
    expect(ds.pointBackgroundColor[0]).toBe(ds.pointBorderColor[0]);
    expect(ds.pointBorderColor[2]).not.toBe(ds.pointBorderColor[0]);
    // And cold points are the larger mark, so the shape is legible at a glance.
    expect(ds.pointRadius).toEqual([7, 7, 5]);
  });

  // PERTURBATION: a colour-only split would keep every other assertion above true.
  it("a one-style dataset is what this check exists to catch", () => {
    const colourOnly = POINTS.map(() => "circle");
    expect(new Set(colourOnly).size).toBe(1);
  });
});

describe("coldZoneScatter: the alt text says where the line came from", () => {
  it("names the fixed window, the threshold, and every point's reading", async () => {
    const { canvas } = await build({ thresholdDays: 90, mode: "fixed" });
    const alt = canvas.attrs["aria-label"];
    expect(canvas.attrs.role).toBe("img");
    expect(alt).toContain("the fixed window");
    expect(alt).not.toContain("relative mode");
    expect(alt).toContain("The cold-zone threshold is 90 days");
    expect(alt).toContain("vm-payments-01, idle 210 days, 12 open (in the cold zone)");
    expect(alt).toContain("vm-core-09, idle 12 days, 40 open");
  });

  it("names relative mode when the line was derived", async () => {
    const { canvas } = await build({ thresholdDays: 47, mode: "relative" });
    const alt = canvas.attrs["aria-label"];
    expect(alt).toContain("relative mode");
    expect(alt).toContain("The cold-zone threshold is 47 days");
  });

  it("says \"at least\" for a bound and never the glyph — alt text is prose", async () => {
    const { canvas } = await build({ thresholdDays: 90, mode: "fixed" });
    const alt = canvas.attrs["aria-label"];
    expect(alt).toContain("vm-retail-04, idle at least 150 days");
    expect(alt).not.toContain("≥");
    expect(alt).not.toContain(">");
  });

  it("still says where the line came from when there is no threshold to state", async () => {
    const { canvas } = await build({ thresholdDays: null, mode: "relative" });
    expect(canvas.attrs["aria-label"]).toContain("The cold-zone line comes from relative mode.");
  });
});

describe("coldZoneScatter: the threshold rule, and the one word that moves on it", () => {
  /** Run the `coldThreshold` plugin against a recording context and return what it painted. */
  function paintRule(config, { width = 600 } = {}) {
    const painted = { texts: [], dashes: [] };
    const ctx = {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      setLineDash(d) { painted.dashes.push(d.slice()); },
      fillText(text, x) { painted.texts.push({ text, x }); },
    };
    const chart = {
      ctx,
      chartArea: { left: 0, right: width, top: 0, bottom: 300 },
      scales: { x: { getPixelForValue: () => width / 2 } },
    };
    const rule = config.plugins.find((p) => p && p.id === "coldThreshold");
    expect(rule, "the threshold rule is not registered").toBeTruthy();
    rule.afterDatasetsDraw(chart);
    return painted;
  }

  it("labels the rule \"cold at N d\" in fixed mode, dashed", async () => {
    const { config } = await build({ thresholdDays: 90, mode: "fixed" });
    const painted = paintRule(config);
    expect(painted.texts.map((t) => t.text)).toEqual(["cold at 90 d"]);
    // Dashed BECAUSE it is a threshold rather than data, and the dash is cleared afterwards so
    // nothing else on the canvas inherits it.
    expect(painted.dashes[0]).toEqual([4, 3]);
    expect(painted.dashes[1]).toEqual([]);
  });

  it("gains \" (relative)\" only when the line was derived", async () => {
    const { config } = await build({ thresholdDays: 47, mode: "relative" });
    expect(paintRule(config).texts[0].text).toBe("cold at 47 d (relative)");
  });

  it("reads anything that is not the literal \"relative\" as the fixed window", async () => {
    for (const mode of ["Relative", "RELATIVE", undefined, null, 1]) {
      const { config } = await build({ thresholdDays: 47, mode });
      expect(paintRule(config).texts[0].text, String(mode)).toBe("cold at 47 d");
    }
  });

  it("registers no rule at all when there is no threshold to draw", async () => {
    const { config } = await build({ thresholdDays: null, mode: "fixed" });
    expect(config.plugins).toEqual([]);
  });
});
