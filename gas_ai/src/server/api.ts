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
  AARS_V2_RULE,
  AARS_V3_RULE,
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
  ruleDiscrimination,
  ruleSummary,
  shadowedGapRules,
  unreachableGapRules,
  validateAarsRule,
} from "../domain/aarsRule";
import {
  aarsTrendFromHistory,
  countAarsSeverities,
  ruleChangePoints,
  type AarsTrendPoint,
} from "../domain/aarsTrend";
import {
  countProblemOutcomes,
  OUTCOME_VALUES,
  type DecisionVector,
  type Outcome,
} from "../domain/problem";
import {
  cleanProblemRule,
  leafCoverage,
  MAX_OUTCOME_RULES,
  problemRuleSummary,
  shadowedOutcomeRules,
  treeDiscrimination,
  validateProblemRule,
} from "../domain/problemRule";
import { countPostureTiers, TIER_VALUES, type PostureVector, type Tier } from "../domain/posture";
import {
  cellCoverage,
  cleanPostureRule,
  MAX_TIER_RULES,
  postureDiscrimination,
  postureRuleSummary,
  shadowedTierRules,
  unreachableTierRules,
  validatePostureRule,
} from "../domain/postureRule";
import {
  AARS_SEVERITY_ORDER,
  isOpenGap,
  isUnresolvedIssue,
  MAX_NODES_CEILING,
  MAX_NODES_FLOOR,
  SEVERITY_COLORS,
  SEVERITY_GLYPHS,
  SEVERITY_ORDER,
  type Severity,
} from "../domain/config";
import {
  CONFIG_CLIENT_ALL_MAX,
  CONFIG_SORTS,
  DEFAULT_CONFIG_PAGE_SIZE,
  DEFAULT_CONFIG_SORT_DIR,
  MAX_CONFIG_PAGE_SIZE,
  configFacetCounts,
  configTotals,
  filterConfigRows,
  resolveConfigQuery,
  rollupByControl,
  sortConfigRows,
  toConfigView,
  type ConfigFindingView,
  type ConfigSort,
  type ConfigTotals,
  type ControlRollup,
} from "../domain/configFindings";
import {
  coverageSummary,
  frameworkRail,
  sharedControls,
  weakestAreas,
} from "../domain/complianceOverview";
import { scopeFiveRs, unselectedPolicyIds } from "../domain/complianceScope";
import { cleanFiveRsPins } from "../domain/settingsLogic";
import { buildAllFrameworkTrees, complianceKpis } from "../domain/compliancePosture";
import { graphCacheParams, resolveGraphParams, resolveLayoutParams } from "../domain/graphApiParams";
import { conditionHolds, conditionState } from "../domain/riskConditions";
import {
  cleanStepVars,
  isEditableStep,
  MAX_LIST_VALUES,
  MAX_VALUE_LEN,
  STEP_VAR_SPECS,
  validateStepVars,
} from "../domain/scanVars";
import { layoutGraph } from "../domain/graphLayout";
import { nodeOrder, projectGraph, type Projection } from "../domain/graphProject";
import {
  DEFAULT_QUERY,
  fieldValuesFor,
  fieldsForKind,
  type QueryKind,
  queryVocabulary,
  runQuery,
  validateQuery,
} from "../domain/graphQuery";
import {
  AI_ASSET_KINDS,
  NODE_KINDS,
  type FindingRow,
  type FrameworkPolicyRow,
  type GEdge,
  type GNode,
  type GraphDoc,
  type IssueRow,
  type NodeKind,
} from "../domain/graphTypes";
import { DATASTORE_KINDS } from "../domain/graphEnrich";
import { comboDigest } from "../domain/comboDigest";
import { comboGroupById, comboSummary, REGISTER_GROUPS } from "../domain/toxicCombos";
import { clampInt, nowIso, type Rec } from "../domain/util";
import { archiveBytes } from "./archiveStore";
import { activeJob } from "./jobsStore";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { buildInfo } from "./buildInfo";
import { hasWizCredentials, projectScope } from "./props";
import { cached, dataVersion, wizDataVersion } from "./serverCache";
import {
  AGENT_EXPANSION,
  decodeExpansion,
  flattenSlots,
  toGraphEntityQuery,
} from "../domain/graphExpand";
import { Q_AGENT_EXPANSION } from "./wizQueriesAi";
import * as wizClientAi from "./wizClientAi";
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
  return syncStore.loadIssues().filter(isUnresolvedIssue);
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
    // REGISTER_GROUPS: the graph can group by the Other bucket, so the legend has to be
    // able to name it — a group the canvas can draw but the legend can't label reads as
    // a rendering bug.
    comboLegend: REGISTER_GROUPS.map((g) => ({
      id: g.id,
      title: g.title,
      shortLabel: g.shortLabel,
      nativeSeverity: g.nativeSeverity,
      adjustedSeverity: g.adjustedSeverity,
      amplified: g.amplified,
      // The issue detail sheet needs this to render its seeded paint without a server
      // round trip; it's a compile-time constant on an already-cached payload, so
      // riding it on bootstrap costs no extra I/O.
      amplifierNote: g.amplifierNote,
    })),
    settings: {
      defaultDepth: settingsStore.getDefaultDepth(),
      maxNodes: settingsStore.getMaxNodes(),
      // The clamp bounds, so the graph's "Load more" and the Settings input can offer
      // exactly what the server will honor instead of hardcoding it twice.
      maxNodesFloor: MAX_NODES_FLOOR,
      maxNodesCeiling: MAX_NODES_CEILING,
      // Read by the asset sheet to decide whether to expand on open. It rides bootstrap
      // rather than its own call because the sheet needs it synchronously, before any RPC.
      autoExpand: settingsStore.getAutoExpand(),
    },
    // The band ranges every page's AARS copy is written from, so "score 70–100" is read
    // off the rule in force instead of being retyped wherever a level is named.
    aarsRule: {
      version: aarsRule.version,
      bands: aarsRule.rule.bands,
      bandRanges: bandRanges(aarsRule.rule.bands),
      // The three pillar ceilings, so the detail sheet's breakdown bars measure against
      // the rule in force instead of hardcoding the defaults and lying after an edit.
      // Pillar C's ceiling is now the rule's own explicit cap — it used to be re-derived
      // here from the exposure tier alone, which under a rule that prices data findings
      // would draw every bar against a ceiling the pillar can exceed.
      pillarCaps: {
        toxic: aarsRule.rule.pillarACap,
        compliance: aarsRule.rule.pillarBCap,
        data: aarsRule.rule.pillarCCap,
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

/**
 * The distinct human identities holding admin/high-privilege access to any AI asset.
 *
 * A set, not a sum: one operator with a binding on six agents is one person to talk to, and
 * summing the per-asset lists would report six.
 */
function distinctHumanIdentities(assets: GNode[]): Set<string> {
  const ids = new Set<string>();
  for (const a of assets) {
    for (const id of a.humanAccess?.identityIds ?? []) ids.add(id);
    for (const id of a.humanAccess?.effectiveIds ?? []) ids.add(id);
  }
  return ids;
}

/**
 * How many of the people who can reach an AI asset carry an open MFA or dormancy finding.
 *
 * Read from the identity-findings tab and intersected here rather than summed off the
 * per-asset counts, for the reason `distinctHumanIdentities` exists. The intersection is the
 * whole point: "how many people lack MFA" is an IAM question this app has no business
 * answering, and "how many of the people who can reach an AI agent lack MFA" is its own.
 */
function identityHygieneKpis(assets: GNode[]): Rec {
  const reachable = distinctHumanIdentities(assets);
  if (!reachable.size) return { humanNoMfa: 0, humanDormant: 0 };
  const noMfa = new Set<string>();
  // ONE SET, fed by BOTH routes to dormancy. Wiz reports it twice — as
  // `inactiveInLast90Days` on the identity and as the IAM-235 rule failing against it — and
  // `humanAccess` keeps those apart because they are different evidence. A COUNT must not:
  // adding them reports one dormant person as two, which is precisely what the dry run did
  // the first time this KPI was written.
  const dormant = new Set<string>();
  for (const id of reachable) {
    if (byIdIn(assets, id)?.inactive === true) dormant.add(id);
  }
  for (const finding of syncStore.loadIdentityFindings()) {
    if (!isOpenGap(finding)) continue;
    if (!reachable.has(finding.resourceId)) continue;
    (finding.hygiene === "MFA" ? noMfa : dormant).add(finding.resourceId);
  }
  return { humanNoMfa: noMfa.size, humanDormant: dormant.size };
}

/** One asset row by id. Linear, and called once per reachable identity — a handful. */
function byIdIn(assets: GNode[], id: string): GNode | undefined {
  for (const a of assets) if (a.id === id) return a;
  return undefined;
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

// ------------------------------------------------------------------ graph query

/**
 * The vocabulary the query builder is allowed to offer — kinds and relationships that exist in
 * THIS tenant's graph, not the whole enum.
 *
 * Its own endpoint rather than a field on `bootstrap`: the page prefetches both in parallel, so
 * it costs no extra round trip before first paint, and keeping it out of the bootstrap payload
 * keeps a small, hot, universally-fetched object small.
 */
export function getQueryVocabulary(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  // One kind's filter values, when asked for. The relationship vocabulary is small and rides
  // every page load; the value lists are not, and only ever one kind's worth is read at a time.
  // "ANY" is a real query kind — the wildcard root, and what every ANY-hops step lands on. It
  // is not in NODE_KINDS, so requiring membership left the palette's Properties tab
  // permanently empty for exactly the nodes a "focus in graph" link creates, while
  // `fieldsForKind("ANY")` had sixteen kind-agnostic fields the evaluator honours.
  const raw = params["kind"];
  const kind = typeof raw === "string" && (raw === "ANY" || (NODE_KINDS as readonly string[]).includes(raw))
    ? (raw as QueryKind)
    : null;
  return run(() =>
    cached("queryVocabulary", { kind }, () => {
      const doc = syncStore.loadGraphDoc();
      if (!doc) {
        return { empty: true, kinds: [], stepsFrom: {}, valuesFor: {}, fieldsFor: {}, shortcuts: [] };
      }
      const vocab = queryVocabulary(doc);
      if (!kind) return vocab;
      return {
        ...vocab,
        // ANY gets them too, over every node in the graph. `fieldsForKind("ANY")` already keeps
        // only the kind-agnostic fields, so the union is never one of things that cannot
        // co-occur — it is "which clouds does this estate use", which is the question.
        valuesFor: { [kind]: fieldValuesFor(doc, kind) },
        // What the palette's Properties tab lists, and the type that decides which control each
        // field gets. Per-kind for the same reason the value lists are.
        fieldsFor: {
          // Picked field by field rather than spread, so a getter never rides over the wire.
          // `multi` has to be here: it is what decides whether the filter editor offers "all of
          // these", and the client cannot recover it from a rendered string.
          [kind]: fieldsForKind(kind).map((f) => ({
            key: f.key, label: f.label, type: f.type, ...(f.multi ? { multi: true } : {}),
          })),
        },
      };
    }),
  );
}

/**
 * Run a path query and answer BOTH views from one payload.
 *
 * The table wants rows; the canvas wants a laid-out subgraph. Shipping them together is what
 * keeps the VIEW toggle instant — the page swaps which one it paints without a second round
 * trip, exactly as it did when both views read one `getGraph` payload. The row list is bounded
 * by QUERY_ROW_MAX and the canvas by the deployment's node budget, so neither half is
 * unbounded (`src/domain/assetTable.ts` sets the precedent).
 */
export function runGraphQuery(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const query = validateQuery(params["query"] ?? DEFAULT_QUERY);
    const columns = readColumnSelection(params["columns"]);
    const view = resolveLayoutParams(params);
    const maxNodes = clampInt(
      params["maxNodes"],
      settingsStore.getMaxNodes(),
      MAX_NODES_FLOOR,
      MAX_NODES_CEILING,
    );
    // The validated tree is the cache key, not the raw params: two spellings of the same query
    // (an absent `show: true`, a step order the builder rewrote) must not each buy their own
    // cache entry and their own Sheets read.
    return cached("graphQuery", { query, columns, view, maxNodes }, () => {
      const doc = syncStore.loadGraphDoc();
      if (!doc) return { empty: true };
      const result = runQuery(doc, query, { columns });
      const projection = inducedProjection(doc, result.nodeIds, result.edgeIds, maxNodes);
      return {
        rows: result.rows,
        groups: result.groups,
        total: result.total,
        capped: result.capped,
        truncated: result.truncated,
        nodes: projection.nodes,
        edges: projection.edges,
        summaries: projection.summaries,
        counts: projection.counts,
        layout: layoutGraph(projection, view),
        options: { maxNodes, layout: view.mode, groupBy: view.groupBy, sort: view.sort },
        syncedAt: doc.syncedAt,
      };
    });
  });
}

/** `columns[i]` is the field-key list for the i-th shown node, or null to take its defaults. */
function readColumnSelection(raw: unknown): Array<string[] | null> | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((entry) =>
    Array.isArray(entry) ? entry.map((k) => String(k)) : null);
}

/**
 * The matched paths as a drawable subgraph.
 *
 * `projectGraph` cannot do this job: it answers "what is within N hops of these seeds", and the
 * whole point of a query is that the answer is a specific set of paths rather than a
 * neighbourhood. So the projection is assembled directly — but in the SAME shape, so
 * `layoutGraph` takes it unchanged.
 *
 * Over budget, nodes are dropped worst-last by `nodeOrder` (the canvas's own ordering, so a
 * capped view keeps the interesting end) and any edge losing an endpoint goes with them. No
 * SUMMARY stubs: a "+N more" pill collapses a fan-out under one parent, and a truncated path
 * set has no parent to hang one off — the counts line says what was dropped instead.
 */
function inducedProjection(
  doc: GraphDoc,
  nodeIds: string[],
  edgeIds: string[],
  maxNodes: number,
): Projection {
  const wantNodes = new Set(nodeIds);
  const wantEdges = new Set(edgeIds);
  const all = doc.nodes.filter((n) => wantNodes.has(n.id)).sort(nodeOrder);
  const nodes = all.slice(0, maxNodes);
  const admitted = new Set(nodes.map((n) => n.id));
  const allEdges = doc.edges.filter((e) => wantEdges.has(e.id));
  const edges = allEdges.filter((e) => admitted.has(e.src) && admitted.has(e.dst));
  return {
    nodes,
    edges,
    summaries: [],
    counts: {
      totalNodes: all.length,
      shownNodes: nodes.length,
      totalEdges: allEdges.length,
      shownEdges: edges.length,
      capped: nodes.length < all.length,
    },
  };
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
    firstSeen: n.firstSeen ?? null,
    lastSeen: n.lastSeen ?? null,
    externalId: n.externalId ?? null,
    projects: (n.projects ?? []).map((p) => p.name),
    severity: n.severity ?? null,
    aars: n.aars ?? null,
    aarsSeverity: n.aarsSeverity ?? null,
    // Phase 6: the posture tier, BESIDE the AARS score above, never blended into it — see
    // posture.ts's own header for why a tier is not an aggregate of what has been found.
    postureTier: n.postureTier ?? null,
    postureInput: n.postureInput ?? null,
    worstOpenProblem: n.worstOpenProblem ?? null,
    comboGroups: n.comboGroups ?? [],
    internet: n.isAccessibleFromInternet ?? null,
    openInternet: n.isOpenToAllInternet ?? null,
    // ENDPOINT rows only; null everywhere else. The pair is the dynamic scanner's verdict,
    // and the detail sheet prints both because either alone is misleading — an open port
    // behind SSO rates Low and is not an exposure.
    exposureLevel: n.exposureLevel ?? null,
    portValidation: n.portValidation ?? null,
    // Null, not {}, when the exposure steps never reached this asset — the same "clean" vs
    // "never asked" split dataFindingCount keeps below.
    exposureEvidence: n.exposureEvidence ?? null,
    // Identity rows carry the first two; AI assets carry the third. Null, not false/{}, for
    // the "never reported" vs "reported clean" split the rest of this row keeps.
    inactive: n.inactive ?? null,
    inactiveTimeframe: n.inactiveTimeframe ?? null,
    humanAccess: n.humanAccess ?? null,
    sensitiveAccess: n.hasAccessToSensitiveData ?? false,
    sensitiveData: n.hasSensitiveData ?? false,
    highPriv: n.hasHighPrivileges ?? false,
    adminPriv: n.hasAdminPrivileges ?? false,
    guardrailMissing: n.guardrailMissing ?? false,
    // Null, not 0, when the sensitive-data traversal never reached this node: the graph
    // card and the insight row both key on truthiness, and a 0 would make "we never asked"
    // render exactly like "we looked and it is clean".
    dataFindingCount: n.dataFindingCount ?? null,
    dataFindingSeverities: n.dataFindingSeverities ?? null,
    // On the aggregate node only — the count it collapses.
    summaryCount: n.summaryCount ?? null,
    technologyCategories: n.technologyCategories ?? [],
    cloudAccount: n.cloudAccount?.name ?? null,
    // Full account object, for the detail sheet — cloudAccount above stays a bare
    // name string since existing client code already reads it as one.
    cloudAccountRef: n.cloudAccount ?? null,
    tags: n.tags ?? [],
    identityPurpose: n.identityPurpose ?? null,
    issueAnalytics: n.issueAnalytics ?? null,
    // Full project objects, for the detail sheet — projects above stays name-only.
    projectRefs: (n.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      businessImpact: p.businessImpact,
    })),
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
    // Phase 6: BESIDE aars — the two must be visibly independent columns, never merged.
    postureTier: n.postureTier ?? null,
    worstOpenProblem: n.worstOpenProblem ?? null,
    combos: (n.comboGroups ?? []).length,
    guardrailMissing: n.guardrailMissing ?? false,
    agentic: n.identityPurpose === "AGENTIC",
    // How many classified findings this asset can REACH — its own if it is a datastore,
    // whatever its execution identity can read if it is an agent.
    //
    // Two sources because the reach walk is persisted through `aarsInput`, which only
    // scored nodes carry: a BUCKET is never scored (AARS covers AI assets), so a store
    // holding three findings would otherwise report 0 in the register while the graph drew
    // them. Identities fall in the same gap and stay uncovered here — service accounts are
    // unscored for reasons that predate this chain, so nothing persists their reach.
    dataFindings: (n.aarsInput?.dataFindings ?? []).reduce((sum, f) => sum + f.count, 0)
      || (n.dataFindingCount ?? 0),
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
  // The two compliance numbers, computed together so they cannot drift.
  //
  // `complianceGaps` used to be `loadFindings().length` — every stored row, including the
  // ones that price nothing. It now counts failing controls (isOpenGap), which is what the
  // label always claimed, and which the widened filter makes necessary: RESOLVED rows are
  // collected now and would otherwise inflate it.
  //
  // `complianceGapsUnlinked` is the part of that total no asset carries. A configuration
  // finding is keyed to the resource it was evaluated against, and most AI-security rules
  // fail on things the AI graph does not model — a REGION for a Vertex metadata store, a
  // RAW_ACCESS_POLICY for a Bedrock IAM policy, a service account no agent runs as.
  // buildAarsHintsFromFindings skips those (no node to hang a gap on), so before this they
  // were counted in the KPI and priced into nothing. Reporting the split says so out loud
  // rather than letting one number imply every finding reached a score.
  const assetIds: Record<string, true> = {};
  for (const a of assets) assetIds[a.id] = true;
  const openGaps = syncStore.loadFindings().filter(isOpenGap);
  const unlinkedGaps = openGaps.filter((f) => !assetIds[f.resourceId]).length;
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
      // The DSPM pair. Every datastore in TABS.assets arrived on a path from an AI agent —
      // INVENTORY_AI filters to AI resource types, so a bucket can only have been returned
      // by the sensitive-data traversal — which is what makes this an honest reachability
      // count without reading edges, something loadAssets (a tab-direct read model) cannot
      // do. The dry run seeds datastores directly, so the invariant is a live-tenant one.
      sensitiveDatastores: assets.filter(
        (a) => DATASTORE_KINDS.includes(a.kind) && a.hasSensitiveData,
      ).length,
      dataFindings: assets.reduce((sum, a) => sum + (a.dataFindingCount ?? 0), 0),
      openIssues: issues.length,
      complianceGaps: openGaps.length,
      complianceGapsUnlinked: unlinkedGaps,
      // Framework POSTURE, which is a different axis from the two counts above: those
      // count failing controls, this scores frameworks. Null — never 0 — when no posture
      // has been synced, so the Wiz Scans area degrades to `partial` on its own instead of
      // reporting a confident zero for a question this tenant was never asked.
      // Scoped the same way the Compliance page scopes it. Not an optimisation — the two
      // pages would otherwise report different failing-control totals for one estate, and
      // this KPI is the number the Wiz Scans coverage area prints beside the other one.
      frameworkPosture: complianceKpis(
        syncStore.loadPosture(),
        scopedFrameworkPolicies().policies,
      ),
      agenticIdentities: assets.filter((a) => a.identityPurpose === "AGENTIC").length,
      // Estate-wide counts for the two risk conditions that had no total. The flags were
      // persisted and drawn on the graph, but `assetTableRow` strips them, so nothing
      // could say how much of the estate they cover. `internetUnknown` is its own number
      // on purpose: a hosted agent inherits exposure from its host and Wiz reports that
      // as undetermined, so folding it into "not exposed" under-reports.
      internetExposed: assets.filter((a) => conditionState(a, "INTERNET_EXPOSURE") === true).length,
      internetUnknown: assets.filter((a) => conditionState(a, "INTERNET_EXPOSURE") === null).length,
      // The two grades of evidence behind `internetExposed`, reported separately because
      // they are separate claims. `internetValidated` counts assets serving an endpoint Wiz's
      // scanner connected to and policy rates High or Medium; `internetViaHost` counts those
      // whose reachability was established one hop away, on the compute they run on. An
      // asset can be in both, and one in neither is exposed by its own two flags.
      internetValidated: assets.filter((a) => (a.exposureEvidence?.endpointIds ?? []).length > 0)
        .length,
      internetViaHost: assets.filter((a) => (a.exposureEvidence?.hostIds ?? []).length > 0).length,
      // Human identity access. The Wiz Scans page declared this area partial because "nothing
      // totals them"; these are the totals, counted off the persisted join rather than off the
      // graph stubs, which are deliberately suppressed where a real CIEM finding exists.
      //
      // The unit is deliberately narrow and the page says so: the traversal only ever returns
      // ADMIN and HIGH_PRIVILEGE bindings, so this is not "assets a person can reach" — it is
      // "assets a person can reach with rights worth naming".
      humanReachable: assets.filter((a) => (a.humanAccess?.identityIds ?? []).length > 0).length,
      humanReachableAdmin: assets.filter((a) => a.humanAccess?.admin === true).length,
      // Distinct identities across every asset, so one operator with access to six agents
      // counts once. `humanDormant` is the join worth having: a dormant account holding admin
      // rights on an AI asset is a low-noise backdoor, and it is the reason the identity
      // properties are collected at all.
      humanIdentities: distinctHumanIdentities(assets).size,
      // Effective access: people Wiz says can actually reach an AI asset's DATA, as opposed
      // to people holding a role that grants access. Counted separately and never added to
      // `humanIdentities` — see the note on humanAccess.effectiveIds.
      humanEffective: assets.filter((a) => (a.humanAccess?.effectiveIds ?? []).length > 0).length,
      // Hygiene, counted over the DISTINCT identities rather than summed from the per-asset
      // counts. One person with bindings on six agents is one person whose MFA is missing;
      // summing `noMfaCount` across assets would report six.
      ...identityHygieneKpis(assets),
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
      // Failing controls only. The tab now also holds resolved and passing rows for the
      // lifecycle clock, and the drill-down's Compliance pane counts what is wrong with
      // this asset — a fixed control listed there reads as an outstanding gap.
      //
      // Projected, not passed through. A FindingRow now carries the rule's description,
      // its remediation template and its full Rego policy, none of which this pane
      // renders; shipping them would put several kilobytes per finding on the wire for a
      // list that shows a severity, a rule id and one line of fix text. The finding sheet
      // fetches the whole record when someone actually opens one.
      const findings = syncStore
        .loadFindings()
        .filter((f) => f.resourceId === id && isOpenGap(f))
        .map((f) => ({
          id: f.id,
          resourceId: f.resourceId,
          ruleShortId: f.ruleShortId,
          ruleName: f.ruleName ?? null,
          name: f.name ?? null,
          severity: f.severity,
          remediation: f.remediation ?? null,
          frameworkCodes: f.frameworkCodes,
        }));
      return {
        node: {
          ...assetRow(node),
          aarsPillars: node.aarsPillars ?? null,
          aarsInput: node.aarsInput ?? null,
        },
        issues,
        neighbors,
        findings,
      };
    });
  });
}

// ------------------------------------------------------------ cloud configuration register

/**
 * Every stored configuration finding as a register row, plus the rollups. Cached per data
 * version like assetsModel, because the linkage join (does this finding's resource exist
 * in the inventory?) reads the whole assets tab and must not run per keystroke.
 *
 * The totals are computed over the WHOLE set on purpose — the header describes the
 * estate, never the page or the filtered subset, the same contract the inventory keeps.
 */
/**
 * The synced AI assets, as an id set — "did this finding land on something the AI graph
 * models". `loadAssets` is memoized, so calling this more than once per execution costs a
 * map build and nothing else.
 */
function aiAssetIdSet(): Record<string, true> {
  const ids: Record<string, true> = {};
  for (const a of syncStore.loadAssets()) ids[a.id] = true;
  return ids;
}

/**
 * The framework policy rows this app looks at, with the 5Rs scoped to its AI-relevant
 * rules — and the scope itself, so a caller can explain the filter it just applied.
 *
 * ONE definition, called from both readers. `getCompliance` and `getAssets` each count
 * failing controls off these rows, and a filter applied to one and not the other is not a
 * cosmetic difference: the Compliance page and the Wiz Scans coverage area would print
 * different totals for the same estate, which is exactly the "two answers to one question"
 * failure this codebase spends its comments avoiding.
 *
 * The scope has to be derived from the FULL tree before it can be applied to a filtered
 * one — a 5Rs rule is in scope partly because some OTHER framework maps it, so the trees
 * must exist before the question can be asked. Hence a build to decide and a build to
 * render. The payload is bounded by the framework rather than the estate, so that is cheap.
 */
function scopedFrameworkPolicies(): {
  policies: FrameworkPolicyRow[];
  scope: ReturnType<typeof scopeFiveRs>;
} {
  const posture = syncStore.loadPosture();
  const allPolicies = syncStore.loadFrameworkPolicies();
  const catalogue = syncStore.loadFrameworks();

  const scope = scopeFiveRs(
    buildAllFrameworkTrees(posture, allPolicies, catalogue),
    syncStore.loadFindings(),
    aiAssetIdSet(),
    settingsStore.getFiveRsPins(),
  );

  // Dropped from the 5Rs FRAMEWORK's rows only, never globally by policy id. A rule can be
  // mapped by the 5Rs and by OWASP Agentic at once — that is what the cross-mapping signal
  // is built on — and an operator who pins such a rule out is saying "not under the
  // data-security framework", not "not anywhere". Filtering on the id alone would delete it
  // from the AI framework that legitimately claims it, and the shared-controls band would
  // lose the very crosswalk it exists to show.
  const dropped = new Set(unselectedPolicyIds(scope));
  const policies = dropped.size
    ? allPolicies.filter(
      (pol) => pol.frameworkId !== scope.frameworkId || !dropped.has(pol.policyId),
    )
    : allPolicies;

  return { policies, scope };
}

function configModel(): {
  rows: ConfigFindingView[];
  totals: ConfigTotals;
  facets: Record<string, string[]>;
} {
  const assetIds = aiAssetIdSet();
  const rows = syncStore
    .loadFindings()
    .map((f) => toConfigView(f, !!assetIds[f.resourceId]));

  const severities = new Set<string>();
  const statuses = new Set<string>();
  const clouds = new Set<string>();
  const resourceTypes = new Set<string>();
  const rules = new Set<string>();
  const projects = new Set<string>();
  for (const r of rows) {
    if (r.severity) severities.add(r.severity);
    if (r.status) statuses.add(r.status);
    if (r.cloud) clouds.add(r.cloud);
    if (r.resourceType) resourceTypes.add(r.resourceType);
    if (r.ruleShortId) rules.add(r.ruleShortId);
    for (const p of r.projects) projects.add(p);
  }

  return {
    rows: sortConfigRows(rows, "severity"),
    totals: configTotals(rows),
    facets: {
      severities: SEVERITY_ORDER.filter((s) => severities.has(s)),
      statuses: [...statuses].sort(),
      clouds: [...clouds].sort(),
      resourceTypes: [...resourceTypes].sort(),
      rules: [...rules].sort(),
      projects: [...projects].sort(),
    },
  };
}

/**
 * The Cloud Configuration register. Same two-mode shape as getAssets: under
 * CONFIG_CLIENT_ALL_MAX the browser gets every row and filters locally, over it the
 * filtering, sorting and paging happen here. Either way the header, the control rollup
 * and the facet vocabulary describe the whole register.
 */
export function getConfigFindings(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const query = resolveConfigQuery(params);
    const sort = (CONFIG_SORTS as string[]).indexOf(String(params["sort"] ?? "")) >= 0
      ? (String(params["sort"]) as ConfigSort)
      : "severity";
    const dir = String(params["dir"] ?? "") === "asc"
      ? "asc"
      : String(params["dir"] ?? "") === "desc"
        ? "desc"
        : DEFAULT_CONFIG_SORT_DIR[sort];
    const pageSize = Math.min(
      MAX_CONFIG_PAGE_SIZE,
      Math.max(1, Number(params["pageSize"]) || DEFAULT_CONFIG_PAGE_SIZE),
    );
    const page = Math.max(0, Number(params["page"]) || 0);

    const model = cached("configModel", null, configModel) as ReturnType<typeof configModel>;
    const head = {
      total: model.rows.length,
      totals: model.totals,
      facets: model.facets,
      pageSize,
      sort,
      dir,
    };

    // The all path deliberately ships NO control rollup. Filtering happens in the browser
    // there, and a rollup regroups under every filter change — a server-computed one would
    // describe the unfiltered register while the table below it showed a filtered one.
    // The client rebuilds it from the rows it actually holds.
    if (model.rows.length <= CONFIG_CLIENT_ALL_MAX) {
      return {
        ...head,
        all: true,
        rows: model.rows,
        filtered: model.rows.length,
        page: 0,
        pageCount: Math.max(1, Math.ceil(model.rows.length / pageSize)),
      };
    }

    // Past the ceiling the browser never holds the whole register, so the rollup has to be
    // computed here — over the FILTERED rows, so it still describes the table below it.
    const filtered = sortConfigRows(filterConfigRows(model.rows, query), sort, dir);
    const paged = pageOf(filtered as unknown as Rec[], page, pageSize);
    return {
      ...head,
      all: false,
      controls: rollupByControl(filtered),
      rows: paged.rows,
      filtered: filtered.length,
      page: paged.page,
      pageCount: paged.pageCount,
      facetCounts: configFacetCounts(model.rows, query),
    };
  });
}

/**
 * One finding, whole. The register row deliberately omits the rule description, the
 * remediation text and the Rego policy — they repeat verbatim across every finding of the
 * same rule, so shipping them per row would put the same multi-kilobyte document on the
 * wire once per failing resource. The drill-down asks for them one at a time instead.
 */
export function getConfigFindingDetail(p?: unknown): ApiResult {
  return run(() => {
    const id = String(((p ?? {}) as Rec)["id"] ?? "");
    return cached("getConfigFindingDetail", { id }, () => {
      const finding = syncStore.loadFindings().filter((f) => f.id === id)[0];
      if (!finding) return null;
      const asset = syncStore.loadAssets().filter((a) => a.id === finding.resourceId)[0];
      return {
        finding,
        gap: isOpenGap(finding),
        // The asset the finding is keyed to, when the inventory holds it. Null is the
        // common case and is not an error: most AI-security rules fail on a region, an
        // IAM policy or an identity no agent runs as.
        asset: asset ? assetRow(asset) : null,
      };
    });
  });
}

/**
 * The Compliance page: every synced framework as a tree, plus the catalogue for the
 * Settings picker.
 *
 * Shipped whole rather than paged. The payload is bounded by the FRAMEWORK, not by the
 * estate — ten categories of ten subcategories is the shape of a published Top-10 list,
 * not of a tenant — so the row count cannot run away the way the inventory's or the
 * configuration register's can, and the two-mode all/paged machinery those need would be
 * complexity bought for nothing here.
 */
export function getCompliance(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const requested = String(params["frameworkId"] ?? "");
    return cached("getCompliance", { frameworkId: requested }, () => {
      const posture = syncStore.loadPosture();
      const catalogue = syncStore.loadFrameworks();
      const selected = settingsStore.getSelectedFrameworks(() => catalogue);
      const { policies, scope: fiveRsScope } = scopedFrameworkPolicies();
      const trees = buildAllFrameworkTrees(posture, policies, catalogue);
      // The catalogue with this app's selection folded in — Wiz says what exists, the
      // settings say what is collected, and the picker needs both to render honestly.
      // Built once and shared: `coverageSummary` reads `selected` off these rows, and the
      // raw catalogue does not carry it (FrameworkRow.selected is resolved from settings,
      // never from Wiz), so passing the unmerged array would silently report every
      // framework as uncollected.
      const merged = catalogue.map((f) => ({ ...f, selected: selected.indexOf(f.id) >= 0 }));
      return {
        trees,
        kpis: complianceKpis(posture, policies),
        catalogue: merged,
        selected,
        // The Overview's four bands. Computed here rather than in the browser because the
        // client bundle cannot import the domain layer at all — every client-side copy of
        // domain logic in this app is a hand-kept mirror with a test holding the two
        // together (assetQuery.js, configView.js), and that machinery exists to reconcile
        // a client filtering a PAGE against a server filtering the WHOLE set. This payload
        // is already shipped whole and cached, so there is no second scope to reconcile —
        // a mirror here would be duplicated risk buying nothing.
        rail: frameworkRail(trees),
        weakestAreas: weakestAreas(trees),
        sharedControls: sharedControls(trees),
        // Every rule the 5Rs maps, in or out, with the reason. Shipped whole rather than
        // as a count because the Settings card is the place an operator overturns a
        // derivation, and it cannot argue with a verdict it cannot see.
        fiveRsScope,
        coverage: coverageSummary(trees, merged),
        // Named so the page can open on a framework it was linked to rather than guessing.
        // Null when the requested id has no stored posture, which the page reports as such
        // instead of silently falling back to a different framework's numbers.
        requested: requested && trees.some((t) => t.frameworkId === requested)
          ? requested
          : null,
      };
    });
  });
}

/** Save which frameworks the sync collects posture for. */
export function setSelectedFrameworks(p?: unknown): ApiResult {
  return run(() => {
    const ids = ((p ?? {}) as Rec)["ids"];
    return { selected: settingsStore.setSelectedFrameworks(ids) };
  });
}

/**
 * Caps on what one expansion may return. The traversal has 43 slots and the transport
 * asks for 100 rows, so a densely connected agent could in principle put several thousand
 * entity references on the wire; no endpoint here ships an unbounded list.
 */
const EXPAND_MAX_NODES = 200;
const EXPAND_MAX_EDGES = 400;

/**
 * Live per-agent neighbourhood, straight from Wiz, for the detail sheet's Connections card.
 *
 * getAssetDetail's `neighbors` is a one-hop scan of the LAST SYNC's snapshot — it can only
 * show what the sync battery's five fixed traversals happened to collect. This asks the
 * tenant about one agent right now, across all ten relationship subtrees the console
 * expands, which is where guardrails, endpoints, MCP servers and agent-to-agent INVOKES
 * chains actually come from.
 *
 * Presentation-only by design. Nothing here is persisted, no AARS pillar moves, and
 * NODE_KINDS is untouched — a kind the model does not declare keeps its raw Wiz type and
 * is flagged `unmodeled` so the card can render it honestly rather than drop it.
 *
 * Without credentials it reports `source: "stored"` and returns nothing, leaving the sheet
 * on its existing stored neighbours: dry-run has to stay fully usable.
 */
export function expandAsset(p?: unknown): ApiResult {
  return run(() => {
    const id = String(((p ?? {}) as Rec)["id"] ?? "");
    if (!id) return null;
    const empty = { nodes: [], edges: [], arityMismatches: 0, truncated: false };
    // Kind before credentials, deliberately. AGENT_EXPANSION is rooted at type AI_AGENT,
    // so pinning _vertexID to anything else asks a question that cannot match: zero rows,
    // one UrlFetchApp call spent, and a caller who would reasonably read the empty result
    // as "nothing new out there". That is true whether or not credentials exist, so it is
    // the more accurate answer of the two. The client hides the affordance for non-agents
    // as well; this is the guard that holds when the client is stale, wrong, or bypassed.
    // An id absent from the last sync still proceeds — it may exist in Wiz but postdate
    // the snapshot, and refusing it would make a new agent permanently unexpandable.
    const doc = syncStore.loadGraphDoc();
    const node = doc ? doc.nodes.filter((n) => n.id === id)[0] : undefined;
    if (node && node.kind !== "AI_AGENT") return { source: "unsupported", ...empty };
    if (!hasWizCredentials()) return { source: "stored", ...empty };
    // Cached: reopening the same sheet must not spend another UrlFetchApp call.
    //
    // Keyed on the WIZ data version, not DATA_VERSION. The two differ in exactly the case
    // that matters: settingsStore.saveSettings bumps DATA_VERSION, so saving an AARS rule,
    // a depth default, a node budget or a scan-var override used to throw away every cached
    // expansion in the tenant. A Wiz graph response does not go stale because a local band
    // threshold moved, and each one thrown away costs a live call the next time someone
    // opens that agent. A sync, a rescore and a reset all still invalidate it.
    //
    // `projectId` is in the KEY as well as in the query. It is a live input read from a
    // Script Property, so an operator narrowing the project scope has to reach the cache —
    // otherwise the tenant-wide answer keeps being served for a scope that no longer asks
    // for it.
    const projectId = projectScope()?.[0] ?? null;
    return cached("expandAsset", { id, projectId }, () => {
      const slots = flattenSlots(AGENT_EXPANSION);
      const page = wizClientAi.fetchGraphSearchPage({
        query: Q_AGENT_EXPANSION,
        extraVariables: {
          query: toGraphEntityQuery(AGENT_EXPANSION, id),
          projectId,
        },
      });
      const decoded = decodeExpansion(slots, page.rows);
      const nodes = decoded.nodes.slice(0, EXPAND_MAX_NODES);
      const keep = new Set(nodes.map((n) => n.id));
      const edges = decoded.edges
        .filter((e) => keep.has(e.src) && keep.has(e.dst))
        .slice(0, EXPAND_MAX_EDGES);
      return {
        source: "live",
        fetchedAt: nowIso(),
        rootId: id,
        nodes,
        edges,
        // Surfaced, not swallowed. A non-zero count means the tenant returned an entity
        // array of a different length than the spec's slot list, so those rows were
        // refused rather than decoded onto the wrong nodes — the operator needs to know.
        arityMismatches: decoded.arityMismatches,
        truncated:
          decoded.nodes.length > nodes.length ||
          decoded.edges.length > edges.length ||
          page.hasNextPage,
      };
    }, undefined, wizDataVersion());
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
      const digest = comboDigest(issues, assetRows, new Date().toISOString());
      const digestById = new Map(digest.groups.map((g) => [g.id, g]));
      return {
        // Every count the page renders, computed once here rather than four times in the
        // browser. Additive: the `groups` shape below is unchanged, so a payload cached
        // before this shipped still renders the page (minus the summary sections).
        digest,
        groups: comboSummary(issues).map((s) => ({
          id: s.group.id,
          ruleId: s.group.ruleId,
          title: s.group.title,
          shortLabel: s.group.shortLabel,
          nativeSeverity: s.group.nativeSeverity,
          adjustedSeverity: s.group.adjustedSeverity,
          amplifierNote: s.group.amplifierNote,
          // Whether this group re-rates its issues. The card renders the shift badge and
          // the amplifier note together off this flag, so the note can never go missing
          // from beside an adjusted severity — and the Other bucket, which makes no such
          // claim, renders neither.
          amplified: s.group.amplified,
          // The declared half of the condition matrix. It rides on the group rather than
          // only on the digest so the card's condition strip still says what the rule
          // tests when an older cached payload arrives with no digest attached.
          conditions: s.group.conditions,
          frameworks: s.group.frameworks,
          // The measured severity mix, mirrored onto the group so the page's severity
          // filter can ask what a card actually HOLDS. Filtering on the declared
          // adjustedSeverity alone hides the Other bucket — whose declared severity is
          // the worst it holds, not the only one — while it still holds matching rows.
          adjustedMix: digestById.get(s.group.id)?.adjustedMix ?? {},
          nativeMix: digestById.get(s.group.id)?.nativeMix ?? {},
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

// --------------------------------------------------------------------- scan queries

/**
 * Every sync step as data: the document it sends, the variables it sends, where the answer
 * lands, whether the last sync skipped it, and which of its variables can be edited.
 *
 * Not cached. The whole point is that it describes the battery as configured right now, and
 * a stale answer here is a lie about what the tenant is being asked.
 */
export function getScanQueries(_p?: unknown): ApiResult {
  return run(() => ({
    steps: syncJobs.describeSyncSteps(),
    specs: STEP_VAR_SPECS,
    skippedSteps: settingsStore.getSkippedSteps(),
    // Reported separately from the skips: these steps ran and were answered, we just
    // stopped asking at the page cap, so their rows are a prefix rather than an absence.
    truncatedSteps: settingsStore.getTruncatedSteps(),
    hasCredentials: hasWizCredentials(),
    limits: { maxListValues: MAX_LIST_VALUES, maxValueLen: MAX_VALUE_LEN },
    // Named rather than folded into `variables`: the transport adds these to every request,
    // so showing them as if they were configuration would invite someone to edit them.
    transportVariables: ["first", "after", "quick"],
  }));
}

export function setScanVars(p?: unknown): ApiResult {
  return mutate(() => {
    const params = (p ?? {}) as Rec;
    const stepId = String(params["stepId"] ?? "");
    if (!isEditableStep(stepId)) {
      throw new Error(`${stepId || "That step"} does not take editable variables.`);
    }
    const proposed = cleanStepVars(stepId, params["vars"]);
    const errors = validateStepVars(stepId, proposed);
    if (errors.length) throw new Error(errors.join(" "));
    settingsStore.setScanVars(stepId, proposed);
    return { steps: syncJobs.describeSyncSteps() };
  });
}

/**
 * Send one page with the proposed variables and report what came back — without persisting
 * anything, and without touching the ledger.
 *
 * This exists because the failure mode it catches is silent: optional steps swallow an
 * HTTP 400, so a filter Wiz rejects looks exactly like a tenant with nothing to report. A
 * test that returns the row count AND what the step's own normalizer made of those rows is
 * the difference between "this works" and "this returns 100 rows the normalizer discards".
 */
export function testScanVars(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const stepId = String(params["stepId"] ?? "");
    if (!isEditableStep(stepId)) {
      throw new Error(`${stepId || "That step"} does not take editable variables.`);
    }
    const proposed = cleanStepVars(stepId, params["vars"]);
    const errors = validateStepVars(stepId, proposed);
    if (errors.length) throw new Error(errors.join(" "));
    if (!hasWizCredentials()) {
      throw new Error(
        "A test run calls Wiz, and no credentials are configured — this deployment is in " +
        "dry-run. Add credentials in Settings to test a filter against the tenant.",
      );
    }
    return syncJobs.testStepVariables(stepId, proposed);
  });
}

// ------------------------------------------------------------------------- settings

export function getSettings(_p?: unknown): ApiResult {
  return run(() => ({
    defaultDepth: settingsStore.getDefaultDepth(),
    maxNodes: settingsStore.getMaxNodes(),
    maxNodesFloor: MAX_NODES_FLOOR,
    maxNodesCeiling: MAX_NODES_CEILING,
    autoExpand: settingsStore.getAutoExpand(),
    hasCredentials: hasWizCredentials(),
    // The operator's overrides on the 5Rs scope. Only the pins: the derived default is
    // computed in getCompliance, where the trees and findings it needs already are.
    fiveRsPins: settingsStore.getFiveRsPins(),
  }));
}

export function setSettings(p?: unknown): ApiResult {
  return mutate(() => {
    const params = (p ?? {}) as Rec;
    if (params["defaultDepth"] !== undefined) {
      settingsStore.setDefaultDepth(params["defaultDepth"]);
    }
    if (params["maxNodes"] !== undefined) settingsStore.setMaxNodes(params["maxNodes"]);
    // `!== undefined`, not truthiness: `false` is a value the caller must be able to send,
    // and `if (params["autoExpand"])` would make the flag impossible to turn off.
    if (params["autoExpand"] !== undefined) settingsStore.setAutoExpand(params["autoExpand"]);
    // Cleaned against the policies actually synced, so a pin on a rule the tenant no longer
    // carries is dropped rather than accumulating forever in a settings row nothing reads.
    if (params["fiveRsPins"] !== undefined) {
      settingsStore.setFiveRsPins(
        cleanFiveRsPins(
          params["fiveRsPins"],
          syncStore.loadFrameworkPolicies().map((pol) => pol.policyId),
        ),
      );
    }
    return {
      defaultDepth: settingsStore.getDefaultDepth(),
      maxNodes: settingsStore.getMaxNodes(),
      // Echoed so the Settings page's paint({ ...s, ...fresh }) repaints the STORED value
      // rather than the one it asked for.
      autoExpand: settingsStore.getAutoExpand(),
      fiveRsPins: settingsStore.getFiveRsPins(),
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
    // Whole rules the page can load into the draft. `defaults` above is the spec model and
    // stays where it is (Reset reads it); presets are alternatives, not a fallback.
    presets: { v2: AARS_V2_RULE, v3: AARS_V3_RULE },
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
      // A THIRD state, distinct from both shadowed and unexercised: the row names a code
      // no derivation can raise, so it cannot fire in any tenant, not just this one.
      unreachableGapRules: unreachableGapRules(proposed),
      // How well the draft separates the estate — the number the band counts above cannot
      // show, because a rule that gives every asset the same score still fills a band.
      discrimination: ruleDiscrimination(after, proposed),
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

// ------------------------------------------------------------------------ problem rule
//
// The Phase 3/4 decision tree (domain/problem.ts, domain/problemRule.ts) exposed: same
// four endpoints as the AARS rule above, same shapes, mirrored rather than shared because
// the two models diverge in exactly the ways aarsRule.ts's and problemRule.ts's own header
// comments explain (a continuous score vs. a 4-outcome tree; `stale` compares against a
// DECIDED version, not a scored one).

/**
 * The same {version, rule, decidedVersion, stale, summary, leafCoverage, validation,
 * shadowed} shape ruleState() assembles for AARS, mirrored onto the tree. getProblemRule
 * and setProblemRule share it so the two can never disagree about what "the current state"
 * means — the same reason ruleState() itself is factored out rather than duplicated.
 */
function problemRuleState(): Rec {
  const stored = settingsStore.getProblemRule();
  const decidedVersion = settingsStore.getDecidedRuleVersion();
  return {
    version: stored.version,
    rule: stored.rule,
    decidedVersion,
    // Only outcomeRules / fallbackOutcome / the derivation knobs can strand a persisted
    // verdict (decisionEqual, problemRule.ts) — setProblemRule's own no-op guard already
    // moves decidedVersion forward across an edit that cannot have changed one.
    stale: decidedVersion !== stored.version,
    summary: problemRuleSummary(stored.rule),
    leafCoverage: leafCoverage(stored.rule),
    validation: validateProblemRule(stored.rule),
    shadowed: shadowedOutcomeRules(stored.rule),
    limits: { maxOutcomeRules: MAX_OUTCOME_RULES },
  };
}

export function getProblemRule(_p?: unknown): ApiResult {
  return run(() => problemRuleState());
}

export function setProblemRule(p?: unknown): ApiResult {
  return mutate(() => {
    const params = (p ?? {}) as Rec;
    const proposed = cleanProblemRule(params["rule"]);
    const errors = validateProblemRule(proposed);
    if (errors.length) throw new Error(errors.join(" "));
    settingsStore.setProblemRule(proposed);
    return problemRuleState();
  });
}

/** An issue row, narrowed from the union `previewProblemRule` walks — see `isIssueRow`. */
function isIssueRow(row: IssueRow | FindingRow): row is IssueRow {
  return "assetId" in row;
}

/**
 * The decided population `treeDiscrimination` wants: outcome + vector + unknowns, read off
 * whichever rows a preview actually reached a verdict on. A row `decideProblemsWith`
 * stripped (no longer eligible) or never decided carries no `problemInput` and is skipped —
 * the same "decided, not merely present" filter `countProblemOutcomes` applies via
 * `OUTCOME_VALUES`, applied here to the richer shape treeDiscrimination needs.
 */
function decidedForDiscrimination(
  rows: ReadonlyArray<IssueRow | FindingRow>,
): Array<{ outcome: Outcome; vector: DecisionVector; unknowns: string[] }> {
  const out: Array<{ outcome: Outcome; vector: DecisionVector; unknowns: string[] }> = [];
  for (const row of rows) {
    const outcome = row.problemOutcome;
    const input = row.problemInput;
    if (!outcome || !input || !(OUTCOME_VALUES as readonly string[]).includes(outcome)) continue;
    out.push({ outcome: outcome as Outcome, vector: input.vector, unknowns: input.unknowns });
  }
  return out;
}

/**
 * What saving this rule would do to every open issue and failing finding as they read
 * right now — previewAarsRule's counterpart, built the same way: `syncStore
 * .decideProblemsWith(draft)` costs ZERO Wiz calls (every axis reading is either already
 * persisted in `problemInput` or cheap to re-derive from the tabs), and the result is
 * diffed against what the register shows today.
 *
 * `treeDiscrimination`'s per-axis unknown rates are the reason this endpoint exists: they
 * are how an operator discovers that, say, `validatedAsExploitable` is unpopulated on
 * their tenant — the finding the whole SSVC-shaped model hinges on, and the one thing this
 * payload must never let get buried under the outcome counts. See problemRule.ts's own
 * header for why `treeDiscrimination` measures unknown rates and leaves reached rather than
 * porting `ruleDiscrimination`'s tie-rate machinery.
 */
export function previewProblemRule(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const proposed = cleanProblemRule(params["rule"]);
    const errors = validateProblemRule(proposed);
    if (errors.length) throw new Error(errors.join(" "));

    const beforeAll: Array<IssueRow | FindingRow> = [...syncStore.loadIssues(), ...syncStore.loadFindings()];
    const beforeById = new Map(beforeAll.map((r) => [r.id, r.problemOutcome]));

    const after = syncStore.decideProblemsWith(proposed);
    const afterAll: Array<IssueRow | FindingRow> = [...after.issues, ...after.findings];

    const rank = (o: string | undefined): number => {
      const i = o ? (OUTCOME_VALUES as readonly string[]).indexOf(o) : -1;
      return i < 0 ? OUTCOME_VALUES.length : i;
    };

    const movers: Rec[] = [];
    for (const row of afterAll) {
      const fromOutcome = beforeById.get(row.id) ?? null;
      const toOutcome = row.problemOutcome ?? null;
      if (fromOutcome === toOutcome) continue;
      movers.push({
        id: row.id,
        kind: isIssueRow(row) ? "issue" : "finding",
        ruleName: isIssueRow(row) ? row.ruleName : (row.ruleName ?? row.ruleShortId ?? ""),
        assetName: isIssueRow(row) ? row.assetName : (row.resourceName ?? row.resourceId),
        fromOutcome,
        toOutcome,
      });
    }
    // Worst proposed outcome first — the queue an operator would actually triage — then id
    // for a stable order across an otherwise-tied pair.
    movers.sort((a, b) => {
      const r = rank(a["toOutcome"] as string | undefined) - rank(b["toOutcome"] as string | undefined);
      return r !== 0 ? r : String(a["id"]).localeCompare(String(b["id"]));
    });

    return {
      total: afterAll.length,
      current: countProblemOutcomes(beforeAll),
      proposed: countProblemOutcomes(afterAll),
      // The proposed rule read back in prose, and the rows that can never be a first match —
      // both describe the DRAFT, so they travel with the preview rather than the saved state.
      summary: problemRuleSummary(proposed),
      leafCoverage: leafCoverage(proposed),
      shadowedOutcomeRules: shadowedOutcomeRules(proposed),
      validation: validateProblemRule(proposed),
      treeDiscrimination: treeDiscrimination(decidedForDiscrimination(afterAll)),
      movers: movers.slice(0, PREVIEW_MOVERS_MAX),
      moverCount: movers.length,
      truncated: movers.length > PREVIEW_MOVERS_MAX,
    };
  });
}

export function recomputeProblems(_p?: unknown): ApiResult {
  return mutate(() => ({ ...syncStore.redecideProblems(), ...problemRuleState() }));
}

// ------------------------------------------------------------------------ posture rule
//
// Phase 6's lattice (domain/posture.ts, domain/postureRule.ts) exposed: same four
// endpoints as the AARS rule and the problem rule above, same shapes, mirrored rather than
// shared for the reason each of those own header comments gives — three genuinely
// different models (a continuous score, a 4-outcome tree, a 4-tier lattice) that happen to
// share an editor idiom, not one model wearing three costumes.

/**
 * The same {version, rule, computedVersion, stale, summary, cellCoverage, validation,
 * shadowed, unreachable} shape `problemRuleState()` assembles for the tree, mirrored onto
 * the lattice. `getPostureRule` and `setPostureRule` share it so the two can never
 * disagree about what "the current state" means.
 */
function postureRuleState(): Rec {
  const stored = settingsStore.getPostureRule();
  const computedVersion = settingsStore.getComputedPostureVersion();
  return {
    version: stored.version,
    rule: stored.rule,
    computedVersion,
    stale: computedVersion !== stored.version,
    summary: postureRuleSummary(stored.rule),
    cellCoverage: cellCoverage(stored.rule),
    validation: validatePostureRule(stored.rule),
    shadowed: shadowedTierRules(stored.rule),
    unreachable: unreachableTierRules(stored.rule),
    limits: { maxTierRules: MAX_TIER_RULES },
  };
}

export function getPostureRule(_p?: unknown): ApiResult {
  return run(() => postureRuleState());
}

export function setPostureRule(p?: unknown): ApiResult {
  return mutate(() => {
    const params = (p ?? {}) as Rec;
    const proposed = cleanPostureRule(params["rule"]);
    const errors = validatePostureRule(proposed);
    if (errors.length) throw new Error(errors.join(" "));
    settingsStore.setPostureRule(proposed);
    return postureRuleState();
  });
}

/**
 * The decided population `postureDiscrimination` wants: tier + vector + unknowns, read off
 * whichever nodes a preview actually folded a tier onto. Mirrors `decidedForDiscrimination`
 * (the problem-rule preview's identical filter) — a node with no `postureInput` (never
 * folded, or a synthetic node the fold skipped) is excluded rather than guessed at.
 */
function decidedForPostureDiscrimination(
  nodes: ReadonlyArray<{ postureTier?: number; postureInput?: { capability: string; containment: string; consequence: string; unknowns?: string[] } }>,
): Array<{ tier: Tier; vector: PostureVector; unknowns: string[] }> {
  const out: Array<{ tier: Tier; vector: PostureVector; unknowns: string[] }> = [];
  for (const node of nodes) {
    const tier = node.postureTier;
    const input = node.postureInput;
    if (!input || !(TIER_VALUES as readonly number[]).includes(tier as number)) continue;
    out.push({
      tier: tier as Tier,
      vector: {
        capability: input.capability as PostureVector["capability"],
        containment: input.containment as PostureVector["containment"],
        consequence: input.consequence as PostureVector["consequence"],
      },
      unknowns: input.unknowns ?? [],
    });
  }
  return out;
}

/**
 * What saving this rule would do to every persisted asset's tier as it reads right now —
 * `previewProblemRule`'s counterpart, built the same way: `syncStore.posturesWith(draft)`
 * costs ZERO Wiz calls (posture derivation reads only the node's own already-persisted
 * fields plus the already-decided problem verdicts), and the result is diffed against what
 * the Inventory shows today.
 */
export function previewPostureRule(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const proposed = cleanPostureRule(params["rule"]);
    const errors = validatePostureRule(proposed);
    if (errors.length) throw new Error(errors.join(" "));

    const before = syncStore.loadAssets();
    const beforeById = new Map(before.map((n) => [n.id, n.postureTier]));

    const after = syncStore.posturesWith(proposed);

    const movers: Rec[] = [];
    for (const node of after) {
      const fromTier = beforeById.get(node.id) ?? null;
      const toTier = node.postureTier ?? null;
      if (fromTier === toTier) continue;
      movers.push({
        id: node.id, name: node.name, kind: node.kind, fromTier, toTier,
      });
    }
    // Worst proposed tier first (4 → 1) — the queue an operator would actually triage —
    // then id for a stable order across an otherwise-tied pair.
    movers.sort((a, b) => {
      const r = Number(b["toTier"] ?? 0) - Number(a["toTier"] ?? 0);
      return r !== 0 ? r : String(a["id"]).localeCompare(String(b["id"]));
    });

    return {
      total: after.length,
      current: countPostureTiers(before),
      proposed: countPostureTiers(after),
      summary: postureRuleSummary(proposed),
      cellCoverage: cellCoverage(proposed),
      shadowed: shadowedTierRules(proposed),
      unreachable: unreachableTierRules(proposed),
      validation: validatePostureRule(proposed),
      postureDiscrimination: postureDiscrimination(decidedForPostureDiscrimination(after)),
      movers: movers.slice(0, PREVIEW_MOVERS_MAX),
      moverCount: movers.length,
      truncated: movers.length > PREVIEW_MOVERS_MAX,
    };
  });
}

export function recomputePostures(_p?: unknown): ApiResult {
  return mutate(() => ({ ...syncStore.recomputePostures(), ...postureRuleState() }));
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
        dataFindings: dataRowCount(TABS.dataFindings),
        syncs: dataRowCount(TABS.syncHistory),
      },
    }), 3_600),
  );
}
