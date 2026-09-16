// src/domain/projectScope.ts — the project catalogue and membership predicate.
//
// This module is the data foundation for a later app-header project-scope selector; there is
// no UI here to test, only the pure functions a later package will build on: parsing the
// projects_json column (reconcile.ts's projectsListJson, P1), folding it into a catalogue, and
// the single membership predicate every scoped view is meant to share.

import { describe, expect, it } from "vitest";
import { projectsListJson } from "../src/domain/reconcile";
import {
  attachProjectGrain,
  inProject,
  parseProjects,
  projectCatalogue,
  unattributedCount,
  type ProjectGrainCarrier,
  type ProjectRef,
} from "../src/domain/projectScope";
import type { Rec } from "../src/domain/util";

// --------------------------------------------------------------------------- #
//  parseProjects
// --------------------------------------------------------------------------- #

describe("parseProjects", () => {
  it("null, undefined and blank all come back as []", () => {
    expect(parseProjects(null)).toEqual([]);
    expect(parseProjects(undefined)).toEqual([]);
    expect(parseProjects("")).toEqual([]);
  });

  it("malformed JSON comes back as [], never throws", () => {
    expect(() => parseProjects("{not json")).not.toThrow();
    expect(parseProjects("{not json")).toEqual([]);
    expect(parseProjects("null")).toEqual([]);
    expect(parseProjects("42")).toEqual([]);
    expect(parseProjects('"a string"')).toEqual([]);
    expect(parseProjects("{}")).toEqual([]);
  });

  it("skips array entries that are not well-formed {slug, name} objects", () => {
    const json = JSON.stringify([
      { slug: "ok", name: "OK" },
      { slug: "no-name" },
      { name: "no-slug" },
      { slug: "", name: "empty slug" },
      null,
      "a string entry",
      42,
      ["nested", "array"],
    ]);
    expect(parseProjects(json)).toEqual([{ slug: "ok", name: "OK" }]);
  });

  it("round-trips a tri-state isFolder through projectsListJson: true, false, and ABSENT", () => {
    const record = {
      projects: [
        { slug: "a-folder", name: "A Folder", isFolder: true },
        { slug: "a-leaf", name: "A Leaf", isFolder: false },
        { slug: "unknown", name: "Unknown" }, // no isFolder at all
      ],
    };
    const json = projectsListJson(record);
    const parsed = parseProjects(json);
    expect(parsed).toHaveLength(3);
    const byslug = Object.fromEntries(parsed.map((p) => [p.slug, p]));
    expect(byslug["a-folder"]!.isFolder).toBe(true);
    expect(byslug["a-leaf"]!.isFolder).toBe(false);
    // ABSENT, not false — the property must not even be present.
    expect("isFolder" in byslug["unknown"]!).toBe(false);
    expect(byslug["unknown"]!.isFolder).toBeUndefined();
  });

  it("a hand-edited cell with isFolder as a non-boolean is dropped, not coerced", () => {
    const json = JSON.stringify([{ slug: "x", name: "X", isFolder: "yes" }]);
    const [ref] = parseProjects(json);
    expect(ref!.isFolder).toBeUndefined();
    expect("isFolder" in ref!).toBe(false);
  });
});

// --------------------------------------------------------------------------- #
//  projectCatalogue
// --------------------------------------------------------------------------- #

describe("projectCatalogue", () => {
  it("an empty register yields []", () => {
    expect(projectCatalogue([])).toEqual([]);
    expect(projectCatalogue([{ projects_json: null }, { projects_json: undefined }])).toEqual([]);
  });

  it("counts findings per project, register-wide, across multiple rows", () => {
    const rows = [
      { projects_json: projectsListJson({ projects: [{ slug: "a", name: "A" }] }) },
      { projects_json: projectsListJson({ projects: [{ slug: "a", name: "A" }] }) },
      { projects_json: projectsListJson({ projects: [{ slug: "b", name: "B" }] }) },
      { projects_json: null }, // unattributed — must not appear in the catalogue
    ];
    const cat = projectCatalogue(rows);
    expect(cat).toHaveLength(2);
    const bySlug = Object.fromEntries(cat.map((c) => [c.slug, c]));
    expect(bySlug["a"]!.findings).toBe(2);
    expect(bySlug["b"]!.findings).toBe(1);
  });

  it("a row belonging to two projects contributes to both entries", () => {
    const rows = [
      {
        projects_json: projectsListJson({
          projects: [
            { slug: "folder", name: "Folder", isFolder: true },
            { slug: "leaf", name: "Leaf", isFolder: false },
          ],
        }),
      },
    ];
    const cat = projectCatalogue(rows);
    expect(cat.map((c) => c.slug).sort()).toEqual(["folder", "leaf"]);
    expect(cat.every((c) => c.findings === 1)).toBe(true);
  });

  it("sorts folders first, then by name within each group", () => {
    const rows = [
      { projects_json: projectsListJson({ projects: [{ slug: "z-leaf", name: "Z Leaf", isFolder: false }] }) },
      { projects_json: projectsListJson({ projects: [{ slug: "a-leaf", name: "A Leaf", isFolder: false }] }) },
      { projects_json: projectsListJson({ projects: [{ slug: "z-folder", name: "Z Folder", isFolder: true }] }) },
      { projects_json: projectsListJson({ projects: [{ slug: "a-folder", name: "A Folder", isFolder: true }] }) },
    ];
    const cat = projectCatalogue(rows);
    expect(cat.map((c) => c.slug)).toEqual(["a-folder", "z-folder", "a-leaf", "z-leaf"]);
  });

  it("isFolder merges first-non-undefined-wins across occurrences of the same slug", () => {
    const rows = [
      { projects_json: projectsListJson({ projects: [{ slug: "x", name: "X" }] }) }, // no isFolder
      { projects_json: projectsListJson({ projects: [{ slug: "x", name: "X", isFolder: true }] }) },
      // A third occurrence saying false must NOT un-learn the true already recorded.
      { projects_json: projectsListJson({ projects: [{ slug: "x", name: "X", isFolder: false }] }) },
    ];
    const cat = projectCatalogue(rows);
    expect(cat).toHaveLength(1);
    expect(cat[0]!.isFolder).toBe(true);
    expect(cat[0]!.findings).toBe(3);
  });

  it("a project never learning isFolder stays undefined, not false", () => {
    const rows = [{ projects_json: projectsListJson({ projects: [{ slug: "x", name: "X" }] }) }];
    const cat = projectCatalogue(rows);
    expect(cat[0]!.isFolder).toBeUndefined();
  });
});

// --------------------------------------------------------------------------- #
//  projectCatalogue — the support group ↔ product parent edge, from CO-OCCURRENCE
// --------------------------------------------------------------------------- #
//
// Wiz reports no ancestry, but it flattens the WHOLE chain onto every finding — so a support
// group and a product appearing on the SAME ROW are an edge, observed rather than assumed.
// The switcher uses it to file each product under its group's heading.

describe("projectCatalogue: the parent edge", () => {
  const row = (...names: Array<[string, boolean?]>) => ({
    projects_json: projectsListJson({
      projects: names.map(([name, isFolder]) => (isFolder === undefined
        ? { slug: name.toLowerCase(), name }
        : { slug: name.toLowerCase(), name, isFolder })),
    }),
  });
  const bySlug = (rows: Array<{ projects_json: string | null }>) =>
    Object.fromEntries(projectCatalogue(rows).map((c) => [c.slug, c]));

  it("files each product under the support group it co-occurs with", () => {
    const cat = bySlug([
      row(["CE-TRANSPORT", true], ["product-a", false]),
      row(["CE-TRANSPORT", true], ["product-b", false]),
    ]);
    expect(cat["product-a"]!.supportGroup).toBe("CE-TRANSPORT");
    expect(cat["product-b"]!.supportGroup).toBe("CE-TRANSPORT");
    expect(cat["product-a"]!.supportGroupCount).toBe(1);
  });

  it("ONE GROUP, MANY PRODUCTS — the containment the flat payload never states", () => {
    const cat = bySlug([
      row(["CE-TRANSPORT", true], ["product-a", false]),
      row(["CE-TRANSPORT", true], ["product-b", false]),
      row(["CS-LOG-ZEN-ECOM", true], ["product-c", false]),
    ]);
    const under = (g: string) => Object.values(cat)
      .filter((c) => c.supportGroup === g).map((c) => c.slug).sort();
    expect(under("CE-TRANSPORT")).toEqual(["product-a", "product-b"]);
    expect(under("CS-LOG-ZEN-ECOM")).toEqual(["product-c"]);
  });

  it("REFUSES to name one where two groups claim the same product, and says how many", () => {
    // A summary over many rows: a hint reading `Product · CE-TRANSPORT` on a product that
    // actually spans two groups is a false structural claim a reader will act on. Only
    // `supportGroupCount` can tell this apart from "nobody filed it".
    const cat = bySlug([
      row(["CE-TRANSPORT", true], ["product-a", false]),
      row(["CS-LOG-ZEN-ECOM", true], ["product-a", false]),
    ]);
    expect(cat["product-a"]!.supportGroup).toBeNull();
    expect(cat["product-a"]!.supportGroupCount).toBe(2);
  });

  it("a product nobody filed under a group names none, and counts ZERO — not the same "
    + "state", () => {
    const cat = bySlug([row(["VALUE-CHAIN", true], ["product-a", false])]);
    expect(cat["product-a"]!.supportGroup).toBeNull();
    expect(cat["product-a"]!.supportGroupCount).toBe(0);
  });

  it("every entry carries both fields, product or not — one payload shape", () => {
    const cat = bySlug([row(["CE-TRANSPORT", true], ["product-a", false], ["checkout-svc", false])]);
    for (const entry of Object.values(cat)) {
      expect(entry).toHaveProperty("supportGroup");
      expect(entry).toHaveProperty("supportGroupCount");
    }
    expect(cat["ce-transport"]!.supportGroupCount).toBe(0);
    expect(cat["checkout-svc"]!.supportGroup).toBeNull();
  });

  it("the edge is CO-OCCURRENCE, not name similarity: no group on the row, no edge", () => {
    // The group exists in the register, but never on the same row as this product.
    const cat = bySlug([
      row(["CE-TRANSPORT", true], ["product-a", false]),
      row(["product-b", false]),
    ]);
    expect(cat["product-b"]!.supportGroup).toBeNull();
    expect(cat["product-b"]!.supportGroupCount).toBe(0);
  });
});

// --------------------------------------------------------------------------- #
//  inProject — the single membership predicate
// --------------------------------------------------------------------------- #

describe("inProject", () => {
  // A folder plus two DISTINCT leaves beneath it, flattened onto each row's projects[] the
  // way Wiz actually returns them (ownerProject/ownerPath's comment in reconcile.ts) — the
  // folder's ancestry chain reaches both leaves without inProject ever walking a tree.
  const folderSlug = "value-chain";
  const leafA: readonly ProjectRef[] = [
    { slug: folderSlug, name: "VALUE-CHAIN", isFolder: true },
    { slug: "leaf-a", name: "Leaf A", isFolder: false },
  ];
  const leafB: readonly ProjectRef[] = [
    { slug: folderSlug, name: "VALUE-CHAIN", isFolder: true },
    { slug: "leaf-b", name: "Leaf B", isFolder: false },
  ];

  it("a folder slug matches every row beneath it", () => {
    expect(inProject(leafA, folderSlug)).toBe(true);
    expect(inProject(leafB, folderSlug)).toBe(true);
  });

  it("each leaf slug matches only its own row, not the sibling leaf's", () => {
    expect(inProject(leafA, "leaf-a")).toBe(true);
    expect(inProject(leafA, "leaf-b")).toBe(false);
    expect(inProject(leafB, "leaf-b")).toBe(true);
    expect(inProject(leafB, "leaf-a")).toBe(false);
  });

  it("an empty slug matches nothing — there is no 'everything' project", () => {
    expect(inProject(leafA, "")).toBe(false);
    expect(inProject(undefined, "")).toBe(false);
  });

  it("undefined projects matches nothing for a real slug either", () => {
    expect(inProject(undefined, folderSlug)).toBe(false);
    expect(inProject([], folderSlug)).toBe(false);
  });
});

// --------------------------------------------------------------------------- #
//  unattributedCount
// --------------------------------------------------------------------------- #

describe("unattributedCount", () => {
  it("counts rows with no project at all, and only those", () => {
    const rows = [
      { projects_json: projectsListJson({ projects: [{ slug: "a", name: "A" }] }) },
      { projects_json: null },
      { projects_json: undefined },
      { projects_json: "" },
      { projects_json: "not json" },
      { projects_json: "[]" },
    ];
    expect(unattributedCount(rows)).toBe(5);
  });

  it("an empty register counts zero, not a null/undefined figure", () => {
    expect(unattributedCount([])).toBe(0);
  });

  it("a fully-attributed register counts zero", () => {
    const rows = [
      { projects_json: projectsListJson({ projects: [{ slug: "a", name: "A" }] }) },
      { projects_json: projectsListJson({ projects: [{ slug: "b", name: "B" }] }) },
    ];
    expect(unattributedCount(rows)).toBe(0);
  });
});

// --------------------------------------------------------------------------- #
//  organisation-wide projects — the tenant's connector tag is not a scope
// --------------------------------------------------------------------------- #
//
// `GITHUB-DKTUNITED` reaches EVERY repository in this tenant (config.ts's ORG_WIDE_PROJECTS),
// which is exactly what makes it useless as one: as a switcher row it is "everything synced"
// under another name, and as a membership answer it is true of every row. The filter lives in
// `parseProjects`, so these cases also pin that the catalogue, the predicate and the
// unattributed count cannot disagree about it — there is one filter, not three.

describe("organisation-wide projects", () => {
  const withOrgTag = (extra: Rec[] = []): string | null =>
    projectsListJson({
      projects: [
        { slug: "github-dktunited", name: "GITHUB-DKTUNITED", isFolder: false },
        ...extra,
      ],
    });

  it("parseProjects drops the org tag and keeps everything beside it", () => {
    const json = withOrgTag([
      { slug: "value-chain", name: "VALUE-CHAIN", isFolder: true },
      { slug: "product-tattoo-idp", name: "product-TATTOO-idp", isFolder: false },
    ]);
    expect(parseProjects(json).map((p) => p.slug)).toEqual([
      "product-tattoo-idp",
      "value-chain",
    ]);
  });

  it("matches on the NAME too, and case-insensitively — a hand-edited cell cannot smuggle "
    + "it back in", () => {
    const json = JSON.stringify([
      { slug: "some-other-slug", name: "github-dktunited" },
      { slug: "GITHUB-DKTUNITED", name: "Re-typed display name" },
      { slug: " github-dktunited ", name: "padded" },
    ]);
    expect(parseProjects(json)).toEqual([]);
  });

  it("a project whose name merely CONTAINS the tag is a real project and stays", () => {
    const json = projectsListJson({
      projects: [
        { slug: "github-dktunited-platform", name: "GITHUB-DKTUNITED-PLATFORM" },
        { slug: "github-other", name: "GITHUB-OTHER" },
      ],
    });
    expect(parseProjects(json).map((p) => p.slug)).toEqual([
      "github-dktunited-platform",
      "github-other",
    ]);
  });

  it("the catalogue never offers it, so the switcher cannot offer a row that means "
    + "'everything'", () => {
    const rows = [
      { projects_json: withOrgTag([{ slug: "a", name: "A" }]) },
      { projects_json: withOrgTag([{ slug: "b", name: "B" }]) },
    ];
    expect(projectCatalogue(rows).map((c) => c.slug)).toEqual(["a", "b"]);
  });

  it("inProject answers false for it — the predicate and the catalogue agree", () => {
    const projects = parseProjects(withOrgTag([{ slug: "a", name: "A" }]));
    expect(inProject(projects, "github-dktunited")).toBe(false);
    expect(inProject(projects, "a")).toBe(true);
  });

  it("a row whose ONLY project is the org tag counts as unattributed, not as attributed to "
    + "the organisation", () => {
    const rows = [
      { projects_json: withOrgTag() },
      { projects_json: withOrgTag([{ slug: "a", name: "A" }]) },
    ];
    expect(unattributedCount(rows)).toBe(1);
    expect(projectCatalogue(rows).map((c) => c.slug)).toEqual(["a"]);
  });
});

// --------------------------------------------------------------------------- #
//  attachProjectGrain — the two dimensions every breakdown groups by
// --------------------------------------------------------------------------- #
//
// Attached on read, never a column: a prefix rule is the tenant's vocabulary, and vocabulary
// changes. Baked into the ledger a fourth prefix would cost a re-scan to correct, and — because
// reconcile merges those columns latest-wins-never-erased — a stale value would keep winning
// even then. `ledgerStore.scrubOrgWideOwners` is what that costs when it goes the other way.

describe("attachProjectGrain", () => {
  const rowWith = (
    projects: Array<Record<string, unknown>>,
    over: Rec = {},
  ): ProjectGrainCarrier => ({
    projects_json: projectsListJson({ projects }),
    ...over,
  });
  const bare = (over: ProjectGrainCarrier): ProjectGrainCarrier => over;

  it("reads both grains off the row's own projects", () => {
    const rows = [rowWith([
      { slug: "value-chain", name: "VALUE-CHAIN", isFolder: true },
      { slug: "product-tattoo-idp", name: "product-TATTOO-idp", isFolder: false },
      { slug: "ce-transport", name: "CE-TRANSPORT", isFolder: true },
    ])];
    attachProjectGrain(rows);
    expect(rows[0]!._product).toBe("product-TATTOO-idp");
    expect(rows[0]!._supportGroup).toBe("CE-TRANSPORT");
  });

  it("falls back for a row written before projects_json existed", () => {
    // owner_path is the folder bag this register has always stored; owner_project is the
    // only grain a SEALED EPISODE carries at all.
    const rows = [bare({
      projects_json: null,
      owner_project: "product-legacy",
      owner_path: "CE-TRANSPORT / VALUE-CHAIN",
    })];
    attachProjectGrain(rows);
    expect(rows[0]!._product).toBe("product-legacy");
    expect(rows[0]!._supportGroup).toBe("CE-TRANSPORT");
  });

  it("THE PRODUCT FALLBACK REFUSES A SUPPORT GROUP — the case it can prove is wrong", () => {
    // `owner_project` held a support group for any row where Wiz reported one as a leaf ahead
    // of the product. Taking it would put a support group in a field named "product" and rank
    // it against real products in every breakdown — the exact defect this change removes.
    const rows = [bare({ projects_json: null, owner_project: "CE-TRANSPORT", owner_path: null })];
    attachProjectGrain(rows);
    expect(rows[0]!._product).toBeUndefined();
    // …and the same value still answers the support-group question, which it IS.
    expect(rows[0]!._supportGroup).toBeUndefined(); // owner_path is where that one reads from
  });

  it("but it does NOT require the product- marker — a repo outside the convention answers", () => {
    const rows = [bare({ projects_json: null, owner_project: "checkout-svc", owner_path: null })];
    attachProjectGrain(rows);
    expect(rows[0]!._product).toBe("checkout-svc");
  });

  it("leaves the key ABSENT where nothing answers — never a placeholder owner", () => {
    const rows = [bare({ projects_json: null, owner_project: null, owner_path: null })];
    attachProjectGrain(rows);
    expect("_product" in rows[0]!).toBe(false);
    expect("_supportGroup" in rows[0]!).toBe(false);
  });

  it("the org-wide connector tag reaches neither grain — parseProjects dropped it first", () => {
    const rows = [rowWith([
      { slug: "github-dktunited", name: "GITHUB-DKTUNITED", isFolder: false },
      { slug: "ce-transport", name: "CE-TRANSPORT", isFolder: true },
      { slug: "product-a", name: "product-a", isFolder: false },
    ])];
    attachProjectGrain(rows);
    expect(rows[0]!._product).toBe("product-a");
    expect(rows[0]!._supportGroup).toBe("CE-TRANSPORT");
  });
});
