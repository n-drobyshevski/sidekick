// What the two-tier rail draws from THIS app's PAGES table — and this app's table is the one
// shape the shared `gas_shared/shell/navModel.js` has never been exercised against: ZERO
// LANES. `gas/`, `gas_ai/` and `gas_devsecops/` each hand it two to four labelled lanes over a
// chrome tail; here both routes are `group: null`, so every item is a bare page, `LANE_ICONS`
// is `{}`, and no rail item ever has a panel to open.
//
// THAT SHAPE IS WHY THE APP NEEDED A CSS RULE OF ITS OWN. `navRail.js` draws a leading
// `.nav-rule` in front of what it expects to be the chrome tail — both draw sites (:127 the
// icon rail, :155 the stacked list below 800px) test `lane === null` / `group === null` alone,
// with no check for "and something labelled came before it". With no labelled lane at all
// that test is true of the FIRST item, so the rail opens with a hairline separating nothing
// from nothing. `styles/pages.css` hides it; this file is where the arithmetic underneath is
// pinned, and the two assertions about `lane: null` below are what would change if the shared
// model ever stopped answering that way.
//
// The fixture RESTATES src/client/js/app.js's real PAGES table (titles and groups only —
// navModel never reads `render`) rather than importing it: importing app.js runs
// `configureApp` and `createAppShell` and touches the DOM at module load. `test/shared.test.js`'s
// navGroups contract is what holds this restatement honest — it parses the real app.js and
// asserts the route list and the null groups directly.

import { describe, expect, it } from "vitest";

import {
  hasPanel, itemForRoute, panelBlocks, railItems,
} from "../../gas_shared/shell/navModel.js";

/** src/client/js/app.js's real PAGES table, restated. Two front-door pages, no lane. */
const PAGES = {
  hub: { title: "Registers", group: null },
  settings: { title: "Settings", group: null },
};

/** This app hands the shell no navContext at all; `{}` is what a caller with nothing to say
 *  passes, and the no-builder path below is the only one it ever takes. */
const CTX = {};

describe("railItems over a table with no lanes", () => {
  it("draws one item per page, in PAGES order", () => {
    expect(railItems(PAGES).map((i) => i.id)).toEqual(["hub", "settings"]);
  });

  it("makes every one of them a PAGE, never a lane", () => {
    for (const item of railItems(PAGES)) {
      expect(item.kind, item.id + " is not a page item").toBe("page");
    }
  });

  it("gives every item a null lane — there is no labelled lane in this app", () => {
    // This is the fact `styles/pages.css`'s `.sidebar > .nav-rule:first-child` rule exists
    // for: navRail.js reads exactly this to decide a chrome rule belongs above an item, and
    // here it is true of the first one.
    const items = railItems(PAGES);
    expect(items.map((i) => i.lane)).toEqual([null, null]);
  });

  it("labels each item with its own PAGES title", () => {
    const items = railItems(PAGES);
    expect(items.map((i) => i.label)).toEqual(["Registers", "Settings"]);
    expect(items.map((i) => i.route)).toEqual(["hub", "settings"]);
  });

  it("draws nothing at all for an empty table", () => {
    expect(railItems({})).toEqual([]);
    expect(railItems(null)).toEqual([]);
  });
});

// The two flags the shared model supports and this app's production table never sets. Neither
// is exercised by any route here, so this is the only place in the package that proves the
// gate actually takes a page off the rail — the same mechanism the three registers pin from
// their own tables, proven against a zero-lane one.
describe("the gates, on a table that uses neither", () => {
  it("takes a hidden page off the rail entirely", () => {
    const gated = { ...PAGES, settings: { ...PAGES.settings, hidden: true } };
    expect(railItems(gated).map((i) => i.id)).toEqual(["hub"]);
  });

  it("gates an experimental page behind opts.experimental, off by default", () => {
    const withLab = { ...PAGES, settings: { ...PAGES.settings, experimental: true } };
    expect(railItems(withLab, { experimental: false }).map((i) => i.id)).toEqual(["hub"]);
    expect(railItems(withLab, { experimental: true }).map((i) => i.id))
      .toEqual(["hub", "settings"]);
    // Plain railItems(pages), no opts — this app's own call shape, since app.js passes no
    // experimental flag and has no experimental.js — must degrade to the same as `false`.
    expect(railItems(withLab).map((i) => i.id)).toEqual(["hub"]);
  });
});

describe("itemForRoute", () => {
  const items = railItems(PAGES);

  it("finds each page as its own item, since neither sits inside a lane", () => {
    expect(itemForRoute(items, "hub").id).toBe("hub");
    expect(itemForRoute(items, "settings").id).toBe("settings");
  });

  it("returns null for a route the nav does not draw", () => {
    // A mistyped deep link lands here; the shell then falls back to MANIFEST.defaultRoute.
    expect(itemForRoute(items, "nope")).toBeNull();
    expect(itemForRoute(null, "hub")).toBeNull();
  });
});

describe("hasPanel", () => {
  const items = railItems(PAGES);

  it("gives NO item a panel — there is no lane holding a second page", () => {
    // Which is what makes the rail here a plain two-link list: nothing opens on hover or
    // ArrowRight, and there is no flyout state for a route change to leave behind.
    for (const item of items) {
      expect(hasPanel(item, []), item.id + " opened a panel").toBe(false);
    }
  });

  it("still gives one to an item handed blocks, so the rule is the blocks and not the shape",
    () => {
      // The other direction, so the assertion above is not passing merely because this app
      // never supplies blocks: hand one over and the shared rule does open a panel.
      expect(hasPanel(items[0], [{ id: "x", label: "X", rows: [{}] }])).toBe(true);
    });

  it("gives none to nothing", () => {
    expect(hasPanel(null, [])).toBe(false);
  });
});

describe("panelBlocks", () => {
  it("offers none for any item — this app's real call shape has no builder", () => {
    // MANIFEST carries no `panelBlocks`: there is no collection under either page for a panel
    // to list. Both the two- and three-argument forms are checked, because the shell calls
    // whichever the manifest leaves it with.
    for (const item of railItems(PAGES)) {
      expect(panelBlocks(item, CTX)).toEqual([]);
      expect(panelBlocks(item, CTX, undefined)).toEqual([]);
    }
  });

  it("still refuses a non-lane once a builder IS supplied", () => {
    // Every item in this app is a page rather than a lane, so a builder added later would
    // never be asked in the first place. Pinned rather than assumed: the failure would be a
    // panel appearing over a front door that has nothing to put in one.
    const full = () => [{ id: "x", label: "X", rows: [{ label: "r", route: "hub" }] }];
    for (const item of railItems(PAGES)) {
      expect(panelBlocks(item, CTX, full)).toEqual([]);
    }
  });
});
