// The `jobs` tab: durable state machine rows for sync jobs. The job row doubles as
// the UI progress API. Unlike the OS-vulns scan job (one cursor over one query), a
// sync walks a battery of queries — step_index tracks which query is in flight and
// part_refs_json accumulates the Drive file ids of the per-step raw pages.

import { nowIso, type Rec } from "../domain/util";
import { appendRows, readAll, updateWhere, TABS } from "./sheetsDb";

export type JobKind = "sync";
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
  sync_id: string | null;
  step_index: number;
  cursor: string | null;
  page: number;
  nodes_so_far: number;
  // Total rows the tenant reports for the CURRENT step's query (fetched on its page 0).
  // 0 = unknown → the progress UI falls back to an indeterminate bar.
  total_count: number;
  part_refs_json: string | null;
  params_json: string | null;
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
  // Timestamps are second-precision and jobs are single-flight, so collisions can't
  // happen within a kind.
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
    kind: (r["kind"] ?? "sync") as JobKind,
    phase: (r["phase"] ?? "FAILED") as JobPhase,
    sync_id: (r["sync_id"] as string | null) ?? null,
    step_index: Number(r["step_index"] ?? 0),
    cursor: (r["cursor"] as string | null) ?? null,
    page: Number(r["page"] ?? 0),
    nodes_so_far: Number(r["nodes_so_far"] ?? 0),
    total_count: Number(r["total_count"] ?? 0),
    part_refs_json: (r["part_refs_json"] as string | null) ?? null,
    params_json: (r["params_json"] as string | null) ?? null,
    error: normError(r["error"]),
    started_at: String(r["started_at"] ?? ""),
    updated_at: String(r["updated_at"] ?? ""),
  }));
}

export function getJob(jobId: string): JobRow | null {
  return listJobs().find((j) => j.job_id === jobId) ?? null;
}

const TERMINAL: JobPhase[] = ["DONE", "FAILED", "CANCELLED"];

/** The single in-flight job, or null (jobs are single-flight). */
export function activeJob(): JobRow | null {
  return listJobs().find((j) => !TERMINAL.includes(j.phase)) ?? null;
}
