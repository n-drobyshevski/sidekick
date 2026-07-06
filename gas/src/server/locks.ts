// Script-wide write serialization + crash recovery.
//
// Every mutating entry point runs inside withScriptLock(). recoverIfNeeded() runs at
// the top of each: a job stuck in PERSISTING/REPLAYING whose journal still exists and
// whose scans row never landed means the process died mid-write — restore the ledger
// tabs from the journal (the commit-record rule: no scans row, no scan).

import { readJournal, trashFile } from "./archiveStore";
import { activeJob, updateJob } from "./jobsStore";
import { writeStateTables, scanRowExists } from "./ledgerStore";

export class LedgerBusyError extends Error {}

export function withScriptLock<T>(fn: () => T, timeoutMs = 30_000): T {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs)) {
    throw new LedgerBusyError(
      "The ledger is busy (a scan or maintenance job is writing). Try again shortly.",
    );
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Roll back a half-written mutation left by a crashed execution. Call at the top of
 * every write entry point, inside the script lock.
 */
export function recoverIfNeeded(): void {
  const job = activeJob();
  if (!job) return;
  if (job.phase !== "PERSISTING" && job.phase !== "REPLAYING") return;
  // FETCHING/RECONCILING never mutate the tabs; continuation handles them. A stale
  // PERSISTING/REPLAYING row with no continuation trigger means a mid-write crash.
  if (job.phase === "PERSISTING" && job.scan_id && scanRowExists(job.scan_id)) {
    // The commit record landed — the write actually completed; close the job.
    updateJob(job.job_id, { phase: "DONE" });
    trashFile(job.journal_ref);
    return;
  }
  const journal = readJournal(job.journal_ref);
  if (journal) {
    writeStateTables(journal);
    updateJob(job.job_id, {
      phase: "FAILED",
      error: "Recovered: execution died mid-write; ledger restored from journal.",
    });
    trashFile(job.journal_ref);
  } else {
    updateJob(job.job_id, {
      phase: "FAILED",
      error: "Execution died mid-write and no journal was found; run a fresh scan.",
    });
  }
}
