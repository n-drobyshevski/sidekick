// Local dev bootstrap: runs after gas-shims.js and the Server bundle, before the
// client app script. Provisions the fake environment (Server.setup()), and installs a
// google.script.run shim that dispatches api_* RPCs to Server.api in this page.
//
// SEEDING, HONESTLY STATED. `Server.scanJobs` and `Server.readModels` are real now
// (src/server/index.ts re-exports both onto the GAS global), and `api.ts`'s page RPCs
// (getExecutivePage, getMttrPage, getRegisterPage, getSecretsPage, ...) read genuine ledger
// state through them — this is no longer the "pages render their composition stubs" world
// the old Phase 1 comment here described. But this file cannot hand that ledger a seed: doing
// so the RIGHT way means feeding `dev/sampleData.dev.ts`'s raw Wiz-shaped nodes through the
// REAL `scanJobs.slimRecord` -> `ledgerStore.persistSync` pipeline (never hand-writing rows
// into the sheet fake — see that file's header), and TWO things stand between here and there:
//
//   1. `ledgerStore` is not exported onto `Server` (only `scanJobs` and `readModels` are), so
//      `persistSync` is unreachable from this page even though `Server.scanJobs.slimRecord`
//      now is.
//   2. `dev/sampleData.dev.ts`'s data never reaches the browser at all. `dev/serve.mjs`'s
//      esbuild alias resolves the specifier `./sampleData` to that file on every dev build,
//      but nothing under `src/server` imports that specifier — scanJobs.ts's own header says
//      why: "this project ships no sample data, and inventing one would put fabricated
//      findings in a security register" is a decision about PRODUCTION code, not about this
//      harness, but the alias only fires through an import that does not exist yet.
//
// Both are `src/server/index.ts` / `dev/serve.mjs` changes — outside this file's ownership.
// Until one lands, `?noseed` is this file's whole seeding story: skip cleanly, or don't, with
// nothing in between to fake. `dev/sampleData.dev.ts`'s generator and its full
// slimRecord -> ledgerStore.persistSync pipeline (twin fold, resolve-by-disappearance, a
// three-scan trend) run for real in `test/sampleData.test.ts` today — that is where "the seed
// reconciles to the counts it claims" is actually proven, not here.

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
  // testable even once a real seed path lands. Nothing to undo today (see header) — this is
  // the one seeding behaviour this file can actually promise right now.
  if (query.has("noseed")) {
    console.log("[dev] ?noseed — no seed attempted; pages read the empty ledger.");
  } else if (!live) {
    console.log(
      "[dev] No seed: dev/sampleData.dev.ts is ready (see its SAMPLE_COUNTS — 400 sca, " +
      "40 sast, 120 secrets, 6 twin pairs) but has no path into this browser session yet " +
      "(see this file's header). Pages read the empty ledger. Run " +
      "`npx vitest run test/sampleData.test.ts` to see the seed reconcile for real.",
    );
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
