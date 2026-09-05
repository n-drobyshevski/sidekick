// Tenant-schema tolerance: AI resource-type resolution and query building.
// Ground truth is the captured working request (exemples/get_ai_agents_request.js):
// enum-style values ("AI_AGENT") inside a $filterBy variable with the
// { type: { equals: [...] } } operator shape.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entityField, kindFromWizType } from "../src/domain/graphTypes";
import {
  AI_RESOURCE_TYPE_CANDIDATES,
  Q_AGENT_RUNS_AS,
  Q_AGENT_EXPANSION,
  Q_AGENT_SENSITIVE_DATA_ACCESS,
  Q_AGENTS_NO_GUARDRAIL,
  Q_AI_EXPOSURE,
  Q_IDENTITY_ACCESS,
  Q_SA_EXCESSIVE_ACCESS,
  Q_AI_INVENTORY,
  Q_COMPLIANCE_POSTURE,
  Q_CONFIG_FINDINGS,
  Q_ISSUES,
  Q_PRINCIPALS,
  Q_SECURITY_FRAMEWORKS,
  Q_VULN_FINDINGS,
  agentRunsAsVariables,
  aiCompliancePostureVariables,
  aiConfigFindingsVariables,
  aiInventoryVariables,
  aiIssuesVariables,
  aiPrincipalsVariables,
  aiPropertiesVariables,
  aiSecurityFrameworksVariables,
  aiVulnFindingsVariables,
  chooseAiResourceTypes,
  isInvalidEnumValueError,
  noGuardrailVariables,
  saExcessiveAccessVariables,
  sensitiveDataAccessVariables,
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
    expect(Q_AI_INVENTORY).toContain("projects { id name isFolder riskProfile { businessImpact } }");
    // The rejection this test exists for: a flat `projects { businessImpact }` is refused
    // ("Cannot query field businessImpact on type Project"). Still asserted, because adding a
    // sibling field is exactly the edit that could quietly flatten it back.
    expect(Q_AI_INVENTORY).not.toContain("projects { id name businessImpact }");
  });

  it("carries isFolder, which is what makes a folder scope mean its subtree", () => {
    // An asset belongs to its whole ancestor chain, so filtering on a FOLDER's id reaches
    // everything beneath it. `isFolder` is what lets the project switcher draw folders and
    // leaves apart the way the Wiz console does. Selected on the shared resource field set,
    // so every document built on it gets it.
    expect(Q_AI_INVENTORY).toContain("isFolder");
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

  it("takes ONE category per call, and defaults to the AI one", () => {
    // The register runs one step per selected category so every row can be stamped with the
    // category that fetched it — nothing in the response says which one matched. The
    // document is untouched: the category is a variable, which is why widening the register
    // needs no new query. See domain/registerScope.ts.
    const widened = aiIssuesVariables(null, ["wct-id-3"]) as {
      filterBy: Record<string, unknown>;
    };
    expect(widened.filterBy["frameworkCategory"]).toEqual(["wct-id-3"]);
    // Absent or empty is the default, which is what every existing caller sends.
    for (const arg of [undefined, []]) {
      const v = aiIssuesVariables(null, arg) as { filterBy: Record<string, unknown> };
      expect(v.filterBy["frameworkCategory"]).toEqual([RISK_CATEGORY_ID]);
    }
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

  it("selects the lifecycle, exception and IaC fields the register stores", () => {
    for (const field of [
      "deleted", "analyzedAt", "firstSeenAt", "ignoreRules",
      "sourceDeployments", "sourceMappedIacFindings", "graphId",
    ]) {
      expect(Q_CONFIG_FINDINGS).toContain(field);
    }
  });

  // resolutionReason is on Wiz's published ConfigurationFinding type but NOT in this
  // tenant's capture. CONFIG_FINDINGS is an optional step that swallows an HTTP 400, so a
  // field the schema rejects would empty ai_findings and look exactly like a tenant with
  // nothing to report. Probe it through the Wiz Scans test run before selecting it.
  it("asks for no field the capture did not prove", () => {
    expect(Q_CONFIG_FINDINGS).not.toContain("resolutionReason");
  });

  it("collects OPEN and RESOLVED under the AI framework category; project scope nests under resource", () => {
    const v = aiConfigFindingsVariables(null) as { filterBy: Record<string, unknown> };
    // RESOLVED is collected, not counted: a configuration finding carries no resolvedAt,
    // so seeing it closed is the only way this app can ever date the closure.
    expect(v.filterBy["status"]).toEqual(["OPEN", "RESOLVED"]);
    // REJECTED stays out of the default — an accepted-risk decision, not a posture fact.
    expect(v.filterBy["status"]).not.toContain("REJECTED");
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

  it("filters agentic identities, and scopes by the field this filter type actually has", () => {
    // THIS TEST USED TO PIN A BUG. It asserted `filterBy.projectId = ["proj-1"]`, transcribed
    // from a console capture taken 2026-08-13. Introspection on 2026-08-21 says
    // CloudResourceV2Filters has no `projectId` at all — it carries one project field,
    // `project: CloudResourceProjectFilters`, and a live console query for cloudResourcesV2
    // sends the nested `idV2.equals` form below.
    //
    // So on any tenant with WIZ_PROJECT_ID_V2 set, this step was sending a field its own
    // filter type does not declare. It is `optional: true`, so the 400 was swallowed as a
    // skip and the step simply produced nothing — which is why a green test sat on top of it
    // for as long as it did. `npm run probe -- --vocab-only` now flags a builder whose field
    // its filter type does not declare.
    const v = aiPrincipalsVariables(null) as { filterBy: Record<string, unknown> };
    expect(v.filterBy["type"]).toEqual({ equals: ["SERVICE_ACCOUNT", "ACCESS_KEY"] });
    expect(v.filterBy["identityPurpose"]).toEqual({ equals: ["AGENTIC"] });
    // Unset scope adds no key at all — a tenant that has not chosen one queries as before.
    expect(v.filterBy["project"]).toBeUndefined();
    expect(v.filterBy["projectId"]).toBeUndefined();

    const scoped = aiPrincipalsVariables(["proj-1"]) as { filterBy: Record<string, unknown> };
    expect(scoped.filterBy["project"]).toEqual({ idV2: { equals: ["proj-1"] } });
    expect(scoped.filterBy["projectId"]).toBeUndefined();
  });
});

describe("the cloudResourcesV2 project scope", () => {
  it("is the same nested shape on every builder that hits that root", () => {
    // One spelling, stated once, because this app has now needed six of them and picking the
    // wrong one is a silent zero rather than an error. wizQueriesAi.ts's own note names the
    // others: filterBy.project (issuesV2, a bare [String!]), filterBy.resource.projectId
    // (configurationFindings), the scalar graphSearch(projectId:) argument, and
    // analyticsSelection.projectId.
    const want = { idV2: { equals: ["p-1"] } };
    const inv = aiInventoryVariables(["AI_AGENT"], ["p-1"]) as { filterBy: Record<string, unknown> };
    const props = aiPropertiesVariables(["AI_AGENT"], ["p-1"]) as { filterBy: Record<string, unknown> };
    const princ = aiPrincipalsVariables(["p-1"]) as { filterBy: Record<string, unknown> };
    expect(inv.filterBy["project"]).toEqual(want);
    expect(props.filterBy["project"]).toEqual(want);
    expect(princ.filterBy["project"]).toEqual(want);
  });

  it("adds nothing when no project is chosen", () => {
    // The rule brick's tests already state: "os_vulns.py hardcodes one tenant's projectIdV2;
    // copying it would silently scope every run to that project." An unset scope must leave
    // the filter exactly as it was, or every tenant inherits one tenant's org chart.
    for (const v of [
      aiInventoryVariables(["AI_AGENT"]),
      aiPropertiesVariables(["AI_AGENT"]),
      aiInventoryVariables(["AI_AGENT"], null),
      aiInventoryVariables(["AI_AGENT"], []),
    ] as Array<{ filterBy: Record<string, unknown> }>) {
      expect(Object.keys(v.filterBy)).toEqual(["type"]);
    }
  });
});

describe("Q_VULN_FINDINGS + aiVulnFindingsVariables", () => {
  it("hits vulnerabilityFindings as a static document with a filter variable", () => {
    expect(Q_VULN_FINDINGS).toContain("vulnerabilityFindings");
    expect(Q_VULN_FINDINGS).toContain("$filterBy: VulnerabilityFindingFilters");
    expect(Q_VULN_FINDINGS).toContain("filterBy: $filterBy");
    expect(Q_VULN_FINDINGS).not.toContain("@include");
    expect(Q_VULN_FINDINGS).not.toContain("//");
  });

  it("selects the three exploitation signals and the two clock fields", () => {
    for (const field of [
      "hasExploit", "hasCisaKevExploit", "epssProbability", "epssPercentile", "epssSeverity",
      "firstDetectedAt", "resolvedAt", "severity", "status",
    ]) {
      expect(Q_VULN_FINDINGS, field).toContain(field);
    }
  });

  it("fragments the vulnerableAsset union rather than selecting through it", () => {
    // `vulnerableAsset { id }` IS REJECTED — a union of 16 types with no shared interface
    // (AARS_LIVE_MEASUREMENTS.md §6.8). The member list is copied from the sibling's
    // console-captured document, which has run against this tenant since it shipped; a name
    // this gateway does not have fails the WHOLE document, not the one fragment.
    expect(Q_VULN_FINDINGS).toContain("vulnerableAsset {");
    expect(Q_VULN_FINDINGS).toContain("... on VulnerableAssetVirtualMachine { id type name }");
    expect(Q_VULN_FINDINGS).toContain("... on VulnerableAssetContainerImage { id type name }");
    // The one member that carries no id at all: `__typename`, never `id`, because asking for
    // a field the member does not have is the same 400 as naming a member that does not exist.
    expect(Q_VULN_FINDINGS).toContain("... on VulnerableAssetNetworkAddress { __typename }");
    expect(Q_VULN_FINDINGS).not.toContain("... on VulnerableAssetNetworkAddress { id");
  });

  it("names the related-issue selection as an ASSUMPTION, pinned by phase0 stage k", () => {
    // The join field's shape is unverified: it could be a single object, a bare list, or a
    // connection. The document picks one and the comment says so — this asserts the ADMISSION
    // is there, because the day it stops being labelled is the day someone reads the guess as
    // a measurement. `relatedIssueIdsOf` reads all three shapes, so only this line moves when
    // stage K answers.
    const src = readFileSync(
      new URL("../src/server/wizQueriesAi.ts", import.meta.url), "utf8",
    );
    expect(src).toContain("UNVERIFIED — pinned by `phase0.mjs --stage=k`");
    expect(Q_VULN_FINDINGS).toContain("relatedIssues { id }");
  });

  it("sends the NARROW filter — never the 5.17M", () => {
    // §6.4: `vulnerabilityFindings` in project scope holds 5,173,698 open rows. Filtered to
    // `hasRelatedIssue` AND a related issue in the selected categories it holds 7,368. The
    // three keys below are the entire difference, and dropping any one of them changes the
    // step from ~15 pages to a population nothing here can store.
    const v = aiVulnFindingsVariables(null) as { filterBy: Record<string, unknown> };
    expect(v.filterBy["status"]).toEqual(["OPEN"]);
    expect(v.filterBy["hasRelatedIssue"]).toBe(true);
    expect(v.filterBy["relatedIssueFrameworkCategory"])
      .toEqual({ equalsAny: [RISK_CATEGORY_ID] });
    expect(Object.keys(v.filterBy).sort())
      .toEqual(["hasRelatedIssue", "relatedIssueFrameworkCategory", "status"]);
  });

  it("carries the widened category list, the same one the issue steps use", () => {
    const cats = [RISK_CATEGORY_ID, "wct-id-3", "861eb856-54f6-4d1b-8ca1-1d6130841d20"];
    const v = aiVulnFindingsVariables(null, cats) as { filterBy: Record<string, unknown> };
    // ALL SIX IN ONE STEP, unlike the issue register's one step per category. An issue carries
    // no category so its rows must be stamped by the step that fetched them; a finding is not
    // stored under a category at all — it is folded onto the issue, which already carries the
    // stamp. Splitting this would fetch the same finding once per category of its issue.
    expect(v.filterBy["relatedIssueFrameworkCategory"]).toEqual({ equalsAny: cats });
    // A copy, not the caller's array: a step's variables are held for the life of a battery.
    expect((v.filterBy["relatedIssueFrameworkCategory"] as { equalsAny: string[] }).equalsAny)
      .not.toBe(cats);
    // An empty list is the DEFAULT, never "every category" — an absent category filter here
    // is the 5.17M with extra steps.
    const empty = aiVulnFindingsVariables(null, []) as { filterBy: Record<string, unknown> };
    expect(empty.filterBy["relatedIssueFrameworkCategory"]).toEqual({ equalsAny: [RISK_CATEGORY_ID] });
  });

  it("uses `equalsAny`, not `equals` — RelatedIssueFrameworkCategoryFilter's own spelling", () => {
    // §6.8, learned from real calls. `equals` is a validation error, which on an optional step
    // is an empty axis that looks exactly like a tenant with no exploitation evidence.
    const v = aiVulnFindingsVariables(["proj-1"], ["wct-id-3"]) as
      { filterBy: Record<string, unknown> };
    const cat = v.filterBy["relatedIssueFrameworkCategory"] as Record<string, unknown>;
    expect(Object.keys(cat)).toEqual(["equalsAny"]);
  });

  it("scopes the project as `projectIdV2: {equals:[...]}` — the SIXTH spelling", () => {
    // The five this app already sends are tabulated in probe.mjs; §6.8 established that this
    // root accepts none of them. A wrong spelling here is a validation error, and on an
    // optional step that is an empty register rather than a failure.
    const scoped = aiVulnFindingsVariables(["proj-value-chain"]) as
      { filterBy: Record<string, unknown> };
    expect(scoped.filterBy["projectIdV2"]).toEqual({ equals: ["proj-value-chain"] });
    expect(scoped.filterBy["project"]).toBeUndefined();
    expect(scoped.filterBy["projectId"]).toBeUndefined();
    // No project chosen means no project key at all — never an empty list, which some roots
    // read as "match nothing".
    const unscoped = aiVulnFindingsVariables(null) as { filterBy: Record<string, unknown> };
    expect("projectIdV2" in unscoped.filterBy).toBe(false);
    expect("projectIdV2" in (aiVulnFindingsVariables([]) as
      { filterBy: Record<string, unknown> }).filterBy).toBe(false);
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
    ["Q_AGENTS_NO_GUARDRAIL", Q_AGENTS_NO_GUARDRAIL],
    ["Q_ISSUES", Q_ISSUES],
    ["Q_CONFIG_FINDINGS", Q_CONFIG_FINDINGS],
    ["Q_VULN_FINDINGS", Q_VULN_FINDINGS],
    ["Q_PRINCIPALS", Q_PRINCIPALS],
    ["Q_AGENT_SENSITIVE_DATA_ACCESS", Q_AGENT_SENSITIVE_DATA_ACCESS],
    ["Q_AGENT_EXPANSION", Q_AGENT_EXPANSION],
    ["Q_AI_EXPOSURE", Q_AI_EXPOSURE],
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
      // Q_AI_EXPOSURE deliberately does NOT share ENTITY_FIELDS, which is the whole reason
      // it is allowed a selection set this wide — see the next test.
      if (name === "Q_AI_EXPOSURE") continue;
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

  it("keeps the exposure document's wide selection out of the shared field set", () => {
    // The exemption above is only safe while it stays an exemption. Q_AI_EXPOSURE is the
    // console's operation verbatim — named fragments, @include gates, publicExposures — and
    // the argument for sending something that large is that ONE tenant rejection skips two
    // optional steps rather than taking the other five graphSearch traversals with it. That
    // argument holds exactly as long as the field sets stay separate.
    const shared = Q_AGENTS_NO_GUARDRAIL.slice(Q_AGENTS_NO_GUARDRAIL.indexOf("entities {"));
    for (const wide of ["publicExposures", "lateralMovementPaths", "codeSourcePath",
      "typedProperties", "technologies", "userMetadata"]) {
      expect(shared, `the shared entity field set gained ${wide}`).not.toContain(wide);
    }
    // Its one fragment spread is on GEAiAgent, which IS among GraphEntity's possible types —
    // the capture returns `"__typename": "GEAiAgent"`. CloudResource, the spread that broke
    // every battery traversal at once, is nowhere in it.
    expect(Q_AI_EXPOSURE).toContain("... on GEAiAgent");
    expect(Q_AI_EXPOSURE).not.toContain("... on CloudResource");
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

  it("reaches the store through the binding, which is the hop that makes it return", () => {
    // The path legs are required; without them there is nothing to draw. The finding leg is
    // optional because a store Wiz classified but has found nothing specific in must still
    // appear — requiring it collapses the chain back to nothing.
    //
    // THE IAM_BINDING IS WHY THIS TEST CHANGED. Without it the traversal asked
    // `SERVICE_ACCOUNT -ALLOWS_ACCESS_TO-> store`, which on this tenant matches nothing:
    // ALLOWS_ACCESS_TO is anchored at the BINDING. Three live probes, one variable each:
    // 0 rows through the service account, 160 through the binding, 147 with hasSensitiveData
    // still applied. The old shape was not narrow, it was unmatchable — and it said so by
    // returning zero rows and no error for the life of the app.
    //
    // The binding is `select: false`, so it consumes no slot and the edge the normalizer
    // writes stays identity → store. Asserted on the rendered $query rather than the document,
    // because the traversal no longer lives in the document.
    expect(sensitiveDataAccessVariables(["AI_AGENT"], null)["query"]).toEqual({
      type: ["AI_AGENT"],
      select: true,
      relationships: [{
        type: [{ type: "ACTING_AS" }],
        with: {
          // The supertype, answered with the concrete subtype — same as the CIEM traversal.
          type: ["PRINCIPAL"],
          select: true,
          relationships: [{
            // ENTITLES reversed: standing at the principal, not at the binding.
            type: [{ type: "ENTITLES", reverse: true }],
            with: {
              type: ["IAM_BINDING"],
              relationships: [{
                type: [{ type: "ALLOWS_ACCESS_TO" }],
                with: {
                  type: ["BUCKET", "DATABASE"],
                  select: true,
                  where: { hasSensitiveData: { EQUALS: true } },
                  relationships: [{
                    type: [{ type: "HAS_DATA_FINDING" }],
                    with: { type: ["DATA_FINDING"], select: true },
                    optional: true,
                  }],
                },
              }],
            },
          }],
        },
      }],
    });
  });

  it("walks the console's proven high-privilege path", () => {
    // Transcribed from a Wiz console export run against the live tenant, which returned twelve
    // rows — each an AI_AGENT, a SERVICE_ACCOUNT and an IAM_BINDING. Nothing else has ever
    // proved this traversal works, so this assertion is the record of what did.
    expect(saExcessiveAccessVariables(["AI_AGENT"], null)["query"]).toEqual({
      type: ["AI_AGENT"],
      select: true,
      relationships: [{
        type: [{ type: "ACTING_AS" }],
        with: {
          type: ["PRINCIPAL"],
          select: true,
          // The privilege test is a PROPERTY on the principal, not a hop to a finding — the
          // direct route to the EXCESSIVE_PRIVILEGE risk condition.
          where: { hasHighPrivileges: { EQUALS: true } },
          relationships: [
            {
              // ENTITLES REVERSED: this stands at the principal. identityAccessSpec stands at
              // the binding and sends the same relationship with no flag.
              type: [{ type: "ENTITLES", reverse: true }],
              with: {
                type: ["IAM_BINDING"],
                select: true,
                where: { accessTypes: { EQUALS: ["Admin", "HighPrivilege"] } },
                relationships: [{
                  type: [{ type: "ALLOWS" }],
                  with: {
                    type: ["ACCESS_ROLE_PERMISSION"],
                    select: true,
                    where: { accessTypes: { EQUALS: ["Admin", "HighPrivilege"] } },
                  },
                  optional: true,
                }],
              },
              optional: true,
            },
            {
              type: [{ type: "CONTAINS" }],
              with: { type: ["EXCESSIVE_ACCESS_FINDING"], select: true },
              optional: true,
            },
          ],
        },
      }],
    });
  });

  it("asks the supertype the tenant answers with a subtype", () => {
    // The export asks for PRINCIPAL and all twelve rows came back SERVICE_ACCOUNT, so
    // normalizeRunsAsPage's find(kind === "SERVICE_ACCOUNT") still matches — and asking for the
    // supertype also reaches a user-backed identity this spec could never see before.
    const q = saExcessiveAccessVariables(["AI_AGENT"], null)["query"] as Record<string, unknown>;
    const principal = (q["relationships"] as Array<Record<string, unknown>>)[0]["with"] as
      Record<string, unknown>;
    expect(principal["type"]).toEqual(["PRINCIPAL"]);
  });

  it("keeps every leg below the principal optional", () => {
    // A high-privileged identity is worth reporting whether or not the binding that granted it,
    // or a finding about it, lands in the same row — which is exactly how the console builds it.
    const rendered = JSON.stringify(saExcessiveAccessVariables(["AI_AGENT"], null)["query"]);
    expect(rendered.match(/"optional":true/g) ?? []).toHaveLength(3);
  });

  it("the guardrail traversal negates an unselected leg", () => {
    // `select: false` renders as an ABSENT key, not `select: false` — the console does the
    // same (43 `"select": true` across a 45-node capture whose two unselected nodes carry no
    // key at all), and the tenant answered that request.
    //
    // `negate` is the one construct here with no capture behind it. If this step keeps failing
    // after the shape fix while the other three pass, `negate` is the first thing to suspect.
    expect(noGuardrailVariables(["AI_AGENT"], null)["query"]).toEqual({
      type: ["AI_AGENT"],
      select: true,
      relationships: [{
        type: [{ type: "PROTECTS", reverse: true }],
        with: { type: ["AI_GUARDRAIL"] },
        negate: true,
      }],
    });
  });

  it("sends the scope it is handed, and truncates a multi-project one to the first", () => {
    // THIS TEST WAS CALLED "runs the agent-rooted traversals tenant-wide, as they always have"
    // and it kept passing after they stopped doing that — because it calls the BUILDERS with
    // an explicit `null` and never looks at what the battery hands them. A green test whose
    // name asserts the opposite of the shipped behaviour is worse than no test, so it now
    // claims only what it actually pins: the builder honours its argument. The wiring is
    // asserted in test/syncScope.test.ts, against the battery.
    const AI = ["AI_AGENT", "AI_MODEL"];
    for (const vars of [
      noGuardrailVariables(AI, null), agentRunsAsVariables(AI, null),
      saExcessiveAccessVariables(AI, null), sensitiveDataAccessVariables(AI, null),
    ]) {
      expect(vars["projectId"]).toBeNull();
    }
    for (const vars of [
      noGuardrailVariables(AI, ["p-1"]), agentRunsAsVariables(AI, ["p-1"]),
      saExcessiveAccessVariables(AI, ["p-1"]), sensitiveDataAccessVariables(AI, ["p-1"]),
    ]) {
      expect(vars["projectId"]).toBe("p-1");
    }
    // The graphSearch argument is a scalar `String`, not a list — so a multi-project scope
    // loses everything after the first, silently. Pinned so that stays a known cost.
    expect(sensitiveDataAccessVariables(AI, ["p-1", "p-2"])["projectId"]).toBe("p-1");
  });

  it("no graphSearch document carries a quoted enum value any more", () => {
    // THE regression guard for the defect this phase existed to fix. A live tenant refused
    // four traversals with `GraphEntityType cannot represent value: "AI_AGENT"` — the same
    // name it accepted seconds later inside a variable-borne root. Every traversal now travels
    // as `$query`, and a document that spells a type or a relationship inline has reintroduced
    // the bug.
    const GRAPH_DOCS: Array<[string, string]> = [
      ["Q_AGENTS_NO_GUARDRAIL", Q_AGENTS_NO_GUARDRAIL],
      ["Q_AGENT_RUNS_AS", Q_AGENT_RUNS_AS],
      ["Q_SA_EXCESSIVE_ACCESS", Q_SA_EXCESSIVE_ACCESS],
      ["Q_AGENT_SENSITIVE_DATA_ACCESS", Q_AGENT_SENSITIVE_DATA_ACCESS],
      ["Q_IDENTITY_ACCESS", Q_IDENTITY_ACCESS],
    ];
    for (const [name, doc] of GRAPH_DOCS) {
      expect(doc, `${name} must take its traversal as a variable`)
        .toContain("$query: GraphEntityQueryInput");
      expect(doc, `${name} must pass that variable through`).toContain("query: $query");
      expect(doc, `${name} still spells a traversal inline`).not.toContain("relationships:");
      expect(doc, `${name} still names an entity type inline`).not.toMatch(/type: "[A-Z_]+"/);
    }
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

describe("Q_SECURITY_FRAMEWORKS + Q_COMPLIANCE_POSTURE", () => {
  it("the catalogue is an ordinary connection, so it needs no new transport", () => {
    expect(Q_SECURITY_FRAMEWORKS).toContain("securityFrameworks");
    expect(Q_SECURITY_FRAMEWORKS).toContain("$first: Int");
    expect(Q_SECURITY_FRAMEWORKS).toContain("$after: String");
    expect(Q_SECURITY_FRAMEWORKS).toContain("pageInfo { hasNextPage endCursor }");
    expect(Q_SECURITY_FRAMEWORKS).toContain("nodes");
    expect(Q_SECURITY_FRAMEWORKS).not.toContain("//");
  });

  it("posture takes an id and is NOT a connection — the reason fetchSingleObject exists", () => {
    expect(Q_COMPLIANCE_POSTURE).toContain("securityFramework(id: $id)");
    expect(Q_COMPLIANCE_POSTURE).toContain("$id: ID!");
    // No paging variables at all: this root declares none, and fetchPage injects both.
    expect(Q_COMPLIANCE_POSTURE).not.toContain("$first");
    expect(Q_COMPLIANCE_POSTURE).not.toContain("$after");
    expect(Q_COMPLIANCE_POSTURE).not.toContain("pageInfo");
  });

  it("drops the console's directives — the contract Q_CONFIG_FINDINGS already set", () => {
    // The capture sent $fetchControlQuery: Boolean! with @include/@skip. This app always
    // wants scopeQuery, so the variable and both directives go, exactly as they did for
    // the config-findings document.
    expect(Q_COMPLIANCE_POSTURE).not.toContain("@include");
    expect(Q_COMPLIANCE_POSTURE).not.toContain("@skip");
    expect(Q_COMPLIANCE_POSTURE).not.toContain("fetchControlQuery");
    expect(Q_COMPLIANCE_POSTURE).toContain("scopeQuery");
    expect(Q_COMPLIANCE_POSTURE).not.toContain("//");
  });

  it("selects the emptiness fields at every level, not just the percentages", () => {
    // Three occurrences: framework, category, subcategory. Without all three a null
    // posture is indistinguishable from a zero somewhere in the tree.
    const reasons = Q_COMPLIANCE_POSTURE.match(/emptyPostureReason/g) || [];
    expect(reasons.length).toBe(3);
    expect(Q_COMPLIANCE_POSTURE).toContain("noResourceToAsses");
  });

  it("selects all three mutually exclusive policy shapes", () => {
    expect(Q_COMPLIANCE_POSTURE).toContain("control {");
    expect(Q_COMPLIANCE_POSTURE).toContain("cloudConfigurationRule {");
    expect(Q_COMPLIANCE_POSTURE).toContain("hostConfigurationRule {");
  });

  it("asks for no field the capture did not prove", () => {
    // Wiz's published SecurityFramework type carries more than the console operation
    // selected. A posture step is optional and swallows an HTTP 400, so a field the
    // schema rejects would empty the tabs and look exactly like a tenant with no
    // frameworks — the same trap resolutionReason set for the config findings.
    for (const field of [
      "weightedScore", "scoreUpdatedAt", "policyTypes {",
      "noPoliciesSubCategoryCount", "disabledSubCategoryCount",
    ]) {
      expect(Q_COMPLIANCE_POSTURE).not.toContain(field);
    }
  });

  it("scopes posture by project under analyticsSelection — a fifth spelling", () => {
    const bare = aiCompliancePostureVariables(null) as { analyticsSelection: Record<string, unknown> };
    expect(bare.analyticsSelection).toEqual({});
    const scoped = aiCompliancePostureVariables(["proj-1"]) as {
      analyticsSelection: Record<string, unknown>;
    };
    expect(scoped.analyticsSelection["projectId"]).toEqual(["proj-1"]);
  });

  it("never builds the framework id — that is the step's, and Settings', not a filter", () => {
    const v = aiCompliancePostureVariables(["proj-1"]) as Record<string, unknown>;
    expect(v["id"]).toBeUndefined();
  });

  it("asks the catalogue for the frameworks the tenant switched on", () => {
    const v = aiSecurityFrameworksVariables() as { filterBy: Record<string, unknown> };
    expect(v.filterBy["enabled"]).toBe(true);
  });
});
