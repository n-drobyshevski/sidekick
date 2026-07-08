// Tenant-schema tolerance: AI resource-type resolution and query building.
// Ground truth is the captured working request (exemples/get_ai_agents_request.js):
// enum-style values ("AI_AGENT") inside a $filterBy variable with the
// { type: { equals: [...] } } operator shape.

import { describe, expect, it } from "vitest";
import { kindFromWizType } from "../src/domain/graphTypes";
import {
  AI_RESOURCE_TYPE_CANDIDATES,
  aiConfigFindingsVariables,
  aiInventoryVariables,
  aiIssuesVariables,
  aiPrincipalsVariables,
  chooseAiResourceTypes,
  isInvalidEnumValueError,
  Q_AI_INVENTORY,
  Q_CONFIG_FINDINGS,
  Q_ISSUES,
  Q_PRINCIPALS,
} from "../src/server/wizQueriesAi";
import { RISK_CATEGORY_ID } from "../src/domain/toxicCombos";

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

  it("filters toxic combinations under the AI risk category, no project scope by default", () => {
    const v = aiIssuesVariables(null) as { filterBy: Record<string, unknown>; orderBy: unknown };
    expect(v.filterBy["status"]).toEqual(["OPEN", "IN_PROGRESS"]);
    expect(v.filterBy["riskEqualsAny"]).toEqual([RISK_CATEGORY_ID]);
    expect(v.filterBy["type"]).toEqual(["TOXIC_COMBINATION"]);
    expect(v.filterBy["project"]).toBeUndefined();
    expect(v.orderBy).toEqual({ field: "SEVERITY_EXPLOITABLE", direction: "DESC" });
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
