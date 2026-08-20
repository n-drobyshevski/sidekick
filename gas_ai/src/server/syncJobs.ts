// Sync orchestration. Dry-run (no credentials) persists the seed graph synchronously;
// live mode walks a battery of Wiz queries (inventory → per-rule issues → guardrail
// gaps → execution identity → CIEM findings → human identity) as a resumable job:
// each execution runs under a wall-clock budget, spills its normalized progress to
// Drive, and schedules a one-shot continuation trigger when the budget expires.
// At the documented tenant scale (~71 agents) the whole battery is ~10–20 UrlFetchApp
// calls and normally finishes in the first hop — resumability is insurance.
//
// Cancellation is lock-free: cancelSync writes a Script Property flag the battery
// polls between pages.

import {
  emptyPart,
  appendPart,
  mergeParts,
  FilterNotHonouredError,
  normalizeConfigFindingsPage,
  normalizeConfigRulesPage,
  normalizeEffectiveAccessPage,
  normalizeEndpointExposurePage,
  normalizeIdentityFindingsPage,
  normalizeHostExposurePage,
  normalizeIdentityAccessPage,
  normalizeLineagePage,
  normalizeInventoryPage,
  normalizeIssuesPage,
  frameworkCodeLookup,
  normalizeCompliancePosturePage,
  normalizeFrameworksPage,
  normalizeNoGuardrailPage,
  normalizePrincipalsPage,
  normalizeRuleAssetsPage,
  normalizeRunsAsPage,
  normalizeSensitiveDataAccessPage,
  partIsEmpty,
  reconcileIssues,
  withFrameworkCodes,
  type NormalizedPart,
} from "../domain/syncNormalize";
import { buildAarsHintsFromFindings } from "../domain/graphEnrich";
import { resolveHygieneRules } from "../domain/identityHygiene";
import { changedPaths, effectiveStepVars, isEditableStep } from "../domain/scanVars";
import { COMBO_GROUPS } from "../domain/toxicCombos";
import { nowIso, type Rec } from "../domain/util";
import { readGzJsonFile, syncFolder, writeGzJson, writeSyncPage } from "./archiveStore";
import { activeJob, createJob, getJob, newJobId, updateJob, type JobRow } from "./jobsStore";
import { withScriptLock } from "./locks";
import { getProp, hasWizCredentials, projectScope, setProp, deleteProp } from "./props";
import {
  seedGraphDoc, SEED_AARS_HINTS, SEED_CONFIG_RULES, SEED_DATA_FINDINGS, SEED_EFFECTIVE_ACCESS,
  SEED_FINDINGS, SEED_FRAMEWORK_POLICIES, SEED_FRAMEWORKS, SEED_IDENTITY_FINDINGS, SEED_ISSUES,
  SEED_POSTURE, SEED_TREND,
} from "./sampleData";
import * as settingsStore from "./settingsStore";
import { appendRows, dataRowCount, TABS } from "./sheetsDb";
import { loadConfigRules, loadFrameworks, parseJson, persistSync } from "./syncStore";
import {
  fetchCloudResourcesPage,
  fetchConnectionPage,
  fetchGraphSearchPage,
  fetchSingleObject,
  resolveAiResourceTypes,
  type FetchOptions,
  type PageResult,
} from "./wizClientAi";
import {
  AI_RESOURCE_TYPE_CANDIDATES,
  aiConfigFindingsVariables,
  aiInventoryVariables,
  aiPropertiesVariables,
  aiIssuesVariables,
  aiPrincipalsVariables,
  aiIdentityHygieneVariables,
  effectiveAccessVariables,
  endpointExposureVariables,
  agentRunsAsVariables,
  hostExposureVariables,
  identityAccessVariables,
  lineageVariables,
  noGuardrailVariables,
  saExcessiveAccessVariables,
  sensitiveDataAccessVariables,
  MAX_PAGES,
  PAGE_SIZE,
  PAGE_SIZE_TRAVERSAL,
  PAGE_SIZE_WIDE,
  Q_AGENT_RUNS_AS,
  Q_AI_EXPOSURE,
  Q_CONFIG_RULES,
  Q_EFFECTIVE_ACCESS,
  Q_AGENT_SENSITIVE_DATA_ACCESS,
  Q_AGENTS_NO_GUARDRAIL,
  Q_AI_INVENTORY,
  Q_CONFIG_FINDINGS,
  Q_IDENTITY_ACCESS,
  Q_LINEAGE,
  Q_ISSUES,
  Q_COMPLIANCE_POSTURE,
  Q_AI_PROPERTIES,
  Q_PRINCIPALS,
  Q_RULE_ASSETS,
  Q_SA_EXCESSIVE_ACCESS,
  Q_SECURITY_FRAMEWORKS,
  aiCompliancePostureVariables,
  aiSecurityFrameworksVariables,
} from "./wizQueriesAi";

export interface StartResult {
  jobId: string | null;
  message: string;
}

const CANCEL_PROP = "CANCEL_SYNC_JOB_ID";
const CONTINUE_HANDLER = "trigger_continueSync";
const CONTINUE_DELAY_MS = 30_000;
// Wall-clock budgets: keep the "Sync now" RPC snappy, then use most of the 6-minute
// execution ceiling on trigger hops.
const FIRST_STEP_BUDGET_MS = 45_000;
const BUDGET_MS = 270_000;
// How often the page loop writes its position back to the jobs tab. Well under the client's
// STALL_MS (src/client/js/syncProgress.js, 15 s), because `updated_at` is what tells the sync
// card the job is alive — a longer gap makes it report "Waiting for next step…" mid-fetch.
const CHECKPOINT_MS = 8_000;

/**
 * How much of a rejection message is kept per step.
 *
 * Deliberately shorter than wizClientAi's own ERROR_BODY_MAX (800): that cap bounds ONE error
 * body headed for a log line, while this bounds a map of them headed for a settings cell that
 * also has to survive JSON.stringify into params_json on every checkpoint write. A GraphQL
 * validation error names the offending token in its first clause, so the head is the part
 * worth keeping.
 */
const SKIP_REASON_MAX = 400;

interface SyncStepDef {
  id: string;
  // The Wiz Scans area this step feeds, and the ledger it writes. Metadata rather than a
  // parallel table elsewhere: a step and its provenance drift apart the moment they are
  // two lists, and the Scans page states this provenance to the operator as fact.
  area: string;
  writes: string[];
  // "single" is the odd one out: a root that returns ONE OBJECT rather than a connection
  // (securityFramework(id:)). It exists because readConnection on a non-connection does
  // not throw — it returns rows:[] — and on an optional step that is indistinguishable
  // from a tenant with nothing to report. See wizClientAi.fetchSingleObject.
  run: "cloudResources" | "graphSearch" | "connection" | "single";
  // For run:"connection" — the top-level connection field to read (issuesV2,
  // configurationFindings). For run:"single" — the object field (securityFramework).
  // Ignored for the other run modes.
  connectionField?: string;
  query: string;
  extraVariables?: Rec;
  normalize: (rows: Rec[]) => NormalizedPart;
  // Optional steps are enhancements (relationships, findings): when THIS
  // tenant's schema rejects their query (HTTP 400 validation), the step is
  // skipped and recorded instead of failing the whole sync. The inventory
  // step is the core dataset and stays fatal.
  optional?: boolean;
  // Rows per page for THIS step, when the default is leaving calls on the table.
  //
  // Opt-in rather than a raised default, because the right page size is a property of the
  // DOCUMENT, not of the battery: a step selecting twenty flat scalars and a step spreading
  // three ten-wide nested sub-connections per entity do not want the same number. Set it to
  // PAGE_SIZE_WIDE only where the selection set is provably narrow — the wide documents and
  // the interactive reader in api.ts both keep PAGE_SIZE.
  pageSize?: number;
}

/**
 * The battery, built per run: the inventory query embeds the AI resource
 * types resolved against this tenant's schema (introspection ∩ candidates,
 * or the WIZ_AI_RESOURCE_TYPES override) — see resolveAiResourceTypes.
 */
function syncSteps(aiTypes?: readonly string[]): SyncStepDef[] {
  // Resolved against the tenant by default, which needs credentials and is what a real sync
  // must do. `aiTypes` is for DESCRIBING the battery without one — never for running it: a
  // sync that quietly substituted a guessed type list would query the wrong landscape and say
  // nothing about it.
  const types = aiTypes ?? resolveAiResourceTypes().types;
  // Resolved against the last sync's catalogue when nothing has been chosen yet, so a
  // tenant whose framework ids differ from the shipped defaults still collects the right
  // three on its second sync rather than never.
  const frameworkIds = settingsStore.getSelectedFrameworks(() => loadFrameworks());
  // Stored per-step overrides, laid over each builder's variables by path. Read once so a
  // battery of twelve steps costs one settings read, not twelve.
  const overrides = settingsStore.getScanVars();
  const vars = (stepId: string, base: Rec): Rec =>
    effectiveStepVars(stepId, base, overrides[stepId]);
  // Read once for the same reason `overrides` is: a battery of a dozen steps should cost
  // one settings read, not one per step.
  const selectedFrameworks = (): string[] => frameworkIds;
  // The rule catalogue, and the two things read off it. Resolved HERE rather than inside the
  // step so that describeSyncSteps and the battery see the same answer, and so a first sync —
  // where the catalogue is empty and the matchers resolve nothing — simply omits the hygiene
  // step instead of sending a filter with an empty id list.
  const catalogue = loadConfigRules();
  const catalogueFresh = settingsStore.configRulesAreFresh(catalogue.length > 0, Date.now());
  const hygieneRules = resolveHygieneRules(catalogue);

  return [
    {
      id: "INVENTORY_AI",
      area: "aispm",
      writes: ["ai_assets"],
      run: "cloudResources",
      query: Q_AI_INVENTORY,
      extraVariables: vars("INVENTORY_AI", aiInventoryVariables(types)),
      normalize: normalizeInventoryPage,
      pageSize: PAGE_SIZE_WIDE,
    },
    // One cursor walk per toxic-combination source rule: the assets carrying an OPEN
    // issue for that rule (issue rows are reconstructed one-per-asset).
    ...COMBO_GROUPS.map((group): SyncStepDef => ({
      id: `ISSUES_${group.ruleId}`,
      area: "toxic",
      writes: ["ai_assets", "ai_issues"],
      run: "cloudResources",
      query: Q_RULE_ASSETS,
      extraVariables: { ruleIds: [group.ruleId] },
      normalize: (rows) => normalizeRuleAssetsPage(rows, group),
      optional: true,
      pageSize: PAGE_SIZE_WIDE,
    })),
    // Real toxic-combination issues (issuesV2). Runs alongside the per-rule steps
    // above; reconcileIssues drops the synthetic per-rule rows these supersede.
    {
      id: "ISSUES_TOXIC",
      area: "toxic",
      writes: ["ai_issues", "ai_assets"],
      run: "connection",
      connectionField: "issuesV2",
      query: Q_ISSUES,
      extraVariables: vars("ISSUES_TOXIC", aiIssuesVariables(projectScope()) as Rec),
      normalize: normalizeIssuesPage,
      optional: true,
    },
    // Real compliance findings (configurationFindings) — feeds AARS pillar B.
    {
      id: "CONFIG_FINDINGS",
      area: "configFindings",
      writes: ["ai_findings"],
      run: "connection",
      connectionField: "configurationFindings",
      query: Q_CONFIG_FINDINGS,
      extraVariables: vars("CONFIG_FINDINGS", aiConfigFindingsVariables(projectScope()) as Rec),
      normalize: normalizeConfigFindingsPage,
      optional: true,
    },
    // Wiz's cloud-configuration RULE CATALOGUE — reference data, and the only step here whose
    // contents describe the product rather than the landscape. It is what glosses an opaque
    // `SUB-082` in the AARS cascade, and what the identity-hygiene matchers resolve against
    // instead of hardcoding MFA rule ids that differ per cloud.
    //
    // GATED, not unconditional. ~3,858 rules is ~39 pages against a battery that is otherwise
    // ~10–20 calls, to re-collect a list that changes when Wiz ships rules. `catalogueFresh`
    // is resolved once, above, and a skip here is recorded as SCHEDULED rather than joining
    // `skippedSteps` — that list means "the tenant refused this", and a step we chose not to
    // run must not be reported as a rejection.
    ...(catalogueFresh ? [] : [{
      id: "CONFIG_RULES",
      area: "configFindings",
      writes: ["ai_config_rules"],
      run: "connection" as const,
      connectionField: "cloudConfigurationRules",
      query: Q_CONFIG_RULES,
      normalize: normalizeConfigRulesPage,
      optional: true,
      // The big one: ~3,858 rules is 39 pages at PAGE_SIZE and 8 at PAGE_SIZE_WIDE, and
      // the document is five flat scalars per node.
      pageSize: PAGE_SIZE_WIDE,
    }]),
    // MFA and dormancy on the humans who can reach an AI asset. The rules come from the
    // catalogue, matched by name (domain/identityHygiene.ts), so this step exists only once
    // the catalogue has been collected at least once — on a first sync it resolves to nothing
    // and is skipped, and the following sync has it.
    ...(hygieneRules.ids.length ? [{
      id: "IDENTITY_HYGIENE",
      area: "identity",
      writes: ["ai_identity_findings"],
      run: "connection" as const,
      connectionField: "configurationFindings",
      query: Q_CONFIG_FINDINGS,
      extraVariables: aiIdentityHygieneVariables(hygieneRules.ids, projectScope()) as Rec,
      // Closed over the resolved map, the way the per-rule combo steps close over their group.
      // It is also what lets the normalizer verify the filter was honoured at all.
      normalize: (rows: Rec[]) => normalizeIdentityFindingsPage(rows, hygieneRules.byId),
      optional: true,
    }] : []),
    // Effective permissions on those same assets: not who holds a role, but what they can do
    // and which policy says so. Runs BESIDE IDENTITY_ACCESS rather than replacing it — that
    // step draws the graph's ALLOWS_ACCESS_TO edges and speaks ADMIN/HIGH_PRIVILEGE, this one
    // speaks DATA, and withHumanAccess keeps the two in separate fields.
    {
      id: "EFFECTIVE_ACCESS",
      area: "identity",
      writes: ["ai_assets (human_access_json)"],
      run: "connection",
      connectionField: "entityEffectiveAccessEntries",
      query: Q_EFFECTIVE_ACCESS,
      extraVariables: effectiveAccessVariables(types, projectScope()),
      normalize: normalizeEffectiveAccessPage,
      optional: true,
      pageSize: PAGE_SIZE_WIDE,
    },
    // The framework catalogue. Populates the Settings picker; it does NOT decide the
    // battery — see the posture steps below for why.
    //
    // `area` is the posture one, not the configuration-findings one. The tag is what the
    // Wiz Scans drill-down filters on (scanSheet.js), so it decides which area DISPLAYS
    // this document — it is a join key, not a label. Both this step and the posture steps
    // below spent a release tagged "compliance", which left the posture area rendering
    // "No sync step issues a query for this area" beside its own live figure. Pinned by
    // test/scanAreaSteps.test.ts.
    {
      id: "FRAMEWORKS_LIST",
      area: "posture",
      writes: ["ai_frameworks"],
      run: "connection",
      connectionField: "securityFrameworks",
      query: Q_SECURITY_FRAMEWORKS,
      extraVariables: vars("FRAMEWORKS_LIST", aiSecurityFrameworksVariables() as Rec),
      normalize: normalizeFrameworksPage,
      optional: true,
      pageSize: PAGE_SIZE_WIDE,
    },
    // Per-framework compliance posture — ONE STEP PER FRAMEWORK, because the query takes a
    // framework id and returns one object. Generated the same way the per-rule combo steps
    // above are, so the budget/resume machinery needs no special case.
    //
    // Driven by the SELECTION, not by the catalogue: posture costs a round trip per
    // framework and a tenant can carry a hundred builtin ones this app has no vocabulary
    // for. Each step is optional, so a framework id that is wrong on this tenant costs a
    // recorded skip rather than a failed sync.
    ...selectedFrameworks().map((frameworkId): SyncStepDef => ({
      id: `COMPLIANCE_POSTURE_${frameworkId}`,
      area: "posture",
      writes: ["ai_framework_posture", "ai_framework_policies"],
      run: "single",
      connectionField: "securityFramework",
      query: Q_COMPLIANCE_POSTURE,
      // No `vars()` indirection here on purpose: these steps are LOCKED. Overrides are
      // stored per step id, and every posture step has its own (`COMPLIANCE_POSTURE_<id>`),
      // so reading them under a shared "COMPLIANCE_POSTURE" key would be an override slot
      // nothing can ever write to — dead indirection that reads like a feature.
      //
      // They are locked because the framework id is not a filter. The existing rule is that
      // a variable may narrow a selection set but never change it; an id that selects WHICH
      // OBJECT the selection set is applied to is further outside that line, not inside it.
      // Choosing frameworks is Settings' job.
      extraVariables: {
        ...(aiCompliancePostureVariables(projectScope()) as Rec),
        id: frameworkId,
      },
      normalize: normalizeCompliancePosturePage,
      optional: true,
    })),
    {
      id: "GUARDRAIL_GAPS",
      area: "guardrails",
      writes: ["ai_assets.guardrail_missing"],
      run: "graphSearch",
      query: Q_AGENTS_NO_GUARDRAIL,
      // `null`, not projectScope(): these four have always run tenant-wide, and this change is
      // about the query's SHAPE. See agentPathVariables in wizQueriesAi.ts.
      extraVariables: noGuardrailVariables(types, null),
      normalize: normalizeNoGuardrailPage,
      optional: true,
      pageSize: PAGE_SIZE_TRAVERSAL,
    },
    {
      id: "RUNS_AS",
      area: "ciem",
      writes: ["ai_edges (RUNS_AS)", "ai_assets"],
      run: "graphSearch",
      query: Q_AGENT_RUNS_AS,
      extraVariables: agentRunsAsVariables(types, null),
      normalize: normalizeRunsAsPage,
      optional: true,
      pageSize: PAGE_SIZE_TRAVERSAL,
    },
    {
      id: "SA_FINDINGS",
      area: "ciem",
      writes: ["ai_edges (HAS_FINDING)", "ai_assets"],
      run: "graphSearch",
      query: Q_SA_EXCESSIVE_ACCESS,
      extraVariables: saExcessiveAccessVariables(types, null),
      normalize: normalizeRunsAsPage,
      optional: true,
      pageSize: PAGE_SIZE_TRAVERSAL,
    },
    // The data-exposure chain. Runs AFTER the two CIEM steps on purpose: it re-emits the
    // agent and its service account, and mergeParts lets later truthy values win field-wise,
    // so landing the richer CIEM projections first means this step can only add to them.
    {
      id: "SENSITIVE_DATA_ACCESS",
      area: "dspm",
      writes: [
        "ai_edges (RUNS_AS, ALLOWS_ACCESS_TO)",
        "ai_assets (BUCKET/DATABASE rows, data_finding_count)",
        "ai_data_findings",
      ],
      run: "graphSearch",
      query: Q_AGENT_SENSITIVE_DATA_ACCESS,
      extraVariables: sensitiveDataAccessVariables(types, null),
      normalize: normalizeSensitiveDataAccessPage,
      optional: true,
      pageSize: PAGE_SIZE_TRAVERSAL,
    },
    // Network exposure, in two steps because they are two claims. HOST_EXPOSURE says the
    // compute under an AI asset is reachable; ENDPOINT_EXPOSURE says Wiz's scanner reached a
    // live endpoint it serves and policy rates that a real exposure. The capture proves they
    // can disagree — a Cloud Run revision that is openToAllInternet, serving endpoints rated
    // Low because they redirect to SSO. See domain/exposureQuery.ts.
    //
    // Both run AFTER the CIEM and DSPM steps for the reason SENSITIVE_DATA_ACCESS gives:
    // they re-emit the AI asset as a thin projection, and mergeParts lets later truthy
    // values win field-wise, so landing the richer projections first means these can only
    // add to them.
    {
      id: "HOST_EXPOSURE",
      area: "exposure",
      writes: [
        "ai_edges (HOSTED_ON, SERVES)",
        "ai_assets (VM/SERVERLESS + ENDPOINT rows, exposure_evidence_json)",
      ],
      run: "graphSearch",
      query: Q_AI_EXPOSURE,
      extraVariables: hostExposureVariables(types, projectScope()),
      normalize: normalizeHostExposurePage,
      optional: true,
    },
    {
      id: "ENDPOINT_EXPOSURE",
      area: "exposure",
      writes: ["ai_edges (SERVES)", "ai_assets (ENDPOINT rows, exposure_level, port_validation)"],
      run: "graphSearch",
      query: Q_AI_EXPOSURE,
      extraVariables: endpointExposureVariables(types, projectScope()),
      normalize: normalizeEndpointExposurePage,
      optional: true,
    },
    {
      // The lineage step: the first traversal rooted at anything but AI_AGENT or the whole
      // AI type list. AI_PIPELINE + AI_DATASET are 79% of the register and no query has ever
      // stood at one. `null`, not `projectScope()`: scoping it would cap the population at
      // one project while the inventory that found the pipelines is tenant-wide, so a low
      // Enriched number would be built in rather than measured. See domain/lineageQuery.ts.
      id: "LINEAGE",
      area: "dspm",
      writes: [
        "ai_edges (PRODUCES, READS_DATA_FROM, STORES_DATA_IN)",
        "ai_assets (AI_MODEL/AI_SERVICE/AI_DATASET/BUCKET/DATABASE rows)",
      ],
      run: "graphSearch",
      query: Q_LINEAGE,
      extraVariables: lineageVariables(types, null),
      normalize: normalizeLineagePage,
      optional: true,
      pageSize: PAGE_SIZE_TRAVERSAL,
    },
    {
      id: "IDENTITY_ACCESS",
      area: "identity",
      writes: [
        "ai_edges (ALLOWS_ACCESS_TO)",
        "ai_assets (USER_ACCOUNT/ACCESS_ROLE rows, inactive, human_access_json)",
      ],
      run: "graphSearch",
      query: Q_IDENTITY_ACCESS,
      extraVariables: identityAccessVariables(types, projectScope()),
      normalize: normalizeIdentityAccessPage,
      optional: true,
      pageSize: PAGE_SIZE_TRAVERSAL,
    },
    // AI-asset provenance: publisher + how Wiz discovered it. Optional and separate from
    // INVENTORY_AI on purpose — see the note on Q_AI_PROPERTIES. Losing it costs two columns.
    {
      id: "AI_ASSET_PROPERTIES",
      area: "aispm",
      writes: ["ai_assets.publisher", "ai_assets.discovery_methods"],
      run: "cloudResources",
      query: Q_AI_PROPERTIES,
      extraVariables: vars("AI_ASSET_PROPERTIES", aiPropertiesVariables(types) as Rec),
      // The same normalizer the inventory step uses. Safe because mergeParts merges
      // field-wise and skips undefined — this step's narrower rows fill in the two provenance
      // fields without erasing the projects, tags or analytics INVENTORY_AI established.
      normalize: normalizeInventoryPage,
      optional: true,
      pageSize: PAGE_SIZE_WIDE,
    },
    // Agentic execution identities (cloudResourcesV2 + identityPurpose:AGENTIC).
    {
      id: "AGENTIC_IDENTITIES",
      area: "ciem",
      writes: ["ai_assets.identity_purpose"],
      run: "cloudResources",
      query: Q_PRINCIPALS,
      extraVariables: vars("AGENTIC_IDENTITIES", aiPrincipalsVariables(projectScope()) as Rec),
      normalize: normalizePrincipalsPage,
      optional: true,
      pageSize: PAGE_SIZE_WIDE,
    },
  ];
}

/** Steps whose variables embed the tenant-resolved AI resource types. */
const TYPE_DEPENDENT_STEPS: ReadonlySet<string> = new Set([
  "INVENTORY_AI", "AI_ASSET_PROPERTIES", "HOST_EXPOSURE", "ENDPOINT_EXPOSURE", "IDENTITY_ACCESS",
  "EFFECTIVE_ACCESS", "LINEAGE",
  // Widened from the literal AI_AGENT. GUARDRAIL_GAPS widens to the three kinds a guardrail
  // fronts rather than to every AI kind — see GUARDRAIL_SUBJECT_KINDS.
  "GUARDRAIL_GAPS", "RUNS_AS", "SA_FINDINGS", "SENSITIVE_DATA_ACCESS",
]);

/** The connection field a step reads its rows from — the one the response must carry. */
function rootFieldOf(step: SyncStepDef): string {
  if (step.run === "cloudResources") return "cloudResourcesV2";
  if (step.run === "graphSearch") return "graphSearch";
  return step.connectionField ?? "";
}

/** The reader for a step's run mode. One place, so the three dispatch sites cannot drift. */
function fetcherFor(step: SyncStepDef): (o: FetchOptions) => PageResult {
  if (step.run === "graphSearch") return fetchGraphSearchPage;
  if (step.run === "cloudResources") return fetchCloudResourcesPage;
  if (step.run === "single") return (o) => fetchSingleObject(step.connectionField ?? "", o);
  return (o) => fetchConnectionPage(step.connectionField ?? "", o);
}

/**
 * Every step as data: the document it sends, the variables it sends with it, where the
 * answer lands, and whether its variables can be edited. Everything except `normalize`,
 * which is a function and is exactly the thing that cannot cross the wire — and the reason
 * a user-defined step is a much harder problem than a user-edited one.
 *
 * This is what lets the Wiz Scans panel show the EFFECTIVE query rather than a hand-typed
 * label. The label it replaced was prose describing a query, free to drift from it; this
 * cannot drift, because it is the query.
 */
export function describeSyncSteps(): Rec[] {
  const overrides = settingsStore.getScanVars();
  const resolved = describeAiTypes();
  return syncSteps(resolved.types).map((step) => {
    const base = defaultStepVariables(step.id, step.extraVariables ?? {}, resolved.types);
    return {
      id: step.id,
      area: step.area,
      writes: step.writes,
      rootField: rootFieldOf(step),
      run: step.run,
      optional: !!step.optional,
      document: step.query,
      // What this step will actually send, overrides included. `first`, `after` and (for
      // graphSearch) `quick` are added by the transport on every request and are named in
      // the panel rather than folded in here, so what is shown is what is configured.
      variables: step.extraVariables ?? {},
      // The `first` the transport will send for THIS step. Named because it is no longer one
      // number for the whole battery: the panel would otherwise list `first` as a transport
      // variable whose value the operator cannot see and cannot predict.
      pageSize: step.pageSize ?? PAGE_SIZE,
      defaultVariables: base,
      editable: isEditableStep(step.id),
      overridden: changedPaths(step.id, base, overrides[step.id]),
      // Three steps build their filter from the tenant-resolved AI type list, so only those
      // three can be described provisionally. Said out loud rather than shown as settled
      // fact — this page's whole job is not doing that.
      typesResolved: TYPE_DEPENDENT_STEPS.has(step.id) ? resolved.resolved : true,
    };
  });
}

/**
 * The AI resource types, for DESCRIBING the battery — with a credential-free fallback.
 *
 * A dry-run deployment has no credentials at all, and it is how most people first open this
 * app. Letting the whole panel fail there because a type list could not be resolved would
 * hide nine documents that are static strings and need no tenant to read.
 */
function describeAiTypes(): { types: readonly string[]; resolved: boolean } {
  try {
    return { types: resolveAiResourceTypes().types, resolved: true };
  } catch (e) {
    return { types: AI_RESOURCE_TYPE_CANDIDATES, resolved: false };
  }
}

/**
 * A step's variables as the builders produce them, with no override applied — the "reset
 * to default" target, computed the same way the sync computes the live ones so the two can
 * never describe different defaults.
 */
function defaultStepVariables(stepId: string, withOverride: Rec, aiTypes?: readonly string[]): Rec {
  switch (stepId) {
    case "INVENTORY_AI":
      return aiInventoryVariables(aiTypes ?? resolveAiResourceTypes().types) as unknown as Rec;
    case "ISSUES_TOXIC":
      return aiIssuesVariables(projectScope()) as unknown as Rec;
    case "CONFIG_FINDINGS":
      return aiConfigFindingsVariables(projectScope()) as unknown as Rec;
    case "AI_ASSET_PROPERTIES":
      return aiPropertiesVariables(aiTypes ?? resolveAiResourceTypes().types) as unknown as Rec;
    case "AGENTIC_IDENTITIES":
      return aiPrincipalsVariables(projectScope()) as unknown as Rec;
    // Like INVENTORY_AI, these two build their `$query` from the tenant-resolved AI type
    // list, so their default is only fully known once types resolve. They are not editable,
    // so this is describing the request rather than offering a reset target — but it has to
    // go through the same builder either way, or the panel would print a default the sync
    // does not send.
    case "HOST_EXPOSURE":
      return hostExposureVariables(aiTypes ?? resolveAiResourceTypes().types, projectScope());
    case "ENDPOINT_EXPOSURE":
      return endpointExposureVariables(aiTypes ?? resolveAiResourceTypes().types, projectScope());
    case "IDENTITY_ACCESS":
      return identityAccessVariables(aiTypes ?? resolveAiResourceTypes().types, projectScope());
    case "LINEAGE":
      // `null` scope, matching what the step sends — see its declaration in syncSteps().
      return lineageVariables(aiTypes ?? resolveAiResourceTypes().types, null);
    // The widened agent-path traversals. `null` scope, as they have always sent.
    case "GUARDRAIL_GAPS":
      return noGuardrailVariables(aiTypes ?? resolveAiResourceTypes().types, null);
    case "RUNS_AS":
      return agentRunsAsVariables(aiTypes ?? resolveAiResourceTypes().types, null);
    case "SA_FINDINGS":
      return saExcessiveAccessVariables(aiTypes ?? resolveAiResourceTypes().types, null);
    case "SENSITIVE_DATA_ACCESS":
      return sensitiveDataAccessVariables(aiTypes ?? resolveAiResourceTypes().types, null);
    case "EFFECTIVE_ACCESS":
      return effectiveAccessVariables(aiTypes ?? resolveAiResourceTypes().types, projectScope());
    case "IDENTITY_HYGIENE":
      // Resolved from the catalogue, exactly as the step itself is, so the panel shows the
      // rule ids the sync would actually send rather than an empty list.
      return aiIdentityHygieneVariables(
        resolveHygieneRules(loadConfigRules()).ids,
        projectScope(),
      ) as unknown as Rec;
    case "FRAMEWORKS_LIST":
      return aiSecurityFrameworksVariables() as unknown as Rec;
    default:
      // Every posture step shares one variable spec but carries its own framework id, so
      // the default has to keep that id — resetting a step must not point it at a
      // different framework than the one its own id says it queried.
      if (stepId.indexOf("COMPLIANCE_POSTURE_") === 0) {
        return {
          ...(aiCompliancePostureVariables(projectScope()) as unknown as Rec),
          id: stepId.slice("COMPLIANCE_POSTURE_".length),
        };
      }
      // Steps with no builder take no overrides either, so what they send IS their default.
      return withOverride;
  }
}

/**
 * Fetch ONE page for a step with proposed variables, normalize it, and throw it away.
 *
 * Nothing is persisted and no job is created, so this cannot disturb a sync or the ledger.
 * It reports the raw row count AND what the step's own normalizer made of those rows,
 * because those are different questions: a filter can return a hundred rows the normalizer
 * discards for want of a field, and only the second number says the step would actually
 * report anything.
 */
export function testStepVariables(stepId: string, vars: Rec | null): Rec {
  const step = syncSteps().filter((s) => s.id === stepId)[0];
  if (!step) throw new Error(`No sync step called ${stepId}.`);

  const proposed = effectiveStepVars(
    stepId,
    defaultStepVariables(stepId, step.extraVariables ?? {}),
    vars,
  );
  const opts: FetchOptions = { query: step.query, cursor: null, extraVariables: proposed };

  let result;
  try {
    result = fetcherFor(step)(opts);
  } catch (e) {
    // Surfaced as a value, not a throw: "the tenant rejected this filter" is the answer the
    // operator asked for, and it belongs beside the row counts rather than in a toast.
    return {
      ok: false,
      stepId,
      variables: proposed,
      error: String(e instanceof Error ? e.message : e),
    };
  }

  const part = step.normalize(result.rows);
  return {
    ok: true,
    stepId,
    variables: proposed,
    rows: result.rows.length,
    totalCount: result.totalCount,
    hasNextPage: result.hasNextPage,
    normalized: {
      nodes: part.nodes.length,
      edges: part.edges.length,
      issues: part.issues.length,
      findings: part.findings.length,
    },
    // One row, so the operator can see the shape came back as expected. Stringified and
    // capped: a raw Wiz row can be large, and this rides a google.script.run response.
    sample: result.rows.length ? JSON.stringify(result.rows[0]).slice(0, 1200) : "",
  };
}

/** Entry point for the Sync button and the daily trigger (caller holds the lock). */
export function startSync(): StartResult {
  const existing = activeJob();
  if (existing) {
    return { jobId: existing.job_id, message: "A sync is already running." };
  }
  if (!hasWizCredentials()) return dryRunSync();
  return startLiveSync();
}

/**
 * Backfill the dry-run's trend with the sample history, once, on the first dry-run into
 * an empty ledger. Only ever runs without credentials, and only when nothing has been
 * recorded yet, so it can never invent history in front of a real tenant's.
 */
function seedTrendHistory(endIso: string): void {
  if (dataRowCount(TABS.syncHistory) > 0) return;
  const DAY_MS = 86_400_000;
  const end = new Date(endIso).getTime();
  appendRows(TABS.syncHistory, SEED_TREND.map((counts, i) => {
    // Dated backwards from the sync being run, one day apart, so the sample history
    // runs continuously into the live point rather than leaving a gap in the line.
    const at = new Date(end - (SEED_TREND.length - i) * DAY_MS).toISOString();
    return {
      sync_id: `sync-sample-${String(i + 1).padStart(2, "0")}`,
      started_at: at,
      finished_at: at,
      status: "SUCCESS",
      mode: "dry-run",
      node_count: null,
      edge_count: null,
      issue_count: null,
      api_calls: 0,
      snapshot_ref: null,
      error: null,
      aars_severity_json: JSON.stringify(counts),
    };
  }));
}

/** Seed-data sync: same persist path as live, zero credentials, completes in-line. */
function dryRunSync(): StartResult {
  const startedAt = nowIso();
  seedTrendHistory(startedAt);
  const syncId = `sync-${startedAt.replace(/[:]/g, "")}`;
  const doc = persistSync(
    seedGraphDoc(startedAt),
    SEED_ISSUES,
    SEED_AARS_HINTS,
    { syncId, mode: "dry-run", startedAt, apiCalls: 0 },
    undefined,
    SEED_FINDINGS,
    SEED_DATA_FINDINGS,
    SEED_FRAMEWORKS,
    SEED_POSTURE,
    SEED_FRAMEWORK_POLICIES,
    {
      configRules: SEED_CONFIG_RULES,
      identityFindings: SEED_IDENTITY_FINDINGS,
      effectiveAccess: SEED_EFFECTIVE_ACCESS,
    },
  );
  // A dry-run issues no queries, so nothing can have been rejected. Clearing rather than
  // leaving the previous live run's list behind, which would attribute a stale skip to a
  // sync that never called Wiz at all.
  settingsStore.setSkippedSteps([]);
  settingsStore.setTruncatedSteps([]);
  return {
    jobId: null,
    message: `Dry-run sync complete: ${doc.nodes.length} nodes, ` +
      `${doc.edges.length} edges, ${SEED_ISSUES.length} issues (sample data).`,
  };
}

// ------------------------------------------------------------------- live battery

interface JobParams {
  apiCalls: number;
  skippedSteps: string[];
  truncatedSteps: string[];
  /**
   * Raw rows each step returned, by step id, summed across pages and resume hops.
   *
   * `skippedSteps` records only the two ways a step can REFUSE — an HTTP 400 on an optional
   * step, and a normalizer's FilterNotHonouredError. A step the tenant accepts and that matches
   * nothing breaks out of the page loop looking exactly like success: not skipped, not
   * truncated, no trace anywhere. On a live tenant that produced 13,932 assets and zero edges,
   * that gap was the difference between "the six traversals were rejected" and "the six
   * traversals ran and found nothing" — two diagnoses with opposite responses, and nothing
   * stored could tell them apart. A step id present here with 0 is the second story; absent
   * from here entirely is the first.
   */
  stepRows: Record<string, number>;
  /**
   * Why each skipped step was skipped, by step id — Wiz's own message, verbatim.
   *
   * `skippedSteps` stores the id and nothing else, so the single most diagnostic fact this app
   * ever learns about a tenant was written to a Cloud Logging line and then discarded. On a live
   * tenant, four of the six edge-producing traversals were being refused with an HTTP 400 whose
   * body names the exact token the schema does not have; recovering that took a code change and
   * a re-sync, when the app had already been told and had thrown the answer away.
   *
   * Verbatim on purpose. A paraphrase of a GraphQL validation error is worth nothing — the value
   * is in the offending name, which only the original string carries.
   */
  skipReasons: Record<string, string>;
}

/** Strings out of a parsed blob — a checkpoint field can be anything after a schema change. */
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/** Strings out of a parsed blob, same tolerance as numMap and for the same reason. */
function strMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, s] of Object.entries(v as Rec)) {
    if (k && typeof s === "string" && s) out[k] = s;
  }
  return out;
}

/** Numbers out of a parsed blob, same tolerance: a job checkpointed before this field existed. */
function numMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Rec)) {
    const num = Number(n);
    if (Number.isFinite(num)) out[k] = num;
  }
  return out;
}

function jobParams(job: JobRow): JobParams {
  const parsed = parseJson<Rec>(job.params_json, {});
  return {
    apiCalls: Number(parsed["apiCalls"] ?? 0),
    skippedSteps: strList(parsed["skippedSteps"]),
    truncatedSteps: strList(parsed["truncatedSteps"]),
    stepRows: numMap(parsed["stepRows"]),
    skipReasons: strMap(parsed["skipReasons"]),
  };
}

function partRefs(job: JobRow): string[] {
  return strList(parseJson<unknown>(job.part_refs_json, []));
}

function startLiveSync(): StartResult {
  const now = nowIso();
  const job = createJob({
    job_id: newJobId("sync"),
    kind: "sync",
    phase: "FETCHING",
    sync_id: `sync-${now.replace(/[:]/g, "")}`,
    step_index: 0,
    cursor: null,
    page: 0,
    nodes_so_far: 0,
    total_count: 0,
    part_refs_json: "[]",
    params_json: JSON.stringify({ apiCalls: 0 }),
    error: null,
  });
  // Caller (api.runSync) already holds the script lock.
  runBattery(job, { budgetMs: FIRST_STEP_BUDGET_MS, lockHeld: true });
  const after = getJob(job.job_id);
  return {
    jobId: job.job_id,
    message:
      after && after.phase === "DONE"
        ? "Sync complete."
        : "Sync started — it continues in the background.",
  };
}

/** One-shot continuation trigger body. Runs without the script lock. */
export function continueJob(_e?: unknown): void {
  clearContinuationTriggers();
  const job = activeJob();
  if (!job || job.kind !== "sync" || job.phase !== "FETCHING") return;
  runBattery(job, { budgetMs: BUDGET_MS, lockHeld: false });
}

function clearContinuationTriggers(): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === CONTINUE_HANDLER) ScriptApp.deleteTrigger(t);
  }
}

function scheduleContinuation(): void {
  ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(CONTINUE_DELAY_MS).create();
}

/**
 * Walk the battery from the job's saved position until done, cancelled, or the
 * budget expires (→ spill + continuation trigger). `lockHeld` marks whether the
 * caller already holds the script lock (persisting re-locks otherwise).
 */
function runBattery(job: JobRow, opts: { budgetMs: number; lockHeld: boolean }): void {
  const deadline = Date.now() + opts.budgetMs;
  const syncId = job.sync_id ?? job.job_id;
  const refs = partRefs(job);
  const params = jobParams(job);

  let stepIndex = job.step_index;
  let cursor = job.cursor;
  let page = job.page;
  let nodesSoFar = job.nodes_so_far;
  let hopPart = emptyPart();
  let lastCheckpoint = Date.now();

  const spillHopPart = (): void => {
    if (partIsEmpty(hopPart)) return;
    const name = `normalized-part-${String(refs.length + 1).padStart(3, "0")}.json.gz`;
    refs.push(writeGzJson(syncFolder(syncId), name, hopPart).getId());
    hopPart = emptyPart();
  };

  try {
    const steps = syncSteps();
    while (stepIndex < steps.length) {
      const step = steps[stepIndex];

      for (;;) {
        if (cancelRequested(job.job_id)) {
          clearCancelFlag();
          updateJob(job.job_id, { phase: "CANCELLED" });
          return;
        }
        if (Date.now() >= deadline) {
          spillHopPart();
          updateJob(job.job_id, {
            step_index: stepIndex,
            cursor,
            page,
            nodes_so_far: nodesSoFar,
            part_refs_json: JSON.stringify(refs),
            params_json: JSON.stringify(params),
          });
          scheduleContinuation();
          return;
        }

        const fetcher = fetcherFor(step);
        let result;
        try {
          result = fetcher({
            query: step.query,
            cursor,
            extraVariables: step.extraVariables,
            first: step.pageSize,
          });
        } catch (e) {
          // A 400 on an OPTIONAL step means this tenant's schema rejects that
          // query (missing enum members / fields). Skip the step, keep what it
          // already yielded, and let the sync deliver the rest of the picture.
          const msg = e instanceof Error ? e.message : String(e);
          if (step.optional && /HTTP 400/.test(msg)) {
            params.apiCalls += 1;
            params.skippedSteps.push(step.id);
            // Kept, not just logged. `msg` carries errorDigest's extraction of Wiz's own
            // `errors[].message`, which names the enum member or field this tenant's schema
            // does not have — the difference between "this step is broken" and "this step
            // asks for RUNS_AS and your tenant calls it something else".
            params.skipReasons[step.id] = msg.slice(0, SKIP_REASON_MAX);
            console.warn(`Sync step ${step.id} skipped — tenant rejected its query: ${msg}`);
            break;
          }
          throw e;
        }
        params.apiCalls += 1;
        page += 1;
        nodesSoFar += result.rows.length;
        // Recorded even when it is 0, and recorded HERE rather than at the step boundary: the
        // zero is the whole point (see JobParams.stepRows), and a step that spans resume hops
        // must accumulate across them rather than report its last hop.
        params.stepRows[step.id] = (params.stepRows[step.id] ?? 0) + result.rows.length;

        // Raw page archive: debugging aid AND the response-capture source for
        // reconciling the normalizers (ai/queries/reponse_schemas/).
        writeSyncPage(syncId, stepIndex, page, result.rows);

        // One operation over all four arms. Written out by hand here, this carried three:
        // findings were fetched, archived, normalized and dropped on every live sync.
        //
        // A normalizer can also REFUSE a page. IDENTITY_HYGIENE filters on a `rule` key no
        // capture proves, and a tenant that accepts the filter and then ignores it would hand
        // us its entire CSPM register to file under "identity hygiene". That verdict can only
        // be reached with the rows in hand, so it arrives as a throw and is treated exactly
        // like the tenant rejecting the query: skip the step, record it, keep the rest.
        try {
          appendPart(hopPart, step.normalize(result.rows));
        } catch (e) {
          if (step.optional && e instanceof FilterNotHonouredError) {
            params.skippedSteps.push(step.id);
            // Same treatment as the 400 above: this message names WHICH filter the tenant
            // accepted and then ignored, which is the whole content of the finding.
            params.skipReasons[step.id] = e.message.slice(0, SKIP_REASON_MAX);
            console.warn(`Sync step ${step.id} skipped — ${e.message}`);
            break;
          }
          throw e;
        }

        // Checkpointed on ELAPSED TIME, not on every page.
        //
        // `updateJob` goes through sheetsDb.updateWhere, which reads the whole append-only
        // jobs tab before writing one row — three Sheets service calls to record progress
        // that only the sync card reads. Paying that per page is what made a wide step's
        // pages slow enough to need an extra resume hop.
        //
        // Time-based rather than every-Nth-page, and strictly under the client's
        // STALL_MS (syncProgress.js: 15 s): `updated_at` is a LIVENESS signal, and a card
        // that stops seeing it declares the sync to be waiting between hops while it is
        // actually fetching. A page count cannot bound that — one slow page would.
        //
        // Skipping a write is also safer than it looks. `part_refs_json` is only written on
        // a spill, so advancing the stored cursor without spilling was never durable in the
        // first place: a hard kill mid-step already loses the unspilled rows and resumes
        // past them. Writing the cursor less often narrows that window rather than widening
        // it. The deadline branch above, the step boundary below and the terminal phases all
        // still write unconditionally.
        if (page === 1 || Date.now() - lastCheckpoint >= CHECKPOINT_MS) {
          updateJob(job.job_id, {
            step_index: stepIndex,
            cursor: result.endCursor,
            page,
            nodes_so_far: nodesSoFar,
            total_count: result.totalCount ?? 0,
            params_json: JSON.stringify(params),
          });
          lastCheckpoint = Date.now();
        }

        if (!result.hasNextPage) break;
        if (page >= MAX_PAGES) {
          // The cursor is still open and we are the ones who stopped. Recorded, because a
          // bare break here reports a prefix of the landscape as the whole of it — and the
          // resulting undercount is indistinguishable from a tenant that simply has less.
          params.truncatedSteps.push(step.id);
          console.warn(
            `Sync step ${step.id} stopped at the ${MAX_PAGES}-page cap with more rows available.`,
          );
          break;
        }
        cursor = result.endCursor;
      }

      // Step finished: spill and advance.
      spillHopPart();
      stepIndex += 1;
      cursor = null;
      page = 0;
      updateJob(job.job_id, {
        step_index: stepIndex,
        cursor: null,
        page: 0,
        // Carried here because the page loop no longer writes it on every page: without it a
        // throttled tail would leave the row reporting the count from the last checkpoint.
        nodes_so_far: nodesSoFar,
        part_refs_json: JSON.stringify(refs),
        params_json: JSON.stringify(params),
      });
      lastCheckpoint = Date.now();
    }

    // ------------------------------------------------------------- reconcile
    updateJob(job.job_id, { phase: "RECONCILING" });
    const parts: NormalizedPart[] = [];
    for (const ref of refs) {
      const parsed = readGzJsonFile(ref) as NormalizedPart | null;
      if (parsed && Array.isArray(parsed.nodes)) parts.push(parsed);
    }
    const startedAt = job.started_at;
    const merged = mergeParts(parts, nowIso());
    const doc = merged.doc;
    // Augment de-dup: real issuesV2 rows supersede the synthetic per-rule rows for the
    // same (asset, combo-group), so the two batteries never double-count.
    const issues = reconcileIssues(merged.issues);
    // Relabel findings with the framework codes Wiz itself asserts, once the WHOLE battery
    // has landed — see withFrameworkCodes for why this cannot happen per page.
    //
    // Gated, and off by default: it changes which cascade rows match, which moves scores,
    // and every other knob in this model defaults to the documented behaviour so no tenant
    // re-scores on upgrade. With the flag off this is exactly `merged.findings`.
    const aarsRule = settingsStore.getAarsRule().rule;
    const findings = aarsRule.gapSources.frameworkMapping === true
      ? withFrameworkCodes(
        merged.findings,
        frameworkCodeLookup(merged.frameworkPolicies, merged.posture, merged.frameworks),
      )
      : merged.findings;
    if (!doc.nodes.length) {
      updateJob(job.job_id, {
        phase: "FAILED",
        error: "Sync fetched no assets — check the service account's scope and permissions.",
      });
      return;
    }

    // ---------------------------------------------------------------- persist
    // Live AARS is no longer purely heuristic: config-findings supply real pillar-B
    // hints (union with the issue-framework heuristic), so persistSync enriches with
    // them instead of undefined.
    updateJob(job.job_id, { phase: "PERSISTING" });
    // The same rule persistSync will score under — resolved above, so the hints and the
    // enrichment can never be built under two different models.
    const hints = buildAarsHintsFromFindings(findings, doc, issues, aarsRule);
    const persist = () => {
      persistSync(doc, issues, hints, {
        syncId,
        mode: "live",
        startedAt,
        apiCalls: params.apiCalls,
      }, undefined, findings, merged.dataFindings,
      merged.frameworks, merged.posture, merged.frameworkPolicies, {
        configRules: merged.configRules,
        identityFindings: merged.identityFindings,
        effectiveAccess: merged.effectiveAccess,
      });
      // Written with the commit, so what the Scans page reports as skipped always describes
      // the sync whose numbers it is showing. The job row carrying this is discarded the
      // moment the job goes terminal, which is why it could not be read back before.
      settingsStore.setSkippedSteps(params.skippedSteps);
      settingsStore.setTruncatedSteps(params.truncatedSteps);
      settingsStore.setStepRows(params.stepRows);
      settingsStore.setSkipReasons(params.skipReasons);
      // Stamped only when the catalogue actually came back with rows, which is what starts
      // the 30-day clock. A run that skipped the step (fresh) or had it rejected leaves the
      // old timestamp alone, so a rejection retries tomorrow rather than being remembered as
      // a successful collection for a month.
      if (merged.configRules.length) settingsStore.setConfigRulesSyncedAt(Date.now());
    };
    if (opts.lockHeld) persist();
    else withScriptLock(persist);
    updateJob(job.job_id, { phase: "DONE" });
  } catch (e) {
    updateJob(job.job_id, {
      phase: "FAILED",
      error: String(e instanceof Error ? e.message : e).slice(0, 800),
    });
  }
}

/** Daily trigger body: silently no-op without credentials (dry-run is manual-only). */
export function dailySync(): void {
  if (!hasWizCredentials()) return;
  withScriptLock(() => {
    startSyncFromTrigger();
  });
}

function startSyncFromTrigger(): void {
  const existing = activeJob();
  if (existing) return;
  startLiveSync();
}

export function cancelSync(jobId: string): { message: string } {
  const job = getJob(jobId);
  if (!job) return { message: "No such sync job." };
  if (job.phase === "DONE" || job.phase === "FAILED" || job.phase === "CANCELLED") {
    return { message: "The sync already finished." };
  }
  setProp(CANCEL_PROP, jobId);
  return { message: "Stopping sync…" };
}

export function cancelRequested(jobId: string): boolean {
  return getProp(CANCEL_PROP) === jobId;
}

export function clearCancelFlag(): void {
  deleteProp(CANCEL_PROP);
}

export function jobStatus(jobId: string): JobRow | null {
  return getJob(jobId);
}
