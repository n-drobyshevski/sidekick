// Per-execution memoization of the hot loaders: one tab read per request, refreshed
// after writes. sheetsDb is mocked with a call counter; modules are re-imported per
// test so the module-level memos start cold (as in a fresh GAS execution).

import { beforeEach, describe, expect, it, vi } from "vitest";

const readAllCalls: string[] = [];
let settingsRows: Array<Record<string, unknown>> = [];

vi.mock("../src/server/sheetsDb", () => ({
  TABS: {
    scans: { name: "scans", headers: [] },
    settings: { name: "settings", headers: [] },
  },
  readAll: (tab: { name: string }) => {
    readAllCalls.push(tab.name);
    return tab.name === "settings" ? settingsRows : [];
  },
  overwrite: () => {},
  appendRows: () => {},
}));

// bumpDataVersion (called by invalidateLedgerMemos/saveSettings) hits PropertiesService.
vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: () => null,
    setProperty: () => {},
    deleteProperty: () => {},
  }),
});

beforeEach(() => {
  readAllCalls.length = 0;
  settingsRows = [{ key: "retention_days", value_json: "30" }];
  vi.resetModules();
});

describe("settingsStore memo", () => {
  it("reads the settings tab once per execution across all getters", async () => {
    const store = await import("../src/server/settingsStore");
    store.loadSettings();
    store.getFetchSeverities();
    store.getDisplaySeverities();
    store.getRetentionDays();
    store.getAutoCompact();
    store.getDomains();
    expect(readAllCalls.filter((t) => t === "settings")).toHaveLength(1);
  });

  it("serves the saved dict after saveSettings without re-reading", async () => {
    const store = await import("../src/server/settingsStore");
    expect(store.getRetentionDays()).toBe(30);
    store.saveSettings({ retention_days: 45 });
    expect(store.getRetentionDays()).toBe(45);
    expect(readAllCalls.filter((t) => t === "settings")).toHaveLength(1);
  });
});

describe("ledgerStore scan-rows memo", () => {
  it("reads the scans tab once until invalidated", async () => {
    const ledger = await import("../src/server/ledgerStore");
    ledger.loadScanRows();
    ledger.loadScanRows();
    ledger.scanRowExists("x");
    ledger.latestScanRow();
    expect(readAllCalls.filter((t) => t === "scans")).toHaveLength(1);
    ledger.invalidateLedgerMemos();
    ledger.loadScanRows();
    expect(readAllCalls.filter((t) => t === "scans")).toHaveLength(2);
  });
});
