// jobs-tab schema healing and the shared stale-job reclaim.
//
// Both guard the same class of failure: a deployment whose `jobs` tab predates a column
// silently truncates every write to it (appendRows/updateWhere map by the headers read off
// the sheet), and a job nobody reclaims blocks every other job forever, because activeJob()
// is single-flight ACROSS kinds. sheetsDb is faked with the in-memory table store the
// historyStore/ledgerReset specs use.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [k: string]: unknown;
}

const tables: Record<string, Row[]> = {};
const ensured: string[] = [];
const deletedTriggers: string[] = [];
let projectTriggers: string[] = [];

vi.mock("../src/server/sheetsDb", () => {
  const TABS = { jobs: "jobs" };
  return {
    TABS,
    ensureTab: (tab: string) => {
      ensured.push(tab);
    },
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

vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () =>
    projectTriggers.map((h) => ({ getHandlerFunction: () => h })),
  deleteTrigger: (t: { getHandlerFunction: () => string }) => {
    deletedTriggers.push(t.getHandlerFunction());
  },
});

const NOW = Date.parse("2026-08-10T12:00:00Z");
const MIN = 60_000;

async function load() {
  return import("../src/server/jobsStore");
}

function newRow(over: Record<string, unknown> = {}) {
  return {
    job_id: "backfill-1",
    kind: "backfill" as const,
    phase: "BACKFILLING" as const,
    scan_id: null,
    cursor: null,
    page: 7,
    findings_so_far: 0,
    page_size: 0,
    total_count: 42,
    params_json: "{}",
    journal_ref: null,
    error: null,
    ...over,
  };
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  ensured.length = 0;
  deletedTriggers.length = 0;
  projectTriggers = [];
  vi.resetModules();
});

describe("createJob heals the jobs tab schema", () => {
  // The regression behind "Running — 7 of 0 scan(s) replayed": total_count was dropped on
  // write because the tab predated the column, so it read back as 0 while `page` (an original
  // column) survived. Without the ensureTab guard the next column added has the same fate.
  it("ensures the tab's headers before appending", async () => {
    const { createJob } = await load();
    createJob(newRow(), NOW);
    expect(ensured).toContain("jobs");
  });

  it("writes total_count, the column whose absence broke the progress count", async () => {
    const { createJob, getJob } = await load();
    createJob(newRow(), NOW);
    expect(getJob("backfill-1")?.total_count).toBe(42);
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
    const { isStaleJob } = await load();
    expect(isStaleJob({ ...newRow(), started_at: "", updated_at: "" }, NOW)).toBe(false);
  });
});

describe("reclaimIfStale", () => {
  // createJob stamps started_at/updated_at itself, so a stale row is made by creating the job
  // in the past rather than by handing it an old timestamp — which also exercises the real
  // write path rather than a fixture that could drift from it.
  const STALE_AGO = 45 * MIN;
  const createStale = async (kind: "scan" | "backfill") => {
    const { createJob } = await load();
    return createJob(newRow({ kind, job_id: kind + "-1" }), NOW - STALE_AGO);
  };

  it("leaves a live job alone", async () => {
    const { createJob, getJob, reclaimIfStale } = await load();
    createJob(newRow(), NOW - MIN);
    expect(reclaimIfStale(getJob("backfill-1")!, NOW)).toBe(false);
    expect(getJob("backfill-1")?.phase).toBe("BACKFILLING");
  });

  it("fails a stale job so a fresh one can start", async () => {
    await createStale("backfill");
    const { activeJob, getJob, reclaimIfStale } = await load();
    expect(reclaimIfStale(getJob("backfill-1")!, NOW)).toBe(true);
    const after = getJob("backfill-1")!;
    expect(after.phase).toBe("FAILED");
    expect(after.error).toMatch(/stalled/i);
    // And the slot is free again — activeJob() is single-flight across kinds, so this is what
    // unblocks the daily scan.
    expect(activeJob()).toBeNull();
  });

  it("clears the continuation trigger belonging to the job's OWN kind", async () => {
    // The bug this guards: clearing only the scan handler while reclaiming a backfill left
    // the backfill's trigger orphaned (and vice versa).
    projectTriggers = ["trigger_continueScan", "trigger_continueBackfill", "trigger_dailyScan"];
    await createStale("backfill");
    const { getJob, reclaimIfStale } = await load();
    reclaimIfStale(getJob("backfill-1")!, NOW);
    expect(deletedTriggers).toEqual(["trigger_continueBackfill"]);
  });

  it("clears the scan handler when the stale job is a scan", async () => {
    projectTriggers = ["trigger_continueScan", "trigger_continueBackfill"];
    await createStale("scan");
    const { getJob, reclaimIfStale } = await load();
    reclaimIfStale(getJob("scan-1")!, NOW);
    expect(deletedTriggers).toEqual(["trigger_continueScan"]);
  });
});
