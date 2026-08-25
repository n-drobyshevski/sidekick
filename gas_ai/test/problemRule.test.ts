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
  problemCensus,
  PROBLEM_CENSUS_MAX,
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

// ---------------------------------------------------------- treeDiscrimination.axisReadings
//
// The counting half of what used to be ui/axisBar.js's `axisTally`, moved to where the
// population already is so the preview stops shipping one object per decided row to derive
// four small histograms from. These are that function's own tests, ported onto the shape
// the domain now returns.

describe("treeDiscrimination — axisReadings", () => {
  const row = (vector: Partial<DecisionVector>, unknowns: string[] = []) => ({
    outcome: "TRACK" as const,
    vector: { exploitation: "UNKNOWN", impact: "PARTIAL", exposure: "UNVERIFIED", mission: "LOW",
      ...vector } as DecisionVector,
    unknowns,
  });

  it("counts each value and its total, one reading per axis", () => {
    const d = treeDiscrimination([
      row({ exploitation: "ACTIVE" }),
      row({ exploitation: "UNKNOWN" }),
      row({ exploitation: "UNKNOWN" }),
      row({ exploitation: "UNKNOWN" }),
    ]);
    expect(d.axisReadings.exploitation.total).toBe(4);
    expect(d.axisReadings.exploitation.counts).toEqual({ ACTIVE: 1, SUSPECTED: 0, UNKNOWN: 3 });
    // Every axis is read on every row, so all four totals are the population size.
    for (const axis of ["exploitation", "impact", "exposure", "mission"] as const) {
      expect(d.axisReadings[axis].total).toBe(4);
    }
  });

  it("keeps a value nothing reached, because a zero here is a finding about the tenant", () => {
    const d = treeDiscrimination([row({ exploitation: "UNKNOWN" })]);
    expect(Object.keys(d.axisReadings.exploitation.counts))
      .toEqual(["ACTIVE", "SUSPECTED", "UNKNOWN"]);
    expect(d.axisReadings.exploitation.counts["ACTIVE"]).toBe(0);
  });

  it("counts unknown WITHIN the value it landed on, not as a value of its own", () => {
    // A MEDIUM mission may be Wiz's answer or the operator's fallback; both are MEDIUM.
    const d = treeDiscrimination([
      row({ mission: "MEDIUM" }),
      row({ mission: "MEDIUM" }, ["mission"]),
      row({ mission: "HIGH" }),
    ]);
    expect(d.axisReadings.mission.counts["MEDIUM"]).toBe(2);
    expect(d.axisReadings.mission.unknowns["MEDIUM"]).toBe(1);
    expect(d.axisReadings.mission.unknowns["HIGH"]).toBe(0);
  });

  it("ignores an unknown flag raised for a DIFFERENT axis", () => {
    const d = treeDiscrimination([row({ mission: "HIGH" }, ["exposure"])]);
    expect(d.axisReadings.mission.unknowns["HIGH"]).toBe(0);
    expect(d.axisReadings.exposure.unknowns["UNVERIFIED"]).toBe(1);
  });

  it("skips a value off the declared list rather than inventing a bucket for it", () => {
    const d = treeDiscrimination([
      row({ exploitation: "ACTIVE" }),
      row({ exploitation: "NONSENSE" as never }),
    ]);
    expect(d.axisReadings.exploitation.total).toBe(1);
    expect(Object.keys(d.axisReadings.exploitation.counts))
      .toEqual(["ACTIVE", "SUSPECTED", "UNKNOWN"]);
  });

  it("reports zeros rather than an empty map on an empty landscape", () => {
    const d = treeDiscrimination([]);
    expect(d.axisReadings.impact.total).toBe(0);
    expect(d.axisReadings.impact.counts).toEqual({ TOTAL: 0, PARTIAL: 0 });
  });

  it("agrees with unknownRate, because both are counted in the same walk", () => {
    const decided = [
      row({ mission: "HIGH" }, ["mission"]),
      row({ mission: "LOW" }),
      row({ mission: "LOW" }, ["mission"]),
      row({ mission: "MEDIUM" }),
    ];
    const d = treeDiscrimination(decided);
    const flagged = Object.values(d.axisReadings.mission.unknowns).reduce((a, b) => a + b, 0);
    expect(flagged / decided.length).toBeCloseTo(d.unknownRate.mission, 12);
  });
});

describe("problemCensus", () => {
  it("counts issues per verdict and per combo group", () => {
    const c = problemCensus([
      { aiVerdict: "REMEDIATE", comboGroup: "gcp-hosted-privileged" },
      { aiVerdict: "REMEDIATE", comboGroup: "public-model-endpoint" },
      { aiVerdict: "ACCEPT", comboGroup: "gcp-hosted-privileged" },
    ]);
    expect(c.verdicts).toEqual([
      { value: "REMEDIATE", issues: 2 },
      { value: "ACCEPT", issues: 1 },
    ]);
    expect(c.comboGroups).toEqual([
      { value: "gcp-hosted-privileged", issues: 2 },
      { value: "public-model-endpoint", issues: 1 },
    ]);
  });

  it("orders by count, then alphabetically — so the picker does not reshuffle on a tie", () => {
    const c = problemCensus([
      { aiVerdict: "ZEBRA" },
      { aiVerdict: "ALPHA" },
      { aiVerdict: "MIDDLE" },
      { aiVerdict: "MIDDLE" },
    ]);
    expect(c.verdicts.map((e) => e.value)).toEqual(["MIDDLE", "ALPHA", "ZEBRA"]);
  });

  it("excludes OTHER_GROUP_ID — the sentinel is not a group anyone should name", () => {
    // Naming it would hand TOTAL impact to every unclassified issue in the tenant.
    const c = problemCensus([
      { comboGroup: "other-ai-risk" },
      { comboGroup: "other-ai-risk" },
      { comboGroup: "real-group" },
    ]);
    expect(c.comboGroups).toEqual([{ value: "real-group", issues: 1 }]);
  });

  it("contributes nothing for rows carrying none of the fields", () => {
    // What a FindingRow looks like here: every axis is issue vocabulary.
    // `ruleIds` joins the shape additively — the claim this pins is unchanged, that a row
    // carrying nothing contributes nothing, and the third empty list is the same claim.
    expect(problemCensus([{}, {}, {}])).toEqual({ verdicts: [], comboGroups: [], ruleIds: [] });
  });

  it("counts issues per Wiz rule id, so the exploitation table has a list to name from", () => {
    // The lever this exists for: one rule id can carry most of a register, and an operator
    // cannot name what the editor never shows them.
    const c = problemCensus([
      { ruleId: "wc-id-2742" },
      { ruleId: "wc-id-2742" },
      { ruleId: "wc-id-2742" },
      { ruleId: "wc-id-0001" },
    ]);
    expect(c.ruleIds).toEqual([
      { value: "wc-id-2742", issues: 3 },
      { value: "wc-id-0001", issues: 1 },
    ]);
  });

  it("counts every rule id — there is no sentinel to exclude, unlike comboGroup", () => {
    // `comboGroup` is synthesised by this app and backfilled with OTHER_GROUP_ID; `ruleId`
    // is Wiz's own identifier and every issue carries a real one.
    const c = problemCensus([{ ruleId: "other-ai-risk" }, { ruleId: "wc-id-1" }]);
    expect(c.ruleIds.map((e) => e.value).sort()).toEqual(["other-ai-risk", "wc-id-1"]);
  });

  it("does NOT count findings, which price through the same table on ruleShortId", () => {
    // Deliberate, and documented on problemCensus: the count understates a rule id's reach
    // and can never overstate it. A finding-shaped row contributes nothing here.
    const c = problemCensus([{ ruleId: "wc-id-2742" }] as Array<{ ruleId?: string }>);
    expect(c.ruleIds).toEqual([{ value: "wc-id-2742", issues: 1 }]);
    expect(problemCensus([{} as { ruleId?: string }]).ruleIds).toEqual([]);
  });

  it("ignores blank and whitespace-only values rather than counting an empty token", () => {
    const c = problemCensus([
      { aiVerdict: "", comboGroup: "   " },
      { aiVerdict: "  REMEDIATE  ", comboGroup: "g" },
    ]);
    expect(c.verdicts).toEqual([{ value: "REMEDIATE", issues: 1 }]);
    expect(c.comboGroups).toEqual([{ value: "g", issues: 1 }]);
  });

  it("caps each list, so a pathological tenant cannot inflate a preview response", () => {
    const rows = Array.from({ length: PROBLEM_CENSUS_MAX + 25 }, (_, i) => ({
      aiVerdict: `V${String(i).padStart(4, "0")}`,
    }));
    expect(problemCensus(rows).verdicts.length).toBe(PROBLEM_CENSUS_MAX);
  });
});
