// The Data page's sync-history deltas — and the one rule that keeps a missing count out of
// the "nothing moved" column.
//
// Plain .js on purpose, for the reason helpContent.test.js writes out: tsconfig has no allowJs
// and includes test/**/*.ts, so a .ts test importing a client .js module fails `tsc --noEmit`
// and vitest would never run.
//
// FAILURE OF ABSENCE is the kind this file holds. A row whose `ledger_json` cannot be read is
// a sync nobody counted transitions for, and printing three confident zeroes for it describes
// a quiet week that never happened — a claim, not a gap. Every case below is a value that
// casts to a finite 0.

import { describe, expect, it } from "vitest";
import { ledgerDeltasOf, LEDGER_DELTA_KEYS } from "../src/client/js/pages/dataModel.js";

const FULL = {
  new: 3, resolved: 6, reopened: 1, carried: 2, skippedNarrowedScope: 0,
};

const rowWith = (cell) => ({ sync_id: "sync-01", ledger_json: cell });

describe("ledgerDeltasOf", () => {
  it("reads the five counts a real commit row carries", () => {
    expect(ledgerDeltasOf(rowWith(JSON.stringify(FULL)))).toEqual(FULL);
  });

  it("keeps a genuine zero, because a sync that moved nothing DID measure", () => {
    const quiet = { new: 0, resolved: 0, reopened: 0, carried: 0, skippedNarrowedScope: 0 };
    expect(ledgerDeltasOf(rowWith(JSON.stringify(quiet)))).toEqual(quiet);
  });

  it("refuses a row that has no ledger cell at all", () => {
    // A sync recorded before the lifecycle ledger existed. The three columns then read
    // `absent()` together rather than as three zeroes.
    for (const cell of [null, undefined, "", 0, false, []]) {
      expect(ledgerDeltasOf(rowWith(cell)), String(cell)).toBeNull();
    }
    expect(ledgerDeltasOf({})).toBeNull();
    expect(ledgerDeltasOf(null)).toBeNull();
    expect(ledgerDeltasOf(undefined)).toBeNull();
  });

  it("refuses a cell that will not parse, or parses to something that is not an object", () => {
    for (const cell of ["not json", "null", "[]", "7", '"three"']) {
      expect(ledgerDeltasOf(rowWith(cell)), cell).toBeNull();
    }
  });

  it("refuses a cell that names none of the five, rather than reading it as five zeroes", () => {
    expect(ledgerDeltasOf(rowWith("{}"))).toBeNull();
    // One key short is still a row that did not count that transition.
    for (const key of LEDGER_DELTA_KEYS) {
      const partial = { ...FULL };
      delete partial[key];
      expect(ledgerDeltasOf(rowWith(JSON.stringify(partial))), key).toBeNull();
    }
  });

  // THE PERTURBATION. `Number(null)`, `Number("")`, `Number([])` and `Number(false)` are all a
  // finite 0, so the tempting "just check Number.isFinite" rewrite reads every one of these as
  // a sync that moved nothing. Reproduced inline rather than described.
  const DEFECTIVE_READ = (row) => {
    const parsed = JSON.parse(row.ledger_json);
    const out = {};
    for (const key of LEDGER_DELTA_KEYS) {
      const n = Number(parsed[key]);
      out[key] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    }
    return out;
  };

  it("refuses a count written as null, false or an empty string — each casts to a real 0", () => {
    // Every one of these is `0` and finite under `Number`, so the rewrite above prints a
    // confident zero for a count nobody reported.
    for (const bad of [null, false, "", [], "  "]) {
      const cell = JSON.stringify({ ...FULL, resolved: bad });
      expect(DEFECTIVE_READ(rowWith(cell)).resolved, JSON.stringify(bad)).toBe(0);
      expect(ledgerDeltasOf(rowWith(cell)), JSON.stringify(bad)).toBeNull();
    }
    // `{}` is the one that does NOT cast to zero — it is NaN, which the defective rewrite
    // happens to catch. Included so the case list is the whole shape space rather than only
    // the cases that make the point.
    const objCell = JSON.stringify({ ...FULL, resolved: {} });
    expect(DEFECTIVE_READ(rowWith(objCell)).resolved).toBeNull();
    expect(ledgerDeltasOf(rowWith(objCell))).toBeNull();
  });

  it("refuses a negative or non-numeric count", () => {
    expect(ledgerDeltasOf(rowWith(JSON.stringify({ ...FULL, new: -1 })))).toBeNull();
    expect(ledgerDeltasOf(rowWith(JSON.stringify({ ...FULL, new: "many" })))).toBeNull();
  });

  it("takes a numeric string, which is how a sheet cell comes back", () => {
    expect(ledgerDeltasOf(rowWith(JSON.stringify({ ...FULL, new: "3" }))).new).toBe(3);
  });
});
