// Which build is this? — answered by the bundle itself.
//
// A Google Apps Script deployment has three ways to be stale at once: the project can hold
// an old file, the web app can be pinned to an old VERSION (so `clasp push` changes
// nothing at /exec), and a copy-paste deploy can update some files and not others. None of
// them is visible from the running app, so "is my fix live?" turns into an investigation
// every time.
//
// The stamp is a content hash of src/, not a commit SHA — buildStamp.mjs explains why a
// SHA cannot live inside an artifact that is itself committed. `npm run which-build <id>`
// turns this hash back into commits.
//
// esbuild replaces the identifier at build time (see esbuild.config.mjs). The `typeof`
// guard leaves vitest — which has no define step — on a stable "dev" stamp, so its
// behaviour never depends on how it was started.

declare const __BUILD_ID__: string;

/** Source-tree content hash. Same source, same stamp — a no-op rebuild changes nothing. */
export const BUILD_ID = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

export interface BuildInfo {
  id: string;
}

/** Rides along on the bootstrap payload so the client can show it and compare. */
export function buildInfo(): BuildInfo {
  return { id: BUILD_ID };
}
