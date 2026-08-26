// dist/entry.js IS NOT GENERATED, and that is the whole reason this file exists.
//
// Its first line says so: "Hand-written GAS entry points. The build never touches this file."
// GAS requires every `google.script.run` target and every trigger handler to be a top-level
// global function, so the bundled `Server` object cannot serve them directly — each one needs a
// delegator written by hand.
//
// The failure mode is silent and asymmetric. `dev/boot.js` auto-discovers any `Server.api[name]`,
// so a new endpoint works in `npm run dev`, passes every test, and throws only in production. A
// trigger is worse: `ScriptApp.newTrigger("trigger_x")` happily creates a trigger for a function
// that does not exist, which then fails on every fire, silently, in the trigger execution log
// where nobody is looking.
//
// So the parity is asserted here rather than audited by hand each time.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = readFileSync(join(root, "dist/entry.js"), "utf8");
const apiSrc = readFileSync(join(root, "src/server/api.ts"), "utf8");

/** Top-level `function name(` declarations in entry.js. */
const globals = new Set([...entry.matchAll(/^function\s+(\w+)\s*\(/gm)].map((m) => m[1]!));
/** The api names entry.js forwards to, via timedApi_("name", …). */
const forwarded = new Set([...entry.matchAll(/timedApi_\("(\w+)"/g)].map((m) => m[1]!));

// Exported from api.ts but deliberately not RPCs — called server-side only.
const NOT_RPCS = new Set(["warmReadModels", "warmReadModelsScheduled"]);

describe("every trigger handler named in src/ exists in entry.js", () => {
  // The bug this catches: a trigger installed against a handler that only exists inside the
  // bundle. It creates fine and fails forever.
  it("has a global for each trigger_* handler the server installs", () => {
    const referenced = new Set(
      [...readFileSync(join(root, "src/server/setup.ts"), "utf8")
        .matchAll(/"(trigger_\w+)"/g)].map((m) => m[1]!),
    );
    expect(referenced.size).toBeGreaterThan(0); // the regex must actually be finding them
    for (const name of referenced) expect(globals).toContain(name);
  });

  it("has a global for each trigger_* handler used as a continuation elsewhere", () => {
    for (const file of ["scanJobs.ts", "backfillJobs.ts", "purgeJobs.ts"]) {
      const src = readFileSync(join(root, "src/server", file), "utf8");
      for (const m of src.matchAll(/CONTINUE_HANDLER\s*=\s*"(\w+)"/g)) {
        expect(globals).toContain(m[1]!);
      }
    }
  });
});

describe("every exported api function is reachable from entry.js", () => {
  // The other half of the same trap: an endpoint the client can call in dev and cannot in GAS.
  it("forwards every exported api.ts function that is meant to be an RPC", () => {
    const exported = [...apiSrc.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]!);
    expect(exported.length).toBeGreaterThan(20);
    const missing = exported.filter((n) => !NOT_RPCS.has(n) && !forwarded.has(n));
    expect(missing).toEqual([]);
  });

  it("forwards nothing api.ts does not export", () => {
    const exported = new Set([...apiSrc.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]!));
    expect([...forwarded].filter((n) => !exported.has(n))).toEqual([]);
  });

  // NOT_RPCS is a deliberate allowlist, so it must not quietly rot into a list of things that
  // used to exist.
  it("keeps its allowlist honest — every entry is still exported by api.ts", () => {
    const exported = new Set([...apiSrc.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]!));
    for (const n of NOT_RPCS) expect(exported).toContain(n);
  });
});

// The access guard lives in this same untestable layer, and for the same reason: it has to sit
// where google.script.run actually arrives, which is the top-level globals, not the bundle.
// So it gets the same treatment — asserted as text, since nothing executes this file.
describe("the access guard covers every untrusted entry point", () => {
  /** The body of a top-level `function name(...) { ... }` in entry.js, braces balanced. */
  function body(name: string): string {
    const start = entry.search(new RegExp(`^function\\s+${name}\\s*\\(`, "m"));
    expect(start, `${name} is not a global in entry.js`).toBeGreaterThanOrEqual(0);
    let i = entry.indexOf("{", start);
    let depth = 0;
    for (let j = i; j < entry.length; j++) {
      if (entry[j] === "{") depth++;
      else if (entry[j] === "}" && --depth === 0) return entry.slice(i + 1, j);
    }
    throw new Error(`unbalanced braces in ${name}`);
  }

  it("gates all 54 api_* endpoints at their one chokepoint, before any work happens", () => {
    // Every api_* delegator routes through timedApi_, so one check here covers all of them —
    // including api_resetLedger, api_deleteScans and api_startSeverityPurge. The ORDER is the
    // assertion: a guard that runs after Server.api[name](p) has already executed is not a
    // guard, and both strings being merely present would not catch that.
    const b = body("timedApi_");
    const guard = b.indexOf("Server.access.denyResult(");
    const work = b.indexOf("Server.api[name]");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(work).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(work);
  });

  it("cannot be bypassed by calling the chokepoint itself", () => {
    // timedApi_ takes an arbitrary endpoint name. Its trailing underscore is the only reason
    // google.script.run cannot reach it — GAS treats such names as private. Renaming it would
    // publish `timedApi("resetLedger", {})` as an unguarded arbitrary-dispatch endpoint.
    expect(globals).toContain("timedApi_");
    expect(globals).not.toContain("timedApi");
  });

  it("puts the denial ahead of the entry screen in doGet", () => {
    // Order, not presence. Reversed, a caller the allowlist rejects would be welcomed by name
    // to an app they cannot open, and only then turned away — and welcome.gate() would be
    // keying a session marker for somebody who has no business having one.
    const b = body("doGet");
    const denied = b.indexOf("Server.access.");
    const welcome = b.indexOf("Server.welcome.");
    const app = b.indexOf("Server.doGet(");
    expect(denied).toBeGreaterThanOrEqual(0);
    expect(welcome).toBeGreaterThanOrEqual(0);
    expect(denied).toBeLessThan(welcome);
    expect(welcome).toBeLessThan(app);
  });

  it("gates doGet, include and every editor-run maintenance global", () => {
    for (const name of ["doGet", "include", "setup", "wizDiagnostic", "resetStuckJob"]) {
      expect(body(name), `${name} is ungated`).toContain("Server.access.");
    }
  });

  it("leaves the trigger handlers ungated, ON PURPOSE", () => {
    // DO NOT "FIX" THIS BY ADDING THE GUARD. An installable trigger fires with no accessing
    // user, so Session.getActiveUser().getEmail() returns "" and access.ts reads it as
    // anonymous — a guard here would DENY every fire, killing the daily scan and every
    // continuation hop silently, in the trigger execution log where nobody is watching. They
    // are reachable from a browser only via a page doGet has already gated, and they offer an
    // allowed user nothing the UI's own Run scan does not.
    const triggers = [...globals].filter((n) => n.startsWith("trigger_"));
    expect(triggers.length).toBeGreaterThan(0);
    for (const name of triggers) {
      expect(body(name), `${name} must not be identity-gated`).not.toContain("Server.access.");
    }
  });

  it("calls only namespaces src/server/index.ts actually exports", () => {
    // dist/server.js is a committed build artifact, so entry.js can outrun it: an entry.js
    // that calls Server.access against a bundle built before access.ts existed fails on EVERY
    // request with a TypeError — a total outage from a stale commit, not a broken feature.
    const indexSrc = readFileSync(join(root, "src/server/index.ts"), "utf8");
    const exported = new Set<string>([
      ...[...indexSrc.matchAll(/^export \* as (\w+) from/gm)].map((m) => m[1]!),
      ...[...indexSrc.matchAll(/^export \{([^}]+)\} from/gm)]
        .flatMap((m) => m[1]!.split(",").map((s) => s.trim())),
    ]);
    const used = new Set([...entry.matchAll(/\bServer\.(\w+)\./g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((n) => !exported.has(n))).toEqual([]);
  });
});
