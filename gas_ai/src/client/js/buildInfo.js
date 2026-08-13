// The CLIENT bundle's own build stamp — deliberately separate from the server's.
//
// dist/ ships as several files into one Apps Script project, and a copy-paste deploy can
// update some and not others. js_app.html and server.js are the two big ones, and a
// project holding a new client with an old server looks completely healthy until an RPC
// returns a shape the client no longer expects. Stamping both means the mismatch is
// visible on the Settings page instead of turning into a bug report.
//
// esbuild replaces these at build time (esbuild.config.mjs); the `typeof` guards keep the
// dev server, which has no define step, on a stable "dev" stamp.

export const BUILD_ID = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
export const BUILD_COMMIT = typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "";
export const BUILD_DATE = typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "";

export function clientBuild() {
  return { id: BUILD_ID, commit: BUILD_COMMIT, date: BUILD_DATE };
}

/** "abc1234 · 12 Aug 2026", or "unknown" outside a git checkout. */
export function describeBuild(info) {
  const b = info || {};
  const parts = [];
  if (b.commit) parts.push(b.commit);
  if (b.date) {
    const t = Date.parse(b.date);
    if (!Number.isNaN(t)) {
      parts.push(new Date(t).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
      }));
    }
  }
  if (!parts.length) return b.id && b.id !== "dev" ? b.id : "unknown";
  return parts.join(" · ");
}
