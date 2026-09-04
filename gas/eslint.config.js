// Undefined-identifier guard for the vanilla-JS client. See CLAUDE.md ("A guard that fires
// on nothing is a finding") for why this exists: in a sibling package, a helper consolidation
// deleted a page's local formatting helper and forgot the import, and neither tsc (does not
// check .js) nor esbuild (does not error on a free identifier) nor the page tests (exercise
// pure view-model halves) caught it. `no-undef` over this file set is the narrowest tool that
// actually catches that class of defect — a tsc-checkJs alternative was tried there and
// rejected (it flooded on untyped object-literal shapes with no undefined-identifier signal
// left in the noise).
//
// ONLY no-undef IS ENFORCED. no-unused-vars was tried as a warning there and rejected: it hit
// mostly deliberately-unused catch bindings and callback params, noise this guard's one job
// does not need. Anything else — style, complexity, etc. — is out of scope for this guard and
// would just be a second opinion competing with the tests.
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
  CompressionStream: "readonly",
  DecompressionStream: "readonly",
};

// dev/*.js only: each shim script assigns a property of `window` (`window.Server = ...`,
// `window.PropertiesService = ...`) that later dev scripts, loaded as separate classic
// <script> tags in the same page (see dev/serve.mjs), then read as a bare identifier — that
// is how gas-shims.js's fakes and the Server bundle reach boot.js. These are genuinely
// cross-file implicit globals, not typos: no-undef has nothing else it can check them
// against, since there is no import to trace.
const devShimGlobals = {
  Server: "readonly",
  PropertiesService: "readonly",
  SpreadsheetApp: "readonly",
};

// The HtmlService bridge (google.script.run) and the esbuild `define`-time constant
// (buildStamp.mjs stamps __BUILD_ID__ into the bundle).
const platformGlobals = {
  google: "readonly",
  __BUILD_ID__: "readonly",
};

export default [
  {
    // dev/server.dev.js is esbuild's rebuild of the TS server bundle for the local dev
    // harness (dev/serve.mjs, on every page load) — a generated artifact, .gitignored, and
    // not one of the files this guard exists to cover (it is checked, in TypeScript, by
    // `npm run typecheck`, and it is server code, not the vanilla-JS client). It shows up
    // inside dev/ only because that is where the dev server happens to write it, and its
    // free `SpreadsheetApp`/`DriveApp`/... GAS-global references are correct there, not bugs
    // — so it is excluded rather than added to the globals list.
    ignores: ["dev/server.dev.js"],
  },
  {
    files: ["src/client/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...browserGlobals, ...platformGlobals },
    },
    rules: {
      "no-undef": "error",
    },
  },
  {
    // dev/*.js are classic (non-module) scripts loaded in order via <script> tags — see
    // dev/serve.mjs — so each one's top-level `var`/`function` becomes an implicit global the
    // next script relies on (window.Server, window.__gasFakes, ...). "script" sourceType
    // reflects that; ecmaVersion still needs to be high enough for the syntax the shims use.
    files: ["dev/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...browserGlobals, ...platformGlobals, ...devShimGlobals },
    },
    rules: {
      "no-undef": "error",
    },
  },
];
