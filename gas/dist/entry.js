// Hand-written GAS entry points. The build never touches this file.
// GAS requires doGet / trigger handlers / google.script.run targets to be top-level
// global functions; everything else lives on the bundled `Server` global (server.js).

function doGet(e) { return Server.doGet(e); }

// One-time setup: creates the ledger spreadsheet tabs, Drive folders, and the daily
// scan trigger, and records their IDs in Script Properties. Run from the GAS editor.
function setup() { return Server.setup(); }

// Trigger handlers (names referenced by ScriptApp.newTrigger calls).
function trigger_dailyScan() { Server.jobs.dailyScan(); }
function trigger_continueScan(e) { Server.jobs.continueJob(e); }

// google.script.run API surface — thin delegators so the client can call api_* by name.
function api_bootstrap(p) { return Server.api.bootstrap(p); }
function api_getFindings(p) { return Server.api.getFindings(p); }
function api_getFindingDetail(p) { return Server.api.getFindingDetail(p); }
function api_getMttr(p) { return Server.api.getMttr(p); }
function api_getMttrTrend(p) { return Server.api.getMttrTrend(p); }
function api_getScanHistory(p) { return Server.api.getScanHistory(p); }
function api_getBaseRows(p) { return Server.api.getBaseRows(p); }
function api_runScan(p) { return Server.api.runScan(p); }
function api_getJobStatus(p) { return Server.api.getJobStatus(p); }
function api_deleteScans(p) { return Server.api.deleteScans(p); }
function api_getReport(p) { return Server.api.getReport(p); }
function api_getExportCsv(p) { return Server.api.getExportCsv(p); }
function api_getExportRawUrl(p) { return Server.api.getExportRawUrl(p); }
function api_getSettings(p) { return Server.api.getSettings(p); }
function api_setSeverities(p) { return Server.api.setSeverities(p); }
function api_setRetention(p) { return Server.api.setRetention(p); }
function api_setAutoCompact(p) { return Server.api.setAutoCompact(p); }
function api_getDomains(p) { return Server.api.getDomains(p); }
function api_saveDomains(p) { return Server.api.saveDomains(p); }
function api_previewDomains(p) { return Server.api.previewDomains(p); }
function api_compact(p) { return Server.api.compact(p); }
function api_getStorageStats(p) { return Server.api.getStorageStats(p); }
