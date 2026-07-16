// Scan orchestration: the port of ui/scan.py's run_scan / run_incremental_scan as a
// resumable job state machine (6-minute GAS executions can't hold a 100k-finding walk).
//
// Phases on the jobs tab: FETCHING(cursor,page) -> RECONCILING -> PERSISTING -> DONE.
// Each invocation runs with a 4.5-minute wall-clock budget; when it expires the page
// walk yields by scheduling a one-shot trigger_continueScan and persisting a slim-
// record spill file, so the next hop resumes exactly where this one stopped.

import { parseSeverities } from "../domain/compaction";
import { countBySeverity } from "../domain/severity";
import { calculateMttr, overallSlaOldest } from "../domain/metrics";
import * as remediation from "../domain/remediation";
import { extractNodes, mergeNodes } from "../domain/transform";
import { nowIso, parseTs, toIso, type Rec } from "../domain/util";
import * as archive from "./archiveStore";
import { buildFrame, pageOfFromRuns } from "./frameCore";
import * as history from "./historyStore";
import { activeJob, createJob, getJob, newJobId, updateJob, type JobRow } from "./jobsStore";
import * as ledgerStore from "./ledgerStore";
import { recoverIfNeeded, withScriptLock } from "./locks";
import { deleteProp, getProp, hasWizCredentials, setProp } from "./props";
import { SAMPLE_FLAT, SAMPLE_GROUPED } from "./sampleData";
import * as settingsStore from "./settingsStore";
import * as supportGroups from "./supportGroups";
import { fetchPage, MAX_PAGES, WizDeltaFilterError } from "./wizClient";

const BUDGET_MS = 270_000; // 4.5 min of a 6-min execution (continuation hops)
const FIRST_STEP_BUDGET_MS = 45_000; // keep the "Run scan" RPC snappy; rest via trigger
const CONTINUE_DELAY_MS = 30_000;
const CONTINUE_HANDLER = "trigger_continueScan";
const DELTA_OVERLAP_MINUTES = 15;
const STALE_JOB_MS = 30 * 60_000; // no update + no pending trigger = crashed job

// Cancel is signalled through a Script Property (lock-free) rather than the jobs tab:
// a running hop holds the mutation lock for its whole duration, so a lock-bound write
// would block. The fetch loop polls this flag between pages and bails.
class ScanCancelled extends Error {}
const cancelKey = (jobId: string) => `CANCEL_${jobId}`;
function isCancelRequested(jobId: string): boolean {
  return Boolean(getProp(cancelKey(jobId)));
}
function clearCancel(jobId: string): void {
  deleteProp(cancelKey(jobId));
}

/**
 * Request cancellation of a running scan (lock-free). Honored only during FETCHING —
 * once RECONCILING/PERSISTING starts, the `scans` row is imminent and the job finishes
 * (seconds). Returns immediately; a live scan flips to CANCELLED on the next page boundary.
 *
 * An *orphaned* scan — one whose execution died between deleting its continuation trigger
 * and scheduling the next, so no hop is running and none is scheduled — would never read
 * the cooperative flag and would sit "running" forever (the Stop button appears dead). We
 * detect that here and finalize it immediately.
 */
export function cancelScan(jobId: string): { jobId: string; message: string } {
  const job = getJob(jobId);
  if (!job || job.kind !== "scan") return { jobId, message: "No such scan." };
  if (job.phase === "DONE" || job.phase === "FAILED" || job.phase === "CANCELLED") {
    return { jobId, message: "Scan already finished." };
  }
  // Raise the cooperative flag first: a live fetch hop honors it at the next page
  // boundary, and continueJob honors it before its next hop.
  setProp(cancelKey(jobId), "1");
  // Then try to reap it directly, in case nothing is alive to honor the flag.
  return { jobId, message: forceStopIfOrphaned(jobId) ? "Scan stopped." : "Stopping scan…" };
}

/**
 * Finalize a scan the cooperative flag can't reach. The script lock is the liveness probe:
 * a running hop holds it for its whole duration, so acquiring it instantly means no hop is
 * executing. In FETCHING/RECONCILING nothing is committed yet (the `scans` row lands last),
 * so it's safe to reap now — even if a continuation trigger is still listed. A *dead* trigger
 * (killed execution, exhausted trigger quota) stays listed but never fires; trusting it here
 * is what pinned the job in "Stopping…" forever. We delete any stray trigger and cancel; if
 * one somehow fires afterward, continueJob finds the job terminal and no-ops. A live hop just
 * fails the tryLock and the cooperative flag handles it.
 */
function forceStopIfOrphaned(jobId: string): boolean {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return false; // a hop holds it → the cooperative flag will fire
  try {
    const job = getJob(jobId);
    if (!job || job.kind !== "scan") return false;
    // Only pre-commit phases are safe to reap; PERSISTING/REPLAYING is mid-write territory
    // that recoverIfNeeded() rolls back from the journal instead.
    if (job.phase !== "FETCHING" && job.phase !== "RECONCILING") return false;
    clearContinuationTriggers(); // drop any (possibly dead) pending hop
    finalizeCancel(job); // trashes the never-committed archive, phase → CANCELLED
    return true;
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
 * A job with no progress for STALE_JOB_MS died mid-flight (e.g. a killed execution). This
 * runs inside startScan's lock, so no hop can be executing — a stale job is definitively
 * dead, and any continuation trigger still listed is dead too (a live one fires within
 * minutes). Delete the stray trigger and fail the job so a fresh scan can start. (Trusting a
 * leftover trigger here used to wedge recovery: a dead trigger blocked both Stop and re-run.)
 */
function reclaimStaleJob(job: JobRow): boolean {
  const updated = parseTs(job.updated_at);
  if (updated !== null && Date.now() - updated < STALE_JOB_MS) return false;
  clearContinuationTriggers();
  clearCancel(job.job_id);
  updateJob(job.job_id, {
    phase: "FAILED",
    error: "Reclaimed: the job stalled with no progress.",
  });
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
      slim.push(...result.nodes.map(slimRecord));
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
  ledgerStore.persistFlatScan(records, {
    mode: params.mode,
    scanId,
    scannedSeverities: params.severities,
    rawRef: archive.scanFolder(scanId).getId(),
    jobId,
  });
  afterPersist(records);
  updateJob(jobId, { phase: "DONE" });
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
  }
  try {
    if (!settingsStore.getAutoCompact()) return;
    const days = settingsStore.getRetentionDays();
    if (days === null) return;
    ledgerStore.compactLedger(days);
  } catch (e) {
    console.warn(`Auto-compaction failed: ${e}`);
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
  }
}

// ------------------------------------------------------------------ continuation

function scheduleContinuation(): void {
  ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(CONTINUE_DELAY_MS).create();
}

/** Remove all one-shot continuation triggers (each firing re-arms if needed). */
export function clearContinuationTriggers(): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === CONTINUE_HANDLER) ScriptApp.deleteTrigger(t);
  }
}

/** Trigger target: resume the active scan job. */
export function continueJob(_e?: unknown): void {
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
    }
    // PERSISTING is crash territory — recoverIfNeeded() handles it on the next write.
  }, 120_000);
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
