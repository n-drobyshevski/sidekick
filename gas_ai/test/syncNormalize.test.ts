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
  normalizeSensitiveDataAccessPage,
  normalizeDataFindingSeverity,
  reconcileIssues,
  withDataFindingCounts,
  worstBusinessImpact,
} from "../src/domain/syncNormalize";
import { COMBO_GROUPS, OTHER_GROUP_ID } from "../src/domain/toxicCombos";
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

describe("worstBusinessImpact", () => {
  it("HBI beats MBI beats LBI, whatever order the projects arrive in", () => {
    expect(worstBusinessImpact([
      { businessImpact: "LBI" },
      { businessImpact: "HBI" },
      { businessImpact: "MBI" },
    ])).toBe("HBI");
  });

  it("skips a project with no recognised tier rather than treating it as worst", () => {
    expect(worstBusinessImpact([{ businessImpact: "LBI" }, {}])).toBe("LBI");
  });

  it("is undefined for an empty list or a list with nothing recognised", () => {
    expect(worstBusinessImpact([])).toBeUndefined();
    expect(worstBusinessImpact([{}, { businessImpact: "BOGUS" }])).toBeUndefined();
  });
});

describe("normalizeCloudResource on a graphSearch entity", () => {
  // Transcribed from exemples/ai_agent_expand_response.js — the AI_AGENT entity, trimmed
  // to the keys the normalizer reads. This shape, NOT the flat one, is what a graphSearch
  // entity actually returns: the tenant rejects `... on CloudResource` outright
  // ("objects of type GraphEntity can never be of type CloudResource"), so the resource
  // facts arrive only in the properties bag.
  const ENTITY_RAW = {
    id: "11111111-1111-5111-a111-111111111111",
    name: "example-agent",
    type: "AI_AGENT",
    properties: {
      cloudPlatform: "GCP",
      region: "europe-west1",
      status: "Active",
      nativeType: "aiplatform#ReasoningEngine",
      externalId: "projects/1/locations/europe-west1/reasoningEngines/1",
      creationDate: "2026-08-03T13:38:32Z",
      updatedAt: "2026-08-04T06:03:44Z",
      hasAccessToSensitiveData: false,
      hasAdminPrivileges: false,
      hasHighPrivileges: false,
      "accessibleFrom.internet": false,
      openToAllInternet: false,
    },
  };

  it("recovers the facts the flat shape carries on the node", () => {
    const node = normalizeCloudResource(ENTITY_RAW)!;
    expect(node.kind).toBe("AI_AGENT");
    expect(node.cloudPlatform).toBe("GCP");
    expect(node.region).toBe("europe-west1");
    expect(node.status).toBe("Active");
    expect(node.nativeType).toBe("aiplatform#ReasoningEngine");
    expect(node.externalId).toBe("projects/1/locations/europe-west1/reasoningEngines/1");
  });

  it("maps the two keys the bag spells differently", () => {
    const node = normalizeCloudResource(ENTITY_RAW)!;
    expect(node.firstSeen).toBe("2026-08-03T13:38:32Z"); // creationDate
    expect(node.lastSeen).toBe("2026-08-04T06:03:44Z");  // updatedAt
    expect(node.isAccessibleFromInternet).toBe(false);   // accessibleFrom.internet
    expect(node.isOpenToAllInternet).toBe(false);        // openToAllInternet
  });

  it("carries identityPurpose off a traversed identity, in the app's own spelling", () => {
    // The SERVICE_ACCOUNT in the capture has identityPurpose in its bag. Before this, only
    // the principals query could set it, so an agentic identity reached through a
    // traversal looked like any other service account.
    //
    // It is now NORMALIZED, and that closes a second gap this test used to pin open. Wiz
    // returns `IdentityPurposeAgentic` while the filter takes `AGENTIC`, and every consumer
    // compares against the short form — `kpis.agenticIdentities` is
    // `identityPurpose === "AGENTIC"`. So a traversal-reached agentic identity carried a
    // purpose that no reader recognised: labelled in the ledger, uncounted on the page.
    const node = normalizeCloudResource({
      id: "sa-1", name: "sa", type: "SERVICE_ACCOUNT",
      properties: { identityPurpose: "IdentityPurposeAgentic", region: "europe-west1" },
    })!;
    expect(node.identityPurpose).toBe("AGENTIC");
    expect(node.region).toBe("europe-west1");
  });

  it("still reads the flat shape the inventory root returns", () => {
    // The same function serves both roots; the flat path must not regress.
    const node = normalizeCloudResource(AGENT_RAW)!;
    expect(node.cloudPlatform).toBe("GCP");
    expect(node.firstSeen).toBe("2026-04-02T08:00:00Z");
    expect(node.isAccessibleFromInternet).toBe(false);
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

describe("normalizeSensitiveDataAccessPage — the data-exposure chain", () => {
  const STORE_RAW = {
    id: "wiz-node-bucket-1",
    name: "shipperbox-sftp",
    type: "BUCKET",
    cloudPlatform: "GCP",
    region: "europe-west1",
    hasSensitiveData: true,
  };
  const df = (id: string, severity: string) => ({
    id, type: "DATA_FINDING", name: "PII: email addresses", severity,
  });

  it("implies RUNS_AS + ALLOWS_ACCESS_TO, and files the findings on the store", () => {
    const part = normalizeSensitiveDataAccessPage([{
      entities: [AGENT_RAW, SA_RAW, STORE_RAW,
        df("f1", "DataFindingSeverityCritical"), df("f2", "DataFindingSeverityHigh")],
    }]);

    expect(part.edges).toEqual([
      expect.objectContaining({ src: "wiz-node-agent-1", dst: "wiz-node-sa-1", type: "RUNS_AS" }),
      expect.objectContaining({
        src: "wiz-node-sa-1", dst: "wiz-node-bucket-1", type: "ALLOWS_ACCESS_TO",
      }),
    ]);
    // No accessType: the query filters on the STORE's classification, not on the grant's
    // strength, so there is nothing on the wire to read one from.
    expect(part.edges[1].accessType).toBeUndefined();

    // The findings are rows, never nodes — the graph draws one aggregate per store.
    expect(part.nodes.map((n) => n.id))
      .toEqual(["wiz-node-agent-1", "wiz-node-sa-1", "wiz-node-bucket-1"]);
    expect(part.dataFindings).toEqual([
      { id: "f1", resourceId: "wiz-node-bucket-1", name: "PII: email addresses", severity: "CRITICAL" },
      { id: "f2", resourceId: "wiz-node-bucket-1", name: "PII: email addresses", severity: "HIGH" },
    ]);
  });

  it("keeps a classified store that carries no findings", () => {
    // HAS_DATA_FINDING is optional in the document for exactly this row: requiring a
    // finding would drop the whole path, which is the state the chain exists to end.
    const part = normalizeSensitiveDataAccessPage([{ entities: [AGENT_RAW, SA_RAW, STORE_RAW] }]);
    expect(part.edges).toHaveLength(2);
    expect(part.dataFindings).toEqual([]);
  });

  it("survives the null padding the API actually sends for that row", () => {
    // The test above models "no finding" as a SHORT array. The tenant does not send a
    // short array — exemples/ai_agent_expand_response.js shows an unmatched `optional` leg
    // comes back as a literal null holding its position, 39 of them in that capture. With
    // no guard on the element, normalizeCloudResource read raw["id"] off null and threw a
    // TypeError; runBattery only forgives an optional step on HTTP 400, so that TypeError
    // failed the whole sync rather than being recorded as a skip.
    const part = normalizeSensitiveDataAccessPage([
      { entities: [AGENT_RAW, SA_RAW, STORE_RAW, null] },
    ]);
    expect(part.edges).toHaveLength(2);
    expect(part.dataFindings).toEqual([]);
  });

  it("ignores null entities everywhere else too", () => {
    expect(normalizeCloudResource(null as never)).toBeNull();
    expect(normalizeRunsAsPage([{ entities: [AGENT_RAW, null, SA_RAW, null] }]).edges)
      .toHaveLength(1);
    expect(normalizeNoGuardrailPage([{ entities: [null, AGENT_RAW] }]).nodes)
      .toHaveLength(1);
  });

  it("drops findings it cannot attribute, rather than guessing a store", () => {
    const second = { ...STORE_RAW, id: "wiz-node-db-1", name: "db-core", type: "DATABASE" };
    const part = normalizeSensitiveDataAccessPage([{
      entities: [AGENT_RAW, SA_RAW, STORE_RAW, second, df("f1", "DataFindingSeverityHigh")],
    }]);
    // Both access edges are still drawn — the paths are real.
    expect(part.edges.filter((e) => e.type === "ALLOWS_ACCESS_TO")).toHaveLength(2);
    // But a flat entity list cannot say WHICH store the finding was in.
    expect(part.dataFindings).toEqual([]);
  });

  it("reads Wiz's prefixed severity spelling, and the bare one", () => {
    expect(normalizeDataFindingSeverity("DataFindingSeverityCritical")).toBe("CRITICAL");
    expect(normalizeDataFindingSeverity("HIGH")).toBe("HIGH");
    expect(normalizeDataFindingSeverity("something-else")).toBe("UNKNOWN");
    expect(normalizeDataFindingSeverity(undefined)).toBe("UNKNOWN");
  });

  it("folds counts across pages at commit, not per page", () => {
    // mergeParts overwrites scalars rather than summing them, so a per-page count would
    // silently become whatever the LAST page saw. The fold reads the deduped rows instead.
    const doc = {
      nodes: [{ id: "store", kind: "BUCKET" as const, name: "store", hasSensitiveData: true }],
      edges: [],
      syncedAt: "2026-06-28T06:00:00Z",
    };
    const counted = withDataFindingCounts(doc, [
      { id: "a", resourceId: "store", name: "a", severity: "CRITICAL" },
      { id: "b", resourceId: "store", name: "b", severity: "HIGH" },
      { id: "c", resourceId: "store", name: "c", severity: "HIGH" },
    ]);
    expect(counted.nodes[0].dataFindingCount).toBe(3);
    expect(counted.nodes[0].dataFindingSeverities).toEqual({ CRITICAL: 1, HIGH: 2 });
  });

  it("leaves a store the traversal never reached without a count at all", () => {
    // Not 0: "clean" and "never asked" price differently in pillar C and read differently
    // on the coverage page.
    const doc = {
      nodes: [{ id: "unasked", kind: "BUCKET" as const, name: "unasked", hasSensitiveData: true }],
      edges: [],
      syncedAt: "2026-06-28T06:00:00Z",
    };
    expect(withDataFindingCounts(doc, []).nodes[0].dataFindingCount).toBeUndefined();
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
    // mergeParts merges field-wise on any truthy value and ISSUES_TOXIC runs after
    // INVENTORY_AI, so anything set here REPLACES the inventory's. entitySnapshot is a
    // point-in-time copy: its tags are whatever the snapshot caught and its status can be
    // stale, so both ride on the IssueRow instead of overwriting fresher asset data.
    expect(node.tags).toBeUndefined();
    expect(node.status).toBeUndefined();
  });

  it("carries the issuesV2 lifecycle fields the register reports on", () => {
    const raw = issueRaw("iss-1");
    Object.assign(raw, {
      updatedAt: "2026-08-13T10:30:01Z",
      resolvedAt: "2026-08-01T00:00:00Z",
      resolutionReason: "ISSUE_FIXED",
      resolvedBy: { user: { id: "u1", name: "A. Analyst", email: "a@example.com" } },
      assignee: { id: "u2", name: "B. Owner", primaryEmail: "b@example.com" },
      environments: ["PRODUCTION"],
      validatedAsExploitable: true,
      rejectionExpiredAt: "2026-02-01T00:00:00Z",
      serviceTickets: [
        { id: "t1", name: "#sec-ai", url: "https://example.slack.com/archives/C1/p1" },
      ],
      aiRemediationAnalysis: { verdict: "REMEDIATE", recommendedSeverity: "MEDIUM" },
    });
    (raw["entitySnapshot"] as Record<string, unknown>)["status"] = "Inactive";
    (raw["entitySnapshot"] as Record<string, unknown>)["subscriptionId"] = "sub-1";

    const issue = normalizeIssuesPage([raw]).issues[0];
    expect(issue.issueType).toBe("TOXIC_COMBINATION");
    expect(issue.updatedAt).toBe("2026-08-13T10:30:01Z");
    expect(issue.resolvedAt).toBe("2026-08-01T00:00:00Z");
    expect(issue.resolutionReason).toBe("ISSUE_FIXED");
    expect(issue.resolvedBy).toBe("A. Analyst");
    expect(issue.assignee).toBe("B. Owner");
    expect(issue.environments).toEqual(["PRODUCTION"]);
    expect(issue.validatedAsExploitable).toBe(true);
    expect(issue.entityStatus).toBe("Inactive");
    expect(issue.subscriptionId).toBe("sub-1");
    expect(issue.ignoreExpiredAt).toBe("2026-02-01T00:00:00Z");
    expect(issue.ticketUrls).toEqual(["https://example.slack.com/archives/C1/p1"]);
    expect(issue.aiVerdict).toBe("REMEDIATE");
    expect(issue.aiRecommendedSeverity).toBe("MEDIUM");
  });

  it("collapses resolvedBy from either shape, and falls back to the email", () => {
    const withSa = issueRaw("iss-sa");
    withSa["resolvedBy"] = { user: null, serviceAccount: { id: "s1", name: "wiz-automation" } };
    expect(normalizeIssuesPage([withSa]).issues[0].resolvedBy).toBe("wiz-automation");

    const emailOnly = issueRaw("iss-e");
    emailOnly["resolvedBy"] = { user: { id: "u1", email: "a@example.com" } };
    expect(normalizeIssuesPage([emailOnly]).issues[0].resolvedBy).toBe("a@example.com");
  });

  it("takes the ignore rationale off the note log without parsing its prose", () => {
    // notes[] is an ordered log: the lapse notice is prepended above the rationale. The
    // "Ignored until: Feb 1, 2026" date inside the prose is deliberately NOT parsed —
    // rejectionExpiredAt is the same fact as a timestamp, and the note is free text.
    const raw = issueRaw("iss-ignored");
    raw["notes"] = [
      { id: "n1", text: "Status was updated to OPEN on 2026-02-01 as ignore date expired" },
      { id: "n2", text: "Ignored (By Design) by MANSUY.\nExplanation: …\n\nIgnored until: Feb 1, 2026" },
    ];
    raw["rejectionExpiredAt"] = "2026-02-01T00:00:00Z";
    const issue = normalizeIssuesPage([raw]).issues[0];
    expect(issue.ignoreNote).toContain("Ignored (By Design) by MANSUY.");
    expect(issue.ignoreExpiredAt).toBe("2026-02-01T00:00:00Z");
  });

  it("reduces business impact to the worst project", () => {
    const raw = issueRaw("iss-bi");
    raw["projects"] = [
      { id: "p1", name: "LOW", riskProfile: { businessImpact: "LBI" } },
      { id: "p2", name: "HIGH", riskProfile: { businessImpact: "HBI" } },
      { id: "p3", name: "MED", riskProfile: { businessImpact: "MBI" } },
    ];
    expect(normalizeIssuesPage([raw]).issues[0].businessImpact).toBe("HBI");
  });

  it("buckets an unmodelled source rule into Other, carrying Wiz severity untouched", () => {
    // The filter collects the whole AI risk category, so a rule outside the four patterns
    // is a real register row — not noise to drop.
    const raw = issueRaw("iss-other");
    raw["sourceRules"] = [{ id: "wc-id-9999", name: "Some rule this register does not model" }];
    const issue = normalizeIssuesPage([raw]).issues[0];
    expect(issue.comboGroup).toBe(OTHER_GROUP_ID);
    expect(issue.adjustedSeverity).toBe(issue.nativeSeverity);
    expect(issue.frameworks).toBeUndefined();
  });

  it("keeps a threat detection, whose source rule is a different shape entirely", () => {
    // With no type filter the register collects every issue in the AI category, including
    // threat detections. Their source rule is a CloudEventRule; Q_ISSUES now spreads that
    // fragment, so the row arrives named and classifies into Other AI risk with Wiz's
    // severity untouched.
    const raw = issueRaw("iss-threat");
    raw["type"] = "THREAT_DETECTION";
    raw["severity"] = "LOW";
    raw["sourceRules"] = [{ id: "wcer-id-1", name: "Anomalous model invocation volume" }];
    const issue = normalizeIssuesPage([raw]).issues[0];
    expect(issue.issueType).toBe("THREAT_DETECTION");
    expect(issue.ruleName).toBe("Anomalous model invocation volume");
    expect(issue.comboGroup).toBe(OTHER_GROUP_ID);
    expect(issue.nativeSeverity).toBe("LOW");
    expect(issue.adjustedSeverity).toBe("LOW");
  });

  it("still collects an issue whose source rule shape has no fragment at all", () => {
    // A rule kind this document does not spread comes back as an empty object. The issue
    // is real and still counted — it just has no rule name, and the sheet falls back to
    // the issue type rather than rendering a blank heading.
    const raw = issueRaw("iss-unknown-rule");
    raw["sourceRules"] = [{}];
    const issue = normalizeIssuesPage([raw]).issues[0];
    expect(issue.id).toBe("iss-unknown-rule");
    expect(issue.ruleId).toBe("");
    expect(issue.ruleName).toBe("");
    expect(issue.comboGroup).toBe(OTHER_GROUP_ID);
  });

  it("treats absent optional fields as not-captured rather than empty", () => {
    // The per-rule Q_RULE_ASSETS fallback synthesises issues from the inventory API,
    // which carries none of this; undefined must not become [] or false.
    const raw = issueRaw("iss-bare");
    Object.assign(raw, {
      notes: null, serviceTickets: null, resolvedBy: null, assignee: null,
      environments: null, aiRemediationAnalysis: null, validatedAsExploitable: false,
    });
    const issue = normalizeIssuesPage([raw]).issues[0];
    expect(issue.ignoreNote).toBeUndefined();
    expect(issue.ticketUrls).toBeUndefined();
    expect(issue.resolvedBy).toBeUndefined();
    expect(issue.assignee).toBeUndefined();
    expect(issue.environments).toBeUndefined();
    expect(issue.aiVerdict).toBeUndefined();
    expect(issue.validatedAsExploitable).toBeUndefined();
    expect(issue.ignoreNote).toBeUndefined();
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

// Transcribed from exemples/ai_config_findings_response.js (the capture is truncated
// mid-node and nothing imports it, so fixtures here are inlined by hand — same convention
// as riskIssuesCapture.test.ts). This is the SUB-082 / REGION shape, carrying every field
// the widened selection set asks for.
const CONFIG_FINDING_RAW: Record<string, unknown> = {
  id: "find-1",
  name: "Vertex AI Metadata Store is not encrypted with a customer-managed key",
  deleted: false,
  analyzedAt: "2026-07-07T15:59:10.110596369Z",
  firstSeenAt: "2026-07-07T15:59:28.164073Z",
  severity: "MEDIUM",
  result: "FAIL",
  status: "OPEN",
  remediation: "Delete and recreate the metadata store with a customer-managed key.",
  source: "WIZ_CSPM",
  targetExternalId: "vc-smp-innovation-stg-t5zy/europe-west1",
  ignoreRules: null,
  subscription: {
    id: "5158ac86-8442-5dd0-baaf-fcd13456eed8",
    name: "vc-smp-innovation-stg-t5zy",
    externalId: "vc-smp-innovation-stg-t5zy",
    cloudProvider: "GCP",
    sourceDeployments: [{ id: "9fbbd355", name: "gcp-main-org", status: "ENABLED" }],
  },
  resource: {
    id: "wiz-asset-42",
    name: "europe-west1",
    type: "REGION",
    status: "Active",
    projects: [
      { id: "p-1", name: "VALUE-CHAIN", riskProfile: { businessImpact: "LBI" } },
      { id: "p-2", name: "owner-CE-INDUS-SUPPLY-cloud", riskProfile: { businessImpact: "MBI" } },
    ],
  },
  sourceMappedIacFindings: null,
  rule: {
    id: "60442ee5-452a-48cb-8694-9061c920e10d",
    shortId: "SUB-082",
    graphId: "d354eff1-2df7-5e21-80c5-19489a284f00",
    name: "Vertex AI Metadata Store should be encrypted with a customer-managed key",
    description: "This rule checks whether the store is encrypted with a customer-managed key.",
    remediationInstructions: "Follow the GCP console steps.",
    risks: ["AI_SECURITY", "UNPROTECTED_DATA"],
    threats: [],
    tags: [{ key: "owasp", value: "LLM06" }],
    opaPolicy: "package wiz\n\ndefault result = \"pass\"\n",
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

  it("carries the whole record, not just the six fields AARS prices", () => {
    const f = normalizeConfigFindingsPage([CONFIG_FINDING_RAW]).findings[0];
    expect(f.name).toContain("Vertex AI Metadata Store");
    expect(f.status).toBe("OPEN");
    expect(f.result).toBe("FAIL");
    expect(f.firstSeenAt).toBe("2026-07-07T15:59:28.164073Z");
    expect(f.analyzedAt).toBe("2026-07-07T15:59:10.110596369Z");
    expect(f.ruleId).toBe("60442ee5-452a-48cb-8694-9061c920e10d");
    expect(f.ruleGraphId).toBe("d354eff1-2df7-5e21-80c5-19489a284f00");
    expect(f.ruleName).toContain("customer-managed key");
    expect(f.ruleDescription).toContain("encrypted");
    expect(f.remediationInstructions).toBe("Follow the GCP console steps.");
    expect(f.opaPolicy).toContain("package wiz");
    expect(f.risks).toEqual(["AI_SECURITY", "UNPROTECTED_DATA"]);
    expect(f.threats).toEqual([]);
    expect(f.resourceName).toBe("europe-west1");
    expect(f.resourceType).toBe("REGION");
    expect(f.resourceStatus).toBe("Active");
    expect(f.targetExternalId).toBe("vc-smp-innovation-stg-t5zy/europe-west1");
    expect(f.source).toBe("WIZ_CSPM");
    expect(f.subscriptionId).toBe("5158ac86-8442-5dd0-baaf-fcd13456eed8");
    expect(f.subscriptionName).toBe("vc-smp-innovation-stg-t5zy");
    expect(f.cloudProvider).toBe("GCP");
    expect(f.projects?.map((p) => p.name)).toEqual(["VALUE-CHAIN", "owner-CE-INDUS-SUPPLY-cloud"]);
    // Worst across the projects, not the first one's.
    expect(f.businessImpact).toBe("MBI");
    expect(f.ignoreRuleIds).toEqual([]);
    expect(f.iacFindingIds).toEqual([]);
  });

  it("reads ignoreRules and sourceMappedIacFindings as id lists when present", () => {
    const withRefs = {
      ...CONFIG_FINDING_RAW,
      id: "find-ref",
      ignoreRules: [{ id: "ig-1", tags: [{ key: "why", value: "accepted" }] }],
      sourceMappedIacFindings: [{ id: "iac-1", name: "main.tf" }],
    };
    const f = normalizeConfigFindingsPage([withRefs]).findings[0];
    expect(f.ignoreRuleIds).toEqual(["ig-1"]);
    expect(f.iacFindingIds).toEqual(["iac-1"]);
  });

  // The contract inverted here on purpose. While the step only asked Wiz for OPEN rows,
  // dropping PASS at the door was right. Now that it also asks for RESOLVED — the only
  // way to date a closure, since Wiz sends no resolvedAt — a fixed finding arrives as
  // PASS, and the old gate would have discarded exactly what the widened filter is for.
  // Storage keeps everything usable; isOpenGap decides what counts.
  it("stores resolved and passing findings instead of dropping them", () => {
    const resolved = { ...CONFIG_FINDING_RAW, id: "find-2", result: "PASS", status: "RESOLVED" };
    const part = normalizeConfigFindingsPage([CONFIG_FINDING_RAW, resolved]);
    expect(part.findings.map((f) => f.id)).toEqual(["find-1", "find-2"]);
    expect(part.findings[1].result).toBe("PASS");
    expect(part.findings[1].status).toBe("RESOLVED");
  });

  it("still drops rows it could not key: no id, or no resource", () => {
    const noResource = { id: "find-3", result: "FAIL", status: "OPEN" };
    const noId = { ...CONFIG_FINDING_RAW, id: undefined };
    const part = normalizeConfigFindingsPage([noResource, noId]);
    expect(part.findings).toHaveLength(0);
  });

  it("leaves `deleted` absent unless the response said true", () => {
    const notDeleted = normalizeConfigFindingsPage([CONFIG_FINDING_RAW]).findings[0];
    expect(notDeleted.deleted).toBeUndefined();
    const tombstoned = normalizeConfigFindingsPage(
      [{ ...CONFIG_FINDING_RAW, deleted: true }],
    ).findings[0];
    expect(tombstoned.deleted).toBe(true);
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

describe("normalizeRunsAsPage — the binding the high-privilege path now returns", () => {
  const ent = (id: string, type: string, props: Record<string, unknown> = {}) =>
    ({ id, type, properties: { name: id, ...props } });

  it("draws SERVICE_ACCOUNT -BOUND_TO-> IAM_BINDING when the binding comes back", () => {
    // SA_FINDINGS now walks the console's proven path, which ends at an IAM_BINDING rather than
    // only at a finding. An entity nothing draws an edge for is an entity the graph cannot
    // explain, and BOUND_TO was declared in EDGE_TYPES and produced by nothing until now.
    const part = normalizeRunsAsPage([{
      entities: [
        ent("agent-1", "AI_AGENT"),
        ent("sa-1", "SERVICE_ACCOUNT", { hasHighPrivileges: true }),
        ent("bind-1", "IAM_BINDING", { accessTypes: ["HighPrivilege"] }),
      ],
    }]);
    const types = part.edges.map((e) => e.type).sort();
    expect(types).toEqual(["BOUND_TO", "RUNS_AS"]);
    const bound = part.edges.filter((e) => e.type === "BOUND_TO")[0];
    expect(bound.src).toBe("sa-1");
    expect(bound.dst).toBe("bind-1");
  });

  it("still draws the finding edge, which the export did not replace", () => {
    const part = normalizeRunsAsPage([{
      entities: [
        ent("agent-1", "AI_AGENT"),
        ent("sa-1", "SERVICE_ACCOUNT"),
        ent("find-1", "EXCESSIVE_ACCESS_FINDING"),
      ],
    }]);
    expect(part.edges.map((e) => e.type).sort()).toEqual(["HAS_FINDING", "RUNS_AS"]);
  });

  it("emits no binding edge when the optional leg came back empty", () => {
    // Every leg below the principal is optional, so a high-privileged identity with no binding
    // in the row is the normal case, not a defect.
    const part = normalizeRunsAsPage([{
      entities: [ent("agent-1", "AI_AGENT"), ent("sa-1", "SERVICE_ACCOUNT")],
    }]);
    expect(part.edges.map((e) => e.type)).toEqual(["RUNS_AS"]);
  });
});
