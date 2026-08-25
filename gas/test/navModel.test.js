// What the two-tier rail draws, from the PAGES table alone.
//
// Plain .js for the same reason navGroups.test.js is, and importing navModel.js directly is
// the whole point of that module existing: every decision the rail makes is here, DOM-free,
// and the panel's own module is then only timers, listeners and nodes.
//
// The cases that matter are the ones where a rail could quietly LIE — a lane that keeps its
// heading after the collapse rule took it, a chrome page filed under a lane, a panel offered
// for an item with one row in it that repeats the item you clicked.

import { describe, expect, it } from "vitest";

import { hasPanel, itemForRoute, panelBlocks, railItems } from "../src/client/js/navModel.js";

/** A PAGES-shaped fixture: the real map's shape, without importing app.js (it touches DOM). */
const PAGES = {
  executive: { title: "Executive", group: "Overview" },
  mttr: { title: "MTTR & SLA", group: "Security" },
  program: { title: "Program performance", group: "Security" },
  overview: { title: "OS vulnerabilities", group: "Security" },
  data: { title: "Data", group: "Data" },
  scan_history: { title: "Scan History", group: "Data" },
  attribution: { title: "Attribution", group: "Data" },
  settings: { title: "Settings", group: null },
};

describe("railItems", () => {
  it("draws one item per lane, in PAGES order", () => {
    expect(railItems(PAGES).map((i) => i.id))
      .toEqual(["executive", "Security", "Data", "settings"]);
  });

  it("gives a lane every page under it", () => {
    const security = railItems(PAGES).filter((i) => i.id === "Security")[0];
    expect(security.pages.map((p) => p.key)).toEqual(["mttr", "program", "overview"]);
    expect(security.kind).toBe("lane");
  });

  // A rail naming a lane over one page would label the item with a category instead of its
  // name, and its panel would open onto a single row repeating what was just clicked.
  it("draws a lane holding one page AS that page", () => {
    const exec = railItems(PAGES).filter((i) => i.id === "executive")[0];
    expect(exec.kind).toBe("page");
    expect(exec.label).toBe("Executive");
    // The lane is KEPT even so: the rail still marks which lane a route belongs to, and the
    // stacked list below 800px still draws the heading. Only the item's own name comes from
    // the page instead.
    expect(exec.lane).toBe("Overview");
  });

  it("leads a lane to its first page", () => {
    const data = railItems(PAGES).filter((i) => i.id === "Data")[0];
    expect(data.route).toBe("data");
  });

  // `group: null` is the chrome tail, and app.js keys the rule that marks it on `lane`
  // rather than on `kind` — a collapsed lane is also `kind: "page"`, so `kind` alone would
  // put the rule in front of Executive instead of in front of Settings.
  it("marks the chrome tail with a null lane, and nothing else", () => {
    const nulls = railItems(PAGES).filter((i) => i.lane === null);
    expect(nulls.map((i) => i.id)).toEqual(["settings"]);
  });

  it("takes a hidden page out before any of that happens", () => {
    const gated = { ...PAGES, program: { ...PAGES.program, hidden: true } };
    const security = railItems(gated).filter((i) => i.id === "Security")[0];
    expect(security.pages.map((p) => p.key)).toEqual(["mttr", "overview"]);
  });

  // The collapse rule and the hide flag interact: hiding two of Security's three pages leaves
  // a lane of one, which is then drawn as that page and loses its heading with it.
  it("collapses a lane that a hidden page emptied down to one", () => {
    const gated = {
      ...PAGES,
      program: { ...PAGES.program, hidden: true },
      overview: { ...PAGES.overview, hidden: true },
    };
    const item = railItems(gated).filter((i) => i.lane === "Security")[0];
    expect(item.kind).toBe("page");
    expect(item.label).toBe("MTTR & SLA");
  });

  it("draws nothing at all for an empty table", () => {
    expect(railItems({})).toEqual([]);
    expect(railItems(null)).toEqual([]);
  });
});

describe("itemForRoute", () => {
  const items = railItems(PAGES);

  it("finds the lane a page sits in", () => {
    expect(itemForRoute(items, "overview").id).toBe("Security");
    expect(itemForRoute(items, "attribution").id).toBe("Data");
  });

  it("finds a page that is its own item", () => {
    expect(itemForRoute(items, "settings").id).toBe("settings");
  });

  it("returns null for a route the nav does not draw", () => {
    expect(itemForRoute(items, "nope")).toBeNull();
    expect(itemForRoute(null, "overview")).toBeNull();
  });
});

describe("hasPanel", () => {
  const items = railItems(PAGES);
  const byId = (id) => items.filter((i) => i.id === id)[0];

  // A panel whose only row repeats the rail item you opened it from is furniture.
  it("gives a panel to a lane holding more than one page", () => {
    expect(hasPanel(byId("Security"), [])).toBe(true);
    expect(hasPanel(byId("Data"), [])).toBe(true);
  });

  it("gives none to a page that is its own item", () => {
    expect(hasPanel(byId("executive"), [])).toBe(false);
    expect(hasPanel(byId("settings"), [])).toBe(false);
  });

  // The seam: blocks alone would earn a panel, which is what a saved-view store would use.
  it("gives one to any item that has blocks to put in it", () => {
    expect(hasPanel(byId("settings"), [{ id: "x", label: "X", rows: [{}] }])).toBe(true);
  });

  it("gives none to nothing", () => {
    expect(hasPanel(null, [])).toBe(false);
  });
});

// This register has no per-lane instances that deep-link — see the note on panelBlocks for
// which candidates were considered and why each was rejected. The empty answer is pinned so
// that adding one is a deliberate change to this file rather than a silent one.
describe("panelBlocks", () => {
  it("offers none, for any item", () => {
    for (const item of railItems(PAGES)) {
      expect(panelBlocks(item, {})).toEqual([]);
    }
  });
});
