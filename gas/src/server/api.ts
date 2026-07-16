// google.script.run API surface. Every endpoint returns {ok, data} | {ok:false,
// error} so the client wrapper promisifies uniformly. Reads never take the script
// lock; mutations run inside withScriptLock + recoverIfNeeded.

import {
  FAST_LANE_DAYS,
  SEVERITY_COLORS,
  SEVERITY_GLYPHS,
  SEVERITY_ORDER,
  SLA_TARGETS,
  SELECTABLE_SEVERITIES,
} from "../domain/config";
import { domainNames, validateDomains, compileDomains, assignDomain, assignDomains, UNASSIGNED } from "../domain/domainRules";
import { coverage, ruleHealth, unassignedResources, untaggedSubscriptions } from "../domain/attribution";
import { mttrFromLedger, vulnKey } from "../domain/lifecycle";
import type { BaseRow } from "../domain/ledgerCore";
import { extractNodes } from "../domain/transform";
import { overallSlaOldest } from "../domain/metrics";
import { normalizeSeverity } from "../domain/severity";
import {
  fastLaneSplit,
  kmMedian,
  mttrPercentiles,
  openPastSla,
  resolutionBuckets,
} from "../domain/remediation";
import { validateBundle } from "../domain/importMerge";
import { SealedScanError, LedgerRebuildError } from "../domain/maintenance";
import { parseTs, present, type Rec } from "../domain/util";
import { openBySeverityTrend } from "../domain/trend";
import * as insights from "../domain/insights";
import * as archive from "./archiveStore";
import * as findings from "./findings";
import * as history from "./historyStore";
import { activeJob, getJob } from "./jobsStore";
import * as ledgerStore from "./ledgerStore";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { hasWizCredentials } from "./props";
import * as scanJobs from "./scanJobs";
import { cached, dataVersion } from "./serverCache";
import * as settingsStore from "./settingsStore";
import { cellCount } from "./sheetsDb";
import * as supportGroups from "./supportGroups";

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  errorKind?: string;
}

function run<T>(fn: () => T): ApiResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    const kind =
      e instanceof SealedScanError
        ? "sealed"
        : e instanceof LedgerRebuildError
          ? "rebuild"
          : e instanceof LedgerBusyError
            ? "busy"
            : "error";
    return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: kind };
  }
}

function mutate<T>(fn: () => T): ApiResult<T> {
  return run(() =>
    withScriptLock(() => {
      recoverIfNeeded();
      return fn();
    }),
  );
}

// ------------------------------------------------------------------------ bootstrap

export function bootstrap(_p?: unknown): ApiResult {
  return run(() => ({
    // The core is a pure function of ledger + settings state — cached per DATA_VERSION.
    ...(cached("bootstrapCore", null, bootstrapCore) as Rec),
    // Live per-request fields: never cached (activeJob changes every poll tick).
    dataVersion: dataVersion(),
    hasCredentials: hasWizCredentials(),
    activeJob: activeJobSummary(),
  }));
}

function bootstrapCore(): Rec {
  const scan = findings.currentScan();
  const latest = ledgerStore.latestScanRow();
  const counts: Record<string, number> = {};
  let unassignedCount = 0;
  if (scan) {
    for (const r of scan.records) {
      const sev = String(r["_sev"]);
      counts[sev] = (counts[sev] ?? 0) + 1;
      if (r["_domain"] === UNASSIGNED) unassignedCount += 1;
    }
  }
  return {
    palette: {
      order: SEVERITY_ORDER,
      colors: SEVERITY_COLORS,
      glyphs: SEVERITY_GLYPHS,
      slaTargets: SLA_TARGETS,
      selectable: SELECTABLE_SEVERITIES,
    },
    settings: {
      fetchSeverities: settingsStore.getFetchSeverities(),
      displaySeverities: settingsStore.getDisplaySeverities(),
      retentionDays: settingsStore.getRetentionDays(),
      autoCompact: settingsStore.getAutoCompact(),
      domains: settingsStore.getDomains(),
    },
    latestScan: latest
      ? {
          scanId: latest.scan_id,
          ts: latest.ts,
          mode: latest.mode,
          shape: latest.shape,
          total: latest.total,
          severities: latest.severities,
        }
      : null,
    counts,
    unassignedCount,
    prevCounts: ledgerStore.previousSeverityCounts(),
    domainNames: domainNames(settingsStore.getDomains().items),
    filterOptions: scan
      ? {
          statuses: findings.distinct(scan.records, "status"),
          assetTypes: findings.distinct(scan.records, "vulnerableAsset.type"),
          clouds: findings.distinct(scan.records, "vulnerableAsset.cloudPlatform"),
          subscriptions: findings.distinct(scan.records, "vulnerableAsset.subscriptionName"),
          supportGroups: findings.distinct(scan.records, "_supportGroup"),
        }
      : { statuses: [], assetTypes: [], clouds: [], subscriptions: [], supportGroups: [] },
  };
}

function activeJobSummary(): Rec | null {
  return (activeJob() as unknown as Rec) ?? null;
}

// ------------------------------------------------------------------------- findings

export function getFindings(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const scan = findings.currentScan();
    if (!scan) return { rows: [], total: 0, counts: {}, page: 0, pageCount: 0, groups: null };

    const filters: findings.FindingsFilters = {
      severities:
        (params["severities"] as string[]) ?? settingsStore.getDisplaySeverities(),
      statuses: (params["statuses"] as string[]) ?? [],
      assetTypes: (params["assetTypes"] as string[]) ?? [],
      clouds: (params["clouds"] as string[]) ?? [],
      domains: (params["domains"] as string[]) ?? [],
      supportGroups: (params["supportGroups"] as string[]) ?? [],
      q: (params["q"] as string) ?? "",
    };
    const filtered = findings.applyFilters(scan.records, filters);

    const counts: Record<string, number> = {};
    for (const r of filtered) {
      const sev = String(r["_sev"]);
      counts[sev] = (counts[sev] ?? 0) + 1;
    }

    const groupBy = (params["groupBy"] as string) ?? "";
    if (groupBy) {
      const keyFor = groupKeyFn(groupBy);
      const groups = new Map<string, Rec[]>();
      for (const r of filtered) {
        const k = keyFor(r);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
      }
      const ordered = [...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 30); // group cap, matching the Streamlit page
      return {
        rows: [],
        total: filtered.length,
        counts,
        page: 0,
        pageCount: 0,
        groups: ordered.map(([key, rows]) => ({
          key,
          count: rows.length,
          sevCounts: sevCountsOf(rows),
          rows: rows.slice(0, 250).map(findings.tableRow), // per-group row cap
        })),
      };
    }

    // Full-projection mode for the client-side filter path: small scans ship every
    // row once so the browser can filter/search/group/paginate with zero further
    // RPCs. Larger result sets answer with the normal first page (all: absent) and
    // the client falls back to server-side filtering.
    if (params["all"] === true && filtered.length <= CLIENT_ALL_MAX) {
      return {
        rows: filtered.map(findings.tableRow),
        total: filtered.length,
        counts,
        page: 0,
        pageCount: 1,
        groups: null,
        all: true,
      };
    }

    const pageSize = Math.min(Number(params["pageSize"] ?? 100), 500);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(Math.max(Number(params["page"] ?? 0), 0), pageCount - 1);
    return {
      rows: filtered.slice(page * pageSize, (page + 1) * pageSize).map(findings.tableRow),
      total: filtered.length,
      counts,
      page,
      pageCount,
      groups: null,
    };
  });
}

// Row ceiling for getFindings all-mode (~1–2 MB of table-projected JSON).
const CLIENT_ALL_MAX = 3000;

function groupKeyFn(groupBy: string): (r: Rec) => string {
  const col: Record<string, string> = {
    severity: "_sev",
    status: "status",
    atype: "vulnerableAsset.type",
    cloud: "vulnerableAsset.cloudPlatform",
    asset: "vulnerableAsset.name",
    subscription: "vulnerableAsset.subscriptionName",
    domain: "_domain",
    supportGroup: "_supportGroup",
  };
  const c = col[groupBy] ?? "_sev";
  return (r) => (present(r[c]) ? String(r[c]) : "(none)");
}

/** A params array field (e.g. the Overview support-group multi-select) as string[]. */
function readStringArray(p: unknown, key: string): string[] {
  const raw = (p as Rec)?.[key];
  return Array.isArray(raw) ? (raw as unknown[]).map(String) : [];
}

/**
 * Support-group predicate combining the global sidebar single-select (`single`) and the
 * page multi-select (`set`) by INTERSECTION: a value must satisfy both filters that are
 * active. Either empty means that filter is inactive (no narrowing).
 */
function supportGroupPredicate(single: string, set: string[]): (v: string) => boolean {
  const keep = set.length ? new Set(set) : null;
  return (v) => (!single || v === single) && (!keep || keep.has(v));
}

function sevCountsOf(rows: Rec[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const sev = String(r["_sev"]);
    out[sev] = (out[sev] ?? 0) + 1;
  }
  return out;
}

export function getFindingDetail(p?: unknown): ApiResult {
  return run(() => {
    const key = String((p as Rec)?.["vulnKey"] ?? "");
    const scan = findings.currentScan();
    if (!scan || !key) return { record: null, raw: null };
    const record = scan.records.find((r) => r["_vuln_key"] === key) ?? null;
    // The raw node (full fields) lives in the scan's page archive. The frame tags each
    // record with its page, so normally exactly one page file is read; scans persisted
    // before the frame existed fall back to walking the whole archive.
    let raw: Rec | null = null;
    const pageNo = record && typeof record["_page"] === "number" ? record["_page"] : null;
    if (pageNo !== null) {
      const page = archive.readScanPage(scan.scanId, pageNo);
      if (page) raw = (extractNodes(page).find((n) => vulnKey(n) === key) as Rec) ?? null;
    }
    if (!raw) {
      const row = ledgerStore.loadScanRows().find((s) => s.scan_id === scan.scanId);
      const payload = row ? archive.readScanPayload(row.raw_ref) : null;
      if (payload && Array.isArray(payload)) {
        for (const page of payload) {
          const nodes = extractNodes(page);
          raw = (nodes.find((n) => vulnKey(n) === key) as Rec) ?? null;
          if (raw) break;
        }
      }
    }
    return { record, raw };
  });
}

// --------------------------------------------------------------------------- insights

/**
 * Everything the insights view needs in one round trip: exploitability summary,
 * risk concentration, aging, movement, top CVEs, and all six breakdown groupings
 * (so the client's grouping switch repaints with zero RPCs). Current-scan blocks
 * read the frame (only it has exploit/exposure fields); aging and movement read
 * the durable ledger.
 */
function insightsData(p?: unknown): Rec {
  const scan = findings.currentScan();
  if (!scan) return { flatScan: false };
  // Global "Value Chain" filter: "" means the whole chain (no filter). The frame
  // records already carry _domain (findings.currentScan); base rows get it assigned
  // here, mirroring mttrData/baseRowsData. Filter up front and feed the existing
  // aggregations unchanged — no insights.ts signature changes.
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  const sgActive = Boolean(supportGroup) || supportGroupSet.length > 0;
  const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
  let recs = scan.records;
  let base = ledgerStore.loadBaseRows();
  // Base rows carry no _supportGroup / _domain natively (only asset_name), so attach
  // both up front — unconditionally, because the oldest-open grouped views rank by them
  // even at the whole-chain view. attachSupportGroups resolves _supportGroup from the
  // current map; _domain is assigned per row like the frame's (findings.currentScan).
  supportGroups.attachSupportGroups(base as unknown as Rec[]);
  const compiled = compileDomains(settingsStore.getDomains().items);
  for (const r of base as unknown as Rec[]) r["_domain"] = assignDomain(r, compiled);
  if (domain || sgActive) {
    if (sgActive) {
      recs = recs.filter((r) => sgMatch(String(r["_supportGroup"] ?? "")));
      base = base.filter((r) => sgMatch(String((r as unknown as Rec)["_supportGroup"] ?? "")));
    }
    if (domain) {
      recs = recs.filter((r) => String(r["_domain"] ?? UNASSIGNED) === domain);
      base = base.filter((r) => String((r as unknown as Rec)["_domain"] ?? UNASSIGNED) === domain);
    }
  }
  const severities = readSeverities(p);
  recs = filterSeverities(recs, severities);
  base = filterSeverities(base as unknown as Rec[], severities) as unknown as typeof base;
  const latestFlat = ledgerStore.latestFlatScanRow();
  return {
    flatScan: true,
    domain,
    supportGroup,
    scan: { scanId: scan.scanId, ts: scan.ts, total: scan.total },
    // Domain-scoped severity counts + total so the Overview headline can stay
    // coherent under a filter (the KPI band otherwise reads whole-scan bootstrap
    // counts). Movement's new/resolved/reopened remain chain-wide — see below.
    counts: sevCountsOf(recs),
    total: recs.length,
    // Per-severity total/open/resolved for the severity breakdown card.
    sevStats: insights.severityStats(recs),
    // Open findings per severity over time — powers the breakdown line chart. Uses the
    // already-scoped base + severities so the series matches the counts shown beside it.
    openTrend: openBySeverityTrend(
      ledgerStore.loadScanRows() as unknown as Rec[],
      base as unknown as Rec[],
      severities,
    ),
    exploit: insights.exploitSummary(recs),
    aging: insights.ageBuckets(base),
    // Top oldest open findings + 90+ backlog per asset / support group / domain,
    // for the aging panel's toggle (repaints client-side, no extra RPC).
    oldest: insights.oldestOpen(base as unknown as Parameters<typeof insights.oldestOpen>[0]),
    movement: insights.movement(base, latestFlat, ledgerStore.loadScanRows().length),
  };
}

export function getInsights(p?: unknown): ApiResult {
  // 1h TTL like the MTTR summary: aging carries wall-clock-relative day counts.
  // Keyed on domain so per-chain payloads don't clobber each other.
  return run(() =>
    cached(
      "insights",
      {
        domain: String((p as Rec)?.["domain"] ?? ""),
        supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
        supportGroups: readStringArray(p, "supportGroups"),
        severities: readSeverities(p),
      },
      () => insightsData(p),
      3600,
    ),
  );
}

// ------------------------------------------------------------------------- grouping

/** Frame records for the current scan, scoped to a Value Chain and/or Support Group(s). */
function scopedFrameRecords(domain: string, supportGroup: string, supportGroupSet: string[]): Rec[] {
  const scan = findings.currentScan();
  if (!scan) return [];
  let recs = scan.records;
  if (supportGroup || supportGroupSet.length) {
    const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
    recs = recs.filter((r) => sgMatch(String(r["_supportGroup"] ?? "")));
  }
  if (domain) recs = recs.filter((r) => String(r["_domain"] ?? UNASSIGNED) === domain);
  return recs;
}

/** The multi-level breakdown tree for an ordered list of grouping dimensions. */
function groupingData(p?: unknown): Rec {
  const scan = findings.currentScan();
  if (!scan) return { flatScan: false, keys: [], groups: [] };
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  const raw = (p as Rec)?.["keys"];
  const keys = (Array.isArray(raw) ? (raw as unknown[]).map(String) : [])
    .filter((k) => k in insights.GROUP_COLUMNS);
  return {
    flatScan: true,
    keys,
    groups: insights.groupTree(
      filterSeverities(
        scopedFrameRecords(domain, supportGroup, supportGroupSet), readSeverities(p)),
      keys),
  };
}

export function getGrouping(p?: unknown): ApiResult {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  const raw = (p as Rec)?.["keys"];
  const keys = Array.isArray(raw) ? (raw as unknown[]).map(String) : [];
  return run(() =>
    cached("grouping",
      { domain, supportGroup, supportGroups: supportGroupSet, keys, severities: readSeverities(p) },
      () => groupingData(p), 3600),
  );
}

// --------------------------------------------------------------------- attribution

/**
 * Everything the "Attribution" page needs in one round trip: coverage KPIs, per-rule
 * fired/matched health, the full (unpaginated) unassigned-resource explorer rows,
 * untagged-subscription rollups, and whether the support-group map is configured.
 * Deliberately ignores the global Value-Chain / Support-group filters — the page
 * audits the mapping itself, not a filtered view of it.
 */
function attributionData(p?: unknown): Rec {
  const scan = findings.currentScan();
  if (!scan) return { flatScan: false };
  const recs = filterSeverities(scan.records, readSeverities(p));
  const dom = settingsStore.getDomains();
  const compiled = compileDomains(dom.items);
  const sgMap = settingsStore.getSupportGroupMap();
  const sgKeys = Object.keys(sgMap.map);
  return {
    flatScan: true,
    scan: { scanId: scan.scanId, ts: scan.ts },
    coverage: coverage(recs, domainNames(dom.items)),
    ruleHealth: ruleHealth(recs, compiled),
    unassignedAll: unassignedResources(recs, compiled),
    untagged: untaggedSubscriptions(recs).slice(0, 200),
    supportGroupMap: { configured: sgKeys.length > 0, keys: sgKeys.length },
  };
}

/** Attribution page in one round trip; the whole payload is cached per DATA_VERSION +
 *  severities, and `unassignedAll` is paginated OUTSIDE the cache so every page shares
 *  one cached compute. */
export function getAttribution(p?: unknown): ApiResult {
  return run(() => {
    const data = cached("attribution", { severities: readSeverities(p) }, () => attributionData(p));
    if (!(data as Rec)["flatScan"]) return data;
    const { unassignedAll, ...rest } = data as Rec & { unassignedAll: unknown[] };
    const params = (p ?? {}) as Rec;
    const pageSize = Math.min(Math.max(Number(params["pageSize"] ?? 50), 1), 200);
    const pageCount = Math.max(1, Math.ceil(unassignedAll.length / pageSize));
    const page = Math.min(Math.max(Number(params["page"] ?? 0), 0), pageCount - 1);
    return {
      ...rest,
      unassigned: {
        rows: unassignedAll.slice(page * pageSize, (page + 1) * pageSize),
        total: unassignedAll.length,
        page,
        pageCount,
      },
    };
  });
}

// ----------------------------------------------------------------------------- MTTR

// The severity subset the MTTR page (or any caller) restricts to; null/absent means
// every severity. Read once, keyed on identically, and applied identically everywhere.
function readSeverities(p?: unknown): string[] | null {
  const raw = (p as Rec)?.["severities"];
  return Array.isArray(raw) ? (raw as unknown[]).map(String) : null;
}

// Restrict ledger rows to the chosen severities (+ UNKNOWN, never hidden) — mirrors the
// trend path (trendFromFrames) so the summary, by-domain split, and trend all filter the
// same way. A null list means "all severities" and skips the filter entirely.
function filterSeverities(rows: Rec[], severities: string[] | null): Rec[] {
  if (severities === null || !rows.length) return rows;
  const keep = new Set([...severities, "UNKNOWN"]);
  return rows.filter((r) => keep.has(normalizeSeverity(r["severity"])));
}

function mttrData(p?: unknown): Rec {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  let rows: Rec[] = ledgerStore.loadBaseRows() as unknown as Rec[];
  if (domain || supportGroup) {
    supportGroups.attachSupportGroups(rows);
    if (supportGroup) rows = rows.filter((r) => String(r["_supportGroup"] ?? "") === supportGroup);
    if (domain) {
      const compiled = compileDomains(settingsStore.getDomains().items);
      rows = rows.filter((r) => assignDomain(r, compiled) === domain);
    }
  }
  rows = filterSeverities(rows, readSeverities(p));
  const { perSev, overall } = mttrFromLedger(rows);
  const { slaPct, oldestDays } = overallSlaOldest(perSev);
  // Remediation-tail block over the same scoped rows (BaseRows cast to Rec by loadBaseRows;
  // cast back for the typed remediation projection). thresholdDays rides in the payload
  // because the client bundle can't import the TS domain constant FAST_LANE_DAYS.
  const remRows = rows as unknown as BaseRow[];
  const remediation = {
    pctiles: mttrPercentiles(remRows),
    fastLane: { ...fastLaneSplit(remRows), thresholdDays: FAST_LANE_DAYS },
    buckets: resolutionBuckets(remRows),
    kmMedian: kmMedian(remRows),
    openPastSla: openPastSla(remRows),
  };
  return { perSev, overall, slaPct, oldestDays, rowCount: rows.length, remediation };
}

function mttrTrendData(p?: unknown): Rec {
  const severities = readSeverities(p);
  return {
    history: history.loadHistory(),
    trend: ledgerStore.loadTrend(severities),
  };
}

// Per-domain remediation summary for the "By domain" section shown at the whole-chain
// (aggregate) view — a value chain is composed of domains, so this splits the same
// ledger base rows the MTTR hero uses by their assigned domain. Priority order (with
// Unassigned last), empty domains omitted. Reuses mttrFromLedger/overallSlaOldest, so
// no domain-layer change.
function mttrByDomainData(p?: unknown): Rec {
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  let rows = filterSeverities(
    ledgerStore.loadBaseRows() as unknown as Rec[],
    readSeverities(p),
  );
  supportGroups.attachSupportGroups(rows);
  if (supportGroup) rows = rows.filter((r) => String(r["_supportGroup"] ?? "") === supportGroup);
  const items = settingsStore.getDomains().items;
  const compiled = compileDomains(items);
  const assigned = assignDomains(rows, compiled);
  const buckets = new Map<string, Rec[]>();
  rows.forEach((r, i) => {
    const name = assigned[i] ?? UNASSIGNED;
    let arr = buckets.get(name);
    if (!arr) buckets.set(name, (arr = []));
    arr.push(r);
  });
  const out: Rec[] = [];
  for (const name of domainNames(items)) {
    const drows = buckets.get(name);
    if (!drows || !drows.length) continue;
    const { perSev, overall } = mttrFromLedger(drows);
    const { slaPct, oldestDays } = overallSlaOldest(perSev);
    out.push({
      domain: name,
      median: overall.mttr_median ?? null,
      slaPct,
      oldestDays,
      open: overall.open ?? 0,
      resolved: overall.resolved ?? 0,
      tracked: drows.length,
    });
  }
  return { rows: out };
}

// Cached per DATA_VERSION, keyed on exactly the params each computation reads — so
// the single and batched endpoints share entries regardless of extra params.
// The MTTR summary carries wall-clock-relative open ages (p50/p90/oldest), so its
// TTL is 1h — a ≤0.04-day drift — instead of the 6h the version-keyed data allows.
const cachedMttrData = (p?: unknown) =>
  cached(
    // "mttr" → "mttr2": payload gained the `remediation` block; dataVersion persists across
    // deploys, so bumping the namespace prevents serving a stale old-shape entry (up to 1h).
    "mttr2",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
    },
    () => mttrData(p),
    3600,
  );
const cachedMttrTrendData = (p?: unknown) =>
  // "mttrTrend" → "mttrTrend2": trend points gained `open_past_sla`; namespace bump avoids a
  // stale old-shape entry surviving the deploy under the persistent dataVersion.
  cached("mttrTrend2", { severities: readSeverities(p) }, () => mttrTrendData(p));
// Domain-independent (always all domains); severity-scoped; 1h TTL like the summary
// (carries open ages).
const cachedMttrByDomainData = (p?: unknown) =>
  cached(
    "mttrByDomain",
    {
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
    },
    () => mttrByDomainData(p),
    3600,
  );

export function getMttr(p?: unknown): ApiResult {
  return run(() => cachedMttrData(p));
}

export function getMttrTrend(p?: unknown): ApiResult {
  return run(() => cachedMttrTrendData(p));
}

/** MTTR page in one round trip (summary + trends share one state load). byDomain is
 *  the per-domain split for the whole-chain view only — omitted when a specific value
 *  chain is selected (the page is already that one domain). */
export function getMttrPage(p?: unknown): ApiResult {
  const domain = String((p as Rec)?.["domain"] ?? "");
  return run(() => ({
    mttr: cachedMttrData(p),
    trends: cachedMttrTrendData(p),
    byDomain: domain ? null : cachedMttrByDomainData(p),
  }));
}

// --------------------------------------------------------------------- scan history

function scanHistoryData(): Rec {
  const scans = ledgerStore.loadScanRows().slice().reverse(); // newest first
  const base = ledgerStore.loadBaseRows();
  const open = base.filter((r) => r.status === "OPEN").length;
  const resolved = base.filter((r) => r.status === "RESOLVED").length;
  const { overall } = mttrFromLedger(base as unknown as Rec[]);
  return {
    scans,
    kpis: {
      tracked: base.length,
      open,
      resolvedAllTime: resolved,
      medianMttr: overall.mttr_median ?? null,
    },
  };
}

const cachedScanHistoryData = () => cached("scanHistory", null, scanHistoryData);

export function getScanHistory(_p?: unknown): ApiResult {
  return run(() => cachedScanHistoryData());
}

/** History page in one round trip: scans + KPIs + trends. */
export function getHistoryPage(p?: unknown): ApiResult {
  return run(() => ({
    history: cachedScanHistoryData(),
    trends: cachedMttrTrendData(p),
  }));
}

// ------------------------------------------------------------------ jobs & mutations

export function runScan(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  return run(() =>
    scanJobs.startScan({
      incremental: Boolean(params["incremental"]),
      sampleShape: (params["sampleShape"] as string) ?? undefined,
    }),
  );
}

export function getJobStatus(p?: unknown): ApiResult {
  return run(() => {
    const jobId = String((p as Rec)?.["jobId"] ?? "");
    return jobId ? getJob(jobId) : activeJobSummary();
  });
}

export function cancelScan(p?: unknown): ApiResult {
  return run(() => scanJobs.cancelScan(String((p as Rec)?.["jobId"] ?? "")));
}

export function deleteScans(p?: unknown): ApiResult {
  const scanIds = (((p as Rec)?.["scanIds"] as string[]) ?? []).map(String);
  return mutate(() => ledgerStore.deleteScans(scanIds));
}

export function compact(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  const dryRun = Boolean(params["dryRun"]);
  const days =
    params["retentionDays"] !== undefined
      ? Number(params["retentionDays"])
      : settingsStore.getRetentionDays();
  if (dryRun) return run(() => ledgerStore.compactLedger(days, true));
  return mutate(() => ledgerStore.compactLedger(days, false));
}

// --------------------------------------------------------------------------- import

/** One-shot migration import: a Streamlit bundle merged into the ledger + history. */
// The client gzips large payloads to fit google.script.run; ungzip here. `fallbackKey`
// lets older/no-gzip callers still send the parsed object (e.g. `bundle`, `manifest`).
function payloadOf(params: Rec, fallbackKey: string): unknown {
  if (typeof params["gzipB64"] === "string") {
    return JSON.parse(
      Utilities.ungzip(
        Utilities.newBlob(Utilities.base64Decode(params["gzipB64"] as string), "application/x-gzip"),
      ).getDataAsString("UTF-8"),
    );
  }
  return params[fallbackKey];
}

export function importMigration(p?: unknown): ApiResult {
  return mutate(() => {
    const params = (p ?? {}) as Rec;
    const bundle = validateBundle(payloadOf(params, "bundle"));
    const counts = ledgerStore.importBundle(bundle);
    const hist = history.importHistory(bundle.mttr_history);
    return { ...counts, history_added: hist.added, history_skipped: hist.skipped };
  });
}

// ------------------------------------------------------- sharded (multi-part) import
export function importBegin(p?: unknown): ApiResult {
  return mutate(() => ledgerStore.importBeginSharded(payloadOf((p ?? {}) as Rec, "manifest")));
}

export function importShard(p?: unknown): ApiResult {
  return mutate(() => {
    const params = (p ?? {}) as Rec;
    const shard = payloadOf(params, "shard") as Rec;
    const index = Number(params["index"] ?? shard?.["index"] ?? 0);
    return ledgerStore.importApplyShard(String(params["sessionId"] ?? ""), index, {
      ledger: (shard?.["ledger"] as Rec[]) ?? [],
      episodes: (shard?.["episodes"] as Rec[]) ?? [],
    });
  });
}

export function importFinalize(p?: unknown): ApiResult {
  return mutate(() =>
    ledgerStore.importFinalizeSharded(String(((p ?? {}) as Rec)["sessionId"] ?? "")),
  );
}

export function importAbort(p?: unknown): ApiResult {
  return mutate(() =>
    ledgerStore.importAbortSharded(String(((p ?? {}) as Rec)["sessionId"] ?? "")),
  );
}

export function importStatus(p?: unknown): ApiResult {
  return run(() => {
    const jobId = String(((p ?? {}) as Rec)["jobId"] ?? "");
    return jobId ? getJob(jobId) : activeJobSummary();
  });
}

/** Wipe the ledger back to a fresh, never-compacted state (so a migration import can run). */
export function resetLedger(): ApiResult {
  return mutate(() => {
    // Best-effort: drop any continuation trigger first so a running scan can't repopulate the
    // tabs after the wipe (a stray one no-ops once the jobs tab is cleared, but stop it early).
    try {
      scanJobs.clearContinuationTriggers();
    } catch (e) {
      console.warn(`resetLedger: continuation-trigger cleanup skipped: ${e}`);
    }
    return ledgerStore.resetLedger();
  });
}

// -------------------------------------------------------------------------- reports

const REPORT_SOURCE = "OS vulnerabilities";

export function getReport(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const format = String(params["format"] ?? "markdown");
    const scan = findings.currentScan();
    if (!scan) return { content: "", filename: "", matrix: [] };
    // Honor the global "Value Chain" and "Support group" filters (empty = no filter).
    const domains = (params["domains"] as string[]) ?? [];
    const sgFilter = (params["supportGroups"] as string[]) ?? [];
    const displayed = findings.applyFilters(scan.records, {
      severities: settingsStore.getDisplaySeverities(),
      domains,
      supportGroups: sgFilter,
    });
    const counts = sevCountsOf(displayed);
    let baseRows = ledgerStore.loadBaseRows() as unknown as Rec[];
    if (domains.length || sgFilter.length) {
      supportGroups.attachSupportGroups(baseRows);
      if (sgFilter.length) {
        const keep = new Set(sgFilter);
        baseRows = baseRows.filter((r) => keep.has(String(r["_supportGroup"] ?? "")));
      }
      if (domains.length) {
        const compiled = compileDomains(settingsStore.getDomains().items);
        baseRows = baseRows.filter((r) => domains.includes(assignDomain(r, compiled)));
      }
    }
    const { perSev, overall } = mttrFromLedger(baseRows);
    void perSev;
    const generated = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const matrix = [
      {
        source: REPORT_SOURCE,
        ...Object.fromEntries(SEVERITY_ORDER.map((s) => [s, counts[s] ?? 0])),
        total: displayed.length,
        medianMttr: overall.mttr_median ?? null,
        open: overall.open ?? 0,
      },
    ];
    if (format === "json") {
      return {
        content: JSON.stringify({ generated, sources: matrix }, null, 2),
        filename: `wiz-report-${generated.slice(0, 10)}.json`,
        matrix,
      };
    }
    if (format === "csv") {
      const cols = findings.TABLE_COLUMNS.filter((c) => !c.startsWith("_"));
      const lines = [cols.join(",")];
      for (const r of displayed) {
        lines.push(cols.map((c) => csvCell(r[c])).join(","));
      }
      return {
        content: lines.join("\r\n"),
        filename: `wiz-report-${generated.slice(0, 10)}.csv`,
        matrix,
      };
    }
    const md = [
      `# Security summary — ${generated}`,
      "",
      `## ${REPORT_SOURCE}`,
      "",
      `| Severity | Count |`,
      `| --- | ---: |`,
      ...SEVERITY_ORDER.filter((s) => counts[s]).map((s) => `| ${s} | ${counts[s]} |`),
      `| **Total** | **${displayed.length}** |`,
      "",
      `Median MTTR: ${overall.mttr_median != null ? overall.mttr_median.toFixed(1) + " days" : "—"}`,
      `Open findings: ${overall.open ?? 0}`,
    ].join("\n");
    return { content: md, filename: `wiz-report-${generated.slice(0, 10)}.md`, matrix };
  });
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function getExportCsv(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const scan = findings.currentScan();
    if (!scan) return { content: "", filename: "" };
    const filtered = findings.applyFilters(scan.records, {
      severities: (params["severities"] as string[]) ?? settingsStore.getDisplaySeverities(),
      statuses: (params["statuses"] as string[]) ?? [],
      assetTypes: (params["assetTypes"] as string[]) ?? [],
      clouds: (params["clouds"] as string[]) ?? [],
      domains: (params["domains"] as string[]) ?? [],
      supportGroups: (params["supportGroups"] as string[]) ?? [],
      q: (params["q"] as string) ?? "",
    });
    const cols = findings.TABLE_COLUMNS.filter((c) => !c.startsWith("_"));
    const lines = [cols.join(",")];
    for (const r of filtered) lines.push(cols.map((c) => csvCell(r[c])).join(","));
    return {
      content: lines.join("\r\n"),
      filename: `wiz-os-vulnerabilities-${scan.scanId.slice(0, 10)}.csv`,
    };
  });
}

export function getExportRawUrl(p?: unknown): ApiResult {
  return run(() => {
    const scanId = String((p as Rec)?.["scanId"] ?? "");
    const row = scanId
      ? ledgerStore.loadScanRows().find((s) => s.scan_id === scanId)
      : ledgerStore.latestScanRow();
    if (!row?.raw_ref) return { urls: [] };
    const folder = DriveApp.getFolderById(row.raw_ref);
    const urls: Array<{ name: string; url: string }> = [];
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (/^page-\d+\.json(\.gz)?$/.test(f.getName())) {
        urls.push({ name: f.getName(), url: f.getDownloadUrl() });
      }
    }
    urls.sort((a, b) => (a.name < b.name ? -1 : 1));
    return { urls, folderUrl: folder.getUrl() };
  });
}

// ------------------------------------------------------------------------- settings

export function getSettings(_p?: unknown): ApiResult {
  return run(() => ({
    fetchSeverities: settingsStore.getFetchSeverities(),
    displaySeverities: settingsStore.getDisplaySeverities(),
    retentionDays: settingsStore.getRetentionDays(),
    autoCompact: settingsStore.getAutoCompact(),
    domains: settingsStore.getDomains(),
  }));
}

export function setSeverities(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  return mutate(() => {
    if (params["fetch"]) settingsStore.setFetchSeverities(params["fetch"]);
    if (params["display"]) settingsStore.setDisplaySeverities(params["display"]);
    return {
      fetchSeverities: settingsStore.getFetchSeverities(),
      displaySeverities: settingsStore.getDisplaySeverities(),
    };
  });
}

export function setRetention(p?: unknown): ApiResult {
  const days = (p as Rec)?.["days"];
  return mutate(() => {
    settingsStore.setRetentionDays(days === null || days === undefined ? null : Number(days));
    return { retentionDays: settingsStore.getRetentionDays() };
  });
}

export function setAutoCompact(p?: unknown): ApiResult {
  return mutate(() => {
    settingsStore.setAutoCompact(Boolean((p as Rec)?.["on"]));
    return { autoCompact: settingsStore.getAutoCompact() };
  });
}

/** Atomic combined write of retention window + auto-compact — the client sets both at once,
 *  so this avoids the partial-commit window two separate calls left. */
export function setRetentionSettings(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  const days = params["days"];
  return mutate(() => {
    settingsStore.setRetentionAndCompact(
      days === null || days === undefined ? null : Number(days),
      Boolean(params["autoCompact"]),
    );
    return {
      retentionDays: settingsStore.getRetentionDays(),
      autoCompact: settingsStore.getAutoCompact(),
    };
  });
}

export function getDomains(_p?: unknown): ApiResult {
  return run(() => settingsStore.getDomains());
}

export function saveDomains(p?: unknown): ApiResult {
  const items = ((p as Rec)?.["items"] as unknown[]) ?? [];
  return mutate(() => {
    const errors = validateDomains(items);
    if (errors.length) return { saved: false, errors };
    settingsStore.setDomains(items);
    // Domain rules changed → the frame's memoized _domain attachment is stale.
    findings.invalidateFrameMemo();
    return { saved: true, errors: [], domains: settingsStore.getDomains() };
  });
}

export function previewDomains(p?: unknown): ApiResult {
  return run(() => {
    const items = ((p as Rec)?.["items"] as unknown[]) ?? [];
    const compiled = compileDomains(items);
    const scan = findings.currentScan();
    const records = scan?.records ?? [];
    const perDomain: Record<string, { count: number; samples: string[] }> = {};
    for (const d of compiled) perDomain[d.name] = { count: 0, samples: [] };
    perDomain[UNASSIGNED] = { count: 0, samples: [] };
    for (const r of records) {
      const name = assignDomain(r, compiled);
      const bucket = perDomain[name] ?? (perDomain[name] = { count: 0, samples: [] });
      bucket.count += 1;
      if (bucket.samples.length < 5) {
        const asset = String(r["vulnerableAsset.name"] ?? "");
        if (asset && !bucket.samples.includes(asset)) bucket.samples.push(asset);
      }
    }
    return { total: records.length, perDomain };
  });
}

/**
 * Refresh the subscription → Support Group map from Wiz (graphSearch over subscriptions
 * tagged with WIZ_SUPPORT_GROUP_TAG_KEY). A mutation: it bumps DATA_VERSION so every
 * cached view repaints with the new mapping. Also runs best-effort at each scan finalize.
 */
export function refreshSupportGroups(_p?: unknown): ApiResult {
  if (!hasWizCredentials()) {
    return { ok: false, error: "Live Wiz credentials are required to refresh support groups." };
  }
  return mutate(() => {
    const stats = supportGroups.refreshSupportGroups();
    // Support-group map changed → the frame's memoized _supportGroup attachment is stale.
    findings.invalidateFrameMemo();
    return stats;
  });
}

// ---------------------------------------------------------------------------- misc

export function getStorageStats(_p?: unknown): ApiResult {
  // cellCount() walks every sheet in the spreadsheet — cache it per DATA_VERSION.
  return run(() =>
    cached("storageStats", null, () => {
      const scans = ledgerStore.loadScanRows();
      return {
        cellCount: cellCount(),
        cellLimit: 10_000_000,
        scanCount: scans.length,
        sealedCount: scans.filter((s) => s.sealed).length,
        oldestScanTs: scans.length ? scans[0].ts : null,
        trackedVulns: ledgerStore.loadBaseRows().length,
      };
    }),
  );
}
