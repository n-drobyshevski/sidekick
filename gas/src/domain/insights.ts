// Insight aggregations for the OS-vulnerabilities view: exploitability summary,
// risk concentration, aging buckets, scan-over-scan movement, top CVEs, and the
// configurable breakdown that replaces the findings table.
//
// GAS-first module (no Python fixture parity — the Streamlit side is discontinued).
// Pure functions over plain arrays: current-scan frame records (dotted keys, `_sev`
// normalized by findings.currentScan) or ledger base rows (durable lifecycle with
// age_days). Each function documents which source it expects and why.

import { RESOLVED_STATUSES, SEVERITY_ORDER } from "./config";
import type { BaseRow, ScanRow } from "./ledgerCore";
import { normalizeSeverity } from "./severity";
import type { Rec } from "./util";

// EPSS probability at or above this counts as a priority signal. 0.1 is the
// conventional operational cut (FIRST guidance treats >=0.1 as meaningful
// exploitation likelihood); 0.5 would qualify almost nothing in typical fleets.
export const EPSS_PRIORITY_THRESHOLD = 0.1;

// Severity weight used to rank risk concentration by asset (topAssets).
export const SEVERITY_WEIGHT: Record<string, number> = {
  CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0, UNKNOWN: 0,
};

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

/** Lower = more severe (SEVERITY_ORDER index; unknown values sink to the end). */
function sevIndex(s: string): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(s);
  return i === -1 ? SEVERITY_ORDER.length : i;
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

export interface AssetConcentration {
  asset: string;
  total: number;
  weighted: number;
  sevCounts: Record<string, number>;
}

/**
 * Risk concentration: OPEN frame records grouped by asset, ranked by
 * severity-weighted count. Frame (not baseRows) so the picture is the current
 * scan's — baseRows include "(compacted)" placeholder assets.
 */
export function topAssets(records: Rec[], n = 10): AssetConcentration[] {
  const byAsset = new Map<string, AssetConcentration>();
  for (const r of records) {
    if (!isOpen(r["status"])) continue;
    const name = String(r["vulnerableAsset.name"] ?? "") || "(unknown)";
    let g = byAsset.get(name);
    if (!g) {
      g = { asset: name, total: 0, weighted: 0, sevCounts: {} };
      byAsset.set(name, g);
    }
    const s = sev(r);
    g.total += 1;
    g.weighted += SEVERITY_WEIGHT[s] ?? 0;
    g.sevCounts[s] = (g.sevCounts[s] ?? 0) + 1;
  }
  return [...byAsset.values()]
    .sort((a, b) => b.weighted - a.weighted || b.total - a.total || a.asset.localeCompare(b.asset))
    .slice(0, n);
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

export interface CveSpread {
  cve: string;
  severity: string;
  assets: number;
  findings: number;
  kev: boolean;
  exploit: boolean;
}

/** Top CVEs by distinct affected assets, over OPEN frame records. */
export function topCves(records: Rec[], n = 10): CveSpread[] {
  const byCve = new Map<string, { assets: Set<string>; findings: number; sevIdx: number; kev: boolean; exploit: boolean }>();
  for (const r of records) {
    if (!isOpen(r["status"])) continue;
    const cve = String(r["name"] ?? "") || "(unknown)";
    let g = byCve.get(cve);
    if (!g) {
      g = { assets: new Set(), findings: 0, sevIdx: SEVERITY_ORDER.length, kev: false, exploit: false };
      byCve.set(cve, g);
    }
    g.findings += 1;
    const asset = String(r["vulnerableAsset.name"] ?? "");
    if (asset) g.assets.add(asset);
    g.sevIdx = Math.min(g.sevIdx, sevIndex(sev(r)));
    if (r["hasCisaKevExploit"] === true) g.kev = true;
    if (r["hasExploit"] === true) g.exploit = true;
  }
  return [...byCve.entries()]
    .map(([cve, g]) => ({
      cve,
      severity: (SEVERITY_ORDER as readonly string[])[g.sevIdx] ?? "UNKNOWN",
      assets: g.assets.size,
      findings: g.findings,
      kev: g.kev,
      exploit: g.exploit,
    }))
    .sort((a, b) => b.assets - a.assets || b.findings - a.findings || a.cve.localeCompare(b.cve))
    .slice(0, n);
}

// Grouping keys for the configurable breakdown (mirrors the old table's group-by map).
export const BREAKDOWN_KEYS: Record<string, string> = {
  domain: "_domain",
  subscription: "vulnerableAsset.subscriptionName",
  asset: "vulnerableAsset.name",
  atype: "vulnerableAsset.type",
  cloud: "vulnerableAsset.cloudPlatform",
  os: "vulnerableAsset.operatingSystem",
};

export interface BreakdownGroup {
  key: string;
  total: number;
  open: number;
  share: number;
  sevCounts: Record<string, number>;
}

/**
 * The ranked breakdown that replaces the findings table: all frame records (open
 * and resolved — the severity mix should match the breakdown chart) grouped by one
 * of BREAKDOWN_KEYS, busiest first, capped.
 */
export function breakdown(records: Rec[], byKey: string, max = 15): BreakdownGroup[] {
  const column = BREAKDOWN_KEYS[byKey];
  if (!column || !records.length) return [];
  const groups = new Map<string, BreakdownGroup>();
  for (const r of records) {
    const raw = r[column];
    const key = raw === null || raw === undefined || String(raw).trim() === "" ? "(none)" : String(raw);
    let g = groups.get(key);
    if (!g) {
      g = { key, total: 0, open: 0, share: 0, sevCounts: {} };
      groups.set(key, g);
    }
    g.total += 1;
    if (isOpen(r["status"])) g.open += 1;
    const s = sev(r);
    g.sevCounts[s] = (g.sevCounts[s] ?? 0) + 1;
  }
  const out = [...groups.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  for (const g of out) g.share = g.total / records.length;
  return out.slice(0, max);
}
