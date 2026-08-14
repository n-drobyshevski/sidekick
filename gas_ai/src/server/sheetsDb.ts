// Generic header-mapped tab access over the SIDEKICK AI spreadsheet.
//
// Row 1 of every tab is a frozen header; all reads/writes map columns BY HEADER NAME,
// never by index, so adding a column is non-breaking — writes bring the header row up to
// the declared schema first (see ensureHeaders), so a tab that predates a column receives
// it instead of dropping the value. Empty cells read as null; every
// write is one batched setValues call. Engine copied from the OS-vulns tool; only the
// tab schema differs — here the durable state is a graph snapshot (assets/edges/issues
// wholesale-rewritten per sync), not an append-only vulnerability ledger.

import { PROP_KEYS, requireProp } from "./props";
import { toIso, type Rec } from "../domain/util";

export const TABS = {
  assets: "ai_assets",
  edges: "ai_edges",
  issues: "ai_issues",
  findings: "ai_findings",
  dataFindings: "ai_data_findings",
  syncHistory: "sync_history",
  settings: "settings",
  jobs: "jobs",
  meta: "meta",
} as const;

export const TAB_HEADERS: Record<string, string[]> = {
  [TABS.assets]: [
    "id", "kind", "name", "native_type", "cloud", "region", "status",
    "account_id", "account_name", "projects_json", "first_seen", "last_seen",
    "internet", "open_internet", "sensitive_data", "sensitive_access", "high_priv",
    "admin_priv", "guardrail_missing", "severity", "aars", "aars_severity",
    "aars_pillars_json", "aars_input_json",
    "combo_groups", "tags_json", "technology_categories",
    "identity_purpose", "issue_analytics_json",
    // DSPM classification on a datastore row. Appended, so an existing ledger picks them
    // up on the next sync with no migration (see the note on ai_issues below).
    "data_finding_count", "data_findings_json",
    // Network exposure. The first two are the dynamic scanner's verdicts and belong to
    // ENDPOINT rows; the third is the join `withExposureEvidence` folds onto an AI asset,
    // and is what lets the Inventory and the combos matrix — which read this tab directly
    // and never see the graph document — agree with the graph about what is exposed.
    // Appended for the same no-migration reason.
    "exposure_level", "port_validation", "exposure_evidence_json",
  ],
  [TABS.edges]: ["id", "src", "dst", "type", "negated", "access_type"],
  [TABS.issues]: [
    "id", "rule_id", "rule_name", "combo_group", "native_severity", "adjusted_severity",
    "status", "asset_id", "asset_name", "region", "account", "projects_json",
    "frameworks_json", "justification", "created_at",
    "due_at", "resolution_recommendation", "remediation",
    // issuesV2 lifecycle and context. Appended, never inserted: ensureHeaders adds
    // declared-but-missing headers to the right of whatever a tab already has and every
    // read maps by header NAME, so a ledger written before this change picks these up on
    // the next sync with no migration and no re-run of setup().
    "issue_type", "updated_at", "resolved_at", "resolution_reason", "resolved_by",
    "assignee", "environments", "validated_exploitable", "business_impact",
    "entity_status", "subscription_id", "ignore_note", "ignore_expired_at",
    "ticket_urls", "ai_verdict", "ai_recommended_severity",
  ],
  [TABS.findings]: [
    "id", "resource_id", "rule_short_id", "severity", "remediation", "framework_codes",
    // The Cloud Configuration register. Appended, never inserted — same contract as the
    // ai_issues block above: ensureHeaders adds declared-but-missing headers to the right
    // and every read maps by header NAME, so a ledger written before this change picks
    // them up on the next sync with no migration and no re-run of setup().
    //
    // Rows written by the previous version carry neither `result` nor `status`. That is
    // why isOpenGap (domain/config.ts) treats an absent field as permissive: those rows
    // were already filtered to FAIL + OPEN at ingest, and demanding the columns would
    // read every one of them as "not a gap".
    "name", "status", "result", "deleted", "first_seen_at", "analyzed_at",
    // The control. rule_description / remediation_instructions / opa_policy repeat
    // verbatim across every finding of the same rule — sixteen identical Rego documents
    // for one Bedrock rule in the sample tenant. Denormalized on purpose: the register
    // reads them per row, the sync rewrites this tab wholesale, and a rules tab would buy
    // a join to save a few hundred cells on a register the framework filter already
    // bounds to the AI estate.
    "rule_id", "rule_graph_id", "rule_name", "rule_description",
    "remediation_instructions", "opa_policy", "risks_json", "threats_json",
    "resource_name", "resource_type", "resource_status", "target_external_id", "source",
    "subscription_id", "subscription_name", "cloud_provider", "projects_json",
    "business_impact", "ignore_rule_ids_json", "iac_finding_ids_json",
  ],
  // DSPM findings, kept apart from the compliance findings above on purpose: that tab
  // prices AARS pillar B and counts as `complianceGaps`, and a classification finding
  // folded into it would inflate both.
  [TABS.dataFindings]: ["id", "resource_id", "name", "severity"],
  [TABS.syncHistory]: [
    "sync_id", "started_at", "finished_at", "status", "mode",
    "node_count", "edge_count", "issue_count", "api_calls", "snapshot_ref", "error",
    "aars_severity_json", "aars_rule_version",
  ],
  [TABS.settings]: ["key", "value_json"],
  [TABS.jobs]: [
    "job_id", "kind", "phase", "sync_id", "step_index", "cursor", "page",
    "nodes_so_far", "total_count", "part_refs_json", "params_json", "error",
    "started_at", "updated_at",
  ],
  [TABS.meta]: ["version"],
};

export const SCHEMA_VERSION = 1;

let spreadsheetCache: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null;

export function ledgerSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  if (spreadsheetCache === null) {
    spreadsheetCache = SpreadsheetApp.openById(requireProp(PROP_KEYS.ledgerSpreadsheetId));
  }
  return spreadsheetCache;
}

export function sheet(tab: string): GoogleAppsScript.Spreadsheet.Sheet {
  const sh = ledgerSpreadsheet().getSheetByName(tab);
  if (!sh) throw new Error(`Missing tab ${tab} — run setup().`);
  return sh;
}

/** Create any missing tab with its frozen header row (idempotent). */
export function ensureTabs(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): void {
  // All timestamps are canonical ISO strings; the spreadsheet timezone must never
  // reinterpret them (and Sheets must not auto-coerce them into locale Dates).
  ss.setSpreadsheetTimeZone("Etc/UTC");
  for (const [tab, headers] of Object.entries(TAB_HEADERS)) {
    let sh = ss.getSheetByName(tab);
    if (!sh) {
      sh = ss.insertSheet(tab);
      // Plain-text format everywhere: ISO timestamps and JSON blobs round-trip
      // byte-stable instead of becoming Date cells in the sheet's locale.
      sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat("@");
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    } else {
      ensureHeaders(sh, tab); // append any headers a newer schema added
    }
  }
  const dflt = ss.getSheetByName("Sheet1");
  if (dflt && ss.getSheets().length > 1) ss.deleteSheet(dflt);
}

/** Cell -> JS value: '' -> null; Date -> canonical ISO; numbers/strings verbatim. */
function fromCell(v: unknown): unknown {
  if (v === "" || v === null || v === undefined) return null;
  // toIso, not a second copy of it: the same floor-to-seconds + strip-".000" expression
  // was written out here and in domain/util.ts.
  if (v instanceof Date) return toIso(v.getTime());
  return v;
}

/** JS value -> cell: null/undefined -> ''. */
function toCell(v: unknown): unknown {
  if (v === null || v === undefined) return "";
  return v;
}

/** All data rows of a tab as objects keyed by header name. */
export function readAll(tab: string): Rec[] {
  const sh = sheet(tab);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(String);
  const out: Rec[] = [];
  for (let i = 1; i < values.length; i++) {
    const row: Rec = {};
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

/**
 * Bring a tab's header row up to the declared schema, returning the headers to write by.
 *
 * Writes map by header NAME, so a column the sheet has never seen is silently dropped —
 * which is how a renamed column erases itself: the sync writes the new name into a sheet
 * that only has the old one, and every row loses the value. setup() adds new headers, but
 * an upgrade that doesn't re-run it would otherwise keep writing into a schema the sheet
 * no longer has. Only DECLARED columns are added, so a stray key on a row still can't
 * grow the sheet, and they go on the end, so existing column order is untouched.
 */
function ensureHeaders(sh: GoogleAppsScript.Spreadsheet.Sheet, tab: string): string[] {
  const width = Math.max(sh.getLastColumn(), 1);
  const existing = sh.getRange(1, 1, 1, width).getValues()[0].map(String).filter(Boolean);
  const missing = (TAB_HEADERS[tab] ?? []).filter((h) => !existing.includes(h));
  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  return [...existing, ...missing];
}

/**
 * Project rows onto the tab's headers and write them in ONE batched setValues.
 *
 * One call, never a loop: a per-row write is the classic way to blow the 6-minute
 * execution limit, and every write path in this file goes through here.
 */
function writeGrid(
  sh: GoogleAppsScript.Spreadsheet.Sheet, headers: string[], startRow: number, rows: Rec[],
): void {
  if (!rows.length) return;
  const grid = rows.map((r) => headers.map((h) => toCell(r[h])));
  const range = sh.getRange(startRow, 1, grid.length, headers.length);
  range.setNumberFormat("@"); // rows added beyond the original grid stay plain text
  range.setValues(grid);
}

/** Replace ALL data rows of a tab in one batched write. */
export function overwrite(tab: string, rows: Rec[]): void {
  const sh = sheet(tab);
  const headers = ensureHeaders(sh, tab);
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  writeGrid(sh, headers, 2, rows);
}

/** Append rows in one batched write. */
export function appendRows(tab: string, rows: Rec[]): void {
  if (!rows.length) return;
  const sh = sheet(tab);
  writeGrid(sh, ensureHeaders(sh, tab), sh.getLastRow() + 1, rows);
}

/** Data-row count of a tab (rows below the frozen header). */
export function dataRowCount(tab: string): number {
  return Math.max(0, sheet(tab).getLastRow() - 1);
}

/**
 * Update the first row where keyColumn === keyValue (returns false when absent).
 *
 * `patch` is partial: a key the patch omits keeps whatever the row already held, which is
 * what lets the sync checkpoint only the fields a hop actually advanced.
 *
 * Goes through `ensureHeaders` like every other write. It used to read the header row
 * directly and skip any patch key whose column was missing — the exact failure that
 * function's own comment describes, on the one write path that wasn't using it. A job
 * checkpointing into a tab written before a column existed lost that field silently.
 */
export function updateWhere(tab: string, keyColumn: string, keyValue: unknown, patch: Rec): boolean {
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

/** Total cell count across the spreadsheet (storage-stats surface). */
export function cellCount(): number {
  return ledgerSpreadsheet()
    .getSheets()
    .reduce((acc, sh) => acc + sh.getMaxRows() * sh.getMaxColumns(), 0);
}
