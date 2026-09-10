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
// The per-finding register row set (bottom of this file) needs three vocabularies and one
// parser: severities and risk tiers sort by MEANING rather than alphabetically, and the date
// columns sort as instants.
import { SEVERITY_ORDER } from "./config";
import { RISK_TIER_ORDER } from "./program";
import { normalizeSeverity } from "./severity";
import { parseTs } from "./util";

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
const OVERVIEW_OMIT = new Set(["oldest", "fixNext", "movementOpen"]);

export function overviewInsightsSlice(insights: unknown): Rec | null {
  if (!insights || typeof insights !== "object") return null;
  const out: Rec = {};
  for (const [k, v] of Object.entries(insights as Rec)) if (!OVERVIEW_OMIT.has(k)) out[k] = v;
  return out;
}

/**
 * The Executive front door's slice of the SAME `insightsData` payload the Overview reads.
 *
 * `fixNext` and `movementOpen` are computed inside `insightsData` rather than in a read-model
 * of their own, and that is the whole reason this slice exists. Both need `baseVisible` —
 * loadBaseRows, attachSupportGroups, attachBizDomains, a per-row resolveDomainName and three
 * filter passes — plus the frame-to-ledger exposure join. Computing them separately would
 * rebuild all of it for a second cache entry; computing them here means the Executive reads
 * the entry the Overview warmed, and the Overview reads the entry the Executive warmed. So the
 * ONLY thing that differs between the two pages is which keys travel.
 *
 * Written as an enumeration rather than an omit, unlike `overviewInsightsSlice` above, for the
 * same reason the two `exec*` slices are: on Executive the payload is overwhelmingly for
 * somebody else, so naming the three survivors is the shorter and more honest statement —
 * `insightsData` carries eighteen keys and this page reads two of them plus the scan stamp.
 *
 * `scan` travels because a ranked list and a movement comparison are both AS OF a scan, and a
 * front door that cannot say when it last looked is the "unmeasured register renders as a
 * register of zeroes" failure with extra steps.
 */
export function execInsightsSlice(insights: unknown): Rec | null {
  if (!insights || typeof insights !== "object") return null;
  const i = insights as Rec;
  return { fixNext: i["fixNext"], movement: i["movementOpen"], scan: i["scan"] };
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

// ------------------------------------------------------- the per-finding register rows
//
// THE OS REGISTER HAD NO ROW. Every read model in this app is an AGGREGATE — severity
// counts, tier ladders, KM curves, oldest-open rankings — and the one question a reader
// arrives with ("show me the findings, and let me sort them") had no answer on the wire.
// `getRiskCohort` is the closest thing, and it is a drill-down into one confusion-matrix
// cell with a hand-built ten-column projection; it is not the register.
//
// TWO THINGS LIVE HERE AND THEY ARE ONE DECISION — the same split `gas_devsecops` states
// in its own copy of this file, ported here because the OS register is the same shape of
// problem with a different spine.
//
//   1. THE SLICE. `REGISTER_ROW_COLUMNS` is an ALLOWLIST and `registerRowsSlice` copies
//      nothing else off the base row. A `BaseRow` carries plenty that has no reader in a
//      table and no business on the wire: `tags_json` (the asset's whole tag dictionary,
//      including whatever an estate happens to put in tags), `asset_id` and the internal
//      addresses `first_scan_id` / `last_scan_id`, and the raw capture columns `fix_date` /
//      `fix_observed_at` / `risk_observed_at` whose DERIVED forms (`fix_available_at`,
//      `awaiting_vendor_fix`) are what a reader is actually being shown. `raw_ref` and
//      `obs_ref` are not on a `BaseRow` at all — they are scan-tab columns — and the
//      allowlist refuses them anyway, because the failure this guards against is somebody
//      spreading a row instead of picking from it, and a spread does not care which tab a
//      field came from.
//
//      `cvss` IS NOT DASHED — IT IS ABSENT. It is not a ledger column and never has been
//      (`LEDGER_COLUMNS`, `reconcile.ts`), so a `cvss` column would print an em dash on
//      every row of the register for the life of the page: a table that says "we looked and
//      found nothing" about a field nobody ever stored. This register's spine is
//      exploitability (KEV / public exploit / EPSS), not a severity score — `gas/README.md`
//      — so the column that carries that weight is `risk_tier`, and it is here.
//
//   2. THE ORDERING RULE. Sorting and paging happen SERVER-SIDE, so the order a reader sees
//      is decided here rather than in the browser. `gas_shared/ui/tableModel.js` states the
//      same rule for the tables the client still sorts itself (unknowns LAST in both
//      directions; a constant tiebreak so a column of equal values does not reshuffle
//      itself), and this is its DOM-free twin. It is a TWIN, NOT A SECOND OPINION, and that
//      is measured rather than asserted: the client bundle is plain JS and cannot import a
//      TypeScript domain module, so `test/registerRowsOrdering.test.js` runs BOTH
//      comparators over the same fixture and asserts identical arrangements, nulls
//      included.

/**
 * The one column that ships outside the drawn list: the row's identity.
 *
 * The client keys rows on it and the server tie-breaks the sort on it. `vuln_key` is the
 * ledger's own primary key (`lifecycle.vulnKey`), unique per finding by construction, which
 * is what makes the sort a TOTAL order rather than merely a mostly-stable one.
 */
export const REGISTER_ROW_KEY = "vuln_key";

/**
 * The columns a register row carries.
 *
 * Ordered as the table reads them: what it is, how bad, whose it is, when it happened, what
 * is known about exploitation, and how long the clocks have run.
 *
 * NINE OF THESE ARE DERIVED, NOT LEDGER COLUMNS — `DERIVED_ROW_COLUMNS` names them so a test
 * can cross-check the rest against `LEDGER_COLUMNS` and still catch a column that exists in
 * neither place. Everything else here is a real column of `reconcile.LedgerRow`.
 */
export const REGISTER_ROW_COLUMNS: readonly string[] = [
  "cve", "severity", "risk_tier", "status", "resolution_src", "reopened_count",
  "asset_name", "asset_type", "cloud", "subscription_name", "support_group", "domain",
  "first_seen", "published_date", "fix_available_at", "awaiting_vendor_fix",
  "last_seen", "resolved_at",
  "has_kev", "has_exploit", "epss", "internet_exposed",
  "mttr_days", "age_days", "actionable_age_days",
];

/**
 * The columns above that are COMPUTED rather than read off the ledger, and by whom:
 *
 *   - `ledgerCore.baseRows` — `fix_available_at`, `awaiting_vendor_fix`, `mttr_days`,
 *     `age_days`, `actionable_age_days` (the detection clock and the actionable one);
 *   - `program.riskTier` — `risk_tier`, under the risk rule in force;
 *   - the attribution join — `support_group` (`supportGroups.attachSupportGroups`) and
 *     `domain` (`resolveDomainName`);
 *   - the current-scan frame — `internet_exposed`, which is not a ledger column at all (see
 *     the tri-state note on `registerRowsSlice`).
 */
export const DERIVED_ROW_COLUMNS: readonly string[] = [
  "risk_tier", "support_group", "domain", "internet_exposed",
  "fix_available_at", "awaiting_vendor_fix",
  "mttr_days", "age_days", "actionable_age_days",
];

/**
 * The two columns whose value arrives under a DIFFERENT name on the source row.
 *
 * `attachSupportGroups` and the domain resolution both write underscore-prefixed working
 * fields (`_supportGroup`, `_domain`) because a base row is a ledger row and those are not
 * ledger columns. Renaming here rather than on the row keeps that convention intact and
 * keeps the wire names readable.
 */
const REGISTER_ROW_SOURCE: Record<string, string> = {
  support_group: "_supportGroup",
  domain: "_domain",
};

/** Which order the register opens in: oldest open first, the question this page asks. */
export const REGISTER_ROW_DEFAULT_SORT: { sort: string; dir: "asc" | "desc" } = {
  sort: "age_days",
  dir: "desc",
};

/**
 * The ceiling on `pageSize`, and it is CLAMPED rather than refused.
 *
 * 250 is the largest size `gas_shared/ui/tableModel.js`'s `PAGE_SIZES` control offers, so
 * the cap is exactly the widest page a reader can ask for through the UI rather than a
 * number invented here. A request above it is served the cap — refusing would turn a
 * mistyped URL into an error page, while honouring it would let one call ask for the whole
 * register.
 */
export const REGISTER_ROWS_PAGE_SIZE_CAP = 250;
export const REGISTER_ROWS_DEFAULT_PAGE_SIZE = 50;

/**
 * One page of base rows, narrowed to what the table draws plus the row key.
 *
 * `undefined` becomes `null` and NOTHING ELSE IS COERCED. `has_kev: null` stays null: Wiz
 * returns null for a signal it never evaluated, and a table that received `false` there
 * would render an unassessed finding as one known to be clean — the exact defect this
 * register was built after (CLAUDE.md, "Absent is never zero"). The same rule is what makes
 * `internet_exposed` tri-state: `true` when the frame join says the host is reachable,
 * `false` only when the frame CARRIES the exposure keys and this row is in it without them,
 * and `null` when the frame predates those keys or when the row is not in the current frame
 * at all — a finding resolved by disappearance is gone from every frame, and "we could not
 * look" is not "not reachable". The server stamps that value; this function only refuses to
 * flatten it.
 */
export function registerRowsSlice(rows: unknown): Rec[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Rec[]).map((r) => {
    const key = r[REGISTER_ROW_KEY];
    const out: Rec = { [REGISTER_ROW_KEY]: key === undefined ? null : key };
    for (const c of REGISTER_ROW_COLUMNS) {
      const v = r[REGISTER_ROW_SOURCE[c] ?? c];
      out[c] = v === undefined ? null : v;
    }
    return out;
  });
}

/**
 * Ordinary comparison for two PRESENT values — the twin of `tableModel.js`'s
 * `compareValues`. Nulls are the caller's problem and `nullsLastOrder` is how it solves them.
 */
export function compareRegisterValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Where an unknown goes: LAST, in both directions — the twin of `nullsLast`.
 *
 * Outside the ascending/descending flip on purpose. An unknown is not a small value: letting
 * it lead the ascending page buries the rows somebody sorted the column to find, and
 * reversing then buries the others, so neither half of the column can be brought into view.
 *
 * Returns `null` when BOTH are present and the caller should compare them.
 */
export function nullsLastOrder(a: unknown, b: unknown): number | null {
  const na = a === null || a === undefined;
  const nb = b === null || b === undefined;
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  return null;
}

export interface RowSortSpec {
  value: (row: Rec) => unknown;
  descending?: boolean;
  /** Never flipped by `descending` — its job is to be constant. */
  tiebreak?: (row: Rec) => unknown;
}

/**
 * Sort a copy of `rows`, unknowns last, ties broken the same way every time.
 *
 * THE TIEBREAK IS NOT A GARNISH, and on a paged server it matters more than it does in a
 * browser: `Array.prototype.sort` is stable, but the input order here is whatever
 * `loadBaseRows` happened to return, so a column of equal values (a severity, a status, a
 * boolean) would cut into pages differently across two requests and a reader paging forward
 * could see one finding twice and never see another. A constant second key fixes the
 * arrangement to the data.
 */
export function sortRegisterRows<T extends Rec>(rows: readonly T[], spec: RowSortSpec): T[] {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const value = spec && spec.value;
  if (typeof value !== "function") return list;
  const descending = Boolean(spec.descending);
  const tiebreak = typeof spec.tiebreak === "function" ? spec.tiebreak : null;

  return list.sort((ra, rb) => {
    const va = value(ra);
    const vb = value(rb);
    const order = nullsLastOrder(va, vb);
    if (order === null) {
      const d = compareRegisterValues(va, vb);
      if (d !== 0) return descending ? -d : d;
    } else if (order !== 0) {
      return order;
    }
    if (!tiebreak) return 0;
    const ta = tiebreak(ra);
    const tb = tiebreak(rb);
    const tie = nullsLastOrder(ta, tb);
    return tie === null ? compareRegisterValues(ta, tb) : tie;
  });
}

/**
 * One page of rows, with the page index CLAMPED into range rather than refused.
 *
 * Clamping is what lets a filter shrink the register under a reader who is on page 9 without
 * the table going blank: they land on the last page that exists, and the response says which
 * page it actually served. Page indices are ZERO-BASED, matching `tableModel.js`'s `pageOf`
 * and the pager control that draws them as "Page n+1 of N".
 */
export function pageOfRegisterRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): { rows: T[]; page: number; pageCount: number } {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const clamped = Math.min(Math.max(Math.floor(page) || 0, 0), pageCount - 1);
  return {
    rows: rows.slice(clamped * size, (clamped + 1) * size),
    page: clamped,
    pageCount,
  };
}

/** Date columns — compared as instants, so a naive and a zoned spelling of one day agree. */
const DATE_SORT_COLUMNS = new Set([
  "first_seen", "last_seen", "resolved_at", "fix_available_at", "published_date",
]);

/** Numeric columns — compared as numbers, so 9 sorts below 10 rather than above it. */
const NUMBER_SORT_COLUMNS = new Set([
  "epss", "mttr_days", "age_days", "actionable_age_days", "reopened_count",
]);

/**
 * Severity as a RANK, not as a string.
 *
 * Alphabetical order puts CRITICAL under HIGH and INFO above LOW, which is the one ordering
 * a severity column must never have. `SEVERITY_ORDER` is the source; UNKNOWN is its last
 * entry, so an unrecognised or absent severity sinks in the ascending direction — the same
 * place `nullsLastOrder` would have put it, reached through the vocabulary instead.
 */
function severityRank(v: unknown): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(normalizeSeverity(v));
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/**
 * Risk tier as a RANK, for the same reason and from the same kind of source.
 *
 * `RISK_TIER_ORDER` is worst-evidence-first with `unknown` last, so ascending is worst-first:
 * a register that sorted its own spine alphabetically would open on `epss` and bury `kev`.
 * An unrecognised value sinks, like an unrecognised severity.
 */
function riskTierRank(v: unknown): number {
  const i = (RISK_TIER_ORDER as readonly string[]).indexOf(String(v ?? ""));
  return i === -1 ? RISK_TIER_ORDER.length : i;
}

/** Missing is one thing with one spelling: null, undefined and "" all mean "no value". */
function orNull(v: unknown): unknown {
  return v === null || v === undefined || v === "" ? null : v;
}

/**
 * The value a column sorts on — typed per column, because a register's columns are not all
 * strings and comparing them as strings is how a table lies about its own order.
 *
 * THE NUMERIC BRANCH REFUSES BEFORE IT CASTS. `Number(null)` is 0 and `Number.isFinite(0)` is
 * true, so a cast-first form would sort every resolved row's absent `age_days` as a finding
 * zero days old, at the TOP of the ascending page — the third time that cast has bitten in
 * this repository (CLAUDE.md). `orNull` runs first, and `Number.isFinite` then guards only
 * the values that were really numbers.
 */
export function registerSortValue(column: string): (row: Rec) => unknown {
  if (column === "severity") return (r) => severityRank(r["severity"]);
  if (column === "risk_tier") return (r) => riskTierRank(r["risk_tier"]);
  if (DATE_SORT_COLUMNS.has(column)) return (r) => parseTs(r[column]);
  if (NUMBER_SORT_COLUMNS.has(column)) {
    return (r) => {
      const raw = orNull(r[column]);
      if (raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
  }
  return (r) => orNull(r[column]);
}
