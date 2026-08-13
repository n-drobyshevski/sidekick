// Which build is this? — answered by the bundle itself.
//
// A Google Apps Script deployment has three ways to be stale at once: the project can hold
// an old file, the web app can be pinned to an old VERSION (so `clasp push` changes
// nothing at /exec), and a copy-paste deploy can update some files and not others. None of
// them is visible from the running app, so "is my fix live?" turns into an investigation
// every time.
//
// esbuild replaces these three identifiers at build time (see esbuild.config.mjs). The
// `typeof` guard leaves vitest and the dev server — which have no define step — on a
// stable "dev" stamp, so their behaviour never depends on how they were started.

declare const __BUILD_ID__: string;
declare const __BUILD_COMMIT__: string;
declare const __BUILD_DATE__: string;

/** Source-tree content hash. Same source, same stamp — a no-op rebuild changes nothing. */
export const BUILD_ID = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

/** Short commit SHA the bundle was built from, `-dirty` when the tree had edits. */
export const BUILD_COMMIT = typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "";

/** That commit's date, ISO. Not the build time — this stays stable across rebuilds. */
export const BUILD_DATE = typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "";

export interface BuildInfo {
  id: string;
  commit: string;
  date: string;
}

/** Rides along on the bootstrap payload so the client can show it and compare. */
export function buildInfo(): BuildInfo {
  return { id: BUILD_ID, commit: BUILD_COMMIT, date: BUILD_DATE };
}
