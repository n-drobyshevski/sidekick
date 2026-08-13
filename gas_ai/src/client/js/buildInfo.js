// The CLIENT bundle's own build stamp — deliberately separate from the server's.
//
// dist/ ships as several files into one Apps Script project, and a copy-paste deploy can
// update some and not others. js_app.html and server.js are the two big ones, and a
// project holding a new client with an old server looks completely healthy until an RPC
// returns a shape the client no longer expects. Stamping both means the mismatch is
// visible on the Settings page instead of turning into a bug report.
//
// esbuild replaces the identifier at build time (esbuild.config.mjs); the `typeof` guard
// keeps vitest, which has no define step, on a stable "dev" stamp.

export const BUILD_ID = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

export function clientBuild() {
  return { id: BUILD_ID };
}

/**
 * The stamp as shown to a person: the hash itself, or "unknown".
 *
 * "dev" means "built with no define step" — vitest, or a harness that skipped it — which
 * is the absence of a stamp rather than the name of a build, so it reads as unknown.
 */
export function describeBuild(info) {
  const id = info && info.id;
  return id && id !== "dev" ? id : "unknown";
}
