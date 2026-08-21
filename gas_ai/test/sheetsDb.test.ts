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

describe("a header row with a gap in it", () => {
  // A blank header cell BETWEEN two real ones, which only a hand-edited sheet produces —
  // clearing a header, or inserting a column and not naming it.
  //
  // It used to misfile silently, and silently is the whole problem. `ensureHeaders` compacted
  // row 1 with `.filter(Boolean)` while `readAll` kept its positions and skipped the blanks,
  // so the two disagreed about which column a name lived in: every write after the gap landed
  // one column to the left of where the next read would look for it. No error, no warning —
  // the value simply read back null, which is indistinguishable from a field the tenant never
  // reported. On a security ledger that is the worst available failure mode.
  //
  // Trailing blanks are a different thing and stay legal: they carry no data and shift
  // nothing, so a row-1 range that runs wider than the headers is not an error.

  it("refuses the write rather than misfiling every value after the gap", async () => {
    const { overwrite, TABS } = await db();
    sheets[TABS.assets] = fakeSheet([
      ["id", "", "name", "aars"],
      ["a", "", "Agent-A", 62],
    ]);
    expect(() => overwrite(TABS.assets, [{ id: "a", name: "Agent-A", aars: 62 }]))
      .toThrow(/header/i);
  });

  it("names the tab and the column, because the fix is a manual edit", async () => {
    const { overwrite, TABS } = await db();
    sheets[TABS.assets] = fakeSheet([["id", "kind", "", "aars"], []]);
    // Two substring assertions rather than one regex with a wildcard between them: the
    // escaping is the kind that silently degrades to something weaker that still passes.
    expect(() => overwrite(TABS.assets, [{ id: "a" }])).toThrow(TABS.assets);
    // 1-based and spreadsheet-shaped, so the column can be found without counting.
    expect(() => overwrite(TABS.assets, [{ id: "a" }])).toThrow("column 3");
  });

  it("leaves the data where it was — the write must not half-happen", async () => {
    const { overwrite, TABS } = await db();
    sheets[TABS.assets] = fakeSheet([
      ["id", "", "name"],
      ["a", "", "Agent-A"],
    ]);
    try { overwrite(TABS.assets, [{ id: "b", name: "Agent-B" }]); } catch { /* expected */ }
    expect(sheets[TABS.assets].grid[1]).toEqual(["a", "", "Agent-A"]);
  });

  it("still accepts trailing blanks, which carry no data and shift nothing", async () => {
    const { overwrite, readAll, TABS } = await db();
    // Row 1 shorter than the widest row: the range comes back padded on the right.
    sheets[TABS.assets] = fakeSheet([
      ["id", "kind", "name", "", ""],
      ["a", "AI_AGENT", "Agent-A", "", ""],
    ]);
    expect(() => overwrite(TABS.assets, [{ id: "a", kind: "AI_AGENT", name: "Agent-A" }]))
      .not.toThrow();
    expect(readAll(TABS.assets)[0]["name"]).toBe("Agent-A");
  });

  it("guards every write path, not just overwrite", async () => {
    // The compaction lived in ensureHeaders, which appendRows and updateWhere reach too.
    const { appendRows, updateWhere, TABS } = await db();
    const gapped = () => fakeSheet([["id", "", "name"], ["a", "", "Agent-A"]]);

    sheets[TABS.assets] = gapped();
    expect(() => appendRows(TABS.assets, [{ id: "b", name: "Agent-B" }])).toThrow(/header/i);

    sheets[TABS.assets] = gapped();
    expect(() => updateWhere(TABS.assets, "id", "a", { name: "Renamed" })).toThrow(/header/i);
  });
});

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

  it("an ai_issues tab predating the lifecycle columns gains them, values intact", async () => {
    const { overwrite, readAll, TABS, TAB_HEADERS } = await db();
    // The 18-column header this tab shipped with before issuesV2 lifecycle fields landed.
    sheets[TABS.issues] = fakeSheet([
      [
        "id", "rule_id", "rule_name", "combo_group", "native_severity", "adjusted_severity",
        "status", "asset_id", "asset_name", "region", "account", "projects_json",
        "frameworks_json", "justification", "created_at",
        "due_at", "resolution_recommendation", "remediation",
      ],
      ["i1", "wc-id-2742", "old", "bedrock-no-guardrail", "MEDIUM", "HIGH", "OPEN", "a1", "A"],
    ]);

    overwrite(TABS.issues, [{
      id: "i1", rule_id: "wc-id-2742", rule_name: "old", combo_group: "bedrock-no-guardrail",
      native_severity: "MEDIUM", adjusted_severity: "HIGH", status: "IN_PROGRESS",
      asset_id: "a1", asset_name: "A",
      issue_type: "CLOUD_CONFIGURATION", resolved_at: "2026-08-01T00:00:00Z",
      ignore_note: "Ignored (By Design) by MANSUY.", ai_verdict: "REMEDIATE",
    }]);

    const row = readAll(TABS.issues)[0];
    expect(row["issue_type"]).toBe("CLOUD_CONFIGURATION");
    expect(row["resolved_at"]).toBe("2026-08-01T00:00:00Z");
    expect(row["ignore_note"]).toBe("Ignored (By Design) by MANSUY.");
    expect(row["ai_verdict"]).toBe("REMEDIATE");
    expect(row["status"]).toBe("IN_PROGRESS");
    // The header row grew to the declared schema — no migration, no re-run of setup().
    for (const header of TAB_HEADERS[TABS.issues]) {
      expect(sheets[TABS.issues].grid[0]).toContain(header);
    }
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

describe("posture round trip — the null that must not become a zero", () => {
  it("carries a scored row through write → read unchanged", async () => {
    const { overwrite, readAll, TABS, TAB_HEADERS } = await db();
    const { postureToRow, rowToPosture } = await import("../src/server/syncStore");
    sheets[TABS.frameworkPosture] = fakeSheet([TAB_HEADERS[TABS.frameworkPosture].slice(), []]);

    overwrite(TABS.frameworkPosture, [postureToRow({
      frameworkId: "wf-id-275", level: "subcategory",
      categoryExternalId: "ASI01", subcategoryExternalId: "ASI01",
      title: "ASI01 Agent Goal Hijack", posturePct: 93,
      passCount: 144, failCount: 10, emptyPostureReason: null,
    })]);

    const [row] = readAll(TABS.frameworkPosture).map(rowToPosture);
    expect(row.posturePct).toBe(93);
    expect(row.passCount).toBe(144);
    expect(row.failCount).toBe(10);
    expect(row.emptyPostureReason).toBeNull();
  });

  it("keeps a null posture NULL through the sheet, with its reason", async () => {
    const { overwrite, readAll, TABS, TAB_HEADERS } = await db();
    const { postureToRow, rowToPosture } = await import("../src/server/syncStore");
    sheets[TABS.frameworkPosture] = fakeSheet([TAB_HEADERS[TABS.frameworkPosture].slice(), []]);

    overwrite(TABS.frameworkPosture, [postureToRow({
      frameworkId: "wf-id-275", level: "category", categoryExternalId: "ASI08",
      title: "ASI08 Cascading Failures", posturePct: null,
      passCount: 0, failCount: 0, emptyPostureReason: "NO_RESOURCES",
    })]);

    const [row] = readAll(TABS.frameworkPosture).map(rowToPosture);
    // A blank cell read as 0 would turn "nothing to assess" into "everything failed".
    // That is the single most dangerous coercion in this feature, and it lives here.
    expect(row.posturePct).toBeNull();
    expect(row.posturePct).not.toBe(0);
    expect(row.emptyPostureReason).toBe("NO_RESOURCES");
  });

  it("a real 0% survives as a zero — it is a score, not an absence", () => {
    // The other half of the same discipline: everything assessed and everything failed is
    // a genuine 0, and collapsing it to null would hide a total failure.
    return db().then(async ({ overwrite, readAll, TABS, TAB_HEADERS }) => {
      const { postureToRow, rowToPosture } = await import("../src/server/syncStore");
      sheets[TABS.frameworkPosture] = fakeSheet([TAB_HEADERS[TABS.frameworkPosture].slice(), []]);
      overwrite(TABS.frameworkPosture, [postureToRow({
        frameworkId: "wf-id-275", level: "subcategory",
        categoryExternalId: "ASI02", subcategoryExternalId: "ASI02",
        title: "All failing", posturePct: 0,
        passCount: 0, failCount: 12, emptyPostureReason: null,
      })]);
      const [row] = readAll(TABS.frameworkPosture).map(rowToPosture);
      expect(row.posturePct).toBe(0);
      expect(row.emptyPostureReason).toBeNull();
    });
  });

  it("keeps the many-to-many policy triple through the sheet", async () => {
    const { overwrite, readAll, TABS, TAB_HEADERS } = await db();
    const { frameworkPolicyToRow, rowToFrameworkPolicy } =
      await import("../src/server/syncStore");
    sheets[TABS.frameworkPolicies] = fakeSheet([TAB_HEADERS[TABS.frameworkPolicies].slice(), []]);

    const shared = {
      frameworkId: "wf-id-275", policyId: "ctl-1", policyKind: "CONTROL" as const,
      name: "Prompt injection guardrail", severity: "MEDIUM" as const,
      passCount: 72, failCount: 0, assessedCount: 72, rejectedCount: 0,
      noResourceToAssess: false,
    };
    overwrite(TABS.frameworkPolicies, [
      frameworkPolicyToRow({ ...shared, categoryExternalId: "ASI01", subcategoryExternalId: "ASI01" }),
      frameworkPolicyToRow({ ...shared, categoryExternalId: "ASI02", subcategoryExternalId: "ASI02" }),
      frameworkPolicyToRow({ ...shared, categoryExternalId: "ASI10", subcategoryExternalId: "ASI10" }),
    ]);

    const rows = readAll(TABS.frameworkPolicies).map(rowToFrameworkPolicy);
    // Three rows, one policy. Collapsing them would delete the mapping the tab exists for.
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.policyId)).size).toBe(1);
    expect(rows.map((r) => r.subcategoryExternalId).sort()).toEqual(["ASI01", "ASI02", "ASI10"]);
  });
});
