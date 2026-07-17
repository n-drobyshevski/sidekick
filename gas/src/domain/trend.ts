// Cumulative open/resolved/MTTR/SLA trend — the port of ledger._trend_from_frames.
//
// For each saved flat scan timestamp: vulns open vs resolved as of that instant, the
// median MTTR of everything resolved by then, the In-SLA share, and the oldest-open
// age (max over severities of the p90 open age) — matching the headline KPIs.

import { SEVERITY_ORDER, SLA_TARGETS } from "./config";
import { normalizeSeverity } from "./severity";
import { median, parseTs, quantile, toIso, type Rec } from "./util";

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
 * scans: rows with {ts, shape}; base: ledger+episode rows with {severity, first_seen,
 * resolved_at, mttr_days}. severities (optional) restricts to those + UNKNOWN.
 */
export function trendFromFrames(
  scans: Rec[],
  base: Rec[],
  severities: string[] | null = null,
): TrendPoint[] {
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
  }));

  const out: TrendPoint[] = [];
  for (const ts of flatTs) {
    const resolvedMask = parsed.map((r) => r.resolvedAt !== null && r.resolvedAt <= ts.ms);
    const openMask = parsed.map(
      (r) =>
        r.first !== null &&
        r.first <= ts.ms &&
        (r.resolvedAt === null || r.resolvedAt > ts.ms),
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
    const oldest = p90s.length ? Math.max(...p90s) : null;

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
 */
export function openBySeverityTrend(
  scans: Rec[],
  base: Rec[],
  severities: string[] | null = null,
): OpenBySevPoint[] {
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
  }));

  return flatTs.map((ts) => {
    const bySev: Record<string, number> = {};
    for (const r of parsed) {
      const isOpen =
        r.first !== null &&
        r.first <= ts.ms &&
        (r.resolvedAt === null || r.resolvedAt > ts.ms);
      if (isOpen) bySev[r.sev] = (bySev[r.sev] ?? 0) + 1;
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
 * those + UNKNOWN, as elsewhere.
 */
export function openByGroupTrend(
  scans: Rec[],
  base: Rec[],
  keyOf: (r: Rec) => string,
  groups: string[],
  opts: { severities?: string[] | null; includeOther?: boolean; otherLabel?: string } = {},
): OpenByGroupPoint[] {
  const severities = opts.severities ?? null;
  const includeOther = opts.includeOther ?? true;
  const otherLabel = opts.otherLabel ?? "Other";

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
      if (isOpen) byGroup[r.group] = (byGroup[r.group] ?? 0) + 1;
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
 * those + UNKNOWN, as elsewhere.
 */
export function medianMttrByGroupTrend(
  scans: Rec[],
  base: Rec[],
  keyOf: (r: Rec) => string,
  groups: string[],
  opts: { severities?: string[] | null; includeOther?: boolean; otherLabel?: string } = {},
): MttrByGroupPoint[] {
  const severities = opts.severities ?? null;
  const includeOther = opts.includeOther ?? true;
  const otherLabel = opts.otherLabel ?? "Other";

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
  opts: { backfill?: boolean } = {},
): BackfilledTrendPoint[] {
  const tag = (points: TrendPoint[], synthetic: Set<string>): BackfilledTrendPoint[] =>
    points.map((p) => ({ ...p, reconstructed: synthetic.has(p.date) }));

  if (!opts.backfill) return tag(trendFromFrames(scans, base, severities), new Set());

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
    const firstScanDay = Math.floor(Math.min(...realFlatMs) / DAY_MS) * DAY_MS;
    const startDay = Math.floor(Math.min(...firstSeenMs) / DAY_MS) * DAY_MS;
    for (let day = startDay; day < firstScanDay; day += DAY_MS) {
      const iso = toIso(day);
      if (iso === null) continue;
      synthetic.push({ ts: iso, shape: "flat" });
      syntheticIso.add(iso);
    }
  }

  // Synthetic days can only be < firstScan, and real flat scans are all >= firstScan, so a
  // point's `date` is in `syntheticIso` iff it's a reconstructed day — unambiguous.
  return tag(trendFromFrames(synthetic.concat(scans), base, severities), syntheticIso);
}

/**
 * Augment already-emitted trend points with `tail_median_days` — the as-of-date median
 * MTTR over resolutions SLOWER than the fast-lane window, i.e. the "MTTR excl. fast
 * lane" series. For each point date d it pools `mttr_days` of rows resolved by d with
 * `mttr_days > thresholdDays` (the strict dual of the fast lane's `<=`), and takes the
 * same linear-interpolation median / 3-decimal rounding `trendFromFrames` uses; null
 * when nothing tail-resolved yet. Severity scoping matches every sibling here.
 *
 * GAS-first (no Python fixture parity — mirrors `withOpenPastSla`): a UI-only
 * augmentation of the same durable rows, kept out of the parity-tested `trendFromFrames`.
 */
export function withTailMedian<T extends { date: string }>(
  points: T[],
  base: Rec[],
  thresholdDays: number,
  severities: string[] | null = null,
): (T & { tail_median_days: number | null })[] {
  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  const parsed = rows
    .map((r) => ({
      resolvedAt: parseTs(r["resolved_at"]),
      mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"])
        ? (r["mttr_days"] as number)
        : null,
    }))
    .filter((r) => r.resolvedAt !== null && r.mttr !== null && r.mttr! > thresholdDays);

  return points.map((p) => {
    const d = parseTs(p.date);
    const tail = d === null
      ? []
      : parsed.filter((r) => r.resolvedAt! <= d).map((r) => r.mttr!);
    const med = median(tail);
    return { ...p, tail_median_days: med !== null ? Math.round(med * 1000) / 1000 : null };
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
): (T & { open_past_sla: number })[] {
  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  const parsed = rows.map((r) => ({
    first: parseTs(r["first_seen"]),
    resolvedAt: parseTs(r["resolved_at"]),
    sev: normalizeSeverity(r["severity"]),
  }));

  return points.map((p) => {
    const d = parseTs(p.date);
    let breached = 0;
    if (d !== null) {
      for (const r of parsed) {
        const open =
          r.first !== null && r.first <= d && (r.resolvedAt === null || r.resolvedAt > d);
        if (!open) continue;
        const target = SLA_TARGETS[r.sev];
        if (target !== undefined && (d - r.first!) / DAY_MS > target) breached += 1;
      }
    }
    return { ...p, open_past_sla: breached };
  });
}
