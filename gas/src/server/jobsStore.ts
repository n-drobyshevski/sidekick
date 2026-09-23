// The `jobs` tab: durable state machine rows for scan / delete / compact jobs, and
// the crash journal pointer used by locks.recoverIfNeeded(). The job row doubles as
// the UI progress API.

import { nowIso, parseTs, type Rec } from "../domain/util";
import { appendRows, ensureTab, readAll, readTail, updateWhere, TABS } from "./sheetsDb";

export type JobKind = "scan" | "delete" | "compact" | "import" | "backfill" | "purge";
export type JobPhase =
  | "FETCHING"
  | "RECONCILING"
  | "PERSISTING"
  | "REPLAYING"
  // Sharded-import phases. Deliberately distinct from PERSISTING/REPLAYING so
  // recoverIfNeeded (locks.ts) never touches an in-flight import — it owns its own resume
  // via committed row counts, not a journal rollback.
  | "STAGING"
  | "APPLYING"
  | "FINALIZING"
  // Risk-signal backfill. Deliberately its own phase, and deliberately NOT in
  // locks.recoverIfNeeded's rollback set: the merge it performs is monotone and idempotent,
  // so a crashed hop leaves valid (merely incomplete) state and re-running converges. Rolling
  // it back would discard correct work for no reason.
  | "BACKFILLING"
  // Severity purge. Excluded from locks.recoverIfNeeded's rollback set for the same reason
  // as BACKFILLING: removing a severity twice equals removing it once, so a hop killed
  // mid-walk leaves valid (merely incomplete) state and re-running converges. Rolling it
  // back from the journal would restore rows the operator deliberately deleted.
  | "PURGING"
  | "DONE"
  | "FAILED"
  | "CANCELLED";

export interface JobRow {
  job_id: string;
  kind: JobKind;
  phase: JobPhase;
  scan_id: string | null;
  cursor: string | null;
  page: number;
  findings_so_far: number;
  page_size: number;
  // Total findings the tenant reports for this scan's filter (fetched on page 0).
  // 0 = unknown (older deployment without the column, or a tenant that omits it) →
  // the progress UI falls back to an indeterminate bar.
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

export function newJobId(kind: JobKind, now?: number): string {
  // Deterministic-enough id without uuid: kind + timestamp + a counter suffix from
  // the tab length is unnecessary — timestamps are second-precision and jobs are
  // single-flight, so collisions can't happen within a kind.
  return `${kind}-${nowIso(now).replace(/[:]/g, "")}`;
}

export function createJob(row: Omit<JobRow, "started_at" | "updated_at">, now?: number): JobRow {
  // Self-heal the header row first. appendRows and updateWhere both map values by the headers
  // READ OFF THE SHEET, so any field whose column a deployment predates is silently dropped —
  // which is how `total_count` came back as 0 on tabs created before it was added, leaving the
  // scan progress bar indeterminate and the backfill panel reporting "N of 0". Idempotent, one
  // header read per job.
  ensureTab(TABS.jobs);
  const full: JobRow = { ...row, started_at: nowIso(now), updated_at: nowIso(now) };
  appendRows(TABS.jobs, [full as unknown as Rec]);
  forgetActiveJob();
  return full;
}

export function updateJob(jobId: string, patch: Partial<JobRow>, now?: number): void {
  updateWhere(TABS.jobs, "job_id", jobId, {
    ...patch,
    updated_at: nowIso(now),
  } as Rec);
  forgetActiveJob();
}

function rowToJob(r: Rec): JobRow {
  return {
    job_id: String(r["job_id"] ?? ""),
    kind: (r["kind"] ?? "scan") as JobKind,
    phase: (r["phase"] ?? "FAILED") as JobPhase,
    scan_id: (r["scan_id"] as string | null) ?? null,
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

/** How many trailing rows `getJob` scans before falling back to the full tab. A client only
 *  ever polls a job it just started, and jobs are single-flight across kinds, so the one being
 *  asked about is almost always the last row written. */
const JOB_TAIL_ROWS = 25;

/**
 * One job by id.
 *
 * Reads the TAIL rather than the whole tab, because this is what a 3-second poll calls:
 * `api_getJobStatus` -> `getJob` -> what used to be `listJobs()` -> a full-range `getValues`
 * over a tab that only ever grows. Every scan, backfill and purge appends to it and nothing but
 * a full ledger reset truncates it, so the poll got slower for the life of the deployment.
 *
 * THE FULL-READ FALLBACK IS NOT OPTIONAL. Without it, asking for a job older than the tail
 * window returns null — and `app.js` reads a null job as "this job is gone, stop watching and
 * clear the card", so a progress card would silently vanish mid-scan on a busy ledger. With it,
 * the worst case is exactly today's cost.
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
 * Whether a job has gone quiet long enough to be presumed dead. Shared by every job kind so
 * "stale" means one thing: a scan and a backfill that both stopped updating are equally stuck,
 * and `activeJob()` is single-flight ACROSS kinds, so a job nobody reclaims blocks everything
 * else — including the daily scan. A job with no parseable timestamp is treated as live (it
 * was only just written).
 */
export function isStaleJob(job: JobRow, now?: number): boolean {
  const updated = parseTs(job.updated_at);
  if (updated === null) return false;
  return (now ?? Date.now()) - updated >= STALE_JOB_MS;
}

/**
 * Delete every one-shot continuation trigger for a given handler. Each job kind owns its own
 * handler name (`trigger_continueScan` / `trigger_continueBackfill`), so cleanup must be told
 * which — clearing only the scan handler while reclaiming a backfill would orphan the
 * backfill's trigger, and vice versa.
 */
export function clearTriggers(handlerName: string): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === handlerName) ScriptApp.deleteTrigger(t);
  }
}

/** The continuation handler owned by each job kind (see clearTriggers). */
export const CONTINUE_HANDLERS: Partial<Record<JobKind, string>> = {
  scan: "trigger_continueScan",
  backfill: "trigger_continueBackfill",
  purge: "trigger_continuePurge",
};

/**
 * Mark a stale job failed so a fresh one can start, clearing the continuation trigger
 * belonging to ITS kind. Returns false (and touches nothing) when the job is still live.
 * Callers must hold the script lock: inside it no hop can be executing, so a stale job is
 * definitively dead and any trigger still listed is dead with it.
 */
export function reclaimIfStale(job: JobRow, now?: number): boolean {
  if (!isStaleJob(job, now)) return false;
  const handler = CONTINUE_HANDLERS[job.kind];
  if (handler) clearTriggers(handler);
  updateJob(job.job_id, {
    phase: "FAILED",
    error: "Reclaimed: the job stalled with no progress.",
  });
  return true;
}

/** Most recent job of a kind, by started_at — used to show a finished backfill's report. */
export function lastJobOfKind(kind: JobKind): JobRow | null {
  const rows = listJobs().filter((j) => j.kind === kind);
  if (!rows.length) return null;
  return rows.reduce((a, b) => (a.started_at >= b.started_at ? a : b));
}

/**
 * The single in-flight job, or null (jobs are single-flight across kinds).
 *
 * THIS ONE KEEPS THE FULL READ, and that is deliberate rather than an oversight `getJob` was
 * spared. It is the single-flight guard the whole job system rests on: a wedged non-terminal
 * job that had scrolled past a tail window would become invisible here, and `startScan` would
 * launch a second scan alongside the first. That is a data-integrity failure, not a slow card.
 */
export function activeJob(): JobRow | null {
  return listJobs().find((j) => !isTerminalPhase(j.phase)) ?? null;
}

// ------------------------------------------------------- the active job, for DISPLAY only
//
// `activeJob()` reads the whole jobs tab — ~0.3–0.9 s as a read, but up to 7–9 s when it is the
// first thing in an execution to open the spreadsheet, which on doGet it was. bootstrap's live
// `activeJob` field paid that on every page load. This copy lives in CacheService.
//
// KEYED BY A GENERATION, NOT DROPPED ON WRITE. The first version of this cache dropped one fixed
// key after each write and lived for 60 s, because a reader that read the sheet just before a
// write could put its stale answer back after the drop — the TTL was all that bounded it. And a
// 60 s TTL meant the first doGet after a quiet minute opened the spreadsheet again. Now every
// writer of the tab (`createJob`, `updateJob`, the ledger reset) moves the generation, and the
// value is cached under `activeJob2:<generation>`. A reader reads the generation BEFORE the
// sheet, so a stale answer can only ever land under a generation nobody reads any more — which
// is what lets the copy live for CacheService's six-hour maximum.
//
// A missing generation (evicted, expired, first run) is minted fresh: that costs one miss and
// can never serve a stale value, because nothing was ever stored under a fresh one.
//
// DISPLAY ONLY, NEVER A GUARD. It feeds what a page shows; the client polls a running job by id
// through `getJob`, which is never cached, and everything whose correctness depends on the
// answer (the warm's in-flight check, single-flight mutations) keeps calling `activeJob()`.
const ACTIVE_JOB_GEN_KEY = "activeJobGen";
const ACTIVE_JOB_CACHE_PREFIX = "activeJob2:";
const ACTIVE_JOB_CACHE_TTL_SEC = 21_600;

function newGeneration(): string {
  return String(Date.now()) + "-" + Math.floor(Math.random() * 1e9);
}

/** `activeJob()` through a generation-keyed cache. For what a page SHOWS, never what it guards. */
export function activeJobForDisplay(): JobRow | null {
  let key: string | null = null;
  try {
    const cache = CacheService.getScriptCache();
    let gen = cache.get(ACTIVE_JOB_GEN_KEY);
    if (!gen) {
      gen = newGeneration();
      cache.put(ACTIVE_JOB_GEN_KEY, gen, ACTIVE_JOB_CACHE_TTL_SEC);
    }
    key = ACTIVE_JOB_CACHE_PREFIX + gen;
    // "null" is a cached answer (no job in flight); a missing key is a miss.
    const raw = cache.get(key);
    if (raw !== null) return JSON.parse(raw) as JobRow | null;
  } catch (e) {
    console.warn(`Active-job cache read failed: ${e}`);
    key = null;
  }
  const job = activeJob();
  if (key) {
    try {
      CacheService.getScriptCache().put(key, JSON.stringify(job), ACTIVE_JOB_CACHE_TTL_SEC);
    } catch (e) {
      console.warn(`Active-job cache write failed: ${e}`);
    }
  }
  return job;
}

/**
 * Move the display copy to a new generation. Every writer of the jobs tab calls this AFTER its
 * write, so any reader that reads the new generation reads the sheet after the write too.
 */
export function forgetActiveJob(): void {
  try {
    CacheService.getScriptCache().put(ACTIVE_JOB_GEN_KEY, newGeneration(), ACTIVE_JOB_CACHE_TTL_SEC);
  } catch (e) {
    console.warn(`Active-job cache generation bump failed: ${e}`);
  }
}
