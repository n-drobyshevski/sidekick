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

import { sha1Hex } from "../domain/sha1";
import { resolveDomainTagKey } from "../domain/domainTag";
import { getProp, PROP_KEYS, setProp } from "./props";

const VERSION_PROP = "DATA_VERSION";
const KEY_PREFIX = "wsk";

// A per-build code stamp (a hash of the source tree, injected by esbuild — see esbuild.config.mjs)
// folded into every cache key. DATA_VERSION only bumps on data mutations, so without this a code
// deploy would keep serving payloads computed by the OLD code until the TTL expires or the next
// mutation — the classic "I deployed the fix but still see the bug" trap. Changing code changes the
// stamp, making prior entries unreachable at once. The `typeof` guard leaves vitest / the dev server
// (no esbuild define) on a stable "dev" stamp so their caching behaviour is unchanged.
declare const __BUILD_ID__: string;
export const BUILD_ID = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
const CHUNK_CHARS = 90_000; // base64 chars per entry, safely under the 100 KB cap
const DEFAULT_TTL_SEC = 21_600; // the CacheService maximum (6 h)

/** Monotonic-enough stamp of the last mutation; part of every cache key. */
export function dataVersion(): string {
  return getProp(VERSION_PROP) ?? "0";
}

/**
 * The `Wiz/Domain` tag key in force, folded into every cache key beside the data version.
 *
 * IT BELONGS IN THE GLOBAL KEY, not in one endpoint's params, because it changes WHICH TAG
 * EVERY ROW IS READ FROM — and through `resolveDomain` that is now the principal input to
 * `_domain`, so it moves the domain split on essentially every cached payload in the app. It is
 * a Script Property, so `DATA_VERSION` never bumps for it: an operator who corrects a mistyped
 * key would otherwise watch the knob do nothing for up to six hours while every entry computed
 * under the old key stayed reachable. One endpoint used to carry it in its own params, which
 * covered that endpoint and no other.
 *
 * Folded in as a short hash so the key stays under the 250-char cap — the key is opaque, and
 * only its stability matters.
 */
function domainTagStamp(): string {
  return sha1Hex(resolveDomainTagKey(getProp(PROP_KEYS.wizDomainTagKey))).slice(0, 8);
}

/**
 * The version prefix every key carries, memoized for the life of one execution.
 *
 * `cached()` used to rebuild this inline on every call, and it is not free: two
 * `PropertiesService` reads plus a pure-JS SHA-1, for an answer that cannot change mid-request
 * unless this same module changes it. A single Executive load makes four `cached()` calls, so
 * it paid eight property reads and four hashes to learn the same two values four times.
 *
 * THE COMMENT ABOVE USED TO CLAIM getProp WAS CACHED. It never was — `props.ts` reads
 * PropertiesService directly — so the claim was aspirational and the cost real. Memoizing here
 * rather than in `props.ts` is deliberate: this is the one call site where the answer is
 * provably constant within an execution, and the invalidation point is five lines below it. A
 * blanket memo in `props.ts` would also swallow `CANCEL_<jobId>`, which `scanJobs` re-reads
 * inside its page loop precisely because another execution writes it — memoizing that would
 * mean the Stop button stopped working mid-scan.
 */
let versionStamp: string | undefined;
function stamp(): string {
  if (versionStamp === undefined) {
    versionStamp = `${BUILD_ID}.${dataVersion()}.${domainTagStamp()}`;
  }
  return versionStamp;
}

/**
 * Call after every mutation commit (persist/delete/compact/settings/snapshot).
 *
 * STRICTLY INCREASING, not merely `Date.now()`. The version is the only thing making a stale
 * entry unreachable, so two commits landing in the SAME MILLISECOND would write the same
 * version, leave every key identical, and serve state the second commit had just invalidated.
 * In GAS that is close to unreachable — mutations serialize through LockService and each does
 * Sheets I/O — but "close to unreachable" is not a guarantee, and this is the line the whole
 * cache-invalidation story rests on. Found by a test for the memo below that failed twice in
 * six runs for exactly this reason.
 */
export function bumpDataVersion(): void {
  const now = Date.now();
  const prev = Number(dataVersion());
  setProp(VERSION_PROP, String(Number.isFinite(prev) && prev >= now ? prev + 1 : now));
  // The memo must fall with the version it caches: a `mutate()` endpoint that bumps and then
  // serves a cached payload in the SAME execution would otherwise key that read to the
  // pre-bump version and hand back exactly the state it just invalidated.
  versionStamp = undefined;
}

/**
 * The params half of a cache key.
 *
 * EXPORTED SO THE DURABLE L2 CAN DERIVE THE SAME VALUE. `readModelStore` names its Drive files
 * from `(name, paramsHash)`, and if that hash ever drifted from the one the L1 key uses the L2
 * would simply never hit — no error, no wrong answer, just a feature quietly doing nothing.
 * One definition is the only way to make that impossible; `test/readModelStore.test.ts` pins
 * the parity.
 */
export function paramsHash(params: unknown): string {
  return sha1Hex(JSON.stringify(params ?? null)).slice(0, 12);
}

/** Deterministic short key: params are hashed so keys stay under the 250-char cap. */
export function cacheKey(name: string, params: unknown, version: string): string {
  return `${KEY_PREFIX}:${version}:${name}:${paramsHash(params)}`;
}

/** The version prefix in force for this execution — what an L2 entry must match to be fresh. */
export function currentStamp(): string {
  return stamp();
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
): void {
  const json = JSON.stringify(value);
  const gz = Utilities.gzip(Utilities.newBlob(json, "application/json"));
  const packed = Utilities.base64Encode(gz.getBytes());
  const chunks = splitChunks(packed, chunkChars);
  const entries: Record<string, string> = { [`${key}:m`]: String(chunks.length) };
  chunks.forEach((c, i) => {
    entries[`${key}:${i}`] = c;
  });
  CacheService.getScriptCache().putAll(entries, ttlSec);
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
 */
export function cached<T>(
  name: string,
  params: unknown,
  compute: () => T,
  ttlSec = DEFAULT_TTL_SEC,
): T {
  let key: string | null = null;
  try {
    key = cacheKey(name, params, stamp());
    const hit = cacheGetJson(key);
    if (hit !== undefined) return hit as T;
  } catch (e) {
    console.warn(`Cache read failed for ${name}: ${e}`);
    key = null;
  }
  const value = compute();
  if (key) {
    try {
      cachePutJson(key, value, ttlSec);
    } catch (e) {
      console.warn(`Cache write failed for ${name}: ${e}`);
    }
  }
  return value;
}
