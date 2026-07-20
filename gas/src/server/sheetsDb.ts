// Generic header-mapped tab access over the ledger spreadsheet.
//
// Row 1 of every tab is a frozen header; all reads/writes map columns BY HEADER NAME,
// never by index, so adding a column is non-breaking (the Sheets analog of the SQLite
// ALTER-TABLE migrations). Empty cells read as null; every write is one batched
// setValues call.

import { PROP_KEYS, requireProp } from "./props";
import type { Rec } from "../domain/util";

export const TABS = {
  scans: "scans",
  vulnLedger: "vuln_ledger",
  episodes: "resolved_episodes",
  compactions: "compactions",
  settings: "settings",
  supportGroupMap: "support_group_map",
  mttrHistory: "mttr_history",
  schemaMeta: "schema_meta",
  jobs: "jobs",
} as const;

export const TAB_HEADERS: Record<string, string[]> = {
  [TABS.scans]: [
    "scan_id", "ts", "mode", "shape", "total", "new_count", "resolved_count",
    "reopened_count", "raw_ref", "obs_ref", "severities", "sealed",
  ],
  [TABS.vulnLedger]: [
    "vuln_key", "cve", "severity", "asset_id", "asset_name", "asset_type", "cloud",
    "first_seen", "last_seen", "status", "resolved_at", "resolution_src",
    "reopened_count", "first_scan_id", "last_scan_id",
    "subscription_name", "subscription_ext_id", "tags_json",
    "fix_date", "fix_observed_at",
  ],
  [TABS.episodes]: [
    "vuln_key", "cve", "severity", "first_seen", "resolved_at", "resolution_src",
    "reopened_count", "compaction_id", "superseded_by_scan",
    "fix_date", "fix_observed_at",
  ],
  [TABS.compactions]: [
    "compaction_id", "ts", "floor_scan_id", "floor_ts", "scans_sealed",
    "episodes_created", "observations_pruned", "archive_bytes_freed",
    "db_bytes_freed", "checkpoint_ref",
  ],
  [TABS.settings]: ["key", "value_json"],
  // One tiny row per subscription-identity → support-group entry. Deliberately NOT a single
  // JSON blob in a settings cell: a large map (hundreds of subscriptions × several identity
  // tokens each) overflows the ~50k-char Sheets per-cell limit and the whole write throws.
  [TABS.supportGroupMap]: ["token", "group"],
  [TABS.mttrHistory]: [
    "date", "median_days", "resolved", "open", "total", "sla_pct", "oldest_open_days",
    "open_past_sla",
  ],
  [TABS.schemaMeta]: ["version"],
  [TABS.jobs]: [
    "job_id", "kind", "phase", "scan_id", "cursor", "page", "findings_so_far",
    "page_size", "total_count", "params_json", "journal_ref", "error",
    "started_at", "updated_at",
  ],
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

/**
 * Create one tab with its frozen header row if it's missing (idempotent). Self-healing for
 * deployments that predate a newly-added tab, so a schema addition doesn't require re-running
 * setup() before the new tab can be read or written. Mirrors ensureTabs' per-tab shape.
 */
export function ensureTab(tab: string): void {
  const ss = ledgerSpreadsheet();
  if (ss.getSheetByName(tab)) return;
  const headers = TAB_HEADERS[tab];
  if (!headers) throw new Error(`No headers defined for tab ${tab}.`);
  const sh = ss.insertSheet(tab);
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat("@");
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
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

/** Clear every data row past the first `keepDataRows` (header is row 1). Used to roll an
 * append-based writer back to its last committed count for exactly-once resume. */
export function truncateAfter(tab: string, keepDataRows: number): void {
  const sh = sheet(tab);
  const lastRow = sh.getLastRow();
  const firstToClear = keepDataRows + 2; // +1 header, +1 to start past the kept rows
  if (lastRow >= firstToClear) {
    const lastCol = Math.max(sh.getLastColumn(), 1);
    sh.getRange(firstToClear, 1, lastRow - firstToClear + 1, lastCol).clearContent();
  }
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
