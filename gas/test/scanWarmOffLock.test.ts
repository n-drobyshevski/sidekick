// The post-scan warm and support-group refresh run OFF the scan's lock (scanJobs.ts).
//
// Both used to run inline at the tail of afterPersist — inside the scan's script lock, before
// the job read DONE, with the watchdog still armed, and for a scan that finishes in its first
// hop (or a dry run) inside the "Run scan" RPC itself. Nothing on any page says which way it
// ran: the figures are the same either way. What differs is that every write RPC waited out
// minutes of compute and a Wiz graphSearch. So the hand-off itself is what is asserted: at the
// moment the warm is armed the job is DONE, no continuation/watchdog is pending, nothing was
// warmed and Wiz was not called; and the queued refresh does its Wiz call with no lock held and
// its write with one.
//
// scanJobs, jobsStore and locks are the REAL modules; the jobs tab is an in-memory table, and
// the Drive/ledger/Wiz/api edges are fakes whose calls are observable.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const H = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  props: {} as Record<string, string>,
  pages: [] as Record<string, unknown>[],
  persisted: 0,
  recorded: [] as string[],
  triggers: [] as string[],
  lockHeld: false,
  lockBusy: false,
  /** What the world looked like each time api.scheduleWarm was called. */
  armed: [] as { phases: unknown[]; triggers: string[]; sgFetches: number }[],
  warmedInline: 0,
  sgFetches: [] as { lockHeld: boolean }[],
  sgWrites: [] as { lockHeld: boolean }[],
  sgFetchThrows: false,
}));

vi.mock("../src/server/sheetsDb", () => ({
  TABS: { jobs: "jobs" },
  ensureTab: () => {},
  appendRows: (_tab: string, rows: Row[]) => { H.jobs.push(...rows.map((r) => ({ ...r }))); },
  readAll: () => H.jobs,
  readTail: (_tab: string, n: number) => H.jobs.slice(-n),
  updateWhere: (_tab: string, key: string, value: unknown, patch: Row) => {
    const row = H.jobs.find((r) => r[key] === value);
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  },
}));
vi.mock("../src/server/archiveStore", () => ({
  readJournal: () => null,
  trashFile: () => {},
  trashScanArchive: () => {},
  scanFolder: (scanId: string) => ({ getId: () => `folder-${scanId}` }),
  readSlimRecords: () => [],
  readPageRuns: () => [],
  readScanPayload: () => null,
  writeScanPage: () => {},
  writeSlimRecords: () => {},
  writePageRuns: () => {},
  writeFrame: () => {},
}));
vi.mock("../src/server/ledgerStore", () => ({
  writeStateTables: () => {},
  scanRowExists: () => false,
  persistFlatScan: (records: unknown[], options: Row) => {
    H.persisted += 1;
    return {
      deltas: { new_count: 0, resolved_count: 0, reopened_count: 0 },
      scanRow: { scan_id: options["scanId"], total: records.length, disappearance: "complete" },
      absent: 0,
    };
  },
  compactLedger: () => {},
  latestFlatScanRow: () => null,
  loadScanRows: () => [],
}));
vi.mock("../src/server/api", () => ({
  scheduleWarm: () => {
    H.armed.push({
      phases: H.jobs.map((j) => j["phase"]),
      triggers: [...H.triggers],
      sgFetches: H.sgFetches.length,
    });
    H.triggers.push("trigger_continueWarm");
    return true;
  },
  warmReadModels: () => { H.warmedInline += 1; },
}));
vi.mock("../src/server/errorLog", () => ({
  recordError: (op: string) => { H.recorded.push(op); },
}));
vi.mock("../src/server/frameCore", () => ({ buildFrame: () => ({}), pageOfFromRuns: () => () => 1 }));
vi.mock("../src/server/historyStore", () => ({ recordSnapshot: () => {} }));
vi.mock("../src/server/settingsStore", () => ({
  getFetchSeverities: () => null,
  getAutoCompact: () => false,
  getRetentionDays: () => null,
  setSupportGroupMap: () => { H.sgWrites.push({ lockHeld: H.lockHeld }); },
}));
vi.mock("../src/server/supportGroups", () => ({
  fetchSupportGroups: () => {
    H.sgFetches.push({ lockHeld: H.lockHeld });
    if (H.sgFetchThrows) throw new Error("graphSearch failed");
    return { map: { sub: "SG" }, stats: {} };
  },
  refreshSupportGroups: () => { throw new Error("the scan must not refresh inline"); },
}));
vi.mock("../src/server/wizClient", () => ({
  MAX_PAGES: 1000,
  WizQueryError: class WizQueryError extends Error {},
  WizDeltaFilterError: class WizDeltaFilterError extends Error {},
  fetchPage: (opts: { pageNumber: number }) => {
    const page = H.pages[Math.min(opts.pageNumber, H.pages.length - 1)]!;
    return { endCursor: `c${opts.pageNumber + 1}`, totalCount: null, partialErrors: [], ...page };
  },
}));

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => H.props[k] ?? null,
    setProperty: (k: string, v: string) => { H.props[k] = v; },
    deleteProperty: (k: string) => { delete H.props[k]; },
  }),
});
vi.stubGlobal("LockService", {
  getScriptLock: () => ({
    tryLock: () => {
      if (H.lockBusy || H.lockHeld) return false;
      H.lockHeld = true;
      return true;
    },
    waitLock: () => {},
    releaseLock: () => { H.lockHeld = false; },
  }),
});
vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => H.triggers.map((h) => ({ getHandlerFunction: () => h })),
  deleteTrigger: (t: { getHandlerFunction: () => string }) => {
    const i = H.triggers.indexOf(t.getHandlerFunction());
    if (i >= 0) H.triggers.splice(i, 1);
  },
  newTrigger: (handler: string) => ({
    timeBased: () => ({ after: () => ({ create: () => { H.triggers.push(handler); } }) }),
  }),
});

import { continueJob, runPendingSupportGroupRefresh, startScan } from "../src/server/scanJobs";
import { PROP_KEYS } from "../src/server/props";

const PENDING = PROP_KEYS.supportGroupRefreshPending;
const n = (id: string): Row => ({ id, name: `CVE-${id}`, severity: "HIGH", status: "OPEN" });
const live = () => {
  H.props["WIZ_API_URL"] = "https://api.example.wiz.io/graphql";
  H.props["WIZ_API_TOKEN"] = "token";
};

beforeEach(() => {
  H.jobs.length = 0;
  for (const k of Object.keys(H.props)) delete H.props[k];
  H.pages = [{ nodes: [n("1"), n("2")], totalCount: 2, hasNextPage: false }];
  H.persisted = 0;
  H.recorded.length = 0;
  H.triggers.length = 0;
  H.lockHeld = false;
  H.lockBusy = false;
  H.armed.length = 0;
  H.warmedInline = 0;
  H.sgFetches.length = 0;
  H.sgWrites.length = 0;
  H.sgFetchThrows = false;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("a scan hands the warm off instead of running it", () => {
  it("a first-hop scan (inside the Run-scan RPC): DONE, watchdog cleared, then one warm armed", () => {
    live();
    startScan();
    expect(H.persisted).toBe(1);
    expect(H.warmedInline).toBe(0);
    expect(H.armed).toEqual([{ phases: ["DONE"], triggers: [], sgFetches: 0 }]);
    // The watchdog finishScan armed before the write is gone; the warm's one-shot is all that
    // is left.
    expect(H.triggers).toEqual(["trigger_continueWarm"]);
  });

  it("a RECONCILING resume on a continuation hop does the same", () => {
    live();
    const now = new Date().toISOString();
    H.jobs.push({
      job_id: "scan-a", kind: "scan", phase: "RECONCILING", scan_id: "s-a", cursor: null, page: 1,
      findings_so_far: 0, page_size: 0, total_count: 0, journal_ref: null, error: null,
      total_reported: true, partial_pages: 0, started_at: now, updated_at: now,
      params_json: JSON.stringify({
        mode: "live", severities: null, extraFilterBy: null, incremental: false, baselineScanId: null,
      }),
    });
    H.triggers.push("trigger_continueScan"); // the hop that fired
    continueJob();
    expect(H.persisted).toBe(1);
    expect(H.warmedInline).toBe(0);
    expect(H.armed).toEqual([{ phases: ["DONE"], triggers: [], sgFetches: 0 }]);
    expect(H.triggers).toEqual(["trigger_continueWarm"]);
  });

  it("a dry run arms the warm too, and queues no support-group refresh", () => {
    // No credentials → dryRunScan, which commits inside the RPC's lock.
    const res = startScan();
    expect(res.message).toBe("Dry-run scan saved.");
    expect(H.warmedInline).toBe(0);
    expect(H.armed).toHaveLength(1);
    expect(H.triggers).toEqual(["trigger_continueWarm"]);
    expect(H.props[PENDING]).toBeUndefined();
  });
});

describe("the post-scan support-group refresh", () => {
  it("is queued by a live scan, not run inside it", () => {
    live();
    startScan();
    expect(H.sgFetches).toEqual([]);
    expect(H.sgWrites).toEqual([]);
    expect(H.props[PENDING]).toBeTruthy();
  });

  it("runs from the warm hop: the Wiz call unlocked, the write locked, then dequeued", () => {
    live();
    startScan();
    expect(runPendingSupportGroupRefresh()).toBe(true);
    expect(H.sgFetches).toEqual([{ lockHeld: false }]);
    expect(H.sgWrites).toEqual([{ lockHeld: true }]);
    expect(H.lockHeld).toBe(false);
    expect(H.props[PENDING]).toBeUndefined();
    // Dequeued: a second pass does nothing.
    expect(runPendingSupportGroupRefresh()).toBe(false);
    expect(H.sgFetches).toHaveLength(1);
  });

  it("does nothing with nothing queued", () => {
    live();
    expect(runPendingSupportGroupRefresh()).toBe(false);
    expect(H.sgFetches).toEqual([]);
  });

  it("records a failed graphSearch once, keeps the old map, and dequeues", () => {
    live();
    startScan();
    H.sgFetchThrows = true;
    expect(runPendingSupportGroupRefresh()).toBe(false);
    expect(H.recorded).toEqual(["supportGroupRefresh"]);
    expect(H.sgWrites).toEqual([]);
    expect(H.props[PENDING]).toBeUndefined();
  });

  it("stays queued, unrecorded, when the ledger is busy", () => {
    live();
    startScan();
    H.lockBusy = true;
    expect(runPendingSupportGroupRefresh()).toBe(false);
    expect(H.recorded).toEqual([]);
    expect(H.sgWrites).toEqual([]);
    expect(H.props[PENDING]).toBeTruthy();
    H.lockBusy = false;
    expect(runPendingSupportGroupRefresh()).toBe(true);
  });
});
