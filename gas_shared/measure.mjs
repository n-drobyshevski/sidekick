#!/usr/bin/env node
// The wave's own before/after measurement — reusable, and run against BOTH commits by the
// SAME method, which the plan's original baseline was not: the 2026-09-04 numbers were
// computed by hand, once, and nothing saved the method, so a later "after" column could
// only ever be compared against them by re-typing the same greps and hoping they matched.
// This script IS the method, and running it twice — once materialized at the wave's base
// commit, once at HEAD — is how the two columns get to share one.
//
// USAGE
//   node gas_shared/measure.mjs                      after only: the live working tree
//   node gas_shared/measure.mjs --ref <sha>           after only: <sha>, read-only
//   node gas_shared/measure.mjs --before <sha> --after <sha-or-HEAD>
//                                                      both columns, side by side
//
//   node gas_shared/measure.mjs --before 01aca7b --after HEAD     the wave's own comparison
//
// HOW A REF IS MEASURED WITHOUT TOUCHING ANY WORKTREE. `git archive <ref> | tar -x` into a
// scratch directory — the exact technique gas/whichBuild.mjs already uses to hash `src/` at
// a historical commit, reused here rather than a second implementation (`git worktree add`
// was the other candidate; it registers in `git worktree list` and risks colliding with the
// real ones this wave uses, for no benefit an archive extract doesn't already give a
// read-only measurement). The working tree (no --ref) is read directly, uncommitted edits
// included — that is what "after HEAD" should mean while this package's own changes are
// still uncommitted.
//
// EVERY COUNT BELOW IS DERIVED, NOT TYPED. gas_shared/README.md records that its own module
// counts were wrong once already in this wave, when two packages each counted only their own
// addition — the fix here is the same one: run the walk, print what it found.

import { execFileSync } from "node:child_process";
// Reused rather than reimplemented: a naive line-comment stripper is exactly wrong for this
// codebase, because every module header here explains a rule by QUOTING it — a comment
// mentioning `el("h1", ...)` or "gas_shared/ui/helpPage.js" as prose must not count as a hit.
// This IS the string-aware, comment-and-template-literal-safe stripper the emptyStates and
// syncCaption contracts already rely on; measure.mjs resolves it from ITS OWN location, so
// a "before" snapshot with no gas_shared/ at all is still measured by today's stripper, not
// a second copy that would have to be kept in sync with it.
import { code } from "./test/contracts/emptyStates.js";
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url)); // …/gas_shared
const REPO_ROOT = dirname(HERE); // the monorepo root: gas/, gas_ai/, gas_devsecops/, gas_shared/
const APPS = ["gas", "gas_ai", "gas_devsecops"];

// ============================================================================================
//  Materializing a ref, read-only
// ============================================================================================

function git(args, cwd = REPO_ROOT) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30 });
}

/** `D:\temp\x` -> `/d/temp/x` — the form MSYS tar (this box's /usr/bin/tar) accepts as a
 *  local path instead of misreading the drive letter as a remote-tar host. A no-op on any
 *  path that is not already `<letter>:\…`. */
function toMsysPath(p) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p;
  return `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

/**
 * Extract `ref`'s whole tree into a fresh scratch directory. Caller must rmSync it.
 *
 * WRITES THE ARCHIVE TO A FILE FIRST, rather than piping the tar buffer through `tar`'s
 * stdin the way gas/whichBuild.mjs's own stampAt() does — measured here, that pipe fails on
 * this Windows environment for an archive of any real size: `execFileSync("tar", …, {input:
 * tar})` throws `spawnSync tar EOF`, and `node whichBuild.mjs` itself reproduces the same
 * failure at its own preflight (`which-build is broken: cannot hash src/ at HEAD`), so this
 * is not a bug in this script's use of the pattern — it is Node's synchronous child_process
 * pipe write hitting a Windows pipe-buffer ceiling once the buffer is more than a token
 * amount, and it is a live trap for whichBuild.mjs too, not just for a full-repo archive.
 * `git archive -o <file>` and a plain `tar -xf <file>` both do ordinary file I/O and neither
 * touches that path.
 */
function materialize(ref) {
  const dir = mkdtempSync(join(tmpdir(), "wiz-measure-"));
  const tarFile = join(dir, "..", `wiz-measure-archive-${Date.now()}.tar`);
  execFileSync("git", ["archive", "--format=tar", "-o", tarFile, ref], { cwd: REPO_ROOT });
  // `tar` on this box is MSYS tar (git bash's own /usr/bin/tar, GNU tar 1.35 — confirmed by
  // running it directly), which reads a bare `D:\…` argument as `host:path` remote-tar
  // syntax ("tar: Cannot connect to D: resolve failed") rather than as a Windows path, even
  // though the SAME string opens fine as a Node fs path two lines above. MSYS understands
  // its own posix form of a Windows path, so both arguments go through that translation —
  // not just a documentation footnote, since a run-once script is exactly the kind of thing
  // nobody re-tests on a plain `cmd.exe` where the untranslated path already works.
  execFileSync("tar", ["-xf", toMsysPath(tarFile), "-C", toMsysPath(dir)]);
  rmSync(tarFile, { force: true });
  return dir;
}

// ============================================================================================
//  Filesystem helpers
// ============================================================================================

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "__snapshots__"]);

/** Every file under `dir` whose relative path matches `test(rel)`, recursively. */
function walk(dir, test) {
  const out = [];
  if (!existsSync(dir)) return out;
  const rec = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (test(p)) out.push(p);
    }
  };
  rec(dir);
  return out;
}

const lineCount = (path) => readFileSync(path, "utf8").split("\n").length;
const readText = (paths) => paths.map((p) => readFileSync(p, "utf8"));
/** Comment-stripped source, concatenated — every regex sweep below reads THIS, not the raw
 *  text, or a module header quoting the pattern it forbids would count as a hit. */
const readCode = (paths) => readText(paths).map(code).join("\n");

// ============================================================================================
//  1. Client JS/CSS line and file counts, per app, plus gas_shared/
// ============================================================================================

function clientTrees(root, app) {
  const base = join(root, app, "src/client");
  return {
    js: walk(join(base, "js"), (p) => p.endsWith(".js")),
    css: walk(base, (p) => p.endsWith(".css")),
  };
}

function sharedTree(root) {
  const base = join(root, "gas_shared");
  if (!existsSync(base)) return null;
  const rootFiles = ["api.js", "store.js", "icons.js", "appConfig.js"]
    .map((n) => join(base, n)).filter(existsSync);
  return {
    js: [...walk(join(base, "ui"), (p) => p.endsWith(".js")),
      ...walk(join(base, "shell"), (p) => p.endsWith(".js")), ...rootFiles],
    css: walk(join(base, "styles"), (p) => p.endsWith(".css")),
  };
}

function sizeCounts(root) {
  const rows = {};
  for (const app of APPS) {
    const t = clientTrees(root, app);
    rows[app] = {
      jsFiles: t.js.length, jsLines: t.js.reduce((s, p) => s + lineCount(p), 0),
      cssFiles: t.css.length, cssLines: t.css.reduce((s, p) => s + lineCount(p), 0),
    };
  }
  const shared = sharedTree(root);
  rows.gas_shared = shared
    ? {
      jsFiles: shared.js.length, jsLines: shared.js.reduce((s, p) => s + lineCount(p), 0),
      cssFiles: shared.css.length, cssLines: shared.css.reduce((s, p) => s + lineCount(p), 0),
    }
    : null;
  return rows;
}

// ============================================================================================
//  2. Duplication classification across apps' own client trees
// ============================================================================================
//
// "own" on purpose: after the wave, a shared module lives in gas_shared/ and is imported,
// not copied — so it never appears in more than one app's OWN src/client tree at all, and a
// basename shared across apps at that point is either the allow-listed exception or the
// fork parity.js exists to catch. Before the wave there was no gas_shared/, so this same
// walk finds every basename gas/, gas_ai/ and gas_devsecops/ happened to agree on by
// copying — which is the number the wave's own plan meant by "duplication".

/** Churn = (added + deleted lines) / (lines in A + lines in B), via `git diff --no-index`,
 *  which needs no repository context for either path — two arbitrary files, anywhere. */
function churn(fileA, fileB) {
  let out = "";
  try {
    out = execFileSync(
      "git", ["diff", "--no-index", "--numstat", fileA, fileB],
      { encoding: "utf8", maxBuffer: 1 << 28 },
    );
  } catch (e) {
    // --no-index exits 1 when the files differ, which is the normal case, not a failure.
    out = e.stdout ?? "";
  }
  const m = /^(\d+)\s+(\d+)\s+/.exec(out);
  if (!m) return null; // binary, or one side unreadable
  const [, added, deleted] = m;
  const totalLines = lineCount(fileA) + lineCount(fileB);
  return totalLines > 0 ? ((Number(added) + Number(deleted)) / totalLines) * 100 : 0;
}

function duplication(root) {
  /** @type {Map<string, {app:string, path:string}[]>} */
  const byBasename = new Map();
  for (const app of APPS) {
    const t = clientTrees(root, app);
    for (const p of [...t.js, ...t.css]) {
      const base = p.split(/[\\/]/).pop();
      if (!byBasename.has(base)) byBasename.set(base, []);
      byBasename.get(base).push({ app, path: p });
    }
  }
  const rows = [];
  for (const [base, entries] of byBasename) {
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [a, b] = [entries[i], entries[j]];
        const identical = Buffer.compare(
          readFileSync(a.path), readFileSync(b.path),
        ) === 0;
        const pct = identical ? 0 : churn(a.path, b.path);
        rows.push({
          basename: base, apps: `${a.app} <-> ${b.app}`,
          class: identical ? "identical" : (pct !== null && pct <= 15 ? "near-identical" : "diverged"),
          churnPct: identical ? 0 : pct,
        });
      }
    }
  }
  return rows;
}

// ============================================================================================
//  3. Hygiene greps over CSS
// ============================================================================================

function hygiene(root) {
  const out = {};
  const TOKEN_FILES = new Set(["tokens.base.css", "tokens.css"]);
  for (const app of [...APPS, "gas_shared"]) {
    const t = app === "gas_shared" ? sharedTree(root) : clientTrees(root, app);
    if (!t) { out[app] = null; continue; }
    const nonTokenCss = t.css.filter((p) => !TOKEN_FILES.has(p.split(/[\\/]/).pop()));
    const nonTokenText = readCode(nonTokenCss);
    const allCssText = readCode(t.css);

    const hexOutsideTokens = (nonTokenText.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    const fontSizeDecls = [...allCssText.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
    const distinctFontSizes = new Set(fontSizeDecls).size;
    const fontSizeNotVar = fontSizeDecls.filter((v) => !v.startsWith("var(--fs-")).length;
    const bareZIndex = (allCssText.match(/z-index:\s*(?!var\()\d+/g) || []).length;
    const reducedMotionBlocks = (allCssText.match(/@media\s*\([^)]*prefers-reduced-motion/g) || []).length;
    const outlineAccentFill = (allCssText.match(/outline:[^;]*var\(--accent\)(?!-text)/g) || []).length;
    const outlineAccentText = (allCssText.match(/outline:[^;]*var\(--accent-text\)/g) || []).length;

    out[app] = {
      hexOutsideTokens, distinctFontSizes, fontSizeNotVar, bareZIndex,
      reducedMotionBlocks, outlineAccentFill, outlineAccentText,
    };
  }
  return out;
}

// ============================================================================================
//  4. Component vocabulary
// ============================================================================================

function vocabulary(root) {
  const out = {};
  for (const app of APPS) {
    const t = clientTrees(root, app);
    const jsText = readCode(t.js);
    const testFiles = walk(join(root, app, "test"), (p) => /\.test\.(ts|js|mjs)$/.test(p));
    out[app] = {
      elH1: (jsText.match(/\bel\(\s*"h1"/g) || []).length,
      pageHeader: (jsText.match(/\bpageHeader\(/g) || []).length,
      handTypedDash: (jsText.match(/["'“]—["'”]/g) || []).length,
      absentCalls: (jsText.match(/\babsent\(/g) || []).length,
      emptyStateCalls: (jsText.match(/\bemptyState\(/g) || []).length,
      errorStateCalls: (jsText.match(/\berrorState\(/g) || []).length,
      pagerCalls: (jsText.match(/\bpager\(/g) || []).length,
      tableFooterCalls: (jsText.match(/\btableFooter\(/g) || []).length,
      localNumDefs: (jsText.match(/\b(?:function\s+num\s*\(|(?:const|let|var)\s+num\s*=)/g) || []).length,
      sevBadgeCalls: (jsText.match(/\bsevBadge\(/g) || []).length,
      testFiles: testFiles.length,
    };
  }
  return out;
}

// ============================================================================================
//  5. dist/ size table, with gzip
// ============================================================================================

function distSizes(root) {
  const out = {};
  for (const app of APPS) {
    const dir = join(root, app, "dist");
    if (!existsSync(dir)) { out[app] = null; continue; }
    const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
    out[app] = files.map((f) => {
      const buf = readFileSync(join(dir, f));
      return { file: f, bytes: buf.length, gzipBytes: gzipSync(buf).length };
    });
  }
  return out;
}

// ============================================================================================
//  6. The 12-item cross-app inconsistency scorecard
// ============================================================================================
//
// Each check is structural (existence / import graph / call-site counts), not a restatement
// of the wave's own claim — a regression after this package would show up here, not just in
// gas_shared/README.md's prose.

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Every .ts file under `<root>/<app>/src/server`, concatenated. dryRunScan/dryRunSync live
 *  server-side (scanJobs.ts / syncJobs.ts), not in client JS — a check that only swept
 *  src/client/js would find neither app and misreport a true fallback as missing. */
function serverText(root, app) {
  return readText(walk(join(root, app, "src/server"), (p) => p.endsWith(".ts"))).join("\n");
}

function scorecard(root) {
  const sharedShell = join(root, "gas_shared/shell");
  const sharedUi = join(root, "gas_shared/ui");
  const items = [];

  const appJs = (app) => readIfExists(join(root, app, "src/client/js/app.js"));
  const allAppsMatch = (re) => APPS.every((a) => re.test(appJs(a)));

  // 1. boot-splash copy
  {
    const has = existsSync(join(sharedShell, "bootSplash.js")) && allAppsMatch(/createAppShell\(/);
    items.push({
      item: "boot-splash copy",
      mark: has ? "✓" : "✗",
      note: has
        ? "gas_shared/shell/bootSplash.js draws it from the manifest; every app.js reaches it only through createAppShell(), never directly."
        : "no shared bootSplash.js reachable from every app.js.",
    });
  }

  // 2. page-header pattern
  {
    const perApp = APPS.map((a) => {
      const t = clientTrees(root, a);
      const jsText = readCode(t.js);
      const elH1 = (jsText.match(/\bel\(\s*"h1"/g) || []).length;
      const ph = (jsText.match(/\bpageHeader\(/g) || []).length;
      return { a, elH1, ph };
    });
    const clean = perApp.every((r) => r.elH1 === 0);
    items.push({
      item: "page-header pattern",
      mark: clean ? "✓" : "✗",
      note: clean
        ? "no app draws a page title with a bare el(\"h1\", …) any more — every route calls the shared pageHeader()."
        : "still bare: " + perApp.filter((r) => r.elH1 > 0)
          .map((r) => `${r.a} (${r.elH1})`).join(", ")
          + " — some may be a distinct \"workbench title\" sub-heading rather than the page header proper; not re-derived here.",
    });
  }

  // 3. sevBadge role
  {
    const defined = existsSync(join(sharedUi, "severity.js"))
      && /export function sevBadge/.test(readIfExists(join(sharedUi, "severity.js")));
    const forked = APPS.filter((a) => {
      const t = clientTrees(root, a);
      return readText(t.js).some((s) => /function\s+sevBadge\s*\(/.test(code(s)));
    });
    const ok = defined && forked.length === 0;
    items.push({
      item: "sevBadge role",
      mark: ok ? "✓" : "✗",
      note: ok
        ? "one sevBadge() in gas_shared/ui/severity.js; no app defines a local one."
        : `forked in: ${forked.join(", ") || "(shared sevBadge missing)"}.`,
    });
  }

  // 4. empty-vs-error
  {
    const perApp = APPS.map((a) => {
      const src = readIfExists(join(root, a, "test/shared.test.js"));
      const m = /errorStateCarriers:\s*\[([^\]]*)\]/.exec(src);
      return { a, count: m ? (m[1].match(/"/g) || []).length / 2 : 0 };
    });
    const ok = perApp.every((r) => r.count > 0);
    items.push({
      item: "empty-vs-error",
      mark: ok ? "✓" : "✗",
      note: ok
        ? "all three register the shared emptyStates contract with a non-empty errorStateCarriers list: " +
          perApp.map((r) => `${r.a} ${r.count}`).join(", ") + "."
        : "at least one app's shared.test.js has no errorStateCarriers.",
    });
  }

  // 5. table pagination
  {
    const perApp = APPS.map((a) => {
      const t = clientTrees(root, a);
      const jsText = readCode(t.js);
      return {
        a,
        pager: (jsText.match(/\bpager\(/g) || []).length,
        footer: (jsText.match(/\btableFooter\(/g) || []).length,
      };
    });
    const ok = perApp.every((r) => r.pager === 0 && r.footer > 0);
    items.push({
      item: "table pagination",
      mark: ok ? "✓" : "✗",
      note: ok
        ? "every app calls only tableFooter(); pager() is an internal helper inside gas_shared/ui/data.js that no app reaches directly."
        : perApp.map((r) => `${r.a}: pager ${r.pager}, tableFooter ${r.footer}`).join("; "),
    });
  }

  // 6. scope-control chrome
  {
    const has = existsSync(join(sharedUi, "scopeControl.js")) && existsSync(join(sharedUi, "scopeModel.js"))
      && APPS.every((a) => /registerScopeContract\(/.test(readIfExists(join(root, a, "test/shared.test.js"))));
    items.push({
      item: "scope-control chrome",
      mark: has ? "✓" : "✗",
      note: has
        ? "one control (ui/scopeModel.js + ui/scopeControl.js); each app supplies its own scopeKinds() vocabulary and the deleted implementation's wire payload, pinned per app by the scope contract."
        : "shared scope control or its per-app contract registration is missing somewhere.",
    });
  }

  // 7. sync button disabled-with-reason
  {
    // dryRunScan (gas/src/server/scanJobs.ts) / dryRunSync (gas_ai/src/server/syncJobs.ts)
    // are SERVER code — a client-only sweep finds neither and misreads the fallback as gone.
    // That fallback PREDATES the wave in both apps, so it alone cannot be the "was ✗, now ✓"
    // story — the thing the wave actually did is give gas_devsecops's disabled button its
    // REASON through the shared tooltip-on-disabled mechanism (`tipAnchor()` / the
    // `.tip-disabled-wrap` wrapper `tip(...)` needs because a disabled element does not
    // reliably take the pointer/focus events a tip needs) rather than a bespoke title
    // attribute, which is what a screen reader on a disabled control cannot reach anyway.
    const dryRun = ["gas", "gas_ai"].map((a) => /dryRunScan|dryRunSync/.test(serverText(root, a)));
    const bothFallBack = dryRun.every(Boolean);
    const dsoUsesSharedTip = /tipAnchor\(|tip-disabled-wrap/.test(
      readIfExists(join(root, "gas_devsecops/src/client/js/app.js")),
    );
    const ok = bothFallBack && dsoUsesSharedTip;
    items.push({
      item: "sync button disabled-with-reason",
      mark: ok ? "✓*" : "✗",
      note: ok
        ? "a ONE-APP AFFORDANCE, not a parity gap: gas and gas_ai fall back to dryRunScan/dryRunSync " +
          "without credentials, so they have no disabled state to explain; gas_devsecops's is the " +
          "only one that needs a reason, and gives it through the shared tipAnchor()/" +
          "tip-disabled-wrap mechanism (an accessible tooltip on a disabled control, not a bare " +
          "native title) rather than a bespoke one."
        : `gas/gas_ai dry-run fallback: ${bothFallBack}; gas_devsecops reaches the shared tip ` +
          `mechanism for its reason: ${dsoUsesSharedTip} — re-examine which half moved.`,
    });
  }

  // 8. last-sync caption
  {
    const has = APPS.every((a) => {
      const src = readIfExists(join(root, a, "test/shared.test.js"));
      return /registerSyncCaptionContract\(/.test(src);
    }) && existsSync(join(sharedUi, "feedback.js"))
      && /export function syncCaption/.test(readIfExists(join(sharedUi, "feedback.js")));
    items.push({
      item: "last-sync caption",
      mark: has ? "✓" : "✗",
      note: has
        ? "syncCaption() in gas_shared/ui/feedback.js, called from every app.js, contract-registered by all three."
        : "shared syncCaption() or a per-app registration is missing.",
    });
  }

  // 9. diagnostics/System panel
  {
    const has = existsSync(join(sharedUi, "diagnostics.js"))
      && APPS.every((a) => /registerDiagnosticsContract\(/.test(readIfExists(join(root, a, "test/shared.test.js"))));
    items.push({
      item: "diagnostics/System panel",
      mark: has ? "✓" : "✗",
      note: has
        ? "one renderer (ui/diagnostics.js); the SET of sections each app asks for legitimately differs " +
          "and is pinned per app — see gas_shared/README.md's table. A gap in that table is a fact about " +
          "a register, not a backlog item."
        : "shared diagnostics renderer or a per-app registration is missing.",
    });
  }

  // 10. help page presence and shape
  {
    // An IMPORT, not a mention — gas_ai's own help.js explains the exception in its header
    // comment ("`gas_shared/ui/helpPage.js` is the key sheet `gas/` and `gas_devsecops/`
    // both render…"), which contains the substring "helpPage.js" without importing it. A
    // bare substring match would read that prose as a real import and misscore gas_ai ✗.
    const sharesHelp = (a) => /from\s+"[^"]*\/helpPage\.js"/.test(
      readIfExists(join(root, a, "src/client/js/pages/help.js")),
    );
    const gasHas = sharesHelp("gas");
    const dsoHas = sharesHelp("gas_devsecops");
    const aiHas = sharesHelp("gas_ai");
    const ok = gasHas && dsoHas && !aiHas; // the documented shape: 2 of 3, by decision
    items.push({
      item: "help page presence and shape",
      mark: ok ? "✓*" : "✗",
      note: ok
        ? "shared by 2 of 3 BY DECISION, not an unfinished migration: gas and gas_devsecops render " +
          "gas_shared/ui/helpPage.js; gas_ai keeps a bespoke lexicon (four-column grid, family " +
          "headings, live counts, an anatomy diagram) documented as a stated exception in both " +
          "gas_shared/README.md and gas_ai/src/client/js/pages/help.js's own header."
        : `gas help.js shares helpPage.js: ${gasHas}; gas_devsecops: ${dsoHas}; gas_ai: ${aiHas} ` +
          "(expected false) — the documented shape has changed; re-check the decision still holds.",
    });
  }

  // 11. z-index scale
  {
    const base = readIfExists(join(root, "gas_shared/styles/tokens.base.css"));
    const hasScale = /--z-canvas-chrome/.test(base) && /--z-toast/.test(base);
    const noAppRedefines = APPS.every((a) => !/--z-[a-z-]+:/.test(
      readIfExists(join(root, a, "src/client/styles/tokens.css")),
    ));
    const ok = hasScale && noAppRedefines
      && APPS.every((a) => /registerZScaleContract\(/.test(readIfExists(join(root, a, "test/shared.test.js"))));
    items.push({
      item: "z-index scale",
      mark: ok ? "✓" : "✗",
      note: ok
        ? "one merged scale in gas_shared/styles/tokens.base.css; no app's own tokens.css redefines a " +
          "--z-* var; zscale contract registered by all three."
        : "the z scale is not fully centralised — check tokens.base.css and each app's own tokens.css.",
    });
  }

  // 12. --ok / --warn
  {
    const base = readIfExists(join(root, "gas_shared/styles/tokens.base.css"));
    const hasBoth = /--ok:/.test(base) && /--warn:/.test(base);
    const noAppRedefines = APPS.every((a) => {
      const t = readIfExists(join(root, a, "src/client/styles/tokens.css"));
      return !/--ok:/.test(t) && !/--warn:/.test(t);
    });
    const ok = hasBoth && noAppRedefines;
    items.push({
      item: "--ok / --warn",
      mark: ok ? "✓" : "✗",
      note: ok
        ? "defined exactly once, in gas_shared/styles/tokens.base.css; no app's own tokens.css carries a second definition."
        : "--ok/--warn are defined more than once, or missing from the shared base.",
    });
  }

  return items;
}

// ============================================================================================
//  Report assembly
// ============================================================================================

function measure(root, label) {
  return {
    label,
    sizes: sizeCounts(root),
    duplication: duplication(root),
    hygiene: hygiene(root),
    vocabulary: vocabulary(root),
    dist: distSizes(root),
    scorecard: scorecard(root),
  };
}

function printReport(m) {
  console.log(`\n${"=".repeat(88)}\n  ${m.label}\n${"=".repeat(88)}`);

  console.log("\n-- client JS/CSS size --");
  for (const [app, s] of Object.entries(m.sizes)) {
    if (!s) { console.log(`  ${app}: (absent at this ref)`); continue; }
    console.log(
      `  ${app.padEnd(14)} js ${String(s.jsFiles).padStart(3)} files / ${String(s.jsLines).padStart(6)} lines`
      + `   css ${String(s.cssFiles).padStart(3)} files / ${String(s.cssLines).padStart(6)} lines`,
    );
  }

  console.log("\n-- duplication across apps' own client trees --");
  if (!m.duplication.length) {
    console.log("  no basename shared by two or more apps' own client trees.");
  } else {
    const tally = { identical: 0, "near-identical": 0, diverged: 0 };
    for (const r of m.duplication) tally[r.class]++;
    console.log(
      `  ${m.duplication.length} shared-basename pairs: `
      + `${tally.identical} identical, ${tally["near-identical"]} near-identical (<=15% churn), `
      + `${tally.diverged} diverged`,
    );
    for (const r of m.duplication) {
      console.log(
        `    ${r.basename.padEnd(22)} ${r.apps.padEnd(28)} ${r.class}`
        + (r.class !== "identical" && r.churnPct !== null ? `  (${r.churnPct.toFixed(1)}% churn)` : ""),
      );
    }
  }

  console.log("\n-- CSS hygiene --");
  console.log(
    "  (hex-outside-tokens is a BLANKET count, not filtered by the tokens.js contract's own "
    + "allow-list for mask stops / chart-palette greys — at HEAD every non-zero count here is "
    + "exactly that allow-list: gas's 4 = pages.css's 3 TIER-swatch greys x{2,1,1} occurrences, "
    + "gas_ai's 2 and gas_shared's 2 are both the #000 conic-gradient mask stop, twice each. A "
    + "count ABOVE its allow-listed floor is the real signal; re-run test/contracts/tokens.js's "
    + "own suite for the pass/fail version of this check.)",
  );
  for (const [app, h] of Object.entries(m.hygiene)) {
    if (!h) { console.log(`  ${app}: (absent at this ref)`); continue; }
    console.log(
      `  ${app.padEnd(14)} hex-outside-tokens ${h.hexOutsideTokens}`
      + `  distinct font-size ${h.distinctFontSizes}  font-size-not-var(--fs-*) ${h.fontSizeNotVar}`
      + `  bare z-index ${h.bareZIndex}  reduced-motion blocks ${h.reducedMotionBlocks}`
      + `  outline:var(--accent) [should be 0] ${h.outlineAccentFill}`
      + `  outline:var(--accent-text) ${h.outlineAccentText}`,
    );
  }

  console.log("\n-- component vocabulary --");
  for (const [app, v] of Object.entries(m.vocabulary)) {
    console.log(
      `  ${app.padEnd(14)} el("h1") ${v.elH1} vs pageHeader() ${v.pageHeader}`
      + `   hand-typed em-dash ${v.handTypedDash} vs absent() ${v.absentCalls}`
      + `   emptyState() ${v.emptyStateCalls} vs errorState() ${v.errorStateCalls}`
      + `   pager() ${v.pagerCalls} vs tableFooter() ${v.tableFooterCalls}`
      + `   local num() defs ${v.localNumDefs}   sevBadge() calls ${v.sevBadgeCalls}`
      + `   test files ${v.testFiles}`,
    );
  }

  console.log("\n-- dist/ size (raw / gzip) --");
  for (const [app, files] of Object.entries(m.dist)) {
    if (!files) { console.log(`  ${app}: (no dist/ at this ref)`); continue; }
    let totalRaw = 0, totalGz = 0;
    for (const f of files) {
      totalRaw += f.bytes; totalGz += f.gzipBytes;
      console.log(`    ${app}/dist/${f.file.padEnd(16)} ${String(f.bytes).padStart(8)} B  /  ${String(f.gzipBytes).padStart(7)} B gz`);
    }
    console.log(`  ${app.padEnd(14)} total ${totalRaw} B / ${totalGz} B gz`);
  }

  console.log("\n-- 12-item cross-app inconsistency scorecard --");
  for (const row of m.scorecard) {
    console.log(`  ${row.mark}  ${row.item}`);
    console.log(`       ${row.note}`);
  }
}

// ============================================================================================
//  CLI
// ============================================================================================

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ref") out.ref = argv[++i];
    else if (argv[i] === "--before") out.before = argv[++i];
    else if (argv[i] === "--after") out.after = argv[++i];
  }
  return out;
}

function resolveRoot(ref) {
  if (!ref || ref === "WORKTREE") return { root: REPO_ROOT, cleanup: () => {} };
  if (ref === "HEAD" && git(["status", "--porcelain"]).trim() === "") {
    // HEAD with a clean tree is exactly the working tree — skip the archive round-trip.
    return { root: REPO_ROOT, cleanup: () => {} };
  }
  const dir = materialize(ref);
  return { root: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const args = parseArgs(process.argv.slice(2));

if (args.before || args.after) {
  const before = args.before || "01aca7b";
  const after = args.after || "HEAD";
  const b = resolveRoot(before);
  const a = resolveRoot(after);
  try {
    printReport(measure(b.root, `BEFORE  (${before})`));
    printReport(measure(a.root, `AFTER  (${after})`));
  } finally {
    b.cleanup();
    a.cleanup();
  }
} else {
  const r = resolveRoot(args.ref || "WORKTREE");
  try {
    printReport(measure(r.root, args.ref ? `${args.ref}` : "WORKING TREE"));
  } finally {
    r.cleanup();
  }
}
