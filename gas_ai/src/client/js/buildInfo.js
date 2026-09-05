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
 *
 * NOW A RE-EXPORT, not a second implementation. `gas_shared/ui/diagnostics.js` draws the Build
 * card for all three registers and has to turn a stamp into text to do it, so the rule lives
 * there; a copy here would be the fork the parity contract exists to catch, one tier below
 * where it looks. `clientBuild()` above stays, because reading `__BUILD_ID__` is genuinely this
 * bundle's own business. The name is kept so test/buildInfo.test.ts keeps asserting the same
 * five cases against the same rule.
 */
export { describeStamp as describeBuild } from "../../../../gas_shared/ui/diagnostics.js";
