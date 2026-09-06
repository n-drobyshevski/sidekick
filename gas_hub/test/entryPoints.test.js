// dist/entry.js is hand-written and dist/server.js is generated, so nothing but this test
// makes them agree.
//
// The failure it catches is silent and PRODUCTION-ONLY: an endpoint added to api.ts without
// a delegator here type-checks, bundles, deploys, and then google.script.run reports only
// that the function does not exist. The reverse — a delegator left behind after its export
// was removed — throws inside timedApi_ instead, which is louder but no easier to find.
//
// TWO THINGS THIS APP HAS THAT THE REGISTERS' VERSION OF THIS FILE DOES NOT COVER, and both
// are absences it now asserts rather than omits:
//
//   * NO WELCOME HOP. The registers' `doGet` runs `deniedPage()` and then `welcome.gate()`,
//     and their test pins the ORDER of those two. This app has no `welcome.ts` at all — a
//     deliberate product decision, since every journey through this hub ends at a sibling
//     that runs its own "signed in as X, Continue" gate and two interstitials answer the same
//     question twice. So the assertion here is that the gate is ABSENT, which is a different
//     claim from "it comes second" and is the one worth failing on if somebody forks it back.
//   * NO TRIGGERS AND NO EDITOR GLOBALS. The registers declare `setup()`, three diagnostics
//     and four `trigger_*` handlers. This app provisions nothing, fetches nothing and runs no
//     job, so it declares none — and a trigger handler is the one entry point whose failure
//     is completely silent, which makes "there are none" worth stating out loud.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ENTRY = readFileSync(new URL("../dist/entry.js", import.meta.url), "utf8");
const API = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
const INDEX = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");

/**
 * Comments removed, so a file EXPLAINING what it deliberately does not do is not read as
 * doing it. Both files below say "welcome" in prose — at length, because the absence of that
 * gate is a product decision somebody will otherwise try to fix — and the assertions about
 * that absence have to read code rather than the sentence describing it. This is the same
 * trap `gas_shared/test/contracts/emptyStates.js`'s own `code()` exists for; a naive stripper
 * is enough here because neither file contains a string literal with a `//` in it.
 */
const decomment = (src) => src
  // Blanked CHARACTER FOR CHARACTER rather than deleted, newlines kept: several assertions
  // below anchor on `^function`, and a stripper that collapsed a JSDoc block to one space
  // would pull the declaration under it off the start of its line and quietly match nothing.
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/^[ \t]*\/\/.*$/gm, "");
const ENTRY_CODE = decomment(ENTRY);
const INDEX_CODE = decomment(INDEX);

const exported = [...API.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
const delegated = [...ENTRY.matchAll(/^function api_(\w+)\(/gm)].map((m) => m[1]);

describe("the RPC surface", () => {
  it("exports something at all", () => {
    expect(exported.length).toBeGreaterThan(0);
  });

  it("gives every api.ts export a delegator", () => {
    expect([...exported].sort()).toEqual([...delegated].sort());
  });

  it("is the six endpoints this app actually has", () => {
    // Named, not just counted: this is a launcher, and the whole server surface is "what are
    // the four tiles" plus the two admin panels that edit the properties behind them. A
    // seventh appearing here is a change of what this app is, and should have to be typed out.
    expect([...delegated].sort()).toEqual(
      ["bootstrap", "getAccess", "getUrls", "saveAccess", "saveAdmins", "saveUrls"],
    );
  });

  it("routes every delegator through the access + timing chokepoint", () => {
    for (const name of delegated) {
      expect(ENTRY).toContain(`function api_${name}(p) { return timedApi_("${name}", p); }`);
    }
  });

  it("checks access before doing any work", () => {
    const body = ENTRY.slice(ENTRY.indexOf("function timedApi_"));
    expect(body.indexOf("denyResult")).toBeLessThan(body.indexOf("Server.api[name]"));
  });
});

describe("the web-app entry", () => {
  it("refuses before it draws", () => {
    const body = ENTRY.slice(ENTRY.indexOf("function doGet"), ENTRY.indexOf("function include"));
    expect(body.indexOf("deniedPage")).toBeGreaterThan(-1);
    expect(body.indexOf("deniedPage")).toBeLessThan(body.indexOf("Server.doGet"));
  });

  it("has NO welcome gate — deliberately, and no forked module to re-enable one from", () => {
    // The absence is the product decision (see this file's header and README.md's "what this
    // app deliberately does not have"). Asserted in both places it could come back: the
    // entry's own doGet, and the Server namespace it would have to be exported through.
    expect(ENTRY_CODE, "a welcome hop has been added to doGet").not.toMatch(/welcome/i);
    expect(INDEX_CODE, "src/server/welcome.ts has been forked back in").not.toMatch(/welcome/i);
  });

  it("gates include(), which is otherwise an open file-read primitive", () => {
    expect(ENTRY).toMatch(/function include\(filename\)[\s\S]*denyResult\("include"\)/);
  });

  it("exposes every global entry.js reaches for on the Server namespace", () => {
    // Three, not the registers' six: no `welcome`, no `setup`, and no job namespace.
    for (const name of ["doGet", "include", "access", "api"]) {
      expect(INDEX, `Server.${name} is not exported`).toMatch(
        new RegExp(`export (\\* as ${name}|\\{[^}]*\\b${name}\\b)`),
      );
    }
  });
});

describe("what this app declares no entry point for", () => {
  it("declares no `trigger_` function", () => {
    // A trigger handler is the one entry point whose failure is COMPLETELY SILENT: it runs on
    // a schedule with no user, no page and nobody waiting on a result. This app installs none
    // because it has no job to run — and the registers' own hard-won rule (an installable
    // trigger must NOT be gated, because `Session.getActiveUser()` is "" for it and the gate
    // would deny every firing) only has to be re-argued if one appears. Failing here is how
    // that argument gets asked for.
    expect(ENTRY_CODE.match(/function trigger_\w+/g)).toBeNull();
  });

  it("declares no editor-run global either", () => {
    // `setup()`, `deploymentDiagnostic()`, `wizDiagnostic()`, `resetStuckJob()` in the
    // registers. This app provisions nothing: its only state is five Script Properties an
    // operator sets by hand, so there is nothing for a setup() to create.
    for (const name of ["setup", "deploymentDiagnostic", "wizDiagnostic", "resetStuckJob"]) {
      expect(ENTRY_CODE, `${name}() has appeared with no argument for it`)
        .not.toMatch(new RegExp(`^function ${name}\\(`, "m"));
    }
  });

  it("is not a vacuous sweep — entry.js really does declare globals", () => {
    // Without this, a renamed or emptied entry.js would pass every "declares no X" above by
    // declaring nothing at all.
    const globals = ENTRY_CODE.match(/^function \w+/gm) || [];
    expect(globals.length).toBeGreaterThanOrEqual(delegated.length + 3);
  });
});
