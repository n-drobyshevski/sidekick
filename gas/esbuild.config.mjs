// Bundles the TypeScript server code into a single IIFE (global `Server`) that GAS V8
// can run, and inlines the client JS/CSS into HtmlService partials. `dist/entry.js` and
// `dist/appsscript.json` are hand-maintained and never overwritten here.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

// --- Server bundle -------------------------------------------------------------------
await build({
  entryPoints: [join(root, "src/server/index.ts")],
  bundle: true,
  format: "iife",
  globalName: "Server",
  target: "es2019",
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
  // Lower template literals to string concatenation. Corporate SSL-inspection
  // proxies have been observed "stripping comments" from the served bundle with a
  // tokenizer that understands quoted strings but not template literals: a bare
  // `//` inside a backtick string (an https URL) truncated the line, left the
  // backticks unbalanced, and killed the whole app with a SyntaxError. No backticks
  // in the output = no line of the bundle can be re-lexed that way.
  supported: { "template-literal": false },
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
if (clientJs.includes("`")) {
  throw new Error("middlebox guard: client bundle still contains backticks");
}
const strippedClientJs = stripCommentsLikeMiddlebox(clientJs);
if (strippedClientJs.includes("//")) {
  const line = strippedClientJs.slice(0, strippedClientJs.indexOf("//")).split("\n").length;
  throw new Error(`middlebox guard: bare \`//\` survives comment stripping (in a string/regex) near stripped line ${line}`);
}
try {
  new Function(strippedClientJs);
} catch (e) {
  throw new Error(`middlebox guard: bundle breaks under comment stripping — ${e.message}`);
}

writeFileSync(join(dist, "js_app.html"), `<script>\n${clientJs}\n</script>\n`);

const css = readFileSync(join(root, "src/client/styles.css"), "utf8");
writeFileSync(join(dist, "styles.html"), `<style>\n${css}\n</style>\n`);

// index.html is copied verbatim (it contains <?!= include(...) ?> scriptlets).
writeFileSync(join(dist, "index.html"), readFileSync(join(root, "src/client/index.html"), "utf8"));

console.log("build ok:", readdirSync(dist).join(", "));
