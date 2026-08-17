// The posture rule as a configurable object: tier cascade, coercion, validation, cell
// accounting, and the lattice-vs-estate diagnostic — the structural port of
// problemRule.test.ts onto posture.ts's 27-cell lattice instead of the 54-leaf tree.

import { describe, expect, it } from "vitest";
import { decidePosture, enumeratePostureVectors, type PostureVector } from "../src/domain/posture";
import {
  cellCoverage,
  cleanPostureRule,
  DEFAULT_POSTURE_RULE,
  MAX_TIER_RULES,
  postureDiscrimination,
  postureRuleSummary,
  shadowedTierRules,
  tierEqual,
  unreachableTierRules,
  validatePostureRule,
  type PostureRule,
  type TierRule,
} from "../src/domain/postureRule";

function tuned(over: Partial<PostureRule>): PostureRule {
  return cleanPostureRule({ ...DEFAULT_POSTURE_RULE, ...over });
}

// ------------------------------------------------------------------------ cleanPostureRule

describe("cleanPostureRule", () => {
  it("leaves the defaults untouched", () => {
    expect(cleanPostureRule(DEFAULT_POSTURE_RULE)).toEqual(DEFAULT_POSTURE_RULE);
  });

  it("returns the spec rule for junk rather than a broken one", () => {
    for (const junk of [null, undefined, 7, "nope", [], {}]) {
      expect(cleanPostureRule(junk)).toEqual(DEFAULT_POSTURE_RULE);
    }
  });

  it("drops unknown axis keys and unknown axis values from a `when`", () => {
    const r = cleanPostureRule({
      ...DEFAULT_POSTURE_RULE,
      tierRules: [{ when: { capability: "BROAD", speed: "FAST", consequence: "SPICY" }, tier: 4 }],
    });
    expect(r.tierRules).toEqual([{ when: { capability: "BROAD" }, tier: 4 }]);
  });

  it("keeps the trifecta boolean legs on round trip", () => {
    const r = cleanPostureRule(DEFAULT_POSTURE_RULE);
    expect(r.tierRules[0]!.when).toEqual({
      privateData: true, untrustedIngress: true, externalEgress: true,
    });
  });

  it("an unreadable tier falls back to the RULE'S OWN cleaned fallbackTier", () => {
    const r = cleanPostureRule({
      ...DEFAULT_POSTURE_RULE,
      fallbackTier: 3,
      tierRules: [{ when: { consequence: "LIMITED" }, tier: "NONSENSE" }],
    });
    expect(r.tierRules[0]!.tier).toBe(3);
  });

  it("caps the cascade at MAX_TIER_RULES", () => {
    const many: TierRule[] = Array.from({ length: MAX_TIER_RULES + 10 }, () => ({ when: {}, tier: 2 }));
    expect(cleanPostureRule({ ...DEFAULT_POSTURE_RULE, tierRules: many }).tierRules).toHaveLength(
      MAX_TIER_RULES,
    );
  });

  it("clamps topTierCeiling into the practical (0, 1] range", () => {
    expect(cleanPostureRule({ ...DEFAULT_POSTURE_RULE, topTierCeiling: 4 }).topTierCeiling).toBe(1);
    expect(cleanPostureRule({ ...DEFAULT_POSTURE_RULE, topTierCeiling: 0 }).topTierCeiling).toBeGreaterThan(0);
    expect(cleanPostureRule({ ...DEFAULT_POSTURE_RULE, topTierCeiling: -1 }).topTierCeiling).toBeGreaterThan(0);
    expect(cleanPostureRule({ ...DEFAULT_POSTURE_RULE, topTierCeiling: "nope" }).topTierCeiling).toBe(
      DEFAULT_POSTURE_RULE.topTierCeiling,
    );
  });

  it("a tier out of {1,2,3,4} falls back rather than being coerced", () => {
    const r = cleanPostureRule({
      ...DEFAULT_POSTURE_RULE,
      tierRules: [{ when: {}, tier: 7 }],
      fallbackTier: 1,
    });
    expect(r.tierRules[0]!.tier).toBe(1);
  });
});

// --------------------------------------------------------------------------- cellCoverage

describe("cellCoverage — the 27-cell lattice, computed, not hardcoded", () => {
  it("totals exactly 27, computed from the axis value lists", () => {
    expect(enumeratePostureVectors().length).toBe(27);
    expect(cellCoverage(DEFAULT_POSTURE_RULE).total).toBe(27);
  });

  it("every cell is claimed exactly once — byRow plus byFallback partitions the 27", () => {
    const coverage = cellCoverage(DEFAULT_POSTURE_RULE);
    const rowSum = coverage.byRow.reduce((a, b) => a + b, 0);
    expect(rowSum + coverage.byFallback).toBe(coverage.total);
    const tierSum = Object.values(coverage.byTier).reduce((a, b) => a + b, 0);
    expect(tierSum).toBe(coverage.total);
  });

  it("DEFAULT_POSTURE_RULE's exact distribution, reported and pinned — not tuned to look good", () => {
    const coverage = cellCoverage(DEFAULT_POSTURE_RULE);
    // Computed by walking all 27 leaves through decidePosture — see postureRule.ts's
    // DEFAULT_POSTURE_RULE comment for the algebra and the instruction this reports rather
    // than adjusts the shape.
    expect(coverage.byTier).toEqual({ 1: 2, 2: 18, 3: 6, 4: 1 });
    // The lethal-trifecta row (index 0) claims nothing; row 1 (BROAD+WEAK+SEVERE) is the
    // real tier-4 row and claims exactly the one leaf it names.
    expect(coverage.byRow[0]).toBe(0);
    expect(coverage.byRow[1]).toBe(1);
    expect(coverage.byFallback).toBe(6);

    const tier4Share = coverage.byTier[4] / coverage.total;
    expect(tier4Share).toBeCloseTo(1 / 27, 12);
    // eslint-disable-next-line no-console
    console.log(
      `[postureRule] DEFAULT_POSTURE_RULE cell distribution: tier4=${coverage.byTier[4]}, ` +
        `tier3=${coverage.byTier[3]}, tier2=${coverage.byTier[2]}, tier1=${coverage.byTier[1]} ` +
        `of ${coverage.total} (tier4 share ${(tier4Share * 100).toFixed(1)}%)`,
    );
  });

  it("moving a row above another changes which one claims a shared leaf", () => {
    const reordered = tuned({
      tierRules: [{ when: { consequence: "SEVERE" }, tier: 1 }, ...DEFAULT_POSTURE_RULE.tierRules],
    });
    const vector: PostureVector = { capability: "BROAD", containment: "WEAK", consequence: "SEVERE" };
    expect(decidePosture(vector, DEFAULT_POSTURE_RULE).tier).toBe(4);
    expect(decidePosture(vector, reordered).tier).toBe(1);
  });
});

// -------------------------------------------------------------------- validatePostureRule

describe("validatePostureRule", () => {
  it("passes the defaults", () => {
    expect(validatePostureRule(DEFAULT_POSTURE_RULE)).toEqual([]);
  });

  it("reports an empty cascade", () => {
    expect(validatePostureRule(tuned({ tierRules: [] })).join(" ")).toContain("no rules");
  });

  it("reports a non-last empty `when` — it would swallow every rule after it", () => {
    const rule = tuned({
      tierRules: [{ when: {}, tier: 2 }, { when: { capability: "BROAD" }, tier: 4 }],
    });
    expect(validatePostureRule(rule).join(" ")).toContain("swallows");
  });

  it("allows an empty `when` as the conceptually-last row", () => {
    const rule = tuned({
      tierRules: [{ when: { capability: "BROAD" }, tier: 3 }, { when: {}, tier: 2 }],
    });
    expect(validatePostureRule(rule)).toEqual([]);
  });

  it("rejects a duplicate `when`", () => {
    const rule = tuned({
      tierRules: [
        { when: { capability: "BROAD" }, tier: 4 },
        { when: { capability: "BROAD" }, tier: 2 },
      ],
    });
    expect(validatePostureRule(rule).join(" ")).toContain("repeats");
  });

  it("reports top-tier mass when tier 4's cell share exceeds topTierCeiling", () => {
    const rule = tuned({ tierRules: [{ when: {}, tier: 4 }], topTierCeiling: 0.15 });
    const errors = validatePostureRule(rule);
    expect(errors.join(" ")).toContain("27 cells to tier 4");
    expect(errors.join(" ")).toContain("ceiling");
  });

  it("does not report top-tier mass when tier 4 stays within the ceiling", () => {
    const rule = tuned({ topTierCeiling: 0.5 });
    expect(validatePostureRule(rule).some((e) => e.includes("ceiling"))).toBe(false);
  });
});

// ----------------------------------------------------------------------- shadowedTierRules

describe("shadowedTierRules", () => {
  it("finds none in the defaults — every reachable row can fire", () => {
    expect(shadowedTierRules(DEFAULT_POSTURE_RULE)).toEqual([]);
  });

  it("does NOT flag the lethal-trifecta row — it claims zero leaves, a different failure", () => {
    expect(shadowedTierRules(DEFAULT_POSTURE_RULE)).not.toContain(0);
  });

  it("flags a row every one of whose leaves an earlier row already claims", () => {
    const rule = tuned({
      tierRules: [
        { when: { capability: "BROAD" }, tier: 3 },
        // Every BROAD+WEAK leaf is already inside "capability: BROAD" above.
        { when: { capability: "BROAD", containment: "WEAK" }, tier: 4 },
        { when: {}, tier: 2 },
      ],
    });
    expect(shadowedTierRules(rule)).toEqual([1]);
  });

  it("does not flag the same row moved ABOVE the broader one", () => {
    const rule = tuned({
      tierRules: [
        { when: { capability: "BROAD", containment: "WEAK" }, tier: 4 },
        { when: { capability: "BROAD" }, tier: 3 },
        { when: {}, tier: 2 },
      ],
    });
    expect(shadowedTierRules(rule)).toEqual([]);
  });
});

// -------------------------------------------------------------------- unreachableTierRules

describe("unreachableTierRules", () => {
  it("flags exactly the lethal-trifecta row in the defaults", () => {
    expect(unreachableTierRules(DEFAULT_POSTURE_RULE)).toEqual([0]);
  });

  it("flags any row naming a trifecta leg, wherever it sits", () => {
    const rule = tuned({
      tierRules: [
        { when: { capability: "BROAD" }, tier: 3 },
        { when: { untrustedIngress: true }, tier: 4 },
        { when: {}, tier: 2 },
      ],
    });
    expect(unreachableTierRules(rule)).toEqual([1]);
  });

  it("does not flag a row built entirely from the three real axes", () => {
    expect(unreachableTierRules(tuned({ tierRules: DEFAULT_POSTURE_RULE.tierRules.slice(1) }))).toEqual([]);
  });
});

// --------------------------------------------------------------------- postureRuleSummary

describe("postureRuleSummary", () => {
  it("names the row count, the tier-4 share, and the fallback", () => {
    const text = postureRuleSummary(DEFAULT_POSTURE_RULE).join(" ");
    expect(text).toContain(`${DEFAULT_POSTURE_RULE.tierRules.length} tier rules`);
    expect(text).toContain(`tier ${DEFAULT_POSTURE_RULE.fallbackTier}`);
    expect(text).toContain("1 of 27 cells");
  });

  it("names the unreachable lethal-trifecta row", () => {
    const text = postureRuleSummary(DEFAULT_POSTURE_RULE).join(" ");
    expect(text).toContain("lethal-trifecta row");
  });
});

// ---------------------------------------------------------------------------- tierEqual

describe("tierEqual", () => {
  it("ignores a moved topTierCeiling — it changes no tier", () => {
    const moved = tuned({ topTierCeiling: 0.5 });
    expect(tierEqual(DEFAULT_POSTURE_RULE, moved)).toBe(true);
  });

  it("sees a change to the tier cascade", () => {
    const changed = tuned({ fallbackTier: 3 });
    expect(tierEqual(DEFAULT_POSTURE_RULE, changed)).toBe(false);
  });
});

// ----------------------------------------------------------------------- postureDiscrimination

describe("postureDiscrimination", () => {
  it("partitions a decided population by tier, zeros kept", () => {
    const decided = enumeratePostureVectors().map((vector) => {
      const { tier } = decidePosture(vector, DEFAULT_POSTURE_RULE);
      return { tier, vector, unknowns: [] as string[] };
    });
    const d = postureDiscrimination(decided);
    expect(d.tierOccupancy).toEqual({ 1: 2, 2: 18, 3: 6, 4: 1 });
    expect(d.cellsReached).toBe(27);
  });

  it("reports per-axis unknown rates over a population with gaps", () => {
    const decided = [
      { tier: 2 as const, vector: { capability: "MINIMAL", containment: "PARTIAL", consequence: "LIMITED" } as PostureVector, unknowns: ["capability"] },
      { tier: 2 as const, vector: { capability: "MINIMAL", containment: "PARTIAL", consequence: "LIMITED" } as PostureVector, unknowns: [] },
    ];
    const d = postureDiscrimination(decided);
    expect(d.unknownRate.capability).toBeCloseTo(0.5, 12);
    expect(d.unknownRate.containment).toBe(0);
  });
});
