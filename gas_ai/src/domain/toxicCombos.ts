// The four toxic-combination groups observed in the tenant (ai/ai_issues_and_
// complience_overview.md), keyed by Wiz source rule. All 27 MEDIUM issues are treated
// as effectively HIGH because the 5Rs data-security framework sits at 53% — the
// "adjusted severity" carries that amplifier and the UI must always render the note
// alongside it (severity never changes silently, and never by color alone).

import { isUnresolvedIssue, type Severity } from "./config";
import { severityRank, type IssueRow, type NodeKind } from "./graphTypes";

/**
 * The risk conditions a combination is built out of, named as the graph's own risk-node
 * kinds so the two pages share one vocabulary: the Toxic Combinations matrix labels a
 * column with the same icon and words the Security Graph hangs off the asset.
 */
export const CONDITION_KEYS = [
  "MISSING_GUARDRAIL", "EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA", "INTERNET_EXPOSURE",
] as const satisfies readonly NodeKind[];
export type ConditionKey = (typeof CONDITION_KEYS)[number];

export interface ComboGroup {
  id: string;
  ruleId: string;
  title: string;
  shortLabel: string;
  nativeSeverity: Severity;
  adjustedSeverity: Severity;
  amplifierNote: string;
  namePattern: RegExp; // fallback classifier when live data arrives without rule ids
  /**
   * The conditions the source rule TESTS — what makes this pattern this pattern. Several
   * rules test theirs disjunctively ("high privileges OR sensitive data access"), so a
   * listed condition is not a promise that every affected asset carries it; that is the
   * measured half, and the matrix shows the two side by side. INTERNET_EXPOSURE is
   * deliberately in no rule's list: it is the amplifier that shows up on top.
   */
  conditions: ConditionKey[];
  /**
   * Whether this group re-rates its issues above their Wiz severity. True for every
   * modelled pattern; false only for the Other bucket, which carries Wiz's severity
   * through untouched. Declared rather than inferred from the id, so the UI branches on
   * a property (and renders the amplifier note beside adjusted severity exactly when
   * there is a claim to justify) instead of sniffing for a magic string.
   */
  amplified: boolean;
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
    conditions: ["MISSING_GUARDRAIL"],
    amplified: true,
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
    conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA"],
    amplified: true,
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
    conditions: ["EXCESSIVE_PRIVILEGE", "SENSITIVE_DATA"],
    amplified: true,
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
    conditions: ["EXCESSIVE_PRIVILEGE"],
    amplified: true,
    frameworks: {
      owaspLlm: [],
      owaspAgentic: ["ASI03"],
      owaspMl: [],
      fiveRs: ["Reconfigure"],
    },
  },
];

export const OTHER_GROUP_ID = "other-ai-risk";

/**
 * The residue: an issue in the AI risk category whose source rule is none of the four
 * modelled patterns. The register collects the whole category, so these are real rows —
 * before this bucket existed comboSummary dropped them on the floor and the page total
 * silently disagreed with the Wiz console.
 *
 * It lives OUTSIDE COMBO_GROUPS, and that is not tidiness. COMBO_GROUPS is what
 * syncJobs.syncSteps() iterates to generate one per-rule `ISSUES_<ruleId>` fallback step
 * via Q_RULE_ASSETS; a member here would generate a step querying `ruleIds: [""]`. It is
 * also what the combo legend, the graph's grouping order and the "N patterns" tally are
 * made of, and this is a bucket, not a pattern: it has no source rule to query and no
 * amplifier to justify.
 *
 * Its declared severity is UNKNOWN because the bucket holds a mix; comboSummary replaces
 * it with the worst severity actually present, so the card ranks on measured content
 * rather than on a claim.
 */
export const OTHER_AI_RISK: ComboGroup = {
  id: OTHER_GROUP_ID,
  ruleId: "",
  title: "Other AI risk",
  shortLabel: "Other AI risk",
  nativeSeverity: "UNKNOWN",
  adjustedSeverity: "UNKNOWN",
  amplifierNote: "",
  namePattern: /(?!)/, // matches nothing: classifyIssue must never return this
  conditions: [],
  amplified: false,
  frameworks: { owaspLlm: [], owaspAgentic: [], owaspMl: [], fiveRs: [] },
};

/** Every bucket the register counts into, in display order. */
export const REGISTER_GROUPS: ComboGroup[] = [...COMBO_GROUPS, OTHER_AI_RISK];

/**
 * The `COMBO_<…>` pillar-B gap code `AarsRule.gapUnit: "condition"` prices for a combo
 * group — one per distinct group an asset's open issues fall into
 * (`graphEnrich.deriveAarsInput`).
 *
 * `OTHER_GROUP_ID` is deliberately INCLUDED, as `COMBO_OTHER` rather than the literal slug
 * `COMBO_OTHER_AI_RISK`: an asset whose only open issue is an unclassified AI-risk finding
 * contributing NOTHING to pillar B is the "code" unit's bimodality bug in miniature — one
 * regex match away from a gap that either mints many codes or none. Pricing the bucket,
 * even generically, is what keeps that from repeating under `"condition"`.
 */
export function comboGapCode(comboGroupId: string): string {
  if (comboGroupId === OTHER_GROUP_ID) return "COMBO_OTHER";
  return `COMBO_${comboGroupId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

const BY_RULE_ID = new Map(COMBO_GROUPS.map((g) => [g.ruleId, g]));
const BY_GROUP_ID = new Map(REGISTER_GROUPS.map((g) => [g.id, g]));

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

/**
 * Which register bucket an issue counts into: its own group when that group is one the
 * register knows, Other otherwise. The fallback is what makes "nothing vanishes" true —
 * an unrecognised id (a rule outside the four patterns, or a group renamed in a later
 * release) lands in Other instead of being skipped.
 *
 * Exported because comboSummary and comboDigest must bucket identically; they used to
 * disagree, one counting by lookup and the other by strict id equality.
 */
export function registerBucketId(issue: { comboGroup?: string }): string {
  const id = issue.comboGroup ?? "";
  return BY_GROUP_ID.has(id) ? id : OTHER_GROUP_ID;
}

export interface ComboSummary {
  group: ComboGroup;
  count: number;
  assetIds: string[]; // distinct, insertion order
}

/**
 * Per-group rollup over UNRESOLVED issues (the Toxic Combinations page payload).
 *
 * Two properties this function now guarantees, both of which it used to break:
 *
 * Nothing vanishes. An issue whose comboGroup names no known bucket falls into Other
 * rather than being skipped, so `sum(counts) === issues.filter(isUnresolvedIssue).length`
 * is an invariant. The old `if (!bucket) continue` is exactly how a renamed group id
 * would silently empty the register.
 *
 * IN_PROGRESS counts. The Wiz filter asks for it, so the rollup counts it; otherwise
 * remediation in flight disappears from the page that exists to track remediation.
 */
export function comboSummary(issues: IssueRow[]): ComboSummary[] {
  const acc = new Map<
    string,
    { count: number; assetIds: string[]; seen: Set<string>; worst: Severity }
  >();
  for (const g of REGISTER_GROUPS) {
    acc.set(g.id, { count: 0, assetIds: [], seen: new Set(), worst: "UNKNOWN" });
  }
  for (const issue of issues) {
    if (!isUnresolvedIssue(issue)) continue;
    const bucket = acc.get(registerBucketId(issue))!;
    bucket.count += 1;
    if (severityRank(issue.adjustedSeverity) < severityRank(bucket.worst)) {
      bucket.worst = issue.adjustedSeverity;
    }
    if (issue.assetId && !bucket.seen.has(issue.assetId)) {
      bucket.seen.add(issue.assetId);
      bucket.assetIds.push(issue.assetId);
    }
  }
  return REGISTER_GROUPS.map((group) => {
    const bucket = acc.get(group.id)!;
    return {
      // A modelled pattern declares its severities and stands by them. The Other bucket
      // has no claim to make, so it reports the worst severity it actually holds —
      // otherwise a genuinely CRITICAL unclassified issue would sort to the bottom of a
      // triage page behind four MEDIUMs.
      group: group.amplified
        ? group
        : { ...group, nativeSeverity: bucket.worst, adjustedSeverity: bucket.worst },
      count: bucket.count,
      assetIds: bucket.assetIds,
    };
  });
}
