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
  // /_fetch substitutes; the real ones never enter the page.
  //
  // DRY IS THE DEFAULT HERE AND LIVE IS OPT-IN (`?live`), which is the opposite of the two
  // siblings and the opposite of what this harness did until now. The reason is this app's
  // own asymmetry: `scanJobs.ts` REFUSES without credentials rather than falling back to a
  // dry run ("fabricating findings in a security register is the one thing this product does
  // not do"), and the seeding branch below only runs when NOT live. So with credentials on
  // disk, a plain load did neither — no seed AND no sync — and opened an empty register that
  // looked like a broken build rather than like a deliberate state. gas/ and gas_ai/ never
  // show that face because `startSync` there falls back to `dryRunSync`.
  //
  // Inverting the flag also makes the DANGEROUS direction the explicit one. `?dry` used to be
  // something you had to remember on every load of a register wired to a production security
  // tenant; forgetting it cost a real scan. Now forgetting `?live` costs nothing.
  const cfg = window.__WIZ_DEV__ || { mode: null };
  const live = Boolean(cfg.mode) && query.has("live");
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
    // Says the credentials are PRESENT and were not used, rather than just "dry" — the two
    // are different situations and only one of them is one keystroke from a real scan.
    console.log("[dev] dry (default) — credentials on disk ignored; sample dataset. ?live uses the tenant.");
  }

  // The hub the header links back to, seeded into the fake Script Properties exactly as an
  // operator would paste it into Settings > System. It points at gas_hub's OWN dev harness
  // (`cd gas_hub && npm run dev`, port 8790 — see gas_hub/dev/serve.mjs), so the one journey
  // this button exists for is exercisable before anything is deployed. A plausible-looking
  // script.google.com placeholder would render the button and make it a dead link, which is
  // not a safer seed — it is an unmeasured one. src/server/hubUrl.ts accepts the loopback form
  // for exactly this reason and refuses everything else.
  //
  // ?nohub reaches the OTHER state, and it is a state worth being able to look at: a register
  // whose operator has never set a hub URL is the normal first condition of every deployment,
  // and it renders differently (no button at all). With the property always seeded there would
  // be no way to see that rendering without editing this file.
  if (query.has("nohub")) {
    console.log("[dev] ?nohub — no hub URL set; the header carries no hub button.");
  } else {
    // Built with join("/") rather than written, for the same reason gas_shared/hubUrl.js does
    // it: no bare `//` in a file the middlebox's comment-stripping replay reads. (This one is
    // a dev script outside the guarded bundle — the construction is here so every file in this
    // repo that spells a URL spells it the same way.)
    const HUB_URL = ["http:", "", "localhost:"].join("/") + "8790/";
    PropertiesService.getScriptProperties().setProperty("URL_HUB", HUB_URL);
    console.log(`[dev] Hub URL seeded: ${HUB_URL} (cd gas_hub && npm run dev) — ?nohub to unset.`);
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

  // ------------------------------------------------------------ the project scope, restored
  //
  // WHY THIS EXISTS, AND WHY IT IS NOT A PRODUCT CHANGE. The view-project scope is SERVER
  // state (`settingsStore.projectView`, written by `api_setProjectView`), and in a deployed
  // build it is a row on the settings tab: it survives a reload because the tab does, and
  // `test/projectView.test.ts`'s "the project view survives a new execution" block pins that.
  // Here the whole fake platform lives in the page — gas-shims.js's own header says
  // "everything is in-memory and resets on reload" — so picking a scope and pressing F5 put
  // the register back to "Everything synced" every time. Measured on this harness before the
  // fix: `api_setProjectView` -> `platform` -> reload -> `bootstrap().scope.projectView` is
  // "".
  //
  // That is a HARNESS artifact wearing a product bug's face, and the two are worth telling
  // apart: the app is right and the local loop was lying about it. So the harness replays the
  // last pick rather than the client remembering one — `app.js`'s `pickProjectScope` says
  // "STORES NOTHING CLIENT-SIDE ... a client-held copy would be a second source of truth for
  // exactly the value this control exists to keep singular", and a dev-only cache in the page
  // would be that second source of truth with a friendlier name on it.
  //
  // The prefix is `MANIFEST.storagePrefix` from src/client/js/app.js, written out because
  // this file runs before the client bundle and cannot import it.
  const SCOPE_KEY = "sidekickdso.dev.projectView";

  function readStoredScope() {
    try {
      return window.localStorage.getItem(SCOPE_KEY) || "";
    } catch (e) {
      return ""; // a browser with site data blocked is a harness with no memory, not an error
    }
  }

  function writeStoredScope(slug) {
    try {
      if (slug) window.localStorage.setItem(SCOPE_KEY, slug);
      else window.localStorage.removeItem(SCOPE_KEY);
    } catch (e) {
      /* nothing to do — the next reload simply opens unscoped */
    }
  }

  // ?noscope reaches the OTHER state, the way ?nohub and ?noseed do above: a register nobody
  // has scoped yet is the normal first condition, and with a slug in storage there would
  // otherwise be no way to look at it again without clearing site data by hand.
  if (query.has("noscope")) {
    writeStoredScope("");
    console.log("[dev] ?noscope — stored project scope cleared; the register opens unscoped.");
  } else {
    const stored = readStoredScope();
    if (stored) {
      // ONLY A SLUG THIS SEED ACTUALLY HOLDS. `setProjectView` accepts any string on purpose
      // (test/api.test.ts: "a slug the register does not hold yields 0 rows and is NOT an
      // error"), so replaying a stale one — the fixture changed, or it was picked under
      // ?live — would open the harness on an empty register with nothing on screen saying
      // why. Checked against the catalogue the seed just built rather than assumed.
      const boot = Server.api.bootstrap({});
      const list = (boot && boot.ok && boot.data && boot.data.filterOptions
        && boot.data.filterOptions.projectList) || [];
      if (list.some((p) => p && p.slug === stored)) {
        Server.api.setProjectView({ projectView: stored });
        console.log(`[dev] Project scope restored: ${stored} — ?noscope to open unscoped.`);
      } else {
        writeStoredScope("");
        console.log(
          `[dev] Stored project scope "${stored}" is not in this seed's catalogue `
          + `(${list.length} project(s)) — dropped rather than replayed onto an empty register.`,
        );
      }
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
                // The one RPC the harness remembers across a reload — see the scope block
                // above for why it is remembered HERE, at the platform seam, rather than by
                // the client. Only on `ok`: a refused pick must not become the next boot's
                // starting scope. An empty slug is stored as a removal, so unscoping sticks.
                if (prop === "api_setProjectView" && result && result.ok) {
                  writeStoredScope(String((params && params.projectView) || ""));
                }
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
