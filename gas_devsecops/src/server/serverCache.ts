// Cross-request cache for derived read-model data (bootstrap core, MTTR/SLA summary,
// trend, scan history, storage stats) over CacheService, versioned by a DATA_VERSION
// Script Property.
//
// Invalidation is version-in-key: every mutation commit calls bumpDataVersion(), so
// all previously cached entries simply become unreachable and age out via the TTL —
// no explicit deletes, no missed-eviction staleness. Reading the version is one
// PropertiesService get (~10–50 ms) vs the multi-second recompute it replaces.
//
// CacheService caps values at 100 KB, so payloads are gzip+base64'd and split into
// chunks stored under `<key>:0..n-1` with a `<key>:m` chunk-count entry; any missing
// chunk reads as a miss. Everything degrades to compute() on any cache failure.

import { sha1Hex } from "../../../gas_shared/domain/sha1";
import { getProp, PROP_KEYS, setProp } from "./props";

const VERSION_PROP = "DATA_VERSION";
// A SECOND version, for entries whose freshness is a fact about WIZ rather than about this
// sheet. DATA_VERSION is bumped by settingsStore.saveSettings as well as by a sync, which is
// right for every derived read-model — a band threshold moving really does change the
// bootstrap payload — and wrong for a cached Wiz response, which does not go stale because
// someone saved an AARS rule. See `wizDataVersion` and syncStore.commit().
const WIZ_VERSION_PROP = "WIZ_DATA_VERSION";
/**
 * What a CODE change contributes to every cache key, L1 and L2: bump this to make every cached
 * read-model unreachable on the next deploy.
 *
 * IT USED TO BE BUILD_ID (a hash of the source tree), so every deploy — a copy fix in the client
 * included — made every entry cold at once: the bootstrap core, every read-model, and the
 * durable Drive copies. gas/ measured that as the most expensive line in its app and moved to
 * an epoch in #322; this is the same move (PERF_PLAN.md step 2d). The guard BUILD_ID bought is
 * carried, more precisely, by the namespaces: every cached read-model is named with a version
 * (`dsMttr4`, `dsBootCore1`, `settingsImpact1`…), and a change to one payload's shape or meaning
 * bumps that one name — pinned by test/cacheNamespaces.test.ts. Bump THIS only for a change that
 * alters many payloads at once and cannot sensibly be expressed as a list of namespace bumps.
 *
 * A stale payload that slips past both is bounded anyway: DATA_VERSION moves on every sync and
 * settings save, no L1 entry outlives CacheService's six hours, and no L2 file is served past
 * readModelStore's `MAX_AGE_MS`.
 */
export const CACHE_EPOCH = "1";
const KEY_PREFIX = `wsk.e${CACHE_EPOCH}`;
const CHUNK_CHARS = 90_000; // base64 chars per entry, safely under the 100 KB cap
const DEFAULT_TTL_SEC = 21_600; // the CacheService maximum (6 h)

// PER-EXECUTION MEMOS FOR THE THREE VALUES EVERY CACHE KEY IS BUILT FROM.
//
// Each is a PropertiesService read (~10-50 ms in GAS) and `configStamp` adds a pure-JS
// SHA-1. None of them can change mid-execution unless this module changes it, and both
// places that do are five lines below.
//
// THIS IS WORTH NOTHING TO A PAGE LOAD AND EVERYTHING TO THE WARM, which is why it arrives
// with the warm rather than earlier. Measured before writing it: every read endpoint costs
// exactly 2 propGet on a warm call, because each resolves exactly ONE cached entry — and in
// GAS every RPC is a fresh execution, so a memo cannot deduplicate a value read once. The
// sibling project memoized this on the strength of a page that composes four read-models in
// one call; no endpoint here does. `warmReadModels` is the first caller that does, resolving
// a dozen entries in a single execution, and it turns 2N reads into 2.
//
// MEMOIZED HERE AND NOT IN props.ts. A blanket memo there would also swallow
// `CANCEL_SYNC_JOB_ID`, which syncJobs re-reads at the top of its page loop precisely
// because ANOTHER execution writes it — the Stop button would stop working mid-sync — and
// `ACTIVE_JOB_ID`, which is the same shape of hazard.
let dataVersionMemo: string | undefined;
let wizDataVersionMemo: string | undefined;
let configStampMemo: string | undefined;

/**
 * Drop all three. Called from both bump functions below, and by the test harness.
 *
 * The memos must fall with the version they cache: a `mutate()` endpoint that bumps and then
 * serves a cached payload in the SAME execution would otherwise key that read to the
 * pre-bump version and answer with state it had just invalidated.
 */
export function __resetMemosForTest(): void {
  dataVersionMemo = undefined;
  wizDataVersionMemo = undefined;
  configStampMemo = undefined;
}

/** Monotonic stamp of the last mutation; part of every cache key. */
export function dataVersion(): string {
  if (dataVersionMemo === undefined) dataVersionMemo = getProp(VERSION_PROP) ?? "0";
  return dataVersionMemo;
}

/**
 * `<ms>.<n>` — the clock for legibility, the counter for the actual guarantee.
 *
 * A bare `Date.now()` is not monotonic at the resolution that matters here: two mutations
 * landing in the same millisecond stamp the same version, every cache key stays identical,
 * and the second mutation serves the first one's payload until the 6h TTL expires. Rare in
 * production and certain under a frozen test clock, where nothing advances at all and every
 * mutation after the first reads stale. The counter makes the value differ from its
 * predecessor unconditionally, which is the only property a cache key needs from it.
 */
function nextVersion(prev: string | null): string {
  const now = String(Date.now());
  const [prevMs, prevN] = String(prev ?? "").split(".");
  return prevMs === now ? `${now}.${(Number(prevN) || 0) + 1}` : `${now}.0`;
}

/** Call after every mutation commit (persist/delete/compact/settings/snapshot). */
export function bumpDataVersion(): void {
  setProp(VERSION_PROP, nextVersion(getProp(VERSION_PROP)));
  __resetMemosForTest();
}

/**
 * Stamp of the last time this app's picture of the tenant changed — a sync, a rescore, or a
 * wipe. Bumped from syncStore.commit() only, which is deliberately NOT where saveSettings
 * bumps: settings write through bumpDataVersion alone.
 */
export function wizDataVersion(): string {
  if (wizDataVersionMemo === undefined) wizDataVersionMemo = getProp(WIZ_VERSION_PROP) ?? "0";
  return wizDataVersionMemo;
}

/** No caller yet: `ledgerStore`'s commit — the final `scans` append — is the one, in Phase 2. */
export function bumpWizDataVersion(): void {
  setProp(WIZ_VERSION_PROP, nextVersion(getProp(WIZ_VERSION_PROP)));
  __resetMemosForTest();
}

/**
 * Params as a short stable hash.
 *
 * Exported ONLY so the durable L2 can derive a filename from the same hash this key uses. If
 * the two ever drift the L2 stops hitting — with no error, no wrong answer, and nothing on
 * screen to say so, just a feature quietly doing nothing. `test/readModelStore.test.ts` pins
 * the parity rather than trusting that two call sites stay in step.
 */
export function paramsHash(params: unknown): string {
  return sha1Hex(JSON.stringify(params ?? null)).slice(0, 12);
}

/** Deterministic short key: params are hashed so keys stay under the 250-char cap. */
export function cacheKey(name: string, params: unknown, version: string): string {
  return `${KEY_PREFIX}:${version}:${name}:${paramsHash(params)}`;
}

/**
 * Configuration that changes what a payload SAYS without changing the data underneath it.
 *
 * Both version props are bumped by MUTATIONS — a sync, a settings save — and the properties
 * folded here are neither: they are Script Properties an operator edits in the GAS console, so
 * nothing bumps for them and every derived entry would keep answering under the old value until
 * the 6h TTL expired. That is the "I fixed the setting and still see the old answer" trap, and
 * the operator has no sync to run to clear it.
 *
 * It lives here rather than in each caller's `params` because a dozen call sites is a dozen
 * chances to forget one, and the one forgotten is the one that goes stale. Hashed so an
 * arbitrarily long value cannot push the cache key past 250.
 */
function configStamp(): string {
  if (configStampMemo === undefined) {
    // TWO PROPERTIES NOW, and the second was a real gap rather than a completeness tidy.
    // `WIZ_PROJECT_ID_V2` is read INSIDE the cached bootstrap core (bootCore.ts, `scope
    // .syncProjectId`) and appeared in no cache key at all — so an operator who set or
    // corrected the sync's project scope in the GAS console would have gone on seeing the
    // old one for up to six hours, with no sync to run that would clear it. Exactly the trap
    // this function was written for, one key short.
    //
    // Found by the warm: caching bootstrap at the tail of every sync is what made an
    // existing test able to observe it, because before that the entry was usually cold when
    // the property changed.
    //
    // AND THE TWO REPOSITORY TAG KEYS, which were missing although this function's own header
    // described the domain one. `repoTags.attachRepoTags` resolves every row's domain and
    // lifecycle through WIZ_DOMAIN_TAG_KEY / WIZ_LIFECYCLE_TAG_KEY, so every read-model that
    // attaches tags — and the bootstrap core's domain catalogue — moves when either changes,
    // and nothing bumps for them. Folded in with PERF_PLAN.md step 2d, whose epoch change
    // retires every existing key once anyway. Raw property values, not the resolved keys: a
    // change of the raw value is what an operator makes, and reading `repoTags` from here
    // would be an import cycle.
    configStampMemo = sha1Hex([
      getProp(PROP_KEYS.wizProjectIdV2) ?? "",
      getProp(PROP_KEYS.wizDomainTagKey) ?? "",
      getProp(PROP_KEYS.wizLifecycleTagKey) ?? "",
    ].join("\u0000")).slice(0, 8);
  }
  return configStampMemo;
}

/**
 * The version prefix a cache key carries, for whichever version namespace an entry opted
 * into. Exported for the durable L2, which has to stamp a stored payload with EXACTLY what
 * `cached()` would key it under.
 *
 * `KEY_PREFIX` (and with it `CACHE_EPOCH`) is folded back in here, and that is easy to miss: a
 * `currentStamp` that returned only `version.configStamp` would leave the L2 untouched by an
 * epoch bump — it would go on serving payloads the bump exists to retire.
 */
export function currentStamp(version?: string): string {
  return `${KEY_PREFIX}:${version ?? dataVersion()}.${configStamp()}`;
}

/**
 * The entry `cached(name, params, …, version)` would return, WITHOUT computing it on a miss:
 * undefined on a miss or any cache-layer error. For a caller that must not pay a cold compute —
 * doGet's inline bootstrap — and would rather do without.
 */
export function peekCached(name: string, params: unknown, version?: string): unknown | undefined {
  const t0 = Date.now();
  try {
    const hit = cacheGetJson(cacheKey(name, params, `${version ?? dataVersion()}.${configStamp()}`));
    console.log(JSON.stringify({ stage: "cache", name, peek: true, hit: hit !== undefined, getMs: Date.now() - t0 }));
    return hit;
  } catch (e) {
    console.warn(`Cache peek failed for ${name}: ${e}`);
    return undefined;
  }
}

/** Store what `cached(name, params, …, version)` would have stored. Best-effort, like every
 *  write here. */
export function primeCached(
  name: string,
  params: unknown,
  value: unknown,
  ttlSec = DEFAULT_TTL_SEC,
  version?: string,
): void {
  try {
    cachePutJson(cacheKey(name, params, `${version ?? dataVersion()}.${configStamp()}`), value, ttlSec);
  } catch (e) {
    console.warn(`Cache write failed for ${name}: ${e}`);
  }
}

/** Pure chunk split (exported for tests). */
export function splitChunks(s: string, size = CHUNK_CHARS): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out.length ? out : [""];
}

export function cachePutJson(
  key: string,
  value: unknown,
  ttlSec = DEFAULT_TTL_SEC,
  chunkChars = CHUNK_CHARS,
): number {
  const json = JSON.stringify(value);
  const gz = Utilities.gzip(Utilities.newBlob(json, "application/json"));
  const packed = Utilities.base64Encode(gz.getBytes());
  const chunks = splitChunks(packed, chunkChars);
  const entries: Record<string, string> = { [`${key}:m`]: String(chunks.length) };
  chunks.forEach((c, i) => {
    entries[`${key}:${i}`] = c;
  });
  CacheService.getScriptCache().putAll(entries, ttlSec);
  // The JSON length, for `cached()`'s timing line: what a model costs to store, before gzip.
  return json.length;
}

/** Cached value, or undefined on miss/partial eviction/parse failure. */
export function cacheGetJson(key: string): unknown | undefined {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(`${key}:m`);
  if (!meta) return undefined;
  const n = Number(meta);
  if (!Number.isInteger(n) || n < 1) return undefined;
  const names: string[] = [];
  for (let i = 0; i < n; i++) names.push(`${key}:${i}`);
  const got = cache.getAll(names);
  let packed = "";
  for (const name of names) {
    const chunk = got[name];
    if (chunk === undefined || chunk === null) return undefined; // partial eviction
    packed += chunk;
  }
  const bytes = Utilities.base64Decode(packed);
  const json = Utilities.ungzip(
    Utilities.newBlob(bytes, "application/x-gzip"),
  ).getDataAsString("UTF-8");
  return JSON.parse(json);
}

/**
 * Version-keyed read-through cache. Any cache-layer error falls back to compute() —
 * caching is an optimization, never a correctness dependency.
 *
 * `version` selects WHAT this entry's freshness depends on. The default — DATA_VERSION —
 * is right for anything derived from the sheet, because a settings change really can move
 * those numbers. Pass `wizDataVersion()` for an entry that holds a Wiz response: those
 * cost a UrlFetchApp call to refill and are not made stale by a local edit.
 */
export function cached<T>(
  name: string,
  params: unknown,
  compute: () => T,
  ttlSec = DEFAULT_TTL_SEC,
  version?: string,
): T {
  // Timed to the execution log, hit or miss: `getMs` is the key (its PropertiesService reads)
  // plus the CacheService read, `computeMs` the callback (for a durable model that includes its
  // Drive read — see readModelStore's "l2" line), `putMs` the gzip + write. One line per
  // read-model per request.
  let key: string | null = null;
  const t0 = Date.now();
  try {
    // Resolved INSIDE the try, not as a default parameter: reading the version is a
    // PropertiesService call, and the contract here is that no cache-layer failure can stop
    // compute() from running.
    key = cacheKey(name, params, `${version ?? dataVersion()}.${configStamp()}`);
    const hit = cacheGetJson(key);
    if (hit !== undefined) {
      console.log(JSON.stringify({ stage: "cache", name, hit: true, getMs: Date.now() - t0 }));
      return hit as T;
    }
  } catch (e) {
    console.warn(`Cache read failed for ${name}: ${e}`);
    key = null;
  }
  const t1 = Date.now();
  const value = compute();
  const t2 = Date.now();
  let chars = 0;
  if (key) {
    try {
      chars = cachePutJson(key, value, ttlSec);
    } catch (e) {
      console.warn(`Cache write failed for ${name}: ${e}`);
    }
  }
  console.log(JSON.stringify({
    stage: "cache", name, hit: false, getMs: t1 - t0, computeMs: t2 - t1, putMs: Date.now() - t2, chars,
  }));
  return value;
}
