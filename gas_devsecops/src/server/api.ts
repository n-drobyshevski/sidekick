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
  latestScanSlice,
  mttrGroupTableSlice,
  mttrPageTrendSlice,
  programTrendSlice,
  registerRowsSlice,
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
   * The freshness caption's SYNC — every row of it, not one of them.
   *
   * THIS USED TO PUBLISH A SINGLE ROW and it under-reported by two thirds. One sync writes
   * one `scans` row PER SCOPE, all carrying the same bare syncId in `scan_id` with `scope` as
   * the other half of the key (ledgerStore's `scanIdFor` settled that), and all three share a
   * timestamp. The old loop kept the row with the greatest `ts` under a strict `>`, so among
   * three equal timestamps it kept whichever it happened to meet first and dropped the rest —
   * and the Executive page rendered "Last scan · Dependencies (SCA) · 310 findings" for a
   * sync that had also written 30 SAST and 112 secrets findings.
   *
   * That is the same page which says, two sections higher, that the three registers are never
   * summed into one number because they are three clocks. Naming one of them as "the scan" is
   * the same error from the other direction: silently choosing one register and presenting it
   * as the whole observation.
   *
   * Grouping by `scan_id` is not a heuristic here — it IS the sync, by the key ledgerStore
   * writes. `ts` is the newest among the rows rather than any one row's, since nothing
   * guarantees they are written in the same millisecond.
   *
   * `severities` rides along PER SCOPE because the caption is a claim about coverage, not just
   * about time: a sync that requested CRITICAL/HIGH on SCA has not looked at a MEDIUM, and it
   * is normal here for one scope to be narrowed while another is not — `secrets` runs with the
   * gate off (`null`, meaning all) while `sca` and `sast` do not. A single coverage field could
   * not have said that.
   *
   * `ts` is named for the `scans` column it is read from. It was once published as
   * `finished_at`, a name neither side of the wire had, so the caption would have read "Last
   * scan undefined" the first day a scan row existed.
   */
  latestSync: {
    sync_id: string;
    ts: string;
    total: number;
    scopes: Array<{ scope: string; total: number; severities: string | null }>;
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
  // Pass 1: which sync is newest. Pass 2: every row of THAT sync. Two passes rather than one
  // because the winner is only known at the end, and a sync's rows are not adjacent on the tab.
  let newestTs = "";
  let newestSyncId = "";
  for (const row of scans) {
    const ts = String(row.ts ?? "");
    if (!ts || ts <= newestTs) continue;
    newestTs = ts;
    newestSyncId = String(row.scan_id ?? "");
  }
  let latestSync: Bootstrap["latestSync"] = null;
  if (newestSyncId) {
    const members = scans.filter((r) => String(r.scan_id ?? "") === newestSyncId);
    const order = new Map(SCOPES.map((sc, i) => [String(sc), i]));
    const rows = members
      .map((r) => ({
        scope: String(r.scope ?? ""),
        total: Number(r.total ?? 0),
        severities: r.severities == null ? null : String(r.severities),
        ts: String(r.ts ?? ""),
      }))
      // Battery order, not tab order, so the caption reads the same on every load.
      .sort((a, b) => (order.get(a.scope) ?? 99) - (order.get(b.scope) ?? 99));
    let total = 0;
    let ts = "";
    for (const r of rows) {
      total += r.total;
      if (r.ts > ts) ts = r.ts;
    }
    latestSync = {
      sync_id: newestSyncId,
      ts: ts || newestTs,
      total,
      scopes: rows.map((r) => ({ scope: r.scope, total: r.total, severities: r.severities })),
    };
  }
  return {
    product: "Wiz Sidekick DevSecOps",
    buildId: BUILD_ID,
    hasCredentials: hasWizCredentials(),
    scopes: SCOPES,
    severityOrder: SEVERITY_ORDER,
    slaTargets: SLA_TARGETS,
    latestSync,
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
 *
 * The `<script>` WRAPPER IS STRIPPED, because `chartsLoader.js` on the client does not render
 * this string — it EXECUTES it (`new Function`, a `<script>` element's `textContent`, or a
 * `blob:` URL; see that file's header). The wrapper exists at all only because a GAS project
 * has nowhere to put a bare `.js` file: `HtmlService.createHtmlOutputFromFile` and
 * `include()` both read `.html`, so `esbuild.config.mjs` writes the bundle wrapped in the one
 * shape the platform is willing to store it in. An empty `src` here means the deployment is
 * missing `js_charts.html` (or shipped it empty) — a deploy fault, so it is reported as an
 * error rather than as an empty string the client would go on to try to run.
 *
 * ONE DELIBERATE DEVIATION FROM gas_ai's COPY OF THIS FUNCTION: that version computes
 * `indexOf(">", indexOf("<script"))` without checking that `<script` was found. With no
 * wrapper at all, `indexOf("<script")` is `-1` and `indexOf(">", -1)` searches from the
 * START of the string, so it can latch onto an unrelated `>` inside the source — the closing
 * angle bracket of an arrow function, say — and return a head-truncated string that still
 * looks non-empty. Guarding `start` and requiring `close > open` closes that path.
 */
export function getChartsBundle(_p?: unknown): ApiResult<string> {
  return run(() => {
    const html = HtmlService.createHtmlOutputFromFile("js_charts").getContent();
    const start = html.indexOf("<script");
    const open = start < 0 ? -1 : html.indexOf(">", start);
    const close = html.lastIndexOf("</script>");
    const src = open < 0 || close < open ? "" : html.slice(open + 1, close).trim();
    if (!src) throw new Error("js_charts is missing or empty in this deployment");
    return src;
  });
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
    // `buildRegister` attaches the RAW `ScanRow` `movement()` needs for its change badge —
    // `raw_ref`/`obs_ref` included. `latestScanSlice` is the same allowlist `getScanHistory`
    // already routes its `scans` array through (`pagePayload.ts`'s `SCAN_ROW_KEYS`), applied
    // to this endpoint's singular `latestScan` field.
    const register = { ...readModels.registerModel(scope, modelParams(p)) };
    register["latestScan"] = latestScanSlice(register["latestScan"]);
    return register;
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
    // Same leak, same fix as `getRegisterPage` — see its comment. `registerModel("secrets")`
    // goes through the identical `buildRegister`, so it carries the identical raw `ScanRow`.
    register["latestScan"] = latestScanSlice(register["latestScan"]);
    return { register, secrets: readModels.secretsModel(params) };
  });
}

/**
 * One PAGE of per-finding rows for one register — sca, sast or secrets, all three.
 *
 * UNLIKE `getRegisterPage`, secrets is served here rather than refused: the register-page
 * refusal is about the SEVERITY-shaped blocks that page draws (secrets has none), not about
 * whether the register has rows. A per-finding table is the same question for every scope —
 * "which findings, in what order" — so `REGISTER_ROW_COLUMNS.secrets` answers it with the
 * lifecycle columns that scope actually carries.
 *
 * A READ, LIKE EVERY OTHER GET* HERE — `registerRowsModel` is deliberately not cached (see
 * its own header), so `run()` is still the right wrapper: nothing here writes.
 *
 * THE SLICE HAPPENS HERE, NOT IN `readModels.ts`. `registerRowsModel` returns full `BaseRow`s
 * so the model stays reusable for anything else that wants a page of rows; `registerRowsSlice`
 * is what narrows `model.rows` to the allowlisted columns before they leave the server — the
 * one place a secret's value could newly reach the wire, and an allowlist is why it cannot.
 */
export function getRegisterRows(p?: unknown): ApiResult {
  return run(() => {
    const scope = requestedScope(p);
    if (scope === null) {
      throw new Error("getRegisterRows needs a scope: one of sca, sast, secrets.");
    }
    const r = (p ?? {}) as Rec;
    const params: readModels.RowPageParams = {
      ...modelParams(p),
      page: r["page"],
      pageSize: r["pageSize"],
      sort: r["sort"],
      dir: r["dir"],
      status: r["status"],
    };
    const model = readModels.registerRowsModel(scope, params);
    return { ...model, rows: registerRowsSlice(model["rows"], scope) };
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
