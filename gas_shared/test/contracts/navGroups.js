// The information architecture has ONE source, and this is what keeps it that way.
//
// PAGES in app.js is the only list of routes; navModel derives the rail from it and
// routeIcons has to keep step. The failures below are all silent at runtime — a lane with
// no mark draws an empty 76px square, a route with no mark draws a nameless row, and a lane
// split in two draws its heading twice — so they are worth a test rather than a convention.
//
// TWO RULES renderSidebar depends on, and both were learned by breaking them:
//   * A LABELLED LANE EARNS ITS HEADING BY HOLDING TWO PAGES. navModel collapses a lane left
//     holding one visible page to that page on the rail — but renderStackedNav below 800px
//     draws the heading UNCONDITIONALLY, so a one-page lane restates its own link.
//   * LANES ARE CONTIGUOUS. The lastGroup detector emits a fresh heading every time the
//     value changes, so a lane split in two would quietly draw its heading twice.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Read the PAGES table out of app.js as text — importing it would need a DOM. */
export function parsePages(appSrc) {
  const start = appSrc.indexOf("const PAGES = {");
  if (start === -1) throw new Error("parsePages(): no `const PAGES = {` in app.js");
  const body = appSrc.slice(start, appSrc.indexOf("\n};", start));
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

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 * @param {object}   ctx.LANE_ICONS   from the app's routeIcons.js
 * @param {object}   ctx.ROUTE_ICONS  from the app's routeIcons.js
 * @param {string[]} ctx.expectedRoutes  the route list, in order — moves only on purpose
 * @param {string}   ctx.defaultRoute  the manifest's front door
 */
export function registerNavGroupContract(ctx) {
  const { describe, it, expect, app } = ctx;
  const root = fileURLToPath(ctx.appRoot);
  const APP = readFileSync(resolve(root, "src/client/js/app.js"), "utf8");
  const PAGES = parsePages(APP);
  const LANES = [...new Set(PAGES.map((p) => p.group).filter(Boolean))];

  describe(app + ": the route table", () => {
    it("parses, and holds the routes this register composed", () => {
      // This list moves only when a route is added or removed on purpose.
      expect(PAGES.map((p) => p.route)).toEqual(ctx.expectedRoutes);
    });

    it("gives every route a title", () => {
      for (const p of PAGES) expect(p.title, p.route + " has no title").toBeTruthy();
    });

    it("declares a group for every route, null included", () => {
      for (const p of PAGES) expect(p.group, p.route + " has no group").not.toBe(undefined);
    });
  });

  describe(app + ": lanes", () => {
    it("are contiguous — a split lane would draw its heading twice", () => {
      const seen = new Set();
      let last;
      for (const p of PAGES) {
        if (p.group !== last) {
          expect(seen.has(p.group), "lane " + p.group + " appears in two runs").toBe(false);
          seen.add(p.group);
          last = p.group;
        }
      }
    });

    it("each earn their heading by holding two pages", () => {
      for (const lane of LANES) {
        const held = PAGES.filter((p) => p.group === lane);
        expect(held.length, "lane " + lane + " holds " + held.length + " page(s)")
          .toBeGreaterThanOrEqual(2);
      }
    });

    it("put the chrome tail last, so the rule above it separates chrome from register", () => {
      const firstTail = PAGES.findIndex((p) => p.group === null);
      expect(firstTail).toBeGreaterThan(-1);
      expect(PAGES.slice(firstTail).every((p) => p.group === null)).toBe(true);
    });
  });

  describe(app + ": nav marks", () => {
    it("give every lane exactly one", () => {
      expect(Object.keys(ctx.LANE_ICONS).sort()).toEqual([...LANES].sort());
    });

    it("give every route exactly one", () => {
      expect(Object.keys(ctx.ROUTE_ICONS).sort()).toEqual(PAGES.map((p) => p.route).sort());
    });

    it("draw them all on the same 24 grid, on currentColor", () => {
      const all = [...Object.entries(ctx.LANE_ICONS), ...Object.entries(ctx.ROUTE_ICONS)];
      for (const [name, svg] of all) {
        expect(svg, name + " is not a 24-grid svg").toContain('viewBox="0 0 24 24"');
        expect(svg, name + " does not inherit colour").toContain("currentColor");
        expect(svg, name + " is not hidden from assistive tech").toContain('aria-hidden="true"');
        // A CDN or icon-font reference would be blocked by the GAS sandbox at runtime only.
        expect(svg, name + " reaches outside the bundle").not.toContain("url(");
      }
    });
  });

  describe(app + ": the landing route", () => {
    it("is the manifest's, and is one this table actually defines", () => {
      // THE MANIFEST IS NOW THE SOURCE, not store.js. `DEFAULT_ROUTE` used to be a constant
      // in store.js and this read it from there; store.js is shared and cannot name one
      // app's front door, so app.js hands it over in configureApp() instead. Same claim,
      // one hop further along.
      const m = APP.match(/defaultRoute:\s*"(\w+)"/);
      expect(m, "app.js's manifest declares no defaultRoute").not.toBe(null);
      expect(m[1]).toBe(ctx.defaultRoute);
      expect(PAGES.map((p) => p.route)).toContain(m[1]);
      // A mistyped deep link lands here, so it must not be a page gated off the nav.
      expect(PAGES[0].route, "the front door is not the first page in the table").toBe(m[1]);
    });
  });

  describe(app + ": every route has a page module behind it", () => {
    it("imports one render function per route", () => {
      for (const p of PAGES) {
        expect(APP, p.route + " has no import").toMatch(
          new RegExp('from "\\./pages/' + p.route + '\\.js"'),
        );
      }
    });
  });

  describe(app + ": navModel.js names no lane that PAGES does not compose", () => {
    it("every quoted lane id it compares against is a real PAGES group", () => {
      // Read navModel.js as text, the same way parsePages reads app.js as text rather than
      // importing it — navModel.js is DOM-free and could be imported, but the point is to
      // catch a hardcoded lane id even if it sits in dead code no runtime path reaches.
      const NAV = readFileSync(resolve(root, "src/client/js/navModel.js"), "utf8");
      // A lane/group id is capitalized ("Program", "Registers", "Data" — as opposed to the
      // lowercase `kind` values "lane"/"page" this file also compares with `===`), so filter
      // on that shape rather than name specific properties, which is what let a
      // fork-inherited id like "Landscape" or "Risk" go unnoticed here before.
      const laneLiterals = [...NAV.matchAll(/[=!]==\s*["']([A-Z][A-Za-z]*)["']/g)].map((m) => m[1]);
      const groups = new Set(PAGES.map((p) => p.group).filter(Boolean));
      for (const lit of laneLiterals) {
        expect(groups.has(lit),
          'navModel.js compares against "' + lit + '", which is not a PAGES group').toBe(true);
      }
    });
  });

  describe(app + ": navModel.js mentions no module that does not exist", () => {
    // A parent-app fork left navModel.js citing `prunePanelView.js` (never ported) and a
    // "Risk"/"Assurance" example describing lanes the app never had — stale comments a reader
    // would take as documentation of the current app. Every `whatever.js` this file names in
    // prose is checked against the files that actually ship, in the same places a bare import
    // would resolve it: alongside navModel.js itself, in the app's test/, or in the shared
    // package's ui/ (which is where most of those modules live now).
    it("every *.js name it cites resolves to a real file", () => {
      const here = resolve(root, "src/client/js") + "/";
      const testDir = resolve(root, "test") + "/";
      const sharedDir = fileURLToPath(new URL("../../", import.meta.url));
      const NAV = readFileSync(here + "navModel.js", "utf8");
      const names = [...new Set([...NAV.matchAll(/\b[A-Za-z0-9_.]+\.js\b/g)].map((m) => m[0]))];
      expect(names.length, "no .js name found — the pattern below would vacuously pass")
        .toBeGreaterThan(0);
      for (const name of names) {
        const candidates = name.endsWith(".test.js")
          ? [testDir + name]
          : [here + name, here + "ui/" + name, testDir + name,
             sharedDir + name, sharedDir + "ui/" + name];
        expect(
          candidates.some((c) => existsSync(c)),
          'navModel.js names "' + name + '", which exists at none of: ' + candidates.join(", "),
        ).toBe(true);
      }
    });
  });
}
