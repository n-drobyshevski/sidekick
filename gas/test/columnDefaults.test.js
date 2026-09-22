// WHAT THE SCAN HISTORY SHIPS WITH, AND WHAT IT KEEPS ONE PRESS AWAY.
//
// The table grew a column chooser (the cog at the right end of its heading row,
// gas_shared/ui/columnPicker.js), and with it a `defaultHidden` flag per column. A default is
// an editorial judgment about what this page is FOR, and it fails silently in both directions:
// a column quietly hidden that a reader needed, or a flag dropped in a refactor so the table
// grows back to every column it can draw. Neither breaks a build.
//
// Plain .js, and source-text assertions, for the reason the tests beside it give: tsconfig has
// no allowJs, there is no jsdom in this repo, and the thing being pinned IS the source — a
// flag on a column literal.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../src/client/js/pages/history.js", import.meta.url), "utf8");
const hides = (key) => new RegExp(`key: "${key}",[\\s\\S]{0,400}?defaultHidden: true`).test(SRC);

describe("the scan history's column defaults", () => {
  // When / Mode / Findings and the three deltas are the history. Shape and Scope are facts
  // about one scan that read the same on every row until somebody changes a setting — which
  // is exactly what a reader turns them on to find.
  it("starts with the story and holds the two per-scan facts back", () => {
    expect(hides("shape")).toBe(true);
    expect(hides("scope")).toBe(true);
    for (const key of ["when", "mode", "total", "new", "resolved", "reopened"]) {
      expect(hides(key), `history.js should not hide ${key}`).toBe(false);
    }
  });

  // The ledger has always held it and the table has never drawn it. Two scans a minute apart
  // are two lines with the same date and nothing else to tell them apart.
  it("offers the scan id the ledger already carried", () => {
    expect(SRC).toContain('label: "Scan ID"');
    expect(hides("scanId")).toBe(true);
    expect(SRC).toContain("cell: (s) => el(\"span\", { class: \"small muted\" }, s.scan_id)");
  });

  it("remembers the choice per browser, since this page has no URL state for it", () => {
    expect(SRC).toContain('columnStore: "sidekick.history.scans.cols"');
  });

  // The select-all box is a NODE, not a string, so `hideableColumn` (ui/tableModel.js) never
  // offers it — a checkbox column with no heading text is not something a chooser can name.
  // Pinned here because the day it grows a string label it silently becomes hideable.
  it("never offers the selection column, whose heading is a control", () => {
    expect(SRC).toContain("label: selectAll,");
  });
});
