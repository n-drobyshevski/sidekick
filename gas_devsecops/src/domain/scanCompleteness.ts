// Is this scan complete enough to say what is MISSING from it?
//
// Resolve-by-disappearance reads absence as evidence: a finding the newest scan did not return
// is closed at that scan. That is only true of a scan that actually returned everything it was
// asked for. A sync whose pagination dropped pages, whose tenant answered with nothing, or whose
// cursor walked the same rows twice still lands every row it DID get — and without this gate,
// every row it did NOT get would be published as remediated, with an MTTR clock, in one scan.
//
// So each live scan is assessed here before its disappearance pass runs, and a scan that fails
// is DEFERRED rather than refused: its rows still land (new findings, persisting ones, API
// resolutions — everything the scan positively saw), but nothing is resolved by its absences.
// The next complete scan adjudicates them instead, across the whole window since the last
// complete one (`ledgerCore.disappearanceWindow`). The verdict is stored on the scan row
// (`disappearance`), so a replay re-applies it rather than re-assessing inputs it no longer
// has: the tenant's reported total and the partial-page count are facts of the fetch, not of
// the records.
//
// THREE REASONS, first match wins:
//
//   empty       0 records while the register holds OPEN rows in this scan's severity scope.
//               The one exception is a tenant that REPORTED a total of 0 — that is a
//               measurement that everything is gone, and the scan resolves as usual.
//   short       the tenant reported a total, every page came back whole, and the scan holds
//               fewer distinct nodes than the total minus the tolerance. ONLY when
//               `partialPages === 0`: a page carrying GraphQL errors has a suspect count
//               (wizClient.ts), and SAST returns one on every run (PROBE_FINDINGS.md §12.3), so
//               comparing against it would defer every SAST scan forever.
//   duplicates  more repeated nodes than the tolerance — a cursor that walked rows twice has
//               almost certainly skipped others it cannot name.
//
// THE ABSENT SHARE IS RECORDED AND NEVER A GATE. How many open rows a scan would close is
// exactly what a real remediation wave or a narrowed project scope moves; gating on it would
// refuse the good news and the honest news alike. The repository drop-out rule
// (`reconcile.ts`) is what answers the one large absence that is not remediation.
//
// "DISTINCT" COUNTS NODE IDS, NOT LEDGER KEYS. The tenant's total counts nodes, and on secrets
// several nodes legitimately share one ledger key (the twin fold — PROBE_FINDINGS.md §12.2:
// 1,931 nodes, 1,324 keys). Counting keys would read every secrets scan as a third short and as
// 607 duplicates. A Wiz node `id` is unique per node on all three connections (§9.5), so a
// repeated id is a node the cursor returned twice, whatever the scope.

import type { Rec } from "./util";

/** The stored verdict of a complete scan. A null column is a LEGACY row: complete, old rules. */
export const DISAPPEARANCE_COMPLETE = "complete";
/** The stored verdict of a deferred scan is this prefix plus the reason. */
export const DEFERRED_PREFIX = "deferred:";

export type DeferReason = "empty" | "short" | "duplicates";

/** `max(5, 1%)` of a count — small registers get an absolute floor, large ones a share. */
export function completenessTolerance(n: number): number {
  return Math.max(5, Math.ceil(Math.max(0, n) * 0.01));
}

/** Distinct nodes by Wiz `id`; a node without one is counted as distinct rather than merged. */
export function distinctNodes(records: readonly Rec[]): { distinct: number; duplicates: number } {
  const ids = new Set<string>();
  let anonymous = 0;
  for (const r of records) {
    const raw = r ? r["id"] : null;
    const id = raw === null || raw === undefined ? "" : String(raw).trim();
    if (id === "") anonymous += 1;
    else ids.add(id);
  }
  const distinct = ids.size + anonymous;
  return { distinct, duplicates: records.length - distinct };
}

export interface CompletenessInput {
  records: readonly Rec[];
  /** The tenant's own total for this query; null when it did not report one. */
  reportedTotal: number | null;
  /** Pages that came back carrying GraphQL errors beside their nodes. */
  partialPages: number;
  /** OPEN ledger rows of this scope inside this scan's severity scope. */
  priorOpen: number;
}

export interface CompletenessVerdict {
  /** null when the scan is complete. */
  reason: DeferReason | null;
  distinct: number;
  duplicates: number;
}

export function assessCompleteness(input: CompletenessInput): CompletenessVerdict {
  const { distinct, duplicates } = distinctNodes(input.records);
  const total = input.reportedTotal;
  const verdict = (reason: DeferReason | null): CompletenessVerdict => ({
    reason,
    distinct,
    duplicates,
  });
  if (input.records.length === 0 && input.priorOpen > 0 && total !== 0) return verdict("empty");
  if (
    total !== null &&
    total > 0 &&
    input.partialPages === 0 &&
    distinct < total - completenessTolerance(total)
  ) {
    return verdict("short");
  }
  if (duplicates > completenessTolerance(input.records.length)) return verdict("duplicates");
  return verdict(null);
}

/** The `disappearance` column value for a verdict. */
export function disappearanceValue(reason: DeferReason | null): string {
  return reason === null ? DISAPPEARANCE_COMPLETE : `${DEFERRED_PREFIX}${reason}`;
}

/**
 * Read a stored `disappearance` cell. Blank is a LEGACY row — written before the gate existed,
 * complete by definition, and replayed under the rules it was written under (no drop-out pass).
 */
export function readDisappearance(v: unknown): {
  legacy: boolean;
  deferred: boolean;
  reason: string | null;
} {
  const s = v === null || v === undefined ? "" : String(v).trim();
  if (s === "") return { legacy: true, deferred: false, reason: null };
  if (s.startsWith(DEFERRED_PREFIX)) {
    return { legacy: false, deferred: true, reason: s.slice(DEFERRED_PREFIX.length) || null };
  }
  return { legacy: false, deferred: false, reason: null };
}
