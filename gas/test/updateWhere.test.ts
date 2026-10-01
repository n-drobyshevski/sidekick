// `sheetsDb.updateWhere` reads the tail of the tab first and falls back to the rest only when
// the key is not there. Ported from gas_devsecops/test/updateWhere.test.ts.
//
// The cost being removed was a whole-tab read on EVERY job-row write — `jobsStore.updateJob`
// runs once per fetched page, the `jobs` tab gains a row per scan, backfill and purge and is
// only truncated by a full ledger reset, and the row being written is almost always the one
// appended moments ago. The fake below counts the cells each `getValues` reads, so the saving
// is measured rather than asserted. (gas has no shared in-memory Sheets for server specs; this
// is the same shape as test/sheetsDbShrink.test.ts's fake, grown to take new columns.)

import { beforeEach, describe, expect, it, vi } from "vitest";

const counters = { cellsRead: 0 };

class FakeSheet {
  name: string;
  grid: unknown[][] = [];
  constructor(name: string, header: string[]) {
    this.name = name;
    this.grid.push(header.slice());
  }
  getName() { return this.name; }
  getMaxRows() { return this.grid.length; }
  getMaxColumns() { return this.getLastColumn(); }
  getLastRow() {
    for (let i = this.grid.length - 1; i >= 0; i--) {
      if (this.grid[i].some((v) => v !== "" && v !== null && v !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    let last = 0;
    for (const row of this.grid) {
      for (let j = row.length - 1; j >= last; j--) {
        if (row[j] !== "" && row[j] !== null && row[j] !== undefined) { last = j + 1; break; }
      }
    }
    return last;
  }
  private cell(r: number, c: number): unknown {
    const row = this.grid[r];
    return row && row[c] !== undefined ? row[c] : "";
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const sh = this;
    return {
      getValues() {
        counters.cellsRead += numRows * numCols;
        const out: unknown[][] = [];
        for (let i = 0; i < numRows; i++) {
          const r: unknown[] = [];
          for (let j = 0; j < numCols; j++) r.push(sh.cell(row - 1 + i, col - 1 + j));
          out.push(r);
        }
        return out;
      },
      setValues(vals: unknown[][]) {
        for (let i = 0; i < numRows; i++) {
          while (sh.grid.length < row + i) sh.grid.push([]);
          const target = sh.grid[row - 1 + i];
          for (let j = 0; j < numCols; j++) {
            while (target.length < col + j) target.push("");
            target[col - 1 + j] = vals[i][j];
          }
        }
        return this;
      },
      setNumberFormat() { return this; },
      clearContent() {
        for (let i = 0; i < numRows; i++) {
          const target = sh.grid[row - 1 + i];
          if (!target) continue;
          for (let j = 0; j < numCols; j++) if (col - 1 + j < target.length) target[col - 1 + j] = "";
        }
        return this;
      },
    };
  }
}

type SheetsDb = typeof import("../src/server/sheetsDb");
let db: SheetsDb;
let sheets: FakeSheet[] = [];

const ROWS = 400;
const jobRow = (i: number) => ({ job_id: `job-${i}`, kind: "scan", phase: "DONE", page: i });

beforeEach(async () => {
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
  db = await import("../src/server/sheetsDb");
  sheets = [new FakeSheet(db.TABS.jobs, db.TAB_HEADERS[db.TABS.jobs]!)];
  db.appendRows(db.TABS.jobs, Array.from({ length: ROWS }, (_, i) => jobRow(i)));
  counters.cellsRead = 0;
});

const phaseOf = (id: string) =>
  db.readAll(db.TABS.jobs).find((r) => r["job_id"] === id)?.["phase"];

describe("updateWhere", () => {
  it("writes the newest row off a bounded tail read", () => {
    const cols = db.TAB_HEADERS[db.TABS.jobs]!.length;
    const value = db.updateWhere(db.TABS.jobs, "job_id", `job-${ROWS - 1}`, { phase: "FETCHING" });
    const read = counters.cellsRead;
    expect(value).toBe(true);
    expect(phaseOf(`job-${ROWS - 1}`)).toBe("FETCHING");
    // The header (ensureHeaders) plus at most 50 trailing rows — nowhere near the whole tab.
    expect(read).toBeLessThanOrEqual(51 * cols + cols);
    expect(read).toBeLessThan(ROWS * cols);
  });

  it("falls back to the rest of the tab for a key above the tail", () => {
    expect(db.updateWhere(db.TABS.jobs, "job_id", "job-0", { phase: "FAILED" })).toBe(true);
    expect(phaseOf("job-0")).toBe("FAILED");
    expect(phaseOf("job-1")).toBe("DONE");
  });

  it("finds a key on the row just above the tail", () => {
    // Row ROWS - 50 is the last data row the tail does NOT cover — the seam between the reads.
    const id = `job-${ROWS - 51}`;
    expect(db.updateWhere(db.TABS.jobs, "job_id", id, { phase: "FAILED" })).toBe(true);
    const rows = db.readAll(db.TABS.jobs);
    expect(rows.filter((r) => r["phase"] === "FAILED").map((r) => r["job_id"])).toEqual([id]);
  });

  it("patches only the keys it is given, and only the matching row", () => {
    db.updateWhere(db.TABS.jobs, "job_id", "job-200", { phase: "PERSISTING" });
    const rows = db.readAll(db.TABS.jobs);
    expect(rows.filter((r) => r["phase"] === "PERSISTING").map((r) => r["job_id"])).toEqual(["job-200"]);
    expect(rows.find((r) => r["job_id"] === "job-200")!["page"]).toBe(200);
  });

  it("answers false for a key the tab does not hold, and writes nothing", () => {
    const before = JSON.stringify(db.readAll(db.TABS.jobs));
    expect(db.updateWhere(db.TABS.jobs, "job_id", "job-missing", { phase: "FAILED" })).toBe(false);
    expect(JSON.stringify(db.readAll(db.TABS.jobs))).toBe(before);
  });

  it("finds a key on a tab shorter than the tail", () => {
    db.overwrite(db.TABS.jobs, [jobRow(1), jobRow(2)]);
    expect(db.updateWhere(db.TABS.jobs, "job_id", "job-1", { phase: "CANCELLED" })).toBe(true);
    expect(phaseOf("job-1")).toBe("CANCELLED");
    expect(db.updateWhere(db.TABS.jobs, "job_id", "job-9", { phase: "CANCELLED" })).toBe(false);
  });

  // A tab written before a column existed: the patch used to skip the key whose column was
  // missing, so the field was lost without a word. `setScanObsRef` and `rewriteCheckpoints`
  // reach updateWhere with no ensureTab of their own.
  it("heals a column the tab predates instead of dropping that patch key", () => {
    const scans = new FakeSheet(db.TABS.scans, ["scan_id", "ts", "mode"]);
    scans.grid.push(["scan-1", "2026-09-01T05:00:00Z", "live"]);
    sheets.push(scans);
    expect(db.updateWhere(db.TABS.scans, "scan_id", "scan-1", { obs_ref: "file-9" })).toBe(true);
    const row = db.readAll(db.TABS.scans)[0]!;
    expect(row["obs_ref"]).toBe("file-9");
    expect(row["mode"]).toBe("live");
    expect(scans.grid[0]).toEqual(db.TAB_HEADERS[db.TABS.scans]);
  });
});
