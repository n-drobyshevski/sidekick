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
import { getProp, setProp } from "./props";

const VERSION_PROP = "DATA_VERSION";
const KEY_PREFIX = "wsk";
const CHUNK_CHARS = 90_000; // base64 chars per entry, safely under the 100 KB cap
const DEFAULT_TTL_SEC = 21_600; // the CacheService maximum (6 h)

/** Monotonic-enough stamp of the last mutation; part of every cache key. */
export function dataVersion(): string {
  return getProp(VERSION_PROP) ?? "0";
}

/** Call after every mutation commit (persist/delete/compact/settings/snapshot). */
export function bumpDataVersion(): void {
  setProp(VERSION_PROP, String(Date.now()));
}

/** Deterministic short key: params are hashed so keys stay under the 250-char cap. */
export function cacheKey(name: string, params: unknown, version: string): string {
  const paramsHash = sha1Hex(JSON.stringify(params ?? null)).slice(0, 12);
  return `${KEY_PREFIX}:${version}:${name}:${paramsHash}`;
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
    key = cacheKey(name, params, dataVersion());
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
