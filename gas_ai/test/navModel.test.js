// The nav model: what the icon rail draws, which items earn a panel, and what a panel lists.
//
// Plain .js on purpose, for the reason helpContent.test.js writes out: tsconfig has no
// allowJs and includes test/**/*.ts, so a .ts test importing a client .js module fails
// `tsc --noEmit` — and `npm run check` is typecheck && test && build, so vitest would
// never run. Vitest picks up **/*.test.{js,ts} either way.
//
// The nav model is DOM-free precisely so this file can exist: every decision the two-tier rail
// makes is there, and the panel's own module is then only timers, listeners and nodes. The
// cases that matter are the ones where a rail could quietly lie — a lane that keeps its
// heading after the gate took its only page, a panel offering a destination a URL cannot
// reach, and an empty block drawn as a heading over nothing, which reads as "you have none"
// where the truth is "we could not ask".
//
// TWO MODULES NOW, AND THE SPLIT IS THE POINT. The rail's arithmetic is
// `gas_shared/shell/navModel.js` — one copy for three registers, which is what it always was
// in triplicate. What this register's panels LIST is `src/client/js/navPanels.js`: a saved
// graph query and a toxic-combination pattern are facts about an asset graph, and neither
// sibling has one. `panelBlocks` is called with that builder as its third argument here,
// exactly as the flyout calls it with `MANIFEST.panelBlocks`.
//
// The file was `navFlyout.test.js` and has never tested navFlyout — it tests the model. Named
// for what it holds now that the model has its own home.

import { describe, expect, it } from "vitest";

import {
  hasPanel, itemForRoute, panelBlocks as sharedPanelBlocks, railItems,
} from "../../gas_shared/shell/navModel.js";
import { panelBlocksFor } from "../src/client/js/navPanels.js";
import { SAVED_VIEW_KEYS, readSavedViews } from "../src/client/js/savedViews.js";

/** This register's blocks, through the shared shape — the same composition the flyout does. */
const panelBlocks = (item, ctx) => sharedPanelBlocks(item, ctx, panelBlocksFor);

/** A PAGES-shaped fixture: the real map's shape, without importing app.js (it touches DOM). */
const PAGES = {
  graph: { hidden: true, title: "Security Graph", group: "Landscape" },
  inventory: { hidden: true, title: "AI Inventory", group: "Landscape" },
  problems: { title: "Priorities", group: "Risk" },
  combos: { hidden: true, title: "Toxic Combinations", group: "Risk" },
  config: { hidden: true, title: "Cloud Configuration", group: "Risk" },
  compliance: { hidden: true, title: "Compliance Posture", group: "Assurance" },
  scans: { title: "Wiz Scans", group: "Assurance" },
  aars: { title: "Scoring Models", group: "Labs", experimental: true },
  data: { hidden: true, title: "Data", group: null },
  settings: { hidden: true, title: "Settings", group: null },
  help: { title: "Help", group: null },
};

/** The same map with nothing hidden — the lane rules are about arrangement, not scoping. */
const FULL = Object.fromEntries(
  Object.entries(PAGES).map(([k, v]) => [k, { ...v, hidden: false }]),
);

const ids = (items) => items.map((i) => i.id);

describe("railItems", () => {
  it("draws one item per lane, and one per chrome page", () => {
    const items = railItems(FULL, { experimental: false });
    expect(ids(items)).toEqual(["Landscape", "Risk", "Assurance", "data", "settings", "help"]);
    expect(items[1].pages.map((p) => p.key)).toEqual(["problems", "combos", "config"]);
    expect(items[3].kind).toBe("page");
  });

  it("leads a lane to its first page, so the panel is never the only way through", () => {
    const items = railItems(FULL, { experimental: false });
    expect(items[0].route).toBe("graph");
    expect(items[1].route).toBe("problems");
  });

  // The gate takes the lane with the page, the way it always has: a lane left standing over
  // nothing would tell every reader that a page they cannot open exists.
  it("drops a lane whose only page is gated away", () => {
    expect(ids(railItems(FULL, { experimental: false }))).not.toContain("aars");
    const on = railItems(FULL, { experimental: true });
    expect(ids(on)).toContain("aars");
    // …and it lands between Assurance and the chrome tail, not in the middle of the workflow.
    expect(ids(on)).toEqual(["Landscape", "Risk", "Assurance", "aars", "data", "settings", "help"]);
  });

  // Labs holds one page, so the rail draws the page. A rail item reading "Labs" over a panel
  // whose only row is "Scoring Models" would be a category standing in for a name.
  it("draws a one-page lane as its page, keeping the lane it belongs to", () => {
    const labs = railItems(FULL, { experimental: true }).filter((i) => i.id === "aars")[0];
    expect(labs.label).toBe("Scoring Models");
    expect(labs.kind).toBe("page");
    expect(labs.lane).toBe("Labs");
    expect(hasPanel(labs, [])).toBe(false);
  });

  // `hidden` is this branch's PoC scoping — off the nav, still routable — and it applies
  // before the lanes are built, so a lane it empties never reaches the rail at all.
  it("takes hidden routes off the rail, and the lanes they empty with them", () => {
    const poc = railItems(PAGES, { experimental: false });
    // Landscape loses both its pages; Risk and Assurance each keep one and become it.
    expect(ids(poc)).toEqual(["problems", "scans", "help"]);
    expect(poc[0].label).toBe("Priorities");
    expect(poc[0].lane).toBe("Risk");
    expect(poc[1].label).toBe("Wiz Scans");
    expect(poc[2].lane).toBeNull();
  });

  it("answers nothing for nothing rather than throwing", () => {
    expect(railItems(null, {})).toEqual([]);
    expect(railItems({}, {})).toEqual([]);
  });
});

describe("itemForRoute", () => {
  const items = railItems(FULL, { experimental: false });

  // The rail marks a lane while you are on ANY of its pages — the whole reason the lane's own
  // link (which points at one of them) cannot carry that mark by itself.
  it("finds the lane for every page in it, not just the one it links to", () => {
    expect(itemForRoute(items, "config").id).toBe("Risk");
    expect(itemForRoute(items, "problems").id).toBe("Risk");
    expect(itemForRoute(items, "scans").id).toBe("Assurance");
    expect(itemForRoute(items, "settings").id).toBe("settings");
  });

  it("answers null for a route the rail is not drawing", () => {
    expect(itemForRoute(items, "aars")).toBeNull();
    expect(itemForRoute(items, "nope")).toBeNull();
    expect(itemForRoute(null, "graph")).toBeNull();
  });
});

describe("hasPanel", () => {
  const items = railItems(FULL, { experimental: true });
  const byId = (id) => items.filter((i) => i.id === id)[0];

  it("gives a panel to a lane holding more than one page", () => {
    expect(hasPanel(byId("Landscape"), [])).toBe(true);
    expect(hasPanel(byId("Risk"), [])).toBe(true);
  });

  // A panel whose only row repeats the rail item you opened it from is furniture — the same
  // rule that stops a labelled lane holding one page.
  it("gives none to a one-page lane, or to a chrome page", () => {
    expect(hasPanel(byId("aars"), [])).toBe(false);
    expect(hasPanel(byId("settings"), [])).toBe(false);
    expect(hasPanel(null, [])).toBe(false);
  });

  it("gives one to a single-page item that has blocks to show", () => {
    expect(hasPanel(byId("aars"), [{ id: "x", label: "X", rows: [{ label: "r" }] }])).toBe(true);
  });
});

describe("panelBlocks", () => {
  const items = railItems(FULL, { experimental: false });
  const byId = (id) => items.filter((i) => i.id === id)[0];

  it("merges saved queries and saved views into one list, each keeping its page", () => {
    const blocks = panelBlocks(byId("Landscape"), {
      savedViews: [
        { name: "Agents reaching data", route: "graph", params: { find: "AI Agent" } },
        { name: "Critical, no guardrail", route: "inventory", params: { severities: "CRITICAL" } },
      ],
    });
    expect(blocks.length).toBe(1);
    expect(blocks[0].label).toBe("Saved");
    expect(blocks[0].rows.map((r) => r.route)).toEqual(["graph", "inventory"]);
    // The icon is the page each row replays into — what tells a query from a view in one list.
    expect(blocks[0].rows.map((r) => r.icon)).toEqual(["graph", "inventory"]);
    expect(blocks[0].rows[0].params).toEqual({ find: "AI Agent" });
  });

  it("lists combination patterns by their short label, deep-linked by id", () => {
    const blocks = panelBlocks(byId("Risk"), {
      combos: [
        { id: "bedrock-no-guardrail", title: "AWS Bedrock: model invocation without guardrails", shortLabel: "No guardrail on invoke" },
      ],
    });
    expect(blocks[0].rows[0].label).toBe("No guardrail on invoke");
    expect(blocks[0].rows[0].route).toBe("combos");
    expect(blocks[0].rows[0].params).toEqual({ open: "bedrock-no-guardrail" });
  });

  it("falls back to the full title where a pattern has no short form", () => {
    const blocks = panelBlocks(byId("Risk"), { combos: [{ id: "x", title: "Only a title" }] });
    expect(blocks[0].rows[0].label).toBe("Only a title");
  });

  // The rule the saved-view readers already follow: refused storage hides the control rather
  // than drawing an empty one, because an empty heading blames the reader for a browser
  // setting. Same here, and for a landscape that genuinely has nothing saved.
  it("omits a block with no rows rather than drawing a heading over nothing", () => {
    expect(panelBlocks(byId("Landscape"), { savedViews: [] })).toEqual([]);
    expect(panelBlocks(byId("Landscape"), {})).toEqual([]);
    expect(panelBlocks(byId("Risk"), { combos: [] })).toEqual([]);
    expect(panelBlocks(byId("Landscape"), null)).toEqual([]);
  });

  it("gives a chrome page no blocks at all", () => {
    expect(panelBlocks(byId("settings"), { savedViews: [{ name: "x", route: "graph" }] })).toEqual([]);
  });

  // Assurance's instances are the collected frameworks, whose names arrive only with
  // api_getCompliance — and the panel never fetches. A block that appeared on the second
  // visit and not the first would be a nav that changes shape depending on where you have
  // been. If that ever becomes cheap to know, this is the test that should change first.
  it("gives Assurance its two pages and no second block", () => {
    expect(panelBlocks(byId("Assurance"), { savedViews: [], combos: [] })).toEqual([]);
    expect(hasPanel(byId("Assurance"), [])).toBe(true);
  });
});

describe("readSavedViews", () => {
  const withStorage = (impl, run) => {
    const had = "localStorage" in globalThis;
    const prev = globalThis.localStorage;
    globalThis.localStorage = impl;
    globalThis.window = { localStorage: impl };
    try { return run(); } finally {
      if (had) globalThis.localStorage = prev; else delete globalThis.localStorage;
      delete globalThis.window;
    }
  };

  it("names both keys under one roof", () => {
    expect(SAVED_VIEW_KEYS.graph).toBe("sidekickai.graphQueries");
    expect(SAVED_VIEW_KEYS.inventory).toBe("sidekickai.inventoryViews");
  });

  it("reads back what a page stored", () => {
    const rows = withStorage(
      { getItem: () => JSON.stringify([{ name: "A", params: { q: "1" } }]) },
      () => readSavedViews(SAVED_VIEW_KEYS.graph),
    );
    expect(rows).toEqual([{ name: "A", params: { q: "1" } }]);
  });

  it("drops an entry with no name — it could be drawn but never picked", () => {
    const rows = withStorage(
      { getItem: () => JSON.stringify([{ name: "A" }, { params: {} }, null]) },
      () => readSavedViews(SAVED_VIEW_KEYS.graph),
    );
    expect(rows).toEqual([{ name: "A" }]);
  });

  it("answers [] for nothing stored, and for a value it did not write", () => {
    expect(withStorage({ getItem: () => null }, () => readSavedViews("k"))).toEqual([]);
    expect(withStorage({ getItem: () => '{"not":"an array"}' }, () => readSavedViews("k"))).toEqual([]);
  });

  // THE DISTINCTION THIS FILE EXISTS FOR. [] is "you have saved nothing"; null is "we could
  // not ask" — a sandboxed GAS iframe denies web storage outright — and every caller hides
  // its control on null rather than showing an empty menu.
  it("answers null when storage is refused, never []", () => {
    const denied = { getItem() { throw new Error("The operation is insecure."); } };
    expect(withStorage(denied, () => readSavedViews("k"))).toBeNull();
  });

  it("answers null rather than throwing when there is no storage at all", () => {
    expect(withStorage(undefined, () => readSavedViews("k"))).toBeNull();
  });
});
