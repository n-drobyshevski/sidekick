// google.script.run API surface. Every endpoint returns {ok, data} | {ok:false,
// error} so the client wrapper promisifies uniformly. Reads never take the script
// lock; mutations run inside withScriptLock + recoverIfNeeded.

import {
  ASSET_COMPARATORS,
  CLIENT_ALL_MAX,
  DEFAULT_PAGE_SIZE,
  facetCounts,
  filterAssetRows,
  MAX_PAGE_SIZE,
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
  COUNT_KEYS,
  countAarsSeverities,
  countTrendFromHistory,
  type CountKey,
  type CountTrendPoint,
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
  problemCensus,
  problemRuleSummary,
  shadowedOutcomeRules,
  treeDiscrimination,
  validateProblemRule,
} from "../domain/problemRule";
import { countPostureTiers, postureStateOf, TIER_VALUES, type PostureVector, type Tier } from "../domain/posture";
import {
  buildProblemRows,
  PROBLEMS_CLIENT_ALL_MAX,
  rankProblems,
  type ProblemRow,
} from "../domain/problems";
import { rankRuleFromExploitation } from "../domain/rank";
import {
  concentrationRatio,
  coverCurve,
  rankActionsByCover,
  withAutoRemediation,
} from "../domain/actions";
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
  DERIVATION_VERSION,
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
import { dropUnselected, scopeFiveRs, withCountsFrom } from "../domain/complianceScope";
import { fiveRsDerivedPosture } from "../domain/fiveRsPosture";
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
import { scopeGraphDoc } from "../domain/graphScope";
import {
  DEFAULT_QUERY,
  fieldValuesFor,
  fieldsForKind,
  type QueryKind,
  type QueryResult,
  queryVocabulary,
  runQuery,
  validateQueryWithWarnings,
} from "../domain/graphQuery";
import {
  AI_ASSET_KINDS,
  NODE_KINDS,
  projectCatalogue,
  type FindingRow,
  type FrameworkPolicyRow,
  type GEdge,
  type GNode,
  type GraphDoc,
  type IssueRow,
  type NodeKind,
  type PostureRow,
} from "../domain/graphTypes";
import { normalizeCompliancePosturePage } from "../domain/syncNormalize";
import { DATASTORE_KINDS } from "../domain/graphEnrich";
import { comboDigest } from "../domain/comboDigest";
import { estateReach, type EstateReach } from "../domain/reach";
import { comboGroupById, comboSummary, REGISTER_GROUPS } from "../domain/toxicCombos";
import { clampInt, nowIso, type Rec } from "../domain/util";
import { inProject } from "../domain/prunePlan";
import { archiveBytes } from "./archiveStore";
import { activeJob } from "./jobsStore";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { buildInfo } from "./buildInfo";
import { domainTagKey, hasWizCredentials, projectScope } from "./props";
import { domainCoverage, domainOfTags } from "../domain/domainTag";
import { cached, dataVersion, wizDataVersion } from "./serverCache";
import {
  AGENT_EXPANSION,
  decodeExpansion,
  flattenSlots,
  toGraphEntityQuery,
} from "../domain/graphExpand";
import { aiCompliancePostureVariables, Q_AGENT_EXPANSION, Q_COMPLIANCE_POSTURE } from "./wizQueriesAi";
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

/**
 * The register as the dashboard should CURRENTLY SHOW it — the one place the project view is
 * applied, so every read surface inherits it without nine separate filters drifting apart.
 *
 * Deliberately NOT inside `syncStore.loadAssets()`. The sync path reads that too, and so do
 * the rule previews below, which diff a proposed scoring rule across the whole register; a
 * filter down there would make a rescore preview quietly understate its own blast radius.
 * Read surfaces call this, everything else keeps `loadAssets()`, and the difference is
 * intentional rather than an oversight.
 *
 * An asset carries every project it belongs to, ancestors included, so one id match selects a
 * folder's entire subtree. A view naming a project the register does not hold filters to
 * nothing — which is honest for that project, and is why the picker only ever offers projects
 * the register actually has.
 */
function viewAssets(): GNode[] {
  const view = settingsStore.getProjectView();
  const all = syncStore.loadAssets();
  if (!view) return all;
  // Shared with the prune (domain/prunePlan.ts) rather than spelled out again here. Two
  // copies of "does this asset belong to that project" would be two answers to it, and the
  // first symptom of the drift would be a prune deleting rows this filter was showing.
  return all.filter((a) => inProject(a.projects, view));
}

/**
 * Ids of the assets in view, or null when the whole register is.
 *
 * Null rather than "every id" so the callers below can skip the filter entirely in the
 * common case, and so "no view" never has to be spelled as a set that happens to contain
 * everything — the two states really are different questions.
 */
function viewAssetIds(): Set<string> | null {
  if (!settingsStore.getProjectView()) return null;
  const ids = new Set<string>();
  for (const a of viewAssets()) ids.add(a.id);
  return ids;
}

/**
 * Issues and findings in view: the ones hanging off an asset in view.
 *
 * These exist because filtering the ASSETS is not enough. Priorities, Toxic Combinations
 * and Cloud Configuration are populated by issue and finding rows, and only join assets in
 * for enrichment — so scoping the join alone leaves every row on screen and merely strips
 * the ones outside the view of their posture tier. Worse than unscoped: the page would show
 * a tenant-wide list under a label naming one project, with a scattering of rows silently
 * missing their scoring.
 *
 * A row whose asset is in no project — a configuration finding evaluated against a REGION,
 * a service account no agent runs as — is out of every project view, because there is
 * nothing to attribute it to. It comes back the moment the view is cleared.
 */
/**
 * The graph as the current view should draw it.
 *
 * The graph needs its own helper rather than reusing `viewAssets()` because a graph cannot be
 * filtered row by row: dropping a node drops every path through it, and the paths are the
 * product. `scopeGraphDoc` carries the node rule and the reasoning — evidence rides along with
 * whatever asset survived, and another project's assets never ride along with it.
 *
 * Memoized per execution, mirroring `loadGraphDoc`: three endpoints call this and the walk is
 * over the whole register.
 *
 * Keyed on the view AND on the identity of the raw doc, the same trick `syncStore.loadAssets`
 * uses. The view alone is not enough and the gap is not obvious: this memo is a module-level
 * binding in THIS file, so `syncStore.invalidateReadMemos()` does not reach it — it clears
 * syncStore's own same-named memo. Keyed on the view only, any mutation followed by a graph
 * read under an unchanged view would serve the pre-mutation graph. No caller does that today
 * (all three are `run()`, none write first), which is exactly why it would be found late.
 * `loadGraphDoc` already returns a memoized object that invalidation replaces, so comparing
 * its identity is exact and costs nothing.
 */
let graphDocMemo: { view: string; raw: GraphDoc | null; doc: GraphDoc | null } | null = null;

// NO `__resetMemosForTest` here, unlike the other memo-holding modules in this directory,
// and deliberately: every `export function` in this file must have a matching GAS delegator
// in dist/entry.js (esbuild.config.mjs enforces it), and a test hook is not an endpoint.
//
// It does not need one. `graphDocMemo` is keyed on the IDENTITY of `syncStore.loadGraphDoc()`,
// so once syncStore drops its own memos the next `loadGraphDoc()` builds a fresh object, the
// `raw ===` check misses, and this memo re-derives on its own. A memo added here that is NOT
// identity-keyed would break that, and would need the guard question answered again.

function viewGraphDoc(): GraphDoc | null {
  const view = settingsStore.getProjectView();
  const raw = syncStore.loadGraphDoc();
  if (graphDocMemo && graphDocMemo.view === view && graphDocMemo.raw === raw) {
    return graphDocMemo.doc;
  }
  const doc = raw ? scopeGraphDoc(raw, view) : null;
  graphDocMemo = { view, raw, doc };
  return doc;
}

function viewIssues(): IssueRow[] {
  const ids = viewAssetIds();
  const all = syncStore.loadIssues();
  return ids ? all.filter((i) => ids.has(i.assetId)) : all;
}

function viewFindings(): FindingRow[] {
  const ids = viewAssetIds();
  const all = syncStore.loadFindings();
  return ids ? all.filter((f) => ids.has(f.resourceId)) : all;
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
  return viewIssues().filter(isUnresolvedIssue);
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
  const assets = viewAssets();
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
    // A SECOND kind of staleness, deliberately not folded into `aarsRule.stale` above.
    //
    // That one means "the model moved since these scores were computed", and Recompute fixes
    // it — no Wiz call, the inputs are all in the sheet. This one means "the STORED FACTS were
    // collected by an older normalizer", and Recompute cannot fix it at all: the old value was
    // destroyed at ingest, so a cell reading "false" carries no memory of Wiz never having
    // answered. Only a full sync repairs it.
    //
    // Shipping them as one flag would point an operator at a button that cannot help, which is
    // worse than not warning at all — so the remedy travels WITH the warning.
    derivation: {
      current: DERIVATION_VERSION,
      lastSync: settingsStore.getSyncDerivationVersion(),
      stale: settingsStore.derivationIsStale(),
      // Named here rather than in the client so the one sentence that matters cannot drift
      // from the condition that raises it.
      remedy: "sync",
    },
    latestSync: latest,
    counts: {
      aiAssets: assets.filter((a) => AI_ASSET_KINDS.includes(a.kind)).length,
      totalAssets: assets.length,
      openIssues: issues.length,
      bySeverity,
      // A DISTRIBUTION, kept: this is the shape of the score across the landscape, which is
      // a legitimate thing to publish and is what the workbench's band rail draws. It is
      // not a per-asset claim, and there is no longer any per-asset claim to be — the
      // percentile that briefly carried one went with the surfaces that led with it.
      byAarsSeverity,
      // How much of the landscape the model actually prices, which is the denominator
      // under the distribution above: "19 CRITICAL" means nothing without "of 30 scored".
      aarsScored: assets.filter((a) => typeof a.aars === "number").length,
    },
    filterOptions: filterOptions(assets, syncStore.loadAssets()),
    // What the switcher shows as selected, and what that selection costs. `shown` and
    // `register` ride together because the control has to be able to say "826 of 12,778"
    // rather than "826" — a count with no denominator cannot distinguish a small unit from
    // a small register, and those call for opposite reactions. Sits beside the data rather
    // than in `settings` because every number on this payload was already filtered by it:
    // the label and the figures it labels have to come from one read.
    scope: {
      projectView: settingsStore.getProjectView(),
      shown: assets.length,
      register: syncStore.loadAssets().length,
      // What the SYNC is scoped to collect (WIZ_PROJECT_ID_V2), as opposed to what the
      // pages are scoped to show above it. Null when unset, which means the battery runs
      // tenant-wide. Here so the Data page's prune panel can default to it and say which
      // option that is, instead of the client holding an id the server owns.
      syncProjectId: projectScope()?.[0] ?? null,
    },
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

/**
 * `assets` is what the view currently shows; `register` is everything synced. The facets
 * describe the visible rows, so they narrow with the view — offering a cloud or a kind no
 * visible row has would be a filter that can only ever return nothing.
 *
 * `projectList` is the one exception, and it is the switcher's own list. Derived from the
 * visible rows it would collapse to the selected project the moment you selected one, and
 * a sibling project would become unreachable without clearing the view first — a control
 * that removes its own alternatives is a one-way door, not a filter.
 */
function filterOptions(assets: GNode[], register: GNode[]): Rec {
  const kinds = new Set<string>();
  const clouds = new Set<string>();
  const projects = new Set<string>();
  const domains = new Set<string>();
  for (const a of assets) {
    kinds.add(a.kind);
    if (a.cloudPlatform) clouds.add(a.cloudPlatform);
    for (const p of a.projects ?? []) projects.add(p.name);
    if (a.domain) domains.add(a.domain);
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
    domains: [...domains].sort(),
    // Keyed by ID, and deliberately BESIDE `projects` rather than replacing it. Every facet
    // filter on every page matches project names, and there is no reason to migrate them
    // here; the switcher needs ids because only an id carries ancestry — an asset lists its
    // whole chain, so one id match selects a folder's entire subtree. Its counts are
    // register-wide on purpose: they answer "how much would I see if I picked this".
    projectList: projectCatalogue(register),
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
      const doc = viewGraphDoc();
      if (!doc) return { empty: true };
      const options = resolveGraphParams(params, {
        defaultDepth: settingsStore.getDefaultDepth(),
        maxNodes: settingsStore.getMaxNodes(),
        issues: openIssues(),
        // The graph doc's own nodes, so `seedKind=domain` starts from every resource one
        // domain owns. Read from `doc` rather than viewAssets(): the graph is what is
        // being seeded, and it holds the risk-topology nodes the inventory never does.
        nodes: doc.nodes,
      });
      const view = resolveLayoutParams(params);
      const projection = projectGraph(doc, options);
      const layout = layoutGraph(projection, view);
      return {
        nodes: projection.nodes.map((n) => publicNode(n as unknown as Rec)),
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
      const doc = viewGraphDoc();
      if (!doc) {
        return { empty: true, kinds: [], stepsFrom: {}, valuesFor: {}, fieldsFor: {}, shortcuts: [] };
      }
      const vocab = queryVocabulary(doc);
      if (!kind) return vocab;
      return {
        ...vocab,
        // ANY gets them too, over every node in the graph. `fieldsForKind("ANY")` already keeps
        // only the kind-agnostic fields, so the union is never one of things that cannot
        // co-occur — it is "which clouds does this landscape use", which is the question.
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
    // `retired` names the filter fields the vocabulary dropped rather than rejected — the
    // derived verdicts. A saved view or a shared link written against them still runs; the
    // page prints one line saying which filter is no longer being applied, because a query
    // silently answering something broader than it was asked is worse than a stale link.
    const { query, retired } = validateQueryWithWarnings(params["query"] ?? DEFAULT_QUERY);
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
    // `retired` rides outside the cache key on purpose: it is a property of the REQUEST,
    // and two spellings of one query must still share a cache entry.
    const answer = cached("graphQuery", { query, columns, view, maxNodes }, () => {
      const doc = viewGraphDoc();
      if (!doc) return { empty: true };
      const result = runQuery(doc, query, { columns });
      const projection = inducedProjection(doc, result, maxNodes);
      return {
        rows: result.rows,
        groups: result.groups,
        total: result.total,
        capped: result.capped,
        truncated: result.truncated,
        nodes: projection.nodes.map((n) => publicNode(n as unknown as Rec)),
        edges: projection.edges,
        summaries: projection.summaries,
        counts: projection.counts,
        layout: layoutGraph(projection, view),
        options: { maxNodes, layout: view.mode, groupBy: view.groupBy, sort: view.sort },
        syncedAt: doc.syncedAt,
      };
    }) as Rec;
    return retired.length ? { ...answer, retiredFilters: retired } : answer;
  });
}

/** `columns[i]` is the field-key list for the i-th shown node, or null to take its defaults. */
function readColumnSelection(raw: unknown): Array<string[] | null> | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((entry) =>
    Array.isArray(entry) ? entry.map((k) => String(k)) : null);
}

/**
 * The matched paths, and the evidence for their filters, as a drawable subgraph.
 *
 * `projectGraph` cannot do this job: it answers "what is within N hops of these seeds", and the
 * whole point of a query is that the answer is a specific set of paths rather than a
 * neighbourhood. So the projection is assembled directly — but in the SAME shape, so
 * `layoutGraph` takes it unchanged.
 *
 * THE UNIT OF ADMISSION IS THE PATH, NOT THE NODE. This used to sort every wanted node by
 * `nodeOrder` and slice at the budget, and that quietly destroyed the picture it was trying to
 * preserve. `nodeOrder` leads on severity, and `severityRank(undefined)` answers
 * `SEVERITY_ORDER.length` — the WORST rank. Service accounts and buckets carry no severity of
 * their own, so a path's connective tissue always sorted last and was always cut first; every
 * edge that lost an endpoint went with it. Measured on the sample landscape, dropping 39 wanted
 * nodes to a 30-node budget kept 2 of 34 edges and left 27 of 30 cards isolated — a 23% node cut
 * costing 94% of the edges, and a canvas of disconnected dots where the answer was a set of
 * attack paths.
 *
 * So each path is admitted whole or not at all, worst-first (the order `runQuery` already
 * enumerates roots in), stopping at the first that will not fit. This is the same trade
 * `projectGraph` makes with its seed waves — "the budget is spent on paths first" — and it makes
 * the drawn set a PREFIX of the rows, so "showing the first N" is literally true of both views.
 *
 * Two rules the prefix has to bend for:
 *   - The first path is admitted even if it alone exceeds the budget, so the canvas is never
 *     empty while the table has rows. It is truncated matched-nodes-first, which is the one
 *     place `witnessNodeIds` being a separate set earns its keep: evidence is what to drop when
 *     something must be.
 *   - `nodes.length <= maxNodes` still holds. That ceiling is a documented promise of every
 *     payload, and a cluster that will not fit is a reason to stop rather than to overspend.
 *
 * No SUMMARY stubs: a "+N more" pill collapses a fan-out under one parent, and a truncated path
 * set has no parent to hang one off — the counts line says what was dropped instead.
 */
function inducedProjection(
  doc: GraphDoc,
  result: Pick<QueryResult,
    "nodeIds" | "edgeIds" | "witnessNodeIds" | "witnessEdgeIds" | "paths">,
  maxNodes: number,
): Projection {
  const wantNodes = new Set([...result.nodeIds, ...result.witnessNodeIds]);
  const wantEdges = new Set([...result.edgeIds, ...result.witnessEdgeIds]);
  const isWitness = new Set(result.witnessNodeIds);

  const admitted = new Set<string>();
  for (const path of result.paths) {
    const fresh = path.filter((id) => wantNodes.has(id) && !admitted.has(id));
    if (!fresh.length) continue;                       // wholly covered by an earlier path
    if (admitted.size + fresh.length <= maxNodes) {
      for (const id of fresh) admitted.add(id);
      continue;
    }
    // Does not fit. Stop — unless nothing has been admitted at all, in which case take what
    // this one path can spare, its matched nodes ahead of its evidence.
    if (!admitted.size) {
      const room = fresh
        .slice()
        .sort((a, b) => Number(isWitness.has(a)) - Number(isWitness.has(b)))
        .slice(0, maxNodes);
      for (const id of room) admitted.add(id);
    }
    break;
  }

  // Sorted by `nodeOrder` on the way out, as this has always been: the admission order is a
  // budget decision and the payload order is the canvas's own worst-first reading. Under budget
  // the two produce exactly the array they produced before this function knew about paths.
  const nodes = doc.nodes.filter((n) => admitted.has(n.id)).sort(nodeOrder);
  const allEdges = doc.edges.filter((e) => wantEdges.has(e.id));
  const edges = allEdges.filter((e) => admitted.has(e.src) && admitted.has(e.dst));
  // Counted, because the canvas now draws nodes the table does not list and a reader deserves to
  // be told rather than left to reconcile "11 results" against 36 cards. Omitted when there is no
  // evidence at all, which keeps every unfiltered payload byte-identical to what it was.
  const evidence = nodes.filter((n) => isWitness.has(n.id)).length;
  return {
    nodes,
    edges,
    summaries: [],
    counts: {
      totalNodes: wantNodes.size,
      shownNodes: nodes.length,
      totalEdges: allEdges.length,
      shownEdges: edges.length,
      capped: nodes.length < wantNodes.size,
      ...(evidence ? { evidence } : {}),
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
    // What every asset surface leads with now: two counts and the severity of the worst
    // thing in the first of them. No score, no band, no percentile, no posture tier, no
    // problem outcome — the three models this app derives reach the workbench and nothing
    // else, so this projection is where that stops being a UI convention and becomes a
    // property of the payload.
    openIssues: n.openIssues ?? 0,
    openFindings: n.openFindings ?? 0,
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
    // `?? null`, not `?? false`. The store now keeps this tri-state, and re-collapsing it
    // here would undo that fix one layer above it: the guardrail scan is a NEGATED traversal
    // that only ever sets the flag TRUE, so `false` has never meant "we looked and a
    // guardrail is attached". Every client reader tests `=== true` (assetTable.ts flag()),
    // so a null reads as "not flagged" exactly as before — what changes is that "never
    // scanned" stops being reported as a confirmed negative.
    guardrailMissing: n.guardrailMissing ?? null,
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
    // The resolved Wiz/Domain, beside the raw tag list it came from. A fact Wiz
    // reported, not a verdict this app derived — which is why it may ride a payload
    // the AARS score, the posture tier and the problem outcome may not.
    domain: n.domain ?? null,
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
 *
 * NO DERIVED VERDICT REACHES THIS ROW. No score, no band, no percentile, no posture tier,
 * no problem outcome — the register ranks and reads by counts now, and the three models
 * are published only by the endpoints the workbench calls. The two breakdowns below are
 * severity mixes of things Wiz reported, not gradings of them.
 */
function assetTableRow(
  n: GNode,
  issuesBySeverity?: Record<string, number>,
  findingsBySeverity?: Record<string, number>,
): Rec {
  const row: Rec = {
    id: n.id,
    name: n.name,
    kind: n.kind,
    cloud: n.cloudPlatform ?? null,
    region: n.region ?? null,
    severity: n.severity ?? null,
    // The two counts the register sorts, ranks and leads with. Read-derived on the node
    // (syncStore.withOpenCounts) rather than recounted here, so the table, the graph and
    // the asset sheet publish one number per asset instead of three that agree by luck.
    openIssues: n.openIssues ?? 0,
    openFindings: n.openFindings ?? 0,
    combos: (n.comboGroups ?? []).length,
    // `?? null`, not `?? false`. The store now keeps this tri-state, and re-collapsing it
    // here would undo that fix one layer above it: the guardrail scan is a NEGATED traversal
    // that only ever sets the flag TRUE, so `false` has never meant "we looked and a
    // guardrail is attached". Every client reader tests `=== true` (assetTable.ts flag()),
    // so a null reads as "not flagged" exactly as before — what changes is that "never
    // scanned" stops being reported as a confirmed negative.
    guardrailMissing: n.guardrailMissing ?? null,
    agentic: n.identityPurpose === "AGENTIC",
    // How many classified findings this asset can REACH — its own if it is a datastore,
    // whatever its execution identity can read if it is an agent.
    //
    // Two sources because the reach walk is persisted through `aarsInput`, which only
    // scored nodes carry: a BUCKET is never scored (AARS covers AI assets), so a store
    // holding three findings would otherwise report 0 in the register while the graph drew
    // them. Identities fall in the same gap and stay uncovered here — service accounts are
    // unscored for reasons that predate this chain, so nothing persists their reach.
    //
    // READING `aarsInput` IS NOT READING A VERDICT, and this line survives the cut that
    // took the score off every page for that reason. `aarsInput.dataFindings` is the
    // persisted reach WALK — how many classified findings this asset can get to — which
    // the scoring model happens to price and which nothing else re-derives. Deleting it as
    // "aars stuff" would silently zero a column about data exposure that has no opinion
    // about any model. Pinned by a test for exactly that reason.
    dataFindings: (n.aarsInput?.dataFindings ?? []).reduce((sum, f) => sum + f.count, 0)
      || (n.dataFindingCount ?? 0),
    projects: (n.projects ?? []).map((p) => p.name),
    // Read-derived from the asset's own tags (graphEnrich.withDomains), never a
    // column — so a changed WIZ_DOMAIN_TAG_KEY repaints without a re-sync.
    domain: n.domain ?? null,
  };
  // Only the rows that have open issues carry the breakdown. Most of a healthy landscape has
  // none, and an empty object per row is pure weight in the all-inventory payload.
  if (issuesBySeverity) row["issuesBySeverity"] = issuesBySeverity;
  // Same "only when there are any" rule as the issue breakdown above, for the same reason.
  if (findingsBySeverity) row["findingsBySeverity"] = findingsBySeverity;
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

/**
 * Failing configuration findings rolled up per asset and severity — the breakdown behind
 * the table's `openFindings` count, and the exact analogue of the issue rollup above.
 *
 * Keyed by `resourceId`, because a finding is an evaluation of one rule against one
 * resource and that resource is what ties it to an asset. Most findings tie to nothing the
 * AI graph models — a region, a raw access policy, a service account no agent runs as — so
 * this map is deliberately much smaller than the finding population, and the difference is
 * published as `complianceGapsUnlinked` rather than left to look like a miscount.
 *
 * Callers pass an already-gated population (`isOpenGap`); this does not re-filter, so the
 * one definition of "failing control" stays in one place.
 */
function findingsBySeverityByAsset(findings: FindingRow[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const finding of findings) {
    if (!finding.resourceId) continue;
    const bucket = out.get(finding.resourceId) ?? {};
    const sev = finding.severity ?? "UNKNOWN";
    bucket[sev] = (bucket[sev] ?? 0) + 1;
    out.set(finding.resourceId, bucket);
  }
  return out;
}

interface AssetsModel {
  rows: Rec[];
  kpis: Rec;
  /** Assets by worst open-issue severity — the inventory strip's distribution. */
  severityCounts: Record<string, number>;
  /** Open issues / cloud findings / compliance posture fails over time. */
  countTrend: CountTrendPoint[];
  /** Which population `countTrend` describes, and how much of the ledger it covers. */
  trendScope: {
    /** The project view the series was read for, "" when register-wide. */
    projectId: string;
    scoped: boolean;
    /** Points in the series shipped. */
    points: number;
    /** Points the register-wide series has — the denominator for "covers N of M syncs". */
    registerPoints: number;
  };
  /** The landscape-grain coverage roll-up (reach.ts) — see the Wiz Scans REACH section. */
  reach: EstateReach;
  facets: {
    kinds: string[];
    clouds: string[];
    regions: string[];
    severities: string[];
    projects: string[];
    domains: string[];
  };
  /**
   * How much of the landscape carries the domain tag at all.
   *
   * The Domain facet lists only values that exist, so an empty one is ambiguous between
   * "nobody tagged anything" and "we never successfully asked" — AI_ASSET_PROPERTIES is
   * optional and swallows an HTTP 400, and it is the only route by which an AI asset's
   * properties bag arrives. A count beside the facet is what keeps the page from
   * publishing the second case as the first. An aggregate over the whole set, so it is a
   * count of what Wiz said and never a claim about any one asset.
   */
  domainCoverage: { key: string; tagged: number; total: number };
}

/**
 * Everything about the inventory that doesn't depend on the request: every table row, the
 * KPI totals, the AARS-severity histogram and the filter vocabulary. The aggregates are
 * computed over the whole inventory on purpose — the KPI row and the chart describe the
 * landscape, never the page or the filtered subset, so they stay honest when the client only
 * ever holds 50 rows.
 */
function assetsModel(): AssetsModel {
  // THE ONE SERIES THAT USED TO REFUSE THE SWITCHER. sync_history now carries a per-project
  // blob beside its register-wide totals (aarsTrend.ts PROJECT_TOTALS_COLUMN), so a scoped
  // read is a different column rather than a filter — there is still nothing on a history row
  // to filter BY. Syncs recorded before that column simply have no scoped point, which is why
  // the register-wide count travels beside the series: a chart starting three points in looks
  // exactly like a landscape that collapsed, and only `registerPoints` can tell the reader
  // which it is looking at.
  const history = syncStore.syncHistory();
  const projectView = settingsStore.getProjectView();
  const trend = countTrendFromHistory(history, 90, projectView);
  const registerPoints = projectView ? countTrendFromHistory(history).length : trend.length;
  const assets = viewAssets();
  const issues = openIssues();
  // reach.ts wants the WHOLE issues/findings population (resolved and passing rows
  // included) because it does its own admission filtering per stage — unlike every KPI
  // below, which reads `issues` (open only) or `openGaps` (failing only) because those
  // numbers ARE the filtered count. Reading `loadIssues`/`loadFindings` again here costs
  // nothing extra: both are memoized per execution (syncStore's read-memo discipline).
  const reach = estateReach({
    assets,
    issues: viewIssues(),
    findings: viewFindings(),
    // Unscoped ON PURPOSE, beside three scoped siblings — it reads as an oversight otherwise.
    // Reach uses edges for two things and both want the whole set. The per-asset "was this
    // ever walked" test is a join against ids already inside the view, so extra edges cannot
    // widen it. And the edge-type census asks which relationship types the sync produced AT
    // ALL: scoped, a type would be reported `dead` merely because this one project has none,
    // which is the exact false finding reach.ts's populated/dead split exists to prevent.
    edges: syncStore.loadEdges(),
  });
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
  // `viewFindings`, so this and `unlinkedGaps` below share ONE scope. The client prints
  // them as a single sentence — "N gaps · M not on an AI asset" — and a total counted over
  // the register with a caveat counted over the view would be two populations in one claim.
  // Under a project view the caveat falls to zero and the client drops it, which is right:
  // a finding on a resource no asset models belongs to no project.
  const openGaps = viewFindings().filter(isOpenGap);
  const unlinkedGaps = openGaps.filter((f) => !assetIds[f.resourceId]).length;
  const agents = assets.filter((a) => a.kind === "AI_AGENT");
  // `=== false`, not `!a.guardrailMissing`. The old test counted an agent the coverage scan
  // NEVER REACHED as protected, which is the same absence-of-evidence-as-a-control error
  // posture.containmentOf spends twenty lines refusing — and measureSpec.ts.s own
  // `guardrail-coverage-pct` record already described this defect in the present tense.
  // Three states now, published as three numbers rather than folded into two.
  const protectedAgents = agents.filter((a) => a.guardrailMissing === false).length;
  const guardrailUnknownAgents = agents.filter((a) => a.guardrailMissing === undefined).length;
  const issueRollup = issuesBySeverityByAsset(issues);
  // Over `openGaps`, the already-gated population above — so the per-asset breakdown and
  // `kpis.complianceGaps` count the same rows under the same definition.
  const findingRollup = findingsBySeverityByAsset(openGaps);
  const rows = assets
    .map((a) => assetTableRow(a, issueRollup.get(a.id), findingRollup.get(a.id)))
    .sort(ASSET_COMPARATORS.issues);


  // Assets by WORST open-issue severity — the distribution the inventory strip draws and
  // cross-filters on. Assets, not issues: the `severities` facet filters rows by this same
  // field, so a strip counting issues would offer segments a click could not reproduce.
  const severityCounts: Record<string, number> = {};
  const kinds = new Set<string>();
  const clouds = new Set<string>();
  const regions = new Set<string>();
  const severities = new Set<string>();
  const projects = new Set<string>();
  const domains = new Set<string>();
  for (const a of assets) {
    kinds.add(a.kind);
    if (a.cloudPlatform) clouds.add(a.cloudPlatform);
    if (a.region) regions.add(a.region);
    if (a.severity) {
      severities.add(a.severity);
      severityCounts[a.severity] = (severityCounts[a.severity] ?? 0) + 1;
    }
    for (const p of a.projects ?? []) if (p.name) projects.add(p.name);
    if (a.domain) domains.add(a.domain);
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
      // The third state, published rather than folded away. An agent the coverage scan never
      // reached is not protected and not unprotected, and before this it was silently counted
      // as protected — see protectedAgents above.
      guardrailUnknownAgents,
      // The two asset-level headline counts, and they come from the POSTURE TIER rather
      // than from the AARS band.
      //
      // `criticalAars` / `highAars` used to sit here and were removed, not renamed. They
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
      // The attribution denominator, published beside its total for the same reason
      // `complianceGapsUnlinked` is: a widened join has to say what it did NOT reach, or the
      // number it does report reads as the whole register.
      //
      // On the reference tenant this is the sharpest figure the app publishes about its own
      // coverage: 691 of 840 AI-category issues land on a SERVICE_ACCOUNT, and only 22 of 99
      // in-scope issues resolved to a synced AI asset before the RUNS_AS hop existed. A rising
      // `issuesAttributed` is evidence the traversal ran, never evidence the estate got safer.
      issuesAttributed: issues.filter((i) => (i.attributedAssetIds ?? []).length > 0).length,
      // Reached no AI asset at all. Counts only rows attribution actually RAN over — a row
      // synced before the fold existed carries no hop and is excluded from both halves rather
      // than silently counted as a failure to attribute.
      issuesUnattributed: issues.filter(
        (i) => i.attributionHop !== undefined && (i.attributedAssetIds ?? []).length === 0,
      ).length,
      complianceGaps: openGaps.length,
      complianceGapsUnlinked: unlinkedGaps,
      // Framework POSTURE, which is a different axis from the two counts above: those
      // count failing controls, this scores frameworks. Null — never 0 — when no posture
      // has been synced, so the Wiz Scans area degrades to `partial` on its own instead of
      // reporting a confident zero for a question this tenant was never asked.
      // Scoped the same way the Compliance page scopes it. Not an optimisation — the two
      // pages would otherwise report different failing-control totals for one landscape, and
      // this KPI is the number the Wiz Scans coverage area prints beside the other one.
      frameworkPosture: complianceKpis(
        syncStore.loadPosture(),
        scopedFrameworkPolicies().policies,
      ),
      agenticIdentities: assets.filter((a) => a.identityPurpose === "AGENTIC").length,
      // Landscape-wide counts for the two risk conditions that had no total. The flags were
      // persisted and drawn on the graph, but `assetTableRow` strips them, so nothing
      // could say how much of the landscape they cover. `internetUnknown` is its own number
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
    severityCounts,
    // Recorded per sync, so the window is short at first and cannot be backfilled — and
    // per SERIES, since the three counts entered the ledger on three different days.
    countTrend: trend,
    trendScope: {
      projectId: projectView,
      scoped: Boolean(projectView),
      points: trend.length,
      registerPoints,
    },
    reach,
    facets: {
      kinds: [...kinds].sort(),
      clouds: [...clouds].sort(),
      regions: [...regions].sort(),
      severities: SEVERITY_ORDER.filter((sev) => severities.has(sev)),
      projects: [...projects].sort(),
      domains: [...domains].sort(),
    },
    domainCoverage: domainCoverage(assets, domainTagKey()),
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
      severityCounts: model.severityCounts,
      countTrend: model.countTrend,
      trendScope: model.trendScope,
      countDeltas: countDeltas(model.countTrend, model.kpis),
      reach: model.reach,
      facets: model.facets,
      domainCoverage: model.domainCoverage,
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
 * Change in each of the three counts since the previous sync, or null per series when the
 * comparison would be dishonest. Same silence-over-a-hedged-number rule the AARS band
 * deltas followed, minus the one cause that no longer exists:
 *  - fewer than two points: nothing to compare against;
 *  - either point has no number for that series: a sync recorded before the column existed,
 *    or one that collected no framework posture. Absent is not zero, so the difference is
 *    not zero either — it is unknown, and the chip stays away;
 *  - the latest point disagrees with the live count: the register moved since the last sync
 *    (a rescore, a project switch onto a series the ledger has no scoped point for), so a
 *    delta would explain a figure that is not the one on screen.
 *
 * THE RULE-VERSION CAUSE IS GONE, and its absence is the point of this whole change. Two
 * band distributions from different scoring models were not on the same scale, so a rule
 * edit had to suppress the delta. A count of open issues is on the same scale as every
 * other count of open issues, so nothing an operator does to a model can invalidate this
 * comparison.
 */
function countDeltas(
  trend: CountTrendPoint[],
  kpis: Rec,
): { counts: Partial<Record<CountKey, number>>; since: string } | null {
  if (trend.length < 2) return null;
  const last = trend[trend.length - 1]!;
  const prev = trend[trend.length - 2]!;
  const liveBy: Record<CountKey, number | null> = {
    issues: Number(kpis["openIssues"] ?? 0),
    findings: Number(kpis["complianceGaps"] ?? 0),
    postureFails: postureFailCount(kpis),
  };
  const counts: Partial<Record<CountKey, number>> = {};
  for (const key of COUNT_KEYS) {
    const a = last.counts[key];
    const b = prev.counts[key];
    if (a === null || b === null) continue;
    if (liveBy[key] === null || a !== liveBy[key]) continue;
    counts[key] = a - b;
  }
  return Object.keys(counts).length ? { counts, since: prev.at } : null;
}

/**
 * The live compliance-posture failure count — distinct policies with a failing evaluation.
 *
 * Null, not zero, when no posture was collected: the same "we never asked" state the
 * `posture_fail_count` column records as null, kept distinct here so a landscape with no
 * collected frameworks does not publish "0 failing policies" as if it had been checked.
 */
function postureFailCount(kpis: Rec): number | null {
  const posture = kpis["frameworkPosture"] as { frameworks?: number; failingPolicies?: number } | undefined;
  if (!posture || !posture.frameworks) return null;
  return Number(posture.failingPolicies ?? 0);
}

/**
 * Every asset as {id, name, kind} for the graph page's seed picker — a dropdown needs the
 * whole list, but not the table projection's other ten fields (and certainly not one page
 * of it). Same order as the inventory's default sort, which is now most open issues first.
 */
export function getAssetOptions(_p?: unknown): ApiResult {
  return run(() =>
    cached("assetOptions", null, () => ({
      rows: [...viewAssets()]
        .sort((a, b) =>
          Number(b.openIssues ?? 0) - Number(a.openIssues ?? 0)
          || Number(b.openFindings ?? 0) - Number(a.openFindings ?? 0)
          || String(a.name).localeCompare(String(b.name)))
        .map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
    })),
  );
}

/**
 * One asset, by id — REGISTER-WIDE, like every other by-id lookup here.
 *
 * This sheet is opened from scoped lists AND from unscoped ones: a graph neighbour, a
 * bookmark, a shared link. Scoping its contents would answer a question nobody asked — the id
 * already names one asset — and it would answer it with silence: an out-of-view asset rendered
 * with an empty issue list, which reads as "nothing wrong with this asset" rather than "not in
 * the project you are looking at". A security tool must not have that failure mode.
 *
 * The sheet used to make ONE exception to that rule, for `aarsPercentile`: a rank is a
 * fact about a population, so it was read off the register's own model to stop the sheet
 * and the row it was opened from giving one asset two ranks. Both the exception and the
 * figure are gone — nothing here reads a percentile, and nothing computes one.
 */
export function getAssetDetail(p?: unknown): ApiResult {
  return run(() => {
    const id = String(((p ?? {}) as Rec)["id"] ?? "");
    // Cached: opening the same detail sheet twice must not re-read Drive+Sheets.
    return cached("getAssetDetail", { id }, () => {
      // Raw, like the rest of this handler — see the header. A by-id sheet is register-wide.
      const doc = syncStore.loadGraphDoc();
      if (!doc) return null;
      const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
      const node = nodeById.get(id);
      if (!node) return null;
      // NOT openIssues(): that one is view-scoped, and this sheet is not. See the header.
      const issues = syncStore.loadIssues()
        .filter(isUnresolvedIssue)
        .filter((i) => i.assetId === id);
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
      // Raw, matching the rest of this handler — a by-id sheet is register-wide throughout.
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
        // No verdict block. The sheet used to carry `aarsPillars` and `aarsInput` so it
        // could draw the score's breakdown; the breakdown of a model under calibration
        // belongs beside the model, and the sheet now reads the same counts, issues and
        // findings every other asset surface does.
        node: assetRow(node),
        issues: issues.map((r) => publicRow(r as unknown as Rec)),
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
 * landscape, never the page or the filtered subset, the same contract the inventory keeps.
 */
/**
 * The synced AI assets, as an id set — "did this finding land on something the AI graph
 * models". `loadAssets` is memoized, so calling this more than once per execution costs a
 * map build and nothing else.
 *
 * REGISTER-WIDE, and both callers need it that way. The question it answers is a fact about
 * the FINDING — whether the AI graph models the resource it was evaluated against — and that
 * does not change with what the sidebar is looking at. Scoped, it silently became a different
 * question: `configModel` pairs it with `viewFindings()`, whose rows are already selected on
 * being in view, so the flag read `true` for every row and the linked/unlinked split the
 * Cloud Configuration page exists to show collapsed to one side.
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
 * different totals for the same landscape, which is exactly the "two answers to one question"
 * failure this codebase spends its comments avoiding.
 *
 * The scope has to be derived from the FULL tree before it can be applied to a filtered
 * one — a 5Rs rule is in scope partly because some OTHER framework maps it, so the trees
 * must exist before the question can be asked. Hence a build to decide and a build to
 * render. The payload is bounded by the framework rather than the landscape, so that is cheap.
 */
function scopedFrameworkPolicies(): {
  policies: FrameworkPolicyRow[];
  scope: ReturnType<typeof scopeFiveRs>;
} {
  const posture = syncStore.loadPosture();
  const allPolicies = syncStore.loadFrameworkPolicies();
  const catalogue = syncStore.loadFrameworks();

  // REGISTER-WIDE findings, deliberately — this derivation must not follow the project view.
  //
  // Two reasons, and the second is the serious one.
  //
  // It cannot be scoped coherently. `scopeFiveRs` decides which 5Rs rules are AI-relevant, and
  // the pass/fail counts inside the rules it selects are Wiz's own tenant-side totals:
  // `PostureRow` (domain/graphTypes.ts) is keyed by framework/category/subcategory and carries
  // no asset id at all, and `posture_pct` is stored exactly as Wiz sent it and never
  // recomputed. Scoping the selector over an unscopeable population gives one number built
  // from two populations — a project-selected numerator over a register-wide denominator.
  //
  // And it decides something PERSISTED. The Settings 5Rs card renders this scope, and the
  // toggle beside it writes a global pin (`setFiveRsPins`). Scoped, an operator standing in
  // one project sees "no AI link" for a rule that is linked in another, pins it out, and it is
  // pinned out everywhere. A page that stores a register-wide decision has to show the
  // register-wide evidence for it.
  const scope = scopeFiveRs(
    buildAllFrameworkTrees(posture, allPolicies, catalogue),
    syncStore.loadFindings(),
    aiAssetIdSet(),
    settingsStore.getFiveRsPins(),
  );

  return { policies: dropUnselected(allPolicies, scope), scope };
}

function configModel(): {
  rows: ConfigFindingView[];
  totals: ConfigTotals;
  facets: Record<string, string[]>;
} {
  // A MAP, not the id set: the domain is joined off the asset, and the linkage flag is
  // the same lookup. An unlinked finding has no node and so no domain — its resource
  // carries no tags in the configurationFindings payload at all (see ConfigFindingView).
  const assetsById: Record<string, GNode> = {};
  for (const a of syncStore.loadAssets()) assetsById[a.id] = a;
  const rows = viewFindings().map((f) => {
    const node = assetsById[f.resourceId];
    return toConfigView(f, !!node, node?.domain ?? "");
  });

  const severities = new Set<string>();
  const statuses = new Set<string>();
  const clouds = new Set<string>();
  const resourceTypes = new Set<string>();
  const rules = new Set<string>();
  const projects = new Set<string>();
  const domains = new Set<string>();
  for (const r of rows) {
    if (r.severity) severities.add(r.severity);
    if (r.status) statuses.add(r.status);
    if (r.cloud) clouds.add(r.cloud);
    if (r.resourceType) resourceTypes.add(r.resourceType);
    if (r.ruleShortId) rules.add(r.ruleShortId);
    for (const p of r.projects) projects.add(p);
    if (r.domain) domains.add(r.domain);
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
      domains: [...domains].sort(),
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
      // Raw, not viewFindings(): a lookup BY ID is already a specific answer. Someone
      // following a bookmark or a shared link should see the row, not a "not found" that
      // reads as deleted. Lists narrow; links do not break.
      const finding = syncStore.loadFindings().filter((f) => f.id === id)[0];
      if (!finding) return null;
      // loadAssets, not viewAssets: the comment above promises links do not break, and a
      // scoped join breaks them quietly — an out-of-view finding would come back with
      // `asset: null`, which this pane already uses to mean "no AI asset models this
      // resource". Two different facts must not share one rendering.
      const asset = syncStore.loadAssets().filter((a) => a.id === finding.resourceId)[0];
      return {
        finding: publicRow(finding as unknown as Rec),
        gap: isOpenGap(finding),
        // The asset the finding is keyed to, when the inventory holds it. Null is the
        // common case and is not an error: most AI-security rules fail on a region, an
        // IAM policy or an identity no agent runs as.
        asset: asset ? assetRow(asset) : null,
      };
    });
  });
}

// ------------------------------------------------------------- project-scoped posture

/**
 * How many frameworks may be re-scored live for one project view.
 *
 * Each one costs its own UrlFetchApp call — `securityFramework(id:)` takes ONE id — so a
 * tenant collecting posture for thirty frameworks would spend thirty calls on a project
 * switch, sequentially, inside one `google.script.run`. Past this line the page keeps the
 * stored figure and SAYS it did (`postureScope.reason`), rather than half-scoping or
 * hanging. Partial is not on the menu: see `scopedPosture` below.
 */
const SCOPED_POSTURE_MAX_FRAMEWORKS = 12;

/**
 * Why a project view is showing register-wide posture anyway. The client turns these into
 * words (`complianceShared.js`), the way it does for `POSTURE_STATES` — a code travels, a
 * sentence is written where it is read.
 */
type PostureScopeReason = "noCredentials" | "tooManyFrameworks" | "fetchFailed";

/** What `getCompliance` says about the population its numbers describe. */
interface PostureScope {
  /** The project view these numbers were re-scored for, "" when register-wide. */
  projectId: string;
  source: "stored" | "live";
  /** When Wiz was asked. Null on the stored path — that clock is the sync's. */
  fetchedAt: string | null;
  /** How many frameworks were re-scored. 0 on the stored path. */
  frameworkCount: number;
  reason: PostureScopeReason | null;
  /** The failure text, for `fetchFailed` only — never swallowed, the expandAsset rule. */
  detail: string | null;
}

/**
 * ONE framework's posture, re-aggregated by Wiz for one project.
 *
 * The re-aggregation is WIZ'S, not ours, and that is the whole reason this exists rather
 * than a local filter. A `PostureRow` is keyed by framework/category/subcategory and
 * carries no asset id (see `scopedFrameworkPolicies` and sheetsDb's own note on the tab),
 * so nothing stored here can be re-sliced by project — the counts behind a percentage are
 * tenant-side sums we never receive the terms of. But `complianceAnalytics` takes a
 * `selection`, and `aiCompliancePostureVariables` has always filled `projectId` into it:
 * the sync already sends the FETCH scope that way (syncJobs.ts). Asking again with a
 * different project id in the same slot is the same question about a smaller population,
 * answered by the only party that can answer it.
 *
 * Cached on `wizDataVersion()`, not `dataVersion()`, for the reason expandAsset is: this
 * holds a Wiz response, which costs a call to refill and does not go stale because someone
 * saved a band threshold locally. Flipping between two projects therefore pays Wiz once
 * per project per sync, not once per switch.
 *
 * The response goes through `normalizeCompliancePosturePage` — the SYNC's own normalizer,
 * not a second reading of the same shape. Nothing is written to the ledger: `posture_pct`
 * is stored exactly as Wiz sent it at the sync's scope, and a per-project answer is a
 * different question's answer, not a correction to that one.
 */
function fetchScopedPosture(
  frameworkId: string,
  projectId: string,
): { posture: PostureRow[]; frameworkPolicies: FrameworkPolicyRow[]; fetchedAt: string } {
  return cached("compliancePostureScoped", { frameworkId, projectId }, () => {
    const page = wizClientAi.fetchSingleObject("securityFramework", {
      query: Q_COMPLIANCE_POSTURE,
      extraVariables: {
        ...(aiCompliancePostureVariables([projectId]) as Rec),
        id: frameworkId,
      },
    });
    const part = normalizeCompliancePosturePage(page.rows);
    // Stamped INSIDE the cached closure, so it dates the ANSWER rather than the read. A
    // stamp taken by the caller would restart on every cache hit and print "asked just now"
    // over a response up to a TTL old — the one claim this field exists to make, made
    // wrongly. It is cached alongside the rows it describes, so the two cannot separate.
    return {
      posture: part.posture,
      frameworkPolicies: part.frameworkPolicies,
      fetchedAt: nowIso(),
    };
  }, undefined, wizDataVersion());
}

/**
 * Every collected framework's posture re-scored for the project in view, or null with a
 * reason to keep the stored one.
 *
 * ALL OR NOTHING, deliberately. A partial answer — three frameworks re-scored for the
 * project and the fourth left at the register's — would put the landscape mean over two
 * populations at once, which is the "one number built from two populations" failure this
 * codebase names in `scopedFrameworkPolicies` and refuses everywhere else. One framework
 * failing therefore drops the whole scoped read back to stored, and the note says so.
 *
 * The framework list comes from the STORED posture, not from the settings selection: the
 * scoped view must describe the same set of frameworks the register-wide view does, or
 * "4 of 42" would quietly mean something different depending on the sidebar.
 */
function scopedPosture(
  projectId: string,
  storedPosture: PostureRow[],
): {
  posture: PostureRow[];
  frameworkPolicies: FrameworkPolicyRow[];
  fetchedAt: string;
  frameworkCount: number;
} | { reason: PostureScopeReason; detail: string | null } {
  if (!hasWizCredentials()) return { reason: "noCredentials", detail: null };

  const frameworkIds: string[] = [];
  for (const row of storedPosture) {
    if (row.level === "framework" && frameworkIds.indexOf(row.frameworkId) === -1) {
      frameworkIds.push(row.frameworkId);
    }
  }
  if (frameworkIds.length > SCOPED_POSTURE_MAX_FRAMEWORKS) {
    return { reason: "tooManyFrameworks", detail: String(frameworkIds.length) };
  }

  const posture: PostureRow[] = [];
  const frameworkPolicies: FrameworkPolicyRow[] = [];
  // The OLDEST of the per-framework stamps, because a picture is only as fresh as its
  // stalest part: these are cached independently, so a fifth framework fetched an hour after
  // the other four must not let the whole page claim the newer time.
  let fetchedAt = "";
  try {
    for (const frameworkId of frameworkIds) {
      const part = fetchScopedPosture(frameworkId, projectId);
      posture.push(...part.posture);
      frameworkPolicies.push(...part.frameworkPolicies);
      if (!fetchedAt || part.fetchedAt < fetchedAt) fetchedAt = part.fetchedAt;
    }
  } catch (e) {
    return { reason: "fetchFailed", detail: String(e instanceof Error ? e.message : e) };
  }

  return { posture, frameworkPolicies, fetchedAt, frameworkCount: frameworkIds.length };
}

/**
 * The Compliance page: every synced framework as a tree, plus the catalogue for the
 * Settings picker.
 *
 * Shipped whole rather than paged. The payload is bounded by the FRAMEWORK, not by the
 * landscape — ten categories of ten subcategories is the shape of a published Top-10 list,
 * not of a tenant — so the row count cannot run away the way the inventory's or the
 * configuration register's can, and the two-mode all/paged machinery those need would be
 * complexity bought for nothing here.
 */
export function getCompliance(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const requested = String(params["frameworkId"] ?? "");
    // `projectView` is in the KEY as well as read inside, for the reason expandAsset's
    // `projectId` is: it is a live input this closure branches on, so a view change has to
    // reach the cache. `saveSettings` bumps DATA_VERSION and would evict it anyway today —
    // this stops that from being load-bearing.
    const projectView = settingsStore.getProjectView();
    return cached("getCompliance", { frameworkId: requested, projectView }, () => {
      const storedPosture = syncStore.loadPosture();
      const catalogue = syncStore.loadFrameworks();
      const selected = settingsStore.getSelectedFrameworks(() => catalogue);
      const { policies: registerPolicies, scope: registerScope } = scopedFrameworkPolicies();

      // Wiz re-aggregates for the project in view, or says why it could not — see
      // `scopedPosture`. Everything below is a pure function of (posture, policies), so this
      // one substitution re-scopes the trees, the KPIs, the rail, the weakest areas, the
      // shared controls and the coverage bands together, or none of them.
      const live = projectView ? scopedPosture(projectView, storedPosture) : null;
      const scoped = live && "posture" in live ? live : null;
      // The other arm, narrowed once rather than re-tested per field below.
      const refused = live && !("posture" in live) ? live : null;
      const posture = scoped ? scoped.posture : storedPosture;
      const policies = scoped
        // The 5Rs pin filter is a REGISTER-WIDE decision (scopedFrameworkPolicies says why),
        // so it is re-applied to the scoped rows rather than re-derived from them.
        ? dropUnselected(scoped.frameworkPolicies, registerScope)
        : registerPolicies;
      const postureScope: PostureScope = {
        projectId: projectView,
        source: scoped ? "live" : "stored",
        fetchedAt: scoped ? scoped.fetchedAt : null,
        frameworkCount: scoped ? scoped.frameworkCount : 0,
        reason: refused ? refused.reason : null,
        detail: refused ? refused.detail : null,
      };

      const trees = buildAllFrameworkTrees(posture, policies, catalogue);
      // The 5Rs framework's derived percentage — see fiveRsPosture.ts for what "derived"
      // means and why it is a different claim from Wiz's own. Null when there is no 5Rs
      // framework collected, or the request maps to no scored 5Rs tree at all.
      //
      // Scoped, the VERDICTS stay register-wide and only the counts move (withCountsFrom) —
      // otherwise this derived figure would be the one number left describing the register
      // on a page describing a project. `fiveRsScope` itself is shipped unscoped below,
      // because the Settings card that renders it writes a global pin.
      const fiveRsScope = scoped ? withCountsFrom(registerScope, trees) : registerScope;
      const fiveRsPosture = fiveRsDerivedPosture(
        fiveRsScope,
        trees.find((t) => t.frameworkId === fiveRsScope.frameworkId)?.posturePct ?? null,
      );
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
        //
        // ALWAYS the register-wide object, even under a project view — `registerScope`, not
        // the count-rescoped `fiveRsScope` the derived posture above is computed from. The
        // card renders this and its toggle writes a GLOBAL pin: an operator standing in one
        // project must not be shown "no AI link" for a rule that is linked in another and
        // pin it out everywhere on the strength of it.
        fiveRsScope: registerScope,
        // Computed server-side for the same reason `rail` / `weakestAreas` / `sharedControls`
        // above are: the client bundle cannot import the domain layer, so a browser-side
        // recomputation would be a hand-kept mirror rather than a shared source. This
        // payload is already shipped whole and cached, so there is no second scope for a
        // mirror to reconcile against — computing it here instead buys nothing but risk.
        fiveRsPosture,
        coverage: coverageSummary(trees, merged),
        // WHICH POPULATION every figure above describes, and — when a project view is set
        // but the numbers are still the register's — why. The page prints this beside the
        // hero rather than as a footnote, the discipline `registerWideNote` already keeps:
        // a footnote is read after the reader has decided.
        postureScope,
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
      // The domain fold, here rather than in graphExpand: that module is pure and the tag
      // key is a Script Property. Same resolution every stored node gets through
      // graphEnrich.withDomains, so a live-expanded node and a synced one agree.
      const expandDomainKey = domainTagKey();
      const nodes = decoded.nodes
        .slice(0, EXPAND_MAX_NODES)
        .map((n) => ({
          ...n,
          domain: domainOfTags(
            n["tags"] as Array<{ key: string; value: string }> | undefined,
            expandDomainKey,
          ),
        }));
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
      let rows = viewIssues();
      if (group) rows = rows.filter((i) => i.comboGroup === group);
      return { rows: rows.map((r) => publicRow(r as unknown as Rec)), total: rows.length };
    });
  });
}

export function getIssueDetail(p?: unknown): ApiResult {
  return run(() => {
    const id = String(((p ?? {}) as Rec)["id"] ?? "");
    // Raw for the same reason as getConfigFindingDetail above: lists narrow, links do not.
    const issue = syncStore.loadIssues().find((i) => i.id === id) ?? null;
    if (!issue) return null;
    const group = issue.comboGroup ? comboGroupById(issue.comboGroup) : null;
    return {
      issue: publicRow(issue as unknown as Rec),
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
      const assetRows = viewAssets();
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
              ? {
                  id,
                  name: a.name,
                  severity: a.severity ?? null,
                  openIssues: a.openIssues ?? 0,
                  openFindings: a.openFindings ?? 0,
                }
              : { id, name: id, severity: null, openIssues: 0, openFindings: 0 };
          }),
        })),
        totalOpen: issues.length,
      };
    }),
  );
}

// -------------------------------------------------------------------------- problems

interface ProblemsModel {
  /** Ranked once, by `compareProblems` — never re-sorted per request. */
  rows: ProblemRow[];
  /** Problems by Wiz severity, the register's own filter dimension. */
  severityCounts: Record<string, number>;
}

/**
 * The Priorities page's whole population: every unresolved issue and every open finding,
 * one row each, ranked. Cached per data version like `assetsModel` / `configModel` — the
 * join against every asset (for posture tier and amplification) reads the whole assets
 * tab and must not run per keystroke, and the ranking itself is O(n log n) over the same
 * population on every call otherwise.
 */
function problemsModel(): ProblemsModel {
  const assetsById = new Map(viewAssets().map((a) => [a.id, a]));
  // Populations and join scoped together. Handing `buildProblemRows` the whole register
  // against a filtered `assetsById` would keep every row and merely un-enrich the ones out
  // of view — rows missing their posture tier rather than rows correctly absent.
  const rows = rankProblems(buildProblemRows(viewIssues(), viewFindings(), assetsById));
  const severityCounts: Record<string, number> = {};
  for (const sev of SEVERITY_ORDER) severityCounts[sev] = 0;
  for (const r of rows) {
    const sev = String(r.severity ?? "");
    if (sev) severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
  }
  return { rows, severityCounts };
}

/**
 * A graph node as the canvas receives it: the whole node, minus the derived verdicts.
 *
 * The graph ships `GNode`s straight out of the projection rather than through `assetRow`,
 * which is why stripping `assetRow` did not reach it — the canvas needs geometry-adjacent
 * fields the table projection drops, so it was never routed through one. Everything else
 * survives; only the six model fields go.
 *
 * `aarsInput` matters most here and is the least obvious: it is the whole priced input
 * blob, gaps and all, and it rode in every graph payload for every node.
 */
function publicNode(n: Rec): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(n)) {
    if (VERDICT_NODE_KEYS.indexOf(k) >= 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The per-node model fields — the ones that EXIST, which is why this list is shorter than
 * test/verdictIsolation.test.ts's. That one is a prohibition and may name a field nothing
 * computes (`aarsPercentile`); this one is a strip, and listing a field no node carries
 * would only obscure which ones it really has to remove.
 *
 * The difference is load-bearing rather than pedantic: if a percentile were reintroduced,
 * omitting it here lets it reach a payload, where the guard fails loudly and names it.
 * Listing it here would strip it silently and leave the reintroduction unremarked.
 */
const VERDICT_NODE_KEYS = [
  "aars", "aarsSeverity", "aarsPillars", "aarsInput", "aarsRuleVersion",
  "postureTier", "postureInput", "worstOpenProblem",
];

/** The per-problem model fields, on an issue or a finding row. */
const VERDICT_ROW_KEYS = ["problemOutcome", "problemInput"];

/**
 * An issue or finding row as a page receives it — same rule as `publicNode`, at the row
 * grain. The problem tree decides a verdict for every one of these and stores it beside
 * the row; the registers rank by Wiz's severity, and the verdict reaches the workbench's
 * preview alone.
 */
function publicRow<T extends Rec>(r: T): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(r)) {
    if (VERDICT_ROW_KEYS.indexOf(k) >= 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * A problem row as the page receives it: everything the register renders, and none of the
 * problem model's own fields.
 *
 * `ProblemRow` keeps `problemOutcome`, `vector`, `unknowns`, `postureTier` and
 * `amplification` because the workbench's rule preview reads them — it is measuring the
 * model, which is exactly the surface the model belongs on. Shipping them here would put
 * a verdict about one problem in front of a reader who cannot see the rule that produced
 * it, which is the thing this whole change exists to stop.
 */
function publicProblemRow(r: ProblemRow): Rec {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    assetId: r.assetId,
    assetName: r.assetName,
    // An explicit allow-list, so a field not named here never reaches the page.
    domain: r.domain,
    severity: r.severity,
    dueAt: r.dueAt,
    firstSeenAt: r.firstSeenAt ?? null,
    ruleId: r.ruleId,
    ruleShortId: r.ruleShortId,
    ruleRemediation: r.ruleRemediation,
    businessImpact: r.businessImpact,
    iac: r.iac,
    ignored: r.ignored,
  };
}

/**
 * The landscape-wide Priorities: issues ∪ findings, ranked together — the thing neither
 * Toxic Combinations (issues scoped to one pattern) nor Cloud Configuration (findings
 * only) can answer. Same two-mode shape `getAssets` / `getConfigFindings` keep: under
 * `PROBLEMS_CLIENT_ALL_MAX` the browser gets every row, already ranked, and filters and
 * pages locally — the shape `pages/combos.js`'s issue table already uses for one group,
 * copied here for the whole union; over it the outcome filter and paging happen here.
 *
 * `total` is always the WHOLE union regardless of mode or filter, so a caller can check
 * the invariant `problems.ts`'s own header documents: `total` must equal
 * `issues.filter(isUnresolvedIssue).length + findings.filter(isOpenGap).length` exactly.
 */
export function getProblems(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    // `severity`, where this used to take `outcome`. The register filters on Wiz's own
    // rating now; the decision cascade that produced the outcomes is experimental and
    // lives on the Scoring Models page. An `?outcome=` link resolves to no filter rather
    // than to a severity of the same name — the two vocabularies do not overlap, and
    // guessing which queue a reader meant would answer a question they did not ask.
    const severity = String(params["severity"] ?? "").toUpperCase();
    const validSeverity = (SEVERITY_ORDER as readonly string[]).includes(severity) ? severity : "";
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(params["pageSize"]) || DEFAULT_PAGE_SIZE),
    );
    const page = Math.max(0, Number(params["page"]) || 0);

    const model = cached("problemsModel", null, problemsModel) as ProblemsModel;
    const head = {
      // The union invariant's left-hand side — every unresolved issue and every open
      // finding, regardless of the outcome filter or the mode below.
      total: model.rows.length,
      severityCounts: model.severityCounts,
      pageSize,
    };

    if (model.rows.length <= PROBLEMS_CLIENT_ALL_MAX) {
      return {
        ...head,
        all: true,
        rows: model.rows.map(publicProblemRow),
        filtered: model.rows.length,
        page: 0,
        pageCount: Math.max(1, Math.ceil(model.rows.length / pageSize)),
      };
    }

    // Server-side only, mirroring the severity filter above: under PROBLEMS_CLIENT_ALL_MAX
    // the browser holds every row and filters locally, so this branch is the large-tenant
    // path and the two must agree on what a filter means.
    const domain = String(params["domain"] ?? "");
    let filtered = validSeverity
      ? model.rows.filter((r) => String(r.severity ?? "") === validSeverity)
      : model.rows;
    if (domain) filtered = filtered.filter((r) => (r.domain ?? "") === domain);
    const paged = pageOf(filtered as unknown as Rec[], page, pageSize);
    return {
      ...head,
      all: false,
      rows: (paged.rows as unknown as ProblemRow[]).map(publicProblemRow),
      filtered: filtered.length,
      page: paged.page,
      pageCount: paged.pageCount,
    };
  });
}

// ------------------------------------------------------------------------------ actions

/**
 * Rank remediation ACTIONS rather than problems — P1a, built directly on `problemsModel`
 * so this endpoint's population is provably the SAME union `getProblems` reports, never a
 * second derivation that could quietly drift from it (this file's own rule for every
 * cached model). The ranking itself is the marginal set-cover `actions.ts`'s own header
 * argues for, over the WHOLE union regardless of `limit` — a caller asking for the top 10
 * gets the true top 10, computed against every open problem, not against a pre-trimmed
 * slice of them.
 *
 * `total` is the count of DISTINCT ACTIONS the whole landscape collapses to; `totalProblems`
 * is the union total `getProblems.total` already reports — the same "N problems collapse
 * to M actions" pair PRODUCT.md's own headline names. `curve` and `concentration` are
 * always computed over the FULL ranked list, never the `limit`-truncated `rows` a caller
 * asked to see, so trimming the display never moves the headline number beside it.
 */
export function getActions(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const limitParam = Number(params["limit"]);
    const limit = Number.isFinite(limitParam) && limitParam >= 0 ? Math.floor(limitParam) : undefined;

    const model = cached("problemsModel", null, problemsModel) as ProblemsModel;
    const fullyRanked = withAutoRemediation(
      rankActionsByCover(model.rows),
      syncStore.loadFrameworkPolicies(),
    );

    return {
      rows: limit !== undefined ? fullyRanked.slice(0, limit) : fullyRanked,
      total: fullyRanked.length,
      totalProblems: model.rows.length,
      curve: coverCurve(fullyRanked, model.rows.length),
      concentration: concentrationRatio(fullyRanked, model.rows.length),
    };
  });
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
    // Rows each step returned on the last committed sync. A THIRD reading, and the only one
    // that can say "this step ran and matched nothing" — the two lists above record refusals
    // and page caps, and a zero-yield step is neither. An id absent here means not recorded
    // (a deployment that last synced before this shipped), which the client must not render
    // as 0. See settingsLogic.getStepRows.
    stepRows: settingsStore.getStepRows(),
    // Why each skipped step was skipped — Wiz's own message. `skippedSteps` says WHICH, this
    // says WHAT the tenant objected to, and only the second is actionable. A step id in the
    // skip list with no entry here was skipped before this was recorded; the client must render
    // that as "no reason recorded", never as an empty explanation.
    skipReasons: settingsStore.getSkipReasons(),
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

/**
 * Send one page for a step with its CONFIGURED variables and report what came back — the same
 * probe `testScanVars` runs, without the editable-variables gate.
 *
 * That gate is `isEditableStep`, i.e. `spec.fields.length > 0` (domain/scanVars.ts), and it is
 * the right guard for the operation it was written for: proposing new variable values only
 * makes sense on a step that declares editable ones. It is the wrong guard for asking a step
 * whether it works, and the two shared one door.
 *
 * The cost of that conflation showed up on a live tenant with 13,932 assets and ZERO rows on
 * `ai_edges`. The six steps that produce persisted edges — RUNS_AS, SA_FINDINGS,
 * SENSITIVE_DATA_ACCESS, HOST_EXPOSURE, ENDPOINT_EXPOSURE, IDENTITY_ACCESS — all declare
 * `fields: []`, so every one of them was un-probeable, and `testScanVars`'s own header describes
 * precisely the failure they were exhibiting: an optional step swallows an HTTP 400, so a filter
 * the tenant rejects looks exactly like a tenant with nothing to report. The instrument existed
 * and could not be aimed at the problem.
 *
 * NOT `cached()`, unlike most of this file. A probe whose answer can be an hour old answers a
 * question nobody asked; the whole point is what the tenant says right now.
 */
export function probeSyncStep(p?: unknown): ApiResult {
  return run(() => {
    const stepId = String(((p ?? {}) as Rec)["stepId"] ?? "");
    if (!stepId) throw new Error("A step id is required.");
    if (!hasWizCredentials()) {
      throw new Error(
        "A probe calls Wiz, and no credentials are configured — this deployment is in " +
        "dry-run. Add credentials in Settings to probe a step against the tenant.",
      );
    }
    // `null` vars, so the probe sends exactly what the battery sends: stored overrides laid
    // over the step's own defaults (testStepVariables resolves both). A probe that sent
    // something else would answer about a query the sync does not run.
    return syncJobs.testStepVariables(stepId, null);
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
    // Not validated against the catalogue. A project the register does not hold filters to
    // nothing, which is the honest answer for that project, and rejecting it here would
    // strand anyone whose stored view fell out of scope after a re-sync — they could not
    // clear it, because clearing is a write too.
    if (params["projectView"] !== undefined) settingsStore.setProjectView(params["projectView"]);
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
      projectView: settingsStore.getProjectView(),
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
    // How many assets sit at each rule version. One entry is the ordinary state; more than
    // one means a scoped rescore left the register holding scores from two rules, and those
    // are not on the same scale — the same reason sync_history stamps every distribution
    // with the version that produced it. The page has to be able to say so, because a
    // percentile or a band count drawn across a mixed register compares two different
    // measurements. A sync, or a rescore with no project selected, collapses it back to one.
    versionSpread: syncStore.aarsVersionSpread(),
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

    // Whole register, not viewAssets(): a rule preview answers "what would this change?",
    // and scoring is tenant-wide whatever the sidebar is looking at. Scoping it here would
    // report a blast radius smaller than the one the rule actually has.
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
      // How well the draft separates the landscape — the number the band counts above cannot
      // show, because a rule that gives every asset the same score still fills a band.
      discrimination: ruleDiscrimination(after, proposed),
      // Coverage: how many gap instances each cascade row priced, what fell through to the
      // fallback, and the codes the landscape carries. A row at 0 here is NOT the same claim
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

    // Issues held separately as well as in the union: the census below is over issues
    // alone, because `aiVerdict` and `comboGroup` are issue vocabulary and a FindingRow
    // carries neither. Passing the union would typecheck only behind a cast and would say
    // something untrue about where the values come from. `ruleIds` rides the same call and
    // is issues-only for a DIFFERENT reason — a finding prices through the same rule table
    // on `ruleShortId` — which `problemCensus`'s own header states in full.
    // Whole register, like the AARS preview above — a rule preview answers "what would
    // this change?", and the answer does not depend on what the sidebar is looking at.
    const beforeIssues = syncStore.loadIssues();
    const beforeAll: Array<IssueRow | FindingRow> = [...beforeIssues, ...syncStore.loadFindings()];
    const beforeById = new Map(beforeAll.map((r) => [r.id, r.problemOutcome]));

    const after = syncStore.decideProblemsWith(proposed);
    const afterAll: Array<IssueRow | FindingRow> = [...after.issues, ...after.findings];

    const rank = (o: string | undefined): number => {
      const i = o ? (OUTCOME_VALUES as readonly string[]).indexOf(o) : -1;
      return i < 0 ? OUTCOME_VALUES.length : i;
    };

    // `decided` never reaches the browser. It is one object per decided issue and finding,
    // and the page wanted exactly two things from it: how many there were, and four small
    // per-axis histograms. Both are computed here now (`decidedCount`, `axisReadings`), so
    // this response no longer grows with the register. That growth is not hypothetical —
    // it is the shape of the size ceiling `readGrid` had to start blocking around, and it
    // fails the same silent way: `run()` catches it, the execution logs COMPLETED, and the
    // page can only say "not measured yet".
    const { decided, ...discrimination } = treeDiscrimination(decidedForDiscrimination(afterAll));

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
      treeDiscrimination: { ...discrimination, decidedCount: decided.length },
      // What the landscape actually carries on the two axes an operator names values for.
      // Costs nothing extra: `beforeAll` is already loaded above, the same argument
      // `gapCensus` makes for itself on the AARS preview. It rides THIS endpoint and never
      // getProblemRule for the same two reasons that one gives — opening the rules page must
      // not trigger a pass over the register, and the load endpoint's shape is pinned.
      census: problemCensus(beforeIssues),
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
 * whichever nodes a preview actually derived a vector for. Mirrors `decidedForDiscrimination`
 * (the problem-rule preview's identical filter) — a node with no `postureInput` (never
 * folded, or a synthetic node the fold skipped) is excluded rather than guessed at.
 *
 * A node IS included with `tier: undefined` when it carries `postureInput` but no
 * `postureTier` — `posture.tierEstablished` refused to place it (see that function's own
 * header) — rather than being dropped the way the old admission test dropped it. Dropping
 * it here would silently remove exactly the population this whole change exists to
 * surface: `postureDiscrimination.unknownRate.tier` (postureRule.ts) has nothing to count
 * if this filter throws its numerator away before that function ever sees it.
 */
function decidedForPostureDiscrimination(
  nodes: ReadonlyArray<{ postureTier?: number; postureInput?: { capability: string; containment: string; consequence: string; unknowns?: string[] } }>,
): Array<{ tier: Tier | undefined; vector: PostureVector; unknowns: string[] }> {
  const out: Array<{ tier: Tier | undefined; vector: PostureVector; unknowns: string[] }> = [];
  for (const node of nodes) {
    const input = node.postureInput;
    if (!input) continue;
    const tier = (TIER_VALUES as readonly number[]).includes(node.postureTier as number)
      ? (node.postureTier as Tier)
      : undefined;
    out.push({
      tier,
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

    // Whole register, not viewAssets(): a rule preview answers "what would this change?",
    // and scoring is tenant-wide whatever the sidebar is looking at. Scoping it here would
    // report a blast radius smaller than the one the rule actually has.
    const before = syncStore.loadAssets();
    const beforeById = new Map(before.map((n) => [n.id, n.postureTier]));

    const after = syncStore.posturesWith(proposed);

    // Same trim as the problem preview above, and for the same reason — this side never
    // read `decided` for anything but its length.
    const { decided, ...discrimination } = postureDiscrimination(decidedForPostureDiscrimination(after));

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
      postureDiscrimination: { ...discrimination, decidedCount: decided.length },
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

/**
 * Resolve which project a prune is about, and name it from the register's own catalogue.
 *
 * The default is the SYNC scope (WIZ_PROJECT_ID_V2), resolved here rather than sent by the
 * client: the property is the server's to know, and a client-held copy of it would go stale
 * the moment an operator changed it in Project Settings.
 *
 * The name comes from the assets, never from a live Wiz catalogue query. A picker built on
 * the catalogue could offer a project this register was never asked for, and the census
 * behind such a pick reads zero — a zero meaning "nothing here" and a zero meaning "never
 * fetched" look identical and call for opposite reactions.
 */
function pruneTarget(p?: unknown): { id: string; name: string | null } {
  const params = (p ?? {}) as Rec;
  const asked = typeof params["projectId"] === "string" ? String(params["projectId"]).trim() : "";
  const id = asked || projectScope()?.[0] || "";
  if (!id) {
    throw new Error(
      "No project to keep. Pick one, or set WIZ_PROJECT_ID_V2 so the sync scope can be " +
      "the default.");
  }
  const entry = projectCatalogue(syncStore.loadAssets()).find((e) => e.id === id);
  return { id, name: entry ? entry.name : null };
}

/**
 * What pruning to a project WOULD do. Reads only, takes no lock.
 *
 * Mandatory before the real thing, and the panel enforces it. This is an irreversible
 * deletion measured in tens of thousands of rows, and the difference between a folder id and
 * one of its leaves is several orders of magnitude of register — visible in this census and
 * in nothing else the operator can see beforehand.
 */
export function previewPrune(p?: unknown): ApiResult {
  return run(() => {
    const target = pruneTarget(p);
    return { ...target, ...syncStore.pruneToProject(target.id, { dryRun: true }) };
  });
}

/** Delete everything outside one project. Irreversible; the panel confirms first. */
export function pruneToProject(p?: unknown): ApiResult {
  return mutate(() => {
    const target = pruneTarget(p);
    const res = syncStore.pruneToProject(target.id, { dryRun: false });
    const removed = res.census.total - res.census.keep;
    return {
      ...target,
      ...res,
      message: `Removed ${removed} of ${res.census.total} assets and everything attached ` +
        `to them. ${res.census.keep} kept.`,
    };
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
