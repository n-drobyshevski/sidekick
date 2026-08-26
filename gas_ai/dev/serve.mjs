// Local dev server for UI/UX work on the GAS web app: composes the same page GAS
// would serve (index.html with the styles/js_app includes resolved) plus the GAS
// service fakes (gas-shims.js), the real Server bundle, and the boot/seed script.
//
//   npm run dev   →  http://localhost:8787
//
// Every load of "/" reruns the esbuild build, so editing src/client/** or
// src/server/** and refreshing the browser is the whole loop. State is in-memory
// and reseeded per load (one deterministic dry-run sync).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildStamp } from "../buildStamp.mjs";

const gasRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);

// ------------------------------------------------------------------ live credentials
// Real-tenant mode. The Wiz config comes from dev/.env.local (gitignored) or the shell,
// and the browser is handed PLACEHOLDERS for the secrets — the client id and secret never
// leave this process. /_fetch substitutes them on the way out, so a devtools network panel
// shows the placeholder rather than the credential. (The access token the OAuth exchange
// returns does reach the page, because the app caches it in CacheService exactly as it does
// in GAS. That token expires; the client secret does not.)
//
// With no credentials nothing changes: the harness stays the dry-run one it has always been.
// Two accepted locations, because both are the obvious one: dev/.env.local sits beside the
// harness that reads it, and gas_ai/.env.local is where a .env lives in every other project.
// Looking in one and staying silent about the other is how a filled-in file reads as empty.
// dev/ wins on a key set in both.
const ENV_FILES = [join(gasRoot, ".env.local"), join(gasRoot, "dev/.env.local")];
const PLACEHOLDER = {
  clientId: "__DEV_WIZ_CLIENT_ID__",
  clientSecret: "__DEV_WIZ_CLIENT_SECRET__",
  apiToken: "__DEV_WIZ_API_TOKEN__",
};

function readEnvFile() {
  const out = {};
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      let value = line.slice(eq + 1).trim();
      if (value.length > 1 && /^(".*"|'.*')$/.test(value)) {
        value = value.slice(1, -1);
      } else {
        // Trailing comment on an unquoted value — the template ships one on the project-id
        // line, and keeping it would send the tenant a project id with prose attached. Only
        // a `#` after whitespace counts, so a `#` inside a secret survives; quote the value
        // if it needs a literal " #".
        value = value.replace(/\s+#.*$/, "").trim();
      }
      // Only a non-empty value counts. Both files exist by default and the template ships
      // its keys blank, so assigning "" here would let the empty placeholders in one file
      // overwrite the credentials filled into the other — a file that reads as empty for
      // no visible reason.
      if (value) out[line.slice(0, eq).trim()] = value;
    }
  }
  return out;
}

// Read per request, not once at startup: pasting credentials into dev/.env.local then takes
// effect on the next refresh, which is the same loop as editing src/**.
function credentials() {
  const file = readEnvFile();
  const pick = (k) => String(process.env[k] || file[k] || "").trim();
  const apiUrl = pick("WIZ_API_URL");
  const apiToken = pick("WIZ_API_TOKEN");
  const clientId = pick("WIZ_CLIENT_ID");
  const clientSecret = pick("WIZ_CLIENT_SECRET");
  // Same precedence as props.resolveAuthMode: a raw token wins over the OAuth pair.
  const auth = apiToken ? "token" : clientId && clientSecret ? "oauth" : null;
  return {
    apiUrl,
    authUrl: pick("WIZ_AUTH_URL") || "https://auth.app.wiz.io/oauth/token",
    apiToken,
    clientId,
    clientSecret,
    projectId: pick("WIZ_PROJECT_ID_V2"),
    aiResourceTypes: pick("WIZ_AI_RESOURCE_TYPES"),
    mode: apiUrl && auth ? auth : null,
  };
}

/** What the page is allowed to know: config in the clear, secrets as placeholders. */
function devConfigScript() {
  const c = credentials();
  const cfg = {
    mode: c.mode,
    apiUrl: c.apiUrl,
    authUrl: c.authUrl,
    projectId: c.projectId,
    aiResourceTypes: c.aiResourceTypes,
    clientId: c.mode === "oauth" ? PLACEHOLDER.clientId : "",
    clientSecret: c.mode === "oauth" ? PLACEHOLDER.clientSecret : "",
    apiToken: c.mode === "token" ? PLACEHOLDER.apiToken : "",
  };
  return `window.__WIZ_DEV__ = ${JSON.stringify(cfg, null, 2)};\n`;
}

const SCRIPTS = {
  "/gas-shims.js": () => readFileSync(join(gasRoot, "dev/gas-shims.js"), "utf8"),
  "/server.js": () => readFileSync(join(gasRoot, "dev/server.dev.js"), "utf8"),
  "/boot.js": () => readFileSync(join(gasRoot, "dev/boot.js"), "utf8"),
  "/dev-config.js": devConfigScript,
};

/**
 * HtmlService partials, for the shim behind `api.getChartsBundle`.
 *
 * In GAS these are files in the script project and `createHtmlOutputFromFile` reads them
 * straight off the runtime. Here the "server" is a bundle running in the browser, so the
 * partial has to come back over HTTP — see the HtmlService shim in dev/gas-shims.js. Served
 * as text/plain because it is HTML being read as data, never parsed as a document.
 */
const PARTIALS = {
  "/_partial/js_charts": () => readFileSync(join(gasRoot, "dist/js_charts.html"), "utf8"),
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// UrlFetchApp is synchronous and the browser cannot reach api.wiz.io itself (CORS), so the
// shim posts the request here and this forwards it. Refusals are reported inside a 200 body
// rather than as HTTP failures: the shim has to tell "the proxy refused" apart from "the
// tenant answered 403", and only one of those is an answer from Wiz.
const FETCH_TIMEOUT_MS = 180_000;

async function proxyFetch(req, res) {
  const reply = (obj) => {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(obj));
  };
  const c = credentials();
  if (!c.mode) {
    reply({ error: "no credentials configured — fill in gas_ai/dev/.env.local" });
    return;
  }
  let spec;
  try {
    spec = JSON.parse(await readBody(req));
  } catch (e) {
    reply({ error: `unreadable proxy request: ${e.message}` });
    return;
  }
  let target;
  try {
    target = new URL(String(spec.url || ""));
  } catch {
    reply({ error: `bad target URL: ${spec.url}` });
    return;
  }
  // Allowlist. This endpoint attaches a real tenant credential, so it forwards to the two
  // configured Wiz hosts and nowhere else — otherwise any page open in the browser could
  // post through localhost:8787 and have the secret added on its behalf.
  const origin = (u) => {
    try { return new URL(u).origin; } catch { return ""; }
  };
  const allowed = [origin(c.apiUrl), origin(c.authUrl)].filter(Boolean);
  if (!allowed.includes(target.origin)) {
    reply({ error: `refusing to proxy ${target.origin} (allowed: ${allowed.join(", ")})` });
    return;
  }
  const substitute = (v) => String(v)
    .split(PLACEHOLDER.clientId).join(c.clientId)
    .split(PLACEHOLDER.clientSecret).join(c.clientSecret)
    .split(PLACEHOLDER.apiToken).join(c.apiToken);
  const headers = {};
  for (const [k, v] of Object.entries(spec.headers || {})) headers[k] = substitute(v);
  if (spec.contentType) headers["content-type"] = String(spec.contentType);
  const method = String(spec.method || "GET").toUpperCase();
  const started = Date.now();
  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: spec.payload == null ? undefined : substitute(spec.payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await upstream.text();
    console.log(
      `[proxy] ${method} ${target.host}${target.pathname} -> ${upstream.status}, ` +
      `${body.length} bytes, ${Date.now() - started}ms`,
    );
    reply({ status: upstream.status, headers: Object.fromEntries(upstream.headers), body });
  } catch (e) {
    console.log(`[proxy] ${method} ${target.host}${target.pathname} -> FAILED: ${e.message}`);
    reply({ error: `upstream fetch failed: ${e.message}` });
  }
}

// Dev server bundle: identical to dist/server.js except sampleData is swapped for
// the dev dataset (dev/sampleData.dev.ts). The dev module reaches the real file via
// "../src/server/sampleData", which the ^\./sampleData$ filter never matches.
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
      '<script src="/dev-config.js"></script>',
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
    if (path === "/_fetch" && req.method === "POST") {
      await proxyFetch(req, res);
      return;
    }
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
  console.log(`Wiz SIDEKICK AI local dev: http://localhost:${PORT}`);
  console.log("Edit gas_ai/src/** and refresh — each page load rebuilds and reseeds.");
  const c = credentials();
  if (c.mode) {
    console.log(
      `LIVE (${c.mode}): ${c.apiUrl}, project ${c.projectId || "(all)"}. Every load runs a ` +
      "real sync — add ?dry for the sample dataset, ?noseed for an empty store.",
    );
  } else {
    console.log(
      "Dry-run: no credentials. Put WIZ_API_URL + WIZ_CLIENT_ID/WIZ_CLIENT_SECRET in " +
      "gas_ai/dev/.env.local and refresh for real tenant data.",
    );
  }
});
