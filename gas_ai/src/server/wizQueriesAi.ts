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
// NOTE: `businessImpact` lives under `Project.riskProfile`, not directly on
// Project — a flat `projects { businessImpact }` selection is rejected
// ("Cannot query field businessImpact on type Project"). Select it nested and
// the normalizer flattens it back onto the project record.
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
  "      projects { id name riskProfile { businessImpact } }\n" +
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
  "          projects { id name riskProfile { businessImpact } }\n" +
  "          tags { key value }\n" +
  "        }\n";

// (Inline filter literals proved fragile against the tenant's gateway — the
// working capture passes the whole filter as a $filterBy variable, so the
// inventory query does the same and its document stays static.)

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
  const aiLooking = enumValues.filter((v) => {
    const tokens = v.toUpperCase().split(/[\s_]+/);
    return tokens.includes("AI") || tokens.includes("MCP") ||
      tokens.includes("GENAI") || tokens.includes("LLM");
  });
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
