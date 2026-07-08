// Tenant-schema tolerance: AI resource-type resolution and query building.
// Real tenants rejected the hardcoded type list (GRAPHQL_VALIDATION_FAILED:
// "CloudResourceTypeFilter cannot represent value") — the sync now resolves
// its vocabulary against the tenant's actual enum members.

import { describe, expect, it } from "vitest";
import { kindFromWizType } from "../src/domain/graphTypes";
import {
  AI_RESOURCE_TYPE_CANDIDATES,
  chooseAiResourceTypes,
  isInvalidEnumValueError,
  qAiInventory,
} from "../src/server/wizQueriesAi";

describe("chooseAiResourceTypes", () => {
  it("an explicit override always wins", () => {
    const r = chooseAiResourceTypes(["AI Agent", "BUCKET"], ["CUSTOM_AI_THING"]);
    expect(r.types).toEqual(["CUSTOM_AI_THING"]);
    expect(r.source).toBe("override");
  });

  it("intersects candidates with the tenant's members", () => {
    const r = chooseAiResourceTypes(
      ["AI Agent", "AI Model", "BUCKET", "VIRTUAL_MACHINE"],
      null,
    );
    expect(r.types).toEqual(["AI Agent", "AI Model"]);
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

  it("candidates are the tenant display names", () => {
    expect(AI_RESOURCE_TYPE_CANDIDATES).toContain("AI Agent");
    expect(AI_RESOURCE_TYPE_CANDIDATES).toContain("MCP Server");
    expect(AI_RESOURCE_TYPE_CANDIDATES).toContain("AI Skill Template");
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
  it("recognizes the tenant's enum-value rejection", () => {
    expect(isInvalidEnumValueError(
      'Wiz query failed (HTTP 400): {"errors":[{"message":"CloudResourceTypeFilter ' +
      'cannot represent value: [\\"AI_AGENT\\"]"}]}',
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

describe("qAiInventory", () => {
  it("uses the operator input-object shape the tenant accepts", () => {
    const q = qAiInventory(["AI Agent", "AI Model"]);
    expect(q).toContain('type: { equals: ["AI Agent", "AI Model"] }');
    expect(q).toContain("cloudResourcesV2");
    expect(q).toContain("query SidekickAiInventory");
  });

  it("no longer selects businessImpact (rejected by real tenants)", () => {
    expect(qAiInventory(["AI Agent"])).not.toContain("businessImpact");
    expect(qAiInventory(["AI Agent"])).toContain("projects { id name }");
  });
});
