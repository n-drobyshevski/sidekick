// Pure in-memory ledger machinery for the three-scope code register — the port of
// gas/src/domain/ledgerCore.ts.
//
// SQLite gave the Python app cheap per-scan transactions; Sheets does not. So the GAS port
// runs every persist against a plain in-memory LedgerState (this module, fully unit-testable)
// and lets the server layer read and write that state wholesale at the edges. The algorithms
// — reconcile invocation, prev-scan maps, episode collisions — are line-for-line ports of
// gas/'s, generalised in exactly one way: THERE IS ONE LEDGER AND `scope` IS PART OF THE KEY.
//
// WHAT THAT GENERALISATION IS, PRECISELY. gas/'s register had one population, so "the
// previous scan" was unambiguous. Here three registers share one scans tab and one ledger,
// and a sca scan says nothing about whether a secret is still in HEAD. Every reader that
// gas/ wrote against the whole scan log therefore takes a scope and filters to it FIRST; the
// walk itself is unchanged. `latestScan` and `disappearanceWindow` (whose one-scan special
// case is gas/'s `prevScanIdBySeverity`, kept below) are the ones that matter, because both
// feed resolve-by-disappearance: reading the previous scan of ANY scope there would resolve
// every open row of the other two registers on the first interleaved sync.
//
// THE SHAPES LIVE IN ledgerTypes.ts (ScanRow / EpisodeRow / LedgerState / BaseRow / Deltas /
// Observation), not here — this module imports them and declares none of its own. gas/
// declared them in this file; splitting them out is what let the rest of the domain layer be
// written against the ledger before the machinery landed.
//
// FIVE DIVERGENCES FROM gas/, each argued at its site:
//   1. `existingScanDeltas` keys on (scan_id, scope), not scan_id alone.
//   2. `persistFlatScan` hands reconcile ONLY this scope's rows — measured, see the note there.
//   3. `persistGroupedScan` / `reinsertScanRow` are not ported — there is no grouped shape.
//   4. `baseRows` has no REMEDIATION_ROLLOUT_ISO branch — this register has no legacy rows.
//   5. `baseRows` collapses the fix clock onto first_seen for sast and secrets.
// Divergences 1 and 2 share one premise — that a scan_id spans the three scopes — and both
// are defects that would have shipped looking like success: the first as an idempotent replay
// that reconciled nothing, the second as a remediation figure that counted three registers.

import {
  DISAPPEARANCE_RESOLUTION,
  FETCH_RETURNS_RESOLVED,
  RESOLUTION_REPO_DROPOUT,
  SEVERITY_ORDER,
  isRepoDropout,
  type Scope,
} from "./config";
import { parseSeverities, serializeSeverities } from "./compaction";
import { reconcile, emptyTwinStats, type AbsenceStats, type TwinStats } from "./reconcile";
import {
  assessCompleteness,
  disappearanceValue,
  readDisappearance,
} from "./scanCompleteness";
import type {
  BaseRow,
  Deltas,
  DisappearanceWindow,
  EpisodeRow,
  LedgerRow,
  LedgerState,
  Observation,
  ScanRow,
} from "./ledgerTypes";
import { normalizeSeverity } from "./severity";
import { cmp, entryDaysFrom, nowIso, parseTs, toIso, type Rec } from "./util";

const DAY_MS = 86_400_000;

/** Placeholder repo_name on a row rehydrated from a sealed episode (gas/'s COMPACTED_ASSET). */
export const COMPACTED_ASSET = "(compacted)";

export function emptyState(): LedgerState {
  return { scans: [], ledger: {}, episodes: [] };
}

// --------------------------------------------------------------------------- #
//  Scan-log readers — every one of them scope-aware
// --------------------------------------------------------------------------- #

/**
 * Scans ordered ts ASC, scan_id ASC (the delete/compact iteration order), optionally narrowed
 * to one scope.
 *
 * The filter is optional HERE and required on `latestScan` / `prevScanIdBySeverity` below,
 * and the asymmetry is deliberate: this function's answer ("the scan log, in order") is
 * meaningful for the whole register, while theirs ("what did the previous run see") is only
 * ever meaningful within one.
 */
export function scansAsc(scans: ScanRow[], scope?: Scope): ScanRow[] {
  const rows = scope === undefined ? [...scans] : scans.filter((r) => r.scope === scope);
  return rows.sort((a, b) => {
    const ta = parseTs(a.ts) ?? 0;
    const tb = parseTs(b.ts) ?? 0;
    if (ta !== tb) return ta - tb;
    return cmp(a.scan_id, b.scan_id);
  });
}

/**
 * The most recent scan OF `scope` (ORDER BY ts DESC LIMIT 1), or null.
 *
 * `scope` is required. It is what `persistFlatScan` hands reconcile as `prevScanId`, and
 * reconcile resolves by disappearance against it — so answering with another register's scan
 * would mark every open row of this one as remediated the first time two scopes interleave.
 */
export function latestScan(scans: ScanRow[], scope: Scope): ScanRow | null {
  const asc = scansAsc(scans, scope);
  return asc.length ? asc[asc.length - 1]! : null;
}

/**
 * {severity: scan_id} of the most recent prior scan OF `scope` whose severity scope covered
 * it — the per-severity disappearance guard (ledger._prev_scan_id_by_severity). null when
 * `scope` has no scans.
 *
 * The generalisation is the filter and nothing else: narrow the log to `scope`, then walk it
 * newest-first exactly as gas/ does. Same argument as `latestScan` — the guard exists to say
 * "nobody looked for this severity in the previous run", and the previous run of a different
 * register did not look for ANY of this one's findings.
 *
 * On secrets the map is uniform in practice: `DEFAULT_FETCH_SEVERITIES.secrets` is empty, the
 * gate is off, `severities` serializes to null, and an unscoped scan covers every severity —
 * so the first secrets scan reached fills the whole map. That is the correct answer, not a
 * degenerate one: an unscoped scan really did look for all of them.
 *
 * `persistFlatScan` no longer reads this — it reads `disappearanceWindow`, below, which is
 * this map with deferred scans added. It stays because it is the shape the gas/ fixture
 * (`test/fixtures/reconcile.json`) pins and the shape reconcile still accepts from a caller
 * that passes no window.
 */
export function prevScanIdBySeverity(
  scans: ScanRow[],
  scope: Scope,
): Record<string, string> | null {
  const remaining = new Set<string>(SEVERITY_ORDER);
  const mapping: Record<string, string> = {};
  const desc = scansAsc(scans, scope).reverse();
  for (const r of desc) {
    const sevScope = parseSeverities(r.severities);
    const covered =
      sevScope === null ? [...remaining] : [...remaining].filter((s) => sevScope.includes(s));
    for (const sev of covered) mapping[sev] = r.scan_id;
    covered.forEach((s) => remaining.delete(s));
    if (!remaining.size) break;
  }
  return Object.keys(mapping).length ? mapping : null;
}

/**
 * The scans a row may have last been seen in for its absence from the NEXT scan of `scope` to
 * resolve it — `prevScanIdBySeverity` generalised over deferred scans. null when `scope` has
 * no scans.
 *
 * Per severity: walking the scope's log newest-first, every scan covering the severity joins
 * the window, and the walk stops at the first COMPLETE one. A deferred scan resolved nothing by
 * absence (scanCompleteness.ts), so what it failed to see is still waiting on a verdict — and
 * so is what it DID see, if the next scan misses it. Both are in the window; nothing older is,
 * because the newest complete covering scan already adjudicated everything before it.
 *
 * A legacy row (blank `disappearance`) is complete. With no deferred scan in the log every
 * window is the one scan `prevScanIdBySeverity` names and `fallback` is `latestScan`, so a
 * register that never deferred resolves exactly as it did before the gate existed.
 *
 * `fallback` answers a severity the map does not name — the same role `prevScanId` plays in
 * reconcile's `?? prevScanId` — and is coverage-blind: the newest scans back to the newest
 * complete one.
 */
export function disappearanceWindow(
  scans: ScanRow[],
  scope: Scope,
): DisappearanceWindow | null {
  const desc = scansAsc(scans, scope).reverse();
  if (!desc.length) return null;
  const remaining = new Set<string>(SEVERITY_ORDER);
  const bySeverity: Record<string, string[]> = {};
  for (const r of desc) {
    const sevScope = parseSeverities(r.severities);
    const deferred = readDisappearance(r.disappearance).deferred;
    const covered =
      sevScope === null ? [...remaining] : [...remaining].filter((s) => sevScope.includes(s));
    for (const sev of covered) {
      const ids = bySeverity[sev];
      if (ids) ids.push(r.scan_id);
      else bySeverity[sev] = [r.scan_id];
    }
    if (!deferred) covered.forEach((s) => remaining.delete(s));
    if (!remaining.size) break;
  }
  const fallback: string[] = [];
  for (const r of desc) {
    fallback.push(r.scan_id);
    if (!readDisappearance(r.disappearance).deferred) break;
  }
  return { bySeverity, fallback };
}

/**
 * Stored deltas if this scan is already saved (idempotency), else null.
 *
 * DIVERGENCE (gas/): THE KEY IS (scan_id, scope), NOT scan_id. gas/ had one register, so a
 * scan_id identified a scan. Here one sync job carries ONE scan_id and steps through the
 * scopes — jobsStore.ts says so in its own header ("sync_id -> scan_id ... step_index ->
 * scope: the battery's step IS a scope"), and TAB_HEADERS[TABS.scans] carries both columns.
 * Keying on scan_id alone would make the sca step's row answer for the sast and secrets steps
 * of the same sync: both would return sca's deltas, write no scan row, and reconcile nothing,
 * while every caller saw a successful idempotent replay. `scope` is optional only so a caller
 * asking the whole-register question ("is this scan_id known at all") can still ask it.
 */
export function existingScanDeltas(
  scans: ScanRow[],
  scanId: string,
  scope?: Scope,
): Deltas | null {
  const row = scans.find(
    (r) => r.scan_id === scanId && (scope === undefined || r.scope === scope),
  );
  if (!row) return null;
  return {
    new_count: row.new_count,
    resolved_count: row.resolved_count,
    reopened_count: row.reopened_count,
  };
}

// --------------------------------------------------------------------------- #
//  persist
// --------------------------------------------------------------------------- #

/**
 * Restore uncompacted semantics when a scan re-lists a finding whose ledger row was compacted
 * into resolved_episodes (ledger._reconcile_episode_collisions). Mutates updated / deltas /
 * episodes in place.
 *
 * Episodes carry `scope` and finding_keys are scope-prefixed, so no scope filter is needed
 * here: a key collision across scopes is impossible by construction.
 */
function reconcileEpisodeCollisions(
  state: LedgerState,
  updated: Record<string, LedgerRow>,
  existingLedger: Record<string, LedgerRow>,
  deltas: Deltas,
  scanId: string,
  absence: AbsenceStats,
): void {
  const newKeys = Object.keys(updated).filter((k) => !(k in existingLedger));
  if (!newKeys.length) return;
  const newKeySet = new Set(newKeys);
  const episodeReopens = new Map<string, EpisodeRow>();
  for (const e of state.episodes) {
    if (e.superseded_by_scan === null && newKeySet.has(e.finding_key)) {
      episodeReopens.set(e.finding_key, e);
    }
  }
  for (const [key, episode] of episodeReopens) {
    const row = updated[key]!;
    if (episode.resolution_src === RESOLUTION_REPO_DROPOUT) {
      // A repository drop-out that was sealed before its repository came back. The same rule
      // reconcile applies to a live drop-out row: the episode RESUMES — its first_seen, reopen
      // count and sticky fix clock carry over, and the row is neither new nor reopened in the
      // deltas. WHETHER OR NOT the returning node is still open: one the API now reports
      // resolved closed on the fresh row as an API resolution (counted in resolved_count,
      // exactly as the live path's resume-then-close counts it), and the sealed episode,
      // which never measured a fix, must not stay authoritative over the one that did.
      row.reopened_count = Number(episode.reopened_count ?? 0);
      if (episode.first_seen !== null && (row.first_seen === null || episode.first_seen < row.first_seen)) {
        row.first_seen = episode.first_seen;
      }
      if (episode.fix_date != null) row.fix_date = episode.fix_date;
      if (episode.fix_observed_at != null) row.fix_observed_at = episode.fix_observed_at;
      deltas.new_count -= 1;
      absence.resumed += 1;
      episode.superseded_by_scan = scanId;
    } else if (row.status === "OPEN") {
      // Genuine reopen of a compacted resolution: seed the episode's reopen count,
      // reclassify new -> reopened, and mark the episode superseded.
      row.reopened_count = Number(episode.reopened_count ?? 0) + 1;
      deltas.new_count -= 1;
      deltas.reopened_count += 1;
      episode.superseded_by_scan = scanId;
    } else {
      // The API re-listed an already-counted old resolution: the episode stays authoritative;
      // drop the fresh row and undo its deltas.
      //
      // TAKE THE ATTRIBUTION OFF IT FIRST. DIVERGENCE (gas/): gas/ transfers `tags_json`
      // here, because that bag is where its findings' DOMAIN comes from. This register's
      // EpisodeRow has no tags_json column at all — ownership here is the project hierarchy,
      // and `owner_project` is the column a sealed episode is attributed by. The argument is
      // gas/'s unchanged: the query re-lists these sealed lifecycles on every scan, so the
      // attribution is handed to us for free, and dropping the row unread is what leaves a
      // resolved finding permanently unattributable — thinning every by-owner figure as the
      // retention floor advances, with the stats-identity gate reporting green because it
      // never looked at attribution. Fill-only, never overwrite: an episode that already
      // carries an owner keeps its own.
      if (!episode.owner_project && row.owner_project) episode.owner_project = row.owner_project;
      delete updated[key];
      deltas.new_count -= 1;
      deltas.resolved_count -= 1;
    }
  }
}

export interface PersistFlatOptions {
  /**
   * REQUIRED. One call per scope: it selects reconcile's node projection, prefixes every
   * finding_key, is stamped on every ledger row, and is written to the scan row. There is no
   * default, for the same reason ReconcileOptions has none.
   */
  scope: Scope;
  mode: string;
  scanId?: string | null;
  disappearanceMode?: "scan_ts" | "midpoint" | null;
  /**
   * The severities this scan actually asked for; null (or an empty list) means unscoped.
   * On secrets the gate is off — `DEFAULT_FETCH_SEVERITIES.secrets` is `[]`, which
   * serializeSeverities turns into null — so a secrets scan row carries `severities: null`
   * and reconcile applies no severity guard to it. That is the whole CODE population by
   * design (CLAUDE.md: severity grades a DETECTION, not whether a credential is live).
   */
  scannedSeverities?: Iterable<string> | null;
  rawRef?: string | null;
  obsRef?: string | null;
  now?: number;
  /**
   * LIVE: the fetch's own account of itself. When given, the completeness gate runs
   * (scanCompleteness.ts), its verdict is written to the scan row, and a complete scan also
   * runs the repository drop-out pass.
   */
  completeness?: { reportedTotal: number | null; partialPages: number } | null;
  /**
   * REPLAY: a stored scan row's completeness record, re-applied rather than re-assessed — the
   * tenant's total and the partial-page count are facts of the original fetch that the
   * archived records cannot reproduce. A blank `disappearance` is a legacy row and replays
   * under the old rules (no gate, no drop-out). Wins over `completeness` when both are given.
   */
  stored?: Pick<
    ScanRow,
    "reported_total" | "partial_pages" | "duplicates" | "disappearance"
  > | null;
}

export interface PersistFlatResult {
  deltas: Deltas;
  observations: Observation[];
  scanRow: ScanRow | null;
  /**
   * What the secrets twin fold did, passed straight through from reconcile so a sync can
   * REPORT it rather than infer it. Zeroed for sca and sast, and on an idempotent no-op.
   */
  twinStats: TwinStats;
  /** The absence side of the scan (reconcile's `AbsenceStats`); zeroed on a no-op. */
  absence: AbsenceStats;
}

function emptyAbsence(): AbsenceStats {
  return { absent: 0, dropouts: 0, dropoutRepos: 0, resumed: 0 };
}

/**
 * Save a flat per-finding scan of ONE scope into the state and reconcile the ledger — the
 * pure core of ledger.persist_flat_scan. Mutates state; returns the deltas and the scan's
 * observations (the caller persists those to Drive).
 *
 * DIVERGENCE (gas/): there is no `persistGroupedScan` and no `reinsertScanRow`. gas/'s
 * grouped-by-asset shape does not exist here — every scope's fetch is a flat per-finding
 * scan, `ScanRow` has no `shape` column at all (ledgerTypes.ts), and compaction.ts already
 * drops the matching `shape === "flat"` filter for the same reason. Porting them would add a
 * column to the scans tab that nothing writes and a code path nothing reaches.
 */
export function persistFlatScan(
  state: LedgerState,
  records: Rec[],
  options: PersistFlatOptions,
): PersistFlatResult {
  const scope = options.scope;
  const scanId = options.scanId || nowIso(options.now);
  const scanTs = scanId;
  const disappearanceMode = options.disappearanceMode ?? DISAPPEARANCE_RESOLUTION;
  const severitiesText = serializeSeverities(options.scannedSeverities ?? null);
  const sevScope = parseSeverities(severitiesText); // canonical, or null for unscoped

  const existing = existingScanDeltas(state.scans, scanId, scope);
  if (existing !== null) {
    return {
      deltas: existing,
      observations: [],
      scanRow: null,
      twinStats: emptyTwinStats(),
      absence: emptyAbsence(),
    };
  }

  // Every one of these reads is scoped — see latestScan / disappearanceWindow.
  const prev = latestScan(state.scans, scope);
  const prevScanId = prev ? prev.scan_id : null;
  const prevScanTs = prev ? prev.ts : null;
  const window = prevScanId !== null ? disappearanceWindow(state.scans, scope) : null;

  // THE LEDGER IS PARTITIONED BEFORE IT GOES IN, and this is not tidiness — it is the third
  // place the "one ledger, three registers" generalisation has to be made, and the one that
  // bites hardest. reconcile's disappearance loop walks EVERY row of the ledger it is handed;
  // its only cross-scope protection is the window-membership test on `row.last_scan_id`,
  // which holds right up until two scopes share a scan id — and jobsStore.ts says they always
  // do (one sync job carries one scan_id and steps through the scopes). MEASURED on the
  // interleaved case in
  // test/ledgerCore.test.ts: handing reconcile the whole ledger made the sca step of the
  // second sync report `resolved_count: 3`, closing the sast and secrets rows of registers it
  // had not looked at. Scoped, it reports 1.
  //
  // Partitioned on the KEY PREFIX rather than the `scope` column: findingKey builds the prefix
  // and it cannot be blank, whereas the column can be on a row read back from a sheet — and a
  // row invisible to its own register would never be adjudicated again. The three prefixes are
  // mutually exclusive with the ":" in place ("sca:", "sast:", "secrets:").
  const prefix = `${scope}:`;
  const existingLedger: Record<string, LedgerRow> = {};
  const otherScopes: Record<string, LedgerRow> = {};
  for (const [key, row] of Object.entries(state.ledger)) {
    if (key.startsWith(prefix)) existingLedger[key] = row;
    else otherScopes[key] = row;
  }

  // THE COMPLETENESS DECISION — made once, at live persist, and stored; a replay reads it
  // back. Three cases, and the third is the one that keeps old registers byte-stable:
  //   stored        replay of a saved row: its verdict and its record, verbatim
  //   completeness  a live scan: assess, record, and run the drop-out pass if complete
  //   neither       a legacy caller: no gate, no drop-out, every new column null
  //
  // The drop-out pass also needs a fetch that returns RESOLVED findings — only then is a
  // repository with no node at all evidence that it left coverage rather than that its
  // findings were fixed (config.ts's FETCH_RETURNS_RESOLVED). SAST's fetch returns open
  // findings only, so it never runs there and its scan rows record `dropout_count` as null:
  // not measured, rather than a measured zero.
  const dropoutEvidence = FETCH_RETURNS_RESOLVED[scope];
  let reportedTotal: number | null = null;
  let partialPages: number | null = null;
  let duplicates: number | null = null;
  let disappearance: string | null = null;
  let deferDisappearance = false;
  let detectDropouts = false;
  if (options.stored) {
    const verdict = readDisappearance(options.stored.disappearance);
    reportedTotal = options.stored.reported_total ?? null;
    partialPages = options.stored.partial_pages ?? null;
    duplicates = options.stored.duplicates ?? null;
    disappearance = verdict.legacy ? null : String(options.stored.disappearance).trim();
    deferDisappearance = verdict.deferred;
    detectDropouts = dropoutEvidence && !verdict.legacy && !verdict.deferred;
  } else if (options.completeness) {
    // "empty" asks whether the register holds anything this scan could have resolved — the
    // OPEN rows of this scope inside its severity scope.
    const inScope = sevScope === null ? null : new Set(sevScope);
    let priorOpen = 0;
    for (const row of Object.values(existingLedger)) {
      if (row.status !== "OPEN") continue;
      if (inScope !== null && (row.severity === null || !inScope.has(row.severity))) continue;
      priorOpen += 1;
    }
    reportedTotal = options.completeness.reportedTotal;
    partialPages = options.completeness.partialPages;
    const verdict = assessCompleteness({ records, reportedTotal, partialPages, priorOpen });
    duplicates = verdict.duplicates;
    disappearance = disappearanceValue(verdict.reason);
    deferDisappearance = verdict.reason !== null;
    detectDropouts = dropoutEvidence && verdict.reason === null;
  }

  const { ledger: updated, observations, deltas, twinStats, absence } = reconcile(
    records,
    existingLedger,
    scanId,
    scanTs,
    prevScanId,
    {
      scope,
      disappearanceMode,
      prevScanTs,
      scannedSeverities: sevScope,
      disappearanceWindow: window,
      deferDisappearance,
      detectDropouts,
    },
  );

  reconcileEpisodeCollisions(state, updated, existingLedger, deltas, scanId, absence);

  const scanRow: ScanRow = {
    scan_id: scanId,
    ts: scanTs,
    scope,
    mode: options.mode,
    severities: severitiesText,
    total: records.length,
    new_count: deltas.new_count,
    resolved_count: deltas.resolved_count,
    reopened_count: deltas.reopened_count,
    raw_ref: options.rawRef ?? null,
    obs_ref: options.obsRef ?? null,
    sealed: 0,
    reported_total: reportedTotal,
    partial_pages: partialPages,
    duplicates,
    disappearance,
    // Null where it was not measured: a legacy row never ran the pass, a deferred one ran no
    // absence at all, and a SAST scan cannot run it. A complete scan with no drop-out records
    // a measured 0.
    dropout_count: detectDropouts ? absence.dropouts : null,
  };
  state.scans.push(scanRow);
  // reconcile copies rather than mutates, so the other scopes' rows go back in by reference,
  // byte-identical to what came out.
  state.ledger = { ...otherScopes, ...updated };
  return { deltas, observations, scanRow, twinStats, absence };
}

// --------------------------------------------------------------------------- #
//  Base rows (finding_ledger UNION resolved_episodes) — the load_base_df equivalent
// --------------------------------------------------------------------------- #

export interface BaseRowsOptions {
  now?: number;
  /** Optional: restrict to one register. Omitted, the union spans all three. */
  scope?: Scope;
  /**
   * MTTR delayed-entry package: ISO tracking-start (earliest saved scan) PER SCOPE — what
   * `server/readModels.ts`'s `ledgerClock(scope).observedFrom` reads. Handed in rather than
   * looked up here on purpose: the scan log lives behind the server's Sheets access, and this
   * module's whole point is staying pure over the `LedgerState` it is given (this file's own
   * header: "runs every persist against a plain in-memory LedgerState, fully unit-testable").
   * Drives every row's `entry_days` (`withDerived`, below) via `util.entryDaysFrom`. A scope
   * missing from the map, or a state with no scans of it yet, both mean the same thing a
   * missing `first_seen` does — `entryDaysFrom` returns 0 either way.
   */
  trackingStartByScope?: Partial<Record<Scope, string | null>>;
}

/**
 * The derived clocks for one row.
 *
 * TWO CLOCKS, AND THE SECOND ONE IS PER-SCOPE.
 *
 * `mttr_days` / `age_days` are the detection clock and are the same everywhere: measured from
 * `first_seen`, which the ledger owns (reconcile prefers the API birth date and falls back to
 * the scan ts, so every row has one).
 *
 * The ACTIONABLE clock asks a different question — how long was this fixable and not fixed —
 * and the answer to "when did it become fixable" is not the same in the three registers:
 *
 *   sca              A dependency CVE is fixed by an UPSTREAM RELEASE. Until that exists
 *                    there is nothing to do, so the clock starts at `fix_date` (the vendor's
 *                    own date) or, failing that, `fix_observed_at` (the first scan that saw a
 *                    fixedVersion). A row with neither is genuinely waiting on someone else:
 *                    fix_available_at stays null, every actionable figure stays null, and
 *                    `awaiting_vendor_fix` is true — it drops out of the actionable clock
 *                    while staying in exposure and open counts.
 *
 *   sast / secrets   DIVERGENCE (gas/), and the reason this function is not a straight copy:
 *                    THERE IS NO VENDOR. A weakness in first-party code and a leaked
 *                    credential are both fixed by us, on the day they are found. So
 *                    fix_available_at = first_seen, which makes mttr_actionable_days ===
 *                    mttr_days and actionable_age_days === age_days by construction. Take
 *                    gas/'s rule literally instead and `fix_date` is null on every SAST and
 *                    secrets row — the columns are sca-only (ledgerTypes.ts says so) — so the
 *                    whole of two registers would read "awaiting a vendor fix" forever and
 *                    every actionable figure over them would be empty.
 *
 * DIVERGENCE (gas/): there is no REMEDIATION_ROLLOUT_ISO branch and there must not be one.
 * gas/ treats a row first seen before its rollout date as having had a fix by construction,
 * because its OLD filter only ingested findings that already carried one — a statement about
 * the day one deployment's filter changed. This register's SCA fetch has carried that same
 * `hasFix: true` on EVERY scan (server/wizQueries.ts `SCA_FETCH_HAS_FIX`), so no such day
 * exists and no date could split the rows. What the filter does mean: an SCA row reaches the
 * ledger already carrying a fix, so `fix_observed_at` is normally its first scan and
 * `awaiting_vendor_fix` is true only for a fetched row whose fix columns were not captured. The
 * awaiting count and the vendor wait built on this flag therefore measure nothing under this
 * fetch, and the MTTR page says so (`remediation.fetchFilter.scaHasFix`).
 */
function withDerived(
  row: LedgerRow,
  nowMs: number,
  trackingStart: string | null | undefined,
): BaseRow {
  const first = parseTs(row.first_seen);
  // A REPOSITORY DROP-OUT HAS NO REMEDIATION CLOCK. Its resolved_at dates when the register
  // lost sight of it, not when anyone fixed it, so both MTTR samples are null and every
  // closed-row figure — percentiles, In-SLA, the plain medians, resolved counts — skips it.
  // It is not open either (age_days stays null), so it leaves the backlog too.
  //
  // BUT IT IS STILL EVIDENCE TO A SURVIVAL ESTIMATE, and dropping it there is a bias: the
  // register watched it stay open until the repository left. So it carries its age at that
  // moment as `censor_days` (and the actionable twin), which only the Kaplan–Meier inputs
  // read — right-censored at the drop-out, never an event. A dedicated field rather than an
  // `age_days`, because `age_days` is what every open-backlog and aging figure reads.
  //
  // "That moment" is `last_seen`, the last scan that SAW it — not `resolved_at`, the scan that
  // noticed it gone. Between them sit the deferred scans (and the scan interval itself), and
  // the register watched nothing then: censoring at `resolved_at` would claim days of
  // observed survival nobody observed. A row with no `last_seen` falls back to `resolved_at`.
  const dropout = isRepoDropout(row);
  const lostSight = dropout ? (parseTs(row.last_seen) ?? parseTs(row.resolved_at)) : null;
  const resolved = dropout ? null : parseTs(row.resolved_at);
  const open = row.status === "OPEN";
  const isSca = row.scope === "sca";

  const fixAvailableAt = isSca ? (row.fix_date ?? row.fix_observed_at ?? null) : row.first_seen;
  const fixAvailMs = parseTs(fixAvailableAt);
  // Clamp: the clock never starts before detection. Two-argument Math.max, never a spread —
  // see util.maxNum for why a spread over a findings-scale array is fatal.
  const actionableMs =
    fixAvailMs === null ? null : first === null ? fixAvailMs : Math.max(first, fixAvailMs);
  const actionableFrom = actionableMs === null ? null : toIso(actionableMs);

  return {
    ...row,
    mttr_days: first !== null && resolved !== null ? (resolved - first) / DAY_MS : null,
    age_days: !dropout && resolved === null && first !== null ? (nowMs - first) / DAY_MS : null,
    // MTTR delayed-entry package (BaseRowsOptions.trackingStartByScope's own comment): the
    // DETECTION clock's entry age, relative to `first_seen` — the same origin `mttr_days` /
    // `age_days` above measure from, so `entryDaysFrom`'s one formula applies unchanged.
    entry_days: entryDaysFrom(trackingStart, row.first_seen),
    fix_available_at: fixAvailableAt,
    actionable_from: actionableFrom,
    mttr_actionable_days:
      resolved !== null && actionableMs !== null ? (resolved - actionableMs) / DAY_MS : null,
    actionable_age_days: open && actionableMs !== null ? (nowMs - actionableMs) / DAY_MS : null,
    censor_days: lostSight !== null && first !== null ? (lostSight - first) / DAY_MS : null,
    // Null, not negative, for a drop-out whose fix only became available after it was last
    // seen: it was never on the actionable clock while the register could see it.
    censor_actionable_days:
      lostSight !== null && actionableMs !== null && actionableMs <= lostSight
        ? (lostSight - actionableMs) / DAY_MS
        : null,
    // `isSca &&` is the flag's DEFINITION, not a shortcut: "awaiting a vendor fix" names a
    // state only a dependency finding can be in. On sast/secrets it is false even for the
    // degenerate row whose first_seen is missing — that row cannot be measured (its actionable
    // fields are null above), which is a different and true statement about it.
    awaiting_vendor_fix: isSca && open && fixAvailableAt === null,
  };
}

/** A sealed episode rehydrated as a ledger row: what compaction kept, and nulls for the rest. */
function rowFromEpisode(e: EpisodeRow): LedgerRow {
  return {
    finding_key: e.finding_key,
    scope: e.scope,
    identifier: e.identifier,
    component: e.component,
    severity: e.severity,
    repo_id: null,
    // gas/'s COMPACTED_ASSET placeholder, on this register's asset column.
    repo_name: COMPACTED_ASSET,
    branch: null,
    platform: null,
    first_seen: e.first_seen,
    // `resolved_at`, as every episode always read — except a repository drop-out's, whose last
    // sighting is its censoring point (`withDerived`) and is read back when the episode carries
    // one (an episode sealed before the column existed does not, and falls back too).
    last_seen: (isRepoDropout(e) ? e.last_seen : null) ?? e.resolved_at,
    status: "RESOLVED",
    resolved_at: e.resolved_at,
    resolution_src: e.resolution_src,
    reopened_count: e.reopened_count,
    first_scan_id: null,
    last_scan_id: null,
    // Carried through compaction (ledgerTypes.EpisodeRow) so a sealed sca episode keeps its
    // actionable-clock inputs; null on sast/secrets episodes, where withDerived does not read
    // them anyway.
    fix_date: e.fix_date,
    fix_observed_at: e.fix_observed_at,
    fixed_version: null,
    has_kev: e.has_kev,
    has_exploit: e.has_exploit,
    epss: e.epss,
    risk_observed_at: null,
    cwe: e.cwe,
    ai_verdict: null,
    language: e.language,
    file_path: null,
    start_line: null,
    origin: null,
    secret_kind: null,
    rotated_at: null,
    removed_at: null,
    validation_state: null,
    validated_at: null,
    confidence: null,
    owner_project: e.owner_project,
    owner_path: null,
    tags_json: null,
    // EpisodeRow carries no projects_json (compaction.ts's EpisodeRow has no such column, and
    // a sealed episode's owner_path is already null above for the same reason) — nothing to
    // expand it from.
    projects_json: null,
    // No link either, for the same reason and with the same consequence: a sealed episode
    // has dropped the per-finding detail it summarizes, so the sheet draws no Wiz row.
    portal_url: null,
  };
}

/**
 * Ledger rows plus non-superseded episodes (keys without a live row), with the computed
 * clocks. Episodes surface with the '(compacted)' placeholder in `repo_name`.
 *
 * `options.scope` narrows the union to one register; omitted, it spans all three. The filter
 * runs on the ROW's `scope` column, which reconcile stamps on every row it touches — not on
 * the key prefix, so a row read back from a sheet written before the column existed is
 * excluded rather than mis-filed.
 */
export function baseRows(state: LedgerState, options: BaseRowsOptions = {}): BaseRow[] {
  const nowMs = options.now ?? Date.now();
  const scope = options.scope;
  const trackingStartByScope = options.trackingStartByScope;
  const out: BaseRow[] = [];
  for (const row of Object.values(state.ledger)) {
    if (scope !== undefined && row.scope !== scope) continue;
    out.push(withDerived(row, nowMs, trackingStartByScope?.[row.scope]));
  }
  for (const e of state.episodes) {
    if (e.superseded_by_scan !== null) continue;
    if (e.finding_key in state.ledger) continue; // live row is authoritative
    if (scope !== undefined && e.scope !== scope) continue;
    out.push(withDerived(rowFromEpisode(e), nowMs, trackingStartByScope?.[e.scope]));
  }
  return out;
}

/**
 * Per-severity finding counts of a scan's observations — the scan-over-scan baseline for
 * change badges (ledger.previous_severity_counts). The caller supplies that scan's
 * observations (read from its Drive obs file), so there is no scope filter here: an
 * observation set belongs to exactly one scan and a scan belongs to exactly one scope.
 */
export function severityCountsFromObservations(
  observations: Pick<Observation, "present" | "severity">[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of observations) {
    if (o.present !== 1) continue;
    const sev = normalizeSeverity(o.severity);
    counts[sev] = (counts[sev] ?? 0) + 1;
  }
  return counts;
}
