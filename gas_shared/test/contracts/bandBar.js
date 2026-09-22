// `ui/bandBar.js` — a distribution across ordered bands, and the two lies it refuses.
//
// THE FIRST IS THE ONE CLAUDE.md HAS RECORDED THREE TIMES. `Number(null)`, `Number("")`,
// `Number([])` and `Number(false)` are all `0` AND finite, so the tempting body
//
//     const count = Number(b.count);
//     if (Number.isFinite(count)) { … }
//
// reads as careful and turns every band nobody measured into a real, drawn zero — a segment
// asserting "nothing is in this band" over a reading that was never taken. The perturbation
// below reproduces that body and shows it drawing a band the honest model leaves out.
//
// THE SECOND IS THIS COMPONENT'S OWN. A bar normalised to its own row's total draws a row of
// 280 and a row of 30 at the same length, so two rows of one table are two different units.
// `unitChart.js` states the same rule for marks — "one unit per TABLE: a per-row unit draws
// 401 with fewer marks than 400" — and it is worth more here, because the whole point of
// folding a matrix into a column of bars was that a reader could still compare DOWN it. The
// perturbation reproduces the per-row body and shows two very different rows drawing an
// identical picture.
//
// The DOM half gets source-text assertions: there is no jsdom in these apps, and the claims
// worth holding are properties of the module — one `role="img"`, no `<button>` anywhere (the
// 5N tab stops this component exists to refuse), and `data-rank` rather than `data-tone`.

import { readFileSync } from "node:fs";

import { code } from "./emptyStates.js";

const BAND_SRC = code(readFileSync(new URL("../../ui/bandBar.js", import.meta.url), "utf8"));

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.app
 * @param {Function} ctx.bandBarModel  the pure half, handed over rather than imported by a
 *   fixed relative path (this file is registered from more than one depth)
 */
export function registerBandBarContract(ctx) {
  const { describe, it, expect, app, bandBarModel } = ctx;

  const bands = (counts) => counts.map((count, i) => ({
    key: "b" + i,
    label: "band " + i,
    count,
    rank: i < 4 ? i + 1 : null,
  }));

  describe("ui/bandBar.js: a distribution across ordered bands (" + app + ")", () => {
    it("sums its segments to the whole of the row's fill", () => {
      const m = bandBarModel({ bands: bands([4, 2, 1, 3]), max: 10, unit: "assets" });
      expect(m.total).toBe(10);
      const sum = m.segments.reduce((n, s) => n + s.pct, 0);
      expect(Math.round(sum)).toBe(100);
    });

    // THE SCALE IS THE TABLE'S. Two rows of the same SHAPE and very different SIZE must not
    // draw the same picture, or the column cannot be read.
    it("draws a row against the table's largest row, not against itself", () => {
      const big = bandBarModel({ bands: bands([140, 140]), max: 280 });
      const small = bandBarModel({ bands: bands([15, 15]), max: 280 });
      expect(Math.round(big.fillPct)).toBe(100);
      expect(Math.round(small.fillPct)).toBe(11);
      // Same shape: both are half and half WITHIN their own fill.
      expect(Math.round(big.segments[0].pct)).toBe(Math.round(small.segments[0].pct));
    });

    // PERTURBATION: the per-row body, which is what this component was written against.
    it("would draw 280 and 30 identically if the bar normalised to its own row", () => {
      const perRow = (counts) => {
        const total = counts.reduce((n, c) => n + c, 0);
        return { fillPct: 100, segments: counts.map((c) => ({ pct: (c / total) * 100 })) };
      };
      const big = perRow([140, 140]);
      const small = perRow([15, 15]);
      expect(big.fillPct).toBe(small.fillPct);
      // ...which is exactly the reading the real model refuses to draw.
      const honest = bandBarModel({ bands: bands([15, 15]), max: 280 });
      expect(Math.round(honest.fillPct)).not.toBe(100);
    });

    it("gives a lone row its whole track rather than a scale it has no peer on", () => {
      const m = bandBarModel({ bands: bands([7, 3]) });
      expect(m.fillPct).toBe(100);
    });

    // ABSENT IS NEVER ZERO.
    it("refuses a count by type and leaves that band out of the picture entirely", () => {
      for (const bad of [null, undefined, "", [], false, "4", NaN, Infinity]) {
        const m = bandBarModel({ bands: bands([5, bad]), max: 10, unit: "assets" });
        expect(m.total).toBe(5);
        expect(m.segments).toHaveLength(1);
        expect(m.aria).not.toContain("band 1");
      }
    });

    // PERTURBATION: the cast-first body, drawing a band nobody measured.
    it("would draw an unmeasured band as a real zero if it cast before refusing", () => {
      const castFirst = (raw) => {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      };
      // Every one of these is a 0 that reads as a measurement.
      expect(castFirst(null)).toBe(0);
      expect(castFirst("")).toBe(0);
      expect(castFirst([])).toBe(0);
      expect(castFirst(false)).toBe(0);
      // The real model keeps all four out of the sentence and off the bar.
      const m = bandBarModel({ bands: bands([5, null]), max: 10 });
      expect(m.segments.map((s) => s.key)).toEqual(["b0"]);
    });

    it("counts a zero as nothing to draw, because a zero-width segment is not a reading", () => {
      const m = bandBarModel({ bands: bands([5, 0]), max: 10 });
      expect(m.segments).toHaveLength(1);
    });

    // A BAND WITH NO WORD IS REFUSED, the same refusal `unitChartModel` makes for a segment
    // with no label: a mark whose only meaning is its colour fails the non-colour rule.
    it("refuses a band that carries no word", () => {
      const m = bandBarModel({
        bands: [{ key: "a", label: "", count: 4, rank: 1 }, { key: "b", label: "ok", count: 6, rank: 2 }],
        max: 10,
      });
      expect(m.segments.map((s) => s.key)).toEqual(["b"]);
    });

    // THE SENTENCE IS THE PICTURE, IN WORDS. Every drawn band, its count and its unit, so the
    // figures the folded matrix used to print in cells survive for a reader who cannot see it.
    it("names every drawn band and its count in one sentence", () => {
      const m = bandBarModel({
        bands: [
          { key: "a", label: "0-30 d", count: 4, rank: 1, extra: "12 open" },
          { key: "b", label: "30-60 d", count: 2, rank: 2 },
        ],
        max: 6, unit: "assets", name: "Payments",
      });
      expect(m.aria).toContain("Payments");
      expect(m.aria).toContain("4 assets at 0-30 d");
      expect(m.aria).toContain("12 open");
      expect(m.aria).toContain("2 assets at 30-60 d");
    });

    // A RANK OUTSIDE THE MEASURED RAMP IS NOT A RANK. The four steps are what the token block
    // recorded separations for; anything else is the hatch, which claims nothing.
    it("keeps the ramp at the four steps it was measured as", () => {
      const m = bandBarModel({
        bands: [
          { key: "a", label: "a", count: 1, rank: 0 },
          { key: "b", label: "b", count: 1, rank: 5 },
          { key: "c", label: "c", count: 1, rank: null },
          { key: "d", label: "d", count: 1, rank: 3 },
        ],
        max: 4,
      });
      expect(m.segments.map((s) => s.rank)).toEqual([null, null, null, 3]);
    });

    it("has nothing to draw when no band survives", () => {
      const m = bandBarModel({ bands: bands([null, null]), max: 10 });
      expect(m.empty).toBe(true);
      expect(m.fillPct).toBe(0);
    });

    it("survives a spec that is not a spec", () => {
      for (const junk of [null, undefined, {}, { bands: null }, { bands: "nope" }]) {
        expect(bandBarModel(junk).empty).toBe(true);
      }
    });
  });

  describe("ui/bandBar.js: the bar is a picture, not a control (" + app + ")", () => {
    // THE ARITY RULE. Five segments per row times N rows is 5N tab stops; the bands are made
    // selectable by a key row ABOVE the table, which spends five once.
    it("builds no button and takes no handler", () => {
      expect(BAND_SRC).not.toContain("button");
      expect(BAND_SRC).not.toContain("onclick");
      expect(BAND_SRC).not.toContain("addEventListener");
      expect(BAND_SRC).not.toContain("tabindex");
    });

    it("is one role=img carrying the whole sentence", () => {
      expect(BAND_SRC).toContain("role");
      expect(BAND_SRC).toContain("aria-label");
    });

    // ORDINAL, NOT CATEGORICAL. `data-tone` is the fixed neutral/ok/warn/bad vocabulary; a
    // band is a step, and gas_ai/DESIGN.md's Ordinal-Fork Rule keeps the two off each other's
    // tokens.
    it("marks a step with data-rank and never with data-tone", () => {
      expect(BAND_SRC).toContain("data-rank");
      expect(BAND_SRC).not.toContain("data-tone");
    });

    // NO HEX LITERAL, NO COLOUR AT ALL. Every tone comes from the stylesheet's `--rank-N-*`.
    it("names no colour of its own", () => {
      expect(BAND_SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(BAND_SRC).not.toContain("rgba(");
    });

    // The build's middlebox guard fails on a backtick surviving minification, and on a bare
    // `//` inside a runtime string. Newer modules in this package avoid template literals
    // outright rather than relying on the transpile.
    it("carries no template literal and no bare // in a string", () => {
      expect(BAND_SRC).not.toContain("`");
      expect(BAND_SRC).not.toContain("//");
    });
  });
}
