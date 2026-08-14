// Tenant-schema tolerance: AI resource-type resolution and query building.
// Ground truth is the captured working request (exemples/get_ai_agents_request.js):
// enum-style values ("AI_AGENT") inside a $filterBy variable with the
// { type: { equals: [...] } } operator shape.

import { describe, expect, it } from "vitest";
import { kindFromWizType } from "../src/domain/graphTypes";
import {
  AI_RESOURCE_TYPE_CANDIDATES,
  Q_AGENT_RUNS_AS,
  Q_AGENT_SENSITIVE_DATA_ACCESS,
  Q_AGENTS_NO_GUARDRAIL,
  Q_IDENTITY_ACCESS,
  Q_SA_EXCESSIVE_ACCESS,
  Q_AI_INVENTORY,
  Q_CONFIG_FINDINGS,
  Q_ISSUES,
  Q_PRINCIPALS,
  Q_RULE_ASSETS,
  aiConfigFindingsVariables,
  aiInventoryVariables,
  aiIssuesVariables,
  aiPrincipalsVariables,
  chooseAiResourceTypes,
  isInvalidEnumValueError,
} from "../src/server/wizQueriesAi";
import { RISK_CATEGORY_ID } from "../src/domain/toxicCombos";
import { isUnresolvedIssue, UNRESOLVED_ISSUE_STATUSES } from "../src/domain/config";

describe("chooseAiResourceTypes", () => {
  it("an explicit override always wins", () => {
    const r = chooseAiResourceTypes(["AI_AGENT", "BUCKET"], ["CUSTOM_AI_THING"]);
    expect(r.types).toEqual(["CUSTOM_AI_THING"]);
    expect(r.source).toBe("override");
  });

  it("intersects candidates with the tenant's members", () => {
    const r = chooseAiResourceTypes(
      ["AI_AGENT", "AI_MODEL", "BUCKET", "VIRTUAL_MACHINE"],
      null,
    );
    expect(r.types).toEqual(["AI_AGENT", "AI_MODEL"]);
    expect(r.source).toBe("intersection");
  });

  it("falls back to AI-flavored members when no candidate matches", () => {
    const r = chooseAiResourceTypes(
      ["AI_APPLICATION", "GENAI_ENDPOINT", "BUCKET", "EMAIL_SERVICE"],
      null,
    );
    expect(r.types).toEqual(["AI_APPLICATION", "GENAI_ENDPOINT"]);
    expect(r.source).toBe("ai-tokens");
  });

  it("token match works across spaces and underscores; EMAIL never counts as AI", () => {
    const r = chooseAiResourceTypes(["Email Service", "MAILBOX", "DOMAIN"], null);
    expect(r.types).toEqual([]);
    expect(r.source).toBe("none");
    expect(r.aiLooking).toEqual([]);
    const r2 = chooseAiResourceTypes(["Custom AI Widget", "BUCKET"], null);
    expect(r2.types).toEqual(["Custom AI Widget"]);
  });

  it("uses the candidates verbatim when introspection is unavailable", () => {
    const r = chooseAiResourceTypes(null, null);
    expect(r.types).toEqual([...AI_RESOURCE_TYPE_CANDIDATES]);
    expect(r.source).toBe("candidates");
  });

  it("candidates use the API's enum-style spelling (per the working capture)", () => {
    expect(AI_RESOURCE_TYPE_CANDIDATES).toContain("AI_AGENT");
    expect(AI_RESOURCE_TYPE_CANDIDATES).toContain("MCP_SERVER");
    expect(AI_RESOURCE_TYPE_CANDIDATES).toContain("AI_SKILL_TEMPLATE");
  });
});

describe("kindFromWizType", () => {
  it("maps tenant display names onto NodeKinds", () => {
    expect(kindFromWizType("AI Agent")).toBe("AI_AGENT");
    expect(kindFromWizType("AI Agent Registry")).toBe("AI_AGENT_REGISTRY");
    expect(kindFromWizType("AI Skill Template")).toBe("AI_SKILL_TEMPLATE");
    expect(kindFromWizType("MCP Server")).toBe("MCP_SERVER");
  });

  it("still accepts enum-style spellings (design docs, sample data)", () => {
    expect(kindFromWizType("AI_AGENT")).toBe("AI_AGENT");
    expect(kindFromWizType("SERVICE_ACCOUNT")).toBe("SERVICE_ACCOUNT");
  });

  it("every candidate display name maps to a NodeKind", () => {
    for (const t of AI_RESOURCE_TYPE_CANDIDATES) {
      expect(kindFromWizType(t)).not.toBeNull();
    }
  });

  it("unknown or empty types map to null", () => {
    expect(kindFromWizType("Quantum Teapot")).toBeNull();
    expect(kindFromWizType("")).toBeNull();
    expect(kindFromWizType(undefined)).toBeNull();
  });
});

describe("isInvalidEnumValueError", () => {
  it("recognizes the 400 coercion rejection", () => {
    expect(isInvalidEnumValueError(
      'Wiz query failed (HTTP 400): {"errors":[{"message":"CloudResourceTypeFilter ' +
      'cannot represent value: [\\"AI_AGENT\\"]"}]}',
    )).toBe(true);
  });

  it("recognizes the errors-only parse rejection (HTTP 200, code INTERNAL)", () => {
    expect(isInvalidEnumValueError(
      'Wiz response carried no data: [{"message":"failed to parse object type ' +
      '[AI Agent]","path":["cloudResourcesV2"],"extensions":{"code":"INTERNAL"}}]',
    )).toBe(true);
  });

  it("does NOT treat auth, transport, or field errors as value verdicts", () => {
    expect(isInvalidEnumValueError("Wiz query failed (HTTP 401): unauthorized")).toBe(false);
    expect(isInvalidEnumValueError("Wiz query failed after retries (HTTP 500).")).toBe(false);
    expect(isInvalidEnumValueError(
      'Wiz query failed (HTTP 400): {"errors":[{"message":"Cannot query field ' +
      '\\"businessImpact\\" on type \\"Project\\""}]}',
    )).toBe(false);
  });
});

describe("Q_AI_INVENTORY + aiInventoryVariables", () => {
  it("the document is static and takes the filter as a variable", () => {
    expect(Q_AI_INVENTORY).toContain("$filterBy: CloudResourceV2Filters");
    expect(Q_AI_INVENTORY).toContain("filterBy: $filterBy");
    expect(Q_AI_INVENTORY).toContain("cloudResourcesV2");
    expect(Q_AI_INVENTORY).not.toContain("equals"); // no inline filter literal
  });

  it("the variable carries the operator shape from the working capture", () => {
    expect(aiInventoryVariables(["AI_AGENT", "AI_MODEL"])).toEqual({
      filterBy: { type: { equals: ["AI_AGENT", "AI_MODEL"] } },
    });
  });

  it("selects businessImpact nested under riskProfile, not flat on Project", () => {
    expect(Q_AI_INVENTORY).toContain("projects { id name riskProfile { businessImpact } }");
    expect(Q_AI_INVENTORY).not.toContain("projects { id name businessImpact }");
  });

  it("now selects isOpenToAllInternet + technology categories (phase 3 enrichment)", () => {
    expect(Q_AI_INVENTORY).toContain("isOpenToAllInternet");
    expect(Q_AI_INVENTORY).toContain("technology { id name categories { id name } }");
  });
});

describe("Q_ISSUES + aiIssuesVariables", () => {
  it("hits issuesV2 as a static document with a filter variable", () => {
    expect(Q_ISSUES).toContain("issuesV2");
    expect(Q_ISSUES).toContain("$filterBy: IssueFilters");
    expect(Q_ISSUES).toContain("filterBy: $filterBy");
    expect(Q_ISSUES).not.toContain("equals"); // no inline filter literal
    expect(Q_ISSUES).not.toContain("//"); // middlebox-safe
    expect(Q_ISSUES).toContain("entitySnapshot");
    expect(Q_ISSUES).toContain("sourceRules");
  });

  it("filters the whole AI risk category, no project scope by default", () => {
    const v = aiIssuesVariables(null) as { filterBy: Record<string, unknown>; orderBy: unknown };
    expect(v.filterBy["status"]).toEqual([...UNRESOLVED_ISSUE_STATUSES]);
    expect(v.filterBy["frameworkCategory"]).toEqual([RISK_CATEGORY_ID]);
    // No type filter at all. The category is the scope; Wiz's issue-type taxonomy is not,
    // and pinning it to the two kinds we had thought of matched 91 of this tenant's 98
    // AI-category issues — the 7 it dropped were every threat detection in the category.
    expect(v.filterBy["type"]).toBeUndefined();
    expect(v.filterBy["riskEqualsAny"]).toBeUndefined();
    expect(v.filterBy["project"]).toBeUndefined();
    expect(v.orderBy).toEqual({ field: "SEVERITY_EXPLOITABLE", direction: "DESC" });
  });

  it("names the AI category the same way the config-findings filter does", () => {
    // wct-id-1998 is a framework-category id. The issues filter used to pass it to
    // riskEqualsAny while its sibling passed it to frameworkCategory; both work against
    // this tenant, but only one of them matches the console's own Risk Issues view.
    const issues = aiIssuesVariables(null) as { filterBy: Record<string, unknown> };
    const findings = aiConfigFindingsVariables(null) as { filterBy: Record<string, unknown> };
    expect(issues.filterBy["frameworkCategory"]).toEqual(findings.filterBy["frameworkCategory"]);
  });

  it("asks for exactly the statuses the register counts", () => {
    // The query and every rollup read one list, so they cannot drift apart again: the
    // filter used to request IN_PROGRESS and seven readers then discarded it.
    const v = aiIssuesVariables(null) as { filterBy: Record<string, unknown> };
    expect(v.filterBy["status"]).toEqual([...UNRESOLVED_ISSUE_STATUSES]);
    expect(isUnresolvedIssue({ status: "IN_PROGRESS" })).toBe(true);
    expect(isUnresolvedIssue({ status: "RESOLVED" })).toBe(false);
  });

  it("selects the lifecycle fields the register needs to talk about remediation", () => {
    for (const field of [
      "resolvedAt", "resolutionReason", "resolvedBy", "notes", "serviceTickets",
      "assignee", "environments", "rejectionExpiredAt", "validatedAsExploitable",
      "aiRemediationAnalysis",
    ]) {
      expect(Q_ISSUES).toContain(field);
    }
    // entitySnapshot.status is what tells the sheet an issue names an Inactive asset.
    expect(Q_ISSUES).toContain("subscriptionId");
  });

  it("names every source-rule shape the unfiltered category can return", () => {
    // With no type filter the register collects threat detections too, and their source
    // rule is a CloudEventRule. Without its inline fragment that element comes back an
    // empty object: the issue is still collected, but with no rule id and no name.
    for (const shape of ["... on Control", "... on CloudConfigurationRule", "... on CloudEventRule"]) {
      expect(Q_ISSUES).toContain(shape);
    }
  });

  it("adds a project filter only when scope is set", () => {
    const v = aiIssuesVariables(["proj-1"]) as { filterBy: Record<string, unknown> };
    expect(v.filterBy["project"]).toEqual(["proj-1"]);
  });
});

describe("Q_CONFIG_FINDINGS + aiConfigFindingsVariables", () => {
  it("hits configurationFindings as a static document with a filter variable", () => {
    expect(Q_CONFIG_FINDINGS).toContain("configurationFindings");
    expect(Q_CONFIG_FINDINGS).toContain("$filterBy: ConfigurationFindingFilters");
    expect(Q_CONFIG_FINDINGS).toContain("filterBy: $filterBy");
    expect(Q_CONFIG_FINDINGS).not.toContain("@include"); // directives dropped
    expect(Q_CONFIG_FINDINGS).not.toContain("//");
    expect(Q_CONFIG_FINDINGS).toContain("remediation");
    expect(Q_CONFIG_FINDINGS).toContain("remediationInstructions");
  });

  it("filters OPEN findings under the AI framework category; project scope nests under resource", () => {
    const v = aiConfigFindingsVariables(null) as { filterBy: Record<string, unknown> };
    expect(v.filterBy["status"]).toEqual(["OPEN"]);
    expect(v.filterBy["frameworkCategory"]).toEqual([RISK_CATEGORY_ID]);
    expect(v.filterBy["resource"]).toBeUndefined();
    const scoped = aiConfigFindingsVariables(["proj-1"]) as { filterBy: Record<string, unknown> };
    expect(scoped.filterBy["resource"]).toEqual({ projectId: ["proj-1"] });
  });
});

describe("Q_PRINCIPALS + aiPrincipalsVariables", () => {
  it("hits cloudResourcesV2 and selects issueAnalytics", () => {
    expect(Q_PRINCIPALS).toContain("cloudResourcesV2");
    expect(Q_PRINCIPALS).toContain("$filterBy: CloudResourceV2Filters");
    expect(Q_PRINCIPALS).toContain("issueAnalytics");
    expect(Q_PRINCIPALS).not.toContain("//");
  });

  it("filters agentic SERVICE_ACCOUNT / ACCESS_KEY identities; project scope is projectId", () => {
    const v = aiPrincipalsVariables(null) as { filterBy: Record<string, unknown> };
    expect(v.filterBy["type"]).toEqual({ equals: ["SERVICE_ACCOUNT", "ACCESS_KEY"] });
    expect(v.filterBy["identityPurpose"]).toEqual({ equals: ["AGENTIC"] });
    expect(v.filterBy["projectId"]).toBeUndefined();
    const scoped = aiPrincipalsVariables(["proj-1"]) as { filterBy: Record<string, unknown> };
    expect(scoped.filterBy["projectId"]).toEqual(["proj-1"]);
  });
});

// ------------------------------------------------------------- query document snapshots
//
// The GraphQL documents are never exercised by a dry-run sync (it never reaches the API),
// so nothing else here would notice if one changed shape. That matters most for the field
// set: it is requested flat from cloudResourcesV2 and split behind a `... on CloudResource`
// fragment in graphSearch, and those used to be two hand-maintained lists of the same ~20
// fields. A field added to one and forgotten in the other silently degrades half the sync
// battery, and no test would have failed.

describe("query documents", () => {
  const DOCS: Array<[string, string]> = [
    ["Q_AI_INVENTORY", Q_AI_INVENTORY],
    ["Q_RULE_ASSETS", Q_RULE_ASSETS],
    ["Q_AGENTS_NO_GUARDRAIL", Q_AGENTS_NO_GUARDRAIL],
    ["Q_ISSUES", Q_ISSUES],
    ["Q_CONFIG_FINDINGS", Q_CONFIG_FINDINGS],
    ["Q_PRINCIPALS", Q_PRINCIPALS],
    ["Q_AGENT_SENSITIVE_DATA_ACCESS", Q_AGENT_SENSITIVE_DATA_ACCESS],
  ];

  for (const [name, doc] of DOCS) {
    it(`${name} is unchanged`, () => {
      expect(doc).toMatchSnapshot();
    });
  }

  it("asks graphSearch for every field the flat query asks for", () => {
    // The invariant the two lists exist to satisfy, asserted rather than trusted.
    const flatFields = Q_AI_INVENTORY.split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.includes("{") && !l.includes("}") && !l.startsWith("query")
        && !l.startsWith("$") && !l.includes("(") && !l.includes(":"));
    const entity = Q_AGENTS_NO_GUARDRAIL;
    for (const f of flatFields) {
      expect(entity, `graphSearch is missing ${f}`).toContain(f);
    }
    expect(flatFields.length).toBeGreaterThan(10);
  });

  it("keeps the DataFinding fragment out of every OTHER graphSearch document", () => {
    // The blast-radius guard. ENTITY_FIELDS is shared by four steps; adding
    // `... on DataFinding` there would make a tenant whose schema does not carry that type
    // reject guardrail coverage, RUNS_AS, SA findings and identity access all at once — four
    // optional steps skipped for the sake of one new one. The fragment lives in a variant
    // used by exactly one document, whose step is itself optional.
    expect(Q_AGENT_SENSITIVE_DATA_ACCESS).toContain("... on DataFinding");
    for (const doc of [Q_AGENTS_NO_GUARDRAIL, Q_AGENT_RUNS_AS, Q_SA_EXCESSIVE_ACCESS,
      Q_IDENTITY_ACCESS]) {
      expect(doc).not.toContain("DataFinding");
    }
  });

  it("asks for the whole chain, with only the finding leg optional", () => {
    // The two outer legs are the path; without them there is nothing to draw. The finding
    // leg is optional because a store Wiz classified but has found nothing specific in must
    // still appear — requiring it collapses the chain back to nothing.
    for (const token of ["RUNS_AS", "SERVICE_ACCOUNT", "ALLOWS_ACCESS_TO", "BUCKET",
      "DATABASE_SERVER", "hasSensitiveData", "HAS_DATA_FINDING"]) {
      expect(Q_AGENT_SENSITIVE_DATA_ACCESS, `chain is missing ${token}`).toContain(token);
    }
    const optionalLegs = Q_AGENT_SENSITIVE_DATA_ACCESS.match(/optional: true/g) ?? [];
    expect(optionalLegs).toHaveLength(1);
  });
});
