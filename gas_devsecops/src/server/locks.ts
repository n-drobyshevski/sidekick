// Script-wide write serialization + crash cleanup.
//
// Every mutating entry point runs inside withScriptLock(), and calls recoverIfNeeded() at the
// top of it.
//
// WHAT RECOVERY HAS TO UNDO, and it is not nothing. A scan commits by `runScan`, which does
// `writeLedger` and then `appendScan` — and `writeLedger` is `overwrite`, a `clearContent()`
// followed by a `setValues()`. So an execution killed inside the commit lands in one of three
// places, and two of them are damage:
//
//   * between clear and write   -> an EMPTY ledger tab;
//   * between write and append  -> a ledger carrying resolutions no scan row vouches for,
//                                  which is exactly the failure the battery's commit-last
//                                  rule exists to prevent, arriving through the back door;
//   * after append              -> nothing wrong; the commit completed.
//
// So the battery writes the ledger to Drive immediately before the commit and puts the file id
// in `jobs.journal_ref`. A job found in PERSISTING is judged by whether its scan row landed: if
// it did, the write finished and the job is simply closed; if it did not, the ledger is
// restored from the journal before the job is failed. This file used to say "there is no
// journal to roll back", which was honest about the job and silent about the ledger.

import { activeJob, updateJob } from "./jobsStore";
import { readGzJsonFile, trashFile } from "./archiveStore";
import { readScans, writeLedger } from "./ledgerStore";
import { parseTs } from "../domain/util";

export class LedgerBusyError extends Error {}

/** A job whose last heartbeat is older than this is considered dead. */
const DEAD_JOB_MS = 30 * 60 * 1000;

export function withScriptLock<T>(fn: () => T, timeoutMs = 30_000): T {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs)) {
    throw new LedgerBusyError(
      "The data store is busy (a scan is writing). Try again shortly.",
    );
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reap a job left non-terminal by a crashed execution, restoring the ledger if the crash
 * landed mid-commit. Call at the top of every write entry point, inside the script lock.
 *
 * FETCHING and RECONCILING mutate nothing — they stage pages to Drive — so they are given
 * time for their continuation trigger and only reaped once they have been silent past
 * DEAD_JOB_MS. PERSISTING is judged immediately: reaching here means no execution is running
 * (the caller holds the lock a live hop would be holding), so a job still in PERSISTING was
 * killed in the middle of the one window that can damage the ledger.
 */
export function recoverIfNeeded(now?: number): void {
  const job = activeJob();
  if (!job) return;
  const updated = parseTs(job.updated_at);
  const ageMs = updated === null ? Infinity : (now ?? Date.now()) - updated;

  if (job.phase === "PERSISTING") {
    // The scan row is the commit record. Its presence settles what happened.
    const committed = job.scan_id !== null
      && readScans().some((s) => s.scan_id === job.scan_id);
    if (committed) {
      updateJob(job.job_id, { phase: "DONE", journal_ref: null });
      if (job.journal_ref) trashFile(job.journal_ref);
      return;
    }
    const restored = job.journal_ref ? restoreLedger(job.journal_ref) : false;
    updateJob(job.job_id, {
      phase: "FAILED",
      journal_ref: null,
      error: restored
        ? "Recovered: the execution died mid-write; the ledger was restored from its journal "
          + "and no scan was recorded."
        : "The execution died mid-write and no journal was found. The ledger may be "
          + "incomplete — run a fresh scan before trusting its figures.",
    });
    return;
  }

  if (ageMs > DEAD_JOB_MS) {
    updateJob(job.job_id, {
      phase: "FAILED",
      error: "Recovered: the job stalled with no progress. Nothing was written — the last "
        + "committed scan stands.",
    });
  }
}

/** Put the pre-commit ledger back. Returns whether it actually managed to. */
function restoreLedger(journalRef: string): boolean {
  const doc = readGzJsonFile(journalRef);
  if (!doc || typeof doc !== "object") return false;
  writeLedger(doc as Parameters<typeof writeLedger>[0]);
  trashFile(journalRef);
  return true;
}
