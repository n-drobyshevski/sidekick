// Script-wide write serialization + crash cleanup.
//
// Every mutating entry point runs inside withScriptLock(), and recoverIfNeeded() runs at the
// top of each.
//
// THERE IS A JOURNAL, and this comment used to say there was not. The persist is not atomic:
// a sync rewrites the ledger tab wholesale and only then appends its `scans` rows, so a job
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
// STEPS 1, 2 AND 4 ARE WIRED. The PHASE NOTE that stood here (`journal_ref` is null on every
// row, the reap below is the whole of recovery) is history: `ledgerStore.persistSync` writes
// the journal and `recoverIfNeeded` below rolls back from it.
//
// HOW A DEAD PERSIST IS TOLD FROM A COMMITTED ONE: `ledgerStore.syncCommitted(job.scan_id)`.
// The commit is ONE append of every scope's row, so one `scans` row carrying the sync's id
// prefix proves the whole of it landed. A maintenance write (delete / compact) carries a null
// `scan_id` and so is never read as committed — correct, because its commit is a wholesale
// rewrite with no append to mark it, and re-running the restore over an already-finished one
// costs a rewrite rather than a wrong answer.
//
// THE IMPORT DIRECTION IS ONE-WAY AND MUST STAY THAT WAY. locks -> ledgerStore -> jobsStore is
// acyclic; `ledgerStore` imports `jobsStore` and `archiveStore` and must NEVER import this
// file, or the graph closes and the module that loads first sees half a partner.

import { activeJob, isStaleJob, updateJob } from "./jobsStore";
import { readBackup, trashBackup } from "./archiveStore";
import { invalidateLedgerMemos, syncCommitted, writeStateTables } from "./ledgerStore";

export class LedgerBusyError extends Error {}

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
 * Reap a job left non-terminal by a crashed execution, restoring the ledger when that job died
 * mid-rewrite. Call at the top of every write entry point, inside the script lock.
 *
 * THE STALENESS RULE IS `jobsStore.isStaleJob`, AND THE SECOND CONSTANT IS GONE. This file
 * used to declare its own `DEAD_JOB_MS = 30 * 60 * 1000` — the same 30 minutes, and the two
 * disagreed on one row: a job whose `updated_at` will not parse read as infinitely old here
 * (dead) and as live there. Settled in jobsStore's favour, treating an unparseable timestamp
 * as LIVE, on jobsStore's own argument — "reclaiming on a guess destroys the record that a job
 * was running at all" — and on the measurement that the choice cannot reach the destructive
 * path: the PERSISTING branch below is entered on PHASE ALONE and never consults the clock, so
 * the rollback is unaffected either way. What the rule actually governs is the age reap of a
 * FETCHING / RECONCILING job, which only marks a row FAILED. A wedged job with an unreadable
 * timestamp is visible (the register says a sync is running) and a human can end it; a live
 * fetch killed on a guess is neither.
 */
export function recoverIfNeeded(now?: number): void {
  const job = activeJob();
  if (!job) return;

  if (job.phase === "PERSISTING") {
    if (!job.journal_ref) {
      // Nothing was rewritten — the death landed before step 1, so the last committed state
      // is on disk untouched. Same answer this function has always given.
      updateJob(job.job_id, {
        phase: "FAILED",
        error: "Recovered: execution died mid-sync; the last committed snapshot is unchanged.",
      });
      return;
    }
    if (syncCommitted(job.scan_id)) {
      // The `scans` rows are on disk, so the rewrite they claim is real. Do NOT roll back —
      // restoring the journal here would delete a committed observation. The journal is spent;
      // the caches are not, because step 7 never ran.
      updateJob(job.job_id, {
        phase: "FAILED",
        journal_ref: null,
        error:
          "Recovered: execution died after the commit landed; the scan is saved and the "
          + "journal was discarded.",
      });
      trashBackup(job.job_id);
      invalidateLedgerMemos();
      return;
    }
    // Died between the rewrite and the commit: the ledger on disk is provisional. Restore.
    const backup = readBackup(job.job_id);
    if (backup) {
      writeStateTables(backup);
      updateJob(job.job_id, {
        phase: "FAILED",
        journal_ref: null,
        error:
          "Recovered: execution died mid-rewrite; the ledger was RESTORED from the journal "
          + "and the scan was not saved.",
      });
      trashBackup(job.job_id);
      return;
    }
    // A journal ref with no readable journal behind it. Leaving the tabs alone is the only
    // safe move, and saying so is the point — a silent FAILED here would read like the
    // untouched-snapshot case above, which it is not.
    updateJob(job.job_id, {
      phase: "FAILED",
      journal_ref: null,
      error:
        "Recovered: execution died mid-rewrite and the journal could not be read, so the "
        + "ledger was left as written. Re-run the sync to reconcile it.",
    });
    return;
  }

  // FETCHING / RECONCILING: give the continuation trigger its time, then reap.
  if (isStaleJob(job, now)) {
    updateJob(job.job_id, {
      phase: "FAILED",
      error: "Recovered: execution died mid-sync; the last committed snapshot is unchanged.",
    });
  }
}
