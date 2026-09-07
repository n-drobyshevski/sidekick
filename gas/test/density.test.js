// This register's end of `dev/density.mjs --root .` (gas_devsecops's Playwright density
// walker, pointed at gas via --root — see that file's own header on why `--root` is what lets
// one script walk all four apps). The walker and its DOM-free half (`densityModel.mjs`) stay
// in gas_devsecops, per this package's own scope: gas does not get a copy of either, only this
// one test that pins the one thing specific to THIS app's PAGES table.
//
// WHAT THIS FILE DOES NOT DO: re-test `parsePages()`'s own parsing rules (the comment-skipping,
// the closing-brace bound, the render-key extraction) — `gas_devsecops/test/density.test.js`
// already pins those against hand-built fixtures. This file's only job is the one thing a
// shared fixture cannot stand in for: that `parsePages()` reads gas's REAL app.js and comes
// back with gas's real nine routes, in rail order — the exact claim `npm run density` depends
// on to walk the right pages.
//
// Plain .js on purpose, matching navGroups.test.js/navModel.test.js in this same directory:
// tsconfig has no allowJs and includes test/**/*.ts, so a .ts test importing a client .js
// module fails `tsc --noEmit`, and `npm run check` is typecheck && test && build — vitest
// would never run. Vitest picks up **/*.test.{js,ts} either way.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parsePages } from "../../gas_devsecops/dev/densityModel.mjs";

const APP_JS = readFileSync(new URL("../src/client/js/app.js", import.meta.url), "utf8");

describe("parsePages() against gas's own app.js — the route list `npm run density` walks", () => {
  it("yields exactly gas's nine routes, in PAGES' own (= rail) order", () => {
    // Lifted from app.js's PAGES literal by hand, once, as the thing to check against — NOT
    // re-derived from the same regex parsePages() runs, which would just check the function
    // against itself. In rail order: the Security lane (executive, mttr, program, overview),
    // the Data lane (data, history, attribution, help), then the chrome tail (settings).
    const expectedRoutes = [
      "executive", "mttr", "program", "overview", "data", "history", "attribution", "help",
      "settings",
    ];
    const routes = parsePages(APP_JS).map((p) => p.route);
    expect(routes).toEqual(expectedRoutes);
  });

  it("also names each route's own render function, so a route that pointed at the wrong "
    + "page module would show up here", () => {
    const byRoute = Object.fromEntries(
      parsePages(APP_JS).map((p) => [p.route, p.render]),
    );
    expect(byRoute).toEqual({
      executive: "renderExecutive",
      mttr: "renderMttr",
      program: "renderProgram",
      overview: "renderOverview",
      data: "renderData",
      history: "renderHistory",
      attribution: "renderAttribution",
      help: "renderHelp",
      settings: "renderSettings",
    });
  });

  // PERTURBATION, per this wave's own rule ("a guard that fires on nothing is a finding, not a
  // pass"). density.mjs's own runMeasure() refuses to report an empty walk as a measurement:
  //
  //   const allRoutes = parsePages(appSrc).map((p) => p.route);
  //   if (!allRoutes.length) { console.error(...); process.exit(1); }
  //
  // That refusal is only worth anything if an empty PAGES literal actually PRODUCES an empty
  // route list rather than throwing, or silently defaulting somewhere upstream — a walker that
  // "measured" a page with no routes at all and printed a clean, empty, entirely believable
  // table would be exactly the false zero CLAUDE.md keeps naming. `parsePages("const PAGES =
  // {};")` is the shape the parser refuses (no per-route `key: {` line to match), reproduced
  // here rather than a hand-wave; the guard itself is copied verbatim from runMeasure() above,
  // as a throw in place of its `process.exit(1)`, so the assertion is "the guard fires", not a
  // restatement of `routes.length === 0`.
  it("PERTURBATION: an empty PAGES literal yields zero routes, and the zero-routes guard "
    + "density.mjs runs before reporting anything actually FIRES on it", () => {
    const routes = parsePages("const PAGES = {};").map((p) => p.route);
    expect(routes).toEqual([]);
    function refuseIfEmpty(allRoutes) {
      if (!allRoutes.length) {
        throw new Error(
          "parsePages() found no routes in app.js's PAGES table — refusing to report an "
          + "empty walk as a measurement.",
        );
      }
    }
    expect(() => refuseIfEmpty(routes)).toThrow(/refusing to report an empty walk/);
    // And the same guard does NOT fire on the real table, so it is not vacuous either way.
    expect(() => refuseIfEmpty(parsePages(APP_JS).map((p) => p.route))).not.toThrow();
  });
});
