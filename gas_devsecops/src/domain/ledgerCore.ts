// The scan log, and the clocks derived off a ledger row.
//
// EVERY HELPER HERE IS SCOPED, and that is the whole point of the file. `scans` is one tab
// holding the history of three registers, so "the previous scan" is meaningless without
// naming which register asked. A `latestScan` that ignored scope would hand reconcile a SCA
// scan as SAST's predecessor, and the disappearance guard — which resolves any OPEN row
// whose `last_scan_id` equals that predecessor — would then match nothing and quietly resolve
// nothing, or match wrongly and resolve everything. Both are silent.
//
// Port of gas/src/domain/ledgerCore.ts, minus what is OS-specific: no compaction/episode
// collision handling yet, and no REMEDIATION_ROLLOUT_ISO — that boundary encodes a filter
// change in the OS register's own history and this register has no history to encode.

import { SEVERITY_ORDER, type Scope } from "./config";
import type { LedgerRow } from "./observation";
import { parseTs, toIso } from "./util";

const DAY_MS = 86_400_000;

/** One row of the `scans` tab. */
export interface ScanRow {
  scan_id: string;
  ts: string;
  scope: string;
  /** What fed this scan: "sample" or "live". The only honest answer to "is this real data".
   *  Read from the tab rather than inferred from a scan_id convention, because a convention
   *  is a thing a later caller can forget while the column cannot be. */
  mode: string;
  /** Which severities this scan requested — "" or "*" means it covered all of them. */
  severities: string;
  new_count: number;
  resolved_count: number;
  reopened_count: number;
}

/**
 * A scan's severity scope as a list, or null for "covered everything".
 *
 * The empty string is null rather than an empty list, and the difference is the whole
 * secrets register: `DEFAULT_FETCH_SEVERITIES.secrets` is `[]`, which sends no severity key
 * and fetches every row (§10.3). Reading that back as "covered no severities" would exempt
 * all 1,958 secrets from disappearance forever — they would never resolve.
 */
export function parseSeverities(value: unknown): string[] | null {
  const s = String(value ?? "").trim();
  if (!s || s === "*") return null;
  return s.split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
}

/** Scans of one scope, oldest first. Ties on `ts` break by `scan_id`, so the order is total. */
export function scansAsc(scans: readonly ScanRow[], scope: Scope): ScanRow[] {
  return scans
    .filter((r) => r.scope === scope)
    .sort((a, b) => {
      const ta = parseTs(a.ts) ?? 0;
      const tb = parseTs(b.ts) ?? 0;
      if (ta !== tb) return ta - tb;
      return a.scan_id < b.scan_id ? -1 : a.scan_id > b.scan_id ? 1 : 0;
    });
}

/** The most recent scan OF THIS SCOPE, or null when the scope has never been scanned. */
export function latestScan(scans: readonly ScanRow[], scope: Scope): ScanRow | null {
  const asc = scansAsc(scans, scope);
  return asc.length ? asc[asc.length - 1]! : null;
}

/**
 * `{severity: scan_id}` of the most recent prior scan OF THIS SCOPE whose gate covered it.
 *
 * The per-severity disappearance guard. A finding that vanished while its severity went
 * unscanned must still resolve on the first scan that covers it again, and without this map
 * it never would: its `last_scan_id` would not match the immediately-previous scan, so the
 * guard would read it as stale rather than resolved, forever.
 *
 * null when this scope has no scans.
 */
export function prevScanIdBySeverity(
  scans: readonly ScanRow[],
  scope: Scope,
): Record<string, string> | null {
  const remaining = new Set<string>(SEVERITY_ORDER);
  const mapping: Record<string, string> = {};
  for (const r of scansAsc(scans, scope).reverse()) {
    const covered = parseSeverities(r.severities);
    const hit = covered === null ? [...remaining] : [...remaining].filter((s) => covered.includes(s));
    for (const sev of hit) mapping[sev] = r.scan_id;
    for (const sev of hit) remaining.delete(sev);
    if (!remaining.size) break;
  }
  return Object.keys(mapping).length ? mapping : null;
}

/** Stored deltas if this scan_id is already saved, else null — this is what makes a re-run a no-op. */
export function existingScanDeltas(
  scans: readonly ScanRow[],
  scanId: string,
): { new_count: number; resolved_count: number; reopened_count: number } | null {
  const row = scans.find((r) => r.scan_id === scanId);
  if (!row) return null;
  return {
    new_count: Number(row.new_count ?? 0),
    resolved_count: Number(row.resolved_count ?? 0),
    reopened_count: Number(row.reopened_count ?? 0),
  };
}

// --------------------------------------------------------------------------- #
//  The derived clocks
// --------------------------------------------------------------------------- #

export type BaseRow = LedgerRow & {
  /** first_seen -> resolved_at, in days. null while open. */
  mttr_days: number | null;
  /** first_seen -> now, in days. null once resolved. */
  age_days: number | null;
  /** When a vendor fix first existed. SCA only. */
  fix_available_at: string | null;
  /** The actionable clock's start: the fix date, never earlier than detection. */
  actionable_from: string | null;
  mttr_actionable_days: number | null;
  actionable_age_days: number | null;
  /**
   * OPEN, in a scope that HAS a vendor, with no fix available yet.
   *
   * SCOPE-GUARDED, AND THAT GUARD IS LOAD-BEARING. The definition "open with no fix
   * available" is true of literally every SAST finding and every secret — neither has a
   * vendor and neither ever will. Without the guard, 127 SAST rows and 1,958 secrets would
   * read as awaiting a vendor forever: they would drop out of every actionable clock while
   * staying in the exposure counts, so the two halves of the page would disagree and the
   * gap would look like a bug in the arithmetic rather than a category error.
   */
  awaiting_vendor_fix: boolean;
};

/** Scopes where a vendor fix is a thing that can exist. */
const HAS_VENDOR_FIX: ReadonlySet<string> = new Set<Scope>(["sca"]);

/**
 * Add the derived clocks to ledger rows.
 *
 * THE SECOND CLOCK, finally computed. `fix_date` and `fix_observed_at` have been written to
 * every row since the schema was first laid out, precisely so this could be derived later
 * without a backfill that could never be honest — a fix date nobody recorded at the time
 * cannot be recovered afterwards. Reference: gas/src/domain/ledgerCore.ts::baseRows.
 *
 * The SLA/MTTR clock a team can be held to starts when a fix becomes available, not when the
 * finding is detected. A row still waiting on a vendor is not late.
 */
export function baseRows(rows: readonly LedgerRow[], now?: number): BaseRow[] {
  const nowMs = now ?? Date.now();
  return rows.map((row) => {
    const first = parseTs(row.first_seen);
    const resolved = parseTs(row.resolved_at);
    const open = row.status === "OPEN";
    const vendor = HAS_VENDOR_FIX.has(row.scope);

    // `fix_observed_at` is the fallback and not an equal: it is the scan that first SAW a
    // fix exist, which is an upper bound on when the fix appeared. Using it where `fix_date`
    // is absent makes the actionable clock conservative — never crediting a team with time
    // it did not have.
    const fixAvailableAt = vendor ? row.fix_date ?? row.fix_observed_at ?? null : null;
    const fixAvailMs = parseTs(fixAvailableAt);
    // Clamp: the clock never starts before detection.
    const actionableMs =
      fixAvailMs === null ? null : first === null ? fixAvailMs : Math.max(first, fixAvailMs);

    return {
      ...row,
      mttr_days: first !== null && resolved !== null ? (resolved - first) / DAY_MS : null,
      age_days: resolved === null && first !== null ? (nowMs - first) / DAY_MS : null,
      fix_available_at: fixAvailableAt,
      actionable_from: actionableMs === null ? null : toIso(actionableMs),
      mttr_actionable_days:
        resolved !== null && actionableMs !== null ? (resolved - actionableMs) / DAY_MS : null,
      actionable_age_days:
        open && actionableMs !== null ? (nowMs - actionableMs) / DAY_MS : null,
      awaiting_vendor_fix: open && vendor && fixAvailableAt === null,
    };
  });
}
