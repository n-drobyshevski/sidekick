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
