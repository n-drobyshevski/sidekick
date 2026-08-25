// A DURABLE SECOND LEVEL under the CacheService read-model cache.
//
// CacheService's maximum TTL is six hours. That is a platform ceiling, not a choice —
// `DEFAULT_TTL_SEC` is literally "the CacheService maximum". Tenants scan daily, so
// DATA_VERSION does not move for ~24h while every entry lapses three or four times inside that
// window, and each lapse is a multi-second cold load paid by whoever opens the app next. The
// scheduled warm (api.warmReadModelsScheduled) keeps L1 alive between scans; this keeps the
// answer alive even when L1 is not, which also covers a deploy, an eviction, or a tenant nobody
// visited for a day.
//
// Read path: L1 (cached) -> L2 (Drive) -> compute. An L2 hit repopulates L1 for free, because
// `cached()` stores whatever its compute argument returns.
//
// ONLY TIME-INVARIANT READ-MODELS BELONG HERE. `age_days` is not a stored ledger column — it is
// `(Date.now() - first_seen)`, computed per read — and `kaplanMeier` censors every open finding
// at it. So the KM family, openPastSla, the aging buckets, program capacity and all of
// executiveWeekTrend drift with the clock at zero data change, which is exactly why they carry a
// 1h TTL rather than the 6h default. An untimed store has no way to express "this drifts", so
// those models stay L1-only. See the call sites in api.ts for which six are durable.
//
// WHY NOT INSIDE `cached()`. There is no import cycle — serverCache -> archiveStore is acyclic —
// but `cached()` is the one function whose "any cache-layer error falls back to compute()"
// contract is load-bearing, and `test/serverCache.test.ts` stubs no DriveApp, so putting Drive
// in there would push every existing cache test onto the warn-and-fallback path. Composing
// around it leaves that contract untouched. An injected callback would be worse still: it needs
// an init call on doGet, four trigger handlers and every api_* delegator, and a missed one
// disables the L2 with no symptom but latency.

import { listNames, readGzJsonNamed, trashNamed, writeGzJson, subfolder } from "./archiveStore";
import { cached, currentStamp, paramsHash } from "./serverCache";

/** Envelope version. Bump only if the envelope itself changes shape. */
const ENVELOPE_V = 1;

/**
 * Backstop age, deliberately generous. The STAMP is the freshness mechanism — this only caps
 * the blast radius if some future input ever changes without bumping DATA_VERSION and without
 * joining the key. The 6h TTL used to provide that implicitly and this store removes it, so
 * replacing it explicitly costs one comparison.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Envelope {
  v: number;
  stamp: string;
  name: string;
  paramsHash: string;
  writtenAtMs: number;
  value: unknown;
}

/**
 * True only inside `warmReadModels`. WRITES ARE RESTRICTED TO THE WARM, and this is
 * load-bearing rather than tidiness.
 *
 * Deterministic filenames bound the file count only while the (name, params) key space is
 * bounded. If arbitrary reads minted files the space would be names x domains x support groups
 * x severity scopes — and unlike CacheService entries those files never age out, so a file
 * written for a domain that is later renamed has a deterministic name nothing will ever ask for
 * again. Permanently orphaned, and indistinguishable from a legitimately cold scoped file, so
 * the sweep below could not clean it either. Warm-only writes are what make the scheme sound.
 *
 * Reads still check L2 for any params; scoped ones simply find nothing, which preserves the
 * existing stance that a specific domain or support group stays cold.
 */
let warming = false;

/** Filenames `durablyCached` touched during the current warm — the sweep's keep-list. */
let touched: Set<string> | null = null;

/** Run `fn` with L2 writes enabled, recording which entries it touched. */
export function duringWarm<T>(fn: () => T): T {
  warming = true;
  touched = new Set();
  try {
    return fn();
  } finally {
    warming = false;
    // CLEARED ON THE WAY OUT, so a sweep called after the warm has ended cannot run against a
    // keep-list from a warm that is over. `sweepReadModels` treats null as "no warm ran" and
    // does nothing, which is the safe reading — a stale set would name files the current state
    // no longer expects and the sweep would delete live entries.
    touched = null;
  }
}

/**
 * Per-execution circuit breaker. A missing ARCHIVE_FOLDER_ID (requireProp throws) or a revoked
 * Drive scope should cost ONE failed call, not one per durable read-model per request.
 */
let disabled = false;

/** Per-execution folder memo — `subfolder()` is getFolderById + getFoldersByName every call,
 *  and a page reading three durable models would otherwise pay six redundant Drive calls. */
let folderMemo: GoogleAppsScript.Drive.Folder | undefined;
function readModelFolder(): GoogleAppsScript.Drive.Folder {
  if (folderMemo === undefined) folderMemo = subfolder("readmodels");
  return folderMemo;
}

/** The file name for an entry. Derived from the SAME hash the L1 key uses (serverCache
 *  .paramsHash) — a drift there means the L2 silently never hits. */
export function readModelFileName(name: string, params: unknown): string {
  return `rm-${name}-${paramsHash(params)}.json.gz`;
}

/** Why a read did not produce a value — the write path uses it to avoid pointless rewrites. */
type MissReason = "absent" | "stale" | "unreadable" | "disabled";

/** Total: never throws. Returns the stored value or the reason there wasn't one. */
function l2Read(name: string, params: unknown):
{ hit: true; value: unknown } | { hit: false; why: MissReason } {
  if (disabled) return { hit: false, why: "disabled" };
  try {
    const parsed = readGzJsonNamed("readmodels", readModelFileName(name, params));
    if (parsed === null || typeof parsed !== "object") return { hit: false, why: "absent" };
    const env = parsed as unknown as Envelope;
    if (env.v !== ENVELOPE_V || env.name !== name) return { hit: false, why: "stale" };
    if (env.stamp !== currentStamp()) return { hit: false, why: "stale" };
    if (!(typeof env.writtenAtMs === "number")
      || Date.now() - env.writtenAtMs > MAX_AGE_MS) return { hit: false, why: "stale" };
    // `value` is read off the envelope rather than returned as the parse result, which is what
    // lets a legitimately-null payload be a hit — `readGzJsonNamed` returns null for an
    // unreadable file too, and without the envelope the two are indistinguishable.
    return { hit: true, value: env.value };
  } catch (e) {
    disabled = true;
    console.warn(`Durable read-model read (${name}) failed, L2 disabled for this run: ${e}`);
    return { hit: false, why: "unreadable" };
  }
}

/** Total: never throws. */
function l2Write(name: string, params: unknown, value: unknown): void {
  if (disabled) return;
  try {
    const env: Envelope = {
      v: ENVELOPE_V, stamp: currentStamp(), name,
      paramsHash: paramsHash(params), writtenAtMs: Date.now(), value,
    };
    writeGzJson(readModelFolder(), readModelFileName(name, params), env);
  } catch (e) {
    disabled = true;
    console.warn(`Durable read-model write (${name}) failed, L2 disabled for this run: ${e}`);
  }
}

/**
 * `cached()` with a durable second level behind it.
 *
 * Failure semantics are `cached()`'s, unchanged: both L2 halves are total, so an unreachable
 * Drive degrades to exactly today's behaviour. Caching is an optimization, never a correctness
 * dependency.
 */
export function durablyCached<T>(
  name: string,
  params: unknown,
  compute: () => T,
  ttlSec?: number,
): T {
  // RECORDED HERE, NOT INSIDE THE COMPUTE BELOW. `cached()` skips its callback entirely on an
  // L1 hit, so recording in there meant a warm that found L1 already warm — the common case,
  // since the trigger fires every four hours against a six-hour TTL — recorded nothing, and the
  // sweep then treated every durable file as garbage. Observed: 9 files, then 8, then 0.
  if (warming && touched) touched.add(readModelFileName(name, params));
  return cached(name, params, () => {
    const hit = l2Read(name, params);
    if (hit.hit) return hit.value as T;
    const value = compute();
    // Only inside the warm, and only when the file was absent or stale. `writeGzJson` trashes
    // and recreates, so writing unconditionally would churn a set of files into Drive Trash on
    // every fire of a 4-hourly trigger — and trashing does not free quota. On a re-warm with an
    // unchanged DATA_VERSION the read above HITS, so nothing reaches here at all.
    if (warming && (hit.why === "absent" || hit.why === "stale")) l2Write(name, params, value);
    return value;
  }, ttlSec);
}

/**
 * Trash durable files that are not in `expected`.
 *
 * THE DETERMINISTIC-NAME SCHEME DOES NOT BOUND GARBAGE ON ITS OWN, and this codebase is the
 * worst case for it. Read-model namespaces are bumped whenever a payload shape changes —
 * `mttr8`, `mttrByDomain14` and `bootstrapCore6` are each a visible rename history — and every
 * bump orphans `rm-mttrTrend5-<hash>.json.gz` forever, because nothing will ever ask for that
 * name again to overwrite it. The same goes for a changed Display-severity subset (a different
 * params hash) and for a model dropped from the warm set. One folder listing per warm is what
 * makes "exactly one file per warmed entry" actually true.
 */
export function sweepReadModels(): void {
  if (disabled) return;
  // THE KEEP-LIST IS WHAT THE WARM ACTUALLY TOUCHED, not a second copy of the call sites'
  // params. Restating those params here would be the same drift hazard the write-permission
  // scope exists to avoid — and it fails dangerously rather than harmlessly: a param that
  // drifted would make the keep-list miss a live entry and the sweep would trash it, so every
  // pass would delete and rewrite the same file forever.
  //
  // A null set means no warm ran in this execution; sweeping then would trash everything.
  if (!touched) return;
  const keep = touched;
  try {
    for (const name of listNames("readmodels")) {
      if (!keep.has(name)) trashNamed("readmodels", name);
    }
  } catch (e) {
    console.warn(`Durable read-model sweep failed: ${e}`);
  }
}
