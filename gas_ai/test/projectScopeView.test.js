// What the sidebar switcher CLAIMS, from the bootstrap payload alone.
//
// DOM-free half of the control, tested the way syncProgressView is: the assembly in
// `projectScopeControl` is a handful of `el()` calls, but the wording, the denominator and
// the stale-scope detection are decisions, and a decision that can be wrong gets a test.

import { describe, expect, it } from "vitest";
import { projectScopeView, railGlyph, trendScopeView } from "../src/client/js/ui/projectScope.js";

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


// The inventory trend's own scope claim — the last figure in the app that had to refuse the
// switcher, and the one whose note is easiest to get subtly wrong.
//
// A per-project series can only cover syncs recorded after the column shipped, so a project's
// line can be three points long against a ledger of forty. A chart that starts three points in
// looks exactly like a landscape that collapsed; "covers 3 of 40" is the difference between a
// short history and a catastrophe, and it is the whole reason this function exists rather than
// a bare `registerWideNote` call.

const trendScope = (over) => ({
  projectId: "p-a", scoped: true, points: 3, registerPoints: 40, ...over,
});

describe("trendScopeView", () => {
  it("says nothing when no project is in view", () => {
    expect(trendScopeView(null).show).toBe(false);
    expect(trendScopeView(trendScope({ scoped: false, projectId: "" })).show).toBe(false);
  });

  it("names the coverage when the series is shorter than the ledger", () => {
    const v = trendScopeView(trendScope());
    expect(v.show).toBe(true);
    expect(v.live).toBe(true);
    expect(v.tag).toBe("This project");
    expect(v.text).toContain("3 of the 40");
    // The earlier points are not coming: the ledger never held the dimension, so the note
    // must not imply a later sync will fill them in.
    expect(v.text).toContain("register-wide totals only");
  });

  it("drops the coverage clause once the series covers the whole ledger", () => {
    const v = trendScopeView(trendScope({ points: 40 }));
    expect(v.live).toBe(true);
    expect(v.text).not.toContain(" of the ");
    expect(v.text).toContain("Every recorded sync");
  });

  it("does not claim to show the project when it has no points at all", () => {
    // The chart is EMPTY here. "This project" would label a series that is not on screen, and
    // "Whole register" would label one that is not on screen either.
    const v = trendScopeView(trendScope({ points: 0 }));
    expect(v.tag).toBe("Not yet recorded");
    expect(v.live).toBe(false);
    expect(v.text).toContain("next sync");
    expect(v.text).toContain("cannot be broken down after the fact");
  });

  it("does not blame history that does not exist yet", () => {
    // A brand-new ledger: no points for this project because there are no syncs at all, not
    // because the syncs predate the column. Saying "0 recorded syncs hold register-wide
    // totals only" would be a sentence about nothing.
    const v = trendScopeView(trendScope({ points: 0, registerPoints: 0 }));
    expect(v.text).toBe("Per-project totals start with the first sync.");
  });

  it("treats a series longer than the register as covered, not as a contradiction", () => {
    // Cannot happen from the server, which counts both off one history read — but a stale SWR
    // payload can pair a new series with an old count, and the honest answer to "4 of 3" is
    // not to print it.
    expect(trendScopeView(trendScope({ points: 4, registerPoints: 3 })).text)
      .toContain("Every recorded sync");
  });
});
