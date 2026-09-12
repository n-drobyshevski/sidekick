// The client's category-cube reader against the domain layer's, over the same cubes.
//
// There are deliberately two implementations — the browser cannot import TypeScript — so the
// only thing keeping them honest is this file, in the shape of gas/test/riskCube.test.js: it
// pins src/client/js/categoryCubeModel.js against src/domain/settingsImpact.ts so the figures
// the register-scope picker shows while an operator checks and unchecks a candidate are the
// same figures a save would actually produce.

import { describe, expect, it } from "vitest";
import {
  categoryUnionCount as jsUnion,
  categoryMarginalCount as jsMarginal,
  categoryDroppedOnlyCount as jsDroppedOnly,
  categoryScopeImpact as jsScopeImpact,
} from "../src/client/js/categoryCubeModel.js";
import {
  buildCategoryCube,
  categoryUnionCount as tsUnion,
  categoryMarginalCount as tsMarginal,
  categoryDroppedOnlyCount as tsDroppedOnly,
  categoryScopeImpact as tsScopeImpact,
} from "../src/domain/settingsImpact";

const CANDIDATE_IDS = ["ai", "vuln", "threats", "data", "secrets", "identity"];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A population of open issue rows, each stamped with a random subset of the six candidates
 *  (never empty in practice, but occasionally a row stamped with none — the mask-0 case). */
function population(n = 400, seed = 4242) {
  const rng = mulberry32(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const categories = CANDIDATE_IDS.filter(() => rng() < 0.3);
    // Occasionally stamp with a category outside the candidate list too — the honest
    // "widened past the picker" case, which must not blow up the mask math.
    if (rng() < 0.1) categories.push("some-custom-id");
    rows.push({ categories });
  }
  return rows;
}

const rows = population();
// Half the candidates "configured", so measuredCandidateIds is a real subset worth comparing.
const configuredIds = [CANDIDATE_IDS[0], CANDIDATE_IDS[2], CANDIDATE_IDS[4]];
const cube = buildCategoryCube(rows, CANDIDATE_IDS, configuredIds);

const SELECTIONS = [
  [],
  [0],
  [1, 2],
  [0, 1, 2, 3, 4, 5],
  [5],
  [2, 4],
];

describe("the browser's category-cube reader matches the domain layer's", () => {
  it("built a cube worth comparing — a real subset of masks populated", () => {
    expect(Object.keys(cube.cells).length).toBeGreaterThan(1);
    expect(cube.total).toBe(rows.length);
  });

  for (const selected of SELECTIONS) {
    it(`agrees on the union count for ${JSON.stringify(selected)}`, () => {
      expect(jsUnion(cube, selected)).toBe(tsUnion(cube, selected));
    });
  }

  it("agrees on every per-candidate marginal", () => {
    for (let i = 0; i < CANDIDATE_IDS.length; i++) {
      expect(jsMarginal(cube, i)).toBe(tsMarginal(cube, i));
    }
  });

  it("agrees on dropped-only counts across selection pairs", () => {
    for (const prev of SELECTIONS) {
      for (const next of SELECTIONS) {
        const dropped = prev.filter((i) => next.indexOf(i) < 0);
        expect(jsDroppedOnly(cube, next, dropped), `${prev}->${next}`)
          .toBe(tsDroppedOnly(cube, next, dropped));
      }
    }
  });

  it("agrees on the combined scope-impact figure, ids in, numbers out", () => {
    const idsFor = (idx) => idx.map((i) => CANDIDATE_IDS[i]);
    for (const prev of SELECTIONS) {
      for (const next of SELECTIONS) {
        expect(jsScopeImpact(cube, idsFor(next), idsFor(prev)), `${prev}->${next}`)
          .toEqual(tsScopeImpact(cube, idsFor(next), idsFor(prev)));
      }
    }
  });

  it("defaults previousIds to selectedIds on both sides, so a first draft has nothing dropped", () => {
    const ids = ["vuln", "identity"];
    expect(jsScopeImpact(cube, ids)).toEqual(tsScopeImpact(cube, ids));
    expect(jsScopeImpact(cube, ids).droppedOnlyOpen).toBe(0);
  });
});

describe("degenerate inputs", () => {
  it("returns zeros rather than throwing when the payload never arrived", () => {
    expect(jsUnion(undefined, [0])).toBe(0);
    expect(jsUnion(null, [0])).toBe(0);
    expect(jsMarginal(undefined, 0)).toBe(0);
    expect(jsDroppedOnly(undefined, [0], [1])).toBe(0);
    expect(jsScopeImpact(undefined, ["ai"])).toEqual({
      inScopeOpen: 0, perCategory: {}, droppedOnlyOpen: 0,
    });
  });

  it("an empty selection is zero rows in scope, never every row", () => {
    expect(jsUnion(cube, [])).toBe(0);
    expect(tsUnion(cube, [])).toBe(0);
  });

  it("handles an empty cube", () => {
    const empty = buildCategoryCube([], CANDIDATE_IDS, []);
    expect(jsUnion(empty, [0, 1])).toBe(0);
    expect(jsScopeImpact(empty, ["ai"])).toEqual(tsScopeImpact(empty, ["ai"]));
  });
});
