// MTTR / SLA analytics — the port of gas/src/domain/metrics.ts (itself the port of
// wiz_dashboard/domain/metrics.py). No column renames apply here: calculateMttr reads raw
// Wiz node fields (firstSeenAt/firstDetectedAt/createdAt, resolvedAt/remediatedAt/fixedAt),
// not ledger column names, so the vuln_key -> finding_key / cve -> identifier / asset_* ->
// repo_* renames (sheetsDb.ts's TAB_HEADERS[TABS.ledger]) do not touch this file at all.
//
// summarize() is consumed from two places: calculateMttr() below (one scan's raw records,
// trusting the API's own timestamps) and lifecycle.mttrFromLedger() (durable ledger rows).
// Both share this reducer so the two paths can never quietly disagree — see lifecycle.ts's
// header for the D1-era inlined duplicate this port replaces.
//
// SCOPE FILTER: this register has three scopes sharing one ledger (config.ts's `scope` is
// part of every LedgerRow's identity), which gas/'s single-register version never had to
// filter. calculateMttr's input is one scan's raw API records, which are homogeneous by
// construction (config.ts's ScanRow carries exactly one `scope`), so its `scope` parameter
// is honoured only when a caller actually attaches a `scope` field to a record (e.g. when
// probing ledger-shaped rows through this path) — anything without one is never dropped.
// summarize() filters SummaryRow.scope the same way, for the same reason: it is now the
// shared reducer for BOTH a single-scope scan and a multi-scope ledger read.

import { SEVERITY_ORDER, SLA_TARGETS, type Scope } from "./config";
import { normalizeSeverity } from "./severity";
import { maxNum, mean, median, parseTs, quantile, type Rec } from "./util";

export interface SevStats {
  mttr_mean: number | null;
  mttr_median: number | null;
  resolved: number;
  open: number;
  open_age_p50: number | null;
  open_age_p90: number | null;
  sla_target: number | null;
  sla_compliant: number;
  sla_pct: number | null;
}

export interface OverallStats {
  mttr_mean?: number | null;
  mttr_median?: number | null;
  resolved?: number;
  open?: number;
}

export interface MttrSummary {
  perSev: Record<string, SevStats>;
  overall: OverallStats;
}

export interface SummaryRow {
  sev: string;
  firstSeen: number | null; // epoch ms
  resolved: number | null; // epoch ms
  // Optional: present when the row set spans scopes and the caller wants to filter one out
  // (see the module header). Absent for a scan-record row — those are single-scope already.
  scope?: Scope;
}

const DAY_MS = 86_400_000;

/** First column whose name contains any candidate (case-insensitive) — metrics._find_col. */
export function findCol(columns: string[], ...candidates: string[]): string | null {
  const lower = columns.map((c) => c.toLowerCase());
  for (const cand of candidates) {
    const needle = cand.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
      if (lower[i].includes(needle)) return columns[i];
    }
  }
  return null;
}

/** Ordered union of record keys (insertion order, like DataFrame columns). */
export function recordColumns(records: Rec[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

/**
 * MTTR by severity for ONE scan (trusts the API's timestamps within this response).
 * The durable equivalent is lifecycle.mttrFromLedger; both share summarize() so the
 * output contract is identical.
 */
export function calculateMttr(records: Rec[], now?: number, scope?: Scope): MttrSummary {
  if (!records.length) return { perSev: {}, overall: {} };

  const columns = recordColumns(records);
  const firstSeenCol = findCol(columns, "firstSeenAt", "firstDetectedAt", "createdAt");
  const resolvedCol = findCol(columns, "resolvedAt", "remediatedAt", "fixedAt");

  if (!firstSeenCol) return { perSev: {}, overall: {} };

  // Without a resolved-timestamp column every row stays unresolved (no stop-clock
  // timestamp exists), matching the Python behavior where _resolved is all-NaT even
  // when a status column marks findings closed.
  const work: SummaryRow[] = records.map((rec) => ({
    sev: "severity" in rec ? normalizeSeverity(rec["severity"]) : "UNKNOWN",
    firstSeen: parseTs(rec[firstSeenCol]),
    resolved: resolvedCol ? parseTs(rec[resolvedCol]) : null,
    scope: "scope" in rec ? (rec["scope"] as Scope) : undefined,
  }));

  return summarize(work, now, scope);
}

/**
 * Reduce normalized rows to (perSev, overall) — the port of metrics._summarize. A row whose
 * `scope` was never attached is never dropped by a scope filter (present-but-wrong-scope is
 * excluded; absent-scope survives) — see the module header on why calculateMttr's raw-record
 * rows usually carry no scope at all.
 */
export function summarize(workIn: SummaryRow[], now?: number, scope?: Scope): MttrSummary {
  const work = scope ? workIn.filter((r) => r.scope === undefined || r.scope === scope) : workIn;
  if (!work.length) return { perSev: {}, overall: {} };
  const nowMs = now ?? Date.now();

  const mttrDays = (r: SummaryRow): number | null =>
    r.resolved !== null && r.firstSeen !== null ? (r.resolved - r.firstSeen) / DAY_MS : null;
  const ageDays = (r: SummaryRow): number | null =>
    r.firstSeen !== null ? (nowMs - r.firstSeen) / DAY_MS : null;

  const perSev: Record<string, SevStats> = {};
  for (const sev of SEVERITY_ORDER) {
    const sub = work.filter((r) => r.sev === sev);
    if (!sub.length) continue;
    const resolvedDays = sub
      .map(mttrDays)
      .filter((d): d is number => d !== null);
    const openAges = sub
      .filter((r) => r.resolved === null && r.firstSeen !== null)
      .map(ageDays)
      .filter((d): d is number => d !== null);
    const target = SLA_TARGETS[sev] ?? null;
    const withinSla =
      target !== null && resolvedDays.length
        ? resolvedDays.filter((d) => d <= target).length
        : 0;
    perSev[sev] = {
      mttr_mean: resolvedDays.length ? mean(resolvedDays) : null,
      mttr_median: resolvedDays.length ? median(resolvedDays) : null,
      resolved: resolvedDays.length,
      open: openAges.length,
      open_age_p50: openAges.length ? median(openAges) : null,
      open_age_p90: openAges.length ? quantile(openAges, 0.9) : null,
      sla_target: target,
      sla_compliant: withinSla,
      sla_pct: resolvedDays.length && target !== null ? (withinSla / resolvedDays.length) * 100 : null,
    };
  }

  const allMttr = work.map(mttrDays).filter((d): d is number => d !== null);
  const overall: OverallStats = {
    mttr_mean: allMttr.length ? mean(allMttr) : null,
    mttr_median: allMttr.length ? median(allMttr) : null,
    resolved: work.filter((r) => r.resolved !== null).length,
    open: work.filter((r) => r.resolved === null).length,
  };
  return { perSev, overall };
}

/**
 * Overall In-SLA % and oldest-open age from a per-severity summary:
 * SLA = total within-target ÷ total resolved ×100; oldest = max p90 open age.
 */
export function overallSlaOldest(
  perSev: Record<string, SevStats>,
): { slaPct: number | null; oldestDays: number | null } {
  const stats = Object.values(perSev);
  const compliant = stats.reduce((a, d) => a + (d.sla_compliant ?? 0), 0);
  const resolved = stats.reduce((a, d) => a + (d.resolved ?? 0), 0);
  const slaPct = resolved ? (compliant / resolved) * 100 : null;
  const p90s = stats.map((d) => d.open_age_p90).filter((v): v is number => v !== null && v !== undefined);
  const oldestDays = p90s.length ? maxNum(p90s) : null;
  return { slaPct, oldestDays };
}
