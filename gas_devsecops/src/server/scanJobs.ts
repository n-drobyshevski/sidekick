// The scan battery: one job, one scope per step, resumed across executions.
//
// THE WHOLE FILE TURNS ON ONE RULE. The `scans` row is the COMMIT RECORD and it lands last.
// A scan that dies mid-walk appends no row, so it never becomes a `prevScanId`, so the next
// scan's disappearance pass still measures against the last COMPLETE scan of that scope. That
// is not a check anywhere — it is the shape of the thing, and every early return below is
// written to preserve it.
//
// Why it matters more here than in either sibling: `reconcile` resolves a finding by ABSENCE.
// A partial population is indistinguishable from a remediated one, so a scan row written over
// half a walk does not produce an error, it produces a remediation programme that never
// happened. Fourteen thousand SCA findings would close on a single dropped page.
//
// Phases on the jobs tab: FETCHING(scope, cursor, page) -> RECONCILING -> PERSISTING -> and on
// to the next scope, or DONE. Each hop runs to a wall-clock budget; when it expires the walk
// checkpoints and schedules a one-shot `trigger_continueScan` that picks up exactly where it
// stopped.

import { SCOPES, type Scope } from "../domain/config";
import * as archive from "./archiveStore";
import { activeJob, createJob, getJob, isStaleJob, isTerminalPhase, newJobId, updateJob, type JobRow }
  from "./jobsStore";
import { readLedger } from "./ledgerStore";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { deleteProp, getProp, hasWizCredentials, projectScope, setProp } from "./props";
import { bumpWizDataVersion } from "./serverCache";
import { loadSettings } from "./settingsStore";
import { runScan, stagedSource } from "./sync";
import { fetchPage, MAX_PAGES, PAGE_SIZE } from "./wizClient";

/** Keep the `api_runScan` RPC snappy: the browser waits for this much and no more. */
const FIRST_STEP_BUDGET_MS = 45_000;
/** 4.5 minutes of a 6-minute execution, for the trigger-driven hops. */
const BUDGET_MS = 270_000;
/**
 * How much of a six-minute execution this hop is willing to use before yielding outright.
 *
 * Distinct from the fetch budget below, and the distinction was found by testing. The fetch
 * budget is a CHOICE about when to yield; this is the platform's actual ceiling. Measured
 * against the wrong one, the commit reserve made `startScan` unable to commit anything at
 * all: `now + 120s > now + 45s` is true on the first page of every scan, so the first hop
 * always deferred to a trigger even for a scope of four pages. Every spec that expected a
 * committed row failed, which is how it was found.
 */
const EXECUTION_MS = 300_000;
/**
 * Time held back for the commit, which is NOT budgeted anywhere else.
 *
 * The fetch loop checks a deadline between pages; the commit does not get to check anything.
 * For SCA it is an 18k-row fold, a reconcile against an 18k-row ledger and one whole-tab
 * rewrite, so a hop that finishes fetching with ninety seconds of EXECUTION left would start
 * all of that and be killed in the middle. Yielding instead means the commit begins at the
 * top of a fresh execution with six minutes in front of it.
 */
const COMMIT_RESERVE_MS = 120_000;
const CONTINUE_DELAY_MS = 30_000;
/**
 * A hop that could not take the lock waits longer than a normal yield: the holder is another
 * mutation running to completion, and re-firing every thirty seconds burns trigger quota to
 * find that out again.
 */
const CONTINUE_RETRY_MS = 90_000;
/**
 * How often the page walk writes its cursor to the sheet.
 *
 * Not every page: a checkpoint is a `updateWhere` over the jobs tab, and SCA is ~36 pages.
 * Not rarely either — the client calls a job stalled after fifteen seconds of an unmoving
 * `updated_at`, so this has to be comfortably under that or a healthy scan reads as wedged.
 */
const CHECKPOINT_MS = 8_000;

/**
 * The trigger handler name, which `dist/entry.js` must expose as a global and `setup()` must
 * never point a ClockTrigger at unless it exists.
 *
 * `dev/gas-shims.js` fires exactly this name (and `trigger_continueSync`) through a
 * `setTimeout`, which is what makes a multi-hop scan completable in the dev browser.
 */
export const CONTINUE_HANDLER = "trigger_continueScan";
export const DAILY_HANDLER = "trigger_dailyScan";

/**
 * Cancellation rides on a Script Property, NOT on the jobs tab.
 *
 * A running hop holds the script lock for its whole duration, so a lock-bound write would
 * block until the thing it is trying to stop has finished. The flag is read between pages,
 * from outside the lock, by the execution that is holding it.
 */
const CANCEL_PROP = "CANCEL_SCAN_JOB_ID";

class ScanCancelled extends Error {}
/** The walk hit MAX_PAGES with more pages to come. Fatal for the step — see `fetchStep`. */
class TruncatedStep extends Error {}

/** What a job froze at creation and every hop reads back instead of re-deriving. */
interface ScanParams {
  scopes: Scope[];
  /** The gate PER SCOPE as it stood when the job started. `null` means no gate. */
  severities: Record<string, string[] | null>;
  projectId: string | null;
}

export interface StartResult {
  jobId: string | null;
  message: string;
}

/* ------------------------------------------------------------------ small helpers */

function cancelRequested(jobId: string): boolean {
  return getProp(CANCEL_PROP) === jobId;
}

function clearCancel(): void {
  deleteProp(CANCEL_PROP);
}

function jobParams(job: JobRow): ScanParams {
  const raw = JSON.parse(job.params_json ?? "{}") as Partial<ScanParams>;
  return {
    scopes: (raw.scopes ?? []) as Scope[],
    severities: raw.severities ?? {},
    projectId: raw.projectId ?? null,
  };
}

/** Remove every one-shot continuation trigger; each firing re-arms if it still needs to. */
export function clearContinuationTriggers(): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === CONTINUE_HANDLER) ScriptApp.deleteTrigger(t);
  }
}

function scheduleContinuation(delayMs = CONTINUE_DELAY_MS): void {
  ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(delayMs).create();
}

/** The step's index in the frozen scope list — what the Drive page names are keyed by. */
function stepIndexOf(params: ScanParams, scope: string | null): number {
  const i = params.scopes.indexOf((scope ?? "") as Scope);
  if (i < 0) {
    throw new Error(
      `Job is on scope ${scope ?? "(none)"}, which is not in the list it started with `
      + `(${params.scopes.join(", ") || "empty"}). Refusing to guess which step this is.`,
    );
  }
  return i;
}

/**
 * Abandon an in-flight step's pages and mark the job.
 *
 * Per STEP, never the whole sync folder: earlier scopes in this job may already have
 * committed `scans` rows naming that folder as their `raw_ref`, and trashing it to tidy up an
 * abandoned third step would destroy the evidence for the first two.
 */
function abandonStep(job: JobRow, phase: "CANCELLED" | "FAILED", error: string | null): void {
  try {
    const params = jobParams(job);
    if (job.scope) archive.trashSyncStepPages(job.job_id, stepIndexOf(params, job.scope));
  } catch {
    // Nothing was committed for this step, so leftover pages cost storage and nothing else.
  }
  updateJob(job.job_id, { phase, error });
  clearCancel();
  clearContinuationTriggers();
}

/* ---------------------------------------------------------------------- the walk */

/**
 * Page one scope until the tenant runs out, the budget does, or something refuses.
 *
 * Returns "complete" when every page is on disk, "yielded" when the hop ran out of time and
 * has scheduled its own continuation. It never returns after a failure — those throw.
 *
 * THE WRITE ORDER IS DELIBERATE: the page goes to Drive, and only then does the cursor go to
 * the sheet. A kill between them leaves the sheet one page behind Drive, and the resume
 * re-fetches from the stored cursor and rewrites the same deterministic file name — harmless.
 * Reversed, a kill leaves the sheet claiming a page that was never written, the resume walks
 * past it, and the population is silently one page short. Both orders survive a crash; only
 * one survives it with the right number of rows.
 */
function fetchStep(job: JobRow, params: ScanParams, deadline: number): "complete" | "yielded" {
  const scope = job.scope as Scope;
  const stepIndex = stepIndexOf(params, scope);
  let cursor = job.cursor;
  let page = job.page;
  let findings = job.findings_so_far;
  let total = job.total_count;
  let pageSize = job.page_size || PAGE_SIZE;
  let lastCheckpoint = 0;

  const checkpoint = () => {
    updateJob(job.job_id, {
      cursor, page, findings_so_far: findings, total_count: total, page_size: pageSize,
    });
    lastCheckpoint = Date.now();
  };

  for (;;) {
    if (cancelRequested(job.job_id)) throw new ScanCancelled();
    if (Date.now() >= deadline) {
      checkpoint();
      scheduleContinuation();
      return "yielded";
    }

    const result = fetchPage(scope, {
      severities: params.severities[scope] ?? undefined,
      projectId: params.projectId,
      cursor,
      first: pageSize,
    });

    archive.writeSyncPage(job.job_id, stepIndex, page + 1, { nodes: result.nodes });
    page += 1;
    findings += result.nodes.length;
    pageSize = result.pageSize;
    if (result.totalCount !== null) total = result.totalCount;
    if (page === 1 || Date.now() - lastCheckpoint >= CHECKPOINT_MS) checkpoint();

    if (!result.hasNextPage) break;
    // A truncated walk is a PARTIAL POPULATION, so it fails the step rather than committing.
    // The sibling breaks here and persists as though the walk had finished, which is right
    // for a register of enhancements and wrong for one that resolves by absence. MAX_PAGES is
    // 1000 against SCA's ~36, so this should never fire — which is exactly why it must be
    // loud when it does.
    if (page >= MAX_PAGES) {
      throw new TruncatedStep(
        `${scope} still had pages after ${MAX_PAGES}. Refusing to record a partial walk as a `
        + "scan: every finding past the cut would resolve as remediated.",
      );
    }
    if (!result.endCursor) {
      throw new Error(
        `${scope} reported another page but gave no cursor to reach it. Refusing to loop.`,
      );
    }
    cursor = result.endCursor;
  }

  checkpoint();
  return "complete";
}

/* -------------------------------------------------------------------- the commit */

/**
 * Read the staged pages back and persist the scope. This is the ONLY path to `appendScan`.
 *
 * The journal is written first. `runScan` does `writeLedger` then `appendScan`, and
 * `writeLedger` is itself a `clearContent()` followed by a `setValues()` — so an execution
 * killed inside it leaves an EMPTY ledger tab, and one killed between them leaves a ledger
 * carrying resolutions that no scan row vouches for. The second is the exact failure this
 * whole file exists to prevent, arriving through the back door. `locks.recoverIfNeeded`
 * restores from this file when it finds a PERSISTING job whose scan row never landed.
 */
function commitStep(job: JobRow, params: ScanParams): void {
  const scope = job.scope as Scope;
  const stepIndex = stepIndexOf(params, scope);
  const scanId = `${job.job_id}-${scope}`;

  updateJob(job.job_id, { phase: "RECONCILING", scan_id: scanId });
  const source = stagedSource(job.job_id, stepIndex, job.page);

  const journalId = archive
    .writeGzJson(archive.syncFolder(job.job_id), `step-${stepIndex}-ledger-before.json.gz`,
      readLedger())
    .getId();
  updateJob(job.job_id, { phase: "PERSISTING", journal_ref: journalId });

  runScan(scope, source, {
    scanId,
    // FROZEN AT JOB START, never re-read. Settings can move mid-walk, and a hop that read
    // them fresh would stamp today's gate on pages fetched under yesterday's — which makes
    // the disappearance guard believe a severity was covered by a scan that never asked for
    // it. The gate a scan records has to be the gate it applied.
    severities: params.severities[scope] ?? null,
    rawRef: archive.syncFolder(job.job_id).getId(),
  });

  archive.trashFile(journalId);
  updateJob(job.job_id, { journal_ref: null });
  bumpWizDataVersion();
}

/* --------------------------------------------------------------------- the battery */

function runBattery(job: JobRow, budgetMs: number): void {
  const started = Date.now();
  // Two horizons, because they answer different questions. `fetchDeadline` is when this hop
  // CHOOSES to stop asking for pages; `executionEnd` is when the platform stops it either
  // way. The first hop's fetch budget is short so the RPC returns quickly — but it still has
  // most of an execution left, so a small scope commits immediately rather than waiting on a
  // trigger for thirty seconds.
  const fetchDeadline = started + budgetMs;
  const executionEnd = started + EXECUTION_MS;
  const params = jobParams(job);
  let cur = job;

  try {
    for (;;) {
      if (cancelRequested(cur.job_id)) throw new ScanCancelled();

      if (cur.phase === "FETCHING") {
        if (fetchStep(cur, params, fetchDeadline) === "yielded") return;
        cur = { ...cur, phase: "RECONCILING", ...(getJob(cur.job_id) ?? {}) } as JobRow;
      }

      // The commit is not interruptible, so it does not start unless it can finish.
      if (Date.now() + COMMIT_RESERVE_MS > executionEnd) {
        updateJob(cur.job_id, { phase: "RECONCILING" });
        scheduleContinuation();
        return;
      }
      commitStep(cur, params);

      const next = params.scopes[stepIndexOf(params, cur.scope) + 1];
      if (!next) {
        updateJob(cur.job_id, { phase: "DONE", error: null });
        clearCancel();
        clearContinuationTriggers();
        return;
      }
      updateJob(cur.job_id, {
        phase: "FETCHING", scope: next, scan_id: null,
        cursor: null, page: 0, findings_so_far: 0, total_count: 0, page_size: 0,
      });
      cur = getJob(cur.job_id) as JobRow;
    }
  } catch (e) {
    if (e instanceof ScanCancelled) {
      abandonStep(cur, "CANCELLED", null);
      return;
    }
    // Every failure path leaves the in-flight scope WITHOUT a scan row. Scopes this job
    // already committed keep theirs — they were complete walks and their rows are true.
    const scope = cur.scope ? `[${cur.scope}] ` : "";
    abandonStep(cur, "FAILED", `${scope}${String(e).slice(0, 900)}`);
    throw e;
  }
}

/* --------------------------------------------------------------------- entry points */

/**
 * Begin a scan, or report the one already running.
 *
 * NO DRY-RUN FALLBACK. Both siblings quietly run a sample scan when credentials are absent;
 * here `runSampleSync` already owns that path and is wired into the dev harness, so a second
 * source behind the same button would mean pressing "Run scan" and getting invented figures
 * back under a real-looking scan row. Without credentials this refuses and the button says so.
 */
export function startScan(): StartResult {
  return withScriptLock(() => {
    recoverIfNeeded();
    const active = activeJob();
    if (active) {
      if (!isStaleJob(active)) {
        return { jobId: active.job_id, message: "A scan is already in progress." };
      }
      // Nothing has moved it for half an hour, so no execution is behind it. Reclaim rather
      // than refuse, or one dead row blocks every future scan.
      clearContinuationTriggers();
      updateJob(active.job_id, {
        phase: "FAILED", error: "Reclaimed: the job stalled with no progress.",
      });
    }
    if (!hasWizCredentials()) {
      throw new Error(
        "No Wiz credentials are set, so there is nothing to scan. Set WIZ_API_URL and either "
        + "WIZ_API_TOKEN or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET in Script Properties.",
      );
    }

    const settings = loadSettings();
    // Canonical order, filtered by what Settings collects — and FROZEN into params_json here.
    // `step_index` is derived from this list on every hop, so letting a later hop re-read the
    // settings would let a scope added mid-scan reindex the battery under its own feet.
    const scopes = SCOPES.filter((s) => settings.scopes.indexOf(s) >= 0);
    if (!scopes.length) {
      // Unreachable today: `cleanSettings` substitutes every scope for an empty list
      // (settingsLogic.ts:109), so this cannot fire through the settings store. Kept because
      // the invariant it depends on lives in another module, and the cost of being wrong
      // about it is a job that walks nothing and commits nothing while reporting success.
      throw new Error("Settings collects no register, so a scan has nothing to walk.");
    }
    const severities: Record<string, string[] | null> = {};
    for (const s of scopes) {
      const gate = settings.fetchSeverities?.[s] ?? [];
      severities[s] = gate.length ? [...gate] : null;
    }
    const project = projectScope();

    clearCancel();
    const job = createJob({
      job_id: newJobId("scan"), kind: "scan", phase: "FETCHING",
      scan_id: null, scope: scopes[0]!,
      cursor: null, page: 0, findings_so_far: 0, page_size: 0, total_count: 0,
      params_json: JSON.stringify({
        scopes, severities, projectId: project ? project[0]! : null,
      } satisfies ScanParams),
      journal_ref: null, error: null,
    });
    runBattery(job, FIRST_STEP_BUDGET_MS);
    return { jobId: job.job_id, message: "Scan started." };
  });
}

/** Trigger target: resume the active scan. */
export function continueJob(_e?: unknown): void {
  try {
    withScriptLock(() => {
      clearContinuationTriggers();
      const job = activeJob();
      if (!job || job.kind !== "scan") return;
      if (cancelRequested(job.job_id)) {
        abandonStep(job, "CANCELLED", null);
        return;
      }
      runBattery(job, BUDGET_MS);
    }, 120_000);
  } catch (e) {
    // `clearContinuationTriggers()` runs INSIDE the lock, so a lock timeout has already spent
    // this hop's one-shot with no successor scheduled — the job would sit in FETCHING with
    // nothing alive to move it. Re-arm before rethrowing.
    if (e instanceof LedgerBusyError) scheduleContinuation(CONTINUE_RETRY_MS);
    throw e;
  }
}

export interface CancelResult {
  jobId: string;
  /** True when this call reaped the job itself, so the caller must not sit in "Stopping…". */
  stopped: boolean;
  message: string;
}

/**
 * Ask a running scan to stop, and reap it outright if nothing is actually running.
 *
 * The flag is set first, for the hop that is mid-walk. Then the script lock is tried briefly:
 * ACQUIRING IT MEANS NO EXECUTION IS RUNNING, whatever the job row says, so the job is dead
 * and can be closed here. Without that, a job orphaned between hops sits in "Stopping…"
 * forever, waiting for a CANCELLED that nothing will ever write.
 */
export function cancelScan(jobId: string): CancelResult {
  const job = getJob(jobId);
  if (!job || isTerminalPhase(job.phase)) {
    return { jobId, message: "That scan has already finished.", stopped: true };
  }
  setProp(CANCEL_PROP, jobId);

  const lock = LockService.getScriptLock();
  if (lock.tryLock(10_000)) {
    try {
      const fresh = getJob(jobId);
      if (fresh && !isTerminalPhase(fresh.phase)) {
        abandonStep(fresh, "CANCELLED", null);
        return { jobId, message: "Scan stopped.", stopped: true };
      }
    } finally {
      lock.releaseLock();
    }
    return { jobId, message: "Scan stopped.", stopped: true };
  }
  return { jobId, message: "Stopping after the current page…", stopped: false };
}

/** What the progress poll is allowed to see. */
export interface JobStatus {
  job_id: string;
  phase: string;
  scope: string | null;
  step: number;
  steps_total: number;
  page: number;
  findings_so_far: number;
  total_count: number;
  error: string | null;
  started_at: string;
  updated_at: string;
  /** Decided here, not in the browser, whose clock can be minutes off. */
  stale: boolean;
}

/**
 * The job, narrowed for the wire.
 *
 * `cursor`, `params_json` and `journal_ref` are deliberately absent: the cursor is a
 * production tenant's pagination handle, and the params carry the severity gate and the
 * project id. This is polled every three seconds for the length of a scan, so the smallest
 * useful shape is the right one.
 */
export function jobStatus(jobId?: string): JobStatus | null {
  const job = jobId ? getJob(jobId) : activeJob();
  if (!job) return null;
  const params = jobParams(job);
  const step = job.scope ? params.scopes.indexOf(job.scope as Scope) : -1;
  return {
    job_id: job.job_id,
    phase: job.phase,
    scope: job.scope,
    step: step < 0 ? 0 : step,
    steps_total: params.scopes.length,
    page: job.page,
    findings_so_far: job.findings_so_far,
    total_count: job.total_count,
    error: job.error,
    started_at: job.started_at,
    updated_at: job.updated_at,
    stale: !isTerminalPhase(job.phase) && isStaleJob(job),
  };
}

/**
 * The daily scan. Guarded on credentials so an installation without them does nothing once a
 * day rather than logging a failure once a day.
 */
export function dailyScan(_e?: unknown): void {
  if (!hasWizCredentials()) return;
  try {
    startScan();
  } catch (e) {
    console.error(`Daily scan could not start: ${e}`);
  }
}

/**
 * Operator escape hatch, run from the Apps Script editor.
 *
 * Jobs are single-flight, so a job wedged in a non-terminal phase with no live execution
 * blocks every future scan and the daily trigger with it. Nothing in the web app can clear
 * that if the UI itself is what is confused.
 */
export function resetStuckJob(): string {
  const job = activeJob();
  if (!job) return "No active job.";
  clearContinuationTriggers();
  clearCancel();
  updateJob(job.job_id, {
    phase: "FAILED", error: "Reset by an operator from the Apps Script editor.",
  });
  return `Reset ${job.job_id} (was ${job.phase}).`;
}

