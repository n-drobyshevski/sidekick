// What the two-tier rail draws, from THIS register's own PAGES table — `gas/test/navModel.test.js`
// and `gas_ai/test/navModel.test.js` already exercise `gas_shared/shell/navModel.js` against
// their own lane shapes; this register had neither, and nothing in the shared package's own
// tests reads a devsecops-shaped table.
//
// NOT gas_ai's fixture, restated. The point of a third test is a third lane shape: three
// programme-level pages (Program), three registers (Registers), four data pages (Data), and
// a one-page chrome tail (settings) — a 3/3/4/1 split neither sibling has. The fixture below
// restates src/client/js/app.js's real PAGES table (titles and groups only; navModel never
// reads `render`), not a copy of it, because importing app.js touches DOM at module load —
// see PAGES's own header there for why the lane composition is what it is.
//
// TWO FLAGS THIS REGISTER SUPPORTS BUT HAS NEVER USED: `hidden` and `experimental` (app.js's
// own PAGES comment says so). Its production table exercises neither, so this file is the
// only place in this register that proves the gates actually take a page off the rail and
// collapse the lane they empty — the same mechanism gas/ and gas_ai/ pin from their own
// tables, now proven against this one instead of taken on faith.
//
// AND panelBlocks WITH NO BUILDER, because that is this register's real shape: MANIFEST has
// no `panelBlocks` (app.js's own comment: "none of this app's three lanes has instances of
// its own beyond the pages it already groups"), and navContext() is a `{ savedViews: [] }`
// stub with nothing behind it yet. The two-argument no-builder path is what every rail item
// in production actually gets; the three-argument path is exercised too, once, so the shared
// module's own rules (lane-only, drop-empty-blocks) are pinned here rather than only in the
// siblings that happen to use them.

import { describe, expect, it } from "vitest";

import {
  hasPanel, itemForRoute, panelBlocks, railItems,
} from "../../gas_shared/shell/navModel.js";

/** src/client/js/app.js's real PAGES table, restated (title/group only — see this file's own
 *  header for why app.js itself is not imported). Program (3), Registers (3), Data (4),
 *  settings (chrome tail, group: null). */
const PAGES = {
  executive: { title: "Executive", group: "Program" },
  mttr: { title: "MTTR & SLA", group: "Program" },
  program: { title: "Coverage & efficiency", group: "Program" },
  sca: { title: "Dependencies", group: "Registers" },
  sast: { title: "Code", group: "Registers" },
  secrets: { title: "Secrets", group: "Registers" },
  repos: { title: "Repositories", group: "Data" },
  history: { title: "Scan history", group: "Data" },
  data: { title: "Storage", group: "Data" },
  help: { title: "Key sheet", group: "Data" },
  settings: { title: "Settings", group: null },
};

/** devsecops's own navContext() shape — the only thing panelBlocks' `ctx` ever carries here. */
const CTX = { savedViews: [] };

describe("railItems", () => {
  it("draws one item per lane, in PAGES order", () => {
    expect(railItems(PAGES).map((i) => i.id))
      .toEqual(["Program", "Registers", "Data", "settings"]);
  });

  it("gives each lane every page under it, in this register's real 3/3/4 split", () => {
    const items = railItems(PAGES);
    const byId = (id) => items.filter((i) => i.id === id)[0];
    expect(byId("Program").pages.map((p) => p.key)).toEqual(["executive", "mttr", "program"]);
    expect(byId("Registers").pages.map((p) => p.key)).toEqual(["sca", "sast", "secrets"]);
    expect(byId("Data").pages.map((p) => p.key)).toEqual(["repos", "history", "data", "help"]);
    expect(byId("Program").kind).toBe("lane");
    expect(byId("Registers").kind).toBe("lane");
    expect(byId("Data").kind).toBe("lane");
  });

  it("leads every lane to its first page", () => {
    const items = railItems(PAGES);
    const byId = (id) => items.filter((i) => i.id === id)[0];
    expect(byId("Program").route).toBe("executive");
    expect(byId("Registers").route).toBe("sca");
    expect(byId("Data").route).toBe("repos");
  });

  it("marks the chrome tail with a null lane, and nothing else", () => {
    const nulls = railItems(PAGES).filter((i) => i.lane === null);
    expect(nulls.map((i) => i.id)).toEqual(["settings"]);
  });

  // `hidden` and `experimental` are declared as supported in app.js's own PAGES comment but
  // exercised by no production page — this is the one place in the register that proves the
  // gate itself, rather than trusting an unused flag to still work.
  it("takes a hidden page out before the lanes are built", () => {
    const gated = { ...PAGES, sast: { ...PAGES.sast, hidden: true } };
    const registers = railItems(gated).filter((i) => i.id === "Registers")[0];
    expect(registers.pages.map((p) => p.key)).toEqual(["sca", "secrets"]);
  });

  it("gates an experimental page behind opts.experimental, off by default", () => {
    const withLab = { ...PAGES, sast: { ...PAGES.sast, experimental: true } };
    const off = railItems(withLab, { experimental: false });
    const on = railItems(withLab, { experimental: true });
    expect(off.filter((i) => i.id === "Registers")[0].pages.map((p) => p.key))
      .toEqual(["sca", "secrets"]);
    expect(on.filter((i) => i.id === "Registers")[0].pages.map((p) => p.key))
      .toEqual(["sca", "sast", "secrets"]);
    // Plain railItems(pages), no opts — this register's own call shape (app.js never passes
    // an experimental flag today) — must degrade to the same as opts.experimental: false.
    expect(railItems(withLab).filter((i) => i.id === "Registers")[0].pages.map((p) => p.key))
      .toEqual(["sca", "secrets"]);
  });

  // The collapse rule and the hide flag interact: hiding two of a three-page lane's pages
  // leaves one, which is then drawn as that page and loses its heading with it.
  it("collapses a lane that hidden pages emptied down to one", () => {
    const gated = {
      ...PAGES,
      mttr: { ...PAGES.mttr, hidden: true },
      program: { ...PAGES.program, hidden: true },
    };
    const item = railItems(gated).filter((i) => i.lane === "Program")[0];
    expect(item.kind).toBe("page");
    expect(item.id).toBe("executive");
    expect(item.label).toBe("Executive");
    // The lane mark survives the collapse — only the item's own name and id come from the page.
    expect(item.lane).toBe("Program");
  });

  it("draws nothing at all for an empty table", () => {
    expect(railItems({})).toEqual([]);
    expect(railItems(null)).toEqual([]);
  });
});

describe("itemForRoute", () => {
  const items = railItems(PAGES);

  it("finds the lane a page sits in, for every page under it — not just the one it links to", () => {
    expect(itemForRoute(items, "mttr").id).toBe("Program");
    expect(itemForRoute(items, "secrets").id).toBe("Registers");
    expect(itemForRoute(items, "help").id).toBe("Data");
  });

  it("finds the chrome tail as its own item", () => {
    expect(itemForRoute(items, "settings").id).toBe("settings");
  });

  it("returns null for a route the nav does not draw", () => {
    expect(itemForRoute(items, "nope")).toBeNull();
    expect(itemForRoute(null, "sca")).toBeNull();
  });
});

describe("hasPanel", () => {
  const items = railItems(PAGES);
  const byId = (id) => items.filter((i) => i.id === id)[0];

  it("gives a panel to every lane holding more than one page", () => {
    expect(hasPanel(byId("Program"), [])).toBe(true);
    expect(hasPanel(byId("Registers"), [])).toBe(true);
    expect(hasPanel(byId("Data"), [])).toBe(true);
  });

  it("gives none to the chrome tail", () => {
    expect(hasPanel(byId("settings"), [])).toBe(false);
  });

  // A panel whose only row repeats the rail item you opened it from is furniture — proven
  // against a lane THIS register's own gate collapses, not a hardcoded one-page fixture.
  it("gives none to a lane the hide flag has collapsed to one page", () => {
    const gated = {
      ...PAGES,
      mttr: { ...PAGES.mttr, hidden: true },
      program: { ...PAGES.program, hidden: true },
    };
    const collapsed = railItems(gated).filter((i) => i.lane === "Program")[0];
    expect(hasPanel(collapsed, [])).toBe(false);
  });

  it("gives one to any item that has blocks to put in it", () => {
    expect(hasPanel(byId("settings"), [{ id: "x", label: "X", rows: [{}] }])).toBe(true);
  });

  it("gives none to nothing", () => {
    expect(hasPanel(null, [])).toBe(false);
  });
});

// devsecops's real shape: MANIFEST carries no `panelBlocks` builder (app.js's own comment —
// none of the three lanes has instances beyond the pages it already groups), so every call
// this register actually makes is the two-argument, no-builder form. The three-argument form
// below is not this register's own behaviour — it pins that the SHARED rules (lane-only, drop
// empty blocks) still hold once a builder exists, the way gas_ai's already-supplied builder
// proves them from the other side.
describe("panelBlocks", () => {
  it("offers none for any item, matching this register's real call shape (no builder)", () => {
    for (const item of railItems(PAGES)) {
      expect(panelBlocks(item, CTX)).toEqual([]);
      expect(panelBlocks(item, CTX, undefined)).toEqual([]);
    }
  });

  it("still refuses a non-lane, and still drops an empty block, once one is supplied", () => {
    const items = railItems(PAGES);
    const lane = items.filter((i) => i.id === "Registers")[0];
    const tail = items.filter((i) => i.id === "settings")[0];
    const full = () => [{ id: "x", label: "X", rows: [{ label: "r", route: "sast" }] }];
    const empty = () => [{ id: "x", label: "X", rows: [] }];
    expect(panelBlocks(lane, CTX, full)).toHaveLength(1);
    // A chrome page has no collection under it, so the builder is never even asked.
    expect(panelBlocks(tail, CTX, full)).toEqual([]);
    // An empty heading would say "you have none" where the truth is "we could not ask".
    expect(panelBlocks(lane, CTX, empty)).toEqual([]);
  });
});
