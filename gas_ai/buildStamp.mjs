// The build stamp, computed once and shared by the real build (esbuild.config.mjs) and
// the dev harness (dev/serve.mjs).
//
// Shared rather than copied because the dev server builds its own server bundle: if only
// one of the two builds stamped, the Settings page would compare a stamped client against
// an unstamped server and report a deployment mismatch that isn't one. That false alarm
// happened, which is why this file exists.
//
//   __BUILD_ID__   a content hash of src/. Folded into every CacheService key
//                  (serverCache.ts) so a deploy makes payloads computed by the old code
//                  unreachable at once, instead of serving them until the TTL expires:
//                  the "I deployed the fix but still see the bug" trap. It is also what
//                  the Settings page shows and what `npm run which-build` resolves.
//
// WHY THERE IS NO COMMIT STAMP HERE
//
// There used to be, on the reasoning that a content hash cannot be looked up but a SHA
// can. __BUILD_COMMIT__ and __BUILD_DATE__ were removed because a commit stamp inside a
// committed artifact is a fixpoint that does not exist.
//
// dist/ is tracked in this repo, so the order is always: build, then commit src and dist
// together. At build time the commit that will contain the build has no SHA yet, so the
// bundle can only ever name its own parent — and rebuilding to correct that produces a
// new commit, which makes it stale again. The symptom was that every `npm run check`
// after any commit left dist/ dirty by exactly one line, forever, with no sequence of
// commits that could settle it.
//
// A hash of src/ has no such problem: src/ does not contain dist/, so the input does not
// depend on the output. Same source, same stamp — a no-op rebuild produces no dist churn,
// and only a real source change flips it. (gas/ has always stamped this way.)
//
// The lookup the SHA existed for is now `npm run which-build`, which replays this same
// hash across history. That answers strictly more than an embedded SHA could: it names
// every commit that produces a given build rather than one arbitrary member of that set,
// and it works on an id read off a deployed app, not only on a build made here.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Content hash of `<root>/src`, over the file types that reach a bundle.
 *
 * Exported because whichBuild.mjs replays it against historical checkouts — it must be
 * the same function, not a second implementation that agrees until it doesn't.
 */
export function sourceStamp(root) {
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

/** esbuild `define` map, plus the raw value for logging. */
export function buildStamp(root) {
  const id = sourceStamp(root);
  return { id, define: { __BUILD_ID__: JSON.stringify(id) } };
}
