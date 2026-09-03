// Sheets/Drive orchestration of the pure ledger core: load LedgerState, run the in-memory
// operation, write the state back with commit-record ordering.
//
// THE JOURNALED COMMIT SEQUENCE (the SQLite-transaction replacement, and the contract
// locks.ts states from the other end):
//
//   1. Idempotency, per scope, by (scan_id, scope) on the `scans` tab. A scope whose row is
//      already there is a NO-OP and answers from its stored deltas.
//   2. Load the state, write the PRE-REWRITE JOURNAL to Drive, and put its file id in
//      `journal_ref` on the job row — BEFORE any tab write.
//   3. Reconcile in memory: `ledgerCore.persistFlatScan` once per scope, in battery order,
//      on the same state.
//   4. Wholesale `overwrite` of `finding_ledger` and `resolved_episodes` (+ grid trim).
//   5. Observations file per scope, the ledger snapshot, and the `repos` tab.
//   6. LAST: append ALL the new `scans` rows in ONE `appendRows` call. THAT IS THE COMMIT.
//      Until it lands the ledger on disk is provisional and recoverIfNeeded rolls it back.
//   7. Drop the memos (the instant the commit lands), clear `journal_ref`, trash the
//      backup, bump the wiz data version.
//
// ONE SYNC, ONE syncId, THREE SCAN ROWS SHARING IT. `scan_id` is the syncId on the job row
// AND on all three scans rows; `scope` is the other half of the scans key. The COMPOSITE
// `scanIdFor(syncId, scope)` addresses DRIVE and nothing else. `scanIdFor`'s own comment
// carries the measurement that settled it — the composite in the tab kills the clock.
//
// NOTHING HERE RETURNS AN INTERNAL REF. `cursor`, `journal_ref`, `raw_ref` and `obs_ref` are
// storage addresses; `PersistOutcome` carries counts and scan ids only, and no thrown message
// names a token or the contents of a record.

import type { Scope } from "../domain/config";
import {
  baseRows,
  emptyState,
  existingScanDeltas,
  latestScan,
  persistFlatScan as coreFlat,
  scansAsc,
  severityCountsFromObservations,
} from "../domain/ledgerCore";
import type {
  BaseRow,
  Deltas,
  EpisodeRow,
  LedgerRow,
  LedgerState,
  Observation,
  ScanRow,
} from "../domain/ledgerTypes";
import {
  compactLedgerCore,
  compactionRow,
  deleteScansCore,
  type Checkpoint,
  type CompactionResult,
  type DeleteResult,
  type PayloadReader,
} from "../domain/maintenance";
import { coerceRiskSignals, type TwinStats } from "../domain/reconcile";
import type { RiskRule, SastRiskRule } from "../domain/config";
import {
  cohortSlaAttainment,
  trendFromBase,
  withCoverageEfficiency,
  withKmMedian,
  withOpenPastSla,
  withSlaBurn,
  type BackfilledTrendPoint,
} from "../domain/trend";
import { nowIso, parseTs, type Rec } from "../domain/util";
import * as archive from "./archiveStore";
import { createJob, newJobId, updateJob } from "./jobsStore";
import { bumpWizDataVersion, bumpDataVersion } from "./serverCache";
import {
  appendRows,
  dataRowCount,
  overwrite,
  readAll,
  trimSurplusRows,
  TABS,
} from "./sheetsDb";

// --------------------------------------------------------------------------- #
//  scan ids
// --------------------------------------------------------------------------- #

/**
 * THE ARCHIVE id of one scope's step of one sync: `<syncId>-<scope>`. It addresses Drive —
 * the scan folder (`scans/<id>/`) and the observation set (`obs/<id>.json.gz`) — and it is
 * NOT what goes in the `scans` tab's `scan_id` column.
 *
 * THREE HEADERS EACH STATED PART OF THIS AND THEY READ AS CONTRADICTING EACH OTHER. Settled
 * here, against a measurement rather than by picking the loudest:
 *
 *   the JOB row's `scan_id`      the bare syncId — one job, one sync, one column.
 *   each SCANS row's `scan_id`   ALSO the bare syncId. Three rows share it; `scope` is the
 *                                other half of the key.
 *   the ARCHIVE's scan id        `scanIdFor(syncId, scope)` — Drive names files, so the
 *                                three scopes need three names. That is exactly what
 *                                `archiveStore.ts`'s header means by "a three-scope sync
 *                                writes three scan FOLDERS".
 *
 * DIVERGENCE (the S3 brief): the brief called for `<syncId>-<scope>` in the `scans` tab too,
 * and MEASUREMENT REFUSED IT. `ledgerCore.persistFlatScan` sets `const scanTs = scanId` —
 * the scan row's `ts` and every ledger timestamp reconcile derives from it (`last_seen`,
 * `resolved_at`, and `first_seen` when the API gave no birth date) are the scan id, verbatim.
 * `Date.parse("2026-06-01T00:00:00Z-sca")` is `NaN`, so with a composite id in that column:
 *
 *     last_seen / resolved_at    "2026-06-01T00:00:00Z-sca"  -> parseTs null -> mttr_days null
 *     ScanRow.ts                 same string -> trend.pointTimes drops EVERY scan point,
 *                                and every series renders empty on a full register
 *
 * That is the whole product's clock, on the main path, and "a register that looks genuinely
 * empty" is the failure class this repo already has a rule about. The domain layer is
 * unambiguous about the alternative in its own words: `ledgerCore.existingScanDeltas` keys
 * idempotency on `(scan_id, scope)` BECAUSE "one sync job carries ONE scan_id and steps
 * through the scopes", and `maintenance.replayScans` says "a scan_id is NOT unique across
 * scopes here". Both were written against the shared id. So the tab keeps the shared id and
 * the clock, and the composite stays where it was actually needed — Drive.
 */
export function scanIdFor(syncId: string, scope: Scope): string {
  return `${syncId}-${scope}`;
}

/** The archive id of a saved scan row — the pair its Drive files are named by. */
function archiveIdOf(row: Pick<ScanRow, "scan_id" | "scope">): string {
  return scanIdFor(row.scan_id, row.scope);
}

// --------------------------------------------------------------------------- #
//  state load/save
// --------------------------------------------------------------------------- #

function s(r: Rec, k: string): string | null {
  const v = r[k];
  return v === null || v === undefined || v === "" ? null : String(v);
}

function n(r: Rec, k: string): number | null {
  const v = s(r, k);
  if (v === null) return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

/**
 * A ledger row's scope, from the column, falling back to the KEY PREFIX.
 *
 * The column is the authority — reconcile stamps it on every row it touches — but a row
 * written by a sheet that predates the column, or hand-edited, would come back blank, and a
 * blank scope is not a harmless null here: `baseRows` filters on the column, so such a row
 * would be invisible to its own register. `findingKey` builds the prefix and it cannot be
 * blank, so the key answers when the column will not. Same argument `ledgerCore.persistFlatScan`
 * makes for partitioning on the prefix rather than on the column.
 */
function scopeOf(key: string, raw: string | null): Scope {
  if (raw === "sca" || raw === "sast" || raw === "secrets") return raw;
  const head = key.slice(0, key.indexOf(":"));
  return head === "sast" || head === "secrets" ? head : "sca";
}

function rowToScan(r: Rec): ScanRow {
  return {
    scan_id: String(r["scan_id"] ?? ""),
    ts: String(r["ts"] ?? ""),
    // A scans row has no key to fall back on, so an unreadable scope defaults to sca the way
    // scopeOf does — but the column is written by this file on every row it appends.
    scope: scopeOf("", s(r, "scope")),
    mode: String(r["mode"] ?? ""),
    severities: s(r, "severities"),
    total: Number(r["total"] ?? 0),
    new_count: Number(r["new_count"] ?? 0),
    resolved_count: Number(r["resolved_count"] ?? 0),
    reopened_count: Number(r["reopened_count"] ?? 0),
    raw_ref: s(r, "raw_ref"),
    obs_ref: s(r, "obs_ref"),
    sealed: r["sealed"] === 1 || r["sealed"] === "1" || r["sealed"] === true ? 1 : 0,
  };
}

function rowToLedger(r: Rec): LedgerRow {
  const key = String(r["finding_key"] ?? "");
  return {
    finding_key: key,
    scope: scopeOf(key, s(r, "scope")),
    identifier: s(r, "identifier"),
    component: s(r, "component"),
    severity: s(r, "severity"),

    repo_id: s(r, "repo_id"),
    repo_name: s(r, "repo_name"),
    branch: s(r, "branch"),
    platform: s(r, "platform"),

    first_seen: s(r, "first_seen"),
    last_seen: s(r, "last_seen"),
    status: String(r["status"] ?? "OPEN"),
    resolved_at: s(r, "resolved_at"),
    resolution_src: s(r, "resolution_src"),
    reopened_count: Number(r["reopened_count"] ?? 0),
    first_scan_id: s(r, "first_scan_id"),
    last_scan_id: s(r, "last_scan_id"),

    fix_date: s(r, "fix_date"),
    fix_observed_at: s(r, "fix_observed_at"),
    fixed_version: s(r, "fixed_version"),

    // Tri-state, via the domain's own coercion: blank stays null, and the plain-text grid's
    // "TRUE"/"FALSE" round-trip is understood there rather than re-implemented here.
    ...coerceRiskSignals(r),

    cwe: s(r, "cwe"),
    ai_verdict: s(r, "ai_verdict"),
    language: s(r, "language"),
    file_path: s(r, "file_path"),
    start_line: n(r, "start_line"),
    origin: s(r, "origin"),

    secret_kind: s(r, "secret_kind"),
    rotated_at: s(r, "rotated_at"),
    removed_at: s(r, "removed_at"),
    validation_state: s(r, "validation_state"),
    validated_at: s(r, "validated_at"),
    confidence: s(r, "confidence"),

    owner_project: s(r, "owner_project"),
    owner_path: s(r, "owner_path"),
    tags_json: s(r, "tags_json"),
  };
}

function rowToEpisode(r: Rec): EpisodeRow {
  const key = String(r["finding_key"] ?? "");
  const risk = coerceRiskSignals(r);
  return {
    finding_key: key,
    scope: scopeOf(key, s(r, "scope")),
    identifier: s(r, "identifier"),
    component: s(r, "component"),
    severity: s(r, "severity"),
    first_seen: s(r, "first_seen"),
    resolved_at: s(r, "resolved_at"),
    resolution_src: s(r, "resolution_src"),
    reopened_count: Number(r["reopened_count"] ?? 0),
    compaction_id: String(r["compaction_id"] ?? ""),
    superseded_by_scan: s(r, "superseded_by_scan"),
    fix_date: s(r, "fix_date"),
    fix_observed_at: s(r, "fix_observed_at"),
    has_kev: risk.has_kev,
    has_exploit: risk.has_exploit,
    epss: risk.epss,
    cwe: s(r, "cwe"),
    language: s(r, "language"),
    owner_project: s(r, "owner_project"),
  };
}

// Per-execution memos. A single request hits loadScanRows()/loadState() several times, and
// module state dies with the execution in GAS, so memoizing is free of cross-request
// staleness. Every write path below calls invalidateLedgerMemos() after touching the
// tabs/snapshot so reads-after-write inside the same execution see fresh data.
let scanRowsMemo: ScanRow[] | undefined;
let stateMemo: LedgerState | undefined;

/**
 * Drop the memos and stale every cross-request derived cache.
 *
 * The `bumpDataVersion()` is inside rather than beside, deliberately (gas/'s arrangement): a
 * write that bumped the version without dropping the memos would serve, in the same
 * execution, state it had just invalidated. There is one way to do both and this is it.
 */
export function invalidateLedgerMemos(): void {
  scanRowsMemo = undefined;
  stateMemo = undefined;
  bumpDataVersion();
}

/** Scans tab only (cheap; enough for history/meta reads). All scopes, ts ASC. */
export function loadScanRows(): ScanRow[] {
  if (scanRowsMemo === undefined) {
    scanRowsMemo = scansAsc(readAll(TABS.scans).map(rowToScan));
  }
  return scanRowsMemo;
}

export function scanRowExists(scanId: string): boolean {
  return loadScanRows().some((r) => r.scan_id === scanId);
}

/**
 * Whether a sync's COMMIT landed: any `scans` row carrying its id prefix.
 *
 * The commit is one `appendRows` of every scope's row, so the question is all-or-nothing and
 * one row is enough to answer it. This is what `locks.recoverIfNeeded` consults to tell a job
 * that died BEFORE the append (roll the tabs back from the journal) from one that died AFTER
 * it (the rewrite is real — keep it, and only clear the journal).
 */
export function syncCommitted(syncId: string | null): boolean {
  if (!syncId) return false;
  return loadScanRows().some((r) => r.scan_id === syncId);
}

/**
 * Full state. The ledger/episodes come from the Drive snapshot when present (one gzip read
 * instead of a whole-tab getValues); the tabs are the fallback, and the next write heals the
 * snapshot. The scans backbone always comes from the TAB — it is the commit record, and a
 * snapshot written at step 5 carries scan rows that step 6 may never have committed.
 */
export function loadState(useSnapshot = true): LedgerState {
  if (useSnapshot && stateMemo !== undefined) return stateMemo;
  const state = emptyState();
  // Sliced so a core pushing its new scan row never grows the memoized array.
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
  for (const r of readAll(TABS.ledger)) {
    const row = rowToLedger(r);
    state.ledger[row.finding_key] = row;
  }
  state.episodes = readAll(TABS.episodes).map(rowToEpisode);
  if (useSnapshot) stateMemo = state;
  return state;
}

/**
 * Wholesale rewrite of finding_ledger + resolved_episodes + scans + repos, plus the snapshot.
 *
 * The recovery and replay write. `overwrite` routes through `ensureHeaders`, which brings a
 * sheet that predates a column up to the declared schema rather than dropping the value, so
 * unlike gas/ there is no separate `ensureTab` call to make first — the guard is in the
 * engine here (the same reason `jobsStore.createJob` dropped it).
 */
export function writeStateTables(state: LedgerState): void {
  overwrite(TABS.ledger, Object.values(state.ledger) as unknown as Rec[]);
  overwrite(TABS.episodes, state.episodes as unknown as Rec[]);
  overwrite(TABS.scans, scansAsc(state.scans) as unknown as Rec[]);
  overwrite(TABS.repos, repoRows(state));
  archive.writeLedgerSnapshot(state);
  invalidateLedgerMemos();
}

// --------------------------------------------------------------------------- #
//  the repos tab
// --------------------------------------------------------------------------- #

/**
 * One row per `repo_id`, merged from the ledger — the register's asset dimension.
 *
 * Latest-non-null-wins on the descriptive columns (rows are folded in `last_seen` order, and
 * a null never overwrites a value, so a scope that does not carry `branch` cannot blank one
 * another scope recorded); `first_seen` is the MIN and `last_seen` the MAX across every
 * finding in the repository, which is what makes this tab an answer about the REPOSITORY
 * rather than about whichever finding was written last.
 *
 * TWO COLUMNS ARE WRITTEN NULL ON PURPOSE, and neither is an oversight:
 *
 *   default_branch   The flag exists on the API node, and it is spelled differently per
 *                    scope — `isDefaultBranch` on sca, `resource.isDefaultBranch` on sast
 *                    (wizQueries.ts:271/275). Nothing carries it onto a ledger row, so the
 *                    only way to fill this column from here is to read it off the raw record
 *                    by a path inferred rather than measured. That inference is the exact
 *                    mistake CLAUDE.md records as having cost this register twice; a column
 *                    honestly null is cheaper than one confidently wrong.
 *   projects_json    reconcile.ownerProject/ownerPath collapse `projects[]` into two strings
 *                    and the flat list itself never reaches the ledger. reconcile.ts:241
 *                    names this column as where the real hierarchy would live once something
 *                    learns it. Nothing does yet.
 *
 * Sorted by `repo_id` so the tab is byte-stable across runs that touch no repository.
 */
function repoRows(state: LedgerState): Rec[] {
  interface Acc {
    repo_id: string;
    repo_name: string | null;
    branch: string | null;
    platform: string | null;
    owner_project: string | null;
    owner_path: string | null;
    first_seen: string | null;
    last_seen: string | null;
  }
  const byRepo = new Map<string, Acc>();
  const rows = Object.values(state.ledger).slice().sort((a, b) => {
    const ta = parseTs(a.last_seen) ?? 0;
    const tb = parseTs(b.last_seen) ?? 0;
    if (ta !== tb) return ta - tb;
    return a.finding_key < b.finding_key ? -1 : a.finding_key > b.finding_key ? 1 : 0;
  });
  for (const row of rows) {
    const id = row.repo_id;
    if (!id) continue;
    let acc = byRepo.get(id);
    if (!acc) {
      acc = {
        repo_id: id,
        repo_name: null,
        branch: null,
        platform: null,
        owner_project: null,
        owner_path: null,
        first_seen: null,
        last_seen: null,
      };
      byRepo.set(id, acc);
    }
    if (row.repo_name !== null) acc.repo_name = row.repo_name;
    if (row.branch !== null) acc.branch = row.branch;
    if (row.platform !== null) acc.platform = row.platform;
    if (row.owner_project !== null) acc.owner_project = row.owner_project;
    if (row.owner_path !== null) acc.owner_path = row.owner_path;
    acc.first_seen = earlier(acc.first_seen, row.first_seen);
    acc.last_seen = later(acc.last_seen, row.last_seen);
  }
  return [...byRepo.values()]
    .sort((a, b) => (a.repo_id < b.repo_id ? -1 : a.repo_id > b.repo_id ? 1 : 0))
    .map((a) => ({
      repo_id: a.repo_id,
      repo_name: a.repo_name,
      branch: a.branch,
      platform: a.platform,
      default_branch: null,
      owner_project: a.owner_project,
      owner_path: a.owner_path,
      projects_json: null,
      first_seen: a.first_seen,
      last_seen: a.last_seen,
    }));
}

function earlier(a: string | null, b: string | null): string | null {
  const ta = parseTs(a);
  const tb = parseTs(b);
  if (ta === null) return tb === null ? a ?? b : b;
  if (tb === null) return a;
  return tb < ta ? b : a;
}

function later(a: string | null, b: string | null): string | null {
  const ta = parseTs(a);
  const tb = parseTs(b);
  if (ta === null) return tb === null ? a ?? b : b;
  if (tb === null) return a;
  return tb > ta ? b : a;
}

// --------------------------------------------------------------------------- #
//  persist — the journaled commit sequence
// --------------------------------------------------------------------------- #

/** One scope's step of the battery, as the sync hands it over. */
export interface ScopePersist {
  scope: Scope;
  /** Already slimmed by the fetcher — no `snippet`, no `validationDetails`. Not re-shaped. */
  records: Rec[];
  mode: string;
  /** `[]` and `null` both mean unscoped; on `secrets` the gate is off and it is `[]`. */
  scannedSeverities?: Iterable<string> | null;
  /** Internal storage address of the archived raw pages. Never leaves this module. */
  rawRef?: string | null;
}

/** One scope's result. COUNTS AND IDS ONLY — no raw_ref, no obs_ref, no journal_ref. */
export interface ScopeOutcome {
  scope: Scope;
  /** The scans-tab id — the syncId, shared by every scope of this sync. See scanIdFor. */
  scan_id: string;
  deltas: Deltas;
  /** Records this scope handed in. 0 on an idempotent replay — nothing was reconciled. */
  total: number;
  /** What the secrets twin fold did; zeroed for sca/sast and on a replay. */
  twins: TwinStats | null;
  /** False when the scope's row was already on the tab and this call reconciled nothing. */
  written: boolean;
}

/**
 * What a sync gets back. Client-safe by construction: the internal refs live on the ScanRow,
 * which is deliberately NOT part of this shape.
 */
export interface PersistOutcome {
  sync_id: string;
  scopes: ScopeOutcome[];
  /** The scopes whose rows this call appended. Empty on a whole-sync idempotent replay. */
  committed_scopes: Scope[];
}

/**
 * Persist one sync's battery — every scope, one journal, ONE commit.
 *
 * DIVERGENCE (gas/): gas/ persists ONE scan per call and mints its own job when the caller
 * has none. Here the battery is the unit: three scopes reconcile onto the same in-memory
 * state and their three `scans` rows land in a single `appendRows`, so there is no window in
 * which the ledger holds sast's rewrite while the tab claims only sca ran. `jobId` is
 * therefore required — the journal has to hang off a row that already exists, and a sync that
 * has not created its job has not started.
 */
export function persistSync(
  jobId: string,
  syncId: string,
  perScope: readonly ScopePersist[],
): PersistOutcome {
  const state = loadState();

  // 1. Idempotency, per scope, on (scan_id, scope).
  const outcomes: ScopeOutcome[] = [];
  const todo: Array<{ entry: ScopePersist }> = [];
  for (const entry of perScope) {
    const stored = existingScanDeltas(state.scans, syncId, entry.scope);
    if (stored !== null) {
      outcomes.push({
        scope: entry.scope,
        scan_id: syncId,
        deltas: stored,
        total: 0,
        twins: null,
        written: false,
      });
      continue;
    }
    todo.push({ entry });
  }
  // Every scope already saved: touch NOTHING. No journal, no rewrite, no append — a replay
  // that rewrote the tabs would be a write with no commit record to justify it.
  if (!todo.length) {
    return { sync_id: syncId, scopes: outcomes, committed_scopes: [] };
  }

  // 2. Journal FIRST. The job row carries the bare syncId in `scan_id` (see scanIdFor).
  const journalRef = archive.writeBackup(jobId, state);
  updateJob(jobId, { phase: "PERSISTING", scan_id: syncId, journal_ref: journalRef });

  // 3. Reconcile in memory, in battery order, on the one state.
  const newRows: ScanRow[] = [];
  const pendingObs: Array<{ archiveId: string; keys: string[]; row: ScanRow }> = [];
  for (const { entry } of todo) {
    const out = coreFlat(state, entry.records, {
      scope: entry.scope,
      mode: entry.mode,
      // The syncId, which is also the scan's `ts`. See scanIdFor.
      scanId: syncId,
      scannedSeverities: entry.scannedSeverities ?? null,
      rawRef: entry.rawRef ?? null,
    });
    outcomes.push({
      scope: entry.scope,
      scan_id: syncId,
      deltas: out.deltas,
      total: entry.records.length,
      twins: out.twinStats,
      written: out.scanRow !== null,
    });
    if (out.scanRow) {
      newRows.push(out.scanRow);
      pendingObs.push({
        archiveId: archiveIdOf(out.scanRow),
        keys: observedKeys(out.observations),
        row: out.scanRow,
      });
    }
  }

  // 4. Wholesale rewrite. The grid trim is what actually returns cells to the 10M budget —
  // `overwrite` only clears content (sheetsDb.trimSurplusRows).
  overwrite(TABS.ledger, Object.values(state.ledger) as unknown as Rec[]);
  overwrite(TABS.episodes, state.episodes as unknown as Rec[]);
  trimSurplusRows(TABS.ledger);
  trimSurplusRows(TABS.episodes);

  // 5. Observation sets, the snapshot, the repos tab. The obs file has to exist and the row
  // has to point at it BEFORE the append, or a committed scan names a file nobody wrote.
  for (const obs of pendingObs) {
    obs.row.obs_ref = archive.writeObservations(obs.archiveId, obs.keys);
  }
  archive.writeLedgerSnapshot(state);
  overwrite(TABS.repos, repoRows(state));

  // 6. THE COMMIT. One append, every scope.
  appendRows(TABS.scans, newRows as unknown as Rec[]);
  // THE MEMOS FALL WITH THE COMMIT, not at the end of step 7, and the difference is not
  // cosmetic. `loadScanRows` was memoized before the rewrite, so between the append and an
  // invalidation the store believes the tab still has no row for this sync — and that is
  // exactly the question `locks.recoverIfNeeded` asks (`syncCommitted`) to decide whether to
  // ROLL BACK. MEASURED: with the invalidation at the end of step 7, a crash between the
  // append and the journal clear made recovery restore the journal over a committed scan,
  // deleting three scans rows and every ledger row they had just written. Pinned by
  // "does NOT roll back when the scans rows are already on disk".
  invalidateLedgerMemos(); // drops the memos AND bumps DATA_VERSION — see its comment

  // 7. The journal is spent; the register's picture of the tenant moved.
  updateJob(jobId, { journal_ref: null });
  archive.trashBackup(jobId);
  bumpWizDataVersion();

  return {
    sync_id: syncId,
    scopes: outcomes,
    committed_scopes: newRows.map((r) => r.scope),
  };
}

/**
 * The finding_keys a scan SAW — `present === 1` only.
 *
 * DIVERGENCE (gas/): gas/ archives whole `Observation` objects; S2's `archiveStore` narrowed
 * the file to a key list (`writeObservations(scanId, keys: string[])`), which is what
 * resolve-by-disappearance actually consults. The `present: 0` entries reconcile also emits
 * are the disappearances it just adjudicated — they belong to the ledger row's own resolution
 * columns, not to the record of what this scan observed. See `previousSeverityCounts` for the
 * one thing the narrower file costs.
 */
function observedKeys(observations: Observation[]): string[] {
  const keys: string[] = [];
  for (const o of observations) if (o.present === 1) keys.push(o.finding_key);
  return keys;
}

// --------------------------------------------------------------------------- #
//  readers
// --------------------------------------------------------------------------- #

/**
 * A saved scan's records, for replay. The SLIM file is the source — it is the projection
 * reconcile was fed, so a replay reads exactly what the original run read. Raw pages are the
 * fallback for a scan archived before the slim write existed.
 */
const readPayloadForRow: PayloadReader = (row: ScanRow) => {
  const id = archiveIdOf(row);
  const slim = archive.readSlim(id);
  if (slim !== null) return slim;
  const pages = archive.readScanPages(id);
  return pages.length ? pages : null;
};

export function loadBaseRows(options: { now?: number; scope?: Scope } = {}): BaseRow[] {
  return baseRows(loadState(), options);
}

/**
 * Ceiling on how many reconstructed (synthetic pre-scan) points get a full KM-median build —
 * see `trend.withKmMedian(opts.maxReconstructed)`. Real saved-scan points are never capped.
 */
const KM_TREND_MAX_RECONSTRUCTED = 48;

export interface TrendOptions {
  severities?: string[] | null;
  /**
   * When false, the open / KM-median series exclude findings awaiting a vendor fix as of each
   * historical date; a fix that lands later re-admits the row at that point. The resolved /
   * median / SLA-burn / attainment series are untouched. Default true = today's behaviour.
   */
  showNoFix?: boolean;
  /** Narrow every series to one register. A scope narrows WHICH FINDINGS are replayed AND
   *  which scans are sampled — `trendFromBase` filters the scan log too. */
  scope?: Scope;
  /** Pre-scoped base rows (already narrowed by the caller). */
  base?: BaseRow[];
}

/**
 * The MTTR trend, backfilled to the earliest detection.
 *
 * DIVERGENCE (gas/): an options object rather than four positionals, because this register
 * added a fifth axis (`scope`) that every series takes and that must reach `trendFromBase`,
 * the three SLA decorators AND `withKmMedian` — five call sites where a positional would be
 * silently droppable. The projected base carries `scope` for the same reason: the decorators
 * filter on the ROW's scope column, so a projection without it would answer for all three
 * registers under any scope filter.
 */
export function loadTrend(options: TrendOptions = {}): Rec[] {
  const state = loadState();
  const severities = options.severities ?? null;
  const scope = options.scope;
  const hideNoFix = !(options.showNoFix ?? true);
  const base = (options.base ?? baseRows(state)).map((r) => ({
    scope: r.scope,
    severity: r.severity,
    first_seen: r.first_seen,
    resolved_at: r.resolved_at,
    mttr_days: r.mttr_days,
    actionable_from: r.actionable_from,
    fix_available_at: r.fix_available_at,
  }));
  const points: BackfilledTrendPoint[] = trendFromBase(
    state.scans.map((sc) => ({ ts: sc.ts, scope: sc.scope })),
    base,
    severities,
    { backfill: true, hideNoFix, scope },
  );
  const withSla = withOpenPastSla(points, base, severities, "actionable_from", { scope });
  const withBurn = withSlaBurn(withSla, base, severities, { scope });
  const withAttainment = cohortSlaAttainment(withBurn, base, severities, { scope });
  return withKmMedian(withAttainment, base, severities, {
    hideNoFix,
    maxReconstructed: KM_TREND_MAX_RECONSTRUCTED,
    scope,
  }) as unknown as Rec[];
}

/**
 * The coverage / efficiency series for the program page.
 *
 * A sibling of `loadTrend` rather than another decorator on it: the MTTR trend's projection
 * deliberately carries only the lifecycle columns its own series read, and this one needs the
 * risk columns plus `status`.
 */
export function loadProgramTrend(
  rule?: RiskRule | SastRiskRule,
  options: { severities?: string[] | null; scope?: Scope; base?: BaseRow[] } = {},
): Rec[] {
  const state = loadState();
  const severities = options.severities ?? null;
  const scope = options.scope;
  const base = (options.base ?? baseRows(state)).map((r) => ({
    scope: r.scope,
    severity: r.severity,
    status: r.status,
    first_seen: r.first_seen,
    resolved_at: r.resolved_at,
    mttr_days: r.mttr_days,
    has_kev: r.has_kev,
    has_exploit: r.has_exploit,
    epss: r.epss,
  }));
  const points = trendFromBase(
    state.scans.map((sc) => ({ ts: sc.ts, scope: sc.scope })),
    base,
    severities,
    { backfill: true, scope },
  );
  return withCoverageEfficiency(points, base, rule, severities, { scope }) as unknown as Rec[];
}

/**
 * Per-severity counts of the SECOND-NEWEST scan of a scope — the change-badge baseline.
 *
 * DIVERGENCE (gas/), and it is a real loss rather than a simplification. gas/ reads the
 * severity straight out of the archived observation objects. S2's obs file holds finding_keys
 * ONLY, so the severities have to come from somewhere else, and the only place left is the
 * ledger — which is latest-wins on `severity`. So this prices the PREVIOUS scan's key set at
 * TODAY'S severity: the volume half of the badge (how many findings there were) is exact, and
 * the severity half understates churn, because a finding regraded between the two scans is
 * counted in the same bucket on both sides.
 *
 * Keys the ledger no longer holds (compacted into episodes, or deleted) are counted as
 * UNKNOWN by `severityCountsFromObservations`'s own normalisation rather than dropped — a
 * finding that was observed is not allowed to vanish from the baseline it belongs to.
 *
 * Closing it needs the obs file to carry severity, which is `archiveStore`'s contract and not
 * this file's to change.
 */
export function previousSeverityCounts(scope: Scope): Record<string, number> {
  const rows = scansAsc(loadScanRows(), scope);
  if (rows.length < 2) return {};
  const prev = rows[rows.length - 2]!;
  const ledger = loadState().ledger;
  const observations = archive.readObservations(archiveIdOf(prev)).map((key) => ({
    present: 1 as const,
    severity: ledger[key]?.severity ?? null,
  }));
  return severityCountsFromObservations(observations);
}

/** The most recent scan OF `scope`. Scope is required — see `ledgerCore.latestScan`. */
export function latestScanRow(scope: Scope): ScanRow | null {
  return latestScan(loadScanRows(), scope);
}

/**
 * Repoint ONE scan row at a rewritten observations file.
 *
 * `writeGzJson` trashes the same-named file and creates a fresh one, so rewriting an obs file
 * yields a NEW Drive id and the old `scans.obs_ref` points at a trashed one — and
 * `previousSeverityCounts` reads through that ref.
 *
 * DIVERGENCE (gas/): it takes the SCOPE as well, and rewrites the tab rather than using
 * `updateWhere`. `updateWhere` patches the FIRST row matching one column, and `scan_id` names
 * three rows here — so the gas/ signature would silently repoint sca's row whichever scope
 * asked. The read-modify-write costs one extra tab read on a path that runs after a manual
 * obs rewrite, which is not a path that runs often.
 */
export function setScanObsRef(scanId: string, scope: Scope, obsRef: string): void {
  const rows = loadScanRows();
  const target = rows.find((r) => r.scan_id === scanId && r.scope === scope);
  if (!target) return;
  target.obs_ref = obsRef;
  overwrite(TABS.scans, scansAsc(rows) as unknown as Rec[]);
  invalidateLedgerMemos();
}

// --------------------------------------------------------------------------- #
//  checkpoints (compaction's baseline blob)
// --------------------------------------------------------------------------- #

/**
 * A checkpoint's storage ref is its FILE NAME, not a Drive id.
 *
 * DIVERGENCE (gas/): gas/'s `archiveStore` has a typed checkpoint API returning ids; S2's
 * reserved the `checkpoints/` folder with no typed API at all and addresses everything else
 * by name. The name is derived from the compaction id, so it is stable, and it stays an
 * internal storage address either way — `checkpoint_ref` is never client-facing.
 */
function checkpointName(compactionId: string): string {
  return `checkpoint-${compactionId.replace(/[^0-9A-Za-z._-]/g, "")}.json.gz`;
}

function readCheckpointRef(ref: string | null): Checkpoint | null {
  if (!ref) return null;
  const parsed = archive.readGzJson(archive.subfolder("checkpoints"), ref);
  return parsed && typeof parsed === "object" ? (parsed as Checkpoint) : null;
}

/** The newest compaction's checkpoint — the rebuild baseline. */
function latestCheckpoint(): Checkpoint | null {
  const rows = readAll(TABS.compactions).filter((r) => r["checkpoint_ref"]);
  if (!rows.length) return null;
  rows.sort((a, b) => (String(a["ts"]) < String(b["ts"]) ? 1 : -1));
  return readCheckpointRef(String(rows[0]!["checkpoint_ref"]));
}

// --------------------------------------------------------------------------- #
//  journaled maintenance writes (delete / compact)
// --------------------------------------------------------------------------- #

/**
 * Write the pre-rewrite journal and put its ref on a job row, creating the row when the
 * caller has no job of its own. Returns the job id.
 *
 * DIVERGENCE (gas/): gas/ mints `newJobId("delete")` / `newJobId("compact")` and its
 * `JobPhase` has a `REPLAYING` state. This register's `JobKind` is `"sync"` and nothing else,
 * and its phases stop at PERSISTING — so a maintenance write borrows the sync kind and the
 * PERSISTING phase rather than inventing a member of a union `jobsStore` owns. That is also
 * what makes `locks.recoverIfNeeded` cover these writes for free: it recognises the journal by
 * PHASE, not by kind. `scan_id` stays null on these rows, which is exactly what keeps them out
 * of recovery's commit-record branch and in its journal-restore one.
 */
function openJournaledJob(jobId: string | undefined, state: LedgerState, params: string): string {
  const jid = jobId ?? newJobId("sync");
  const journalRef = archive.writeBackup(jid, state);
  if (jobId) {
    updateJob(jid, { phase: "PERSISTING", journal_ref: journalRef });
  } else {
    createJob({
      job_id: jid,
      kind: "sync",
      phase: "PERSISTING",
      scan_id: null,
      scope: null,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: params,
      journal_ref: journalRef,
      error: null,
    });
  }
  return jid;
}

/** Close a journaled maintenance write: terminal phase, journal cleared, backup trashed. */
function closeJournaledJob(jobId: string, now?: number): void {
  updateJob(jobId, { phase: "DONE", journal_ref: null }, now);
  archive.trashBackup(jobId);
}

// --------------------------------------------------------------------------- #
//  delete
// --------------------------------------------------------------------------- #

/**
 * Journaled delete-scans with survivor replay.
 *
 * Validation happens inside the core BEFORE any mutation, so a `SealedScanError` /
 * `LedgerRebuildError` leaves the tabs untouched.
 */
export function deleteScans(scanIds: string[], jobId?: string): DeleteResult {
  const state = loadState();
  const checkpoint = latestCheckpoint();
  const { state: rebuilt, result } = deleteScansCore(
    state,
    scanIds,
    readPayloadForRow,
    checkpoint,
  );
  if (!result.deleted) return result;

  const jid = openJournaledJob(jobId, state, JSON.stringify({ deleteScans: scanIds.length }));

  // NO OBS REWRITE, and that is a consequence of S2's narrower obs file rather than an
  // omission. gas/ regenerates every replayed scan's observations here because its file holds
  // whole `Observation` objects — including the `present: 0` disappearance entries, which DO
  // change when a neighbouring scan is deleted. This register's file holds the keys a scan
  // SAW (`observedKeys`, present === 1), and that set is a property of the scan's own payload:
  // the replay feeds the same payload back, so the same keys come out. The files are invariant
  // under a delete, and rewriting them would also have had to work around
  // `maintenance.replayScans` keying its map by `scan_id` alone — which names three rows here,
  // and whose own comment says the last scope wins.
  writeStateTables(rebuilt);

  closeJournaledJob(jid);
  bumpWizDataVersion();

  // Post-commit, best effort: the deleted scans' archives and obs files.
  const survivors = new Set(rebuilt.scans.map(archiveIdOf));
  for (const r of state.scans) {
    const id = archiveIdOf(r);
    if (!survivors.has(id)) archive.trashScan(id);
  }
  return result;
}

// --------------------------------------------------------------------------- #
//  reset
// --------------------------------------------------------------------------- #

export interface ResetCounts {
  scans: number;
  findings: number;
  episodes: number;
  repos: number;
  compactions: number;
}

/**
 * Return the ledger to a fresh, never-compacted state.
 *
 * Clears the scans / finding_ledger / resolved_episodes / repos / compactions / jobs tabs and
 * empties the fast-read snapshot. Clearing `jobs` drops any stuck job, so `activeJob()`
 * returns null and a stray continuation trigger fires once, finds nothing, and self-deletes.
 * Drive archives are left in place — scan-id-keyed orphans no remaining row references.
 *
 * DIVERGENCE (gas/): gas/ trashes the snapshot file; S2's `archiveStore` exports no
 * `trashLedgerSnapshot` and keeps the file name private, so the snapshot is REWRITTEN EMPTY
 * instead. Same answer on the read path (`loadState` gets an empty ledger either way) and one
 * fewer reason to reach into another package's naming.
 */
export function resetLedger(): ResetCounts {
  const counts: ResetCounts = {
    scans: loadScanRows().length,
    findings: dataRowCount(TABS.ledger),
    episodes: dataRowCount(TABS.episodes),
    repos: dataRowCount(TABS.repos),
    compactions: readAll(TABS.compactions).length,
  };
  overwrite(TABS.scans, []);
  overwrite(TABS.ledger, []);
  overwrite(TABS.episodes, []);
  overwrite(TABS.repos, []);
  overwrite(TABS.compactions, []);
  overwrite(TABS.jobs, []);
  archive.writeLedgerSnapshot(emptyState());
  invalidateLedgerMemos();
  return counts;
}

// --------------------------------------------------------------------------- #
//  maintenance
// --------------------------------------------------------------------------- #

export interface MaintenancePreview {
  /** The dry-run compaction plan's numbers — identical to what a real run would report. */
  compaction: CompactionResult;
  scans: number;
  findings: number;
  episodes: number;
}

/**
 * The Data page's dry run, from one state read.
 *
 * DIVERGENCE (gas/): gas/ returns THREE previews — severity purge, episode prune, history
 * trim. None of the three has a port here and two of them cannot: `domain/purge.ts` has no
 * counterpart in this tree (nothing in the maintenance package exports its predicates), and
 * `historyStore` stores one file per UTC day with no trim in its API at all. So this previews
 * the one maintenance operation the register actually has. Do not widen the shape ahead of
 * the code — a preview of an operation that cannot run is worse than no preview.
 */
export function previewMaintenance(
  retentionDays: number | null,
  now?: number,
): MaintenancePreview {
  const state = loadState();
  const nowMs = now ?? Date.now();
  const plan = compactLedgerCore(state, retentionDays, latestCheckpoint(), readPayloadForRow, {
    dryRun: true,
    now: nowMs,
    compactionId: compactionIdFor(nowMs),
  });
  return {
    compaction: plan.result,
    scans: state.scans.length,
    findings: Object.keys(state.ledger).length,
    episodes: state.episodes.length,
  };
}

function compactionIdFor(nowMs: number): string {
  return `cmp-${nowIso(nowMs).replace(/[:]/g, "")}`;
}

// --------------------------------------------------------------------------- #
//  compact
// --------------------------------------------------------------------------- #

/**
 * Journaled compaction; the checkpoint blob lands on Drive.
 *
 * `archive_bytes_freed` IS A LOWER BOUND AND SAYS SO. S2's archive API prices whole
 * subfolders (`archiveBytes()`), never one scan, so the figure is summed from the sealed
 * scans' own folders (pages + slim + page runs) and EXCLUDES their observation files, which
 * live by name in a shared folder with no size accessor. Publishing the bound is the rule
 * this register already follows for a curve that never reaches half.
 */
export function compactLedger(
  retentionDays: number | null,
  dryRun = false,
  now?: number,
): CompactionResult {
  const state = loadState();
  const prevCheckpoint = latestCheckpoint();
  const nowMs = now ?? Date.now();
  const compactionId = compactionIdFor(nowMs);

  // Two passes: plan once to learn the candidates, then attach the exact accounting (the
  // plan is deterministic, so the preview and the real run report identical numbers).
  const probe = compactLedgerCore(state, retentionDays, prevCheckpoint, readPayloadForRow, {
    dryRun: true,
    now: nowMs,
    compactionId,
  });
  if (probe.result.no_op) return probe.result;

  const obsCountByScan: Record<string, number> = {};
  let archiveBytes = 0;
  for (const r of probe.newly) {
    obsCountByScan[r.scan_id] = archive.readObservations(archiveIdOf(r)).length;
    archiveBytes += scanFolderBytes(archiveIdOf(r));
  }

  const plan = compactLedgerCore(state, retentionDays, prevCheckpoint, readPayloadForRow, {
    dryRun,
    now: nowMs,
    compactionId,
    obsCountByScan,
    archiveBytes,
  });
  if (dryRun || plan.state === null) return plan.result;

  const jobId = openJournaledJob(undefined, state, JSON.stringify({ retentionDays }));

  // Only the latest compaction keeps a checkpoint blob (each floor supersedes the previous);
  // older rows keep their stats but lose the ref.
  const ref = checkpointName(compactionId);
  archive.writeGzJson(archive.subfolder("checkpoints"), ref, plan.checkpoint);
  const compactions: Rec[] = readAll(TABS.compactions).map((r) => ({
    ...r,
    checkpoint_ref: null,
  }));
  compactions.push(compactionRow(plan, ref, nowMs));
  overwrite(TABS.compactions, compactions);

  writeStateTables(plan.state);
  closeJournaledJob(jobId, nowMs);

  // Post-commit: prune the sealed scans' archives (best effort).
  let freed = 0;
  for (const r of plan.newly) {
    const id = archiveIdOf(r);
    freed += scanFolderBytes(id);
    archive.trashScan(id);
  }
  plan.result.archive_bytes_freed = freed;
  return plan.result;
}

/** One scan folder's bytes — pages, slim and page runs. Excludes the obs file (see above). */
function scanFolderBytes(scanId: string): number {
  let total = 0;
  try {
    const files = archive.scanFolder(scanId).getFiles();
    while (files.hasNext()) total += files.next().getSize();
  } catch {
    // A folder that is gone has freed its bytes already; an unreadable one is not worth
    // failing a committed compaction over. Never name the scan in a thrown message.
    return 0;
  }
  return total;
}
