// The page GAS serves, rendered from one template for three apps.
//
// `src/client/index.html` was three files of 97 lines that differed in FOUR PLACES: the
// product name in the splash label and in the <noscript>, and the opening noun in the
// progressbar's accessible name and in the splash note. Everything else — the HtmlService
// scriptlets, the ~60-line inline brand mark, the whole splash structure — was byte-identical.
// Both variables are already in each app's MANIFEST, so the template holds them as
// placeholders and this function fills them in at build time.
//
// WHY THE VALUES ARE PARSED OUT OF app.js RATHER THAN PASSED IN. The manifest is the one
// place each app names itself (`gas_shared/appConfig.js`), and a build script holding its own
// copy of the two strings would be exactly the drift this merge removes — gas_devsecops
// shipped "Opening the graph…" over a register with no graph for its whole life, because the
// copy lived in a file nobody re-reads. Parsing is narrow and loud: the two keys are simple
// string literals inside `const MANIFEST = {`, and a miss throws rather than rendering a page
// with a `{{placeholder}}` in it.
//
// Node-only. It is imported by each app's esbuild.config.mjs and by the brandMark contract
// (which asserts against what the build actually emits), never by the client bundle.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const TEMPLATE = new URL("./index.template.html", import.meta.url);

/** The keys the template needs, and nothing else. Adding one means adding a placeholder. */
const KEYS = ["productName", "openingNoun"];

/**
 * Read one string-valued manifest key out of an app's app.js source.
 *
 * Scoped to the `const MANIFEST = {` block so a same-named key in a comment or in a page
 * import cannot answer for it, and required to be a plain double-quoted literal — the two
 * values the splash paints have to be readable without evaluating a module that touches
 * `document` at import time.
 */
function manifestValue(appSrc, key) {
  const start = appSrc.indexOf("const MANIFEST = {");
  if (start === -1) throw new Error("renderIndexHtml(): no `const MANIFEST = {` in app.js");
  const block = appSrc.slice(start, appSrc.indexOf("\n};", start));
  const m = block.match(new RegExp("\\n\\s*" + key + ':\\s*"([^"]*)"'));
  if (!m || !m[1]) {
    throw new Error("renderIndexHtml(): MANIFEST." + key + " is missing or not a string literal");
  }
  return m[1];
}

/**
 * The rendered `index.html` for the app rooted at `appRoot`.
 *
 * @param {string|URL} appRoot  the app package directory (the one holding src/ and dist/)
 * @returns {string}
 */
export function renderIndexHtml(appRoot) {
  const root = typeof appRoot === "string" ? appRoot : fileURLToPath(appRoot);
  const appSrc = readFileSync(resolve(root, "src/client/js/app.js"), "utf8");
  let html = readFileSync(TEMPLATE, "utf8");
  for (const key of KEYS) {
    const value = manifestValue(appSrc, key);
    html = html.split("{{" + key + "}}").join(value);
  }
  // A placeholder that survived is a template that gained a variable the manifest has not.
  // Loud here rather than served: this file paints before any script runs, so a `{{...}}` in
  // it is the first thing a reader sees and nothing downstream would fail on it.
  const left = html.match(/\{\{[a-zA-Z]+\}\}/);
  if (left) throw new Error("renderIndexHtml(): unsubstituted placeholder " + left[0]);
  return html;
}
