// Sheets/Drive orchestration of the pure ledger core: load LedgerState, run the
// in-memory operation, write the state back with commit-record ordering.
//
// Persist write order (the SQLite-transaction replacement):
//   1. idempotency check by scan_id (scans tab)
//   2. journal backup of the current state to Drive + jobs row -> PERSISTING
//   3. reconcile in memory (ledger read from the Drive snapshot fast path)
//   4. vuln_ledger + episodes wholesale rewrite; obs file to Drive; snapshot rewrite
//   5. LAST: append the scans row — the commit. No scans row => the scan never happened
//      and recoverIfNeeded() rolls the tabs back from the journal.

import type { Checkpoint } from "../domain/compaction";
import {
  baseRows,
  emptyState,
  latestScan,
  persistFlatScan as coreFlat,
  persistGroupedScan as coreGrouped,
  scansAsc,
  severityCountsFromObservations,
  type BaseRow,
  type LedgerState,
  type ScanRow,
} from "../domain/ledgerCore";
import {
  compactLedgerCore,
  compactionRow,
  deleteScansCore,
  recordsFromPayload,
  type CompactionResult,
  type DeleteResult,
} from "../domain/maintenance";
import type { Deltas, LedgerRow } from "../domain/reconcile";
import { trendFromFrames, type TrendPoint } from "../domain/trend";
import { nowIso, type Rec } from "../domain/util";
import * as archive from "./archiveStore";
import { createJob, newJobId, updateJob } from "./jobsStore";
import { appendRows, overwrite, readAll, TABS } from "./sheetsDb";

// ------------------------------------------------------------------ state load/save

function rowToScan(r: Rec): ScanRow {
  return {
    scan_id: String(r["scan_id"] ?? ""),
    ts: String(r["ts"] ?? ""),
    mode: String(r["mode"] ?? ""),
    shape: (r["shape"] === "grouped" ? "grouped" : "flat") as "flat" | "grouped",
    total: Number(r["total"] ?? 0),
    new_count: Number(r["new_count"] ?? 0),
    resolved_count: Number(r["resolved_count"] ?? 0),
    reopened_count: Number(r["reopened_count"] ?? 0),
    raw_ref: (r["raw_ref"] as string | null) ?? null,
    obs_ref: (r["obs_ref"] as string | null) ?? null,
    severities: (r["severities"] as string | null) ?? null,
    sealed: r["sealed"] === 1 || r["sealed"] === "1" || r["sealed"] === true ? 1 : 0,
  };
}

function rowToLedger(r: Rec): LedgerRow {
  return {
    vuln_key: String(r["vuln_key"] ?? ""),
    cve: (r["cve"] as string | null) ?? null,
    severity: (r["severity"] as string | null) ?? null,
    asset_id: (r["asset_id"] as string | null) ?? null,
    asset_name: (r["asset_name"] as string | null) ?? null,
    asset_type: (r["asset_type"] as string | null) ?? null,
    cloud: (r["cloud"] as string | null) ?? null,
    first_seen: (r["first_seen"] as string | null) ?? null,
    last_seen: (r["last_seen"] as string | null) ?? null,
    status: String(r["status"] ?? "OPEN"),
    resolved_at: (r["resolved_at"] as string | null) ?? null,
    resolution_src: (r["resolution_src"] as string | null) ?? null,
    reopened_count: Number(r["reopened_count"] ?? 0),
    first_scan_id: (r["first_scan_id"] as string | null) ?? null,
    last_scan_id: (r["last_scan_id"] as string | null) ?? null,
    subscription_name: (r["subscription_name"] as string | null) ?? null,
    subscription_ext_id: (r["subscription_ext_id"] as string | null) ?? null,
    tags_json: (r["tags_json"] as string | null) ?? null,
  };
}

/** Scans tab only (cheap; enough for history/meta reads). */
export function loadScanRows(): ScanRow[] {
  return scansAsc(readAll(TABS.scans).map(rowToScan));
}

export function scanRowExists(scanId: string): boolean {
  return readAll(TABS.scans).some((r) => r["scan_id"] === scanId);
}

/**
 * Full state. The ledger/episodes come from the Drive snapshot when present (one
 * gzip read instead of a 100k-row getValues); the tabs are the fallback and heal
 * the snapshot on the next write.
 */
export function loadState(useSnapshot = true): LedgerState {
  const state = emptyState();
  state.scans = loadScanRows();
  if (useSnapshot) {
    const snap = archive.readLedgerSnapshot();
    if (snap) {
      state.ledger = snap.ledger;
      state.episodes = snap.episodes;
      return state;
    }
  }
  for (const r of readAll(TABS.vulnLedger)) {
    const row = rowToLedger(r);
    state.ledger[row.vuln_key] = row;
  }
  state.episodes = readAll(TABS.episodes).map((r) => ({
    vuln_key: String(r["vuln_key"] ?? ""),
    cve: (r["cve"] as string | null) ?? null,
    severity: (r["severity"] as string | null) ?? null,
    first_seen: (r["first_seen"] as string | null) ?? null,
    resolved_at: (r["resolved_at"] as string | null) ?? null,
    resolution_src: (r["resolution_src"] as string | null) ?? null,
    reopened_count: Number(r["reopened_count"] ?? 0),
    compaction_id: String(r["compaction_id"] ?? ""),
    superseded_by_scan: (r["superseded_by_scan"] as string | null) ?? null,
  }));
  return state;
}

/** Wholesale rewrite of vuln_ledger + episodes + scans (used by recovery/replay). */
export function writeStateTables(state: LedgerState): void {
  overwrite(TABS.vulnLedger, Object.values(state.ledger) as unknown as Rec[]);
  overwrite(TABS.episodes, state.episodes as unknown as Rec[]);
  overwrite(TABS.scans, scansAsc(state.scans) as unknown as Rec[]);
  archive.writeLedgerSnapshot(state);
}

// ------------------------------------------------------------------------- persist

export interface PersistOutcome {
  deltas: Deltas;
  scanRow: ScanRow | null;
}

/**
 * Persist a flat scan (records already fetched; raw pages already archived under
 * rawRef). Runs the journaled commit-record sequence described in the header.
 */
export function persistFlatScan(
  records: Rec[],
  options: {
    mode: string;
    scanId?: string | null;
    scannedSeverities?: string[] | null;
    rawRef?: string | null;
    jobId?: string | null;
  },
): PersistOutcome {
  const state = loadState();
  const scanId = options.scanId || nowIso();
  const existing = state.scans.find((s) => s.scan_id === scanId);
  if (existing) {
    return {
      deltas: {
        new_count: existing.new_count,
        resolved_count: existing.resolved_count,
        reopened_count: existing.reopened_count,
      },
      scanRow: null,
    };
  }

  const jobId = options.jobId ?? newJobId("scan");
  const journalRef = archive.writeJournal(jobId, state);
  if (options.jobId) {
    updateJob(jobId, { phase: "PERSISTING", scan_id: scanId, journal_ref: journalRef });
  } else {
    createJob({
      job_id: jobId,
      kind: "scan",
      phase: "PERSISTING",
      scan_id: scanId,
      cursor: null,
      page: 0,
      findings_so_far: records.length,
      page_size: 0,
      total_count: 0,
      params_json: null,
      journal_ref: journalRef,
      error: null,
    });
  }

  const { deltas, observations, scanRow } = coreFlat(state, records, {
    mode: options.mode,
    scanId,
    scannedSeverities: options.scannedSeverities ?? null,
    rawRef: options.rawRef ?? null,
  });
  const obsRef = archive.writeObservations(scanId, observations);
  if (scanRow) scanRow.obs_ref = obsRef;

  // 4. Wholesale rewrites (episodes may carry new supersessions from collisions).
  overwrite(TABS.vulnLedger, Object.values(state.ledger) as unknown as Rec[]);
  overwrite(TABS.episodes, state.episodes as unknown as Rec[]);
  archive.writeLedgerSnapshot(state);

  // 5. Commit: the scans row lands last.
  if (scanRow) appendRows(TABS.scans, [scanRow as unknown as Rec]);

  updateJob(jobId, { phase: "DONE" });
  archive.trashFile(journalRef);
  return { deltas, scanRow };
}

/** Persist a grouped scan (archive + scans row only; zero deltas). */
export function persistGroupedScan(
  nodes: unknown[],
  options: {
    mode: string;
    scanId?: string | null;
    scannedSeverities?: string[] | null;
    rawRef?: string | null;
  },
): PersistOutcome {
  const state = loadState();
  const { deltas, scanRow } = coreGrouped(state, nodes, {
    mode: options.mode,
    scanId: options.scanId ?? null,
    scannedSeverities: options.scannedSeverities ?? null,
    rawRef: options.rawRef ?? null,
  });
  if (scanRow) appendRows(TABS.scans, [scanRow as unknown as Rec]);
  return { deltas, scanRow };
}

// ------------------------------------------------------------------------- readers

const readPayloadForRow = (row: ScanRow): unknown | null =>
  archive.readScanPayload(row.raw_ref);

export function loadBaseRows(now?: number): BaseRow[] {
  return baseRows(loadState(), now);
}

export function loadTrend(severities: string[] | null = null): TrendPoint[] {
  const state = loadState();
  return trendFromFrames(
    state.scans.map((s) => ({ ts: s.ts, shape: s.shape })),
    baseRows(state).map((r) => ({
      severity: r.severity,
      first_seen: r.first_seen,
      resolved_at: r.resolved_at,
      mttr_days: r.mttr_days,
    })),
    severities,
  );
}

/** Per-severity counts of the second-newest flat scan (change-badge baseline). */
export function previousSeverityCounts(): Record<string, number> {
  const flats = loadScanRows().filter((s) => s.shape === "flat");
  if (flats.length < 2) return {};
  const prev = flats[flats.length - 2];
  return severityCountsFromObservations(archive.readObservations(prev.obs_ref));
}

export function latestScanRow(): ScanRow | null {
  return latestScan(loadScanRows());
}

export function latestFlatScanRow(): ScanRow | null {
  const flats = loadScanRows().filter((s) => s.shape === "flat");
  return flats.length ? flats[flats.length - 1] : null;
}

function latestCheckpoint(): Checkpoint | null {
  const rows = readAll(TABS.compactions).filter((r) => r["checkpoint_ref"]);
  if (!rows.length) return null;
  rows.sort((a, b) => (String(a["ts"]) < String(b["ts"]) ? 1 : -1));
  return archive.readCheckpoint(rows[0]["checkpoint_ref"] as string);
}

// -------------------------------------------------------------------------- delete

/** Journaled delete-scans with survivor replay (ledger.delete_scans semantics). */
export function deleteScans(scanIds: string[], jobId?: string): DeleteResult {
  const state = loadState();
  const checkpoint = latestCheckpoint();

  // Validation happens inside the core BEFORE any mutation; a validation throw
  // (SealedScanError / LedgerRebuildError) leaves the tabs untouched.
  const jid = jobId ?? newJobId("delete");
  const { state: rebuilt, result, observationsByScan } = deleteScansCore(
    state,
    scanIds,
    readPayloadForRow,
    checkpoint,
  );
  if (!result.deleted) return result;

  const journalRef = archive.writeJournal(jid, state);
  if (jobId) {
    updateJob(jid, { phase: "REPLAYING", journal_ref: journalRef });
  } else {
    createJob({
      job_id: jid,
      kind: "delete",
      phase: "REPLAYING",
      scan_id: null,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: JSON.stringify({ scanIds }),
      journal_ref: journalRef,
      error: null,
    });
  }

  // Regenerate replayed scans' obs files, then rewrite everything wholesale.
  for (const row of rebuilt.scans) {
    const obs = observationsByScan[row.scan_id];
    if (obs) row.obs_ref = archive.writeObservations(row.scan_id, obs);
  }
  writeStateTables(rebuilt);

  updateJob(jid, { phase: "DONE" });
  archive.trashFile(journalRef);

  // Post-commit: trash the deleted scans' archives + obs files (best-effort).
  const survivorRefs = new Set(rebuilt.scans.map((r) => r.raw_ref).filter(Boolean));
  for (const r of state.scans) {
    if (rebuilt.scans.some((s) => s.scan_id === r.scan_id)) continue;
    if (r.raw_ref && !survivorRefs.has(r.raw_ref)) archive.trashScanArchive(r.raw_ref);
    archive.trashFile(r.obs_ref);
  }
  return result;
}

// -------------------------------------------------------------------------- compact

/** Journaled compaction (ledger.compact_ledger semantics; checkpoint on Drive). */
export function compactLedger(
  retentionDays: number | null,
  dryRun = false,
  now?: number,
): CompactionResult {
  const state = loadState();
  const prevCheckpoint = latestCheckpoint();
  const nowMs = now ?? Date.now();
  const compactionId = `cmp-${nowIso(nowMs).replace(/[:]/g, "")}`;

  // Preview accounting: obs counts + archive sizes of the would-be sealed scans.
  // Cheap two-pass approach — plan once without accounting to learn the candidates,
  // then attach exact numbers (the plan is deterministic).
  const probe = compactLedgerCore(state, retentionDays, prevCheckpoint, readPayloadForRow, {
    dryRun: true,
    now: nowMs,
    compactionId,
  });
  if (probe.result.no_op) return probe.result;
  const obsCountByScan: Record<string, number> = {};
  let archiveBytes = 0;
  for (const r of probe.newly) {
    obsCountByScan[r.scan_id] = archive.readObservations(r.obs_ref).length;
    archiveBytes += archive.scanArchiveBytes(r.raw_ref, null);
  }

  const plan = compactLedgerCore(state, retentionDays, prevCheckpoint, readPayloadForRow, {
    dryRun,
    now: nowMs,
    compactionId,
    obsCountByScan,
    archiveBytes,
  });
  if (dryRun || plan.state === null) return plan.result;

  const jobId = newJobId("compact", nowMs);
  const journalRef = archive.writeJournal(jobId, state);
  createJob(
    {
      job_id: jobId,
      kind: "compact",
      phase: "PERSISTING",
      scan_id: null,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: JSON.stringify({ retentionDays }),
      journal_ref: journalRef,
      error: null,
    },
    nowMs,
  );

  // Only the latest compaction keeps a checkpoint blob (each floor supersedes the
  // previous); older rows keep their stats but lose the ref.
  const checkpointRef = archive.writeCheckpoint(compactionId, plan.checkpoint!);
  const compactions: Rec[] = readAll(TABS.compactions).map((r) => ({
    ...r,
    checkpoint_ref: null,
  }));
  compactions.push(compactionRow(plan, checkpointRef, nowMs));
  overwrite(TABS.compactions, compactions);

  writeStateTables(plan.state);
  updateJob(jobId, { phase: "DONE" }, nowMs);
  archive.trashFile(journalRef);

  // Post-commit: prune the sealed scans' raw archives + obs files (best-effort).
  let freed = 0;
  for (const r of plan.newly) {
    freed += archive.scanArchiveBytes(r.raw_ref, r.obs_ref);
    archive.trashScanArchive(r.raw_ref);
    archive.trashFile(r.obs_ref);
  }
  plan.result.archive_bytes_freed = freed;
  return plan.result;
}
