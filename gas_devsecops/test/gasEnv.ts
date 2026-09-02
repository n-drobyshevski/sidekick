// Boots the server against the dev harness's GAS fakes, in-process. Ported from
// gas_ai/test/gasEnv.ts (see that file's header for the fuller rationale) and trimmed to
// what gas_devsecops Phase 1/2 actually has.
//
// `dev/gas-shims.js` already fakes every Google service the local dev server needs. It is
// plain JS assigning to `window`, with no DOM dependency, so aliasing `window` to
// `globalThis` and evaluating it gives Node the same environment the browser harness gets —
// which is the only way to exercise `access.ts`, `setup.ts`, `api.ts` and friends at all:
// they have no other test coverage. Using the dev shims rather than a second set of fakes is
// deliberate — a private mock would be one more thing to keep in step with the real
// services, and a shim that drifts breaks both the dev harness and the tests at once.
//
// ---------------------------------------------------------------------------- exported API
//
//   FROZEN_NOW          the frozen Date every bootServer() sets the clock to.
//   bootServer()         vi.resetModules() + fresh GAS shims + a fresh `../src/server/index`
//                         import. Call this in `beforeEach` (or `beforeAll`, if a file wants
//                         to share one boot — see the note below `resetServerMemos`).
//   teardownServer()      undoes the fake-timer freeze `bootServer` installs. Call in
//                         `afterEach`/`afterAll` so a later, non-gasEnv test file in the same
//                         worker does not inherit a frozen `Date`.
//   resetServerMemos()    drops every server module's per-execution memo without a full
//                         `vi.resetModules()` + re-import. See the long comment below for
//                         why it exists, what it covers, and why it is safe to export
//                         (gas_ai keeps its equivalent private; there is no
//                         `bootSyncedServer`/`resetToSynced` fast-path here yet to hide it
//                         behind — Phase 1/2 has no sync battery, so there is nothing to
//                         "sync once and photograph". A test that wants a cheap reset
//                         between cases calls this directly instead of re-booting.).
//   GasCounters           the shape `measure()` reports — service-call tallies the shim
//                         keeps (see the `counters` block in dev/gas-shims.js).
//   measure(fn)            run `fn` and report what it cost the fake platform (service calls,
//                         not wall clock), so a spec can assert a read got CHEAPER rather
//                         than merely that it still returns the right answer.
//   normalize(value)       replace volatile fields (`dataVersion`, `elapsedMs`, `ms`,
//                         `durationMs`) with a placeholder, for any future golden-snapshot
//                         test ported from gas/ or gas_ai/ that diffs a whole payload.
//
// DROPPED FROM gas_ai's COPY, ON PURPOSE:
//   - `bootSyncedServer()` / `resetToSynced()` — gas_ai's fast path boots once, runs one
//     dry-run sync, and photographs the fakes so 100+ tests do not each re-run a sync. There
//     is no sync battery here yet (`setup.ts`: "Triggers: none installed (no sync battery
//     yet — Phase 2)", and `api.ts` exports only bootstrap/getSettings/putSettings/
//     getChartsBundle — no `runSync`), so there is nothing to sync and nothing to
//     photograph. Referencing `api.runSync` here would not even typecheck. When the sync
//     battery lands, whoever wires it up gets `resetServerMemos()` below for free — it is
//     exactly the sweep `resetToSynced` used to do between tests — and can add the
//     boot-once-sync-once-snapshot wrapper around it the way gas_ai did.
//   - `READ_APIS` — gas_ai's list of every read-only `api_*` endpoint for a golden-fixture
//     sweep (`getGraph`, `getAssets`, `getAarsRule`, ...). Every one of those is a gas_ai
//     AI-graph endpoint that does not exist on this register's `api.ts`; stubbing them would
//     describe an API surface this project does not have.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { vi } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Frozen so job ids, timestamps and elapsed figures are stable across runs. */
export const FROZEN_NOW = new Date("2026-09-02T09:00:00.000Z");

type ServerModule = typeof import("../src/server/index");

/**
 * Fresh GAS environment + a freshly-imported server.
 *
 * Every call resets the module registry, so the memoized spreadsheet handle in sheetsDb, the
 * access decision in access.ts, and every other per-execution memo below all start empty —
 * which is what lets one test boot two independent servers and compare them.
 *
 * Only `Date` is faked. `setTimeout` stays real because the trigger shim uses it to fire
 * continuation jobs (see dev/gas-shims.js's ScriptApp.newTrigger); a frozen clock means a
 * hop-budget deadline can never trip on its own, which matters once a sync battery exists.
 */
export async function bootServer(): Promise<ServerModule> {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FROZEN_NOW);

  const g = globalThis as Record<string, unknown>;
  g["window"] = globalThis;
  // Set BEFORE the shims are evaluated, because `Utilities.sleep` reads it on every call and
  // a retrying test may call it as its very first action. See that shim's own comment: it
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

// --------------------------------------------------------------- per-execution memo sweep
//
// Module state is per-execution in real GAS — a memo lives and dies with one request. Here
// the module registry outlives a test, so without an explicit sweep a value memoized in one
// test would go on answering in the next: an access decision refused once would stay
// refused, a spreadsheet handle opened against one property would stay open after the
// property changed, a cached DATA_VERSION would go on looking current after a "mutation".
//
// EVERY MODULE HOLDING STATE ACROSS A CALL HAS TO BE NAMED HERE, and one forgotten is state
// quietly leaking between tests — so the list is built to fail loudly rather than silently
// when it goes stale:
//
//   - Five modules (access, archiveStore, readModelStore, serverCache, sheetsDb) follow the
//     `__resetMemosForTest` convention `src/server/access.ts:138` documents. They are
//     imported into ONE array below so TypeScript computes their combined type as a union;
//     `.__resetMemosForTest()` on that union only typechecks if EVERY member of the union
//     has it. Drop the export from any one of them and `npm run typecheck` (which `npm run
//     check` runs before the tests) fails at this exact line — a missing sweep target is a
//     compile error with a file and line, not a silently-skipped reset.
//   - `settingsStore` holds the same shape of per-execution memo (`settingsMemo`) but,
//     unlike gas_ai's copy of the same file, exports the reset under its own name —
//     `resetSettingsMemo` — rather than `__resetMemosForTest`. That is a real divergence
//     from the convention the comment above documents, not an oversight in this file: it is
//     called out here, by its real name, rather than silently matched against a name it does
//     not use.
//   - `props.ts` was checked and holds no per-execution memo at all — every getter reads
//     PropertiesService directly on every call — so nothing is swept for it.
//   - `jobsStore.ts`, `locks.ts`, `api.ts`, `main.ts`, `setup.ts`, `welcome.ts`,
//     `wizQueries.ts`, `diagnostics.ts`, `buildInfo.ts` and `pageShell.ts` were checked
//     (`grep -nE '^(let|var) '` over every file in src/server) and hold no module-level
//     mutable state either.
export async function resetServerMemos(): Promise<void> {
  const mods = await Promise.all([
    import("../src/server/access"),
    import("../src/server/archiveStore"),
    import("../src/server/readModelStore"),
    import("../src/server/serverCache"),
    import("../src/server/sheetsDb"),
  ]);
  for (const m of mods) m.__resetMemosForTest();

  const settings = await import("../src/server/settingsStore");
  settings.resetSettingsMemo();
}

// ------------------------------------------------------------- the fake platform's own API
//
// `__gasFakes` is dev/gas-shims.js's own snapshot/restore/counters surface — see that file's
// tail comment. Exposed here only for `measure()`; nothing in this file calls
// `snapshot()`/`restore()` directly, because there is no synced-fixture fast path yet (see
// the header comment). A future `bootSyncedServer()` would reach for them the same way
// gas_ai's does.

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
  if (!f) throw new Error("__gasFakes missing — dev/gas-shims.js was not evaluated. Call bootServer() first.");
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

/**
 * Replace the values that legitimately vary between runs, so a diff in a captured payload
 * means a behaviour change rather than a clock tick. Volatile fields are REPLACED, not
 * dropped — a field that stops being emitted has to show up as a difference. Ported ahead of
 * anything that needs it yet, so a golden-snapshot test brought over from gas/ or gas_ai/
 * does not have to reinvent it.
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
