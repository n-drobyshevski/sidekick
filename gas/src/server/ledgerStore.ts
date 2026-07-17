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
  importBundleCore,
  ImportValidationError,
  type ImportCounts,
  type MigrationBundle,
} from "../domain/importMerge";
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
import {
  applyShardCore,
  beginImportSession,
  checkpointManifest,
  type BeganSession,
} from "../domain/importShard";
import {
  type BackfilledTrendPoint,
  cohortSlaAttainment,
  trendFromBase,
  withKmMedian,
  withOpenPastSla,
  withSlaBurn,
} from "../domain/trend";
import { nowIso, type Rec } from "../domain/util";
import * as archive from "./archiveStore";
import * as history from "./historyStore";
import { activeJob, createJob, getJob, newJobId, updateJob } from "./jobsStore";
import { bumpDataVersion } from "./serverCache";
import { appendRows, dataRowCount, overwrite, readAll, truncateAfter, TABS } from "./sheetsDb";

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
    fix_date: (r["fix_date"] as string | null) ?? null,
    fix_observed_at: (r["fix_observed_at"] as string | null) ?? null,
  };
}

// Per-execution memos. A single request hits loadScanRows()/loadState() several
// times (bootstrap alone reads scans 3×); module state dies with the execution, so
// memoizing is free of cross-request staleness. Every write path below calls
// invalidateLedgerMemos() after touching the tabs/snapshot so reads-after-write
// inside the same execution (recovery, mutation endpoints) see fresh data.
let scanRowsMemo: ScanRow[] | undefined;
let stateMemo: LedgerState | undefined;

export function invalidateLedgerMemos(): void {
  scanRowsMemo = undefined;
  stateMemo = undefined;
  // Every ledger write also stales the cross-request derived caches.
  bumpDataVersion();
}

/** Scans tab only (cheap; enough for history/meta reads). */
export function loadScanRows(): ScanRow[] {
  if (scanRowsMemo === undefined) {
    scanRowsMemo = scansAsc(readAll(TABS.scans).map(rowToScan));
  }
  return scanRowsMemo;
}

export function scanRowExists(scanId: string): boolean {
  return loadScanRows().some((s) => s.scan_id === scanId);
}

/**
 * Full state. The ledger/episodes come from the Drive snapshot when present (one
 * gzip read instead of a 100k-row getValues); the tabs are the fallback and heal
 * the snapshot on the next write.
 */
export function loadState(useSnapshot = true): LedgerState {
  if (useSnapshot && stateMemo !== undefined) return stateMemo;
  const state = emptyState();
  // Sliced so a mutation core pushing its new scan row never grows the memoized array.
  state.scans = loadScanRows().slice();
  if (useSnapshot) {
    const snap = archive.readLedgerSnapshot();
    if (snap) {
      state.ledger = snap.ledger;
      state.episodes = snap.episodes;
      stateMemo = state;
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
    fix_date: (r["fix_date"] as string | null) ?? null,
    fix_observed_at: (r["fix_observed_at"] as string | null) ?? null,
  }));
  if (useSnapshot) stateMemo = state;
  return state;
}

/** Wholesale rewrite of vuln_ledger + episodes + scans (used by recovery/replay). */
export function writeStateTables(state: LedgerState): void {
  overwrite(TABS.vulnLedger, Object.values(state.ledger) as unknown as Rec[]);
  overwrite(TABS.episodes, state.episodes as unknown as Rec[]);
  overwrite(TABS.scans, scansAsc(state.scans) as unknown as Rec[]);
  archive.writeLedgerSnapshot(state);
  invalidateLedgerMemos();
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
  invalidateLedgerMemos();

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
  if (scanRow) {
    appendRows(TABS.scans, [scanRow as unknown as Rec]);
    invalidateLedgerMemos();
  }
  return { deltas, scanRow };
}

// ------------------------------------------------------------------------- readers

const readPayloadForRow = (row: ScanRow): unknown | null =>
  archive.readScanPayload(row.raw_ref);

export function loadBaseRows(now?: number): BaseRow[] {
  return baseRows(loadState(), now);
}

export function loadTrend(
  severities: string[] | null = null,
  // When false (the global "show findings without a vendor fix" toggle is off) the open /
  // KM-median series exclude findings awaiting a vendor fix as of each historical date; a
  // fix that lands later re-admits the row at that point (see trend.awaitingFixAsOf). The
  // resolved / median / SLA-burn / attainment series are untouched. Default true = today.
  showNoFix = true,
): BackfilledTrendPoint[] {
  const state = loadState();
  const hideNoFix = !showNoFix;
  // Backfill on: reconstruct pre-first-scan trend points from findings' first-seen dates so
  // the trend reaches back to the earliest detection, not just the first saved scan. The
  // compaction gate (maintenance.trendOf) deliberately keeps calling trendFromFrames instead,
  // so its before/after identity check stays anchored to real scans only.
  const base = baseRows(state).map((r) => ({
    severity: r.severity,
    first_seen: r.first_seen,
    resolved_at: r.resolved_at,
    mttr_days: r.mttr_days,
    // actionable_from feeds the actionable-clock open-past-SLA plus the SLA-burn / cohort-
    // attainment decorators below (deadline = actionable_from + severity target).
    actionable_from: r.actionable_from,
    // fix_available_at feeds the as-of no-fix exclusion in the open / KM-median series when
    // the show-no-fix toggle is off (hideNoFix); ignored on the default path.
    fix_available_at: r.fix_available_at,
  }));
  const points = trendFromBase(
    state.scans.map((s) => ({ ts: s.ts, shape: s.shape })),
    base,
    severities,
    { backfill: true, hideNoFix },
  );
  // Augment every point (real + reconstructed) with the series the resolved-only headline
  // hides, all from the same scoped base rows:
  //   - open-past-SLA measured from vendor-fix availability (actionable_from), so it matches
  //     the page's actionable metric and drops awaiting-vendor-fix rows (null actionable_from);
  //   - the SLA-burn net flow and the cohort SLA attainment (backlog-flow metrics);
  //   - the as-of Kaplan–Meier median ("KM median trend"), the censoring-aware replacement for
  //     the old "MTTR excl. fast lane" series.
  const withSla = withOpenPastSla(points, base, severities, "actionable_from");
  const withBurn = withSlaBurn(withSla, base, severities);
  const withAttainment = cohortSlaAttainment(withBurn, base, severities);
  return withKmMedian(withAttainment, base, severities, { hideNoFix });
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

// -------------------------------------------------------------------------- import

/**
 * Merge a legacy Streamlit migration bundle into the ledger (journaled, one-shot).
 * Imported scans arrive sealed with no raw archives; a synthetic compaction
 * checkpoint pins them as the rebuild baseline, and the existing GAS scans are
 * replayed over the imported history (see domain/importMerge.ts).
 */
export function importBundle(bundle: MigrationBundle): ImportCounts {
  const state = loadState();
  if (readAll(TABS.compactions).length) {
    throw new ImportValidationError(
      "This ledger already has a compaction record (a prior compaction or import) — " +
        "the one-shot migration import needs a never-compacted ledger.",
    );
  }
  const nowMs = Date.now();
  const compactionId = `imp-${nowIso(nowMs).replace(/[:]/g, "")}`;

  // Pure merge first: every validation throw lands BEFORE any tab/Drive write.
  const { state: merged, checkpoint, observationsByScan, counts } = importBundleCore(
    state,
    bundle,
    readPayloadForRow,
    { compactionId },
  );
  if (!counts.scans_imported && !counts.vulns_imported && !counts.episodes_imported) {
    return counts;
  }

  const jobId = newJobId("import", nowMs);
  const journalRef = archive.writeJournal(jobId, state);
  createJob(
    {
      job_id: jobId,
      kind: "import",
      phase: "REPLAYING",
      scan_id: null,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: JSON.stringify({
        scans: counts.scans_imported,
        vulns: counts.vulns_imported,
        episodes: counts.episodes_imported,
      }),
      journal_ref: journalRef,
      error: null,
    },
    nowMs,
  );

  // Regenerate the replayed GAS scans' obs files (imported scans stay obs-less).
  for (const row of merged.scans) {
    const obs = observationsByScan[row.scan_id];
    if (obs) row.obs_ref = archive.writeObservations(row.scan_id, obs);
  }

  // The synthetic compaction record — without it, delete-rebuild would replay from
  // nothing and silently drop every imported ledger row.
  const checkpointRef = archive.writeCheckpoint(compactionId, checkpoint);
  appendRows(TABS.compactions, [
    {
      compaction_id: compactionId,
      ts: nowIso(nowMs),
      floor_scan_id: checkpoint.floor_scan_id,
      floor_ts: checkpoint.floor_ts,
      scans_sealed: counts.scans_imported,
      episodes_created: counts.episodes_imported + counts.episodes_converted,
      observations_pruned: 0,
      archive_bytes_freed: 0,
      db_bytes_freed: 0,
      checkpoint_ref: checkpointRef,
    },
  ]);

  writeStateTables(merged);
  updateJob(jobId, { phase: "DONE" }, nowMs);
  archive.trashFile(journalRef);
  return counts;
}

// ------------------------------------------------------------- sharded (multi-part) import
//
// For a FRESH ledger the merge is per-row (see domain/importShard.ts), so a bundle too big
// for the one-shot path is uploaded as capped shards and rebuilt across several bounded
// executions: begin (guard + stage manifest) → applyShard × N (chunked appends, resumable
// by committed row counts) → finalize (append scans + the single compaction record = the
// commit + best-effort snapshot). No execution ever holds the whole dataset or does a
// wholesale rewrite. The one-shot importBundle path above is untouched.

const APPEND_CHUNK = 5000; // rows per setValues, well under Sheets per-call limits

interface ImportSessionState {
  sessionId: string;
  compactionId: string;
  shardCount: number;
  appliedShards: number;
  ledgerCommitted: number;
  episodesCommitted: number;
  partIds: string[];
  floorScanId: string | null;
  floorTs: string | null;
  sealedIds: string[];
  scansTotal: number;
  counts: {
    vulns_imported: number;
    episodes_imported: number;
    episodes_converted: number;
    unclassified_severity: number;
  };
}

function importJobState(job: { params_json: string | null }): ImportSessionState {
  return JSON.parse(job.params_json ?? "{}") as ImportSessionState;
}

function activeImportJob(sessionId?: string) {
  const job = activeJob();
  if (!job || job.kind !== "import") return null;
  const st = importJobState(job);
  if (sessionId !== undefined && st.sessionId !== sessionId) return null;
  return { job, st };
}

function chunkedAppend(tab: string, rows: Rec[]): void {
  for (let i = 0; i < rows.length; i += APPEND_CHUNK) {
    appendRows(tab, rows.slice(i, i + APPEND_CHUNK));
  }
}

export interface ImportProgress {
  sessionId: string;
  jobId: string;
  shardCount: number;
  appliedShards: number;
}

/** Start (or resume) a sharded import. Guards a fresh ledger, stages the manifest, opens the job. */
export function importBeginSharded(rawManifest: unknown): ImportProgress {
  // Already staging this or another import → resume (idempotent begin).
  const existing = activeImportJob();
  if (existing) {
    return {
      sessionId: existing.st.sessionId, jobId: existing.job.job_id,
      shardCount: existing.st.shardCount, appliedShards: existing.st.appliedShards,
    };
  }
  if (loadScanRows().length || readAll(TABS.compactions).length) {
    throw new ImportValidationError(
      "This ledger already has scans or a compaction record — the migration import needs a " +
        "fresh, never-compacted ledger.",
    );
  }

  const session: BeganSession = beginImportSession(rawManifest);
  const nowMs = Date.now();
  const compactionId = `imp-${nowIso(nowMs).replace(/[:]/g, "")}`;
  const sessionId = session.manifest.session_id || newJobId("import", nowMs);

  // Clear any leftover rows from a crashed prior session and stale snapshot.
  overwrite(TABS.vulnLedger, []);
  overwrite(TABS.episodes, []);
  archive.trashLedgerSnapshot();

  archive.writeImportManifest(sessionId, {
    scans: session.manifest.scans,
    mttr_history: session.manifest.mttr_history,
    compactionId, floorScanId: session.floorScanId, floorTs: session.floorTs,
    shardCount: session.manifest.shard_count,
  });

  const jobId = newJobId("import", nowMs);
  const st: ImportSessionState = {
    sessionId, compactionId, shardCount: session.manifest.shard_count,
    appliedShards: 0, ledgerCommitted: 0, episodesCommitted: 0, partIds: [],
    floorScanId: session.floorScanId, floorTs: session.floorTs,
    sealedIds: [...session.sealedIds], scansTotal: session.sealedScans.length,
    counts: { vulns_imported: 0, episodes_imported: 0, episodes_converted: 0, unclassified_severity: 0 },
  };
  createJob(
    {
      job_id: jobId, kind: "import", phase: "STAGING", scan_id: null, cursor: null,
      page: 0, findings_so_far: 0, page_size: 0, total_count: session.manifest.shard_count,
      params_json: JSON.stringify(st), journal_ref: null, error: null,
    },
    nowMs,
  );
  invalidateLedgerMemos();
  return { sessionId, jobId, shardCount: st.shardCount, appliedShards: 0 };
}

/** Apply one shard's rows (chunked appends). Idempotent + resumable by committed counts. */
export function importApplyShard(
  sessionId: string, index: number, shard: { ledger?: Rec[]; episodes?: Rec[] },
): ImportProgress {
  const active = activeImportJob(sessionId);
  if (!active) throw new ImportValidationError("No active import session — begin the import first.");
  const { job } = active;
  const st = active.st;

  if (index < st.appliedShards) {
    // Already applied (client retry) — no-op.
    return { sessionId, jobId: job.job_id, shardCount: st.shardCount, appliedShards: st.appliedShards };
  }
  if (index !== st.appliedShards) {
    throw new ImportValidationError(
      `Shards must arrive in order — expected shard ${st.appliedShards}, got ${index}.`,
    );
  }

  // Roll back a half-applied append from a crash before re-applying (exactly-once).
  if (dataRowCount(TABS.vulnLedger) > st.ledgerCommitted) truncateAfter(TABS.vulnLedger, st.ledgerCommitted);
  if (dataRowCount(TABS.episodes) > st.episodesCommitted) truncateAfter(TABS.episodes, st.episodesCommitted);

  archive.stageShard(sessionId, index, shard); // durable before applying

  const out = applyShardCore(shard, {
    sealedIds: new Set(st.sealedIds), compactionId: st.compactionId,
  });
  chunkedAppend(TABS.vulnLedger, out.ledgerRows as unknown as Rec[]);
  chunkedAppend(TABS.episodes, out.episodeRows as unknown as Rec[]);
  const partId = archive.writeCheckpointPart(st.compactionId, index, out.checkpointRows);

  const next: ImportSessionState = {
    ...st,
    appliedShards: index + 1,
    ledgerCommitted: st.ledgerCommitted + out.ledgerRows.length,
    episodesCommitted: st.episodesCommitted + out.episodeRows.length,
    partIds: [...st.partIds, partId],
    counts: {
      vulns_imported: st.counts.vulns_imported + out.vulnsImported,
      episodes_imported: st.counts.episodes_imported + out.episodesImported,
      episodes_converted: st.counts.episodes_converted + out.episodesConverted,
      unclassified_severity: st.counts.unclassified_severity + out.unclassifiedSeverity,
    },
  };
  updateJob(job.job_id, { phase: "APPLYING", params_json: JSON.stringify(next) });
  invalidateLedgerMemos();
  return { sessionId, jobId: job.job_id, shardCount: st.shardCount, appliedShards: next.appliedShards };
}

/** Commit the import: append sealed scans + the single compaction record, merge history. */
export function importFinalizeSharded(sessionId: string): ImportCounts & {
  history_added: number;
  history_skipped: number;
} {
  const active = activeImportJob(sessionId);
  if (!active) throw new ImportValidationError("No active import session to finalize.");
  const { job } = active;
  const st = active.st;
  if (st.appliedShards !== st.shardCount) {
    throw new ImportValidationError(
      `Import incomplete — ${st.appliedShards} of ${st.shardCount} shards applied.`,
    );
  }
  updateJob(job.job_id, { phase: "FINALIZING" });

  // Re-derive the sealed scans + full history from the staged manifest (small).
  const rawManifest = archive.readImportManifest(sessionId) as Rec | null;
  const session = beginImportSession({
    kind: "wiz-sidekick-migration-manifest", version: 1, shard_count: st.shardCount,
    session_id: sessionId, scans: (rawManifest?.["scans"] as Rec[]) ?? [],
    mttr_history: (rawManifest?.["mttr_history"] as Rec[]) ?? [],
    totals: { ledger: 0, episodes: 0 },
  });

  // Append sealed scans (dedup for finalize-resume).
  const present = new Set(loadScanRows().map((s) => s.scan_id));
  const toAppend = session.sealedScans.filter((s) => !present.has(s.scan_id));
  chunkedAppend(TABS.scans, toAppend as unknown as Rec[]);
  invalidateLedgerMemos();

  // Checkpoint manifest stitching the parts, then THE COMMIT (idempotent).
  const cpRef = archive.writeCheckpointManifest(
    st.compactionId, checkpointManifest(st.floorScanId, st.floorTs, st.partIds),
  );
  if (readAll(TABS.compactions).length === 0) {
    appendRows(TABS.compactions, [
      {
        compaction_id: st.compactionId, ts: nowIso(),
        floor_scan_id: st.floorScanId, floor_ts: st.floorTs,
        scans_sealed: st.scansTotal,
        episodes_created: st.counts.episodes_imported + st.counts.episodes_converted,
        observations_pruned: 0, archive_bytes_freed: 0, db_bytes_freed: 0,
        checkpoint_ref: cpRef,
      },
    ]);
  }

  const hist = history.importHistory((rawManifest?.["mttr_history"] as Rec[]) ?? []);

  // Best-effort snapshot from the tabs (the one whole-ledger serialize; safe if it OOMs —
  // loadState falls back to the tabs and the first post-import scan heals it).
  try {
    archive.writeLedgerSnapshot(loadState(false));
  } catch (e) {
    console.warn(`Post-import snapshot skipped: ${e}`);
  }
  invalidateLedgerMemos();
  updateJob(job.job_id, { phase: "DONE" });
  archive.trashImportSession(sessionId);

  return {
    scans_imported: st.scansTotal, scans_skipped: 0,
    vulns_imported: st.counts.vulns_imported,
    episodes_imported: st.counts.episodes_imported,
    episodes_converted: st.counts.episodes_converted,
    scans_replayed: 0,
    unclassified_severity: st.counts.unclassified_severity,
    history_added: hist.added, history_skipped: hist.skipped,
  };
}

/** Abandon a sharded import: clear the partial rows and the session. */
export function importAbortSharded(sessionId: string): { aborted: boolean } {
  const active = activeImportJob(sessionId);
  overwrite(TABS.vulnLedger, []);
  overwrite(TABS.episodes, []);
  archive.trashLedgerSnapshot();
  archive.trashImportSession(sessionId);
  invalidateLedgerMemos();
  if (active) updateJob(active.job.job_id, { phase: "CANCELLED", error: null });
  return { aborted: true };
}

// --------------------------------------------------------------------------- reset

export interface ResetCounts {
  scans: number;
  vulns: number;
  episodes: number;
  compactions: number;
}

/**
 * Return the ledger to a fresh, never-compacted state so a migration import can run.
 *
 * The sharded import (importBeginSharded) requires an empty ledger, and any scan — live or
 * dry-run — leaves a scans row, so there's otherwise no way back to a fresh ledger. This
 * clears the scans / vuln_ledger / resolved_episodes / compactions / jobs tabs and trashes
 * the fast-read snapshot. Clearing `jobs` drops any stuck scan/import job: activeImportJob()
 * then returns null (so the next importBeginSharded runs its guard rather than "resuming" a
 * phantom session), and a stray continuation trigger fires once, finds no active job in
 * continueJob(), and self-deletes. Drive raw archives (scans/obs/checkpoints) are left in
 * place — harmless scan-id-keyed orphans that no remaining row references.
 */
export function resetLedger(): ResetCounts {
  const counts: ResetCounts = {
    scans: loadScanRows().length,
    vulns: dataRowCount(TABS.vulnLedger),
    episodes: dataRowCount(TABS.episodes),
    compactions: readAll(TABS.compactions).length,
  };
  overwrite(TABS.scans, []);
  overwrite(TABS.vulnLedger, []);
  overwrite(TABS.episodes, []);
  overwrite(TABS.compactions, []);
  overwrite(TABS.jobs, []);
  archive.trashLedgerSnapshot();
  invalidateLedgerMemos();
  return counts;
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
