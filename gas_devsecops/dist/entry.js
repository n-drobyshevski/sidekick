/**
 * dist/entry.js — the GAS globals, hand-written and never touched by the build.
 *
 * esbuild bundles src/server into dist/server.js as an IIFE assigned to the global
 * `Server`. Apps Script can only call top-level functions, so every callable surface needs
 * a thin global here that delegates into that namespace. THIS FILE IS NOT GENERATED:
 * test/entryPoints.test.js reads it and src/server/api.ts as text and asserts they agree,
 * because the failure mode is silent and production-only — google.script.run reports only
 * that the function does not exist.
 */

/**
 * The web-app entry. ORDER IS LOAD-BEARING: the denial page has to win before the welcome
 * gate, or someone who is not allowed in gets an invitation instead of a refusal.
 */
function doGet(e) {
  var denied = Server.access.deniedPage();
  if (denied) return denied;
  var welcome = Server.welcome.gate(e);
  if (welcome) return welcome;
  return Server.doGet(e);
}

/**
 * Used by the <?!= include(...) ?> scriptlets in index.html.
 *
 * GATED, and that is not paranoia: `include` is a top-level global, so ungated it is an
 * open createHtmlOutputFromFile(<caller's string>) primitive reachable by anyone who can
 * reach the script.
 */
function include(filename) {
  return Server.access.denyResult("include") ? "" : Server.include(filename);
}

/**
 * The one chokepoint every RPC passes through: check access, time the call, log the timing.
 *
 * Gating HERE rather than inside each api_X, or inside api.ts's run(), covers every
 * delegator without touching the parity-checked lines themselves. The {ok,data} envelope is
 * built in api.ts, not here — dev/boot.js dispatches straight into Server.api and never
 * runs this file, so an envelope built here would make the harness and the deployment
 * disagree about what a failure looks like.
 *
 * Timing every call rather than sampling: an Apps Script execution log is the only profiler
 * this platform has.
 */
function timedApi_(name, params) {
  var denied = Server.access.denyResult(name);
  if (denied) return denied;
  var t0 = Date.now();
  var res = Server.api[name](params || {});
  console.log(JSON.stringify({ api: name, ms: Date.now() - t0 }));
  return res;
}

/* ----------------------------------------------------------------- RPC delegators */
/* One per export in src/server/api.ts. test/entryPoints.test.js holds the parity. */

function api_bootstrap(p) { return timedApi_("bootstrap", p); }
function api_getSettings(p) { return timedApi_("getSettings", p); }
function api_putSettings(p) { return timedApi_("putSettings", p); }
function api_getChartsBundle(p) { return timedApi_("getChartsBundle", p); }
function api_runSampleSync(p) { return timedApi_("runSampleSync", p); }
function api_getMttr(p) { return timedApi_("getMttr", p); }
function api_getRegister(p) { return timedApi_("getRegister", p); }
function api_getExecutive(p) { return timedApi_("getExecutive", p); }
function api_getAccess(p) { return timedApi_("getAccess", p); }
function api_saveAccess(p) { return timedApi_("saveAccess", p); }
function api_saveAdmins(p) { return timedApi_("saveAdmins", p); }

/* ------------------------------------------------------- editor-run, not RPC */
/* Gated: these run as whoever opened the editor, which is not necessarily the owner. */

function setup() {
  Server.access.assertAllowed("setup");
  return Server.setup();
}

function deploymentDiagnostic() {
  Server.access.assertAllowed("deploymentDiagnostic");
  return Server.deploymentDiagnostic();
}

/* ----------------------------------------------------------------- triggers */
/* None yet. When the sync battery lands its continuation handlers go here and they must
   stay UNGATED: an installable trigger runs with no active user, so an access check would
   deny every firing silently. */
