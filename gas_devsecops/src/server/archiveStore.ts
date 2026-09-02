// Drive storage: raw scan page archives, per-scan observations, the ledger snapshot fast
// path, pre-rewrite journal backups, and the durable read-model second level.
//
// One sync mints a syncId; scanId = "<syncId>-<scope>" with scope in sca | sast | secrets, so
// a three-scope sync writes three scan folders. Layout under the ARCHIVE_FOLDER_ID root:
//   scans/<scanId>/page-NNNN.json.gz    raw API pages, zero-padded 4 digits
//   scans/<scanId>/slim.json.gz         slimmed records for reconcile
//   scans/<scanId>/pageruns.json.gz     per-page timing/count log
//   obs/<scanId>.json.gz                observation set: the finding_keys this scan saw
//   snapshots/ledger-snapshot.json.gz   typed LedgerState fast path, rewritten every write —
//                                       ONE file, latest wins (see the note below)
//   backups/backup-<jobId>.json.gz      pre-rewrite journal — locks.ts's rollback contract
//   readmodels/                         durable L2 under CacheService — see readModelStore.ts,
//                                       whose contract this file leaves untouched
//   checkpoints/                        RESERVED for compaction; create-on-demand only (no
//                                       typed API — nothing compacts yet)
//   history/<YYYY-MM-DD>.json.gz        one ledger-stats snapshot per UTC day — historyStore.ts

import { PROP_KEYS, requireProp } from "./props";

// `LedgerState` is D1's type (src/domain/ledgerTypes.ts): scans and episodes are arrays,
// `ledger` is keyed by finding_key. This module only relies on that outer shape — it never
// reads a row — which is exactly what `looksLikeLedgerState` below checks on the way in.
import type { LedgerState } from "../domain/ledgerTypes";
export type { LedgerState };

/** Structural check for `readLedgerSnapshot`/`readBackup`: arrays for scans/episodes, a
 *  keyed object (not an array) for ledger. Not a type predicate — `LedgerState` carries no
 *  index signature, so it cannot narrow a `Record<string, unknown>` — callers cast after. */
function looksLikeLedgerState(v: Record<string, unknown>): boolean {
  return (
    Array.isArray(v["scans"]) &&
    Array.isArray(v["episodes"]) &&
    typeof v["ledger"] === "object" &&
    v["ledger"] !== null &&
    !Array.isArray(v["ledger"])
  );
}

// "readmodels" holds the durable second level under the CacheService read-model cache —
// see readModelStore.ts, which imports `subfolder`/`readGzJsonNamed`/`listNames`/`trashNamed`/
// `writeGzJson` by name; their signatures below are unchanged from what it already relies on.
const SUBFOLDERS = [
  "scans",
  "obs",
  "snapshots",
  "backups",
  "readmodels",
  "checkpoints",
  "history",
] as const;
export type Subfolder = (typeof SUBFOLDERS)[number];

// Per-execution folder handles. Resolving one is not free — costs a Script Property read, a
// getFolderById and two getFoldersByName — and a scan write touches its folder once per page,
// so memoizing keeps a multi-page fetch from rediscovering the same folder on every call. The
// memo lasts exactly one execution: in GAS it dies with the request; under vitest
// `__resetMemosForTest()` (called by `test/gasEnv.ts`, or by hand until that lands) clears it
// so a shared module registry does not leak a folder handle from one test into the next.
let rootFolderMemo: GoogleAppsScript.Drive.Folder | undefined;
const subfolderMemo = new Map<string, GoogleAppsScript.Drive.Folder>();
const scanFolderMemo = new Map<string, GoogleAppsScript.Drive.Folder>();

/**
 * Drop this module's per-execution memos.
 *
 * Test-only. In GAS these memos die with the execution, so nothing in production ever needs
 * to clear them; under vitest the module registry outlives a test.
 */
export function __resetMemosForTest(): void {
  forgetFolders();
}

/** Drop the memos — for `ensureFolders`, which may have just created what they cached. */
function forgetFolders(): void {
  rootFolderMemo = undefined;
  subfolderMemo.clear();
  scanFolderMemo.clear();
}

function rootFolder(): GoogleAppsScript.Drive.Folder {
  if (!rootFolderMemo) {
    rootFolderMemo = DriveApp.getFolderById(requireProp(PROP_KEYS.archiveFolderId));
  }
  return rootFolderMemo;
}

function childFolder(
  parent: GoogleAppsScript.Drive.Folder,
  name: string,
): GoogleAppsScript.Drive.Folder {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

export function subfolder(name: Subfolder): GoogleAppsScript.Drive.Folder {
  const hit = subfolderMemo.get(name);
  if (hit) return hit;
  const folder = childFolder(rootFolder(), name);
  subfolderMemo.set(name, folder);
  return folder;
}

/** Create the folder skeleton (idempotent); returns the root folder id. */
export function ensureFolders(rootId?: string): string {
  // Forget first AND after: this runs during setup(), where the root property may have just
  // been written (so a memo from before it would be stale) and where the subfolders may not
  // have existed yet (so a memo from during it would be a handle to something just created
  // under a different parent).
  forgetFolders();
  const root = rootId ? DriveApp.getFolderById(rootId) : rootFolder();
  for (const name of SUBFOLDERS) childFolder(root, name);
  forgetFolders();
  return root.getId();
}

function safeName(id: string): string {
  return id.replace(/[^0-9A-Za-z._-]/g, "") || "scan";
}

// ---------------------------------------------------------------- gzip JSON files
export function writeGzJson(
  folder: GoogleAppsScript.Drive.Folder,
  name: string,
  payload: unknown,
): GoogleAppsScript.Drive.File {
  const json = JSON.stringify(payload);
  const blob = Utilities.gzip(Utilities.newBlob(json, "application/json"), name);
  // Replace any existing file of the same name first — a re-run must not leave two files
  // sharing one name; the name IS the key everywhere this store is read.
  const existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);
  return folder.createFile(blob);
}

function parseGzBlob(blob: GoogleAppsScript.Base.Blob, name: string): unknown {
  const bytes = blob.getBytes();
  const isGzip = bytes.length > 2 && (bytes[0] & 0xff) === 0x1f && (bytes[1] & 0xff) === 0x8b;
  const text = isGzip
    ? Utilities.ungzip(blob).getDataAsString("UTF-8")
    : blob.getDataAsString("UTF-8");
  try {
    return JSON.parse(text);
  } catch (e) {
    // Absence is a null; corruption is not — a byte-mangled archive file must not be
    // indistinguishable from one that was never written, so this throws rather than warning
    // and returning null the way the old sync-page reader used to.
    throw new Error(`Unparseable archive file ${name}: ${e}`);
  }
}

/**
 * A gzipped JSON file by NAME within a Drive folder, or `null` when there is none.
 * Throws — naming the file — when the content cannot be parsed as JSON.
 */
export function readGzJson(folder: GoogleAppsScript.Drive.Folder, name: string): unknown | null {
  const it = folder.getFilesByName(name);
  if (!it.hasNext()) return null;
  return parseGzBlob(it.next().getBlob(), name);
}

/**
 * A gzipped JSON file by NAME within a subfolder, or null when there is none.
 *
 * By subfolder name rather than a Folder handle because the durable read-model store
 * addresses its files this way: the name IS the key, so there is no folder handle to thread
 * through it.
 */
export function readGzJsonNamed(folder: Subfolder, name: string): unknown | null {
  return readGzJson(subfolder(folder), name);
}

/** Every file name in a subfolder. The input to a sweep. */
export function listNames(folder: Subfolder): string[] {
  const out: string[] = [];
  const it = subfolder(folder).getFiles();
  while (it.hasNext()) out.push(it.next().getName());
  return out;
}

/** Trash every file of this name in a subfolder. Idempotent; silent when there is none. */
export function trashNamed(folder: Subfolder, name: string): void {
  const it = subfolder(folder).getFilesByName(name);
  while (it.hasNext()) it.next().setTrashed(true);
}

/**
 * Empty the durable read-model folder.
 *
 * For a future `resetData`: a reset bumps the version, so every entry is already
 * unreachable — but reset should mean reset rather than "unreachable and still on disk".
 */
export function trashReadModels(): void {
  for (const name of listNames("readmodels")) trashNamed("readmodels", name);
}

// ------------------------------------------------------------------- raw scan pages
function pageFileName(pageIndex: number): string {
  return `page-${String(pageIndex).padStart(4, "0")}.json.gz`;
}

const PAGE_NAME_RE = /^page-\d{4}\.json\.gz$/;

/**
 * The Drive folder holding one scan's files — pages, slim records, page runs — created on
 * demand. The returned handle carries a Drive folder id: NEVER forward that id to a client
 * payload, it is an internal storage address and the client already has `scanId`.
 */
export function scanFolder(scanId: string): GoogleAppsScript.Drive.Folder {
  const key = safeName(scanId);
  const hit = scanFolderMemo.get(key);
  if (hit) return hit;
  const folder = childFolder(subfolder("scans"), key);
  scanFolderMemo.set(key, folder);
  return folder;
}

/** Writes one raw API page. Returns the Drive file id — an internal storage address, never
 *  forward it to a client payload; pages are addressed by (scanId, pageIndex), not by id. */
export function writeScanPage(scanId: string, pageIndex: number, payload: unknown): string {
  return writeGzJson(scanFolder(scanId), pageFileName(pageIndex), payload).getId();
}

/**
 * Every raw page of a scan, in page-index order.
 *
 * Sorted explicitly BY NAME rather than trusted to Drive's own iteration order, which is not
 * guaranteed to be creation order — `page-0002` must always precede `page-0010` regardless of
 * the order the fetch happened to write them in (a retried page, a resumed job).
 */
export function readScanPages(scanId: string): unknown[] {
  const pages: Array<{ name: string; payload: unknown }> = [];
  const files = scanFolder(scanId).getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (!PAGE_NAME_RE.test(name)) continue;
    pages.push({ name, payload: parseGzBlob(f.getBlob(), name) });
  }
  pages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return pages.map((p) => p.payload);
}

const SLIM_NAME = "slim.json.gz";

/** Writes the slimmed records used for reconcile. Returns the Drive file id — an internal
 *  storage address, never forward it to a client payload; slim records are addressed by
 *  scanId alone. */
export function writeSlim(scanId: string, records: unknown[]): string {
  return writeGzJson(scanFolder(scanId), SLIM_NAME, records).getId();
}

export function readSlim(scanId: string): unknown[] | null {
  const parsed = readGzJson(scanFolder(scanId), SLIM_NAME);
  return Array.isArray(parsed) ? parsed : null;
}

const PAGE_RUNS_NAME = "pageruns.json.gz";

/** [pageIndex, recordCount] per fetched page — the per-page timing/count log. */
export function writePageRuns(scanId: string, runs: Array<[number, number]>): void {
  writeGzJson(scanFolder(scanId), PAGE_RUNS_NAME, runs);
}

export function readPageRuns(scanId: string): Array<[number, number]> | null {
  const parsed = readGzJson(scanFolder(scanId), PAGE_RUNS_NAME);
  return Array.isArray(parsed) ? (parsed as Array<[number, number]>) : null;
}

// -------------------------------------------------------------------- observations
function obsFileName(scanId: string): string {
  return `${safeName(scanId)}.json.gz`;
}

/** Writes the observation set: the finding_keys this scan saw. Returns the Drive file id — an
 *  internal storage address, never forward it to a client payload; the set is addressed by
 *  scanId alone. */
export function writeObservations(scanId: string, keys: string[]): string {
  return writeGzJson(subfolder("obs"), obsFileName(scanId), keys).getId();
}

export function readObservations(scanId: string): string[] {
  const parsed = readGzJson(subfolder("obs"), obsFileName(scanId));
  return Array.isArray(parsed) ? (parsed as string[]) : [];
}

/** Trash a scan wholesale: its page/slim/pageruns folder AND its observation-set file. */
export function trashScan(scanId: string): void {
  try {
    scanFolder(scanId).setTrashed(true);
  } catch (e) {
    console.warn(`Couldn't trash scan ${scanId}: ${e}`);
  } finally {
    // Never hand back a memoized handle to a folder this execution just trashed.
    scanFolderMemo.delete(safeName(scanId));
  }
  trashNamed("obs", obsFileName(scanId));
}

// ----------------------------------------------------------------- ledger snapshot
const SNAPSHOT_NAME = "ledger-snapshot.json.gz";

export interface LedgerSnapshot {
  version: number;
  scans: LedgerState["scans"];
  ledger: LedgerState["ledger"];
  episodes: LedgerState["episodes"];
}

/** Rewrite the fast-read copy of the ledger (called after every ledger state write). One
 *  file, latest wins — this is a cache of the tabs, not a history of them. */
export function writeLedgerSnapshot(state: LedgerState): void {
  const snap: LedgerSnapshot = {
    version: 1,
    scans: state.scans,
    ledger: state.ledger,
    episodes: state.episodes,
  };
  writeGzJson(subfolder("snapshots"), SNAPSHOT_NAME, snap);
}

/** The fast-read ledger copy, or null (missing/unreadable shape -> fall back to the tabs). */
export function readLedgerSnapshot(): LedgerSnapshot | null {
  const parsed = readGzJson(subfolder("snapshots"), SNAPSHOT_NAME);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  return looksLikeLedgerState(obj) ? (obj as unknown as LedgerSnapshot) : null;
}

// ------------------------------------------------------------------------ journals
function backupFileName(jobId: string): string {
  return `backup-${safeName(jobId)}.json.gz`;
}

/** Writes the pre-rewrite journal a crashed job rolls back from (see locks.ts). Returns the
 *  Drive file id — an internal storage address, never forward it to a client payload; a
 *  backup is addressed by jobId alone, so the id need not be remembered anywhere. */
export function writeBackup(jobId: string, state: LedgerState): string {
  return writeGzJson(subfolder("backups"), backupFileName(jobId), state).getId();
}

export function readBackup(jobId: string): LedgerState | null {
  const parsed = readGzJson(subfolder("backups"), backupFileName(jobId));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  return looksLikeLedgerState(obj) ? (obj as unknown as LedgerState) : null;
}

/** Drop a committed journal. Idempotent; silent when there is none. */
export function trashBackup(jobId: string): void {
  trashNamed("backups", backupFileName(jobId));
}

// -------------------------------------------------------------------- archive bytes
/** Total archive bytes, by top-level folder (storage-stats page). */
export function archiveBytes(): Record<Subfolder, number> {
  const out = {} as Record<Subfolder, number>;
  for (const name of SUBFOLDERS) out[name] = folderBytes(subfolder(name));
  return out;
}

function folderBytes(folder: GoogleAppsScript.Drive.Folder): number {
  let total = 0;
  const files = folder.getFiles();
  while (files.hasNext()) total += files.next().getSize();
  const folders = folder.getFolders();
  while (folders.hasNext()) total += folderBytes(folders.next());
  return total;
}
