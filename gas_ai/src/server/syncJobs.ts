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
  normalizeConfigFindingsPage,
  normalizeIdentityAccessPage,
  normalizeInventoryPage,
  normalizeIssuesPage,
  normalizeNoGuardrailPage,
  normalizePrincipalsPage,
  normalizeRuleAssetsPage,
  normalizeRunsAsPage,
  normalizeSensitiveChainPage,
  partIsEmpty,
  reconcileIssues,
  type NormalizedPart,
} from "../domain/syncNormalize";
import { buildAarsHintsFromFindings } from "../domain/graphEnrich";
import { changedPaths, effectiveStepVars, isEditableStep } from "../domain/scanVars";
import { COMBO_GROUPS } from "../domain/toxicCombos";
import { nowIso, type Rec } from "../domain/util";
import { readGzJsonFile, syncFolder, writeGzJson, writeSyncPage } from "./archiveStore";
import { activeJob, createJob, getJob, newJobId, updateJob, type JobRow } from "./jobsStore";
import { withScriptLock } from "./locks";
import { getProp, hasWizCredentials, projectScope, setProp, deleteProp } from "./props";
import { seedGraphDoc, SEED_AARS_HINTS, SEED_FINDINGS, SEED_ISSUES, SEED_TREND } from "./sampleData";
import * as settingsStore from "./settingsStore";
import { appendRows, dataRowCount, TABS } from "./sheetsDb";
import { parseJson, persistSync } from "./syncStore";
import {
  fetchCloudResourcesPage,
  fetchConnectionPage,
  fetchGraphSearchPage,
  resolveAiResourceTypes,
  type FetchOptions,
} from "./wizClientAi";
import {
  AI_RESOURCE_TYPE_CANDIDATES,
  aiConfigFindingsVariables,
  aiInventoryVariables,
  aiIssuesVariables,
  aiPrincipalsVariables,
  MAX_PAGES,
  Q_AGENT_RUNS_AS,
  Q_AGENTS_NO_GUARDRAIL,
  Q_AI_INVENTORY,
  Q_CONFIG_FINDINGS,
  Q_IDENTITY_ACCESS,
  Q_ISSUES,
  Q_PRINCIPALS,
  Q_RULE_ASSETS,
  Q_SA_EXCESSIVE_ACCESS,
  Q_SA_SENSITIVE_DATA,
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

interface SyncStepDef {
  id: string;
  // The Wiz Scans area this step feeds, and the ledger it writes. Metadata rather than a
  // parallel table elsewhere: a step and its provenance drift apart the moment they are
  // two lists, and the Scans page states this provenance to the operator as fact.
  area: string;
  writes: string[];
  run: "cloudResources" | "graphSearch" | "connection";
  // For run:"connection" — the top-level connection field to read (issuesV2,
  // configurationFindings). Ignored for the other run modes.
  connectionField?: string;
  query: string;
  extraVariables?: Rec;
  normalize: (rows: Rec[]) => NormalizedPart;
  // Optional steps are enhancements (relationships, findings): when THIS
  // tenant's schema rejects their query (HTTP 400 validation), the step is
  // skipped and recorded instead of failing the whole sync. The inventory
  // step is the core dataset and stays fatal.
  optional?: boolean;
}

/**
 * The battery, built per run: the inventory query embeds the AI resource
 * types resolved against this tenant's schema (introspection ∩ candidates,
 * or the WIZ_AI_RESOURCE_TYPES override) — see resolveAiResourceTypes.
 */
function syncSteps(aiTypes?: readonly string[]): SyncStepDef[] {
  // Resolved against the tenant by default, which needs credentials and is what a real sync
  // must do. `aiTypes` is for DESCRIBING the battery without one — never for running it: a
  // sync that quietly substituted a guessed type list would query the wrong estate and say
  // nothing about it.
  const types = aiTypes ?? resolveAiResourceTypes().types;
  // Stored per-step overrides, laid over each builder's variables by path. Read once so a
  // battery of twelve steps costs one settings read, not twelve.
  const overrides = settingsStore.getScanVars();
  const vars = (stepId: string, base: Rec): Rec =>
    effectiveStepVars(stepId, base, overrides[stepId]);

  return [
    {
      id: "INVENTORY_AI",
      area: "aispm",
      writes: ["ai_assets"],
      run: "cloudResources",
      query: Q_AI_INVENTORY,
      extraVariables: vars("INVENTORY_AI", aiInventoryVariables(types)),
      normalize: normalizeInventoryPage,
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
      area: "compliance",
      writes: ["ai_findings"],
      run: "connection",
      connectionField: "configurationFindings",
      query: Q_CONFIG_FINDINGS,
      extraVariables: vars("CONFIG_FINDINGS", aiConfigFindingsVariables(projectScope()) as Rec),
      normalize: normalizeConfigFindingsPage,
      optional: true,
    },
    {
      id: "GUARDRAIL_GAPS",
      area: "guardrails",
      writes: ["ai_assets.guardrail_missing"],
      run: "graphSearch",
      query: Q_AGENTS_NO_GUARDRAIL,
      normalize: normalizeNoGuardrailPage,
      optional: true,
    },
    {
      id: "RUNS_AS",
      area: "ciem",
      writes: ["ai_edges (RUNS_AS)", "ai_assets"],
      run: "graphSearch",
      query: Q_AGENT_RUNS_AS,
      normalize: normalizeRunsAsPage,
      optional: true,
    },
    {
      id: "SA_FINDINGS",
      area: "ciem",
      writes: ["ai_edges (HAS_FINDING)", "ai_assets"],
      run: "graphSearch",
      query: Q_SA_EXCESSIVE_ACCESS,
      normalize: normalizeRunsAsPage,
      optional: true,
    },
    // The agent -> identity -> sensitive-resource chain. Optional like every other
    // relationship step: if this tenant's schema rejects the traversal the sync records a
    // skipped step rather than failing, which is what makes a query transcribed from a doc
    // safe to ship without a live tenant to test it against.
    {
      id: "SENSITIVE_CHAIN",
      area: "dspm",
      writes: ["ai_edges (ALLOWS_ACCESS_TO)", "ai_assets"],
      run: "graphSearch",
      query: Q_SA_SENSITIVE_DATA,
      normalize: normalizeSensitiveChainPage,
      optional: true,
    },
    {
      id: "IDENTITY_ACCESS",
      area: "identity",
      writes: ["ai_edges (ALLOWS_ACCESS_TO)", "ai_assets"],
      run: "graphSearch",
      query: Q_IDENTITY_ACCESS,
      normalize: normalizeIdentityAccessPage,
      optional: true,
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
    },
  ];
}

/** The connection field a step reads its rows from — the one the response must carry. */
function rootFieldOf(step: SyncStepDef): string {
  if (step.run === "cloudResources") return "cloudResourcesV2";
  if (step.run === "graphSearch") return "graphSearch";
  return step.connectionField ?? "";
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
      defaultVariables: base,
      editable: isEditableStep(step.id),
      overridden: changedPaths(step.id, base, overrides[step.id]),
      // Only INVENTORY_AI's default depends on resolving types against the tenant, so it is
      // the only step whose description can be provisional. Said out loud rather than shown
      // as settled fact — this page's whole job is not doing that.
      typesResolved: step.id === "INVENTORY_AI" ? resolved.resolved : true,
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
    case "AGENTIC_IDENTITIES":
      return aiPrincipalsVariables(projectScope()) as unknown as Rec;
    default:
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
    if (step.run === "cloudResources") result = fetchCloudResourcesPage(opts);
    else if (step.run === "graphSearch") result = fetchGraphSearchPage(opts);
    else result = fetchConnectionPage(step.connectionField ?? "", opts);
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
  );
  // A dry-run issues no queries, so nothing can have been rejected. Clearing rather than
  // leaving the previous live run's list behind, which would attribute a stale skip to a
  // sync that never called Wiz at all.
  settingsStore.setSkippedSteps([]);
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
}

/** Strings out of a parsed blob — a checkpoint field can be anything after a schema change. */
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function jobParams(job: JobRow): JobParams {
  const parsed = parseJson<Rec>(job.params_json, {});
  return {
    apiCalls: Number(parsed["apiCalls"] ?? 0),
    skippedSteps: strList(parsed["skippedSteps"]),
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

        const fetcher = step.run === "graphSearch"
          ? fetchGraphSearchPage
          : step.run === "connection"
            ? (a: FetchOptions) => fetchConnectionPage(step.connectionField!, a)
            : fetchCloudResourcesPage;
        let result;
        try {
          result = fetcher({
            query: step.query,
            cursor,
            extraVariables: step.extraVariables,
          });
        } catch (e) {
          // A 400 on an OPTIONAL step means this tenant's schema rejects that
          // query (missing enum members / fields). Skip the step, keep what it
          // already yielded, and let the sync deliver the rest of the picture.
          const msg = e instanceof Error ? e.message : String(e);
          if (step.optional && /HTTP 400/.test(msg)) {
            params.apiCalls += 1;
            params.skippedSteps.push(step.id);
            console.warn(`Sync step ${step.id} skipped — tenant rejected its query: ${msg}`);
            break;
          }
          throw e;
        }
        params.apiCalls += 1;
        page += 1;
        nodesSoFar += result.rows.length;

        // Raw page archive: debugging aid AND the response-capture source for
        // reconciling the normalizers (ai/queries/reponse_schemas/).
        writeSyncPage(syncId, stepIndex, page, result.rows);

        // One operation over all four arms. Written out by hand here, this carried three:
        // findings were fetched, archived, normalized and dropped on every live sync.
        appendPart(hopPart, step.normalize(result.rows));

        updateJob(job.job_id, {
          step_index: stepIndex,
          cursor: result.endCursor,
          page,
          nodes_so_far: nodesSoFar,
          total_count: result.totalCount ?? 0,
          params_json: JSON.stringify(params),
        });

        if (!result.hasNextPage || page >= MAX_PAGES) break;
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
        part_refs_json: JSON.stringify(refs),
        params_json: JSON.stringify(params),
      });
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
    const findings = merged.findings;
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
    // The same rule persistSync will score under — resolved here too, so the hints and the
    // enrichment can never be built under two different models.
    const hints = buildAarsHintsFromFindings(findings, doc, issues, settingsStore.getAarsRule().rule);
    const persist = () => {
      persistSync(doc, issues, hints, {
        syncId,
        mode: "live",
        startedAt,
        apiCalls: params.apiCalls,
      }, undefined, findings);
      // Written with the commit, so what the Scans page reports as skipped always describes
      // the sync whose numbers it is showing. The job row carrying this is discarded the
      // moment the job goes terminal, which is why it could not be read back before.
      settingsStore.setSkippedSteps(params.skippedSteps);
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
