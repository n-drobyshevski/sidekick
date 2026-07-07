// Live-response normalization: hand-written fixture pages matching the documented
// selection sets in ai/queries/*.md (the reponse_schemas/ stubs are empty, so these
// pin the assumed shapes until real captures land).

import { describe, expect, it } from "vitest";
import {
  mergeParts,
  normalizeCloudResource,
  normalizeIdentityAccessPage,
  normalizeInventoryPage,
  normalizeNoGuardrailPage,
  normalizeRuleAssetsPage,
  normalizeRunsAsPage,
} from "../src/domain/syncNormalize";
import { COMBO_GROUPS } from "../src/domain/toxicCombos";

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
  projects: [{ id: "p1", name: "PROJECT-ALPHA", businessImpact: "HBI" }],
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
});
