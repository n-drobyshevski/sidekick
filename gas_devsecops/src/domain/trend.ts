// Cumulative open/resolved/MTTR/SLA trend for the code register — the port of
// gas/src/domain/trend.ts (itself the port of the Python ledger._trend_from_frames).
//
// For each saved scan timestamp: findings open vs resolved as of that instant, the median
// MTTR of everything resolved by then, the In-SLA share, and the oldest-open age (max over
// severities of the p90 open age) — matching the headline KPIs. Around that core sit the
// UI-only augmentations gas/ grew: the backfilled backbone, the Kaplan–Meier median series,
// the past-SLA tail, the SLA burn flow, cohort attainment, coverage/efficiency, and the
// per-group (`*ByGroupTrend`) family.
//
// Pure: no clock (every function takes its instants from its arguments), no I/O.
//
// ---------------------------------------------------------------------------------------
// WHAT CHANGED FROM gas/, AND WHY
//
//   DIVERGENCE: the `shape === "flat"` scan filter is GONE (see `pointTimes`).
//   DIVERGENCE: `withOpenPastSla` / `withSlaBurn` / `cohortSlaAttainment` / `withCoverage-
//               Efficiency` gained a trailing `opts` bag purely to carry `scope`.
//   DIVERGENCE: `withCoverageEfficiency` excludes `secrets` rows and COUNTS them, because
//               program.classifyRisk refuses that scope outright (it throws).
//   DIVERGENCE: `kmSkipMask` drops a provable no-op loop gas/ carries.
//
// `published_date` / `REMEDIATION_ROLLOUT_ISO`: nothing to drop. gas/'s trend.ts never reads
// either — the rollout boundary lives in its remediation.ts, which this register's D4 package
// deliberately did not port. Named here only so the absence is a recorded answer, not a gap.
//
// COLUMN RENAMES (ledgerTypes.ts's header): trend.ts reads `severity`, `first_seen`,
// `resolved_at`, `mttr_days`, `fix_available_at` and `actionable_from` — NOT ONE of which is
// renamed in this register. The renames (vuln_key -> finding_key, cve -> identifier,
// asset_* -> repo_*, cloud -> platform) land on columns this module never touches. The only
// place a rename surfaces is the GROUP dimensions, which come from `insights.GROUP_COLUMNS`.
//
// SCOPE FILTER (rule 2 of the D8 brief): every function here takes an optional `scope`. When
// given, BOTH the rows AND the scan log are filtered to it before anything is computed —
// this ledger holds sca/sast/secrets in one table and `scope` is part of every row's
// identity (config.ts), so a per-register series has to be able to ask for just its rows.
// The `with*` decorators take `points` rather than `scans`, so there the filter reaches the
// rows only; the caller owns the point dates. `perScopeSeries` builds all three series from
// ONE partitioning pass, which is what the executive stack wants.
//
// A NOTE ON `hideNoFix` IN THIS REGISTER: `fix_available_at` is an SCA-only column. For sast
// and secrets there is no vendor to wait on, so a later package sets it to `first_seen` and
// `awaitingFixAsOf` is then false for every such row — the toggle is a no-op off sca by
// construction, not by a special case here.
// ---------------------------------------------------------------------------------------

import { SCOPES, SEVERITY_ORDER, SLA_TARGETS, type Scope } from "./config";
import { GROUP_COLUMNS } from "./insights";
import {
  RISK_TIER_ORDER,
  classifyRisk,
  riskTier,
  type AnyRiskRule,
  type RiskClass,
  type RiskRow,
} from "./program";
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

const round1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
const round3 = (v: number | null): number | null =>
  v === null ? null : Math.round(v * 1000) / 1000;

// --------------------------------------------------------------------------- scoping

/**
 * Drop rows whose `scope` column does not match, when a scope filter was requested. No-op
 * otherwise, so every function below is byte-identical to gas/ with the argument omitted.
 * Applied to the scan log and to the base rows alike — see the header.
 */
function byScope(rows: Rec[], scope?: Scope): Rec[] {
  return scope ? rows.filter((r) => r["scope"] === scope) : rows;
}

/** Restrict to the requested severities + UNKNOWN. `null` keeps everything, as in gas/. */
function bySeverity(rows: Rec[], severities: string[] | null): Rec[] {
  if (severities === null || !rows.length) return rows;
  const keep = new Set([...severities, "UNKNOWN"]);
  return rows.filter((r) => keep.has(normalizeSeverity(r["severity"])));
}

/** Both scopings, in the order every function here applies them. */
function scopeRows(base: Rec[], severities: string[] | null, scope?: Scope): Rec[] {
  return bySeverity(byScope(base, scope), severities);
}

/**
 * The instants a trend samples at: every scan in the (optionally scope-filtered) log whose
 * `ts` parses, ascending.
 *
 * DIVERGENCE from gas/: gas/ filters `s["shape"] === "flat"` here — five times over, once per
 * trend function. This register's scans tab HAS NO `shape` COLUMN (ledgerTypes.ScanRow states
 * it): gas/'s flat-vs-grouped distinction is about a fetch that aggregates findings per asset,
 * and every scope's fetch here is a flat per-finding scan. Keeping the branch would have made
 * every trend read empty the moment the column stayed unwritten — a register that looks
 * genuinely empty, which is the failure class CLAUDE.md's "a zero has to prove it looked" is
 * about. So the branch is dropped rather than defaulted, and `test/trend.test.ts` pins that a
 * scan carrying a stray `shape` value is still counted.
 */
function pointTimes(scans: Rec[], scope?: Scope): { iso: string; ms: number }[] {
  return byScope(scans, scope)
    .map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) }))
    .filter((t): t is { iso: string; ms: number } => t.ms !== null)
    .sort((a, b) => a.ms - b.ms);
}

/** The `mttr_days` sample, or null when the column holds anything but a real number. */
function mttrOf(r: Rec): number | null {
  const m = r["mttr_days"];
  return typeof m === "number" && !Number.isNaN(m) ? m : null;
}

// --------------------------------------------------------------------------- as-of predicates

/**
 * Whether a finding was open AND still awaiting a vendor fix as of instant `d` — the
 * as-of-date companion of the ledger's `awaiting_vendor_fix` (which is only ever "now").
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

// --------------------------------------------------------------------------- the core series

/**
 * scans: rows with {ts} (+ `scope` when filtering); base: ledger+episode rows with {severity,
 * first_seen, resolved_at, mttr_days}. `severities` (optional) restricts to those + UNKNOWN.
 *
 * opts.hideNoFix (default false) excludes, as of each point's date, findings still awaiting
 * a vendor fix then (awaitingFixAsOf over the row's `fix_available_at`) from the OPEN count
 * only — the resolved / median / SLA series read the untouched resolvedMask, so they stay
 * byte-identical. opts.scope (default: all scopes) filters the scan log AND the rows.
 */
export function trendFromFrames(
  scans: Rec[],
  base: Rec[],
  severities: string[] | null = null,
  opts: { hideNoFix?: boolean; scope?: Scope } = {},
): TrendPoint[] {
  const hideNoFix = opts.hideNoFix ?? false;
  const rows = scopeRows(base, severities, opts.scope);
  if (!scans.length || !rows.length) return [];

  const times = pointTimes(scans, opts.scope);
  if (!times.length) return [];

  const parsed = rows.map((r) => ({
    first: parseTs(r["first_seen"]),
    resolvedAt: parseTs(r["resolved_at"]),
    mttr: mttrOf(r),
    sev: normalizeSeverity(r["severity"]),
    fixAvail: parseTs(r["fix_available_at"]),
  }));

  const out: TrendPoint[] = [];
  for (const ts of times) {
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
      median_days: round3(med),
      sla_pct: round1(slaPct),
      oldest_open_days: round3(oldest),
    });
  }
  return out;
}

export interface OpenBySevPoint {
  date: string; // the scan ts (ISO)
  bySev: Record<string, number>; // open count per normalized severity as of `date`
}

/**
 * Open findings per severity over time — the data behind the Overview "Severity breakdown"
 * line chart. For each saved scan timestamp it replays the durable ledger and counts, per
 * normalized severity, the findings open as of that instant (the same open predicate
 * `trendFromFrames` uses: first_seen <= ts and not resolved by ts).
 *
 * GAS-first (no Python fixture parity): a UI-only aggregation of the same durable rows, kept
 * separate from `trendFromFrames` so its parity-tested shape stays untouched.
 */
export function openBySeverityTrend(
  scans: Rec[],
  base: Rec[],
  severities: string[] | null = null,
  opts: { hideNoFix?: boolean; scope?: Scope } = {},
): OpenBySevPoint[] {
  const hideNoFix = opts.hideNoFix ?? false;
  const rows = scopeRows(base, severities, opts.scope);
  if (!scans.length || !rows.length) return [];

  const times = pointTimes(scans, opts.scope);
  if (!times.length) return [];

  const parsed = rows.map((r) => ({
    first: parseTs(r["first_seen"]),
    resolvedAt: parseTs(r["resolved_at"]),
    sev: normalizeSeverity(r["severity"]),
    fixAvail: parseTs(r["fix_available_at"]),
  }));

  return times.map((ts) => {
    const bySev: Record<string, number> = {};
    for (const r of parsed) {
      const isOpen =
        r.first !== null && r.first <= ts.ms && (r.resolvedAt === null || r.resolvedAt > ts.ms);
      if (!isOpen) continue;
      if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms)) continue;
      bySev[r.sev] = (bySev[r.sev] ?? 0) + 1;
    }
    return { date: ts.iso, bySev };
  });
}

// --------------------------------------------------------------------------- the group family

/**
 * The breakdown dimensions this register's group trends accept — `insights.GROUP_COLUMNS`,
 * imported rather than restated so the trend and the breakdown tree can never name a
 * different set. Exactly {repo, language, owner_project, secret_kind, cwe}; see insights.ts's
 * header for the host dimensions gas/ had and why none of them survive on a repository.
 */
export { GROUP_COLUMNS };

/**
 * `keyOf` for a named dimension — `groupKeyOf("repo")` reads `repo_name`, and so on. Throws
 * on an unknown dimension rather than silently grouping everything into "(none)", which is
 * what reading a column that does not exist would otherwise look like.
 */
export function groupKeyOf(dim: string): (r: Rec) => string {
  const col = GROUP_COLUMNS[dim];
  if (col === undefined) {
    throw new Error(
      `unknown group dimension "${dim}": GROUP_COLUMNS holds ` +
        `${Object.keys(GROUP_COLUMNS).join(", ")}`,
    );
  }
  return (r: Rec) => String(r[col] ?? "");
}

export interface OpenByGroupPoint {
  date: string; // the scan ts (ISO)
  byGroup: Record<string, number>; // open count per group value as of `date`
}

/** Shared group-folding decision: "(none)" for blank, `otherLabel` for anything off-list. */
function foldGroup(
  raw: string,
  inGroup: Set<string>,
  otherLabel: string,
  includeOther: boolean,
): { group: string; folded: boolean; kept: boolean } {
  const value = raw.trim() === "" ? "(none)" : raw;
  const known = inGroup.has(value);
  return {
    group: known ? value : otherLabel,
    folded: !known && includeOther,
    kept: known || includeOther,
  };
}

/**
 * Open findings per breakdown group over time — the data behind the Overview "Breakdown"
 * group-evolution line chart. Generalizes `openBySeverityTrend` from the fixed severity key
 * to an arbitrary `keyOf` group value (use `groupKeyOf(dim)` for a named dimension).
 *
 * Group value is `keyOf(r)`; blank/missing folds to "(none)" (matching `groupTree`'s
 * normalization). Only values in `groups` keep their own series; everything else folds into
 * `otherLabel` (default "Other") when `includeOther` (default true), else drops.
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
    scope?: Scope;
  } = {},
): OpenByGroupPoint[] {
  const includeOther = opts.includeOther ?? true;
  const otherLabel = opts.otherLabel ?? "Other";
  const hideNoFix = opts.hideNoFix ?? false;

  const rows = scopeRows(base, opts.severities ?? null, opts.scope);
  if (!scans.length || !rows.length) return [];

  const times = pointTimes(scans, opts.scope);
  if (!times.length) return [];

  const inGroup = new Set(groups);
  const parsed = rows.map((r) => ({
    first: parseTs(r["first_seen"]),
    resolvedAt: parseTs(r["resolved_at"]),
    fixAvail: parseTs(r["fix_available_at"]),
    ...foldGroup(keyOf(r), inGroup, otherLabel, includeOther),
  }));

  return times.map((ts) => {
    const byGroup: Record<string, number> = {};
    for (const r of parsed) {
      if (!r.kept) continue;
      const isOpen =
        r.first !== null && r.first <= ts.ms && (r.resolvedAt === null || r.resolvedAt > ts.ms);
      if (!isOpen) continue;
      if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms)) continue;
      byGroup[r.group] = (byGroup[r.group] ?? 0) + 1;
    }
    return { date: ts.iso, byGroup };
  });
}

/**
 * Open findings per RISK TIER over time — `openByGroupTrend` keyed on `program.riskTier`,
 * with `RISK_TIER_ORDER` as the (complete, partitioning) group list so no row can fold into
 * "Other". ADDITION over gas/, which has no risk-tier series at all.
 *
 * **`secrets` rows are excluded, and that is program.ts's refusal, not a shortcut here.**
 * `classifyRisk` throws on that scope (there is no exploit intelligence for a hardcoded
 * string, and severity there grades a DETECTION), so a tier series over it would be a
 * partition with no meaning. They are dropped before classification; `openByRiskTierTrend`
 * returns the count alongside the series rather than hiding it — see `withCoverageEfficiency`
 * for the same treatment on the P2P rates.
 */
export function openByRiskTierTrend(
  scans: Rec[],
  base: Rec[],
  rule?: AnyRiskRule,
  opts: { severities?: string[] | null; hideNoFix?: boolean; scope?: Scope } = {},
): { points: OpenByGroupPoint[]; secrets_excluded: number } {
  const scoped = byScope(base, opts.scope);
  const classifiable = scoped.filter((r) => r["scope"] !== "secrets");
  return {
    points: openByGroupTrend(
      scans,
      classifiable,
      (r) => riskTier(r as unknown as RiskRow, rule),
      [...RISK_TIER_ORDER],
      { ...opts, includeOther: false },
    ),
    secrets_excluded: scoped.length - classifiable.length,
  };
}

export interface MttrByGroupPoint {
  date: string; // the scan ts (ISO)
  byGroup: Record<string, number | null>; // median mttr_days as of `date`; null = none resolved yet
}

/**
 * Median MTTR (days) per breakdown group over time — the data behind the MTTR page "MTTR by
 * domain" line chart. The remediation sibling of `openByGroupTrend`: for each saved scan
 * timestamp it computes, per group, the median `mttr_days` over that group's rows resolved as
 * of that instant (resolved_at <= ts; the stored `mttr_days` is sampled directly since it is
 * fixed once resolved).
 *
 * Other's median is over the pooled remainder rows, never a sum. Every name in `groups` (plus
 * `otherLabel` when at least one row folded into it) gets a `byGroup` entry at every point,
 * `null` until it has a resolution — so leading gaps stay explicit.
 *
 * opts.minMttrDays (optional) pools only samples with mttr_days strictly above it — a
 * general-purpose lower cutoff, so auto-patched fast resolutions don't drag a group's median
 * toward zero.
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
    scope?: Scope;
  } = {},
): MttrByGroupPoint[] {
  const includeOther = opts.includeOther ?? true;
  const otherLabel = opts.otherLabel ?? "Other";
  const minMttrDays = opts.minMttrDays ?? null;

  const rows = scopeRows(base, opts.severities ?? null, opts.scope);
  if (!scans.length || !rows.length) return [];

  const times = pointTimes(scans, opts.scope);
  if (!times.length) return [];

  const inGroup = new Set(groups);
  const parsed = rows.map((r) => ({
    resolvedAt: parseTs(r["resolved_at"]),
    mttr: mttrOf(r),
    ...foldGroup(keyOf(r), inGroup, otherLabel, includeOther),
  }));

  // Emit a series for every requested group always, plus Other only when a row folded
  // into it — so a group with no resolution yet reads as an explicit leading `null`.
  const hasOther = parsed.some((r) => r.folded);
  const names = hasOther ? [...groups, otherLabel] : groups;

  return times.map((ts) => {
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
      byGroup[name] = s && s.length ? round3(median(s)!) : null;
    }
    return { date: ts.iso, byGroup };
  });
}

/**
 * Kaplan–Meier median time-to-remediation per breakdown group over time — the censoring-aware
 * companion of `medianMttrByGroupTrend`, and the MTTR page's default series. For each saved
 * scan timestamp it computes, per group, the KM median over that group's rows: rows resolved
 * as of that instant (resolved_at <= ts) are events at their stored `mttr_days`; rows still
 * open as of ts (first_seen <= ts, not resolved by ts) are right-censored at age
 * (ts − first_seen)/day. The KM median is the smallest event time whose survival has fallen
 * to <= 0.5 (`kmMedianFromCurve` over `kmCurve` — the same estimator `remediation.kaplanMeier`
 * and `withKmMedian` use, shared so the three can't drift), rounded to 3 decimals; null before
 * any event or when survival never reaches 0.5 (too much censoring) — where the curve never
 * reaches half, the register publishes the lower bound elsewhere rather than a number here.
 *
 * opts.hideNoFix drops an open-as-of-ts finding from the CENSORED risk set when it was still
 * awaiting a vendor fix then; resolved rows (events) are always kept.
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
    scope?: Scope;
  } = {},
): MttrByGroupPoint[] {
  const includeOther = opts.includeOther ?? true;
  const otherLabel = opts.otherLabel ?? "Other";
  const hideNoFix = opts.hideNoFix ?? false;

  const rows = scopeRows(base, opts.severities ?? null, opts.scope);
  if (!scans.length || !rows.length) return [];

  const times = pointTimes(scans, opts.scope);
  if (!times.length) return [];

  const inGroup = new Set(groups);
  const parsed = rows.map((r) => ({
    first: parseTs(r["first_seen"]),
    resolvedAt: parseTs(r["resolved_at"]),
    mttr: mttrOf(r),
    fixAvail: parseTs(r["fix_available_at"]),
    ...foldGroup(keyOf(r), inGroup, otherLabel, includeOther),
  }));

  const hasOther = parsed.some((r) => r.folded);
  const names = hasOther ? [...groups, otherLabel] : groups;

  return times.map((ts) => {
    const events: Record<string, number[]> = {}; // per group: resolved-by-ts mttr_days
    const risk: Record<string, number[]> = {}; // per group: risk set (events + censored ages)
    for (const r of parsed) {
      if (!r.kept) continue;
      if (r.resolvedAt !== null && r.resolvedAt <= ts.ms) {
        // Resolved by ts: an event at its final mttr_days (a null-mttr resolution drops out).
        if (r.mttr !== null) {
          (events[r.group] ??= []).push(r.mttr);
          (risk[r.group] ??= []).push(r.mttr);
        }
      } else if (r.first !== null && r.first <= ts.ms) {
        // Open as of ts: right-censored at its current age — unless hiding no-fix rows and
        // this one was still awaiting a vendor fix as of ts (not yet on the clock).
        if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, ts.ms)) continue;
        (risk[r.group] ??= []).push((ts.ms - r.first) / DAY_MS);
      }
    }
    const byGroup: Record<string, number | null> = {};
    for (const name of names) {
      byGroup[name] = round3(kmMedianFromCurve(kmCurve(events[name] ?? [], risk[name] ?? [])));
    }
    return { date: ts.iso, byGroup };
  });
}

// --------------------------------------------------------------------------- backfill

export type BackfilledTrendPoint = TrendPoint & { reconstructed: boolean };

/**
 * `trendFromFrames` with optional pre-first-scan backfill — the UI trend entry point.
 *
 * The trend otherwise samples only at saved-scan timestamps, so it can't start before the
 * first scan even when findings' `first_seen` dates predate it. With `backfill`, this seeds a
 * daily backbone of synthetic scan timestamps (UTC midnights) from the earliest `first_seen`
 * up to — but excluding — the first real scan, so the trend reconstructs the pre-scan
 * history. Each point is tagged `reconstructed`: `true` for the synthetic days, `false` for
 * real saved scans. Reconstructed *open* counts are exact; reconstructed *resolved* / MTTR are
 * lower bounds — a resolution only predates the first scan when the source dated it
 * (disappearance-based resolutions are pinned to the scan that observed them), so the UI marks
 * that region rather than hiding the understatement. That is the clock saying where it started.
 *
 * `backfill: false` is exactly `trendFromFrames` (with every point tagged
 * `reconstructed: false`).
 */
export function trendFromBase(
  scans: Rec[],
  base: Rec[],
  severities: string[] | null = null,
  opts: { backfill?: boolean; hideNoFix?: boolean; scope?: Scope } = {},
): BackfilledTrendPoint[] {
  const hideNoFix = opts.hideNoFix ?? false;
  const scope = opts.scope;
  const tag = (points: TrendPoint[], synthetic: Set<string>): BackfilledTrendPoint[] =>
    points.map((p) => ({ ...p, reconstructed: synthetic.has(p.date) }));

  if (!opts.backfill) {
    return tag(trendFromFrames(scans, base, severities, { hideNoFix, scope }), new Set());
  }

  // Scope the base the same way `trendFromFrames` will, so the earliest `first_seen` we
  // anchor the backbone to reflects only the rows that will actually be counted.
  const rows = scopeRows(base, severities, scope);

  const realMs = pointTimes(scans, scope).map((t) => t.ms);
  const firstSeenMs = rows
    .map((r) => parseTs(r["first_seen"]))
    .filter((t): t is number => t !== null);

  const synthetic: Rec[] = [];
  const syntheticIso = new Set<string>();
  if (realMs.length && firstSeenMs.length) {
    // Stop at the first scan's UTC *day*, not its instant: that day is already represented by
    // the real scan point, so a synthetic midnight on it would just add an empty leading dot.
    // minNum, not Math.min(...): firstSeenMs holds one entry per finding, so the spread form
    // overflows the stack on large registers (realMs matched for consistency).
    const firstScanDay = Math.floor(minNum(realMs) / DAY_MS) * DAY_MS;
    const startDay = Math.floor(minNum(firstSeenMs) / DAY_MS) * DAY_MS;
    for (let day = startDay; day < firstScanDay; day += DAY_MS) {
      const iso = toIso(day);
      if (iso === null) continue;
      // The synthetic row MUST carry the scope it was built for. `trendFromFrames` filters the
      // scan log by scope too (rule 2), so an unstamped synthetic row would be dropped again
      // one line later and the backbone would silently vanish under any scope filter — the
      // whole backfill reading as "this register has no history". Pinned in trend.test.ts.
      synthetic.push(scope ? { ts: iso, scope } : { ts: iso });
      syntheticIso.add(iso);
    }
  }

  // Synthetic days can only be < firstScan, and real scans are all >= firstScan, so a point's
  // `date` is in `syntheticIso` iff it's a reconstructed day — unambiguous.
  return tag(
    trendFromFrames(synthetic.concat(scans), base, severities, { hideNoFix, scope }),
    syntheticIso,
  );
}

// --------------------------------------------------------------------------- the KM series

/**
 * Build a skip-mask for `withKmMedian`: true at indices whose KM computation should be
 * skipped (emitted as null). Reconstructed points beyond `max` are thinned to an evenly
 * spaced sample (first + last always kept); real points are never skipped. Returns null
 * (skip nothing) when `max` is unset or the backbone already fits — the byte-identical path.
 * Exported for the trend spec.
 *
 * DIVERGENCE from gas/: gas/ runs `for (const i of reconIdx) skip[i] = false;` immediately
 * before the loop that sets the same indices to `true`. `new Array(n).fill(false)` already
 * made them false, so that pass is a provable no-op; dropped rather than ported. Behaviour is
 * identical — `test/trend.test.ts` pins the mask itself, not the number of loops.
 */
export function kmSkipMask(points: { reconstructed?: boolean }[], max?: number): boolean[] | null {
  if (max === undefined || max < 0) return null;
  const reconIdx: number[] = [];
  points.forEach((p, i) => {
    if (p.reconstructed) reconIdx.push(i);
  });
  if (reconIdx.length <= max) return null;
  const skip: boolean[] = new Array(points.length).fill(false);
  // Mark every reconstructed point skipped, then un-skip an evenly spaced sample of `max`.
  for (const i of reconIdx) skip[i] = true;
  if (max > 0) {
    const last = reconIdx.length - 1;
    const denom = max === 1 ? 1 : max - 1;
    for (let k = 0; k < max; k++) {
      skip[reconIdx[Math.round((k * last) / denom)]] = false;
    }
  }
  return skip;
}

/**
 * Augment already-emitted trend points with `km_median_days` — the Kaplan–Meier median
 * time-to-remediation as of each point's date, the censoring-aware replacement for a
 * closed-only median. For each point date d it replays the durable base as of d: rows
 * resolved by d (resolved_at <= d) are events at their stored `mttr_days` (fixed once
 * resolved); rows still open as of d (first_seen <= d and not resolved by d) are
 * right-censored at age `(d − first_seen)/day`. Rounded to 3 decimals like `trendFromFrames`;
 * null before any event or when survival never reaches 0.5 (too much censoring).
 *
 * opts.hideNoFix (default false) drops an open-as-of-d finding from the censored risk set when
 * no vendor fix was available by d (awaitingFixAsOf) — such a row isn't yet on the
 * from-detection remediation clock, so it shouldn't inflate the censoring. Resolved rows
 * (events) are always kept, per the shared no-fix rule.
 *
 * opts.maxReconstructed (default: unlimited) caps how many *reconstructed* points get a full
 * KM computation. This is the trend's single heaviest op — one KM curve rebuilt per point —
 * and `trendFromBase` seeds a synthetic point for every DAY between the earliest detection and
 * the first saved scan, so a register with long pre-scan history pays hundreds of curve builds
 * for a backbone the chart draws as one reconstructed line. Real (saved-scan) points always
 * compute; when the synthetic backbone exceeds the cap, KM runs on an evenly spaced sample of
 * it (endpoints included) and the rest carry `km_median_days: null`. The client filters nulls
 * out of the KM line, so the line stays continuous through the sampled + real points and every
 * real scan point keeps an exact value.
 *
 * opts.scope filters the ROWS only — the point dates come from the caller.
 */
export function withKmMedian<T extends { date: string; reconstructed?: boolean }>(
  points: T[],
  base: Rec[],
  severities: string[] | null = null,
  opts: { hideNoFix?: boolean; maxReconstructed?: number; scope?: Scope } = {},
): (T & { km_median_days: number | null })[] {
  const hideNoFix = opts.hideNoFix ?? false;
  const rows = scopeRows(base, severities, opts.scope);
  const parsed = rows.map((r) => ({
    first: parseTs(r["first_seen"]),
    resolvedAt: parseTs(r["resolved_at"]),
    mttr: mttrOf(r),
    fixAvail: parseTs(r["fix_available_at"]),
  }));

  // Which point indices actually get a KM build. Default: all. With a cap, thin only the
  // reconstructed backbone (real scan points stay exact), keeping an evenly spaced sample.
  const skip = kmSkipMask(points, opts.maxReconstructed);

  return points.map((p, i) => {
    if (skip !== null && skip[i]) return { ...p, km_median_days: null };
    const d = parseTs(p.date);
    let med: number | null = null;
    if (d !== null) {
      const events: number[] = []; // resolved by d, at their stored mttr_days
      const risk: number[] = []; // the risk set: events + open-as-of-d censored ages
      for (const r of parsed) {
        if (r.resolvedAt !== null && r.resolvedAt <= d) {
          if (r.mttr !== null) {
            events.push(r.mttr);
            risk.push(r.mttr);
          }
        } else if (r.first !== null && r.first <= d) {
          if (hideNoFix && awaitingFixAsOf(r.first, r.resolvedAt, r.fixAvail, d)) continue;
          risk.push((d - r.first) / DAY_MS);
        }
      }
      med = kmMedianFromCurve(kmCurve(events, risk));
    }
    return { ...p, km_median_days: round3(med) };
  });
}

/**
 * Kaplan–Meier median time-to-remediation as of a single instant `d` (ms epoch), over `base`
 * rows. The one-date core of `withKmMedian`, split out so a caller needing just one as-of
 * value — the executive week-over-week badge — doesn't reconstruct a whole trend series just
 * to read two points. Same estimator (`kmCurve` → `kmMedianFromCurve`, shared so the two can't
 * drift) and the same as-of predicate `withKmMedian` uses. Returns the median in days (3 dp),
 * or null when the curve never reaches 0.5, there are no rows, or `d` is null.
 */
export function kmMedianAsOf(
  base: Rec[],
  severities: string[] | null,
  d: number | null,
  opts: { hideNoFix?: boolean; scope?: Scope } = {},
): number | null {
  if (d === null || !base.length) return null;
  const hideNoFix = opts.hideNoFix ?? false;
  // NOTE: gas/ applies the severity filter here WITHOUT its `base.length` guard (it already
  // returned above for an empty base), and so does this. `scopeRows` collapses to the same
  // thing on a non-empty base.
  const rows = scopeRows(base, severities, opts.scope);
  const events: number[] = []; // resolved by d, at their stored mttr_days
  const risk: number[] = []; // risk set: events + open-as-of-d censored ages
  for (const r of rows) {
    const resolvedAt = parseTs(r["resolved_at"]);
    if (resolvedAt !== null && resolvedAt <= d) {
      const mttr = mttrOf(r);
      if (mttr !== null) {
        events.push(mttr);
        risk.push(mttr);
      }
      continue;
    }
    const first = parseTs(r["first_seen"]);
    if (first !== null && first <= d) {
      if (hideNoFix && awaitingFixAsOf(first, resolvedAt, parseTs(r["fix_available_at"]), d)) {
        continue;
      }
      risk.push((d - first) / DAY_MS);
    }
  }
  return round3(kmMedianFromCurve(kmCurve(events, risk)));
}

// --------------------------------------------------------------------------- the SLA family

/**
 * Augment already-emitted trend points with an `open_past_sla` count — open findings whose age
 * at the point's date already exceeds their severity's SLA target (the tail the resolved-only
 * In-SLA % never scores). Replays the durable base at each point's `date` with the same as-of
 * predicate `trendFromFrames` uses (open iff first_seen <= d and not resolved by d; breached
 * iff `(d − first_seen)/day > SLA_TARGETS[sev]`), so real saved scans and synthetic backfill
 * days are counted identically. The generic passthrough preserves every existing point field.
 *
 * `fromField` picks the age/breach origin. "first_seen" (default) is the from-detection clock
 * and preserves gas/'s behaviour byte-for-byte. "actionable_from" switches to the
 * vendor-fix-availability clock: rows with a null value for the chosen field are skipped, which
 * is exactly what drops awaiting-vendor-fix rows in that mode.
 */
export function withOpenPastSla<T extends { date: string }>(
  points: T[],
  base: Rec[],
  severities: string[] | null = null,
  fromField: "first_seen" | "actionable_from" = "first_seen",
  opts: { scope?: Scope } = {},
): (T & { open_past_sla: number })[] {
  const rows = scopeRows(base, severities, opts.scope);
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
  scope?: Scope,
): { deadline: number; resolvedAt: number | null }[] {
  const out: { deadline: number; resolvedAt: number | null }[] = [];
  for (const r of scopeRows(base, severities, scope)) {
    const actionable = parseTs(r["actionable_from"]);
    const target = SLA_TARGETS[normalizeSeverity(r["severity"])];
    if (actionable === null || target === undefined) continue;
    out.push({ deadline: actionable + target * DAY_MS, resolvedAt: parseTs(r["resolved_at"]) });
  }
  return out;
}

/**
 * Augment trend points with the SLA-burn net flow — the backlog-of-breach's rate of change per
 * scan window, so a falling MTTR beside a growing past-SLA backlog reads as one story. For each
 * point date d with previous point p (exclusive-left window `(p, d]`):
 *   - `sla_entered`: findings whose SLA deadline (actionable_from + target) falls in `(p, d]`
 *     AND that were still unresolved by that deadline — i.e. crossed into breach this window.
 *   - `sla_cleared`: breached findings (resolved AFTER their deadline) whose resolution falls
 *     in `(p, d]` — i.e. left the past-SLA backlog this window.
 *   - `sla_net`: entered − cleared. Above zero means the past-SLA backlog grew.
 * The first point has no predecessor window, so all three are null. Awaiting-vendor-fix rows
 * (null actionable_from) and no-target severities never contribute (see slaDeadlineRows).
 */
export function withSlaBurn<T extends { date: string }>(
  points: T[],
  base: Rec[],
  severities: string[] | null = null,
  opts: { scope?: Scope } = {},
): (T & { sla_entered: number | null; sla_cleared: number | null; sla_net: number | null })[] {
  const parsed = slaDeadlineRows(base, severities, opts.scope);

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
          r.deadline > prevMs &&
          r.deadline <= d &&
          (r.resolvedAt === null || r.resolvedAt > r.deadline)
        ) {
          entered += 1;
        }
        // Left the past-SLA backlog this window: a breached row (resolved after its deadline)
        // whose resolution landed in (prev, d].
        if (
          r.resolvedAt !== null &&
          r.resolvedAt > prevMs &&
          r.resolvedAt <= d &&
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
 * "In SLA %". For each point date d, over the cohort of findings whose SLA deadline has already
 * passed as of d (deadline <= d, so the verdict is knowable), the share that was actually
 * resolved on time (resolved_at != null AND resolved_at <= deadline), as a 1-decimal-rounded
 * percentage. An open-past-deadline finding counts against attainment (unlike In-SLA %, which
 * never scores it); null when the cohort is empty. Awaiting-vendor-fix rows and no-target
 * severities are excluded from the cohort (see slaDeadlineRows).
 */
export function cohortSlaAttainment<T extends { date: string }>(
  points: T[],
  base: Rec[],
  severities: string[] | null = null,
  opts: { scope?: Scope } = {},
): (T & { sla_attainment_pct: number | null })[] {
  const parsed = slaDeadlineRows(base, severities, opts.scope);

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
    return { ...p, sla_attainment_pct: cohort ? round1((met / cohort) * 100) : null };
  });
}

// --------------------------------------------------------------------------- the P2P pair

/**
 * Augment already-emitted trend points with remediation **coverage** and **efficiency** as of
 * each point's date — the P2P pair, over the same durable rows every sibling here reads.
 *
 * Replays the base at each point's `date` with exactly the as-of predicate `trendFromFrames`
 * and `withOpenPastSla` use: remediated-as-of-d iff `resolved_at <= d`; open-as-of-d iff
 * `first_seen <= d` and not resolved by d. Rows that did not exist yet at d contribute to
 * neither, so an early point measures only the register that existed then.
 *
 * The risk **classification is not as-of** — it is each row's sticky label, evaluated once.
 * That is a deliberate and load-bearing consequence of the monotone risk-signal capture: a
 * finding that only landed on the KEV in month six counts as high risk in month one too. It
 * biases the early series *conservatively* (coverage reads worse than it looked at the time,
 * never better), and it is the price of a series that does not silently rewrite last week's
 * plotted value every time a scan lands. The methodology panel says so in as many words.
 *
 * Rows whose signals were never captured are `unknown` and leave both sides of both rates;
 * `unknown_pct` travels with each point so a reader can see how much of the register the rate
 * is actually speaking for.
 *
 * **`secrets` ROWS ARE EXCLUDED, AND COUNTED.** DIVERGENCE from gas/, which has one scope.
 * `program.classifyRisk` THROWS on a secrets row — `ruleForScope("secrets")` is null by design
 * (there is no exploit intelligence for a hardcoded string, and severity there grades a
 * DETECTION rather than whether the credential is live), so coverage and efficiency over that
 * population would be rates with no meaning. Passing them through would abort the whole series;
 * silently dropping them would understate what the rate does not speak for. So they are dropped
 * AND reported: `secrets_excluded` carries, per point, how many secrets rows existed as of that
 * date. `unknown_pct` is over the classifiable population only, by the same argument.
 *
 * `rule` may be omitted, in which case each row's own scope rule applies (`ruleForScope`).
 */
export function withCoverageEfficiency<T extends { date: string }>(
  points: T[],
  base: Rec[],
  rule?: AnyRiskRule,
  severities: string[] | null = null,
  opts: { scope?: Scope } = {},
): (T & {
  coverage_pct: number | null;
  efficiency_pct: number | null;
  high_risk_open: number;
  high_risk_remediated: number;
  unknown_pct: number | null;
  secrets_excluded: number;
})[] {
  const rows = scopeRows(base, severities, opts.scope);
  const secrets = rows.filter((r) => r["scope"] === "secrets");
  const classifiable = rows.filter((r) => r["scope"] !== "secrets");

  // Classify once up front, not per point: the label is sticky, so it cannot change between
  // dates, and the register is findings-scale times points-scale if we don't hoist it.
  const parsed: { first: number | null; resolvedAt: number | null; cls: RiskClass }[] =
    classifiable.map((r) => ({
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      cls: classifyRisk(r as unknown as RiskRow, rule),
    }));
  const secretFirst = secrets.map((r) => parseTs(r["first_seen"]));

  return points.map((p) => {
    const d = parseTs(p.date);
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let unknown = 0;
    let counted = 0;
    let excluded = 0;
    if (d !== null) {
      for (const r of parsed) {
        if (r.first === null || r.first > d) continue; // did not exist yet
        const remediated = r.resolvedAt !== null && r.resolvedAt <= d;
        counted += 1;
        if (r.cls === "unknown") {
          unknown += 1;
          continue;
        }
        if (r.cls === "high") {
          if (remediated) tp += 1;
          else fn += 1;
        } else if (remediated) {
          fp += 1;
        }
      }
      for (const first of secretFirst) if (first !== null && first <= d) excluded += 1;
    }
    return {
      ...p,
      coverage_pct: round1(tp + fn > 0 ? (tp / (tp + fn)) * 100 : null),
      efficiency_pct: round1(tp + fp > 0 ? (tp / (tp + fp)) * 100 : null),
      high_risk_open: fn,
      high_risk_remediated: tp,
      unknown_pct: round1(counted > 0 ? (unknown / counted) * 100 : null),
      secrets_excluded: excluded,
    };
  });
}

// --------------------------------------------------------------------------- per-scope stack

/**
 * One series per scope from a SINGLE partitioning pass — the executive stack's entry point.
 *
 * The obvious way to build three series is to call a trend function three times with
 * `{ scope }`, which re-walks the whole ledger and the whole scan log once per scope. This
 * buckets both ONCE by their `scope` column and hands each bucket to `compute`, so the cost is
 * one pass plus the three computations. Rows carrying a scope outside `SCOPES` are dropped —
 * `scope` is part of every ledger row's identity, so a value off the table is corrupt data, not
 * a fourth register.
 *
 * `compute` receives the already-scoped scans and rows, so it must NOT re-apply a scope filter
 * (there is nothing left to filter, and `trendFromBase`'s synthetic scan rows are unstamped by
 * design in this path — see its note).
 */
export function perScopeSeries<P>(
  scans: Rec[],
  base: Rec[],
  compute: (scopeScans: Rec[], scopeBase: Rec[], scope: Scope) => P,
): Record<Scope, P> {
  const scanBuckets = {} as Record<Scope, Rec[]>;
  const rowBuckets = {} as Record<Scope, Rec[]>;
  for (const s of SCOPES) {
    scanBuckets[s] = [];
    rowBuckets[s] = [];
  }
  const bucket = (v: unknown): Scope | null =>
    (SCOPES as readonly string[]).includes(String(v)) ? (v as Scope) : null;
  for (const s of scans) {
    const k = bucket(s["scope"]);
    if (k !== null) scanBuckets[k].push(s);
  }
  for (const r of base) {
    const k = bucket(r["scope"]);
    if (k !== null) rowBuckets[k].push(r);
  }
  const out = {} as Record<Scope, P>;
  for (const s of SCOPES) out[s] = compute(scanBuckets[s], rowBuckets[s], s);
  return out;
}

/**
 * The headline trend for each of sca / sast / secrets, from one pass. Equal, series for series,
 * to `trendFromBase(scans, base, severities, { ...opts, scope })` called once per scope — which
 * is what `test/trend.test.ts` pins, because the whole point of the single pass is that it does
 * not change the answer.
 */
export function trendByScope(
  scans: Rec[],
  base: Rec[],
  severities: string[] | null = null,
  opts: { backfill?: boolean; hideNoFix?: boolean } = {},
): Record<Scope, BackfilledTrendPoint[]> {
  return perScopeSeries(scans, base, (s, b) => trendFromBase(s, b, severities, opts));
}
