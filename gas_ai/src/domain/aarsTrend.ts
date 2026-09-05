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
import { CANDIDATE_CATEGORIES } from "./registerScope";
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
  /**
   * Numbers read out of the SAME cell that are NOT counts in the vocabulary — the
   * denominators a count is unreadable without. Present only when `spec.annotationKeys`
   * names some, so the two original specs' points are byte-identical to what they were.
   *
   * `edgesKnown` is the whole reason this exists. `adjacency_json` carries it beside the
   * three states because 68 asset edges on the reference tenant means UNLINKED is mostly
   * "not traversed" rather than "unrelated" — publish the two together or publish neither
   * (AdjacencyCensus.edgesKnown). Made an ANNOTATION rather than a fourth series because
   * plotting it as a line puts a count of edges on an axis counting issues, and dropping it
   * is how the three counts end up being read as a measurement of relatedness.
   *
   * A key the row's JSON does not carry reads as NULL, never as 0: an early row written
   * before the denominator was recorded has no denominator, and zero edges known is a very
   * different claim from nobody having counted them.
   */
  annotations?: Record<string, number | null>;
}

/**
 * A point whose counts can be null PER KEY — the shape a vocabulary decided at render time
 * needs, and the reason `sparseTrendFromHistory` exists beside `trendFromHistory`.
 *
 * The category series is the case. Its keys are whichever categories the register collects
 * TODAY, and a sync recorded under a narrower scope never counted the others: it has no
 * number for them, and 0 would say it looked and found none. Same distinction
 * `CountTrendPoint` already draws between its three series, one level down — there per
 * series, here per key.
 */
export interface SparseTrendPoint<K extends string> extends Omit<TrendPoint<K>, "counts"> {
  counts: Record<K, number | null>;
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
  parsed: unknown, keys: readonly K[], absentKeyIsNull = false,
): Record<K, number | null> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const counts = {} as Record<K, number | null>;
  for (const k of keys) {
    // The absent case is decided BEFORE the coercion, because `Number(undefined)` is NaN and
    // the coercion below cannot tell "the writer omitted this key" from "the writer wrote
    // rubbish". A dense vocabulary (the AARS levels, the outcomes) is written whole by its
    // own counter, so an omitted level there really is a zero; a vocabulary chosen at read
    // time is not, and an absent key is a sync that never counted that category.
    if (absentKeyIsNull && !Object.prototype.hasOwnProperty.call(raw, k)) {
      counts[k] = null;
      continue;
    }
    const n = Number(raw[k]);
    counts[k] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  return counts;
}

function parseCounts<K extends string>(
  v: unknown, keys: readonly K[], absentKeyIsNull = false,
): Record<K, number | null> | null {
  if (typeof v !== "string" || !v) return null;
  try {
    return countsFromObject(JSON.parse(v), keys, absentKeyIsNull);
  } catch {
    return null;
  }
}

/**
 * The annotations a spec names, out of the same cell the counts came from.
 *
 * A key the cell does not carry is NULL — see `TrendPoint.annotations`. Returned even when
 * every value is null, because "this point has no denominator" is itself what the chart
 * must say beside the counts rather than omit.
 */
function parseAnnotations(v: unknown, keys: readonly string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  let raw: Record<string, unknown> = {};
  if (typeof v === "string" && v) {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
      }
    } catch {
      raw = {};
    }
  }
  for (const k of keys) {
    const n = Number(raw[k]);
    out[k] = Object.prototype.hasOwnProperty.call(raw, k) && Number.isFinite(n) && n >= 0
      ? Math.floor(n)
      : null;
  }
  return out;
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
): Record<K, number | null> | null {
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
  return countsFromObject(
    (entry as Record<string, unknown>)[spec.projectKey], spec.keys, spec.absentKeyIsNull,
  );
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
   *
   * A key the blob does not carry is not an error and not a zero: the scoped read simply
   * finds nothing and the series has no point for that sync, which is what the four specs
   * added after the blob was written all do under a project view. The blob has no adjacency,
   * exploitation, category or ledger grain, and one cannot be backfilled into rows that
   * never held it.
   */
  projectKey: string;
  /**
   * Numbers to lift out of the counts cell as `TrendPoint.annotations` — a denominator that
   * rides beside the counts rather than being plotted with them. `adjacency_json`'s
   * `edgesKnown` is the only one today; see `TrendPoint.annotations`.
   */
  annotationKeys?: readonly string[];
  /**
   * Whether a key the row's JSON omits reads as NULL rather than 0 — see `SparseTrendPoint`.
   * A spec that sets it must be read through `sparseTrendFromHistory`, whose return type is
   * the one that can carry the nulls.
   */
  absentKeyIsNull?: boolean;
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
function readTrend<K extends string>(
  rows: Rec[],
  spec: TrendSeriesSpec<K>,
  limit: number,
  projectId: string,
): SparseTrendPoint<K>[] {
  const points: SparseTrendPoint<K>[] = [];
  // An empty vocabulary is not a series. It reaches here only through `categorySpecFor([])`
  // — a register with no stored categories, which `cleanCategoryIds` does not produce — and
  // a point carrying no keys would draw an empty chart with a legend and a sync count under
  // it, which reads as "measured, and there is nothing", not as "there is nothing to ask".
  if (!spec.keys.length) return points;
  for (const r of rows) {
    if (String(r["status"] ?? "") !== "SUCCESS") continue;
    const counts = projectId
      ? parseProjectCounts(r[PROJECT_TOTALS_COLUMN], projectId, spec)
      : parseCounts(r[spec.countsColumn], spec.keys, spec.absentKeyIsNull);
    if (!counts) continue; // pre-upgrade sync: absent, not zero
    // Every key null is the sparse form of the same absence: the cell is there and names
    // none of today's vocabulary, so there is nothing on this point to draw. Skipped rather
    // than plotted as a row of gaps, exactly as `countTrendFromHistory` skips a row whose
    // three series are all null.
    if (spec.keys.every((k) => counts[k] === null)) continue;
    // `||`, not `??`: an empty cell reads as null from the sheet but as "" from anywhere
    // else, and both mean "no finish time recorded — fall back to the start".
    const at = String(r["finished_at"] || r["started_at"] || "");
    if (!at) continue;
    const v = Number(r[spec.versionColumn]);
    const ruleVersion = Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    const point: SparseTrendPoint<K> = { at, counts, ruleVersion };
    // Set ONLY when the spec asks for annotations, so a point from either of the two
    // original specs is byte-identical to what it was before this key existed.
    if (spec.annotationKeys && spec.annotationKeys.length) {
      point.annotations = parseAnnotations(r[spec.countsColumn], spec.annotationKeys);
    }
    points.push(point);
  }
  points.sort(cmpBy((p) => p.at));
  return limit > 0 && points.length > limit ? points.slice(points.length - limit) : points;
}

export function trendFromHistory<K extends string>(
  rows: Rec[],
  spec: TrendSeriesSpec<K>,
  limit = 90,
  projectId = "",
): TrendPoint<K>[] {
  // DENSE BY CONSTRUCTION, and the cast asserts exactly that: `spec.absentKeyIsNull` is the
  // only thing that can put a null in `counts`, and a spec setting it belongs to
  // `sparseTrendFromHistory` below, whose return type can carry them.
  return readTrend(rows, spec, limit, projectId) as TrendPoint<K>[];
}

/**
 * `trendFromHistory` for a spec whose vocabulary is decided at READ time — the same loop,
 * the same skip rules, a return type that can carry a per-key null.
 *
 * Not a fork: both faces call one `readTrend`. The split is in the TYPE alone, because a
 * caller reading the category series must be made to handle the null that a caller reading
 * the AARS levels can never receive.
 */
export function sparseTrendFromHistory<K extends string>(
  rows: Rec[],
  spec: TrendSeriesSpec<K>,
  limit = 90,
  projectId = "",
): SparseTrendPoint<K>[] {
  return readTrend(rows, spec, limit, projectId);
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

// ------------------------------------------------------- the posture series (WP9)
//
// Four more distributions `sync_history` already records — where a row sat relative to the
// AI estate, what exploitation evidence reached it, which categories the register was
// collecting, and what the lifecycle ledger did. Every one is `trendFromHistory` bound to
// its own column and vocabulary, for the reason the file's second series is: the shape is
// identical and the fork would be a five-minute copy-paste.
//
// THE VERSION COLUMN IS `derivation_version`, NOT A RULE VERSION, and the difference is the
// point. None of these four is priced by a model an operator can edit — nobody scores an
// adjacency state — so there is no rule version to mark. What CAN move under them is what a
// stored fact means: `withAiAdjacency` learning an edge type, `foldExploitation` moving the
// EPSS tier threshold, the normalizer changing what it collects. That is exactly what
// `derivation_version` records (see sheetsDb's own note on the column), and marking it lets
// `ruleChangePoints` draw the break for these series the same way it does for the other two.

export const ADJACENCY_KEYS = ["DIRECT", "ADJACENT", "UNLINKED"] as const;
export type AdjacencyKey = typeof ADJACENCY_KEYS[number];

/**
 * Where this sync's issues sat relative to the AI estate, over time.
 *
 * `edgesKnown` is an ANNOTATION and never a series — see `TrendPoint.annotations` for why a
 * denominator on the count axis is worse than no denominator at all.
 */
export const ADJACENCY_SPEC: TrendSeriesSpec<AdjacencyKey> = {
  keys: ADJACENCY_KEYS,
  countsColumn: "adjacency_json",
  versionColumn: "derivation_version",
  projectKey: "adjacency",
  annotationKeys: ["edgesKnown"],
};

export type AdjacencyTrendPoint = TrendPoint<AdjacencyKey>;

/** The adjacency census over time. */
export function adjacencyTrendFromHistory(
  rows: Rec[], limit = 90, projectId = "",
): AdjacencyTrendPoint[] {
  return trendFromHistory(rows, ADJACENCY_SPEC, limit, projectId);
}

export const EXPLOITATION_KEYS = ["kev", "exploit", "epss", "none", "unknown"] as const;
export type ExploitationKey = typeof EXPLOITATION_KEYS[number];

/**
 * The exploitation census over time — the five tiers, with the three counts that say what
 * the fold could not use riding beside them as annotations rather than as lines.
 *
 * `unjoined` and `droppedNotInRegister` are how this axis FAILS (the join field being wrong,
 * and the finding filter and the issue filter having drifted apart), and `findings` is how
 * many rows the fold read at all. sheetsDb's note on `exploitation_json` says they must not
 * be split into their own columns, for the same reason `edgesKnown` must not: a later reader
 * plots the tiers alone. An annotation is that rule expressed in the reader.
 *
 * A sync whose evidence pass did not run wrote NULL here, and null parses to no point —
 * "we never asked" is not a register with nothing exploited.
 */
export const EXPLOITATION_SPEC: TrendSeriesSpec<ExploitationKey> = {
  keys: EXPLOITATION_KEYS,
  countsColumn: "exploitation_json",
  versionColumn: "derivation_version",
  projectKey: "exploitation",
  annotationKeys: ["findings", "unjoined", "droppedNotInRegister"],
};

export type ExploitationTrendPoint = TrendPoint<ExploitationKey>;

/** The exploitation census over time. */
export function exploitationTrendFromHistory(
  rows: Rec[], limit = 90, projectId = "",
): ExploitationTrendPoint[] {
  return trendFromHistory(rows, EXPLOITATION_SPEC, limit, projectId);
}

/** The `sync_history` column holding `{[categoryId]: openIssues}` for one sync. */
export const CATEGORY_COUNTS_COLUMN = "category_counts_json";

/**
 * Open issues per risk category, over time — the ONE series whose vocabulary is not fixed
 * by this file.
 *
 * `keys` is empty here on purpose: the categories are whatever the register is collecting
 * when the chart is drawn, so the spec is bound at that moment by `categorySpecFor`. An
 * unbound spec charts nothing (`readTrend` refuses an empty vocabulary) rather than
 * charting every row as a point with no series on it.
 *
 * `absentKeyIsNull`, which is the whole reason `SparseTrendPoint` exists. A sync recorded
 * under a narrower scope never collected the other categories: it has NO NUMBER for them,
 * and a zero would say it looked and found none — the same lie the pre-column skip at the
 * top of this file exists to refuse, one grain finer.
 */
export const CATEGORY_SPEC: TrendSeriesSpec<string> = {
  keys: [],
  countsColumn: CATEGORY_COUNTS_COLUMN,
  versionColumn: "derivation_version",
  projectKey: "categories",
  absentKeyIsNull: true,
};

/** `CATEGORY_SPEC` bound to the categories the register holds at render time. */
export function categorySpecFor(categoryIds: readonly string[]): TrendSeriesSpec<string> {
  return { ...CATEGORY_SPEC, keys: [...categoryIds] };
}

/** Open issues per category over time, over the vocabulary the caller is drawing. */
export function categoryTrendFromHistory(
  rows: Rec[], categoryIds: readonly string[], limit = 90,
): SparseTrendPoint<string>[] {
  return sparseTrendFromHistory(rows, categorySpecFor(categoryIds), limit);
}

/**
 * Open issues per category, for one sync's committed issues.
 *
 * ONCE PER CATEGORY THE ROW CARRIES: an issue sitting in two selected categories arrives
 * twice from the API and merges to one row carrying both stamps (registerScope.ts), so it
 * is counted in both here — these counts deliberately do NOT sum to the register total, and
 * on the reference tenant an issue sits in roughly five categories. Deduped per row, so a
 * doubled stamp cannot count the same issue twice under one category.
 *
 * A row with no stamp at all contributes to nothing. It is a row written before the column
 * existed, read back as the AI category by `rowToIssue` — but this counter is only ever run
 * over a sync's own freshly-collected issues, where the stamp is always there.
 */
export function countIssueCategories(
  issues: ReadonlyArray<{ categories?: readonly string[] }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) {
    const seen: string[] = [];
    for (const c of issue.categories ?? []) {
      if (!c || seen.indexOf(c) >= 0) continue;
      seen.push(c);
      counts[c] = (counts[c] ?? 0) + 1;
    }
  }
  return counts;
}

export const LEDGER_KEYS = ["new", "resolved", "reopened"] as const;
export type LedgerKey = typeof LEDGER_KEYS[number];

/**
 * What the lifecycle ledger did, per sync — the three TRANSITIONS that move the open
 * population.
 *
 * `carried` and `skippedNarrowedScope` are deliberately not keys. Neither is a movement in
 * the register: `carried` counts rows that were already gone and stayed gone, and
 * `skippedNarrowedScope` counts absences this sync refused to read as remediation. Plotting
 * them beside the three would put four different questions on one axis — and
 * `skippedNarrowedScope` has a job below instead, where it decides whether a sync's figures
 * are comparable at all.
 */
export const LEDGER_SPEC: TrendSeriesSpec<LedgerKey> = {
  keys: LEDGER_KEYS,
  countsColumn: "ledger_json",
  versionColumn: "derivation_version",
  projectKey: "ledger",
};

export type LedgerTrendPoint = TrendPoint<LedgerKey>;

/** The ledger's three transition counts over time. */
export function ledgerTrendFromHistory(
  rows: Rec[], limit = 90, projectId = "",
): LedgerTrendPoint[] {
  return trendFromHistory(rows, LEDGER_SPEC, limit, projectId);
}

// ------------------------------------------------------------------ remediation capacity

export type CapacityVerdict = "gaining" | "keeping-up" | "falling-behind";

/**
 * The dead band around zero net flow that counts as "keeping up", in PERCENT of the open
 * population at the start of the sync.
 *
 * 2, ported from `gas/`'s `NET_CAPACITY_BAND_PCT` with its provenance intact: P2P v3 Fig. 22
 * splits firms into falling behind / maintaining / gaining ground without a sharp cut, and a
 * one-issue swing must not flip a verdict. The value is a JUDGEMENT, not a measurement, which
 * is why it is named and sits here rather than inline in the comparison.
 */
export const NET_CAPACITY_BAND_PCT = 2;

/**
 * Below this many comparable syncs the capacity readout publishes NOTHING — not a mean, not
 * a verdict. One comparable sync is one observation of a rate that varies with cadence.
 */
export const MIN_COMPARABLE_SYNCS = 2;

/** Where a net flow of `netPct` percent of the open population puts the register. */
function verdictOf(netPct: number | null): CapacityVerdict {
  if (netPct === null || Math.abs(netPct) <= NET_CAPACITY_BAND_PCT) return "keeping-up";
  return netPct > 0 ? "gaining" : "falling-behind";
}

export interface CapacityPoint {
  syncId: string;
  at: string;
  /** `new + reopened` — work ARRIVING in the open population. See the identity below. */
  opened: number;
  /** `resolved` — the ledger's disappearance-dated closures. */
  closed: number;
  /** `closed - opened`. Positive is ground gained. */
  net: number;
  /**
   * Whether this sync's two numbers can be compared with the one before it — see
   * `capacityFromLedgerDeltas`.
   */
  comparable: boolean;
  /**
   * Where this sync's net flow lands, or NULL when the sync is not comparable.
   *
   * Null rather than a verdict computed anyway. A sync that skipped disappearance-resolution
   * has an understated `closed` BY CONSTRUCTION, so its verdict would be biased toward
   * "falling behind" — and a verdict whose direction of error is known is worse than none,
   * because nothing on the surface would say so.
   */
  verdict: CapacityVerdict | null;
}

export interface Capacity {
  points: CapacityPoint[];
  overall: {
    /**
     * Mean close rate over the comparable syncs, in percent of the open population each
     * started with — `gas/`'s `mmcrMean` at sync grain rather than month grain. Null below
     * two comparable syncs.
     */
    mmcr: number | null;
    /** The verdict over the same syncs, or null when there are fewer than two. */
    verdict: CapacityVerdict | null;
    /** Syncs with a readable ledger delta — the denominator. */
    syncs: number;
    /** How many of them were comparable. The gap is the honest part of the readout. */
    comparable: number;
  };
}

/**
 * How much of the open issue population each sync closes, from the LEDGER's own transition
 * counts — remediation capacity, ported in shape from `gas/`'s `capacityByMonth`.
 *
 * WHAT IS PORTED AND WHAT IS NOT. The verdict shape is the port: three words, a named dead
 * band, and a null where the evidence is too thin. The DERIVATION is deliberately the
 * opposite of the sibling's. `gas/` refuses its scan deltas and buckets base rows by
 * calendar month, because there each row carries wall-clock `first_seen` / `resolved_at`
 * dates and the deltas carry no risk label. Here the ledger's deltas are the only lifecycle
 * record there is — `ai_issues` is overwritten every sync and holds no dates of its own — so
 * the sync IS the interval. That makes the cadence part of the metric, which is precisely
 * why the comparability rules below are not optional decoration.
 *
 * THE ACCOUNTING IDENTITY, which is why `opened` counts reopens. A reopened row re-enters the
 * open population exactly as a new one does, and with `openAtStart = carried + resolved`:
 *
 *     openAtEnd = openAtStart + opened - closed
 *               = (carried + resolved) + (new + reopened) - resolved
 *               = carried + new + reopened
 *
 * which is the open population this sync ends with. Counting reopens as anything else breaks
 * that identity, and a capacity figure that does not balance is a figure nobody can check.
 *
 * WHAT MAKES A SYNC INCOMPARABLE — three cases, all of them "this number answers a different
 * question", never "this number is missing":
 *
 *   1. `skippedNarrowedScope > 0`. The scope moved, so this sync deliberately resolved
 *      nothing by absence: `closed` is understated by an amount nobody can recover.
 *   2. `register_scope` differs from the previous row's, in EITHER direction. A count taken
 *      over six categories is not comparable with one taken over one.
 *   3. THE FIRST POINT, always. Its `new` is the entire register arriving at once, and there
 *      is no previous row to compare its scope against. Unknown is not "same" — the same rule
 *      `reconcileIssueLedger` follows when no previous committed scope exists, and the same
 *      reason `gas/` drops its earliest flat scan from the cross-check.
 *
 * An incomparable sync is still PLOTTED — it happened, and its opened/closed are what the
 * ledger recorded — it is simply excluded from the mean and counted in `overall.comparable`
 * so the readout can say how many of its syncs it could actually use.
 */
export function capacityFromLedgerDeltas(rows: Rec[], limit = 90): Capacity {
  interface Raw {
    syncId: string;
    at: string;
    scope: string;
    opened: number;
    closed: number;
    openAtStart: number;
    skipped: number;
  }
  const raw: Raw[] = [];
  for (const r of rows) {
    if (String(r["status"] ?? "") !== "SUCCESS") continue;
    const counts = parseCounts(r["ledger_json"], [
      "new", "resolved", "reopened", "carried", "skippedNarrowedScope",
    ] as const);
    if (!counts) continue; // a sync recorded before the ledger existed: absent, not zero
    // `||` not `??`, for the reason `readTrend` uses it: an empty sheet cell reads as null
    // here and as "" everywhere else, and both mean "fall back to the start".
    const at = String(r["finished_at"] || r["started_at"] || "");
    if (!at) continue;
    // Widened to a string map: the five keys are a literal tuple above, and naming each one
    // again in the reads below buys nothing but five more places to misspell one.
    const c = counts as Record<string, number | null>;
    const n = (k: string): number => Number(c[k] ?? 0);
    raw.push({
      syncId: String(r["sync_id"] ?? ""),
      at,
      // "" is UNKNOWN, never "the same scope as the row beside it" — see case 2 above.
      scope: String(r["register_scope"] ?? ""),
      opened: n("new") + n("reopened"),
      closed: n("resolved"),
      openAtStart: n("carried") + n("resolved"),
      skipped: n("skippedNarrowedScope"),
    });
  }
  raw.sort(cmpBy((p) => p.at));

  const points: CapacityPoint[] = [];
  let comparableCount = 0;
  const rates: number[] = [];
  const netPcts: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]!;
    const prev = i > 0 ? raw[i - 1] : null;
    const comparable = Boolean(
      prev && cur.skipped === 0 && cur.scope !== "" && prev.scope !== "" && cur.scope === prev.scope,
    );
    const netPct = cur.openAtStart > 0 ? ((cur.closed - cur.opened) / cur.openAtStart) * 100 : null;
    if (comparable) {
      comparableCount += 1;
      if (cur.openAtStart > 0) {
        rates.push((cur.closed / cur.openAtStart) * 100);
        netPcts.push(netPct ?? 0);
      }
    }
    points.push({
      syncId: cur.syncId,
      at: cur.at,
      opened: cur.opened,
      closed: cur.closed,
      net: cur.closed - cur.opened,
      comparable,
      verdict: comparable ? verdictOf(netPct) : null,
    });
  }

  // THE THRESHOLD IS ON THE RATES, NOT ON THE COMPARABLE SYNCS, and the difference showed up
  // as a failing test rather than as an argument: a register whose first two comparable syncs
  // started with nothing open yields ONE rate, and the earlier gate
  // (`comparableCount >= 2 && rates.length > 0`) published a "mean" of that single
  // observation while the readout beside it said two syncs were comparable. A sync with no
  // open population at its start has no close rate to contribute, so it cannot be one of the
  // two the mean is entitled to.
  const enough = rates.length >= MIN_COMPARABLE_SYNCS;
  const mean = (xs: number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;
  const trimmed = limit > 0 && points.length > limit
    ? points.slice(points.length - limit)
    : points;
  return {
    points: trimmed,
    overall: {
      mmcr: enough ? mean(rates) : null,
      verdict: enough ? verdictOf(mean(netPcts)) : null,
      syncs: points.length,
      comparable: comparableCount,
    },
  };
}


// --------------------------------------------------- the four series as one payload field

/**
 * A category as the chart labels it: the stored id, and the name if this build knows one.
 *
 * `CANDIDATE_CATEGORIES` is a CANDIDATE LIST and not a permitted set (registerScope.ts), so
 * an id outside it is a legitimate scope this tenant chose and the id itself is the label.
 * Falling back to the id rather than to "Unknown" keeps the line identifiable — an operator
 * who pasted a UUID into the setting can still find their own series.
 */
export interface TrendCategory {
  id: string;
  name: string;
}

export function labelCategories(ids: readonly string[]): TrendCategory[] {
  return ids.map((id) => {
    const known = CANDIDATE_CATEGORIES.filter((c) => c.id === id)[0];
    return { id, name: known ? known.name : id };
  });
}

/**
 * Everything "Posture over time" draws, assembled once so the page ships one field rather
 * than four endpoints.
 *
 * REGISTER-WIDE, deliberately, and the chart says so. `project_totals_json` carries the AARS
 * and outcome distributions per project and nothing else — there is no adjacency,
 * exploitation, category or ledger grain in it, and one cannot be backfilled into rows that
 * never held it. A scoped read of these specs would therefore find nothing on every row and
 * draw an empty chart under a project filter, which reads as "this project has no posture"
 * rather than "the ledger never held the dimension".
 */
export interface PostureTrend {
  adjacency: AdjacencyTrendPoint[];
  exploitation: ExploitationTrendPoint[];
  /** The vocabulary the category series is drawn over — the scope the register holds NOW. */
  categories: TrendCategory[];
  categoryPoints: SparseTrendPoint<string>[];
  ledger: LedgerTrendPoint[];
  capacity: Capacity;
}

export function postureTrendFromHistory(
  rows: Rec[], categoryIds: readonly string[], limit = 90,
): PostureTrend {
  return {
    adjacency: adjacencyTrendFromHistory(rows, limit),
    exploitation: exploitationTrendFromHistory(rows, limit),
    categories: labelCategories(categoryIds),
    categoryPoints: categoryTrendFromHistory(rows, categoryIds, limit),
    ledger: ledgerTrendFromHistory(rows, limit),
    capacity: capacityFromLedgerDeltas(rows, limit),
  };
}
