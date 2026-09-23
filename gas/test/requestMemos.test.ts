// Per-execution memoization of the hot loaders: one tab read per request, refreshed
// after writes. sheetsDb is mocked with a call counter; modules are re-imported per
// test so the module-level memos start cold (as in a fresh GAS execution).

import { beforeEach, describe, expect, it, vi } from "vitest";

const readAllCalls: string[] = [];
let settingsRows: Array<Record<string, unknown>> = [];
let sgMapRows: Array<Record<string, unknown>> = [];

vi.mock("../src/server/sheetsDb", () => ({
  TABS: {
    scans: { name: "scans", headers: [] },
    settings: { name: "settings", headers: [] },
    supportGroupMap: { name: "support_group_map", headers: [] },
  },
  readAll: (tab: { name: string }) => {
    readAllCalls.push(tab.name);
    if (tab.name === "support_group_map") return sgMapRows;
    return tab.name === "settings" ? settingsRows : [];
  },
  ensureTab: () => {},
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

// Measured in production: the seven-row settings tab cost 0.8–1 s in nearly every execution and
// 7.1 s in a doGet that opened the spreadsheet first. It is cached across executions now, keyed
// on the data version so a save (the only writer, which bumps it) moves every reader on.
describe("settingsStore cross-execution cache", () => {
  const props = new Map<string, string>();
  const cache = new Map<string, string>();
  let cacheThrows = false;

  beforeEach(() => {
    props.clear();
    cache.clear();
    cacheThrows = false;
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => { props.set(k, v); },
        deleteProperty: (k: string) => { props.delete(k); },
      }),
    });
    vi.stubGlobal("CacheService", {
      getScriptCache: () => ({
        get: (k: string) => { if (cacheThrows) throw new Error("cache down"); return cache.get(k) ?? null; },
        put: (k: string, v: string) => { if (cacheThrows) throw new Error("cache down"); cache.set(k, v); },
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const settingsReads = () => readAllCalls.filter((t) => t === "settings").length;
  // A fresh module graph is a fresh GAS execution: the per-execution memo starts cold.
  const nextExecution = async () => {
    vi.resetModules();
    return import("../src/server/settingsStore");
  };

  it("serves a second execution from the cache without opening the tab", async () => {
    (await nextExecution()).getRetentionDays();
    expect(settingsReads()).toBe(1);
    expect((await nextExecution()).getRetentionDays()).toBe(30);
    expect(settingsReads()).toBe(1);
  });

  it("hands the next execution the saved dict, not the tab's old one", async () => {
    const first = await nextExecution();
    first.getRetentionDays();
    first.saveSettings({ retention_days: 45 });
    expect((await nextExecution()).getRetentionDays()).toBe(45);
    expect(settingsReads()).toBe(1);
  });

  it("re-reads the tab once the data version moves", async () => {
    (await nextExecution()).getRetentionDays();
    props.set("DATA_VERSION", "999");
    (await nextExecution()).getRetentionDays();
    expect(settingsReads()).toBe(2);
  });

  it("does not cache a dict too large for one CacheService value", async () => {
    settingsRows = [{ key: "support_group_map", value_json: JSON.stringify({ blob: "x".repeat(100_000) }) }];
    (await nextExecution()).loadSettings();
    (await nextExecution()).loadSettings();
    expect(settingsReads()).toBe(2);
  });

  it("falls back to the tab when the cache throws", async () => {
    cacheThrows = true;
    expect((await nextExecution()).getRetentionDays()).toBe(30);
    expect(settingsReads()).toBe(1);
  });
});

// The support-group map tab (~5k rows) was read in every execution that attached support
// groups — 0.7–1.4 s measured, often the execution's first Sheets touch. It is cached across
// executions now, keyed on the data version its only writer (`setSupportGroupMap`) bumps, and
// gzip-chunked through serverCache because it is over CacheService's 100 KB per value.
describe("settingsStore support-group map cache", () => {
  const props = new Map<string, string>();
  const cache = new Map<string, string>();
  let cacheThrows = false;

  beforeEach(async () => {
    props.clear();
    cache.clear();
    cacheThrows = false;
    sgMapRows = [{ token: "sub-1", group: "Platform" }, { token: "sub-2", group: "Data" }];
    const { gzipSync, gunzipSync } = await import("node:zlib");
    vi.stubGlobal("Utilities", {
      newBlob: (data: string | number[]) => ({ data }),
      gzip: (blob: { data: string }) => ({ getBytes: () => Array.from(gzipSync(Buffer.from(blob.data, "utf8"))) }),
      ungzip: (blob: { data: number[] }) => ({
        getDataAsString: () => gunzipSync(Buffer.from(blob.data)).toString("utf8"),
      }),
      base64Encode: (bytes: number[]) => Buffer.from(bytes).toString("base64"),
      base64Decode: (s: string) => Array.from(Buffer.from(s, "base64")),
    });
    const guard = () => { if (cacheThrows) throw new Error("cache down"); };
    vi.stubGlobal("CacheService", {
      getScriptCache: () => ({
        get: (k: string) => { guard(); return cache.get(k) ?? null; },
        getAll: (ks: string[]) => { guard(); return Object.fromEntries(ks.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)!])); },
        put: (k: string, v: string) => { guard(); cache.set(k, v); },
        putAll: (e: Record<string, string>) => { guard(); for (const [k, v] of Object.entries(e)) cache.set(k, v); },
      }),
    });
    vi.stubGlobal("PropertiesService", {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => { props.set(k, v); },
        deleteProperty: (k: string) => { props.delete(k); },
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const tabReads = () => readAllCalls.filter((t) => t === "support_group_map").length;
  // A fresh module graph is a fresh GAS execution: the per-execution memo starts cold.
  const nextExecution = async () => {
    vi.resetModules();
    return import("../src/server/settingsStore");
  };

  it("serves a second execution from the cache without reading the tab", async () => {
    expect((await nextExecution()).getSupportGroupMap().map).toEqual({ "sub-1": "Platform", "sub-2": "Data" });
    expect((await nextExecution()).getSupportGroupMap().map).toEqual({ "sub-1": "Platform", "sub-2": "Data" });
    expect(tabReads()).toBe(1);
  });

  it("hands the next execution the map setSupportGroupMap just wrote", async () => {
    const first = await nextExecution();
    first.getSupportGroupMap();
    first.setSupportGroupMap({ "sub-9": "Security" });
    expect((await nextExecution()).getSupportGroupMap().map).toEqual({ "sub-9": "Security" });
    expect(tabReads()).toBe(1);
  });

  it("falls back to the tab when the cache throws", async () => {
    cacheThrows = true;
    expect((await nextExecution()).getSupportGroupMap().map).toEqual({ "sub-1": "Platform", "sub-2": "Data" });
    expect(tabReads()).toBe(1);
  });
});
