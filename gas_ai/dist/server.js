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
    aarsDiagnostic: () => aarsDiagnostic,
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
    wizAiResourceTypes: "WIZ_AI_RESOURCE_TYPES",
    // The DERIVED resolution, written by resolveAiResourceTypes — never by an operator.
    // Deliberately a different key from the override above: one is an instruction and the
    // other is a memo, and conflating them would let a cached answer masquerade as a
    // configured one (and survive the operator clearing the override).
    wizAiResourceTypesResolved: "WIZ_AI_RESOURCE_TYPES_RESOLVED"
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
  var rootFolderMemo;
  var subfolderMemo = /* @__PURE__ */ new Map();
  var syncFolderMemo = /* @__PURE__ */ new Map();
  function forgetFolders() {
    rootFolderMemo = void 0;
    subfolderMemo.clear();
    syncFolderMemo.clear();
  }
  function rootFolder() {
    if (!rootFolderMemo) {
      rootFolderMemo = DriveApp.getFolderById(requireProp(PROP_KEYS.archiveFolderId));
    }
    return rootFolderMemo;
  }
  function childFolder(parent, name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  }
  function subfolder(name) {
    const hit = subfolderMemo.get(name);
    if (hit) return hit;
    const folder = childFolder(rootFolder(), name);
    subfolderMemo.set(name, folder);
    return folder;
  }
  function ensureFolders(rootId) {
    forgetFolders();
    const root = rootId ? DriveApp.getFolderById(rootId) : rootFolder();
    for (const name of SUBFOLDERS) childFolder(root, name);
    forgetFolders();
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
    const key = safeName(syncId);
    const hit = syncFolderMemo.get(key);
    if (hit) return hit;
    const folder = childFolder(subfolder("syncs"), key);
    syncFolderMemo.set(key, folder);
    return folder;
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
    let total2 = 0;
    for (const name of SUBFOLDERS) {
      const walk = (folder) => {
        const files = folder.getFiles();
        while (files.hasNext()) total2 += files.next().getSize();
        const folders = folder.getFolders();
        while (folders.hasNext()) walk(folders.next());
      };
      walk(subfolder(name));
    }
    return total2;
  }

  // src/domain/util.ts
  function toStr(v, fallback = "") {
    return v === null || v === void 0 ? fallback : String(v);
  }
  function toNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function clampInt(v, fallback, min, max) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }
  function cmp(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function cmpBy(key) {
    return (a, b) => cmp(key(a), key(b));
  }
  function indexBy(xs, key) {
    const out = /* @__PURE__ */ new Map();
    for (const x of xs) out.set(key(x), x);
    return out;
  }
  function pushInto(map, key, ...values) {
    const bucket = map.get(key);
    if (bucket) bucket.push(...values);
    else map.set(key, [...values]);
  }
  function groupBy(xs, key) {
    const out = /* @__PURE__ */ new Map();
    for (const x of xs) pushInto(out, key(x), x);
    return out;
  }
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

  // src/server/sheetsDb.ts
  var TABS = {
    assets: "ai_assets",
    edges: "ai_edges",
    issues: "ai_issues",
    findings: "ai_findings",
    dataFindings: "ai_data_findings",
    frameworks: "ai_frameworks",
    frameworkPosture: "ai_framework_posture",
    frameworkPolicies: "ai_framework_policies",
    configRules: "ai_config_rules",
    identityFindings: "ai_identity_findings",
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
      "aars_severity",
      "aars_pillars_json",
      "aars_input_json",
      "combo_groups",
      "tags_json",
      "technology_categories",
      "identity_purpose",
      "issue_analytics_json",
      // DSPM classification on a datastore row. Appended, so an existing ledger picks them
      // up on the next sync with no migration (see the note on ai_issues below).
      "data_finding_count",
      "data_findings_json",
      // Network exposure. The first two are the dynamic scanner's verdicts and belong to
      // ENDPOINT rows; the third is the join `withExposureEvidence` folds onto an AI asset,
      // and is what lets the Inventory and the combos matrix — which read this tab directly
      // and never see the graph document — agree with the graph about what is exposed.
      // Appended for the same no-migration reason.
      "exposure_level",
      "port_validation",
      "exposure_evidence_json",
      // Human identity access. The first two belong to identity rows (Wiz's dormancy read from
      // cloud audit events); the third is the join `withHumanAccess` folds onto an AI asset, so
      // the register and the Scans figure can total reach without reading edges. Appended.
      "inactive",
      "inactive_timeframe",
      "human_access_json",
      // Identity display fields (the human title and address an operator gave the account) and
      // the two AI-asset provenance fields the Security Graph's default columns read. All four
      // come out of the graph entity's properties bag. Appended for the usual no-migration
      // reason: ensureHeaders adds declared-but-missing headers to the right of whatever a tab
      // already has, and every read maps by header NAME.
      "display_name",
      "email",
      "publisher",
      "discovery_methods"
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
      "remediation",
      // issuesV2 lifecycle and context. Appended, never inserted: ensureHeaders adds
      // declared-but-missing headers to the right of whatever a tab already has and every
      // read maps by header NAME, so a ledger written before this change picks these up on
      // the next sync with no migration and no re-run of setup().
      "issue_type",
      "updated_at",
      "resolved_at",
      "resolution_reason",
      "resolved_by",
      "assignee",
      "environments",
      "validated_exploitable",
      "business_impact",
      "entity_status",
      "subscription_id",
      "ignore_note",
      "ignore_expired_at",
      "ticket_urls",
      "ai_verdict",
      "ai_recommended_severity"
    ],
    [TABS.findings]: [
      "id",
      "resource_id",
      "rule_short_id",
      "severity",
      "remediation",
      "framework_codes",
      // The Cloud Configuration register. Appended, never inserted — same contract as the
      // ai_issues block above: ensureHeaders adds declared-but-missing headers to the right
      // and every read maps by header NAME, so a ledger written before this change picks
      // them up on the next sync with no migration and no re-run of setup().
      //
      // Rows written by the previous version carry neither `result` nor `status`. That is
      // why isOpenGap (domain/config.ts) treats an absent field as permissive: those rows
      // were already filtered to FAIL + OPEN at ingest, and demanding the columns would
      // read every one of them as "not a gap".
      "name",
      "status",
      "result",
      "deleted",
      "first_seen_at",
      "analyzed_at",
      // The control. rule_description / remediation_instructions / opa_policy repeat
      // verbatim across every finding of the same rule — sixteen identical Rego documents
      // for one Bedrock rule in the sample tenant. Denormalized on purpose: the register
      // reads them per row, the sync rewrites this tab wholesale, and a rules tab would buy
      // a join to save a few hundred cells on a register the framework filter already
      // bounds to the AI estate.
      "rule_id",
      "rule_graph_id",
      "rule_name",
      "rule_description",
      "remediation_instructions",
      "opa_policy",
      "risks_json",
      "threats_json",
      "resource_name",
      "resource_type",
      "resource_status",
      "target_external_id",
      "source",
      "subscription_id",
      "subscription_name",
      "cloud_provider",
      "projects_json",
      "business_impact",
      "ignore_rule_ids_json",
      "iac_finding_ids_json"
    ],
    // DSPM findings, kept apart from the compliance findings above on purpose: that tab
    // prices AARS pillar B and counts as `complianceGaps`, and a classification finding
    // folded into it would inflate both.
    [TABS.dataFindings]: ["id", "resource_id", "name", "severity"],
    // ---- compliance framework posture (securityFramework/complianceAnalytics) ----
    //
    // Three tabs rather than one, because the posture tree has two genuinely different
    // grains and a many-to-many edge between them.
    //
    // `ai_frameworks` is the catalogue: what the tenant has, so Settings can offer a picker
    // instead of asking an operator to type "wf-id-275".
    //
    // No `selected` column. Selection is THIS APP's decision and lives in `settings`; a
    // column here could only ever be a stale copy of it, written by a sync that has no
    // reason to know. The API model folds the two together at read time instead.
    [TABS.frameworks]: ["id", "name", "description", "builtin", "enabled", "policy_types"],
    // `ai_framework_posture` is the TREE, flattened with a `level` discriminator
    // (framework | category | subcategory) rather than split across three tabs. One read
    // path, one wholesale rewrite, and the page rebuilds the hierarchy from external ids.
    //
    // `posture_pct` is stored EXACTLY as Wiz sent it and is never recomputed: it is their
    // number, and a second locally-derived percentage sitting beside it would be two
    // answers to one question. `empty_posture_reason` (NO_RESOURCES / NO_POLICIES) is what
    // keeps a null posture from being read as a confident 0 — see compliancePosture.ts.
    [TABS.frameworkPosture]: [
      "framework_id",
      "level",
      "category_external_id",
      "subcategory_external_id",
      "node_id",
      "title",
      "description",
      "posture_pct",
      "pass_count",
      "fail_count",
      "pass_subcategory_count",
      "fail_subcategory_count",
      "empty_posture_reason",
      "assessment_scope",
      "mapping_rationale",
      "tags_json"
    ],
    // `ai_framework_policies` is the many-to-many EDGE, one row per
    // (framework, subcategory, policy). The same control maps to several subcategories —
    // one prompt-injection control lands under ASI01, ASI02 and ASI10 — so the mapping IS
    // the row. Keying by policy id alone would lose it, which is exactly the join this
    // feature exists to harvest: it is what lets a failing finding be labelled with the
    // framework codes AARS pillar B already knows how to price.
    [TABS.frameworkPolicies]: [
      "framework_id",
      "category_external_id",
      "subcategory_external_id",
      "policy_id",
      "policy_kind",
      "short_id",
      "name",
      "severity",
      "enabled",
      "builtin",
      "pass_count",
      "fail_count",
      "assessed_count",
      "rejected_count",
      "no_resource_to_assess",
      "target_native_type",
      "subject_entity_type",
      "cloud_provider",
      "has_auto_remediation"
    ],
    // ---- the rule catalogue + identity hygiene (cloudConfigurationRules) ----
    //
    // `ai_config_rules` is Wiz's VOCABULARY, not this tenant's posture — the only tab here
    // whose contents do not describe the estate. It is what turns an opaque `SUB-082` in the
    // AARS cascade into "Vertex AI Metadata Store should be encrypted with a customer-managed
    // key", and what the identity-hygiene matchers resolve MFA and dormancy rules against
    // instead of hardcoding ids that differ per cloud. ~3,858 rows, refreshed monthly rather
    // than daily; see the CONFIG_RULES gate in syncJobs.
    [TABS.configRules]: ["id", "short_id", "name", "subject_entity_type", "external_refs"],
    // `ai_identity_findings` is separate from `ai_findings` for the reason `ai_data_findings`
    // is: that tab prices AARS pillar B through buildAarsHintsFromFindings, which keys hints by
    // resourceId — and a USER_ACCOUNT IS a row in ai_assets, put there by the identity-access
    // traversal. Folding a person's missing MFA in there would give a human being an AI Asset
    // Risk Score.
    [TABS.identityFindings]: [
      "id",
      "resource_id",
      "resource_name",
      "rule_id",
      "rule_short_id",
      "rule_name",
      "severity",
      "status",
      "result",
      "first_seen_at",
      "analyzed_at",
      "remediation",
      "hygiene"
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
      "error",
      "aars_severity_json",
      "aars_rule_version"
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
        ensureHeaders(sh, tab);
      }
    }
    const dflt = ss.getSheetByName("Sheet1");
    if (dflt && ss.getSheets().length > 1) ss.deleteSheet(dflt);
  }
  function fromCell(v) {
    if (v === "" || v === null || v === void 0) return null;
    if (v instanceof Date) return toIso(v.getTime());
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
  function ensureHeaders(sh, tab) {
    var _a5;
    const width = Math.max(sh.getLastColumn(), 1);
    const existing = sh.getRange(1, 1, 1, width).getValues()[0].map(String).filter(Boolean);
    const missing = ((_a5 = TAB_HEADERS[tab]) != null ? _a5 : []).filter((h) => !existing.includes(h));
    if (missing.length) {
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    }
    return [...existing, ...missing];
  }
  function writeGrid(sh, headers, startRow, rows) {
    if (!rows.length) return;
    const grid = rows.map((r) => headers.map((h) => toCell(r[h])));
    const range = sh.getRange(startRow, 1, grid.length, headers.length);
    range.setNumberFormat("@");
    range.setValues(grid);
  }
  function overwrite(tab, rows) {
    const sh = sheet(tab);
    const headers = ensureHeaders(sh, tab);
    const lastRow = sh.getLastRow();
    if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, headers.length).clearContent();
    writeGrid(sh, headers, 2, rows);
  }
  function appendRows(tab, rows) {
    if (!rows.length) return;
    const sh = sheet(tab);
    writeGrid(sh, ensureHeaders(sh, tab), sh.getLastRow() + 1, rows);
  }
  function dataRowCount(tab) {
    return Math.max(0, sheet(tab).getLastRow() - 1);
  }
  function updateWhere(tab, keyColumn, keyValue, patch) {
    const sh = sheet(tab);
    if (sh.getLastRow() < 2) return false;
    const headers = ensureHeaders(sh, tab);
    const lastRow = sh.getLastRow();
    const lastCol = headers.length;
    const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
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

  // src/domain/effectiveAccess.ts
  var EFFECTIVE_ACCESS_TYPES = ["DATA"];
  var EFFECTIVE_GRANTED_TYPES = ["USER_ACCOUNT"];
  function effectiveAccessFilter(types, scope) {
    const filterBy = {
      grantedEntity: {},
      grantedEntityType: { equals: [...EFFECTIVE_GRANTED_TYPES] },
      resource: {},
      resourceType: { equals: [...types] },
      accessTypes: { equals: [...EFFECTIVE_ACCESS_TYPES] }
    };
    if (scope && scope.length) filterBy["projectId"] = scope;
    return filterBy;
  }
  function str(v) {
    return v === null || v === void 0 || v === "" ? void 0 : String(v);
  }
  function strings(v) {
    return Array.isArray(v) ? v.map((x) => str(x)).filter((x) => !!x) : [];
  }
  function addUnique(list2, value) {
    if (value && list2.indexOf(value) < 0) list2.push(value);
  }
  function collectPolicies(raw, ids, names) {
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const policy = entry["policy"];
      if (!policy || typeof policy !== "object") continue;
      addUnique(ids, str(policy["id"]));
      addUnique(names, str(policy["name"]));
    }
  }
  function toEffectiveAccessRow(raw) {
    if (!raw || typeof raw !== "object") return null;
    const granted = raw["grantedEntity"];
    const resource = raw["accessibleResource"];
    const identityId = granted && typeof granted === "object" ? str(granted["id"]) : void 0;
    const resourceId = resource && typeof resource === "object" ? str(resource["id"]) : void 0;
    if (!identityId || !resourceId) return null;
    const accessTypes = [];
    const permissions = [];
    const policyIds = [];
    const policyNames = [];
    for (const t of strings(raw["accessTypes"])) addUnique(accessTypes, t);
    for (const p of strings(raw["permissions"])) addUnique(permissions, p);
    const paths = raw["paths"];
    if (Array.isArray(paths)) {
      for (const path of paths) {
        if (!path || typeof path !== "object") continue;
        for (const t of strings(path["accessTypes"])) addUnique(accessTypes, t);
        for (const p of strings(path["permissions"])) addUnique(permissions, p);
        collectPolicies(path["principalPolicies"], policyIds, policyNames);
        collectPolicies(path["resourcePolicies"], policyIds, policyNames);
      }
    }
    return {
      identityId,
      identityName: str(granted["name"]),
      resourceId,
      accessTypes,
      permissions,
      policyIds,
      policyNames
    };
  }

  // src/domain/exposureQuery.ts
  var RATED_EXPOSURE_LEVELS = ["High", "Medium"];
  var VALIDATED_PORT_STATE = "Open";
  var HOST_KINDS = ["VIRTUAL_MACHINE", "SERVERLESS"];
  function hostExposureSpec(types) {
    return {
      type: [...types],
      relationships: [
        {
          type: [...HOST_KINDS],
          edge: { type: "RUNS", reverse: true },
          where: { "accessibleFrom.internet": { EQUALS: true } }
        }
      ]
    };
  }
  function endpointExposureSpec(types) {
    return {
      type: [...types],
      relationships: [
        {
          type: "ENDPOINT",
          edge: { type: "SERVES" },
          where: {
            exposureLevel_name: { EQUALS: [...RATED_EXPOSURE_LEVELS] },
            portValidationResult: { EQUALS: VALIDATED_PORT_STATE }
          }
        }
      ]
    };
  }
  function isRatedExposure(level, portValidation) {
    if (portValidation !== VALIDATED_PORT_STATE) return false;
    return RATED_EXPOSURE_LEVELS.indexOf(level != null ? level : "") >= 0;
  }
  function worseExposureLevel(a, b) {
    const rank = (v) => {
      const i = RATED_EXPOSURE_LEVELS.indexOf(v != null ? v : "");
      return i === -1 ? RATED_EXPOSURE_LEVELS.length : i;
    };
    if (a === void 0) return b;
    if (b === void 0) return a;
    return rank(a) <= rank(b) ? a : b;
  }

  // src/domain/config.ts
  var SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];
  var UNRESOLVED_ISSUE_STATUSES = ["OPEN", "IN_PROGRESS"];
  function isUnresolvedIssue(issue2) {
    var _a5;
    return UNRESOLVED_ISSUE_STATUSES.includes(String((_a5 = issue2.status) != null ? _a5 : ""));
  }
  function isOpenGap(finding) {
    var _a5, _b;
    if (finding.deleted === true) return false;
    const result = String((_a5 = finding.result) != null ? _a5 : "");
    if (result && result !== "FAIL") return false;
    const status = String((_b = finding.status) != null ? _b : "");
    if (status && status !== "OPEN") return false;
    return true;
  }
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
  var AARS_SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  function normalizeAarsSeverity(v) {
    const s = typeof v === "string" ? v.trim().toUpperCase() : "";
    if (s === "MINIMAL") return "INFO";
    return AARS_SEVERITY_ORDER.includes(s) ? s : void 0;
  }
  var DEPTH_MIN = 1;
  var DEPTH_MAX = 3;
  var DEPTH_DEFAULT = 2;
  var MAX_NODES_DEFAULT = 100;
  var MAX_NODES_FLOOR = 30;
  var MAX_NODES_CEILING = 400;
  var MAX_EDGES_DEFAULT = 250;
  var EDGE_BUDGET_RATIO = 2.5;
  var SEED_WAVE_RATIO = 0.4;

  // src/domain/graphTypes.ts
  function severityRank(s) {
    const i = SEVERITY_ORDER.indexOf(s != null ? s : "");
    return i === -1 ? SEVERITY_ORDER.length : i;
  }
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
    // Synthesized from the identity-access scan: one per AI asset a HUMAN identity can reach
    // at high privilege. Declared beside the CIEM findings rather than with the other
    // synthetic kinds below, so the grouped layout files it with the access finding it
    // complements — that layout orders its blocks by this list.
    "IDENTITY_ACCESS_FINDING",
    // synthetic
    "ISSUE",
    // one node per open risk issue (toxic-combination instance)
    "SUMMARY",
    // collapse node: "+N more <kind>" emitted by the projection
    "SENSITIVE_DATA",
    // one node per data-exposed asset (AARS pillar C topology)
    "INTERNET_EXPOSURE",
    // one node per internet-exposed asset (exposure topology)
    "EXCESSIVE_PRIVILEGE",
    // one node per over-privileged asset (CIEM rights topology)
    "MISSING_GUARDRAIL",
    // one node per unguarded AI asset (guardrail-coverage topology)
    // Appended, so the kinds above keep their declaration order (the grouped layout orders
    // its blocks by this list).
    //
    // DATABASE_SERVER is inventory, not synthetic: it is in the datastore type list the
    // sensitive-data traversal asks for (ai/queries/6_IAM.MD). Leaving it out would not
    // narrow the query — kindFromWizType would return null and the whole ROW would be
    // skipped, losing the agent and the service account with it.
    "DATABASE_SERVER",
    // One node per datastore that carries classified data findings — the aggregate, not the
    // individual finding. Wiz draws the same collapse ("Data Findings", count badge); a
    // bucket with 200 findings would otherwise spend the entire node budget by itself.
    "DATA_FINDING",
    // The network-exposure traversals' far end: a validated, reachable service address such as
    // `https://…run.app:443`. INVENTORY, not evidence — it carries a name, a region, a status
    // and a subscription, which is why it stays out of RISK_NODE_KINDS with BUCKET and
    // DATABASE rather than joining the derived stubs.
    //
    // graphExpand.toExpandedNode used to flag this kind `unmodeled`, because declaring it here
    // "would admit them into the sync and persistence path too". That is now the intent: two
    // sync steps collect these deliberately.
    "ENDPOINT"
  ];
  var RISK_NODE_KINDS = [
    "ISSUE",
    "SENSITIVE_DATA",
    "INTERNET_EXPOSURE",
    "EXCESSIVE_PRIVILEGE",
    "MISSING_GUARDRAIL",
    "EXCESSIVE_ACCESS_FINDING",
    "LATERAL_MOVEMENT_FINDING",
    "IDENTITY_ACCESS_FINDING",
    // DATA_FINDING is here; BUCKET / DATABASE / DATABASE_SERVER deliberately are NOT. The
    // finding is evidence about a store and must ride through the filters with it. The store
    // itself is inventory the tenant owns — it carries a cloud, a region and projects, and
    // someone filtering to GCP means to exclude an AWS bucket. Filtering the store out still
    // takes its findings with it, because the projection only admits neighbours of admitted
    // nodes.
    "DATA_FINDING"
  ];
  function isRiskKind(kind) {
    return RISK_NODE_KINDS.includes(kind);
  }
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
  var PROPERTY_ALIASES = {
    firstSeen: ["creationDate"],
    lastSeen: ["updatedAt"],
    isAccessibleFromInternet: ["accessibleFrom.internet"],
    isOpenToAllInternet: ["openToAllInternet"],
    // ENDPOINT entities only. Wiz spells the dynamic scanner's two verdicts with suffixes the
    // rest of the model has no use for; aliasing them here is what lets the GNode field keep
    // the name the app reads it by.
    exposureLevel: ["exposureLevel_name"],
    portValidation: ["portValidationResult"]
  };
  function entityField(raw, key) {
    var _a5;
    if (!raw || typeof raw !== "object") return void 0;
    if (raw[key] !== void 0) return raw[key];
    const bag = propertyBag(raw);
    if (!bag) return void 0;
    if (bag[key] !== void 0) return bag[key];
    for (const alias of (_a5 = PROPERTY_ALIASES[key]) != null ? _a5 : []) {
      if (bag[alias] !== void 0) return bag[alias];
    }
    return void 0;
  }
  function propertyBag(raw) {
    const flat = raw["properties"];
    if (flat && typeof flat === "object") return flat;
    const entity = raw["graphEntity"];
    if (!entity || typeof entity !== "object") return null;
    const nested = entity["properties"];
    return nested && typeof nested === "object" ? nested : null;
  }
  var EDGE_TYPES = [
    "HAS_ISSUE",
    // asset → ISSUE
    "PROTECTED_BY",
    // AI_AGENT → AI_GUARDRAIL (negated = guardrail MISSING)
    "RUNS_AS",
    // AI_AGENT → SERVICE_ACCOUNT (execution identity)
    "ALLOWS_ACCESS_TO",
    // identity → resource (IAM; carries accessType)
    "HAS_FINDING",
    // identity → EXCESSIVE_ACCESS/LATERAL_MOVEMENT finding
    "USES",
    // generic dependency
    "USES_TOOL",
    // AI_AGENT → SERVERLESS / tool
    "INVOKES_TOOL",
    // AI_AGENT → MCP_SERVER / AI_AGENT
    "USES_MODEL",
    // AI_AGENT → AI_MODEL
    "USES_DATASET",
    // AI_AGENT → AI_DATASET
    "STORED_IN",
    // AI_DATASET → BUCKET
    "HOSTED_ON",
    // hosted AI_AGENT → VIRTUAL_MACHINE / SERVERLESS
    "BUILT_FROM",
    // AI_AGENT → CONTAINER_IMAGE → REPOSITORY
    "CAN_INVOKE",
    // ACCESS_ROLE → AI_MODEL (Bedrock)
    "ENFORCES",
    // AI_MODEL → AI_GUARDRAIL
    "BOUND_TO",
    // ACCESS_ROLE_BINDING → identity
    "PERMITS_ACCESS_ROLE",
    // ACCESS_ROLE_BINDING → ACCESS_ROLE
    "HAS_SENSITIVE_DATA",
    // asset → SENSITIVE_DATA (holds sensitive data)
    "HAS_ACCESS_TO_SENSITIVE_DATA",
    // identity/agent → SENSITIVE_DATA (can reach it)
    "EXPOSED_TO_INTERNET",
    // asset → INTERNET_EXPOSURE (reachable from the internet)
    "HAS_EXCESSIVE_PRIVILEGE",
    // asset/identity → EXCESSIVE_PRIVILEGE (admin or high rights)
    // BUCKET/DATABASE → DATA_FINDING. Wiz's own vocabulary, not ours: the tenant capture in
    // exemples/toxic_combos_response.js echoes control wc-id-3217's query, whose "Sensitive
    // Data Access" block ends `-HAS_DATA_FINDING→ DATA_FINDING`.
    "HAS_DATA_FINDING",
    // AI asset / compute → ENDPOINT. Wiz's own relationship name, kept verbatim — it is what
    // the endpoint-exposure traversal walks (domain/exposureQuery.ts).
    "SERVES"
  ];
  function edgeId(src, type, dst, negated) {
    return `${src}|${type}|${dst}${negated ? "|neg" : ""}`;
  }

  // src/domain/graphExpand.ts
  function typeList(t) {
    return Array.isArray(t) ? t : [t];
  }
  function isSelected(spec) {
    return spec.select !== false;
  }
  var AGENT_EXPANSION = {
    type: "AI_AGENT",
    relationships: [
      // 1. Execution identity and its CIEM findings.
      {
        type: "PRINCIPAL",
        optional: true,
        edge: { type: "ACTING_AS" },
        relationships: [
          {
            type: "EXCESSIVE_ACCESS_FINDING",
            optional: true,
            edge: { type: "CONTAINS" }
          }
        ]
      },
      // 2. Data the agent reads, and what has been classified in it.
      {
        type: ["AI_DATASET", "BUCKET"],
        optional: true,
        edge: { type: "READS_DATA_FROM" },
        relationships: [
          {
            type: ["BUCKET", "DATABASE"],
            optional: true,
            edge: { type: "READS_DATA_FROM" },
            relationships: [
              { type: "DATA_FINDING", optional: true, edge: { type: "HAS_DATA_FINDING" } }
            ]
          },
          { type: "DATA_FINDING", optional: true, edge: { type: "HAS_DATA_FINDING" } }
        ]
      },
      // 3. Data the agent writes.
      {
        type: "BUCKET",
        optional: true,
        edge: { type: "STORES_DATA_IN" },
        relationships: [
          { type: "DATA_FINDING", optional: true, edge: { type: "HAS_DATA_FINDING" } }
        ]
      },
      // 4. Tooling: the tool, whatever runs it, that runner's identity and reachable data,
      //    and any agent the tool invokes in turn. The INVOKES leg is the agent-to-agent
      //    trust chain ai/ai_agents_discovery_queries.md names as unmodeled.
      {
        type: "AI_TOOL",
        optional: true,
        edge: { type: "USES" },
        relationships: [
          {
            type: ["SERVERLESS", "WEB_SERVICE"],
            optional: true,
            edge: { type: "RUNS", reverse: true },
            relationships: [
              {
                type: "SERVICE_ACCOUNT",
                optional: true,
                edge: { type: "ACTING_AS" },
                relationships: [
                  {
                    // Not selected: the binding is the mechanism, the resource is the point.
                    type: "IAM_BINDING",
                    select: false,
                    optional: true,
                    edge: { type: "ENTITLES", reverse: true },
                    where: { accessTypes: { EQUALS: ["Data"] } },
                    relationships: [
                      {
                        type: "DATA_RESOURCE",
                        optional: true,
                        edge: { type: "ALLOWS_ACCESS_TO" },
                        where: {
                          _or: [
                            { publicAccessTypes: { IS_SET: false } },
                            { publicAccessTypes: { LIST_DOES_NOT_CONTAIN_ANY: ["Data"] } }
                          ],
                          hasSensitiveData: { EQUALS: true }
                        },
                        relationships: [
                          {
                            type: "DATA_FINDING",
                            optional: true,
                            edge: { type: "HAS_DATA_FINDING" },
                            where: {
                              severity: {
                                EQUALS: [
                                  "DataFindingSeverityCritical",
                                  "DataFindingSeverityHigh"
                                ]
                              }
                            }
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              { type: "PRINCIPAL", optional: true, edge: { type: "ACTING_AS" } },
              { type: "AI_AGENT", optional: true, edge: { type: "INVOKES" } }
            ]
          }
        ]
      },
      // 5. Models and services, their guardrails, endpoints, identities, and the pipeline
      //    that produced them.
      {
        type: ["AI_MODEL", "AI_SERVICE"],
        optional: true,
        edge: { type: "USES" },
        relationships: [
          {
            type: "AI_MODEL",
            optional: true,
            edge: { type: "USES" },
            relationships: [
              {
                type: "AI_GUARDRAIL",
                optional: true,
                edge: { type: "PROTECTS", reverse: true }
              },
              { type: "ENDPOINT", optional: true, edge: { type: "SERVES" } },
              {
                type: "PRINCIPAL",
                optional: true,
                edge: { type: "ACTING_AS" },
                relationships: [
                  {
                    type: "EXCESSIVE_ACCESS_FINDING",
                    optional: true,
                    edge: { type: "ALERTED_ON", reverse: true }
                  }
                ]
              }
            ]
          },
          {
            type: "AI_PIPELINE",
            optional: true,
            edge: { type: "PRODUCES", reverse: true },
            relationships: [
              { type: "AI_MODEL", optional: true, edge: { type: "USES" } },
              {
                type: ["AI_DATASET", "BUCKET"],
                optional: true,
                edge: { type: "READS_DATA_FROM" },
                relationships: [
                  {
                    type: ["BUCKET", "DATABASE"],
                    optional: true,
                    edge: { type: "READS_DATA_FROM" }
                  }
                ]
              }
            ]
          }
        ]
      },
      // 6. The agent's own guardrail and its misconfigurations.
      {
        type: "AI_GUARDRAIL",
        optional: true,
        edge: { type: "PROTECTS", reverse: true },
        relationships: [
          {
            type: "CONFIGURATION_FINDING",
            optional: true,
            edge: { type: "ALERTED_ON", reverse: true }
          }
        ]
      },
      // 7. Network reachability.
      { type: "ENDPOINT", optional: true, edge: { type: "SERVES" } },
      // 8. The agent's own configuration findings.
      {
        type: "CONFIGURATION_FINDING",
        optional: true,
        edge: { type: "ALERTED_ON", reverse: true }
      },
      // 9. Compute the agent runs on, that compute's identity and reachable data, and the
      //    kubernetes chain up to the cluster's own identity.
      {
        type: ["VIRTUAL_MACHINE", "SERVERLESS", "CONTAINER_IMAGE"],
        optional: true,
        edge: { type: "RUNS", reverse: true },
        relationships: [
          { type: "ENDPOINT", optional: true, edge: { type: "SERVES" } },
          {
            type: "SERVICE_ACCOUNT",
            optional: true,
            edge: { type: "ACTING_AS" },
            relationships: [
              {
                type: "IAM_BINDING",
                select: false,
                optional: true,
                edge: { type: "ENTITLES", reverse: true },
                where: { accessTypes: { EQUALS: ["Data"] } },
                relationships: [
                  {
                    type: "DATA_RESOURCE",
                    optional: true,
                    edge: { type: "ALLOWS_ACCESS_TO" },
                    where: {
                      _or: [
                        { publicAccessTypes: { IS_SET: false } },
                        { publicAccessTypes: { LIST_DOES_NOT_CONTAIN_ANY: ["Data"] } }
                      ],
                      hasSensitiveData: { EQUALS: true }
                    },
                    relationships: [
                      {
                        type: "DATA_FINDING",
                        optional: true,
                        edge: { type: "HAS_DATA_FINDING" },
                        where: {
                          severity: {
                            EQUALS: [
                              "DataFindingSeverityCritical",
                              "DataFindingSeverityHigh"
                            ]
                          }
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            type: "CONTAINER",
            optional: true,
            edge: { type: "INSTANCE_OF", reverse: true },
            relationships: [
              {
                type: "DEPLOYMENT",
                optional: true,
                edge: { type: "CONTAINS", reverse: true },
                relationships: [
                  {
                    type: "KUBERNETES_CLUSTER",
                    optional: true,
                    edge: { type: "CONTAINS", reverse: true },
                    relationships: [
                      {
                        type: "SERVICE_ACCOUNT",
                        optional: true,
                        edge: { type: "ACTING_AS" },
                        relationships: [
                          {
                            // Selected here, unlike the two above it. The console's own
                            // asymmetry, kept: dropping it would shift every later slot.
                            type: "IAM_BINDING",
                            optional: true,
                            edge: { type: "ENTITLES", reverse: true },
                            relationships: [
                              {
                                type: "DATA_RESOURCE",
                                optional: true,
                                edge: { type: "ALLOWS_ACCESS_TO" }
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      // 10. MCP servers and the tools they expose.
      {
        type: "MCP_SERVER",
        optional: true,
        edge: { type: "USES" },
        relationships: [
          { type: "AI_TOOL", optional: true, edge: { type: "EXPOSES" } }
        ]
      }
    ]
  };
  function toGraphEntityQuery(spec, vertexId) {
    var _a5;
    const out = { type: typeList(spec.type) };
    if (isSelected(spec)) out["select"] = true;
    const where = vertexId ? { _vertexID: { EQUALS: vertexId } } : spec.where;
    if (where) out["where"] = where;
    const rels = (_a5 = spec.relationships) != null ? _a5 : [];
    if (rels.length) {
      out["relationships"] = rels.map((child) => {
        var _a6;
        const edge2 = (_a6 = child.edge) != null ? _a6 : { type: "RELATED_TO" };
        const rel = {
          type: [edge2.reverse ? { type: edge2.type, reverse: true } : { type: edge2.type }],
          with: toGraphEntityQuery(child)
        };
        if (child.optional) rel["optional"] = true;
        if (child.negate) rel["negate"] = true;
        return rel;
      });
    }
    return out;
  }
  function flattenSlots(spec) {
    const slots = [];
    function walk(node2, parentIndex2) {
      var _a5, _b, _c;
      let ownIndex = parentIndex2;
      if (isSelected(node2)) {
        ownIndex = slots.length;
        slots.push({
          index: ownIndex,
          parentIndex: parentIndex2,
          types: typeList(node2.type),
          edgeType: (_a5 = node2.edge) == null ? void 0 : _a5.type,
          reverse: (_b = node2.edge) == null ? void 0 : _b.reverse
        });
      }
      for (const child of (_c = node2.relationships) != null ? _c : []) walk(child, ownIndex);
    }
    walk(spec, null);
    return slots;
  }
  function expandEdgeId(src, type, dst) {
    return `${src}|${type}|${dst}`;
  }
  function str2(v) {
    return v === null || v === void 0 || v === "" ? void 0 : String(v);
  }
  function triBool(v) {
    return v === true ? true : v === false ? false : null;
  }
  function toExpandedNode(raw) {
    var _a5;
    const id = str2(raw["id"]);
    if (!id) return null;
    const rawType = str2(raw["type"]);
    const known = kindFromWizType(rawType);
    const projects = Array.isArray(raw["projects"]) ? raw["projects"].map((p) => {
      var _a6;
      return (_a6 = str2(p == null ? void 0 : p["name"])) != null ? _a6 : "";
    }).filter(Boolean) : [];
    const pickStr = (key) => {
      var _a6;
      return (_a6 = str2(entityField(raw, key))) != null ? _a6 : null;
    };
    const isTrue = (key) => entityField(raw, key) === true;
    return {
      id,
      name: (_a5 = str2(raw["name"])) != null ? _a5 : id,
      kind: known != null ? known : rawType ? rawType.toUpperCase().replace(/[^A-Z0-9]+/g, "_") : "UNKNOWN",
      unmodeled: !known,
      nativeType: pickStr("nativeType"),
      cloud: pickStr("cloudPlatform"),
      region: pickStr("region"),
      status: pickStr("status"),
      firstSeen: pickStr("firstSeen"),
      lastSeen: pickStr("lastSeen"),
      externalId: pickStr("externalId"),
      projects,
      // DataFinding is the one entity here carrying its own severity; everything else is
      // inventory and gets its severity from the register, which this path does not touch.
      severity: pickStr("severity"),
      internet: triBool(entityField(raw, "isAccessibleFromInternet")),
      openInternet: triBool(entityField(raw, "isOpenToAllInternet")),
      sensitiveData: isTrue("hasSensitiveData"),
      sensitiveAccess: isTrue("hasAccessToSensitiveData"),
      highPriv: isTrue("hasHighPrivileges"),
      adminPriv: isTrue("hasAdminPrivileges")
    };
  }
  function decodeExpansion(slots, rows) {
    const nodes = /* @__PURE__ */ new Map();
    const edges2 = /* @__PURE__ */ new Map();
    let arityMismatches = 0;
    let rowsDecoded = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const entities = row == null ? void 0 : row["entities"];
      if (!Array.isArray(entities)) continue;
      if (entities.length !== slots.length) {
        arityMismatches += 1;
        continue;
      }
      rowsDecoded += 1;
      const resolved = [];
      for (let i = 0; i < slots.length; i += 1) {
        const raw = entities[i];
        const node2 = raw && typeof raw === "object" ? toExpandedNode(raw) : null;
        resolved.push(node2);
        if (node2 && !nodes.has(node2.id)) nodes.set(node2.id, node2);
      }
      for (const slot of slots) {
        const self = resolved[slot.index];
        if (!self || slot.parentIndex === null || !slot.edgeType) continue;
        const parent = resolved[slot.parentIndex];
        if (!parent || parent.id === self.id) continue;
        const src = slot.reverse ? self.id : parent.id;
        const dst = slot.reverse ? parent.id : self.id;
        const id = expandEdgeId(src, slot.edgeType, dst);
        if (!edges2.has(id)) edges2.set(id, { id, src, dst, type: slot.edgeType });
      }
    }
    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges2.values()),
      arityMismatches,
      rowsDecoded
    };
  }

  // src/domain/identityQuery.ts
  var HUMAN_ACCESS_TYPES = ["ADMIN", "HIGH_PRIVILEGE"];
  var BOUND_IDENTITY_KINDS = ["USER_ACCOUNT", "SERVICE_ACCOUNT"];
  function identityAccessSpec(types) {
    return {
      type: [...types],
      relationships: [
        {
          type: "ACCESS_ROLE_BINDING",
          select: false,
          edge: { type: "ALLOWS_ACCESS_TO", reverse: true },
          relationships: [
            {
              type: [...BOUND_IDENTITY_KINDS],
              edge: { type: "BOUND_TO" }
            },
            {
              type: "ACCESS_ROLE",
              edge: { type: "PERMITS_ACCESS_ROLE" },
              where: { accessType: { EQUALS: [...HUMAN_ACCESS_TYPES] } }
            }
          ]
        }
      ]
    };
  }
  function normalizeIdentityPurpose(v) {
    if (typeof v !== "string" || !v.trim()) return void 0;
    return v.trim().replace(/^IdentityPurpose/i, "").toUpperCase();
  }
  function normalizeAccessType(v) {
    if (typeof v !== "string" || !v.trim()) return void 0;
    const norm = v.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return HUMAN_ACCESS_TYPES.indexOf(norm) >= 0 ? norm : void 0;
  }

  // src/domain/toxicCombos.ts
  var CONDITION_KEYS = [
    "MISSING_GUARDRAIL",
    "EXCESSIVE_PRIVILEGE",
    "SENSITIVE_DATA",
    "INTERNET_EXPOSURE"
  ];
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
      conditions: ["MISSING_GUARDRAIL"],
      amplified: true,
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
      conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA"],
      amplified: true,
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
      conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA"],
      amplified: true,
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
      conditions: ["EXCESSIVE_PRIVILEGE"],
      amplified: true,
      frameworks: {
        owaspLlm: [],
        owaspAgentic: ["ASI03"],
        owaspMl: [],
        fiveRs: ["Reconfigure"]
      }
    }
  ];
  var OTHER_GROUP_ID = "other-ai-risk";
  var OTHER_AI_RISK = {
    id: OTHER_GROUP_ID,
    ruleId: "",
    title: "Other AI risk",
    shortLabel: "Other AI risk",
    nativeSeverity: "UNKNOWN",
    adjustedSeverity: "UNKNOWN",
    amplifierNote: "",
    namePattern: /(?!)/,
    // matches nothing: classifyIssue must never return this
    conditions: [],
    amplified: false,
    frameworks: { owaspLlm: [], owaspAgentic: [], owaspMl: [], fiveRs: [] }
  };
  var REGISTER_GROUPS = [...COMBO_GROUPS, OTHER_AI_RISK];
  var BY_RULE_ID = new Map(COMBO_GROUPS.map((g) => [g.ruleId, g]));
  var BY_GROUP_ID = new Map(REGISTER_GROUPS.map((g) => [g.id, g]));
  function comboGroupById(id) {
    var _a5;
    return (_a5 = BY_GROUP_ID.get(id)) != null ? _a5 : null;
  }
  function classifyIssue(issue2) {
    var _a5;
    if (issue2.sourceRuleId) {
      const byId = BY_RULE_ID.get(issue2.sourceRuleId);
      if (byId) return byId;
    }
    const name = (_a5 = issue2.ruleName) != null ? _a5 : "";
    if (name) {
      for (const g of COMBO_GROUPS) {
        if (g.namePattern.test(name)) return g;
      }
    }
    return null;
  }
  function registerBucketId(issue2) {
    var _a5;
    const id = (_a5 = issue2.comboGroup) != null ? _a5 : "";
    return BY_GROUP_ID.has(id) ? id : OTHER_GROUP_ID;
  }
  function comboSummary(issues2) {
    const acc = /* @__PURE__ */ new Map();
    for (const g of REGISTER_GROUPS) {
      acc.set(g.id, { count: 0, assetIds: [], seen: /* @__PURE__ */ new Set(), worst: "UNKNOWN" });
    }
    for (const issue2 of issues2) {
      if (!isUnresolvedIssue(issue2)) continue;
      const bucket = acc.get(registerBucketId(issue2));
      bucket.count += 1;
      if (severityRank(issue2.adjustedSeverity) < severityRank(bucket.worst)) {
        bucket.worst = issue2.adjustedSeverity;
      }
      if (issue2.assetId && !bucket.seen.has(issue2.assetId)) {
        bucket.seen.add(issue2.assetId);
        bucket.assetIds.push(issue2.assetId);
      }
    }
    return REGISTER_GROUPS.map((group) => {
      const bucket = acc.get(group.id);
      return {
        // A modelled pattern declares its severities and stands by them. The Other bucket
        // has no claim to make, so it reports the worst severity it actually holds —
        // otherwise a genuinely CRITICAL unclassified issue would sort to the bottom of a
        // triage page behind four MEDIUMs.
        group: group.amplified ? group : { ...group, nativeSeverity: bucket.worst, adjustedSeverity: bucket.worst },
        count: bucket.count,
        assetIds: bucket.assetIds
      };
    });
  }

  // src/server/wizQueriesAi.ts
  var PAGE_SIZE = 100;
  var PAGE_SIZE_FALLBACK = 50;
  var PAGE_SIZE_WIDE = 500;
  var PAGE_SIZE_TRAVERSAL = 250;
  var MAX_PAGES = 1e3;
  var IDENTITY_FIELDS = [
    "id",
    "name",
    "type"
  ];
  var CLOUD_RESOURCE_FIELDS = [
    "nativeType",
    "cloudPlatform",
    "region",
    "status",
    "firstSeen",
    "lastSeen",
    "externalId",
    "isAccessibleFromInternet",
    "isOpenToAllInternet",
    "hasSensitiveData",
    "hasAccessToSensitiveData",
    "hasAdminPrivileges",
    "hasHighPrivileges",
    "technology { id name categories { id name } }",
    "cloudAccount { id name externalId cloudProvider }",
    "projects { id name riskProfile { businessImpact } }",
    "tags { key value }"
  ];
  function indented(fields, spaces) {
    const pad = new Array(spaces + 1).join(" ");
    return fields.map((f) => pad + f + "\n").join("");
  }
  var RESOURCE_FIELDS = indented(IDENTITY_FIELDS, 6) + indented(CLOUD_RESOURCE_FIELDS, 6);
  var ENTITY_FIELDS = indented(IDENTITY_FIELDS, 8) + "        properties\n";
  function graphSearchQueryWith(name, queryBody, entityFields) {
    return "query " + name + "($quick: Boolean, $first: Int, $after: String) {\n  graphSearch(quick: $quick, first: $first, after: $after, query: {\n" + queryBody + "  }) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      entities {\n" + entityFields + "      }\n    }\n  }\n}\n";
  }
  function graphSearchQuery(name, queryBody) {
    return graphSearchQueryWith(name, queryBody, ENTITY_FIELDS);
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
  function aiFlavored(values) {
    return values.filter((v) => {
      const tokens = v.toUpperCase().split(/[\s_]+/);
      return tokens.includes("AI") || tokens.includes("MCP") || tokens.includes("GENAI") || tokens.includes("LLM");
    });
  }
  function chooseAiResourceTypes(enumValues, override) {
    if (override && override.length) return { types: override, source: "override", aiLooking: [] };
    if (!enumValues) {
      return { types: [...AI_RESOURCE_TYPE_CANDIDATES], source: "candidates", aiLooking: [] };
    }
    const present2 = new Set(enumValues);
    const aiLooking = aiFlavored(enumValues);
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
  var Q_AGENT_SENSITIVE_DATA_ACCESS = graphSearchQueryWith(
    "SidekickAiAgentSensitiveDataAccess",
    '    type: "AI_AGENT"\n    select: true\n    relationships: [{\n      type: "RUNS_AS"\n      with: {\n        type: "SERVICE_ACCOUNT"\n        select: true\n        relationships: [{\n          type: "ALLOWS_ACCESS_TO"\n          with: {\n            type: ["BUCKET", "DATABASE", "DATABASE_SERVER"]\n            select: true\n            where: { hasSensitiveData: { EQUALS: true } }\n            relationships: [{\n              type: "HAS_DATA_FINDING"\n              optional: true\n              with: { type: "DATA_FINDING", select: true }\n            }]\n          }\n        }]\n      }\n    }]\n',
    ENTITY_FIELDS
  );
  function graphSearchVarQuery(name) {
    return "query " + name + "($quick: Boolean, $first: Int, $after: String, $query: GraphEntityQueryInput, $projectId: String) {\n  graphSearch(\n    quick: $quick\n    first: $first\n    after: $after\n    query: $query\n    projectId: $projectId\n  ) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      entities {\n" + ENTITY_FIELDS + "      }\n    }\n  }\n}\n";
  }
  var Q_IDENTITY_ACCESS = graphSearchVarQuery("SidekickAiIdentitiesWithAssetAccess");
  function identityAccessVariables(types, scope) {
    return {
      query: toGraphEntityQuery(identityAccessSpec(types)),
      projectId: scope && scope.length ? scope[0] : null
    };
  }
  var Q_AGENT_EXPANSION = "query SidekickAiAgentExpansion($quick: Boolean, $first: Int, $after: String, $query: GraphEntityQueryInput, $projectId: String) {\n  graphSearch(\n    quick: $quick\n    first: $first\n    after: $after\n    query: $query\n    projectId: $projectId\n  ) {\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      entities {\n" + ENTITY_FIELDS + "      }\n    }\n  }\n}\n";
  var Q_AI_EXPOSURE = "query SidekickAiExposure($query: GraphEntityQueryInput, $controlId: ID, $projectId: String, $first: Int, $after: String, $fetchTotalCount: Boolean = false, $quick: Boolean = true, $fetchPublicExposurePaths: Boolean = false, $fetchInternalExposurePaths: Boolean = false, $fetchIssueAnalytics: Boolean = false, $fetchThreatAnalytics: Boolean = false, $fetchLateralMovement: Boolean = false, $fetchCodeSource: Boolean = false, $fetchKubernetes: Boolean = false, $fetchCost: Boolean = false, $issueId: ID) {\n  graphSearch(\n    query: $query\n    controlId: $controlId\n    projectId: $projectId\n    first: $first\n    after: $after\n    quick: $quick\n    issueId: $issueId\n  ) {\n    totalCount @include(if: $fetchTotalCount)\n    maxCountReached @include(if: $fetchTotalCount)\n    pageInfo { endCursor hasNextPage }\n    nodes {\n      entities {\n        providerUniqueId\n        deletedAt\n        isRestricted\n        ...PathGraphEntityFragment\n        userMetadata { isInWatchlist isIgnored note }\n        technologies { id icon }\n        cost(\n          filterBy: {timestamp: {inLast: {amount: 30, unit: DurationFilterValueUnitDays}}}\n        ) @include(if: $fetchCost) {\n          amortized\n          blended\n          unblended\n          netAmortized\n          netUnblended\n          currencyCode\n        }\n        costImpact @include(if: $fetchCost) { monthly }\n        publicExposures(first: 10) @include(if: $fetchPublicExposurePaths) {\n          nodes { ...NetworkExposureFragment }\n        }\n        otherSubscriptionExposures(first: 10) @include(if: $fetchInternalExposurePaths) {\n          nodes { ...NetworkExposureFragment }\n        }\n        otherVnetExposures(first: 10) @include(if: $fetchInternalExposurePaths) {\n          nodes { ...NetworkExposureFragment }\n        }\n        lateralMovementPaths(first: 10) @include(if: $fetchLateralMovement) {\n          nodes {\n            id\n            pathEntities { entity { providerUniqueId ...PathGraphEntityFragment } }\n          }\n        }\n        codeSourcePath(first: 10) @include(if: $fetchCodeSource) {\n          totalCount\n          nodes {\n            id\n            pathEntities { providerUniqueId ...PathGraphEntityFragment }\n          }\n        }\n        kubernetesPaths(first: 10) @include(if: $fetchKubernetes) {\n          nodes { id path { providerUniqueId ...PathGraphEntityFragment } }\n        }\n      }\n      aggregateCount\n    }\n  }\n}\n\nfragment PathGraphEntityFragment on GraphEntity {\n  providerUniqueId\n  id\n  name\n  type\n  properties\n  typedProperties { ... on GEAiAgent { description } }\n  issueAnalytics: issues(\n    filterBy: {status: [IN_PROGRESS, OPEN], type: [TOXIC_COMBINATION, CLOUD_CONFIGURATION]}\n  ) @include(if: $fetchIssueAnalytics) {\n    highSeverityCount\n    criticalSeverityCount\n  }\n  threatAnalytics: issues(\n    filterBy: {status: [IN_PROGRESS, OPEN], type: [THREAT_DETECTION], createdAt: {inLast: {amount: 7, unit: DurationFilterValueUnitDays}}}\n  ) @include(if: $fetchThreatAnalytics) {\n    highSeverityCount\n    criticalSeverityCount\n  }\n}\n\nfragment NetworkExposureFragment on NetworkExposure {\n  id\n  portRange\n  sourceIpRange\n  destinationIpRange\n  path { providerUniqueId ...PathGraphEntityFragment }\n  applicationEndpoints { providerUniqueId ...PathGraphEntityFragment }\n}\n";
  var EXPOSURE_FETCH_FLAGS = {
    fetchTotalCount: false,
    fetchPublicExposurePaths: true,
    fetchInternalExposurePaths: false,
    fetchIssueAnalytics: false,
    fetchThreatAnalytics: false,
    fetchLateralMovement: true,
    fetchCodeSource: true,
    fetchKubernetes: false,
    fetchCost: false
  };
  function hostExposureVariables(types, scope) {
    return {
      ...EXPOSURE_FETCH_FLAGS,
      query: toGraphEntityQuery(hostExposureSpec(types)),
      projectId: scope && scope.length ? scope[0] : null
    };
  }
  function endpointExposureVariables(types, scope) {
    return {
      ...EXPOSURE_FETCH_FLAGS,
      query: toGraphEntityQuery(endpointExposureSpec(types)),
      projectId: scope && scope.length ? scope[0] : null
    };
  }
  var Q_ISSUES = "query SidekickAiIssues($first: Int, $after: String, $filterBy: IssueFilters, $orderBy: IssueOrder) {\n  issuesV2(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      id\n      type\n      severity\n      status\n      createdAt\n      updatedAt\n      dueAt\n      resolvedAt\n      resolutionReason\n      resolutionNote\n      rejectionExpiredAt\n      validatedAsExploitable\n      environments\n      assignee { id name primaryEmail }\n      resolvedBy { user { id name email } serviceAccount { id name type } }\n      notes { id text }\n      serviceTickets { id externalId name url }\n      applicationServices { id displayName }\n      aiRemediationAnalysis { verdict recommendedSeverity }\n      projects { id name slug riskProfile { businessImpact } }\n      entitySnapshot {\n        id\n        type\n        status\n        name\n        cloudPlatform\n        region\n        subscriptionName\n        subscriptionId\n        subscriptionExternalId\n        nativeType\n        externalId\n        tags\n        kubernetesClusterName\n        kubernetesNamespaceName\n        resourceGroupId\n      }\n      sourceRules {\n        ... on Control {\n          id\n          name\n          description\n          severity\n          risks\n          threats\n          resolutionRecommendation\n        }\n        ... on CloudConfigurationRule {\n          id\n          name\n          description\n          risks\n          threats\n          control { resolutionRecommendation severity }\n        }\n        ... on CloudEventRule {\n          id\n          name\n          description\n          risks\n          threats\n        }\n      }\n    }\n  }\n}\n";
  function aiIssuesVariables(scope) {
    const filterBy = {
      status: ["OPEN", "IN_PROGRESS"],
      frameworkCategory: [RISK_CATEGORY_ID]
    };
    if (scope && scope.length) filterBy["project"] = scope;
    return { filterBy, orderBy: { field: "SEVERITY_EXPLOITABLE", direction: "DESC" } };
  }
  var Q_CONFIG_FINDINGS = "query SidekickAiConfigFindings($first: Int, $after: String, $filterBy: ConfigurationFindingFilters, $orderBy: ConfigurationFindingOrder) {\n  configurationFindings(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      id\n      name\n      deleted\n      analyzedAt\n      firstSeenAt\n      severity\n      result\n      status\n      remediation\n      source\n      targetExternalId\n      ignoreRules { id tags { key value } }\n      subscription {\n        id\n        name\n        externalId\n        cloudProvider\n        sourceDeployments { id name status }\n      }\n      resource {\n        id\n        name\n        type\n        status\n        projects { id name riskProfile { businessImpact } }\n      }\n      sourceMappedIacFindings { id name }\n      rule {\n        id\n        shortId\n        graphId\n        name\n        description\n        remediationInstructions\n        risks\n        threats\n        tags { key value }\n        opaPolicy\n      }\n    }\n  }\n}\n";
  function aiConfigFindingsVariables(scope) {
    const filterBy = {
      status: ["OPEN", "RESOLVED"],
      frameworkCategory: [RISK_CATEGORY_ID]
    };
    if (scope && scope.length) filterBy["resource"] = { projectId: scope };
    return { filterBy, orderBy: { field: "SEVERITY", direction: "DESC" } };
  }
  var Q_AI_PROPERTIES = "query SidekickAiAssetProperties($first: Int, $after: String, $filterBy: CloudResourceV2Filters) {\n  cloudResourcesV2(first: $first, after: $after, filterBy: $filterBy) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n" + indented(IDENTITY_FIELDS, 6) + "      graphEntity { properties }\n    }\n  }\n}\n";
  function aiPropertiesVariables(types) {
    return { filterBy: { type: { equals: [...types] } } };
  }
  var Q_PRINCIPALS = "query SidekickAiPrincipals($first: Int, $after: String, $filterBy: CloudResourceV2Filters, $orderBy: CloudResourceOrder) {\n  cloudResourcesV2(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      id\n      name\n      type\n      nativeType\n      hasSensitiveData\n      hasAccessToSensitiveData\n      hasAdminPrivileges\n      hasHighPrivileges\n      technology { id name categories { id name } }\n      cloudAccount { id name externalId cloudProvider }\n      projects { id name riskProfile { businessImpact } }\n      graphEntity { properties }\n      issueAnalytics {\n        issueCount\n        informationalSeverityCount\n        lowSeverityCount\n        mediumSeverityCount\n        highSeverityCount\n        criticalSeverityCount\n      }\n    }\n  }\n}\n";
  function aiPrincipalsVariables(scope) {
    const filterBy = {
      type: { equals: ["SERVICE_ACCOUNT", "ACCESS_KEY"] },
      identityPurpose: { equals: ["AGENTIC"] }
    };
    if (scope && scope.length) filterBy["projectId"] = scope;
    return { filterBy, orderBy: { field: "RELATED_ISSUE_SEVERITY", direction: "DESC" } };
  }
  var Q_CONFIG_RULES = "query SidekickAiConfigRules($first: Int, $after: String) {\n  cloudConfigurationRules(first: $first, after: $after) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      id\n      name\n      shortId\n      subjectEntityType\n      externalReferences { id name }\n    }\n  }\n}\n";
  function aiIdentityHygieneVariables(ruleIds, scope) {
    const filterBy = {
      status: ["OPEN"],
      rule: [...ruleIds]
    };
    if (scope && scope.length) filterBy["resource"] = { projectId: scope };
    return { filterBy, orderBy: { field: "SEVERITY", direction: "DESC" } };
  }
  var Q_EFFECTIVE_ACCESS = "query SidekickAiEffectiveAccess($first: Int, $after: String, $filterBy: EntityEffectiveAccessFilters) {\n  entityEffectiveAccessEntries(first: $first, after: $after, filterBy: $filterBy) {\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      grantedEntity: grantedEntityV2 { id name type }\n      accessibleResource: accessibleResourceV2 { id name type }\n      accessTypes\n      permissions\n      paths {\n        accessTypes\n        permissions\n        principalPolicies { policy { id name type } }\n        resourcePolicies { policy { id name type } }\n      }\n    }\n  }\n}\n";
  function effectiveAccessVariables(types, scope) {
    return { filterBy: effectiveAccessFilter(types, scope) };
  }
  var Q_SECURITY_FRAMEWORKS = "query SidekickAiSecurityFrameworks($first: Int, $after: String, $filterBy: SecurityFrameworkFilters) {\n  securityFrameworks(first: $first, after: $after, filterBy: $filterBy) {\n    totalCount\n    pageInfo { hasNextPage endCursor }\n    nodes {\n      id\n      name\n      description\n      builtin\n      enabled\n      policyTypes\n    }\n  }\n}\n";
  function aiSecurityFrameworksVariables() {
    return { filterBy: { enabled: true } };
  }
  var Q_COMPLIANCE_POSTURE = "query SidekickAiCompliancePosture($id: ID!, $analyticsSelection: SecurityFrameworkComplianceAnalyticsSelection, $orderBy: SecurityFrameworkSelectionOrder) {\n  securityFramework(id: $id) {\n    id\n    name\n    description\n    builtin\n    enabled\n    complianceAnalytics(selection: $analyticsSelection, orderBy: $orderBy) {\n      passSubCategoryCount\n      failSubCategoryCount\n      averageCompliancePosture\n      emptyPostureReason\n      categoryAnalytics {\n        category { id name description externalId }\n        passCount\n        failCount\n        passSubCategoryCount\n        failSubCategoryCount\n        averageCompliancePosture\n        emptyPostureReason\n        subCategoryAnalytics {\n          passCount\n          failCount\n          compliancePosture\n          emptyPostureReason\n          subCategory {\n            id\n            title\n            description\n            externalId\n            assessmentScope\n            mappingRationale\n            tags { key value }\n          }\n          policyAnalytics {\n            failCount\n            passCount\n            rejectedCount\n            assessedCount\n            noResourceToAsses\n            control {\n              id\n              name\n              description\n              enabled\n              builtin\n              severity\n              scopeQuery\n            }\n            cloudConfigurationRule {\n              id\n              name\n              description\n              shortId\n              enabled\n              builtin\n              severity\n              targetNativeType\n              subjectEntityType\n              hasAutoRemediation\n              cloudProvider\n            }\n            hostConfigurationRule {\n              id\n              name\n              shortName\n              description\n              enabled\n              builtin\n              severity\n            }\n          }\n        }\n      }\n    }\n  }\n}\n";
  function aiCompliancePostureVariables(scope) {
    const analyticsSelection = {};
    if (scope && scope.length) analyticsSelection["projectId"] = scope;
    return { analyticsSelection };
  }

  // src/server/wizClientAi.ts
  var WizQueryError = class extends Error {
  };
  var TOKEN_CACHE_KEY = "wiz_ai_token";
  function getToken(forceRefresh = false) {
    var _a5, _b;
    const staticToken = getProp(PROP_KEYS.wizApiToken);
    if (staticToken && staticToken.trim()) return staticToken.trim();
    const cache = CacheService.getScriptCache();
    if (!forceRefresh) {
      const cached2 = cache.get(TOKEN_CACHE_KEY);
      if (cached2) return cached2;
    }
    const authUrl = (_a5 = getProp(PROP_KEYS.wizAuthUrl)) != null ? _a5 : DEFAULT_WIZ_AUTH_URL;
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
        const ceiling = 1e3 * Math.pow(2, attempt);
        Utilities.sleep(Math.floor(ceiling / 2 + Math.random() * (ceiling / 2)));
        continue;
      }
      if (code !== 200) {
        const hint = code === 401 && getProp(PROP_KEYS.wizApiToken) ? " \u2014 WIZ_API_TOKEN was rejected; it may have expired. Refresh it, or set WIZ_CLIENT_ID/WIZ_CLIENT_SECRET for auto-refresh." : "";
        throw new WizQueryError(
          `Wiz query failed (HTTP ${code})${hint}: ${errorDigest(response.getContentText())}`
        );
      }
      const body = JSON.parse(response.getContentText());
      const data = body["data"];
      if (!data) {
        throw new WizQueryError(
          `Wiz response carried no data: ${errorDigest(response.getContentText())}`
        );
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
  var AI_TYPES_PROP_TTL_MS = 7 * 864e5;
  function readStoredAiTypes(now) {
    var _a5;
    const raw = getProp(PROP_KEYS.wizAiResourceTypesResolved);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.types) || !parsed.types.length) return null;
      if (!(now - Number(parsed.resolvedAt) < AI_TYPES_PROP_TTL_MS)) return null;
      return { types: parsed.types, source: parsed.source, aiLooking: (_a5 = parsed.aiLooking) != null ? _a5 : [] };
    } catch {
      return null;
    }
  }
  function writeStoredAiTypes(chosen, now) {
    try {
      setProp(
        PROP_KEYS.wizAiResourceTypesResolved,
        JSON.stringify({ ...chosen, resolvedAt: now })
      );
    } catch {
    }
  }
  var PROBE_SENTINEL = "AI_SIDEKICK_NEGATIVE_CONTROL";
  function probeOracleWorks(say) {
    try {
      fetchCloudResourcesPage({
        query: Q_AI_INVENTORY,
        first: 1,
        extraVariables: aiInventoryVariables([PROBE_SENTINEL])
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isInvalidEnumValueError(msg)) return true;
      throw e;
    }
    say(
      `  \u26A0 negative control (${PROBE_SENTINEL}) was ACCEPTED \u2014 this gateway does not reject unknown type values, so the per-candidate probe cannot tell which types this tenant really has. Every candidate below will read as accepted. Set WIZ_AI_RESOURCE_TYPES to the types you actually want queried.`
    );
    return false;
  }
  function probeCandidateTypes(candidates, say) {
    const verified = probeOracleWorks(say);
    const accepted = [];
    for (const t of candidates) {
      try {
        fetchCloudResourcesPage({
          query: Q_AI_INVENTORY,
          first: 1,
          extraVariables: aiInventoryVariables([t])
        });
        accepted.push(t);
        say(`  ${t}: accepted${verified ? "" : " (unverified \u2014 see the warning above)"}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isInvalidEnumValueError(msg)) {
          say(`  ${t}: not in this tenant's schema`);
          continue;
        }
        throw e;
      }
    }
    return { accepted, verified };
  }
  function resolveAiResourceTypes(log) {
    const say = log != null ? log : () => void 0;
    const overrideRaw = getProp(PROP_KEYS.wizAiResourceTypes);
    const override = overrideRaw ? overrideRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
    if (override && override.length) {
      say(`AI resource types: WIZ_AI_RESOURCE_TYPES override \u2014 ${override.join(", ")}.`);
      return { types: override, source: "override", aiLooking: [] };
    }
    const now = Date.now();
    const cache = CacheService.getScriptCache();
    if (!log) {
      const hit = cache.get(AI_TYPES_CACHE_KEY);
      if (hit) {
        try {
          return JSON.parse(hit);
        } catch {
        }
      }
      const stored = readStoredAiTypes(now);
      if (stored) {
        try {
          cache.put(AI_TYPES_CACHE_KEY, JSON.stringify(stored), 21600);
        } catch {
        }
        return stored;
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
      const { accepted, verified } = probeCandidateTypes(AI_RESOURCE_TYPE_CANDIDATES, say);
      if (!accepted.length) {
        throw new WizQueryError(
          "None of the candidate AI resource types (" + AI_RESOURCE_TYPE_CANDIDATES.join(", ") + ") exist in this tenant's CloudResourceTypeFilter enum, and introspection is unavailable. Find the tenant's AI type names (Wiz docs \u2192 GraphQL schema, or the Wiz UI's inventory filter) and set the WIZ_AI_RESOURCE_TYPES Script Property."
        );
      }
      chosen = {
        types: accepted,
        source: verified ? "probe" : "probe (unverified)",
        aiLooking: []
      };
    }
    say(`Inventory will query types (${chosen.source}): ${chosen.types.join(", ")}.`);
    try {
      cache.put(AI_TYPES_CACHE_KEY, JSON.stringify(chosen), 21600);
    } catch {
    }
    writeStoredAiTypes(chosen, now);
    return chosen;
  }
  var ERROR_BODY_MAX = 800;
  function errorDigest(text) {
    try {
      const parsed = JSON.parse(text);
      const errors = parsed["errors"];
      if (Array.isArray(errors) && errors.length) {
        const messages = errors.map((e) => {
          var _a5;
          return e && typeof e === "object" ? String((_a5 = e["message"]) != null ? _a5 : "") : "";
        }).filter(Boolean);
        if (messages.length) return messages.join(" | ").slice(0, ERROR_BODY_MAX);
      }
    } catch {
    }
    return String(text).slice(0, ERROR_BODY_MAX);
  }
  function readConnection(connection, field) {
    var _a5, _b, _c;
    if (!connection || typeof connection !== "object") {
      throw new WizQueryError(`Wiz response carried no ${field} connection.`);
    }
    const pageInfo = (_a5 = connection["pageInfo"]) != null ? _a5 : {};
    const rawTotal = connection["totalCount"];
    return {
      rows: (_b = connection["nodes"]) != null ? _b : [],
      hasNextPage: Boolean(pageInfo["hasNextPage"]),
      endCursor: (_c = pageInfo["endCursor"]) != null ? _c : null,
      totalCount: typeof rawTotal === "number" ? rawTotal : null
    };
  }
  function smallerPageCouldHelp(e) {
    if (!(e instanceof WizQueryError)) return true;
    const m = e.message;
    if (/HTTP 4\d\d/.test(m)) return false;
    if (/HTTP 429/.test(m)) return false;
    if (/carried no data/.test(m)) return false;
    if (/carried no .* connection/.test(m)) return false;
    return true;
  }
  function fetchPage(field, o, extra) {
    var _a5;
    const run2 = (first2) => {
      var _a6, _b;
      return readConnection(
        gqlPost(o.query, {
          ...extra != null ? extra : {},
          first: first2,
          after: (_a6 = o.cursor) != null ? _a6 : null,
          ...(_b = o.extraVariables) != null ? _b : {}
        })[field],
        field
      );
    };
    const first = (_a5 = o.first) != null ? _a5 : PAGE_SIZE;
    try {
      return run2(first);
    } catch (e) {
      if (!smallerPageCouldHelp(e)) throw e;
      if (first <= PAGE_SIZE_FALLBACK) throw e;
      return run2(PAGE_SIZE_FALLBACK);
    }
  }
  function fetchCloudResourcesPage(o) {
    return fetchPage("cloudResourcesV2", o);
  }
  function fetchConnectionPage(field, o) {
    return fetchPage(field, o);
  }
  function fetchGraphSearchPage(o) {
    return fetchPage("graphSearch", o, { quick: true });
  }
  function fetchSingleObject(field, o) {
    var _a5;
    const obj = gqlPost(o.query, { ...(_a5 = o.extraVariables) != null ? _a5 : {} })[field];
    if (!obj || typeof obj !== "object") {
      throw new WizQueryError(`Wiz response carried no ${field} object.`);
    }
    return { rows: [obj], hasNextPage: false, endCursor: null, totalCount: 1 };
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
    var _a5;
    const lines = [];
    const log = (m) => {
      lines.push(m);
      console.log(m);
    };
    const apiUrl = getProp(PROP_KEYS.wizApiUrl);
    const authUrl = (_a5 = getProp(PROP_KEYS.wizAuthUrl)) != null ? _a5 : DEFAULT_WIZ_AUTH_URL;
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
  function aarsDiagnostic() {
    const lines = [];
    const log = (m) => {
      lines.push(m);
      console.log(m);
    };
    log("=== AARS ledger diagnostic ===");
    try {
      const rows = readAll(TABS.assets);
      log(`ai_assets rows: ${rows.length}`);
      if (!rows.length) {
        log("The assets tab is empty \u2014 run a sync first.");
      } else {
        const cols = Object.keys(rows[0]);
        const has = (c) => cols.indexOf(c) >= 0 ? "present" : "MISSING";
        log(`column aars:          ${has("aars")}`);
        log(`column aars_severity: ${has("aars_severity")}`);
        log(`column aars_band:     ${has("aars_band")} (pre-rename name; harmless if present)`);
        const scored = rows.filter((r) => r["aars"] !== null && r["aars"] !== void 0).length;
        const sev = rows.filter((r) => r["aars_severity"] || r["aars_band"]).length;
        log(`rows with a score:    ${scored} of ${rows.length}`);
        log(`rows with a severity: ${sev} of ${rows.length}`);
        if (scored && !sev) {
          log("\u2192 Scores survived but severities did not: the tab was written by a build whose schema had a column this sheet lacks. Deploy a build that adds missing headers on write, then run one sync.");
        }
      }
    } catch (e) {
      log(`ai_assets unreadable: ${String(e instanceof Error ? e.message : e)}`);
    }
    try {
      const snap = readGraphSnapshot();
      if (!snap) log("Drive snapshot: none (the graph falls back to the tabs)");
      else {
        const scored = snap.nodes.filter((n) => {
          var _a5;
          return ((_a5 = n.aars) != null ? _a5 : null) !== null;
        }).length;
        const sev = snap.nodes.filter(
          (n) => n.aarsSeverity || n.aarsBand
        ).length;
        log(`Drive snapshot: ${snap.nodes.length} nodes, ${scored} scored, ${sev} with a severity`);
      }
    } catch (e) {
      log(`Drive snapshot unreadable: ${String(e instanceof Error ? e.message : e)}`);
    }
    log("=== end ===");
    return lines.join("\n");
  }

  // src/server/api.ts
  var api_exports = {};
  __export(api_exports, {
    bootstrap: () => bootstrap,
    cancelSync: () => cancelSync2,
    expandAsset: () => expandAsset,
    getAarsRule: () => getAarsRule3,
    getAssetDetail: () => getAssetDetail,
    getAssetOptions: () => getAssetOptions,
    getAssets: () => getAssets,
    getCompliance: () => getCompliance,
    getConfigFindingDetail: () => getConfigFindingDetail,
    getConfigFindings: () => getConfigFindings,
    getGraph: () => getGraph,
    getIssueDetail: () => getIssueDetail,
    getIssues: () => getIssues,
    getJobStatus: () => getJobStatus,
    getQueryVocabulary: () => getQueryVocabulary,
    getScanQueries: () => getScanQueries,
    getSettings: () => getSettings,
    getStorageStats: () => getStorageStats,
    getSyncHistory: () => getSyncHistory,
    getToxicCombos: () => getToxicCombos,
    previewAarsRule: () => previewAarsRule,
    rescoreAars: () => rescoreAars,
    resetData: () => resetData2,
    runGraphQuery: () => runGraphQuery,
    runSync: () => runSync,
    scoreAarsSample: () => scoreAarsSample,
    setAarsRule: () => setAarsRule2,
    setScanVars: () => setScanVars2,
    setSelectedFrameworks: () => setSelectedFrameworks2,
    setSettings: () => setSettings,
    testScanVars: () => testScanVars
  });

  // src/domain/assetTable.ts
  var ASSET_SORTS = [
    "aars",
    "name",
    "kind",
    "cloud",
    "region",
    "severity",
    "combos"
  ];
  var DEFAULT_SORT_DIR = {
    aars: "desc",
    severity: "desc",
    combos: "desc",
    name: "asc",
    kind: "asc",
    cloud: "asc",
    region: "asc"
  };
  var DEFAULT_PAGE_SIZE = 50;
  var MAX_PAGE_SIZE = 500;
  var CLIENT_ALL_MAX = 1500;
  var FACET_KEYS = [
    "aarsSeverities",
    "severities",
    "kinds",
    "clouds",
    "regions",
    "projects",
    "flags"
  ];
  var ASSET_FLAGS = ["combo", "guardrail", "agentic", "datafindings"];
  function score(v) {
    const n = Number(v != null ? v : -1);
    return Number.isFinite(n) ? n : -1;
  }
  var SEV_RANK = {};
  SEVERITY_ORDER.forEach((sev, i) => {
    SEV_RANK[sev] = SEVERITY_ORDER.length - i;
  });
  function sevRank(v) {
    var _a5;
    return (_a5 = SEV_RANK[toStr(v).toUpperCase()]) != null ? _a5 : -1;
  }
  function list(v) {
    const raw = Array.isArray(v) ? v : toStr(v).split(",");
    const out = [];
    for (const item of raw) {
      const s = toStr(item).trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  }
  function listWithLegacy(...sources) {
    for (const src of sources) {
      const parsed = list(src);
      if (parsed.length) return parsed;
    }
    return [];
  }
  function keepValid(values, allowed) {
    return values.map((v) => v.toUpperCase()).filter((v) => allowed.indexOf(v) >= 0);
  }
  function resolveAssetQuery(params) {
    const sort = toStr(params["sort"]);
    const resolvedSort = ASSET_SORTS.indexOf(sort) >= 0 ? sort : "aars";
    const dir = toStr(params["dir"]).toLowerCase();
    const page = Number(params["page"]);
    const pageSize = Number(params["pageSize"]);
    const aarsSeverities = listWithLegacy(
      params["aarsSeverities"],
      params["aarsSeverity"],
      params["band"]
    ).map((v) => {
      var _a5;
      return (_a5 = normalizeAarsSeverity(v)) != null ? _a5 : "";
    }).filter((v, i, all) => v !== "" && all.indexOf(v) === i);
    return {
      q: toStr(params["q"]).trim().toLowerCase(),
      aarsSeverities,
      severities: keepValid(
        listWithLegacy(params["severities"], params["severity"]),
        SEVERITY_ORDER
      ),
      kinds: listWithLegacy(params["kinds"], params["kind"]),
      clouds: listWithLegacy(params["clouds"], params["cloud"]),
      regions: listWithLegacy(params["regions"], params["region"]),
      projects: listWithLegacy(params["projects"], params["project"]),
      flags: list(params["flags"]).map((v) => v.toLowerCase()).filter((v) => ASSET_FLAGS.indexOf(v) >= 0),
      sort: resolvedSort,
      dir: dir === "asc" || dir === "desc" ? dir : DEFAULT_SORT_DIR[resolvedSort],
      page: Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0,
      pageSize: Number.isFinite(pageSize) && pageSize >= 1 ? Math.min(Math.floor(pageSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE
    };
  }
  function hasAssetFlag(row, flag) {
    if (flag === "combo") return toNum(row["combos"]) > 0;
    if (flag === "guardrail") return row["guardrailMissing"] === true;
    if (flag === "agentic") return row["agentic"] === true;
    if (flag === "datafindings") return toNum(row["dataFindings"]) > 0;
    return false;
  }
  function rowProjects(row) {
    const v = row["projects"];
    return Array.isArray(v) ? v.map((v2) => toStr(v2)).filter(Boolean) : [];
  }
  function matchesAssetQuery(row, q) {
    if (q.q && !toStr(row["name"]).toLowerCase().includes(q.q)) return false;
    if (q.kinds.length && q.kinds.indexOf(toStr(row["kind"])) < 0) return false;
    if (q.clouds.length && q.clouds.indexOf(toStr(row["cloud"])) < 0) return false;
    if (q.regions.length && q.regions.indexOf(toStr(row["region"])) < 0) return false;
    if (q.aarsSeverities.length && q.aarsSeverities.indexOf(toStr(row["aarsSeverity"])) < 0) {
      return false;
    }
    if (q.severities.length && q.severities.indexOf(toStr(row["severity"])) < 0) return false;
    if (q.projects.length) {
      const mine = rowProjects(row);
      if (!q.projects.some((p) => mine.indexOf(p) >= 0)) return false;
    }
    if (q.flags.length && !q.flags.every((f) => hasAssetFlag(row, f))) return false;
    return true;
  }
  function filterAssetRows(rows, q) {
    return rows.filter((r) => matchesAssetQuery(r, q));
  }
  var PRIMARY = {
    aars: (a, b) => score(a["aars"]) - score(b["aars"]),
    name: (a, b) => toStr(a["name"]).localeCompare(toStr(b["name"])),
    kind: (a, b) => toStr(a["kind"]).localeCompare(toStr(b["kind"])),
    cloud: (a, b) => toStr(a["cloud"]).localeCompare(toStr(b["cloud"])),
    region: (a, b) => toStr(a["region"]).localeCompare(toStr(b["region"])),
    severity: (a, b) => sevRank(a["severity"]) - sevRank(b["severity"]),
    combos: (a, b) => toNum(a["combos"]) - toNum(b["combos"])
  };
  var byScoreDesc = (a, b) => score(b["aars"]) - score(a["aars"]);
  function assetComparator(sort, dir) {
    var _a5;
    const primary = (_a5 = PRIMARY[sort]) != null ? _a5 : PRIMARY.aars;
    const sign = dir === "desc" ? -1 : 1;
    return (a, b) => sign * primary(a, b) || byScoreDesc(a, b);
  }
  var ASSET_COMPARATORS = ASSET_SORTS.reduce((acc, s) => {
    acc[s] = assetComparator(s, DEFAULT_SORT_DIR[s]);
    return acc;
  }, {});
  function sortAssetRows(rows, sort, dir) {
    const resolved = ASSET_SORTS.indexOf(sort) >= 0 ? sort : "aars";
    return [...rows].sort(assetComparator(resolved, dir != null ? dir : DEFAULT_SORT_DIR[resolved]));
  }
  function facetValues(key, row) {
    if (key === "kinds") return [toStr(row["kind"])].filter(Boolean);
    if (key === "clouds") return [toStr(row["cloud"])].filter(Boolean);
    if (key === "regions") return [toStr(row["region"])].filter(Boolean);
    if (key === "aarsSeverities") return [toStr(row["aarsSeverity"])].filter(Boolean);
    if (key === "severities") return [toStr(row["severity"])].filter(Boolean);
    if (key === "projects") return rowProjects(row);
    return ASSET_FLAGS.filter((f) => hasAssetFlag(row, f));
  }
  function facetSorter(key) {
    if (key === "aarsSeverities") {
      const order = AARS_SEVERITY_ORDER;
      return (a, b) => order.indexOf(a.value) - order.indexOf(b.value);
    }
    if (key === "severities") {
      const order = SEVERITY_ORDER;
      return (a, b) => order.indexOf(a.value) - order.indexOf(b.value);
    }
    if (key === "flags") {
      const order = ASSET_FLAGS;
      return (a, b) => order.indexOf(a.value) - order.indexOf(b.value);
    }
    return (a, b) => a.value.localeCompare(b.value);
  }
  function facetCounts(rows, q) {
    var _a5;
    const out = { matched: 0 };
    for (const key of FACET_KEYS) {
      const scope = key === "flags" ? q : { ...q, [key]: [] };
      const counts = /* @__PURE__ */ new Map();
      for (const row of rows) {
        if (!matchesAssetQuery(row, scope)) continue;
        for (const value of facetValues(key, row)) {
          counts.set(value, ((_a5 = counts.get(value)) != null ? _a5 : 0) + 1);
        }
      }
      for (const value of q[key]) if (!counts.has(value)) counts.set(value, 0);
      out[key] = Array.from(counts, ([value, count2]) => ({ value, count: count2 })).sort(facetSorter(key));
    }
    out.matched = rows.reduce((n, row) => matchesAssetQuery(row, q) ? n + 1 : n, 0);
    return out;
  }
  function pageOf(rows, page, pageSize) {
    const size = Math.max(1, Math.floor(pageSize));
    const pageCount = Math.max(1, Math.ceil(rows.length / size));
    const clamped = Math.min(Math.max(Math.floor(page) || 0, 0), pageCount - 1);
    return {
      rows: rows.slice(clamped * size, (clamped + 1) * size),
      page: clamped,
      pageCount
    };
  }

  // src/domain/aars.ts
  var DEFAULT_AARS_RULE = {
    severityPoints: { CRITICAL: 50, HIGH: 35, MEDIUM: 20, LOW: 8 },
    multiIssueMultiplier: 1.2,
    multiIssueScaling: "flat",
    pillarACap: 50,
    gapPoints: [
      { match: "exact", code: "NO_GUARDRAIL", points: 10 },
      { match: "exact", code: "DEPRECATED_MODEL", points: 5 },
      { match: "exact", code: "LLM04", points: 5 },
      { match: "exact", code: "LLM05", points: 5 },
      { match: "prefix", code: "LLM", points: 10 },
      { match: "prefix", code: "ASI", points: 10 },
      { match: "prefix", code: "ML", points: 5 },
      { match: "exact", code: "FIVE_RS", points: 5 },
      { match: "prefix", code: "5R", points: 5 }
    ],
    gapFallbackPoints: 5,
    gapAggregation: "sum",
    // Off: switching any of these on adds gaps the doc's applied table never priced.
    gapSources: {
      fiveRs: false,
      deprecatedModel: false,
      inactiveAgent: false,
      frameworkMapping: false
    },
    // All 1: the spec reads a failing control as present-or-absent, never as more or less
    // severe. Kept as a knob because ai_findings.severity is already persisted and unused.
    findingSeverityWeights: { CRITICAL: 1, HIGH: 1, MEDIUM: 1, LOW: 1 },
    pillarBCap: 30,
    dataExposurePoints: { SENSITIVE: 20, DATA_ACCESS: 10, NONE: 0 },
    // 5Rs framework at 53% — data-exposure controls are systemically weak, so all
    // data-related points are amplified (ai/custom_score.md Pillar C).
    dataAmplifier: 1.1,
    // OFF: every point zero, so the term contributes nothing and pillar C is arithmetically
    // what it has always been. ai/custom_score.md's applied 14-row table — which pins
    // test/aars.test.ts — therefore keeps passing untouched. Sixth knob to follow that
    // convention, after multiIssueScaling, gapAggregation, gapSources, findingSeverityWeights
    // and exposurePoints.
    dataFindingPoints: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    dataFindingScaling: "flat",
    dataFindingMultiplier: 1,
    // 22 = the old implicit ceiling (20 × 1.1), so naming it changes no score.
    pillarCCap: 22,
    // Pillar D is OFF in the spec rule. The doc reports internet exposure beside the score
    // but never adds it to one, so scoring it here would change every published number.
    exposurePoints: { CONFIRMED: 0, UNDETERMINED: 0, NONE: 0 },
    bands: { critical: 70, high: 50, medium: 30, low: 10 }
  };
  var AARS_V2_RULE = {
    severityPoints: { CRITICAL: 40, HIGH: 28, MEDIUM: 16, LOW: 6 },
    multiIssueMultiplier: 1.2,
    multiIssueScaling: "log2",
    pillarACap: 45,
    gapPoints: [
      { match: "exact", code: "NO_GUARDRAIL", points: 10 },
      { match: "exact", code: "INACTIVE_AGENT", points: 10 },
      { match: "exact", code: "DEPRECATED_MODEL", points: 5 },
      { match: "exact", code: "LLM04", points: 5 },
      { match: "exact", code: "LLM05", points: 5 },
      { match: "prefix", code: "LLM", points: 10 },
      { match: "prefix", code: "ASI", points: 10 },
      { match: "prefix", code: "ML", points: 5 },
      { match: "exact", code: "FIVE_RS", points: 5 },
      { match: "prefix", code: "5R", points: 5 }
    ],
    gapFallbackPoints: 5,
    gapAggregation: "rss",
    // frameworkMapping stays OFF even here, where every other dormant source is on. Two
    // reasons, and neither is timidity: ai/AARS_ASSESSMENT.md calibrated this preset before
    // posture was collected at all, so switching it on would make the preset differ from the
    // measurement that justifies its numbers; and its effect is DATA-DEPENDENT — it does
    // nothing until a posture sync has run, then changes scores — so a preset carrying it
    // would silently re-score an estate on the strength of an unrelated sync finishing.
    // It is switched on deliberately, through the Rules page, with the same preview.
    gapSources: {
      fiveRs: true,
      deprecatedModel: true,
      inactiveAgent: true,
      frameworkMapping: false
    },
    findingSeverityWeights: { CRITICAL: 1.5, HIGH: 1.2, MEDIUM: 1, LOW: 0.6 },
    pillarBCap: 25,
    // Split, so the pillar takes more than two values. Reaching sensitive data is worth 6 —
    // half what it was, because it is what most of the estate shares — and what you reach is
    // worth up to 6 more. An asset with one MEDIUM finding scores 6+2=8; one with three
    // CRITICALs scores 6+7=13, clamped to the 12 cap. Two values become five.
    dataExposurePoints: { SENSITIVE: 6, DATA_ACCESS: 3, NONE: 0 },
    dataAmplifier: 1,
    dataFindingPoints: { CRITICAL: 6, HIGH: 4, MEDIUM: 2, LOW: 1 },
    dataFindingScaling: "log2",
    dataFindingMultiplier: 1.2,
    pillarCCap: 12,
    exposurePoints: { CONFIRMED: 18, UNDETERMINED: 7, NONE: 0 },
    bands: { critical: 70, high: 50, medium: 30, low: 10 }
  };
  var AARS_MAX_SCORE = 100;
  function gapPointsFor(code, rule = DEFAULT_AARS_RULE) {
    const c = String(code != null ? code : "").trim().toUpperCase();
    for (const row of rule.gapPoints) {
      const hit = row.match === "exact" ? c === row.code : c.startsWith(row.code);
      if (hit) return row.points;
    }
    return rule.gapFallbackPoints;
  }
  function gap(code, points) {
    return points === void 0 ? { code } : { code, points };
  }
  function aarsSeverity(score2, bands = DEFAULT_AARS_RULE.bands) {
    if (score2 >= bands.critical) return "CRITICAL";
    if (score2 >= bands.high) return "HIGH";
    if (score2 >= bands.medium) return "MEDIUM";
    if (score2 >= bands.low) return "LOW";
    return "INFO";
  }
  function worstPoints(severities, points) {
    var _a5;
    let worst = 0;
    for (const s of severities) {
      const p = (_a5 = points[s]) != null ? _a5 : 0;
      if (p > worst) worst = p;
    }
    return worst;
  }
  function worstSeverityPoints(severities, rule) {
    return worstPoints(severities, rule.severityPoints);
  }
  function countFactor(count2, scaling, multiplier) {
    if (count2 <= 1) return 1;
    if (scaling === "log2") return 1 + (multiplier - 1) * Math.log2(count2);
    return multiplier;
  }
  function multiIssueFactor(count2, rule) {
    return countFactor(count2, rule.multiIssueScaling, rule.multiIssueMultiplier);
  }
  function dataFindingPointsFor(severities, rule) {
    if (!severities.length) return 0;
    return Math.round(
      worstPoints(severities, rule.dataFindingPoints) * countFactor(severities.length, rule.dataFindingScaling, rule.dataFindingMultiplier)
    );
  }
  function aggregateGapPoints(points, rule) {
    if (rule.gapAggregation === "rss") {
      return Math.round(Math.sqrt(points.reduce((acc, p) => acc + p * p, 0)));
    }
    return points.reduce((acc, p) => acc + p, 0);
  }
  function computeAars(input, rule = DEFAULT_AARS_RULE) {
    var _a5, _b, _c, _d;
    let toxic = worstSeverityPoints(input.issueSeverities, rule);
    toxic *= multiIssueFactor(input.issueSeverities.length, rule);
    toxic = Math.min(rule.pillarACap, Math.round(toxic));
    const compliance = Math.min(
      rule.pillarBCap,
      aggregateGapPoints(
        input.gaps.map((g) => {
          var _a6;
          return (_a6 = g.points) != null ? _a6 : gapPointsFor(g.code, rule);
        }),
        rule
      )
    );
    const dataTier = (_a5 = rule.dataExposurePoints[input.dataExposure]) != null ? _a5 : 0;
    const dataFound = dataFindingPointsFor((_b = input.dataFindingSeverities) != null ? _b : [], rule);
    const data = Math.min(rule.pillarCCap, Math.round((dataTier + dataFound) * rule.dataAmplifier));
    const exposure = (_d = rule.exposurePoints[(_c = input.internetExposure) != null ? _c : "NONE"]) != null ? _d : 0;
    const score2 = Math.min(AARS_MAX_SCORE, toxic + compliance + data + exposure);
    return {
      score: score2,
      severity: aarsSeverity(score2, rule.bands),
      pillars: { toxic, compliance, data, exposure }
    };
  }
  function gapBreakdown(gaps, rule = DEFAULT_AARS_RULE) {
    return gaps.map((g) => {
      var _a5;
      return {
        code: g.code,
        points: (_a5 = g.points) != null ? _a5 : gapPointsFor(g.code, rule),
        overridden: g.points !== void 0
      };
    });
  }

  // src/domain/aarsRule.ts
  var POINTS_MIN = 0;
  var POINTS_MAX = 100;
  var MULTIPLIER_MIN = 1;
  var MULTIPLIER_MAX = 3;
  var WEIGHT_MIN = 0;
  var WEIGHT_MAX = 3;
  var BAND_MIN = 1;
  var BAND_MAX = 100;
  var CODE_MAX_LEN = 64;
  var MAX_GAP_RULES = 60;
  var SEVERITY_KEYS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  var EXPOSURE_KEYS = ["SENSITIVE", "DATA_ACCESS", "NONE"];
  var INTERNET_EXPOSURE_KEYS = ["CONFIRMED", "UNDETERMINED", "NONE"];
  var BAND_KEYS = ["critical", "high", "medium", "low"];
  var BAND_LABELS = {
    critical: "CRITICAL",
    high: "HIGH",
    medium: "MEDIUM",
    low: "LOW"
  };
  function rec(v) {
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }
  function clampMultiplier(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.round(n * 100) / 100;
    return Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, rounded));
  }
  function clampWeight(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    const rounded = Math.round(n * 100) / 100;
    return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, rounded));
  }
  function cleanGapCode(v) {
    return String(v != null ? v : "").trim().toUpperCase().slice(0, CODE_MAX_LEN);
  }
  function cleanGapRule(v) {
    const raw = rec(v);
    const code = cleanGapCode(raw["code"]);
    if (!code) return null;
    const match = raw["match"] === "prefix" ? "prefix" : "exact";
    return { match, code, points: clampInt(raw["points"], 0, POINTS_MIN, POINTS_MAX) };
  }
  function cleanAarsRule(raw) {
    const r = rec(raw);
    const sevRaw = rec(r["severityPoints"]);
    const severityPoints = {};
    for (const k of SEVERITY_KEYS) {
      severityPoints[k] = clampInt(sevRaw[k], DEFAULT_AARS_RULE.severityPoints[k], POINTS_MIN, POINTS_MAX);
    }
    const expRaw = rec(r["dataExposurePoints"]);
    const dataExposurePoints = {};
    for (const k of EXPOSURE_KEYS) {
      dataExposurePoints[k] = clampInt(
        expRaw[k],
        DEFAULT_AARS_RULE.dataExposurePoints[k],
        POINTS_MIN,
        POINTS_MAX
      );
    }
    const srcRaw = rec(r["gapSources"]);
    const gapSources = {
      fiveRs: srcRaw["fiveRs"] === true,
      deprecatedModel: srcRaw["deprecatedModel"] === true,
      inactiveAgent: srcRaw["inactiveAgent"] === true,
      frameworkMapping: srcRaw["frameworkMapping"] === true
    };
    const fswRaw = rec(r["findingSeverityWeights"]);
    const findingSeverityWeights = {};
    for (const k of SEVERITY_KEYS) {
      findingSeverityWeights[k] = clampWeight(
        fswRaw[k],
        DEFAULT_AARS_RULE.findingSeverityWeights[k]
      );
    }
    const dfpRaw = rec(r["dataFindingPoints"]);
    const dataFindingPoints = {};
    for (const k of SEVERITY_KEYS) {
      dataFindingPoints[k] = clampInt(
        dfpRaw[k],
        DEFAULT_AARS_RULE.dataFindingPoints[k],
        POINTS_MIN,
        POINTS_MAX
      );
    }
    const expoRaw = rec(r["exposurePoints"]);
    const exposurePoints = {};
    for (const k of INTERNET_EXPOSURE_KEYS) {
      exposurePoints[k] = clampInt(
        expoRaw[k],
        DEFAULT_AARS_RULE.exposurePoints[k],
        POINTS_MIN,
        POINTS_MAX
      );
    }
    const bandRaw = rec(r["bands"]);
    const bands = {};
    for (const k of BAND_KEYS) {
      bands[k] = clampInt(bandRaw[k], DEFAULT_AARS_RULE.bands[k], BAND_MIN, BAND_MAX);
    }
    const gapsRaw = Array.isArray(r["gapPoints"]) ? r["gapPoints"] : null;
    const gapPoints = gapsRaw ? gapsRaw.map(cleanGapRule).filter((g) => g !== null).slice(0, MAX_GAP_RULES) : DEFAULT_AARS_RULE.gapPoints.map((g) => ({ ...g }));
    const multiIssueScaling = r["multiIssueScaling"] === "log2" ? "log2" : "flat";
    const gapAggregation = r["gapAggregation"] === "rss" ? "rss" : "sum";
    const dataFindingScaling = r["dataFindingScaling"] === "log2" ? "log2" : "flat";
    return {
      severityPoints,
      multiIssueMultiplier: clampMultiplier(
        r["multiIssueMultiplier"],
        DEFAULT_AARS_RULE.multiIssueMultiplier
      ),
      multiIssueScaling,
      pillarACap: clampInt(r["pillarACap"], DEFAULT_AARS_RULE.pillarACap, POINTS_MIN, POINTS_MAX),
      gapPoints,
      gapFallbackPoints: clampInt(
        r["gapFallbackPoints"],
        DEFAULT_AARS_RULE.gapFallbackPoints,
        POINTS_MIN,
        POINTS_MAX
      ),
      gapAggregation,
      gapSources,
      findingSeverityWeights,
      pillarBCap: clampInt(r["pillarBCap"], DEFAULT_AARS_RULE.pillarBCap, POINTS_MIN, POINTS_MAX),
      dataExposurePoints,
      dataAmplifier: clampMultiplier(r["dataAmplifier"], DEFAULT_AARS_RULE.dataAmplifier),
      dataFindingPoints,
      dataFindingScaling,
      dataFindingMultiplier: clampMultiplier(
        r["dataFindingMultiplier"],
        DEFAULT_AARS_RULE.dataFindingMultiplier
      ),
      pillarCCap: clampInt(r["pillarCCap"], DEFAULT_AARS_RULE.pillarCCap, POINTS_MIN, POINTS_MAX),
      exposurePoints,
      bands
    };
  }
  function validateAarsRule(rule) {
    const errors = [];
    for (let i = 1; i < BAND_KEYS.length; i++) {
      const upper = BAND_KEYS[i - 1];
      const lower = BAND_KEYS[i];
      if (rule.bands[upper] <= rule.bands[lower]) {
        errors.push(
          `The ${BAND_LABELS[upper]} threshold (${rule.bands[upper]}) must sit above the ${BAND_LABELS[lower]} threshold (${rule.bands[lower]}) \u2014 otherwise no score can land in ${BAND_LABELS[lower]}.`
        );
      }
    }
    const { CONFIRMED, UNDETERMINED, NONE } = rule.exposurePoints;
    if (UNDETERMINED > CONFIRMED) {
      errors.push(
        `Undetermined internet exposure (${UNDETERMINED}) must not score above confirmed exposure (${CONFIRMED}) \u2014 "we haven't checked" cannot outrank "yes, it is reachable".`
      );
    }
    if (NONE > UNDETERMINED) {
      errors.push(
        `No internet exposure (${NONE}) must not score above undetermined exposure (${UNDETERMINED}).`
      );
    }
    for (let i = 1; i < SEVERITY_KEYS.length; i++) {
      const worse = SEVERITY_KEYS[i - 1];
      const milder = SEVERITY_KEYS[i];
      if (rule.dataFindingPoints[milder] > rule.dataFindingPoints[worse]) {
        errors.push(
          `A ${milder.toLowerCase()} data finding (${rule.dataFindingPoints[milder]}) must not score above a ${worse.toLowerCase()} one (${rule.dataFindingPoints[worse]}).`
        );
      }
    }
    if (!rule.gapPoints.length) {
      errors.push(
        "The compliance-gap cascade has no rules; every gap would price at the fallback. Add a rule or set the fallback deliberately."
      );
    }
    if (rule.gapPoints.length > MAX_GAP_RULES) {
      errors.push(`The compliance-gap cascade is limited to ${MAX_GAP_RULES} rules.`);
    }
    const seen = /* @__PURE__ */ new Set();
    rule.gapPoints.forEach((g, i) => {
      if (!g.code) {
        errors.push(`Compliance-gap rule ${i + 1} has no code.`);
        return;
      }
      const key = `${g.match}:${g.code}`;
      if (seen.has(key)) {
        errors.push(`Compliance-gap rule ${i + 1} repeats ${g.match} "${g.code}".`);
      }
      seen.add(key);
    });
    return errors;
  }
  function shadowedGapRules(rule) {
    const dead = [];
    rule.gapPoints.forEach((row, i) => {
      for (let j = 0; j < i; j++) {
        const earlier = rule.gapPoints[j];
        const shadows = earlier.match === "prefix" ? row.code.startsWith(earlier.code) : row.match === "exact" && row.code === earlier.code;
        if (shadows) {
          dead.push(i);
          return;
        }
      }
    });
    return dead;
  }
  var DERIVABLE_PREFIXES = ["LLM", "ASI", "ML_", "5R_"];
  var DERIVABLE_EXACT = ["NO_GUARDRAIL", "DEPRECATED_MODEL", "INACTIVE_AGENT", "FIVE_RS"];
  function isDerivable(code, rule) {
    const c = cleanGapCode(code);
    if (!c) return false;
    if (c === "DEPRECATED_MODEL") return rule.gapSources.deprecatedModel === true;
    if (c === "INACTIVE_AGENT") return rule.gapSources.inactiveAgent === true;
    if (c.startsWith("5R_")) {
      return rule.gapSources.fiveRs === true || rule.gapSources.frameworkMapping === true;
    }
    if (c === "FIVE_RS") return false;
    if (DERIVABLE_EXACT.includes(c)) return true;
    return DERIVABLE_PREFIXES.some((p) => c.startsWith(p));
  }
  function unreachableGapRules(rule) {
    const dead = [];
    rule.gapPoints.forEach((row, i) => {
      const claimsDerivedFamily = row.match === "prefix" ? row.code.startsWith("5R") && rule.gapSources.fiveRs !== true && rule.gapSources.frameworkMapping !== true : DERIVABLE_EXACT.includes(cleanGapCode(row.code)) && !isDerivable(row.code, rule);
      if (claimsDerivedFamily) dead.push(i);
    });
    return dead;
  }
  var EMPTY_DISCRIMINATION = {
    scored: 0,
    distinctScores: 0,
    largestTieGroup: 0,
    bandOccupancy: {},
    range: { min: 0, max: 0 },
    saturated: { toxic: 0, compliance: 0, data: 0, exposure: 0, score: 0 }
  };
  function ruleDiscrimination(nodes, rule) {
    var _a5, _b, _c;
    const scores = [];
    const counts = {};
    for (const b of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]) counts[b] = 0;
    const saturated = { toxic: 0, compliance: 0, data: 0, exposure: 0, score: 0 };
    const maxData = Math.min(
      rule.pillarCCap,
      Math.round(
        (Math.max(...EXPOSURE_KEYS.map((k) => rule.dataExposurePoints[k])) + Math.max(...SEVERITY_KEYS.map((k) => rule.dataFindingPoints[k]))) * rule.dataAmplifier
      )
    );
    const maxExposure = Math.max(...INTERNET_EXPOSURE_KEYS.map((k) => rule.exposurePoints[k]));
    for (const n of nodes) {
      if (typeof n.aars !== "number") continue;
      scores.push(n.aars);
      const band = String((_a5 = n.aarsSeverity) != null ? _a5 : "");
      if (band in counts) counts[band] = counts[band] + 1;
      const p = n.aarsPillars;
      if (p) {
        if (p.toxic >= rule.pillarACap) saturated.toxic++;
        if (p.compliance >= rule.pillarBCap) saturated.compliance++;
        if (maxData > 0 && p.data >= maxData) saturated.data++;
        if (maxExposure > 0 && ((_b = p.exposure) != null ? _b : 0) >= maxExposure) saturated.exposure++;
      }
      if (n.aars >= 100) saturated.score++;
    }
    if (!scores.length) return { ...EMPTY_DISCRIMINATION, bandOccupancy: counts };
    const byScore = /* @__PURE__ */ new Map();
    for (const s of scores) byScore.set(s, ((_c = byScore.get(s)) != null ? _c : 0) + 1);
    return {
      scored: scores.length,
      distinctScores: byScore.size,
      largestTieGroup: Math.max(...byScore.values()),
      bandOccupancy: counts,
      range: { min: Math.min(...scores), max: Math.max(...scores) },
      saturated
    };
  }
  function gapMatchTally(rule, codeLists) {
    var _a5;
    const perRule = rule.gapPoints.map(() => 0);
    const byCode = {};
    let fallback = 0;
    let total2 = 0;
    for (const list2 of codeLists != null ? codeLists : []) {
      if (!Array.isArray(list2)) continue;
      const seen = /* @__PURE__ */ new Set();
      for (const raw of list2) {
        const code = cleanGapCode(raw);
        if (!code || seen.has(code)) continue;
        seen.add(code);
        byCode[code] = ((_a5 = byCode[code]) != null ? _a5 : 0) + 1;
        total2++;
        let matched = false;
        for (let i = 0; i < rule.gapPoints.length; i++) {
          const row = rule.gapPoints[i];
          const hit = row.match === "exact" ? code === row.code : code.startsWith(row.code);
          if (hit) {
            perRule[i] = perRule[i] + 1;
            matched = true;
            break;
          }
        }
        if (!matched) fallback++;
      }
    }
    return { perRule, fallback, total: total2, byCode };
  }
  function pointsPhrase(n) {
    return n === 1 ? "1 point" : `${n} points`;
  }
  function ruleSummary(rule) {
    const sev = SEVERITY_KEYS.map((k) => `${k} ${rule.severityPoints[k]}`).join(", ");
    const exposure = `sensitive data ${rule.dataExposurePoints.SENSITIVE}, unconfirmed data access ${rule.dataExposurePoints.DATA_ACCESS}, none ${rule.dataExposurePoints.NONE}`;
    const amplified = EXPOSURE_KEYS.map(
      (k) => String(Math.round(rule.dataExposurePoints[k] * rule.dataAmplifier))
    ).join(" / ");
    const countClause = rule.multiIssueScaling === "log2" ? `each doubling of the open-issue count multiplies that by a further \xD7${rule.multiIssueMultiplier} step (two issues \xD7${rule.multiIssueMultiplier}, four \xD7${(1 + (rule.multiIssueMultiplier - 1) * 2).toFixed(2)}, eight \xD7${(1 + (rule.multiIssueMultiplier - 1) * 3).toFixed(2)})` : `more than one open issue multiplies that by \xD7${rule.multiIssueMultiplier}, however many there are`;
    const gapClause = rule.gapAggregation === "rss" ? `matched prices combine as a root-sum-square, so each further gap adds less than the last` : `matched prices are added up`;
    const findingClause = SEVERITY_KEYS.every((k) => rule.dataFindingPoints[k] === 0) ? `The data findings an asset can reach score nothing; they are drawn on the graph but never added to the score.` : `The worst data finding it can reach adds ` + SEVERITY_KEYS.map((k) => `${k.toLowerCase()} ${rule.dataFindingPoints[k]}`).join(" / ") + (rule.dataFindingScaling === "log2" ? `, and each doubling of the finding count multiplies that by a further \xD7${rule.dataFindingMultiplier} step.` : `, however many it reaches.`);
    return [
      `Pillar A \u2014 toxic combinations, capped at ${rule.pillarACap}. The asset's worst open issue scores ${sev}; ${countClause}.`,
      `Pillar B \u2014 compliance gaps, capped at ${rule.pillarBCap}. ${rule.gapPoints.length} pricing rules are tried in order, first match wins; an unmatched code scores ${pointsPhrase(rule.gapFallbackPoints)}. ${gapClause[0].toUpperCase()}${gapClause.slice(1)}.`,
      `Pillar C \u2014 data exposure, capped at ${rule.pillarCCap}: ${exposure}, all amplified by \xD7${rule.dataAmplifier} (\u2192 ${amplified}). ${findingClause}`,
      rule.exposurePoints.CONFIRMED === 0 && rule.exposurePoints.UNDETERMINED === 0 && rule.exposurePoints.NONE === 0 ? `Pillar D \u2014 internet exposure scores nothing; reachability is reported beside the score but never added to it.` : `Pillar D \u2014 internet exposure: confirmed ${rule.exposurePoints.CONFIRMED}, undetermined ${rule.exposurePoints.UNDETERMINED}, none ${rule.exposurePoints.NONE}. Not amplified \u2014 the 5Rs signal says nothing about reachability.`,
      `Levels \u2014 CRITICAL at ${rule.bands.critical} and above, HIGH from ${rule.bands.high}, MEDIUM from ${rule.bands.medium}, LOW from ${rule.bands.low}, INFO below that. Scores are clamped to 100.`
    ];
  }
  function bandRanges(bands) {
    return [
      { severity: "CRITICAL", min: bands.critical, max: 100 },
      { severity: "HIGH", min: bands.high, max: bands.critical - 1 },
      { severity: "MEDIUM", min: bands.medium, max: bands.high - 1 },
      { severity: "LOW", min: bands.low, max: bands.medium - 1 },
      { severity: "INFO", min: 0, max: bands.low - 1 }
    ].map((b) => ({ ...b, label: `score ${b.min}\u2013${b.max}` }));
  }
  function scoringEqual(a, b) {
    const withoutBands = (r) => {
      const c = cleanAarsRule(r);
      delete c.bands;
      return JSON.stringify(c);
    };
    return withoutBands(a) === withoutBands(b);
  }

  // src/domain/aarsTrend.ts
  function countAarsSeverities(nodes) {
    const counts = {};
    for (const sev of AARS_SEVERITY_ORDER) counts[sev] = 0;
    for (const n of nodes) {
      const sev = normalizeAarsSeverity(n.aarsSeverity);
      if (sev) counts[sev] += 1;
    }
    return counts;
  }
  function parseCounts(v) {
    if (typeof v !== "string" || !v) return null;
    let parsed;
    try {
      parsed = JSON.parse(v);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const raw = parsed;
    const counts = {};
    for (const sev of AARS_SEVERITY_ORDER) {
      const n = Number(raw[sev]);
      counts[sev] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    }
    return counts;
  }
  function aarsTrendFromHistory(rows, limit = 90) {
    var _a5;
    const points = [];
    for (const r of rows) {
      if (String((_a5 = r["status"]) != null ? _a5 : "") !== "SUCCESS") continue;
      const counts = parseCounts(r["aars_severity_json"]);
      if (!counts) continue;
      const at = String(r["finished_at"] || r["started_at"] || "");
      if (!at) continue;
      const v = Number(r["aars_rule_version"]);
      const ruleVersion = Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
      points.push({ at, counts, ruleVersion });
    }
    points.sort(cmpBy((p) => p.at));
    return limit > 0 && points.length > limit ? points.slice(points.length - limit) : points;
  }
  function ruleChangePoints(points) {
    const marks = [];
    for (let i = 1; i < points.length; i++) {
      if (points[i].ruleVersion !== points[i - 1].ruleVersion) marks.push(i);
    }
    return marks;
  }

  // src/domain/configFindings.ts
  var CONFIG_SORTS = [
    "severity",
    "rule",
    "resource",
    "firstSeen",
    "status"
  ];
  var DEFAULT_CONFIG_SORT_DIR = {
    severity: "desc",
    firstSeen: "desc",
    rule: "asc",
    resource: "asc",
    status: "asc"
  };
  var DEFAULT_CONFIG_PAGE_SIZE = 50;
  var MAX_CONFIG_PAGE_SIZE = 500;
  var CONFIG_CLIENT_ALL_MAX = 1e3;
  var CONFIG_FACET_KEYS = [
    "severities",
    "statuses",
    "clouds",
    "resourceTypes",
    "rules",
    "projects",
    "linkage",
    "flags"
  ];
  var LINKAGE_VALUES = ["linked", "unlinked"];
  var CONFIG_FLAGS = ["gap", "ignored", "iac"];
  var sevRank2 = (s) => {
    const i = SEVERITY_ORDER.indexOf(s);
    return i < 0 ? SEVERITY_ORDER.length : i;
  };
  function toConfigView(f, linked) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r;
    return {
      id: f.id,
      name: (_b = (_a5 = f.name) != null ? _a5 : f.ruleName) != null ? _b : "",
      severity: (_c = f.severity) != null ? _c : "UNKNOWN",
      status: (_d = f.status) != null ? _d : "",
      result: (_e = f.result) != null ? _e : "",
      ruleShortId: (_f = f.ruleShortId) != null ? _f : "",
      ruleName: (_g = f.ruleName) != null ? _g : "",
      resourceId: f.resourceId,
      resourceName: (_h = f.resourceName) != null ? _h : "",
      resourceType: (_i = f.resourceType) != null ? _i : "",
      cloud: (_j = f.cloudProvider) != null ? _j : "",
      subscriptionName: (_k = f.subscriptionName) != null ? _k : "",
      projects: ((_l = f.projects) != null ? _l : []).map((p) => p.name).filter(Boolean),
      businessImpact: (_m = f.businessImpact) != null ? _m : "",
      firstSeenAt: (_n = f.firstSeenAt) != null ? _n : "",
      analyzedAt: (_o = f.analyzedAt) != null ? _o : "",
      risks: (_p = f.risks) != null ? _p : [],
      linked,
      ignored: ((_q = f.ignoreRuleIds) != null ? _q : []).length > 0,
      iac: ((_r = f.iacFindingIds) != null ? _r : []).length > 0,
      gap: isOpenGap(f)
    };
  }
  function listParam(v) {
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
    const s = toStr(v);
    return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
  }
  function resolveConfigQuery(params) {
    var _a5;
    return {
      q: ((_a5 = toStr(params["q"])) != null ? _a5 : "").trim().toLowerCase(),
      severities: listParam(params["severities"]),
      statuses: listParam(params["statuses"]),
      clouds: listParam(params["clouds"]),
      resourceTypes: listParam(params["resourceTypes"]),
      rules: listParam(params["rules"]),
      projects: listParam(params["projects"]),
      linkage: listParam(params["linkage"]).filter(
        (v) => LINKAGE_VALUES.indexOf(v) >= 0
      ),
      flags: listParam(params["flags"]).filter(
        (v) => CONFIG_FLAGS.indexOf(v) >= 0
      )
    };
  }
  function hasConfigFlag(row, flag) {
    if (flag === "gap") return row.gap;
    if (flag === "ignored") return row.ignored;
    if (flag === "iac") return row.iac;
    return false;
  }
  function anyOf(selected, value) {
    return selected.length === 0 || selected.indexOf(value) >= 0;
  }
  function matchesConfigQuery(row, q) {
    if (!anyOf(q.severities, row.severity)) return false;
    if (!anyOf(q.statuses, row.status)) return false;
    if (!anyOf(q.clouds, row.cloud)) return false;
    if (!anyOf(q.resourceTypes, row.resourceType)) return false;
    if (!anyOf(q.rules, row.ruleShortId)) return false;
    if (q.projects.length && !row.projects.some((p) => q.projects.indexOf(p) >= 0)) return false;
    if (q.linkage.length && !anyOf(q.linkage, row.linked ? "linked" : "unlinked")) return false;
    for (const flag of q.flags) if (!hasConfigFlag(row, flag)) return false;
    if (q.q) {
      const hay = [
        row.name,
        row.ruleShortId,
        row.ruleName,
        row.resourceName,
        row.resourceType,
        row.subscriptionName
      ].join(" ").toLowerCase();
      if (hay.indexOf(q.q) < 0) return false;
    }
    return true;
  }
  function filterConfigRows(rows, q) {
    return rows.filter((r) => matchesConfigQuery(r, q));
  }
  function configComparator(sort, dir) {
    const d = (dir != null ? dir : DEFAULT_CONFIG_SORT_DIR[sort]) === "asc" ? 1 : -1;
    const tie = (a, b) => a.id.localeCompare(b.id);
    return (a, b) => {
      let cmp2 = 0;
      if (sort === "severity") cmp2 = sevRank2(b.severity) - sevRank2(a.severity);
      else if (sort === "rule") cmp2 = a.ruleShortId.localeCompare(b.ruleShortId);
      else if (sort === "resource") cmp2 = a.resourceName.localeCompare(b.resourceName);
      else if (sort === "status") cmp2 = a.status.localeCompare(b.status);
      else if (sort === "firstSeen") cmp2 = a.firstSeenAt.localeCompare(b.firstSeenAt);
      return cmp2 !== 0 ? cmp2 * d : tie(a, b);
    };
  }
  function sortConfigRows(rows, sort, dir) {
    return rows.slice().sort(configComparator(sort, dir));
  }
  function facetValues2(key, row) {
    if (key === "severities") return [row.severity].filter(Boolean);
    if (key === "statuses") return [row.status].filter(Boolean);
    if (key === "clouds") return [row.cloud].filter(Boolean);
    if (key === "resourceTypes") return [row.resourceType].filter(Boolean);
    if (key === "rules") return [row.ruleShortId].filter(Boolean);
    if (key === "projects") return row.projects;
    if (key === "linkage") return [row.linked ? "linked" : "unlinked"];
    return CONFIG_FLAGS.filter((f) => hasConfigFlag(row, f));
  }
  function facetSorter2(key) {
    if (key === "severities") return (a, b) => sevRank2(a.value) - sevRank2(b.value);
    if (key === "flags") {
      const order = CONFIG_FLAGS;
      return (a, b) => order.indexOf(a.value) - order.indexOf(b.value);
    }
    if (key === "linkage") {
      const order = LINKAGE_VALUES;
      return (a, b) => order.indexOf(a.value) - order.indexOf(b.value);
    }
    return (a, b) => a.value.localeCompare(b.value);
  }
  function configFacetCounts(rows, q) {
    var _a5;
    const out = { matched: 0 };
    for (const key of CONFIG_FACET_KEYS) {
      const scope = key === "flags" ? q : { ...q, [key]: [] };
      const counts = /* @__PURE__ */ new Map();
      for (const row of rows) {
        if (!matchesConfigQuery(row, scope)) continue;
        for (const value of facetValues2(key, row)) {
          counts.set(value, ((_a5 = counts.get(value)) != null ? _a5 : 0) + 1);
        }
      }
      for (const value of q[key]) if (!counts.has(value)) counts.set(value, 0);
      out[key] = Array.from(counts, ([value, count2]) => ({ value, count: count2 })).sort(facetSorter2(key));
    }
    out.matched = rows.reduce((n, row) => matchesConfigQuery(row, q) ? n + 1 : n, 0);
    return out;
  }
  function rollupByControl(rows) {
    var _a5;
    const byRule = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const key = row.ruleShortId || row.ruleName || "\u2014";
      const bucket = byRule.get(key);
      if (bucket) bucket.push(row);
      else byRule.set(key, [row]);
    }
    const out = [];
    for (const [ruleShortId, group] of byRule) {
      const resources = /* @__PURE__ */ new Set();
      const gapResources = /* @__PURE__ */ new Set();
      const unlinkedGapResources = /* @__PURE__ */ new Set();
      const clouds = /* @__PURE__ */ new Set();
      const projects = /* @__PURE__ */ new Set();
      const risks = /* @__PURE__ */ new Set();
      const severityMix = {};
      let worst = "UNKNOWN";
      let firstSeenAt = "";
      let gaps = 0;
      let linked = 0;
      let unlinked = 0;
      let ignored = 0;
      let iac = 0;
      for (const row of group) {
        resources.add(row.resourceId);
        if (row.cloud) clouds.add(row.cloud);
        for (const p of row.projects) projects.add(p);
        for (const r of row.risks) risks.add(r);
        severityMix[row.severity] = ((_a5 = severityMix[row.severity]) != null ? _a5 : 0) + 1;
        if (sevRank2(row.severity) < sevRank2(worst)) worst = row.severity;
        if (row.firstSeenAt && (!firstSeenAt || row.firstSeenAt < firstSeenAt)) {
          firstSeenAt = row.firstSeenAt;
        }
        if (row.gap) {
          gaps += 1;
          gapResources.add(row.resourceId);
          if (!row.linked) unlinkedGapResources.add(row.resourceId);
        }
        if (row.linked) linked += 1;
        else unlinked += 1;
        if (row.ignored) ignored += 1;
        if (row.iac) iac += 1;
      }
      out.push({
        ruleShortId,
        ruleName: group[0].ruleName || group[0].name || "",
        severity: worst,
        risks: [...risks].sort(),
        findings: group.length,
        gaps,
        resources: resources.size,
        gapResources: gapResources.size,
        unlinkedGapResources: unlinkedGapResources.size,
        linked,
        unlinked,
        ignored,
        iac,
        clouds: [...clouds].sort(),
        projects: [...projects].sort(),
        severityMix,
        firstSeenAt
      });
    }
    return out.sort((a, b) => sevRank2(a.severity) - sevRank2(b.severity) || b.gaps - a.gaps || b.resources - a.resources || a.ruleShortId.localeCompare(b.ruleShortId));
  }
  function configTotals(rows) {
    var _a5;
    const controls = /* @__PURE__ */ new Set();
    const resources = /* @__PURE__ */ new Set();
    const severityMix = {};
    let gaps = 0;
    let unlinkedGaps = 0;
    let ignored = 0;
    let iac = 0;
    for (const row of rows) {
      if (row.ruleShortId) controls.add(row.ruleShortId);
      resources.add(row.resourceId);
      if (row.gap) {
        gaps += 1;
        severityMix[row.severity] = ((_a5 = severityMix[row.severity]) != null ? _a5 : 0) + 1;
        if (!row.linked) unlinkedGaps += 1;
      }
      if (row.ignored) ignored += 1;
      if (row.iac) iac += 1;
    }
    return {
      findings: rows.length,
      gaps,
      controls: controls.size,
      resources: resources.size,
      unlinkedGaps,
      ignored,
      iac,
      severityMix
    };
  }

  // src/domain/complianceOverview.ts
  function severityRank2(s) {
    const i = SEVERITY_ORDER.indexOf(s);
    return i === -1 ? SEVERITY_ORDER.length : i;
  }
  var STATE_KEYS = ["scored", "noResources", "noPolicies", "unknown"];
  function frameworkRail(trees) {
    return trees.map((tree) => ({
      frameworkId: tree.frameworkId,
      name: tree.name,
      posturePct: tree.posturePct,
      state: tree.state,
      emptyPostureReason: tree.emptyPostureReason,
      categoryCount: tree.categories.length,
      // From stateCounts, not from the listed nodes: the tree lists only scored
      // subcategories (compliancePosture.ts), and a rail that counted those would report a
      // framework's size as the part of it that happened to score.
      subcategoryCount: STATE_KEYS.reduce((sum, k) => sum + (tree.stateCounts[k] || 0), 0),
      policyCount: tree.policyCount,
      failingPolicyCount: tree.failingPolicyCount,
      worstFailingSeverity: tree.worstFailingSeverity,
      // Copied rather than aliased: a caller holding this row must not be able to mutate
      // the FrameworkTree it was built from by mutating what looks like its own object.
      stateCounts: { ...tree.stateCounts }
    }));
  }
  function isScoredRow(row) {
    return row.state === "scored";
  }
  function weakestAreas(trees, limit) {
    const rows = [];
    for (const tree of trees) {
      for (const category of tree.categories) {
        for (const sub of category.subcategories) {
          if (sub.state === "scored" && !sub.policies.length) continue;
          rows.push({
            frameworkId: tree.frameworkId,
            frameworkName: tree.name,
            categoryExternalId: category.externalId,
            categoryTitle: category.title,
            externalId: sub.externalId,
            showExternalId: sub.showExternalId,
            title: sub.title,
            posturePct: sub.posturePct,
            state: sub.state,
            emptyPostureReason: sub.emptyPostureReason,
            passCount: sub.passCount,
            failCount: sub.failCount,
            // Distinct policies THIS subcategory carries. buildFrameworkTree already
            // deduped `policies` to that scope (compliancePosture.ts:190), so re-deduping
            // here would be the wrong scope all over again — count the list as given.
            policyCount: sub.policies.length,
            failingPolicyCount: sub.failingPolicyCount
          });
        }
      }
    }
    const scored = rows.filter(isScoredRow);
    scored.sort((a, b) => a.posturePct - b.posturePct || b.failingPolicyCount - a.failingPolicyCount || (a.frameworkName < b.frameworkName ? -1 : a.frameworkName > b.frameworkName ? 1 : 0) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    return typeof limit === "number" ? scored.slice(0, limit) : scored;
  }
  function sharedControls(trees) {
    const byPolicy = /* @__PURE__ */ new Map();
    for (const tree of trees) {
      for (const category of tree.categories) {
        for (const sub of category.subcategories) {
          for (const p of sub.policies) {
            let acc = byPolicy.get(p.policyId);
            if (!acc) {
              acc = {
                policyId: p.policyId,
                shortId: p.shortId,
                name: p.name,
                policyKind: p.policyKind,
                severity: p.severity,
                severityRank: severityRank2(p.severity),
                hasAutoRemediation: p.hasAutoRemediation === true,
                frameworkIds: [],
                frameworkNames: [],
                subcategoryKeys: /* @__PURE__ */ new Set(),
                failCount: 0
              };
              byPolicy.set(p.policyId, acc);
            }
            const rank = severityRank2(p.severity);
            if (rank < acc.severityRank) {
              acc.severityRank = rank;
              acc.severity = p.severity;
              acc.shortId = p.shortId;
              acc.name = p.name;
              acc.policyKind = p.policyKind;
              acc.hasAutoRemediation = p.hasAutoRemediation === true;
            }
            if (acc.frameworkIds.indexOf(tree.frameworkId) === -1) {
              acc.frameworkIds.push(tree.frameworkId);
              acc.frameworkNames.push(tree.name);
            }
            acc.subcategoryKeys.add(`${tree.frameworkId}|${sub.externalId}`);
            if (p.failCount > acc.failCount) acc.failCount = p.failCount;
          }
        }
      }
    }
    const rows = [];
    for (const acc of byPolicy.values()) {
      if (acc.failCount <= 0) continue;
      rows.push({
        policyId: acc.policyId,
        shortId: acc.shortId,
        name: acc.name,
        policyKind: acc.policyKind,
        severity: acc.severity,
        hasAutoRemediation: acc.hasAutoRemediation,
        frameworkIds: acc.frameworkIds,
        frameworkNames: acc.frameworkNames,
        frameworkCount: acc.frameworkIds.length,
        subcategoryCount: acc.subcategoryKeys.size,
        failCount: acc.failCount
      });
    }
    rows.sort((a, b) => b.frameworkCount - a.frameworkCount || severityRank2(a.severity) - severityRank2(b.severity) || b.failCount - a.failCount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return rows;
  }
  function coverageSummary(trees, catalogue) {
    const stateCounts = {
      scored: 0,
      noResources: 0,
      noPolicies: 0,
      unknown: 0
    };
    let subcategoryCount = 0;
    for (const tree of trees) {
      stateCounts.scored += tree.stateCounts.scored;
      stateCounts.noResources += tree.stateCounts.noResources;
      stateCounts.noPolicies += tree.stateCounts.noPolicies;
      stateCounts.unknown += tree.stateCounts.unknown;
      subcategoryCount += STATE_KEYS.reduce((sum, k) => sum + (tree.stateCounts[k] || 0), 0);
    }
    return {
      collected: trees.length,
      catalogued: catalogue.length,
      scoredFrameworks: trees.filter((t) => t.state === "scored").length,
      stateCounts,
      subcategoryCount
    };
  }

  // src/domain/syncNormalize.ts
  function str3(v) {
    const c = clean(v);
    return c === null ? void 0 : String(c);
  }
  function bool(v) {
    return v === true;
  }
  function triBool2(v) {
    return v === true ? true : v === false ? false : null;
  }
  function discoveryMethodList(v) {
    if (typeof v === "string") return v.trim() ? [v.trim()] : [];
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  function normalizeCloudResource(raw) {
    var _a5, _b;
    if (!raw || typeof raw !== "object") return null;
    const id = str3(raw["id"]);
    const kind = kindFromWizType(raw["type"]);
    if (!id || !kind) return null;
    const f = (key) => entityField(raw, key);
    const node2 = {
      id,
      kind,
      name: (_a5 = str3(raw["name"])) != null ? _a5 : id,
      nativeType: str3(f("nativeType")),
      cloudPlatform: str3(f("cloudPlatform")),
      region: str3(f("region")),
      status: str3(f("status")),
      firstSeen: str3(f("firstSeen")),
      lastSeen: str3(f("lastSeen")),
      externalId: str3(f("externalId")),
      isAccessibleFromInternet: triBool2(f("isAccessibleFromInternet")),
      isOpenToAllInternet: triBool2(f("isOpenToAllInternet")),
      hasSensitiveData: bool(f("hasSensitiveData")),
      hasAccessToSensitiveData: bool(f("hasAccessToSensitiveData")),
      hasHighPrivileges: bool(f("hasHighPrivileges")),
      hasAdminPrivileges: bool(f("hasAdminPrivileges"))
    };
    const purpose = normalizeIdentityPurpose(f("identityPurpose"));
    if (purpose) node2.identityPurpose = purpose;
    const inactive = f("inactiveInLast90Days");
    if (inactive === true || inactive === false) node2.inactive = inactive;
    const inactiveTimeframe = str3(f("inactiveTimeframe"));
    if (inactiveTimeframe) node2.inactiveTimeframe = inactiveTimeframe;
    const displayName = str3(f("displayName"));
    if (displayName) node2.displayName = displayName;
    const email = str3(f("email"));
    if (email) node2.email = email;
    const publisher = str3(f("publisher"));
    if (publisher) node2.publisher = publisher;
    const methods = discoveryMethodList(f("discoveryMethods"));
    if (methods.length) node2.discoveryMethods = methods;
    const exposureLevel = str3(f("exposureLevel"));
    if (exposureLevel) node2.exposureLevel = exposureLevel;
    const portValidation = str3(f("portValidation"));
    if (portValidation) node2.portValidation = portValidation;
    const technology = raw["technology"];
    if (technology && typeof technology === "object") {
      const cats = technology["categories"];
      if (Array.isArray(cats)) {
        const names = cats.map((c) => str3(c["name"])).filter((n) => Boolean(n));
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
      const accId = str3(account["id"]);
      if (accId) {
        node2.cloudAccount = {
          id: accId,
          name: (_b = str3(account["name"])) != null ? _b : accId,
          externalId: str3(account["externalId"]),
          cloudProvider: str3(account["cloudProvider"])
        };
      }
    }
    const projects = raw["projects"];
    if (Array.isArray(projects)) node2.projects = projectsOf(projects);
    const tags = raw["tags"];
    if (Array.isArray(tags)) {
      node2.tags = tags.map((t) => {
        var _a6;
        const rec2 = t;
        const key = str3(rec2["key"]);
        return key ? { key, value: (_a6 = str3(rec2["value"])) != null ? _a6 : "" } : null;
      }).filter((t) => t !== null);
    }
    return node2;
  }
  function emptyPart() {
    return {
      nodes: [],
      edges: [],
      issues: [],
      findings: [],
      dataFindings: [],
      frameworks: [],
      posture: [],
      frameworkPolicies: [],
      configRules: [],
      identityFindings: [],
      effectiveAccess: []
    };
  }
  function appendPart(target, part) {
    target.nodes.push(...part.nodes);
    target.edges.push(...part.edges);
    target.issues.push(...part.issues);
    target.findings.push(...part.findings);
    target.dataFindings.push(...part.dataFindings);
    target.frameworks.push(...part.frameworks);
    target.posture.push(...part.posture);
    target.frameworkPolicies.push(...part.frameworkPolicies);
    target.configRules.push(...part.configRules);
    target.identityFindings.push(...part.identityFindings);
    target.effectiveAccess.push(...part.effectiveAccess);
  }
  function partIsEmpty(part) {
    return !part.nodes.length && !part.edges.length && !part.issues.length && !part.findings.length && !part.dataFindings.length && !part.frameworks.length && !part.posture.length && !part.frameworkPolicies.length && !part.configRules.length && !part.identityFindings.length && !part.effectiveAccess.length;
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
      if (!node2.identityPurpose) node2.identityPurpose = "AGENTIC";
      part.nodes.push(node2);
    }
    return part;
  }
  function normalizeRuleAssetsPage(rows, group) {
    var _a5, _b;
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
        account: (_a5 = node2.cloudAccount) == null ? void 0 : _a5.name,
        projects: ((_b = node2.projects) != null ? _b : []).map((p) => p.name),
        frameworks: group.frameworks
      });
    }
    return part;
  }
  function resolvedByName(raw) {
    var _a5;
    if (!raw || typeof raw !== "object") return void 0;
    const by = raw;
    const user = by["user"];
    if (user && typeof user === "object") {
      const name = (_a5 = str3(user["name"])) != null ? _a5 : str3(user["email"]);
      if (name) return name;
    }
    const sa = by["serviceAccount"];
    if (sa && typeof sa === "object") return str3(sa["name"]);
    return void 0;
  }
  function ignoreRationale(raw) {
    if (!Array.isArray(raw)) return void 0;
    for (const note of raw) {
      if (!note || typeof note !== "object") continue;
      const text = str3(note["text"]);
      if (text && /^Ignored\s*\(/i.test(text)) return text;
    }
    return void 0;
  }
  var BUSINESS_IMPACT_ORDER = ["HBI", "MBI", "LBI"];
  function worstBusinessImpact(projects) {
    let best;
    let bestRank = BUSINESS_IMPACT_ORDER.length;
    for (const p of projects) {
      const profile = p["riskProfile"];
      if (!profile || typeof profile !== "object") continue;
      const impact = str3(profile["businessImpact"]);
      if (!impact) continue;
      const rank = BUSINESS_IMPACT_ORDER.indexOf(impact);
      if (rank >= 0 && rank < bestRank) {
        bestRank = rank;
        best = impact;
      }
    }
    return best;
  }
  function ticketUrlsOf(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((t) => t && typeof t === "object" ? str3(t["url"]) : void 0).filter((u) => Boolean(u));
  }
  function normalizeIssuesPage(rows) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i;
    const part = emptyPart();
    for (const raw of rows) {
      const issueId = str3(raw["id"]);
      const snap = raw["entitySnapshot"];
      const assetId = snap && typeof snap === "object" ? str3(snap["id"]) : void 0;
      if (!issueId || !assetId) continue;
      const sourceRules = Array.isArray(raw["sourceRules"]) ? raw["sourceRules"] : [];
      const first = (_a5 = sourceRules[0]) != null ? _a5 : {};
      const ruleId = str3(first["id"]);
      const ruleName = str3(first["name"]);
      const group = classifyIssue({ sourceRuleId: ruleId != null ? ruleId : null, ruleName: ruleName != null ? ruleName : null });
      const nativeSeverity = (_b = str3(raw["severity"])) != null ? _b : "UNKNOWN";
      const adjustedSeverity = group ? group.adjustedSeverity : nativeSeverity;
      const control = first["control"];
      const resolutionRecommendation = (_c = str3(first["resolutionRecommendation"])) != null ? _c : control && typeof control === "object" ? str3(control["resolutionRecommendation"]) : void 0;
      const assetName = (_d = str3(snap["name"])) != null ? _d : assetId;
      const projectRows = Array.isArray(raw["projects"]) ? raw["projects"] : [];
      const projects = projectRows.map((p) => str3(p["name"])).filter((n) => Boolean(n));
      const assigneeRaw = raw["assignee"];
      const aiAnalysis = raw["aiRemediationAnalysis"];
      const environments = Array.isArray(raw["environments"]) ? raw["environments"].map((e) => str3(e)).filter((e) => Boolean(e)) : void 0;
      const ticketUrls = ticketUrlsOf(raw["serviceTickets"]);
      const issue2 = {
        id: issueId,
        ruleId: (_e = ruleId != null ? ruleId : group == null ? void 0 : group.ruleId) != null ? _e : "",
        ruleName: (_f = ruleName != null ? ruleName : group == null ? void 0 : group.title) != null ? _f : "",
        comboGroup: (_g = group == null ? void 0 : group.id) != null ? _g : OTHER_GROUP_ID,
        nativeSeverity,
        adjustedSeverity,
        status: (_h = str3(raw["status"])) != null ? _h : "OPEN",
        assetId,
        assetName,
        region: str3(snap["region"]),
        account: str3(snap["subscriptionName"]),
        projects,
        frameworks: group == null ? void 0 : group.frameworks,
        createdAt: str3(raw["createdAt"]),
        dueAt: str3(raw["dueAt"]),
        resolutionRecommendation,
        issueType: str3(raw["type"]),
        updatedAt: str3(raw["updatedAt"]),
        resolvedAt: str3(raw["resolvedAt"]),
        resolutionReason: str3(raw["resolutionReason"]),
        resolvedBy: resolvedByName(raw["resolvedBy"]),
        assignee: assigneeRaw && typeof assigneeRaw === "object" ? (_i = str3(assigneeRaw["name"])) != null ? _i : str3(assigneeRaw["primaryEmail"]) : void 0,
        businessImpact: worstBusinessImpact(projectRows),
        entityStatus: str3(snap["status"]),
        subscriptionId: str3(snap["subscriptionId"]),
        ignoreNote: ignoreRationale(raw["notes"]),
        ignoreExpiredAt: str3(raw["rejectionExpiredAt"]),
        aiVerdict: aiAnalysis && typeof aiAnalysis === "object" ? str3(aiAnalysis["verdict"]) : void 0,
        aiRecommendedSeverity: aiAnalysis && typeof aiAnalysis === "object" ? str3(aiAnalysis["recommendedSeverity"]) : void 0
      };
      if (environments && environments.length) issue2.environments = environments;
      if (ticketUrls.length) issue2.ticketUrls = ticketUrls;
      if (raw["validatedAsExploitable"] === true) issue2.validatedAsExploitable = true;
      part.issues.push(issue2);
      const kind = kindFromWizType(snap["type"]);
      if (kind) {
        const node2 = { id: assetId, kind, name: assetName };
        const nativeType = str3(snap["nativeType"]);
        if (nativeType) node2.nativeType = nativeType;
        const cloud = str3(snap["cloudPlatform"]);
        if (cloud) node2.cloudPlatform = cloud;
        const region = str3(snap["region"]);
        if (region) node2.region = region;
        const externalId = str3(snap["externalId"]);
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
  function idsOf(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => r && typeof r === "object" ? str3(r["id"]) : void 0).filter((v) => !!v);
  }
  function strListOf(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((v) => str3(v)).filter((v) => !!v);
  }
  function projectsOf(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((p) => {
      if (!p || typeof p !== "object") return null;
      const id = str3(p["id"]);
      const name = str3(p["name"]);
      if (!id || !name) return null;
      const profile = p["riskProfile"];
      const businessImpact = profile && typeof profile === "object" ? str3(profile["businessImpact"]) : void 0;
      return { id, name, businessImpact };
    }).filter((p) => p !== null);
  }
  function normalizeConfigFindingsPage(rows) {
    var _a5, _b;
    const part = emptyPart();
    for (const raw of rows) {
      const id = str3(raw["id"]);
      if (!id) continue;
      const resource = raw["resource"];
      const resourceId = resource && typeof resource === "object" ? str3(resource["id"]) : void 0;
      if (!resourceId) continue;
      const rule = raw["rule"];
      const hasRule = !!rule && typeof rule === "object";
      const ruleShortId = hasRule ? (_a5 = str3(rule["shortId"])) != null ? _a5 : "" : "";
      const subscription = raw["subscription"];
      const hasSub = !!subscription && typeof subscription === "object";
      const rawProjects = resource && typeof resource === "object" ? resource["projects"] : void 0;
      part.findings.push({
        id,
        resourceId,
        ruleShortId,
        severity: (_b = str3(raw["severity"])) != null ? _b : "UNKNOWN",
        remediation: str3(raw["remediation"]),
        frameworkCodes: frameworkCodesFromRule(rule, ruleShortId),
        name: str3(raw["name"]),
        status: str3(raw["status"]),
        result: str3(raw["result"]),
        // Only an explicit `true` is a tombstone. `deleted` absent from the response must
        // stay absent on the row, not become `false` — "not collected" and "collected and
        // false" are different facts, and isOpenGap reads the difference.
        deleted: raw["deleted"] === true ? true : void 0,
        firstSeenAt: str3(raw["firstSeenAt"]),
        analyzedAt: str3(raw["analyzedAt"]),
        ruleId: hasRule ? str3(rule["id"]) : void 0,
        ruleGraphId: hasRule ? str3(rule["graphId"]) : void 0,
        ruleName: hasRule ? str3(rule["name"]) : void 0,
        ruleDescription: hasRule ? str3(rule["description"]) : void 0,
        remediationInstructions: hasRule ? str3(rule["remediationInstructions"]) : void 0,
        opaPolicy: hasRule ? str3(rule["opaPolicy"]) : void 0,
        risks: hasRule ? strListOf(rule["risks"]) : [],
        threats: hasRule ? strListOf(rule["threats"]) : [],
        resourceName: str3(resource["name"]),
        resourceType: str3(resource["type"]),
        resourceStatus: str3(resource["status"]),
        targetExternalId: str3(raw["targetExternalId"]),
        source: str3(raw["source"]),
        subscriptionId: hasSub ? str3(subscription["id"]) : void 0,
        subscriptionName: hasSub ? str3(subscription["name"]) : void 0,
        cloudProvider: hasSub ? str3(subscription["cloudProvider"]) : void 0,
        projects: projectsOf(rawProjects),
        businessImpact: Array.isArray(rawProjects) ? worstBusinessImpact(rawProjects) : void 0,
        ignoreRuleIds: idsOf(raw["ignoreRules"]),
        iacFindingIds: idsOf(raw["sourceMappedIacFindings"])
      });
    }
    return part;
  }
  function count(v) {
    return typeof v === "number" && isFinite(v) ? v : 0;
  }
  function posturePct(v) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }
  function tagsOf(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((t) => t && typeof t === "object").map((t) => {
      var _a5, _b;
      return { key: (_a5 = str3(t["key"])) != null ? _a5 : "", value: (_b = str3(t["value"])) != null ? _b : "" };
    }).filter((t) => t.key !== "" || t.value !== "");
  }
  function normalizeFrameworksPage(rows) {
    var _a5;
    const part = emptyPart();
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const id = str3(raw["id"]);
      if (!id) continue;
      part.frameworks.push({
        id,
        name: (_a5 = str3(raw["name"])) != null ? _a5 : id,
        description: str3(raw["description"]),
        builtin: bool(raw["builtin"]),
        enabled: bool(raw["enabled"]),
        policyTypes: strListOf(raw["policyTypes"]),
        selected: false
      });
    }
    return part;
  }
  function policyOf(raw) {
    const control = raw["control"];
    if (control && typeof control === "object") return { kind: "CONTROL", obj: control };
    const cloud = raw["cloudConfigurationRule"];
    if (cloud && typeof cloud === "object") return { kind: "CLOUD_RULE", obj: cloud };
    const host = raw["hostConfigurationRule"];
    if (host && typeof host === "object") return { kind: "HOST_RULE", obj: host };
    return null;
  }
  function normalizeCompliancePosturePage(rows) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
    const part = emptyPart();
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const frameworkId = str3(raw["id"]);
      if (!frameworkId) continue;
      const analytics = raw["complianceAnalytics"];
      if (!analytics || typeof analytics !== "object") continue;
      const categories = Array.isArray(analytics["categoryAnalytics"]) ? analytics["categoryAnalytics"] : [];
      part.posture.push({
        frameworkId,
        level: "framework",
        nodeId: frameworkId,
        title: (_a5 = str3(raw["name"])) != null ? _a5 : frameworkId,
        description: str3(raw["description"]),
        posturePct: posturePct(analytics["averageCompliancePosture"]),
        passCount: 0,
        failCount: 0,
        passSubCategoryCount: count(analytics["passSubCategoryCount"]),
        failSubCategoryCount: count(analytics["failSubCategoryCount"]),
        emptyPostureReason: (_b = str3(analytics["emptyPostureReason"])) != null ? _b : null
      });
      for (const cat of categories) {
        if (!cat || typeof cat !== "object") continue;
        const category = cat["category"];
        const hasCat = !!category && typeof category === "object";
        const catExternalId = hasCat ? (_c = str3(category["externalId"])) != null ? _c : "" : "";
        part.posture.push({
          frameworkId,
          level: "category",
          categoryExternalId: catExternalId,
          nodeId: hasCat ? str3(category["id"]) : void 0,
          title: hasCat ? (_d = str3(category["name"])) != null ? _d : catExternalId : catExternalId,
          description: hasCat ? str3(category["description"]) : void 0,
          posturePct: posturePct(cat["averageCompliancePosture"]),
          passCount: count(cat["passCount"]),
          failCount: count(cat["failCount"]),
          passSubCategoryCount: count(cat["passSubCategoryCount"]),
          failSubCategoryCount: count(cat["failSubCategoryCount"]),
          emptyPostureReason: (_e = str3(cat["emptyPostureReason"])) != null ? _e : null
        });
        const subs = Array.isArray(cat["subCategoryAnalytics"]) ? cat["subCategoryAnalytics"] : [];
        for (const sub of subs) {
          if (!sub || typeof sub !== "object") continue;
          const subCategory = sub["subCategory"];
          const hasSub = !!subCategory && typeof subCategory === "object";
          const subExternalId = hasSub ? (_f = str3(subCategory["externalId"])) != null ? _f : "" : "";
          part.posture.push({
            frameworkId,
            level: "subcategory",
            categoryExternalId: catExternalId,
            subcategoryExternalId: subExternalId,
            nodeId: hasSub ? str3(subCategory["id"]) : void 0,
            title: hasSub ? (_g = str3(subCategory["title"])) != null ? _g : subExternalId : subExternalId,
            description: hasSub ? str3(subCategory["description"]) : void 0,
            posturePct: posturePct(sub["compliancePosture"]),
            passCount: count(sub["passCount"]),
            failCount: count(sub["failCount"]),
            emptyPostureReason: (_h = str3(sub["emptyPostureReason"])) != null ? _h : null,
            assessmentScope: hasSub ? str3(subCategory["assessmentScope"]) : void 0,
            mappingRationale: hasSub ? str3(subCategory["mappingRationale"]) : void 0,
            tags: hasSub ? tagsOf(subCategory["tags"]) : []
          });
          const policies = Array.isArray(sub["policyAnalytics"]) ? sub["policyAnalytics"] : [];
          for (const pol of policies) {
            if (!pol || typeof pol !== "object") continue;
            const picked = policyOf(pol);
            if (!picked) continue;
            const policyId = str3(picked.obj["id"]);
            if (!policyId) continue;
            part.frameworkPolicies.push({
              frameworkId,
              categoryExternalId: catExternalId,
              subcategoryExternalId: subExternalId,
              policyId,
              policyKind: picked.kind,
              // Only a CloudConfigurationRule carries shortId ("AIGuardrail-007"); a
              // HostConfigurationRule spells its short name `shortName`, and a Control has
              // neither. This is the field the finding join matches on when present.
              shortId: (_i = str3(picked.obj["shortId"])) != null ? _i : str3(picked.obj["shortName"]),
              name: (_j = str3(picked.obj["name"])) != null ? _j : policyId,
              severity: (_k = str3(picked.obj["severity"])) != null ? _k : "UNKNOWN",
              enabled: (_l = triBool2(picked.obj["enabled"])) != null ? _l : void 0,
              builtin: (_m = triBool2(picked.obj["builtin"])) != null ? _m : void 0,
              passCount: count(pol["passCount"]),
              failCount: count(pol["failCount"]),
              assessedCount: count(pol["assessedCount"]),
              rejectedCount: count(pol["rejectedCount"]),
              // Wiz's spelling, one 's'. Kept verbatim on the wire, corrected on the row.
              noResourceToAssess: pol["noResourceToAsses"] === true,
              targetNativeType: str3(picked.obj["targetNativeType"]),
              subjectEntityType: str3(picked.obj["subjectEntityType"]),
              cloudProvider: str3(picked.obj["cloudProvider"]),
              hasAutoRemediation: (_n = triBool2(picked.obj["hasAutoRemediation"])) != null ? _n : void 0
            });
          }
        }
      }
    }
    return part;
  }
  function withFrameworkCodes(findings, lookup) {
    if (!findings.length) return findings;
    return findings.map((f) => {
      var _a5, _b;
      const extra = [];
      for (const c of (_a5 = lookup[f.ruleShortId]) != null ? _a5 : []) extra.push(c);
      if (f.ruleId) for (const c of (_b = lookup[f.ruleId]) != null ? _b : []) extra.push(c);
      if (!extra.length) return f;
      const codes = f.frameworkCodes.slice();
      for (const c of extra) if (!codes.includes(c)) codes.push(c);
      if (codes.length === f.frameworkCodes.length) return f;
      return { ...f, frameworkCodes: codes };
    });
  }
  function frameworkFamily(name) {
    const n = String(name != null ? name : "").toUpperCase();
    if (/\b5\s?RS?\b/.test(n)) return "WIZ_5RS";
    if (n.includes("AGENTIC")) return "OWASP_ASI";
    if (n.includes("MACHINE LEARNING") || /\bML\b/.test(n)) return "OWASP_ML";
    if (n.includes("LLM")) return "OWASP_LLM";
    return "OTHER";
  }
  function snake(label) {
    return String(label != null ? label : "").trim().replace(/\s+/g, "_").toUpperCase();
  }
  function frameworkGapCode(input) {
    var _a5, _b, _c, _d;
    const ext = String((_a5 = input.subcategoryExternalId) != null ? _a5 : "").trim().toUpperCase();
    if (/^(LLM|ASI)\d{2}$/.test(ext)) return ext;
    if (input.family === "OWASP_LLM") {
      const m = String((_b = input.categoryName) != null ? _b : "").toUpperCase().match(/\b(LLM\d{2})\b(?::(\d{4}))?/);
      if (!m) return "";
      if (m[2] && m[2] !== "2025") return "";
      return m[1];
    }
    if (input.family === "OWASP_ML") {
      const title = snake((_c = input.subcategoryTitle) != null ? _c : "");
      return title ? `ML_${title}` : "";
    }
    if (input.family === "WIZ_5RS") {
      const cat = snake((_d = input.categoryName) != null ? _d : "");
      return cat ? `5R_${cat}` : "";
    }
    return "";
  }
  function frameworkCodeLookup(policies, posture, frameworks) {
    var _a5, _b, _c;
    const familyByFramework = {};
    for (const f of frameworks) familyByFramework[f.id] = frameworkFamily(f.name);
    for (const p of posture) {
      if (p.level === "framework" && !familyByFramework[p.frameworkId]) {
        familyByFramework[p.frameworkId] = frameworkFamily(p.title);
      }
    }
    const categoryName = {};
    const subcategoryTitle = {};
    for (const p of posture) {
      if (p.level === "category") {
        categoryName[`${p.frameworkId}|${(_a5 = p.categoryExternalId) != null ? _a5 : ""}`] = p.title;
      } else if (p.level === "subcategory") {
        subcategoryTitle[`${p.frameworkId}|${(_b = p.subcategoryExternalId) != null ? _b : ""}`] = p.title;
      }
    }
    const byKey = {};
    const add = (key, code) => {
      var _a6;
      if (!key || !code) return;
      const list2 = (_a6 = byKey[key]) != null ? _a6 : byKey[key] = [];
      if (!list2.includes(code)) list2.push(code);
    };
    for (const p of policies) {
      const code = frameworkGapCode({
        family: (_c = familyByFramework[p.frameworkId]) != null ? _c : "OTHER",
        categoryName: categoryName[`${p.frameworkId}|${p.categoryExternalId}`],
        subcategoryExternalId: p.subcategoryExternalId,
        subcategoryTitle: subcategoryTitle[`${p.frameworkId}|${p.subcategoryExternalId}`]
      });
      if (!code) continue;
      add(p.policyId, code);
      add(p.shortId, code);
    }
    return byKey;
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
  var DATA_STORE_KINDS = /* @__PURE__ */ new Set(["BUCKET", "DATABASE", "DATABASE_SERVER"]);
  function rawEntitiesOf(row) {
    const entities = row["entities"];
    if (!Array.isArray(entities)) return [];
    return entities.filter(
      (e) => Boolean(e) && typeof e === "object"
    );
  }
  function normalizeSensitiveDataAccessPage(rows) {
    var _a5;
    const part = emptyPart();
    for (const row of rows) {
      const entities = entitiesOf(row);
      const agent = entities.find((e) => e.kind === "AI_AGENT");
      const sa = entities.find((e) => e.kind === "SERVICE_ACCOUNT");
      const stores = entities.filter((e) => DATA_STORE_KINDS.has(e.kind));
      part.nodes.push(...entities.filter((e) => e.kind !== "DATA_FINDING"));
      if (agent && sa) {
        part.edges.push({
          id: edgeId(agent.id, "RUNS_AS", sa.id),
          src: agent.id,
          dst: sa.id,
          type: "RUNS_AS"
        });
      }
      for (const store of stores) {
        if (!sa) continue;
        part.edges.push({
          id: edgeId(sa.id, "ALLOWS_ACCESS_TO", store.id),
          src: sa.id,
          dst: store.id,
          type: "ALLOWS_ACCESS_TO"
        });
      }
      if (stores.length !== 1) continue;
      const storeId = stores[0].id;
      for (const raw of rawEntitiesOf(row)) {
        if (kindFromWizType(raw["type"]) !== "DATA_FINDING") continue;
        const id = str3(raw["id"]);
        if (!id) continue;
        part.dataFindings.push({
          id,
          resourceId: storeId,
          name: (_a5 = str3(raw["name"])) != null ? _a5 : id,
          // Through entityField: on a graphSearch entity `severity` rides in the properties
          // bag, not flat. The capture shows it there on the finding entities.
          severity: normalizeDataFindingSeverity(entityField(raw, "severity"))
        });
      }
    }
    return part;
  }
  function normalizeDataFindingSeverity(v) {
    const raw = str3(v);
    if (!raw) return "UNKNOWN";
    const bare = raw.replace(/^DataFindingSeverity/i, "").toUpperCase();
    return SEVERITY_ORDER.includes(bare) ? bare : "UNKNOWN";
  }
  function withDataFindingCounts(doc, rows) {
    var _a5;
    if (!rows.length) return doc;
    const byStore = /* @__PURE__ */ new Map();
    for (const row of rows) {
      let acc = byStore.get(row.resourceId);
      if (!acc) {
        acc = { count: 0, sev: {} };
        byStore.set(row.resourceId, acc);
      }
      acc.count += 1;
      acc.sev[row.severity] = ((_a5 = acc.sev[row.severity]) != null ? _a5 : 0) + 1;
    }
    return {
      nodes: doc.nodes.map((n) => {
        const acc = byStore.get(n.id);
        if (!acc) return n;
        return { ...n, dataFindingCount: acc.count, dataFindingSeverities: acc.sev };
      }),
      edges: doc.edges,
      syncedAt: doc.syncedAt
    };
  }
  function normalizeConfigRulesPage(rows) {
    var _a5;
    const part = emptyPart();
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const id = str3(raw["id"]);
      const name = str3(raw["name"]);
      if (!id || !name) continue;
      part.configRules.push({
        id,
        shortId: (_a5 = str3(raw["shortId"])) != null ? _a5 : "",
        name,
        subjectEntityType: str3(raw["subjectEntityType"]),
        externalRefs: idsOf(raw["externalReferences"])
      });
    }
    return part;
  }
  var FilterNotHonouredError = class extends Error {
  };
  function normalizeIdentityFindingsPage(rows, ruleKinds) {
    var _a5, _b;
    const part = emptyPart();
    for (const raw of rows) {
      const id = str3(raw["id"]);
      if (!id) continue;
      const resource = raw["resource"];
      const resourceId = resource && typeof resource === "object" ? str3(resource["id"]) : void 0;
      const rule = raw["rule"];
      const hasRule = !!rule && typeof rule === "object";
      const ruleId = hasRule ? str3(rule["id"]) : void 0;
      const hygiene = ruleId ? ruleKinds[ruleId] : void 0;
      if (!hygiene) {
        throw new FilterNotHonouredError(
          "configurationFindings returned rule " + (ruleId != null ? ruleId : "(none)") + ", which was not among the " + Object.keys(ruleKinds).length + " identity-hygiene rules requested \u2014 the rule filter was not honoured."
        );
      }
      if (!resourceId) continue;
      part.identityFindings.push({
        id,
        resourceId,
        resourceName: str3(resource["name"]),
        ruleId,
        ruleShortId: hasRule ? (_a5 = str3(rule["shortId"])) != null ? _a5 : "" : "",
        ruleName: hasRule ? str3(rule["name"]) : void 0,
        severity: (_b = str3(raw["severity"])) != null ? _b : "UNKNOWN",
        status: str3(raw["status"]),
        result: str3(raw["result"]),
        firstSeenAt: str3(raw["firstSeenAt"]),
        analyzedAt: str3(raw["analyzedAt"]),
        remediation: str3(raw["remediation"]),
        hygiene
      });
    }
    return part;
  }
  function normalizeEffectiveAccessPage(rows) {
    const part = emptyPart();
    for (const raw of rows) {
      const row = toEffectiveAccessRow(raw);
      if (row) part.effectiveAccess.push(row);
    }
    return part;
  }
  var HOST_KIND_SET = new Set(HOST_KINDS);
  function rawEntityOfKind(row, kinds) {
    for (const raw of rawEntitiesOf(row)) {
      const kind = kindFromWizType(raw["type"]);
      if (kind && kinds.has(kind)) return raw;
    }
    return void 0;
  }
  function addUnique2(list2, value) {
    if (value && list2.indexOf(value) < 0) list2.push(value);
  }
  function normalizeHostExposurePage(rows) {
    const part = emptyPart();
    for (const row of rows) {
      const entities = entitiesOf(row);
      const asset = entities.find((e) => AI_ASSET_KINDS.includes(e.kind));
      const host = entities.find((e) => HOST_KIND_SET.has(e.kind));
      part.nodes.push(...entities);
      if (!host) continue;
      if (asset) {
        part.edges.push({
          id: edgeId(asset.id, "HOSTED_ON", host.id),
          src: asset.id,
          dst: host.id,
          type: "HOSTED_ON"
        });
      }
      const rawHost = rawEntityOfKind(row, HOST_KIND_SET);
      const exposures = rawHost ? rawHost["publicExposures"] : void 0;
      const exposureNodes = exposures && typeof exposures === "object" ? exposures["nodes"] : null;
      if (!Array.isArray(exposureNodes)) continue;
      const ports = [];
      const sourceIpRanges = [];
      for (const exposure of exposureNodes) {
        if (!exposure || typeof exposure !== "object") continue;
        addUnique2(ports, str3(exposure["portRange"]));
        addUnique2(sourceIpRanges, str3(exposure["sourceIpRange"]));
        const endpoints = exposure["applicationEndpoints"];
        if (!Array.isArray(endpoints)) continue;
        for (const rawEndpoint of endpoints) {
          const endpoint = normalizeCloudResource(rawEndpoint);
          if (!endpoint || endpoint.kind !== "ENDPOINT") continue;
          part.nodes.push(endpoint);
          part.edges.push({
            id: edgeId(host.id, "SERVES", endpoint.id),
            src: host.id,
            dst: endpoint.id,
            type: "SERVES"
          });
        }
      }
      if (ports.length || sourceIpRanges.length) {
        const evidence = {};
        if (ports.length) evidence.ports = ports;
        if (sourceIpRanges.length) evidence.sourceIpRanges = sourceIpRanges;
        host.exposureEvidence = evidence;
      }
    }
    return part;
  }
  function normalizeEndpointExposurePage(rows) {
    const part = emptyPart();
    for (const row of rows) {
      const entities = entitiesOf(row);
      const asset = entities.find((e) => AI_ASSET_KINDS.includes(e.kind));
      const endpoint = entities.find((e) => e.kind === "ENDPOINT");
      part.nodes.push(...entities);
      if (!asset || !endpoint) continue;
      part.edges.push({
        id: edgeId(asset.id, "SERVES", endpoint.id),
        src: asset.id,
        dst: endpoint.id,
        type: "SERVES"
      });
    }
    return part;
  }
  function normalizeIdentityAccessPage(rows) {
    var _a5;
    const part = emptyPart();
    for (const row of rows) {
      const entities = entitiesOf(row);
      const asset = entities.find((e) => AI_ASSET_KINDS.includes(e.kind));
      const identities = entities.filter(
        (e) => e.kind === "USER_ACCOUNT" || e.kind === "SERVICE_ACCOUNT" || e.kind === "ACCESS_ROLE"
      );
      part.nodes.push(...entities);
      if (!asset) continue;
      const rawRole = rawEntitiesOf(row).find((e) => kindFromWizType(e["type"]) === "ACCESS_ROLE");
      const accessType = (_a5 = rawRole ? normalizeAccessType(entityField(rawRole, "accessType")) : void 0) != null ? _a5 : "HIGH_PRIVILEGE";
      for (const identity of identities) {
        part.edges.push({
          id: edgeId(identity.id, "ALLOWS_ACCESS_TO", asset.id),
          src: identity.id,
          dst: asset.id,
          type: "ALLOWS_ACCESS_TO",
          accessType
        });
      }
    }
    return part;
  }
  function mergeParts(parts, syncedAt) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    const nodes = /* @__PURE__ */ new Map();
    const edges2 = /* @__PURE__ */ new Map();
    const issues2 = /* @__PURE__ */ new Map();
    const findings = /* @__PURE__ */ new Map();
    const dataFindings = /* @__PURE__ */ new Map();
    const frameworks = /* @__PURE__ */ new Map();
    const posture = /* @__PURE__ */ new Map();
    const frameworkPolicies = /* @__PURE__ */ new Map();
    const configRules = /* @__PURE__ */ new Map();
    const identityFindings = /* @__PURE__ */ new Map();
    const effectiveAccess = /* @__PURE__ */ new Map();
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
      for (const finding of (_a5 = part.findings) != null ? _a5 : []) findings.set(finding.id, finding);
      for (const df of (_b = part.dataFindings) != null ? _b : []) dataFindings.set(df.id, df);
      for (const f of (_c = part.frameworks) != null ? _c : []) frameworks.set(f.id, f);
      for (const p of (_d = part.posture) != null ? _d : []) {
        posture.set(
          `${p.frameworkId}|${p.level}|${(_e = p.categoryExternalId) != null ? _e : ""}|${(_f = p.subcategoryExternalId) != null ? _f : ""}`,
          p
        );
      }
      for (const p of (_g = part.frameworkPolicies) != null ? _g : []) {
        frameworkPolicies.set(
          `${p.frameworkId}|${p.subcategoryExternalId}|${p.policyId}`,
          p
        );
      }
      for (const r of (_h = part.configRules) != null ? _h : []) configRules.set(r.id, r);
      for (const f of (_i = part.identityFindings) != null ? _i : []) identityFindings.set(f.id, f);
      for (const e of (_j = part.effectiveAccess) != null ? _j : []) {
        effectiveAccess.set(`${e.identityId}|${e.resourceId}`, e);
      }
    }
    return {
      doc: { nodes: [...nodes.values()], edges: [...edges2.values()], syncedAt },
      issues: [...issues2.values()],
      findings: [...findings.values()],
      // De-duped by finding id, so the count folded from these rows is exact however the
      // battery split its pages.
      dataFindings: [...dataFindings.values()],
      frameworks: [...frameworks.values()],
      posture: [...posture.values()],
      frameworkPolicies: [...frameworkPolicies.values()],
      configRules: [...configRules.values()],
      identityFindings: [...identityFindings.values()],
      effectiveAccess: [...effectiveAccess.values()]
    };
  }

  // src/domain/complianceScope.ts
  function severityRank3(s) {
    const i = SEVERITY_ORDER.indexOf(s);
    return i === -1 ? SEVERITY_ORDER.length : i;
  }
  function isAiFamily(family) {
    return family === "OWASP_ASI" || family === "OWASP_LLM" || family === "OWASP_ML";
  }
  function scopeFiveRs(trees, findings, aiAssetIds, pins) {
    var _a5, _b, _c, _d;
    const fiveRsTree = trees.find((t) => frameworkFamily(t.name) === "WIZ_5RS");
    if (!fiveRsTree) {
      return {
        frameworkId: null,
        frameworkName: "",
        policies: [],
        selected: 0,
        total: 0
      };
    }
    const mappedByPolicy = /* @__PURE__ */ new Map();
    for (const tree of trees) {
      if (tree === fiveRsTree) continue;
      if (!isAiFamily(frameworkFamily(tree.name))) continue;
      for (const category of tree.categories) {
        for (const sub of category.subcategories) {
          for (const p of sub.policies) {
            const names = (_a5 = mappedByPolicy.get(p.policyId)) != null ? _a5 : /* @__PURE__ */ new Set();
            names.add(tree.name);
            mappedByPolicy.set(p.policyId, names);
          }
        }
      }
    }
    const aiOpenFindings = findings.filter(
      (f) => isOpenGap(f) && aiAssetIds[f.resourceId] === true
    );
    const findingsByRuleId = /* @__PURE__ */ new Map();
    const findingsByShortId = /* @__PURE__ */ new Map();
    for (const f of aiOpenFindings) {
      if (f.ruleId) pushInto(findingsByRuleId, f.ruleId, f);
      if (f.ruleShortId) pushInto(findingsByShortId, f.ruleShortId, f);
    }
    const pinnedOut = new Set(pins.out);
    const pinnedIn = new Set(pins.in);
    const byPolicy = /* @__PURE__ */ new Map();
    for (const category of fiveRsTree.categories) {
      for (const sub of category.subcategories) {
        for (const p of sub.policies) {
          let acc = byPolicy.get(p.policyId);
          if (!acc) {
            acc = {
              policyId: p.policyId,
              shortId: p.shortId,
              name: p.name,
              policyKind: p.policyKind,
              severity: p.severity,
              categoryExternalId: category.externalId,
              subcategoryExternalId: sub.externalId,
              subcategoryTitle: sub.title,
              failCount: 0
            };
            byPolicy.set(p.policyId, acc);
          }
          if (p.failCount > acc.failCount) acc.failCount = p.failCount;
        }
      }
    }
    const policies = [];
    for (const acc of byPolicy.values()) {
      const mappedBy = [...(_b = mappedByPolicy.get(acc.policyId)) != null ? _b : []].sort();
      const crossMapped = mappedBy.length > 0;
      const matched = /* @__PURE__ */ new Map();
      for (const f of (_c = findingsByRuleId.get(acc.policyId)) != null ? _c : []) matched.set(f.id, f);
      if (acc.shortId) {
        for (const f of (_d = findingsByShortId.get(acc.shortId)) != null ? _d : []) matched.set(f.id, f);
      }
      const aiFindingCount = matched.size;
      let selected;
      let reason;
      if (pinnedOut.has(acc.policyId)) {
        selected = false;
        reason = "pinnedOut";
      } else if (pinnedIn.has(acc.policyId)) {
        selected = true;
        reason = "pinnedIn";
      } else if (crossMapped) {
        selected = true;
        reason = "crossMapped";
      } else if (aiFindingCount > 0) {
        selected = true;
        reason = "linkedFindings";
      } else {
        selected = false;
        reason = "noAiLink";
      }
      policies.push({
        policyId: acc.policyId,
        shortId: acc.shortId,
        name: acc.name,
        policyKind: acc.policyKind,
        severity: acc.severity,
        categoryExternalId: acc.categoryExternalId,
        subcategoryExternalId: acc.subcategoryExternalId,
        subcategoryTitle: acc.subcategoryTitle,
        selected,
        reason,
        mappedBy,
        aiFindingCount,
        failCount: acc.failCount
      });
    }
    policies.sort((a, b) => (a.selected === b.selected ? 0 : a.selected ? 1 : -1) || severityRank3(a.severity) - severityRank3(b.severity) || b.failCount - a.failCount || cmp(a.name, b.name));
    return {
      frameworkId: fiveRsTree.frameworkId,
      frameworkName: fiveRsTree.name,
      policies,
      selected: policies.filter((p) => p.selected).length,
      total: policies.length
    };
  }
  function unselectedPolicyIds(scope) {
    return scope.policies.filter((p) => !p.selected).map((p) => p.policyId);
  }

  // src/domain/scanVars.ts
  var MAX_LIST_VALUES = 40;
  var MAX_VALUE_LEN = 120;
  var ISSUE_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"];
  var ORDER_DIRECTIONS = ["ASC", "DESC"];
  var STEP_VAR_SPECS = [
    {
      stepId: "INVENTORY_AI",
      fields: [
        {
          path: "filterBy.type.equals",
          label: "Resource types",
          help: "The Wiz resource types treated as AI assets. Resolved against this tenant's schema by default; setting them here pins the list instead.",
          kind: "list",
          required: true
        }
      ]
    },
    {
      stepId: "ISSUES_TOXIC",
      fields: [
        {
          path: "filterBy.status",
          label: "Issue status",
          help: "Which issue states to collect. Narrowing to OPEN drops in-progress work from the register and from AARS pillar A.",
          kind: "list",
          options: ISSUE_STATUSES,
          required: true
        },
        {
          path: "filterBy.type",
          label: "Issue types",
          // Optional, and empty is the default: the sync sends no type filter at all, so
          // the category decides what is collected and Wiz's taxonomy does not. Marking it
          // required would be incoherent now — an empty list and an absent one both mean
          // "every type", and only one of them would be rejected.
          help: "Empty (the default) collects every issue type in the AI risk category \u2014 including kinds this register has never modelled, which land in Other AI risk. Naming types here NARROWS that: each one left out disappears from the register total and from AARS pillar A with nothing on the page to mark its absence. Pinning TOXIC_COMBINATION and CLOUD_CONFIGURATION is what once hid every threat detection in the category.",
          kind: "list",
          options: ["TOXIC_COMBINATION", "CLOUD_CONFIGURATION", "THREAT_DETECTION"]
        },
        {
          path: "filterBy.project",
          label: "Project scope",
          help: "Wiz project ids to restrict to. Empty means the whole tenant.",
          kind: "list"
        },
        {
          path: "orderBy.direction",
          label: "Order direction",
          help: "Which end of the severity order the paging walks first.",
          kind: "enum",
          options: ORDER_DIRECTIONS
        }
      ],
      // Deliberately NOT offering filterBy.frameworkCategory. Every figure this app
      // publishes — the issue count, AARS pillar A, the Toxic Combinations page, the tab
      // literally called ai_issues — is scoped to wct-id-1998 and labelled AI. Nothing in
      // the response says "this is an AI issue"; the category filter IS the claim. Widen it
      // and "AI issues" silently means "all issues", with no field to catch it. Same reason
      // AGENTIC_IDENTITIES locks its purpose filter.
      locked: "The AI risk category (wct-id-1998) is fixed: it is what makes these issues AI issues, so widening it would relabel the whole register rather than extend it."
    },
    {
      stepId: "AI_ASSET_PROPERTIES",
      fields: [],
      // The step exists only to fetch the properties bag for the SAME assets INVENTORY_AI
      // already collected. Its type filter is not a knob: narrow it and some assets silently
      // lose their publisher while others keep theirs, which looks like missing data rather
      // than a setting. Widen it and the bag arrives for resources this app does not model.
      locked: "This step mirrors the AI inventory's own type list \u2014 it exists to add two fields to assets already collected, so filtering it separately could only make the two disagree about which assets exist."
    },
    {
      stepId: "CONFIG_FINDINGS",
      fields: [
        {
          path: "filterBy.status",
          label: "Finding status",
          help: "Compliance findings are additionally filtered to result FAIL after they arrive, so widening this collects more rows but stores only failures.",
          kind: "list",
          options: ["OPEN", "RESOLVED", "REJECTED"],
          required: true
        },
        {
          path: "orderBy.direction",
          label: "Order direction",
          help: "Which end of the severity order the paging walks first.",
          kind: "enum",
          options: ORDER_DIRECTIONS
        }
      ]
    },
    {
      stepId: "AGENTIC_IDENTITIES",
      fields: [
        {
          path: "filterBy.type.equals",
          label: "Identity types",
          help: "Which principal types to collect.",
          kind: "list",
          required: true
        }
      ],
      // Still NOT offering filterBy.identityPurpose, but the reason has narrowed. Wiz DOES
      // return the purpose — `IdentityPurposeAgentic`, in the graph entity's properties bag —
      // and Q_PRINCIPALS now selects that bag, so a collected row normally carries its own
      // label. The stamp survives as the fallback for a tenant whose schema rejects
      // `graphEntity`, and that fallback is what a widened filter would turn into a mislabel:
      // every row it collected would come back stamped AGENTIC with nothing to catch it.
      locked: "The agentic-purpose filter is fixed: where the tenant does not return an identity's own purpose the sync falls back to labelling what this query returns as agentic, so widening it would mislabel exactly the identities it could not verify."
    },
    {
      stepId: "SENSITIVE_DATA_ACCESS",
      // No fields at all, so isEditableStep is false and the panel offers no control. Stated
      // here rather than left to fall through, because "nothing to edit" and "editing this
      // would be unsafe" are different facts and only the second one needs saying.
      fields: [],
      locked: "This step has no editable filter: normalizeSensitiveDataAccessPage rebuilds the chain's edges from which entity TYPES a row carries, so a changed selection set would yield confidently wrong edges rather than an error."
    },
    {
      stepId: "CONFIG_RULES",
      fields: [],
      locked: "This step takes no variables at all: it walks Wiz's whole rule catalogue unfiltered, deliberately \u2014 the filter input's type is unverified here, and naming an input type wrong fails the document while sending none cannot."
    },
    {
      stepId: "IDENTITY_HYGIENE",
      // The rule list looks like the obvious knob and is the one thing that must not be one:
      // it is not a preference, it is the resolution of a name match over the synced catalogue,
      // and normalizeIdentityFindingsPage refuses any row whose rule is not in it. An operator
      // who pasted an extra id would get the whole step aborted as an unhonoured filter.
      fields: [],
      locked: "This step's rule list is resolved from the synced rule catalogue by name, not chosen: the normalizer refuses any finding whose rule is not in that resolved set, so an edited list would abort the step rather than widen it."
    },
    {
      stepId: "EFFECTIVE_ACCESS",
      // `accessTypes: [DATA]` is the knob it appears to have. Withheld because the area's prose
      // says "can reach the asset's data" — widening the filter would change what the figure
      // means with nothing on the page to say so, which is the failure the whole Scans page is
      // built to prevent.
      fields: [],
      locked: "This step has no editable filter: its access-type list is what the area's own figure claims to count, so widening it here would change what the number means without changing what the page says it means."
    },
    {
      stepId: "IDENTITY_ACCESS",
      // Its traversal is a $query variable now, so in principle the access-level list is a
      // path an override could reach. Withheld for the reason ENDPOINT_EXPOSURE's is: those two
      // values also live in HUMAN_ACCESS_TYPES (domain/identityQuery.ts), which is what
      // withHumanAccess and withIdentityAccessNodes judge an edge by. Widening the filter would
      // collect READ bindings the figure then refuses to count.
      fields: [],
      locked: "This step has no editable filter: the ADMIN / HIGH_PRIVILEGE bar is applied again when the reach is totalled and drawn, so widening it here would collect bindings that never reach a number."
    },
    {
      stepId: "HOST_EXPOSURE",
      fields: [],
      locked: "This step has no editable filter: normalizeHostExposurePage rebuilds the HOSTED_ON and SERVES edges from which entity TYPES a row carries, and its whole claim is `accessibleFrom.internet` on the compute \u2014 widen that and the step reports unreachable hosts as reachable ones."
    },
    {
      stepId: "ENDPOINT_EXPOSURE",
      // No knob, and the exposure-level list is exactly the knob it looks like it should have.
      // It is withheld because the same two values appear in a SECOND place: RATED_EXPOSURE_LEVELS
      // in domain/exposureQuery.ts, which is what withExposureEvidence tests the returned level
      // against. That double reading is deliberate — ENDPOINT rows also arrive from
      // HOST_EXPOSURE, unfiltered and (in the capture) rated Low, so the bar has to be applied
      // to the payload rather than assumed from the query. An operator who widened the filter
      // here would collect Low-rated endpoints as graph nodes and see the exposure figure not
      // move, which is a worse answer than no knob at all.
      fields: [],
      locked: "This step has no editable filter: the High/Medium bar is also applied to the endpoints the host-exposure step returns unfiltered, so moving it here would widen what is collected without moving what counts as an exposure."
    },
    {
      stepId: "FRAMEWORKS_LIST",
      // Declared with no fields rather than left out of this list entirely: an absent spec
      // renders as the generic "no spec" fallback, which reads as an oversight, and someone
      // will eventually "fix" it. Its only variable is a boolean, and the panel's controls
      // are list/enum — a third field kind bought for one flag that changes nothing about
      // what is collected is not worth the machinery.
      fields: [],
      locked: "This step's only filter picks whether disabled frameworks appear in the Settings picker. It does not decide what posture is collected \u2014 the framework selection does \u2014 so there is nothing here worth tuning per tenant."
    },
    {
      // Matches every generated posture step (COMPLIANCE_POSTURE_wf-id-275, …) so the family
      // shares one lock reason instead of falling through to the generic "no spec" text.
      stepId: "COMPLIANCE_POSTURE_",
      prefix: true,
      fields: [],
      locked: "This step takes no editable variable: its `id` is not a filter \u2014 it selects WHICH framework is fetched, so editing it here would make a step whose name says one framework report another. Choose frameworks in Settings instead."
    }
  ];
  var SPEC_BY_STEP = {};
  for (const spec of STEP_VAR_SPECS) SPEC_BY_STEP[spec.stepId] = spec;
  function varSpecFor(stepId) {
    const exact = SPEC_BY_STEP[stepId];
    if (exact) return exact;
    for (const spec of STEP_VAR_SPECS) {
      if (spec.prefix && stepId.indexOf(spec.stepId) === 0) return spec;
    }
    return null;
  }
  function isEditableStep(stepId) {
    const spec = varSpecFor(stepId);
    return !!spec && spec.fields.length > 0;
  }
  function readPath(obj, path) {
    let cur = obj;
    for (const key of path.split(".")) {
      if (!cur || typeof cur !== "object") return void 0;
      cur = cur[key];
    }
    return cur;
  }
  function writePath(obj, path, value) {
    const keys = path.split(".");
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const next = cur[key];
      if (!next || typeof next !== "object" || Array.isArray(next)) cur[key] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }
  function cleanValue(v) {
    return String(v != null ? v : "").trim().slice(0, MAX_VALUE_LEN);
  }
  function cleanList(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const raw of v) {
      const s = cleanValue(raw);
      if (s && out.indexOf(s) < 0) out.push(s);
      if (out.length >= MAX_LIST_VALUES) break;
    }
    return out;
  }
  function cleanStepVars(stepId, raw) {
    const spec = varSpecFor(stepId);
    if (!spec || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out = {};
    let touched = false;
    for (const field of spec.fields) {
      const value = readPath(raw, field.path);
      if (value === void 0 || value === null) continue;
      if (field.kind === "list") {
        const list2 = cleanList(value);
        writePath(out, field.path, list2);
        touched = true;
      } else {
        const s = cleanValue(value).toUpperCase();
        if (!s) continue;
        if (field.options && field.options.indexOf(s) < 0) continue;
        writePath(out, field.path, s);
        touched = true;
      }
    }
    return touched ? out : null;
  }
  function validateStepVars(stepId, vars) {
    const spec = varSpecFor(stepId);
    if (!spec) return [`${stepId} does not take editable variables.`];
    if (!vars) return [];
    const errors = [];
    for (const field of spec.fields) {
      const value = readPath(vars, field.path);
      if (value === void 0) continue;
      if (field.kind === "list") {
        const list2 = Array.isArray(value) ? value : [];
        if (field.required && !list2.length) {
          errors.push(
            `${field.label} cannot be empty \u2014 an empty filter asks Wiz for everything, which is not what this step normalizes.`
          );
        }
        if (list2.length >= MAX_LIST_VALUES) {
          errors.push(`${field.label} is capped at ${MAX_LIST_VALUES} values.`);
        }
      }
    }
    return errors;
  }
  function effectiveStepVars(stepId, base, override) {
    const clean2 = cleanStepVars(stepId, override);
    if (!clean2) return base;
    const spec = varSpecFor(stepId);
    const merged = JSON.parse(JSON.stringify(base != null ? base : {}));
    for (const field of spec ? spec.fields : []) {
      const value = readPath(clean2, field.path);
      if (value === void 0) continue;
      writePath(merged, field.path, value);
    }
    return merged;
  }
  function changedPaths(stepId, base, override) {
    const clean2 = cleanStepVars(stepId, override);
    if (!clean2) return [];
    const spec = varSpecFor(stepId);
    const out = [];
    for (const field of spec ? spec.fields : []) {
      const next = readPath(clean2, field.path);
      if (next === void 0) continue;
      if (JSON.stringify(next) !== JSON.stringify(readPath(base, field.path))) out.push(field.path);
    }
    return out;
  }

  // src/domain/settingsLogic.ts
  function clampDepth(v) {
    return clampInt(v, DEPTH_DEFAULT, DEPTH_MIN, DEPTH_MAX);
  }
  function getDefaultDepth(settings) {
    var _a5;
    return clampDepth((_a5 = settings["default_depth"]) != null ? _a5 : DEPTH_DEFAULT);
  }
  function withDefaultDepth(settings, depth) {
    return { ...settings, default_depth: clampDepth(depth) };
  }
  function clampMaxNodes(v) {
    return clampInt(v, MAX_NODES_DEFAULT, MAX_NODES_FLOOR, MAX_NODES_CEILING);
  }
  function getMaxNodes(settings) {
    var _a5;
    return clampMaxNodes((_a5 = settings["max_nodes"]) != null ? _a5 : MAX_NODES_DEFAULT);
  }
  function withMaxNodes(settings, maxNodes) {
    return { ...settings, max_nodes: clampMaxNodes(maxNodes) };
  }
  function getAutoExpand(settings) {
    return settings["auto_expand"] !== false;
  }
  function withAutoExpand(settings, on) {
    return { ...settings, auto_expand: on === true };
  }
  function getAarsRule(settings) {
    const raw = settings["aars_rule"];
    if (!raw || typeof raw !== "object") {
      return { version: 0, rule: cleanAarsRule(DEFAULT_AARS_RULE) };
    }
    const stored = raw;
    const version = Number(stored["version"]);
    return {
      version: Number.isFinite(version) && version > 0 ? Math.round(version) : 0,
      rule: cleanAarsRule(stored["rule"])
    };
  }
  function withAarsRule(settings, rule) {
    const current = getAarsRule(settings);
    return {
      ...settings,
      aars_rule: { version: current.version + 1, rule: cleanAarsRule(rule) }
    };
  }
  function getScoredRuleVersion(settings) {
    const v = Number(settings["aars_scored_version"]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  }
  function withScoredRuleVersion(settings, version) {
    const v = Number(version);
    return {
      ...settings,
      aars_scored_version: Number.isFinite(v) && v > 0 ? Math.round(v) : 0
    };
  }
  var CONFIG_RULES_TTL_MS = 30 * 864e5;
  function getConfigRulesSyncedAt(settings) {
    const v = Number(settings["config_rules_synced_at"]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  }
  function withConfigRulesSyncedAt(settings, at) {
    const v = Number(at);
    return {
      ...settings,
      config_rules_synced_at: Number.isFinite(v) && v > 0 ? Math.round(v) : 0
    };
  }
  function configRulesAreFresh(settings, hasRows, now) {
    if (!hasRows) return false;
    const at = getConfigRulesSyncedAt(settings);
    if (!at) return false;
    return now - at < CONFIG_RULES_TTL_MS;
  }
  function getScanVars(settings) {
    const raw = settings["scan_vars"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [stepId, value] of Object.entries(raw)) {
      const clean2 = cleanStepVars(stepId, value);
      if (clean2) out[stepId] = clean2;
    }
    return out;
  }
  function getSkippedSteps(settings) {
    const raw = settings["last_skipped_steps"];
    if (!Array.isArray(raw)) return [];
    return raw.map((v) => String(v != null ? v : "")).filter(Boolean);
  }
  function withSkippedSteps(settings, steps) {
    const list2 = Array.isArray(steps) ? steps.map((v) => String(v != null ? v : "")).filter(Boolean) : [];
    return { ...settings, last_skipped_steps: list2 };
  }
  function getTruncatedSteps(settings) {
    const raw = settings["last_truncated_steps"];
    if (!Array.isArray(raw)) return [];
    return raw.map((v) => String(v != null ? v : "")).filter(Boolean);
  }
  function withTruncatedSteps(settings, steps) {
    const list2 = Array.isArray(steps) ? steps.map((v) => String(v != null ? v : "")).filter(Boolean) : [];
    return { ...settings, last_truncated_steps: list2 };
  }
  var DEFAULT_FRAMEWORK_IDS = [
    "wf-id-275",
    // OWASP Top 10 For Agentic Applications 2026
    "wf-id-201",
    // OWASP LLM Security Top 10
    "wf-id-214",
    // 5Rs - Wiz for Data Security
    "wf-id-106"
    // OWASP ML Security Top 10
  ];
  function getSelectedFrameworks(settings) {
    const raw = settings["selected_frameworks"];
    if (!Array.isArray(raw)) return DEFAULT_FRAMEWORK_IDS.slice();
    return raw.map((v) => String(v != null ? v : "")).filter(Boolean);
  }
  function resolveDefaultFrameworks(catalogue) {
    var _a5;
    const wanted = ["AGENTIC", "LLM", "5R", "ML"];
    const picked = [];
    for (const want of wanted) {
      for (const f of catalogue) {
        const n = String((_a5 = f.name) != null ? _a5 : "").toUpperCase();
        const hit = want === "5R" ? /\b5\s?RS?\b/.test(n) : want === "ML" ? n.includes("MACHINE LEARNING") || /\bML\b/.test(n) : want === "LLM" ? n.includes("LLM") : n.includes("AGENTIC");
        if (hit && picked.indexOf(f.id) === -1) {
          picked.push(f.id);
          break;
        }
      }
    }
    return picked.length ? picked : DEFAULT_FRAMEWORK_IDS.slice();
  }
  function withSelectedFrameworks(settings, ids) {
    const list2 = Array.isArray(ids) ? ids.map((v) => String(v != null ? v : "").trim()).filter(Boolean) : [];
    const seen = {};
    const deduped = list2.filter((id) => seen[id] ? false : seen[id] = true);
    return { ...settings, selected_frameworks: deduped };
  }
  function withScanVars(settings, stepId, vars) {
    const current = getScanVars(settings);
    const clean2 = cleanStepVars(stepId, vars);
    const next = { ...current };
    if (clean2) next[stepId] = clean2;
    else delete next[stepId];
    return { ...settings, scan_vars: next };
  }
  function coercePinList(v) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const raw of v) {
      const s = String(raw != null ? raw : "").trim();
      if (s && out.indexOf(s) === -1) out.push(s);
    }
    return out;
  }
  function coercePins(raw) {
    const rec2 = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const inList = coercePinList(rec2["in"]);
    const outList = coercePinList(rec2["out"]);
    const outSet = new Set(outList);
    return { in: inList.filter((id) => !outSet.has(id)), out: outList };
  }
  function getFiveRsPins(settings) {
    return coercePins(settings["five_rs_policy_pins"]);
  }
  function withFiveRsPins(settings, pins) {
    return { ...settings, five_rs_policy_pins: coercePins(pins) };
  }
  function cleanFiveRsPins(pins, knownPolicyIds) {
    const known = new Set(knownPolicyIds);
    const base = coercePins(pins);
    return {
      in: base.in.filter((id) => known.has(id)),
      out: base.out.filter((id) => known.has(id))
    };
  }

  // src/domain/compliancePosture.ts
  function postureState(posturePct2, emptyPostureReason) {
    const reason = String(emptyPostureReason != null ? emptyPostureReason : "").trim().toUpperCase();
    if (reason === "NO_RESOURCES") return "noResources";
    if (reason === "NO_POLICIES") return "noPolicies";
    if (reason) return "unknown";
    return posturePct2 === null ? "unknown" : "scored";
  }
  function titleRepeatsExternalId(externalId, title) {
    const id = String(externalId != null ? externalId : "").trim();
    const t = String(title != null ? title : "").trim();
    if (!id || !t) return false;
    if (!(t.toUpperCase().indexOf(id.toUpperCase()) === 0)) return false;
    const next = t.charAt(id.length);
    return next === "" || next === " " || next === "	";
  }
  function severityRank4(s) {
    const i = SEVERITY_ORDER.indexOf(s);
    return i === -1 ? SEVERITY_ORDER.length : i;
  }
  function emptyStateCounts() {
    return { scored: 0, noResources: 0, noPolicies: 0, unknown: 0 };
  }
  function isAssessedPolicy(p) {
    return p.assessedCount > 0 || p.passCount > 0 || p.failCount > 0 || p.rejectedCount > 0;
  }
  function toNode(row, externalId) {
    return {
      frameworkId: row.frameworkId,
      externalId,
      // Suppressed when the title already opens with it, so an OWASP LLM row reads
      // "1 LLM01:2025 Prompt Injection" rather than "11 LLM01:2025 Prompt Injection".
      showExternalId: !titleRepeatsExternalId(externalId, row.title),
      title: row.title,
      description: row.description,
      posturePct: row.posturePct,
      state: postureState(row.posturePct, row.emptyPostureReason),
      passCount: row.passCount,
      failCount: row.failCount,
      emptyPostureReason: row.emptyPostureReason
    };
  }
  function buildFrameworkTree(frameworkId, posture, policies, frameworks = []) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o;
    const rows = posture.filter((p) => p.frameworkId === frameworkId);
    if (!rows.length) return null;
    const frameworkRow = rows.find((p) => p.level === "framework");
    const catalogue = frameworks.find((f) => f.id === frameworkId);
    const policiesBySub = /* @__PURE__ */ new Map();
    for (const p of policies) {
      if (p.frameworkId !== frameworkId) continue;
      const list2 = (_a5 = policiesBySub.get(p.subcategoryExternalId)) != null ? _a5 : [];
      list2.push(p);
      policiesBySub.set(p.subcategoryExternalId, list2);
    }
    const stateCounts = emptyStateCounts();
    const unassessedIds = /* @__PURE__ */ new Set();
    const subsByCategory = /* @__PURE__ */ new Map();
    for (const row of rows) {
      if (row.level !== "subcategory") continue;
      const externalId = (_b = row.subcategoryExternalId) != null ? _b : "";
      const raw = (_c = policiesBySub.get(externalId)) != null ? _c : [];
      const seen = /* @__PURE__ */ new Set();
      const deduped = raw.filter((p) => {
        if (seen.has(p.policyId)) return false;
        seen.add(p.policyId);
        return true;
      });
      deduped.sort(
        (a, b) => severityRank4(a.severity) - severityRank4(b.severity) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      );
      const assessed = [];
      for (const p of deduped) {
        if (isAssessedPolicy(p)) assessed.push(p);
        else unassessedIds.add(p.policyId);
      }
      const node2 = {
        ...toNode(row, externalId),
        assessmentScope: row.assessmentScope,
        mappingRationale: row.mappingRationale,
        policies: assessed,
        failingPolicyCount: assessed.filter((p) => p.failCount > 0).length,
        unassessedPolicyCount: deduped.length - assessed.length
      };
      stateCounts[node2.state] += 1;
      if (node2.state !== "scored") continue;
      const key = (_d = row.categoryExternalId) != null ? _d : "";
      const list2 = (_e = subsByCategory.get(key)) != null ? _e : [];
      list2.push(node2);
      subsByCategory.set(key, list2);
    }
    const categories = rows.filter((r) => r.level === "category").map((row) => {
      var _a6, _b2;
      const externalId = (_a6 = row.categoryExternalId) != null ? _a6 : "";
      const subcategories = (_b2 = subsByCategory.get(externalId)) != null ? _b2 : [];
      return {
        ...toNode(row, externalId),
        subcategories,
        mirrorsCategory: subcategories.length === 1 && subcategories[0].externalId === externalId
      };
    }).filter((cat) => cat.subcategories.length > 0);
    const distinct = /* @__PURE__ */ new Map();
    let worstFailingSeverity = null;
    let worstFailingRank = Infinity;
    for (const cat of categories) {
      for (const sub of cat.subcategories) {
        for (const p of sub.policies) {
          distinct.set(p.policyId, ((_f = distinct.get(p.policyId)) != null ? _f : false) || p.failCount > 0);
          if (p.failCount > 0) {
            const rank = severityRank4(p.severity);
            if (rank < worstFailingRank) {
              worstFailingRank = rank;
              worstFailingSeverity = p.severity;
            }
          }
        }
      }
    }
    return {
      frameworkId,
      name: (_h = (_g = frameworkRow == null ? void 0 : frameworkRow.title) != null ? _g : catalogue == null ? void 0 : catalogue.name) != null ? _h : frameworkId,
      description: (_i = frameworkRow == null ? void 0 : frameworkRow.description) != null ? _i : catalogue == null ? void 0 : catalogue.description,
      posturePct: (_j = frameworkRow == null ? void 0 : frameworkRow.posturePct) != null ? _j : null,
      state: postureState(
        (_k = frameworkRow == null ? void 0 : frameworkRow.posturePct) != null ? _k : null,
        (_l = frameworkRow == null ? void 0 : frameworkRow.emptyPostureReason) != null ? _l : null
      ),
      emptyPostureReason: (_m = frameworkRow == null ? void 0 : frameworkRow.emptyPostureReason) != null ? _m : null,
      passSubCategoryCount: (_n = frameworkRow == null ? void 0 : frameworkRow.passSubCategoryCount) != null ? _n : 0,
      failSubCategoryCount: (_o = frameworkRow == null ? void 0 : frameworkRow.failSubCategoryCount) != null ? _o : 0,
      categories,
      stateCounts,
      policyCount: distinct.size,
      failingPolicyCount: [...distinct.values()].filter(Boolean).length,
      // Only ids that appear NOWHERE in the listed tree. A control mapped under six
      // subcategories and evaluated under one of them is a listed policy, not a dropped one,
      // and counting it in both places would describe the same rule twice.
      unassessedPolicyCount: [...unassessedIds].filter((id) => !distinct.has(id)).length,
      worstFailingSeverity
    };
  }
  function buildAllFrameworkTrees(posture, policies, frameworks = []) {
    const ids = [];
    for (const p of posture) if (ids.indexOf(p.frameworkId) === -1) ids.push(p.frameworkId);
    const trees = ids.map((id) => buildFrameworkTree(id, posture, policies, frameworks)).filter((t) => t !== null);
    trees.sort((a, b) => {
      if (a.posturePct === null && b.posturePct === null) return a.name < b.name ? -1 : 1;
      if (a.posturePct === null) return 1;
      if (b.posturePct === null) return -1;
      return a.posturePct - b.posturePct || (a.name < b.name ? -1 : 1);
    });
    return trees;
  }
  function complianceKpis(posture, policies = []) {
    const frameworkRows = posture.filter((p) => p.level === "framework");
    const scored = frameworkRows.filter(
      (p) => postureState(p.posturePct, p.emptyPostureReason) === "scored"
    );
    const averagePosture = scored.length ? Math.round(scored.reduce((sum, p) => {
      var _a5;
      return sum + ((_a5 = p.posturePct) != null ? _a5 : 0);
    }, 0) / scored.length) : null;
    const failingSubcategories = posture.filter(
      (p) => p.level === "subcategory" && p.failCount > 0
    ).length;
    const failing = /* @__PURE__ */ new Set();
    for (const p of policies) if (p.failCount > 0) failing.add(p.policyId);
    return {
      frameworks: frameworkRows.length,
      scoredFrameworks: scored.length,
      averagePosture,
      failingSubcategories,
      failingPolicies: failing.size
    };
  }

  // src/domain/graphProject.ts
  var DEFAULT_PER_KIND_CAP = {
    USER_ACCOUNT: 8,
    BUCKET: 6,
    // Same cap as BUCKET: the sensitive-data chain makes databases a real fan-out target for
    // the first time — before it, no live query produced one at all.
    DATABASE: 6,
    DATABASE_SERVER: 6,
    ACCESS_ROLE_BINDING: 5
  };
  var DEFAULT_KIND_CAP = 12;
  function nodeOrder(a, b) {
    var _a5, _b;
    const sev = severityRank(a.severity) - severityRank(b.severity);
    if (sev !== 0) return sev;
    const aars = ((_a5 = b.aars) != null ? _a5 : -1) - ((_b = a.aars) != null ? _b : -1);
    if (aars !== 0) return aars;
    return cmp(a.name, b.name);
  }
  function passesFilters(node2, f) {
    var _a5, _b, _c, _d, _e, _f, _g, _h;
    if (!f) return true;
    if (isRiskKind(node2.kind) && !((_a5 = f.kinds) == null ? void 0 : _a5.some(isRiskKind))) return true;
    if (((_b = f.severities) == null ? void 0 : _b.length) && !f.severities.includes((_c = node2.severity) != null ? _c : "")) return false;
    if (((_d = f.kinds) == null ? void 0 : _d.length) && !f.kinds.includes(node2.kind)) return false;
    if (((_e = f.clouds) == null ? void 0 : _e.length) && !f.clouds.includes((_f = node2.cloudPlatform) != null ? _f : "")) return false;
    if ((_g = f.projects) == null ? void 0 : _g.length) {
      const names = ((_h = node2.projects) != null ? _h : []).map((p) => p.name);
      if (!names.some((n) => f.projects.includes(n))) return false;
    }
    return true;
  }
  function projectGraph(doc, opts) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    const byId = indexBy(doc.nodes, (n) => n.id);
    const adjacency = /* @__PURE__ */ new Map();
    const sortedEdges = [...doc.edges].sort(cmpBy((e) => e.id));
    for (const edge2 of sortedEdges) {
      if (!byId.has(edge2.src) || !byId.has(edge2.dst)) continue;
      if (!adjacency.has(edge2.src)) adjacency.set(edge2.src, []);
      if (!adjacency.has(edge2.dst)) adjacency.set(edge2.dst, []);
      adjacency.get(edge2.src).push({ edge: edge2, otherId: edge2.dst });
      adjacency.get(edge2.dst).push({ edge: edge2, otherId: edge2.src });
    }
    const maxNodes = (_a5 = opts.maxNodes) != null ? _a5 : MAX_NODES_DEFAULT;
    const maxEdges = (_b = opts.maxEdges) != null ? _b : MAX_EDGES_DEFAULT;
    const expand = new Set((_c = opts.expandIds) != null ? _c : []);
    let capped = false;
    const shown = /* @__PURE__ */ new Set();
    const summaries = [];
    const summaryNodes = [];
    const summaryEdges = [];
    const queue = [];
    const atNodeBudget = () => shown.size + summaryNodes.length >= maxNodes;
    const orderedSeeds = opts.seedIds.map((id) => byId.get(id)).filter((n) => !!n && (!opts.filterSeeds || passesFilters(n, opts.filters))).sort(nodeOrder);
    const seedWave = Math.max(1, Math.floor(maxNodes * SEED_WAVE_RATIO));
    let seedCursor = 0;
    function admitSeedWave() {
      let admitted = 0;
      while (admitted < seedWave && seedCursor < orderedSeeds.length) {
        const seed = orderedSeeds[seedCursor];
        if (shown.has(seed.id)) {
          seedCursor++;
          continue;
        }
        if (atNodeBudget()) return;
        shown.add(seed.id);
        queue.push({ id: seed.id, depth: 0 });
        seedCursor++;
        admitted++;
      }
    }
    do {
      admitSeedWave();
      while (queue.length) {
        const { id, depth } = queue.shift();
        if (depth >= opts.depth && !expand.has(id)) continue;
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
            if (atNodeBudget()) {
              capped = true;
              break;
            }
            shown.add(member.id);
            queue.push({
              id: member.id,
              depth: expand.has(id) ? Math.max(depth + 1, opts.depth) : depth + 1
            });
          }
          const hidden = members.filter((m) => !shown.has(m.id));
          if (hidden.length) {
            if (!overflow) {
              capped = true;
              continue;
            }
            if (atNodeBudget() || summaryEdges.length >= maxEdges) {
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
    } while (seedCursor < orderedSeeds.length && !atNodeBudget());
    if (seedCursor < orderedSeeds.length) capped = true;
    const inducedBudget = Math.max(0, maxEdges - summaryEdges.length);
    const edges2 = [];
    const seenEdge = /* @__PURE__ */ new Set();
    for (const edge2 of sortedEdges) {
      if (!shown.has(edge2.src) || !shown.has(edge2.dst)) continue;
      if (seenEdge.has(edge2.id)) continue;
      seenEdge.add(edge2.id);
      if (edges2.length >= inducedBudget) {
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
  var LAYOUT_MODES = ["lanes", "grouped", "rows"];
  var GROUP_KEYS = ["asset", "combo", "project", "cloud", "kind", "severity"];
  var SORT_KEYS = ["smart", "severity", "aars", "name"];
  var GROUP_NONE = "__none__";
  var LANE_OF = {
    ISSUE: 0,
    EXCESSIVE_ACCESS_FINDING: 0,
    IDENTITY_ACCESS_FINDING: 0,
    LATERAL_MOVEMENT_FINDING: 0,
    EXCESSIVE_PRIVILEGE: 0,
    MISSING_GUARDRAIL: 0,
    INTERNET_EXPOSURE: 0,
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
    DATABASE_SERVER: 3,
    SENSITIVE_DATA: 3,
    // The bands ARE the path, read left to right, and the data-exposure chain ends here:
    // agent (1) → identity (2) → classified store (3) → what was found in it (4). Filing data
    // findings with the other evidence in band 0 would make the graph's most important edge
    // its longest, running back across the whole canvas from the store it describes.
    DATA_FINDING: 4,
    VIRTUAL_MACHINE: 5,
    SERVERLESS: 5,
    CONTAINER_IMAGE: 5,
    REPOSITORY: 5,
    // Beside the compute that serves it. An endpoint is the far edge of the estate, but it is
    // inventory rather than evidence, so it belongs in the infrastructure band and not in the
    // risk band where INTERNET_EXPOSURE sits.
    ENDPOINT: 5
  };
  var LANE_COUNT = 6;
  function laneOf(kind, summaryOf) {
    var _a5, _b;
    if (kind === "SUMMARY" && summaryOf) return (_a5 = LANE_OF[summaryOf]) != null ? _a5 : 2;
    return (_b = LANE_OF[kind]) != null ? _b : 2;
  }
  var BARYCENTER_SWEEPS = 3;
  var ROW_COL_STEP = 260;
  var ROW_BAND_GAP = 150;
  var ROW_CLUSTER_GAP = 140;
  var LANE_CLUSTER_GAP = 48;
  var ROW_SHELF_GAP = 200;
  var LANE_SHELF_GAP = 200;
  var VIEWPORT_ASPECT = 1.9;
  var CELL_W = 240;
  var CELL_H = 84;
  var GROUP_PAD = 24;
  var HEADER_H = 30;
  var BLOCK_GAP_X = 48;
  var BLOCK_GAP_Y = 64;
  var MAX_SHELF_W = 1600;
  function cmpName(a, b) {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  }
  function cmpId(a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  function comparator(sort) {
    if (sort === "severity") {
      return (a, b) => severityRank(a.severity) - severityRank(b.severity) || cmpName(a, b) || cmpId(a, b);
    }
    if (sort === "aars") {
      return (a, b) => {
        var _a5, _b;
        return ((_a5 = b.aars) != null ? _a5 : -1) - ((_b = a.aars) != null ? _b : -1) || cmpName(a, b) || cmpId(a, b);
      };
    }
    if (sort === "name") {
      return (a, b) => cmpName(a, b) || cmpId(a, b);
    }
    return (a, b) => nodeOrder(a, b) || cmpId(a, b);
  }
  function parentIndex(p) {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const parentOf = /* @__PURE__ */ new Map();
    for (const e of [...p.edges].sort((a, b) => a.id < b.id ? -1 : 1)) {
      const dst = byId.get(e.dst);
      const src = byId.get(e.src);
      if (!dst || !src || !isRiskKind(dst.kind) || parentOf.has(dst.id)) continue;
      parentOf.set(dst.id, src);
    }
    for (const s of p.summaries) {
      const parent = byId.get(s.parentId);
      if (parent) parentOf.set(s.id, parent);
    }
    return parentOf;
  }
  function componentRoots(p) {
    const parent = /* @__PURE__ */ new Map();
    for (const n of p.nodes) parent.set(n.id, n.id);
    const find = (x) => {
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root);
      while (parent.get(x) !== root) {
        const next = parent.get(x);
        parent.set(x, root);
        x = next;
      }
      return root;
    };
    for (const e of [...p.edges].sort((a, b) => a.id < b.id ? -1 : 1)) {
      if (!parent.has(e.src) || !parent.has(e.dst)) continue;
      const a = find(e.src);
      const b = find(e.dst);
      if (a !== b) parent.set(a, b);
    }
    const roots = /* @__PURE__ */ new Map();
    for (const n of p.nodes) roots.set(n.id, find(n.id));
    return roots;
  }
  function clusterRanks(p) {
    var _a5, _b, _c, _d, _e, _f, _g;
    const { hubOf } = assignToHubs(p, parentIndex(p));
    const roots = componentRoots(p);
    const degree = /* @__PURE__ */ new Map();
    for (const e of p.edges) {
      degree.set(e.src, ((_a5 = degree.get(e.src)) != null ? _a5 : 0) + 1);
      degree.set(e.dst, ((_b = degree.get(e.dst)) != null ? _b : 0) + 1);
    }
    const keyOf = /* @__PURE__ */ new Map();
    for (const node2 of p.nodes) {
      keyOf.set(node2.id, (_c = hubOf.get(node2.id)) != null ? _c : "cc:" + roots.get(node2.id));
    }
    const sharedEdges = (key) => {
      var _a6, _b2;
      const out = /* @__PURE__ */ new Map();
      for (const e of [...p.edges].sort((a, b) => a.id < b.id ? -1 : 1)) {
        const a = key(e.src);
        const b = key(e.dst);
        if (!a || !b || a === b) continue;
        if (!out.has(a)) out.set(a, /* @__PURE__ */ new Map());
        if (!out.has(b)) out.set(b, /* @__PURE__ */ new Map());
        out.get(a).set(b, ((_a6 = out.get(a).get(b)) != null ? _a6 : 0) + 1);
        out.get(b).set(a, ((_b2 = out.get(b).get(a)) != null ? _b2 : 0) + 1);
      }
      return out;
    };
    const merged = new Map([...keyOf.values()].map((k) => [k, k]));
    const resolve = (k) => {
      let root = k;
      while (merged.get(root) !== root) root = merged.get(root);
      return root;
    };
    const groupBy2 = (key) => {
      const out = /* @__PURE__ */ new Map();
      for (const node2 of p.nodes) {
        const k = key(node2.id);
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(node2);
      }
      return out;
    };
    const initial = groupBy2((id) => keyOf.get(id));
    const initialShared = sharedEdges((id) => keyOf.get(id));
    for (const key of [...initial.keys()].sort()) {
      const list2 = initial.get(key);
      if (list2.length !== 1 || !((_d = degree.get(list2[0].id)) != null ? _d : 0)) continue;
      let best = 0;
      let target = "";
      for (const [other, weight] of [...(_e = initialShared.get(key)) != null ? _e : /* @__PURE__ */ new Map()].sort()) {
        if (resolve(other) === resolve(key) || weight <= best) continue;
        best = weight;
        target = other;
      }
      if (target) merged.set(resolve(key), resolve(target));
    }
    const finalKey = (id) => resolve(keyOf.get(id));
    const members = groupBy2(finalKey);
    const shared = sharedEdges(finalKey);
    const worst = (key) => {
      var _a6;
      let rank = SEVERITY_ORDER.length;
      for (const n of (_a6 = members.get(key)) != null ? _a6 : []) rank = Math.min(rank, severityRank(n.severity));
      return rank;
    };
    const keys = [...members.keys()].filter((k) => members.get(k).length > 1).sort((a, b) => worst(a) - worst(b) || members.get(b).length - members.get(a).length || (a < b ? -1 : a > b ? 1 : 0));
    const chain = [];
    const unplaced = new Set(keys);
    while (unplaced.size) {
      let pick2 = "";
      let anchor = chain.length - 1;
      let best = 0;
      for (const k of keys) {
        if (!unplaced.has(k)) continue;
        const links = shared.get(k);
        if (!links) continue;
        for (let i = 0; i < chain.length; i++) {
          const weight = (_f = links.get(chain[i])) != null ? _f : 0;
          if (weight > best) {
            best = weight;
            pick2 = k;
            anchor = i;
          }
        }
      }
      if (!pick2) {
        pick2 = keys.find((k) => unplaced.has(k));
        anchor = chain.length - 1;
      }
      chain.splice(anchor + 1, 0, pick2);
      unplaced.delete(pick2);
    }
    const rankOfKey = new Map(chain.map((k, i) => [k, i]));
    const tail = chain.length;
    const ranks = /* @__PURE__ */ new Map();
    for (const node2 of p.nodes) {
      ranks.set(node2.id, (_g = rankOfKey.get(finalKey(node2.id))) != null ? _g : tail);
    }
    return ranks;
  }
  function packLanes(lanes, rankOf, step, gap2, bandSpan, shelfGap, pad, horizontal) {
    var _a5, _b, _c, _d, _e;
    const pos = /* @__PURE__ */ new Map();
    const shelfOf = /* @__PURE__ */ new Map();
    if (!rankOf) {
      const widest = Math.max(1, ...lanes.map((l) => l.length));
      for (const lane of lanes) {
        const offset = (widest - lane.length) * step / 2;
        lane.forEach((id, i) => {
          pos.set(id, offset + i * step);
          shelfOf.set(id, 0);
        });
      }
      return { pos, shelfOf, extent: (widest - 1) * step, shelves: 1 };
    }
    const slots = /* @__PURE__ */ new Map();
    for (const lane of lanes) {
      const perRank = /* @__PURE__ */ new Map();
      for (const id of lane) {
        const r = (_a5 = rankOf.get(id)) != null ? _a5 : 0;
        perRank.set(r, ((_b = perRank.get(r)) != null ? _b : 0) + 1);
      }
      for (const [r, count2] of perRank) slots.set(r, Math.max((_c = slots.get(r)) != null ? _c : 0, count2));
    }
    const ranks = [...slots.keys()].sort((a, b) => a - b);
    if (!ranks.length) return { pos, shelfOf, extent: 0, shelves: 1 };
    const runLength = ranks.reduce((acc, r) => acc + slots.get(r) * step + gap2, 0) - gap2;
    let best = null;
    let bestFit = 0;
    let cumulative = 0;
    for (let i = 0; i < ranks.length; i++) {
      cumulative += slots.get(ranks[i]) * step + (i ? gap2 : 0);
      const plan = wrapRun(ranks, slots, step, gap2, cumulative);
      const along = plan.longest + pad;
      const across = (plan.shelves - 1) * (bandSpan + shelfGap) + bandSpan + pad;
      const fit = horizontal ? Math.min(VIEWPORT_ASPECT / along, 1 / across) : Math.min(VIEWPORT_ASPECT / across, 1 / along);
      if (fit > bestFit * (1 + 1e-9)) {
        bestFit = fit;
        best = plan;
      }
    }
    const { start, shelfOfRank } = best;
    const shelf = best.shelves - 1;
    let extent = 0;
    for (const lane of lanes) {
      let i = 0;
      while (i < lane.length) {
        const r = (_d = rankOf.get(lane[i])) != null ? _d : 0;
        let j = i;
        while (j < lane.length && ((_e = rankOf.get(lane[j])) != null ? _e : 0) === r) j++;
        const offset = start.get(r) + (slots.get(r) - (j - i)) * step / 2;
        for (let k = i; k < j; k++) {
          const at = offset + (k - i) * step;
          pos.set(lane[k], at);
          shelfOf.set(lane[k], shelfOfRank.get(r));
          extent = Math.max(extent, at);
        }
        i = j;
      }
    }
    return { pos, shelfOf, extent, shelves: shelf + 1 };
  }
  function wrapRun(ranks, slots, step, gap2, target) {
    const start = /* @__PURE__ */ new Map();
    const shelfOfRank = /* @__PURE__ */ new Map();
    let shelf = 0;
    let cursor = 0;
    let longest = 0;
    for (const r of ranks) {
      const length = slots.get(r) * step;
      if (cursor > 0 && cursor + length > target) {
        shelf++;
        cursor = 0;
      }
      shelfOfRank.set(r, shelf);
      start.set(r, cursor);
      cursor += length + gap2;
      longest = Math.max(longest, cursor - gap2);
    }
    return { start, shelfOfRank, shelves: shelf + 1, longest };
  }
  function layoutGraph(p, opts = {}) {
    var _a5;
    const mode = (_a5 = opts.mode) != null ? _a5 : "rows";
    if (mode === "grouped") return layoutGrouped(p, opts);
    return layoutLanes(p, opts, mode !== "lanes");
  }
  function layoutLanes(p, opts, horizontal) {
    var _a5, _b, _c, _d, _e, _f;
    const laneGap = (_a5 = opts.laneGap) != null ? _a5 : 280;
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
          const score2 = /* @__PURE__ */ new Map();
          for (const id of lane) {
            const others = ((_e = neighbors.get(id)) != null ? _e : []).filter(
              (n) => laneIndex.get(n) !== laneIndex.get(id) && rowOf.has(n)
            );
            score2.set(
              id,
              others.length ? others.reduce((acc, n) => {
                var _a6;
                return acc + ((_a6 = rowOf.get(n)) != null ? _a6 : 0);
              }, 0) / others.length : (_f = rowOf.get(id)) != null ? _f : 0
            );
          }
          lane.sort((a, b) => {
            var _a6, _b2, _c2, _d2;
            const d = ((_a6 = score2.get(a)) != null ? _a6 : 0) - ((_b2 = score2.get(b)) != null ? _b2 : 0);
            if (d !== 0) return d;
            return ((_c2 = rowOf.get(a)) != null ? _c2 : 0) - ((_d2 = rowOf.get(b)) != null ? _d2 : 0);
          });
          refreshRows();
        }
      }
    } else {
      const byId = new Map(p.nodes.map((n) => [n.id, n]));
      const cmp2 = comparator(sort);
      for (const lane of lanes) {
        lane.sort((a, b) => cmp2(byId.get(a), byId.get(b)));
      }
    }
    const rankOf = sort === "smart" ? clusterRanks(p) : null;
    if (rankOf) {
      for (const lane of lanes) {
        lane.sort((a, b) => {
          var _a6, _b2;
          return ((_a6 = rankOf.get(a)) != null ? _a6 : 0) - ((_b2 = rankOf.get(b)) != null ? _b2 : 0);
        });
      }
    }
    const step = horizontal ? ROW_COL_STEP : rowGap;
    const gap2 = horizontal ? ROW_CLUSTER_GAP : LANE_CLUSTER_GAP;
    const bandGap = horizontal ? ROW_BAND_GAP : laneGap;
    const bandSpan = (LANE_COUNT - 1) * bandGap;
    const shelfPitch = bandSpan + (horizontal ? ROW_SHELF_GAP : LANE_SHELF_GAP);
    const { pos, shelfOf, extent, shelves } = packLanes(
      lanes,
      rankOf,
      step,
      rankOf ? gap2 : 0,
      bandSpan,
      horizontal ? ROW_SHELF_GAP : LANE_SHELF_GAP,
      margin * 2,
      horizontal
    );
    const nodes = [];
    for (let shelf = 0; shelf < shelves; shelf++) {
      lanes.forEach((lane, laneIdx) => {
        for (const id of lane) {
          if (shelfOf.get(id) !== shelf) continue;
          const along = margin + pos.get(id);
          const across = margin + shelf * shelfPitch + laneIdx * bandGap;
          nodes.push({
            id,
            lane: laneIdx,
            cluster: rankOf == null ? void 0 : rankOf.get(id),
            shelf: shelves > 1 ? shelf : void 0,
            x: horizontal ? along : across,
            y: horizontal ? across : along
          });
        }
      });
    }
    const alongSize = margin * 2 + extent;
    const acrossSize = margin * 2 + (shelves - 1) * shelfPitch + bandSpan;
    return horizontal ? {
      nodes,
      width: alongSize,
      height: acrossSize,
      laneGap: ROW_BAND_GAP,
      rowGap: ROW_COL_STEP,
      mode: "rows"
    } : {
      nodes,
      width: acrossSize,
      height: alongSize,
      laneGap,
      rowGap,
      mode: "lanes"
    };
  }
  function groupKeyOf(node2, groupBy2, parentOf) {
    if ((node2.kind === "SUMMARY" || isRiskKind(node2.kind)) && groupBy2 !== "kind") {
      const own = ownGroupKey(node2, groupBy2);
      if (own !== GROUP_NONE) return own;
      const parent = parentOf.get(node2.id);
      return parent ? groupKeyOf(parent, groupBy2, parentOf) : GROUP_NONE;
    }
    return ownGroupKey(node2, groupBy2);
  }
  function ownGroupKey(node2, groupBy2) {
    var _a5, _b, _c, _d, _e, _f, _g;
    switch (groupBy2) {
      case "combo": {
        const groups = [...(_a5 = node2.comboGroups) != null ? _a5 : []].sort();
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
  function groupLabel(key, groupBy2) {
    var _a5, _b;
    if (key === GROUP_NONE) return "Ungrouped";
    if (groupBy2 === "combo") return (_b = (_a5 = comboGroupById(key)) == null ? void 0 : _a5.shortLabel) != null ? _b : key;
    return key;
  }
  function orderGroups(keys, groupBy2, members) {
    const canonical = (key) => {
      if (groupBy2 === "severity") return SEVERITY_ORDER.indexOf(key);
      if (groupBy2 === "kind") return NODE_KINDS.indexOf(key);
      if (groupBy2 === "combo") return REGISTER_GROUPS.findIndex((g) => g.id === key);
      return -1;
    };
    const worstSeverity2 = (key) => {
      var _a5;
      let worst = SEVERITY_ORDER.length;
      for (const n of (_a5 = members.get(key)) != null ? _a5 : []) worst = Math.min(worst, severityRank(n.severity));
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
  function gridBlock(key, label, list2) {
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(list2.length))));
    const rows = Math.ceil(list2.length / cols);
    return {
      key,
      label,
      width: GROUP_PAD * 2 + cols * CELL_W,
      height: HEADER_H + GROUP_PAD * 2 + rows * CELL_H,
      cells: list2.map((node2, i) => ({
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
  function assignToHubs(p, parentOf) {
    var _a5;
    const cmp2 = (a, b) => nodeOrder(a, b) || cmpId(a, b);
    let hubs = p.nodes.filter((n) => n.kind === "AI_AGENT");
    if (!hubs.length) {
      hubs = p.nodes.filter((n) => AI_ASSET_KINDS.includes(n.kind));
    }
    hubs = [...hubs].sort(cmp2);
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
      for (const next of (_a5 = adj.get(id)) != null ? _a5 : []) {
        if (hubOf.has(next)) continue;
        hubOf.set(next, hubOf.get(id));
        queue.push(next);
      }
    }
    for (const [childId, parent] of parentOf) {
      const h = hubOf.get(parent.id);
      if (h) hubOf.set(childId, h);
    }
    return { hubOf, hubs };
  }
  function layoutGrouped(p, opts) {
    var _a5, _b, _c;
    const margin = (_a5 = opts.margin) != null ? _a5 : 120;
    const groupBy2 = (_b = opts.groupBy) != null ? _b : "combo";
    const sort = (_c = opts.sort) != null ? _c : "smart";
    const parentOf = parentIndex(p);
    const cmp2 = comparator(sort);
    const specs = [];
    if (groupBy2 === "asset") {
      const { hubOf, hubs } = assignToHubs(p, parentOf);
      const members = new Map(hubs.map((h) => [h.id, []]));
      const strays = [];
      for (const node2 of p.nodes) {
        const key = hubOf.get(node2.id);
        if (key) members.get(key).push(node2);
        else strays.push(node2);
      }
      for (const hub of hubs) {
        const sats = members.get(hub.id).filter((n) => n.id !== hub.id).sort(cmp2);
        specs.push(radialBlock(hub.id, hub.name, hub, sats));
      }
      if (strays.length) specs.push(gridBlock(GROUP_NONE, "Ungrouped", [...strays].sort(cmp2)));
    } else {
      const members = /* @__PURE__ */ new Map();
      for (const node2 of p.nodes) {
        const key = groupKeyOf(node2, groupBy2, parentOf);
        if (!members.has(key)) members.set(key, []);
        members.get(key).push(node2);
      }
      for (const key of orderGroups([...members.keys()], groupBy2, members)) {
        specs.push(gridBlock(key, groupLabel(key, groupBy2), [...members.get(key)].sort(cmp2)));
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
        id: `${groupBy2}:${spec.key}`,
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
    const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
    const out = [];
    for (const item of raw) {
      const s = String(item != null ? item : "").trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  }
  function comboAssetIds(issues2, groupId) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const issue2 of issues2) {
      if (!isUnresolvedIssue(issue2) || !issue2.comboGroup) continue;
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
      mode: pick(p["layout"], LAYOUT_MODES, "rows"),
      groupBy: pick(p["groupBy"], GROUP_KEYS, "combo"),
      sort: pick(p["sort"], SORT_KEYS, "smart")
    };
  }
  function resolveGraphParams(p, ctx) {
    var _a5;
    const seed = typeof p["seed"] === "string" ? p["seed"] : "";
    const seedKind = typeof p["seedKind"] === "string" ? p["seedKind"] : "";
    let seedIds;
    if (seedKind === "scored") {
      seedIds = (_a5 = ctx.scoredAssetIds) != null ? _a5 : [];
    } else if (seed && (seedKind === "combo" || comboGroupById(seed))) {
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
    const rawMaxNodes = p["maxNodes"];
    const maxNodes = clampMaxNodes(
      rawMaxNodes == null || rawMaxNodes === "" ? ctx.maxNodes : rawMaxNodes
    );
    return {
      seedIds,
      depth: clampDepth(rawDepth == null || rawDepth === "" ? ctx.defaultDepth : rawDepth),
      expandIds: toList(p["expand"]),
      filters: hasFilters ? filters : void 0,
      maxNodes,
      maxEdges: Math.round(maxNodes * EDGE_BUDGET_RATIO),
      ...seedKind === "scored" ? { filterSeeds: true } : {}
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

  // src/domain/riskConditions.ts
  function conditionState(node2, key) {
    var _a5, _b;
    switch (key) {
      case "MISSING_GUARDRAIL":
        return node2.guardrailMissing === true;
      case "EXCESSIVE_PRIVILEGE":
        return node2.hasAdminPrivileges === true || node2.hasHighPrivileges === true;
      case "SENSITIVE_DATA":
        return node2.hasSensitiveData === true || node2.hasAccessToSensitiveData === true;
      case "INTERNET_EXPOSURE": {
        const evidence = node2.exposureEvidence;
        if (evidence) {
          const hosts = (_a5 = evidence.hostIds) != null ? _a5 : [];
          const endpoints = (_b = evidence.endpointIds) != null ? _b : [];
          if (hosts.length > 0 || endpoints.length > 0) return true;
        }
        const reachable2 = node2.isAccessibleFromInternet;
        const openToAll = node2.isOpenToAllInternet;
        if (reachable2 === true || openToAll === true) return true;
        const unknown = (v) => v === null || v === void 0;
        return unknown(reachable2) || unknown(openToAll) ? null : false;
      }
    }
  }
  function conditionHolds(node2, key) {
    return conditionState(node2, key) === true;
  }

  // src/domain/graphQuery.ts
  function isGroup(step) {
    return step.op !== void 0;
  }
  var DEFAULT_QUERY = { kind: "AI_AGENT" };
  var QUERY_ROW_MAX = 2e3;
  var QUERY_SCAN_MAX = 1e5;
  var MAX_QUERY_NODES = 12;
  var MAX_QUERY_DEPTH = 6;
  var MAX_HOPS = 3;
  var IDENTITY_KINDS = [
    "SERVICE_ACCOUNT",
    "USER_ACCOUNT",
    "ACCESS_ROLE",
    "ACCESS_ROLE_BINDING",
    "ACCESS_KEY"
  ];
  function orNull(v) {
    if (v === void 0 || v === null || v === "") return null;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
    return String(v);
  }
  function humanDiscoveryMethod(raw) {
    const body = raw.replace(/^Method/, "");
    const spaced = body.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
    return spaced || raw;
  }
  var QUERY_FIELDS = [
    { key: "name", label: "Name", type: "text", get: (n) => n.name },
    { key: "kind", label: "Kind", type: "choice", get: (n) => n.kind },
    {
      key: "publisher",
      label: "Publisher",
      type: "text",
      kinds: AI_ASSET_KINDS,
      get: (n) => orNull(n.publisher)
    },
    {
      key: "discoveredBy",
      label: "Discovered by",
      type: "choice",
      multi: true,
      kinds: AI_ASSET_KINDS,
      get: (n) => {
        var _a5;
        const m = (_a5 = n.discoveryMethods) != null ? _a5 : [];
        return m.length ? m.map(humanDiscoveryMethod).join(", ") : null;
      }
    },
    {
      key: "displayName",
      label: "Display name",
      type: "text",
      kinds: IDENTITY_KINDS,
      get: (n) => orNull(n.displayName)
    },
    { key: "email", label: "Email", type: "text", kinds: IDENTITY_KINDS, get: (n) => orNull(n.email) },
    {
      // Three states, not two. Absent means the identity steps never carried a dormancy read;
      // rendering that as "No" would assert the opposite of what is known.
      key: "inactive",
      label: "Inactive for the last 90 days",
      type: "boolean",
      kinds: IDENTITY_KINDS,
      get: (n) => n.inactive === void 0 ? null : n.inactive
    },
    {
      key: "identityPurpose",
      label: "Purpose",
      type: "choice",
      kinds: IDENTITY_KINDS,
      get: (n) => orNull(n.identityPurpose)
    },
    { key: "cloud", label: "Cloud", type: "choice", get: (n) => orNull(n.cloudPlatform) },
    { key: "region", label: "Region", type: "choice", get: (n) => orNull(n.region) },
    // The cloud tags, rendered `key: value` and joined like any other list cell so the table and
    // the column chooser need to know nothing about them. They were synced and shown on the asset
    // sheet long before this — `tags_json` round-trips through the ledger — but with no entry here
    // you could read a tag and not ask about it, which is the gap this closes.
    //
    // `pairs` rather than `choice` because the value space is the estate's, not the schema's: a
    // real tenant has thousands of distinct `key: value` strings, far past VALUE_CARDINALITY_MAX,
    // so `fieldValuesFor` offers no list and the builder asks for a key and a value instead.
    {
      key: "tags",
      label: "Tags",
      type: "pairs",
      multi: true,
      get: (n) => {
        var _a5;
        return orNull(((_a5 = n.tags) != null ? _a5 : []).map((t) => t.value ? `${t.key}: ${t.value}` : t.key).join(", "));
      }
    },
    { key: "status", label: "Status", type: "choice", get: (n) => orNull(n.status) },
    { key: "severity", label: "Issue severity", type: "choice", get: (n) => orNull(n.severity) },
    { key: "aars", label: "AARS", type: "number", numeric: true, get: (n) => {
      var _a5;
      return (_a5 = n.aars) != null ? _a5 : null;
    } },
    { key: "aarsSeverity", label: "AARS level", type: "choice", get: (n) => orNull(n.aarsSeverity) },
    {
      key: "projects",
      label: "Projects",
      type: "choice",
      multi: true,
      get: (n) => {
        var _a5;
        const names = ((_a5 = n.projects) != null ? _a5 : []).map((p) => p.name).filter(Boolean);
        return names.length ? names.join(", ") : null;
      }
    },
    {
      key: "guardrail",
      label: "Guardrail",
      type: "choice",
      kinds: AI_ASSET_KINDS,
      get: (n) => n.guardrailMissing === void 0 ? null : n.guardrailMissing ? "missing" : "present"
    },
    {
      key: "combos",
      label: "Toxic combinations",
      type: "number",
      numeric: true,
      get: (n) => {
        var _a5;
        const g = (_a5 = n.comboGroups) != null ? _a5 : [];
        return g.length ? g.length : null;
      }
    },
    {
      // The combination patterns BY NAME, where `combos` only ever counted them. "Show me the
      // members of the privileged managed-agent pattern" is the question the register is built
      // around, and a count cannot answer it.
      key: "comboGroup",
      label: "Toxic combination",
      type: "choice",
      multi: true,
      get: (n) => {
        var _a5;
        const g = (_a5 = n.comboGroups) != null ? _a5 : [];
        return g.length ? g.join(", ") : null;
      }
    },
    {
      // Read through the SAME predicate the canvas draws from. Reading only
      // `isAccessibleFromInternet` — which is what this did — disagreed with the graph on a node
      // that is open to all internet but not flagged accessible: the table said no while an
      // INTERNET_EXPOSURE node hung off it two panes away. One reading, one answer.
      key: "internet",
      label: "Internet reachable",
      type: "boolean",
      get: (n) => conditionState(n, "INTERNET_EXPOSURE")
    },
    {
      key: "sensitiveAccess",
      label: "Reaches classified data",
      type: "boolean",
      get: (n) => n.hasAccessToSensitiveData === void 0 ? null : n.hasAccessToSensitiveData
    },
    {
      // HOLDS classified data, which is a different claim from reaching it — a bucket holds, an
      // agent reaches. The pair is what makes the data-exposure path readable from either end.
      key: "sensitiveData",
      label: "Holds classified data",
      type: "boolean",
      get: (n) => n.hasSensitiveData === void 0 ? null : n.hasSensitiveData
    },
    {
      // Kept apart rather than folded into one "privileged" flag: ADMIN is the stronger claim,
      // and `withExcessivePrivilegeNodes` names its stub differently for it. EXCESSIVE_PRIVILEGE
      // is their disjunction, so anyone wanting that reads the risk condition instead.
      key: "highPriv",
      label: "High privileges",
      type: "boolean",
      get: (n) => n.hasHighPrivileges === void 0 ? null : n.hasHighPrivileges
    },
    {
      key: "adminPriv",
      label: "Admin privileges",
      type: "boolean",
      get: (n) => n.hasAdminPrivileges === void 0 ? null : n.hasAdminPrivileges
    }
  ];
  var FIELD_BY_KEY = new Map(QUERY_FIELDS.map((f) => [f.key, f]));
  function fieldsForKind(kind) {
    return QUERY_FIELDS.filter((f) => {
      if (!f.kinds) return true;
      if (kind === "ANY") return false;
      return f.kinds.includes(kind);
    });
  }
  function defaultFieldsForKind(kind) {
    if (kind !== "ANY" && AI_ASSET_KINDS.includes(kind)) {
      return ["name", "publisher", "discoveredBy"];
    }
    if (kind !== "ANY" && IDENTITY_KINDS.includes(kind)) {
      return ["name", "displayName", "inactive"];
    }
    return ["name", "kind", "cloud"];
  }
  var QueryError = class extends Error {
  };
  function fail(msg) {
    throw new QueryError(msg);
  }
  var KIND_SET = new Set(NODE_KINDS);
  var EDGE_SET = new Set(EDGE_TYPES);
  function validateQuery(raw) {
    const counter = { nodes: 0 };
    const q = readNode(raw, 1, counter);
    return q;
  }
  function readNode(raw, depth, counter) {
    if (!raw || typeof raw !== "object") fail("query node must be an object");
    if (depth > MAX_QUERY_DEPTH) fail(`query nests deeper than ${MAX_QUERY_DEPTH} levels`);
    if (++counter.nodes > MAX_QUERY_NODES) fail(`query has more than ${MAX_QUERY_NODES} nodes`);
    const r = raw;
    const kind = r["kind"];
    if (typeof kind !== "string" || kind !== "ANY" && !KIND_SET.has(kind)) {
      fail(`unknown node kind: ${String(kind)}`);
    }
    const node2 = { kind };
    if (r["show"] === false) node2.show = false;
    const where = r["where"];
    if (where !== void 0) {
      if (!Array.isArray(where)) fail("where must be an array");
      const filters = [];
      for (const f of where) {
        if (!f || typeof f !== "object") fail("filter must be an object");
        const key = f["key"];
        const values = f["values"];
        if (typeof key !== "string" || key !== "id" && !FIELD_BY_KEY.has(key)) {
          fail(`unknown filter field: ${String(key)}`);
        }
        if (!Array.isArray(values) || !values.length) fail(`filter ${key} has no values`);
        const op = f["op"];
        if (op !== void 0 && op !== "eq" && op !== "contains") {
          fail(`unknown filter operator: ${String(op)}`);
        }
        const all = f["all"];
        const negate = f["negate"];
        if (all !== void 0 && typeof all !== "boolean") {
          fail(`filter ${key}: all must be a boolean`);
        }
        if (negate !== void 0 && typeof negate !== "boolean") {
          fail(`filter ${key}: negate must be a boolean`);
        }
        const filter = { key, values: values.map((v) => String(v)) };
        if (op === "contains") filter.op = "contains";
        if (all === true) filter.all = true;
        if (negate === true) filter.negate = true;
        filters.push(filter);
      }
      if (filters.length) node2.where = filters;
    }
    const steps = r["steps"];
    if (steps !== void 0) {
      if (!Array.isArray(steps)) fail("steps must be an array");
      const out = [];
      for (const s of steps) out.push(readStep(s, depth + 1, counter));
      if (out.length) node2.steps = out;
    }
    return node2;
  }
  function readStep(raw, depth, counter) {
    var _a5;
    if (!raw || typeof raw !== "object") fail("step must be an object");
    const r = raw;
    if (r["op"] !== void 0) return readGroup(r, depth, counter);
    const edge2 = r["edge"];
    if (typeof edge2 !== "string" || edge2 !== "ANY" && !EDGE_SET.has(edge2)) {
      fail(`unknown relationship: ${String(edge2)}`);
    }
    const step = { edge: edge2, node: readNode(r["node"], depth, counter) };
    if (r["reverse"] === true) step.reverse = true;
    if (r["negate"] === true) step.negate = true;
    if (r["optional"] === true) step.optional = true;
    if (edge2 === "ANY") {
      const hops = Number(r["hops"]);
      step.hops = Number.isFinite(hops) ? Math.min(MAX_HOPS, Math.max(1, Math.round(hops))) : 1;
    }
    if (step.negate && ((_a5 = step.node.steps) == null ? void 0 : _a5.length)) {
      fail("a negated relationship cannot carry further steps \u2014 there is nothing to walk from");
    }
    if (step.negate && step.optional) fail("a relationship cannot be both negated and optional");
    return step;
  }
  function readGroup(r, depth, counter) {
    const op = r["op"];
    if (op !== "and" && op !== "or") fail(`unknown group operator: ${String(op)}`);
    if (depth > MAX_QUERY_DEPTH) fail(`query nests deeper than ${MAX_QUERY_DEPTH} levels`);
    const steps = r["steps"];
    if (!Array.isArray(steps) || !steps.length) {
      fail(`an ${op.toUpperCase()} group needs at least one branch`);
    }
    const group = { op, steps: steps.map((s) => readStep(s, depth + 1, counter)) };
    if (r["optional"] === true) group.optional = true;
    return group;
  }
  var VALUE_CARDINALITY_MAX = 40;
  function queryVocabulary(doc) {
    var _a5;
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    const kindCounts = /* @__PURE__ */ new Map();
    for (const n of doc.nodes) kindCounts.set(n.kind, ((_a5 = kindCounts.get(n.kind)) != null ? _a5 : 0) + 1);
    const stepsFrom = {};
    const seen = /* @__PURE__ */ new Map();
    const note = (from, edge2, reverse, to) => {
      var _a6;
      const key = `${from}|${edge2}|${reverse ? "r" : "f"}|${to}`;
      const hit = seen.get(key);
      if (hit) {
        hit.count += 1;
        return;
      }
      const entry = { edge: edge2, reverse, kind: to, count: 1 };
      seen.set(key, entry);
      ((_a6 = stepsFrom[from]) != null ? _a6 : stepsFrom[from] = []).push(entry);
    };
    for (const e of doc.edges) {
      if (e.negated) continue;
      const src = byId.get(e.src);
      const dst = byId.get(e.dst);
      if (!src || !dst) continue;
      note(src.kind, e.type, false, dst.kind);
      note(dst.kind, e.type, true, src.kind);
    }
    for (const list2 of Object.values(stepsFrom)) {
      list2.sort((a, b) => b.count - a.count || cmp(a.reverse, b.reverse) || cmp(a.edge, b.edge) || cmp(a.kind, b.kind));
    }
    const kinds = NODE_KINDS.filter((k) => kindCounts.has(k)).map((kind) => {
      var _a6;
      return { kind, count: (_a6 = kindCounts.get(kind)) != null ? _a6 : 0 };
    });
    const base = { kinds, stepsFrom, valuesFor: {}, fieldsFor: {}, shortcuts: [] };
    const shortcuts = [];
    for (const shortcut of QUERY_SHORTCUTS) {
      const answerable = shortcut.kinds.filter((k) => shortcutsFor(k, base).some((s) => s.id === shortcut.id));
      if (answerable.length) shortcuts.push({ ...shortcut, kinds: answerable });
    }
    return { ...base, shortcuts };
  }
  function fieldValuesFor(doc, kind) {
    var _a5;
    const nodes = kind === "ANY" ? doc.nodes : doc.nodes.filter((n) => n.kind === kind);
    const perField = [];
    for (const spec of QUERY_FIELDS) {
      if (spec.type !== "choice" && spec.type !== "boolean") continue;
      if (spec.kinds && (kind === "ANY" || !spec.kinds.includes(kind))) continue;
      if (spec.key === "kind") continue;
      const counts = /* @__PURE__ */ new Map();
      let overflow = false;
      for (const node2 of nodes) {
        const raw = spec.get(node2);
        const parts = raw === null ? ["unknown"] : spec.type === "choice" ? String(raw).split(", ") : [String(raw)];
        for (const part of parts) {
          if (!part) continue;
          if (!counts.has(part) && counts.size >= VALUE_CARDINALITY_MAX) {
            overflow = true;
            continue;
          }
          counts.set(part, ((_a5 = counts.get(part)) != null ? _a5 : 0) + 1);
        }
      }
      if (overflow || !counts.size) continue;
      perField.push({
        key: spec.key,
        values: [...counts.entries()].map(([value, count2]) => ({ value, count: count2 })).sort((a, b) => b.count - a.count || cmp(a.value, b.value))
      });
    }
    return perField;
  }
  var QUERY_SHORTCUTS = [
    {
      id: "no-guardrail",
      label: "Has no guardrail",
      phrase: "Wiz reports the guardrail missing",
      blurb: "Reads the asset's own guardrail flag, which is what the canvas draws its MISSING_GUARDRAIL stub from \u2014 so the two always agree.\n\nDeliberately not the \u201CNOT protected by a guardrail\u201D traversal, which answers a wider question: it counts every asset with no guardrail relationship in the graph, including ones Wiz reports as protected without naming the guardrail. Add a NOT on a PROTECTED_BY step if that wider question is the one you want.",
      helpId: "missing-guardrail",
      kinds: AI_ASSET_KINDS,
      steps: [],
      filters: [{ path: [], key: "guardrail", values: ["missing"] }]
    },
    {
      id: "runs-as-privileged",
      label: "Runs as a privileged identity",
      phrase: "its service account holds high privileges",
      blurb: "Reads the identity's own privilege flag rather than walking to the EXCESSIVE_PRIVILEGE stub, which is suppressed wherever a real access finding exists \u2014 walking to it would quietly answer with the leftovers. Admin privilege is the stronger claim and has its own field.",
      helpId: "excessive-privilege",
      kinds: AI_ASSET_KINDS,
      steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } }],
      filters: [{ path: [0], key: "highPriv", values: ["true"] }]
    },
    {
      id: "runs-as-dormant",
      label: "Runs as a dormant identity",
      phrase: "its service account has been idle 90 days",
      blurb: "An identity nobody has used in ninety days, still able to act on the asset's behalf. The dormancy is a field Wiz reports, not something derived here.",
      helpId: "agentic-identity",
      kinds: AI_ASSET_KINDS,
      steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } }],
      filters: [{ path: [0], key: "inactive", values: ["true"] }]
    },
    {
      id: "reaches-classified",
      label: "Reaches classified data",
      phrase: "through its identity, to a bucket",
      blurb: "The real path \u2014 asset to identity to bucket \u2014 with the identity hidden, so the table reads asset beside data. Deliberately NOT the SENSITIVE_DATA stub, which graphEnrich suppresses exactly where this chain exists: walking to the stub would return only the assets whose path could not be traced.",
      helpId: "sensitive-data",
      kinds: AI_ASSET_KINDS,
      steps: [{
        edge: "RUNS_AS",
        node: {
          kind: "SERVICE_ACCOUNT",
          show: false,
          steps: [{ edge: "ALLOWS_ACCESS_TO", node: { kind: "BUCKET" } }]
        }
      }]
    },
    {
      id: "internet-reachable",
      label: "Reachable from the internet",
      phrase: "an exposure path reaches it",
      blurb: "Assets carrying an internet exposure node. Exposure is inherited from the compute underneath, so this is the topology answer rather than a flag read off the asset.",
      helpId: "internet-exposure",
      kinds: AI_ASSET_KINDS,
      steps: [{ edge: "EXPOSED_TO_INTERNET", node: { kind: "INTERNET_EXPOSURE" } }]
    },
    {
      id: "dormant-human-access",
      label: "A dormant person can reach it",
      phrase: "a human account, idle 90 days, still has access",
      blurb: "Human access read backwards: the accounts that ALLOW_ACCESS_TO this asset, narrowed to the ones nobody has signed into in ninety days. Standing access that no longer has a person behind it.",
      kinds: AI_ASSET_KINDS,
      steps: [{ edge: "ALLOWS_ACCESS_TO", reverse: true, node: { kind: "USER_ACCOUNT" } }],
      filters: [{ path: [0], key: "inactive", values: ["true"] }]
    }
  ];
  function shortcutsFor(kind, vocab) {
    if (kind === "ANY") return [];
    if (!vocab.kinds.some((k) => k.kind === kind)) return [];
    return QUERY_SHORTCUTS.filter((s) => {
      if (!s.kinds.includes(kind)) return false;
      return s.steps.every((step) => reachable(kind, step, vocab));
    });
  }
  function reachable(from, step, vocab) {
    var _a5, _b;
    if (isGroup(step)) return step.steps.every((s) => reachable(from, s, vocab));
    if (step.negate) return true;
    if (step.edge === "ANY") return true;
    const target = step.node.kind;
    const hit = ((_a5 = vocab.stepsFrom[from]) != null ? _a5 : []).some((e) => e.edge === step.edge && e.reverse === !!step.reverse && e.kind === target);
    if (!hit) return false;
    if (target === "ANY") return true;
    return ((_b = step.node.steps) != null ? _b : []).every((s) => reachable(target, s, vocab));
  }
  function queryColumnGroups(query, selected) {
    var _a5;
    const groups = [];
    for (const slot of bindingSlots(query)) {
      const node2 = slot.node;
      if (node2.show === false) continue;
      const index = groups.length;
      const offered = fieldsForKind(node2.kind);
      const offeredKeys = new Set(offered.map((f) => f.key));
      const picked = ((_a5 = selected == null ? void 0 : selected[index]) != null ? _a5 : []).filter((k) => offeredKeys.has(k));
      const keys = picked.length ? picked : defaultFieldsForKind(node2.kind).filter((k) => offeredKeys.has(k));
      groups.push({
        index,
        kind: node2.kind,
        label: node2.kind === "ANY" ? "Any node" : node2.kind,
        fields: keys.map((k) => {
          const f = FIELD_BY_KEY.get(k);
          return { key: f.key, label: f.label, numeric: f.numeric };
        }),
        available: offered.map((f) => ({ key: f.key, label: f.label })),
        // Only when the group IS an alternative. Most queries have no OR in them, and stamping
        // every column group with two undefined keys would put them in the wire payload and in
        // the golden snapshot, where they read as a fact about the group rather than an absence.
        ...slot.altOf === void 0 ? {} : { altOf: slot.altOf, altIndex: slot.altIndex }
      });
    }
    return groups;
  }
  function bindingSlots(node2, path = "", alt) {
    var _a5;
    const out = [{ node: node2, altOf: alt == null ? void 0 : alt.of, altIndex: alt == null ? void 0 : alt.index }];
    ((_a5 = node2.steps) != null ? _a5 : []).forEach((step, i) => out.push(...stepSlots(step, path + "." + i, alt)));
    return out;
  }
  function stepSlots(step, path, alt) {
    if (isGroup(step)) {
      const out = [];
      step.steps.forEach((child, i) => {
        const inner = step.op === "or" ? { of: path, index: i } : alt;
        out.push(...stepSlots(child, path + "." + i, inner));
      });
      return out;
    }
    if (step.negate) return [];
    return bindingSlots(step.node, path, alt);
  }
  function buildAdjacency(doc) {
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    const out = /* @__PURE__ */ new Map();
    const inn = /* @__PURE__ */ new Map();
    for (const e of doc.edges) {
      if (!byId.has(e.src) || !byId.has(e.dst)) continue;
      pushInto(out, e.src, e);
      pushInto(inn, e.dst, e);
    }
    return { byId, out, in: inn };
  }
  function fieldValue(node2, key) {
    if (key === "id") return node2.id;
    const spec = FIELD_BY_KEY.get(key);
    return spec ? spec.get(node2) : null;
  }
  function matchesFilter(node2, f) {
    const v = fieldValue(node2, f.key);
    const hit = (x) => {
      if (v === null) {
        return x === "unknown" || x === "";
      }
      const s = String(v).toLowerCase();
      const want = String(x).toLowerCase();
      if (f.op !== "contains" && fieldIsPairs(f.key)) return matchesTag(node2, want);
      if (f.op === "contains") {
        return s.indexOf(want) !== -1;
      }
      if (want === s) return true;
      return s.split(", ").includes(want);
    };
    const held = f.all ? f.values.every(hit) : f.values.some(hit);
    return f.negate ? !held : held;
  }
  function fieldIsPairs(key) {
    var _a5;
    return ((_a5 = FIELD_BY_KEY.get(key)) == null ? void 0 : _a5.type) === "pairs";
  }
  function matchesTag(node2, want) {
    var _a5;
    const at = want.indexOf(":");
    const wantKey = (at === -1 ? want : want.slice(0, at)).trim();
    const wantValue = at === -1 ? null : want.slice(at + 1).trim();
    return ((_a5 = node2.tags) != null ? _a5 : []).some((t) => {
      var _a6;
      if (String(t.key).toLowerCase() !== wantKey) return false;
      return wantValue === null || String((_a6 = t.value) != null ? _a6 : "").toLowerCase() === wantValue;
    });
  }
  function matchesNode(node2, q) {
    var _a5;
    if (q.kind !== "ANY" && node2.kind !== q.kind) return false;
    for (const f of (_a5 = q.where) != null ? _a5 : []) {
      if (!matchesFilter(node2, f)) return false;
    }
    return true;
  }
  function stepTargets(from, step, adj) {
    var _a5;
    if (step.edge === "ANY") return anyHopTargets(from, step, adj);
    const edges2 = (_a5 = step.reverse ? adj.in.get(from.id) : adj.out.get(from.id)) != null ? _a5 : [];
    const seen = /* @__PURE__ */ new Set();
    const hits = [];
    for (const e of edges2) {
      if (e.type !== step.edge) continue;
      if (e.negated) continue;
      const other = adj.byId.get(step.reverse ? e.src : e.dst);
      if (!other || seen.has(other.id)) continue;
      if (!matchesNode(other, step.node)) continue;
      seen.add(other.id);
      hits.push({ node: other, edges: [e] });
    }
    return hits;
  }
  function anyHopTargets(from, step, adj) {
    var _a5, _b, _c;
    const limit = Math.min(MAX_HOPS, Math.max(1, (_a5 = step.hops) != null ? _a5 : 1));
    const prev = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Set([from.id]);
    let frontier = [from.id];
    const hits = [];
    for (let depth = 0; depth < limit && frontier.length; depth++) {
      const next = [];
      for (const id of frontier) {
        const touching = [...(_b = adj.out.get(id)) != null ? _b : [], ...(_c = adj.in.get(id)) != null ? _c : []];
        for (const e of touching) {
          if (e.negated) continue;
          const otherId = e.src === id ? e.dst : e.src;
          if (seen.has(otherId)) continue;
          seen.add(otherId);
          prev.set(otherId, { via: e, from: id });
          next.push(otherId);
          const other = adj.byId.get(otherId);
          if (other && matchesNode(other, step.node)) {
            hits.push({ node: other, edges: pathEdges(otherId, from.id, prev) });
          }
        }
      }
      frontier = next;
    }
    return hits;
  }
  function pathEdges(toId, rootId, prev) {
    const edges2 = [];
    let cursor = toId;
    while (cursor !== rootId) {
      const hop = prev.get(cursor);
      if (!hop) break;
      edges2.push(hop.via);
      cursor = hop.from;
    }
    return edges2.reverse();
  }
  function solutions(q, node2, adj, scan) {
    var _a5;
    let acc = [{ slots: [node2], edges: [] }];
    for (const step of (_a5 = q.steps) != null ? _a5 : []) {
      const sub = solveStep(step, node2, adj, scan);
      if (sub === null) return [];
      acc = crossProduct(acc, sub, scan);
      if (scan.truncated) return [];
    }
    return acc;
  }
  function crossProduct(left, right, scan) {
    const out = [];
    for (const a of left) {
      for (const b of right) {
        if (++scan.scanned > scan.max) {
          scan.truncated = true;
          return out;
        }
        out.push({ slots: a.slots.concat(b.slots), edges: a.edges.concat(b.edges) });
      }
    }
    return out;
  }
  function nullSolution(width) {
    return { slots: new Array(width).fill(null), edges: [] };
  }
  function solveStep(step, from, adj, scan) {
    if (isGroup(step)) return solveGroup(step, from, adj, scan);
    const targets = stepTargets(from, step, adj);
    if (step.negate) {
      return targets.length ? null : [{ slots: [], edges: [] }];
    }
    const out = [];
    for (const t of targets) {
      for (const sub of solutions(step.node, t.node, adj, scan)) {
        out.push({ slots: sub.slots, edges: t.edges.concat(sub.edges) });
      }
      if (scan.truncated) break;
    }
    if (out.length) return out;
    return step.optional ? [nullSolution(stepSlots(step, "").length)] : null;
  }
  function solveGroup(group, from, adj, scan) {
    const widths = group.steps.map((s) => stepSlots(s, "").length);
    if (group.op === "and") {
      let acc = [{ slots: [], edges: [] }];
      for (const child of group.steps) {
        const sub = solveStep(child, from, adj, scan);
        if (sub === null) {
          return group.optional ? [nullSolution(total(widths))] : null;
        }
        acc = crossProduct(acc, sub, scan);
        if (scan.truncated) return [];
      }
      return acc;
    }
    const bound = [];
    const empty = [];
    for (let i = 0; i < group.steps.length; i++) {
      if (scan.truncated) break;
      const sub = solveStep(group.steps[i], from, adj, scan);
      if (sub === null) continue;
      const before = total(widths.slice(0, i));
      const after = total(widths.slice(i + 1));
      for (const s of sub) {
        const solution = {
          slots: new Array(before).fill(null).concat(s.slots, new Array(after).fill(null)),
          edges: s.edges
        };
        (s.slots.some((n) => n !== null) ? bound : empty).push(solution);
      }
    }
    if (bound.length) return bound;
    if (empty.length) return [empty[0]];
    return group.optional ? [nullSolution(total(widths))] : null;
  }
  function total(ns) {
    let sum = 0;
    for (const n of ns) sum += n;
    return sum;
  }
  function runQuery(doc, query, opts = {}) {
    var _a5, _b;
    const rowMax = (_a5 = opts.rowMax) != null ? _a5 : QUERY_ROW_MAX;
    const scan = { scanned: 0, max: (_b = opts.scanMax) != null ? _b : QUERY_SCAN_MAX, truncated: false };
    const adj = buildAdjacency(doc);
    const groups = queryColumnGroups(query, opts.columns);
    const shownMask = bindingSlots(query).map((slot) => slot.node.show !== false);
    const groupFields = groups.map((g) => g.fields.map((f) => f.key));
    const roots = doc.nodes.filter((n) => matchesNode(n, query)).sort((a, b) => {
      var _a6, _b2;
      return severityRank(a.severity) - severityRank(b.severity) || ((_a6 = b.aars) != null ? _a6 : -1) - ((_b2 = a.aars) != null ? _b2 : -1) || cmp(a.name, b.name);
    });
    const rows = [];
    const nodeIds = /* @__PURE__ */ new Set();
    const edgeIds = /* @__PURE__ */ new Set();
    let total2 = 0;
    for (const root of roots) {
      for (const sol of solutions(query, root, adj, scan)) {
        total2 += 1;
        if (rows.length < rowMax) {
          rows.push({ cells: toCells(sol.slots, shownMask, groupFields) });
          for (const n of sol.slots) if (n) nodeIds.add(n.id);
          for (const e of sol.edges) {
            edgeIds.add(e.id);
            nodeIds.add(e.src);
            nodeIds.add(e.dst);
          }
        }
      }
      if (scan.truncated) break;
    }
    return {
      rows,
      groups,
      total: total2,
      capped: total2 > rows.length,
      truncated: scan.truncated,
      nodeIds: [...nodeIds],
      edgeIds: [...edgeIds]
    };
  }
  function toCells(slots, shownMask, groupFields) {
    var _a5;
    const cells = [];
    for (let i = 0; i < slots.length; i++) {
      if (!shownMask[i]) continue;
      const node2 = slots[i];
      const keys = (_a5 = groupFields[cells.length]) != null ? _a5 : [];
      if (!node2) {
        cells.push(null);
        continue;
      }
      const fields = {};
      for (const key of keys) fields[key] = fieldValue(node2, key);
      cells.push({ id: node2.id, kind: node2.kind, name: node2.name, fields });
    }
    return cells;
  }

  // src/domain/graphEnrich.ts
  function worstSeverity(severities) {
    let worst;
    for (const s of severities) {
      if (worst === void 0 || severityRank(s) < severityRank(worst)) worst = s;
    }
    return worst;
  }
  function dataExposureOf(node2) {
    if (node2.hasAccessToSensitiveData || node2.hasSensitiveData) return "SENSITIVE";
    if (node2.hasHighPrivileges || node2.hasAdminPrivileges) return "DATA_ACCESS";
    return "NONE";
  }
  function internetExposureOf(node2) {
    const state = conditionState(node2, "INTERNET_EXPOSURE");
    if (state === true) return "CONFIRMED";
    if (state === null) return "UNDETERMINED";
    return "NONE";
  }
  function deriveAarsInput(node2, nodeIssues, rule = DEFAULT_AARS_RULE) {
    var _a5, _b, _c, _d, _e, _f;
    const codes = /* @__PURE__ */ new Set();
    for (const issue2 of nodeIssues) {
      const fw = (_a5 = issue2.frameworks) != null ? _a5 : {};
      for (const c of (_b = fw.owaspLlm) != null ? _b : []) codes.add(c);
      for (const c of (_c = fw.owaspAgentic) != null ? _c : []) codes.add(c);
      for (const c of (_d = fw.owaspMl) != null ? _d : []) codes.add(`ML_${c.replace(/\s+/g, "_").toUpperCase()}`);
      if (rule.gapSources.fiveRs) {
        for (const c of (_e = fw.fiveRs) != null ? _e : []) codes.add(`5R_${c.replace(/\s+/g, "_").toUpperCase()}`);
      }
    }
    const gaps = [...codes].sort().map((c) => gap(c));
    if (node2.guardrailMissing) gaps.push(gap("NO_GUARDRAIL"));
    const status = String((_f = node2.status) != null ? _f : "").trim().toUpperCase();
    if (rule.gapSources.deprecatedModel && status === "DEPRECATED") gaps.push(gap("DEPRECATED_MODEL"));
    if (rule.gapSources.inactiveAgent && status === "INACTIVE") gaps.push(gap("INACTIVE_AGENT"));
    const dataExposure = dataExposureOf(node2);
    return {
      // AARS Pillar A scores Wiz-NATIVE severities (the applied table in
      // ai/custom_score.md: MEDIUM ×1.2 = 24); the adjusted severity is a display
      // lens, not a scoring input — using it would double-count the 5Rs amplifier.
      issueSeverities: nodeIssues.map((i) => i.nativeSeverity),
      gaps,
      dataExposure,
      internetExposure: internetExposureOf(node2)
    };
  }
  function weightedGap(code, severity, rule) {
    var _a5;
    const w = severity === void 0 ? 1 : (_a5 = rule.findingSeverityWeights[severity]) != null ? _a5 : 1;
    if (w === 1) return gap(code);
    return gap(code, Math.max(0, Math.round(gapPointsFor(code, rule) * w)));
  }
  function buildAarsHintsFromFindings(findings, doc, issues2, rule = DEFAULT_AARS_RULE) {
    var _a5;
    const open = issues2.filter(isUnresolvedIssue);
    const issuesByAsset = groupBy(open, (i) => i.assetId);
    const codesByResource = /* @__PURE__ */ new Map();
    const worstByCode = /* @__PURE__ */ new Map();
    for (const f of findings.filter(isOpenGap)) {
      pushInto(codesByResource, f.resourceId, ...f.frameworkCodes);
      for (const c of f.frameworkCodes) {
        const key = `${f.resourceId}|${c}`;
        const prev = worstByCode.get(key);
        if (prev === void 0 || severityRank(f.severity) < severityRank(prev)) {
          worstByCode.set(key, f.severity);
        }
      }
    }
    const nodeById = indexBy(doc.nodes, (n) => n.id);
    const hints = {};
    for (const [resourceId, codes] of codesByResource) {
      const node2 = nodeById.get(resourceId);
      if (!node2) continue;
      const base = deriveAarsInput(node2, (_a5 = issuesByAsset.get(resourceId)) != null ? _a5 : [], rule);
      const seen = new Set(base.gaps.map((g) => g.code));
      const gaps = [...base.gaps];
      for (const c of codes) {
        if (c && !seen.has(c)) {
          seen.add(c);
          gaps.push(weightedGap(c, worstByCode.get(`${resourceId}|${c}`), rule));
        }
      }
      hints[resourceId] = {
        gaps,
        dataExposure: base.dataExposure,
        internetExposure: base.internetExposure
      };
    }
    return hints;
  }
  function enrichGraphDoc(doc, issues2, hints, rule = DEFAULT_AARS_RULE) {
    const open = issues2.filter(isUnresolvedIssue);
    const byAsset = groupBy(open, (i) => i.assetId);
    const reach = dataFindingReach(doc);
    const nodes = doc.nodes.map((raw) => {
      var _a5, _b;
      const node2 = { ...raw };
      const nodeIssues = (_a5 = byAsset.get(node2.id)) != null ? _a5 : [];
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
        const base = hint ? {
          issueSeverities: nodeIssues.map((i) => i.nativeSeverity),
          ...hint,
          // A hint written before pillar D existed carries no exposure; re-derive it
          // rather than let `undefined` read as NONE.
          internetExposure: (_b = hint.internetExposure) != null ? _b : internetExposureOf(node2)
        } : deriveAarsInput(node2, nodeIssues, rule);
        const reached = reach.get(node2.id);
        const input = reached ? { ...base, dataFindingSeverities: reached } : base;
        const result = computeAars(input, rule);
        node2.aars = result.score;
        node2.aarsSeverity = result.severity;
        node2.aarsPillars = result.pillars;
        node2.aarsInput = {
          gaps: input.gaps,
          dataExposure: input.dataExposure,
          internetExposure: input.internetExposure
        };
        if (reached) {
          node2.aarsInput.dataFindings = countBySeverity(reached);
        }
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
  function withDerivedNodes(doc, spec) {
    const existing = new Set(doc.nodes.filter((n) => n.kind === spec.kind).map((n) => n.id));
    const suppressed = spec.suppress ? spec.suppress(doc) : null;
    const added = [];
    const addedEdges = [];
    for (const node2 of doc.nodes) {
      if (node2.kind === spec.kind) continue;
      if (!conditionHolds(node2, spec.kind)) continue;
      if (suppressed && suppressed.has(node2.id)) continue;
      const id = `${spec.prefix}|${node2.id}`;
      if (existing.has(id)) continue;
      const type = typeof spec.edgeType === "function" ? spec.edgeType(node2) : spec.edgeType;
      added.push({
        id,
        kind: spec.kind,
        name: typeof spec.name === "function" ? spec.name(node2) : spec.name
      });
      const edge2 = { id: edgeId(node2.id, type, id, spec.negated), src: node2.id, dst: id, type };
      if (spec.negated) edge2.negated = true;
      addedEdges.push(edge2);
    }
    if (!added.length) return doc;
    return {
      nodes: [...doc.nodes, ...added],
      edges: [...doc.edges, ...addedEdges],
      syncedAt: doc.syncedAt
    };
  }
  var DATASTORE_KINDS = ["BUCKET", "DATABASE", "DATABASE_SERVER"];
  function countBySeverity(severities) {
    var _a5;
    const counts = {};
    for (const s of severities) counts[s] = ((_a5 = counts[s]) != null ? _a5 : 0) + 1;
    return Object.keys(counts).sort((a, b) => severityRank(a) - severityRank(b)).map((severity) => ({ severity, count: counts[severity] }));
  }
  function dataFindingReach(doc) {
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    const findingsOf = (store) => {
      var _a5;
      const out = [];
      for (const [severity, count2] of Object.entries((_a5 = store.dataFindingSeverities) != null ? _a5 : {})) {
        for (let i = 0; i < count2; i++) out.push(severity);
      }
      return out;
    };
    const reach = /* @__PURE__ */ new Map();
    const add = (id, severities) => {
      if (!severities.length) return;
      const prev = reach.get(id);
      if (prev) prev.push(...severities);
      else reach.set(id, [...severities]);
    };
    for (const node2 of doc.nodes) {
      if (!DATASTORE_KINDS.includes(node2.kind)) continue;
      add(node2.id, findingsOf(node2));
    }
    const identityReach = /* @__PURE__ */ new Map();
    for (const e of doc.edges) {
      if (e.type !== "ALLOWS_ACCESS_TO") continue;
      const store = byId.get(e.dst);
      if (!store || !DATASTORE_KINDS.includes(store.kind)) continue;
      const found = findingsOf(store);
      if (!found.length) continue;
      const prev = identityReach.get(e.src);
      if (prev) prev.push(...found);
      else identityReach.set(e.src, [...found]);
    }
    for (const [id, severities] of identityReach) add(id, severities);
    for (const e of doc.edges) {
      if (e.type !== "RUNS_AS") continue;
      const viaIdentity = identityReach.get(e.dst);
      if (viaIdentity) add(e.src, viaIdentity);
    }
    return reach;
  }
  function assetsOnDataPath(doc) {
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    const onPath = /* @__PURE__ */ new Set();
    const reachers = /* @__PURE__ */ new Set();
    for (const e of doc.edges) {
      if (e.type !== "ALLOWS_ACCESS_TO") continue;
      const store = byId.get(e.dst);
      if (!store || !DATASTORE_KINDS.includes(store.kind)) continue;
      if (store.hasSensitiveData !== true) continue;
      onPath.add(store.id);
      reachers.add(e.src);
    }
    for (const id of reachers) onPath.add(id);
    for (const e of doc.edges) {
      if (e.type === "RUNS_AS" && reachers.has(e.dst)) onPath.add(e.src);
    }
    return onPath;
  }
  function withSensitiveDataNodes(doc) {
    return withDerivedNodes(doc, {
      kind: "SENSITIVE_DATA",
      prefix: "sensitive",
      name: "Sensitive data",
      edgeType: (n) => n.hasSensitiveData ? "HAS_SENSITIVE_DATA" : "HAS_ACCESS_TO_SENSITIVE_DATA",
      suppress: assetsOnDataPath
    });
  }
  function withDataFindingNodes(doc) {
    var _a5, _b;
    const existing = new Set(doc.nodes.filter((n) => n.kind === "DATA_FINDING").map((n) => n.id));
    const added = [];
    const addedEdges = [];
    for (const node2 of doc.nodes) {
      if (!DATASTORE_KINDS.includes(node2.kind)) continue;
      const count2 = (_a5 = node2.dataFindingCount) != null ? _a5 : 0;
      if (count2 <= 0) continue;
      const id = `datafinding|${node2.id}`;
      if (existing.has(id)) continue;
      const mix = (_b = node2.dataFindingSeverities) != null ? _b : {};
      const finding = {
        id,
        kind: "DATA_FINDING",
        name: "Data Findings",
        // summaryCount, not a bespoke field: the client already reads it for the collapse
        // stubs, so the count badge and its aria text come for free.
        summaryCount: count2,
        dataFindingSeverities: mix
      };
      const worst = Object.keys(mix).sort((a, b) => severityRank(a) - severityRank(b))[0];
      if (worst && severityRank(worst) < SEVERITY_ORDER.length) finding.severity = worst;
      added.push(finding);
      addedEdges.push({
        id: edgeId(node2.id, "HAS_DATA_FINDING", id),
        src: node2.id,
        dst: id,
        type: "HAS_DATA_FINDING"
      });
    }
    if (!added.length) return doc;
    return {
      nodes: [...doc.nodes, ...added],
      edges: [...doc.edges, ...addedEdges],
      syncedAt: doc.syncedAt
    };
  }
  function withInternetExposureNodes(doc) {
    return withDerivedNodes(doc, {
      kind: "INTERNET_EXPOSURE",
      prefix: "internet",
      name: (n) => {
        var _a5, _b;
        const evidence = n.exposureEvidence;
        if ((_a5 = evidence == null ? void 0 : evidence.endpointIds) == null ? void 0 : _a5.length) return "Internet exposure \xB7 validated endpoint";
        if ((_b = evidence == null ? void 0 : evidence.hostIds) == null ? void 0 : _b.length) return "Internet exposure \xB7 exposed host";
        return "Internet exposure";
      },
      edgeType: "EXPOSED_TO_INTERNET"
    });
  }
  function withHumanAccess(doc, evidence = {}) {
    var _a5, _b, _c, _d, _e;
    const reach = new Set(HUMAN_ACCESS_TYPES);
    const byId = indexBy(doc.nodes, (n) => n.id);
    const humans = new Set(doc.nodes.filter((n) => n.kind === "USER_ACCOUNT").map((n) => n.id));
    const reachedBy = /* @__PURE__ */ new Map();
    const admins = /* @__PURE__ */ new Set();
    for (const edge2 of doc.edges) {
      if (edge2.type !== "ALLOWS_ACCESS_TO") continue;
      if (!edge2.accessType || !reach.has(edge2.accessType)) continue;
      if (!humans.has(edge2.src)) continue;
      const target = byId.get(edge2.dst);
      if (!target || !AI_ASSET_KINDS.includes(target.kind)) continue;
      pushInto(reachedBy, edge2.dst, edge2.src);
      if (edge2.accessType === "ADMIN") admins.add(edge2.dst);
    }
    const effectiveBy = /* @__PURE__ */ new Map();
    const permsBy = /* @__PURE__ */ new Map();
    const policiesBy = /* @__PURE__ */ new Map();
    for (const entry of (_a5 = evidence.effectiveAccess) != null ? _a5 : []) {
      const target = byId.get(entry.resourceId);
      if (!target || !AI_ASSET_KINDS.includes(target.kind)) continue;
      const seen = (_b = effectiveBy.get(entry.resourceId)) != null ? _b : [];
      if (seen.indexOf(entry.identityId) < 0) pushInto(effectiveBy, entry.resourceId, entry.identityId);
      const perms = (_c = permsBy.get(entry.resourceId)) != null ? _c : [];
      for (const p of entry.permissions) if (perms.indexOf(p) < 0) perms.push(p);
      permsBy.set(entry.resourceId, perms);
      const policies = (_d = policiesBy.get(entry.resourceId)) != null ? _d : [];
      for (const p of entry.policyIds) if (policies.indexOf(p) < 0) policies.push(p);
      policiesBy.set(entry.resourceId, policies);
    }
    if (!reachedBy.size && !effectiveBy.size) return doc;
    const noMfa = /* @__PURE__ */ new Set();
    const dormant = /* @__PURE__ */ new Set();
    for (const finding of (_e = evidence.identityFindings) != null ? _e : []) {
      if (!isOpenGap(finding)) continue;
      if (finding.hygiene === "MFA") noMfa.add(finding.resourceId);
      else dormant.add(finding.resourceId);
    }
    return {
      nodes: doc.nodes.map((node2) => {
        var _a6, _b2, _c2, _d2;
        const identityIds = (_a6 = reachedBy.get(node2.id)) != null ? _a6 : [];
        const effectiveIds = (_b2 = effectiveBy.get(node2.id)) != null ? _b2 : [];
        if (!identityIds.length && !effectiveIds.length) return node2;
        const access = { identityIds };
        if (admins.has(node2.id)) access.admin = true;
        const all = identityIds.slice();
        for (const id of effectiveIds) if (all.indexOf(id) < 0) all.push(id);
        const inactiveCount = all.filter((id) => {
          var _a7;
          return ((_a7 = byId.get(id)) == null ? void 0 : _a7.inactive) === true;
        }).length;
        if (inactiveCount) access.inactiveCount = inactiveCount;
        const noMfaCount = all.filter((id) => noMfa.has(id)).length;
        if (noMfaCount) access.noMfaCount = noMfaCount;
        const dormantFindingCount = all.filter((id) => dormant.has(id)).length;
        if (dormantFindingCount) access.dormantFindingCount = dormantFindingCount;
        if (effectiveIds.length) {
          access.effectiveIds = effectiveIds;
          const perms = (_c2 = permsBy.get(node2.id)) != null ? _c2 : [];
          if (perms.length) access.permissionCount = perms.length;
          const policies = (_d2 = policiesBy.get(node2.id)) != null ? _d2 : [];
          if (policies.length) access.policyIds = policies;
        }
        return { ...node2, humanAccess: access };
      }),
      edges: doc.edges,
      syncedAt: doc.syncedAt
    };
  }
  function withExposureEvidence(doc) {
    const byId = indexBy(doc.nodes, (n) => n.id);
    const hostsOf = /* @__PURE__ */ new Map();
    const servesOf = /* @__PURE__ */ new Map();
    for (const edge2 of doc.edges) {
      if (edge2.type === "HOSTED_ON") pushInto(hostsOf, edge2.src, edge2.dst);
      else if (edge2.type === "SERVES") pushInto(servesOf, edge2.src, edge2.dst);
    }
    if (!hostsOf.size && !servesOf.size) return doc;
    let touched = false;
    const nodes = doc.nodes.map((node2) => {
      var _a5, _b, _c, _d, _e, _f, _g;
      if (!AI_ASSET_KINDS.includes(node2.kind)) return node2;
      const hostIds = ((_a5 = hostsOf.get(node2.id)) != null ? _a5 : []).filter((id) => {
        const host = byId.get(id);
        return !!host && conditionHolds(host, "INTERNET_EXPOSURE");
      });
      const endpointIds = [];
      let worst;
      const consider = (id) => {
        const endpoint = byId.get(id);
        if (!endpoint || endpoint.kind !== "ENDPOINT") return;
        if (!isRatedExposure(endpoint.exposureLevel, endpoint.portValidation)) return;
        if (endpointIds.indexOf(id) < 0) endpointIds.push(id);
        worst = worseExposureLevel(worst, endpoint.exposureLevel);
      };
      for (const id of (_b = servesOf.get(node2.id)) != null ? _b : []) consider(id);
      for (const hostId of (_c = hostsOf.get(node2.id)) != null ? _c : []) {
        for (const id of (_d = servesOf.get(hostId)) != null ? _d : []) consider(id);
      }
      const ports = [];
      const sourceIpRanges = [];
      for (const hostId of hostIds) {
        const evidence2 = (_e = byId.get(hostId)) == null ? void 0 : _e.exposureEvidence;
        for (const p of (_f = evidence2 == null ? void 0 : evidence2.ports) != null ? _f : []) if (ports.indexOf(p) < 0) ports.push(p);
        for (const r of (_g = evidence2 == null ? void 0 : evidence2.sourceIpRanges) != null ? _g : []) {
          if (sourceIpRanges.indexOf(r) < 0) sourceIpRanges.push(r);
        }
      }
      if (!hostIds.length && !endpointIds.length) return node2;
      const evidence = {};
      if (hostIds.length) evidence.hostIds = hostIds;
      if (endpointIds.length) evidence.endpointIds = endpointIds;
      if (worst) evidence.exposureLevel = worst;
      if (ports.length) evidence.ports = ports;
      if (sourceIpRanges.length) evidence.sourceIpRanges = sourceIpRanges;
      touched = true;
      return { ...node2, exposureEvidence: evidence };
    });
    return touched ? { nodes, edges: doc.edges, syncedAt: doc.syncedAt } : doc;
  }
  function withExcessivePrivilegeNodes(doc) {
    return withDerivedNodes(doc, {
      kind: "EXCESSIVE_PRIVILEGE",
      prefix: "excessive",
      // ADMIN wins over HIGH when both are set — it is the stronger claim.
      name: (n) => n.hasAdminPrivileges ? "Admin privileges" : "Excessive rights",
      edgeType: "HAS_EXCESSIVE_PRIVILEGE",
      suppress: (d) => {
        const kindById = new Map(d.nodes.map((n) => [n.id, n.kind]));
        const withRealFinding = /* @__PURE__ */ new Set();
        for (const e of d.edges) {
          if (e.type === "HAS_FINDING" && kindById.get(e.dst) === "EXCESSIVE_ACCESS_FINDING") {
            withRealFinding.add(e.src);
          }
        }
        return withRealFinding;
      }
    });
  }
  function withIdentityAccessNodes(doc) {
    const HUMAN_REACH = new Set(HUMAN_ACCESS_TYPES);
    const aiAssets = new Set(
      doc.nodes.filter((n) => AI_ASSET_KINDS.includes(n.kind)).map((n) => n.id)
    );
    const humans = new Set(doc.nodes.filter((n) => n.kind === "USER_ACCOUNT").map((n) => n.id));
    const existing = new Set(
      doc.nodes.filter((n) => n.kind === "IDENTITY_ACCESS_FINDING").map((n) => n.id)
    );
    const kindById = new Map(doc.nodes.map((n) => [n.id, n.kind]));
    const withRealFinding = /* @__PURE__ */ new Set();
    for (const e of doc.edges) {
      if (e.type === "HAS_FINDING" && kindById.get(e.dst) === "EXCESSIVE_ACCESS_FINDING") {
        withRealFinding.add(e.src);
      }
    }
    const reached = /* @__PURE__ */ new Set();
    for (const e of doc.edges) {
      if (e.type !== "ALLOWS_ACCESS_TO") continue;
      if (!e.accessType || !HUMAN_REACH.has(e.accessType)) continue;
      if (!humans.has(e.src) || !aiAssets.has(e.dst)) continue;
      if (withRealFinding.has(e.dst)) continue;
      reached.add(e.dst);
    }
    const added = [];
    const addedEdges = [];
    for (const assetId of reached) {
      const id = `identityaccess|${assetId}`;
      if (existing.has(id)) continue;
      added.push({ id, kind: "IDENTITY_ACCESS_FINDING", name: "Human access" });
      addedEdges.push({
        id: edgeId(assetId, "HAS_FINDING", id),
        src: assetId,
        dst: id,
        type: "HAS_FINDING"
      });
    }
    if (!added.length) return doc;
    return {
      nodes: [...doc.nodes, ...added],
      edges: [...doc.edges, ...addedEdges],
      syncedAt: doc.syncedAt
    };
  }
  function withMissingGuardrailNodes(doc) {
    return withDerivedNodes(doc, {
      kind: "MISSING_GUARDRAIL",
      prefix: "noguardrail",
      name: "No guardrail",
      edgeType: "PROTECTED_BY",
      negated: true
    });
  }

  // src/domain/severity.ts
  function normalizeSeverity(sev) {
    if (typeof sev !== "string") return "UNKNOWN";
    const s = sev.toUpperCase().trim();
    if (s === "INFORMATIONAL" || s === "INFO") return "INFO";
    return SEVERITY_ORDER.includes(s) ? s : "UNKNOWN";
  }
  function countBySeverity2(records) {
    var _a5;
    if (!records.length || !records.some((r) => "severity" in r)) return {};
    const counts = {};
    for (const rec2 of records) {
      const sev = normalizeSeverity(rec2["severity"]);
      counts[sev] = ((_a5 = counts[sev]) != null ? _a5 : 0) + 1;
    }
    return counts;
  }

  // src/domain/comboDigest.ts
  var DUE_SOON_DAYS = 7;
  var DAY_MS = 864e5;
  var carriesCondition = conditionState;
  function mixOf(issues2, field) {
    return countBySeverity2(issues2.map((i) => ({ severity: i[field] })));
  }
  function daysUntil(dueAt, nowMs) {
    const t = Date.parse(dueAt || "");
    if (Number.isNaN(t)) return null;
    return Math.round((t - nowMs) / DAY_MS);
  }
  function slaTally(issues2, nowMs) {
    const out = { pastDue: 0, dueSoon: 0, noDueDate: 0 };
    for (const issue2 of issues2) {
      const days = daysUntil(issue2.dueAt, nowMs);
      if (days === null) out.noDueDate += 1;
      else if (days < 0) out.pastDue += 1;
      else if (days <= DUE_SOON_DAYS) out.dueSoon += 1;
    }
    return out;
  }
  function emptyConditions() {
    const out = {};
    for (const key of CONDITION_KEYS) {
      out[key] = { required: false, carried: 0, unknown: 0, total: 0 };
    }
    return out;
  }
  function reRatedCount(issues2) {
    return issues2.filter((i) => i.nativeSeverity !== i.adjustedSeverity).length;
  }
  function comboDigest(issues2, assets, nowIso2) {
    const nowMs = Date.parse(nowIso2);
    const byAsset = new Map(assets.map((a) => [a.id, a]));
    const open = issues2.filter(isUnresolvedIssue);
    const summaries = comboSummary(issues2);
    const groups = summaries.map((summary) => {
      const group = summary.group;
      const assetIds = summary.assetIds;
      const rows = open.filter((i) => registerBucketId(i) === group.id);
      const conditions = emptyConditions();
      const declared = new Set(group.conditions);
      for (const key of CONDITION_KEYS) conditions[key].required = declared.has(key);
      for (const id of assetIds) {
        const asset = byAsset.get(id);
        if (!asset) continue;
        for (const key of CONDITION_KEYS) {
          const tally = conditions[key];
          tally.total += 1;
          const carried = carriesCondition(asset, key);
          if (carried === null) tally.unknown += 1;
          else if (carried) tally.carried += 1;
        }
      }
      const sla2 = slaTally(rows, nowMs);
      return {
        id: group.id,
        count: summary.count,
        assetCount: assetIds.length,
        conditions,
        nativeMix: mixOf(rows, "nativeSeverity"),
        adjustedMix: mixOf(rows, "adjustedSeverity"),
        reRated: reRatedCount(rows),
        pastDue: sla2.pastDue,
        dueSoon: sla2.dueSoon,
        noDueDate: sla2.noDueDate
      };
    });
    const affected = /* @__PURE__ */ new Set();
    for (const s of summaries) for (const id of s.assetIds) affected.add(id);
    const sla = slaTally(open, nowMs);
    const modelled = new Set(COMBO_GROUPS.map((g) => g.id));
    return {
      totals: {
        totalOpen: open.length,
        assetsAffected: affected.size,
        // Four modelled patterns is still four: Other is a residual bucket, not a pattern,
        // so counting it would render "5 of 5 patterns active" — a claim the rule set
        // does not make.
        patternsActive: groups.filter((g) => g.count > 0 && modelled.has(g.id)).length,
        patternsTotal: COMBO_GROUPS.length,
        unclassified: groups.filter((g) => !modelled.has(g.id)).reduce((n, g) => n + g.count, 0),
        inProgress: open.filter((i) => i.status === "IN_PROGRESS").length,
        nativeMix: mixOf(open, "nativeSeverity"),
        adjustedMix: mixOf(open, "adjustedSeverity"),
        reRated: reRatedCount(open),
        pastDue: sla.pastDue,
        dueSoon: sla.dueSoon,
        noDueDate: sla.noDueDate
      },
      groups
    };
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
      var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
      return {
        job_id: String((_a5 = r["job_id"]) != null ? _a5 : ""),
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
    var _a5;
    return (_a5 = listJobs().find((j) => j.job_id === jobId)) != null ? _a5 : null;
  }
  var TERMINAL = ["DONE", "FAILED", "CANCELLED"];
  function activeJob() {
    var _a5;
    if (!getProp(ACTIVE_JOB_PROP)) return null;
    const job = (_a5 = listJobs().find((j) => !TERMINAL.includes(j.phase))) != null ? _a5 : null;
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

  // src/server/buildInfo.ts
  var BUILD_ID = true ? "0b1267589918" : "dev";
  function buildInfo() {
    return { id: BUILD_ID };
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
  var WIZ_VERSION_PROP = "WIZ_DATA_VERSION";
  var KEY_PREFIX = `wsk.${BUILD_ID}`;
  var CHUNK_CHARS = 9e4;
  var DEFAULT_TTL_SEC = 21600;
  function dataVersion() {
    var _a5;
    return (_a5 = getProp(VERSION_PROP)) != null ? _a5 : "0";
  }
  function bumpDataVersion() {
    setProp(VERSION_PROP, String(Date.now()));
  }
  function wizDataVersion() {
    var _a5;
    return (_a5 = getProp(WIZ_VERSION_PROP)) != null ? _a5 : "0";
  }
  function bumpWizDataVersion() {
    setProp(WIZ_VERSION_PROP, String(Date.now()));
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
  function cached(name, params, compute, ttlSec = DEFAULT_TTL_SEC, version) {
    let key = null;
    try {
      key = cacheKey(name, params, version != null ? version : dataVersion());
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
  var getAutoExpand2 = () => getAutoExpand(loadSettings());
  function setDefaultDepth(depth) {
    saveSettings(withDefaultDepth(loadSettings(), depth));
  }
  function setMaxNodes(maxNodes) {
    saveSettings(withMaxNodes(loadSettings(), maxNodes));
  }
  function setAutoExpand(on) {
    saveSettings(withAutoExpand(loadSettings(), on));
  }
  var getAarsRule2 = () => getAarsRule(loadSettings());
  function setAarsRule(rule) {
    const settings = loadSettings();
    const before = getAarsRule(settings);
    const scoresWereCurrent = getScoredRuleVersion(settings) === before.version;
    let next = withAarsRule(settings, rule);
    const stored = getAarsRule(next);
    if (scoresWereCurrent && scoringEqual(before.rule, stored.rule)) {
      next = withScoredRuleVersion(next, stored.version);
    }
    saveSettings(next);
    return stored;
  }
  var getSkippedSteps2 = () => getSkippedSteps(loadSettings());
  function setSkippedSteps(steps) {
    const settings = loadSettings();
    const next = withSkippedSteps(settings, steps);
    const before = getSkippedSteps(settings).join(" ");
    if (getSkippedSteps(next).join(" ") === before) return;
    saveSettings(next);
  }
  var getTruncatedSteps2 = () => getTruncatedSteps(loadSettings());
  function setTruncatedSteps(steps) {
    const settings = loadSettings();
    const next = withTruncatedSteps(settings, steps);
    const before = getTruncatedSteps(settings).join(" ");
    if (getTruncatedSteps(next).join(" ") === before) return;
    saveSettings(next);
  }
  function getSelectedFrameworks2(catalogue) {
    const settings = loadSettings();
    if (Array.isArray(settings["selected_frameworks"])) {
      return getSelectedFrameworks(settings);
    }
    const rows = catalogue ? catalogue() : [];
    return rows.length ? resolveDefaultFrameworks(rows) : getSelectedFrameworks(settings);
  }
  function setSelectedFrameworks(ids) {
    saveSettings(withSelectedFrameworks(loadSettings(), ids));
    return getSelectedFrameworks2();
  }
  var getFiveRsPins2 = () => getFiveRsPins(loadSettings());
  function setFiveRsPins(pins) {
    const settings = loadSettings();
    const next = withFiveRsPins(settings, pins);
    const key = (p) => `${p.in.join(" ")}|${p.out.join(" ")}`;
    if (key(getFiveRsPins(next)) === key(getFiveRsPins(settings))) {
      return getFiveRsPins(settings);
    }
    saveSettings(next);
    return getFiveRsPins2();
  }
  var getScanVars2 = () => getScanVars(loadSettings());
  function setScanVars(stepId, vars) {
    saveSettings(withScanVars(loadSettings(), stepId, vars));
    return getScanVars2();
  }
  var getScoredRuleVersion2 = () => getScoredRuleVersion(loadSettings());
  function setScoredRuleVersion(version) {
    const settings = loadSettings();
    const next = withScoredRuleVersion(settings, version);
    if (getScoredRuleVersion(next) === getScoredRuleVersion(settings)) return;
    saveSettings(next);
  }
  function configRulesAreFresh2(hasRows, now) {
    return configRulesAreFresh(loadSettings(), hasRows, now);
  }
  function setConfigRulesSyncedAt(at) {
    saveSettings(withConfigRulesSyncedAt(loadSettings(), at));
  }

  // src/server/syncJobs.ts
  var syncJobs_exports = {};
  __export(syncJobs_exports, {
    cancelRequested: () => cancelRequested,
    cancelSync: () => cancelSync,
    clearCancelFlag: () => clearCancelFlag,
    continueJob: () => continueJob,
    dailySync: () => dailySync,
    describeSyncSteps: () => describeSyncSteps,
    jobStatus: () => jobStatus,
    startSync: () => startSync,
    testStepVariables: () => testStepVariables
  });

  // src/domain/identityHygiene.ts
  var HYGIENE_SUBJECT = "USER_ACCOUNT";
  var MATCHERS = [
    // "multi-factor authentication (MFA)" and bare "MFA enabled" both appear in the catalogue.
    { kind: "MFA", test: /multi-factor|\bMFA\b/i },
    // "should not be inactive for more than 90 days" and "should have recent login activity".
    // Deliberately NOT a bare /inactive/ — "Uninstalled Connected App should not be inactive"
    // is a SERVICE_ACCOUNT rule about an app, and the subject guard below already excludes it,
    // but the phrase is specific enough not to lean on that alone.
    { kind: "DORMANT", test: /inactive for more than|recent login activity/i }
  ];
  function hygieneKindOf(rule) {
    if (rule.subjectEntityType !== HYGIENE_SUBJECT) return null;
    for (const m of MATCHERS) {
      if (m.test.test(rule.name)) return m.kind;
    }
    return null;
  }
  function resolveHygieneRules(catalogue) {
    const byId = {};
    const ids = [];
    const shortIds = [];
    for (const rule of catalogue) {
      const kind = hygieneKindOf(rule);
      if (!kind || !rule.id) continue;
      byId[rule.id] = kind;
      ids.push(rule.id);
      if (rule.shortId) shortIds.push(rule.shortId);
    }
    return { byId, ids, shortIds };
  }

  // src/server/sampleData.ts
  var T0 = "2026-04-02T08:00:00Z";
  var T1 = "2026-06-28T05:00:00Z";
  function node(seed) {
    var _a5, _b, _c, _d, _e, _f, _g;
    return {
      id: seed.id,
      kind: seed.kind,
      name: seed.name,
      nativeType: seed.nativeType,
      cloudPlatform: seed.cloud,
      // The cloud tags. Only some seeds carry them, and the ones that do carry DIFFERENT sets —
      // a dry run has to be able to tell "contains any" from "contains all", and it cannot if
      // every node is tagged the same way or none is tagged at all.
      tags: seed.tags,
      region: seed.region,
      status: (_a5 = seed.status) != null ? _a5 : "Active",
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
      issueAnalytics: seed.issueAnalytics,
      // Left undefined unless a seed sets them, so every node that is not an endpoint or an
      // exposed host reads back exactly as it did before these columns existed.
      exposureLevel: seed.exposureLevel,
      portValidation: seed.portValidation,
      exposureEvidence: seed.exposureEvidence,
      inactive: seed.inactive,
      inactiveTimeframe: seed.inactiveTimeframe,
      displayName: seed.displayName,
      email: seed.email,
      publisher: seed.publisher,
      discoveryMethods: seed.discoveryMethods
    };
  }
  function edge(src, type, dst, accessType) {
    return { id: edgeId(src, type, dst), src, dst, type, accessType };
  }
  var GCP_MANAGED = "aiplatform#ReasoningEngine";
  var GCP_HOSTED = "hostedAiAgent";
  function gcpAgent(seed) {
    var _a5, _b, _c, _d;
    const nativeType = (_a5 = seed.nativeType) != null ? _a5 : GCP_MANAGED;
    return {
      ...seed,
      kind: "AI_AGENT",
      cloud: (_b = seed.cloud) != null ? _b : "GCP",
      nativeType,
      techCats: (_c = seed.techCats) != null ? _c : ["AI Service"],
      // How Wiz found it, mirroring the tenant capture: a managed ReasoningEngine comes from the
      // cloud API, a hosted agent from scanning the workload it runs in. `publisher` is
      // deliberately NOT defaulted — it is null on most agents in that same capture, and the
      // register has to render that honestly rather than showing a value for everything.
      discoveryMethods: (_d = seed.discoveryMethods) != null ? _d : [nativeType === GCP_HOSTED ? "MethodWorkloadScanning" : "MethodCloudScanning"]
    };
  }
  var AGENTS = [
    gcpAgent({
      id: "agent-a",
      name: "Agent-A",
      region: "europe-west1",
      tags: [{ key: "env", value: "prod" }, { key: "team", value: "ml" }, { key: "owner", value: "platform" }],
      account: { id: "gcp-account-01", name: "gcp-account-01" },
      projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
      sensitiveAccess: true,
      highPriv: true,
      guardrailMissing: true,
      // Two of the fourteen carry a publisher, matching the shape of the real tenant, where the
      // field is populated for a handful of hand-built agents and null for the rest. The dry run
      // has to exercise BOTH paths or the "—" cell never gets looked at.
      publisher: "Platform Engineering"
    }),
    gcpAgent({
      id: "agent-b",
      name: "Agent-B",
      region: "us-west1",
      tags: [{ key: "env", value: "prod" }, { key: "team", value: "search" }],
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
      tags: [{ key: "env", value: "staging" }, { key: "team", value: "ml" }],
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
    { id: "run-agent-h", kind: "SERVERLESS", name: "cloudrun-agent-h", cloud: "GCP", region: "europe-west1", internet: true, openInternet: true, projects: ["PROJECT-DELTA"], exposureEvidence: { ports: ["443", "80"], sourceIpRanges: ["0.0.0.0/0"] } },
    // Network exposure, seeded to put BOTH grades of evidence on one screen and to make them
    // visibly disagree — which is the whole reason the two queries are two steps.
    //
    //   endpoint-agent-h   Low  + Open, on the internet-reachable Cloud Run revision.
    //                      This is the capture's own shape (exemples/ai_exposure_host_response.js):
    //                      openToAllInternet, ports 80 and 443 open to 0.0.0.0/0, and both
    //                      endpoints rated Low because they redirect to SSO. agent-h-chatbot
    //                      is therefore exposed VIA ITS HOST and NOT validated.
    //   endpoint-agent-i   High + Open, served directly by an agent whose VM is NOT reachable.
    //                      The mirror image: validated, with no host exposure behind it.
    //
    // Between them the dry run exercises every branch of withExposureEvidence, including the
    // one that must NOT fire.
    { id: "endpoint-agent-h", kind: "ENDPOINT", name: "https://agent-h-chatbot.a.run.app:443", cloud: "GCP", region: "europe-west1", exposureLevel: "Low", portValidation: "Open", projects: ["PROJECT-DELTA"] },
    { id: "endpoint-agent-i", kind: "ENDPOINT", name: "https://agent-i.internal-tools.example:8443", cloud: "GCP", region: "europe-west4", exposureLevel: "High", portValidation: "Open", projects: ["PROJECT-ZETA"] },
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
  var SA_DISPLAY_NAMES = {
    "agent-a": "Vertex AI Agent Service Account",
    "agent-b": "Vertex AI Reasoning Agent Identity",
    "agent-h-chatbot": "Support chatbot runtime identity",
    "agent-l-support": "Support agent (read-only)"
  };
  for (const agentId of GCP_AGENT_IDS) {
    const saId = `sa-${agentId}`;
    const highPriv = agentId !== "agent-l-support";
    extraNodes.push({
      id: saId,
      kind: "SERVICE_ACCOUNT",
      name: `${saId}@iam.gserviceaccount.com`,
      displayName: SA_DISPLAY_NAMES[agentId],
      email: `${saId}@iam.gserviceaccount.com`,
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
  edges.push(edge("run-agent-h", "SERVES", "endpoint-agent-h"));
  edges.push(edge("agent-i", "SERVES", "endpoint-agent-i"));
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
    const seed = {
      id,
      kind: "USER_ACCOUNT",
      name: `ops.user${n}@example.com`,
      cloud: "GCP"
    };
    if (i === 2) {
      seed.inactive = true;
      seed.inactiveTimeframe = "Inactive90Days";
    } else if (i === 3) {
      seed.inactive = false;
      seed.inactiveTimeframe = "Active";
    }
    extraNodes.push(seed);
    edges.push(edge(id, "ALLOWS_ACCESS_TO", "agent-h-chatbot", i <= 2 ? "ADMIN" : "READ"));
  }
  function issue(seed) {
    var _a5, _b, _c, _d;
    const group = classifyIssue({ sourceRuleId: seed.ruleId, ruleName: seed.ruleName });
    const row = {
      id: seed.id,
      ruleId: seed.ruleId,
      ruleName: seed.ruleName,
      // An unmodelled rule lands in Other rather than "" — the same bucket a live sync
      // would give it, so the dry-run demo shows the register the real one produces.
      comboGroup: group ? group.id : OTHER_GROUP_ID,
      nativeSeverity: seed.nativeSeverity,
      adjustedSeverity: group ? group.adjustedSeverity : seed.nativeSeverity,
      status: (_a5 = seed.status) != null ? _a5 : "OPEN",
      assetId: seed.assetId,
      assetName: seed.assetName,
      region: seed.region,
      account: seed.account,
      projects: seed.projects,
      frameworks: seed.frameworks,
      justification: seed.justification,
      createdAt: seed.createdAt,
      dueAt: seed.dueAt,
      resolutionRecommendation: seed.resolutionRecommendation,
      issueType: (_b = seed.issueType) != null ? _b : "TOXIC_COMBINATION",
      updatedAt: seed.updatedAt,
      assignee: seed.assignee,
      businessImpact: seed.businessImpact,
      entityStatus: seed.entityStatus,
      ignoreNote: seed.ignoreNote,
      ignoreExpiredAt: seed.ignoreExpiredAt,
      aiVerdict: seed.aiVerdict,
      aiRecommendedSeverity: seed.aiRecommendedSeverity
    };
    if ((_c = seed.environments) == null ? void 0 : _c.length) row.environments = seed.environments;
    if ((_d = seed.ticketUrls) == null ? void 0 : _d.length) row.ticketUrls = seed.ticketUrls;
    return row;
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
  awsRoles.forEach((role, n) => {
    const lapsed = n === 0;
    const working = n === 1;
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
      createdAt: "2026-05-14T09:12:00Z",
      // TOXIC_COMBINATION (the default), because that is what the tenant returns for
      // wc-id-2742 — every node in exemples/risk_issues_response.js carries that type,
      // guardrail rule included. Wiz's issue TYPE and this register's pattern grouping are
      // independent axes, and the seed must not imply they line up.
      updatedAt: "2026-08-13T10:29:28Z",
      environments: ["PRODUCTION"],
      entityStatus: "Active",
      businessImpact: "MBI",
      // Ignored by design until the guardrail baseline landed, then reopened when the
      // ignore date passed. The expiry is the structured field, never parsed out of the note.
      ignoreNote: lapsed ? "Ignored (By Design) by MANSUY.\nExplanation: guardrails are being rolled out per project team; a baseline has to be agreed before they can be enforced.\n\nIgnored until: Feb 1, 2026" : void 0,
      ignoreExpiredAt: lapsed ? "2026-02-01T00:00:00Z" : void 0,
      // Remediation under way: the status the register collected and never counted.
      status: working ? "IN_PROGRESS" : void 0,
      assignee: working ? "platform-security@example.com" : void 0,
      ticketUrls: working ? ["https://example.slack.com/archives/C0AGUF82MM1/p1775622232097139"] : void 0,
      aiVerdict: working ? "REMEDIATE" : void 0,
      aiRecommendedSeverity: working ? "MEDIUM" : void 0
    }));
  });
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
  var _a4;
  {
    const asset = AGENTS.find((a) => a.id === "agent-e");
    const OTHER_SEEDS = [
      {
        ruleId: "wc-id-4101",
        ruleName: "AI model endpoint without request logging",
        sev: "LOW",
        why: "Model invocations are not logged, so misuse leaves no trail to investigate."
      },
      {
        ruleId: "wc-id-4102",
        ruleName: "AI training dataset stored without encryption at rest",
        sev: "MEDIUM",
        why: "Training data is readable to anyone who reaches the bucket."
      },
      {
        ruleId: "wc-id-4103",
        ruleName: "AI service account key older than 90 days",
        sev: "LOW",
        why: "A long-lived static key on an AI workload widens the window for credential theft."
      }
    ];
    for (const seed of OTHER_SEEDS) {
      issues.push(issue({
        id: nextIssueId(),
        ruleId: seed.ruleId,
        ruleName: seed.ruleName,
        // CLOUD_CONFIGURATION: the type the register used to filter out entirely, so the
        // demo shows the Type column carrying something other than the tenant's default.
        // Illustrative rather than transcribed — these rule ids are invented, and the Other
        // bucket is defined by its rule not being modelled, never by its Wiz issue type.
        issueType: "CLOUD_CONFIGURATION",
        assetId: asset.id,
        assetName: asset.name,
        nativeSeverity: seed.sev,
        region: asset.region,
        account: (_a4 = asset.account) == null ? void 0 : _a4.name,
        projects: asset.projects,
        justification: seed.why,
        // No frameworks: an unmodelled rule contributes no AARS gap codes, so pillar B is
        // left exactly where it was. Deriving codes from the rule's own risks/tags would
        // re-price every asset with no way to attribute the movement.
        frameworks: void 0,
        createdAt: "2026-07-02T08:15:00Z",
        environments: ["PRODUCTION"],
        businessImpact: "MBI",
        entityStatus: "Active",
        updatedAt: "2026-08-13T10:30:01Z"
      }));
    }
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
      frameworkCodes: ["SUB-082", "LLM06"],
      name: "Vertex AI Metadata Store is not encrypted with a customer-managed key",
      status: "OPEN",
      result: "FAIL",
      firstSeenAt: "2026-06-12T19:42:35Z",
      analyzedAt: "2026-07-07T15:59:10Z",
      ruleId: "60442ee5-452a-48cb-8694-9061c920e10d",
      ruleName: "Vertex AI Metadata Store should be encrypted with a customer-managed key",
      ruleDescription: "This rule checks whether the Vertex AI Metadata Store is encrypted with a customer-managed key. It fails if kms_key_name is not configured.",
      remediationInstructions: "Delete the current Vertex AI Metadata Store, then create a new one with a customer-managed key. Encryption cannot be changed after creation.",
      opaPolicy: 'package wiz\n\ndefault result = "pass"\n\nresult = "fail" {\n	not input.vertexAIMetadataStoreConfiguration.encryption_spec.kms_key_name\n}\n',
      risks: ["AI_SECURITY", "UNPROTECTED_DATA"],
      threats: [],
      resourceName: "Agent A",
      resourceType: "AI_AGENT",
      resourceStatus: "Active",
      source: "WIZ_CSPM",
      subscriptionName: "gcp-account-01",
      cloudProvider: "GCP",
      projects: [
        { id: "proj-project-beta", name: "PROJECT-BETA", businessImpact: "MBI" },
        { id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }
      ],
      businessImpact: "MBI",
      ignoreRuleIds: [],
      iacFindingIds: []
    },
    {
      id: "cfg-002",
      resourceId: "agent-h-chatbot",
      ruleShortId: "SUB-114",
      severity: "HIGH",
      remediation: "Disable public ingress on the Cloud Run service hosting the agent, or place it behind an authenticated load balancer.",
      frameworkCodes: ["SUB-114"],
      name: "AI agent host is reachable from the public internet",
      status: "OPEN",
      result: "FAIL",
      firstSeenAt: "2026-05-02T08:15:00Z",
      analyzedAt: "2026-07-13T21:52:08Z",
      ruleName: "AI agent hosts should not be open to all internet",
      ruleDescription: "This rule checks whether the compute hosting an AI agent accepts ingress from 0.0.0.0/0. It fails when no authenticating front end sits in front of it.",
      risks: ["AI_SECURITY"],
      threats: [],
      resourceName: "agent-H-chatbot",
      resourceType: "AI_AGENT",
      resourceStatus: "Active",
      source: "WIZ_CSPM",
      subscriptionName: "gcp-account-05",
      cloudProvider: "GCP",
      projects: [{ id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
      businessImpact: "LBI",
      // Traced to IaC: the register's shift-left link, and the only seeded row that has one.
      iacFindingIds: ["iac-cloudrun-ingress-1"],
      ignoreRuleIds: []
    },
    {
      id: "cfg-003",
      resourceId: "agent-e",
      ruleShortId: "SUB-047",
      severity: "MEDIUM",
      remediation: "Enable audit logging for all data access performed by the agent identity.",
      frameworkCodes: ["SUB-047"],
      name: "Data access by the AI agent identity is not audited",
      status: "OPEN",
      result: "FAIL",
      firstSeenAt: "2026-06-25T08:43:01Z",
      analyzedAt: "2026-07-13T21:52:13Z",
      ruleName: "AI agent identities should have data access logging enabled",
      risks: ["AI_SECURITY"],
      threats: [],
      resourceName: "Agent E",
      resourceType: "AI_AGENT",
      resourceStatus: "Active",
      source: "WIZ_CSPM",
      subscriptionName: "gcp-account-03",
      cloudProvider: "GCP",
      projects: [{ id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
      businessImpact: "LBI",
      ignoreRuleIds: [],
      iacFindingIds: []
    },
    // ---- keyed to resources the AI graph does not model ----
    {
      id: "cfg-004",
      // A REGION. Not a NodeKind, so this prices no AARS score and shows as off-inventory.
      resourceId: "region-europe-west1-packaging",
      ruleShortId: "SUB-082",
      severity: "MEDIUM",
      remediation: "Delete and recreate the metadata store with a customer-managed key. Encryption cannot be changed after creation.",
      frameworkCodes: ["SUB-082", "LLM06"],
      name: "Vertex AI Metadata Store is not encrypted with a customer-managed key",
      status: "OPEN",
      result: "FAIL",
      firstSeenAt: "2026-06-12T19:42:35Z",
      analyzedAt: "2026-06-19T10:27:22Z",
      ruleId: "60442ee5-452a-48cb-8694-9061c920e10d",
      ruleName: "Vertex AI Metadata Store should be encrypted with a customer-managed key",
      ruleDescription: "This rule checks whether the Vertex AI Metadata Store is encrypted with a customer-managed key. It fails if kms_key_name is not configured.",
      opaPolicy: 'package wiz\n\ndefault result = "pass"\n\nresult = "fail" {\n	not input.vertexAIMetadataStoreConfiguration.encryption_spec.kms_key_name\n}\n',
      risks: ["AI_SECURITY", "UNPROTECTED_DATA"],
      threats: [],
      resourceName: "europe-west1 (packaging-data)",
      resourceType: "REGION",
      resourceStatus: "Active",
      targetExternalId: "packaging-data/europe-west1",
      source: "WIZ_CSPM",
      subscriptionName: "packaging-data",
      cloudProvider: "GCP",
      projects: [{ id: "proj-project-gamma", name: "PROJECT-GAMMA", businessImpact: "MBI" }],
      businessImpact: "MBI",
      ignoreRuleIds: [],
      iacFindingIds: []
    },
    {
      id: "cfg-005",
      // A RAW_ACCESS_POLICY — an IAM policy document, likewise absent from the graph.
      resourceId: "policy-bedrock-invoke-1",
      ruleShortId: "IAM-267",
      severity: "MEDIUM",
      remediation: "Add a bedrock:GuardrailIdentifier condition to the policy statement that allows bedrock:InvokeModel, or add a Deny that requires one.",
      frameworkCodes: ["IAM-267", "LLM06"],
      name: "IAM policy allows Bedrock model invocation without guardrail condition",
      status: "OPEN",
      result: "FAIL",
      firstSeenAt: "2026-07-21T16:03:20Z",
      analyzedAt: "2026-08-03T23:20:36Z",
      ruleId: "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
      ruleName: "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
      ruleDescription: "This rule checks whether IAM policies that allow Bedrock model invocation include guardrail conditions. Amazon Bedrock foundation models can process sensitive data and generate harmful content; guardrails enforce content filtering and usage policy.",
      remediationInstructions: `aws iam create-policy-version --policy-arn {{policyArn}} --set-as-default --policy-document '{ \u2026 "Condition": { "StringEquals": { "bedrock:GuardrailIdentifier": "<YOUR_GUARDRAIL_ID>" } } \u2026 }'`,
      risks: ["AI_SECURITY"],
      threats: [],
      resourceName: "AIFFORECASTSUPPLY-DEMANDFORECASTEU-IAM-V2-2",
      resourceType: "RAW_ACCESS_POLICY",
      source: "WIZ_CSPM",
      subscriptionName: "aws-account-prod-01",
      cloudProvider: "AWS",
      projects: [{ id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
      businessImpact: "LBI",
      // An accepted risk that still fails: the register shows the exception rather than
      // quietly dropping the row out of the gap count.
      ignoreRuleIds: ["ignore-bedrock-guardrail-waiver"],
      iacFindingIds: []
    },
    {
      id: "cfg-006",
      // A SERVICE_ACCOUNT no agent in this estate runs as, so still off-inventory.
      resourceId: "sa-bigdata-ai-weatherforecast-pp",
      ruleShortId: "IAM-236",
      severity: "HIGH",
      remediation: "Add an aws:SourceAccount or aws:SourceArn condition to the role's trust policy so only Bedrock in your own account can assume it.",
      frameworkCodes: ["IAM-236"],
      name: "Bedrock Service Role missing conditions to prevent confused deputy attacks",
      status: "OPEN",
      result: "FAIL",
      firstSeenAt: "2026-01-06T10:48:24Z",
      analyzedAt: "2026-08-07T07:37:39Z",
      ruleId: "1a1b2762-dee3-434f-b5b4-41597c48052b",
      ruleName: "Bedrock Service Roles should prevent confused deputy attacks",
      ruleDescription: "Fails when a role trusted by bedrock.amazonaws.com has no Condition with aws:SourceAccount or aws:SourceArn. A service with access to several accounts can otherwise be tricked into acting on an unintended one.",
      risks: ["AI_SECURITY"],
      threats: [],
      resourceName: "BIGDATA-AI-AIGEN-WEATHERFORECAST-PP",
      resourceType: "SERVICE_ACCOUNT",
      resourceStatus: "Active",
      targetExternalId: "arn:aws:iam::614303399241:role/BIGDATA-AI-AIGEN-WEATHERFORECAST-PP",
      source: "WIZ_CSPM",
      subscriptionName: "aws-account-prod-01",
      cloudProvider: "AWS",
      projects: [{ id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
      businessImpact: "LBI",
      ignoreRuleIds: [],
      iacFindingIds: []
    },
    {
      id: "cfg-007",
      // RESOLVED, and therefore PASS. Stored for the lifecycle clock, counted by nothing:
      // isOpenGap keeps it out of complianceGaps, AARS pillar B and the severity strip.
      resourceId: "agent-a",
      ruleShortId: "SUB-114",
      severity: "HIGH",
      remediation: "Public ingress was removed from the service hosting this agent.",
      frameworkCodes: ["SUB-114"],
      name: "AI agent host is reachable from the public internet",
      status: "RESOLVED",
      result: "PASS",
      firstSeenAt: "2026-03-11T09:00:00Z",
      analyzedAt: "2026-08-07T07:37:41Z",
      ruleName: "AI agent hosts should not be open to all internet",
      risks: ["AI_SECURITY"],
      threats: [],
      resourceName: "Agent A",
      resourceType: "AI_AGENT",
      resourceStatus: "Active",
      source: "WIZ_CSPM",
      subscriptionName: "gcp-account-01",
      cloudProvider: "GCP",
      projects: [{ id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
      businessImpact: "LBI",
      ignoreRuleIds: [],
      iacFindingIds: []
    }
  ];
  var SEED_NODES = [...AGENTS, ...awsRoles, ...SUPPORT, ...extraNodes].map(node);
  var SEED_EDGES = edges;
  var SEED_ISSUES = issues;
  var SEED_FINDINGS = SEED_FINDINGS_DATA;
  var SEED_AARS_HINTS = HINTS;
  var SEED_DATA_FINDINGS = [
    { id: "df-pii-01", resourceId: "bucket-customer-pii", name: "PII: email addresses (12,400 rows)", severity: "CRITICAL" },
    { id: "df-pii-02", resourceId: "bucket-customer-pii", name: "PII: national identification numbers", severity: "HIGH" },
    { id: "df-pii-03", resourceId: "bucket-customer-pii", name: "PCI: primary account numbers", severity: "HIGH" },
    { id: "df-core-01", resourceId: "db-customer-core", name: "PII: postal addresses", severity: "CRITICAL" },
    { id: "df-core-02", resourceId: "db-customer-core", name: "PII: dates of birth", severity: "MEDIUM" },
    { id: "df-fin-01", resourceId: "bucket-finance-reports", name: "Financial: unpublished results", severity: "HIGH" }
  ];
  var SEED_FRAMEWORKS = [
    {
      id: "wf-id-275",
      name: "OWASP Top 10 For Agentic Applications 2026",
      description: "Agentic-application risks: goal hijack, tool misuse, rogue agents.",
      builtin: true,
      enabled: true,
      policyTypes: ["CLOUD_CONFIGURATION_RULE", "CONTROL"],
      selected: true
    },
    {
      id: "wf-id-214",
      name: "5Rs - Wiz for Data Security",
      description: "Wiz's data-security response taxonomy: Reduce, Restrict, Relabel, \u2026",
      builtin: true,
      enabled: true,
      policyTypes: ["CLOUD_CONFIGURATION_RULE", "CONTROL"],
      selected: true
    },
    {
      id: "wf-id-106",
      name: "OWASP ML Security Top 10",
      description: "Machine-learning security risks: poisoning, inversion, model theft.",
      builtin: true,
      enabled: true,
      policyTypes: ["CONTROL"],
      selected: true
    },
    {
      id: "wf-id-201",
      name: "OWASP LLM Security Top 10",
      description: "LLM application risks: prompt injection, disclosure, poisoning.",
      builtin: true,
      enabled: true,
      policyTypes: ["CLOUD_CONFIGURATION_RULE", "CONTROL"],
      selected: true
    },
    // Present in the tenant, NOT selected — so the Settings picker has something to show
    // that is off, and the page can prove selection is this app's decision rather than a
    // list of everything Wiz has.
    {
      id: "wf-id-042",
      name: "CIS Amazon Web Services Foundations Benchmark v3.0",
      description: "General cloud hardening. No AI vocabulary \u2014 posture is not collected.",
      builtin: true,
      enabled: true,
      policyTypes: ["CLOUD_CONFIGURATION_RULE"],
      selected: false
    }
  ];
  function seedCategory(frameworkId, externalId, title, posturePct2, passCount, failCount, emptyPostureReason = null) {
    return {
      frameworkId,
      level: "category",
      categoryExternalId: externalId,
      nodeId: `wct-seed-${frameworkId}-${externalId}`,
      title,
      posturePct: posturePct2,
      passCount,
      failCount,
      passSubCategoryCount: posturePct2 === null ? 0 : 1,
      failSubCategoryCount: failCount > 0 ? 1 : 0,
      emptyPostureReason
    };
  }
  function seedSubCategory(frameworkId, categoryExternalId, externalId, title, posturePct2, passCount, failCount, emptyPostureReason = null) {
    return {
      frameworkId,
      level: "subcategory",
      categoryExternalId,
      subcategoryExternalId: externalId,
      nodeId: `wsct-seed-${frameworkId}-${externalId}`,
      title,
      posturePct: posturePct2,
      passCount,
      failCount,
      emptyPostureReason,
      tags: []
    };
  }
  var SEED_POSTURE = [
    // ---- OWASP Agentic 2026 ----
    {
      frameworkId: "wf-id-275",
      level: "framework",
      nodeId: "wf-id-275",
      title: "OWASP Top 10 For Agentic Applications 2026",
      posturePct: 96,
      passCount: 0,
      failCount: 0,
      passSubCategoryCount: 2,
      failSubCategoryCount: 2,
      emptyPostureReason: null
    },
    seedCategory("wf-id-275", "ASI01", "ASI01 Agent Goal Hijack", 93, 144, 10),
    seedSubCategory("wf-id-275", "ASI01", "ASI01", "ASI01 Agent Goal Hijack", 93, 144, 10),
    seedCategory("wf-id-275", "ASI03", "ASI03 Identity and Privilege Abuse", 99, 6347, 18),
    seedSubCategory("wf-id-275", "ASI03", "ASI03", "ASI03 Identity and Privilege Abuse", 99, 6347, 18),
    // The empty category: nothing in this estate to assess. Posture null, reason given —
    // the case the page must never render as 0%.
    seedCategory("wf-id-275", "ASI08", "ASI08 Cascading Failures", null, 0, 0, "NO_RESOURCES"),
    seedSubCategory("wf-id-275", "ASI08", "ASI08", "ASI08 Cascading Failures", null, 0, 0, "NO_RESOURCES"),
    seedCategory("wf-id-275", "ASI10", "ASI10 Rogue Agents", 99, 16703, 87),
    seedSubCategory("wf-id-275", "ASI10", "ASI10", "ASI10 Rogue Agents", 99, 16703, 87),
    // ---- Wiz 5Rs ----
    {
      frameworkId: "wf-id-214",
      level: "framework",
      nodeId: "wf-id-214",
      title: "5Rs - Wiz for Data Security",
      posturePct: 85,
      passCount: 0,
      failCount: 0,
      // Five categories now, one of which reports nothing. The framework percentage stays
      // 85 and is deliberately NOT the mean of its categories (62/91/78/85/null averages to
      // 79) — Wiz's aggregation is undocumented and this row exists partly to keep a
      // recomputation from ever looking correct.
      passSubCategoryCount: 1,
      failSubCategoryCount: 4,
      emptyPostureReason: null
    },
    // NO_POLICIES is a DIFFERENT emptiness from NO_RESOURCES: nothing was written to assess,
    // rather than nothing existing to assess against. Both must read as their own state.
    seedCategory("wf-id-214", "1", "Reduce", null, 0, 0, "NO_RESOURCES"),
    seedSubCategory("wf-id-214", "1", "1.1", "Stale data resources", null, 0, 0, "NO_POLICIES"),
    seedCategory("wf-id-214", "2", "Restrict", 85, 194309, 71),
    seedSubCategory("wf-id-214", "2", "2.1", "Public data exposure", 85, 194309, 71),
    // The other three Rs, and the reason they are seeded at all: this is a DATA-security
    // framework collected by an AI product, and until now the sample carried only the two
    // categories whose rules happen to be about AI (a Bedrock trust policy, a training
    // bucket). An estate that agrees with the product's focus cannot demonstrate the scope
    // feature, and worse, cannot catch it silently excluding nothing.
    //
    // Note the check counts. 2.1 reports 194,309 passing against ASI01's 144 — three orders
    // of magnitude, because Wiz is scoring the WHOLE data estate here, not the AI slice of
    // it. That gap is the framework's non-AI character showing up in the numbers, and these
    // rows keep it visible.
    seedCategory("wf-id-214", "3", "Relabel", 62, 88412, 1204),
    seedSubCategory("wf-id-214", "3", "3.1", "Unlabelled sensitive data", 62, 88412, 1204),
    seedCategory("wf-id-214", "4", "Relocate", 91, 40210, 331),
    seedSubCategory("wf-id-214", "4", "4.1", "Data residency", 91, 40210, 331),
    seedCategory("wf-id-214", "5", "Reconfigure", 78, 120044, 2210),
    seedSubCategory("wf-id-214", "5", "5.1", "Encryption and retention", 78, 120044, 2210),
    // ---- OWASP ML ----
    {
      frameworkId: "wf-id-106",
      level: "framework",
      nodeId: "wf-id-106",
      title: "OWASP ML Security Top 10",
      posturePct: 100,
      passCount: 0,
      failCount: 0,
      passSubCategoryCount: 1,
      failSubCategoryCount: 0,
      emptyPostureReason: null
    },
    seedCategory("wf-id-106", "ML02", "Data Poisoning Attack", 100, 126e3, 0),
    seedSubCategory("wf-id-106", "ML02", "ML02", "Data Poisoning Attack", 100, 126e3, 0),
    // ---- OWASP LLM ----
    // The awkward shape: NUMERIC external ids, with the OWASP code carried in the category
    // NAME and stamped with its edition. Seeded so the dry run exercises the one framework
    // whose codes cannot be read off an id.
    {
      frameworkId: "wf-id-201",
      level: "framework",
      nodeId: "wf-id-201",
      title: "OWASP LLM Security Top 10",
      posturePct: 95,
      passCount: 0,
      failCount: 0,
      passSubCategoryCount: 1,
      failSubCategoryCount: 1,
      emptyPostureReason: null
    },
    seedCategory("wf-id-201", "1", "1 LLM01:2025 Prompt Injection", 90, 691, 70),
    seedSubCategory("wf-id-201", "1", "1.1", "1.1  Prompt Injection", 90, 691, 70),
    seedCategory("wf-id-201", "2", "2 LLM02:2025 Sensitive Information Disclosure", 98, 5929, 100),
    seedSubCategory("wf-id-201", "2", "2.1", "2.1 Sensitive Information Disclosure", 98, 5929, 100)
  ];
  function seedPolicy(frameworkId, categoryExternalId, subcategoryExternalId, shortId, name, severity, passCount, failCount) {
    return {
      frameworkId,
      categoryExternalId,
      subcategoryExternalId,
      policyId: `pol-${shortId}`,
      policyKind: "CLOUD_RULE",
      shortId,
      name,
      severity,
      enabled: true,
      builtin: true,
      passCount,
      failCount,
      assessedCount: passCount + failCount,
      rejectedCount: 0,
      noResourceToAssess: passCount + failCount === 0,
      cloudProvider: "AWS"
    };
  }
  var SEED_FRAMEWORK_POLICIES = [
    // SUB-082 under TWO subcategories of the same framework — the many-to-many, in the
    // simplest form. Summing these rows as distinct policies would double-count it.
    seedPolicy(
      "wf-id-275",
      "ASI01",
      "ASI01",
      "SUB-082",
      "Vertex AI Metadata Store must use a customer-managed key",
      "MEDIUM",
      21,
      2
    ),
    seedPolicy(
      "wf-id-275",
      "ASI10",
      "ASI10",
      "SUB-082",
      "Vertex AI Metadata Store must use a customer-managed key",
      "MEDIUM",
      21,
      2
    ),
    // IAM-236 under ASI03 *and* under 5Rs Restrict — the many-to-many ACROSS frameworks,
    // which is why the join key is (framework, subcategory, policy) and not the policy.
    seedPolicy(
      "wf-id-275",
      "ASI03",
      "ASI03",
      "IAM-236",
      "Bedrock service roles must prevent confused-deputy access",
      "HIGH",
      1718,
      18
    ),
    seedPolicy(
      "wf-id-214",
      "2",
      "2.1",
      "IAM-236",
      "Bedrock service roles must prevent confused-deputy access",
      "HIGH",
      1718,
      18
    ),
    seedPolicy(
      "wf-id-275",
      "ASI03",
      "ASI03",
      "IAM-267",
      "Agent service accounts must not hold wildcard data permissions",
      "HIGH",
      42,
      3
    ),
    // SUB-114 under ASI10 and under the ML framework — so it picks up an ASI code and an
    // ML_ one, proving the two spellings coexist on one finding.
    seedPolicy(
      "wf-id-275",
      "ASI10",
      "ASI10",
      "SUB-114",
      "Agent must be attached to a guardrail",
      "HIGH",
      9,
      5
    ),
    seedPolicy(
      "wf-id-106",
      "ML02",
      "ML02",
      "SUB-114",
      "Agent must be attached to a guardrail",
      "HIGH",
      9,
      5
    ),
    seedPolicy(
      "wf-id-214",
      "2",
      "2.1",
      "SUB-047",
      "Training bucket must not allow public write",
      "CRITICAL",
      30,
      1
    ),
    // The 5Rs rules this product has no use for: general cloud data governance, evaluated
    // against the whole estate. None is mapped into an OWASP framework and none has a
    // finding on an AI asset, so the derived scope files all four out — which is the point
    // of seeding them. Without these the scope excludes nothing and a broken filter looks
    // exactly like a working one.
    seedPolicy(
      "wf-id-214",
      "3",
      "3.1",
      "DATA-311",
      "Object storage buckets must carry a data-sensitivity label",
      "MEDIUM",
      62108,
      1204
    ),
    seedPolicy(
      "wf-id-214",
      "3",
      "3.1",
      "DATA-318",
      "Managed databases must declare a classification tag",
      "LOW",
      26304,
      486
    ),
    seedPolicy(
      "wf-id-214",
      "4",
      "4.1",
      "DATA-402",
      "Customer data must not leave its declared residency region",
      "HIGH",
      40210,
      331
    ),
    seedPolicy(
      "wf-id-214",
      "5",
      "5.1",
      "DATA-514",
      "Object storage must define a retention policy",
      "MEDIUM",
      98720,
      2210
    ),
    // ...and one that stays. SUB-082 already sits under ASI01 and ASI10, so Wiz itself
    // files it under an AI framework and the cross-mapping signal keeps it in scope. It is
    // here so that "Reconfigure" cannot be read as "a category that is entirely off":
    // scope is a property of a rule, not of the R it happens to live under.
    seedPolicy(
      "wf-id-214",
      "5",
      "5.1",
      "SUB-082",
      "Vertex AI Metadata Store must use a customer-managed key",
      "MEDIUM",
      21,
      2
    ),
    // SUB-114 also lands under LLM01, so one finding ends up carrying an ASI code, an ML_
    // code AND an LLM code — three vocabularies on one failing control, which is the point.
    seedPolicy(
      "wf-id-201",
      "1",
      "1.1",
      "SUB-114",
      "Agent must be attached to a guardrail",
      "HIGH",
      9,
      5
    ),
    seedPolicy(
      "wf-id-201",
      "2",
      "2.1",
      "IAM-267",
      "Agent service accounts must not hold wildcard data permissions",
      "HIGH",
      42,
      3
    ),
    // Nothing to assess: every count zero AND the flag set. Renders as its own state, never
    // as a 0% score.
    {
      frameworkId: "wf-id-275",
      categoryExternalId: "ASI08",
      subcategoryExternalId: "ASI08",
      policyId: "pol-AIService-009",
      policyKind: "CLOUD_RULE",
      shortId: "AIService-009",
      name: "Agent orchestration must bound retry fan-out",
      severity: "MEDIUM",
      enabled: true,
      builtin: true,
      passCount: 0,
      failCount: 0,
      assessedCount: 0,
      rejectedCount: 0,
      noResourceToAssess: true,
      cloudProvider: "Azure"
    },
    // A Control rather than a cloud rule — no shortId at all, so the finding join can only
    // reach it by uuid. Both keys exist in the lookup for exactly this reason.
    {
      frameworkId: "wf-id-275",
      categoryExternalId: "ASI01",
      subcategoryExternalId: "ASI01",
      policyId: "667e01f9-1105-42d5-a66a-e7f739fb4c4f",
      policyKind: "CONTROL",
      name: "Highly privileged AI agent is not protected by AI guardrails",
      severity: "MEDIUM",
      enabled: true,
      builtin: true,
      passCount: 72,
      failCount: 0,
      assessedCount: 72,
      rejectedCount: 0,
      noResourceToAssess: false
    }
  ];
  function seedGraphDoc(syncedAt) {
    return { nodes: SEED_NODES, edges: SEED_EDGES, syncedAt };
  }
  var SEED_TREND = [
    { CRITICAL: 5, HIGH: 12, MEDIUM: 0, LOW: 2, INFO: 11 },
    { CRITICAL: 5, HIGH: 13, MEDIUM: 0, LOW: 2, INFO: 10 },
    { CRITICAL: 4, HIGH: 15, MEDIUM: 0, LOW: 3, INFO: 9 },
    { CRITICAL: 4, HIGH: 16, MEDIUM: 0, LOW: 3, INFO: 9 },
    { CRITICAL: 3, HIGH: 16, MEDIUM: 0, LOW: 3, INFO: 8 },
    { CRITICAL: 3, HIGH: 17, MEDIUM: 0, LOW: 3, INFO: 8 },
    { CRITICAL: 2, HIGH: 17, MEDIUM: 0, LOW: 3, INFO: 8 },
    { CRITICAL: 2, HIGH: 17, MEDIUM: 0, LOW: 3, INFO: 8 }
  ];
  var SEED_CONFIG_RULES = [
    {
      id: "rule-iam-159",
      shortId: "IAM-159",
      name: "User should have MFA enabled",
      subjectEntityType: "USER_ACCOUNT",
      externalRefs: []
    },
    {
      id: "rule-iam-208",
      shortId: "IAM-208",
      name: "User with password-based authentication should have multi-factor authentication (MFA) enabled",
      subjectEntityType: "USER_ACCOUNT",
      externalRefs: []
    },
    {
      id: "rule-iam-235",
      shortId: "IAM-235",
      name: "User should not be inactive for more than 90 days",
      subjectEntityType: "USER_ACCOUNT",
      externalRefs: []
    },
    {
      // The gloss the AARS cascade has always lacked: SEED_FINDINGS prices SUB-082 and the
      // codebook has never been able to render what it means.
      id: "rule-sub-082",
      shortId: "SUB-082",
      name: "Vertex AI Metadata Store should be encrypted with a customer-managed key",
      subjectEntityType: "REGION",
      externalRefs: ["CKV_GCP_96", "CKV2_GCP_25"]
    },
    {
      id: "rule-idp-012",
      shortId: "IDP-012",
      name: "WorkSpaces Directory should have multi-factor authentication enabled",
      subjectEntityType: "IDENTITY_PROVIDER",
      externalRefs: []
    }
  ];
  var SEED_IDENTITY_FINDINGS = [
    {
      id: "idf-001",
      resourceId: "user-ops-01",
      resourceName: "ops.user01@example.com",
      ruleId: "rule-iam-159",
      ruleShortId: "IAM-159",
      ruleName: "User should have MFA enabled",
      severity: "HIGH",
      status: "OPEN",
      result: "FAIL",
      firstSeenAt: "2026-05-02T09:14:00Z",
      analyzedAt: "2026-08-13T04:00:00Z",
      remediation: "Enrol this account in multi-factor authentication.",
      hygiene: "MFA"
    },
    {
      id: "idf-002",
      resourceId: "user-ops-02",
      resourceName: "ops.user02@example.com",
      ruleId: "rule-iam-235",
      ruleShortId: "IAM-235",
      ruleName: "User should not be inactive for more than 90 days",
      severity: "MEDIUM",
      status: "OPEN",
      result: "FAIL",
      firstSeenAt: "2026-04-18T11:02:00Z",
      analyzedAt: "2026-08-13T04:00:00Z",
      remediation: "Disable or remove accounts that are no longer in use.",
      hygiene: "DORMANT"
    },
    {
      id: "idf-003",
      resourceId: "user-ops-05",
      resourceName: "ops.user05@example.com",
      ruleId: "rule-iam-159",
      ruleShortId: "IAM-159",
      ruleName: "User should have MFA enabled",
      severity: "HIGH",
      status: "OPEN",
      result: "FAIL",
      firstSeenAt: "2026-05-02T09:14:00Z",
      analyzedAt: "2026-08-13T04:00:00Z",
      hygiene: "MFA"
    }
  ];
  var SEED_EFFECTIVE_ACCESS = [
    {
      identityId: "user-ops-01",
      identityName: "ops.user01@example.com",
      resourceId: "agent-h-chatbot",
      accessTypes: ["DATA"],
      permissions: ["aiplatform.endpoints.predict", "storage.objects.get"],
      policyIds: ["policy-ops-admin"],
      policyNames: ["ops-admin-binding"]
    },
    {
      identityId: "user-ops-07",
      identityName: "ops.user07@example.com",
      resourceId: "agent-h-chatbot",
      accessTypes: ["DATA"],
      permissions: ["storage.objects.get"],
      policyIds: ["policy-ops-reader"],
      policyNames: ["ops-reader-binding"]
    }
  ];

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
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
    return {
      id: n.id,
      kind: n.kind,
      name: n.name,
      native_type: (_a5 = n.nativeType) != null ? _a5 : null,
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
      aars_severity: (_o = n.aarsSeverity) != null ? _o : null,
      aars_pillars_json: n.aarsPillars ? JSON.stringify(n.aarsPillars) : null,
      aars_input_json: n.aarsInput ? JSON.stringify(n.aarsInput) : null,
      combo_groups: ((_p = n.comboGroups) != null ? _p : []).join(","),
      tags_json: n.tags ? JSON.stringify(n.tags) : null,
      identity_purpose: (_q = n.identityPurpose) != null ? _q : null,
      issue_analytics_json: n.issueAnalytics ? JSON.stringify(n.issueAnalytics) : null,
      // `?? null` rather than `?? 0`: a store the traversal never reached must read back as
      // undefined, not as "zero findings". The graph draws no aggregate for either, but the
      // pillar-C knob and the DSPM coverage state both need to tell them apart.
      data_finding_count: (_r = n.dataFindingCount) != null ? _r : null,
      data_findings_json: n.dataFindingSeverities ? JSON.stringify(n.dataFindingSeverities) : null,
      exposure_level: (_s = n.exposureLevel) != null ? _s : null,
      port_validation: (_t = n.portValidation) != null ? _t : null,
      // `null` rather than `"{}"` when there is no evidence, and rowToAsset reads it back as
      // undefined: an asset the exposure steps never reached must not become one they reached
      // and found clean. conditionState falls through to the flags for the first and would
      // have to keep falling through for the second — but only one of them is honest about it.
      exposure_evidence_json: n.exposureEvidence ? JSON.stringify(n.exposureEvidence) : null,
      // `?? null`, never `?? false`: an identity row the tenant reported no dormancy for must
      // read back as undefined. "Not reported" and "in use" are different answers.
      inactive: n.inactive === void 0 ? null : boolCell(n.inactive),
      inactive_timeframe: (_u = n.inactiveTimeframe) != null ? _u : null,
      human_access_json: n.humanAccess ? JSON.stringify(n.humanAccess) : null,
      display_name: (_v = n.displayName) != null ? _v : null,
      email: (_w = n.email) != null ? _w : null,
      publisher: (_x = n.publisher) != null ? _x : null,
      discovery_methods: ((_y = n.discoveryMethods) != null ? _y : []).join(",")
    };
  }
  function rowToAsset(r) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w;
    const node2 = {
      id: String((_a5 = r["id"]) != null ? _a5 : ""),
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
    const aarsSev = normalizeAarsSeverity((_m = r["aars_severity"]) != null ? _m : r["aars_band"]);
    if (aarsSev) node2.aarsSeverity = aarsSev;
    const pillars = parseJson(r["aars_pillars_json"], null);
    if (pillars) node2.aarsPillars = pillars;
    const aarsInput = parseJson(r["aars_input_json"], null);
    if (aarsInput) node2.aarsInput = aarsInput;
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
    const findingCount = r["data_finding_count"];
    if (findingCount !== null && findingCount !== void 0 && String(findingCount) !== "") {
      node2.dataFindingCount = Number(findingCount);
    }
    const findingSevs = parseJson(r["data_findings_json"], null);
    if (findingSevs) node2.dataFindingSeverities = findingSevs;
    const exposureLevel = (_q = r["exposure_level"]) != null ? _q : null;
    if (exposureLevel) node2.exposureLevel = exposureLevel;
    const portValidation = (_r = r["port_validation"]) != null ? _r : null;
    if (portValidation) node2.portValidation = portValidation;
    const evidence = parseJson(r["exposure_evidence_json"], null);
    if (evidence) node2.exposureEvidence = evidence;
    const inactive = parseTri(r["inactive"]);
    if (inactive !== null) node2.inactive = inactive;
    const inactiveTimeframe = (_s = r["inactive_timeframe"]) != null ? _s : null;
    if (inactiveTimeframe) node2.inactiveTimeframe = inactiveTimeframe;
    const humanAccess = parseJson(r["human_access_json"], null);
    if (humanAccess) node2.humanAccess = humanAccess;
    const displayName = (_t = r["display_name"]) != null ? _t : null;
    if (displayName) node2.displayName = displayName;
    const email = (_u = r["email"]) != null ? _u : null;
    if (email) node2.email = email;
    const publisher = (_v = r["publisher"]) != null ? _v : null;
    if (publisher) node2.publisher = publisher;
    const methods = String((_w = r["discovery_methods"]) != null ? _w : "").split(",").filter(Boolean);
    if (methods.length) node2.discoveryMethods = methods;
    return node2;
  }
  function edgeToRow(e) {
    var _a5;
    return {
      id: e.id,
      src: e.src,
      dst: e.dst,
      type: e.type,
      negated: boolCell(e.negated),
      access_type: (_a5 = e.accessType) != null ? _a5 : null
    };
  }
  function rowToEdge(r) {
    var _a5, _b, _c, _d, _e;
    const e = {
      id: String((_a5 = r["id"]) != null ? _a5 : ""),
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
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
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
      region: (_a5 = i.region) != null ? _a5 : null,
      account: (_b = i.account) != null ? _b : null,
      projects_json: JSON.stringify((_c = i.projects) != null ? _c : []),
      frameworks_json: JSON.stringify((_d = i.frameworks) != null ? _d : {}),
      justification: (_e = i.justification) != null ? _e : null,
      created_at: (_f = i.createdAt) != null ? _f : null,
      due_at: (_g = i.dueAt) != null ? _g : null,
      resolution_recommendation: (_h = i.resolutionRecommendation) != null ? _h : null,
      remediation: (_i = i.remediation) != null ? _i : null,
      issue_type: (_j = i.issueType) != null ? _j : null,
      updated_at: (_k = i.updatedAt) != null ? _k : null,
      resolved_at: (_l = i.resolvedAt) != null ? _l : null,
      resolution_reason: (_m = i.resolutionReason) != null ? _m : null,
      resolved_by: (_n = i.resolvedBy) != null ? _n : null,
      assignee: (_o = i.assignee) != null ? _o : null,
      // Comma-joined, matching combo_groups / technology_categories on ai_assets; the
      // _json suffix is reserved for structured values.
      environments: ((_p = i.environments) != null ? _p : []).join(","),
      validated_exploitable: boolCell(i.validatedAsExploitable),
      business_impact: (_q = i.businessImpact) != null ? _q : null,
      entity_status: (_r = i.entityStatus) != null ? _r : null,
      subscription_id: (_s = i.subscriptionId) != null ? _s : null,
      ignore_note: (_t = i.ignoreNote) != null ? _t : null,
      ignore_expired_at: (_u = i.ignoreExpiredAt) != null ? _u : null,
      ticket_urls: ((_v = i.ticketUrls) != null ? _v : []).join(","),
      ai_verdict: (_w = i.aiVerdict) != null ? _w : null,
      ai_recommended_severity: (_x = i.aiRecommendedSeverity) != null ? _x : null
    };
  }
  function rowToIssue(r) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E;
    const issue2 = {
      id: String((_a5 = r["id"]) != null ? _a5 : ""),
      ruleId: String((_b = r["rule_id"]) != null ? _b : ""),
      ruleName: String((_c = r["rule_name"]) != null ? _c : ""),
      // A ledger written before the Other bucket existed holds "" for every unclassified
      // issue. Without this fallback those rows keep falling out of every rollup until
      // someone happens to re-sync.
      comboGroup: String((_d = r["combo_group"]) != null ? _d : "") || OTHER_GROUP_ID,
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
      remediation: (_p = r["remediation"]) != null ? _p : void 0,
      issueType: (_q = r["issue_type"]) != null ? _q : void 0,
      updatedAt: (_r = r["updated_at"]) != null ? _r : void 0,
      resolvedAt: (_s = r["resolved_at"]) != null ? _s : void 0,
      resolutionReason: (_t = r["resolution_reason"]) != null ? _t : void 0,
      resolvedBy: (_u = r["resolved_by"]) != null ? _u : void 0,
      assignee: (_v = r["assignee"]) != null ? _v : void 0,
      businessImpact: (_w = r["business_impact"]) != null ? _w : void 0,
      entityStatus: (_x = r["entity_status"]) != null ? _x : void 0,
      subscriptionId: (_y = r["subscription_id"]) != null ? _y : void 0,
      ignoreNote: (_z = r["ignore_note"]) != null ? _z : void 0,
      ignoreExpiredAt: (_A = r["ignore_expired_at"]) != null ? _A : void 0,
      aiVerdict: (_B = r["ai_verdict"]) != null ? _B : void 0,
      aiRecommendedSeverity: (_C = r["ai_recommended_severity"]) != null ? _C : void 0
    };
    const environments = String((_D = r["environments"]) != null ? _D : "").split(",").filter(Boolean);
    if (environments.length) issue2.environments = environments;
    const ticketUrls = String((_E = r["ticket_urls"]) != null ? _E : "").split(",").filter(Boolean);
    if (ticketUrls.length) issue2.ticketUrls = ticketUrls;
    if (parseBool(r["validated_exploitable"])) issue2.validatedAsExploitable = true;
    return issue2;
  }
  var CELL_MAX = 5e4;
  var CLAMP_MARKER = "\n\u2026 truncated for storage";
  function cell(v) {
    if (v === void 0) return null;
    if (v.length <= CELL_MAX) return v;
    return v.slice(0, CELL_MAX - CLAMP_MARKER.length) + CLAMP_MARKER;
  }
  function optional(v) {
    return v === null || v === void 0 || v === "" ? void 0 : String(v);
  }
  function findingToRow(f) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r;
    return {
      id: f.id,
      resource_id: f.resourceId,
      rule_short_id: f.ruleShortId,
      severity: f.severity,
      remediation: cell(f.remediation),
      framework_codes: ((_a5 = f.frameworkCodes) != null ? _a5 : []).join(","),
      name: (_b = f.name) != null ? _b : null,
      status: (_c = f.status) != null ? _c : null,
      result: (_d = f.result) != null ? _d : null,
      // Tri-state, like the internet flag: "null" for a response that never carried the
      // field. isOpenGap only tombstones on an explicit true, so absent must not read false.
      deleted: triCell(f.deleted),
      first_seen_at: (_e = f.firstSeenAt) != null ? _e : null,
      analyzed_at: (_f = f.analyzedAt) != null ? _f : null,
      rule_id: (_g = f.ruleId) != null ? _g : null,
      rule_graph_id: (_h = f.ruleGraphId) != null ? _h : null,
      rule_name: (_i = f.ruleName) != null ? _i : null,
      rule_description: cell(f.ruleDescription),
      remediation_instructions: cell(f.remediationInstructions),
      opa_policy: cell(f.opaPolicy),
      risks_json: f.risks && f.risks.length ? JSON.stringify(f.risks) : null,
      threats_json: f.threats && f.threats.length ? JSON.stringify(f.threats) : null,
      resource_name: (_j = f.resourceName) != null ? _j : null,
      resource_type: (_k = f.resourceType) != null ? _k : null,
      resource_status: (_l = f.resourceStatus) != null ? _l : null,
      target_external_id: (_m = f.targetExternalId) != null ? _m : null,
      source: (_n = f.source) != null ? _n : null,
      subscription_id: (_o = f.subscriptionId) != null ? _o : null,
      subscription_name: (_p = f.subscriptionName) != null ? _p : null,
      cloud_provider: (_q = f.cloudProvider) != null ? _q : null,
      projects_json: f.projects && f.projects.length ? JSON.stringify(f.projects) : null,
      business_impact: (_r = f.businessImpact) != null ? _r : null,
      ignore_rule_ids_json: f.ignoreRuleIds && f.ignoreRuleIds.length ? JSON.stringify(f.ignoreRuleIds) : null,
      iac_finding_ids_json: f.iacFindingIds && f.iacFindingIds.length ? JSON.stringify(f.iacFindingIds) : null
    };
  }
  function rowToFinding(r) {
    var _a5, _b, _c, _d, _e;
    const finding = {
      id: String((_a5 = r["id"]) != null ? _a5 : ""),
      resourceId: String((_b = r["resource_id"]) != null ? _b : ""),
      ruleShortId: String((_c = r["rule_short_id"]) != null ? _c : ""),
      severity: String((_d = r["severity"]) != null ? _d : "UNKNOWN"),
      remediation: optional(r["remediation"]),
      frameworkCodes: String((_e = r["framework_codes"]) != null ? _e : "").split(",").filter(Boolean),
      name: optional(r["name"]),
      status: optional(r["status"]),
      result: optional(r["result"]),
      firstSeenAt: optional(r["first_seen_at"]),
      analyzedAt: optional(r["analyzed_at"]),
      ruleId: optional(r["rule_id"]),
      ruleGraphId: optional(r["rule_graph_id"]),
      ruleName: optional(r["rule_name"]),
      ruleDescription: optional(r["rule_description"]),
      remediationInstructions: optional(r["remediation_instructions"]),
      opaPolicy: optional(r["opa_policy"]),
      risks: parseJson(r["risks_json"], []),
      threats: parseJson(r["threats_json"], []),
      resourceName: optional(r["resource_name"]),
      resourceType: optional(r["resource_type"]),
      resourceStatus: optional(r["resource_status"]),
      targetExternalId: optional(r["target_external_id"]),
      source: optional(r["source"]),
      subscriptionId: optional(r["subscription_id"]),
      subscriptionName: optional(r["subscription_name"]),
      cloudProvider: optional(r["cloud_provider"]),
      projects: parseJson(r["projects_json"], []),
      businessImpact: optional(r["business_impact"]),
      ignoreRuleIds: parseJson(r["ignore_rule_ids_json"], []),
      iacFindingIds: parseJson(r["iac_finding_ids_json"], [])
    };
    const deleted = parseTri(r["deleted"]);
    if (deleted !== null) finding.deleted = deleted;
    return finding;
  }
  function dataFindingToRow(f) {
    return {
      id: f.id,
      resource_id: f.resourceId,
      name: f.name,
      severity: f.severity
    };
  }
  function frameworkToRow(f) {
    var _a5, _b;
    return {
      id: f.id,
      name: f.name,
      description: (_a5 = f.description) != null ? _a5 : "",
      builtin: f.builtin,
      enabled: f.enabled,
      policy_types: ((_b = f.policyTypes) != null ? _b : []).join(",")
    };
  }
  function rowToFramework(r) {
    var _a5, _b, _c, _d;
    return {
      id: String((_a5 = r["id"]) != null ? _a5 : ""),
      name: String((_b = r["name"]) != null ? _b : ""),
      description: String((_c = r["description"]) != null ? _c : "") || void 0,
      builtin: r["builtin"] === true || r["builtin"] === "TRUE" || r["builtin"] === "true",
      enabled: r["enabled"] === true || r["enabled"] === "TRUE" || r["enabled"] === "true",
      policyTypes: String((_d = r["policy_types"]) != null ? _d : "").split(",").filter(Boolean),
      // Never stored. Resolved against the settings selection by the API model, which is the
      // only place that knows.
      selected: false
    };
  }
  function configRuleToRow(r) {
    var _a5, _b;
    return {
      id: r.id,
      short_id: r.shortId,
      name: r.name,
      subject_entity_type: (_a5 = r.subjectEntityType) != null ? _a5 : "",
      external_refs: ((_b = r.externalRefs) != null ? _b : []).join(",")
    };
  }
  function rowToConfigRule(r) {
    var _a5, _b, _c, _d, _e;
    return {
      id: String((_a5 = r["id"]) != null ? _a5 : ""),
      shortId: String((_b = r["short_id"]) != null ? _b : ""),
      name: String((_c = r["name"]) != null ? _c : ""),
      subjectEntityType: String((_d = r["subject_entity_type"]) != null ? _d : "") || void 0,
      externalRefs: String((_e = r["external_refs"]) != null ? _e : "").split(",").filter(Boolean)
    };
  }
  function identityFindingToRow(f) {
    var _a5, _b, _c, _d, _e, _f, _g, _h;
    return {
      id: f.id,
      resource_id: f.resourceId,
      resource_name: (_a5 = f.resourceName) != null ? _a5 : null,
      rule_id: (_b = f.ruleId) != null ? _b : null,
      rule_short_id: f.ruleShortId,
      rule_name: (_c = f.ruleName) != null ? _c : null,
      severity: f.severity,
      status: (_d = f.status) != null ? _d : null,
      result: (_e = f.result) != null ? _e : null,
      first_seen_at: (_f = f.firstSeenAt) != null ? _f : null,
      analyzed_at: (_g = f.analyzedAt) != null ? _g : null,
      remediation: (_h = f.remediation) != null ? _h : null,
      hygiene: f.hygiene
    };
  }
  function rowToIdentityFinding(r) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
    return {
      id: String((_a5 = r["id"]) != null ? _a5 : ""),
      resourceId: String((_b = r["resource_id"]) != null ? _b : ""),
      resourceName: (_c = r["resource_name"]) != null ? _c : void 0,
      ruleId: (_d = r["rule_id"]) != null ? _d : void 0,
      ruleShortId: String((_e = r["rule_short_id"]) != null ? _e : ""),
      ruleName: (_f = r["rule_name"]) != null ? _f : void 0,
      severity: String((_g = r["severity"]) != null ? _g : "UNKNOWN"),
      status: (_h = r["status"]) != null ? _h : void 0,
      result: (_i = r["result"]) != null ? _i : void 0,
      firstSeenAt: (_j = r["first_seen_at"]) != null ? _j : void 0,
      analyzedAt: (_k = r["analyzed_at"]) != null ? _k : void 0,
      remediation: (_l = r["remediation"]) != null ? _l : void 0,
      // Defaulted rather than validated: the column is written by this app from the matcher's
      // verdict, so an unrecognised value means a hand-edited cell, and MFA is the reading that
      // over-reports rather than under-reports.
      hygiene: String((_m = r["hygiene"]) != null ? _m : "MFA") === "DORMANT" ? "DORMANT" : "MFA"
    };
  }
  function cellPct(v) {
    if (v === "" || v === null || v === void 0) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  function postureToRow(p) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i;
    return {
      framework_id: p.frameworkId,
      level: p.level,
      category_external_id: (_a5 = p.categoryExternalId) != null ? _a5 : "",
      subcategory_external_id: (_b = p.subcategoryExternalId) != null ? _b : "",
      node_id: (_c = p.nodeId) != null ? _c : "",
      title: p.title,
      description: (_d = p.description) != null ? _d : "",
      // Null stays empty rather than becoming 0 — see cellPct.
      posture_pct: p.posturePct === null ? "" : p.posturePct,
      pass_count: p.passCount,
      fail_count: p.failCount,
      pass_subcategory_count: (_e = p.passSubCategoryCount) != null ? _e : "",
      fail_subcategory_count: (_f = p.failSubCategoryCount) != null ? _f : "",
      empty_posture_reason: (_g = p.emptyPostureReason) != null ? _g : "",
      assessment_scope: (_h = p.assessmentScope) != null ? _h : "",
      mapping_rationale: (_i = p.mappingRationale) != null ? _i : "",
      tags_json: p.tags && p.tags.length ? JSON.stringify(p.tags) : ""
    };
  }
  function rowToPosture(r) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    const num = (v) => {
      const n = Number(v != null ? v : 0);
      return isFinite(n) ? n : 0;
    };
    const optNum = (v) => v === "" || v === null || v === void 0 ? void 0 : num(v);
    return {
      frameworkId: String((_a5 = r["framework_id"]) != null ? _a5 : ""),
      level: String((_b = r["level"]) != null ? _b : "subcategory"),
      categoryExternalId: String((_c = r["category_external_id"]) != null ? _c : "") || void 0,
      subcategoryExternalId: String((_d = r["subcategory_external_id"]) != null ? _d : "") || void 0,
      nodeId: String((_e = r["node_id"]) != null ? _e : "") || void 0,
      title: String((_f = r["title"]) != null ? _f : ""),
      description: String((_g = r["description"]) != null ? _g : "") || void 0,
      posturePct: cellPct(r["posture_pct"]),
      passCount: num(r["pass_count"]),
      failCount: num(r["fail_count"]),
      passSubCategoryCount: optNum(r["pass_subcategory_count"]),
      failSubCategoryCount: optNum(r["fail_subcategory_count"]),
      emptyPostureReason: String((_h = r["empty_posture_reason"]) != null ? _h : "") || null,
      assessmentScope: String((_i = r["assessment_scope"]) != null ? _i : "") || void 0,
      mappingRationale: String((_j = r["mapping_rationale"]) != null ? _j : "") || void 0,
      tags: parseJson(r["tags_json"], [])
    };
  }
  function frameworkPolicyToRow(p) {
    var _a5, _b, _c, _d, _e, _f, _g;
    return {
      framework_id: p.frameworkId,
      category_external_id: p.categoryExternalId,
      subcategory_external_id: p.subcategoryExternalId,
      policy_id: p.policyId,
      policy_kind: p.policyKind,
      short_id: (_a5 = p.shortId) != null ? _a5 : "",
      name: p.name,
      severity: p.severity,
      enabled: (_b = p.enabled) != null ? _b : "",
      builtin: (_c = p.builtin) != null ? _c : "",
      pass_count: p.passCount,
      fail_count: p.failCount,
      assessed_count: p.assessedCount,
      rejected_count: p.rejectedCount,
      no_resource_to_assess: p.noResourceToAssess,
      target_native_type: (_d = p.targetNativeType) != null ? _d : "",
      subject_entity_type: (_e = p.subjectEntityType) != null ? _e : "",
      cloud_provider: (_f = p.cloudProvider) != null ? _f : "",
      has_auto_remediation: (_g = p.hasAutoRemediation) != null ? _g : ""
    };
  }
  function rowToFrameworkPolicy(r) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    const num = (v) => {
      const n = Number(v != null ? v : 0);
      return isFinite(n) ? n : 0;
    };
    const optBool = (v) => v === "" || v === null || v === void 0 ? void 0 : v === true || v === "TRUE" || v === "true";
    return {
      frameworkId: String((_a5 = r["framework_id"]) != null ? _a5 : ""),
      categoryExternalId: String((_b = r["category_external_id"]) != null ? _b : ""),
      subcategoryExternalId: String((_c = r["subcategory_external_id"]) != null ? _c : ""),
      policyId: String((_d = r["policy_id"]) != null ? _d : ""),
      policyKind: String((_e = r["policy_kind"]) != null ? _e : "CONTROL"),
      shortId: String((_f = r["short_id"]) != null ? _f : "") || void 0,
      name: String((_g = r["name"]) != null ? _g : ""),
      severity: String((_h = r["severity"]) != null ? _h : "UNKNOWN"),
      enabled: optBool(r["enabled"]),
      builtin: optBool(r["builtin"]),
      passCount: num(r["pass_count"]),
      failCount: num(r["fail_count"]),
      assessedCount: num(r["assessed_count"]),
      rejectedCount: num(r["rejected_count"]),
      noResourceToAssess: r["no_resource_to_assess"] === true || r["no_resource_to_assess"] === "TRUE" || r["no_resource_to_assess"] === "true",
      targetNativeType: String((_i = r["target_native_type"]) != null ? _i : "") || void 0,
      subjectEntityType: String((_j = r["subject_entity_type"]) != null ? _j : "") || void 0,
      cloudProvider: String((_k = r["cloud_provider"]) != null ? _k : "") || void 0,
      hasAutoRemediation: optBool(r["has_auto_remediation"])
    };
  }
  function persistSync(rawDoc, issues2, hints, meta, now, findings = [], dataFindings = [], frameworks = [], posture = [], frameworkPolicies = [], extras = {}) {
    var _a5, _b, _c, _d;
    const { version: ruleVersion, rule } = getAarsRule2();
    const counted = withDataFindingCounts(rawDoc, dataFindings);
    const exposed = withExposureEvidence(counted);
    const reachable2 = withHumanAccess(exposed, {
      identityFindings: (_a5 = extras.identityFindings) != null ? _a5 : [],
      effectiveAccess: (_b = extras.effectiveAccess) != null ? _b : []
    });
    const enriched = enrichGraphDoc(reachable2, issues2, hints, rule);
    const assetNodes = realNodes(enriched.nodes);
    const assetEdges = enriched.edges.filter((e) => e.type !== "HAS_ISSUE");
    overwrite(TABS.assets, assetNodes.map(assetToRow));
    overwrite(TABS.edges, assetEdges.map(edgeToRow));
    overwrite(TABS.issues, issues2.map(issueToRow));
    overwrite(TABS.findings, findings.map(findingToRow));
    overwrite(TABS.dataFindings, dataFindings.map(dataFindingToRow));
    if (frameworks.length) overwrite(TABS.frameworks, frameworks.map(frameworkToRow));
    if (posture.length) overwrite(TABS.frameworkPosture, posture.map(postureToRow));
    if (frameworkPolicies.length) {
      overwrite(TABS.frameworkPolicies, frameworkPolicies.map(frameworkPolicyToRow));
    }
    const configRules = (_c = extras.configRules) != null ? _c : [];
    if (configRules.length) overwrite(TABS.configRules, configRules.map(configRuleToRow));
    overwrite(TABS.identityFindings, ((_d = extras.identityFindings) != null ? _d : []).map(identityFindingToRow));
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
      error: null,
      // The AARS distribution at this sync — the only record of it, since the snapshot
      // this row points at is overwritten by the next sync. Feeds the inventory trend.
      aars_severity_json: JSON.stringify(countAarsSeverities(enriched.nodes)),
      // Which scoring model produced that distribution: counts from two versions are not
      // on the same scale, and the trend chart says so rather than drawing a false step.
      aars_rule_version: ruleVersion
    }]);
    setScoredRuleVersion(ruleVersion);
    commit();
    return enriched;
  }
  function rescoreInventory() {
    const { version, rule } = getAarsRule2();
    const enriched = enrichFromTabs(rule);
    if (!enriched) {
      setScoredRuleVersion(version);
      return { version, assetCount: 0, counts: countAarsSeverities([]) };
    }
    const assetNodes = realNodes(enriched.nodes);
    overwrite(TABS.assets, assetNodes.map(assetToRow));
    writeGraphSnapshot(enriched);
    setScoredRuleVersion(version);
    commit();
    return {
      version,
      assetCount: assetNodes.length,
      counts: countAarsSeverities(enriched.nodes)
    };
  }
  function scoreAssetsWith(rule) {
    const enriched = enrichFromTabs(rule);
    if (!enriched) return [];
    return realNodes(enriched.nodes);
  }
  function enrichFromTabs(rule) {
    const base = loadRawGraph();
    if (!base) return null;
    const issues2 = loadIssues();
    const hints = { ...buildAarsHintsFromFindings(loadFindings(), base, issues2, rule) };
    for (const node2 of base.nodes) {
      if (node2.aarsInput) hints[node2.id] = node2.aarsInput;
    }
    return enrichGraphDoc(base, issues2, hints, rule);
  }
  function loadRawGraph() {
    var _a5;
    const nodes = loadAssetsRaw();
    if (!nodes.length) return null;
    const edges2 = readAll(TABS.edges).map(rowToEdge);
    const latest = latestSync();
    return {
      nodes: nodes.map(stripAarsScore),
      edges: edges2,
      syncedAt: latest ? String((_a5 = latest["finished_at"]) != null ? _a5 : "") : ""
    };
  }
  function stripAarsScore(n) {
    if (n.aars === void 0 && n.aarsSeverity === void 0 && n.aarsPillars === void 0) return n;
    const next = { ...n };
    delete next.aars;
    delete next.aarsSeverity;
    delete next.aarsPillars;
    return next;
  }
  var graphDocMemo;
  var assetsMemo;
  var issuesMemo;
  var findingsMemo;
  var dataFindingsMemo;
  var frameworksMemo;
  var postureMemo;
  var frameworkPoliciesMemo;
  var configRulesMemo;
  var identityFindingsMemo;
  function invalidateReadMemos() {
    graphDocMemo = void 0;
    assetsMemo = void 0;
    issuesMemo = void 0;
    findingsMemo = void 0;
    dataFindingsMemo = void 0;
    frameworksMemo = void 0;
    postureMemo = void 0;
    frameworkPoliciesMemo = void 0;
    configRulesMemo = void 0;
    identityFindingsMemo = void 0;
  }
  function commit() {
    bumpDataVersion();
    bumpWizDataVersion();
    invalidateReadMemos();
  }
  function realNodes(nodes) {
    return nodes.filter((n) => n.kind !== "ISSUE" && n.kind !== "SUMMARY");
  }
  function loadGraphDoc() {
    if (graphDocMemo !== void 0) return graphDocMemo;
    graphDocMemo = loadGraphDocUncached();
    return graphDocMemo;
  }
  function normalizeLegacyAars(doc) {
    let touched = false;
    const nodes = doc.nodes.map((n) => {
      var _a5;
      const loose = n;
      if (loose.aarsBand === void 0 && n.aarsSeverity === void 0) return n;
      touched = true;
      const next = { ...loose };
      delete next.aarsBand;
      const sev = normalizeAarsSeverity((_a5 = n.aarsSeverity) != null ? _a5 : loose.aarsBand);
      if (sev) next.aarsSeverity = sev;
      else delete next.aarsSeverity;
      return next;
    });
    return touched ? { ...doc, nodes } : doc;
  }
  function withRiskNodes(doc) {
    return withMissingGuardrailNodes(
      withIdentityAccessNodes(
        withExcessivePrivilegeNodes(
          withInternetExposureNodes(withSensitiveDataNodes(withDataFindingNodes(doc)))
        )
      )
    );
  }
  function withCurrentBands(nodes, bands) {
    let touched = false;
    const out = nodes.map((n) => {
      if (typeof n.aars !== "number") return n;
      const sev = aarsSeverity(n.aars, bands);
      if (sev === n.aarsSeverity) return n;
      touched = true;
      return { ...n, aarsSeverity: sev };
    });
    return touched ? out : nodes;
  }
  function currentBands() {
    return getAarsRule2().rule.bands;
  }
  function withBandsApplied(doc) {
    const nodes = withCurrentBands(doc.nodes, currentBands());
    return nodes === doc.nodes ? doc : { ...doc, nodes };
  }
  function loadGraphDocUncached() {
    var _a5;
    const snap = readGraphSnapshot();
    if (snap) return withRiskNodes(withBandsApplied(normalizeLegacyAars(snap)));
    const assetRows = readAll(TABS.assets);
    if (!assetRows.length) return null;
    const nodes = withCurrentBands(assetRows.map(rowToAsset), currentBands());
    const edges2 = readAll(TABS.edges).map(rowToEdge);
    const issues2 = loadIssues().filter(isUnresolvedIssue);
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
    return withRiskNodes({
      nodes,
      edges: edges2,
      syncedAt: latest ? String((_a5 = latest["finished_at"]) != null ? _a5 : "") : ""
    });
  }
  function loadAssetsRaw() {
    if (assetsMemo === void 0) assetsMemo = readAll(TABS.assets).map(rowToAsset);
    return assetsMemo;
  }
  function loadAssets() {
    return withCurrentBands(loadAssetsRaw(), currentBands());
  }
  function loadIssues() {
    if (issuesMemo === void 0) issuesMemo = readAll(TABS.issues).map(rowToIssue);
    return issuesMemo;
  }
  function loadFindings() {
    if (findingsMemo === void 0) findingsMemo = readAll(TABS.findings).map(rowToFinding);
    return findingsMemo;
  }
  function loadFrameworks() {
    if (frameworksMemo === void 0) frameworksMemo = readAll(TABS.frameworks).map(rowToFramework);
    return frameworksMemo;
  }
  function loadConfigRules() {
    if (configRulesMemo === void 0) {
      configRulesMemo = readAll(TABS.configRules).map(rowToConfigRule);
    }
    return configRulesMemo;
  }
  function loadIdentityFindings() {
    if (identityFindingsMemo === void 0) {
      identityFindingsMemo = readAll(TABS.identityFindings).map(rowToIdentityFinding);
    }
    return identityFindingsMemo;
  }
  function loadPosture() {
    if (postureMemo === void 0) postureMemo = readAll(TABS.frameworkPosture).map(rowToPosture);
    return postureMemo;
  }
  function loadFrameworkPolicies() {
    if (frameworkPoliciesMemo === void 0) {
      frameworkPoliciesMemo = readAll(TABS.frameworkPolicies).map(rowToFrameworkPolicy);
    }
    return frameworkPoliciesMemo;
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
    overwrite(TABS.dataFindings, []);
    overwrite(TABS.syncHistory, []);
    trashGraphSnapshot();
    commit();
  }

  // src/server/syncJobs.ts
  var CANCEL_PROP = "CANCEL_SYNC_JOB_ID";
  var CONTINUE_HANDLER = "trigger_continueSync";
  var CONTINUE_DELAY_MS = 3e4;
  var FIRST_STEP_BUDGET_MS = 45e3;
  var BUDGET_MS = 27e4;
  var CHECKPOINT_MS = 8e3;
  function syncSteps(aiTypes) {
    const types = aiTypes != null ? aiTypes : resolveAiResourceTypes().types;
    const frameworkIds = getSelectedFrameworks2(() => loadFrameworks());
    const overrides = getScanVars2();
    const vars = (stepId, base) => effectiveStepVars(stepId, base, overrides[stepId]);
    const selectedFrameworks = () => frameworkIds;
    const catalogue = loadConfigRules();
    const catalogueFresh = configRulesAreFresh2(catalogue.length > 0, Date.now());
    const hygieneRules = resolveHygieneRules(catalogue);
    return [
      {
        id: "INVENTORY_AI",
        area: "aispm",
        writes: ["ai_assets"],
        run: "cloudResources",
        query: Q_AI_INVENTORY,
        extraVariables: vars("INVENTORY_AI", aiInventoryVariables(types)),
        normalize: normalizeInventoryPage,
        pageSize: PAGE_SIZE_WIDE
      },
      // One cursor walk per toxic-combination source rule: the assets carrying an OPEN
      // issue for that rule (issue rows are reconstructed one-per-asset).
      ...COMBO_GROUPS.map((group) => ({
        id: `ISSUES_${group.ruleId}`,
        area: "toxic",
        writes: ["ai_assets", "ai_issues"],
        run: "cloudResources",
        query: Q_RULE_ASSETS,
        extraVariables: { ruleIds: [group.ruleId] },
        normalize: (rows) => normalizeRuleAssetsPage(rows, group),
        optional: true,
        pageSize: PAGE_SIZE_WIDE
      })),
      // Real toxic-combination issues (issuesV2). Runs alongside the per-rule steps
      // above; reconcileIssues drops the synthetic per-rule rows these supersede.
      {
        id: "ISSUES_TOXIC",
        area: "toxic",
        writes: ["ai_issues", "ai_assets"],
        run: "connection",
        connectionField: "issuesV2",
        query: Q_ISSUES,
        extraVariables: vars("ISSUES_TOXIC", aiIssuesVariables(projectScope())),
        normalize: normalizeIssuesPage,
        optional: true
      },
      // Real compliance findings (configurationFindings) — feeds AARS pillar B.
      {
        id: "CONFIG_FINDINGS",
        area: "configFindings",
        writes: ["ai_findings"],
        run: "connection",
        connectionField: "configurationFindings",
        query: Q_CONFIG_FINDINGS,
        extraVariables: vars("CONFIG_FINDINGS", aiConfigFindingsVariables(projectScope())),
        normalize: normalizeConfigFindingsPage,
        optional: true
      },
      // Wiz's cloud-configuration RULE CATALOGUE — reference data, and the only step here whose
      // contents describe the product rather than the estate. It is what glosses an opaque
      // `SUB-082` in the AARS cascade, and what the identity-hygiene matchers resolve against
      // instead of hardcoding MFA rule ids that differ per cloud.
      //
      // GATED, not unconditional. ~3,858 rules is ~39 pages against a battery that is otherwise
      // ~10–20 calls, to re-collect a list that changes when Wiz ships rules. `catalogueFresh`
      // is resolved once, above, and a skip here is recorded as SCHEDULED rather than joining
      // `skippedSteps` — that list means "the tenant refused this", and a step we chose not to
      // run must not be reported as a rejection.
      ...catalogueFresh ? [] : [{
        id: "CONFIG_RULES",
        area: "configFindings",
        writes: ["ai_config_rules"],
        run: "connection",
        connectionField: "cloudConfigurationRules",
        query: Q_CONFIG_RULES,
        normalize: normalizeConfigRulesPage,
        optional: true,
        // The big one: ~3,858 rules is 39 pages at PAGE_SIZE and 8 at PAGE_SIZE_WIDE, and
        // the document is five flat scalars per node.
        pageSize: PAGE_SIZE_WIDE
      }],
      // MFA and dormancy on the humans who can reach an AI asset. The rules come from the
      // catalogue, matched by name (domain/identityHygiene.ts), so this step exists only once
      // the catalogue has been collected at least once — on a first sync it resolves to nothing
      // and is skipped, and the following sync has it.
      ...hygieneRules.ids.length ? [{
        id: "IDENTITY_HYGIENE",
        area: "identity",
        writes: ["ai_identity_findings"],
        run: "connection",
        connectionField: "configurationFindings",
        query: Q_CONFIG_FINDINGS,
        extraVariables: aiIdentityHygieneVariables(hygieneRules.ids, projectScope()),
        // Closed over the resolved map, the way the per-rule combo steps close over their group.
        // It is also what lets the normalizer verify the filter was honoured at all.
        normalize: (rows) => normalizeIdentityFindingsPage(rows, hygieneRules.byId),
        optional: true
      }] : [],
      // Effective permissions on those same assets: not who holds a role, but what they can do
      // and which policy says so. Runs BESIDE IDENTITY_ACCESS rather than replacing it — that
      // step draws the graph's ALLOWS_ACCESS_TO edges and speaks ADMIN/HIGH_PRIVILEGE, this one
      // speaks DATA, and withHumanAccess keeps the two in separate fields.
      {
        id: "EFFECTIVE_ACCESS",
        area: "identity",
        writes: ["ai_assets (human_access_json)"],
        run: "connection",
        connectionField: "entityEffectiveAccessEntries",
        query: Q_EFFECTIVE_ACCESS,
        extraVariables: effectiveAccessVariables(types, projectScope()),
        normalize: normalizeEffectiveAccessPage,
        optional: true,
        pageSize: PAGE_SIZE_WIDE
      },
      // The framework catalogue. Populates the Settings picker; it does NOT decide the
      // battery — see the posture steps below for why.
      //
      // `area` is the posture one, not the configuration-findings one. The tag is what the
      // Wiz Scans drill-down filters on (scanSheet.js), so it decides which area DISPLAYS
      // this document — it is a join key, not a label. Both this step and the posture steps
      // below spent a release tagged "compliance", which left the posture area rendering
      // "No sync step issues a query for this area" beside its own live figure. Pinned by
      // test/scanAreaSteps.test.ts.
      {
        id: "FRAMEWORKS_LIST",
        area: "posture",
        writes: ["ai_frameworks"],
        run: "connection",
        connectionField: "securityFrameworks",
        query: Q_SECURITY_FRAMEWORKS,
        extraVariables: vars("FRAMEWORKS_LIST", aiSecurityFrameworksVariables()),
        normalize: normalizeFrameworksPage,
        optional: true,
        pageSize: PAGE_SIZE_WIDE
      },
      // Per-framework compliance posture — ONE STEP PER FRAMEWORK, because the query takes a
      // framework id and returns one object. Generated the same way the per-rule combo steps
      // above are, so the budget/resume machinery needs no special case.
      //
      // Driven by the SELECTION, not by the catalogue: posture costs a round trip per
      // framework and a tenant can carry a hundred builtin ones this app has no vocabulary
      // for. Each step is optional, so a framework id that is wrong on this tenant costs a
      // recorded skip rather than a failed sync.
      ...selectedFrameworks().map((frameworkId) => ({
        id: `COMPLIANCE_POSTURE_${frameworkId}`,
        area: "posture",
        writes: ["ai_framework_posture", "ai_framework_policies"],
        run: "single",
        connectionField: "securityFramework",
        query: Q_COMPLIANCE_POSTURE,
        // No `vars()` indirection here on purpose: these steps are LOCKED. Overrides are
        // stored per step id, and every posture step has its own (`COMPLIANCE_POSTURE_<id>`),
        // so reading them under a shared "COMPLIANCE_POSTURE" key would be an override slot
        // nothing can ever write to — dead indirection that reads like a feature.
        //
        // They are locked because the framework id is not a filter. The existing rule is that
        // a variable may narrow a selection set but never change it; an id that selects WHICH
        // OBJECT the selection set is applied to is further outside that line, not inside it.
        // Choosing frameworks is Settings' job.
        extraVariables: {
          ...aiCompliancePostureVariables(projectScope()),
          id: frameworkId
        },
        normalize: normalizeCompliancePosturePage,
        optional: true
      })),
      {
        id: "GUARDRAIL_GAPS",
        area: "guardrails",
        writes: ["ai_assets.guardrail_missing"],
        run: "graphSearch",
        query: Q_AGENTS_NO_GUARDRAIL,
        normalize: normalizeNoGuardrailPage,
        optional: true,
        pageSize: PAGE_SIZE_TRAVERSAL
      },
      {
        id: "RUNS_AS",
        area: "ciem",
        writes: ["ai_edges (RUNS_AS)", "ai_assets"],
        run: "graphSearch",
        query: Q_AGENT_RUNS_AS,
        normalize: normalizeRunsAsPage,
        optional: true,
        pageSize: PAGE_SIZE_TRAVERSAL
      },
      {
        id: "SA_FINDINGS",
        area: "ciem",
        writes: ["ai_edges (HAS_FINDING)", "ai_assets"],
        run: "graphSearch",
        query: Q_SA_EXCESSIVE_ACCESS,
        normalize: normalizeRunsAsPage,
        optional: true,
        pageSize: PAGE_SIZE_TRAVERSAL
      },
      // The data-exposure chain. Runs AFTER the two CIEM steps on purpose: it re-emits the
      // agent and its service account, and mergeParts lets later truthy values win field-wise,
      // so landing the richer CIEM projections first means this step can only add to them.
      {
        id: "SENSITIVE_DATA_ACCESS",
        area: "dspm",
        writes: [
          "ai_edges (RUNS_AS, ALLOWS_ACCESS_TO)",
          "ai_assets (BUCKET/DATABASE rows, data_finding_count)",
          "ai_data_findings"
        ],
        run: "graphSearch",
        query: Q_AGENT_SENSITIVE_DATA_ACCESS,
        normalize: normalizeSensitiveDataAccessPage,
        optional: true,
        pageSize: PAGE_SIZE_TRAVERSAL
      },
      // Network exposure, in two steps because they are two claims. HOST_EXPOSURE says the
      // compute under an AI asset is reachable; ENDPOINT_EXPOSURE says Wiz's scanner reached a
      // live endpoint it serves and policy rates that a real exposure. The capture proves they
      // can disagree — a Cloud Run revision that is openToAllInternet, serving endpoints rated
      // Low because they redirect to SSO. See domain/exposureQuery.ts.
      //
      // Both run AFTER the CIEM and DSPM steps for the reason SENSITIVE_DATA_ACCESS gives:
      // they re-emit the AI asset as a thin projection, and mergeParts lets later truthy
      // values win field-wise, so landing the richer projections first means these can only
      // add to them.
      {
        id: "HOST_EXPOSURE",
        area: "exposure",
        writes: [
          "ai_edges (HOSTED_ON, SERVES)",
          "ai_assets (VM/SERVERLESS + ENDPOINT rows, exposure_evidence_json)"
        ],
        run: "graphSearch",
        query: Q_AI_EXPOSURE,
        extraVariables: hostExposureVariables(types, projectScope()),
        normalize: normalizeHostExposurePage,
        optional: true
      },
      {
        id: "ENDPOINT_EXPOSURE",
        area: "exposure",
        writes: ["ai_edges (SERVES)", "ai_assets (ENDPOINT rows, exposure_level, port_validation)"],
        run: "graphSearch",
        query: Q_AI_EXPOSURE,
        extraVariables: endpointExposureVariables(types, projectScope()),
        normalize: normalizeEndpointExposurePage,
        optional: true
      },
      {
        id: "IDENTITY_ACCESS",
        area: "identity",
        writes: [
          "ai_edges (ALLOWS_ACCESS_TO)",
          "ai_assets (USER_ACCOUNT/ACCESS_ROLE rows, inactive, human_access_json)"
        ],
        run: "graphSearch",
        query: Q_IDENTITY_ACCESS,
        extraVariables: identityAccessVariables(types, projectScope()),
        normalize: normalizeIdentityAccessPage,
        optional: true,
        pageSize: PAGE_SIZE_TRAVERSAL
      },
      // AI-asset provenance: publisher + how Wiz discovered it. Optional and separate from
      // INVENTORY_AI on purpose — see the note on Q_AI_PROPERTIES. Losing it costs two columns.
      {
        id: "AI_ASSET_PROPERTIES",
        area: "aispm",
        writes: ["ai_assets.publisher", "ai_assets.discovery_methods"],
        run: "cloudResources",
        query: Q_AI_PROPERTIES,
        extraVariables: vars("AI_ASSET_PROPERTIES", aiPropertiesVariables(types)),
        // The same normalizer the inventory step uses. Safe because mergeParts merges
        // field-wise and skips undefined — this step's narrower rows fill in the two provenance
        // fields without erasing the projects, tags or analytics INVENTORY_AI established.
        normalize: normalizeInventoryPage,
        optional: true,
        pageSize: PAGE_SIZE_WIDE
      },
      // Agentic execution identities (cloudResourcesV2 + identityPurpose:AGENTIC).
      {
        id: "AGENTIC_IDENTITIES",
        area: "ciem",
        writes: ["ai_assets.identity_purpose"],
        run: "cloudResources",
        query: Q_PRINCIPALS,
        extraVariables: vars("AGENTIC_IDENTITIES", aiPrincipalsVariables(projectScope())),
        normalize: normalizePrincipalsPage,
        optional: true,
        pageSize: PAGE_SIZE_WIDE
      }
    ];
  }
  var TYPE_DEPENDENT_STEPS = /* @__PURE__ */ new Set([
    "INVENTORY_AI",
    "AI_ASSET_PROPERTIES",
    "HOST_EXPOSURE",
    "ENDPOINT_EXPOSURE",
    "IDENTITY_ACCESS",
    "EFFECTIVE_ACCESS"
  ]);
  function rootFieldOf(step) {
    var _a5;
    if (step.run === "cloudResources") return "cloudResourcesV2";
    if (step.run === "graphSearch") return "graphSearch";
    return (_a5 = step.connectionField) != null ? _a5 : "";
  }
  function fetcherFor(step) {
    if (step.run === "graphSearch") return fetchGraphSearchPage;
    if (step.run === "cloudResources") return fetchCloudResourcesPage;
    if (step.run === "single") return (o) => {
      var _a5;
      return fetchSingleObject((_a5 = step.connectionField) != null ? _a5 : "", o);
    };
    return (o) => {
      var _a5;
      return fetchConnectionPage((_a5 = step.connectionField) != null ? _a5 : "", o);
    };
  }
  function describeSyncSteps() {
    const overrides = getScanVars2();
    const resolved = describeAiTypes();
    return syncSteps(resolved.types).map((step) => {
      var _a5, _b, _c;
      const base = defaultStepVariables(step.id, (_a5 = step.extraVariables) != null ? _a5 : {}, resolved.types);
      return {
        id: step.id,
        area: step.area,
        writes: step.writes,
        rootField: rootFieldOf(step),
        run: step.run,
        optional: !!step.optional,
        document: step.query,
        // What this step will actually send, overrides included. `first`, `after` and (for
        // graphSearch) `quick` are added by the transport on every request and are named in
        // the panel rather than folded in here, so what is shown is what is configured.
        variables: (_b = step.extraVariables) != null ? _b : {},
        // The `first` the transport will send for THIS step. Named because it is no longer one
        // number for the whole battery: the panel would otherwise list `first` as a transport
        // variable whose value the operator cannot see and cannot predict.
        pageSize: (_c = step.pageSize) != null ? _c : PAGE_SIZE,
        defaultVariables: base,
        editable: isEditableStep(step.id),
        overridden: changedPaths(step.id, base, overrides[step.id]),
        // Three steps build their filter from the tenant-resolved AI type list, so only those
        // three can be described provisionally. Said out loud rather than shown as settled
        // fact — this page's whole job is not doing that.
        typesResolved: TYPE_DEPENDENT_STEPS.has(step.id) ? resolved.resolved : true
      };
    });
  }
  function describeAiTypes() {
    try {
      return { types: resolveAiResourceTypes().types, resolved: true };
    } catch (e) {
      return { types: AI_RESOURCE_TYPE_CANDIDATES, resolved: false };
    }
  }
  function defaultStepVariables(stepId, withOverride, aiTypes) {
    switch (stepId) {
      case "INVENTORY_AI":
        return aiInventoryVariables(aiTypes != null ? aiTypes : resolveAiResourceTypes().types);
      case "ISSUES_TOXIC":
        return aiIssuesVariables(projectScope());
      case "CONFIG_FINDINGS":
        return aiConfigFindingsVariables(projectScope());
      case "AI_ASSET_PROPERTIES":
        return aiPropertiesVariables(aiTypes != null ? aiTypes : resolveAiResourceTypes().types);
      case "AGENTIC_IDENTITIES":
        return aiPrincipalsVariables(projectScope());
      case "HOST_EXPOSURE":
        return hostExposureVariables(aiTypes != null ? aiTypes : resolveAiResourceTypes().types, projectScope());
      case "ENDPOINT_EXPOSURE":
        return endpointExposureVariables(aiTypes != null ? aiTypes : resolveAiResourceTypes().types, projectScope());
      case "IDENTITY_ACCESS":
        return identityAccessVariables(aiTypes != null ? aiTypes : resolveAiResourceTypes().types, projectScope());
      case "EFFECTIVE_ACCESS":
        return effectiveAccessVariables(aiTypes != null ? aiTypes : resolveAiResourceTypes().types, projectScope());
      case "IDENTITY_HYGIENE":
        return aiIdentityHygieneVariables(
          resolveHygieneRules(loadConfigRules()).ids,
          projectScope()
        );
      case "FRAMEWORKS_LIST":
        return aiSecurityFrameworksVariables();
      default:
        if (stepId.indexOf("COMPLIANCE_POSTURE_") === 0) {
          return {
            ...aiCompliancePostureVariables(projectScope()),
            id: stepId.slice("COMPLIANCE_POSTURE_".length)
          };
        }
        return withOverride;
    }
  }
  function testStepVariables(stepId, vars) {
    var _a5;
    const step = syncSteps().filter((s) => s.id === stepId)[0];
    if (!step) throw new Error(`No sync step called ${stepId}.`);
    const proposed = effectiveStepVars(
      stepId,
      defaultStepVariables(stepId, (_a5 = step.extraVariables) != null ? _a5 : {}),
      vars
    );
    const opts = { query: step.query, cursor: null, extraVariables: proposed };
    let result;
    try {
      result = fetcherFor(step)(opts);
    } catch (e) {
      return {
        ok: false,
        stepId,
        variables: proposed,
        error: String(e instanceof Error ? e.message : e)
      };
    }
    const part = step.normalize(result.rows);
    return {
      ok: true,
      stepId,
      variables: proposed,
      rows: result.rows.length,
      totalCount: result.totalCount,
      hasNextPage: result.hasNextPage,
      normalized: {
        nodes: part.nodes.length,
        edges: part.edges.length,
        issues: part.issues.length,
        findings: part.findings.length
      },
      // One row, so the operator can see the shape came back as expected. Stringified and
      // capped: a raw Wiz row can be large, and this rides a google.script.run response.
      sample: result.rows.length ? JSON.stringify(result.rows[0]).slice(0, 1200) : ""
    };
  }
  function startSync() {
    const existing = activeJob();
    if (existing) {
      return { jobId: existing.job_id, message: "A sync is already running." };
    }
    if (!hasWizCredentials()) return dryRunSync();
    return startLiveSync();
  }
  function seedTrendHistory(endIso) {
    if (dataRowCount(TABS.syncHistory) > 0) return;
    const DAY_MS2 = 864e5;
    const end = new Date(endIso).getTime();
    appendRows(TABS.syncHistory, SEED_TREND.map((counts, i) => {
      const at = new Date(end - (SEED_TREND.length - i) * DAY_MS2).toISOString();
      return {
        sync_id: `sync-sample-${String(i + 1).padStart(2, "0")}`,
        started_at: at,
        finished_at: at,
        status: "SUCCESS",
        mode: "dry-run",
        node_count: null,
        edge_count: null,
        issue_count: null,
        api_calls: 0,
        snapshot_ref: null,
        error: null,
        aars_severity_json: JSON.stringify(counts)
      };
    }));
  }
  function dryRunSync() {
    const startedAt = nowIso();
    seedTrendHistory(startedAt);
    const syncId = `sync-${startedAt.replace(/[:]/g, "")}`;
    const doc = persistSync(
      seedGraphDoc(startedAt),
      SEED_ISSUES,
      SEED_AARS_HINTS,
      { syncId, mode: "dry-run", startedAt, apiCalls: 0 },
      void 0,
      SEED_FINDINGS,
      SEED_DATA_FINDINGS,
      SEED_FRAMEWORKS,
      SEED_POSTURE,
      SEED_FRAMEWORK_POLICIES,
      {
        configRules: SEED_CONFIG_RULES,
        identityFindings: SEED_IDENTITY_FINDINGS,
        effectiveAccess: SEED_EFFECTIVE_ACCESS
      }
    );
    setSkippedSteps([]);
    setTruncatedSteps([]);
    return {
      jobId: null,
      message: `Dry-run sync complete: ${doc.nodes.length} nodes, ${doc.edges.length} edges, ${SEED_ISSUES.length} issues (sample data).`
    };
  }
  function strList(v) {
    return Array.isArray(v) ? v.map(String) : [];
  }
  function jobParams(job) {
    var _a5;
    const parsed = parseJson(job.params_json, {});
    return {
      apiCalls: Number((_a5 = parsed["apiCalls"]) != null ? _a5 : 0),
      skippedSteps: strList(parsed["skippedSteps"]),
      truncatedSteps: strList(parsed["truncatedSteps"])
    };
  }
  function partRefs(job) {
    return strList(parseJson(job.part_refs_json, []));
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
    var _a5, _b;
    const deadline = Date.now() + opts.budgetMs;
    const syncId = (_a5 = job.sync_id) != null ? _a5 : job.job_id;
    const refs = partRefs(job);
    const params = jobParams(job);
    let stepIndex = job.step_index;
    let cursor = job.cursor;
    let page = job.page;
    let nodesSoFar = job.nodes_so_far;
    let hopPart = emptyPart();
    let lastCheckpoint = Date.now();
    const spillHopPart = () => {
      if (partIsEmpty(hopPart)) return;
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
          const fetcher = fetcherFor(step);
          let result;
          try {
            result = fetcher({
              query: step.query,
              cursor,
              extraVariables: step.extraVariables,
              first: step.pageSize
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
          try {
            appendPart(hopPart, step.normalize(result.rows));
          } catch (e) {
            if (step.optional && e instanceof FilterNotHonouredError) {
              params.skippedSteps.push(step.id);
              console.warn(`Sync step ${step.id} skipped \u2014 ${e.message}`);
              break;
            }
            throw e;
          }
          if (page === 1 || Date.now() - lastCheckpoint >= CHECKPOINT_MS) {
            updateJob(job.job_id, {
              step_index: stepIndex,
              cursor: result.endCursor,
              page,
              nodes_so_far: nodesSoFar,
              total_count: (_b = result.totalCount) != null ? _b : 0,
              params_json: JSON.stringify(params)
            });
            lastCheckpoint = Date.now();
          }
          if (!result.hasNextPage) break;
          if (page >= MAX_PAGES) {
            params.truncatedSteps.push(step.id);
            console.warn(
              `Sync step ${step.id} stopped at the ${MAX_PAGES}-page cap with more rows available.`
            );
            break;
          }
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
          // Carried here because the page loop no longer writes it on every page: without it a
          // throttled tail would leave the row reporting the count from the last checkpoint.
          nodes_so_far: nodesSoFar,
          part_refs_json: JSON.stringify(refs),
          params_json: JSON.stringify(params)
        });
        lastCheckpoint = Date.now();
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
      const aarsRule = getAarsRule2().rule;
      const findings = aarsRule.gapSources.frameworkMapping === true ? withFrameworkCodes(
        merged.findings,
        frameworkCodeLookup(merged.frameworkPolicies, merged.posture, merged.frameworks)
      ) : merged.findings;
      if (!doc.nodes.length) {
        updateJob(job.job_id, {
          phase: "FAILED",
          error: "Sync fetched no assets \u2014 check the service account's scope and permissions."
        });
        return;
      }
      updateJob(job.job_id, { phase: "PERSISTING" });
      const hints = buildAarsHintsFromFindings(findings, doc, issues2, aarsRule);
      const persist = () => {
        persistSync(
          doc,
          issues2,
          hints,
          {
            syncId,
            mode: "live",
            startedAt,
            apiCalls: params.apiCalls
          },
          void 0,
          findings,
          merged.dataFindings,
          merged.frameworks,
          merged.posture,
          merged.frameworkPolicies,
          {
            configRules: merged.configRules,
            identityFindings: merged.identityFindings,
            effectiveAccess: merged.effectiveAccess
          }
        );
        setSkippedSteps(params.skippedSteps);
        setTruncatedSteps(params.truncatedSteps);
        if (merged.configRules.length) setConfigRulesSyncedAt(Date.now());
      };
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
    return loadIssues().filter(isUnresolvedIssue);
  }
  function bootstrap(_p) {
    return run(() => {
      var _a5;
      return {
        ...cached("bootstrapCore", null, bootstrapCore),
        dataVersion: dataVersion(),
        hasCredentials: hasWizCredentials(),
        // Outside the cached core on purpose: a cached build stamp would be the one thing
        // guaranteed to lie after a deploy.
        build: buildInfo(),
        activeJob: (_a5 = activeJob()) != null ? _a5 : null
      };
    });
  }
  function bootstrapCore() {
    var _a5, _b;
    const assets = loadAssets();
    const issues2 = openIssues();
    const latest = latestSync();
    const aarsRule = getAarsRule2();
    const scoredVersion = getScoredRuleVersion2();
    const bySeverity = {};
    for (const issue2 of issues2) {
      bySeverity[issue2.adjustedSeverity] = ((_a5 = bySeverity[issue2.adjustedSeverity]) != null ? _a5 : 0) + 1;
    }
    const byAarsSeverity = {};
    for (const a of assets) {
      if (a.aarsSeverity) byAarsSeverity[a.aarsSeverity] = ((_b = byAarsSeverity[a.aarsSeverity]) != null ? _b : 0) + 1;
    }
    return {
      palette: {
        order: SEVERITY_ORDER,
        colors: SEVERITY_COLORS,
        glyphs: SEVERITY_GLYPHS,
        aarsSeverities: AARS_SEVERITY_ORDER
      },
      // REGISTER_GROUPS: the graph can group by the Other bucket, so the legend has to be
      // able to name it — a group the canvas can draw but the legend can't label reads as
      // a rendering bug.
      comboLegend: REGISTER_GROUPS.map((g) => ({
        id: g.id,
        title: g.title,
        shortLabel: g.shortLabel,
        nativeSeverity: g.nativeSeverity,
        adjustedSeverity: g.adjustedSeverity,
        amplified: g.amplified,
        // The issue detail sheet needs this to render its seeded paint without a server
        // round trip; it's a compile-time constant on an already-cached payload, so
        // riding it on bootstrap costs no extra I/O.
        amplifierNote: g.amplifierNote
      })),
      settings: {
        defaultDepth: getDefaultDepth2(),
        maxNodes: getMaxNodes2(),
        // The clamp bounds, so the graph's "Load more" and the Settings input can offer
        // exactly what the server will honor instead of hardcoding it twice.
        maxNodesFloor: MAX_NODES_FLOOR,
        maxNodesCeiling: MAX_NODES_CEILING,
        // Read by the asset sheet to decide whether to expand on open. It rides bootstrap
        // rather than its own call because the sheet needs it synchronously, before any RPC.
        autoExpand: getAutoExpand2()
      },
      // The band ranges every page's AARS copy is written from, so "score 70–100" is read
      // off the rule in force instead of being retyped wherever a level is named.
      aarsRule: {
        version: aarsRule.version,
        bands: aarsRule.rule.bands,
        bandRanges: bandRanges(aarsRule.rule.bands),
        // The three pillar ceilings, so the detail sheet's breakdown bars measure against
        // the rule in force instead of hardcoding the defaults and lying after an edit.
        // Pillar C's ceiling is now the rule's own explicit cap — it used to be re-derived
        // here from the exposure tier alone, which under a rule that prices data findings
        // would draw every bar against a ceiling the pillar can exceed.
        pillarCaps: {
          toxic: aarsRule.rule.pillarACap,
          compliance: aarsRule.rule.pillarBCap,
          data: aarsRule.rule.pillarCCap
        },
        scoredVersion,
        stale: scoredVersion !== aarsRule.version
      },
      latestSync: latest,
      counts: {
        aiAssets: assets.filter((a) => AI_ASSET_KINDS.includes(a.kind)).length,
        totalAssets: assets.length,
        openIssues: issues2.length,
        bySeverity,
        byAarsSeverity
      },
      filterOptions: filterOptions(assets)
    };
  }
  function distinctHumanIdentities(assets) {
    var _a5, _b, _c, _d;
    const ids = /* @__PURE__ */ new Set();
    for (const a of assets) {
      for (const id of (_b = (_a5 = a.humanAccess) == null ? void 0 : _a5.identityIds) != null ? _b : []) ids.add(id);
      for (const id of (_d = (_c = a.humanAccess) == null ? void 0 : _c.effectiveIds) != null ? _d : []) ids.add(id);
    }
    return ids;
  }
  function identityHygieneKpis(assets) {
    var _a5;
    const reachable2 = distinctHumanIdentities(assets);
    if (!reachable2.size) return { humanNoMfa: 0, humanDormant: 0 };
    const noMfa = /* @__PURE__ */ new Set();
    const dormant = /* @__PURE__ */ new Set();
    for (const id of reachable2) {
      if (((_a5 = byIdIn(assets, id)) == null ? void 0 : _a5.inactive) === true) dormant.add(id);
    }
    for (const finding of loadIdentityFindings()) {
      if (!isOpenGap(finding)) continue;
      if (!reachable2.has(finding.resourceId)) continue;
      (finding.hygiene === "MFA" ? noMfa : dormant).add(finding.resourceId);
    }
    return { humanNoMfa: noMfa.size, humanDormant: dormant.size };
  }
  function byIdIn(assets, id) {
    for (const a of assets) if (a.id === id) return a;
    return void 0;
  }
  function filterOptions(assets) {
    var _a5;
    const kinds = /* @__PURE__ */ new Set();
    const clouds = /* @__PURE__ */ new Set();
    const projects = /* @__PURE__ */ new Set();
    for (const a of assets) {
      kinds.add(a.kind);
      if (a.cloudPlatform) clouds.add(a.cloudPlatform);
      for (const p of (_a5 = a.projects) != null ? _a5 : []) projects.add(p.name);
      if (conditionHolds(a, "SENSITIVE_DATA")) kinds.add("SENSITIVE_DATA");
      if (conditionHolds(a, "INTERNET_EXPOSURE")) kinds.add("INTERNET_EXPOSURE");
      if (conditionHolds(a, "EXCESSIVE_PRIVILEGE")) kinds.add("EXCESSIVE_PRIVILEGE");
      if (conditionHolds(a, "MISSING_GUARDRAIL")) kinds.add("MISSING_GUARDRAIL");
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
        var _a5;
        const doc = loadGraphDoc();
        if (!doc) return { empty: true };
        const options = resolveGraphParams(params, {
          defaultDepth: getDefaultDepth2(),
          maxNodes: getMaxNodes2(),
          issues: openIssues(),
          scoredAssetIds: doc.nodes.filter((n) => {
            var _a6;
            return ((_a6 = n.aars) != null ? _a6 : 0) > 0;
          }).map((n) => n.id)
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
            maxNodes: options.maxNodes,
            // the budget in force, so the UI can name it
            seedIds: options.seedIds,
            expandIds: (_a5 = options.expandIds) != null ? _a5 : [],
            layout: view.mode,
            groupBy: view.groupBy,
            sort: view.sort
          },
          syncedAt: doc.syncedAt
        };
      });
    });
  }
  function getQueryVocabulary(p) {
    const params = p != null ? p : {};
    const raw = params["kind"];
    const kind = typeof raw === "string" && (raw === "ANY" || NODE_KINDS.includes(raw)) ? raw : null;
    return run(
      () => cached("queryVocabulary", { kind }, () => {
        const doc = loadGraphDoc();
        if (!doc) {
          return { empty: true, kinds: [], stepsFrom: {}, valuesFor: {}, fieldsFor: {}, shortcuts: [] };
        }
        const vocab = queryVocabulary(doc);
        if (!kind) return vocab;
        return {
          ...vocab,
          // ANY gets them too, over every node in the graph. `fieldsForKind("ANY")` already keeps
          // only the kind-agnostic fields, so the union is never one of things that cannot
          // co-occur — it is "which clouds does this estate use", which is the question.
          valuesFor: { [kind]: fieldValuesFor(doc, kind) },
          // What the palette's Properties tab lists, and the type that decides which control each
          // field gets. Per-kind for the same reason the value lists are.
          fieldsFor: {
            // Picked field by field rather than spread, so a getter never rides over the wire.
            // `multi` has to be here: it is what decides whether the filter editor offers "all of
            // these", and the client cannot recover it from a rendered string.
            [kind]: fieldsForKind(kind).map((f) => ({
              key: f.key,
              label: f.label,
              type: f.type,
              ...f.multi ? { multi: true } : {}
            }))
          }
        };
      })
    );
  }
  function runGraphQuery(p) {
    return run(() => {
      var _a5;
      const params = p != null ? p : {};
      const query = validateQuery((_a5 = params["query"]) != null ? _a5 : DEFAULT_QUERY);
      const columns = readColumnSelection(params["columns"]);
      const view = resolveLayoutParams(params);
      const maxNodes = clampInt(
        params["maxNodes"],
        getMaxNodes2(),
        MAX_NODES_FLOOR,
        MAX_NODES_CEILING
      );
      return cached("graphQuery", { query, columns, view, maxNodes }, () => {
        const doc = loadGraphDoc();
        if (!doc) return { empty: true };
        const result = runQuery(doc, query, { columns });
        const projection = inducedProjection(doc, result.nodeIds, result.edgeIds, maxNodes);
        return {
          rows: result.rows,
          groups: result.groups,
          total: result.total,
          capped: result.capped,
          truncated: result.truncated,
          nodes: projection.nodes,
          edges: projection.edges,
          summaries: projection.summaries,
          counts: projection.counts,
          layout: layoutGraph(projection, view),
          options: { maxNodes, layout: view.mode, groupBy: view.groupBy, sort: view.sort },
          syncedAt: doc.syncedAt
        };
      });
    });
  }
  function readColumnSelection(raw) {
    if (!Array.isArray(raw)) return void 0;
    return raw.map((entry) => Array.isArray(entry) ? entry.map((k) => String(k)) : null);
  }
  function inducedProjection(doc, nodeIds, edgeIds, maxNodes) {
    const wantNodes = new Set(nodeIds);
    const wantEdges = new Set(edgeIds);
    const all = doc.nodes.filter((n) => wantNodes.has(n.id)).sort(nodeOrder);
    const nodes = all.slice(0, maxNodes);
    const admitted = new Set(nodes.map((n) => n.id));
    const allEdges = doc.edges.filter((e) => wantEdges.has(e.id));
    const edges2 = allEdges.filter((e) => admitted.has(e.src) && admitted.has(e.dst));
    return {
      nodes,
      edges: edges2,
      summaries: [],
      counts: {
        totalNodes: all.length,
        shownNodes: nodes.length,
        totalEdges: allEdges.length,
        shownEdges: edges2.length,
        capped: nodes.length < all.length
      }
    };
  }
  function assetRow(n) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J;
    return {
      id: n.id,
      name: n.name,
      kind: n.kind,
      nativeType: (_a5 = n.nativeType) != null ? _a5 : null,
      cloud: (_b = n.cloudPlatform) != null ? _b : null,
      region: (_c = n.region) != null ? _c : null,
      status: (_d = n.status) != null ? _d : null,
      firstSeen: (_e = n.firstSeen) != null ? _e : null,
      lastSeen: (_f = n.lastSeen) != null ? _f : null,
      externalId: (_g = n.externalId) != null ? _g : null,
      projects: ((_h = n.projects) != null ? _h : []).map((p) => p.name),
      severity: (_i = n.severity) != null ? _i : null,
      aars: (_j = n.aars) != null ? _j : null,
      aarsSeverity: (_k = n.aarsSeverity) != null ? _k : null,
      comboGroups: (_l = n.comboGroups) != null ? _l : [],
      internet: (_m = n.isAccessibleFromInternet) != null ? _m : null,
      openInternet: (_n = n.isOpenToAllInternet) != null ? _n : null,
      // ENDPOINT rows only; null everywhere else. The pair is the dynamic scanner's verdict,
      // and the detail sheet prints both because either alone is misleading — an open port
      // behind SSO rates Low and is not an exposure.
      exposureLevel: (_o = n.exposureLevel) != null ? _o : null,
      portValidation: (_p = n.portValidation) != null ? _p : null,
      // Null, not {}, when the exposure steps never reached this asset — the same "clean" vs
      // "never asked" split dataFindingCount keeps below.
      exposureEvidence: (_q = n.exposureEvidence) != null ? _q : null,
      // Identity rows carry the first two; AI assets carry the third. Null, not false/{}, for
      // the "never reported" vs "reported clean" split the rest of this row keeps.
      inactive: (_r = n.inactive) != null ? _r : null,
      inactiveTimeframe: (_s = n.inactiveTimeframe) != null ? _s : null,
      humanAccess: (_t = n.humanAccess) != null ? _t : null,
      sensitiveAccess: (_u = n.hasAccessToSensitiveData) != null ? _u : false,
      sensitiveData: (_v = n.hasSensitiveData) != null ? _v : false,
      highPriv: (_w = n.hasHighPrivileges) != null ? _w : false,
      adminPriv: (_x = n.hasAdminPrivileges) != null ? _x : false,
      guardrailMissing: (_y = n.guardrailMissing) != null ? _y : false,
      // Null, not 0, when the sensitive-data traversal never reached this node: the graph
      // card and the insight row both key on truthiness, and a 0 would make "we never asked"
      // render exactly like "we looked and it is clean".
      dataFindingCount: (_z = n.dataFindingCount) != null ? _z : null,
      dataFindingSeverities: (_A = n.dataFindingSeverities) != null ? _A : null,
      // On the aggregate node only — the count it collapses.
      summaryCount: (_B = n.summaryCount) != null ? _B : null,
      technologyCategories: (_C = n.technologyCategories) != null ? _C : [],
      cloudAccount: (_E = (_D = n.cloudAccount) == null ? void 0 : _D.name) != null ? _E : null,
      // Full account object, for the detail sheet — cloudAccount above stays a bare
      // name string since existing client code already reads it as one.
      cloudAccountRef: (_F = n.cloudAccount) != null ? _F : null,
      tags: (_G = n.tags) != null ? _G : [],
      identityPurpose: (_H = n.identityPurpose) != null ? _H : null,
      issueAnalytics: (_I = n.issueAnalytics) != null ? _I : null,
      // Full project objects, for the detail sheet — projects above stays name-only.
      projectRefs: ((_J = n.projects) != null ? _J : []).map((p) => ({
        id: p.id,
        name: p.name,
        businessImpact: p.businessImpact
      }))
    };
  }
  function assetTableRow(n, issuesBySeverity) {
    var _a5, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    const row = {
      id: n.id,
      name: n.name,
      kind: n.kind,
      cloud: (_a5 = n.cloudPlatform) != null ? _a5 : null,
      region: (_b = n.region) != null ? _b : null,
      severity: (_c = n.severity) != null ? _c : null,
      aars: (_d = n.aars) != null ? _d : null,
      aarsSeverity: (_e = n.aarsSeverity) != null ? _e : null,
      combos: ((_f = n.comboGroups) != null ? _f : []).length,
      guardrailMissing: (_g = n.guardrailMissing) != null ? _g : false,
      agentic: n.identityPurpose === "AGENTIC",
      // How many classified findings this asset can REACH — its own if it is a datastore,
      // whatever its execution identity can read if it is an agent.
      //
      // Two sources because the reach walk is persisted through `aarsInput`, which only
      // scored nodes carry: a BUCKET is never scored (AARS covers AI assets), so a store
      // holding three findings would otherwise report 0 in the register while the graph drew
      // them. Identities fall in the same gap and stay uncovered here — service accounts are
      // unscored for reasons that predate this chain, so nothing persists their reach.
      dataFindings: ((_i = (_h = n.aarsInput) == null ? void 0 : _h.dataFindings) != null ? _i : []).reduce((sum, f) => sum + f.count, 0) || ((_j = n.dataFindingCount) != null ? _j : 0),
      projects: ((_k = n.projects) != null ? _k : []).map((p) => p.name)
    };
    if (issuesBySeverity) row["issuesBySeverity"] = issuesBySeverity;
    return row;
  }
  function issuesBySeverityByAsset(issues2) {
    var _a5, _b, _c;
    const out = /* @__PURE__ */ new Map();
    for (const issue2 of issues2) {
      if (!issue2.assetId) continue;
      const bucket = (_a5 = out.get(issue2.assetId)) != null ? _a5 : {};
      const sev = (_b = issue2.adjustedSeverity) != null ? _b : "UNKNOWN";
      bucket[sev] = ((_c = bucket[sev]) != null ? _c : 0) + 1;
      out.set(issue2.assetId, bucket);
    }
    return out;
  }
  function assetsModel() {
    var _a5, _b;
    const trend = aarsTrendFromHistory(syncHistory());
    const assets = loadAssets();
    const issues2 = openIssues();
    const assetIds = {};
    for (const a of assets) assetIds[a.id] = true;
    const openGaps = loadFindings().filter(isOpenGap);
    const unlinkedGaps = openGaps.filter((f) => !assetIds[f.resourceId]).length;
    const agents = assets.filter((a) => a.kind === "AI_AGENT");
    const protectedAgents = agents.filter((a) => !a.guardrailMissing).length;
    const issueRollup = issuesBySeverityByAsset(issues2);
    const rows = assets.map((a) => assetTableRow(a, issueRollup.get(a.id))).sort(ASSET_COMPARATORS.aars);
    const aarsSeverityCounts = {};
    const kinds = /* @__PURE__ */ new Set();
    const clouds = /* @__PURE__ */ new Set();
    const regions = /* @__PURE__ */ new Set();
    const severities = /* @__PURE__ */ new Set();
    const projects = /* @__PURE__ */ new Set();
    for (const a of assets) {
      if (a.aarsSeverity) aarsSeverityCounts[a.aarsSeverity] = ((_a5 = aarsSeverityCounts[a.aarsSeverity]) != null ? _a5 : 0) + 1;
      kinds.add(a.kind);
      if (a.cloudPlatform) clouds.add(a.cloudPlatform);
      if (a.region) regions.add(a.region);
      if (a.severity) severities.add(a.severity);
      for (const p of (_b = a.projects) != null ? _b : []) if (p.name) projects.add(p.name);
    }
    return {
      rows,
      kpis: {
        aiAssets: assets.filter((a) => AI_ASSET_KINDS.includes(a.kind)).length,
        agents: agents.length,
        // The numerator, not just the percentage. The Wiz Scans page states coverage as
        // "3 of 71 agents"; without this it had to recover the 3 by counting rows, which
        // only works while the client holds every row.
        protectedAgents,
        criticalAars: assets.filter((a) => a.aarsSeverity === "CRITICAL").length,
        highAars: assets.filter((a) => a.aarsSeverity === "HIGH").length,
        guardrailCoveragePct: agents.length ? Math.round(protectedAgents / agents.length * 100) : null,
        sensitiveAccess: assets.filter(
          (a) => AI_ASSET_KINDS.includes(a.kind) && a.hasAccessToSensitiveData
        ).length,
        // The DSPM pair. Every datastore in TABS.assets arrived on a path from an AI agent —
        // INVENTORY_AI filters to AI resource types, so a bucket can only have been returned
        // by the sensitive-data traversal — which is what makes this an honest reachability
        // count without reading edges, something loadAssets (a tab-direct read model) cannot
        // do. The dry run seeds datastores directly, so the invariant is a live-tenant one.
        sensitiveDatastores: assets.filter(
          (a) => DATASTORE_KINDS.includes(a.kind) && a.hasSensitiveData
        ).length,
        dataFindings: assets.reduce((sum, a) => {
          var _a6;
          return sum + ((_a6 = a.dataFindingCount) != null ? _a6 : 0);
        }, 0),
        openIssues: issues2.length,
        complianceGaps: openGaps.length,
        complianceGapsUnlinked: unlinkedGaps,
        // Framework POSTURE, which is a different axis from the two counts above: those
        // count failing controls, this scores frameworks. Null — never 0 — when no posture
        // has been synced, so the Wiz Scans area degrades to `partial` on its own instead of
        // reporting a confident zero for a question this tenant was never asked.
        // Scoped the same way the Compliance page scopes it. Not an optimisation — the two
        // pages would otherwise report different failing-control totals for one estate, and
        // this KPI is the number the Wiz Scans coverage area prints beside the other one.
        frameworkPosture: complianceKpis(
          loadPosture(),
          scopedFrameworkPolicies().policies
        ),
        agenticIdentities: assets.filter((a) => a.identityPurpose === "AGENTIC").length,
        // Estate-wide counts for the two risk conditions that had no total. The flags were
        // persisted and drawn on the graph, but `assetTableRow` strips them, so nothing
        // could say how much of the estate they cover. `internetUnknown` is its own number
        // on purpose: a hosted agent inherits exposure from its host and Wiz reports that
        // as undetermined, so folding it into "not exposed" under-reports.
        internetExposed: assets.filter((a) => conditionState(a, "INTERNET_EXPOSURE") === true).length,
        internetUnknown: assets.filter((a) => conditionState(a, "INTERNET_EXPOSURE") === null).length,
        // The two grades of evidence behind `internetExposed`, reported separately because
        // they are separate claims. `internetValidated` counts assets serving an endpoint Wiz's
        // scanner connected to and policy rates High or Medium; `internetViaHost` counts those
        // whose reachability was established one hop away, on the compute they run on. An
        // asset can be in both, and one in neither is exposed by its own two flags.
        internetValidated: assets.filter((a) => {
          var _a6, _b2;
          return ((_b2 = (_a6 = a.exposureEvidence) == null ? void 0 : _a6.endpointIds) != null ? _b2 : []).length > 0;
        }).length,
        internetViaHost: assets.filter((a) => {
          var _a6, _b2;
          return ((_b2 = (_a6 = a.exposureEvidence) == null ? void 0 : _a6.hostIds) != null ? _b2 : []).length > 0;
        }).length,
        // Human identity access. The Wiz Scans page declared this area partial because "nothing
        // totals them"; these are the totals, counted off the persisted join rather than off the
        // graph stubs, which are deliberately suppressed where a real CIEM finding exists.
        //
        // The unit is deliberately narrow and the page says so: the traversal only ever returns
        // ADMIN and HIGH_PRIVILEGE bindings, so this is not "assets a person can reach" — it is
        // "assets a person can reach with rights worth naming".
        humanReachable: assets.filter((a) => {
          var _a6, _b2;
          return ((_b2 = (_a6 = a.humanAccess) == null ? void 0 : _a6.identityIds) != null ? _b2 : []).length > 0;
        }).length,
        humanReachableAdmin: assets.filter((a) => {
          var _a6;
          return ((_a6 = a.humanAccess) == null ? void 0 : _a6.admin) === true;
        }).length,
        // Distinct identities across every asset, so one operator with access to six agents
        // counts once. `humanDormant` is the join worth having: a dormant account holding admin
        // rights on an AI asset is a low-noise backdoor, and it is the reason the identity
        // properties are collected at all.
        humanIdentities: distinctHumanIdentities(assets).size,
        // Effective access: people Wiz says can actually reach an AI asset's DATA, as opposed
        // to people holding a role that grants access. Counted separately and never added to
        // `humanIdentities` — see the note on humanAccess.effectiveIds.
        humanEffective: assets.filter((a) => {
          var _a6, _b2;
          return ((_b2 = (_a6 = a.humanAccess) == null ? void 0 : _a6.effectiveIds) != null ? _b2 : []).length > 0;
        }).length,
        // Hygiene, counted over the DISTINCT identities rather than summed from the per-asset
        // counts. One person with bindings on six agents is one person whose MFA is missing;
        // summing `noMfaCount` across assets would report six.
        ...identityHygieneKpis(assets),
        highPrivilege: assets.filter((a) => conditionHolds(a, "EXCESSIVE_PRIVILEGE")).length
      },
      aarsSeverityCounts,
      // Recorded per sync, so the window is short at first and cannot be backfilled.
      aarsTrend: trend,
      aarsTrendRuleChanges: ruleChangePoints(trend),
      facets: {
        kinds: [...kinds].sort(),
        clouds: [...clouds].sort(),
        regions: [...regions].sort(),
        aarsSeverities: AARS_SEVERITY_ORDER.filter((sev) => aarsSeverityCounts[sev]),
        severities: SEVERITY_ORDER.filter((sev) => severities.has(sev)),
        projects: [...projects].sort()
      }
    };
  }
  function getAssets(p) {
    return run(() => {
      const query = resolveAssetQuery(p != null ? p : {});
      const model = cached("assetsModel", null, assetsModel);
      const head = {
        total: model.rows.length,
        kpis: model.kpis,
        aarsSeverityCounts: model.aarsSeverityCounts,
        aarsTrend: model.aarsTrend,
        aarsTrendRuleChanges: model.aarsTrendRuleChanges,
        aarsDeltas: aarsDeltas(model.aarsTrend, model.aarsSeverityCounts),
        facets: model.facets,
        pageSize: query.pageSize,
        sort: query.sort,
        dir: query.dir
      };
      if (model.rows.length <= CLIENT_ALL_MAX) {
        return {
          ...head,
          all: true,
          rows: model.rows,
          filtered: model.rows.length,
          page: 0,
          pageCount: Math.max(1, Math.ceil(model.rows.length / query.pageSize))
        };
      }
      const filtered = sortAssetRows(filterAssetRows(model.rows, query), query.sort, query.dir);
      const paged = pageOf(filtered, query.page, query.pageSize);
      return {
        ...head,
        all: false,
        rows: paged.rows,
        filtered: filtered.length,
        page: paged.page,
        pageCount: paged.pageCount,
        // Deliberately outside the data-version cache: these depend on the query. Only the
        // paged path ships them — the all path's client holds every row and counts its own,
        // because in that mode a filter change never reaches the server at all.
        facetCounts: facetCounts(model.rows, query)
      };
    });
  }
  function aarsDeltas(trend, live) {
    var _a5, _b, _c, _d, _e, _f, _g;
    if (trend.length < 2) return null;
    const last = trend[trend.length - 1];
    const prev = trend[trend.length - 2];
    if (last.ruleVersion !== prev.ruleVersion) return null;
    for (const sev of AARS_SEVERITY_ORDER) {
      if (((_b = (_a5 = last.counts) == null ? void 0 : _a5[sev]) != null ? _b : 0) !== ((_c = live[sev]) != null ? _c : 0)) return null;
    }
    const counts = {};
    for (const sev of AARS_SEVERITY_ORDER) {
      counts[sev] = ((_e = (_d = last.counts) == null ? void 0 : _d[sev]) != null ? _e : 0) - ((_g = (_f = prev.counts) == null ? void 0 : _f[sev]) != null ? _g : 0);
    }
    return { counts, since: prev.at };
  }
  function getAssetOptions(_p) {
    return run(
      () => cached("assetOptions", null, () => ({
        rows: [...loadAssets()].sort((a, b) => {
          var _a5, _b;
          return Number((_a5 = b.aars) != null ? _a5 : -1) - Number((_b = a.aars) != null ? _b : -1);
        }).map((n) => ({ id: n.id, name: n.name, kind: n.kind }))
      }))
    );
  }
  function getAssetDetail(p) {
    return run(() => {
      var _a5;
      const id = String((_a5 = (p != null ? p : {})["id"]) != null ? _a5 : "");
      return cached("getAssetDetail", { id }, () => {
        var _a6, _b;
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
        const findings = loadFindings().filter((f) => f.resourceId === id && isOpenGap(f)).map((f) => {
          var _a7, _b2, _c;
          return {
            id: f.id,
            resourceId: f.resourceId,
            ruleShortId: f.ruleShortId,
            ruleName: (_a7 = f.ruleName) != null ? _a7 : null,
            name: (_b2 = f.name) != null ? _b2 : null,
            severity: f.severity,
            remediation: (_c = f.remediation) != null ? _c : null,
            frameworkCodes: f.frameworkCodes
          };
        });
        return {
          node: {
            ...assetRow(node2),
            aarsPillars: (_a6 = node2.aarsPillars) != null ? _a6 : null,
            aarsInput: (_b = node2.aarsInput) != null ? _b : null
          },
          issues: issues2,
          neighbors,
          findings
        };
      });
    });
  }
  function aiAssetIdSet() {
    const ids = {};
    for (const a of loadAssets()) ids[a.id] = true;
    return ids;
  }
  function scopedFrameworkPolicies() {
    const posture = loadPosture();
    const allPolicies = loadFrameworkPolicies();
    const catalogue = loadFrameworks();
    const scope = scopeFiveRs(
      buildAllFrameworkTrees(posture, allPolicies, catalogue),
      loadFindings(),
      aiAssetIdSet(),
      getFiveRsPins2()
    );
    const dropped = new Set(unselectedPolicyIds(scope));
    const policies = dropped.size ? allPolicies.filter(
      (pol) => pol.frameworkId !== scope.frameworkId || !dropped.has(pol.policyId)
    ) : allPolicies;
    return { policies, scope };
  }
  function configModel() {
    const assetIds = aiAssetIdSet();
    const rows = loadFindings().map((f) => toConfigView(f, !!assetIds[f.resourceId]));
    const severities = /* @__PURE__ */ new Set();
    const statuses = /* @__PURE__ */ new Set();
    const clouds = /* @__PURE__ */ new Set();
    const resourceTypes = /* @__PURE__ */ new Set();
    const rules = /* @__PURE__ */ new Set();
    const projects = /* @__PURE__ */ new Set();
    for (const r of rows) {
      if (r.severity) severities.add(r.severity);
      if (r.status) statuses.add(r.status);
      if (r.cloud) clouds.add(r.cloud);
      if (r.resourceType) resourceTypes.add(r.resourceType);
      if (r.ruleShortId) rules.add(r.ruleShortId);
      for (const p of r.projects) projects.add(p);
    }
    return {
      rows: sortConfigRows(rows, "severity"),
      totals: configTotals(rows),
      facets: {
        severities: SEVERITY_ORDER.filter((s) => severities.has(s)),
        statuses: [...statuses].sort(),
        clouds: [...clouds].sort(),
        resourceTypes: [...resourceTypes].sort(),
        rules: [...rules].sort(),
        projects: [...projects].sort()
      }
    };
  }
  function getConfigFindings(p) {
    return run(() => {
      var _a5, _b, _c;
      const params = p != null ? p : {};
      const query = resolveConfigQuery(params);
      const sort = CONFIG_SORTS.indexOf(String((_a5 = params["sort"]) != null ? _a5 : "")) >= 0 ? String(params["sort"]) : "severity";
      const dir = String((_b = params["dir"]) != null ? _b : "") === "asc" ? "asc" : String((_c = params["dir"]) != null ? _c : "") === "desc" ? "desc" : DEFAULT_CONFIG_SORT_DIR[sort];
      const pageSize = Math.min(
        MAX_CONFIG_PAGE_SIZE,
        Math.max(1, Number(params["pageSize"]) || DEFAULT_CONFIG_PAGE_SIZE)
      );
      const page = Math.max(0, Number(params["page"]) || 0);
      const model = cached("configModel", null, configModel);
      const head = {
        total: model.rows.length,
        totals: model.totals,
        facets: model.facets,
        pageSize,
        sort,
        dir
      };
      if (model.rows.length <= CONFIG_CLIENT_ALL_MAX) {
        return {
          ...head,
          all: true,
          rows: model.rows,
          filtered: model.rows.length,
          page: 0,
          pageCount: Math.max(1, Math.ceil(model.rows.length / pageSize))
        };
      }
      const filtered = sortConfigRows(filterConfigRows(model.rows, query), sort, dir);
      const paged = pageOf(filtered, page, pageSize);
      return {
        ...head,
        all: false,
        controls: rollupByControl(filtered),
        rows: paged.rows,
        filtered: filtered.length,
        page: paged.page,
        pageCount: paged.pageCount,
        facetCounts: configFacetCounts(model.rows, query)
      };
    });
  }
  function getConfigFindingDetail(p) {
    return run(() => {
      var _a5;
      const id = String((_a5 = (p != null ? p : {})["id"]) != null ? _a5 : "");
      return cached("getConfigFindingDetail", { id }, () => {
        const finding = loadFindings().filter((f) => f.id === id)[0];
        if (!finding) return null;
        const asset = loadAssets().filter((a) => a.id === finding.resourceId)[0];
        return {
          finding,
          gap: isOpenGap(finding),
          // The asset the finding is keyed to, when the inventory holds it. Null is the
          // common case and is not an error: most AI-security rules fail on a region, an
          // IAM policy or an identity no agent runs as.
          asset: asset ? assetRow(asset) : null
        };
      });
    });
  }
  function getCompliance(p) {
    return run(() => {
      var _a5;
      const params = p != null ? p : {};
      const requested = String((_a5 = params["frameworkId"]) != null ? _a5 : "");
      return cached("getCompliance", { frameworkId: requested }, () => {
        const posture = loadPosture();
        const catalogue = loadFrameworks();
        const selected = getSelectedFrameworks2(() => catalogue);
        const { policies, scope: fiveRsScope } = scopedFrameworkPolicies();
        const trees = buildAllFrameworkTrees(posture, policies, catalogue);
        const merged = catalogue.map((f) => ({ ...f, selected: selected.indexOf(f.id) >= 0 }));
        return {
          trees,
          kpis: complianceKpis(posture, policies),
          catalogue: merged,
          selected,
          // The Overview's four bands. Computed here rather than in the browser because the
          // client bundle cannot import the domain layer at all — every client-side copy of
          // domain logic in this app is a hand-kept mirror with a test holding the two
          // together (assetQuery.js, configView.js), and that machinery exists to reconcile
          // a client filtering a PAGE against a server filtering the WHOLE set. This payload
          // is already shipped whole and cached, so there is no second scope to reconcile —
          // a mirror here would be duplicated risk buying nothing.
          rail: frameworkRail(trees),
          weakestAreas: weakestAreas(trees),
          sharedControls: sharedControls(trees),
          // Every rule the 5Rs maps, in or out, with the reason. Shipped whole rather than
          // as a count because the Settings card is the place an operator overturns a
          // derivation, and it cannot argue with a verdict it cannot see.
          fiveRsScope,
          coverage: coverageSummary(trees, merged),
          // Named so the page can open on a framework it was linked to rather than guessing.
          // Null when the requested id has no stored posture, which the page reports as such
          // instead of silently falling back to a different framework's numbers.
          requested: requested && trees.some((t) => t.frameworkId === requested) ? requested : null
        };
      });
    });
  }
  function setSelectedFrameworks2(p) {
    return run(() => {
      const ids = (p != null ? p : {})["ids"];
      return { selected: setSelectedFrameworks(ids) };
    });
  }
  var EXPAND_MAX_NODES = 200;
  var EXPAND_MAX_EDGES = 400;
  function expandAsset(p) {
    return run(() => {
      var _a5, _b, _c;
      const id = String((_a5 = (p != null ? p : {})["id"]) != null ? _a5 : "");
      if (!id) return null;
      const empty = { nodes: [], edges: [], arityMismatches: 0, truncated: false };
      const doc = loadGraphDoc();
      const node2 = doc ? doc.nodes.filter((n) => n.id === id)[0] : void 0;
      if (node2 && node2.kind !== "AI_AGENT") return { source: "unsupported", ...empty };
      if (!hasWizCredentials()) return { source: "stored", ...empty };
      const projectId = (_c = (_b = projectScope()) == null ? void 0 : _b[0]) != null ? _c : null;
      return cached("expandAsset", { id, projectId }, () => {
        const slots = flattenSlots(AGENT_EXPANSION);
        const page = fetchGraphSearchPage({
          query: Q_AGENT_EXPANSION,
          extraVariables: {
            query: toGraphEntityQuery(AGENT_EXPANSION, id),
            projectId
          }
        });
        const decoded = decodeExpansion(slots, page.rows);
        const nodes = decoded.nodes.slice(0, EXPAND_MAX_NODES);
        const keep = new Set(nodes.map((n) => n.id));
        const edges2 = decoded.edges.filter((e) => keep.has(e.src) && keep.has(e.dst)).slice(0, EXPAND_MAX_EDGES);
        return {
          source: "live",
          fetchedAt: nowIso(),
          rootId: id,
          nodes,
          edges: edges2,
          // Surfaced, not swallowed. A non-zero count means the tenant returned an entity
          // array of a different length than the spec's slot list, so those rows were
          // refused rather than decoded onto the wrong nodes — the operator needs to know.
          arityMismatches: decoded.arityMismatches,
          truncated: decoded.nodes.length > nodes.length || decoded.edges.length > edges2.length || page.hasNextPage
        };
      }, void 0, wizDataVersion());
    });
  }
  function getIssues(p) {
    return run(() => {
      var _a5;
      const params = p != null ? p : {};
      const group = String((_a5 = params["group"]) != null ? _a5 : "");
      return cached("getIssues", { group }, () => {
        let rows = loadIssues();
        if (group) rows = rows.filter((i) => i.comboGroup === group);
        return { rows, total: rows.length };
      });
    });
  }
  function getIssueDetail(p) {
    return run(() => {
      var _a5, _b;
      const id = String((_a5 = (p != null ? p : {})["id"]) != null ? _a5 : "");
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
        const assetRows = loadAssets();
        const assets = new Map(assetRows.map((a) => [a.id, a]));
        const digest = comboDigest(issues2, assetRows, (/* @__PURE__ */ new Date()).toISOString());
        const digestById = new Map(digest.groups.map((g) => [g.id, g]));
        return {
          // Every count the page renders, computed once here rather than four times in the
          // browser. Additive: the `groups` shape below is unchanged, so a payload cached
          // before this shipped still renders the page (minus the summary sections).
          digest,
          groups: comboSummary(issues2).map((s) => {
            var _a5, _b, _c, _d;
            return {
              id: s.group.id,
              ruleId: s.group.ruleId,
              title: s.group.title,
              shortLabel: s.group.shortLabel,
              nativeSeverity: s.group.nativeSeverity,
              adjustedSeverity: s.group.adjustedSeverity,
              amplifierNote: s.group.amplifierNote,
              // Whether this group re-rates its issues. The card renders the shift badge and
              // the amplifier note together off this flag, so the note can never go missing
              // from beside an adjusted severity — and the Other bucket, which makes no such
              // claim, renders neither.
              amplified: s.group.amplified,
              // The declared half of the condition matrix. It rides on the group rather than
              // only on the digest so the card's condition strip still says what the rule
              // tests when an older cached payload arrives with no digest attached.
              conditions: s.group.conditions,
              frameworks: s.group.frameworks,
              // The measured severity mix, mirrored onto the group so the page's severity
              // filter can ask what a card actually HOLDS. Filtering on the declared
              // adjustedSeverity alone hides the Other bucket — whose declared severity is
              // the worst it holds, not the only one — while it still holds matching rows.
              adjustedMix: (_b = (_a5 = digestById.get(s.group.id)) == null ? void 0 : _a5.adjustedMix) != null ? _b : {},
              nativeMix: (_d = (_c = digestById.get(s.group.id)) == null ? void 0 : _c.nativeMix) != null ? _d : {},
              count: s.count,
              assets: s.assetIds.map((id) => {
                var _a6, _b2;
                const a = assets.get(id);
                return a ? { id, name: a.name, aars: (_a6 = a.aars) != null ? _a6 : null, aarsSeverity: (_b2 = a.aarsSeverity) != null ? _b2 : null } : { id, name: id, aars: null, aarsSeverity: null };
              })
            };
          }),
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
      var _a5;
      return jobStatus(String((_a5 = (p != null ? p : {})["jobId"]) != null ? _a5 : ""));
    });
  }
  function cancelSync2(p) {
    return run(() => {
      var _a5;
      return cancelSync(String((_a5 = (p != null ? p : {})["jobId"]) != null ? _a5 : ""));
    });
  }
  function getSyncHistory(_p) {
    return run(() => cached("getSyncHistory", null, () => ({
      rows: syncHistory().reverse()
    })));
  }
  function getScanQueries(_p) {
    return run(() => ({
      steps: describeSyncSteps(),
      specs: STEP_VAR_SPECS,
      skippedSteps: getSkippedSteps2(),
      // Reported separately from the skips: these steps ran and were answered, we just
      // stopped asking at the page cap, so their rows are a prefix rather than an absence.
      truncatedSteps: getTruncatedSteps2(),
      hasCredentials: hasWizCredentials(),
      limits: { maxListValues: MAX_LIST_VALUES, maxValueLen: MAX_VALUE_LEN },
      // Named rather than folded into `variables`: the transport adds these to every request,
      // so showing them as if they were configuration would invite someone to edit them.
      transportVariables: ["first", "after", "quick"]
    }));
  }
  function setScanVars2(p) {
    return mutate(() => {
      var _a5;
      const params = p != null ? p : {};
      const stepId = String((_a5 = params["stepId"]) != null ? _a5 : "");
      if (!isEditableStep(stepId)) {
        throw new Error(`${stepId || "That step"} does not take editable variables.`);
      }
      const proposed = cleanStepVars(stepId, params["vars"]);
      const errors = validateStepVars(stepId, proposed);
      if (errors.length) throw new Error(errors.join(" "));
      setScanVars(stepId, proposed);
      return { steps: describeSyncSteps() };
    });
  }
  function testScanVars(p) {
    return run(() => {
      var _a5;
      const params = p != null ? p : {};
      const stepId = String((_a5 = params["stepId"]) != null ? _a5 : "");
      if (!isEditableStep(stepId)) {
        throw new Error(`${stepId || "That step"} does not take editable variables.`);
      }
      const proposed = cleanStepVars(stepId, params["vars"]);
      const errors = validateStepVars(stepId, proposed);
      if (errors.length) throw new Error(errors.join(" "));
      if (!hasWizCredentials()) {
        throw new Error(
          "A test run calls Wiz, and no credentials are configured \u2014 this deployment is in dry-run. Add credentials in Settings to test a filter against the tenant."
        );
      }
      return testStepVariables(stepId, proposed);
    });
  }
  function getSettings(_p) {
    return run(() => ({
      defaultDepth: getDefaultDepth2(),
      maxNodes: getMaxNodes2(),
      maxNodesFloor: MAX_NODES_FLOOR,
      maxNodesCeiling: MAX_NODES_CEILING,
      autoExpand: getAutoExpand2(),
      hasCredentials: hasWizCredentials(),
      // The operator's overrides on the 5Rs scope. Only the pins: the derived default is
      // computed in getCompliance, where the trees and findings it needs already are.
      fiveRsPins: getFiveRsPins2()
    }));
  }
  function setSettings(p) {
    return mutate(() => {
      const params = p != null ? p : {};
      if (params["defaultDepth"] !== void 0) {
        setDefaultDepth(params["defaultDepth"]);
      }
      if (params["maxNodes"] !== void 0) setMaxNodes(params["maxNodes"]);
      if (params["autoExpand"] !== void 0) setAutoExpand(params["autoExpand"]);
      if (params["fiveRsPins"] !== void 0) {
        setFiveRsPins(
          cleanFiveRsPins(
            params["fiveRsPins"],
            loadFrameworkPolicies().map((pol) => pol.policyId)
          )
        );
      }
      return {
        defaultDepth: getDefaultDepth2(),
        maxNodes: getMaxNodes2(),
        // Echoed so the Settings page's paint({ ...s, ...fresh }) repaints the STORED value
        // rather than the one it asked for.
        autoExpand: getAutoExpand2(),
        fiveRsPins: getFiveRsPins2()
      };
    });
  }
  var PREVIEW_MOVERS_MAX = 50;
  var SAMPLE_SEVERITIES_MAX = 50;
  var SAMPLE_GAPS_MAX = 30;
  var GAP_CENSUS_MAX = 200;
  function ruleState() {
    const stored = getAarsRule2();
    const scoredVersion = getScoredRuleVersion2();
    return {
      version: stored.version,
      rule: stored.rule,
      defaults: DEFAULT_AARS_RULE,
      // Whole rules the page can load into the draft. `defaults` above is the spec model and
      // stays where it is (Reset reads it); presets are alternatives, not a fallback.
      presets: { v2: AARS_V2_RULE },
      summary: ruleSummary(stored.rule),
      scoredVersion,
      // Only the point model can strand the persisted scores; bands re-derive on read, and
      // setAarsRule carries the marker forward across a band-only edit.
      stale: scoredVersion !== stored.version,
      bandRanges: bandRanges(stored.rule.bands),
      limits: {
        pointsMax: POINTS_MAX,
        multiplierMin: MULTIPLIER_MIN,
        multiplierMax: MULTIPLIER_MAX,
        bandMin: BAND_MIN,
        bandMax: BAND_MAX,
        maxGapRules: MAX_GAP_RULES
      }
    };
  }
  function getAarsRule3(_p) {
    return run(() => ruleState());
  }
  function setAarsRule2(p) {
    return mutate(() => {
      const params = p != null ? p : {};
      const proposed = cleanAarsRule(params["rule"]);
      const errors = validateAarsRule(proposed);
      if (errors.length) throw new Error(errors.join(" "));
      setAarsRule(proposed);
      return ruleState();
    });
  }
  function previewAarsRule(p) {
    return run(() => {
      var _a5, _b;
      const params = p != null ? p : {};
      const proposed = cleanAarsRule(params["rule"]);
      const errors = validateAarsRule(proposed);
      if (errors.length) throw new Error(errors.join(" "));
      const before = loadAssets();
      const after = scoreAssetsWith(proposed);
      const beforeById = new Map(before.map((n) => [n.id, n]));
      const tally = gapMatchTally(
        proposed,
        before.map((n) => {
          var _a6, _b2;
          return ((_b2 = (_a6 = n.aarsInput) == null ? void 0 : _a6.gaps) != null ? _b2 : []).map((g) => g.code);
        })
      );
      const census = Object.keys(tally.byCode).map((code) => ({ code, assets: tally.byCode[code] })).sort((x, y) => y.assets - x.assets || x.code.localeCompare(y.code)).slice(0, GAP_CENSUS_MAX);
      const movers = [];
      for (const a of after) {
        const b = beforeById.get(a.id);
        const fromScore = typeof (b == null ? void 0 : b.aars) === "number" ? b.aars : null;
        const toScore = typeof a.aars === "number" ? a.aars : null;
        const fromSeverity = (_a5 = b == null ? void 0 : b.aarsSeverity) != null ? _a5 : null;
        const toSeverity = (_b = a.aarsSeverity) != null ? _b : null;
        if (fromScore === toScore && fromSeverity === toSeverity) continue;
        movers.push({
          id: a.id,
          name: a.name,
          kind: a.kind,
          fromScore,
          toScore,
          fromSeverity,
          toSeverity,
          levelChanged: fromSeverity !== toSeverity,
          delta: (toScore != null ? toScore : 0) - (fromScore != null ? fromScore : 0)
        });
      }
      movers.sort((x, y) => {
        var _a6, _b2;
        const lvl = Number(y["levelChanged"]) - Number(x["levelChanged"]);
        if (lvl) return lvl;
        const mag = Math.abs(Number(y["delta"])) - Math.abs(Number(x["delta"]));
        if (mag) return mag;
        return Number((_a6 = y["toScore"]) != null ? _a6 : -1) - Number((_b2 = x["toScore"]) != null ? _b2 : -1);
      });
      return {
        total: before.length,
        current: countAarsSeverities(before),
        proposed: countAarsSeverities(after),
        // The proposed rule read back in prose, and the rows that can never fire — both
        // describe the draft, so they travel with the preview rather than the saved state.
        summary: ruleSummary(proposed),
        bandRanges: bandRanges(proposed.bands),
        shadowedGapRules: shadowedGapRules(proposed),
        // A THIRD state, distinct from both shadowed and unexercised: the row names a code
        // no derivation can raise, so it cannot fire in any tenant, not just this one.
        unreachableGapRules: unreachableGapRules(proposed),
        // How well the draft separates the estate — the number the band counts above cannot
        // show, because a rule that gives every asset the same score still fills a band.
        discrimination: ruleDiscrimination(after, proposed),
        // Coverage: how many gap instances each cascade row priced, what fell through to the
        // fallback, and the codes the estate carries. A row at 0 here is NOT the same claim
        // as shadowedGapRules — one can never fire, the other simply is not exercised — and
        // the page reads them as two different sentences.
        gapMatchCounts: tally.perRule,
        gapFallbackCount: tally.fallback,
        gapInstanceTotal: tally.total,
        gapCensus: census,
        movers: movers.slice(0, PREVIEW_MOVERS_MAX),
        moverCount: movers.length,
        levelChangeCount: movers.filter((m) => m["levelChanged"]).length,
        // Counted apart from the level changes: moving a threshold re-labels assets without
        // touching a single score, and saying "N assets change score" for that would be a lie.
        scoreChangeCount: movers.filter((m) => m["fromScore"] !== m["toScore"]).length,
        truncated: movers.length > PREVIEW_MOVERS_MAX
      };
    });
  }
  function scoreAarsSample(p) {
    return run(() => {
      var _a5, _b;
      const params = p != null ? p : {};
      const rule = cleanAarsRule(params["rule"]);
      const sample = (_a5 = params["sample"]) != null ? _a5 : {};
      const rawSeverities = Array.isArray(sample["issueSeverities"]) ? sample["issueSeverities"] : [];
      const issueSeverities = rawSeverities.slice(0, SAMPLE_SEVERITIES_MAX).map((s) => String(s).trim().toUpperCase());
      const rawCodes = Array.isArray(sample["gapCodes"]) ? sample["gapCodes"] : [];
      const codes = rawCodes.map(cleanGapCode).filter(Boolean).slice(0, SAMPLE_GAPS_MAX);
      const exposure = String((_b = sample["dataExposure"]) != null ? _b : "NONE").trim().toUpperCase();
      const dataExposure = exposure === "SENSITIVE" || exposure === "DATA_ACCESS" ? exposure : "NONE";
      const gaps = codes.map((c) => gap(c));
      const result = computeAars({ issueSeverities, gaps, dataExposure }, rule);
      return { ...result, gapBreakdown: gapBreakdown(gaps, rule) };
    });
  }
  function rescoreAars(_p) {
    return mutate(() => ({ ...rescoreInventory(), ...ruleState() }));
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
          dataFindings: dataRowCount(TABS.dataFindings),
          syncs: dataRowCount(TABS.syncHistory)
        }
      }), 3600)
    );
  }
  return __toCommonJS(server_exports);
})();
