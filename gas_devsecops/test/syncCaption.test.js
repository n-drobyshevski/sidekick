// The rail's freshness sentence, unified across all three apps by P8: `syncCaption()`
// (gas_shared/ui/feedback.js) replaces this app's old `` `Last sync ${fmtDateTime(ts)}` ``,
// which carried no relative age at all.
//
// THIS APP DECLARES NO `MANIFEST.sync` EITHER, for the same reason gas_ai's copy of this file
// gives: "sync"/"Run sync"/`api_runSync` already is this register's own vocabulary, so it is
// exactly the shared default.
//
// `vi.resetModules()` + a fresh dynamic import — see gas_ai's `experimental.test.js` (the
// pattern this is ported from) and gas's sibling `syncCaption.test.js` for why: `syncCaption()`
// reads `appConfig()`, whose `cfg` is a module-level singleton that must not leak across test
// files sharing a worker under `isolate: false`.

import { describe, expect, it, vi } from "vitest";

async function load(sync) {
  vi.resetModules();
  const { configureApp } = await import("../../gas_shared/appConfig.js");
  configureApp(sync === undefined ? {} : { sync });
  return import("../../gas_shared/ui/feedback.js");
}

describe("gas_devsecops: syncCaption() falls back to the shared default noun (\"sync\")", () => {
  it("says \"No syncs yet.\" before the first one", async () => {
    const { syncCaption } = await load();
    expect(syncCaption(null)).toBe("No syncs yet.");
    expect(syncCaption(undefined)).toBe("No syncs yet.");
  });

  it("carries the datetime and the relative age, separated by \" · \" — this rail had no age before P8", async () => {
    const { syncCaption } = await load();
    const { fmtDateTime } = await import("../../gas_shared/ui/format.js");
    const { relativeAge } = await import("../../gas_shared/ui/figures.js");
    const ts = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(syncCaption(ts)).toBe(`Last sync ${fmtDateTime(ts)} · ${relativeAge(ts)}`);
    expect(syncCaption(ts)).toMatch(/^Last sync .+ · 2 days ago$/);
  });
});
