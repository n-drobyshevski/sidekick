// dist/entry.js IS NOT GENERATED, and that is the whole reason this file exists.
//
// Its first line says so: "Hand-written GAS entry points. The build never touches this file."
// GAS requires every `google.script.run` target and every trigger handler to be a top-level
// global function, so the bundled `Server` object cannot serve them directly — each one needs a
// delegator written by hand.
//
// WHAT THIS FILE DOES *NOT* ASSERT, and why. esbuild.config.mjs already carries an entry.js
// drift guard that fails the BUILD when `api.ts`'s exports and entry.js's `api_*` delegators
// disagree, in both directions. The sibling gas tool asserts that parity here instead, because
// its build has no such guard; re-asserting it would be two mechanisms for one claim, and the
// build's is the stricter of the two (it runs on `npm run build`, not only on `npm run test`).
//
// What is left is everything the build guard cannot see: the ORDER of the access guards, the
// client's RPC name strings, the namespaces entry.js reaches for on `Server`, and the trigger
// contract. All of it asserted as text, because nothing executes this file.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = readFileSync(join(root, "dist/entry.js"), "utf8");

/** Top-level `function name(` declarations in entry.js. */
const globals = new Set([...entry.matchAll(/^function\s+(\w+)\s*\(/gm)].map((m) => m[1]!));

describe("every trigger handler named in src/ exists in entry.js", () => {
  // The bug this catches: a trigger installed against a handler that only exists inside the
  // bundle. `ScriptApp.newTrigger("trigger_x")` happily creates a trigger for a function that
  // does not exist, which then fails on every fire, silently, in the trigger execution log
  // where nobody is looking.
  it("has a global for each trigger_* handler setup() installs", () => {
    const referenced = new Set(
      [...readFileSync(join(root, "src/server/setup.ts"), "utf8")
        .matchAll(/"(trigger_\w+)"/g)].map((m) => m[1]!),
    );
    expect(referenced.size).toBeGreaterThan(0); // the regex must actually be finding them
    for (const name of referenced) expect(globals).toContain(name);
  });

  it("has a global for the continuation handler syncJobs.ts re-arms", () => {
    const src = readFileSync(join(root, "src/server/syncJobs.ts"), "utf8");
    const found = [...src.matchAll(/CONTINUE_HANDLER\s*=\s*"(\w+)"/g)].map((m) => m[1]!);
    expect(found.length).toBeGreaterThan(0);
    for (const name of found) expect(globals).toContain(name);
  });
});

describe("every RPC name the client types actually exists", () => {
  // The half the build's drift guard cannot see: it pins api.ts against entry.js, but the
  // CLIENT names the global as a STRING — call("api_getSettings") — and nothing checks those.
  // A call("getAccess") that should have read call("api_getAccess") type-checks, unit-tests
  // green, and fails only in a browser, where the dev shim answers "Unknown RPC" and the whole
  // page renders "This page failed to load".
  it("matches every call(\"...\") in the client to a global in entry.js", () => {
    const clientDir = join(root, "src/client/js");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js")) files.push(p);
      }
    };
    walk(clientDir);
    const named = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/\bcall\(\s*"([^"]+)"/g)) named.add(m[1]!);
    }
    expect(named.size).toBeGreaterThan(10); // the regex must actually be finding them
    expect([...named].filter((n) => !globals.has(n))).toEqual([]);
  });
});

describe("the access guard covers every untrusted entry point", () => {
  /** The body of a top-level `function name(...) { ... }` in entry.js, braces balanced. */
  function body(name: string): string {
    const start = entry.search(new RegExp(`^function\\s+${name}\\s*\\(`, "m"));
    expect(start, `${name} is not a global in entry.js`).toBeGreaterThanOrEqual(0);
    const i = entry.indexOf("{", start);
    let depth = 0;
    for (let j = i; j < entry.length; j++) {
      if (entry[j] === "{") depth++;
      else if (entry[j] === "}" && --depth === 0) return entry.slice(i + 1, j);
    }
    throw new Error(`unbalanced braces in ${name}`);
  }

  it("gates every api_* endpoint at their one chokepoint, before any work happens", () => {
    // Every api_* delegator routes through timedApi_, so one check there covers all of them —
    // including api_resetData, api_pruneToProject and api_setAarsRule. The ORDER is the
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
    // publish `timedApi("resetData", {})` as an unguarded arbitrary-dispatch endpoint.
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

  it("gates doGet, include and every editor-run global", () => {
    // probeSyncStep is the one a naive port drops. It calls Server.api.probeSyncStep DIRECTLY
    // rather than going through timedApi_, so the chokepoint above does not cover it — and it
    // is a top-level global like any other, which makes it google.script.run-reachable.
    for (const name of [
      "doGet", "include", "setup", "wizDiagnostic", "aarsDiagnostic",
      "registerScopeDiagnostic", "probeEdgeSteps", "pinPostureBaseline", "postureDelta",
      "probeSyncStep",
    ]) {
      expect(body(name), `${name} is ungated`).toContain("Server.access.");
    }
  });

  it("guards the trigger handlers on IDENTITY, never on allowed-ness alone", () => {
    // DELIBERATELY DIFFERENT FROM THE SIBLING gas TOOL, which leaves these ungated
    // (gas/dist/entry.js:43-51). Its reasoning is sound and still binds: an installable
    // trigger fires with NO accessing user, so Session.getActiveUser().getEmail() returns ""
    // and access.ts reads it as anonymous — a plain `if (denyResult(...)) return;` here would
    // DENY EVERY FIRE, silently killing the daily sync and every continuation hop in the
    // trigger execution log where nobody is watching.
    //
    // But that rules out a BLANKET guard, not every guard. These are top-level globals, so
    // google.script.run reaches them — including from the denied page, which HtmlService
    // serves with google.script.run injected. A same-domain account that was just refused
    // could otherwise call trigger_dailySync() from that page's console and run full Wiz syncs
    // on the owner's quota and credentials, repeatably. So the guard is identity-aware:
    // `d.email` is "" on a scheduled fire and it proceeds untouched; an identified-but-refused
    // caller is turned away.
    //
    // WHAT MUST NEVER APPEAR HERE is the blanket form. That is what the last two assertions
    // pin — on the handlers AND on the helper, so moving the guard into triggerAllowed_ cannot
    // be how a blanket deny sneaks back in.
    const triggers = [...globals].filter((n) => n.startsWith("trigger_"));
    expect(triggers.length).toBeGreaterThan(0);
    for (const name of triggers) {
      const b = body(name);
      expect(b, `${name} must consult the identity-aware guard`).toContain("triggerAllowed_()");
      expect(b, `${name} must not deny unconditionally`)
        .not.toContain("Server.access.denyResult(");
      expect(b, `${name} must not throw at a scheduled fire`)
        .not.toContain("Server.access.assertAllowed(");
    }

    // The helper itself: it must let an unidentified caller — which is what a scheduled fire
    // looks like — through, and it must decide from access rather than from anything else.
    const helper = body("triggerAllowed_");
    expect(helper).toContain("Server.access.check()");
    expect(helper, "an empty email is a scheduled fire and must pass").toContain("!d.email");
    expect(helper).toContain("d.allowed");
    expect(helper).not.toContain("Server.access.denyResult(");
    expect(helper).not.toContain("Server.access.assertAllowed(");
    // Trailing underscore, same reason as timedApi_: it must not itself be an RPC.
    expect(globals).not.toContain("triggerAllowed");
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
