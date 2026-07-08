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
    jobs: () => syncJobs_exports,
    setup: () => setup,
    wizDiagnostic: () => wizDiagnostic
  });

  // src/server/main.ts
  function doGet(_e) {
    const template = HtmlService.createTemplateFromFile("index");
    return template.evaluate().setTitle("Wiz SIDEKICK AI").addMetaTag("viewport", "width=device-width, initial-scale=1").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
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
    ledgerSpreadsheetId: "LEDGER_SPREADSHEET_ID",
    archiveFolderId: "ARCHIVE_FOLDER_ID",
    // Optional comma-separated override of the AI resource-type enum values to
    // query (e.g. "AI_AGENT,AI_MODEL") for tenants whose schema names differ.
    wizAiResourceTypes: "WIZ_AI_RESOURCE_TYPES"
  };
  var DEFAULT_WIZ_AUTH_URL = "https://auth.app.wiz.io/oauth/token";
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
  function projectScope() {
    const id = getProp(PROP_KEYS.wizProjectIdV2);
    return id && id.trim() ? [id.trim()] : null;
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
  var SUBFOLDERS = ["syncs", "snapshots"];
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
    return id.replace(/[^0-9A-Za-z._-]/g, "") || "sync";
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
  function syncFolder(syncId) {
    return childFolder(subfolder("syncs"), safeName(syncId));
  }
  function writeSyncPage(syncId, stepIndex, pageNumber, payload) {
    const name = `step-${stepIndex}-page-${String(pageNumber).padStart(4, "0")}.json.gz`;
    return writeGzJson(syncFolder(syncId), name, payload).getId();
  }
  var SNAPSHOT_NAME = "graph-snapshot.json.gz";
  function writeGraphSnapshot(doc) {
    return writeGzJson(subfolder("snapshots"), SNAPSHOT_NAME, doc).getId();
  }
  function readGraphSnapshot() {
    const files = subfolder("snapshots").getFilesByName(SNAPSHOT_NAME);
    if (!files.hasNext()) return null;
    const parsed = parseGzBlob(files.next().getBlob());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const doc = parsed;
    return Array.isArray(doc.nodes) && Array.isArray(doc.edges) ? doc : null;
  }
  function trashGraphSnapshot() {
    const files = subfolder("snapshots").getFilesByName(SNAPSHOT_NAME);
    while (files.hasNext()) files.next().setTrashed(true);
  }
  function archiveBytes() {
    let total = 0;
    for (const name of SUBFOLDERS) {
      const walk = (folder) => {
        const files = folder.getFiles();
        while (files.hasNext()) total += files.next().getSize();
        const folders = folder.getFolders();
        while (folders.hasNext()) walk(folders.next());
      };
      walk(subfolder(name));
    }
    return total;
  }

  // src/server/sheetsDb.ts
  var TABS = {
    assets: "ai_assets",
    edges: "ai_edges",
    issues: "ai_issues",
    findings: "ai_findings",
    syncHistory: "sync_history",
    settings: "settings",
    jobs: "jobs",
    meta: "meta"
  };
  var TAB_HEADERS = {
    [TABS.assets]: [
      "id",
      "kind",
      "name",
      "native_type",
      "cloud",
      "region",
      "status",
      "account_id",
      "account_name",
      "projects_json",
      "first_seen",
      "last_seen",
      "internet",
      "open_internet",
      "sensitive_data",
      "sensitive_access",
      "high_priv",
      "admin_priv",
      "guardrail_missing",
      "severity",
      "aars",
      "aars_band",
      "aars_pillars_json",
      "combo_groups",
      "tags_json",
      "technology_categories",
      "identity_purpose",
      "issue_analytics_json"
    ],
    [TABS.edges]: ["id", "src", "dst", "type", "negated", "access_type"],
    [TABS.issues]: [
      "id",
      "rule_id",
      "rule_name",
      "combo_group",
      "native_severity",
      "adjusted_severity",
      "status",
      "asset_id",
      "asset_name",
      "region",
      "account",
      "projects_json",
      "frameworks_json",
      "justification",
      "created_at",
      "due_at",
      "resolution_recommendation",
      "remediation"
    ],
    [TABS.findings]: [
      "id",
      "resource_id",
      "rule_short_id",
      "severity",
      "remediation",
      "framework_codes"
    ],
    [TABS.syncHistory]: [
      "sync_id",
      "started_at",
      "finished_at",
      "status",
      "mode",
      "node_count",
      "edge_count",
      "issue_count",
      "api_calls",
      "snapshot_ref",
      "error"
    ],
    [TABS.settings]: ["key", "value_json"],
    [TABS.jobs]: [
      "job_id",
      "kind",
      "phase",
      "sync_id",
      "step_index",
      "cursor",
      "page",
      "nodes_so_far",
      "total_count",
      "part_refs_json",
      "params_json",
      "error",
      "started_at",
      "updated_at"
    ],
    [TABS.meta]: ["version"]
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
  var SPREADSHEET_NAME = "Wiz SIDEKICK AI Ledger";
  var FOLDER_NAME = "wiz-sidekick-ai";
  var DAILY_TRIGGER_HANDLER = "trigger_dailySync";
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
      PROP_KEYS.wizApiUrl
    ].filter((k) => !getProp(k));
    if (missing.length) {
      notes.push(`NOTE: set Script Properties for live syncs: ${missing.join(", ")} (without them the app runs dry-run only)`);
    }
    return notes.join("\n");
  }

  // src/domain/toxicCombos.ts
  var RISK_CATEGORY_ID = "wct-id-1998";
  var COMBO_GROUPS = [
    {
      id: "bedrock-no-guardrail",
      ruleId: "wc-id-2742",
      title: "AWS Bedrock: model invocation without guardrails",
      shortLabel: "No guardrail on invoke",
      nativeSeverity: "MEDIUM",
      adjustedSeverity: "HIGH",
      amplifierNote: "Wiz MEDIUM, treated as HIGH: no content filtering or data protection on model calls, and the 5Rs data-security score (53%) confirms restriction controls are failing.",
      namePattern: /without\s+guardrail/i,
      frameworks: {
        owaspLlm: ["LLM06", "LLM02"],
        owaspAgentic: ["ASI02", "ASI03"],
        owaspMl: [],
        fiveRs: ["Restrict"]
      }
    },
    {
      id: "gcp-managed-privileged",
      ruleId: "wc-id-3217",
      title: "GCP managed AI agents: high privileges + sensitive data",
      shortLabel: "Privileged managed agent",
      nativeSeverity: "MEDIUM",
      adjustedSeverity: "HIGH",
      amplifierNote: "Wiz MEDIUM, treated as HIGH: prompt injection on an over-privileged managed agent reaches sensitive data, and the 5Rs score (53%) confirms that data is not restricted.",
      namePattern: /managed\s+ai\s+agent\s+with\s+high\s+privileges/i,
      frameworks: {
        owaspLlm: ["LLM06", "LLM01"],
        owaspAgentic: ["ASI03", "ASI01"],
        owaspMl: ["Data Poisoning"],
        fiveRs: ["Restrict", "Reconfigure"]
      }
    },
    {
      id: "gcp-hosted-privileged",
      ruleId: "wc-id-3230",
      title: "GCP hosted AI agents on VM/serverless: high privileges + sensitive data",
      shortLabel: "Privileged hosted agent",
      nativeSeverity: "MEDIUM",
      adjustedSeverity: "HIGH",
      amplifierNote: "Wiz MEDIUM, treated as HIGH: the agent inherits its host's attack surface (VM / serverless), holds excessive IAM, and the 5Rs score (53%) confirms weak data restriction.",
      namePattern: /hosted\s+on\s+vm\/?serverless/i,
      frameworks: {
        owaspLlm: ["LLM06", "LLM01", "LLM02", "LLM05"],
        owaspAgentic: ["ASI02", "ASI03", "ASI05"],
        owaspMl: [],
        fiveRs: ["Restrict", "Reduce"]
      }
    },
    {
      id: "permissive-exec-identity",
      ruleId: "wc-id-3123",
      title: "GCP AI agents: overly permissive execution identity",
      shortLabel: "Permissive identity",
      nativeSeverity: "LOW",
      adjustedSeverity: "MEDIUM",
      amplifierNote: "Wiz LOW, treated as MEDIUM: latent privileges \u2014 a compromised agent (prompt injection \u2192 RCE/SSRF) inherits every permission of its execution identity.",
      namePattern: /overly\s+permissive\s+execution\s+identity/i,
      frameworks: {
        owaspLlm: [],
        owaspAgentic: ["ASI03"],
        owaspMl: [],
        fiveRs: ["Reconfigure"]
      }
    }
  ];
  var BY_RULE_ID = new Map(COMBO_GROUPS.map((g) => [g.ruleId, g]));
  var BY_GROUP_ID = new Map(COMBO_GROUPS.map((g) => [g.id, g]));
  function comboGroupById(id) {
    var _a4;
    return (_a4 = BY_GROUP_ID.get(id)) != null ? _a4 : null;
  }
  function classifyIssue(issue2) {
    var _a4;
    if (issue2.sourceRuleId) {
      const byId = BY_RULE_ID.get(issue2.sourceRuleId);
      if (byId) return byId;
    }
    const name = (_a4 = issue2.ruleName) != null ? _a4 : "";
    if (name) {
      for (const g of COMBO_GROUPS) {
        if (g.namePattern.test(name)) return g;
      }
    }
    return null;
  }
  function comboSummary(issues2) {
    const acc = /* @__PURE__ */ new Map();
    for (const g of COMBO_GROUPS) acc.set(g.id, { count: 0, assetIds: [], seen: /* @__PURE__ */ new Set() });
    for (const issue2 of issues2) {
      if (issue2.status !== "OPEN") continue;
      const bucket = acc.get(issue2.comboGroup);
      if (!bucket) continue;
      bucket.count += 1;
      if (issue2.assetId && !bucket.seen.has(issue2.assetId)) {
        bucket.seen.add(issue2.assetId);
        bucket.assetIds.push(issue2.assetId);
      }
    }
    return COMBO_GROUPS.map((group) => ({
      group,
      count: acc.get(group.id).count,
      assetIds: acc.get(group.id).assetIds
    }));
  }

  // src/server/wizQueriesAi.ts
  var PAGE_SIZE = 100;
  var PAGE_SIZE_FALLBACK = 50;
  var MAX_PAGES = 200;
  var RESOURCE_FIELDS = "      id\n      name\n      type\n      nativeType\n      cloudPlatform\n      region\n      status\n      firstSeen\n      lastSeen\n      externalId\n      isAccessibleFromInternet\n      isOpenToAllInternet\n      hasSensitiveData\n      hasAccessToSensitiveData\n      hasAdminPrivileges\n      hasHighPrivileges\n      technology { id name categories { id name } }\n      cloudAccount { id name externalId cloudProvider }\n      projects { id name riskProfile { businessImpact } }\n      tags { key value }\n";
  var ENTITY_FIELDS = "        id\n        name\n        type\n        nativeType\n        cloudPlatform\n        region\n        ... on CloudResource {\n          status\n          firstSeen\n          lastSeen\n          externalId\n          isAccessibleFromInternet\n          isOpenToAllInternet\n          hasSensitiveData\n          hasAccessToSensitiveData\n          hasAdminPrivileges\n          hasHighPrivileges\n          technology { id name categories { id name } }\n          cloudAccount { id name externalId cloudProvider }\n          projects { id name riskProfile { businessImpact } }\n          tags { key value }\n        }\n";
  function graphSearchQuery(name, queryBody) {
    return "query " + name + "($quick: Boolean, $first: Int, $after: String) {\n  graphSearch(quick: $quick, first: $first, after: $after, query: {\n" + queryBody + "  }) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      entities {\n" + ENTITY_FIELDS + "      }\n    }\n  }\n}\n";
  }
  var AI_RESOURCE_TYPE_CANDIDATES = [
    "AI_AGENT",
    "AI_AGENT_REGISTRY",
    "AI_DATASET",
    "AI_DEPLOYMENT",
    "AI_EXTENSION",
    "AI_GATEWAY",
    "AI_GUARDRAIL",
    "AI_MODEL",
    "AI_PIPELINE",
    "AI_SERVICE",
    "AI_SKILL",
    "AI_SKILL_TEMPLATE",
    "AI_TOOL",
    "MCP_SERVER"
  ];
  function chooseAiResourceTypes(enumValues, override) {
    if (override && override.length) return { types: override, source: "override", aiLooking: [] };
    if (!enumValues) {
      return { types: [...AI_RESOURCE_TYPE_CANDIDATES], source: "candidates", aiLooking: [] };
    }
    const present2 = new Set(enumValues);
    const aiLooking = enumValues.filter((v) => {
      const tokens = v.toUpperCase().split(/[\s_]+/);
      return tokens.includes("AI") || tokens.includes("MCP") || tokens.includes("GENAI") || tokens.includes("LLM");
    });
    const intersection = AI_RESOURCE_TYPE_CANDIDATES.filter((t) => present2.has(t));
    if (intersection.length) return { types: intersection, source: "intersection", aiLooking };
    if (aiLooking.length) return { types: aiLooking, source: "ai-tokens", aiLooking };
    return { types: [], source: "none", aiLooking };
  }
  function isInvalidEnumValueError(message) {
    if (/failed to parse object type/i.test(message)) return true;
    return /HTTP 400/.test(message) && /cannot represent value/i.test(message);
  }
  var Q_AI_INVENTORY = "query SidekickAiInventory($first: Int, $after: String, $filterBy: CloudResourceV2Filters) {\n  cloudResourcesV2(first: $first, after: $after, filterBy: $filterBy) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n" + RESOURCE_FIELDS + "    }\n  }\n}\n";
  function aiInventoryVariables(types) {
    return { filterBy: { type: { equals: [...types] } } };
  }
  var Q_RULE_ASSETS = 'query SidekickAiRuleAssets($first: Int, $after: String, $ruleIds: [String!]) {\n  cloudResourcesV2(first: $first, after: $after, filterBy: {\n    relatedIssue: { sourceRuleId: { equals: $ruleIds }, status: { equals: ["OPEN"] } }\n  }) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n' + RESOURCE_FIELDS + "    }\n  }\n}\n";
  var Q_AGENTS_NO_GUARDRAIL = graphSearchQuery(
    "SidekickAiAgentsWithoutGuardrail",
    '    type: "AI_AGENT"\n    select: true\n    relationships: [{\n      type: "PROTECTED_BY"\n      with: { type: "AI_GUARDRAIL", select: false }\n      negate: true\n    }]\n'
  );
  var Q_AGENT_RUNS_AS = graphSearchQuery(
    "SidekickAiAgentRunsAs",
    '    type: "AI_AGENT"\n    select: true\n    relationships: [{\n      type: "RUNS_AS"\n      with: { type: "SERVICE_ACCOUNT", select: true }\n    }]\n'
  );
  var Q_SA_EXCESSIVE_ACCESS = graphSearchQuery(
    "SidekickAiAgentSaExcessiveAccess",
    '    type: "AI_AGENT"\n    select: true\n    relationships: [{\n      type: "RUNS_AS"\n      with: {\n        type: "SERVICE_ACCOUNT"\n        select: true\n        relationships: [{\n          type: "HAS_FINDING"\n          with: { type: "EXCESSIVE_ACCESS_FINDING", select: true }\n        }]\n      }\n    }]\n'
  );
  var Q_IDENTITY_ACCESS = graphSearchQuery(
    "SidekickAiIdentitiesWithAgentAccess",
    '    type: "AI_AGENT"\n    select: true\n    relationships: [{\n      type: "ALLOWS_ACCESS_TO"\n      direction: INBOUND\n      with: {\n        type: "ACCESS_ROLE_BINDING"\n        select: false\n        relationships: [\n          {\n            type: "BOUND_TO"\n            with: { type: ["USER_ACCOUNT", "SERVICE_ACCOUNT"], select: true }\n          }\n          {\n            type: "PERMITS_ACCESS_ROLE"\n            with: {\n              type: "ACCESS_ROLE"\n              select: true\n              where: { accessType: { EQUALS: ["HIGH_PRIVILEGE", "ADMIN"] } }\n            }\n          }\n        ]\n      }\n    }]\n'
  );
  var Q_ISSUES = "query SidekickAiIssues($first: Int, $after: String, $filterBy: IssueFilters, $orderBy: IssueOrder) {\n  issuesV2(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      id\n      type\n      severity\n      status\n      createdAt\n      updatedAt\n      dueAt\n      projects { id name riskProfile { businessImpact } }\n      entitySnapshot {\n        id\n        type\n        name\n        cloudPlatform\n        region\n        subscriptionName\n        nativeType\n        externalId\n      }\n      sourceRules {\n        ... on Control {\n          id\n          name\n          description\n          severity\n          risks\n          threats\n          resolutionRecommendation\n        }\n        ... on CloudConfigurationRule {\n          id\n          name\n          description\n          risks\n          threats\n          control { resolutionRecommendation severity }\n        }\n      }\n    }\n  }\n}\n";
  function aiIssuesVariables(scope) {
    const filterBy = {
      status: ["OPEN", "IN_PROGRESS"],
      riskEqualsAny: [RISK_CATEGORY_ID],
      type: ["TOXIC_COMBINATION"]
    };
    if (scope && scope.length) filterBy["project"] = scope;
    return { filterBy, orderBy: { field: "SEVERITY_EXPLOITABLE", direction: "DESC" } };
  }
  var Q_CONFIG_FINDINGS = "query SidekickAiConfigFindings($first: Int, $after: String, $filterBy: ConfigurationFindingFilters, $orderBy: ConfigurationFindingOrder) {\n  configurationFindings(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      id\n      name\n      severity\n      result\n      status\n      remediation\n      source\n      targetExternalId\n      subscription { id name externalId cloudProvider }\n      resource {\n        id\n        name\n        type\n        projects { id name riskProfile { businessImpact } }\n      }\n      rule {\n        id\n        shortId\n        name\n        description\n        remediationInstructions\n        risks\n        threats\n        tags { key value }\n        opaPolicy\n      }\n    }\n  }\n}\n";
  function aiConfigFindingsVariables(scope) {
    const filterBy = {
      status: ["OPEN"],
      frameworkCategory: [RISK_CATEGORY_ID]
    };
    if (scope && scope.length) filterBy["resource"] = { projectId: scope };
    return { filterBy, orderBy: { field: "SEVERITY", direction: "DESC" } };
  }
  var Q_PRINCIPALS = "query SidekickAiPrincipals($first: Int, $after: String, $filterBy: CloudResourceV2Filters, $orderBy: CloudResourceOrder) {\n  cloudResourcesV2(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      id\n      name\n      type\n      nativeType\n      hasSensitiveData\n      hasAccessToSensitiveData\n      hasAdminPrivileges\n      hasHighPrivileges\n      technology { id name categories { id name } }\n      cloudAccount { id name externalId cloudProvider }\n      projects { id name riskProfile { businessImpact } }\n      issueAnalytics {\n        issueCount\n        informationalSeverityCount\n        lowSeverityCount\n        mediumSeverityCount\n        highSeverityCount\n        criticalSeverityCount\n      }\n    }\n  }\n}\n";
  function aiPrincipalsVariables(scope) {
    const filterBy = {
      type: { equals: ["SERVICE_ACCOUNT", "ACCESS_KEY"] },
      identityPurpose: { equals: ["AGENTIC"] }
    };
    if (scope && scope.length) filterBy["projectId"] = scope;
    return { filterBy, orderBy: { field: "RELATED_ISSUE_SEVERITY", direction: "DESC" } };
  }

  // src/server/wizClientAi.ts
  var WizQueryError = class extends Error {
  };
  var TOKEN_CACHE_KEY = "wiz_ai_token";
  function getToken(forceRefresh = false) {
    var _a4, _b;
    const staticToken = getProp(PROP_KEYS.wizApiToken);
    if (staticToken && staticToken.trim()) return staticToken.trim();
    const cache = CacheService.getScriptCache();
    if (!forceRefresh) {
      const cached2 = cache.get(TOKEN_CACHE_KEY);
      if (cached2) return cached2;
    }
    const authUrl = (_a4 = getProp(PROP_KEYS.wizAuthUrl)) != null ? _a4 : DEFAULT_WIZ_AUTH_URL;
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
  function gqlPost(query, variables) {
    var _a4;
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
        const hint = code === 401 && getProp(PROP_KEYS.wizApiToken) ? " \u2014 WIZ_API_TOKEN was rejected; it may have expired. Refresh it, or set WIZ_CLIENT_ID/WIZ_CLIENT_SECRET for auto-refresh." : "";
        throw new WizQueryError(
          `Wiz query failed (HTTP ${code})${hint}: ${response.getContentText().slice(0, 500)}`
        );
      }
      const body = JSON.parse(response.getContentText());
      const data = body["data"];
      if (!data) {
        const errors = JSON.stringify((_a4 = body["errors"]) != null ? _a4 : body).slice(0, 500);
        throw new WizQueryError(`Wiz response carried no data: ${errors}`);
      }
      return data;
    }
    throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
  }
  function fetchEnumValues(enumName) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(enumName)) return null;
    const q = 'query SidekickEnumProbe {\n  __type(name: "' + enumName + '") { enumValues { name } }\n}\n';
    try {
      const data = gqlPost(q, {});
      const t = data["__type"];
      const values = t && t["enumValues"];
      if (!Array.isArray(values)) return null;
      return values.map((v) => String(v["name"])).filter(Boolean);
    } catch (e) {
      console.warn(`Enum probe for ${enumName} failed: ${e}`);
      return null;
    }
  }
  var AI_TYPES_CACHE_KEY = "wiz_ai_resource_types_v2";
  function probeCandidateTypes(candidates, say) {
    const accepted = [];
    for (const t of candidates) {
      try {
        fetchCloudResourcesPage({
          query: Q_AI_INVENTORY,
          first: 1,
          extraVariables: aiInventoryVariables([t])
        });
        accepted.push(t);
        say(`  ${t}: accepted`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isInvalidEnumValueError(msg)) {
          say(`  ${t}: not in this tenant's schema`);
          continue;
        }
        throw e;
      }
    }
    return accepted;
  }
  function resolveAiResourceTypes(log) {
    const say = log != null ? log : () => void 0;
    const overrideRaw = getProp(PROP_KEYS.wizAiResourceTypes);
    const override = overrideRaw ? overrideRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
    if (override && override.length) {
      say(`AI resource types: WIZ_AI_RESOURCE_TYPES override \u2014 ${override.join(", ")}.`);
      return { types: override, source: "override", aiLooking: [] };
    }
    const cache = CacheService.getScriptCache();
    if (!log) {
      const hit = cache.get(AI_TYPES_CACHE_KEY);
      if (hit) {
        try {
          return JSON.parse(hit);
        } catch {
        }
      }
    }
    let chosen;
    const enumValues = fetchEnumValues("CloudResourceTypeFilter");
    if (enumValues) {
      const picked = chooseAiResourceTypes(enumValues, null);
      say(
        `CloudResourceTypeFilter has ${enumValues.length} members; AI-flavored: ${picked.aiLooking.join(", ") || "(none)"}.`
      );
      if (!picked.types.length) {
        throw new WizQueryError(
          `This tenant's CloudResourceTypeFilter enum has no recognizable AI resource types. Set the WIZ_AI_RESOURCE_TYPES Script Property (comma-separated enum values). AI-flavored members seen: ${picked.aiLooking.join(", ") || "(none)"}.`
        );
      }
      chosen = picked;
    } else {
      say("Introspection unavailable \u2014 probing candidate types one by one:");
      const accepted = probeCandidateTypes(AI_RESOURCE_TYPE_CANDIDATES, say);
      if (!accepted.length) {
        throw new WizQueryError(
          "None of the candidate AI resource types (" + AI_RESOURCE_TYPE_CANDIDATES.join(", ") + ") exist in this tenant's CloudResourceTypeFilter enum, and introspection is unavailable. Find the tenant's AI type names (Wiz docs \u2192 GraphQL schema, or the Wiz UI's inventory filter) and set the WIZ_AI_RESOURCE_TYPES Script Property."
        );
      }
      chosen = { types: accepted, source: "probe", aiLooking: [] };
    }
    say(`Inventory will query types (${chosen.source}): ${chosen.types.join(", ")}.`);
    try {
      cache.put(AI_TYPES_CACHE_KEY, JSON.stringify(chosen), 21600);
    } catch {
    }
    return chosen;
  }
  function readConnection(connection, field) {
    var _a4, _b, _c;
    if (!connection || typeof connection !== "object") {
      throw new WizQueryError(`Wiz response carried no ${field} connection.`);
    }
    const pageInfo = (_a4 = connection["pageInfo"]) != null ? _a4 : {};
    const rawTotal = connection["totalCount"];
    return {
      rows: (_b = connection["nodes"]) != null ? _b : [],
      hasNextPage: Boolean(pageInfo["hasNextPage"]),
      endCursor: (_c = pageInfo["endCursor"]) != null ? _c : null,
      totalCount: typeof rawTotal === "number" ? rawTotal : null
    };
  }
  function fetchCloudResourcesPage(o) {
    var _a4;
    const run2 = (first) => {
      var _a5, _b;
      return readConnection(
        gqlPost(o.query, {
          first,
          after: (_a5 = o.cursor) != null ? _a5 : null,
          ...(_b = o.extraVariables) != null ? _b : {}
        })["cloudResourcesV2"],
        "cloudResourcesV2"
      );
    };
    try {
      return run2((_a4 = o.first) != null ? _a4 : PAGE_SIZE);
    } catch (e) {
      if (e instanceof WizQueryError && /HTTP 4\d\d/.test(e.message)) throw e;
      return run2(PAGE_SIZE_FALLBACK);
    }
  }
  function fetchConnectionPage(field, o) {
    var _a4;
    const run2 = (first) => {
      var _a5, _b;
      return readConnection(
        gqlPost(o.query, {
          first,
          after: (_a5 = o.cursor) != null ? _a5 : null,
          ...(_b = o.extraVariables) != null ? _b : {}
        })[field],
        field
      );
    };
    try {
      return run2((_a4 = o.first) != null ? _a4 : PAGE_SIZE);
    } catch (e) {
      if (e instanceof WizQueryError && /HTTP 4\d\d/.test(e.message)) throw e;
      return run2(PAGE_SIZE_FALLBACK);
    }
  }
  function fetchGraphSearchPage(o) {
    var _a4;
    const run2 = (first) => {
      var _a5, _b;
      return readConnection(
        gqlPost(o.query, {
          quick: true,
          first,
          after: (_a5 = o.cursor) != null ? _a5 : null,
          ...(_b = o.extraVariables) != null ? _b : {}
        })["graphSearch"],
        "graphSearch"
      );
    };
    try {
      return run2((_a4 = o.first) != null ? _a4 : PAGE_SIZE);
    } catch (e) {
      if (e instanceof WizQueryError && /HTTP 4\d\d/.test(e.message)) throw e;
      return run2(PAGE_SIZE_FALLBACK);
    }
  }

  // src/server/diagnostics.ts
  function aiFlavored(values) {
    return values.filter((v) => {
      const tokens = v.toUpperCase().split(/[\s_]+/);
      return tokens.includes("AI") || tokens.includes("MCP") || tokens.includes("GENAI") || tokens.includes("LLM");
    });
  }
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
    var _a4;
    const lines = [];
    const log = (m) => {
      lines.push(m);
      console.log(m);
    };
    const apiUrl = getProp(PROP_KEYS.wizApiUrl);
    const authUrl = (_a4 = getProp(PROP_KEYS.wizAuthUrl)) != null ? _a4 : DEFAULT_WIZ_AUTH_URL;
    const token = getProp(PROP_KEYS.wizApiToken);
    const clientId = getProp(PROP_KEYS.wizClientId);
    const clientSecret = getProp(PROP_KEYS.wizClientSecret);
    const projectId = getProp(PROP_KEYS.wizProjectIdV2);
    const mode = resolveWizAuthMode(token, clientId, clientSecret);
    log("=== Wiz SIDEKICK AI diagnostic ===");
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
    try {
      const bearer = getToken(true);
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
    let chosen;
    try {
      chosen = resolveAiResourceTypes(log);
      log("Step 2 OK: AI resource types resolved.");
    } catch (e) {
      log(`Step 2 FAIL: ${e.message}`);
      return lines.join("\n");
    }
    const graphEnum = fetchEnumValues("GraphEntityTypeValue");
    if (graphEnum) {
      log(
        `Graph entity types: ${graphEnum.length} members; AI-flavored: ${aiFlavored(graphEnum).join(", ") || "(none \u2014 graph relationship steps will be skipped)"}.`
      );
    } else {
      log(
        "Graph entity introspection unavailable \u2014 graph relationship steps will be skipped automatically if this tenant rejects their queries."
      );
    }
    try {
      const page = fetchCloudResourcesPage({
        query: Q_AI_INVENTORY,
        first: 1,
        extraVariables: aiInventoryVariables(chosen.types)
      });
      log(
        `Step 3 OK: query succeeded \u2014 ${page.rows.length} AI asset(s) on page 1` + (page.totalCount !== null ? ` of ${page.totalCount} total` : "") + "."
      );
      log("=== All checks passed. Live syncs should work. ===");
    } catch (e) {
      const msg = e.message;
      log(`Step 3 FAIL: the query was rejected \u2014 ${msg}`);
      if (/HTTP 401|HTTP 403|Unauthorized/i.test(msg)) {
        log(
          "\u2192 401/403/Unauthorized: the token was not accepted (expired, invalid, or minted for a different tenant). Confirm the service account targets this tenant."
        );
      } else if (/HTTP 404/i.test(msg)) {
        log(
          "\u2192 404: WIZ_API_URL host/path is wrong \u2014 it must be https://api.<region>.app.wiz.io/graphql for your tenant's region."
        );
      } else if (/cannot represent value/i.test(msg)) {
        log(
          "\u2192 The tenant rejected one of the resolved type values. Set the WIZ_AI_RESOURCE_TYPES Script Property to the exact enum values your tenant accepts (comma-separated) and rerun this diagnostic."
        );
      } else {
        log(
          '\u2192 If the body names a field (e.g. "Cannot query field"), the service account lacks permission for it or the tenant schema differs \u2014 capture the response into ai/queries/reponse_schemas/ and reconcile the normalizers.'
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
    cancelSync: () => cancelSync2,
    getAssetDetail: () => getAssetDetail,
    getAssets: () => getAssets,
    getGraph: () => getGraph,
    getIssueDetail: () => getIssueDetail,
    getIssues: () => getIssues,
    getJobStatus: () => getJobStatus,
    getSettings: () => getSettings,
    getStorageStats: () => getStorageStats,
    getSyncHistory: () => getSyncHistory,
    getToxicCombos: () => getToxicCombos,
    resetData: () => resetData2,
    runSync: () => runSync,
    setSettings: () => setSettings
  });

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
  var AARS_BAND_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"];
  var AARS_BAND_SEVERITY_TOKEN = {
    CRITICAL: "CRITICAL",
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    LOW: "LOW",
    MINIMAL: "INFO"
  };
  var DEPTH_MIN = 1;
  var DEPTH_MAX = 3;
  var DEPTH_DEFAULT = 2;
  var MAX_NODES_DEFAULT = 120;
  var MAX_EDGES_DEFAULT = 250;

  // src/domain/settingsLogic.ts
  function clampDepth(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return DEPTH_DEFAULT;
    return Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, n));
  }
  function getDefaultDepth(settings) {
    var _a4;
    return clampDepth((_a4 = settings["default_depth"]) != null ? _a4 : DEPTH_DEFAULT);
  }
  function withDefaultDepth(settings, depth) {
    return { ...settings, default_depth: clampDepth(depth) };
  }
  function clampMaxNodes(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return MAX_NODES_DEFAULT;
    return Math.min(400, Math.max(30, n));
  }
  function getMaxNodes(settings) {
    var _a4;
    return clampMaxNodes((_a4 = settings["max_nodes"]) != null ? _a4 : MAX_NODES_DEFAULT);
  }
  function withMaxNodes(settings, maxNodes) {
    return { ...settings, max_nodes: clampMaxNodes(maxNodes) };
  }

  // src/domain/graphTypes.ts
  var NODE_KINDS = [
    // AI assets (Wiz AI-SPM resource types)
    "AI_AGENT",
    "AI_MODEL",
    "AI_GUARDRAIL",
    "AI_PIPELINE",
    "AI_DATASET",
    "MCP_SERVER",
    // AI assets seen in real tenants (Wiz inventory display names, normalized) —
    // appended so the original kinds keep their declaration order.
    "AI_AGENT_REGISTRY",
    "AI_DEPLOYMENT",
    "AI_EXTENSION",
    "AI_GATEWAY",
    "AI_SERVICE",
    "AI_SKILL",
    "AI_SKILL_TEMPLATE",
    "AI_TOOL",
    // identities
    "SERVICE_ACCOUNT",
    "USER_ACCOUNT",
    "ACCESS_ROLE",
    "ACCESS_ROLE_BINDING",
    "ACCESS_KEY",
    // data
    "BUCKET",
    "DATABASE",
    // compute / supply chain
    "VIRTUAL_MACHINE",
    "SERVERLESS",
    "CONTAINER_IMAGE",
    "REPOSITORY",
    // CIEM finding entities
    "EXCESSIVE_ACCESS_FINDING",
    "LATERAL_MOVEMENT_FINDING",
    // synthetic
    "ISSUE",
    // one node per open risk issue (toxic-combination instance)
    "SUMMARY",
    // collapse node: "+N more <kind>" emitted by the projection
    "SENSITIVE_DATA",
    // one node per data-exposed asset (AARS pillar C topology)
    "INTERNET_EXPOSURE"
    // one node per internet-exposed asset (exposure topology)
  ];
  var AI_ASSET_KINDS = [
    "AI_AGENT",
    "AI_MODEL",
    "AI_GUARDRAIL",
    "AI_PIPELINE",
    "AI_DATASET",
    "MCP_SERVER",
    "AI_AGENT_REGISTRY",
    "AI_DEPLOYMENT",
    "AI_EXTENSION",
    "AI_GATEWAY",
    "AI_SERVICE",
    "AI_SKILL",
    "AI_SKILL_TEMPLATE",
    "AI_TOOL"
  ];
  function kindFromWizType(t) {
    if (typeof t !== "string" || !t.trim()) return null;
    const norm = t.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return NODE_KINDS.includes(norm) ? norm : null;
  }
  function edgeId(src, type, dst, negated) {
    return `${src}|${type}|${dst}${negated ? "|neg" : ""}`;
  }

  // src/domain/graphProject.ts
  var DEFAULT_PER_KIND_CAP = {
    USER_ACCOUNT: 8,
    BUCKET: 6,
    ACCESS_ROLE_BINDING: 5
  };
  var DEFAULT_KIND_CAP = 12;
  function severityRank(s) {
    const i = SEVERITY_ORDER.indexOf(s != null ? s : "");
    return i === -1 ? SEVERITY_ORDER.length : i;
  }
  function nodeOrder(a, b) {
    var _a4, _b;
    const sev = severityRank(a.severity) - severityRank(b.severity);
    if (sev !== 0) return sev;
    const aars = ((_a4 = b.aars) != null ? _a4 : -1) - ((_b = a.aars) != null ? _b : -1);
    if (aars !== 0) return aars;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  }
  function passesFilters(node2, f) {
    var _a4, _b, _c, _d, _e, _f, _g;
    if (!f) return true;
    if (((_a4 = f.severities) == null ? void 0 : _a4.length) && !f.severities.includes((_b = node2.severity) != null ? _b : "")) return false;
    if (((_c = f.kinds) == null ? void 0 : _c.length) && !f.kinds.includes(node2.kind)) return false;
    if (((_d = f.clouds) == null ? void 0 : _d.length) && !f.clouds.includes((_e = node2.cloudPlatform) != null ? _e : "")) return false;
    if ((_f = f.projects) == null ? void 0 : _f.length) {
      const names = ((_g = node2.projects) != null ? _g : []).map((p) => p.name);
      if (!names.some((n) => f.projects.includes(n))) return false;
    }
    return true;
  }
  function projectGraph(doc, opts) {
    var _a4, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    const byId = /* @__PURE__ */ new Map();
    for (const n of doc.nodes) byId.set(n.id, n);
    const adjacency = /* @__PURE__ */ new Map();
    const sortedEdges = [...doc.edges].sort((a, b) => a.id < b.id ? -1 : 1);
    for (const edge2 of sortedEdges) {
      if (!byId.has(edge2.src) || !byId.has(edge2.dst)) continue;
      if (!adjacency.has(edge2.src)) adjacency.set(edge2.src, []);
      if (!adjacency.has(edge2.dst)) adjacency.set(edge2.dst, []);
      adjacency.get(edge2.src).push({ edge: edge2, otherId: edge2.dst });
      adjacency.get(edge2.dst).push({ edge: edge2, otherId: edge2.src });
    }
    const maxNodes = (_a4 = opts.maxNodes) != null ? _a4 : MAX_NODES_DEFAULT;
    const maxEdges = (_b = opts.maxEdges) != null ? _b : MAX_EDGES_DEFAULT;
    const expand = new Set((_c = opts.expandIds) != null ? _c : []);
    let capped = false;
    const shown = /* @__PURE__ */ new Set();
    const summaries = [];
    const summaryNodes = [];
    const summaryEdges = [];
    const queue = [];
    for (const seedId of opts.seedIds) {
      if (!byId.has(seedId) || shown.has(seedId)) continue;
      if (shown.size >= maxNodes) {
        capped = true;
        break;
      }
      shown.add(seedId);
      queue.push({ id: seedId, depth: 0 });
    }
    while (queue.length) {
      const { id, depth } = queue.shift();
      if (depth >= opts.depth) continue;
      const groups = /* @__PURE__ */ new Map();
      for (const { otherId } of (_d = adjacency.get(id)) != null ? _d : []) {
        if (shown.has(otherId)) continue;
        const other = byId.get(otherId);
        if (!passesFilters(other, opts.filters)) continue;
        if (!groups.has(other.kind)) groups.set(other.kind, []);
        const group = groups.get(other.kind);
        if (!group.some((n) => n.id === otherId)) group.push(other);
      }
      for (const kind of [...groups.keys()].sort()) {
        const members = groups.get(kind).sort(nodeOrder);
        const cap = expand.has(id) ? Infinity : (_g = (_f = (_e = opts.perKindCap) == null ? void 0 : _e[kind]) != null ? _f : DEFAULT_PER_KIND_CAP[kind]) != null ? _g : DEFAULT_KIND_CAP;
        const overflow = members.length > cap;
        const kept = overflow ? members.slice(0, Math.max(1, cap - 1)) : members;
        for (const member of kept) {
          if (shown.size >= maxNodes) {
            capped = true;
            break;
          }
          shown.add(member.id);
          queue.push({ id: member.id, depth: depth + 1 });
        }
        const hidden = members.filter((m) => !shown.has(m.id));
        if (hidden.length) {
          if (!overflow) {
            capped = true;
            continue;
          }
          const sumId = `sum|${id}|${kind}`;
          summaries.push({
            id: sumId,
            of: kind,
            count: hidden.length,
            parentId: id,
            memberIds: hidden.map((m) => m.id)
          });
          summaryNodes.push({
            id: sumId,
            kind: "SUMMARY",
            name: `+${hidden.length} more`,
            summaryOf: kind,
            summaryCount: hidden.length,
            memberIds: hidden.map((m) => m.id)
          });
          const viaEdge = (_i = ((_h = adjacency.get(id)) != null ? _h : []).find(
            (a) => a.otherId === hidden[0].id
          )) == null ? void 0 : _i.edge;
          summaryEdges.push({
            id: `${id}|SUMMARY|${sumId}`,
            src: id,
            dst: sumId,
            type: (_j = viaEdge == null ? void 0 : viaEdge.type) != null ? _j : "USES"
          });
        }
      }
    }
    const edges2 = [];
    const seenEdge = /* @__PURE__ */ new Set();
    for (const edge2 of sortedEdges) {
      if (!shown.has(edge2.src) || !shown.has(edge2.dst)) continue;
      if (seenEdge.has(edge2.id)) continue;
      seenEdge.add(edge2.id);
      if (edges2.length >= maxEdges) {
        capped = true;
        break;
      }
      edges2.push(edge2);
    }
    const nodes = doc.nodes.filter((n) => shown.has(n.id));
    return {
      nodes: [...nodes, ...summaryNodes],
      edges: [...edges2, ...summaryEdges],
      summaries,
      counts: {
        totalNodes: doc.nodes.length,
        shownNodes: nodes.length,
        totalEdges: doc.edges.length,
        shownEdges: edges2.length,
        capped
      }
    };
  }

  // src/domain/graphLayout.ts
  var LAYOUT_MODES = ["lanes", "grouped"];
  var GROUP_KEYS = ["asset", "combo", "project", "cloud", "kind", "severity"];
  var SORT_KEYS = ["smart", "severity", "aars", "name"];
  var GROUP_NONE = "__none__";
  var LANE_OF = {
    ISSUE: 0,
    EXCESSIVE_ACCESS_FINDING: 0,
    LATERAL_MOVEMENT_FINDING: 0,
    AI_AGENT: 1,
    AI_MODEL: 1,
    AI_GUARDRAIL: 1,
    AI_PIPELINE: 1,
    AI_DATASET: 1,
    MCP_SERVER: 1,
    AI_AGENT_REGISTRY: 1,
    AI_DEPLOYMENT: 1,
    AI_EXTENSION: 1,
    AI_GATEWAY: 1,
    AI_SERVICE: 1,
    AI_SKILL: 1,
    AI_SKILL_TEMPLATE: 1,
    AI_TOOL: 1,
    SERVICE_ACCOUNT: 2,
    USER_ACCOUNT: 2,
    ACCESS_ROLE: 2,
    ACCESS_ROLE_BINDING: 2,
    BUCKET: 3,
    DATABASE: 3,
    SENSITIVE_DATA: 3,
    VIRTUAL_MACHINE: 4,
    SERVERLESS: 4,
    CONTAINER_IMAGE: 4,
    REPOSITORY: 4
  };
  var LANE_COUNT = 5;
  function laneOf(kind, summaryOf) {
    var _a4, _b;
    if (kind === "SUMMARY" && summaryOf) return (_a4 = LANE_OF[summaryOf]) != null ? _a4 : 2;
    return (_b = LANE_OF[kind]) != null ? _b : 2;
  }
  var BARYCENTER_SWEEPS = 3;
  var CELL_W = 240;
  var CELL_H = 84;
  var GROUP_PAD = 24;
  var HEADER_H = 30;
  var BLOCK_GAP_X = 48;
  var BLOCK_GAP_Y = 64;
  var MAX_SHELF_W = 1600;
  function severityRank2(s) {
    const i = SEVERITY_ORDER.indexOf(s != null ? s : "");
    return i === -1 ? SEVERITY_ORDER.length : i;
  }
  function cmpName(a, b) {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  }
  function cmpId(a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  function comparator(sort) {
    if (sort === "severity") {
      return (a, b) => severityRank2(a.severity) - severityRank2(b.severity) || cmpName(a, b) || cmpId(a, b);
    }
    if (sort === "aars") {
      return (a, b) => {
        var _a4, _b;
        return ((_a4 = b.aars) != null ? _a4 : -1) - ((_b = a.aars) != null ? _b : -1) || cmpName(a, b) || cmpId(a, b);
      };
    }
    if (sort === "name") {
      return (a, b) => cmpName(a, b) || cmpId(a, b);
    }
    return (a, b) => nodeOrder(a, b) || cmpId(a, b);
  }
  function layoutGraph(p, opts = {}) {
    var _a4;
    if (((_a4 = opts.mode) != null ? _a4 : "lanes") === "grouped") return layoutGrouped(p, opts);
    return layoutLanes(p, opts);
  }
  function layoutLanes(p, opts) {
    var _a4, _b, _c, _d, _e, _f;
    const laneGap = (_a4 = opts.laneGap) != null ? _a4 : 280;
    const rowGap = (_b = opts.rowGap) != null ? _b : 84;
    const margin = (_c = opts.margin) != null ? _c : 120;
    const sort = (_d = opts.sort) != null ? _d : "smart";
    const lanes = Array.from({ length: LANE_COUNT }, () => []);
    const laneIndex = /* @__PURE__ */ new Map();
    for (const node2 of p.nodes) {
      const lane = laneOf(node2.kind, node2.summaryOf);
      laneIndex.set(node2.id, lane);
      lanes[lane].push(node2.id);
    }
    if (sort === "smart") {
      const neighbors = /* @__PURE__ */ new Map();
      for (const edge2 of p.edges) {
        if (!neighbors.has(edge2.src)) neighbors.set(edge2.src, []);
        if (!neighbors.has(edge2.dst)) neighbors.set(edge2.dst, []);
        neighbors.get(edge2.src).push(edge2.dst);
        neighbors.get(edge2.dst).push(edge2.src);
      }
      const rowOf = /* @__PURE__ */ new Map();
      const refreshRows = () => {
        for (const lane of lanes) lane.forEach((id, i) => rowOf.set(id, i));
      };
      refreshRows();
      for (let sweep = 0; sweep < BARYCENTER_SWEEPS; sweep++) {
        for (const lane of lanes) {
          if (lane.length < 2) continue;
          const score = /* @__PURE__ */ new Map();
          for (const id of lane) {
            const others = ((_e = neighbors.get(id)) != null ? _e : []).filter(
              (n) => laneIndex.get(n) !== laneIndex.get(id) && rowOf.has(n)
            );
            score.set(
              id,
              others.length ? others.reduce((acc, n) => {
                var _a5;
                return acc + ((_a5 = rowOf.get(n)) != null ? _a5 : 0);
              }, 0) / others.length : (_f = rowOf.get(id)) != null ? _f : 0
            );
          }
          lane.sort((a, b) => {
            var _a5, _b2, _c2, _d2;
            const d = ((_a5 = score.get(a)) != null ? _a5 : 0) - ((_b2 = score.get(b)) != null ? _b2 : 0);
            if (d !== 0) return d;
            return ((_c2 = rowOf.get(a)) != null ? _c2 : 0) - ((_d2 = rowOf.get(b)) != null ? _d2 : 0);
          });
          refreshRows();
        }
      }
    } else {
      const byId = new Map(p.nodes.map((n) => [n.id, n]));
      const cmp = comparator(sort);
      for (const lane of lanes) {
        lane.sort((a, b) => cmp(byId.get(a), byId.get(b)));
      }
    }
    const tallest = Math.max(1, ...lanes.map((l) => l.length));
    const nodes = [];
    lanes.forEach((lane, laneIdx) => {
      const offset = (tallest - lane.length) * rowGap / 2;
      lane.forEach((id, row) => {
        nodes.push({
          id,
          lane: laneIdx,
          x: margin + laneIdx * laneGap,
          y: margin + offset + row * rowGap
        });
      });
    });
    return {
      nodes,
      width: margin * 2 + (LANE_COUNT - 1) * laneGap,
      height: margin * 2 + (tallest - 1) * rowGap,
      laneGap,
      rowGap,
      mode: "lanes"
    };
  }
  function groupKeyOf(node2, groupBy, parentOfSummary) {
    var _a4, _b, _c, _d, _e, _f, _g;
    if (node2.kind === "SUMMARY" && groupBy !== "kind") {
      const parent = parentOfSummary.get(node2.id);
      return parent ? groupKeyOf(parent, groupBy, parentOfSummary) : GROUP_NONE;
    }
    switch (groupBy) {
      case "combo": {
        const groups = [...(_a4 = node2.comboGroups) != null ? _a4 : []].sort();
        return (_b = groups[0]) != null ? _b : GROUP_NONE;
      }
      case "project": {
        const names = ((_c = node2.projects) != null ? _c : []).map((p) => p.name).sort();
        return (_d = names[0]) != null ? _d : GROUP_NONE;
      }
      case "cloud":
        return (_e = node2.cloudPlatform) != null ? _e : GROUP_NONE;
      case "kind":
        return node2.kind === "SUMMARY" ? (_f = node2.summaryOf) != null ? _f : "SUMMARY" : node2.kind;
      case "severity":
        return (_g = node2.severity) != null ? _g : GROUP_NONE;
      case "asset":
        return GROUP_NONE;
    }
  }
  function groupLabel(key, groupBy) {
    var _a4, _b;
    if (key === GROUP_NONE) return "Ungrouped";
    if (groupBy === "combo") return (_b = (_a4 = comboGroupById(key)) == null ? void 0 : _a4.shortLabel) != null ? _b : key;
    return key;
  }
  function orderGroups(keys, groupBy, members) {
    const canonical = (key) => {
      if (groupBy === "severity") return SEVERITY_ORDER.indexOf(key);
      if (groupBy === "kind") return NODE_KINDS.indexOf(key);
      if (groupBy === "combo") return COMBO_GROUPS.findIndex((g) => g.id === key);
      return -1;
    };
    const worstSeverity2 = (key) => {
      var _a4;
      let worst = SEVERITY_ORDER.length;
      for (const n of (_a4 = members.get(key)) != null ? _a4 : []) worst = Math.min(worst, severityRank2(n.severity));
      return worst;
    };
    return [...keys].sort((a, b) => {
      if (a === GROUP_NONE) return b === GROUP_NONE ? 0 : 1;
      if (b === GROUP_NONE) return -1;
      const ca = canonical(a);
      const cb = canonical(b);
      if (ca !== -1 || cb !== -1) {
        if (ca === -1) return 1;
        if (cb === -1) return -1;
        return ca - cb;
      }
      return worstSeverity2(a) - worstSeverity2(b) || (a < b ? -1 : a > b ? 1 : 0);
    });
  }
  var RING_CAP = 8;
  var RING_RX = 300;
  var RING_RY = 150;
  function round2(v) {
    return Math.round(v * 100) / 100;
  }
  function gridBlock(key, label, list) {
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(list.length))));
    const rows = Math.ceil(list.length / cols);
    return {
      key,
      label,
      width: GROUP_PAD * 2 + cols * CELL_W,
      height: HEADER_H + GROUP_PAD * 2 + rows * CELL_H,
      cells: list.map((node2, i) => ({
        id: node2.id,
        x: GROUP_PAD + i % cols * CELL_W + CELL_W / 2,
        y: HEADER_H + GROUP_PAD + Math.floor(i / cols) * CELL_H + CELL_H / 2
      }))
    };
  }
  function radialBlock(key, label, hub, satellites) {
    const rings = [];
    for (let i = 0, ring = 1; i < satellites.length; ring++) {
      rings.push(satellites.slice(i, i + RING_CAP * ring));
      i += RING_CAP * ring;
    }
    const n = rings.length;
    const halfW = RING_RX * n + CELL_W / 2;
    const halfH = RING_RY * n + CELL_H / 2;
    const width = GROUP_PAD * 2 + halfW * 2;
    const height = HEADER_H + GROUP_PAD * 2 + halfH * 2;
    const cx = width / 2;
    const cy = HEADER_H + GROUP_PAD + halfH;
    const cells = [{ id: hub.id, x: cx, y: cy }];
    rings.forEach((ringNodes, ri) => {
      const rx = RING_RX * (ri + 1);
      const ry = RING_RY * (ri + 1);
      const step = Math.PI * 2 / ringNodes.length;
      ringNodes.forEach((node2, k) => {
        const a = -Math.PI / 2 + k * step;
        cells.push({
          id: node2.id,
          x: round2(cx + rx * Math.cos(a)),
          y: round2(cy + ry * Math.sin(a))
        });
      });
    });
    return { key, label, width, height, cells };
  }
  function assignToHubs(p, parentOfSummary) {
    var _a4;
    const cmp = (a, b) => nodeOrder(a, b) || cmpId(a, b);
    let hubs = p.nodes.filter((n) => n.kind === "AI_AGENT");
    if (!hubs.length) {
      hubs = p.nodes.filter((n) => AI_ASSET_KINDS.includes(n.kind));
    }
    hubs = [...hubs].sort(cmp);
    const adj = /* @__PURE__ */ new Map();
    const sortedEdges = [...p.edges].sort((a, b) => a.id < b.id ? -1 : 1);
    for (const e of sortedEdges) {
      if (!adj.has(e.src)) adj.set(e.src, []);
      if (!adj.has(e.dst)) adj.set(e.dst, []);
      adj.get(e.src).push(e.dst);
      adj.get(e.dst).push(e.src);
    }
    const hubOf = /* @__PURE__ */ new Map();
    const queue = [];
    for (const h of hubs) {
      hubOf.set(h.id, h.id);
      queue.push(h.id);
    }
    while (queue.length) {
      const id = queue.shift();
      for (const next of (_a4 = adj.get(id)) != null ? _a4 : []) {
        if (hubOf.has(next)) continue;
        hubOf.set(next, hubOf.get(id));
        queue.push(next);
      }
    }
    for (const [sumId, parent] of parentOfSummary) {
      const h = hubOf.get(parent.id);
      if (h) hubOf.set(sumId, h);
    }
    return { hubOf, hubs };
  }
  function layoutGrouped(p, opts) {
    var _a4, _b, _c;
    const margin = (_a4 = opts.margin) != null ? _a4 : 120;
    const groupBy = (_b = opts.groupBy) != null ? _b : "combo";
    const sort = (_c = opts.sort) != null ? _c : "smart";
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const parentOfSummary = /* @__PURE__ */ new Map();
    for (const s of p.summaries) {
      const parent = byId.get(s.parentId);
      if (parent) parentOfSummary.set(s.id, parent);
    }
    const cmp = comparator(sort);
    const specs = [];
    if (groupBy === "asset") {
      const { hubOf, hubs } = assignToHubs(p, parentOfSummary);
      const members = new Map(hubs.map((h) => [h.id, []]));
      const strays = [];
      for (const node2 of p.nodes) {
        const key = hubOf.get(node2.id);
        if (key) members.get(key).push(node2);
        else strays.push(node2);
      }
      for (const hub of hubs) {
        const sats = members.get(hub.id).filter((n) => n.id !== hub.id).sort(cmp);
        specs.push(radialBlock(hub.id, hub.name, hub, sats));
      }
      if (strays.length) specs.push(gridBlock(GROUP_NONE, "Ungrouped", [...strays].sort(cmp)));
    } else {
      const members = /* @__PURE__ */ new Map();
      for (const node2 of p.nodes) {
        const key = groupKeyOf(node2, groupBy, parentOfSummary);
        if (!members.has(key)) members.set(key, []);
        members.get(key).push(node2);
      }
      for (const key of orderGroups([...members.keys()], groupBy, members)) {
        specs.push(gridBlock(key, groupLabel(key, groupBy), [...members.get(key)].sort(cmp)));
      }
    }
    const totalArea = specs.reduce(
      (acc, s) => acc + (s.width + BLOCK_GAP_X) * (s.height + BLOCK_GAP_Y),
      0
    );
    const shelfW = Math.max(MAX_SHELF_W, Math.ceil(Math.sqrt(totalArea * 1.8)));
    const nodes = [];
    const groups = [];
    let shelfX = margin;
    let shelfY = margin;
    let shelfH = 0;
    let maxX = 0;
    specs.forEach((spec, groupIdx) => {
      if (shelfX > margin && shelfX + spec.width > margin + shelfW) {
        shelfY += shelfH + BLOCK_GAP_Y;
        shelfX = margin;
        shelfH = 0;
      }
      const gx = shelfX;
      const gy = shelfY;
      shelfX += spec.width + BLOCK_GAP_X;
      shelfH = Math.max(shelfH, spec.height);
      maxX = Math.max(maxX, gx + spec.width);
      groups.push({
        id: `${groupBy}:${spec.key}`,
        key: spec.key,
        label: spec.label,
        x: gx,
        y: gy,
        width: spec.width,
        height: spec.height,
        count: spec.cells.length
      });
      for (const c of spec.cells) {
        nodes.push({ id: c.id, lane: groupIdx, x: gx + c.x, y: gy + c.y });
      }
    });
    return {
      nodes,
      width: maxX + margin,
      height: shelfY + shelfH + margin,
      laneGap: CELL_W,
      rowGap: CELL_H,
      mode: "grouped",
      groups
    };
  }

  // src/domain/graphApiParams.ts
  function toList(v) {
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    if (typeof v === "string") return v.split(",").filter(Boolean);
    return [];
  }
  function comboAssetIds(issues2, groupId) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const issue2 of issues2) {
      if (issue2.status !== "OPEN" || !issue2.comboGroup) continue;
      if (groupId && issue2.comboGroup !== groupId) continue;
      if (issue2.assetId && !seen.has(issue2.assetId)) {
        seen.add(issue2.assetId);
        out.push(issue2.assetId);
      }
    }
    return out;
  }
  function pick(v, allowed, fallback) {
    const s = typeof v === "string" ? v.toLowerCase() : "";
    return allowed.includes(s) ? s : fallback;
  }
  function resolveLayoutParams(p) {
    return {
      mode: pick(p["layout"], LAYOUT_MODES, "lanes"),
      groupBy: pick(p["groupBy"], GROUP_KEYS, "combo"),
      sort: pick(p["sort"], SORT_KEYS, "smart")
    };
  }
  function resolveGraphParams(p, ctx) {
    var _a4;
    const seed = typeof p["seed"] === "string" ? p["seed"] : "";
    const seedKind = typeof p["seedKind"] === "string" ? p["seedKind"] : "";
    let seedIds;
    if (seed && (seedKind === "combo" || comboGroupById(seed))) {
      seedIds = comboAssetIds(ctx.issues, seed);
    } else if (seed) {
      seedIds = [seed];
    } else {
      seedIds = comboAssetIds(ctx.issues);
    }
    const filters = {
      severities: toList(p["severities"]),
      kinds: toList(p["kinds"]),
      projects: toList(p["projects"]),
      clouds: toList(p["clouds"])
    };
    const hasFilters = filters.severities.length || filters.kinds.length || filters.projects.length || filters.clouds.length;
    const rawDepth = p["depth"];
    return {
      seedIds,
      depth: clampDepth(rawDepth == null || rawDepth === "" ? ctx.defaultDepth : rawDepth),
      expandIds: toList(p["expand"]),
      filters: hasFilters ? filters : void 0,
      maxNodes: clampMaxNodes((_a4 = p["maxNodes"]) != null ? _a4 : ctx.maxNodes),
      maxEdges: MAX_EDGES_DEFAULT
    };
  }
  function graphCacheParams(p) {
    const sorted = (v) => toList(v).sort();
    return {
      seed: typeof p["seed"] === "string" ? p["seed"] : "",
      seedKind: typeof p["seedKind"] === "string" ? p["seedKind"] : "",
      depth: p["depth"] == null || p["depth"] === "" ? "" : String(p["depth"]),
      maxNodes: p["maxNodes"] == null ? "" : String(p["maxNodes"]),
      expand: sorted(p["expand"]),
      severities: sorted(p["severities"]),
      kinds: sorted(p["kinds"]),
      projects: sorted(p["projects"]),
      clouds: sorted(p["clouds"]),
      view: resolveLayoutParams(p)
    };
  }

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
  function nowIso(now) {
    return toIso(now != null ? now : Date.now());
  }

  // src/server/jobsStore.ts
  var ACTIVE_JOB_PROP = "ACTIVE_JOB_ID";
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
    setProp(ACTIVE_JOB_PROP, full.job_id);
    return full;
  }
  function updateJob(jobId, patch, now) {
    updateWhere(TABS.jobs, "job_id", jobId, {
      ...patch,
      updated_at: nowIso(now)
    });
    if (patch.phase && TERMINAL.includes(patch.phase)) deleteProp(ACTIVE_JOB_PROP);
  }
  function listJobs() {
    return readAll(TABS.jobs).map((r) => {
      var _a4, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
      return {
        job_id: String((_a4 = r["job_id"]) != null ? _a4 : ""),
        kind: (_b = r["kind"]) != null ? _b : "sync",
        phase: (_c = r["phase"]) != null ? _c : "FAILED",
        sync_id: (_d = r["sync_id"]) != null ? _d : null,
        step_index: Number((_e = r["step_index"]) != null ? _e : 0),
        cursor: (_f = r["cursor"]) != null ? _f : null,
        page: Number((_g = r["page"]) != null ? _g : 0),
        nodes_so_far: Number((_h = r["nodes_so_far"]) != null ? _h : 0),
        total_count: Number((_i = r["total_count"]) != null ? _i : 0),
        part_refs_json: (_j = r["part_refs_json"]) != null ? _j : null,
        params_json: (_k = r["params_json"]) != null ? _k : null,
        error: normError(r["error"]),
        started_at: String((_l = r["started_at"]) != null ? _l : ""),
        updated_at: String((_m = r["updated_at"]) != null ? _m : "")
      };
    });
  }
  function getJob(jobId) {
    var _a4;
    return (_a4 = listJobs().find((j) => j.job_id === jobId)) != null ? _a4 : null;
  }
  var TERMINAL = ["DONE", "FAILED", "CANCELLED"];
  function activeJob() {
    var _a4;
    if (!getProp(ACTIVE_JOB_PROP)) return null;
    const job = (_a4 = listJobs().find((j) => !TERMINAL.includes(j.phase))) != null ? _a4 : null;
    if (!job) deleteProp(ACTIVE_JOB_PROP);
    return job;
  }

  // src/server/locks.ts
  var LedgerBusyError = class extends Error {
  };
  var DEAD_JOB_MS = 30 * 60 * 1e3;
  function withScriptLock(fn, timeoutMs = 3e4) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(timeoutMs)) {
      throw new LedgerBusyError(
        "The data store is busy (a sync is writing). Try again shortly."
      );
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }
  function recoverIfNeeded(now) {
    const job = activeJob();
    if (!job) return;
    const updated = parseTs(job.updated_at);
    const ageMs = updated === null ? Infinity : (now != null ? now : Date.now()) - updated;
    if (job.phase === "PERSISTING" || ageMs > DEAD_JOB_MS) {
      updateJob(job.job_id, {
        phase: "FAILED",
        error: "Recovered: execution died mid-sync; the last committed snapshot is unchanged."
      });
    }
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

  // src/server/serverCache.ts
  var VERSION_PROP = "DATA_VERSION";
  var KEY_PREFIX = "wsk";
  var CHUNK_CHARS = 9e4;
  var DEFAULT_TTL_SEC = 21600;
  function dataVersion() {
    var _a4;
    return (_a4 = getProp(VERSION_PROP)) != null ? _a4 : "0";
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
  var getDefaultDepth2 = () => getDefaultDepth(loadSettings());
  var getMaxNodes2 = () => getMaxNodes(loadSettings());
  function setDefaultDepth(depth) {
    saveSettings(withDefaultDepth(loadSettings(), depth));
  }
  function setMaxNodes(maxNodes) {
    saveSettings(withMaxNodes(loadSettings(), maxNodes));
  }

  // src/server/syncJobs.ts
  var syncJobs_exports = {};
  __export(syncJobs_exports, {
    cancelRequested: () => cancelRequested,
    cancelSync: () => cancelSync,
    clearCancelFlag: () => clearCancelFlag,
    continueJob: () => continueJob,
    dailySync: () => dailySync,
    jobStatus: () => jobStatus,
    startSync: () => startSync
  });

  // src/domain/syncNormalize.ts
  function str(v) {
    const c = clean(v);
    return c === null ? void 0 : String(c);
  }
  function bool(v) {
    return v === true;
  }
  function triBool(v) {
    return v === true ? true : v === false ? false : null;
  }
  function normalizeCloudResource(raw) {
    var _a4, _b;
    const id = str(raw["id"]);
    const kind = kindFromWizType(raw["type"]);
    if (!id || !kind) return null;
    const node2 = {
      id,
      kind,
      name: (_a4 = str(raw["name"])) != null ? _a4 : id,
      nativeType: str(raw["nativeType"]),
      cloudPlatform: str(raw["cloudPlatform"]),
      region: str(raw["region"]),
      status: str(raw["status"]),
      firstSeen: str(raw["firstSeen"]),
      lastSeen: str(raw["lastSeen"]),
      externalId: str(raw["externalId"]),
      isAccessibleFromInternet: triBool(raw["isAccessibleFromInternet"]),
      isOpenToAllInternet: triBool(raw["isOpenToAllInternet"]),
      hasSensitiveData: bool(raw["hasSensitiveData"]),
      hasAccessToSensitiveData: bool(raw["hasAccessToSensitiveData"]),
      hasHighPrivileges: bool(raw["hasHighPrivileges"]),
      hasAdminPrivileges: bool(raw["hasAdminPrivileges"])
    };
    const technology = raw["technology"];
    if (technology && typeof technology === "object") {
      const cats = technology["categories"];
      if (Array.isArray(cats)) {
        const names = cats.map((c) => str(c["name"])).filter((n) => Boolean(n));
        if (names.length) node2.technologyCategories = names;
      }
    }
    const ia = raw["issueAnalytics"];
    if (ia && typeof ia === "object") {
      const num = (v) => typeof v === "number" ? v : Number(v) || 0;
      node2.issueAnalytics = {
        total: num(ia["issueCount"]),
        info: num(ia["informationalSeverityCount"]),
        low: num(ia["lowSeverityCount"]),
        medium: num(ia["mediumSeverityCount"]),
        high: num(ia["highSeverityCount"]),
        critical: num(ia["criticalSeverityCount"])
      };
    }
    const account = raw["cloudAccount"];
    if (account && typeof account === "object") {
      const accId = str(account["id"]);
      if (accId) {
        node2.cloudAccount = {
          id: accId,
          name: (_b = str(account["name"])) != null ? _b : accId,
          externalId: str(account["externalId"]),
          cloudProvider: str(account["cloudProvider"])
        };
      }
    }
    const projects = raw["projects"];
    if (Array.isArray(projects)) {
      node2.projects = projects.map((p) => {
        const rec = p;
        const pid = str(rec["id"]);
        const name = str(rec["name"]);
        const riskProfile = rec["riskProfile"];
        const businessImpact = riskProfile && typeof riskProfile === "object" ? str(riskProfile["businessImpact"]) : void 0;
        return pid && name ? { id: pid, name, businessImpact } : null;
      }).filter((p) => p !== null);
    }
    const tags = raw["tags"];
    if (Array.isArray(tags)) {
      node2.tags = tags.map((t) => {
        var _a5;
        const rec = t;
        const key = str(rec["key"]);
        return key ? { key, value: (_a5 = str(rec["value"])) != null ? _a5 : "" } : null;
      }).filter((t) => t !== null);
    }
    return node2;
  }
  function emptyPart() {
    return { nodes: [], edges: [], issues: [], findings: [] };
  }
  function normalizeInventoryPage(rows) {
    const part = emptyPart();
    for (const raw of rows) {
      const node2 = normalizeCloudResource(raw);
      if (node2) part.nodes.push(node2);
    }
    return part;
  }
  function normalizePrincipalsPage(rows) {
    const part = emptyPart();
    for (const raw of rows) {
      const node2 = normalizeCloudResource(raw);
      if (!node2) continue;
      node2.identityPurpose = "AGENTIC";
      part.nodes.push(node2);
    }
    return part;
  }
  function normalizeRuleAssetsPage(rows, group) {
    var _a4, _b;
    const part = emptyPart();
    for (const raw of rows) {
      const node2 = normalizeCloudResource(raw);
      if (!node2) continue;
      part.nodes.push(node2);
      part.issues.push({
        id: `live-${group.ruleId}-${node2.id}`,
        ruleId: group.ruleId,
        ruleName: group.title,
        comboGroup: group.id,
        nativeSeverity: group.nativeSeverity,
        adjustedSeverity: group.adjustedSeverity,
        status: "OPEN",
        assetId: node2.id,
        assetName: node2.name,
        region: node2.region,
        account: (_a4 = node2.cloudAccount) == null ? void 0 : _a4.name,
        projects: ((_b = node2.projects) != null ? _b : []).map((p) => p.name),
        frameworks: group.frameworks
      });
    }
    return part;
  }
  function normalizeIssuesPage(rows) {
    var _a4, _b, _c, _d, _e, _f, _g, _h;
    const part = emptyPart();
    for (const raw of rows) {
      const issueId = str(raw["id"]);
      const snap = raw["entitySnapshot"];
      const assetId = snap && typeof snap === "object" ? str(snap["id"]) : void 0;
      if (!issueId || !assetId) continue;
      const sourceRules = Array.isArray(raw["sourceRules"]) ? raw["sourceRules"] : [];
      const first = (_a4 = sourceRules[0]) != null ? _a4 : {};
      const ruleId = str(first["id"]);
      const ruleName = str(first["name"]);
      const group = classifyIssue({ sourceRuleId: ruleId != null ? ruleId : null, ruleName: ruleName != null ? ruleName : null });
      const nativeSeverity = (_b = str(raw["severity"])) != null ? _b : "UNKNOWN";
      const adjustedSeverity = group ? group.adjustedSeverity : nativeSeverity;
      const control = first["control"];
      const resolutionRecommendation = (_c = str(first["resolutionRecommendation"])) != null ? _c : control && typeof control === "object" ? str(control["resolutionRecommendation"]) : void 0;
      const assetName = (_d = str(snap["name"])) != null ? _d : assetId;
      const projects = Array.isArray(raw["projects"]) ? raw["projects"].map((p) => str(p["name"])).filter((n) => Boolean(n)) : [];
      part.issues.push({
        id: issueId,
        ruleId: (_e = ruleId != null ? ruleId : group == null ? void 0 : group.ruleId) != null ? _e : "",
        ruleName: (_f = ruleName != null ? ruleName : group == null ? void 0 : group.title) != null ? _f : "",
        comboGroup: (_g = group == null ? void 0 : group.id) != null ? _g : "",
        nativeSeverity,
        adjustedSeverity,
        status: (_h = str(raw["status"])) != null ? _h : "OPEN",
        assetId,
        assetName,
        region: str(snap["region"]),
        account: str(snap["subscriptionName"]),
        projects,
        frameworks: group == null ? void 0 : group.frameworks,
        createdAt: str(raw["createdAt"]),
        dueAt: str(raw["dueAt"]),
        resolutionRecommendation
      });
      const kind = kindFromWizType(snap["type"]);
      if (kind) {
        const node2 = { id: assetId, kind, name: assetName };
        const nativeType = str(snap["nativeType"]);
        if (nativeType) node2.nativeType = nativeType;
        const cloud = str(snap["cloudPlatform"]);
        if (cloud) node2.cloudPlatform = cloud;
        const region = str(snap["region"]);
        if (region) node2.region = region;
        const externalId = str(snap["externalId"]);
        if (externalId) node2.externalId = externalId;
        part.nodes.push(node2);
      }
    }
    return part;
  }
  function reconcileIssues(issues2) {
    const realKeys = /* @__PURE__ */ new Set();
    for (const i of issues2) {
      if (!i.id.startsWith("live-")) realKeys.add(`${i.assetId}|${i.comboGroup}`);
    }
    return issues2.filter(
      (i) => !i.id.startsWith("live-") || !realKeys.has(`${i.assetId}|${i.comboGroup}`)
    );
  }
  function frameworkCodesFromRule(rule, shortId) {
    const codes = [];
    const add = (c) => {
      if (c && !codes.includes(c)) codes.push(c);
    };
    add(shortId || void 0);
    const owasp = /\b(LLM\d{2}|ASI\d{2}|ML[_A-Z]+)\b/;
    const scan = (v) => {
      const s = typeof v === "string" ? v.toUpperCase() : "";
      const m = s.match(owasp);
      if (m) add(m[0]);
    };
    if (rule && typeof rule === "object") {
      const tags = rule["tags"];
      if (Array.isArray(tags)) for (const t of tags) scan(t == null ? void 0 : t["value"]);
      const risks = rule["risks"];
      if (Array.isArray(risks)) for (const r of risks) scan(r);
    }
    return codes;
  }
  function normalizeConfigFindingsPage(rows) {
    var _a4, _b;
    const part = emptyPart();
    for (const raw of rows) {
      const id = str(raw["id"]);
      if (!id) continue;
      if (str(raw["result"]) !== "FAIL") continue;
      const status = str(raw["status"]);
      if (status && status !== "OPEN") continue;
      const resource = raw["resource"];
      const resourceId = resource && typeof resource === "object" ? str(resource["id"]) : void 0;
      if (!resourceId) continue;
      const rule = raw["rule"];
      const ruleShortId = rule && typeof rule === "object" ? (_a4 = str(rule["shortId"])) != null ? _a4 : "" : "";
      part.findings.push({
        id,
        resourceId,
        ruleShortId,
        severity: (_b = str(raw["severity"])) != null ? _b : "UNKNOWN",
        remediation: str(raw["remediation"]),
        frameworkCodes: frameworkCodesFromRule(rule, ruleShortId)
      });
    }
    return part;
  }
  function entitiesOf(row) {
    if (!row || typeof row !== "object") return [];
    const entities = row["entities"];
    if (!Array.isArray(entities)) return [];
    return entities.map((e) => normalizeCloudResource(e)).filter((n) => n !== null);
  }
  function normalizeNoGuardrailPage(rows) {
    const part = emptyPart();
    for (const row of rows) {
      for (const node2 of entitiesOf(row)) {
        if (node2.kind !== "AI_AGENT") continue;
        node2.guardrailMissing = true;
        part.nodes.push(node2);
      }
    }
    return part;
  }
  function normalizeRunsAsPage(rows) {
    const part = emptyPart();
    for (const row of rows) {
      const entities = entitiesOf(row);
      const agent = entities.find((e) => e.kind === "AI_AGENT");
      const sa = entities.find((e) => e.kind === "SERVICE_ACCOUNT");
      const findings = entities.filter(
        (e) => e.kind === "EXCESSIVE_ACCESS_FINDING" || e.kind === "LATERAL_MOVEMENT_FINDING"
      );
      part.nodes.push(...entities);
      if (agent && sa) {
        part.edges.push({ id: edgeId(agent.id, "RUNS_AS", sa.id), src: agent.id, dst: sa.id, type: "RUNS_AS" });
        for (const f of findings) {
          part.edges.push({ id: edgeId(sa.id, "HAS_FINDING", f.id), src: sa.id, dst: f.id, type: "HAS_FINDING" });
        }
      }
    }
    return part;
  }
  function normalizeIdentityAccessPage(rows) {
    const part = emptyPart();
    for (const row of rows) {
      const entities = entitiesOf(row);
      const agent = entities.find((e) => e.kind === "AI_AGENT");
      const identities = entities.filter(
        (e) => e.kind === "USER_ACCOUNT" || e.kind === "SERVICE_ACCOUNT" || e.kind === "ACCESS_ROLE"
      );
      part.nodes.push(...entities);
      if (!agent) continue;
      for (const identity of identities) {
        part.edges.push({
          id: edgeId(identity.id, "ALLOWS_ACCESS_TO", agent.id),
          src: identity.id,
          dst: agent.id,
          type: "ALLOWS_ACCESS_TO",
          accessType: "HIGH_PRIVILEGE"
        });
      }
    }
    return part;
  }
  function mergeParts(parts, syncedAt) {
    var _a4;
    const nodes = /* @__PURE__ */ new Map();
    const edges2 = /* @__PURE__ */ new Map();
    const issues2 = /* @__PURE__ */ new Map();
    const findings = /* @__PURE__ */ new Map();
    for (const part of parts) {
      for (const node2 of part.nodes) {
        const prev = nodes.get(node2.id);
        if (!prev) {
          nodes.set(node2.id, { ...node2 });
          continue;
        }
        const merged = { ...prev };
        for (const [k, v] of Object.entries(node2)) {
          if (v !== void 0 && v !== null && v !== false) {
            merged[k] = v;
          }
        }
        nodes.set(node2.id, merged);
      }
      for (const edge2 of part.edges) edges2.set(edge2.id, edge2);
      for (const issue2 of part.issues) issues2.set(issue2.id, issue2);
      for (const finding of (_a4 = part.findings) != null ? _a4 : []) findings.set(finding.id, finding);
    }
    return {
      doc: { nodes: [...nodes.values()], edges: [...edges2.values()], syncedAt },
      issues: [...issues2.values()],
      findings: [...findings.values()]
    };
  }

  // src/domain/aars.ts
  var SEVERITY_POINTS = {
    CRITICAL: 50,
    HIGH: 35,
    MEDIUM: 20,
    LOW: 8
  };
  var MULTI_ISSUE_MULTIPLIER = 1.2;
  var PILLAR_A_CAP = 50;
  var PILLAR_B_CAP = 30;
  var DATA_EXPOSURE_POINTS = {
    SENSITIVE: 20,
    DATA_ACCESS: 10,
    NONE: 0
  };
  var FIVE_RS_MULTIPLIER = 1.1;
  function defaultGapPoints(code) {
    const c = code.toUpperCase();
    if (c === "NO_GUARDRAIL") return 10;
    if (c === "DEPRECATED_MODEL") return 5;
    if (c === "LLM04" || c === "LLM05") return 5;
    if (c.startsWith("LLM")) return 10;
    if (c.startsWith("ASI")) return 10;
    if (c.startsWith("ML")) return 5;
    if (c === "FIVE_RS" || c.startsWith("5R")) return 5;
    return 5;
  }
  function gap(code, points) {
    return { code, points: points != null ? points : defaultGapPoints(code) };
  }
  function aarsBand(score) {
    if (score >= 70) return "CRITICAL";
    if (score >= 50) return "HIGH";
    if (score >= 30) return "MEDIUM";
    if (score >= 10) return "LOW";
    return "MINIMAL";
  }
  function worstSeverityPoints(severities) {
    var _a4;
    let worst = 0;
    for (const s of severities) {
      const p = (_a4 = SEVERITY_POINTS[s]) != null ? _a4 : 0;
      if (p > worst) worst = p;
    }
    return worst;
  }
  function computeAars(input) {
    let toxic = worstSeverityPoints(input.issueSeverities);
    if (input.issueSeverities.length > 1) toxic *= MULTI_ISSUE_MULTIPLIER;
    toxic = Math.min(PILLAR_A_CAP, Math.round(toxic));
    const compliance = Math.min(
      PILLAR_B_CAP,
      input.gaps.reduce((acc, g) => acc + g.points, 0)
    );
    const data = Math.round(DATA_EXPOSURE_POINTS[input.dataExposure] * FIVE_RS_MULTIPLIER);
    const score = Math.min(100, toxic + compliance + data);
    return { score, band: aarsBand(score), pillars: { toxic, compliance, data } };
  }

  // src/domain/graphEnrich.ts
  function severityRank3(s) {
    const i = SEVERITY_ORDER.indexOf(s != null ? s : "");
    return i === -1 ? SEVERITY_ORDER.length : i;
  }
  function worstSeverity(severities) {
    let worst;
    for (const s of severities) {
      if (worst === void 0 || severityRank3(s) < severityRank3(worst)) worst = s;
    }
    return worst;
  }
  function dataExposureOf(node2) {
    if (node2.hasAccessToSensitiveData || node2.hasSensitiveData) return "SENSITIVE";
    if (node2.hasHighPrivileges || node2.hasAdminPrivileges) return "DATA_ACCESS";
    return "NONE";
  }
  function deriveAarsInput(node2, nodeIssues) {
    var _a4, _b, _c, _d;
    const codes = /* @__PURE__ */ new Set();
    for (const issue2 of nodeIssues) {
      const fw = (_a4 = issue2.frameworks) != null ? _a4 : {};
      for (const c of (_b = fw.owaspLlm) != null ? _b : []) codes.add(c);
      for (const c of (_c = fw.owaspAgentic) != null ? _c : []) codes.add(c);
      for (const c of (_d = fw.owaspMl) != null ? _d : []) codes.add(`ML_${c.replace(/\s+/g, "_").toUpperCase()}`);
    }
    const gaps = [...codes].sort().map((c) => gap(c));
    if (node2.guardrailMissing) gaps.push(gap("NO_GUARDRAIL"));
    const dataExposure = dataExposureOf(node2);
    return {
      // AARS Pillar A scores Wiz-NATIVE severities (the applied table in
      // ai/custom_score.md: MEDIUM ×1.2 = 24); the adjusted severity is a display
      // lens, not a scoring input — using it would double-count the 5Rs amplifier.
      issueSeverities: nodeIssues.map((i) => i.nativeSeverity),
      gaps,
      dataExposure
    };
  }
  function buildAarsHintsFromFindings(findings, doc, issues2) {
    var _a4;
    const open = issues2.filter((i) => i.status === "OPEN");
    const issuesByAsset = /* @__PURE__ */ new Map();
    for (const issue2 of open) {
      if (!issuesByAsset.has(issue2.assetId)) issuesByAsset.set(issue2.assetId, []);
      issuesByAsset.get(issue2.assetId).push(issue2);
    }
    const codesByResource = /* @__PURE__ */ new Map();
    for (const f of findings) {
      if (!codesByResource.has(f.resourceId)) codesByResource.set(f.resourceId, []);
      codesByResource.get(f.resourceId).push(...f.frameworkCodes);
    }
    const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
    const hints = {};
    for (const [resourceId, codes] of codesByResource) {
      const node2 = nodeById.get(resourceId);
      if (!node2) continue;
      const base = deriveAarsInput(node2, (_a4 = issuesByAsset.get(resourceId)) != null ? _a4 : []);
      const seen = new Set(base.gaps.map((g) => g.code));
      const gaps = [...base.gaps];
      for (const c of codes) {
        if (c && !seen.has(c)) {
          seen.add(c);
          gaps.push(gap(c));
        }
      }
      hints[resourceId] = { gaps, dataExposure: base.dataExposure };
    }
    return hints;
  }
  function enrichGraphDoc(doc, issues2, hints) {
    const open = issues2.filter((i) => i.status === "OPEN");
    const byAsset = /* @__PURE__ */ new Map();
    for (const issue2 of open) {
      if (!byAsset.has(issue2.assetId)) byAsset.set(issue2.assetId, []);
      byAsset.get(issue2.assetId).push(issue2);
    }
    const nodes = doc.nodes.map((raw) => {
      var _a4;
      const node2 = { ...raw };
      const nodeIssues = (_a4 = byAsset.get(node2.id)) != null ? _a4 : [];
      if (nodeIssues.length) {
        node2.severity = worstSeverity(nodeIssues.map((i) => i.adjustedSeverity));
        const groups = [];
        for (const i of nodeIssues) {
          if (i.comboGroup && !groups.includes(i.comboGroup)) groups.push(i.comboGroup);
        }
        node2.comboGroups = groups;
      }
      const hint = hints == null ? void 0 : hints[node2.id];
      const scorable = node2.kind !== "ISSUE" && node2.kind !== "SUMMARY" && (AI_ASSET_KINDS.includes(node2.kind) || nodeIssues.length > 0 || hint !== void 0);
      if (scorable) {
        const input = hint ? { issueSeverities: nodeIssues.map((i) => i.nativeSeverity), ...hint } : deriveAarsInput(node2, nodeIssues);
        const result = computeAars(input);
        node2.aars = result.score;
        node2.aarsBand = result.band;
        node2.aarsPillars = result.pillars;
      }
      return node2;
    });
    const issueNodes = open.map((issue2) => ({
      id: issue2.id,
      kind: "ISSUE",
      name: issue2.ruleName,
      severity: issue2.adjustedSeverity,
      comboGroups: issue2.comboGroup ? [issue2.comboGroup] : [],
      status: issue2.status
    }));
    const issueEdges = open.map((issue2) => ({
      id: edgeId(issue2.assetId, "HAS_ISSUE", issue2.id),
      src: issue2.assetId,
      dst: issue2.id,
      type: "HAS_ISSUE"
    }));
    return {
      nodes: [...nodes, ...issueNodes],
      edges: [...doc.edges, ...issueEdges],
      syncedAt: doc.syncedAt
    };
  }
  function withSensitiveDataNodes(doc) {
    const existing = new Set(
      doc.nodes.filter((n) => n.kind === "SENSITIVE_DATA").map((n) => n.id)
    );
    const sensitiveNodes = [];
    const sensitiveEdges = [];
    for (const node2 of doc.nodes) {
      if (node2.kind === "SENSITIVE_DATA") continue;
      if (!node2.hasSensitiveData && !node2.hasAccessToSensitiveData) continue;
      const sensId = `sensitive|${node2.id}`;
      if (existing.has(sensId)) continue;
      const type = node2.hasSensitiveData ? "HAS_SENSITIVE_DATA" : "HAS_ACCESS_TO_SENSITIVE_DATA";
      sensitiveNodes.push({ id: sensId, kind: "SENSITIVE_DATA", name: "Sensitive data" });
      sensitiveEdges.push({ id: edgeId(node2.id, type, sensId), src: node2.id, dst: sensId, type });
    }
    if (!sensitiveNodes.length) return doc;
    return {
      nodes: [...doc.nodes, ...sensitiveNodes],
      edges: [...doc.edges, ...sensitiveEdges],
      syncedAt: doc.syncedAt
    };
  }
  function withInternetExposureNodes(doc) {
    const existing = new Set(
      doc.nodes.filter((n) => n.kind === "INTERNET_EXPOSURE").map((n) => n.id)
    );
    const exposureNodes = [];
    const exposureEdges = [];
    for (const node2 of doc.nodes) {
      if (node2.kind === "INTERNET_EXPOSURE") continue;
      if (node2.isAccessibleFromInternet !== true && node2.isOpenToAllInternet !== true) continue;
      const expId = `internet|${node2.id}`;
      if (existing.has(expId)) continue;
      exposureNodes.push({ id: expId, kind: "INTERNET_EXPOSURE", name: "Internet exposure" });
      exposureEdges.push({
        id: edgeId(node2.id, "EXPOSED_TO_INTERNET", expId),
        src: node2.id,
        dst: expId,
        type: "EXPOSED_TO_INTERNET"
      });
    }
    if (!exposureNodes.length) return doc;
    return {
      nodes: [...doc.nodes, ...exposureNodes],
      edges: [...doc.edges, ...exposureEdges],
      syncedAt: doc.syncedAt
    };
  }

  // src/server/sampleData.ts
  var T0 = "2026-04-02T08:00:00Z";
  var T1 = "2026-06-28T05:00:00Z";
  function node(seed) {
    var _a4, _b, _c, _d, _e, _f, _g;
    return {
      id: seed.id,
      kind: seed.kind,
      name: seed.name,
      nativeType: seed.nativeType,
      cloudPlatform: seed.cloud,
      region: seed.region,
      status: (_a4 = seed.status) != null ? _a4 : "Active",
      firstSeen: T0,
      lastSeen: T1,
      isAccessibleFromInternet: seed.internet === void 0 ? false : seed.internet,
      isOpenToAllInternet: seed.openInternet === void 0 ? false : seed.openInternet,
      hasSensitiveData: (_b = seed.sensitiveData) != null ? _b : false,
      hasAccessToSensitiveData: (_c = seed.sensitiveAccess) != null ? _c : false,
      hasHighPrivileges: (_d = seed.highPriv) != null ? _d : false,
      hasAdminPrivileges: (_e = seed.adminPriv) != null ? _e : false,
      guardrailMissing: (_f = seed.guardrailMissing) != null ? _f : false,
      cloudAccount: seed.account ? { id: seed.account.id, name: seed.account.name } : void 0,
      projects: ((_g = seed.projects) != null ? _g : []).map((name) => ({ id: `proj-${name.toLowerCase()}`, name })),
      technologyCategories: seed.techCats,
      identityPurpose: seed.identityPurpose,
      issueAnalytics: seed.issueAnalytics
    };
  }
  function edge(src, type, dst, accessType) {
    return { id: edgeId(src, type, dst), src, dst, type, accessType };
  }
  var GCP_MANAGED = "aiplatform#ReasoningEngine";
  var GCP_HOSTED = "hostedAiAgent";
  function gcpAgent(seed) {
    var _a4, _b, _c;
    return {
      ...seed,
      kind: "AI_AGENT",
      cloud: (_a4 = seed.cloud) != null ? _a4 : "GCP",
      nativeType: (_b = seed.nativeType) != null ? _b : GCP_MANAGED,
      techCats: (_c = seed.techCats) != null ? _c : ["AI Service"]
    };
  }
  var AGENTS = [
    gcpAgent({
      id: "agent-a",
      name: "Agent-A",
      region: "europe-west1",
      account: { id: "gcp-account-01", name: "gcp-account-01" },
      projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-b",
      name: "Agent-B",
      region: "us-west1",
      account: { id: "gcp-account-01", name: "gcp-account-01" },
      projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-autogen",
      name: "AGENT_AUTOGEN_DO_NOT_DELETE",
      region: "us-west1",
      account: { id: "gcp-account-01", name: "gcp-account-01" },
      projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
      sensitiveAccess: true,
      highPriv: true,
      adminPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-d-test",
      name: "dev-agent-D-test",
      region: "europe-west3",
      account: { id: "gcp-account-02", name: "gcp-account-02" },
      projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-d",
      name: "dev-agent-D",
      region: "europe-west3",
      account: { id: "gcp-account-02", name: "gcp-account-02" },
      projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-e",
      name: "Agent-E",
      region: "us-west1",
      account: { id: "gcp-account-03", name: "gcp-account-03" },
      projects: ["PROJECT-ALPHA", "PROJECT-GAMMA"],
      internet: true,
      openInternet: true,
      // demonstrates the internet-exposure topology node
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-f",
      name: "agent-F",
      region: "europe-west4",
      projects: ["PROJECT-ALPHA"],
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-f-preprod",
      name: "agent-F-preprod",
      region: "europe-west4",
      projects: ["PROJECT-ALPHA"],
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-g",
      name: "Agent-G",
      region: "europe-west4",
      projects: ["PROJECT-ALPHA", "PROJECT-ETA"],
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-h-chatbot",
      name: "agent-H-chatbot",
      region: "europe-west1",
      nativeType: GCP_HOSTED,
      account: { id: "gcp-account-05", name: "gcp-account-05" },
      projects: ["PROJECT-ALPHA", "PROJECT-DELTA", "PROJECT-EPSILON"],
      internet: null,
      openInternet: null,
      // hosted: exposure inherited from the Cloud Run service
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-i",
      name: "agent-I",
      region: "europe-west4",
      nativeType: GCP_HOSTED,
      status: "Inactive",
      account: { id: "gcp-account-04", name: "gcp-account-04" },
      projects: ["PROJECT-ALPHA", "PROJECT-ZETA"],
      internet: null,
      openInternet: null,
      // hosted: exposure inherited from the VM
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true
    }),
    gcpAgent({
      id: "agent-j",
      name: "agent-J",
      region: "europe-west1",
      account: { id: "gcp-account-07", name: "gcp-account-07" },
      projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
      sensitiveAccess: false,
      highPriv: true,
      guardrailMissing: false
    }),
    gcpAgent({
      id: "agent-k",
      name: "agent-K",
      region: "europe-west1",
      account: { id: "gcp-account-07", name: "gcp-account-07" },
      projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
      sensitiveAccess: false,
      highPriv: true,
      guardrailMissing: false
    }),
    // A guardrail-protected agent with no issues — the healthy contrast case.
    gcpAgent({
      id: "agent-l-support",
      name: "Agent-L-support",
      region: "europe-west1",
      account: { id: "gcp-account-03", name: "gcp-account-03" },
      projects: ["PROJECT-ALPHA"]
    })
  ];
  var AWS_ROLE_COUNT = 8;
  var awsRoles = [];
  for (let i = 1; i <= AWS_ROLE_COUNT; i++) {
    const n = String(i).padStart(2, "0");
    awsRoles.push({
      id: `role-finance-admin-${n}`,
      kind: "ACCESS_ROLE",
      name: `AWSReservedSSO_FinanceAdmin_${n}`,
      nativeType: "role",
      cloud: "AWS",
      account: { id: "aws-account-prod-01", name: "aws-account-prod-01" },
      projects: ["PROJECT-ALPHA"],
      highPriv: true,
      sensitiveAccess: true
    });
  }
  var SUPPORT = [
    // Guardrails (3 in the tenant; only Agent-L is actually protected)
    { id: "guardrail-alpha", kind: "AI_GUARDRAIL", name: "guardrail-alpha", cloud: "GCP", region: "europe-west1", projects: ["PROJECT-ALPHA"] },
    { id: "guardrail-beta", kind: "AI_GUARDRAIL", name: "guardrail-beta", cloud: "GCP", region: "europe-west4", projects: ["PROJECT-ALPHA"] },
    { id: "guardrail-bedrock", kind: "AI_GUARDRAIL", name: "bedrock-guardrail-default", cloud: "AWS", projects: ["PROJECT-ALPHA"] },
    // Models
    { id: "model-bedrock-claude", kind: "AI_MODEL", name: "anthropic.claude-3-5-sonnet", nativeType: "bedrock#foundationModel", cloud: "AWS", account: { id: "aws-account-prod-01", name: "aws-account-prod-01" }, projects: ["PROJECT-ALPHA"] },
    { id: "model-text-embedding-005", kind: "AI_MODEL", name: "text-embedding-005", nativeType: "aiplatform#model", cloud: "GCP", region: "us-west1", status: "Deprecated", projects: ["PROJECT-ALPHA"] },
    // MCP server + pipeline + dataset
    { id: "mcp-internal-tools", kind: "MCP_SERVER", name: "mcp-internal-tools", cloud: "GCP", region: "europe-west1", projects: ["PROJECT-ALPHA"] },
    { id: "pipeline-training-01", kind: "AI_PIPELINE", name: "pipeline-training-01", cloud: "GCP", region: "us-west1", projects: ["PROJECT-ALPHA"] },
    { id: "dataset-support-transcripts", kind: "AI_DATASET", name: "dataset-support-transcripts", cloud: "GCP", region: "europe-west1", sensitiveData: true, projects: ["PROJECT-ALPHA"] },
    // Data resources
    { id: "bucket-customer-pii", kind: "BUCKET", name: "bucket-customer-pii", cloud: "GCP", region: "europe-west1", sensitiveData: true, projects: ["PROJECT-ALPHA"] },
    { id: "bucket-finance-reports", kind: "BUCKET", name: "bucket-finance-reports", cloud: "GCP", region: "europe-west1", sensitiveData: true, projects: ["PROJECT-BETA"] },
    { id: "bucket-partner-data", kind: "BUCKET", name: "bucket-partner-data", cloud: "GCP", region: "europe-west4", sensitiveData: true, projects: ["PROJECT-ETA"] },
    { id: "bucket-pricing-models", kind: "BUCKET", name: "bucket-pricing-models", cloud: "GCP", region: "europe-west4", sensitiveData: true, projects: ["PROJECT-ALPHA"] },
    { id: "bucket-training-data", kind: "BUCKET", name: "bucket-training-data", cloud: "GCP", region: "us-west1", projects: ["PROJECT-ALPHA"] },
    { id: "db-customer-core", kind: "DATABASE", name: "db-customer-core", cloud: "GCP", region: "europe-west1", sensitiveData: true, projects: ["PROJECT-ALPHA"] },
    { id: "db-analytics", kind: "DATABASE", name: "db-analytics", cloud: "GCP", region: "europe-west1", projects: ["PROJECT-DELTA"] },
    // Compute / supply chain for the hosted agents
    { id: "vm-agent-i-host", kind: "VIRTUAL_MACHINE", name: "vm-agent-i-host", cloud: "GCP", region: "europe-west4", internet: false, projects: ["PROJECT-ZETA"] },
    { id: "run-agent-h", kind: "SERVERLESS", name: "cloudrun-agent-h", cloud: "GCP", region: "europe-west1", internet: true, projects: ["PROJECT-DELTA"] },
    { id: "img-agent-h", kind: "CONTAINER_IMAGE", name: "img-agent-h:latest", cloud: "GCP", projects: ["PROJECT-DELTA"] },
    { id: "repo-agent-h", kind: "REPOSITORY", name: "repo-agent-h", projects: ["PROJECT-DELTA"] },
    // CIEM findings
    { id: "finding-ea-autogen", kind: "EXCESSIVE_ACCESS_FINDING", name: "Excessive access: sa-agent-autogen", cloud: "GCP" },
    { id: "finding-ea-agent-h", kind: "EXCESSIVE_ACCESS_FINDING", name: "Excessive access: sa-agent-h", cloud: "GCP" },
    { id: "finding-lm-agent-i", kind: "LATERAL_MOVEMENT_FINDING", name: "Lateral movement: sa-agent-i", cloud: "GCP" }
  ];
  var edges = [];
  var extraNodes = [];
  var GCP_AGENT_IDS = [
    "agent-a",
    "agent-b",
    "agent-autogen",
    "agent-d-test",
    "agent-d",
    "agent-e",
    "agent-f",
    "agent-f-preprod",
    "agent-g",
    "agent-h-chatbot",
    "agent-i",
    "agent-j",
    "agent-k",
    "agent-l-support"
  ];
  for (const agentId of GCP_AGENT_IDS) {
    const saId = `sa-${agentId}`;
    const highPriv = agentId !== "agent-l-support";
    extraNodes.push({
      id: saId,
      kind: "SERVICE_ACCOUNT",
      name: `${saId}@iam.gserviceaccount.com`,
      cloud: "GCP",
      highPriv,
      sensitiveAccess: !["agent-j", "agent-k", "agent-l-support"].includes(agentId),
      // These execution identities are agentic (identityPurpose:AGENTIC in Wiz); a small
      // related-issue rollup drives the inventory "Agentic identities" KPI + the badge.
      identityPurpose: "AGENTIC",
      techCats: ["Identity"],
      issueAnalytics: highPriv ? { total: 1, info: 0, low: 0, medium: 1, high: 0, critical: 0 } : { total: 0, info: 0, low: 0, medium: 0, high: 0, critical: 0 }
    });
    edges.push(edge(agentId, "RUNS_AS", saId));
  }
  extraNodes.push({
    id: "key-agent-autogen",
    kind: "ACCESS_KEY",
    name: "AKIA-AUTOGEN-AGENT-KEY",
    cloud: "AWS",
    identityPurpose: "AGENTIC",
    sensitiveAccess: true,
    issueAnalytics: { total: 2, info: 0, low: 1, medium: 1, high: 0, critical: 0 }
  });
  edges.push(edge("agent-autogen", "RUNS_AS", "key-agent-autogen"));
  var SA_ACCESS = [
    ["sa-agent-a", "bucket-customer-pii", "HIGH_PRIVILEGE"],
    ["sa-agent-a", "db-customer-core", "READ"],
    ["sa-agent-b", "bucket-customer-pii", "HIGH_PRIVILEGE"],
    ["sa-agent-autogen", "bucket-finance-reports", "ADMIN"],
    ["sa-agent-autogen", "db-customer-core", "HIGH_PRIVILEGE"],
    ["sa-agent-d-test", "bucket-training-data", "WRITE"],
    ["sa-agent-d-test", "db-customer-core", "READ"],
    ["sa-agent-d", "bucket-training-data", "WRITE"],
    ["sa-agent-d", "db-customer-core", "READ"],
    ["sa-agent-e", "bucket-customer-pii", "HIGH_PRIVILEGE"],
    ["sa-agent-f", "bucket-pricing-models", "HIGH_PRIVILEGE"],
    ["sa-agent-f-preprod", "bucket-pricing-models", "HIGH_PRIVILEGE"],
    ["sa-agent-g", "bucket-partner-data", "HIGH_PRIVILEGE"],
    ["sa-agent-h-chatbot", "db-customer-core", "HIGH_PRIVILEGE"],
    ["sa-agent-h-chatbot", "db-analytics", "READ"],
    ["sa-agent-i", "bucket-customer-pii", "HIGH_PRIVILEGE"],
    ["sa-agent-j", "db-analytics", "READ"],
    ["sa-agent-k", "db-analytics", "READ"]
  ];
  for (const [sa, target, accessType] of SA_ACCESS) {
    edges.push(edge(sa, "ALLOWS_ACCESS_TO", target, accessType));
  }
  edges.push(edge("sa-agent-autogen", "HAS_FINDING", "finding-ea-autogen"));
  edges.push(edge("sa-agent-h-chatbot", "HAS_FINDING", "finding-ea-agent-h"));
  edges.push(edge("sa-agent-i", "HAS_FINDING", "finding-lm-agent-i"));
  for (const role of awsRoles) {
    role.guardrailMissing = true;
    edges.push(edge(role.id, "CAN_INVOKE", "model-bedrock-claude"));
  }
  edges.push(edge("agent-l-support", "PROTECTED_BY", "guardrail-alpha"));
  edges.push(edge("model-bedrock-claude", "ENFORCES", "guardrail-bedrock"));
  edges.push(edge("agent-i", "HOSTED_ON", "vm-agent-i-host"));
  edges.push(edge("agent-h-chatbot", "HOSTED_ON", "run-agent-h"));
  edges.push(edge("agent-h-chatbot", "BUILT_FROM", "img-agent-h"));
  edges.push(edge("img-agent-h", "BUILT_FROM", "repo-agent-h"));
  edges.push(edge("agent-a", "USES_MODEL", "model-text-embedding-005"));
  edges.push(edge("agent-b", "USES_MODEL", "model-text-embedding-005"));
  edges.push(edge("agent-h-chatbot", "INVOKES_TOOL", "mcp-internal-tools"));
  edges.push(edge("agent-l-support", "INVOKES_TOOL", "mcp-internal-tools"));
  edges.push(edge("pipeline-training-01", "USES_DATASET", "dataset-support-transcripts"));
  edges.push(edge("dataset-support-transcripts", "STORED_IN", "bucket-customer-pii"));
  edges.push(edge("agent-e", "USES_DATASET", "dataset-support-transcripts"));
  for (let i = 1; i <= 14; i++) {
    const n = String(i).padStart(2, "0");
    const id = `bucket-autogen-scratch-${n}`;
    extraNodes.push({ id, kind: "BUCKET", name: `bucket-autogen-scratch-${n}`, cloud: "GCP", region: "us-west1", projects: ["PROJECT-BETA"] });
    edges.push(edge("sa-agent-autogen", "ALLOWS_ACCESS_TO", id, "WRITE"));
  }
  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(2, "0");
    const id = `user-ops-${n}`;
    extraNodes.push({ id, kind: "USER_ACCOUNT", name: `ops.user${n}@example.com`, cloud: "GCP" });
    edges.push(edge(id, "ALLOWS_ACCESS_TO", "agent-h-chatbot", i <= 2 ? "ADMIN" : "READ"));
  }
  function issue(seed) {
    const group = classifyIssue({ sourceRuleId: seed.ruleId, ruleName: seed.ruleName });
    return {
      id: seed.id,
      ruleId: seed.ruleId,
      ruleName: seed.ruleName,
      comboGroup: group ? group.id : "",
      nativeSeverity: seed.nativeSeverity,
      adjustedSeverity: group ? group.adjustedSeverity : seed.nativeSeverity,
      status: "OPEN",
      assetId: seed.assetId,
      assetName: seed.assetName,
      region: seed.region,
      account: seed.account,
      projects: seed.projects,
      frameworks: seed.frameworks,
      justification: seed.justification,
      createdAt: seed.createdAt,
      dueAt: seed.dueAt,
      resolutionRecommendation: seed.resolutionRecommendation
    };
  }
  var RULE_G1 = "Allow model invoke without Guardrail for user or role";
  var RULE_G2 = "Managed AI Agent with high privileges or sensitive data access";
  var RULE_G3 = "AI Agent hosted on VM/serverless with high privileges or sensitive data access";
  var RULE_G4 = "AI resource using overly permissive execution identity";
  var issues = [];
  var issueSeq = 0;
  function nextIssueId() {
    issueSeq += 1;
    return `iss-${String(issueSeq).padStart(3, "0")}`;
  }
  for (const role of awsRoles) {
    issues.push(issue({
      id: nextIssueId(),
      ruleId: "wc-id-2742",
      ruleName: RULE_G1,
      assetId: role.id,
      assetName: role.name,
      nativeSeverity: "MEDIUM",
      account: "aws-account-prod-01",
      projects: ["PROJECT-ALPHA"],
      justification: "No content filtering, data protection, or compliance enforcement on AI model calls.",
      frameworks: { owaspLlm: ["LLM06", "LLM02"], owaspAgentic: ["ASI02", "ASI03"], fiveRs: ["Restrict"] },
      createdAt: "2026-05-14T09:12:00Z"
    }));
  }
  var G2 = [
    { assetId: "agent-a", count: 1, llm: ["LLM06", "LLM01"], asi: ["ASI03", "ASI01"], ml: ["Data Poisoning"], fiveRs: ["Restrict"], why: "Prompt injection reaches PII and credentials; 5Rs gap confirms data is not restricted." },
    { assetId: "agent-b", count: 1, llm: ["LLM06", "LLM01"], asi: ["ASI03", "ASI01"], ml: ["Data Poisoning"], fiveRs: ["Restrict"], why: "Over-privileged IAM on a customer-facing managed agent." },
    { assetId: "agent-autogen", count: 4, llm: ["LLM06", "LLM07"], asi: ["ASI10"], ml: ["Supply Chain"], fiveRs: ["Reduce", "Restrict"], why: "Auto-generated agent \u2014 likely forgotten, still over-privileged." },
    { assetId: "agent-d-test", count: 1, llm: ["LLM06", "LLM04"], asi: ["ASI03", "ASI06"], ml: ["Data Poisoning"], fiveRs: ["Reconfigure"], why: "Dev/test agent with prod-level IAM \u2014 violates least privilege." },
    { assetId: "agent-d", count: 1, llm: ["LLM06", "LLM04"], asi: ["ASI03", "ASI06"], ml: ["Data Poisoning"], fiveRs: ["Reconfigure"], why: "Dev agent with excessive IAM \u2014 training-data exposure risk." },
    { assetId: "agent-e", count: 1, llm: ["LLM06", "LLM02"], asi: ["ASI03", "ASI01"], ml: ["Input Manipulation"], fiveRs: ["Restrict"], why: "Innovation agent with sensitive data access and no guardrail." },
    { assetId: "agent-f", count: 1, llm: ["LLM06", "LLM02"], asi: ["ASI03", "ASI02"], ml: ["Model Theft"], fiveRs: ["Restrict"], why: "Pricing agent with financial data access \u2014 high business impact." },
    { assetId: "agent-f-preprod", count: 1, llm: ["LLM06", "LLM02"], asi: ["ASI03", "ASI02"], ml: ["Model Theft"], fiveRs: ["Reconfigure"], why: "Pre-prod pricing agent \u2014 same risk as prod." },
    { assetId: "agent-g", count: 2, llm: ["LLM06", "LLM02"], asi: ["ASI03", "ASI01"], ml: ["Data Poisoning"], fiveRs: ["Restrict"], why: "Business-partner data agent \u2014 PII and partner-data exposure risk." }
  ];
  var _a;
  for (const g of G2) {
    const asset = AGENTS.find((a) => a.id === g.assetId);
    for (let i = 0; i < g.count; i++) {
      issues.push(issue({
        id: nextIssueId(),
        ruleId: "wc-id-3217",
        ruleName: RULE_G2,
        assetId: asset.id,
        assetName: asset.name,
        nativeSeverity: "MEDIUM",
        region: asset.region,
        account: (_a = asset.account) == null ? void 0 : _a.name,
        projects: asset.projects,
        justification: g.why,
        frameworks: { owaspLlm: g.llm, owaspAgentic: g.asi, owaspMl: g.ml, fiveRs: g.fiveRs },
        createdAt: "2026-05-20T11:40:00Z",
        dueAt: "2026-08-18T11:40:00Z",
        resolutionRecommendation: "Apply least-privilege to the agent's execution service account; remove IAM bindings that grant access to sensitive data, and attach a guardrail that limits the agent's data-access scope at runtime."
      }));
    }
  }
  var G3 = [
    { assetId: "agent-i", count: 4, llm: ["LLM06", "LLM01"], asi: ["ASI03", "ASI05"], fiveRs: ["Restrict", "Reduce"], why: "Inactive agents still holding sensitive data access \u2014 lateral-movement risk via compromised compute." },
    { assetId: "agent-h-chatbot", count: 2, llm: ["LLM06", "LLM02", "LLM05"], asi: ["ASI02", "ASI03"], fiveRs: ["Restrict"], why: "Chatbot agent on serverless with excessive IAM \u2014 user-facing attack surface." }
  ];
  var _a2;
  for (const g of G3) {
    const asset = AGENTS.find((a) => a.id === g.assetId);
    for (let i = 0; i < g.count; i++) {
      issues.push(issue({
        id: nextIssueId(),
        ruleId: "wc-id-3230",
        ruleName: RULE_G3,
        assetId: asset.id,
        assetName: asset.name,
        nativeSeverity: "MEDIUM",
        region: asset.region,
        account: (_a2 = asset.account) == null ? void 0 : _a2.name,
        projects: asset.projects,
        justification: g.why,
        frameworks: { owaspLlm: g.llm, owaspAgentic: g.asi, fiveRs: g.fiveRs },
        createdAt: "2026-06-03T07:25:00Z"
      }));
    }
  }
  var _a3;
  for (const assetId of ["agent-j", "agent-k"]) {
    const asset = AGENTS.find((a) => a.id === assetId);
    issues.push(issue({
      id: nextIssueId(),
      ruleId: "wc-id-3123",
      ruleName: RULE_G4,
      assetId: asset.id,
      assetName: asset.name,
      nativeSeverity: "LOW",
      region: asset.region,
      account: (_a3 = asset.account) == null ? void 0 : _a3.name,
      projects: asset.projects,
      justification: "Latent privileges \u2014 a compromised agent inherits every permission of its execution identity.",
      frameworks: { owaspAgentic: ["ASI03"], fiveRs: ["Reconfigure"] },
      createdAt: "2026-06-10T15:02:00Z"
    }));
  }
  var HINTS = {
    "agent-a": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-b": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-autogen": { gaps: [gap("LLM06"), gap("ASI10"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-d-test": { gaps: [gap("LLM04"), gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-d": { gaps: [gap("LLM04"), gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-e": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-f": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-f-preprod": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-g": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-h-chatbot": { gaps: [gap("LLM06"), gap("LLM05"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-i": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
    "agent-j": { gaps: [gap("ASI03")], dataExposure: "DATA_ACCESS" },
    "agent-k": { gaps: [gap("ASI03")], dataExposure: "DATA_ACCESS" },
    // Deprecated-model usage shows up on the model itself, not the agents.
    "model-text-embedding-005": { gaps: [gap("DEPRECATED_MODEL")], dataExposure: "NONE" }
  };
  for (const role of awsRoles) {
    HINTS[role.id] = {
      gaps: [gap("LLM01"), gap("LLM02"), gap("ASI02")],
      dataExposure: "DATA_ACCESS"
    };
  }
  var SEED_FINDINGS_DATA = [
    {
      id: "cfg-001",
      resourceId: "agent-a",
      ruleShortId: "SUB-082",
      severity: "MEDIUM",
      remediation: "Encrypt the Vertex AI metadata store with a customer-managed key and restrict the agent service account's access to it.",
      frameworkCodes: ["SUB-082", "LLM06"]
    },
    {
      id: "cfg-002",
      resourceId: "agent-h-chatbot",
      ruleShortId: "SUB-114",
      severity: "HIGH",
      remediation: "Disable public ingress on the Cloud Run service hosting the agent, or place it behind an authenticated load balancer.",
      frameworkCodes: ["SUB-114"]
    },
    {
      id: "cfg-003",
      resourceId: "agent-e",
      ruleShortId: "SUB-047",
      severity: "MEDIUM",
      remediation: "Enable audit logging for all data access performed by the agent identity.",
      frameworkCodes: ["SUB-047"]
    }
  ];
  var SEED_NODES = [...AGENTS, ...awsRoles, ...SUPPORT, ...extraNodes].map(node);
  var SEED_EDGES = edges;
  var SEED_ISSUES = issues;
  var SEED_FINDINGS = SEED_FINDINGS_DATA;
  var SEED_AARS_HINTS = HINTS;
  function seedGraphDoc(syncedAt) {
    return { nodes: SEED_NODES, edges: SEED_EDGES, syncedAt };
  }

  // src/server/syncStore.ts
  function boolCell(v) {
    return v ? "true" : "false";
  }
  function triCell(v) {
    return v === null || v === void 0 ? "null" : v ? "true" : "false";
  }
  function parseBool(v) {
    return String(v) === "true";
  }
  function parseTri(v) {
    const s = String(v);
    return s === "true" ? true : s === "false" ? false : null;
  }
  function parseJson(v, fallback) {
    if (typeof v !== "string" || v === "") return fallback;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  }
  function assetToRow(n) {
    var _a4, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q;
    return {
      id: n.id,
      kind: n.kind,
      name: n.name,
      native_type: (_a4 = n.nativeType) != null ? _a4 : null,
      cloud: (_b = n.cloudPlatform) != null ? _b : null,
      region: (_c = n.region) != null ? _c : null,
      status: (_d = n.status) != null ? _d : null,
      account_id: (_f = (_e = n.cloudAccount) == null ? void 0 : _e.id) != null ? _f : null,
      account_name: (_h = (_g = n.cloudAccount) == null ? void 0 : _g.name) != null ? _h : null,
      projects_json: JSON.stringify(((_i = n.projects) != null ? _i : []).map((p) => p.name)),
      first_seen: (_j = n.firstSeen) != null ? _j : null,
      last_seen: (_k = n.lastSeen) != null ? _k : null,
      internet: triCell(n.isAccessibleFromInternet),
      open_internet: triCell(n.isOpenToAllInternet),
      sensitive_data: boolCell(n.hasSensitiveData),
      sensitive_access: boolCell(n.hasAccessToSensitiveData),
      high_priv: boolCell(n.hasHighPrivileges),
      admin_priv: boolCell(n.hasAdminPrivileges),
      guardrail_missing: boolCell(n.guardrailMissing),
      technology_categories: ((_l = n.technologyCategories) != null ? _l : []).join(","),
      severity: (_m = n.severity) != null ? _m : null,
      aars: (_n = n.aars) != null ? _n : null,
      aars_band: (_o = n.aarsBand) != null ? _o : null,
      aars_pillars_json: n.aarsPillars ? JSON.stringify(n.aarsPillars) : null,
      combo_groups: ((_p = n.comboGroups) != null ? _p : []).join(","),
      tags_json: n.tags ? JSON.stringify(n.tags) : null,
      identity_purpose: (_q = n.identityPurpose) != null ? _q : null,
      issue_analytics_json: n.issueAnalytics ? JSON.stringify(n.issueAnalytics) : null
    };
  }
  function rowToAsset(r) {
    var _a4, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p;
    const node2 = {
      id: String((_a4 = r["id"]) != null ? _a4 : ""),
      kind: String((_b = r["kind"]) != null ? _b : "AI_AGENT"),
      name: String((_c = r["name"]) != null ? _c : ""),
      nativeType: (_d = r["native_type"]) != null ? _d : void 0,
      cloudPlatform: (_e = r["cloud"]) != null ? _e : void 0,
      region: (_f = r["region"]) != null ? _f : void 0,
      status: (_g = r["status"]) != null ? _g : void 0,
      firstSeen: (_h = r["first_seen"]) != null ? _h : void 0,
      lastSeen: (_i = r["last_seen"]) != null ? _i : void 0,
      isAccessibleFromInternet: parseTri(r["internet"]),
      isOpenToAllInternet: parseTri(r["open_internet"]),
      hasSensitiveData: parseBool(r["sensitive_data"]),
      hasAccessToSensitiveData: parseBool(r["sensitive_access"]),
      hasHighPrivileges: parseBool(r["high_priv"]),
      hasAdminPrivileges: parseBool(r["admin_priv"]),
      guardrailMissing: parseBool(r["guardrail_missing"]),
      projects: parseJson(r["projects_json"], []).map((name) => ({
        id: `proj-${String(name).toLowerCase()}`,
        name: String(name)
      }))
    };
    const account = (_j = r["account_id"]) != null ? _j : null;
    if (account) {
      node2.cloudAccount = { id: account, name: String((_k = r["account_name"]) != null ? _k : account) };
    }
    const severity = (_l = r["severity"]) != null ? _l : null;
    if (severity) node2.severity = severity;
    if (r["aars"] !== null && r["aars"] !== void 0) node2.aars = Number(r["aars"]);
    const band = (_m = r["aars_band"]) != null ? _m : null;
    if (band) node2.aarsBand = band;
    const pillars = parseJson(r["aars_pillars_json"], null);
    if (pillars) node2.aarsPillars = pillars;
    const combos = String((_n = r["combo_groups"]) != null ? _n : "");
    if (combos) node2.comboGroups = combos.split(",").filter(Boolean);
    const tags = parseJson(r["tags_json"], null);
    if (tags) node2.tags = tags;
    const techCats = String((_o = r["technology_categories"]) != null ? _o : "").split(",").filter(Boolean);
    if (techCats.length) node2.technologyCategories = techCats;
    const purpose = (_p = r["identity_purpose"]) != null ? _p : null;
    if (purpose) node2.identityPurpose = purpose;
    const analytics = parseJson(r["issue_analytics_json"], null);
    if (analytics) node2.issueAnalytics = analytics;
    return node2;
  }
  function edgeToRow(e) {
    var _a4;
    return {
      id: e.id,
      src: e.src,
      dst: e.dst,
      type: e.type,
      negated: boolCell(e.negated),
      access_type: (_a4 = e.accessType) != null ? _a4 : null
    };
  }
  function rowToEdge(r) {
    var _a4, _b, _c, _d, _e;
    const e = {
      id: String((_a4 = r["id"]) != null ? _a4 : ""),
      src: String((_b = r["src"]) != null ? _b : ""),
      dst: String((_c = r["dst"]) != null ? _c : ""),
      type: String((_d = r["type"]) != null ? _d : "USES")
    };
    if (parseBool(r["negated"])) e.negated = true;
    const access = (_e = r["access_type"]) != null ? _e : null;
    if (access) e.accessType = access;
    return e;
  }
  function issueToRow(i) {
    var _a4, _b, _c, _d, _e, _f, _g, _h, _i;
    return {
      id: i.id,
      rule_id: i.ruleId,
      rule_name: i.ruleName,
      combo_group: i.comboGroup,
      native_severity: i.nativeSeverity,
      adjusted_severity: i.adjustedSeverity,
      status: i.status,
      asset_id: i.assetId,
      asset_name: i.assetName,
      region: (_a4 = i.region) != null ? _a4 : null,
      account: (_b = i.account) != null ? _b : null,
      projects_json: JSON.stringify((_c = i.projects) != null ? _c : []),
      frameworks_json: JSON.stringify((_d = i.frameworks) != null ? _d : {}),
      justification: (_e = i.justification) != null ? _e : null,
      created_at: (_f = i.createdAt) != null ? _f : null,
      due_at: (_g = i.dueAt) != null ? _g : null,
      resolution_recommendation: (_h = i.resolutionRecommendation) != null ? _h : null,
      remediation: (_i = i.remediation) != null ? _i : null
    };
  }
  function rowToIssue(r) {
    var _a4, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p;
    return {
      id: String((_a4 = r["id"]) != null ? _a4 : ""),
      ruleId: String((_b = r["rule_id"]) != null ? _b : ""),
      ruleName: String((_c = r["rule_name"]) != null ? _c : ""),
      comboGroup: String((_d = r["combo_group"]) != null ? _d : ""),
      nativeSeverity: String((_e = r["native_severity"]) != null ? _e : "UNKNOWN"),
      adjustedSeverity: String((_f = r["adjusted_severity"]) != null ? _f : "UNKNOWN"),
      status: String((_g = r["status"]) != null ? _g : "OPEN"),
      assetId: String((_h = r["asset_id"]) != null ? _h : ""),
      assetName: String((_i = r["asset_name"]) != null ? _i : ""),
      region: (_j = r["region"]) != null ? _j : void 0,
      account: (_k = r["account"]) != null ? _k : void 0,
      projects: parseJson(r["projects_json"], []),
      frameworks: parseJson(r["frameworks_json"], {}),
      justification: (_l = r["justification"]) != null ? _l : void 0,
      createdAt: (_m = r["created_at"]) != null ? _m : void 0,
      dueAt: (_n = r["due_at"]) != null ? _n : void 0,
      resolutionRecommendation: (_o = r["resolution_recommendation"]) != null ? _o : void 0,
      remediation: (_p = r["remediation"]) != null ? _p : void 0
    };
  }
  function findingToRow(f) {
    var _a4, _b;
    return {
      id: f.id,
      resource_id: f.resourceId,
      rule_short_id: f.ruleShortId,
      severity: f.severity,
      remediation: (_a4 = f.remediation) != null ? _a4 : null,
      framework_codes: ((_b = f.frameworkCodes) != null ? _b : []).join(",")
    };
  }
  function rowToFinding(r) {
    var _a4, _b, _c, _d, _e, _f;
    return {
      id: String((_a4 = r["id"]) != null ? _a4 : ""),
      resourceId: String((_b = r["resource_id"]) != null ? _b : ""),
      ruleShortId: String((_c = r["rule_short_id"]) != null ? _c : ""),
      severity: String((_d = r["severity"]) != null ? _d : "UNKNOWN"),
      remediation: (_e = r["remediation"]) != null ? _e : void 0,
      frameworkCodes: String((_f = r["framework_codes"]) != null ? _f : "").split(",").filter(Boolean)
    };
  }
  function persistSync(rawDoc, issues2, hints, meta, now, findings = []) {
    const enriched = enrichGraphDoc(rawDoc, issues2, hints);
    const assetNodes = enriched.nodes.filter((n) => n.kind !== "ISSUE" && n.kind !== "SUMMARY");
    const assetEdges = enriched.edges.filter((e) => e.type !== "HAS_ISSUE");
    overwrite(TABS.assets, assetNodes.map(assetToRow));
    overwrite(TABS.edges, assetEdges.map(edgeToRow));
    overwrite(TABS.issues, issues2.map(issueToRow));
    overwrite(TABS.findings, findings.map(findingToRow));
    const snapshotRef = writeGraphSnapshot(enriched);
    appendRows(TABS.syncHistory, [{
      sync_id: meta.syncId,
      started_at: meta.startedAt,
      finished_at: nowIso(now),
      status: "SUCCESS",
      mode: meta.mode,
      node_count: enriched.nodes.length,
      edge_count: enriched.edges.length,
      issue_count: issues2.length,
      api_calls: meta.apiCalls,
      snapshot_ref: snapshotRef,
      error: null
    }]);
    bumpDataVersion();
    invalidateReadMemos();
    return enriched;
  }
  var graphDocMemo;
  var assetsMemo;
  var issuesMemo;
  var findingsMemo;
  function invalidateReadMemos() {
    graphDocMemo = void 0;
    assetsMemo = void 0;
    issuesMemo = void 0;
    findingsMemo = void 0;
  }
  function loadGraphDoc() {
    if (graphDocMemo !== void 0) return graphDocMemo;
    graphDocMemo = loadGraphDocUncached();
    return graphDocMemo;
  }
  function loadGraphDocUncached() {
    var _a4;
    const snap = readGraphSnapshot();
    if (snap) return withInternetExposureNodes(withSensitiveDataNodes(snap));
    const assetRows = readAll(TABS.assets);
    if (!assetRows.length) return null;
    const nodes = assetRows.map(rowToAsset);
    const edges2 = readAll(TABS.edges).map(rowToEdge);
    const issues2 = loadIssues().filter((i) => i.status === "OPEN");
    for (const issue2 of issues2) {
      nodes.push({
        id: issue2.id,
        kind: "ISSUE",
        name: issue2.ruleName,
        severity: issue2.adjustedSeverity,
        comboGroups: issue2.comboGroup ? [issue2.comboGroup] : [],
        status: issue2.status
      });
      edges2.push({
        id: edgeId(issue2.assetId, "HAS_ISSUE", issue2.id),
        src: issue2.assetId,
        dst: issue2.id,
        type: "HAS_ISSUE"
      });
    }
    const latest = latestSync();
    return withInternetExposureNodes(
      withSensitiveDataNodes({
        nodes,
        edges: edges2,
        syncedAt: latest ? String((_a4 = latest["finished_at"]) != null ? _a4 : "") : ""
      })
    );
  }
  function loadAssets() {
    if (assetsMemo === void 0) assetsMemo = readAll(TABS.assets).map(rowToAsset);
    return assetsMemo;
  }
  function loadIssues() {
    if (issuesMemo === void 0) issuesMemo = readAll(TABS.issues).map(rowToIssue);
    return issuesMemo;
  }
  function loadFindings() {
    if (findingsMemo === void 0) findingsMemo = readAll(TABS.findings).map(rowToFinding);
    return findingsMemo;
  }
  function syncHistory() {
    return readAll(TABS.syncHistory);
  }
  function latestSync() {
    const rows = syncHistory();
    return rows.length ? rows[rows.length - 1] : null;
  }
  function resetData() {
    overwrite(TABS.assets, []);
    overwrite(TABS.edges, []);
    overwrite(TABS.issues, []);
    overwrite(TABS.findings, []);
    overwrite(TABS.syncHistory, []);
    trashGraphSnapshot();
    bumpDataVersion();
    invalidateReadMemos();
  }

  // src/server/syncJobs.ts
  var CANCEL_PROP = "CANCEL_SYNC_JOB_ID";
  var CONTINUE_HANDLER = "trigger_continueSync";
  var CONTINUE_DELAY_MS = 3e4;
  var FIRST_STEP_BUDGET_MS = 45e3;
  var BUDGET_MS = 27e4;
  function syncSteps() {
    return [
      {
        id: "INVENTORY_AI",
        run: "cloudResources",
        query: Q_AI_INVENTORY,
        extraVariables: aiInventoryVariables(resolveAiResourceTypes().types),
        normalize: normalizeInventoryPage
      },
      // One cursor walk per toxic-combination source rule: the assets carrying an OPEN
      // issue for that rule (issue rows are reconstructed one-per-asset).
      ...COMBO_GROUPS.map((group) => ({
        id: `ISSUES_${group.ruleId}`,
        run: "cloudResources",
        query: Q_RULE_ASSETS,
        extraVariables: { ruleIds: [group.ruleId] },
        normalize: (rows) => normalizeRuleAssetsPage(rows, group),
        optional: true
      })),
      // Real toxic-combination issues (issuesV2). Runs alongside the per-rule steps
      // above; reconcileIssues drops the synthetic per-rule rows these supersede.
      {
        id: "ISSUES_TOXIC",
        run: "connection",
        connectionField: "issuesV2",
        query: Q_ISSUES,
        extraVariables: aiIssuesVariables(projectScope()),
        normalize: normalizeIssuesPage,
        optional: true
      },
      // Real compliance findings (configurationFindings) — feeds AARS pillar B.
      {
        id: "CONFIG_FINDINGS",
        run: "connection",
        connectionField: "configurationFindings",
        query: Q_CONFIG_FINDINGS,
        extraVariables: aiConfigFindingsVariables(projectScope()),
        normalize: normalizeConfigFindingsPage,
        optional: true
      },
      {
        id: "GUARDRAIL_GAPS",
        run: "graphSearch",
        query: Q_AGENTS_NO_GUARDRAIL,
        normalize: normalizeNoGuardrailPage,
        optional: true
      },
      {
        id: "RUNS_AS",
        run: "graphSearch",
        query: Q_AGENT_RUNS_AS,
        normalize: normalizeRunsAsPage,
        optional: true
      },
      {
        id: "SA_FINDINGS",
        run: "graphSearch",
        query: Q_SA_EXCESSIVE_ACCESS,
        normalize: normalizeRunsAsPage,
        optional: true
      },
      {
        id: "IDENTITY_ACCESS",
        run: "graphSearch",
        query: Q_IDENTITY_ACCESS,
        normalize: normalizeIdentityAccessPage,
        optional: true
      },
      // Agentic execution identities (cloudResourcesV2 + identityPurpose:AGENTIC).
      {
        id: "AGENTIC_IDENTITIES",
        run: "cloudResources",
        query: Q_PRINCIPALS,
        extraVariables: aiPrincipalsVariables(projectScope()),
        normalize: normalizePrincipalsPage,
        optional: true
      }
    ];
  }
  function startSync() {
    const existing = activeJob();
    if (existing) {
      return { jobId: existing.job_id, message: "A sync is already running." };
    }
    if (!hasWizCredentials()) return dryRunSync();
    return startLiveSync();
  }
  function dryRunSync() {
    const startedAt = nowIso();
    const syncId = `sync-${startedAt.replace(/[:]/g, "")}`;
    const doc = persistSync(
      seedGraphDoc(startedAt),
      SEED_ISSUES,
      SEED_AARS_HINTS,
      { syncId, mode: "dry-run", startedAt, apiCalls: 0 },
      void 0,
      SEED_FINDINGS
    );
    return {
      jobId: null,
      message: `Dry-run sync complete: ${doc.nodes.length} nodes, ${doc.edges.length} edges, ${SEED_ISSUES.length} issues (sample data).`
    };
  }
  function jobParams(job) {
    var _a4, _b;
    try {
      const parsed = JSON.parse((_a4 = job.params_json) != null ? _a4 : "{}");
      const skipped = parsed["skippedSteps"];
      return {
        apiCalls: Number((_b = parsed["apiCalls"]) != null ? _b : 0),
        skippedSteps: Array.isArray(skipped) ? skipped.map(String) : []
      };
    } catch {
      return { apiCalls: 0, skippedSteps: [] };
    }
  }
  function partRefs(job) {
    var _a4;
    try {
      const parsed = JSON.parse((_a4 = job.part_refs_json) != null ? _a4 : "[]");
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  function startLiveSync() {
    const now = nowIso();
    const job = createJob({
      job_id: newJobId("sync"),
      kind: "sync",
      phase: "FETCHING",
      sync_id: `sync-${now.replace(/[:]/g, "")}`,
      step_index: 0,
      cursor: null,
      page: 0,
      nodes_so_far: 0,
      total_count: 0,
      part_refs_json: "[]",
      params_json: JSON.stringify({ apiCalls: 0 }),
      error: null
    });
    runBattery(job, { budgetMs: FIRST_STEP_BUDGET_MS, lockHeld: true });
    const after = getJob(job.job_id);
    return {
      jobId: job.job_id,
      message: after && after.phase === "DONE" ? "Sync complete." : "Sync started \u2014 it continues in the background."
    };
  }
  function continueJob(_e) {
    clearContinuationTriggers();
    const job = activeJob();
    if (!job || job.kind !== "sync" || job.phase !== "FETCHING") return;
    runBattery(job, { budgetMs: BUDGET_MS, lockHeld: false });
  }
  function clearContinuationTriggers() {
    for (const t of ScriptApp.getProjectTriggers()) {
      if (t.getHandlerFunction() === CONTINUE_HANDLER) ScriptApp.deleteTrigger(t);
    }
  }
  function scheduleContinuation() {
    ScriptApp.newTrigger(CONTINUE_HANDLER).timeBased().after(CONTINUE_DELAY_MS).create();
  }
  function runBattery(job, opts) {
    var _a4, _b;
    const deadline = Date.now() + opts.budgetMs;
    const syncId = (_a4 = job.sync_id) != null ? _a4 : job.job_id;
    const refs = partRefs(job);
    const params = jobParams(job);
    let stepIndex = job.step_index;
    let cursor = job.cursor;
    let page = job.page;
    let nodesSoFar = job.nodes_so_far;
    let hopPart = emptyPart();
    const spillHopPart = () => {
      if (!hopPart.nodes.length && !hopPart.edges.length && !hopPart.issues.length) return;
      const name = `normalized-part-${String(refs.length + 1).padStart(3, "0")}.json.gz`;
      refs.push(writeGzJson(syncFolder(syncId), name, hopPart).getId());
      hopPart = emptyPart();
    };
    try {
      const steps = syncSteps();
      while (stepIndex < steps.length) {
        const step = steps[stepIndex];
        for (; ; ) {
          if (cancelRequested(job.job_id)) {
            clearCancelFlag();
            updateJob(job.job_id, { phase: "CANCELLED" });
            return;
          }
          if (Date.now() >= deadline) {
            spillHopPart();
            updateJob(job.job_id, {
              step_index: stepIndex,
              cursor,
              page,
              nodes_so_far: nodesSoFar,
              part_refs_json: JSON.stringify(refs),
              params_json: JSON.stringify(params)
            });
            scheduleContinuation();
            return;
          }
          const fetcher = step.run === "graphSearch" ? fetchGraphSearchPage : step.run === "connection" ? (a) => fetchConnectionPage(step.connectionField, a) : fetchCloudResourcesPage;
          let result;
          try {
            result = fetcher({
              query: step.query,
              cursor,
              extraVariables: step.extraVariables
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (step.optional && /HTTP 400/.test(msg)) {
              params.apiCalls += 1;
              params.skippedSteps.push(step.id);
              console.warn(`Sync step ${step.id} skipped \u2014 tenant rejected its query: ${msg}`);
              break;
            }
            throw e;
          }
          params.apiCalls += 1;
          page += 1;
          nodesSoFar += result.rows.length;
          writeSyncPage(syncId, stepIndex, page, result.rows);
          const normalized = step.normalize(result.rows);
          hopPart.nodes.push(...normalized.nodes);
          hopPart.edges.push(...normalized.edges);
          hopPart.issues.push(...normalized.issues);
          updateJob(job.job_id, {
            step_index: stepIndex,
            cursor: result.endCursor,
            page,
            nodes_so_far: nodesSoFar,
            total_count: (_b = result.totalCount) != null ? _b : 0,
            params_json: JSON.stringify(params)
          });
          if (!result.hasNextPage || page >= MAX_PAGES) break;
          cursor = result.endCursor;
        }
        spillHopPart();
        stepIndex += 1;
        cursor = null;
        page = 0;
        updateJob(job.job_id, {
          step_index: stepIndex,
          cursor: null,
          page: 0,
          part_refs_json: JSON.stringify(refs),
          params_json: JSON.stringify(params)
        });
      }
      updateJob(job.job_id, { phase: "RECONCILING" });
      const parts = [];
      for (const ref of refs) {
        const parsed = readGzJsonFile(ref);
        if (parsed && Array.isArray(parsed.nodes)) parts.push(parsed);
      }
      const startedAt = job.started_at;
      const merged = mergeParts(parts, nowIso());
      const doc = merged.doc;
      const issues2 = reconcileIssues(merged.issues);
      const findings = merged.findings;
      if (!doc.nodes.length) {
        updateJob(job.job_id, {
          phase: "FAILED",
          error: "Sync fetched no assets \u2014 check the service account's scope and permissions."
        });
        return;
      }
      updateJob(job.job_id, { phase: "PERSISTING" });
      const hints = buildAarsHintsFromFindings(findings, doc, issues2);
      const persist = () => persistSync(doc, issues2, hints, {
        syncId,
        mode: "live",
        startedAt,
        apiCalls: params.apiCalls
      }, void 0, findings);
      if (opts.lockHeld) persist();
      else withScriptLock(persist);
      updateJob(job.job_id, { phase: "DONE" });
    } catch (e) {
      updateJob(job.job_id, {
        phase: "FAILED",
        error: String(e instanceof Error ? e.message : e).slice(0, 800)
      });
    }
  }
  function dailySync() {
    if (!hasWizCredentials()) return;
    withScriptLock(() => {
      startSyncFromTrigger();
    });
  }
  function startSyncFromTrigger() {
    const existing = activeJob();
    if (existing) return;
    startLiveSync();
  }
  function cancelSync(jobId) {
    const job = getJob(jobId);
    if (!job) return { message: "No such sync job." };
    if (job.phase === "DONE" || job.phase === "FAILED" || job.phase === "CANCELLED") {
      return { message: "The sync already finished." };
    }
    setProp(CANCEL_PROP, jobId);
    return { message: "Stopping sync\u2026" };
  }
  function cancelRequested(jobId) {
    return getProp(CANCEL_PROP) === jobId;
  }
  function clearCancelFlag() {
    deleteProp(CANCEL_PROP);
  }
  function jobStatus(jobId) {
    return getJob(jobId);
  }

  // src/server/api.ts
  function run(fn) {
    try {
      return { ok: true, data: fn() };
    } catch (e) {
      const kind = e instanceof LedgerBusyError ? "busy" : "error";
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
  function openIssues() {
    return loadIssues().filter((i) => i.status === "OPEN");
  }
  function bootstrap(_p) {
    return run(() => {
      var _a4;
      return {
        ...cached("bootstrapCore", null, bootstrapCore),
        dataVersion: dataVersion(),
        hasCredentials: hasWizCredentials(),
        activeJob: (_a4 = activeJob()) != null ? _a4 : null
      };
    });
  }
  function bootstrapCore() {
    var _a4, _b;
    const assets = loadAssets();
    const issues2 = openIssues();
    const latest = latestSync();
    const bySeverity = {};
    for (const issue2 of issues2) {
      bySeverity[issue2.adjustedSeverity] = ((_a4 = bySeverity[issue2.adjustedSeverity]) != null ? _a4 : 0) + 1;
    }
    const byBand = {};
    for (const a of assets) {
      if (a.aarsBand) byBand[a.aarsBand] = ((_b = byBand[a.aarsBand]) != null ? _b : 0) + 1;
    }
    return {
      palette: {
        order: SEVERITY_ORDER,
        colors: SEVERITY_COLORS,
        glyphs: SEVERITY_GLYPHS,
        aarsBands: AARS_BAND_ORDER,
        aarsBandSeverity: AARS_BAND_SEVERITY_TOKEN
      },
      comboLegend: COMBO_GROUPS.map((g) => ({
        id: g.id,
        title: g.title,
        shortLabel: g.shortLabel,
        nativeSeverity: g.nativeSeverity,
        adjustedSeverity: g.adjustedSeverity
      })),
      settings: {
        defaultDepth: getDefaultDepth2(),
        maxNodes: getMaxNodes2()
      },
      latestSync: latest,
      counts: {
        aiAssets: assets.filter((a) => AI_ASSET_KINDS.includes(a.kind)).length,
        totalAssets: assets.length,
        openIssues: issues2.length,
        bySeverity,
        byBand
      },
      filterOptions: filterOptions(assets)
    };
  }
  function filterOptions(assets) {
    var _a4;
    const kinds = /* @__PURE__ */ new Set();
    const clouds = /* @__PURE__ */ new Set();
    const projects = /* @__PURE__ */ new Set();
    for (const a of assets) {
      kinds.add(a.kind);
      if (a.cloudPlatform) clouds.add(a.cloudPlatform);
      for (const p of (_a4 = a.projects) != null ? _a4 : []) projects.add(p.name);
    }
    return {
      kinds: [...kinds].sort(),
      clouds: [...clouds].sort(),
      projects: [...projects].sort()
    };
  }
  function getGraph(p) {
    return run(() => {
      const params = p != null ? p : {};
      return cached("getGraph", graphCacheParams(params), () => {
        var _a4;
        const doc = loadGraphDoc();
        if (!doc) return { empty: true };
        const options = resolveGraphParams(params, {
          defaultDepth: getDefaultDepth2(),
          maxNodes: getMaxNodes2(),
          issues: openIssues()
        });
        const view = resolveLayoutParams(params);
        const projection = projectGraph(doc, options);
        const layout = layoutGraph(projection, view);
        return {
          nodes: projection.nodes,
          edges: projection.edges,
          summaries: projection.summaries,
          counts: projection.counts,
          layout,
          options: {
            depth: options.depth,
            seedIds: options.seedIds,
            expandIds: (_a4 = options.expandIds) != null ? _a4 : [],
            layout: view.mode,
            groupBy: view.groupBy,
            sort: view.sort
          },
          syncedAt: doc.syncedAt
        };
      });
    });
  }
  function assetRow(n) {
    var _a4, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v;
    return {
      id: n.id,
      name: n.name,
      kind: n.kind,
      nativeType: (_a4 = n.nativeType) != null ? _a4 : null,
      cloud: (_b = n.cloudPlatform) != null ? _b : null,
      region: (_c = n.region) != null ? _c : null,
      status: (_d = n.status) != null ? _d : null,
      projects: ((_e = n.projects) != null ? _e : []).map((p) => p.name),
      severity: (_f = n.severity) != null ? _f : null,
      aars: (_g = n.aars) != null ? _g : null,
      aarsBand: (_h = n.aarsBand) != null ? _h : null,
      comboGroups: (_i = n.comboGroups) != null ? _i : [],
      internet: (_j = n.isAccessibleFromInternet) != null ? _j : null,
      openInternet: (_k = n.isOpenToAllInternet) != null ? _k : null,
      sensitiveAccess: (_l = n.hasAccessToSensitiveData) != null ? _l : false,
      sensitiveData: (_m = n.hasSensitiveData) != null ? _m : false,
      highPriv: (_n = n.hasHighPrivileges) != null ? _n : false,
      adminPriv: (_o = n.hasAdminPrivileges) != null ? _o : false,
      guardrailMissing: (_p = n.guardrailMissing) != null ? _p : false,
      technologyCategories: (_q = n.technologyCategories) != null ? _q : [],
      cloudAccount: (_s = (_r = n.cloudAccount) == null ? void 0 : _r.name) != null ? _s : null,
      tags: (_t = n.tags) != null ? _t : [],
      identityPurpose: (_u = n.identityPurpose) != null ? _u : null,
      issueAnalytics: (_v = n.issueAnalytics) != null ? _v : null
    };
  }
  function getAssets(_p) {
    return run(
      () => cached("getAssets", null, () => {
        const assets = loadAssets();
        const issues2 = openIssues();
        const agents = assets.filter((a) => a.kind === "AI_AGENT");
        const protectedAgents = agents.filter((a) => !a.guardrailMissing).length;
        const rows = assets.map(assetRow).sort((a, b) => {
          var _a4, _b;
          return Number((_a4 = b["aars"]) != null ? _a4 : -1) - Number((_b = a["aars"]) != null ? _b : -1);
        });
        return {
          rows,
          kpis: {
            aiAssets: assets.filter((a) => AI_ASSET_KINDS.includes(a.kind)).length,
            agents: agents.length,
            criticalBand: assets.filter((a) => a.aarsBand === "CRITICAL").length,
            highBand: assets.filter((a) => a.aarsBand === "HIGH").length,
            guardrailCoveragePct: agents.length ? Math.round(protectedAgents / agents.length * 100) : null,
            sensitiveAccess: assets.filter(
              (a) => AI_ASSET_KINDS.includes(a.kind) && a.hasAccessToSensitiveData
            ).length,
            openIssues: issues2.length,
            complianceGaps: loadFindings().length,
            agenticIdentities: assets.filter((a) => a.identityPurpose === "AGENTIC").length
          }
        };
      })
    );
  }
  function getAssetDetail(p) {
    return run(() => {
      var _a4;
      const id = String((_a4 = (p != null ? p : {})["id"]) != null ? _a4 : "");
      return cached("getAssetDetail", { id }, () => {
        var _a5;
        const doc = loadGraphDoc();
        if (!doc) return null;
        const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
        const node2 = nodeById.get(id);
        if (!node2) return null;
        const issues2 = openIssues().filter((i) => i.assetId === id);
        const neighbors = [];
        for (const edge2 of doc.edges) {
          if (edge2.src !== id && edge2.dst !== id) continue;
          const otherId = edge2.src === id ? edge2.dst : edge2.src;
          const other = nodeById.get(otherId);
          if (!other || other.kind === "ISSUE") continue;
          neighbors.push({
            edge: edge2,
            node: assetRow(other),
            direction: edge2.src === id ? "out" : "in"
          });
        }
        const findings = loadFindings().filter((f) => f.resourceId === id);
        return {
          node: { ...assetRow(node2), aarsPillars: (_a5 = node2.aarsPillars) != null ? _a5 : null },
          issues: issues2,
          neighbors,
          findings
        };
      });
    });
  }
  function getIssues(p) {
    return run(() => {
      var _a4;
      const params = p != null ? p : {};
      const group = String((_a4 = params["group"]) != null ? _a4 : "");
      return cached("getIssues", { group }, () => {
        let rows = loadIssues();
        if (group) rows = rows.filter((i) => i.comboGroup === group);
        return { rows, total: rows.length };
      });
    });
  }
  function getIssueDetail(p) {
    return run(() => {
      var _a4, _b;
      const id = String((_a4 = (p != null ? p : {})["id"]) != null ? _a4 : "");
      const issue2 = (_b = loadIssues().find((i) => i.id === id)) != null ? _b : null;
      if (!issue2) return null;
      const group = issue2.comboGroup ? comboGroupById(issue2.comboGroup) : null;
      return {
        issue: issue2,
        group: group ? {
          id: group.id,
          title: group.title,
          adjustedSeverity: group.adjustedSeverity,
          nativeSeverity: group.nativeSeverity,
          amplifierNote: group.amplifierNote,
          frameworks: group.frameworks
        } : null
      };
    });
  }
  function getToxicCombos(_p) {
    return run(
      () => cached("getToxicCombos", null, () => {
        const issues2 = openIssues();
        const assets = new Map(loadAssets().map((a) => [a.id, a]));
        return {
          groups: comboSummary(issues2).map((s) => ({
            id: s.group.id,
            ruleId: s.group.ruleId,
            title: s.group.title,
            shortLabel: s.group.shortLabel,
            nativeSeverity: s.group.nativeSeverity,
            adjustedSeverity: s.group.adjustedSeverity,
            amplifierNote: s.group.amplifierNote,
            frameworks: s.group.frameworks,
            count: s.count,
            assets: s.assetIds.map((id) => {
              var _a4, _b;
              const a = assets.get(id);
              return a ? { id, name: a.name, aars: (_a4 = a.aars) != null ? _a4 : null, aarsBand: (_b = a.aarsBand) != null ? _b : null } : { id, name: id, aars: null, aarsBand: null };
            })
          })),
          totalOpen: issues2.length
        };
      })
    );
  }
  function runSync(_p) {
    return mutate(() => startSync());
  }
  function getJobStatus(p) {
    return run(() => {
      var _a4;
      return jobStatus(String((_a4 = (p != null ? p : {})["jobId"]) != null ? _a4 : ""));
    });
  }
  function cancelSync2(p) {
    return run(() => {
      var _a4;
      return cancelSync(String((_a4 = (p != null ? p : {})["jobId"]) != null ? _a4 : ""));
    });
  }
  function getSyncHistory(_p) {
    return run(() => cached("getSyncHistory", null, () => ({
      rows: syncHistory().reverse()
    })));
  }
  function getSettings(_p) {
    return run(() => ({
      defaultDepth: getDefaultDepth2(),
      maxNodes: getMaxNodes2(),
      hasCredentials: hasWizCredentials()
    }));
  }
  function setSettings(p) {
    return mutate(() => {
      const params = p != null ? p : {};
      if (params["defaultDepth"] !== void 0) {
        setDefaultDepth(params["defaultDepth"]);
      }
      if (params["maxNodes"] !== void 0) setMaxNodes(params["maxNodes"]);
      return {
        defaultDepth: getDefaultDepth2(),
        maxNodes: getMaxNodes2()
      };
    });
  }
  function resetData2(_p) {
    return mutate(() => {
      resetData();
      return { message: "All synced data cleared." };
    });
  }
  function getStorageStats(_p) {
    return run(
      () => cached("getStorageStats", null, () => ({
        cellCount: cellCount(),
        archiveBytes: archiveBytes(),
        rows: {
          assets: dataRowCount(TABS.assets),
          edges: dataRowCount(TABS.edges),
          issues: dataRowCount(TABS.issues),
          syncs: dataRowCount(TABS.syncHistory)
        }
      }), 3600)
    );
  }
  return __toCommonJS(server_exports);
})();
