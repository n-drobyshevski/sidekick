// Boots the whole server against the dev harness's GAS fakes, in-process.
//
// `dev/gas-shims.js` already fakes every Google service the server touches, for the local
// dev server. It is plain JS assigning to `window`, with no DOM dependency, so aliasing
// `window` to `globalThis` and evaluating it gives Node the same environment the browser
// harness gets — which means a test can run `setup()`, a full dry-run sync, and every
// `api_*` handler end to end. That is the only way to exercise api.ts, syncJobs.ts and
// wizClientAi.ts at all: they have no other test coverage.
//
// Using the dev shims rather than a second set of fakes is deliberate. A private mock would
// be one more thing to keep in step with the real services; this way the test and the dev
// server describe the same environment, and a shim that drifts breaks both at once.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { vi } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Frozen so sync ids, timestamps and elapsed figures are stable across runs. */
export const FROZEN_NOW = new Date("2026-08-13T09:00:00.000Z");

type ServerModule = typeof import("../src/server/index");

/**
 * Fresh GAS environment + a freshly-imported server.
 *
 * Every call resets the module registry, so the memoized spreadsheet handle in sheetsDb
 * and the read memos in syncStore start empty — which is what lets one test run two
 * independent syncs and compare them.
 *
 * Only `Date` is faked. `setTimeout` stays real because the trigger shim uses it to fire
 * continuation jobs; and a frozen clock means the hop deadline in syncJobs never trips, so
 * a dry-run sync completes in a single hop and the output does not depend on machine speed.
 */
export async function bootServer(): Promise<ServerModule> {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FROZEN_NOW);

  const g = globalThis as Record<string, unknown>;
  g["window"] = globalThis;
  // Set BEFORE the shims are evaluated, because `Utilities.sleep` reads it on every call and
  // the very first thing a retrying test does is call it. See that shim's own comment: it
  // spins on `Date.now()`, which the frozen clock two lines above makes an INFINITE loop —
  // synchronous, so no test timeout can break it. The flag keeps the real backoff intact for
  // the browser harness, where there is a live tenant to be polite to, and skips it here,
  // where there is not.
  g["__GAS_SHIM_INSTANT_SLEEP__"] = true;
  runInThisContext(readFileSync(join(ROOT, "dev/gas-shims.js"), "utf8"), {
    filename: "dev/gas-shims.js",
  });

  return (await import("../src/server/index")) as ServerModule;
}

/** Undo the clock freeze; the shims' state dies with the module registry on the next boot. */
export function teardownServer(): void {
  vi.useRealTimers();
}

// --------------------------------------------------------------- shared fixture
//
// `bootServer()` above is exact and expensive: a module-registry reset, a re-import of the
// whole server graph, and — for most callers — a `setup()` and a full dry-run sync on top.
// Run from `beforeEach` that is half a megabyte of TypeScript re-executed and a whole sample
// landscape regenerated to undo a handful of row writes. Four files did exactly that, and
// they were the four slowest in the suite.
//
// So: boot ONCE per file, sync ONCE, and photograph the fakes. Each test then restores the
// photograph and drops the server's per-execution memos, which is the same starting state
// reached by copying grids instead of rebuilding the world.
//
// The memo list is the honest cost of this. Every module holding state across a call has to
// be named, and one we forget is state quietly leaking between tests. Two things keep that
// bounded: the list is small and enumerable (module-level mutable state in `src/server` is
// six memos, and `src/domain` has none at all), and `GAS_TEST_FULL_ISOLATION=1` puts the old
// workload back exactly — `npm run test:exact` proves the fast path did not hide anything.

/** `npm run test:exact` sets this. See the comment above. */
const EXACT = process.env["GAS_TEST_FULL_ISOLATION"] === "1";

/** Service-call tallies the shim keeps. See the `counters` block in dev/gas-shims.js. */
export interface GasCounters {
  propGet: number;
  propSet: number;
  rangeReads: number;
  cellsRead: number;
  /** Per-key read tallies — which property, how many times. */
  propGetKeys: Record<string, number>;
}

interface GasFakes {
  snapshot(): unknown;
  restore(snap: unknown): void;
  counters(): GasCounters;
  resetCounters(): void;
}

function fakes(): GasFakes {
  const f = (globalThis as Record<string, unknown>)["__gasFakes"];
  if (!f) throw new Error("__gasFakes missing — dev/gas-shims.js was not evaluated");
  return f as GasFakes;
}

/**
 * Run `fn` and report what it cost the fake platform.
 *
 * This is what lets a spec assert that a read got CHEAPER rather than merely that it still
 * returns the right answer — the two are independent, and only the second one is usually
 * tested. Counts service calls, not wall clock, so it does not vary with machine speed.
 */
export function measure<T>(fn: () => T): { value: T; counters: GasCounters } {
  fakes().resetCounters();
  const value = fn();
  return { value, counters: fakes().counters() };
}

/** Every module in `src/server` that memoizes across a call. Nothing else holds state. */
async function resetServerMemos(): Promise<void> {
  const mods = await Promise.all([
    // api.ts is absent on purpose — its one memo is identity-keyed on syncStore's, so
    // clearing syncStore below already invalidates it. See the note where it is declared.
    // The access decision. In real GAS this dies with the request; here the module registry
    // outlives the test, so without this a caller refused in one test would stay refused in
    // the next — or, worse, an admitted one would stay admitted after the roster changed.
    import("../src/server/access"),
    import("../src/server/archiveStore"),
    // The three per-execution memos behind every cache key. In GAS an execution ends with
    // the request; here the module registry outlives the test, so without this a stamp read
    // in one test would answer in the next — which is exactly the staleness the memos are
    // careful to drop on a version bump.
    // Its warm scope and per-execution breaker; module-level, so the same rule applies.
    import("../src/server/readModelStore"),
    import("../src/server/serverCache"),
    import("../src/server/settingsStore"),
    import("../src/server/sheetsDb"),
    import("../src/server/syncStore"),
  ]);
  for (const m of mods) m.__resetMemosForTest();
}

let syncedServer: ServerModule | undefined;
let syncedSnapshot: unknown;

/**
 * `beforeAll`: a booted server carrying one dry-run sync, photographed for `resetToSynced`.
 */
export async function bootSyncedServer(): Promise<ServerModule> {
  syncedServer = await bootServer();
  syncedServer.setup();
  const res = syncedServer.api.runSync({}) as { ok: boolean; error?: string };
  if (!res.ok) throw new Error(`seed sync failed: ${res.error}`);
  syncedSnapshot = fakes().snapshot();
  return syncedServer;
}

/**
 * `beforeEach`: back to the state `bootSyncedServer` photographed.
 *
 * Returns the server so callers can rebind — under `EXACT` it is a genuinely new instance,
 * and holding the old one would reach a dead module registry.
 */
export async function resetToSynced(): Promise<ServerModule> {
  if (EXACT) return bootSyncedServer();
  fakes().restore(syncedSnapshot);
  await resetServerMemos();
  // bootServer froze the clock; tests are free to advance it, so put it back too.
  vi.setSystemTime(FROZEN_NOW);
  return syncedServer!;
}

/**
 * The `api_*` surface, as `dist/entry.js` exposes it to `google.script.run`.
 *
 * Read-only handlers only: the mutating ones (runSync, setSettings, setAarsRule,
 * rescoreAars, resetData) change state and are driven explicitly by the tests that want
 * them, not swept over.
 */
export const READ_APIS: Array<[name: string, params: unknown, label?: string]> = [
  ["bootstrap", {}],
  ["getGraph", {}],
  // Bare, then asked for one kind's value lists. The two shapes differ on purpose — every
  // kind's lists together were 22 KB of a 28 KB payload, so `valuesFor` is filled only for
  // the kind the palette is actually about, and the bare answer must stay empty of them.
  ["getQueryVocabulary", {}, "getQueryVocabulary (bare)"],
  ["getQueryVocabulary", { kind: "AI_AGENT" }, "getQueryVocabulary (values for AI Agent)"],
  // The default lens, and then the screenshot's query. The second is the one that proves a row
  // is a PATH rather than an entity, so the golden carries both shapes. They need distinct
  // LABELS: the snapshot is keyed by test name, and two cases called `runGraphQuery` would
  // write to one key and silently record only the last.
  ["runGraphQuery", {}, "runGraphQuery (default lens)"],
  [
    "runGraphQuery",
    { query: { kind: "AI_AGENT", steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } }] } },
    "runGraphQuery (agent runs as service account)",
  ],
  // A FILTERED query, which draws more than it was asked for: a filter naming a risk property
  // also names the subgraph that proves it, so this payload carries the identity, the store and
  // the data findings behind "reaches classified data" while the rows stay one per agent. The
  // node/edge asymmetry with the case above is the whole point and is what this golden pins —
  // the two cases above carry no filter and so must stay byte-identical to what they were.
  [
    "runGraphQuery",
    { query: { kind: "AI_AGENT", where: [{ key: "sensitiveAccess", values: ["true"] }] } },
    "runGraphQuery (agents reaching classified data, with the evidence)",
  ],
  ["getAssets", {}],
  // The narrow projections Wiz Scans, Help and Settings read. They belong in this sweep for
  // the reason the meta-guard below exists: a read endpoint outside READ_APIS escapes both
  // the golden AND verdictIsolation's per-asset-claim check, and a projection is exactly the
  // shape most likely to carry one through by accident.
  ["getAssetsHead", {}],
  ["getAssetOptions", {}],
  ["getIssues", {}],
  ["getToxicCombos", {}],
  ["getCombosDigest", {}],
  ["getFiveRsScope", {}],
  // Phase 7: the landscape-wide Priorities page — issues ∪ findings, ranked together.
  ["getProblems", {}],
  // Phase P1a: remediation ACTIONS ranked by marginal set-cover over the same union.
  ["getActions", {}],
  ["getSyncHistory", {}],
  // The Wiz Scans pair. The page half is small and describes the last sync's outcomes; the
  // sheet half carries the GraphQL documents verbatim, which is the thing most worth pinning
  // in this whole golden — this module's own header says the document is read from the server
  // precisely so a hand-typed description cannot drift from it, and a snapshot is what makes
  // that true of the wire as well. `posture` is the area with the most steps.
  ["getScanQueries", {}],
  ["getScanStepDetail", { area: "posture" }],
  ["getSettings", {}],
  ["getAarsRule", {}],
  // Phase 5: the problem tree's rule state, mirroring getAarsRule above. Mutating
  // endpoints (setProblemRule, previewProblemRule, recomputeProblems) stay out of this
  // list, per its own rule.
  ["getProblemRule", {}],
  // Phase 6: the posture lattice's rule state, mirroring getProblemRule above. Mutating
  // endpoints (setPostureRule, previewPostureRule, recomputePostures) stay out of this
  // list, per its own rule.
  ["getPostureRule", {}],
  // WP6: the minimal model's rule state. In this list rather than exempted alongside the
  // three rule endpoints in verdictIsolation.test.ts — the rank is not one of the confined
  // verdicts, so it has to pass the wire guard like a page endpoint does, and passing it is
  // a stronger claim than an exemption would be. Mutating endpoints (setRankRule) stay out,
  // per this list's own rule.
  ["getRankRule", {}],
  ["getStorageStats", {}],
  // agent-h-chatbot is the max-degree node in the golden getGraph payload (17 neighbors),
  // so it exercises the widest neighbour list getAssetDetail can produce in this landscape.
  ["getAssetDetail", { id: "agent-h-chatbot" }],
  // One of agent-h-chatbot's own issues, so the two new golden cases are cross-checkable
  // against each other as well as against the dry-run sync snapshot.
  ["getIssueDetail", { id: "iss-026" }],
  ["getConfigFindings", {}],
  // cfg-005 is the off-inventory case on purpose: a RAW_ACCESS_POLICY the AI graph does
  // not model, carrying an ignore rule. It pins both the null `asset` arm and the
  // accepted-risk arm, which the linked findings would not reach.
  ["getConfigFindingDetail", { id: "cfg-005" }],
];

/**
 * Replace the values that legitimately vary between runs, so a diff in the snapshot means
 * a behaviour change rather than a clock tick. Volatile fields are REPLACED, not dropped —
 * a field that stops being emitted has to show up as a difference.
 */
export function normalize(value: unknown): unknown {
  const VOLATILE = /^(dataVersion|elapsedMs|ms|durationMs)$/;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = VOLATILE.test(k) ? `<${k}>` : walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}
