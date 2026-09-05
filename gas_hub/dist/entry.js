/**
 * dist/entry.js — the GAS globals, hand-written and never touched by the build.
 *
 * esbuild bundles src/server into dist/server.js as an IIFE assigned to the global
 * `Server`. Apps Script can only call top-level functions, so every callable surface needs
 * a thin global here that delegates into that namespace. THIS FILE IS NOT GENERATED:
 * test/entryPoints.test.js reads it and src/server/api.ts as text and asserts they agree,
 * and esbuild.config.mjs fails the build on the same disagreement — because the failure mode
 * is silent and production-only: google.script.run reports only that the function does not
 * exist.
 */

/**
 * The web-app entry.
 *
 * NO WELCOME HOP, AND ITS ABSENCE IS DELIBERATE. Each register runs its own "signed in as X,
 * Continue" gate before it draws, and this app's whole job is to send a reader to one of
 * them — a gate here would put two interstitials in one journey to answer the same question
 * twice. src/server/welcome.ts is therefore not forked into this project at all, so there is
 * no gate to accidentally re-enable. The identity story a refused visitor needs is still
 * told: `deniedPage()` names the account it actually saw and offers the account chooser.
 */
function doGet(e) {
  var denied = Server.access.deniedPage();
  if (denied) return denied;
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
/* One per export in src/server/api.ts, in that file's order. test/entryPoints.test.js and
 * esbuild.config.mjs's drift guard both hold the parity. */

function api_bootstrap(p) { return timedApi_("bootstrap", p); }
function api_getAccess(p) { return timedApi_("getAccess", p); }
function api_saveAccess(p) { return timedApi_("saveAccess", p); }
function api_saveAdmins(p) { return timedApi_("saveAdmins", p); }
function api_getUrls(p) { return timedApi_("getUrls", p); }
function api_saveUrls(p) { return timedApi_("saveUrls", p); }

/* ------------------------------------------------- no editor globals, no triggers */
/*
 * The registers declare `setup()`, `deploymentDiagnostic()`, `wizDiagnostic()`,
 * `resetStuckJob()` and four `trigger_*` handlers here. This app declares none, and that is
 * a fact worth stating rather than a gap: it provisions nothing (its only state is five
 * Script Properties an operator sets by hand), fetches nothing, runs no job, and installs no
 * trigger — so there is no scheduled firing that could be silently denied, which is the trap
 * the registers' ungated trigger handlers exist to avoid. A `trigger_` function appearing
 * here later would need the argument made again, in its own round.
 */
