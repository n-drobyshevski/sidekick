// Every fixture below is hand-computed in the comment beside it, not just asserted — the
// point of rankStats.ts is that its numbers can be checked by hand, so the tests have to be
// checkable by hand too.

import { describe, expect, it } from "vitest";
import {
  bootstrapCI,
  cohensKappa,
  effectiveCardinality,
  kendallTauB,
  midrankPercentiles,
  tieRate,
} from "../src/domain/rankStats";
import { DEFAULT_AARS_RULE } from "../src/domain/aars";
import { enrichGraphDoc } from "../src/domain/graphEnrich";
import { SEED_ISSUES, seedGraphDoc } from "../src/server/sampleData";

describe("kendallTauB", () => {
  it("is 1 for perfect agreement", () => {
    expect(kendallTauB([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1);
  });

  it("is -1 for perfect reversal", () => {
    expect(kendallTauB([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
  });

  it("matches a hand-worked permutation: one transposition out of three items", () => {
    // a = [1,2,3], b = [1,3,2] — swap the last two ranks.
    // Pairs (i<j): (0,1) concordant, (0,2) concordant, (1,2) discordant → C-D = 1.
    // No ties in either list: n0 = n1 = n2's tie term = 0, n0 = 3(2)/2 = 3.
    // tau_b = 1 / sqrt(3·3) = 1/3.
    expect(kendallTauB([1, 2, 3], [1, 3, 2])).toBeCloseTo(1 / 3, 12);
  });

  it("differs from the uncorrected (tau-a) value when either list has ties", () => {
    // a = [1,1,2], b = [1,2,2].
    // Pairs: (0,1) a-tied → 0; (0,2) concordant → +1; (1,2) b-tied → 0. C-D = 1.
    // n0 = 3; n1 (ties in a: one pair tied at value 1) = 1; n2 (ties in b: one pair tied
    // at value 2) = 1. tau_b = 1 / sqrt((3-1)(3-1)) = 1/2.
    // The UNCORRECTED ratio (C-D)/n0 — what tau-a computes — would instead give 1/3: the
    // tie correction is the entire difference between 0.5 and 0.333, which is the reason
    // this function exists rather than the simpler statistic.
    const tauB = kendallTauB([1, 1, 2], [1, 2, 2]);
    expect(tauB).toBeCloseTo(0.5, 12);
    expect(tauB).not.toBeCloseTo(1 / 3, 6);
  });

  it("returns 0 when a list is entirely tied — no ranking in it to compare", () => {
    expect(kendallTauB([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
    expect(kendallTauB([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0);
    expect(kendallTauB([5, 5], [5, 5])).toBe(0);
  });

  it("throws on length mismatch rather than comparing the wrong pairs", () => {
    expect(() => kendallTauB([1, 2, 3], [1, 2])).toThrow(/length mismatch/);
  });
});

describe("tieRate", () => {
  it("is 0 when every value is distinct", () => {
    expect(tieRate([1, 2, 3, 4, 5])).toBe(0);
  });

  it("is 1 when every value is identical", () => {
    expect(tieRate([7, 7, 7, 7])).toBe(1);
  });

  it("matches a hand-worked mixed case", () => {
    // [1,1,2,3,3,3]: n=6, total pairs C(6,2)=15.
    // Tied pairs: value 1 (×2) → C(2,2)=1; value 2 (×1) → 0; value 3 (×3) → C(3,2)=3.
    // tieRate = (1+0+3)/15 = 4/15.
    expect(tieRate([1, 1, 2, 3, 3, 3])).toBeCloseTo(4 / 15, 12);
  });

  it("is 0 for fewer than two values — no pairs exist", () => {
    expect(tieRate([])).toBe(0);
    expect(tieRate([1])).toBe(0);
  });
});

describe("effectiveCardinality", () => {
  it("is 1.0 for a constant list — one value, however many times it repeats", () => {
    expect(effectiveCardinality([9, 9, 9, 9, 9])).toBeCloseTo(1, 12);
  });

  it("is N for N all-distinct values", () => {
    expect(effectiveCardinality([1, 2, 3, 4, 5])).toBeCloseTo(5, 12);
  });

  it("matches a hand-worked skewed case: one outlier does not read as two values", () => {
    // [1,1,1,1,2]: p(1) = 0.8, p(2) = 0.2.
    // H = -(0.8·ln0.8 + 0.2·ln0.2) = -(-0.178515 + -0.321888) = 0.500402 nats.
    // exp(H) ≈ 1.649385 — much closer to 1 (one effective value) than to 2 (two literal
    // ones), which is the whole point: the outlier barely moves the landscape off "constant".
    expect(effectiveCardinality([1, 1, 1, 1, 2])).toBeCloseTo(1.649385, 5);
  });

  it("is 0 for an empty list", () => {
    expect(effectiveCardinality([])).toBe(0);
  });
});

describe("midrankPercentiles", () => {
  it("puts the middle of an odd all-distinct list at 50", () => {
    // Five distinct values, so each block has size 1. For the median value 3: two values
    // below, so (2 + 1/2)/5 = 0.5.
    expect(midrankPercentiles([1, 2, 3, 4, 5])[2]).toBeCloseTo(50, 12);
  });

  it("gives a constant list 50 everywhere — one block, centred, separating nothing", () => {
    // One block of 5: below = 0, so (0 + 5/2)/5 = 0.5 for every member. This is the same
    // message tieRate returns 1.0 for, and it is deliberately not 100.
    expect(midrankPercentiles([9, 9, 9, 9, 9])).toEqual([50, 50, 50, 50, 50]);
  });

  it("keeps the input's index order rather than returning a sorted list", () => {
    // The caller zips these back onto nodes by position, so alignment is the contract.
    // Sorted the list reads [10, 20, 30]; midranks are 16.667 / 50 / 83.333 by VALUE, and
    // the answer has to come back in the order the values were handed over.
    const out = midrankPercentiles([30, 10, 20]);
    expect(out[0]).toBeCloseTo(83.3333, 4);
    expect(out[1]).toBeCloseTo(16.6667, 4);
    expect(out[2]).toBeCloseTo(50, 12);
  });

  it("reproduces the seed estate's shape: one tie block, one shared percentile", () => {
    // The live-path AARS distribution over the seed landscape — 30 scored assets in five
    // blocks sized 8 / 1 / 2 / 14 / 5 at scores 0 / 22 / 29 / 72 / 76. This is the shape
    // that reproduces ruleDiscrimination's pinned tieRate 0.30 and effectiveCardinality
    // 3.67 (test/scoreOrdinality.test.ts §2), so it is the right fixture to pin here.
    //
    //   0  → (0  + 8/2)/30  = 13.333
    //   22 → (8  + 1/2)/30  = 28.333
    //   29 → (9  + 2/2)/30  = 33.333
    //   72 → (11 + 14/2)/30 = 60      ← the 14-asset block, one number, not fourteen
    //   76 → (25 + 5/2)/30  = 91.667
    const scores = [
      ...Array(8).fill(0), 22, 29, 29, ...Array(14).fill(72), ...Array(5).fill(76),
    ] as number[];
    const out = midrankPercentiles(scores);
    const byScore = new Map(scores.map((s, i) => [s, out[i]!]));

    expect(byScore.get(0)).toBeCloseTo(13.3333, 4);
    expect(byScore.get(22)).toBeCloseTo(28.3333, 4);
    expect(byScore.get(29)).toBeCloseTo(33.3333, 4);
    expect(byScore.get(72)).toBeCloseTo(60, 12);
    expect(byScore.get(76)).toBeCloseTo(91.6667, 4);

    // The claim the whole change rests on, asserted rather than described: the 14 tied
    // assets share ONE percentile. A CDF percentile would give them 86.667 — the top of
    // their own block — which reads as "these beat the five assets above them".
    const tied = out.filter((_, i) => scores[i] === 72);
    expect(tied).toHaveLength(14);
    expect(new Set(tied).size).toBe(1);
  });

  it("is 50 for a single value and empty for an empty list", () => {
    expect(midrankPercentiles([7])).toEqual([50]);
    expect(midrankPercentiles([])).toEqual([]);
  });
});

describe("cohensKappa", () => {
  it("is 1 for perfect agreement", () => {
    const cats = ["A", "B", "C"];
    expect(cohensKappa(["A", "B", "C", "A"], ["A", "B", "C", "A"], cats)).toBeCloseTo(1, 12);
  });

  it("is ~0 for chance-level agreement — a hand-worked case that lands on exactly 0", () => {
    // a = [A,A,B,B], b = [A,B,A,B]. Matches: (A,A) yes, (A,B) no, (B,A) no, (B,B) yes.
    // po = 2/4 = 0.5. Marginals are 50/50 for both codings on both categories, so
    // pe = (0.5·0.5) + (0.5·0.5) = 0.5. kappa = (0.5-0.5)/(1-0.5) = 0 exactly.
    expect(cohensKappa(["A", "A", "B", "B"], ["A", "B", "A", "B"], ["A", "B"])).toBe(0);
  });

  it("matches a hand-worked confusion matrix", () => {
    // a = [A,A,A,B,B,C], b = [A,A,B,B,C,C] — a 3-category, 6-item coding.
    // Matches: idx 0,1,3,5 → po = 4/6.
    // Marginals: a → A:3 B:2 C:1 (of 6); b → A:2 B:2 C:2 (of 6).
    // pe = (3·2 + 2·2 + 1·2) / 36 = 12/36 = 1/3.
    // kappa = (4/6 - 1/3) / (1 - 1/3) = (1/3) / (2/3) = 0.5.
    const a = ["A", "A", "A", "B", "B", "C"];
    const b = ["A", "A", "B", "B", "C", "C"];
    expect(cohensKappa(a, b, ["A", "B", "C"])).toBeCloseTo(0.5, 12);
  });

  it("returns 1 when pe is 1 — every item lands in one category under both codings", () => {
    expect(cohensKappa(["A", "A", "A"], ["A", "A", "A"], ["A"])).toBe(1);
  });

  it("throws on length mismatch", () => {
    expect(() => cohensKappa(["A"], ["A", "B"], ["A", "B"])).toThrow(/length mismatch/);
  });
});

describe("bootstrapCI — the determinism contract", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it("the same seed produces bit-identical output on separate calls", () => {
    const first = bootstrapCI(values, mean, 200, 42);
    const second = bootstrapCI(values, mean, 200, 42);
    expect(second).toEqual(first);
  });

  it("a different seed is free to move the interval, but stays inside the data's range", () => {
    const a = bootstrapCI(values, mean, 200, 1);
    const b = bootstrapCI(values, mean, 200, 2);
    for (const ci of [a, b]) {
      expect(ci.lo).toBeLessThanOrEqual(ci.hi);
      expect(ci.lo).toBeGreaterThanOrEqual(Math.min(...values));
      expect(ci.hi).toBeLessThanOrEqual(Math.max(...values));
    }
  });
});

describe("midrankPercentiles", () => {
  it("returns [] for an empty list — nothing to rank against", () => {
    expect(midrankPercentiles([])).toEqual([]);
  });

  it("gives a single value the 50th percentile — the sole reasonable reading with no peers", () => {
    // n=1: the one "tie block" spans rank [1,1], midrank 1, (1-0.5)/1*100 = 50.
    expect(midrankPercentiles([42])).toEqual([50]);
  });

  it("gives every member of an all-tied list the same 50th percentile, whatever N is", () => {
    // n=4, one block spanning ranks [1,4]: midrank (1+4)/2 = 2.5, (2.5-0.5)/4*100 = 50.
    expect(midrankPercentiles([7, 7, 7, 7])).toEqual([50, 50, 50, 50]);
    // n=3, one block spanning ranks [1,3]: midrank (1+3)/2 = 2, (2-0.5)/3*100 = 50.
    expect(midrankPercentiles([9, 9, 9])).toEqual([50, 50, 50]);
  });

  it("matches the familiar percentile-rank ladder for a clean (all-distinct) ordering", () => {
    // n=4, no ties: ranks 1,2,3,4 → (rank-0.5)/4*100 = 12.5, 37.5, 62.5, 87.5.
    expect(midrankPercentiles([10, 20, 30, 40])).toEqual([12.5, 37.5, 62.5, 87.5]);
  });

  it("preserves the CALLER's order, not sorted order", () => {
    // Same four values as above, shuffled. midrankPercentiles must zip back onto the
    // original positions, not return them sorted.
    expect(midrankPercentiles([30, 10, 40, 20])).toEqual([62.5, 12.5, 87.5, 37.5]);
  });

  it("hand-computed: a tie block in the middle shares one midrank, the untied ends do not", () => {
    // [10, 20, 20, 20, 30], n=5.
    //   10 is alone at rank 1: (1-0.5)/5*100 = 10.
    //   20 ties ranks 2-4: midrank (2+4)/2 = 3, (3-0.5)/5*100 = 50.
    //   30 is alone at rank 5: (5-0.5)/5*100 = 90.
    const result = midrankPercentiles([10, 20, 20, 20, 30]);
    expect(result).toEqual([10, 50, 50, 50, 90]);
    // Every member of the tie block shares the identical value — not merely close.
    expect(new Set(result.slice(1, 4)).size).toBe(1);
  });

  it("the tie rate this whole function exists for: the seed estate's 14-asset block at 72 "
    + "(DEFAULT_AARS_RULE, live path) all receive one identical percentile", () => {
    // Same reproduction path as test/scoreOrdinality.test.ts: `deriveAarsInput` via
    // `enrichGraphDoc`, which is where the doc-pinned largestTieGroup of 14 (tieRate 0.30,
    // 30 scored assets) comes from — the measured tie rate this file's own header cites.
    const doc = enrichGraphDoc(seedGraphDoc("T"), SEED_ISSUES, undefined, DEFAULT_AARS_RULE);
    const scored = doc.nodes.filter((n): n is typeof n & { aars: number } => typeof n.aars === "number");
    const scores = scored.map((n) => n.aars);
    const percentiles = midrankPercentiles(scores);

    const tiedAt72 = scored
      .map((n, i) => ({ id: n.id, score: n.aars, pct: percentiles[i]! }))
      .filter((x) => x.score === 72);

    // Pinned by test/scoreOrdinality.test.ts's `largestTieGroup` assertion — kept as a
    // literal here too so a change to either number is caught in both places independently.
    expect(tiedAt72.length).toBe(14);
    expect(new Set(tiedAt72.map((x) => x.pct)).size).toBe(1);
    expect(scored.length).toBe(30);
  });
});
