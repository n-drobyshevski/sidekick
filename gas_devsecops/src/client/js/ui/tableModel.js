// How a table orders and pages its rows — the half of the register that can be wrong.
//
// DOM-free on purpose, and for the reason pages/configView.js writes out: there is no jsdom
// in this repo, so nothing that touches `document` can be unit-tested. dataTable() builds the
// nodes; this decides what goes in them and in what order, and test/tableModel.test.js holds
// it to that.
//
// It arrives from src/client/js/queryTable.js, which is where the strongest version of each
// of these rules already lived — the Security Graph's results table sorted nulls correctly and
// broke ties stably while the other four registers each rolled a weaker copy. Same bargain
// dataTable itself was assembled under: take the best of what exists rather than write a
// sixth one.
//
// DIRECTION OF SORT STAYS WITH THE CALLER, deliberately, exactly as dataTable's own comment
// says: "the three pages genuinely disagree about what a first click means per column, and two
// of those rules are unit-tested". This module never decides that. It decides where an unknown
// goes, what a tie does, and how a page is cut.


/**
 * The row counts a page-size control offers, and the one it starts on.
 *
 * One list, because two registers already shipped the same four numbers independently
 * (inventory.js and queryTable.js) and a third would have been a coincidence rather than a
 * decision.
 */
export const PAGE_SIZES = [25, 50, 100, 250];
export const DEFAULT_PAGE_SIZE = 50;


/**
 * Ordinary comparison for two values that are both PRESENT. Nulls are the caller's problem,
 * and `nullsLast` below is how the caller solves them.
 *
 * No locale collation: `localeCompare` is both slower and, on a column of resource ids and
 * rule short-codes, differently wrong. Lowercased so a column does not sort `Zebra` before
 * `apple`.
 */
export function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Where an unknown goes: LAST, in both directions.
 *
 * This sits outside the ascending/descending flip on purpose. An unknown is not a small value.
 * Letting it lead the ascending page would bury the rows someone sorted the column to find,
 * and reversing the sort would then bury the others — so a reader could never get both halves
 * of the column into view. Sinking it in both directions costs one arrangement and saves the
 * one people actually want.
 *
 * `undefined` and `null` are the same answer here — Wiz reports a field it never evaluated as
 * either, depending on the query, and a table that ordered those two differently would be
 * sorting on which query fetched the row.
 *
 * @returns {number|null} `null` means BOTH are present and the caller should compare them.
 */
export function nullsLast(a, b) {
  const na = a === null || a === undefined;
  const nb = b === null || b === undefined;
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  return null;
}

/**
 * Sort a copy of `rows` by one column, unknowns last, ties broken the same way every time.
 *
 * THE TIEBREAK IS NOT A GARNISH. Array.prototype.sort is stable, so equal rows keep their
 * input order — but the input order of a register is itself the previous sort, so a column
 * with many equal values (a severity, a status, a boolean) appears to shuffle itself when a
 * reader sorts by something else and comes back. A second key that never changes fixes the
 * arrangement to the data rather than to the click history.
 *
 * @param {Array} rows
 * @param {{value: (row: any) => any, descending?: boolean, tiebreak?: (row: any) => any}} spec
 * @returns {Array} a new array; `rows` is not touched
 */
/**
 * One page of rows, with the page index clamped into range. Clamping rather than throwing
 * is what lets a filter shrink the register under a reader who is on page 9 without the
 * table going blank: they land on the last page that exists.
 */
export function pageOf(rows, page, pageSize) {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const clamped = Math.min(Math.max(Math.floor(page) || 0, 0), pageCount - 1);
  return {
    rows: rows.slice(clamped * size, (clamped + 1) * size),
    page: clamped,
    pageCount,
  };
}

export function sortRows(rows, spec) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const value = spec && spec.value;
  if (typeof value !== "function") return list;
  const descending = Boolean(spec && spec.descending);
  const tiebreak = spec && typeof spec.tiebreak === "function" ? spec.tiebreak : null;

  return list.sort(function (ra, rb) {
    const va = value(ra);
    const vb = value(rb);
    const order = nullsLast(va, vb);
    if (order === null) {
      const d = compareValues(va, vb);
      if (d !== 0) return descending ? -d : d;
    } else if (order !== 0) {
      return order;
    }
    if (!tiebreak) return 0;
    const ta = tiebreak(ra);
    const tb = tiebreak(rb);
    const tie = nullsLast(ta, tb);
    // The tiebreak is never flipped by `descending` either — its job is to be constant.
    return tie === null ? compareValues(ta, tb) : tie;
  });
}

/**
 * Which page holds the row that was at the top, once the page size changes.
 *
 * Promoted from inventory.js:861, which is the only one of the two page-size selects that
 * does this — the graph's resets to page 1. Changing how many rows you can see is not a
 * request to go somewhere else, and on page 12 of a register at 25 rows, being sent back to
 * the top is the difference between a control and a trap.
 */
export function pageForSize(page, fromSize, toSize) {
  const size = Math.max(1, Math.floor(toSize) || 0);
  const firstRow = Math.max(0, Math.floor(page) || 0) * Math.max(1, Math.floor(fromSize) || 0);
  return Math.floor(firstRow / size);
}

/**
 * Three states, never two: what a boolean column actually knows.
 *
 * The codebase is emphatic that an absent property means Wiz never reported one, and printing
 * that as "No" asserts the opposite of what is known — the same rule CLAUDE.md states as
 * "absent is never zero". This is the DOM-free half of `triCell` so the rule itself has a
 * test, rather than only the span it renders into.
 *
 * @returns {"yes"|"no"|"unknown"}
 */
export function triState(v) {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "unknown";
}
