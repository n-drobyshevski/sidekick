// Every fixture below is hand-computed in the comment beside it, not just asserted — the
// point of rankStats.ts is that its numbers can be checked by hand, so the tests have to be
// checkable by hand too.

import { describe, expect, it } from "vitest";
import {
  bootstrapCI,
  cohensKappa,
  effectiveCardinality,
  kendallTauB,
  tieRate,
} from "../src/domain/rankStats";

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
    // ones), which is the whole point: the outlier barely moves the estate off "constant".
    expect(effectiveCardinality([1, 1, 1, 1, 2])).toBeCloseTo(1.649385, 5);
  });

  it("is 0 for an empty list", () => {
    expect(effectiveCardinality([])).toBe(0);
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
