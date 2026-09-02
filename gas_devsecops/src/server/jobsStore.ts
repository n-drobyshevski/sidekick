// The `jobs` tab: durable state machine rows for sync jobs, and the crash-journal pointer
// `locks.recoverIfNeeded()` rolls back from. The job row doubles as the UI progress API.
//
// THE ROW AND THE TAB HAVE TO NAME THE SAME COLUMNS, and until this revision they did not.
// `JobRow` carried `sync_id`, `step_index`, `nodes_so_far` and `part_refs_json`; the tab
// (sheetsDb.TAB_HEADERS[TABS.jobs]) has never had a column for any of them. Writes map by
// header NAME, so all four were dropped on every append and every checkpoint — silently, and
// with the write reporting success. A resumed sync would have read back step 0 with no rows
// fetched, which is not a crash but a rewind. `JOB_COLUMNS` below is now the tab's column
// list as data, the type is checked against it at compile time, and `jobsStore.test.ts`
// checks it against TAB_HEADERS at run time, because the two files can still drift.
//
// The four dropped fields map onto columns that already existed:
//   sync_id        -> scan_id          the same id; the scans tab spells it scan_id.
//   step_index     -> scope            the battery's step IS a scope, and naming it that
//                                      means a resumed job says which register it is on.
//   nodes_so_far   -> findings_so_far
//   part_refs_json -> (nothing)        raw pages are addressed by deterministic NAME inside
//                                      the sync's Drive folder (archiveStore.writeSyncPage /
//                                      readSyncStepPages), so the folder is the index and a
//                                      list of file ids on the job row was a second copy of
//                                      it that could go stale.
// `journal_ref` is not one of them: it is the rollback pointer described in locks.ts.

import { nowIso, parseTs, type Rec } from "../domain/util";
import type { Scope } from "../domain/config";
import { deleteProp, getProp, setProp } from "./props";
import { appendRows, readAll, readTail, updateWhere, TABS } from "./sheetsDb";

// Fast-path flag: set while a job is in flight, cleared on any terminal
// transition. Lets activeJob() answer "no active job" (the overwhelmingly
// common case — every bootstrap asks) with one Properties read instead of a
// full jobs-tab read. The tab stays the source of truth: a present flag still
// verifies against the tab, and a stale flag self-heals there.
const ACTIVE_JOB_PROP = "ACTIVE_JOB_ID";

export type JobKind = "sync";
export type JobPhase =
  | "FETCHING"
  | "RECONCILING"
  | "PERSISTING"
  | "DONE"
  | "FAILED"
  | "CANCELLED";

/**
 * The `jobs` tab's columns, in tab order, AS DATA.
 *
 * Exported so a test can hold this file and `sheetsDb.TAB_HEADERS[TABS.jobs]` together. A
 * type alone cannot do that: `JobRow` is erased before anything runs, and the failure it
 * would have to catch — a field with no column — happens at run time, inside a write that
 * reports success. The type assertion below covers the other half of the same question.
 */
export const JOB_COLUMNS = [
  "job_id", "kind", "phase", "scan_id", "scope", "cursor", "page",
  "findings_so_far", "page_size", "total_count", "params_json", "journal_ref",
  "error", "started_at", "updated_at",
] as const;

export type JobColumn = (typeof JOB_COLUMNS)[number];

export interface JobRow {
  job_id: string;
  kind: JobKind;
  phase: JobPhase;
  scan_id: string | null;
  /** Which register the battery is on. Null before the first step is chosen. */
  scope: Scope | null;
  cursor: string | null;
  page: number;
  findings_so_far: number;
  page_size: number;
  // Total rows the tenant reports for the CURRENT scope's query (fetched on its page 0).
  // 0 = unknown → the progress UI falls back to an indeterminate bar.
  total_count: number;
  params_json: string | null;
  /** Drive id of the pre-rewrite journal. See locks.ts for what it is rolled back from. */
  journal_ref: string | null;
  error: string | null;
  started_at: string;
  updated_at: string;
}

/**
 * Compile-time proof that `JobRow` and `JOB_COLUMNS` name the SAME SET, both ways round.
 *
 * A field with no column is dropped on write; a column with no field is never written. Both
 * are silent, so neither is allowed to compile. The tuple wrappers stop `Exclude` from
 * distributing and turning "no extras" into a union that accidentally passes.
 */
type Expect<T extends true> = T;
type _JobRowMatchesColumns = Expect<
  [Exclude<keyof JobRow, JobColumn>, Exclude<JobColumn, keyof JobRow>] extends [never, never]
    ? true
    : false
>;

/** Normalize a persisted error cell: real messages survive; "", "null", "undefined" → null. */
function normError(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" || s === "null" || s === "undefined" ? null : s;
}

export function newJobId(kind: JobKind, now?: number): string {
  // Timestamps are second-precision and jobs are single-flight, so collisions can't
  // happen within a kind.
  return `${kind}-${nowIso(now).replace(/[:]/g, "")}`;
}

export function createJob(row: Omit<JobRow, "started_at" | "updated_at">, now?: number): JobRow {
  // No ensureTab() call, unlike gas/'s copy of this function: `appendRows` and `updateWhere`
  // in sheetsDb both route through `ensureHeaders` already, so a tab that predates a column
  // receives it on the write rather than dropping the value. The guard is in the engine here.
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
  if (patch.phase && isTerminalPhase(patch.phase)) deleteProp(ACTIVE_JOB_PROP);
}

function rowToJob(r: Rec): JobRow {
  return {
    job_id: String(r["job_id"] ?? ""),
    kind: (r["kind"] ?? "sync") as JobKind,
    phase: (r["phase"] ?? "FAILED") as JobPhase,
    scan_id: (r["scan_id"] as string | null) ?? null,
    scope: (r["scope"] as Scope | null) ?? null,
    cursor: (r["cursor"] as string | null) ?? null,
    page: Number(r["page"] ?? 0),
    findings_so_far: Number(r["findings_so_far"] ?? 0),
    page_size: Number(r["page_size"] ?? 0),
    total_count: Number(r["total_count"] ?? 0),
    params_json: (r["params_json"] as string | null) ?? null,
    journal_ref: (r["journal_ref"] as string | null) ?? null,
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
 * The poll behind this runs every three seconds for the length of a sync, and the `jobs`
 * tab gains a row per sync and is never trimmed — so a full read got steadily more
 * expensive for the life of the deployment while always answering about a row appended
 * moments earlier.
 *
 * THE FULL-READ FALLBACK IS NOT OPTIONAL. Without it, a job older than the window reads as
 * null — and `app.js` treats a null job as "this job is gone, stop watching, clear the
 * card", so a progress card would silently vanish mid-sync on a long-lived deployment.
 * Worst case here is exactly the old cost, never a wrong answer.
 */
export function getJob(jobId: string): JobRow | null {
  const recent = readTail(TABS.jobs, JOB_TAIL_ROWS).map(rowToJob);
  return recent.find((j) => j.job_id === jobId)
    ?? listJobs().find((j) => j.job_id === jobId)
    ?? null;
}

const TERMINAL: JobPhase[] = ["DONE", "FAILED", "CANCELLED"];

/** Whether a phase is an end state — the single definition activeJob() and Stop both read. */
export function isTerminalPhase(phase: JobPhase): boolean {
  return TERMINAL.includes(phase);
}

/** No progress for this long with no live continuation = the job died mid-flight. */
export const STALE_JOB_MS = 30 * 60_000;

/**
 * Whether a job has gone quiet long enough to be presumed dead. One definition, so "stale"
 * means one thing across every kind this register ever grows: `activeJob()` is single-flight
 * ACROSS kinds, so a job nobody reclaims blocks everything else — including the daily sync.
 * A job with no parseable timestamp is treated as LIVE (it was only just written), because
 * reclaiming on a guess destroys the record that a job was running at all.
 */
export function isStaleJob(job: JobRow, now?: number): boolean {
  const updated = parseTs(job.updated_at);
  if (updated === null) return false;
  return (now ?? Date.now()) - updated >= STALE_JOB_MS;
}

/**
 * Delete every one-shot trigger for a given handler. Each job kind owns its own handler
 * names, so cleanup must be told which — clearing one kind's continuation while reclaiming
 * another's would orphan the second's only wake-up.
 */
export function clearTriggers(handlerName: string): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === handlerName) ScriptApp.deleteTrigger(t);
  }
}

/** The continuation handler owned by each job kind — the one that resumes the next hop. */
export const CONTINUE_HANDLERS: Partial<Record<JobKind, string>> = {
  sync: "trigger_continueSync",
};

/**
 * The WATCHDOG handler owned by each job kind, and it is a second trigger rather than a
 * second use of the first. The continuation wakes the next hop; the watchdog is armed BEFORE
 * the wholesale rewrite and exists to notice that the execution never came back. Reclaiming
 * a job clears both, because a watchdog left armed on a job already marked FAILED wakes up
 * to find nothing to finish and nothing to roll back.
 */
export const WATCHDOG_HANDLERS: Partial<Record<JobKind, string>> = {
  sync: "trigger_watchdogSync",
};

/**
 * Mark a stale job failed so a fresh one can start, clearing the triggers belonging to ITS
 * kind. Returns false (and touches nothing) when the job is still live. Callers must hold the
 * script lock: inside it no hop can be executing, so a stale job is definitively dead and any
 * trigger still listed is dead with it.
 */
export function reclaimIfStale(job: JobRow, now?: number): boolean {
  if (!isStaleJob(job, now)) return false;
  for (const handler of [CONTINUE_HANDLERS[job.kind], WATCHDOG_HANDLERS[job.kind]]) {
    if (handler) clearTriggers(handler);
  }
  updateJob(job.job_id, {
    phase: "FAILED",
    error: "Reclaimed: the job stalled with no progress.",
  });
  return true;
}

/** Most recent job of a kind, by started_at — used to show a finished sync's report. */
export function lastJobOfKind(kind: JobKind): JobRow | null {
  const rows = listJobs().filter((j) => j.kind === kind);
  if (!rows.length) return null;
  return rows.reduce((a, b) => (a.started_at >= b.started_at ? a : b));
}

/**
 * The single in-flight job, or null (jobs are single-flight).
 *
 * THIS ONE KEEPS THE FULL READ, and it is not an oversight that `getJob` was spared. It is
 * the single-flight guard `startSync`, the daily trigger and `continueJob` all rest on, and
 * a miss here is not a slow card — line 2 below reads "no non-terminal row" as "the flag is
 * stale" and DELETES it. So a tail read that scrolled past a wedged job would not merely
 * fail to find it: it would destroy the one record that a job was still running, let a
 * second sync launch alongside the first, and leave `locks.recoverIfNeeded` nothing to reap.
 * Transient corruption made permanent, to save a read that the fast path below already
 * skips entirely in the common case — every bootstrap asks this, and almost every answer is
 * "no job" for one Properties read and no Sheets access at all.
 */
export function activeJob(): JobRow | null {
  if (!getProp(ACTIVE_JOB_PROP)) return null; // fast path: no Sheets read
  const job = listJobs().find((j) => !isTerminalPhase(j.phase)) ?? null;
  if (!job) deleteProp(ACTIVE_JOB_PROP); // stale flag (crash mid-transition) — self-heal
  return job;
}
