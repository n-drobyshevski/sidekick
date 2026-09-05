// The job row and the jobs TAB have to name the same columns, and nothing but this file
// makes them.
//
// The failure is silent and total. `appendRows` and `updateWhere` map values by the headers
// they read off the sheet, so a field with no column is dropped on write and the write still
// reports success. `JobRow` shipped Phase 1 carrying `sync_id`, `step_index`, `nodes_so_far`
// and `part_refs_json` — four fields, no columns, every one discarded. A resumed sync would
// have read back step 0 with nothing fetched: not a crash, a rewind, and the progress card
// would have shown it happily.
//
// The compile-time half of the check lives in jobsStore.ts (JobRow's keys against
// JOB_COLUMNS). This file holds the half a type cannot: JOB_COLUMNS against the tab, at run
// time, in two files that can still drift apart.
//
// sheetsDb is faked with an in-memory table store rather than booted — the GAS globals it
// needs are the whole SpreadsheetApp surface, and none of what is under test here is about
// Sheets.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TABS, TAB_HEADERS } from "../src/server/sheetsDb";

interface Row {
  [k: string]: unknown;
}

const tables: Record<string, Row[]> = {};
const reads = { full: 0, tail: 0 };
const props: Record<string, string> = {};
const deletedTriggers: string[] = [];
let projectTriggers: string[] = [];

vi.mock("../src/server/sheetsDb", async (importOriginal) => {
  // TABS and TAB_HEADERS come from the REAL module: the point of the schema spec below is to
  // compare against what the deployment actually writes, and a stubbed header list would
  // compare the fake to itself and pass forever.
  const real = await importOriginal<typeof import("../src/server/sheetsDb")>();
  // And the fake PROJECTS ONTO THE HEADERS, exactly as writeGrid does, rather than storing
  // whatever object it was handed. That is the whole failure being guarded: a key with no
  // column is dropped in silence. A fake that keeps every key would pass this file forever
  // while the deployment lost the field.
  const project = (tab: string, row: Row): Row => {
    const out: Row = {};
    for (const h of real.TAB_HEADERS[tab] ?? []) if (h in row) out[h] = row[h];
    return out;
  };
  return {
    TABS: real.TABS,
    TAB_HEADERS: real.TAB_HEADERS,
    appendRows: (tab: string, rows: Row[]) => {
      tables[tab] = [...(tables[tab] ?? []), ...rows.map((r) => project(tab, r))];
    },
    readAll: (tab: string) => { reads.full++; return tables[tab] ?? []; },
    // The tail read `getJob` uses. Counted separately so a spec can assert that polling a job
    // no longer touches the whole tab.
    readTail: (tab: string, n: number) => { reads.tail++; return (tables[tab] ?? []).slice(-n); },
    updateWhere: (tab: string, key: string, value: unknown, patch: Row) => {
      const row = (tables[tab] ?? []).find((r) => r[key] === value);
      if (!row) return false;
      Object.assign(row, project(tab, patch));
      return true;
    },
  };
});

vi.mock("../src/server/props", () => ({
  getProp: (k: string) => props[k] ?? null,
  setProp: (k: string, v: string) => { props[k] = v; },
  deleteProp: (k: string) => { delete props[k]; },
}));

vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => projectTriggers.map((h) => ({ getHandlerFunction: () => h })),
  deleteTrigger: (t: { getHandlerFunction: () => string }) => {
    deletedTriggers.push(t.getHandlerFunction());
  },
});

const NOW = Date.parse("2026-09-02T12:00:00Z");
const MIN = 60_000;

async function load() {
  return import("../src/server/jobsStore");
}

function newRow(over: Record<string, unknown> = {}) {
  return {
    job_id: "sync-1",
    kind: "sync" as const,
    phase: "FETCHING" as const,
    scan_id: "scan-1",
    scope: "secrets" as const,
    cursor: null,
    page: 3,
    findings_so_far: 1_200,
    page_size: 500,
    total_count: 1_958,
    params_json: "{}",
    journal_ref: null,
    error: null,
    ...over,
  };
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(props)) delete props[k];
  deletedTriggers.length = 0;
  projectTriggers = [];
  reads.full = 0;
  reads.tail = 0;
  vi.resetModules();
});

describe("the job row and the jobs tab", () => {
  it("names exactly the tab's columns, no more and no fewer", async () => {
    const { JOB_COLUMNS } = await load();
    expect([...JOB_COLUMNS].sort()).toEqual([...TAB_HEADERS[TABS.jobs]!].sort());
  });

  // Set equality is the contract; this pins the four names the old row carried so a revert
  // announces itself by name rather than as a diff in a sorted list.
  it("carries none of the four Phase 1 fields that had no column", async () => {
    const { JOB_COLUMNS } = await load();
    for (const gone of ["sync_id", "step_index", "nodes_so_far", "part_refs_json"]) {
      expect(JOB_COLUMNS, `${gone} is back, and the tab still has no column for it`)
        .not.toContain(gone);
    }
  });

  // The round trip is what the type assertion in jobsStore.ts cannot reach: it proves the
  // VALUES survive a write, which is the thing that silently did not happen before.
  it("round-trips every column through a write and a read", async () => {
    const { createJob, getJob, JOB_COLUMNS } = await load();
    createJob(newRow(), NOW);
    // The STORED cells, after the header projection — `getJob` rebuilds all 15 keys with
    // defaults whatever survived, so reading it alone could never see a dropped field.
    const stored = tables[TABS.jobs]![0]!;
    for (const col of JOB_COLUMNS) {
      expect(Object.keys(stored), `${col} was dropped on write: no such column`).toContain(col);
    }
    const back = getJob("sync-1")!;
    expect(back.scan_id).toBe("scan-1");
    expect(back.scope).toBe("secrets");
    expect(back.findings_so_far).toBe(1_200);
    expect(back.page_size).toBe(500);
    expect(back.total_count).toBe(1_958);
  });
});

describe("isTerminalPhase", () => {
  it("names the three end states and nothing else", async () => {
    const { isTerminalPhase } = await load();
    for (const p of ["DONE", "FAILED", "CANCELLED"] as const) {
      expect(isTerminalPhase(p), `${p} should be terminal`).toBe(true);
    }
    for (const p of ["FETCHING", "RECONCILING", "PERSISTING"] as const) {
      expect(isTerminalPhase(p), `${p} should not be terminal`).toBe(false);
    }
  });

  it("is what clears the active-job flag, so a finished job frees the slot", async () => {
    const { activeJob, createJob, updateJob } = await load();
    createJob(newRow(), NOW);
    expect(activeJob()?.job_id).toBe("sync-1");
    updateJob("sync-1", { phase: "DONE" }, NOW);
    expect(activeJob()).toBeNull();
  });
});

describe("isStaleJob", () => {
  it("is live right up to the threshold and stale at it", async () => {
    const { isStaleJob, STALE_JOB_MS } = await load();
    const at = (agoMs: number) =>
      isStaleJob(
        { ...newRow(), started_at: "", updated_at: new Date(NOW - agoMs).toISOString() },
        NOW,
      );
    expect(at(STALE_JOB_MS - MIN)).toBe(false);
    expect(at(STALE_JOB_MS)).toBe(true);
    expect(at(STALE_JOB_MS + MIN)).toBe(true);
  });

  it("treats an unparseable timestamp as live, not dead", async () => {
    // A row only just written, or one whose cell got mangled — never reclaim on a guess.
    // locks.recoverIfNeeded answers this case the other way round, on purpose; see the note
    // on DEAD_JOB_MS there.
    const { isStaleJob } = await load();
    expect(isStaleJob({ ...newRow(), started_at: "", updated_at: "" }, NOW)).toBe(false);
  });
});

describe("reclaimIfStale", () => {
  // createJob stamps started_at/updated_at itself, so a stale row is made by creating the job
  // in the past rather than by handing it an old timestamp — which also exercises the real
  // write path rather than a fixture that could drift from it.
  const STALE_AGO = 45 * MIN;

  it("leaves a live job alone", async () => {
    const { createJob, getJob, reclaimIfStale } = await load();
    createJob(newRow(), NOW - MIN);
    expect(reclaimIfStale(getJob("sync-1")!, NOW)).toBe(false);
    expect(getJob("sync-1")?.phase).toBe("FETCHING");
  });

  it("fails a stale job so a fresh one can start", async () => {
    const { activeJob, createJob, getJob, reclaimIfStale } = await load();
    createJob(newRow(), NOW - STALE_AGO);
    expect(reclaimIfStale(getJob("sync-1")!, NOW)).toBe(true);
    const after = getJob("sync-1")!;
    expect(after.phase).toBe("FAILED");
    expect(after.error).toMatch(/stalled/i);
    // And the slot is free again — activeJob() is single-flight, so this is what unblocks
    // the next sync.
    expect(activeJob()).toBeNull();
  });

  it("clears the continuation AND the watchdog, and nothing else", async () => {
    // A watchdog left armed on a job already marked FAILED wakes to find nothing to finish
    // and nothing to roll back; the daily trigger is not ours to delete.
    projectTriggers = ["trigger_continueSync", "trigger_watchdogSync", "trigger_dailySync"];
    const { createJob, getJob, reclaimIfStale } = await load();
    createJob(newRow(), NOW - STALE_AGO);
    reclaimIfStale(getJob("sync-1")!, NOW);
    expect(deletedTriggers.sort()).toEqual(["trigger_continueSync", "trigger_watchdogSync"]);
  });
});

describe("lastJobOfKind", () => {
  it("returns null when the tab holds none", async () => {
    const { lastJobOfKind } = await load();
    expect(lastJobOfKind("sync")).toBeNull();
  });

  it("picks the most recent by started_at, not by row order", async () => {
    const { createJob, lastJobOfKind } = await load();
    createJob(newRow({ job_id: "sync-newest" }), NOW);
    createJob(newRow({ job_id: "sync-older" }), NOW - 3 * MIN);
    expect(lastJobOfKind("sync")?.job_id).toBe("sync-newest");
  });
});

// THE 3-SECOND POLL MUST NOT READ THE WHOLE JOBS TAB, and the full-read fallback must
// survive anyway. The two pull against each other, which is why both are pinned.
describe("getJob reads the tail, not the whole tab", () => {
  it("finds a recent job without a full read", async () => {
    const { createJob, getJob } = await load();
    createJob(newRow(), NOW);
    reads.full = 0; reads.tail = 0;
    expect(getJob("sync-1")?.job_id).toBe("sync-1");
    expect(reads.tail).toBe(1);
    expect(reads.full).toBe(0);
  });

  // WITHOUT THE FALLBACK a job older than the window reads as null — and app.js reads a null
  // job as "gone, stop watching and clear the card", so a progress card would silently vanish
  // mid-sync. The worst case with it is exactly the old cost, never a wrong answer.
  it("falls back to the full tab for a job past the tail window", async () => {
    const { createJob, getJob } = await load();
    createJob(newRow({ job_id: "old-1" }), NOW);
    for (let i = 0; i < 40; i++) createJob(newRow({ job_id: "j-" + i }), NOW);
    reads.full = 0; reads.tail = 0;
    expect(getJob("old-1")?.job_id).toBe("old-1");
    expect(reads.tail).toBe(1);
    expect(reads.full).toBe(1); // the fallback fired
  });

  it("activeJob answers 'no job' with no Sheets read at all", async () => {
    // The fast path: every bootstrap asks, and almost every answer is no.
    const { activeJob } = await load();
    expect(activeJob()).toBeNull();
    expect(reads.full).toBe(0);
    expect(reads.tail).toBe(0);
  });

  it("activeJob still reads the whole tab when the flag is raised", async () => {
    const { createJob, activeJob } = await load();
    createJob(newRow(), NOW);
    reads.full = 0; reads.tail = 0;
    expect(activeJob()?.job_id).toBe("sync-1");
    expect(reads.full).toBe(1);
    expect(reads.tail).toBe(0);
  });
});
