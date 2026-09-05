// The rail's freshness sentence, unified across all three apps by P8: `syncCaption()`
// (gas_shared/ui/feedback.js) replaces the bare Math.floor day count this app's `renderSyncZone`
// used to build inline, gated at `age >= 2` — a sync an hour old showed no age at all.
//
// THIS APP DECLARES NO `MANIFEST.sync` AT ALL, and that is on purpose, not an omission: this
// register's own vocabulary already IS "sync"/"Sync now"/`api_runSync`, which is exactly the
// shared default `syncCaption()` and `firstRunNotice()` both fall back to. See gas/'s sibling
// test file for the app that DOES need to override it.
//
// `vi.resetModules()` + a fresh dynamic import, the pattern this app's own
// `experimental.test.js` already established, for the identical reason: `syncCaption()` reads
// `appConfig()`, whose `cfg` is a module-level singleton that must not leak across test files
// sharing a worker under `isolate: false`.

import { describe, expect, it, vi } from "vitest";

async function load(sync) {
  vi.resetModules();
  const { configureApp } = await import("../../gas_shared/appConfig.js");
  configureApp(sync === undefined ? {} : { sync });
  return import("../../gas_shared/ui/feedback.js");
}

describe("gas_ai: syncCaption() falls back to the shared default noun (\"sync\")", () => {
  it("says \"No syncs yet.\" before the first one", async () => {
    const { syncCaption } = await load();
    expect(syncCaption(null)).toBe("No syncs yet.");
    expect(syncCaption(undefined)).toBe("No syncs yet.");
  });

  it("carries the datetime and the relative age, separated by \" · \"", async () => {
    const { syncCaption } = await load();
    const { fmtDateTime } = await import("../../gas_shared/ui/format.js");
    const { relativeAge } = await import("../../gas_shared/ui/figures.js");
    const ts = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(syncCaption(ts)).toBe(`Last sync ${fmtDateTime(ts)} · ${relativeAge(ts)}`);
    expect(syncCaption(ts)).toMatch(/^Last sync .+ · 2 days ago$/);
  });
});
