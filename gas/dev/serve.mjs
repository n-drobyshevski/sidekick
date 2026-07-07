// Local dev server for UI/UX work on the GAS web app: composes the same page GAS
// would serve (index.html with the styles/js_app includes resolved) plus the GAS
// service fakes (gas-shims.js), the real Server bundle, and the boot/seed script.
//
//   npm run dev   →  http://localhost:8787
//
// Every load of "/" reruns the esbuild build, so editing src/client/** or
// src/server/** and refreshing the browser is the whole loop. State is in-memory
// and reseeded per load (7 deterministic dry-run scans).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const gasRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);

const SCRIPTS = {
  "/gas-shims.js": () => readFileSync(join(gasRoot, "dev/gas-shims.js"), "utf8"),
  "/server.js": () => readFileSync(join(gasRoot, "dev/server.dev.js"), "utf8"),
  "/boot.js": () => readFileSync(join(gasRoot, "dev/boot.js"), "utf8"),
};

// Dev server bundle: identical to dist/server.js except sampleData is swapped for
// the amplified dev dataset (dev/sampleData.dev.ts). The dev module reaches the real
// file via "../src/server/sampleData", which the ^\./sampleData$ filter never matches.
async function buildDevServer() {
  await build({
    entryPoints: [join(gasRoot, "src/server/index.ts")],
    bundle: true,
    format: "iife",
    globalName: "Server",
    target: "es2019",
    outfile: join(gasRoot, "dev/server.dev.js"),
    logLevel: "silent",
    plugins: [{
      name: "dev-sample-data",
      setup(b) {
        b.onResolve({ filter: /^\.\/sampleData$/ }, () => ({
          path: join(gasRoot, "dev/sampleData.dev.ts"),
        }));
      },
    }],
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
  console.log(`Wiz Sidekick local dev: http://localhost:${PORT}`);
  console.log("Edit gas/src/** and refresh — each page load rebuilds and reseeds.");
});
