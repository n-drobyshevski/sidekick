// AARS scoring pinned to the normative applied table in ai/custom_score.md.
// Every named row must reproduce exactly — score, severity, and pillar breakdown.
//
// The model is configurable now, so the contract is sharper than it was: DEFAULT_AARS_RULE
// (which is what these cases score under, implicitly) must reproduce the doc, and each knob
// must move the score the way the page claims it does.

import { describe, expect, it } from "vitest";
import {
  aarsSeverity,
  computeAars,
  DEFAULT_AARS_RULE,
  gap,
  gapBreakdown,
  type AarsRule,
} from "../src/domain/aars";
import { cleanAarsRule } from "../src/domain/aarsRule";
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
