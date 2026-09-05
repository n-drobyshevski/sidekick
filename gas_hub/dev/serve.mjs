// Local dev server for UI/UX work on the GAS web app: composes the same page GAS
// would serve (index.html with the styles/js_app includes resolved) plus the GAS
// service fakes (gas-shims.js), the real Server bundle, and the boot script.
//
//   npm run dev   →  http://localhost:8787
//
// Every load of "/" reruns the esbuild build, so editing src/client/** or
// src/server/** and refreshing the browser is the whole loop. State is in-memory
// and reseeded per load (three plausible sibling URLs; see dev/boot.js).
//
// TRIMMED FROM gas_devsecops/dev/serve.mjs, and what is gone says what this app is. The
// credentials block (ENV_FILES, /_fetch, window.__WIZ_DEV__) went because this app never
// makes an outbound call — its manifest does not even ask for script.external_request — so
// there is no secret to hold back from the page and no request to proxy. The dev-only
// sampleData esbuild alias went with the sample data: the hub has no ledger to seed.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildStamp } from "../buildStamp.mjs";

const gasRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);

const SCRIPTS = {
  "/gas-shims.js": () => readFileSync(join(gasRoot, "dev/gas-shims.js"), "utf8"),
  "/server.js": () => readFileSync(join(gasRoot, "dev/server.dev.js"), "utf8"),
  "/boot.js": () => readFileSync(join(gasRoot, "dev/boot.js"), "utf8"),
};

/**
 * HtmlService partials, for the shim behind `Server.include`.
 *
 * In GAS these are files in the script project and `createHtmlOutputFromFile` reads them
 * straight off the runtime. Here the "server" is a bundle running in the browser, so a
 * partial has to come back over HTTP — see the HtmlService shim in dev/gas-shims.js. Served
 * as text/plain because it is HTML being read as data, never parsed as a document.
 *
 * Nothing in this app calls it today (dev/serve.mjs composes index.html itself, below, and
 * there is no charts bundle to fetch over RPC), so this is the shim's backstop rather than a
 * live path: it keeps `HtmlService.createHtmlOutputFromFile` answering with the real file
 * instead of throwing, if anything ever asks.
 */
const PARTIALS = {
  "/_partial/styles": () => readFileSync(join(gasRoot, "dist/styles.html"), "utf8"),
  "/_partial/js_app": () => readFileSync(join(gasRoot, "dist/js_app.html"), "utf8"),
};

// Dev server bundle: identical to dist/server.js. Built separately only so it can be served
// from this process rather than read out of dist/ — same entry point, same stamp.
async function buildDevServer() {
  await build({
    entryPoints: [join(gasRoot, "src/server/index.ts")],
    bundle: true,
    format: "iife",
    globalName: "Server",
    target: "es2019",
    // The same stamp the client bundle gets, so the Settings build card compares like
    // with like. Without it the dev server reports a mismatch that isn't one.
    define: buildStamp(gasRoot).define,
    outfile: join(gasRoot, "dev/server.dev.js"),
    logLevel: "silent",
  });
}

async function composeIndex() {
  execFileSync(process.execPath, ["esbuild.config.mjs"], { cwd: gasRoot, stdio: "pipe" });
  await buildDevServer();
  let html = readFileSync(join(gasRoot, "dist/index.html"), "utf8");
  const styles = readFileSync(join(gasRoot, "dist/styles.html"), "utf8");
  const jsApp = readFileSync(join(gasRoot, "dist/js_app.html"), "utf8");
  // Function replacements: the minified client bundle contains `$` sequences that a
  // string replacement would mis-interpret as `$&`/`$1` patterns and corrupt.
  html = html.replace(/<\?!=\s*include\('styles'\);?\s*\?>/, () => styles);
  html = html.replace(
    /<\?!=\s*include\('js_app'\);?\s*\?>/,
    () => [
      '<script src="/gas-shims.js"></script>',
      '<script src="/server.js"></script>',
      '<script src="/boot.js"></script>',
      jsApp,
    ].join("\n"),
  );
  return html;
}

createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];
  try {
    if (path === "/") {
      const body = await composeIndex();
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }
    if (SCRIPTS[path]) {
      const body = SCRIPTS[path]();
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }
    if (PARTIALS[path]) {
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(PARTIALS[path]());
      return;
    }
    if (path === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (e) {
    const detail = [e.stdout, e.stderr, e.message]
      .map((b) => (b ? String(b) : ""))
      .filter(Boolean)
      .join("\n");
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`dev server error:\n${detail}`);
  }
}).listen(PORT, () => {
  console.log(`Wiz Sidekick hub local dev: http://localhost:${PORT}`);
  console.log("Edit gas_hub/src/** and refresh — each page load rebuilds.");
  console.log(
    "?unset renders every tile as not-configured; ?unset=os|ai|devsecops does one. " +
    "?slow=<ms> adds artificial RPC latency.",
  );
});
