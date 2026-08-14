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
// captures in gas_ai/exemples/ (risk_issues_*, toxic_combos_*, ai_cloud_config_findings_request
// + ai_config_findings_response — the pair is spelled two different ways on disk, and the
// response half is truncated mid-node, which is why fixtures are transcribed by hand rather
// than imported — agentic_idenities_*, get_ai_agents_*). Reconcile the normalizers against those.
// issuesV2 follows risk_issues_* — the tenant-wide "Risk Issues" view; toxic_combos_* is
// the same root captured earlier under a narrower, project-scoped filter.

import { effectiveAccessFilter } from "../domain/effectiveAccess";
import { endpointExposureSpec, hostExposureSpec } from "../domain/exposureQuery";
import { toGraphEntityQuery } from "../domain/graphExpand";
import { identityAccessSpec } from "../domain/identityQuery";
import { RISK_CATEGORY_ID } from "../domain/toxicCombos";
import type { Rec } from "../domain/util";

export const PAGE_SIZE = 100;
export const PAGE_SIZE_FALLBACK = 50;
export const MAX_PAGES = 200;

// Shared CloudResource field selection (flat inventory shape).
// NOTE: `businessImpact` lives under `Project.riskProfile`, not directly on
// Project — a flat `projects { businessImpact }` selection is rejected
// ("Cannot query field businessImpact on type Project"). Select it nested and
// the normalizer flattens it back onto the project record.
// The resource field set, declared once, in two lists.
//
// The split is not cosmetic and it is not symmetric: it marks which fields exist on which
// ROOT. `cloudResourcesV2` returns all of them flat on a node. A `graphSearch` entity
// returns only the first list — the rest are unreachable there as fields at all, and the
// facts arrive in a `properties` bag instead. See ENTITY_FIELDS below for the tenant error
// that established this; graphTypes.entityField is what lets one normalizer read both.
//
// String concatenation rather than template literals, matching the rest of this file.
const IDENTITY_FIELDS = [
  "id", "name", "type",
];
const CLOUD_RESOURCE_FIELDS = [
  "nativeType",
  "cloudPlatform",
  "region",
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

/**
 * For a graphSearch entity: the interface fields, and the properties bag. No inline
 * fragment, because there is no fragment to spread. The tenant answers
 * `... on CloudResource` with
 *
 *   Fragment cannot be spread here as objects of type "GraphEntity" can never be of type
 *   "CloudResource"
 *
 * followed by "Cannot query field X on type CloudResource" for every field inside it —
 * CloudResource is not among GraphEntity's possible types, and the type that does bear
 * that name has none of these fields anyway. The resource facts are simply not reachable
 * as fields on this root.
 *
 * They are reachable in `properties`, which is what the Wiz console's own expansion asks
 * for and what the capture in exemples/ai_agent_expand_response.js returns populated:
 * nativeType, cloudPlatform, region, status, externalId, the privilege and exposure
 * booleans, identityPurpose, and severity on the finding entities. graphTypes.entityField
 * reads a node either way, so one normalizer still serves both roots.
 *
 * Deliberately minimal beyond that. This constant is shared by every graphSearch document
 * here and each addition is a way for all five battery traversals to be rejected at once —
 * which is exactly what the CloudResource fragment did, silently, on every live sync.
 */
const ENTITY_FIELDS =
  indented(IDENTITY_FIELDS, 8) +
  "        properties\n";

// (Inline filter literals proved fragile against the tenant's gateway — the
// working capture passes the whole filter as a $filterBy variable, so the
// inventory query does the same and its document stays static.)

/**
 * A DATA_FINDING's severity used to need its own `... on DataFinding` fragment, because
 * the flat fields came from `... on CloudResource` and a finding is not one.
 *
 * Both fragments are gone. `properties` carries severity directly — the capture shows
 * `"severity": "SeverityMedium"` in the bag on the EXCESSIVE_ACCESS_FINDING entity — so
 * the fragment bought nothing and cost another spread the tenant could reject the same way
 * it rejected CloudResource. One field set now serves every graphSearch document.
 */
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
  ENTITY_FIELDS,
);

/**
 * A graphSearch document whose traversal arrives as the `$query` VARIABLE rather than inline.
 *
 * Same shape as the inline builder above and the same shared ENTITY_FIELDS — the difference
 * is only where the traversal comes from. A document needs this form the moment its type
 * list is resolved at runtime: string-building the tenant's AI types into GraphQL source
 * would hand the gateway a textually distinct document per tenant and splice resolved values
 * into query text, which is the conclusion the note at the top of this file reached from the
 * other direction for the inventory filter.
 */
function graphSearchVarQuery(name: string): string {
  return (
    "query " + name + "($quick: Boolean, $first: Int, $after: String, " +
    "$query: GraphEntityQueryInput, $projectId: String) {\n" +
    "  graphSearch(\n" +
    "    quick: $quick\n" +
    "    first: $first\n" +
    "    after: $after\n" +
    "    query: $query\n" +
    "    projectId: $projectId\n" +
    "  ) {\n" +
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
 * Human/role identities with high-privilege or admin access INTO an AI asset.
 *
 * The traversal is `identityAccessSpec` (domain/identityQuery.ts), passed as `$query`. It
 * used to be inline, rooted at the literal `type: "AI_AGENT"` — so a model carrying an admin
 * binding, or an MCP server a contractor could reach, was never collected and the Scans page
 * had no way to say which kinds it had looked at. The root is now the tenant-resolved AI type
 * list, the same one INVENTORY_AI and the two exposure steps use.
 */
export const Q_IDENTITY_ACCESS = graphSearchVarQuery("SidekickAiIdentitiesWithAssetAccess");

/** The `$query` / `$projectId` variables for Q_IDENTITY_ACCESS. Pure — scope is a parameter. */
export function identityAccessVariables(
  types: readonly string[],
  scope: string[] | null,
): Rec {
  return {
    query: toGraphEntityQuery(identityAccessSpec(types)),
    projectId: scope && scope.length ? scope[0] : null,
  };
}

/**
 * Per-agent neighbourhood expansion. Unlike every other graphSearch document here, the
 * traversal is NOT inlined — it arrives as a $query variable built by
 * domain/graphExpand.toGraphEntityQuery(AGENT_EXPANSION, agentId).
 *
 * Two reasons it has to be a variable. It is pinned to one entity
 * (`where: { _vertexID: { EQUALS: <id> } }`), so inlining would hand the gateway a
 * textually distinct document per agent — defeating its query cache — and would splice a
 * caller-supplied id into GraphQL source. And the same spec object that renders this
 * variable also renders the 43-slot list the response is decoded against; sharing one
 * literal is what keeps the query and the decoder from drifting apart. The file already
 * reached this conclusion from the other side for the inventory query (see the note above
 * on inline filter literals proving fragile against the tenant's gateway).
 *
 * $projectId is nullable and left null when WIZ_PROJECT_ID_V2 is unset, matching every
 * other graphSearch document here — they omit the argument entirely and run tenant-wide.
 * The console capture sends it as String!, but that is the console scoping itself to the
 * project the operator had open.
 *
 * Shares ENTITY_FIELDS with the battery. That is now the console's own selection —
 * interface fields plus `properties` — which suits this document doubly well: the
 * traversal reaches ENDPOINT, IAM_BINDING, CONTAINER, DEPLOYMENT, KUBERNETES_CLUSTER and
 * CONFIGURATION_FINDING, none of which the battery ever touches, and the bag is the only
 * place their cloud, region and status were ever going to come from.
 */
export const Q_AGENT_EXPANSION =
  "query SidekickAiAgentExpansion($quick: Boolean, $first: Int, $after: String, " +
  "$query: GraphEntityQueryInput, $projectId: String) {\n" +
  "  graphSearch(\n" +
  "    quick: $quick\n" +
  "    first: $first\n" +
  "    after: $after\n" +
  "    query: $query\n" +
  "    projectId: $projectId\n" +
  "  ) {\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  "      entities {\n" +
  ENTITY_FIELDS +
  "      }\n" +
  "    }\n" +
  "  }\n" +
  "}\n";

// ------------------------------------------------------------- network exposure

/**
 * The console's own GraphSearch operation, VERBATIM — both named fragments, every
 * `@include` gate, the unused `$controlId` / `$issueId` arguments and all.
 *
 * Transcribed from exemples/ai_exposure_host_request.js and
 * exemples/ai_exposure_endpoint_request.js. Two steps send it (HOST_EXPOSURE and
 * ENDPOINT_EXPOSURE) with different `$query` values, the way Q_RULE_ASSETS is one document
 * run once per combo group.
 *
 * WHY THE @include GATES SURVIVE. Every other document here drops them and selects plainly,
 * which is valid and simpler. Not this one: the gates are what keep `issueAnalytics` and
 * `threatAnalytics` OFF. Selected plainly they would add two `issues(filterBy: …)` joins to
 * every entity on every path — the expensive AI-analysis class this codebase deliberately
 * avoids, on the widest selection set the app sends. Keeping the gates and passing the
 * capture's own flag values makes the request byte-comparable to one this tenant provably
 * answered, which is the whole safety argument for a selection set this large.
 *
 * WHY IT DOES NOT REUSE ENTITY_FIELDS. That constant is shared by five battery traversals,
 * and its doc comment says why each addition is a way to have all five rejected at once.
 * A private selection set contains the blast radius: both steps are `optional`, so a tenant
 * that rejects `publicExposures` skips these two and leaves the rest of the battery intact.
 *
 * TWO DELIBERATE DEVIATIONS from the capture:
 *
 *  - `$projectId` is `String`, not `String!`. The console sends it non-null because the
 *    operator had a project open; every step here runs tenant-wide unless WIZ_PROJECT_ID_V2
 *    says otherwise. Q_AGENT_EXPANSION already makes exactly this change for the same reason.
 *  - The operation is named `SidekickAiExposure` rather than `GraphSearch`. Operation names
 *    reach the gateway's logs, and every other document in this file is Sidekick-prefixed.
 */
export const Q_AI_EXPOSURE =
  "query SidekickAiExposure($query: GraphEntityQueryInput, $controlId: ID, " +
  "$projectId: String, $first: Int, $after: String, $fetchTotalCount: Boolean = false, " +
  "$quick: Boolean = true, $fetchPublicExposurePaths: Boolean = false, " +
  "$fetchInternalExposurePaths: Boolean = false, $fetchIssueAnalytics: Boolean = false, " +
  "$fetchThreatAnalytics: Boolean = false, $fetchLateralMovement: Boolean = false, " +
  "$fetchCodeSource: Boolean = false, $fetchKubernetes: Boolean = false, " +
  "$fetchCost: Boolean = false, $issueId: ID) {\n" +
  "  graphSearch(\n" +
  "    query: $query\n" +
  "    controlId: $controlId\n" +
  "    projectId: $projectId\n" +
  "    first: $first\n" +
  "    after: $after\n" +
  "    quick: $quick\n" +
  "    issueId: $issueId\n" +
  "  ) {\n" +
  "    totalCount @include(if: $fetchTotalCount)\n" +
  "    maxCountReached @include(if: $fetchTotalCount)\n" +
  "    pageInfo { endCursor hasNextPage }\n" +
  "    nodes {\n" +
  "      entities {\n" +
  "        providerUniqueId\n" +
  "        deletedAt\n" +
  "        isRestricted\n" +
  "        ...PathGraphEntityFragment\n" +
  "        userMetadata { isInWatchlist isIgnored note }\n" +
  "        technologies { id icon }\n" +
  "        cost(\n" +
  "          filterBy: {timestamp: {inLast: {amount: 30, unit: DurationFilterValueUnitDays}}}\n" +
  "        ) @include(if: $fetchCost) {\n" +
  "          amortized\n" +
  "          blended\n" +
  "          unblended\n" +
  "          netAmortized\n" +
  "          netUnblended\n" +
  "          currencyCode\n" +
  "        }\n" +
  "        costImpact @include(if: $fetchCost) { monthly }\n" +
  "        publicExposures(first: 10) @include(if: $fetchPublicExposurePaths) {\n" +
  "          nodes { ...NetworkExposureFragment }\n" +
  "        }\n" +
  "        otherSubscriptionExposures(first: 10) @include(if: $fetchInternalExposurePaths) {\n" +
  "          nodes { ...NetworkExposureFragment }\n" +
  "        }\n" +
  "        otherVnetExposures(first: 10) @include(if: $fetchInternalExposurePaths) {\n" +
  "          nodes { ...NetworkExposureFragment }\n" +
  "        }\n" +
  "        lateralMovementPaths(first: 10) @include(if: $fetchLateralMovement) {\n" +
  "          nodes {\n" +
  "            id\n" +
  "            pathEntities { entity { providerUniqueId ...PathGraphEntityFragment } }\n" +
  "          }\n" +
  "        }\n" +
  "        codeSourcePath(first: 10) @include(if: $fetchCodeSource) {\n" +
  "          totalCount\n" +
  "          nodes {\n" +
  "            id\n" +
  "            pathEntities { providerUniqueId ...PathGraphEntityFragment }\n" +
  "          }\n" +
  "        }\n" +
  "        kubernetesPaths(first: 10) @include(if: $fetchKubernetes) {\n" +
  "          nodes { id path { providerUniqueId ...PathGraphEntityFragment } }\n" +
  "        }\n" +
  "      }\n" +
  "      aggregateCount\n" +
  "    }\n" +
  "  }\n" +
  "}\n" +
  "\n" +
  "fragment PathGraphEntityFragment on GraphEntity {\n" +
  "  providerUniqueId\n" +
  "  id\n" +
  "  name\n" +
  "  type\n" +
  "  properties\n" +
  // Unlike `... on CloudResource` (see ENTITY_FIELDS above, which the tenant rejected
  // outright), GEAiAgent IS among GraphEntity's possible types — the capture returns
  // `"__typename": "GEAiAgent"` on the agent entity. The description it carries is the one
  // field the flat inventory root has never been able to give us.
  "  typedProperties { ... on GEAiAgent { description } }\n" +
  "  issueAnalytics: issues(\n" +
  "    filterBy: {status: [IN_PROGRESS, OPEN], type: [TOXIC_COMBINATION, CLOUD_CONFIGURATION]}\n" +
  "  ) @include(if: $fetchIssueAnalytics) {\n" +
  "    highSeverityCount\n" +
  "    criticalSeverityCount\n" +
  "  }\n" +
  "  threatAnalytics: issues(\n" +
  "    filterBy: {status: [IN_PROGRESS, OPEN], type: [THREAT_DETECTION], " +
  "createdAt: {inLast: {amount: 7, unit: DurationFilterValueUnitDays}}}\n" +
  "  ) @include(if: $fetchThreatAnalytics) {\n" +
  "    highSeverityCount\n" +
  "    criticalSeverityCount\n" +
  "  }\n" +
  "}\n" +
  "\n" +
  "fragment NetworkExposureFragment on NetworkExposure {\n" +
  "  id\n" +
  "  portRange\n" +
  "  sourceIpRange\n" +
  "  destinationIpRange\n" +
  "  path { providerUniqueId ...PathGraphEntityFragment }\n" +
  "  applicationEndpoints { providerUniqueId ...PathGraphEntityFragment }\n" +
  "}\n";

/**
 * The `@include` flags both exposure steps send, exactly as the two captures send them.
 *
 * `fetchTotalCount` stays FALSE, which costs the job row its progress total (readConnection
 * degrades to `totalCount: null` and runBattery already writes `result.totalCount ?? 0`).
 * That is the capture's own value and this is the one document where being byte-comparable
 * to a proven request is worth more than a progress number.
 */
const EXPOSURE_FETCH_FLAGS: Rec = {
  fetchTotalCount: false,
  fetchPublicExposurePaths: true,
  fetchInternalExposurePaths: false,
  fetchIssueAnalytics: false,
  fetchThreatAnalytics: false,
  fetchLateralMovement: true,
  fetchCodeSource: true,
  fetchKubernetes: false,
  fetchCost: false,
};

/** $query + $projectId + the fetch flags for HOST_EXPOSURE. */
export function hostExposureVariables(
  types: readonly string[],
  scope: string[] | null,
): Rec {
  return {
    ...EXPOSURE_FETCH_FLAGS,
    query: toGraphEntityQuery(hostExposureSpec(types)),
    projectId: scope && scope.length ? scope[0] : null,
  };
}

/** $query + $projectId + the fetch flags for ENDPOINT_EXPOSURE. */
export function endpointExposureVariables(
  types: readonly string[],
  scope: string[] | null,
): Rec {
  return {
    ...EXPOSURE_FETCH_FLAGS,
    query: toGraphEntityQuery(endpointExposureSpec(types)),
    projectId: scope && scope.length ? scope[0] : null,
  };
}

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

// Transcribed from exemples/ai_cloud_config_findings_request.js (the @include directives
// are dropped; totalCount is selected plainly). Feeds AARS pillar B, backs the Cloud
// Configuration register, and carries remediation.
//
// Every field here is proven by that capture — the tenant answered all of them. Fields
// the published ConfigurationFinding schema carries but the capture does NOT are
// deliberately absent, `resolutionReason` above all: an unknown field fails the whole
// document, and CONFIG_FINDINGS is an optional step that swallows an HTTP 400, so a
// rejected query would look exactly like a tenant with nothing to report. Probe one
// through the Wiz Scans variables panel's test run before adding it here.
//
// `firstSeenAt` and `analyzedAt` are the register's only lifecycle clock. Wiz sends NO
// resolvedAt on a configuration finding, so when one closes is knowable only by
// differencing this app's own sync history — which is why they are collected now even
// though nothing reads them yet. Uncollected history cannot be backfilled.
export const Q_CONFIG_FINDINGS =
  "query SidekickAiConfigFindings($first: Int, $after: String, $filterBy: ConfigurationFindingFilters, $orderBy: ConfigurationFindingOrder) {\n" +
  "  configurationFindings(first: $first, after: $after, filterBy: $filterBy, orderBy: $orderBy) {\n" +
  "    totalCount\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  "      id\n" +
  "      name\n" +
  "      deleted\n" +
  "      analyzedAt\n" +
  "      firstSeenAt\n" +
  "      severity\n" +
  "      result\n" +
  "      status\n" +
  "      remediation\n" +
  "      source\n" +
  "      targetExternalId\n" +
  "      ignoreRules { id tags { key value } }\n" +
  "      subscription {\n" +
  "        id\n" +
  "        name\n" +
  "        externalId\n" +
  "        cloudProvider\n" +
  "        sourceDeployments { id name status }\n" +
  "      }\n" +
  "      resource {\n" +
  "        id\n" +
  "        name\n" +
  "        type\n" +
  "        status\n" +
  "        projects { id name riskProfile { businessImpact } }\n" +
  "      }\n" +
  "      sourceMappedIacFindings { id name }\n" +
  "      rule {\n" +
  "        id\n" +
  "        shortId\n" +
  "        graphId\n" +
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
 * The $filterBy / $orderBy variables for Q_CONFIG_FINDINGS. Findings under the AI risk
 * framework category (wct-id-1998), optionally project-scoped (the resource filter nests
 * projectId, matching the capture). Pure — scope is a parameter.
 *
 * RESOLVED joins OPEN in the default because a configuration finding carries no
 * resolvedAt: the only way this app can ever say when one closed is to have seen it
 * closed. Collecting the resolved rows is what makes that possible later; nothing reads
 * them yet, and normalizeConfigFindingsPage keeps them out of the gap counts.
 *
 * REJECTED is deliberately NOT in the default. It is an accepted-risk decision rather
 * than a posture fact, and scanVars offers it as an opt-in on the step's editable
 * status field for a tenant that wants to see exceptions in the register.
 */
export function aiConfigFindingsVariables(
  scope: string[] | null,
): { filterBy: unknown; orderBy: unknown } {
  const filterBy: Record<string, unknown> = {
    status: ["OPEN", "RESOLVED"],
    frameworkCategory: [RISK_CATEGORY_ID],
  };
  if (scope && scope.length) filterBy["resource"] = { projectId: scope };
  return { filterBy, orderBy: { field: "SEVERITY", direction: "DESC" } };
}

// ----------------------------------------------------- AI asset properties (provenance)

/**
 * Who published an AI asset and how Wiz found it — `publisher` and `discoveryMethods`, the two
 * columns the Security Graph's default AI-asset group reads.
 *
 * ITS OWN STEP, and that is the whole point. Both fields live in `graphEntity.properties`,
 * which the mandatory `INVENTORY_AI` step does not select and must not start selecting:
 *
 *   - `properties` is an opaque JSON map with no sub-selection, so asking for it drags in
 *     `snippet` — verbatim agent source code, and most of the 396 KB that
 *     exemples/get_ai_agents_reponse.js weighs for 68 agents. `normalizeCloudResource` throws
 *     all of that away, but the transport cost is real and belongs on a step that can be
 *     dropped rather than on the one the whole app depends on.
 *   - a tenant whose schema rejects `graphEntity` on this root would otherwise lose the entire
 *     inventory, not two columns.
 *
 * So it follows the shape DSPM and network exposure already set here: a claim that needs its
 * own selection set gets its own OPTIONAL step, and its absence degrades two cells rather than
 * the sync. The selection is IDENTITY_FIELDS plus the bag — `type` is not decoration, it is
 * what `kindFromWizType` needs to admit the row at all.
 */
export const Q_AI_PROPERTIES =
  "query SidekickAiAssetProperties($first: Int, $after: String, $filterBy: CloudResourceV2Filters) {\n" +
  "  cloudResourcesV2(first: $first, after: $after, filterBy: $filterBy) {\n" +
  "    totalCount\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  indented(IDENTITY_FIELDS, 6) +
  "      graphEntity { properties }\n" +
  "    }\n" +
  "  }\n" +
  "}\n";

/** Same population as the inventory step, so the two answer about the same assets. */
export function aiPropertiesVariables(types: readonly string[]): { filterBy: unknown } {
  return { filterBy: { type: { equals: [...types] } } };
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
  // The identity facts live HERE and nowhere else on this root. `inactiveInLast90Days`,
  // `inactiveTimeframe`, `enabled`, `userDirectory` and the real `identityPurpose` are all in
  // the graph entity's properties bag — the capture in exemples/agentic_identities_response.js
  // returns every one of them, one level deeper than the flat fields above.
  //
  // Until this line existed the app could not tell a dormant identity from an active one,
  // and normalizePrincipalsPage had to STAMP identityPurpose because nothing in the selection
  // set carried it. The Wiz Scans page said so in as many words: "MFA and inactivity signals
  // on those accounts are not collected at all — no query selects them".
  //
  // One field, and the blast radius is contained: AGENTIC_IDENTITIES is optional, so a tenant
  // whose schema rejects `graphEntity` skips the step and is recorded.
  "      graphEntity { properties }\n" +
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

// ------------------------------------------- compliance frameworks (posture)

// The framework catalogue. A plain connection like the four roots above, so it reads
// through fetchConnectionPage with no transport change. It exists to POPULATE A PICKER,
// not to widen the battery: posture costs one round trip per framework, and a tenant
// carrying a hundred builtin frameworks (CIS, PCI-DSS, SOC 2) has no business spending
// a hundred calls on frameworks this app has nothing to say about.
/**
 * The cloud-configuration RULE CATALOGUE — Wiz's vocabulary, not this tenant's findings.
 *
 * Every field here is proven by the captured response
 * (exemples/ai_config_rules_response.js): id, name, shortId, subjectEntityType and
 * externalReferences, and nothing else.
 *
 * NO `filterBy`, deliberately. The filter input's type name is unverified, and naming an
 * input type wrong is a validation error that takes the whole document down — whereas sending
 * no filter cannot be. The capture looks unfiltered anyway (it carries Tencent, Synapse and
 * Dockerfile-lint rules beside the AI ones), so this is what produced it.
 *
 * It is REFERENCE DATA and the sync treats it as such: ~3,858 rules is ~39 pages at PAGE_SIZE,
 * against a battery that is otherwise ~10–20 calls. The step is gated on a 30-day freshness
 * check (see syncJobs.CONFIG_RULES) because this list changes when Wiz ships rules, not when
 * the estate moves.
 */
export const Q_CONFIG_RULES =
  "query SidekickAiConfigRules($first: Int, $after: String) {\n" +
  "  cloudConfigurationRules(first: $first, after: $after) {\n" +
  "    totalCount\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  "      id\n" +
  "      name\n" +
  "      shortId\n" +
  "      subjectEntityType\n" +
  "      externalReferences { id name }\n" +
  "    }\n" +
  "  }\n" +
  "}\n";

/**
 * The $filterBy for the identity-hygiene findings step: the MFA and dormancy rules resolved
 * from the catalogue, OPEN only.
 *
 * `rule` IS THE UNVERIFIED PART OF THIS FILE. The captured ConfigurationFindingFilters carries
 * `status`, `frameworkCategory` and `resource { projectId, nameV2, region }` — no `rule`. Two
 * things can go wrong and both are handled elsewhere, because neither can be handled here:
 *
 *   rejected        → HTTP 400 → the optional step skips and is recorded. Existing machinery.
 *   silently ignored → we would walk the tenant's entire CSPM register, which is why
 *                      normalizeIdentityFindingsPage verifies the first page against the
 *                      requested ids and aborts rather than collecting the wrong thousand rows.
 *
 * No `frameworkCategory`: these rules are IAM hygiene and are not in the AI risk category, so
 * scoping by it would return nothing. The rule list IS the scope.
 */
export function aiIdentityHygieneVariables(
  ruleIds: readonly string[],
  scope: string[] | null,
): { filterBy: unknown; orderBy: unknown } {
  const filterBy: Record<string, unknown> = {
    status: ["OPEN"],
    rule: [...ruleIds],
  };
  if (scope && scope.length) filterBy["resource"] = { projectId: scope };
  return { filterBy, orderBy: { field: "SEVERITY", direction: "DESC" } };
}

/**
 * Effective permissions: which people can actually reach an AI asset's data, and through
 * which policy.
 *
 * Trimmed from the console's `IdentityEntitlementsTable` capture. FOUR things dropped, each
 * for a reason worth keeping written down:
 *
 *   issueAnalytics    An `issues(filterBy: …)` join that the console leaves UNGATED here,
 *                     unlike every other capture in this file — and the entity fragment
 *                     spreads at six sites, so it is that join six times over. Q_ISSUES
 *                     already carries a warning about this exact class of AI-analysis join.
 *   userMetadata      Watchlist / ignore / note. Nothing reads them.
 *   hasOriginalObject Nothing reads it.
 *   paths[].path      The intermediate hop chain — the largest multiplier in the document,
 *                     and the topology IDENTITY_ACCESS already draws as real edges.
 *
 * What is kept is the reason to run this at all: `permissions` as real permission strings, and
 * the principal/resource POLICIES, which are what someone would actually go and change.
 */
export const Q_EFFECTIVE_ACCESS =
  "query SidekickAiEffectiveAccess($first: Int, $after: String, " +
  "$filterBy: EntityEffectiveAccessFilters) {\n" +
  "  entityEffectiveAccessEntries(first: $first, after: $after, filterBy: $filterBy) {\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  "      grantedEntity: grantedEntityV2 { id name type }\n" +
  "      accessibleResource: accessibleResourceV2 { id name type }\n" +
  "      accessTypes\n" +
  "      permissions\n" +
  "      paths {\n" +
  "        accessTypes\n" +
  "        permissions\n" +
  "        principalPolicies { policy { id name type } }\n" +
  "        resourcePolicies { policy { id name type } }\n" +
  "      }\n" +
  "    }\n" +
  "  }\n" +
  "}\n";

/** The $filterBy for Q_EFFECTIVE_ACCESS. Pure — types and scope are parameters. */
export function effectiveAccessVariables(
  types: readonly string[],
  scope: string[] | null,
): Rec {
  return { filterBy: effectiveAccessFilter(types, scope) };
}

export const Q_SECURITY_FRAMEWORKS =
  "query SidekickAiSecurityFrameworks($first: Int, $after: String, $filterBy: SecurityFrameworkFilters) {\n" +
  "  securityFrameworks(first: $first, after: $after, filterBy: $filterBy) {\n" +
  "    totalCount\n" +
  "    pageInfo { hasNextPage endCursor }\n" +
  "    nodes {\n" +
  "      id\n" +
  "      name\n" +
  "      description\n" +
  "      builtin\n" +
  "      enabled\n" +
  "      policyTypes\n" +
  "    }\n" +
  "  }\n" +
  "}\n";

/** The $filterBy for Q_SECURITY_FRAMEWORKS: the frameworks this tenant has switched on. */
export function aiSecurityFrameworksVariables(): { filterBy: unknown } {
  return { filterBy: { enabled: true } };
}

// Per-framework compliance posture, transcribed from the console's own CompliancePageTable
// operation. THREE deliberate departures from that capture:
//
//   1. `$fetchControlQuery: Boolean!` and its `@include`/`@skip` directives are gone. This
//      app only ever wants `scopeQuery` (the console sends fetchControlQuery:false on the
//      table view), and wizQueriesAi.test.ts asserts no document carries a directive — the
//      config-findings capture had them and they were stripped for the same reason.
//   2. `securityFramework(id:)` returns ONE OBJECT, not a connection. It is the only root
//      here that does, which is why fetchSingleObject exists: readConnection on a
//      non-connection returns rows:[] rather than throwing, and on an optional step that is
//      indistinguishable from a tenant with nothing to report.
//   3. `emptyPostureReason` is selected at all three levels on purpose. NO_RESOURCES and
//      NO_POLICIES are the difference between "scored zero" and "nothing to score", and a
//      posture page that renders them the same way is the implied confidence PRODUCT.md
//      forbids.
//
// The same policy appears under many subcategories (one prompt-injection control maps to
// ASI01, ASI02 and ASI10), so policyAnalytics is a many-to-many edge, not a list of
// distinct policies. Summing it without deduplicating double counts.
export const Q_COMPLIANCE_POSTURE =
  "query SidekickAiCompliancePosture($id: ID!, $analyticsSelection: SecurityFrameworkComplianceAnalyticsSelection, $orderBy: SecurityFrameworkSelectionOrder) {\n" +
  "  securityFramework(id: $id) {\n" +
  "    id\n" +
  "    name\n" +
  "    description\n" +
  "    builtin\n" +
  "    enabled\n" +
  "    complianceAnalytics(selection: $analyticsSelection, orderBy: $orderBy) {\n" +
  "      passSubCategoryCount\n" +
  "      failSubCategoryCount\n" +
  "      averageCompliancePosture\n" +
  "      emptyPostureReason\n" +
  "      categoryAnalytics {\n" +
  "        category { id name description externalId }\n" +
  "        passCount\n" +
  "        failCount\n" +
  "        passSubCategoryCount\n" +
  "        failSubCategoryCount\n" +
  "        averageCompliancePosture\n" +
  "        emptyPostureReason\n" +
  "        subCategoryAnalytics {\n" +
  "          passCount\n" +
  "          failCount\n" +
  "          compliancePosture\n" +
  "          emptyPostureReason\n" +
  "          subCategory {\n" +
  "            id\n" +
  "            title\n" +
  "            description\n" +
  "            externalId\n" +
  "            assessmentScope\n" +
  "            mappingRationale\n" +
  "            tags { key value }\n" +
  "          }\n" +
  "          policyAnalytics {\n" +
  "            failCount\n" +
  "            passCount\n" +
  "            rejectedCount\n" +
  "            assessedCount\n" +
  "            noResourceToAsses\n" +
  "            control {\n" +
  "              id\n" +
  "              name\n" +
  "              description\n" +
  "              enabled\n" +
  "              builtin\n" +
  "              severity\n" +
  "              scopeQuery\n" +
  "            }\n" +
  "            cloudConfigurationRule {\n" +
  "              id\n" +
  "              name\n" +
  "              description\n" +
  "              shortId\n" +
  "              enabled\n" +
  "              builtin\n" +
  "              severity\n" +
  "              targetNativeType\n" +
  "              subjectEntityType\n" +
  "              hasAutoRemediation\n" +
  "              cloudProvider\n" +
  "            }\n" +
  "            hostConfigurationRule {\n" +
  "              id\n" +
  "              name\n" +
  "              shortName\n" +
  "              description\n" +
  "              enabled\n" +
  "              builtin\n" +
  "              severity\n" +
  "            }\n" +
  "          }\n" +
  "        }\n" +
  "      }\n" +
  "    }\n" +
  "  }\n" +
  "}\n";

/**
 * The $analyticsSelection / $orderBy for Q_COMPLIANCE_POSTURE. Pure — scope is a parameter.
 *
 * Project scope is spelled a FIFTH way here. The other four builders reach it as
 * `filterBy.project`, `filterBy.resource.projectId`, `filterBy.projectId` and a scalar
 * `$projectId`; this root takes `analyticsSelection.projectId`. That is why it gets its own
 * function rather than a branch inside an existing one.
 *
 * The framework `id` is deliberately NOT built here. It is not a filter — it selects WHICH
 * framework — so it belongs to the step that sends it, and to Settings, not to the
 * editable-variables panel where a filter can be widened without changing the selection set.
 */
export function aiCompliancePostureVariables(
  scope: string[] | null,
): { analyticsSelection: unknown } {
  const analyticsSelection: Record<string, unknown> = {};
  if (scope && scope.length) analyticsSelection["projectId"] = scope;
  return { analyticsSelection };
}
