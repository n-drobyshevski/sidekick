// Pure delete-replay and compaction flows over LedgerState — the ports of
// ledger.delete_scans and ledger.compact_ledger with all I/O injected: archived
// payloads arrive through a reader callback, checkpoint blobs through parameters,
// and the caller applies the returned state/artifacts to Sheets/Drive.

import { RETENTION_MIN_DAYS } from "./config";
import {
  Checkpoint,
  CHECKPOINT_VERSION,
  parseSeverities,
  selectSealCandidates,
  statsEqual,
} from "./compaction";
import {
  baseRows,
  emptyState,
  persistFlatScan,
  persistGroupedScan,
  reinsertScanRow,
  scansAsc,
  type EpisodeRow,
  type LedgerState,
  type ScanRow,
} from "./ledgerCore";
import { mttrFromLedger } from "./lifecycle";
import type { LedgerRow, Observation } from "./reconcile";
import { extractNodes } from "./transform";
import { trendFromFrames } from "./trend";
import { nowIso, parseTs, type Rec } from "./util";

export class LedgerRebuildError extends Error {}
export class SealedScanError extends LedgerRebuildError {}

/** Reads a scan's archived payload; null when missing/unreadable. */
export type PayloadReader = (row: ScanRow) => unknown | null;

/** Raw nested nodes from an archived payload (ledger._records_from_payload). */
export function recordsFromPayload(payload: unknown): Rec[] {
  return extractNodes(payload) ?? [];
}

export interface ReplayItem {
  row: ScanRow;
  payload: unknown | null;
}

/**
 * Pre-load + validate every UNSEALED row's payload BEFORE the caller mutates
 * anything. A flat scan with a missing payload throws LedgerRebuildError with
 * `missingMsg(scanId)` as the message.
 */
export function loadReplayPayloads(
  rows: ScanRow[],
  readPayload: PayloadReader,
  missingMsg: (scanId: string) => string,
): ReplayItem[] {
  const replay: ReplayItem[] = [];
  for (const r of rows) {
    if (r.sealed) continue;
    const payload = readPayload(r);
    if (payload === null && r.shape === "flat") {
      throw new LedgerRebuildError(missingMsg(r.scan_id));
    }
    replay.push({ row: r, payload });
  }
  return replay;
}

/**
 * Replay pre-validated scans into `rebuilt` in the given order, re-running the
 * persist writers. Returns each replayed flat scan's observations (for the caller
 * to re-write obs files).
 */
export function replayScans(
  rebuilt: LedgerState,
  replay: ReplayItem[],
): Record<string, Observation[]> {
  const observationsByScan: Record<string, Observation[]> = {};
  for (const { row, payload } of replay) {
    if (row.shape === "grouped") {
      if (payload === null) {
        // Grouped scans don't affect the ledger; the stored row alone is faithful.
        reinsertScanRow(rebuilt, row);
      } else {
        persistGroupedScan(rebuilt, extractNodes(payload), {
          mode: row.mode,
          scanId: row.scan_id,
          scannedSeverities: parseSeverities(row.severities),
          rawRef: row.raw_ref,
        });
      }
    } else {
      const { observations } = persistFlatScan(rebuilt, recordsFromPayload(payload), {
        mode: row.mode,
        scanId: row.scan_id,
        scannedSeverities: parseSeverities(row.severities),
        rawRef: row.raw_ref,
        obsRef: row.obs_ref,
      });
      observationsByScan[row.scan_id] = observations;
    }
  }
  return observationsByScan;
}

/**
 * Live ledger rows that roll into resolved_episodes at a seal floor: only
 * checkpoint-RESOLVED rows whose live state is untouched post-floor — still
 * RESOLVED with the same resolved_at, last seen by a sealed scan.
 */
export function settledEpisodeRows(
  checkpointLedger: LedgerRow[],
  ledger: Record<string, LedgerRow>,
  sealedIds: Set<string>,
): LedgerRow[] {
  const episodes: LedgerRow[] = [];
  for (const cpRow of checkpointLedger) {
    if (cpRow.status !== "RESOLVED") continue;
    const live = ledger[cpRow.vuln_key];
    if (
      live === undefined ||
      live.status !== "RESOLVED" ||
      live.resolved_at !== cpRow.resolved_at ||
      !sealedIds.has(live.last_scan_id ?? "")
    ) {
      continue;
    }
    episodes.push(live);
  }
  return episodes;
}

/** A converted ledger row as its resolved_episodes record. */
export function toEpisodeRow(live: LedgerRow, compactionId: string): EpisodeRow {
  return {
    vuln_key: live.vuln_key,
    cve: live.cve,
    severity: live.severity,
    first_seen: live.first_seen,
    resolved_at: live.resolved_at,
    resolution_src: live.resolution_src,
    reopened_count: Number(live.reopened_count ?? 0),
    compaction_id: compactionId,
    superseded_by_scan: null,
  };
}

export interface DeleteResult {
  deleted: number;
  scans: number;
  tracked: number;
}

/**
 * Delete saved scans and rebuild the derived ledger by replaying the survivors —
 * identical to a ledger that had only ever seen them. Returns the rebuilt state (the
 * input state is not mutated), the result counts, and each replayed scan's
 * observations (for the caller to re-write obs files). Raises SealedScanError /
 * LedgerRebuildError BEFORE producing any state change.
 */
export function deleteScansCore(
  state: LedgerState,
  scanIds: Iterable<string>,
  readPayload: PayloadReader,
  checkpoint: Checkpoint | null,
  now?: number,
): { state: LedgerState; result: DeleteResult; observationsByScan: Record<string, Observation[]> } {
  const targets = new Set([...scanIds].filter(Boolean));
  const zero: DeleteResult = { deleted: 0, scans: 0, tracked: 0 };
  if (!targets.size) {
    return { state, result: zero, observationsByScan: {} };
  }
  const rows = scansAsc(state.scans);
  const present = new Set(rows.filter((r) => targets.has(r.scan_id)).map((r) => r.scan_id));
  if (!present.size) {
    return { state, result: zero, observationsByScan: {} };
  }
  const sealedTargets = rows
    .filter((r) => present.has(r.scan_id) && r.sealed)
    .map((r) => r.scan_id)
    .sort();
  if (sealedTargets.length) {
    throw new SealedScanError(
      `Cannot delete sealed scan(s) ${sealedTargets.join(", ")}: they are part of the ` +
        `compacted baseline (their raw archives were pruned), so their effects can no ` +
        `longer be un-replayed.`,
    );
  }
  const survivors = rows.filter((r) => !present.has(r.scan_id));

  // Pre-load + validate every UNSEALED survivor's payload BEFORE mutating anything.
  const replay = loadReplayPayloads(
    survivors,
    readPayload,
    (scanId) =>
      `Cannot delete: the archived payload for surviving scan ${scanId} is ` +
      `missing, so the ledger can't be rebuilt.`,
  );

  // Rebuild: sealed scans rows stay; the checkpoint's ledger (minus keys already in
  // resolved_episodes) seeds vuln_ledger; supersessions reset (post-floor survivors
  // re-derive them during replay).
  const rebuilt: LedgerState = {
    scans: survivors.filter((r) => r.sealed).map((r) => ({ ...r })),
    ledger: {},
    episodes: state.episodes.map((e) => ({ ...e, superseded_by_scan: null })),
  };
  if (checkpoint !== null) {
    const episodeKeys = new Set(state.episodes.map((e) => e.vuln_key));
    for (const row of checkpoint.ledger ?? []) {
      if (!episodeKeys.has(row.vuln_key)) rebuilt.ledger[row.vuln_key] = { ...row };
    }
  }

  const observationsByScan = replayScans(rebuilt, replay);

  return {
    state: rebuilt,
    result: {
      deleted: present.size,
      scans: rebuilt.scans.length,
      tracked: baseRows(rebuilt, now).length,
    },
    observationsByScan,
  };
}

/**
 * Replay the sealed prefix in a throwaway state to capture the exact ledger as of the
 * floor scan (ledger._build_checkpoint). Raises LedgerRebuildError when a newly-sealed
 * flat scan's archive is unreadable — before the caller mutates anything.
 */
export function buildCheckpoint(
  rows: ScanRow[],
  newly: ScanRow[],
  prevCheckpoint: Checkpoint | null,
  floorRow: ScanRow | null,
  readPayload: PayloadReader,
): Checkpoint {
  const tmp: LedgerState = emptyState();
  if (prevCheckpoint !== null) {
    for (const row of prevCheckpoint.ledger ?? []) tmp.ledger[row.vuln_key] = { ...row };
  }
  for (const r of rows) {
    if (r.sealed) tmp.scans.push({ ...r });
  }
  for (const r of newly) {
    const payload = readPayload(r);
    const scope = parseSeverities(r.severities);
    if (r.shape === "flat") {
      if (payload === null) {
        throw new LedgerRebuildError(
          `Cannot compact: the archived payload for scan ${r.scan_id} is missing or unreadable.`,
        );
      }
      persistFlatScan(tmp, recordsFromPayload(payload), {
        mode: r.mode,
        scanId: r.scan_id,
        scannedSeverities: scope,
      });
    } else if (payload === null) {
      reinsertScanRow(tmp, r); // grouped scans never touch the ledger
    } else {
      persistGroupedScan(tmp, extractNodes(payload), {
        mode: r.mode,
        scanId: r.scan_id,
        scannedSeverities: scope,
      });
    }
  }
  return {
    version: CHECKPOINT_VERSION,
    floor_scan_id: floorRow ? floorRow.scan_id : null,
    floor_ts: floorRow ? floorRow.ts : null,
    ledger: Object.values(tmp.ledger),
  };
}

export interface CompactionResult {
  no_op: boolean;
  dry_run: boolean;
  scans_sealed: number;
  episodes_created: number;
  observations_pruned: number;
  archive_bytes_freed: number;
  db_bytes_freed: number;
  floor_scan_id: string | null;
  floor_ts: string | null;
}

export interface CompactionPlan {
  result: CompactionResult;
  /** null when no_op */
  checkpoint: Checkpoint | null;
  /** scan rows newly sealed by this run */
  newly: ScanRow[];
  /** the state after applying the compaction (null when no_op or dry run) */
  state: LedgerState | null;
  compactionId: string | null;
}

/** Minimal open/resolved rows for the stats gate (ledger._open_and_resolved). */
function openAndResolved(state: LedgerState): Rec[] {
  const out: Rec[] = [];
  for (const row of Object.values(state.ledger)) {
    out.push({
      vuln_key: row.vuln_key,
      severity: row.severity,
      first_seen: row.first_seen,
      status: row.status,
      resolved_at: row.resolved_at,
    });
  }
  for (const e of state.episodes) {
    if (e.superseded_by_scan !== null || e.vuln_key in state.ledger) continue;
    out.push({
      vuln_key: e.vuln_key,
      severity: e.severity,
      first_seen: e.first_seen,
      status: "RESOLVED",
      resolved_at: e.resolved_at,
    });
  }
  return out;
}

function trendOf(state: LedgerState, now: number): unknown {
  return trendFromFrames(
    state.scans.map((s) => ({ ts: s.ts, shape: s.shape })),
    baseRows(state, now).map((r) => ({
      severity: r.severity,
      first_seen: r.first_seen,
      resolved_at: r.resolved_at,
      mttr_days: r.mttr_days,
    })),
  );
}

/**
 * Plan (and optionally apply) a compaction — the pure core of ledger.compact_ledger.
 * The dry-run preview and the real run compute identical numbers; obsCountByScan
 * supplies each candidate scan's observation count (read from Drive obs files) and
 * archiveBytes the on-disk size of their raw artifacts.
 */
export function compactLedgerCore(
  state: LedgerState,
  retentionDays: number | null,
  prevCheckpoint: Checkpoint | null,
  readPayload: PayloadReader,
  options: {
    dryRun?: boolean;
    now?: number;
    compactionId: string;
    obsCountByScan?: Record<string, number>;
    archiveBytes?: number;
  },
): CompactionPlan {
  const dryRun = Boolean(options.dryRun);
  const result: CompactionResult = {
    no_op: true,
    dry_run: dryRun,
    scans_sealed: 0,
    episodes_created: 0,
    observations_pruned: 0,
    archive_bytes_freed: 0,
    db_bytes_freed: 0,
    floor_scan_id: null,
    floor_ts: null,
  };
  const noOp: CompactionPlan = {
    result,
    checkpoint: null,
    newly: [],
    state: null,
    compactionId: null,
  };
  if (retentionDays === null) return noOp;
  const days = Math.max(Math.trunc(retentionDays), RETENTION_MIN_DAYS);
  const nowMs = options.now ?? Date.now();
  const cutoff = nowMs - days * 86_400_000;

  const rows = scansAsc(state.scans);
  if (!rows.length) return noOp;

  const candidates = selectSealCandidates(rows, cutoff);
  const sealedPrefix = rows.filter((r) => r.sealed);
  const candidatePrefixIds = candidates.slice(0, sealedPrefix.length).map((r) => r.scan_id);
  if (JSON.stringify(candidatePrefixIds) !== JSON.stringify(sealedPrefix.map((r) => r.scan_id))) {
    // A raised retention moved the cutoff inside the already-sealed region.
    return noOp;
  }
  const newly = candidates.filter((r) => !r.sealed);
  if (!newly.length) return noOp;

  const flatCandidates = candidates.filter((r) => r.shape === "flat");
  const floorRow = flatCandidates.length ? flatCandidates[flatCandidates.length - 1] : null;
  const checkpoint = buildCheckpoint(rows, newly, prevCheckpoint, floorRow, readPayload);

  // Episode conversion at the seal floor (shared with the migration import).
  const sealedIds = new Set(candidates.map((r) => r.scan_id));
  const episodes = settledEpisodeRows(checkpoint.ledger, state.ledger, sealedIds);

  const newlyIds = newly.map((r) => r.scan_id);
  const obsCount = newlyIds.reduce(
    (acc, id) => acc + (options.obsCountByScan?.[id] ?? 0),
    0,
  );

  result.no_op = false;
  result.scans_sealed = newly.length;
  result.episodes_created = episodes.length;
  result.observations_pruned = obsCount;
  result.archive_bytes_freed = options.archiveBytes ?? 0;
  result.floor_scan_id = checkpoint.floor_scan_id;
  result.floor_ts = checkpoint.floor_ts;
  if (dryRun) return { result, checkpoint, newly, state: null, compactionId: null };

  // Apply in memory, then verify the stats identity — abort (throw) on any change.
  const beforeMttr = mttrFromLedger(openAndResolved(state), { now: nowMs });
  const beforeTrend = trendOf(state, nowMs);

  const applied: LedgerState = {
    scans: state.scans.map((r) =>
      newlyIds.includes(r.scan_id)
        ? { ...r, sealed: 1 as const, raw_ref: null, obs_ref: null }
        : { ...r },
    ),
    ledger: {},
    episodes: [
      ...state.episodes.map((e) => ({ ...e })),
      ...episodes.map((e) => toEpisodeRow(e, options.compactionId)),
    ],
  };
  const converted = new Set(episodes.map((e) => e.vuln_key));
  for (const [key, row] of Object.entries(state.ledger)) {
    if (!converted.has(key)) applied.ledger[key] = { ...row };
  }

  const afterMttr = mttrFromLedger(openAndResolved(applied), { now: nowMs });
  const afterTrend = trendOf(applied, nowMs);
  if (
    !statsEqual(
      { perSev: beforeMttr.perSev, overall: beforeMttr.overall },
      { perSev: afterMttr.perSev, overall: afterMttr.overall },
    ) ||
    !statsEqual(beforeTrend, afterTrend)
  ) {
    throw new LedgerRebuildError(
      "Compaction aborted: MTTR/SLA/trend stats would change — rolled back.",
    );
  }

  return { result, checkpoint, newly, state: applied, compactionId: options.compactionId };
}

/** Compaction record for the compactions tab (checkpoint blob lives in Drive). */
export function compactionRow(
  plan: CompactionPlan,
  checkpointRef: string | null,
  now?: number,
): Rec {
  return {
    compaction_id: plan.compactionId,
    ts: nowIso(now),
    floor_scan_id: plan.result.floor_scan_id,
    floor_ts: plan.result.floor_ts,
    scans_sealed: plan.result.scans_sealed,
    episodes_created: plan.result.episodes_created,
    observations_pruned: plan.result.observations_pruned,
    archive_bytes_freed: plan.result.archive_bytes_freed,
    db_bytes_freed: plan.result.db_bytes_freed,
    checkpoint_ref: checkpointRef,
  };
}

/** Guard used by callers that iterate scans for replay-date windows. */
export function cutoffMs(nowMs: number, retentionDays: number): number {
  return nowMs - Math.max(retentionDays, RETENTION_MIN_DAYS) * 86_400_000;
}

export function isAfter(ts: string | null, ms: number): boolean {
  const t = parseTs(ts);
  return t !== null && t > ms;
}
