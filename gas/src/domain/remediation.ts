// Remediation-tail analytics for the MTTR page: percentiles, the auto-patch
// fast-lane split, a time-to-resolve histogram, a censoring-aware Kaplan–Meier
// median, and the "open past SLA" backlog the resolved-only headline hides.
//
// GAS-first module (no Python fixture parity — the Streamlit side is discontinued).
// Pure functions over ledger base rows (durable lifecycle: mttr_days for resolved
// findings, age_days for open ones — both already baked with `now` by
// ledgerCore.baseRows). openPastSlaFromRecords is the lone frame-based variant, for
// the snapshot writer that runs before any ledger exists (see its note).

import { DEFAULT_FAST_LANE_DAYS, RESOLVED_STATUSES, SEVERITY_ORDER, SLA_TARGETS } from "./config";
import type { BaseRow } from "./ledgerCore";
import { findCol, recordColumns } from "./metrics";
import { normalizeSeverity } from "./severity";
import { median, parseTs, quantile, type Rec } from "./util";

const DAY_MS = 86_400_000;

// Ledger rows carry all remediation signal in these four columns; every function here
// reads only this projection.
type RemediationRow = Pick<BaseRow, "severity" | "status" | "mttr_days" | "age_days">;

// Time-to-resolve histogram edges (days) and their five bucket labels — bucketed with
// `<=` edges, the same convention as insights.ageBuckets. Shape is drop-in for
// charts.stackedAgeBar.
export const RESOLUTION_BUCKET_EDGES = [1, 7, 30, 90] as const;
export const RESOLUTION_BUCKET_LABELS = ["≤1d", "2–7d", "8–30d", "31–90d", "90+d"] as const;

// Same open/resolved status test the rest of the domain uses (insights.isOpen): a row
// is open unless its status is one of the remediated/closed set.
function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

// A resolved row's remediation time, or null when it has no finite mttr_days sample.
function resolvedMttr(row: RemediationRow): number | null {
  const m = row.mttr_days;
  return typeof m === "number" && Number.isFinite(m) ? m : null;
}

// An open row's age, or null when resolved / missing an age_days sample.
function openAge(row: RemediationRow): number | null {
  if (!isOpen(row.status)) return null;
  const a = row.age_days;
  return typeof a === "number" && Number.isFinite(a) ? a : null;
}

export interface Pctile {
  p50: number | null;
  p90: number | null;
  count: number;
}

export interface MttrPercentiles {
  perSev: Record<string, Pctile>;
  overall: Pctile;
}

/**
 * Median and p90 of resolved lifecycles (finite mttr_days), per severity + overall —
 * the tail percentile the ~1-day median hides. Percentiles are the same linear-
 * interpolation `quantile` the parity-tested metrics use; null when no resolved sample.
 */
export function mttrPercentiles(rows: RemediationRow[]): MttrPercentiles {
  const bySev: Record<string, number[]> = {};
  const all: number[] = [];
  for (const row of rows) {
    const m = resolvedMttr(row);
    if (m === null) continue;
    const s = normalizeSeverity(row.severity);
    (bySev[s] ?? (bySev[s] = [])).push(m);
    all.push(m);
  }
  const perSev: Record<string, Pctile> = {};
  for (const s of SEVERITY_ORDER) {
    const vals = bySev[s];
    if (!vals) continue;
    perSev[s] = { p50: quantile(vals, 0.5), p90: quantile(vals, 0.9), count: vals.length };
  }
  return {
    perSev,
    overall: { p50: quantile(all, 0.5), p90: quantile(all, 0.9), count: all.length },
  };
}

export interface FastLaneSplit {
  total: number;
  fastLane: number;
  fastLanePct: number | null;
  tailCount: number;
  tailMedian: number | null;
}

/**
 * Split resolved lifecycles into the auto-patch fast lane (`mttr_days <= threshold`,
 * the same `d <= target` boundary the SLA check uses) and the tail beyond it, and take
 * the median of that tail so the fast-patched mass stops dragging it toward zero.
 * fastLanePct / tailMedian are null when there is no resolved sample / no tail.
 */
export function fastLaneSplit(
  rows: RemediationRow[],
  threshold: number = DEFAULT_FAST_LANE_DAYS,
): FastLaneSplit {
  const resolved: number[] = [];
  for (const row of rows) {
    const m = resolvedMttr(row);
    if (m !== null) resolved.push(m);
  }
  const total = resolved.length;
  const fastLane = resolved.filter((m) => m <= threshold).length;
  const tail = resolved.filter((m) => m > threshold);
  return {
    total,
    fastLane,
    fastLanePct: total ? (fastLane / total) * 100 : null,
    tailCount: tail.length,
    tailMedian: median(tail),
  };
}

export interface ResolutionBuckets {
  perSev: Record<string, [number, number, number, number, number]>;
  labels: typeof RESOLUTION_BUCKET_LABELS;
  total: number;
}

/**
 * Time-to-resolve histogram: bucket resolved lifecycles by mttr_days into
 * ≤1d / 2–7d / 8–30d / 31–90d / 90+d with `<=` edges (insights.ageBuckets convention),
 * split per severity. perSev bucket counts sum to `total`; open / null-mttr rows are
 * excluded. Insertion-order keys, like ageBuckets, so it drops into charts.stackedAgeBar.
 */
export function resolutionBuckets(rows: RemediationRow[]): ResolutionBuckets {
  const perSev: Record<string, [number, number, number, number, number]> = {};
  let total = 0;
  for (const row of rows) {
    const m = resolvedMttr(row);
    if (m === null) continue;
    const bucket =
      m <= RESOLUTION_BUCKET_EDGES[0] ? 0
      : m <= RESOLUTION_BUCKET_EDGES[1] ? 1
      : m <= RESOLUTION_BUCKET_EDGES[2] ? 2
      : m <= RESOLUTION_BUCKET_EDGES[3] ? 3
      : 4;
    const s = normalizeSeverity(row.severity);
    if (!perSev[s]) perSev[s] = [0, 0, 0, 0, 0];
    perSev[s][bucket] += 1;
    total += 1;
  }
  return { perSev, labels: RESOLUTION_BUCKET_LABELS, total };
}

/**
 * Kaplan–Meier median time-to-remediation, treating still-open findings as
 * right-censored so the estimate isn't biased low by fresh fast-patched vulns.
 * Events are resolved rows at `t = mttr_days`; censored rows are open findings at
 * `c = age_days` (rows with a null time drop out). At each distinct event time t_k the
 * risk set is `n_k = #{time >= t_k}` over events *and* censored, `d_k = #{events at t_k}`,
 * and survival `S(t_k) = Π (1 − d_k/n_k)`. The median is the smallest t_k with
 * `S(t_k) <= 0.5` (the inclusive crossing makes an exact-0.5 tie return that time).
 * Returns null when there are no events, or S never falls to 0.5 (too much censoring) —
 * i.e. over half of findings are still open. The UI renders that null as "—".
 */
export function kmMedian(rows: RemediationRow[]): number | null {
  const events: number[] = []; // resolved times
  const times: number[] = []; // every observation time (event or censored) — the risk set
  for (const row of rows) {
    const m = resolvedMttr(row);
    if (m !== null) {
      events.push(m);
      times.push(m);
      continue;
    }
    const c = openAge(row);
    if (c !== null) times.push(c);
  }
  if (!events.length) return null; // empty or all-censored → no median

  let s = 1;
  for (const t of [...new Set(events)].sort((a, b) => a - b)) {
    const n = times.filter((x) => x >= t).length;
    if (n === 0) continue;
    const d = events.filter((x) => x === t).length;
    s *= 1 - d / n;
    if (s <= 0.5) return t;
  }
  return null;
}

export interface OpenSlaSev {
  open: number;
  breached: number;
  pct: number | null;
  target: number | null;
}

export interface OpenSlaOverall {
  open: number;
  breached: number;
  pct: number | null;
}

export interface OpenPastSla {
  perSev: Record<string, OpenSlaSev>;
  overall: OpenSlaOverall;
}

/**
 * Open findings already older than their severity's SLA target — the aged backlog the
 * resolved-only "In SLA %" never scores. Over open rows with a finite age_days, breached
 * iff `age_days > SLA_TARGETS[sev]` (strict `>`, the dual of the in-SLA `d <= target`).
 * A severity with no target (e.g. UNKNOWN) gets `target: null` and never breaches. `pct`
 * is null only when `open === 0` (no open sample to score).
 */
export function openPastSla(rows: RemediationRow[]): OpenPastSla {
  const perSev: Record<string, OpenSlaSev> = {};
  let totalOpen = 0;
  let totalBreached = 0;
  for (const row of rows) {
    const age = openAge(row);
    if (age === null) continue;
    const s = normalizeSeverity(row.severity);
    const target = SLA_TARGETS[s] ?? null;
    const stat = perSev[s] ?? (perSev[s] = { open: 0, breached: 0, pct: null, target });
    stat.open += 1;
    totalOpen += 1;
    if (target !== null && age > target) {
      stat.breached += 1;
      totalBreached += 1;
    }
  }
  for (const stat of Object.values(perSev)) {
    stat.pct = stat.open ? (stat.breached / stat.open) * 100 : null;
  }
  return {
    perSev,
    overall: {
      open: totalOpen,
      breached: totalBreached,
      pct: totalOpen ? (totalBreached / totalOpen) * 100 : null,
    },
  };
}

/**
 * The `openPastSla.overall.breached` count computed from a current-scan FRAME (dotted
 * records + injected `now`), for the history-snapshot writer that runs in
 * scanJobs.afterPersist before any ledger view exists. Age comes from the first-seen
 * column (metrics.findCol) against `now`, not durable age_days, so — like the other
 * frame-based snapshot fields — it can disagree slightly with the ledger-based trend
 * series that the UI actually draws. Rows missing a first-seen timestamp, or whose
 * severity has no SLA target, never count.
 */
export function openPastSlaFromRecords(records: Rec[], now?: number): number {
  if (!records.length) return 0;
  const nowMs = now ?? Date.now();
  const firstSeenCol = findCol(recordColumns(records), "firstSeenAt", "firstDetectedAt", "createdAt");
  if (!firstSeenCol) return 0;
  let breached = 0;
  for (const rec of records) {
    if (!isOpen(rec["status"])) continue;
    const first = parseTs(rec[firstSeenCol]);
    if (first === null) continue;
    const s = "severity" in rec ? normalizeSeverity(rec["severity"]) : "UNKNOWN";
    const target = SLA_TARGETS[s];
    if (target !== undefined && (nowMs - first) / DAY_MS > target) breached += 1;
  }
  return breached;
}
