"use strict";
var Server = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/server/index.ts
  var server_exports = {};
  __export(server_exports, {
    api: () => api_exports,
    doGet: () => doGet,
    include: () => include,
    jobs: () => scanJobs_exports,
    setup: () => setup,
    wizDiagnostic: () => wizDiagnostic
  });

  // src/server/main.ts
  function doGet(_e) {
    const template = HtmlService.createTemplateFromFile("index");
    return template.evaluate().setTitle("Wiz Sidekick OS").addMetaTag("viewport", "width=device-width, initial-scale=1").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }
  function include(filename) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }

  // src/server/props.ts
  var PROP_KEYS = {
    wizApiToken: "WIZ_API_TOKEN",
    wizClientId: "WIZ_CLIENT_ID",
    wizClientSecret: "WIZ_CLIENT_SECRET",
    wizAuthUrl: "WIZ_AUTH_URL",
    wizApiUrl: "WIZ_API_URL",
    wizProjectIdV2: "WIZ_PROJECT_ID_V2",
    wizSupportGroupTagKey: "WIZ_SUPPORT_GROUP_TAG_KEY",
    ledgerSpreadsheetId: "LEDGER_SPREADSHEET_ID",
    archiveFolderId: "ARCHIVE_FOLDER_ID"
  };
  var DEFAULT_WIZ_AUTH_URL = "https://auth.app.wiz.io/oauth/token";
  var DEFAULT_SUPPORT_GROUP_TAG_KEY = "Wiz/provisioning";
  function getProp(key) {
    return PropertiesService.getScriptProperties().getProperty(key);
  }
  function requireProp(key) {
    const v = getProp(key);
    if (!v) {
      throw new Error(`Missing Script Property ${key} \u2014 run setup() or set it in Project Settings > Script Properties.`);
    }
    return v;
  }
  function setProp(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, value);
  }
  function deleteProp(key) {
    PropertiesService.getScriptProperties().deleteProperty(key);
  }
  function resolveWizAuthMode(token, clientId, clientSecret) {
    if (token && token.trim()) return "token";
    if (clientId && clientSecret) return "oauth";
    return null;
  }
  function hasWizCredentials() {
    return Boolean(getProp(PROP_KEYS.wizApiUrl)) && resolveWizAuthMode(
      getProp(PROP_KEYS.wizApiToken),
      getProp(PROP_KEYS.wizClientId),
      getProp(PROP_KEYS.wizClientSecret)
    ) !== null;
  }

  // src/server/archiveStore.ts
  var SUBFOLDERS = ["scans", "obs", "checkpoints", "snapshots", "backups", "imports"];
  function rootFolder() {
    return DriveApp.getFolderById(requireProp(PROP_KEYS.archiveFolderId));
  }
  function childFolder(parent, name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  }
  function subfolder(name) {
    return childFolder(rootFolder(), name);
  }
  function ensureFolders(rootId) {
    const root = rootId ? DriveApp.getFolderById(rootId) : rootFolder();
    for (const name of SUBFOLDERS) childFolder(root, name);
    return root.getId();
  }
  function safeName(id) {
    return id.replace(/[^0-9A-Za-z._-]/g, "") || "scan";
  }
  function writeGzJson(folder, name, payload) {
    const json = JSON.stringify(payload);
    const blob = Utilities.gzip(Utilities.newBlob(json, "application/json"), name);
    const existing = folder.getFilesByName(name);
    while (existing.hasNext()) existing.next().setTrashed(true);
    return folder.createFile(blob);
  }
  function readGzJsonFile(fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      return parseGzBlob(file.getBlob());
    } catch (e) {
      console.warn(`Unreadable Drive file ${fileId}: ${e}`);
      return null;
    }
  }
  function parseGzBlob(blob) {
    try {
      const bytes = blob.getBytes();
      const isGzip = bytes.length > 2 && (bytes[0] & 255) === 31 && (bytes[1] & 255) === 139;
      const text = isGzip ? Utilities.ungzip(blob).getDataAsString("UTF-8") : blob.getDataAsString("UTF-8");
      return JSON.parse(text);
    } catch (e) {
      console.warn(`Failed to parse archive blob: ${e}`);
      return null;
    }
  }
  function scanFolder(scanId) {
    return childFolder(subfolder("scans"), safeName(scanId));
  }
  function writeScanPage(scanId, pageNumber, payload) {
    const name = `page-${String(pageNumber).padStart(4, "0")}.json.gz`;
    return writeGzJson(scanFolder(scanId), name, payload).getId();
  }
  function readScanPage(scanId, pageNumber) {
    const name = `page-${String(pageNumber).padStart(4, "0")}.json.gz`;
    const files = scanFolder(scanId).getFilesByName(name);
    return files.hasNext() ? parseGzBlob(files.next().getBlob()) : null;
  }
  function writeSlimRecords(scanId, records) {
    return writeGzJson(scanFolder(scanId), "slim.json.gz", records).getId();
  }
  function readSlimRecords(scanId) {
    const files = scanFolder(scanId).getFilesByName("slim.json.gz");
    if (!files.hasNext()) return null;
    const parsed = parseGzBlob(files.next().getBlob());
    return Array.isArray(parsed) ? parsed : null;
  }
  var FRAME_NAME = "frame-v1.json.gz";
  function writeFrame(scanId, records) {
    return writeGzJson(scanFolder(scanId), FRAME_NAME, records).getId();
  }
  function readFrame(scanId) {
    const files = scanFolder(scanId).getFilesByName(FRAME_NAME);
    if (!files.hasNext()) return null;
    const parsed = parseGzBlob(files.next().getBlob());
    return Array.isArray(parsed) ? parsed : null;
  }
  var PAGE_RUNS_NAME = "pageruns.json.gz";
  function writePageRuns(scanId, runs) {
    writeGzJson(scanFolder(scanId), PAGE_RUNS_NAME, runs);
  }
  function readPageRuns(scanId) {
    const files = scanFolder(scanId).getFilesByName(PAGE_RUNS_NAME);
    if (!files.hasNext()) return null;
    const parsed = parseGzBlob(files.next().getBlob());
    return Array.isArray(parsed) ? parsed : null;
  }
  function readScanPayload(scanRef) {
    if (!scanRef) return null;
    let folder;
    try {
      folder = DriveApp.getFolderById(scanRef);
    } catch {
      return null;
    }
    const pages = [];
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      if (!/^page-\d+\.json(\.gz)?$/.test(name)) continue;
      const payload = parseGzBlob(f.getBlob());
      if (payload === null) return null;
      pages.push({ name, payload });
    }
    if (!pages.length) return null;
    pages.sort((a, b) => a.name < b.name ? -1 : 1);
    return pages.map((p) => p.payload);
  }
  function scanArchiveBytes(scanRef, obsRef) {
    let total = 0;
    if (scanRef) {
      try {
        const files = DriveApp.getFolderById(scanRef).getFiles();
        while (files.hasNext()) total += files.next().getSize();
      } catch {
      }
    }
    if (obsRef) {
      try {
        total += DriveApp.getFileById(obsRef).getSize();
      } catch {
      }
    }
    return total;
  }
  function trashScanArchive(scanRef) {
    if (!scanRef) return;
    try {
      DriveApp.getFolderById(scanRef).setTrashed(true);
    } catch (e) {
      console.warn(`Couldn't trash scan archive ${scanRef}: ${e}`);
    }
  }
  function writeObservations(scanId, observations) {
    return writeGzJson(subfolder("obs"), `obs-${safeName(scanId)}.json.gz`, observations).getId();
  }
  function readObservations(obsRef) {
    if (!obsRef) return [];
    const parsed = readGzJsonFile(obsRef);
    return Array.isArray(parsed) ? parsed : [];
  }
  function trashFile(fileId) {
    if (!fileId) return;
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (e) {
      console.warn(`Couldn't trash file ${fileId}: ${e}`);
    }
  }
  function writeCheckpoint(compactionId, checkpoint) {
    return writeGzJson(
      subfolder("checkpoints"),
      `checkpoint-${safeName(compactionId)}.json.gz`,
      checkpoint
    ).getId();
  }
  function readCheckpoint(ref) {
    var _a, _b, _c;
    if (!ref) return null;
    const parsed = readGzJsonFile(ref);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed;
    if (Array.isArray(obj["parts"])) {
      const ledger = [];
      for (const partId of obj["parts"]) {
        const part = readGzJsonFile(partId);
        if (Array.isArray(part)) for (const row of part) ledger.push(row);
      }
      return {
        version: Number((_a = obj["version"]) != null ? _a : 1),
        floor_scan_id: (_b = obj["floor_scan_id"]) != null ? _b : null,
        floor_ts: (_c = obj["floor_ts"]) != null ? _c : null,
        ledger
      };
    }
    return parsed;
  }
  var SNAPSHOT_NAME = "ledger-snapshot.json.gz";
  function writeLedgerSnapshot(state) {
    const snap = { version: 1, ledger: state.ledger, episodes: state.episodes };
    writeGzJson(subfolder("snapshots"), SNAPSHOT_NAME, snap);
  }
  function readLedgerSnapshot() {
    const files = subfolder("snapshots").getFilesByName(SNAPSHOT_NAME);
    if (!files.hasNext()) return null;
    const parsed = parseGzBlob(files.next().getBlob());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const snap = parsed;
    return snap.ledger && snap.episodes ? snap : null;
  }
  function writeJournal(jobId, state) {
    return writeGzJson(subfolder("backups"), `backup-${safeName(jobId)}.json.gz`, state).getId();
  }
  function readJournal(ref) {
    if (!ref) return null;
    const parsed = readGzJsonFile(ref);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const st = parsed;
    return st.scans && st.ledger && st.episodes ? st : null;
  }
  function trashLedgerSnapshot() {
    const files = subfolder("snapshots").getFilesByName(SNAPSHOT_NAME);
    while (files.hasNext()) files.next().setTrashed(true);
  }
  function importFolder(sessionId) {
    return childFolder(subfolder("imports"), safeName(sessionId));
  }
  function writeImportManifest(sessionId, manifest) {
    return writeGzJson(importFolder(sessionId), "manifest.json.gz", manifest).getId();
  }
  function readImportManifest(sessionId) {
    const files = importFolder(sessionId).getFilesByName("manifest.json.gz");
    return files.hasNext() ? parseGzBlob(files.next().getBlob()) : null;
  }
  function stageShard(sessionId, index, payload) {
    const name = `shard-${String(index + 1).padStart(4, "0")}.json.gz`;
    return writeGzJson(importFolder(sessionId), name, payload).getId();
  }
  function writeCheckpointPart(compactionId, index, rows) {
    const name = `checkpoint-${safeName(compactionId)}-part-${String(index + 1).padStart(4, "0")}.json.gz`;
    return writeGzJson(subfolder("checkpoints"), name, rows).getId();
  }
  function writeCheckpointManifest(compactionId, manifest) {
    return writeGzJson(
      subfolder("checkpoints"),
      `checkpoint-${safeName(compactionId)}.json.gz`,
      manifest
    ).getId();
  }
  function trashImportSession(sessionId) {
    try {
      importFolder(sessionId).setTrashed(true);
    } catch (e) {
      console.warn(`trashImportSession(${sessionId}): ${e}`);
    }
  }

  // src/server/sheetsDb.ts
  var TABS = {
    scans: "scans",
    vulnLedger: "vuln_ledger",
    episodes: "resolved_episodes",
    compactions: "compactions",
    settings: "settings",
    mttrHistory: "mttr_history",
    schemaMeta: "schema_meta",
    jobs: "jobs"
  };
  var TAB_HEADERS = {
    [TABS.scans]: [
      "scan_id",
      "ts",
      "mode",
      "shape",
      "total",
      "new_count",
      "resolved_count",
      "reopened_count",
      "raw_ref",
      "obs_ref",
      "severities",
      "sealed"
    ],
    [TABS.vulnLedger]: [
      "vuln_key",
      "cve",
      "severity",
      "asset_id",
      "asset_name",
      "asset_type",
      "cloud",
      "first_seen",
      "last_seen",
      "status",
      "resolved_at",
      "resolution_src",
      "reopened_count",
      "first_scan_id",
      "last_scan_id",
      "subscription_name",
      "subscription_ext_id",
      "tags_json",
      "fix_date",
      "fix_observed_at"
    ],
    [TABS.episodes]: [
      "vuln_key",
      "cve",
      "severity",
      "first_seen",
      "resolved_at",
      "resolution_src",
      "reopened_count",
      "compaction_id",
      "superseded_by_scan",
      "fix_date",
      "fix_observed_at"
    ],
    [TABS.compactions]: [
      "compaction_id",
      "ts",
      "floor_scan_id",
      "floor_ts",
      "scans_sealed",
      "episodes_created",
      "observations_pruned",
      "archive_bytes_freed",
      "db_bytes_freed",
      "checkpoint_ref"
    ],
    [TABS.settings]: ["key", "value_json"],
    [TABS.mttrHistory]: [
      "date",
      "median_days",
      "resolved",
      "open",
      "total",
      "sla_pct",
      "oldest_open_days",
      "open_past_sla"
    ],
    [TABS.schemaMeta]: ["version"],
    [TABS.jobs]: [
      "job_id",
      "kind",
      "phase",
      "scan_id",
      "cursor",
      "page",
      "findings_so_far",
      "page_size",
      "total_count",
      "params_json",
      "journal_ref",
      "error",
      "started_at",
      "updated_at"
    ]
  };
  var spreadsheetCache = null;
  function ledgerSpreadsheet() {
    if (spreadsheetCache === null) {
      spreadsheetCache = SpreadsheetApp.openById(requireProp(PROP_KEYS.ledgerSpreadsheetId));
    }
    return spreadsheetCache;
  }
  function sheet(tab) {
    const sh = ledgerSpreadsheet().getSheetByName(tab);
    if (!sh) throw new Error(`Missing tab ${tab} \u2014 run setup().`);
    return sh;
  }
  function ensureTabs(ss) {
    ss.setSpreadsheetTimeZone("Etc/UTC");
    for (const [tab, headers] of Object.entries(TAB_HEADERS)) {
      let sh = ss.getSheetByName(tab);
      if (!sh) {
        sh = ss.insertSheet(tab);
        sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat("@");
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        sh.setFrozenRows(1);
      } else {
        const width = Math.max(sh.getLastColumn(), 1);
        const existing = sh.getRange(1, 1, 1, width).getValues()[0].map(String).filter((h) => h !== "");
        const missing = headers.filter((h) => !existing.includes(h));
        if (missing.length) {
          sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
        }
      }
    }
    const dflt = ss.getSheetByName("Sheet1");
    if (dflt && ss.getSheets().length > 1) ss.deleteSheet(dflt);
  }
  function fromCell(v) {
    if (v === "" || v === null || v === void 0) return null;
    if (v instanceof Date) {
      return new Date(Math.floor(v.getTime() / 1e3) * 1e3).toISOString().replace(".000Z", "Z");
    }
    return v;
  }
  function toCell(v) {
    if (v === null || v === void 0) return "";
    return v;
  }
  function readAll(tab) {
    const sh = sheet(tab);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];
    const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(String);
    const out = [];
    for (let i = 1; i < values.length; i++) {
      const row = {};
      let empty = true;
      for (let j = 0; j < headers.length; j++) {
        if (!headers[j]) continue;
        const v = fromCell(values[i][j]);
        row[headers[j]] = v;
        if (v !== null) empty = false;
      }
      if (!empty) out.push(row);
    }
    return out;
  }
  function overwrite(tab, rows) {
    const sh = sheet(tab);
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(Boolean);
    const lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    if (!rows.length) return;
    const grid = rows.map((r) => headers.map((h) => toCell(r[h])));
    const range = sh.getRange(2, 1, grid.length, headers.length);
    range.setNumberFormat("@");
    range.setValues(grid);
  }
  function appendRows(tab, rows) {
    if (!rows.length) return;
    const sh = sheet(tab);
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(Boolean);
    const grid = rows.map((r) => headers.map((h) => toCell(r[h])));
    const range = sh.getRange(sh.getLastRow() + 1, 1, grid.length, headers.length);
    range.setNumberFormat("@");
    range.setValues(grid);
  }
  function dataRowCount(tab) {
    return Math.max(0, sheet(tab).getLastRow() - 1);
  }
  function truncateAfter(tab, keepDataRows) {
    const sh = sheet(tab);
    const lastRow = sh.getLastRow();
    const firstToClear = keepDataRows + 2;
    if (lastRow >= firstToClear) {
      const lastCol = Math.max(sh.getLastColumn(), 1);
      sh.getRange(firstToClear, 1, lastRow - firstToClear + 1, lastCol).clearContent();
    }
  }
  function updateWhere(tab, keyColumn, keyValue, patch) {
    const sh = sheet(tab);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2) return false;
    const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0].map(String);
    const keyIdx = headers.indexOf(keyColumn);
    if (keyIdx < 0) return false;
    for (let i = 1; i < values.length; i++) {
      if (fromCell(values[i][keyIdx]) === keyValue) {
        const rowVals = values[i].slice();
        for (const [k, v] of Object.entries(patch)) {
          const idx = headers.indexOf(k);
          if (idx >= 0) rowVals[idx] = toCell(v);
        }
        sh.getRange(i + 1, 1, 1, lastCol).setValues([rowVals]);
        return true;
      }
    }
    return false;
  }
  function cellCount() {
    return ledgerSpreadsheet().getSheets().reduce((acc, sh) => acc + sh.getMaxRows() * sh.getMaxColumns(), 0);
  }

  // src/server/setup.ts
  var SPREADSHEET_NAME = "Wiz Sidekick OS Ledger";
  var FOLDER_NAME = "wiz-sidekick";
  var DAILY_TRIGGER_HANDLER = "trigger_dailyScan";
  var DAILY_TRIGGER_HOUR = 5;
  function setup() {
    const notes = [];
    let ssId = getProp(PROP_KEYS.ledgerSpreadsheetId);
    let ss;
    if (ssId) {
      ss = SpreadsheetApp.openById(ssId);
      notes.push(`spreadsheet: existing ${ssId}`);
    } else {
      ss = SpreadsheetApp.create(SPREADSHEET_NAME);
      ssId = ss.getId();
      setProp(PROP_KEYS.ledgerSpreadsheetId, ssId);
      notes.push(`spreadsheet: created ${ssId}`);
    }
    ensureTabs(ss);
    let folderId = getProp(PROP_KEYS.archiveFolderId);
    if (!folderId) {
      folderId = DriveApp.createFolder(FOLDER_NAME).getId();
      setProp(PROP_KEYS.archiveFolderId, folderId);
      notes.push(`archive folder: created ${folderId}`);
    } else {
      notes.push(`archive folder: existing ${folderId}`);
    }
    ensureFolders(folderId);
    if (!getProp(PROP_KEYS.wizAuthUrl)) setProp(PROP_KEYS.wizAuthUrl, DEFAULT_WIZ_AUTH_URL);
    const existing = ScriptApp.getProjectTriggers().filter(
      (t) => t.getHandlerFunction() === DAILY_TRIGGER_HANDLER
    );
    if (!existing.length) {
      ScriptApp.newTrigger(DAILY_TRIGGER_HANDLER).timeBased().everyDays(1).atHour(DAILY_TRIGGER_HOUR).create();
      notes.push(`daily trigger: installed (hour ${DAILY_TRIGGER_HOUR} UTC)`);
    } else {
      notes.push("daily trigger: already installed");
    }
    const missing = [
      PROP_KEYS.wizClientId,
      PROP_KEYS.wizClientSecret,
      PROP_KEYS.wizApiUrl,
      PROP_KEYS.wizProjectIdV2
    ].filter((k) => !getProp(k));
    if (missing.length) {
      notes.push(`NOTE: set Script Properties for live scans: ${missing.join(", ")} (without them the app runs dry-run only)`);
    }
    return notes.join("\n");
  }

  // src/domain/config.ts
  var SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];
  var SEVERITY_COLORS = {
    CRITICAL: "#dc2626",
    HIGH: "#ea580c",
    MEDIUM: "#d97706",
    LOW: "#2563eb",
    INFO: "#64748b",
    UNKNOWN: "#475569"
  };
  var SEVERITY_GLYPHS = {
    CRITICAL: "\u{1F534}",
    HIGH: "\u{1F7E0}",
    MEDIUM: "\u{1F7E1}",
    LOW: "\u{1F535}",
    INFO: "\u26AA",
    UNKNOWN: "\u26AB"
  };
  var DEFAULT_FAST_LANE_DAYS = 1;
  var FAST_LANE_MAX_DAYS = 90;
  var SLA_TARGETS = {
    CRITICAL: 7,
    HIGH: 14,
    MEDIUM: 30,
    LOW: 90,
    INFO: 180
  };
  var SELECTABLE_SEVERITIES = SEVERITY_ORDER.filter((s) => s !== "UNKNOWN");
  var DEFAULT_FETCH_SEVERITIES = ["CRITICAL", "HIGH"];
  var DEFAULT_DISPLAY_SEVERITIES = ["CRITICAL", "HIGH"];
  var API_SEVERITY_VALUES = {
    CRITICAL: "CRITICAL",
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    LOW: "LOW",
    INFO: "INFORMATIONAL"
  };
  var RESOLVED_STATUSES = /* @__PURE__ */ new Set(["RESOLVED", "REMEDIATED", "FIXED", "CLOSED"]);
  var DISAPPEARANCE_RESOLUTION = "scan_ts";
  var REMEDIATION_ROLLOUT_ISO = "2026-07-01T00:00:00Z";
  var DEFAULT_RETENTION_DAYS = 180;
  var RETENTION_MIN_DAYS = 30;
  var MIN_UNSEALED_FLAT_SCANS = 2;

  // src/domain/severity.ts
  function normalizeSeverity(sev2) {
    if (typeof sev2 !== "string") return "UNKNOWN";
    const s = sev2.toUpperCase().trim();
    if (s === "INFORMATIONAL" || s === "INFO") return "INFO";
    return SEVERITY_ORDER.includes(s) ? s : "UNKNOWN";
  }
  function countBySeverity(records) {
    var _a;
    if (!records.length || !records.some((r) => "severity" in r)) return {};
    const counts = {};
    for (const rec of records) {
      const sev2 = normalizeSeverity(rec["severity"]);
      counts[sev2] = ((_a = counts[sev2]) != null ? _a : 0) + 1;
    }
    return counts;
  }

  // src/domain/settingsLogic.ts
  function canonicalSeverities(values, defaults) {
    if (!Array.isArray(values)) return [...defaults];
    const chosen = new Set(
      values.filter((v) => typeof v === "string").map(normalizeSeverity).filter((s) => SELECTABLE_SEVERITIES.includes(s))
    );
    if (!chosen.size) return [...defaults];
    return SEVERITY_ORDER.filter((s) => chosen.has(s));
  }
  function getFetchSeverities(settings) {
    return canonicalSeverities(settings["fetch_severities"], DEFAULT_FETCH_SEVERITIES);
  }
  function getDisplaySeverities(settings) {
    const fetch = getFetchSeverities(settings);
    const disp = canonicalSeverities(settings["display_severities"], DEFAULT_DISPLAY_SEVERITIES);
    const clamped = disp.filter((s) => fetch.includes(s));
    return clamped.length ? clamped : fetch;
  }
  function withFetchSeverities(settings, sevs) {
    const d = { ...settings };
    const fetch = canonicalSeverities(sevs, DEFAULT_FETCH_SEVERITIES);
    d["fetch_severities"] = fetch;
    const disp = canonicalSeverities(d["display_severities"], fetch);
    const clamped = disp.filter((s) => fetch.includes(s));
    d["display_severities"] = clamped.length ? clamped : [...fetch];
    return d;
  }
  function withDisplaySeverities(settings, sevs) {
    const d = { ...settings };
    const fetch = canonicalSeverities(d["fetch_severities"], DEFAULT_FETCH_SEVERITIES);
    const disp = canonicalSeverities(sevs, DEFAULT_DISPLAY_SEVERITIES);
    const clamped = disp.filter((s) => fetch.includes(s));
    d["display_severities"] = clamped.length ? clamped : [...fetch];
    return d;
  }
  function getRetentionDays(settings) {
    const raw = "retention_days" in settings ? settings["retention_days"] : DEFAULT_RETENTION_DAYS;
    if (raw === null) return null;
    const n = typeof raw === "number" ? Math.trunc(raw) : parseInt(String(raw), 10);
    if (Number.isNaN(n)) return DEFAULT_RETENTION_DAYS;
    return Math.max(n, RETENTION_MIN_DAYS);
  }
  function withRetentionDays(settings, days) {
    const d = { ...settings };
    d["retention_days"] = days === null ? null : Math.max(Math.trunc(days), RETENTION_MIN_DAYS);
    return d;
  }
  function getFastLaneDays(settings) {
    const raw = "fast_lane_days" in settings ? settings["fast_lane_days"] : DEFAULT_FAST_LANE_DAYS;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_FAST_LANE_DAYS;
    return Math.min(n, FAST_LANE_MAX_DAYS);
  }
  function withFastLaneDays(settings, days) {
    return { ...settings, fast_lane_days: getFastLaneDays({ fast_lane_days: days }) };
  }
  function getAutoCompact(settings) {
    const val = "auto_compact" in settings ? settings["auto_compact"] : true;
    return typeof val === "boolean" ? val : true;
  }
  function withAutoCompact(settings, enabled) {
    return { ...settings, auto_compact: Boolean(enabled) };
  }
  function cleanDomainItems(items) {
    if (!Array.isArray(items)) return [];
    return items.filter(
      (item) => item !== null && typeof item === "object" && !Array.isArray(item) && typeof item["name"] === "string" && item["name"].trim() !== ""
    );
  }
  function getDomains(settings) {
    var _a;
    const raw = settings["domains"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { version: 0, items: [] };
    const r = raw;
    let version = 0;
    const v = Number((_a = r["version"]) != null ? _a : 0);
    if (Number.isFinite(v)) version = Math.max(Math.trunc(v), 0);
    return { version, items: cleanDomainItems(r["items"]) };
  }
  function withDomains(settings, items) {
    const current = getDomains(settings);
    return {
      ...settings,
      domains: { version: current.version + 1, items: cleanDomainItems(items) }
    };
  }
  function cleanStringMap(map) {
    const out = {};
    if (!map || typeof map !== "object" || Array.isArray(map)) return out;
    for (const [k, v] of Object.entries(map)) {
      if (typeof k === "string" && k !== "" && typeof v === "string" && v !== "") {
        out[k] = v;
      }
    }
    return out;
  }
  function getSupportGroupMap(settings) {
    var _a;
    const raw = settings["support_group_map"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { version: 0, map: {} };
    const r = raw;
    let version = 0;
    const v = Number((_a = r["version"]) != null ? _a : 0);
    if (Number.isFinite(v)) version = Math.max(Math.trunc(v), 0);
    return { version, map: cleanStringMap(r["map"]) };
  }
  function withSupportGroupMap(settings, map) {
    const current = getSupportGroupMap(settings);
    return {
      ...settings,
      support_group_map: { version: current.version + 1, map: cleanStringMap(map) }
    };
  }
  function apiSeverityFilter(severities) {
    const sevs = canonicalSeverities(severities, DEFAULT_FETCH_SEVERITIES);
    if (new Set(sevs).size === SELECTABLE_SEVERITIES.length) return null;
    return sevs.map((s) => API_SEVERITY_VALUES[s]);
  }

  // src/server/wizQuery.ts
  var QUERY = "\n    query VulnerabilityFindingsTable($filterBy: VulnerabilityFindingFilters, $first: Int, $after: String, $orderBy: VulnerabilityFindingOrder = {direction: DESC, field: CREATED_AT}, $includeRelatedIssueAnalytics: Boolean = false, $includeRelatedSourceMappedIssueAnalytics: Boolean = false, $includeTotalCount: Boolean = false, $includePostureIssues: Boolean = false, $fetchPrivilegedActionRequests: Boolean = false) {\n      vulnerabilityFindings(\n        filterBy: $filterBy\n        first: $first\n        after: $after\n        orderBy: $orderBy\n      ) {\n        nodes {\n          ...VulnerabilityFindingFragment\n          ...DuplicateFindingBadge\n          transitivity\n          rootComponent {\n            name\n          }\n          isHighProfileThreat\n          vendorSeverity\n          nvdSeverity\n          weightedSeverity\n          hasExploit\n          usedInCodeResult\n          hasCisaKevExploit\n          cisaKevReleaseDate\n          cisaKevDueDate\n          score\n          epssSeverity\n          epssPercentile\n          epssProbability\n          categories\n          hasInitialAccessPotential\n          isClientSide\n          affectedBySettings\n          codeLibraryLanguage\n          exploitabilityValidationStatus\n          cvssv2 {\n            attackVector\n            attackComplexity\n            confidentialityImpact\n            integrityImpact\n            privilegesRequired\n            userInteractionRequired\n            vectorString\n            scope\n          }\n          cvssv3 {\n            attackVector\n            attackComplexity\n            confidentialityImpact\n            integrityImpact\n            privilegesRequired\n            userInteractionRequired\n            vectorString\n            scope\n          }\n          effectiveAvailabilityImpact\n          cnaScore\n          vendorScore\n          relatedIssueAnalytics @include(if: $includeRelatedIssueAnalytics) {\n            ...VulnerabilityFindingRelatedIssueAnalyticsFragment\n          }\n          relatedSourceMappedIssueAnalytics @include(if: $includeRelatedSourceMappedIssueAnalytics) {\n            ...VulnerabilityFindingRelatedIssueAnalyticsFragment\n          }\n          postureIssues @include(if: $includePostureIssues) {\n            ...PostureIssuePopoverListRecord\n          }\n          privilegedActionRequests @include(if: $fetchPrivilegedActionRequests) {\n            ...PendingUpdateVulnerabilityFindingStatusRequest\n          }\n        }\n        pageInfo {\n          hasNextPage\n          endCursor\n        }\n        totalCount @include(if: $includeTotalCount)\n      }\n    }\n   \n        fragment VulnerabilityFindingFragment on VulnerabilityFinding {\n      id\n      name\n      detailedName\n      description\n      severity\n      status\n      fixedVersion\n      detectionMethod\n      firstDetectedAt\n      firstDetectedAtSource\n      lastDetectedAt\n      resolvedAt\n      validatedInRuntime\n      runtimeValidationResult\n      reachability\n      hasTriggerableRemediation\n      remediationPullRequestAvailable\n      dataSourceName\n      fixDate\n      fixDateBefore\n      publishedDate\n      version\n      versionResolutionPrimarySource {\n        type\n        version\n      }\n      isOperatingSystemEndOfLife\n      recommendedVersion\n      locationPath\n      artifactType {\n        ...SBOMArtifactTypeFragment\n      }\n      projects {\n        id\n        name\n        slug\n        isFolder\n      }\n      ignoreRules {\n        id\n      }\n      note {\n        id\n        text\n      }\n      layerMetadata {\n        id\n        details\n        isBaseLayer\n        layerHash\n      }\n      vulnerableAsset {\n        ... on VulnerableAssetBase {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          nativeType\n          externalId\n          providerUniqueId\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetVirtualMachine {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          operatingSystem\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n          imageName\n          imageId\n          imageNativeType\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          computeInstanceGroup {\n            id\n            externalId\n            name\n            replicaCount\n            tags\n          }\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetServerless {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetContainerImage {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          repository {\n            vertexId\n            name\n          }\n          registry {\n            vertexId\n            name\n          }\n          scanSource\n          executionControllers {\n            ...VulnerableAssetExecutionControllerDetails\n          }\n          graphEntity {\n            ...VulnerabilityContainerImageGraphEntityExecutionContext\n          }\n          nativeType\n          tagReferences\n          imageTags\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetContainer {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          executionControllers {\n            ...VulnerableAssetExecutionControllerDetails\n          }\n          nativeType\n          isUsedOnPrem\n        }\n        ... on VulnerableAssetRepositoryBranch {\n          id\n          type\n          name\n          cloudPlatform\n          repositoryId\n          repositoryName\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetIde {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetEndpoint {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetPaaSResource {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetVirtualMachineImage {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n          hasLimitedInternetExposure\n          hasWideInternetExposure\n          isAccessibleFromVPN\n          isAccessibleFromOtherVnets\n          isAccessibleFromOtherSubscriptions\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetNetworkAddress {\n          subscriptionId\n          subscriptionName\n          subscriptionExternalId\n          tags\n          address\n          addressType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetCommon {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n        }\n        ... on VulnerableAssetDevice {\n          id\n          type\n          name\n          cloudPlatform\n          subscriptionName\n          subscriptionExternalId\n          subscriptionId\n          tags\n          nativeType\n          isUsedOnPrem\n          resourceGroupExternalId\n          operatingSystem\n          operatingSystemDistribution {\n            ...VulnerabilityFindingOperatingSystemDistribution\n          }\n        }\n      }\n      sourceMappedCodeFindings {\n        id\n        remediationPullRequestAvailable\n      }\n    }\n   \n\n\n        fragment SBOMArtifactTypeFragment on SBOMArtifactType {\n      group\n      codeLibraryLanguage\n      osPackageManager\n      hostedTechnology {\n        id\n        name\n        icon\n      }\n      plugin\n      custom\n      ciComponent\n    }\n   \n\n\n        fragment VulnerabilityFindingOperatingSystemDistribution on Technology {\n      id\n      name\n      icon\n    }\n   \n\n\n        fragment VulnerableAssetExecutionControllerDetails on VulnerableAssetExecutionController {\n      id\n      entityType\n      externalId\n      providerUniqueId\n      name\n      subscriptionExternalId\n      subscriptionId\n      subscriptionName\n      ancestors {\n        id\n        name\n        entityType\n        externalId\n        providerUniqueId\n      }\n    }\n   \n\n\n        fragment VulnerabilityContainerImageGraphEntityExecutionContext on GraphEntity {\n      id\n      providerUniqueId\n      type\n      containerImageExecutionContextAnalyticsV3 {\n        totalResourceCount\n        nativeType {\n          nativeType\n          count\n        }\n      }\n    }\n   \n\n\n        fragment DuplicateFindingBadge on VulnerabilityFinding {\n      id\n      origin\n      duplicateOf {\n        id\n        name\n        origin\n        vulnerableAsset {\n          ... on VulnerableAssetBase {\n            id\n            name\n          }\n        }\n      }\n    }\n   \n\n\n        fragment VulnerabilityFindingRelatedIssueAnalyticsFragment on VulnerabilityFindingRelatedIssueAnalytics {\n      issueCount\n      informationalSeverityCount\n      lowSeverityCount\n      mediumSeverityCount\n      highSeverityCount\n      criticalSeverityCount\n    }\n   \n\n\n        fragment PostureIssuePopoverListRecord on PostureIssue {\n      id\n      name\n      type\n      entity {\n        providerUniqueId\n        id\n        type\n      }\n    }\n   \n\n\n        fragment PendingUpdateVulnerabilityFindingStatusRequest on PrivilegedActionRequest {\n      ...PendingStatusRequestBanner\n      ...PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams\n    }\n   \n\n\n        fragment PendingStatusRequestBanner on PrivilegedActionRequest {\n      id\n      type\n      status\n      createdAt\n      createdBy {\n        id\n        name\n        email\n      }\n      params {\n        ... on PrivilegedActionRequestUpdateIssueStatusParams {\n          issueStatus: status\n        }\n        ... on PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams {\n          findingStatus: status\n        }\n        ... on PrivilegedActionRequestCreateIgnoreRuleParams {\n          ignoreRuleName: name\n        }\n      }\n    }\n   \n\n\n        fragment PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams on PrivilegedActionRequest {\n      id\n      params {\n        ... on PrivilegedActionRequestUpdateVulnerabilityFindingStatusParams {\n          status\n        }\n      }\n      subject {\n        ... on VulnerabilityFinding {\n          id\n          status\n        }\n      }\n    }\n";
  var BASE_VARIABLES = {
    "orderBy": {
      "field": "RELATED_ISSUE_SEVERITY",
      "direction": "DESC"
    },
    "includeRelatedIssueAnalytics": false,
    "includeRelatedSourceMappedIssueAnalytics": false,
    "includeTotalCount": false,
    "includePostureIssues": false,
    "fetchPrivilegedActionRequests": false,
    "first": 500,
    "filterBy": {
      "projectIdV2": {
        "equals": [
          "1dfea0cf-834f-5522-b797-bee5aaf09251"
        ]
      },
      "assetType": [
        "VIRTUAL_MACHINE"
      ],
      "detectionMethod": [
        "OS"
      ],
      "status": [
        "OPEN",
        "RESOLVED"
      ],
      "detailedNameV2": {
        "notEquals": [
          "openssl",
          "python",
          "vim"
        ]
      },
      "assetIsRepresentativeResource": false
    }
  };
  var PAGE_SIZE = 500;
  var PAGE_SIZE_FALLBACK = 250;
  var MAX_PAGES = 1e3;

  // src/server/wizClient.ts
  var WizQueryError = class extends Error {
  };
  var WizDeltaFilterError = class extends WizQueryError {
  };
  var TOKEN_CACHE_KEY = "wiz_token";
  function getToken(forceRefresh = false) {
    var _a, _b;
    const staticToken = getProp(PROP_KEYS.wizApiToken);
    if (staticToken && staticToken.trim()) return staticToken.trim();
    const cache = CacheService.getScriptCache();
    if (!forceRefresh) {
      const cached2 = cache.get(TOKEN_CACHE_KEY);
      if (cached2) return cached2;
    }
    const authUrl = (_a = getProp(PROP_KEYS.wizAuthUrl)) != null ? _a : DEFAULT_WIZ_AUTH_URL;
    const response = UrlFetchApp.fetch(authUrl, {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      payload: {
        grant_type: "client_credentials",
        audience: "wiz-api",
        client_id: requireProp(PROP_KEYS.wizClientId),
        client_secret: requireProp(PROP_KEYS.wizClientSecret)
      },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      throw new WizQueryError(
        `Wiz token request failed (${response.getResponseCode()}): ` + response.getContentText().slice(0, 500)
      );
    }
    const body = JSON.parse(response.getContentText());
    const token = body["access_token"];
    if (typeof token !== "string" || !token) {
      throw new WizQueryError("Wiz token response carried no access_token.");
    }
    const expiresIn = Number((_b = body["expires_in"]) != null ? _b : 3600);
    const ttl = Math.max(60, Math.min(Math.trunc(expiresIn) - 300, 21600));
    cache.put(TOKEN_CACHE_KEY, token, ttl);
    return token;
  }
  function baseVariables() {
    return JSON.parse(JSON.stringify(BASE_VARIABLES));
  }
  function buildVariables(options = {}) {
    var _a, _b;
    const vars = baseVariables();
    const filterBy = vars["filterBy"];
    const projectId = getProp(PROP_KEYS.wizProjectIdV2);
    if (projectId) filterBy["projectIdV2"] = { equals: [projectId] };
    const sevFilter = options.severities === void 0 ? null : apiSeverityFilter(options.severities);
    if (sevFilter) filterBy["severity"] = sevFilter;
    for (const [k, v] of Object.entries((_a = options.extraFilterBy) != null ? _a : {})) filterBy[k] = v;
    vars["first"] = (_b = options.first) != null ? _b : PAGE_SIZE;
    if (options.after) vars["after"] = options.after;
    vars["includeTotalCount"] = Boolean(options.includeTotalCount);
    return vars;
  }
  function queryPage(variables, isDeltaFetch = false) {
    var _a, _b, _c, _d;
    const apiUrl = requireProp(PROP_KEYS.wizApiUrl);
    let token = getToken();
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = UrlFetchApp.fetch(apiUrl, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${token}` },
        payload: JSON.stringify({ query: QUERY, variables }),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code === 401 && attempt === 0 && !getProp(PROP_KEYS.wizApiToken)) {
        token = getToken(true);
        continue;
      }
      if (code === 429 || code >= 500) {
        lastError = `HTTP ${code}`;
        Utilities.sleep(1e3 * Math.pow(2, attempt));
        continue;
      }
      if (code !== 200) {
        const hint = code === 401 && getProp(PROP_KEYS.wizApiToken) ? " \u2014 WIZ_API_TOKEN was rejected; it may have expired. Refresh it, or set WIZ_CLIENT_ID/WIZ_CLIENT_SECRET for auto-refresh." : "";
        throw new WizQueryError(
          `Wiz query failed (HTTP ${code})${hint}: ${response.getContentText().slice(0, 500)}`
        );
      }
      const body = JSON.parse(response.getContentText());
      const data = body["data"];
      const connection = data == null ? void 0 : data["vulnerabilityFindings"];
      if (!connection) {
        const errors = JSON.stringify((_a = body["errors"]) != null ? _a : body).slice(0, 500);
        if (isDeltaFetch) {
          throw new WizDeltaFilterError(`Wiz rejected the incremental filter: ${errors}`);
        }
        throw new WizQueryError(`Wiz response carried no findings connection: ${errors}`);
      }
      const pageInfo = (_b = connection["pageInfo"]) != null ? _b : {};
      const rawTotal = connection["totalCount"];
      return {
        nodes: (_c = connection["nodes"]) != null ? _c : [],
        hasNextPage: Boolean(pageInfo["hasNextPage"]),
        endCursor: (_d = pageInfo["endCursor"]) != null ? _d : null,
        totalCount: typeof rawTotal === "number" ? rawTotal : null
      };
    }
    throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
  }
  function gqlPost(query, variables) {
    var _a;
    const apiUrl = requireProp(PROP_KEYS.wizApiUrl);
    let token = getToken();
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = UrlFetchApp.fetch(apiUrl, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${token}` },
        payload: JSON.stringify({ query, variables }),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code === 401 && attempt === 0 && !getProp(PROP_KEYS.wizApiToken)) {
        token = getToken(true);
        continue;
      }
      if (code === 429 || code >= 500) {
        lastError = `HTTP ${code}`;
        Utilities.sleep(1e3 * Math.pow(2, attempt));
        continue;
      }
      if (code !== 200) {
        throw new WizQueryError(
          `Wiz query failed (HTTP ${code}): ${response.getContentText().slice(0, 500)}`
        );
      }
      const body = JSON.parse(response.getContentText());
      const data = body["data"];
      if (!data) {
        const errors = JSON.stringify((_a = body["errors"]) != null ? _a : body).slice(0, 500);
        throw new WizQueryError(`Wiz response carried no data: ${errors}`);
      }
      return data;
    }
    throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
  }
  function graphSearchPage(query, variables) {
    var _a, _b, _c;
    const data = gqlPost(query, variables);
    const connection = data["graphSearch"];
    if (!connection) {
      throw new WizQueryError("Wiz response carried no graphSearch connection.");
    }
    const pageInfo = (_a = connection["pageInfo"]) != null ? _a : {};
    return {
      nodes: (_b = connection["nodes"]) != null ? _b : [],
      hasNextPage: Boolean(pageInfo["hasNextPage"]),
      endCursor: (_c = pageInfo["endCursor"]) != null ? _c : null
    };
  }
  function fetchPage(options) {
    var _a;
    const common = {
      severities: options.severities,
      extraFilterBy: options.extraFilterBy,
      after: (_a = options.cursor) != null ? _a : null,
      includeTotalCount: options.pageNumber === 0
    };
    const isDelta = Boolean(options.extraFilterBy && Object.keys(options.extraFilterBy).length);
    try {
      return queryPage(buildVariables({ ...common, first: PAGE_SIZE }), isDelta);
    } catch (e) {
      if (e instanceof WizDeltaFilterError) throw e;
      return queryPage(buildVariables({ ...common, first: PAGE_SIZE_FALLBACK }), isDelta);
    }
  }

  // src/server/diagnostics.ts
  function preview(value) {
    if (!value || !value.trim()) return "(unset)";
    const v = value.trim();
    if (v.length <= 10) return `${v.length} chars`;
    return `${v.length} chars, ${v.slice(0, 4)}\u2026${v.slice(-4)}`;
  }
  function secretPreview(value) {
    return value && value.trim() ? `(set, ${value.trim().length} chars)` : "(unset)";
  }
  function wizDiagnostic() {
    var _a;
    const lines = [];
    const log = (m) => {
      lines.push(m);
      console.log(m);
    };
    const apiUrl = getProp(PROP_KEYS.wizApiUrl);
    const authUrl = (_a = getProp(PROP_KEYS.wizAuthUrl)) != null ? _a : DEFAULT_WIZ_AUTH_URL;
    const token = getProp(PROP_KEYS.wizApiToken);
    const clientId = getProp(PROP_KEYS.wizClientId);
    const clientSecret = getProp(PROP_KEYS.wizClientSecret);
    const projectId = getProp(PROP_KEYS.wizProjectIdV2);
    const mode = resolveWizAuthMode(token, clientId, clientSecret);
    log("=== Wiz diagnostic ===");
    log(`WIZ_API_URL:        ${apiUrl || "(unset!)"}`);
    log(`Auth mode:          ${mode != null ? mode : "(none)"}`);
    log(`WIZ_API_TOKEN:      ${preview(token)}`);
    log(`WIZ_CLIENT_ID:      ${preview(clientId)}`);
    log(`WIZ_CLIENT_SECRET:  ${secretPreview(clientSecret)}`);
    if (mode === "oauth") log(`WIZ_AUTH_URL:       ${authUrl}`);
    log(`WIZ_PROJECT_ID_V2:  ${projectId || "(unset \u2014 querying all projects)"}`);
    if (!apiUrl) {
      log("FAIL: WIZ_API_URL is required, e.g. https://api.<region>.app.wiz.io/graphql.");
      return lines.join("\n");
    }
    if (mode === null) {
      log(
        "FAIL: no usable credentials \u2014 the app runs in dry-run mode. Set WIZ_API_TOKEN, or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET."
      );
      return lines.join("\n");
    }
    let bearer = "";
    try {
      bearer = getToken(true);
      log(
        mode === "token" ? `Step 1 OK: using raw WIZ_API_TOKEN (${preview(bearer)}).` : `Step 1 OK: OAuth exchange minted an access token (${preview(bearer)}).`
      );
    } catch (e) {
      log(`Step 1 FAIL: could not obtain a token \u2014 ${e.message}`);
      log(
        mode === "oauth" ? "\u2192 The token endpoint rejected the client credentials. Verify WIZ_CLIENT_ID / WIZ_CLIENT_SECRET (regenerate the service account in Wiz), and that WIZ_AUTH_URL matches the auth host shown on the service-account page." : "\u2192 WIZ_API_TOKEN is unusable. A Wiz GraphQL service account gives a client id + secret, not a durable token; use WIZ_CLIENT_ID / WIZ_CLIENT_SECRET."
      );
      return lines.join("\n");
    }
    try {
      const page = queryPage(buildVariables({ first: 1 }));
      log(`Step 2 OK: query succeeded \u2014 ${page.nodes.length} finding(s) on page 1.`);
      log("=== All checks passed. Live scans should work. ===");
    } catch (e) {
      const msg = e.message;
      log(`Step 2 FAIL: the query was rejected \u2014 ${msg}`);
      if (/HTTP 401|HTTP 403|Unauthorized/i.test(msg)) {
        log(
          "\u2192 401/403/Unauthorized: the token was not accepted (expired, invalid, or minted for a different tenant). Confirm the service account targets this tenant."
        );
      } else if (/HTTP 404/i.test(msg)) {
        log(
          "\u2192 404: WIZ_API_URL host/path is wrong \u2014 it must be https://api.<region>.app.wiz.io/graphql for your tenant's region."
        );
      } else {
        log(
          '\u2192 If the body names a field (e.g. "Cannot query field"), the service account lacks permission for it or the tenant schema differs.'
        );
      }
      return lines.join("\n");
    }
    return lines.join("\n");
  }

  // src/server/api.ts
  var api_exports = {};
  __export(api_exports, {
    bootstrap: () => bootstrap,
    cancelScan: () => cancelScan2,
    compact: () => compact,
    deleteScans: () => deleteScans2,
    getAttribution: () => getAttribution,
    getDomains: () => getDomains3,
    getExportCsv: () => getExportCsv,
    getExportRawUrl: () => getExportRawUrl,
    getFindingDetail: () => getFindingDetail,
    getFindings: () => getFindings,
    getGroupTrend: () => getGroupTrend,
    getGrouping: () => getGrouping,
    getHistoryPage: () => getHistoryPage,
    getInsights: () => getInsights,
    getJobStatus: () => getJobStatus,
    getMttr: () => getMttr,
    getMttrPage: () => getMttrPage,
    getMttrTrend: () => getMttrTrend,
    getReport: () => getReport,
    getScanHistory: () => getScanHistory,
    getSettings: () => getSettings,
    getStorageStats: () => getStorageStats,
    importAbort: () => importAbort,
    importBegin: () => importBegin,
    importFinalize: () => importFinalize,
    importMigration: () => importMigration,
    importShard: () => importShard,
    importStatus: () => importStatus,
    previewDomains: () => previewDomains,
    refreshSupportGroups: () => refreshSupportGroups2,
    resetLedger: () => resetLedger2,
    runScan: () => runScan,
    saveDomains: () => saveDomains,
    setAutoCompact: () => setAutoCompact2,
    setFastLaneDays: () => setFastLaneDays2,
    setRetention: () => setRetention,
    setRetentionSettings: () => setRetentionSettings,
    setSeverities: () => setSeverities
  });

  // src/domain/util.ts
  function present(v) {
    if (v === null || v === void 0) return false;
    if (typeof v === "number" && Number.isNaN(v)) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  }
  function clean(v) {
    return present(v) ? v : null;
  }
  function pyStr(v) {
    if (v === true) return "True";
    if (v === false) return "False";
    return String(v);
  }
  function parseTs(v) {
    const c = clean(v);
    if (c === null) return null;
    if (c instanceof Date) return isNaN(c.getTime()) ? null : c.getTime();
    if (typeof c === "number" && Number.isFinite(c)) return c;
    let s = String(c).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += "Z";
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  function toIso(ms) {
    if (ms === null || !Number.isFinite(ms)) return null;
    return new Date(Math.floor(ms / 1e3) * 1e3).toISOString().replace(".000Z", "Z");
  }
  function minIso(...values) {
    const parsed = values.map(parseTs).filter((t) => t !== null);
    return parsed.length ? toIso(Math.min(...parsed)) : null;
  }
  function midpointIso(a, b) {
    var _a;
    const da = parseTs(a);
    const db = parseTs(b);
    if (da === null || db === null) return (_a = toIso(db)) != null ? _a : toIso(da);
    return toIso(da + (db - da) / 2);
  }
  function nowIso(now) {
    return toIso(now != null ? now : Date.now());
  }
  function mean(values) {
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  function quantile(values, q) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = q * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  function median(values) {
    return quantile(values, 0.5);
  }

  // src/domain/domainRules.ts
  var UNASSIGNED = "Unassigned";
  var MAX_REGEX_LEN = 200;
  var COMPACTED_ASSET = "(compacted)";
  var FRAME_NAME_COLS = ["vulnerableAsset.name"];
  var FRAME_SUB_COLS = [
    "vulnerableAsset.subscriptionName",
    "vulnerableAsset.subscriptionExternalId",
    "vulnerableAsset.subscriptionId"
  ];
  var FRAME_TAGS_PREFIX = "vulnerableAsset.tags.";
  var LEDGER_NAME_COLS = ["asset_name"];
  var LEDGER_SUB_COLS = ["subscription_name", "subscription_ext_id"];
  var FRAME_SG_COLS = ["_supportGroup", "vulnerableAsset.supportGroup"];
  var LEDGER_SG_COLS = ["support_group"];
  function fold(v) {
    return String(v).trim().toLowerCase();
  }
  function pyRepr(v) {
    if (typeof v === "string") return `'${v}'`;
    if (v === null || v === void 0) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    return String(v);
  }
  function compileCondition(cond) {
    if (!cond || typeof cond !== "object" || Array.isArray(cond)) return null;
    const c = cond;
    const ctype = c["type"];
    if (ctype === "tag") {
      const key = c["key"];
      if (typeof key !== "string" || !key.trim()) return null;
      const value = c["value"];
      if (value !== null && value !== void 0 && !["string", "number", "boolean"].includes(typeof value)) {
        return null;
      }
      return {
        kind: "tag",
        key: key.trim(),
        value: value === null || value === void 0 ? null : fold(value)
      };
    }
    if (ctype === "name_regex") {
      const pattern = c["pattern"];
      if (typeof pattern !== "string" || !pattern.trim() || pattern.length > MAX_REGEX_LEN) {
        return null;
      }
      try {
        return { kind: "regex", re: new RegExp(pattern, "i") };
      } catch {
        return null;
      }
    }
    if (ctype === "subscription") {
      const values = c["values"];
      if (!Array.isArray(values) || !values.length) return null;
      const folded = /* @__PURE__ */ new Set();
      for (const v of values) {
        if ((typeof v === "string" || typeof v === "number") && String(v).trim()) {
          folded.add(fold(v));
        }
      }
      return folded.size ? { kind: "sub", values: folded } : null;
    }
    if (ctype === "support_group") {
      const values = c["values"];
      if (!Array.isArray(values) || !values.length) return null;
      const folded = /* @__PURE__ */ new Set();
      for (const v of values) {
        if ((typeof v === "string" || typeof v === "number") && String(v).trim()) {
          folded.add(fold(v));
        }
      }
      return folded.size ? { kind: "sg", values: folded } : null;
    }
    return null;
  }
  function compileDomains(items) {
    var _a;
    const compiled = [];
    for (const item of items != null ? items : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const it = item;
      const name = it["name"];
      if (typeof name !== "string" || !name.trim()) continue;
      const rules = [];
      for (const rule of (_a = it["rules"]) != null ? _a : []) {
        const conds = rule && typeof rule === "object" && !Array.isArray(rule) ? rule["conditions"] : null;
        if (!Array.isArray(conds) || !conds.length) {
          rules.push(null);
          continue;
        }
        const specs = conds.map(compileCondition);
        rules.push(specs.some((s) => s === null) ? null : specs);
      }
      compiled.push({ name: name.trim(), rules });
    }
    return compiled;
  }
  function validateDomains(items) {
    const errors = [];
    const seen = /* @__PURE__ */ new Set();
    const list = Array.isArray(items) ? items : [];
    list.forEach((item, idx) => {
      const i = idx + 1;
      let label = `Domain ${i}`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${label}: not a valid entry.`);
        return;
      }
      const it = item;
      const rawName = it["name"];
      if (typeof rawName !== "string" || !rawName.trim()) {
        errors.push(`${label}: name is required.`);
      } else {
        const name = rawName.trim();
        label = `Domain \u201C${name}\u201D`;
        if (name.toLowerCase() === UNASSIGNED.toLowerCase()) {
          errors.push(`${label}: \u201C${UNASSIGNED}\u201D is reserved.`);
        }
        if (name.includes(",")) errors.push(`${label}: names cannot contain commas.`);
        if (seen.has(name.toLowerCase())) errors.push(`${label}: duplicate name.`);
        seen.add(name.toLowerCase());
      }
      const rules = it["rules"];
      if (!Array.isArray(rules) || !rules.length) {
        errors.push(`${label}: needs at least one rule.`);
        return;
      }
      rules.forEach((rule, jdx) => {
        const j = jdx + 1;
        const conds = rule && typeof rule === "object" && !Array.isArray(rule) ? rule["conditions"] : null;
        if (!Array.isArray(conds) || !conds.length) {
          errors.push(`${label}, rule ${j}: needs at least one condition.`);
          return;
        }
        conds.forEach((cond, kdx) => {
          const where = `${label}, rule ${j}, condition ${kdx + 1}`;
          if (!cond || typeof cond !== "object" || Array.isArray(cond)) {
            errors.push(`${where}: not a valid condition.`);
            return;
          }
          const c = cond;
          const ctype = c["type"];
          if (ctype === "tag") {
            const key = c["key"];
            if (typeof key !== "string" || !key.trim()) {
              errors.push(`${where}: tag key is required.`);
            }
          } else if (ctype === "name_regex") {
            const pattern = c["pattern"];
            if (typeof pattern !== "string" || !pattern.trim()) {
              errors.push(`${where}: pattern is required.`);
            } else if (pattern.length > MAX_REGEX_LEN) {
              errors.push(`${where}: pattern is longer than ${MAX_REGEX_LEN} characters.`);
            } else {
              try {
                new RegExp(pattern);
              } catch (exc) {
                errors.push(`${where}: pattern does not compile (${String(exc)}).`);
              }
            }
          } else if (ctype === "subscription") {
            const values = c["values"];
            if (!Array.isArray(values) || !values.some((v) => typeof v === "string" && v.trim())) {
              errors.push(`${where}: pick at least one subscription.`);
            }
          } else if (ctype === "support_group") {
            const values = c["values"];
            if (!Array.isArray(values) || !values.some((v) => typeof v === "string" && v.trim())) {
              errors.push(`${where}: pick at least one support group.`);
            }
          } else {
            errors.push(`${where}: unknown condition type ${pyRepr(ctype)}.`);
          }
        });
      });
    });
    return errors;
  }
  function domainNames(items) {
    const names = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const name = item["name"];
        if (typeof name === "string" && name.trim()) names.push(name.trim());
      }
    }
    return [...names, UNASSIGNED];
  }
  function recordTags(record) {
    const va = record["vulnerableAsset"];
    if (va && typeof va === "object" && !Array.isArray(va)) {
      const t = va["tags"];
      if (t && typeof t === "object" && !Array.isArray(t)) return t;
    }
    const flat = record["vulnerableAsset.tags"];
    if (flat && typeof flat === "object" && !Array.isArray(flat)) return flat;
    const out = {};
    for (const [k, v] of Object.entries(record)) {
      if (k.startsWith(FRAME_TAGS_PREFIX) && present(v)) out[k.slice(FRAME_TAGS_PREFIX.length)] = v;
    }
    if (Object.keys(out).length) return out;
    const tagsJson2 = record["tags_json"];
    if (typeof tagsJson2 === "string" && tagsJson2) {
      try {
        const parsed = JSON.parse(tagsJson2);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch {
      }
    }
    return {};
  }
  function recordValues(record, ...keys) {
    const out = [];
    const va = record["vulnerableAsset"];
    for (const k of keys) {
      const v = record[k];
      if (present(v)) {
        out.push(String(v));
      } else if (va && typeof va === "object" && !Array.isArray(va)) {
        const leaf = va[k.split(".").pop()];
        if (present(leaf)) out.push(String(leaf));
      }
    }
    return out;
  }
  function conditionMatches(spec, record, tags) {
    if (spec.kind === "tag") {
      if (!(spec.key in tags) || tags[spec.key] === null || tags[spec.key] === void 0) {
        return false;
      }
      return spec.value === null || fold(tags[spec.key]) === spec.value;
    }
    if (spec.kind === "regex") {
      const names = recordValues(record, ...FRAME_NAME_COLS);
      const pool = names.length ? names : recordValues(record, ...LEDGER_NAME_COLS);
      return pool.some((n) => spec.re.test(n));
    }
    if (spec.kind === "sg") {
      const sgs = [
        ...recordValues(record, ...FRAME_SG_COLS),
        ...recordValues(record, ...LEDGER_SG_COLS)
      ];
      return sgs.some((s) => spec.values.has(fold(s)));
    }
    const subs = [
      ...recordValues(record, ...FRAME_SUB_COLS),
      ...recordValues(record, ...LEDGER_SUB_COLS)
    ];
    return subs.some((s) => spec.values.has(fold(s)));
  }
  function assignDomain(record, compiled) {
    const name = recordValues(record, ...LEDGER_NAME_COLS);
    if (name.length && name[0] === COMPACTED_ASSET) return UNASSIGNED;
    const tags = recordTags(record);
    for (const dom of compiled) {
      for (const rule of dom.rules) {
        if (rule && rule.every((spec) => conditionMatches(spec, record, tags))) {
          return dom.name;
        }
      }
    }
    return UNASSIGNED;
  }
  function assignDomains(records, compiled) {
    return records.map((r) => assignDomain(r, compiled));
  }

  // src/domain/attribution.ts
  var COMPACTED_ASSET2 = "(compacted)";
  var NAME_COL = "vulnerableAsset.name";
  var TYPE_COL = "vulnerableAsset.type";
  var SUB_COL = "vulnerableAsset.subscriptionName";
  var EXT_COL = "vulnerableAsset.subscriptionExternalId";
  var SG_COL = "_supportGroup";
  var DOMAIN_COL = "_domain";
  var NONE = "(none)";
  var MAX_TAG_KEYS = 12;
  var MAX_TAG_VALUE_LEN = 80;
  var MAX_NEAR_MISSES = 3;
  var KIND_LABEL = {
    tag: "tag",
    regex: "name",
    sub: "subscription",
    sg: "support group"
  };
  function domainOf(r) {
    const v = r[DOMAIN_COL];
    return present(v) ? String(v) : UNASSIGNED;
  }
  function sevOf(r) {
    const s = r["_sev"];
    return typeof s === "string" && s ? s : normalizeSeverity(r["severity"]);
  }
  function addSev(counts, r) {
    var _a;
    const s = sevOf(r);
    counts[s] = ((_a = counts[s]) != null ? _a : 0) + 1;
  }
  function flatVal(r, key) {
    const v = r[key];
    return present(v) ? String(v) : null;
  }
  function assetKey(r) {
    var _a;
    return String((_a = r[NAME_COL]) != null ? _a : "");
  }
  function isCompacted(record) {
    const v = record["asset_name"];
    if (present(v)) return String(v) === COMPACTED_ASSET2;
    const va = record["vulnerableAsset"];
    if (va && typeof va === "object" && !Array.isArray(va)) {
      const leaf = va["asset_name"];
      if (present(leaf)) return String(leaf) === COMPACTED_ASSET2;
    }
    return false;
  }
  function traceRecord(record, compiled) {
    const tags = recordTags(record);
    const compacted = isCompacted(record);
    const rules = [];
    let assigned = UNASSIGNED;
    compiled.forEach((dom, domainIndex) => {
      dom.rules.forEach((rule, ruleIndex) => {
        if (rule === null) {
          rules.push({ domainIndex, domain: dom.name, ruleIndex, malformed: true, matched: false, conditions: [] });
          return;
        }
        const conditions = rule.map((spec, index) => ({ index, matched: conditionMatches(spec, record, tags) }));
        const matched = conditions.every((c) => c.matched);
        rules.push({ domainIndex, domain: dom.name, ruleIndex, malformed: false, matched, conditions });
        if (matched && !compacted && assigned === UNASSIGNED) assigned = dom.name;
      });
    });
    return { assigned, rules };
  }
  function ruleHealth(records, compiled) {
    const stats = compiled.map((dom) => dom.rules.map(() => ({ fired: 0, matched: 0 })));
    for (const record of records) {
      const trace = traceRecord(record, compiled);
      for (const rt of trace.rules) {
        if (rt.matched) stats[rt.domainIndex][rt.ruleIndex].matched += 1;
      }
      if (trace.assigned !== UNASSIGNED) {
        const winner = trace.rules.find((rt) => rt.matched && rt.domain === trace.assigned);
        if (winner) stats[winner.domainIndex][winner.ruleIndex].fired += 1;
      }
    }
    const out = [];
    compiled.forEach((dom, domainIndex) => {
      dom.rules.forEach((rule, ruleIndex) => {
        const { fired, matched } = stats[domainIndex][ruleIndex];
        const status = rule === null ? "malformed" : matched === 0 ? "dead" : fired === 0 ? "shadowed" : "ok";
        out.push({ domainIndex, domain: dom.name, ruleIndex, fired, matched, status });
      });
    });
    return out;
  }
  function orderedWithUnassignedLast(names) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const n of names) {
      if (n === UNASSIGNED || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    out.push(UNASSIGNED);
    return out;
  }
  function coverage(records, orderedDomainNames) {
    var _a;
    const findingsByDomain = /* @__PURE__ */ new Map();
    const assetsByDomain = /* @__PURE__ */ new Map();
    const allAssets = /* @__PURE__ */ new Set();
    const attributedAssets = /* @__PURE__ */ new Set();
    const unassignedAssets = /* @__PURE__ */ new Set();
    let attributedFindings = 0;
    let unassignedFindings = 0;
    let sgResolved = 0;
    let sgUnresolved = 0;
    for (const r of records) {
      const domain = domainOf(r);
      const asset = assetKey(r);
      findingsByDomain.set(domain, ((_a = findingsByDomain.get(domain)) != null ? _a : 0) + 1);
      let set = assetsByDomain.get(domain);
      if (!set) assetsByDomain.set(domain, set = /* @__PURE__ */ new Set());
      if (asset) {
        set.add(asset);
        allAssets.add(asset);
      }
      if (domain === UNASSIGNED) {
        unassignedFindings += 1;
        if (asset) unassignedAssets.add(asset);
      } else {
        attributedFindings += 1;
        if (asset) attributedAssets.add(asset);
      }
      if (present(r[SG_COL])) sgResolved += 1;
      else sgUnresolved += 1;
    }
    const byDomain = orderedWithUnassignedLast(orderedDomainNames).map((domain) => {
      var _a2, _b, _c;
      return {
        domain,
        findings: (_a2 = findingsByDomain.get(domain)) != null ? _a2 : 0,
        assets: (_c = (_b = assetsByDomain.get(domain)) == null ? void 0 : _b.size) != null ? _c : 0
      };
    });
    return {
      totalFindings: records.length,
      totalAssets: allAssets.size,
      attributedFindings,
      attributedAssets: attributedAssets.size,
      unassignedFindings,
      unassignedAssets: unassignedAssets.size,
      supportGroupResolved: sgResolved,
      supportGroupUnresolved: sgUnresolved,
      byDomain
    };
  }
  function cappedTags(record) {
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(recordTags(record))) {
      if (!present(v)) continue;
      if (n >= MAX_TAG_KEYS) break;
      const s = String(v);
      out[k] = s.length > MAX_TAG_VALUE_LEN ? s.slice(0, MAX_TAG_VALUE_LEN) : s;
      n += 1;
    }
    return out;
  }
  function failedTypes(compiled, rt) {
    const rule = compiled[rt.domainIndex].rules[rt.ruleIndex];
    if (!rule) return [];
    const out = [];
    for (const c of rt.conditions) {
      if (c.matched) continue;
      const label = KIND_LABEL[rule[c.index].kind];
      if (!out.includes(label)) out.push(label);
    }
    return out;
  }
  function nearMisses(record, compiled) {
    const trace = traceRecord(record, compiled);
    const cand = trace.rules.filter((rt) => !rt.malformed && rt.conditions.some((c) => c.matched)).map((rt) => {
      const matchedConditions = rt.conditions.filter((c) => c.matched).length;
      return {
        domainIndex: rt.domainIndex,
        nm: {
          domain: rt.domain,
          ruleIndex: rt.ruleIndex,
          matchedConditions,
          totalConditions: rt.conditions.length,
          failedTypes: failedTypes(compiled, rt)
        }
      };
    });
    cand.sort(
      (a, b) => b.nm.matchedConditions - a.nm.matchedConditions || a.nm.totalConditions - a.nm.matchedConditions - (b.nm.totalConditions - b.nm.matchedConditions) || a.domainIndex - b.domainIndex || a.nm.ruleIndex - b.nm.ruleIndex
    );
    return cand.slice(0, MAX_NEAR_MISSES).map((c) => c.nm);
  }
  function unassignedResources(records, compiled) {
    const groups = /* @__PURE__ */ new Map();
    for (const r of records) {
      if (domainOf(r) !== UNASSIGNED) continue;
      const asset = assetKey(r);
      let g = groups.get(asset);
      if (!g) groups.set(asset, g = { rep: r, findings: 0, sevCounts: {} });
      g.findings += 1;
      addSev(g.sevCounts, r);
    }
    const rows = [];
    for (const [asset, g] of groups) {
      rows.push({
        asset,
        assetType: flatVal(g.rep, TYPE_COL),
        subscription: flatVal(g.rep, SUB_COL),
        subscriptionExtId: flatVal(g.rep, EXT_COL),
        supportGroup: flatVal(g.rep, SG_COL),
        tags: cappedTags(g.rep),
        findings: g.findings,
        sevCounts: g.sevCounts,
        nearMisses: nearMisses(g.rep, compiled)
      });
    }
    rows.sort((a, b) => b.findings - a.findings || a.asset.localeCompare(b.asset));
    return rows;
  }
  function untaggedSubscriptions(records) {
    var _a, _b;
    const groups = /* @__PURE__ */ new Map();
    for (const r of records) {
      if (present(r[SG_COL])) continue;
      const subscription = (_a = flatVal(r, SUB_COL)) != null ? _a : NONE;
      const extId = (_b = flatVal(r, EXT_COL)) != null ? _b : NONE;
      const key = `${subscription}\0${extId}`;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { subscription, extId, assets: /* @__PURE__ */ new Set(), findings: 0, sevCounts: {} });
      g.findings += 1;
      const asset = assetKey(r);
      if (asset) g.assets.add(asset);
      addSev(g.sevCounts, r);
    }
    return [...groups.values()].map((g) => ({
      subscription: g.subscription,
      extId: g.extId,
      assets: g.assets.size,
      findings: g.findings,
      sevCounts: g.sevCounts
    })).sort(
      (a, b) => b.findings - a.findings || a.subscription.localeCompare(b.subscription) || a.extId.localeCompare(b.extId)
    );
  }

  // src/domain/sha1.ts
  function utf8Bytes(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c < 128) {
        out.push(c);
      } else if (c < 2048) {
        out.push(192 | c >> 6, 128 | c & 63);
      } else if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
        const c2 = s.charCodeAt(++i);
        const cp = 65536 + (c - 55296 << 10) + (c2 - 56320);
        out.push(
          240 | cp >> 18,
          128 | cp >> 12 & 63,
          128 | cp >> 6 & 63,
          128 | cp & 63
        );
      } else {
        out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
      }
    }
    return out;
  }
  function rotl(n, b) {
    return (n << b | n >>> 32 - b) >>> 0;
  }
  function sha1Hex(input) {
    const bytes = utf8Bytes(input);
    const bitLen = bytes.length * 8;
    bytes.push(128);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 4294967296);
    bytes.push(hi >>> 24 & 255, hi >>> 16 & 255, hi >>> 8 & 255, hi & 255);
    bytes.push(bitLen >>> 24 & 255, bitLen >>> 16 & 255, bitLen >>> 8 & 255, bitLen & 255);
    let h0 = 1732584193, h1 = 4023233417, h2 = 2562383102, h3 = 271733878, h4 = 3285377520;
    const w = new Array(80);
    for (let block = 0; block < bytes.length; block += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = (bytes[block + i * 4] << 24 | bytes[block + i * 4 + 1] << 16 | bytes[block + i * 4 + 2] << 8 | bytes[block + i * 4 + 3]) >>> 0;
      }
      for (let i = 16; i < 80; i++) {
        w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) {
          f = b & c | ~b & d;
          k = 1518500249;
        } else if (i < 40) {
          f = b ^ c ^ d;
          k = 1859775393;
        } else if (i < 60) {
          f = b & c | b & d | c & d;
          k = 2400959708;
        } else {
          f = b ^ c ^ d;
          k = 3395469782;
        }
        const t = rotl(a, 5) + f + e + k + w[i] >>> 0;
        e = d;
        d = c;
        c = rotl(b, 30);
        b = a;
        a = t;
      }
      h0 = h0 + a >>> 0;
      h1 = h1 + b >>> 0;
      h2 = h2 + c >>> 0;
      h3 = h3 + d >>> 0;
      h4 = h4 + e >>> 0;
    }
    return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
  }

  // src/domain/metrics.ts
  var DAY_MS = 864e5;
  function findCol(columns, ...candidates) {
    const lower = columns.map((c) => c.toLowerCase());
    for (const cand of candidates) {
      const needle = cand.toLowerCase();
      for (let i = 0; i < lower.length; i++) {
        if (lower[i].includes(needle)) return columns[i];
      }
    }
    return null;
  }
  function recordColumns(records) {
    const cols = [];
    const seen = /* @__PURE__ */ new Set();
    for (const rec of records) {
      for (const k of Object.keys(rec)) {
        if (!seen.has(k)) {
          seen.add(k);
          cols.push(k);
        }
      }
    }
    return cols;
  }
  function calculateMttr(records, now) {
    if (!records.length) return { perSev: {}, overall: {} };
    const columns = recordColumns(records);
    const firstSeenCol = findCol(columns, "firstSeenAt", "firstDetectedAt", "createdAt");
    const resolvedCol = findCol(columns, "resolvedAt", "remediatedAt", "fixedAt");
    if (!firstSeenCol) return { perSev: {}, overall: {} };
    const work = records.map((rec) => ({
      sev: "severity" in rec ? normalizeSeverity(rec["severity"]) : "UNKNOWN",
      firstSeen: parseTs(rec[firstSeenCol]),
      resolved: resolvedCol ? parseTs(rec[resolvedCol]) : null
    }));
    return summarize(work, now);
  }
  function summarize(work, now) {
    var _a;
    if (!work.length) return { perSev: {}, overall: {} };
    const nowMs = now != null ? now : Date.now();
    const mttrDays = (r) => r.resolved !== null && r.firstSeen !== null ? (r.resolved - r.firstSeen) / DAY_MS : null;
    const ageDays = (r) => r.firstSeen !== null ? (nowMs - r.firstSeen) / DAY_MS : null;
    const perSev = {};
    for (const sev2 of SEVERITY_ORDER) {
      const sub = work.filter((r) => r.sev === sev2);
      if (!sub.length) continue;
      const resolvedDays = sub.map(mttrDays).filter((d) => d !== null);
      const openAges = sub.filter((r) => r.resolved === null && r.firstSeen !== null).map(ageDays).filter((d) => d !== null);
      const target = (_a = SLA_TARGETS[sev2]) != null ? _a : null;
      const withinSla = target !== null && resolvedDays.length ? resolvedDays.filter((d) => d <= target).length : 0;
      perSev[sev2] = {
        mttr_mean: resolvedDays.length ? mean(resolvedDays) : null,
        mttr_median: resolvedDays.length ? median(resolvedDays) : null,
        resolved: resolvedDays.length,
        open: openAges.length,
        open_age_p50: openAges.length ? median(openAges) : null,
        open_age_p90: openAges.length ? quantile(openAges, 0.9) : null,
        sla_target: target,
        sla_compliant: withinSla,
        sla_pct: resolvedDays.length && target !== null ? withinSla / resolvedDays.length * 100 : null
      };
    }
    const allMttr = work.map(mttrDays).filter((d) => d !== null);
    const overall = {
      mttr_mean: allMttr.length ? mean(allMttr) : null,
      mttr_median: allMttr.length ? median(allMttr) : null,
      resolved: work.filter((r) => r.resolved !== null).length,
      open: work.filter((r) => r.resolved === null).length
    };
    return { perSev, overall };
  }
  function overallSlaOldest(perSev) {
    const stats = Object.values(perSev);
    const compliant = stats.reduce((a, d) => {
      var _a;
      return a + ((_a = d.sla_compliant) != null ? _a : 0);
    }, 0);
    const resolved = stats.reduce((a, d) => {
      var _a;
      return a + ((_a = d.resolved) != null ? _a : 0);
    }, 0);
    const slaPct = resolved ? compliant / resolved * 100 : null;
    const p90s = stats.map((d) => d.open_age_p90).filter((v) => v !== null && v !== void 0);
    const oldestDays = p90s.length ? Math.max(...p90s) : null;
    return { slaPct, oldestDays };
  }

  // src/domain/lifecycle.ts
  function field(record, ...keys) {
    for (const k of keys) {
      const v = record[k];
      if (present(v)) return pyStr(v);
    }
    const va = record["vulnerableAsset"];
    if (va && typeof va === "object" && !Array.isArray(va)) {
      for (const k of keys) {
        const leaf = k.split(".").pop();
        const v = va[leaf];
        if (present(v)) return pyStr(v);
      }
    }
    return "";
  }
  function vulnKey(record) {
    const fid = record["id"];
    if (typeof fid === "string" && fid.trim()) return `id:${fid.trim()}`;
    const cve = field(record, "name");
    const asset = field(record, "vulnerableAsset.id", "assetId") || field(record, "vulnerableAsset.name");
    const atype = field(record, "vulnerableAsset.type", "type");
    const cloud = field(record, "vulnerableAsset.cloudPlatform", "cloudPlatform");
    const component = field(record, "detailedName", "detailedNameV2");
    const basis = [cve, asset, atype, cloud, component].join("|");
    return "h:" + sha1Hex(basis).slice(0, 16);
  }
  function mttrFromLedger(ledgerRows, opts = {}) {
    const rows = [...ledgerRows];
    if (!rows.length) return { perSev: {}, overall: {} };
    const work = rows.map((r) => ({
      sev: "severity" in r ? normalizeSeverity(r["severity"]) : "UNKNOWN",
      firstSeen: parseTs(r["first_seen"]),
      resolved: parseTs(r["resolved_at"])
    }));
    return summarize(work, opts.now);
  }

  // src/domain/transform.ts
  function coerceResults(results) {
    if (results === null || results === void 0) return results;
    if (typeof results === "object") return results;
    if (typeof results === "string") {
      const s = results.trim();
      try {
        return JSON.parse(s);
      } catch {
        return results;
      }
    }
    return results;
  }
  function extractNodes(results) {
    var _a, _b, _c;
    const coerced = coerceResults(results);
    if (!coerced) return [];
    if (Array.isArray(coerced) && coerced.length && typeof coerced[0] === "object") {
      const merged = [];
      let ok = false;
      for (const page of coerced) {
        if (page && typeof page === "object" && !Array.isArray(page)) {
          const sub = extractNodes(page);
          if (sub.length) {
            merged.push(...sub);
            ok = true;
          }
        }
      }
      if (ok) return merged;
    }
    if (coerced && typeof coerced === "object" && !Array.isArray(coerced)) {
      const obj = coerced;
      const data = obj["data"];
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const d = data;
        const vf = d["vulnerabilityFindings"];
        if (vf && typeof vf === "object" && !Array.isArray(vf) && "nodes" in vf) {
          return (_a = vf["nodes"]) != null ? _a : [];
        }
        for (const v of Object.values(d)) {
          if (v && typeof v === "object" && !Array.isArray(v) && "nodes" in v) {
            return (_b = v["nodes"]) != null ? _b : [];
          }
        }
      }
      if ("nodes" in obj) return (_c = obj["nodes"]) != null ? _c : [];
    }
    if (Array.isArray(coerced)) return coerced;
    return [coerced];
  }
  function mergeNodes(baselineNodes, deltaNodes) {
    const byKey = /* @__PURE__ */ new Map();
    for (const node of deltaNodes != null ? deltaNodes : []) byKey.set(vulnKey(node), node);
    const merged = [];
    for (const node of baselineNodes != null ? baselineNodes : []) {
      const key = vulnKey(node);
      if (byKey.has(key)) {
        merged.push(byKey.get(key));
        byKey.delete(key);
      } else {
        merged.push(node);
      }
    }
    merged.push(...byKey.values());
    return merged;
  }
  function flattenNode(node, prefix = "") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(out, flattenNode(v, key));
      } else {
        out[key] = v;
      }
    }
    return out;
  }

  // src/domain/remediation.ts
  var DAY_MS2 = 864e5;
  var RESOLUTION_BUCKET_EDGES = [1, 7, 30, 90];
  var RESOLUTION_BUCKET_LABELS = ["\u22641d", "2\u20137d", "8\u201330d", "31\u201390d", "90+d"];
  function isOpen(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  function resolvedMttr(row) {
    const m = row.mttr_days;
    return typeof m === "number" && Number.isFinite(m) ? m : null;
  }
  function openAge(row) {
    if (!isOpen(row.status)) return null;
    const a = row.age_days;
    return typeof a === "number" && Number.isFinite(a) ? a : null;
  }
  function mttrPercentiles(rows) {
    var _a;
    const bySev = {};
    const all = [];
    for (const row of rows) {
      const m = resolvedMttr(row);
      if (m === null) continue;
      const s = normalizeSeverity(row.severity);
      ((_a = bySev[s]) != null ? _a : bySev[s] = []).push(m);
      all.push(m);
    }
    const perSev = {};
    for (const s of SEVERITY_ORDER) {
      const vals = bySev[s];
      if (!vals) continue;
      perSev[s] = { p50: quantile(vals, 0.5), p90: quantile(vals, 0.9), count: vals.length };
    }
    return {
      perSev,
      overall: { p50: quantile(all, 0.5), p90: quantile(all, 0.9), count: all.length }
    };
  }
  function fastLaneSplit(rows, threshold = DEFAULT_FAST_LANE_DAYS) {
    const resolved = [];
    for (const row of rows) {
      const m = resolvedMttr(row);
      if (m !== null) resolved.push(m);
    }
    const total = resolved.length;
    const fastLane = resolved.filter((m) => m <= threshold).length;
    const tail = resolved.filter((m) => m > threshold);
    return {
      total,
      fastLane,
      fastLanePct: total ? fastLane / total * 100 : null,
      tailCount: tail.length,
      tailMedian: median(tail)
    };
  }
  function resolutionBuckets(rows) {
    const perSev = {};
    let total = 0;
    for (const row of rows) {
      const m = resolvedMttr(row);
      if (m === null) continue;
      const bucket = m <= RESOLUTION_BUCKET_EDGES[0] ? 0 : m <= RESOLUTION_BUCKET_EDGES[1] ? 1 : m <= RESOLUTION_BUCKET_EDGES[2] ? 2 : m <= RESOLUTION_BUCKET_EDGES[3] ? 3 : 4;
      const s = normalizeSeverity(row.severity);
      if (!perSev[s]) perSev[s] = [0, 0, 0, 0, 0];
      perSev[s][bucket] += 1;
      total += 1;
    }
    return { perSev, labels: RESOLUTION_BUCKET_LABELS, total };
  }
  function kmMedian(rows) {
    const events = [];
    const times = [];
    for (const row of rows) {
      const m = resolvedMttr(row);
      if (m !== null) {
        events.push(m);
        times.push(m);
        continue;
      }
      const c = openAge(row);
      if (c !== null) times.push(c);
    }
    if (!events.length) return null;
    let s = 1;
    for (const t of [...new Set(events)].sort((a, b) => a - b)) {
      const n = times.filter((x) => x >= t).length;
      if (n === 0) continue;
      const d = events.filter((x) => x === t).length;
      s *= 1 - d / n;
      if (s <= 0.5) return t;
    }
    return null;
  }
  function openPastSla(rows) {
    var _a, _b;
    const perSev = {};
    let totalOpen = 0;
    let totalBreached = 0;
    for (const row of rows) {
      const age = openAge(row);
      if (age === null) continue;
      const s = normalizeSeverity(row.severity);
      const target = (_a = SLA_TARGETS[s]) != null ? _a : null;
      const stat = (_b = perSev[s]) != null ? _b : perSev[s] = { open: 0, breached: 0, pct: null, target };
      stat.open += 1;
      totalOpen += 1;
      if (target !== null && age > target) {
        stat.breached += 1;
        totalBreached += 1;
      }
    }
    for (const stat of Object.values(perSev)) {
      stat.pct = stat.open ? stat.breached / stat.open * 100 : null;
    }
    return {
      perSev,
      overall: {
        open: totalOpen,
        breached: totalBreached,
        pct: totalOpen ? totalBreached / totalOpen * 100 : null
      }
    };
  }
  function openPastSlaFromRecords(records, now) {
    if (!records.length) return 0;
    const nowMs = now != null ? now : Date.now();
    const firstSeenCol = findCol(recordColumns(records), "firstSeenAt", "firstDetectedAt", "createdAt");
    if (!firstSeenCol) return 0;
    let breached = 0;
    for (const rec of records) {
      if (!isOpen(rec["status"])) continue;
      const first = parseTs(rec[firstSeenCol]);
      if (first === null) continue;
      const s = "severity" in rec ? normalizeSeverity(rec["severity"]) : "UNKNOWN";
      const target = SLA_TARGETS[s];
      if (target !== void 0 && (nowMs - first) / DAY_MS2 > target) breached += 1;
    }
    return breached;
  }
  function actionableView(rows) {
    return rows.map((r) => ({
      severity: r.severity,
      status: r.status,
      mttr_days: r.mttr_actionable_days,
      age_days: r.actionable_age_days
    }));
  }
  function awaitingVendorFix(rows) {
    var _a;
    const perSev = {};
    let overall = 0;
    let openTotal = 0;
    for (const row of rows) {
      if (!isOpen(row.status)) continue;
      openTotal += 1;
      if (!row.awaiting_vendor_fix) continue;
      const s = normalizeSeverity(row.severity);
      perSev[s] = ((_a = perSev[s]) != null ? _a : 0) + 1;
      overall += 1;
    }
    return {
      perSev,
      overall,
      openTotal,
      pctOfOpen: openTotal ? overall / openTotal * 100 : null
    };
  }

  // src/domain/compaction.ts
  var CHECKPOINT_VERSION = 1;
  function serializeSeverities(sevs) {
    if (sevs === null || sevs === void 0) return null;
    const vals = /* @__PURE__ */ new Set();
    for (const s of sevs) {
      if (typeof s === "string") {
        const n = normalizeSeverity(s);
        if (SELECTABLE_SEVERITIES.includes(n)) vals.add(n);
      }
    }
    if (!vals.size || vals.size === SELECTABLE_SEVERITIES.length) return null;
    const ordered = SEVERITY_ORDER.filter((s) => vals.has(s));
    return `[${ordered.map((s) => JSON.stringify(s)).join(", ")}]`;
  }
  function parseSeverities(text) {
    if (typeof text !== "string" || !text) return null;
    let vals;
    try {
      vals = JSON.parse(text);
    } catch {
      return null;
    }
    if (!Array.isArray(vals)) return null;
    const chosen = new Set(
      vals.filter((v) => typeof v === "string").map(normalizeSeverity)
    );
    const out = SEVERITY_ORDER.filter((s) => chosen.has(s));
    return out.length ? out : null;
  }
  function selectSealCandidates(rows, cutoffMs) {
    const flatIds = rows.filter((r) => r.shape === "flat").map((r) => r.scan_id);
    const protectedIds = new Set(flatIds.slice(-MIN_UNSEALED_FLAT_SCANS));
    const candidates = [];
    for (const r of rows) {
      if (protectedIds.has(r.scan_id)) break;
      const ts = parseTs(r.ts);
      if (ts === null || ts > cutoffMs) break;
      candidates.push(r);
    }
    return candidates;
  }
  function statsEqual(a, b) {
    if (isMissing(a) && isMissing(b)) return true;
    if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length || !ka.every((k) => kb.includes(k))) return false;
      return ka.every((k) => statsEqual(a[k], b[k]));
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((x, i) => statsEqual(x, b[i]));
    }
    return a === b;
  }
  function isMissing(v) {
    return v === null || v === void 0 || typeof v === "number" && Number.isNaN(v);
  }

  // src/domain/reconcile.ts
  var TAGS_PREFIX = "vulnerableAsset.tags.";
  function tagsJson(record) {
    const va = record["vulnerableAsset"];
    let tags = null;
    if (va && typeof va === "object" && !Array.isArray(va)) {
      const t = va["tags"];
      if (t && typeof t === "object" && !Array.isArray(t)) tags = t;
    }
    if (tags === null) {
      const flat = record["vulnerableAsset.tags"];
      if (flat && typeof flat === "object" && !Array.isArray(flat)) tags = flat;
    }
    if (tags === null) {
      const collected = {};
      for (const [k, v] of Object.entries(record)) {
        if (k.startsWith(TAGS_PREFIX) && clean(v) !== null) {
          collected[k.slice(TAGS_PREFIX.length)] = v;
        }
      }
      tags = collected;
    }
    const kept = {};
    for (const [k, v] of Object.entries(tags)) {
      if (clean(v) !== null || v === "") kept[String(k)] = v;
    }
    const keys = Object.keys(kept).sort();
    if (!keys.length) return null;
    const parts = keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(kept[k])}`);
    return `{${parts.join(", ")}}`;
  }
  function makeRow(record, key, sev2, firstSeen, scanId, scanTs, fixDate, fixObservedAt) {
    var _a;
    return {
      vuln_key: key,
      cve: (_a = clean(record["name"])) != null ? _a : null,
      severity: sev2,
      asset_id: field(record, "vulnerableAsset.id") || null,
      asset_name: field(record, "vulnerableAsset.name") || null,
      asset_type: field(record, "vulnerableAsset.type") || null,
      cloud: field(record, "vulnerableAsset.cloudPlatform") || null,
      subscription_name: field(record, "vulnerableAsset.subscriptionName") || null,
      subscription_ext_id: field(record, "vulnerableAsset.subscriptionExternalId", "vulnerableAsset.subscriptionId") || null,
      tags_json: tagsJson(record),
      first_seen: firstSeen,
      last_seen: scanTs,
      status: "OPEN",
      resolved_at: null,
      resolution_src: null,
      reopened_count: 0,
      first_scan_id: scanId,
      last_scan_id: scanId,
      fix_date: fixDate,
      fix_observed_at: fixObservedAt
    };
  }
  function reconcile(currentRecords, existingLedger, scanId, scanTs, prevScanId, options = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
    const {
      disappearanceMode = "scan_ts",
      prevScanTs = null,
      scannedSeverities = null,
      prevScanIdBySeverity: prevScanIdBySeverity2 = null
    } = options;
    const updated = {};
    for (const [key, row] of Object.entries(existingLedger)) updated[key] = { ...row };
    const seen = /* @__PURE__ */ new Set();
    const observations = [];
    let newCount = 0;
    let resolvedCount = 0;
    let reopenedCount = 0;
    const scanTsIso = (_a = toIso(parseTs(scanTs))) != null ? _a : String(scanTs);
    for (const rec of currentRecords) {
      const key = vulnKey(rec);
      if (seen.has(key)) continue;
      seen.add(key);
      const sev2 = normalizeSeverity(clean(rec["severity"]));
      const apiFirst = (_c = (_b = clean(rec["firstDetectedAt"])) != null ? _b : clean(rec["firstSeenAt"])) != null ? _c : clean(rec["createdAt"]);
      const apiStatus = String((_d = clean(rec["status"])) != null ? _d : "").toUpperCase();
      const apiResolved = (_f = (_e = clean(rec["resolvedAt"])) != null ? _e : clean(rec["remediatedAt"])) != null ? _f : clean(rec["fixedAt"]);
      const apiSaysResolved = present(apiResolved) || RESOLVED_STATUSES.has(apiStatus);
      const fixSignal = present(rec["fixedVersion"]) || present(rec["fixDate"]);
      const recFixDate = present(rec["fixDate"]) ? toIso(parseTs(rec["fixDate"])) : null;
      const seedFix = (r) => {
        if (r.fix_date == null && recFixDate !== null) r.fix_date = recFixDate;
        if (r.fix_observed_at == null && fixSignal) r.fix_observed_at = scanTsIso;
      };
      let row = updated[key];
      if (row === void 0) {
        const firstSeen = (_g = minIso(apiFirst, scanTsIso)) != null ? _g : scanTsIso;
        row = makeRow(rec, key, sev2, firstSeen, scanId, scanTsIso, recFixDate, fixSignal ? scanTsIso : null);
        updated[key] = row;
        newCount += 1;
      } else if (row.status === "RESOLVED" && !apiSaysResolved) {
        row.status = "OPEN";
        row.resolved_at = null;
        row.resolution_src = null;
        row.reopened_count = Number((_h = row.reopened_count) != null ? _h : 0) + 1;
        row.first_seen = (_i = minIso(apiFirst, scanTsIso)) != null ? _i : scanTsIso;
        row.last_seen = scanTsIso;
        row.last_scan_id = scanId;
        row.fix_date = null;
        row.fix_observed_at = null;
        seedFix(row);
        reopenedCount += 1;
      } else {
        if (row.status === "OPEN") {
          row.first_seen = (_j = minIso(row.first_seen, apiFirst)) != null ? _j : row.first_seen;
        }
        row.last_seen = scanTsIso;
        row.last_scan_id = scanId;
        seedFix(row);
      }
      row.severity = sev2;
      row.cve = (_k = clean(rec["name"])) != null ? _k : null;
      row.asset_id = field(rec, "vulnerableAsset.id") || row.asset_id;
      row.asset_name = field(rec, "vulnerableAsset.name") || row.asset_name;
      row.asset_type = field(rec, "vulnerableAsset.type") || row.asset_type;
      row.cloud = field(rec, "vulnerableAsset.cloudPlatform") || row.cloud;
      row.subscription_name = field(rec, "vulnerableAsset.subscriptionName") || row.subscription_name;
      row.subscription_ext_id = field(rec, "vulnerableAsset.subscriptionExternalId", "vulnerableAsset.subscriptionId") || row.subscription_ext_id;
      row.tags_json = (_l = tagsJson(rec)) != null ? _l : row.tags_json;
      if (apiSaysResolved && row.status === "OPEN") {
        row.status = "RESOLVED";
        row.resolved_at = present(apiResolved) ? toIso(parseTs(apiResolved)) : scanTsIso;
        row.resolution_src = "api";
        resolvedCount += 1;
      }
      observations.push({
        scan_id: scanId,
        vuln_key: key,
        present: 1,
        severity: sev2,
        status: row.status
      });
    }
    if (prevScanId !== null) {
      const scope = scannedSeverities !== null ? new Set(scannedSeverities) : null;
      for (const [key, row] of Object.entries(updated)) {
        if (seen.has(key) || row.status === "RESOLVED") continue;
        const sevRow = row.severity;
        if (scope !== null && (sevRow === null || !scope.has(sevRow))) {
          continue;
        }
        const expectedPrev = (_m = (prevScanIdBySeverity2 != null ? prevScanIdBySeverity2 : {})[sevRow != null ? sevRow : ""]) != null ? _m : prevScanId;
        if (row.last_scan_id !== expectedPrev) continue;
        if (disappearanceMode === "midpoint" && prevScanTs) {
          row.resolved_at = midpointIso(prevScanTs, scanTsIso);
        } else {
          row.resolved_at = scanTsIso;
        }
        row.status = "RESOLVED";
        row.resolution_src = "disappeared";
        resolvedCount += 1;
        observations.push({
          scan_id: scanId,
          vuln_key: key,
          present: 0,
          severity: row.severity,
          status: "RESOLVED"
        });
      }
    }
    return {
      ledger: updated,
      observations,
      deltas: {
        new_count: newCount,
        resolved_count: resolvedCount,
        reopened_count: reopenedCount
      }
    };
  }

  // src/domain/ledgerCore.ts
  function emptyState() {
    return { scans: [], ledger: {}, episodes: [] };
  }
  function scansAsc(scans) {
    return [...scans].sort((a, b) => {
      var _a, _b;
      const ta = (_a = parseTs(a.ts)) != null ? _a : 0;
      const tb = (_b = parseTs(b.ts)) != null ? _b : 0;
      if (ta !== tb) return ta - tb;
      return a.scan_id < b.scan_id ? -1 : a.scan_id > b.scan_id ? 1 : 0;
    });
  }
  function latestScan(scans) {
    const asc = scansAsc(scans);
    return asc.length ? asc[asc.length - 1] : null;
  }
  function prevScanIdBySeverity(scans) {
    const remaining = new Set(SEVERITY_ORDER);
    const mapping = {};
    const desc = scansAsc(scans).reverse();
    for (const r of desc) {
      const scope = parseSeverities(r.severities);
      const covered = scope === null ? [...remaining] : [...remaining].filter((s) => scope.includes(s));
      for (const sev2 of covered) mapping[sev2] = r.scan_id;
      covered.forEach((s) => remaining.delete(s));
      if (!remaining.size) break;
    }
    return Object.keys(mapping).length ? mapping : null;
  }
  function existingScanDeltas(scans, scanId) {
    const row = scans.find((r) => r.scan_id === scanId);
    if (!row) return null;
    return {
      new_count: row.new_count,
      resolved_count: row.resolved_count,
      reopened_count: row.reopened_count
    };
  }
  function reconcileEpisodeCollisions(state, updated, existingLedger, deltas, scanId) {
    var _a;
    const newKeys = Object.keys(updated).filter((k) => !(k in existingLedger));
    if (!newKeys.length) return;
    const episodeReopens = /* @__PURE__ */ new Map();
    for (const e of state.episodes) {
      if (e.superseded_by_scan === null && newKeys.includes(e.vuln_key)) {
        episodeReopens.set(e.vuln_key, e);
      }
    }
    for (const [key, episode] of episodeReopens) {
      const row = updated[key];
      if (row.status === "OPEN") {
        row.reopened_count = Number((_a = episode.reopened_count) != null ? _a : 0) + 1;
        deltas.new_count -= 1;
        deltas.reopened_count += 1;
        episode.superseded_by_scan = scanId;
      } else {
        delete updated[key];
        deltas.new_count -= 1;
        deltas.resolved_count -= 1;
      }
    }
  }
  function persistFlatScan(state, records, options) {
    var _a, _b, _c, _d;
    const scanId = options.scanId || nowIso(options.now);
    const scanTs = scanId;
    const disappearanceMode = (_a = options.disappearanceMode) != null ? _a : DISAPPEARANCE_RESOLUTION;
    const severitiesText = serializeSeverities((_b = options.scannedSeverities) != null ? _b : null);
    const scope = parseSeverities(severitiesText);
    const existing = existingScanDeltas(state.scans, scanId);
    if (existing !== null) return { deltas: existing, observations: [], scanRow: null };
    const prev = latestScan(state.scans);
    const prevScanId = prev ? prev.scan_id : null;
    const prevScanTs = prev ? prev.ts : null;
    const prevBySev = prevScanId !== null ? prevScanIdBySeverity(state.scans) : null;
    const existingLedger = state.ledger;
    const { ledger: updated, observations, deltas } = reconcile(
      records,
      existingLedger,
      scanId,
      scanTs,
      prevScanId,
      {
        disappearanceMode,
        prevScanTs,
        scannedSeverities: scope,
        prevScanIdBySeverity: prevBySev
      }
    );
    reconcileEpisodeCollisions(state, updated, existingLedger, deltas, scanId);
    const scanRow = {
      scan_id: scanId,
      ts: scanTs,
      mode: options.mode,
      shape: "flat",
      total: records.length,
      new_count: deltas.new_count,
      resolved_count: deltas.resolved_count,
      reopened_count: deltas.reopened_count,
      raw_ref: (_c = options.rawRef) != null ? _c : null,
      obs_ref: (_d = options.obsRef) != null ? _d : null,
      severities: severitiesText,
      sealed: 0
    };
    state.scans.push(scanRow);
    state.ledger = updated;
    return { deltas, observations, scanRow };
  }
  function persistGroupedScan(state, nodes, options) {
    var _a, _b;
    const scanId = options.scanId || nowIso(options.now);
    const zero = { new_count: 0, resolved_count: 0, reopened_count: 0 };
    if (existingScanDeltas(state.scans, scanId) !== null) {
      return { deltas: zero, scanRow: null };
    }
    const scanRow = {
      scan_id: scanId,
      ts: scanId,
      mode: options.mode,
      shape: "grouped",
      total: nodes.length,
      new_count: 0,
      resolved_count: 0,
      reopened_count: 0,
      raw_ref: (_a = options.rawRef) != null ? _a : null,
      obs_ref: null,
      severities: serializeSeverities((_b = options.scannedSeverities) != null ? _b : null),
      sealed: 0
    };
    state.scans.push(scanRow);
    return { deltas: zero, scanRow };
  }
  function reinsertScanRow(state, row) {
    state.scans.push({ ...row });
  }
  var DAY_MS3 = 864e5;
  var COMPACTED_ASSET3 = "(compacted)";
  var ROLLOUT_MS = parseTs(REMEDIATION_ROLLOUT_ISO);
  function baseRows(state, now) {
    const nowMs = now != null ? now : Date.now();
    const out = [];
    const withDerived = (row) => {
      var _a, _b;
      const first = parseTs(row.first_seen);
      const resolved = parseTs(row.resolved_at);
      const open = row.status === "OPEN";
      const fixAvailableAt = first !== null && ROLLOUT_MS !== null && first < ROLLOUT_MS ? row.first_seen : (_b = (_a = row.fix_date) != null ? _a : row.fix_observed_at) != null ? _b : null;
      const fixAvailMs = parseTs(fixAvailableAt);
      const actionableMs = fixAvailMs === null ? null : first === null ? fixAvailMs : Math.max(first, fixAvailMs);
      const actionableFrom = actionableMs === null ? null : toIso(actionableMs);
      return {
        ...row,
        mttr_days: first !== null && resolved !== null ? (resolved - first) / DAY_MS3 : null,
        age_days: resolved === null && first !== null ? (nowMs - first) / DAY_MS3 : null,
        fix_available_at: fixAvailableAt,
        actionable_from: actionableFrom,
        mttr_actionable_days: resolved !== null && actionableMs !== null ? (resolved - actionableMs) / DAY_MS3 : null,
        actionable_age_days: open && actionableMs !== null ? (nowMs - actionableMs) / DAY_MS3 : null,
        awaiting_vendor_fix: open && fixAvailableAt === null
      };
    };
    for (const row of Object.values(state.ledger)) out.push(withDerived(row));
    for (const e of state.episodes) {
      if (e.superseded_by_scan !== null) continue;
      if (e.vuln_key in state.ledger) continue;
      out.push(
        withDerived({
          vuln_key: e.vuln_key,
          cve: e.cve,
          severity: e.severity,
          asset_id: null,
          asset_name: COMPACTED_ASSET3,
          asset_type: null,
          cloud: null,
          first_seen: e.first_seen,
          last_seen: e.resolved_at,
          status: "RESOLVED",
          resolved_at: e.resolved_at,
          resolution_src: e.resolution_src,
          reopened_count: e.reopened_count,
          first_scan_id: null,
          last_scan_id: null,
          subscription_name: null,
          subscription_ext_id: null,
          tags_json: null,
          fix_date: e.fix_date,
          fix_observed_at: e.fix_observed_at
        })
      );
    }
    return out;
  }
  function severityCountsFromObservations(observations) {
    var _a;
    const counts = {};
    for (const o of observations) {
      if (o.present !== 1) continue;
      const sev2 = normalizeSeverity(o.severity);
      counts[sev2] = ((_a = counts[sev2]) != null ? _a : 0) + 1;
    }
    return counts;
  }

  // src/domain/trend.ts
  var DAY_MS4 = 864e5;
  function trendFromFrames(scans, base, severities = null) {
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    if (!scans.length || !rows.length) return [];
    const flatTs = scans.filter((s) => s["shape"] === "flat").map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) })).filter((t) => t.ms !== null).sort((a, b) => a.ms - b.ms);
    if (!flatTs.length) return [];
    const parsed = rows.map((r) => ({
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"]) ? r["mttr_days"] : null,
      sev: normalizeSeverity(r["severity"])
    }));
    const out = [];
    for (const ts of flatTs) {
      const resolvedMask = parsed.map((r) => r.resolvedAt !== null && r.resolvedAt <= ts.ms);
      const openMask = parsed.map(
        (r) => r.first !== null && r.first <= ts.ms && (r.resolvedAt === null || r.resolvedAt > ts.ms)
      );
      const resolvedMttr2 = parsed.filter((_, i) => resolvedMask[i]).map((r) => r.mttr).filter((m) => m !== null);
      const med = median(resolvedMttr2);
      const denom = resolvedMttr2.length;
      const within = parsed.filter(
        (r, i) => resolvedMask[i] && r.mttr !== null && SLA_TARGETS[r.sev] !== void 0 && r.mttr <= SLA_TARGETS[r.sev]
      ).length;
      const slaPct = denom ? within / denom * 100 : null;
      const p90s = [];
      for (const sev2 of SEVERITY_ORDER) {
        const ages = parsed.filter((r, i) => openMask[i] && r.sev === sev2).map((r) => (ts.ms - r.first) / DAY_MS4);
        if (ages.length) {
          const p = quantile(ages, 0.9);
          if (p !== null) p90s.push(p);
        }
      }
      const oldest = p90s.length ? Math.max(...p90s) : null;
      out.push({
        date: ts.iso,
        open: openMask.filter(Boolean).length,
        resolved: resolvedMask.filter(Boolean).length,
        median_days: med !== null ? Math.round(med * 1e3) / 1e3 : null,
        sla_pct: slaPct !== null ? Math.round(slaPct * 10) / 10 : null,
        oldest_open_days: oldest !== null ? Math.round(oldest * 1e3) / 1e3 : null
      });
    }
    return out;
  }
  function openBySeverityTrend(scans, base, severities = null) {
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    if (!scans.length || !rows.length) return [];
    const flatTs = scans.filter((s) => s["shape"] === "flat").map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) })).filter((t) => t.ms !== null).sort((a, b) => a.ms - b.ms);
    if (!flatTs.length) return [];
    const parsed = rows.map((r) => ({
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      sev: normalizeSeverity(r["severity"])
    }));
    return flatTs.map((ts) => {
      var _a;
      const bySev = {};
      for (const r of parsed) {
        const isOpen3 = r.first !== null && r.first <= ts.ms && (r.resolvedAt === null || r.resolvedAt > ts.ms);
        if (isOpen3) bySev[r.sev] = ((_a = bySev[r.sev]) != null ? _a : 0) + 1;
      }
      return { date: ts.iso, bySev };
    });
  }
  function openByGroupTrend(scans, base, keyOf, groups, opts = {}) {
    var _a, _b, _c;
    const severities = (_a = opts.severities) != null ? _a : null;
    const includeOther = (_b = opts.includeOther) != null ? _b : true;
    const otherLabel = (_c = opts.otherLabel) != null ? _c : "Other";
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    if (!scans.length || !rows.length) return [];
    const flatTs = scans.filter((s) => s["shape"] === "flat").map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) })).filter((t) => t.ms !== null).sort((a, b) => a.ms - b.ms);
    if (!flatTs.length) return [];
    const inGroup = new Set(groups);
    const parsed = rows.map((r) => {
      const raw = keyOf(r);
      const value = raw.trim() === "" ? "(none)" : raw;
      const known = inGroup.has(value);
      return {
        first: parseTs(r["first_seen"]),
        resolvedAt: parseTs(r["resolved_at"]),
        group: known ? value : otherLabel,
        kept: known || includeOther
      };
    });
    return flatTs.map((ts) => {
      var _a2;
      const byGroup = {};
      for (const r of parsed) {
        if (!r.kept) continue;
        const isOpen3 = r.first !== null && r.first <= ts.ms && (r.resolvedAt === null || r.resolvedAt > ts.ms);
        if (isOpen3) byGroup[r.group] = ((_a2 = byGroup[r.group]) != null ? _a2 : 0) + 1;
      }
      return { date: ts.iso, byGroup };
    });
  }
  function medianMttrByGroupTrend(scans, base, keyOf, groups, opts = {}) {
    var _a, _b, _c, _d;
    const severities = (_a = opts.severities) != null ? _a : null;
    const includeOther = (_b = opts.includeOther) != null ? _b : true;
    const otherLabel = (_c = opts.otherLabel) != null ? _c : "Other";
    const minMttrDays = (_d = opts.minMttrDays) != null ? _d : null;
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    if (!scans.length || !rows.length) return [];
    const flatTs = scans.filter((s) => s["shape"] === "flat").map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) })).filter((t) => t.ms !== null).sort((a, b) => a.ms - b.ms);
    if (!flatTs.length) return [];
    const inGroup = new Set(groups);
    const parsed = rows.map((r) => {
      const raw = keyOf(r);
      const value = raw.trim() === "" ? "(none)" : raw;
      const known = inGroup.has(value);
      return {
        resolvedAt: parseTs(r["resolved_at"]),
        mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"]) ? r["mttr_days"] : null,
        group: known ? value : otherLabel,
        folded: !known && includeOther,
        kept: known || includeOther
      };
    });
    const hasOther = parsed.some((r) => r.folded);
    const names = hasOther ? [...groups, otherLabel] : groups;
    return flatTs.map((ts) => {
      var _a2, _b2;
      const samples = {};
      for (const r of parsed) {
        if (!r.kept || r.mttr === null) continue;
        if (minMttrDays !== null && r.mttr <= minMttrDays) continue;
        if (r.resolvedAt === null || r.resolvedAt > ts.ms) continue;
        ((_b2 = samples[_a2 = r.group]) != null ? _b2 : samples[_a2] = []).push(r.mttr);
      }
      const byGroup = {};
      for (const name of names) {
        const s = samples[name];
        if (s && s.length) {
          const med = median(s);
          byGroup[name] = Math.round(med * 1e3) / 1e3;
        } else {
          byGroup[name] = null;
        }
      }
      return { date: ts.iso, byGroup };
    });
  }
  function trendFromBase(scans, base, severities = null, opts = {}) {
    const tag = (points, synthetic2) => points.map((p) => ({ ...p, reconstructed: synthetic2.has(p.date) }));
    if (!opts.backfill) return tag(trendFromFrames(scans, base, severities), /* @__PURE__ */ new Set());
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    const realFlatMs = scans.filter((s) => s["shape"] === "flat").map((s) => parseTs(s["ts"])).filter((t) => t !== null);
    const firstSeenMs = rows.map((r) => parseTs(r["first_seen"])).filter((t) => t !== null);
    const synthetic = [];
    const syntheticIso = /* @__PURE__ */ new Set();
    if (realFlatMs.length && firstSeenMs.length) {
      const firstScanDay = Math.floor(Math.min(...realFlatMs) / DAY_MS4) * DAY_MS4;
      const startDay = Math.floor(Math.min(...firstSeenMs) / DAY_MS4) * DAY_MS4;
      for (let day = startDay; day < firstScanDay; day += DAY_MS4) {
        const iso = toIso(day);
        if (iso === null) continue;
        synthetic.push({ ts: iso, shape: "flat" });
        syntheticIso.add(iso);
      }
    }
    return tag(trendFromFrames(synthetic.concat(scans), base, severities), syntheticIso);
  }
  function withTailMedian(points, base, thresholdDays, severities = null) {
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    const parsed = rows.map((r) => ({
      resolvedAt: parseTs(r["resolved_at"]),
      mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"]) ? r["mttr_days"] : null
    })).filter((r) => r.resolvedAt !== null && r.mttr !== null && r.mttr > thresholdDays);
    return points.map((p) => {
      const d = parseTs(p.date);
      const tail = d === null ? [] : parsed.filter((r) => r.resolvedAt <= d).map((r) => r.mttr);
      const med = median(tail);
      return { ...p, tail_median_days: med !== null ? Math.round(med * 1e3) / 1e3 : null };
    });
  }
  function withOpenPastSla(points, base, severities = null) {
    let rows = base;
    if (severities !== null && base.length) {
      const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
      rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
    }
    const parsed = rows.map((r) => ({
      first: parseTs(r["first_seen"]),
      resolvedAt: parseTs(r["resolved_at"]),
      sev: normalizeSeverity(r["severity"])
    }));
    return points.map((p) => {
      const d = parseTs(p.date);
      let breached = 0;
      if (d !== null) {
        for (const r of parsed) {
          const open = r.first !== null && r.first <= d && (r.resolvedAt === null || r.resolvedAt > d);
          if (!open) continue;
          const target = SLA_TARGETS[r.sev];
          if (target !== void 0 && (d - r.first) / DAY_MS4 > target) breached += 1;
        }
      }
      return { ...p, open_past_sla: breached };
    });
  }

  // src/domain/maintenance.ts
  var LedgerRebuildError = class extends Error {
  };
  var SealedScanError = class extends LedgerRebuildError {
  };
  function recordsFromPayload(payload) {
    var _a;
    return (_a = extractNodes(payload)) != null ? _a : [];
  }
  function loadReplayPayloads(rows, readPayload, missingMsg) {
    const replay = [];
    for (const r of rows) {
      if (r.sealed) continue;
      const payload = readPayload(r);
      if (payload === null && r.shape === "flat") {
        throw new LedgerRebuildError(missingMsg(r.scan_id));
      }
      replay.push({ row: r, payload });
    }
    return replay;
  }
  function replayScans(rebuilt, replay) {
    const observationsByScan = {};
    for (const { row, payload } of replay) {
      if (row.shape === "grouped") {
        if (payload === null) {
          reinsertScanRow(rebuilt, row);
        } else {
          persistGroupedScan(rebuilt, extractNodes(payload), {
            mode: row.mode,
            scanId: row.scan_id,
            scannedSeverities: parseSeverities(row.severities),
            rawRef: row.raw_ref
          });
        }
      } else {
        const { observations } = persistFlatScan(rebuilt, recordsFromPayload(payload), {
          mode: row.mode,
          scanId: row.scan_id,
          scannedSeverities: parseSeverities(row.severities),
          rawRef: row.raw_ref,
          obsRef: row.obs_ref
        });
        observationsByScan[row.scan_id] = observations;
      }
    }
    return observationsByScan;
  }
  function settledEpisodeRows(checkpointLedger, ledger, sealedIds) {
    var _a;
    const episodes = [];
    for (const cpRow of checkpointLedger) {
      if (cpRow.status !== "RESOLVED") continue;
      const live = ledger[cpRow.vuln_key];
      if (live === void 0 || live.status !== "RESOLVED" || live.resolved_at !== cpRow.resolved_at || !sealedIds.has((_a = live.last_scan_id) != null ? _a : "")) {
        continue;
      }
      episodes.push(live);
    }
    return episodes;
  }
  function toEpisodeRow(live, compactionId) {
    var _a;
    return {
      vuln_key: live.vuln_key,
      cve: live.cve,
      severity: live.severity,
      first_seen: live.first_seen,
      resolved_at: live.resolved_at,
      resolution_src: live.resolution_src,
      reopened_count: Number((_a = live.reopened_count) != null ? _a : 0),
      compaction_id: compactionId,
      superseded_by_scan: null,
      fix_date: live.fix_date,
      fix_observed_at: live.fix_observed_at
    };
  }
  function deleteScansCore(state, scanIds, readPayload, checkpoint, now) {
    var _a;
    const targets = new Set([...scanIds].filter(Boolean));
    const zero = { deleted: 0, scans: 0, tracked: 0 };
    if (!targets.size) {
      return { state, result: zero, observationsByScan: {} };
    }
    const rows = scansAsc(state.scans);
    const present2 = new Set(rows.filter((r) => targets.has(r.scan_id)).map((r) => r.scan_id));
    if (!present2.size) {
      return { state, result: zero, observationsByScan: {} };
    }
    const sealedTargets = rows.filter((r) => present2.has(r.scan_id) && r.sealed).map((r) => r.scan_id).sort();
    if (sealedTargets.length) {
      throw new SealedScanError(
        `Cannot delete sealed scan(s) ${sealedTargets.join(", ")}: they are part of the compacted baseline (their raw archives were pruned), so their effects can no longer be un-replayed.`
      );
    }
    const survivors = rows.filter((r) => !present2.has(r.scan_id));
    const replay = loadReplayPayloads(
      survivors,
      readPayload,
      (scanId) => `Cannot delete: the archived payload for surviving scan ${scanId} is missing, so the ledger can't be rebuilt.`
    );
    const rebuilt = {
      scans: survivors.filter((r) => r.sealed).map((r) => ({ ...r })),
      ledger: {},
      episodes: state.episodes.map((e) => ({ ...e, superseded_by_scan: null }))
    };
    if (checkpoint !== null) {
      const episodeKeys = new Set(state.episodes.map((e) => e.vuln_key));
      for (const row of (_a = checkpoint.ledger) != null ? _a : []) {
        if (!episodeKeys.has(row.vuln_key)) rebuilt.ledger[row.vuln_key] = { ...row };
      }
    }
    const observationsByScan = replayScans(rebuilt, replay);
    return {
      state: rebuilt,
      result: {
        deleted: present2.size,
        scans: rebuilt.scans.length,
        tracked: baseRows(rebuilt, now).length
      },
      observationsByScan
    };
  }
  function buildCheckpoint(rows, newly, prevCheckpoint, floorRow, readPayload) {
    var _a;
    const tmp = emptyState();
    if (prevCheckpoint !== null) {
      for (const row of (_a = prevCheckpoint.ledger) != null ? _a : []) tmp.ledger[row.vuln_key] = { ...row };
    }
    for (const r of rows) {
      if (r.sealed) tmp.scans.push({ ...r });
    }
    for (const r of newly) {
      const payload = readPayload(r);
      const scope = parseSeverities(r.severities);
      if (r.shape === "flat") {
        if (payload === null) {
          throw new LedgerRebuildError(
            `Cannot compact: the archived payload for scan ${r.scan_id} is missing or unreadable.`
          );
        }
        persistFlatScan(tmp, recordsFromPayload(payload), {
          mode: r.mode,
          scanId: r.scan_id,
          scannedSeverities: scope
        });
      } else if (payload === null) {
        reinsertScanRow(tmp, r);
      } else {
        persistGroupedScan(tmp, extractNodes(payload), {
          mode: r.mode,
          scanId: r.scan_id,
          scannedSeverities: scope
        });
      }
    }
    return {
      version: CHECKPOINT_VERSION,
      floor_scan_id: floorRow ? floorRow.scan_id : null,
      floor_ts: floorRow ? floorRow.ts : null,
      ledger: Object.values(tmp.ledger)
    };
  }
  function openAndResolved(state) {
    const out = [];
    for (const row of Object.values(state.ledger)) {
      out.push({
        vuln_key: row.vuln_key,
        severity: row.severity,
        first_seen: row.first_seen,
        status: row.status,
        resolved_at: row.resolved_at
      });
    }
    for (const e of state.episodes) {
      if (e.superseded_by_scan !== null || e.vuln_key in state.ledger) continue;
      out.push({
        vuln_key: e.vuln_key,
        severity: e.severity,
        first_seen: e.first_seen,
        status: "RESOLVED",
        resolved_at: e.resolved_at
      });
    }
    return out;
  }
  function trendOf(state, now) {
    return trendFromFrames(
      state.scans.map((s) => ({ ts: s.ts, shape: s.shape })),
      baseRows(state, now).map((r) => ({
        severity: r.severity,
        first_seen: r.first_seen,
        resolved_at: r.resolved_at,
        mttr_days: r.mttr_days
      }))
    );
  }
  function compactLedgerCore(state, retentionDays, prevCheckpoint, readPayload, options) {
    var _a, _b;
    const dryRun = Boolean(options.dryRun);
    const result = {
      no_op: true,
      dry_run: dryRun,
      scans_sealed: 0,
      episodes_created: 0,
      observations_pruned: 0,
      archive_bytes_freed: 0,
      db_bytes_freed: 0,
      floor_scan_id: null,
      floor_ts: null
    };
    const noOp = {
      result,
      checkpoint: null,
      newly: [],
      state: null,
      compactionId: null
    };
    if (retentionDays === null) return noOp;
    const days = Math.max(Math.trunc(retentionDays), RETENTION_MIN_DAYS);
    const nowMs = (_a = options.now) != null ? _a : Date.now();
    const cutoff = nowMs - days * 864e5;
    const rows = scansAsc(state.scans);
    if (!rows.length) return noOp;
    const candidates = selectSealCandidates(rows, cutoff);
    const sealedPrefix = rows.filter((r) => r.sealed);
    const candidatePrefixIds = candidates.slice(0, sealedPrefix.length).map((r) => r.scan_id);
    if (JSON.stringify(candidatePrefixIds) !== JSON.stringify(sealedPrefix.map((r) => r.scan_id))) {
      return noOp;
    }
    const newly = candidates.filter((r) => !r.sealed);
    if (!newly.length) return noOp;
    const flatCandidates = candidates.filter((r) => r.shape === "flat");
    const floorRow = flatCandidates.length ? flatCandidates[flatCandidates.length - 1] : null;
    const checkpoint = buildCheckpoint(rows, newly, prevCheckpoint, floorRow, readPayload);
    const sealedIds = new Set(candidates.map((r) => r.scan_id));
    const episodes = settledEpisodeRows(checkpoint.ledger, state.ledger, sealedIds);
    const newlyIds = newly.map((r) => r.scan_id);
    const obsCount = newlyIds.reduce(
      (acc, id) => {
        var _a2, _b2;
        return acc + ((_b2 = (_a2 = options.obsCountByScan) == null ? void 0 : _a2[id]) != null ? _b2 : 0);
      },
      0
    );
    result.no_op = false;
    result.scans_sealed = newly.length;
    result.episodes_created = episodes.length;
    result.observations_pruned = obsCount;
    result.archive_bytes_freed = (_b = options.archiveBytes) != null ? _b : 0;
    result.floor_scan_id = checkpoint.floor_scan_id;
    result.floor_ts = checkpoint.floor_ts;
    if (dryRun) return { result, checkpoint, newly, state: null, compactionId: null };
    const beforeMttr = mttrFromLedger(openAndResolved(state), { now: nowMs });
    const beforeTrend = trendOf(state, nowMs);
    const applied = {
      scans: state.scans.map(
        (r) => newlyIds.includes(r.scan_id) ? { ...r, sealed: 1, raw_ref: null, obs_ref: null } : { ...r }
      ),
      ledger: {},
      episodes: [
        ...state.episodes.map((e) => ({ ...e })),
        ...episodes.map((e) => toEpisodeRow(e, options.compactionId))
      ]
    };
    const converted = new Set(episodes.map((e) => e.vuln_key));
    for (const [key, row] of Object.entries(state.ledger)) {
      if (!converted.has(key)) applied.ledger[key] = { ...row };
    }
    const afterMttr = mttrFromLedger(openAndResolved(applied), { now: nowMs });
    const afterTrend = trendOf(applied, nowMs);
    if (!statsEqual(
      { perSev: beforeMttr.perSev, overall: beforeMttr.overall },
      { perSev: afterMttr.perSev, overall: afterMttr.overall }
    ) || !statsEqual(beforeTrend, afterTrend)) {
      throw new LedgerRebuildError(
        "Compaction aborted: MTTR/SLA/trend stats would change \u2014 rolled back."
      );
    }
    return { result, checkpoint, newly, state: applied, compactionId: options.compactionId };
  }
  function compactionRow(plan, checkpointRef, now) {
    return {
      compaction_id: plan.compactionId,
      ts: nowIso(now),
      floor_scan_id: plan.result.floor_scan_id,
      floor_ts: plan.result.floor_ts,
      scans_sealed: plan.result.scans_sealed,
      episodes_created: plan.result.episodes_created,
      observations_pruned: plan.result.observations_pruned,
      archive_bytes_freed: plan.result.archive_bytes_freed,
      db_bytes_freed: plan.result.db_bytes_freed,
      checkpoint_ref: checkpointRef
    };
  }

  // src/domain/importMerge.ts
  var MIGRATION_KIND = "wiz-sidekick-migration";
  var MIGRATION_VERSION = 1;
  var MAX_SCANS = 500;
  var MAX_LEDGER_ROWS = 2e5;
  var MAX_EPISODES = 2e5;
  var MAX_HISTORY_ROWS = 5e3;
  var ImportValidationError = class extends Error {
  };
  function asArray(value, name) {
    if (value === void 0 || value === null) return [];
    if (!Array.isArray(value)) {
      throw new ImportValidationError(`Bundle field "${name}" must be a list.`);
    }
    for (const item of value) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new ImportValidationError(`Bundle field "${name}" must contain objects.`);
      }
    }
    return value;
  }
  function validateBundle(data) {
    var _a;
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new ImportValidationError("The uploaded file is not a migration bundle.");
    }
    const rec = data;
    if (rec["kind"] !== MIGRATION_KIND) {
      throw new ImportValidationError(
        `Not a migration bundle (kind ${JSON.stringify((_a = rec["kind"]) != null ? _a : null)}).`
      );
    }
    const version = Number(rec["version"]);
    if (version !== MIGRATION_VERSION) {
      throw new ImportValidationError(
        `Unsupported bundle version ${rec["version"]} \u2014 this app understands version ${MIGRATION_VERSION}. The bundle may come from a newer exporter.`
      );
    }
    const scans = asArray(rec["scans"], "scans");
    const ledger = asArray(rec["ledger"], "ledger");
    const episodes = asArray(rec["episodes"], "episodes");
    const mttrHistory = asArray(rec["mttr_history"], "mttr_history");
    if (scans.length > MAX_SCANS) {
      throw new ImportValidationError(
        `Bundle has ${scans.length} scans \u2014 over the ${MAX_SCANS}-scan import limit.`
      );
    }
    if (ledger.length > MAX_LEDGER_ROWS) {
      throw new ImportValidationError(
        `Bundle has ${ledger.length} ledger rows \u2014 over the ${MAX_LEDGER_ROWS}-row limit.`
      );
    }
    if (episodes.length > MAX_EPISODES) {
      throw new ImportValidationError(
        `Bundle has ${episodes.length} episodes \u2014 over the ${MAX_EPISODES}-row limit.`
      );
    }
    if (mttrHistory.length > MAX_HISTORY_ROWS) {
      throw new ImportValidationError(
        `Bundle has ${mttrHistory.length} history rows \u2014 over the ${MAX_HISTORY_ROWS}-row limit.`
      );
    }
    for (const s of scans) {
      if (typeof s["scan_id"] !== "string" || !s["scan_id"] || typeof s["ts"] !== "string" || !s["ts"]) {
        throw new ImportValidationError("Every bundle scan needs string scan_id and ts.");
      }
    }
    for (const [name, rows] of [["ledger", ledger], ["episodes", episodes]]) {
      for (const r of rows) {
        if (typeof r["vuln_key"] !== "string" || !r["vuln_key"]) {
          throw new ImportValidationError(`Every bundle ${name} row needs a string vuln_key.`);
        }
      }
    }
    return {
      kind: MIGRATION_KIND,
      version,
      exported_at: typeof rec["exported_at"] === "string" ? rec["exported_at"] : null,
      scans,
      ledger,
      episodes,
      mttr_history: mttrHistory
    };
  }
  var str = (v) => v === null || v === void 0 || v === "" ? null : String(v);
  function coerceScan(r) {
    var _a, _b, _c, _d, _e;
    return {
      scan_id: String(r["scan_id"]),
      ts: String(r["ts"]),
      mode: String((_a = r["mode"]) != null ? _a : "import"),
      shape: r["shape"] === "grouped" ? "grouped" : "flat",
      total: Number((_b = r["total"]) != null ? _b : 0),
      new_count: Number((_c = r["new_count"]) != null ? _c : 0),
      resolved_count: Number((_d = r["resolved_count"]) != null ? _d : 0),
      reopened_count: Number((_e = r["reopened_count"]) != null ? _e : 0),
      raw_ref: null,
      obs_ref: null,
      severities: str(r["severities"]),
      sealed: 1
    };
  }
  function coerceLedger(r) {
    var _a, _b;
    return {
      vuln_key: String(r["vuln_key"]),
      cve: str(r["cve"]),
      severity: str(r["severity"]),
      asset_id: str(r["asset_id"]),
      asset_name: str(r["asset_name"]),
      asset_type: str(r["asset_type"]),
      cloud: str(r["cloud"]),
      first_seen: str(r["first_seen"]),
      last_seen: str(r["last_seen"]),
      status: String((_a = r["status"]) != null ? _a : "OPEN"),
      resolved_at: str(r["resolved_at"]),
      resolution_src: str(r["resolution_src"]),
      reopened_count: Number((_b = r["reopened_count"]) != null ? _b : 0),
      first_scan_id: str(r["first_scan_id"]),
      last_scan_id: str(r["last_scan_id"]),
      subscription_name: str(r["subscription_name"]),
      subscription_ext_id: str(r["subscription_ext_id"]),
      tags_json: str(r["tags_json"]),
      fix_date: str(r["fix_date"]),
      fix_observed_at: str(r["fix_observed_at"])
    };
  }
  function coerceEpisode(r) {
    var _a, _b;
    return {
      vuln_key: String(r["vuln_key"]),
      cve: str(r["cve"]),
      severity: str(r["severity"]),
      first_seen: str(r["first_seen"]),
      resolved_at: str(r["resolved_at"]),
      resolution_src: str(r["resolution_src"]),
      reopened_count: Number((_a = r["reopened_count"]) != null ? _a : 0),
      compaction_id: String((_b = r["compaction_id"]) != null ? _b : "import"),
      superseded_by_scan: str(r["superseded_by_scan"]),
      fix_date: str(r["fix_date"]),
      fix_observed_at: str(r["fix_observed_at"])
    };
  }
  function importBundleCore(state, bundle, readPayload, options) {
    const existingRows = scansAsc(state.scans);
    const sealedExisting = existingRows.filter((r) => r.sealed).map((r) => r.scan_id);
    if (sealedExisting.length) {
      throw new ImportValidationError(
        `This ledger already has compacted (sealed) history (${sealedExisting.join(", ")}) \u2014 two compacted histories can't be merged. Import into a ledger that has never been compacted.`
      );
    }
    const existingIds = new Set(existingRows.map((r) => r.scan_id));
    const seen = /* @__PURE__ */ new Set();
    const imported = [];
    let skipped = 0;
    for (const raw of bundle.scans) {
      const row = coerceScan(raw);
      if (seen.has(row.scan_id) || existingIds.has(row.scan_id)) {
        skipped += 1;
        continue;
      }
      seen.add(row.scan_id);
      imported.push(row);
    }
    const importedAsc = scansAsc(imported);
    const badTs = importedAsc.filter((r) => parseTs(r.ts) === null).map((r) => r.scan_id);
    if (badTs.length) {
      throw new ImportValidationError(
        `Bundle scan(s) ${badTs.join(", ")} have unparseable timestamps.`
      );
    }
    if (importedAsc.length && existingRows.length) {
      const newestImported = importedAsc[importedAsc.length - 1];
      const oldestExisting = existingRows[0];
      const newestMs = parseTs(newestImported.ts);
      const oldestMs = parseTs(oldestExisting.ts);
      if (oldestMs === null || newestMs === null || newestMs >= oldestMs) {
        throw new ImportValidationError(
          `Imported history must be strictly older than this ledger's: bundle scan ${newestImported.scan_id} is not older than existing scan ${oldestExisting.scan_id}. Delete the overlapping scans on one side first.`
        );
      }
    }
    const importedIds = new Set(importedAsc.map((r) => r.scan_id));
    const importedCount = importedAsc.length;
    const rebuilt = {
      scans: importedAsc,
      ledger: {},
      episodes: bundle.episodes.map(coerceEpisode)
    };
    for (const raw of bundle.ledger) {
      const row = coerceLedger(raw);
      rebuilt.ledger[row.vuln_key] = row;
    }
    const vulnsImported = Object.keys(rebuilt.ledger).length;
    const flats = importedAsc.filter((r) => r.shape === "flat");
    const floorRow = flats.length ? flats[flats.length - 1] : null;
    const checkpoint = {
      version: CHECKPOINT_VERSION,
      floor_scan_id: floorRow ? floorRow.scan_id : null,
      floor_ts: floorRow ? floorRow.ts : null,
      ledger: Object.values(rebuilt.ledger).map((r) => ({ ...r }))
    };
    const replay = loadReplayPayloads(
      existingRows,
      readPayload,
      (scanId) => `Cannot import: the archived payload for existing scan ${scanId} is missing, so it can't be replayed over the imported history.`
    );
    const observationsByScan = replayScans(rebuilt, replay);
    const converted = settledEpisodeRows(checkpoint.ledger, rebuilt.ledger, importedIds);
    for (const live of converted) {
      rebuilt.episodes.push(toEpisodeRow(live, options.compactionId));
      delete rebuilt.ledger[live.vuln_key];
    }
    return {
      state: rebuilt,
      checkpoint,
      observationsByScan,
      counts: {
        scans_imported: importedCount,
        scans_skipped: skipped,
        vulns_imported: vulnsImported,
        episodes_imported: bundle.episodes.length,
        episodes_converted: converted.length,
        scans_replayed: replay.length
      }
    };
  }
  function mergeMttrHistory(existing, imported) {
    var _a, _b, _c, _d, _e;
    const byDate = /* @__PURE__ */ new Map();
    for (const r of existing) {
      const date = r["date"];
      if (typeof date === "string" && !Number.isNaN(Date.parse(date))) {
        byDate.set(date.slice(0, 10), r);
      }
    }
    let added = 0;
    let skipped = 0;
    for (const r of imported) {
      const date = r["date"];
      if (typeof date !== "string" || Number.isNaN(Date.parse(date))) {
        skipped += 1;
        continue;
      }
      const key = date.slice(0, 10);
      if (byDate.has(key)) {
        skipped += 1;
        continue;
      }
      byDate.set(key, {
        date: key,
        median_days: Number((_a = r["median_days"]) != null ? _a : 0),
        resolved: Number((_b = r["resolved"]) != null ? _b : 0),
        open: Number((_c = r["open"]) != null ? _c : 0),
        total: Number((_d = r["total"]) != null ? _d : 0),
        sla_pct: r["sla_pct"] === null || r["sla_pct"] === void 0 ? null : Number(r["sla_pct"]),
        oldest_open_days: r["oldest_open_days"] === null || r["oldest_open_days"] === void 0 ? null : Number(r["oldest_open_days"]),
        open_past_sla: (_e = r["open_past_sla"]) != null ? _e : null
      });
      added += 1;
    }
    const rows = [...byDate.values()].sort(
      (a, b) => String(a["date"]) < String(b["date"]) ? -1 : String(a["date"]) > String(b["date"]) ? 1 : 0
    );
    return { rows, added, skipped };
  }

  // src/domain/insights.ts
  var EPSS_PRIORITY_THRESHOLD = 0.1;
  var AGE_BUCKET_EDGES = [7, 30, 90];
  var WIDE_KEY = "vulnerableAsset.hasWideInternetExposure";
  var LIMITED_KEY = "vulnerableAsset.hasLimitedInternetExposure";
  function isOpen2(status) {
    return !RESOLVED_STATUSES.has(String(status != null ? status : "").toUpperCase());
  }
  function sev(r) {
    const s = r["_sev"];
    return typeof s === "string" && s ? s : normalizeSeverity(r["severity"]);
  }
  function epssOf(r) {
    const v = r["epssProbability"];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  function severityStats(records) {
    var _a;
    const out = {};
    for (const r of records) {
      const s = sev(r);
      const stat = (_a = out[s]) != null ? _a : out[s] = { total: 0, open: 0, resolved: 0 };
      stat.total += 1;
      if (isOpen2(r["status"])) stat.open += 1;
      else stat.resolved += 1;
    }
    return out;
  }
  function exploitSummary(records) {
    const out = {
      open: 0,
      kev: 0,
      exploit: 0,
      highEpss: 0,
      internetExposed: 0,
      exposureKnown: records.some((r) => WIDE_KEY in r && r[WIDE_KEY] !== void 0)
    };
    for (const r of records) {
      if (!isOpen2(r["status"])) continue;
      out.open += 1;
      if (r["hasCisaKevExploit"] === true) out.kev += 1;
      if (r["hasExploit"] === true) out.exploit += 1;
      const epss = epssOf(r);
      if (epss !== null && epss >= EPSS_PRIORITY_THRESHOLD) out.highEpss += 1;
      if (r[WIDE_KEY] === true || r[LIMITED_KEY] === true) out.internetExposed += 1;
    }
    return out;
  }
  function ageBuckets(rows) {
    const perSev = {};
    let totalOpen = 0;
    for (const row of rows) {
      if (!isOpen2(row.status)) continue;
      const age = row.age_days;
      if (typeof age !== "number" || !Number.isFinite(age)) continue;
      const bucket = age <= AGE_BUCKET_EDGES[0] ? 0 : age <= AGE_BUCKET_EDGES[1] ? 1 : age <= AGE_BUCKET_EDGES[2] ? 2 : 3;
      const s = normalizeSeverity(row.severity);
      if (!perSev[s]) perSev[s] = [0, 0, 0, 0];
      perSev[s][bucket] += 1;
      totalOpen += 1;
    }
    return { perSev, totalOpen };
  }
  var AGED_OPEN_EDGE = AGE_BUCKET_EDGES[2];
  function openAge2(row) {
    if (!isOpen2(row.status)) return null;
    const age = row.age_days;
    return typeof age === "number" && Number.isFinite(age) ? age : null;
  }
  function rankGroups(rows, keyFn, topN, meta) {
    const groups = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const age = openAge2(row);
      if (age === null) continue;
      const raw = keyFn(row);
      const key = raw && raw.trim() !== "" ? raw : "(none)";
      let g = groups.get(key);
      if (!g) groups.set(key, g = { key, agedCount: 0, openCount: 0, oldestDays: 0, ...meta ? meta(row) : {} });
      g.openCount += 1;
      if (age > AGED_OPEN_EDGE) g.agedCount += 1;
      if (age > g.oldestDays) g.oldestDays = age;
    }
    return [...groups.values()].sort((a, b) => b.agedCount - a.agedCount || b.oldestDays - a.oldestDays || a.key.localeCompare(b.key)).slice(0, topN);
  }
  function oldestOpen(rows, topN = 7) {
    const findings = rows.map((r) => ({ r, age: openAge2(r) })).filter((x) => x.age !== null).sort((a, b) => b.age - a.age).slice(0, topN).map(({ r, age }) => ({
      cve: r.cve,
      asset: r.asset_name,
      subscription: r.subscription_name,
      severity: normalizeSeverity(r.severity),
      ageDays: age
    }));
    return {
      findings,
      byAsset: rankGroups(rows, (r) => {
        var _a;
        return String((_a = r.asset_name) != null ? _a : "");
      }, topN, (r) => {
        var _a, _b;
        return {
          subscription: String((_a = r.subscription_name) != null ? _a : ""),
          domain: String((_b = r._domain) != null ? _b : "")
        };
      }),
      bySupportGroup: rankGroups(rows, (r) => {
        var _a;
        return String((_a = r._supportGroup) != null ? _a : "");
      }, topN),
      byDomain: rankGroups(rows, (r) => {
        var _a;
        return String((_a = r._domain) != null ? _a : "");
      }, topN)
    };
  }
  function movement(baseRows2, latestFlatScan, scanCount) {
    if (!latestFlatScan) {
      return { newCount: 0, resolvedCount: 0, reopenedCount: 0, persisting: 0, hasPrevious: scanCount > 1 };
    }
    let persisting = 0;
    for (const row of baseRows2) {
      if (!isOpen2(row.status)) continue;
      if (row.last_scan_id === latestFlatScan.scan_id && row.first_scan_id !== latestFlatScan.scan_id) {
        persisting += 1;
      }
    }
    return {
      newCount: latestFlatScan.new_count,
      resolvedCount: latestFlatScan.resolved_count,
      reopenedCount: latestFlatScan.reopened_count,
      persisting,
      hasPrevious: scanCount > 1
    };
  }
  var GROUP_COLUMNS = {
    domain: "_domain",
    supportGroup: "_supportGroup",
    asset: "vulnerableAsset.name",
    atype: "vulnerableAsset.type",
    cloud: "vulnerableAsset.cloudPlatform",
    os: "vulnerableAsset.operatingSystem",
    subscription: "vulnerableAsset.subscriptionName",
    cve: "name"
  };
  var GROUP_BASE_FIELDS = {
    domain: "_domain",
    supportGroup: "_supportGroup",
    asset: "asset_name",
    atype: "asset_type",
    cloud: "cloud",
    subscription: "subscription_name",
    cve: "cve"
  };
  function groupTree(records, keys, perLevelCap = 20) {
    if (!keys.length || !records.length) return [];
    const [key, ...rest] = keys;
    const column = GROUP_COLUMNS[key];
    if (!column) return [];
    const buckets = /* @__PURE__ */ new Map();
    for (const r of records) {
      const raw = r[column];
      const k = raw === null || raw === void 0 || String(raw).trim() === "" ? "(none)" : String(raw);
      let arr = buckets.get(k);
      if (!arr) buckets.set(k, arr = []);
      arr.push(r);
    }
    const rows = [...buckets.entries()].map(([k, recs]) => {
      var _a, _b;
      const assets = /* @__PURE__ */ new Set();
      const sevCounts = {};
      let open = 0;
      let kev = false;
      let exploit = false;
      for (const r of recs) {
        if (isOpen2(r["status"])) open += 1;
        const s = sev(r);
        sevCounts[s] = ((_a = sevCounts[s]) != null ? _a : 0) + 1;
        const a = String((_b = r["vulnerableAsset.name"]) != null ? _b : "");
        if (a) assets.add(a);
        if (r["hasCisaKevExploit"] === true) kev = true;
        if (r["hasExploit"] === true) exploit = true;
      }
      const node = {
        key: k,
        dim: key,
        total: recs.length,
        open,
        assets: assets.size,
        sevCounts,
        kev,
        exploit,
        children: []
      };
      return { recs, node };
    });
    rows.sort((a, b) => b.node.total - a.node.total || a.node.key.localeCompare(b.node.key));
    const kept = rows.slice(0, perLevelCap);
    if (rest.length) {
      for (const row of kept) row.node.children = groupTree(row.recs, rest, perLevelCap);
    }
    return kept.map((row) => row.node);
  }

  // src/domain/importShard.ts
  var MANIFEST_KIND = "wiz-sidekick-migration-manifest";
  function beginImportSession(rawManifest) {
    var _a, _b, _c, _d, _e;
    if (rawManifest === null || typeof rawManifest !== "object" || Array.isArray(rawManifest)) {
      throw new ImportValidationError("The uploaded file is not a migration manifest.");
    }
    const rec = rawManifest;
    if (rec["kind"] !== MANIFEST_KIND) {
      throw new ImportValidationError(
        `Not a migration manifest (kind ${JSON.stringify((_a = rec["kind"]) != null ? _a : null)}).`
      );
    }
    const shardCount = Number(rec["shard_count"]);
    if (!Number.isInteger(shardCount) || shardCount < 0) {
      throw new ImportValidationError(`Manifest shard_count ${rec["shard_count"]} is invalid.`);
    }
    const rawScans = Array.isArray(rec["scans"]) ? rec["scans"] : [];
    const rawHistory = Array.isArray(rec["mttr_history"]) ? rec["mttr_history"] : [];
    const seen = /* @__PURE__ */ new Set();
    const sealed = [];
    for (const raw of rawScans) {
      if (typeof raw["scan_id"] !== "string" || !raw["scan_id"] || typeof raw["ts"] !== "string" || !raw["ts"]) {
        throw new ImportValidationError("Every manifest scan needs string scan_id and ts.");
      }
      if (seen.has(raw["scan_id"])) continue;
      seen.add(raw["scan_id"]);
      sealed.push(coerceScan(raw));
    }
    const sealedAsc = scansAsc(sealed);
    const badTs = sealedAsc.filter((r) => parseTs(r.ts) === null).map((r) => r.scan_id);
    if (badTs.length) {
      throw new ImportValidationError(`Manifest scan(s) ${badTs.join(", ")} have unparseable timestamps.`);
    }
    const flats = sealedAsc.filter((r) => r.shape === "flat");
    const floorRow = flats.length ? flats[flats.length - 1] : null;
    return {
      manifest: {
        scans: rawScans,
        mttr_history: rawHistory,
        shard_count: shardCount,
        session_id: typeof rec["session_id"] === "string" ? rec["session_id"] : null,
        totals: {
          ledger: Number((_c = (_b = rec["totals"]) == null ? void 0 : _b["ledger"]) != null ? _c : 0),
          episodes: Number((_e = (_d = rec["totals"]) == null ? void 0 : _d["episodes"]) != null ? _e : 0)
        }
      },
      sealedScans: sealedAsc,
      sealedIds: new Set(sealedAsc.map((r) => r.scan_id)),
      floorScanId: floorRow ? floorRow.scan_id : null,
      floorTs: floorRow ? floorRow.ts : null
    };
  }
  function applyShardCore(shard, ctx) {
    var _a, _b, _c, _d;
    const ledgerRows = [];
    const episodeRows = [];
    const checkpointRows = [];
    let converted = 0;
    for (const raw of (_a = shard.ledger) != null ? _a : []) {
      const row = coerceLedger(raw);
      checkpointRows.push(row);
      if (row.status === "RESOLVED" && ctx.sealedIds.has((_b = row.last_scan_id) != null ? _b : "")) {
        episodeRows.push(toEpisodeRow(row, ctx.compactionId));
        converted += 1;
      } else {
        ledgerRows.push(row);
      }
    }
    for (const raw of (_c = shard.episodes) != null ? _c : []) {
      episodeRows.push(coerceEpisode(raw));
    }
    return {
      ledgerRows,
      episodeRows,
      checkpointRows,
      vulnsImported: checkpointRows.length,
      episodesImported: ((_d = shard.episodes) != null ? _d : []).length,
      episodesConverted: converted
    };
  }
  function checkpointManifest(floorScanId, floorTs, parts) {
    return { version: CHECKPOINT_VERSION, floor_scan_id: floorScanId, floor_ts: floorTs, parts };
  }

  // src/server/serverCache.ts
  var VERSION_PROP = "DATA_VERSION";
  var KEY_PREFIX = "wsk";
  var CHUNK_CHARS = 9e4;
  var DEFAULT_TTL_SEC = 21600;
  function dataVersion() {
    var _a;
    return (_a = getProp(VERSION_PROP)) != null ? _a : "0";
  }
  function bumpDataVersion() {
    setProp(VERSION_PROP, String(Date.now()));
  }
  function cacheKey(name, params, version) {
    const paramsHash = sha1Hex(JSON.stringify(params != null ? params : null)).slice(0, 12);
    return `${KEY_PREFIX}:${version}:${name}:${paramsHash}`;
  }
  function splitChunks(s, size = CHUNK_CHARS) {
    const out = [];
    for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    return out.length ? out : [""];
  }
  function cachePutJson(key, value, ttlSec = DEFAULT_TTL_SEC, chunkChars = CHUNK_CHARS) {
    const json = JSON.stringify(value);
    const gz = Utilities.gzip(Utilities.newBlob(json, "application/json"));
    const packed = Utilities.base64Encode(gz.getBytes());
    const chunks = splitChunks(packed, chunkChars);
    const entries = { [`${key}:m`]: String(chunks.length) };
    chunks.forEach((c, i) => {
      entries[`${key}:${i}`] = c;
    });
    CacheService.getScriptCache().putAll(entries, ttlSec);
  }
  function cacheGetJson(key) {
    const cache = CacheService.getScriptCache();
    const meta = cache.get(`${key}:m`);
    if (!meta) return void 0;
    const n = Number(meta);
    if (!Number.isInteger(n) || n < 1) return void 0;
    const names = [];
    for (let i = 0; i < n; i++) names.push(`${key}:${i}`);
    const got = cache.getAll(names);
    let packed = "";
    for (const name of names) {
      const chunk = got[name];
      if (chunk === void 0 || chunk === null) return void 0;
      packed += chunk;
    }
    const bytes = Utilities.base64Decode(packed);
    const json = Utilities.ungzip(
      Utilities.newBlob(bytes, "application/x-gzip")
    ).getDataAsString("UTF-8");
    return JSON.parse(json);
  }
  function cached(name, params, compute, ttlSec = DEFAULT_TTL_SEC) {
    let key = null;
    try {
      key = cacheKey(name, params, dataVersion());
      const hit = cacheGetJson(key);
      if (hit !== void 0) return hit;
    } catch (e) {
      console.warn(`Cache read failed for ${name}: ${e}`);
      key = null;
    }
    const value = compute();
    if (key) {
      try {
        cachePutJson(key, value, ttlSec);
      } catch (e) {
        console.warn(`Cache write failed for ${name}: ${e}`);
      }
    }
    return value;
  }

  // src/server/historyStore.ts
  function todayIso(now) {
    return new Date(now != null ? now : Date.now()).toISOString().slice(0, 10);
  }
  function recordSnapshot(medianDays, resolved = 0, open = 0, counts = null, when = null, slaPct = null, oldestOpenDays = null, openPastSla2 = null) {
    try {
      const date = when != null ? when : todayIso();
      const records = loadHistory().filter((r) => r.date !== date);
      records.push({
        date,
        median_days: Math.round(medianDays * 1e3) / 1e3,
        resolved: Math.trunc(resolved),
        open: Math.trunc(open),
        total: counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0,
        sla_pct: slaPct !== null ? Math.round(slaPct * 10) / 10 : null,
        oldest_open_days: oldestOpenDays !== null ? Math.round(oldestOpenDays * 1e3) / 1e3 : null,
        open_past_sla: openPastSla2 === null ? null : Math.trunc(openPastSla2)
      });
      records.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      overwrite(TABS.mttrHistory, records);
      bumpDataVersion();
      return true;
    } catch (e) {
      console.warn(`Failed to write MTTR history: ${e}`);
      return false;
    }
  }
  function importHistory(imported) {
    const { rows, added, skipped } = mergeMttrHistory(
      loadHistory(),
      imported
    );
    if (added) {
      overwrite(TABS.mttrHistory, rows);
      bumpDataVersion();
    }
    return { added, skipped };
  }
  function loadHistory() {
    var _a, _b, _c, _d;
    const rows = readAll(TABS.mttrHistory);
    const out = [];
    for (const r of rows) {
      const date = r["date"];
      if (typeof date !== "string" || Number.isNaN(Date.parse(date))) continue;
      out.push({
        date: date.slice(0, 10),
        median_days: Number((_a = r["median_days"]) != null ? _a : 0),
        resolved: Number((_b = r["resolved"]) != null ? _b : 0),
        open: Number((_c = r["open"]) != null ? _c : 0),
        total: Number((_d = r["total"]) != null ? _d : 0),
        sla_pct: r["sla_pct"] === null ? null : Number(r["sla_pct"]),
        oldest_open_days: r["oldest_open_days"] === null ? null : Number(r["oldest_open_days"]),
        // Pre-column rows have no cell here (empty → null, or header absent → undefined);
        // both map to null so the chart draws a gap, never a fabricated zero.
        open_past_sla: r["open_past_sla"] == null ? null : Number(r["open_past_sla"])
      });
    }
    return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  }

  // src/server/jobsStore.ts
  function normError(v) {
    const s = v == null ? "" : String(v).trim();
    return s === "" || s === "null" || s === "undefined" ? null : s;
  }
  function newJobId(kind, now) {
    return `${kind}-${nowIso(now).replace(/[:]/g, "")}`;
  }
  function createJob(row, now) {
    const full = { ...row, started_at: nowIso(now), updated_at: nowIso(now) };
    appendRows(TABS.jobs, [full]);
    return full;
  }
  function updateJob(jobId, patch, now) {
    updateWhere(TABS.jobs, "job_id", jobId, {
      ...patch,
      updated_at: nowIso(now)
    });
  }
  function listJobs() {
    return readAll(TABS.jobs).map((r) => {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
      return {
        job_id: String((_a = r["job_id"]) != null ? _a : ""),
        kind: (_b = r["kind"]) != null ? _b : "scan",
        phase: (_c = r["phase"]) != null ? _c : "FAILED",
        scan_id: (_d = r["scan_id"]) != null ? _d : null,
        cursor: (_e = r["cursor"]) != null ? _e : null,
        page: Number((_f = r["page"]) != null ? _f : 0),
        findings_so_far: Number((_g = r["findings_so_far"]) != null ? _g : 0),
        page_size: Number((_h = r["page_size"]) != null ? _h : 0),
        total_count: Number((_i = r["total_count"]) != null ? _i : 0),
        params_json: (_j = r["params_json"]) != null ? _j : null,
        journal_ref: (_k = r["journal_ref"]) != null ? _k : null,
        error: normError(r["error"]),
        started_at: String((_l = r["started_at"]) != null ? _l : ""),
        updated_at: String((_m = r["updated_at"]) != null ? _m : "")
      };
    });
  }
  function getJob(jobId) {
    var _a;
    return (_a = listJobs().find((j) => j.job_id === jobId)) != null ? _a : null;
  }
  var TERMINAL = ["DONE", "FAILED", "CANCELLED"];
  function activeJob() {
    var _a;
    return (_a = listJobs().find((j) => !TERMINAL.includes(j.phase))) != null ? _a : null;
  }

  // src/server/ledgerStore.ts
  function rowToScan(r) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    return {
      scan_id: String((_a = r["scan_id"]) != null ? _a : ""),
      ts: String((_b = r["ts"]) != null ? _b : ""),
      mode: String((_c = r["mode"]) != null ? _c : ""),
      shape: r["shape"] === "grouped" ? "grouped" : "flat",
      total: Number((_d = r["total"]) != null ? _d : 0),
      new_count: Number((_e = r["new_count"]) != null ? _e : 0),
      resolved_count: Number((_f = r["resolved_count"]) != null ? _f : 0),
      reopened_count: Number((_g = r["reopened_count"]) != null ? _g : 0),
      raw_ref: (_h = r["raw_ref"]) != null ? _h : null,
      obs_ref: (_i = r["obs_ref"]) != null ? _i : null,
      severities: (_j = r["severities"]) != null ? _j : null,
      sealed: r["sealed"] === 1 || r["sealed"] === "1" || r["sealed"] === true ? 1 : 0
    };
  }
  function rowToLedger(r) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t;
    return {
      vuln_key: String((_a = r["vuln_key"]) != null ? _a : ""),
      cve: (_b = r["cve"]) != null ? _b : null,
      severity: (_c = r["severity"]) != null ? _c : null,
      asset_id: (_d = r["asset_id"]) != null ? _d : null,
      asset_name: (_e = r["asset_name"]) != null ? _e : null,
      asset_type: (_f = r["asset_type"]) != null ? _f : null,
      cloud: (_g = r["cloud"]) != null ? _g : null,
      first_seen: (_h = r["first_seen"]) != null ? _h : null,
      last_seen: (_i = r["last_seen"]) != null ? _i : null,
      status: String((_j = r["status"]) != null ? _j : "OPEN"),
      resolved_at: (_k = r["resolved_at"]) != null ? _k : null,
      resolution_src: (_l = r["resolution_src"]) != null ? _l : null,
      reopened_count: Number((_m = r["reopened_count"]) != null ? _m : 0),
      first_scan_id: (_n = r["first_scan_id"]) != null ? _n : null,
      last_scan_id: (_o = r["last_scan_id"]) != null ? _o : null,
      subscription_name: (_p = r["subscription_name"]) != null ? _p : null,
      subscription_ext_id: (_q = r["subscription_ext_id"]) != null ? _q : null,
      tags_json: (_r = r["tags_json"]) != null ? _r : null,
      fix_date: (_s = r["fix_date"]) != null ? _s : null,
      fix_observed_at: (_t = r["fix_observed_at"]) != null ? _t : null
    };
  }
  var scanRowsMemo;
  var stateMemo;
  function invalidateLedgerMemos() {
    scanRowsMemo = void 0;
    stateMemo = void 0;
    bumpDataVersion();
  }
  function loadScanRows() {
    if (scanRowsMemo === void 0) {
      scanRowsMemo = scansAsc(readAll(TABS.scans).map(rowToScan));
    }
    return scanRowsMemo;
  }
  function scanRowExists(scanId) {
    return loadScanRows().some((s) => s.scan_id === scanId);
  }
  function loadState(useSnapshot = true) {
    if (useSnapshot && stateMemo !== void 0) return stateMemo;
    const state = emptyState();
    state.scans = loadScanRows().slice();
    if (useSnapshot) {
      const snap = readLedgerSnapshot();
      if (snap) {
        state.ledger = snap.ledger;
        state.episodes = snap.episodes;
        stateMemo = state;
        return state;
      }
    }
    for (const r of readAll(TABS.vulnLedger)) {
      const row = rowToLedger(r);
      state.ledger[row.vuln_key] = row;
    }
    state.episodes = readAll(TABS.episodes).map((r) => {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
      return {
        vuln_key: String((_a = r["vuln_key"]) != null ? _a : ""),
        cve: (_b = r["cve"]) != null ? _b : null,
        severity: (_c = r["severity"]) != null ? _c : null,
        first_seen: (_d = r["first_seen"]) != null ? _d : null,
        resolved_at: (_e = r["resolved_at"]) != null ? _e : null,
        resolution_src: (_f = r["resolution_src"]) != null ? _f : null,
        reopened_count: Number((_g = r["reopened_count"]) != null ? _g : 0),
        compaction_id: String((_h = r["compaction_id"]) != null ? _h : ""),
        superseded_by_scan: (_i = r["superseded_by_scan"]) != null ? _i : null,
        fix_date: (_j = r["fix_date"]) != null ? _j : null,
        fix_observed_at: (_k = r["fix_observed_at"]) != null ? _k : null
      };
    });
    if (useSnapshot) stateMemo = state;
    return state;
  }
  function writeStateTables(state) {
    overwrite(TABS.vulnLedger, Object.values(state.ledger));
    overwrite(TABS.episodes, state.episodes);
    overwrite(TABS.scans, scansAsc(state.scans));
    writeLedgerSnapshot(state);
    invalidateLedgerMemos();
  }
  function persistFlatScan2(records, options) {
    var _a, _b, _c;
    const state = loadState();
    const scanId = options.scanId || nowIso();
    const existing = state.scans.find((s) => s.scan_id === scanId);
    if (existing) {
      return {
        deltas: {
          new_count: existing.new_count,
          resolved_count: existing.resolved_count,
          reopened_count: existing.reopened_count
        },
        scanRow: null
      };
    }
    const jobId = (_a = options.jobId) != null ? _a : newJobId("scan");
    const journalRef = writeJournal(jobId, state);
    if (options.jobId) {
      updateJob(jobId, { phase: "PERSISTING", scan_id: scanId, journal_ref: journalRef });
    } else {
      createJob({
        job_id: jobId,
        kind: "scan",
        phase: "PERSISTING",
        scan_id: scanId,
        cursor: null,
        page: 0,
        findings_so_far: records.length,
        page_size: 0,
        total_count: 0,
        params_json: null,
        journal_ref: journalRef,
        error: null
      });
    }
    const { deltas, observations, scanRow } = persistFlatScan(state, records, {
      mode: options.mode,
      scanId,
      scannedSeverities: (_b = options.scannedSeverities) != null ? _b : null,
      rawRef: (_c = options.rawRef) != null ? _c : null
    });
    const obsRef = writeObservations(scanId, observations);
    if (scanRow) scanRow.obs_ref = obsRef;
    overwrite(TABS.vulnLedger, Object.values(state.ledger));
    overwrite(TABS.episodes, state.episodes);
    writeLedgerSnapshot(state);
    if (scanRow) appendRows(TABS.scans, [scanRow]);
    invalidateLedgerMemos();
    updateJob(jobId, { phase: "DONE" });
    trashFile(journalRef);
    return { deltas, scanRow };
  }
  function persistGroupedScan2(nodes, options) {
    var _a, _b, _c;
    const state = loadState();
    const { deltas, scanRow } = persistGroupedScan(state, nodes, {
      mode: options.mode,
      scanId: (_a = options.scanId) != null ? _a : null,
      scannedSeverities: (_b = options.scannedSeverities) != null ? _b : null,
      rawRef: (_c = options.rawRef) != null ? _c : null
    });
    if (scanRow) {
      appendRows(TABS.scans, [scanRow]);
      invalidateLedgerMemos();
    }
    return { deltas, scanRow };
  }
  var readPayloadForRow = (row) => readScanPayload(row.raw_ref);
  function loadBaseRows(now) {
    return baseRows(loadState(), now);
  }
  function loadTrend(severities = null, tailThresholdDays = null) {
    const state = loadState();
    const base = baseRows(state).map((r) => ({
      severity: r.severity,
      first_seen: r.first_seen,
      resolved_at: r.resolved_at,
      mttr_days: r.mttr_days
    }));
    const points = trendFromBase(
      state.scans.map((s) => ({ ts: s.ts, shape: s.shape })),
      base,
      severities,
      { backfill: true }
    );
    const withSla = withOpenPastSla(points, base, severities);
    return tailThresholdDays === null ? withSla : withTailMedian(withSla, base, tailThresholdDays, severities);
  }
  function previousSeverityCounts() {
    const flats = loadScanRows().filter((s) => s.shape === "flat");
    if (flats.length < 2) return {};
    const prev = flats[flats.length - 2];
    return severityCountsFromObservations(readObservations(prev.obs_ref));
  }
  function latestScanRow() {
    return latestScan(loadScanRows());
  }
  function latestFlatScanRow() {
    const flats = loadScanRows().filter((s) => s.shape === "flat");
    return flats.length ? flats[flats.length - 1] : null;
  }
  function latestCheckpoint() {
    const rows = readAll(TABS.compactions).filter((r) => r["checkpoint_ref"]);
    if (!rows.length) return null;
    rows.sort((a, b) => String(a["ts"]) < String(b["ts"]) ? 1 : -1);
    return readCheckpoint(rows[0]["checkpoint_ref"]);
  }
  function deleteScans(scanIds, jobId) {
    const state = loadState();
    const checkpoint = latestCheckpoint();
    const jid = jobId != null ? jobId : newJobId("delete");
    const { state: rebuilt, result, observationsByScan } = deleteScansCore(
      state,
      scanIds,
      readPayloadForRow,
      checkpoint
    );
    if (!result.deleted) return result;
    const journalRef = writeJournal(jid, state);
    if (jobId) {
      updateJob(jid, { phase: "REPLAYING", journal_ref: journalRef });
    } else {
      createJob({
        job_id: jid,
        kind: "delete",
        phase: "REPLAYING",
        scan_id: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: JSON.stringify({ scanIds }),
        journal_ref: journalRef,
        error: null
      });
    }
    for (const row of rebuilt.scans) {
      const obs = observationsByScan[row.scan_id];
      if (obs) row.obs_ref = writeObservations(row.scan_id, obs);
    }
    writeStateTables(rebuilt);
    updateJob(jid, { phase: "DONE" });
    trashFile(journalRef);
    const survivorRefs = new Set(rebuilt.scans.map((r) => r.raw_ref).filter(Boolean));
    for (const r of state.scans) {
      if (rebuilt.scans.some((s) => s.scan_id === r.scan_id)) continue;
      if (r.raw_ref && !survivorRefs.has(r.raw_ref)) trashScanArchive(r.raw_ref);
      trashFile(r.obs_ref);
    }
    return result;
  }
  function importBundle(bundle) {
    const state = loadState();
    if (readAll(TABS.compactions).length) {
      throw new ImportValidationError(
        "This ledger already has a compaction record (a prior compaction or import) \u2014 the one-shot migration import needs a never-compacted ledger."
      );
    }
    const nowMs = Date.now();
    const compactionId = `imp-${nowIso(nowMs).replace(/[:]/g, "")}`;
    const { state: merged, checkpoint, observationsByScan, counts } = importBundleCore(
      state,
      bundle,
      readPayloadForRow,
      { compactionId }
    );
    if (!counts.scans_imported && !counts.vulns_imported && !counts.episodes_imported) {
      return counts;
    }
    const jobId = newJobId("import", nowMs);
    const journalRef = writeJournal(jobId, state);
    createJob(
      {
        job_id: jobId,
        kind: "import",
        phase: "REPLAYING",
        scan_id: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: JSON.stringify({
          scans: counts.scans_imported,
          vulns: counts.vulns_imported,
          episodes: counts.episodes_imported
        }),
        journal_ref: journalRef,
        error: null
      },
      nowMs
    );
    for (const row of merged.scans) {
      const obs = observationsByScan[row.scan_id];
      if (obs) row.obs_ref = writeObservations(row.scan_id, obs);
    }
    const checkpointRef = writeCheckpoint(compactionId, checkpoint);
    appendRows(TABS.compactions, [
      {
        compaction_id: compactionId,
        ts: nowIso(nowMs),
        floor_scan_id: checkpoint.floor_scan_id,
        floor_ts: checkpoint.floor_ts,
        scans_sealed: counts.scans_imported,
        episodes_created: counts.episodes_imported + counts.episodes_converted,
        observations_pruned: 0,
        archive_bytes_freed: 0,
        db_bytes_freed: 0,
        checkpoint_ref: checkpointRef
      }
    ]);
    writeStateTables(merged);
    updateJob(jobId, { phase: "DONE" }, nowMs);
    trashFile(journalRef);
    return counts;
  }
  var APPEND_CHUNK = 5e3;
  function importJobState(job) {
    var _a;
    return JSON.parse((_a = job.params_json) != null ? _a : "{}");
  }
  function activeImportJob(sessionId) {
    const job = activeJob();
    if (!job || job.kind !== "import") return null;
    const st = importJobState(job);
    if (sessionId !== void 0 && st.sessionId !== sessionId) return null;
    return { job, st };
  }
  function chunkedAppend(tab, rows) {
    for (let i = 0; i < rows.length; i += APPEND_CHUNK) {
      appendRows(tab, rows.slice(i, i + APPEND_CHUNK));
    }
  }
  function importBeginSharded(rawManifest) {
    const existing = activeImportJob();
    if (existing) {
      return {
        sessionId: existing.st.sessionId,
        jobId: existing.job.job_id,
        shardCount: existing.st.shardCount,
        appliedShards: existing.st.appliedShards
      };
    }
    if (loadScanRows().length || readAll(TABS.compactions).length) {
      throw new ImportValidationError(
        "This ledger already has scans or a compaction record \u2014 the migration import needs a fresh, never-compacted ledger."
      );
    }
    const session = beginImportSession(rawManifest);
    const nowMs = Date.now();
    const compactionId = `imp-${nowIso(nowMs).replace(/[:]/g, "")}`;
    const sessionId = session.manifest.session_id || newJobId("import", nowMs);
    overwrite(TABS.vulnLedger, []);
    overwrite(TABS.episodes, []);
    trashLedgerSnapshot();
    writeImportManifest(sessionId, {
      scans: session.manifest.scans,
      mttr_history: session.manifest.mttr_history,
      compactionId,
      floorScanId: session.floorScanId,
      floorTs: session.floorTs,
      shardCount: session.manifest.shard_count
    });
    const jobId = newJobId("import", nowMs);
    const st = {
      sessionId,
      compactionId,
      shardCount: session.manifest.shard_count,
      appliedShards: 0,
      ledgerCommitted: 0,
      episodesCommitted: 0,
      partIds: [],
      floorScanId: session.floorScanId,
      floorTs: session.floorTs,
      sealedIds: [...session.sealedIds],
      scansTotal: session.sealedScans.length,
      counts: { vulns_imported: 0, episodes_imported: 0, episodes_converted: 0 }
    };
    createJob(
      {
        job_id: jobId,
        kind: "import",
        phase: "STAGING",
        scan_id: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: session.manifest.shard_count,
        params_json: JSON.stringify(st),
        journal_ref: null,
        error: null
      },
      nowMs
    );
    invalidateLedgerMemos();
    return { sessionId, jobId, shardCount: st.shardCount, appliedShards: 0 };
  }
  function importApplyShard(sessionId, index, shard) {
    const active = activeImportJob(sessionId);
    if (!active) throw new ImportValidationError("No active import session \u2014 begin the import first.");
    const { job } = active;
    const st = active.st;
    if (index < st.appliedShards) {
      return { sessionId, jobId: job.job_id, shardCount: st.shardCount, appliedShards: st.appliedShards };
    }
    if (index !== st.appliedShards) {
      throw new ImportValidationError(
        `Shards must arrive in order \u2014 expected shard ${st.appliedShards}, got ${index}.`
      );
    }
    if (dataRowCount(TABS.vulnLedger) > st.ledgerCommitted) truncateAfter(TABS.vulnLedger, st.ledgerCommitted);
    if (dataRowCount(TABS.episodes) > st.episodesCommitted) truncateAfter(TABS.episodes, st.episodesCommitted);
    stageShard(sessionId, index, shard);
    const out = applyShardCore(shard, {
      sealedIds: new Set(st.sealedIds),
      compactionId: st.compactionId
    });
    chunkedAppend(TABS.vulnLedger, out.ledgerRows);
    chunkedAppend(TABS.episodes, out.episodeRows);
    const partId = writeCheckpointPart(st.compactionId, index, out.checkpointRows);
    const next = {
      ...st,
      appliedShards: index + 1,
      ledgerCommitted: st.ledgerCommitted + out.ledgerRows.length,
      episodesCommitted: st.episodesCommitted + out.episodeRows.length,
      partIds: [...st.partIds, partId],
      counts: {
        vulns_imported: st.counts.vulns_imported + out.vulnsImported,
        episodes_imported: st.counts.episodes_imported + out.episodesImported,
        episodes_converted: st.counts.episodes_converted + out.episodesConverted
      }
    };
    updateJob(job.job_id, { phase: "APPLYING", params_json: JSON.stringify(next) });
    invalidateLedgerMemos();
    return { sessionId, jobId: job.job_id, shardCount: st.shardCount, appliedShards: next.appliedShards };
  }
  function importFinalizeSharded(sessionId) {
    var _a, _b, _c;
    const active = activeImportJob(sessionId);
    if (!active) throw new ImportValidationError("No active import session to finalize.");
    const { job } = active;
    const st = active.st;
    if (st.appliedShards !== st.shardCount) {
      throw new ImportValidationError(
        `Import incomplete \u2014 ${st.appliedShards} of ${st.shardCount} shards applied.`
      );
    }
    updateJob(job.job_id, { phase: "FINALIZING" });
    const rawManifest = readImportManifest(sessionId);
    const session = beginImportSession({
      kind: "wiz-sidekick-migration-manifest",
      version: 1,
      shard_count: st.shardCount,
      session_id: sessionId,
      scans: (_a = rawManifest == null ? void 0 : rawManifest["scans"]) != null ? _a : [],
      mttr_history: (_b = rawManifest == null ? void 0 : rawManifest["mttr_history"]) != null ? _b : [],
      totals: { ledger: 0, episodes: 0 }
    });
    const present2 = new Set(loadScanRows().map((s) => s.scan_id));
    const toAppend = session.sealedScans.filter((s) => !present2.has(s.scan_id));
    chunkedAppend(TABS.scans, toAppend);
    invalidateLedgerMemos();
    const cpRef = writeCheckpointManifest(
      st.compactionId,
      checkpointManifest(st.floorScanId, st.floorTs, st.partIds)
    );
    if (readAll(TABS.compactions).length === 0) {
      appendRows(TABS.compactions, [
        {
          compaction_id: st.compactionId,
          ts: nowIso(),
          floor_scan_id: st.floorScanId,
          floor_ts: st.floorTs,
          scans_sealed: st.scansTotal,
          episodes_created: st.counts.episodes_imported + st.counts.episodes_converted,
          observations_pruned: 0,
          archive_bytes_freed: 0,
          db_bytes_freed: 0,
          checkpoint_ref: cpRef
        }
      ]);
    }
    const hist = importHistory((_c = rawManifest == null ? void 0 : rawManifest["mttr_history"]) != null ? _c : []);
    try {
      writeLedgerSnapshot(loadState(false));
    } catch (e) {
      console.warn(`Post-import snapshot skipped: ${e}`);
    }
    invalidateLedgerMemos();
    updateJob(job.job_id, { phase: "DONE" });
    trashImportSession(sessionId);
    return {
      scans_imported: st.scansTotal,
      scans_skipped: 0,
      vulns_imported: st.counts.vulns_imported,
      episodes_imported: st.counts.episodes_imported,
      episodes_converted: st.counts.episodes_converted,
      scans_replayed: 0,
      history_added: hist.added,
      history_skipped: hist.skipped
    };
  }
  function importAbortSharded(sessionId) {
    const active = activeImportJob(sessionId);
    overwrite(TABS.vulnLedger, []);
    overwrite(TABS.episodes, []);
    trashLedgerSnapshot();
    trashImportSession(sessionId);
    invalidateLedgerMemos();
    if (active) updateJob(active.job.job_id, { phase: "CANCELLED", error: null });
    return { aborted: true };
  }
  function resetLedger() {
    const counts = {
      scans: loadScanRows().length,
      vulns: dataRowCount(TABS.vulnLedger),
      episodes: dataRowCount(TABS.episodes),
      compactions: readAll(TABS.compactions).length
    };
    overwrite(TABS.scans, []);
    overwrite(TABS.vulnLedger, []);
    overwrite(TABS.episodes, []);
    overwrite(TABS.compactions, []);
    overwrite(TABS.jobs, []);
    trashLedgerSnapshot();
    invalidateLedgerMemos();
    return counts;
  }
  function compactLedger(retentionDays, dryRun = false, now) {
    const state = loadState();
    const prevCheckpoint = latestCheckpoint();
    const nowMs = now != null ? now : Date.now();
    const compactionId = `cmp-${nowIso(nowMs).replace(/[:]/g, "")}`;
    const probe = compactLedgerCore(state, retentionDays, prevCheckpoint, readPayloadForRow, {
      dryRun: true,
      now: nowMs,
      compactionId
    });
    if (probe.result.no_op) return probe.result;
    const obsCountByScan = {};
    let archiveBytes = 0;
    for (const r of probe.newly) {
      obsCountByScan[r.scan_id] = readObservations(r.obs_ref).length;
      archiveBytes += scanArchiveBytes(r.raw_ref, null);
    }
    const plan = compactLedgerCore(state, retentionDays, prevCheckpoint, readPayloadForRow, {
      dryRun,
      now: nowMs,
      compactionId,
      obsCountByScan,
      archiveBytes
    });
    if (dryRun || plan.state === null) return plan.result;
    const jobId = newJobId("compact", nowMs);
    const journalRef = writeJournal(jobId, state);
    createJob(
      {
        job_id: jobId,
        kind: "compact",
        phase: "PERSISTING",
        scan_id: null,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: JSON.stringify({ retentionDays }),
        journal_ref: journalRef,
        error: null
      },
      nowMs
    );
    const checkpointRef = writeCheckpoint(compactionId, plan.checkpoint);
    const compactions = readAll(TABS.compactions).map((r) => ({
      ...r,
      checkpoint_ref: null
    }));
    compactions.push(compactionRow(plan, checkpointRef, nowMs));
    overwrite(TABS.compactions, compactions);
    writeStateTables(plan.state);
    updateJob(jobId, { phase: "DONE" }, nowMs);
    trashFile(journalRef);
    let freed = 0;
    for (const r of plan.newly) {
      freed += scanArchiveBytes(r.raw_ref, r.obs_ref);
      trashScanArchive(r.raw_ref);
      trashFile(r.obs_ref);
    }
    plan.result.archive_bytes_freed = freed;
    return plan.result;
  }

  // src/server/settingsStore.ts
  var settingsMemo;
  function loadSettings() {
    if (settingsMemo !== void 0) return settingsMemo;
    const out = {};
    for (const row of readAll(TABS.settings)) {
      const key = row["key"];
      const raw = row["value_json"];
      if (typeof key !== "string" || !key) continue;
      if (typeof raw !== "string" || raw === "") {
        out[key] = null;
        continue;
      }
      try {
        out[key] = JSON.parse(raw);
      } catch {
        console.warn(`Unreadable settings value for ${key}; ignoring`);
      }
    }
    settingsMemo = out;
    return out;
  }
  function saveSettings(settings) {
    overwrite(
      TABS.settings,
      Object.entries(settings).map(([key, value]) => ({
        key,
        value_json: JSON.stringify(value != null ? value : null)
      }))
    );
    settingsMemo = settings;
    bumpDataVersion();
  }
  var getFetchSeverities2 = () => getFetchSeverities(loadSettings());
  var getDisplaySeverities2 = () => getDisplaySeverities(loadSettings());
  var getRetentionDays2 = () => getRetentionDays(loadSettings());
  var getFastLaneDays2 = () => getFastLaneDays(loadSettings());
  var getAutoCompact2 = () => getAutoCompact(loadSettings());
  var getDomains2 = () => getDomains(loadSettings());
  var getSupportGroupMap2 = () => getSupportGroupMap(loadSettings());
  function setFetchSeverities(sevs) {
    saveSettings(withFetchSeverities(loadSettings(), sevs));
  }
  function setDisplaySeverities(sevs) {
    saveSettings(withDisplaySeverities(loadSettings(), sevs));
  }
  function setRetentionDays(days) {
    saveSettings(withRetentionDays(loadSettings(), days));
  }
  function setFastLaneDays(days) {
    saveSettings(withFastLaneDays(loadSettings(), days));
  }
  function setAutoCompact(enabled) {
    saveSettings(withAutoCompact(loadSettings(), enabled));
  }
  function setRetentionAndCompact(days, enabled) {
    saveSettings(withAutoCompact(withRetentionDays(loadSettings(), days), enabled));
  }
  function setDomains(items) {
    saveSettings(withDomains(loadSettings(), items));
  }
  function setSupportGroupMap(map) {
    saveSettings(withSupportGroupMap(loadSettings(), map));
  }

  // src/server/wizSubscriptionsQuery.ts
  var PAGE_SIZE2 = 100;
  var MAX_PAGES2 = 50;
  function isSafeTagKey(key) {
    return /^[\w/.:-]{1,120}$/.test(key);
  }
  function subscriptionsByTagQuery(tagKey) {
    if (!isSafeTagKey(tagKey)) {
      throw new Error(
        `Unsafe WIZ_SUPPORT_GROUP_TAG_KEY ${JSON.stringify(tagKey)} \u2014 allowed: letters, digits, _ . : / - (max 120 chars).`
      );
    }
    return 'query GetSubscriptionsByWizProvisioningTag($first: Int, $after: String) {\n  graphSearch(\n    query: {\n      type: [SUBSCRIPTION]\n      select: true\n      where: { tags: { CONTAINS: [{ key: "' + tagKey + '" }] } }\n    }\n    first: $first\n    after: $after\n  ) {\n    pageInfo { hasNextPage endCursor }\n    nodes { entities { id name properties } }\n  }\n}\n';
  }

  // src/server/supportGroups.ts
  function foldToken(v) {
    return String(v).trim().toLowerCase();
  }
  var FRAME_ID_COLS = [
    "vulnerableAsset.subscriptionId",
    "vulnerableAsset.subscriptionExternalId",
    "vulnerableAsset.subscriptionName"
  ];
  var LEDGER_ID_COLS = ["subscription_ext_id", "subscription_name"];
  function recordIdentityTokens(record) {
    const out = [];
    const va = record["vulnerableAsset"];
    for (const col of FRAME_ID_COLS) {
      const v = record[col];
      if (present(v)) out.push(String(v));
      else if (va && typeof va === "object" && !Array.isArray(va)) {
        const leaf = va[col.split(".").pop()];
        if (present(leaf)) out.push(String(leaf));
      }
    }
    for (const col of LEDGER_ID_COLS) {
      const v = record[col];
      if (present(v)) out.push(String(v));
    }
    return out;
  }
  function resolveSupportGroup(record, map) {
    for (const token of recordIdentityTokens(record)) {
      const group = map[foldToken(token)];
      if (group) return group;
    }
    return null;
  }
  function attachSupportGroups(records) {
    const { map } = getSupportGroupMap2();
    if (!Object.keys(map).length) return;
    for (const r of records) {
      const group = resolveSupportGroup(r, map);
      if (group) r["_supportGroup"] = group;
    }
  }
  function entityProperties(entity) {
    const p = entity["properties"];
    if (p && typeof p === "object" && !Array.isArray(p)) return p;
    if (typeof p === "string" && p) {
      try {
        const parsed = JSON.parse(p);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch {
      }
    }
    return {};
  }
  var PROP_ID_KEYS = [
    "subscriptionId",
    "subscriptionExternalId",
    "externalId",
    "cloudProviderID",
    "providerId",
    "subscriptionName",
    "name"
  ];
  function supportGroupValue(props, tagKey) {
    const tags = props["tags"];
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
      const v = tags[tagKey];
      if (present(v) && String(v).trim()) return String(v).trim();
    }
    if (Array.isArray(tags)) {
      for (const t of tags) {
        if (t && typeof t === "object" && String(t["key"]) === tagKey) {
          const v = t["value"];
          if (present(v) && String(v).trim()) return String(v).trim();
        }
      }
    }
    const flat = props[`tag:${tagKey}`];
    if (present(flat) && String(flat).trim()) return String(flat).trim();
    return null;
  }
  function parseSubscriptionEntity(entity, tagKey) {
    const props = entityProperties(entity);
    const group = supportGroupValue(props, tagKey);
    const tokens = [];
    if (group) {
      for (const k of PROP_ID_KEYS) {
        const v = props[k];
        if (present(v) && String(v).trim()) tokens.push(foldToken(v));
      }
      for (const k of ["id", "name"]) {
        const v = entity[k];
        if (present(v) && String(v).trim()) tokens.push(foldToken(v));
      }
    }
    return { group, tokens };
  }
  function recordSubscription(map, entity, tagKey) {
    const { group, tokens } = parseSubscriptionEntity(entity, tagKey);
    if (!group) return null;
    for (const token of tokens) map[token] = group;
    return group;
  }
  function fetchSupportGroups() {
    var _a, _b;
    const tagKey = ((_a = getProp(PROP_KEYS.wizSupportGroupTagKey)) == null ? void 0 : _a.trim()) || DEFAULT_SUPPORT_GROUP_TAG_KEY;
    const query = subscriptionsByTagQuery(tagKey);
    const map = {};
    const groups = /* @__PURE__ */ new Set();
    let cursor = null;
    let subscriptions = 0;
    let logged = false;
    for (let page = 0; page < MAX_PAGES2; page++) {
      const result = graphSearchPage(query, { first: PAGE_SIZE2, after: cursor });
      for (const node of result.nodes) {
        const entities = (_b = node["entities"]) != null ? _b : [];
        for (const entity of entities) {
          if (!logged) {
            console.log(`Support-group sample entity: ${JSON.stringify(entity).slice(0, 800)}`);
            logged = true;
          }
          const group = recordSubscription(map, entity, tagKey);
          if (group) {
            subscriptions += 1;
            groups.add(group);
          }
        }
      }
      if (!result.hasNextPage || !result.endCursor) break;
      cursor = result.endCursor;
    }
    return {
      map,
      stats: { subscriptions, keys: Object.keys(map).length, groups: groups.size, tagKey }
    };
  }
  function refreshSupportGroups() {
    const { map, stats } = fetchSupportGroups();
    setSupportGroupMap(map);
    return stats;
  }

  // src/server/findings.ts
  var memo;
  function invalidateFrameMemo() {
    memo = void 0;
  }
  function currentScan() {
    if (memo !== void 0) return memo;
    const row = latestFlatScanRow();
    if (!row) {
      memo = null;
      return memo;
    }
    const domains = getDomains2();
    const compiled = compileDomains(domains.items);
    const frame = readFrame(row.scan_id);
    let records;
    if (frame) {
      records = frame.map((flat) => {
        flat["_sev"] = normalizeSeverity(flat["severity"]);
        return flat;
      });
    } else {
      let slim = readSlimRecords(row.scan_id);
      if (!slim) {
        const payload = readScanPayload(row.raw_ref);
        slim = payload ? extractNodes(payload) : [];
      }
      records = (slim != null ? slim : []).map((n) => {
        const flat = flattenNode(n);
        flat["_vuln_key"] = vulnKey(n);
        flat["_sev"] = normalizeSeverity(flat["severity"]);
        return flat;
      });
    }
    attachSupportGroups(records);
    if (compiled.length) {
      for (const flat of records) flat["_domain"] = assignDomain(flat, compiled);
    } else {
      for (const flat of records) flat["_domain"] = UNASSIGNED;
    }
    memo = {
      scanId: row.scan_id,
      ts: row.ts,
      mode: row.mode,
      shape: row.shape,
      total: row.total,
      severities: row.severities,
      records
    };
    return memo;
  }
  function applyFilters(records, f) {
    var _a, _b, _c, _d, _e, _f;
    let out = records;
    if ((_a = f.severities) == null ? void 0 : _a.length) {
      const keep = new Set(f.severities.map(normalizeSeverity));
      out = out.filter((r) => keep.has(String(r["_sev"])));
    }
    if ((_b = f.statuses) == null ? void 0 : _b.length) {
      const keep = new Set(f.statuses.map((s) => s.toUpperCase()));
      out = out.filter((r) => {
        var _a2;
        return keep.has(String((_a2 = r["status"]) != null ? _a2 : "").toUpperCase());
      });
    }
    if ((_c = f.assetTypes) == null ? void 0 : _c.length) {
      const keep = new Set(f.assetTypes);
      out = out.filter((r) => {
        var _a2;
        return keep.has(String((_a2 = r["vulnerableAsset.type"]) != null ? _a2 : ""));
      });
    }
    if ((_d = f.clouds) == null ? void 0 : _d.length) {
      const keep = new Set(f.clouds);
      out = out.filter((r) => {
        var _a2;
        return keep.has(String((_a2 = r["vulnerableAsset.cloudPlatform"]) != null ? _a2 : ""));
      });
    }
    if ((_e = f.domains) == null ? void 0 : _e.length) {
      const keep = new Set(f.domains);
      out = out.filter((r) => {
        var _a2;
        return keep.has(String((_a2 = r["_domain"]) != null ? _a2 : UNASSIGNED));
      });
    }
    if ((_f = f.supportGroups) == null ? void 0 : _f.length) {
      const keep = new Set(f.supportGroups);
      out = out.filter((r) => {
        var _a2;
        return keep.has(String((_a2 = r["_supportGroup"]) != null ? _a2 : ""));
      });
    }
    if (f.q && f.q.trim()) {
      const q = f.q.trim().toLowerCase();
      out = out.filter(
        (r) => {
          var _a2, _b2;
          return String((_a2 = r["name"]) != null ? _a2 : "").toLowerCase().includes(q) || String((_b2 = r["vulnerableAsset.name"]) != null ? _b2 : "").toLowerCase().includes(q);
        }
      );
    }
    return out;
  }
  function distinct(records, column) {
    const seen = /* @__PURE__ */ new Set();
    for (const r of records) {
      const v = r[column];
      if (present(v)) seen.add(String(v));
    }
    return [...seen].sort();
  }
  var TABLE_COLUMNS = [
    "_vuln_key",
    "_sev",
    "_domain",
    "_supportGroup",
    "name",
    "severity",
    "status",
    "detailedName",
    "fixedVersion",
    "firstDetectedAt",
    "resolvedAt",
    "lastDetectedAt",
    "score",
    "epssSeverity",
    "hasExploit",
    "hasCisaKevExploit",
    "vulnerableAsset.name",
    "vulnerableAsset.type",
    "vulnerableAsset.cloudPlatform",
    "vulnerableAsset.subscriptionName",
    "vulnerableAsset.operatingSystem"
  ];
  function tableRow(r) {
    var _a;
    const out = {};
    for (const c of TABLE_COLUMNS) out[c] = (_a = r[c]) != null ? _a : null;
    return out;
  }

  // src/server/locks.ts
  var LedgerBusyError = class extends Error {
  };
  function withScriptLock(fn, timeoutMs = 3e4) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(timeoutMs)) {
      throw new LedgerBusyError(
        "The ledger is busy (a scan or maintenance job is writing). Try again shortly."
      );
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }
  function recoverIfNeeded() {
    const job = activeJob();
    if (!job) return;
    if (job.phase !== "PERSISTING" && job.phase !== "REPLAYING") return;
    if (job.phase === "PERSISTING" && job.scan_id && scanRowExists(job.scan_id)) {
      updateJob(job.job_id, { phase: "DONE" });
      trashFile(job.journal_ref);
      return;
    }
    const journal = readJournal(job.journal_ref);
    if (journal) {
      writeStateTables(journal);
      updateJob(job.job_id, {
        phase: "FAILED",
        error: "Recovered: execution died mid-write; ledger restored from journal."
      });
      trashFile(job.journal_ref);
    } else {
      updateJob(job.job_id, {
        phase: "FAILED",
        error: "Execution died mid-write and no journal was found; run a fresh scan."
      });
    }
  }

  // src/server/scanJobs.ts
  var scanJobs_exports = {};
  __export(scanJobs_exports, {
    cancelScan: () => cancelScan,
    clearContinuationTriggers: () => clearContinuationTriggers,
    continueJob: () => continueJob,
    dailyScan: () => dailyScan,
    jobStatus: () => jobStatus,
    slimRecord: () => slimRecord,
    startScan: () => startScan
  });

  // src/server/frameCore.ts
  function buildFrame(records, pageOf) {
    return records.map((n, i) => {
      const flat = flattenNode(n);
      flat["_vuln_key"] = vulnKey(n);
      if (pageOf) flat["_page"] = pageOf(i);
      return flat;
    });
  }
  function pageOfFromRuns(runs, total) {
    if (!runs) return null;
    const pages = [];
    for (const [page, count] of runs) {
      for (let k = 0; k < count; k++) pages.push(page);
    }
    if (pages.length !== total) return null;
    return (i) => pages[i];
  }

  // src/server/sampleData.ts
  var SAMPLE_FLAT = { "data": { "vulnerabilityFindings": { "nodes": [{ "id": "vf_2b1c9e4a-6f3d-4a2b-9c1e-8d7f6a5b4c3d", "name": "CVE-2025-32463", "detailedName": "sudo 1.9.13p3-1ubuntu3.4", "description": "A flaw was found in sudo's chroot handling that allows a local user with limited sudo privileges to escalate to root by supplying a crafted /etc/nsswitch.conf inside a controlled chroot.", "severity": "CRITICAL", "status": "OPEN", "fixedVersion": "1.9.15p2-3ubuntu2", "detectionMethod": "OS_PACKAGE", "firstDetectedAt": "2026-04-01T08:12:44Z", "firstDetectedAtSource": "SCHEDULED_SCAN", "lastDetectedAt": "2026-06-09T08:39:37Z", "resolvedAt": null, "validatedInRuntime": true, "runtimeValidationResult": "CONFIRMED", "reachability": "NETWORK", "hasTriggerableRemediation": false, "remediationPullRequestAvailable": false, "dataSourceName": "Wiz Sensor", "fixDate": null, "fixDateBefore": null, "publishedDate": "2026-03-28T00:00:00Z", "version": "1.9.13p3-1ubuntu3.4", "versionResolutionPrimarySource": { "type": "OS_PACKAGE_MANAGER", "version": "1.9.13p3-1ubuntu3.4" }, "isOperatingSystemEndOfLife": false, "recommendedVersion": "1.9.15p2-3ubuntu2", "locationPath": "/usr/bin/sudo", "artifactType": { "group": "OS_PACKAGE", "codeLibraryLanguage": null, "osPackageManager": "DPKG", "hostedTechnology": null, "plugin": false, "custom": false, "ciComponent": false }, "projects": [{ "id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production", "slug": "production", "isFolder": false }], "ignoreRules": [], "note": null, "layerMetadata": null, "vulnerableAsset": { "id": "b06695d5-b271-58f3-9e27-c5b97658142e", "type": "VIRTUAL_MACHINE", "name": "web-prod-01", "cloudPlatform": "AWS", "subscriptionName": "prod-account", "subscriptionExternalId": "111122223333", "subscriptionId": "2b2211fb-742f-5566-af67-ab8992b58cfb", "tags": { "env": "prod", "team": "platform", "owner": "sre" }, "operatingSystem": "Ubuntu", "operatingSystemDistribution": { "id": "os-ubuntu-2404", "name": "Ubuntu 24.04", "icon": "ubuntu" }, "imageName": "ami-0a1b2c3d4e5f6a7b8", "imageId": "ami-0a1b2c3d4e5f6a7b8", "imageNativeType": "AMI", "hasLimitedInternetExposure": false, "hasWideInternetExposure": true, "isAccessibleFromVPN": false, "isAccessibleFromOtherVnets": false, "isAccessibleFromOtherSubscriptions": false, "computeInstanceGroup": { "id": "asg-web-prod", "externalId": "asg-web-prod-01", "name": "web-prod-asg", "replicaCount": 4, "tags": { "env": "prod" } }, "nativeType": "ec2", "isUsedOnPrem": false, "resourceGroupExternalId": null }, "sourceMappedCodeFindings": [], "transitivity": null, "rootComponent": null, "isHighProfileThreat": true, "vendorSeverity": "CRITICAL", "nvdSeverity": "HIGH", "weightedSeverity": "CRITICAL", "hasExploit": true, "usedInCodeResult": null, "hasCisaKevExploit": true, "cisaKevReleaseDate": "2026-04-03T00:00:00Z", "cisaKevDueDate": "2026-04-24T00:00:00Z", "score": 9.3, "epssSeverity": "CRITICAL", "epssPercentile": 0.981, "epssProbability": 0.91, "categories": ["PRIVILEGE_ESCALATION"], "hasInitialAccessPotential": false, "isClientSide": false, "affectedBySettings": false, "codeLibraryLanguage": null, "exploitabilityValidationStatus": "EXPLOITABLE", "cvssv2": null, "cvssv3": { "attackVector": "LOCAL", "attackComplexity": "LOW", "confidentialityImpact": "HIGH", "integrityImpact": "HIGH", "privilegesRequired": "LOW", "userInteractionRequired": false, "vectorString": "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "scope": "UNCHANGED" }, "effectiveAvailabilityImpact": "HIGH", "cnaScore": 7.8, "vendorScore": 9.3, "origin": "CONTEXTUAL", "duplicateOf": null }, { "id": "vf_7a4e1f2b-3c5d-4e6f-8a9b-1c2d3e4f5a6b", "name": "CVE-2026-0985", "detailedName": "openssl 3.0.13-0ubuntu3.4", "description": "An out-of-bounds read in the X.509 certificate parser can cause a denial of service when processing a malformed certificate chain.", "severity": "HIGH", "status": "RESOLVED", "fixedVersion": "3.0.13-0ubuntu3.6", "detectionMethod": "OS_PACKAGE", "firstDetectedAt": "2026-03-11T14:02:09Z", "firstDetectedAtSource": "SCHEDULED_SCAN", "lastDetectedAt": "2026-03-25T06:11:52Z", "resolvedAt": "2026-03-26T09:45:00Z", "validatedInRuntime": false, "runtimeValidationResult": null, "reachability": "NETWORK", "hasTriggerableRemediation": true, "remediationPullRequestAvailable": true, "dataSourceName": "Wiz Sensor", "fixDate": "2026-03-26T09:45:00Z", "fixDateBefore": null, "publishedDate": "2026-02-18T00:00:00Z", "version": "3.0.13-0ubuntu3.4", "versionResolutionPrimarySource": { "type": "OS_PACKAGE_MANAGER", "version": "3.0.13-0ubuntu3.4" }, "isOperatingSystemEndOfLife": false, "recommendedVersion": "3.0.13-0ubuntu3.6", "locationPath": "/usr/lib/x86_64-linux-gnu/libssl.so.3", "artifactType": { "group": "OS_PACKAGE", "codeLibraryLanguage": null, "osPackageManager": "DPKG", "hostedTechnology": null, "plugin": false, "custom": false, "ciComponent": false }, "projects": [{ "id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production", "slug": "production", "isFolder": false }], "ignoreRules": [], "note": { "id": "note-91f2", "text": "Patched during the March maintenance window." }, "layerMetadata": null, "vulnerableAsset": { "id": "66457926-3513-53eb-a09f-0e90b6f4feff", "type": "VIRTUAL_MACHINE", "name": "api-prod-02", "cloudPlatform": "Azure", "subscriptionName": "core-prod", "subscriptionExternalId": "azure-sub-001", "subscriptionId": "1fafc3d1-bbe3-5d13-8698-3df1f4514e37", "tags": { "env": "prod", "tier": "api" }, "operatingSystem": "Ubuntu", "operatingSystemDistribution": { "id": "os-ubuntu-2204", "name": "Ubuntu 22.04", "icon": "ubuntu" }, "imageName": null, "imageId": null, "imageNativeType": null, "hasLimitedInternetExposure": true, "hasWideInternetExposure": false, "isAccessibleFromVPN": true, "isAccessibleFromOtherVnets": false, "isAccessibleFromOtherSubscriptions": false, "computeInstanceGroup": null, "nativeType": "virtualMachine", "isUsedOnPrem": false, "resourceGroupExternalId": "rg-core-prod" }, "sourceMappedCodeFindings": [], "transitivity": "DIRECT", "rootComponent": { "name": "openssl" }, "isHighProfileThreat": false, "vendorSeverity": "HIGH", "nvdSeverity": "MEDIUM", "weightedSeverity": "HIGH", "hasExploit": false, "usedInCodeResult": null, "hasCisaKevExploit": false, "cisaKevReleaseDate": null, "cisaKevDueDate": null, "score": 7.5, "epssSeverity": "MEDIUM", "epssPercentile": 0.44, "epssProbability": 0.06, "categories": ["DENIAL_OF_SERVICE"], "hasInitialAccessPotential": false, "isClientSide": false, "affectedBySettings": false, "codeLibraryLanguage": null, "exploitabilityValidationStatus": "NOT_EXPLOITABLE", "cvssv2": null, "cvssv3": { "attackVector": "NETWORK", "attackComplexity": "HIGH", "confidentialityImpact": "NONE", "integrityImpact": "NONE", "privilegesRequired": "NONE", "userInteractionRequired": false, "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H", "scope": "UNCHANGED" }, "effectiveAvailabilityImpact": "HIGH", "cnaScore": 7.5, "vendorScore": 7.5, "origin": "CONTEXTUAL", "duplicateOf": null }, { "id": "vf_9c3d5e6f-4a2b-4c1d-8e7f-6a5b4c3d2e1f", "name": "CVE-2026-1442", "detailedName": "glibc 2.35-0ubuntu3.8", "description": "A buffer overflow in the DNS stub resolver can be triggered by a malicious DNS response, potentially leading to remote code execution in services performing name resolution.", "severity": "MEDIUM", "status": "OPEN", "fixedVersion": "2.35-0ubuntu3.9", "detectionMethod": "OS_PACKAGE", "firstDetectedAt": "2026-05-02T11:30:18Z", "firstDetectedAtSource": "SCHEDULED_SCAN", "lastDetectedAt": "2026-06-11T10:07:38Z", "resolvedAt": null, "validatedInRuntime": false, "runtimeValidationResult": null, "reachability": null, "hasTriggerableRemediation": false, "remediationPullRequestAvailable": false, "dataSourceName": "Wiz Sensor", "fixDate": null, "fixDateBefore": "2026-08-02T00:00:00Z", "publishedDate": "2026-04-22T00:00:00Z", "version": "2.35-0ubuntu3.8", "versionResolutionPrimarySource": { "type": "OS_PACKAGE_MANAGER", "version": "2.35-0ubuntu3.8" }, "isOperatingSystemEndOfLife": false, "recommendedVersion": "2.35-0ubuntu3.9", "locationPath": "/lib/x86_64-linux-gnu/libc.so.6", "artifactType": { "group": "OS_PACKAGE", "codeLibraryLanguage": null, "osPackageManager": "DPKG", "hostedTechnology": null, "plugin": false, "custom": false, "ciComponent": false }, "projects": [{ "id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production", "slug": "production", "isFolder": false }], "ignoreRules": [{ "id": "ignore-rule-4471" }], "note": null, "layerMetadata": null, "vulnerableAsset": { "id": "3aabb810-5c5d-5603-922e-e21fe60d8d73", "type": "VIRTUAL_MACHINE", "name": "batch-worker-03", "cloudPlatform": "GCP", "subscriptionName": "inix-tt4k", "subscriptionExternalId": "inix-tt4k", "subscriptionId": "86a11580-2086-56a7-88d2-27f405958fcb", "tags": { "env": "prod", "cluster_name": "inix-gke-eu-pr" }, "operatingSystem": "Ubuntu", "operatingSystemDistribution": { "id": "os-ubuntu-2204", "name": "Ubuntu 22.04", "icon": "ubuntu" }, "imageName": null, "imageId": null, "imageNativeType": null, "hasLimitedInternetExposure": false, "hasWideInternetExposure": false, "isAccessibleFromVPN": false, "isAccessibleFromOtherVnets": false, "isAccessibleFromOtherSubscriptions": false, "computeInstanceGroup": { "id": "gke-inix-gke-eu-pr-n4-shared", "externalId": "gke-inix-gke-eu-pr-n4-shared-19b3", "name": "n4-shared-19b3", "replicaCount": 12, "tags": { "goog-k8s-cluster-name": "inix-gke-eu-pr" } }, "nativeType": "instance", "isUsedOnPrem": false, "resourceGroupExternalId": null }, "sourceMappedCodeFindings": [], "transitivity": null, "rootComponent": null, "isHighProfileThreat": false, "vendorSeverity": "MEDIUM", "nvdSeverity": "MEDIUM", "weightedSeverity": "MEDIUM", "hasExploit": false, "usedInCodeResult": null, "hasCisaKevExploit": false, "cisaKevReleaseDate": null, "cisaKevDueDate": null, "score": 5.9, "epssSeverity": "LOW", "epssPercentile": 0.21, "epssProbability": 0.01, "categories": ["REMOTE_CODE_EXECUTION"], "hasInitialAccessPotential": true, "isClientSide": false, "affectedBySettings": true, "codeLibraryLanguage": null, "exploitabilityValidationStatus": "UNKNOWN", "cvssv2": { "attackVector": "NETWORK", "attackComplexity": "MEDIUM", "confidentialityImpact": "PARTIAL", "integrityImpact": "PARTIAL", "privilegesRequired": null, "userInteractionRequired": false, "vectorString": "AV:N/AC:M/Au:N/C:P/I:P/A:P", "scope": null }, "cvssv3": { "attackVector": "NETWORK", "attackComplexity": "HIGH", "confidentialityImpact": "LOW", "integrityImpact": "LOW", "privilegesRequired": "NONE", "userInteractionRequired": false, "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:L", "scope": "UNCHANGED" }, "effectiveAvailabilityImpact": "LOW", "cnaScore": 5.9, "vendorScore": 5.9, "origin": "CONTEXTUAL", "duplicateOf": null }, { "id": "vf_1e2d3c4b-5a6f-4e8d-9c1b-2a3b4c5d6e7f", "name": "CVE-2025-58234", "detailedName": "linux-image-6.8.0-1015-aws 6.8.0-1015.16", "description": "A use-after-free in the kernel's netfilter subsystem allows a local unprivileged user to crash the system or potentially escalate privileges.", "severity": "LOW", "status": "RESOLVED", "fixedVersion": "6.8.0-1016.17", "detectionMethod": "OS_PACKAGE", "firstDetectedAt": "2026-01-20T05:44:11Z", "lastDetectedAt": "2026-02-09T07:00:00Z", "firstDetectedAtSource": "SCHEDULED_SCAN", "resolvedAt": "2026-02-10T13:22:00Z", "validatedInRuntime": false, "runtimeValidationResult": null, "reachability": "INTERNAL", "hasTriggerableRemediation": false, "remediationPullRequestAvailable": false, "dataSourceName": "Wiz Sensor", "fixDate": "2026-02-10T13:22:00Z", "fixDateBefore": null, "publishedDate": "2025-12-30T00:00:00Z", "version": "6.8.0-1015.16", "versionResolutionPrimarySource": { "type": "OS_PACKAGE_MANAGER", "version": "6.8.0-1015.16" }, "isOperatingSystemEndOfLife": false, "recommendedVersion": "6.8.0-1016.17", "locationPath": "/boot/vmlinuz-6.8.0-1015-aws", "artifactType": { "group": "OS_PACKAGE", "codeLibraryLanguage": null, "osPackageManager": "DPKG", "hostedTechnology": null, "plugin": false, "custom": false, "ciComponent": false }, "projects": [{ "id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production", "slug": "production", "isFolder": false }], "ignoreRules": [], "note": null, "layerMetadata": null, "vulnerableAsset": { "id": "c433c9a9-e631-5d56-8bd8-3c1cddd93103", "type": "VIRTUAL_MACHINE", "name": "dev-box-07", "cloudPlatform": "AWS", "subscriptionName": "dev-account", "subscriptionExternalId": "444455556666", "subscriptionId": "f391b2ee-ffdf-58e1-a3af-a59bfeaba3dc", "tags": { "env": "dev" }, "operatingSystem": "Amazon Linux", "operatingSystemDistribution": { "id": "os-al2023", "name": "Amazon Linux 2023", "icon": "amazon-linux" }, "imageName": "ami-0f1e2d3c4b5a6f7e8", "imageId": "ami-0f1e2d3c4b5a6f7e8", "imageNativeType": "AMI", "hasLimitedInternetExposure": false, "hasWideInternetExposure": false, "isAccessibleFromVPN": true, "isAccessibleFromOtherVnets": false, "isAccessibleFromOtherSubscriptions": false, "computeInstanceGroup": null, "nativeType": "ec2", "isUsedOnPrem": false, "resourceGroupExternalId": null }, "sourceMappedCodeFindings": [], "transitivity": null, "rootComponent": null, "isHighProfileThreat": false, "vendorSeverity": "LOW", "nvdSeverity": "LOW", "weightedSeverity": "LOW", "hasExploit": false, "usedInCodeResult": null, "hasCisaKevExploit": false, "cisaKevReleaseDate": null, "cisaKevDueDate": null, "score": 3.3, "epssSeverity": "LOW", "epssPercentile": 0.08, "epssProbability": 1e-3, "categories": ["PRIVILEGE_ESCALATION", "DENIAL_OF_SERVICE"], "hasInitialAccessPotential": false, "isClientSide": false, "affectedBySettings": false, "codeLibraryLanguage": null, "exploitabilityValidationStatus": "NOT_EXPLOITABLE", "cvssv2": null, "cvssv3": { "attackVector": "LOCAL", "attackComplexity": "HIGH", "confidentialityImpact": "NONE", "integrityImpact": "NONE", "privilegesRequired": "LOW", "userInteractionRequired": false, "vectorString": "CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:L", "scope": "UNCHANGED" }, "effectiveAvailabilityImpact": "LOW", "cnaScore": 3.3, "vendorScore": 3.3, "origin": "CONTEXTUAL", "duplicateOf": null }, { "id": "vf_eol-awaiting-0001", "name": "CVE-2026-4400", "detailedName": "openssl 1.0.2g-eol", "description": "A heap overflow in the TLS record layer. The host runs an end-of-life OS release; no fixed package is available from the vendor.", "severity": "HIGH", "status": "OPEN", "fixedVersion": null, "detectionMethod": "OS_PACKAGE", "firstDetectedAt": "2026-07-05T08:00:00Z", "firstDetectedAtSource": "SCHEDULED_SCAN", "lastDetectedAt": "2026-07-16T08:00:00Z", "resolvedAt": null, "validatedInRuntime": true, "runtimeValidationResult": "CONFIRMED", "reachability": "NETWORK", "hasTriggerableRemediation": false, "remediationPullRequestAvailable": false, "dataSourceName": "Wiz Sensor", "fixDate": null, "fixDateBefore": null, "publishedDate": "2026-06-20T00:00:00Z", "version": "1.0.2g", "versionResolutionPrimarySource": { "type": "OS_PACKAGE_MANAGER", "version": "1.9.13p3-1ubuntu3.4" }, "isOperatingSystemEndOfLife": true, "recommendedVersion": null, "locationPath": "/usr/lib/x86_64-linux-gnu/libssl.so.1.0.2", "artifactType": { "group": "OS_PACKAGE", "codeLibraryLanguage": null, "osPackageManager": "DPKG", "hostedTechnology": null, "plugin": false, "custom": false, "ciComponent": false }, "projects": [{ "id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production", "slug": "production", "isFolder": false }], "ignoreRules": [], "note": null, "layerMetadata": null, "vulnerableAsset": { "id": "e01dead0-0000-5eol-9999-legacyhost0001", "type": "VIRTUAL_MACHINE", "name": "legacy-host-01", "cloudPlatform": "AWS", "subscriptionName": "prod-account", "subscriptionExternalId": "111122223333", "subscriptionId": "2b2211fb-742f-5566-af67-ab8992b58cfb", "tags": { "env": "prod", "team": "platform", "owner": "sre" }, "operatingSystem": "Ubuntu", "operatingSystemDistribution": { "id": "os-ubuntu-1604", "name": "Ubuntu 16.04 (EOL)", "icon": "ubuntu" }, "imageName": "ami-0a1b2c3d4e5f6a7b8", "imageId": "ami-0a1b2c3d4e5f6a7b8", "imageNativeType": "AMI", "hasLimitedInternetExposure": false, "hasWideInternetExposure": true, "isAccessibleFromVPN": false, "isAccessibleFromOtherVnets": false, "isAccessibleFromOtherSubscriptions": false, "computeInstanceGroup": { "id": "asg-web-prod", "externalId": "asg-web-prod-01", "name": "web-prod-asg", "replicaCount": 4, "tags": { "env": "prod" } }, "nativeType": "ec2", "isUsedOnPrem": false, "resourceGroupExternalId": null }, "sourceMappedCodeFindings": [], "transitivity": null, "rootComponent": null, "isHighProfileThreat": false, "vendorSeverity": "HIGH", "nvdSeverity": "HIGH", "weightedSeverity": "HIGH", "hasExploit": true, "usedInCodeResult": null, "hasCisaKevExploit": false, "cisaKevReleaseDate": null, "cisaKevDueDate": null, "score": 7.5, "epssSeverity": "CRITICAL", "epssPercentile": 0.981, "epssProbability": 0.91, "categories": ["PRIVILEGE_ESCALATION"], "hasInitialAccessPotential": false, "isClientSide": false, "affectedBySettings": false, "codeLibraryLanguage": null, "exploitabilityValidationStatus": "EXPLOITABLE", "cvssv2": null, "cvssv3": { "attackVector": "LOCAL", "attackComplexity": "LOW", "confidentialityImpact": "HIGH", "integrityImpact": "HIGH", "privilegesRequired": "LOW", "userInteractionRequired": false, "vectorString": "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "scope": "UNCHANGED" }, "effectiveAvailabilityImpact": "HIGH", "cnaScore": 7.5, "vendorScore": 7.5, "origin": "CONTEXTUAL", "duplicateOf": null }], "pageInfo": { "hasNextPage": false, "endCursor": null } } } };
  var SAMPLE_GROUPED = { "data": { "vulnerabilityFindingsGroupedByValues": { "nodes": [{ "id": "CLCh_PAJEgEBIigKJhokYjA2Njk1ZDUtYjI3MS01OGYzLTllMjctYzViOTc2NTgxNDJl", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "b06695d5-b271-58f3-9e27-c5b97658142e", "type": "VIRTUAL_MACHINE", "name": "gke-inix-gke-eu-pr-n4-shared-19b3-fc6dab19-05ru", "cloudPlatform": "GCP", "externalId": "4787123027339367533", "subscriptionId": "2b2211fb-742f-5566-af67-ab8992b58cfb", "subscriptionName": "inix-tt4k", "subscriptionExternalId": "inix-tt4k", "tags": { "cluster_name": "inix-gke-eu-pr", "gke-inix-eu-pr-nodes-europe-west4": "gke-inix-eu-pr-nodes-europe-west4", "gke-inix-gke-eu-pr": "gke-inix-gke-eu-pr", "gke-inix-gke-eu-pr-b3192bb3-node": "gke-inix-gke-eu-pr-b3192bb3-node", "gke-inix-gke-eu-pr-n4-shared": "gke-inix-gke-eu-pr-n4-shared", "goog-gke-cluster-id-base32": "wmmsxm4ye5fsxldvevyserwhpfnupmogu4ausbma6yys6hfhup2q", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "on-demand", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "inix-gke-eu-pr", "goog-k8s-node-pool-name": "n4-shared-19b3", "goog-terraform-provisioned": "true", "project": "inix-tt4k", "tag-inix-gke-eu-pr-ingress": "tag-inix-gke-eu-pr-ingress" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 63, "criticalSeverityFindingCount": 63, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokNjY0NTc5MjYtMzUxMy01M2ViLWEwOWYtMGU5MGI2ZjRmZWZm", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "66457926-3513-53eb-a09f-0e90b6f4feff", "type": "VIRTUAL_MACHINE", "name": "ENMFV0APP02", "cloudPlatform": "Alibaba", "externalId": "i-uf623aepimaj7zev1n25", "subscriptionId": "1fafc3d1-bbe3-5d13-8698-3df1f4514e37", "subscriptionName": "ENMS-PP", "subscriptionExternalId": "1985932850711133", "tags": { "Account": "1985932850711133", "Base_nsg_type": "VMPPD", "Domain": "VMM", "Env": "preprod", "Environment": "PREPROD", "Project": "ENM", "Terraform": "yes", "Vendor": "aliyun" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 57, "criticalSeverityFindingCount": 57, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokM2FhYmI4MTAtNWM1ZC01NjAzLTkyMmUtZTIxZmU2MGQ4ZDcz", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "3aabb810-5c5d-5603-922e-e21fe60d8d73", "type": "VIRTUAL_MACHINE", "name": "ENMFV0APP01", "cloudPlatform": "Alibaba", "externalId": "i-uf6eef938p2fzi1of1en", "subscriptionId": "1fafc3d1-bbe3-5d13-8698-3df1f4514e37", "subscriptionName": "ENMS-PP", "subscriptionExternalId": "1985932850711133", "tags": { "Account": "1985932850711133", "Base_nsg_type": "VMPPD", "Domain": "VMM", "Env": "preprod", "Environment": "PREPROD", "Project": "ENM", "Terraform": "yes", "Vendor": "aliyun" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 57, "criticalSeverityFindingCount": 57, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokYzQzM2M5YTktZTYzMS01ZDU2LThiZDgtM2MxY2RkZDkzMTAz", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "c433c9a9-e631-5d56-8bd8-3c1cddd93103", "type": "VIRTUAL_MACHINE", "name": "gke-vctech-gke-eu-pp-n4-shared-0d05f181-ep29", "cloudPlatform": "GCP", "externalId": "7603203856350539437", "subscriptionId": "86a11580-2086-56a7-88d2-27f405958fcb", "subscriptionName": "INIX-VCTECH", "subscriptionExternalId": "inix-vctech-0alr", "tags": { "cost_center": "50001z0536-001", "gke-vctech-gke-eu-pp": "gke-vctech-gke-eu-pp", "gke-vctech-gke-eu-pp-6830a116-node": "gke-vctech-gke-eu-pp-6830a116-node", "gke-vctech-gke-eu-pp-shared": "gke-vctech-gke-eu-pp-shared", "goog-fleet-project": "464185428346", "goog-gke-cluster-id-base32": "naykcfw275ezfoxzjnzpvvbquab2ieq336dell4s2ntdywfh43gq", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "on-demand", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "vctech-gke-eu-pp", "goog-k8s-node-pool-name": "n4-shared", "net-gkenodes-inix-azae-prod-europe-west4": "net-gkenodes-inix-azae-prod-europe-west4", "net-main-gkenodes": "net-main-gkenodes", "owner": "jkrawc50", "project": "vctech-gke-eu-pp", "tag-vctech-gke-eu-pp-client": "tag-vctech-gke-eu-pp-client", "terraform": "true" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 56, "criticalSeverityFindingCount": 56, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokY2UwMGQ3ODQtMmE5OC01NjRlLThkM2UtYjZhYzNmNjQ5Mjdk", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "ce00d784-2a98-564e-8d3e-b6ac3f64927d", "type": "VIRTUAL_MACHINE", "name": "gke-inix-gke-eu-pp-pdk-72ab-941a6f69-fqrw", "cloudPlatform": "GCP", "externalId": "1511864616192343110", "subscriptionId": "f391b2ee-ffdf-58e1-a3af-a59bfeaba3dc", "subscriptionName": "inix-horsprod-n0wq", "subscriptionExternalId": "inix-horsprod-n0wq", "tags": { "cluster_name": "inix-gke-eu-pp", "gke-inix-eu-pp-nodes-europe-west4": "gke-inix-eu-pp-nodes-europe-west4", "gke-inix-gke-eu-pp": "gke-inix-gke-eu-pp", "gke-inix-gke-eu-pp-988606d9-node": "gke-inix-gke-eu-pp-988606d9-node", "gke-inix-gke-eu-pp-pdk": "gke-inix-gke-eu-pp-pdk", "goog-fleet-project": "inix-horsprod-n0wq", "goog-gke-cluster-id-base32": "tcdanwnkgndvzlohnlhmoapayhybvkjeqbfuokve2ufprzvps45q", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "spot", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "inix-gke-eu-pp", "goog-k8s-node-pool-name": "pdk-72ab", "goog-terraform-provisioned": "true", "project": "inix-horsprod-n0wq", "tag-inix-gke-eu-pp-ingress": "tag-inix-gke-eu-pp-ingress" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 49, "criticalSeverityFindingCount": 49, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokMTRlODJlYTAtOTgwNC01ZDJlLWE2OWUtNjhkNjg4NTU3OGY4", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "14e82ea0-9804-5d2e-a69e-68d6885578f8", "type": "VIRTUAL_MACHINE", "name": "gke-vctech-gke-eu-pr-n4-shared-c8e798db-duig", "cloudPlatform": "GCP", "externalId": "3799583756770569928", "subscriptionId": "86a11580-2086-56a7-88d2-27f405958fcb", "subscriptionName": "INIX-VCTECH", "subscriptionExternalId": "inix-vctech-0alr", "tags": { "cost_center": "50001z0536-001", "gke-vctech-gke-eu-pr": "gke-vctech-gke-eu-pr", "gke-vctech-gke-eu-pr-860fef39-node": "gke-vctech-gke-eu-pr-860fef39-node", "gke-vctech-gke-eu-pr-shared": "gke-vctech-gke-eu-pr-shared", "goog-gke-cluster-id-base32": "qyh66omu7jhr3bmgaftrfvltkjzc5ifdvowuvqm4dikservhcbua", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "on-demand", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "vctech-gke-eu-pr", "goog-k8s-node-pool-name": "n4-shared", "net-gkenodes-inix-azae-prod-europe-west4": "net-gkenodes-inix-azae-prod-europe-west4", "net-main-gkenodes": "net-main-gkenodes", "owner": "jkrawc50", "project": "vctech-gke-eu-pr", "tag-vctech-gke-eu-pr-client": "tag-vctech-gke-eu-pr-client", "terraform": "true" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 49, "criticalSeverityFindingCount": 49, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokYjQ2ZWYyZDMtNTEyMS01YTg4LWFkMTEtNzNhNDYwZjI0OWFm", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "b46ef2d3-5121-5a88-ad11-73a460f249af", "type": "VIRTUAL_MACHINE", "name": "ENMFN0APP01", "cloudPlatform": "Alibaba", "externalId": "i-uf67w5ntp88b10tn592w", "subscriptionId": "d7297fe3-6ae8-59e5-b456-5050a1ca195b", "subscriptionName": "ENMS-pr", "subscriptionExternalId": "1950243589136840", "tags": { "Account": "1950243589136840", "Base_nsg_type": "VMPRD", "Domain": "VMM", "Env": "production", "Environment": "PROD", "Project": "ENM", "Terraform": "yes", "Vendor": "aliyun" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 43, "criticalSeverityFindingCount": 43, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokYjM0YTQ1YmEtZTg2MC01NTc5LWE3MzYtNzYzMmQ0NTdlYjIw", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "b34a45ba-e860-5579-a736-7632d457eb20", "type": "VIRTUAL_MACHINE", "name": "ENMFN0APP02", "cloudPlatform": "Alibaba", "externalId": "i-uf60a6i74bym0d8wjtx0", "subscriptionId": "d7297fe3-6ae8-59e5-b456-5050a1ca195b", "subscriptionName": "ENMS-pr", "subscriptionExternalId": "1950243589136840", "tags": { "Account": "1950243589136840", "Base_nsg_type": "VMPRD", "Domain": "VMM", "Env": "production", "Environment": "PROD", "Project": "ENM", "Terraform": "yes", "Vendor": "aliyun" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 43, "criticalSeverityFindingCount": 43, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokYzk4Mjg1MjktODNiZS01YTU4LTlhOGEtYTA5NGY3MGE3MjZh", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "c9828529-83be-5a58-9a8a-a094f70a726a", "type": "VIRTUAL_MACHINE", "name": "gke-vctech-gke-eu-pr-n4-shared-ada1118f-g9m6", "cloudPlatform": "GCP", "externalId": "8251205178823763465", "subscriptionId": "86a11580-2086-56a7-88d2-27f405958fcb", "subscriptionName": "INIX-VCTECH", "subscriptionExternalId": "inix-vctech-0alr", "tags": { "cost_center": "50001z0536-001", "gke-vctech-gke-eu-pr": "gke-vctech-gke-eu-pr", "gke-vctech-gke-eu-pr-860fef39-node": "gke-vctech-gke-eu-pr-860fef39-node", "gke-vctech-gke-eu-pr-shared": "gke-vctech-gke-eu-pr-shared", "goog-gke-cluster-id-base32": "qyh66omu7jhr3bmgaftrfvltkjzc5ifdvowuvqm4dikservhcbua", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "on-demand", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "vctech-gke-eu-pr", "goog-k8s-node-pool-name": "n4-shared", "net-gkenodes-inix-azae-prod-europe-west4": "net-gkenodes-inix-azae-prod-europe-west4", "net-main-gkenodes": "net-main-gkenodes", "owner": "jkrawc50", "project": "vctech-gke-eu-pr", "tag-vctech-gke-eu-pr-client": "tag-vctech-gke-eu-pr-client", "terraform": "true" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 42, "criticalSeverityFindingCount": 42, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }, { "id": "CLCh_PAJEgEBIigKJhokOWQzNDg5N2UtNDRjZi01YTU1LThmZjctYjE5NmZhNWU4ZmQ4", "project": null, "baseContainerImage": null, "vcsOrganization": null, "locationPath": null, "kubernetesCluster": null, "containerService": null, "kubernetesNamespace": null, "computeInstanceGroup": null, "applicationService": null, "environment": null, "cloudPlatform": null, "vulnerableAsset": { "id": "9d34897e-44cf-5a55-8ff7-b196fa5e8fd8", "type": "VIRTUAL_MACHINE", "name": "gke-vctech-gke-eu-pp-n4-shared-c95b019b-qhwp", "cloudPlatform": "GCP", "externalId": "5646838182778991520", "subscriptionId": "86a11580-2086-56a7-88d2-27f405958fcb", "subscriptionName": "INIX-VCTECH", "subscriptionExternalId": "inix-vctech-0alr", "tags": { "cost_center": "50001z0536-001", "gke-vctech-gke-eu-pp": "gke-vctech-gke-eu-pp", "gke-vctech-gke-eu-pp-6830a116-node": "gke-vctech-gke-eu-pp-6830a116-node", "gke-vctech-gke-eu-pp-shared": "gke-vctech-gke-eu-pp-shared", "goog-fleet-project": "464185428346", "goog-gke-cluster-id-base32": "naykcfw275ezfoxzjnzpvvbquab2ieq336dell4s2ntdywfh43gq", "goog-gke-cost-management": "", "goog-gke-node": "", "goog-gke-node-pool-provisioning-model": "on-demand", "goog-k8s-cluster-location": "europe-west4", "goog-k8s-cluster-name": "vctech-gke-eu-pp", "goog-k8s-node-pool-name": "n4-shared", "net-gkenodes-inix-azae-prod-europe-west4": "net-gkenodes-inix-azae-prod-europe-west4", "net-main-gkenodes": "net-main-gkenodes", "owner": "jkrawc50", "project": "vctech-gke-eu-pp", "tag-vctech-gke-eu-pp-client": "tag-vctech-gke-eu-pp-client", "terraform": "true" } }, "vulnerableAssetType": null, "vulnerableAssetTags": null, "cloudAccount": null, "resourceGroup": null, "containerRegistry": null, "containerRepository": null, "vcsRepository": null, "vcsCodeAuthor": null, "detailedName": null, "fixedVersion": null, "recommendedVersion": null, "artifactType": null, "detectionMethod": null, "analytics": { "vulnerableAssetCount": 1, "totalFindingCount": 35, "criticalSeverityFindingCount": 35, "highSeverityFindingCount": 0, "mediumSeverityFindingCount": 0, "lowSeverityFindingCount": 0, "informationalSeverityFindingCount": 0 }, "virtualMachineImage": null, "operatingSystemDistribution": null, "name": null, "originFinding": null, "originFindingPolicy": null, "origin": null, "sourceMappedCodeFinding": null, "sourceMappedCodeRepository": null, "sourceMappedCodeResource": null }], "pageInfo": { "hasNextPage": true, "endCursor": "eyJmaWVsZHMiOlt7IkZpZWxkIjoiY3JpdGljYWxTZXZlcml0eUZpbmRpbmdDb3VudCIsIlZhbHVlIjozNX0seyJGaWVsZCI6ImhpZ2hTZXZlcml0eUZpbmRpbmdDb3VudCIsIlZhbHVlIjowfSx7IkZpZWxkIjoibWVkaXVtU2V2ZXJpdHlGaW5kaW5nQ291bnQiLCJWYWx1ZSI6MH0seyJGaWVsZCI6Imxvd1NldmVyaXR5RmluZGluZ0NvdW50IiwiVmFsdWUiOjB9LHsiRmllbGQiOiJpbmZvcm1hdGlvbmFsU2V2ZXJpdHlGaW5kaW5nQ291bnQiLCJWYWx1ZSI6MH0seyJGaWVsZCI6Imdyb3VwQnlLZXkiLCJWYWx1ZSI6IjlkMzQ4OTdlLTQ0Y2YtNWE1NS04ZmY3LWIxOTZmYTVlOGZkOCJ9XX0=" } } } };

  // src/server/scanJobs.ts
  var BUDGET_MS = 27e4;
  var FIRST_STEP_BUDGET_MS = 45e3;
  var CONTINUE_DELAY_MS = 3e4;
  var CONTINUE_HANDLER = "trigger_continueScan";
  var DELTA_OVERLAP_MINUTES = 15;
  var STALE_JOB_MS = 30 * 6e4;
  var ScanCancelled = class extends Error {
  };
  var cancelKey = (jobId) => `CANCEL_${jobId}`;
  function isCancelRequested(jobId) {
    return Boolean(getProp(cancelKey(jobId)));
  }
  function clearCancel(jobId) {
    deleteProp(cancelKey(jobId));
  }
  function cancelScan(jobId) {
    const job = getJob(jobId);
    if (!job || job.kind !== "scan") return { jobId, message: "No such scan." };
    if (job.phase === "DONE" || job.phase === "FAILED" || job.phase === "CANCELLED") {
      return { jobId, message: "Scan already finished." };
    }
    setProp(cancelKey(jobId), "1");
    return { jobId, message: forceStopIfOrphaned(jobId) ? "Scan stopped." : "Stopping scan\u2026" };
  }
  function forceStopIfOrphaned(jobId) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1e3)) return false;
    try {
      const job = getJob(jobId);
      if (!job || job.kind !== "scan") return false;
      if (job.phase !== "FETCHING" && job.phase !== "RECONCILING") return false;
      clearContinuationTriggers();
      finalizeCancel(job);
      return true;
    } finally {
      lock.releaseLock();
    }
  }
  function finalizeCancel(job) {
    try {
      if (job.scan_id) trashScanArchive(scanFolder(job.scan_id).getId());
    } catch {
    }
    updateJob(job.job_id, { phase: "CANCELLED", error: null });
    clearCancel(job.job_id);
  }
  var SLIM_TOP = [
    "id",
    "name",
    "severity",
    "status",
    "firstDetectedAt",
    "firstSeenAt",
    "createdAt",
    "lastDetectedAt",
    "resolvedAt",
    "remediatedAt",
    "fixedAt",
    "detailedName",
    "detailedNameV2",
    "fixedVersion",
    "detectionMethod",
    "vendorSeverity",
    "nvdSeverity",
    "weightedSeverity",
    "score",
    "epssSeverity",
    "epssProbability",
    "hasExploit",
    "hasCisaKevExploit",
    "publishedDate",
    "dataSourceName",
    // Vendor-fix signals for the actionable clock / awaiting-vendor-fix segment.
    // Additive: frames persisted before this simply lack the keys (read as null).
    "fixDate",
    "fixDateBefore",
    "isOperatingSystemEndOfLife"
  ];
  var SLIM_ASSET = [
    "id",
    "name",
    "type",
    "cloudPlatform",
    "region",
    "subscriptionName",
    "subscriptionExternalId",
    "subscriptionId",
    "tags",
    "operatingSystem",
    // Exposure signals for the insights view. Additive: frames persisted before this
    // simply lack the keys, and the client reports exposure as "not captured".
    "hasWideInternetExposure",
    "hasLimitedInternetExposure"
  ];
  function slimRecord(node) {
    const out = {};
    for (const k of SLIM_TOP) {
      if (k in node) out[k] = node[k];
    }
    const va = node["vulnerableAsset"];
    if (va && typeof va === "object" && !Array.isArray(va)) {
      const slim = {};
      for (const k of SLIM_ASSET) {
        if (k in va) slim[k] = va[k];
      }
      out["vulnerableAsset"] = slim;
    }
    return out;
  }
  function writeFrameSafely(scanId, records, pageOf) {
    try {
      writeFrame(scanId, buildFrame(records, pageOf));
    } catch (e) {
      console.warn(`Failed to write findings frame for ${scanId}: ${e}`);
    }
  }
  function envelope(nodes) {
    return { data: { vulnerabilityFindings: { nodes } } };
  }
  function startScan(options = {}) {
    return withScriptLock(() => {
      recoverIfNeeded();
      const active = activeJob();
      if (active && !reclaimStaleJob(active)) {
        return { jobId: active.job_id, message: "A scan is already in progress." };
      }
      if (!hasWizCredentials()) return dryRunScan(options);
      if (options.incremental) return startIncremental();
      const scanId = nowIso();
      const job = createJob({
        job_id: newJobId("scan"),
        kind: "scan",
        phase: "FETCHING",
        scan_id: scanId,
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: JSON.stringify({
          mode: "live",
          severities: getFetchSeverities2(),
          extraFilterBy: null,
          incremental: false,
          baselineScanId: null
        }),
        journal_ref: null,
        error: null
      });
      step(job, FIRST_STEP_BUDGET_MS);
      return { jobId: job.job_id, message: "Scan started." };
    });
  }
  function reclaimStaleJob(job) {
    const updated = parseTs(job.updated_at);
    if (updated !== null && Date.now() - updated < STALE_JOB_MS) return false;
    clearContinuationTriggers();
    clearCancel(job.job_id);
    updateJob(job.job_id, {
      phase: "FAILED",
      error: "Reclaimed: the job stalled with no progress."
    });
    return true;
  }
  function startIncremental() {
    const baseline = latestFlatScanRow();
    if (!baseline) {
      return { jobId: null, message: "Run a full scan first \u2014 quick refresh needs a baseline." };
    }
    const baseTs = parseTs(baseline.ts);
    if (baseTs === null) {
      return { jobId: null, message: "The saved baseline has no timestamp \u2014 run a full scan." };
    }
    const sinceIso = toIso(baseTs - DELTA_OVERLAP_MINUTES * 6e4);
    const baselineScope = parseSeverities(baseline.severities);
    const scanId = nowIso();
    const job = createJob({
      job_id: newJobId("scan"),
      kind: "scan",
      phase: "FETCHING",
      scan_id: scanId,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: JSON.stringify({
        mode: "incremental",
        severities: baselineScope,
        extraFilterBy: { updatedAt: { after: sinceIso } },
        incremental: true,
        baselineScanId: baseline.scan_id
      }),
      journal_ref: null,
      error: null
    });
    step(job);
    return { jobId: job.job_id, message: "Quick refresh started." };
  }
  function dryRunScan(options) {
    const scanId = nowIso();
    if (options.sampleShape === "grouped") {
      const nodes2 = extractNodes(SAMPLE_GROUPED);
      writeScanPage(scanId, 1, SAMPLE_GROUPED);
      persistGroupedScan2(nodes2, {
        mode: "dry-run",
        scanId,
        rawRef: scanFolder(scanId).getId()
      });
      return { jobId: null, message: "Dry-run grouped scan saved." };
    }
    const seq = loadScanRows().filter((s) => s.mode.startsWith("dry-run")).length;
    const nodes = extractNodes(SAMPLE_FLAT).map((n) => ({ ...n }));
    const open = nodes.filter((n) => !n["resolvedAt"]);
    for (let i = 0; i < Math.min(seq, open.length); i++) {
      open[i]["resolvedAt"] = scanId;
      open[i]["status"] = "RESOLVED";
    }
    writeScanPage(scanId, 1, envelope(nodes));
    const slim = nodes.map(slimRecord);
    writeSlimRecords(scanId, slim);
    writeFrameSafely(scanId, slim, () => 1);
    persistFlatScan2(slim, {
      mode: options.incremental ? "dry-run-incremental" : "dry-run",
      scanId,
      scannedSeverities: null,
      rawRef: scanFolder(scanId).getId()
    });
    afterPersist(slim);
    return { jobId: null, message: "Dry-run scan saved." };
  }
  function step(job, budgetMs = BUDGET_MS) {
    var _a, _b, _c;
    const started = Date.now();
    const params = JSON.parse((_a = job.params_json) != null ? _a : "{}");
    const scanId = job.scan_id;
    let slim = job.page > 0 ? (_b = readSlimRecords(scanId)) != null ? _b : [] : [];
    const pageRuns = job.page > 0 ? (_c = readPageRuns(scanId)) != null ? _c : [] : [];
    let cursor = job.cursor;
    let page = job.page;
    let findings = job.findings_so_far;
    let totalCount = job.total_count;
    try {
      for (; ; ) {
        if (isCancelRequested(job.job_id)) throw new ScanCancelled();
        const result = fetchPage({
          severities: params.severities,
          extraFilterBy: params.extraFilterBy,
          cursor,
          pageNumber: page
        });
        const pageName = params.incremental ? page + 1001 : page + 1;
        writeScanPage(scanId, pageName, envelope(result.nodes));
        slim.push(...result.nodes.map(slimRecord));
        pageRuns.push([pageName, result.nodes.length]);
        page += 1;
        findings += result.nodes.length;
        cursor = result.endCursor;
        if (result.totalCount !== null) totalCount = result.totalCount;
        updateJob(job.job_id, { cursor, page, findings_so_far: findings, total_count: totalCount });
        if (!result.hasNextPage || page >= MAX_PAGES) break;
        if (Date.now() - started > budgetMs) {
          writeSlimRecords(scanId, slim);
          writePageRuns(scanId, pageRuns);
          scheduleContinuation();
          return;
        }
      }
      writeSlimRecords(scanId, slim);
      writePageRuns(scanId, pageRuns);
      updateJob(job.job_id, { phase: "RECONCILING" });
      finishScan(job.job_id, scanId, params, slim);
    } catch (e) {
      if (e instanceof ScanCancelled) {
        finalizeCancel(job);
        return;
      }
      if (e instanceof WizDeltaFilterError) {
        clearCancel(job.job_id);
        updateJob(job.job_id, {
          phase: "FAILED",
          error: "The tenant rejected the updatedAt filter \u2014 quick refresh is unavailable; run a full scan."
        });
        return;
      }
      clearCancel(job.job_id);
      updateJob(job.job_id, {
        phase: "FAILED",
        error: e == null ? "Scan failed." : String(e).slice(0, 1e3)
      });
      throw e;
    }
  }
  function finishScan(jobId, scanId, params, slim) {
    clearCancel(jobId);
    let records = slim;
    if (params.incremental) {
      if (!slim.length) {
        updateJob(jobId, { phase: "DONE", error: null });
        trashScanArchive(scanFolder(scanId).getId());
        return;
      }
      const baselineSlim = loadBaselineSlim(params.baselineScanId);
      if (baselineSlim === null) {
        updateJob(jobId, {
          phase: "FAILED",
          error: "The baseline scan's archive couldn't be read \u2014 run a full scan."
        });
        return;
      }
      records = mergeNodes(baselineSlim, slim);
      let pageNo = 1;
      for (let i = 0; i < records.length; i += 500) {
        writeScanPage(scanId, pageNo++, envelope(records.slice(i, i + 500)));
      }
      writeSlimRecords(scanId, records);
      writeFrameSafely(scanId, records, (i) => Math.floor(i / 500) + 1);
    } else {
      writeFrameSafely(scanId, records, pageOfFromRuns(readPageRuns(scanId), records.length));
    }
    updateJob(jobId, { phase: "PERSISTING", scan_id: scanId });
    persistFlatScan2(records, {
      mode: params.mode,
      scanId,
      scannedSeverities: params.severities,
      rawRef: scanFolder(scanId).getId(),
      jobId
    });
    afterPersist(records);
    updateJob(jobId, { phase: "DONE" });
  }
  function loadBaselineSlim(baselineScanId) {
    const slim = readSlimRecords(baselineScanId);
    if (slim && slim.length) return slim;
    const row = loadScanRows().find((s) => s.scan_id === baselineScanId);
    const payload = row ? readScanPayload(row.raw_ref) : null;
    if (!payload) return null;
    const nodes = extractNodes(payload);
    return nodes.length ? nodes.map(slimRecord) : null;
  }
  function afterPersist(records) {
    var _a, _b;
    refreshSupportGroupsAfterScan();
    try {
      const { perSev, overall } = calculateMttr(records);
      const median2 = overall.mttr_median;
      if (median2 !== null && median2 !== void 0) {
        const { slaPct, oldestDays } = overallSlaOldest(perSev);
        recordSnapshot(
          median2,
          (_a = overall.resolved) != null ? _a : 0,
          (_b = overall.open) != null ? _b : 0,
          countBySeverity(records),
          null,
          slaPct,
          oldestDays,
          openPastSlaFromRecords(records)
        );
      }
    } catch (e) {
      console.warn(`Failed to record MTTR snapshot: ${e}`);
    }
    try {
      if (!getAutoCompact2()) return;
      const days = getRetentionDays2();
      if (days === null) return;
      compactLedger(days);
    } catch (e) {
      console.warn(`Auto-compaction failed: ${e}`);
    }
  }
  function refreshSupportGroupsAfterScan() {
    if (!hasWizCredentials()) return;
    try {
      refreshSupportGroups();
    } catch (e) {
      console.warn(`Support-group refresh after scan failed: ${e}`);
    }
  }
  function scheduleContinuation() {
    ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(CONTINUE_DELAY_MS).create();
  }
  function clearContinuationTriggers() {
    for (const t of ScriptApp.getProjectTriggers()) {
      if (t.getHandlerFunction() === CONTINUE_HANDLER) ScriptApp.deleteTrigger(t);
    }
  }
  function continueJob(_e) {
    withScriptLock(() => {
      var _a, _b;
      clearContinuationTriggers();
      const job = activeJob();
      if (!job || job.kind !== "scan") return;
      if (job.phase === "FETCHING") {
        if (isCancelRequested(job.job_id)) {
          finalizeCancel(job);
          return;
        }
        step(job);
      } else if (job.phase === "RECONCILING") {
        const params = JSON.parse((_a = job.params_json) != null ? _a : "{}");
        const slim = (_b = readSlimRecords(job.scan_id)) != null ? _b : [];
        finishScan(job.job_id, job.scan_id, params, slim);
      }
    }, 12e4);
  }
  function dailyScan() {
    if (!hasWizCredentials()) return;
    startScan({ incremental: false });
  }
  function jobStatus(jobId) {
    return getJob(jobId);
  }

  // src/server/api.ts
  function run(fn) {
    try {
      return { ok: true, data: fn() };
    } catch (e) {
      const kind = e instanceof SealedScanError ? "sealed" : e instanceof LedgerRebuildError ? "rebuild" : e instanceof LedgerBusyError ? "busy" : "error";
      return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: kind };
    }
  }
  function mutate(fn) {
    return run(
      () => withScriptLock(() => {
        recoverIfNeeded();
        return fn();
      })
    );
  }
  function bootstrap(_p) {
    return run(() => ({
      // The core is a pure function of ledger + settings state — cached per DATA_VERSION.
      ...cached("bootstrapCore", null, bootstrapCore),
      // Live per-request fields: never cached (activeJob changes every poll tick).
      dataVersion: dataVersion(),
      hasCredentials: hasWizCredentials(),
      activeJob: activeJobSummary()
    }));
  }
  function bootstrapCore() {
    var _a;
    const scan = currentScan();
    const latest = latestScanRow();
    const counts = {};
    let unassignedCount = 0;
    if (scan) {
      for (const r of scan.records) {
        const sev2 = String(r["_sev"]);
        counts[sev2] = ((_a = counts[sev2]) != null ? _a : 0) + 1;
        if (r["_domain"] === UNASSIGNED) unassignedCount += 1;
      }
    }
    return {
      palette: {
        order: SEVERITY_ORDER,
        colors: SEVERITY_COLORS,
        glyphs: SEVERITY_GLYPHS,
        slaTargets: SLA_TARGETS,
        selectable: SELECTABLE_SEVERITIES
      },
      settings: {
        fetchSeverities: getFetchSeverities2(),
        displaySeverities: getDisplaySeverities2(),
        retentionDays: getRetentionDays2(),
        fastLaneDays: getFastLaneDays2(),
        autoCompact: getAutoCompact2(),
        domains: getDomains2()
      },
      latestScan: latest ? {
        scanId: latest.scan_id,
        ts: latest.ts,
        mode: latest.mode,
        shape: latest.shape,
        total: latest.total,
        severities: latest.severities
      } : null,
      counts,
      unassignedCount,
      prevCounts: previousSeverityCounts(),
      domainNames: domainNames(getDomains2().items),
      filterOptions: scan ? {
        statuses: distinct(scan.records, "status"),
        assetTypes: distinct(scan.records, "vulnerableAsset.type"),
        clouds: distinct(scan.records, "vulnerableAsset.cloudPlatform"),
        subscriptions: distinct(scan.records, "vulnerableAsset.subscriptionName"),
        supportGroups: distinct(scan.records, "_supportGroup")
      } : { statuses: [], assetTypes: [], clouds: [], subscriptions: [], supportGroups: [] }
    };
  }
  function activeJobSummary() {
    var _a;
    return (_a = activeJob()) != null ? _a : null;
  }
  function getFindings(p) {
    return run(() => {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
      const params = p != null ? p : {};
      const scan = currentScan();
      if (!scan) return { rows: [], total: 0, counts: {}, page: 0, pageCount: 0, groups: null };
      const filters = {
        severities: (_a = params["severities"]) != null ? _a : getDisplaySeverities2(),
        statuses: (_b = params["statuses"]) != null ? _b : [],
        assetTypes: (_c = params["assetTypes"]) != null ? _c : [],
        clouds: (_d = params["clouds"]) != null ? _d : [],
        domains: (_e = params["domains"]) != null ? _e : [],
        supportGroups: (_f = params["supportGroups"]) != null ? _f : [],
        q: (_g = params["q"]) != null ? _g : ""
      };
      const filtered = applyFilters(scan.records, filters);
      const counts = {};
      for (const r of filtered) {
        const sev2 = String(r["_sev"]);
        counts[sev2] = ((_h = counts[sev2]) != null ? _h : 0) + 1;
      }
      const groupBy = (_i = params["groupBy"]) != null ? _i : "";
      if (groupBy) {
        const keyFor = groupKeyFn(groupBy);
        const groups = /* @__PURE__ */ new Map();
        for (const r of filtered) {
          const k = keyFor(r);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(r);
        }
        const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 30);
        return {
          rows: [],
          total: filtered.length,
          counts,
          page: 0,
          pageCount: 0,
          groups: ordered.map(([key, rows]) => ({
            key,
            count: rows.length,
            sevCounts: sevCountsOf(rows),
            rows: rows.slice(0, 250).map(tableRow)
            // per-group row cap
          }))
        };
      }
      if (params["all"] === true && filtered.length <= CLIENT_ALL_MAX) {
        return {
          rows: filtered.map(tableRow),
          total: filtered.length,
          counts,
          page: 0,
          pageCount: 1,
          groups: null,
          all: true
        };
      }
      const pageSize = Math.min(Number((_j = params["pageSize"]) != null ? _j : 100), 500);
      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      const page = Math.min(Math.max(Number((_k = params["page"]) != null ? _k : 0), 0), pageCount - 1);
      return {
        rows: filtered.slice(page * pageSize, (page + 1) * pageSize).map(tableRow),
        total: filtered.length,
        counts,
        page,
        pageCount,
        groups: null
      };
    });
  }
  var CLIENT_ALL_MAX = 3e3;
  function groupKeyFn(groupBy) {
    var _a;
    const col = {
      severity: "_sev",
      status: "status",
      atype: "vulnerableAsset.type",
      cloud: "vulnerableAsset.cloudPlatform",
      asset: "vulnerableAsset.name",
      subscription: "vulnerableAsset.subscriptionName",
      domain: "_domain",
      supportGroup: "_supportGroup"
    };
    const c = (_a = col[groupBy]) != null ? _a : "_sev";
    return (r) => present(r[c]) ? String(r[c]) : "(none)";
  }
  function readStringArray(p, key) {
    const raw = p == null ? void 0 : p[key];
    return Array.isArray(raw) ? raw.map(String) : [];
  }
  function supportGroupPredicate(single, set) {
    const keep = set.length ? new Set(set) : null;
    return (v) => (!single || v === single) && (!keep || keep.has(v));
  }
  function sevCountsOf(rows) {
    var _a;
    const out = {};
    for (const r of rows) {
      const sev2 = String(r["_sev"]);
      out[sev2] = ((_a = out[sev2]) != null ? _a : 0) + 1;
    }
    return out;
  }
  function getFindingDetail(p) {
    return run(() => {
      var _a, _b, _c, _d;
      const key = String((_a = p == null ? void 0 : p["vulnKey"]) != null ? _a : "");
      const scan = currentScan();
      if (!scan || !key) return { record: null, raw: null };
      const record = (_b = scan.records.find((r) => r["_vuln_key"] === key)) != null ? _b : null;
      let raw = null;
      const pageNo = record && typeof record["_page"] === "number" ? record["_page"] : null;
      if (pageNo !== null) {
        const page = readScanPage(scan.scanId, pageNo);
        if (page) raw = (_c = extractNodes(page).find((n) => vulnKey(n) === key)) != null ? _c : null;
      }
      if (!raw) {
        const row = loadScanRows().find((s) => s.scan_id === scan.scanId);
        const payload = row ? readScanPayload(row.raw_ref) : null;
        if (payload && Array.isArray(payload)) {
          for (const page of payload) {
            const nodes = extractNodes(page);
            raw = (_d = nodes.find((n) => vulnKey(n) === key)) != null ? _d : null;
            if (raw) break;
          }
        }
      }
      return { record, raw };
    });
  }
  function insightsData(p) {
    var _a, _b;
    const scan = currentScan();
    if (!scan) return { flatScan: false };
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const supportGroupSet = readStringArray(p, "supportGroups");
    const sgActive = Boolean(supportGroup) || supportGroupSet.length > 0;
    const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
    let recs = scan.records;
    let base = loadBaseRows();
    attachSupportGroups(base);
    const compiled = compileDomains(getDomains2().items);
    for (const r of base) r["_domain"] = assignDomain(r, compiled);
    if (domain || sgActive) {
      if (sgActive) {
        recs = recs.filter((r) => {
          var _a2;
          return sgMatch(String((_a2 = r["_supportGroup"]) != null ? _a2 : ""));
        });
        base = base.filter((r) => {
          var _a2;
          return sgMatch(String((_a2 = r["_supportGroup"]) != null ? _a2 : ""));
        });
      }
      if (domain) {
        recs = recs.filter((r) => {
          var _a2;
          return String((_a2 = r["_domain"]) != null ? _a2 : UNASSIGNED) === domain;
        });
        base = base.filter((r) => {
          var _a2;
          return String((_a2 = r["_domain"]) != null ? _a2 : UNASSIGNED) === domain;
        });
      }
    }
    const severities = readSeverities(p);
    recs = filterSeverities(recs, severities);
    base = filterSeverities(base, severities);
    const latestFlat = latestFlatScanRow();
    return {
      flatScan: true,
      domain,
      supportGroup,
      scan: { scanId: scan.scanId, ts: scan.ts, total: scan.total },
      // Domain-scoped severity counts + total so the Overview headline can stay
      // coherent under a filter (the KPI band otherwise reads whole-scan bootstrap
      // counts). Movement's new/resolved/reopened remain chain-wide — see below.
      counts: sevCountsOf(recs),
      total: recs.length,
      // Per-severity total/open/resolved for the severity breakdown card.
      sevStats: severityStats(recs),
      // Open findings per severity over time — powers the breakdown line chart. Uses the
      // already-scoped base + severities so the series matches the counts shown beside it.
      openTrend: openBySeverityTrend(
        loadScanRows(),
        base,
        severities
      ),
      exploit: exploitSummary(recs),
      aging: ageBuckets(base),
      // Top oldest open findings + 90+ backlog per asset / support group / domain,
      // for the aging panel's toggle (repaints client-side, no extra RPC).
      oldest: oldestOpen(base),
      movement: movement(base, latestFlat, loadScanRows().length)
    };
  }
  function getInsights(p) {
    return run(
      () => {
        var _a, _b;
        return cached(
          "insights",
          {
            domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
            supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
            supportGroups: readStringArray(p, "supportGroups"),
            severities: readSeverities(p)
          },
          () => insightsData(p),
          3600
        );
      }
    );
  }
  function scopedFrameRecords(domain, supportGroup, supportGroupSet) {
    const scan = currentScan();
    if (!scan) return [];
    let recs = scan.records;
    if (supportGroup || supportGroupSet.length) {
      const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
      recs = recs.filter((r) => {
        var _a;
        return sgMatch(String((_a = r["_supportGroup"]) != null ? _a : ""));
      });
    }
    if (domain) recs = recs.filter((r) => {
      var _a;
      return String((_a = r["_domain"]) != null ? _a : UNASSIGNED) === domain;
    });
    return recs;
  }
  function groupingData(p) {
    var _a, _b;
    const scan = currentScan();
    if (!scan) return { flatScan: false, keys: [], groups: [] };
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const supportGroupSet = readStringArray(p, "supportGroups");
    const raw = p == null ? void 0 : p["keys"];
    const keys = (Array.isArray(raw) ? raw.map(String) : []).filter((k) => k in GROUP_COLUMNS);
    return {
      flatScan: true,
      keys,
      groups: groupTree(
        filterSeverities(
          scopedFrameRecords(domain, supportGroup, supportGroupSet),
          readSeverities(p)
        ),
        keys
      )
    };
  }
  function getGrouping(p) {
    var _a, _b;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const supportGroupSet = readStringArray(p, "supportGroups");
    const raw = p == null ? void 0 : p["keys"];
    const keys = Array.isArray(raw) ? raw.map(String) : [];
    return run(
      () => cached(
        "grouping",
        { domain, supportGroup, supportGroups: supportGroupSet, keys, severities: readSeverities(p) },
        () => groupingData(p),
        3600
      )
    );
  }
  function groupTrendData(p) {
    var _a, _b, _c;
    const key = String((_a = p == null ? void 0 : p["key"]) != null ? _a : "");
    const groups = readStringArray(p, "groups");
    const field2 = GROUP_BASE_FIELDS[key];
    const scan = currentScan();
    if (!field2 || !scan) return { supported: false, key, groups: [], points: [] };
    const domain = String((_b = p == null ? void 0 : p["domain"]) != null ? _b : "");
    const supportGroup = String((_c = p == null ? void 0 : p["supportGroup"]) != null ? _c : "");
    const supportGroupSet = readStringArray(p, "supportGroups");
    const sgActive = Boolean(supportGroup) || supportGroupSet.length > 0;
    const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
    let base = loadBaseRows();
    attachSupportGroups(base);
    const compiled = compileDomains(getDomains2().items);
    for (const r of base) r["_domain"] = assignDomain(r, compiled);
    if (sgActive) base = base.filter((r) => {
      var _a2;
      return sgMatch(String((_a2 = r["_supportGroup"]) != null ? _a2 : ""));
    });
    if (domain) base = base.filter((r) => {
      var _a2;
      return String((_a2 = r["_domain"]) != null ? _a2 : UNASSIGNED) === domain;
    });
    const points = openByGroupTrend(
      loadScanRows(),
      base,
      (r) => {
        var _a2;
        return String((_a2 = r[field2]) != null ? _a2 : "");
      },
      groups,
      { severities: readSeverities(p) }
    );
    return { supported: true, key, groups, points };
  }
  function getGroupTrend(p) {
    var _a, _b;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    const supportGroupSet = readStringArray(p, "supportGroups");
    return run(
      () => {
        var _a2;
        return cached(
          "groupTrend",
          {
            domain,
            supportGroup,
            supportGroups: supportGroupSet,
            key: String((_a2 = p == null ? void 0 : p["key"]) != null ? _a2 : ""),
            groups: readStringArray(p, "groups"),
            severities: readSeverities(p)
          },
          () => groupTrendData(p),
          3600
        );
      }
    );
  }
  function attributionData(p) {
    const scan = currentScan();
    if (!scan) return { flatScan: false };
    const recs = filterSeverities(scan.records, readSeverities(p));
    const dom = getDomains2();
    const compiled = compileDomains(dom.items);
    const sgMap = getSupportGroupMap2();
    const sgKeys = Object.keys(sgMap.map);
    return {
      flatScan: true,
      scan: { scanId: scan.scanId, ts: scan.ts },
      coverage: coverage(recs, domainNames(dom.items)),
      ruleHealth: ruleHealth(recs, compiled),
      unassignedAll: unassignedResources(recs, compiled),
      untagged: untaggedSubscriptions(recs).slice(0, 200),
      supportGroupMap: { configured: sgKeys.length > 0, keys: sgKeys.length }
    };
  }
  function getAttribution(p) {
    return run(() => {
      var _a, _b;
      const data = cached("attribution", { severities: readSeverities(p) }, () => attributionData(p));
      if (!data["flatScan"]) return data;
      const { unassignedAll, ...rest } = data;
      const params = p != null ? p : {};
      const pageSize = Math.min(Math.max(Number((_a = params["pageSize"]) != null ? _a : 50), 1), 200);
      const pageCount = Math.max(1, Math.ceil(unassignedAll.length / pageSize));
      const page = Math.min(Math.max(Number((_b = params["page"]) != null ? _b : 0), 0), pageCount - 1);
      return {
        ...rest,
        unassigned: {
          rows: unassignedAll.slice(page * pageSize, (page + 1) * pageSize),
          total: unassignedAll.length,
          page,
          pageCount
        }
      };
    });
  }
  function readSeverities(p) {
    const raw = p == null ? void 0 : p["severities"];
    return Array.isArray(raw) ? raw.map(String) : null;
  }
  function filterSeverities(rows, severities) {
    if (severities === null || !rows.length) return rows;
    const keep = /* @__PURE__ */ new Set([...severities, "UNKNOWN"]);
    return rows.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  function mttrData(p) {
    var _a, _b;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    const supportGroup = String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : "");
    let rows = loadBaseRows();
    if (domain || supportGroup) {
      attachSupportGroups(rows);
      if (supportGroup) rows = rows.filter((r) => {
        var _a2;
        return String((_a2 = r["_supportGroup"]) != null ? _a2 : "") === supportGroup;
      });
      if (domain) {
        const compiled = compileDomains(getDomains2().items);
        rows = rows.filter((r) => assignDomain(r, compiled) === domain);
      }
    }
    rows = filterSeverities(rows, readSeverities(p));
    const { perSev, overall } = mttrFromLedger(rows);
    const { slaPct, oldestDays } = overallSlaOldest(perSev);
    const remRows = rows;
    const t = getFastLaneDays2();
    const remediation = {
      pctiles: mttrPercentiles(remRows),
      fastLane: { ...fastLaneSplit(remRows, t), thresholdDays: t },
      buckets: resolutionBuckets(remRows),
      kmMedian: kmMedian(remRows),
      openPastSla: openPastSla(remRows),
      // Actionable-clock companions (clock starts at vendor-fix availability): the same
      // functions over the actionableView projection. Awaiting-vendor-fix rows carry null
      // actionable fields, so they drop out of these while staying in `awaiting`.
      kmMedianActionable: kmMedian(actionableView(remRows)),
      openPastSlaActionable: openPastSla(actionableView(remRows)),
      awaiting: awaitingVendorFix(remRows)
    };
    return { perSev, overall, slaPct, oldestDays, rowCount: rows.length, remediation };
  }
  function mttrTrendData(p) {
    const severities = readSeverities(p);
    return {
      history: loadHistory(),
      trend: loadTrend(severities, getFastLaneDays2())
    };
  }
  function mttrByDomainData(p) {
    var _a, _b, _c, _d;
    const supportGroup = String((_a = p == null ? void 0 : p["supportGroup"]) != null ? _a : "");
    let rows = filterSeverities(
      loadBaseRows(),
      readSeverities(p)
    );
    attachSupportGroups(rows);
    if (supportGroup) rows = rows.filter((r) => {
      var _a2;
      return String((_a2 = r["_supportGroup"]) != null ? _a2 : "") === supportGroup;
    });
    const items = getDomains2().items;
    const compiled = compileDomains(items);
    const assigned = assignDomains(rows, compiled);
    const buckets = /* @__PURE__ */ new Map();
    rows.forEach((r, i) => {
      var _a2;
      const name = (_a2 = assigned[i]) != null ? _a2 : UNASSIGNED;
      let arr = buckets.get(name);
      if (!arr) buckets.set(name, arr = []);
      arr.push(r);
    });
    const t = getFastLaneDays2();
    const out = [];
    for (const name of domainNames(items)) {
      const drows = buckets.get(name);
      if (!drows || !drows.length) continue;
      const { perSev, overall } = mttrFromLedger(drows);
      const { slaPct } = overallSlaOldest(perSev);
      const rem = drows;
      const split = fastLaneSplit(rem, t);
      out.push({
        domain: name,
        median: (_b = overall.mttr_median) != null ? _b : null,
        p90: mttrPercentiles(rem).overall.p90,
        tailMedian: split.tailMedian,
        // Tail-resolution count — the pie's population when the By-domain switch is on
        // "Excl. fast lane" (resolved with mttr_days above the fast-lane threshold).
        tailResolved: split.tailCount,
        slaPct,
        // Actionable-clock open-past-SLA (measured from vendor-fix availability, awaiting
        // rows excluded) — the same basis the hero and severity table now use.
        openPastSla: openPastSla(actionableView(rem)).overall,
        // Open findings in this bucket still awaiting a vendor fix — surfaced as a footnote
        // under the table, not a column.
        awaiting: awaitingVendorFix(rem).overall,
        open: (_c = overall.open) != null ? _c : 0,
        resolved: (_d = overall.resolved) != null ? _d : 0
      });
    }
    rows.forEach((r, i) => {
      var _a2;
      r["_domain"] = (_a2 = assigned[i]) != null ? _a2 : UNASSIGNED;
    });
    const groups = out.filter((r) => r["resolved"] > 0).sort((a, b) => b["resolved"] - a["resolved"]).slice(0, 8).map((r) => String(r["domain"]));
    const scanRows = loadScanRows();
    const byDomainKey = (r) => {
      var _a2;
      return String((_a2 = r["_domain"]) != null ? _a2 : UNASSIGNED);
    };
    const points = medianMttrByGroupTrend(scanRows, rows, byDomainKey, groups, { severities: null });
    const tailPoints = medianMttrByGroupTrend(scanRows, rows, byDomainKey, groups, {
      severities: null,
      minMttrDays: t
    });
    return { rows: out, thresholdDays: t, trend: { groups, points, tailPoints } };
  }
  var cachedMttrData = (p) => {
    var _a, _b;
    return cached(
      // "mttr" → "mttr2": payload gained the `remediation` block; dataVersion persists across
      // deploys, so bumping the namespace prevents serving a stale old-shape entry (up to 1h).
      // "mttr2" → "mttr3": remediation gained the actionable-clock keys (kmMedianActionable,
      // openPastSlaActionable, awaiting); same reasoning — bump so no stale entry lacks them.
      "mttr3",
      {
        domain: String((_a = p == null ? void 0 : p["domain"]) != null ? _a : ""),
        supportGroup: String((_b = p == null ? void 0 : p["supportGroup"]) != null ? _b : ""),
        severities: readSeverities(p),
        // The fast-lane window is an input of the payload (thresholdDays, split, tail
        // median), so it belongs in the key: entries minted under another window — or under
        // the pre-setting constant, which no dataVersion bump ever retired — can't be served.
        fastLane: getFastLaneDays2()
      },
      () => mttrData(p),
      3600
    );
  };
  var cachedMttrTrendData = (p) => (
    // "mttrTrend" → "mttrTrend2": trend points gained `open_past_sla`; namespace bump avoids a
    // stale old-shape entry surviving the deploy under the persistent dataVersion. The
    // fast-lane window feeds the tail-median series, so it rides in the key like cachedMttrData.
    cached(
      "mttrTrend2",
      { severities: readSeverities(p), fastLane: getFastLaneDays2() },
      () => mttrTrendData(p)
    )
  );
  var cachedMttrByDomainData = (p) => {
    var _a;
    return cached(
      // "mttrByDomain" → "mttrByDomain2": payload shape changed (added p90/tailMedian/
      // openPastSla, dropped tracked/oldestDays); dataVersion persists across deploys, so
      // bumping the namespace prevents serving a stale old-shape entry.
      // "mttrByDomain2" → "mttrByDomain3": payload gained `trend` (median-MTTR-by-domain
      // lines); same reasoning — bump the namespace so a stale trend-less entry can't survive.
      // "mttrByDomain3" → "mttrByDomain4": trend gained `tailPoints` (fast-lane-excluded
      // medians for the chart's Median / Excl. fast lane toggle).
      // "mttrByDomain4" → "mttrByDomain5": rows gained `tailResolved` (the toggle now also
      // drives the Remediation-share pie).
      // "mttrByDomain5" → "mttrByDomain6": rows gained `awaiting` and switched `openPastSla`
      // to the actionable-clock view; bump so a stale from-detection entry can't survive.
      "mttrByDomain6",
      {
        supportGroup: String((_a = p == null ? void 0 : p["supportGroup"]) != null ? _a : ""),
        severities: readSeverities(p),
        // Same reasoning as cachedMttrData: tailMedian/thresholdDays depend on the window.
        fastLane: getFastLaneDays2()
      },
      () => mttrByDomainData(p),
      3600
    );
  };
  function getMttr(p) {
    return run(() => cachedMttrData(p));
  }
  function getMttrTrend(p) {
    return run(() => cachedMttrTrendData(p));
  }
  function getMttrPage(p) {
    var _a;
    const domain = String((_a = p == null ? void 0 : p["domain"]) != null ? _a : "");
    return run(() => ({
      mttr: cachedMttrData(p),
      trends: cachedMttrTrendData(p),
      byDomain: domain ? null : cachedMttrByDomainData(p)
    }));
  }
  function scanHistoryData() {
    var _a;
    const scans = loadScanRows().slice().reverse();
    const base = loadBaseRows();
    const open = base.filter((r) => r.status === "OPEN").length;
    const resolved = base.filter((r) => r.status === "RESOLVED").length;
    const { overall } = mttrFromLedger(base);
    return {
      scans,
      kpis: {
        tracked: base.length,
        open,
        resolvedAllTime: resolved,
        medianMttr: (_a = overall.mttr_median) != null ? _a : null
      }
    };
  }
  var cachedScanHistoryData = () => cached("scanHistory", null, scanHistoryData);
  function getScanHistory(_p) {
    return run(() => cachedScanHistoryData());
  }
  function getHistoryPage(p) {
    return run(() => ({
      history: cachedScanHistoryData(),
      trends: cachedMttrTrendData(p)
    }));
  }
  function runScan(p) {
    const params = p != null ? p : {};
    return run(
      () => {
        var _a;
        return startScan({
          incremental: Boolean(params["incremental"]),
          sampleShape: (_a = params["sampleShape"]) != null ? _a : void 0
        });
      }
    );
  }
  function getJobStatus(p) {
    return run(() => {
      var _a;
      const jobId = String((_a = p == null ? void 0 : p["jobId"]) != null ? _a : "");
      return jobId ? getJob(jobId) : activeJobSummary();
    });
  }
  function cancelScan2(p) {
    return run(() => {
      var _a;
      return cancelScan(String((_a = p == null ? void 0 : p["jobId"]) != null ? _a : ""));
    });
  }
  function deleteScans2(p) {
    var _a;
    const scanIds = ((_a = p == null ? void 0 : p["scanIds"]) != null ? _a : []).map(String);
    return mutate(() => deleteScans(scanIds));
  }
  function compact(p) {
    const params = p != null ? p : {};
    const dryRun = Boolean(params["dryRun"]);
    const days = params["retentionDays"] !== void 0 ? Number(params["retentionDays"]) : getRetentionDays2();
    if (dryRun) return run(() => compactLedger(days, true));
    return mutate(() => compactLedger(days, false));
  }
  function payloadOf(params, fallbackKey) {
    if (typeof params["gzipB64"] === "string") {
      return JSON.parse(
        Utilities.ungzip(
          Utilities.newBlob(Utilities.base64Decode(params["gzipB64"]), "application/x-gzip")
        ).getDataAsString("UTF-8")
      );
    }
    return params[fallbackKey];
  }
  function importMigration(p) {
    return mutate(() => {
      const params = p != null ? p : {};
      const bundle = validateBundle(payloadOf(params, "bundle"));
      const counts = importBundle(bundle);
      const hist = importHistory(bundle.mttr_history);
      return { ...counts, history_added: hist.added, history_skipped: hist.skipped };
    });
  }
  function importBegin(p) {
    return mutate(() => importBeginSharded(payloadOf(p != null ? p : {}, "manifest")));
  }
  function importShard(p) {
    return mutate(() => {
      var _a, _b, _c, _d, _e;
      const params = p != null ? p : {};
      const shard = payloadOf(params, "shard");
      const index = Number((_b = (_a = params["index"]) != null ? _a : shard == null ? void 0 : shard["index"]) != null ? _b : 0);
      return importApplyShard(String((_c = params["sessionId"]) != null ? _c : ""), index, {
        ledger: (_d = shard == null ? void 0 : shard["ledger"]) != null ? _d : [],
        episodes: (_e = shard == null ? void 0 : shard["episodes"]) != null ? _e : []
      });
    });
  }
  function importFinalize(p) {
    return mutate(
      () => {
        var _a;
        return importFinalizeSharded(String((_a = (p != null ? p : {})["sessionId"]) != null ? _a : ""));
      }
    );
  }
  function importAbort(p) {
    return mutate(
      () => {
        var _a;
        return importAbortSharded(String((_a = (p != null ? p : {})["sessionId"]) != null ? _a : ""));
      }
    );
  }
  function importStatus(p) {
    return run(() => {
      var _a;
      const jobId = String((_a = (p != null ? p : {})["jobId"]) != null ? _a : "");
      return jobId ? getJob(jobId) : activeJobSummary();
    });
  }
  function resetLedger2() {
    return mutate(() => {
      try {
        clearContinuationTriggers();
      } catch (e) {
        console.warn(`resetLedger: continuation-trigger cleanup skipped: ${e}`);
      }
      return resetLedger();
    });
  }
  var REPORT_SOURCE = "OS vulnerabilities";
  function getReport(p) {
    return run(() => {
      var _a, _b, _c, _d, _e, _f;
      const params = p != null ? p : {};
      const format = String((_a = params["format"]) != null ? _a : "markdown");
      const scan = currentScan();
      if (!scan) return { content: "", filename: "", matrix: [] };
      const domains = (_b = params["domains"]) != null ? _b : [];
      const sgFilter = (_c = params["supportGroups"]) != null ? _c : [];
      const displayed = applyFilters(scan.records, {
        severities: getDisplaySeverities2(),
        domains,
        supportGroups: sgFilter
      });
      const counts = sevCountsOf(displayed);
      let baseRows2 = loadBaseRows();
      if (domains.length || sgFilter.length) {
        attachSupportGroups(baseRows2);
        if (sgFilter.length) {
          const keep = new Set(sgFilter);
          baseRows2 = baseRows2.filter((r) => {
            var _a2;
            return keep.has(String((_a2 = r["_supportGroup"]) != null ? _a2 : ""));
          });
        }
        if (domains.length) {
          const compiled = compileDomains(getDomains2().items);
          baseRows2 = baseRows2.filter((r) => domains.includes(assignDomain(r, compiled)));
        }
      }
      const { perSev, overall } = mttrFromLedger(baseRows2);
      const generated = (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
      const matrix = [
        {
          source: REPORT_SOURCE,
          ...Object.fromEntries(SEVERITY_ORDER.map((s) => {
            var _a2;
            return [s, (_a2 = counts[s]) != null ? _a2 : 0];
          })),
          total: displayed.length,
          medianMttr: (_d = overall.mttr_median) != null ? _d : null,
          open: (_e = overall.open) != null ? _e : 0
        }
      ];
      if (format === "json") {
        return {
          content: JSON.stringify({ generated, sources: matrix }, null, 2),
          filename: `wiz-report-${generated.slice(0, 10)}.json`,
          matrix
        };
      }
      if (format === "csv") {
        const cols = TABLE_COLUMNS.filter((c) => !c.startsWith("_"));
        const lines = [cols.join(",")];
        for (const r of displayed) {
          lines.push(cols.map((c) => csvCell(r[c])).join(","));
        }
        return {
          content: lines.join("\r\n"),
          filename: `wiz-report-${generated.slice(0, 10)}.csv`,
          matrix
        };
      }
      const md = [
        `# Security summary \u2014 ${generated}`,
        "",
        `## ${REPORT_SOURCE}`,
        "",
        `| Severity | Count |`,
        `| --- | ---: |`,
        ...SEVERITY_ORDER.filter((s) => counts[s]).map((s) => `| ${s} | ${counts[s]} |`),
        `| **Total** | **${displayed.length}** |`,
        "",
        `Median MTTR: ${overall.mttr_median != null ? overall.mttr_median.toFixed(1) + " days" : "\u2014"}`,
        `Open findings: ${(_f = overall.open) != null ? _f : 0}`
      ].join("\n");
      return { content: md, filename: `wiz-report-${generated.slice(0, 10)}.md`, matrix };
    });
  }
  function csvCell(v) {
    if (v === null || v === void 0) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function getExportCsv(p) {
    return run(() => {
      var _a, _b, _c, _d, _e, _f, _g;
      const params = p != null ? p : {};
      const scan = currentScan();
      if (!scan) return { content: "", filename: "" };
      const filtered = applyFilters(scan.records, {
        severities: (_a = params["severities"]) != null ? _a : getDisplaySeverities2(),
        statuses: (_b = params["statuses"]) != null ? _b : [],
        assetTypes: (_c = params["assetTypes"]) != null ? _c : [],
        clouds: (_d = params["clouds"]) != null ? _d : [],
        domains: (_e = params["domains"]) != null ? _e : [],
        supportGroups: (_f = params["supportGroups"]) != null ? _f : [],
        q: (_g = params["q"]) != null ? _g : ""
      });
      const cols = TABLE_COLUMNS.filter((c) => !c.startsWith("_"));
      const lines = [cols.join(",")];
      for (const r of filtered) lines.push(cols.map((c) => csvCell(r[c])).join(","));
      return {
        content: lines.join("\r\n"),
        filename: `wiz-os-vulnerabilities-${scan.scanId.slice(0, 10)}.csv`
      };
    });
  }
  function getExportRawUrl(p) {
    return run(() => {
      var _a;
      const scanId = String((_a = p == null ? void 0 : p["scanId"]) != null ? _a : "");
      const row = scanId ? loadScanRows().find((s) => s.scan_id === scanId) : latestScanRow();
      if (!(row == null ? void 0 : row.raw_ref)) return { urls: [] };
      const folder = DriveApp.getFolderById(row.raw_ref);
      const urls = [];
      const files = folder.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (/^page-\d+\.json(\.gz)?$/.test(f.getName())) {
          urls.push({ name: f.getName(), url: f.getDownloadUrl() });
        }
      }
      urls.sort((a, b) => a.name < b.name ? -1 : 1);
      return { urls, folderUrl: folder.getUrl() };
    });
  }
  function getSettings(_p) {
    return run(() => ({
      fetchSeverities: getFetchSeverities2(),
      displaySeverities: getDisplaySeverities2(),
      retentionDays: getRetentionDays2(),
      fastLaneDays: getFastLaneDays2(),
      autoCompact: getAutoCompact2(),
      domains: getDomains2()
    }));
  }
  function setSeverities(p) {
    const params = p != null ? p : {};
    return mutate(() => {
      if (params["fetch"]) setFetchSeverities(params["fetch"]);
      if (params["display"]) setDisplaySeverities(params["display"]);
      return {
        fetchSeverities: getFetchSeverities2(),
        displaySeverities: getDisplaySeverities2()
      };
    });
  }
  function setRetention(p) {
    const days = p == null ? void 0 : p["days"];
    return mutate(() => {
      setRetentionDays(days === null || days === void 0 ? null : Number(days));
      return { retentionDays: getRetentionDays2() };
    });
  }
  function setFastLaneDays2(p) {
    const days = p == null ? void 0 : p["days"];
    return mutate(() => {
      setFastLaneDays(Number(days));
      return { fastLaneDays: getFastLaneDays2() };
    });
  }
  function setAutoCompact2(p) {
    return mutate(() => {
      setAutoCompact(Boolean(p == null ? void 0 : p["on"]));
      return { autoCompact: getAutoCompact2() };
    });
  }
  function setRetentionSettings(p) {
    const params = p != null ? p : {};
    const days = params["days"];
    return mutate(() => {
      setRetentionAndCompact(
        days === null || days === void 0 ? null : Number(days),
        Boolean(params["autoCompact"])
      );
      return {
        retentionDays: getRetentionDays2(),
        autoCompact: getAutoCompact2()
      };
    });
  }
  function getDomains3(_p) {
    return run(() => getDomains2());
  }
  function saveDomains(p) {
    var _a;
    const items = (_a = p == null ? void 0 : p["items"]) != null ? _a : [];
    return mutate(() => {
      const errors = validateDomains(items);
      if (errors.length) return { saved: false, errors };
      setDomains(items);
      invalidateFrameMemo();
      return { saved: true, errors: [], domains: getDomains2() };
    });
  }
  function previewDomains(p) {
    return run(() => {
      var _a, _b, _c, _d;
      const items = (_a = p == null ? void 0 : p["items"]) != null ? _a : [];
      const compiled = compileDomains(items);
      const scan = currentScan();
      const records = (_b = scan == null ? void 0 : scan.records) != null ? _b : [];
      const perDomain = {};
      for (const d of compiled) perDomain[d.name] = { count: 0, samples: [] };
      perDomain[UNASSIGNED] = { count: 0, samples: [] };
      for (const r of records) {
        const name = assignDomain(r, compiled);
        const bucket = (_c = perDomain[name]) != null ? _c : perDomain[name] = { count: 0, samples: [] };
        bucket.count += 1;
        if (bucket.samples.length < 5) {
          const asset = String((_d = r["vulnerableAsset.name"]) != null ? _d : "");
          if (asset && !bucket.samples.includes(asset)) bucket.samples.push(asset);
        }
      }
      return { total: records.length, perDomain };
    });
  }
  function refreshSupportGroups2(_p) {
    if (!hasWizCredentials()) {
      return { ok: false, error: "Live Wiz credentials are required to refresh support groups." };
    }
    return mutate(() => {
      const stats = refreshSupportGroups();
      invalidateFrameMemo();
      return stats;
    });
  }
  function getStorageStats(_p) {
    return run(
      () => cached("storageStats", null, () => {
        const scans = loadScanRows();
        return {
          cellCount: cellCount(),
          cellLimit: 1e7,
          scanCount: scans.length,
          sealedCount: scans.filter((s) => s.sealed).length,
          oldestScanTs: scans.length ? scans[0].ts : null,
          trackedVulns: loadBaseRows().length
        };
      })
    );
  }
  return __toCommonJS(server_exports);
})();
