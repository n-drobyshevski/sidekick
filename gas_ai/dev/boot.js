// Local dev bootstrap: runs after gas-shims.js and the Server bundle, before the
// client app script. Provisions the fake environment (Server.setup()), seeds one
// dry-run sync so every page has data, and installs a google.script.run shim that
// dispatches api_* RPCs to Server.api in this page.

(function () {
  "use strict";

  console.log("[dev] " + Server.setup().split("\n").join("\n[dev] "));

  // Seed one dry-run sync (?noseed leaves the store empty — for testing empty states).
  if (new URLSearchParams(location.search).has("noseed")) {
    console.log("[dev] ?noseed — no seed sync");
  } else {
    const res = Server.api.runSync({});
    if (!res.ok) console.error("[dev] seed sync failed:", res.error);
    else console.log("[dev] " + (res.data && res.data.message ? res.data.message : "seed sync ok"));
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
