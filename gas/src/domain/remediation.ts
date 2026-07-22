// Remediation-tail analytics for the MTTR page: percentiles, a time-to-resolve
// histogram, a censoring-aware Kaplan–Meier survival estimator (median, RMST mean,
// and the survival curve), and the "open past SLA" backlog the resolved-only headline
// hides.
//
// GAS-first module (no Python fixture parity — the Streamlit side is discontinued).
// Pure functions over ledger base rows (durable lifecycle: mttr_days for resolved
// findings, age_days for open ones — both already baked with `now` by
// ledgerCore.baseRows). openPastSlaFromRecords is the lone frame-based variant, for
// the snapshot writer that runs before any ledger exists (see its note).

import { REMEDIATION_ROLLOUT_ISO, RESOLVED_STATUSES, SEVERITY_ORDER, SLA_TARGETS } from "./config";
import type { BaseRow } from "./ledgerCore";
import { findCol, recordColumns } from "./metrics";
import { normalizeSeverity } from "./severity";
import { maxNum, mean, median, parseTs, present, quantile, type Rec } from "./util";

const DAY_MS = 86_400_000;

// The legacy boundary as epoch ms, parsed once (see REMEDIATION_ROLLOUT_ISO / ledgerCore's
// ROLLOUT_MS): rows first seen before it had a fix by construction, so they never count as
// no-fix. Shared by recordNoFix so the frame predicate agrees with the ledger derivation.
const ROLLOUT_MS = parseTs(REMEDIATION_ROLLOUT_ISO);

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

// One step of the Kaplan–Meier staircase: the survival S(t) after the drop at a distinct
// event time t, the risk-set size just before it, and how many events landed at it.
export interface KMPoint {
  t: number;
  s: number; // S(t) after the drop
  atRisk: number;
  events: number;
}

export interface KMResult {
  curve: KMPoint[]; // distinct event times ascending; the implicit anchor S(0)=1 is not stored
  median: number | null; // smallest event time with S(t) <= 0.5
  medianLowerBound: number | null; // when median is null: the max observed time (else null)
  mean: number | null; // restricted mean (RMST); null when there are no events
  restrictionTime: number | null; // τ = max observed time (events ∪ censored); null when empty
  meanTruncated: boolean; // S(τ) > 0 → survival hadn't reached 0, so RMST is a lower bound
  naiveMean: number | null; // mean of closed-only mttr_days (util.mean); null with no events
  naiveMedian: number | null; // linear-interp median of closed-only (util.median); null likewise
  events: number;
  censored: number;
  total: number;
}

/**
 * The Kaplan–Meier survival staircase over `events` (resolved times) against `times` (the
 * full risk set — every observation, event OR censored). One point per distinct event time
 * in ascending order: the risk set is `atRisk = #{time >= t}` over `times`, `events = #{event
 * times == t}`, and survival `S(t) = Π (1 − events/atRisk)`. A distinct event time whose risk
 * set has already emptied (atRisk 0, possible only if a censored obs equals it exactly) is
 * skipped, matching the original scalar estimator. Shared by kaplanMeier and trend.withKmMedian
 * so the estimator loop is written once and the two can't drift.
 */
export function kmCurve(events: number[], times: number[]): KMPoint[] {
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
 * The Kaplan–Meier q-th quantile off a curve: the smallest event time whose survival has fallen
 * to `S(t) <= 1 − q`. q=0.5 is the median (S ≤ 0.5); q=0.9 is the p90 (S ≤ 0.10 — the time by
 * which nine in ten findings are remediated). Censoring-aware, so the slow tail isn't biased low
 * by the fast-patched vulns that close first. Null when survival never falls that far (too much
 * still open) or the curve is empty; the UI renders that null as "—". The inclusive crossing
 * makes an exact tie (e.g. S(t) hits 0.5 exactly) return that time.
 */
export function kmQuantileFromCurve(curve: KMPoint[], q: number): number | null {
  const threshold = 1 - q;
  for (const p of curve) if (p.s <= threshold) return p.t;
  return null;
}

/**
 * The Kaplan–Meier median off a curve: the smallest event time whose survival has fallen to
 * `S(t) <= 0.5` (the inclusive crossing makes an exact-0.5 tie return that time). Null when S
 * never reaches 0.5 (too much censoring — over half of findings still open) or the curve is
 * empty; the UI renders that null as "—" (or "> X d" against medianLowerBound).
 */
export function kmMedianFromCurve(curve: KMPoint[]): number | null {
  return kmQuantileFromCurve(curve, 0.5);
}

/**
 * Kaplan–Meier time-to-remediation, treating still-open findings as right-censored so the
 * estimate isn't biased low by fresh fast-patched vulns. Events are resolved rows at
 * `t = mttr_days`; censored rows are open findings at `c = age_days` (rows with a null time
 * drop out of both). Returns the survival curve plus the two headline stats and the naive
 * closed-only comparison:
 *
 *  - `median`: smallest event time with S(t) <= 0.5 (see kmMedianFromCurve); null under heavy
 *    censoring, in which case `medianLowerBound` carries the max observed time so the UI can
 *    say "> X d" instead of "—". When the median is known, medianLowerBound is null.
 *  - `mean`: the restricted mean survival time (RMST) — the area under the KM curve out to the
 *    restriction time τ = `restrictionTime` (the max observed time, event OR censored). With
 *    curve points (t_1,S_1)…(t_m,S_m) and the anchor t_0=0, S_0=1:
 *      RMST = Σ_{k=1..m} S_{k-1}·(t_k − t_{k-1}) + S_m·(τ − t_m).
 *    `meanTruncated` is `S_m > 0` — survival hadn't reached 0 by τ, so the RMST is a lower
 *    bound (UI shows "≥"). Null (with median/restrictionTime handled below) when no events.
 *  - `naiveMean` / `naiveMedian`: the plain mean / linear-interpolation median over the
 *    closed-only mttr_days (util.mean / util.median), the biased comparison stats; both null
 *    when nothing resolved.
 *  - counts: `events` (resolved with a finite time), `censored` (open with a finite age), and
 *    `total` = their sum (null-time rows contribute to none).
 *
 * No events → `curve: []`, median/mean null, `medianLowerBound = restrictionTime = max(times)`
 * (null when there are no observations at all), meanTruncated false, counts still filled.
 */
export function kaplanMeier(rows: RemediationRow[]): KMResult {
  const events: number[] = []; // resolved times
  const censored: number[] = []; // open ages
  for (const row of rows) {
    const m = resolvedMttr(row);
    if (m !== null) {
      events.push(m);
      continue;
    }
    const c = openAge(row);
    if (c !== null) censored.push(c);
  }
  const times = events.concat(censored); // the risk set: every observation time
  const total = events.length + censored.length;
  // maxNum, not Math.max(...times): `times` holds one entry per finding (the whole risk set),
  // so spreading it into Math.max overflows the call stack on large registers.
  const restrictionTime = times.length ? maxNum(times) : null;
  const naiveMean = mean(events);
  const naiveMedian = median(events);

  if (!events.length) {
    // Empty or all-censored: no curve, no median/mean. The max observed time is the lower
    // bound the UI shows for the (unreached) median.
    return {
      curve: [],
      median: null,
      medianLowerBound: restrictionTime,
      mean: null,
      restrictionTime,
      meanTruncated: false,
      naiveMean,
      naiveMedian,
      events: 0,
      censored: censored.length,
      total,
    };
  }

  const curve = kmCurve(events, times);
  const median_ = kmMedianFromCurve(curve);

  // RMST = area under the staircase to τ: rectangles S_{k-1}·(t_k − t_{k-1}) plus the final
  // S_m·(τ − t_m). After the loop prevS is S_m and prevT is t_m.
  const tau = restrictionTime!; // events non-empty → times non-empty → τ is finite
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
    median: median_,
    medianLowerBound: median_ === null ? restrictionTime : null,
    mean: rmst,
    restrictionTime,
    meanTruncated: prevS > 0, // S(τ) = S_m > 0
    naiveMean,
    naiveMedian,
    events: events.length,
    censored: censored.length,
    total,
  };
}

/** Scalar KM median — the thin wrapper preserving the original call/test semantics. */
export function kmMedian(rows: RemediationRow[]): number | null {
  return kaplanMeier(rows).median;
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

/**
 * Re-project base rows onto the RemediationRow shape using the *actionable* clock —
 * mttr_actionable_days / actionable_age_days (baked by ledgerCore.baseRows) in place of
 * the from-detection mttr_days / age_days. Feed the result to openPastSla, kaplanMeier,
 * or mttrPercentiles and they measure from vendor-fix availability instead
 * of first detection, with no change to their bodies. Awaiting-vendor-fix rows carry null
 * actionable fields, so they drop out of every clock here automatically (a resolved row
 * with no fix ever observed likewise has a null mttr_actionable_days) while still counting
 * in awaitingVendorFix / the open backlog.
 */
export function actionableView(
  rows: Pick<BaseRow, "severity" | "status" | "mttr_actionable_days" | "actionable_age_days">[],
): RemediationRow[] {
  return rows.map((r) => ({
    severity: r.severity,
    status: r.status,
    mttr_days: r.mttr_actionable_days,
    age_days: r.actionable_age_days,
  }));
}

export interface AwaitingVendorFix {
  perSev: Record<string, number>;
  overall: number;
  openTotal: number;
  pctOfOpen: number | null;
}

/**
 * The "awaiting vendor fix" segment: OPEN findings with no vendor fix available yet
 * (awaiting_vendor_fix, set in ledgerCore.baseRows), which is exactly the population the
 * actionable clock excludes — they sit outside every SLA/MTTR deadline until a fix
 * appears. perSev / overall count those rows by normalized severity; openTotal is the full
 * open backlog for context, and pctOfOpen is the awaiting share of it — null when nothing
 * is open, so the UI never renders a fake 0% against an empty denominator.
 */
export function awaitingVendorFix(
  rows: Pick<BaseRow, "severity" | "status" | "awaiting_vendor_fix">[],
): AwaitingVendorFix {
  const perSev: Record<string, number> = {};
  let overall = 0;
  let openTotal = 0;
  for (const row of rows) {
    if (!isOpen(row.status)) continue;
    openTotal += 1;
    if (!row.awaiting_vendor_fix) continue;
    const s = normalizeSeverity(row.severity);
    perSev[s] = (perSev[s] ?? 0) + 1;
    overall += 1;
  }
  return {
    perSev,
    overall,
    openTotal,
    pctOfOpen: openTotal ? (overall / openTotal) * 100 : null,
  };
}

/**
 * "No fix" predicate over a durable base row — an OPEN finding with no vendor fix available
 * yet (exactly `awaiting_vendor_fix`, set in ledgerCore.baseRows). Resolved rows carry
 * `awaiting_vendor_fix === false`, so they are never hidden. The choke-point filter behind
 * the global "show findings without a vendor fix" toggle.
 */
export function baseRowNoFix(row: Pick<BaseRow, "awaiting_vendor_fix">): boolean {
  return row.awaiting_vendor_fix === true;
}

/**
 * The frame-record equivalent of baseRowNoFix, for the current-scan record surfaces that
 * run before (or without) a ledger view. Mirrors ledgerCore.baseRows' awaiting_vendor_fix
 * derivation: resolved records are never no-fix; a legacy record first seen before the
 * broadened-ingestion rollout had a fix by construction (the old filter only ingested fixed
 * findings); otherwise it's no-fix unless it carries a concrete fix signal — the same
 * `fixedVersion || fixDate` presence test reconcile.ts uses.
 */
export function recordNoFix(rec: Rec): boolean {
  if (!isOpen(rec["status"])) return false;
  const first = parseTs(rec["firstDetectedAt"] ?? rec["firstSeenAt"] ?? rec["createdAt"]);
  if (first !== null && ROLLOUT_MS !== null && first < ROLLOUT_MS) return false; // legacy = fixed
  return !(present(rec["fixedVersion"]) || present(rec["fixDate"]));
}

/**
 * Whether a vulnerability *name* is Wiz's end-of-life-OS notice — the finding it reports per host on
 * an EOL operating system, whose name is a phrase (e.g. "End-Of-life version of operating system")
 * rather than a CVE id. That record does NOT reliably carry `isOperatingSystemEndOfLife`, so the EOL
 * filter matches the name too. Normalized to letters-and-single-spaces first, so hyphen / case /
 * spacing variants all hit. Base rows carry this string as their `cve` (= the finding name).
 */
export function isEndOfLifeName(name: unknown): boolean {
  if (typeof name !== "string" || !name) return false;
  const n = name.toLowerCase().replace(/[^a-z]+/g, " ");
  return n.includes("end of life") && n.includes("operating system");
}

/**
 * "End-of-life OS" predicate over a current-scan frame record: Wiz flagged the finding's OS as EOL
 * (`isOperatingSystemEndOfLife`), or the record IS the EOL-OS notice finding (matched by name). The
 * frame-record choke point behind the global "include end-of-life OS findings" toggle.
 */
export function recordEol(rec: Rec): boolean {
  return rec["isOperatingSystemEndOfLife"] === true || isEndOfLifeName(rec["name"]);
}
