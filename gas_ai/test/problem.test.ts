// The AI Decision Vector: axis derivation, the first-match decision, and the
// amplification vector's strict separation from that decision.
//
// The two axis-derivation contracts that matter most to this whole phase get their own
// explicit assertions rather than living implicitly inside a bigger scenario: an AI
// verdict alone can never reach ACTIVE exploitation (the SMART-Repeatable guarantee this
// split exists for), and an ABSENT `validatedAsExploitable` reads as UNKNOWN, never as a
// "no" — because `syncNormalize.ts` only ever WRITES that field when Wiz says `true`.

import { describe, expect, it } from "vitest";
import {
  amplificationVector,
  decideProblem,
  deriveFindingProblemInput,
  deriveProblemInput,
  type DecisionVector,
  type Outcome,
} from "../src/domain/problem";
import { DEFAULT_PROBLEM_RULE, type ProblemRule } from "../src/domain/problemRule";
import type { GNode } from "../src/domain/graphTypes";
import { findingFixture, issueFixture, nodeFixture } from "./problem.fixture";

const RULE: ProblemRule = DEFAULT_PROBLEM_RULE;

function ruleWithExploitation(rows: ProblemRule["exploitationByRuleId"]): ProblemRule {
  return { ...RULE, exploitationByRuleId: rows };
}

// --------------------------------------------------------------------------- exploitation

describe("exploitation — the ACTIVE/SUSPECTED/UNKNOWN split", () => {
  it("validatedAsExploitable: true is the ONLY route to ACTIVE", () => {
    const issue = issueFixture({ validatedAsExploitable: true });
    const { vector, exploitationSource, unknowns } = deriveProblemInput(issue, undefined, RULE);
    expect(vector.exploitation).toBe("ACTIVE");
    expect(exploitationSource).toBe("validated");
    expect(unknowns).not.toContain("exploitation");
  });

  it("an AI verdict alone can NEVER produce ACTIVE — the SMART-Repeatable guarantee", () => {
    const issue = issueFixture({ aiVerdict: "REMEDIATE", validatedAsExploitable: undefined });
    const { vector, exploitationSource } = deriveProblemInput(issue, undefined, RULE);
    expect(vector.exploitation).not.toBe("ACTIVE");
    expect(vector.exploitation).toBe("SUSPECTED");
    expect(exploitationSource).toBe("aiVerdict");
  });

  it("validatedAsExploitable ABSENT reads as UNKNOWN, never as a 'no'", () => {
    const issue = issueFixture({ validatedAsExploitable: undefined, aiVerdict: undefined });
    const { vector, unknowns, exploitationSource } = deriveProblemInput(issue, undefined, RULE);
    expect(vector.exploitation).toBe("UNKNOWN");
    expect(vector.exploitation).not.toBe("ACTIVE");
    expect(exploitationSource).toBe("none");
    expect(unknowns).toContain("exploitation");
  });

  it("the rule table reaches SUSPECTED at REALIZED or DEMONSTRATED maturity", () => {
    const rule = ruleWithExploitation([{ ruleId: "wc-id-3230", maturity: "REALIZED" }]);
    const issue = issueFixture({ ruleId: "wc-id-3230" });
    const { vector, exploitationSource } = deriveProblemInput(issue, undefined, rule);
    expect(vector.exploitation).toBe("SUSPECTED");
    expect(exploitationSource).toBe("ruleTable");

    const demonstrated = ruleWithExploitation([{ ruleId: "wc-id-3230", maturity: "DEMONSTRATED" }]);
    expect(deriveProblemInput(issue, undefined, demonstrated).vector.exploitation).toBe("SUSPECTED");
  });

  it("FEASIBLE maturity does not qualify — 'could' is not 'has'", () => {
    const rule = ruleWithExploitation([{ ruleId: "wc-id-3230", maturity: "FEASIBLE" }]);
    const issue = issueFixture({ ruleId: "wc-id-3230", aiVerdict: undefined });
    expect(deriveProblemInput(issue, undefined, rule).vector.exploitation).toBe("UNKNOWN");
  });

  it("a FindingRow has no validatedAsExploitable or aiVerdict — it can reach SUSPECTED but never ACTIVE", () => {
    const rule = ruleWithExploitation([{ ruleId: "SUB-082", maturity: "DEMONSTRATED" }]);
    const finding = findingFixture({ ruleShortId: "SUB-082" });
    const { vector, exploitationSource } = deriveFindingProblemInput(finding, undefined, rule);
    expect(vector.exploitation).toBe("SUSPECTED");
    expect(exploitationSource).toBe("ruleTable");

    const noMatch = findingFixture({ ruleShortId: "SUB-999" });
    const unknownResult = deriveFindingProblemInput(noMatch, undefined, rule);
    expect(unknownResult.vector.exploitation).toBe("UNKNOWN");
    expect(unknownResult.unknowns).toContain("exploitation");
  });
});

// -------------------------------------------------------------------------------- impact

describe("technical impact — TOTAL / PARTIAL, and the unknown RATE without an unknown VALUE", () => {
  it("admin privileges on the node → TOTAL", () => {
    const node = nodeFixture({ hasAdminPrivileges: true });
    expect(deriveProblemInput(issueFixture(), node, RULE).vector.impact).toBe("TOTAL");
  });

  it("admin-level human access → TOTAL", () => {
    const node = nodeFixture({ humanAccess: { identityIds: ["u1"], admin: true } });
    expect(deriveProblemInput(issueFixture(), node, RULE).vector.impact).toBe("TOTAL");
  });

  it("combo-group membership → TOTAL, even with no privilege signal on the node", () => {
    const issue = issueFixture({ comboGroup: "gcp-hosted-privileged" });
    const { vector, unknowns } = deriveProblemInput(issue, undefined, RULE);
    expect(vector.impact).toBe("TOTAL");
    // The group source alone made TOTAL observable, so impact must not also read unknown.
    expect(unknowns).not.toContain("impact");
  });

  it("none of the three sources observable → PARTIAL, and 'impact' is pushed onto unknowns", () => {
    const issue = issueFixture({ comboGroup: "other-ai-risk" });
    const node = nodeFixture({});
    const { vector, unknowns } = deriveProblemInput(issue, node, RULE);
    expect(vector.impact).toBe("PARTIAL");
    expect(unknowns).toContain("impact");
  });

  it("an explicit hasAdminPrivileges: false IS an observation — PARTIAL without an unknown", () => {
    const issue = issueFixture({ comboGroup: "other-ai-risk" });
    const node = nodeFixture({ hasAdminPrivileges: false });
    const { vector, unknowns } = deriveProblemInput(issue, node, RULE);
    expect(vector.impact).toBe("PARTIAL");
    expect(unknowns).not.toContain("impact");
  });

  it("a FindingRow carries no comboGroup — that source simply contributes nothing", () => {
    const finding = findingFixture({});
    const node = nodeFixture({ hasAdminPrivileges: true });
    expect(deriveFindingProblemInput(finding, node, RULE).vector.impact).toBe("TOTAL");
    const bareNode = nodeFixture({});
    const result = deriveFindingProblemInput(finding, bareNode, RULE);
    expect(result.vector.impact).toBe("PARTIAL");
    expect(result.unknowns).toContain("impact");
  });
});

// ------------------------------------------------------------------------------ exposure

describe("system exposure — through riskConditions.conditionState, never the raw flags", () => {
  it("a reachable node → OPEN", () => {
    const node = nodeFixture({ isAccessibleFromInternet: true });
    const { vector, unknowns } = deriveProblemInput(issueFixture(), node, RULE);
    expect(vector.exposure).toBe("OPEN");
    expect(unknowns).not.toContain("exposure");
  });

  it("both flags explicitly false → CONTROLLED", () => {
    const node = nodeFixture({ isAccessibleFromInternet: false, isOpenToAllInternet: false });
    expect(deriveProblemInput(issueFixture(), node, RULE).vector.exposure).toBe("CONTROLLED");
  });

  it("null reachability → UNVERIFIED, and 'exposure' is pushed onto unknowns", () => {
    const node = nodeFixture({ isAccessibleFromInternet: null, isOpenToAllInternet: null });
    const { vector, unknowns } = deriveProblemInput(issueFixture(), node, RULE);
    expect(vector.exposure).toBe("UNVERIFIED");
    expect(unknowns).toContain("exposure");
  });

  it("a missing node is exactly as unverified as one the graph reached but could not read", () => {
    const { vector, unknowns } = deriveProblemInput(issueFixture(), undefined, RULE);
    expect(vector.exposure).toBe("UNVERIFIED");
    expect(unknowns).toContain("exposure");
  });

  it("evidenced is true only when a traversal actually found a host or endpoint", () => {
    const withEvidence = nodeFixture({
      isAccessibleFromInternet: null,
      exposureEvidence: { hostIds: ["vm-1"] },
    });
    expect(deriveProblemInput(issueFixture(), withEvidence, RULE).evidenced).toBe(true);

    const flagOnly = nodeFixture({ isAccessibleFromInternet: true });
    expect(deriveProblemInput(issueFixture(), flagOnly, RULE).evidenced).toBe(false);

    const emptyEvidence = nodeFixture({ isAccessibleFromInternet: null, exposureEvidence: {} });
    expect(deriveProblemInput(issueFixture(), emptyEvidence, RULE).evidenced).toBe(false);
  });

  it("isOpenToAllInternet alone (the stronger signal) is enough for OPEN", () => {
    const node = nodeFixture({ isAccessibleFromInternet: false, isOpenToAllInternet: true });
    expect(deriveProblemInput(issueFixture(), node, RULE).vector.exposure).toBe("OPEN");
  });
});

// ------------------------------------------------------------------------------- mission

describe("mission — HBI/MBI/LBI, and a missing tier never reading as LOW", () => {
  it("reads HBI/MBI/LBI off the node first", () => {
    expect(
      deriveProblemInput(issueFixture(), nodeFixture({ businessImpact: "HBI" }), RULE).vector.mission,
    ).toBe("HIGH");
    expect(
      deriveProblemInput(issueFixture(), nodeFixture({ businessImpact: "MBI" }), RULE).vector.mission,
    ).toBe("MEDIUM");
    expect(
      deriveProblemInput(issueFixture(), nodeFixture({ businessImpact: "LBI" }), RULE).vector.mission,
    ).toBe("LOW");
  });

  it("falls back to the issue's own businessImpact when the node has none", () => {
    const issue = issueFixture({ businessImpact: "HBI" });
    const node = nodeFixture({});
    expect(deriveProblemInput(issue, node, RULE).vector.mission).toBe("HIGH");
  });

  it("absent on both sides reads as rule.missingMission, and pushes 'mission' onto unknowns — never LOW", () => {
    const issue = issueFixture({ businessImpact: undefined });
    const { vector, unknowns } = deriveProblemInput(issue, nodeFixture({}), RULE);
    expect(vector.mission).toBe(RULE.missingMission);
    expect(vector.mission).not.toBe("LOW");
    expect(unknowns).toContain("mission");
  });

  it("a FindingRow reads its own businessImpact the same way", () => {
    const finding = findingFixture({ businessImpact: "LBI" });
    expect(deriveFindingProblemInput(finding, undefined, RULE).vector.mission).toBe("LOW");
  });
});

// -------------------------------------------------------------------------- decideProblem

describe("decideProblem — first match wins, fallback is -1", () => {
  it("matches the first row whose (partial) condition the vector satisfies", () => {
    const vector: DecisionVector = { exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "LOW" };
    const { outcome, matchedRuleIndex } = decideProblem(vector, RULE);
    expect(outcome).toBe("ACT");
    expect(matchedRuleIndex).toBe(0);
  });

  it("an omitted axis in `when` is a wildcard", () => {
    // Row 4 ({ exploitation: ACTIVE } → ATTEND) fires for any impact/exposure/mission that
    // the three ACT rows above it did not already claim.
    const vector: DecisionVector = {
      exploitation: "ACTIVE", impact: "PARTIAL", exposure: "CONTROLLED", mission: "LOW",
    };
    const { outcome, matchedRuleIndex } = decideProblem(vector, RULE);
    expect(outcome).toBe("ATTEND");
    expect(matchedRuleIndex).toBe(3);
  });

  it("falls back with matchedRuleIndex -1 when nothing matches", () => {
    const vector: DecisionVector = {
      exploitation: "UNKNOWN", impact: "PARTIAL", exposure: "CONTROLLED", mission: "MEDIUM",
    };
    const { outcome, matchedRuleIndex } = decideProblem(vector, RULE);
    expect(outcome).toBe(RULE.fallbackOutcome);
    expect(matchedRuleIndex).toBe(-1);
  });
});

// -------------------------------------------------------------------- amplificationVector

/** A node shaped like something a live sync could actually produce — no USES_TOOL / INVOKES_TOOL / USES_DATASET edges behind it. */
function liveShapedNode(over: Partial<GNode> = {}): GNode {
  return nodeFixture({
    kind: "AI_AGENT",
    hasAdminPrivileges: true,
    hasAccessToSensitiveData: true,
    ...over,
  });
}

describe("amplificationVector — absent is null, never 0", () => {
  it("tools, persistence and multiAgent read null on a realistic LIVE node — always, no edges produce them", () => {
    const node = liveShapedNode();
    const v = amplificationVector(issueFixture(), node);
    expect(v.tools).toBeNull();
    expect(v.persistence).toBeNull();
    expect(v.multiAgent).toBeNull();
    // Sanity: this node is otherwise fully populated, so a null here is the FACTOR
    // saying "unmeasured", not the node saying "nothing to read".
    expect(v.identity).not.toBeNull();
    expect(v.context).not.toBeNull();
  });

  it("identity: admin → 1, high/permission → 0.5, explicit absence → 0, nothing observed → null", () => {
    expect(amplificationVector(issueFixture(), nodeFixture({ hasAdminPrivileges: true })).identity).toBe(1);
    expect(amplificationVector(issueFixture(), nodeFixture({ hasHighPrivileges: true })).identity).toBe(0.5);
    expect(
      amplificationVector(
        issueFixture(),
        nodeFixture({ humanAccess: { identityIds: ["u1"], permissionCount: 2 } }),
      ).identity,
    ).toBe(0.5);
    expect(
      amplificationVector(
        issueFixture(),
        nodeFixture({ hasAdminPrivileges: false, hasHighPrivileges: false }),
      ).identity,
    ).toBe(0);
    expect(amplificationVector(issueFixture(), nodeFixture({})).identity).toBeNull();
  });

  it("context: sensitive data → 1, findings reached → 0.5, zero findings → 0, nothing observed → null", () => {
    expect(amplificationVector(issueFixture(), nodeFixture({ hasSensitiveData: true })).context).toBe(1);
    expect(amplificationVector(issueFixture(), nodeFixture({ dataFindingCount: 3 })).context).toBe(0.5);
    expect(amplificationVector(issueFixture(), nodeFixture({ dataFindingCount: 0 })).context).toBe(0);
    expect(amplificationVector(issueFixture(), nodeFixture({})).context).toBeNull();
  });

  it("language: 1 for an agentic AI-asset kind, null for a non-agent kind and for no node", () => {
    expect(amplificationVector(issueFixture(), nodeFixture({ kind: "AI_AGENT" })).language).toBe(1);
    expect(amplificationVector(issueFixture(), nodeFixture({ kind: "MCP_SERVER" })).language).toBe(1);
    expect(amplificationVector(issueFixture(), nodeFixture({ kind: "AI_MODEL" })).language).toBeNull();
    expect(amplificationVector(issueFixture(), nodeFixture({ kind: "AI_DATASET" })).language).toBeNull();
    expect(amplificationVector(issueFixture(), undefined as unknown as GNode).language).toBeNull();
  });
});

describe("amplification never reaches the decision", () => {
  it("permuting it across its whole range leaves decideProblem's outcome unchanged", () => {
    // Pin the DecisionVector-affecting fields; vary only the amplification-affecting ones.
    const issue = issueFixture({ validatedAsExploitable: true, comboGroup: "gcp-hosted-privileged" });
    const pinned: Partial<GNode> = { isAccessibleFromInternet: true, businessImpact: "HBI" };

    const variants: Partial<GNode>[] = [
      {},
      { hasAdminPrivileges: true },
      { hasHighPrivileges: true },
      { humanAccess: { identityIds: ["u1"], permissionCount: 4 } },
      { hasAdminPrivileges: false, hasHighPrivileges: false },
      { hasSensitiveData: true },
      { dataFindingCount: 5 },
      { dataFindingCount: 0 },
      { hasSensitiveData: false, hasAccessToSensitiveData: false },
      { kind: "AI_MODEL" },
      { kind: "AI_DATASET", hasAdminPrivileges: false, hasSensitiveData: false },
      { hasAdminPrivileges: true, hasSensitiveData: true, kind: "AI_TOOL" },
    ];

    let expectedOutcome: Outcome | undefined;
    const amplifications: Array<Record<string, number | null>> = [];

    for (const variant of variants) {
      const node = nodeFixture({ ...pinned, ...variant });
      const { vector } = deriveProblemInput(issue, node, RULE);
      const { outcome } = decideProblem(vector, RULE);
      if (expectedOutcome === undefined) expectedOutcome = outcome;
      expect(outcome).toBe(expectedOutcome);
      amplifications.push(amplificationVector(issue, node));
    }

    // Not a vacuous invariance: the amplification vectors genuinely differ across the
    // range above (identity and context sweep 0 / 0.5 / 1 / null; language sweeps 1 / null).
    const distinct = new Set(amplifications.map((a) => JSON.stringify(a)));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
