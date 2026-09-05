// P2P v5's asset-centric family: how many assets are in scope at all, how dense a typical one
// is, what share of them offer a foothold, how well the high-risk ones are covered, how fast a
// finding dies on this kind of asset, and how many assets are falling behind.
//
// D6 work package. Port of brick/devsecops/metrics.py:1257-1486 — `_asset_group`,
// `_with_assets`, `_per_asset`, `_asset_aggs`, `asset_profile`, `_asset_half_life` and
// `asset_profile_populations`. The 17 published columns are `panels.py:1542-1547`
// (`OUTPUT_COLUMNS["asset_profile"]`), spelled here exactly as brick spells them so the
// fixture compare is a plain field-by-field equality; the mapping table lives in
// test/assets.test.ts.
//
// Second oracle: test/fixtures/brick/asset_profile.json — two cases (`observed_from_none`,
// `observed_from_set`) produced by running the real PySpark transforms
// (brick/devsecops/export_fixtures.py:566-600) over 13 literal rows.
//
// THE ASSET HERE IS A REPOSITORY. brick's frame calls the column `asset_id`; this register's
// ledger calls it `repo_id` (ledgerTypes.ts's rename table). `language` keeps its name.
//
// Pure: no clock (`now` is an option), no I/O, no persistence.
//
// WHAT THE COLUMNS REFUSE TO SAY, and why that is the point:
//   * `observedFrom === null` ⇒ `window_months`, `mmcr_p50` and all three capacity shares are
//     NULL, never 0. Every one of them is a rate per unit of WATCHED time; a register that has
//     not recorded when it started watching cannot produce one (brick's own docstring on
//     `asset_profile`, and the same refusal `capacity_by_month` makes).
//   * An asset with no high-risk finding at all has NULL coverage, not 0% — `safe_pct` over an
//     empty denominator (metrics.py:179-185). 0% coverage and "nothing to remediate" are not
//     the same fact, and a median that swallowed the second would be dragged down by assets
//     that had no work to do.
//   * Findings with no asset are DROPPED AND COUNTED (`droppedNoAsset`). brick drops them
//     silently in `_with_assets`; a zero has to prove it looked, so the count is published.
//   * Density is p25/p50/p75, never a mean — v5 Fig. 10's distribution is far too skewed
//     ("many with <10 but some >1000") for a mean to describe.

import {
  ASSET_GROUP_UNKNOWN,
  NET_CAPACITY_BAND_PCT,
  OVERALL,
  POPULATION_ALL,
  POPULATION_HIGH_RISK,
  RESOLVED_STATUSES,
} from "./config";
import type { BaseRow } from "./ledgerTypes";
import {
  classifyRisk,
  type AnyRiskRule,
  type CapacityVerdict,
  type RiskClass,
  type RiskRow,
} from "./program";
import { kaplanMeier, type RemediationRow } from "./remediation";
import { parseTs, quantile } from "./util";

const DAY_MS = 86_400_000;

/**
 * The mean Gregorian month, in days. brick/devsecops/metrics.py:1428 divides by
 * `SECONDS_PER_DAY * 30.4375`; 30.4375 = 365.25/12, so a window is measured in mean months
 * rather than in whatever calendar months it happens to straddle.
 */
const DAYS_PER_MONTH = 30.4375;

// --------------------------------------------------------------------------- input shape

/** How the assets are bucketed on the page. */
export type AssetGroupBy = "language" | "repo";

/**
 * The projection this module reads. A `BaseRow` satisfies it structurally, which is the
 * intended input; the narrow type is here so a test (or a page) can build one without
 * inventing 39 ledger columns.
 *
 * `RiskRow` rides along because `risk_class` is not a stored column in this register —
 * DIVERGENCE from brick, whose `asset_profile` *reads* a `risk_class` its caller already
 * computed ("Expects the lifecycle frame with `risk_class` -- run `classify_risk` first").
 * Here it is derived per row by `program.classifyRisk`, so the profile and the confusion
 * matrix cannot disagree about what "high" means.
 */
export type AssetRow = RiskRow &
  Pick<
    BaseRow,
    "repo_id" | "repo_name" | "language" | "first_seen" | "resolved_at" | "mttr_days" | "age_days"
  >;

export interface AssetProfileOptions {
  /** brick groups on `language` (the fixture pins that); `repo` gives the repos page one row
   *  per repository, carrying `repo_name` in `asset_label` for display. Default `language`. */
  groupBy?: AssetGroupBy;
  /**
   * The earliest scan on record — when this register started WATCHING. `null` is a legitimate,
   * explicit answer ("we do not know"), and it makes `window_months`, `mmcr_p50` and the three
   * capacity shares null. There is no default: a clock has to say where it started.
   */
  observedFrom: string | number | Date | null;
  /** The evaluation instant. An option, never `Date.now()` — this module is pure. */
  now: string | number | Date;
  /** Omit to let each row's scope choose its classifier (`config.ruleForScope`). */
  rule?: AnyRiskRule;
  /** Restrict to high-risk findings — brick's `high_risk_only`. Default false. */
  highRiskOnly?: boolean;
}

// --------------------------------------------------------------------------- output shape

/**
 * One published row. The first 17 fields are `OUTPUT_COLUMNS["asset_profile"]` verbatim
 * (panels.py:1542-1547) plus `population`, which `asset_profile` itself stamps on
 * (metrics.py:1444-1447). `asset_label` is this port's only addition and is null unless
 * `groupBy: "repo"`.
 */
export interface AssetProfileRow {
  /** The asset category: the language, the repo id, or `OVERALL`. NULL folds to `UNKNOWN`. */
  asset_group: string;
  /** How many assets are in this group at all — v5 p.7's asset prevalence. */
  assets: number;
  /** Total OPEN findings across those assets (the sum the density percentiles describe). */
  open_findings: number;
  density_p25: number | null;
  density_p50: number | null;
  density_p75: number | null;
  /** v5 Fig. 11 — share of assets with >= 1 OPEN high-risk finding ("just one opening"). */
  assets_with_high_risk_pct: number | null;
  /** Assets with any high-risk finding at all, i.e. with a defined coverage. */
  assets_with_high_risk: number;
  /** Median per-asset remediation coverage, over the assets that had something to cover. */
  asset_coverage_p50: number | null;
  /** v5 Fig. 15 — the half-life of a finding on this kind of asset (Kaplan-Meier median). */
  km_median_days: number | null;
  /** Published INSTEAD of a median when the curve never reaches half: "> X d", not a number. */
  km_median_lower_bound: number | null;
  /** v5 Fig. 20 — median per-asset monthly close rate. Null without an observation window. */
  mmcr_p50: number | null;
  /** v5 Fig. 21, three shares over the assets with a defined net flow; they sum to 100. */
  falling_behind_pct: number | null;
  maintaining_pct: number | null;
  gaining_pct: number | null;
  /** How many assets had a defined net flow — the denominator of the three shares above. */
  assets_flowing: number;
  /** How little (or much) time the rate columns rest on. Null without an observation window. */
  window_months: number | null;
  /** `all` or `high_risk` — EVERY read of a stacked profile must filter on this. */
  population: string;
  /** Display name for the group. `repo_name` under `groupBy: "repo"`; null otherwise. */
  asset_label: string | null;
}

export interface AssetProfileResult {
  rows: AssetProfileRow[];
  population: string;
  groupBy: AssetGroupBy;
  windowMonths: number | null;
  /**
   * Findings dropped because they belong to no asset (null / blank `repo_id`). brick's
   * `_with_assets` drops them silently; counted here so an empty table can prove it looked.
   * Counted AFTER the high-risk filter, matching brick's order (metrics.py:1410-1416).
   */
  droppedNoAsset: number;
  /**
   * `secrets` rows that were NOT classified. `program.classifyRisk` refuses that scope by
   * design (there is no exploit intelligence for a hardcoded string, and severity there grades
   * a DETECTION), so they are counted, carried at `risk_class = "unknown"`, and can therefore
   * never be a foothold, never enter a coverage denominator, and never survive the high-risk
   * filter. They still count toward density and `open_findings`: a leaked credential is a real
   * open finding on that repository.
   */
  unclassifiedSecrets: number;
}

export interface AssetProfilePopulations {
  all: AssetProfileResult;
  highRisk: AssetProfileResult;
  /** The two stacked, `all` first — brick's `unionByName` in `asset_profile_populations`. */
  rows: AssetProfileRow[];
}

// --------------------------------------------------------------------------- small helpers

/** Same open/resolved test the rest of the domain uses (brick `metrics.is_open`). */
function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

/**
 * `numerator / denominator * 100`, or NULL when there is nothing to divide by.
 * Port of metrics.py:179-185. NULL, never 0 — a rate over an empty population is unknown,
 * and rendering it as 0% is a lie the reader cannot detect.
 */
function safePct(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

/**
 * gaining / keeping-up / falling-behind with a dead band around zero — metrics.py:1171-1181.
 *
 * A private copy of `program.ts`'s `verdictOf`, which is not exported. Both read the SAME
 * `NET_CAPACITY_BAND_PCT` from config.ts, so the band cannot drift between the monthly
 * capacity table and this one; only the plumbing is duplicated.
 */
function verdictOf(netPct: number): CapacityVerdict {
  if (Math.abs(netPct) <= NET_CAPACITY_BAND_PCT) return "keeping-up";
  return netPct > 0 ? "gaining" : "falling-behind";
}

/** True for null / undefined / whitespace-only. */
function blank(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

/**
 * The asset category, with an absent value folded into one named group — metrics.py:1257-1266.
 * "A NULL language ... on a page they are all 'we do not know', and one named group says so
 * where a NULL silently drops the row out of a groupBy."
 *
 * DIVERGENCE: `_asset_group` is `coalesce(language, 'UNKNOWN')`, which folds NULL only and
 * would leave `""` sitting beside UNKNOWN as a second, unlabelled group. brick avoids that
 * upstream instead — `_language_of` (metrics.py:~300) maps an empty array to NULL "because
 * '' would sit beside it as a second one". This port owns both ends of that chain, so the
 * blank fold happens here; the end-to-end behaviour is brick's, the single function's is not.
 */
function assetGroupOf(value: unknown): string {
  return blank(value) ? ASSET_GROUP_UNKNOWN : String(value);
}

// --------------------------------------------------------------------------- per asset

/** One row per asset: its density, its foothold, its coverage and its net flow. */
interface PerAsset {
  assetId: string;
  group: string;
  label: string | null;
  /** Open findings on this asset. */
  density: number;
  /** >= 1 OPEN high-risk finding. */
  hasFoothold: boolean;
  /** High-risk and closed. */
  tp: number;
  /** High-risk and still open. */
  fn: number;
  opened: number | null;
  closed: number | null;
  openAtStart: number | null;
  coveragePct: number | null;
  netPct: number | null;
  verdict: CapacityVerdict | null;
}

interface Classified {
  row: AssetRow;
  risk: RiskClass;
}

/**
 * `_per_asset` (metrics.py:1283-1338). Groups on (asset id, asset group) exactly as brick
 * does — an asset whose findings report two languages is therefore TWO per-asset rows, and is
 * counted twice in OVERALL. That is brick's shape, kept rather than quietly deduplicated.
 */
function perAsset(rows: Classified[], windowStart: number | null, groupBy: AssetGroupBy): PerAsset[] {
  const byKey = new Map<string, PerAsset>();
  for (const { row, risk } of rows) {
    const assetId = String(row.repo_id).trim();
    const group = groupBy === "repo" ? assetId : assetGroupOf(row.language);
    const key = assetId + " " + group;
    let a = byKey.get(key);
    if (!a) {
      a = {
        assetId,
        group,
        label: null,
        density: 0,
        hasFoothold: false,
        tp: 0,
        fn: 0,
        opened: windowStart === null ? null : 0,
        closed: windowStart === null ? null : 0,
        openAtStart: windowStart === null ? null : 0,
        coveragePct: null,
        netPct: null,
        verdict: null,
      };
      byKey.set(key, a);
    }
    if (a.label === null && !blank(row.repo_name)) a.label = String(row.repo_name);

    const open = isOpen(row.status);
    const high = risk === "high";
    if (open) a.density += 1;
    if (high && open) {
      a.hasFoothold = true;
      a.fn += 1;
    }
    if (high && !open) a.tp += 1;

    if (windowStart !== null) {
      // A NULL timestamp makes the comparison NULL in Spark, which `.otherwise(0)` counts as
      // zero — the same thing these guards do.
      const firstMs = parseTs(row.first_seen);
      const resolvedMs = parseTs(row.resolved_at);
      if (firstMs !== null && firstMs >= windowStart) a.opened! += 1;
      if (resolvedMs !== null && resolvedMs >= windowStart) a.closed! += 1;
      if (firstMs !== null && firstMs < windowStart && (resolvedMs === null || resolvedMs >= windowStart)) {
        a.openAtStart! += 1;
      }
    }
  }

  for (const a of byKey.values()) {
    a.coveragePct = safePct(a.tp, a.tp + a.fn);
    a.netPct = a.closed === null || a.opened === null ? null : safePct(a.closed - a.opened, a.openAtStart);
    a.verdict = a.netPct === null ? null : verdictOf(a.netPct);
  }
  return [...byKey.values()];
}

// --------------------------------------------------------------------------- aggregation

/** `_asset_aggs` (metrics.py:1341-1394), shared by the per-group and OVERALL passes. */
function aggregate(
  group: string,
  label: string | null,
  assets: PerAsset[],
  windowMonths: number | null,
  population: string,
  km: { median: number | null; medianLowerBound: number | null },
): AssetProfileRow {
  const densities = assets.map((a) => a.density);
  const coverages: number[] = [];
  for (const a of assets) if (a.coveragePct !== null) coverages.push(a.coveragePct);

  // v5 Fig. 20's per-asset monthly close rate: closed/openAtStart as a percentage, then per
  // month of the window. NULL for an asset with no pre-window backlog, and NULL for every
  // asset when the window itself is unknown — a percentile skips those, exactly as
  // `F.percentile` skips NULLs.
  const mmcr: number[] = [];
  if (windowMonths !== null) {
    for (const a of assets) {
      const rate = safePct(a.closed, a.openAtStart);
      if (rate !== null) mmcr.push(rate / windowMonths);
    }
  }

  let footholds = 0;
  let flowing = 0;
  let fallingBehind = 0;
  let maintaining = 0;
  let gaining = 0;
  for (const a of assets) {
    if (a.hasFoothold) footholds += 1;
    if (a.verdict === null) continue;
    flowing += 1;
    if (a.verdict === "falling-behind") fallingBehind += 1;
    else if (a.verdict === "keeping-up") maintaining += 1;
    else gaining += 1;
  }

  return {
    asset_group: group,
    assets: assets.length,
    open_findings: densities.reduce((s, d) => s + d, 0),
    density_p25: quantile(densities, 0.25),
    density_p50: quantile(densities, 0.5),
    density_p75: quantile(densities, 0.75),
    assets_with_high_risk_pct: safePct(footholds, assets.length),
    assets_with_high_risk: coverages.length,
    asset_coverage_p50: quantile(coverages, 0.5),
    km_median_days: km.median,
    km_median_lower_bound: km.medianLowerBound,
    mmcr_p50: quantile(mmcr, 0.5),
    falling_behind_pct: safePct(fallingBehind, flowing),
    maintaining_pct: safePct(maintaining, flowing),
    gaining_pct: safePct(gaining, flowing),
    assets_flowing: flowing,
    window_months: windowMonths,
    population,
    asset_label: label,
  };
}

/**
 * `_asset_half_life` (metrics.py:1450-1467): `km_median_days` per asset category and for
 * OVERALL, computed by the SAME estimator the MTTR family publishes so the two cannot
 * disagree about what a median is. Events are resolved rows at `mttr_days`; open rows are
 * right-censored at `age_days`.
 *
 * DIVERGENCE (inherited, not introduced): brick's `km_curve` censors on
 * `coalesce(mttr_days, age_days)` and never reads a status, while `remediation.kaplanMeier`
 * gates the censored branch on the row being OPEN. The two differ for exactly one shape —
 * status-resolved, no `mttr_days`, but carrying an `age_days` — which neither ledger
 * produces: brick's `_with_durations` (metrics.py:317-322) writes `age_days` only where
 * `resolved_at` is NULL. Pinned in test/assets.test.ts.
 */
function halfLife(group: string, rows: AssetRow[]): { median: number | null; medianLowerBound: number | null } {
  const projection: RemediationRow[] = rows.map((r) => ({
    severity: group,
    status: r.status,
    mttr_days: r.mttr_days,
    age_days: r.age_days,
  }));
  const km = kaplanMeier(projection);
  return { median: km.median, medianLowerBound: km.medianLowerBound };
}

// --------------------------------------------------------------------------- the entry point

/**
 * P2P v5's asset-centric family, one row per asset category plus an OVERALL row.
 *
 * `window_months` — and this is the one number the brief for this package got wrong, so it is
 * spelled out: metrics.py:1424-1432 is
 *
 *     months        = (unix(now) - unix(observed_from)) / (SECONDS_PER_DAY * 30.4375)
 *     window_months = greatest(months, 1.0)
 *
 * There is **no `floor`**. It is a continuous count of mean months clamped at one, and the
 * fixture proves it: `observed_from_set` spans 2025-11-01 → 2026-08-01 = 273 days and reports
 * `window_months = 8.969199178644764`, not 8. The clamp exists because "a window shorter than
 * a month would divide a month's throughput by a fraction and report a rate nobody could have
 * achieved"; the value is published so a reader can see how little time the rate rests on.
 */
export function assetProfile(rows: AssetRow[], opts: AssetProfileOptions): AssetProfileResult {
  const groupBy: AssetGroupBy = opts.groupBy ?? "language";
  const highRiskOnly = opts.highRiskOnly === true;
  const population = highRiskOnly ? POPULATION_HIGH_RISK : POPULATION_ALL;

  // DIVERGENCE: an unparseable `now` / `observedFrom` REFUSES here. Spark would cast it to
  // NULL, and `greatest(NULL, 1.0)` skips nulls — so a typo in a timestamp would silently
  // publish `window_months = 1.0` and every rate scaled by it. That is the failure that does
  // not announce itself; this one does.
  const nowMs = parseTs(opts.now);
  if (nowMs === null) {
    throw new Error(`assetProfile: unparseable now (${JSON.stringify(opts.now)})`);
  }
  const observedFrom = opts.observedFrom ?? null;
  const windowStart = observedFrom === null ? null : parseTs(observedFrom);
  if (observedFrom !== null && windowStart === null) {
    throw new Error(`assetProfile: unparseable observedFrom (${JSON.stringify(observedFrom)})`);
  }
  const windowMonths =
    windowStart === null ? null : Math.max((nowMs - windowStart) / (DAY_MS * DAYS_PER_MONTH), 1);

  // Classify once. `secrets` is refused by program.ts and carried as `unknown` rather than
  // thrown on — see `unclassifiedSecrets`.
  let unclassifiedSecrets = 0;
  const classified: Classified[] = [];
  for (const row of rows) {
    if (row.scope === "secrets") {
      unclassifiedSecrets += 1;
      classified.push({ row, risk: "unknown" });
      continue;
    }
    classified.push({ row, risk: classifyRisk(row, opts.rule) });
  }

  // brick's order: the population filter first, then `_with_assets` (metrics.py:1410-1416).
  // Both halves — the aggregates and the half-life — must read the SAME population, "otherwise
  // a group's density is computed over its repositories while its half-life is computed over
  // those plus every asset-less finding that happens to share the ecosystem".
  const population_ = highRiskOnly ? classified.filter((c) => c.risk === "high") : classified;
  let droppedNoAsset = 0;
  const kept: Classified[] = [];
  for (const c of population_) {
    if (blank(c.row.repo_id)) {
      droppedNoAsset += 1;
      continue;
    }
    kept.push(c);
  }

  const assets = perAsset(kept, windowStart, groupBy);

  // Group the ASSETS for the aggregates and the FINDINGS for the half-life — brick computes
  // the two over the same rows but at different grains.
  const assetsByGroup = new Map<string, PerAsset[]>();
  const labelByGroup = new Map<string, string | null>();
  for (const a of assets) {
    const list = assetsByGroup.get(a.group);
    if (list) list.push(a);
    else assetsByGroup.set(a.group, [a]);
    if (groupBy === "repo" && !labelByGroup.get(a.group)) labelByGroup.set(a.group, a.label);
  }
  const findingsByGroup = new Map<string, AssetRow[]>();
  for (const { row } of kept) {
    const g = groupBy === "repo" ? String(row.repo_id).trim() : assetGroupOf(row.language);
    const list = findingsByGroup.get(g);
    if (list) list.push(row);
    else findingsByGroup.set(g, [row]);
  }
  const allFindings = kept.map((c) => c.row);

  const out: AssetProfileRow[] = [];
  for (const [group, list] of assetsByGroup) {
    out.push(
      aggregate(
        group,
        groupBy === "repo" ? labelByGroup.get(group) ?? null : null,
        list,
        windowMonths,
        population,
        halfLife(group, findingsByGroup.get(group) ?? []),
      ),
    );
  }
  out.push(aggregate(OVERALL, null, assets, windowMonths, population, halfLife(OVERALL, allFindings)));

  // panels.py:1284 publishes OVERALL first, then `assets DESC`.
  // DIVERGENCE: a name tie-break is added, because that SQL leaves ties in whatever order the
  // shuffle produced and a table nobody can diff is a table nobody can trend.
  out.sort((a, b) => {
    if (a.asset_group === OVERALL) return b.asset_group === OVERALL ? 0 : -1;
    if (b.asset_group === OVERALL) return 1;
    if (a.assets !== b.assets) return b.assets - a.assets;
    return a.asset_group < b.asset_group ? -1 : a.asset_group > b.asset_group ? 1 : 0;
  });

  return { rows: out, population, groupBy, windowMonths, droppedNoAsset, unclassifiedSecrets };
}

/**
 * `asset_profile` over BOTH populations, stacked and tagged — `asset_profile_populations`
 * (metrics.py:1470-1481). `all` answers "how much does a typical repository carry"; `high_risk`
 * answers the question v5 actually asks about remediation. The two routinely disagree, and
 * which one an unlabelled number meant is not recoverable afterwards, so **every read of
 * `rows` must filter on `population`.**
 */
export function assetProfilePopulations(
  rows: AssetRow[],
  opts: AssetProfileOptions,
): AssetProfilePopulations {
  const all = assetProfile(rows, { ...opts, highRiskOnly: false });
  const highRisk = assetProfile(rows, { ...opts, highRiskOnly: true });
  return { all, highRisk, rows: all.rows.concat(highRisk.rows) };
}
