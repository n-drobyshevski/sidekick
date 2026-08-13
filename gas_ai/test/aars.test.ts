// AARS scoring pinned to the normative applied table in ai/custom_score.md.
// Every named row must reproduce exactly — score, severity, and pillar breakdown.
//
// The model is configurable now, so the contract is sharper than it was: DEFAULT_AARS_RULE
// (which is what these cases score under, implicitly) must reproduce the doc, and each knob
// must move the score the way the page claims it does.

import { describe, expect, it } from "vitest";
import {
  aarsSeverity,
  AARS_V2_RULE,
  AARS_V3_RULE,
  computeAars,
  DEFAULT_AARS_RULE,
  environmentFor,
  gap,
  gapBreakdown,
  gapPointsFor,
  type AarsRule,
} from "../src/domain/aars";
import { cleanAarsRule, validateAarsRule } from "../src/domain/aarsRule";
import { AARS_SEVERITY_ORDER, normalizeAarsSeverity } from "../src/domain/config";
import type { Severity } from "../src/domain/config";

function tuned(over: Partial<AarsRule>): AarsRule {
  return cleanAarsRule({ ...DEFAULT_AARS_RULE, ...over });
}

const M = "MEDIUM" as Severity;
const L = "LOW" as Severity;

describe("computeAars — applied table rows", () => {
  it("Agent-A / Agent-B / agent-F / agent-F-preprod / Agent-E → 62 HIGH", () => {
    const r = computeAars({
      issueSeverities: [M],
      gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
      dataExposure: "SENSITIVE",
    });
    expect(r.pillars).toEqual({ toxic: 20, compliance: 20, data: 22, exposure: 0, privilege: 0, environment: 0, combination: 0 });
    expect(r.score).toBe(62);
    expect(r.severity).toBe("HIGH");
  });

  it("Agent-G ×2 issues → 66 HIGH (×1.2 multiplier)", () => {
    const r = computeAars({
      issueSeverities: [M, M],
      gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
      dataExposure: "SENSITIVE",
    });
    expect(r.pillars.toxic).toBe(24);
    expect(r.score).toBe(66);
    expect(r.severity).toBe("HIGH");
  });

  it("agent-I ×4 issues → 66 HIGH (multiplier does not stack)", () => {
    const r = computeAars({
      issueSeverities: [M, M, M, M],
      gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
      dataExposure: "SENSITIVE",
    });
    expect(r.score).toBe(66);
    expect(r.severity).toBe("HIGH");
  });

  it("agent-H-chatbot ×2 → 71 CRITICAL (secondary LLM05 gap scores +5)", () => {
    const r = computeAars({
      issueSeverities: [M, M],
      gaps: [gap("LLM06"), gap("LLM05"), gap("NO_GUARDRAIL")],
      dataExposure: "SENSITIVE",
    });
    expect(r.pillars).toEqual({ toxic: 24, compliance: 25, data: 22, exposure: 0, privilege: 0, environment: 0, combination: 0 });
    expect(r.score).toBe(71);
    expect(r.severity).toBe("CRITICAL");
  });

  it("AGENT_AUTOGEN_DO_NOT_DELETE ×N → 76 CRITICAL (pillar B capped at 30)", () => {
    const r = computeAars({
      issueSeverities: [M, M, M, M],
      gaps: [gap("LLM06"), gap("ASI10"), gap("NO_GUARDRAIL")],
      dataExposure: "SENSITIVE",
    });
    expect(r.pillars).toEqual({ toxic: 24, compliance: 30, data: 22, exposure: 0, privilege: 0, environment: 0, combination: 0 });
    expect(r.score).toBe(76);
    expect(r.severity).toBe("CRITICAL");
  });

  it("dev-agent-D / dev-agent-D-test → 67 HIGH (secondary LLM04 gap +5)", () => {
    const r = computeAars({
      issueSeverities: [M],
      gaps: [gap("LLM04"), gap("LLM06"), gap("NO_GUARDRAIL")],
      dataExposure: "SENSITIVE",
    });
    expect(r.pillars).toEqual({ toxic: 20, compliance: 25, data: 22, exposure: 0, privilege: 0, environment: 0, combination: 0 });
    expect(r.score).toBe(67);
    expect(r.severity).toBe("HIGH");
  });

  it("AWSReservedSSO_FinanceAdmin ×8 (aggregated) → 65 HIGH (data access ×1.1 = 11)", () => {
    const r = computeAars({
      issueSeverities: [M, M, M, M, M, M, M, M],
      gaps: [gap("LLM01"), gap("LLM02"), gap("ASI02")],
      dataExposure: "DATA_ACCESS",
    });
    expect(r.pillars).toEqual({ toxic: 24, compliance: 30, data: 11, exposure: 0, privilege: 0, environment: 0, combination: 0 });
    expect(r.score).toBe(65);
    expect(r.severity).toBe("HIGH");
  });

  it("agent-J / agent-K → 29 LOW", () => {
    const r = computeAars({
      issueSeverities: [L],
      gaps: [gap("ASI03")],
      dataExposure: "DATA_ACCESS",
    });
    expect(r.pillars).toEqual({ toxic: 8, compliance: 10, data: 11, exposure: 0, privilege: 0, environment: 0, combination: 0 });
    expect(r.score).toBe(29);
    expect(r.severity).toBe("LOW");
  });

  it("healthy asset (no issues, no gaps, no data) → 0 INFO", () => {
    const r = computeAars({ issueSeverities: [], gaps: [], dataExposure: "NONE" });
    expect(r.score).toBe(0);
    expect(r.severity).toBe("INFO");
  });

  it("pillar A caps at 50 (CRITICAL ×1.2 → 50, not 60); total clamps at 100", () => {
    const r = computeAars({
      issueSeverities: ["CRITICAL", "CRITICAL"] as Severity[],
      gaps: [gap("LLM01"), gap("ASI01"), gap("NO_GUARDRAIL"), gap("FIVE_RS")],
      dataExposure: "SENSITIVE",
    });
    expect(r.pillars.toxic).toBe(50);
    expect(r.pillars.compliance).toBe(30);
    expect(r.score).toBe(100);
    expect(r.severity).toBe("CRITICAL");
  });
});

describe("computeAars — the rule is what makes those numbers", () => {
  // Agent-A: MEDIUM ×1, LLM06 + NO_GUARDRAIL, sensitive data → 62 under the defaults.
  const agentA = {
    issueSeverities: ["MEDIUM"] as Severity[],
    gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
    dataExposure: "SENSITIVE" as const,
  };

  it("scores the applied table when handed the defaults explicitly", () => {
    expect(computeAars(agentA, DEFAULT_AARS_RULE).score).toBe(62);
    expect(computeAars(agentA).score).toBe(computeAars(agentA, DEFAULT_AARS_RULE).score);
  });

  it("pillar A follows the severity points", () => {
    const rule = tuned({ severityPoints: { ...DEFAULT_AARS_RULE.severityPoints, MEDIUM: 30 } });
    expect(computeAars(agentA, rule).pillars.toxic).toBe(30);
    expect(computeAars(agentA, rule).score).toBe(72);
  });

  it("pillar A follows the multiplier, and only above one issue", () => {
    const rule = tuned({ multiIssueMultiplier: 2 });
    expect(computeAars(agentA, rule).pillars.toxic).toBe(20);
    expect(computeAars({ ...agentA, issueSeverities: ["MEDIUM", "MEDIUM"] }, rule).pillars.toxic)
      .toBe(40);
  });

  it("pillar A follows its cap", () => {
    const rule = tuned({ pillarACap: 12 });
    expect(computeAars(agentA, rule).pillars.toxic).toBe(12);
  });

  it("pillar B prices gaps through the cascade, not through the gap object", () => {
    const rule = tuned({
      gapPoints: [{ match: "prefix", code: "LLM", points: 1 }],
      gapFallbackPoints: 2,
    });
    // LLM06 → 1 by the single rule; NO_GUARDRAIL matches nothing → the fallback.
    expect(computeAars(agentA, rule).pillars.compliance).toBe(3);
  });

  it("an explicit per-gap price still overrides the cascade", () => {
    const rule = tuned({ gapFallbackPoints: 0, gapPoints: [] });
    const input = { ...agentA, gaps: [gap("LLM06", 17), gap("NO_GUARDRAIL")] };
    expect(computeAars(input, rule).pillars.compliance).toBe(17);
  });

  it("pillar B follows its cap", () => {
    expect(computeAars(agentA, tuned({ pillarBCap: 4 })).pillars.compliance).toBe(4);
  });

  it("pillar C follows the exposure points and the amplifier", () => {
    const rule = tuned({
      dataExposurePoints: { SENSITIVE: 30, DATA_ACCESS: 10, NONE: 0 },
      dataAmplifier: 1.5,
    });
    expect(computeAars(agentA, rule).pillars.data).toBe(45);
  });

  it("clamps to 100 whatever the rule says", () => {
    const rule = tuned({
      severityPoints: { CRITICAL: 100, HIGH: 100, MEDIUM: 100, LOW: 100 },
      pillarACap: 100,
      pillarBCap: 100,
      dataExposurePoints: { SENSITIVE: 100, DATA_ACCESS: 100, NONE: 0 },
    });
    expect(computeAars(agentA, rule).score).toBe(100);
  });

  it("names the level through the rule's own bands", () => {
    const rule = tuned({ bands: { critical: 60, high: 50, medium: 30, low: 10 } });
    expect(computeAars(agentA, rule).severity).toBe("CRITICAL"); // 62, CRITICAL from 60
    expect(computeAars(agentA).severity).toBe("HIGH");           // the same 62, HIGH from 50
  });

  it("scores an unknown issue severity as zero rather than inventing points", () => {
    expect(computeAars({ ...agentA, issueSeverities: ["UNKNOWN" as Severity] }).pillars.toxic)
      .toBe(0);
  });
});

// The two aggregation knobs exist because the spec's own arithmetic stops discriminating
// on live data. Each defaults to the spec, so the applied table above is untouched; these
// cases pin the OPT-IN behaviour and, crucially, the identities that make it safe to adopt.
describe("computeAars — multiIssueScaling", () => {
  const many = (n: number) => ({
    issueSeverities: Array(n).fill("MEDIUM") as Severity[],
    gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
    dataExposure: "SENSITIVE" as const,
  });

  it("log2 agrees with flat at one and two issues — the identity that makes it adoptable", () => {
    const log2 = tuned({ multiIssueScaling: "log2" });
    for (const n of [1, 2]) {
      expect(computeAars(many(n), log2).pillars.toxic)
        .toBe(computeAars(many(n), DEFAULT_AARS_RULE).pillars.toxic);
    }
  });

  it("log2 keeps rising with the count where flat goes deaf", () => {
    const log2 = tuned({ multiIssueScaling: "log2" });
    // flat: 2, 4 and 8 issues are all ×1.2 → 24.
    for (const n of [4, 8]) expect(computeAars(many(n), DEFAULT_AARS_RULE).pillars.toxic).toBe(24);
    // log2: 1 + 0.2·log2(n) → ×1.4 at 4, ×1.6 at 8.
    expect(computeAars(many(4), log2).pillars.toxic).toBe(28);
    expect(computeAars(many(8), log2).pillars.toxic).toBe(32);
  });

  it("log2 is strictly monotone in the count, so more issues never score less", () => {
    const log2 = tuned({ multiIssueScaling: "log2" });
    let prev = -1;
    for (let n = 1; n <= 40; n++) {
      const toxic = computeAars(many(n), log2).pillars.toxic;
      expect(toxic).toBeGreaterThanOrEqual(prev);
      prev = toxic;
    }
  });

  it("log2 still obeys pillar A's cap", () => {
    expect(computeAars(many(64), tuned({ multiIssueScaling: "log2", pillarACap: 30 })).pillars.toxic)
      .toBe(30);
  });
});

// Two axes the model round-tripped from Wiz and then discarded. Both default to zero
// points, so the applied table above is untouched; these cases pin the OPT-IN behaviour.
describe("computeAars — privilege as its own axis", () => {
  const base = {
    issueSeverities: ["MEDIUM"] as Severity[],
    gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
    dataExposure: "SENSITIVE" as const,
  };
  const priced = tuned({ privilegePoints: { ADMIN: 12, HIGH: 6, NONE: 0 } });

  it("scores nothing under the spec rule, whatever the privilege", () => {
    for (const p of ["ADMIN", "HIGH", "NONE"] as const) {
      expect(computeAars({ ...base, privilege: p }).score).toBe(62);
    }
  });

  it("separates ADMIN from HIGH — the distinction dataExposureOf throws away", () => {
    expect(computeAars({ ...base, privilege: "ADMIN" }, priced).pillars.privilege).toBe(12);
    expect(computeAars({ ...base, privilege: "HIGH" }, priced).pillars.privilege).toBe(6);
    expect(computeAars({ ...base, privilege: "NONE" }, priced).pillars.privilege).toBe(0);
  });

  it("is independent of the data axis — an asset can be both", () => {
    // The whole point: under the spec model a SENSITIVE asset's privilege is discarded.
    const sens = computeAars({ ...base, privilege: "ADMIN" }, priced);
    const none = computeAars({ ...base, dataExposure: "NONE", privilege: "ADMIN" }, priced);
    expect(sens.pillars.privilege).toBe(none.pillars.privilege);
    expect(sens.pillars.data).toBeGreaterThan(none.pillars.data);
  });

  it("an input with no privilege recorded scores as NONE", () => {
    expect(computeAars(base, priced).pillars.privilege).toBe(0);
  });
});

describe("environmentFor — the account-name cascade", () => {
  it("classifies the naming conventions the reference tenant actually uses", () => {
    // Verbatim from gas_ai/exemples/get_ai_agents_reponse.js.
    expect(environmentFor("dpcp-production-ck-8ytk")).toBe("PROD");
    expect(environmentFor("dpcp-preproduction-ck-z8g4")).toBe("PREPROD");
    expect(environmentFor("ai-industry-pp-4yqw")).toBe("PREPROD");
    expect(environmentFor("sap-nonprodpartner")).toBe("NONPROD");
    expect(environmentFor("inix-horsprod-n0wq")).toBe("NONPROD");
  });

  it("puts every negative form ABOVE prod — order is meaning", () => {
    // "sap-nonprodpartner" and "inix-horsprod-n0wq" both contain "prod".
    for (const n of ["sap-nonprodpartner", "inix-horsprod-n0wq", "x-non-prod-y"]) {
      expect(environmentFor(n)).toBe("NONPROD");
    }
    expect(environmentFor("dpcp-preproduction-ck-z8g4")).not.toBe("PROD");
  });

  it("leaves an unmatched account UNCLASSIFIED rather than guessing", () => {
    for (const n of ["shipperbox", "aigovernance-gr6d", "", undefined]) {
      expect(environmentFor(n)).toBe("UNCLASSIFIED");
    }
  });

  it("matches case-insensitively", () => {
    expect(environmentFor("DPCP-PRODUCTION-CK")).toBe("PROD");
  });

  it("skips an unparseable regex row instead of throwing the whole sync", () => {
    const rule = tuned({
      environmentRules: [
        { match: "regex", pattern: "([unclosed", environment: "DEV" },
        { match: "contains", pattern: "prod", environment: "PROD" },
      ],
    });
    expect(environmentFor("my-prod-account", rule)).toBe("PROD");
  });
});

describe("computeAars — environment", () => {
  const base = {
    issueSeverities: ["MEDIUM"] as Severity[],
    gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
    dataExposure: "SENSITIVE" as const,
  };

  it("scores nothing under the spec rule — agent-F and agent-F-preprod stay equal", () => {
    expect(computeAars({ ...base, environment: "PROD" }).score).toBe(62);
    expect(computeAars({ ...base, environment: "PREPROD" }).score).toBe(62);
  });

  it("separates them once priced", () => {
    const rule = tuned({
      environmentPoints: { PROD: 10, PREPROD: 4, NONPROD: 2, DEV: 0, UNCLASSIFIED: 0 },
    });
    expect(computeAars({ ...base, environment: "PROD" }, rule).score).toBe(72);
    expect(computeAars({ ...base, environment: "PREPROD" }, rule).score).toBe(66);
  });

  it("refuses to price UNCLASSIFIED, however the rule is edited", () => {
    // Points on "we could not tell" would score ignorance. cleanAarsRule pins it at 0.
    const rule = tuned({
      environmentPoints: { PROD: 10, PREPROD: 4, NONPROD: 2, DEV: 1, UNCLASSIFIED: 25 },
    });
    expect(rule.environmentPoints.UNCLASSIFIED).toBe(0);
    expect(computeAars({ ...base, environment: "UNCLASSIFIED" }, rule).score).toBe(62);
  });
});

// The one thing additive pillars cannot say: that three conditions together are worse than
// the three apart. Empty in the spec rule, so the applied table is a pure sum as before.
describe("computeAars — combination bonuses", () => {
  const base = {
    issueSeverities: ["MEDIUM"] as Severity[],
    gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
    dataExposure: "SENSITIVE" as const,
  };
  const triple = tuned({
    combinationRules: [
      {
        conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA", "MISSING_GUARDRAIL"],
        points: 15,
        label: "Over-privileged, holds sensitive data, unguarded",
      },
    ],
  });

  it("fires nothing under the spec rule, which has no conjunctions", () => {
    const r = computeAars({
      ...base,
      conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA", "MISSING_GUARDRAIL"],
    });
    expect(r.pillars.combination).toBe(0);
    expect(r.combinations).toBeUndefined();
    expect(r.score).toBe(62);
  });

  it("needs EVERY condition — two of three is not the conjunction", () => {
    const two = computeAars({ ...base, conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA"] }, triple);
    expect(two.pillars.combination).toBe(0);
    const all = computeAars({
      ...base,
      conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA", "MISSING_GUARDRAIL"],
    }, triple);
    expect(all.pillars.combination).toBe(15);
    expect(all.score).toBe(77);
  });

  it("carries its label, so the number explains itself", () => {
    const r = computeAars({
      ...base,
      conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA", "MISSING_GUARDRAIL"],
    }, triple);
    expect(r.combinations).toEqual([
      { label: "Over-privileged, holds sensitive data, unguarded", points: 15 },
    ]);
  });

  it("is not a first-match cascade — two conjunctions holding at once both count", () => {
    const rule = tuned({
      combinationRules: [
        { conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA"], points: 6 },
        { conditions: ["SENSITIVE_DATA", "INTERNET_EXPOSURE"], points: 9 },
      ],
    });
    const r = computeAars({
      ...base,
      conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA", "INTERNET_EXPOSURE"],
    }, rule);
    expect(r.pillars.combination).toBe(15);
    expect(r.combinations).toHaveLength(2);
  });

  it("drops a rule naming no known condition rather than firing it on everything", () => {
    // A rule that matches every asset moves the whole estate equally and so carries no
    // ranking information at all — the exact mistake the 5Rs amplifier makes.
    const rule = tuned({
      combinationRules: [
        { conditions: [], points: 40 },
        { conditions: ["NOT_A_CONDITION"], points: 40 },
      ],
    });
    expect(rule.combinationRules).toEqual([]);
    expect(computeAars({ ...base, conditions: [] }, rule).pillars.combination).toBe(0);
  });

  it("keeps only the recognised conditions of a partly-bad rule", () => {
    const rule = tuned({
      combinationRules: [{ conditions: ["SENSITIVE_DATA", "NONSENSE"], points: 5 }],
    });
    expect(rule.combinationRules[0]!.conditions).toEqual(["SENSITIVE_DATA"]);
  });
});

describe("computeAars — the likelihood × impact mode", () => {
  const base = {
    issueSeverities: [] as Severity[],
    gaps: [] as ReturnType<typeof gap>[],
    dataExposure: "NONE" as const,
  };
  // A minimal two-pillar rule, so the arithmetic is checkable by hand.
  const mult = tuned({
    scoringMode: "multiplicative",
    likelihoodPillars: ["exposure"],
    likelihoodFloor: 0,
    exposurePoints: { CONFIRMED: 10, UNDETERMINED: 5, NONE: 0 },
    dataExposurePoints: { SENSITIVE: 50, DATA_ACCESS: 25, NONE: 0 },
    dataAmplifier: 1,
    severityPoints: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    gapPoints: [],
    gapFallbackPoints: 0,
    // Zeroed so they contribute to neither half. Naming only `exposure` as likelihood
    // makes toxic and compliance IMPACT pillars, and a pillar with a large ceiling and no
    // points would otherwise dilute the impact fraction — which is correct behaviour, but
    // not what these cases are measuring.
    pillarACap: 0,
    pillarBCap: 0,
    privilegePoints: { ADMIN: 0, HIGH: 0, NONE: 0 },
    environmentPoints: { PROD: 0, PREPROD: 0, NONPROD: 0, DEV: 0, UNCLASSIFIED: 0 },
  });

  it("is off by default — the spec rule still sums", () => {
    expect(DEFAULT_AARS_RULE.scoringMode).toBe("additive");
    expect(computeAars(base).composition).toBeUndefined();
  });

  it("multiplies the two halves across the 0–100 scale", () => {
    // exposure 10/10 → likelihood 1.0; data 50/50 → impact 100 → 100
    const both = computeAars(
      { ...base, dataExposure: "SENSITIVE", internetExposure: "CONFIRMED" }, mult);
    expect(both.composition).toEqual({ likelihood: 1, impact: 100 });
    expect(both.score).toBe(100);
    // exposure 5/10 → 0.5; data 50/50 → 100 → 50
    const half = computeAars(
      { ...base, dataExposure: "SENSITIVE", internetExposure: "UNDETERMINED" }, mult);
    expect(half.composition!.likelihood).toBe(0.5);
    expect(half.score).toBe(50);
  });

  it("separates the two cases the additive model conflates", () => {
    // The whole point of the restructure: unreachable-with-PII and reachable-with-nothing
    // are different problems, and a sum cannot say so.
    const dataNoReach = computeAars(
      { ...base, dataExposure: "SENSITIVE", internetExposure: "NONE" }, mult);
    const reachNoData = computeAars(
      { ...base, dataExposure: "NONE", internetExposure: "CONFIRMED" }, mult);
    expect(dataNoReach.score).toBe(0);   // floor is 0 in this hand-built rule
    expect(reachNoData.score).toBe(0);   // nothing to take
    // ...and under the shipped floor the unreachable asset keeps residual risk.
    const floored = cleanAarsRule({ ...mult, likelihoodFloor: 0.2 });
    expect(computeAars({ ...base, dataExposure: "SENSITIVE" }, floored).score).toBe(20);
  });

  it("floors the likelihood — an unobserved asset is not a safe one", () => {
    const floored = cleanAarsRule({ ...mult, likelihoodFloor: 0.25 });
    const r = computeAars({ ...base, dataExposure: "SENSITIVE" }, floored);
    expect(r.composition!.likelihood).toBe(0.25);
    expect(r.score).toBe(25);
  });

  it("combines likelihood evidence by noisy-OR, so routes saturate instead of summing", () => {
    const rule = cleanAarsRule({
      ...mult,
      likelihoodPillars: ["exposure", "compliance"],
      pillarBCap: 10,
      gapPoints: [{ match: "prefix", code: "X", points: 5 }],
    });
    // exposure 5/10 = 0.5 and compliance 5/10 = 0.5 → 1 − 0.5·0.5 = 0.75, not 1.0.
    const r = computeAars({
      ...base,
      dataExposure: "SENSITIVE",
      internetExposure: "UNDETERMINED",
      gaps: [gap("X1")],
    }, rule);
    expect(r.composition!.likelihood).toBe(0.75);
  });

  it("never exceeds the scale, whatever the pillars say", () => {
    const r = computeAars({
      ...base,
      dataExposure: "SENSITIVE",
      internetExposure: "CONFIRMED",
      privilege: "ADMIN",
      environment: "PROD",
    }, cleanAarsRule({ ...mult, privilegePoints: { ADMIN: 99, HIGH: 9, NONE: 0 } }));
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("treats a switched-off likelihood pillar as absent, not as 0% likely", () => {
    // exposurePoints all zero = pillar off. Dividing by its ceiling would be a zero
    // divide; reading it as "0% likely" would zero every asset in the estate.
    const off = cleanAarsRule({
      ...mult,
      exposurePoints: { CONFIRMED: 0, UNDETERMINED: 0, NONE: 0 },
      likelihoodFloor: 0.3,
    });
    const r = computeAars({ ...base, dataExposure: "SENSITIVE" }, off);
    expect(r.composition!.likelihood).toBe(0.3);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});

describe("AARS_V3_RULE — the likelihood × impact preset", () => {
  it("is valid, round-trips clean, and is not a default", () => {
    expect(validateAarsRule(AARS_V3_RULE)).toEqual([]);
    expect(cleanAarsRule(AARS_V3_RULE)).toEqual(AARS_V3_RULE);
    expect(DEFAULT_AARS_RULE.scoringMode).toBe("additive");
    expect(AARS_V2_RULE.scoringMode).toBe("additive");
    expect(AARS_V3_RULE.scoringMode).toBe("multiplicative");
  });

  it("floors likelihood above zero, so nothing scores 0 for being unobserved", () => {
    expect(AARS_V3_RULE.likelihoodFloor).toBeGreaterThan(0);
    expect(AARS_V3_RULE.likelihoodFloor).toBeLessThan(1);
  });

  it("puts the routes IN on the likelihood side and the damage on the impact side", () => {
    expect(AARS_V3_RULE.likelihoodPillars).toContain("exposure");
    expect(AARS_V3_RULE.likelihoodPillars).toContain("compliance");
    expect(AARS_V3_RULE.likelihoodPillars).not.toContain("data");
    expect(AARS_V3_RULE.likelihoodPillars).not.toContain("privilege");
    expect(AARS_V3_RULE.likelihoodPillars).not.toContain("environment");
  });

  it("reports both halves, which is what makes the score explainable", () => {
    const r = computeAars({
      issueSeverities: ["MEDIUM"] as Severity[],
      gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
      dataExposure: "SENSITIVE",
      internetExposure: "CONFIRMED",
      privilege: "ADMIN",
      environment: "PROD",
    }, AARS_V3_RULE);
    expect(r.composition).toBeDefined();
    expect(r.composition!.likelihood).toBeGreaterThan(0);
    expect(r.composition!.likelihood).toBeLessThanOrEqual(1);
    expect(r.score).toBe(Math.min(100, Math.round(r.composition!.likelihood * r.composition!.impact)));
  });
});

describe("AARS_V2_RULE — the calibrated preset", () => {
  it("is a valid rule that survives a clean round-trip", () => {
    expect(validateAarsRule(AARS_V2_RULE)).toEqual([]);
    expect(cleanAarsRule(AARS_V2_RULE)).toEqual(AARS_V2_RULE);
  });

  it("is NOT the default — adopting it has to be a deliberate act", () => {
    expect(AARS_V2_RULE).not.toEqual(DEFAULT_AARS_RULE);
    expect(DEFAULT_AARS_RULE.gapAggregation).toBe("sum");
    expect(DEFAULT_AARS_RULE.multiIssueScaling).toBe("flat");
  });

  it("spends the whole 0–100 scale: the four caps sum to exactly 100", () => {
    const maxData = Math.round(
      AARS_V2_RULE.dataExposurePoints.SENSITIVE * AARS_V2_RULE.dataAmplifier);
    const maxExposure = AARS_V2_RULE.exposurePoints.CONFIRMED;
    expect(AARS_V2_RULE.pillarACap + AARS_V2_RULE.pillarBCap + maxData + maxExposure).toBe(100);
  });

  it("folds the 5Rs amplifier into the points rather than carrying it as a constant", () => {
    // A tenant-wide multiplier cannot change a ranking, only inflate every score — while
    // still deciding band membership. v2 says what it means instead.
    expect(AARS_V2_RULE.dataAmplifier).toBe(1);
  });

  it("prices INACTIVE_AGENT explicitly rather than leaving it to the fallback", () => {
    expect(gapPointsFor("INACTIVE_AGENT", AARS_V2_RULE)).toBe(10);
    expect(gapPointsFor("INACTIVE_AGENT", DEFAULT_AARS_RULE))
      .toBe(DEFAULT_AARS_RULE.gapFallbackPoints);
  });

  it("keeps undetermined exposure well below confirmed", () => {
    expect(AARS_V2_RULE.exposurePoints.UNDETERMINED)
      .toBeLessThan(AARS_V2_RULE.exposurePoints.CONFIRMED);
    expect(AARS_V2_RULE.exposurePoints.UNDETERMINED)
      .toBeGreaterThan(AARS_V2_RULE.exposurePoints.NONE);
  });

  it("takes the six-code live shape off the pillar-B ceiling", () => {
    const live = ["LLM06", "LLM01", "ASI03", "ASI01", "ML_DATA_POISONING", "NO_GUARDRAIL"];
    const input = {
      issueSeverities: ["MEDIUM"] as Severity[],
      gaps: live.map((c) => gap(c)),
      dataExposure: "SENSITIVE" as const,
    };
    expect(computeAars(input, DEFAULT_AARS_RULE).pillars.compliance)
      .toBe(DEFAULT_AARS_RULE.pillarBCap); // clamped — the cascade contributes nothing
    expect(computeAars(input, AARS_V2_RULE).pillars.compliance)
      .toBeLessThan(AARS_V2_RULE.pillarBCap);
  });

  it("keeps the doc's level thresholds, so the action table still applies", () => {
    // The bands are deliberately NOT refitted to one sample estate: they carry the
    // remediation SLAs from ai/custom_score.md, and the page's rail moves them per tenant.
    expect(AARS_V2_RULE.bands).toEqual(DEFAULT_AARS_RULE.bands);
  });
});

describe("computeAars — internet exposure (pillar D)", () => {
  const base = {
    issueSeverities: ["MEDIUM"] as Severity[],
    gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
    dataExposure: "SENSITIVE" as const,
  };
  const priced = tuned({ exposurePoints: { CONFIRMED: 15, UNDETERMINED: 6, NONE: 0 } });

  it("scores nothing under the spec rule, whatever the exposure", () => {
    for (const e of ["CONFIRMED", "UNDETERMINED", "NONE"] as const) {
      const r = computeAars({ ...base, internetExposure: e });
      expect(r.pillars.exposure).toBe(0);
      expect(r.score).toBe(62); // the applied table, untouched
    }
  });

  it("an input with no exposure recorded scores as if none — never as confirmed", () => {
    expect(computeAars(base, priced).pillars.exposure).toBe(0);
    expect(computeAars({ ...base, internetExposure: "NONE" }, priced).pillars.exposure).toBe(0);
  });

  it("prices the three states apart once pillar D is switched on", () => {
    expect(computeAars({ ...base, internetExposure: "CONFIRMED" }, priced).score).toBe(77);
    expect(computeAars({ ...base, internetExposure: "UNDETERMINED" }, priced).score).toBe(68);
    expect(computeAars({ ...base, internetExposure: "NONE" }, priced).score).toBe(62);
  });

  it("does not amplify pillar D — the 5Rs signal says nothing about reachability", () => {
    const loud = tuned({
      exposurePoints: { CONFIRMED: 20, UNDETERMINED: 0, NONE: 0 },
      dataAmplifier: 3,
    });
    expect(computeAars({ ...base, internetExposure: "CONFIRMED" }, loud).pillars.exposure).toBe(20);
  });
});

describe("computeAars — gapAggregation", () => {
  const withGaps = (codes: string[]) => ({
    issueSeverities: ["MEDIUM"] as Severity[],
    gaps: codes.map((c) => gap(c)),
    dataExposure: "SENSITIVE" as const,
  });

  it("rss equals sum for zero or one gap", () => {
    const rss = tuned({ gapAggregation: "rss" });
    for (const codes of [[], ["LLM06"]]) {
      expect(computeAars(withGaps(codes), rss).pillars.compliance)
        .toBe(computeAars(withGaps(codes), DEFAULT_AARS_RULE).pillars.compliance);
    }
  });

  it("rss keeps pillar B off its cap where sum pins every asset to it", () => {
    // The live derivation's real shape: ~6 codes from three overlapping taxonomies.
    const live = ["LLM06", "LLM01", "ASI03", "ASI01", "ML_DATA_POISONING", "NO_GUARDRAIL"];
    expect(computeAars(withGaps(live), DEFAULT_AARS_RULE).pillars.compliance).toBe(30); // capped
    // √(10²+10²+10²+10²+5²+10²) = √525 ≈ 22.9
    expect(computeAars(withGaps(live), tuned({ gapAggregation: "rss" })).pillars.compliance).toBe(23);
  });

  it("rss is monotone — an extra gap never lowers pillar B", () => {
    const rss = tuned({ gapAggregation: "rss" });
    const codes = ["LLM06", "ASI03", "LLM04", "ML_MODEL_THEFT", "NO_GUARDRAIL", "ASI10"];
    let prev = -1;
    for (let i = 0; i <= codes.length; i++) {
      const c = computeAars(withGaps(codes.slice(0, i)), rss).pillars.compliance;
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it("rss still honours an explicit per-gap override and the cap", () => {
    const rule = tuned({ gapAggregation: "rss", pillarBCap: 12 });
    expect(computeAars({ ...withGaps([]), gaps: [gap("X", 99)] }, rule).pillars.compliance).toBe(12);
  });
});

describe("gapBreakdown", () => {
  it("reads a pillar-B total back to the rows that produced it, in order", () => {
    expect(gapBreakdown([gap("LLM06"), gap("LLM04"), gap("SUB-082")])).toEqual([
      { code: "LLM06", points: 10, overridden: false },
      { code: "LLM04", points: 5, overridden: false },
      { code: "SUB-082", points: 5, overridden: false },
    ]);
  });

  it("marks a gap that carries its own price", () => {
    expect(gapBreakdown([gap("LLM06", 3)])).toEqual([
      { code: "LLM06", points: 3, overridden: true },
    ]);
  });
});

describe("aarsSeverity — edges", () => {
  it.each([
    [0, "INFO"], [9, "INFO"], [10, "LOW"], [29, "LOW"],
    [30, "MEDIUM"], [49, "MEDIUM"], [50, "HIGH"], [69, "HIGH"],
    [70, "CRITICAL"], [100, "CRITICAL"],
  ])("band(%i) = %s", (score, band) => {
    expect(aarsSeverity(score as number)).toBe(band);
  });
});

describe("normalizeAarsSeverity", () => {
  it("reads the pre-rename MINIMAL as today's INFO", () => {
    expect(normalizeAarsSeverity("MINIMAL")).toBe("INFO");
    expect(normalizeAarsSeverity("minimal")).toBe("INFO");
  });

  it("passes the current values through, case- and space-insensitively", () => {
    for (const sev of AARS_SEVERITY_ORDER) expect(normalizeAarsSeverity(sev)).toBe(sev);
    expect(normalizeAarsSeverity(" high ")).toBe("HIGH");
  });

  it("rejects anything else rather than inventing a severity", () => {
    for (const v of ["", "BOGUS", "UNKNOWN", null, undefined, 7]) {
      expect(normalizeAarsSeverity(v)).toBeUndefined();
    }
  });

  it("scores every threshold onto the renamed scale", () => {
    expect(aarsSeverity(70)).toBe("CRITICAL");
    expect(aarsSeverity(50)).toBe("HIGH");
    expect(aarsSeverity(30)).toBe("MEDIUM");
    expect(aarsSeverity(10)).toBe("LOW");
    expect(aarsSeverity(9)).toBe("INFO");
    expect(aarsSeverity(0)).toBe("INFO");
  });
});
