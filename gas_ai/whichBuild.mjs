// Resolve a build id to the commits that produced it.
//
//   npm run which-build           the id currently baked into dist/
//   npm run which-build <id>      an id read off a deployment (Settings -> Build)
//
// The bundle carries __BUILD_ID__, a content hash of src/ rather than a commit SHA — see
// buildStamp.mjs for why a SHA cannot live inside a committed artifact. This replays that
// hash across history, so the lookup still works; it just happens here instead of being
// frozen into the bundle.
//
// The answer is a RANGE, not a point, and that is the honest answer. Any commit that
// leaves src/ byte-identical produces the same build, so a docs-only, test-only or
// dist-only commit extends the range rather than starting a new one. An embedded SHA
// could only ever have named one arbitrary member of that set.
//
// Each candidate is materialised with `git archive` and hashed by sourceStamp itself,
// rather than re-deriving the hash from git tree objects. Git orders tree entries as if
// directories ended in "/", which is not the order readdirSync sorting produces, so a
// reimplementation would agree on most trees and silently disagree on some. Same
// function, same answer, by construction.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceStamp } from "./buildStamp.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function git(args, cwd = here) {
  return execFileSync("git", args, {
    cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"],
  });
}

// `git archive` must run from the repository root. Pathspecs are resolved against the
// current directory even when the tree-ish is already a subtree, so running it from here
// asks for gas_ai/src *inside* the gas_ai tree and matches nothing. That bug shipped once;
// the preflight below is what catches it if this drifts again.
const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
const prefix = git(["rev-parse", "--show-prefix"]).trim().replace(/\/$/, "");

/** The stamp src/ hashed to at `commit`, or null if this package had no src/ there. */
function stampAt(commit) {
  const dir = mkdtempSync(join(tmpdir(), "which-build-"));
  try {
    const treeish = prefix ? `${commit}:${prefix}` : commit;
    const tar = execFileSync("git", ["archive", "--format=tar", treeish, "src"], {
      cwd: repoRoot, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"],
    });
    execFileSync("tar", ["-xf", "-", "-C", dir], { input: tar, stdio: ["pipe", "ignore", "ignore"] });
    return existsSync(join(dir, "src")) ? sourceStamp(dir) : null;
  } catch {
    // This package did not exist yet at this commit. Tolerated per-commit, but never as a
    // blanket excuse — the preflight has already proved the mechanism works on HEAD.
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The id baked into the committed bundle — the build that would actually be deployed. */
function distId() {
  const f = join(here, "dist/server.js");
  if (!existsSync(f)) return null;
  const m = /BUILD_ID\s*=\s*(?:true\s*\?\s*)?"([0-9a-f]{6,})"/.exec(readFileSync(f, "utf8"));
  return m ? m[1] : null;
}

// Preflight. Every failure mode of stampAt looks identical to "no match" from the outside,
// so prove the mechanism works before trusting a negative answer. Without this, a broken
// git invocation reports a confident "no commit produces this build" for every input.
const headStamp = stampAt("HEAD");
if (!headStamp) {
  console.error("which-build is broken: cannot hash src/ at HEAD.");
  console.error(`  repo root: ${repoRoot}`);
  console.error(`  package prefix: ${prefix || "(repo root)"}`);
  console.error("Check that `git archive` and `tar` are available and that src/ is tracked.");
  process.exit(2);
}

const arg = process.argv[2];
const wanted = arg || distId();

if (!wanted) {
  console.error("No build id given, and none could be read from dist/server.js.");
  console.error("Usage: npm run which-build [<build-id>]");
  process.exit(2);
}

// Only commits that touched src/ can change the stamp — a much smaller set than all of
// history, and exactly the set where the answer can move.
const commits = git(["log", "--format=%H\t%cI\t%s", "--", "src"])
  .split("\n").filter(Boolean).map((l) => {
    const [sha, date, ...rest] = l.split("\t");
    return { sha, date, subject: rest.join("\t") };
  });

if (!arg) console.log(`Build id in dist/: ${wanted}`);
console.log(`Scanning ${commits.length} commits that touched src/…\n`);

const matches = commits.filter((c) => stampAt(c.sha) === wanted);

if (!matches.length) {
  console.log(`No commit produces build ${wanted}.`);
  // Compare against the WORKING TREE, not HEAD: a build made from uncommitted edits is by
  // far the most common reason a stamp resolves to nothing, and HEAD cannot detect it
  // (HEAD's committed src always matches some commit in the list above).
  if (sourceStamp(here) === wanted) {
    console.log("It matches the working tree, so it was built from uncommitted edits.");
    console.log("Commit src/ and it will resolve.");
  } else {
    console.log(
      "The build came from a tree that was never committed here: uncommitted edits, a\n" +
      "branch not present locally, or a fork. Try `git fetch --all` and re-run.",
    );
  }
  process.exit(1);
}

const short = (s) => s.slice(0, 7);
const day = (iso) => iso.slice(0, 10);

console.log(`Build ${wanted} came from src/ as of:\n`);
for (const c of matches) console.log(`  ${short(c.sha)}  ${day(c.date)}  ${c.subject}`);

// The build is current for every commit from where src/ reached this state until the next
// commit that changed src/ — docs, test and dist-only commits in between all ship it. That
// window is the real answer; naming one commit inside it would be arbitrary.
const newest = matches[0];
const supersededBy = commits[commits.indexOf(newest) - 1] || null;

if (supersededBy) {
  const span = git(["rev-list", "--count", `${newest.sha}..${supersededBy.sha}`]).trim();
  console.log(
    `\nIt is the live build from ${short(newest.sha)} until ${short(supersededBy.sha)} ` +
    `(${day(supersededBy.date)}),\nwhich is the next commit that changed src/ ` +
    `— a window of ${span} commit(s).`,
  );
} else {
  console.log(`\nNo later commit has changed src/, so this is still the current build.`);
}

console.log(
  `\nTo check whether a change is live, ask whether it is an ancestor of that state:\n` +
  `  git merge-base --is-ancestor <MERGE_SHA> ${newest.sha}`,
);
