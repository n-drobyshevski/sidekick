// google.script.run API surface. Every endpoint returns {ok, data} | {ok:false,
// error} so the client wrapper promisifies uniformly. Reads never take the script
// lock; mutations run inside withScriptLock + recoverIfNeeded.

import {
  ASSET_COMPARATORS,
  CLIENT_ALL_MAX,
  facetCounts,
  filterAssetRows,
  pageOf,
  resolveAssetQuery,
  sortAssetRows,
} from "../domain/assetTable";
import {
  computeAars,
  DEFAULT_AARS_RULE,
  gap,
  gapBreakdown,
  type DataExposure,
} from "../domain/aars";
import {
  BAND_MAX,
  BAND_MIN,
  bandRanges,
  cleanAarsRule,
  cleanGapCode,
  gapMatchTally,
  MAX_GAP_RULES,
  MULTIPLIER_MAX,
  MULTIPLIER_MIN,
  POINTS_MAX,
  ruleSummary,
  shadowedGapRules,
  validateAarsRule,
} from "../domain/aarsRule";
import {
  aarsTrendFromHistory,
  countAarsSeverities,
  ruleChangePoints,
  type AarsTrendPoint,
} from "../domain/aarsTrend";
import {
  AARS_SEVERITY_ORDER,
  MAX_NODES_CEILING,
  MAX_NODES_FLOOR,
  SEVERITY_COLORS,
  SEVERITY_GLYPHS,
  SEVERITY_ORDER,
  type Severity,
} from "../domain/config";
import { graphCacheParams, resolveGraphParams, resolveLayoutParams } from "../domain/graphApiParams";
import { conditionHolds, conditionState } from "../domain/riskConditions";
import { layoutGraph } from "../domain/graphLayout";
import { projectGraph } from "../domain/graphProject";
import { AI_ASSET_KINDS, type GEdge, type GNode, type IssueRow } from "../domain/graphTypes";
import { comboDigest } from "../domain/comboDigest";
import { COMBO_GROUPS, comboGroupById, comboSummary } from "../domain/toxicCombos";
import type { Rec } from "../domain/util";
import { archiveBytes } from "./archiveStore";
import { activeJob } from "./jobsStore";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { buildInfo } from "./buildInfo";
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
    // Outside the cached core on purpose: a cached build stamp would be the one thing
    // guaranteed to lie after a deploy.
    build: buildInfo(),
    activeJob: (activeJob() as unknown as Rec) ?? null,
  }));
}

function bootstrapCore(): Rec {
  const assets = syncStore.loadAssets();
  const issues = openIssues();
  const latest = syncStore.latestSync();
  const aarsRule = settingsStore.getAarsRule();
  const scoredVersion = settingsStore.getScoredRuleVersion();

  const bySeverity: Record<string, number> = {};
  for (const issue of issues) {
    bySeverity[issue.adjustedSeverity] = (bySeverity[issue.adjustedSeverity] ?? 0) + 1;
  }
  const byAarsSeverity: Record<string, number> = {};
  for (const a of assets) {
    if (a.aarsSeverity) byAarsSeverity[a.aarsSeverity] = (byAarsSeverity[a.aarsSeverity] ?? 0) + 1;
  }

  return {
    palette: {
      order: SEVERITY_ORDER,
      colors: SEVERITY_COLORS,
      glyphs: SEVERITY_GLYPHS,
      aarsSeverities: AARS_SEVERITY_ORDER,
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
    // The band ranges every page's AARS copy is written from, so "score 70–100" is read
    // off the rule in force instead of being retyped wherever a level is named.
    aarsRule: {
      version: aarsRule.version,
      bands: aarsRule.rule.bands,
      bandRanges: bandRanges(aarsRule.rule.bands),
      // The three pillar ceilings, so the detail sheet's breakdown bars measure against
      // the rule in force instead of hardcoding the defaults and lying after an edit.
      // Pillar C's ceiling is its own top exposure tier through the amplifier — the same
      // arithmetic `aars.ts` does when it scores.
      pillarCaps: {
        toxic: aarsRule.rule.pillarACap,
        compliance: aarsRule.rule.pillarBCap,
        data: Math.round(
          Math.max(...Object.values(aarsRule.rule.dataExposurePoints)) *
            aarsRule.rule.dataAmplifier,
        ),
      },
      scoredVersion,
      stale: scoredVersion !== aarsRule.version,
    },
    latestSync: latest,
    counts: {
      aiAssets: assets.filter((a) => AI_ASSET_KINDS.includes(a.kind)).length,
      totalAssets: assets.length,
      openIssues: issues.length,
      bySeverity,
      byAarsSeverity,
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
    // some asset would produce one, so the evidence stays curatable. `conditionHolds` is
    // the same strict reading the topology builders use, so a pill appears exactly when a
    // node would be drawn — these predicates were open-coded here and drifted once already.
    if (conditionHolds(a, "SENSITIVE_DATA")) kinds.add("SENSITIVE_DATA");
    if (conditionHolds(a, "INTERNET_EXPOSURE")) kinds.add("INTERNET_EXPOSURE");
    if (conditionHolds(a, "EXCESSIVE_PRIVILEGE")) kinds.add("EXCESSIVE_PRIVILEGE");
    if (conditionHolds(a, "MISSING_GUARDRAIL")) kinds.add("MISSING_GUARDRAIL");
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
    aarsSeverity: n.aarsSeverity ?? null,
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
function assetTableRow(n: GNode, issuesBySeverity?: Record<string, number>): Rec {
  const row: Rec = {
    id: n.id,
    name: n.name,
    kind: n.kind,
    cloud: n.cloudPlatform ?? null,
    region: n.region ?? null,
    severity: n.severity ?? null,
    aars: n.aars ?? null,
    aarsSeverity: n.aarsSeverity ?? null,
    combos: (n.comboGroups ?? []).length,
    guardrailMissing: n.guardrailMissing ?? false,
    agentic: n.identityPurpose === "AGENTIC",
    projects: (n.projects ?? []).map((p) => p.name),
  };
  // Only the rows that have open issues carry the breakdown. Most of a healthy estate has
  // none, and an empty object per row is pure weight in the all-inventory payload.
  if (issuesBySeverity) row["issuesBySeverity"] = issuesBySeverity;
  return row;
}

/**
 * Open issues rolled up per asset and severity — the breakdown behind the table's
 * `severity` column, which is only the worst of them. Built from the same issue rows the
 * KPIs already load, so the badge and the bar can never disagree, and computed inside the
 * cached model: one pass per sync, not one per request.
 */
function issuesBySeverityByAsset(issues: IssueRow[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const issue of issues) {
    if (!issue.assetId) continue;
    const bucket = out.get(issue.assetId) ?? {};
    const sev = issue.adjustedSeverity ?? "UNKNOWN";
    bucket[sev] = (bucket[sev] ?? 0) + 1;
    out.set(issue.assetId, bucket);
  }
  return out;
}

interface AssetsModel {
  rows: Rec[];
  kpis: Rec;
  aarsSeverityCounts: Record<string, number>;
  aarsTrend: AarsTrendPoint[];
  /** Indices in aarsTrend where the scoring model changed — the chart marks them. */
  aarsTrendRuleChanges: number[];
  facets: {
    kinds: string[];
    clouds: string[];
    regions: string[];
    aarsSeverities: string[];
    severities: string[];
    projects: string[];
  };
}

/**
 * Everything about the inventory that doesn't depend on the request: every table row, the
 * KPI totals, the AARS-severity histogram and the filter vocabulary. The aggregates are
 * computed over the whole inventory on purpose — the KPI row and the chart describe the
 * estate, never the page or the filtered subset, so they stay honest when the client only
 * ever holds 50 rows.
 */
function assetsModel(): AssetsModel {
  const trend = aarsTrendFromHistory(syncStore.syncHistory());
  const assets = syncStore.loadAssets();
  const issues = openIssues();
  const agents = assets.filter((a) => a.kind === "AI_AGENT");
  const protectedAgents = agents.filter((a) => !a.guardrailMissing).length;
  const issueRollup = issuesBySeverityByAsset(issues);
  const rows = assets
    .map((a) => assetTableRow(a, issueRollup.get(a.id)))
    .sort(ASSET_COMPARATORS.aars);

  const aarsSeverityCounts: Record<string, number> = {};
  const kinds = new Set<string>();
  const clouds = new Set<string>();
  const regions = new Set<string>();
  const severities = new Set<string>();
  const projects = new Set<string>();
  for (const a of assets) {
    if (a.aarsSeverity) aarsSeverityCounts[a.aarsSeverity] = (aarsSeverityCounts[a.aarsSeverity] ?? 0) + 1;
    kinds.add(a.kind);
    if (a.cloudPlatform) clouds.add(a.cloudPlatform);
    if (a.region) regions.add(a.region);
    if (a.severity) severities.add(a.severity);
    for (const p of a.projects ?? []) if (p.name) projects.add(p.name);
  }

  return {
    rows,
    kpis: {
      aiAssets: assets.filter((a) => AI_ASSET_KINDS.includes(a.kind)).length,
      agents: agents.length,
      // The numerator, not just the percentage. The Wiz Scans page states coverage as
      // "3 of 71 agents"; without this it had to recover the 3 by counting rows, which
      // only works while the client holds every row.
      protectedAgents,
      criticalAars: assets.filter((a) => a.aarsSeverity === "CRITICAL").length,
      highAars: assets.filter((a) => a.aarsSeverity === "HIGH").length,
      guardrailCoveragePct: agents.length
        ? Math.round((protectedAgents / agents.length) * 100)
        : null,
      sensitiveAccess: assets.filter(
        (a) => AI_ASSET_KINDS.includes(a.kind) && a.hasAccessToSensitiveData,
      ).length,
      openIssues: issues.length,
      complianceGaps: syncStore.loadFindings().length,
      agenticIdentities: assets.filter((a) => a.identityPurpose === "AGENTIC").length,
      // Estate-wide counts for the two risk conditions that had no total. The flags were
      // persisted and drawn on the graph, but `assetTableRow` strips them, so nothing
      // could say how much of the estate they cover. `internetUnknown` is its own number
      // on purpose: a hosted agent inherits exposure from its host and Wiz reports that
      // as undetermined, so folding it into "not exposed" under-reports.
      internetExposed: assets.filter((a) => conditionState(a, "INTERNET_EXPOSURE") === true).length,
      internetUnknown: assets.filter((a) => conditionState(a, "INTERNET_EXPOSURE") === null).length,
      highPrivilege: assets.filter((a) => conditionHolds(a, "EXCESSIVE_PRIVILEGE")).length,
    },
    aarsSeverityCounts,
    // Recorded per sync, so the window is short at first and cannot be backfilled.
    aarsTrend: trend,
    aarsTrendRuleChanges: ruleChangePoints(trend),
    facets: {
      kinds: [...kinds].sort(),
      clouds: [...clouds].sort(),
      regions: [...regions].sort(),
      aarsSeverities: AARS_SEVERITY_ORDER.filter((sev) => aarsSeverityCounts[sev]),
      severities: SEVERITY_ORDER.filter((sev) => severities.has(sev)),
      projects: [...projects].sort(),
    },
  };
}

export function getAssets(p?: unknown): ApiResult {
  return run(() => {
    const query = resolveAssetQuery((p ?? {}) as Rec);
    // The expensive half — reading every asset and deriving the KPIs, the severity histogram
    // and the facet options — is cached once per data version and shared by every page
    // and filter combination; only the filter/sort/slice below runs per request. The
    // cache name deliberately differs from the pre-pagination "getAssets" entry, so a
    // still-warm cache can't answer a paginating client with the old payload shape.
    const model = cached("assetsModel", null, assetsModel) as AssetsModel;
    const head = {
      total: model.rows.length,
      kpis: model.kpis,
      aarsSeverityCounts: model.aarsSeverityCounts,
      aarsTrend: model.aarsTrend,
      aarsTrendRuleChanges: model.aarsTrendRuleChanges,
      aarsDeltas: aarsDeltas(model.aarsTrend, model.aarsSeverityCounts),
      facets: model.facets,
      pageSize: query.pageSize,
      sort: query.sort,
      dir: query.dir,
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

    const filtered = sortAssetRows(filterAssetRows(model.rows, query), query.sort, query.dir);
    const paged = pageOf(filtered, query.page, query.pageSize);
    return {
      ...head,
      all: false,
      rows: paged.rows,
      filtered: filtered.length,
      page: paged.page,
      pageCount: paged.pageCount,
      // Deliberately outside the data-version cache: these depend on the query. Only the
      // paged path ships them — the all path's client holds every row and counts its own,
      // because in that mode a filter change never reaches the server at all.
      facetCounts: facetCounts(model.rows, query),
    };
  });
}

/**
 * Change in each AARS severity count since the previous sync, or null when the comparison
 * would be dishonest. Three things can make it so, and all three are silence rather than a
 * hedged number:
 *  - fewer than two points: nothing to compare against;
 *  - the scoring rule changed between them: the two points aren't on the same scale;
 *  - the latest point disagrees with the live counts, which means the estate was rescored
 *    (AARS Rules → Recompute) without a sync — so a delta would explain a figure that
 *    isn't the one on screen.
 */
function aarsDeltas(
  trend: AarsTrendPoint[],
  live: Record<string, number>,
): { counts: Record<string, number>; since: string } | null {
  if (trend.length < 2) return null;
  const last = trend[trend.length - 1];
  const prev = trend[trend.length - 2];
  if (last.ruleVersion !== prev.ruleVersion) return null;
  for (const sev of AARS_SEVERITY_ORDER) {
    if ((last.counts?.[sev] ?? 0) !== (live[sev] ?? 0)) return null;
  }
  const counts: Record<string, number> = {};
  for (const sev of AARS_SEVERITY_ORDER) {
    counts[sev] = (last.counts?.[sev] ?? 0) - (prev.counts?.[sev] ?? 0);
  }
  return { counts, since: prev.at };
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
      const assetRows = syncStore.loadAssets();
      const assets = new Map(assetRows.map((a) => [a.id, a]));
      return {
        // Every count the page renders, computed once here rather than four times in the
        // browser. Additive: the `groups` shape below is unchanged, so a payload cached
        // before this shipped still renders the page (minus the summary sections).
        digest: comboDigest(issues, assetRows, new Date().toISOString()),
        groups: comboSummary(issues).map((s) => ({
          id: s.group.id,
          ruleId: s.group.ruleId,
          title: s.group.title,
          shortLabel: s.group.shortLabel,
          nativeSeverity: s.group.nativeSeverity,
          adjustedSeverity: s.group.adjustedSeverity,
          amplifierNote: s.group.amplifierNote,
          // The declared half of the condition matrix. It rides on the group rather than
          // only on the digest so the card's condition strip still says what the rule
          // tests when an older cached payload arrives with no digest attached.
          conditions: s.group.conditions,
          frameworks: s.group.frameworks,
          count: s.count,
          assets: s.assetIds.map((id) => {
            const a = assets.get(id);
            return a
              ? { id, name: a.name, aars: a.aars ?? null, aarsSeverity: a.aarsSeverity ?? null }
              : { id, name: id, aars: null, aarsSeverity: null };
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

// ------------------------------------------------------------------------ AARS rule

/** One preview never ships more than this many movers; the true count travels beside it. */
const PREVIEW_MOVERS_MAX = 50;
/** Bounds on one sandbox input, so a hand-crafted request can't grow the work unboundedly. */
const SAMPLE_SEVERITIES_MAX = 50;
const SAMPLE_GAPS_MAX = 30;
/** Codes the census names. Well above the codebook's ~40, so a real tenant's shortIds fit. */
const GAP_CENSUS_MAX = 200;

function ruleState(): Rec {
  const stored = settingsStore.getAarsRule();
  const scoredVersion = settingsStore.getScoredRuleVersion();
  return {
    version: stored.version,
    rule: stored.rule,
    defaults: DEFAULT_AARS_RULE,
    summary: ruleSummary(stored.rule),
    scoredVersion,
    // Only the point model can strand the persisted scores; bands re-derive on read, and
    // setAarsRule carries the marker forward across a band-only edit.
    stale: scoredVersion !== stored.version,
    bandRanges: bandRanges(stored.rule.bands),
    limits: {
      pointsMax: POINTS_MAX,
      multiplierMin: MULTIPLIER_MIN,
      multiplierMax: MULTIPLIER_MAX,
      bandMin: BAND_MIN,
      bandMax: BAND_MAX,
      maxGapRules: MAX_GAP_RULES,
    },
  };
}

export function getAarsRule(_p?: unknown): ApiResult {
  return run(() => ruleState());
}

export function setAarsRule(p?: unknown): ApiResult {
  return mutate(() => {
    const params = (p ?? {}) as Rec;
    const proposed = cleanAarsRule(params["rule"]);
    const errors = validateAarsRule(proposed);
    if (errors.length) throw new Error(errors.join(" "));
    settingsStore.setAarsRule(proposed);
    return ruleState();
  });
}

/**
 * What saving this rule would do to the inventory as it reads right now. The baseline is
 * deliberately the CURRENT display (persisted scores under the current bands), not a
 * re-score under the stored rule: the honest answer to "what changes on screen" has to
 * start from what is on screen, stale scores included — the page flags those separately.
 */
export function previewAarsRule(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const proposed = cleanAarsRule(params["rule"]);
    const errors = validateAarsRule(proposed);
    if (errors.length) throw new Error(errors.join(" "));

    const before = syncStore.loadAssets();
    const after = syncStore.scoreAssetsWith(proposed);
    const beforeById = new Map(before.map((n) => [n.id, n]));

    // What the cascade actually priced, from the scoring inputs already persisted beside
    // each asset (`aars_input_json`) — so the coverage numbers cost no extra Sheets read.
    // They ride on THIS endpoint and never on getAarsRule: loading the rules page must not
    // trigger an inventory pass, and getAarsRule's shape is pinned by a golden snapshot.
    const tally = gapMatchTally(
      proposed,
      before.map((n) => (n.aarsInput?.gaps ?? []).map((g) => g.code)),
    );
    const census = Object.keys(tally.byCode)
      .map((code) => ({ code, assets: tally.byCode[code]! }))
      .sort((x, y) => y.assets - x.assets || x.code.localeCompare(y.code))
      .slice(0, GAP_CENSUS_MAX);

    const movers: Rec[] = [];
    for (const a of after) {
      const b = beforeById.get(a.id);
      const fromScore = typeof b?.aars === "number" ? b.aars : null;
      const toScore = typeof a.aars === "number" ? a.aars : null;
      const fromSeverity = b?.aarsSeverity ?? null;
      const toSeverity = a.aarsSeverity ?? null;
      if (fromScore === toScore && fromSeverity === toSeverity) continue;
      movers.push({
        id: a.id,
        name: a.name,
        kind: a.kind,
        fromScore,
        toScore,
        fromSeverity,
        toSeverity,
        levelChanged: fromSeverity !== toSeverity,
        delta: (toScore ?? 0) - (fromScore ?? 0),
      });
    }
    // Level changes first — they are what the levels and the KPIs actually report — then
    // the biggest score moves, so a truncated list still shows the consequential rows.
    movers.sort((x, y) => {
      const lvl = Number(y["levelChanged"]) - Number(x["levelChanged"]);
      if (lvl) return lvl;
      const mag = Math.abs(Number(y["delta"])) - Math.abs(Number(x["delta"]));
      if (mag) return mag;
      return Number(y["toScore"] ?? -1) - Number(x["toScore"] ?? -1);
    });

    return {
      total: before.length,
      current: countAarsSeverities(before),
      proposed: countAarsSeverities(after),
      // The proposed rule read back in prose, and the rows that can never fire — both
      // describe the draft, so they travel with the preview rather than the saved state.
      summary: ruleSummary(proposed),
      bandRanges: bandRanges(proposed.bands),
      shadowedGapRules: shadowedGapRules(proposed),
      // Coverage: how many gap instances each cascade row priced, what fell through to the
      // fallback, and the codes the estate carries. A row at 0 here is NOT the same claim
      // as shadowedGapRules — one can never fire, the other simply is not exercised — and
      // the page reads them as two different sentences.
      gapMatchCounts: tally.perRule,
      gapFallbackCount: tally.fallback,
      gapInstanceTotal: tally.total,
      gapCensus: census,
      movers: movers.slice(0, PREVIEW_MOVERS_MAX),
      moverCount: movers.length,
      levelChangeCount: movers.filter((m) => m["levelChanged"]).length,
      // Counted apart from the level changes: moving a threshold re-labels assets without
      // touching a single score, and saying "N assets change score" for that would be a lie.
      scoreChangeCount: movers.filter((m) => m["fromScore"] !== m["toScore"]).length,
      truncated: movers.length > PREVIEW_MOVERS_MAX,
    };
  });
}

/**
 * Score one hypothetical asset. The sandbox goes through the server rather than
 * reimplementing the model in client JS: the score has exactly one implementation, and it
 * is the tested one.
 */
export function scoreAarsSample(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const rule = cleanAarsRule(params["rule"]);
    const sample = (params["sample"] ?? {}) as Rec;

    const rawSeverities = Array.isArray(sample["issueSeverities"]) ? sample["issueSeverities"] : [];
    const issueSeverities = rawSeverities
      .slice(0, SAMPLE_SEVERITIES_MAX)
      .map((s) => String(s).trim().toUpperCase() as Severity);

    const rawCodes = Array.isArray(sample["gapCodes"]) ? sample["gapCodes"] : [];
    const codes = rawCodes.map(cleanGapCode).filter(Boolean).slice(0, SAMPLE_GAPS_MAX);

    const exposure = String(sample["dataExposure"] ?? "NONE").trim().toUpperCase();
    const dataExposure: DataExposure =
      exposure === "SENSITIVE" || exposure === "DATA_ACCESS" ? exposure : "NONE";

    const gaps = codes.map((c) => gap(c));
    const result = computeAars({ issueSeverities, gaps, dataExposure }, rule);
    return { ...result, gapBreakdown: gapBreakdown(gaps, rule) };
  });
}

export function rescoreAars(_p?: unknown): ApiResult {
  return mutate(() => ({ ...syncStore.rescoreInventory(), ...ruleState() }));
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
