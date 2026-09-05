// The rail's freshness sentence, unified across all three apps by P8: `syncCaption()`
// (gas_shared/ui/feedback.js) replaces the bare Math.floor day count this app's `renderScanZone`
// used to build inline, gated at `age >= 2` — a scan an hour old showed no age at all.
//
// THIS APP'S OWN NOUN. `MANIFEST.sync = { noun: "scan", unit: "findings" }` (app.js) is what
// turns the shared sentence's default "sync"/"syncs" into "scan"/"scans" here — the same
// manifest field `firstRunNotice` already reads, extended rather than duplicated.
//
// `vi.resetModules()` + a fresh dynamic import, the same pattern gas_ai's own
// `experimental.test.js` uses and for the identical reason: `syncCaption()` reads
// `appConfig()`, which throws unless `configureApp()` ran first, and `configureApp()` sets a
// module-level singleton this file must not leave behind for a sibling test file sharing the
// same worker under `isolate: false`. `vi.resetModules()` is what routes this file into the
// isolated "stateful" project (see vitest.config.ts's `statefulFiles()`), so it gets its own
// module registry and cannot leak `cfg` into — or inherit it from — anything else.

import { describe, expect, it, vi } from "vitest";

async function load(sync) {
  vi.resetModules();
  const { configureApp } = await import("../../gas_shared/appConfig.js");
  configureApp({ sync });
  return import("../../gas_shared/ui/feedback.js");
}

describe("gas: syncCaption() reads MANIFEST.sync.noun (\"scan\")", () => {
  it("says \"No scans yet.\" before the first one — never the shared default \"syncs\"", async () => {
    const { syncCaption } = await load({ noun: "scan", unit: "findings" });
    expect(syncCaption(null)).toBe("No scans yet.");
    expect(syncCaption(undefined)).toBe("No scans yet.");
    expect(syncCaption("")).toBe("No scans yet.");
  });

  it("carries the datetime and the relative age, separated by \" · \"", async () => {
    const { syncCaption } = await load({ noun: "scan", unit: "findings" });
    const { fmtDateTime } = await import("../../gas_shared/ui/format.js");
    const { relativeAge } = await import("../../gas_shared/ui/figures.js");
    const ts = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(syncCaption(ts)).toBe(`Last scan ${fmtDateTime(ts)} · ${relativeAge(ts)}`);
    expect(syncCaption(ts)).toMatch(/^Last scan .+ · 2 days ago$/);
  });

  it("falls back to the shared default \"sync\"/\"syncs\" when a register declares no noun", async () => {
    // Not a case this app's own manifest ever hits (it always declares "scan") — pinned so a
    // future manifest that drops the field silently is caught here rather than only by the
    // siblings that rely on the default on purpose.
    const { syncCaption } = await load({});
    expect(syncCaption(null)).toBe("No syncs yet.");
  });
});
