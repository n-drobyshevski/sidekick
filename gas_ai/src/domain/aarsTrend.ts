// Distribution-over-time series for sync_history — the AARS-severity trend and, since
// Phase 4, the problem/decision-vector outcome trend beside it.
//
// Nothing historical was ever retained — sync_history recorded only totals, and the
// graph snapshot is one file overwritten every sync — so a series is recorded going
// forward, one point per successful sync, and cannot be backfilled. Rows written before
// a series' column existed are skipped rather than charted as zero, which would draw a
// cliff that never happened.

import { AARS_SEVERITY_ORDER, normalizeAarsSeverity, type AarsSeverity } from "./config";
import { OUTCOME_VALUES, type Outcome } from "./problem";
import type { Rec } from "./util";
import { cmpBy } from "./util";

/**
 * The levels the chart draws. INFO (score 0–9, "no action required") is recorded but not
 * plotted: it is the largest bucket in a healthy landscape and would flatten the levels that
 * need watching. The bar chart beside it hides INFO for the same reason — the two must
 * agree or the pair reads as a contradiction.
 */
export const TREND_SEVERITIES: readonly AarsSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/** One series' point, generic over the vocabulary it counts — AARS severities, problem outcomes. */
export interface TrendPoint<K extends string> {
  at: string;                    // ISO timestamp of the sync that produced the counts
  counts: Record<K, number>;     // every value in the series' vocabulary, zeros included
  /**
   * The rule version these counts were produced under (0 = the spec/default rule). Counts
   * from different versions are not on the same scale, so the chart marks where the model
   * changed rather than drawing the step as if the landscape had moved.
   */
  ruleVersion: number;
}

export type AarsTrendPoint = TrendPoint<AarsSeverity>;

/** Count assets per AARS severity. Unscored nodes belong to no level and are dropped. */
export function countAarsSeverities(
  nodes: ReadonlyArray<{ aarsSeverity?: string }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sev of AARS_SEVERITY_ORDER) counts[sev] = 0;
  for (const n of nodes) {
    const sev = normalizeAarsSeverity(n.aarsSeverity);
    if (sev) counts[sev] += 1;
  }
  return counts;
}

function parseCounts<K extends string>(v: unknown, keys: readonly K[]): Record<K, number> | null {
  if (typeof v !== "string" || !v) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const counts = {} as Record<K, number>;
  for (const k of keys) {
    const n = Number(raw[k]);
    counts[k] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  return counts;
}

/** What one series needs to be read out of `sync_history`: its vocabulary and its two columns. */
export interface TrendSeriesSpec<K extends string> {
  /** The values the distribution is counted over, in the order the caller wants them. */
  keys: readonly K[];
  /** The column holding the JSON-encoded counts (e.g. `aars_severity_json`). */
  countsColumn: string;
  /** The column holding the rule version that produced them (e.g. `aars_rule_version`). */
  versionColumn: string;
}

/**
 * `sync_history` rows → chronological trend points, for whatever distribution `spec`
 * names. Only successful syncs carrying a readable distribution contribute; `limit` keeps
 * the most RECENT n (the chart's window), so a long-lived ledger doesn't ship its whole
 * life on every inventory load.
 *
 * Extracted from what used to be `aarsTrendFromHistory`'s own body so the problem-outcome
 * series below can REUSE it rather than fork it. At ~97 lines, forking is a five-minute
 * copy-paste — which is exactly why it would happen, silently, the moment a second series
 * needed this shape, if the function weren't parameterised before that second call site
 * existed. Two behaviours are kept verbatim from the original: a sync recorded before
 * `spec.countsColumn` existed is SKIPPED rather than plotted as zero (charting a missing
 * distribution as 0 would draw a cliff that never happened), and an unreadable or
 * non-positive `spec.versionColumn` reads as rule version 0 — which IS what a pre-column
 * sync was scored/decided under.
 */
export function trendFromHistory<K extends string>(
  rows: Rec[],
  spec: TrendSeriesSpec<K>,
  limit = 90,
): TrendPoint<K>[] {
  const points: TrendPoint<K>[] = [];
  for (const r of rows) {
    if (String(r["status"] ?? "") !== "SUCCESS") continue;
    const counts = parseCounts(r[spec.countsColumn], spec.keys);
    if (!counts) continue; // pre-upgrade sync: absent, not zero
    // `||`, not `??`: an empty cell reads as null from the sheet but as "" from anywhere
    // else, and both mean "no finish time recorded — fall back to the start".
    const at = String(r["finished_at"] || r["started_at"] || "");
    if (!at) continue;
    const v = Number(r[spec.versionColumn]);
    const ruleVersion = Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    points.push({ at, counts, ruleVersion });
  }
  points.sort(cmpBy((p) => p.at));
  return limit > 0 && points.length > limit ? points.slice(points.length - limit) : points;
}

const AARS_SEVERITY_SPEC: TrendSeriesSpec<AarsSeverity> = {
  keys: AARS_SEVERITY_ORDER,
  countsColumn: "aars_severity_json",
  versionColumn: "aars_rule_version",
};

/** The AARS-severity trend — `trendFromHistory` bound to the AARS columns and vocabulary. */
export function aarsTrendFromHistory(rows: Rec[], limit = 90): AarsTrendPoint[] {
  return trendFromHistory(rows, AARS_SEVERITY_SPEC, limit);
}

export type ProblemTrendPoint = TrendPoint<Outcome>;

const PROBLEM_OUTCOME_SPEC: TrendSeriesSpec<Outcome> = {
  keys: OUTCOME_VALUES,
  countsColumn: "problem_outcome_json",
  versionColumn: "problem_rule_version",
};

/**
 * The problem/decision-vector outcome trend — the second series `trendFromHistory` exists
 * to let this reuse rather than fork: same shape, same skip rule, same rule-version
 * marking as the AARS series, differing only in which columns and vocabulary it reads.
 */
export function problemTrendFromHistory(rows: Rec[], limit = 90): ProblemTrendPoint[] {
  return trendFromHistory(rows, PROBLEM_OUTCOME_SPEC, limit);
}

/**
 * Indices where the scoring/decision model changed relative to the point before. The chart
 * marks these so a step caused by a rule edit is never read as a step in the landscape. Reads
 * only `ruleVersion`, so it serves either series (or any future one) without its own type
 * parameter.
 */
export function ruleChangePoints(points: ReadonlyArray<{ ruleVersion: number }>): number[] {
  const marks: number[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.ruleVersion !== points[i - 1]!.ruleVersion) marks.push(i);
  }
  return marks;
}
