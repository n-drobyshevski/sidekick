// Hand-written GAS entry points. The build never touches this file.
// GAS requires doGet / trigger handlers / google.script.run targets to be top-level
// global functions; everything else lives on the bundled `Server` global (server.js).

function doGet(e) { return Server.doGet(e); }
function include(f) { return Server.include(f); }

// One-time setup: creates the ledger spreadsheet tabs, Drive folders, and the daily
// scan trigger, and records their IDs in Script Properties. Run from the GAS editor.
function setup() { return Server.setup(); }

// Wiz connectivity check — run from the GAS editor to validate credentials; it prints
// which auth/query step fails (secret-safe) to the execution log. Never used by a scan.
function wizDiagnostic() { return Server.wizDiagnostic(); }

// Last-resort recovery for a job the web app can't reach: rolls a killed mid-write back from
// its journal, deletes every continuation trigger, and forces whatever survives to FAILED so
// scanning is unblocked (jobs are single-flight across kinds). Reports what it cleared to the
// execution log. Safe to run when nothing is wrong.
function resetStuckJob() { return Server.jobs.resetStuckJob(); }

// Trigger handlers (names referenced by ScriptApp.newTrigger calls).
function trigger_dailyScan() { Server.jobs.dailyScan(); }
function trigger_continueScan(e) { Server.jobs.continueJob(e); }
// Its own handler name, NOT trigger_continueScan: each job clears only its own
// pending one-shot trigger, so sharing a name would let one strand the other.
function trigger_continueBackfill(e) { Server.backfill.continueBackfill(e); }
function trigger_continuePurge(e) { Server.purge.continuePurge(e); }
// Re-warms the read-model cache between scans: CacheService caps TTLs at six hours, so a
// daily-scan tenant would otherwise go cold three or four times between scans.
function trigger_warmReadModels() { Server.api.warmReadModelsScheduled(); }

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
function api_getInsights(p) { return timedApi_("getInsights", p); }
function api_getOldestOpen(p) { return timedApi_("getOldestOpen", p); }
function api_getGrouping(p) { return timedApi_("getGrouping", p); }
function api_getGroupTrend(p) { return timedApi_("getGroupTrend", p); }
function api_getAttribution(p) { return timedApi_("getAttribution", p); }
function api_getMttr(p) { return timedApi_("getMttr", p); }
function api_getMttrTrend(p) { return timedApi_("getMttrTrend", p); }
function api_getMttrPage(p) { return timedApi_("getMttrPage", p); }
function api_getMttrByDomainTrend(p) { return timedApi_("getMttrByDomainTrend", p); }
function api_getExecutivePage(p) { return timedApi_("getExecutivePage", p); }
function api_getProgramPage(p) { return timedApi_("getProgramPage", p); }
function api_getRiskCohort(p) { return timedApi_("getRiskCohort", p); }
function api_getExportCoverageCsv(p) { return timedApi_("getExportCoverageCsv", p); }
function api_startRiskBackfill(p) { return timedApi_("startRiskBackfill", p); }
function api_getRiskBackfillStatus(p) { return timedApi_("getRiskBackfillStatus", p); }
function api_getScanHistory(p) { return timedApi_("getScanHistory", p); }
function api_runScan(p) { return timedApi_("runScan", p); }
function api_getJobStatus(p) { return timedApi_("getJobStatus", p); }
function api_cancelScan(p) { return timedApi_("cancelScan", p); }
function api_deleteScans(p) { return timedApi_("deleteScans", p); }
function api_getReport(p) { return timedApi_("getReport", p); }
function api_getExportCsv(p) { return timedApi_("getExportCsv", p); }
function api_getExportRawUrl(p) { return timedApi_("getExportRawUrl", p); }
function api_exportMigrationBundle(p) { return timedApi_("exportMigrationBundle", p); }
function api_getSettings(p) { return timedApi_("getSettings", p); }
function api_setSeverities(p) { return timedApi_("setSeverities", p); }
function api_setRetention(p) { return timedApi_("setRetention", p); }
function api_setAutoCompact(p) { return timedApi_("setAutoCompact", p); }
function api_setShowNoFix(p) { return timedApi_("setShowNoFix", p); }
function api_setIncludeEol(p) { return timedApi_("setIncludeEol", p); }
function api_setRiskRule(p) { return timedApi_("setRiskRule", p); }
function api_setRetentionSettings(p) { return timedApi_("setRetentionSettings", p); }
function api_getDomains(p) { return timedApi_("getDomains", p); }
function api_saveDomains(p) { return timedApi_("saveDomains", p); }
function api_previewDomains(p) { return timedApi_("previewDomains", p); }
function api_refreshSupportGroups(p) { return timedApi_("refreshSupportGroups", p); }
function api_backfillEpisodeTags(p) { return timedApi_("backfillEpisodeTags", p); }
function api_getRecentErrors(p) { return timedApi_("getRecentErrors", p); }
function api_clearRecentErrors(p) { return timedApi_("clearRecentErrors", p); }
function api_compact(p) { return timedApi_("compact", p); }
function api_importMigration(p) { return timedApi_("importMigration", p); }
function api_importBegin(p) { return timedApi_("importBegin", p); }
function api_importShard(p) { return timedApi_("importShard", p); }
function api_importFinalize(p) { return timedApi_("importFinalize", p); }
function api_importAbort(p) { return timedApi_("importAbort", p); }
function api_importStatus(p) { return timedApi_("importStatus", p); }
function api_resetLedger(p) { return timedApi_("resetLedger", p); }
function api_getStorageStats(p) { return timedApi_("getStorageStats", p); }
function api_previewMaintenance(p) { return timedApi_("previewMaintenance", p); }
function api_startSeverityPurge(p) { return timedApi_("startSeverityPurge", p); }
function api_getPurgeStatus(p) { return timedApi_("getPurgeStatus", p); }
function api_pruneEpisodes(p) { return timedApi_("pruneEpisodes", p); }
function api_trimHistory(p) { return timedApi_("trimHistory", p); }
