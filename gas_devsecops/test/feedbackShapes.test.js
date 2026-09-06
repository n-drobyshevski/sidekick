// The two empty-state sentence shapes gas_shared/ui/feedback.js draws, and the one guard
// both of them share: `usableDate` (unexported — reached only through the two public
// functions), which refuses null/undefined/""/false/[]/unparseable-string BEFORE any
// `Date.parse` cast rather than trusting truthiness to sort them out.
//
// `vi.resetModules()` + a fresh dynamic import, same pattern as this app's own
// `syncCaption.test.js`: `firstRunNotice` reads `appConfig()`, a module-level singleton that
// must not leak across test files sharing a worker under `isolate: false`. This file's
// `installDomStub()` mutates `globalThis.document`/`globalThis.Node` too — both are the same
// class of hazard, and `vi.resetModules()` appearing in the source is what the classifier in
// `vitest.config.ts` reads to put this file in the isolated project rather than the shared one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installDomStub, text } from "../../gas_shared/test/domStub.js";

let uninstallDom;
beforeEach(() => { uninstallDom = installDomStub(); });
afterEach(() => uninstallDom());

/** A fresh copy of feedback.js, wired to a manifest with no `sync` override — so `noun`
 *  falls back to "sync" and `unit` to "findings", the same default every call site not
 *  naming its own noun already relies on. `vi.resetModules()` first, same as
 *  `syncCaption.test.js`: `appConfig()`'s `cfg` is a module-level singleton, and this is
 *  what both keeps repeat calls in this file clean of each other AND is the literal text
 *  `vitest.config.ts`'s classifier reads to run this file in the isolated project rather
 *  than the shared `pure` one — load-bearing for the same reason `installDomStub()`'s own
 *  global mutation needs it. */
async function loadFeedback(sync) {
  vi.resetModules();
  const { configureApp } = await import("../../gas_shared/appConfig.js");
  configureApp(sync === undefined ? {} : { sync });
  return import("../../gas_shared/ui/feedback.js");
}

describe("measuredEmpty: a filter-empty state that says when it looked", () => {
  it("no \"Measured at\" line when at is null", async () => {
    const { measuredEmpty } = await loadFeedback();
    expect(text(measuredEmpty("No CRITICAL findings.", { at: null }))).not.toMatch(/Measured at/);
  });

  it("carries the dated line when at is a usable timestamp", async () => {
    const { measuredEmpty } = await loadFeedback();
    const node = measuredEmpty("No CRITICAL findings.", { at: "2026-06-15T08:00:00Z" });
    expect(text(node)).toMatch(/Measured at 2026-06-15 — nothing matched\./);
  });

  it("refuses [], false and an unparseable string too, not only the falsy shapes", async () => {
    const { measuredEmpty } = await loadFeedback();
    for (const bad of [undefined, null, "", false, [], "not a date"]) {
      expect(text(measuredEmpty("x", { at: bad })), JSON.stringify(bad)).not.toMatch(/Measured at/);
    }
  });

  it("keeps the message and hint exactly as emptyState renders them", async () => {
    const { measuredEmpty } = await loadFeedback();
    const dated = text(measuredEmpty("No rows.", { hint: "Try another filter.", at: "2026-06-15" }));
    expect(dated).toContain("No rows.");
    expect(dated).toContain("Try another filter.");
    expect(dated).toContain("Measured at 2026-06-15 — nothing matched.");
  });
});

describe("firstRunNotice: the dated sentence only when synced AND at are both real", () => {
  it("synced: true, at: '' gives the undated sentence", async () => {
    const { firstRunNotice } = await loadFeedback();
    const t = text(firstRunNotice({ synced: true, at: "" }));
    expect(t).toBe("The last sync saved no findings, so there is nothing here to measure yet.");
  });

  it("synced: true, at: <iso> gives the dated sentence", async () => {
    const { firstRunNotice } = await loadFeedback();
    const t = text(firstRunNotice({ synced: true, at: "2026-06-15T08:00:00Z" }));
    expect(t).toBe("The last sync on 2026-06-15 saved no findings, so there is nothing here to measure yet.");
  });

  it("synced: false ignores at entirely — never \"on 1 Jan 1970\" for a run that never happened", async () => {
    const { firstRunNotice } = await loadFeedback();
    const t = text(firstRunNotice({ synced: false, at: "2026-06-15T08:00:00Z" }));
    expect(t).toBe("No sync has run yet, so nothing on this page has been measured.");
  });

  it("[] and an unparseable string take the undated sentence, same as blank/null/false", async () => {
    const { firstRunNotice } = await loadFeedback();
    for (const bad of [undefined, null, "", false, [], "not a date"]) {
      const t = text(firstRunNotice({ synced: true, at: bad }));
      expect(t, JSON.stringify(bad))
        .toBe("The last sync saved no findings, so there is nothing here to measure yet.");
    }
  });

  it("never renders the epoch for a null/blank/unparseable at (the literal defect this guards)", async () => {
    const { firstRunNotice } = await loadFeedback();
    for (const bad of [null, undefined, "", [], "not a date"]) {
      const t = text(firstRunNotice({ synced: true, at: bad }));
      expect(t).not.toMatch(/1970/);
    }
  });
});

/**
 * PERTURBATION (run 2026-09-06, then reverted). `usableDate` in
 * `gas_shared/ui/feedback.js` was changed from
 *
 *   function usableDate(at) {
 *     if (at === null || at === undefined || at === "" || at === false) return false;
 *     if (Array.isArray(at)) return false;
 *     return !Number.isNaN(Date.parse(at));
 *   }
 *
 * to plain truthiness:
 *
 *   function usableDate(at) {
 *     return !!at;
 *   }
 *
 * Observed (`npx vitest run test/feedbackShapes.test.js`):
 *
 *   FAIL  … measuredEmpty … > refuses [], false and an unparseable string too, not only the
 *         falsy shapes
 *     AssertionError: []: expected 'xMeasured at  — nothing matched.' not to match /Measured at/
 *   FAIL  … firstRunNotice … > [] and an unparseable string take the undated sentence, same
 *         as blank/null/false
 *     AssertionError: []: expected 'The last sync on  saved no findings…' to be
 *       'The last sync saved no findings, so there is nothing here to measure yet.'
 *   FAIL  … is not satisfied by a truthiness-only guard (perturbation above, reverted)
 *     AssertionError: expected 'xMeasured at  — nothing matched.' not to match /Measured at/
 *
 *   Test Files  1 failed (1)
 *   Tests  3 failed | 7 passed (10)
 *
 * The bite is exactly `[]` and the unparseable string — both are TRUTHY in JS, so `!!at`
 * waves them through, and `Date.parse` then returns NaN, silently rendered back by
 * `fmtDate`'s `String(iso)` fallback: `[]` stringifies to "" (the empty-looking "Measured at
 *  — nothing matched." above), an unparseable string comes back as itself. `false` and the
 * blank/null/undefined cases stayed green even under the truthiness rewrite — they are
 * falsy, so `!!at` already refuses them, for the wrong reason (luck, not design) — which is
 * exactly why `[]` and an unparseable string are the two values a perturbation has to name to
 * test the refuse-before-cast rule rather than mere falsiness. Reverted; all three failures
 * above are back to green.
 */
it("is not satisfied by a truthiness-only guard (perturbation above, reverted)", async () => {
  const { measuredEmpty, firstRunNotice } = await loadFeedback();
  expect(text(measuredEmpty("x", { at: [] }))).not.toMatch(/Measured at/);
  expect(text(firstRunNotice({ synced: true, at: "not a date" })))
    .toBe("The last sync saved no findings, so there is nothing here to measure yet.");
});
