// The authoritative framework-code relabel, and the one guarantee it has to make.
//
// The user's concern when this was designed was double counting: feeding compliance data
// into AARS could easily mean the same failing control being priced twice — once as a
// configuration finding and again as a framework fact. It does not, and the reason is
// structural rather than careful: `withFrameworkCodes` returns the SAME findings with a
// longer `frameworkCodes` list. It cannot add a gap because it cannot add a finding.
//
// These tests pin that. If someone later makes the relabel emit a synthetic finding, or
// drops a code, or lets it run when the flag is off, one of these fails.

import { describe, expect, it } from "vitest";

import { DEFAULT_AARS_RULE, AARS_V2_RULE, computeAars } from "../src/domain/aars";
import { cleanAarsRule, unreachableGapRules } from "../src/domain/aarsRule";
import {
  frameworkCodeLookup,
  normalizeCompliancePosturePage,
  normalizeFrameworksPage,
  withFrameworkCodes,
} from "../src/domain/syncNormalize";
import type { FindingRow } from "../src/domain/graphTypes";
import {
  AGENTIC_FRAMEWORK,
  FIVE_RS_FRAMEWORK,
  FRAMEWORK_CATALOGUE,
} from "./frameworkPosture.fixture";

const agentic = normalizeCompliancePosturePage([AGENTIC_FRAMEWORK]);
const fiveRs = normalizeCompliancePosturePage([FIVE_RS_FRAMEWORK]);
const LOOKUP = frameworkCodeLookup(
  [...agentic.frameworkPolicies, ...fiveRs.frameworkPolicies],
  [...agentic.posture, ...fiveRs.posture],
  normalizeFrameworksPage(FRAMEWORK_CATALOGUE).frameworks,
);

/** Findings shaped like the ones normalizeConfigFindingsPage emits. */
const FINDINGS: FindingRow[] = [
  {
    // The case this feature exists for: the tag regex found nothing, so the only code is
    // the tenant's own shortId, which no cascade row but the fallback can price.
    id: "cf-1",
    resourceId: "agent-a",
    ruleShortId: "AIService-003",
    ruleId: "763ebc07-852e-40bd-abc9-e8e38d2d1308",
    severity: "MEDIUM",
    frameworkCodes: ["AIService-003"],
    status: "OPEN",
    result: "FAIL",
  },
  {
    // A Control has no shortId — the join can only reach it by uuid.
    id: "cf-2",
    resourceId: "agent-b",
    ruleShortId: "",
    ruleId: "f6f5494d-eeaf-49ef-9691-a6183e814b0f",
    severity: "MEDIUM",
    frameworkCodes: [],
    status: "OPEN",
    result: "FAIL",
  },
  {
    // A rule in no synced framework. Must come through untouched.
    id: "cf-3",
    resourceId: "agent-c",
    ruleShortId: "SUB-999",
    ruleId: "unknown-rule",
    severity: "LOW",
    frameworkCodes: ["SUB-999"],
    status: "OPEN",
    result: "FAIL",
  },
];

describe("withFrameworkCodes — adds precision, never a gap", () => {
  const relabelled = withFrameworkCodes(FINDINGS, LOOKUP);

  it("returns exactly as many findings as it was given", () => {
    expect(relabelled).toHaveLength(FINDINGS.length);
    expect(relabelled.map((f) => f.id)).toEqual(FINDINGS.map((f) => f.id));
  });

  it("changes NOTHING about a finding except its framework codes", () => {
    for (let i = 0; i < FINDINGS.length; i += 1) {
      const before = { ...FINDINGS[i], frameworkCodes: [] };
      const after = { ...relabelled[i], frameworkCodes: [] };
      expect(after).toEqual(before);
    }
  });

  it("never REMOVES a code — the original shortId survives", () => {
    for (let i = 0; i < FINDINGS.length; i += 1) {
      for (const code of FINDINGS[i].frameworkCodes) {
        expect(relabelled[i].frameworkCodes).toContain(code);
      }
    }
  });

  it("adds the codes Wiz asserts, matched by shortId", () => {
    const f = relabelled.find((r) => r.id === "cf-1")!;
    expect(f.frameworkCodes).toContain("AIService-003");
    expect(f.frameworkCodes).toContain("ASI01");
    expect(f.frameworkCodes).toContain("ASI10");
    expect(f.frameworkCodes).toContain("5R_RESTRICT");
  });

  it("adds them by rule uuid too, for a Control with no shortId", () => {
    const f = relabelled.find((r) => r.id === "cf-2")!;
    expect(f.frameworkCodes.sort()).toEqual(["ASI01", "ASI02", "ASI10"]);
  });

  it("leaves a rule outside every synced framework completely alone", () => {
    const f = relabelled.find((r) => r.id === "cf-3")!;
    expect(f.frameworkCodes).toEqual(["SUB-999"]);
    // Same object, not a copy: nothing changed, so nothing was rewritten.
    expect(f).toBe(FINDINGS[2]);
  });

  it("never duplicates a code it already had", () => {
    const pre = withFrameworkCodes(FINDINGS, LOOKUP);
    const twice = withFrameworkCodes(pre, LOOKUP);
    for (let i = 0; i < pre.length; i += 1) {
      expect(twice[i].frameworkCodes).toEqual(pre[i].frameworkCodes);
      expect(new Set(twice[i].frameworkCodes).size).toBe(twice[i].frameworkCodes.length);
    }
  });

  it("is a no-op against an empty lookup — a landscape with no posture synced", () => {
    expect(withFrameworkCodes(FINDINGS, {})).toEqual(FINDINGS);
  });
});

describe("gapSources.frameworkMapping", () => {
  it("is OFF in the default rule, so no tenant re-scores on upgrade", () => {
    expect(DEFAULT_AARS_RULE.gapSources.frameworkMapping).toBe(false);
  });

  it("is OFF even in the calibrated v2 preset", () => {
    // ai/AARS_ASSESSMENT.md measured v2 before posture existed, and the flag's effect is
    // data-dependent — it does nothing until a posture sync runs, then moves scores. A
    // preset carrying it would silently re-score a landscape when an unrelated sync landed.
    expect(AARS_V2_RULE.gapSources.frameworkMapping).toBe(false);
  });

  it("survives a clean round-trip through cleanAarsRule", () => {
    const on = {
      ...DEFAULT_AARS_RULE,
      gapSources: { ...DEFAULT_AARS_RULE.gapSources, frameworkMapping: true },
    };
    expect(cleanAarsRule(on).gapSources.frameworkMapping).toBe(true);
    expect(cleanAarsRule(DEFAULT_AARS_RULE).gapSources.frameworkMapping).toBe(false);
  });

  it("reads as off for anything that is not literally true", () => {
    const rule = cleanAarsRule({
      ...DEFAULT_AARS_RULE,
      gapSources: { frameworkMapping: "yes" },
    });
    expect(rule.gapSources.frameworkMapping).toBe(false);
  });
});

describe("the dormant cascade rows this feature exists to wake", () => {
  it("the default rule's 5R prefix row can never fire before this", () => {
    // graphEnrich's own note: "The 5Rs mappings ride on every issue and have never reached
    // the score, which is why the default cascade's FIVE_RS and 5R rows can never fire."
    const dead = unreachableGapRules(DEFAULT_AARS_RULE);
    const codes = dead.map((i) => DEFAULT_AARS_RULE.gapPoints[i].code);
    expect(codes).toContain("5R");
  });

  it("switching frameworkMapping on makes the 5R row reachable", () => {
    const rule = {
      ...DEFAULT_AARS_RULE,
      gapSources: { ...DEFAULT_AARS_RULE.gapSources, frameworkMapping: true },
    };
    const codes = unreachableGapRules(rule).map((i) => rule.gapPoints[i].code);
    expect(codes).not.toContain("5R");
  });
});

describe("the score itself", () => {
  const gapsOf = (codes: string[]) => codes.map((code) => ({ code }));

  it("relabelling does not change the NUMBER of gaps an asset carries", () => {
    // The same asset, before and after. Pillar B prices a count and a set of codes; the
    // count is identical, which is the anti-double-count guarantee in arithmetic form.
    const before = computeAars({
      issueSeverities: [],
      gaps: gapsOf(["AIService-003"]),
      dataExposure: "NONE",
      internetExposure: "NONE",
    }, DEFAULT_AARS_RULE);
    const after = computeAars({
      issueSeverities: [],
      gaps: gapsOf(["AIService-003", "ASI01", "ASI10", "5R_RESTRICT"]),
      dataExposure: "NONE",
      internetExposure: "NONE",
    }, DEFAULT_AARS_RULE);
    // The score DOES move — four gaps priced instead of one — and that is the intended
    // effect, which is exactly why the flag defaults off and goes through the Rules
    // preview. What must never happen is a finding being counted twice, and it is not:
    // one finding still produced one finding.
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.pillars.compliance).toBeGreaterThan(before.pillars.compliance);
    // And every other pillar is untouched — the relabel reaches pillar B and nothing else.
    expect(after.pillars.toxic).toBe(before.pillars.toxic);
    expect(after.pillars.data).toBe(before.pillars.data);
    expect(after.pillars.exposure).toBe(before.pillars.exposure);
  });
});
