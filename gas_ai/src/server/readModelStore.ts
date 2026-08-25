// A DURABLE SECOND LEVEL under the CacheService read-model cache.
//
// CacheService's maximum TTL is six hours. That is a platform ceiling, not a choice —
// `DEFAULT_TTL_SEC` in serverCache is literally "the CacheService maximum". Tenants sync
// daily, so DATA_VERSION does not move for ~24h while every entry lapses three or four times
// inside that window, and each lapse is a multi-second cold load paid by whoever opens the
// app next. The scheduled warm keeps L1 alive across the working day; this keeps the ANSWER
// alive even when L1 is not — overnight, after a deploy, after an eviction, or for a tenant
// nobody visited all day.
//
// Read path: L1 (cached) -> L2 (Drive) -> compute. An L2 hit repopulates L1 for free,
// because `cached()` stores whatever its compute argument returns.
//
// ONLY TIME-INVARIANT READ-MODELS BELONG HERE, and the audit is per model rather than
// inherited. This project has no `age_days` family: `src/domain` reads the clock NOWHERE, and
// the ranking functions that take a `nowIso` have no caller in `src/` outside their own
// files. Exactly two read paths consult a clock, and both are excluded —
// `getToxicCombos` does SLA arithmetic off `new Date()`, and `getCompliance` carries a
// `postureScope.fetchedAt` the page renders as "asked at {date} — this page alone is live",
// which a durable store would make false. Stored timestamps like `latestSync.finished_at`
// are facts about the ledger, not drift, and are fine.
//
// WHY NOT INSIDE `cached()`. There is no import cycle — serverCache -> archiveStore is
// acyclic — but `cached()` is the one function whose "any cache-layer error falls back to
// compute()" contract is load-bearing, and putting Drive inside it would push every existing
// cache test onto the warn-and-fallback path. Composing around it leaves that contract
// untouched.

import { listNames, readGzJsonNamed, trashNamed, writeGzJson, subfolder } from "./archiveStore";
import { cached, currentStamp, paramsHash } from "./serverCache";

const FOLDER = "readmodels" as const;
const ENVELOPE_V = 1;

/**
 * Backstop age, deliberately generous. The STAMP is the freshness mechanism — this only caps
 * how long a file whose stamp still matches may be trusted, so a clock or a version property
 * going backwards cannot resurrect something ancient.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Envelope {
  v: number;
  stamp: string;
  name: string;
  hash: string;
  writtenAtMs: number;
  value: unknown;
}

/**
 * True only inside `warmReadModels`. WRITES ARE RESTRICTED TO THE WARM, and this is a
 * garbage-collection rule rather than a performance one.
 *
 * Deterministic filenames bound the file count only while the (name, params) key space is
 * bounded. The warm asks for a fixed handful; an arbitrary READ can carry any params at all —
 * a graph query, one asset's expansion, one combo group — so allowing writes from reads would
 * mint a file per distinct params object forever. Worse, a file written for a scope that is
 * later renamed is orphaned permanently AND indistinguishable from a legitimate cold one, so
 * no sweep could ever clean it up.
 *
 * Reads still check L2 for any params; unwarmed ones simply find nothing, which is exactly
 * today's behaviour.
 */
let warming = false;

/** What the current warm has actually touched — the sweep's keep-list. See `sweepReadModels`. */
let touched: Set<string> | null = null;

export function duringWarm<T>(fn: () => T): T {
  warming = true;
  touched = new Set<string>();
  try {
    return fn();
  } finally {
    warming = false;
    // Cleared, not kept: a sweep running after the warm has ended must not run against a
    // stale keep-list from the last one.
    touched = null;
  }
}

/**
 * Per-execution circuit breaker. A missing ARCHIVE_FOLDER_ID or a revoked Drive scope should
 * cost ONE failed call, not one per durable read-model per request.
 */
let disabled = false;

/** Test seam: the module-level state above, reset. */
export function __resetMemosForTest(): void {
  warming = false;
  touched = null;
  disabled = false;
}

/**
 * The file a (name, params) pair lives in.
 *
 * NO STAMP IN THE FILENAME, deliberately — the stamp goes INSIDE the file. A stamp in the
 * name would orphan an entire generation of files on every deploy, because BUILD_ID is a
 * hash of the source tree and so changes on every push. Deterministic names mean a rewrite
 * replaces rather than accumulates.
 */
export function readModelFileName(name: string, params: unknown): string {
  return `rm-${name}-${paramsHash(params)}.json.gz`;
}

function l2Read(
  name: string,
  params: unknown,
  version: string | undefined,
): { hit: boolean; value?: unknown; why?: "absent" | "stale" } {
  if (disabled) return { hit: false, why: "absent" };
  try {
    const raw = readGzJsonNamed(FOLDER, readModelFileName(name, params));
    if (!raw || typeof raw !== "object") return { hit: false, why: "absent" };
    const env = raw as Partial<Envelope>;
    if (env.v !== ENVELOPE_V || env.name !== name) return { hit: false, why: "stale" };
    if (env.stamp !== currentStamp(version)) return { hit: false, why: "stale" };
    if (typeof env.writtenAtMs !== "number") return { hit: false, why: "stale" };
    if (Date.now() - env.writtenAtMs > MAX_AGE_MS) return { hit: false, why: "stale" };
    // Read off `value` rather than using the parse result, so a legitimately null payload is
    // a HIT rather than being retried forever as a miss.
    return { hit: true, value: env.value };
  } catch (e) {
    disabled = true;
    console.warn(`Durable read-model read failed (${name}) — L2 disabled for this run: ${e}`);
    return { hit: false, why: "absent" };
  }
}

function l2Write(name: string, params: unknown, version: string | undefined, value: unknown): void {
  if (disabled) return;
  try {
    const env: Envelope = {
      v: ENVELOPE_V,
      stamp: currentStamp(version),
      name,
      hash: paramsHash(params),
      writtenAtMs: Date.now(),
      value,
    };
    writeGzJson(subfolder(FOLDER), readModelFileName(name, params), env);
  } catch (e) {
    disabled = true;
    console.warn(`Durable read-model write failed (${name}) — L2 disabled for this run: ${e}`);
  }
}

/**
 * `cached()`, with a Drive-backed level underneath it.
 *
 * COMPOSED AROUND `cached()`, never modifying it: its failure semantics are unchanged, so an
 * unreachable Drive degrades to exactly today's behaviour. Both L2 halves are total.
 *
 * `version` is threaded through to `cached()` AND into the envelope's stamp. That is the
 * gas_ai-specific trap: this project has two version namespaces (DATA_VERSION and
 * WIZ_DATA_VERSION), so an entry stamped under the wrong one would simply never hit — no
 * error, no wrong answer, a feature quietly doing nothing. `test/readModelStore.test.ts` pins
 * the parity rather than trusting two call sites to stay in step.
 */
export function durablyCached<T>(
  name: string,
  params: unknown,
  compute: () => T,
  ttlSec?: number,
  version?: string,
): T {
  // RECORDED OUTSIDE THE COMPUTE CALLBACK, and this is the subtle part. `cached()` skips its
  // callback entirely on an L1 hit — which is the COMMON case for a warm running against a
  // still-live six-hour entry — so recording the touch in there would leave the keep-list
  // empty and the sweep would treat every durable file as garbage and delete it.
  if (warming && touched) touched.add(readModelFileName(name, params));

  return cached(name, params, () => {
    const hit = l2Read(name, params, version);
    if (hit.hit) return hit.value as T;
    const value = compute();
    // Writes only from the warm — see `warming` above.
    if (warming) l2Write(name, params, version, value);
    return value;
  }, ttlSec, version);
}

/**
 * Trash durable files the warm did not touch.
 *
 * THE DETERMINISTIC-NAME SCHEME DOES NOT BOUND GARBAGE ON ITS OWN, and this codebase is the
 * worst case for it: cache namespaces are bumped whenever a cached shape changes, and each
 * bump strands the previous name's file forever. Unlike a CacheService entry, which becomes
 * unreachable on a version bump and then ages out via TTL, a Drive file has nothing to age it.
 *
 * THE KEEP-LIST IS WHAT THE WARM ACTUALLY TOUCHED, never a restatement of the call sites'
 * params. A restatement drifts, and a drifted one deletes live entries and rewrites them on
 * the next pass, forever.
 *
 * Skipped when `touched` is null — no warm ran, so there is no keep-list and sweeping would
 * delete everything.
 */
export function sweepReadModels(): number {
  if (disabled || !touched) return 0;
  const keep = touched;
  let trashed = 0;
  try {
    for (const name of listNames(FOLDER)) {
      if (!keep.has(name)) {
        trashNamed(FOLDER, name);
        trashed += 1;
      }
    }
  } catch (e) {
    console.warn(`Durable read-model sweep failed: ${e}`);
  }
  return trashed;
}
