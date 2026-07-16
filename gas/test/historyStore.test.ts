// historyStore snapshot round-trip, focused on the new `open_past_sla` column. sheetsDb is
// faked with an in-memory table store (the ledgerReset.test.ts pattern): readAll returns the
// stored row objects verbatim, so a row lacking the `open_past_sla` key reproduces exactly a
// pre-column history row read off the sheet. Modules are re-imported per test so the
// module-level state starts cold.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [k: string]: unknown;
}

const tables: Record<string, Row[]> = {};

vi.mock("../src/server/sheetsDb", () => {
  const TABS = { mttrHistory: "mttr_history" };
  return {
    TABS,
    readAll: (tab: string) => tables[tab] ?? [],
    overwrite: (tab: string, rows: Row[]) => {
      tables[tab] = [...rows];
    },
  };
});

// recordSnapshot → bumpDataVersion hits PropertiesService.
vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: () => null,
    setProperty: () => {},
    deleteProperty: () => {},
  }),
});

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  vi.resetModules();
});

describe("historyStore open_past_sla", () => {
  it("recordSnapshot writes open_past_sla and loadHistory reads it back (truncated)", async () => {
    const store = await import("../src/server/historyStore");
    const ok = store.recordSnapshot(1.5, 10, 4, { LOW: 14 }, "2026-03-01", 90, 12, 3.9);
    expect(ok).toBe(true);
    const rows = store.loadHistory();
    expect(rows).toHaveLength(1);
    // Math.trunc, not round: 3.9 → 3.
    expect(rows[0].open_past_sla).toBe(3);
    // Persisted cell carries the truncated integer too.
    expect(tables["mttr_history"][0]["open_past_sla"]).toBe(3);
  });

  it("recordSnapshot defaults the trailing param to null (never a fabricated 0)", async () => {
    const store = await import("../src/server/historyStore");
    store.recordSnapshot(2, 5, 1, null, "2026-03-02", 88, 20);
    const rows = store.loadHistory();
    expect(rows[0].open_past_sla).toBeNull();
    expect(tables["mttr_history"][0]["open_past_sla"]).toBeNull();
  });

  it("loadHistory maps a missing open_past_sla column to null, not 0", async () => {
    // A pre-column history row — no open_past_sla key at all.
    tables["mttr_history"] = [
      {
        date: "2026-02-10",
        median_days: 1,
        resolved: 3,
        open: 2,
        total: 5,
        sla_pct: 100,
        oldest_open_days: 9,
      },
    ];
    const store = await import("../src/server/historyStore");
    const rows = store.loadHistory();
    expect(rows[0].open_past_sla).toBeNull();
  });

  it("loadHistory reads an explicit numeric open_past_sla cell", async () => {
    tables["mttr_history"] = [
      { date: "2026-02-11", median_days: 1, resolved: 1, open: 1, total: 2, open_past_sla: 7 },
    ];
    const store = await import("../src/server/historyStore");
    expect(store.loadHistory()[0].open_past_sla).toBe(7);
  });
});
