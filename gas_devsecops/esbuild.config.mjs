// Bundles the TypeScript server code into a single IIFE (global `Server`) that GAS V8
// can run, and inlines the client JS/CSS into HtmlService partials. `dist/entry.js` and
// `dist/appsscript.json` are hand-maintained and never overwritten here.
import { build } from "esbuild";
import { buildStamp } from "./buildStamp.mjs";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

// Build stamps (see buildStamp.mjs — shared with the dev harness so both bundles agree).
const STAMP = buildStamp(root);
const STAMP_DEFINE = STAMP.define;

// --- Server bundle -------------------------------------------------------------------
await build({
  entryPoints: [join(root, "src/server/index.ts")],
  bundle: true,
  format: "iife",
  globalName: "Server",
  target: "es2019",
  define: STAMP_DEFINE,
  outfile: join(dist, "server.js"),
  logLevel: "info",
});

// --- Client bundle → HtmlService partials --------------------------------------------
// GAS serves HTML files only; JS/CSS ship as <?!= include('...') ?> partials. The client
// bundle is wrapped in <script> tags; styles.html is copied with a <style> wrapper.
const clientResult = await build({
  entryPoints: [join(root, "src/client/js/app.js")],
  bundle: true,
  format: "iife",
  target: "es2019",
  define: STAMP_DEFINE,
  // Lower template literals to string concatenation. Corporate SSL-inspection
  // proxies have been observed "stripping comments" from the served bundle with a
  // tokenizer that understands quoted strings but not template literals: a bare
  // `//` inside a backtick string (an https URL) truncated the line, left the
  // backticks unbalanced, and killed the whole app with a SyntaxError. No backticks
  // in the output = no line of the bundle can be re-lexed that way.
  supported: { "template-literal": false },
  // Minified — the bundle ships inline in every doGet response, so size is first-paint
  // latency. The middlebox guard below re-checks the minified output, so any construct
  // minification introduces that the proxy would corrupt still fails the build.
  minify: true,
  write: false,
  logLevel: "info",
});
const clientJs = clientResult.outputFiles[0].text;

// --- Middlebox resilience guard -------------------------------------------------------
// Replay the proxy's observed rewrite (comment stripping that is string-aware but
// template/regex-unaware) and require the result to still compile. Fails the build if a
// future change reintroduces a construct the middlebox would corrupt in transit.
function stripCommentsLikeMiddlebox(code) {
  let out = "", i = 0, quote = null;
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < code.length && code[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}
function guardJs(label, code) {
  if (code.includes("`")) {
    throw new Error(`middlebox guard: ${label} still contains backticks`);
  }
  const stripped = stripCommentsLikeMiddlebox(code);
  if (stripped.includes("//")) {
    const line = stripped.slice(0, stripped.indexOf("//")).split("\n").length;
    throw new Error(`middlebox guard: bare \`//\` survives comment stripping in ${label} (in a string/regex) near stripped line ${line}`);
  }
  try {
    new Function(stripped);
  } catch (e) {
    throw new Error(`middlebox guard: ${label} breaks under comment stripping — ${e.message}`);
  }
}
guardJs("client bundle", clientJs);

writeFileSync(join(dist, "js_app.html"), `<script>\n${clientJs}\n</script>\n`);

// --- Charts bundle → its own partial ---------------------------------------------------
// Chart.js is 170,785 bytes of the client bundle above and no route needs it before it draws
// a chart, so it is built separately and fetched over google.script.run on the first one that
// does. See src/client/js/chartsLoader.js for the whole argument, including the part that
// cannot be verified from here.
//
// SAME SETTINGS, SAME GUARD, deliberately. This bundle crosses the same corporate proxies as
// js_app.html — as an XHR body rather than inside the document, which is a weaker exposure
// than the one that produced the guard, not a different one — and it is executed from text on
// arrival, so a rewrite in transit fails exactly the same way. Holding a constraint the main
// bundle already meets costs nothing. It is written as an HTML partial rather than a .js file
// because that is the only kind of file a GAS project holds — `include()` and
// `createHtmlOutputFromFile` both read HTML — and api.getChartsBundle unwraps it.
const chartsResult = await build({
  entryPoints: [join(root, "src/client/js/chartsBundle.js")],
  bundle: true,
  format: "iife",
  target: "es2019",
  define: STAMP_DEFINE,
  supported: { "template-literal": false },
  minify: true,
  write: false,
  logLevel: "info",
});
const chartsJs = chartsResult.outputFiles[0].text;
guardJs("charts bundle", chartsJs);
writeFileSync(join(dist, "js_charts.html"), `<script>\n${chartsJs}\n</script>\n`);

// --- Client stylesheet → HtmlService partial -------------------------------------------
// Bundled (so styles.css can be an @import index over styles/*.css) and minified: this
// ships inline in every doGet response exactly like the JS, so its bytes are first-paint
// latency too. It used to be copied through verbatim.
const cssResult = await build({
  entryPoints: [join(root, "src/client/styles.css")],
  bundle: true,
  minify: true,
  write: false,
  logLevel: "info",
});
const css = cssResult.outputFiles[0].text;

// The middlebox strips comments from the whole served document, not just the <script>
// partial — a bare `//` surviving in the stylesheet would truncate the rest of its line
// and take every rule after it on that line with it. CSS has no `//` comment syntax, so
// any hit here is inside a string or a url() and is a real hazard.
const strippedCss = stripCommentsLikeMiddlebox(css);
if (strippedCss.includes("//")) {
  const at = strippedCss.indexOf("//");
  throw new Error(
    `middlebox guard: bare \`//\` survives comment stripping in the stylesheet near ` +
    `${JSON.stringify(strippedCss.slice(Math.max(0, at - 60), at + 20))}`,
  );
}

writeFileSync(join(dist, "styles.html"), `<style>\n${css}\n</style>\n`);

// index.html is copied verbatim (it contains <?!= include(...) ?> scriptlets).
writeFileSync(join(dist, "index.html"), readFileSync(join(root, "src/client/index.html"), "utf8"));

// --- entry.js drift guard --------------------------------------------------------------
// dist/entry.js is hand-written and hand-maintained: GAS resolves google.script.run targets
// against top-level global functions, so the 22 `function api_x(p) { return timedApi_("x", p) }`
// delegators CANNOT be generated by a loop. The repetition is forced by the platform — but
// nothing was checking that the hand-written list still matches what api.ts exports, so a
// new endpoint could ship unreachable and a deleted one could leave a delegator that throws
// at call time. Both fail the build now.
const entryJs = readFileSync(join(dist, "entry.js"), "utf8");
const apiTs = readFileSync(join(root, "src/server/api.ts"), "utf8");
const declared = new Set(
  [...entryJs.matchAll(/function api_(\w+)\s*\(/g)].map((m) => m[1]),
);
const exported = new Set(
  [...apiTs.matchAll(/^export function (\w+)\s*\(/gm)].map((m) => m[1]),
);
const missing = [...exported].filter((n) => !declared.has(n));
const stale = [...declared].filter((n) => !exported.has(n));
if (missing.length || stale.length) {
  throw new Error(
    "entry.js guard: dist/entry.js and src/server/api.ts disagree" +
    (missing.length ? `\n  exported by api.ts but unreachable from GAS: ${missing.join(", ")}` : "") +
    (stale.length ? `\n  delegated in entry.js but not exported: ${stale.join(", ")}` : ""),
  );
}

console.log(`build ok: ${readdirSync(dist).join(", ")}`);
console.log(`  stamp ${STAMP.id}  (npm run which-build ${STAMP.id})`);
