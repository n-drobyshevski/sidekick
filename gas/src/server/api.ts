// google.script.run API surface. Every endpoint returns {ok, data} | {ok:false,
// error} so the client wrapper promisifies uniformly. Reads never take the script
// lock; mutations run inside withScriptLock + recoverIfNeeded.

import {
  SEVERITY_COLORS,
  SEVERITY_GLYPHS,
  SEVERITY_ORDER,
  SLA_TARGETS,
  SELECTABLE_SEVERITIES,
  RESOLVED_STATUSES,
} from "../domain/config";
import { domainNames, validateDomains, compileDomains, assignDomain, assignDomains, hasDomainInputs, UNASSIGNED } from "../domain/domainRules";
import { coverage, ruleHealth, supportGroupBreakdown, unassignedResources, untaggedSubscriptions } from "../domain/attribution";
import { mttrFromLedger, vulnKey } from "../domain/lifecycle";
import type { BaseRow } from "../domain/ledgerCore";
import { extractNodes } from "../domain/transform";
import { overallSlaOldest } from "../domain/metrics";
import { normalizeSeverity } from "../domain/severity";
import {
  actionableView,
  awaitingVendorFix,
  baseRowNoFix,
  kaplanMeier,
  kmQuantileFromCurve,
  mttrPercentiles,
  openPastSla,
  recordNoFix,
  resolutionBuckets,
} from "../domain/remediation";
import { validateBundle } from "../domain/importMerge";
import { SealedScanError, LedgerRebuildError } from "../domain/maintenance";
import { parseTs, present, type Rec } from "../domain/util";
import { kmMedianAsOf, kmMedianByGroupTrend, medianMttrByGroupTrend, openByGroupTrend, openBySeverityTrend } from "../domain/trend";
import * as insights from "../domain/insights";
import * as archive from "./archiveStore";
import * as errorLog from "./errorLog";
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

function run<T>(fn: () => T, label = "api"): ApiResult<T> {
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
    // Capture into the durable recent-errors log so a failure is visible in-app (Settings →
    // Diagnostics), not just the execution transcript. "busy" is skipped — it's the expected
    // "a scan is running, retry" contention signal, not a fault, and would evict real errors.
    if (kind !== "busy") errorLog.recordError(label, e, kind);
    return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: kind };
  }
}

function mutate<T>(fn: () => T, label = "api"): ApiResult<T> {
  return run(
    () =>
      withScriptLock(() => {
        recoverIfNeeded();
        return fn();
      }),
    label,
  );
}

// ------------------------------------------------------------------------ bootstrap

export function bootstrap(_p?: unknown): ApiResult {
  return run(() => ({
    // The core is a pure function of ledger + settings state — cached per DATA_VERSION.
    // "bootstrapCore" → "bootstrapCore2": counts / unassigned / filterOptions now honor the
    // show-no-fix toggle and settings gained `showNoFix`; params null → {showNoFix} so the
    // on/off states cache separately and no stale old-shape entry survives the deploy.
    ...(cached("bootstrapCore2", { showNoFix: settingsStore.getShowNoFix() }, bootstrapCore) as Rec),
    // Live per-request fields: never cached (activeJob changes every poll tick).
    dataVersion: dataVersion(),
    hasCredentials: hasWizCredentials(),
    activeJob: activeJobSummary(),
  }));
}

function bootstrapCore(): Rec {
  const scan = findings.currentScan();
  const latest = ledgerStore.latestScanRow();
  const showNoFix = settingsStore.getShowNoFix();
  // When the toggle is off, no-fix findings drop out of the bootstrap counts, the unassigned
  // tally, and the filter-option domains, so the whole payload stays coherent with the
  // filtered views. No-op on the default path.
  const records = scan ? filterNoFixFrame(scan.records, showNoFix) : [];
  const counts: Record<string, number> = {};
  let unassignedCount = 0;
  for (const r of records) {
    const sev = String(r["_sev"]);
    counts[sev] = (counts[sev] ?? 0) + 1;
    if (r["_domain"] === UNASSIGNED) unassignedCount += 1;
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
      showNoFix,
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
          statuses: findings.distinct(records, "status"),
          assetTypes: findings.distinct(records, "vulnerableAsset.type"),
          clouds: findings.distinct(records, "vulnerableAsset.cloudPlatform"),
          subscriptions: findings.distinct(records, "vulnerableAsset.subscriptionName"),
          supportGroups: findings.distinct(records, "_supportGroup"),
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
    const filtered = filterNoFixFrame(
      findings.applyFilters(scan.records, filters),
      settingsStore.getShowNoFix(),
    );

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
    const record =
      filterNoFixFrame(scan.records, settingsStore.getShowNoFix()).find(
        (r) => r["_vuln_key"] === key,
      ) ?? null;
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
  // Global show-no-fix toggle. When off, no-fix findings drop out of the current-scan blocks
  // and the durable-ledger blocks (counts/total/sevStats/exploit + aging/oldest/awaiting/
  // movement). `openTrend` is the exception: it keeps the UNFILTERED base and excludes no-fix
  // rows AS OF each historical date (a fixed-later finding re-enters at the point its fix
  // landed), so it reads the {hideNoFix} option instead of a pre-filtered population.
  const showNoFix = settingsStore.getShowNoFix();
  const recsVisible = filterNoFixFrame(recs, showNoFix);
  const baseVisible = filterNoFixBase(base as unknown as Rec[], showNoFix) as unknown as typeof base;
  const latestFlat = ledgerStore.latestFlatScanRow();
  return {
    flatScan: true,
    domain,
    supportGroup,
    scan: { scanId: scan.scanId, ts: scan.ts, total: scan.total },
    // Domain-scoped severity counts + total so the Overview headline can stay
    // coherent under a filter (the KPI band otherwise reads whole-scan bootstrap
    // counts). Movement's new/resolved/reopened remain chain-wide — see below.
    counts: sevCountsOf(recsVisible),
    total: recsVisible.length,
    // Per-severity total/open/resolved for the severity breakdown card.
    sevStats: insights.severityStats(recsVisible),
    // Open findings per severity over time — powers the breakdown line chart. Uses the
    // UNFILTERED base + severities and the as-of no-fix exclusion, so the series matches the
    // counts shown beside it while letting a fixed-later finding re-enter at the right date.
    openTrend: openBySeverityTrend(
      ledgerStore.loadScanRows() as unknown as Rec[],
      base as unknown as Rec[],
      severities,
      { hideNoFix: !showNoFix },
    ),
    exploit: insights.exploitSummary(recsVisible),
    // Open findings awaiting a vendor fix (no patch available yet) over the same scoped base
    // rows — sourced here so the Overview can explain the post-rollout open-count step-up.
    // (Naturally zero when the toggle hides them, so the client drops the surface entirely.)
    awaiting: awaitingVendorFix(baseVisible),
    aging: insights.ageBuckets(baseVisible),
    // Oldest open findings + 90+ backlog per asset / support group / domain, for the aging
    // panel's toggle. Capped at 100 (up from the old top-7) so the client can page through the
    // aged tail with prev/next controls — the whole set ships once and repaints client-side,
    // no per-page RPC. The panel triages the oldest backlog, so 100 rows is ample depth.
    oldest: insights.oldestOpen(
      baseVisible as unknown as Parameters<typeof insights.oldestOpen>[0],
      100,
    ),
    // Movement's Persisting is filtered (it's derived from these base rows); New/Resolved/
    // Reopened come from scan-wide reconcile deltas and stay scan-wide (see movement()).
    movement: insights.movement(baseVisible, latestFlat, ledgerStore.loadScanRows().length),
  };
}

// 1h TTL like the MTTR summary: aging carries wall-clock-relative day counts. Keyed on
// domain so per-chain payloads don't clobber each other. Extracted so warmReadModels and the
// getInsights endpoint share one cache entry.
const cachedInsightsData = (p?: unknown) =>
  cached(
    // "insights" → "insights2": the payload now honors the show-no-fix toggle (counts,
    // total, sevStats, exploit, aging, oldest, awaiting, movement, and the as-of openTrend
    // all reflect it); key gains showNoFix so on/off states don't share an entry.
    // "insights2" → "insights3": `oldest.*` now carries up to 100 rows (was 7) for the aging
    // panel's prev/next pagination; bump so stale 7-row entries can't survive the deploy.
    "insights3",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      supportGroups: readStringArray(p, "supportGroups"),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => insightsData(p),
    3600,
  );

export function getInsights(p?: unknown): ApiResult {
  return run(() => cachedInsightsData(p));
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
  return filterNoFixFrame(recs, settingsStore.getShowNoFix());
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

// Extracted so warmReadModels and the getGrouping endpoint share one cache entry.
const cachedGroupingData = (p?: unknown) => {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  const raw = (p as Rec)?.["keys"];
  const keys = Array.isArray(raw) ? (raw as unknown[]).map(String) : [];
  // "grouping" → "grouping2": the breakdown tree is built over scopedFrameRecords, which
  // now honors the show-no-fix toggle; key gains showNoFix so on/off states cache apart.
  return cached("grouping2",
    {
      domain, supportGroup, supportGroups: supportGroupSet, keys,
      severities: readSeverities(p), showNoFix: settingsStore.getShowNoFix(),
    },
    () => groupingData(p), 3600);
};

export function getGrouping(p?: unknown): ApiResult {
  return run(() => cachedGroupingData(p));
}

// ------------------------------------------------------------------- group trend

/**
 * Open findings over scan history for the top-level breakdown groups — the durable-ledger
 * counterpart of the current-scan `groupingData` tree, powering the Breakdown
 * group-evolution line chart. Scopes the base rows to the same Value Chain / Support
 * Group filters (mirroring `insightsData`), then replays the ledger per flat scan.
 *
 * `key` is the top-level grouping dimension; `groups` are the canonical top-N group names
 * the client already derived from the grouping payload, so pie and line bucket/color the
 * same groups. A dimension with no ledger column — `os`, absent from `GROUP_BASE_FIELDS`
 * — returns `supported: false`; the UI shows an honest empty state and still draws the
 * pie from the grouping payload.
 */
function groupTrendData(p?: unknown): Rec {
  const key = String((p as Rec)?.["key"] ?? "");
  const groups = readStringArray(p, "groups");
  const field = insights.GROUP_BASE_FIELDS[key];
  const scan = findings.currentScan();
  if (!field || !scan) return { supported: false, key, groups: [], points: [] };

  // Same base-row scoping as insightsData: base rows carry no _supportGroup / _domain
  // natively, so attach both up front, then apply the domain / support-group filters.
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  const sgActive = Boolean(supportGroup) || supportGroupSet.length > 0;
  const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
  let base = ledgerStore.loadBaseRows() as unknown as Rec[];
  supportGroups.attachSupportGroups(base);
  const compiled = compileDomains(settingsStore.getDomains().items);
  for (const r of base) r["_domain"] = assignDomain(r, compiled);
  if (sgActive) base = base.filter((r) => sgMatch(String(r["_supportGroup"] ?? "")));
  if (domain) base = base.filter((r) => String(r["_domain"] ?? UNASSIGNED) === domain);

  // Base stays unfiltered here — the as-of {hideNoFix} exclusion re-admits a fixed-later
  // finding at the point its fix landed, matching the openTrend series in insightsData.
  const points = openByGroupTrend(
    ledgerStore.loadScanRows() as unknown as Rec[],
    base,
    (r) => String(r[field] ?? ""),
    groups,
    { severities: readSeverities(p), hideNoFix: !settingsStore.getShowNoFix() },
  );
  return { supported: true, key, groups, points };
}

export function getGroupTrend(p?: unknown): ApiResult {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  return run(() =>
    // "groupTrend" → "groupTrend2": the open-by-group series now excludes no-fix findings
    // as-of-date when the toggle is off; key gains showNoFix so on/off states cache apart.
    cached("groupTrend2",
      {
        domain, supportGroup, supportGroups: supportGroupSet,
        key: String((p as Rec)?.["key"] ?? ""),
        groups: readStringArray(p, "groups"),
        severities: readSeverities(p),
        showNoFix: settingsStore.getShowNoFix(),
      },
      () => groupTrendData(p), 3600),
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
  const recs = filterNoFixFrame(
    filterSeverities(scan.records, readSeverities(p)),
    settingsStore.getShowNoFix(),
  );
  const dom = settingsStore.getDomains();
  const compiled = compileDomains(dom.items);
  const sgMap = settingsStore.getSupportGroupMap();
  const sgKeys = Object.keys(sgMap.map);
  // Distinct groups the persisted map can resolve TO — surfaced so an operator can tell an
  // empty/unrefreshed map (keys 0) apart from a populated one that simply isn't joining the
  // findings' subscription identity (keys > 0 but every finding still resolves to "(none)").
  const sgMapGroups = new Set(Object.values(sgMap.map)).size;
  return {
    flatScan: true,
    scan: { scanId: scan.scanId, ts: scan.ts },
    coverage: coverage(recs, domainNames(dom.items)),
    ruleHealth: ruleHealth(recs, compiled),
    unassignedAll: unassignedResources(recs, compiled),
    // Findings split by resolved support group — the support-group coverage table + the
    // resolved/unresolved headline the page needs to troubleshoot the join.
    supportGroups: supportGroupBreakdown(recs),
    untagged: untaggedSubscriptions(recs).slice(0, 200),
    supportGroupMap: {
      configured: sgKeys.length > 0,
      keys: sgKeys.length,
      groups: sgMapGroups,
      tagKey: supportGroups.configuredTagKey(),
      // A sample of the identity tokens the map is actually indexed under (folded, as the
      // join compares them) — the concrete map side of the join, to eyeball against the
      // subscription id / ext id / name the findings carry when nothing resolves.
      sampleKeys: sgKeys.slice(0, 12),
    },
  };
}

/** Attribution page in one round trip; the whole payload is cached per DATA_VERSION +
 *  severities, and `unassignedAll` is paginated OUTSIDE the cache so every page shares
 *  one cached compute. */
// The whole attribution payload cached per DATA_VERSION + (severities, showNoFix). Extracted
// so warmReadModels and the endpoint share one entry; pagination happens OUTSIDE the cache in
// getAttribution, so every page reuses this one compute.
const cachedAttributionData = (p?: unknown) =>
  // "attribution" → "attribution2": coverage / rule-health / unassigned now honor the
  // show-no-fix toggle; key gains showNoFix so on/off states cache apart.
  // "attribution2" → "attribution3": payload gained the support-group breakdown
  // (`supportGroups`) and richer `supportGroupMap` (groups + tagKey); bump so a stale
  // old-shape entry can't survive the persistent dataVersion.
  // "attribution3" → "attribution4": `supportGroupMap` gained `sampleKeys` (indexed
  // subscription identities); bump so a stale sampleKeys-less entry can't survive.
  cached(
    "attribution4",
    { severities: readSeverities(p), showNoFix: settingsStore.getShowNoFix() },
    () => attributionData(p),
  );

export function getAttribution(p?: unknown): ApiResult {
  return run(() => {
    const data = cachedAttributionData(p);
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

// The global "show findings without a vendor fix" toggle, applied at every finding-derived
// choke point. Both are HARD no-ops when showNoFix is true (the default) — the read happens
// once per data function via settingsStore.getShowNoFix(), and when off the no-fix rows
// (baseRowNoFix / recordNoFix — resolved rows and legacy pre-rollout rows never qualify)
// drop out of the population before any aggregation runs.
function filterNoFixBase(rows: Rec[], showNoFix: boolean): Rec[] {
  if (showNoFix || !rows.length) return rows;
  return rows.filter((r) => !baseRowNoFix(r as unknown as BaseRow));
}
function filterNoFixFrame(records: Rec[], showNoFix: boolean): Rec[] {
  if (showNoFix || !records.length) return records;
  return records.filter((r) => !recordNoFix(r));
}

// The durable base rows narrowed to the active Value Chain + Support group scope — the shared
// preamble both the MTTR summary and the MTTR trend key their populations off, so the hero and
// the charts beneath it always measure the same findings. attachSupportGroups runs only when a
// scope is active (otherwise the whole base passes through untouched), matching the old inline
// scoping. Severity / no-fix filtering stays with each caller, which apply their own.
function scopedBaseRows(domain: string, supportGroup: string): Rec[] {
  let rows = ledgerStore.loadBaseRows() as unknown as Rec[];
  if (domain || supportGroup) {
    supportGroups.attachSupportGroups(rows);
    if (supportGroup) rows = rows.filter((r) => String(r["_supportGroup"] ?? "") === supportGroup);
    if (domain) {
      const compiled = compileDomains(settingsStore.getDomains().items);
      rows = rows.filter((r) => assignDomain(r, compiled) === domain);
    }
  }
  return rows;
}

function mttrData(p?: unknown): Rec {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  let rows = scopedBaseRows(domain, supportGroup);
  rows = filterSeverities(rows, readSeverities(p));
  // Global show-no-fix toggle: drop awaiting-vendor-fix rows so the whole remediation block
  // (percentiles, buckets, KM, open-past-SLA, awaiting) measures only the fixable population.
  // No-op on the default path.
  rows = filterNoFixBase(rows, settingsStore.getShowNoFix());
  const { perSev, overall } = mttrFromLedger(rows);
  const { slaPct, oldestDays } = overallSlaOldest(perSev);
  // Remediation-tail block over the same scoped rows (BaseRows cast to Rec by loadBaseRows;
  // cast back for the typed remediation projection).
  const remRows = rows as unknown as BaseRow[];
  // Per-severity Kaplan–Meier median + p90 (still-open findings censored) so the per-severity
  // table shows the same censoring-aware clock as the hero, not the naive closed-only stats
  // that bias low on a wave of fresh open findings. Both read off one KM curve per severity.
  // Keyed by normalized severity to line up with `perSev` (UNKNOWN included). Grouped over the
  // same from-detection rows as the overall `km` below.
  const kmMedianPerSev: Record<string, number | null> = {};
  const kmP90PerSev: Record<string, number | null> = {};
  {
    const bySev: Record<string, BaseRow[]> = {};
    for (const r of remRows) {
      const s = normalizeSeverity((r as unknown as Rec)["severity"]);
      (bySev[s] ?? (bySev[s] = [])).push(r);
    }
    for (const [s, rs] of Object.entries(bySev)) {
      const k = kaplanMeier(rs);
      kmMedianPerSev[s] = k.median;
      kmP90PerSev[s] = kmQuantileFromCurve(k.curve, 0.9);
    }
  }
  // Full Kaplan–Meier estimate (curve + KM median/RMST mean + naive comparison stats), open
  // findings right-censored so the headline isn't biased low by fresh fast patches.
  const km = kaplanMeier(remRows);
  const remediation = {
    pctiles: mttrPercentiles(remRows),
    buckets: resolutionBuckets(remRows),
    km,
    // Overall censoring-aware KM p90 off that same curve (smallest t with S(t) ≤ 0.10) — the
    // slow-tail sibling of the KM median that replaces the naive `pctiles.overall.p90` in the
    // KPI band. Null (renders "—") when too much is still open to observe it.
    kmP90: kmQuantileFromCurve(km.curve, 0.9),
    kmMedianPerSev,
    kmP90PerSev,
    openPastSla: openPastSla(remRows),
    // Actionable-clock companions (clock starts at vendor-fix availability): the same
    // functions over the actionableView projection. Awaiting-vendor-fix rows carry null
    // actionable fields, so they drop out of these while staying in `awaiting`.
    kmActionable: kaplanMeier(actionableView(remRows)),
    openPastSlaActionable: openPastSla(actionableView(remRows)),
    awaiting: awaitingVendorFix(remRows),
  };
  return { perSev, overall, slaPct, oldestDays, rowCount: rows.length, remediation };
}

function mttrTrendData(p?: unknown): Rec {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const severities = readSeverities(p);
  const scoped = Boolean(domain || supportGroup);
  // Scope the reconstructed trend to the active Value Chain + Support group by handing the
  // pre-filtered base rows to loadTrend (the scans backbone stays whole). Under a scope the
  // persisted mttr_history snapshots — always whole-register — no longer describe the shown
  // population, so drop them; the reconstructed trend stands on its own (the client already
  // suppresses the history-based change chips whenever a scope is active).
  const rows = scopedBaseRows(domain, supportGroup) as unknown as BaseRow[];
  return {
    history: scoped ? [] : history.loadHistory(),
    // showNoFix off → the open / KM-median series exclude no-fix findings as-of-date; the
    // resolved / median / SLA-burn / attainment series are untouched (see loadTrend).
    trend: ledgerStore.loadTrend(severities, settingsStore.getShowNoFix(), rows),
  };
}

// The "(none)" bucket label for rows the support-group map can't resolve — one bucket so an
// unattributed tail doesn't fragment the split.
const NONE_SUPPORT_GROUP = "(none)";

// Shared per-group remediation rows + trend for the MTTR breakdown, used by both the by-domain
// and by-support-group variants. `rows` must already carry the grouping key at `keyField`
// (e.g. "_domain" / "_supportGroup"); `orderedNames` fixes the table order (names with no rows
// are skipped). Each row is keyed by a generic `group` label; the trend is the canonical
// top-5-by-resolved (median + KM) over the same population. Reuses mttrFromLedger /
// overallSlaOldest / kaplanMeier, so no domain-layer change.
function remediationGroups(
  rows: Rec[],
  keyField: string,
  orderedNames: string[],
  scanRows: Rec[],
): { rows: Rec[]; trend: { groups: string[]; points: unknown; kmPoints: unknown } } {
  const buckets = new Map<string, Rec[]>();
  for (const r of rows) {
    const name = String(r[keyField] ?? "");
    let arr = buckets.get(name);
    if (!arr) buckets.set(name, (arr = []));
    arr.push(r);
  }
  const out: Rec[] = [];
  for (const name of orderedNames) {
    const drows = buckets.get(name);
    if (!drows || !drows.length) continue;
    const { perSev, overall } = mttrFromLedger(drows);
    const { slaPct } = overallSlaOldest(perSev);
    const rem = drows as unknown as BaseRow[];
    const km = kaplanMeier(rem);
    out.push({
      group: name,
      median: overall.mttr_median ?? null,
      // Censoring-aware KM p90 (open findings right-censored), the slow-tail sibling of the KM
      // median below — read off the same survival curve (smallest t with S(t) ≤ 0.10) so the
      // tail isn't biased low by the fast-patched vulns that close first, the way a closed-only
      // percentile would be. Null (renders "—") when too much is still open to observe it.
      p90: kmQuantileFromCurve(km.curve, 0.9),
      // Censoring-aware KM median (open findings right-censored) — the column that replaces
      // the old "Excl. fast lane" tail median.
      kmMedian: km.median,
      slaPct,
      // Actionable-clock open-past-SLA (measured from vendor-fix availability, awaiting
      // rows excluded) — the same basis the hero and severity table now use.
      openPastSla: openPastSla(actionableView(rem)).overall,
      // Open findings in this bucket still awaiting a vendor fix — surfaced as a footnote
      // under the table, not a column.
      awaiting: awaitingVendorFix(rem).overall,
      open: overall.open ?? 0,
      resolved: overall.resolved ?? 0,
    });
  }
  // Trend shares the exact scoped population and the canonical group order the table just
  // built — the groups that actually carry resolved work, capped at 5 (the categorical palette
  // size, charts.js CATEGORICAL), the rest folds to "Other".
  const groups = out
    .filter((r) => (r["resolved"] as number) > 0)
    .sort((a, b) => (b["resolved"] as number) - (a["resolved"] as number))
    .slice(0, 5)
    .map((r) => String(r["group"]));
  const keyOf = (r: Rec) => String(r[keyField] ?? "");
  const points = medianMttrByGroupTrend(scanRows, rows, keyOf, groups, { severities: null });
  // KM-median series (open findings right-censored) — the chart's default clock; the naive
  // `points` above is kept only as the toggle's comparison. Same scoped rows, same canonical
  // groups/keyOf, so KM and naive line up point-for-point.
  const kmPoints = kmMedianByGroupTrend(scanRows, rows, keyOf, groups, { severities: null });
  return { rows: out, trend: { groups, points, kmPoints } };
}

// Per-domain remediation summary for the "By domain" section shown at the whole-chain
// (aggregate) view — a value chain is composed of domains, so this splits the same
// ledger base rows the MTTR hero uses by their assigned domain. Priority order (with
// Unassigned last), empty domains omitted.
function mttrByDomainData(p?: unknown): Rec {
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  let rows = filterSeverities(
    ledgerStore.loadBaseRows() as unknown as Rec[],
    readSeverities(p),
  );
  // Same show-no-fix toggle as mttrData, so the by-domain split matches the hero.
  rows = filterNoFixBase(rows, settingsStore.getShowNoFix());
  supportGroups.attachSupportGroups(rows);
  if (supportGroup) rows = rows.filter((r) => String(r["_supportGroup"] ?? "") === supportGroup);
  // Drop rows that carry no domain-rule inputs at all — compacted resolved episodes and the
  // pre-v5 / imported resolved history that surface with null tags+subscription+name. They can
  // only ever fall through to Unassigned because their inputs are missing, not because they
  // genuinely matched no rule (see domainRules.hasDomainInputs). Left in, they'd swamp the
  // breakdown with a giant fake "Unassigned" domain that has no counterpart on the live
  // Attribution page; a footnote surfaces how many resolved findings were set aside. Applied to
  // `rows` so they drop out of both the per-domain table and the trend replay below, together.
  const excluded = rows.filter((r) => !hasDomainInputs(r));
  rows = rows.filter((r) => hasDomainInputs(r));
  const excludedResolved = excluded.filter((r) =>
    RESOLVED_STATUSES.has(String(r["status"] ?? "").toUpperCase()),
  ).length;
  const items = settingsStore.getDomains().items;
  const compiled = compileDomains(items);
  const assigned = assignDomains(rows, compiled);
  rows.forEach((r, i) => {
    r["_domain"] = assigned[i] ?? UNASSIGNED;
  });
  const scanRows = ledgerStore.loadScanRows() as unknown as Rec[];
  const { rows: out, trend } = remediationGroups(rows, "_domain", domainNames(items), scanRows);
  // Keep `domain` alongside the generic `group` label so the Executive page (reads r.domain)
  // and any older client stay byte-compatible.
  for (const r of out) r["domain"] = r["group"];
  return {
    dimension: "domain",
    rows: out,
    trend,
    // Resolved history set aside above for lacking any domain input — the by-domain footnote.
    excluded: { total: excluded.length, resolved: excludedResolved },
  };
}

// Per-support-group remediation for the "By support group" section shown when a single Value
// Chain is selected — the by-domain split would be one row then, so this splits that domain's
// scoped base rows by their attached `_supportGroup` instead. Same row/trend shape as
// mttrByDomainData so the client renders it identically (relabelled). Groups with no rows are
// omitted; the unresolved tail folds into one "(none)" bucket. When support groups aren't
// configured, attachSupportGroups is inert so everything lands in "(none)" (one group) and the
// client hides the section — nothing to split by.
function mttrBySupportGroupData(p?: unknown): Rec {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  let rows = filterSeverities(
    ledgerStore.loadBaseRows() as unknown as Rec[],
    readSeverities(p),
  );
  rows = filterNoFixBase(rows, settingsStore.getShowNoFix());
  supportGroups.attachSupportGroups(rows);
  // Scope to the selected value chain (assign domains, keep the matching rows) so the split
  // shows the support groups WITHIN this domain — mirroring how the hero is scoped.
  const compiled = compileDomains(settingsStore.getDomains().items);
  if (domain) rows = rows.filter((r) => assignDomain(r, compiled) === domain);
  // A sidebar Support-group filter narrows to that one group (the split then collapses to a
  // single row and the client hides it) — applied so the population matches the hero.
  if (supportGroup) rows = rows.filter((r) => String(r["_supportGroup"] ?? "") === supportGroup);
  for (const r of rows) r["_supportGroup"] = String(r["_supportGroup"] ?? "") || NONE_SUPPORT_GROUP;
  // Order the table by bucket size (largest support group first), "(none)" always last.
  const sizes = new Map<string, number>();
  for (const r of rows) {
    const g = String(r["_supportGroup"]);
    sizes.set(g, (sizes.get(g) ?? 0) + 1);
  }
  const orderedNames = [...sizes.keys()].sort((a, b) => {
    if (a === NONE_SUPPORT_GROUP) return 1;
    if (b === NONE_SUPPORT_GROUP) return -1;
    return (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0);
  });
  const scanRows = ledgerStore.loadScanRows() as unknown as Rec[];
  const { rows: out, trend } = remediationGroups(rows, "_supportGroup", orderedNames, scanRows);
  return {
    dimension: "supportGroup",
    rows: out,
    trend,
    // The domain-input exclusion is a by-domain concern; not applicable to the support-group split.
    excluded: { total: 0, resolved: 0 },
  };
}

// Cached per DATA_VERSION, keyed on exactly the params each computation reads — so
// the single and batched endpoints share entries regardless of extra params.
// The MTTR summary carries wall-clock-relative open ages (p50/p90/oldest), so its
// TTL is 1h — a ≤0.04-day drift — instead of the 6h the version-keyed data allows.
const cachedMttrData = (p?: unknown) =>
  cached(
    // "mttr" → "mttr2": payload gained the `remediation` block; dataVersion persists across
    // deploys, so bumping the namespace prevents serving a stale old-shape entry (up to 1h).
    // "mttr2" → "mttr3": remediation gained the actionable-clock keys (kmMedianActionable,
    // openPastSlaActionable, awaiting); same reasoning — bump so no stale entry lacks them.
    // "mttr3" → "mttr4": fast-lane machinery removed; remediation now carries the full KM
    // estimate (km / kmActionable) and dropped fastLane / scalar kmMedian; bump so no stale
    // old-shape entry survives the persistent dataVersion.
    // "mttr4" → "mttr5": the remediation block now honors the show-no-fix toggle (awaiting
    // rows dropped when off); key gains showNoFix so on/off states don't share an entry.
    // "mttr5" → "mttr6": remediation gained `kmMedianPerSev` (per-severity KM median for the
    // per-severity table); bump so no stale entry lacks it.
    // "mttr6" → "mttr7": remediation gained the censoring-aware KM p90 — `kmP90` (overall, for
    // the KPI band) and `kmP90PerSev` (per-severity table) — replacing the naive `pctiles` p90
    // at those call sites; bump so no stale entry lacks them.
    "mttr7",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => mttrData(p),
    3600,
  );
const cachedMttrTrendData = (p?: unknown) =>
  // "mttrTrend" → "mttrTrend2": trend points gained `open_past_sla`; namespace bump avoids a
  // stale old-shape entry surviving the deploy under the persistent dataVersion.
  // "mttrTrend2" → "mttrTrend3": trend points gained the backlog-flow series (sla_net /
  // sla_entered / sla_cleared, sla_attainment_pct) and open_past_sla switched to the
  // actionable clock; bump so a stale old-shape entry can't survive the persistent dataVersion.
  // "mttrTrend3" → "mttrTrend4": the tail-median series (tail_median_days) became the KM-median
  // series (km_median_days) and the fast-lane window left the key; bump so no stale entry
  // survives.
  // "mttrTrend4" → "mttrTrend5": the open / KM-median series now exclude no-fix findings
  // as-of-date when the toggle is off; key gains showNoFix so on/off states cache apart.
  // "mttrTrend5" → "mttrTrend6": the reconstructed trend now scopes to the active Value Chain /
  // Support group (was always whole-register); key gains domain + supportGroup so scopes cache
  // apart.
  cached(
    "mttrTrend6",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => mttrTrendData(p),
  );
// Domain-independent (always all domains); severity-scoped; 1h TTL like the summary
// (carries open ages).
const cachedMttrByDomainData = (p?: unknown) =>
  cached(
    // "mttrByDomain" → "mttrByDomain2": payload shape changed (added p90/tailMedian/
    // openPastSla, dropped tracked/oldestDays); dataVersion persists across deploys, so
    // bumping the namespace prevents serving a stale old-shape entry.
    // "mttrByDomain2" → "mttrByDomain3": payload gained `trend` (median-MTTR-by-domain
    // lines); same reasoning — bump the namespace so a stale trend-less entry can't survive.
    // "mttrByDomain3" → "mttrByDomain4": trend gained `tailPoints` (fast-lane-excluded
    // medians for the chart's Median / Excl. fast lane toggle).
    // "mttrByDomain4" → "mttrByDomain5": rows gained `tailResolved` (the toggle now also
    // drives the Remediation-share pie).
    // "mttrByDomain5" → "mttrByDomain6": rows gained `awaiting` and switched `openPastSla`
    // to the actionable-clock view; bump so a stale from-detection entry can't survive.
    // "mttrByDomain6" → "mttrByDomain7": fast-lane machinery removed — rows' `tailMedian` /
    // `tailResolved` became a single `kmMedian`, `trend` lost `tailPoints`, the payload
    // dropped `thresholdDays`, and the fast-lane window left the key; bump so no stale
    // old-shape entry survives.
    // "mttrByDomain7" → "mttrByDomain8": the per-domain split now honors the show-no-fix
    // toggle (awaiting rows dropped when off); key gains showNoFix so on/off states cache apart.
    // "mttrByDomain8" → "mttrByDomain9": `trend` gained the KM-median-by-domain series
    // (`kmPoints`) that the chart now defaults to; bump so a stale kmPoints-less entry can't
    // survive the persistent dataVersion.
    // "mttrByDomain9" → "mttrByDomain10": rows/trend now exclude rows with no domain inputs
    // (unattributable compacted/imported resolved history) and the payload gained `excluded`;
    // bump so no stale old-shape entry survives the persistent dataVersion.
    // "mttrByDomain10" → "mttrByDomain11": `p90` switched from the naive closed-only percentile
    // to the censoring-aware KM p90 (off the same survival curve as the KM median); same shape,
    // new value, so bump the namespace to retire stale naive-p90 entries.
    // "mttrByDomain11" → "mttrByDomain12": the colored-group cap dropped from 8 to 5 (matching the
    // new categorical palette), so `trend.groups`/`points`/`kmPoints` now carry fewer groups and a
    // larger pooled "Other"; bump so a stale 8-group entry can't survive the persistent dataVersion.
    // "mttrByDomain12" → "mttrByDomain13": rows gained a generic `group` label + the payload a
    // `dimension` tag (shared with the by-support-group split); bump so no stale entry lacks them.
    "mttrByDomain13",
    {
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => mttrByDomainData(p),
    3600,
  );

// The by-support-group split shown when a Value Chain is selected — domain-scoped (keyed on
// domain, unlike the by-domain split), 1h TTL like the summary (carries open ages).
const cachedMttrBySupportGroupData = (p?: unknown) =>
  cached(
    "mttrBySupportGroup1",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => mttrBySupportGroupData(p),
    3600,
  );

export function getMttr(p?: unknown): ApiResult {
  return run(() => cachedMttrData(p));
}

export function getMttrTrend(p?: unknown): ApiResult {
  return run(() => cachedMttrTrendData(p));
}

/** MTTR page in one round trip (summary + trends share one state load). The breakdown section
 *  adapts to the scope: at the whole-chain view it's the per-domain split; when a single Value
 *  Chain is selected the by-domain split would be one row, so it becomes the per-support-group
 *  split within that domain. Both carry a `dimension` tag so the client relabels accordingly. */
export function getMttrPage(p?: unknown): ApiResult {
  const domain = String((p as Rec)?.["domain"] ?? "");
  return run(() => ({
    mttr: cachedMttrData(p),
    trends: cachedMttrTrendData(p),
    byDomain: domain ? cachedMttrBySupportGroupData(p) : cachedMttrByDomainData(p),
  }));
}

/** Executive landing page in one round trip — the lean sibling of getMttrPage. The exec
 *  view paints only the KM-median hero (`mttr`) and the per-domain split (`byDomain`); it
 *  never reads the trend series, so this endpoint deliberately omits `cachedMttrTrendData`
 *  — the heaviest read-model (full history backbone + per-point KM curves + SLA-burn +
 *  cohort attainment). Skipping it keeps the default landing page's cold path off that
 *  reconstruction entirely. Both slices come from the *same* `cached()` entries the MTTR
 *  page uses (whole-chain, all-severities), so exec→MTTR navigation still lands warm and
 *  the only difference is which slices this round trip computes. */
// Days the executive MTTR badge looks back — "last week".
const WEEK_MS = 7 * 86_400_000;

// Week-over-week KM-median delta for the executive hero badge: the KM median now vs the KM median
// as of ~7 days ago, both over the same scoped + severity population via the ledger's as-of
// estimator (the one the MTTR trend line replays). Severity-scoped, so it stays honest under a
// display-severity filter — unlike the whole-register mttr_history snapshots the MTTR page can only
// chip at the unscoped view, and KM-consistent with the hero value (mttr_history only ever held the
// naive median). Returns null (→ no badge) when the register has under a week of history or either
// endpoint's median is unobservable under censoring.
function executiveWeekTrend(p?: unknown): Rec | null {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const severities = readSeverities(p);
  const hideNoFix = !settingsStore.getShowNoFix();
  const base = scopedBaseRows(domain, supportGroup);
  if (!base.length) return null;
  // Need at least a week of history to have something to compare against.
  let earliest = Infinity;
  for (const r of base) {
    const f = parseTs(r["first_seen"]);
    if (f !== null && f < earliest) earliest = f;
  }
  const now = Date.now();
  const weekAgo = now - WEEK_MS;
  if (!Number.isFinite(earliest) || earliest > weekAgo) return null;
  const current = kmMedianAsOf(base, severities, now, { hideNoFix });
  const previous = kmMedianAsOf(base, severities, weekAgo, { hideNoFix });
  if (current === null || previous === null) return null;
  return {
    current,
    previous,
    deltaDays: Math.round((current - previous) * 1000) / 1000,
    days: 7,
  };
}

const cachedExecutiveWeekTrend = (p?: unknown) =>
  cached(
    "execWeekTrend",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => executiveWeekTrend(p),
    3600,
  );

export function getExecutivePage(p?: unknown): ApiResult {
  return run(() => ({
    mttr: cachedMttrData(p),
    byDomain: cachedMttrByDomainData(p),
    weekTrend: cachedExecutiveWeekTrend(p),
  }));
}

// --------------------------------------------------------------------- scan history

function scanHistoryData(): Rec {
  const scans = ledgerStore.loadScanRows().slice().reverse(); // newest first
  // KPI band only: drop no-fix findings when the toggle is off, so tracked/open/resolved/
  // median match the rest of the dashboard. The scans table (+ delete flow) stays unfiltered.
  const base = filterNoFixBase(
    ledgerStore.loadBaseRows() as unknown as Rec[],
    settingsStore.getShowNoFix(),
  ) as unknown as BaseRow[];
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

const cachedScanHistoryData = () =>
  // "scanHistory" → "scanHistory2": the KPI band now drops no-fix findings when the toggle is
  // off; params null → {showNoFix} so on/off states cache apart and no stale entry survives.
  cached("scanHistory2", { showNoFix: settingsStore.getShowNoFix() }, scanHistoryData);

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
  return run(
    () =>
      scanJobs.startScan({
        incremental: Boolean(params["incremental"]),
        sampleShape: (params["sampleShape"] as string) ?? undefined,
      }),
    "scan",
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
    // Report counts + MTTR honor the global show-no-fix toggle, like the dashboard views.
    const showNoFix = settingsStore.getShowNoFix();
    const displayed = filterNoFixFrame(
      findings.applyFilters(scan.records, {
        severities: settingsStore.getDisplaySeverities(),
        domains,
        supportGroups: sgFilter,
      }),
      showNoFix,
    );
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
    baseRows = filterNoFixBase(baseRows, showNoFix);
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
    const filtered = filterNoFixFrame(
      findings.applyFilters(scan.records, {
        severities: (params["severities"] as string[]) ?? settingsStore.getDisplaySeverities(),
        statuses: (params["statuses"] as string[]) ?? [],
        assetTypes: (params["assetTypes"] as string[]) ?? [],
        clouds: (params["clouds"] as string[]) ?? [],
        domains: (params["domains"] as string[]) ?? [],
        supportGroups: (params["supportGroups"] as string[]) ?? [],
        q: (params["q"] as string) ?? "",
      }),
      settingsStore.getShowNoFix(),
    );
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
    showNoFix: settingsStore.getShowNoFix(),
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

export function setShowNoFix(p?: unknown): ApiResult {
  return mutate(() => {
    settingsStore.setShowNoFix(Boolean((p as Rec)?.["on"]));
    return { showNoFix: settingsStore.getShowNoFix() };
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
  }, "supportGroupRefresh");
}

// -------------------------------------------------------------------- diagnostics

/** The recent server-side errors (newest first) for Settings → Diagnostics. */
export function getRecentErrors(_p?: unknown): ApiResult {
  return run(() => errorLog.recentErrors());
}

/** Clear the recent-errors log (the Diagnostics "Clear" action). */
export function clearRecentErrors(_p?: unknown): ApiResult {
  return run(() => {
    errorLog.clearErrors();
    return { cleared: true };
  });
}

// ---------------------------------------------------------------------------- misc

// cellCount() walks every sheet in the spreadsheet — cache it per DATA_VERSION. Extracted so
// warmReadModels and the endpoint share one entry.
const cachedStorageStatsData = () =>
  // "storageStats" → "storageStats2": payload gained the severity data-quality diagnostic
  // (distinctSeverities, unknownSeverityCount); dataVersion persists across deploys, so
  // bumping the namespace prevents serving a stale old-shape entry (up to the TTL).
  cached("storageStats2", null, () => {
    const scans = ledgerStore.loadScanRows();
    const scan = findings.currentScan();
    const baseRows = ledgerStore.loadBaseRows() as unknown as Rec[];
    return {
      cellCount: cellCount(),
      cellLimit: 10_000_000,
      scanCount: scans.length,
      sealedCount: scans.filter((s) => s.sealed).length,
      oldestScanTs: scans.length ? scans[0].ts : null,
      trackedVulns: baseRows.length,
      distinctSeverities: scan ? findings.distinct(scan.records, "severity") : [],
      unknownSeverityCount: baseRows.filter(
        (r) => normalizeSeverity(r["severity"]) === "UNKNOWN",
      ).length,
    };
  });

export function getStorageStats(_p?: unknown): ApiResult {
  return run(() => cachedStorageStatsData());
}

// ------------------------------------------------------------------- cache warming

// The default breakdown grouping key the OS-vulns page opens with at the whole-chain view
// (mirrors overview.js: domains when >1 configured, else asset type). Warmed so the lazy
// "Explore breakdown" drawer opens instantly right after a scan.
function defaultGroupingKeys(): string[] {
  return domainNames(settingsStore.getDomains().items).length > 1 ? ["domain"] : ["atype"];
}

/**
 * Precompute the derived read-models the landing pages open with, so the first analyst load
 * after a scan hits a warm cache instead of paying the full recompute on the interactive path.
 *
 * Every mutation calls bumpDataVersion(), so all cross-request caches go cold after a scan;
 * this runs at the tail of afterPersist (scanJobs), once DATA_VERSION is final (after any
 * auto-compaction), inside the scan job's own execution — the state + current-scan frame are
 * already loaded there, so warming reuses them. Best-effort: every entry is guarded so one
 * failure never aborts the rest or the scan, and the whole thing is a no-op on cache errors.
 *
 * Scope: whole-chain only (a specific Value Chain / Support group stays cold — acceptable),
 * for the current show-no-fix state, at both the severity scopes the pages request — the
 * all-severities entry (severities: null, the shared default) plus the configured Display
 * severity subset when it's narrower (pages send exactly that array via scopeParam).
 */
export function warmReadModels(): void {
  const warm = (label: string, fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      console.warn(`Cache warm (${label}) failed: ${e}`);
    }
  };

  // Severity-independent entries: the bootstrap core (also feeds the sidebar/counts), the
  // scan-history KPI band, and the Settings storage panel (cellCount walks every sheet).
  warm("bootstrap", () => bootstrap());
  warm("scanHistory", () => cachedScanHistoryData());
  warm("storageStats", () => cachedStorageStatsData());

  // The severity scopes the pages actually request (see the executive/mttr/overview/
  // attribution pages): the all-severities entry (severities null, the shared default) plus
  // the configured Display-severity subset when it's narrower.
  const display = settingsStore.getDisplaySeverities();
  const scopes: (string[] | null)[] = [null];
  if (Array.isArray(display) && display.length && display.length < SELECTABLE_SEVERITIES.length) {
    scopes.push([...display]);
  }
  const groupingKeys = defaultGroupingKeys();
  for (const severities of scopes) {
    const p = { domain: "", supportGroup: "", severities };
    warm("mttr", () => cachedMttrData(p));
    warm("mttrByDomain", () => cachedMttrByDomainData(p));
    warm("mttrTrend", () => cachedMttrTrendData(p));
    warm("insights", () => cachedInsightsData(p));
    warm("grouping", () => cachedGroupingData({ ...p, keys: groupingKeys }));
    warm("attribution", () => cachedAttributionData({ severities }));
  }
}
