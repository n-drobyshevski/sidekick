// Chart.js CONFIG OBJECTS, not the canvas — this app's first one.
//
// `gas_ai/test/` had no test of `charts.js` at all: `chartsBundle.test.ts` checks that the
// bundle splits and defines its globals, `chartTable.test.js` checks the data-table fallback,
// and between them nothing ever constructed a `Chart` or looked at what was handed to it. So
// when this file's `trendLine` drew every date series on Chart.js's default CATEGORY scale —
// points spaced by INDEX, a missed sync drawn exactly as wide as the day after it — the suite
// could not have noticed, and did not.
//
// `chart.js` is mocked with a bare-bones stand-in that records the (canvas, config) pair every
// `new Chart(...)` call was made with, the same harness `gas_devsecops/test/charts.test.js`
// uses. There is no jsdom in this project (`vitest.config.ts` sets no `environment`), so the
// loader below supplies just enough of `window`/`document` for charts.js's module-scope
// `window.matchMedia` read.

import { afterEach, describe, expect, it, vi } from "vitest";

// Shared with the `vi.mock` factory below via `vi.hoisted` — a plain module-scope `const`
// referenced inside the factory would be a TDZ error, since `vi.mock` calls are hoisted above
// every other statement in this file.
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
    static getChart() {
      return undefined; // "no existing chart on this canvas" — destroyExisting() no-ops
    }
  }
  const component = () => {};
  return {
    Chart: FakeChart,
    CategoryScale: component,
    Filler: component,
    Legend: component,
    LinearScale: component,
    LineController: component,
    LineElement: component,
    PointElement: component,
    Tooltip: component,
  };
});

function fakeCanvas() {
  return {
    setAttribute() {},
    getContext: () => null,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
}

/** (Re)load charts.js under a fresh module registry, with `prefers-reduced-motion` pinned. */
async function loadCharts({ reducedMotion = false } = {}) {
  vi.resetModules();
  state.calls = [];
  globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };
  globalThis.document = {
    createElement: () => ({ getContext: () => null, setAttribute() {}, style: {} }),
  };
  return import("../src/client/js/charts.js");
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

const DAY = 86400000;
const day = (iso) => Math.floor(Date.parse(iso) / DAY);

// Three syncs: a long gap, then a short one. Every trend in this app is "one point per
// successful sync" and cannot be backfilled (`domain/aarsTrend.ts`, `domain/complianceTrend.ts`
// say so in their own headers), so uneven gaps are the normal case, not the edge one.
const POINTS = [
  { x: "2026-01-16T09:00:00Z" },
  { x: "2026-06-01T09:00:00Z" },
  { x: "2026-06-15T09:00:00Z" },
];

describe("trendLine: the day axis", () => {
  it("puts the x value on the date, and the range on the data", async () => {
    const charts = await loadCharts();
    charts.trendLine(fakeCanvas(), POINTS, {
      yLabel: "count",
      series: [{ label: "issues", color: "#be123c", data: [3, 5, 4] }],
    });
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.options.scales.x.type).toBe("linear");
    // `bounds: "data"` and no min/max: the axis ends where the syncs do, never rounded out to
    // a nice tick that would make a current landscape look weeks stale.
    expect(cfg.options.scales.x.bounds).toBe("data");
    expect(cfg.options.scales.x.min).toBeUndefined();
    expect(cfg.data.datasets[0].data).toEqual([
      { x: day("2026-01-16T09:00:00Z"), y: 3 },
      { x: day("2026-06-01T09:00:00Z"), y: 5 },
      { x: day("2026-06-15T09:00:00Z"), y: 4 },
    ]);
    // A `labels` array beside {x, y} data would be a second, index-ordered claim about the
    // same points — Chart.js would read it, and it would disagree.
    expect(cfg.data.labels).toBeUndefined();
  });

  it("is not a relabelling — the gap between syncs is DRAWN, not spaced away", async () => {
    const charts = await loadCharts();
    charts.trendLine(fakeCanvas(), POINTS, { yLabel: "count" });
    const xs = state.calls[state.calls.length - 1].data.datasets[0].data.map((p) => p.x);
    expect(xs[1] - xs[0]).toBe(136);
    expect(xs[2] - xs[1]).toBe(14);
    // On the category axis these two gaps were the same width. They are not the same gap.
    expect(xs[1] - xs[0]).toBeGreaterThan((xs[2] - xs[1]) * 9);
  });

  it("names the date in the tooltip, since the x value is now a number", async () => {
    const charts = await loadCharts();
    charts.trendLine(fakeCanvas(), POINTS, { yLabel: "count" });
    const { title } = state.calls[state.calls.length - 1].options.plugins.tooltip.callbacks;
    expect(title([{ parsed: { x: day("2026-06-15T09:00:00Z") } }])).toBe("15-jun-2026");
    expect(title([])).toBe("");
  });

  // =======================================================================================
  //  WHAT THE PORT MUST NOT BREAK
  // =======================================================================================

  it("keeps a null as a null SLOT — the gap is the reading", async () => {
    // `inventory.js` builds these with `null` rather than `?? 0` on purpose: a count nobody
    // recorded is not a count of zero. `{x, y: null}` still breaks the line on a linear scale.
    const charts = await loadCharts();
    charts.trendLine(fakeCanvas(), POINTS, {
      yLabel: "count",
      series: [{ label: "postureFails", color: "#be123c", data: [3, null, 4] }],
    });
    const data = state.calls[state.calls.length - 1].data.datasets[0].data;
    expect(data).toHaveLength(3);
    expect(data[1]).toEqual({ x: day("2026-06-01T09:00:00Z"), y: null });
  });

  // PERTURBATION. The tempting cleanup on a linear scale is to drop the null-y points, since
  // the axis no longer needs a slot to position by. It would desync every note from its mark.
  it("is not a vacuous guard — dropping the null desyncs pointNotes from the points", async () => {
    const charts = await loadCharts();
    const notes = ["first sync", "", "827 edges known"];
    charts.trendLine(fakeCanvas(), POINTS, {
      yLabel: "count",
      series: [{ label: "adjacency", color: "#be123c", data: [3, null, 4] }],
      pointNotes: notes,
    });
    const cfg = state.calls[state.calls.length - 1];
    const dropped = cfg.data.datasets[0].data.filter((p) => p.y !== null);
    expect(dropped).toHaveLength(2); // what the cleanup would leave
    // `dataIndex` 2 is the third POINT, and its note belongs to the third point.
    const { title } = cfg.options.plugins.tooltip.callbacks;
    expect(title([{ dataIndex: 2 }])).toEqual(["2026-06-15", "827 edges known"]);
    // Had the null been dropped, index 2 would not exist at all.
    expect(dropped[2]).toBeUndefined();
  });

  it("still stacks, because every series shares one x array", async () => {
    const charts = await loadCharts();
    charts.trendLine(fakeCanvas(), POINTS, {
      yLabel: "count",
      stacked: true,
      series: [
        { label: "reachable", color: "#be123c", data: [1, 2, 3] },
        { label: "isolated", color: "#0f766e", data: [4, 5, 6] },
      ],
    });
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.options.scales.y.stacked).toBe(true);
    const xs = cfg.data.datasets.map((d) => d.data.map((p) => p.x));
    expect(xs[0]).toEqual(xs[1]);
  });

  it("still pins the percent window the model computed, on the y axis only", async () => {
    const charts = await loadCharts();
    charts.trendLine(fakeCanvas(), POINTS, {
      yLabel: "",
      percent: true,
      yRange: { min: 84, max: 100 },
      series: [{ label: "NIST", color: "#be123c", data: [91, 93, 92] }],
    });
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.options.scales.y.min).toBe(84);
    expect(cfg.options.scales.y.max).toBe(100);
    expect(cfg.options.scales.y.beginAtZero).toBe(false);
    // And the percent label callback did not take the day axis's title with it.
    expect(cfg.options.plugins.tooltip.callbacks.label(
      { dataset: { label: "NIST" }, parsed: { y: 93 } },
    )).toBe("NIST: 93%");
    expect(cfg.options.plugins.tooltip.callbacks.title(
      [{ parsed: { x: day("2026-06-01T09:00:00Z") } }],
    )).toBe("01-jun-2026");
  });
});
