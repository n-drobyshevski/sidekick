// Filter / sort / paginate for the AI Inventory table — the cheap per-request slice of
// work that sits in front of the (cached) full asset model. Pure and unit-tested here so
// the server and the browser agree on what "page 3 of kind=AI_AGENT sorted by name" means:
// the client mirrors the same predicate and comparators for the small-inventory path (see
// src/client/js/pages/inventory.js — the client bundle can't import the TS module).

import { normalizeAarsSeverity } from "./config";
import type { Rec } from "./util";

export type AssetSort = "aars" | "name" | "kind" | "cloud";

export const ASSET_SORTS: AssetSort[] = ["aars", "name", "kind", "cloud"];

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

export interface AssetTableQuery {
  q: string;
  kind: string;
  cloud: string;
  aarsSeverity: string;
  sort: AssetSort;
  page: number;
  pageSize: number;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Missing/garbage scores sort last, matching `Number(x ?? -1)` on the client. */
function score(v: unknown): number {
  const n = Number(v ?? -1);
  return Number.isFinite(n) ? n : -1;
}

/** Client params → a query with every field clamped into range; nothing here can throw. */
export function resolveAssetQuery(params: Rec): AssetTableQuery {
  const sort = str(params["sort"]) as AssetSort;
  const page = Number(params["page"]);
  const pageSize = Number(params["pageSize"]);
  return {
    q: str(params["q"]).trim().toLowerCase(),
    kind: str(params["kind"]),
    cloud: str(params["cloud"]),
    // `band` is the pre-rename spelling, still honored so shared links keep working.
    aarsSeverity: normalizeAarsSeverity(params["aarsSeverity"] ?? params["band"]) ?? "",
    sort: ASSET_SORTS.indexOf(sort) >= 0 ? sort : "aars",
    page: Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0,
    pageSize:
      Number.isFinite(pageSize) && pageSize >= 1
        ? Math.min(Math.floor(pageSize), MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE,
  };
}

/** Name substring (case-insensitive) plus exact kind / cloud / AARS severity. */
export function matchesAssetQuery(row: Rec, q: AssetTableQuery): boolean {
  if (q.q && !str(row["name"]).toLowerCase().includes(q.q)) return false;
  if (q.kind && str(row["kind"]) !== q.kind) return false;
  if (q.cloud && str(row["cloud"]) !== q.cloud) return false;
  if (q.aarsSeverity && str(row["aarsSeverity"]) !== q.aarsSeverity) return false;
  return true;
}

export function filterAssetRows(rows: Rec[], q: AssetTableQuery): Rec[] {
  return rows.filter((r) => matchesAssetQuery(r, q));
}

const byScore = (a: Rec, b: Rec): number => score(b["aars"]) - score(a["aars"]);

/** Every non-score sort breaks ties by AARS, so the riskiest row leads each group. */
export const ASSET_COMPARATORS: Record<AssetSort, (a: Rec, b: Rec) => number> = {
  aars: byScore,
  name: (a, b) => str(a["name"]).localeCompare(str(b["name"])),
  kind: (a, b) => str(a["kind"]).localeCompare(str(b["kind"])) || byScore(a, b),
  cloud: (a, b) => str(a["cloud"]).localeCompare(str(b["cloud"])) || byScore(a, b),
};

/** Sorted copy — the cached model's row array must never be reordered in place. */
export function sortAssetRows(rows: Rec[], sort: AssetSort): Rec[] {
  return [...rows].sort(ASSET_COMPARATORS[sort] ?? byScore);
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
