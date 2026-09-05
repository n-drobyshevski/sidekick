// A manifest for tests.
//
// `configureApp()` is called by an app's `app.js`, which no unit test imports (it needs a
// DOM). So a test that reaches a shared module reading the manifest — `store.js`'s
// `parseHash()`, `ui/sheet.js`'s storage keys, `ui/tip.js`'s glossary lookup — has to hand
// one over itself, in a `beforeAll`.
//
// DELIBERATELY NOT A DEFAULT. appConfig() throws when nothing configured it, and that throw
// is the point: an unset manifest is a wiring defect, and a default would silently give one
// app another app's front door. This is a TEST fixture, imported by name, never a fallback.

import { configureApp } from "../appConfig.js";

export const TEST_MANIFEST = {
  productName: "Wiz Sidekick Test",
  openingNoun: "register",
  storagePrefix: "sidekicktest.",
  defaultRoute: "executive",
  findHelpEntry: () => null,
};

/** Install the fixture, optionally with per-test overrides. Call it from `beforeAll`. */
export function configureForTests(overrides) {
  configureApp(Object.assign({}, TEST_MANIFEST, overrides || {}));
}
