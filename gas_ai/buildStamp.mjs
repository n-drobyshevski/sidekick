// The build stamps, computed once and shared by the real build (esbuild.config.mjs) and
// the dev harness (dev/serve.mjs).
//
// Shared rather than copied because the dev server builds its own server bundle: if only
// one of the two builds stamped, the Settings page would compare a stamped client against
// an unstamped server and report a deployment mismatch that isn't one. That false alarm
// happened, which is why this file exists.
//
// Two stamps, two questions:
//
//   __BUILD_ID__      a hash of the source tree. A CONTENT hash, not a timestamp, so the
//                     same source yields the same stamp — a no-op rebuild produces no
//                     dist churn, while any code change flips it. Folded into every
//                     CacheService key (serverCache.ts) so a deploy makes payloads
//                     computed by the old code unreachable at once, instead of serving
//                     them until the TTL expires: the "I deployed the fix but still see
//                     the bug" trap.
//
//   __BUILD_COMMIT__  the commit it was built from, and __BUILD_DATE__ that commit's
//   __BUILD_DATE__    date. A content hash cannot be looked up; a SHA can, which is what
//                     makes "is that PR in this build" an ancestry question git can
//                     settle. Both are stable per commit, so neither churns dist either.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function sourceStamp(root) {
  const h = createHash("sha1");
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|css|html|json)$/.test(e.name)) {
        h.update(e.name + "\0").update(readFileSync(p));
      }
    }
  };
  walk(join(root, "src"));
  return h.digest("hex").slice(0, 12);
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * The commit the bundle was built from, plus its date.
 *
 * `-dirty` when the tree has uncommitted changes, because then the SHA names something
 * the bundle is NOT. Both fall back to "" outside a git checkout (a release tarball, a
 * machine where npm is blocked), which the UI renders as "unknown" rather than lying.
 *
 * Note the off-by-one for the committed dist/: building then committing src+dist together
 * stamps the PARENT commit. That is still enough to place a build on the history — it is
 * an ancestry question, not an equality one.
 */
function commitStamp(root) {
  try {
    const sha = git(root, ["rev-parse", "--short", "HEAD"]);
    // Dirtiness of src/ ONLY, matching what sourceStamp hashes. dist/ is tracked in this
    // repo (it enables no-toolchain deployment), and the build writes it — so a whole-tree
    // check reports "-dirty" on every single build, which would make the flag meaningless.
    let dirty = false;
    try {
      dirty = git(root, ["status", "--porcelain", "--", "src"]).length > 0;
    } catch { /* status can fail in odd checkouts; the SHA alone is still useful */ }
    return { commit: sha + (dirty ? "-dirty" : ""), date: git(root, ["log", "-1", "--format=%cI"]) };
  } catch {
    return { commit: "", date: "" };
  }
}

/** esbuild `define` map, plus the raw values for logging. */
export function buildStamp(root) {
  const id = sourceStamp(root);
  const { commit, date } = commitStamp(root);
  return {
    id,
    commit,
    date,
    define: {
      __BUILD_ID__: JSON.stringify(id),
      __BUILD_COMMIT__: JSON.stringify(commit),
      __BUILD_DATE__: JSON.stringify(date),
    },
  };
}
