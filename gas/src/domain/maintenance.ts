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
import { DEFAULT_DOMAIN_TAG_KEY, domainOfTags } from "./domainTag";
import { hasDomainInputs, recordTags } from "./domainRules";
import { mttrFromLedger, vulnKey } from "./lifecycle";
import { mergeRiskSignals, tagsJson, type LedgerRow, type Observation } from "./reconcile";
import { extractNodes } from "./transform";
import { confusionMatrix, DEFAULT_RISK_RULE } from "./program";
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
    fix_date: live.fix_date,
    fix_observed_at: live.fix_observed_at,
    // Exploit intelligence survives compaction — a sealed episode is still a remediated
    // lifecycle that coverage/efficiency must be able to classify.
    has_kev: live.has_kev ?? null,
    has_exploit: live.has_exploit ?? null,
    epss: live.epss ?? null,
    risk_observed_at: live.risk_observed_at ?? null,
    // And the tag bag, for the same reason one tier over: a sealed episode is still a
    // remediated lifecycle that the by-domain split has to be able to attribute.
    tags_json: live.tags_json ?? null,
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

/**
 * The coverage/efficiency matrix over a state — the third leg of the stats-identity gate.
 * Uses DEFAULT_RISK_RULE rather than the operator's configured rule so the invariant is
 * deterministic and independent of settings: compaction must not move these numbers under
 * ANY rule, and the default exercises all three signals.
 */
function coverageOf(state: LedgerState, now: number): unknown {
  return confusionMatrix(
    baseRows(state, now).map((r) => ({
      severity: r.severity,
      status: r.status,
      has_kev: r.has_kev,
      has_exploit: r.has_exploit,
      epss: r.epss,
    })),
    DEFAULT_RISK_RULE,
  );
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
 * How many rows carry each attribution INPUT — the fourth leg of the stats-identity gate.
 *
 * THE GATE HAD A HOLE EXACTLY THIS SHAPE ONCE ALREADY. The risk columns were dropped by
 * compaction and the metric moved silently, because nothing in the gate looked at them; the
 * comment on EpisodeRow's `has_kev` records that. `tags_json` was in the same position until
 * this release — it is where the `Wiz/Domain` tag lives, and therefore where every by-domain
 * figure comes from — so it gets its own leg rather than an assurance that the carry-through
 * is right.
 *
 * IT CHECKS THE TAG AND NOTHING ELSE, and the exclusions are the point rather than an
 * oversight. Compaction deliberately sheds `asset_name` (to the `(compacted)` sentinel) and
 * the subscription columns — that is what an episode IS, and it is why `hasDomainInputs`
 * exists — so a leg that counted those would abort every compaction ever run. What compaction
 * now PROMISES to preserve is the tag bag, so that is what the gate holds it to.
 *
 * It counts under the DEFAULT tag key rather than the configured one, for the same reason
 * `coverageOf` pins DEFAULT_RISK_RULE: the invariant must hold under ANY configuration, so it
 * is tested against a fixed one. Both figures are kept — a bag that survived and a domain that
 * resolves out of it are different failures, and a gate that reported only the second could
 * not tell a dropped column from a mangled one.
 */
function attributionOf(state: LedgerState, now: number): unknown {
  let bagged = 0;
  let domained = 0;
  for (const r of baseRows(state, now)) {
    if (r.tags_json) bagged += 1;
    if (domainOfTags(recordTags(r as unknown as Rec), DEFAULT_DOMAIN_TAG_KEY)) domained += 1;
  }
  return { bagged, domained };
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
  const beforeCoverage = coverageOf(state, nowMs);
  const beforeAttribution = attributionOf(state, nowMs);

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
  // Coverage/efficiency get their own comparison and their own message, so an abort names
  // the metric that moved. This is a true invariant — episodes carry the risk columns
  // (toEpisodeRow), so a sealed lifecycle classifies exactly as it did while live — which
  // makes the check a regression detector for that carry-through rather than a real risk.
  if (!statsEqual(beforeCoverage, coverageOf(applied, nowMs))) {
    throw new LedgerRebuildError(
      "Compaction aborted: coverage/efficiency would change — rolled back.",
    );
  }
  // Attribution gets the same treatment for the same reason. Its own message, so an abort
  // names the metric that moved rather than sending a reader through three candidates.
  if (!statsEqual(beforeAttribution, attributionOf(applied, nowMs))) {
    throw new LedgerRebuildError(
      "Compaction aborted: domain attribution would change — rolled back.",
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

// --------------------------------------------------------------------------- #
//  History backfill — recovering exploit intelligence AND attribution from archives
// --------------------------------------------------------------------------- #

export interface BackfillResult {
  scansReplayed: number;
  scansSealed: number;
  scansUnreadable: number;
  ledgerRowsTouched: number;
  episodeRowsTouched: number;
  stillUnknown: number;
  /** Rows that gained a tag bag they did not have — the attribution half of the walk. */
  tagsRecovered: number;
  /** Rows still carrying no attribution input at all — the `Not attributable` residue. */
  stillUnattributable: number;
}

export function emptyBackfillResult(): BackfillResult {
  return {
    scansReplayed: 0,
    scansSealed: 0,
    scansUnreadable: 0,
    ledgerRowsTouched: 0,
    episodeRowsTouched: 0,
    stillUnknown: 0,
    tagsRecovered: 0,
    stillUnattributable: 0,
  };
}

export interface TagBackfillResult {
  /** Episodes that gained a tag bag they did not have. */
  recovered: number;
  /** Episodes that already carried one — the re-run case. */
  alreadyHad: number;
  /** Episodes the checkpoint chain does not hold, which stay Not attributable. */
  unrecoverable: number;
}

/**
 * Recover `tags_json` for episodes sealed before the column existed, from a checkpoint blob.
 *
 * WHY THIS IS ONE PASS AND NOT AN ARCHIVE WALK. The risk backfill below replays every scan
 * archive because exploit signals live on the RECORDS. A tag bag lives on the LEDGER ROW, and
 * `buildCheckpoint` seeds each checkpoint from the previous one — so the newest checkpoint is
 * cumulative and holds every row compaction ever converted, with its tags. One blob read
 * answers the whole question. (The raw scan archives could not answer it anyway: they are
 * trashed for sealed scans, which is exactly the population needing recovery.)
 *
 * IDEMPOTENT, and the counters say which case each episode hit rather than reporting one total
 * that a second run would silently halve. A row already carrying a bag is never overwritten:
 * the live ledger's value is at least as fresh as the checkpoint's.
 *
 * An episode the checkpoint does not hold is left alone and counted. That is the honest
 * outcome for history imported from a legacy bundle, which never had tags to lose.
 */
export function backfillTagsFromCheckpoint(
  state: LedgerState,
  checkpoint: Checkpoint | null,
): TagBackfillResult {
  const out: TagBackfillResult = { recovered: 0, alreadyHad: 0, unrecoverable: 0 };
  const byKey = new Map<string, LedgerRow>();
  for (const row of checkpoint?.ledger ?? []) byKey.set(row.vuln_key, row);
  for (const e of state.episodes) {
    if (e.tags_json) { out.alreadyHad += 1; continue; }
    const tags = byKey.get(e.vuln_key)?.tags_json ?? null;
    if (tags) { e.tags_json = tags; out.recovered += 1; }
    else out.unrecoverable += 1;
  }
  return out;
}

/**
 * Merge one saved scan's exploit signals into the ledger, in place.
 *
 * The columns behind coverage / efficiency were added after the ledger already held history,
 * so existing lifecycles carry no signal and classify as `unknown`. The scan archives in
 * Drive still hold the records those lifecycles came from, and slim records already carried
 * `hasExploit` / `hasCisaKevExploit` / `epssProbability` before the ledger did — so most of
 * that history is recoverable by replaying archives through the same merge live scans use.
 *
 * **Order-independent and idempotent**, because `mergeRiskSignals` is (booleans OR, EPSS max,
 * witness date min). Three consequences the caller relies on:
 *   - scans can be replayed newest-first, so an interrupted run has still done the most
 *     valuable part;
 *   - a hop that dies mid-way needs no rollback — re-running converges on the same state;
 *   - re-running the whole backfill from scratch is a no-op on already-filled rows.
 *
 * Episodes (compacted lifecycles) are merged too: a sealed episode is still a remediated
 * lifecycle that coverage has to classify.
 */
export function backfillRiskFromRecords(
  state: LedgerState,
  records: Rec[],
  scanTsIso: string,
  result: BackfillResult,
): void {
  const episodesByKey = new Map<string, EpisodeRow>();
  for (const e of state.episodes) episodesByKey.set(e.vuln_key, e);
  for (const rec of records) {
    const key = vulnKey(rec);
    const row = state.ledger[key];
    if (row) {
      const before = row.risk_observed_at;
      mergeRiskSignals(row, rec, scanTsIso);
      if (before !== row.risk_observed_at) result.ledgerRowsTouched += 1;
      continue;
    }
    const ep = episodesByKey.get(key);
    if (ep) {
      const before = ep.risk_observed_at;
      mergeRiskSignals(ep, rec, scanTsIso);
      if (before !== ep.risk_observed_at) result.episodeRowsTouched += 1;
    }
  }
}

/**
 * Merge one saved scan's TAG BAGS into the ledger, in place — the attribution twin of
 * `backfillRiskFromRecords`, and it rides the same walk for the same reasons.
 *
 * `tags_json` is where the `Wiz/Domain` tag lives, and a row without one resolves to
 * `Not attributable` — a bucket no operator action can close. Two populations arrived
 * there: episodes compacted before `EpisodeRow` carried the column, and history imported
 * from a legacy bundle, whose exporter never had it. `backfillTagsFromCheckpoint` reaches
 * the first from one blob read; it cannot reach the second, because those rows were never
 * in a GAS checkpoint. The scan archives still hold the records both came from.
 *
 * **FILL-ONLY, never overwrite**, which is what makes it order-independent and idempotent
 * the way the risk merge is. Combined with the caller's newest-first walk, fill-only means
 * the NEWEST surviving bag wins — so an abandoned run has still taken the freshest answer,
 * a dead hop needs no rollback, and a re-run converges on identical state. Overwriting
 * would invert that: a deep archive would clobber a fresher bag, and the result would
 * depend on where the run stopped.
 *
 * Live ledger rows are merged too, not just episodes. A row whose resource lost its tags in
 * Wiz keeps its last known bag by `reconcile`'s sticky `?? row.tags_json`, so a null one
 * here means the bag was never captured — exactly the case this recovers.
 */
export function backfillTagsFromRecords(
  state: LedgerState,
  records: Rec[],
  result: BackfillResult,
): void {
  const episodesByKey = new Map<string, EpisodeRow>();
  for (const e of state.episodes) episodesByKey.set(e.vuln_key, e);
  for (const rec of records) {
    const key = vulnKey(rec);
    const target: { tags_json: string | null } | undefined =
      state.ledger[key] ?? episodesByKey.get(key);
    if (!target || target.tags_json) continue;
    const bag = tagsJson(rec);
    if (bag) {
      target.tags_json = bag;
      result.tagsRecovered += 1;
    }
  }
}

/**
 * Lifecycles carrying no attribution input at all — the `Not attributable` residue, counted
 * over the same population `baseRows` surfaces (non-superseded episodes without a live row).
 *
 * IT ASKS `hasDomainInputs` RATHER THAN CHECKING COLUMNS ITSELF, and that is the whole point
 * of the function existing: it is the same predicate `resolveDomain` uses to decide
 * `NOT_ATTRIBUTABLE`, and it reads the same columns `conditionMatches` does, so a counter
 * built on it cannot drift from the figure it claims to count. A hand-rolled column check
 * here would be a second definition of "attributable", and the two would disagree the first
 * time either side gained a column.
 *
 * An episode is passed as it is STORED — no `asset_name` at all, rather than the
 * `(compacted)` sentinel `baseRows` materializes. The two agree: `hasDomainInputs` filters
 * the sentinel out of its name check, so both reduce to "does it still have a tag bag",
 * which for an episode is the only attribution input compaction leaves it.
 */
export function countUnattributable(state: LedgerState): number {
  let n = 0;
  for (const row of Object.values(state.ledger)) {
    if (!hasDomainInputs(row as unknown as Rec)) n += 1;
  }
  for (const e of state.episodes) {
    if (e.superseded_by_scan !== null) continue;
    if (e.vuln_key in state.ledger) continue;
    if (!hasDomainInputs(e as unknown as Rec)) n += 1;
  }
  return n;
}

/** Lifecycles still carrying no captured signal at all — the permanent-unknown residue. */
export function countUnknownRisk(state: LedgerState): number {
  let n = 0;
  for (const row of Object.values(state.ledger)) if (row.risk_observed_at == null) n += 1;
  for (const e of state.episodes) {
    if (e.superseded_by_scan !== null) continue;
    if (e.vuln_key in state.ledger) continue;
    if (e.risk_observed_at == null) n += 1;
  }
  return n;
}
