// The Executive share column's isotype, held at the half that can be WRONG.
//
// There is no jsdom here (vitest.config.ts sets no `environment`), which is exactly why the
// arithmetic lives in two exported pure functions rather than inside the cell builder: what
// can go wrong about a pictogram is not how it is appended, it is how many marks it claims —
// and a mark count is a claim about a population.
//
// THE TWO CLAIMS THIS FILE PINS:
//
//   1. The unit is PER TABLE. `pictogramUnit` is handed the largest row and picks the finest
//      rung that keeps it inside 40 marks, so every other row draws fewer marks IN THE SAME
//      UNIT. A per-row unit would make 280 open and 30 open draw the same picture; a cap would
//      truncate the largest register, which is the one most worth reading.
//   2. Absent is never zero, and it is never three either. `pictogramCounts` refuses a
//      non-number BEFORE any cast. The perturbation at the bottom reproduces the cast-first
//      rewrite inline and shows exactly which value the two forms disagree about — CLAUDE.md's
//      rule that a guard which fires on nothing is a finding rather than a pass.

import { describe, expect, it } from "vitest";

import { pictogramCounts, pictogramUnit } from "../src/client/js/pages/executive.js";

describe("pictogramUnit — one unit for the whole table", () => {
  it("40 open picks unit 10", () => {
    expect(pictogramUnit(40)).toBe(10);
  });

  it("401 open picks unit 20", () => {
    // 401 / 10 is 40.1, one tenth of a mark over the ceiling — the ladder steps rather than
    // letting the biggest row run past 40 marks.
    expect(pictogramUnit(401)).toBe(20);
    expect(pictogramUnit(400)).toBe(10);
  });

  it("18 800 open picks unit 500", () => {
    // The live SCA register's order of magnitude: 18 800 / 500 is 37.6 marks.
    expect(pictogramUnit(18800)).toBe(500);
  });

  it("a non-finite maximum falls back to 10", () => {
    for (const bad of [null, undefined, "", [], false, NaN, Infinity, "400", ["400"]]) {
      expect(pictogramUnit(bad)).toBe(10);
    }
    // Non-positive is the same refusal: there is no table to size against.
    expect(pictogramUnit(0)).toBe(10);
    expect(pictogramUnit(-50)).toBe(10);
  });

  it("the largest register still fits inside 40 marks at the unit it picks", () => {
    for (const n of [1, 40, 401, 999, 18800, 250000]) {
      expect(n / pictogramUnit(n)).toBeLessThanOrEqual(40);
    }
  });
});

describe("pictogramCounts — whole marks, and how much of one more", () => {
  it("0 open draws no marks", () => {
    expect(pictogramCounts(0, 10)).toEqual({ full: 0, partialTenths: 0 });
  });

  it("9 open at unit 10 is a partial mark and no full one", () => {
    expect(pictogramCounts(9, 10)).toEqual({ full: 0, partialTenths: 9 });
  });

  it("10 open is one full mark and no partial", () => {
    expect(pictogramCounts(10, 10)).toEqual({ full: 1, partialTenths: 0 });
  });

  it("106 open is ten full marks and a six-tenths one", () => {
    expect(pictogramCounts(106, 10)).toEqual({ full: 10, partialTenths: 6 });
  });

  it("280 open is twenty-eight full marks", () => {
    expect(pictogramCounts(280, 10)).toEqual({ full: 28, partialTenths: 0 });
  });

  it("a remainder that rounds to ten carries into a full mark", () => {
    // 199 at unit 20: nine whole marks and 19/20 of one more, which rounds to ten tenths. Ten
    // tenths IS a full mark — drawing it as a "partial" one would be a mark clipped to 100%,
    // pixel-identical to a full mark and one short in the count.
    expect(pictogramCounts(199, 20)).toEqual({ full: 10, partialTenths: 0 });
    expect(pictogramCounts(198, 20)).toEqual({ full: 9, partialTenths: 9 });
  });

  it("a non-finite count draws nothing", () => {
    for (const bad of [null, undefined, "", [], false, NaN, Infinity, -1, "3", ["3"], {}]) {
      expect(pictogramCounts(bad, 10)).toEqual({ full: 0, partialTenths: 0 });
    }
  });

  it("a non-finite or non-positive unit draws nothing", () => {
    for (const bad of [null, undefined, "", [], false, NaN, 0, -10, "10"]) {
      expect(pictogramCounts(106, bad)).toEqual({ full: 0, partialTenths: 0 });
    }
  });

  it("the marks always account for the whole count, to within a tenth of a unit", () => {
    const unit = 50;
    for (const n of [1, 49, 50, 51, 137, 999, 18800]) {
      const { full, partialTenths } = pictogramCounts(n, unit);
      const drawn = (full + partialTenths / 10) * unit;
      expect(Math.abs(drawn - n)).toBeLessThanOrEqual(unit / 20);
    }
  });
});

describe("the perturbation — cast first and the refusal stops biting", () => {
  // The defective rewrite, inline, exactly as the "simplify the two branches" edit would leave
  // it: cast first, then let Number.isFinite decide. CLAUDE.md records this same shape biting
  // three times; the point of reproducing it here rather than asserting the rule from a comment
  // is that a future reader can SEE which inputs the two forms disagree about.
  function pictogramCountsCastFirst(n, unit) {
    const v = Number(n);
    const u = Number(unit);
    if (!Number.isFinite(v) || v <= 0) return { full: 0, partialTenths: 0 };
    if (!Number.isFinite(u) || u <= 0) return { full: 0, partialTenths: 0 };
    const full = Math.floor(v / u);
    const tenths = Math.round((10 * (v % u)) / u);
    return tenths >= 10
      ? { full: full + 1, partialTenths: 0 }
      : { full, partialTenths: Math.max(0, tenths) };
  }

  it("agrees with the guarded form on everything that was really a number", () => {
    for (const n of [0, 1, 9, 10, 106, 198, 199, 280, 18800]) {
      expect(pictogramCountsCastFirst(n, 10)).toEqual(pictogramCounts(n, 10));
    }
  });

  it("disagrees on a value that was never a measurement, and that is the whole guard", () => {
    // These four all cast to 0 and are refused by BOTH forms — which is why a refusal set made
    // only of them would pass against the defective rewrite and prove nothing.
    for (const silent of [null, "", [], false]) {
      expect(pictogramCountsCastFirst(silent, 10)).toEqual({ full: 0, partialTenths: 0 });
      expect(pictogramCounts(silent, 10)).toEqual({ full: 0, partialTenths: 0 });
    }

    // These are where the two forms part company. `Number(["3"])` is 3: a one-element array of
    // a numeric string casts clean, and the cast-first version draws three tenths of a mark for
    // it. The guarded version refuses it, because it was never a number.
    for (const bites of ["3", ["3"], "106"]) {
      expect(pictogramCounts(bites, 10)).toEqual({ full: 0, partialTenths: 0 });
      expect(pictogramCountsCastFirst(bites, 10)).not.toEqual({ full: 0, partialTenths: 0 });
    }
    expect(pictogramCountsCastFirst(["3"], 10)).toEqual({ full: 0, partialTenths: 3 });
    expect(pictogramCountsCastFirst("106", 10)).toEqual({ full: 10, partialTenths: 6 });

    // The unit refuses on the same asymmetry: a stringly-typed unit reaches the arithmetic in
    // the cast-first form and silently sizes the whole table.
    expect(pictogramCounts(106, "10")).toEqual({ full: 0, partialTenths: 0 });
    expect(pictogramCountsCastFirst(106, "10")).toEqual({ full: 10, partialTenths: 6 });
  });
});
