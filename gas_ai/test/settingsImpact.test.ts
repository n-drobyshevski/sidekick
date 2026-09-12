// The register-scope cube, the rank term-coverage counts, and the dated candidate figures —
// the domain layer P9 adds beside registerScope.ts and rank.ts. See settingsImpact.ts's own
// header for the thesis; this file is where its claims get checked against numbers.

import { describe, expect, it } from "vitest";
import {
  buildCategoryCube,
  categoryDroppedOnlyCount,
  categoryMarginalCount,
  categoryMaskOf,
  categoryScopeImpact,
  categoryUnionCount,
  DEFAULT_CANDIDATE_IDS,
  termCoverageOf,
  type CategoryCube,
} from "../src/domain/settingsImpact";
import { CANDIDATE_CATEGORIES } from "../src/domain/registerScope";

describe("categoryMaskOf", () => {
  const ids = ["a", "b", "c"];

  it("sets one bit per recognised stamp", () => {
    expect(categoryMaskOf(["a"], ids)).toBe(0b001);
    expect(categoryMaskOf(["b"], ids)).toBe(0b010);
    expect(categoryMaskOf(["a", "c"], ids)).toBe(0b101);
  });

  it("drops stamps outside the candidate list rather than throwing", () => {
    expect(categoryMaskOf(["a", "unknown-custom-id"], ids)).toBe(0b001);
    expect(categoryMaskOf(["unknown-custom-id"], ids)).toBe(0);
  });

  it("is 0 for an absent or empty stamp list", () => {
    expect(categoryMaskOf(undefined, ids)).toBe(0);
    expect(categoryMaskOf([], ids)).toBe(0);
  });
});

describe("buildCategoryCube", () => {
  const ids = ["a", "b", "c"];
  const rows = [
    { categories: ["a"] },
    { categories: ["a", "b"] },
    { categories: ["b"] },
    { categories: [] },
    { categories: ["a"] },
  ];

  it("counts total as every row handed in, regardless of stamp", () => {
    expect(buildCategoryCube(rows, ids, []).total).toBe(rows.length);
  });

  it("buckets by exact stamp mask, summing rows that share one", () => {
    const cube = buildCategoryCube(rows, ids, []);
    expect(cube.cells[String(0b001)]).toBe(2); // two lone "a" rows
    expect(cube.cells[String(0b011)]).toBe(1); // the "a"+"b" row
    expect(cube.cells[String(0b010)]).toBe(1); // the lone "b" row
    expect(cube.cells[String(0)]).toBe(1); // the unstamped row
  });

  it("measuredCandidateIds is the union of configured and observed, never a subset of either alone", () => {
    // "c" is configured but zero rows carry it — still measured, because configuration alone
    // is enough to answer "collected, and the answer is zero".
    const cube = buildCategoryCube(rows, ids, ["c"]);
    expect(cube.measuredCandidateIds).toEqual(expect.arrayContaining(["a", "b", "c"]));
    expect(cube.measuredCandidateIds).toHaveLength(3);
  });

  it("a candidate neither configured nor observed is absent from measuredCandidateIds", () => {
    const cube = buildCategoryCube([{ categories: ["a"] }], ["a", "never-collected"], ["a"]);
    expect(cube.measuredCandidateIds).toEqual(["a"]);
  });

  it("a stamp outside the candidate list still counts toward total, under mask 0", () => {
    const cube = buildCategoryCube([{ categories: ["outside"] }], ids, []);
    expect(cube.total).toBe(1);
    expect(cube.cells[String(0)]).toBe(1);
  });
});

describe("categoryUnionCount / categoryMarginalCount / categoryDroppedOnlyCount", () => {
  // Hand-built cube: candidates a=0, b=1, c=2.
  //   mask 0b001 (a only):        10 rows
  //   mask 0b010 (b only):         5 rows
  //   mask 0b011 (a and b):        3 rows
  //   mask 0b100 (c only):         7 rows
  //   mask 0b000 (none):           2 rows
  const cube: CategoryCube = {
    total: 27,
    cells: { "1": 10, "2": 5, "3": 3, "4": 7, "0": 2 },
    candidateIds: ["a", "b", "c"],
    measuredCandidateIds: ["a", "b", "c"],
  };

  it("marginal counts every row carrying that bit, across masks", () => {
    expect(categoryMarginalCount(cube, 0)).toBe(10 + 3); // a-only + a&b
    expect(categoryMarginalCount(cube, 1)).toBe(5 + 3); // b-only + a&b
    expect(categoryMarginalCount(cube, 2)).toBe(7);
  });

  it("union counts a row once even when it carries two selected stamps — the case marginals cannot give", () => {
    // a OR b: 10 + 5 + 3 = 18, NOT (a-marginal 13) + (b-marginal 8) = 21.
    expect(categoryUnionCount(cube, [0, 1])).toBe(18);
    expect(categoryUnionCount(cube, [0, 1])).not.toBe(
      categoryMarginalCount(cube, 0) + categoryMarginalCount(cube, 1),
    );
  });

  it("an empty selection is zero rows in scope, not the whole register", () => {
    expect(categoryUnionCount(cube, [])).toBe(0);
  });

  it("dropped-only counts rows in the dropped set and NOT in the kept set", () => {
    // Kept = {c}, dropped = {a, b}: rows stamped ONLY a and/or b, with no c stamp.
    // That is mask 1, 2, 3 (a, b, a&b) = 10 + 5 + 3 = 18. Mask 0 (no candidate stamp at all)
    // is NOT in the dropped set either — it was never stamped with a dropped category.
    expect(categoryDroppedOnlyCount(cube, [2], [0, 1])).toBe(18);
  });

  it("a row stamped with a dropped AND a still-kept candidate is not counted as dropped-only", () => {
    // Kept = {b}, dropped = {a}: mask 1 (a-only) counts; mask 3 (a&b) does not, because b
    // (kept) is still stamped on it and a re-fetch under {b} alone would still return it.
    expect(categoryDroppedOnlyCount(cube, [1], [0])).toBe(10);
  });
});

describe("categoryScopeImpact", () => {
  const cube: CategoryCube = {
    total: 20,
    cells: { "1": 8, "2": 4, "3": 2, "4": 6 },
    candidateIds: ["a", "b", "c"],
    measuredCandidateIds: ["a", "b", "c"],
  };

  it("bundles in-scope, per-category and dropped-only together, keyed by id not index", () => {
    const impact = categoryScopeImpact(cube, ["b"], ["a", "b"]);
    expect(impact.inScopeOpen).toBe(categoryUnionCount(cube, [1]));
    expect(impact.perCategory).toEqual({
      a: categoryMarginalCount(cube, 0),
      b: categoryMarginalCount(cube, 1),
      c: categoryMarginalCount(cube, 2),
    });
    expect(impact.droppedOnlyOpen).toBe(categoryDroppedOnlyCount(cube, [1], [0]));
  });

  it("defaults previousIds to selectedIds, so a fresh draft drops nothing", () => {
    expect(categoryScopeImpact(cube, ["a", "c"]).droppedOnlyOpen).toBe(0);
  });

  it("an id outside candidateIds contributes to neither side rather than throwing", () => {
    const impact = categoryScopeImpact(cube, ["a", "not-a-candidate"], ["a"]);
    expect(impact.inScopeOpen).toBe(categoryUnionCount(cube, [0]));
  });
});

describe("termCoverageOf", () => {
  it("counts the rule term as every row, unconditionally", () => {
    const rows = [{}, { dueAt: "2026-01-01" }, { exploitationTier: "kev" }];
    expect(termCoverageOf(rows).rule).toBe(rows.length);
    expect(termCoverageOf(rows).total).toBe(rows.length);
  });

  it("counts dueAt and createdAt separately, not as a union", () => {
    const rows = [
      { dueAt: "2026-01-01" }, // dueAt only
      { createdAt: "2025-06-01" }, // createdAt only
      { dueAt: "2026-02-01", createdAt: "2025-01-01" }, // both
      {}, // neither
    ];
    const coverage = termCoverageOf(rows);
    expect(coverage.time.dueAt).toBe(2); // rows 1 and 3
    expect(coverage.time.createdAt).toBe(2); // rows 2 and 3
  });

  it("an unparseable date string does not count as measured", () => {
    const rows = [{ dueAt: "not-a-date" }, { dueAt: "" }, { dueAt: "2026-03-01" }];
    expect(termCoverageOf(rows).time.dueAt).toBe(1);
  });

  it("exploitation is measured for kev/exploit/epss/none but not unknown or absent", () => {
    const rows = [
      { exploitationTier: "kev" },
      { exploitationTier: "exploit" },
      { exploitationTier: "epss" },
      { exploitationTier: "none" },
      { exploitationTier: "unknown" },
      {},
    ];
    expect(termCoverageOf(rows).exploitation).toBe(4);
  });

  it("adjacency is measured whenever aiAdjacency is present, UNLINKED included", () => {
    const rows = [
      { aiAdjacency: "DIRECT" },
      { aiAdjacency: "ADJACENT" },
      { aiAdjacency: "UNLINKED" },
      {},
    ];
    expect(termCoverageOf(rows).adjacency).toBe(3);
  });

  it("an empty queue measures nothing, honestly — zeros, not a divide-by-zero surprise", () => {
    expect(termCoverageOf([])).toEqual({
      total: 0, rule: 0, time: { dueAt: 0, createdAt: 0 }, exploitation: 0, adjacency: 0,
    });
  });
});

describe("the dated candidate figures, as data", () => {
  it("every CANDIDATE_CATEGORIES entry carries its provenance beside its count", () => {
    for (const c of CANDIDATE_CATEGORIES) {
      expect(Number.isInteger(c.count) && c.count > 0).toBe(true);
      expect(Number.isFinite(Date.parse(c.measuredAt))).toBe(true);
      expect(c.measuredScope.length).toBeGreaterThan(0);
    }
  });

  it("DEFAULT_CANDIDATE_IDS mirrors CANDIDATE_CATEGORIES's own order", () => {
    expect(DEFAULT_CANDIDATE_IDS).toEqual(CANDIDATE_CATEGORIES.map((c) => c.id));
  });

  it("every candidate's count is the SAME dated fact everywhere it appears — never mixed between candidates", () => {
    const byId = new Map(CANDIDATE_CATEGORIES.map((c) => [c.id, c]));
    for (const c of CANDIDATE_CATEGORIES) {
      expect(byId.get(c.id)!.measuredAt).toBe(c.measuredAt);
    }
  });
});
