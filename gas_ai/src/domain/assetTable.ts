// Filter / sort / paginate for the AI Inventory table — the cheap per-request slice of
// work that sits in front of the (cached) full asset model. Pure and unit-tested here so
// the server and the browser agree on what "page 3 of kind=AI_AGENT sorted by name" means:
// the client mirrors the same predicate, comparators and facet counter for the
// small-inventory path (see src/client/js/pages/inventory.js — the client bundle can't
// import the TS module).

import { SEVERITY_ORDER } from "./config";
import { toNum as num, toStr as str } from "./util";
import type { Rec } from "./util";

export type AssetSort =
  | "issues" | "findings" | "name" | "kind" | "cloud" | "region" | "severity" | "combos"
  | "domain";

export const ASSET_SORTS: AssetSort[] = [
  "issues", "findings", "name", "kind", "cloud", "region", "severity", "combos", "domain",
];

export type SortDir = "asc" | "desc";

/**
 * Which way a column reads first when you sort by it. Risk columns open worst-first —
 * nobody sorts by open issues to see the quietest asset — while identity columns open A→Z.
 * This also preserves the pre-direction meaning of a `?sort=` deep link, which had no `dir`.
 */
export const DEFAULT_SORT_DIR: Record<AssetSort, SortDir> = {
  issues: "desc", findings: "desc", severity: "desc", combos: "desc",
  name: "asc", kind: "asc", cloud: "asc", region: "asc", domain: "asc",
};

/** Offered as "N / page"; the first entry is the default. Keep in sync with the client. */
export const PAGE_SIZES = [25, 50, 100, 250];
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

/**
 * Row ceiling for answering with the whole inventory in one payload. Under it the browser
 * gets every row once and filters, sorts and pages locally — a GAS round trip per
 * keystroke would cost far more than the extra rows. Over it the client asks page by
 * page and the filters become server-side. Table rows are ~12 slim fields, so this is
 * roughly a 300–400 KB ceiling on the payload.
 */
export const CLIENT_ALL_MAX = 1500;

/**
 * The multi-select filter dimensions, in the order the drawer stacks them. Values inside
 * one dimension are OR'd and dimensions are AND'd together — the faceted-search standard,
 * so widening a dimension can only ever add rows.
 *
 * `flags` is the one deliberate exception: see ASSET_FLAGS.
 */
export const FACET_KEYS = [
  "severities", "kinds", "clouds", "regions", "projects", "domains", "flags",
] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

/**
 * Boolean risk signals, filterable as a dimension of their own — and the one dimension
 * that ANDs inside itself rather than ORing. "In a toxic combination OR agentic" answers
 * a question nobody asks; "agentic AND missing a guardrail" is the triage question, and
 * it is what someone ticking two risk boxes means. The drawer labels the group so the
 * semantics are on screen rather than guessed at.
 */
export const ASSET_FLAGS = ["combo", "guardrail", "agentic", "datafindings"] as const;
export type AssetFlag = (typeof ASSET_FLAGS)[number];

export interface AssetTableQuery {
  q: string;
  severities: string[];
  kinds: string[];
  clouds: string[];
  regions: string[];
  projects: string[];
  domains: string[];
  flags: string[];
  sort: AssetSort;
  dir: SortDir;
  page: number;
  pageSize: number;
}

/** Worst-first rank for the issue-severity column; an unset severity ranks below UNKNOWN. */
const SEV_RANK: Record<string, number> = {};
SEVERITY_ORDER.forEach((sev, i) => {
  SEV_RANK[sev] = SEVERITY_ORDER.length - i;
});
function sevRank(v: unknown): number {
  return SEV_RANK[str(v).toUpperCase()] ?? -1;
}

/**
 * A dimension arrives as a real array (server-side caller) or as the comma-joined string
 * the URL carries. Blank entries are dropped and duplicates collapsed, so `?kinds=,,X,X`
 * resolves to one filter rather than a query that looks active three times over.
 */
function list(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : str(v).split(",");
  const out: string[] = [];
  for (const item of raw) {
    const s = str(item).trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

/** First source that carries anything wins — plural param, then the legacy singulars. */
function listWithLegacy(...sources: unknown[]): string[] {
  for (const src of sources) {
    const parsed = list(src);
    if (parsed.length) return parsed;
  }
  return [];
}

function keepValid(values: string[], allowed: readonly string[]): string[] {
  return values.map((v) => v.toUpperCase()).filter((v) => allowed.indexOf(v) >= 0);
}

/** Client params → a query with every field clamped into range; nothing here can throw. */
export function resolveAssetQuery(params: Rec): AssetTableQuery {
  const sort = str(params["sort"]) as AssetSort;
  const resolvedSort: AssetSort = ASSET_SORTS.indexOf(sort) >= 0 ? sort : "issues";
  const dir = str(params["dir"]).toLowerCase();
  const page = Number(params["page"]);
  const pageSize = Number(params["pageSize"]);

  // `aarsSeverities` / `aarsSeverity` / `band` are IGNORED, not remapped onto `severities`.
  //
  // The temptation is obvious — both name severities, and a shared link would keep
  // "working" — but they are different scales measured over different things. The retired
  // facet held an asset's AARS LEVEL, a band of a 0–100 score; `severities` holds the
  // adjusted severity of its worst open issue. On the seed landscape the same word picks
  // different assets under each: 19 rows are level CRITICAL and none of them has a
  // CRITICAL issue. Silently answering a stale `?band=CRITICAL` with a different 19 rows
  // is worse than answering it with the whole register, because nothing on screen would
  // say the question had changed. `resolveAssetQuery` drops them, `persistParams` rewrites
  // the hash canonically on first paint, and a saved view keeps opening.

  return {
    q: str(params["q"]).trim().toLowerCase(),
    severities: keepValid(
      listWithLegacy(params["severities"], params["severity"]),
      SEVERITY_ORDER,
    ),
    kinds: listWithLegacy(params["kinds"], params["kind"]),
    clouds: listWithLegacy(params["clouds"], params["cloud"]),
    regions: listWithLegacy(params["regions"], params["region"]),
    projects: listWithLegacy(params["projects"], params["project"]),
    domains: listWithLegacy(params["domains"], params["domain"]),
    flags: list(params["flags"])
      .map((v) => v.toLowerCase())
      .filter((v) => (ASSET_FLAGS as readonly string[]).indexOf(v) >= 0),
    sort: resolvedSort,
    dir: dir === "asc" || dir === "desc" ? dir : DEFAULT_SORT_DIR[resolvedSort],
    page: Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0,
    pageSize:
      Number.isFinite(pageSize) && pageSize >= 1
        ? Math.min(Math.floor(pageSize), MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE,
  };
}

/** Does this row carry the named boolean risk signal? */
export function hasAssetFlag(row: Rec, flag: string): boolean {
  if (flag === "combo") return num(row["combos"]) > 0;
  if (flag === "guardrail") return row["guardrailMissing"] === true;
  if (flag === "agentic") return row["agentic"] === true;
  // "In a toxic combination AND reaching classified data" is the triage question this
  // dimension's AND semantics exist for. Note the reach is only known for scored assets
  // and for the datastores themselves — an identity's reach is not persisted, so pairing
  // this with `agentic` narrows to nothing rather than to the agentic identities that can
  // read classified data.
  if (flag === "datafindings") return num(row["dataFindings"]) > 0;
  return false;
}

function rowProjects(row: Rec): string[] {
  const v = row["projects"];
  return Array.isArray(v) ? v.map((v) => str(v)).filter(Boolean) : [];
}

/** Name substring (case-insensitive), then OR within each dimension and AND across them. */
export function matchesAssetQuery(row: Rec, q: AssetTableQuery): boolean {
  if (q.q && !str(row["name"]).toLowerCase().includes(q.q)) return false;
  if (q.kinds.length && q.kinds.indexOf(str(row["kind"])) < 0) return false;
  if (q.clouds.length && q.clouds.indexOf(str(row["cloud"])) < 0) return false;
  if (q.regions.length && q.regions.indexOf(str(row["region"])) < 0) return false;
  if (q.severities.length && q.severities.indexOf(str(row["severity"])) < 0) return false;
  if (q.domains.length && q.domains.indexOf(str(row["domain"])) < 0) return false;
  if (q.projects.length) {
    const mine = rowProjects(row);
    if (!q.projects.some((p) => mine.indexOf(p) >= 0)) return false;
  }
  // AND, not OR — see ASSET_FLAGS.
  if (q.flags.length && !q.flags.every((f) => hasAssetFlag(row, f))) return false;
  return true;
}

export function filterAssetRows(rows: Rec[], q: AssetTableQuery): Rec[] {
  return rows.filter((r) => matchesAssetQuery(r, q));
}

type Cmp = (a: Rec, b: Rec) => number;

/** Every primary key is written ascending; `dir` flips it. */
const PRIMARY: Record<AssetSort, Cmp> = {
  name: (a, b) => str(a["name"]).localeCompare(str(b["name"])),
  kind: (a, b) => str(a["kind"]).localeCompare(str(b["kind"])),
  cloud: (a, b) => str(a["cloud"]).localeCompare(str(b["cloud"])),
  region: (a, b) => str(a["region"]).localeCompare(str(b["region"])),
  severity: (a, b) => sevRank(a["severity"]) - sevRank(b["severity"]),
  combos: (a, b) => num(a["combos"]) - num(b["combos"]),
  issues: (a, b) => num(a["openIssues"]) - num(b["openIssues"]),
  findings: (a, b) => num(a["openFindings"]) - num(b["openFindings"]),
  domain: (a, b) => str(a["domain"]).localeCompare(str(b["domain"])),
};

/**
 * The tie-break, applied under every column: worst severity, then the two counts, then a
 * total order on name and id.
 *
 * SEVERITY FIRST, not count first. Within an alphabetical page five LOW issues must not
 * outrank one CRITICAL — the count says how much work an asset holds, the severity says
 * how bad the worst of it is, and only the second answers "which of these two rows should
 * a reader look at first". The counts then separate assets whose worst issue rates the
 * same, which on this landscape is most of them.
 *
 * It ends on `name` then `id` so the order is TOTAL. The AARS tie-break it replaced
 * stopped at the score and left residual ties to `Array.prototype.sort`'s stability, which
 * made the order depend on the cached model's row order rather than on anything a reader
 * could predict — and on a landscape where fourteen assets shared one score, that was most
 * of the page. Same reason graphLayout's `cmpId` and the config register's id leg exist.
 */
const byRiskDesc: Cmp = (a, b) =>
  sevRank(b["severity"]) - sevRank(a["severity"])
  || num(b["openIssues"]) - num(a["openIssues"])
  || num(b["openFindings"]) - num(a["openFindings"])
  || str(a["name"]).localeCompare(str(b["name"]))
  || str(a["id"]).localeCompare(str(b["id"]));

/**
 * The comparator for one column in one direction. The tie-break is always `byRiskDesc` and
 * is deliberately NOT flipped by `dir`: sorting a column A→Z or Z→A is a question about
 * that column, and either way the row most worth looking at should lead its group.
 */
export function assetComparator(sort: AssetSort, dir: SortDir): Cmp {
  const primary = PRIMARY[sort] ?? PRIMARY.issues;
  const sign = dir === "desc" ? -1 : 1;
  return (a, b) => sign * primary(a, b) || byRiskDesc(a, b);
}

/** Each column in its default direction — `ASSET_COMPARATORS.issues` is worst-first. */
export const ASSET_COMPARATORS: Record<AssetSort, Cmp> = ASSET_SORTS.reduce((acc, s) => {
  acc[s] = assetComparator(s, DEFAULT_SORT_DIR[s]);
  return acc;
}, {} as Record<AssetSort, Cmp>);

/** Sorted copy — the cached model's row array must never be reordered in place. */
export function sortAssetRows(rows: Rec[], sort: AssetSort, dir?: SortDir): Rec[] {
  const resolved: AssetSort = ASSET_SORTS.indexOf(sort) >= 0 ? sort : "issues";
  return [...rows].sort(assetComparator(resolved, dir ?? DEFAULT_SORT_DIR[resolved]));
}

// ------------------------------------------------------------------------ facet counts

export interface FacetCount {
  value: string;
  count: number;
}

export type AssetFacetCounts = Record<FacetKey, FacetCount[]> & { matched: number };

/** The values one row contributes to one dimension (projects contribute several). */
function facetValues(key: FacetKey, row: Rec): string[] {
  if (key === "kinds") return [str(row["kind"])].filter(Boolean);
  if (key === "clouds") return [str(row["cloud"])].filter(Boolean);
  if (key === "regions") return [str(row["region"])].filter(Boolean);
  if (key === "severities") return [str(row["severity"])].filter(Boolean);
  if (key === "projects") return rowProjects(row);
  // Blank contributes nothing, exactly as a blank cloud or region does — an untagged
  // asset is not an option anybody would tick. How many assets carry the tag at all is a
  // question about coverage, and `domainCoverage` answers it as a count instead.
  if (key === "domains") return [str(row["domain"])].filter(Boolean);
  return ASSET_FLAGS.filter((f) => hasAssetFlag(row, f)) as unknown as string[];
}

function facetSorter(key: FacetKey): (a: FacetCount, b: FacetCount) => number {
  if (key === "severities") {
    const order = SEVERITY_ORDER as readonly string[];
    return (a, b) => order.indexOf(a.value) - order.indexOf(b.value);
  }
  if (key === "flags") {
    const order = ASSET_FLAGS as readonly string[];
    return (a, b) => order.indexOf(a.value) - order.indexOf(b.value);
  }
  return (a, b) => a.value.localeCompare(b.value);
}

/**
 * How many rows each filter option would still leave, counted against every OTHER active
 * dimension but not against its own. Counting a dimension against itself would show 0 on
 * every option you haven't picked, which is the opposite of what the number is for: it
 * exists so you can see what narrowing costs before you commit to it.
 *
 * Keep in step with facetCounts in src/client/js/pages/inventory.js, which runs this same
 * computation in the browser for the small-inventory path (the client bundle can't import
 * this module, and in that mode the server never sees the filter change at all).
 */
export function facetCounts(rows: Rec[], q: AssetTableQuery): AssetFacetCounts {
  const out = { matched: 0 } as AssetFacetCounts;
  for (const key of FACET_KEYS) {
    // `flags` ANDs inside itself, so its options are counted against the FULL query,
    // including the other flags: the number under "Missing guardrail" has to answer
    // "how many would be left if I also required this", which is what ticking it does.
    const scope: AssetTableQuery = key === "flags" ? q : { ...q, [key]: [] };
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!matchesAssetQuery(row, scope)) continue;
      for (const value of facetValues(key, row)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    // A selected value that now matches nothing stays on the list at 0 — it has to, or the
    // control you would turn it off from would vanish the moment it stopped matching.
    for (const value of q[key]) if (!counts.has(value)) counts.set(value, 0);
    out[key] = Array.from(counts, ([value, count]) => ({ value, count }))
      .sort(facetSorter(key));
  }
  // Free from the passes above: the table's "N of M" numerator, so the caller doesn't
  // filter the whole set a second time just to count it.
  out.matched = rows.reduce((n, row) => (matchesAssetQuery(row, q) ? n + 1 : n), 0);
  return out;
}

export interface AssetPage {
  rows: Rec[];
  page: number;
  pageCount: number;
}

/**
 * One page of rows with `page` clamped into range, so a stale deep link (or a filter that
 * just narrowed the set) lands on the last page instead of an empty table.
 */
export function pageOf(rows: Rec[], page: number, pageSize: number): AssetPage {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const clamped = Math.min(Math.max(Math.floor(page) || 0, 0), pageCount - 1);
  return {
    rows: rows.slice(clamped * size, (clamped + 1) * size),
    page: clamped,
    pageCount,
  };
}
