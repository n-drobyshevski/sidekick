// Local dev bootstrap: runs after gas-shims.js and the Server bundle, before the
// client app script. Seeds the fake Script Properties and installs a google.script.run
// shim that dispatches api_* RPCs to Server.api in this page.
//
// TRIMMED FROM gas_devsecops/dev/boot.js. `Server.setup()` is gone because this project
// provisions nothing — there is no spreadsheet to create, no folder to find and no trigger
// to install, so setup.ts was never forked. `Server.devSeed.seedSampleLedger()` and `?noseed`
// are gone with the ledger they seeded and emptied.
//
// WHAT IS SEEDED INSTEAD IS THE ONE THING THIS APP STORES: the three sibling URLs, written
// into the fake Script Properties exactly as an operator would paste them into Project
// Settings. They point at THE SIBLINGS' OWN DEV HARNESSES — gas on 8787, gas_ai on 8788,
// gas_devsecops on 8789, this hub on 8790 (dev/serve.mjs) — so a locally-run hub actually
// opens a locally-run register and the one journey this app exists for is exercisable before
// anything is deployed. They used to be plausible-looking script.google.com strings, which
// made every tile a dead link and left the app's whole purpose untestable outside a
// deployment; a fake that cannot be clicked is not a safer seed, it is an unmeasured one.
// src/server/urls.ts accepts the loopback form for exactly this reason and refuses everything
// else — see its header.
//
// AND THE UNSET STATE IS REACHABLE, which is the whole reason `?unset` exists. A tile whose
// URL has never been set is a NORMAL state of this app — one sibling deployed, two not — and
// it renders differently from a configured tile (no href, no external glyph, a sentence
// saying so). With every property seeded there would be no way to look at that rendering
// locally, which is exactly how a state ships broken.
//
//   ?unset              all three unset
//   ?unset=ai           just that one; ?unset=os,devsecops for a pair
//   ?slow=<ms>          artificial RPC latency, for loading states

(function () {
  "use strict";

  var query = new URLSearchParams(location.search);

  // The three keys, matching src/server/props.ts's PROP_KEYS. Named here rather than
  // imported because this file is a classic script loaded beside the bundle, not a module.
  var SEED = {
    os: "URL_OS",
    ai: "URL_AI",
    devsecops: "URL_DEVSECOPS",
  };
  // Built with join("/") rather than written, for the same reason urlsModel.js does it: no
  // bare `//` in a file the middlebox's comment-stripping replay reads. (This one is a dev
  // script and not part of the guarded bundle — the construction is here so the two files
  // that spell a URL in this app spell it the same way.)
  var LOCAL = ["http:", "", "localhost:"].join("/");
  var SEED_URL = {
    os: LOCAL + "8787/",
    ai: LOCAL + "8788/",
    devsecops: LOCAL + "8789/",
  };

  // `?unset` with no value means all three; `?unset=os,ai` means those. An unrecognised name
  // is reported rather than ignored — a flag that silently does nothing produces a run that
  // looks like it measured something (CLAUDE.md, the probe's own version of this).
  var unset = {};
  if (query.has("unset")) {
    var raw = String(query.get("unset") || "").trim();
    if (!raw) {
      for (var all in SEED) unset[all] = true;
    } else {
      raw.split(/[,\s]+/).filter(Boolean).forEach(function (name) {
        if (SEED[name]) unset[name] = true;
        else console.warn("[dev] ?unset: no sidekick named " + name + " — expected os, ai or devsecops");
      });
    }
  }

  var props = PropertiesService.getScriptProperties();
  var seeded = [];
  for (var key in SEED) {
    if (unset[key]) continue;
    props.setProperty(SEED[key], SEED_URL[key]);
    seeded.push(key);
  }
  console.log(
    "[dev] Seeded " + seeded.length + " sidekick URL(s): " +
    (seeded.join(", ") || "(none)") +
    (Object.keys(unset).length ? " — unset: " + Object.keys(unset).join(", ") : ""),
  );

  // Optional artificial RPC latency (?slow=<ms>) so loading states — the route-reload
  // overlay, the launcher's own first paint — are exercisable locally.
  var SLOW_MS = Math.max(0, Number(query.get("slow")) || 0);

  // google.script.run shim: same contract as the GAS client bridge — chainable
  // handler setters, then any method name invokes the RPC. api_<name> maps to
  // Server.api[<name>] (mirroring dist/entry.js); results are delivered async.
  function makeRunner(onSuccess, onFailure) {
    var target = {
      withSuccessHandler: function (fn) { return makeRunner(fn, onFailure); },
      withFailureHandler: function (fn) { return makeRunner(onSuccess, fn); },
      withUserObject: function () { return this; },
    };
    return new Proxy(target, {
      get: function (t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop !== "string") return undefined;
        return function (params) {
          setTimeout(function () {
            try {
              var result;
              if (prop.indexOf("api_") === 0 && typeof Server.api[prop.slice(4)] === "function") {
                result = Server.api[prop.slice(4)](params);
              } else if (typeof Server[prop] === "function") {
                result = Server[prop](params);
              } else {
                throw new Error("Unknown RPC " + prop);
              }
              if (onSuccess) onSuccess(result);
            } catch (e) {
              if (onFailure) onFailure(e);
              else console.error("[dev] RPC " + prop + " failed:", e);
            }
          }, SLOW_MS);
        };
      },
    });
  }

  window.google = { script: { run: makeRunner(null, null) } };
  console.log("[dev] google.script.run shim installed — in-memory Script Properties");
})();
