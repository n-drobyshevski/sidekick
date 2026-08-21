// The project switcher's list, and the two ways it could quietly lie.
//
// It is derived from the SYNCED register rather than from a live `projects` catalogue query.
// That is a deliberate constraint, not a shortcut: a picker built from the tenant's full
// project list would happily offer a project the sync never collected, and the page behind it
// would render zero assets — an empty result that looks like a finding and is really an
// unasked question. This is the same "absent is not zero" rule the rest of the app runs on,
// applied to a control.

import { describe, expect, it } from "vitest";

import { projectCatalogue, type GNode } from "../src/domain/graphTypes";

function asset(id: string, projects: GNode["projects"]): GNode {
  return { id, kind: "AI_AGENT", name: id, projects } as GNode;
}

describe("projectCatalogue", () => {
  it("offers folders first, then leaves, each by name", () => {
    // The Wiz console's own order, and the one that puts a business unit above the projects
    // it contains rather than alphabetically among them.
    const rows = projectCatalogue([
      asset("a1", [
        { id: "p-zeta", name: "ZETA", isFolder: false },
        { id: "p-unit", name: "UNIT", isFolder: true },
        { id: "p-alpha", name: "ALPHA", isFolder: false },
        { id: "p-bunit", name: "B-UNIT", isFolder: true },
      ]),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["B-UNIT", "UNIT", "ALPHA", "ZETA"]);
  });

  it("counts how much of the register each project holds", () => {
    // The count is about THIS register, never a Wiz-side total — which is why the field is
    // named `assets` rather than anything that sounds like a tenant fact.
    const rows = projectCatalogue([
      asset("a1", [{ id: "p-unit", name: "UNIT", isFolder: true }, { id: "p-a", name: "A" }]),
      asset("a2", [{ id: "p-unit", name: "UNIT", isFolder: true }, { id: "p-b", name: "B" }]),
      asset("a3", [{ id: "p-unit", name: "UNIT", isFolder: true }]),
    ]);
    const unit = rows.find((r) => r.id === "p-unit");
    expect(unit?.assets).toBe(3);
    expect(rows.find((r) => r.id === "p-a")?.assets).toBe(1);
  });

  it("lets a synced row teach an older row what a project is, never the reverse", () => {
    // Every row already in the ledger predates the `isFolder` selection and carries
    // `undefined`. Merging naively — last-wins, or `||` — would let one stale row erase what
    // a freshly synced row knows, and the folder would render as a leaf on a register that
    // is only partly re-synced. First-non-undefined wins, in either encounter order.
    const legacyFirst = projectCatalogue([
      asset("old", [{ id: "p-unit", name: "UNIT" }]),
      asset("new", [{ id: "p-unit", name: "UNIT", isFolder: true }]),
    ]);
    expect(legacyFirst[0].isFolder).toBe(true);

    const legacySecond = projectCatalogue([
      asset("new", [{ id: "p-unit", name: "UNIT", isFolder: true }]),
      asset("old", [{ id: "p-unit", name: "UNIT" }]),
    ]);
    expect(legacySecond[0].isFolder).toBe(true);
  });

  it("keeps unknown as unknown, so a legacy row is never asserted to be a leaf", () => {
    // `isFolder === false` is a claim; `undefined` is the absence of one. A register synced
    // before this field existed must not have every project drawn as a leaf on the strength
    // of a default.
    const rows = projectCatalogue([asset("old", [{ id: "p-x", name: "X" }])]);
    expect(rows[0].isFolder).toBeUndefined();
    expect(rows[0].isFolder).not.toBe(false);
  });

  it("offers nothing for an empty register, rather than a tenant's project list", () => {
    expect(projectCatalogue([])).toEqual([]);
    expect(projectCatalogue([asset("a1", undefined)])).toEqual([]);
  });
});
