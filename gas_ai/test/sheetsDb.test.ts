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

describe("updateWhere against an out-of-date header row", () => {
  it("adds the missing schema column instead of dropping the patched value", async () => {
    const { updateWhere, readAll, TABS } = await db();
    // A jobs tab written before part_refs_json existed. The sync checkpoints into this
    // tab on every hop; a dropped field here is lost resumption state.
    sheets[TABS.jobs] = fakeSheet([
      ["job_id", "kind", "phase", "step_index"],
      ["job-1", "sync", "FETCHING", 0],
    ]);

    const hit = updateWhere(TABS.jobs, "job_id", "job-1", {
      phase: "RECONCILING",
      part_refs_json: '["part-1"]',
    });

    expect(hit).toBe(true);
    const row = readAll(TABS.jobs)[0];
    expect(row["phase"]).toBe("RECONCILING");
    expect(row["part_refs_json"]).toBe('["part-1"]');
  });

  it("leaves omitted keys alone — the patch is partial by design", async () => {
    const { updateWhere, readAll, TABS } = await db();
    sheets[TABS.jobs] = fakeSheet([
      ["job_id", "kind", "phase", "step_index", "page"],
      ["job-1", "sync", "FETCHING", 3, 7],
    ]);

    updateWhere(TABS.jobs, "job_id", "job-1", { page: 8 });

    const row = readAll(TABS.jobs)[0];
    expect(row["page"]).toBe(8);
    expect(row["step_index"]).toBe(3); // untouched, not reset
    expect(row["phase"]).toBe("FETCHING");
  });

  it("still refuses to invent a column the schema never declared", async () => {
    const { updateWhere, TABS } = await db();
    sheets[TABS.jobs] = fakeSheet([["job_id", "phase"], ["job-1", "FETCHING"]]);
    updateWhere(TABS.jobs, "job_id", "job-1", { phase: "DONE", not_a_column: "x" });
    expect(sheets[TABS.jobs].grid[0]).not.toContain("not_a_column");
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

// The full persistence hop the inventory depends on: a GNode written to a tab that still
// carries the pre-rename header row, then read back the way loadAssets() does. This is
// the round trip that was silently losing the severity.
describe("asset round trip over a pre-rename ledger", () => {
  it("keeps both the score and its severity through write → read", async () => {
    const { overwrite, readAll, TABS } = await db();
    const { assetToRow, rowToAsset } = await import("../src/server/syncStore");

    // Exactly the header row a ledger created before the rename still has.
    sheets[TABS.assets] = fakeSheet([[
      "id", "kind", "name", "native_type", "cloud", "region", "status",
      "account_id", "account_name", "projects_json", "first_seen", "last_seen",
      "internet", "open_internet", "sensitive_data", "sensitive_access", "high_priv",
      "admin_priv", "guardrail_missing", "severity", "aars", "aars_band",
      "aars_pillars_json", "combo_groups", "tags_json", "technology_categories",
      "identity_purpose", "issue_analytics_json",
    ], []]);

    overwrite(TABS.assets, [assetToRow({
      id: "agent-a", kind: "AI_AGENT", name: "Agent-A", aars: 62, aarsSeverity: "HIGH",
    })]);

    const [node] = readAll(TABS.assets).map(rowToAsset);
    expect(node.aars).toBe(62);
    expect(node.aarsSeverity).toBe("HIGH");
  });

  it("re-reads a row the old code wrote, from the column it wrote it to", async () => {
    const { readAll, TABS } = await db();
    const { rowToAsset } = await import("../src/server/syncStore");
    sheets[TABS.assets] = fakeSheet([
      ["id", "kind", "name", "aars", "aars_band"],
      ["agent-a", "AI_AGENT", "Agent-A", 62, "MINIMAL"],
    ]);
    const [node] = readAll(TABS.assets).map(rowToAsset);
    expect(node.aars).toBe(62);
    expect(node.aarsSeverity).toBe("INFO"); // legacy value, current name
  });
});
