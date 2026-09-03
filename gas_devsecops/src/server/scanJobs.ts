// The sync battery: ONE JOB WALKING THREE SCOPES SEQUENTIALLY, as a resumable state machine.
//
// A six-minute Apps Script execution cannot hold a ~41-page walk plus a wholesale ledger
// rewrite, so a sync runs across several executions: each hop takes a wall-clock budget,
// spills what it has to Drive, schedules a one-shot trigger, and returns. The `jobs` row is
// both the resume point and the UI's progress API.
//
// ------------------------------------------------------------------ ONE JOB, NOT THREE
//
// The obvious alternative — one job per scope, three batteries in parallel — was rejected,
// and the reasons are structural rather than stylistic:
//
//   1. THE SINGLE-FLIGHT GUARD ALREADY ASSUMES EXACTLY ONE IN-FLIGHT JOB. `jobsStore`
//      answers "is anything running" from ONE Script Property (`ACTIVE_JOB_ID`) verified
//      against the FIRST non-terminal row (`activeJob()`), and `locks.recoverIfNeeded()`
//      reaps that one job. Three concurrent jobs would make `activeJob()` a lie — it would
//      return whichever row came first — and recovery would reap one crash while leaving
//      two.
//   2. TRIGGER QUOTA. Each job needs a continuation AND a watchdog one-shot
//      (`jobsStore.CONTINUE_HANDLERS` / `WATCHDOG_HANDLERS`). Three jobs is six dynamic
//      triggers against Apps Script's 20-trigger project quota, before the daily sync and
//      the warm schedule take theirs.
//   3. THREE COMMITS WOULD TEAR EVERY CROSS-SCOPE FIGURE. `ledgerStore.persistSync` takes
//      ALL scopes in one call, reconciles them onto one in-memory state, and appends their
//      `scans` rows in ONE `appendRows` — that append IS the commit (locks.ts, step 3).
//      Three separate commits would leave windows in which the ledger holds sast's rewrite
//      while the tab claims only sca ran, and every figure that spans scopes would be
//      computed over a half-written register.
//   4. THE WALK IS NOT BIG ENOUGH TO NEED IT. At 500 rows a page the live registers are
//      sca 17,991 (36 pages) + sast 127 (1) + secrets 1,958 (4) = ~41 pages — one or two
//      continuation hops for the whole battery, not three batteries.
//
// ------------------------------------------------------------------------- the shape
//
// Phases on the jobs tab: FETCHING(scope, cursor, page) -> RECONCILING -> PERSISTING ->
// DONE. `scan_id` on the job row is THE BARE syncId (jobsStore's header comment); the Drive
// archive is addressed by the composite `ledgerStore.scanIdFor(syncId, scope)`.
//
// Cancellation is a Script Property (`CANCEL_<jobId>`) rather than a jobs-tab write, because
// a running hop holds the script lock for its whole duration and a lock-bound write would
// block behind it. THE FLAG IS RE-READ AT THE TOP OF EVERY LOOP ITERATION AND NEVER
// MEMOISED — memoising it is the same as not having it: the value is written by another
// execution while this one is inside the loop.
//
// Nothing is committed until `persistSync`, so a cancel at any point during FETCHING leaves
// the ledger untouched and only a partial Drive archive to trash.
//
// ------------------------------------------------------------ divergences from gas/
//
//   * NO `shape`. gas/ carries a grouped/flat scan shape and a `sampleShape` option to pick
//     between them; this register's `scans` tab has no `shape` column and every scan is
//     flat, so the branch and the option are gone rather than ported dead.
//   * NO `refreshSupportGroupsAfterScan`. There are no support groups here — ownership comes
//     from `projects[]` on the node itself (reconcile.ts's ownerProject/ownerPath).
//   * NO dry-run scan. gas/ persists a bundled `SAMPLE_FLAT` when credentials are missing;
//     this project ships no sample data, and inventing one would put fabricated findings in
//     a security register. Without credentials `startSync` refuses and says why.
//   * NO incremental / delta mode. `wizQueries.ts` deleted its `updatedAfter` filter on the
//     grounds that its shape was never checked against any of the three schemas — see that
//     file's note. A second unverified filter shape is exactly the failure that cost this
//     register its whole SAST population once.
//   * NO `errorLog`. This project has no error-log tab; failures land in the job row's
//     `error` column and in `console`.
//
// NOTHING MAY IMPORT THIS MODULE. `locks` imports `ledgerStore`, and this file imports both;
// the graph stays acyclic only while scanJobs is a leaf (S7 wires it into `api.ts`, which
// this file must never import back).

import { SCOPES, type Scope } from "../domain/config";
import { mttrFromLedger } from "../domain/lifecycle";
import { nowIso, pushAll, type Rec } from "../domain/util";
import * as archive from "./archiveStore";
import * as history from "./historyStore";
import {
  activeJob,
  clearTriggers,
  CONTINUE_HANDLERS,
  createJob,
  getJob,
  isTerminalPhase,
  newJobId,
  reclaimIfStale,
  updateJob,
  WATCHDOG_HANDLERS,
  type JobKind,
  type JobPhase,
  type JobRow,
} from "./jobsStore";
import * as ledgerStore from "./ledgerStore";
import * as readModels from "./readModels";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { deleteProp, getProp, hasWizCredentials, projectScope, setProp } from "./props";
import { loadSettings } from "./settingsStore";
import { fetchPage, newScanPaging, PAGE_SIZE, type ScanPaging } from "./wizClient";
import { buildVariables } from "./wizQueries";

/* ------------------------------------------------------------------- constants */

/** 4.5 min of a 6-min execution — the budget a continuation hop walks pages under. */
const BUDGET_MS = 270_000;
/** The first hop runs inside the "Run sync" RPC; keep that round trip snappy. */
const FIRST_STEP_BUDGET_MS = 45_000;
const CONTINUE_DELAY_MS = 30_000;
// A hop that couldn't take the lock waits longer than a normal yield: the holder is another
// mutation running to completion, and re-firing every 30s just burns trigger runtime quota.
const CONTINUE_RETRY_MS = 90_000;

/** Handler names are jobsStore's, per kind — never invented here. */
const CONTINUE_HANDLER = CONTINUE_HANDLERS.sync as string;
const WATCHDOG_HANDLER = WATCHDOG_HANDLERS.sync as string;

const SYNC_KIND: JobKind = "sync";

// Liveness probe for Stop. A hop holds the script lock for its whole duration, so failing to
// take it means something is genuinely executing. One second is inside the noise of an
// unrelated read, which turns incidental contention into a dead Stop button.
const FORCE_STOP_LOCK_MS = 10_000;

/**
 * How many `partialErrors` strings one scope keeps on the job row.
 *
 * `partialErrors` is NOT an error channel (wizClient.ts): a page carrying both nodes and
 * errors has good nodes and a suspect count, so the caveat is recorded BESIDE the rows and
 * neither is discarded. The cap is about the cell, not the caveat — `params_json` is one
 * spreadsheet cell and a pathological run could otherwise write megabytes into it. The COUNT
 * (`partialPages`) is never capped, so "how many pages were partial" stays exact even when
 * the sample is truncated.
 */
const MAX_PARTIAL_ERRORS = 10;

/* ------------------------------------------------------------------ cancellation */

class SyncCancelled extends Error {}

const cancelKey = (jobId: string) => `CANCEL_${jobId}`;

/**
 * Whether a stop has been requested. READ, NEVER CACHED — the property is written by a
 * different execution while this one sits inside the page loop, so a value hoisted out of
 * the loop is a value that can never become true.
 */
function isCancelRequested(jobId: string): boolean {
  return Boolean(getProp(cancelKey(jobId)));
}

function clearCancel(jobId: string): void {
  deleteProp(cancelKey(jobId));
}

/* ------------------------------------------------------------------ job params */

/** One scope's fetch progress, carried on the job row so a resumed hop can report it. */
export interface ScopeProgress {
  /** Pages of THIS scope already fetched and archived. */
  pages: number;
  /** Rows of THIS scope in the spill file. */
  rows: number;
  /** Drive folder id of the scope's archived raw pages. Internal — never sent to a client. */
  rawRef: string | null;
  /** What the tenant said this scope's query totals. 0 = not reported yet. */
  totalCount: number;
  /** How many pages came back PARTIAL (nodes AND errors). Never capped. */
  partialPages: number;
  /** A capped sample of those errors — see MAX_PARTIAL_ERRORS. */
  partialErrors: string[];
}

/**
 * The job's `params_json`. The row's own columns carry the CURRENT scope's paging
 * (`scope`, `cursor`, `page`, `page_size`, `total_count`); this carries the battery.
 */
export interface SyncParams {
  syncId: string;
  scopes: Scope[];
  /** Index into `scopes` of the scope in flight. `>= scopes.length` means fetching is done. */
  scopeIndex: number;
  severitiesByScope: Record<string, string[]>;
  perScope: Record<string, ScopeProgress>;
}

function emptyProgress(): ScopeProgress {
  return { pages: 0, rows: 0, rawRef: null, totalCount: 0, partialPages: 0, partialErrors: [] };
}

/**
 * The job's params, repaired into shape.
 *
 * THROWS on a job with no usable `syncId`, rather than inventing one: a sync whose id was
 * lost cannot address the archive it already wrote, so resuming it would start a second
 * register's worth of Drive files under a new id and commit them as one scan.
 */
function parseParams(job: JobRow): SyncParams {
  let raw: Rec = {};
  try {
    const parsed = JSON.parse(job.params_json ?? "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Rec;
  } catch {
    /* fall through to the syncId check below — a job with unreadable params is unresumable */
  }
  const syncId = String(raw["syncId"] ?? job.scan_id ?? "");
  if (!syncId) {
    throw new Error(`Sync job ${job.job_id} carries no syncId — it cannot be resumed.`);
  }
  const scopes = (Array.isArray(raw["scopes"]) ? (raw["scopes"] as unknown[]) : [])
    .map((s) => String(s))
    .filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  const severities = (raw["severitiesByScope"] ?? {}) as Record<string, unknown>;
  const stored = (raw["perScope"] ?? {}) as Record<string, unknown>;

  const params: SyncParams = {
    syncId,
    scopes: scopes.length ? scopes : [...SCOPES],
    scopeIndex: Number(raw["scopeIndex"] ?? 0) || 0,
    severitiesByScope: {},
    perScope: {},
  };
  for (const scope of params.scopes) {
    const sev = severities[scope];
    params.severitiesByScope[scope] = Array.isArray(sev) ? sev.map((s) => String(s)) : [];
    const p = stored[scope];
    params.perScope[scope] =
      p && typeof p === "object" && !Array.isArray(p)
        ? { ...emptyProgress(), ...(p as Partial<ScopeProgress>) }
        : emptyProgress();
  }
  return params;
}

function progressFor(params: SyncParams, scope: Scope): ScopeProgress {
  const existing = params.perScope[scope];
  if (existing) return existing;
  const fresh = emptyProgress();
  params.perScope[scope] = fresh;
  return fresh;
}

/* -------------------------------------------------------------------- slimRecord */

/**
 * THE SLIM PROJECTION IS A THREE-SITE CONTRACT: the query selects a field, the slim keeps it,
 * reconcile reads it. A field dropped here is a field `domain/reconcile.ts` can never see,
 * and the failure is not an error — it is a NULL LEDGER COLUMN that looks like a tenant that
 * does not populate the field. `test/scanJobs.test.ts` feeds these projections straight into
 * `reconcile()` per scope and asserts every column the scope's query CAN fill comes out
 * non-null, which is the only check that catches a silent drop.
 *
 * The raw pages in Drive keep the whole node; this is the replayable payload
 * (`ledgerStore.readPayloadForRow` prefers `slim.json.gz` precisely so a replay reads exactly
 * what the original run read).
 *
 * WHAT EACH SCOPE'S LIST IS FOR, beyond the fields reconcile reads today: `updatedAt`,
 * `resolutionReason`, `lastSeenAt`, `lastUpdatedAt`, `externalId` and the commit hashes are
 * audit fields the query already selects. They cost bytes in a gzipped Drive file and they
 * are the difference between a replay that can answer a new question and one that has to
 * re-fetch the tenant.
 */
export const SLIM_FIELDS: Record<Scope, readonly string[]> = {
  sca: [
    "id", "name", "detailedName", "severity", "status",
    "firstDetectedAt", "lastDetectedAt", "resolvedAt",
    "fixDate", "fixedVersion",
    "hasExploit", "hasCisaKevExploit", "epssProbability",
  ],
  sast: [
    "id", "name", "status", "severity", "originalSeverity",
    "filePath", "startLine", "codeLibraryLanguage", "origin", "resolutionReason",
    "createdAt", "updatedAt", "firstDetectedAtSource",
  ],
  secrets: [
    "id", "externalId", "secretDataId", "name", "type", "confidence", "severity",
    "path", "lineNumber", "status", "resolvedAt",
    "validationStatus", "lastValidatedAt",
    "firstSeenAt", "lastSeenAt", "lastUpdatedAt", "codeToCloudPipelineStage",
  ],
};

/** Nested single objects, each with its own allow-list. */
export const SLIM_NESTED: Record<Scope, Record<string, readonly string[]>> = {
  sca: {
    // `tags` is kept whole: reconcile's tagsJson reads the dict, and Q_SCA does not select
    // it today — so this is the seat, empty, rather than a mapping that has to be added
    // later in two places at once.
    vulnerableAsset: [
      "id", "name", "type", "cloudPlatform",
      "subscriptionName", "subscriptionExternalId", "tags",
    ],
    artifactType: ["codeLibraryLanguage"],
  },
  sast: {
    resource: ["id", "name", "type"],
    vcsDetails: ["commitHash"],
    aiAnalysis: ["verdict"],
  },
  secrets: {
    resource: ["id", "name", "type", "externalId", "nativeType", "cloudPlatform"],
    // `initialCommitHash`, NOT `commitHash` — SecretInstanceVcsDetails has no `commitHash`
    // (wizQueries.ts trap 1). Copying SAST's spelling here would silently drop the column.
    vcsDetails: ["initialCommitHash"],
  },
};

/** Lists of objects, each element projected through its own allow-list. */
export const SLIM_LISTS: Record<Scope, Record<string, readonly string[]>> = {
  // `projects` is listed for all three scopes even though Q_SCA does not select it: it is
  // this register's only ownership dimension, and the day the SCA document gains it the
  // projection must not be the thing that swallows it.
  sca: { projects: ["id", "name", "isFolder", "slug"] },
  sast: { projects: ["id", "name", "isFolder", "slug"], weaknesses: ["id", "name"] },
  secrets: { projects: ["id", "name", "isFolder", "slug"] },
};

/**
 * THE DENY-LIST, and it wins over every allow-list above.
 *
 * `snippet` (the matched text) and `validationDetails` must NEVER reach the durable store.
 * That store is a Google Sheet plus Drive archives readable by everyone on the allowlist and
 * exportable to CSV by any of them — a far wider audience than the repository the secret is
 * in, and 1,859 of the 1,933 CODE-scoped instances are OPEN, so most of that text is live
 * credential material. A secrets tool that copies secrets into a spreadsheet has made the
 * exposure worse.
 *
 * `wizQueries.ts` already refuses to SELECT either field, and `test/wizQueries.test.js` holds
 * that side. This is the second gate, and it covers two things the allow-lists above cannot:
 *
 *   1. THE ALLOW-LIST ITSELF. The day someone adds `snippet` to SLIM_FIELDS.secrets for a
 *      drill-down, this is what stops it reaching Drive. `test/scanJobs.test.ts` holds the
 *      allow-lists against this pattern for exactly that case — which is why the tables and
 *      the pattern are both exported.
 *   2. FREE-FORM TENANT DATA. `vulnerableAsset.tags` is copied WHOLE (it is a dict whose keys
 *      are the tenant's, not ours), so a tag literally named `snippet` or `validationDetails`
 *      would otherwise ride straight through the projection. That path is reachable today and
 *      is what the recursive walk is actually for.
 */
export const DENIED_KEY = /snippet|validationDetails/i;

function stripDenied(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDenied);
  if (value !== null && typeof value === "object") {
    const out: Rec = {};
    for (const [k, v] of Object.entries(value as Rec)) {
      if (DENIED_KEY.test(k)) continue;
      out[k] = stripDenied(v);
    }
    return out;
  }
  return value;
}

function project(src: Rec, keys: readonly string[]): Rec {
  const out: Rec = {};
  for (const k of keys) {
    if (k in src) out[k] = src[k];
  }
  return out;
}

/** One raw Wiz node reduced to the record `domain/reconcile.ts` reads. See SLIM_FIELDS. */
export function slimRecord(scope: Scope, node: Rec): Rec {
  const out = project(node, SLIM_FIELDS[scope]);
  for (const [key, keys] of Object.entries(SLIM_NESTED[scope])) {
    const v = node[key];
    if (v !== null && typeof v === "object" && !Array.isArray(v)) out[key] = project(v as Rec, keys);
  }
  for (const [key, keys] of Object.entries(SLIM_LISTS[scope])) {
    const v = node[key];
    if (!Array.isArray(v)) continue;
    out[key] = v.map((e) =>
      e !== null && typeof e === "object" && !Array.isArray(e) ? project(e as Rec, keys) : e,
    );
  }
  return stripDenied(out) as Rec;
}

/* --------------------------------------------------------------- page envelopes */

/**
 * The connection root each scope's document returns under `data`, so an archived page is
 * shaped like the response it came from. `maintenance.recordsFromPayload` walks `data` for
 * the first key carrying `nodes` and does not care which — but a page file that does not
 * look like what Wiz sent is a page file nobody can diff against a live response.
 */
const CONNECTION_ROOT: Record<Scope, string> = {
  sca: "vulnerabilityFindings",
  sast: "sastFindings",
  secrets: "secretInstances",
};

function envelope(scope: Scope, nodes: Rec[]): Rec {
  return { data: { [CONNECTION_ROOT[scope]]: { nodes } } };
}

/* ------------------------------------------------------------------------ start */

export interface StartResult {
  jobId: string | null;
  message: string;
}

export interface StartOptions {
  /** Override the settings' scope list (the daily trigger and the UI both pass nothing). */
  scopes?: readonly Scope[];
}

/**
 * Start the sync battery. Single-flight: an existing job is reported rather than raced,
 * unless it has gone stale (no progress for `jobsStore.STALE_JOB_MS`), in which case it is
 * reclaimed first.
 *
 * The first hop runs inline under a short budget so the RPC returns quickly; the rest of the
 * walk arrives on continuation triggers.
 */
export function startSync(options: StartOptions = {}): StartResult {
  return withScriptLock(() => {
    recoverIfNeeded();
    const active = activeJob();
    if (active && !reclaimStaleJob(active)) {
      return { jobId: active.job_id, message: "A sync is already in progress." };
    }
    if (!hasWizCredentials()) {
      // No sample data to fall back on, and fabricating findings in a security register is
      // the one thing this product does not do. See the dry-run divergence in the header.
      return {
        jobId: null,
        message: "No Wiz credentials are configured — run setup() before syncing.",
      };
    }

    const settings = loadSettings();
    const scopes = [...(options.scopes ?? settings.scopes)].filter((s): s is Scope =>
      (SCOPES as readonly string[]).includes(s),
    );
    if (!scopes.length) {
      return { jobId: null, message: "No registers are selected — choose one in Settings." };
    }

    const syncId = nowIso();
    const params: SyncParams = {
      syncId,
      scopes,
      scopeIndex: 0,
      severitiesByScope: {},
      perScope: {},
    };
    for (const scope of scopes) {
      // Empty means ALL, and on `secrets` that is the default and is deliberate — severity
      // grades a DETECTION there, not whether a credential is live (config.ts).
      params.severitiesByScope[scope] = [...(settings.fetchSeverities[scope] ?? [])];
      params.perScope[scope] = emptyProgress();
    }

    const job = createJob({
      job_id: newJobId(SYNC_KIND),
      kind: SYNC_KIND,
      phase: "FETCHING",
      // THE BARE syncId. The composite `<syncId>-<scope>` is the DRIVE address only —
      // ledgerStore.scanIdFor's comment has the measurement that settled it.
      scan_id: syncId,
      scope: scopes[0] ?? null,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: JSON.stringify(params),
      journal_ref: null,
      error: null,
    });
    step(job, FIRST_STEP_BUDGET_MS);
    return { jobId: job.job_id, message: "Sync started." };
  });
}

/**
 * A job with no progress for `jobsStore.STALE_JOB_MS` died mid-flight. This runs inside
 * startSync's lock, so no hop can be executing — a stale job is definitively dead, and any
 * continuation trigger still listed is dead with it. `reclaimIfStale` clears both of that
 * kind's triggers.
 */
function reclaimStaleJob(job: JobRow): boolean {
  if (!reclaimIfStale(job)) return false;
  clearCancel(job.job_id);
  return true;
}

/* ------------------------------------------------------------------------- step */

/** Write this scope's resumable spill: the slim records and the page/count log. */
function spill(archiveId: string, slim: Rec[], runs: Array<[number, number]>): void {
  archive.writeSlim(archiveId, slim);
  archive.writePageRuns(archiveId, runs);
}

/**
 * One execution hop of the battery.
 *
 * Walks scopes in order from `params.scopeIndex`, pages within each, and yields via a
 * one-shot trigger the moment the budget is spent. Every page writes the job row, because
 * that row IS the progress API the client polls.
 */
function step(job: JobRow, budgetMs = BUDGET_MS): void {
  const started = Date.now();
  const params = parseParams(job);
  const jobId = job.job_id;
  const projectId = projectScope()?.[0] ?? null;
  let findings = job.findings_so_far;

  try {
    while (params.scopeIndex < params.scopes.length) {
      const scope = params.scopes[params.scopeIndex]!;
      const archiveId = ledgerStore.scanIdFor(params.syncId, scope);
      const progress = progressFor(params, scope);

      // RESUME ONLY WHEN THE ROW NAMES THIS SCOPE. `job` is the row as it was read at the
      // top of this hop; once the loop advances past a scope, its cursor and page belong to
      // a scope that is finished, and carrying them into the next one would skip pages.
      const resuming = job.scope === scope;
      const paging: ScanPaging = newScanPaging(
        resuming && job.page_size > 0 ? job.page_size : PAGE_SIZE,
      );
      paging.pageNumber = resuming ? job.page : 0;
      let cursor = resuming ? job.cursor : null;
      // Page N was already archived; the spill holds its rows. Re-reading them is what stops
      // a resumed hop re-fetching a page it has already paid for.
      const slim: Rec[] =
        paging.pageNumber > 0 ? ((archive.readSlim(archiveId) as Rec[] | null) ?? []) : [];
      const runs: Array<[number, number]> =
        paging.pageNumber > 0 ? (archive.readPageRuns(archiveId) ?? []) : [];

      for (;;) {
        // Stop check, RE-READ EVERY ITERATION. Honored only during FETCHING, where nothing
        // is committed — the `scans` rows are appended last, inside persistSync.
        if (isCancelRequested(jobId)) throw new SyncCancelled();

        const variables = buildVariables(scope, {
          severities: params.severitiesByScope[scope] ?? [],
          projectId,
          after: cursor,
        });
        // 1-based archive page name, computed BEFORE the fetch: `fetchPage` advances
        // `paging.pageNumber` itself (and owns the 500 -> 250 size probe).
        const pageIndex = paging.pageNumber + 1;
        const page = fetchPage(scope, variables, paging);

        archive.writeScanPage(archiveId, pageIndex, envelope(scope, page.nodes));
        // Not slim.push(...nodes): a page is findings-scale and a spread over one overflows
        // the GAS stack (domain/util.ts's pushAll exists for exactly this).
        pushAll(slim, page.nodes.map((n) => slimRecord(scope, n)));
        runs.push([pageIndex, page.nodes.length]);

        findings += page.nodes.length;
        cursor = page.pageInfo.endCursor;
        progress.pages = paging.pageNumber;
        progress.rows = slim.length;
        if (page.totalCount !== null) progress.totalCount = page.totalCount;
        if (page.partialErrors.length) {
          // Recorded beside the rows, never fatal — the nodes are good and the count is
          // suspect (wizClient.ts). Discarding either half would be the lie.
          progress.partialPages += 1;
          for (const message of page.partialErrors) {
            if (progress.partialErrors.length >= MAX_PARTIAL_ERRORS) break;
            progress.partialErrors.push(message);
          }
        }

        updateJob(jobId, {
          scope,
          cursor,
          page: paging.pageNumber,
          page_size: paging.pageSize,
          // Cumulative across the WHOLE sync — this is one job, and the card counts one
          // sync. It therefore DOES NOT pair with `total_count` below, which is only the
          // current scope's total: dividing them is right for the first scope and silently
          // wrong from the second on. An earlier revision of this comment pointed at
          // `params.perScope[scope].rows` as the per-scope numerator; that field is only
          // written when a scope COMPLETES (`progress.rows = slim.length`), so it is absent
          // for exactly the duration anyone would want it, and `params_json` never reaches
          // the browser anyway (pagePayload's JOB_KEYS allowlist).
          //
          // The honest per-scope fraction is PAGE-BASED — `page` and `page_size` are both
          // reset on every scope advance below, so `page * page_size / total_count` is a
          // fraction of one register. syncProgress.js::syncViewModel computes it there.
          findings_so_far: findings,
          // The CURRENT scope's total, per the jobs tab's own column definition.
          total_count: progress.totalCount,
          params_json: JSON.stringify(params),
        });

        if (!page.pageInfo.hasNextPage) break;
        if (Date.now() - started > budgetMs) {
          spill(archiveId, slim, runs);
          scheduleContinuation();
          return;
        }
      }

      // The scope is complete. `hasNextPage === false` is the ONLY thing that advances
      // scopeIndex — a budget yield above returns with the index untouched, so the next hop
      // resumes this scope rather than skipping the rest of it.
      progress.rawRef = archive.scanFolder(archiveId).getId();
      progress.rows = slim.length;
      spill(archiveId, slim, runs);
      params.scopeIndex += 1;

      const nextScope = params.scopes[params.scopeIndex] ?? null;
      updateJob(jobId, {
        scope: nextScope,
        cursor: null,
        page: 0,
        page_size: 0,
        total_count: 0,
        findings_so_far: findings,
        params_json: JSON.stringify(params),
      });

      // Yield between scopes too: starting a fresh register with seconds left buys a page
      // and then spills anyway.
      if (nextScope !== null && Date.now() - started > budgetMs) {
        scheduleContinuation();
        return;
      }
    }

    finishSync(jobId, params);
  } catch (e) {
    if (e instanceof SyncCancelled) {
      finalizeCancel(job, params);
      return;
    }
    clearCancel(jobId);
    updateJob(jobId, {
      phase: "FAILED",
      error: e == null ? "Sync failed." : String(e).slice(0, 1000),
    });
    throw e;
  }
}

/* ------------------------------------------------------------------ finish/persist */

/**
 * Reconcile and commit the whole battery — ONE call, every scope.
 *
 * The watchdog is armed BEFORE the persist and retired the moment it lands. The persist is
 * synchronous and holds the script lock, so if the execution cap takes it mid-write there is
 * otherwise nothing left to notice: PERSISTING schedules no hop of its own, and the only
 * other route into `recoverIfNeeded()` is a write the UI hides behind the job card.
 */
function finishSync(jobId: string, params: SyncParams): void {
  // Past FETCHING the sync finishes (seconds) rather than cancelling; drop any pending Stop
  // request so its flag cannot outlive the job.
  clearCancel(jobId);
  updateJob(jobId, { phase: "RECONCILING", params_json: JSON.stringify(params) });

  const perScope: ledgerStore.ScopePersist[] = params.scopes.map((scope) => ({
    scope,
    // The spill IS the projection reconcile is fed; reading it back rather than keeping it in
    // memory is what lets a battery that spanned three executions commit at all.
    records: (archive.readSlim(ledgerStore.scanIdFor(params.syncId, scope)) as Rec[] | null) ?? [],
    mode: "live",
    scannedSeverities: params.severitiesByScope[scope] ?? [],
    rawRef: params.perScope[scope]?.rawRef ?? null,
  }));

  scheduleWatchdog();
  updateJob(jobId, { phase: "PERSISTING" });
  const outcome = ledgerStore.persistSync(jobId, params.syncId, perScope);
  updateJob(jobId, { phase: "DONE", error: null });
  clearContinuationTriggers(); // the commit record landed — retire the watchdog
  // A Stop pressed during the persist would otherwise leave its CANCEL_ property behind.
  clearCancel(jobId);

  afterPersist(params, outcome);
}

/**
 * The post-commit chores. NONE OF THEM MAY BREAK A SYNC that is already committed, so each
 * is independently guarded.
 */
function afterPersist(params: SyncParams, outcome: ledgerStore.PersistOutcome): void {
  try {
    history.recordDaily(dailyStats(params, outcome));
  } catch (e) {
    console.warn(`Failed to record the daily history entry: ${e}`);
  }
  autoCompactIfDue();
  warmAfterSync();
}

/**
 * The post-sync read-model warm — LAST, and the position is load-bearing twice over.
 *
 * AFTER `autoCompactIfDue`, because a compaction bumps DATA_VERSION again and every cache key
 * is built from it: warming first would compute the whole set under a version nothing can
 * reach a moment later, paying for it and warming nothing.
 *
 * AFTER `updateJob(jobId, {phase: "DONE"})` IN `finishSync`, WHICH IS WHY THIS IS CALLED FROM
 * `afterPersist` AND NOT FROM INSIDE THE COMMIT. `warmReadModels` refuses outright while
 * `jobsStore.activeJob()` returns a row — a PERSISTING job is part-way through a wholesale
 * `overwrite`, so a warm reading the ledger then would cache a TORN read under the pre-bump
 * version and serve it for the rest of the window. `activeJob()` returns null for any terminal
 * phase, so the DONE update above is the only thing that lets this run at all. MOVING THAT
 * UPDATE BELOW `afterPersist` LOOKS TIDIER AND SILENTLY DISABLES THE WARM FOREVER — the sync
 * still succeeds, the pages are still correct, and the only symptom is that the first analyst
 * load after every sync pays the full recompute. `test/api.test.ts`'s "the post-sync warm runs
 * with no active job" case is what stands between that edit and production.
 *
 * BEST EFFORT, like every other chore here: the sync is already committed and a cold cache is
 * not a reason to report a successful commit as a failure.
 */
function warmAfterSync(): void {
  try {
    const report = readModels.warmReadModels();
    if (report.blockedBy) {
      console.warn(`Post-sync read-model warm did not run: ${report.blockedBy}`);
    } else {
      console.log(`Post-sync read-model warm: ${report.warmed} warmed, ${report.skipped} cold.`);
    }
  } catch (e) {
    console.warn(`Post-sync read-model warm failed: ${e}`);
  }
}

/**
 * What one sync contributed, plus where the register's clock stands after it.
 *
 * `historyStore` deliberately leaves the shape to the caller, so this states both halves:
 * the DELTAS (what this sync changed) and the LEVEL (the ledger-sourced MTTR summary after
 * it). The level costs one snapshot read — `persistSync` invalidated the memos on commit —
 * and it is what makes a day's entry answer "how are we doing" rather than only "what
 * happened at 02:00".
 */
function dailyStats(params: SyncParams, outcome: ledgerStore.PersistOutcome): Rec {
  const ledger = ledgerStore.loadState().ledger;
  return {
    sync_id: outcome.sync_id,
    at: nowIso(),
    committed_scopes: outcome.committed_scopes,
    scopes: outcome.scopes.map((s) => ({
      scope: s.scope,
      total: s.total,
      written: s.written,
      deltas: s.deltas,
      twins: s.twins,
      pages: params.perScope[s.scope]?.pages ?? 0,
      total_count: params.perScope[s.scope]?.totalCount ?? 0,
      // The caveat travels with the figure: a scope whose pages came back PARTIAL has good
      // rows and a suspect count, and a history entry that hid that would be the lie.
      partial_pages: params.perScope[s.scope]?.partialPages ?? 0,
    })),
    mttr: mttrFromLedger(Object.values(ledger) as unknown as Rec[]),
  };
}

/**
 * Auto-compaction after a commit. OFF unless an operator turned it on in Settings.
 *
 * SETTINGS IS THE SOURCE OF TRUTH, and it is now the only one. This used to read a raw
 * `AUTO_COMPACT_DAYS` Script Property, written when `Settings` had no such knob; it does now
 * (`domain/settingsLogic.ts`: `autoCompact` / `retentionDays`), and the property has been
 * dropped rather than kept as a second home for the same value — the failure that costs is an
 * operator changing the setting, seeing the Data page agree, and compaction continuing to run
 * on whatever the property said.
 *
 * THE DEFAULT DOES NOT MOVE. `autoCompact` defaults to `false` and the property was unset on
 * every existing deployment, and unset meant off — so both before and after this change,
 * compaction runs only where someone opted in. `test/api.test.ts` pins that as a behaviour,
 * not as a reading of the default: a sync over default settings compacts zero times.
 */
function autoCompactIfDue(): void {
  try {
    const settings = loadSettings();
    if (!settings.autoCompact) return;
    const days = Number(settings.retentionDays);
    if (!Number.isFinite(days) || days <= 0) return;
    ledgerStore.compactLedger(Math.floor(days));
  } catch (e) {
    console.warn(`Auto-compaction after the sync failed: ${e}`);
  }
}

/* ------------------------------------------------------------------ cancellation */

/** `stopped` is the client's cue that the job is already terminal — no "Stopping…" to sit in. */
export interface CancelResult {
  jobId: string;
  stopped: boolean;
  message: string;
}

/**
 * Request cancellation of the running sync (lock-free).
 *
 * During FETCHING this is cooperative: the page loop re-reads the flag between pages and
 * bails, and NOTHING IS COMMITTED — the ledger is untouched until `persistSync`. Past that,
 * or when nothing is alive to read the flag at all, `forceStop` finishes the job directly.
 */
export function cancelSync(jobId: string): CancelResult {
  const job = getJob(jobId);
  if (!job) return { jobId, stopped: false, message: "No such job." };
  if (isTerminalPhase(job.phase)) {
    return { jobId, stopped: true, message: "Sync already finished." };
  }
  // Raise the cooperative flag FIRST: a live hop honors it at the next page boundary, and
  // continueJob honors it before its next hop.
  setProp(cancelKey(jobId), "1");
  const message = forceStop(jobId);
  return message === null
    ? { jobId, stopped: false, message: "Stopping sync…" }
    : { jobId, stopped: true, message };
}

/**
 * Finish a sync the cooperative flag cannot reach; returns the message to show, or null when
 * a live hop holds the lock and the flag will do the job.
 *
 * The script lock is the liveness probe: a hop holds it for its whole duration, so acquiring
 * it means no execution is running and the job is dead whatever its row says. What that
 * warrants depends on how far it got — and `recoverIfNeeded()` is what decides for the
 * PERSISTING case, because only the journal can tell a half-written ledger from a committed
 * one. `finalizeCancel` there would trash an archive a committed `scans` row still points at.
 */
function forceStop(jobId: string): string | null {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(FORCE_STOP_LOCK_MS)) return null; // a hop holds it → the flag will fire
  try {
    recoverIfNeeded(); // roll back (or close out) a killed PERSISTING hop
    const job = getJob(jobId);
    if (!job || job.kind !== SYNC_KIND) return null;
    if (isTerminalPhase(job.phase)) {
      // Includes the job recoverIfNeeded just closed out one line above.
      clearContinuationTriggers();
      clearCancel(jobId);
      return "Sync stopped.";
    }
    if (job.phase === "FETCHING" || job.phase === "RECONCILING") {
      clearContinuationTriggers(); // drop any (possibly dead) pending hop
      finalizeCancel(job); // trashes the never-committed archive, phase → CANCELLED
      return "Sync stopped.";
    }
    // A phase recoverIfNeeded() deliberately left alone. Keep the flag raised and leave any
    // watchdog armed rather than stranding the job by deleting its only wake-up.
    return null;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Mark a job cancelled and drop the sync's partial (NEVER-COMMITTED) archive.
 *
 * Safe precisely because the commit is the final `appendRows` inside `persistSync`: a sync
 * cancelled during FETCHING or RECONCILING has written Drive files and nothing else, so
 * trashing them leaves no `scans` row pointing at a hole.
 */
function finalizeCancel(job: JobRow, known?: SyncParams): void {
  let params: SyncParams | null = known ?? null;
  if (params === null) {
    try {
      params = parseParams(job);
    } catch {
      params = null; // unresumable job: nothing addressable to trash
    }
  }
  if (params !== null) {
    for (const scope of params.scopes) {
      try {
        archive.trashScan(ledgerStore.scanIdFor(params.syncId, scope));
      } catch {
        // best-effort cleanup — no scans row was appended, so nothing is committed
      }
    }
  }
  updateJob(job.job_id, { phase: "CANCELLED", error: null });
  clearCancel(job.job_id);
}

/* ------------------------------------------------------------------ continuation */

function scheduleContinuation(delayMs = CONTINUE_DELAY_MS): void {
  ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(delayMs).create();
}

function scheduleWatchdog(delayMs = CONTINUE_DELAY_MS): void {
  ScriptApp.newTrigger(WATCHDOG_HANDLER).timeBased().after(delayMs).create();
}

/**
 * Remove every one-shot this module arms — the continuation AND the watchdog.
 *
 * Both, always, because this is only called on a terminal transition: a watchdog left armed
 * on a job already DONE or CANCELLED wakes up to find nothing to finish and nothing to roll
 * back (jobsStore's WATCHDOG_HANDLERS comment).
 */
export function clearContinuationTriggers(): void {
  clearTriggers(CONTINUE_HANDLER);
  clearTriggers(WATCHDOG_HANDLER);
}

/** Trigger target (`trigger_continueSync`): resume the active sync job. */
export function continueJob(_e?: unknown): void {
  try {
    withScriptLock(() => {
      clearTriggers(CONTINUE_HANDLER);
      const job = activeJob();
      if (!job || job.kind !== SYNC_KIND) return;
      if (job.phase === "FETCHING") {
        if (isCancelRequested(job.job_id)) {
          finalizeCancel(job);
          return;
        }
        step(job);
      } else if (job.phase === "RECONCILING") {
        finishSync(job.job_id, parseParams(job));
      } else if (job.phase === "PERSISTING") {
        // The persist is never re-run from here — the journal, not this hop, is what makes
        // the mutation atomic.
        recoverIfNeeded();
        clearCancel(job.job_id);
      }
    }, 120_000);
  } catch (e) {
    // clearTriggers runs INSIDE the lock, so a lock timeout leaves this hop's one-shot
    // already spent and no successor scheduled — the job would sit in FETCHING with nothing
    // alive to move it. Re-arm before rethrowing.
    if (e instanceof LedgerBusyError) scheduleContinuation(CONTINUE_RETRY_MS);
    throw e;
  }
}

/**
 * Trigger target (`trigger_watchdogSync`): notice a persist whose execution never came back.
 *
 * Armed by `finishSync` before the wholesale rewrite and retired the moment the commit
 * lands, so reaching this with the job still PERSISTING means that execution died mid-write.
 */
export function watchdogSync(_e?: unknown): void {
  try {
    withScriptLock(() => {
      clearTriggers(WATCHDOG_HANDLER);
      const job = activeJob();
      if (!job || job.kind !== SYNC_KIND) return;
      if (job.phase !== "PERSISTING") return;
      recoverIfNeeded();
      clearCancel(job.job_id);
    }, 120_000);
  } catch (e) {
    // The lock being held means the persist is STILL RUNNING. Re-arm rather than disarming
    // the only thing that would notice it dying a minute later.
    if (e instanceof LedgerBusyError) scheduleWatchdog(CONTINUE_RETRY_MS);
    throw e;
  }
}

/** Trigger target (`trigger_dailySync`): the scheduled full battery. */
export function dailySync(): void {
  if (!hasWizCredentials()) return;
  startSync();
}

/** Job status for the UI poller. */
export function jobStatus(jobId: string): JobRow | null {
  return getJob(jobId);
}

/* --------------------------------------------------- operator escape hatch */

export interface ResetResult {
  cleared: boolean;
  jobId: string | null;
  kind: JobKind | null;
  phase: JobPhase | null;
  message: string;
}

/**
 * Last-resort recovery, run from the GAS editor when the web app cannot reach the job at all
 * — a deployment too old to have the Stop path, or a phase no UI surfaces. Everything the
 * in-app Stop does, without needing the web app: roll a killed mid-write back from its
 * journal, delete every one-shot of every kind, force whatever survives to FAILED, and drop
 * the cancel flag.
 *
 * Safe to run when nothing is wrong — with no active job it reports that and touches nothing.
 * The script lock is still taken, so a genuinely running hop is waited for rather than raced.
 */
export function resetStuckJob(): ResetResult {
  const result = withScriptLock((): ResetResult => {
    // Read the row BEFORE recovering, so the report names the phase it was wedged in rather
    // than the terminal one recoverIfNeeded may have just moved it to.
    const before = activeJob();
    recoverIfNeeded();
    if (!before) {
      return { cleared: false, jobId: null, kind: null, phase: null, message: "No active job." };
    }
    for (const handler of Object.values(CONTINUE_HANDLERS)) clearTriggers(handler);
    for (const handler of Object.values(WATCHDOG_HANDLERS)) clearTriggers(handler);
    clearCancel(before.job_id);
    const after = activeJob();
    if (after) {
      updateJob(after.job_id, {
        phase: "FAILED",
        error: "Reset: cleared by resetStuckJob() from the Apps Script editor.",
      });
    }
    return {
      cleared: true,
      jobId: before.job_id,
      kind: before.kind,
      phase: before.phase,
      message: `Cleared ${before.kind} job ${before.job_id} (was ${before.phase}).`,
    };
  }, 120_000);
  console.log(result.message);
  return result;
}
