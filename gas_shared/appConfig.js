// THE SEAM. One module-scoped manifest, set once by the app before anything else runs.
//
// A shared module cannot reach an app's `helpContent.js` or its route table by relative
// path — `gas_shared/ui/tip.js` has no `../helpContent.js` to import, and inventing one per
// app would put the app back inside the package. So the three things a shared module needs
// to know about its host arrive as data instead: a manifest the app hands over, read
// through `appConfig()`.
//
// TWO RULES, AND BOTH ARE LOAD-BEARING:
//
//   1. `configureApp()` IS THE APP'S FIRST STATEMENT. `gas_devsecops/src/client/js/app.js`
//      calls it at the top of the module body, above every other statement, so no shared
//      module can run a function that reads the manifest before it exists.
//   2. EVERY CONSUMER READS IT INSIDE A FUNCTION, never at module top level. A top-level
//      read would execute during import — which, under esbuild's bundling order, happens
//      BEFORE app.js's own body runs, and would throw on a correctly-wired app. `store.js`
//      reads `defaultRoute` inside `parseHash()`; `sheet.js` builds its localStorage key
//      inside the function that uses it; `tip.js` calls `findHelpEntry` when it resolves a
//      term. That is the pattern; keep it.
//
// The throw is deliberate and is not defensive coding. An unset manifest is a wiring defect
// — it cannot be recovered from and it cannot be defaulted, because a default would silently
// give one app another app's front door. Failing loudly at the first read is the only
// behaviour that names the bug.

/**
 * @typedef {Object} AppManifest
 * @property {string} productName    The product's own name, as the splash and the header
 *                                   spell it ("Wiz Sidekick DevSecOps"). Read by the boot
 *                                   splash and pinned by the brandMark contract.
 * @property {string} openingNoun    What the splash says it is opening — "register",
 *                                   "graph", ... Rendered as `Opening the ${openingNoun}…`.
 * @property {string} storagePrefix  The localStorage namespace, trailing dot included
 *                                   ("sidekickdso."). Two sidekicks served from the same
 *                                   origin must not share a key.
 * @property {string} defaultRoute   The front door: the route an empty or unknown hash
 *                                   resolves to. MUST be a key of `PAGES`.
 * @property {(term: string) => (object|null)} findHelpEntry
 *                                   Resolve a glossary term to its help entry, or null.
 *                                   The app owns its own vocabulary; `ui/tip.js` only asks.
 *
 * Reserved, declared here so the shape is one document rather than a scatter of additions,
 * and consumed by later packages rather than by this one:
 * @property {object}  [PAGES]        The route table — the only IA list (see app.js).
 * @property {object}  [LANE_ICONS]   Lane mark per nav lane.
 * @property {object}  [ROUTE_ICONS]  Route mark per route.
 * @property {string[]} [scopeKinds]  The register's scopes ("sca" / "sast" / "secrets").
 * @property {object}  [sync]         Sync-zone wiring: endpoint names, poll cadence.
 * @property {object}  [experimental] The experimental-content gate's own settings.
 */

/** @type {AppManifest|null} */
let cfg = null;

/**
 * Hand the shared core its host's manifest. Called once, first, by the app entry module.
 * @param {AppManifest} c
 */
export function configureApp(c) {
  cfg = c;
}

/**
 * The manifest, or a loud failure. Never call this at module top level — see rule 2 above.
 * @returns {AppManifest}
 */
export function appConfig() {
  if (!cfg) throw new Error("gas_shared: configureApp() was never called");
  return cfg;
}
