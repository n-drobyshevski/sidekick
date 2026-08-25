// Drive storage for Wiz SIDEKICK AI: raw sync page archives and the graph snapshot
// fast path. Trimmed from the OS-vulns archiveStore — there is no append-only ledger
// here, so no journals, checkpoints, or import staging. Each sync wholesale-replaces
// the graph; the snapshot is the fast-read copy of the persisted GraphDoc.
//
// Layout under the ARCHIVE_FOLDER_ID root:
//   syncs/<sync_id>/step-N-page-0001.json.gz   raw pages per battery step
//   snapshots/graph-snapshot.json.gz           fast-read GraphDoc, rewritten per sync

import type { GraphDoc } from "../domain/graphTypes";
import { PROP_KEYS, requireProp } from "./props";

const SUBFOLDERS = ["syncs", "snapshots"] as const;
export type Subfolder = (typeof SUBFOLDERS)[number];

// Per-execution folder handles. Resolving one is not free — `syncFolder` costs a Script
// Property read, a getFolderById and two getFoldersByName — and `writeSyncPage` called it
// once PER PAGE, so a catalogue-refresh run spent ~150 Drive operations rediscovering a
// folder it had just written to. The memo lasts exactly one execution, which is the right
// lifetime: a resume hop is a fresh registry and re-resolves, so a folder moved or recreated
// between hops is picked up.
let rootFolderMemo: GoogleAppsScript.Drive.Folder | undefined;
const subfolderMemo = new Map<string, GoogleAppsScript.Drive.Folder>();
const syncFolderMemo = new Map<string, GoogleAppsScript.Drive.Folder>();

/**
 * Drop this module's per-execution memos.
 *
 * Test-only. In GAS these memos die with the execution, so nothing in production ever needs
 * to clear them; under vitest the module registry outlives a test, and `test/gasEnv.ts`
 * calls this so a shared server can be reset without re-importing the whole graph. See the
 * comment on `resetToSynced` there.
 */
export function __resetMemosForTest(): void {
  // `forgetFolders` already owns the list; a second copy here would be one to keep in step.
  forgetFolders();
}


/** Drop the memos — for `ensureFolders`, which may have just created what they cached. */
function forgetFolders(): void {
  rootFolderMemo = undefined;
  subfolderMemo.clear();
  syncFolderMemo.clear();
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
  return id.replace(/[^0-9A-Za-z._-]/g, "") || "sync";
}

// ---------------------------------------------------------------- gzip JSON files
export function writeGzJson(
  folder: GoogleAppsScript.Drive.Folder,
  name: string,
  payload: unknown,
): GoogleAppsScript.Drive.File {
  const json = JSON.stringify(payload);
  const blob = Utilities.gzip(Utilities.newBlob(json, "application/json"), name);
  // Replace any existing file of the same name (idempotent writes by deterministic name).
  const existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);
  return folder.createFile(blob);
}

export function readGzJsonFile(fileId: string): unknown | null {
  try {
    const file = DriveApp.getFileById(fileId);
    return parseGzBlob(file.getBlob());
  } catch (e) {
    console.warn(`Unreadable Drive file ${fileId}: ${e}`);
    return null;
  }
}

function parseGzBlob(blob: GoogleAppsScript.Base.Blob): unknown | null {
  try {
    const bytes = blob.getBytes();
    const isGzip = bytes.length > 2 && (bytes[0] & 0xff) === 0x1f && (bytes[1] & 0xff) === 0x8b;
    const text = isGzip
      ? Utilities.ungzip(blob).getDataAsString("UTF-8")
      : blob.getDataAsString("UTF-8");
    return JSON.parse(text);
  } catch (e) {
    console.warn(`Failed to parse archive blob: ${e}`);
    return null;
  }
}

// ------------------------------------------------------------------- raw sync pages
/** The Drive folder holding one sync's raw page files (created on demand). */
export function syncFolder(syncId: string): GoogleAppsScript.Drive.Folder {
  const key = safeName(syncId);
  const hit = syncFolderMemo.get(key);
  if (hit) return hit;
  const folder = childFolder(subfolder("syncs"), key);
  syncFolderMemo.set(key, folder);
  return folder;
}

export function writeSyncPage(
  syncId: string,
  stepIndex: number,
  pageNumber: number,
  payload: unknown,
): string {
  const name = `step-${stepIndex}-page-${String(pageNumber).padStart(4, "0")}.json.gz`;
  return writeGzJson(syncFolder(syncId), name, payload).getId();
}

/** All raw pages of one battery step, in page order (missing/unreadable pages skipped). */
export function readSyncStepPages(syncId: string, stepIndex: number): unknown[] {
  const prefix = `step-${stepIndex}-page-`;
  const pages: Array<{ name: string; payload: unknown }> = [];
  const files = syncFolder(syncId).getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (!name.startsWith(prefix)) continue;
    const payload = parseGzBlob(f.getBlob());
    if (payload !== null) pages.push({ name, payload });
  }
  pages.sort((a, b) => (a.name < b.name ? -1 : 1));
  return pages.map((p) => p.payload);
}

/** Trash a sync's raw archive folder (best-effort; used by resetData). */
export function trashSyncArchive(syncId: string): void {
  try {
    syncFolder(syncId).setTrashed(true);
  } catch (e) {
    console.warn(`Couldn't trash sync archive ${syncId}: ${e}`);
  } finally {
    // Never hand back a handle to a folder this execution just trashed.
    syncFolderMemo.delete(safeName(syncId));
  }
}

export function trashFile(fileId: string | null): void {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    console.warn(`Couldn't trash file ${fileId}: ${e}`);
  }
}

// ------------------------------------------------------------------ graph snapshot
const SNAPSHOT_NAME = "graph-snapshot.json.gz";

/** Rewrite the fast-read copy of the graph (called after every sync persist). */
export function writeGraphSnapshot(doc: GraphDoc): string {
  return writeGzJson(subfolder("snapshots"), SNAPSHOT_NAME, doc).getId();
}

/** The fast-read graph copy, or null (missing/unreadable → fall back to the tabs). */
export function readGraphSnapshot(): GraphDoc | null {
  const files = subfolder("snapshots").getFilesByName(SNAPSHOT_NAME);
  if (!files.hasNext()) return null;
  const parsed = parseGzBlob(files.next().getBlob());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const doc = parsed as GraphDoc;
  return Array.isArray(doc.nodes) && Array.isArray(doc.edges) ? doc : null;
}

export function trashGraphSnapshot(): void {
  const files = subfolder("snapshots").getFilesByName(SNAPSHOT_NAME);
  while (files.hasNext()) files.next().setTrashed(true);
}

/** Total archive bytes (storage-stats surface). */
export function archiveBytes(): number {
  let total = 0;
  for (const name of SUBFOLDERS) {
    const walk = (folder: GoogleAppsScript.Drive.Folder): void => {
      const files = folder.getFiles();
      while (files.hasNext()) total += files.next().getSize();
      const folders = folder.getFolders();
      while (folders.hasNext()) walk(folders.next());
    };
    walk(subfolder(name));
  }
  return total;
}
