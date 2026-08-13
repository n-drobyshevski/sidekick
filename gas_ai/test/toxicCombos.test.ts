// Toxic-combination classification and the register's bucketing rules: the seed's 32
// issues — 8/13/6/2 across the four modelled groups, plus 3 in Other AI risk.
// Classification works by rule id and by rule-name pattern; bucketing never drops a row.

import { describe, expect, it } from "vitest";
import {
  classifyIssue, COMBO_GROUPS, CONDITION_KEYS, comboGroupById, comboSummary,
  OTHER_AI_RISK, OTHER_GROUP_ID, REGISTER_GROUPS, registerBucketId,
} from "../src/domain/toxicCombos";
import { isUnresolvedIssue } from "../src/domain/config";
import type { IssueRow } from "../src/domain/graphTypes";
import { SEED_ISSUES } from "../src/server/sampleData";

/** A minimal issue row — only the fields the rollups read. */
function row(over: Partial<IssueRow>): IssueRow {
  return {
    id: "i1", ruleId: "", ruleName: "", comboGroup: OTHER_GROUP_ID,
    nativeSeverity: "MEDIUM", adjustedSeverity: "MEDIUM", status: "OPEN",
    assetId: "a1", assetName: "a1", ...over,
  };
}

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

  it("every group names at least one condition, drawn from the shared vocabulary", () => {
    for (const g of COMBO_GROUPS) {
      expect(g.conditions.length).toBeGreaterThan(0);
      for (const key of g.conditions) expect(CONDITION_KEYS).toContain(key);
    }
  });

  it("no rule tests internet exposure — the matrix column is amplifier-only", () => {
    // The condition matrix tells the analyst that every mark in the exposure column is
    // risk stacked ON TOP of the pattern. If a rule ever starts testing exposure that
    // caption becomes a lie, so the claim is pinned here rather than in the copy.
    for (const g of COMBO_GROUPS) {
      expect(g.conditions).not.toContain("INTERNET_EXPOSURE");
    }
  });
});

describe("the Other AI risk bucket", () => {
  it("is not a member of COMBO_GROUPS", () => {
    // syncJobs.syncSteps() maps COMBO_GROUPS into one per-rule ISSUES_<ruleId> step via
    // Q_RULE_ASSETS. A membership here would generate a step querying ruleIds: [""].
    expect(COMBO_GROUPS.map((g) => g.id)).not.toContain(OTHER_GROUP_ID);
    expect(COMBO_GROUPS.every((g) => g.ruleId !== "")).toBe(true);
    expect(REGISTER_GROUPS.map((g) => g.id)).toContain(OTHER_GROUP_ID);
    expect(REGISTER_GROUPS).toHaveLength(COMBO_GROUPS.length + 1);
  });

  it("resolves by id but is never something classifyIssue returns", () => {
    expect(comboGroupById(OTHER_GROUP_ID)?.id).toBe(OTHER_GROUP_ID);
    expect(classifyIssue({ sourceRuleId: "wc-id-9999" })).toBeNull();
    expect(classifyIssue({ ruleName: "Other AI risk" })).toBeNull();
    expect(classifyIssue({ ruleName: OTHER_AI_RISK.title })).toBeNull();
  });

  it("makes no amplifier claim, where every modelled pattern does", () => {
    expect(OTHER_AI_RISK.amplified).toBe(false);
    expect(OTHER_AI_RISK.amplifierNote).toBe("");
    expect(OTHER_AI_RISK.conditions).toEqual([]);
    for (const g of COMBO_GROUPS) expect(g.amplified).toBe(true);
  });

  it("reports the worst severity it actually holds, not a declared one", () => {
    // Declared UNKNOWN would sort a CRITICAL unclassified issue to the bottom of a
    // triage page ranked worst-first.
    const summary = comboSummary([
      row({ id: "a", comboGroup: "unknown-rule", adjustedSeverity: "LOW" }),
      row({ id: "b", comboGroup: "unknown-rule", adjustedSeverity: "CRITICAL" }),
    ]);
    const other = summary.find((s) => s.group.id === OTHER_GROUP_ID)!;
    expect(other.count).toBe(2);
    expect(other.group.adjustedSeverity).toBe("CRITICAL");
    // The shared constant is not mutated by the override.
    expect(OTHER_AI_RISK.adjustedSeverity).toBe("UNKNOWN");
  });
});

describe("comboSummary counts everything unresolved", () => {
  it("buckets an unrecognised group id into Other rather than dropping it", () => {
    // The old `if (!bucket) continue` is exactly how renaming a group id would silently
    // empty the register.
    const issues = [
      row({ id: "a", comboGroup: "a-group-that-was-renamed" }),
      row({ id: "b", comboGroup: "bedrock-no-guardrail" }),
    ];
    const summary = comboSummary(issues);
    const total = summary.reduce((n, s) => n + s.count, 0);
    expect(total).toBe(2);
    expect(summary.find((s) => s.group.id === OTHER_GROUP_ID)!.count).toBe(1);
    expect(registerBucketId({ comboGroup: "a-group-that-was-renamed" })).toBe(OTHER_GROUP_ID);
    expect(registerBucketId({ comboGroup: "bedrock-no-guardrail" })).toBe("bedrock-no-guardrail");
  });

  it("counts IN_PROGRESS and excludes resolved work", () => {
    const issues = [
      row({ id: "a", status: "OPEN" }),
      row({ id: "b", status: "IN_PROGRESS" }),
      row({ id: "c", status: "RESOLVED" }),
      row({ id: "d", status: "REJECTED" }),
    ];
    const total = comboSummary(issues).reduce((n, s) => n + s.count, 0);
    expect(total).toBe(2);
  });

  it("sums to the unresolved issue count — the invariant that nothing vanishes", () => {
    for (const issues of [
      SEED_ISSUES,
      [...SEED_ISSUES, row({ id: "x", comboGroup: "renamed" }), row({ id: "y", status: "IN_PROGRESS" })],
    ]) {
      const total = comboSummary(issues).reduce((n, s) => n + s.count, 0);
      expect(total).toBe(issues.filter(isUnresolvedIssue).length);
    }
  });
});

describe("seed issues", () => {
  it("has 32 unresolved issues: 8/13/6/2 across the patterns, 3 in Other", () => {
    expect(SEED_ISSUES).toHaveLength(32);
    const summary = comboSummary(SEED_ISSUES);
    const byId = Object.fromEntries(summary.map((s) => [s.group.id, s.count]));
    expect(byId).toEqual({
      "bedrock-no-guardrail": 8,
      "gcp-managed-privileged": 13,
      "gcp-hosted-privileged": 6,
      "permissive-exec-identity": 2,
      [OTHER_GROUP_ID]: 3,
    });
  });

  it("modelled issues are amplified; the Other cohort keeps Wiz's severity", () => {
    for (const issue of SEED_ISSUES) {
      expect(issue.comboGroup).not.toBe("");
      if (issue.comboGroup === OTHER_GROUP_ID) {
        // No pattern, no amplifier claim, no re-rating.
        expect(issue.adjustedSeverity).toBe(issue.nativeSeverity);
      } else {
        expect(issue.adjustedSeverity).not.toBe(issue.nativeSeverity);
      }
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
