// The `jobs` tab: durable state machine rows for scan / delete / compact jobs, and
// the crash journal pointer used by locks.recoverIfNeeded(). The job row doubles as
// the UI progress API.

import { nowIso, parseTs, type Rec } from "../domain/util";
import { appendRows, ensureTab, readAll, updateWhere, TABS } from "./sheetsDb";

export type JobKind = "scan" | "delete" | "compact" | "import" | "backfill";
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
  return full;
}

export function updateJob(jobId: string, patch: Partial<JobRow>, now?: number): void {
  updateWhere(TABS.jobs, "job_id", jobId, {
    ...patch,
    updated_at: nowIso(now),
  } as Rec);
}

export function listJobs(): JobRow[] {
  return readAll(TABS.jobs).map((r) => ({
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
  }));
}

export function getJob(jobId: string): JobRow | null {
  return listJobs().find((j) => j.job_id === jobId) ?? null;
}

const TERMINAL: JobPhase[] = ["DONE", "FAILED", "CANCELLED"];

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

/** The single in-flight job, or null (jobs are single-flight across kinds). */
export function activeJob(): JobRow | null {
  return listJobs().find((j) => !TERMINAL.includes(j.phase)) ?? null;
}
