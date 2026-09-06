// Rebuilds dist/ and asserts nothing changes beyond the build stamp.
//
//   npm run check-dist-fresh
//
// THE DEFECT THIS CATCHES BIT TWICE IN THIS WAVE, BOTH TIMES BY ACCIDENT. P4a found
// gas_devsecops/dist/styles.html missing 90 selectors a shared sheet had grown. P4b found
// ALL THREE apps stale at 5ae4701 — `.rail-amp` was in gas_shared/styles/ source and absent
// from every committed stylesheet. Neither was caught by a test; both were caught by an
// agent happening to diff dist/ by hand.
//
// WHY A REBUILD, NOT A HASH COMPARISON. buildStamp.mjs's sourceStamp() hashes `<root>/src`
// ONLY — that is deliberate there (see its own header) but means the stamp never moves when
// gas_shared/ changes, which is exactly the defect above. A guard that compared the source
// stamp to the one baked into dist/server.js would stay green through both incidents. The
// only way to see what a shared-package change actually did to THIS app's bundle is to
// build it and look — so that is what this does, via the same esbuild.config.mjs
// `npm run build` runs, not a second build pipeline.
//
// WHY THIS IS ITS OWN SCRIPT, NOT A vitest FILE. A real esbuild pass is the "too slow for
// the fast loop, and it WRITES to a tracked path" case CLAUDE.md's working discipline warns
// against putting in the normal suite — every `vitest run` would rebuild the client bundle
// and mutate dist/ as a side effect of running unit tests, which is a surprising thing for
// a test file to do. This is wired into `check` / `check:exact` instead, right after
// `build` (which already rebuilds dist/ unconditionally); running it by hand is
// `npm run check-dist-fresh`.
//
// THE ONLY TOLERATED DIFFERENCE IS THE STAMP. dist/server.js (and only that file — see
// buildStamp.mjs's grep of __BUILD_ID__ usage) embeds `__BUILD_ID__` as a literal the
// PREVIOUS build baked in; a fresh build bakes in whatever `buildStamp(root).id` is now. If
// nothing else in src/ or gas_shared/ moved, those are equal anyway and there is nothing to
// normalize. If src/ DID change, the two ids differ and normalizing them is what lets a
// same-day rebuild still compare clean; what must NOT differ after normalizing is
// everything else — a real change there means dist/ was stale.
//
// dist/entry.js and dist/appsscript.json are excluded: esbuild.config.mjs's own header says
// they are hand-maintained and never overwritten, so a rebuild cannot make them fresh or
// stale — nothing to compare.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStamp } from "./buildStamp.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const NEVER_REBUILT = new Set(["entry.js", "appsscript.json"]);

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
}

/** This package's dist/ files, repo-root-relative — the form `git show`/`git diff` need. */
function repoRelDist(name) {
  const prefix = git(["rev-parse", "--show-prefix"]).trim(); // e.g. "gas/"
  return (prefix + "dist/" + name).replace(/\\/g, "/");
}

/** The committed blob at HEAD, or null if this path is untracked / does not exist there. */
function committed(repoRelPath) {
  try {
    return git(["show", "HEAD:" + repoRelPath]);
  } catch {
    return null;
  }
}

const oldServerJs = committed(repoRelDist("server.js"));
const oldIdMatch = oldServerJs
  ? /BUILD_ID\s*=\s*(?:true\s*\?\s*)?"([0-9a-f]{6,})"/.exec(oldServerJs)
  : null;
const oldId = oldIdMatch ? oldIdMatch[1] : null;

console.log("checkDistFresh: rebuilding…");
execFileSync("node", ["esbuild.config.mjs"], { cwd: root, stdio: "inherit" });

const newId = buildStamp(root).id;

const changed = git(["diff", "--name-only", "--", "dist/"])
  .split("\n").filter(Boolean)
  .filter((p) => !NEVER_REBUILT.has(p.split("/").pop()));

if (!changed.length) {
  console.log("checkDistFresh: dist/ is fresh — rebuilding it changed nothing.");
  process.exit(0);
}

/** Replace every occurrence of a known build id with a shared placeholder, so a same-day
 *  rebuild with a genuinely different stamp still compares equal on everything else. */
const normalize = (text, id) => (id ? text.split(id).join("__BUILD_ID__") : text);

const prefix = git(["rev-parse", "--show-prefix"]).trim(); // e.g. "gas/" — strip for pathspecs
  // fed back to git commands run with cwd=root; `git show HEAD:x` wants the repo-root form,
  // `git diff -- x` (run from inside the package) wants this cwd-relative one. Passing the
  // repo-root form to the latter silently matches nothing (double "gas/gas/…") and prints an
  // empty diagnostic even when the underlying content compare below is right.
const cwdRel = (repoRelPath) => (
  prefix && repoRelPath.startsWith(prefix) ? repoRelPath.slice(prefix.length) : repoRelPath
);

let realDiff = false;
for (const repoRelPath of changed) {
  const before = committed(repoRelPath);
  const after = readFileSync(join(root, "..", repoRelPath), "utf8");
  const a = normalize(before ?? "", oldId);
  const b = normalize(after, newId);
  if (a !== b) {
    realDiff = true;
    console.error(`\n✗ ${repoRelPath} differs from a fresh build beyond the build stamp:`);
    console.error(git(["diff", "--", cwdRel(repoRelPath)]).slice(0, 6000));
  } else {
    console.log(`  ${repoRelPath} differed only by the build stamp (${oldId} -> ${newId}) — fine.`);
  }
}

if (realDiff) {
  console.error(
    "\ncheckDistFresh: the committed dist/ was STALE — rebuilding it produced different " +
    "bytes beyond the build stamp. This is the class of defect that bit twice in the wave " +
    "(P4a, P4b), usually a gas_shared/ change that never triggered a rebuild here. dist/ " +
    "has been rebuilt in place above; review the diff and commit it.",
  );
  process.exit(1);
}

console.log("\ncheckDistFresh: dist/ is fresh, modulo the build stamp.");
