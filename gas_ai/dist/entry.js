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
function aarsDiagnostic() { return Server.aarsDiagnostic(); }
function registerScopeDiagnostic() { return Server.registerScopeDiagnostic(); }

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
function api_getQueryVocabulary(p) { return timedApi_("getQueryVocabulary", p); }
function api_runGraphQuery(p) { return timedApi_("runGraphQuery", p); }
function api_getAssets(p) { return timedApi_("getAssets", p); }
function api_getAssetOptions(p) { return timedApi_("getAssetOptions", p); }
function api_getAssetDetail(p) { return timedApi_("getAssetDetail", p); }
function api_expandAsset(p) { return timedApi_("expandAsset", p); }
function api_getConfigFindings(p) { return timedApi_("getConfigFindings", p); }
function api_getConfigFindingDetail(p) { return timedApi_("getConfigFindingDetail", p); }
function api_getCompliance(p) { return timedApi_("getCompliance", p); }
function api_setSelectedFrameworks(p) { return timedApi_("setSelectedFrameworks", p); }
function api_getIssues(p) { return timedApi_("getIssues", p); }
function api_getIssueDetail(p) { return timedApi_("getIssueDetail", p); }
function api_getToxicCombos(p) { return timedApi_("getToxicCombos", p); }
function api_getProblems(p) { return timedApi_("getProblems", p); }
function api_getActions(p) { return timedApi_("getActions", p); }
function api_runSync(p) { return timedApi_("runSync", p); }
function api_getJobStatus(p) { return timedApi_("getJobStatus", p); }
function api_cancelSync(p) { return timedApi_("cancelSync", p); }
function api_getSyncHistory(p) { return timedApi_("getSyncHistory", p); }
function api_getScanQueries(p) { return timedApi_("getScanQueries", p); }
function api_setScanVars(p) { return timedApi_("setScanVars", p); }
function api_testScanVars(p) { return timedApi_("testScanVars", p); }
function api_getSettings(p) { return timedApi_("getSettings", p); }
function api_setSettings(p) { return timedApi_("setSettings", p); }
function api_getAarsRule(p) { return timedApi_("getAarsRule", p); }
function api_setAarsRule(p) { return timedApi_("setAarsRule", p); }
function api_previewAarsRule(p) { return timedApi_("previewAarsRule", p); }
function api_scoreAarsSample(p) { return timedApi_("scoreAarsSample", p); }
function api_rescoreAars(p) { return timedApi_("rescoreAars", p); }
function api_getProblemRule(p) { return timedApi_("getProblemRule", p); }
function api_setProblemRule(p) { return timedApi_("setProblemRule", p); }
function api_previewProblemRule(p) { return timedApi_("previewProblemRule", p); }
function api_recomputeProblems(p) { return timedApi_("recomputeProblems", p); }
function api_getPostureRule(p) { return timedApi_("getPostureRule", p); }
function api_setPostureRule(p) { return timedApi_("setPostureRule", p); }
function api_previewPostureRule(p) { return timedApi_("previewPostureRule", p); }
function api_recomputePostures(p) { return timedApi_("recomputePostures", p); }
function api_resetData(p) { return timedApi_("resetData", p); }
function api_getStorageStats(p) { return timedApi_("getStorageStats", p); }
