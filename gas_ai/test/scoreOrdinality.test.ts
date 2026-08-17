// Three experiments over the seed estate, run through the EXACT reproduction path
// ai/AARS_ASSESSMENT.md §9 documents, that turn §2's prose ("the score collapses") into
// numbers. Phase 0 of the AARS assessment plan: measure the incumbent, change nothing.
//
// All three score through the LIVE path — `deriveAarsInput` via `enrichGraphDoc(doc, issues,
// undefined, rule)` — because that is the path §2's finding is ABOUT. The demo/dry-run path
// (`SEED_AARS_HINTS`) scores differently and on purpose (graphEnrich.ts:249's comment on
// `hint`) and would understate every measurement here.

import { describe, expect, it } from "vitest";
import { AARS_V2_RULE, DEFAULT_AARS_RULE, type AarsRule } from "../src/domain/aars";
import { ruleDiscrimination, unreachableGapRules } from "../src/domain/aarsRule";
import { enrichGraphDoc } from "../src/domain/graphEnrich";
import { kendallTauB } from "../src/domain/rankStats";
import { SEED_AARS_HINTS, SEED_ISSUES, seedGraphDoc } from "../src/server/sampleData";

/** The live path, exactly as ai/AARS_ASSESSMENT.md §9 reproduces it. */
function liveDoc(rule: AarsRule) {
  return enrichGraphDoc(seedGraphDoc("T"), SEED_ISSUES, undefined, rule);
}

/**
 * Score vectors are compared pairwise between two rule runs, so they must be read off in a
 * STABLE order shared by both runs — sorted node id — or a difference in map/array iteration
 * order between the two `enrichGraphDoc` calls could masquerade as a ranking change.
 */
function scoreVector(nodes: ReadonlyArray<{ id: string; aars?: number }>, ids: string[]): number[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return ids.map((id) => byId.get(id)!.aars!);
}

const baseDoc = liveDoc(DEFAULT_AARS_RULE);
const scoredIds = baseDoc.nodes
  .filter((n) => typeof n.aars === "number")
  .map((n) => n.id)
  .sort();
const baseline = scoreVector(baseDoc.nodes, scoredIds);

describe("1. monotone re-encoding of severity points", () => {
  // 60 > 30 > 12 > 1 preserves the DEFAULT rule's order (50 > 35 > 20 > 8) exactly — every
  // severity keeps its rank, only the numeric gap between ranks changes. An ordinal input
  // re-encoded this way carries no information a rank-based model wasn't already using, so
  // if the OUTPUT ranking moves, the movement was produced by something other than the
  // ordinal severity input — e.g. how it interacts with the OTHER pillars' fixed points
  // through the pillar caps and the final 0–100 clamp, which do not scale with it.
  const reencoded: AarsRule = {
    ...DEFAULT_AARS_RULE,
    severityPoints: { CRITICAL: 60, HIGH: 30, MEDIUM: 12, LOW: 1 },
  };

  it("does not preserve the score ranking — tau-b < 1, measured and logged", () => {
    const reencodedDoc = liveDoc(reencoded);
    const after = scoreVector(reencodedDoc.nodes, scoredIds);
    const tau = kendallTauB(baseline, after);
    console.log(`[scoreOrdinality] monotone re-encoding tau-b = ${tau}`);

    // The experiment REPRODUCED: tau came out below 1, so the re-encoding measurably moved
    // the ranking. Per the plan, if it had come out exactly 1 this assertion would instead
    // record the value and assert `<= 1` with a comment that a wider re-encoding sweep is
    // needed — that fallback was not required here.
    expect(tau).toBeLessThan(1);
    expect(tau).toBeGreaterThanOrEqual(-1);
  });
});

describe("2. pillar ablation", () => {
  // Pillar D is not included: `exposurePoints` is all-zero in DEFAULT_AARS_RULE already (it
  // has no `pillarDCap` field to zero — pillar D is capped by its own points, not a
  // separate cap), so ablating it would be a no-op measuring nothing. It is scored nowhere
  // in the spec rule (aars.ts's `DEFAULT_AARS_RULE.exposurePoints` comment).
  const pillars = ["pillarACap", "pillarBCap", "pillarCCap"] as const;

  it("measures each pillar's contribution to the ranking as a tau-b table", () => {
    const table: Record<string, number> = {};
    for (const cap of pillars) {
      const ablated: AarsRule = { ...DEFAULT_AARS_RULE, [cap]: 0 };
      const ablatedDoc = liveDoc(ablated);
      const after = scoreVector(ablatedDoc.nodes, scoredIds);
      table[cap] = kendallTauB(baseline, after);
    }
    console.table(table);
    console.log(`[scoreOrdinality] pillar ablation tau-b: ${JSON.stringify(table)}`);

    // The point of this experiment is the recorded values (which pillars were doing ranking
    // work), not a pass/fail threshold — so all this asserts is that each is a real,
    // in-range correlation and not NaN/Infinity from a degenerate rule.
    for (const cap of pillars) {
      expect(Number.isFinite(table[cap])).toBe(true);
      expect(table[cap]).toBeGreaterThanOrEqual(-1);
      expect(table[cap]).toBeLessThanOrEqual(1);
    }
  });
});

describe("3. saturation census — the numbers ai/AARS_ASSESSMENT.md publishes", () => {
  // This block IS the contract for §2's code fence and §6's comparison table. It exists
  // because those numbers were measured once, by hand, and then went stale underneath the
  // doc: the seed estate gained three "Other AI risk" issues on `agent-e` (sampleData.ts's
  // Other cohort, all on one asset on purpose), which gave that asset a second issue, which
  // triggered pillar A's >1 multiplier, which moved it from the 72 block to the 76 block.
  // Largest tie group 15 → 14, silently, with the doc still claiming 15.
  //
  // The doc was corrected in the same commit that added this file. Anything asserted here is
  // a number printed in ai/AARS_ASSESSMENT.md; if one of these fails, the fix is to re-read
  // the measurement and edit BOTH, never to loosen the assertion.
  //
  // One clarification the correction folded in: the doc's "19 of 19 scored agents" counted
  // AI_AGENT nodes. `enrichGraphDoc` scores 30 nodes — it also reaches the 8
  // `role-finance-admin-*` ACCESS_ROLE nodes (they carry open issues, so `nodeIssues.length
  // > 0` makes them scorable even though ACCESS_ROLE is not an AI_ASSET_KIND) plus several
  // AI_GUARDRAIL / AI_MODEL / AI_PIPELINE / AI_DATASET nodes that score 0. So the honest
  // phrasing, and the one the doc now carries, is "19 of 30 scored assets — and those 19 are
  // exactly the CRITICAL band".
  it("§2: the spec rule on the live path", () => {
    const d = ruleDiscrimination(baseDoc.nodes, DEFAULT_AARS_RULE);
    expect(d.distinctScores).toBe(5);
    expect(d.largestTieGroup).toBe(14);
    expect(d.scored).toBe(30);
    expect(d.tieRate).toBeCloseTo(0.3, 2);
    expect(d.effectiveCardinality).toBeCloseTo(3.67, 2);
    expect(d.bandOccupancy).toEqual({ CRITICAL: 19, HIGH: 0, MEDIUM: 0, LOW: 3, INFO: 8 });
    // Pillar B at its cap for every asset that reaches a band above LOW — the finding §2 is
    // named for. The two counts being equal is the claim; `scored` (30) is a wider population.
    expect(d.saturated.compliance).toBe(19);
    expect(d.saturated.compliance).toBe(d.bandOccupancy["CRITICAL"]);
    expect(unreachableGapRules(DEFAULT_AARS_RULE).length).toBe(3);
  });

  it("§2: the demo path scores a different, healthier-looking estate", () => {
    // The same seed assets through the dry-run hints, which pin 2–3 codes per asset from
    // ai/custom_score.md instead of deriving 5–6. This contrast IS §2's "the demo and
    // production disagree about the model, and only the demo looks healthy".
    const hinted = enrichGraphDoc(seedGraphDoc("T"), SEED_ISSUES, SEED_AARS_HINTS, DEFAULT_AARS_RULE);
    const d = ruleDiscrimination(hinted.nodes, DEFAULT_AARS_RULE);
    expect(d.distinctScores).toBe(10);
    expect(d.tieRate).toBeCloseTo(0.14, 2);
    expect(d.effectiveCardinality).toBeCloseTo(7.43, 2);
    // Four bands occupied, not five: MEDIUM is empty on this path too.
    expect(Object.values(d.bandOccupancy).filter((c) => c > 0).length).toBe(4);
  });

  it("§6: AARS v2 on the live path, against the spec rule's row", () => {
    const d = ruleDiscrimination(liveDoc(AARS_V2_RULE).nodes, AARS_V2_RULE);
    expect(d.distinctScores).toBe(11);
    expect(d.largestTieGroup).toBe(12);
    expect(d.tieRate).toBeCloseTo(0.2, 2);
    expect(d.effectiveCardinality).toBeCloseTo(6.43, 2);
    expect(d.bandOccupancy).toEqual({ CRITICAL: 0, HIGH: 4, MEDIUM: 15, LOW: 2, INFO: 9 });
    // The preset's whole purpose: pillar B off its ceiling. 19 of 30 becomes 1 of 30.
    expect(d.saturated.compliance).toBe(1);
    expect(unreachableGapRules(AARS_V2_RULE).length).toBe(1);
  });
});
