// Pure delete-replay and compaction flows over LedgerState — the port of
// gas/src/domain/maintenance.ts (itself ledger.delete_scans / ledger.compact_ledger) with
// all I/O injected: archived payloads arrive through a reader callback, checkpoint blobs
// through parameters, and the caller applies the returned state/artifacts to Sheets/Drive.
//
// WHAT IS DROPPED FROM gas/, and why. The whole "History backfill" half of gas/'s module —
// `BackfillResult`, `emptyBackfillResult`, `TagBackfillResult`, `backfillTagsFromCheckpoint`,
// `backfillRiskFromRecords`, `backfillTagsFromRecords`, `countUnattributable`,
// `countUnknownRisk` — is not ported. Every one of them recovers a column onto rows written
// before that column existed: exploit signals onto pre-`has_kev` lifecycles, and `tags_json`
// onto episodes sealed before `EpisodeRow` carried the domain tag bag. This register is
// fresh — it has no rows predating its own schema, `EpisodeRow` here has no `tags_json`
// column at all, and there is no `Wiz/Domain` tag or `domainOfTags` in the tree (ownership
// here is `owner_project`, which ledgerCore's episode-collision branch already transfers).
// Porting them would add recovery paths for a history that does not exist, keyed on columns
// that do not exist. gas/'s fourth stats-identity leg (`attributionOf`, which counts tag
// bags) goes with them for the same reason; the other three legs are kept.
//
// FIVE MORE DIVERGENCES, each argued at its site:
//   1. `scope` is on every scan row and in every ledger key, so a replay persists each scan
//      under ITS OWN scope, and `replayScans` walks all three registers' scans in one ts
//      order (see its note).
//   2. There is no `shape` column and no grouped scans — gas/'s flat-vs-grouped branches
//      collapse to the flat one and the grouped branch is deleted, not kept as dead code.
//      `persistGroupedScan` / `reinsertScanRow` do not exist in this register's ledgerCore.
//   3. THE COMPACTION FLOOR IS GLOBAL, not per scope — see `compactLedgerCore`.
//   4. `coverageOf` dispatches the risk rule PER ROW rather than pinning DEFAULT_RISK_RULE,
//      and it skips `secrets` — see its note.
//   5. `compactionRow` emits the eight columns TAB_HEADERS[TABS.compactions] actually has.
//
// Column names throughout come from `TAB_HEADERS` in src/server/sheetsDb.ts, not from gas/:
// `vuln_key` -> `finding_key`, `cve` -> `identifier`, `asset_id`/`asset_name` ->
// `repo_id`/`repo_name`, `cloud` -> `platform`. There is no `published_date`, no `tags_json`
// on an episode, no `domain`, and no `REMEDIATION_ROLLOUT_ISO`.

import { SCOPES, ruleForScope, type Scope } from "./config";
import { parseSeverities, selectSealCandidates, statsEqual } from "./compaction";
import { baseRows, emptyState, persistFlatScan, scansAsc } from "./ledgerCore";
import type {
  EpisodeRow,
  LedgerRow,
  LedgerState,
  Observation,
  ScanRow,
} from "./ledgerTypes";
import { mttrFromLedger } from "./lifecycle";
import { confusionMatrix, type RiskRow } from "./program";
import { trendFromFrames } from "./trend";
import { nowIso, parseTs, pushAll, type Rec } from "./util";

/**
 * TODO(src/domain/config.ts): gas/src/domain/config.ts exports `RETENTION_MIN_DAYS = 30`
 * beside `DEFAULT_RETENTION_DAYS` / `MIN_UNSEALED_FLAT_SCANS`; this register's config.ts
 * ported the other two and not this one. Defined locally, byte-identical to gas/'s value, so
 * the retention floor behaves the same; move it to config.ts and import it from there.
 */
export const RETENTION_MIN_DAYS = 30;

/**
 * TODO(src/domain/compaction.ts): gas/'s compaction.ts declares `CHECKPOINT_VERSION` and the
 * `Checkpoint` interface; this register's compaction.ts ported the retention predicates only
 * (its own header says the checkpoint replay was out of scope for D9). Declared here, with
 * `ledger: LedgerRow[]` carrying THIS register's rows — so a checkpoint row is scope-stamped
 * and its key is scope-prefixed, which is what lets one checkpoint seed a rebuild spanning
 * all three registers. Move both to compaction.ts when that module grows the checkpoint half.
 */
export const CHECKPOINT_VERSION = 1;

export interface Checkpoint {
  version: number;
  floor_scan_id: string | null;
  floor_ts: string | null;
  ledger: LedgerRow[];
}

export class LedgerRebuildError extends Error {}
export class SealedScanError extends LedgerRebuildError {}

/** Reads a scan's archived payload; null when missing/unreadable. */
export type PayloadReader = (row: ScanRow) => unknown | null;

/**
 * Raw nested nodes from an archived payload (ledger._records_from_payload).
 *
 * TODO(src/domain/transform.ts): gas/ delegates this to `extractNodes` in its transform.ts,
 * which this register has not ported. Inlined here, with gas/'s `vulnerabilityFindings`
 * special case DELETED rather than copied: that connection does not exist in this tenant's
 * code registers (the three are `sastFindings`, `libraryVulnerabilities` and
 * `secretInstances`), so privileging it by name would be a branch nothing reaches while the
 * generic "first key under `data` carrying `nodes`" walk below answers all three. Move this
 * to a transform.ts when one lands, and take the whole envelope walk with it.
 */
export function recordsFromPayload(payload: unknown): Rec[] {
  return extractNodes(payload);
}

function coerceResults(results: unknown): unknown {
  if (results === null || results === undefined) return results;
  if (typeof results === "object") return results;
  if (typeof results === "string") {
    try {
      return JSON.parse(results.trim());
    } catch {
      return results;
    }
  }
  return results;
}

function extractNodes(results: unknown): Rec[] {
  const coerced = coerceResults(results);
  if (!coerced) return [];
  if (Array.isArray(coerced) && coerced.length && typeof coerced[0] === "object") {
    // A list of page envelopes: merge every page's nodes.
    const merged: Rec[] = [];
    let ok = false;
    for (const page of coerced) {
      if (page && typeof page === "object" && !Array.isArray(page)) {
        const sub = extractNodes(page);
        if (sub.length) {
          // Not merged.push(...sub): a page can be findings-scale and a spread over one
          // overflows the GAS stack (util.pushAll exists for exactly this).
          pushAll(merged, sub);
          ok = true;
        }
      }
    }
    if (ok) return merged;
  }
  if (coerced && typeof coerced === "object" && !Array.isArray(coerced)) {
    const obj = coerced as Rec;
    const data = obj["data"];
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const v of Object.values(data as Rec)) {
        if (v && typeof v === "object" && !Array.isArray(v) && "nodes" in (v as Rec)) {
          return ((v as Rec)["nodes"] as Rec[]) ?? [];
        }
      }
    }
    if ("nodes" in obj) return (obj["nodes"] as Rec[]) ?? [];
  }
  if (Array.isArray(coerced)) return coerced as Rec[];
  return [coerced as Rec];
}

export interface ReplayItem {
  row: ScanRow;
  payload: unknown | null;
}

/**
 * Pre-load + validate every UNSEALED row's payload BEFORE the caller mutates anything. A
 * scan with a missing payload throws LedgerRebuildError with `missingMsg(scanId)`.
 *
 * DIVERGENCE (gas/): gas/ guarded the throw with `&& r.shape === "flat"`, because a grouped
 * scan never touched its ledger and so could be replayed from its stored row alone. There is
 * no grouped shape here (ledgerTypes.ScanRow has no `shape` column), so every unsealed scan
 * is load-bearing and every missing payload is fatal — the guard is dropped rather than kept
 * as a condition that is always true.
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
    if (payload === null) {
      throw new LedgerRebuildError(missingMsg(r.scan_id));
    }
    replay.push({ row: r, payload });
  }
  return replay;
}

/**
 * Replay pre-validated scans into `rebuilt` in the given order, re-running the persist
 * writer. Returns each replayed scan's observations (for the caller to re-write obs files).
 *
 * DIVERGENCE (gas/), and it is the whole of rule 1 in one line: EACH SCAN IS REPLAYED UNDER
 * ITS OWN `scope`. The caller hands this one ts-ordered list spanning all three registers —
 * there is one ledger and one scan log — and `persistFlatScan` partitions the ledger by key
 * prefix per call, so a sca scan replayed as sca cannot touch a secrets row. Replaying with
 * a fixed or defaulted scope would file one register's findings under another's identity
 * namespace, and resolve-by-disappearance would close the borrowed register's whole open set
 * on the first replayed scan.
 *
 * The keys of the returned map are scan_ids, and a scan_id is NOT unique across scopes here
 * (one sync job carries one scan_id and steps through the scopes — jobsStore.ts). Callers
 * that replay more than one scope's scan under a shared id get the last one's observations
 * under that key; that mirrors gas/'s contract, and the obs file is addressed by
 * `ScanRow.obs_ref` anyway, which is per row.
 */
export function replayScans(
  rebuilt: LedgerState,
  replay: ReplayItem[],
): Record<string, Observation[]> {
  const observationsByScan: Record<string, Observation[]> = {};
  for (const { row, payload } of replay) {
    const { observations } = persistFlatScan(rebuilt, recordsFromPayload(payload), {
      scope: row.scope,
      mode: row.mode,
      scanId: row.scan_id,
      scannedSeverities: parseSeverities(row.severities),
      rawRef: row.raw_ref,
      obsRef: row.obs_ref,
    });
    observationsByScan[row.scan_id] = observations;
  }
  return observationsByScan;
}

/**
 * Live ledger rows that roll into resolved_episodes at a seal floor: only checkpoint-RESOLVED
 * rows whose live state is untouched post-floor — still RESOLVED with the same resolved_at,
 * last seen by a sealed scan.
 */
export function settledEpisodeRows(
  checkpointLedger: LedgerRow[],
  ledger: Record<string, LedgerRow>,
  sealedIds: Set<string>,
): LedgerRow[] {
  const episodes: LedgerRow[] = [];
  for (const cpRow of checkpointLedger) {
    if (cpRow.status !== "RESOLVED") continue;
    const live = ledger[cpRow.finding_key];
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

/**
 * A converted ledger row as its resolved_episodes record.
 *
 * Built as an EpisodeRow OBJECT LITERAL, never by spreading the live row: the literal is
 * checked against TAB_HEADERS[TABS.episodes] at compile time, so a column added to the tab
 * without a line here fails the build instead of writing a blank cell, and a column dropped
 * from the tab cannot survive as a stray key on the object.
 *
 * The exploit columns and `cwe` / `language` survive compaction for gas/'s reason unchanged —
 * a sealed episode is still a remediated lifecycle that coverage/efficiency must classify,
 * and this register classifies sast rows on `cwe` / `ai_verdict` as well as sca rows on the
 * exploit triple. `ai_verdict` is NOT on EpisodeRow (the tab has no column), so a sealed sast
 * lifecycle keeps only its CWE clause; that is the tab's shape, not a decision made here.
 * `owner_project` is what a sealed episode is attributed by — this register has no tag bag
 * and no `Wiz/Domain` tag, so gas/'s `tags_json` line has no counterpart.
 */
export function toEpisodeRow(live: LedgerRow, compactionId: string): EpisodeRow {
  return {
    finding_key: live.finding_key,
    scope: live.scope,
    identifier: live.identifier,
    component: live.component,
    severity: live.severity,
    first_seen: live.first_seen,
    resolved_at: live.resolved_at,
    resolution_src: live.resolution_src,
    reopened_count: Number(live.reopened_count ?? 0),
    compaction_id: compactionId,
    superseded_by_scan: null,
    fix_date: live.fix_date,
    fix_observed_at: live.fix_observed_at,
    has_kev: live.has_kev ?? null,
    has_exploit: live.has_exploit ?? null,
    epss: live.epss ?? null,
    cwe: live.cwe ?? null,
    language: live.language ?? null,
    owner_project: live.owner_project ?? null,
  };
}

export interface DeleteResult {
  deleted: number;
  scans: number;
  tracked: number;
}

/**
 * Delete saved scans and rebuild the derived ledger by replaying the survivors — identical to
 * a ledger that had only ever seen them. Returns the rebuilt state (the input state is not
 * mutated), the result counts, and each replayed scan's observations (for the caller to
 * re-write obs files). Raises SealedScanError / LedgerRebuildError BEFORE producing any state
 * change.
 *
 * The parameter order is gas/'s, unchanged, so server/ledgerStore.ts can call it as gas/'s
 * does: (state, scanIds, readPayload, checkpoint, now?).
 *
 * THE REPLAY SPANS ALL THREE SCOPES. `scansAsc(state.scans)` is unfiltered on purpose:
 * deleting one sca scan re-derives the whole ledger, and a rebuild that replayed only sca's
 * survivors would drop every sast and secrets row on the floor. Each survivor goes back in
 * under its own scope (`replayScans`), which is what keeps the other two registers
 * byte-identical across a delete they had nothing to do with.
 */
export function deleteScansCore(
  state: LedgerState,
  scanIds: Iterable<string>,
  readPayload: PayloadReader,
  checkpoint: Checkpoint | null,
  now?: number,
): {
  state: LedgerState;
  result: DeleteResult;
  observationsByScan: Record<string, Observation[]>;
} {
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

  // Rebuild: sealed scan rows stay; the checkpoint's ledger (minus keys already in
  // resolved_episodes) seeds finding_ledger; supersessions reset (post-floor survivors
  // re-derive them during replay).
  const rebuilt: LedgerState = {
    scans: survivors.filter((r) => r.sealed).map((r) => ({ ...r })),
    ledger: {},
    episodes: state.episodes.map((e) => ({ ...e, superseded_by_scan: null })),
  };
  if (checkpoint !== null) {
    const episodeKeys = new Set(state.episodes.map((e) => e.finding_key));
    for (const row of checkpoint.ledger ?? []) {
      if (!episodeKeys.has(row.finding_key)) rebuilt.ledger[row.finding_key] = { ...row };
    }
  }

  const observationsByScan = replayScans(rebuilt, replay);

  return {
    state: rebuilt,
    result: {
      deleted: present.size,
      scans: rebuilt.scans.length,
      tracked: baseRows(rebuilt, { now }).length,
    },
    observationsByScan,
  };
}

/**
 * Replay the sealed prefix in a throwaway state to capture the exact ledger as of the floor
 * scan (ledger._build_checkpoint). Raises LedgerRebuildError when a newly-sealed scan's
 * archive is unreadable — before the caller mutates anything.
 *
 * EVERY SEALED EPISODE AND EVERY SEALED SCAN ROW CARRIES ITS `scope` out of here, because the
 * rows it replays carry it in: `newly` is persisted under `r.scope` (rule 1), and the scan
 * rows copied off `rows` are copied whole. A checkpoint that lost the column would seed a
 * later rebuild with rows no register could adjudicate again.
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
    for (const row of prevCheckpoint.ledger ?? []) tmp.ledger[row.finding_key] = { ...row };
  }
  for (const r of rows) {
    if (r.sealed) tmp.scans.push({ ...r });
  }
  for (const r of newly) {
    const payload = readPayload(r);
    if (payload === null) {
      throw new LedgerRebuildError(
        `Cannot compact: the archived payload for scan ${r.scan_id} is missing or unreadable.`,
      );
    }
    persistFlatScan(tmp, recordsFromPayload(payload), {
      scope: r.scope,
      mode: r.mode,
      scanId: r.scan_id,
      scannedSeverities: parseSeverities(r.severities),
    });
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
      finding_key: row.finding_key,
      scope: row.scope,
      severity: row.severity,
      first_seen: row.first_seen,
      status: row.status,
      resolved_at: row.resolved_at,
    });
  }
  for (const e of state.episodes) {
    if (e.superseded_by_scan !== null || e.finding_key in state.ledger) continue;
    out.push({
      finding_key: e.finding_key,
      scope: e.scope,
      severity: e.severity,
      first_seen: e.first_seen,
      status: "RESOLVED",
      resolved_at: e.resolved_at,
    });
  }
  return out;
}

/**
 * The coverage/efficiency matrices over a state — the third leg of the stats-identity gate.
 *
 * TWO DIVERGENCES FROM gas/, both forced by this register having three scopes and one of them
 * having no risk rule at all:
 *
 *   1. NO EXPLICIT RULE IS PASSED. gas/ pins `DEFAULT_RISK_RULE` so the invariant is
 *      independent of the operator's configured rule. There is no configured rule here —
 *      `config.ruleForScope` is the only source, and it dispatches per scope (the CVE triple
 *      for sca, the CWE/AI/critical triple for sast). Pinning gas/'s CVE rule would classify
 *      every sast row `unknown` and the leg would stop watching the columns
 *      (`cwe` / `ai_verdict`) that compaction is most likely to drop.
 *   2. `secrets` IS SKIPPED, not classified. `program.confusionMatrix` THROWS on a secrets
 *      row by design (config.ts: severity there grades a detection, not whether a credential
 *      is live), so a gate that fed it the whole ledger would abort every compaction on any
 *      register that has ever synced secrets — the gate would read as a correctness failure
 *      while measuring nothing.
 *
 * Per scope rather than one pooled matrix, so an abort can name which register moved and a
 * row that changed scope cannot cancel out against one that changed the other way.
 */
function coverageOf(state: LedgerState, now: number): unknown {
  const rows = baseRows(state, { now });
  const out: Record<string, unknown> = {};
  for (const scope of SCOPES) {
    if (ruleForScope(scope) === null) continue;
    const scoped: RiskRow[] = [];
    for (const r of rows) {
      if (r.scope !== scope) continue;
      scoped.push({
        scope: r.scope,
        severity: r.severity,
        status: r.status,
        has_kev: r.has_kev,
        has_exploit: r.has_exploit,
        epss: r.epss,
        cwe: r.cwe,
        ai_verdict: r.ai_verdict,
      });
    }
    out[scope] = confusionMatrix(scoped);
  }
  return out;
}

/**
 * The trend series over a state — the second leg of the gate. No `shape` on the scan frames
 * (this register's ScanRow has none) and no scope filter: the series is taken over the whole
 * register, exactly as the MTTR leg above it is, so the gate holds compaction to leaving the
 * WHOLE product's numbers alone rather than one page's.
 */
function trendOf(state: LedgerState, now: number): unknown {
  return trendFromFrames(
    state.scans.map((s) => ({ ts: s.ts, scope: s.scope })),
    baseRows(state, { now }).map((r) => ({
      severity: r.severity,
      first_seen: r.first_seen,
      resolved_at: r.resolved_at,
      mttr_days: r.mttr_days,
      fix_available_at: r.fix_available_at,
    })),
  );
}

/**
 * Plan (and optionally apply) a compaction — the pure core of ledger.compact_ledger. The
 * dry-run preview and the real run compute identical numbers; obsCountByScan supplies each
 * candidate scan's observation count (read from Drive obs files) and archiveBytes the on-disk
 * size of their raw artifacts.
 *
 * THE FLOOR IS COMPUTED OVER THE WHOLE SCAN LOG, ACROSS ALL THREE SCOPES, and that is a
 * decision rather than an omission. `scansAsc(state.scans)` is unfiltered, so
 * `selectSealCandidates` takes the contiguous ts-ordered prefix of the WHOLE log and the
 * MIN_UNSEALED_FLAT_SCANS guard protects the last two scans of the register rather than the
 * last two of each scope. A per-scope floor would let one register's compaction seal another
 * register's scans: the sealed set is a prefix of one shared log, so a sca run that sealed
 * "sca's oldest two" would leave an unsealed secrets scan sitting inside the sealed region,
 * and `deleteScansCore` would then be free to delete a scan whose effects the checkpoint had
 * already baked in — the un-replayable state SealedScanError exists to prevent. One ledger,
 * one baseline, one floor.
 *
 * The cost is stated rather than hidden: a scope that syncs rarely holds the floor back for
 * the others, because the prefix stops at the first scan newer than the cutoff whatever its
 * scope. That is the conservative direction — nothing is sealed too early.
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

  // DIVERGENCE (gas/): the floor is the LAST CANDIDATE, full stop. gas/ took the last
  // `shape === "flat"` candidate because a grouped scan never touched the ledger and so could
  // not be a meaningful floor. Every scan here is flat (ledgerTypes.ScanRow has no `shape`),
  // so that filter would be a no-op and the floor is simply the newest sealed scan — of
  // whichever scope, per the note above.
  const floorRow = candidates.length ? candidates[candidates.length - 1]! : null;
  const checkpoint = buildCheckpoint(rows, newly, prevCheckpoint, floorRow, readPayload);

  // Episode conversion at the seal floor.
  const sealedIds = new Set(candidates.map((r) => r.scan_id));
  const episodes = settledEpisodeRows(checkpoint.ledger, state.ledger, sealedIds);

  const newlyIds = newly.map((r) => r.scan_id);
  // A loop, never `reduce` over a spread — the scan log is small but the rule is the rule.
  let obsCount = 0;
  for (const id of newlyIds) obsCount += options.obsCountByScan?.[id] ?? 0;

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

  const newlyIdSet = new Set(newlyIds);
  const applied: LedgerState = {
    scans: state.scans.map((r) =>
      newlyIdSet.has(r.scan_id)
        ? { ...r, sealed: 1 as const, raw_ref: null, obs_ref: null }
        : { ...r },
    ),
    ledger: {},
    episodes: [
      ...state.episodes.map((e) => ({ ...e })),
      ...episodes.map((e) => toEpisodeRow(e, options.compactionId)),
    ],
  };
  const converted = new Set(episodes.map((e) => e.finding_key));
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
  // Coverage/efficiency get their own comparison and their own message, so an abort names the
  // metric that moved. A true invariant — episodes carry the risk columns (toEpisodeRow), so
  // a sealed lifecycle classifies exactly as it did while live — which makes the check a
  // regression detector for that carry-through rather than a real risk.
  if (!statsEqual(beforeCoverage, coverageOf(applied, nowMs))) {
    throw new LedgerRebuildError(
      "Compaction aborted: coverage/efficiency would change — rolled back.",
    );
  }

  return { result, checkpoint, newly, state: applied, compactionId: options.compactionId };
}

/**
 * Compaction record for the compactions tab (the checkpoint blob lives in Drive).
 *
 * DIVERGENCE (gas/): EIGHT COLUMNS, NOT TEN. TAB_HEADERS[TABS.compactions] in
 * src/server/sheetsDb.ts carries neither `observations_pruned` nor `db_bytes_freed`; both
 * stay on `CompactionResult` (the in-memory report a caller can surface) but there is nowhere
 * on the tab to write them, and `sheetsDb.writeGrid` maps by header NAME — so emitting them
 * here would produce keys silently discarded on the way to the sheet, which reads as data
 * captured when it is data dropped. Rule 2: the column names come from the tab.
 */
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
    archive_bytes_freed: plan.result.archive_bytes_freed,
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

/** Re-exported so a caller can name the scope a replayed scan was persisted under. */
export type { Scope };
