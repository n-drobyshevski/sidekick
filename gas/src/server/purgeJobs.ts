// Severity purge: a resumable maintenance job that removes every trace of one or more
// severities from the register — the two ledger tabs, every compaction checkpoint, and the
// Drive scan archives.
//
// Why the archive walk exists at all: the ledger is DERIVED state. `deleteScansCore`
// (domain/maintenance.ts:170) rebuilds `vuln_ledger` from the checkpoint plus a replay of the
// surviving `scans/<id>/page-*.json.gz` archives. So a purge that stops at the tabs is undone
// the first time an operator deletes a scan from Scan History — the rows come back, silently,
// long after the operator watched the count drop. Rewriting the archives is what makes the
// deletion mean what it says.
//
// Two phases, because the cheap one is worth having on its own:
//   0. tabs + checkpoints, inside the operator's own RPC. The cells come back immediately;
//      every page the app renders is already correct after this hop.
//   1. the archive walk, NEWEST FIRST, resumable across the 6-minute execution cap.
//
// Newest-first, like the risk backfill, because the purge is idempotent — filtering a payload
// that no longer contains the severity is a no-op — so an abandoned run has still done the
// most recently-replayed archives, a crashed hop needs no rollback, and re-running from
// scratch converges on the same state.
//
// What it cannot reach, and reports rather than glossing: scans already sealed by compaction.
// Their archives were pruned, so their contribution survives only inside the checkpoint — and
// that IS purged, so a rebuild stays clean; the sealed count is reported because those scans
// can no longer be re-derived from anything.

import { archiveWalkOrder, purgePayloadBySeverity, purgeRecordsBySeverity } from "../domain/purge";
import type { ScanRow } from "../domain/ledgerCore";
import type { Rec } from "../domain/util";
import * as archive from "./archiveStore";
import * as errorLog from "./errorLog";
import {
  activeJob,
  clearTriggers,
  createJob,
  getJob,
  isStaleJob,
  isTerminalPhase,
  lastJobOfKind,
  newJobId,
  reclaimIfStale,
  updateJob,
  type JobRow,
} from "./jobsStore";
import * as ledgerStore from "./ledgerStore";
import { withScriptLock } from "./locks";
import * as settingsStore from "./settingsStore";
import { cellUsage } from "./sheetsDb";

// 4.5 minutes of the 6-minute execution cap, matching scanJobs.BUDGET_MS.
const BUDGET_MS = 270_000;
// The first hop runs inside the operator's RPC, so keep it short and hand off to the trigger.
const FIRST_STEP_BUDGET_MS = 45_000;
const CONTINUE_DELAY_MS = 1_000;

// Its OWN handler name — see the same note in backfillJobs.ts. Sharing one would mean each
// job's clearContinuationTriggers() deletes the other's pending hop.
const CONTINUE_HANDLER = "trigger_continuePurge";

function scheduleContinuation(): void {
  ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(CONTINUE_DELAY_MS).create();
}

function clearContinuationTriggers(): void {
  clearTriggers(CONTINUE_HANDLER);
}

export interface PurgeResult {
  severities: string[];
  scopeNarrowed: boolean;
  /** Phase 0. */
  ledgerRemoved: number;
  episodeRemoved: number;
  checkpointRemoved: number;
  /** Scan rows whose recorded severity scope was narrowed — see domain/purge.narrowScanScope. */
  scopesNarrowed: number;
  /** Phase 1. */
  scansRewritten: number;
  recordsRemoved: number;
  scansSealed: number;
  scansUnreadable: number;
  /** Measured, not projected: cellUsage() before phase 0 and after the last hop. */
  cellsBefore: number;
  cellsAfter: number;
}

export function emptyPurgeResult(): PurgeResult {
  return {
    severities: [],
    scopeNarrowed: false,
    ledgerRemoved: 0,
    episodeRemoved: 0,
    checkpointRemoved: 0,
    scopesNarrowed: 0,
    scansRewritten: 0,
    recordsRemoved: 0,
    scansSealed: 0,
    scansUnreadable: 0,
    cellsBefore: 0,
    cellsAfter: 0,
  };
}

function readResult(job: JobRow): PurgeResult {
  try {
    return { ...emptyPurgeResult(), ...(JSON.parse(job.params_json ?? "{}") as object) };
  } catch {
    return emptyPurgeResult();
  }
}

/** Best-effort cell count; a failure here must never abort a purge. */
function cellsNow(): number {
  try {
    return cellUsage().total;
  } catch (e) {
    console.warn(`Purge cell measurement skipped: ${e}`);
    return 0;
  }
}

/**
 * Rewrite one scan's archived artifacts without the purged severities.
 *
 * Page files are rewritten under their own names, and `writeGzJson` trashes the same-named
 * file before creating the replacement (archiveStore.ts:58-61), so re-running a hop over a
 * scan already done costs a read and a no-op write rather than corrupting anything.
 */
function purgeScanArchives(
  row: ScanRow,
  severities: readonly string[],
): { removed: number; touched: boolean; readable: boolean } {
  let removed = 0;
  let touched = false;
  let readable = false;

  for (const pageNo of archive.listScanPageNumbers(row.raw_ref)) {
    const page = archive.readScanPage(row.scan_id, pageNo);
    if (page === null) continue;
    readable = true;
    const out = purgePayloadBySeverity(page, severities);
    if (!out.recognized || !out.removed) continue;
    archive.writeScanPage(row.scan_id, pageNo, out.payload);
    removed += out.removed;
    touched = true;
  }

  // The slim spill is LOAD-BEARING, not a cache — and it is the fastest resurrection path of
  // the lot, needing no scan deletion at all. `finishScan`'s incremental branch reads the
  // baseline scan's slim records, merges the delta into them, and writes the result as both
  // the new scan's pages and the payload handed to persistFlatScan (scanJobs.ts:488-504). So
  // one Quick refresh over an un-purged baseline re-materialises every purged finding as a
  // brand-new OPEN lifecycle.
  const slim = archive.readSlimRecords(row.scan_id) as Rec[] | null;
  if (slim) {
    readable = true;
    const out = purgeRecordsBySeverity(slim, severities);
    if (out.removed) {
      archive.writeSlimRecords(row.scan_id, out.records);
      touched = true;
    }
  }
  // The frame is a read-model cache, but the most visible one: findings.currentScan drives the
  // bootstrap counts, the findings table, insights, the report and the CSV export.
  const frame = archive.readFrame(row.scan_id) as Rec[] | null;
  if (frame) {
    const out = purgeRecordsBySeverity(frame, severities);
    if (out.removed) {
      archive.writeFrame(row.scan_id, out.records);
      touched = true;
    }
  }

  // Observations are regenerated wholesale by any replay, so filtering them is cosmetic for
  // correctness but real for the Drive footprint and for previousSeverityCounts().
  if (row.obs_ref) {
    const obs = archive.readObservations(row.obs_ref) as unknown as Rec[];
    if (obs.length) {
      const out = purgeRecordsBySeverity(obs, severities);
      if (out.removed) {
        // The rewrite lands under a new Drive id, so the scan row has to be repointed or
        // `obs_ref` dangles at a trashed file.
        const ref = archive.writeObservations(row.scan_id, out.records as never);
        ledgerStore.setScanObsRef(row.scan_id, ref);
        touched = true;
      }
    }
  }

  // Page runs map slim-record index → source page number. A purge shrinks pages, so the
  // stored counts stop lining up and `_page` attribution drifts. It carries no replay role,
  // and readPageRuns returning null is already a supported state (scanJobs.ts:506), so drop
  // it rather than trying to keep a derived index in step with two independent rewrites.
  if (touched) archive.trashPageRuns(row.scan_id);

  return { removed, touched, readable };
}

export interface PurgeStatus {
  jobId: string;
  phase: string;
  scansTotal: number;
  scansDone: number;
  result: PurgeResult;
  error: string | null;
  updatedAt: string;
  /** Running, but silent long enough to be presumed dead — see jobsStore.isStaleJob. */
  stale: boolean;
}

/** Start a severity purge. Single-flight like every other ledger mutation. */
export function startSeverityPurge(
  severities: string[],
  alsoNarrowScope: boolean,
): PurgeStatus {
  return withScriptLock(() => {
    if (!severities.length) throw new Error("Pick at least one severity to purge.");

    const existing = activeJob();
    if (existing && !reclaimIfStale(existing)) {
      throw new Error(
        `Another job (${existing.kind}) is running. Wait for it to finish, then retry.`,
      );
    }
    clearContinuationTriggers();

    const result = emptyPurgeResult();
    result.severities = [...severities];
    result.cellsBefore = cellsNow();

    const jobId = newJobId("purge");
    const scans = archiveWalkOrder(ledgerStore.loadScanRows());

    // The job row is created BEFORE phase 0 writes anything. purgeSeverityTabs journals under
    // phase PERSISTING, and recoverIfNeeded only looks at the ACTIVE job (locks.ts:33-36) — so
    // without a row already on the tab, an execution killed mid-rewrite would leave a
    // half-written ledger and a journal nothing points at.
    const job = createJob({
      job_id: jobId,
      kind: "purge",
      phase: "PURGING",
      scan_id: null,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: scans.length,
      params_json: JSON.stringify(result),
      journal_ref: null,
      error: null,
    });

    try {
      // Phase 0, inside the operator's own request: the two tabs, every checkpoint, and each
      // scan row's recorded severity scope.
      const tabs = ledgerStore.purgeSeverityTabs(severities, jobId);
      result.ledgerRemoved = tabs.ledgerRemoved;
      result.episodeRemoved = tabs.episodeRemoved;
      result.checkpointRemoved = tabs.checkpointRemoved;
      result.scopesNarrowed = tabs.scopesNarrowed;

      // Narrowing the scan scope is what stops tomorrow's scan re-ingesting what was just
      // deleted. Same locked write, so the two can't half-apply. Note this covers the FULL
      // scan only — a Quick refresh rides the baseline scan row's stored scope rather than
      // settings (scanJobs.ts:335-336), which is what purgeStateBySeverity's scope narrowing
      // above handles.
      if (alsoNarrowScope) {
        const purged = new Set(severities);
        const remaining = settingsStore.getFetchSeverities().filter((s) => !purged.has(s));
        // withFetchSeverities falls back to the defaults on an empty list, which would
        // silently re-enable CRITICAL/HIGH. Purging everything you scan for is a scope
        // question, not a cleanup one — leave the setting alone and report that.
        if (remaining.length) {
          settingsStore.setFetchSeverities(remaining);
          result.scopeNarrowed = true;
        }
      }
    } catch (e) {
      updateJob(jobId, { phase: "FAILED", error: String((e as Error).message ?? e) });
      throw e;
    }

    updateJob(jobId, { params_json: JSON.stringify(result) });
    step({ ...job, params_json: JSON.stringify(result) }, FIRST_STEP_BUDGET_MS);
    return statusOf(getJob(jobId) ?? job);
  }, 120_000);
}

/**
 * One hop of the archive walk. No journal: this phase touches Drive artifacts only — the
 * ledger tabs were settled in phase 0 — so there is no half-written sheet state to roll back,
 * and the rewrite is idempotent per page.
 */
function step(job: JobRow, budgetMs = BUDGET_MS): void {
  const t0 = Date.now();
  const result = readResult(job);
  const severities = result.severities;
  const scans = archiveWalkOrder(ledgerStore.loadScanRows());
  let done = job.page;

  while (done < scans.length && Date.now() - t0 < budgetMs) {
    const row = scans[done];
    done += 1;
    if (row.sealed) {
      result.scansSealed += 1;
      continue;
    }
    try {
      const out = purgeScanArchives(row, severities);
      if (!out.readable) {
        result.scansUnreadable += 1;
        continue;
      }
      result.recordsRemoved += out.removed;
      result.scansRewritten += 1;
    } catch (e) {
      console.warn(`Purge could not rewrite scan ${row.scan_id}: ${e}`);
      result.scansUnreadable += 1;
    }
  }

  const finished = done >= scans.length;
  if (finished) result.cellsAfter = cellsNow();
  updateJob(job.job_id, {
    page: done,
    findings_so_far: result.ledgerRemoved + result.episodeRemoved + result.recordsRemoved,
    params_json: JSON.stringify(result),
    phase: finished ? "DONE" : "PURGING",
  });
  if (finished) clearContinuationTriggers();
  else scheduleContinuation();
}

/** Trigger target: resume the active purge. */
export function continuePurge(_e?: unknown): void {
  withScriptLock(() => {
    clearContinuationTriggers();
    const job = activeJob();
    if (!job || job.kind !== "purge" || job.phase !== "PURGING") return;
    try {
      step(job);
    } catch (e) {
      // The rewrite is idempotent, so a failed hop leaves valid (merely incomplete) archives —
      // fail the job rather than looping, and let the operator restart it.
      console.warn(`Purge hop failed: ${e}`);
      errorLog.recordError("purgeHop", e);
      updateJob(job.job_id, { phase: "FAILED", error: String((e as Error).message ?? e) });
    }
  }, 120_000);
}

function statusOf(job: JobRow): PurgeStatus {
  return {
    jobId: job.job_id,
    phase: job.phase,
    // 0 means "not recorded", not "no scans" — the UI must not print it as a denominator.
    scansTotal: job.total_count,
    scansDone: job.page,
    result: readResult(job),
    error: job.error,
    updatedAt: job.updated_at,
    stale: job.phase === "PURGING" && isStaleJob(job),
  };
}

/**
 * The in-flight purge, if any — the guard `api.assertNoActivePurge` is built on.
 *
 * Lives here rather than as an inline `activeJob()` test in api.ts so the callers that must
 * refuse during a purge share one definition with the job that creates it, and so it can be
 * tested without api.ts's whole dependency graph.
 */
export function activePurgeJob(): JobRow | null {
  const job = activeJob();
  return job && job.kind === "purge" && !isTerminalPhase(job.phase) ? job : null;
}

/** Current purge state for the Maintenance panel — the active job, else the most recent. */
export function purgeStatus(): PurgeStatus | null {
  const active = activeJob();
  if (active && active.kind === "purge") return statusOf(active);
  const last = lastJobOfKind("purge");
  return last ? statusOf(last) : null;
}
