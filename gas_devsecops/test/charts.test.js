// Chart.js CONFIG OBJECTS, not the canvas. `chart.js` is mocked with a bare-bones stand-in
// that records the (canvas, config) pair every `new Chart(...)` call was made with, so each
// wrapper's config can be inspected the way `Chart` itself would consume it, without a real
// renderer (no jsdom in this project — see vitest.config.ts, which has no `environment` set,
// so this file supplies just enough of `window`/`document` for charts.js's own module-scope
// `window.matchMedia` read and its `describe()`/`hatchPattern` helpers).
//
// This is the load-bearing test for gas_devsecops's own accent rule (CLAUDE.md / DESIGN.md):
// `--accent` (#ffcb13) is a FILL-only token — 1.52:1 on white — and every chart series, point
// stroke, or reference line must use `--accent-text` (#7c4a0a) instead. gas/'s charts.js (the
// OS-vuln register this file ports from) uses ITS OWN brand blue as ink throughout; every one
// of those spots was substituted for this register's accent ink during the port, and the
// negative test below is the regression guard that a future edit doesn't quietly restore the
// unreadable literal.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEVERITY_COLORS, SEVERITY_ORDER } from "../src/domain/config";

const CHARTS_SRC = readFileSync(new URL("../src/client/js/charts.js", import.meta.url), "utf8");

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
  // charts.js registers these by reference only (`Chart.register(ArcElement, ...)`); the
  // mocked `register` above ignores its arguments, so these just need to exist as imports.
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
    setAttribute() {},
    getContext: () => null,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
}

/** (Re)load charts.js under a fresh module registry, with `prefers-reduced-motion` pinned —
 *  `reducedMotion` is computed once at module-evaluation time, so exercising both states
 *  needs two separate module instances, not two calls into the same one. */
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

const SEV_PALETTE = { order: SEVERITY_ORDER, colors: SEVERITY_COLORS };

/** Draws one of everything this package ported, with small representative fixtures, and
 *  returns the collected `new Chart(...)` configs in call order. Used by the cross-chart
 *  accent-ink scan — a single well-covered pass is worth more here than one test per chart. */
function drawEverything(charts) {
  const c = () => fakeCanvas();
  charts.severityBar(c(), { CRITICAL: 3, HIGH: 2, MEDIUM: 0, LOW: 1, INFO: 0, UNKNOWN: 4 }, SEV_PALETTE, null);
  charts.stackedAgeBar(
    c(), ["0-7d", "8-14d"],
    { CRITICAL: [1, 2], HIGH: [0, 1] },
    SEV_PALETTE, "desc",
  );
  charts.sparkline(c(), [1, 2, 3, 2, 4], { color: "#6b7280" });
  charts.severityTrendLines(
    c(),
    [
      { date: "2026-01-01", bySev: { CRITICAL: 2, HIGH: 1 } },
      { date: "2026-01-02", bySev: { CRITICAL: 1, HIGH: 1 } },
    ],
    SEV_PALETTE,
  );
  charts.openResolvedLines(c(), [
    { date: "2026-01-01", open: 5, resolved: 1, reconstructed: false },
    { date: "2026-01-02", open: 4, resolved: 2, reconstructed: false },
  ]);
  charts.survivalCurve(
    c(),
    [{ t: 1, s: 0.9 }, { t: 5, s: 0.5 }, { t: 20, s: 0.2 }],
    { naiveMedian: 5, median: 6, naiveMean: 8, mean: 9 },
  );
  charts.groupPie(c(), [
    { label: "repoA", value: 10, color: "#7c4a0a" },
    { label: "repoB", value: 5, color: "#0d9488" },
  ]);
  charts.groupTrendLines(
    c(),
    [{ date: "2026-01-01", byGroup: { repoA: 3, repoB: 1 } }],
    [{ name: "repoA", color: "#7c4a0a" }, { name: "repoB", color: "#0d9488" }],
  );
  charts.mttrContributionBars(
    c(), [{ label: "repoA", value: 5, resolved: 10, color: "#7c4a0a" }], { overall: 4 },
  );
  charts.mttrImpactBars(
    c(), [{ label: "repoA", value: 12, median: 5, resolved: 10, color: "#7c4a0a" }],
  );
  charts.coverageEfficiencyLines(c(), [
    { date: "2026-01-01", coverage_pct: 50, efficiency_pct: 60, reconstructed: false },
  ]);
  charts.coverageEfficiencyScatter(c(), [
    { label: "rule A", coverage: 50, efficiency: 60, highRisk: 20, active: true },
    { label: "rule B", coverage: 40, efficiency: 70, highRisk: 15, active: false },
  ]);
  charts.trendLine(c(), [{ x: "2026-01-01", y: 3 }]);
  charts.coverCurve(c(), [{ rank: 1, cumulative: 5, share: 0.5 }]);
  return state.calls.slice();
}

// -------------------------------------------------------------------------- fmtDuration

describe("fmtDuration", () => {
  // Measured (node -e against this exact function body), not eyeballed — see the "6.98d"
  // case in particular: the function's own header comment used to claim 6.98d formats as
  // "1w", which is false (6.98 < 7 never reaches the week branch; it formats as "7d" because
  // the hour component rounds up to a full day). The comment was corrected during this port
  // to say what the code actually does; this table is the measurement that correction rests on.
  const cases = [
    [null, "—"],
    [undefined, "—"],
    [NaN, "—"],
    [0, "0d"],
    [-3, "0d"],
    [0.02, "<1h"],
    [0.4, "10h"],
    [0.999, "1d"],
    [1, "1d"],
    [1.5, "1d 12h"],
    [2.3, "2d 7h"],
    [6.98, "7d"],
    [7, "1w"],
    [7.1, "1w 0.1d"],
    [10, "1w 3d"],
    [14, "2w"],
    [21, "3w"],
  ];

  it.each(cases)("fmtDuration(%p) === %p", async (input, expected) => {
    const charts = await loadCharts();
    expect(charts.fmtDuration(input)).toBe(expected);
  });
});

// ------------------------------------------------------------------------------- destroyChart

it("destroyChart tears down without throwing when nothing is bound to the canvas", async () => {
  const charts = await loadCharts();
  expect(() => charts.destroyChart(fakeCanvas())).not.toThrow();
});

// --------------------------------------------------------------------------- reduced motion

describe("prefers-reduced-motion", () => {
  it("turns animation off when the media query matches", async () => {
    const charts = await loadCharts({ reducedMotion: true });
    charts.severityBar(fakeCanvas(), { CRITICAL: 1 }, SEV_PALETTE, null);
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.options.animation).toBe(false);
  });

  it("animates normally when it does not", async () => {
    const charts = await loadCharts({ reducedMotion: false });
    charts.severityBar(fakeCanvas(), { CRITICAL: 1 }, SEV_PALETTE, null);
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.options.animation).toEqual({ duration: 300 });
  });

  it("also gates the survivalCurve's own hand-built options object", async () => {
    // survivalCurve doesn't call baseOptions() (a pie/line-scatter-free axis shape) — it is
    // its own animation switch, and it's easy for that copy to drift from baseOptions'.
    const charts = await loadCharts({ reducedMotion: true });
    charts.survivalCurve(fakeCanvas(), [{ t: 1, s: 1 }], {});
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.options.animation).toBe(false);
  });
});

// ------------------------------------------------------------------------------ severityBar

describe("severityBar", () => {
  it("colours equal the severity fill tokens, in severity order", async () => {
    const charts = await loadCharts();
    const counts = { CRITICAL: 3, HIGH: 2, MEDIUM: 0, LOW: 1, INFO: 0, UNKNOWN: 4 };
    charts.severityBar(fakeCanvas(), counts, SEV_PALETTE, null);
    const cfg = state.calls[state.calls.length - 1];
    const expectedSevs = SEVERITY_ORDER.filter((s) => counts[s]); // CRITICAL, HIGH, LOW, UNKNOWN
    expect(cfg.data.labels).toEqual(expectedSevs);
    expect(cfg.data.datasets[0].backgroundColor).toEqual(expectedSevs.map((s) => SEVERITY_COLORS[s]));
    // A zero-count severity (MEDIUM, INFO) is dropped, not drawn as an empty bar.
    expect(cfg.data.labels).not.toContain("MEDIUM");
    expect(cfg.data.labels).not.toContain("INFO");
  });

  it("is a horizontal bar with click-to-filter wired to the drawn severities", async () => {
    const charts = await loadCharts();
    const onClick = vi.fn();
    const counts = { CRITICAL: 1, LOW: 1 };
    charts.severityBar(fakeCanvas(), counts, SEV_PALETTE, onClick);
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.type).toBe("bar");
    expect(cfg.options.indexAxis).toBe("y");
    cfg.options.onClick({}, [{ index: 1 }]); // second drawn severity == LOW
    expect(onClick).toHaveBeenCalledWith("LOW");
  });
});

// ---------------------------------------------------------------------------- survivalCurve

describe("survivalCurve", () => {
  it("has a stepped line dataset and marker (scatter, showLine:false) datasets when markers are given", async () => {
    const charts = await loadCharts();
    charts.survivalCurve(
      fakeCanvas(),
      [{ t: 1, s: 0.9 }, { t: 5, s: 0.5 }, { t: 20, s: 0.2 }],
      { naiveMedian: 5, median: 6, naiveMean: 8, mean: 9 },
    );
    const cfg = state.calls[state.calls.length - 1];
    const [curveDs, ...markerDs] = cfg.data.datasets;
    expect(curveDs.stepped).toBe("after");
    expect(curveDs.label).toBe("S(t)");
    expect(markerDs.length).toBe(4); // all four markers supplied
    for (const ds of markerDs) {
      // showLine:false is how this file emulates a scatter point without registering
      // ScatterController — see the function's own comment.
      expect(ds.showLine).toBe(false);
      expect(ds.data).toHaveLength(1);
    }
  });

  it("omits a marker dataset (and no dead legend entry) when a marker value is null", async () => {
    const charts = await loadCharts();
    charts.survivalCurve(
      fakeCanvas(),
      [{ t: 1, s: 1 }],
      { naiveMedian: null, median: 6, naiveMean: null, mean: null },
    );
    const cfg = state.calls[state.calls.length - 1];
    expect(cfg.data.datasets.length).toBe(2); // curve + the one supplied marker (median)
    expect(cfg.data.datasets[1].label).toBe("Median (KM, all)");
  });

  it("uses this register's accent INK for the KM (all-findings) markers and the S(t) line, never the accent FILL", async () => {
    const charts = await loadCharts();
    charts.survivalCurve(
      fakeCanvas(),
      [{ t: 1, s: 0.9 }],
      { naiveMedian: 5, median: 6, naiveMean: 8, mean: 9 },
    );
    const cfg = state.calls[state.calls.length - 1];
    const [curveDs, naiveMedianDs, medianDs, naiveMeanDs, meanDs] = cfg.data.datasets;
    expect(curveDs.borderColor).toBe(charts.ACCENT);
    expect(medianDs.backgroundColor).toBe(charts.ACCENT);
    expect(meanDs.backgroundColor).toBe(charts.ACCENT);
    // Closed-only (naive) markers stay plain ink, not the brand accent.
    expect(naiveMedianDs.backgroundColor).toBe("#171717");
    expect(naiveMeanDs.backgroundColor).toBe("#171717");
    expect(charts.ACCENT).not.toBe("#ffcb13");
    expect(charts.ACCENT).not.toBe("#2563eb"); // gas/'s own brand blue — not carried over
  });
});

// -------------------------------------------------------------------------------- accent ink

describe("the accent never carries ink", () => {
  it("never appears as a colour LITERAL in charts.js — only in prose explaining why not", () => {
    // Several comments name #ffcb13 to explain why it's excluded (that's the point of this
    // file's accent-ink rule and worth documenting in place) — so this checks for it as a
    // quoted string, the only form it could take as an actual dataset colour, not as bare
    // text anywhere in the file.
    expect(CHARTS_SRC).not.toMatch(/["']#ffcb13["']/);
  });

  it("no dataset produced by any ported chart uses #ffcb13 as borderColor/pointBorderColor/color", async () => {
    const charts = await loadCharts();
    const configs = drawEverything(charts);
    const inkKeys = ["borderColor", "pointBorderColor", "color"];
    const offenders = [];
    for (const cfg of configs) {
      for (const ds of cfg.data.datasets) {
        for (const key of inkKeys) {
          const v = ds[key];
          const values = Array.isArray(v) ? v : [v];
          for (const val of values) {
            if (val === "#ffcb13") offenders.push({ type: cfg.type, key });
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// -------------------------------------------------------------------------------- misc ports

it("groupPalette assigns this register's accent ink to the first group, not gas/'s brand blue", async () => {
  const charts = await loadCharts();
  const map = charts.groupPalette(["repoA", "repoB"]);
  expect(map.get("repoA")).toBe(charts.ACCENT);
  expect(map.get("repoA")).not.toBe("#2563eb");
  expect(map.get("Other")).toBe("#94a3b8");
});

it("stackedAgeBar stacks x and y and orders datasets by the palette", async () => {
  const charts = await loadCharts();
  charts.stackedAgeBar(
    fakeCanvas(), ["0-7d", "8-14d"],
    { CRITICAL: [1, 2], HIGH: [0, 1] },
    SEV_PALETTE, "desc",
  );
  const cfg = state.calls[state.calls.length - 1];
  expect(cfg.options.scales.x.stacked).toBe(true);
  expect(cfg.options.scales.y.stacked).toBe(true);
  expect(cfg.data.datasets.map((d) => d.label)).toEqual(["CRITICAL", "HIGH"]);
});

it("coverageEfficiencyScatter marks the active rule with the accent, not #ffcb13, plus a distinct point style", async () => {
  const charts = await loadCharts();
  charts.coverageEfficiencyScatter(fakeCanvas(), [
    { label: "rule A", coverage: 50, efficiency: 60, highRisk: 20, active: true },
    { label: "rule B", coverage: 40, efficiency: 70, highRisk: 15, active: false },
  ]);
  const cfg = state.calls[state.calls.length - 1];
  const ds = cfg.data.datasets[0];
  expect(ds.pointBackgroundColor[0]).toBe(charts.ACCENT);
  expect(ds.pointStyle[0]).toBe("rectRot");
  expect(ds.pointStyle[1]).toBe("circle");
});
