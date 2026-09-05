// The twelve arms of NormalizedPart, and the accumulation the sync loop does over them.
//
// These exist because of a shipped defect: the loop in syncJobs.ts wrote the accumulation
// out by hand and carried three of the four arms. `findings` was never collected, so the
// CONFIG_FINDINGS step — which emits findings and NOTHING else — had every page dropped on
// live syncs, `ai_findings` was rewritten empty, kpis.complianceGaps read 0 on a tenant
// that had findings, and buildAarsHintsFromFindings received nothing so AARS pillar B fell
// back to the heuristic it was written to replace. No error, anywhere.
//
// So the arm list is asserted against the type's own keys rather than retyped here: a NEW
// arm added to NormalizedPart fails these tests until appendPart and partIsEmpty carry it.
// (It has now earned its keep twice: the three compliance-posture arms tripped it, and so
// did the rule catalogue, identity-hygiene and effective-access arms.)
//
// The twelfth arm, `vulnFindings`, is OPTIONAL on the type — unlike the eleven above it —
// because a part revived from an older hop's Drive spill was written before the arm existed
// and carries no such key; the pin still counts it because `emptyPart()` materialises it as
// `[]` and `appendPart`/`partIsEmpty` are required to carry it regardless.

import { describe, expect, it } from "vitest";
import {
  appendPart,
  emptyPart,
  normalizeConfigFindingsPage,
  partIsEmpty,
  type NormalizedPart,
} from "../src/domain/syncNormalize";

const ARMS = Object.keys(emptyPart()) as (keyof NormalizedPart)[];

/** One non-empty value for whichever arm is asked for, shaped enough to survive a merge. */
function partWithOnly(arm: keyof NormalizedPart): NormalizedPart {
  const part = emptyPart();
  if (arm === "nodes") part.nodes.push({ id: "n1", kind: "AI_AGENT", name: "n1" } as never);
  if (arm === "edges") part.edges.push({ src: "a", dst: "b", type: "RUNS_AS" } as never);
  if (arm === "issues") part.issues.push({ id: "i1", assetId: "a" } as never);
  if (arm === "findings") part.findings.push({ id: "f1", resourceId: "a" } as never);
  if (arm === "dataFindings") part.dataFindings.push({ id: "d1", resourceId: "a" } as never);
  if (arm === "frameworks") part.frameworks.push({ id: "wf-id-1", name: "F" } as never);
  if (arm === "posture") {
    part.posture.push({ frameworkId: "wf-id-1", level: "framework", title: "F" } as never);
  }
  if (arm === "frameworkPolicies") {
    part.frameworkPolicies.push({
      frameworkId: "wf-id-1", subcategoryExternalId: "ASI01", policyId: "p1",
    } as never);
  }
  if (arm === "configRules") {
    part.configRules.push({ id: "r1", shortId: "IAM-159", name: "R" } as never);
  }
  if (arm === "identityFindings") {
    part.identityFindings.push({ id: "h1", resourceId: "u1", hygiene: "MFA" } as never);
  }
  if (arm === "effectiveAccess") {
    part.effectiveAccess.push({ identityId: "u1", resourceId: "a" } as never);
  }
  if (arm === "vulnFindings") {
    (part.vulnFindings ??= []).push({
      id: "v1", hasKev: null, hasExploit: null, epss: null, issueIds: [],
    } as never);
  }
  return part;
}

describe("the arm list", () => {
  it("is the twelve the ledger persists", () => {
    expect(ARMS.sort()).toEqual([
      "configRules", "dataFindings", "edges", "effectiveAccess", "findings",
      "frameworkPolicies", "frameworks", "identityFindings", "issues", "nodes", "posture",
      "vulnFindings",
    ]);
  });
});

describe("appendPart", () => {
  it("carries every arm — the defect was that it carried three", () => {
    for (const arm of ARMS) {
      const target = emptyPart();
      appendPart(target, partWithOnly(arm));
      expect(target[arm], `appendPart dropped ${arm}`).toHaveLength(1);
    }
  });

  it("accumulates across calls without replacing", () => {
    const target = emptyPart();
    appendPart(target, partWithOnly("findings"));
    appendPart(target, partWithOnly("findings"));
    expect(target.findings).toHaveLength(2);
  });

  it("leaves the arms the source did not carry alone", () => {
    const target = emptyPart();
    appendPart(target, partWithOnly("findings"));
    expect(target.nodes).toEqual([]);
    expect(target.edges).toEqual([]);
    expect(target.issues).toEqual([]);
  });
});

describe("partIsEmpty", () => {
  it("is true only for a part with nothing on any arm", () => {
    expect(partIsEmpty(emptyPart())).toBe(true);
  });

  it("is false when any single arm carries something", () => {
    for (const arm of ARMS) {
      expect(partIsEmpty(partWithOnly(arm)), `${arm}-only part read as empty`).toBe(false);
    }
  });
});

describe("a findings-only page — the exact shape that was being dropped", () => {
  // One FAIL row in the selection set normalizeConfigFindingsPage reads.
  const PAGE = [{
    id: "cf-1",
    result: "FAIL",
    status: "OPEN",
    severity: "HIGH",
    remediation: "Attach a guardrail.",
    resource: { id: "agent-1" },
    rule: { shortId: "SUB-082", name: "Guardrail required", tags: [], risks: [] },
  }];

  it("normalizes to findings and nothing else", () => {
    const part = normalizeConfigFindingsPage(PAGE);
    expect(part.findings).toHaveLength(1);
    expect(part.nodes).toEqual([]);
    expect(part.edges).toEqual([]);
    expect(part.issues).toEqual([]);
  });

  it("survives the accumulate-then-spill path the sync loop runs", () => {
    const hop = emptyPart();
    appendPart(hop, normalizeConfigFindingsPage(PAGE));
    // The guard the loop spills on. It used to ignore findings, so this page was thrown
    // away before it was ever written to Drive.
    expect(partIsEmpty(hop)).toBe(false);
    expect(hop.findings[0].resourceId).toBe("agent-1");
  });
});
