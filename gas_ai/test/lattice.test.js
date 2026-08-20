// Geometry only. `lattice.js` is the pure half of the decision lattice — which cell sits
// where, which gutters fall at an axis boundary, what a vector reads as in words, and what
// a renderer should paint — and this file holds it to that without a DOM, exactly the split
// `test/egoLayout.test.js` states: the logic is tested here, the pixels are checked in the
// dev harness. Vitest runs in node here (there is no vitest config and no jsdom), so
// nothing below may touch `document`.
//
// The one property worth naming up front, because it is the thing most likely to be
// "helpfully" broken later: emission order and ENUMERATION order coincide for the Problem
// lattice and deliberately do NOT for the Posture lattice, which hoists `consequence` out
// into panels. Nothing keys off position — every join goes through `keyOf(vector)` — so the
// divergence is harmless, and a test asserts it stays divergent so that nobody "fixes" the
// Posture emission order into agreement and quietly makes position look load-bearing.

import { describe, it, expect } from "vitest";
import {
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

  it("POSTURE is three panels of 3 rows by 3 columns", () => {
    const cells = latticeCells(POSTURE_LATTICE);
    expect(new Set(cells.map((c) => c.panel))).toEqual(new Set(["SEVERE", "MODERATE", "LIMITED"]));
    expect(new Set(cells.map((c) => c.row)).size).toBe(3); // capability
    expect(new Set(cells.map((c) => c.col)).size).toBe(3); // containment
    for (const panel of ["SEVERE", "MODERATE", "LIMITED"]) {
      expect(cells.filter((c) => c.panel === panel)).toHaveLength(9);
    }
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

  it("POSTURE: a one-axis dimension has no group boundaries at all", () => {
    // A gutter separates two BANDS of an outer axis. Posture's rows and columns are one
    // axis each, so there is no outer axis, no band, and nothing to separate — the flag is
    // false everywhere rather than true everywhere. (The panels do the separating here, and
    // they are a different mechanism: `cell.panel`, not `cell.colGroupEnd`.)
    for (const cell of latticeCells(POSTURE_LATTICE)) {
      expect(cell.rowGroupEnd).toBe(false);
      expect(cell.colGroupEnd).toBe(false);
    }
  });
});

// -------------------------------------------------------------------------- emission ordering

describe("emission order versus enumeration order", () => {
  it("PROBLEM: row-major emission IS enumeration order", () => {
    const cells = latticeCells(PROBLEM_LATTICE);
    cells.forEach((cell, i) => expect(cell.enumIndex).toBe(i));
  });

  it("POSTURE: row-major emission is NOT enumeration order, and must stay that way", () => {
    // consequence is hoisted into panels, so emission nests consequence OUTSIDE capability
    // and containment while the enumeration nests it innermost. Asserted explicitly so a
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

  it("POSTURE has a single band level per dimension", () => {
    const { rowBands, colBands } = latticeHeaders(POSTURE_LATTICE);
    expect(rowBands).toHaveLength(1);
    expect(colBands).toHaveLength(1);
    expect(rowBands[0].cells).toHaveLength(3);
    expect(colBands[0].cells).toHaveLength(3);
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
 * The whole tone vocabulary, and the reason it is two sets rather than one.
 *
 * A problem OUTCOME is categorical: Act, Attend, Track ★ and Track are four kinds of
 * answer, and `Track ★` is a genuine unknown rather than a step between Attend and Track —
 * so it keeps the neutral pill and the four keep the semantic tones.
 *
 * A posture TIER is ordinal: 1 through 4 is one scale read in one direction, and painting
 * it with the semantic four made Tier 2 the neutral grey, which reads as "disabled" rather
 * than "second of four". The tier steps are that scale.
 *
 * The pin still means what it always meant — a painter may not invent a fifth kind — but
 * it now has to name eight, and which set a cell draws from depends on which lattice it
 * belongs to. That is the fork, asserted below rather than described.
 */
const OUTCOME_TONES = ["bad", "warn", "neutral", "ok"];
const TIER_TONES = ["tier1", "tier2", "tier3", "tier4"];
const TONES = [...OUTCOME_TONES, ...TIER_TONES];
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

  it("keeps the two vocabularies apart: outcomes are categorical, tiers are the ordinal scale", () => {
    const outcomes = paintCells(CELLS, { mode: "rule", decide: decideA });
    for (const cell of outcomes) expect(OUTCOME_TONES).toContain(cell.tone);

    const tiers = paintCells(POSTURE_CELLS, { mode: "rule", decide: decideTier });
    for (const cell of tiers) expect(TIER_TONES).toContain(cell.tone);
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
 * one cell; anywhere else it widens a header and, on the Posture lattice, pushes the third
 * small-multiple panel off its row. Rows never inline whatever their span, because a row
 * band spans vertically and vertical span buys no horizontal room.
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

  it("POSTURE inlines nothing, because one column axis means one-cell bands", () => {
    const { rowBands, colBands, key } = latticeHeaders(POSTURE_LATTICE);
    expect(colBands[0].cells[0].span).toBe(1);
    expect(colBands.every((b) => b.inlineName === false)).toBe(true);
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
