// The live sync's GraphQL battery, transcribed from ai/queries/4_guardrail_coverage.md,
// 4_human_identity.md and 6_IAM.MD. Documents are plain concatenated strings (no
// backticks) for consistency with the client-bundle constraint and easy diffing.
//
// Two API entry points:
//   cloudResourcesV2(first, after, filterBy)  — flat inventory
//   graphSearch(quick, first, after, query)   — relationship traversal
// Response shapes are inferred from these selection sets; the empty
// ai/queries/reponse_schemas/ stubs should be filled from real captures during
// live validation, and the normalizers reconciled against them.

export const PAGE_SIZE = 100;
export const PAGE_SIZE_FALLBACK = 50;
export const MAX_PAGES = 200;

// Shared CloudResource field selection (flat inventory shape).
const RESOURCE_FIELDS =
  "      id\n" +
  "      name\n" +
  "      type\n" +
  "      nativeType\n" +
  "      cloudPlatform\n" +
  "      region\n" +
  "      status\n" +
  "      firstSeen\n" +
  "      lastSeen\n" +
  "      externalId\n" +
  "      isAccessibleFromInternet\n" +
  "      hasSensitiveData\n" +
  "      hasAccessToSensitiveData\n" +
  "      hasAdminPrivileges\n" +
  "      hasHighPrivileges\n" +
  "      cloudAccount { id name externalId cloudProvider }\n" +
  "      projects { id name businessImpact }\n" +
  "      tags { key value }\n";

// Same fields inside a graphSearch entity (CloudResource is an inline fragment there).
const ENTITY_FIELDS =
  "        id\n" +
  "        name\n" +
  "        type\n" +
  "        nativeType\n" +
  "        cloudPlatform\n" +
  "        region\n" +
  "        ... on CloudResource {\n" +
  "          status\n" +
  "          firstSeen\n" +
  "          lastSeen\n" +
  "          externalId\n" +
  "          isAccessibleFromInternet\n" +
  "          hasSensitiveData\n" +
  "          hasAccessToSensitiveData\n" +
  "          hasAdminPrivileges\n" +
  "          hasHighPrivileges\n" +
  "          cloudAccount { id name externalId cloudProvider }\n" +
  "          projects { id name businessImpact }\n" +
  "          tags { key value }\n" +
  "        }\n";

function cloudResourcesQuery(name: string, filterBy: string): string {
  return (
    "query " + name + "($first: Int, $after: String) {\n" +
    "  cloudResourcesV2(first: $first, after: $after, filterBy: {\n" +
    filterBy +
    "  }) {\n" +
    "    totalCount\n" +
    "    pageInfo { hasNextPage endCursor }\n" +
    "    nodes {\n" +
    RESOURCE_FIELDS +
    "    }\n" +
    "  }\n" +
    "}\n"
  );
}

function graphSearchQuery(name: string, queryBody: string): string {
  return (
    "query " + name + "($quick: Boolean, $first: Int, $after: String) {\n" +
    "  graphSearch(quick: $quick, first: $first, after: $after, query: {\n" +
    queryBody +
    "  }) {\n" +
    "    totalCount\n" +
    "    pageInfo { hasNextPage endCursor }\n" +
    "    nodes {\n" +
    "      entities {\n" +
    ENTITY_FIELDS +
    "      }\n" +
    "    }\n" +
    "  }\n" +
    "}\n"
  );
}

/** Full AI-SPM inventory: every AI asset kind in one cursor walk. */
export const Q_AI_INVENTORY = cloudResourcesQuery(
  "SidekickAiInventory",
  "    type: [\"AI_AGENT\", \"AI_MODEL\", \"AI_GUARDRAIL\", \"AI_PIPELINE\", \"AI_DATASET\", \"MCP_SERVER\"]\n",
);

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
