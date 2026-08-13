// Scan orchestration: the port of ui/scan.py's run_scan / run_incremental_scan as a
// resumable job state machine (6-minute GAS executions can't hold a 100k-finding walk).
//
// Phases on the jobs tab: FETCHING(cursor,page) -> RECONCILING -> PERSISTING -> DONE.
// Each invocation runs with a 4.5-minute wall-clock budget; when it expires the page
// walk yields by scheduling a one-shot trigger_continueScan and persisting a slim-
// record spill file, so the next hop resumes exactly where this one stopped.

import { parseSeverities } from "../domain/compaction";
// Namespace import used only at runtime (afterPersist → api.warmReadModels), never at module
// eval — api.ts imports this module back, so a value used during evaluation would be a TDZ
// risk; a runtime call sees the fully-initialized live binding.
import * as api from "./api";
import { countBySeverity, effectiveSeverity } from "../domain/severity";
import { calculateMttr, overallSlaOldest } from "../domain/metrics";
import * as remediation from "../domain/remediation";
import { extractNodes, mergeNodes } from "../domain/transform";
import { nowIso, parseTs, pushAll, toIso, type Rec } from "../domain/util";
import * as archive from "./archiveStore";
import * as errorLog from "./errorLog";
import { buildFrame, pageOfFromRuns } from "./frameCore";
import * as history from "./historyStore";
import {
  activeJob,
  clearTriggers,
  CONTINUE_HANDLERS,
  createJob,
  getJob,
  isTerminalPhase,
  newJobId,
  reclaimIfStale,
  updateJob,
  type JobKind,
  type JobPhase,
  type JobRow,
} from "./jobsStore";
import * as ledgerStore from "./ledgerStore";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { deleteProp, getProp, hasWizCredentials, setProp } from "./props";
import { SAMPLE_FLAT, SAMPLE_GROUPED } from "./sampleData";
import * as settingsStore from "./settingsStore";
import * as supportGroups from "./supportGroups";
import { fetchPage, MAX_PAGES, WizDeltaFilterError } from "./wizClient";

const BUDGET_MS = 270_000; // 4.5 min of a 6-min execution (continuation hops)
const FIRST_STEP_BUDGET_MS = 45_000; // keep the "Run scan" RPC snappy; rest via trigger
const CONTINUE_DELAY_MS = 30_000;
// A hop that couldn't take the lock waits longer than a normal yield: the holder is another
// mutation running to completion, and re-firing every 30s just burns trigger runtime quota.
const CONTINUE_RETRY_MS = 90_000;
const CONTINUE_HANDLER = "trigger_continueScan";
const DELTA_OVERLAP_MINUTES = 15;
// Liveness probe for Stop. A hop holds the script lock for its whole duration, so failing to
// take it means something is genuinely executing. One second (what this used to be) is inside
// the noise of an unrelated read, which turned incidental contention into a dead Stop button.
const FORCE_STOP_LOCK_MS = 10_000;

// Cancel is signalled through a Script Property (lock-free) rather than the jobs tab:
// a running hop holds the mutation lock for its whole duration, so a lock-bound write
// would block. The fetch loop polls this flag between pages and bails.
class ScanCancelled extends Error {}

/** `stopped` is the client's cue that the job is already terminal — no "Stopping…" to sit in. */
export interface CancelResult {
  jobId: string;
  stopped: boolean;
  message: string;
}
const cancelKey = (jobId: string) => `CANCEL_${jobId}`;
function isCancelRequested(jobId: string): boolean {
  return Boolean(getProp(cancelKey(jobId)));
}
function clearCancel(jobId: string): void {
  deleteProp(cancelKey(jobId));
}

/**
 * Request cancellation of the running job (lock-free). During FETCHING this is cooperative:
 * the page loop polls the flag between pages and bails, so nothing is committed. Past that —
 * or when nothing is alive to read the flag at all — forceStop() finishes the job directly.
 *
 * Stop used to have two states it could never escape, and a wedged scan hit both at once:
 *   - an *orphaned* scan, whose execution died between deleting its continuation trigger and
 *     scheduling the next, so no hop is running and none is scheduled;
 *   - a scan whose PERSISTING hop was killed by the 6-minute execution cap, which this
 *     function declined to touch on the grounds that the `scans` row was "imminent" — while
 *     the UI hid the Run buttons that were the only other route to recoverIfNeeded().
 * forceStop covers both, and every phase in between.
 */
export function cancelScan(jobId: string): CancelResult {
  const job = getJob(jobId);
  if (!job) return { jobId, stopped: false, message: "No such job." };
  if (isTerminalPhase(job.phase)) {
    return { jobId, stopped: true, message: "Scan already finished." };
  }
  // Jobs are single-flight ACROSS kinds, and bootstrap hands the client whatever activeJob()
  // returns — so the card offering this Stop may be showing a wedged import or backfill.
  // Refusing those ("No such scan.") left the one job blocking every scan unreachable.
  if (job.kind !== "scan") return { jobId, ...forceStopOtherKind(job) };
  // Raise the cooperative flag first: a live fetch hop honors it at the next page
  // boundary, and continueJob honors it before its next hop.
  setProp(cancelKey(jobId), "1");
  // Then try to reap it directly, in case nothing is alive to honor the flag.
  const message = forceStop(jobId);
  return message === null
    ? { jobId, stopped: false, message: "Stopping scan…" }
    : { jobId, stopped: true, message };
}

/**
 * Finish a scan the cooperative flag can't reach; returns the message to show, or null when a
 * live hop holds the lock and the flag will do the job.
 *
 * The script lock is the liveness probe: a hop holds it for its whole duration, so acquiring
 * it means no execution is running and the job is dead whatever its row says. What that
 * warrants depends on how far it got:
 *
 *   FETCHING / RECONCILING — nothing is committed (the `scans` row is appended last), so the
 *     partial archive is trashed and the job goes CANCELLED.
 *   PERSISTING / REPLAYING — mid-write territory, and recoverIfNeeded() is the only correct
 *     handling: it restores the ledger tabs from the Drive journal, or closes the job as DONE
 *     when the commit record landed after all. finalizeCancel here would trash an archive
 *     that a committed `scans` row still points at.
 *
 * A *dead* continuation trigger (killed execution, exhausted trigger quota) stays listed but
 * never fires; trusting it here is what pinned the job in "Stopping…" forever. Stray triggers
 * are deleted on the paths that terminate the job — if one fires afterward, continueJob finds
 * the job terminal and no-ops.
 */
function forceStop(jobId: string): string | null {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(FORCE_STOP_LOCK_MS)) return null; // a hop holds it → the flag will fire
  try {
    recoverIfNeeded(); // roll back (or close out) a killed PERSISTING/REPLAYING hop
    const job = getJob(jobId);
    if (!job || job.kind !== "scan") return null;
    if (isTerminalPhase(job.phase)) {
      clearContinuationTriggers();
      clearCancel(jobId);
      return "Scan stopped.";
    }
    if (job.phase === "FETCHING" || job.phase === "RECONCILING") {
      clearContinuationTriggers(); // drop any (possibly dead) pending hop
      finalizeCancel(job); // trashes the never-committed archive, phase → CANCELLED
      return "Scan stopped.";
    }
    // A phase recoverIfNeeded() deliberately leaves alone. Keep the flag raised and leave any
    // watchdog trigger armed rather than stranding the job by deleting its only wake-up.
    return null;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Stop a wedged job of another kind. Staleness, not the lock, is the gate here: an import or
 * backfill sitting between continuation hops leaves the lock free while being perfectly
 * alive, so "the lock is free" alone would kill healthy work. reclaimIfStale clears the
 * continuation trigger belonging to that job's own kind.
 */
function forceStopOtherKind(job: JobRow): { stopped: boolean; message: string } {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(FORCE_STOP_LOCK_MS)) {
    return { stopped: false, message: `A ${job.kind} job is running and can't be interrupted.` };
  }
  try {
    recoverIfNeeded();
    const fresh = getJob(job.job_id);
    if (!fresh || isTerminalPhase(fresh.phase)) return { stopped: true, message: "Job stopped." };
    if (reclaimIfStale(fresh)) return { stopped: true, message: "Job stopped." };
    return { stopped: false, message: `A ${job.kind} job is still working — let it finish.` };
  } finally {
    lock.releaseLock();
  }
}

/** Mark a FETCHING job cancelled and drop its partial (never-committed) archive. */
function finalizeCancel(job: JobRow): void {
  try {
    if (job.scan_id) archive.trashScanArchive(archive.scanFolder(job.scan_id).getId());
  } catch {
    // best-effort cleanup — the scan row was never appended, so nothing is committed
  }
  updateJob(job.job_id, { phase: "CANCELLED", error: null });
  clearCancel(job.job_id);
}

// Slim records: the subset of node fields reconciliation and the findings table read.
// Raw pages in Drive keep the full nodes for the drill-down detail and raw exports.
const SLIM_TOP = [
  "id", "name", "severity", "status", "firstDetectedAt", "firstSeenAt", "createdAt",
  "lastDetectedAt", "resolvedAt", "remediatedAt", "fixedAt", "detailedName",
  "detailedNameV2", "fixedVersion", "detectionMethod", "vendorSeverity", "nvdSeverity",
  "weightedSeverity", "score", "epssSeverity", "epssProbability", "hasExploit",
  "hasCisaKevExploit", "publishedDate", "dataSourceName",
  // Vendor-fix signals for the actionable clock / awaiting-vendor-fix segment.
  // Additive: frames persisted before this simply lack the keys (read as null).
  "fixDate", "fixDateBefore", "isOperatingSystemEndOfLife",
];
const SLIM_ASSET = [
  "id", "name", "type", "cloudPlatform", "region", "subscriptionName",
  "subscriptionExternalId", "subscriptionId", "tags", "operatingSystem",
  // Exposure signals for the insights view. Additive: frames persisted before this
  // simply lack the keys, and the client reports exposure as "not captured".
  "hasWideInternetExposure", "hasLimitedInternetExposure",
];

export function slimRecord(node: Rec): Rec {
  const out: Rec = {};
  for (const k of SLIM_TOP) {
    if (k in node) out[k] = node[k];
  }
  // Severity fallback at the single ingestion choke: a blank/unrecognized top-level
  // severity is healed from vendorSeverity/nvdSeverity (both already in SLIM_TOP, so the
  // raw fields survive for audit) with provenance in `severity_source`. Baking it here —
  // upstream of reconcile, which reads the persisted `severity` — heals both the current
  // frame and the durable ledger without any downstream reader change, keeping reconcile.ts
  // / metrics.ts at zero diff. No-op when the real severity already classifies.
  const eff = effectiveSeverity(node);
  if (eff.source !== null && eff.source !== "severity") {
    out["severity"] = eff.severity;
    out["severity_source"] = eff.source;
  }
  const va = node["vulnerableAsset"];
  if (va && typeof va === "object" && !Array.isArray(va)) {
    const slim: Rec = {};
    for (const k of SLIM_ASSET) {
      if (k in (va as Rec)) slim[k] = (va as Rec)[k];
    }
    out["vulnerableAsset"] = slim;
  }
  return out;
}

interface ScanParams {
  mode: string; // "live" | "dry-run" | "incremental" | "dry-run-incremental"
  severities: string[] | null;
  extraFilterBy: Rec | null;
  incremental: boolean;
  baselineScanId: string | null;
}

// ---------------------------------------------------------------- findings frame
// The frame (built in frameCore.ts) moves currentScan()'s per-request flatten + sha1
// pass into the scan job, where it runs once per scan instead of once per RPC. The
// records handed to persistFlatScan stay untouched — the frame is a separate derived
// artifact, so nothing extra flows into the fixture-locked reconcile path.

function writeFrameSafely(scanId: string, records: Rec[], pageOf: ((i: number) => number) | null): void {
  try {
    archive.writeFrame(scanId, buildFrame(records, pageOf));
  } catch (e) {
    // The frame is an optimization only — currentScan() falls back to slim.json.gz.
    console.warn(`Failed to write findings frame for ${scanId}: ${e}`);
  }
}

function envelope(nodes: Rec[]): Rec {
  return { data: { vulnerabilityFindings: { nodes } } };
}

// ------------------------------------------------------------------------- start

export interface StartResult {
  jobId: string | null;
  message: string;
}

/** Start a scan job (web-app "Run scan" / "Quick refresh" and the daily trigger). */
export function startScan(options: { incremental?: boolean; sampleShape?: string } = {}): StartResult {
  return withScriptLock(() => {
    recoverIfNeeded();
    const active = activeJob();
    if (active && !reclaimStaleJob(active)) {
      return { jobId: active.job_id, message: "A scan is already in progress." };
    }
    if (!hasWizCredentials()) return dryRunScan(options);

    if (options.incremental) return startIncremental();

    const scanId = nowIso();
    const job = createJob({
      job_id: newJobId("scan"),
      kind: "scan",
      phase: "FETCHING",
      scan_id: scanId,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: JSON.stringify({
        mode: "live",
        severities: settingsStore.getFetchSeverities(),
        extraFilterBy: null,
        incremental: false,
        baselineScanId: null,
      } satisfies ScanParams),
      journal_ref: null,
      error: null,
    });
    step(job, FIRST_STEP_BUDGET_MS);
    return { jobId: job.job_id, message: "Scan started." };
  });
}

/**
 * A job with no progress for jobsStore.STALE_JOB_MS died mid-flight (e.g. a killed execution). This
 * runs inside startScan's lock, so no hop can be executing — a stale job is definitively
 * dead, and any continuation trigger still listed is dead too (a live one fires within
 * minutes). Delete the stray trigger and fail the job so a fresh scan can start. (Trusting a
 * leftover trigger here used to wedge recovery: a dead trigger blocked both Stop and re-run.)
 *
 * Jobs are single-flight ACROSS kinds, so the job being reclaimed here is not necessarily a
 * scan — a stalled backfill blocks scanning just as effectively. jobsStore.reclaimIfStale
 * clears the continuation trigger belonging to the job's own kind; clearing only this
 * module's would orphan the other's.
 */
function reclaimStaleJob(job: JobRow): boolean {
  if (!reclaimIfStale(job)) return false;
  clearCancel(job.job_id);
  return true;
}

function startIncremental(): StartResult {
  const baseline = ledgerStore.latestFlatScanRow();
  if (!baseline) {
    return { jobId: null, message: "Run a full scan first — quick refresh needs a baseline." };
  }
  const baseTs = parseTs(baseline.ts);
  if (baseTs === null) {
    return { jobId: null, message: "The saved baseline has no timestamp — run a full scan." };
  }
  const sinceIso = toIso(baseTs - DELTA_OVERLAP_MINUTES * 60_000)!;
  // A delta always rides the BASELINE's severity scope, never the current settings.
  const baselineScope = parseSeverities(baseline.severities);
  const scanId = nowIso();
  const job = createJob({
    job_id: newJobId("scan"),
    kind: "scan",
    phase: "FETCHING",
    scan_id: scanId,
    cursor: null,
    page: 0,
    findings_so_far: 0,
    page_size: 0,
    total_count: 0,
    params_json: JSON.stringify({
      mode: "incremental",
      severities: baselineScope,
      extraFilterBy: { updatedAt: { after: sinceIso } },
      incremental: true,
      baselineScanId: baseline.scan_id,
    } satisfies ScanParams),
    journal_ref: null,
    error: null,
  });
  step(job);
  return { jobId: job.job_id, message: "Quick refresh started." };
}

function dryRunScan(options: { incremental?: boolean; sampleShape?: string }): StartResult {
  // Offline mode: persist the bundled sample so every page has data to render. Each
  // subsequent dry-run scan deterministically resolves one more open sample finding,
  // so scan-over-scan badges show non-zero deltas (a light stand-in for data/demo.py).
  const scanId = nowIso();
  if (options.sampleShape === "grouped") {
    const nodes = extractNodes(SAMPLE_GROUPED);
    archive.writeScanPage(scanId, 1, SAMPLE_GROUPED);
    ledgerStore.persistGroupedScan(nodes, {
      mode: "dry-run",
      scanId,
      rawRef: archive.scanFolder(scanId).getId(),
    });
    return { jobId: null, message: "Dry-run grouped scan saved." };
  }
  const seq = ledgerStore.loadScanRows().filter((s) => s.mode.startsWith("dry-run")).length;
  const nodes = extractNodes(SAMPLE_FLAT).map((n) => ({ ...(n as Rec) }));
  const open = nodes.filter((n) => !n["resolvedAt"]);
  for (let i = 0; i < Math.min(seq, open.length); i++) {
    open[i]["resolvedAt"] = scanId;
    open[i]["status"] = "RESOLVED";
  }
  archive.writeScanPage(scanId, 1, envelope(nodes));
  const slim = nodes.map(slimRecord);
  archive.writeSlimRecords(scanId, slim);
  writeFrameSafely(scanId, slim, () => 1);
  ledgerStore.persistFlatScan(slim, {
    mode: options.incremental ? "dry-run-incremental" : "dry-run",
    scanId,
    scannedSeverities: null,
    rawRef: archive.scanFolder(scanId).getId(),
  });
  afterPersist(slim);
  return { jobId: null, message: "Dry-run scan saved." };
}

// -------------------------------------------------------------------------- step

/** One execution hop of the page walk. Yields via a one-shot trigger when over budget. */
function step(job: JobRow, budgetMs = BUDGET_MS): void {
  const started = Date.now();
  const params = JSON.parse(job.params_json ?? "{}") as ScanParams;
  const scanId = job.scan_id!;
  let slim: Rec[] = job.page > 0 ? ((archive.readSlimRecords(scanId) as Rec[]) ?? []) : [];
  const pageRuns: Array<[number, number]> =
    job.page > 0 ? (archive.readPageRuns(scanId) ?? []) : [];
  let cursor = job.cursor;
  let page = job.page;
  let findings = job.findings_so_far;
  let totalCount = job.total_count;

  try {
    for (;;) {
      // Stop-button check: bail before spending another Wiz page. Honored only here,
      // during FETCHING — nothing is committed yet (the scans row is appended last).
      if (isCancelRequested(job.job_id)) throw new ScanCancelled();

      const result = fetchPage({
        severities: params.severities,
        extraFilterBy: params.extraFilterBy,
        cursor,
        pageNumber: page,
      });
      const pageName = params.incremental ? page + 1001 : page + 1;
      // Delta pages archive under a high page number so the merged set (written at
      // finish) occupies page-0001..N and stays the payload replay reads.
      archive.writeScanPage(scanId, pageName, envelope(result.nodes));
      pushAll(slim, result.nodes.map(slimRecord)); // not slim.push(...): a page is findings-scale
      pageRuns.push([pageName, result.nodes.length]);
      page += 1;
      findings += result.nodes.length;
      cursor = result.endCursor;
      // totalCount arrives only on page 0; keep it once seen so the UI can show a %.
      if (result.totalCount !== null) totalCount = result.totalCount;
      updateJob(job.job_id, { cursor, page, findings_so_far: findings, total_count: totalCount });

      if (!result.hasNextPage || page >= MAX_PAGES) break;
      if (Date.now() - started > budgetMs) {
        archive.writeSlimRecords(scanId, slim);
        archive.writePageRuns(scanId, pageRuns);
        scheduleContinuation();
        return;
      }
    }

    archive.writeSlimRecords(scanId, slim);
    archive.writePageRuns(scanId, pageRuns);
    updateJob(job.job_id, { phase: "RECONCILING" });
    finishScan(job.job_id, scanId, params, slim);
  } catch (e) {
    if (e instanceof ScanCancelled) {
      finalizeCancel(job);
      return;
    }
    if (e instanceof WizDeltaFilterError) {
      clearCancel(job.job_id);
      updateJob(job.job_id, {
        phase: "FAILED",
        error:
          "The tenant rejected the updatedAt filter — quick refresh is unavailable; " +
          "run a full scan.",
      });
      return;
    }
    clearCancel(job.job_id);
    updateJob(job.job_id, {
      phase: "FAILED",
      error: e == null ? "Scan failed." : String(e).slice(0, 1000),
    });
    errorLog.recordError("scan", e);
    throw e;
  }
}

function finishScan(jobId: string, scanId: string, params: ScanParams, slim: Rec[]): void {
  // Past FETCHING the scan finishes (seconds) rather than cancelling; drop any pending
  // Stop request so its flag can't outlive the job.
  clearCancel(jobId);
  let records = slim;
  if (params.incremental) {
    if (!slim.length) {
      // Nothing changed: no scan row, no snapshot — the badge baseline stays put.
      updateJob(jobId, { phase: "DONE", error: null });
      archive.trashScanArchive(archive.scanFolder(scanId).getId());
      return;
    }
    const baselineSlim = loadBaselineSlim(params.baselineScanId!);
    if (baselineSlim === null) {
      updateJob(jobId, {
        phase: "FAILED",
        error: "The baseline scan's archive couldn't be read — run a full scan.",
      });
      return;
    }
    records = mergeNodes(baselineSlim, slim);
    // The merged set becomes the scan's replayable payload (page-0001..N).
    let pageNo = 1;
    for (let i = 0; i < records.length; i += 500) {
      archive.writeScanPage(scanId, pageNo++, envelope(records.slice(i, i + 500)));
    }
    archive.writeSlimRecords(scanId, records);
    // Merged pages are deterministic 500-record chunks — _page by arithmetic.
    writeFrameSafely(scanId, records, (i) => Math.floor(i / 500) + 1);
  } else {
    writeFrameSafely(scanId, records, pageOfFromRuns(archive.readPageRuns(scanId), records.length));
  }

  updateJob(jobId, { phase: "PERSISTING", scan_id: scanId });
  // Arm a watchdog BEFORE the write. The persist is synchronous and holds the script lock, so
  // if the 6-minute execution cap (or a trigger-runtime quota kill) takes it mid-write there
  // is otherwise nothing left to notice: PERSISTING schedules no hop of its own, and the only
  // other route to recoverIfNeeded() is a write the UI hides behind the job card. The one-shot
  // fires shortly after, finds the job still PERSISTING with the lock free, and rolls it back
  // from the journal. Cleared below the moment the write lands.
  scheduleContinuation();
  ledgerStore.persistFlatScan(records, {
    mode: params.mode,
    scanId,
    scannedSeverities: params.severities,
    rawRef: archive.scanFolder(scanId).getId(),
    jobId,
  });
  afterPersist(records);
  updateJob(jobId, { phase: "DONE" });
  clearContinuationTriggers(); // the commit record landed — retire the watchdog
  // A Stop pressed after finishScan's clearCancel above (i.e. during the persist) would
  // otherwise leave its CANCEL_ property behind for good.
  clearCancel(jobId);
}

function loadBaselineSlim(baselineScanId: string): Rec[] | null {
  const slim = archive.readSlimRecords(baselineScanId) as Rec[] | null;
  if (slim && slim.length) return slim;
  const row = ledgerStore
    .loadScanRows()
    .find((s) => s.scan_id === baselineScanId);
  const payload = row ? archive.readScanPayload(row.raw_ref) : null;
  if (!payload) return null;
  const nodes = extractNodes(payload);
  return nodes.length ? nodes.map(slimRecord) : null;
}

/** MTTR snapshot + support-group refresh + auto-compaction after a persist (never breaks a scan). */
function afterPersist(records: Rec[]): void {
  refreshSupportGroupsAfterScan();
  try {
    const { perSev, overall } = calculateMttr(records);
    const median = overall.mttr_median;
    if (median !== null && median !== undefined) {
      const { slaPct, oldestDays } = overallSlaOldest(perSev);
      history.recordSnapshot(
        median,
        overall.resolved ?? 0,
        overall.open ?? 0,
        countBySeverity(records),
        null,
        slaPct,
        oldestDays,
        remediation.openPastSlaFromRecords(records),
      );
    }
  } catch (e) {
    console.warn(`Failed to record MTTR snapshot: ${e}`);
    errorLog.recordError("mttrSnapshot", e);
  }
  autoCompactIfDue();
  // Warm the landing-view read-models LAST, against the now-final DATA_VERSION (any
  // auto-compaction above bumped it again), so the first analyst load after this scan hits a
  // warm cache instead of recomputing on the interactive path. The scan is already committed;
  // this reuses the state + frame already loaded in this execution and never breaks a scan.
  try {
    api.warmReadModels();
  } catch (e) {
    console.warn(`Cache warming after scan failed: ${e}`);
    errorLog.recordError("cacheWarm", e);
  }
}

/** Auto-compaction after a persist, gated on the setting + a retention window. Its own
 *  function so its early returns don't skip the post-persist steps that follow it. */
function autoCompactIfDue(): void {
  try {
    if (!settingsStore.getAutoCompact()) return;
    const days = settingsStore.getRetentionDays();
    if (days === null) return;
    ledgerStore.compactLedger(days);
  } catch (e) {
    console.warn(`Auto-compaction failed: ${e}`);
    errorLog.recordError("autoCompact", e);
  }
}

/**
 * Refresh the subscription → Support Group map after a live scan (best-effort). Gated on
 * credentials, so dry-run scans (which have none) skip it. Never breaks a scan — a failed
 * graphSearch just leaves the previous map in place. Runs inside the scan's lock already.
 */
function refreshSupportGroupsAfterScan(): void {
  if (!hasWizCredentials()) return;
  try {
    supportGroups.refreshSupportGroups();
  } catch (e) {
    console.warn(`Support-group refresh after scan failed: ${e}`);
    errorLog.recordError("supportGroupRefresh", e);
  }
}

// ------------------------------------------------------------------ continuation

function scheduleContinuation(delayMs = CONTINUE_DELAY_MS): void {
  ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(delayMs).create();
}

/** Remove all one-shot continuation triggers (each firing re-arms if needed). */
export function clearContinuationTriggers(): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === CONTINUE_HANDLER) ScriptApp.deleteTrigger(t);
  }
}

/** Trigger target: resume the active scan job. */
export function continueJob(_e?: unknown): void {
  try {
    withScriptLock(() => {
      clearContinuationTriggers();
      const job = activeJob();
      if (!job || job.kind !== "scan") return;
      if (job.phase === "FETCHING") {
        if (isCancelRequested(job.job_id)) {
          finalizeCancel(job);
          return;
        }
        step(job);
      } else if (job.phase === "RECONCILING") {
        const params = JSON.parse(job.params_json ?? "{}") as ScanParams;
        const slim = (archive.readSlimRecords(job.scan_id!) as Rec[]) ?? [];
        finishScan(job.job_id, job.scan_id!, params, slim);
      } else if (job.phase === "PERSISTING" || job.phase === "REPLAYING") {
        // The watchdog finishScan arms before the write. Reaching it means that execution
        // died mid-persist: recoverIfNeeded() restores the ledger from the journal, or closes
        // the job as DONE when the commit record landed after all. The persist is never
        // re-run from here — the journal, not this hop, is what makes the mutation atomic.
        recoverIfNeeded();
        clearCancel(job.job_id);
      }
    }, 120_000);
  } catch (e) {
    // clearContinuationTriggers() runs INSIDE the lock, so a lock timeout leaves this hop's
    // one-shot already spent and no successor scheduled — the job would sit in FETCHING with
    // nothing alive to move it, which is exactly the orphan this module works to avoid.
    // Re-arm before rethrowing so the walk resumes once the other mutation finishes.
    if (e instanceof LedgerBusyError) scheduleContinuation(CONTINUE_RETRY_MS);
    throw e;
  }
}

/** Daily trigger target: a scheduled full scan (skipped without credentials). */
export function dailyScan(): void {
  if (!hasWizCredentials()) return;
  startScan({ incremental: false });
}

/** Job status for the UI poller. */
export function jobStatus(jobId: string): JobRow | null {
  return getJob(jobId);
}

// ---------------------------------------------------------------- operator escape hatch

export interface ResetResult {
  cleared: boolean;
  jobId: string | null;
  kind: JobKind | null;
  phase: JobPhase | null;
  message: string;
}

/**
 * Last-resort recovery, run from the GAS editor (`resetStuckJob` in dist/entry.js) when the
 * web app can't reach the job at all — a deployment too old to have the Stop path below, or a
 * phase no UI surfaces. Everything the in-app Stop does, without needing the web app: roll a
 * killed mid-write back from its journal, delete every continuation trigger of every kind,
 * force whatever survives to FAILED, and drop the cancel flags.
 *
 * Safe to run when nothing is wrong — with no active job it reports that and touches nothing.
 * The script lock is still taken, so a genuinely running hop is waited for rather than raced.
 */
export function resetStuckJob(): ResetResult {
  const result = withScriptLock((): ResetResult => {
    // Read the row BEFORE recovering, so the report names the phase it was wedged in rather
    // than the terminal one recoverIfNeeded may have just moved it to.
    const before = activeJob();
    recoverIfNeeded();
    if (!before) {
      return { cleared: false, jobId: null, kind: null, phase: null, message: "No active job." };
    }
    for (const handler of Object.values(CONTINUE_HANDLERS)) clearTriggers(handler);
    clearCancel(before.job_id);
    const after = activeJob();
    if (after) {
      updateJob(after.job_id, {
        phase: "FAILED",
        error: "Reset: cleared by resetStuckJob() from the Apps Script editor.",
      });
    }
    return {
      cleared: true,
      jobId: before.job_id,
      kind: before.kind,
      phase: before.phase,
      message: `Cleared ${before.kind} job ${before.job_id} (was ${before.phase}).`,
    };
  }, 120_000);
  console.log(result.message);
  return result;
}
