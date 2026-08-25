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
import { domainTagKey, getProp, PROP_KEYS, setProp } from "./props";

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
  if (configStampMemo === undefined) {
    // TWO PROPERTIES NOW, and the second was a real gap rather than a completeness tidy.
    // `WIZ_PROJECT_ID_V2` is read INSIDE the cached bootstrap core (api.ts, `scope
    // .syncProjectId`) and appeared in no cache key at all — so an operator who set or
    // corrected the sync's project scope in the GAS console would have gone on seeing the
    // old one for up to six hours, with no sync to run that would clear it. Exactly the trap
    // this function was written for, one key short.
    //
    // Found by the warm: caching bootstrap at the tail of every sync is what made an
    // existing test able to observe it, because before that the entry was usually cold when
    // the property changed.
    configStampMemo = sha1Hex(`${domainTagKey()}\u0000${getProp(PROP_KEYS.wizProjectIdV2) ?? ""}`)
      .slice(0, 8);
  }
  return configStampMemo;
}

/**
 * The version prefix a cache key carries, for whichever version namespace an entry opted
 * into. Exported for the durable L2, which has to stamp a stored payload with EXACTLY what
 * `cached()` would key it under.
 *
 * `BUILD_ID` is folded back in here, and that is easy to miss: this project puts it in
 * `KEY_PREFIX` rather than in the version prefix, so a `currentStamp` that returned only
 * `version.configStamp` would leave the L2 with no deploy invalidation at all — it would go
 * on serving payloads computed by the old code after every push, which is the exact trap
 * KEY_PREFIX exists to close for L1.
 */
export function currentStamp(version?: string): string {
  return `${KEY_PREFIX}:${version ?? dataVersion()}.${configStamp()}`;
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
