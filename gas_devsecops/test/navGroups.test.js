// The information architecture has ONE source, and this is what keeps it that way.
//
// PAGES in app.js is the only list of routes; navModel derives the rail from it and
// routeIcons has to keep step. The failures below are all silent at runtime — a lane with
// no mark draws an empty 76px square, a route with no mark draws a nameless row, and a lane
// split in two draws its heading twice — so they are worth a test rather than a convention.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LANE_ICONS, ROUTE_ICONS } from "../src/client/js/routeIcons.js";

const APP = readFileSync(new URL("../src/client/js/app.js", import.meta.url), "utf8");

/** Read the PAGES table out of app.js as text — importing it would need a DOM. */
function pages() {
  const body = APP.slice(APP.indexOf("const PAGES = {"), APP.indexOf("\n};", APP.indexOf("const PAGES = {")));
  const out = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s{2}(\w+):\s*\{(.*)$/);
    if (!m) continue;
    const groupMatch = m[2].match(/group:\s*(null|"([^"]*)")/);
    out.push({
      route: m[1],
      group: groupMatch ? (groupMatch[1] === "null" ? null : groupMatch[2]) : undefined,
      title: (m[2].match(/title:\s*"([^"]*)"/) || [])[1],
    });
  }
  return out;
}

const PAGES = pages();
const LANES = [...new Set(PAGES.map((p) => p.group).filter(Boolean))];

describe("the route table", () => {
  it("parses, and holds the ten routes this register composed", () => {
    expect(PAGES.map((p) => p.route)).toEqual([
      "executive", "mttr", "program",
      "sca", "sast", "secrets",
      "repos", "history", "data",
      "settings",
    ]);
  });

  it("gives every route a title", () => {
    for (const p of PAGES) expect(p.title, `${p.route} has no title`).toBeTruthy();
  });

  it("declares a group for every route, null included", () => {
    for (const p of PAGES) expect(p.group, `${p.route} has no group`).not.toBe(undefined);
  });
});

describe("lanes", () => {
  it("are contiguous — a split lane would draw its heading twice", () => {
    const seen = new Set();
    let last;
    for (const p of PAGES) {
      if (p.group !== last) {
        expect(seen.has(p.group), `lane ${p.group} appears in two runs`).toBe(false);
        seen.add(p.group);
        last = p.group;
      }
    }
  });

  it("each earn their heading by holding two pages", () => {
    for (const lane of LANES) {
      const held = PAGES.filter((p) => p.group === lane);
      expect(held.length, `lane ${lane} holds ${held.length} page(s)`).toBeGreaterThanOrEqual(2);
    }
  });

  it("put the chrome tail last, so the rule above it separates chrome from register", () => {
    const firstTail = PAGES.findIndex((p) => p.group === null);
    expect(firstTail).toBeGreaterThan(-1);
    expect(PAGES.slice(firstTail).every((p) => p.group === null)).toBe(true);
  });
});

describe("nav marks", () => {
  it("give every lane exactly one", () => {
    expect(Object.keys(LANE_ICONS).sort()).toEqual([...LANES].sort());
  });

  it("give every route exactly one", () => {
    expect(Object.keys(ROUTE_ICONS).sort()).toEqual(PAGES.map((p) => p.route).sort());
  });

  it("draw them all on the same 24 grid, on currentColor", () => {
    for (const [name, svg] of [...Object.entries(LANE_ICONS), ...Object.entries(ROUTE_ICONS)]) {
      expect(svg, `${name} is not a 24-grid svg`).toContain('viewBox="0 0 24 24"');
      expect(svg, `${name} does not inherit colour`).toContain("currentColor");
      expect(svg, `${name} is not hidden from assistive tech`).toContain('aria-hidden="true"');
      // A CDN or icon-font reference would be blocked by the GAS sandbox at runtime only.
      expect(svg, `${name} reaches outside the bundle`).not.toContain("url(");
    }
  });
});

describe("the landing route", () => {
  it("is one this table actually defines", () => {
    const store = readFileSync(new URL("../src/client/js/store.js", import.meta.url), "utf8");
    const dflt = store.match(/DEFAULT_ROUTE = "(\w+)"/)[1];
    expect(PAGES.map((p) => p.route)).toContain(dflt);
    // A mistyped deep link lands here, so it must not be a page gated off the nav.
    expect(dflt).toBe("executive");
  });
});

describe("every route has a page module behind it", () => {
  it("imports one render function per route", () => {
    for (const p of PAGES) {
      expect(APP, `${p.route} has no import`).toMatch(
        new RegExp(`from "\\./pages/${p.route}\\.js"`),
      );
    }
  });
});

describe("navModel.js names no lane that PAGES does not compose", () => {
  it("every quoted lane id it compares against is a real PAGES group", () => {
    // Read navModel.js as text, the same way `pages()` above reads app.js as text rather
    // than importing it — navModel.js is DOM-free and could be imported, but the point is
    // to catch a hardcoded lane id even if it sits in dead code no runtime path reaches.
    const NAV = readFileSync(new URL("../src/client/js/navModel.js", import.meta.url), "utf8");
    // A lane/group id is capitalized ("Program", "Registers", "Data" — as opposed to the
    // lowercase `kind` values "lane"/"page" this file also compares with `===`), so filter
    // on that shape rather than name specific properties, which is what let a fork-inherited
    // id like "Landscape" or "Risk" go unnoticed here before.
    const laneLiterals = [...NAV.matchAll(/[=!]==\s*["']([A-Z][A-Za-z]*)["']/g)].map((m) => m[1]);
    const groups = new Set(PAGES.map((p) => p.group).filter(Boolean));
    for (const lit of laneLiterals) {
      expect(groups.has(lit), `navModel.js compares against "${lit}", which is not a PAGES group`).toBe(true);
    }
  });
});

describe("navModel.js mentions no module that does not exist", () => {
  // A parent-app fork left navModel.js citing `prunePanelView.js` (never ported here) and a
  // "Risk"/"Assurance" example describing lanes this app never had — stale comments a reader
  // would take as documentation of the current app. Every `whatever.js` this file names in
  // prose is checked against the files that actually ship, in the same places a bare import
  // would resolve it: alongside navModel.js itself, or in test/ for a `*.test.js` mention.
  it("every *.js name it cites resolves to a real file", () => {
    const NAV = readFileSync(new URL("../src/client/js/navModel.js", import.meta.url), "utf8");
    const here = fileURLToPath(new URL("../src/client/js/", import.meta.url));
    const testDir = fileURLToPath(new URL("../test/", import.meta.url));
    const names = [...new Set([...NAV.matchAll(/\b[A-Za-z0-9_.]+\.js\b/g)].map((m) => m[0]))];
    expect(names.length, "no .js name found — the pattern below would vacuously pass").toBeGreaterThan(0);
    for (const name of names) {
      const candidates = name.endsWith(".test.js")
        ? [testDir + name]
        : [here + name, testDir + name];
      expect(
        candidates.some((c) => existsSync(c)),
        `navModel.js names "${name}", which exists at none of: ${candidates.join(", ")}`,
      ).toBe(true);
    }
  });
});
