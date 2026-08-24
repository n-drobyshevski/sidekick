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

/**
 * The `sync_history` column holding EVERY project's distributions for one sync.
 *
 * One cell per sync, not one column per series per project: a `{projectId: {aars, outcome}}`
 * map, mirroring `aars_severity_json` / `problem_outcome_json` one level down. Appended
 * under the same no-migration contract those two were — a row written before it exists
 * simply has no scoped series, which `parseProjectCounts` reports as absent rather than zero.
 *
 * WHY THIS EXISTS AT ALL. sync_history recorded register-wide totals and nothing else, so a
 * past point had no project dimension to be re-scoped BY, and the inventory trend was the one
 * figure in the app that had to refuse the project switcher outright. It still refuses for
 * every sync recorded before this column — history cannot be backfilled from a ledger that
 * never held it — but from here forward the series follows the sidebar like everything else.
 */
export const PROJECT_TOTALS_COLUMN = "project_totals_json";

/**
 * One project's two distributions at one sync — the value side of `PROJECT_TOTALS_COLUMN`.
 * The keys match the `projectKey` on each `TrendSeriesSpec`, which is what keeps the writer
 * below and the reader above from drifting apart.
 */
export interface ProjectTotals {
  aars: Record<string, number>;
  outcome: Record<string, number>;
  /**
   * The two counts that have a project grain, for the trend the inventory actually draws
   * now. OPTIONAL, because a blob written before this key existed has no counts and must
   * read as absent rather than as two zeros — the same rule the whole column follows.
   *
   * Compliance posture fails are deliberately NOT here. Wiz reports posture per
   * (framework, category, subcategory, policy) and never per resource, so there is no
   * project to attribute a failing policy to; that series stays register-wide and the
   * chart says so rather than quietly showing the whole landscape under a project filter.
   */
  counts?: { issues: number; findings: number };
}

/**
 * A Sheets cell holds 50,000 characters. Past this the encode REFUSES rather than writes a
 * value the sheet would reject or clip — see `encodeProjectTotals`.
 */
export const PROJECT_TOTALS_MAX_CHARS = 45_000;

/**
 * Every project's distributions for this sync, keyed by project id.
 *
 * AN ENTRY PER PROJECT HOLDING AN ASSET, zeroed vocabulary included, and that is the whole
 * contract the reader depends on: present-with-zeros means "measured, and it was zero";
 * absent means "this project held nothing in the register at that sync". Without the zeroed
 * entries the two would be indistinguishable and every project's line would start at the
 * beginning of time.
 *
 * FOLDERS COME OUT FREE. An asset carries every project it belongs to, ancestors included
 * (api.ts `viewAssets`), so incrementing per id gives a business unit the sum of its whole
 * subtree with no tree walk — and gives it by exactly the same rule the sidebar filters by,
 * which is what keeps the trend and the figures beside it describing one population.
 *
 * Issues and findings are attributed through their ASSET, mirroring `viewIssues` /
 * `viewFindings`: an issue is in a project when the thing it is about is. A row whose asset
 * is not in the register contributes to no project — the same "belongs to no project" answer
 * the scoped gap count already gives.
 */
export function countProjectTotals(
  nodes: ReadonlyArray<{ id: string; projects?: readonly { id: string }[]; aarsSeverity?: string }>,
  decided: ReadonlyArray<{ assetId?: string; resourceId?: string; problemOutcome?: string }>,
): Record<string, ProjectTotals> {
  const totals: Record<string, ProjectTotals> = {};
  const projectsByAsset = new Map<string, readonly { id: string }[]>();

  function entry(projectId: string): ProjectTotals {
    let t = totals[projectId];
    if (!t) {
      const aars: Record<string, number> = {};
      for (const sev of AARS_SEVERITY_ORDER) aars[sev] = 0;
      const outcome: Record<string, number> = {};
      for (const o of OUTCOME_VALUES) outcome[o] = 0;
      t = { aars, outcome, counts: { issues: 0, findings: 0 } };
      totals[projectId] = t;
    }
    return t;
  }

  for (const n of nodes) {
    const projects = n.projects ?? [];
    if (!projects.length) continue;
    projectsByAsset.set(n.id, projects);
    const sev = normalizeAarsSeverity(n.aarsSeverity);
    for (const p of projects) {
      const t = entry(p.id);
      if (sev) t.aars[sev] += 1;
    }
  }

  for (const r of decided) {
    // `assetId` vs `resourceId` is what separates an issue row from a finding row — the
    // same discriminator the outcome attribution below already leans on, named here
    // because this loop now counts the two populations separately as well as together.
    const isFinding = r.assetId === undefined && r.resourceId !== undefined;
    const assetId = r.assetId ?? r.resourceId ?? "";
    const projects = projectsByAsset.get(assetId) ?? [];
    for (const p of projects) {
      const counts = entry(p.id).counts;
      if (counts) counts[isFinding ? "findings" : "issues"] += 1;
    }
    const outcome = r.problemOutcome;
    if (!outcome || !(OUTCOME_VALUES as readonly string[]).includes(outcome)) continue;
    for (const p of projects) entry(p.id).outcome[outcome] += 1;
  }

  return totals;
}

/**
 * `countProjectTotals` as a cell value, or null when it would not fit in one.
 *
 * Null rather than a truncated map, and rather than throwing. A trend refinement must never
 * be able to fail a sync commit or — worse — write a prefix of the projects, which would read
 * as "these projects held nothing" for every project that fell off the end. The sync still
 * records its register-wide totals; the scoped series simply has no point for that sync and
 * the chart says how many it is missing.
 */
export function encodeProjectTotals(totals: Record<string, ProjectTotals>): string | null {
  const json = JSON.stringify(totals);
  return json.length > PROJECT_TOTALS_MAX_CHARS ? null : json;
}

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

function countsFromObject<K extends string>(
  parsed: unknown, keys: readonly K[],
): Record<K, number> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const counts = {} as Record<K, number>;
  for (const k of keys) {
    const n = Number(raw[k]);
    counts[k] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  return counts;
}

function parseCounts<K extends string>(v: unknown, keys: readonly K[]): Record<K, number> | null {
  if (typeof v !== "string" || !v) return null;
  try {
    return countsFromObject(JSON.parse(v), keys);
  } catch {
    return null;
  }
}

/**
 * ONE project's counts for one series, out of the per-project blob — or null, which means
 * "no measurement", never zero.
 *
 * Null covers two different absences and both must skip the point rather than plot a zero:
 * the column is missing (a sync recorded before this shipped), or the column is there and
 * this project is not in it. The second is the load-bearing one. `countProjectTotals` writes
 * an entry for EVERY project holding an asset, zeroed vocabulary included — so a project
 * present with all-zero counts is a real, measured zero and IS plotted, while a project
 * absent from the map genuinely had nothing in the register at that sync. Collapsing the two
 * would draw a project's history back to the beginning of time at zero, which is the same
 * cliff the pre-column skip above exists to avoid.
 */
function parseProjectCounts<K extends string>(
  v: unknown, projectId: string, spec: TrendSeriesSpec<K>,
): Record<K, number> | null {
  if (typeof v !== "string" || !v) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entry = (parsed as Record<string, unknown>)[projectId];
  if (!entry || typeof entry !== "object") return null;
  return countsFromObject((entry as Record<string, unknown>)[spec.projectKey], spec.keys);
}

/** What one series needs to be read out of `sync_history`: its vocabulary and its two columns. */
export interface TrendSeriesSpec<K extends string> {
  /** The values the distribution is counted over, in the order the caller wants them. */
  keys: readonly K[];
  /** The column holding the JSON-encoded counts (e.g. `aars_severity_json`). */
  countsColumn: string;
  /** The column holding the rule version that produced them (e.g. `aars_rule_version`). */
  versionColumn: string;
  /**
   * Where this series' counts live INSIDE a `project_totals_json` entry — see that
   * constant. The two columns above hold one distribution each for the whole register; the
   * per-project blob holds both, keyed, so one cell carries every project rather than one
   * cell per series per project.
   */
  projectKey: string;
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
  projectId = "",
): TrendPoint<K>[] {
  const points: TrendPoint<K>[] = [];
  for (const r of rows) {
    if (String(r["status"] ?? "") !== "SUCCESS") continue;
    const counts = projectId
      ? parseProjectCounts(r[PROJECT_TOTALS_COLUMN], projectId, spec)
      : parseCounts(r[spec.countsColumn], spec.keys);
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
  projectKey: "aars",
};

/** The AARS-severity trend — `trendFromHistory` bound to the AARS columns and vocabulary. */
export function aarsTrendFromHistory(
  rows: Rec[], limit = 90, projectId = "",
): AarsTrendPoint[] {
  return trendFromHistory(rows, AARS_SEVERITY_SPEC, limit, projectId);
}

export type ProblemTrendPoint = TrendPoint<Outcome>;

const PROBLEM_OUTCOME_SPEC: TrendSeriesSpec<Outcome> = {
  keys: OUTCOME_VALUES,
  countsColumn: "problem_outcome_json",
  versionColumn: "problem_rule_version",
  projectKey: "outcome",
};

/**
 * The problem/decision-vector outcome trend — the second series `trendFromHistory` exists
 * to let this reuse rather than fork: same shape, same skip rule, same rule-version
 * marking as the AARS series, differing only in which columns and vocabulary it reads.
 */
export function problemTrendFromHistory(
  rows: Rec[], limit = 90, projectId = "",
): ProblemTrendPoint[] {
  return trendFromHistory(rows, PROBLEM_OUTCOME_SPEC, limit, projectId);
}

// ------------------------------------------------------------------- the count trend

export type CountKey = "issues" | "findings" | "postureFails";

/** The three counts, in the order the chart stacks them. */
export const COUNT_KEYS: readonly CountKey[] = ["issues", "findings", "postureFails"];

/**
 * One point on the trend the inventory draws now that no page charts a band distribution.
 *
 * `counts` is nullable PER SERIES, which is the whole reason this does not reuse
 * `TrendPoint<K>`. The three series entered the ledger at different times: `issue_count`
 * has been written since the first sync this app ever recorded, while `finding_count` and
 * `posture_fail_count` start at the sync after the columns were appended. History cannot
 * be backfilled from a ledger that never held it, so a sync that predates a column carries
 * null for that series and the chart must break the line there. Plotting 0 would draw a
 * landscape that had no failing controls until the day we started counting them, which is
 * the one thing a trend must never say.
 *
 * `posture_fail_count` is null for a second reason as well: a sync that collected no
 * framework posture (an optional, per-framework step a tenant can decline) genuinely has
 * no number, and that is not zero failing policies either.
 *
 * NO `ruleVersion`. The band trend carried one because two distributions from different
 * scoring models are not on the same scale; a count of open issues is on the same scale as
 * every other count of open issues, forever. There is nothing to mark.
 */
export interface CountTrendPoint {
  at: string;
  counts: Record<CountKey, number | null>;
}

/** A history cell as a count, or null for "this sync recorded no such number". */
function cellCount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** One project's `{issues, findings}` out of a `project_totals_json` cell, or null. */
function projectCountEntry(cell: unknown, projectId: string): { issues: number; findings: number } | null {
  let parsed: unknown = cell;
  if (typeof cell === "string") {
    if (!cell) return null;
    try {
      parsed = JSON.parse(cell);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entry = (parsed as Record<string, unknown>)[projectId];
  if (!entry || typeof entry !== "object") return null;
  const counts = (entry as Record<string, unknown>)["counts"];
  if (!counts || typeof counts !== "object") return null;
  const issues = cellCount((counts as Record<string, unknown>)["issues"]);
  const findings = cellCount((counts as Record<string, unknown>)["findings"]);
  return issues === null || findings === null ? null : { issues, findings };
}

/**
 * `sync_history` rows → the count trend, register-wide or scoped to one project.
 *
 * A row contributes when it is a successful sync with a timestamp and at least one series
 * to plot; a row where all three are null is skipped rather than drawn as an empty column.
 *
 * Under a project filter the register-wide scalar columns are the WRONG population, so
 * they are not read at all: the two scoped counts come from `project_totals_json` and
 * posture fails go null, because a failing policy has no project to belong to. A caller
 * that wants to say "N of M syncs carry a scoped point" counts the nulls — the same shape
 * `trendScope.points` / `registerPoints` already publishes for the band series.
 */
export function countTrendFromHistory(
  rows: Rec[], limit = 90, projectId = "",
): CountTrendPoint[] {
  const points: CountTrendPoint[] = [];
  for (const r of rows) {
    if (String(r["status"] ?? "") !== "SUCCESS") continue;
    // `||` not `??`, for the same reason trendFromHistory uses it: an empty sheet cell
    // reads as null here and as "" everywhere else, and both mean "fall back to the start".
    const at = String(r["finished_at"] || r["started_at"] || "");
    if (!at) continue;
    let counts: Record<CountKey, number | null>;
    if (projectId) {
      const scoped = projectCountEntry(r[PROJECT_TOTALS_COLUMN], projectId);
      counts = {
        issues: scoped ? scoped.issues : null,
        findings: scoped ? scoped.findings : null,
        postureFails: null,
      };
    } else {
      counts = {
        issues: cellCount(r["issue_count"]),
        findings: cellCount(r["finding_count"]),
        postureFails: cellCount(r["posture_fail_count"]),
      };
    }
    if (COUNT_KEYS.every((k) => counts[k] === null)) continue;
    points.push({ at, counts });
  }
  points.sort(cmpBy((p) => p.at));
  return limit > 0 && points.length > limit ? points.slice(points.length - limit) : points;
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
