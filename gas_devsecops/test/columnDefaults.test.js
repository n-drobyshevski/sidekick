// WHAT THE SAVED-SCANS TABLE SHIPS WITH, AND WHAT IT KEEPS ONE PRESS AWAY.
//
// The table grew a column chooser (the cog at the right end of its heading row,
// gas_shared/ui/columnPicker.js), and with it a `defaultHidden` flag per column. A default is
// an editorial judgment about what this page is FOR, and it fails silently in both directions:
// a column quietly hidden that a reader needed, or a flag dropped in a refactor so the table
// grows back to every column it can draw. Neither breaks a build.
//
// THE SECOND HALF OF THIS FILE IS A DIFFERENT KIND OF GUARD. `scanRowsView` has always
// projected `mode` and `scanId` onto every row, and until the chooser existed nothing in this
// app read either — a register running on seeded data said so nowhere on the page that lists
// its scans. A projected field with no reader is the thing to catch, so the columns that gave
// them one are pinned to the projection that feeds them.
//
// Plain .js, and source-text assertions, for the reason the tests beside it give: tsconfig has
// no allowJs, there is no jsdom in this repo, and the thing being pinned IS the source.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { scanRowsView } from "../src/client/js/pages/history.js";

const SRC = readFileSync(new URL("../src/client/js/pages/history.js", import.meta.url), "utf8");
const hides = (key) => new RegExp(`key: "${key}",[\\s\\S]{0,400}?defaultHidden: true`).test(SRC);

describe("the saved-scans table's column defaults", () => {
  it("starts with when, which register, and what moved", () => {
    for (const key of ["ts", "scope", "total", "new", "resolved", "reopened"]) {
      expect(hides(key), `history.js should not hide ${key}`).toBe(false);
    }
  });

  // The widest cell in the row, and the same on every scan that ran under the same gate.
  it("holds the severity list back until somebody looks for a change in it", () => {
    expect(hides("severities")).toBe(true);
  });

  it("remembers the choice per browser, since this page has no URL state for it", () => {
    expect(SRC).toContain('columnStore: "sidekickdevsecops.history.scans.cols"');
  });
});

describe("the two projected fields the table had never drawn", () => {
  const rows = scanRowsView([{
    scan_id: "sync-1", ts: "2026-09-01T00:00:00Z", scope: "sca", mode: "live",
    total: 3, new_count: 1, resolved_count: 0, reopened_count: 0, sealed: 0, severities: null,
  }]);

  it("still projects both, which is what the new columns read", () => {
    expect(rows[0]).toMatchObject({ mode: "live", scanId: "sync-1" });
  });

  it("draws each of them as an opt-in column", () => {
    expect(hides("mode")).toBe(true);
    expect(hides("scanId")).toBe(true);
    expect(SRC).toContain('label: "Mode"');
    expect(SRC).toContain('label: "Sync ID"');
  });

  // A scan whose mode the ledger never recorded is one we were not told about. `absentText`
  // is what dataTable promotes to the one muted em dash; a word there would assert a reading.
  it("says nothing rather than something when the ledger recorded no mode", () => {
    expect(scanRowsView([{ scan_id: "s", ts: "x", scope: "sca" }])[0].mode).toBeUndefined();
    expect(SRC).toContain('cell: (r) => (r.mode ? statusPill("neutral", String(r.mode)) : absentText)');
  });
});
