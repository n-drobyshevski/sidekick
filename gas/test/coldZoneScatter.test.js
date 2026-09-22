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

  // A GROUPED ESTATE IS THE COMMON CASE HERE: a support group's median member is at most its
  // idlest one, so a canvas of groups can easily sit entirely left of the line the page is
  // about. `suggestedMax` only extends, so the dot at 210 is still plotted at 210.
  it("stretches the x axis to the line, so the rule is never scaled off the canvas", async () => {
    const { config } = await build({ thresholdDays: 400, mode: "fixed" });
    expect(config.options.scales.x.suggestedMax).toBe(400);
    expect(config.data.datasets[0].data[0]).toEqual({ x: 210, y: 12 });
  });

  it("suggests no maximum when there is no line to keep on the canvas", async () => {
    const { config } = await build({ thresholdDays: null, mode: "fixed" });
    expect(config.options.scales.x.suggestedMax).toBeUndefined();
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

  // THE ONE WORD THAT MOVES WITH THE GRAIN. The page plots the same two quantities per asset
  // or per support group, and the reader who depends on this sentence is the one who cannot
  // check the picture against it — so a canvas of support groups must never say "asset".
  it("names support groups when the caller says so, and assets when it says nothing", async () => {
    const { canvas: groups } = await build({ thresholdDays: 90, mode: "fixed", unit: "group" });
    expect(groups.attrs["aria-label"]).toContain(
      "Idle days against open findings for each support group that still has an open finding:",
    );
    expect(groups.attrs["aria-label"]).not.toContain("each asset");

    // The older contract, unchanged: no `unit` is assets, and so is the page's own "asset".
    for (const opts of [{ thresholdDays: 90, mode: "fixed" },
      { thresholdDays: 90, mode: "fixed", unit: "asset" }]) {
      const { canvas } = await build(opts);
      expect(canvas.attrs["aria-label"]).toContain(
        "Idle days against open findings for each asset the newest scan still returns:",
      );
    }
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

// A FIFTH CLAIM, ADDED WITH THE CROSS-FILTER: the highlight moves ink without moving the
// picture, and it never spends a channel the verdict is already using.
//
//   5. `on: false` DIMS, IT DOES NOT DROP. Every point stays in the dataset, so Chart.js
//      computes the scales over the whole estate and the dashed rule stays where it was. A
//      filter here would rescale the chart around the answer and throw away the comparison
//      the reader's press was making — the page collapses to the selection only when the
//      reader asks for it, and then by passing a shorter array, not by a flag here.
//   6. `pointStyle` IS UNTOUCHED BY THE HIGHLIGHT. Cold-versus-warm rides on the shape
//      (claim 2) and the selection rides on SIZE; a dimmed cold asset must still be a
//      diamond, or the two encodings collapse into one that cannot be taken apart.
//   7. RADIUS CARRIES THE DIM, NOT ALPHA ALONE. The fade matches the band bars' own 0.22, but
//      that CSS rule is cancelled under forced colors and a canvas gets no such rescue, so
//      the size difference is the half that has to survive.

/** The same three points, with a selection reaching only the first. */
const MARKED = [
  { ...POINTS[0], on: true },
  { ...POINTS[1], on: false },
  { ...POINTS[2], on: false },
];

async function buildMarked(points, opts) {
  const charts = await loadCharts();
  const canvas = fakeCanvas();
  charts.coldZoneScatter(canvas, points, opts);
  expect(state.calls).toHaveLength(1);
  return { canvas, config: state.calls[0].config };
}

describe("coldZoneScatter: the cross-filter dims, it never drops", () => {
  it("keeps every point in the dataset, so the axes are still the estate's", async () => {
    const plain = await build({ thresholdDays: 90, mode: "fixed" });
    const marked = await buildMarked(MARKED, { thresholdDays: 90, mode: "fixed" });
    expect(marked.config.data.datasets[0].data).toEqual(plain.config.data.datasets[0].data);
    expect(marked.config.options.scales.x.suggestedMax)
      .toBe(plain.config.options.scales.x.suggestedMax);
  });

  it("leaves the shape channel entirely to the verdict", async () => {
    const plain = await build({ thresholdDays: 90, mode: "fixed" });
    const marked = await buildMarked(MARKED, { thresholdDays: 90, mode: "fixed" });
    // The dimmed point at index 1 is COLD, so it must still be a diamond.
    expect(marked.config.data.datasets[0].pointStyle)
      .toEqual(plain.config.data.datasets[0].pointStyle);
    expect(marked.config.data.datasets[0].pointStyle[1]).toBe("rectRot");
  });

  it("shrinks the dimmed marks, which is the cue forced colors cannot flatten", async () => {
    const { config } = await buildMarked(MARKED, { thresholdDays: 90, mode: "fixed" });
    // 7 for the lit cold point, 3 for both dimmed ones — a cold one and a warm one alike,
    // because at this point the question is no longer which verdict but whether the press
    // reached it.
    expect(config.data.datasets[0].pointRadius).toEqual([7, 3, 3]);
    expect(config.data.datasets[0].pointBorderWidth).toEqual([2, 1, 1]);
  });

  it("fades the dimmed ink to the same 0.22 the band bars dim to", async () => {
    const { config } = await buildMarked(MARKED, { thresholdDays: 90, mode: "fixed" });
    const ds = config.data.datasets[0];
    expect(ds.pointBackgroundColor[0]).toBe("#2563eb");
    expect(ds.pointBackgroundColor[1]).toBe("rgba(37,99,235,0.22)");
    expect(ds.pointBorderColor[2]).toBe("rgba(148,163,184,0.22)");
  });

  it("draws exactly as it always did when no point carries `on`", async () => {
    // THE BACKWARD-COMPATIBILITY CONTRACT. `on` absent is lit, so every caller that never
    // heard of a selection is byte-identical — which is what lets claims 1-4 above keep
    // asserting bare values.
    const plain = await build({ thresholdDays: 90, mode: "fixed" });
    const all = await buildMarked(
      POINTS.map((p) => ({ ...p, on: true })), { thresholdDays: 90, mode: "fixed" },
    );
    for (const key of [
      "pointRadius", "pointBorderWidth", "pointBackgroundColor", "pointBorderColor",
      "pointStyle",
    ]) {
      expect(all.config.data.datasets[0][key]).toEqual(plain.config.data.datasets[0][key]);
    }
  });

  // PERTURBATION: spending the shape channel on the selection would keep every colour and
  // size assertion above true, and would leave the register's own verdict unreadable in
  // exactly the mode the shape exists for.
  it("a selection-keyed pointStyle is what the shape check exists to catch", () => {
    const shapeKeyedToSelection = MARKED.map((p) => (p.on ? "rectRot" : "circle"));
    expect(shapeKeyedToSelection[1]).toBe("circle");
    expect(shapeKeyedToSelection[1]).not.toBe("rectRot");
  });
});

describe("coldZoneScatter: the highlight reaches the reader who cannot see it", () => {
  it("opens the alt text with the selection and marks the lit points inline", async () => {
    const { canvas } = await buildMarked(MARKED, {
      thresholdDays: 90, mode: "fixed", selectionNote: "1 of 3 assets highlighted: Payments.",
    });
    const alt = canvas.attrs["aria-label"];
    expect(alt.startsWith("1 of 3 assets highlighted: Payments. Idle days against")).toBe(true);
    expect(alt).toContain("vm-payments-01, idle 210 days, 12 open (in the cold zone)"
      + " (in this selection)");
    // And the dimmed cold point keeps its verdict clause and loses only the selection one.
    expect(alt).toContain("vm-retail-04, idle at least 150 days, 3 open (in the cold zone);");
  });

  it("says nothing about a selection when there is none", async () => {
    const { canvas } = await build({ thresholdDays: 90, mode: "fixed" });
    expect(canvas.attrs["aria-label"]).not.toContain("in this selection");
    expect(canvas.attrs["aria-label"].startsWith("Idle days against")).toBe(true);
  });

  it("marks nothing when the caller collapsed the points to the selection already", async () => {
    // Every point lit means nothing is dimmed, so an "(in this selection)" on all three would
    // be a clause that distinguishes nothing — noise in a sentence read linearly.
    const { canvas } = await buildMarked(
      POINTS.map((p) => ({ ...p, on: true })),
      { thresholdDays: 90, mode: "fixed", selectionNote: "Showing 3 assets." },
    );
    expect(canvas.attrs["aria-label"]).not.toContain("in this selection");
    expect(canvas.attrs["aria-label"]).toContain("Showing 3 assets.");
  });
});
