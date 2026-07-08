// Live-response normalization: hand-written fixture pages matching the documented
// selection sets in ai/queries/*.md (the reponse_schemas/ stubs are empty, so these
// pin the assumed shapes until real captures land).

import { describe, expect, it } from "vitest";
import {
  mergeParts,
  normalizeCloudResource,
  normalizeConfigFindingsPage,
  normalizeIdentityAccessPage,
  normalizeInventoryPage,
  normalizeIssuesPage,
  normalizeNoGuardrailPage,
  normalizePrincipalsPage,
  normalizeRuleAssetsPage,
  normalizeRunsAsPage,
  reconcileIssues,
} from "../src/domain/syncNormalize";
import { COMBO_GROUPS } from "../src/domain/toxicCombos";
import type { IssueRow } from "../src/domain/graphTypes";

const AGENT_RAW = {
  id: "wiz-node-agent-1",
  name: "Agent-A",
  type: "AI_AGENT",
  nativeType: "aiplatform#ReasoningEngine",
  cloudPlatform: "GCP",
  region: "europe-west1",
  status: "Active",
  firstSeen: "2026-04-02T08:00:00Z",
  lastSeen: "2026-06-28T05:00:00Z",
  externalId: "projects/x/reasoningEngines/1",
  isAccessibleFromInternet: false,
  hasAccessToSensitiveData: true,
  hasAdminPrivileges: false,
  hasHighPrivileges: true,
  cloudAccount: { id: "acc-1", name: "gcp-account-01", cloudProvider: "GCP" },
  projects: [{ id: "p1", name: "PROJECT-ALPHA", riskProfile: { businessImpact: "HBI" } }],
  tags: [{ key: "env", value: "prod" }],
};

const SA_RAW = {
  id: "wiz-node-sa-1",
  name: "sa-agent-a@iam.gserviceaccount.com",
  type: "SERVICE_ACCOUNT",
  cloudPlatform: "GCP",
};

const FINDING_RAW = {
  id: "wiz-node-finding-1",
  name: "Excessive access",
  type: "EXCESSIVE_ACCESS_FINDING",
};

describe("normalizeCloudResource", () => {
  it("maps the documented CloudResource selection", () => {
    const node = normalizeCloudResource(AGENT_RAW)!;
    expect(node.kind).toBe("AI_AGENT");
    expect(node.name).toBe("Agent-A");
    expect(node.isAccessibleFromInternet).toBe(false);
    expect(node.hasAccessToSensitiveData).toBe(true);
    expect(node.cloudAccount?.name).toBe("gcp-account-01");
    expect(node.projects).toEqual([{ id: "p1", name: "PROJECT-ALPHA", businessImpact: "HBI" }]);
    expect(node.tags).toEqual([{ key: "env", value: "prod" }]);
  });

  it("is defensive: missing fields, null internet flag, unknown types", () => {
    expect(normalizeCloudResource({})).toBeNull();
    expect(normalizeCloudResource({ id: "x", type: "SOMETHING_NEW" })).toBeNull();
    const bare = normalizeCloudResource({ id: "x", type: "AI_MODEL" })!;
    expect(bare.name).toBe("x");
    expect(bare.isAccessibleFromInternet).toBeNull();
    const hosted = normalizeCloudResource({
      id: "y", type: "AI_AGENT", name: "h", isAccessibleFromInternet: null,
    })!;
    expect(hosted.isAccessibleFromInternet).toBeNull();
  });
});

describe("page normalizers", () => {
  it("inventory page → nodes only", () => {
    const part = normalizeInventoryPage([AGENT_RAW, {}, { id: "m1", type: "AI_MODEL", name: "m" }]);
    expect(part.nodes).toHaveLength(2);
    expect(part.edges).toHaveLength(0);
    expect(part.issues).toHaveLength(0);
  });

  it("rule-assets page reconstructs one OPEN issue per asset", () => {
    const group = COMBO_GROUPS.find((g) => g.ruleId === "wc-id-3217")!;
    const part = normalizeRuleAssetsPage([AGENT_RAW], group);
    expect(part.issues).toHaveLength(1);
    const issue = part.issues[0];
    expect(issue.comboGroup).toBe("gcp-managed-privileged");
    expect(issue.nativeSeverity).toBe("MEDIUM");
    expect(issue.adjustedSeverity).toBe("HIGH");
    expect(issue.assetId).toBe("wiz-node-agent-1");
    expect(issue.status).toBe("OPEN");
  });

  it("no-guardrail page flags agents (and only agents)", () => {
    const part = normalizeNoGuardrailPage([{ entities: [AGENT_RAW, SA_RAW] }]);
    expect(part.nodes).toHaveLength(1);
    expect(part.nodes[0].guardrailMissing).toBe(true);
  });

  it("runs-as page implies RUNS_AS (+ HAS_FINDING) edges from the path entities", () => {
    const part = normalizeRunsAsPage([{ entities: [AGENT_RAW, SA_RAW, FINDING_RAW] }]);
    expect(part.nodes).toHaveLength(3);
    expect(part.edges).toEqual([
      expect.objectContaining({ src: "wiz-node-agent-1", dst: "wiz-node-sa-1", type: "RUNS_AS" }),
      expect.objectContaining({ src: "wiz-node-sa-1", dst: "wiz-node-finding-1", type: "HAS_FINDING" }),
    ]);
    // A row without a service account yields nodes but no edges.
    const partial = normalizeRunsAsPage([{ entities: [AGENT_RAW] }]);
    expect(partial.edges).toHaveLength(0);
  });

  it("identity-access page implies identity → ALLOWS_ACCESS_TO → agent", () => {
    const user = { id: "u1", type: "USER_ACCOUNT", name: "ops.user@example.com" };
    const role = { id: "r1", type: "ACCESS_ROLE", name: "roles/admin" };
    const part = normalizeIdentityAccessPage([{ entities: [AGENT_RAW, user, role] }]);
    const edges = part.edges.map((e) => `${e.src}→${e.dst}`);
    expect(edges).toContain("u1→wiz-node-agent-1");
    expect(edges).toContain("r1→wiz-node-agent-1");
    expect(part.edges.every((e) => e.type === "ALLOWS_ACCESS_TO")).toBe(true);
  });

  it("malformed graphSearch rows are skipped, never thrown on", () => {
    expect(() => normalizeRunsAsPage([{}, { entities: "junk" } as never, null as never])).not.toThrow();
  });
});

describe("mergeParts", () => {
  it("dedupes by id and merges fields stickily (later omissions don't erase)", () => {
    const inventory = normalizeInventoryPage([AGENT_RAW]);
    // The guardrail step returns a narrower projection of the same agent.
    const gap = normalizeNoGuardrailPage([{ entities: [{ id: "wiz-node-agent-1", type: "AI_AGENT", name: "Agent-A" }] }]);
    const { doc } = mergeParts([inventory, gap], "2026-06-28T06:00:00Z");
    expect(doc.nodes).toHaveLength(1);
    const agent = doc.nodes[0];
    expect(agent.guardrailMissing).toBe(true); // from the gap step
    expect(agent.hasAccessToSensitiveData).toBe(true); // preserved from inventory
    expect(agent.region).toBe("europe-west1");
  });

  it("dedupes edges and issues by id", () => {
    const group = COMBO_GROUPS[0];
    const a = normalizeRuleAssetsPage([AGENT_RAW], group);
    const b = normalizeRuleAssetsPage([AGENT_RAW], group);
    const { issues } = mergeParts([a, b], "2026-06-28T06:00:00Z");
    expect(issues).toHaveLength(1);
  });

  it("collects findings and dedupes them by id", () => {
    const a = normalizeConfigFindingsPage([CONFIG_FINDING_RAW]);
    const b = normalizeConfigFindingsPage([CONFIG_FINDING_RAW]);
    const { findings } = mergeParts([a, b], "2026-06-28T06:00:00Z");
    expect(findings).toHaveLength(1);
  });
});

// Trimmed from exemples/toxic_combos_response.js — two issues on the SAME asset
// (real multiplicity), each with a sourceRule Control carrying resolutionRecommendation.
function issueRaw(id: string): Record<string, unknown> {
  return {
    id,
    type: "TOXIC_COMBINATION",
    severity: "MEDIUM",
    status: "OPEN",
    createdAt: "2026-06-24T04:04:04Z",
    dueAt: "2026-09-22T04:04:04Z",
    projects: [{ id: "p1", name: "VALUE-CHAIN", riskProfile: { businessImpact: "LBI" } }],
    entitySnapshot: {
      id: "wiz-asset-42",
      type: "AI_AGENT",
      name: "StockBuddy",
      cloudPlatform: "GCP",
      region: "europe-west1",
      subscriptionName: "shipperbox",
      nativeType: "aiplatform#ReasoningEngine",
      externalId: "projects/x/reasoningEngines/1",
    },
    sourceRules: [{
      id: "wc-id-3217",
      name: "Managed AI Agent with high privileges or sensitive data access",
      resolutionRecommendation: "Apply least-privilege to the agent service account.",
    }],
  };
}

describe("normalizeIssuesPage (issuesV2)", () => {
  it("preserves real per-asset multiplicity and maps real severity + recommendation", () => {
    const part = normalizeIssuesPage([issueRaw("iss-1"), issueRaw("iss-2")]);
    expect(part.issues).toHaveLength(2); // two real issues on one asset
    const issue = part.issues[0];
    expect(issue.id).toBe("iss-1");
    expect(issue.assetId).toBe("wiz-asset-42");
    expect(issue.comboGroup).toBe("gcp-managed-privileged");
    expect(issue.nativeSeverity).toBe("MEDIUM");
    expect(issue.adjustedSeverity).toBe("HIGH");
    expect(issue.account).toBe("shipperbox");
    expect(issue.dueAt).toBe("2026-09-22T04:04:04Z");
    expect(issue.resolutionRecommendation).toContain("least-privilege");
  });

  it("emits a thin GNode from entitySnapshot, minimal so it can't clobber inventory", () => {
    const part = normalizeIssuesPage([issueRaw("iss-1")]);
    expect(part.nodes).toHaveLength(1);
    const node = part.nodes[0];
    expect(node).toMatchObject({ id: "wiz-asset-42", kind: "AI_AGENT", name: "StockBuddy" });
    expect(node.cloudAccount).toBeUndefined(); // never overwrites inventory's richer account
  });

  it("skips issues with no id or no attachable entity", () => {
    const noEntity = { id: "iss-x", severity: "HIGH" };
    const part = normalizeIssuesPage([noEntity, {}]);
    expect(part.issues).toHaveLength(0);
    expect(part.nodes).toHaveLength(0);
  });
});

describe("reconcileIssues (augment de-dup)", () => {
  const real: IssueRow = {
    id: "uuid-real", ruleId: "wc-id-3217", ruleName: "r", comboGroup: "gcp-managed-privileged",
    nativeSeverity: "MEDIUM", adjustedSeverity: "HIGH", status: "OPEN",
    assetId: "asset-1", assetName: "A",
  };
  const syntheticSameKey: IssueRow = {
    ...real, id: "live-wc-id-3217-asset-1",
  };
  const syntheticOtherAsset: IssueRow = {
    ...real, id: "live-wc-id-3217-asset-2", assetId: "asset-2",
  };

  it("drops the synthetic per-rule row that a real issue supersedes", () => {
    const out = reconcileIssues([real, syntheticSameKey]);
    expect(out.map((i) => i.id)).toEqual(["uuid-real"]);
  });

  it("keeps a synthetic row for an (asset, group) issuesV2 didn't cover", () => {
    const out = reconcileIssues([real, syntheticOtherAsset]);
    expect(out.map((i) => i.id).sort()).toEqual(["live-wc-id-3217-asset-2", "uuid-real"]);
  });
});

// Trimmed from exemples/ai_cloud_config_findings_response.js.
const CONFIG_FINDING_RAW: Record<string, unknown> = {
  id: "find-1",
  name: "Vertex AI Metadata Store is not encrypted with a customer-managed key",
  severity: "MEDIUM",
  result: "FAIL",
  status: "OPEN",
  remediation: "Delete and recreate the metadata store with a customer-managed key.",
  resource: { id: "wiz-asset-42", name: "europe-west1", type: "REGION" },
  rule: {
    shortId: "SUB-082",
    name: "Vertex AI Metadata Store should be encrypted with a customer-managed key",
    remediationInstructions: "Follow the GCP console steps.",
    risks: ["AI_SECURITY", "UNPROTECTED_DATA"],
    tags: [{ key: "owasp", value: "LLM06" }],
  },
};

describe("normalizeConfigFindingsPage", () => {
  it("keeps FAILING OPEN findings and extracts framework codes (shortId + OWASP token)", () => {
    const part = normalizeConfigFindingsPage([CONFIG_FINDING_RAW]);
    expect(part.findings).toHaveLength(1);
    const f = part.findings[0];
    expect(f.resourceId).toBe("wiz-asset-42");
    expect(f.ruleShortId).toBe("SUB-082");
    expect(f.remediation).toContain("customer-managed key");
    expect(f.frameworkCodes).toEqual(["SUB-082", "LLM06"]);
  });

  it("drops PASS results and findings with no resource", () => {
    const pass = { ...CONFIG_FINDING_RAW, id: "find-2", result: "PASS" };
    const noResource = { id: "find-3", result: "FAIL", status: "OPEN" };
    const part = normalizeConfigFindingsPage([pass, noResource]);
    expect(part.findings).toHaveLength(0);
  });
});

describe("normalizePrincipalsPage (agentic identities)", () => {
  const PRINCIPAL_RAW = {
    id: "sa-1",
    name: "vertex-agent-sa@iam.gserviceaccount.com",
    type: "SERVICE_ACCOUNT",
    hasHighPrivileges: true,
    technology: { id: "8023", name: "GCP Service Account", categories: [{ id: "138", name: "Identity" }] },
    issueAnalytics: {
      issueCount: 2, informationalSeverityCount: 0, lowSeverityCount: 1,
      mediumSeverityCount: 1, highSeverityCount: 0, criticalSeverityCount: 0,
    },
  };

  it("flags identityPurpose AGENTIC by construction and maps issueAnalytics + tech", () => {
    const part = normalizePrincipalsPage([PRINCIPAL_RAW]);
    expect(part.nodes).toHaveLength(1);
    const node = part.nodes[0];
    expect(node.kind).toBe("SERVICE_ACCOUNT");
    expect(node.identityPurpose).toBe("AGENTIC");
    expect(node.technologyCategories).toEqual(["Identity"]);
    expect(node.issueAnalytics).toEqual({ total: 2, info: 0, low: 1, medium: 1, high: 0, critical: 0 });
  });

  it("resolves the new ACCESS_KEY node kind", () => {
    const part = normalizePrincipalsPage([{ id: "k1", type: "ACCESS_KEY", name: "AKIA..." }]);
    expect(part.nodes).toHaveLength(1);
    expect(part.nodes[0].kind).toBe("ACCESS_KEY");
    expect(part.nodes[0].identityPurpose).toBe("AGENTIC");
  });
});
