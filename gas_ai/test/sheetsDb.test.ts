// Writes against a tab whose header row predates a schema change.
//
// Reads and writes map columns by header NAME, which is what makes adding a column
// non-breaking — but only if the write can see the column. A tab still carrying an older
// header row silently dropped every value whose column it had never heard of, so the
// sync after a rename wiped the renamed field for every row.

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Minimal 1-based Range/Sheet over a 2-D array, enough for the write helpers. */
function fakeSheet(grid: unknown[][]) {
  const at = (r: number, c: number) => {
    while (grid.length < r) grid.push([]);
    const row = grid[r - 1];
    while (row.length < c) row.push("");
    return row;
  };
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => grid.reduce((w, r) => Math.max(w, r.length), 0),
    getMaxRows: () => Math.max(grid.length, 100),
    getMaxColumns: () => Math.max(grid.reduce((w, r) => Math.max(w, r.length), 0), 30),
    setFrozenRows: () => {},
    getRange(row: number, col: number, numRows = 1, numCols = 1) {
      return {
        getValues: () =>
          Array.from({ length: numRows }, (_, i) =>
            Array.from({ length: numCols }, (_, j) => at(row + i, col + j)[col + j - 1] ?? "")),
        setValues: (vals: unknown[][]) => {
          vals.forEach((r, i) => r.forEach((v, j) => { at(row + i, col + j)[col + j - 1] = v; }));
        },
        clearContent: () => {
          for (let i = 0; i < numRows; i++) {
            for (let j = 0; j < numCols; j++) at(row + i, col + j)[col + j - 1] = "";
          }
        },
        setNumberFormat: () => {},
      };
    },
  };
}

let sheets: Record<string, ReturnType<typeof fakeSheet>>;

beforeEach(() => {
  vi.resetModules();
  sheets = {};
  (globalThis as Record<string, unknown>)["PropertiesService"] = {
    getScriptProperties: () => ({ getProperty: () => "ledger-id", setProperty: () => {} }),
  };
  (globalThis as Record<string, unknown>)["SpreadsheetApp"] = {
    openById: () => ({
      getSheetByName: (name: string) => sheets[name] ?? null,
      setSpreadsheetTimeZone: () => {},
      getSheets: () => Object.values(sheets),
      insertSheet: (name: string) => (sheets[name] = fakeSheet([[]])),
    }),
  };
});

async function db() {
  return await import("../src/server/sheetsDb");
}

describe("overwrite against an out-of-date header row", () => {
  it("adds the missing schema column instead of dropping the value", async () => {
    const { overwrite, readAll, TABS } = await db();
    // A ledger written before aars_severity existed: the old column is still there.
    sheets[TABS.assets] = fakeSheet([
      ["id", "kind", "name", "aars", "aars_band"],
      ["a", "AI_AGENT", "Agent-A", 62, "HIGH"],
    ]);

    overwrite(TABS.assets, [
      { id: "a", kind: "AI_AGENT", name: "Agent-A", aars: 62, aars_severity: "HIGH" },
    ]);

    const rows = readAll(TABS.assets);
    expect(rows[0]["aars_severity"]).toBe("HIGH");
  });

  it("keeps the columns the sheet already had, in their original order", async () => {
    const { overwrite, TABS } = await db();
    sheets[TABS.assets] = fakeSheet([["id", "kind", "name", "aars", "aars_band"], []]);
    overwrite(TABS.assets, [{ id: "a", kind: "AI_AGENT", name: "n", aars: 1, aars_severity: "LOW" }]);
    const headers = sheets[TABS.assets].grid[0].slice(0, 5);
    expect(headers).toEqual(["id", "kind", "name", "aars", "aars_band"]);
  });

  it("does not invent columns the schema never declared", async () => {
    const { overwrite, readAll, TABS } = await db();
    sheets[TABS.assets] = fakeSheet([["id", "name"], []]);
    overwrite(TABS.assets, [{ id: "a", name: "n", not_a_column: "x" }]);
    expect(sheets[TABS.assets].grid[0]).not.toContain("not_a_column");
    expect(readAll(TABS.assets)[0]["not_a_column"]).toBeUndefined();
  });
});

describe("appendRows against an out-of-date header row", () => {
  it("records the new sync_history column rather than losing the trend point", async () => {
    const { appendRows, readAll, TABS } = await db();
    sheets[TABS.syncHistory] = fakeSheet([
      ["sync_id", "started_at", "finished_at", "status"],
      ["sync-1", "t0", "t1", "SUCCESS"],
    ]);

    appendRows(TABS.syncHistory, [{
      sync_id: "sync-2", started_at: "t2", finished_at: "t3", status: "SUCCESS",
      aars_severity_json: '{"CRITICAL":2}',
    }]);

    const rows = readAll(TABS.syncHistory);
    expect(rows).toHaveLength(2);
    expect(rows[1]["aars_severity_json"]).toBe('{"CRITICAL":2}');
    // The pre-upgrade row keeps its own values and simply has nothing in the new column.
    expect(rows[0]["sync_id"]).toBe("sync-1");
    expect(rows[0]["aars_severity_json"]).toBeNull();
  });
});
