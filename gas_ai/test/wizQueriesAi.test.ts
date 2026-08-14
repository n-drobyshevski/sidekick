// Tenant-schema tolerance: AI resource-type resolution and query building.
// Ground truth is the captured working request (exemples/get_ai_agents_request.js):
// enum-style values ("AI_AGENT") inside a $filterBy variable with the
// { type: { equals: [...] } } operator shape.

import { describe, expect, it } from "vitest";
import { entityField, kindFromWizType } from "../src/domain/graphTypes";
import {
  AI_RESOURCE_TYPE_CANDIDATES,
  Q_AGENT_RUNS_AS,
  Q_AGENT_EXPANSION,
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
import { errorDigest } from "../src/server/wizClientAi";
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
    ["Q_AGENT_EXPANSION", Q_AGENT_EXPANSION],
  ];

  for (const [name, doc] of DOCS) {
    it(`${name} is unchanged`, () => {
      expect(doc).toMatchSnapshot();
    });
  }

  it("asks a graphSearch entity for the interface fields and the properties bag, only", () => {
    // This used to assert the opposite — that graphSearch asks for every field the flat
    // query does. It cannot. The tenant answers `... on CloudResource` with
    //
    //   Fragment cannot be spread here as objects of type "GraphEntity" can never be of
    //   type "CloudResource"
    //
    // and then "Cannot query field X on type CloudResource" for each field inside it. The
    // resource facts are not reachable as fields on this root at all; they arrive in
    // `properties`. Because ENTITY_FIELDS is shared by all five battery traversals and
    // syncJobs skips an optional step on a 400, that one fragment silently dropped
    // guardrail coverage, RUNS_AS, SA excessive access, sensitive-data access and identity
    // access from every live sync at once.
    for (const [name, doc] of DOCS) {
      if (!doc.includes("graphSearch")) continue;
      const entities = doc.slice(doc.indexOf("entities {"));
      expect(entities, `${name} still spreads a fragment on GraphEntity`)
        .not.toContain("... on");
      expect(entities, `${name} does not ask for properties`).toContain("properties");
      for (const field of ["cloudPlatform", "region", "status", "firstSeen", "externalId",
        "hasSensitiveData", "hasAdminPrivileges", "technology", "cloudAccount", "tags"]) {
        expect(entities, `${name} selects ${field} on GraphEntity`).not.toContain(field);
      }
    }
  });

  it("still asks the FLAT root for every resource field, where they do exist", () => {
    // The split between the two lists marks which root carries what; the flat query is
    // untouched by any of this.
    for (const field of ["nativeType", "cloudPlatform", "region", "status", "firstSeen",
      "lastSeen", "externalId", "isAccessibleFromInternet", "hasSensitiveData",
      "hasAdminPrivileges"]) {
      expect(Q_AI_INVENTORY, `flat inventory dropped ${field}`).toContain(field);
    }
  });

  it("reaches the same facts through entityField, whichever root they came from", () => {
    // The claim the query change rests on: a graphSearch entity's properties bag answers
    // the same questions the flat node does, including the two Wiz spells differently.
    const flat = { cloudPlatform: "GCP", region: "eu", isAccessibleFromInternet: true };
    const entity = {
      properties: {
        cloudPlatform: "GCP", region: "eu", "accessibleFrom.internet": true,
        creationDate: "2026-04-21T14:10:00Z", severity: "SeverityMedium",
      },
    };
    for (const key of ["cloudPlatform", "region", "isAccessibleFromInternet"]) {
      expect(entityField(entity, key)).toEqual(entityField(flat, key));
    }
    expect(entityField(entity, "firstSeen")).toBe("2026-04-21T14:10:00Z");
    expect(entityField(entity, "severity")).toBe("SeverityMedium");
    // A flat value still wins over the bag, and an absent key is undefined either way.
    expect(entityField({ region: "us", properties: { region: "eu" } }, "region")).toBe("us");
    expect(entityField({}, "region")).toBeUndefined();
  });


  it("Q_AGENT_EXPANSION takes its traversal as a variable, not as document text", () => {
    // The one graphSearch document here whose query body is NOT inlined. It is pinned to a
    // single entity, so inlining would give the gateway a textually distinct document per
    // agent and would splice a caller-supplied id into GraphQL source.
    expect(Q_AGENT_EXPANSION).toContain("$query: GraphEntityQueryInput");
    expect(Q_AGENT_EXPANSION).toContain("query: $query");
    expect(Q_AGENT_EXPANSION).not.toContain("_vertexID");
    expect(Q_AGENT_EXPANSION).not.toContain("relationships:");
    // projectId stays nullable: every other graphSearch document omits it and runs
    // tenant-wide, and WIZ_PROJECT_ID_V2 is optional.
    expect(Q_AGENT_EXPANSION).toContain("$projectId: String)");
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

describe("errorDigest", () => {
  it("keeps the messages and drops the scaffolding", () => {
    // The real rejection that started this: three fields, of which the raw body only got
    // three-and-a-bit through in 500 characters because every entry repeats its locations
    // and extensions.
    const raw = JSON.stringify({
      errors: ["nativeType", "cloudPlatform", "region"].map((f, i) => ({
        message: `Cannot query field "${f}" on type "GraphEntity".`,
        locations: [{ line: 15 + i, column: 9 }],
        extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
      })),
    });
    const digest = errorDigest(raw);
    for (const f of ["nativeType", "cloudPlatform", "region"]) {
      expect(digest).toContain(f);
    }
    expect(digest).not.toContain("GRAPHQL_VALIDATION_FAILED");
    expect(digest).not.toContain("locations");
    expect(digest.length).toBeLessThan(raw.length / 2);
  });

  it("leaves the enum-rejection wording intact for isInvalidEnumValueError", () => {
    // That predicate matches on substrings of the thrown message, so condensing the body
    // must not change the words it looks for.
    const raw = JSON.stringify({
      errors: [{ message: 'CloudResourceTypeFilter cannot represent value: ["AI_AGENT"]' }],
    });
    expect(isInvalidEnumValueError(`Wiz query failed (HTTP 400): ${errorDigest(raw)}`)).toBe(true);
  });

  it("falls back to the raw text when the body is not a GraphQL envelope", () => {
    // A proxy's HTML error page has no messages to extract, and then the raw text is the
    // diagnosis rather than noise around it.
    expect(errorDigest("<html>502 Bad Gateway</html>")).toBe("<html>502 Bad Gateway</html>");
    expect(errorDigest("")).toBe("");
    expect(errorDigest('{"data":null}')).toBe('{"data":null}');
  });

  it("bounds the result however long the error list is", () => {
    const many = JSON.stringify({
      errors: Array.from({ length: 200 }, (_, i) => ({ message: `field_${i} is not valid` })),
    });
    expect(errorDigest(many).length).toBeLessThanOrEqual(800);
  });
});
