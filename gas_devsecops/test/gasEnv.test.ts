// Proves the three guarantees test/gasEnv.ts's header claims: a boot is a fresh module
// registry, `Utilities.sleep` cannot hang a test under the instant-sleep flag, and the shim
// globals the server relies on are actually there after a boot. Every server-side test that
// needs a booted GAS shim environment was blocked on this file existing at all
// (src/server/access.ts:138, vitest.config.ts's `statefulFiles()`), so this is also the
// first thing to fail loudly if the port regresses.

import { afterEach, describe, expect, it } from "vitest";
import { bootServer, resetServerMemos, teardownServer } from "./gasEnv";

// `bootServer`/`resetServerMemos`/`teardownServer` are bound once, above, at this file's own
// load — before any test runs `vi.resetModules()`. That reset only affects what a later
// `import(...)` call resolves to; it does not invalidate references already held (functions
// keep their identity, and their closures keep working), so these three stay valid across
// every `bootServer()` call below without needing to be re-imported per test.

afterEach(() => {
  teardownServer();
});

describe("bootServer", () => {
  it("gives every boot a fresh module registry — a memo set in the first is gone in the second", async () => {
    await bootServer();
    // Nothing has set DATA_VERSION yet, so dataVersion() memoizes the unset-property default.
    const cache1 = await import("../src/server/serverCache");
    expect(cache1.dataVersion()).toBe("0");

    // Mutate the underlying Script Property directly, bypassing the memo-setting API. If
    // dataVersion() re-read the property this would already show up — it must not, or the
    // rest of this test is not actually exercising a memo at all.
    PropertiesService.getScriptProperties().setProperty("DATA_VERSION", "7");
    expect(cache1.dataVersion(), "dataVersion() re-read the property instead of memoizing it")
      .toBe("0");

    // A second boot: fresh module registry (so serverCache's `dataVersionMemo` closure is a
    // new, unset variable) AND a fresh shim evaluation (so PropertiesService itself is a new,
    // empty Map — dev/gas-shims.js's `props` lives in the IIFE's closure).
    await bootServer();
    const cache2 = await import("../src/server/serverCache");
    expect(cache2, "the second boot returned the SAME module instance as the first")
      .not.toBe(cache1);

    // Seed the fresh (empty) PropertiesService with a different value, then read it through
    // the fresh module. A leaked memo from boot 1 would answer "0" (or "7"); a leaked
    // PropertiesService would answer whatever boot 1 last set. Neither happens: this reads
    // exactly what was just written to the NEW platform through the NEW module.
    PropertiesService.getScriptProperties().setProperty("DATA_VERSION", "42");
    expect(cache2.dataVersion()).toBe("42");
  });

  it(
    "Utilities.sleep returns immediately under the instant-sleep flag, even with a frozen clock",
    async () => {
      await bootServer();
      expect(
        (globalThis as Record<string, unknown>)["__GAS_SHIM_INSTANT_SLEEP__"],
        "bootServer() did not set the instant-sleep flag before evaluating the shims",
      ).toBe(true);

      // bootServer() already froze Date via vi.useFakeTimers({ toFake: ["Date"] }). Without
      // the instant-sleep flag, dev/gas-shims.js's Utilities.sleep spins on `Date.now() <
      // end` — and under a frozen clock that condition can never go false, so the spin never
      // ends. It is synchronous, so no vitest test-timeout can interrupt it from the outside;
      // the only thing that can catch a regression here is the hard timeout passed to this
      // `it()` below, which kills the WORKER rather than the loop. That is why this test
      // exists on its own rather than folded into a bigger one: a hang here must fail fast
      // and identify itself, not take the rest of the suite down with it.
      const before = Date.now();
      Utilities.sleep(60_000);
      const after = Date.now();

      // The clock is frozen (fake, unadvanced) AND sleep is instant, so elapsed frozen-time
      // is exactly zero — not merely "small". A real spin would also leave this at 0 (fake
      // Date never advances), which is exactly why the hard timeout below is the test that
      // actually catches a regression; this assertion just confirms sleep returned at all.
      expect(after - before).toBe(0);
    },
    2_000,
  );

  it("defines the shim globals the server relies on", async () => {
    await bootServer();
    const g = globalThis as Record<string, unknown>;
    // Every one of these is defined in dev/gas-shims.js (verified by reading it): Utilities,
    // PropertiesService and Session support access.ts; LockService and ScriptApp back
    // locks.ts/jobsStore.ts; CacheService backs serverCache.ts; DriveApp and SpreadsheetApp
    // back archiveStore.ts/sheetsDb.ts; HtmlService backs api.getChartsBundle; UrlFetchApp is
    // the one shim that is not a fake (it proxies to the dev server) but is still defined.
    for (const name of [
      "SpreadsheetApp",
      "DriveApp",
      "PropertiesService",
      "CacheService",
      "LockService",
      "ScriptApp",
      "Utilities",
      "UrlFetchApp",
      "HtmlService",
      "Session",
    ]) {
      expect(g[name], `${name} was not defined by dev/gas-shims.js after bootServer()`)
        .toBeDefined();
    }
  });
});

describe("resetServerMemos", () => {
  it("drops the access decision memo without a full reboot", async () => {
    const server = await bootServer();

    // The dev shim's Session always answers "dev@example.com" for both active and effective
    // user, so check() always memoizes {reason: "owner"} regardless of ALLOWED_USERS — this
    // asserts the memo is a genuine memo (identical object across calls), not that the
    // decision itself can be swayed by a property.
    const first = server.access.check();
    expect(server.access.check()).toBe(first); // same object: still memoized

    await resetServerMemos();
    expect(server.access.check(), "resetServerMemos() left the access memo in place")
      .not.toBe(first); // new object: the memo was dropped and recomputed
  });

  it("drops settingsStore's memo under its own name (resetSettingsMemo, not __resetMemosForTest)", async () => {
    const server = await bootServer();
    // loadSettings() reads the `settings` tab off the ledger spreadsheet, which only exists
    // once setup() has created it — an unset LEDGER_SPREADSHEET_ID throws instead of memoizing
    // anything, so this test needs the ledger present, not just the module registry.
    server.setup();
    const settingsStore = await import("../src/server/settingsStore");

    const first = settingsStore.loadSettings();
    expect(settingsStore.loadSettings()).toBe(first); // memoized

    await resetServerMemos();
    expect(settingsStore.loadSettings(), "resetServerMemos() left the settings memo in place")
      .not.toBe(first);
  });
});
