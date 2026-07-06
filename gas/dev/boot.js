// Local dev bootstrap: runs after gas-shims.js and the Server bundle, before the
// client app script. Provisions the fake environment (Server.setup()), seeds a week
// of backdated dry-run scans so every page has data, and installs a google.script.run
// shim that dispatches api_* RPCs to Server.api synchronously in this page.

(function () {
  "use strict";

  const RealDate = Date;

  // The server stamps scan ids / timestamps from Date.now(); shifting the clock per
  // seed scan spreads the history over real days so MTTR and trend charts have shape.
  function withNow(ms, fn) {
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...args) {
        if (args.length) super(...args);
        else super(ms);
      }
      static now() { return ms; }
    };
    try { return fn(); } finally { Date = RealDate; } // eslint-disable-line no-global-assign
  }

  console.log("[dev] " + Server.setup().split("\n").join("\n[dev] "));

  // Seed: 7 daily dry-run scans. Each dry-run scan deterministically resolves one
  // more open sample finding, so scan-over-scan deltas and MTTR are non-trivial.
  const DAY = 86_400_000;
  const SEED_SCANS = 7;
  const base = RealDate.now() - (SEED_SCANS - 1) * DAY;
  for (let i = 0; i < SEED_SCANS; i++) {
    const res = withNow(base + i * DAY, () => Server.api.runScan({}));
    if (!res.ok) console.error("[dev] seed scan failed:", res.error);
  }
  console.log(`[dev] seeded ${SEED_SCANS} dry-run scans`);

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
          }, 0);
        };
      },
    });
  }

  window.google = { script: { run: makeRunner(null, null) } };
  console.log("[dev] google.script.run shim installed — dry-run mode, in-memory state");
})();
