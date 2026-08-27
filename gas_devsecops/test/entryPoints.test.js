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
