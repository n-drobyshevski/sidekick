// `ui/sparkline.js` — a series as one line, and the gap that is not a zero.
//
// THE ONE DEFECT THIS FILE EXISTS FOR, stated as arithmetic rather than as advice.
// `Number(null)`, `Number("")`, `Number([])` and `Number(false)` are all `0` AND finite.
// CLAUDE.md has now recorded that trap three times, in three unrelated packages, and a
// sparkline is where it does the most damage per line of code: the tempting body is
//
//     const ys = points.map(Number).filter(Number.isFinite);
//
// which is one line, reads as careful, and turns every scan that never ran into a reading at
// the floor of the chart. The picture it draws is not "we do not know" — it is a crash. Worse,
// the same cast then drags `min` down to 0, so the whole line's vertical scale is set by a
// measurement nobody made. The perturbation below reproduces that body and shows both effects.
//
// A GAP KEEPS ITS PLACE. Dropping an unmeasured slot instead of casting it fixes the floor and
// introduces a quieter lie: eight scans with two missing would be drawn as six evenly spaced
// readings, so the line's SLOPE — the only thing a sparkline says — would be wrong. So a gap
// costs the line a break and keeps its x position, and the label says how many there were.
//
// The DOM half gets source-text assertions: no jsdom in these apps, and the claims worth
// holding (role="img", a stroke in currentColor, no animation, the namespace not spelled out)
// are properties of the module.

import { readFileSync } from "node:fs";

import { code } from "./emptyStates.js";

// Comment-stripped, for the reason emptyStates.js states once: every module header in
// this package explains its prohibition by QUOTING it, so a raw-text sweep fails on the
// sentence that states the rule rather than on a violation of it.
const SPARK_SRC = code(readFileSync(new URL("../../ui/sparkline.js", import.meta.url), "utf8"));

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.app
 * @param {Function} ctx.sparkPath   the pure half, handed over rather than imported by a
 *   fixed relative path (this file is registered from three different depths)
 * @param {Function} ctx.sparkLabel  the sentence builder, same reason
 */
export function registerSparklineContract(ctx) {
  const { describe, it, expect, app, sparkPath, sparkLabel } = ctx;

  const BOX = { w: 100, h: 20, pad: 0 };

  describe(app + ": sparkPath() refuses each point BEFORE any cast", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["an array", []],
      ["false", false],
      ["an object", {}],
      ["true", true],
      ["a string that is not a number", "n/a"],
    ])("a slot holding %s is a gap: it breaks the line and is never plotted", (_l, bad) => {
      const m = sparkPath([10, bad, 30], BOX);
      expect(m.n).toBe(2);
      expect(m.gaps).toBe(1);
      expect(m.min).toBe(10);
      expect(m.max).toBe(30);
      // Two runs of one point each: the line does not cross the gap.
      expect(m.d.match(/M/g).length).toBe(2);
    });

    // THE PERTURBATION. The cast-first one-liner, reproduced inline and never applied to the
    // module, so the shipped guard and the defective alternative are both present at once and
    // measurably disagree on the same input.
    it("PERTURBATION PROOF: a cast-first rewrite plots every gap on the floor and moves min", () => {
      function castFirstDefective(points) {
        const ys = points.map(Number).filter(Number.isFinite); // the anti-pattern
        return { n: ys.length, min: Math.min(...ys), max: Math.max(...ys) };
      }
      for (const bad of [null, "", [], false]) {
        const series = [10, bad, 30];
        const wrong = castFirstDefective(series);
        // The defective shape: nothing is refused, so the gap becomes a third READING at 0
        // and drags the floor of the chart down with it.
        expect(wrong.n, JSON.stringify(bad)).toBe(3);
        expect(wrong.min, JSON.stringify(bad)).toBe(0);

        const m = sparkPath(series, BOX);
        expect(m.n, JSON.stringify(bad)).toBe(2);
        expect(m.gaps, JSON.stringify(bad)).toBe(1);
        expect(m.min, JSON.stringify(bad)).toBe(10);
      }
    });

    // THE SECOND, QUIETER REWRITE: filter the gaps out instead of casting them. The floor is
    // right and the SLOPE is wrong, which is the only thing a sparkline is read for.
    it("PERTURBATION PROOF: dropping gaps instead of breaking compresses time", () => {
      const series = [0, null, null, 100];
      const dropped = series.filter((v) => typeof v === "number");
      // The defective shape: two points side by side, so the rise looks like one step.
      expect(dropped).toEqual([0, 100]);

      const m = sparkPath(series, BOX);
      // The shipped shape: the two readings keep slots 0 and 3 of 4, so the run is drawn
      // across the full width and the two missing scans are counted.
      expect(m.gaps).toBe(2);
      expect(m.d).toContain("M0,20");
      expect(m.d).toContain("100,0");
    });
  });

  describe(app + ": sparkPath() draws only what it measured", () => {
    it("no readings at all: an empty path, and every figure null", () => {
      const m = sparkPath([null, null, null], BOX);
      expect(m).toMatchObject({ d: "", n: 0, gaps: 3, first: null, last: null, min: null, max: null });
      expect(m.end).toBeNull();
    });

    it("one reading is not a trend: an empty path, but the reading is still reported", () => {
      const m = sparkPath([null, 7, null], BOX);
      expect(m.d).toBe("");
      expect(m.n).toBe(1);
      expect(m.first).toBe(7);
      expect(m.last).toBe(7);
      expect(m.end).not.toBeNull();
    });

    it("an empty or non-array input is answered, not thrown at", () => {
      for (const nothing of [[], null, undefined, "nope", 12]) {
        const m = sparkPath(nothing, BOX);
        expect(m.d, JSON.stringify(nothing)).toBe("");
        expect(m.n, JSON.stringify(nothing)).toBe(0);
      }
    });

    it("a flat series is a real reading and draws a straight line down the middle", () => {
      const m = sparkPath([41, 41, 41], BOX);
      expect(m.min).toBe(41);
      expect(m.max).toBe(41);
      expect(m.d).not.toContain("NaN");
      expect(m.d).toBe("M0,10 L50,10 L100,10");
    });

    // A REGRESSION THIS MODULE ALREADY HAD ONCE. A run of one point is `M x,y` with nothing
    // after it, which paints nothing under `fill: none`; the fix is a zero-length segment that
    // the round cap renders as a dot. The first draft applied it only to the run still open
    // when the loop ended, so `[12, null, 9, 7, 41]` — one missed scan at the START — dropped
    // its first reading off the picture entirely. Every run is checked here, not the last.
    it("an isolated reading draws as a dot wherever it sits, never as a dangling moveto", () => {
      for (const series of [[5, null, 9, 12], [9, 12, null, 5], [5, null, 9, null, 12]]) {
        const d = sparkPath(series, BOX).d;
        const moves = (d.match(/M/g) || []).length;
        const lines = (d.match(/L/g) || []).length;
        expect(lines, JSON.stringify(series)).toBeGreaterThanOrEqual(moves);
        // No `M` is left immediately before another `M` or at the end of the string.
        expect(d, JSON.stringify(series)).not.toMatch(/M[\d.,]+(?= M|$)/);
      }
    });

    it("maps the extremes to the box: the high point at the top, the low at the bottom", () => {
      const m = sparkPath([0, 5, 10], BOX);
      expect(m.d).toBe("M0,20 L50,10 L100,0");
      expect(m.end).toEqual({ x: 100, y: 0 });
    });

    it("first and last are the first and last MEASURED readings, not the first and last slots", () => {
      const m = sparkPath([null, 3, 9, null], BOX);
      expect(m.first).toBe(3);
      expect(m.last).toBe(9);
      // The end dot sits on the last reading's own slot, not at the right edge.
      expect(m.end.x).toBeLessThan(100);
    });
  });

  describe(app + ": the label always carries the figures", () => {
    it("states first, last, low, high and how many readings there were", () => {
      const label = sparkLabel(sparkPath([10, 4, 18], BOX));
      for (const part of ["starts at 10", "ends at 18", "low 4", "high 18", "3 readings"]) {
        expect(label, part).toContain(part);
      }
    });

    it("a caller's label NAMES the series and never replaces the figures", () => {
      const label = sparkLabel(sparkPath([10, 4, 18], BOX), "Half-life", "days");
      expect(label.startsWith("Half-life: ")).toBe(true);
      expect(label).toContain("starts at 10 days");
      expect(label).toContain("high 18 days");
    });

    it("says how many slots nobody measured, rather than leaving them out of the sentence", () => {
      expect(sparkLabel(sparkPath([10, null, 18], BOX))).toContain("1 not measured");
      expect(sparkLabel(sparkPath([10, 18], BOX))).not.toContain("not measured");
    });

    it("an unmeasured series says so; a single reading says it is a single reading", () => {
      expect(sparkLabel(sparkPath([null, null], BOX))).toBe("not measured");
      expect(sparkLabel(sparkPath([7], BOX))).toBe("one reading, 7");
      expect(sparkLabel(sparkPath([null, null], BOX), "Half-life")).toBe("Half-life: not measured");
    });
  });

  describe(app + ": the SVG half", () => {
    it("is a role=\"img\" with an aria-label built from the model", () => {
      expect(SPARK_SRC).toContain("role: \"img\"");
      expect(SPARK_SRC).toMatch(/"aria-label": sparkLabel\(/);
    });

    it("strokes in currentColor with no fill, and keeps its weight when the box is scaled", () => {
      expect(SPARK_SRC).toContain("stroke: \"currentColor\"");
      expect(SPARK_SRC).toContain("fill: \"none\"");
      expect(SPARK_SRC).toContain("\"vector-effect\": \"non-scaling-stroke\"");
    });

    it("carries no animation, so there is no reduced-motion alternative owed", () => {
      expect(SPARK_SRC).not.toMatch(/animate|transition|keyframes|requestAnimationFrame/i);
    });

    it("never spells the SVG namespace itself — the middlebox guard fails the build on it", () => {
      // `icons.js` builds SVG_NS by joining the parts because a literal `//` inside a served
      // string has been observed truncated in transit; esbuild.config.mjs fails the build on
      // any that survive comment stripping. Reaching for svgEl is how this module inherits
      // that, and it is worth a line here because "just use createElementNS" is the obvious
      // simplification and it breaks the build rather than the picture.
      expect(SPARK_SRC).toContain("import { svgEl } from \"../icons.js\"");
      expect(SPARK_SRC).not.toContain("createElementNS");
    });

    // A COLLISION, NOT A PREFERENCE. `gas/src/client/styles/pages.css` owns `.spark` for the
    // bordered per-tier card on its Overview page, and that sheet loads after components.css,
    // so a shared `.spark` would reach those cards for every property they do not set — the
    // card's own `.spark__value` inherits its ink and would have gone muted. Pinned here
    // because the tempting cleanup ("the module is sparkline.js, call the class .spark") is a
    // one-word edit whose damage is in another app's stylesheet.
    it("takes the class .sparkline, because gas already owns .spark for a card", () => {
      expect(SPARK_SRC).toContain("class: \"sparkline\"");
      expect(SPARK_SRC).not.toMatch(/class: "spark"/);
    });

    it("never sets a title attribute — el()'s ban, restated for the SVG path", () => {
      expect(SPARK_SRC).not.toMatch(/\btitle:\s*/);
    });
  });
}
