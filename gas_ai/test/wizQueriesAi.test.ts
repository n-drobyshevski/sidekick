// Tenant-schema tolerance: AI resource-type resolution and query building.
// Real tenants rejected the hardcoded type list (GRAPHQL_VALIDATION_FAILED:
// "CloudResourceTypeFilter cannot represent value") — the sync now resolves
// its vocabulary against the tenant's actual enum members.

import { describe, expect, it } from "vitest";
import {
  AI_RESOURCE_TYPE_CANDIDATES,
  chooseAiResourceTypes,
  isInvalidEnumValueError,
  qAiInventory,
} from "../src/server/wizQueriesAi";

describe("chooseAiResourceTypes", () => {
  it("an explicit override always wins", () => {
    const r = chooseAiResourceTypes(["AI_AGENT", "BUCKET"], ["CUSTOM_AI_THING"]);
    expect(r.types).toEqual(["CUSTOM_AI_THING"]);
    expect(r.source).toBe("override");
  });

  it("intersects candidates with the tenant's enum members", () => {
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

  it("token match: EMAIL/MAILBOX never count as AI", () => {
    const r = chooseAiResourceTypes(["EMAIL_SERVICE", "MAILBOX", "DOMAIN"], null);
    expect(r.types).toEqual([]);
    expect(r.source).toBe("none");
    expect(r.aiLooking).toEqual([]);
  });

  it("uses the candidates verbatim when introspection is unavailable", () => {
    const r = chooseAiResourceTypes(null, null);
    expect(r.types).toEqual([...AI_RESOURCE_TYPE_CANDIDATES]);
    expect(r.source).toBe("candidates");
  });

  it("reports the AI-flavored vocabulary alongside the choice", () => {
    const r = chooseAiResourceTypes(["AI_AGENT", "MCP_SERVER", "LLM_ENDPOINT"], null);
    expect(r.types).toEqual(["AI_AGENT", "MCP_SERVER"]);
    expect(r.aiLooking).toEqual(["AI_AGENT", "MCP_SERVER", "LLM_ENDPOINT"]);
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
  it("embeds the resolved types as a quoted enum-value list", () => {
    const q = qAiInventory(["AI_AGENT", "AI_MODEL"]);
    expect(q).toContain('type: ["AI_AGENT", "AI_MODEL"]');
    expect(q).toContain("cloudResourcesV2");
    expect(q).toContain("query SidekickAiInventory");
  });

  it("no longer selects businessImpact (rejected by real tenants)", () => {
    expect(qAiInventory(["AI_AGENT"])).not.toContain("businessImpact");
    expect(qAiInventory(["AI_AGENT"])).toContain("projects { id name }");
  });
});
