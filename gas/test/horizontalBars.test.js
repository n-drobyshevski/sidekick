// THE CATEGORY AXIS ON A HORIZONTAL BAR CHART MUST CARRY THE CATEGORY'S NAME.
//
// `charts.js::baseOptions()` builds the y scale as the VALUE axis — `precision: 0`,
// `beginAtZero`, and `callback: localeNum`. Three charts flip that with `indexAxis: "y"`, which
// makes y the CATEGORY axis, and Chart.js hands a category scale's tick callback the tick's
// INDEX rather than its label. So `localeNum` formatted 0, 1, 2, 3, 4 and the category names
// never reached the axis.
//
// MEASURED on the dev harness at 2026-09-08, `#/mttr` → By domain, at the moment that section
// moved out of its drawer onto the page: five coloured bars against a y axis reading
// "0 1 2 3 4". The domain names were nowhere on the card, so the bars were identified by HUE
// ALONE — the one thing PRODUCT.md's accessibility bar and DESIGN.md's non-colour-signal rule
// forbid outright. It survived unseen because two of the three charts lived inside a drawer and
// the third (`severityBar`) is exported here but drawn by no page.
//
// THE HARNESS IS THE RECORDER `test/mttrFan.test.js` ALREADY USES, for the reason its own
// header gives: `charts.js` takes its Chart.js constructor by INJECTION
// (`installChartRuntime`), so the config each wrapper builds can be read straight off a fake
// constructor without Chart.js, a canvas, or a DOM. What is asserted is therefore the REAL
// config of the REAL wrapper, not a restatement of the helper that builds it.
//
// AND THE GUARD IS PERTURBED. CLAUDE.md: "a guard that fires on nothing is a finding, not a
// pass". Asserting `callback === undefined` alone would pass against a chart that had no labels
// at all, so each case also runs Chart.js's own category-scale contract — `getLabelForValue` is
// the fallback when there is no callback, and the callback receives the index when there is one
// — over the config as built, and then over the defective config rebuilt inline, showing the
// second one answering "0" where the first answers "Payments".

import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] }));

class FakeChart {
  constructor(canvas, config) {
    state.calls.push(config);
  }

  destroy() {}

  static register() {}

  static getChart() {
    return undefined;
  }
}

function fakeCanvas() {
  return {
    setAttribute() {},
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

/**
 * What Chart.js puts on a category tick, given a scale config and the tick's index.
 *
 * The contract this reproduces, from Chart.js 4's `Scale.prototype.generateTickLabels`: each
 * tick's label is `callback.call(scale, value, index, ticks)` where a CategoryScale's `value`
 * is the index, and the default callback for a category scale is `getLabelForValue`, which
 * returns `labels[index]`. So a callback that formats numbers replaces the name with its
 * position — which is the whole defect, expressed as the platform expresses it.
 */
function tickLabel(scaleY, labels, index) {
  const cb = scaleY.ticks && scaleY.ticks.callback;
  return cb ? cb(index, index, []) : labels[index];
}

/** `charts.js`'s own `localeNum`, reproduced — the callback `baseOptions` puts on the value
 *  axis, and the one the defective rewrite below puts back on the category axis. */
const localeNum = (v) => (typeof v === "number" ? v.toLocaleString() : String(v));

const GROUPS = [
  { label: "Payments", value: 41, resolved: 12, median: 41, color: "#2563eb" },
  { label: "Core banking", value: 22, resolved: 30, median: 22, color: "#0d9488" },
  { label: "Retail", value: 9, resolved: 4, median: 9, color: "#a16207" },
];

const IMPACT = [
  { label: "Payments", value: 1403, median: 41, resolved: 12, color: "#2563eb" },
  { label: "Core banking", value: -655, median: 22, resolved: 30, color: "#0d9488" },
  { label: "Retail", value: -328, median: 9, resolved: 4, color: "#a16207" },
];

const SEV_COUNTS = { CRITICAL: 12, HIGH: 40, MEDIUM: 7 };
const SEV_PALETTE = {
  order: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"],
  colors: { CRITICAL: "#b91c1c", HIGH: "#c2410c", MEDIUM: "#a16207" },
};

/** The three wrappers that flip to `indexAxis: "y"`, each with the labels it should draw. */
const CASES = [
  {
    name: "mttrContributionBars (the median lens)",
    draw: (charts, canvas) =>
      charts.mttrContributionBars(canvas, GROUPS, { overall: 20, subject: "Domain median MTTR" }),
    labels: ["Payments", "Core banking", "Retail"],
  },
  {
    name: "mttrImpactBars (the contribution lens)",
    draw: (charts, canvas) =>
      charts.mttrImpactBars(canvas, IMPACT, { subject: "Domain contribution to MTTR" }),
    labels: ["Payments", "Core banking", "Retail"],
  },
  {
    name: "severityBar",
    draw: (charts, canvas) => charts.severityBar(canvas, SEV_COUNTS, SEV_PALETTE, null),
    labels: ["CRITICAL", "HIGH", "MEDIUM"],
  },
];

describe("a horizontal bar chart names its bars on the axis, never by colour alone", () => {
  for (const c of CASES) {
    it(`${c.name}: the y axis renders the category name, not its index`, async () => {
      const charts = await loadCharts();
      c.draw(charts, fakeCanvas());
      expect(state.calls).toHaveLength(1);
      const [config] = state.calls;

      // The axes are flipped, and the labels are the categories.
      expect(config.options.indexAxis).toBe("y");
      expect(config.data.labels).toEqual(c.labels);

      // THE RULE: no numeric tick formatter survives on the category axis.
      expect(config.options.scales.y.ticks.callback).toBeUndefined();
      expect(config.options.scales.y.ticks.precision).toBeUndefined();

      // And what Chart.js would actually paint on each tick.
      const painted = c.labels.map((_, i) =>
        tickLabel(config.options.scales.y, config.data.labels, i));
      expect(painted).toEqual(c.labels);
    });

    // PERTURBATION. The defect as it shipped: `baseOptions`'s value-axis callback left in place
    // after the flip. Rebuilt inline on the config the wrapper just produced, so the input is
    // identical and only the one key differs — and every bar loses its name.
    it(`${c.name}: is not a vacuous guard — the value-axis callback renders indices`, async () => {
      const charts = await loadCharts();
      c.draw(charts, fakeCanvas());
      const [config] = state.calls;

      const defective = {
        ...config.options.scales.y,
        ticks: { ...config.options.scales.y.ticks, precision: 0, callback: localeNum },
      };
      const painted = c.labels.map((_, i) => tickLabel(defective, config.data.labels, i));

      expect(painted).toEqual(c.labels.map((_, i) => String(i)));
      expect(painted).not.toEqual(c.labels);
    });
  }

  // The x axis is the VALUE axis on all three, and it keeps its numeric formatting — the fix
  // must not have taken the numbers off the axis that is actually numeric.
  it("leaves the value axis numeric", async () => {
    const charts = await loadCharts();
    charts.severityBar(fakeCanvas(), SEV_COUNTS, SEV_PALETTE, null);
    const [config] = state.calls;
    expect(config.options.scales.x.beginAtZero).toBe(true);
    expect(config.options.scales.x.ticks.precision).toBe(0);
    expect(typeof config.options.scales.x.ticks.callback).toBe("function");
  });
});
