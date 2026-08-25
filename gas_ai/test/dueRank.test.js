// The two registers that sort by deadline, held to the same answer.
//
// A MIRROR TEST, not a unit test, because the defect this closes was a DIVERGENCE rather than
// a mistake — the shape test/assetQueryMirror.test.ts uses for the same class of problem. Two
// copies of `dueRank` shipped: `problemView.js` returned `Number.MAX_SAFE_INTEGER` for a row
// with no readable deadline and carried a comment explaining why, and `comboView.js` returned
// `Infinity` from four otherwise identical lines. The fix landed next door and never crossed.
//
// WHERE THE DEFECT ACTUALLY SHOWED, which is not where it looks like it should. Sorting with
// the bare comparator produces the same order either way: `Infinity - Infinity` is NaN, and
// V8's sort treats a NaN answer as "leave this pair alone", which for two undated rows is
// indistinguishable from the 0 the fixed version returns. Measured on 40 rows in both
// directions: byte-identical.
//
// It bites one level up. Both pages wrap the comparator the same way:
//
//     const d = cmp(a, b) * sign;
//     if (d !== 0) return d;
//     // …then the stable tiebreak on assetName, then id
//
// and `NaN !== 0` is TRUE. So an undated pair returned NaN, short-circuited past the tiebreak
// and was never ordered by asset name at all — it kept whatever order the payload arrived in,
// while every dated row around it obeyed the column. Measured: ascending, four rows, the old
// code answers `3,1,2,4` (undated rows in payload order) and the fixed code `3,2,4,1` (undated
// rows by asset name). That is the change, and it is why the cases below sort through
// `sortIssues`/`sortProblems` rather than through the comparators alone.

import { describe, expect, it } from "vitest";

import { ISSUE_COMPARATORS, sortIssues } from "../src/client/js/pages/comboView.js";
import { PROBLEM_COMPARATORS, sortProblems } from "../src/client/js/pages/problemView.js";

/** Undated rows whose asset names are OUT of alphabetical order, so the tiebreak has work. */
const ROWS = [
  { id: "1", dueAt: null, assetName: "zulu" },
  { id: "2", dueAt: null, assetName: "alpha" },
  { id: "3", dueAt: "2026-07-01T00:00:00Z", assetName: "mike" },
  { id: "4", dueAt: "not a date", assetName: "mike" },
];

const REGISTERS = [
  ["combos", sortIssues, ISSUE_COMPARATORS.due],
  ["priorities", sortProblems, PROBLEM_COMPARATORS.due],
];

const ids = (rows) => rows.map((r) => r.id);

describe.each(REGISTERS)("the %s register's Due column", (_name, sortRegister, cmp) => {
  it("puts the sooner deadline first", () => {
    expect(cmp(ROWS[2], { dueAt: "2026-09-01T00:00:00Z" })).toBeLessThan(0);
  });

  // The sentinel itself. A finite one is what lets `a - b` answer 0 for two undated rows
  // instead of NaN — see this file's header for why NaN is not the same as "equal".
  it("answers a real number for two rows that both lack a deadline", () => {
    const d = cmp(ROWS[0], ROWS[1]);
    expect(Number.isNaN(d)).toBe(false);
    expect(d).toBe(0);
  });

  // THE ASSERTION THAT FAILS ON THE OLD COMBOS CODE. With `Infinity`, the undated rows come
  // back as 1, 2, 4 — payload order — because NaN short-circuits the tiebreak.
  it("orders undated rows by the tiebreak rather than leaving them where they landed", () => {
    expect(ids(sortRegister(ROWS, "due", 1))).toEqual(["3", "2", "4", "1"]);
  });

  it("keeps every undated row after every dated one, in both directions", () => {
    expect(ids(sortRegister(ROWS, "due", 1)).slice(0, 1)).toEqual(["3"]);
    expect(ids(sortRegister(ROWS, "due", -1)).slice(-1)).toEqual(["3"]);
  });
});

// The point of one shared helper is not that each register is right. It is that they cannot
// disagree — which is the thing that was actually broken.
describe("the two registers agree", () => {
  it("on the sign of every pair", () => {
    for (const a of ROWS) {
      for (const b of ROWS) {
        expect(Math.sign(ISSUE_COMPARATORS.due(a, b)), a.id + " vs " + b.id)
          .toBe(Math.sign(PROBLEM_COMPARATORS.due(a, b)));
      }
    }
  });

  it("on the whole order, sorted through each page's own wrapper", () => {
    expect(ids(sortIssues(ROWS, "due", 1))).toEqual(ids(sortProblems(ROWS, "due", 1)));
    expect(ids(sortIssues(ROWS, "due", -1))).toEqual(ids(sortProblems(ROWS, "due", -1)));
  });
});
