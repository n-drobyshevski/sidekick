// Pure retention/compaction logic — the port of gas/src/domain/compaction.ts (itself the
// portable parts of wiz_dashboard/data/ledger.py): severity-scope (de)serialization for the
// scans.severities column, seal-candidate selection, episode eligibility, and the stats-
// identity comparator. The checkpoint replay itself (compactLedgerCore / toEpisodeRow, gas/'s
// src/domain/maintenance.ts) is NOT ported here — it is not in the D9 brief's file list, it
// reads server-level concerns (archive byte counts, Drive payload re-reads) this package's
// domain layer has no server module for yet, and gas/'s own header note already draws that
// line ("The checkpoint replay itself lives in server/ledgerStore.ts").
//
// serializeSeverities / parseSeverities are ported VERBATIM — the scans.severities text has to
// stay byte-stable, and severity strings carry no ledger-column renames to begin with.
//
// selectSealCandidates DROPS gas/'s `shape` filter: this register's ScanRow (ledgerTypes.ts)
// has no `shape` column at all — the devsecops scans tab never grew a grouped-scan variant, so
// every scan is flat by construction (ledgerTypes.ts's own comment on ScanRow says so). gas/'s
// version filtered `rows.filter(r => r.shape === "flat")` before taking the last
// MIN_UNSEALED_FLAT_SCANS as the protected set; here every row already qualifies, so that
// filter step is simply omitted rather than kept as a no-op.

import { MIN_UNSEALED_FLAT_SCANS, SELECTABLE_SEVERITIES, SEVERITY_ORDER } from "./config";
import type { LedgerRow } from "./ledgerTypes";
import { normalizeSeverity } from "./severity";
import { parseTs, type Rec } from "./util";

/**
 * Canonical JSON for a scan's severity scope; null means "all severities".
 * A scope covering every selectable severity IS an unscoped scan.
 */
export function serializeSeverities(sevs: Iterable<unknown> | null | undefined): string | null {
  if (sevs === null || sevs === undefined) return null;
  const vals = new Set<string>();
  for (const s of sevs) {
    if (typeof s === "string") {
      const n = normalizeSeverity(s);
      // Cast, not a config.ts change: SELECTABLE_SEVERITIES is byte-identical to gas/'s
      // definition (SEVERITY_ORDER.filter(s => s !== "UNKNOWN")), whose inferred type narrows
      // to exclude "UNKNOWN" — leaving `n` (normalizeSeverity's return, plain `string`) not
      // assignable to `.includes`'s parameter. gas/'s compaction.ts casts at this exact call
      // site rather than widening the exported constant; mirrored here for the same reason.
      if ((SELECTABLE_SEVERITIES as string[]).includes(n)) vals.add(n);
    }
  }
  if (!vals.size || vals.size === SELECTABLE_SEVERITIES.length) return null;
  const ordered = SEVERITY_ORDER.filter((s) => vals.has(s));
  // json.dumps-style ", " separator: the scans.severities text must stay byte-stable
  // with rows the Python app wrote.
  return `[${ordered.map((s) => JSON.stringify(s)).join(", ")}]`;
}

/** Inverse of serializeSeverities: ordered array, or null for all/invalid. */
export function parseSeverities(text: unknown): string[] | null {
  if (typeof text !== "string" || !text) return null;
  let vals: unknown;
  try {
    vals = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(vals)) return null;
  const chosen = new Set(
    vals.filter((v): v is string => typeof v === "string").map(normalizeSeverity),
  );
  const out = SEVERITY_ORDER.filter((s) => chosen.has(s));
  return out.length ? out : null;
}

/**
 * The contiguous ts-ordered prefix of scan rows eligible for sealing: stops at the first scan
 * newer than cutoff (sealed history must stay a prefix) and never reaches the last
 * MIN_UNSEALED_FLAT_SCANS scans. See the module header on why this no longer filters by
 * `shape` — every scan here already is the "flat" case gas/'s filter was selecting for.
 */
export function selectSealCandidates<T extends { scan_id: unknown; ts: unknown }>(
  rows: T[],
  cutoffMs: number,
): T[] {
  const protectedIds = new Set(rows.map((r) => r.scan_id).slice(-MIN_UNSEALED_FLAT_SCANS));
  const candidates: T[] = [];
  for (const r of rows) {
    if (protectedIds.has(r.scan_id)) break;
    const ts = parseTs(r.ts);
    if (ts === null || ts > cutoffMs) break;
    candidates.push(r);
  }
  return candidates;
}

/**
 * A sealed scan's ledger row rolls into resolved_episodes only when its lifecycle is
 * settled: RESOLVED with a resolved_at at or before the seal floor.
 *
 * Narrowed to `Pick<LedgerRow, "status" | "resolved_at">` (gas/'s signature took the full
 * `LedgerRow`) — the function reads only these two columns, and the narrower type lets a
 * test build a row without all 39 ledger columns.
 */
export function episodeEligible(
  row: Pick<LedgerRow, "status" | "resolved_at">,
  floorMs: number,
): boolean {
  if (row.status !== "RESOLVED") return false;
  const resolved = parseTs(row.resolved_at);
  return resolved !== null && resolved <= floorMs;
}

/**
 * Deep stats equality tolerant of null-vs-NaN — the port of ledger._stats_equal, the
 * gate that verifies MTTR/trend stats are identical before a compaction commits.
 */
export function statsEqual(a: unknown, b: unknown): boolean {
  if (isMissing(a) && isMissing(b)) return true;
  if (
    a !== null && b !== null &&
    typeof a === "object" && typeof b === "object" &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const ka = Object.keys(a as Rec);
    const kb = Object.keys(b as Rec);
    if (ka.length !== kb.length || !ka.every((k) => kb.includes(k))) return false;
    return ka.every((k) => statsEqual((a as Rec)[k], (b as Rec)[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => statsEqual(x, b[i]));
  }
  return a === b;
}

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));
}
