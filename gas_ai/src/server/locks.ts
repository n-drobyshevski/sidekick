// Script-wide write serialization + crash cleanup.
//
// Every mutating entry point runs inside withScriptLock(). recoverIfNeeded() runs at
// the top of each: unlike the OS-vulns ledger there is no journal to roll back — a
// sync persists by wholesale tab rewrite and its sync_history row lands LAST (the
// commit record), so a job stuck in a non-terminal phase with no continuation simply
// gets marked FAILED and the previous committed snapshot stays authoritative.

import { activeJob, updateJob } from "./jobsStore";
import { parseTs } from "../domain/util";

export class LedgerBusyError extends Error {}

/** A job whose last heartbeat is older than this is considered dead. */
const DEAD_JOB_MS = 30 * 60 * 1000;

export function withScriptLock<T>(fn: () => T, timeoutMs = 30_000): T {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs)) {
    throw new LedgerBusyError(
      "The data store is busy (a sync is writing). Try again shortly.",
    );
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reap a job left non-terminal by a crashed execution. Call at the top of every
 * write entry point, inside the script lock. FETCHING/RECONCILING jobs are given
 * time for their continuation trigger; anything silent past DEAD_JOB_MS is dead.
 */
export function recoverIfNeeded(now?: number): void {
  const job = activeJob();
  if (!job) return;
  const updated = parseTs(job.updated_at);
  const ageMs = updated === null ? Infinity : (now ?? Date.now()) - updated;
  if (job.phase === "PERSISTING" || ageMs > DEAD_JOB_MS) {
    updateJob(job.job_id, {
      phase: "FAILED",
      error: "Recovered: execution died mid-sync; the last committed snapshot is unchanged.",
    });
  }
}
