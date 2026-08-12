// google.script.run API surface. Every endpoint returns {ok, data} | {ok:false,
// error} so the client wrapper promisifies uniformly. Reads never take the script
// lock; mutations run inside withScriptLock + recoverIfNeeded.

import {
  ASSET_COMPARATORS,
  CLIENT_ALL_MAX,
  filterAssetRows,
  pageOf,
  resolveAssetQuery,
  sortAssetRows,
} from "../domain/assetTable";
import {
  AARS_BAND_ORDER,
  AARS_BAND_SEVERITY_TOKEN,
  MAX_NODES_CEILING,
  MAX_NODES_FLOOR,
  SEVERITY_COLORS,
  SEVERITY_GLYPHS,
  SEVERITY_ORDER,
} from "../domain/config";
import { graphCacheParams, resolveGraphParams, resolveLayoutParams } from "../domain/graphApiParams";
import { layoutGraph } from "../domain/graphLayout";
import { projectGraph } from "../domain/graphProject";
import { AI_ASSET_KINDS, type GEdge, type GNode, type IssueRow } from "../domain/graphTypes";
import { COMBO_GROUPS, comboGroupById, comboSummary } from "../domain/toxicCombos";
import type { Rec } from "../domain/util";
import { archiveBytes } from "./archiveStore";
import { activeJob } from "./jobsStore";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { hasWizCredentials } from "./props";
import { cached, dataVersion } from "./serverCache";
import * as settingsStore from "./settingsStore";
import { cellCount, dataRowCount, TABS } from "./sheetsDb";
import * as syncJobs from "./syncJobs";
import * as syncStore from "./syncStore";

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
    const kind = e instanceof LedgerBusyError ? "busy" : "error";
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

function openIssues(): IssueRow[] {
  return syncStore.loadIssues().filter((i) => i.status === "OPEN");
}

// ------------------------------------------------------------------------ bootstrap

export function bootstrap(_p?: unknown): ApiResult {
  return run(() => ({
    ...(cached("bootstrapCore", null, bootstrapCore) as Rec),
    dataVersion: dataVersion(),
    hasCredentials: hasWizCredentials(),
    activeJob: (activeJob() as unknown as Rec) ?? null,
  }));
}

function bootstrapCore(): Rec {
  const assets = syncStore.loadAssets();
  const issues = openIssues();
  const latest = syncStore.latestSync();

  const bySeverity: Record<string, number> = {};
  for (const issue of issues) {
    bySeverity[issue.adjustedSeverity] = (bySeverity[issue.adjustedSeverity] ?? 0) + 1;
  }
  const byBand: Record<string, number> = {};
  for (const a of assets) {
    if (a.aarsBand) byBand[a.aarsBand] = (byBand[a.aarsBand] ?? 0) + 1;
  }

  return {
    palette: {
      order: SEVERITY_ORDER,
      colors: SEVERITY_COLORS,
      glyphs: SEVERITY_GLYPHS,
      aarsBands: AARS_BAND_ORDER,
      aarsBandSeverity: AARS_BAND_SEVERITY_TOKEN,
    },
    comboLegend: COMBO_GROUPS.map((g) => ({
      id: g.id,
      title: g.title,
      shortLabel: g.shortLabel,
      nativeSeverity: g.nativeSeverity,
      adjustedSeverity: g.adjustedSeverity,
    })),
    settings: {
      defaultDepth: settingsStore.getDefaultDepth(),
      maxNodes: settingsStore.getMaxNodes(),
      // The clamp bounds, so the graph's "Load more" and the Settings input can offer
      // exactly what the server will honor instead of hardcoding it twice.
      maxNodesFloor: MAX_NODES_FLOOR,
      maxNodesCeiling: MAX_NODES_CEILING,
    },
    latestSync: latest,
    counts: {
      aiAssets: assets.filter((a) => AI_ASSET_KINDS.includes(a.kind)).length,
      totalAssets: assets.length,
      openIssues: issues.length,
      bySeverity,
      byBand,
    },
    filterOptions: filterOptions(assets),
  };
}

function filterOptions(assets: GNode[]): Rec {
  const kinds = new Set<string>();
  const clouds = new Set<string>();
  const projects = new Set<string>();
  for (const a of assets) {
    kinds.add(a.kind);
    if (a.cloudPlatform) clouds.add(a.cloudPlatform);
    for (const p of a.projects ?? []) projects.add(p.name);
    // The risk nodes are derived on read and never land in TABS.assets, so the flags they
    // come from are the only trace of them here. Offer each kind as a pill exactly when
    // some asset would produce one, so the evidence stays curatable.
    if (a.hasSensitiveData || a.hasAccessToSensitiveData) kinds.add("SENSITIVE_DATA");
    if (a.isAccessibleFromInternet === true || a.isOpenToAllInternet === true) {
      kinds.add("INTERNET_EXPOSURE");
    }
    if (a.hasAdminPrivileges || a.hasHighPrivileges) kinds.add("EXCESSIVE_PRIVILEGE");
    if (a.guardrailMissing === true) kinds.add("MISSING_GUARDRAIL");
  }
  return {
    kinds: [...kinds].sort(),
    clouds: [...clouds].sort(),
    projects: [...projects].sort(),
  };
}

// ---------------------------------------------------------------------------- graph

export function getGraph(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    // Cache on the NORMALIZED RAW request: a hit costs one Properties read plus
    // the CacheService fetch — no Sheets or Drive I/O at all. Seed resolution
    // and settings defaults live INSIDE the compute; they only change when the
    // data version bumps, and the version is part of the key.
    return cached("getGraph", graphCacheParams(params), () => {
      const doc = syncStore.loadGraphDoc();
      if (!doc) return { empty: true };
      const options = resolveGraphParams(params, {
        defaultDepth: settingsStore.getDefaultDepth(),
        maxNodes: settingsStore.getMaxNodes(),
        issues: openIssues(),
        scoredAssetIds: doc.nodes.filter((n) => (n.aars ?? 0) > 0).map((n) => n.id),
      });
      const view = resolveLayoutParams(params);
      const projection = projectGraph(doc, options);
      const layout = layoutGraph(projection, view);
      return {
        nodes: projection.nodes,
        edges: projection.edges,
        summaries: projection.summaries,
        counts: projection.counts,
        layout,
        options: {
          depth: options.depth,
          maxNodes: options.maxNodes, // the budget in force, so the UI can name it
          seedIds: options.seedIds,
          expandIds: options.expandIds ?? [],
          layout: view.mode,
          groupBy: view.groupBy,
          sort: view.sort,
        },
        syncedAt: doc.syncedAt,
      };
    });
  });
}

// ------------------------------------------------------------------------ inventory

function assetRow(n: GNode): Rec {
  return {
    id: n.id,
    name: n.name,
    kind: n.kind,
    nativeType: n.nativeType ?? null,
    cloud: n.cloudPlatform ?? null,
    region: n.region ?? null,
    status: n.status ?? null,
    projects: (n.projects ?? []).map((p) => p.name),
    severity: n.severity ?? null,
    aars: n.aars ?? null,
    aarsBand: n.aarsBand ?? null,
    comboGroups: n.comboGroups ?? [],
    internet: n.isAccessibleFromInternet ?? null,
    openInternet: n.isOpenToAllInternet ?? null,
    sensitiveAccess: n.hasAccessToSensitiveData ?? false,
    sensitiveData: n.hasSensitiveData ?? false,
    highPriv: n.hasHighPrivileges ?? false,
    adminPriv: n.hasAdminPrivileges ?? false,
    guardrailMissing: n.guardrailMissing ?? false,
    technologyCategories: n.technologyCategories ?? [],
    cloudAccount: n.cloudAccount?.name ?? null,
    tags: n.tags ?? [],
    identityPurpose: n.identityPurpose ?? null,
    issueAnalytics: n.issueAnalytics ?? null,
  };
}

/**
 * The inventory table's own projection: the dozen fields the row actually renders, out of
 * the ~25 assetRow carries. The table is the one place that ships every asset at once, so
 * everything the drill-down needs and the list doesn't stays behind getAssetDetail.
 */
function assetTableRow(n: GNode): Rec {
  return {
    id: n.id,
    name: n.name,
    kind: n.kind,
    cloud: n.cloudPlatform ?? null,
    region: n.region ?? null,
    severity: n.severity ?? null,
    aars: n.aars ?? null,
    aarsBand: n.aarsBand ?? null,
    combos: (n.comboGroups ?? []).length,
    guardrailMissing: n.guardrailMissing ?? false,
    agentic: n.identityPurpose === "AGENTIC",
    projects: (n.projects ?? []).map((p) => p.name),
  };
}

interface AssetsModel {
  rows: Rec[];
  kpis: Rec;
  bandCounts: Record<string, number>;
  facets: { kinds: string[]; clouds: string[]; bands: string[] };
}

/**
 * Everything about the inventory that doesn't depend on the request: every table row, the
 * KPI totals, the AARS-band histogram and the filter-bar options. The aggregates are
 * computed over the whole inventory on purpose — the KPI row and the chart describe the
 * estate, never the page or the filtered subset, so they stay honest when the client only
 * ever holds 50 rows.
 */
function assetsModel(): AssetsModel {
  const assets = syncStore.loadAssets();
  const issues = openIssues();
  const agents = assets.filter((a) => a.kind === "AI_AGENT");
  const protectedAgents = agents.filter((a) => !a.guardrailMissing).length;
  const rows = assets.map(assetTableRow).sort(ASSET_COMPARATORS.aars);

  const bandCounts: Record<string, number> = {};
  const kinds = new Set<string>();
  const clouds = new Set<string>();
  for (const a of assets) {
    if (a.aarsBand) bandCounts[a.aarsBand] = (bandCounts[a.aarsBand] ?? 0) + 1;
    kinds.add(a.kind);
    if (a.cloudPlatform) clouds.add(a.cloudPlatform);
  }

  return {
    rows,
    kpis: {
      aiAssets: assets.filter((a) => AI_ASSET_KINDS.includes(a.kind)).length,
      agents: agents.length,
      criticalBand: assets.filter((a) => a.aarsBand === "CRITICAL").length,
      highBand: assets.filter((a) => a.aarsBand === "HIGH").length,
      guardrailCoveragePct: agents.length
        ? Math.round((protectedAgents / agents.length) * 100)
        : null,
      sensitiveAccess: assets.filter(
        (a) => AI_ASSET_KINDS.includes(a.kind) && a.hasAccessToSensitiveData,
      ).length,
      openIssues: issues.length,
      complianceGaps: syncStore.loadFindings().length,
      agenticIdentities: assets.filter((a) => a.identityPurpose === "AGENTIC").length,
    },
    bandCounts,
    facets: {
      kinds: [...kinds].sort(),
      clouds: [...clouds].sort(),
      bands: AARS_BAND_ORDER.filter((b) => bandCounts[b]),
    },
  };
}

export function getAssets(p?: unknown): ApiResult {
  return run(() => {
    const query = resolveAssetQuery((p ?? {}) as Rec);
    // The expensive half — reading every asset and deriving the KPIs, the band histogram
    // and the facet options — is cached once per data version and shared by every page
    // and filter combination; only the filter/sort/slice below runs per request. The
    // cache name deliberately differs from the pre-pagination "getAssets" entry, so a
    // still-warm cache can't answer a paginating client with the old payload shape.
    const model = cached("assetsModel", null, assetsModel) as AssetsModel;
    const head = {
      total: model.rows.length,
      kpis: model.kpis,
      bandCounts: model.bandCounts,
      facets: model.facets,
      pageSize: query.pageSize,
      sort: query.sort,
    };

    // Small inventory: ship it whole and let the browser filter, sort and page with no
    // further RPCs — the pre-pagination behavior, kept where it's affordable.
    if (model.rows.length <= CLIENT_ALL_MAX) {
      return {
        ...head,
        all: true,
        rows: model.rows,
        filtered: model.rows.length,
        page: 0,
        pageCount: Math.max(1, Math.ceil(model.rows.length / query.pageSize)),
      };
    }

    const filtered = sortAssetRows(filterAssetRows(model.rows, query), query.sort);
    const paged = pageOf(filtered, query.page, query.pageSize);
    return {
      ...head,
      all: false,
      rows: paged.rows,
      filtered: filtered.length,
      page: paged.page,
      pageCount: paged.pageCount,
    };
  });
}

/**
 * Every asset as {id, name, kind} for the graph page's seed picker — a dropdown needs the
 * whole list, but not the table projection's other ten fields (and certainly not one page
 * of it). Same order as the inventory's default sort: worst AARS first.
 */
export function getAssetOptions(_p?: unknown): ApiResult {
  return run(() =>
    cached("assetOptions", null, () => ({
      rows: [...syncStore.loadAssets()]
        .sort((a, b) => Number(b.aars ?? -1) - Number(a.aars ?? -1))
        .map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
    })),
  );
}

export function getAssetDetail(p?: unknown): ApiResult {
  return run(() => {
    const id = String(((p ?? {}) as Rec)["id"] ?? "");
    // Cached: opening the same detail sheet twice must not re-read Drive+Sheets.
    return cached("getAssetDetail", { id }, () => {
      const doc = syncStore.loadGraphDoc();
      if (!doc) return null;
      const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
      const node = nodeById.get(id);
      if (!node) return null;
      const issues = openIssues().filter((i) => i.assetId === id);
      const neighbors: Array<{ edge: GEdge; node: Rec; direction: "out" | "in" }> = [];
      for (const edge of doc.edges) {
        if (edge.src !== id && edge.dst !== id) continue;
        const otherId = edge.src === id ? edge.dst : edge.src;
        const other = nodeById.get(otherId);
        if (!other || other.kind === "ISSUE") continue;
        neighbors.push({
          edge,
          node: assetRow(other),
          direction: edge.src === id ? "out" : "in",
        });
      }
      const findings = syncStore.loadFindings().filter((f) => f.resourceId === id);
      return {
        node: { ...assetRow(node), aarsPillars: node.aarsPillars ?? null },
        issues,
        neighbors,
        findings,
      };
    });
  });
}

// --------------------------------------------------------------------------- issues

export function getIssues(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const group = String(params["group"] ?? "");
    return cached("getIssues", { group }, () => {
      let rows = syncStore.loadIssues();
      if (group) rows = rows.filter((i) => i.comboGroup === group);
      return { rows, total: rows.length };
    });
  });
}

export function getIssueDetail(p?: unknown): ApiResult {
  return run(() => {
    const id = String(((p ?? {}) as Rec)["id"] ?? "");
    const issue = syncStore.loadIssues().find((i) => i.id === id) ?? null;
    if (!issue) return null;
    const group = issue.comboGroup ? comboGroupById(issue.comboGroup) : null;
    return {
      issue,
      group: group
        ? {
            id: group.id,
            title: group.title,
            adjustedSeverity: group.adjustedSeverity,
            nativeSeverity: group.nativeSeverity,
            amplifierNote: group.amplifierNote,
            frameworks: group.frameworks,
          }
        : null,
    };
  });
}

export function getToxicCombos(_p?: unknown): ApiResult {
  return run(() =>
    cached("getToxicCombos", null, () => {
      const issues = openIssues();
      const assets = new Map(syncStore.loadAssets().map((a) => [a.id, a]));
      return {
        groups: comboSummary(issues).map((s) => ({
          id: s.group.id,
          ruleId: s.group.ruleId,
          title: s.group.title,
          shortLabel: s.group.shortLabel,
          nativeSeverity: s.group.nativeSeverity,
          adjustedSeverity: s.group.adjustedSeverity,
          amplifierNote: s.group.amplifierNote,
          frameworks: s.group.frameworks,
          count: s.count,
          assets: s.assetIds.map((id) => {
            const a = assets.get(id);
            return a
              ? { id, name: a.name, aars: a.aars ?? null, aarsBand: a.aarsBand ?? null }
              : { id, name: id, aars: null, aarsBand: null };
          }),
        })),
        totalOpen: issues.length,
      };
    }),
  );
}

// ----------------------------------------------------------------------------- sync

export function runSync(_p?: unknown): ApiResult {
  return mutate(() => syncJobs.startSync());
}

export function getJobStatus(p?: unknown): ApiResult {
  return run(() => syncJobs.jobStatus(String(((p ?? {}) as Rec)["jobId"] ?? "")));
}

export function cancelSync(p?: unknown): ApiResult {
  // Lock-free on purpose: the cancel flag must land while the sync holds the lock.
  return run(() => syncJobs.cancelSync(String(((p ?? {}) as Rec)["jobId"] ?? "")));
}

export function getSyncHistory(_p?: unknown): ApiResult {
  return run(() => cached("getSyncHistory", null, () => ({
    rows: syncStore.syncHistory().reverse(),
  })));
}

// ------------------------------------------------------------------------- settings

export function getSettings(_p?: unknown): ApiResult {
  return run(() => ({
    defaultDepth: settingsStore.getDefaultDepth(),
    maxNodes: settingsStore.getMaxNodes(),
    maxNodesFloor: MAX_NODES_FLOOR,
    maxNodesCeiling: MAX_NODES_CEILING,
    hasCredentials: hasWizCredentials(),
  }));
}

export function setSettings(p?: unknown): ApiResult {
  return mutate(() => {
    const params = (p ?? {}) as Rec;
    if (params["defaultDepth"] !== undefined) {
      settingsStore.setDefaultDepth(params["defaultDepth"]);
    }
    if (params["maxNodes"] !== undefined) settingsStore.setMaxNodes(params["maxNodes"]);
    return {
      defaultDepth: settingsStore.getDefaultDepth(),
      maxNodes: settingsStore.getMaxNodes(),
    };
  });
}

// ----------------------------------------------------------------------------- data

export function resetData(_p?: unknown): ApiResult {
  return mutate(() => {
    syncStore.resetData();
    return { message: "All synced data cleared." };
  });
}

export function getStorageStats(_p?: unknown): ApiResult {
  return run(() =>
    cached("getStorageStats", null, () => ({
      cellCount: cellCount(),
      archiveBytes: archiveBytes(),
      rows: {
        assets: dataRowCount(TABS.assets),
        edges: dataRowCount(TABS.edges),
        issues: dataRowCount(TABS.issues),
        syncs: dataRowCount(TABS.syncHistory),
      },
    }), 3_600),
  );
}
