// resetLedger returns the ledger to the fresh, never-compacted state the sharded import
// guard (importBeginSharded) requires. sheetsDb is faked with an in-memory table store;
// archiveStore's snapshot trash is a no-op; modules are re-imported per test so the
// module-level memos start cold (as in a fresh GAS execution).

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [k: string]: unknown;
}

const tables: Record<string, Row[]> = {};

vi.mock("../src/server/sheetsDb", () => {
  const TABS = {
    scans: "scans",
    vulnLedger: "vuln_ledger",
    episodes: "resolved_episodes",
    compactions: "compactions",
    settings: "settings",
    mttrHistory: "mttr_history",
    schemaMeta: "schema_meta",
    jobs: "jobs",
  };
  return {
    TABS,
    readAll: (tab: string) => tables[tab] ?? [],
    overwrite: (tab: string, rows: Row[]) => {
      tables[tab] = [...rows];
    },
    appendRows: (tab: string, rows: Row[]) => {
      tables[tab] = [...(tables[tab] ?? []), ...rows];
    },
    dataRowCount: (tab: string) => (tables[tab] ?? []).length,
    truncateAfter: (tab: string, keep: number) => {
      tables[tab] = (tables[tab] ?? []).slice(0, keep);
    },
    updateWhere: () => {},
  };
});

vi.mock("../src/server/archiveStore", () => ({
  trashLedgerSnapshot: () => {},
}));

// invalidateLedgerMemos → bumpDataVersion hits PropertiesService.
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

describe("resetLedger", () => {
  it("clears every tab the fresh-ledger guard checks and reports pre-counts", async () => {
    tables["scans"] = [
      { scan_id: "s1", ts: "2026-01-01T00:00:00Z" },
      { scan_id: "s2", ts: "2026-02-01T00:00:00Z" },
    ];
    tables["vuln_ledger"] = [{ vuln_key: "a" }, { vuln_key: "b" }, { vuln_key: "c" }];
    tables["resolved_episodes"] = [{ vuln_key: "e" }];
    tables["compactions"] = [{ compaction_id: "c1" }];
    tables["jobs"] = [{ job_id: "scan-x", phase: "PERSISTING" }];

    const store = await import("../src/server/ledgerStore");
    const counts = store.resetLedger();

    expect(counts).toEqual({ scans: 2, vulns: 3, episodes: 1, compactions: 1 });
    // The sharded guard reads loadScanRows().length || compactions.length — both now zero.
    expect(store.loadScanRows()).toHaveLength(0);
    expect(tables["scans"]).toHaveLength(0);
    expect(tables["compactions"]).toHaveLength(0);
    expect(tables["vuln_ledger"]).toHaveLength(0);
    expect(tables["resolved_episodes"]).toHaveLength(0);
    // Clearing jobs drops any stuck import/scan job so the next begin isn't a phantom resume.
    expect(tables["jobs"]).toHaveLength(0);
  });

  it("is a no-op-safe on an already-empty ledger", async () => {
    const store = await import("../src/server/ledgerStore");
    const counts = store.resetLedger();
    expect(counts).toEqual({ scans: 0, vulns: 0, episodes: 0, compactions: 0 });
    expect(store.loadScanRows()).toHaveLength(0);
  });
});
