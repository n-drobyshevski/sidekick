// What each page is actually SENT, as opposed to what its read-model contains.
//
// The page composes read-models built for the MTTR page, and that sharing is deliberate — both
// slices come from the same `cached()` entries, so exec→MTTR navigation at one scope lands warm
// and neither page pays a second compute. What was NOT deliberate is that exec also shipped
// those read-models whole: two thirds of the payload on the default landing page was serialized
// and sent on every load without anything reading it.
//
// The bulk is Kaplan–Meier curves. `KMResult.curve` carries one point per DISTINCT EVENT TIME,
// and `mttrData` builds two of them (`km` and the actionable-clock `kmActionable`), while the
// hero reads exactly two scalars off the first — `median` and `medianLowerBound`. That is a
// scaling problem, not a fixed cost: the curve grows with the number of distinct resolution
// times, so a register with thousands of closed lifecycles ships a far larger one than a small
// estate suggests. The trend series beneath the per-group split has the same character.
//
// PROJECTING RATHER THAN COMPUTING SOMETHING LEANER is the point. A separate slim read-model
// would have cut the compute too, but it would have cost the shared cache entry — exec and MTTR
// would each compute their own, and the warm hand-off between them would be gone. Projecting a
// cached result keeps every entry, and every sharing property, exactly as it was. What this
// saves is serialization and transfer, which is paid on EVERY load, warm or cold; the compute
// is paid once per scope and is already warmed for the unscoped view.
//
// Pure and separate from api.ts so the shape is pinned in node without standing up the server
// module graph — the same split pages/executive.js uses for its view functions.

import type { Rec } from "./util";

/**
 * The four numbers the hero paints, keeping `mttrData`'s nesting so the client reads them at
 * the paths it always has (`mttr.rowCount`, `mttr.overall.open`, `mttr.remediation.km.median`).
 *
 * `remediation` is left EMPTY rather than dropped when there is no KM result, because
 * `fmtKmMedian` distinguishes a missing estimate (renders "—") from a present one, and an
 * absent `remediation` and an absent `remediation.km` have to reach it the same way.
 */
export function execMttrSlice(mttr: unknown): Rec | null {
  if (!mttr || typeof mttr !== "object") return null;
  const m = mttr as Rec;
  const overall = (m["overall"] ?? {}) as Rec;
  const km = ((m["remediation"] ?? {}) as Rec)["km"] as Rec | undefined;
  return {
    rowCount: m["rowCount"],
    overall: { resolved: overall["resolved"], open: overall["open"] },
    remediation: km
      ? { km: { median: km["median"], medianLowerBound: km["medianLowerBound"] } }
      : {},
  };
}

/**
 * The per-group split reduced to the three columns the table draws, plus the `dimension` tag the
 * client relabels from. `trend` is dropped whole — the exec table has no chart under it.
 *
 * ONLY `group` SURVIVES, not the `domain` alias beside it. `mttrByDomainData` writes both
 * (`api.ts`: "Keep `domain` alongside the generic `group` label"), but the by-support-group
 * split writes only `group`, which is why every reader already goes through `group ?? domain`.
 * Shipping both would send each group's name twice for one of the two dimensions.
 *
 * ROWS ARE NOT CAPPED HERE, though the page draws five. How many rows are worth showing is a
 * presentation decision, and it already lives in `executiveByDomainView` where it is tested;
 * capping server-side too would put the same number in two places, free to drift. The cost is
 * bounded by the number of groups in the register rather than by the estate's size — a wide
 * register pays a few hundred bytes for rows it will not draw, which is the trade being made.
 */
export function execGroupSlice(byGroup: unknown): Rec | null {
  if (!byGroup || typeof byGroup !== "object") return null;
  const b = byGroup as Rec;
  const rows = Array.isArray(b["rows"]) ? (b["rows"] as Rec[]) : [];
  return {
    dimension: b["dimension"],
    rows: rows.map((r) => ({
      group: r["group"] ?? r["domain"],
      kmMedian: r["kmMedian"],
      open: r["open"],
    })),
  };
}

// ---------------------------------------------------------------- trend series
//
// Three pages draw from a trend backbone and each reads a different slice of it. The points
// are the payload: `trendFromBase(..., {backfill:true})` emits one per saved flat scan PLUS one
// synthetic point per DAY of pre-first-scan history, so the array is long by construction and
// every unread field on a point is multiplied by that length.
//
// The key sets below are the pages' actual reads, verified against the client rather than
// assumed. They are deliberately spelled out per page instead of unioned into one "safe" set:
// a union is what the payload already is, and it is what made eight of twelve fields on the
// Program series dead weight. Where two pages genuinely overlap they simply repeat a key.
//
// Projected at the endpoint, never inside the `cached()` compute, so `mttrTrend6` and
// `programTrend1` keep the shape they have always had and no namespace moves. One cached
// backbone, three different views of it.

/** Narrow each row of `rows` to `keys`, dropping keys the row does not carry. */
function pickRows(rows: unknown, keys: readonly string[]): Rec[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Rec[]).map((r) => {
    const out: Rec = {};
    for (const k of keys) if (k in r) out[k] = r[k];
    return out;
  });
}

/** MTTR & SLA: the median/KM lines, the SLA-burn pair, and the open/resolved pair. Drops
 *  `sla_pct` and `oldest_open_days` (the hero reads those from the summary, not the series)
 *  and `sla_entered`/`sla_cleared` (only their difference `sla_net` is ever drawn). */
const MTTR_TREND_KEYS = [
  "date", "reconstructed", "open", "resolved",
  "median_days", "km_median_days", "open_past_sla", "sla_net", "sla_attainment_pct",
] as const;

/** Scan History: two charts only — the KM median line and the open/resolved pair. */
const HISTORY_TREND_KEYS = ["date", "reconstructed", "open", "resolved", "km_median_days"] as const;

/** Program performance: the coverage/efficiency pair. Everything else on the point belongs to
 *  the shared `TrendPoint` base and to the high-risk decorator, and none of it is drawn here. */
const PROGRAM_TREND_KEYS = ["date", "reconstructed", "coverage_pct", "efficiency_pct"] as const;

/**
 * `getMttrPage`'s trend slice.
 *
 * `history` SURVIVES HERE, unlike on Scan History, and that asymmetry is deliberate. The MTTR
 * page reads it twice: `hist[hist.length - 2]` feeds the change chips, and — when the
 * reconstructed series is empty and the vendor-fix filter is on — the whole array is the
 * FALLBACK the median and open-past-SLA charts draw from. Dropping it would blank those charts
 * on a young ledger, which is exactly the state they exist to cover.
 */
export function mttrPageTrendSlice(trends: unknown): Rec | null {
  if (!trends || typeof trends !== "object") return null;
  const t = trends as Rec;
  return { history: t["history"] ?? [], trend: pickRows(t["trend"], MTTR_TREND_KEYS) };
}

/**
 * `getMttrTrend`'s slice — the Scan History page, its only caller.
 *
 * `history` is dropped WHOLE: this page never dereferences it. It is the entire `mttr_history`
 * tab, shipped on every visit for nobody, and it is the one place the array can go because the
 * MTTR page's fallback (above) is the only thing that needs it.
 */
export function historyTrendSlice(trends: unknown): Rec | null {
  if (!trends || typeof trends !== "object") return null;
  return { trend: pickRows((trends as Rec)["trend"], HISTORY_TREND_KEYS) };
}

/** `getProgramPage`'s trend slice — four fields of twelve. */
export function programTrendSlice(trends: unknown): Rec | null {
  if (!trends || typeof trends !== "object") return null;
  return { trend: pickRows((trends as Rec)["trend"], PROGRAM_TREND_KEYS) };
}

// ---------------------------------------------------------------- scan history

/** Columns of the `scans` tab the Scan History table draws. `raw_ref` and `obs_ref` are the
 *  Drive file ids for a scan's archived pages and its observation set — internal storage
 *  addresses with no client reader, which the page had no business receiving. */
const SCAN_ROW_KEYS = [
  "scan_id", "ts", "mode", "shape", "total",
  "new_count", "resolved_count", "reopened_count", "severities", "sealed",
] as const;

/** `getScanHistory`'s scans, narrowed to the columns the table reads. */
export function scanRowsSlice(scans: unknown): Rec[] {
  return pickRows(scans, SCAN_ROW_KEYS);
}

// -------------------------------------------------------------- drawer payloads
//
// Two blocks below were paid for on every page load and read only after a user opened a
// drawer. They are not projected away — they are moved behind the click that needs them, and
// the endpoints that serve them read the SAME `cached()` entry the eager one does.
//
// That last part is the whole design. A `getOldestOpen` that recomputed its own rows would
// rebuild `baseVisible` — loadBaseRows, attachSupportGroups, attachBizDomains, a per-row
// resolveDomainName and three filter passes — which is essentially all of `insightsData`'s
// cost, paid again, inside a drawer the reader is staring at. Reading the cached entry is a
// hit on the payload the page warmed seconds earlier: one inflate and parse, then one slice.
//
// So no new cache namespace, and NO BUMP. `insights3`, `mttrByDomain14` and
// `mttrBySupportGroup2` keep exactly the shape they compute today; only what the endpoint
// RETURNS changes. Bumping would discard warm entries for a change that alters nothing
// computed, which is the opposite of the point.

/** The oldest-open views, in the order the panel's toggle offers them. */
const OLDEST_VIEWS = ["findings", "byAsset", "bySupportGroup", "byDomain"] as const;

/**
 * `getInsights` minus `oldest` — the Overview page's eager payload.
 *
 * Written as an explicit OMIT rather than an enumeration of survivors, unlike the executive
 * slices, and the difference is not laziness. On Executive two thirds of the payload had no
 * reader, so naming what survives is the shorter and more honest statement. Here every other
 * key IS read; enumerating them would be a maintenance tax that buys nothing, and the one
 * invariant worth pinning is that `oldest` does not travel eagerly — which is one assertion.
 *
 * Measured on the seeded estate: `oldest` was 16,434 of 18,064 bytes, 91% of the payload, for
 * four ranked views of up to 100 rows each — of which the panel renders ten rows of one.
 */
export function overviewInsightsSlice(insights: unknown): Rec | null {
  if (!insights || typeof insights !== "object") return null;
  const out: Rec = {};
  for (const [k, v] of Object.entries(insights as Rec)) if (k !== "oldest") out[k] = v;
  return out;
}

/**
 * One ranked view for the drawer, echoed with the `view` it answers for.
 *
 * The echo is not decoration: the toggle can be clicked again before a response lands, and the
 * panel drops any payload whose `view` is no longer the active one rather than painting a
 * ranked table under the wrong heading.
 *
 * Rows stay uncapped within the existing 100 the server already computes, and the pager stays
 * client-side. In GAS the round trip is the expensive unit, not the few KB — putting an RPC
 * behind every Next click would trade the one thing this panel does well for a saving that
 * does not matter.
 */
export function oldestOpenSlice(insights: unknown, view: string): Rec {
  const known = (OLDEST_VIEWS as readonly string[]).includes(view) ? view : "findings";
  const oldest = (insights && typeof insights === "object")
    ? ((insights as Rec)["oldest"] as Rec | undefined)
    : undefined;
  const rows = oldest ? oldest[known] : undefined;
  return { view: known, rows: Array.isArray(rows) ? rows : [] };
}

/**
 * `getMttrPage`'s per-group split without its trend series — the table only.
 *
 * `rows` stays EAGER. It is bounded by the number of groups rather than by the estate, the
 * table is what makes the drawer feel instant when it opens, and the `awaiting` footnote sums
 * it before the drawer exists. Only the two per-scan x per-group series move.
 */
export function mttrGroupTableSlice(byGroup: unknown): Rec | null {
  if (!byGroup || typeof byGroup !== "object") return null;
  const b = byGroup as Rec;
  return { dimension: b["dimension"], rows: Array.isArray(b["rows"]) ? b["rows"] : [] };
}

/** The series the by-group drawer's two charts draw, fetched when it opens. */
export function mttrGroupTrendSlice(byGroup: unknown): Rec | null {
  if (!byGroup || typeof byGroup !== "object") return null;
  return ((byGroup as Rec)["trend"] as Rec | undefined) ?? null;
}

// ------------------------------------------------------------------ job status
//
// `api_getJobStatus` is polled every three seconds for the life of a scan — roughly 1,200
// requests an hour — and each response spread the whole `JobRow`. Most of it has no client
// reader, and two fields are things the browser has no business holding at all: `cursor` is
// the Wiz `endCursor`, an opaque pagination token for a production security tenant, and
// `journal_ref` is a Drive file id for the rollback journal.
//
// `params_json` was read, but only to answer one boolean. Parsing it in the browser also meant
// a malformed value fell into `scanMode`'s catch and rendered a job as the generic "Scan"; a
// tri-state resolved server-side keeps that fallback while removing the reason for it.

/** The job fields the progress card actually draws. */
const JOB_KEYS = [
  "job_id", "kind", "phase", "page", "findings_so_far", "total_count",
  "started_at", "updated_at", "error",
] as const;

/**
 * One job, narrowed for the poll.
 *
 * `stale` is computed server-side and passed in — that decision reads the server clock against
 * `updated_at`, and a browser with a skewed clock would draw a healthy job as wedged.
 *
 * `incremental` is `true | false | null`, replacing raw `params_json`. Null preserves
 * `scanMode`'s three-way fallback for a job whose params are absent or unparseable.
 */
export function jobSummarySlice(job: unknown, stale: boolean): Rec | null {
  if (!job || typeof job !== "object") return null;
  const j = job as Rec;
  const out: Rec = { stale };
  for (const k of JOB_KEYS) out[k] = j[k] ?? null;
  let incremental: boolean | null = null;
  try {
    const raw = j["params_json"];
    if (typeof raw === "string" && raw) incremental = Boolean(JSON.parse(raw)?.incremental);
  } catch {
    incremental = null; // unparseable params are "we cannot say", not "full scan"
  }
  out["incremental"] = incremental;
  return out;
}
