// What the DRY-RUN seed actually offers the scope switcher.
//
// Every rule the switcher applies is unit-tested against hand-built rows in
// projectScopeView.test.js. This file asks the different question those cannot: does the
// register a demo actually opens contain something for each rule to fire on? A grouping that
// is correct on fixtures and draws one heading in the product is a feature nobody can see.
//
// Plain .js for the reason navFlyout.test.js writes out: tsconfig has no allowJs, so a .ts
// test importing a client .js module fails `tsc --noEmit` and `npm run check` never reaches
// vitest. edgeRoute.test.js already imports sampleData.ts from a .js test the same way.

import { describe, expect, it } from "vitest";

import { projectCatalogue } from "../src/domain/graphTypes";
import { SEED_NODES } from "../src/server/sampleData";
import { scopeOptions } from "../src/client/js/ui/projectScope.js";

const rows = scopeOptions(projectCatalogue(SEED_NODES));
const headings = [...new Set(rows.map((r) => r.group))];
const byName = (name) => rows.filter((r) => r.label === name)[0];

describe("the seeded register, through the scope switcher", () => {
  // The three headings, in the order the combobox will emit them while walking the list.
  it("draws all three headings, widest first", () => {
    expect(headings).toEqual(["Business units", "Support groups", "Projects"]);
  });

  it("puts the seeded support group under its own heading, not with the units", () => {
    const cs = byName("CS-DEMO-PLATFORM");
    expect(cs.group).toBe("Support groups");
    expect(cs.kind).toBe("support");
  });

  // THE CASE THE SEED EXISTS FOR. CS-DEMO-PLATFORM is `isFolder: true` — Wiz would call it a
  // folder and the app would call it a business unit if the name did not win. A register whose
  // only folder was DEMO-BUSINESS-UNIT could not tell that rule from an unused branch.
  it("classifies a CS-named FOLDER by its name, with a unit beside it to contrast", () => {
    expect(projectCatalogue(SEED_NODES).filter((p) => p.name === "CS-DEMO-PLATFORM")[0].isFolder)
      .toBe(true);
    expect(byName("DEMO-BUSINESS-UNIT").kind).toBe("unit");
  });

  // Both reach a subtree, so both say so in words rather than by their shared glyph.
  it("says in words what each folder kind reaches", () => {
    expect(byName("CS-DEMO-PLATFORM").hint).toMatch(/^Support group · /);
    expect(byName("DEMO-BUSINESS-UNIT").hint).toMatch(/^Business unit · /);
    expect(byName("PROJECT-ALPHA").hint).not.toMatch(/·/);
  });

  // A support group that selected everything, or one asset, would demonstrate the heading and
  // nothing about the scope. It has to be a real subtree: smaller than the unit, and not equal
  // to any one project — otherwise it is a second spelling of the project picker.
  it("selects a subtree no single project selects", () => {
    const seen = new Map(projectCatalogue(SEED_NODES).map((p) => [p.name, p.assets]));
    const cs = seen.get("CS-DEMO-PLATFORM");
    expect(cs).toBeGreaterThan(1);
    expect(cs).toBeLessThan(seen.get("DEMO-BUSINESS-UNIT"));
    for (const [name, count] of seen) {
      if (name === "CS-DEMO-PLATFORM" || name === "DEMO-BUSINESS-UNIT") continue;
      expect(count).not.toBe(cs);
    }
  });
});
