// Manual data cleanup by criteria — the pure core behind Data → Maintenance.
//
// Three operations, and they are NOT variations on one theme; they differ in how far a
// deletion has to reach before it stays deleted:
//
//   1. purge findings by severity — reaches the two tabs, the compaction checkpoint, AND the
//      Drive scan archives, because the ledger is derived state and `deleteScansCore` rebuilds
//      it by replaying those archives (domain/maintenance.ts:170). Rows removed from a tab
//      alone come straight back the next time an operator deletes a scan.
//   2. prune resolved episodes — reaches the episodes tab and the checkpoint. Sealed scans'
//      archives were already pruned by compaction, so there is nothing to rewrite; but the
//      checkpoint still matters, see pruneEpisodesCore below.
//   3. trim trend history — reaches one tab. `mttr_history` is written only by
//      historyStore.recordSnapshot and importHistory and is never rebuilt by replay, so a
//      trim there is durable outright.
//
// Everything here is pure (no GAS globals, no I/O): server/purgeJobs.ts and
// server/ledgerStore.ts supply the Drive/Sheets edges. Preview and apply are computed by the
// same functions, so the dry-run numbers an operator confirms are the numbers that commit —
// the plan/apply symmetry maintenance.compactLedgerCore already uses.

import { parseSeverities, serializeSeverities, type Checkpoint } from "./compaction";
import { SELECTABLE_SEVERITIES } from "./config";
import type { EpisodeRow, LedgerState, ScanRow } from "./ledgerCore";
import type { LedgerRow } from "./reconcile";
import { effectiveSeverity } from "./severity";
import { parseTs, type Rec } from "./util";

/**
 * Whether a record falls under a severity purge.
 *
 * `effectiveSeverity`, deliberately, and NOT `normalizeSeverity`. Archived pages are a mix of
 * shapes: a full scan writes raw unbaked Wiz nodes (scanJobs.ts:428) while an incremental scan
 * writes already-baked slim records (scanJobs.ts:500). `slimRecord` bakes the
 * severity/vendorSeverity/nvdSeverity fallback at ingest (scanJobs.ts:219-223), so a node with
 * a blank top-level `severity` but a usable `vendorSeverity` is HIGH in the ledger — and would
 * read as UNKNOWN under `normalizeSeverity`. Classifying archives one way and ledger rows
 * another is how a purge leaves behind exactly the rows it claimed to remove.
 *
 * A no-op on records whose real severity already classifies, so baked and raw agree.
 */
export function severityOf(rec: Rec): string {
  return effectiveSeverity(rec).severity;
}

export function matchesPurge(rec: Rec, set: ReadonlySet<string>): boolean {
  return set.has(severityOf(rec));
}

/** Canonical set from a severity list; empty means "purge nothing" (never "purge all"). */
export function purgeSet(severities: readonly string[]): Set<string> {
  return new Set(severities.map((s) => effectiveSeverity({ severity: s }).severity));
}

function bump(counts: Record<string, number>, sev: string): void {
  counts[sev] = (counts[sev] ?? 0) + 1;
}

// ------------------------------------------------------------------- severity purge

export interface SeverityPurgePreview {
  severities: string[];
  ledgerRows: number;
  episodeRows: number;
  /** Removal counts keyed by severity, across ledger + episodes. */
  bySeverity: Record<string, number>;
  /** Unsealed scans whose archives have to be rewritten for the purge to stay put. */
  scansToRewrite: number;
  /** Sealed scans — archives already pruned, so their contribution can't be rewritten. */
  sealedScans: number;
}

export function previewSeverityPurge(
  state: LedgerState,
  severities: readonly string[],
): SeverityPurgePreview {
  const set = purgeSet(severities);
  const bySeverity: Record<string, number> = {};
  let ledgerRows = 0;
  let episodeRows = 0;
  for (const row of Object.values(state.ledger)) {
    if (!matchesPurge(row as unknown as Rec, set)) continue;
    ledgerRows += 1;
    bump(bySeverity, severityOf(row as unknown as Rec));
  }
  for (const e of state.episodes) {
    if (!matchesPurge(e as unknown as Rec, set)) continue;
    episodeRows += 1;
    bump(bySeverity, severityOf(e as unknown as Rec));
  }
  const flat = state.scans.filter((s) => s.shape === "flat");
  return {
    severities: [...set],
    ledgerRows,
    episodeRows,
    bySeverity,
    scansToRewrite: flat.filter((s) => !s.sealed).length,
    sealedScans: flat.filter((s) => s.sealed).length,
  };
}

/**
 * Narrow one scan row's recorded severity scope, dropping the purged severities.
 *
 * Not bookkeeping — two live readers depend on it:
 *
 *   - **A quick refresh re-ingests what was just purged.** `startIncremental` builds the delta
 *     query from `parseSeverities(baseline.severities)`, explicitly "never the current
 *     settings" (scanJobs.ts:335-336). So dropping a severity from `fetch_severities` does not
 *     reach an incremental scan at all; the baseline row is what has to change.
 *   - **Replay would resolve survivors by disappearance.** `scannedSeverities` is what tells
 *     reconcile whether a severity's absence means "remediated" or "not looked at"
 *     (reconcile.ts:396-406). A row still claiming it covered LOW, over an archive with the LOW
 *     records removed, reads every surviving LOW lifecycle as resolved-by-disappearance.
 *
 * `null` in means "all severities". A scope that would narrow to nothing is left alone —
 * `serializeSeverities([])` round-trips back to null (all severities), so writing it would
 * *widen* the row; and "this scan covered no severities" is not a state the schema can express.
 */
export function narrowScanScope(
  severitiesText: string | null,
  set: ReadonlySet<string>,
): string | null {
  const current = parseSeverities(severitiesText) ?? [...SELECTABLE_SEVERITIES];
  const remaining = current.filter((s) => !set.has(s));
  if (!remaining.length || remaining.length === current.length) return severitiesText;
  return serializeSeverities(remaining);
}

/** New state with matching live rows and episodes dropped. The input is not mutated. */
export function purgeStateBySeverity(
  state: LedgerState,
  severities: readonly string[],
): {
  state: LedgerState;
  ledgerRemoved: number;
  episodeRemoved: number;
  scopesNarrowed: number;
} {
  const set = purgeSet(severities);
  const ledger: Record<string, LedgerRow> = {};
  let ledgerRemoved = 0;
  for (const [key, row] of Object.entries(state.ledger)) {
    if (matchesPurge(row as unknown as Rec, set)) {
      ledgerRemoved += 1;
      continue;
    }
    ledger[key] = { ...row };
  }
  const episodes: EpisodeRow[] = [];
  let episodeRemoved = 0;
  for (const e of state.episodes) {
    if (matchesPurge(e as unknown as Rec, set)) {
      episodeRemoved += 1;
      continue;
    }
    episodes.push({ ...e });
  }
  let scopesNarrowed = 0;
  const scans = state.scans.map((s) => {
    const narrowed = narrowScanScope(s.severities, set);
    if (narrowed !== s.severities) scopesNarrowed += 1;
    return { ...s, severities: narrowed };
  });
  return {
    state: { scans, ledger, episodes },
    ledgerRemoved,
    episodeRemoved,
    scopesNarrowed,
  };
}

/**
 * Drop matching rows from a compaction checkpoint.
 *
 * Load-bearing: the checkpoint is the rebuild baseline `deleteScansCore` seeds `vuln_ledger`
 * from (maintenance.ts:216-220). Purging the tabs but not the blob stages every purged
 * lifecycle for the next scan deletion.
 */
export function purgeCheckpointBySeverity(
  checkpoint: Checkpoint,
  severities: readonly string[],
): { checkpoint: Checkpoint; removed: number } {
  const set = purgeSet(severities);
  const kept = (checkpoint.ledger ?? []).filter((r) => !matchesPurge(r as unknown as Rec, set));
  return {
    checkpoint: { ...checkpoint, ledger: kept },
    removed: (checkpoint.ledger ?? []).length - kept.length,
  };
}

/** Drop specific vuln_keys from a checkpoint — the episode-prune counterpart of the above. */
export function purgeCheckpointByKeys(
  checkpoint: Checkpoint,
  keys: ReadonlySet<string>,
): { checkpoint: Checkpoint; removed: number } {
  if (!keys.size) return { checkpoint, removed: 0 };
  const kept = (checkpoint.ledger ?? []).filter((r) => !keys.has(r.vuln_key));
  return {
    checkpoint: { ...checkpoint, ledger: kept },
    removed: (checkpoint.ledger ?? []).length - kept.length,
  };
}

export function purgeRecordsBySeverity(
  records: Rec[],
  severities: readonly string[],
): { records: Rec[]; removed: number } {
  const set = purgeSet(severities);
  const kept = records.filter((r) => !matchesPurge(r, set));
  return { records: kept, removed: records.length - kept.length };
}

/**
 * Filter one archived payload, preserving its envelope shape.
 *
 * Three shapes reach this, all of them real (see archiveStore.readScanPayload and the two
 * writers in scanJobs.ts): the GraphQL page envelope `{data:{vulnerabilityFindings:{nodes}}}`,
 * a list of such envelopes (readScanPayload concatenates pages that way), and a bare array of
 * slim records (the incremental path archives the merged slim set). An unrecognized shape is
 * returned untouched with removed = 0 rather than silently emptied — a purge that cannot read
 * an archive must report that, not destroy it.
 */
export function purgePayloadBySeverity(
  payload: unknown,
  severities: readonly string[],
): { payload: unknown; removed: number; kept: number; recognized: boolean } {
  const set = purgeSet(severities);

  if (Array.isArray(payload)) {
    // Either a list of page envelopes or a bare record array. Objects carrying `data` are
    // envelopes; anything else is treated as records.
    const looksEnveloped = payload.some(
      (p) => p && typeof p === "object" && !Array.isArray(p) && "data" in (p as Rec),
    );
    if (looksEnveloped) {
      let removed = 0;
      let kept = 0;
      let recognized = false;
      const pages = payload.map((page) => {
        const out = purgePayloadBySeverity(page, severities);
        removed += out.removed;
        kept += out.kept;
        recognized = recognized || out.recognized;
        return out.payload;
      });
      return { payload: pages, removed, kept, recognized };
    }
    const recs = payload.filter((r): r is Rec => !!r && typeof r === "object");
    if (recs.length !== payload.length) {
      return { payload, removed: 0, kept: payload.length, recognized: false };
    }
    const out = purgeRecordsBySeverity(recs, severities);
    return { payload: out.records, removed: out.removed, kept: out.records.length, recognized: true };
  }

  if (payload && typeof payload === "object") {
    const obj = payload as Rec;
    const data = obj["data"];
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const vf = (data as Rec)["vulnerabilityFindings"];
      if (vf && typeof vf === "object" && !Array.isArray(vf) && "nodes" in (vf as Rec)) {
        const nodes = ((vf as Rec)["nodes"] as Rec[]) ?? [];
        const keptNodes = nodes.filter((n) => !matchesPurge(n, set));
        return {
          payload: {
            ...obj,
            data: { ...(data as Rec), vulnerabilityFindings: { ...(vf as Rec), nodes: keptNodes } },
          },
          removed: nodes.length - keptNodes.length,
          kept: keptNodes.length,
          recognized: true,
        };
      }
    }
  }

  return { payload, removed: 0, kept: 0, recognized: false };
}

// ------------------------------------------------------------------ episode pruning

export interface EpisodePruneCriteria {
  /** Episodes resolved strictly before this instant are candidates. */
  resolvedBeforeMs: number;
  /** null = any severity. */
  severities: readonly string[] | null;
}

function episodeMatches(e: EpisodeRow, c: EpisodePruneCriteria, set: Set<string> | null): boolean {
  if (set && !matchesPurge(e as unknown as Rec, set)) return false;
  const resolved = parseTs(e.resolved_at);
  // An episode with no parseable resolved_at has no age to judge; leave it alone rather than
  // guessing. Absent is not "infinitely old".
  if (resolved === null) return false;
  return resolved < c.resolvedBeforeMs;
}

export interface EpisodePrunePreview {
  rows: number;
  bySeverity: Record<string, number>;
  oldest: string | null;
  newest: string | null;
  /** Episodes left behind, so the preview can say what share of the record is going. */
  remaining: number;
}

export function previewEpisodePrune(
  state: LedgerState,
  c: EpisodePruneCriteria,
): EpisodePrunePreview {
  const set = c.severities ? purgeSet(c.severities) : null;
  const bySeverity: Record<string, number> = {};
  let rows = 0;
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const e of state.episodes) {
    if (!episodeMatches(e, c, set)) continue;
    rows += 1;
    bump(bySeverity, severityOf(e as unknown as Rec));
    const at = e.resolved_at;
    if (at !== null) {
      if (oldest === null || at < oldest) oldest = at;
      if (newest === null || at > newest) newest = at;
    }
  }
  return { rows, bySeverity, oldest, newest, remaining: state.episodes.length - rows };
}

/**
 * New state with matching episodes dropped, plus the keys removed.
 *
 * The caller MUST also purge those keys from the compaction checkpoint
 * (purgeCheckpointByKeys). `deleteScansCore` seeds the rebuilt ledger from the checkpoint
 * "minus keys already in resolved_episodes" (maintenance.ts:216-220) — removing an episode
 * un-masks its checkpoint entry, so the next scan deletion restores it as a live RESOLVED
 * `vuln_ledger` row. Pruning the tab alone doesn't delete the lifecycle; it relocates it.
 */
export function pruneEpisodesCore(
  state: LedgerState,
  c: EpisodePruneCriteria,
): { state: LedgerState; removed: number; prunedKeys: string[] } {
  const set = c.severities ? purgeSet(c.severities) : null;
  const episodes: EpisodeRow[] = [];
  const prunedKeys: string[] = [];
  for (const e of state.episodes) {
    if (episodeMatches(e, c, set)) {
      prunedKeys.push(e.vuln_key);
      continue;
    }
    episodes.push({ ...e });
  }
  return {
    state: {
      scans: state.scans.map((s) => ({ ...s })),
      ledger: Object.fromEntries(Object.entries(state.ledger).map(([k, v]) => [k, { ...v }])),
      episodes,
    },
    removed: prunedKeys.length,
    prunedKeys,
  };
}

// -------------------------------------------------------------------- history trim

/** Drop `mttr_history` rows dated strictly before `beforeDate` (a YYYY-MM-DD string). */
export function trimHistoryRows(
  rows: Rec[],
  beforeDate: string,
): { rows: Rec[]; removed: number; oldestKept: string | null } {
  const kept = rows.filter((r) => {
    const d = r["date"];
    // Undated rows are not aged out — same reasoning as a null resolved_at above.
    return typeof d !== "string" || d >= beforeDate;
  });
  let oldestKept: string | null = null;
  for (const r of kept) {
    const d = r["date"];
    if (typeof d === "string" && (oldestKept === null || d < oldestKept)) oldestKept = d;
  }
  return { rows: kept, removed: rows.length - kept.length, oldestKept };
}

/** Preview counterpart — same predicate, no rewrite. */
export function previewHistoryTrim(
  rows: Rec[],
  beforeDate: string,
): { rows: number; remaining: number; oldest: string | null } {
  const out = trimHistoryRows(rows, beforeDate);
  let oldest: string | null = null;
  for (const r of rows) {
    const d = r["date"];
    if (typeof d === "string" && (oldest === null || d < oldest)) oldest = d;
  }
  return { rows: out.removed, remaining: out.rows.length, oldest };
}

/** The flat, unsealed scans a severity purge has to rewrite, newest first. */
export function archiveWalkOrder(scans: ScanRow[]): ScanRow[] {
  return [...scans]
    .filter((s) => s.shape === "flat")
    .sort((a, b) => ((parseTs(a.ts) ?? 0) < (parseTs(b.ts) ?? 0) ? 1 : -1));
}
