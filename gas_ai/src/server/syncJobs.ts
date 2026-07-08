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
  mergeParts,
  normalizeIdentityAccessPage,
  normalizeInventoryPage,
  normalizeNoGuardrailPage,
  normalizeRuleAssetsPage,
  normalizeRunsAsPage,
  type NormalizedPart,
} from "../domain/syncNormalize";
import { COMBO_GROUPS } from "../domain/toxicCombos";
import { nowIso, type Rec } from "../domain/util";
import { readGzJsonFile, syncFolder, writeGzJson, writeSyncPage } from "./archiveStore";
import { activeJob, createJob, getJob, newJobId, updateJob, type JobRow } from "./jobsStore";
import { withScriptLock } from "./locks";
import { getProp, hasWizCredentials, setProp, deleteProp } from "./props";
import { seedGraphDoc, SEED_AARS_HINTS, SEED_ISSUES } from "./sampleData";
import { persistSync } from "./syncStore";
import {
  fetchCloudResourcesPage,
  fetchGraphSearchPage,
  resolveAiResourceTypes,
} from "./wizClientAi";
import {
  MAX_PAGES,
  Q_AGENT_RUNS_AS,
  Q_AGENTS_NO_GUARDRAIL,
  Q_IDENTITY_ACCESS,
  Q_RULE_ASSETS,
  Q_SA_EXCESSIVE_ACCESS,
  qAiInventory,
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
  run: "cloudResources" | "graphSearch";
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
function syncSteps(): SyncStepDef[] {
  return [
    {
      id: "INVENTORY_AI",
      run: "cloudResources",
      query: qAiInventory(resolveAiResourceTypes().types),
      normalize: normalizeInventoryPage,
    },
    // One cursor walk per toxic-combination source rule: the assets carrying an OPEN
    // issue for that rule (issue rows are reconstructed one-per-asset).
    ...COMBO_GROUPS.map((group): SyncStepDef => ({
      id: `ISSUES_${group.ruleId}`,
      run: "cloudResources",
      query: Q_RULE_ASSETS,
      extraVariables: { ruleIds: [group.ruleId] },
      normalize: (rows) => normalizeRuleAssetsPage(rows, group),
      optional: true,
    })),
    {
      id: "GUARDRAIL_GAPS",
      run: "graphSearch",
      query: Q_AGENTS_NO_GUARDRAIL,
      normalize: normalizeNoGuardrailPage,
      optional: true,
    },
    {
      id: "RUNS_AS",
      run: "graphSearch",
      query: Q_AGENT_RUNS_AS,
      normalize: normalizeRunsAsPage,
      optional: true,
    },
    {
      id: "SA_FINDINGS",
      run: "graphSearch",
      query: Q_SA_EXCESSIVE_ACCESS,
      normalize: normalizeRunsAsPage,
      optional: true,
    },
    {
      id: "IDENTITY_ACCESS",
      run: "graphSearch",
      query: Q_IDENTITY_ACCESS,
      normalize: normalizeIdentityAccessPage,
      optional: true,
    },
  ];
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

/** Seed-data sync: same persist path as live, zero credentials, completes in-line. */
function dryRunSync(): StartResult {
  const startedAt = nowIso();
  const syncId = `sync-${startedAt.replace(/[:]/g, "")}`;
  const doc = persistSync(
    seedGraphDoc(startedAt),
    SEED_ISSUES,
    SEED_AARS_HINTS,
    { syncId, mode: "dry-run", startedAt, apiCalls: 0 },
  );
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

function jobParams(job: JobRow): JobParams {
  try {
    const parsed = JSON.parse(job.params_json ?? "{}") as Rec;
    const skipped = parsed["skippedSteps"];
    return {
      apiCalls: Number(parsed["apiCalls"] ?? 0),
      skippedSteps: Array.isArray(skipped) ? skipped.map(String) : [],
    };
  } catch {
    return { apiCalls: 0, skippedSteps: [] };
  }
}

function partRefs(job: JobRow): string[] {
  try {
    const parsed = JSON.parse(job.part_refs_json ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
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
    if (!hopPart.nodes.length && !hopPart.edges.length && !hopPart.issues.length) return;
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

        const fetcher = step.run === "cloudResources"
          ? fetchCloudResourcesPage
          : fetchGraphSearchPage;
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

        const normalized = step.normalize(result.rows);
        hopPart.nodes.push(...normalized.nodes);
        hopPart.edges.push(...normalized.edges);
        hopPart.issues.push(...normalized.issues);

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
    const { doc, issues } = mergeParts(parts, nowIso());
    if (!doc.nodes.length) {
      updateJob(job.job_id, {
        phase: "FAILED",
        error: "Sync fetched no assets — check the service account's scope and permissions.",
      });
      return;
    }

    // ---------------------------------------------------------------- persist
    // (persistSync enriches: AARS derived heuristically for live data — no hints.)
    updateJob(job.job_id, { phase: "PERSISTING" });
    const persist = () =>
      persistSync(doc, issues, undefined, {
        syncId,
        mode: "live",
        startedAt,
        apiCalls: params.apiCalls,
      });
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
