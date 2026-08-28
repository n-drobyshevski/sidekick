// The ledger and the scan log, on and off the sheet.
//
// No new storage engine: `sheetsDb` already maps columns BY HEADER NAME, so the three audit
// columns added for the secrets twin fold ride along without a migration and a tab that
// predates a column receives it on the next write (`ensureHeaders`).
//
// What this file does own is the TYPE BOUNDARY. A Sheet gives back strings, and the domain
// layer is written against `boolean | null` and `number | null` — so `null`, `"TRUE"` and
// `""` all have to survive a round trip meaning what they meant. Coercing a blank cell to
// `false` here would undo the tri-state the whole register is built on, one layer below
// where anyone would look for it.

import { STATUS_OPEN, STATUS_RESOLVED } from "../domain/config";
import { LEDGER_COLUMNS, type LedgerRow, type ValidationState } from "../domain/observation";
import type { ScanRow } from "../domain/ledgerCore";
import { clean, type Rec } from "../domain/util";
import { appendRows, overwrite, readAll, TABS } from "./sheetsDb";

function str(v: unknown): string | null {
  const c = clean(v);
  return c === null ? null : String(c);
}

function num(v: unknown): number | null {
  const c = clean(v);
  if (c === null) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

/**
 * A stored boolean, tri-state preserved.
 *
 * The ledger grid is plain-text formatted (`ensureTabs` sets "@" on every cell) so a boolean
 * written with `setValues` reads back as the STRING "TRUE"/"FALSE". Anything else — a blank
 * cell, a column that did not exist when the row was written — is `null`, which means
 * "never evaluated" and must never become `false`. That collapse is what makes an unassessed
 * finding render as clean.
 */
function triBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toUpperCase();
    if (s === "TRUE") return true;
    if (s === "FALSE") return false;
  }
  return null;
}

function validation(v: unknown): ValidationState | null {
  const s = str(v);
  return s === "VALID" || s === "INVALID" || s === "ERROR" || s === "UNKNOWN" ? s : null;
}

/** One sheet row -> one ledger row. */
export function rowFromSheet(r: Rec): LedgerRow {
  return {
    finding_key: String(r["finding_key"] ?? ""),
    scope: (str(r["scope"]) ?? "sca") as LedgerRow["scope"],
    identifier: str(r["identifier"]),
    component: str(r["component"]),
    severity: str(r["severity"]) ?? "UNKNOWN",
    repo_id: str(r["repo_id"]),
    repo_name: str(r["repo_name"]),
    branch: str(r["branch"]),
    platform: str(r["platform"]),
    first_seen: str(r["first_seen"]),
    last_seen: str(r["last_seen"]),
    status: str(r["status"]) === STATUS_RESOLVED ? STATUS_RESOLVED : STATUS_OPEN,
    resolved_at: str(r["resolved_at"]),
    resolution_src: str(r["resolution_src"]),
    reopened_count: num(r["reopened_count"]) ?? 0,
    first_scan_id: str(r["first_scan_id"]),
    last_scan_id: str(r["last_scan_id"]),
    fix_date: str(r["fix_date"]),
    fix_observed_at: str(r["fix_observed_at"]),
    fixed_version: str(r["fixed_version"]),
    has_kev: triBool(r["has_kev"]),
    has_exploit: triBool(r["has_exploit"]),
    epss: num(r["epss"]),
    risk_observed_at: str(r["risk_observed_at"]),
    cwe: str(r["cwe"]),
    language: str(r["language"]),
    file_path: str(r["file_path"]),
    start_line: num(r["start_line"]),
    origin: str(r["origin"]),
    secret_kind: str(r["secret_kind"]),
    confidence: str(r["confidence"]),
    rotated_at: str(r["rotated_at"]),
    removed_at: str(r["removed_at"]),
    validation_state: validation(r["validation_state"]),
    validated_at: str(r["validated_at"]),
    twin_count: num(r["twin_count"]),
    twin_first_seen_spread_days: num(r["twin_first_seen_spread_days"]),
    source_external_ids: str(r["source_external_ids"]),
    owner_project: str(r["owner_project"]),
    owner_path: str(r["owner_path"]),
    tags_json: str(r["tags_json"]),
  };
}

/** One ledger row -> one sheet row, columns in schema order. */
export function rowToSheet(row: LedgerRow): Rec {
  const out: Rec = {};
  for (const col of LEDGER_COLUMNS) out[col] = (row as unknown as Rec)[col] ?? null;
  return out;
}

/** The whole ledger, keyed by finding_key — the shape reconcile takes. */
export function readLedger(): Record<string, LedgerRow> {
  const out: Record<string, LedgerRow> = {};
  for (const r of readAll(TABS.ledger)) {
    const row = rowFromSheet(r);
    if (row.finding_key) out[row.finding_key] = row;
  }
  return out;
}

/**
 * Replace the ledger tab wholesale.
 *
 * `overwrite`, not a per-row patch, and the reason is the disappearance pass: a scan can
 * change any row in the scope it covers, including ones it never observed. Diffing to find
 * which rows moved would be more code and more chances to miss one, on a tab whose whole
 * point is that it is the durable answer.
 */
export function writeLedger(ledger: Record<string, LedgerRow>): void {
  overwrite(TABS.ledger, Object.values(ledger).map(rowToSheet));
}

/** The scan log, oldest-first as stored. */
export function readScans(): ScanRow[] {
  return readAll(TABS.scans).map((r) => ({
    scan_id: String(r["scan_id"] ?? ""),
    ts: String(r["ts"] ?? ""),
    scope: String(r["scope"] ?? ""),
    mode: String(r["mode"] ?? ""),
    severities: String(r["severities"] ?? ""),
    new_count: Number(r["new_count"] ?? 0),
    resolved_count: Number(r["resolved_count"] ?? 0),
    reopened_count: Number(r["reopened_count"] ?? 0),
  }));
}

/**
 * Append one scan to the log.
 *
 * `severities` is stored as the empty string for an ungated scan, and `parseSeverities`
 * reads that back as "covered everything" rather than "covered nothing" — the difference
 * between the secrets register resolving normally and never resolving at all.
 */
export function appendScan(row: {
  scan_id: string;
  ts: string;
  scope: string;
  mode: string;
  severities: readonly string[] | null;
  total: number;
  new_count: number;
  resolved_count: number;
  reopened_count: number;
  /**
   * The Drive folder holding the raw pages this scan was reconciled from, when there is one.
   *
   * A sample scan has none. A live one does, and recording it is what lets a later question
   * about a figure be answered from what the tenant actually returned rather than from the
   * ledger's own account of it.
   */
  raw_ref?: string | null;
}): void {
  appendRows(TABS.scans, [{
    scan_id: row.scan_id,
    ts: row.ts,
    scope: row.scope,
    mode: row.mode,
    severities: row.severities === null || !row.severities.length ? "" : row.severities.join(","),
    total: row.total,
    new_count: row.new_count,
    resolved_count: row.resolved_count,
    reopened_count: row.reopened_count,
    raw_ref: row.raw_ref ?? null,
    sealed: false,
  }]);
}
