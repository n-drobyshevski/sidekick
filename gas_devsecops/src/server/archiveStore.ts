// Drive storage for Wiz Sidekick DevSecOps: raw sync page archives and the graph snapshot
// fast path. Trimmed from the OS-vulns archiveStore — there is no append-only ledger
// here, so no journals, checkpoints, or import staging. Each sync wholesale-replaces
// the graph; the snapshot is the fast-read copy of the persisted SnapshotDoc.
//
// Layout under the ARCHIVE_FOLDER_ID root:
//   syncs/<sync_id>/step-N-page-0001.json.gz   raw pages per battery step
//   snapshots/graph-snapshot.json.gz           fast-read SnapshotDoc, rewritten per sync

// The gzipped snapshot this store round-trips. Structurally opaque here on purpose: the
// archive's job is bytes in Drive, and pinning it to the ledger's shape would make every
// ledger column change a change to the archive layer too.
export type SnapshotDoc = Record<string, unknown>;
import { PROP_KEYS, requireProp } from "./props";

// "readmodels" holds the durable second level under the CacheService read-model cache —
// see readModelStore.ts. Created on demand by `subfolder()` as well as by `ensureFolders`,
// so a deployment that never re-runs setup() still self-heals on the first write.
const SUBFOLDERS = ["syncs", "snapshots", "readmodels"] as const;
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

/**
 * A gzipped JSON file by NAME within a subfolder, or null when there is none.
 *
 * By name rather than by id because the durable read-model store addresses its files
 * deterministically: the name IS the key, so there is no id to remember anywhere.
 */
export function readGzJsonNamed(folder: Subfolder, name: string): unknown | null {
  const it = subfolder(folder).getFilesByName(name);
  if (!it.hasNext()) return null;
  return parseGzBlob(it.next().getBlob());
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
 * Wired into `resetData`: a reset bumps the version, so every entry is already unreachable —
 * but reset should mean reset rather than "unreachable and still on disk".
 */
export function trashReadModels(): void {
  for (const name of listNames("readmodels")) trashNamed("readmodels", name);
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

/**
 * All raw pages of one step, in page order — or a REFUSAL.
 *
 * THIS USED TO SKIP A PAGE IT COULD NOT READ, silently, and that is the most dangerous thing
 * this module could do on this register. The pages are a scope's whole population, and what
 * happens next is `reconcile`, which resolves by DISAPPEARANCE: every finding that was in the
 * missing page is absent from the observation set, so it would be written back as remediated,
 * dated to this scan, and counted as a fix. One unreadable file is 500 false remediations that
 * look exactly like real ones.
 *
 * It is also the guard on the secrets fold. `collapseTwins` pairs twins that can land on
 * different pages; a dropped page orphans half of every pair it held, and the survivor keeps
 * its own clock as though it had never had a partner.
 *
 * So `expectedPages` — what the job's checkpoint says was written — is compared against what
 * is on disk, and an unreadable page throws rather than being passed over. Both failures leave
 * the step uncommitted, which is the only outcome that cannot be mistaken for a measurement.
 */
export function readSyncStepPages(
  syncId: string, stepIndex: number, expectedPages: number,
): unknown[] {
  const prefix = `step-${stepIndex}-page-`;
  const pages: Array<{ name: string; payload: unknown }> = [];
  const files = syncFolder(syncId).getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (!name.startsWith(prefix)) continue;
    const payload = parseGzBlob(f.getBlob());
    if (payload === null) {
      throw new Error(
        `Archive page ${name} of sync ${syncId} could not be read. Refusing to reconcile a `
        + "scope against a population that is missing a page — every finding in it would "
        + "resolve as remediated.",
      );
    }
    pages.push({ name, payload });
  }
  pages.sort((a, b) => (a.name < b.name ? -1 : 1));
  if (pages.length !== expectedPages) {
    throw new Error(
      `Sync ${syncId} step ${stepIndex} recorded ${expectedPages} page(s) but ${pages.length} `
      + "are on disk. Refusing to reconcile against an incomplete population.",
    );
  }
  return pages.map((p) => p.payload);
}

/** How many pages of one step are on disk. For reconciling a checkpoint against Drive. */
export function syncStepPageCount(syncId: string, stepIndex: number): number {
  const prefix = `step-${stepIndex}-page-`;
  let n = 0;
  const files = syncFolder(syncId).getFiles();
  while (files.hasNext()) {
    if (files.next().getName().startsWith(prefix)) n += 1;
  }
  return n;
}

/**
 * Trash one step's pages, leaving its committed siblings alone.
 *
 * Per STEP rather than per sync, because a job's earlier scopes may already have committed
 * `scans` rows that name this archive as their `raw_ref`. Trashing the whole folder to clean
 * up an abandoned third step would take the evidence for the first two with it.
 */
export function trashSyncStepPages(syncId: string, stepIndex: number): void {
  const prefix = `step-${stepIndex}-page-`;
  try {
    const files = syncFolder(syncId).getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.getName().startsWith(prefix)) f.setTrashed(true);
    }
  } catch (e) {
    // Best-effort: nothing was committed for this step, so leftover pages cost storage and
    // nothing else. The next attempt writes by deterministic name and replaces them.
    console.warn(`Couldn't trash step ${stepIndex} of sync ${syncId}: ${e}`);
  }
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
export function writeSnapshot(doc: SnapshotDoc): string {
  return writeGzJson(subfolder("snapshots"), SNAPSHOT_NAME, doc).getId();
}

/** The fast-read graph copy, or null (missing/unreadable → fall back to the tabs). */
export function readSnapshot(): SnapshotDoc | null {
  const files = subfolder("snapshots").getFilesByName(SNAPSHOT_NAME);
  if (!files.hasNext()) return null;
  const parsed = parseGzBlob(files.next().getBlob());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const doc = parsed as SnapshotDoc;
  return Array.isArray(doc.nodes) && Array.isArray(doc.edges) ? doc : null;
}

export function trashSnapshot(): void {
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
