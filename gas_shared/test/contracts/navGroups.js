// The information architecture has ONE source, and this is what keeps it that way.
//
// PAGES in pages.js is the only list of routes; navModel derives the rail from it and
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

import * as SHARED_MARKS from "../../shell/navIcons.js";

/**
 * The PAGES table as an ordered list, which is the shape every rule below reads.
 *
 * THIS USED TO BE A REGEX OVER app.js. The table sat inline in app.js, which touches the DOM
 * at module scope, so a node test could not import it and this read it back out of the file
 * as text instead. A line-shaped pattern can only see line-shaped source: an entry wrapped
 * across three lines parsed as a route with no title and no lane, and gas_ai's `aars` entry
 * still carries the "ONE LINE, and it has to stay one line" warning that cost.
 *
 * The table lives in its own `pages.js` now and every app's `test/shared.test.js` imports it
 * and hands it over as `ctx.PAGES`, so what these rules read is the real object — `render`
 * included, which is why the page-module rule below can check a function rather than an
 * import line.
 */
export function pageList(pages) {
  return Object.entries(pages || {}).map(([route, page]) => ({
    route,
    // Left `undefined` when the entry declares no group at all, because that is the thing
    // the "declares a group for every route, null included" rule below is looking for: null
    // is a real answer (the chrome tail) and absence is a mistake.
    group: page.group,
    title: page.title,
    experimental: page.experimental === true,
    fullBleed: page.fullBleed === true,
    hidden: page.hidden === true,
    render: page.render,
  }));
}

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 * @param {object}   ctx.PAGES        the route table, imported from the app's pages.js
 * @param {object}   ctx.LANE_ICONS   from the app's routeIcons.js
 * @param {object}   ctx.ROUTE_ICONS  from the app's routeIcons.js
 * @param {string[]} ctx.expectedRoutes  the route list, in order — moves only on purpose
 * @param {string}   ctx.defaultRoute  the manifest's front door
 * @param {string[]} [ctx.singletonLanes]  lane labels allowed to hold exactly one page
 *                                 without earning the usual "two pages or no heading" floor.
 *                                 Default `[]`. A lane in this list still has to hold AT
 *                                 LEAST one page — it only lowers the floor from two to one,
 *                                 so a lane with two pages that happens to be listed here
 *                                 still passes (it is no longer a singleton, it just was
 *                                 never required not to be one).
 * @param {string}   [ctx.panelBlocksModule]  app-relative path to this register's nav-panel
 *                                 block builder, if it has one (gas_ai's
 *                                 `src/client/js/navPanels.js`). It is the only app-side file
 *                                 allowed to name a lane, so it is scanned alongside the
 *                                 shared nav model. Omit for an app with no builder.
 * @param {boolean}  [ctx.frontDoorIsFirst]  Default `true`: the manifest's defaultRoute must
 *                                 be `PAGES[0]`. When `false`, that position coupling is not
 *                                 asserted; instead the defaultRoute must exist in PAGES (as
 *                                 always) and must be REACHABLE — not gated behind
 *                                 `experimental` — since a mistyped deep link falls back to it.
 */
export function registerNavGroupContract(ctx) {
  const { describe, it, expect, app } = ctx;
  const root = fileURLToPath(ctx.appRoot);
  // app.js is still read as TEXT, and only for the manifest: the claim is that
  // MANIFEST.defaultRoute names the front door, which is about what app.js DECLARES rather
  // than about what the table holds.
  const APP = readFileSync(resolve(root, "src/client/js/app.js"), "utf8");
  const PAGES_SRC = readFileSync(resolve(root, "src/client/js/pages.js"), "utf8");
  const PAGES = pageList(ctx.PAGES);
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
      // ctx.singletonLanes lowers the floor from two to one for a NAMED lane — it does not
      // raise a ceiling, so a listed lane that grows a second page still passes: it is no
      // longer a singleton, it was only ever allowed to be one.
      const singletonLanes = ctx.singletonLanes || [];
      for (const lane of LANES) {
        const held = PAGES.filter((p) => p.group === lane);
        const floor = singletonLanes.includes(lane) ? 1 : 2;
        expect(held.length, "lane " + lane + " holds " + held.length + " page(s)")
          .toBeGreaterThanOrEqual(floor);
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

    // A SHARED MARK IS NAMED, NEVER RE-PASTED.
    //
    // The rule above compares VALUES, so it cannot tell a shared mark that was imported from
    // one that was copied back in as a literal — both are the same bytes at runtime. This
    // reads routeIcons.js as SOURCE and refuses any inline `<svg …>` that is byte-identical
    // to something shell/navIcons.js already exports. That is the realistic way the four
    // private icon sets would grow back: not by anyone deciding to fork one, but by someone
    // pasting a drawing "since it is only a string" and nothing noticing for two years —
    // which is exactly how gas_devsecops's history mark and gas_ai's scans mark came to be
    // the same picture.
    it("re-pastes no mark that gas_shared/shell/navIcons.js already draws", () => {
      const src = readFileSync(resolve(root, "src/client/js/routeIcons.js"), "utf8");
      const inline = [...src.matchAll(/'(<svg [^']*<\/svg>)'/g)].map((m) => m[1]);
      for (const [name, svg] of Object.entries(SHARED_MARKS)) {
        expect(
          inline.includes(svg),
          'routeIcons.js pastes the "' + name + '" mark navIcons.js already exports — '
            + "import it instead",
        ).toBe(false);
      }
    });

    // PROMOTED FROM gas/test/navGroups.test.js, WHERE IT COULD ONLY SEE ONE APP.
    //
    // The rail puts a lane's mark beside the page marks its own panel lists, so a lane that
    // borrowed one of them would draw the same picture twice in one nav and mean two things.
    // That was true of any sidekick and was held in one app's own test file, which is why
    // two cross-app duplicates lived for as long as they did: gas_devsecops's history mark
    // was byte-identical to gas_ai's scans mark, and its Data lane mark was all but gas_ai's
    // aars mark. Neither is visible from inside one app — but both become in-app collisions
    // the moment a mark is shared, which is exactly when this needs to bite.
    it("draw each lane differently from every other lane, and from every page", () => {
      const seen = new Map();
      for (const [name, svg] of [...Object.entries(ctx.LANE_ICONS),
        ...Object.entries(ctx.ROUTE_ICONS)]) {
        expect(seen.has(svg), name + " draws the same mark as " + seen.get(svg)).toBe(false);
        seen.set(svg, name);
      }
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
      const frontDoorIsFirst = ctx.frontDoorIsFirst !== false;
      if (frontDoorIsFirst) {
        // A mistyped deep link lands here, so it must not be a page gated off the nav.
        expect(PAGES[0].route, "the front door is not the first page in the table").toBe(m[1]);
      } else {
        // The position coupling is deliberately not held here (e.g. gas_ai's front door is
        // `problems`, not PAGES[0] `graph`) — instead the door has to be one a mistyped deep
        // link can actually land on, i.e. not gated behind `experimental`.
        const page = PAGES.find((p) => p.route === m[1]);
        expect(page, "defaultRoute names no page in PAGES").toBeTruthy();
        expect(
          page.experimental,
          "the front door (" + m[1] + ") is gated behind experimental and is not reachable",
        ).not.toBe(true);
      }
    });
  });

  describe(app + ": every route has a page module behind it", () => {
    // TWO HALVES, AND THE SECOND IS NOT REDUNDANT. The function is what the router actually
    // calls, so checking it is the stronger claim — an import line proves nothing about what
    // the entry points at. But the import line is what pins the MODULE NAME to the route key,
    // which is the coupling that renamed `scan_history` to `history`, so the text scan stays.
    it("gives every route a render function", () => {
      for (const p of PAGES) {
        expect(typeof p.render, p.route + " has no render function").toBe("function");
      }
    });

    it("imports each one from pages/<route>.js, so the key names its own module", () => {
      for (const p of PAGES) {
        expect(PAGES_SRC, p.route + " has no import").toMatch(
          new RegExp('from "\\./pages/' + p.route + '\\.js"'),
        );
      }
    });
  });

  // WHERE A LANE ID CAN LEGITIMATELY LIVE, now that navModel.js is shared.
  //
  // The rail's arithmetic moved to `gas_shared/shell/navModel.js`, which takes PAGES as an
  // argument and knows no lane names at all — so scanning it for a hardcoded id is a guard
  // that bites on the PACKAGE rather than on one app: the moment anyone writes
  // `item.id === "Landscape"` into shared, the two registers that have no Landscape lane fail
  // here. The only app-side file that may name a lane is a nav-panel block builder, named by
  // `ctx.panelBlocksModule` — today gas_ai's navPanels.js, the only one that exists. Both are
  // read as TEXT rather than imported, so an id is caught even where it sits in dead code no
  // runtime path reaches.
  const laneSources = [
    ["gas_shared/shell/navModel.js",
      fileURLToPath(new URL("../../shell/navModel.js", import.meta.url))],
    ...(ctx.panelBlocksModule
      ? [[ctx.panelBlocksModule, resolve(root, ctx.panelBlocksModule)]]
      : []),
  ];

  describe(app + ": the nav model names no lane that PAGES does not compose", () => {
    it("every quoted lane id it compares against is a real PAGES group", () => {
      const groups = new Set(PAGES.map((p) => p.group).filter(Boolean));
      for (const [label, path] of laneSources) {
        const NAV = readFileSync(path, "utf8");
        // A lane/group id is capitalized ("Program", "Registers", "Data" — as opposed to the
        // lowercase `kind` values "lane"/"page" these files also compare with `===`), so
        // filter on that shape rather than name specific properties, which is what let a
        // fork-inherited id like "Landscape" or "Risk" go unnoticed here before.
        const lits = [...NAV.matchAll(/[=!]==\s*["']([A-Z][A-Za-z]*)["']/g)].map((m) => m[1]);
        for (const lit of lits) {
          expect(groups.has(lit),
            label + ' compares against "' + lit + '", which is not a PAGES group').toBe(true);
        }
      }
    });
  });

  describe(app + ": the nav model mentions no module that does not exist", () => {
    // A parent-app fork left navModel.js citing `prunePanelView.js` (never ported) and a
    // "Risk"/"Assurance" example describing lanes the app never had — stale comments a reader
    // would take as documentation of the current app. Every `whatever.js` these files name in
    // prose is checked against the files that actually ship, in the places a bare import
    // would resolve one: beside the app's own client modules, in its test/, or in the shared
    // package's root, ui/ or shell/ (which is where most of them live now).
    it("every *.js name it cites resolves to a real file", () => {
      const here = resolve(root, "src/client/js") + "/";
      const testDir = resolve(root, "test") + "/";
      const sharedDir = fileURLToPath(new URL("../../", import.meta.url));
      for (const [label, path] of laneSources) {
        const NAV = readFileSync(path, "utf8");
        const names = [...new Set([...NAV.matchAll(/\b[A-Za-z0-9_.]+\.js\b/g)].map((m) => m[0]))];
        expect(names.length, label + " names no .js file — the check would be vacuous")
          .toBeGreaterThan(0);
        for (const name of names) {
          const candidates = name.endsWith(".test.js")
            ? [testDir + name]
            : [here + name, here + "ui/" + name, testDir + name,
               sharedDir + name, sharedDir + "ui/" + name, sharedDir + "shell/" + name,
               // The shared nav model cites the contract that pins its lane rules by name, and
               // a spec factory is not a `.test.js` — it lives here. Missing from the search
               // path, an accurate citation read as a dangling one.
               sharedDir + "test/contracts/" + name];
          expect(
            candidates.some((c) => existsSync(c)),
            label + ' names "' + name + '", which exists at none of: ' + candidates.join(", "),
          ).toBe(true);
        }
      }
    });
  });
}
