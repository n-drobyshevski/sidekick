// The AARS-severity distribution over time, for the inventory's trend chart.
//
// Nothing historical was ever retained — sync_history recorded only totals, and the
// graph snapshot is one file overwritten every sync — so the series is recorded going
// forward, one point per successful sync, and cannot be backfilled. Rows written before
// the column existed are skipped rather than charted as zero, which would draw a cliff
// that never happened.

import { AARS_SEVERITY_ORDER, normalizeAarsSeverity, type AarsSeverity } from "./config";
import type { Rec } from "./util";
import { cmpBy } from "./util";

/**
 * The levels the chart draws. INFO (score 0–9, "no action required") is recorded but not
 * plotted: it is the largest bucket in a healthy estate and would flatten the levels that
 * need watching. The bar chart beside it hides INFO for the same reason — the two must
 * agree or the pair reads as a contradiction.
 */
export const TREND_SEVERITIES: readonly AarsSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export interface AarsTrendPoint {
  at: string;                        // ISO timestamp of the sync that produced the counts
  counts: Record<string, number>;    // every AARS severity, INFO included
  /**
   * The AARS rule version these counts were scored under (0 = the spec defaults). Counts
   * from different versions are not on the same scale, so the chart marks where the model
   * changed rather than drawing the step as if the estate had moved.
   */
  ruleVersion: number;
}

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

function parseCounts(v: unknown): Record<string, number> | null {
  if (typeof v !== "string" || !v) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const sev of AARS_SEVERITY_ORDER) {
    const n = Number(raw[sev]);
    counts[sev] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  return counts;
}

/**
 * sync_history rows → chronological trend points. Only successful syncs carrying a
 * readable distribution contribute; `limit` keeps the most RECENT n (the chart's window),
 * so a long-lived ledger doesn't ship its whole life on every inventory load.
 */
export function aarsTrendFromHistory(rows: Rec[], limit = 90): AarsTrendPoint[] {
  const points: AarsTrendPoint[] = [];
  for (const r of rows) {
    if (String(r["status"] ?? "") !== "SUCCESS") continue;
    const counts = parseCounts(r["aars_severity_json"]);
    if (!counts) continue; // pre-upgrade sync: absent, not zero
    // `||`, not `??`: an empty cell reads as null from the sheet but as "" from anywhere
    // else, and both mean "no finish time recorded — fall back to the start".
    const at = String(r["finished_at"] || r["started_at"] || "");
    if (!at) continue;
    const v = Number(r["aars_rule_version"]);
    // Rows written before the column existed scored under the defaults, which IS version 0.
    const ruleVersion = Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    points.push({ at, counts, ruleVersion });
  }
  points.sort(cmpBy((p) => p.at));
  return limit > 0 && points.length > limit ? points.slice(points.length - limit) : points;
}

/**
 * Indices where the scoring model changed relative to the point before. The chart marks
 * these so a step caused by a rule edit is never read as a step in the estate.
 */
export function ruleChangePoints(points: AarsTrendPoint[]): number[] {
  const marks: number[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.ruleVersion !== points[i - 1]!.ruleVersion) marks.push(i);
  }
  return marks;
}
