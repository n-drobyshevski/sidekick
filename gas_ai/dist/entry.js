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
// Probe every step that writes a graph edge and log what each one came back with: rejected
// (with the tenant's own message), or accepted with a row count and what the normalizer kept.
// Zero-argument, like the three diagnostics above, BECAUSE the editor's Run control invokes the
// selected global with no arguments — a probe that takes a step id cannot be run from there.
// One live Wiz page per step. Nothing is persisted.
function probeEdgeSteps() { return Server.probeEdgeSteps(); }

// Did a change actually improve anything. Run pinPostureBaseline() BEFORE deploying a change,
// then postureDelta() after re-syncing — pinning afterwards measures the new build against
// itself and reports no movement, which looks like a result and is not.
function pinPostureBaseline() { return Server.pinPostureBaseline(); }
function postureDelta() { return Server.postureDelta(); }

// One named step, for a caller that can pass an argument: the Scans drill-down's "Probe this
// step" button (via api_probeSyncStep), or the editor's debugger. NOT runnable from the editor's
// Run dropdown — `stepId` would arrive undefined and the call would refuse. Use probeEdgeSteps()
// above for the whole set, or the Scans button for one step.
function probeSyncStep(stepId) {
  var res = Server.api.probeSyncStep({ stepId: stepId });
  console.log(JSON.stringify(res, null, 2));
  return res;
}

// Trigger handlers (names referenced by ScriptApp.newTrigger calls).
function trigger_dailySync() { Server.jobs.dailySync(); }
function trigger_continueSync(e) { Server.jobs.continueJob(e); }
// Re-warms the derived read-models between syncs. CacheService's ceiling is six hours and
// tenants sync daily, so without this every entry lapses three or four times a day and the
// next visitor pays the cold load. Deliberately NOT an api_* delegator: it is not callable
// from the client, and api.ts exporting it would fail the build's entry.js guard.
function trigger_warmReadModels() { Server.warm.warmReadModelsScheduled(); }

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
function api_getAssetsHead(p) { return timedApi_("getAssetsHead", p); }
function api_getAssetOptions(p) { return timedApi_("getAssetOptions", p); }
function api_getAssetDetail(p) { return timedApi_("getAssetDetail", p); }
function api_expandAsset(p) { return timedApi_("expandAsset", p); }
function api_getConfigFindings(p) { return timedApi_("getConfigFindings", p); }
function api_getConfigFindingDetail(p) { return timedApi_("getConfigFindingDetail", p); }
function api_getCompliance(p) { return timedApi_("getCompliance", p); }
function api_getFiveRsScope(p) { return timedApi_("getFiveRsScope", p); }
function api_setSelectedFrameworks(p) { return timedApi_("setSelectedFrameworks", p); }
function api_getIssues(p) { return timedApi_("getIssues", p); }
function api_getIssueDetail(p) { return timedApi_("getIssueDetail", p); }
function api_getToxicCombos(p) { return timedApi_("getToxicCombos", p); }
function api_getCombosDigest(p) { return timedApi_("getCombosDigest", p); }
function api_getProblems(p) { return timedApi_("getProblems", p); }
function api_getActions(p) { return timedApi_("getActions", p); }
function api_runSync(p) { return timedApi_("runSync", p); }
function api_getJobStatus(p) { return timedApi_("getJobStatus", p); }
function api_cancelSync(p) { return timedApi_("cancelSync", p); }
function api_getSyncHistory(p) { return timedApi_("getSyncHistory", p); }
function api_getScanQueries(p) { return timedApi_("getScanQueries", p); }
function api_setScanVars(p) { return timedApi_("setScanVars", p); }
function api_testScanVars(p) { return timedApi_("testScanVars", p); }
function api_probeSyncStep(p) { return timedApi_("probeSyncStep", p); }
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
function api_previewPrune(p) { return timedApi_("previewPrune", p); }
function api_pruneToProject(p) { return timedApi_("pruneToProject", p); }
function api_getStorageStats(p) { return timedApi_("getStorageStats", p); }
