// Tenant-schema tolerance: AI resource-type resolution and query building.
// Ground truth is the captured working request (exemples/get_ai_agents_request.js):
// enum-style values ("AI_AGENT") inside a $filterBy variable with the
// { type: { equals: [...] } } operator shape.

import { describe, expect, it } from "vitest";
import { kindFromWizType } from "../src/domain/graphTypes";
import {
  AI_RESOURCE_TYPE_CANDIDATES,
  aiInventoryVariables,
  chooseAiResourceTypes,
  isInvalidEnumValueError,
  Q_AI_INVENTORY,
} from "../src/server/wizQueriesAi";

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

  it("no longer selects businessImpact (rejected by real tenants)", () => {
    expect(Q_AI_INVENTORY).not.toContain("businessImpact");
    expect(Q_AI_INVENTORY).toContain("projects { id name }");
  });
});
