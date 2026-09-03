// dist/entry.js is hand-written and dist/server.js is generated, so nothing but this test
// makes them agree.
//
// The failure it catches is silent and PRODUCTION-ONLY: an endpoint added to api.ts without
// a delegator here type-checks, bundles, deploys, and then google.script.run reports only
// that the function does not exist. The reverse — a delegator left behind after its export
// was removed — throws inside timedApi_ instead, which is louder but no easier to find.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ENTRY = readFileSync(new URL("../dist/entry.js", import.meta.url), "utf8");
const API = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
const INDEX = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");

const exported = [...API.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
const delegated = [...ENTRY.matchAll(/^function api_(\w+)\(/gm)].map((m) => m[1]);

describe("the RPC surface", () => {
  it("exports something at all", () => {
    expect(exported.length).toBeGreaterThan(0);
  });

  it("gives every api.ts export a delegator", () => {
    expect([...exported].sort()).toEqual([...delegated].sort());
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
  it("refuses before it invites — a denied visitor must not see the welcome gate", () => {
    const body = ENTRY.slice(ENTRY.indexOf("function doGet"), ENTRY.indexOf("function include"));
    expect(body.indexOf("deniedPage")).toBeLessThan(body.indexOf("welcome.gate"));
  });

  it("gates include(), which is otherwise an open file-read primitive", () => {
    expect(ENTRY).toMatch(/function include\(filename\)[\s\S]*denyResult\("include"\)/);
  });

  it("exposes every global entry.js reaches for on the Server namespace", () => {
    for (const name of ["doGet", "include", "access", "welcome", "setup", "api"]) {
      expect(INDEX, `Server.${name} is not exported`).toMatch(
        new RegExp(`export (\\* as ${name}|\\{[^}]*\\b${name}\\b)`),
      );
    }
  });
});

describe("editor-run entry points", () => {
  it("are gated — the editor runs as whoever opened it", () => {
    for (const name of ["setup", "deploymentDiagnostic"]) {
      expect(ENTRY).toMatch(
        new RegExp(`function ${name}\\(\\)[\\s\\S]{0,120}assertAllowed\\("${name}"\\)`),
      );
    }
  });
});

// ---------------------------------------------------------------------------- triggers
//
// A trigger handler is the one entry point whose failure is COMPLETELY SILENT. It runs on a
// schedule, with no user, no page and no caller waiting on a result, so a handler that is
// missing, misnamed, or refused by the access gate produces nothing at all: no error a person
// sees, no row anywhere, just a sync that quietly stopped running. Every case below exists
// because the symptom is absence.

/** Trigger handler -> the Server namespace + method it must delegate into. */
const TRIGGERS = {
  trigger_continueSync: "Server.scanJobs.continueJob",
  trigger_watchdogSync: "Server.scanJobs.watchdogSync",
  trigger_dailySync: "Server.scanJobs.dailySync",
  trigger_warmReadModels: "Server.readModels.warmReadModels",
};

/** One handler's body — from its `function` keyword to the closing brace on the same line. */
function handlerBody(name) {
  const at = ENTRY.indexOf(`function ${name}(`);
  return at === -1 ? null : ENTRY.slice(at, ENTRY.indexOf("\n", at));
}

describe("trigger handlers", () => {
  it("exist, one per installed handler name", () => {
    for (const name of Object.keys(TRIGGERS)) {
      expect(handlerBody(name), `${name} has no global in entry.js`).not.toBeNull();
    }
  });

  it("delegate into the module the trigger is meant to run", () => {
    for (const [name, target] of Object.entries(TRIGGERS)) {
      expect(handlerBody(name)).toContain(target);
    }
  });

  /**
   * THE CASE THIS SECTION EXISTS FOR.
   *
   * An installable trigger runs as the project owner with NO ACTIVE USER, so
   * `access.denyResult` / `assertAllowed` fail closed on it. Gating a handler therefore does
   * not make it safer — it makes it never run, once a day, forever, with no symptom. So the
   * assertion is that the gate is ABSENT, which is the opposite of every other case in this
   * file and is why it is spelled out rather than folded into the loop above.
   */
  it("are NOT gated — a gated trigger is a trigger that never fires", () => {
    for (const name of Object.keys(TRIGGERS)) {
      const body = handlerBody(name);
      expect(body, `${name} must not call denyResult`).not.toContain("denyResult");
      expect(body, `${name} must not call assertAllowed`).not.toContain("assertAllowed");
      expect(body, `${name} must not go through timedApi_`).not.toContain("timedApi_");
    }
  });

  it("carry no api_ delegator — a trigger is not an RPC", () => {
    for (const name of Object.keys(TRIGGERS)) {
      expect(delegated).not.toContain(name.replace(/^trigger_/, ""));
    }
  });

  it("exposes the two namespaces the handlers reach for on Server", () => {
    for (const name of ["scanJobs", "readModels"]) {
      expect(INDEX, `Server.${name} is not exported`).toMatch(
        new RegExp(`export (\\* as ${name}|\\{[^}]*\\b${name}\\b)`),
      );
    }
  });

  /**
   * The names are FIXED by the code that installs and clears the triggers, not chosen here.
   * `scanJobs` arms its one-shots by `jobsStore.CONTINUE_HANDLERS` / `WATCHDOG_HANDLERS` and
   * `setup.ts` installs the two standing ones by literal; a rename on either side points a
   * live trigger at a function that no longer exists, which fails on a schedule and says
   * nothing.
   */
  it("match the names jobsStore and setup.ts actually install", () => {
    const JOBS = readFileSync(new URL("../src/server/jobsStore.ts", import.meta.url), "utf8");
    const SETUP = readFileSync(new URL("../src/server/setup.ts", import.meta.url), "utf8");
    expect(JOBS).toContain('sync: "trigger_continueSync"');
    expect(JOBS).toContain('sync: "trigger_watchdogSync"');
    expect(SETUP).toContain('const DAILY_SYNC_HANDLER = "trigger_dailySync"');
    expect(SETUP).toContain('const WARM_HANDLER = "trigger_warmReadModels"');
  });
});
