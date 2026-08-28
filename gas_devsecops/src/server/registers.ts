// The register read-model: filter, facet, sort and SLICE — server-side, on purpose.
//
// SCA IS 17,991 ROWS AND MUST NEVER CROSS THE WIRE WHOLE. That is the whole reason this is
// a server module rather than a client filter over a fetched array: one register's rows,
// with forty columns each, is megabytes of JSON through google.script.run, and the reader
// looks at a hundred of them.
//
// THE CACHE KEY RULE, taken verbatim from the sibling (gas/src/server/api.ts, the comment on
// `cachedRiskCohortRows`): CACHE THE FULL FILTERED SET, SLICE PER REQUEST. `page` and
// `pageSize` are deliberately NOT in the key — paging must not multiply the entries — while
// anything that selects WHICH ROWS EXIST is. Without the split, every Next click re-runs
// `baseRows` and the filter pass over the entire ledger to throw all but one page away.

import { SEVERITY_ORDER, type Scope } from "../domain/config";
import { baseRows, type BaseRow } from "../domain/ledgerCore";
import { normalizeSeverity } from "../domain/severity";
import { cmp } from "../domain/util";
import { readLedger } from "./ledgerStore";
import { durablyCached } from "./readModelStore";

/** Everything that selects which rows exist. Joins the cache key; `page` does not. */
export interface RegisterQuery {
  scope: Scope;
  severities?: readonly string[] | null;
  repo?: string | null;
  /** "open" | "resolved" | null for both. */
  status?: string | null;
  /** Secrets only: filter to rows whose credential is / is not measured dead. */
  validation?: string | null;
  /** SCA only: only rows with no vendor fix available yet. */
  awaitingVendor?: boolean;
}

export interface RegisterFacets {
  severity: Record<string, number>;
  repo: Record<string, number>;
  status: Record<string, number>;
  /** Secrets: the validation tri-state. Empty on the other two scopes. */
  validation: Record<string, number>;
}

export interface RegisterPage {
  scope: Scope;
  /** Rows AFTER filtering — the denominator every count on the page is against. */
  total: number;
  /** Rows in the scope before any filter, so the page can say what the filter removed. */
  scopeTotal: number;
  page: number;
  pageCount: number;
  pageSize: number;
  rows: BaseRow[];
  facets: RegisterFacets;
  /** Counts the page prints beside its figures, over the FILTERED set. */
  summary: {
    open: number;
    resolved: number;
    /** Resolved rows whose death date is a scan timestamp rather than an observed event. */
    disappeared: number;
    awaitingVendor: number;
  };
}

function tally(into: Record<string, number>, key: string | null | undefined): void {
  const k = key === null || key === undefined || key === "" ? "(none)" : key;
  into[k] = (into[k] ?? 0) + 1;
}

/**
 * Facets over the SCOPE, not over the filtered set.
 *
 * A facet count that shrank as you selected it would be describing the selection rather than
 * the register, and the reader could never tell what selecting a second value would give
 * them. Counted once, before any filter.
 */
function facetsFor(rows: readonly BaseRow[]): RegisterFacets {
  const facets: RegisterFacets = { severity: {}, repo: {}, status: {}, validation: {} };
  for (const r of rows) {
    tally(facets.severity, normalizeSeverity(r.severity));
    tally(facets.repo, r.repo_name);
    tally(facets.status, r.status);
    if (r.scope === "secrets") tally(facets.validation, r.validation_state ?? "UNKNOWN");
  }
  return facets;
}

function matches(row: BaseRow, q: RegisterQuery): boolean {
  if (q.severities && q.severities.length
      && !q.severities.includes(normalizeSeverity(row.severity))) return false;
  if (q.repo && (row.repo_name ?? "(none)") !== q.repo) return false;
  if (q.status === "open" && row.status !== "OPEN") return false;
  if (q.status === "resolved" && row.status !== "RESOLVED") return false;
  if (q.validation && (row.validation_state ?? "UNKNOWN") !== q.validation) return false;
  if (q.awaitingVendor && !row.awaiting_vendor_fix) return false;
  return true;
}

const SEV_RANK: Record<string, number> = {};
SEVERITY_ORDER.forEach((s, i) => { SEV_RANK[s] = i; });

/**
 * Sort, with severity ordered by MEANING rather than alphabetically.
 *
 * "CRITICAL, HIGH, INFO, LOW, MEDIUM" is what a string sort gives, and it is useless — the
 * one column a reader sorts by first is the one a naive comparator gets most wrong.
 */
function sortRows(rows: BaseRow[], sort: string | null): BaseRow[] {
  if (!sort) return rows;
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  const value = (r: BaseRow): unknown =>
    key === "severity" ? SEV_RANK[normalizeSeverity(r.severity)] ?? 99
      : (r as unknown as Record<string, unknown>)[key];
  const out = [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    // Nulls last in BOTH directions: a missing value is not "smallest", it is absent, and
    // reversing the sort should not march every unknown to the top.
    if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
    if (vb === null || vb === undefined) return -1;
    return cmp(va as never, vb as never);
  });
  return desc ? out.reverse() : out;
}

/** Every row of one scope with its derived clocks — the cached, unsliced set. */
function scopeRows(scope: Scope): BaseRow[] {
  return baseRows(Object.values(readLedger()).filter((r) => r.scope === scope));
}

/**
 * One page of a register.
 *
 * Two cache entries per call and they are keyed differently on purpose: the scope's rows are
 * cached by SCOPE alone (so all filters of one register share one pass over the ledger), and
 * nothing about paging enters either key.
 */
export function registerPage(
  q: RegisterQuery,
  page: number,
  pageSize: number,
  sort: string | null,
): RegisterPage {
  const all = durablyCached(`register-rows-1`, { scope: q.scope }, () => scopeRows(q.scope), 3600);
  const facets = durablyCached(`register-facets-1`, { scope: q.scope }, () => facetsFor(all), 3600);

  const filtered = sortRows(all.filter((r) => matches(r, q)), sort);
  const size = Math.min(500, Math.max(1, pageSize));
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const at = Math.min(Math.max(0, page), pageCount - 1);

  let open = 0;
  let disappeared = 0;
  let awaiting = 0;
  for (const r of filtered) {
    if (r.status === "OPEN") open += 1;
    else if (r.resolution_src === "disappeared") disappeared += 1;
    if (r.awaiting_vendor_fix) awaiting += 1;
  }

  return {
    scope: q.scope,
    total: filtered.length,
    scopeTotal: all.length,
    page: at,
    pageCount,
    pageSize: size,
    rows: filtered.slice(at * size, (at + 1) * size),
    facets,
    summary: {
      open,
      resolved: filtered.length - open,
      disappeared,
      awaitingVendor: awaiting,
    },
  };
}
