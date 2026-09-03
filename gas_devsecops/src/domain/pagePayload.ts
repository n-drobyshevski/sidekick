// What each page is actually SENT, as opposed to what its read-model contains. Port of
// gas/src/domain/pagePayload.ts. Pure and separate from api.ts so the shape is pinned in node
// without standing up the server module graph — same split gas/'s pages/executive.js uses.
//
// Most of this file is duck-typed over `unknown`/Rec and carries no ledger-column renames at
// all — it slices generic read-model shapes (mttrData, trend points, insights payloads), not
// LedgerRow columns. Three places DO need this register's own column names:
//
//   OLDEST_VIEWS       gas/'s four toggle views (findings/byAsset/bySupportGroup/byDomain)
//                       become the two insights.ts actually computes: findings/byRepo — see
//                       insights.ts's header for why bySupportGroup/byDomain were dropped
//                       (host-only; no analog for a source repository).
//   SCAN_ROW_KEYS       drops `shape` (ledgerTypes.ts's ScanRow has no such column — every
//                       scan here is flat) and adds `scope` (the register a scan covered,
//                       which the Scan History table needs on a three-scope register gas/'s
//                       single-register version never had to show). raw_ref/obs_ref (the
//                       Drive ids) stay OUT of the allowlist, same as gas/'s raw_ref/obs_ref —
//                       see the D9 brief's explicit security rule below.
//   JOB_KEYS            adds `scope` (JobRow here carries "which register the battery is on",
//                       jobsStore.ts — gas/'s JobRow has no such column). cursor and
//                       journal_ref stay OUT, same as gas/ — see jobSummarySlice below.
//
// SECURITY RULE (D9 brief): jobSummarySlice must never let `cursor` (the raw Wiz endCursor for
// a production security tenant) or `journal_ref` (a Drive file id) reach the browser, in ANY
// form — not as a top-level key, and not smuggled inside `params_json`'s serialized text. Both
// are enforced structurally here: JOB_KEYS is an ALLOWLIST that does not name them (so they
// never enter `out` as fields), and params_json is only ever JSON.parsed to pull out one
// boolean (`incremental`) — the raw string itself is never copied onto the returned object.
// test/pagePayload.test.ts's "cursor/journal_ref never survive, including inside params_json
// text" case pins this by asserting against the full serialized JSON.stringify output, not just
// Object.keys — see that test for the exact assertion.

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

/**
 * Columns of the `scans` tab the Scan History table draws.
 *
 * `raw_ref` and `obs_ref` are the Drive file ids for a scan's archived pages and its
 * observation set — internal storage addresses with no client reader, which the page has no
 * business receiving (D9 brief). Unlike gas/'s equivalent list, there is no `shape` column to
 * carry (ledgerTypes.ts's ScanRow has none — every scan here is flat), and `scope` is added —
 * the register a scan covered, which a three-scope Scan History table needs to show.
 */
const SCAN_ROW_KEYS = [
  "scan_id", "ts", "scope", "mode", "total",
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
// rebuild the base-row population — loadBaseRows plus attach/filter passes — which is
// essentially all of `insightsData`'s cost, paid again, inside a drawer the reader is staring
// at. Reading the cached entry is a hit on the payload the page warmed seconds earlier: one
// inflate and parse, then one slice.
//
// So no new cache namespace, and NO BUMP. The endpoints keep exactly the shape they compute
// today; only what the endpoint RETURNS changes. Bumping would discard warm entries for a
// change that alters nothing computed, which is the opposite of the point.

/**
 * The oldest-open views, in the order the panel's toggle offers them. Two here, not gas/'s
 * four — insights.oldestOpen only computes `findings` and `byRepo` for this register
 * (insights.ts's header: bySupportGroup/byDomain are host-only and were dropped, not merely
 * unlisted).
 */
const OLDEST_VIEWS = ["findings", "byRepo"] as const;

/**
 * `getInsights` minus `oldest` — the Overview page's eager payload.
 *
 * Written as an explicit OMIT rather than an enumeration of survivors, unlike the executive
 * slices, and the difference is not laziness. On Executive two thirds of the payload had no
 * reader, so naming what survives is the shorter and more honest statement. Here every other
 * key IS read; enumerating them would be a maintenance tax that buys nothing, and the one
 * invariant worth pinning is that `oldest` does not travel eagerly — which is one assertion.
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
 * Rows stay uncapped within the existing count the server already computes, and the pager
 * stays client-side.
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

/**
 * The job fields the progress card actually draws. `scope` is added relative to gas/'s
 * JOB_KEYS — jobsStore.ts's JobRow carries which of the three registers the battery is on
 * (gas/'s single-register JobRow has no such column), and a three-scope progress card needs to
 * say which one is running.
 */
const JOB_KEYS = [
  // `page_size` rides along with `page` and `total_count` because the three are the only
  // honest per-scope progress fraction on offer: `findings_so_far` is cumulative across the
  // whole sync while `total_count` is one scope's, so their ratio is wrong from the second
  // register onward. All three are per-scope (scanJobs resets page/page_size on advance) and
  // none is sensitive — a page size is a constant of this app, not a fact about the tenant.
  "job_id", "kind", "phase", "scope", "page", "page_size", "findings_so_far", "total_count",
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
 *
 * `cursor` and `journal_ref` are never read off `j` at all — JOB_KEYS is the allowlist and
 * neither name is in it — and `params_json` itself is only ever parsed for `.incremental`,
 * never copied onto `out`. See the module header's SECURITY RULE.
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
