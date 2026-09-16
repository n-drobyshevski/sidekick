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
    Date = class extends RealDate {
      constructor(...args) {
        if (args.length) super(...args);
        else super(ms);
      }
      static now() { return ms; }
    };
    try { return fn(); } finally { Date = RealDate; }
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

  // Seed a subscription → Support Group map so the sidebar Support-group selector, the
  // Overview multi-select, the breakdown dimension, and the support_group domain
  // condition are all exercisable in dev (dry-run has no live Wiz to refresh from). Keys
  // are folded subscription names from dev/sampleData.dev.ts's CLOUDS pool. Written to
  // the settings sheet BEFORE the first settings read, so the cold-memo load picks it up
  // and every later saveSettings preserves it. Dev-only — dev/ is never bundled.
  (function seedSupportGroups() {
    const id = PropertiesService.getScriptProperties().getProperty("LEDGER_SPREADSHEET_ID");
    const sh = SpreadsheetApp.openById(id).getSheetByName("settings");
    const map = {
      "prod-account": "CS-CORE-PLATFORM",
      "dev-account": "CS-SANDBOX",
      "core-prod": "CS-SUPPLY-MONITORING",
      "core-staging": "CS-SUPPLY-MONITORING",
      "inix-tt4k": "CS-INIX",
      "enms-pr": "CS-ENMS",
    };
    const value = JSON.stringify({ version: 1, map });
    sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([["support_group_map", value]]);
    console.log("[dev] seeded support-group map (6 subscriptions)");
  })();

  // Seed: 8 daily dry-run scans. Each dry-run scan deterministically resolves one
  // more open sample finding, so scan-over-scan deltas and MTTR are non-trivial.
  // ?noseed leaves a fresh, empty ledger — for exercising the migration import paths.
  //
  // EIGHT, NOT SEVEN, AND THE OFF-BY-ONE IS THE WHOLE POINT. N daily scans span N-1 days, so
  // the old 7 spanned 6 — and `insights.openMovement` refuses a comparison whose endpoints are
  // under MOVEMENT_MIN_GAP_DAYS (7) apart. The seeded harness therefore rendered `tooClose`
  // FOREVER: the Executive movement block could not be looked at locally at all, in any state
  // but its refusal state. Eight scans span exactly 7 days, which clears the `>=` and makes
  // the comparable path the default one a developer sees. (The refusal path is still
  // reachable — drop a scan, or widen the gap — and it is what a real register looks like in
  // its first week, so it is not a state anyone should have to hunt for either.)
  const DAY = 86_400_000;
  const SEED_SCANS = 8;
  // THE SCAN AT WHICH THE VANISHING ROWS STOP BEING RETURNED. `dev/sampleData.dev.ts` appends
  // six findings and exposes `__devWithholdVanishing`; from this scan onward the fixture no
  // longer returns them, so `reconcile.ts`'s disappearance pass resolves them and dates them
  // by the scan that first missed them — `resolution_src: "disappeared"`, the branch a
  // dry-run scan cannot otherwise reach, because `dryRunScan` only ever stamps `resolvedAt`
  // (an API resolution). Four scans of presence first, so each one has a real age and a
  // `last_scan_id` equal to the previous scan, which is what the pass requires.
  const VANISH_AFTER_SCAN = 4;
  if (new URLSearchParams(location.search).has("noseed")) {
    console.log("[dev] ?noseed — fresh empty ledger");
  } else {
    const base = RealDate.now() - (SEED_SCANS - 1) * DAY;
    for (let i = 0; i < SEED_SCANS; i++) {
      if (typeof globalThis.__devWithholdVanishing === "function") {
        globalThis.__devWithholdVanishing(i >= VANISH_AFTER_SCAN);
      }
      const res = withNow(base + i * DAY, () => Server.api.runScan({}));
      if (!res.ok) console.error("[dev] seed scan failed:", res.error);
    }
    console.log(`[dev] seeded ${SEED_SCANS} dry-run scans`);
    // The counts this seed exists to produce, printed so a run can be checked rather than
    // assumed — the same discipline as "a zero has to prove it looked".
    const scanned = Server.api.getRegisterRows({ status: "resolved", pageSize: 250 });
    if (scanned.ok) {
      const rows = scanned.data.rows || [];
      const bySrc = {};
      for (const r of rows) bySrc[r.resolution_src || "(none)"] = (bySrc[r.resolution_src || "(none)"] || 0) + 1;
      console.log("[dev] resolved rows by resolution_src:", JSON.stringify(bySrc),
        "of", scanned.data.total, "resolved");
    }
  }

  // -------------------------------------------------------------- cold-zone mode, dev-forced
  //
  // `coldZoneMode`/`coldAfterDays`/`coldTargetSharePct`/`coldFloorDays` are Settings state,
  // saved through `api_saveSettings({ patch })` exactly as the Lifecycle tab's Save button
  // does it (src/client/js/pages/settings.js). This runs AFTER the seed scans above ON
  // PURPOSE: `saveSettings` bumps the settings data version, and the cold-zone read model's
  // durable cache key (`durablyCached("coldZone1", ...)`) carries all four cold fields, so it
  // only recomputes against the seed once that version has moved. Doing this first would save
  // the settings, THEN seed — one more version bump the pages never see, and no bug, but
  // running it after is what an operator flipping the mode after a sync actually does, and it
  // is the cheaper of two ways to reach the same reachable state.
  //
  // The four flags are independent and merge into ONE patch and one save (mirroring
  // `saveSettings`'s own "one atomic write" contract): `?coldafter=N` reaches fixed mode's
  // window on its own, without touching the mode; `?cold=relative` alone leaves
  // `coldTargetSharePct`/`coldFloorDays` at whatever they already are (the domain defaults,
  // 20% / 14 d, on a fresh harness), since `saveSettings` MERGES the patch over the current
  // settings rather than replacing them.
  (function seedColdZoneFlags() {
    const q = new URLSearchParams(location.search);
    const rawMode = q.get("cold");
    const rawAfter = q.get("coldafter");
    const rawTarget = q.get("coldtarget");
    const rawFloor = q.get("coldfloor");
    if (rawMode === null && rawAfter === null && rawTarget === null && rawFloor === null) return;

    const patch = {};
    const parts = [];
    if (rawMode === "fixed" || rawMode === "relative") {
      patch.coldZoneMode = rawMode;
      parts.push("mode=" + rawMode);
    } else if (rawMode !== null) {
      console.log("[dev] ?cold=" + rawMode + " is not fixed|relative — ignored.");
    }
    if (rawAfter !== null) {
      const after = Number(rawAfter);
      if (Number.isFinite(after)) {
        patch.coldAfterDays = after; // server clamps to the legal range
        parts.push("after=" + after + "d");
      } else {
        console.log("[dev] ?coldafter=" + rawAfter + " is not a finite number — ignored.");
      }
    }
    if (rawTarget !== null) {
      const target = Number(rawTarget);
      if (Number.isFinite(target)) {
        patch.coldTargetSharePct = target; // server clamps to the legal range
        parts.push("target=" + target + "%");
      } else {
        console.log("[dev] ?coldtarget=" + rawTarget + " is not a finite number — ignored.");
      }
    }
    if (rawFloor !== null) {
      const floor = Number(rawFloor);
      if (Number.isFinite(floor)) {
        patch.coldFloorDays = floor; // server clamps to the legal range
        parts.push("floor=" + floor + "d");
      } else {
        console.log("[dev] ?coldfloor=" + rawFloor + " is not a finite number — ignored.");
      }
    }
    if (Object.keys(patch).length === 0) return;

    const saved = Server.api.saveSettings({ patch: patch });
    if (saved && saved.ok) {
      const d = saved.data || {};
      console.log(
        "[dev] cold zone: mode=" + d.coldZoneMode + ", after=" + d.coldAfterDays + "d, " +
        "target=" + d.coldTargetSharePct + "%, floor=" + d.coldFloorDays + "d" +
        (parts.length ? " (requested " + parts.join(", ") + ")" : ""),
      );
    } else {
      console.log(
        "[dev] cold-zone flags — save refused: " + ((saved && saved.error) || "unknown error") + ".",
      );
    }
  })();

  // Seed a few value chains so the sidebar's global Value Chain filter (and the
  // Overview "by domain" breakdown) are exercisable in dev. Sample asset names encode
  // their role (web-prod-01, db-replica-02, …), so name_regex rules partition the
  // fleet cleanly with nothing left Unassigned. Dev-only — dev/ is never bundled.
  const domainSeed = Server.api.saveDomains({
    items: [
      { name: "Customer-facing", rules: [{ conditions: [{ type: "name_regex", pattern: "^(web-prod|api-prod|edge-proxy)" }] }] },
      { name: "Data & batch", rules: [{ conditions: [{ type: "name_regex", pattern: "^(db-replica|cache-node|batch-worker)" }] }] },
      { name: "Build & dev", rules: [{ conditions: [{ type: "name_regex", pattern: "^(dev-box|ci-runner)" }] }] },
    ],
  });
  if (!domainSeed.ok || domainSeed.data?.saved === false) {
    console.error("[dev] seed value chains failed:", domainSeed.error || domainSeed.data?.errors);
  } else {
    console.log("[dev] seeded 3 value chains");
  }

  // Dev-only, URL-gated in-flight scan seed for exercising the progress card / details
  // sheet (?seedJob=running or ?seedJob=stuck). Writes a non-terminal jobs row directly
  // so api_bootstrap surfaces it as activeJob. Never shipped — dev/ is not bundled.
  (function seedJobFromUrl() {
    const kind = new URLSearchParams(location.search).get("seedJob");
    if (kind !== "running" && kind !== "stuck") return;
    const id = PropertiesService.getScriptProperties().getProperty("LEDGER_SPREADSHEET_ID");
    const sh = SpreadsheetApp.openById(id).getSheetByName("jobs");
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const now = RealDate.now();
    // "stuck": last update ~17h ago (past STUCK_MS) → the "may have stopped" note + big
    // elapsed. "running": just now. error:"null" reproduces the bad round-trip the server
    // normalizer must scrub away.
    const ageMs = kind === "stuck" ? 17 * 3600_000 : 4000;
    const iso = (ms) => new RealDate(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    const row = {
      job_id: "scan-DEV" + kind.toUpperCase(),
      kind: "scan",
      phase: "FETCHING",
      scan_id: iso(now - ageMs),
      cursor: "",
      page: 9,
      findings_so_far: 4500,
      page_size: 500,
      total_count: 0,
      params_json: JSON.stringify({ incremental: false }),
      journal_ref: "",
      error: "null",
      started_at: iso(now - ageMs),
      updated_at: iso(now - ageMs),
    };
    const values = headers.map((h) => (h in row ? row[h] : ""));
    sh.getRange(sh.getLastRow() + 1, 1, 1, headers.length).setValues([values]);
    console.log(`[dev] seeded ${kind} scan job`);
  })();

  // Optional artificial RPC latency (?slow=<ms>) so loading states — the route-reload
  // overlay, scan progress card, etc. — are exercisable locally; RPCs are otherwise
  // near-instant in dev. Default 0 keeps normal behavior.
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
