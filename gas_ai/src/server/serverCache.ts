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
import { BUILD_ID } from "./buildInfo";
import { domainTagKey, getProp, setProp } from "./props";

const VERSION_PROP = "DATA_VERSION";
// A SECOND version, for entries whose freshness is a fact about WIZ rather than about this
// sheet. DATA_VERSION is bumped by settingsStore.saveSettings as well as by a sync, which is
// right for every derived read-model — a band threshold moving really does change the
// bootstrap payload — and wrong for a cached Wiz response, which does not go stale because
// someone saved an AARS rule. See `wizDataVersion` and syncStore.commit().
const WIZ_VERSION_PROP = "WIZ_DATA_VERSION";
// The build stamp is part of every key. DATA_VERSION only bumps on data MUTATIONS, so
// without this a code deploy would keep serving payloads computed by the old code until
// the TTL expires (6h) or someone syncs — the "I deployed the fix but still see the bug"
// trap. Changing code changes the stamp, making prior entries unreachable at once.
const KEY_PREFIX = `wsk.${BUILD_ID}`;
const CHUNK_CHARS = 90_000; // base64 chars per entry, safely under the 100 KB cap
const DEFAULT_TTL_SEC = 21_600; // the CacheService maximum (6 h)

/** Monotonic stamp of the last mutation; part of every cache key. */
export function dataVersion(): string {
  return getProp(VERSION_PROP) ?? "0";
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
}

/**
 * Stamp of the last time this app's picture of the tenant changed — a sync, a rescore, or a
 * wipe. Bumped from syncStore.commit() only, which is deliberately NOT where saveSettings
 * bumps: settings write through bumpDataVersion alone.
 */
export function wizDataVersion(): string {
  return getProp(WIZ_VERSION_PROP) ?? "0";
}

export function bumpWizDataVersion(): void {
  setProp(WIZ_VERSION_PROP, nextVersion(getProp(WIZ_VERSION_PROP)));
}

/** Deterministic short key: params are hashed so keys stay under the 250-char cap. */
export function cacheKey(name: string, params: unknown, version: string): string {
  const paramsHash = sha1Hex(JSON.stringify(params ?? null)).slice(0, 12);
  return `${KEY_PREFIX}:${version}:${name}:${paramsHash}`;
}

/**
 * Configuration that changes what a payload SAYS without changing the data underneath it.
 *
 * Same argument as KEY_PREFIX's build stamp, one step removed. Both version props are
 * bumped by MUTATIONS — a sync, a settings save — and the domain tag key is neither: it is
 * a Script Property an operator edits in the GAS console, so nothing bumps for it and every
 * derived entry would keep answering under the old key until the 6h TTL expired. That is
 * the "I fixed the setting and still see the old answer" trap, and it is worse than the
 * deploy version because the operator has no sync to run to clear it.
 *
 * It lives here rather than in each caller's `params` for the reason the build stamp does:
 * a dozen call sites is a dozen chances to forget one, and the one forgotten is the one
 * that goes stale. Hashed so an arbitrarily long key cannot push the cache key past 250.
 */
function configStamp(): string {
  return sha1Hex(domainTagKey()).slice(0, 8);
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
  let key: string | null = null;
  try {
    // Resolved INSIDE the try, not as a default parameter: reading the version is a
    // PropertiesService call, and the contract here is that no cache-layer failure can stop
    // compute() from running.
    key = cacheKey(name, params, `${version ?? dataVersion()}.${configStamp()}`);
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
