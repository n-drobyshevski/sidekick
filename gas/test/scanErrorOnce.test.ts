// A scan that fails on its first hop is listed ONCE in the recent-errors log.
//
// The first hop of the page walk runs inside the "Run scan" RPC: `api.runScan` → `run()` →
// `scanJobs.startScan` → `step`. `step`'s failure path records the error (op "scan") and
// rethrows, and `run()` records whatever reaches it — so before the shared log remembered the
// values it had recorded, one Wiz failure on page 0 put two identical entries on Settings →
// Diagnostics. This drives the real api, scanJobs, jobsStore, locks and errorLog modules
// against an in-memory jobs tab and Script Properties; only the Drive/Sheets/Wiz edges are fake.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const H = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  props: {} as Record<string, string>,
  fetchError: null as unknown,
}));

vi.mock("../src/server/sheetsDb", () => ({
  TABS: { jobs: "jobs", scans: { name: "scans", headers: [] }, vulnLedger: { name: "vuln_ledger", headers: [] } },
  TAB_HEADERS: {}, SCHEMA_VERSION: 1,
  ensureTab: () => {}, ensureTabs: () => {},
  appendRows: (_tab: string, rows: Row[]) => { H.jobs.push(...rows.map((r) => ({ ...r }))); },
  readAll: () => H.jobs, readTail: (_tab: string, n: number) => H.jobs.slice(-n),
  updateWhere: (_tab: string, key: string, value: unknown, patch: Row) => {
    const row = H.jobs.find((r) => r[key] === value);
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  },
  overwrite: () => {}, cellUsage: () => ({ total: 0, tabs: {} }),
}));
vi.mock("../src/server/archiveStore", () => ({
  readJournal: () => null, trashFile: () => {}, trashScanArchive: () => {},
  scanFolder: () => ({ getId: () => "folder" }),
  readSlimRecords: () => [], readPageRuns: () => [],
  writeScanPage: () => {}, writeSlimRecords: () => {}, writePageRuns: () => {},
}));
vi.mock("../src/server/ledgerStore", () => ({
  scanRowExists: () => false, writeStateTables: () => {}, latestFlatScanRow: () => null,
}));
vi.mock("../src/server/settingsStore", () => ({ getFetchSeverities: () => null }));
vi.mock("../src/server/wizClient", () => ({
  BASE_FILTER_WORDS: [],
  MAX_PAGES: 1000,
  WizDeltaFilterError: class WizDeltaFilterError extends Error {},
  fetchPage: () => { throw H.fetchError; },
}));

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => H.props[k] ?? null,
    setProperty: (k: string, v: string) => { H.props[k] = v; },
    deleteProperty: (k: string) => { delete H.props[k]; },
  }),
});
vi.stubGlobal("LockService", {
  getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }),
});
vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => [],
  deleteTrigger: () => {},
  newTrigger: () => ({ timeBased: () => ({ after: () => ({ create: () => {} }) }) }),
});

import { runScan } from "../src/server/api";
import { recentErrors } from "../src/server/errorLog";

beforeEach(() => {
  H.jobs.length = 0;
  for (const k of Object.keys(H.props)) delete H.props[k];
  // Credentials present, so startScan walks for real instead of saving the sample data.
  H.props["WIZ_API_URL"] = "https://api.example.wiz.io/graphql";
  H.props["WIZ_API_TOKEN"] = "token";
  H.fetchError = null;
});

describe("a scan that fails on its first hop", () => {
  it("fails the RPC and the job, and is listed once in the error log", () => {
    H.fetchError = new Error("Wiz API 503: upstream unavailable");
    const res = runScan({});
    expect(res).toMatchObject({ ok: false, errorKind: "error", error: "Wiz API 503: upstream unavailable" });
    expect(H.jobs).toHaveLength(1);
    expect(H.jobs[0]).toMatchObject({ phase: "FAILED" });
    expect(recentErrors().map((e) => [e.op, e.message])).toEqual([
      ["scan", "Wiz API 503: upstream unavailable"],
    ]);
  });

  it("a second failure is a second entry — the dedupe is per thrown value, not per message", () => {
    H.fetchError = new Error("Wiz API 503: upstream unavailable");
    runScan({});
    H.fetchError = new Error("Wiz API 503: upstream unavailable");
    runScan({});
    expect(recentErrors()).toHaveLength(2);
  });
});
