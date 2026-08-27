// Generic header-mapped tab access over the Sidekick DevSecOps spreadsheet.
//
// Row 1 of every tab is a frozen header; all reads/writes map columns BY HEADER NAME,
// never by index, so adding a column is non-breaking — writes bring the header row up to
// the declared schema first (see ensureHeaders), so a tab that predates a column receives
// it instead of dropping the value. Empty cells read as null; every
// write is one batched setValues call. Engine copied from the OS-vulns tool; only the
// tab schema differs — here the durable state is an APPEND-ONLY finding ledger keyed by
// finding_key, merged per scan, because remediation in this register is usually a row
// quietly disappearing rather than an API status change.

import { PROP_KEYS, requireProp } from "./props";
import { toIso, type Rec } from "../domain/util";

export const TABS = {
  // The ledger. One row per finding_key, MERGED per scan and never truncated — the only
  // non-append table here. Carries all three scopes; `scope` is part of the identity.
  ledger: "finding_ledger",
  // Sealed lifecycles, compacted out of the ledger once their scan is sealed.
  episodes: "resolved_episodes",
  // The scan log, and it is load-bearing: it makes a re-run of one scan a no-op, it records
  // WHICH severities each scan actually covered (so a severity that was not requested is
  // never resolved-by-disappearance), and its first row dates the observation window.
  scans: "scans",
  // Repositories and their owning project hierarchy — the register's asset dimension.
  repos: "repos",
  compactions: "compactions",
  settings: "settings",
  jobs: "jobs",
  meta: "schema_meta",
} as const;

export const TAB_HEADERS: Record<string, string[]> = {
  // Three update disciplines coexist here and they are NOT interchangeable — the same
  // split brick/devsecops arrived at, and the reason its ledger tests read the way they do:
  //   latest-wins            severity, status, the asset columns
  //   sticky-first-wins      fix_date / fix_observed_at, reset only by a reopen
  //   monotone, never reset  has_kev / has_exploit (null -> false -> true), epss keeps the peak
  [TABS.ledger]: [
    "finding_key", "scope", "identifier", "component", "severity",
    "repo_id", "repo_name", "branch", "platform",
    "first_seen", "last_seen", "status", "resolved_at", "resolution_src",
    "reopened_count", "first_scan_id", "last_scan_id",
    // The second clock's inputs. Written from day one even though nothing derives
    // fix_available_at yet — capturing them later would leave a hole no backfill can close.
    "fix_date", "fix_observed_at", "fixed_version",
    // Tri-state forever: Wiz returns null for a signal it never evaluated, and collapsing
    // that to false is what makes an unassessed finding look clean.
    "has_kev", "has_exploit", "epss", "risk_observed_at",
    // SAST-shaped columns; null for an SCA row and vice versa. One ledger, three scopes.
    "cwe", "language", "file_path", "start_line", "origin",
    // Secrets carry their own lifecycle: removal from HEAD is not rotation.
    //
    // FOUR COLUMNS, NOT TWO, and the extra pair is not optional. `rotated_at IS NULL`
    // cannot tell a credential that is still live from one nobody has ever checked, and in
    // this tenant 393,443 of 394,927 secret instances have validationStatus UNKNOWN —
    // 99.6% never checked. Publishing that null as "not rotated" would be the absent-is-
    // never-zero failure at scale, so the state travels in its own column:
    //
    //   validation_state  UNKNOWN | VALID | INVALID | ERROR, from SecretInstanceValidationStatus.
    //                     VALID means the credential still works — a live secret, measured.
    //                     INVALID means it does not — dead, and the evidence for rotation.
    //                     UNKNOWN / ERROR mean unmeasured, which is neither.
    //   validated_at      when that check was last made (lastValidatedAt), so a stale VALID
    //                     can be told from a fresh one.
    //
    // rotated_at then means "the credential was observed dead at this time" and is set from
    // validated_at only where validation_state is INVALID. removed_at is the other axis
    // entirely: the string left HEAD. PROBE_FINDINGS.md §3.
    "secret_kind", "rotated_at", "removed_at", "validation_state", "validated_at",
    "owner_project", "owner_path", "tags_json",
  ],
  [TABS.episodes]: [
    "finding_key", "scope", "identifier", "component", "severity",
    "first_seen", "resolved_at", "resolution_src", "reopened_count",
    "compaction_id", "superseded_by_scan",
    "fix_date", "fix_observed_at", "has_kev", "has_exploit", "epss",
    "cwe", "language", "owner_project",
  ],
  [TABS.scans]: [
    "scan_id", "ts", "scope", "mode", "severities", "total",
    "new_count", "resolved_count", "reopened_count", "raw_ref", "sealed",
  ],
  [TABS.repos]: [
    "repo_id", "repo_name", "branch", "platform", "default_branch",
    "owner_project", "owner_path", "projects_json", "first_seen", "last_seen",
  ],
  [TABS.compactions]: [
    "compaction_id", "ts", "floor_scan_id", "floor_ts", "scans_sealed",
    "episodes_created", "archive_bytes_freed", "checkpoint_ref",
  ],
  [TABS.settings]: ["key", "value_json"],
  [TABS.jobs]: [
    "job_id", "kind", "phase", "scan_id", "scope", "cursor", "page",
    "findings_so_far", "page_size", "total_count", "params_json", "journal_ref",
    "error", "started_at", "updated_at",
  ],
  [TABS.meta]: ["version"],
};

export const SCHEMA_VERSION = 1;

let spreadsheetCache: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null;

/**
 * Drop this module's per-execution memos.
 *
 * Test-only. In GAS these memos die with the execution, so nothing in production ever needs
 * to clear them; under vitest the module registry outlives a test, and `test/gasEnv.ts`
 * calls this so a shared server can be reset without re-importing the whole graph. See the
 * comment on `resetToSynced` there.
 */
export function __resetMemosForTest(): void {
  spreadsheetCache = null;
}


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

/**
 * Cells one `getValues()` may ask for.
 *
 * Sheets caps the RESPONSE, not the sheet. A tab is free to grow to the spreadsheet's 10M
 * cell ceiling, but one read that tries to carry all of it back is refused outright — "the
 * data requested exceeds the maximum size allowed", in the script owner's locale, thrown
 * before a single row arrives.
 *
 * That is not a hypothetical. On a real tenant every page that read `ai_findings` — the
 * inventory, priorities, the configuration register and compliance posture — failed with
 * exactly that, while every page that did not (toxic combinations, the graph, this page's
 * own storage stats) rendered normally. a 13,788-row × 48-column tab came back
 * without complaint in the same execution, which is what made it legible: the service was
 * not refusing reads, it was refusing ONE range, because that tab had outgrown a single
 * response and nothing here had ever asked for less than all of it.
 *
 * 200,000 is chosen against that measurement rather than against a documented number, which
 * Google does not publish: the assets read that WORKS is ~662,000 cells, so a third of the
 * nearest known-good figure leaves room for rows carrying much longer text than an asset
 * row does — and the halving below makes the constant a starting point rather than a bet.
 *
 * Blocks, not a paged register. The cap is on the transport, so the cure belongs at the
 * read: the same rows come back, in several responses instead of one, and every caller and
 * every read model above is untouched. Sizing the LEDGER to fit one response would be a
 * different product (and the Data page's prune panel is where that decision already lives).
 */
export const READ_BLOCK_CELLS = 200_000;

/**
 * A tab's grid, in as many reads as it takes.
 *
 * The halving is the same shape as wizClientAi's page-size fallback, and for the same
 * reason: a budget that turns out to be too generous must cost one retry, not a dead page.
 * A block that is refused is re-asked SMALLER rather than skipped — a read that silently
 * returned fewer rows than the tab holds would put a short register in front of an analyst
 * with nothing to say it was short, which on a security ledger is the worst outcome
 * available. Once halved the smaller block is kept for the rest of the tab: the service has
 * already said what it will not carry, and re-asking the generous size at every block would
 * pay for that answer again per block.
 *
 * It halves BLINDLY, where wizClientAi is careful to retry only failures a smaller ask could
 * fix. The difference is that its verdicts arrive as HTTP codes and stable English envelopes,
 * and these arrive as a localized sentence — the tenant this was written for got the size
 * error in French. Any `/exceeds the maximum/` test would have read that as a failure worth
 * no retry and left the page dead in exactly the locale that reported the bug. Halving costs
 * at most a dozen fast rejections before the rethrow, which is the cheaper mistake.
 *
 * When even a single row will not come back the failure is rethrown NAMING the tab and the
 * row it stopped at, because Google's own message says neither, and "which tab" is the
 * entire diagnosis.
 */
function readGrid(
  sh: GoogleAppsScript.Spreadsheet.Sheet,
  tab: string,
  lastRow: number,
  lastCol: number,
): unknown[][] {
  const out: unknown[][] = [];
  let block = Math.max(1, Math.floor(READ_BLOCK_CELLS / Math.max(1, lastCol)));
  let row = 1;
  while (row <= lastRow) {
    const take = Math.min(block, lastRow - row + 1);
    try {
      for (const values of sh.getRange(row, 1, take, lastCol).getValues()) out.push(values);
      row += take;
    } catch (e) {
      if (take <= 1) {
        throw new Error(
          `Reading ${tab} stopped at row ${row} of ${lastRow} (${lastCol} columns): ` +
          `${e instanceof Error ? e.message : String(e)}`,
        );
      }
      block = Math.floor(take / 2);
    }
  }
  return out;
}

/**
 * Data rows as objects keyed by header name, skipping wholly-empty rows.
 *
 * Shared by `readAll` and `readTail` so the two cannot drift in how they coerce a cell or
 * decide a row is empty. `headers` names column i+1 by position and a blank header skips
 * that column rather than compacting it — see `ensureHeaders` for why that alignment is
 * load-bearing.
 */
function mapRows(headers: string[], rows: unknown[][]): Rec[] {
  const out: Rec[] = [];
  for (const values of rows) {
    const row: Rec = {};
    let empty = true;
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (!h) continue;
      const v = fromCell(values[j]);
      row[h] = v;
      if (v !== null) empty = false;
    }
    if (!empty) out.push(row);
  }
  return out;
}

/** All data rows of a tab as objects keyed by header name. */
export function readAll(tab: string): Rec[] {
  const sh = sheet(tab);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const values = readGrid(sh, tab, lastRow, lastCol);
  return mapRows(values[0]!.map(String), values.slice(1));
}

/**
 * The LAST `n` data rows of a tab, for a caller that only ever wants recent ones.
 *
 * Two small `getValues` calls — the header row, then a bounded window at the bottom —
 * instead of one over the whole grid. The motivating caller is the progress poll: it runs
 * every three seconds against the `jobs` tab, which gains a row per sync and is never
 * trimmed, so a full read there gets more expensive for the life of the deployment while
 * always answering about a job appended moments ago.
 *
 * Headers are re-read on every call rather than memoized, because the write path
 * (`ensureHeaders`) can append a column between two reads and a stale header list would
 * silently misname every value after the new one.
 *
 * IT IS NOT A SUBSTITUTE FOR `readAll` AND CALLERS MUST NOT TREAT IT AS ONE. A row outside
 * the window is absent, not missing — so any caller whose "not found" means something has to
 * fall back to the full read before believing it. `jobsStore.getJob` does exactly that.
 */
export function readTail(tab: string, n: number): Rec[] {
  const sh = sheet(tab);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0]!.map(String);
  const first = Math.max(2, lastRow - Math.max(1, n) + 1);
  const values = sh.getRange(first, 1, lastRow - first + 1, lastCol).getValues();
  return mapRows(headers, values);
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
 *
 * A BLANK HEADER BETWEEN TWO NAMED ONES IS REFUSED, loudly, rather than worked around.
 *
 * This used to compact row 1 with `.filter(Boolean)`, which quietly broke the one thing the
 * whole name-mapping scheme rests on: that the header at index i names column i+1. `readAll`
 * does not compact — it keeps positions and skips blanks — so after a gap the two disagreed
 * about where every subsequent column lived. Writes landed one column to the LEFT of where the
 * next read looked, and the value read back `null`: indistinguishable from a field the tenant
 * never reported. Every write path reaches this function, so it was not one endpoint's problem,
 * and nothing anywhere raised a word about it.
 *
 * Only a hand-edited sheet can produce the state — clearing a header, or inserting a column and
 * not naming it — so refusing costs a healthy ledger nothing. Accommodating it is what turns a
 * five-second manual fix into a register full of nulls nobody can date.
 *
 * Trailing blanks are a different thing and stay legal: row 1's range is read out to the
 * SHEET's last column, so a tab whose data rows run wider than its headers pads on the right.
 * Those carry no data and shift nothing.
 */
function ensureHeaders(sh: GoogleAppsScript.Spreadsheet.Sheet, tab: string): string[] {
  const width = Math.max(sh.getLastColumn(), 1);
  const raw = sh.getRange(1, 1, 1, width).getValues()[0].map(String);

  let lastNamed = -1;
  for (let i = 0; i < raw.length; i++) if (raw[i]) lastNamed = i;
  for (let i = 0; i < lastNamed; i++) {
    if (raw[i]) continue;
    throw new Error(
      `Tab "${tab}" has a blank header at column ${i + 1}, between named columns `
      + `("${raw.slice(0, i).filter(Boolean).pop() ?? "?"}" and "${raw[lastNamed]}"). `
      + "Every read and write maps columns by header name, so a gap silently misfiles every "
      + "value after it. Name the column or delete it, then retry — no data was written.",
    );
  }

  // Equivalent to the old filter for every healthy sheet: with no interior gap, dropping the
  // trailing blanks is the only thing the filter was doing.
  const existing = raw.slice(0, lastNamed + 1);
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
 * How many empty rows a shrunken tab keeps in hand before `trimSurplusRows` reclaims any.
 *
 * Not zero, on purpose. `cellCount()` below prices the ALLOCATED grid, so a tab that fell
 * from 14,000 rows to 2,000 is still charged for 14,000 until the surplus is deleted — but
 * trimming it flush would leave every subsequent write growing the grid a row at a time from
 * nothing. A buffer this size leaves the tab in the same shape a freshly created one is in,
 * which is the shape every write path here was already built against.
 */
export const TRIM_BUFFER_ROWS = 1000;

/**
 * Delete the empty grid rows left behind when a tab is rewritten much smaller, and return
 * how many went.
 *
 * `overwrite` clears content but never shrinks the grid, and `cellCount()` prices
 * `getMaxRows() * getMaxColumns()` — the allocation, not the contents. So without this a
 * prune can delete four rows in five and the storage figure on the Data page does not move,
 * which reads as "nothing happened" rather than as "the ceiling is priced differently than
 * you think".
 *
 * Deliberately NOT the sibling tool's `truncateAfter`: that one clears content, which is
 * what a resumable append needs and is exactly the half that does not help here.
 */
export function trimSurplusRows(tab: string, bufferRows: number = TRIM_BUFFER_ROWS): number {
  const sh = sheet(tab);
  // At least one row has to survive, and the header is the row worth surviving.
  const keep = Math.max(sh.getLastRow(), 1) + Math.max(0, bufferRows);
  const surplus = sh.getMaxRows() - keep;
  if (surplus <= 0) return 0;
  sh.deleteRows(keep + 1, surplus);
  return surplus;
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
  // Through readGrid like readAll, not because `jobs` and `sync_history` are large today
  // but because this is the same whole-tab range asked the same way: leaving one of the two
  // call sites on a single unbounded read is how the fix comes undone the first time a tab
  // this touches grows.
  const values = readGrid(sh, tab, lastRow, lastCol);
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

/**
 * One tab's ALLOCATED grid — what `cellCount()` below is actually pricing for it.
 *
 * Exists so a prune can project what trimming would reclaim before it writes anything: the
 * preview has to be able to say the storage figure will move, and the only honest way to say
 * that is to do the same arithmetic the figure itself does.
 */
export function gridSize(tab: string): { rows: number; cols: number } {
  const sh = sheet(tab);
  return { rows: sh.getMaxRows(), cols: sh.getMaxColumns() };
}

/** Total cell count across the spreadsheet (storage-stats surface). */
export function cellCount(): number {
  return ledgerSpreadsheet()
    .getSheets()
    .reduce((acc, sh) => acc + sh.getMaxRows() * sh.getMaxColumns(), 0);
}
