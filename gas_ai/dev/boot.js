// Local dev bootstrap: runs after gas-shims.js and the Server bundle, before the
// client app script. Provisions the fake environment (Server.setup()), runs one sync
// so every page has data, and installs a google.script.run shim that dispatches api_*
// RPCs to Server.api in this page.
//
// The sync is the sample dataset or the real tenant depending on whether dev/serve.mjs
// found credentials — the app decides that itself, from the Script Properties written
// below (syncJobs.startSync: no credentials → dryRunSync).

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

  // The hub the header links back to, seeded into the fake Script Properties exactly as an
  // operator would paste it into Settings > System. It points at gas_hub's OWN dev harness
  // (`cd gas_hub && npm run dev`, port 8790 - see gas_hub/dev/serve.mjs), so the one journey
  // this button exists for is exercisable before anything is deployed. A plausible-looking
  // script.google.com placeholder would render the button and make it a dead link, which is
  // not a safer seed - it is an unmeasured one. src/server/hubUrl.ts accepts the loopback form
  // for exactly this reason and refuses everything else.
  //
  // ?nohub reaches the OTHER state, and it is a state worth being able to look at: a register
  // whose operator has never set a hub URL is the normal first condition of every deployment,
  // and it renders differently (no button at all). With the property always seeded there would
  // be no way to see that rendering without editing this file.
  if (new URLSearchParams(location.search).has("nohub")) {
    console.log("[dev] ?nohub - no hub URL set; the header carries no hub button.");
  } else {
    // Built with join("/") rather than written, for the same reason gas_shared/hubUrl.js does
    // it: no bare double slash in a file the middlebox's comment-stripping replay reads.
    const HUB_URL = ["http:", "", "localhost:"].join("/") + "8790/";
    PropertiesService.getScriptProperties().setProperty("URL_HUB", HUB_URL);
    console.log("[dev] Hub URL seeded: " + HUB_URL + " (cd gas_hub && npm run dev) - ?nohub to unset.");
  }

  console.log("[dev] " + Server.setup().split("\n").join("\n[dev] "));

  // One sync (?noseed leaves the store empty — for testing empty states).
  if (query.has("noseed")) {
    console.log("[dev] ?noseed — no sync");
  } else {
    if (live) console.log("[dev] live sync starting — the tab blocks while Wiz answers…");
    const res = Server.api.runSync({});
    if (!res.ok) console.error("[dev] sync failed:", res.error);
    else console.log("[dev] " + (res.data && res.data.message ? res.data.message : "sync ok"));
    // A live sync too big for one budget spills onto a continuation trigger, which the
    // ScriptApp shim fires. Report each hop, so a long sync reads as progress rather than
    // as a page that stopped talking.
    const jobId = res.ok && res.data ? res.data.jobId : null;
    if (jobId) {
      const poll = setInterval(() => {
        const st = Server.api.getJobStatus({ jobId });
        if (!st.ok) { clearInterval(poll); console.error("[dev] job status failed:", st.error); return; }
        const job = st.data && st.data.job ? st.data.job : st.data;
        if (!job || !job.phase) { clearInterval(poll); return; }
        console.log(`[dev] sync ${job.phase} — step ${job.step_index}, ${job.nodes_so_far} nodes`);
        if (job.phase === "DONE" || job.phase === "ERROR" || job.phase === "CANCELLED") {
          clearInterval(poll);
          if (job.error) console.error("[dev] sync error:", job.error);
        }
      }, 3000);
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
