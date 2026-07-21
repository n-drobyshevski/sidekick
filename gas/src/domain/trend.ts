// Cumulative open/resolved/MTTR/SLA trend — the port of ledger._trend_from_frames.
//
// For each saved flat scan timestamp: vulns open vs resolved as of that instant, the
// median MTTR of everything resolved by then, the In-SLA share, and the oldest-open
// age (max over severities of the p90 open age) — matching the headline KPIs.

import { SEVERITY_ORDER, SLA_TARGETS } from "./config";
import { kmCurve, kmMedianFromCurve } from "./remediation";
import { normalizeSeverity } from "./severity";
import { maxNum, median, minNum, parseTs, quantile, toIso, type Rec } from "./util";

export interface TrendPoint {
  date: string; // the scan ts (ISO)
  open: number;
  resolved: number;
  median_days: number | null;
  sla_pct: number | null;
  oldest_open_days: number | null;
}

const DAY_MS = 86_400_000;

/**
 * Whether a finding was open AND still awaiting a vendor fix as of instant `d` — the
 * as-of-date companion of ledgerCore's `awaiting_vendor_fix` (which is only ever "now").
 * A finding counts as awaiting-as-of-d iff it was open as of d (first_seen <= d and not
 * resolved by d) and no vendor fix was available by d (fixAvailMs null, or later than d).
 * A fix that arrives after d re-admits the finding at any later point, so a hidden
 * awaiting-then-fixed row steps back into the open trend on the point where its fix lands.
 */
export function awaitingFixAsOf(
  firstMs: number | null,
  resolvedMs: number | null,
  fixAvailMs: number | null,
  d: number,
): boolean {
  const openAsOfD = firstMs !== null && firstMs <= d && (resolvedMs === null || resolvedMs > d);
  return openAsOfD && (fixAvailMs === null || fixAvailMs > d);
}

/**
 * scans: rows with {ts, shape}; base: ledger+episode rows with {severity, first_seen,
 * resolved_at, mttr_days}. severities (optional) restricts to those + UNKNOWN.
 *
 * opts.hideNoFix (default false) excludes, as of each point's date, findings still awaiting
 * a vendor fix then (awaitingFixAsOf over the row's `fix_available_at`) from the OPEN count
 * only — the resolved / median / SLA series read the untouched resolvedMask, so they stay
 * byte-identical. With hideNoFix absent/false the whole function is byte-identical to today,
 * so the golden-fixture parity tests are unaffected.
 */
export function trendFromFrames(
  scans: Rec[],
  base: Rec[],
  severities: string[] | null = null,
  opts: { hideNoFix?: boolean } = {},
): TrendPoint[] {
  const hideNoFix = opts.hideNoFix ?? false;
  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  if (!scans.length || !rows.length) return [];

  const flatTs = scans
    .filter((s) => s["shape"] === "flat")
    .map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) }))
    .filter((t): t is { iso: string; ms: number } => t.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (!flatTs.length) return [];

  const parsed = rows.map((r) => ({
    first: parseTs(r["first_seen"]),
    resolvedAt: parseTs(r["resolved_at"]),
    mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"])
      ? (r["mttr_days"] as number)
      : null,
    sev: normalizeSeverity(r["severity"]),
    fixAvail: parseTs(r["fix_available_at"]),
  }));

  const out: TrendPoint[] = [];
  for (const ts of flatTs) {
    const resolvedMask = parsed.map((r) => r.resolvedAt !== null && r.resolvedAt <= ts.ms);
    const openMask = parsed.map(
      (r) =>
        r.first !== null &&
        r.first <= ts.ms &&
        (r.resolvedAt === null || r.resolvedAt > ts.ms) &&
        !(hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms)),
    );

    const resolvedMttr = parsed
      .filter((_, i) => resolvedMask[i])
      .map((r) => r.mttr)
      .filter((m): m is number => m !== null);
    const med = median(resolvedMttr);

    // In-SLA %: of everything resolved-by-ts with an MTTR sample, the share whose MTTR
    // met its severity target (no-target severities count against).
    const denom = resolvedMttr.length;
    const within = parsed.filter(
      (r, i) =>
        resolvedMask[i] &&
        r.mttr !== null &&
        SLA_TARGETS[r.sev] !== undefined &&
        r.mttr <= SLA_TARGETS[r.sev],
    ).length;
    const slaPct = denom ? (within / denom) * 100 : null;

    // Oldest open: max over severities of the p90 open age as of ts.
    const p90s: number[] = [];
    for (const sev of SEVERITY_ORDER) {
      const ages = parsed
        .filter((r, i) => openMask[i] && r.sev === sev)
        .map((r) => (ts.ms - r.first!) / DAY_MS);
      if (ages.length) {
        const p = quantile(ages, 0.9);
        if (p !== null) p90s.push(p);
      }
    }
    const oldest = p90s.length ? maxNum(p90s) : null;

    out.push({
      date: ts.iso,
      open: openMask.filter(Boolean).length,
      resolved: resolvedMask.filter(Boolean).length,
      median_days: med !== null ? Math.round(med * 1000) / 1000 : null,
      sla_pct: slaPct !== null ? Math.round(slaPct * 10) / 10 : null,
      oldest_open_days: oldest !== null ? Math.round(oldest * 1000) / 1000 : null,
    });
  }
  return out;
}

export interface OpenBySevPoint {
  date: string; // the scan ts (ISO)
  bySev: Record<string, number>; // open count per normalized severity as of `date`
}

/**
 * Open findings per severity over time — the data behind the Overview "Severity
 * breakdown" line chart. For each saved flat-scan timestamp it replays the durable
 * ledger and counts, per normalized severity, the vulns open as of that instant (the
 * same open predicate `trendFromFrames` uses: first_seen <= ts and not resolved by ts).
 *
 * GAS-first (no Python fixture parity): a UI-only aggregation of the same durable rows,
 * kept separate from `trendFromFrames` so its parity-tested shape stays untouched.
 *
 * scans: rows with {ts, shape}; base: ledger+episode rows with {severity, first_seen,
 * resolved_at}. severities (optional) restricts to those + UNKNOWN, as elsewhere.
 * opts.hideNoFix (default false) excludes findings awaiting a vendor fix as of each date
 * (awaitingFixAsOf over `fix_available_at`); absent/false is byte-identical to today.
 */
export function openBySeverityTrend(
  scans: Rec[],
  base: Rec[],
  severities: string[] | null = null,
  opts: { hideNoFix?: boolean } = {},
): OpenBySevPoint[] {
  const hideNoFix = opts.hideNoFix ?? false;
  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  if (!scans.length || !rows.length) return [];

  const flatTs = scans
    .filter((s) => s["shape"] === "flat")
    .map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) }))
    .filter((t): t is { iso: string; ms: number } => t.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (!flatTs.length) return [];

  const parsed = rows.map((r) => ({
    first: parseTs(r["first_seen"]),
    resolvedAt: parseTs(r["resolved_at"]),
    sev: normalizeSeverity(r["severity"]),
    fixAvail: parseTs(r["fix_available_at"]),
  }));

  return flatTs.map((ts) => {
    const bySev: Record<string, number> = {};
    for (const r of parsed) {
      const isOpen =
        r.first !== null &&
        r.first <= ts.ms &&
        (r.resolvedAt === null || r.resolvedAt > ts.ms);
      if (!isOpen) continue;
      if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms)) continue;
      bySev[r.sev] = (bySev[r.sev] ?? 0) + 1;
    }
    return { date: ts.iso, bySev };
  });
}

export interface OpenByGroupPoint {
  date: string; // the scan ts (ISO)
  byGroup: Record<string, number>; // open count per group value as of `date`
}

/**
 * Open findings per breakdown group over time — the data behind the Overview
 * "Breakdown" group-evolution line chart. Generalizes `openBySeverityTrend` from the
 * fixed severity key to an arbitrary `keyOf` group value: for each saved flat-scan
 * timestamp it replays the durable ledger and counts, per group, the vulns open as of
 * that instant (the same open predicate `trendFromFrames` uses: first_seen <= ts and
 * not resolved by ts).
 *
 * Group value is `keyOf(r)`; blank/missing folds to "(none)" (matching `groupTree`'s
 * normalization). Only values in `groups` keep their own series; everything else folds
 * into `otherLabel` (default "Other") when `includeOther` (default true), else drops.
 *
 * GAS-first (no Python fixture parity — mirrors `openBySeverityTrend`): a UI-only
 * aggregation of the same durable rows, kept separate from `trendFromFrames` so its
 * parity-tested shape stays untouched.
 *
 * scans: rows with {ts, shape}; base: ledger+episode rows with {first_seen, resolved_at,
 * severity} plus whatever column `keyOf` reads. opts.severities (optional) restricts to
 * those + UNKNOWN, as elsewhere. opts.hideNoFix (default false) excludes findings awaiting a
 * vendor fix as of each date (awaitingFixAsOf over `fix_available_at`); absent/false is
 * byte-identical to today.
 */
export function openByGroupTrend(
  scans: Rec[],
  base: Rec[],
  keyOf: (r: Rec) => string,
  groups: string[],
  opts: {
    severities?: string[] | null;
    includeOther?: boolean;
    otherLabel?: string;
    hideNoFix?: boolean;
  } = {},
): OpenByGroupPoint[] {
  const severities = opts.severities ?? null;
  const includeOther = opts.includeOther ?? true;
  const otherLabel = opts.otherLabel ?? "Other";
  const hideNoFix = opts.hideNoFix ?? false;

  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  if (!scans.length || !rows.length) return [];

  const flatTs = scans
    .filter((s) => s["shape"] === "flat")
    .map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) }))
    .filter((t): t is { iso: string; ms: number } => t.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (!flatTs.length) return [];

  const inGroup = new Set(groups);
  const parsed = rows.map((r) => {
    const raw = keyOf(r);
    const value = raw.trim() === "" ? "(none)" : raw;
    const known = inGroup.has(value);
    return {
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      fixAvail: parseTs(r["fix_available_at"]),
      group: known ? value : otherLabel,
      kept: known || includeOther,
    };
  });

  return flatTs.map((ts) => {
    const byGroup: Record<string, number> = {};
    for (const r of parsed) {
      if (!r.kept) continue;
      const isOpen =
        r.first !== null &&
        r.first <= ts.ms &&
        (r.resolvedAt === null || r.resolvedAt > ts.ms);
      if (!isOpen) continue;
      if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms)) continue;
      byGroup[r.group] = (byGroup[r.group] ?? 0) + 1;
    }
    return { date: ts.iso, byGroup };
  });
}

export interface MttrByGroupPoint {
  date: string; // the scan ts (ISO)
  byGroup: Record<string, number | null>; // median mttr_days as of `date`; null = no resolved rows yet
}

/**
 * Median MTTR (days) per breakdown group over time — the data behind the MTTR page
 * "MTTR by domain" line chart. The remediation sibling of `openByGroupTrend`: for each
 * saved flat-scan timestamp it replays the durable ledger and computes, per group, the
 * median `mttr_days` over that group's rows resolved as of that instant (the same
 * cumulative resolved predicate `trendFromFrames` uses: resolved_at <= ts, stored
 * mttr_days sampled directly since it's fixed once resolved).
 *
 * Group value is `keyOf(r)`; blank/missing folds to "(none)" (matching `groupTree`'s
 * normalization). Only values in `groups` keep their own series; everything else folds
 * into `otherLabel` (default "Other") when `includeOther` (default true), else drops —
 * Other's median is over the pooled remainder rows, never a sum. Every name in `groups`
 * (plus `otherLabel` when at least one row folded into it) gets a `byGroup` entry at
 * every point, `null` until it has a resolution — so leading gaps stay explicit.
 *
 * GAS-first (no Python fixture parity — mirrors `openByGroupTrend`): a UI-only
 * aggregation of the same durable rows, kept separate from `trendFromFrames` so its
 * parity-tested shape stays untouched.
 *
 * scans: rows with {ts, shape}; base: ledger+episode rows with {resolved_at, mttr_days,
 * severity} plus whatever column `keyOf` reads. opts.severities (optional) restricts to
 * those + UNKNOWN, as elsewhere. opts.minMttrDays (optional) pools only samples with
 * mttr_days strictly above it — a general-purpose lower cutoff, so auto-patched fast
 * resolutions don't drag a domain's median toward zero.
 */
export function medianMttrByGroupTrend(
  scans: Rec[],
  base: Rec[],
  keyOf: (r: Rec) => string,
  groups: string[],
  opts: {
    severities?: string[] | null;
    includeOther?: boolean;
    otherLabel?: string;
    minMttrDays?: number | null;
  } = {},
): MttrByGroupPoint[] {
  const severities = opts.severities ?? null;
  const includeOther = opts.includeOther ?? true;
  const otherLabel = opts.otherLabel ?? "Other";
  const minMttrDays = opts.minMttrDays ?? null;

  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  if (!scans.length || !rows.length) return [];

  const flatTs = scans
    .filter((s) => s["shape"] === "flat")
    .map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) }))
    .filter((t): t is { iso: string; ms: number } => t.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (!flatTs.length) return [];

  const inGroup = new Set(groups);
  const parsed = rows.map((r) => {
    const raw = keyOf(r);
    const value = raw.trim() === "" ? "(none)" : raw;
    const known = inGroup.has(value);
    return {
      resolvedAt: parseTs(r["resolved_at"]),
      mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"])
        ? (r["mttr_days"] as number)
        : null,
      group: known ? value : otherLabel,
      folded: !known && includeOther,
      kept: known || includeOther,
    };
  });

  // Emit a series for every requested group always, plus Other only when a row folded
  // into it — so a group with no resolution yet reads as an explicit leading `null`.
  const hasOther = parsed.some((r) => r.folded);
  const names = hasOther ? [...groups, otherLabel] : groups;

  return flatTs.map((ts) => {
    const samples: Record<string, number[]> = {};
    for (const r of parsed) {
      if (!r.kept || r.mttr === null) continue;
      if (minMttrDays !== null && r.mttr <= minMttrDays) continue;
      if (r.resolvedAt === null || r.resolvedAt > ts.ms) continue;
      (samples[r.group] ??= []).push(r.mttr);
    }
    const byGroup: Record<string, number | null> = {};
    for (const name of names) {
      const s = samples[name];
      if (s && s.length) {
        const med = median(s)!;
        byGroup[name] = Math.round(med * 1000) / 1000;
      } else {
        byGroup[name] = null;
      }
    }
    return { date: ts.iso, byGroup };
  });
}

/**
 * Kaplan–Meier median time-to-remediation per breakdown group over time — the censoring-aware
 * companion of `medianMttrByGroupTrend`, and the data behind the MTTR page "MTTR by domain"
 * line chart's default (KM) series. For each saved flat-scan timestamp it replays the durable
 * ledger and computes, per group, the KM median over that group's rows: rows resolved as of
 * that instant (resolved_at <= ts) are events at their stored `mttr_days`; rows still open as
 * of ts (first_seen <= ts, not resolved by ts) are right-censored at age (ts − first_seen)/day.
 * The KM median is the smallest event time whose survival has fallen to <= 0.5
 * (kmMedianFromCurve over kmCurve — the same estimator the hero's `kaplanMeier` and the page
 * KM-median trend `withKmMedian` use, shared so the three can't drift), rounded to 3 decimals;
 * null before any event or when survival never reaches 0.5 (too much censoring) — matching the
 * "null until it has a resolution" leading-gap semantics of its naive sibling.
 *
 * Group value is `keyOf(r)`; blank/missing folds to "(none)"; values outside `groups` fold
 * into `otherLabel` (default "Other") when `includeOther` (default true), else drop. Every
 * name in `groups` (plus `otherLabel` when at least one row folded into it) gets a `byGroup`
 * entry at every point. opts.severities restricts to those + UNKNOWN. opts.hideNoFix (default
 * false) drops an open-as-of-ts finding from the censored risk set when it was still awaiting a
 * vendor fix then (awaitingFixAsOf) — the same as-of no-fix rule as `withKmMedian`; resolved
 * rows (events) are always kept.
 *
 * GAS-first (no Python fixture parity — mirrors `medianMttrByGroupTrend` / `withKmMedian`): a
 * UI-only aggregation of the same durable rows, kept separate from `trendFromFrames`.
 *
 * scans: rows with {ts, shape}; base: ledger+episode rows with {first_seen, resolved_at,
 * mttr_days, severity, fix_available_at} plus whatever column `keyOf` reads.
 */
export function kmMedianByGroupTrend(
  scans: Rec[],
  base: Rec[],
  keyOf: (r: Rec) => string,
  groups: string[],
  opts: {
    severities?: string[] | null;
    includeOther?: boolean;
    otherLabel?: string;
    hideNoFix?: boolean;
  } = {},
): MttrByGroupPoint[] {
  const severities = opts.severities ?? null;
  const includeOther = opts.includeOther ?? true;
  const otherLabel = opts.otherLabel ?? "Other";
  const hideNoFix = opts.hideNoFix ?? false;

  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  if (!scans.length || !rows.length) return [];

  const flatTs = scans
    .filter((s) => s["shape"] === "flat")
    .map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) }))
    .filter((t): t is { iso: string; ms: number } => t.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (!flatTs.length) return [];

  const inGroup = new Set(groups);
  const parsed = rows.map((r) => {
    const raw = keyOf(r);
    const value = raw.trim() === "" ? "(none)" : raw;
    const known = inGroup.has(value);
    return {
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"])
        ? (r["mttr_days"] as number)
        : null,
      fixAvail: parseTs(r["fix_available_at"]),
      group: known ? value : otherLabel,
      folded: !known && includeOther,
      kept: known || includeOther,
    };
  });

  // Emit a series for every requested group always, plus Other only when a row folded into it
  // — so a group with no resolution yet reads as an explicit leading `null` (mirrors the naive
  // `medianMttrByGroupTrend`).
  const hasOther = parsed.some((r) => r.folded);
  const names = hasOther ? [...groups, otherLabel] : groups;

  return flatTs.map((ts) => {
    const events: Record<string, number[]> = {}; // per group: resolved-by-ts mttr_days
    const times: Record<string, number[]> = {};  // per group: risk set (events + censored ages)
    for (const r of parsed) {
      if (!r.kept) continue;
      if (r.resolvedAt !== null && r.resolvedAt <= ts.ms) {
        // Resolved by ts: an event at its final mttr_days (a null-mttr resolution drops out).
        if (r.mttr !== null) {
          (events[r.group] ??= []).push(r.mttr);
          (times[r.group] ??= []).push(r.mttr);
        }
      } else if (r.first !== null && r.first <= ts.ms) {
        // Open as of ts: right-censored at its current age — unless hiding no-fix rows and this
        // one was still awaiting a vendor fix as of ts (not yet on the clock).
        if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms)) continue;
        (times[r.group] ??= []).push((ts.ms - r.first) / DAY_MS);
      }
    }
    const byGroup: Record<string, number | null> = {};
    for (const name of names) {
      const med = kmMedianFromCurve(kmCurve(events[name] ?? [], times[name] ?? []));
      byGroup[name] = med !== null ? Math.round(med * 1000) / 1000 : null;
    }
    return { date: ts.iso, byGroup };
  });
}

export type BackfilledTrendPoint = TrendPoint & { reconstructed: boolean };

/**
 * `trendFromFrames` with optional pre-first-scan backfill — the UI trend entry point.
 *
 * The trend otherwise samples only at saved-scan timestamps, so it can't start before the
 * first scan even when findings' `first_seen` dates predate it. With `backfill`, this seeds
 * a daily backbone of synthetic flat-scan timestamps (UTC midnights) from the earliest
 * `first_seen` up to — but excluding — the first real flat scan, so the trend reconstructs
 * the pre-scan history. Each point is tagged `reconstructed`: `true` for the synthetic days,
 * `false` for real saved scans. Reconstructed *open* counts are exact; reconstructed
 * *resolved* / MTTR are lower bounds — a resolution only predates the first scan when the
 * source dated it (disappearance-based resolutions are pinned to the scan that observed
 * them), so the UI marks that region rather than hiding the understatement.
 *
 * GAS-first (no Python fixture parity — mirrors `openBySeverityTrend`): implemented as a
 * thin wrapper that synthesizes extra flat-scan rows and delegates to the parity-tested
 * `trendFromFrames`, which stays byte-for-byte untouched. `backfill: false` is exactly
 * `trendFromFrames` (with every point tagged `reconstructed: false`).
 */
export function trendFromBase(
  scans: Rec[],
  base: Rec[],
  severities: string[] | null = null,
  opts: { backfill?: boolean; hideNoFix?: boolean } = {},
): BackfilledTrendPoint[] {
  const hideNoFix = opts.hideNoFix ?? false;
  const tag = (points: TrendPoint[], synthetic: Set<string>): BackfilledTrendPoint[] =>
    points.map((p) => ({ ...p, reconstructed: synthetic.has(p.date) }));

  if (!opts.backfill) return tag(trendFromFrames(scans, base, severities, { hideNoFix }), new Set());

  // Scope the base the same way `trendFromFrames` will, so the earliest `first_seen` we
  // anchor the backbone to reflects only the rows that will actually be counted.
  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }

  const realFlatMs = scans
    .filter((s) => s["shape"] === "flat")
    .map((s) => parseTs(s["ts"]))
    .filter((t): t is number => t !== null);
  const firstSeenMs = rows
    .map((r) => parseTs(r["first_seen"]))
    .filter((t): t is number => t !== null);

  const synthetic: Rec[] = [];
  const syntheticIso = new Set<string>();
  if (realFlatMs.length && firstSeenMs.length) {
    // Stop at the first scan's UTC *day*, not its instant: that day is already represented by
    // the real scan point, so a synthetic midnight on it would just add an empty leading dot.
    // minNum, not Math.min(...): firstSeenMs holds one entry per finding, so the spread form
    // overflows the stack on large registers (realFlatMs matched for consistency).
    const firstScanDay = Math.floor(minNum(realFlatMs) / DAY_MS) * DAY_MS;
    const startDay = Math.floor(minNum(firstSeenMs) / DAY_MS) * DAY_MS;
    for (let day = startDay; day < firstScanDay; day += DAY_MS) {
      const iso = toIso(day);
      if (iso === null) continue;
      synthetic.push({ ts: iso, shape: "flat" });
      syntheticIso.add(iso);
    }
  }

  // Synthetic days can only be < firstScan, and real flat scans are all >= firstScan, so a
  // point's `date` is in `syntheticIso` iff it's a reconstructed day — unambiguous.
  return tag(trendFromFrames(synthetic.concat(scans), base, severities, { hideNoFix }), syntheticIso);
}

/**
 * Augment already-emitted trend points with `km_median_days` — the Kaplan–Meier median
 * time-to-remediation as of each point's date, the censoring-aware replacement for the old
 * "MTTR excl. fast lane" series. For each point date d it replays the durable base as of d:
 * rows resolved by d (resolved_at <= d) are events at their stored `mttr_days` (fixed once
 * resolved); rows still open as of d (first_seen <= d and not resolved by d) are right-
 * censored at age `(d − first_seen)/day`. The KM median is the smallest event time whose
 * survival has fallen to <= 0.5 (remediation.kmMedianFromCurve over remediation.kmCurve —
 * the same estimator the hero's kaplanMeier uses, shared so the two can't drift), rounded to
 * 3 decimals like `trendFromFrames`; null before any event or when survival never reaches 0.5
 * (too much censoring). Severity scoping matches every sibling here.
 *
 * GAS-first (no Python fixture parity — mirrors `withOpenPastSla`): a UI-only augmentation
 * of the same durable rows, kept out of the parity-tested `trendFromFrames`.
 */
export function withKmMedian<T extends { date: string }>(
  points: T[],
  base: Rec[],
  severities: string[] | null = null,
  // opts.hideNoFix (default false) drops an open-as-of-d finding from the censored risk set
  // when no vendor fix was available by d (awaitingFixAsOf) — such a row isn't yet on the
  // from-detection remediation clock, so it shouldn't inflate the censoring. Resolved rows
  // (events) are always kept, per the shared no-fix rule. Absent/false is unchanged.
  opts: { hideNoFix?: boolean } = {},
): (T & { km_median_days: number | null })[] {
  const hideNoFix = opts.hideNoFix ?? false;
  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  const parsed = rows.map((r) => ({
    first: parseTs(r["first_seen"]),
    resolvedAt: parseTs(r["resolved_at"]),
    mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"])
      ? (r["mttr_days"] as number)
      : null,
    fixAvail: parseTs(r["fix_available_at"]),
  }));

  return points.map((p) => {
    const d = parseTs(p.date);
    let med: number | null = null;
    if (d !== null) {
      const events: number[] = []; // resolved by d, at their stored mttr_days
      const times: number[] = []; // the risk set: events + open-as-of-d censored ages
      for (const r of parsed) {
        if (r.resolvedAt !== null && r.resolvedAt <= d) {
          // Resolved by d: an event at its final mttr_days (a null-mttr resolution drops out).
          if (r.mttr !== null) {
            events.push(r.mttr);
            times.push(r.mttr);
          }
        } else if (r.first !== null && r.first <= d) {
          // Open as of d: right-censored at its current age — unless hiding no-fix rows and
          // this one was still awaiting a vendor fix as of d (not yet on the clock).
          if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, d)) continue;
          times.push((d - r.first) / DAY_MS);
        }
      }
      med = kmMedianFromCurve(kmCurve(events, times));
    }
    return { ...p, km_median_days: med !== null ? Math.round(med * 1000) / 1000 : null };
  });
}

/**
 * Augment already-emitted trend points with an `open_past_sla` count — open findings
 * whose age at the point's date already exceeds their severity's SLA target (the tail
 * the resolved-only In-SLA % never scores). Replays the durable base at each point's
 * `date` with the same as-of predicate `trendFromFrames` uses (open iff first_seen <= d
 * and not resolved by d; breached iff `(d − first_seen)/day > SLA_TARGETS[sev]`), so real
 * saved scans and synthetic backfill days are counted identically. The generic passthrough
 * preserves every existing point field — points already carry `open`, so only the new
 * `open_past_sla` is added, never clobbering it.
 *
 * GAS-first (no Python fixture parity — mirrors `openBySeverityTrend`): a UI-only
 * augmentation of the same durable rows, kept out of the parity-tested `trendFromFrames`.
 *
 * points: trend points with a `date` (ISO); base: ledger+episode rows with {severity,
 * first_seen, resolved_at}. severities (optional) restricts to those + UNKNOWN, as elsewhere.
 */
export function withOpenPastSla<T extends { date: string }>(
  points: T[],
  base: Rec[],
  severities: string[] | null = null,
  // Which column is the age/breach origin. "first_seen" (default) is the from-detection
  // clock and preserves this function's original behaviour byte-for-byte. "actionable_from"
  // switches to the vendor-fix-availability clock: rows with a null value for the chosen
  // field are skipped, which is exactly what drops awaiting-vendor-fix rows in that mode.
  fromField: "first_seen" | "actionable_from" = "first_seen",
): (T & { open_past_sla: number })[] {
  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  const parsed = rows.map((r) => ({
    origin: parseTs(r[fromField]),
    resolvedAt: parseTs(r["resolved_at"]),
    sev: normalizeSeverity(r["severity"]),
  }));

  return points.map((p) => {
    const d = parseTs(p.date);
    let breached = 0;
    if (d !== null) {
      for (const r of parsed) {
        const open =
          r.origin !== null && r.origin <= d && (r.resolvedAt === null || r.resolvedAt > d);
        if (!open) continue;
        const target = SLA_TARGETS[r.sev];
        if (target !== undefined && (d - r.origin!) / DAY_MS > target) breached += 1;
      }
    }
    return { ...p, open_past_sla: breached };
  });
}

// A row's SLA deadline (actionable_from + its severity target, in ms) paired with its
// resolution time — the shared derivation behind withSlaBurn and cohortSlaAttainment. Rows
// with a null actionable_from (awaiting a vendor fix) or a severity with no SLA target are
// dropped, so neither the burn flow nor the attainment cohort ever counts them.
function slaDeadlineRows(
  base: Rec[],
  severities: string[] | null,
): { deadline: number; resolvedAt: number | null }[] {
  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  const out: { deadline: number; resolvedAt: number | null }[] = [];
  for (const r of rows) {
    const actionable = parseTs(r["actionable_from"]);
    const target = SLA_TARGETS[normalizeSeverity(r["severity"])];
    if (actionable === null || target === undefined) continue;
    out.push({ deadline: actionable + target * DAY_MS, resolvedAt: parseTs(r["resolved_at"]) });
  }
  return out;
}

/**
 * Augment trend points with the SLA-burn net flow — the backlog-of-breach's rate of
 * change per scan window, so a falling MTTR beside a growing past-SLA backlog reads as one
 * story. For each point date d with previous point p (exclusive-left window `(p, d]`):
 *   - `sla_entered`: findings whose SLA deadline (actionable_from + target) falls in `(p, d]`
 *     AND that were still unresolved by that deadline — i.e. crossed into breach this window.
 *   - `sla_cleared`: breached findings (resolved AFTER their deadline) whose resolution falls
 *     in `(p, d]` — i.e. left the past-SLA backlog this window.
 *   - `sla_net`: entered − cleared. Above zero means the past-SLA backlog grew.
 * The first point has no predecessor window, so all three are null. Awaiting-vendor-fix rows
 * (null actionable_from) and no-target severities never contribute (see slaDeadlineRows).
 * Severity scoping matches every sibling here.
 *
 * GAS-first (no Python fixture parity — mirrors withOpenPastSla): a UI-only augmentation of
 * the same durable rows, kept out of the parity-tested trendFromFrames.
 */
export function withSlaBurn<T extends { date: string }>(
  points: T[],
  base: Rec[],
  severities: string[] | null = null,
): (T & { sla_entered: number | null; sla_cleared: number | null; sla_net: number | null })[] {
  const parsed = slaDeadlineRows(base, severities);

  let prevMs: number | null = null;
  return points.map((p, i) => {
    const d = parseTs(p.date);
    let entered: number | null = null;
    let cleared: number | null = null;
    if (i > 0 && prevMs !== null && d !== null) {
      entered = 0;
      cleared = 0;
      for (const r of parsed) {
        // Crossed into breach this window: deadline in (prev, d] and not yet resolved by it.
        if (
          r.deadline > prevMs && r.deadline <= d &&
          (r.resolvedAt === null || r.resolvedAt > r.deadline)
        ) {
          entered += 1;
        }
        // Left the past-SLA backlog this window: a breached row (resolved after its deadline)
        // whose resolution landed in (prev, d].
        if (
          r.resolvedAt !== null && r.resolvedAt > prevMs && r.resolvedAt <= d &&
          r.resolvedAt > r.deadline
        ) {
          cleared += 1;
        }
      }
    }
    prevMs = d;
    return {
      ...p,
      sla_entered: entered,
      sla_cleared: cleared,
      sla_net: entered !== null && cleared !== null ? entered - cleared : null,
    };
  });
}

/**
 * Augment trend points with cohort SLA attainment — the unbiased dual of the resolved-only
 * "In SLA %". For each point date d, over the cohort of findings whose SLA deadline has
 * already passed as of d (deadline <= d, so the verdict is knowable), the share that was
 * actually resolved on time (resolved_at != null AND resolved_at <= deadline), as a
 * 1-decimal-rounded percentage. An open-past-deadline finding counts against attainment
 * (unlike In-SLA %, which never scores it); null when the cohort is empty. Awaiting-vendor-
 * fix rows and no-target severities are excluded from the cohort (see slaDeadlineRows).
 * Severity scoping matches every sibling here.
 *
 * GAS-first (no Python fixture parity — mirrors withOpenPastSla): a UI-only augmentation of
 * the same durable rows, kept out of the parity-tested trendFromFrames.
 */
export function cohortSlaAttainment<T extends { date: string }>(
  points: T[],
  base: Rec[],
  severities: string[] | null = null,
): (T & { sla_attainment_pct: number | null })[] {
  const parsed = slaDeadlineRows(base, severities);

  return points.map((p) => {
    const d = parseTs(p.date);
    let cohort = 0;
    let met = 0;
    if (d !== null) {
      for (const r of parsed) {
        if (r.deadline > d) continue; // verdict not yet knowable
        cohort += 1;
        if (r.resolvedAt !== null && r.resolvedAt <= r.deadline) met += 1;
      }
    }
    const pct = cohort ? Math.round((met / cohort) * 100 * 10) / 10 : null;
    return { ...p, sla_attainment_pct: pct };
  });
}
