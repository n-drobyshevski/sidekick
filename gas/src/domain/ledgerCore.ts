// Pure in-memory ledger machinery — the portable heart of wiz_dashboard/data/ledger.py.
//
// SQLite gave the Python app cheap per-scan transactions; Sheets does not. So the GAS
// port runs every persist / delete-replay / checkpoint-replay against a plain in-memory
// LedgerState (this module, fully unit-testable) and lets server/ledgerStore.ts read
// and write that state wholesale at the edges. The algorithms — reconcile invocation,
// prev-scan maps, episode collisions, replay ordering — are line-for-line ports.

import { DISAPPEARANCE_RESOLUTION, SEVERITY_ORDER } from "./config";
import { parseSeverities, serializeSeverities } from "./compaction";
import { reconcile, type Deltas, type LedgerRow, type Observation } from "./reconcile";
import { normalizeSeverity } from "./severity";
import { nowIso, parseTs, type Rec } from "./util";

export interface ScanRow {
  scan_id: string;
  ts: string;
  mode: string;
  shape: "flat" | "grouped";
  total: number;
  new_count: number;
  resolved_count: number;
  reopened_count: number;
  // Reference to the archived raw payload (a Drive folder id in GAS; opaque here).
  raw_ref: string | null;
  // Reference to the scan's observations file (Drive file id in GAS).
  obs_ref: string | null;
  severities: string | null; // serializeSeverities text
  sealed: 0 | 1;
}

export interface EpisodeRow {
  vuln_key: string;
  cve: string | null;
  severity: string | null;
  first_seen: string | null;
  resolved_at: string | null;
  resolution_src: string | null;
  reopened_count: number;
  compaction_id: string;
  superseded_by_scan: string | null;
}

export interface LedgerState {
  scans: ScanRow[];
  ledger: Record<string, LedgerRow>;
  episodes: EpisodeRow[];
}

export function emptyState(): LedgerState {
  return { scans: [], ledger: {}, episodes: [] };
}

/** Scans ordered ts ASC, scan_id ASC (the delete/compact iteration order). */
export function scansAsc(scans: ScanRow[]): ScanRow[] {
  return [...scans].sort((a, b) => {
    const ta = parseTs(a.ts) ?? 0;
    const tb = parseTs(b.ts) ?? 0;
    if (ta !== tb) return ta - tb;
    return a.scan_id < b.scan_id ? -1 : a.scan_id > b.scan_id ? 1 : 0;
  });
}

/** The most recent scan (ORDER BY ts DESC LIMIT 1), or null. */
export function latestScan(scans: ScanRow[]): ScanRow | null {
  const asc = scansAsc(scans);
  return asc.length ? asc[asc.length - 1] : null;
}

/**
 * {severity: scan_id} of the most recent prior scan whose scope covered it — the
 * per-severity disappearance guard (ledger._prev_scan_id_by_severity). null when no
 * scans exist.
 */
export function prevScanIdBySeverity(scans: ScanRow[]): Record<string, string> | null {
  const remaining = new Set<string>(SEVERITY_ORDER);
  const mapping: Record<string, string> = {};
  const desc = scansAsc(scans).reverse();
  for (const r of desc) {
    const scope = parseSeverities(r.severities);
    const covered = scope === null ? [...remaining] : [...remaining].filter((s) => scope.includes(s));
    for (const sev of covered) mapping[sev] = r.scan_id;
    covered.forEach((s) => remaining.delete(s));
    if (!remaining.size) break;
  }
  return Object.keys(mapping).length ? mapping : null;
}

/** Stored deltas if this scan_id is already saved (idempotency), else null. */
export function existingScanDeltas(scans: ScanRow[], scanId: string): Deltas | null {
  const row = scans.find((r) => r.scan_id === scanId);
  if (!row) return null;
  return {
    new_count: row.new_count,
    resolved_count: row.resolved_count,
    reopened_count: row.reopened_count,
  };
}

/**
 * Restore uncompacted semantics when a scan re-lists a vuln whose ledger row was
 * compacted into resolved_episodes (ledger._reconcile_episode_collisions). Mutates
 * updated/deltas/episodes in place.
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
  const episodeReopens = new Map<string, EpisodeRow>();
  for (const e of state.episodes) {
    if (e.superseded_by_scan === null && newKeys.includes(e.vuln_key)) {
      episodeReopens.set(e.vuln_key, e);
    }
  }
  for (const [key, episode] of episodeReopens) {
    const row = updated[key];
    if (row.status === "OPEN") {
      // Genuine reopen of a compacted resolution: seed the episode's reopen count,
      // reclassify new -> reopened, and mark the episode superseded.
      row.reopened_count = Number(episode.reopened_count ?? 0) + 1;
      deltas.new_count -= 1;
      deltas.reopened_count += 1;
      episode.superseded_by_scan = scanId;
    } else {
      // The API re-listed an already-counted old resolution: the episode stays
      // authoritative; drop the fresh row and undo its deltas.
      delete updated[key];
      deltas.new_count -= 1;
      deltas.resolved_count -= 1;
    }
  }
}

export interface PersistFlatOptions {
  mode: string;
  scanId?: string | null;
  disappearanceMode?: "scan_ts" | "midpoint" | null;
  scannedSeverities?: Iterable<string> | null;
  rawRef?: string | null;
  obsRef?: string | null;
  now?: number;
}

/**
 * Save a flat per-finding scan into the state and reconcile the ledger — the pure
 * core of ledger.persist_flat_scan. Mutates state; returns the deltas and the scan's
 * observations (the caller persists those to Drive).
 */
export function persistFlatScan(
  state: LedgerState,
  records: Rec[],
  options: PersistFlatOptions,
): { deltas: Deltas; observations: Observation[]; scanRow: ScanRow | null } {
  const scanId = options.scanId || nowIso(options.now);
  const scanTs = scanId;
  const disappearanceMode = options.disappearanceMode ?? DISAPPEARANCE_RESOLUTION;
  const severitiesText = serializeSeverities(options.scannedSeverities ?? null);
  const scope = parseSeverities(severitiesText); // canonical, or null for unscoped

  const existing = existingScanDeltas(state.scans, scanId);
  if (existing !== null) return { deltas: existing, observations: [], scanRow: null };

  const prev = latestScan(state.scans);
  const prevScanId = prev ? prev.scan_id : null;
  const prevScanTs = prev ? prev.ts : null;
  const prevBySev = prevScanId !== null ? prevScanIdBySeverity(state.scans) : null;
  const existingLedger = state.ledger;

  const { ledger: updated, observations, deltas } = reconcile(
    records,
    existingLedger,
    scanId,
    scanTs,
    prevScanId,
    {
      disappearanceMode,
      prevScanTs,
      scannedSeverities: scope,
      prevScanIdBySeverity: prevBySev,
    },
  );

  reconcileEpisodeCollisions(state, updated, existingLedger, deltas, scanId);

  const scanRow: ScanRow = {
    scan_id: scanId,
    ts: scanTs,
    mode: options.mode,
    shape: "flat",
    total: records.length,
    new_count: deltas.new_count,
    resolved_count: deltas.resolved_count,
    reopened_count: deltas.reopened_count,
    raw_ref: options.rawRef ?? null,
    obs_ref: options.obsRef ?? null,
    severities: severitiesText,
    sealed: 0,
  };
  state.scans.push(scanRow);
  state.ledger = updated;
  return { deltas, observations, scanRow };
}

export interface PersistGroupedOptions {
  mode: string;
  scanId?: string | null;
  scannedSeverities?: Iterable<string> | null;
  rawRef?: string | null;
  now?: number;
}

/** Record a grouped-by-asset scan WITHOUT reconciliation (zero deltas). */
export function persistGroupedScan(
  state: LedgerState,
  nodes: unknown[],
  options: PersistGroupedOptions,
): { deltas: Deltas; scanRow: ScanRow | null } {
  const scanId = options.scanId || nowIso(options.now);
  const zero: Deltas = { new_count: 0, resolved_count: 0, reopened_count: 0 };
  if (existingScanDeltas(state.scans, scanId) !== null) {
    return { deltas: zero, scanRow: null };
  }
  const scanRow: ScanRow = {
    scan_id: scanId,
    ts: scanId,
    mode: options.mode,
    shape: "grouped",
    total: nodes.length,
    new_count: 0,
    resolved_count: 0,
    reopened_count: 0,
    raw_ref: options.rawRef ?? null,
    obs_ref: null,
    severities: serializeSeverities(options.scannedSeverities ?? null),
    sealed: 0,
  };
  state.scans.push(scanRow);
  return { deltas: zero, scanRow };
}

/** Re-insert a scans row verbatim (grouped survivor with a missing archive). */
export function reinsertScanRow(state: LedgerState, row: ScanRow): void {
  state.scans.push({ ...row });
}

// --------------------------------------------------------------------------- #
//  Base rows (vuln_ledger UNION resolved_episodes) — the load_base_df equivalent
// --------------------------------------------------------------------------- #

export type BaseRow = LedgerRow & { mttr_days: number | null; age_days: number | null };

const DAY_MS = 86_400_000;
export const COMPACTED_ASSET = "(compacted)";

/**
 * Ledger rows plus non-superseded episodes (keys without a live row) with computed
 * mttr_days / open age_days. Episodes surface with '(compacted)' placeholder fields.
 */
export function baseRows(state: LedgerState, now?: number): BaseRow[] {
  const nowMs = now ?? Date.now();
  const out: BaseRow[] = [];
  const withDerived = (row: LedgerRow): BaseRow => {
    const first = parseTs(row.first_seen);
    const resolved = parseTs(row.resolved_at);
    return {
      ...row,
      mttr_days: first !== null && resolved !== null ? (resolved - first) / DAY_MS : null,
      age_days: resolved === null && first !== null ? (nowMs - first) / DAY_MS : null,
    };
  };
  for (const row of Object.values(state.ledger)) out.push(withDerived(row));
  for (const e of state.episodes) {
    if (e.superseded_by_scan !== null) continue;
    if (e.vuln_key in state.ledger) continue; // live row is authoritative
    out.push(
      withDerived({
        vuln_key: e.vuln_key,
        cve: e.cve,
        severity: e.severity,
        asset_id: null,
        asset_name: COMPACTED_ASSET,
        asset_type: null,
        cloud: null,
        first_seen: e.first_seen,
        last_seen: e.resolved_at,
        status: "RESOLVED",
        resolved_at: e.resolved_at,
        resolution_src: e.resolution_src,
        reopened_count: e.reopened_count,
        first_scan_id: null,
        last_scan_id: null,
        subscription_name: null,
        subscription_ext_id: null,
        tags_json: null,
      }),
    );
  }
  return out;
}

/**
 * Per-severity finding counts of the second-newest flat scan's observations — the
 * scan-over-scan baseline for change badges (ledger.previous_severity_counts). The
 * caller supplies that scan's observations (read from its Drive obs file).
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
