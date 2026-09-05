// How a register orders and pages its rows.
//
// Plain .js for the reason navFlyout.test.js writes out: tsconfig has no allowJs and includes
// test/**/*.ts, so a .ts test importing a client .js module fails `tsc --noEmit`, and
// `npm run check` is typecheck && test && build — vitest would never run.
//
// The cases here are the ones where a table could quietly lie about its own data: an unknown
// presented as the smallest value, a pair of tied rows that swaps places between two identical
// repaints, and a page cut that drops or repeats a row at a boundary. None of those look like
// bugs on screen. They look like the data.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE, PAGE_SIZES, compareValues, nullsLast, pageForSize, pageOf, sortRows,
  triState,
} from "../../gas_shared/ui/tableModel.js";
import { pageOf as mirrorPageOf } from "../src/client/js/assetQuery.js";

const ids = (rows) => rows.map((r) => r.id);

describe("compareValues", () => {
  it("subtracts numbers rather than comparing them as text", () => {
    expect(compareValues(9, 10)).toBeLessThan(0);
    expect(compareValues(10, 9)).toBeGreaterThan(0);
    expect(compareValues(2, 2)).toBe(0);
  });

  it("reads false as lower than true", () => {
    expect(compareValues(false, true)).toBeLessThan(0);
    expect(compareValues(true, true)).toBe(0);
  });

  // Without the fold, every capitalised name sorts into its own block ahead of the lowercase
  // ones — which reads as two columns interleaved rather than one column sorted.
  it("folds case, so Zebra does not lead apple", () => {
    expect(compareValues("Zebra", "apple")).toBeGreaterThan(0);
    expect(compareValues("Apple", "apple")).toBe(0);
  });
});

describe("nullsLast", () => {
  it("says nothing when both values are present", () => {
    expect(nullsLast(1, 2)).toBeNull();
    expect(nullsLast("", "a")).toBeNull(); // empty string is a value, not an absence
    expect(nullsLast(0, false)).toBeNull();
  });

  it("treats null and undefined as the same absence", () => {
    expect(nullsLast(null, undefined)).toBe(0);
    expect(nullsLast(null, 1)).toBe(1);
    expect(nullsLast(1, undefined)).toBe(-1);
  });
});

describe("sortRows", () => {
  const rows = [
    { id: "a", n: 3 }, { id: "b", n: null }, { id: "c", n: 1 },
    { id: "d", n: undefined }, { id: "e", n: 2 },
  ];
  const byN = (r) => r.n;

  it("orders the present values and leaves the input alone", () => {
    const out = sortRows(rows, { value: byN });
    expect(ids(out).slice(0, 3)).toEqual(["c", "e", "a"]);
    expect(ids(rows)).toEqual(["a", "b", "c", "d", "e"]);
  });

  // THE RULE THIS FILE EXISTS FOR. An unknown is not a small value. If it led the ascending
  // page, the rows someone sorted the column to find would be pushed off the first screen, and
  // reversing the sort would then bury the other half — so neither direction answers.
  it("sinks unknowns to the bottom in BOTH directions", () => {
    expect(ids(sortRows(rows, { value: byN })).slice(3)).toEqual(["b", "d"]);
    expect(ids(sortRows(rows, { value: byN, descending: true })).slice(3)).toEqual(["b", "d"]);
  });

  it("reverses only the present values when descending", () => {
    expect(ids(sortRows(rows, { value: byN, descending: true })).slice(0, 3))
      .toEqual(["a", "e", "c"]);
  });

  // A register's input order IS its previous sort, so a column of many equal values appears to
  // shuffle itself when a reader sorts away and comes back. The second key fixes the
  // arrangement to the data instead of to the click history.
  it("breaks a tie by the second key, the same way every time", () => {
    const tied = [
      { id: "x", sev: "HIGH", name: "zulu" },
      { id: "y", sev: "HIGH", name: "alpha" },
      { id: "z", sev: "HIGH", name: "mike" },
    ];
    const spec = { value: (r) => r.sev, tiebreak: (r) => r.name };
    expect(ids(sortRows(tied, spec))).toEqual(["y", "z", "x"]);
    // Re-sorting an already-sorted list must not move anything.
    expect(ids(sortRows(sortRows(tied, spec), spec))).toEqual(["y", "z", "x"]);
  });

  it("does not flip the tiebreak when the column is descending", () => {
    const tied = [{ id: "x", sev: "HIGH", name: "zulu" }, { id: "y", sev: "HIGH", name: "alpha" }];
    const spec = { value: (r) => r.sev, tiebreak: (r) => r.name };
    expect(ids(sortRows(tied, spec))).toEqual(["y", "x"]);
    expect(ids(sortRows(tied, Object.assign({ descending: true }, spec)))).toEqual(["y", "x"]);
  });

  it("keeps the input order when there is nothing to sort by", () => {
    expect(ids(sortRows(rows, {}))).toEqual(["a", "b", "c", "d", "e"]);
    expect(sortRows(null, { value: byN })).toEqual([]);
  });
});

describe("pageOf", () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: String(i) }));

  it("cuts a full page, then the short remainder", () => {
    expect(ids(pageOf(rows, 0, 5).rows)).toEqual(["0", "1", "2", "3", "4"]);
    expect(ids(pageOf(rows, 1, 5).rows)).toEqual(["5", "6"]);
    expect(pageOf(rows, 0, 5).pageCount).toBe(2);
  });

  it("clamps a page number past the end rather than showing nothing", () => {
    expect(ids(pageOf(rows, 9, 5).rows)).toEqual(["5", "6"]);
    expect(pageOf(rows, 9, 5).page).toBe(1);
    expect(pageOf(rows, -3, 5).page).toBe(0);
  });

  it("counts one page for an empty register, not zero", () => {
    expect(pageOf([], 0, 25)).toEqual({ rows: [], page: 0, pageCount: 1 });
  });

  it("divides evenly without inventing an empty last page", () => {
    expect(pageOf(rows.slice(0, 6), 0, 3).pageCount).toBe(2);
  });
});

// TWO IMPLEMENTATIONS, ON PURPOSE, AND THIS IS WHAT KEEPS THEM ONE ANSWER.
//
// `ui/tableModel.js` used to have no `pageOf` of its own: it re-exported `assetQuery.js`'s,
// on the reasoning that the arithmetic already had exactly one definition on the client and
// a third copy would be the only one nothing checked. That reasoning does not survive the
// move — `gas_shared/ui/tableModel.js` cannot reach sideways into one app's `assetQuery.js`,
// so it defines its own, and the re-export is gone.
//
// So the third copy now exists, and this is the check it was missing. `assetQuery.js` is a
// hand-kept mirror of `src/domain/assetTable.ts` (assetQueryMirror.test.ts pins it row for
// row), which is why it cannot simply import the shared one: the mirror has to read as a
// translation of the TS module, not as a call into a UI package the server bundle never
// loads. Three copies, two guards, and between them every pair is held.
//
// The table below is the boundaries a paging bug actually lives at: a page past the end, a
// negative page, an empty register, an exact division, a fractional size, and a size of
// zero (which both clamp to 1 rather than dividing by it).
describe("pageOf: the shared table model and the assetTable mirror agree", () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: String(i) }));
  const CASES = [
    [rows, 0, 5], [rows, 1, 5], [rows, 9, 5], [rows, -3, 5], [rows, 0, 7], [rows, 1, 7],
    [rows, 0, 1], [rows, 6, 1], [rows, 7, 1], [rows, 0, 25], [rows, 2, 3],
    [rows, 0, 0], [rows, 0, 2.7], [rows, 1.9, 3],
    [[], 0, 25], [[], 3, 25], [rows.slice(0, 6), 0, 3],
  ];

  it("returns the same rows, page and pageCount on every boundary", () => {
    for (const [list, page, size] of CASES) {
      expect(pageOf(list, page, size), list.length + "/" + page + "/" + size)
        .toEqual(mirrorPageOf(list, page, size));
    }
  });

  // Without this the sweep above would pass on two functions that both return nothing.
  it("is not vacuous — the table really does exercise more than one page", () => {
    const counts = new Set(CASES.map(([list, page, size]) => pageOf(list, page, size).pageCount));
    expect(counts.size).toBeGreaterThan(3);
    expect([...CASES].some(([list, page, size]) => pageOf(list, page, size).rows.length > 0))
      .toBe(true);
  });
});

describe("pageForSize", () => {
  // Changing how many rows you can see is not a request to go somewhere else. On page 12 of
  // a register at 25 rows, being sent back to the top is the difference between a control and
  // a trap — the graph's page-size select does exactly that today; the inventory's does not.
  it("lands on the page still holding the row that was at the top", () => {
    expect(pageForSize(3, 25, 100)).toBe(0);   // rows 75-99 -> page 0 holds 0-99
    expect(pageForSize(2, 100, 25)).toBe(8);   // rows 200+  -> page 8 holds 200-224
    expect(pageForSize(12, 25, 50)).toBe(6);
  });

  it("keeps the first page first at every size", () => {
    for (const size of PAGE_SIZES) expect(pageForSize(0, 50, size)).toBe(0);
  });
});

describe("triState", () => {
  // The app's most repeated assertion, and the one place it can be tested rather than
  // reviewed: an absent property means Wiz never reported one, and rendering that as "No"
  // asserts the opposite of what is known.
  it("keeps unknown separate from no", () => {
    expect(triState(true)).toBe("yes");
    expect(triState(false)).toBe("no");
    expect(triState(null)).toBe("unknown");
    expect(triState(undefined)).toBe("unknown");
  });

  // The states are read off the boolean itself, never off truthiness — an empty string and a
  // zero are not answers to a yes/no question.
  it("does not read truthiness as an answer", () => {
    expect(triState(0)).toBe("unknown");
    expect(triState("")).toBe("unknown");
    expect(triState("yes")).toBe("unknown");
  });
});

describe("the page sizes", () => {
  it("offers one list, with the default among it", () => {
    expect(PAGE_SIZES).toEqual([25, 50, 100, 250]);
    expect(PAGE_SIZES).toContain(DEFAULT_PAGE_SIZE);
  });
});
