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
function api_setProjectView(p) { return timedApi_("setProjectView", p); }
function api_getChartsBundle(p) { return timedApi_("getChartsBundle", p); }
function api_getExecutivePage(p) { return timedApi_("getExecutivePage", p); }
function api_getMttrPage(p) { return timedApi_("getMttrPage", p); }
function api_getProgramPage(p) { return timedApi_("getProgramPage", p); }
function api_getRegisterPage(p) { return timedApi_("getRegisterPage", p); }
function api_getSecretsPage(p) { return timedApi_("getSecretsPage", p); }
function api_getRegisterRows(p) { return timedApi_("getRegisterRows", p); }
function api_getReposPage(p) { return timedApi_("getReposPage", p); }
function api_getScanHistory(p) { return timedApi_("getScanHistory", p); }
function api_getStorageStats(p) { return timedApi_("getStorageStats", p); }
function api_runSync(p) { return timedApi_("runSync", p); }
function api_getJobStatus(p) { return timedApi_("getJobStatus", p); }
function api_cancelSync(p) { return timedApi_("cancelSync", p); }
function api_deleteScans(p) { return timedApi_("deleteScans", p); }
function api_compact(p) { return timedApi_("compact", p); }
function api_resetLedger(p) { return timedApi_("resetLedger", p); }
function api_getExportCsv(p) { return timedApi_("getExportCsv", p); }
function api_getRecentErrors(p) { return timedApi_("getRecentErrors", p); }
function api_testWizConnection(p) { return timedApi_("testWizConnection", p); }
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
/*
 * THESE FOUR ARE UNGATED, AND THAT IS THE WHOLE POINT.
 *
 * An installable trigger runs as the project OWNER with NO ACTIVE USER —
 * `Session.getActiveUser().getEmail()` is "" inside one. `Server.access.denyResult` fails
 * closed on an unidentifiable caller, so putting a check here would deny every firing, once a
 * day, forever, with nothing on screen and nothing in the log to say the sync had stopped
 * running. That is the failure mode `test/entryPoints.test.js` pins with its own case: the
 * gate must be ABSENT, not merely correct.
 *
 * They are safe ungated because none of them takes an argument that selects what to do. Each
 * is a fixed verb over server-side state — resume the one active job, reap a dead persist, run
 * the scheduled battery, warm the read models — with no filename, no id and no user input
 * anywhere in the call. `include(filename)` is gated for exactly the opposite reason.
 *
 * THE NAMES ARE FIXED ELSEWHERE AND ARE COPIED HERE, NEVER CHOSEN HERE.
 * `jobsStore.CONTINUE_HANDLERS.sync` / `WATCHDOG_HANDLERS.sync` are what `scanJobs` installs
 * and clears one-shots by, and `setup.ts` installs the standing daily and warm triggers by
 * name. A rename on either side points a live trigger at a function that does not exist, which
 * fails silently on a schedule.
 */

/** jobsStore.CONTINUE_HANDLERS.sync — resume the active sync's next hop. */
function trigger_continueSync(e) { return Server.scanJobs.continueJob(e); }

/** jobsStore.WATCHDOG_HANDLERS.sync — notice a persist whose execution never came back. */
function trigger_watchdogSync(e) { return Server.scanJobs.watchdogSync(e); }

/** setup.ts's standing daily trigger — the scheduled full battery. */
function trigger_dailySync() { return Server.scanJobs.dailySync(); }

/** setup.ts's three standing warm triggers — precompute the landing-page read models. */
function trigger_warmReadModels() { return Server.readModels.warmReadModels(); }

/**
 * Last resort when a job is wedged: jobs are single-flight, so one non-terminal row with no
 * live execution behind it blocks every future sync and the daily trigger with it.
 */
function resetStuckJob() {
  Server.access.assertAllowed("resetStuckJob");
  return Server.scanJobs.resetStuckJob();
}
