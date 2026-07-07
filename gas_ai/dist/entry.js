// Hand-written GAS entry points. The build never touches this file.
// GAS requires doGet / trigger handlers / google.script.run targets to be top-level
// global functions; everything else lives on the bundled `Server` global (server.js).

function doGet(e) { return Server.doGet(e); }
function include(f) { return Server.include(f); }

// One-time setup: creates the spreadsheet tabs, Drive folders, and the daily sync
// trigger, and records their IDs in Script Properties. Run from the GAS editor.
function setup() { return Server.setup(); }

// Wiz connectivity check — run from the GAS editor to validate credentials; it prints
// which auth/query step fails (secret-safe) to the execution log. Never used by a sync.
function wizDiagnostic() { return Server.wizDiagnostic(); }

// Trigger handlers (names referenced by ScriptApp.newTrigger calls).
function trigger_dailySync() { Server.jobs.dailySync(); }
function trigger_continueSync(e) { Server.jobs.continueJob(e); }

// google.script.run API surface — thin delegators so the client can call api_* by name.
// Each is timed to the execution log ({"api":name,"ms":n} lines) so server cost can be
// separated from google.script.run round-trip overhead when profiling.
function timedApi_(name, p) {
  var t0 = Date.now();
  var res = Server.api[name](p);
  console.log(JSON.stringify({ api: name, ms: Date.now() - t0 }));
  return res;
}
function api_bootstrap(p) { return timedApi_("bootstrap", p); }
function api_getGraph(p) { return timedApi_("getGraph", p); }
function api_getAssets(p) { return timedApi_("getAssets", p); }
function api_getAssetDetail(p) { return timedApi_("getAssetDetail", p); }
function api_getIssues(p) { return timedApi_("getIssues", p); }
function api_getIssueDetail(p) { return timedApi_("getIssueDetail", p); }
function api_getToxicCombos(p) { return timedApi_("getToxicCombos", p); }
function api_runSync(p) { return timedApi_("runSync", p); }
function api_getJobStatus(p) { return timedApi_("getJobStatus", p); }
function api_cancelSync(p) { return timedApi_("cancelSync", p); }
function api_getSyncHistory(p) { return timedApi_("getSyncHistory", p); }
function api_getSettings(p) { return timedApi_("getSettings", p); }
function api_setSettings(p) { return timedApi_("setSettings", p); }
function api_resetData(p) { return timedApi_("resetData", p); }
function api_getStorageStats(p) { return timedApi_("getStorageStats", p); }
