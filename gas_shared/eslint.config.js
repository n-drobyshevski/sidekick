// Undefined-identifier guard for the shared client core. Forked from
// gas_devsecops/eslint.config.js, which is the config this package's modules were linted
// under before they moved here; the rule set is identical and deliberately so.
//
// Undefined-identifier guard for the vanilla-JS client. See CLAUDE.md ("A guard that fires
// on nothing is a finding") for why this exists: a helper consolidation deleted history.js's
// local fmtCount and forgot the import, and neither tsc (does not check .js) nor esbuild
// (does not error on a free identifier) nor the page tests (exercise pure view-model halves)
// caught it. `no-undef` over this file set is the narrowest tool that actually catches that
// class of defect — see the handback for the tsc-checkJs alternative that was tried and
// rejected (it flooded on untyped object-literal shapes with no undefined-identifier signal
// left in the noise).
//
// ONLY no-undef IS ENFORCED. no-unused-vars was tried as a warning and rejected: 22 hits on
// the clean tree (mostly deliberately-unused catch bindings and callback params), noise this
// guard's one job does not need. Anything else — style, complexity, etc. — is out of scope
// for this guard and would just be a second opinion competing with the tests.
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  console: "readonly",
  performance: "readonly",
  fetch: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  crypto: "readonly",
  Blob: "readonly",
  File: "readonly",
  FileReader: "readonly",
  FormData: "readonly",
  Event: "readonly",
  CustomEvent: "readonly",
  MutationObserver: "readonly",
  ResizeObserver: "readonly",
  IntersectionObserver: "readonly",
  AbortController: "readonly",
  Node: "readonly",
  Element: "readonly",
  HTMLElement: "readonly",
  Image: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  queueMicrotask: "readonly",
  structuredClone: "readonly",
  globalThis: "readonly",
  self: "readonly",
  atob: "readonly",
  btoa: "readonly",
  DOMParser: "readonly",
  XMLHttpRequest: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  getComputedStyle: "readonly",
};

// The HtmlService bridge (google.script.run) and the esbuild `define`-time constant
// (buildStamp.mjs stamps __BUILD_ID__ into the bundle; the dev server ships its own literal
// build id via dev-config.js, so the source still reads a free identifier here).
const platformGlobals = {
  google: "readonly",
  __BUILD_ID__: "readonly",
};

export default [
  {
    // Every module here is a browser ES module — there is no dev/ shim tier in this
    // package (the apps own their own harnesses), so the two-tier split the app config
    // carries collapses to one block. Paths are package-relative: eslint resolves a flat
    // config's `files` globs against the directory the config file sits in, which is what
    // lets an app lint this tree with `--config ../gas_shared/eslint.config.js`.
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...browserGlobals, ...platformGlobals },
    },
    rules: {
      "no-undef": "error",
    },
  },
];
