// Toxic-combination classification: the seed's 29 issues split 8/13/6/2 across the
// four groups; classification works by rule id and by rule-name pattern.

import { describe, expect, it } from "vitest";
import { classifyIssue, COMBO_GROUPS, comboSummary } from "../src/domain/toxicCombos";
import { SEED_ISSUES } from "../src/server/sampleData";

describe("classifyIssue", () => {
  it("matches by source rule id first", () => {
    expect(classifyIssue({ sourceRuleId: "wc-id-2742" })?.id).toBe("bedrock-no-guardrail");
    expect(classifyIssue({ sourceRuleId: "wc-id-3217" })?.id).toBe("gcp-managed-privileged");
    expect(classifyIssue({ sourceRuleId: "wc-id-3230" })?.id).toBe("gcp-hosted-privileged");
    expect(classifyIssue({ sourceRuleId: "wc-id-3123" })?.id).toBe("permissive-exec-identity");
  });

  it("falls back to rule-name patterns when the rule id is absent", () => {
    expect(classifyIssue({ ruleName: "Allow model invoke without Guardrail for user or role" })?.id)
      .toBe("bedrock-no-guardrail");
    expect(classifyIssue({ ruleName: "Managed AI Agent with high privileges or sensitive data access" })?.id)
      .toBe("gcp-managed-privileged");
    expect(classifyIssue({ ruleName: "AI Agent hosted on VM/serverless with high privileges or sensitive data access" })?.id)
      .toBe("gcp-hosted-privileged");
    expect(classifyIssue({ ruleName: "AI resource using overly permissive execution identity" })?.id)
      .toBe("permissive-exec-identity");
  });

  it("returns null for unknown rules", () => {
    expect(classifyIssue({ sourceRuleId: "wc-id-9999", ruleName: "Something else" })).toBeNull();
    expect(classifyIssue({})).toBeNull();
  });

  it("adjusted severities carry the 5Rs amplifier (MEDIUM→HIGH, LOW→MEDIUM)", () => {
    for (const g of COMBO_GROUPS) {
      if (g.nativeSeverity === "MEDIUM") expect(g.adjustedSeverity).toBe("HIGH");
      if (g.nativeSeverity === "LOW") expect(g.adjustedSeverity).toBe("MEDIUM");
      expect(g.amplifierNote.length).toBeGreaterThan(0);
    }
  });
});

describe("seed issues", () => {
  it("has exactly 29 open issues split 8/13/6/2", () => {
    expect(SEED_ISSUES).toHaveLength(29);
    const summary = comboSummary(SEED_ISSUES);
    const byId = Object.fromEntries(summary.map((s) => [s.group.id, s.count]));
    expect(byId).toEqual({
      "bedrock-no-guardrail": 8,
      "gcp-managed-privileged": 13,
      "gcp-hosted-privileged": 6,
      "permissive-exec-identity": 2,
    });
  });

  it("every seed issue classified into a group with an adjusted severity", () => {
    for (const issue of SEED_ISSUES) {
      expect(issue.comboGroup).not.toBe("");
      expect(issue.adjustedSeverity).not.toBe(issue.nativeSeverity);
    }
  });

  it("comboSummary collects distinct asset ids per group", () => {
    const summary = comboSummary(SEED_ISSUES);
    const hosted = summary.find((s) => s.group.id === "gcp-hosted-privileged")!;
    expect(hosted.assetIds.sort()).toEqual(["agent-h-chatbot", "agent-i"]);
    const bedrock = summary.find((s) => s.group.id === "bedrock-no-guardrail")!;
    expect(bedrock.assetIds).toHaveLength(8);
  });
});
