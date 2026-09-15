#!/usr/bin/env node
// A Playwright walker over the DevSecOps SPA's OWN routes — the rendered-page complement of
// gas_shared/measure.mjs. That script measures the SOURCE (line counts, greps, a scorecard).
// This one measures what a reader actually SEES when a route settles: words, bare numbers,
// table cells, pictures — the wave's whole claim ("less text, fewer simultaneous figures,
// information carried visually") is a claim about THIS, not about source line counts, and
// nothing in this repo checked it before R6.
//
// USAGE
//   node dev/density.mjs --port 8789 [--root <app dir>] [--viewports 1280,640,360]
//                         [--routes a,b] [--noseed] [--experimental] [--out file.json]
//                         [--playwright <module path>]
//   node dev/density.mjs --diff before.json after.json
//
// `--experimental` IS WHY A GATED ROUTE STOPPED SILENTLY DUPLICATING ANOTHER ROW. A route
// behind `gas_shared/shell/experimental.js`'s flag (gas_ai's `#/aars`) redirects to the
// app's default route the instant the router sees it is off, and that redirect makes the
// gated route's numbers read as a real measurement of a page that in fact never rendered —
// the wave's own baseline and close both carried an `aars` row byte-identical to `problems`
// for exactly this reason. Before EVERY navigation in a walk, this flag has Playwright run
// `context.addInitScript()` so `localStorage.setItem("<storagePrefix>showExperimental", "1")`
// is set before the app's own JS ever runs — the same key
// `gas_shared/shell/experimental.js`'s `key()` composes, built from `MANIFEST.storagePrefix`
// (`densityModel.mjs`'s `parseStoragePrefix()`, read off `--root`'s own app.js the same way
// `parsePages()` reads its route table). Refuses rather than walking half-blind if that app's
// `app.js` carries no `storagePrefix` to compose the key from.
//
// ROUTES COME FROM app.js's OWN PAGES TABLE (densityModel.mjs's `parsePages`, the exact regex
// test/pagesLit.test.js's own parser uses), never hand-typed here — a renamed or added route
// shows up next run with no second list to forget.
//
// `--root` IS WHY THIS WALKS FOUR APPS FROM ONE FILE. The route table, the git sha and the
// report's own label all come from ONE directory, which defaulted to this script's own parent
// and so could only ever be gas_devsecops. `parsePages()` was already generic — the PAGES
// literal has the same two-space `key: {` shape in all four apps' `src/client/js/app.js`,
// which is a fact this file MEASURES (it refuses an empty walk) rather than assumes — so
// pointing the root at `../gas`, `../gas_ai` or `../gas_hub` and the port at that app's own
// dev server is the whole of what a cross-app run needs. A shared-CSS change is invisible to
// a walker that can only see one app; F2's promotion of the tip underline into
// `gas_shared/styles/components.css` is exactly that change, and this flag is how its blast
// radius was measured rather than eyeballed. (Promoting the walker itself into `gas_shared/`
// is the structural answer and is deliberately not this round.)
//
// EVERY COUNT IS DERIVED, NOT TYPED (gas_shared/measure.mjs's own rule) — every figure below
// comes from walking the ACTUAL rendered DOM of the actual dev server, every run.
//
// PLAYWRIGHT IS NEVER INSTALLED BY THIS SCRIPT. Chromium is preinstalled here
// (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and `playwright install` is a network call
// this tool must never make. Loading the PACKAGE is separate from loading the BROWSER:
// `--playwright <path>` points this script at a `playwright` install off gas_devsecops's own
// node_modules chain (a global install, or a scratch one); the browser binary is found via
// the environment variable above regardless of which package loads it.
//
// WHAT THIS FILE MUST NOT DO: decide what counts as a word, a number, a prose block, or a
// diff — those are pure questions with pure answers, and densityModel.mjs holds them so
// vitest can pin them with no browser. This file's job is opening pages, waiting for them to
// settle, and pulling raw material (a serialized DOM subtree, a scrollWidth, which triggers
// opened on focus) out of a live Chromium.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  countNumericTokens, countVisible, countVisuals, countWords, collectProseBlocks, diffReport,
  extractText, formatDiffTable, formatTable, isTipSignified, overflowSummary, parsePages,
  parseStoragePrefix, PROSE_MIN_WORDS,
} from "./densityModel.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)); // …/gas_devsecops/dev
const DEFAULT_APP_ROOT = dirname(HERE); // …/gas_devsecops — the app this script lives in
const DEFAULT_VIEWPORTS = [1280, 640, 360];
const SETTLE_MS = 350; // short settle after skeletons clear: chart draw, one layout tick
const SKELETON_TIMEOUT_MS = 8000;

// ---- CLI ----

function usage() {
  return [
    "Usage:",
    "  node dev/density.mjs --port <n> [--root <app dir>] [--viewports 1280,640,360]",
    "                        [--routes a,b] [--noseed] [--experimental] [--out file.json]",
    "                        [--playwright <module path>]",
    "  node dev/density.mjs --diff before.json after.json",
    "",
    "  --experimental  Set <storagePrefix>showExperimental=1 in localStorage before every",
    "                  navigation, so a route gated behind Settings -> Show experimental",
    "                  content (gas_ai's #/aars) actually renders instead of redirecting to",
    "                  the app's default route and reporting that route's numbers again.",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    viewports: DEFAULT_VIEWPORTS, noseed: false, experimental: false, root: DEFAULT_APP_ROOT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--root") out.root = resolve(argv[++i]);
    else if (a === "--viewports") out.viewports = argv[++i].split(",").map(Number);
    else if (a === "--routes") out.routes = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--noseed") out.noseed = true;
    else if (a === "--experimental") out.experimental = true;
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--playwright") out.playwright = argv[++i];
    else if (a === "--diff") { out.diff = [argv[++i], argv[++i]]; }
    else { console.error(`Unrecognised argument: ${a}\n\n${usage()}`); process.exit(2); }
  }
  return out;
}

// ---- Loading Playwright — never `playwright install`, see the header ----

/** A package DIRECTORY -> its ESM entry, via its own package.json — so `--playwright`
 *  accepts a package dir (a global install) or an exact entry file, caller's choice. */
function resolveEntry(path) {
  if (!existsSync(path)) return path;
  if (!statSync(path).isDirectory()) return path;
  const pkgPath = join(path, "package.json");
  if (!existsSync(pkgPath)) return path;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const exp = pkg.exports && pkg.exports["."];
  const entry = (exp && (exp.import || exp.default)) || pkg.module || pkg.main || "index.js";
  return join(path, entry);
}

async function loadPlaywright(pathArg) {
  const isPathLike = pathArg && (isAbsolute(pathArg) || pathArg.startsWith(".") || existsSync(pathArg));
  const target = pathArg ? resolveEntry(pathArg) : "playwright";
  try {
    return isPathLike ? await import(pathToFileURL(target).href) : await import(target);
  } catch (e) {
    console.error(`Could not load Playwright (${target}): ${e.message}`);
    console.error('Install it with "npm i -D playwright" (a scratch directory is fine — this '
      + "script never installs it itself), or pass --playwright <package dir or entry file>. "
      + "Chromium is already at PLAYWRIGHT_BROWSERS_PATH; only the npm package must be reachable.");
    process.exit(2);
  }
}

/** Falls back to the preinstalled binary's exact path on a version mismatch — never a
 *  `playwright install` retry, per the header. */
async function launchChromium(chromium) {
  try {
    return await chromium.launch({ headless: true });
  } catch (e) {
    console.error(`Default Chromium launch failed (${e.message}); retrying with the exact `
      + "preinstalled binary path.");
    return chromium.launch({ headless: true, executablePath: "/opt/pw-browsers/chromium" });
  }
}

// ---- Serializing a live page into the plain-object tree densityModel.mjs's pure functions read ----

/** Runs INSIDE the page (page.evaluate). Self-contained on purpose — no reference to any
 *  module-level helper — because page.evaluate() ships this function's SOURCE TEXT into the
 *  browser and re-declares it there; a closure over this file's imports would simply be
 *  undefined on the other side. */
function serializeMain() {
  function serialize(node) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      return t && t.trim() ? t : null;
    }
    if (node.nodeType !== 1) return null;
    const tag = node.tagName;
    const classes = Array.from(node.classList || []);
    const out = { tag, classes, hidden: node.hasAttribute("hidden"), children: [] };
    if (tag === "DETAILS") out.open = node.hasAttribute("open");
    if (tag === "SVG" || tag === "CANVAS") {
      const r = node.getBoundingClientRect();
      out.rect = { width: r.width, height: r.height };
    }
    for (const child of node.childNodes) {
      const c = serialize(child);
      if (c !== null) out.children.push(c);
    }
    return out;
  }
  const root = document.querySelector("main") || document.querySelector("#app");
  return root ? { tag: root.tagName, root: true, tree: serialize(root) } : null;
}

// ---- One route, one viewport ----

function buildUrl(port, route, noseed) {
  const q = noseed ? "?dry&noseed" : "?dry";
  return `http://localhost:${port}/${q}#/${route}`;
}

/**
 * Runs INSIDE the page (element.evaluate), on ONE trigger — self-contained for the same
 * reason `serializeMain` above is: the source text ships to the browser as a string and is
 * re-declared there, so a closure over this file's own imports would be `undefined` on the
 * other side.
 *
 * Returns the plain record `densityModel.mjs`'s `isTipSignified()` decides over: whether the
 * TRIGGER carries a resting underline (checked on the trigger itself first, then on its first
 * text-bearing descendant — a trigger built by wrapping an already-underlined span would
 * otherwise read as bare), and every class riding on any descendant element (so the model can
 * ask whether an atomic affordance child — `.pill`, `.tip-mark`, … — is present without this
 * function having to know the list itself; that list is the model's, not the walker's).
 */
function readTipSignifier(el) {
  function hasUnderline(node) {
    return !!node && node.nodeType === 1
      && getComputedStyle(node).textDecorationLine.split(/\s+/).includes("underline");
  }
  function firstTextBearingElement(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3 && child.nodeValue && child.nodeValue.trim()) return node;
      if (child.nodeType === 1) {
        const found = firstTextBearingElement(child);
        if (found) return found;
      }
    }
    return null;
  }
  let decoration = getComputedStyle(el).textDecorationLine;
  if (!decoration.split(/\s+/).includes("underline")) {
    const holder = firstTextBearingElement(el);
    if (holder && holder !== el && hasUnderline(holder)) decoration = "underline";
  }
  const childClasses = [];
  (function walk(node) {
    for (const child of node.children) {
      childClasses.push(...Array.from(child.classList));
      walk(child);
    }
  }(el));
  return { decoration, childClasses };
}

/** Tab to every VISIBLE `.tip-trigger` and ask whether the shared `.tip` card (one node,
 *  portaled — see gas_shared/ui/tip.js's own header) opens on focus. Reported by TRIGGER
 *  TEXT, not just a count, so a failure names the tip a keyboard user actually cannot reach.
 *
 *  `:visible`, not a bare `.tip-trigger`: a settings TAB panel this page is not showing right
 *  now (`[hidden]`, see densityModel.mjs's own header) still has real `.tip-trigger` buttons
 *  in the DOM, and `.focus()` on one sitting under a `display:none` ancestor is a silent
 *  browser no-op — the first live run of this walker reported that as a keyboard-
 *  reachability FAILURE, which was a bug in the walker counting an off-screen tab, not a bug
 *  in the page. */
async function measureTips(page) {
  const triggers = page.locator(".tip-trigger:visible");
  const count = await triggers.count();
  const failures = [];
  const unsignified = [];
  for (let i = 0; i < count; i++) {
    const trigger = triggers.nth(i);
    const label = ((await trigger.textContent()) || "").trim().replace(/\s+/g, " ") || `#${i}`;
    await trigger.focus();
    // Focus is the zero-delay path in tipPlace.js's tipDelay() — no cold-open wait needed —
    // but a settle margin is cheap and keeps this off a real race with the open transition.
    await page.waitForTimeout(60);
    const open = await page.locator(".tip.open").count();
    if (open === 0) failures.push(label);
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    const record = await trigger.evaluate(readTipSignifier);
    if (!isTipSignified(record)) unsignified.push(label);
  }
  return {
    tips: count,
    tipsReachable: count - failures.length,
    tipsSignified: count - unsignified.length,
    tipFailures: failures,
    tipsUnsignified: unsignified,
  };
}

async function measureRoute(page, port, route, viewportWidth, noseed) {
  const url = buildUrl(port, route, noseed);
  const consoleErrors = [];
  const onConsole = (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); };
  const onPageError = (err) => consoleErrors.push(String(err));
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  let settled = true;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
  } catch {
    // networkidle can fail to quiesce on a page holding an open long-poll or a timer this
    // dev harness legitimately keeps running; the skeleton check right below is the real
    // settle gate, so a networkidle timeout alone does not fail the route.
  }
  try {
    await page.waitForFunction(
      () => document.querySelectorAll(".skeleton").length === 0,
      { timeout: SKELETON_TIMEOUT_MS },
    );
  } catch {
    settled = false;
  }
  await page.waitForTimeout(SETTLE_MS);
  const skeletonsLeft = await page.locator(".skeleton").count();
  if (skeletonsLeft > 0) settled = false;

  const serialized = await page.evaluate(serializeMain);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const tips = await measureTips(page);

  page.off("console", onConsole);
  page.off("pageerror", onPageError);

  if (!serialized) {
    return {
      settled: false, error: "no <main> or #app found", scrollWidth, viewportWidth,
      words: 0, proseBlocks: 0, proseWords: 0, numbers: 0, tableCells: 0, tables: 0,
      visuals: countVisuals(null), ...tips, consoleErrors,
    };
  }

  const tree = serialized.tree;
  const prose = collectProseBlocks(tree, PROSE_MIN_WORDS);
  return {
    settled,
    words: countWords(extractText(tree, { excludeTables: true })),
    proseBlocks: prose.length,
    proseWords: prose.reduce((s, p) => s + p.words, 0),
    numbers: countNumericTokens(extractText(tree, { excludeTables: false })),
    tableCells: countVisible(tree, (n) => n.tag === "TD"),
    tables: countVisible(tree, (n) => n.tag === "TABLE"),
    visuals: countVisuals(tree),
    scrollWidth,
    viewportWidth,
    ...tips,
    consoleErrors,
  };
}

// ---- Reporting ----

const MAIN_COLUMNS = [
  ["route", (r) => r.route],
  ["words", (r) => r.words],
  ["proseBlocks", (r) => r.proseBlocks],
  ["proseWords", (r) => r.proseWords],
  ["numbers", (r) => r.numbers],
  ["tableCells", (r) => r.tableCells],
  ["visuals", (r) => r.visuals.total],
  ["tips", (r) => r.tips],
  ["tipsReachable", (r) => r.tipsReachable],
  ["tipsSignified", (r) => r.tipsSignified],
  ["scrollWidth", (r) => r.scrollWidth],
];

function printMainTable(routeRows) {
  const headers = MAIN_COLUMNS.map(([k]) => k);
  const rows = routeRows.map((r) => MAIN_COLUMNS.map(([, get]) => get(r)));
  console.log(formatTable(headers, rows));
}

function gitSha(appRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: appRoot, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// ---- Diff mode ----

function runDiff(beforePath, afterPath) {
  const before = JSON.parse(readFileSync(beforePath, "utf8"));
  const after = JSON.parse(readFileSync(afterPath, "utf8"));
  const rows = diffReport(before, after, "1280");
  console.log(`\n${before.meta && before.meta.label ? before.meta.label : beforePath}`
    + ` -> ${after.meta && after.meta.label ? after.meta.label : afterPath} (viewport 1280)\n`);
  console.log(formatDiffTable(rows));
  const unmoved = rows.filter((r) => Object.values(r.diff).every((d) => d.delta === 0));
  if (unmoved.length) {
    console.log(`\n${unmoved.length} route(s) moved on NOT ONE metric: `
      + `${unmoved.map((r) => r.route).join(", ")} — a finding, per CLAUDE.md, not a pass.`);
  }
}

// ---- Measure mode ----

async function runMeasure(args) {
  if (!args.port) {
    console.error(`--port is required for a measurement run.\n\n${usage()}`);
    process.exit(2);
  }
  const appRoot = args.root;
  const appName = basename(appRoot);
  const appJs = join(appRoot, "src/client/js/app.js");
  if (!existsSync(appJs)) {
    console.error(`--root ${appRoot} has no src/client/js/app.js — that is not one of this `
      + "design system's apps, and walking it would report someone else's routes.");
    process.exit(2);
  }
  const appSrc = readFileSync(appJs, "utf8");
  const allRoutes = parsePages(appSrc).map((p) => p.route);
  // THE REFUSAL IS THE POINT OF `--root`, not a formality: `parsePages()` returning [] on a
  // sibling app would print a clean, empty, entirely believable table. A zero has to prove it
  // looked (CLAUDE.md), so an empty route list ends the run instead of reporting it.
  if (!allRoutes.length) {
    console.error(`parsePages() found no routes in ${appJs}'s PAGES table — refusing to report `
      + "an empty walk as a measurement.");
    process.exit(1);
  }
  const routes = args.routes && args.routes.length
    ? allRoutes.filter((r) => args.routes.includes(r))
    : allRoutes;
  const missing = (args.routes || []).filter((r) => !allRoutes.includes(r));
  if (missing.length) {
    console.error(`--routes named route(s) not in app.js's PAGES table: ${missing.join(", ")}`);
    process.exit(2);
  }

  // `--experimental`'s whole key, off the SAME app.js text `allRoutes` above was read from —
  // see the file header. Computed and checked before Chromium even launches: a walk that
  // opened a browser and then discovered it could not compose the key would still have spent
  // the time the refusal exists to save.
  const storagePrefix = args.experimental ? parseStoragePrefix(appSrc) : null;
  if (args.experimental && storagePrefix == null) {
    console.error(`--experimental needs MANIFEST.storagePrefix in ${appJs}, and `
      + "parseStoragePrefix() found none — refusing to write a localStorage key no app.js "
      + "would ever compose.");
    process.exit(2);
  }

  const pw = await loadPlaywright(args.playwright);
  const browser = await launchChromium(pw.chromium);

  const doc = {
    meta: {
      app: appName, root: appRoot,
      sha: gitSha(appRoot), when: new Date().toISOString(), port: args.port,
      viewports: args.viewports, noseed: args.noseed, experimental: args.experimental,
    },
    routes: {},
  };

  try {
    for (const width of args.viewports) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      if (args.experimental) {
        // Runs before EVERY document this context loads, not just the first — Playwright
        // re-injects it on every navigation, which is what a walk across several `--routes`
        // in one context needs. Set from the same string experimental.js's own `key()`
        // composes (`<storagePrefix>showExperimental`), so a gated route sees exactly the
        // flag a real reader who flipped Settings -> Show experimental content would have
        // left behind.
        await context.addInitScript((key) => {
          try { localStorage.setItem(key, "1"); } catch { /* sandboxed storage */ }
        }, `${storagePrefix}showExperimental`);
      }
      const page = await context.newPage();
      for (const route of routes) {
        const result = await measureRoute(page, args.port, route, width, args.noseed);
        doc.routes[route] = doc.routes[route] || {};
        doc.routes[route][String(width)] = result;
        const tag = `${route} @ ${width}px`;
        if (!result.settled) console.error(`WARNING: ${tag} did not settle (a .skeleton `
          + "was still present after the wait) — its counts are suspect, not a measurement.");
        if (result.consoleErrors.length) console.error(`WARNING: ${tag} logged console `
          + `error(s): ${result.consoleErrors.join(" | ")}`);
        if (result.tipsUnsignified && result.tipsUnsignified.length) {
          console.error(`WARNING: ${tag} has a tip-trigger with NO resting affordance (no `
            + "underline, no atomic affordance child) — a leak to investigate, per CLAUDE.md, "
            + `not a number to report and move on: ${result.tipsUnsignified.join(" | ")}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (args.out) {
    writeFileSync(args.out, JSON.stringify(doc, null, 2));
    console.log(`Wrote ${args.out}`);
  }

  const primary = String(args.viewports[0]);
  const mainRows = routes.map((route) => {
    const r = doc.routes[route][primary];
    return { route, ...r };
  });
  const suspicious = mainRows.filter((r) => r.words === 0);
  console.log(`\n== ${appName} density @ ${primary}px `
    + `(sha ${doc.meta.sha ? doc.meta.sha.slice(0, 12) : "unknown"}, ${doc.meta.when}) ==\n`);
  printMainTable(mainRows);
  if (suspicious.length) {
    console.log(`\nSUSPECT: 0 words at ${primary}px on ${suspicious.map((r) => r.route).join(", ")}`
      + " — investigate before trusting this run (a page with visible prose reading 0 means "
      + "the walker missed something, not that the page is silent).");
  }
  console.log("");
  for (const width of args.viewports) {
    const rows = routes.map((route) => ({ route, scrollWidth: doc.routes[route][String(width)].scrollWidth }));
    console.log(`  ${width}px: ${overflowSummary(rows, width)}`);
  }
}

// ---- Entry ----

const args = parseArgs(process.argv.slice(2));
if (args.diff) {
  runDiff(args.diff[0], args.diff[1]);
} else {
  await runMeasure(args);
}
