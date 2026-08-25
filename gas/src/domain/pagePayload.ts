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
