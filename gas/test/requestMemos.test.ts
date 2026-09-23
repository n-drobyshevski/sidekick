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
  // `getJob` reads the tail rather than the whole tab; the fake mirrors that so the
  // module under test can be loaded at all.
  readTail: (tab: { name: string }) => (tab.name === "settings" ? settingsRows : []),
  overwrite: () => {},
  appendRows: () => {},
}));

// The durable snapshot `loadState()` prefers over the tabs: two live ledger rows.
const snapshotLedger = {
  a: { vuln_key: "a", severity: "HIGH", status: "OPEN", asset_id: "x", first_seen: "2026-01-01T00:00:00Z",
    last_seen: "2026-09-01T00:00:00Z", resolved_at: null },
  b: { vuln_key: "b", severity: "LOW", status: "RESOLVED", asset_id: "y", first_seen: "2026-01-01T00:00:00Z",
    last_seen: "2026-02-01T00:00:00Z", resolved_at: "2026-02-01T00:00:00Z" },
};
vi.mock("../src/server/archiveStore", () => ({
  readLedgerSnapshot: () => ({ ledger: JSON.parse(JSON.stringify(snapshotLedger)), episodes: [] }),
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

// `baseRows` was re-derived per CALLER — five times for one Executive load, twenty-seven for one
// warm — and was the largest single cost measured. It is derived once per execution now, and
// handed out as copies because callers annotate rows in place (`_domain`, `risk_tier`, and
// `_supportGroup`, which one split overwrites with its NONE bucket).
describe("ledgerStore base-rows memo", () => {
  const derivations = (log: ReturnType<typeof vi.spyOn>) =>
    log.mock.calls.filter((c: unknown[]) => String(c[0]).includes('"stage":"baseRows"')).length;

  it("derives once per execution and again after a write", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ledger = await import("../src/server/ledgerStore");
    ledger.loadBaseRows();
    ledger.loadBaseRows();
    expect(derivations(log)).toBe(1);
    ledger.invalidateLedgerMemos();
    ledger.loadBaseRows();
    expect(derivations(log)).toBe(2);
    log.mockRestore();
  });

  it("hands each caller rows it can annotate without touching the next caller's", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ledger = await import("../src/server/ledgerStore");
    const first = ledger.loadBaseRows() as unknown as Record<string, unknown>[];
    for (const r of first) r["_supportGroup"] = "(none)";
    const second = ledger.loadBaseRows() as unknown as Record<string, unknown>[];
    expect(second.map((r) => r["_supportGroup"])).toEqual([undefined, undefined]);
    expect(second.map((r) => r["vuln_key"]).sort()).toEqual(["a", "b"]);
    log.mockRestore();
  });

  it("does not memoize a read at an explicit instant", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ledger = await import("../src/server/ledgerStore");
    const at = Date.parse("2026-09-01T00:00:00Z");
    const rows = ledger.loadBaseRows(at);
    expect(rows.find((r) => r.vuln_key === "a")!.age_days).toBe(243);
    expect(derivations(log)).toBe(0);
    log.mockRestore();
  });
});
