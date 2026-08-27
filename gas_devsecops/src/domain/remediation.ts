// How long a finding actually lives, once you stop discarding everything still open.
//
// THIS FILE IS THE REGISTER'S FIRST RULE MADE EXECUTABLE. The clock is the product, and a
// clock has to say where it started: open findings stay in as RIGHT-CENSORED observations,
// and where the survival curve never falls to half, the page publishes a lower bound rather
// than an invented number.
//
// That is not a stylistic preference. A median over closed rows only is biased low by
// construction — the findings that closed fast are the ones that had time to close, and the
// year-old CRITICAL nobody has touched contributes nothing to it. On a register that is
// 1,859 OPEN against 72 RESOLVED (§3, the CODE secrets population), the closed-only median
// describes 3.7% of the estate. `naiveMedian` is kept beside the KM estimate for exactly
// that comparison, so the page can show the gap instead of hiding it.
//
// Port of the subset of gas/src/domain/remediation.ts the MTTR & SLA page needs. Left there
// for now: latencySegments, actionableView, the EOL helpers.

import { RESOLVED_STATUSES, SEVERITY_ORDER, SLA_TARGETS } from "./config";
import type { BaseRow } from "./ledgerCore";
import { normalizeSeverity } from "./severity";
import { maxNum, mean, median, quantile } from "./util";

/** Every function here reads only this projection of a ledger row. */
export type RemediationRow = Pick<BaseRow, "severity" | "status" | "mttr_days" | "age_days">;

/** Time-to-resolve histogram edges (days), bucketed with `<=`. */
export const RESOLUTION_BUCKET_EDGES = [1, 7, 30, 90] as const;
export const RESOLUTION_BUCKET_LABELS = ["≤1d", "2–7d", "8–30d", "31–90d", "90+d"] as const;

function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

/** A resolved row's remediation time, or null when it has no finite sample. */
function resolvedMttr(row: RemediationRow): number | null {
  const m = row.mttr_days;
  return typeof m === "number" && Number.isFinite(m) ? m : null;
}

/** An open row's age, or null when resolved / missing an age sample. */
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
 * Median and p90 of RESOLVED lifecycles, per severity and overall.
 *
 * The biased pair, kept deliberately and labelled as such: `count` is the denominator and
 * the page must print it, because "median 12 d" over 400 resolved of 20,076 is not a
 * statement about the register.
 */
export function mttrPercentiles(rows: readonly RemediationRow[]): MttrPercentiles {
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

export interface ResolutionBuckets {
  perSev: Record<string, [number, number, number, number, number]>;
  labels: typeof RESOLUTION_BUCKET_LABELS;
  total: number;
}

/**
 * Time-to-resolve histogram over resolved rows, split per severity.
 *
 * Open rows are excluded and that exclusion is the point of the `total` field: it is the
 * denominator, and it is not the size of the register.
 */
export function resolutionBuckets(rows: readonly RemediationRow[]): ResolutionBuckets {
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
    perSev[s]![bucket] += 1;
    total += 1;
  }
  return { perSev, labels: RESOLUTION_BUCKET_LABELS, total };
}

/** One step of the KM staircase: S(t) after the drop, the risk set before it, the events at it. */
export interface KMPoint {
  t: number;
  s: number;
  atRisk: number;
  events: number;
}

export interface KMResult {
  /** Distinct event times ascending. The implicit anchor S(0)=1 is not stored. */
  curve: KMPoint[];
  /** Smallest event time with S(t) <= 0.5. */
  median: number | null;
  /** When `median` is null: the max observed time, so the page can say "> X d". */
  medianLowerBound: number | null;
  /** Restricted mean survival time (RMST). */
  mean: number | null;
  /** τ — the max observed time, event OR censored. */
  restrictionTime: number | null;
  /** S(τ) > 0: survival never reached 0, so the RMST is a LOWER BOUND. */
  meanTruncated: boolean;
  /** The biased comparison: plain mean over closed rows only. */
  naiveMean: number | null;
  naiveMedian: number | null;
  events: number;
  censored: number;
  total: number;
}

/**
 * The Kaplan–Meier survival staircase over `events` (resolved times) against `times` (the
 * full risk set — every observation, event OR censored).
 *
 * `atRisk = #{time >= t}`, `d = #{event times == t}`, `S(t) = Π (1 − d/atRisk)`. A distinct
 * event time whose risk set has already emptied is skipped.
 */
export function kmCurve(events: readonly number[], times: readonly number[]): KMPoint[] {
  const curve: KMPoint[] = [];
  let s = 1;
  for (const t of [...new Set(events)].sort((a, b) => a - b)) {
    const atRisk = times.filter((x) => x >= t).length;
    if (atRisk === 0) continue;
    const d = events.filter((x) => x === t).length;
    s *= 1 - d / atRisk;
    curve.push({ t, s, atRisk, events: d });
  }
  return curve;
}

/**
 * The crossing tolerance, and it is a CORRECTION to the source rather than a copy of it.
 *
 * `S(t)` is a running product of `(1 − d/atRisk)`, so a curve that mathematically lands
 * exactly on the threshold can land one ULP above it. Measured, on ten events at times 1..10
 * with no censoring — where S(t) is exactly (10−t)/10:
 *
 *     S(9) = 0.10000000000000002, and `0.10000000000000002 <= 0.1` is false
 *
 * so the p90 reported 10 rather than 9. gas/src/domain/remediation.ts has the same exact
 * comparison and its docstring claims "the inclusive crossing makes an exact tie return that
 * time" — which is what the arithmetic intends and not what the floats do.
 *
 * The error direction is benign (it overstates time-to-remediate, which is the safe way for
 * a security register to be wrong) but its KIND is not: whether the answer is 9 or 10 depends
 * on accumulation order, so two arithmetically identical estates can report different p90s.
 * 1e-9 is nine orders of magnitude below any survival difference the page can render.
 */
const CROSSING_EPSILON = 1e-9;

/**
 * The KM q-th quantile: the smallest event time whose survival has fallen to `S(t) <= 1−q`.
 *
 * Censoring-aware, so the slow tail is not biased low by the fast-patched findings that
 * close first. Null when survival never falls that far — which is a real answer and must be
 * rendered as one, not as a zero.
 */
export function kmQuantileFromCurve(curve: readonly KMPoint[], q: number): number | null {
  const threshold = 1 - q + CROSSING_EPSILON;
  for (const p of curve) if (p.s <= threshold) return p.t;
  return null;
}

/** The KM median: the smallest event time with `S(t) <= 0.5`. Null under heavy censoring. */
export function kmMedianFromCurve(curve: readonly KMPoint[]): number | null {
  return kmQuantileFromCurve(curve, 0.5);
}

/**
 * Kaplan–Meier time-to-remediation, treating still-open findings as right-censored.
 *
 * Events are resolved rows at `t = mttr_days`; censored rows are open findings at
 * `c = age_days`. A row with neither drops out of both and out of `total` — it is not
 * evidence in either direction.
 *
 *  - `median` null means over half of the register is still open at every observed time.
 *    `medianLowerBound` then carries τ so the page says "> X d" rather than "—", which is
 *    the difference between "we do not know" and "we know it is at least this bad".
 *  - `mean` is the RMST: the area under the curve out to τ. With points (t_1,S_1)…(t_m,S_m)
 *    and the anchor t_0=0, S_0=1:
 *      RMST = Σ S_{k-1}·(t_k − t_{k-1}) + S_m·(τ − t_m).
 *    `meanTruncated` is `S_m > 0` — survival had not reached 0 by τ, so it is a lower bound.
 */
export function kaplanMeier(rows: readonly RemediationRow[]): KMResult {
  const events: number[] = [];
  const censored: number[] = [];
  for (const row of rows) {
    const m = resolvedMttr(row);
    if (m !== null) {
      events.push(m);
      continue;
    }
    const c = openAge(row);
    if (c !== null) censored.push(c);
  }
  const times = events.concat(censored);
  const total = events.length + censored.length;
  // maxNum, not Math.max(...times): the risk set holds one entry per finding — ~20,000 here
  // — and spreading it into a call overflows the stack.
  const restrictionTime = times.length ? maxNum(times) : null;
  const naiveMean = mean(events);
  const naiveMedian = median(events);

  if (!events.length) {
    // Nothing has closed. That is not "MTTR unknown" — every open finding still sets a floor,
    // so the max observed age is published as the lower bound.
    return {
      curve: [], median: null, medianLowerBound: restrictionTime,
      mean: null, restrictionTime, meanTruncated: false,
      naiveMean, naiveMedian, events: 0, censored: censored.length, total,
    };
  }

  const curve = kmCurve(events, times);
  const med = kmMedianFromCurve(curve);

  const tau = restrictionTime!; // events non-empty -> times non-empty -> τ is finite
  let rmst = 0;
  let prevT = 0;
  let prevS = 1;
  for (const p of curve) {
    rmst += prevS * (p.t - prevT);
    prevT = p.t;
    prevS = p.s;
  }
  rmst += prevS * (tau - prevT);

  return {
    curve,
    median: med,
    medianLowerBound: med === null ? restrictionTime : null,
    mean: rmst,
    restrictionTime,
    meanTruncated: prevS > 0,
    naiveMean,
    naiveMedian,
    events: events.length,
    censored: censored.length,
    total,
  };
}

export interface OpenSlaSev {
  open: number;
  breached: number;
  pct: number | null;
  target: number | null;
}

export interface OpenPastSla {
  perSev: Record<string, OpenSlaSev>;
  overall: { open: number; breached: number; pct: number | null };
}

/**
 * Open findings already older than their severity's SLA target — the aged backlog a
 * resolved-only "in SLA %" never scores.
 *
 * Breached iff `age_days > SLA_TARGETS[sev]`, strict, the dual of the in-SLA `d <= target`.
 * A severity with no target never breaches and says so with `target: null` rather than
 * silently scoring 0 — an unset target is not a met one.
 */
export function openPastSla(rows: readonly RemediationRow[]): OpenPastSla {
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

export interface OpenAgeStats {
  p50: number | null;
  p90: number | null;
  count: number;
}

/**
 * How old the still-open backlog is, per severity and overall.
 *
 * The counterpart to `mttrPercentiles`, and the reason both exist: one describes what got
 * fixed, the other what did not. A page showing only the first is describing the wrong half.
 */
export function openAgePercentiles(
  rows: readonly RemediationRow[],
): { perSev: Record<string, OpenAgeStats>; overall: OpenAgeStats } {
  const bySev: Record<string, number[]> = {};
  const all: number[] = [];
  for (const row of rows) {
    const a = openAge(row);
    if (a === null) continue;
    const s = normalizeSeverity(row.severity);
    (bySev[s] ?? (bySev[s] = [])).push(a);
    all.push(a);
  }
  const perSev: Record<string, OpenAgeStats> = {};
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

export interface AwaitingVendorFix {
  count: number;
  /** Of the OPEN rows in scopes that have a vendor — the only honest denominator. */
  openWithVendor: number;
  pct: number | null;
}

/**
 * Open SCA findings with no vendor fix available — waiting on a vendor, not on a team.
 *
 * The denominator is open rows IN A SCOPE THAT HAS A VENDOR, never the whole register.
 * `baseRows` already guarantees `awaiting_vendor_fix` is false for SAST and secrets (neither
 * has a vendor), so counting those 2,085 rows into the denominator would report a share of a
 * population the question does not apply to.
 */
export function awaitingVendorFix(
  rows: readonly Pick<BaseRow, "scope" | "status" | "awaiting_vendor_fix">[],
): AwaitingVendorFix {
  let count = 0;
  let openWithVendor = 0;
  for (const row of rows) {
    if (row.scope !== "sca" || !isOpen(row.status)) continue;
    openWithVendor += 1;
    if (row.awaiting_vendor_fix) count += 1;
  }
  return { count, openWithVendor, pct: openWithVendor ? (count / openWithVendor) * 100 : null };
}
