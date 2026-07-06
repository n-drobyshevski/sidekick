// Drive storage: raw scan page archives, per-scan observations, compaction
// checkpoints, the ledger snapshot fast path, and pre-mutation journal backups.
//
// Layout under the ARCHIVE_FOLDER_ID root:
//   scans/<scan_id>/page-0001.json.gz ...   multi-part raw archive (one file per page)
//   scans/<scan_id>/slim.json.gz            slim records spill (scan-job continuation)
//   obs/obs-<scan_id>.json.gz               per-scan observations
//   checkpoints/checkpoint-<compaction_id>.json.gz
//   snapshots/ledger-snapshot.json.gz       fast-read state, rewritten on every write
//   backups/backup-<job_id>.json.gz         journal snapshots, deleted on commit

import type { Checkpoint } from "../domain/compaction";
import type { LedgerState } from "../domain/ledgerCore";
import type { Observation } from "../domain/reconcile";
import { PROP_KEYS, requireProp } from "./props";

const SUBFOLDERS = ["scans", "obs", "checkpoints", "snapshots", "backups"] as const;
export type Subfolder = (typeof SUBFOLDERS)[number];

function rootFolder(): GoogleAppsScript.Drive.Folder {
  return DriveApp.getFolderById(requireProp(PROP_KEYS.archiveFolderId));
}

function childFolder(
  parent: GoogleAppsScript.Drive.Folder,
  name: string,
): GoogleAppsScript.Drive.Folder {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

export function subfolder(name: Subfolder): GoogleAppsScript.Drive.Folder {
  return childFolder(rootFolder(), name);
}

/** Create the folder skeleton (idempotent); returns the root folder id. */
export function ensureFolders(rootId?: string): string {
  const root = rootId ? DriveApp.getFolderById(rootId) : rootFolder();
  for (const name of SUBFOLDERS) childFolder(root, name);
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

// ------------------------------------------------------------------- raw scan pages
/** The Drive folder holding one scan's page files (created on demand). */
export function scanFolder(scanId: string): GoogleAppsScript.Drive.Folder {
  return childFolder(subfolder("scans"), safeName(scanId));
}

export function writeScanPage(scanId: string, pageNumber: number, payload: unknown): string {
  const name = `page-${String(pageNumber).padStart(4, "0")}.json.gz`;
  return writeGzJson(scanFolder(scanId), name, payload).getId();
}

export function writeSlimRecords(scanId: string, records: unknown[]): string {
  return writeGzJson(scanFolder(scanId), "slim.json.gz", records).getId();
}

export function readSlimRecords(scanId: string): unknown[] | null {
  const files = scanFolder(scanId).getFilesByName("slim.json.gz");
  if (!files.hasNext()) return null;
  const parsed = parseGzBlob(files.next().getBlob());
  return Array.isArray(parsed) ? parsed : null;
}

/**
 * Concatenated raw payload of a scan: iterates page-*.json.gz in name order and
 * returns a page list (the multi-page envelope extract_nodes understands), or null
 * when the scan has no archive.
 */
export function readScanPayload(scanRef: string | null): unknown | null {
  if (!scanRef) return null;
  let folder: GoogleAppsScript.Drive.Folder;
  try {
    folder = DriveApp.getFolderById(scanRef);
  } catch {
    return null;
  }
  const pages: Array<{ name: string; payload: unknown }> = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (!/^page-\d+\.json(\.gz)?$/.test(name)) continue;
    const payload = parseGzBlob(f.getBlob());
    if (payload === null) return null; // any unreadable page = unreadable archive
    pages.push({ name, payload });
  }
  if (!pages.length) return null;
  pages.sort((a, b) => (a.name < b.name ? -1 : 1));
  return pages.map((p) => p.payload);
}

/** Total bytes of a scan's archived artifacts (compaction preview accounting). */
export function scanArchiveBytes(scanRef: string | null, obsRef: string | null): number {
  let total = 0;
  if (scanRef) {
    try {
      const files = DriveApp.getFolderById(scanRef).getFiles();
      while (files.hasNext()) total += files.next().getSize();
    } catch {
      // missing folder — nothing to count
    }
  }
  if (obsRef) {
    try {
      total += DriveApp.getFileById(obsRef).getSize();
    } catch {
      // missing file
    }
  }
  return total;
}

/** Trash a scan's raw archive folder (post-commit pruning; best-effort). */
export function trashScanArchive(scanRef: string | null): void {
  if (!scanRef) return;
  try {
    DriveApp.getFolderById(scanRef).setTrashed(true);
  } catch (e) {
    console.warn(`Couldn't trash scan archive ${scanRef}: ${e}`);
  }
}

// -------------------------------------------------------------------- observations
export function writeObservations(scanId: string, observations: Observation[]): string {
  return writeGzJson(subfolder("obs"), `obs-${safeName(scanId)}.json.gz`, observations).getId();
}

export function readObservations(obsRef: string | null): Observation[] {
  if (!obsRef) return [];
  const parsed = readGzJsonFile(obsRef);
  return Array.isArray(parsed) ? (parsed as Observation[]) : [];
}

export function trashFile(fileId: string | null): void {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    console.warn(`Couldn't trash file ${fileId}: ${e}`);
  }
}

// --------------------------------------------------------------------- checkpoints
export function writeCheckpoint(compactionId: string, checkpoint: Checkpoint): string {
  return writeGzJson(
    subfolder("checkpoints"),
    `checkpoint-${safeName(compactionId)}.json.gz`,
    checkpoint,
  ).getId();
}

export function readCheckpoint(ref: string | null): Checkpoint | null {
  if (!ref) return null;
  const parsed = readGzJsonFile(ref);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Checkpoint;
}

// ----------------------------------------------------------------- ledger snapshot
const SNAPSHOT_NAME = "ledger-snapshot.json.gz";

export interface LedgerSnapshot {
  version: number;
  ledger: LedgerState["ledger"];
  episodes: LedgerState["episodes"];
}

/** Rewrite the fast-read copy of the ledger (called after every state write). */
export function writeLedgerSnapshot(state: LedgerState): void {
  const snap: LedgerSnapshot = { version: 1, ledger: state.ledger, episodes: state.episodes };
  writeGzJson(subfolder("snapshots"), SNAPSHOT_NAME, snap);
}

/** The fast-read ledger copy, or null (missing/unreadable -> fall back to the tab). */
export function readLedgerSnapshot(): LedgerSnapshot | null {
  const files = subfolder("snapshots").getFilesByName(SNAPSHOT_NAME);
  if (!files.hasNext()) return null;
  const parsed = parseGzBlob(files.next().getBlob());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const snap = parsed as LedgerSnapshot;
  return snap.ledger && snap.episodes ? snap : null;
}

// ------------------------------------------------------------------------ journals
export function writeJournal(jobId: string, state: LedgerState): string {
  return writeGzJson(subfolder("backups"), `backup-${safeName(jobId)}.json.gz`, state).getId();
}

export function readJournal(ref: string | null): LedgerState | null {
  if (!ref) return null;
  const parsed = readGzJsonFile(ref);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const st = parsed as LedgerState;
  return st.scans && st.ledger && st.episodes ? st : null;
}
