// The progress poll's read path.
//
// `api_getJobStatus` runs every three seconds for the length of a sync, and the `jobs` tab
// gains a row per sync and is never trimmed — so what this costs, and what it puts on the
// wire, are both properties worth pinning rather than rediscovering.
//
// These specs assert the COST as well as the answer, using the shim's service-call counters.
// Asserting only the answer is what let the full-tab read survive: it was never wrong, only
// unboundedly expensive, and no test can see that without counting something.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootSyncedServer, measure, resetToSynced, teardownServer } from "./gasEnv";
import type { JobRow } from "../src/server/jobsStore";

let server: Awaited<ReturnType<typeof bootSyncedServer>>;
type JobsStore = typeof import("../src/server/jobsStore");

async function jobs(): Promise<JobsStore> {
  return await import("../src/server/jobsStore");
}

function jobsSheet() {
  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty("LEDGER_SPREADSHEET_ID")!,
  );
  return ss.getSheetByName("jobs")!;
}

function jobRowCount(): number {
  return Math.max(0, jobsSheet().getLastRow() - 1);
}

/** A real job row, appended the way a sync appends one. */
async function makeJob(jobId: string, phase: JobRow["phase"] = "FETCHING"): Promise<void> {
  const { createJob } = await jobs();
  createJob({
    job_id: jobId,
    kind: "sync",
    phase,
    sync_id: "sync-0001",
    step_index: 2,
    // The two fields with no client reader that must never reach the wire, given real values
    // so their absence downstream is a projection and not an empty cell.
    cursor: "eyJvZmZzZXQiOjQyfQ==",
    page: 3,
    nodes_so_far: 120,
    total_count: 480,
    part_refs_json: JSON.stringify(["drive-file-aaa", "drive-file-bbb"]),
    params_json: JSON.stringify({ incremental: true }),
    error: null,
  });
}

/** Append `n` finished filler jobs, the way a year of the daily trigger would. */
function padJobs(n: number): void {
  const sh = jobsSheet();
  const cols = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, cols).getValues()[0]!.map(String);
  const at = (name: string) => headers.indexOf(name);
  const rows: unknown[][] = [];
  for (let i = 0; i < n; i++) {
    const r: unknown[] = new Array(cols).fill("");
    r[at("job_id")] = `sync-filler-${i}`;
    r[at("kind")] = "sync";
    r[at("phase")] = "DONE";
    r[at("started_at")] = "2026-01-01T00:00:00.000Z";
    r[at("updated_at")] = "2026-01-01T00:00:00.000Z";
    rows.push(r);
  }
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, cols).setValues(rows);
}

beforeAll(async () => {
  server = await bootSyncedServer();
});
afterAll(() => teardownServer());

describe("getJob — bounded read with a full-read fallback", () => {
  it("finds a recent job without reading the whole tab", async () => {
    server = await resetToSynced();
    const { getJob } = await jobs();
    padJobs(400);
    await makeJob("sync-live");             // appended last, where a live job always is
    const rows = jobRowCount();
    const cols = jobsSheet().getLastColumn();
    expect(rows).toBeGreaterThanOrEqual(401);

    const { value, counters } = measure(() => getJob("sync-live"));
    expect(value?.job_id).toBe("sync-live");

    // The whole tab is `rows + 1` lines. A tail read must be a small constant multiple of
    // the tab's WIDTH, never of its length — that is the entire point.
    expect(counters.cellsRead).toBeLessThan((rows + 1) * cols);
    expect(counters.cellsRead).toBeLessThanOrEqual(26 * cols + cols);
  });

  it("falls back to the full read for a job older than the tail window", async () => {
    server = await resetToSynced();
    const { getJob } = await jobs();
    await makeJob("sync-buried");
    padJobs(400);                            // bury it well past the window

    const { value, counters } = measure(() => getJob("sync-buried"));

    // The answer is the thing that matters. `app.js` reads a null job as "gone, stop
    // watching, clear the card", so a miss here would make a progress card vanish mid-sync.
    expect(value).not.toBeNull();
    expect(value?.job_id).toBe("sync-buried");
    expect(value?.nodes_so_far).toBe(120);

    // And it cost the full read — the honest worst case: never wrong, never worse than the
    // behaviour it replaces.
    const cols = jobsSheet().getLastColumn();
    expect(counters.cellsRead).toBeGreaterThan((jobRowCount() + 1) * cols * 0.5);
  });

  it("returns null for an unknown id, having tried both reads", async () => {
    server = await resetToSynced();
    const { getJob } = await jobs();
    padJobs(60);
    const { value, counters } = measure(() => getJob("sync-nope"));
    expect(value).toBeNull();
    // The tail read, then the whole tab: more range reads than the tail alone would make.
    expect(counters.rangeReads).toBeGreaterThanOrEqual(3);
  });
});

describe("activeJob keeps the full read", () => {
  it("reads the whole tab even when the live job is inside the tail window", async () => {
    server = await resetToSynced();
    const { activeJob } = await jobs();
    padJobs(400);
    await makeJob("sync-live");              // createJob sets the fast-path flag

    const cols = jobsSheet().getLastColumn();
    const rows = jobRowCount();
    const { value, counters } = measure(() => activeJob());
    expect(value?.job_id).toBe("sync-live");

    // Not a preference. A tail read that missed a wedged job would take activeJob's
    // stale-flag branch and DELETE the record that a sync was still running — letting a
    // second sync launch beside the first, permanently rather than transiently.
    expect(counters.cellsRead).toBeGreaterThanOrEqual((rows + 1) * cols);
  });

  it("answers 'no job' without touching the sheet at all", async () => {
    server = await resetToSynced();
    const { activeJob } = await jobs();
    PropertiesService.getScriptProperties().deleteProperty("ACTIVE_JOB_ID");
    const { value, counters } = measure(() => activeJob());
    expect(value).toBeNull();
    expect(counters.cellsRead).toBe(0);
    expect(counters.propGet).toBe(1);
  });
});

describe("jobStatus projection", () => {
  it("ships the nine fields the client reads and nothing else", async () => {
    server = await resetToSynced();
    await makeJob("sync-live");
    const res = server.api.getJobStatus({ jobId: "sync-live" }) as
      { ok: boolean; data: Record<string, unknown> | null };
    expect(res.ok).toBe(true);
    expect(res.data).not.toBeNull();

    expect(Object.keys(res.data!).sort()).toEqual([
      "error", "job_id", "nodes_so_far", "page", "phase",
      "started_at", "step_index", "total_count", "updated_at",
    ]);
  });

  it("never puts the tenant cursor or Drive file ids on the wire", async () => {
    server = await resetToSynced();
    await makeJob("sync-live");
    const res = server.api.getJobStatus({ jobId: "sync-live" }) as
      { ok: boolean; data: Record<string, unknown> | null };

    // Named individually rather than by "not in the key list", so that a future JobRow
    // column called something else still cannot smuggle one of these through.
    for (const forbidden of ["cursor", "part_refs_json", "params_json", "sync_id", "kind"]) {
      expect(res.data).not.toHaveProperty(forbidden);
    }
    // The values really are non-empty on the row, so their absence above is a projection
    // rather than an empty cell that would have looked the same.
    const { getJob } = await jobs();
    const row = getJob("sync-live");
    expect(row?.cursor).toBeTruthy();
    expect(row?.part_refs_json).toBeTruthy();
  });

  it("is null for an unknown job, which is what stops the poll", async () => {
    server = await resetToSynced();
    const res = server.api.getJobStatus({ jobId: "sync-nope" }) as
      { ok: boolean; data: unknown };
    expect(res.ok).toBe(true);
    expect(res.data).toBeNull();
  });
});
