// The register reconciles against the Wiz console.
//
// Rows here are transcribed from exemples/risk_issues_response.js — the tenant-wide
// "Risk Issues" capture, AI Security category, 2026-08-13. The claim under test is the
// one the whole change exists to make true: every node Wiz returns becomes exactly one
// counted register row. Nothing is dropped for being in-progress, and nothing is dropped
// for matching no modelled pattern.
//
// The exemples/*.js files are raw captures, not modules (nothing imports them), so the
// fixture is inlined here the way test/syncNormalize.test.ts inlines its own.

import { describe, expect, it } from "vitest";
import { mergeParts, normalizeIssuesPage } from "../src/domain/syncNormalize";
import { comboDigest } from "../src/domain/comboDigest";
import { comboSummary, OTHER_GROUP_ID } from "../src/domain/toxicCombos";
import { isUnresolvedIssue } from "../src/domain/config";
import { issueToRow, rowToIssue } from "../src/server/syncStore";

type Raw = Record<string, unknown>;

function node(over: Raw): Raw {
  return {
    type: "TOXIC_COMBINATION",
    severity: "MEDIUM",
    status: "OPEN",
    createdAt: "2026-07-28T22:12:51Z",
    updatedAt: "2026-08-13T10:30:01Z",
    dueAt: "2026-10-26T22:12:51Z",
    resolvedAt: null,
    resolutionReason: null,
    resolvedBy: null,
    rejectionExpiredAt: null,
    validatedAsExploitable: false,
    assignee: null,
    notes: null,
    serviceTickets: null,
    applicationServices: null,
    aiRemediationAnalysis: null,
    environments: ["PRODUCTION"],
    projects: [
      { id: "p-vc", name: "VALUE-CHAIN", slug: "value-chain", riskProfile: { businessImpact: "LBI" } },
      { id: "p-own", name: "owner-cloud", slug: "prov", riskProfile: { businessImpact: "MBI" } },
    ],
    ...over,
  };
}

function snapshot(over: Raw): Raw {
  return {
    type: "AI_AGENT",
    status: "Active",
    cloudPlatform: "GCP",
    region: "europe-west3",
    subscriptionName: "vc-self-training-preprod-mkez",
    subscriptionId: "cc58d576-5da3-508d-af83-7121b2803fbb",
    subscriptionExternalId: "vc-self-training-preprod-mkez",
    nativeType: "aiplatform#ReasoningEngine",
    kubernetesClusterName: "",
    kubernetesNamespaceName: "",
    tags: {},
    resourceGroupId: null,
    ...over,
  };
}

const RULE_3217 = {
  id: "wc-id-3217",
  name: "Managed AI Agent with high privileges or sensitive data access",
  resolutionRecommendation: "Apply least-privilege principles to the agent's service account",
  risks: ["UNPROTECTED_DATA", "AI_SECURITY"],
};
const RULE_3230 = {
  id: "wc-id-3230",
  name: "AI Agent hosted on VM/serverless with high privileges or sensitive data access",
  resolutionRecommendation: "Apply least-privilege principles to the service account",
  risks: ["UNPROTECTED_DATA", "AI_SECURITY"],
};
const RULE_2742 = {
  id: "wc-id-2742",
  name: "Allow model invoke without Guardrail for user or role",
  resolutionRecommendation: "### Attach guardrails to Bedrock Agents",
  risks: ["AI_SECURITY"],
};
/** In the AI category, but no pattern this register models. */
const RULE_UNMODELLED = {
  id: "wc-id-9999",
  name: "Some AI control this register has never seen",
  risks: ["AI_SECURITY"],
};

const PAGE: Raw[] = [
  node({
    id: "4a8b7ef5-46c1-47a7-b09f-7928be9fb980",
    entitySnapshot: snapshot({
      id: "ac449388-507d-5eb3-99ef-6f63a41c4a96",
      name: "pprod-vc-self-training-supervisor-agent",
    }),
    sourceRules: [RULE_3217],
  }),
  node({
    // Hosted agent on an Inactive VM, carrying a domain tag.
    id: "fc0226fa-7296-49d9-b863-acabf5b5b855",
    dueAt: "2026-08-20T14:44:47Z",
    entitySnapshot: snapshot({
      id: "36341fba-70e0-5191-a266-df086d644148",
      name: "Gemini CLI",
      status: "Inactive",
      nativeType: "hostedAiAgent",
      region: "europe-west4",
      tags: { "Wiz/Domain": "SAP" },
    }),
    sourceRules: [RULE_3230],
  }),
  node({
    // Carries a Slack ticket and a Wiz AI remediation verdict.
    id: "ea0706fd-edd8-4006-b400-b6a336d14bc3",
    dueAt: "2026-07-07T04:23:50Z",
    entitySnapshot: snapshot({
      id: "f78a372c-fff8-53b7-bc58-06556462ff42",
      name: "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
      region: "us-west1",
    }),
    serviceTickets: [{
      id: "f43621c3", externalId: "slackThread/T6/C0/1775622232.097139",
      name: "Decathlon Digital - 1775622232.097139",
      url: "https://decathlondigital.slack.com/archives/C0AGUF82MM1/p1775622232097139",
    }],
    aiRemediationAnalysis: { verdict: "REMEDIATE", recommendedSeverity: "MEDIUM" },
    sourceRules: [RULE_3217],
  }),
  node({
    // A SERVICE_ACCOUNT entity, not an AI_AGENT — the Bedrock guardrail rule.
    id: "e0f2bf67-f2dc-48f6-86c4-c168615d1a1a",
    dueAt: "2026-06-11T22:22:46Z",
    entitySnapshot: snapshot({
      id: "48906b02-7933-52bb-9826-e8d52563a7fd",
      type: "SERVICE_ACCOUNT",
      name: "AWSReservedSSO_DKTFinopsAdministrator_781e09fd9eba825a",
      cloudPlatform: "AWS",
      region: "",
      nativeType: "role",
      subscriptionName: "hpc068-rfidprodv2-prod",
      subscriptionExternalId: "540621235896",
    }),
    aiRemediationAnalysis: { verdict: "REMEDIATE", recommendedSeverity: "MEDIUM" },
    sourceRules: [RULE_2742],
  }),
  node({
    // Accepted risk that lapsed: the ignore rationale is still on the note log, and the
    // reopen is recorded above it.
    id: "be792ea6-2d2a-4e5a-8e64-10d0af928ced",
    createdAt: "2025-07-23T00:53:27Z",
    dueAt: "2026-01-31T23:00:00Z",
    rejectionExpiredAt: "2026-02-01T00:00:00Z",
    notes: [
      { id: "n1", text: "Status was updated to OPEN on 2026-02-01 as ignore date expired" },
      {
        id: "n2",
        text: "Ignored (By Design) by MANSUY.\nExplanation: Reason: Guardrails Are Currently Ignored\n\nIgnored until: Feb 1, 2026",
      },
    ],
    entitySnapshot: snapshot({
      id: "a7aa796e-420a-591e-8e57-9c38ce958a5e",
      type: "SERVICE_ACCOUNT",
      name: "BIGDATA-LAMBDA-DATALTC-TRANSPORTCUSTOMS-PR",
      cloudPlatform: "AWS",
      region: "",
      nativeType: "role",
      tags: { Program: "dataltc-transportcustoms", Terraform: "true" },
    }),
    sourceRules: [RULE_2742],
  }),
  node({
    // Remediation under way — the status the register used to collect and never count.
    id: "6934f5a0-6541-4eed-a496-76f8e9dc00c8",
    status: "IN_PROGRESS",
    assignee: { id: "u1", name: "A. Analyst", primaryEmail: "a@example.com" },
    entitySnapshot: snapshot({
      id: "74bd2210-ad0a-5fcc-ac84-f25c4b52b658",
      type: "SERVICE_ACCOUNT",
      name: "BIGDATA-AI-AIGEN-WEATHERFORECAST-PP",
      cloudPlatform: "AWS",
      region: "",
      nativeType: "role",
    }),
    sourceRules: [RULE_2742],
  }),
  node({
    // In the AI category, matching none of the four patterns.
    id: "3bc6f796-8d25-4589-a1a2-1e36efeace83",
    type: "CLOUD_CONFIGURATION",
    severity: "LOW",
    entitySnapshot: snapshot({
      id: "cb5fd57f-d2d5-5949-97fd-8768e8c85d45",
      type: "SERVICE_ACCOUNT",
      name: "aigen-weatherforecast-pp",
      cloudPlatform: "AWS",
      region: "",
      nativeType: "role",
    }),
    sourceRules: [RULE_UNMODELLED],
  }),
];

const NOW = "2026-08-13T09:00:00Z";

describe("the Risk Issues capture reaches the register intact", () => {
  const part = normalizeIssuesPage(PAGE);

  it("turns every node into exactly one issue row", () => {
    expect(part.issues).toHaveLength(PAGE.length);
    expect(new Set(part.issues.map((i) => i.id)).size).toBe(PAGE.length);
  });

  it("classifies the three modelled rules and buckets the fourth into Other", () => {
    const byId = Object.fromEntries(part.issues.map((i) => [i.id, i.comboGroup]));
    expect(byId["4a8b7ef5-46c1-47a7-b09f-7928be9fb980"]).toBe("gcp-managed-privileged");
    expect(byId["fc0226fa-7296-49d9-b863-acabf5b5b855"]).toBe("gcp-hosted-privileged");
    expect(byId["e0f2bf67-f2dc-48f6-86c4-c168615d1a1a"]).toBe("bedrock-no-guardrail");
    expect(byId["3bc6f796-8d25-4589-a1a2-1e36efeace83"]).toBe(OTHER_GROUP_ID);
  });

  it("does NOT take an entitySnapshot's Wiz/Domain onto the node", () => {
    // The Gemini CLI snapshot carries `tags: { "Wiz/Domain": "SAP" }` and this is the one
    // tag source deliberately left on the floor. An entitySnapshot is a point-in-time copy
    // taken when the issue FIRED; ISSUES_TOXIC runs after INVENTORY_AI and mergeParts
    // overwrites field-wise on any truthy value, so reading it here would let a stale
    // snapshot replace whatever the inventory and the traversals had just established.
    // The issue's domain comes from its joined asset instead. See the note at the
    // normalizer's `entitySnapshot` branch.
    const agent = part.nodes.find((n) => n.id === "36341fba-70e0-5191-a266-df086d644148");
    expect(agent).toBeDefined();
    expect(agent!.tags).toBeUndefined();
  });

  it("keeps a SERVICE_ACCOUNT entity rather than dropping the row", () => {
    // Half this register's issues hang off IAM roles, not agents. kindFromWizType has to
    // resolve them or normalizeIssuesPage skips the row for having no attachable entity.
    const sa = part.issues.find((i) => i.id === "e0f2bf67-f2dc-48f6-86c4-c168615d1a1a")!;
    expect(sa.assetId).toBe("48906b02-7933-52bb-9826-e8d52563a7fd");
    expect(part.nodes.some((n) => n.kind === "SERVICE_ACCOUNT")).toBe(true);
  });

  it("carries the lifecycle detail the register reports on", () => {
    const ignored = part.issues.find((i) => i.id === "be792ea6-2d2a-4e5a-8e64-10d0af928ced")!;
    expect(ignored.ignoreNote).toContain("Ignored (By Design) by MANSUY.");
    expect(ignored.ignoreExpiredAt).toBe("2026-02-01T00:00:00Z");

    const ticketed = part.issues.find((i) => i.id === "ea0706fd-edd8-4006-b400-b6a336d14bc3")!;
    expect(ticketed.ticketUrls).toHaveLength(1);
    expect(ticketed.aiVerdict).toBe("REMEDIATE");

    const working = part.issues.find((i) => i.id === "6934f5a0-6541-4eed-a496-76f8e9dc00c8")!;
    expect(working.status).toBe("IN_PROGRESS");
    expect(working.assignee).toBe("A. Analyst");

    const inactive = part.issues.find((i) => i.id === "fc0226fa-7296-49d9-b863-acabf5b5b855")!;
    expect(inactive.entityStatus).toBe("Inactive");
    // Worst of LBI/MBI across the issue's projects.
    expect(inactive.businessImpact).toBe("MBI");
  });

  it("survives a merge and a ledger round trip without losing a row or a field", () => {
    const { issues } = mergeParts([part], NOW);
    expect(issues).toHaveLength(PAGE.length);

    const back = issues.map((i) => rowToIssue(issueToRow(i)));
    expect(back.map((i) => i.id)).toEqual(issues.map((i) => i.id));

    // Every field this change added has to make it through ai_issues and back. Compared
    // field-by-field rather than whole-object: rowToIssue normalises `frameworks` to {}
    // for an unclassified row, which predates this change and is not what is under test.
    const fields = [
      "comboGroup", "issueType", "status", "updatedAt", "resolvedAt", "resolutionReason",
      "resolvedBy", "assignee", "environments", "validatedAsExploitable", "businessImpact",
      "entityStatus", "subscriptionId", "ignoreNote", "ignoreExpiredAt", "ticketUrls",
      "aiVerdict", "aiRecommendedSeverity",
    ] as const;
    for (let n = 0; n < issues.length; n++) {
      for (const field of fields) {
        expect([issues[n].id, field, back[n][field]])
          .toEqual([issues[n].id, field, issues[n][field]]);
      }
    }
  });
});

describe("the register total reconciles against the console", () => {
  const issues = normalizeIssuesPage(PAGE).issues;

  it("counts every unresolved row exactly once across the buckets", () => {
    // This is the number an analyst compares against the Wiz console's issue count. The
    // register used to under-report it twice over: IN_PROGRESS rows were collected and
    // never counted, and unmodelled rules were dropped on the floor.
    const total = comboSummary(issues).reduce((n, s) => n + s.count, 0);
    expect(total).toBe(issues.filter(isUnresolvedIssue).length);
    expect(total).toBe(PAGE.length);
  });

  it("the digest says the same number, and shows its working", () => {
    const digest = comboDigest(issues, [], NOW);
    expect(digest.totals.totalOpen).toBe(PAGE.length);
    expect(digest.totals.inProgress).toBe(1);
    expect(digest.totals.unclassified).toBe(1);
    // Four modelled patterns is still four; Other is a bucket, not a pattern.
    expect(digest.totals.patternsTotal).toBe(4);
    expect(digest.groups).toHaveLength(5);
    // Both severity mixes describe the same population, so the shift bars stay honest.
    const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    expect(sum(digest.totals.nativeMix)).toBe(PAGE.length);
    expect(sum(digest.totals.adjustedMix)).toBe(PAGE.length);
  });

  it("leaves the unmodelled issue's severity exactly as Wiz rated it", () => {
    const other = comboSummary(issues).find((s) => s.group.id === OTHER_GROUP_ID)!;
    expect(other.count).toBe(1);
    expect(other.group.amplified).toBe(false);
    // One LOW issue in the bucket: the group reports what it holds, not a declared level.
    expect(other.group.adjustedSeverity).toBe("LOW");
    const row = issues.find((i) => i.comboGroup === OTHER_GROUP_ID)!;
    expect(row.adjustedSeverity).toBe(row.nativeSeverity);
  });
});
