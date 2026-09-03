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
//   REGISTER_ROW_       gas/ has no equivalent at all: it is one register with one column
//   COLUMNS             list, and this is three registers whose columns barely overlap. The
//                       per-finding row set added at the end of this file is the whole of
//                       that divergence — see its own header for the allowlist, the secrets
//                       rule, and why the ORDERING rule sits beside the slice.
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

import { SEVERITY_ORDER } from "./config";
import { normalizeSeverity } from "./severity";
import { parseTs, type Rec } from "./util";

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

/**
 * ONE scan, narrowed through the SAME allowlist as `scanRowsSlice` — `getRegisterPage` /
 * `getSecretsPage`'s `latestScan` field, which is a single `ScanRow` rather than an array.
 *
 * `buildRegister` (readModels.ts) attaches the raw `latestScanRow(scope)` result to feed
 * `movement()`'s change badge; that raw row carries `raw_ref` / `obs_ref`, the same two Drive
 * ids `SCAN_ROW_KEYS` exists to keep off the wire. Routing a single scan through
 * `scanRowsSlice([scan])[0]` rather than re-declaring the allowlist keeps exactly ONE column
 * list deciding what a scan is allowed to publish, for both the array shape and the singular
 * one.
 */
export function latestScanSlice(scan: unknown): Rec | null {
  if (!scan || typeof scan !== "object") return null;
  return scanRowsSlice([scan])[0] ?? null;
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

// ------------------------------------------------------------- register rows
//
// THE PER-FINDING ROW SET, AND WHY BOTH HALVES OF IT LIVE HERE.
//
// `registerModel(scope)` / `secretsModel()` ship aggregates plus a top-N oldest-open
// ranking; nothing on the wire carried a per-finding row, so the three register pages could
// not draw the tables they were specified to draw and each named the columns it could not
// show. Every one of those columns is already in the ledger (`ledgerTypes.LEDGER_COLUMNS`) —
// the gap was the read model and the RPC, not the schema.
//
// TWO THINGS SIT IN THIS FILE AND THEY ARE THE SAME DECISION.
//
//   1. THE SLICE. `REGISTER_ROW_COLUMNS` is an ALLOWLIST, per scope, and `registerRowsSlice`
//      copies nothing else off the base row. `raw_ref` / `obs_ref` are not on a `BaseRow` at
//      all (they are scan columns — see SCAN_ROW_KEYS above), but `first_scan_id`,
//      `last_scan_id`, `owner_path`, `tags_json`, `resolution_src`, `risk_observed_at`,
//      `fix_date` / `fix_observed_at` and `repo_id` ARE, and none of them has a reader in a
//      register table. Only `finding_key` rides along outside the drawn columns: it is the
//      row identity the client keys and the sort tie-breaks on, and it names a finding
//      rather than describing one.
//
//      NO SECRET VALUE CAN APPEAR HERE, AND THE ALLOWLIST IS WHY. There is none stored —
//      `Q_SECRETS` omits the two denied fields and `slimRecord`'s deny-list refuses them at
//      ingest — so this RPC is the one place a value could newly appear, by somebody
//      spreading a row instead of picking from it. An allowlist cannot spread. The secrets
//      register answers WHICH credential, WHERE, HOW OLD and IS IT DEAD from `identifier` /
//      `secret_kind` / `file_path` / `start_line` / `validation_state`, and never from the
//      string itself. `test/registerRows.test.ts` asserts that over the full
//      `JSON.stringify`, not over `Object.keys`.
//
//   2. THE ORDERING RULE. Sorting and paging happen SERVER-SIDE — the sca register is
//      ~18,800 rows and shipping all of them into an HtmlService page would be absurd — so
//      the order a reader sees is decided here rather than in the browser. `ui/tableModel.js`
//      states the same rule for the tables the client still sorts itself (unknowns LAST in
//      both directions; a constant tiebreak so a column of equal values does not reshuffle
//      itself), and this is its DOM-free twin for rows the server has already ordered.
//
//      IT IS A TWIN, NOT A SECOND OPINION, AND THAT IS MEASURED RATHER THAN ASSERTED: the
//      client bundle is plain JS and cannot import a TypeScript domain module (the same
//      constraint that makes `RISK_TIER_ORDER` a hand-kept mirror in `pages/sca.js`), so the
//      two cannot literally share code. `test/registerRows.test.ts` therefore runs BOTH
//      comparators over the same fixture and asserts identical orderings — including where
//      the nulls land — so a drift between them fails a test rather than quietly reordering
//      a register. The client never re-sorts these rows; it asks the server for a different
//      order, which is what keeps one rule in charge of one table.

/**
 * The columns each scope ships, and they differ ON PURPOSE.
 *
 * One fixed list across three registers would send nulls for two thirds of every row: `cwe`
 * / `language` / `origin` / `ai_verdict` are SAST's, `secret_kind` / `validation_state` /
 * `rotated_at` / `removed_at` / `confidence` are secrets', and `fixed_version` / `has_kev` /
 * `has_exploit` / `epss` / `fix_available_at` / `awaiting_vendor_fix` are SCA's — see
 * `ledgerTypes.ts`, which marks each block with the scope that fills it. `file_path` and
 * `start_line` are the one genuinely shared pair (SAST's `filePath`/`startLine` and secrets'
 * `path`/`lineNumber` land in the same two columns, because `lineNumber` is part of the
 * secrets row key). So the list travels WITH the rows and the client draws what exists.
 *
 * `severity` is absent from `secrets` for the register-wide reason: severity there grades a
 * DETECTION, not whether a credential is live (641 `SAAS_API_KEY` rows sit at LOW), so this
 * register segments by `validation_state` and `confidence` and never by severity.
 *
 * FOUR OF THESE ARE DERIVED, NOT LEDGER COLUMNS. `age_days`, `mttr_days`, `fix_available_at`
 * and `awaiting_vendor_fix` are computed by `ledgerCore.baseRows`; `DERIVED_ROW_COLUMNS`
 * names them so a test can cross-check the rest against `LEDGER_COLUMNS` and still catch a
 * column that exists in neither place.
 */
export const REGISTER_ROW_COLUMNS: Record<string, readonly string[]> = {
  sca: [
    "identifier", "component", "severity", "status", "repo_name", "branch",
    "first_seen", "last_seen", "fixed_version", "fix_available_at", "awaiting_vendor_fix",
    "has_kev", "has_exploit", "epss", "mttr_days", "age_days",
  ],
  sast: [
    "identifier", "cwe", "file_path", "start_line", "language", "origin", "ai_verdict",
    "severity", "status", "repo_name", "first_seen", "last_seen", "age_days",
  ],
  secrets: [
    "identifier", "secret_kind", "confidence", "file_path", "start_line",
    "validation_state", "validated_at", "rotated_at", "removed_at",
    "repo_name", "branch", "first_seen", "last_seen",
  ],
};

/** Columns above that `ledgerCore.baseRows` derives rather than reads off the ledger. */
export const DERIVED_ROW_COLUMNS: readonly string[] = [
  "age_days", "mttr_days", "fix_available_at", "awaiting_vendor_fix",
];

/**
 * The one column that ships outside the drawn list: the row's identity.
 *
 * The client keys rows on it and the server tie-breaks the sort on it, so it is neither
 * decoration nor an internal address — `finding_key` is built from fields already in the
 * payload (`lifecycle.findingKey`) and names a finding rather than describing one.
 */
export const REGISTER_ROW_KEY = "finding_key";

/** Which order a register opens in, per scope. Oldest-first is the question these pages ask;
 *  `secrets` has no `age_days` column of its own, so it opens on the birth date instead. */
export const REGISTER_ROW_DEFAULT_SORT: Record<string, { sort: string; dir: "asc" | "desc" }> = {
  sca: { sort: "age_days", dir: "desc" },
  sast: { sort: "age_days", dir: "desc" },
  secrets: { sort: "first_seen", dir: "asc" },
};

/**
 * The ceiling on `pageSize`, and it is CLAMPED rather than refused.
 *
 * 250 is the largest size `ui/tableModel.js`'s `PAGE_SIZES` control offers, so the cap is
 * exactly the widest page a reader can ask for through the UI rather than a number invented
 * here. A request above it is served the cap — refusing would turn a mistyped URL into an
 * error page, while honouring it would let one call ask for all 18,800 sca rows.
 */
export const REGISTER_ROWS_PAGE_SIZE_CAP = 250;
export const REGISTER_ROWS_DEFAULT_PAGE_SIZE = 50;

/** The columns this scope will actually fill, or `[]` for a scope that does not exist. */
export function registerRowColumns(scope: string): readonly string[] {
  return REGISTER_ROW_COLUMNS[scope] ?? [];
}

/**
 * One page of base rows, narrowed to what that scope's table draws plus the row key.
 *
 * `undefined` becomes `null` and NOTHING ELSE IS COERCED. `has_kev: null` stays null: Wiz
 * returns null for a signal it never evaluated, and a table that received `false` there
 * would render an unassessed finding as one known to be clean — the exact defect this
 * register was built after. `triCell` on the client is the other half of that.
 */
export function registerRowsSlice(rows: unknown, scope: string): Rec[] {
  const cols = registerRowColumns(scope);
  if (!Array.isArray(rows)) return [];
  return (rows as Rec[]).map((r) => {
    const key = r[REGISTER_ROW_KEY];
    const out: Rec = { [REGISTER_ROW_KEY]: key === undefined ? null : key };
    for (const k of cols) out[k] = r[k] === undefined ? null : r[k];
    return out;
  });
}

// ------------------------------------------------------- the ordering rule (see above)

/**
 * Ordinary comparison for two PRESENT values — the twin of `ui/tableModel.js`'s
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
 * page it actually served. Page indices are ZERO-BASED, matching `ui/tableModel.js`'s
 * `pageOf` and the `pager` control that draws them as "Page n+1 of N".
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
  "first_seen", "last_seen", "fix_available_at", "validated_at", "rotated_at", "removed_at",
]);

/** Numeric columns — compared as numbers, so 9 sorts below 10 rather than above it. */
const NUMBER_SORT_COLUMNS = new Set(["start_line", "epss", "mttr_days", "age_days"]);

/**
 * Severity as a RANK, not as a string.
 *
 * Alphabetical order puts CRITICAL under HIGH and INFO above LOW, which is the one ordering
 * a severity column must never have. `SEVERITY_ORDER` is the source; UNKNOWN is its last
 * entry, so an unrecognised or absent severity sinks in the ascending direction — the same
 * place `nullsLastOrder` would have put it, reached through the vocabulary instead.
 */
function severityRank(v: unknown): number {
  const s = normalizeSeverity(v);
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/** Missing is one thing with one spelling: null, undefined and "" all mean "no value". */
function orNull(v: unknown): unknown {
  return v === null || v === undefined || v === "" ? null : v;
}

/**
 * The value a column sorts on — typed per column, because a register's columns are not all
 * strings and comparing them as strings is how a table lies about its own order.
 */
export function registerSortValue(column: string): (row: Rec) => unknown {
  if (column === "severity") return (r) => severityRank(r["severity"]);
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
