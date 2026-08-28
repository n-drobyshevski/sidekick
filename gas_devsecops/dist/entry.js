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
function api_setSettings(p) { return timedApi_("setSettings", p); }
function api_getDiagnostic(p) { return timedApi_("getDiagnostic", p); }
function api_runScan(p) { return timedApi_("runScan", p); }
function api_getJobStatus(p) { return timedApi_("getJobStatus", p); }
function api_cancelScan(p) { return timedApi_("cancelScan", p); }
function api_testWizConnection(p) { return timedApi_("testWizConnection", p); }

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

/**
 * The one to run when Wiz cannot be reached — and the one that ASKS FOR THE SCOPE.
 *
 * Apps Script grants a permission when code needing it actually runs, so a diagnostic that
 * only reads Script Properties authorizes nothing. This makes the real calls, which is what
 * puts the consent screen in front of the operator; `deploymentDiagnostic()` never can.
 */
function wizDiagnostic() {
  Server.access.assertAllowed("wizDiagnostic");
  return Server.wizDiagnostic();
}

/* ----------------------------------------------------------------- triggers */

/**
 * The scan battery's handlers. UNGATED, and that is required rather than an oversight.
 *
 * An installable trigger runs with NO ACTIVE USER — `Session.getActiveUser().getEmail()`
 * returns "" — so an access check here would deny every firing, silently, in a log nobody
 * reads. A multi-hop scan would stop dead at its first budget expiry and look exactly like a
 * hang. `test/entryPoints.test.js` asserts these carry no `denyResult`, because the
 * "helpful" refactor that makes them match the api_ delegators is the failure.
 *
 * Nothing is exposed by making them reachable: neither takes a caller-supplied argument that
 * selects work, and both refuse to do anything unless a job row already exists.
 */
function trigger_continueScan(e) {
  return Server.jobs.continueJob(e);
}

function trigger_dailyScan(e) {
  return Server.jobs.dailyScan(e);
}

/* ------------------------------------------------------- editor-run, not RPC */

/**
 * Last resort when a job is wedged: jobs are single-flight, so one non-terminal row with no
 * live execution behind it blocks every future scan and the daily trigger with it.
 */
function resetStuckJob() {
  Server.access.assertAllowed("resetStuckJob");
  return Server.jobs.resetStuckJob();
}
