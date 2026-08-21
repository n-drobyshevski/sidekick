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
  SCOPE_REASONS, scopeFiveRs, unselectedPolicyIds, withCountsFrom, type ScopeReason,
} from "../src/domain/complianceScope";
import { fiveRsDerivedPosture } from "../src/domain/fiveRsPosture";
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
  // legitimately allows (compliancePosture.ts). failCount AND passCount differ per row on
  // purpose (1 vs 7, 12 vs 5) to pin that scopeFiveRs takes the MAX of each independently,
  // not the first-seen row and not the sum. `enabled` also disagrees (true, then false) to
  // pin the sticky-false rule: the LATER row's `false` wins even though it is not the row
  // that wins the display fields.
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "1", subcategoryExternalId: "1.1",
    policyId: "policy-multi", policyKind: "CONTROL", shortId: "MULTI-001",
    name: "Multiply-mapped rule", severity: "LOW", enabled: true,
    passCount: 12, failCount: 1, assessedCount: 13, rejectedCount: 0, noResourceToAssess: false,
  },
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "2", subcategoryExternalId: "2.1",
    policyId: "policy-multi", policyKind: "CONTROL", shortId: "MULTI-001",
    name: "Multiply-mapped rule", severity: "LOW", enabled: false,
    passCount: 5, failCount: 7, assessedCount: 12, rejectedCount: 0, noResourceToAssess: false,
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
    // Same MAX discipline for passCount, independently of failCount — the two rows disagree
    // in OPPOSITE directions (12>5 for passCount, 1<7 for failCount) so a bug that reused
    // one field's max for the other would be caught.
    expect(row.passCount).toBe(12);
    // Sticky false: the first row says enabled:true, the second says enabled:false, and the
    // false wins even though it is not the row that won categoryExternalId/subcategoryTitle
    // above — the two ties are decided independently.
    expect(row.enabled).toBe(false);
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

// The composition, not the two halves. fiveRsPosture.test.ts pins the arithmetic against
// hand-built PolicyScope rows; this asserts that the rows scopeFiveRs actually PRODUCES —
// carrying the passCount it accumulated by MAX and the `enabled` it resolved sticky-false —
// reach that arithmetic intact. A field added to PolicyScope and never threaded through is
// exactly the kind of break neither unit suite can see on its own, and it is not
// hypothetical: `enabled` sat on FrameworkPolicyRow, stored and unread, until this feature.
//
// It lives HERE rather than in complianceEndToEnd.test.ts because getCompliance is cached
// on a frozen clock (see that file's pin round-trip case), so a pin cannot be observed to
// move a percentage there. There is no cache at all in this file.
describe("scopeFiveRs → fiveRsDerivedPosture", () => {
  const derive = (pins: { in: string[]; out: string[] }) => fiveRsDerivedPosture(
    scopeFiveRs([synth5RsTree, synthAsiTree], findings, aiAssetIds, pins), 85,
  )!;

  it("computes over the policies the scope selected, and no others", () => {
    const derived = derive(noPins);
    // policy-linked (0/3) and policy-trap-in (0/4) are the two in scope. The four rules
    // scoped out carry their own counts and contribute nothing.
    expect(derived.frameworkId).toBe(SYNTH_5RS_ID);
    expect(derived.activePolicyCount).toBe(2);
    expect(derived.passCount).toBe(0);
    expect(derived.failCount).toBe(7);
    // A REAL 0 — seven checks ran under the active rules and every one failed. Not the
    // null that means "nothing was evaluated".
    expect(derived.posturePct).toBe(0);
    expect(derived.controlPassPct).toBe(0);
    expect(derived.wizPosturePct).toBe(85);
  });

  it("excludes a pinned-in rule that Wiz has disabled, and NAMES it rather than dropping it", () => {
    // policy-multi is mapped twice with `enabled` true then false, so the scope resolves it
    // sticky-false. Pinning it IN makes it `selected` — an operator saying "this rule is
    // AI-relevant" — but selected is not the same claim as running: its 12 passing checks
    // must stay out of the arithmetic, and the reader must be told one rule was held back
    // rather than left to wonder why the denominator did not move.
    const derived = derive({ in: ["policy-multi"], out: [] });
    expect(derived.activePolicyCount).toBe(2);
    expect(derived.disabledPolicyCount).toBe(1);
    expect(derived.passCount).toBe(0);
  });

  it("returns null when there is no 5Rs framework to derive over", () => {
    expect(fiveRsDerivedPosture(
      scopeFiveRs([synthAsiTree], findings, aiAssetIds, noPins), null,
    )).toBeNull();
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

// ------------------------------------------------------------------------------------------
// withCountsFrom: the same verdicts over a different set of trees.
//
// This is what lets a project-scoped compliance page state a derived 5Rs posture without
// either re-deciding what is in AI scope (a persisted, register-wide call — see
// scopeFiveRs's own header) or leaving that one figure describing the register while every
// number beside it describes a project. The split is verdict from arithmetic, and these
// tests pin the seam: the verdict fields come from the original scope, every count comes
// from the trees handed in, and a policy those trees do not carry is DROPPED.

/** The 5Rs tree as Wiz would report it for a narrower population. */
const SCOPED_5RS_POLICIES: FrameworkPolicyRow[] = [
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "2", subcategoryExternalId: "2.1",
    policyId: "policy-linked", policyKind: "CLOUD_RULE", shortId: "LNK-001",
    name: "Data linked to AI asset", severity: "HIGH",
    passCount: 40, failCount: 1, assessedCount: 41, rejectedCount: 0, noResourceToAssess: false,
  },
  // Multiply-mapped again, with the MAX on a DIFFERENT row than the register-wide fixture
  // put it: 9 here comes from the second mapping, 3 from the first. A reader of the first
  // row alone would report 3.
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "1", subcategoryExternalId: "1.1",
    policyId: "policy-multi", policyKind: "CONTROL", shortId: "MULTI-001",
    name: "Multiply-mapped rule", severity: "LOW", enabled: true,
    passCount: 3, failCount: 0, assessedCount: 3, rejectedCount: 0, noResourceToAssess: false,
  },
  {
    frameworkId: SYNTH_5RS_ID, categoryExternalId: "2", subcategoryExternalId: "2.1",
    policyId: "policy-multi", policyKind: "CONTROL", shortId: "MULTI-001",
    name: "Multiply-mapped rule", severity: "LOW", enabled: false,
    passCount: 9, failCount: 2, assessedCount: 11, rejectedCount: 0, noResourceToAssess: false,
  },
];

const scoped5RsTree = buildFrameworkTree(
  SYNTH_5RS_ID, SYNTH_5RS_POSTURE, SCOPED_5RS_POLICIES,
)!;

describe("withCountsFrom", () => {
  const registerScope = scopeFiveRs(
    [synth5RsTree, synthAsiTree], findings, aiAssetIds, noPins,
  );
  const rescoped = withCountsFrom(registerScope, [scoped5RsTree, synthAsiTree]);

  function policy(scope: typeof registerScope, id: string) {
    return scope.policies.find((p) => p.policyId === id);
  }

  it("re-reads the counts off the trees it was handed", () => {
    expect(policy(registerScope, "policy-linked")!.passCount).toBe(0);
    expect(policy(rescoped, "policy-linked")!.passCount).toBe(40);
  });

  it("keeps the verdict, which is the whole point of the split", () => {
    // The in/out decision is register-wide and PERSISTED (the Settings pin). Re-deriving it
    // from a narrower population is the failure this function exists to avoid, so every
    // verdict field has to survive the count swap untouched.
    for (const before of registerScope.policies) {
      const after = policy(rescoped, before.policyId);
      if (!after) continue;
      expect(after.selected, before.policyId).toBe(before.selected);
      expect(after.reason, before.policyId).toBe(before.reason);
      expect(after.mappedBy, before.policyId).toEqual(before.mappedBy);
      expect(after.aiFindingCount, before.policyId).toBe(before.aiFindingCount);
    }
  });

  it("takes the MAX across mappings, mirroring scopeFiveRs", () => {
    // Both walks see the same policy twice with different counts, and both must answer 9/2
    // rather than 3/0 (first seen) or 12/2 (summed). Two disciplines that have to agree, so
    // they are pinned against the same shape.
    const multi = policy(rescoped, "policy-multi")!;
    expect(multi.passCount).toBe(9);
    expect(multi.failCount).toBe(2);
  });

  it("carries sticky-false through from the scoped rows", () => {
    expect(policy(rescoped, "policy-multi")!.enabled).toBe(false);
  });

  it("DROPS a policy the scoped trees never assessed rather than zeroing it", () => {
    // The trap this function is most likely to be "simplified" into. Zeroed, a rule Wiz
    // assessed nothing for in this project has failCount 0 — which fiveRsDerivedPosture
    // counts as a CLEAN CONTROL, lifting controlPassPct on evidence that does not exist.
    // Absent from the tree means unassessed, not passing.
    expect(policy(registerScope, "policy-trap-in")).toBeDefined();
    expect(policy(rescoped, "policy-trap-in")).toBeUndefined();
    // Only the two the scoped tree carries survive — including `policy-no-ai-link`, which
    // is dropped for the same reason as the trap rule and not for its verdict.
    expect(rescoped.policies.map((p) => p.policyId).sort())
      .toEqual(["policy-linked", "policy-multi"]);
  });

  it("reports no derived posture — not a zero — when the framework scored nothing here", () => {
    const empty = withCountsFrom(registerScope, [synthAsiTree]);
    expect(empty.policies).toEqual([]);
    expect(empty.total).toBe(0);
    // The governing rule of the whole compliance feature, at its last mile: a posture that
    // does not exist is never drawn as a zero.
    expect(fiveRsDerivedPosture(empty, null)!.posturePct).toBeNull();
  });

  it("passes a no-5Rs scope straight through", () => {
    const none = scopeFiveRs([synthAsiTree], findings, aiAssetIds, noPins);
    expect(none.frameworkId).toBeNull();
    expect(withCountsFrom(none, [scoped5RsTree])).toBe(none);
  });
});
