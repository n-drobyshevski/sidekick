// The `jobs` tab: durable state machine rows for scan jobs. The job row doubles as the UI
// progress API, and — the part that matters — as the CHECKPOINT a resumed execution reads to
// find out where the last one stopped.
//
// THE ROW SHAPE AND THE TAB SCHEMA USED TO DISAGREE, and nothing failed. This file was forked
// from gas_ai (`sync_id`, `step_index`, `nodes_so_far`, `part_refs_json`) while
// `sheetsDb.TAB_HEADERS[TABS.jobs]` was written for this register (`scan_id`, `scope`,
// `findings_so_far`, `page_size`, `journal_ref`). Writes map by header NAME — `writeGrid`
// projects a row onto the declared headers — so all four fork-era fields were dropped on the
// way to the sheet and read back as `null`/`0` by the defaults below. A resumed hop would have
// restarted from page 0 with a null cursor, every hop, forever: not a crash, an infinite
// re-fetch of the whole register. `test/jobsStore.test.js` now round-trips a checkpoint, which
// is the test whose absence let this ship.
//
// Resolved toward the TAB, because that is the shape this register's battery needs: a scan
// walks ONE scope per step, so `scope` names the step in flight and the Drive spill folder is
// derived from `scan_id` — there is nothing for `step_index` or `part_refs_json` to carry that
// `scope` + `page` do not.

import { nowIso, type Rec } from "../domain/util";
import { deleteProp, getProp, setProp } from "./props";
import { appendRows, readAll, readTail, updateWhere, TABS } from "./sheetsDb";

// Fast-path flag: set while a job is in flight, cleared on any terminal
// transition. Lets activeJob() answer "no active job" (the overwhelmingly
// common case — every bootstrap asks) with one Properties read instead of a
// full jobs-tab read. The tab stays the source of truth: a present flag still
// verifies against the tab, and a stale flag self-heals there.
const ACTIVE_JOB_PROP = "ACTIVE_JOB_ID";

export type JobKind = "scan";
export type JobPhase =
  | "FETCHING"
  | "RECONCILING"
  | "PERSISTING"
  | "DONE"
  | "FAILED"
  | "CANCELLED";

export interface JobRow {
  job_id: string;
  kind: JobKind;
  phase: JobPhase;
  /** Identity of the scan being walked; also the Drive spill folder name. */
  scan_id: string | null;
  /**
   * The scope whose step is in flight. A job covers the collected scopes in order, one step
   * each, and every step commits its own `scans` row — so this is not decoration, it is which
   * register a resumed hop is allowed to touch.
   */
  scope: string | null;
  /** The GraphQL endCursor checkpoint for the current step. */
  cursor: string | null;
  /** Pages completed for the current step. Resets to 0 when a step starts. */
  page: number;
  findings_so_far: number;
  /** The page size the walk actually used — 500, or 250 after a gateway cost complaint. */
  page_size: number;
  // Total rows the tenant reports for the CURRENT step's query (fetched on its page 0).
  // 0 = unknown → the progress UI falls back to an indeterminate bar.
  total_count: number;
  params_json: string | null;
  journal_ref: string | null;
  error: string | null;
  started_at: string;
  updated_at: string;
}

/** Normalize a persisted error cell: real messages survive; "", "null", "undefined" → null. */
function normError(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" || s === "null" || s === "undefined" ? null : s;
}

/** A persisted text cell: "" and the two stringified nullish spellings read back as null. */
function normText(v: unknown): string | null {
  const s = v == null ? "" : String(v);
  return s === "" || s === "null" || s === "undefined" ? null : s;
}

export function newJobId(kind: JobKind, now?: number): string {
  // Timestamps are second-precision and jobs are single-flight, so collisions can't
  // happen within a kind.
  return `${kind}-${nowIso(now).replace(/[:]/g, "")}`;
}

export function createJob(row: Omit<JobRow, "started_at" | "updated_at">, now?: number): JobRow {
  const full: JobRow = { ...row, started_at: nowIso(now), updated_at: nowIso(now) };
  appendRows(TABS.jobs, [full as unknown as Rec]);
  setProp(ACTIVE_JOB_PROP, full.job_id);
  return full;
}

export function updateJob(jobId: string, patch: Partial<JobRow>, now?: number): void {
  updateWhere(TABS.jobs, "job_id", jobId, {
    ...patch,
    updated_at: nowIso(now),
  } as Rec);
  if (patch.phase && TERMINAL.includes(patch.phase)) deleteProp(ACTIVE_JOB_PROP);
}

function rowToJob(r: Rec): JobRow {
  return {
    job_id: String(r["job_id"] ?? ""),
    kind: (r["kind"] ?? "scan") as JobKind,
    phase: (r["phase"] ?? "FAILED") as JobPhase,
    scan_id: normText(r["scan_id"]),
    scope: normText(r["scope"]),
    cursor: normText(r["cursor"]),
    page: Number(r["page"] ?? 0),
    findings_so_far: Number(r["findings_so_far"] ?? 0),
    page_size: Number(r["page_size"] ?? 0),
    total_count: Number(r["total_count"] ?? 0),
    params_json: normText(r["params_json"]),
    journal_ref: normText(r["journal_ref"]),
    error: normError(r["error"]),
    started_at: String(r["started_at"] ?? ""),
    updated_at: String(r["updated_at"] ?? ""),
  };
}

export function listJobs(): JobRow[] {
  return readAll(TABS.jobs).map(rowToJob);
}

/**
 * How many rows back the progress poll looks before falling back to the whole tab.
 *
 * Jobs are single-flight and appended, so the job anyone is polling is the LAST row —
 * 25 is slack, not a guess about how far back a live job can be.
 */
const JOB_TAIL_ROWS = 25;

/**
 * One job by id: recent rows first, the whole tab only if that misses.
 *
 * The poll behind this runs every three seconds for the length of a scan, and the `jobs`
 * tab gains a row per scan and is never trimmed — so a full read got steadily more
 * expensive for the life of the deployment while always answering about a row appended
 * moments earlier.
 *
 * THE FULL-READ FALLBACK IS NOT OPTIONAL. Without it, a job older than the window reads as
 * null — and `app.js` treats a null job as "this job is gone, stop watching, clear the
 * card", so a progress card would silently vanish mid-scan on a long-lived deployment.
 * Worst case here is exactly the old cost, never a wrong answer.
 */
export function getJob(jobId: string): JobRow | null {
  const recent = readTail(TABS.jobs, JOB_TAIL_ROWS).map(rowToJob);
  return recent.find((j) => j.job_id === jobId)
    ?? listJobs().find((j) => j.job_id === jobId)
    ?? null;
}

const TERMINAL: JobPhase[] = ["DONE", "FAILED", "CANCELLED"];

export function isTerminalPhase(phase: JobPhase): boolean {
  return TERMINAL.includes(phase);
}

/**
 * The single in-flight job, or null (jobs are single-flight).
 *
 * THIS ONE KEEPS THE FULL READ, and it is not an oversight that `getJob` was spared. It is
 * the single-flight guard `startScan`, the daily trigger and `continueJob` all rest on, and
 * a miss here is not a slow card — line 2 below reads "no non-terminal row" as "the flag is
 * stale" and DELETES it. So a tail read that scrolled past a wedged job would not merely
 * fail to find it: it would destroy the one record that a job was still running, let a
 * second scan launch alongside the first, and leave `locks.recoverIfNeeded` nothing to reap.
 * Transient corruption made permanent, to save a read that the fast path below already
 * skips entirely in the common case — every bootstrap asks this, and almost every answer is
 * "no job" for one Properties read and no Sheets access at all.
 */
export function activeJob(): JobRow | null {
  if (!getProp(ACTIVE_JOB_PROP)) return null; // fast path: no Sheets read
  const job = listJobs().find((j) => !TERMINAL.includes(j.phase)) ?? null;
  if (!job) deleteProp(ACTIVE_JOB_PROP); // stale flag (crash mid-transition) — self-heal
  return job;
}

/** A job whose last heartbeat is older than this has no live execution behind it. */
export const STALE_JOB_MS = 30 * 60_000;

/**
 * Has this job gone quiet?
 *
 * Computed HERE, server-side, and shipped to the client rather than recomputed there: the
 * browser's clock can be minutes off, which would mislabel a healthy job as wedged or — the
 * costly direction — leave a wedged one looking live, with the Stop button hidden behind
 * "it is still working".
 *
 * An unparseable `updated_at` reads as NOT stale: a row only just written by a hop whose
 * clock the sheet has not yet returned is the common cause, and calling that dead would let
 * a running scan be reclaimed out from under itself.
 */
export function isStaleJob(job: JobRow, now?: number): boolean {
  const updated = Date.parse(job.updated_at);
  if (!Number.isFinite(updated)) return false;
  return (now ?? Date.now()) - updated >= STALE_JOB_MS;
}
