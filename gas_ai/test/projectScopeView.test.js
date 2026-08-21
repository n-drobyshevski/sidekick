// What the sidebar switcher CLAIMS, from the bootstrap payload alone.
//
// DOM-free half of the control, tested the way syncProgressView is: the assembly in
// `projectScopeControl` is a handful of `el()` calls, but the wording, the denominator and
// the stale-scope detection are decisions, and a decision that can be wrong gets a test.

import { describe, expect, it } from "vitest";
import { projectScopeView, railGlyph } from "../src/client/js/ui/projectScope.js";

const boot = (scope, projectList) => ({ scope, filterOptions: { projectList } });

const LIST = [
  { id: "p-unit", name: "VALUE-CHAIN", isFolder: true, assets: 826 },
  { id: "p-a", name: "CS-VALUECHAIN-SECURITY", isFolder: false, assets: 12 },
  { id: "p-b", name: "GITHUB-DKTUNITED", isFolder: false, assets: 1 },
];

describe("projectScopeView", () => {
  it("offers nothing when there is no register to slice", () => {
    // Including the boot-failure path, where renderSidebar is called with null.
    expect(projectScopeView(null).show).toBe(false);
    expect(projectScopeView(boot({ projectView: "", shown: 0, register: 0 }, [])).show).toBe(false);
  });

  it("names the whole register without calling it 'all projects'", () => {
    // The register holds what the last sync was SCOPED TO FETCH. On a tenant scoped to one
    // business unit, "All projects" would name a population this register does not contain.
    const v = projectScopeView(boot({ projectView: "", shown: 826, register: 826 }, LIST));
    expect(v.pinned[0].label).toBe("All synced projects");
    expect(v.caption).toBe("826 assets synced");
    expect(v.stale).toBe(false);
    expect(v.glyph).toBe("ALL");
  });

  it("keeps the denominator beside the number", () => {
    // "826" alone cannot distinguish a small unit from a small register, and those call for
    // opposite reactions from whoever is reading.
    const v = projectScopeView(boot({ projectView: "p-a", shown: 12, register: 826 }, LIST));
    expect(v.caption).toBe("12 of 826 assets");
    expect(v.label).toBe("CS-VALUECHAIN-SECURITY");
  });

  it("says a stale scope is stale instead of showing a bare zero", () => {
    // A stored view outliving the register — re-synced scoped elsewhere. "0 of 826" with no
    // explanation reads as "this project is clean", which is the opposite of the truth.
    const v = projectScopeView(boot({ projectView: "p-gone", shown: 0, register: 826 }, LIST));
    expect(v.stale).toBe(true);
    expect(v.caption).toContain("Not in this register");
    expect(v.label).toBe("a project this register does not hold");
    expect(v.glyph).toBe("!");
    // And every real project is still on offer, so the state is escapable.
    expect(v.options.map((o) => o.value)).toEqual(["p-unit", "p-a", "p-b"]);
  });

  it("declares folders in words, not by colour or icon alone", () => {
    const v = projectScopeView(boot({ projectView: "", shown: 826, register: 826 }, LIST));
    expect(v.options[0].hint).toBe("Business unit · 826 assets");
    expect(v.options[0].group).toBe("Business units");
    expect(v.options[1].hint).toBe("12 assets");
    // Singular, because "1 assets" is the tell of a count nobody looked at.
    expect(v.options[2].hint).toBe("1 asset");
  });

  it("claims nothing about folders when the register has not recorded any", () => {
    // `isFolder` is tri-state: undefined means the row predates the field, which is every
    // asset already in the ledger. Grouping those under "Projects" would assert leaf-ness
    // of the whole register on the strength of a field nobody has filled in.
    const legacy = [
      { id: "p-a", name: "ALPHA", assets: 3 },
      { id: "p-b", name: "BETA", assets: 4 },
    ];
    const v = projectScopeView(boot({ projectView: "", shown: 7, register: 7 }, legacy));
    expect(v.options.every((o) => o.group === "")).toBe(true);

    // But a register that knows about SOME rows keeps the unknown ones out of both claims
    // rather than defaulting them to leaves.
    const mixed = [{ id: "p-u", name: "UNIT", isFolder: true, assets: 9 }, ...legacy];
    const w = projectScopeView(boot({ projectView: "", shown: 9, register: 9 }, mixed));
    expect(w.options.map((o) => o.group))
      .toEqual(["Business units", "Not yet recorded", "Not yet recorded"]);
  });
});

describe("railGlyph", () => {
  it("takes word initials, because these names are hyphenated", () => {
    // First-two-characters would render every PROJECT-* in a register as "PR".
    expect(railGlyph("VALUE-CHAIN")).toBe("VC");
    expect(railGlyph("CS-VALUECHAIN-SECURITY")).toBe("CV");
    expect(railGlyph("PROJECT-ALPHA")).toBe("PA");
    expect(railGlyph("PROJECT-BETA")).toBe("PB");
  });

  it("falls back to two characters for a single-word name", () => {
    expect(railGlyph("Production")).toBe("PR");
    expect(railGlyph("")).toBe("?");
  });
});
