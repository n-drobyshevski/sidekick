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
  derivationSignature,
  gap,
  gapBreakdown,
  gapPointsFor,
  type AarsRule,
} from "../src/domain/aars";
import { cleanAarsRule, unreachableGapRules, validateAarsRule } from "../src/domain/aarsRule";
import { AARS_SEVERITY_ORDER, normalizeAarsSeverity } from "../src/domain/config";
import type { Severity } from "../src/domain/config";
import { deriveAarsInput, enrichGraphDoc } from "../src/domain/graphEnrich";
import type { GNode, GraphDoc, IssueRow } from "../src/domain/graphTypes";

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
    expect(r.pillars).toEqual({ toxic: 20, compliance: 20, data: 22, exposure: 0 });
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
    expect(r.pillars).toEqual({ toxic: 24, compliance: 25, data: 22, exposure: 0 });
    expect(r.score).toBe(71);
    expect(r.severity).toBe("CRITICAL");
  });

  it("AGENT_AUTOGEN_DO_NOT_DELETE ×N → 76 CRITICAL (pillar B capped at 30)", () => {
    const r = computeAars({
      issueSeverities: [M, M, M, M],
      gaps: [gap("LLM06"), gap("ASI10"), gap("NO_GUARDRAIL")],
      dataExposure: "SENSITIVE",
    });
    expect(r.pillars).toEqual({ toxic: 24, compliance: 30, data: 22, exposure: 0 });
    expect(r.score).toBe(76);
    expect(r.severity).toBe("CRITICAL");
  });

  it("dev-agent-D / dev-agent-D-test → 67 HIGH (secondary LLM04 gap +5)", () => {
    const r = computeAars({
      issueSeverities: [M],
      gaps: [gap("LLM04"), gap("LLM06"), gap("NO_GUARDRAIL")],
      dataExposure: "SENSITIVE",
    });
    expect(r.pillars).toEqual({ toxic: 20, compliance: 25, data: 22, exposure: 0 });
    expect(r.score).toBe(67);
    expect(r.severity).toBe("HIGH");
  });

  it("AWSReservedSSO_FinanceAdmin ×8 (aggregated) → 65 HIGH (data access ×1.1 = 11)", () => {
    const r = computeAars({
      issueSeverities: [M, M, M, M, M, M, M, M],
      gaps: [gap("LLM01"), gap("LLM02"), gap("ASI02")],
      dataExposure: "DATA_ACCESS",
    });
    expect(r.pillars).toEqual({ toxic: 24, compliance: 30, data: 11, exposure: 0 });
    expect(r.score).toBe(65);
    expect(r.severity).toBe("HIGH");
  });

  it("agent-J / agent-K → 29 LOW", () => {
    const r = computeAars({
      issueSeverities: [L],
      gaps: [gap("ASI03")],
      dataExposure: "DATA_ACCESS",
    });
    expect(r.pillars).toEqual({ toxic: 8, compliance: 10, data: 11, exposure: 0 });
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
      // 30 × 1.5 = 45 needs headroom: the pillar now carries an explicit cap, which the
      // spec rule sets at 22 (its old implicit ceiling, 20 × 1.1).
      pillarCCap: 50,
    });
    expect(computeAars(agentA, rule).pillars.data).toBe(45);
  });

  it("clamps pillar C at its own cap, exposure tier and findings together", () => {
    const rule = tuned({
      dataExposurePoints: { SENSITIVE: 20, DATA_ACCESS: 10, NONE: 0 },
      dataAmplifier: 1,
      dataFindingPoints: { CRITICAL: 30, HIGH: 20, MEDIUM: 10, LOW: 5 },
      pillarCCap: 25,
    });
    const reaching = { ...agentA, dataFindingSeverities: ["CRITICAL"] as Severity[] };
    expect(computeAars(reaching, rule).pillars.data).toBe(25); // 20 + 30 = 50, capped
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
    // Pillar C's ceiling is its own cap now, not its top exposure tier: the tier is only
    // half the pillar since the finding term landed, and deriving the sum from the tier
    // alone would report the scale under-spent by exactly the half that was added.
    const maxExposure = AARS_V2_RULE.exposurePoints.CONFIRMED;
    expect(
      AARS_V2_RULE.pillarACap + AARS_V2_RULE.pillarBCap + AARS_V2_RULE.pillarCCap + maxExposure,
    ).toBe(100);
  });

  it("splits pillar C so it takes more than the two values it used to", () => {
    // The defect ai/AARS_ASSESSMENT.md:190 records: pillar C at its ceiling for 20 of 30
    // assets, because a boolean has two states. Reaching sensitive data is worth 6; what
    // you reach is worth up to 6 more.
    const sensitive = {
      issueSeverities: ["MEDIUM"] as Severity[],
      gaps: [gap("LLM06")],
      dataExposure: "SENSITIVE" as const,
    };
    const score = (findings: Severity[]) =>
      computeAars({ ...sensitive, dataFindingSeverities: findings }, AARS_V2_RULE).pillars.data;

    expect(computeAars(sensitive, AARS_V2_RULE).pillars.data).toBe(6); // tier alone
    expect(score(["MEDIUM"])).toBe(8);
    expect(score(["HIGH"])).toBe(10);
    expect(score(["CRITICAL"])).toBe(12);
    expect(new Set([6, score(["MEDIUM"]), score(["HIGH"]), score(["CRITICAL"])]).size)
      .toBeGreaterThan(2);
  });

  it("scores identically with and without findings under the SPEC rule", () => {
    // The convention every knob in this file follows: off by default, so no tenant
    // re-scores on upgrade and ai/custom_score.md's applied table stays the truth.
    const base = {
      issueSeverities: ["MEDIUM"] as Severity[],
      gaps: [gap("LLM06"), gap("NO_GUARDRAIL")],
      dataExposure: "SENSITIVE" as const,
    };
    const withFindings = {
      ...base,
      dataFindingSeverities: ["CRITICAL", "HIGH", "HIGH"] as Severity[],
    };
    expect(computeAars(withFindings)).toEqual(computeAars(base));
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

// Phase 6b — ai/AARS_SCORING_ASSESSMENT.md §1: pillar B's unit is label vs condition, not
// code vs framework. `gapUnit` makes that a knob. Defaults to "code" (the spec, and every
// case above), so this block is additive — it proves the opt-in surface, not a replacement
// for any assertion pinned above.
describe("gapUnit", () => {
  const privilegedNode: GNode = {
    id: "n", kind: "AI_AGENT", name: "n",
    guardrailMissing: true, hasAdminPrivileges: true, hasAccessToSensitiveData: true,
  };
  const privilegedIssue: IssueRow = {
    id: "i", ruleId: "r", ruleName: "r", comboGroup: "gcp-managed-privileged",
    nativeSeverity: "MEDIUM", adjustedSeverity: "HIGH", status: "OPEN",
    assetId: "n", assetName: "n",
    frameworks: { owaspLlm: ["LLM06"], owaspAgentic: ["ASI01"] },
  };

  it("defaults to \"code\" on the spec rule and on a fresh clean", () => {
    expect(DEFAULT_AARS_RULE.gapUnit).toBe("code");
    expect(cleanAarsRule({}).gapUnit).toBe("code");
  });

  it("cleanAarsRule coerces an unreadable value to \"code\", never silently to \"condition\"", () => {
    expect(cleanAarsRule({ ...DEFAULT_AARS_RULE, gapUnit: "bogus" }).gapUnit).toBe("code");
    expect(cleanAarsRule({ ...DEFAULT_AARS_RULE, gapUnit: undefined }).gapUnit).toBe("code");
    expect(cleanAarsRule({ ...DEFAULT_AARS_RULE, gapUnit: "condition" }).gapUnit).toBe("condition");
  });

  it("under \"condition\" the same asset gets condition gaps instead of framework codes", () => {
    const codeGaps = deriveAarsInput(privilegedNode, [privilegedIssue], DEFAULT_AARS_RULE)
      .gaps.map((g) => g.code).sort();
    expect(codeGaps).toEqual(["ASI01", "LLM06", "NO_GUARDRAIL"]);

    const conditionRule = cleanAarsRule({ ...DEFAULT_AARS_RULE, gapUnit: "condition" });
    const conditionGaps = deriveAarsInput(privilegedNode, [privilegedIssue], conditionRule)
      .gaps.map((g) => g.code).sort();
    expect(conditionGaps).toEqual([
      "COMBO_GCP_MANAGED_PRIVILEGED", "COND_EXCESSIVE_PRIVILEGE", "COND_MISSING_GUARDRAIL",
      "COND_SENSITIVE_DATA",
    ]);
    // No overlap: the two units never emit the same shaped code, so a rescore across them
    // cannot half-apply.
    expect(conditionGaps.some((c) => codeGaps.includes(c))).toBe(false);
  });

  it("OTHER_GROUP_ID combo gaps price as COMBO_OTHER, not a literal empty pattern", () => {
    const issue: IssueRow = { ...privilegedIssue, comboGroup: "other-ai-risk" };
    const conditionRule = cleanAarsRule({ ...DEFAULT_AARS_RULE, gapUnit: "condition" });
    const codes = deriveAarsInput(privilegedNode, [issue], conditionRule).gaps.map((g) => g.code);
    expect(codes).toContain("COMBO_OTHER");
  });

  it("holds each held condition once, however many issues or codes cite it", () => {
    const twoIssues: IssueRow[] = [
      privilegedIssue,
      { ...privilegedIssue, id: "i2", comboGroup: "gcp-hosted-privileged" },
    ];
    const conditionRule = cleanAarsRule({ ...DEFAULT_AARS_RULE, gapUnit: "condition" });
    const codes = deriveAarsInput(privilegedNode, twoIssues, conditionRule).gaps.map((g) => g.code);
    expect(codes.filter((c) => c === "COND_EXCESSIVE_PRIVILEGE")).toHaveLength(1);
    expect(codes).toContain("COMBO_GCP_MANAGED_PRIVILEGED");
    expect(codes).toContain("COMBO_GCP_HOSTED_PRIVILEGED"); // two distinct groups, two combo gaps
  });

  it("gapSources.deprecatedModel / .inactiveAgent still fire — node-status facts, not codes", () => {
    const conditionRule = cleanAarsRule({
      ...DEFAULT_AARS_RULE,
      gapUnit: "condition",
      gapSources: { ...DEFAULT_AARS_RULE.gapSources, deprecatedModel: true },
    });
    const deprecated: GNode = { id: "n", kind: "AI_AGENT", name: "n", status: "Deprecated" };
    expect(deriveAarsInput(deprecated, [], conditionRule).gaps.map((g) => g.code))
      .toEqual(["DEPRECATED_MODEL"]);
  });

  it("fiveRs is inert under \"condition\" — nothing left for a framework-code source to feed", () => {
    const conditionRule = cleanAarsRule({
      ...DEFAULT_AARS_RULE,
      gapUnit: "condition",
      gapSources: { ...DEFAULT_AARS_RULE.gapSources, fiveRs: true },
    });
    const issue: IssueRow = {
      ...privilegedIssue,
      frameworks: { ...privilegedIssue.frameworks, fiveRs: ["Restrict"] },
    };
    const codes = deriveAarsInput(privilegedNode, [issue], conditionRule).gaps.map((g) => g.code);
    expect(codes).not.toContain("5R_RESTRICT");
  });

  it("derivationSignature differs between the two units, all else equal", () => {
    const conditionRule = cleanAarsRule({ ...DEFAULT_AARS_RULE, gapUnit: "condition" });
    expect(derivationSignature(DEFAULT_AARS_RULE)).not.toBe(derivationSignature(conditionRule));
  });

  it("unreachableGapRules reports the cascade going dead across a flipped unit", () => {
    // The DEFAULT cascade's OWASP/5R/NO_GUARDRAIL rows are live under "code"...
    expect(unreachableGapRules(DEFAULT_AARS_RULE).length).toBe(3);
    // ...and unreachable under "condition", because nothing emits those codes any more —
    // this IS the diagnostic that tells an operator their cascade went dead.
    const conditionRule = cleanAarsRule({ ...DEFAULT_AARS_RULE, gapUnit: "condition" });
    const dead = unreachableGapRules(conditionRule).map((i) => conditionRule.gapPoints[i]!.code);
    expect(dead).toEqual(
      expect.arrayContaining(["NO_GUARDRAIL", "LLM", "ASI", "ML", "5R", "FIVE_RS"]),
    );
  });

  it("a rescore under a flipped unit actually re-derives — the gate syncStore.enrichFromTabs applies", () => {
    const doc: GraphDoc = { nodes: [privilegedNode], edges: [], syncedAt: "T" };

    // A persisted input from a prior sync, derived under the spec ("code") unit.
    const persisted = enrichGraphDoc(doc, [privilegedIssue], undefined, DEFAULT_AARS_RULE)
      .nodes[0]!.aarsInput!;
    expect(persisted.derivedUnder).toBe(derivationSignature(DEFAULT_AARS_RULE));
    expect(persisted.gaps.map((g) => g.code)).toContain("LLM06");

    // The operator flips gapUnit to "condition" and hits Recompute. enrichFromTabs's gate:
    // reuse a persisted input only when its signature still matches the rule scoring it now.
    const conditionRule = cleanAarsRule({ ...DEFAULT_AARS_RULE, gapUnit: "condition" });
    const sig = derivationSignature(conditionRule);
    const hints: Record<string, typeof persisted> =
      persisted.derivedUnder === sig ? { n: persisted } : {};
    expect(hints).toEqual({}); // signatures disagree — nothing is reused

    const rescored = enrichGraphDoc(doc, [privilegedIssue], hints, conditionRule);
    const gaps = rescored.nodes[0]!.aarsInput!.gaps.map((g) => g.code);
    // Actually re-derived, not stale: the framework code is gone and the condition code
    // that subsumes it is present. Nothing moved BEFORE this rescore — this is the movement
    // Phase 2b's `derivedUnder` machinery exists to guarantee happens at all.
    expect(gaps).not.toContain("LLM06");
    expect(gaps).toContain("COND_MISSING_GUARDRAIL");
  });
});

describe("AARS_V3_RULE — the condition-unit preset", () => {
  it("is a valid rule that survives a clean round-trip", () => {
    expect(validateAarsRule(AARS_V3_RULE)).toEqual([]);
    expect(cleanAarsRule(AARS_V3_RULE)).toEqual(AARS_V3_RULE);
  });

  it("is NOT the default, and selects \"condition\" where v2 stays on \"code\"", () => {
    expect(AARS_V3_RULE).not.toEqual(DEFAULT_AARS_RULE);
    expect(AARS_V3_RULE.gapUnit).toBe("condition");
    expect(AARS_V2_RULE.gapUnit).toBe("code");
    expect(DEFAULT_AARS_RULE.gapUnit).toBe("code");
  });

  it("is v2 with the unit flipped and the cascade re-cast for it — everything else agrees", () => {
    const { gapUnit, gapPoints, ...v3Rest } = AARS_V3_RULE;
    const { gapUnit: v2Unit, gapPoints: v2Points, ...v2Rest } = AARS_V2_RULE;
    expect(v3Rest).toEqual(v2Rest);
  });

  it("prices the COND_ vocabulary explicitly rather than the fallback", () => {
    for (const code of [
      "COND_MISSING_GUARDRAIL", "COND_SENSITIVE_DATA", "COND_EXCESSIVE_PRIVILEGE",
      "COND_INTERNET_EXPOSURE",
    ]) {
      expect(gapPointsFor(code, AARS_V3_RULE)).not.toBe(AARS_V3_RULE.gapFallbackPoints);
    }
  });

  it("prices any COMBO_ group through the prefix row, including an unmodelled one", () => {
    expect(gapPointsFor("COMBO_SOME_FUTURE_PATTERN", AARS_V3_RULE)).toBe(5);
    expect(gapPointsFor("COMBO_OTHER", AARS_V3_RULE)).toBe(5);
  });

  it("keeps INACTIVE_AGENT / DEPRECATED_MODEL priced explicitly, same as v2", () => {
    expect(gapPointsFor("INACTIVE_AGENT", AARS_V3_RULE)).toBe(10);
    expect(gapPointsFor("DEPRECATED_MODEL", AARS_V3_RULE)).toBe(5);
  });

  it("no cascade row is unreachable — every code it names, this unit can raise", () => {
    expect(unreachableGapRules(AARS_V3_RULE)).toEqual([]);
  });

  it("scores an asset holding every condition and two combo groups, off the pillar B cap", () => {
    const node: GNode = {
      id: "n", kind: "AI_AGENT", name: "n",
      guardrailMissing: true, hasAdminPrivileges: true, hasAccessToSensitiveData: true,
      isOpenToAllInternet: true,
    };
    const issues: IssueRow[] = [
      {
        id: "i1", ruleId: "r1", ruleName: "r1", comboGroup: "gcp-managed-privileged",
        nativeSeverity: "HIGH", adjustedSeverity: "HIGH", status: "OPEN",
        assetId: "n", assetName: "n",
      },
      {
        id: "i2", ruleId: "r2", ruleName: "r2", comboGroup: "bedrock-no-guardrail",
        nativeSeverity: "HIGH", adjustedSeverity: "HIGH", status: "OPEN",
        assetId: "n", assetName: "n",
      },
    ];
    const input = deriveAarsInput(node, issues, AARS_V3_RULE);
    expect(input.gaps.map((g) => g.code).sort()).toEqual([
      "COMBO_BEDROCK_NO_GUARDRAIL", "COMBO_GCP_MANAGED_PRIVILEGED", "COND_EXCESSIVE_PRIVILEGE",
      "COND_INTERNET_EXPOSURE", "COND_MISSING_GUARDRAIL", "COND_SENSITIVE_DATA",
    ]);
    const result = computeAars({ ...input, dataExposure: "SENSITIVE" }, AARS_V3_RULE);
    // rss over [10, 8, 8, 6, 5, 5] = sqrt(100+64+64+36+25+25) = sqrt(314) ≈ 17.7 → 18,
    // comfortably under the 25 cap — the point of this unit, not an incidental fact.
    expect(result.pillars.compliance).toBe(18);
    expect(result.pillars.compliance).toBeLessThan(AARS_V3_RULE.pillarBCap);
  });
});
