// Script-wide write serialization + crash cleanup.
//
// Every mutating entry point runs inside withScriptLock(), and recoverIfNeeded() runs at the
// top of each.
//
// THERE IS A JOURNAL, and this comment used to say there was not. The persist is not atomic:
// a sync rewrites the ledger tab wholesale and only then appends its `scans` row, so a job
// that dies between the two leaves a rewritten ledger with no scan claiming it — rows dated
// by an observation the register has no record of making. The contract that closes the gap:
//
//   1. `ledgerStore` writes the pre-rewrite state to Drive and puts its file id in
//      `journal_ref` on the job row (jobsStore.JobRow) BEFORE touching the ledger tab.
//   2. The wholesale rewrite happens.
//   3. THE COMMIT IS THE FINAL APPEND OF THE `scans` ROWS. That append is what makes the
//      rewrite real; until it lands, the ledger on disk is provisional.
//   4. recoverIfNeeded() rolls back from `journal_ref` when it finds a job that died between
//      2 and 3, and clears the journal once the commit is on disk.
//
// Under that contract a dead job is not simply marked FAILED: the previous committed state
// stays authoritative because it is RESTORED, not merely left alone. The tab is `scans` —
// the name `sync_history` in the sentence this replaces was never a tab in this register.
//
// PHASE NOTE: steps 1, 2 and 4's rollback arm land with `ledgerStore` in Phase 2. Nothing
// writes a journal today, so `journal_ref` is null on every row and the reap below is the
// whole of recovery — which is correct while there is no half-written rewrite to undo, and
// wrong the moment there is.

import { activeJob, updateJob } from "./jobsStore";
import { parseTs } from "../domain/util";

export class LedgerBusyError extends Error {}

/**
 * A job whose last heartbeat is older than this is considered dead.
 *
 * The same 30 minutes as `jobsStore.STALE_JOB_MS`, in a second constant, and the two DO NOT
 * agree on one row: an unparseable `updated_at` reads as infinitely old here (dead) and as
 * live there. Unreconciled rather than reasoned — recorded so whoever wires the rollback arm
 * picks one answer on purpose instead of inheriting two by accident.
 */
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
