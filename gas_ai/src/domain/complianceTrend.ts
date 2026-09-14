// Compliance posture OVER TIME — the framework percentage and the mean across frameworks,
// one point per successful sync.
//
// WHY A NEW COLUMN RATHER THAN A DERIVATION. Nothing stored can be re-read as history. The
// `framework_posture` tab is overwritten wholesale on every commit (syncStore's own note on
// the guarded write), so it holds exactly one reading — today's — and a percentage Wiz
// computed for a framework last month exists nowhere in this sheet. `posture_fail_count`
// beside it counts FAILING POLICIES, which is a different quantity on a different scale and
// moves when a control is added as readily as when one starts passing. So the series is
// recorded going forward, one cell per sync, and cannot be backfilled — the same contract
// `aarsTrend.ts` states for every column it reads.
//
// ABSENT IS NEVER ZERO, twice over. A sync recorded before this column existed has no cell
// and contributes NO POINT (a 0% compliance reading for every framework, on every sync
// before the day we started recording, is the exact cliff that would be read as a landscape
// that improved). And within a cell, a framework Wiz did not score carries `pct: null` —
// NO_RESOURCES and NO_POLICIES are the opposite of "we checked and everything failed", the
// one invariant the whole Compliance page is built on (compliancePosture.ts POSTURE_STATES)
// — so the line breaks at that sync rather than dropping to the floor.
//
// THE COVERAGE TRAVELS WITH THE PERCENTAGE, and that is what this module exists to make
// impossible to lose. A framework percentage is a share of the subcategories Wiz SCORED,
// and the ones it did not score are left out rather than counted as failures. So a rising
// line can mean the landscape improved OR that Wiz stopped scoring the subcategories that
// were failing, and the two are indistinguishable from the percentage alone. Every point
// therefore carries `scored of subcategories` beside its value — the counts the posture
// strip used to publish for the latest sync only, now published for every sync in the
// window. Same discipline as `AdjacencyCensus.edgesKnown`: publish the denominator with the
// figure or publish neither.

import type { FrameworkTree, PostureState } from "./compliancePosture";
import type { Rec } from "./util";
import { cmpBy } from "./util";

/**
 * The `sync_history` column holding every framework's posture for one sync.
 *
 * One cell, not one column per framework: the framework set is a tenant setting that moves,
 * and a column per framework would need a migration every time somebody selected a new one.
 * Appended under the same no-migration contract as every column around it — a row written
 * before it exists simply has no cell, which `compliancePostureTrendFromHistory` reports as
 * "no point" rather than as a landscape at zero.
 */
export const COMPLIANCE_POSTURE_COLUMN = "compliance_posture_json";

/**
 * A Sheets cell holds 50,000 characters. Past this the encode REFUSES rather than writes a
 * value the sheet would reject or clip — the same cap and the same reasoning as
 * `PROJECT_TOTALS_MAX_CHARS`. An entry is ~60 characters and a tenant collects frameworks in
 * the tens, so this is insurance rather than a live constraint; what it buys is that a trend
 * refinement can never fail a commit.
 */
export const COMPLIANCE_POSTURE_MAX_CHARS = 45_000;

/**
 * The series key for the cross-framework mean — the Overview hero's own number, over time.
 *
 * A reserved key rather than a framework id, and `__` is what reserves it: Wiz framework ids
 * are `wf-id-NNN`, so no real framework can collide with this, and a reader of the raw cell
 * can see at a glance which entry is not a framework.
 */
export const LANDSCAPE_KEY = "__landscape";

/** What a percentage is a share OF — carried beside it on every point. See the header. */
export interface PostureCoverage {
  /** Subcategories Wiz scored — the percentage's population. */
  scored: number;
  /** Subcategories Wiz REPORTED, scored or not — the honest denominator. */
  subcategories: number;
  /**
   * Frameworks the mean averaged. Present on the landscape entry only, where it is the
   * denominator that matters most: a mean over one scored framework and a mean over nine
   * are not the same claim, and the Overview hero already says so for the latest sync.
   */
  scoredFrameworks?: number;
}

/** One framework's reading at one sync. */
export interface FrameworkPostureAtSync {
  /** Wiz's own framework percentage, or null where it scored nothing. Never 0 for absent. */
  pct: number | null;
  scored: number;
  subcategories: number;
}

/** Every framework's posture at one sync — the value side of `COMPLIANCE_POSTURE_COLUMN`. */
export interface CompliancePostureCensus {
  /**
   * The mean over SCORED frameworks, by `complianceKpis.averagePosture`'s definition and
   * rounded the same way. Computed here rather than summed at read time so the stored point
   * and the hero above it can never come from two arithmetics; null when nothing scored.
   */
  avg: number | null;
  scoredFrameworks: number;
  frameworks: Record<string, FrameworkPostureAtSync>;
}

const STATE_KEYS: readonly PostureState[] = ["scored", "noResources", "noPolicies", "unknown"];

/** Subcategories this tree's states account for — scored and unscored alike. */
function subcategoryCount(tree: FrameworkTree): number {
  return STATE_KEYS.reduce((sum, k) => sum + (tree.stateCounts[k] || 0), 0);
}

/**
 * The trees this sync built → the cell it records.
 *
 * Counted off the TREES rather than the raw posture rows, so this census and the page's own
 * figures are two readings of one construction. `tree.state === "scored"` is the same
 * predicate `complianceKpis` applies to the framework rows (both route through
 * `postureState`), which is what makes `avg` here and `averagePosture` there the same number
 * rather than two that merely usually agree.
 */
export function censusCompliancePosture(
  trees: ReadonlyArray<FrameworkTree>,
): CompliancePostureCensus {
  const frameworks: Record<string, FrameworkPostureAtSync> = {};
  const scoredPcts: number[] = [];
  for (const tree of trees) {
    const scored = tree.state === "scored" && tree.posturePct !== null;
    if (scored) scoredPcts.push(tree.posturePct as number);
    frameworks[tree.frameworkId] = {
      pct: scored ? (tree.posturePct as number) : null,
      scored: tree.stateCounts.scored || 0,
      subcategories: subcategoryCount(tree),
    };
  }
  return {
    avg: scoredPcts.length
      ? Math.round(scoredPcts.reduce((sum, p) => sum + p, 0) / scoredPcts.length)
      : null,
    scoredFrameworks: scoredPcts.length,
    frameworks,
  };
}

/**
 * The census as a cell, or null when it would not fit.
 *
 * Null is a value this row is allowed to carry, exactly as `encodeProjectTotals`' is: the
 * other columns are unaffected, and a trend with a missing point says so rather than
 * inventing one. A chart must never be able to fail a commit.
 */
export function encodeCompliancePosture(census: CompliancePostureCensus): string | null {
  const json = JSON.stringify(census);
  return json.length > COMPLIANCE_POSTURE_MAX_CHARS ? null : json;
}

/**
 * One point on the compliance trend.
 *
 * `counts` is the shape the client's `valueAt`/`presentSeries`/`seriesData` already read
 * (`client/js/postureTrendModel.js`) — keyed by series, null for "no reading here" — so the
 * card draws through the same three helpers every other trend on this app draws through,
 * and a gap is a gap by the same rule everywhere. The values are PERCENTAGES rather than
 * counts; the field keeps its name because the shape, not the unit, is what the helpers are
 * written against.
 */
export interface CompliancePostureTrendPoint {
  at: string;
  /** Percentage per series key: a framework id, or `LANDSCAPE_KEY` for the mean. */
  counts: Record<string, number | null>;
  /** What each of those percentages is a share of. Keyed identically to `counts`. */
  coverage: Record<string, PostureCoverage>;
}

/** A cell value as a whole number in 0..100, or null. Rejects a negative or a NaN outright. */
function cellPct(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n);
}

/** A cell value as a count, or 0. Coverage is a denominator; an unreadable one is no count. */
function cellCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function parseCensus(v: unknown): CompliancePostureCensus | null {
  if (typeof v !== "string" || !v) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Rec;
  const rawFrameworks = raw["frameworks"];
  if (!rawFrameworks || typeof rawFrameworks !== "object" || Array.isArray(rawFrameworks)) {
    return null;
  }
  const frameworks: Record<string, FrameworkPostureAtSync> = {};
  for (const id of Object.keys(rawFrameworks as Rec)) {
    const entry = (rawFrameworks as Rec)[id];
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Rec;
    frameworks[id] = {
      pct: cellPct(e["pct"]),
      scored: cellCount(e["scored"]),
      subcategories: cellCount(e["subcategories"]),
    };
  }
  return {
    avg: cellPct(raw["avg"]),
    scoredFrameworks: cellCount(raw["scoredFrameworks"]),
    frameworks,
  };
}

/**
 * `sync_history` rows → the compliance trend, newest last, at most `limit` points.
 *
 * A row contributes when it is a SUCCESS carrying a timestamp and a readable cell. A row
 * without the cell is skipped rather than plotted — see the header for why a zero there is
 * the one thing this series must never draw.
 *
 * REGISTER-WIDE, and the card says so. A posture row is keyed by framework / category /
 * subcategory and carries no asset id, so there is nothing on a history row to re-slice by
 * project; the live page re-asks Wiz for the project in view (api.ts `scopedPosture`) but
 * the past cannot be re-asked. Drawing the register's history under a project filter without
 * saying so would be the one reading this app forbids, so the note travels with the chart.
 */
export function compliancePostureTrendFromHistory(
  rows: Rec[], limit = 90,
): CompliancePostureTrendPoint[] {
  const points: CompliancePostureTrendPoint[] = [];
  for (const r of rows) {
    if (String(r["status"] ?? "") !== "SUCCESS") continue;
    const census = parseCensus(r[COMPLIANCE_POSTURE_COLUMN]);
    if (!census) continue; // pre-upgrade sync, or a sync that collected no posture
    // `||` not `??`, for the reason every other reader in this app uses it: an empty sheet
    // cell reads as null here and as "" elsewhere, and both mean "fall back to the start".
    const at = String(r["finished_at"] || r["started_at"] || "");
    if (!at) continue;
    const counts: Record<string, number | null> = { [LANDSCAPE_KEY]: census.avg };
    let scored = 0;
    let subcategories = 0;
    for (const id of Object.keys(census.frameworks)) {
      const entry = census.frameworks[id]!;
      counts[id] = entry.pct;
      scored += entry.scored;
      subcategories += entry.subcategories;
    }
    const coverage: Record<string, PostureCoverage> = {
      [LANDSCAPE_KEY]: { scored, subcategories, scoredFrameworks: census.scoredFrameworks },
    };
    for (const id of Object.keys(census.frameworks)) {
      const entry = census.frameworks[id]!;
      coverage[id] = { scored: entry.scored, subcategories: entry.subcategories };
    }
    points.push({ at, counts, coverage });
  }
  points.sort(cmpBy((p) => p.at));
  return limit > 0 && points.length > limit ? points.slice(points.length - limit) : points;
}
