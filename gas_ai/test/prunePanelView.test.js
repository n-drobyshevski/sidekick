// What the prune panel CLAIMS, from the bootstrap payload and one preview.
//
// DOM-free half of the control, tested the way projectScopeView is: the assembly is a handful
// of `el()` calls, but which project is offered as the default, whether the Remove button
// appears at all, and how the census reads are decisions — and this one arms an irreversible
// deletion, so a decision that can be wrong gets a test.

import { describe, expect, it } from "vitest";
import { prunePanelView } from "../src/client/js/ui/prunePanel.js";

const LIST = [
  { id: "p-unit", name: "DEMO-BUSINESS-UNIT", isFolder: true, assets: 57 },
  { id: "p-alpha", name: "PROJECT-ALPHA", isFolder: false, assets: 34 },
  { id: "p-gamma", name: "PROJECT-GAMMA", isFolder: false, assets: 1 },
];

const boot = (syncProjectId, projectList = LIST) => ({
  scope: { projectView: "", shown: 87, register: 87, syncProjectId },
  filterOptions: { projectList },
});

const preview = (over = {}) => ({
  name: "PROJECT-GAMMA",
  projectId: "p-gamma",
  census: {
    total: 87, direct: 1, attached: 1, droppedAttributed: 56, droppedOrphan: 29, keep: 2,
  },
  tabs: [
    { tab: "ai_issues", before: 32, after: 4 },
    { tab: "ai_findings", before: 7, after: 1 },
    { tab: "ai_data_findings", before: 6, after: 0 },
    { tab: "ai_identity_findings", before: 3, after: 0 },
    { tab: "ai_edges", before: 86, after: 1 },
    { tab: "ai_assets", before: 87, after: 2 },
  ],
  cellsBefore: 40300,
  cellsAfter: 40300,
  ...over,
});

describe("prunePanelView, before a preview", () => {
  it("offers nothing when there is no register to prune", () => {
    // Including the boot-failure path, where the page renders with null.
    expect(prunePanelView(null, null).show).toBe(false);
    expect(prunePanelView(boot(null, []), null).show).toBe(false);
  });

  it("defaults to the sync scope and names it in words on the option", () => {
    const v = prunePanelView(boot("p-unit"), null);
    expect(v.defaultId).toBe("p-unit");
    expect(v.syncScopeNote).toBe(null);
    // A word, not a colour or a position: the mark has to survive being read aloud.
    const marked = v.options.filter((o) => o.hint.includes("sync scope"));
    expect(marked.map((o) => o.value)).toEqual(["p-unit"]);
  });

  it("refuses to default to a project this register does not hold", () => {
    // Arming the control on a pick whose census reads zero everywhere would make "already
    // clean" and "never fetched" render identically, and those call for opposite reactions.
    const v = prunePanelView(boot("p-not-synced"), null);
    expect(v.defaultId).toBe("");
    expect(v.syncScopeNote).toMatch(/does not hold/);
  });

  it("says so when the sync is not scoped at all", () => {
    const v = prunePanelView(boot(null), null);
    expect(v.defaultId).toBe("");
    expect(v.syncScopeNote).toMatch(/not scoped/);
  });

  it("offers no removal until a preview has run", () => {
    // The preview is the control's only safeguard: a folder id and one leaf inside it differ
    // by most of the register, and nothing else on screen says which one is selected.
    const v = prunePanelView(boot("p-unit"), null);
    expect(v.canRemove).toBe(false);
    expect(v.census).toBe(null);
    expect(v.attribution).toBe(null);
  });
});

describe("prunePanelView census", () => {
  it("reads assets first, though the server sends them last", () => {
    // The wire order is the WRITE order (children first, so an interrupted prune leaves
    // under-reporting rather than dangling references). That is the right order to write and
    // the wrong one to read: assets are the population every other row hangs off.
    const v = prunePanelView(boot("p-unit"), preview());
    expect(v.census.rows.map((r) => r.label)).toEqual([
      "Assets", "Edges", "Issues", "Config findings", "Data findings", "Identity findings",
    ]);
  });

  it("shows a tab it has no name for rather than dropping it", () => {
    // A census that silently omitted a table would understate what is about to be deleted.
    const v = prunePanelView(boot("p-unit"), preview({
      tabs: [{ tab: "ai_assets", before: 87, after: 2 }, { tab: "ai_future", before: 9, after: 1 }],
    }));
    expect(v.census.rows.map((r) => r.label)).toEqual(["Assets", "ai_future"]);
  });

  it("carries the per-tab subtraction, never a negative one", () => {
    const v = prunePanelView(boot("p-unit"), preview());
    expect(v.census.rows[0]).toEqual({ label: "Assets", before: 87, after: 2, removed: 85 });
    const idempotent = prunePanelView(boot("p-unit"), preview({
      tabs: [{ tab: "ai_assets", before: 2, after: 2 }],
    }));
    expect(idempotent.census.rows[0].removed).toBe(0);
  });

  it("claims the cell figure only when it is going to move", () => {
    // Reclaiming the grid leaves each tab a buffer of spare rows, so on a register smaller
    // than that buffer the figure genuinely does not change, and "40,300 to 40,300" is a line
    // that says nothing.
    expect(prunePanelView(boot("p-unit"), preview()).census.cellsFreed).toBe(0);
    const moves = prunePanelView(boot("p-unit"), preview({ cellsAfter: 12000 }));
    expect(moves.census.cellsFreed).toBe(28300);
  });
});

describe("prunePanelView, the unattributed bucket", () => {
  it("states both halves of the split", () => {
    // Wiz attributes inventory, not people. Folding these into the total would let a reader
    // assume the identity population went with the projects, or that it stayed.
    const v = prunePanelView(boot("p-unit"), preview());
    expect(v.attribution).toMatch(/1 unattributed asset kept/);
    expect(v.attribution).toMatch(/29 dropped/);
  });

  it("says nothing when the register has no unattributed assets", () => {
    const v = prunePanelView(boot("p-unit"), preview({
      census: { total: 87, direct: 60, attached: 0, droppedAttributed: 27, droppedOrphan: 0, keep: 60 },
    }));
    expect(v.attribution).toBe(null);
  });

  it("writes only the half that happened", () => {
    const keptOnly = prunePanelView(boot("p-unit"), preview({
      census: { total: 87, direct: 57, attached: 27, droppedAttributed: 3, droppedOrphan: 0, keep: 84 },
    }));
    expect(keptOnly.attribution).toMatch(/^27 unattributed assets kept/);
    expect(keptOnly.attribution).not.toMatch(/dropped/);

    const droppedOnly = prunePanelView(boot("p-unit"), preview({
      census: { total: 87, direct: 57, attached: 0, droppedAttributed: 3, droppedOrphan: 27, keep: 57 },
    }));
    expect(droppedOnly.attribution).toMatch(/^27 unattributed assets dropped/);
  });
});

describe("prunePanelView verdicts", () => {
  it("offers removal, with the count in the label", () => {
    const v = prunePanelView(boot("p-unit"), preview());
    expect(v.canRemove).toBe(true);
    expect(v.removeLabel).toBe("Remove 85 assets");
    expect(v.status).toBe(null);
  });

  it("pluralises the one-asset case", () => {
    const v = prunePanelView(boot("p-unit"), preview({
      census: { total: 3, direct: 2, attached: 0, droppedAttributed: 1, droppedOrphan: 0, keep: 2 },
    }));
    expect(v.removeLabel).toBe("Remove 1 asset");
  });

  it("states 'clean' rather than leaving a blank slot", () => {
    // An empty census and a census of zeroes look the same, and only one of them means the
    // register is already inside the project.
    const v = prunePanelView(boot("p-unit"), preview({
      name: "DEMO-BUSINESS-UNIT",
      census: { total: 87, direct: 87, attached: 0, droppedAttributed: 0, droppedOrphan: 0, keep: 87 },
    }));
    expect(v.canRemove).toBe(false);
    expect(v.status.kind).toBe("ok");
    expect(v.status.label).toBe("Nothing to remove");
    expect(v.status.text).toMatch(/DEMO-BUSINESS-UNIT/);
  });

  it("refuses to arm a removal that would empty the register", () => {
    // The server refuses this before it can be returned. The arm exists so a surprise renders
    // as a sentence rather than as a blank card with a live danger button on it.
    const v = prunePanelView(boot("p-unit"), preview({
      census: { total: 87, direct: 0, attached: 0, droppedAttributed: 87, droppedOrphan: 0, keep: 0 },
    }));
    expect(v.canRemove).toBe(false);
    expect(v.status.kind).toBe("bad");
    expect(v.status.text).toMatch(/Reset synced data/);
  });
});
