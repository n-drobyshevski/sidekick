// Shared builders for problem.test.ts and problemRule.test.ts, plus the one fixture the
// phase exists to force into being: an estate where MOST agents have never had their
// internet reachability determined.
//
// sampleData.ts cannot stand in for this. Its seed sets both `isAccessibleFromInternet`
// and `isOpenToAllInternet` to `false` unless a seed explicitly overrides them, so the
// seed estate's UNVERIFIED-exposure rate sits near zero — the exact opposite of what a
// tenant with many hosted (VM/serverless-backed) agents looks like in practice, where
// reachability is INHERITED from the compute underneath and Wiz reports it `null` until
// something walks that hop. `NULL_EXPOSURE_ESTATE` below is hand-authored specifically to
// make that failure mode visible to a test, the way riskConditions.test.ts's fixtures
// exist because sampleData.ts could not show the INTERNET_EXPOSURE flag disagreement
// either.

import type { FindingRow, GNode, IssueRow } from "../src/domain/graphTypes";

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function nodeFixture(over: Partial<GNode> = {}): GNode {
  return { id: nextId("node"), kind: "AI_AGENT", name: "Fixture Agent", ...over };
}

export function issueFixture(over: Partial<IssueRow> = {}): IssueRow {
  const id = nextId("issue");
  return {
    id,
    ruleId: "wc-id-3230",
    ruleName: "GCP hosted AI agents on VM/serverless",
    comboGroup: "gcp-hosted-privileged",
    nativeSeverity: "MEDIUM",
    adjustedSeverity: "HIGH",
    status: "OPEN",
    assetId: `asset-${id}`,
    assetName: "Fixture Agent",
    ...over,
  };
}

export function findingFixture(over: Partial<FindingRow> = {}): FindingRow {
  const id = nextId("finding");
  return {
    id,
    resourceId: `asset-${id}`,
    ruleShortId: "SUB-082",
    severity: "MEDIUM",
    frameworkCodes: [],
    ...over,
  };
}

/**
 * 12 hosted agents: 9 carry `isAccessibleFromInternet: null`, `isOpenToAllInternet: null`
 * and no `exposureEvidence` — reachability inherited from a VM/serverless host and never
 * walked, which is `riskConditions.conditionState`'s definition of UNVERIFIED. The other
 * 3 carry a definite reading (2 CONTROLLED, 1 OPEN) so the estate is not a degenerate
 * all-unknown case and the majority-vs-minority shape is the one under test, not the only
 * possible one.
 *
 * One open toxic-combination issue per agent (the `gcp-hosted-privileged` pattern, the one
 * `DEFAULT_PROBLEM_RULE.totalImpactGroups` names) so every node has something to derive a
 * full vector from.
 */
export function buildNullExposureEstate(): { nodes: GNode[]; issues: IssueRow[] } {
  const nodes: GNode[] = [];
  const issues: IssueRow[] = [];

  for (let i = 0; i < 9; i++) {
    const node = nodeFixture({
      id: `hosted-unverified-${i}`,
      name: `Hosted Agent Unverified ${i}`,
      isAccessibleFromInternet: null,
      isOpenToAllInternet: null,
      hasAdminPrivileges: true,
      businessImpact: i % 3 === 0 ? "HBI" : "MBI",
    });
    nodes.push(node);
    issues.push(issueFixture({ assetId: node.id, assetName: node.name }));
  }

  for (let i = 0; i < 2; i++) {
    const node = nodeFixture({
      id: `hosted-controlled-${i}`,
      name: `Hosted Agent Controlled ${i}`,
      isAccessibleFromInternet: false,
      isOpenToAllInternet: false,
      hasAdminPrivileges: true,
      businessImpact: "MBI",
    });
    nodes.push(node);
    issues.push(issueFixture({ assetId: node.id, assetName: node.name }));
  }

  const openNode = nodeFixture({
    id: "hosted-open-0",
    name: "Hosted Agent Open 0",
    isAccessibleFromInternet: true,
    hasAdminPrivileges: true,
    businessImpact: "HBI",
  });
  nodes.push(openNode);
  issues.push(issueFixture({ assetId: openNode.id, assetName: openNode.name }));

  return { nodes, issues };
}
