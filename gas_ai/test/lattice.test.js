// Geometry only. `lattice.js` is the pure half of the decision lattice — which cell sits
// where, which gutters fall at an axis boundary, what a vector reads as in words, and what
// a renderer should paint — and this file holds it to that without a DOM, exactly the split
// `test/egoLayout.test.js` states: the logic is tested here, the pixels are checked in the
// dev harness. Vitest runs in node here (there is no vitest config and no jsdom), so
// nothing below may touch `document`.
//
// The one property worth naming up front, because it is the thing most likely to be
// "helpfully" broken later: emission order and ENUMERATION order coincide for the Problem
// lattice and deliberately do NOT for the Posture lattice, whose columns nest `consequence`
// outside `containment` while its enumeration nests it innermost. Nothing keys off position
// — every join goes through `keyOf(vector)` — so the
// divergence is harmless, and a test asserts it stays divergent so that nobody "fixes" the
// Posture emission order into agreement and quietly makes position look load-bearing.

import { describe, it, expect } from "vitest";
import {
  LATTICE_GUTTER_PX,
  PROBLEM_LATTICE,
  POSTURE_LATTICE,
  latticeCells,
  latticeHeaders,
  vectorSentence,
  paintCells,
  icicleLayout,
  outcomeMass,
} from "../src/client/js/lattice.js";
import { enumerateDecisionVectors, enumeratePostureVectors, leafKey, postureKey } from "../src/client/js/decideMirror.js";

const SPECS = [
  { name: "PROBLEM", spec: PROBLEM_LATTICE, enumerate: enumerateDecisionVectors, keyOf: leafKey, size: 54 },
  { name: "POSTURE", spec: POSTURE_LATTICE, enumerate: enumeratePostureVectors, keyOf: postureKey, size: 27 },
];

// ------------------------------------------------------------------------------- the cell set

describe("latticeCells is a bijection onto the enumeration", () => {
  for (const { name, spec, enumerate, keyOf, size } of SPECS) {
    it(`${name}: every leaf drawn exactly once, and nothing else`, () => {
      const cells = latticeCells(spec);
      expect(cells).toHaveLength(size);

      const drawn = cells.map((c) => c.key).sort();
      const expected = enumerate().map(keyOf).sort();
      expect(drawn).toEqual(expected);
      expect(new Set(drawn).size).toBe(size); // no key drawn twice

      // enumIndex must address the enumeration, not the emission order
      const byIndex = enumerate();
      for (const cell of cells) {
        expect(keyOf(byIndex[cell.enumIndex])).toBe(cell.key);
      }
      expect(new Set(cells.map((c) => c.enumIndex)).size).toBe(size);
    });
  }
});

describe("grid shape", () => {
  it("PROBLEM is one panel of 6 rows by 9 columns", () => {
    const cells = latticeCells(PROBLEM_LATTICE);
    expect(new Set(cells.map((c) => c.panel))).toEqual(new Set([null]));
    expect(new Set(cells.map((c) => c.row)).size).toBe(6); // exploitation(3) x impact(2)
    expect(new Set(cells.map((c) => c.col)).size).toBe(9); // exposure(3) x mission(3)
  });

  it("POSTURE is one panel of 3 rows by 9 columns", () => {
    const cells = latticeCells(POSTURE_LATTICE);
    expect(new Set(cells.map((c) => c.panel))).toEqual(new Set([null]));
    expect(new Set(cells.map((c) => c.row)).size).toBe(3); // capability
    expect(new Set(cells.map((c) => c.col)).size).toBe(9); // consequence(3) x containment(3)
    // Three consequence readings still group the columns; they are a band now rather than a
    // panel, which is the whole of the change. Each still covers three containment columns.
    for (const consequence of ["SEVERE", "MODERATE", "LIMITED"]) {
      expect(cells.filter((c) => c.vector.consequence === consequence)).toHaveLength(9);
    }
  });

  /**
   * The two tabs mount ONE component and are meant to look like it. They cannot have the same
   * cell count, so what has to match is the height the cells occupy: PROBLEM spends it on six
   * 38px rows plus two gutters, POSTURE on three 82px rows and no gutter, and both come to
   * 246. Everything above that band is the same two `auto` header rows in both grids, so
   * equal cell bands mean equal blocks.
   *
   * Computed from the specs rather than written down, and deliberately mirroring the
   * `rowTracks` algebra in ui/lattice.js, so that changing 38 or 82 or LATTICE_GUTTER_PX in
   * isolation fails HERE — where the reason is stated — instead of in the dev harness weeks
   * later as "the Posture tab looks small again", which is the bug this whole shape fixes.
   */
  it("both lattices' cell bands are the same height, which is what makes the two tabs match", () => {
    const bandHeight = (spec) => {
      const nRows = new Set(latticeCells(spec).map((c) => c.row)).size;
      const { rowBands } = latticeHeaders(spec);
      const group = rowBands.length > 1 ? rowBands[0].cells[0].span : nRows;
      return nRows * spec.rowPx + (nRows / group - 1) * LATTICE_GUTTER_PX;
    };
    expect(bandHeight(PROBLEM_LATTICE)).toBe(246);
    expect(bandHeight(POSTURE_LATTICE)).toBe(bandHeight(PROBLEM_LATTICE));
  });
});

// ------------------------------------------------------------------------------- the gutters

describe("gutter flags land on the outer-axis boundaries", () => {
  it("PROBLEM: a row gutter after each exploitation band, a col gutter after each exposure band", () => {
    const cells = latticeCells(PROBLEM_LATTICE);
    // The row group is exploitation; its inner axis is impact, whose last value is PARTIAL.
    for (const cell of cells) {
      expect(cell.rowGroupEnd).toBe(cell.vector.impact === "PARTIAL");
      expect(cell.colGroupEnd).toBe(cell.vector.mission === "LOW");
    }
    // Three exploitation bands and three exposure bands means three of each boundary.
    expect(new Set(cells.filter((c) => c.rowGroupEnd).map((c) => c.row)).size).toBe(3);
    expect(new Set(cells.filter((c) => c.colGroupEnd).map((c) => c.col)).size).toBe(3);
  });

  it("POSTURE: a col gutter after each consequence band, and none at all on the rows", () => {
    const cells = latticeCells(POSTURE_LATTICE);
    // A gutter separates two BANDS of an outer axis. Posture's columns are consequence over
    // containment, so the boundary falls after containment's last value; its rows are one
    // axis, so there is no outer axis, no band, and nothing to separate — false everywhere
    // rather than true everywhere.
    for (const cell of cells) {
      expect(cell.rowGroupEnd).toBe(false);
      expect(cell.colGroupEnd).toBe(cell.vector.containment === "STRONG");
    }
    expect(new Set(cells.filter((c) => c.colGroupEnd).map((c) => c.col)).size).toBe(3);
  });
});

// -------------------------------------------------------------------------- emission ordering

describe("emission order versus enumeration order", () => {
  it("PROBLEM: row-major emission IS enumeration order", () => {
    const cells = latticeCells(PROBLEM_LATTICE);
    cells.forEach((cell, i) => expect(cell.enumIndex).toBe(i));
  });

  it("POSTURE: row-major emission is NOT enumeration order, and must stay that way", () => {
    // The grid nests consequence OUTSIDE containment in its columns while the enumeration
    // nests it innermost, so the two orders permute each other. Asserted explicitly so a
    // later "tidy-up" that makes these agree fails here instead of silently making cell
    // position look like it carries identity. Nothing joins on position; everything joins
    // on keyOf(vector).
    const cells = latticeCells(POSTURE_LATTICE);
    const identical = cells.every((cell, i) => cell.enumIndex === i);
    expect(identical).toBe(false);
    // ...but it is still a permutation, which is what actually matters.
    expect([...cells.map((c) => c.enumIndex)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 27 }, (_, i) => i),
    );
  });
});

// -------------------------------------------------------------------------------- the headers

describe("latticeHeaders", () => {
  it("PROBLEM has two band levels per dimension, the outer one spanning the inner axis", () => {
    const { rowBands, colBands } = latticeHeaders(PROBLEM_LATTICE);
    expect(rowBands).toHaveLength(2);
    expect(colBands).toHaveLength(2);

    // outer row level: 3 exploitation bands, each spanning the 2 impact values
    expect(rowBands[0].cells).toHaveLength(3);
    for (const band of rowBands[0].cells) expect(band.span).toBe(2);
    expect(rowBands[1].cells).toHaveLength(6);

    // outer col level: 3 exposure bands, each spanning the 3 mission values
    expect(colBands[0].cells).toHaveLength(3);
    for (const band of colBands[0].cells) expect(band.span).toBe(3);
    expect(colBands[1].cells).toHaveLength(9);
  });

  it("bands tile their dimension with no gap and no overlap", () => {
    for (const { spec } of SPECS) {
      const { rowBands, colBands } = latticeHeaders(spec);
      for (const level of [...rowBands, ...colBands]) {
        let cursor = 0;
        for (const band of level.cells) {
          expect(band.start).toBe(cursor);
          cursor += band.span;
        }
      }
    }
  });

  it("POSTURE has one row band level and two column levels", () => {
    const { rowBands, colBands } = latticeHeaders(POSTURE_LATTICE);
    // one row axis (capability), so one level and no outer band to span anything
    expect(rowBands).toHaveLength(1);
    expect(rowBands[0].cells).toHaveLength(3);

    // outer col level: 3 consequence bands, each spanning the 3 containment values
    expect(colBands).toHaveLength(2);
    expect(colBands[0].cells).toHaveLength(3);
    for (const band of colBands[0].cells) expect(band.span).toBe(3);
    expect(colBands[1].cells).toHaveLength(9);
  });
});

// ------------------------------------------------------------------------------ words

describe("vectorSentence", () => {
  it("names every axis, in the spec's own axis order", () => {
    const sentence = vectorSentence(PROBLEM_LATTICE, {
      exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "HIGH",
    });
    for (const axis of PROBLEM_LATTICE.axes) expect(sentence.toLowerCase()).toContain(axis.label.toLowerCase());
    expect(sentence).not.toMatch(/ACTIVE|TOTAL|OPEN|HIGH/); // screaming enum values never reach a reader
  });

  it("covers every leaf of both lattices without producing a duplicate", () => {
    for (const { spec } of SPECS) {
      const sentences = latticeCells(spec).map((c) => vectorSentence(spec, c.vector));
      expect(new Set(sentences).size).toBe(sentences.length);
      for (const s of sentences) expect(s.length).toBeGreaterThan(0);
    }
  });
});

// -------------------------------------------------------------------------------- paintCells

const CELLS = latticeCells(PROBLEM_LATTICE);
const POSTURE_CELLS = latticeCells(POSTURE_LATTICE);
/**
 * The whole tone vocabulary, and the reason it is ONE ramp rather than two palettes.
 *
 * Both scales are ordinal and both are sorted on in the domain: `OUTCOME_VALUES` is
 * documented worst-first with an order that is "load-bearing wherever a caller sorts by
 * it", and compareProblems (problems.ts) and pickAction (actions.ts) independently spell
 * out ACT < ATTEND < TRACK_STAR < TRACK. Tiers are 4..1 the same way. So an outcome and a
 * tier at the same rank paint the same step, and the WORD tells you which scale you are
 * reading — which matters, because problems.js draws an outcome and a tier in one row.
 *
 * `neutral` is in the list but nothing routes to it: paintCells falls back to it for a key
 * no tone map recognises. It is the fallback, not a fifth step.
 */
const RANK_TONES = ["rank1", "rank2", "rank3", "rank4"];
const TONES = [...RANK_TONES, "neutral"];
/** A stand-in decide: ACT for the first leaf, TRACK for everything else. */
const decideA = (v) => (v.exploitation === "ACTIVE" ? { outcome: "ACT", matchedRuleIndex: 0 }
  : { outcome: "TRACK", matchedRuleIndex: -1 });
const decideB = (v) => (v.exploitation === "ACTIVE" ? { outcome: "ATTEND", matchedRuleIndex: 0 }
  : { outcome: "TRACK", matchedRuleIndex: -1 });
/**
 * The posture side of the same stand-in. `decide` is handed the vector and nothing else, so
 * the tier is derived from the vector rather than a counter, and the mapping is chosen so
 * that all four steps are actually reached across the 27 cells.
 */
const decideTier = (v) => ({
  tier: v.capability === "BROAD" ? 4 : v.containment === "WEAK" ? 3 : v.consequence === "SEVERE" ? 2 : 1,
  matchedRuleIndex: 0,
});

describe("paintCells", () => {
  it("never mints a tone outside the existing pill kinds", () => {
    for (const mode of ["rule", "landscape", "change", "impact"]) {
      const painted = paintCells(CELLS, {
        mode, decide: decideA, savedDecide: decideB, occupancy: {}, occupancyKnown: true,
      });
      for (const cell of painted) expect(TONES).toContain(cell.tone);
    }
  });

  it("paints both scales from the one ordinal ramp", () => {
    const outcomes = paintCells(CELLS, { mode: "rule", decide: decideA });
    for (const cell of outcomes) expect(RANK_TONES).toContain(cell.tone);

    const tiers = paintCells(POSTURE_CELLS, { mode: "rule", decide: decideTier });
    for (const cell of tiers) expect(RANK_TONES).toContain(cell.tone);
  });

  /**
   * The ramp is ordered, and the order is the domain's. A rank that drifted out of step
   * with OUTCOME_VALUES or the tier numbering would paint a worse thing more quietly than
   * the thing it outranks — exactly the defect this ramp replaced, where TRACK_STAR was
   * neutral grey while ranking above the green TRACK.
   */
  it("ranks each scale worst-first, and the two agree", () => {
    const rankOf = (cells, result) =>
      Number(paintCells(cells, { mode: "rule", decide: () => result })[0].tone.replace("rank", ""));
    const outcome = (o) => rankOf(CELLS, { outcome: o, matchedRuleIndex: 0 });
    const tier = (t) => rankOf(POSTURE_CELLS, { tier: t, matchedRuleIndex: 0 });

    expect([outcome("ACT"), outcome("ATTEND"), outcome("TRACK_STAR"), outcome("TRACK")])
      .toEqual([4, 3, 2, 1]);
    expect([tier(4), tier(3), tier(2), tier(1)]).toEqual([4, 3, 2, 1]);
    // TRACK_STAR outranks TRACK — the relationship the old neutral grey inverted.
    expect(outcome("TRACK_STAR")).toBeGreaterThan(outcome("TRACK"));
  });

  it("rule mode counts nothing and carries the deciding row", () => {
    const painted = paintCells(CELLS, { mode: "rule", decide: decideA });
    expect(painted).toHaveLength(54);
    for (const cell of painted) {
      expect(cell.count).toBeNull();
      expect(cell.unmeasured).toBe(false);
      expect(cell.changed).toBe(false);
    }
    expect(painted.filter((c) => c.ruleIndex === 0)).toHaveLength(18); // every ACTIVE leaf
    expect(painted.filter((c) => c.ruleIndex === -1)).toHaveLength(36);
  });

  it("landscape mode keeps 'not measured yet' and 'zero' apart", () => {
    const someKey = CELLS[0].key;

    const unmeasured = paintCells(CELLS, {
      mode: "landscape", decide: decideA, occupancy: {}, occupancyKnown: false,
    });
    for (const cell of unmeasured) {
      expect(cell.unmeasured).toBe(true);
      expect(cell.count).toBeNull();
      expect(cell.hatched).toBe(false); // "never asked" is not "asked and found nothing"
    }

    const measured = paintCells(CELLS, {
      mode: "landscape", decide: decideA, occupancy: { [someKey]: 7 }, occupancyKnown: true,
    });
    const hit = measured.find((c) => c.key === someKey);
    expect(hit.count).toBe(7);
    expect(hit.hatched).toBe(false);
    expect(hit.unmeasured).toBe(false);

    const empty = measured.find((c) => c.key !== someKey);
    expect(empty.count).toBe(0);
    expect(empty.hatched).toBe(true);
    expect(empty.unmeasured).toBe(false);
  });

  it("change mode flags only the cells whose outcome actually moves, with a direction", () => {
    const painted = paintCells(CELLS, { mode: "change", decide: decideA, savedDecide: decideB });
    const moved = painted.filter((c) => c.changed);
    expect(moved).toHaveLength(18); // ATTEND -> ACT on every ACTIVE leaf
    for (const cell of moved) expect(cell.direction).toBeTruthy();
    for (const cell of painted.filter((c) => !c.changed)) expect(cell.direction).toBeNull();
    for (const cell of painted) expect(cell.count).toBeNull(); // this mode counts nothing
  });

  it("impact mode carries occupancy AND change at once", () => {
    const someKey = CELLS[0].key;
    const painted = paintCells(CELLS, {
      mode: "impact", decide: decideA, savedDecide: decideB,
      occupancy: { [someKey]: 3 }, occupancyKnown: true,
    });
    const hit = painted.find((c) => c.key === someKey);
    expect(hit.count).toBe(3);
    expect(hit.changed).toBe(true);
  });

  it("every mode produces a non-empty aria fragment for every cell", () => {
    for (const mode of ["rule", "landscape", "change", "impact"]) {
      const painted = paintCells(CELLS, {
        mode, decide: decideA, savedDecide: decideB, occupancy: {}, occupancyKnown: true,
      });
      for (const cell of painted) {
        expect(typeof cell.aria).toBe("string");
        expect(cell.aria.length).toBeGreaterThan(0);
      }
    }
  });
});

// ------------------------------------------------------------------------------ icicleLayout

describe("icicleLayout", () => {
  it("partitions the canvas with no gap and no overlap, at every level", () => {
    const W = 900;
    const H = 648;
    const layout = icicleLayout(PROBLEM_LATTICE, W, H);
    expect(layout.width).toBe(W);
    expect(layout.height).toBe(H);
    const bands = layout.bands;

    const byLevel = new Map();
    for (const band of bands) {
      if (!byLevel.has(band.level)) byLevel.set(band.level, []);
      byLevel.get(band.level).push(band);
    }
    // one band level per axis, plus the outcome column
    expect(byLevel.size).toBe(PROBLEM_LATTICE.axes.length + 1);

    for (const [, level] of byLevel) {
      const sorted = [...level].sort((a, b) => a.y - b.y);
      let cursor = 0;
      for (const band of sorted) {
        expect(band.y).toBeCloseTo(cursor, 6); // no gap, no overlap
        cursor += band.h;
      }
      expect(cursor).toBeCloseTo(H, 6); // and the level fills the height exactly
      for (const band of sorted) expect(band.w).toBeCloseTo(W / (PROBLEM_LATTICE.axes.length + 1), 6);
    }
  });

  it("the leaf column carries one band per leaf, keyed like every other join", () => {
    const leaves = icicleLayout(PROBLEM_LATTICE, 900, 648).bands.filter((b) => b.kind === "outcome");
    expect(leaves).toHaveLength(54);
    expect(new Set(leaves.map((b) => b.key)).size).toBe(54);
    expect(leaves.map((b) => b.key).sort()).toEqual(enumerateDecisionVectors().map(leafKey).sort());
  });

  it("scales with the measured width rather than assuming one", () => {
    const narrow = icicleLayout(PROBLEM_LATTICE, 600, 400).bands;
    const wide = icicleLayout(PROBLEM_LATTICE, 1200, 400).bands;
    expect(wide[0].w).toBeCloseTo(narrow[0].w * 2, 6);
    expect(wide[0].h).toBeCloseTo(narrow[0].h, 6);
  });
});

// ------------------------------------------------------------------------------ outcomeMass

describe("outcomeMass", () => {
  const ORDER = ["ACT", "ATTEND", "TRACK_STAR", "TRACK"];

  it("matches problemRule.ts's own ceiling arithmetic on the documented default", () => {
    // DEFAULT_PROBLEM_RULE: ACT claims 6 of 54 against a 0.15 ceiling. problemRule.ts
    // computes the share as byOutcome.ACT / total and compares it with `>`, so 11.1% is
    // under and the rule validates. Pinned here so the strip and the validator cannot drift.
    const mass = outcomeMass({ ACT: 6, ATTEND: 19, TRACK_STAR: 17, TRACK: 12 }, ORDER, 0.15);
    expect(mass.segments.map((s) => s.count)).toEqual([6, 19, 17, 12]);
    expect(mass.segments[0].share).toBeCloseTo(6 / 54, 10);
    expect(mass.over).toBe(false);
    expect(mass.sentence).toContain("11.1%");
    expect(mass.sentence).toContain("15.0%");
  });

  it("shares sum to one, and the worst key is the one measured against the ceiling", () => {
    const mass = outcomeMass({ ACT: 20, ATTEND: 10, TRACK_STAR: 10, TRACK: 14 }, ORDER, 0.15);
    expect(mass.segments.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1, 10);
    expect(mass.over).toBe(true); // 20/54 = 37%
  });

  it("a boundary share is not over — the validator uses a strict >", () => {
    const mass = outcomeMass({ ACT: 15, ATTEND: 0, TRACK_STAR: 0, TRACK: 85 }, ORDER, 0.15);
    expect(mass.segments[0].share).toBeCloseTo(0.15, 10);
    expect(mass.over).toBe(false);
  });

  it("an empty tally divides by nothing rather than by zero", () => {
    const mass = outcomeMass({ ACT: 0, ATTEND: 0, TRACK_STAR: 0, TRACK: 0 }, ORDER, 0.15);
    for (const seg of mass.segments) expect(seg.share).toBe(0);
    expect(mass.over).toBe(false);
  });
});

// ------------------------------------------------------------------------- axis naming

/**
 * The span rule, pinned. Inlining an axis name is free only where the band spans more than
 * one cell; anywhere else it widens every column in the grid to buy room for one word. Rows
 * never inline whatever their span, because a row band spans vertically and vertical span
 * buys no horizontal room.
 *
 * The property that matters most is the last one: between the inline names and the corner
 * key, every axis is named exactly once — never zero times (the bug being fixed) and never
 * twice (which would read as two different things being named).
 */
describe("axis naming", () => {
  it("PROBLEM inlines the wide column band and keys the rest", () => {
    const { rowBands, colBands, key } = latticeHeaders(PROBLEM_LATTICE);
    // exposure spans 3 mission columns, so its name rides along for free
    expect(colBands[0].inlineName).toBe(true);
    expect(colBands[0].cells[0].span).toBe(3);
    // mission's own cells are one column wide — no room, so it goes in the key
    expect(colBands[1].inlineName).toBe(false);
    expect(colBands[1].cells[0].span).toBe(1);
    // rows never inline, even though exploitation's band spans 2 rows
    expect(rowBands[0].cells[0].span).toBe(2);
    expect(rowBands.every((b) => b.inlineName === false)).toBe(true);

    expect(key.rows).toEqual(["Exploitation", "Impact"]);
    expect(key.cols).toEqual(["Mission"]);
  });

  it("POSTURE inlines its wide column band and keys the rest, exactly as PROBLEM does", () => {
    const { rowBands, colBands, key } = latticeHeaders(POSTURE_LATTICE);
    // consequence spans 3 containment columns, so its name rides along for free
    expect(colBands[0].inlineName).toBe(true);
    expect(colBands[0].cells[0].span).toBe(3);
    // containment's own cells are one column wide — no room, so it goes in the key
    expect(colBands[1].inlineName).toBe(false);
    expect(colBands[1].cells[0].span).toBe(1);
    // rows never inline, and capability's band spans one row anyway
    expect(rowBands.every((b) => b.inlineName === false)).toBe(true);

    expect(key.rows).toEqual(["Capability"]);
    expect(key.cols).toEqual(["Containment"]);
  });

  it("every axis is named exactly once, inline or in the key", () => {
    for (const { spec } of SPECS) {
      const { rowBands, colBands, key } = latticeHeaders(spec);
      const inlined = [...rowBands, ...colBands].filter((b) => b.inlineName).map((b) => b.shortLabel);
      const keyed = [...key.rows, ...key.cols];
      const named = [...inlined, ...keyed];
      const expected = [...spec.rows, ...spec.cols]
        .map((k) => spec.axes.find((a) => a.key === k))
        .map((a) => a.shortLabel || a.label);
      expect(named.slice().sort()).toEqual(expected.slice().sort());
      expect(new Set(named).size).toBe(named.length); // nothing named twice
    }
  });

  it("a short label is always available, falling back to the full one", () => {
    for (const { spec } of SPECS) {
      for (const band of latticeHeaders(spec).rowBands.concat(latticeHeaders(spec).colBands)) {
        expect(typeof band.shortLabel).toBe("string");
        expect(band.shortLabel.length).toBeGreaterThan(0);
      }
    }
  });
});
