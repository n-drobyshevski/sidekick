// The RPC surface.
//
// EVERY EXPORT HERE NEEDS A DELEGATOR IN dist/entry.js, and test/entryPoints.test.ts holds
// the two together by reading both as text. The failure it catches is silent and
// production-only: a new endpoint ships, the client calls it, and google.script.run reports
// only that the function does not exist.
//
// WHAT THIS FILE IS NOW. Phase 1 shipped four endpoints; this is the whole surface. It is a
// THIN ASSEMBLY LAYER and nothing else: `server/readModels.ts` builds, `domain/pagePayload.ts`
// slices, and every function below composes one or two of each and wraps the result in the
// envelope. No figure is computed here.
//
// READS GO THROUGH `run()`, WRITES THROUGH `mutate()` — with THREE DELIBERATE EXCEPTIONS, all
// of them jobs. `scanJobs.startSync` takes the script lock itself, and `cancelSync` is
// documented lock-free on purpose (it writes a Script Property that the running page loop
// re-reads between pages — taking the lock would block on the very execution it is trying to
// stop). Wrapping either in `mutate()` would nest `withScriptLock`, and the inner `finally`
// releases the lock the outer frame still believes it holds. `compact({dryRun:true})` is the
// third: a dry run mutates nothing, so it is a read. gas/ makes the same three calls
// (`runScan` uses `run`, not `mutate`).
//
// NO NEW SLICE WAS NEEDED, AND THAT WAS CHECKED RATHER THAN ASSUMED. Every endpoint below
// feeds an EXISTING `pagePayload` function with the key the model already publishes:
// `programModel().trend` -> `programTrendSlice`, `historyModel().{history,trend}` ->
// `mttrPageTrendSlice` / `historyTrendSlice`, `historyModel().scans` -> `scanRowsSlice`,
// `mttrModel()` -> `execMttrSlice`, `executiveModel().byScope` -> `execGroupSlice` /
// `mttrGroupTableSlice`. `test/api.test.ts`'s "each read model reaches its slice" block asserts
// the resulting key sets, so the claim is measured at the endpoint rather than read off S5's
// field names.
//
// ONE SLICE HAS NO PRODUCER AND IS DELIBERATELY LEFT UNCALLED: `mttrGroupTrendSlice` reads
// `byGroup.trend`, a per-group x per-scan series nothing in `readModels.ts` builds —
// `executiveModel().byScope` is `{dimension, rows}` and stops there. It is NOT dropped: the
// function is pinned by `test/pagePayload.test.ts` and inventing a producer to fill it would
// mean shipping a series no page draws, computed per scope per scan, for nobody. When a
// by-scope drawer wants that chart, the producer belongs in `readModels.ts` and the slice is
// already waiting for it.
//
// THE SECRETS ASYMMETRY IS IN THE SURFACE, not only in the payloads. `getRegisterPage` serves
// sca and sast and REFUSES `secrets`; `getSecretsPage` serves that register, because its page
// is a superset (`registerModel("secrets")` for the aging / movement / concentration blocks,
// `secretsModel` for the lifecycle) and severity is not one of its axes. A client that got
// `getRegisterPage({scope:"secrets"})` back would render a register page missing the only
// blocks that say whether a credential is live.

import { SCOPES, SEVERITY_ORDER, SLA_TARGETS, type Scope } from "../domain/config";
import { normalizeSeverity } from "../domain/severity";
import type { Rec } from "../domain/util";
import {
  execGroupSlice,
  execMttrSlice,
  historyTrendSlice,
  jobSummarySlice,
  mttrGroupTableSlice,
  mttrPageTrendSlice,
  programTrendSlice,
  scanRowsSlice,
} from "../domain/pagePayload";
import { BUILD_ID } from "./buildInfo";
import { hasWizCredentials } from "./props";
import { loadSettings, saveSettings } from "./settingsStore";
import { readAll, TAB_HEADERS, TABS } from "./sheetsDb";
import { canEditUsers } from "./access";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { activeJob, getJob, isStaleJob, isTerminalPhase, listJobs, type JobRow } from "./jobsStore";
import * as ledgerStore from "./ledgerStore";
import * as readModels from "./readModels";
import * as scanJobs from "./scanJobs";

/**
 * THE ENVELOPE, and it lives here rather than in dist/entry.js.
 *
 * google.script.run has no error channel that carries a message, so every RPC returns a
 * result object instead of throwing. Building it here rather than in the delegator is what
 * lets the dev harness dispatch straight into Server.api and still see exactly what the
 * deployed client sees — dev/boot.js's shim never runs entry.js.
 */
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

/** A write: take the lock, roll back a half-finished predecessor, then run. */
function mutate<T>(fn: () => T): ApiResult<T> {
  return run(() => withScriptLock(() => {
    recoverIfNeeded();
    return fn();
  }));
}

export interface Bootstrap {
  product: string;
  buildId: string;
  hasCredentials: boolean;
  scopes: readonly string[];
  severityOrder: readonly string[];
  slaTargets: Record<string, number>;
  /**
   * The freshness caption's row, NAMED FOR THE COLUMNS IT COMES FROM.
   *
   * `ts` used to be published as `finished_at` — a field named for a column the `scans` tab
   * does not have, which is the shape of mistake that only shows up in production: the
   * server built it from `row.ts` and the client read `latestScan.finished_at`, so the day a
   * scan row existed the caption would have read "Last scan undefined". Nothing in Phase 1
   * writes a scan row, so nothing could catch it.
   *
   * `scope` and `severities` ride along because the caption is a claim about coverage, not
   * just about time: a sync that requested CRITICAL/HIGH on SCA has not looked at a MEDIUM,
   * and a reader told only when it ran cannot tell that from a sync that looked at
   * everything. `severities` is the scans tab's own serialized text.
   */
  latestScan: {
    scan_id: string;
    ts: string;
    scope: string | null;
    severities: string | null;
    total: number;
  } | null;
  canEditAccess: boolean;
  settings: ReturnType<typeof loadSettings>;
}

/**
 * Everything the shell needs before it can draw: identity, credential state, the register's
 * vocabulary, and the freshness caption. One round trip, because the shell blocks on it.
 */
export function bootstrap(_p?: unknown): ApiResult<Bootstrap> {
  return run(() => {
  const scans = readAll(TABS.scans);
  let latest: Bootstrap["latestScan"] = null;
  for (const row of scans) {
    const ts = String(row.ts ?? "");
    if (!ts) continue;
    if (!latest || ts > latest.ts) {
      latest = {
        scan_id: String(row.scan_id ?? ""),
        ts,
        scope: row.scope == null ? null : String(row.scope),
        severities: row.severities == null ? null : String(row.severities),
        total: Number(row.total ?? 0),
      };
    }
  }
  return {
    product: "Wiz Sidekick DevSecOps",
    buildId: BUILD_ID,
    hasCredentials: hasWizCredentials(),
    scopes: SCOPES,
    severityOrder: SEVERITY_ORDER,
    slaTargets: SLA_TARGETS,
    latestScan: latest,
    canEditAccess: canEditUsers(),
    settings: loadSettings(),
  };
  });
}

/** The current settings dict. */
export function getSettings(_p?: unknown): ApiResult<ReturnType<typeof loadSettings>> {
  return run(() => loadSettings());
}

/** Persist settings. Returns what was actually stored, after cleaning. */
export function putSettings(p: { settings?: unknown }): ApiResult<ReturnType<typeof loadSettings>> {
  return mutate(() => saveSettings(p.settings as never));
}

/**
 * The Chart.js bundle, fetched on demand.
 *
 * Chart.js is ~170 KB of the client payload and most routes draw nothing, so it ships as
 * its own HtmlService partial rather than inside js_app. Returning it through an RPC keeps
 * the sandbox happy — the page cannot add a <script src> the CSP would refuse.
 */
export function getChartsBundle(_p?: unknown): ApiResult<string> {
  return run(() => HtmlService.createHtmlOutputFromFile("js_charts").getContent());
}

// --------------------------------------------------------------------------------------- //
//  Page params
// --------------------------------------------------------------------------------------- //

/**
 * The three knobs every page RPC forwards to a read-model, read off ONE place.
 *
 * `readModels.norm()` is what actually settles "absent vs null vs empty" — it is the cache
 * key's definition and a second normalization here would be a second answer to the same
 * question, free to drift. So this only transports: whatever arrives is coerced to the shape
 * `ModelParams` declares and handed on unchanged.
 *
 * `showNoFix` defaults to TRUE by omission, and the coercion below preserves that: only an
 * explicit `false` turns the toggle off. `Boolean(undefined)` would have inverted the default
 * for every caller that never sends the key.
 */
function modelParams(p?: unknown): readModels.ModelParams {
  const r = (p ?? {}) as Rec;
  const scopeRaw = r["scope"];
  const scope = typeof scopeRaw === "string" && (SCOPES as readonly string[]).includes(scopeRaw)
    ? (scopeRaw as Scope)
    : null;
  const sevRaw = r["severities"];
  const severities = Array.isArray(sevRaw) ? sevRaw.map(String) : null;
  return { scope, severities, showNoFix: r["showNoFix"] !== false };
}

/** The scope a per-register page is asking for, or null when it did not name a valid one. */
function requestedScope(p?: unknown): Scope | null {
  const raw = ((p ?? {}) as Rec)["scope"];
  return typeof raw === "string" && (SCOPES as readonly string[]).includes(raw)
    ? (raw as Scope)
    : null;
}

// --------------------------------------------------------------------------------------- //
//  Page reads
// --------------------------------------------------------------------------------------- //

/**
 * The landing page in one round trip.
 *
 * TWO MODELS, ONE OF THEM SLICED TO FOUR SCALARS. `mttrModel` is the whole MTTR page's payload
 * — two Kaplan-Meier curves and an SLA block — and the hero here draws four numbers out of it,
 * so it travels through `execMttrSlice`. `getMttrPage` below resolves the SAME cached entry
 * and ships it whole; the slice is what stops the landing page paying for that.
 *
 * `byScope` is this register's by-domain split (three registers, three clocks) and goes
 * through `execGroupSlice` verbatim — `executiveModel` was shaped for it (readModels.ts's
 * header says so, and this is the call that makes the claim testable).
 */
export function getExecutivePage(p?: unknown): ApiResult {
  return run(() => {
    const params = modelParams(p);
    const exec = readModels.executiveModel(params);
    return {
      asOf: exec["asOf"],
      scope: exec["scope"],
      severities: exec["severities"],
      showNoFix: exec["showNoFix"],
      mttr: execMttrSlice(readModels.mttrModel(params)),
      byScope: execGroupSlice(exec["byScope"]),
      // Already minimal — a per-severity tally, a delta pair, the tier table and the coverage
      // caveat — so these four ship whole.
      severityCounts: exec["severityCounts"],
      weekTrend: exec["weekTrend"],
      tiers: exec["tiers"],
      signalCoverage: exec["signalCoverage"],
    };
  });
}

/**
 * MTTR and SLA: the summary, the trend backbone, and the per-scope table.
 *
 * DIVERGENCE (gas/): gas/'s `getMttrPage` deliberately OMITS the summary, because `mttr.js`
 * fires `api_getMttr` for the same `cachedMttrData` entry and shipping it from both endpoints
 * sent it twice per load — two GAS executions, two Kaplan-Meier curves on a cold cache. There
 * is no second endpoint here: one RPC, one resolve, so the summary ships from this one. The
 * duplication gas/ is guarding against is the thing this shape makes impossible.
 *
 * `trends` comes from `historyModel`, not from `mttrModel`, and that is the caching audit
 * rather than a convenience: the trend backbone is time-invariant and lives in the durable
 * layer, while `mttrModel` is a clock model on a 1 h TTL. `mttrPageTrendSlice` reads
 * `{history, trend}` — both keys `historyModel` publishes — and keeps `history` because this
 * page is the only reader of it (the change chips, and the young-ledger chart fallback).
 */
export function getMttrPage(p?: unknown): ApiResult {
  return run(() => {
    const params = modelParams(p);
    return {
      mttr: readModels.mttrModel(params),
      trends: mttrPageTrendSlice(readModels.historyModel(params)),
      byScope: mttrGroupTableSlice(readModels.executiveModel(params)["byScope"]),
    };
  });
}

/**
 * Program performance: the confusion matrix, capacity, and the coverage/efficiency lines.
 *
 * THE TREND IS SHIPPED ONCE, THROUGH THE SLICE. `programModel().trend` is the twelve-field
 * shared `TrendPoint` multiplied by a backbone carrying one point per day of pre-scan history;
 * the page draws four of those fields. So the raw key is dropped from the model half and the
 * projection travels under `trends`, which is exactly what `programTrendSlice` reads.
 */
export function getProgramPage(p?: unknown): ApiResult {
  return run(() => {
    const program = { ...readModels.programModel(modelParams(p)) };
    const trends = programTrendSlice(program);
    delete program["trend"];
    return { program, trends };
  });
}

/**
 * One register's own page — sca or sast, ONE SHAPE.
 *
 * SECRETS IS REFUSED, and the refusal is the point rather than an omission. `getSecretsPage`
 * serves that register because its page is a different question: severity there grades a
 * DETECTION, not whether a credential is live, so the severity blocks this page is built
 * around are null on secrets and the lifecycle blocks that replace them are not in this
 * payload at all. Silently serving `registerModel("secrets")` here would answer the call with
 * a page whose whole middle is missing, which is worse than saying no.
 */
export function getRegisterPage(p?: unknown): ApiResult {
  return run(() => {
    const scope = requestedScope(p);
    if (scope === null) {
      throw new Error("getRegisterPage needs a scope: one of sca, sast.");
    }
    if (scope === "secrets") {
      throw new Error(
        "The secrets register has its own page — call getSecretsPage. Severity is not one of "
        + "its axes, so this page's blocks would come back empty.",
      );
    }
    return readModels.registerModel(scope, modelParams(p));
  });
}

/**
 * The secrets register: the register blocks AND the credential lifecycle.
 *
 * TWO MODELS, AND THE SECOND IS NOT OPTIONAL. `registerModel("secrets")` carries the aging
 * curve, the oldest-open ranking, the movement badge and the concentration tables — everything
 * a register page draws that is not a severity breakdown. `secretsModel` carries what replaces
 * that breakdown: validation coverage, post-detection validity, time-to-revoke, and the
 * removal-vs-rotation 2x2. Both are `warmTargets` entries; without this call the warm's
 * `register:secrets` entry would be computed on every pass for nobody.
 *
 * `segments` IS DROPPED FROM THE REGISTER HALF, because both models build it and they do not
 * always agree: `buildRegister` filters by the caller's `severities`, `buildSecrets` ignores
 * them outright (empty means all — that is the register). Shipping both would put two
 * differently-filtered copies of the same three tables in one payload with nothing saying
 * which is which. The one that ignores severity is the honest one, and it is the one kept.
 */
export function getSecretsPage(p?: unknown): ApiResult {
  return run(() => {
    const params = modelParams(p);
    const register = { ...readModels.registerModel("secrets", params) };
    delete register["segments"];
    return { register, secrets: readModels.secretsModel(params) };
  });
}

/** The estate: repositories as the asset, and the language cut beside them. Ships whole — the
 *  profile is one row per repo, bounded by the estate rather than by the ledger. */
export function getReposPage(p?: unknown): ApiResult {
  return run(() => readModels.reposModel(modelParams(p)));
}

/**
 * Scan History: what was measured and when.
 *
 * ENUMERATED, NOT SPREAD, and both omissions are the reason. `historyModel().history` is the
 * whole `mttr_history` set and this page never dereferences it — only the MTTR page does — and
 * the raw `trend` carries nine fields per point where this page draws five. Spreading the
 * model and patching two keys would ship both by default the day a third key is added.
 */
export function getScanHistory(p?: unknown): ApiResult {
  return run(() => {
    const h = readModels.historyModel(modelParams(p));
    return {
      asOf: h["asOf"],
      asOfSource: h["asOfSource"],
      observedFrom: h["observedFrom"],
      scope: h["scope"],
      severities: h["severities"],
      showNoFix: h["showNoFix"],
      kpis: h["kpis"],
      perScope: h["perScope"],
      // The scans tab narrowed to the ten columns the table draws — raw_ref / obs_ref are
      // Drive file ids and are not among them (pagePayload.ts's SCAN_ROW_KEYS).
      scans: scanRowsSlice(h["scans"]),
      trends: historyTrendSlice(h),
    };
  });
}

/** What the register costs and what is consuming the cell ceiling. */
export function getStorageStats(_p?: unknown): ApiResult {
  return run(() => readModels.storageModel());
}

// --------------------------------------------------------------------------------------- //
//  Jobs
// --------------------------------------------------------------------------------------- //

/**
 * Start the sync battery.
 *
 * `run`, NOT `mutate`. `scanJobs.startSync` opens with `withScriptLock(() => { recoverIfNeeded();
 * ... })` itself — the same two things `mutate` does — and nesting them would hand the inner
 * frame's `finally` a `releaseLock()` on a lock the outer frame still expects to hold.
 */
export function runSync(p?: unknown): ApiResult {
  return run(() => {
    const raw = ((p ?? {}) as Rec)["scopes"];
    const scopes = Array.isArray(raw)
      ? raw.map(String).filter((s): s is Scope => (SCOPES as readonly string[]).includes(s))
      : undefined;
    return scanJobs.startSync(scopes ? { scopes } : {});
  });
}

/**
 * One job for the progress poll — THROUGH `jobSummarySlice`, NEVER the raw `JobRow`.
 *
 * This is polled every three seconds for the life of a sync. The row carries `cursor` (the Wiz
 * `endCursor` for a production security tenant) and `journal_ref` (a Drive file id for the
 * rollback journal), and neither has any business in a browser. `jobSummarySlice` is an
 * ALLOWLIST that does not name them and only ever parses `params_json` for one boolean, so the
 * exclusion is structural rather than a `delete` someone can forget to repeat — see that
 * function's SECURITY RULE and `test/api.test.ts`'s assertion over the full `JSON.stringify`.
 *
 * `stale` is decided HERE, server-side, against the server clock: a browser with a skewed
 * clock would otherwise draw a healthy job as wedged. A terminal job is never stale — it is
 * finished.
 */
export function getJobStatus(p?: unknown): ApiResult {
  return run(() => {
    const jobId = String(((p ?? {}) as Rec)["jobId"] ?? "");
    const job: JobRow | null = jobId ? getJob(jobId) : activeJob();
    if (!job) return null;
    return jobSummarySlice(job, !isTerminalPhase(job.phase) && isStaleJob(job));
  });
}

/**
 * Request cancellation of the running sync.
 *
 * `run`, NOT `mutate`, and this one is not merely avoiding a nested lock — `cancelSync` is
 * documented lock-free BY DESIGN. During FETCHING the flag it writes is read by the page loop
 * of an execution that is holding the lock right now, so taking the lock here would block on
 * exactly the execution Stop is trying to reach, for the full timeout, and then fail.
 */
export function cancelSync(p?: unknown): ApiResult {
  return run(() => scanJobs.cancelSync(String(((p ?? {}) as Rec)["jobId"] ?? "")));
}

// --------------------------------------------------------------------------------------- //
//  Data page — maintenance
// --------------------------------------------------------------------------------------- //

/** Delete scans and replay the survivors. Journaled inside `ledgerStore`; the lock is this
 *  layer's, so a delete cannot interleave with a persist. */
export function deleteScans(p?: unknown): ApiResult {
  const scanIds = (((p ?? {}) as Rec)["scanIds"] as unknown[] | undefined ?? []).map(String);
  return mutate(() => ledgerStore.deleteScans(scanIds));
}

/**
 * Compaction, and its dry run.
 *
 * THE DRY RUN IS A READ and takes no lock: `previewMaintenance` plans against a state read and
 * writes nothing. Routing it through `mutate` would make looking at the Data page contend with
 * a running sync for no reason.
 *
 * `retentionDays` falls back to the SETTING rather than to a constant, so the preview a reader
 * is shown and the compaction the post-sync path runs are the same window by construction
 * (`scanJobs.autoCompactIfDue` reads the same two fields).
 */
export function compact(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  const dryRun = params["dryRun"] === true;
  const days = params["retentionDays"] !== undefined && params["retentionDays"] !== null
    ? Number(params["retentionDays"])
    : loadSettings().retentionDays;
  if (dryRun) return run(() => ledgerStore.previewMaintenance(days));
  return mutate(() => ledgerStore.compactLedger(days, false));
}

/**
 * Wipe the ledger back to a fresh, never-compacted state.
 *
 * The continuation triggers go first, best effort: a sync mid-walk would otherwise commit its
 * battery on top of the wipe. A stray trigger left behind is harmless once the `jobs` tab is
 * cleared (it wakes, finds no active job, and self-deletes), but stopping it early is cheaper
 * than relying on that.
 */
export function resetLedger(_p?: unknown): ApiResult {
  return mutate(() => {
    try {
      scanJobs.clearContinuationTriggers();
    } catch (e) {
      console.warn(`resetLedger: continuation-trigger cleanup skipped: ${e}`);
    }
    return ledgerStore.resetLedger();
  });
}

// --------------------------------------------------------------------------------------- //
//  Data page — export and diagnostics
// --------------------------------------------------------------------------------------- //

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The ledger as CSV — the audit artifact.
 *
 * THE COLUMN LIST IS READ OFF `TAB_HEADERS[TABS.ledger]` AT RUN TIME, never re-literaled here
 * and never taken from the rows. Both alternatives fail the same way: `loadBaseRows` returns
 * `LedgerRow` plus five derived clock fields, so `Object.keys(row)` would export
 * `mttr_days` / `awaiting_vendor_fix` / ... — columns that do not exist in the register and
 * that nothing downstream could round-trip — and a second literal list would drift from the
 * tab the day a column is added. Reading the live headers means the export is exactly the
 * ledger.
 *
 * NO SECRET VALUE CAN APPEAR HERE, and that is true by construction rather than by filtering:
 * the ledger has no column holding one (`scanJobs.DENIED_KEY` refuses `snippet` and
 * `validationDetails` at ingest), so there is nothing to strip. Keep it that way — a column
 * added upstream would arrive in this export automatically.
 */
export function getExportCsv(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const scope = requestedScope(p);
    const sevRaw = params["severities"];
    const severities = Array.isArray(sevRaw) && sevRaw.length
      ? new Set(sevRaw.map((s) => normalizeSeverity(s)))
      : null;
    const statusRaw = params["statuses"];
    const statuses = Array.isArray(statusRaw) && statusRaw.length
      ? new Set(statusRaw.map((s) => String(s).toUpperCase()))
      : null;

    const rows = (ledgerStore.loadBaseRows(scope ? { scope } : {}) as unknown as Rec[])
      .filter((r) => !severities || severities.has(normalizeSeverity(r["severity"])))
      .filter((r) => !statuses || statuses.has(String(r["status"] ?? "").toUpperCase()));

    const cols = TAB_HEADERS[TABS.ledger] ?? [];
    const lines = [cols.join(",")];
    for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
    return {
      content: lines.join("\r\n"),
      filename: `wiz-devsecops-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      rowCount: rows.length,
      columns: cols.length,
      scope,
    };
  });
}

/**
 * How many failures the diagnostics panel looks back over. Jobs are single-flight and one row
 * is appended per sync, so 50 is several weeks of a daily schedule.
 */
const RECENT_ERROR_LIMIT = 50;

/**
 * The recent server-side failures, newest first.
 *
 * DIVERGENCE (gas/), AND THE SOURCE IS DIFFERENT ON PURPOSE. gas/ serves this from an
 * `errorLog` tab that S4 deliberately did not port: a tab written on every caught throw is a
 * second write path into the spreadsheet whose failure mode is a full sheet, and this register
 * has one place that already records a failure with its context — the `jobs` tab's `error`
 * column, which every terminal transition, `reclaimIfStale` and `recoverIfNeeded` write. So
 * this reads that, and NO ERROR-LOG TAB WAS CREATED.
 *
 * WHAT THAT COSTS, STATED RATHER THAN HIDDEN: this reports job failures only. A read RPC that
 * throws returns `{ok:false}` to its caller and leaves no row, so it will not appear here.
 * That is a narrower panel than gas/'s and the payload says so in `covers`.
 *
 * ENUMERATED, NOT SPREAD. `cursor` and `journal_ref` are on every `JobRow` and a spread would
 * ship both — the same allowlist discipline `jobSummarySlice` exists for.
 */
export function getRecentErrors(p?: unknown): ApiResult {
  return run(() => {
    const raw = Number(((p ?? {}) as Rec)["limit"] ?? RECENT_ERROR_LIMIT);
    const limit = Number.isFinite(raw) && raw > 0
      ? Math.min(Math.floor(raw), RECENT_ERROR_LIMIT)
      : RECENT_ERROR_LIMIT;
    const errors = listJobs()
      .filter((j) => j.error !== null && j.error !== "")
      .map((j) => ({
        job_id: j.job_id,
        kind: j.kind,
        phase: j.phase,
        scope: j.scope,
        at: j.updated_at,
        started_at: j.started_at,
        error: j.error,
      }))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, limit);
    return {
      errors,
      // The panel must be able to say what it is NOT showing.
      covers: "jobs",
      note: "Job failures only — this register has no error-log tab. A read that fails returns "
        + "its message to the caller and records no row.",
    };
  });
}
