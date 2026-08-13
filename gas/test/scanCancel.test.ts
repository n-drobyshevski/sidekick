// Stop, and the recovery paths behind it.
//
// The failure this guards against: a scan whose PERSISTING hop was killed by the 6-minute
// execution cap sat "Saving" for twelve hours with no way out. Stop refused every phase but
// FETCHING/RECONCILING, and the only other route to locks.recoverIfNeeded() — starting a scan —
// was hidden behind the job card. Both recovery paths were unreachable at once, and because
// jobsStore.activeJob() is single-flight ACROSS kinds, that one row blocked the daily trigger
// too. These specs pin the escape hatches: the persist watchdog, Stop's per-phase escalation,
// continueJob's refusal to strand a walk, and resetStuckJob().
//
// jobsStore and locks are the REAL modules (they are what's under test); sheetsDb is the
// in-memory table fake the jobsStore/historyStore specs use, and the Drive/ledger layers are
// mocked so journal rollback and archive cleanup are observable.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [k: string]: unknown;
}

const tables: Record<string, Row[]> = {};
const calls: string[] = [];
let projectTriggers: string[] = [];
const createdTriggers: Array<{ handler: string; afterMs: number }> = [];
const scriptProps: Record<string, string> = {};
let scanRows = new Set<string>();
let journalPayload: unknown = null;
let externalLockHold = false;
let persistThrows = false;

vi.mock("../src/server/sheetsDb", () => {
  const TABS = { jobs: "jobs" };
  return {
    TABS,
    ensureTab: () => {},
    appendRows: (tab: string, rows: Row[]) => {
      tables[tab] = [...(tables[tab] ?? []), ...rows];
    },
    readAll: (tab: string) => tables[tab] ?? [],
    updateWhere: (tab: string, key: string, value: unknown, patch: Row) => {
      const row = (tables[tab] ?? []).find((r) => r[key] === value);
      if (!row) return false;
      Object.assign(row, patch);
      return true;
    },
  };
});

vi.mock("../src/server/archiveStore", () => ({
  readJournal: (ref: string | null) => {
    calls.push(`readJournal:${ref}`);
    return journalPayload;
  },
  trashFile: (ref: string | null) => calls.push(`trashFile:${ref}`),
  trashScanArchive: (id: string) => calls.push(`trashScanArchive:${id}`),
  scanFolder: (scanId: string) => ({ getId: () => `folder-${scanId}` }),
  readSlimRecords: () => [],
  readPageRuns: () => [],
  readScanPayload: () => null,
  writeScanPage: () => {},
  writeSlimRecords: () => {},
  writePageRuns: () => {},
  writeFrame: () => {},
  writeJournal: () => "journal-1",
}));

vi.mock("../src/server/ledgerStore", () => ({
  writeStateTables: () => calls.push("writeStateTables"),
  scanRowExists: (scanId: string) => scanRows.has(scanId),
  persistFlatScan: () => {
    calls.push("persistFlatScan");
    if (persistThrows) throw new Error("execution killed mid-write");
  },
  persistGroupedScan: () => calls.push("persistGroupedScan"),
  compactLedger: () => {},
  latestFlatScanRow: () => null,
  loadScanRows: () => [],
}));

vi.mock("../src/server/api", () => ({ warmReadModels: () => {} }));
vi.mock("../src/server/errorLog", () => ({ recordError: () => {} }));
vi.mock("../src/server/frameCore", () => ({
  buildFrame: () => ({}),
  pageOfFromRuns: () => () => 1,
}));
vi.mock("../src/server/historyStore", () => ({ recordSnapshot: () => {} }));
vi.mock("../src/server/settingsStore", () => ({
  getFetchSeverities: () => null,
  getAutoCompact: () => false,
  getRetentionDays: () => null,
}));
vi.mock("../src/server/supportGroups", () => ({ refreshSupportGroups: () => {} }));
vi.mock("../src/server/wizClient", () => ({
  fetchPage: () => ({ nodes: [], endCursor: null, hasNextPage: false, totalCount: 0 }),
  MAX_PAGES: 1000,
  WizDeltaFilterError: class WizDeltaFilterError extends Error {},
}));

vi.stubGlobal("LockService", {
  getScriptLock: () => {
    let mine = false;
    return {
      tryLock: () => {
        if (externalLockHold) return false;
        externalLockHold = true;
        mine = true;
        return true;
      },
      releaseLock: () => {
        if (mine) externalLockHold = false;
      },
    };
  },
});

vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => projectTriggers.map((h) => ({ getHandlerFunction: () => h })),
  deleteTrigger: (t: { getHandlerFunction: () => string }) => {
    const i = projectTriggers.indexOf(t.getHandlerFunction());
    if (i >= 0) projectTriggers.splice(i, 1);
  },
  newTrigger: (handler: string) => ({
    timeBased: () => ({
      after: (afterMs: number) => ({
        create: () => {
          createdTriggers.push({ handler, afterMs });
          projectTriggers.push(handler);
        },
      }),
    }),
  }),
});

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => scriptProps[k] ?? null,
    setProperty: (k: string, v: string) => {
      scriptProps[k] = v;
    },
    deleteProperty: (k: string) => {
      delete scriptProps[k];
    },
  }),
});

const MIN = 60_000;
const SCAN_ID = "2026-08-13T02:00:00.000Z";

async function load() {
  return import("../src/server/scanJobs");
}

/** Put a job row straight on the fake tab so `updated_at` is exactly as old as the case needs. */
function seedJob(over: Row = {}): Row {
  const row: Row = {
    job_id: "scan-1",
    kind: "scan",
    phase: "FETCHING",
    scan_id: SCAN_ID,
    cursor: null,
    page: 3,
    findings_so_far: 1500,
    page_size: 500,
    total_count: 11630,
    params_json: JSON.stringify({
      mode: "live",
      severities: null,
      extraFilterBy: null,
      incremental: false,
      baselineScanId: null,
    }),
    journal_ref: null,
    error: null,
    started_at: new Date(Date.now() - 12 * 60 * MIN).toISOString(),
    updated_at: new Date(Date.now() - 60 * MIN).toISOString(),
    ...over,
  };
  tables["jobs"] = [...(tables["jobs"] ?? []), row];
  return row;
}

function jobRow(jobId = "scan-1"): Row {
  return (tables["jobs"] ?? []).find((r) => r["job_id"] === jobId)!;
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(scriptProps)) delete scriptProps[k];
  calls.length = 0;
  createdTriggers.length = 0;
  projectTriggers = [];
  scanRows = new Set();
  journalPayload = null;
  externalLockHold = false;
  persistThrows = false;
  vi.resetModules();
});

describe("cancelScan reaches a scan killed mid-persist", () => {
  // The twelve-hour wedge. PERSISTING used to be refused outright ("the scans row is
  // imminent"), which is only true while an execution is alive to write it.
  it("rolls the ledger back from the journal when the commit record never landed", async () => {
    const { cancelScan } = await load();
    seedJob({ phase: "PERSISTING", journal_ref: "journal-1" });
    journalPayload = { scans: [] };

    const res = cancelScan("scan-1");

    expect(calls).toContain("writeStateTables"); // ledger restored, not left half-written
    expect(calls).toContain("trashFile:journal-1");
    expect(jobRow()["phase"]).toBe("FAILED");
    expect(res.stopped).toBe(true);
  });

  it("closes the job as DONE when the persist actually completed", async () => {
    const { cancelScan } = await load();
    seedJob({ phase: "PERSISTING", journal_ref: "journal-1" });
    scanRows.add(SCAN_ID);

    const res = cancelScan("scan-1");

    expect(jobRow()["phase"]).toBe("DONE");
    expect(calls).not.toContain("writeStateTables"); // a committed scan is never rolled back
    // The archive is what the committed `scans` row points at — cancelling it would orphan it.
    expect(calls).not.toContain(`trashScanArchive:folder-${SCAN_ID}`);
    expect(res.stopped).toBe(true);
  });

  it("reports the scan gone even with no journal to restore from", async () => {
    const { cancelScan } = await load();
    seedJob({ phase: "PERSISTING", journal_ref: null });
    journalPayload = null;

    expect(cancelScan("scan-1").stopped).toBe(true);
    expect(jobRow()["phase"]).toBe("FAILED");
  });
});

describe("cancelScan during the page walk", () => {
  it("cancels an orphaned FETCHING scan and drops its uncommitted archive", async () => {
    const { cancelScan } = await load();
    seedJob({ phase: "FETCHING" });
    projectTriggers.push("trigger_continueScan"); // listed but dead

    const res = cancelScan("scan-1");

    expect(jobRow()["phase"]).toBe("CANCELLED");
    expect(calls).toContain(`trashScanArchive:folder-${SCAN_ID}`);
    expect(projectTriggers).not.toContain("trigger_continueScan");
    expect(res.stopped).toBe(true);
  });

  it("leaves a live hop to the cooperative flag rather than racing it", async () => {
    const { cancelScan } = await load();
    seedJob({ phase: "FETCHING", updated_at: new Date().toISOString() });
    externalLockHold = true; // a running hop holds the script lock

    const res = cancelScan("scan-1");

    expect(res.stopped).toBe(false);
    expect(res.message).toBe("Stopping scan…");
    expect(scriptProps["CANCEL_scan-1"]).toBe("1"); // the flag the fetch loop polls
    expect(jobRow()["phase"]).toBe("FETCHING"); // untouched — the hop finishes the page
  });

  it("says so when the job already finished", async () => {
    const { cancelScan } = await load();
    seedJob({ phase: "DONE" });
    expect(cancelScan("scan-1").message).toBe("Scan already finished.");
  });
});

describe("cancelScan reaches jobs of other kinds", () => {
  // Jobs are single-flight ACROSS kinds and bootstrap hands the client whatever activeJob()
  // returns, so the scan card can be showing a wedged backfill. Refusing it ("No such scan.")
  // left the one job blocking every scan with no in-app way to clear it.
  it("reclaims a stalled backfill", async () => {
    const { cancelScan } = await load();
    seedJob({ job_id: "backfill-1", kind: "backfill", phase: "BACKFILLING", scan_id: null });
    projectTriggers.push("trigger_continueBackfill");

    const res = cancelScan("backfill-1");

    expect(res.stopped).toBe(true);
    expect(jobRow("backfill-1")["phase"]).toBe("FAILED");
    expect(projectTriggers).not.toContain("trigger_continueBackfill");
  });

  it("leaves a backfill that is merely between hops alone", async () => {
    const { cancelScan } = await load();
    seedJob({
      job_id: "backfill-1", kind: "backfill", phase: "BACKFILLING", scan_id: null,
      updated_at: new Date().toISOString(),
    });

    const res = cancelScan("backfill-1");

    expect(res.stopped).toBe(false);
    expect(jobRow("backfill-1")["phase"]).toBe("BACKFILLING");
  });
});

describe("the persist watchdog", () => {
  it("arms a continuation before the write and retires it once the write lands", async () => {
    const { continueJob } = await load();
    seedJob({ phase: "RECONCILING" });

    continueJob();

    expect(calls).toContain("persistFlatScan");
    expect(jobRow()["phase"]).toBe("DONE");
    expect(createdTriggers.map((t) => t.handler)).toContain("trigger_continueScan");
    expect(projectTriggers).not.toContain("trigger_continueScan"); // cleared on success
  });

  it("leaves the watchdog armed when the write dies", async () => {
    const { continueJob } = await load();
    seedJob({ phase: "RECONCILING" });
    persistThrows = true;

    expect(() => continueJob()).toThrow();
    // Nothing else would notice: PERSISTING schedules no hop of its own.
    expect(projectTriggers).toContain("trigger_continueScan");
  });

  it("recovers rather than re-running the persist when the watchdog fires", async () => {
    const { continueJob } = await load();
    seedJob({ phase: "PERSISTING", journal_ref: "journal-1" });
    journalPayload = { scans: [] };

    continueJob();

    expect(calls).toContain("writeStateTables");
    expect(calls).not.toContain("persistFlatScan"); // the journal makes it atomic, not a retry
    expect(jobRow()["phase"]).toBe("FAILED");
  });
});

describe("continueJob never strands the walk", () => {
  it("re-arms the continuation when the lock is held by another mutation", async () => {
    const { continueJob } = await load();
    seedJob({ phase: "FETCHING" });
    externalLockHold = true;

    // clearContinuationTriggers() runs inside the lock, so a timeout leaves this hop's
    // one-shot spent with no successor unless the busy path schedules one.
    expect(() => continueJob()).toThrow(/busy/i);
    expect(createdTriggers.map((t) => t.handler)).toContain("trigger_continueScan");
  });
});

describe("resetStuckJob", () => {
  it("clears a wedged job and every continuation trigger", async () => {
    const { resetStuckJob } = await load();
    seedJob({ phase: "FETCHING" });
    projectTriggers.push("trigger_continueScan", "trigger_continueBackfill");
    scriptProps["CANCEL_scan-1"] = "1";

    const res = resetStuckJob();

    expect(res.cleared).toBe(true);
    expect(res.phase).toBe("FETCHING"); // reports the phase it was wedged in
    expect(jobRow()["phase"]).toBe("FAILED");
    expect(projectTriggers).toEqual([]);
    expect(scriptProps["CANCEL_scan-1"]).toBeUndefined();
  });

  it("is safe to run when nothing is wrong", async () => {
    const { resetStuckJob } = await load();
    seedJob({ phase: "DONE" });

    const res = resetStuckJob();

    expect(res.cleared).toBe(false);
    expect(res.message).toBe("No active job.");
    expect(jobRow()["phase"]).toBe("DONE");
  });
});
