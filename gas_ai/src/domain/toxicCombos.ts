// The four toxic-combination groups observed in the tenant (ai/ai_issues_and_
// complience_overview.md), keyed by Wiz source rule. All 27 MEDIUM issues are treated
// as effectively HIGH because the 5Rs data-security framework sits at 53% — the
// "adjusted severity" carries that amplifier and the UI must always render the note
// alongside it (severity never changes silently, and never by color alone).

import type { Severity } from "./config";
import type { IssueRow } from "./graphTypes";

export interface ComboGroup {
  id: string;
  ruleId: string;
  title: string;
  shortLabel: string;
  nativeSeverity: Severity;
  adjustedSeverity: Severity;
  amplifierNote: string;
  namePattern: RegExp; // fallback classifier when live data arrives without rule ids
  frameworks: {
    owaspLlm: string[];
    owaspAgentic: string[];
    owaspMl: string[];
    fiveRs: string[];
  };
}

export const RISK_CATEGORY_ID = "wct-id-1998";

export const COMBO_GROUPS: ComboGroup[] = [
  {
    id: "bedrock-no-guardrail",
    ruleId: "wc-id-2742",
    title: "AWS Bedrock: model invocation without guardrails",
    shortLabel: "No guardrail on invoke",
    nativeSeverity: "MEDIUM",
    adjustedSeverity: "HIGH",
    amplifierNote:
      "Wiz MEDIUM, treated as HIGH: no content filtering or data protection on model " +
      "calls, and the 5Rs data-security score (53%) confirms restriction controls are failing.",
    namePattern: /without\s+guardrail/i,
    frameworks: {
      owaspLlm: ["LLM06", "LLM02"],
      owaspAgentic: ["ASI02", "ASI03"],
      owaspMl: [],
      fiveRs: ["Restrict"],
    },
  },
  {
    id: "gcp-managed-privileged",
    ruleId: "wc-id-3217",
    title: "GCP managed AI agents: high privileges + sensitive data",
    shortLabel: "Privileged managed agent",
    nativeSeverity: "MEDIUM",
    adjustedSeverity: "HIGH",
    amplifierNote:
      "Wiz MEDIUM, treated as HIGH: prompt injection on an over-privileged managed agent " +
      "reaches sensitive data, and the 5Rs score (53%) confirms that data is not restricted.",
    namePattern: /managed\s+ai\s+agent\s+with\s+high\s+privileges/i,
    frameworks: {
      owaspLlm: ["LLM06", "LLM01"],
      owaspAgentic: ["ASI03", "ASI01"],
      owaspMl: ["Data Poisoning"],
      fiveRs: ["Restrict", "Reconfigure"],
    },
  },
  {
    id: "gcp-hosted-privileged",
    ruleId: "wc-id-3230",
    title: "GCP hosted AI agents on VM/serverless: high privileges + sensitive data",
    shortLabel: "Privileged hosted agent",
    nativeSeverity: "MEDIUM",
    adjustedSeverity: "HIGH",
    amplifierNote:
      "Wiz MEDIUM, treated as HIGH: the agent inherits its host's attack surface (VM / " +
      "serverless), holds excessive IAM, and the 5Rs score (53%) confirms weak data restriction.",
    namePattern: /hosted\s+on\s+vm\/?serverless/i,
    frameworks: {
      owaspLlm: ["LLM06", "LLM01", "LLM02", "LLM05"],
      owaspAgentic: ["ASI02", "ASI03", "ASI05"],
      owaspMl: [],
      fiveRs: ["Restrict", "Reduce"],
    },
  },
  {
    id: "permissive-exec-identity",
    ruleId: "wc-id-3123",
    title: "GCP AI agents: overly permissive execution identity",
    shortLabel: "Permissive identity",
    nativeSeverity: "LOW",
    adjustedSeverity: "MEDIUM",
    amplifierNote:
      "Wiz LOW, treated as MEDIUM: latent privileges — a compromised agent (prompt " +
      "injection → RCE/SSRF) inherits every permission of its execution identity.",
    namePattern: /overly\s+permissive\s+execution\s+identity/i,
    frameworks: {
      owaspLlm: [],
      owaspAgentic: ["ASI03"],
      owaspMl: [],
      fiveRs: ["Reconfigure"],
    },
  },
];

const BY_RULE_ID = new Map(COMBO_GROUPS.map((g) => [g.ruleId, g]));
const BY_GROUP_ID = new Map(COMBO_GROUPS.map((g) => [g.id, g]));

export function comboGroupById(id: string): ComboGroup | null {
  return BY_GROUP_ID.get(id) ?? null;
}

/**
 * Classify an issue into its toxic-combination group: by source rule id first, then
 * by rule-name pattern (live data has been observed arriving without rule ids).
 */
export function classifyIssue(issue: { sourceRuleId?: string | null; ruleName?: string | null }):
  ComboGroup | null {
  if (issue.sourceRuleId) {
    const byId = BY_RULE_ID.get(issue.sourceRuleId);
    if (byId) return byId;
  }
  const name = issue.ruleName ?? "";
  if (name) {
    for (const g of COMBO_GROUPS) {
      if (g.namePattern.test(name)) return g;
    }
  }
  return null;
}

export interface ComboSummary {
  group: ComboGroup;
  count: number;
  assetIds: string[]; // distinct, insertion order
}

/** Per-group rollup over OPEN issues (the Toxic Combinations page payload). */
export function comboSummary(issues: IssueRow[]): ComboSummary[] {
  const acc = new Map<string, { count: number; assetIds: string[]; seen: Set<string> }>();
  for (const g of COMBO_GROUPS) acc.set(g.id, { count: 0, assetIds: [], seen: new Set() });
  for (const issue of issues) {
    if (issue.status !== "OPEN") continue;
    const bucket = acc.get(issue.comboGroup);
    if (!bucket) continue;
    bucket.count += 1;
    if (issue.assetId && !bucket.seen.has(issue.assetId)) {
      bucket.seen.add(issue.assetId);
      bucket.assetIds.push(issue.assetId);
    }
  }
  return COMBO_GROUPS.map((group) => ({
    group,
    count: acc.get(group.id)!.count,
    assetIds: acc.get(group.id)!.assetIds,
  }));
}
