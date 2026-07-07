// The `jobs` tab: durable state machine rows for scan / delete / compact jobs, and
// the crash journal pointer used by locks.recoverIfNeeded(). The job row doubles as
// the UI progress API.

import { nowIso, type Rec } from "../domain/util";
import { appendRows, readAll, updateWhere, TABS } from "./sheetsDb";

export type JobKind = "scan" | "delete" | "compact" | "import";
export type JobPhase =
  | "FETCHING"
  | "RECONCILING"
  | "PERSISTING"
  | "REPLAYING"
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

/** The single in-flight job, or null (jobs are single-flight across kinds). */
export function activeJob(): JobRow | null {
  return listJobs().find((j) => !TERMINAL.includes(j.phase)) ?? null;
}
