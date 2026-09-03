// Local dev bootstrap: runs after gas-shims.js and the Server bundle, before the
// client app script. Provisions the fake environment (Server.setup()), and installs a
// google.script.run shim that dispatches api_* RPCs to Server.api in this page.
//
// SEEDING, HONESTLY STATED. `Server.scanJobs`, `Server.readModels` and now `Server.devSeed`
// are all real (`src/server/index.ts` re-exports the three onto the GAS global), and
// `api.ts`'s page RPCs (getExecutivePage, getMttrPage, getRegisterPage, getSecretsPage, ...)
// read genuine ledger state through them. The two gaps a previous version of this comment
// described are both closed:
//
//   1. `src/server/devSeed.ts` is the import site for the specifier `./sampleData` that
//      nothing under `src/server` used to reach for — so `dev/serve.mjs`'s esbuild alias
//      (which rewrites that exact specifier to `dev/sampleData.dev.ts` on every dev build)
//      now actually fires, and the dev dataset reaches this browser bundle at all.
//   2. `Server.devSeed.seedSampleLedger()` is reachable from this page and runs the REAL
//      `scanJobs.slimRecord` -> `ledgerStore.persistSync` pipeline over `dev/sampleData.dev.ts`'s
//      three-scan battery — never hand-written ledger rows (see `devSeed.ts`'s header). In a
//      deployed build `./sampleData` resolves instead to `src/server/sampleData.ts`, which
//      ships every array empty on principle, so the exact same call is a documented no-op
//      there: "this project ships no sample data, and inventing one would put fabricated
//      findings in a security register" (scanJobs.ts) holds for production, and this seed
//      path is now the harness-only exception that principle always meant to allow.
//
// `?noseed` still skips seeding outright (below); it is no longer this file's ENTIRE seeding
// story, just the escape hatch that keeps the empty-state rendering reachable. Everything the
// seed claims — the twin fold, resolve-by-disappearance, the three-scan trend, the exact
// counts — is pinned by `test/sampleData.test.ts` and `test/devSeed.test.ts`.

(function () {
  "use strict";

  const query = new URLSearchParams(location.search);

  // Live credentials from the dev server, written into the fake Script Properties exactly
  // as an operator would in Project Settings. The secrets here are placeholders that
  // /_fetch substitutes; the real ones never enter the page. ?dry ignores them, which is
  // how you get the sample dataset back without emptying the file.
  const cfg = window.__WIZ_DEV__ || { mode: null };
  const live = Boolean(cfg.mode) && !query.has("dry");
  if (live) {
    const props = PropertiesService.getScriptProperties();
    const set = (k, v) => { if (v) props.setProperty(k, v); };
    set("WIZ_API_URL", cfg.apiUrl);
    set("WIZ_AUTH_URL", cfg.authUrl);
    set("WIZ_API_TOKEN", cfg.apiToken);
    set("WIZ_CLIENT_ID", cfg.clientId);
    set("WIZ_CLIENT_SECRET", cfg.clientSecret);
    set("WIZ_PROJECT_ID_V2", cfg.projectId);
    set("WIZ_AI_RESOURCE_TYPES", cfg.aiResourceTypes);
    console.log(
      `[dev] LIVE ${cfg.mode} — ${cfg.apiUrl}, project ${cfg.projectId || "(all)"}`,
    );
  } else if (cfg.mode) {
    console.log("[dev] ?dry — credentials ignored, sample dataset");
  }

  console.log("[dev] " + Server.setup().split("\n").join("\n[dev] "));

  // ?noseed: skip seeding outright, so the empty-state rendering stays reachable and
  // testable. In LIVE mode there is nothing here to seed either — a real sync populates the
  // ledger through the app UI, not through this bootstrap — so the sample battery only ever
  // runs for a dry, unseeded session.
  if (query.has("noseed")) {
    console.log("[dev] ?noseed — no seed attempted; pages read the empty ledger.");
  } else if (!live) {
    const result = Server.devSeed.seedSampleLedger();
    if (result.reason) {
      // Only reachable if `./sampleData` resolved to the production stub instead of the dev
      // alias — i.e. this bundle was NOT built by dev/serve.mjs's buildDevServer(). Says so
      // rather than silently rendering an empty ledger with no explanation.
      console.log(`[dev] No seed: ${result.reason} — pages read the empty ledger.`);
    } else {
      console.log(
        `[dev] Seeded ${result.seeded} ledger row(s) from ${result.syncs} sync(s) ` +
        `(${result.rows} raw record(s) through slimRecord -> persistSync).`,
      );
    }
  }

  // Optional artificial RPC latency (?slow=<ms>) so loading states — the route-reload
  // overlay, sync progress card, etc. — are exercisable locally.
  const SLOW_MS = Math.max(0, Number(new URLSearchParams(location.search).get("slow")) || 0);

  // google.script.run shim: same contract as the GAS client bridge — chainable
  // handler setters, then any method name invokes the RPC. api_<name> maps to
  // Server.api[<name>] (mirroring dist/entry.js); results are delivered async.
  function makeRunner(onSuccess, onFailure) {
    const target = {
      withSuccessHandler(fn) { return makeRunner(fn, onFailure); },
      withFailureHandler(fn) { return makeRunner(onSuccess, fn); },
      withUserObject() { return this; },
    };
    return new Proxy(target, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop !== "string") return undefined;
        return (params) => {
          setTimeout(() => {
            try {
              let result;
              if (prop.startsWith("api_") && typeof Server.api[prop.slice(4)] === "function") {
                result = Server.api[prop.slice(4)](params);
              } else if (typeof Server[prop] === "function") {
                result = Server[prop](params);
              } else {
                throw new Error(`Unknown RPC ${prop}`);
              }
              if (onSuccess) onSuccess(result);
            } catch (e) {
              if (onFailure) onFailure(e);
              else console.error(`[dev] RPC ${prop} failed:`, e);
            }
          }, SLOW_MS);
        };
      },
    });
  }

  window.google = { script: { run: makeRunner(null, null) } };
  console.log("[dev] google.script.run shim installed — dry-run mode, in-memory state");
})();
