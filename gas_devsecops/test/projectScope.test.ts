// src/domain/projectScope.ts — the project catalogue and membership predicate.
//
// This module is the data foundation for a later app-header project-scope selector; there is
// no UI here to test, only the pure functions a later package will build on: parsing the
// projects_json column (reconcile.ts's projectsListJson, P1), folding it into a catalogue, and
// the single membership predicate every scoped view is meant to share.

import { describe, expect, it } from "vitest";
import { projectsListJson } from "../src/domain/reconcile";
import {
  inProject,
  parseProjects,
  projectCatalogue,
  unattributedCount,
  type ProjectRef,
} from "../src/domain/projectScope";

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
