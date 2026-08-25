// shrinkTab is what makes a purge actually reclaim spreadsheet headroom.
//
// `cellUsage` prices the ALLOCATED grid (getMaxRows × getMaxColumns), because that is what
// the 10M-cell ceiling enforces — while `overwrite` clears data with `clearContent()`, which
// leaves getMaxRows exactly where it was. So without this primitive, purging 100k lifecycles
// leaves the Storage meter byte-identical and the operator reclaims nothing. The last test
// here is that fact, pinned, so nobody "simplifies" the shrink away.

import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeSheet {
  name: string;
  grid: unknown[][];
  cols: number;
  constructor(name: string, rows: number, cols: number) {
    this.name = name;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => new Array(cols).fill(""));
  }
  getName() { return this.name; }
  getMaxRows() { return this.grid.length; }
  getMaxColumns() { return this.cols; }
  getLastRow() {
    for (let i = this.grid.length - 1; i >= 0; i--) {
      if (this.grid[i].some((v) => v !== "" && v !== null && v !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() { return this.cols; }
  deleteRows(rowPosition: number, howMany: number) {
    this.grid.splice(rowPosition - 1, howMany);
    return this;
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const sh = this;
    return {
      getValues() {
        const out: unknown[][] = [];
        for (let i = 0; i < numRows; i++) out.push(sh.grid[row - 1 + i].slice(col - 1, col - 1 + numCols));
        return out;
      },
      setValues(vals: unknown[][]) {
        for (let i = 0; i < numRows; i++) {
          for (let j = 0; j < numCols; j++) sh.grid[row - 1 + i][col - 1 + j] = vals[i][j];
        }
        return this;
      },
      clearContent() {
        for (let i = 0; i < numRows; i++) {
          for (let j = 0; j < numCols; j++) sh.grid[row - 1 + i][col - 1 + j] = "";
        }
        return this;
      },
      setNumberFormat() { return this; },
    };
  }
}

let sheets: FakeSheet[] = [];

function seed(dataRows: number, allocatedRows: number) {
  const sh = new FakeSheet("scans", allocatedRows, 3);
  sh.grid[0] = ["scan_id", "ts", "mode"];
  for (let i = 1; i <= dataRows; i++) sh.grid[i] = [`s${i}`, "2026-01-01", "live"];
  sheets = [sh];
  return sh;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("SpreadsheetApp", {
    openById: () => ({
      getSheets: () => sheets,
      getSheetByName: (n: string) => sheets.find((s) => s.name === n) ?? null,
    }),
  });
  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({ getProperty: () => "sheet-id", setProperty: () => {} }),
  });
});

describe("shrinkTab", () => {
  it("deletes the surplus allocated rows below the data", async () => {
    const sh = seed(10, 1000);
    const { shrinkTab } = await import("../src/server/sheetsDb");
    shrinkTab("scans", 20);
    // 11 data rows (header + 10) + 20 spare
    expect(sh.getMaxRows()).toBe(31);
  });

  it("keeps the spare buffer so ordinary appends don't re-grow the grid every scan", async () => {
    const sh = seed(10, 1000);
    const { shrinkTab } = await import("../src/server/sheetsDb");
    shrinkTab("scans", 200);
    expect(sh.getMaxRows()).toBe(211);
  });

  it("never drops a data row", async () => {
    const sh = seed(10, 1000);
    const { shrinkTab } = await import("../src/server/sheetsDb");
    shrinkTab("scans", 0);
    expect(sh.getLastRow()).toBe(11);
    expect(sh.grid[10][0]).toBe("s10");
  });

  it("is a no-op when the grid is already tight", async () => {
    const sh = seed(10, 15);
    const { shrinkTab } = await import("../src/server/sheetsDb");
    shrinkTab("scans", 200);
    expect(sh.getMaxRows()).toBe(15);
  });

  it("leaves at least the header row on an empty tab", async () => {
    const sh = seed(0, 1000);
    const { shrinkTab } = await import("../src/server/sheetsDb");
    shrinkTab("scans", 0);
    expect(sh.getMaxRows()).toBeGreaterThanOrEqual(1);
  });

  it("THE FINDING: overwrite alone leaves cellUsage unchanged; shrinkTab is what moves it", async () => {
    const sh = seed(500, 1000);
    const { overwrite, cellUsage, shrinkTab } = await import("../src/server/sheetsDb");
    const before = cellUsage().total;

    // Remove 490 of 500 rows the way every write path does.
    overwrite("scans", Array.from({ length: 10 }, (_, i) => ({
      scan_id: `s${i}`, ts: "2026-01-01", mode: "live",
    })));
    expect(sh.getLastRow()).toBe(11);
    expect(cellUsage().total).toBe(before); // <- the meter has not budged

    shrinkTab("scans", 20);
    expect(cellUsage().total).toBeLessThan(before);
  });
});
