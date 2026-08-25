// Keeping the derived read-models warm, so nobody pays a cold load.
//
// WHY THIS EXISTS. CacheService's maximum TTL is six hours — a platform ceiling, not a
// choice; `DEFAULT_TTL_SEC` is literally that maximum. Tenants sync daily, so DATA_VERSION
// does not move for ~24h while every entry lapses three or four times inside that window,
// and each lapse is a multi-second cold load paid by whoever opens the app next. Warming at
// the tail of a sync covers the hours after it; the scheduled entry point covers the rest.
//
// WHY IT IS ITS OWN MODULE AND NOT A FUNCTION IN api.ts. `esbuild.config.mjs` fails the
// BUILD if anything `api.ts` exports has no `api_*` delegator in `dist/entry.js`, in either
// direction. That guard is worth more than the convenience of putting this next to the
// endpoints it calls: it means "everything api.ts exports is reachable from the client" is
// an invariant rather than a habit. A warm is emphatically not an RPC — it takes minutes and
// answers nothing — so it lives here and reaches the client-facing surface the same way the
// trigger handlers do, through a namespace on the `Server` global.
//
// It warms by calling the PUBLIC endpoints. Every `cached()` entry in this app is resolved
// inside the endpoint that serves it, so calling the endpoint is what populates the entry a
// page will later hit. There is nothing to share by extracting the composers, and extracting
// them would be a refactor of api.ts rather than a warm.

import * as api from "./api";
import { activeJob } from "./jobsStore";
import { duringWarm, sweepReadModels } from "./readModelStore";

/**
 * Wall-clock budget for one pass.
 *
 * GAS kills an execution at six minutes and a killed warm warms NOTHING — every entry it had
 * already computed is still cached, but the ones it never reached stay cold and nothing says
 * why. Stopping at the budget and reporting "warmed N, M left cold" degrades instead of
 * failing, which matters most on exactly the register that has outgrown the window.
 */
export const WARM_BUDGET_MS = 270_000;

/**
 * The entries a reader's first page load would otherwise compute.
 *
 * One line per cached read-model, named by the endpoint that resolves it rather than by the
 * cache namespace, because the endpoint is the thing that stays true when a namespace is
 * bumped. Several endpoints share one entry — getProblems and getActions both resolve
 * `problemsModel`, getCompliance and getFiveRsScope both resolve `getCompliance` — so the
 * list is deliberately of ENTRIES, not of endpoints.
 */
const TARGETS: Array<[label: string, run: () => unknown]> = [
  ["bootstrap", () => api.bootstrap({})],
  ["assetsModel", () => api.getAssetsHead({})],
  ["assetOptions", () => api.getAssetOptions({})],
  ["problemsModel", () => api.getProblems({})],
  ["configModel", () => api.getConfigFindings({})],
  ["compliance", () => api.getCompliance({})],
  ["toxicCombos", () => api.getToxicCombos({})],
  ["issues", () => api.getIssues({})],
  ["graph", () => api.getGraph({})],
  ["queryVocabulary", () => api.getQueryVocabulary({})],
  ["syncHistory", () => api.getSyncHistory({})],
  ["storageStats", () => api.getStorageStats({})],
];

export interface WarmResult {
  warmed: number;
  skipped: number;
  failed: number;
  ms: number;
  /** Durable files trashed by the sweep. -1 when the sweep was skipped. */
  swept: number;
}

/**
 * Warm every read-model, within a budget. Best-effort throughout: one entry failing must not
 * cost the rest, because a warm is an optimization and never a correctness dependency.
 */
export function warmReadModels(budgetMs: number = WARM_BUDGET_MS): WarmResult {
  // `duringWarm` is what permits durable WRITES and what collects the sweep's keep-list.
  // Outside it the Drive layer is read-only, which is what keeps the file count bounded.
  return duringWarm(() => warmInner(budgetMs));
}

function warmInner(budgetMs: number): WarmResult {
  const t0 = Date.now();
  let warmed = 0;
  let skipped = 0;
  let failed = 0;

  for (const [label, run] of TARGETS) {
    if (Date.now() - t0 >= budgetMs) {
      skipped += 1;
      continue;
    }
    try {
      run();
      warmed += 1;
    } catch (e) {
      failed += 1;
      console.warn(`Cache warm (${label}) failed: ${e}`);
    }
  }

  // The keep-list now names every durable file this pass touched, so anything else in the
  // folder is a leftover — from a bumped cache namespace, a changed param, or a model dropped
  // from the warm — that no future write would ever overwrite, because nothing asks for it.
  //
  // SKIPPED AFTER A BUDGET CUT-OUT: the keep-list would be short by whatever never ran, and
  // sweeping against it would trash live entries only to rewrite them next pass.
  const swept = skipped ? -1 : sweepReadModels();

  const ms = Date.now() - t0;
  if (skipped) {
    console.warn(`Cache warm: ran out of budget after ${warmed} entries, ${skipped} left cold`);
  } else {
    console.log(
      `Cache warm: ${warmed} entries in ${ms}ms` + (failed ? `, ${failed} failed` : "") +
      (swept > 0 ? `, swept ${swept} stale durable file(s)` : ""),
    );
  }
  return { warmed, skipped, failed, ms, swept };
}

/**
 * The scheduled entry point — `trigger_warmReadModels` in dist/entry.js.
 *
 * SKIPPED WHILE A JOB IS IN FLIGHT, and the reason is correctness rather than politeness.
 * `persistSync` calls `overwrite` on ten tabs in sequence, and `overwrite` clears a tab and
 * rewrites it — so a warm landing between two of those calls reads a TORN LEDGER and caches
 * it under the PRE-bump version, which is then served for the rest of that window. A commit
 * landing mid-warm is merely wasteful by comparison; this is wrong.
 *
 * `activeJob()` is nearly free to ask: it short-circuits on a Script Property and touches the
 * sheet only when a job really is in flight.
 *
 * IT DELIBERATELY DOES NOT TAKE THE SCRIPT LOCK. A 60-120s hold would make an operator's
 * "Sync now" fail on its 30s lock timeout. The fires are hours apart so two cannot overlap,
 * and the only real race is warm-versus-persist, which the check above covers.
 */
export function warmReadModelsScheduled(): WarmResult | null {
  const job = activeJob();
  if (job) {
    console.log(`Cache warm: skipped, ${job.kind} job ${job.job_id} is ${job.phase}`);
    return null;
  }
  return warmReadModels();
}
