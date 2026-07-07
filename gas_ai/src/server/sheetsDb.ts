// Generic header-mapped tab access over the SIDEKICK AI spreadsheet.
//
// Row 1 of every tab is a frozen header; all reads/writes map columns BY HEADER NAME,
// never by index, so adding a column is non-breaking. Empty cells read as null; every
// write is one batched setValues call. Engine copied from the OS-vulns tool; only the
// tab schema differs — here the durable state is a graph snapshot (assets/edges/issues
// wholesale-rewritten per sync), not an append-only vulnerability ledger.

import { PROP_KEYS, requireProp } from "./props";
import type { Rec } from "../domain/util";

export const TABS = {
  assets: "ai_assets",
  edges: "ai_edges",
  issues: "ai_issues",
  syncHistory: "sync_history",
  settings: "settings",
  jobs: "jobs",
  meta: "meta",
} as const;

export const TAB_HEADERS: Record<string, string[]> = {
  [TABS.assets]: [
    "id", "kind", "name", "native_type", "cloud", "region", "status",
    "account_id", "account_name", "projects_json", "first_seen", "last_seen",
    "internet", "sensitive_data", "sensitive_access", "high_priv", "admin_priv",
    "guardrail_missing", "severity", "aars", "aars_band", "aars_pillars_json",
    "combo_groups", "tags_json",
  ],
  [TABS.edges]: ["id", "src", "dst", "type", "negated", "access_type"],
  [TABS.issues]: [
    "id", "rule_id", "rule_name", "combo_group", "native_severity", "adjusted_severity",
    "status", "asset_id", "asset_name", "region", "account", "projects_json",
    "frameworks_json", "justification", "created_at",
  ],
  [TABS.syncHistory]: [
    "sync_id", "started_at", "finished_at", "status", "mode",
    "node_count", "edge_count", "issue_count", "api_calls", "snapshot_ref", "error",
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
      // Append any headers a newer schema added (order-safe: appended last).
      const width = Math.max(sh.getLastColumn(), 1);
      const existing = sh.getRange(1, 1, 1, width).getValues()[0]
        .map(String)
        .filter((h) => h !== "");
      const missing = headers.filter((h) => !existing.includes(h));
      if (missing.length) {
        sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      }
    }
  }
  const dflt = ss.getSheetByName("Sheet1");
  if (dflt && ss.getSheets().length > 1) ss.deleteSheet(dflt);
}

/** Cell -> JS value: '' -> null; Date -> canonical ISO; numbers/strings verbatim. */
function fromCell(v: unknown): unknown {
  if (v === "" || v === null || v === undefined) return null;
  if (v instanceof Date) {
    return new Date(Math.floor(v.getTime() / 1000) * 1000)
      .toISOString()
      .replace(".000Z", "Z");
  }
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

/** Replace ALL data rows of a tab in one batched write. */
export function overwrite(tab: string, rows: Rec[]): void {
  const sh = sheet(tab);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(Boolean);
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (!rows.length) return;
  const grid = rows.map((r) => headers.map((h) => toCell(r[h])));
  const range = sh.getRange(2, 1, grid.length, headers.length);
  range.setNumberFormat("@"); // rows added beyond the original grid stay plain text
  range.setValues(grid);
}

/** Append rows in one batched write. */
export function appendRows(tab: string, rows: Rec[]): void {
  if (!rows.length) return;
  const sh = sheet(tab);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(Boolean);
  const grid = rows.map((r) => headers.map((h) => toCell(r[h])));
  const range = sh.getRange(sh.getLastRow() + 1, 1, grid.length, headers.length);
  range.setNumberFormat("@");
  range.setValues(grid);
}

/** Data-row count of a tab (rows below the frozen header). */
export function dataRowCount(tab: string): number {
  return Math.max(0, sheet(tab).getLastRow() - 1);
}

/** Update the first row where keyColumn === keyValue (returns false when absent). */
export function updateWhere(tab: string, keyColumn: string, keyValue: unknown, patch: Rec): boolean {
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

/** Total cell count across the spreadsheet (storage-stats surface). */
export function cellCount(): number {
  return ledgerSpreadsheet()
    .getSheets()
    .reduce((acc, sh) => acc + sh.getMaxRows() * sh.getMaxColumns(), 0);
}
