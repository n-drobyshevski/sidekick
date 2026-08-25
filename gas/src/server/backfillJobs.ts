// History backfill: a resumable maintenance job that recovers signals the ledger did not yet
// store when a lifecycle was recorded, by replaying the scan archives in Drive.
//
// TWO SIGNALS, ONE WALK. Reading an archive is the expensive part; merging a second field out
// of a record already in memory is free, and a second job would only contend for the same
// single-flight slot and block the daily scan.
//
//   * EXPLOIT INTELLIGENCE (has_kev / has_exploit / epss). Coverage and efficiency need to know
//     whether a REMEDIATED finding was high risk, and a finding resolved by disappearance is
//     gone from the current scan frame entirely. Without this every pre-existing lifecycle
//     reads as unclassified and both rates describe only the newest slice of the register.
//   * ATTRIBUTION (tags_json). The `Wiz/Domain` tag lives in the bag, and a row without one
//     resolves to `Not attributable` — a bucket no operator action can close. Episodes
//     compacted before `EpisodeRow` carried the column, and every legacy imported bundle,
//     landed there. Settings → *Domain-tag backfill* recovers the first population from one
//     checkpoint read; only this walk reaches the second, which was never in a GAS checkpoint.
//
// Two phases, because the cheap one is worth having on its own:
//   0. the current frame — one pass over the latest scan's slim records, which fills every
//      finding still present today. No continuation needed.
//   1. the archive walk — every saved flat scan, NEWEST FIRST, which is what recovers the
//      resolved history.
//
// Newest-first is safe (and deliberate) because domain/reconcile.mergeRiskSignals is
// order-independent: booleans OR together, EPSS keeps its max, the witness date keeps its
// min. So an abandoned run has still done the most valuable part, a crashed hop needs no
// rollback, and re-running from scratch converges on identical state.
//
// What it cannot recover, and reports honestly: scans already sealed by compaction (their
// archives were pruned), scans whose Drive folder has gone, and lifecycles whose every
// surviving archive predates the signal being captured at all.

import {
  backfillRiskFromRecords,
  backfillTagsFromRecords,
  countUnattributable,
  countUnknownRisk,
  emptyBackfillResult,
  recordsFromPayload,
  type BackfillResult,
} from "../domain/maintenance";
import { scansAsc, type ScanRow } from "../domain/ledgerCore";
import type { Rec } from "../domain/util";
import * as archive from "./archiveStore";
import * as errorLog from "./errorLog";
import * as findings from "./findings";
import {
  activeJob,
  clearTriggers,
  createJob,
  getJob,
  isStaleJob,
  lastJobOfKind,
  newJobId,
  reclaimIfStale,
  updateJob,
  type JobRow,
} from "./jobsStore";
import * as ledgerStore from "./ledgerStore";
import { withScriptLock } from "./locks";

// 4.5 minutes of the 6-minute execution cap, matching scanJobs.BUDGET_MS.
const BUDGET_MS = 270_000;
// The first hop runs inside the operator's RPC, so keep it short and hand off to the trigger.
const FIRST_STEP_BUDGET_MS = 45_000;
const CONTINUE_DELAY_MS = 1_000;

// Its OWN handler name. Sharing scanJobs' CONTINUE_HANDLER would mean each job's
// clearContinuationTriggers() deletes the other's pending hop, silently stranding whichever
// ran second.
const CONTINUE_HANDLER = "trigger_continueBackfill";

function scheduleContinuation(): void {
  ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(CONTINUE_DELAY_MS).create();
}

function clearContinuationTriggers(): void {
  clearTriggers(CONTINUE_HANDLER);
}

function readResult(job: JobRow): BackfillResult {
  try {
    return { ...emptyBackfillResult(), ...(JSON.parse(job.params_json ?? "{}") as object) };
  } catch {
    return emptyBackfillResult();
  }
}

/** A scan's records for the merge: slim set first (cheapest and already carries the signals),
 *  then the frame, then the raw pages. Null when nothing readable survives. */
function recordsForScan(row: ScanRow): Rec[] | null {
  const slim = archive.readSlimRecords(row.scan_id) as Rec[] | null;
  if (slim && slim.length) return slim;
  const frame = archive.readFrame(row.scan_id) as Rec[] | null;
  if (frame && frame.length) return frame;
  const payload = archive.readScanPayload(row.raw_ref);
  if (payload === null) return null;
  const nodes = recordsFromPayload(payload);
  return nodes.length ? nodes : null;
}

/** Flat, unsealed scans newest first — the replay order. */
function replayOrder(scans: ScanRow[]): ScanRow[] {
  return scansAsc(scans).filter((s) => s.shape === "flat").reverse();
}

export interface BackfillStatus {
  jobId: string;
  phase: string;
  scansTotal: number;
  scansDone: number;
  result: BackfillResult;
  error: string | null;
  updatedAt: string;
  /** Running, but silent long enough to be presumed dead — see jobsStore.isStaleJob. */
  stale: boolean;
}

/** Start (or adopt) the backfill job. Single-flight like every other ledger mutation. */
export function startBackfill(): BackfillStatus {
  return withScriptLock(() => {
    const existing = activeJob();
    if (existing) {
      // A stalled job must never be adopted. Jobs are single-flight across kinds, so a
      // backfill whose continuation stopped firing (trigger quota exhausted, execution
      // killed, a deployment pushed without trigger_continueBackfill) would otherwise sit in
      // BACKFILLING forever — blocking the daily scan, and turning every press of this button
      // into a re-report of the same frozen numbers. Reclaim it and start fresh instead.
      if (!reclaimIfStale(existing)) {
        if (existing.kind !== "backfill") {
          throw new Error(
            `Another job (${existing.kind}) is running. Wait for it to finish, then retry.`,
          );
        }
        return statusOf(existing);
      }
    }
    clearContinuationTriggers();
    const scans = replayOrder(ledgerStore.loadScanRows());
    const job = createJob({
      job_id: newJobId("backfill"),
      kind: "backfill",
      phase: "BACKFILLING",
      scan_id: null,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: scans.length,
      params_json: JSON.stringify(emptyBackfillResult()),
      journal_ref: null,
      error: null,
    });
    step(job, FIRST_STEP_BUDGET_MS);
    return statusOf(getJob(job.job_id) ?? job);
  }, 120_000);
}

/**
 * One hop: seed from the current frame (first hop only), then replay archived scans until the
 * budget runs out. Writes the merged state once per hop — journaled like every other ledger
 * mutation, because writeStateTables is three sheet writes plus a snapshot and that sequence
 * is not atomic.
 */
function step(job: JobRow, budgetMs = BUDGET_MS): void {
  const t0 = Date.now();
  const state = ledgerStore.loadState();
  const scans = replayOrder(state.scans);
  const result = readResult(job);
  let done = job.page;
  let dirty = false;

  // Journal the PRE-merge state, before anything below mutates it. loadState() is memoized
  // per execution and the merges below are in place, so taking the journal after them would
  // capture the mutated state and roll back to nothing. Ordering matches persistFlatScan.
  const journalRef = archive.writeJournal(job.job_id, state);
  updateJob(job.job_id, { journal_ref: journalRef });

  // Phase 0: the current frame. Cheapest possible win — it fills every finding still present
  // in the latest scan without touching Drive archives at all.
  if (done === 0) {
    try {
      const scan = findings.currentScan();
      if (scan) {
        backfillRiskFromRecords(state, scan.records as Rec[], scan.ts, result);
        backfillTagsFromRecords(state, scan.records as Rec[], result);
        dirty = true;
      }
    } catch (e) {
      console.warn(`Backfill frame seed failed: ${e}`);
      errorLog.recordError("backfillFrame", e);
    }
  }

  // Phase 1: the archive walk.
  while (done < scans.length && Date.now() - t0 < budgetMs) {
    const row = scans[done];
    done += 1;
    if (row.sealed) {
      // Compaction pruned this scan's archive; nothing to replay.
      result.scansSealed += 1;
      continue;
    }
    let records: Rec[] | null = null;
    try {
      records = recordsForScan(row);
    } catch (e) {
      console.warn(`Backfill could not read scan ${row.scan_id}: ${e}`);
    }
    if (records === null) {
      result.scansUnreadable += 1;
      continue;
    }
    backfillRiskFromRecords(state, records, row.ts, result);
    backfillTagsFromRecords(state, records, result);
    result.scansReplayed += 1;
    dirty = true;
  }

  if (dirty) ledgerStore.writeStateTables(state);
  archive.trashFile(journalRef);
  result.stillUnknown = countUnknownRisk(state);
  result.stillUnattributable = countUnattributable(state);
  updateJob(job.job_id, {
    page: done,
    findings_so_far: result.ledgerRowsTouched + result.episodeRowsTouched,
    params_json: JSON.stringify(result),
    journal_ref: null,
    phase: done >= scans.length ? "DONE" : "BACKFILLING",
  });
  if (done < scans.length) scheduleContinuation();
  else clearContinuationTriggers();
}

/** Trigger target: resume the active backfill. */
export function continueBackfill(_e?: unknown): void {
  withScriptLock(() => {
    clearContinuationTriggers();
    const job = activeJob();
    if (!job || job.kind !== "backfill" || job.phase !== "BACKFILLING") return;
    try {
      step(job);
    } catch (e) {
      // The merge is monotone, so a failed hop leaves valid (merely incomplete) state — fail
      // the job rather than looping, and let the operator restart it.
      console.warn(`Backfill hop failed: ${e}`);
      errorLog.recordError("backfillHop", e);
      updateJob(job.job_id, { phase: "FAILED", error: String((e as Error).message ?? e) });
    }
  }, 120_000);
}

function statusOf(job: JobRow): BackfillStatus {
  return {
    jobId: job.job_id,
    phase: job.phase,
    // 0 means "not recorded", not "no scans" — a deployment whose jobs tab predates the
    // total_count column drops the write (jobsStore.createJob now heals that, but rows
    // written before the fix keep their blank). The UI must render this as an unknown total
    // rather than inventing a denominator.
    scansTotal: job.total_count,
    scansDone: job.page,
    result: readResult(job),
    error: job.error,
    updatedAt: job.updated_at,
    stale: job.phase === "BACKFILLING" && isStaleJob(job),
  };
}

/** Current backfill state for the Settings panel — the active job, else the most recent. */
export function backfillStatus(): BackfillStatus | null {
  const active = activeJob();
  if (active && active.kind === "backfill") return statusOf(active);
  const last = lastJobOfKind("backfill");
  return last ? statusOf(last) : null;
}
