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
  write: false,
  logLevel: "info",
});
const clientJs = clientResult.outputFiles[0].text;
writeFileSync(join(dist, "js_app.html"), `<script>\n${clientJs}\n</script>\n`);

const css = readFileSync(join(root, "src/client/styles.css"), "utf8");
writeFileSync(join(dist, "styles.html"), `<style>\n${css}\n</style>\n`);

// index.html is copied verbatim (it contains <?!= include(...) ?> scriptlets).
writeFileSync(join(dist, "index.html"), readFileSync(join(root, "src/client/index.html"), "utf8"));

console.log("build ok:", readdirSync(dist).join(", "));
