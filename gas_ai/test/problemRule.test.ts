// The problem rule as a configurable object: outcome cascade, coercion, validation, leaf
// accounting, and the tree-vs-landscape diagnostic — the structural port of aarsRule.test.ts
// onto problem.ts's tree instead of AARS's score.

import { describe, expect, it } from "vitest";
import {
  decideProblem,
  enumerateDecisionVectors,
  deriveProblemInput,
  type DecisionVector,
  type Outcome,
} from "../src/domain/problem";
import {
  cleanProblemRule,
  decisionEqual,
  DEFAULT_PROBLEM_RULE,
  leafCoverage,
  MAX_OUTCOME_RULES,
  problemRuleSummary,
  shadowedOutcomeRules,
  treeDiscrimination,
  validateProblemRule,
  type OutcomeRule,
  type ProblemRule,
} from "../src/domain/problemRule";
import { isUnresolvedIssue } from "../src/domain/config";
import { enrichGraphDoc } from "../src/domain/graphEnrich";
import { DEFAULT_AARS_RULE } from "../src/domain/aars";
import { seedGraphDoc, SEED_ISSUES } from "../src/server/sampleData";
import { indexBy } from "../src/domain/util";
import { buildNullExposureLandscape } from "./problem.fixture";

function tuned(over: Partial<ProblemRule>): ProblemRule {
  return cleanProblemRule({ ...DEFAULT_PROBLEM_RULE, ...over });
}

// ------------------------------------------------------------------------ cleanProblemRule

describe("cleanProblemRule", () => {
  it("leaves the defaults untouched", () => {
    expect(cleanProblemRule(DEFAULT_PROBLEM_RULE)).toEqual(DEFAULT_PROBLEM_RULE);
  });

  it("returns the spec rule for junk rather than a broken one", () => {
    for (const junk of [null, undefined, 7, "nope", [], {}]) {
      expect(cleanProblemRule(junk)).toEqual(DEFAULT_PROBLEM_RULE);
    }
  });

  it("drops unknown axis keys and unknown axis values from a `when`", () => {
    const r = cleanProblemRule({
      ...DEFAULT_PROBLEM_RULE,
      outcomeRules: [
        { when: { exploitation: "ACTIVE", speed: "FAST", mission: "SPICY" }, outcome: "ACT" },
      ],
    });
    expect(r.outcomeRules).toEqual([{ when: { exploitation: "ACTIVE" }, outcome: "ACT" }]);
  });

  it("an unreadable outcome falls back to the RULE'S OWN cleaned fallbackOutcome", () => {
    const r = cleanProblemRule({
      ...DEFAULT_PROBLEM_RULE,
      fallbackOutcome: "TRACK_STAR",
      outcomeRules: [{ when: { mission: "LOW" }, outcome: "NONSENSE" }],
    });
    expect(r.outcomeRules[0]!.outcome).toBe("TRACK_STAR");
  });

  it("caps the cascade at MAX_OUTCOME_RULES", () => {
    const many: OutcomeRule[] = Array.from({ length: MAX_OUTCOME_RULES + 10 }, () => ({
      when: {}, outcome: "TRACK",
    }));
    expect(cleanProblemRule({ ...DEFAULT_PROBLEM_RULE, outcomeRules: many }).outcomeRules).toHaveLength(
      MAX_OUTCOME_RULES,
    );
  });

  it("an unreadable exploitationByRuleId maturity falls to FEASIBLE, never REALIZED", () => {
    const r = cleanProblemRule({
      ...DEFAULT_PROBLEM_RULE,
      exploitationByRuleId: [{ ruleId: "wc-id-1", maturity: "TOTALLY_SURE" }],
    });
    expect(r.exploitationByRuleId).toEqual([{ ruleId: "wc-id-1", maturity: "FEASIBLE" }]);
  });

  it("drops an exploitation row with no ruleId", () => {
    const r = cleanProblemRule({
      ...DEFAULT_PROBLEM_RULE,
      exploitationByRuleId: [{ ruleId: "  ", maturity: "REALIZED" }],
    });
    expect(r.exploitationByRuleId).toEqual([]);
  });

  it("clamps actLeafCeiling into the practical (0, 1] range", () => {
    expect(cleanProblemRule({ ...DEFAULT_PROBLEM_RULE, actLeafCeiling: 4 }).actLeafCeiling).toBe(1);
    expect(cleanProblemRule({ ...DEFAULT_PROBLEM_RULE, actLeafCeiling: 0 }).actLeafCeiling).toBeGreaterThan(0);
    expect(cleanProblemRule({ ...DEFAULT_PROBLEM_RULE, actLeafCeiling: -1 }).actLeafCeiling).toBeGreaterThan(0);
    expect(cleanProblemRule({ ...DEFAULT_PROBLEM_RULE, actLeafCeiling: "nope" }).actLeafCeiling).toBe(
      DEFAULT_PROBLEM_RULE.actLeafCeiling,
    );
  });

  it("falls back to the spec rule's own lists for missingMission, remediateVerdicts, totalImpactGroups", () => {
    const r = cleanProblemRule({ ...DEFAULT_PROBLEM_RULE, missingMission: "SPICY", remediateVerdicts: 7 });
    expect(r.missingMission).toBe(DEFAULT_PROBLEM_RULE.missingMission);
    expect(r.remediateVerdicts).toEqual(DEFAULT_PROBLEM_RULE.remediateVerdicts);
  });
});

// --------------------------------------------------------------------------- leafCoverage

describe("leafCoverage — the 54-leaf tree, computed, not hardcoded", () => {
  it("totals exactly 54, computed from the axis value lists", () => {
    expect(enumerateDecisionVectors().length).toBe(54);
    expect(leafCoverage(DEFAULT_PROBLEM_RULE).total).toBe(54);
  });

  it("every leaf is claimed exactly once — byRow plus byFallback partitions the 54", () => {
    const coverage = leafCoverage(DEFAULT_PROBLEM_RULE);
    const rowSum = coverage.byRow.reduce((a, b) => a + b, 0);
    expect(rowSum + coverage.byFallback).toBe(coverage.total);
    const outcomeSum = Object.values(coverage.byOutcome).reduce((a, b) => a + b, 0);
    expect(outcomeSum).toBe(coverage.total);
  });

  it("ACT claims exactly the 6 leaves the cascade's first three rows work out to (11.1%)", () => {
    // Independently enumerated by hand from DEFAULT_PROBLEM_RULE's first three rows —
    // not copied from leafCoverage's own output, so this cross-checks it rather than
    // restating it. See problemRule.ts's DEFAULT_PROBLEM_RULE comment for the algebra.
    const expectedActLeaves: DecisionVector[] = [
      { exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "HIGH" },
      { exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "MEDIUM" },
      { exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "LOW" },
      { exploitation: "ACTIVE", impact: "TOTAL", exposure: "CONTROLLED", mission: "HIGH" },
      { exploitation: "ACTIVE", impact: "TOTAL", exposure: "UNVERIFIED", mission: "HIGH" },
      { exploitation: "ACTIVE", impact: "PARTIAL", exposure: "OPEN", mission: "HIGH" },
    ];

    const actualActLeaves = enumerateDecisionVectors().filter(
      (v) => decideProblem(v, DEFAULT_PROBLEM_RULE).outcome === "ACT",
    );
    expect(actualActLeaves).toEqual(expect.arrayContaining(expectedActLeaves));
    expect(actualActLeaves).toHaveLength(expectedActLeaves.length);

    const coverage = leafCoverage(DEFAULT_PROBLEM_RULE);
    expect(coverage.byOutcome.ACT).toBe(6);
    const actShare = coverage.byOutcome.ACT / coverage.total;
    expect(actShare).toBeCloseTo(6 / 54, 12);
    expect(actShare).toBeCloseTo(0.1111, 4);
    // eslint-disable-next-line no-console
    console.log(
      `[problemRule] DEFAULT_PROBLEM_RULE: ACT claims ${coverage.byOutcome.ACT} of ` +
        `${coverage.total} leaves (${(actShare * 100).toFixed(1)}%)`,
    );
  });

  it("moving a row above another changes which one claims a shared leaf", () => {
    const reordered = tuned({
      outcomeRules: [
        { when: { mission: "HIGH" }, outcome: "TRACK_STAR" },
        ...DEFAULT_PROBLEM_RULE.outcomeRules,
      ],
    });
    const vector: DecisionVector = {
      exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "HIGH",
    };
    // Under the default order this leaf is ACT (row 0); moved below the mission-only row,
    // that row now claims it first.
    expect(decideProblem(vector, DEFAULT_PROBLEM_RULE).outcome).toBe("ACT");
    expect(decideProblem(vector, reordered).outcome).toBe("TRACK_STAR");
  });
});

// --------------------------------------------------------------------- validateProblemRule

describe("validateProblemRule", () => {
  it("passes the defaults", () => {
    expect(validateProblemRule(DEFAULT_PROBLEM_RULE)).toEqual([]);
  });

  it("reports an empty cascade", () => {
    expect(validateProblemRule(tuned({ outcomeRules: [] })).join(" ")).toContain("no rules");
  });

  it("reports a non-last empty `when` — it would swallow every rule after it", () => {
    const rule = tuned({
      outcomeRules: [
        { when: {}, outcome: "TRACK" },
        { when: { exploitation: "ACTIVE" }, outcome: "ACT" },
      ],
    });
    expect(validateProblemRule(rule).join(" ")).toContain("swallows");
  });

  it("allows an empty `when` as the conceptually-last row", () => {
    // ATTEND, not ACT — this row's 18 leaves would otherwise trip the outcome-mass check
    // below, which is a separate concern from whether the empty `when` is placed legally.
    const rule = tuned({
      outcomeRules: [
        { when: { exploitation: "ACTIVE" }, outcome: "ATTEND" },
        { when: {}, outcome: "TRACK" },
      ],
    });
    expect(validateProblemRule(rule)).toEqual([]);
  });

  it("rejects a duplicate `when`", () => {
    const rule = tuned({
      outcomeRules: [
        { when: { exploitation: "ACTIVE" }, outcome: "ACT" },
        { when: { exploitation: "ACTIVE" }, outcome: "ATTEND" },
      ],
    });
    expect(validateProblemRule(rule).join(" ")).toContain("repeats");
  });

  it("reports outcome mass when ACT's leaf share exceeds actLeafCeiling", () => {
    const rule = tuned({
      outcomeRules: [{ when: {}, outcome: "ACT" }],
      actLeafCeiling: 0.15,
    });
    const errors = validateProblemRule(rule);
    expect(errors.join(" ")).toContain("54 leaves to ACT");
    expect(errors.join(" ")).toContain("ceiling");
  });

  it("does not report outcome mass when ACT stays within the ceiling", () => {
    const rule = tuned({ actLeafCeiling: 0.5 });
    expect(validateProblemRule(rule).some((e) => e.includes("ceiling"))).toBe(false);
  });
});

// -------------------------------------------------------------------- shadowedOutcomeRules

describe("shadowedOutcomeRules", () => {
  it("finds none in the defaults — every documented row can fire", () => {
    expect(shadowedOutcomeRules(DEFAULT_PROBLEM_RULE)).toEqual([]);
  });

  it("flags a row every one of whose leaves an earlier row already claims", () => {
    const rule = tuned({
      outcomeRules: [
        { when: { exploitation: "ACTIVE" }, outcome: "ACT" },
        // Every ACTIVE+TOTAL leaf is already inside "exploitation: ACTIVE" above.
        { when: { exploitation: "ACTIVE", impact: "TOTAL" }, outcome: "ATTEND" },
        { when: {}, outcome: "TRACK" },
      ],
    });
    expect(shadowedOutcomeRules(rule)).toEqual([1]);
  });

  it("does not flag the same row moved ABOVE the broader one", () => {
    const rule = tuned({
      outcomeRules: [
        { when: { exploitation: "ACTIVE", impact: "TOTAL" }, outcome: "ATTEND" },
        { when: { exploitation: "ACTIVE" }, outcome: "ACT" },
        { when: {}, outcome: "TRACK" },
      ],
    });
    expect(shadowedOutcomeRules(rule)).toEqual([]);
  });
});

// ---------------------------------------------------------------------- problemRuleSummary

describe("problemRuleSummary", () => {
  it("names the row count, the ACT share, and the fallback", () => {
    const text = problemRuleSummary(DEFAULT_PROBLEM_RULE).join(" ");
    expect(text).toContain(`${DEFAULT_PROBLEM_RULE.outcomeRules.length} outcome rules`);
    expect(text).toContain("TRACK");
    expect(text).toContain("6 of 54 leaves");
  });

  it("never claims exploitation reaches ACTIVE through the rule table or AI verdict", () => {
    const text = problemRuleSummary(DEFAULT_PROBLEM_RULE).join(" ");
    expect(text).toContain("ACTIVE only from Wiz's own validated-exploitable flag");
  });
});

// ---------------------------------------------------------------------------- decisionEqual

describe("decisionEqual", () => {
  it("ignores a moved actLeafCeiling — it changes no outcome", () => {
    const moved = tuned({ actLeafCeiling: 0.5 });
    expect(decisionEqual(DEFAULT_PROBLEM_RULE, moved)).toBe(true);
  });

  it("sees a change to the outcome cascade", () => {
    const changed = tuned({ fallbackOutcome: "ATTEND" });
    expect(decisionEqual(DEFAULT_PROBLEM_RULE, changed)).toBe(false);
  });

  it("sees a change to the exploitation rule table", () => {
    const changed = tuned({ exploitationByRuleId: [{ ruleId: "wc-id-1", maturity: "REALIZED" }] });
    expect(decisionEqual(DEFAULT_PROBLEM_RULE, changed)).toBe(false);
  });
});

// ---------------------------------------------------------------------- treeDiscrimination

describe("treeDiscrimination — the null-exposure fixture (the point of this phase)", () => {
  it("reports a high UNVERIFIED-exposure rate on a landscape shaped like a real hosted-agent tenant", () => {
    const { nodes, issues } = buildNullExposureLandscape();
    const nodesById = indexBy(nodes, (n) => n.id);

    const decided = issues.map((issue) => {
      const node = nodesById.get(issue.assetId);
      const { vector, unknowns } = deriveProblemInput(issue, node, DEFAULT_PROBLEM_RULE);
      const { outcome } = decideProblem(vector, DEFAULT_PROBLEM_RULE);
      return { outcome, vector, unknowns };
    });

    const d = treeDiscrimination(decided);

    expect(d.decided).toHaveLength(12);
    // 9 of 12 agents carry null/null and no exposure evidence — 75%, comfortably above the
    // 60% line that would mean this failure mode is invisible to the seed data alone.
    expect(d.unknownRate.exposure).toBeCloseTo(9 / 12, 12);
    expect(d.unknownRate.exposure).toBeGreaterThan(0.6);

    // eslint-disable-next-line no-console
    console.log("[problemRule] null-exposure fixture treeDiscrimination:", {
      outcomeOccupancy: d.outcomeOccupancy,
      leavesReached: d.leavesReached,
      unknownRate: d.unknownRate,
    });
  });
});

describe("treeDiscrimination — the real seed landscape", () => {
  it("runs DEFAULT_PROBLEM_RULE over enrichGraphDoc(seedGraphDoc) + SEED_ISSUES and reports the shape", () => {
    const enriched = enrichGraphDoc(seedGraphDoc("T"), SEED_ISSUES, undefined, DEFAULT_AARS_RULE);
    const nodesById = indexBy(enriched.nodes, (n) => n.id);
    const open = SEED_ISSUES.filter(isUnresolvedIssue);

    const decided = open.map((issue) => {
      const node = nodesById.get(issue.assetId);
      const { vector, unknowns } = deriveProblemInput(issue, node, DEFAULT_PROBLEM_RULE);
      const { outcome } = decideProblem(vector, DEFAULT_PROBLEM_RULE);
      return { outcome, vector, unknowns };
    });

    const d = treeDiscrimination(decided);

    expect(d.decided.length).toBe(open.length);
    expect(d.leavesReached).toBeGreaterThan(0);
    expect(d.leavesReached).toBeLessThanOrEqual(54);
    const outcomeTotal = (Object.values(d.outcomeOccupancy) as number[]).reduce((a, b) => a + b, 0);
    expect(outcomeTotal).toBe(open.length);

    // eslint-disable-next-line no-console
    console.log("[problemRule] SEED LANDSCAPE treeDiscrimination:", {
      decidedCount: d.decided.length,
      outcomeOccupancy: d.outcomeOccupancy,
      leavesReached: d.leavesReached,
      leafOccupancy: d.leafOccupancy,
      unknownRate: d.unknownRate,
    });
  });
});
