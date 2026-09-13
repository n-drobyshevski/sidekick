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
  buildRankCube,
  parseRankTupleKey,
  rankCubeTauB,
  rankCubeTopN,
  rankRowsMovedBeyond,
  rankScoreHistogram,
  rankTupleKey,
  rankTupleOf,
  scoreFromTuple,
  type CategoryCube,
  type RankCube,
  type RankCubeRule,
} from "../src/domain/settingsImpact";
import { CANDIDATE_CATEGORIES } from "../src/domain/registerScope";
import {
  cleanRankRule, DEFAULT_RANK_RULE, rankAll, RANK_PRESET_V2, type RankInput, type RankRule,
} from "../src/domain/rank";
import { kendallTauB } from "../src/domain/rankStats";

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

// ================================================================================== P11: rank
// cube — pinned against rank.ts's own rankOne, and against rankStats.kendallTauB.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = "2026-09-13T09:00:00Z";
const NOW_MS = Date.parse(NOW);
const RULE_IDS = Array.from({ length: 40 }, (_, i) => `rule-${i}`);
const TIERS = ["kev", "exploit", "epss", "none", "unknown", undefined] as const;
const ADJACENCIES = ["DIRECT", "ADJACENT", "UNLINKED", undefined] as const;

/** A realistic-shaped population: some rows undated on one or both clocks, every exploitation
 *  tier and adjacency reading represented, EPSS peaks spanning the full range including the
 *  exact bin edges and both `null` (uncaptured) and absent. */
function population(n: number, seed: number): RankInput[] {
  const rng = mulberry32(seed);
  const rows: RankInput[] = [];
  for (let i = 0; i < n; i++) {
    const tier = TIERS[Math.floor(rng() * TIERS.length)];
    rows.push({
      id: `row-${i}`,
      ruleId: RULE_IDS[Math.floor(rng() * RULE_IDS.length)],
      dueAt: rng() < 0.6
        ? new Date(NOW_MS + (rng() * 800 - 400) * 86400000).toISOString()
        : undefined,
      createdAt: rng() < 0.9
        ? new Date(NOW_MS - rng() * 700 * 86400000).toISOString()
        : undefined,
      exploitationTier: tier,
      epssPeak: tier === "epss" ? (rng() < 0.1 ? null : Math.round(rng() * 100) / 100) : null,
      aiAdjacency: ADJACENCIES[Math.floor(rng() * ADJACENCIES.length)],
    });
  }
  return rows;
}

/** A rule shaped the way `effectiveRankRule()` actually produces one: `rankWeightFor`'s table
 *  covers a THIRD of the rule ids (the `rankRuleFromExploitation` maturity ladder — at most
 *  four distinct weight values in practice), the rest fall to `defaultRuleWeight`. */
function cubeBuildRule(overrides: Partial<RankRule> = {}): RankRule {
  return cleanRankRule({
    ...RANK_PRESET_V2,
    ruleWeights: [
      { ruleId: RULE_IDS[0]!, weight: 1 },
      { ruleId: RULE_IDS[1]!, weight: 1 },
      { ruleId: RULE_IDS[2]!, weight: 0.8 },
      { ruleId: RULE_IDS[3]!, weight: 0.8 },
      { ruleId: RULE_IDS[4]!, weight: 0.6 },
      { ruleId: RULE_IDS[5]!, weight: 0.6 },
    ],
    defaultRuleWeight: 0.5,
    ...overrides,
  });
}

/** The five draft-editable fields, off a full `RankRule` — everything `scoreFromTuple` reads. */
function draftOf(rule: RankRule): RankCubeRule {
  return {
    shares: rule.shares,
    timeSource: rule.timeSource,
    exploitationWeights: rule.exploitationWeights,
    adjacencyWeights: rule.adjacencyWeights,
    epssThreshold: rule.epssThreshold,
  };
}

const ROWS = population(600, 20260913);
const BUILD_RULE = cubeBuildRule();
const CUBE = buildRankCube(ROWS, BUILD_RULE, NOW);

// Every draft this settings panel can actually produce: the four shares, both clock sources,
// both weight tables, and the EPSS threshold swept across bin edges — `ruleWeights` and both
// day-bucket ladders are NEVER varied here, because this panel never edits them either.
const DRAFT_VARIANTS: Array<Partial<RankRule>> = [
  {},
  { timeSource: "dueAtOnly" },
  { shares: { rule: 1, time: 0, exploitation: 0, adjacency: 0 } },
  { shares: { rule: 0, time: 1, exploitation: 0, adjacency: 0 } },
  { shares: { rule: 0, time: 0, exploitation: 1, adjacency: 0 } },
  { shares: { rule: 0, time: 0, exploitation: 0, adjacency: 1 } },
  { shares: { rule: 0.1, time: 0.4, exploitation: 0.2, adjacency: 0.3 } },
  { epssThreshold: 0 },
  { epssThreshold: 1 },
  { epssThreshold: 0.07 },
  { epssThreshold: 0.29 },
  { exploitationWeights: { kev: 0.9, exploit: 0.5, epss: 0.3, none: 0.1 } },
  { adjacencyWeights: { DIRECT: 0.95, ADJACENT: 0.5, UNLINKED: 0.05 } },
];

describe("rankTupleOf / scoreFromTuple agree with rankOne, over every draft this panel can produce", () => {
  for (const variant of DRAFT_VARIANTS) {
    it(`scores identically under ${JSON.stringify(variant)}`, () => {
      const rule = cleanRankRule({ ...BUILD_RULE, ...variant });
      const scored = rankAll(ROWS, rule, NOW);
      ROWS.forEach((row, i) => {
        const tuple = rankTupleOf(row, BUILD_RULE, NOW);
        const cubeScore = scoreFromTuple(tuple, draftOf(rule), CUBE);
        expect(cubeScore, `row ${i}`).toBe(scored[i]!.score);
      });
    });
  }

  it("round-trips a tuple through its own key", () => {
    for (const row of ROWS.slice(0, 50)) {
      const tuple = rankTupleOf(row, BUILD_RULE, NOW);
      expect(parseRankTupleKey(rankTupleKey(tuple))).toEqual(tuple);
    }
  });

  it("an unrecognised or absent exploitation tier is unmeasured, never `none`", () => {
    const t1 = rankTupleOf({ exploitationTier: "unknown" }, BUILD_RULE, NOW);
    const t2 = rankTupleOf({}, BUILD_RULE, NOW);
    expect(t1.exploitationTier).toBe("unmeasured");
    expect(t2.exploitationTier).toBe("unmeasured");
  });

  it("an `epss` tier with no captured peak reads as `none` — it can never clear a threshold", () => {
    const tuple = rankTupleOf({ exploitationTier: "epss", epssPeak: null }, BUILD_RULE, NOW);
    expect(tuple.exploitationTier).toBe("none");
    expect(tuple.epssBin).toBeNull();
  });

  it("an absent adjacency is unmeasured, distinct from the measured UNLINKED reading", () => {
    expect(rankTupleOf({}, BUILD_RULE, NOW).adjacency).toBe("unmeasured");
    expect(rankTupleOf({ aiAdjacency: "UNLINKED" }, BUILD_RULE, NOW).adjacency).toBe("UNLINKED");
  });
});

describe("rankScoreHistogram", () => {
  it("every row lands in exactly one bucket", () => {
    const hist = rankScoreHistogram(CUBE, draftOf(BUILD_RULE), 20);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(CUBE.total);
  });

  it("a perfect score (1.0) folds into the top bucket, not off the end", () => {
    const rule = draftOf(cleanRankRule({
      ...DEFAULT_RANK_RULE, shares: { rule: 1, time: 0, exploitation: 0, adjacency: 0 },
    }));
    const oneRowCube = buildRankCube([{ ruleId: "x" }], cleanRankRule({
      ...DEFAULT_RANK_RULE, defaultRuleWeight: 1,
    }), NOW);
    const hist = rankScoreHistogram(oneRowCube, rule, 10);
    expect(hist[9]).toBe(1);
  });
});

describe("rankRowsMovedBeyond", () => {
  it("agrees with a brute-force per-row diff", () => {
    const ruleA = draftOf(BUILD_RULE);
    const ruleB = draftOf(cleanRankRule({ ...BUILD_RULE, timeSource: "dueAtElseAge" }));
    const threshold = 0.1;
    const scoredA = rankAll(ROWS, BUILD_RULE, NOW);
    const scoredB = rankAll(ROWS, cleanRankRule({ ...BUILD_RULE, timeSource: "dueAtElseAge" }), NOW);
    const bruteForce = ROWS.filter(
      (_, i) => Math.abs(scoredA[i]!.score - scoredB[i]!.score) > threshold,
    ).length;
    expect(rankRowsMovedBeyond(CUBE, ruleA, ruleB, threshold)).toBe(bruteForce);
  });

  it("is 0 when the two rules are identical", () => {
    const rule = draftOf(BUILD_RULE);
    expect(rankRowsMovedBeyond(CUBE, rule, rule, 0)).toBe(0);
  });
});

describe("rankCubeTauB agrees with rankStats.kendallTauB over the expanded row list", () => {
  // Small enough to expand without O(n^2) becoming the point of the test.
  const small = population(80, 555);
  const smallCube = buildRankCube(small, BUILD_RULE, NOW);
  const ruleA = BUILD_RULE;
  const ruleB = cleanRankRule({ ...BUILD_RULE, shares: { rule: 0.1, time: 0.6, exploitation: 0.2, adjacency: 0.1 } });

  it("the tuple-with-multiplicity tau equals the fully-expanded tau", () => {
    const scoredA = rankAll(small, ruleA, NOW).map((r) => r.score);
    const scoredB = rankAll(small, ruleB, NOW).map((r) => r.score);
    const expanded = kendallTauB(scoredA, scoredB);
    const cubeTau = rankCubeTauB(smallCube, draftOf(ruleA), draftOf(ruleB));
    expect(cubeTau).toBeCloseTo(expanded, 10);
  });

  it("is 1 when the two rules produce the same order (identical rules)", () => {
    expect(rankCubeTauB(smallCube, draftOf(ruleA), draftOf(ruleA))).toBeCloseTo(1, 10);
  });

  it("is 0 on an empty or single-row cube", () => {
    const empty = buildRankCube([], BUILD_RULE, NOW);
    expect(rankCubeTauB(empty, draftOf(ruleA), draftOf(ruleB))).toBe(0);
    const one = buildRankCube([{ ruleId: "x" }], BUILD_RULE, NOW);
    expect(rankCubeTauB(one, draftOf(ruleA), draftOf(ruleB))).toBe(0);
  });
});

describe("rankCubeTopN — the range is honest about what the cube cannot see", () => {
  it("collapses to a single number (lo === hi) when nothing straddles the cut", () => {
    // Ten rows over `cubeBuildRule`'s four distinct rule weights (1, 1, 0.8, 0.8, 0.6, 0.6,
    // then four at the 0.5 default) — with only the rule share on, rows collapse into exactly
    // four SCORE bands sized 2, 2, 2, 4. `n = 4` sits exactly on the second band's boundary,
    // so every band is wholly in or wholly out under both rules — nothing straddles.
    const rows: RankInput[] = RULE_IDS.slice(0, 10).map((ruleId, i) => ({
      id: `r${i}`, ruleId, dueAt: undefined, createdAt: undefined, aiAdjacency: undefined,
    }));
    const rule = cubeBuildRule({ shares: { rule: 1, time: 0, exploitation: 0, adjacency: 0 } });
    const cube = buildRankCube(rows, rule, NOW);
    const result = rankCubeTopN(cube, draftOf(rule), draftOf(rule), 4);
    expect(result.carryOver.lo).toBe(result.carryOver.hi);
    expect(result.carryOver.lo).toBe(4);
  });

  it("reports a genuine range when a tuple's band straddles the cut under both rules", () => {
    // Ten rows sharing ONE tuple (same rule id, both clocks undated, same exploitation/
    // adjacency reading) under a rule that reads nothing but the rule term — so the whole
    // block ties on score under BOTH rules being compared, and slot 5 falls inside it.
    const rows: RankInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`, ruleId: RULE_IDS[0]!, dueAt: undefined, createdAt: undefined,
    }));
    const ruleA = cubeBuildRule({ shares: { rule: 1, time: 0, exploitation: 0, adjacency: 0 } });
    const ruleB = cubeBuildRule({
      shares: { rule: 1, time: 0, exploitation: 0, adjacency: 0 }, epssThreshold: 0.5,
    });
    const cube = buildRankCube(rows, ruleA, NOW);
    const result = rankCubeTopN(cube, draftOf(ruleA), draftOf(ruleB), 5);
    expect(result.carryOver.lo).toBeLessThan(result.carryOver.hi);
    // The achievable bounds for one 10-row tuple straddled at 5 under both orderings: at
    // least 0 could fail to overlap only if impossible here (same 5 need to come from the
    // same 10), so lo = max(0, 5+5-10) = 0 and hi = min(5,5) = 5.
    expect(result.carryOver).toEqual({ lo: 0, hi: 5 });
  });

  it("n beyond the population puts every row in top N under both rules — exact, not a range", () => {
    const result = rankCubeTopN(CUBE, draftOf(BUILD_RULE), draftOf(BUILD_RULE), CUBE.total + 100);
    expect(result.carryOver.lo).toBe(result.carryOver.hi);
    expect(result.carryOver.lo).toBe(CUBE.total);
  });

  it("n=0 carries over nothing", () => {
    const result = rankCubeTopN(CUBE, draftOf(BUILD_RULE), draftOf(BUILD_RULE), 0);
    expect(result.carryOver).toEqual({ lo: 0, hi: 0 });
  });
});

describe("cube size at a realistic-to-generous scale", () => {
  it("stays sparse and well under CacheService's 100 KB cap for thousands of rows", () => {
    const big = population(5000, 909090);
    const cube = buildRankCube(big, cubeBuildRule(), NOW);
    const cells = Object.keys(cube.cells).length;
    const bytes = JSON.stringify(cube).length;
    // Reported, not just asserted — see this package's write-up for the measured numbers.
    // eslint-disable-next-line no-console
    console.log(`rank cube @ 5000 rows: ${cells} distinct tuples, ${bytes} JSON bytes`);
    expect(cells).toBeLessThan(2000);
    expect(bytes).toBeLessThan(100_000);
  });
});
