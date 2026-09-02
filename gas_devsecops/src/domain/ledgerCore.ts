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
// walk itself is unchanged. `latestScan` and `prevScanIdBySeverity` are the two that matter,
// because both feed resolve-by-disappearance: reading the previous scan of ANY scope there
// would resolve every open row of the other two registers on the first interleaved sync.
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

import { DISAPPEARANCE_RESOLUTION, SEVERITY_ORDER, type Scope } from "./config";
import { parseSeverities, serializeSeverities } from "./compaction";
import { reconcile, emptyTwinStats, type TwinStats } from "./reconcile";
import type {
  BaseRow,
  Deltas,
  EpisodeRow,
  LedgerRow,
  LedgerState,
  Observation,
  ScanRow,
} from "./ledgerTypes";
import { normalizeSeverity } from "./severity";
import { cmp, nowIso, parseTs, toIso, type Rec } from "./util";

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
    if (row.status === "OPEN") {
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
    return { deltas: existing, observations: [], scanRow: null, twinStats: emptyTwinStats() };
  }

  // Every one of these reads is scoped — see latestScan / prevScanIdBySeverity.
  const prev = latestScan(state.scans, scope);
  const prevScanId = prev ? prev.scan_id : null;
  const prevScanTs = prev ? prev.ts : null;
  const prevBySev = prevScanId !== null ? prevScanIdBySeverity(state.scans, scope) : null;

  // THE LEDGER IS PARTITIONED BEFORE IT GOES IN, and this is not tidiness — it is the third
  // place the "one ledger, three registers" generalisation has to be made, and the one that
  // bites hardest. reconcile's disappearance loop walks EVERY row of the ledger it is handed;
  // its only cross-scope protection is `row.last_scan_id !== expectedPrev`, which holds right
  // up until two scopes share a scan id — and jobsStore.ts says they always do (one sync job
  // carries one scan_id and steps through the scopes). MEASURED on the interleaved case in
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

  const { ledger: updated, observations, deltas, twinStats } = reconcile(
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
      prevScanIdBySeverity: prevBySev,
    },
  );

  reconcileEpisodeCollisions(state, updated, existingLedger, deltas, scanId);

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
  };
  state.scans.push(scanRow);
  // reconcile copies rather than mutates, so the other scopes' rows go back in by reference,
  // byte-identical to what came out.
  state.ledger = { ...otherScopes, ...updated };
  return { deltas, observations, scanRow, twinStats };
}

// --------------------------------------------------------------------------- #
//  Base rows (finding_ledger UNION resolved_episodes) — the load_base_df equivalent
// --------------------------------------------------------------------------- #

export interface BaseRowsOptions {
  now?: number;
  /** Optional: restrict to one register. Omitted, the union spans all three. */
  scope?: Scope;
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
 * one deployment's history. This register is fresh; it has never had a hasFix-only filter and
 * has no rows predating itself. Carrying the constant over would silently declare every early
 * sca row fixable at detection on the strength of another product's migration.
 */
function withDerived(row: LedgerRow, nowMs: number): BaseRow {
  const first = parseTs(row.first_seen);
  const resolved = parseTs(row.resolved_at);
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
    age_days: resolved === null && first !== null ? (nowMs - first) / DAY_MS : null,
    fix_available_at: fixAvailableAt,
    actionable_from: actionableFrom,
    mttr_actionable_days:
      resolved !== null && actionableMs !== null ? (resolved - actionableMs) / DAY_MS : null,
    actionable_age_days: open && actionableMs !== null ? (nowMs - actionableMs) / DAY_MS : null,
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
    last_seen: e.resolved_at,
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
  const out: BaseRow[] = [];
  for (const row of Object.values(state.ledger)) {
    if (scope !== undefined && row.scope !== scope) continue;
    out.push(withDerived(row, nowMs));
  }
  for (const e of state.episodes) {
    if (e.superseded_by_scan !== null) continue;
    if (e.finding_key in state.ledger) continue; // live row is authoritative
    if (scope !== undefined && e.scope !== scope) continue;
    out.push(withDerived(rowFromEpisode(e), nowMs));
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
