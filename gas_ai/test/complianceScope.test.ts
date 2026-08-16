// The 5Rs derived AI-relevance scope.
//
// Five invariants carry this file:
//
//   1. The signal is a UNION of two HARD facts — crossMapped (Wiz itself filed the same
//      policyId under a collected OWASP AI framework) and linkedFindings (an open gap on
//      the policy sits on a synced AI asset) — never an inference over the rule's own name
//      or metadata. Neither firing means out of scope, reason noAiLink.
//   2. THE TRAP IS REAL AND MUST STAY VISIBLE. A policy whose only findings sit on a
//      resource this app has not synced as an AI asset (the REGION / RAW_ACCESS_POLICY case
//      api.ts:665-671 describes) is scoped OUT unless it is also cross-mapped. Both arms are
//      pinned below so the signal's blind spot is documented, not silently relied on.
//   3. isOpenGap gates linkedFindings exactly like it gates every other compliance-gap count
//      in this app: a RESOLVED or deleted finding on an AI asset contributes nothing.
//   4. Pins beat derivation in BOTH directions and report pinnedIn/pinnedOut, never a
//      derived reason — and a policyId stored in both lists resolves to `out`, deterministically.
//   5. Ordering (out-of-scope first, then worst severity, then failCount desc, then name) and
//      grouping (a multiply-mapped policy collapses to ONE row, keyed to the FIRST
//      subcategory it was found under) do not depend on the order `trees` was handed in.

import { describe, expect, it } from "vitest";

import { buildAllFrameworkTrees, buildFrameworkTree } from "../src/domain/compliancePosture";
import {
  SCOPE_REASONS, scopeFiveRs, unselectedPolicyIds, type ScopeReason,
} from "../src/domain/complianceScope";
import type { FindingRow, FrameworkPolicyRow, PostureRow } from "../src/domain/graphTypes";
import {
  normalizeCompliancePosturePage, normalizeFrameworksPage,
} from "../src/domain/syncNormalize";
import {
  AGENTIC_FRAMEWORK, FIVE_RS_FRAMEWORK, FRAMEWORK_CATALOGUE,
} from "./frameworkPosture.fixture";

// ------------------------------------------------------------------------------------------
// Part 1: the real fixture. `failingCloudRule` / AIService-003 is mapped under 5Rs "2.1"
// AND under Agentic's ASI01 + ASI10 — the one control in the fixture that is genuinely
// cross-mapped into a collected AI framework. Built exactly like complianceOverview.test.ts.

const agentic = normalizeCompliancePosturePage([AGENTIC_FRAMEWORK]);
const fiveRs = normalizeCompliancePosturePage([FIVE_RS_FRAMEWORK]);
const posture = [...agentic.posture, ...fiveRs.posture];
const policies = [...agentic.frameworkPolicies, ...fiveRs.frameworkPolicies];
const frameworks = normalizeFrameworksPage(FRAMEWORK_CATALOGUE).frameworks;
const realTrees = buildAllFrameworkTrees(posture, policies, frameworks);

describe("scopeFiveRs — the real fixture's cross-mapped control", () => {
  const scope = scopeFiveRs(realTrees, [], {}, { in: [], out: [] });

  it("finds the 5Rs tree by family (frameworkFamily), never by the tenant-local id", () => {
    expect(scope.frameworkId).toBe("wf-id-214");
    expect(scope.frameworkName).toBe("5Rs - Wiz for Data Security");
  });

  it("selects AIService-003, reason crossMapped, naming the framework that maps it", () => {
    // FIVE_RS_FRAMEWORK maps exactly one policy in the fixture (subcategory 2.1) — see
    // frameworkPosture.fixture.ts's `failingCloudRule`.
    expect(scope.policies).toHaveLength(1);
    const row = scope.policies[0];
    expect(row.policyId).toBe("763ebc07-852e-40bd-abc9-e8e38d2d1308");
    expect(row.shortId).toBe("AIService-003");
    expect(row.selected).toBe(true);
    expect(row.reason).toBe("crossMapped");
    expect(row.mappedBy).toEqual(["OWASP Top 10 For Agentic Applications 2026"]);
    // The 5Rs tree's own mapping row reports failCount 10 — see compliancePosture.test.ts's
    // identical read of this same fixture row.
    expect(row.failCount).toBe(10);
    expect(row.aiFindingCount).toBe(0);
    expect(scope.selected).toBe(1);
    expect(scope.total).toBe(1);
  });
});

describe("scopeFiveRs — no 5Rs framework collected", () => {
  it("returns frameworkId null and an empty scope, without throwing", () => {
    const treesWithoutFiveRs = buildAllFrameworkTrees(
      agentic.posture, agentic.frameworkPolicies, frameworks,
    );
    const scope = scopeFiveRs(treesWithoutFiveRs, [], {}, { in: [], out: [] });
    expect(scope.frameworkId).toBeNull();
    expect(scope.frameworkName).toBe("");
    expect(scope.policies).toEqual([]);
    expect(scope.selected).toBe(0);
    expect(scope.total).toBe(0);
    expect(unselectedPolicyIds(scope)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------
// Part 2: a synthetic 5Rs tree, built the way compliancePosture.test.ts's "orphan" and
// "extra" cases do — hand-written PostureRow / FrameworkPolicyRow arrays through
// buildFrameworkTree directly — because the fixture's one real policy cannot exercise
// linkedFindings, noAiLink, the trap, and multi-mapping all at once.

const SYNTH_5RS_ID = "wf-id-synth-5rs";
const SYNTH_ASI_ID = "wf-id-synth-asi";

const SYNTH_5RS_POSTURE: PostureRow[] = [
  {
    frameworkId: SYNTH_5RS_ID, level: "framework", title: "5Rs - Wiz for Data Security",
    posturePct: 50, passCount: 0, failCount: 0, emptyPostureReason: null,
  },
  {
    frameworkId: SYNTH_5RS_ID, level: "category", categoryExternalId: "1", title: "Reduce",
    posturePct: 50, passCount: 0, failCount: 0, emptyPostureReason: null,
  },
  {
    frameworkId: SYNTH_5RS_ID, level: "subcategory", categoryExternalId: "1",
    subcategoryExternalId: "1.1", title: "Stale data resources",
    posturePct: 50, passCount: 0, failCount: 1, emptyPostureReason: null,
  },
  {
    frameworkId: SYNTH_5RS_ID, level: "category", categoryExternalId: "2", title: "Restrict",
    posturePct: 50, passCount: 0, failCount: 0, emptyPostureReason: null,
  },
  {
    frameworkId: SYNTH_5RS_ID, level: "subcategory", categoryExternalId: "2",
    subcategoryExternalId: "2.1", title: "Public data exposure",
    posturePct: 50, passCount: 0, failCount: 6, emptyPostureReason: null,
  },
];

// Six distinct policyIds: one plain linked-finding case, one plain no-link case, the trap's
// two arms (identical shape, different cross-map status), a policy whose only findings are
// not open gaps, and a policy mapped under TWO subcategories to pin the dedupe + grouping
// rule.
const SYNTH_5RS_POLICIES: FrameworkPolicyRow[] = [
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "2", subcategoryExternalId: "2.1",
    policyId: "policy-linked", policyKind: "CLOUD_RULE", shortId: "LNK-001",
    name: "Data linked to AI asset", severity: "HIGH",
    passCount: 0, failCount: 3, assessedCount: 3, rejectedCount: 0, noResourceToAssess: false,
  },
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "2", subcategoryExternalId: "2.1",
    policyId: "policy-no-ai-link", policyKind: "CLOUD_RULE", shortId: "NOAI-001",
    name: "Generic data control", severity: "LOW",
    passCount: 0, failCount: 2, assessedCount: 2, rejectedCount: 0, noResourceToAssess: false,
  },
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "2", subcategoryExternalId: "2.1",
    policyId: "policy-trap-out", policyKind: "CLOUD_RULE", shortId: "TRAP-OUT-001",
    name: "Trap rule, not cross-mapped", severity: "MEDIUM",
    passCount: 0, failCount: 4, assessedCount: 4, rejectedCount: 0, noResourceToAssess: false,
  },
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "2", subcategoryExternalId: "2.1",
    policyId: "policy-trap-in", policyKind: "CLOUD_RULE", shortId: "TRAP-IN-001",
    name: "Trap rule, cross-mapped", severity: "MEDIUM",
    passCount: 0, failCount: 4, assessedCount: 4, rejectedCount: 0, noResourceToAssess: false,
  },
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "2", subcategoryExternalId: "2.1",
    policyId: "policy-not-open-gap", policyKind: "CLOUD_RULE", shortId: "CLOSED-001",
    name: "Rule with only closed findings", severity: "CRITICAL",
    passCount: 0, failCount: 5, assessedCount: 5, rejectedCount: 0, noResourceToAssess: false,
  },
  // Mapped under "1.1" FIRST, then "2.1" — the same policyId recurs, as buildFrameworkTree
  // legitimately allows (compliancePosture.ts). failCount differs per row on purpose (1 vs
  // 7) to pin that scopeFiveRs takes the MAX, not the first-seen or the sum.
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "1", subcategoryExternalId: "1.1",
    policyId: "policy-multi", policyKind: "CONTROL", shortId: "MULTI-001",
    name: "Multiply-mapped rule", severity: "LOW",
    passCount: 0, failCount: 1, assessedCount: 1, rejectedCount: 0, noResourceToAssess: false,
  },
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "2", subcategoryExternalId: "2.1",
    policyId: "policy-multi", policyKind: "CONTROL", shortId: "MULTI-001",
    name: "Multiply-mapped rule", severity: "LOW",
    passCount: 0, failCount: 7, assessedCount: 7, rejectedCount: 0, noResourceToAssess: false,
  },
];

const SYNTH_ASI_POSTURE: PostureRow[] = [
  {
    frameworkId: SYNTH_ASI_ID, level: "framework",
    title: "OWASP Top 10 For Agentic Applications 2026",
    posturePct: 80, passCount: 0, failCount: 0, emptyPostureReason: null,
  },
  {
    frameworkId: SYNTH_ASI_ID, level: "category", categoryExternalId: "ASI01",
    title: "ASI01 Agent Goal Hijack",
    posturePct: 80, passCount: 0, failCount: 0, emptyPostureReason: null,
  },
  {
    frameworkId: SYNTH_ASI_ID, level: "subcategory", categoryExternalId: "ASI01",
    subcategoryExternalId: "ASI01", title: "ASI01 Agent Goal Hijack",
    posturePct: 80, passCount: 0, failCount: 1, emptyPostureReason: null,
  },
];

// Only ONE policy from the 5Rs set is also filed here — "policy-trap-in" — which is exactly
// what turns it, and only it, into the trap's rescued arm.
const SYNTH_ASI_POLICIES: FrameworkPolicyRow[] = [
  {
    frameworkId: SYNTH_ASI_ID, categoryExternalId: "ASI01", subcategoryExternalId: "ASI01",
    policyId: "policy-trap-in", policyKind: "CLOUD_RULE", shortId: "TRAP-IN-001",
    name: "Trap rule, cross-mapped", severity: "MEDIUM",
    passCount: 0, failCount: 1, assessedCount: 1, rejectedCount: 0, noResourceToAssess: false,
  },
];

const synth5RsTree = buildFrameworkTree(SYNTH_5RS_ID, SYNTH_5RS_POSTURE, SYNTH_5RS_POLICIES)!;
const synthAsiTree = buildFrameworkTree(SYNTH_ASI_ID, SYNTH_ASI_POSTURE, SYNTH_ASI_POLICIES)!;

const aiAssetIds: Record<string, true> = { "ai-asset-1": true, "ai-asset-2": true };

function finding(overrides: Partial<FindingRow> & Pick<FindingRow, "id" | "resourceId">): FindingRow {
  return {
    ruleShortId: "UNUSED", severity: "MEDIUM", frameworkCodes: [], status: "OPEN", result: "FAIL",
    ...overrides,
  };
}

const findings: FindingRow[] = [
  // policy-linked: two open findings on two AI assets, matched one by ruleId and one by
  // ruleShortId — "match on either" (graphTypes.ts says the two are the same identifiers).
  finding({
    id: "f-link-by-id", resourceId: "ai-asset-1", ruleId: "policy-linked", ruleShortId: "OTHER",
  }),
  finding({
    id: "f-link-by-short", resourceId: "ai-asset-2", ruleId: undefined, ruleShortId: "LNK-001",
  }),
  // The trap: an open gap on each trap policy, but on a resource that was never synced as
  // an AI asset — a REGION / RAW_ACCESS_POLICY stand-in.
  finding({
    id: "f-trap-out", resourceId: "region-us-east-1", ruleId: "policy-trap-out",
    ruleShortId: "TRAP-OUT-001",
  }),
  finding({
    id: "f-trap-in", resourceId: "raw-access-policy-1", ruleId: "policy-trap-in",
    ruleShortId: "TRAP-IN-001",
  }),
  // policy-not-open-gap: findings ARE on AI assets, but neither is an open gap.
  finding({
    id: "f-resolved", resourceId: "ai-asset-1", ruleId: "policy-not-open-gap",
    ruleShortId: "CLOSED-001", status: "RESOLVED", result: "PASS",
  }),
  finding({
    id: "f-deleted", resourceId: "ai-asset-2", ruleId: "policy-not-open-gap",
    ruleShortId: "CLOSED-001", deleted: true,
  }),
];

const noPins = { in: [], out: [] };

describe("scopeFiveRs — derived reasons (no cross-mapped AI framework in `trees`)", () => {
  const scope = scopeFiveRs([synth5RsTree], findings, aiAssetIds, noPins);
  const byId = new Map(scope.policies.map((p) => [p.policyId, p]));

  it("selects a policy with an open gap on an AI asset, reason linkedFindings", () => {
    const row = byId.get("policy-linked")!;
    expect(row.selected).toBe(true);
    expect(row.reason).toBe("linkedFindings");
    expect(row.aiFindingCount).toBe(2);
    expect(row.mappedBy).toEqual([]);
  });

  it("does not select a policy with neither signal, reason noAiLink", () => {
    const row = byId.get("policy-no-ai-link")!;
    expect(row.selected).toBe(false);
    expect(row.reason).toBe("noAiLink");
    expect(row.aiFindingCount).toBe(0);
  });

  it("THE TRAP: an open gap on a non-AI resource does not select the policy on its own", () => {
    const row = byId.get("policy-trap-out")!;
    expect(row.selected).toBe(false);
    expect(row.reason).toBe("noAiLink");
    // The finding exists and is an open gap — it simply is not ON a synced AI asset, so it
    // contributes nothing to the count. This is the exact gap the module header names.
    expect(row.aiFindingCount).toBe(0);
  });

  it("a finding that is not an open gap (RESOLVED or deleted) never counts", () => {
    const row = byId.get("policy-not-open-gap")!;
    expect(row.aiFindingCount).toBe(0);
    expect(row.selected).toBe(false);
    expect(row.reason).toBe("noAiLink");
  });

  it("a policy mapped under two subcategories collapses to ONE row", () => {
    expect(scope.policies.filter((p) => p.policyId === "policy-multi")).toHaveLength(1);
    const row = byId.get("policy-multi")!;
    // "1.1" was reached before "2.1" while walking the tree's own categories — the FIRST
    // subcategory wins the grouping fields, purely as a display choice.
    expect(row.categoryExternalId).toBe("1");
    expect(row.subcategoryExternalId).toBe("1.1");
    expect(row.subcategoryTitle).toBe("Stale data resources");
    // MAX across its two mapping rows (1 and 7), never the first-seen value and never the
    // sum — the same discipline sharedControls applies in complianceOverview.ts.
    expect(row.failCount).toBe(7);
  });

  it("total and selected reconcile with the policies actually returned", () => {
    expect(scope.total).toBe(scope.policies.length);
    expect(scope.total).toBe(6);
    expect(scope.selected).toBe(scope.policies.filter((p) => p.selected).length);
    expect(scope.selected).toBe(1); // only policy-linked, in this tree set
  });
});

describe("scopeFiveRs — THE TRAP's rescued arm: cross-mapped beats an off-asset finding", () => {
  const scope = scopeFiveRs([synth5RsTree, synthAsiTree], findings, aiAssetIds, noPins);
  const byId = new Map(scope.policies.map((p) => [p.policyId, p]));

  it("selects policy-trap-in once an AI framework also maps it, even though its only " +
    "finding still sits off an AI asset", () => {
    const row = byId.get("policy-trap-in")!;
    expect(row.selected).toBe(true);
    expect(row.reason).toBe("crossMapped");
    expect(row.mappedBy).toEqual(["OWASP Top 10 For Agentic Applications 2026"]);
    // Unchanged from the arm above: the off-asset finding still contributes nothing. It is
    // the cross-map, not the finding, that rescues this policy.
    expect(row.aiFindingCount).toBe(0);
  });

  it("leaves policy-trap-out scoped out — nothing maps IT into an AI framework", () => {
    const row = byId.get("policy-trap-out")!;
    expect(row.selected).toBe(false);
    expect(row.reason).toBe("noAiLink");
  });
});

describe("scopeFiveRs — operator pins", () => {
  it("pins IN a policy that would otherwise derive noAiLink", () => {
    const scope = scopeFiveRs(
      [synth5RsTree], findings, aiAssetIds, { in: ["policy-no-ai-link"], out: [] },
    );
    const row = scope.policies.find((p) => p.policyId === "policy-no-ai-link")!;
    expect(row.selected).toBe(true);
    expect(row.reason).toBe("pinnedIn");
  });

  it("pins OUT a policy that would otherwise derive linkedFindings", () => {
    const scope = scopeFiveRs(
      [synth5RsTree], findings, aiAssetIds, { in: [], out: ["policy-linked"] },
    );
    const row = scope.policies.find((p) => p.policyId === "policy-linked")!;
    expect(row.selected).toBe(false);
    expect(row.reason).toBe("pinnedOut");
  });

  it("resolves a policyId pinned in BOTH lists to out, deterministically", () => {
    const scope = scopeFiveRs(
      [synth5RsTree], findings, aiAssetIds,
      { in: ["policy-multi"], out: ["policy-multi"] },
    );
    const row = scope.policies.find((p) => p.policyId === "policy-multi")!;
    expect(row.selected).toBe(false);
    expect(row.reason).toBe("pinnedOut");
  });
});

describe("unselectedPolicyIds", () => {
  it("returns exactly the unselected policyIds, nothing more or less", () => {
    const scope = scopeFiveRs([synth5RsTree], findings, aiAssetIds, noPins);
    const expected = scope.policies.filter((p) => !p.selected).map((p) => p.policyId);
    expect(unselectedPolicyIds(scope)).toEqual(expected);
    expect(unselectedPolicyIds(scope).sort()).toEqual([
      "policy-multi", "policy-no-ai-link", "policy-not-open-gap", "policy-trap-in",
      "policy-trap-out",
    ].sort());
  });
});

describe("scopeFiveRs — deterministic ordering", () => {
  it("orders out-of-scope first, then worst severity, then failCount desc, then name", () => {
    const scope = scopeFiveRs([synth5RsTree, synthAsiTree], findings, aiAssetIds, noPins);
    expect(scope.policies.map((p) => p.policyId)).toEqual([
      // Out of scope, CRITICAL first, then MEDIUM, then LOW-by-failCount-desc:
      "policy-not-open-gap", // CRITICAL
      "policy-trap-out",     // MEDIUM
      "policy-multi",        // LOW, failCount 7
      "policy-no-ai-link",   // LOW, failCount 2
      // In scope, HIGH before MEDIUM:
      "policy-linked",       // HIGH
      "policy-trap-in",      // MEDIUM
    ]);
  });

  it("is unaffected by the order `trees` is handed in", () => {
    const forward = scopeFiveRs([synth5RsTree, synthAsiTree], findings, aiAssetIds, noPins);
    const reversed = scopeFiveRs([synthAsiTree, synth5RsTree], findings, aiAssetIds, noPins);
    expect(reversed.policies).toEqual(forward.policies);
    expect(reversed.frameworkId).toBe(forward.frameworkId);
  });
});

describe("SCOPE_REASONS — the UI's only source of label/blurb copy", () => {
  it("carries a non-empty label and blurb for every ScopeReason", () => {
    const reasons: ScopeReason[] = [
      "crossMapped", "linkedFindings", "noAiLink", "pinnedIn", "pinnedOut",
    ];
    for (const reason of reasons) {
      expect(SCOPE_REASONS[reason].label.length).toBeGreaterThan(0);
      expect(SCOPE_REASONS[reason].blurb.length).toBeGreaterThan(0);
    }
  });
});
