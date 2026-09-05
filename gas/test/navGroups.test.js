// What the shared nav contract does NOT say, and this register still needs said.
//
// MOST OF THIS FILE MOVED, IT DID NOT DISAPPEAR. `gas_shared/test/contracts/navGroups.js`
// now holds every rule that is true of any sidekick — a lane is contiguous, a labelled lane
// earns its heading by holding two pages, the chrome tail is last, every lane and every route
// has exactly one mark, every mark is a 24-grid currentColor SVG that reaches nothing outside
// the bundle, the landing route is the manifest's and is the table's first entry, and every
// route has a `pages/<route>.js` behind it. `test/shared.test.js` registers it with this
// app's LANE_ICONS / ROUTE_ICONS and its route list. Two of those rules were NOT true here
// when the contract was first registered, and both were real:
//
//   * `Overview` was a lane holding one page (Executive). The old version of this file knew
//     about the rail's collapse and therefore asked only MULTI-PAGE lanes for a mark, which
//     is why nothing here ever caught it — but `renderStackedNav` below 800px draws every
//     lane heading unconditionally, and there it really did print the word "Overview"
//     directly above a single link reading "Executive". Executive is in the Security lane now.
//   * `scan_history` was the one route whose key did not name its own module (pages/history.js).
//     It is `history` now, with a ROUTE_ALIAS keeping the old links alive.
//
// The one rule left here is the one the shared contract cannot state, because it is about
// this register's OWN drawing rather than about the shape of any nav.
//
// Plain .js on purpose, for the reason attributionPrefill.test.js writes out: tsconfig has no
// allowJs and includes test/**/*.ts, so a .ts test importing a client .js module fails
// `tsc --noEmit` — and `npm run check` is typecheck && test && build, so vitest would never
// run. Vitest picks up **/*.test.{js,ts} either way.

import { describe, expect, it } from "vitest";

import { LANE_ICONS, ROUTE_ICONS } from "../src/client/js/routeIcons.js";

// The rail puts a lane's mark beside the page marks its own panel lists, so a lane that
// borrowed one of them would draw the same picture twice in one nav and mean two things. The
// shared contract checks that every lane and every route HAS a mark and that each mark is
// well formed; it deliberately says nothing about two of them being the same picture, because
// that is a question about one app's drawing rather than about any app's nav.
describe("the nav marks this register drew", () => {
  it("draws each lane differently from every other lane, and from every page", () => {
    const seen = new Map();
    for (const [name, svg] of [...Object.entries(LANE_ICONS), ...Object.entries(ROUTE_ICONS)]) {
      expect(seen.has(svg), name + " draws the same mark as " + seen.get(svg)).toBe(false);
      seen.set(svg, name);
    }
  });
});
