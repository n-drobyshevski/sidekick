// Pure retention/compaction logic — the portable parts of wiz_dashboard/data/ledger.py:
// severity-scope (de)serialization for the scans.severities column, seal-candidate
// selection, episode eligibility, and the stats-identity comparator. The checkpoint
// replay itself lives in server/ledgerStore.ts (it re-runs the persist writers).

import { MIN_UNSEALED_FLAT_SCANS, SELECTABLE_SEVERITIES, SEVERITY_ORDER } from "./config";
import { normalizeSeverity } from "./severity";
import { parseTs, type Rec } from "./util";
import type { LedgerRow } from "./reconcile";

export const CHECKPOINT_VERSION = 1;

export interface Checkpoint {
  version: number;
  floor_scan_id: string | null;
  floor_ts: string | null;
  ledger: LedgerRow[];
}

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
 * The contiguous ts-ordered prefix of scan rows eligible for sealing: stops at the
 * first scan newer than cutoff (sealed history must stay a prefix) and never reaches
 * the last MIN_UNSEALED_FLAT_SCANS flat scans.
 */
export function selectSealCandidates<T extends { scan_id: unknown; ts: unknown; shape: unknown }>(
  rows: T[],
  cutoffMs: number,
): T[] {
  const flatIds = rows.filter((r) => r.shape === "flat").map((r) => r.scan_id);
  const protectedIds = new Set(flatIds.slice(-MIN_UNSEALED_FLAT_SCANS));
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
 */
export function episodeEligible(row: LedgerRow, floorMs: number): boolean {
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
