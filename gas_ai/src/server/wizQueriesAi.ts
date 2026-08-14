// The live sync's GraphQL battery. Documents are plain concatenated strings (no
// backticks) for consistency with the client-bundle constraint and easy diffing.
//
// Four API entry points:
//   cloudResourcesV2(first, after, filterBy)       — flat inventory / identities
//   graphSearch(quick, first, after, query)        — relationship traversal
//   issuesV2(first, after, filterBy, orderBy)      — real toxic-combination issues
//   configurationFindings(first, after, filterBy)  — compliance findings
// The cloudResourcesV2/graphSearch selection sets are inferred from ai/queries/*.md;
// the issuesV2 / configurationFindings selections are transcribed from the real tenant
// captures in gas_ai/exemples/ (risk_issues_*, toxic_combos_*, ai_cloud_config_findings_*,
// agentic_idenities_*, get_ai_agents_*). Reconcile the normalizers against those.
// issuesV2 follows risk_issues_* — the tenant-wide "Risk Issues" view; toxic_combos_* is
// the same root captured earlier under a narrower, project-scoped filter.

import { RISK_CATEGORY_ID } from "../domain/toxicCombos";

export const PAGE_SIZE = 100;
export const PAGE_SIZE_FALLBACK = 50;
export const MAX_PAGES = 200;

// Shared CloudResource field selection (flat inventory shape).
// NOTE: `businessImpact` lives under `Project.riskProfile`, not directly on
// Project — a flat `projects { businessImpact }` selection is rejected
// ("Cannot query field businessImpact on type Project"). Select it nested and
// the normalizer flattens it back onto the project record.
// The resource field set, declared once.
//
// It is requested two ways: flat, from the cloudResourcesV2 root, and split inside a
// graphSearch entity, where only the identity fields are on the interface and the rest
// live behind a `... on CloudResource` inline fragment. Those were two hand-maintained
// lists of the same ~20 fields differing only in indentation, so a field added to one and
// forgotten in the other silently degraded half the sync battery.
//
// String concatenation rather than template literals, matching the rest of this file.
const IDENTITY_FIELDS = [
  "id", "name", "type", "nativeType", "cloudPlatform", "region",
];
const CLOUD_RESOURCE_FIELDS = [
  "status",
  "firstSeen",
  "lastSeen",
  "externalId",
  "isAccessibleFromInternet",
  "isOpenToAllInternet",
  "hasSensitiveData",
  "hasAccessToSensitiveData",
  "hasAdminPrivileges",
  "hasHighPrivileges",
  "technology { id name categories { id name } }",
  "cloudAccount { id name externalId cloudProvider }",
  "projects { id name riskProfile { businessImpact } }",
  "tags { key value }",
];

function indented(fields: string[], spaces: number): string {
  const pad = new Array(spaces + 1).join(" ");
  return fields.map((f) => pad + f + "\n").join("");
}

/** Flat, for the cloudResourcesV2 root. */
const RESOURCE_FIELDS =
  indented(IDENTITY_FIELDS, 6) + indented(CLOUD_RESOURCE_FIELDS, 6);

/** Split, for a graphSearch entity (CloudResource is an inline fragment there). */
const ENTITY_FIELDS =
  indented(IDENTITY_FIELDS, 8) +
  "        ... on CloudResource {\n" +
  indented(CLOUD_RESOURCE_FIELDS, 10) +
  "        }\n";

// (Inline filter literals proved fragile against the tenant's gateway — the
// working capture passes the whole filter as a $filterBy variable, so the
// inventory query does the same and its document stays static.)

/**
 * A DATA_FINDING is not a CloudResource, so its severity needs its own inline fragment.
 *
 * Kept OUT of ENTITY_FIELDS deliberately. That constant is shared by every graphSearch
 * step, and a tenant whose schema does not spell the type `DataFinding` would reject the
 * document — taking guardrail coverage, RUNS_AS and identity access down with it. Isolated
 * here, the blast radius is one optional step that records a skip and moves on.
 */
const DATA_ENTITY_FIELDS =
  ENTITY_FIELDS +
  "        ... on DataFinding {\n" +
  "          severity\n" +
  "        }\n";

function graphSearchQueryWith(name: string, queryBody: string, entityFields: string): string {
  return (
    "query " + name + "($quick: Boolean, $first: Int, $after: String) {\n" +
    "  graphSearch(quick: $quick, first: $first, after: $after, query: {\n" +
    queryBody +
    "  }) {\n" +
    "    totalCount\n" +
    "    pageInfo { hasNextPage endCursor }\n" +
    "    nodes {\n" +
    "      entities {\n" +
    entityFields +
    "      }\n" +
    "    }\n" +
    "  }\n" +
    "}\n"
  );
}

function graphSearchQuery(name: string, queryBody: string): string {
  return graphSearchQueryWith(name, queryBody, ENTITY_FIELDS);
}

/**
 * The AI resource-type vocabulary, in the API's enum-style spelling. Verified
 * against a live capture (exemples/get_ai_agents_request.js, 2026-07-08): the
 * Wiz UI displays "AI Agent" but its own API call sends "AI_AGENT" inside a
 * `$filterBy` variable. The other names are derived from the UI's type list by
 * the same convention. Tenants can still differ, so the sync resolves the
 * actual list at runtime (introspection ∩ candidates, or per-value probing),
 * overridable via WIZ_AI_RESOURCE_TYPES.
 */
export const AI_RESOURCE_TYPE_CANDIDATES = [
  "AI_AGENT", "AI_AGENT_REGISTRY", "AI_DATASET", "AI_DEPLOYMENT", "AI_EXTENSION",
  "AI_GATEWAY", "AI_GUARDRAIL", "AI_MODEL", "AI_PIPELINE", "AI_SERVICE",
  "AI_SKILL", "AI_SKILL_TEMPLATE", "AI_TOOL", "MCP_SERVER",
] as const;

/**
 * Enum members that read as AI vocabulary. A TOKEN match, not a substring one, so EMAIL
 * does not count as AI.
 *
 * diagnostics.ts had a character-identical private copy of this, doc comment included,
 * while already importing from this module.
 */
export function aiFlavored(values: string[]): string[] {
  return values.filter((v) => {
    const tokens = v.toUpperCase().split(/[\s_]+/);
    return tokens.includes("AI") || tokens.includes("MCP") ||
      tokens.includes("GENAI") || tokens.includes("LLM");
  });
}

/**
 * Pick the AI resource types to query, from the tenant's actual enum members.
 * Precedence: explicit override → candidates present in the enum → any
 * AI-flavored enum members (tokens AI/MCP/GENAI/LLM — token match, so EMAIL
 * doesn't count as AI) → candidates verbatim when introspection is unavailable.
 * An empty `types` means the tenant has no discoverable AI vocabulary; the
 * caller should surface `aiLooking` (what WAS found) and ask for an override.
 */
export function chooseAiResourceTypes(
  enumValues: string[] | null,
  override: string[] | null,
): { types: string[]; source: "override" | "intersection" | "ai-tokens" | "candidates" | "none"; aiLooking: string[] } {
  if (override && override.length) return { types: override, source: "override", aiLooking: [] };
  if (!enumValues) {
    return { types: [...AI_RESOURCE_TYPE_CANDIDATES], source: "candidates", aiLooking: [] };
  }
  const present = new Set(enumValues);
  const aiLooking = aiFlavored(enumValues);
  const intersection = AI_RESOURCE_TYPE_CANDIDATES.filter((t) => present.has(t));
  if (intersection.length) return { types: intersection, source: "intersection", aiLooking };
  if (aiLooking.length) return { types: aiLooking, source: "ai-tokens", aiLooking };
  return { types: [], source: "none", aiLooking };
}

/**
 * Whether a Wiz error message is the tenant saying "that type value doesn't
 * exist here" — the oracle for per-candidate type probing. Two observed forms:
 * a 400 validation error ("cannot represent value") and an HTTP-200 errors-only
 * response ("failed to parse object type [X]", code INTERNAL). Anything else
 * (auth, transport, field errors) is NOT a value verdict.
 */
export function isInvalidEnumValueError(message: string): boolean {
  if (/failed to parse object type/i.test(message)) return true;
  return /HTTP 400/.test(message) && /cannot represent value/i.test(message);
}

/**
 * Full AI-SPM inventory: the resolved AI asset kinds in one cursor walk.
 * Mirrors the captured working request (exemples/get_ai_agents_request.js):
 * a STATIC document with the filter passed as the $filterBy variable —
 * CloudResourceTypeFilter is an operator input object, and inline literals
 * are what the tenant rejected ("cannot represent value").
 */
export const Q_AI_INVENTORY =
  "query SidekickAiInventory($first: Int, $after: String, $filterBy: CloudResourceV2Filters) {\n" +
  "  cloudResourcesV2(first: $first, after: $after, filterBy: $filterBy) {\n" +
  "    totalCount\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  RESOURCE_FIELDS +
  "    }\n" +
  "  }\n" +
  "}\n";

/** The $filterBy variable for Q_AI_INVENTORY, exactly as the capture sends it. */
export function aiInventoryVariables(types: readonly string[]): { filterBy: unknown } {
  return { filterBy: { type: { equals: [...types] } } };
}

/** Assets carrying an OPEN issue for one toxic-combination source rule ($ruleIds). */
export const Q_RULE_ASSETS =
  "query SidekickAiRuleAssets($first: Int, $after: String, $ruleIds: [String!]) {\n" +
  "  cloudResourcesV2(first: $first, after: $after, filterBy: {\n" +
  "    relatedIssue: { sourceRuleId: { equals: $ruleIds }, status: { equals: [\"OPEN\"] } }\n" +
  "  }) {\n" +
  "    totalCount\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  RESOURCE_FIELDS +
  "    }\n" +
  "  }\n" +
  "}\n";

/** Guardrail-coverage gap: agents with NO PROTECTED_BY edge to any guardrail. */
export const Q_AGENTS_NO_GUARDRAIL = graphSearchQuery(
  "SidekickAiAgentsWithoutGuardrail",
  "    type: \"AI_AGENT\"\n" +
  "    select: true\n" +
  "    relationships: [{\n" +
  "      type: \"PROTECTED_BY\"\n" +
  "      with: { type: \"AI_GUARDRAIL\", select: false }\n" +
  "      negate: true\n" +
  "    }]\n",
);

/** Execution identity: agent → RUNS_AS → service account. */
export const Q_AGENT_RUNS_AS = graphSearchQuery(
  "SidekickAiAgentRunsAs",
  "    type: \"AI_AGENT\"\n" +
  "    select: true\n" +
  "    relationships: [{\n" +
  "      type: \"RUNS_AS\"\n" +
  "      with: { type: \"SERVICE_ACCOUNT\", select: true }\n" +
  "    }]\n",
);

/** CIEM: agent → RUNS_AS → service account → HAS_FINDING → excessive access. */
export const Q_SA_EXCESSIVE_ACCESS = graphSearchQuery(
  "SidekickAiAgentSaExcessiveAccess",
  "    type: \"AI_AGENT\"\n" +
  "    select: true\n" +
  "    relationships: [{\n" +
  "      type: \"RUNS_AS\"\n" +
  "      with: {\n" +
  "        type: \"SERVICE_ACCOUNT\"\n" +
  "        select: true\n" +
  "        relationships: [{\n" +
  "          type: \"HAS_FINDING\"\n" +
  "          with: { type: \"EXCESSIVE_ACCESS_FINDING\", select: true }\n" +
  "        }]\n" +
  "      }\n" +
  "    }]\n",
);

/**
 * The data-exposure attack path, end to end:
 *   AI_AGENT → RUNS_AS → SERVICE_ACCOUNT → ALLOWS_ACCESS_TO → classified store → findings.
 *
 * Wiz's own shape, not ours. The tenant capture in exemples/toxic_combos_response.js
 * echoes control wc-id-3217's query back, whose block named "Sensitive Data Access" ends
 * `-ALLOWS_ACCESS_TO→ DATA_RESOURCE[hasSensitiveData] -HAS_DATA_FINDING→ DATA_FINDING`;
 * ai/queries/6_IAM.MD hand-writes the RUNS_AS form of the same traversal.
 *
 * Until this existed, sensitive data was two booleans on the agent and the data lane was
 * empty on every live tenant — BUCKET and DATABASE were declared kinds that only the
 * dry-run fixture ever instantiated.
 *
 * `HAS_DATA_FINDING` is optional; the other two are not. A store Wiz has classified but on
 * which no finding rule has fired must still draw — requiring the finding would collapse
 * the whole path back to nothing, which is the state this query exists to end. Requiring
 * the first two costs nothing, because without them there is no path to draw.
 *
 * DATABASE_SERVER is in the type list because `kindFromWizType` returns null for kinds the
 * model has never declared and the normalizer then drops the ENTIRE row — losing the agent
 * and the service account, not just the store.
 */
export const Q_AGENT_SENSITIVE_DATA_ACCESS = graphSearchQueryWith(
  "SidekickAiAgentSensitiveDataAccess",
  "    type: \"AI_AGENT\"\n" +
  "    select: true\n" +
  "    relationships: [{\n" +
  "      type: \"RUNS_AS\"\n" +
  "      with: {\n" +
  "        type: \"SERVICE_ACCOUNT\"\n" +
  "        select: true\n" +
  "        relationships: [{\n" +
  "          type: \"ALLOWS_ACCESS_TO\"\n" +
  "          with: {\n" +
  "            type: [\"BUCKET\", \"DATABASE\", \"DATABASE_SERVER\"]\n" +
  "            select: true\n" +
  "            where: { hasSensitiveData: { EQUALS: true } }\n" +
  "            relationships: [{\n" +
  "              type: \"HAS_DATA_FINDING\"\n" +
  "              optional: true\n" +
  "              with: { type: \"DATA_FINDING\", select: true }\n" +
  "            }]\n" +
  "          }\n" +
  "        }]\n" +
  "      }\n" +
  "    }]\n",
  DATA_ENTITY_FIELDS,
);

/** Human/role identities with high-privilege or admin access INTO agents. */
export const Q_IDENTITY_ACCESS = graphSearchQuery(
  "SidekickAiIdentitiesWithAgentAccess",
  "    type: \"AI_AGENT\"\n" +
  "    select: true\n" +
  "    relationships: [{\n" +
  "      type: \"ALLOWS_ACCESS_TO\"\n" +
  "      direction: INBOUND\n" +
  "      with: {\n" +
  "        type: \"ACCESS_ROLE_BINDING\"\n" +
  "        select: false\n" +
  "        relationships: [\n" +
  "          {\n" +
  "            type: \"BOUND_TO\"\n" +
  "            with: { type: [\"USER_ACCOUNT\", \"SERVICE_ACCOUNT\"], select: true }\n" +
  "          }\n" +
  "          {\n" +
  "            type: \"PERMITS_ACCESS_ROLE\"\n" +
  "            with: {\n" +
  "              type: \"ACCESS_ROLE\"\n" +
  "              select: true\n" +
  "              where: { accessType: { EQUALS: [\"HIGH_PRIVILEGE\", \"ADMIN\"] } }\n" +
  "            }\n" +
  "          }\n" +
  "        ]\n" +
  "      }\n" +
  "    }]\n",
);

// ------------------------------------------------------------ issuesV2 (real issues)

// Trimmed from exemples/risk_issues_request.js (the tenant-wide "Risk Issues" capture);
// the older project-scoped exemples/toxic_combos_request.js is the same root with a
// narrower filter. Only the fields the normalizer reads are selected.
// sourceRules carries both inline fragments — the tenant capture returned `Control`
// with id "wc-id-3217" and a resolutionRecommendation, but CloudConfigurationRule is
// the other shape source rules take, so both are selected.
//
// The lifecycle half (resolvedAt / resolutionReason / resolvedBy / notes) is what lets
// the register say anything about remediation rather than only about exposure; the
// capture proves every one of these fields resolves on this tenant.
export const Q_ISSUES =
  "query SidekickAiIssues($first: Int, $after: String, $filterBy: IssueFilters, $orderBy: IssueOrder) {\n" +
  "  issuesV2(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {\n" +
  "    totalCount\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  "      id\n" +
  "      type\n" +
  "      severity\n" +
  "      status\n" +
  "      createdAt\n" +
  "      updatedAt\n" +
  "      dueAt\n" +
  "      resolvedAt\n" +
  "      resolutionReason\n" +
  "      resolutionNote\n" +
  "      rejectionExpiredAt\n" +
  "      validatedAsExploitable\n" +
  "      environments\n" +
  "      assignee { id name primaryEmail }\n" +
  "      resolvedBy { user { id name email } serviceAccount { id name type } }\n" +
  "      notes { id text }\n" +
  "      serviceTickets { id externalId name url }\n" +
  "      applicationServices { id displayName }\n" +
  // The capture gates this behind @include(if: $fetchAiRemediationAnalysis); the
  // convention here is to drop @include and select plainly, which is valid — but this
  // is an AI-analysis join, the same expensive class os_vulns.py deliberately leaves
  // off. ISSUES_TOXIC is an optional step, so a timeout would SKIP THE WHOLE STEP
  // rather than fail loudly: if the step starts landing in the skipped list, this is
  // the first line to delete.
  "      aiRemediationAnalysis { verdict recommendedSeverity }\n" +
  "      projects { id name slug riskProfile { businessImpact } }\n" +
  "      entitySnapshot {\n" +
  "        id\n" +
  "        type\n" +
  "        status\n" +
  "        name\n" +
  "        cloudPlatform\n" +
  "        region\n" +
  "        subscriptionName\n" +
  "        subscriptionId\n" +
  "        subscriptionExternalId\n" +
  "        nativeType\n" +
  "        externalId\n" +
  "        tags\n" +
  "        kubernetesClusterName\n" +
  "        kubernetesNamespaceName\n" +
  "        resourceGroupId\n" +
  "      }\n" +
  "      sourceRules {\n" +
  "        ... on Control {\n" +
  "          id\n" +
  "          name\n" +
  "          description\n" +
  "          severity\n" +
  "          risks\n" +
  "          threats\n" +
  "          resolutionRecommendation\n" +
  "        }\n" +
  "        ... on CloudConfigurationRule {\n" +
  "          id\n" +
  "          name\n" +
  "          description\n" +
  "          risks\n" +
  "          threats\n" +
  "          control { resolutionRecommendation severity }\n" +
  "        }\n" +
  // A threat detection's source rule is a CloudEventRule, and without this fragment the
  // element comes back as an empty object — the issue would still be collected, but with
  // no rule id and no name to show for it. Deliberately minimal: `severity` is aliased in
  // the tenant's own document (ruleSeverity: severity), which is what a field-type
  // conflict against Control.severity looks like, and the normalizer reads the ISSUE's
  // severity anyway. CloudEventRule carries no resolutionRecommendation.
  "        ... on CloudEventRule {\n" +
  "          id\n" +
  "          name\n" +
  "          description\n" +
  "          risks\n" +
  "          threats\n" +
  "        }\n" +
  "      }\n" +
  "    }\n" +
  "  }\n" +
  "}\n";

/**
 * The $filterBy / $orderBy variables for Q_ISSUES: the tenant's AI Security register,
 * transcribed from exemples/risk_issues_request.js (98 issues, 2026-08-13). Optionally
 * scoped to a project (WIZ_PROJECT_ID_V2 via projectScope()). Pure — scope is a
 * parameter so the document stays static and the builder is unit-testable.
 *
 * Two choices worth knowing, because an earlier version of this builder made the other
 * one each time:
 *
 * `frameworkCategory`, not `riskEqualsAny`. wct-id-1998 is a framework-category id
 * ("Wiz for Risk Assessment > AI Security"), and the sibling aiConfigFindingsVariables
 * already passes it that way. Both filters are real and this tenant accepts both — they
 * are different axes that happen to take the same id — but the console's own Risk Issues
 * view uses frameworkCategory, so the register now matches what an analyst sees.
 *
 * NO TYPE FILTER, and that is the point. The category is the scope; the issue type is
 * Wiz's own taxonomy of how an issue was produced, and filtering on it silently narrows
 * the register to the kinds we happened to think of. It did: pinning
 * `["CLOUD_CONFIGURATION","TOXIC_COMBINATION"]` matched 91 of the tenant's 98 AI-category
 * issues, and the 7 it dropped were every threat detection in the category — invisible,
 * because the console's own count is not type-filtered either.
 *
 * A type this register has never seen is still an AI risk. Issues whose source rule is
 * not one of COMBO_GROUPS land in the "other" bucket carrying Wiz's severity untouched
 * (see comboSummary), which is exactly the right home for one. Narrowing is available as
 * an editable step variable for an operator who wants it; it is not the default.
 */
export function aiIssuesVariables(scope: string[] | null): { filterBy: unknown; orderBy: unknown } {
  const filterBy: Record<string, unknown> = {
    status: ["OPEN", "IN_PROGRESS"],
    frameworkCategory: [RISK_CATEGORY_ID],
  };
  if (scope && scope.length) filterBy["project"] = scope;
  return { filterBy, orderBy: { field: "SEVERITY_EXPLOITABLE", direction: "DESC" } };
}

// --------------------------------------------------- configurationFindings (compliance)

// Trimmed from exemples/ai_cloud_config_findings_request.js (the @include directives are
// dropped; totalCount is selected plainly). Feeds AARS pillar B and carries remediation.
export const Q_CONFIG_FINDINGS =
  "query SidekickAiConfigFindings($first: Int, $after: String, $filterBy: ConfigurationFindingFilters, $orderBy: ConfigurationFindingOrder) {\n" +
  "  configurationFindings(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {\n" +
  "    totalCount\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  "      id\n" +
  "      name\n" +
  "      severity\n" +
  "      result\n" +
  "      status\n" +
  "      remediation\n" +
  "      source\n" +
  "      targetExternalId\n" +
  "      subscription { id name externalId cloudProvider }\n" +
  "      resource {\n" +
  "        id\n" +
  "        name\n" +
  "        type\n" +
  "        projects { id name riskProfile { businessImpact } }\n" +
  "      }\n" +
  "      rule {\n" +
  "        id\n" +
  "        shortId\n" +
  "        name\n" +
  "        description\n" +
  "        remediationInstructions\n" +
  "        risks\n" +
  "        threats\n" +
  "        tags { key value }\n" +
  "        opaPolicy\n" +
  "      }\n" +
  "    }\n" +
  "  }\n" +
  "}\n";

/**
 * The $filterBy / $orderBy variables for Q_CONFIG_FINDINGS. OPEN findings under the AI
 * risk framework category (wct-id-1998), optionally project-scoped (the resource filter
 * nests projectId, matching the capture). Pure — scope is a parameter.
 */
export function aiConfigFindingsVariables(
  scope: string[] | null,
): { filterBy: unknown; orderBy: unknown } {
  const filterBy: Record<string, unknown> = {
    status: ["OPEN"],
    frameworkCategory: [RISK_CATEGORY_ID],
  };
  if (scope && scope.length) filterBy["resource"] = { projectId: scope };
  return { filterBy, orderBy: { field: "SEVERITY", direction: "DESC" } };
}

// ------------------------------------------------- agentic identities (principals)

// Trimmed from exemples/agentic_idenities_request.js. Reuses the cloudResourcesV2 root
// (fetchCloudResourcesPage / run:"cloudResources"); the extra field over RESOURCE_FIELDS
// is issueAnalytics (per-identity related-issue severity counts, shown as a badge).
export const Q_PRINCIPALS =
  "query SidekickAiPrincipals($first: Int, $after: String, $filterBy: CloudResourceV2Filters, $orderBy: CloudResourceOrder) {\n" +
  "  cloudResourcesV2(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {\n" +
  "    totalCount\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  "      id\n" +
  "      name\n" +
  "      type\n" +
  "      nativeType\n" +
  "      hasSensitiveData\n" +
  "      hasAccessToSensitiveData\n" +
  "      hasAdminPrivileges\n" +
  "      hasHighPrivileges\n" +
  "      technology { id name categories { id name } }\n" +
  "      cloudAccount { id name externalId cloudProvider }\n" +
  "      projects { id name riskProfile { businessImpact } }\n" +
  "      issueAnalytics {\n" +
  "        issueCount\n" +
  "        informationalSeverityCount\n" +
  "        lowSeverityCount\n" +
  "        mediumSeverityCount\n" +
  "        highSeverityCount\n" +
  "        criticalSeverityCount\n" +
  "      }\n" +
  "    }\n" +
  "  }\n" +
  "}\n";

/**
 * The $filterBy / $orderBy for Q_PRINCIPALS: SERVICE_ACCOUNT / ACCESS_KEY identities
 * whose identityPurpose is AGENTIC (agent execution identities), optionally
 * project-scoped. Pure — scope is a parameter.
 */
export function aiPrincipalsVariables(
  scope: string[] | null,
): { filterBy: unknown; orderBy: unknown } {
  const filterBy: Record<string, unknown> = {
    type: { equals: ["SERVICE_ACCOUNT", "ACCESS_KEY"] },
    identityPurpose: { equals: ["AGENTIC"] },
  };
  if (scope && scope.length) filterBy["projectId"] = scope;
  return { filterBy, orderBy: { field: "RELATED_ISSUE_SEVERITY", direction: "DESC" } };
}
