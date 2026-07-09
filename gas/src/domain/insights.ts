// Insight aggregations for the OS-vulnerabilities view: exploitability summary,
// risk concentration, aging buckets, scan-over-scan movement, top CVEs, and the
// configurable breakdown that replaces the findings table.
//
// GAS-first module (no Python fixture parity — the Streamlit side is discontinued).
// Pure functions over plain arrays: current-scan frame records (dotted keys, `_sev`
// normalized by findings.currentScan) or ledger base rows (durable lifecycle with
// age_days). Each function documents which source it expects and why.

import { RESOLVED_STATUSES } from "./config";
import type { BaseRow, ScanRow } from "./ledgerCore";
import { normalizeSeverity } from "./severity";
import type { Rec } from "./util";

// EPSS probability at or above this counts as a priority signal. 0.1 is the
// conventional operational cut (FIRST guidance treats >=0.1 as meaningful
// exploitation likelihood); 0.5 would qualify almost nothing in typical fleets.
export const EPSS_PRIORITY_THRESHOLD = 0.1;

export const AGE_BUCKET_EDGES = [7, 30, 90] as const;
export const AGE_BUCKET_LABELS = ["0-7d", "8-30d", "31-90d", "90+d"] as const;

const WIDE_KEY = "vulnerableAsset.hasWideInternetExposure";
const LIMITED_KEY = "vulnerableAsset.hasLimitedInternetExposure";

function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

function sev(r: Rec): string {
  const s = r["_sev"];
  return typeof s === "string" && s ? s : normalizeSeverity(r["severity"]);
}


function epssOf(r: Rec): number | null {
  const v = r["epssProbability"];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export interface ExploitSummary {
  open: number;
  kev: number;
  exploit: number;
  highEpss: number;
  internetExposed: number;
  // False when no record in the scan carries the exposure key at all — the slim
  // projection predates the field — as opposed to a genuine zero.
  exposureKnown: boolean;
}

export interface SeverityStat {
  total: number;
  open: number;
  resolved: number;
}

/**
 * Per-severity total / open / resolved over the current-scan frame — the severity
 * breakdown card's data (count with an "N open · N resolved" split). Open vs resolved
 * is the same status test the rest of this module uses; every record lands in exactly
 * one bucket, so open + resolved === total per severity.
 */
export function severityStats(records: Rec[]): Record<string, SeverityStat> {
  const out: Record<string, SeverityStat> = {};
  for (const r of records) {
    const s = sev(r);
    const stat = out[s] ?? (out[s] = { total: 0, open: 0, resolved: 0 });
    stat.total += 1;
    if (isOpen(r["status"])) stat.open += 1;
    else stat.resolved += 1;
  }
  return out;
}

/** Aggregate exploit signals over OPEN current-scan records (only the frame has them). */
export function exploitSummary(records: Rec[]): ExploitSummary {
  const out: ExploitSummary = {
    open: 0, kev: 0, exploit: 0, highEpss: 0, internetExposed: 0,
    exposureKnown: records.some((r) => WIDE_KEY in r && r[WIDE_KEY] !== undefined),
  };
  for (const r of records) {
    if (!isOpen(r["status"])) continue;
    out.open += 1;
    if (r["hasCisaKevExploit"] === true) out.kev += 1;
    if (r["hasExploit"] === true) out.exploit += 1;
    const epss = epssOf(r);
    if (epss !== null && epss >= EPSS_PRIORITY_THRESHOLD) out.highEpss += 1;
    if (r[WIDE_KEY] === true || r[LIMITED_KEY] === true) out.internetExposed += 1;
  }
  return out;
}

export interface AgeBuckets {
  perSev: Record<string, [number, number, number, number]>;
  totalOpen: number;
}

/**
 * Age distribution of still-open findings, bucketed 0-7 / 8-30 / 31-90 / 90+ days.
 * Input is ledger base rows because age_days derives from the durable first_seen
 * (survives re-detection); rows without an age (resolved, or missing first_seen)
 * are skipped.
 */
export function ageBuckets(rows: Pick<BaseRow, "severity" | "status" | "age_days">[]): AgeBuckets {
  const perSev: Record<string, [number, number, number, number]> = {};
  let totalOpen = 0;
  for (const row of rows) {
    if (!isOpen(row.status)) continue;
    const age = row.age_days;
    if (typeof age !== "number" || !Number.isFinite(age)) continue;
    const bucket = age <= AGE_BUCKET_EDGES[0] ? 0 : age <= AGE_BUCKET_EDGES[1] ? 1 : age <= AGE_BUCKET_EDGES[2] ? 2 : 3;
    const s = normalizeSeverity(row.severity);
    if (!perSev[s]) perSev[s] = [0, 0, 0, 0];
    perSev[s][bucket] += 1;
    totalOpen += 1;
  }
  return { perSev, totalOpen };
}

// Open findings older than this many days are the "aged" backlog the grouped
// oldest-views rank by — the 90+ tail of the age buckets above.
export const AGED_OPEN_EDGE = AGE_BUCKET_EDGES[2];

export interface OldestFinding {
  cve: string | null;
  asset: string | null;
  severity: string; // normalized
  ageDays: number;
}

export interface OldestGroup {
  key: string; // the group value ("(none)" for blank/missing)
  agedCount: number; // open findings older than AGED_OPEN_EDGE days
  openCount: number; // all open findings in the group
  oldestDays: number; // age of the group's single oldest open finding
}

export interface OldestOpen {
  findings: OldestFinding[];
  byAsset: OldestGroup[];
  bySupportGroup: OldestGroup[];
  byDomain: OldestGroup[];
}

type OldestRow = Pick<BaseRow, "cve" | "severity" | "status" | "asset_name" | "age_days"> & {
  _domain?: unknown;
  _supportGroup?: unknown;
};

/** Finite age of an open row, or null when resolved / missing (skipped by callers). */
function openAge(row: OldestRow): number | null {
  if (!isOpen(row.status)) return null;
  const age = row.age_days;
  return typeof age === "number" && Number.isFinite(age) ? age : null;
}

/**
 * Rank the busiest-aging groups: bucket open rows (with a finite age) by keyFn,
 * count the 90+ tail and the total open, track the single oldest, then order by
 * aged tail desc, oldest age desc, key asc. Empty groups never form (only open
 * rows are added); the result is capped to topN.
 */
function rankGroups(rows: OldestRow[], keyFn: (r: OldestRow) => string, topN: number): OldestGroup[] {
  const groups = new Map<string, OldestGroup>();
  for (const row of rows) {
    const age = openAge(row);
    if (age === null) continue;
    const raw = keyFn(row);
    const key = raw && raw.trim() !== "" ? raw : "(none)";
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, agedCount: 0, openCount: 0, oldestDays: 0 }));
    g.openCount += 1;
    if (age > AGED_OPEN_EDGE) g.agedCount += 1;
    if (age > g.oldestDays) g.oldestDays = age;
  }
  return [...groups.values()]
    .sort((a, b) => b.agedCount - a.agedCount || b.oldestDays - a.oldestDays || a.key.localeCompare(b.key))
    .slice(0, topN);
}

/**
 * The oldest open findings for the aging panel's four toggle views. `findings` is the
 * top-N individual open findings by age; `byAsset` / `bySupportGroup` / `byDomain` rank
 * those entities by their 90+ day open backlog (see rankGroups). Consumes ledger base
 * rows (age_days is durable); grouped views expect _domain / _supportGroup pre-attached
 * by the server (asset_name is native to the row).
 */
export function oldestOpen(rows: OldestRow[], topN = 7): OldestOpen {
  const findings: OldestFinding[] = rows
    .map((r) => ({ r, age: openAge(r) }))
    .filter((x): x is { r: OldestRow; age: number } => x.age !== null)
    .sort((a, b) => b.age - a.age)
    .slice(0, topN)
    .map(({ r, age }) => ({
      cve: r.cve,
      asset: r.asset_name,
      severity: normalizeSeverity(r.severity),
      ageDays: age,
    }));
  return {
    findings,
    byAsset: rankGroups(rows, (r) => String(r.asset_name ?? ""), topN),
    bySupportGroup: rankGroups(rows, (r) => String(r._supportGroup ?? ""), topN),
    byDomain: rankGroups(rows, (r) => String(r._domain ?? ""), topN),
  };
}

export interface Movement {
  newCount: number;
  resolvedCount: number;
  reopenedCount: number;
  persisting: number;
  hasPrevious: boolean;
}

/**
 * Scan-over-scan movement. New/resolved/reopened pass through from the latest flat
 * scan's ScanRow (reconcile computed them exactly; never re-derive); persisting =
 * open ledger rows seen in the latest scan that predate it.
 */
export function movement(
  baseRows: Pick<BaseRow, "status" | "first_scan_id" | "last_scan_id">[],
  latestFlatScan: Pick<ScanRow, "scan_id" | "new_count" | "resolved_count" | "reopened_count"> | null,
  scanCount: number,
): Movement {
  if (!latestFlatScan) {
    return { newCount: 0, resolvedCount: 0, reopenedCount: 0, persisting: 0, hasPrevious: scanCount > 1 };
  }
  let persisting = 0;
  for (const row of baseRows) {
    if (!isOpen(row.status)) continue;
    if (row.last_scan_id === latestFlatScan.scan_id && row.first_scan_id !== latestFlatScan.scan_id) {
      persisting += 1;
    }
  }
  return {
    newCount: latestFlatScan.new_count,
    resolvedCount: latestFlatScan.resolved_count,
    reopenedCount: latestFlatScan.reopened_count,
    persisting,
    hasPrevious: scanCount > 1,
  };
}

// Groupable dimensions for the multi-level breakdown — the dotted frame-record columns
// each dimension maps to (the old group-by vocabulary, plus CVE = the finding name).
export const GROUP_COLUMNS: Record<string, string> = {
  domain: "_domain",
  supportGroup: "_supportGroup",
  asset: "vulnerableAsset.name",
  atype: "vulnerableAsset.type",
  cloud: "vulnerableAsset.cloudPlatform",
  os: "vulnerableAsset.operatingSystem",
  subscription: "vulnerableAsset.subscriptionName",
  cve: "name",
};

export interface GroupNode {
  key: string; // the group value ("(none)" for blank/missing)
  dim: string; // the dimension this level groups by
  total: number;
  open: number;
  assets: number; // distinct affected assets in the group
  sevCounts: Record<string, number>;
  kev: boolean; // any finding in the group is a CISA KEV
  exploit: boolean; // any finding in the group has a public exploit
  children: GroupNode[]; // next level; [] at the deepest level
}

/**
 * Multi-level breakdown: group frame records by an ordered list of dimensions into a
 * nested tree (e.g. ["domain","asset"] → domains, each with its assets). Each level is
 * ranked busiest-first and capped; children are computed only for the kept nodes so the
 * tree stays bounded. Aggregates cover all records (open + resolved) like the old flat
 * breakdown; kev/exploit flag whether any finding in the group carries them.
 */
export function groupTree(records: Rec[], keys: string[], perLevelCap = 20): GroupNode[] {
  if (!keys.length || !records.length) return [];
  const [key, ...rest] = keys;
  const column = GROUP_COLUMNS[key];
  if (!column) return [];
  const buckets = new Map<string, Rec[]>();
  for (const r of records) {
    const raw = r[column];
    const k = raw === null || raw === undefined || String(raw).trim() === "" ? "(none)" : String(raw);
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, (arr = []));
    arr.push(r);
  }
  const rows = [...buckets.entries()].map(([k, recs]) => {
    const assets = new Set<string>();
    const sevCounts: Record<string, number> = {};
    let open = 0;
    let kev = false;
    let exploit = false;
    for (const r of recs) {
      if (isOpen(r["status"])) open += 1;
      const s = sev(r);
      sevCounts[s] = (sevCounts[s] ?? 0) + 1;
      const a = String(r["vulnerableAsset.name"] ?? "");
      if (a) assets.add(a);
      if (r["hasCisaKevExploit"] === true) kev = true;
      if (r["hasExploit"] === true) exploit = true;
    }
    const node: GroupNode = {
      key: k, dim: key, total: recs.length, open, assets: assets.size,
      sevCounts, kev, exploit, children: [],
    };
    return { recs, node };
  });
  rows.sort((a, b) => b.node.total - a.node.total || a.node.key.localeCompare(b.node.key));
  const kept = rows.slice(0, perLevelCap);
  if (rest.length) {
    for (const row of kept) row.node.children = groupTree(row.recs, rest, perLevelCap);
  }
  return kept.map((row) => row.node);
}
