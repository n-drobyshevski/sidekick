// The graph model: typed nodes (AI assets, supporting infrastructure, findings, and
// synthetic issue/summary nodes) and typed edges (the Wiz security-graph relationship
// vocabulary, from ai/ai_agents_discovery_queries.md and ai/queries/*).

import type { AarsGap, DataExposure, InternetExposure } from "./aars";
import type { AarsSeverity, Severity } from "./config";
import { SEVERITY_ORDER } from "./config";
// Type-only, and mutual with problem.ts (which itself imports FindingRow/GNode/IssueRow
// from here): problem.ts is where `ProblemVerdictInput` naturally lives, next to the
// `DecisionVector` axes it is built from, and `import type` is erased at compile time, so
// this closes no runtime cycle — only a type-checking one, which tsc resolves fine.
import type { ProblemVerdictInput } from "./problem";
import type { Rec } from "./util";

/**
 * Where a row sits relative to the AI estate: `DIRECT` on an AI asset, `ADJACENT` one edge
 * away, `UNLINKED` neither. RE-EXPORTED from rank.ts rather than declared a second time —
 * rank.ts is the module that READS the field (`RankInput.aiAdjacency`, `adjacencyOf`), so a
 * copied union would be a second place for the same three words to drift, and the drift
 * would be silent: a value the ledger writes and the ranker has never heard of scores as
 * unmeasured rather than failing. rank.ts imports nothing at all, so this closes no cycle,
 * and `export type` is erased at compile time.
 *
 * ABSENT is a fourth state and a different one: no adjacency pass ran over the row.
 * `UNLINKED` says we looked; absent says we did not, and `adjacencyOf` already returns a
 * `null` component for it rather than the mid-scale UNLINKED weight.
 */
import type { AiAdjacency, ExploitationTier } from "./rank";
export type { AiAdjacency, ExploitationTier };

/**
 * Position on the severity scale, LOWER = WORSE, with anything unrecognised sorting last.
 *
 * Graph-local on purpose. It lived as three byte-identical private copies in graphEnrich,
 * graphProject and graphLayout; it is not in severity.ts because that file is declared the
 * port of wiz_dashboard/domain/severity.py and this helper has no Python twin.
 *
 * Note the sign: assetTable.ts has its own `sevRank` built on an INVERTED scale
 * (higher = worse) for column sorting. The two look alike and mean opposite things — do
 * not fold them together.
 */
export function severityRank(s: string | undefined): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(s ?? "");
  return i === -1 ? SEVERITY_ORDER.length : i;
}

export const NODE_KINDS = [
  // AI assets (Wiz AI-SPM resource types)
  "AI_AGENT", "AI_MODEL", "AI_GUARDRAIL", "AI_PIPELINE", "AI_DATASET", "MCP_SERVER",
  // AI assets seen in real tenants (Wiz inventory display names, normalized) —
  // appended so the original kinds keep their declaration order.
  "AI_AGENT_REGISTRY", "AI_DEPLOYMENT", "AI_EXTENSION", "AI_GATEWAY",
  "AI_SERVICE", "AI_SKILL", "AI_SKILL_TEMPLATE", "AI_TOOL",
  // identities
  "SERVICE_ACCOUNT", "USER_ACCOUNT", "ACCESS_ROLE", "ACCESS_ROLE_BINDING", "ACCESS_KEY",
  // The binding and permission entities the tenant ACTUALLY returns. A console export of
  // "AI assets whose identity holds high privileges" walks
  // PRINCIPAL <-ENTITLES- IAM_BINDING -ALLOWS-> ACCESS_ROLE_PERMISSION and came back with 12
  // rows; ACCESS_ROLE_BINDING and ACCESS_ROLE above are declared here and exist in the
  // tenant's schema, but no capture walks them. Both pairs are kept: dropping the older two
  // would orphan rows already on the ledger.
  "IAM_BINDING", "ACCESS_ROLE_PERMISSION",
  // data
  "BUCKET", "DATABASE",
  // compute / supply chain
  "VIRTUAL_MACHINE", "SERVERLESS", "CONTAINER_IMAGE", "REPOSITORY",
  // CIEM finding entities
  "EXCESSIVE_ACCESS_FINDING", "LATERAL_MOVEMENT_FINDING",
  // Synthesized from the identity-access scan: one per AI asset a HUMAN identity can reach
  // at high privilege. Declared beside the CIEM findings rather than with the other
  // synthetic kinds below, so the grouped layout files it with the access finding it
  // complements — that layout orders its blocks by this list.
  "IDENTITY_ACCESS_FINDING",
  // synthetic
  "ISSUE",    // one node per open risk issue (toxic-combination instance)
  "SUMMARY",  // collapse node: "+N more <kind>" emitted by the projection
  "SENSITIVE_DATA",     // one node per data-exposed asset (AARS pillar C topology)
  "INTERNET_EXPOSURE",  // one node per internet-exposed asset (exposure topology)
  "EXCESSIVE_PRIVILEGE", // one node per over-privileged asset (CIEM rights topology)
  "MISSING_GUARDRAIL",   // one node per unguarded AI asset (guardrail-coverage topology)
  // Appended, so the kinds above keep their declaration order (the grouped layout orders
  // its blocks by this list).
  //
  // DATABASE_SERVER is inventory, not synthetic: it is in the datastore type list the
  // sensitive-data traversal asks for (ai/queries/6_IAM.MD). Leaving it out would not
  // narrow the query — kindFromWizType would return null and the whole ROW would be
  // skipped, losing the agent and the service account with it.
  "DATABASE_SERVER",
  // One node per datastore that carries classified data findings — the aggregate, not the
  // individual finding. Wiz draws the same collapse ("Data Findings", count badge); a
  // bucket with 200 findings would otherwise spend the entire node budget by itself.
  "DATA_FINDING",
  // The network-exposure traversals' far end: a validated, reachable service address such as
  // `https://…run.app:443`. INVENTORY, not evidence — it carries a name, a region, a status
  // and a subscription, which is why it stays out of RISK_NODE_KINDS with BUCKET and
  // DATABASE rather than joining the derived stubs.
  //
  // graphExpand.toExpandedNode used to flag this kind `unmodeled`, because declaring it here
  // "would admit them into the sync and persistence path too". That is now the intent: two
  // sync steps collect these deliberately.
  "ENDPOINT",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * Risk evidence: nodes that exist only to say something about the asset they hang off,
 * as opposed to inventory the tenant owns. They carry no cloud, project, or (for the
 * derived ones) severity of their own, so the graph's inventory filters skip them and
 * the grouped layout resolves their bucket from their parent — otherwise a node-type or
 * cloud filter silently severs the attack path it is meant to narrow.
 */
export const RISK_NODE_KINDS: readonly NodeKind[] = [
  "ISSUE", "SENSITIVE_DATA", "INTERNET_EXPOSURE", "EXCESSIVE_PRIVILEGE", "MISSING_GUARDRAIL",
  "EXCESSIVE_ACCESS_FINDING", "LATERAL_MOVEMENT_FINDING", "IDENTITY_ACCESS_FINDING",
  // DATA_FINDING is here; BUCKET / DATABASE / DATABASE_SERVER deliberately are NOT. The
  // finding is evidence about a store and must ride through the filters with it. The store
  // itself is inventory the tenant owns — it carries a cloud, a region and projects, and
  // someone filtering to GCP means to exclude an AWS bucket. Filtering the store out still
  // takes its findings with it, because the projection only admits neighbours of admitted
  // nodes.
  "DATA_FINDING",
];

export function isRiskKind(kind: string): boolean {
  return (RISK_NODE_KINDS as readonly string[]).includes(kind);
}

/** AI-SPM asset kinds — the graph's focal nodes and default seeds. */
export const AI_ASSET_KINDS: readonly NodeKind[] = [
  "AI_AGENT", "AI_MODEL", "AI_GUARDRAIL", "AI_PIPELINE", "AI_DATASET", "MCP_SERVER",
  "AI_AGENT_REGISTRY", "AI_DEPLOYMENT", "AI_EXTENSION", "AI_GATEWAY",
  "AI_SERVICE", "AI_SKILL", "AI_SKILL_TEMPLATE", "AI_TOOL",
];

/**
 * A Wiz `type` value → NodeKind, tolerant of both spellings real tenants use:
 * enum-style ("AI_AGENT") and inventory display names ("AI Agent Registry").
 * Normalization is mechanical (uppercase, non-alphanumerics → "_"), then a
 * membership check; unknown types map to null and the row is skipped.
 */
export function kindFromWizType(t: unknown): NodeKind | null {
  if (typeof t !== "string" || !t.trim()) return null;
  const norm = t.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return (NODE_KINDS as readonly string[]).includes(norm) ? (norm as NodeKind) : null;
}

/**
 * Where the same fact lives under a different name inside a graphEntity's `properties`.
 *
 * The flat `cloudResourcesV2` root spells these one way; the properties bag on a
 * graphSearch entity spells them another. Everything not listed here has the same name in
 * both, which is most of them.
 */
const PROPERTY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  firstSeen: ["creationDate"],
  lastSeen: ["updatedAt"],
  isAccessibleFromInternet: ["accessibleFrom.internet"],
  isOpenToAllInternet: ["openToAllInternet"],
  // ENDPOINT entities only. Wiz spells the dynamic scanner's two verdicts with suffixes the
  // rest of the model has no use for; aliasing them here is what lets the GNode field keep
  // the name the app reads it by.
  exposureLevel: ["exposureLevel_name"],
  portValidation: ["portValidationResult"],
  // ACCESS_ROLE entities. The traversal filters on `accessTypes` (plural) because that is what
  // the capture sends, and a tenant that answers in the spelling it was asked in would put the
  // plural key in the bag — where a reader looking only for the singular would not find it, take
  // the caller's fallback, and report every ADMIN binding as HIGH_PRIVILEGE. No capture shows
  // this field in a RESPONSE, so which spelling comes back is genuinely unknown; aliasing costs
  // nothing and covers both.
  accessType: ["accessTypes"],
};

/**
 * One field of a Wiz entity, whichever of the two shapes it arrived in.
 *
 * `cloudResourcesV2` returns resource fields flat on the node. A `graphSearch` entity does
 * NOT, and cannot be made to: the tenant's schema answers `... on CloudResource` with
 *
 *   Fragment cannot be spread here as objects of type "GraphEntity" can never be of type
 *   "CloudResource"
 *
 * — CloudResource is not among GraphEntity's possible types, and the type that does bear
 * that name carries none of these fields either. On that root the facts live in the
 * `properties` bag, which is what the Wiz console itself selects (see
 * gas_ai/exemples/ai_agent_expand_response.js). Reading flat first and falling back to the
 * bag lets one normalizer serve both roots.
 */
export function entityField(raw: Rec, key: string): unknown {
  if (!raw || typeof raw !== "object") return undefined;
  if (raw[key] !== undefined) return raw[key];
  const bag = propertyBag(raw);
  if (!bag) return undefined;
  if (bag[key] !== undefined) return bag[key];
  for (const alias of PROPERTY_ALIASES[key] ?? []) {
    if (bag[alias] !== undefined) return bag[alias];
  }
  return undefined;
}

/**
 * Where the properties bag sits, which is not the same place on all three roots.
 *
 * A graphSearch entity carries it flat as `properties`. A `cloudResourcesV2` node carries the
 * resource fields flat and the bag one level deeper, under `graphEntity` — which is exactly
 * why the agentic-identities step could see `hasAdminPrivileges` but not `inactiveInLast90Days`
 * or the real `identityPurpose`, even though the tenant returns all three in the same capture
 * (exemples/agentic_identities_response.js). One helper, three roots.
 */
function propertyBag(raw: Rec): Rec | null {
  const flat = raw["properties"];
  if (flat && typeof flat === "object") return flat as Rec;
  const entity = raw["graphEntity"];
  if (!entity || typeof entity !== "object") return null;
  const nested = (entity as Rec)["properties"];
  return nested && typeof nested === "object" ? (nested as Rec) : null;
}

/**
 * Tags, from either shape Wiz sends them in.
 *
 * The flat roots select `tags { key value }` and get an ARRAY of `{key, value}`. The
 * properties bag holds the same fact as an OBJECT MAP — `{"Wiz/Domain": "CROSS"}` — because
 * a bag has no sub-selection and Wiz flattens it. Both appear on the same node in
 * exemples/get_ai_agents_reponse.js (the array at :4517, the map at :4462).
 *
 * Returns `undefined` rather than `[]` when there is nothing. That is not tidiness:
 * `mergeParts` copies any value that is not undefined/null/false, and an empty array is
 * truthy — so a later step returning `[]` would ERASE the tags an earlier one established.
 */
export function tagPairs(value: unknown): Array<{ key: string; value: string }> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Array<{ key: string; value: string }> = [];
  if (Array.isArray(value)) {
    for (const t of value) {
      if (!t || typeof t !== "object") continue;
      const key = String((t as Rec)["key"] ?? "").trim();
      if (key) out.push({ key, value: String((t as Rec)["value"] ?? "") });
    }
  } else {
    for (const [k, v] of Object.entries(value as Rec)) {
      const key = k.trim();
      // A nested object under a tag key is not a tag; the bag holds scalars here.
      if (key && (v === null || typeof v !== "object")) {
        out.push({ key, value: v === null || v === undefined ? "" : String(v) });
      }
    }
  }
  return out.length ? out : undefined;
}

/**
 * Every tag on an entity, whichever root it arrived from — the union of the flat field and
 * the properties bag, the bag winning a key collision because it is the richer source.
 *
 * This does NOT go through `entityField`, and that is the whole reason it exists.
 * `entityField` returns the flat value the moment it is not `undefined`, and the real
 * inventory capture sends flat `"tags": null` on 39 of its 40 nodes — so a reader built on
 * it would stop at the null and never see the bag, which is the only place `Wiz/Domain`
 * ever appears (exemples/ai_agent_expand_response.js:316,
 * exemples/ai_exposure_host_response.js:94).
 */
export function entityTags(raw: Rec): Array<{ key: string; value: string }> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const flat = tagPairs(raw["tags"]);
  const bag = tagPairs(propertyBag(raw)?.["tags"]);
  if (!flat) return bag;
  if (!bag) return flat;
  const merged = [...flat];
  const at = new Map(merged.map((t, i) => [t.key, i]));
  for (const t of bag) {
    const i = at.get(t.key);
    if (i === undefined) merged.push(t);
    else merged[i] = t;
  }
  return merged;
}

export const EDGE_TYPES = [
  "HAS_ISSUE",            // asset → ISSUE
  "PROTECTED_BY",         // AI_AGENT → AI_GUARDRAIL (negated = guardrail MISSING)
  "RUNS_AS",              // AI_AGENT → SERVICE_ACCOUNT (execution identity)
  "ALLOWS_ACCESS_TO",     // identity → resource (IAM; carries accessType)
  "HAS_FINDING",          // identity → EXCESSIVE_ACCESS/LATERAL_MOVEMENT finding
  "USES",                 // generic dependency
  "USES_TOOL",            // AI_AGENT → SERVERLESS / tool
  "INVOKES_TOOL",         // AI_AGENT → MCP_SERVER / AI_AGENT
  "USES_MODEL",           // AI_AGENT → AI_MODEL
  "USES_DATASET",         // AI_AGENT → AI_DATASET
  "STORED_IN",            // AI_DATASET → BUCKET
  "HOSTED_ON",            // hosted AI_AGENT → VIRTUAL_MACHINE / SERVERLESS
  "BUILT_FROM",           // AI_AGENT → CONTAINER_IMAGE → REPOSITORY
  "CAN_INVOKE",           // ACCESS_ROLE → AI_MODEL (Bedrock)
  "ENFORCES",             // AI_MODEL → AI_GUARDRAIL
  "BOUND_TO",             // ACCESS_ROLE_BINDING → identity
  "PERMITS_ACCESS_ROLE",  // ACCESS_ROLE_BINDING → ACCESS_ROLE
  "HAS_SENSITIVE_DATA",           // asset → SENSITIVE_DATA (holds sensitive data)
  "HAS_ACCESS_TO_SENSITIVE_DATA", // identity/agent → SENSITIVE_DATA (can reach it)
  "EXPOSED_TO_INTERNET",          // asset → INTERNET_EXPOSURE (reachable from the internet)
  "HAS_EXCESSIVE_PRIVILEGE",      // asset/identity → EXCESSIVE_PRIVILEGE (admin or high rights)
  // BUCKET/DATABASE → DATA_FINDING. Wiz's own vocabulary, not ours: the tenant capture in
  // exemples/toxic_combos_response.js echoes control wc-id-3217's query, whose "Sensitive
  // Data Access" block ends `-HAS_DATA_FINDING→ DATA_FINDING`.
  "HAS_DATA_FINDING",
  // AI asset / compute → ENDPOINT. Wiz's own relationship name, kept verbatim — it is what
  // the endpoint-exposure traversal walks (domain/exposureQuery.ts).
  "SERVES",
  // ---- lineage (domain/lineageQuery.ts) ----
  //
  // These three keep Wiz's own names rather than being mapped onto the model's older
  // vocabulary, and that is a deliberate reversal of what the five names above do.
  // `USES_DATASET`, `STORED_IN` and `USES_MODEL` were the obvious targets — all three are
  // declared here already and produced by nothing but sampleData.ts — but none of them is
  // the same fact. `READS_DATA_FROM` lands on AI_DATASET, BUCKET *or* DATABASE depending on
  // the leg, `USES_MODEL` means agent → model rather than pipeline → model, and `STORED_IN`
  // describes only the dataset-rooted half of `STORES_DATA_IN`. A name-to-name table would
  // be wrong exactly where the leg matters, which is the same reason graphExpand's
  // `expandEdgeId` does not translate either.
  "PRODUCES",         // AI_PIPELINE → AI_MODEL / AI_SERVICE (what the pipeline produces)
  "READS_DATA_FROM",  // AI_PIPELINE / AI_DATASET → AI_DATASET / BUCKET / DATABASE (ingest)
  "STORES_DATA_IN",   // AI_PIPELINE / AI_DATASET → BUCKET (where it writes)
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export type AccessType = "READ" | "WRITE" | "ADMIN" | "HIGH_PRIVILEGE";

/**
 * One project an asset belongs to — and an asset belongs to its WHOLE ancestor chain, not
 * just the leaf it sits in. The captured inventory shows one agent carrying
 * CE-DPCP-PORTAL (folder) -> VALUE-CHAIN (folder) -> provisioning-CE-DPCP-PORTAL (leaf).
 *
 * That is the fact the project switcher rests on: filtering by a FOLDER's id reaches every
 * asset beneath it, so "show me VALUE-CHAIN" is one id match per row rather than a tree walk.
 * It is also why the switcher keys on `id` while the older facet filters key on `name` —
 * names are not unique across a 1,056-project tenant and carry no ancestry.
 *
 * `isFolder` is tri-state. `undefined` means the row predates the field, which is every row
 * already in the ledger; it must not be read as `false`.
 */
export interface ProjectRef {
  id: string;
  name: string;
  isFolder?: boolean;
  businessImpact?: string;
}

export interface GNode {
  id: string;
  kind: NodeKind;
  name: string;
  nativeType?: string;
  cloudPlatform?: string;
  region?: string;
  status?: string;
  firstSeen?: string;
  lastSeen?: string;
  externalId?: string;
  // Exposure flags: true/false when Wiz determined them, null when exposure is
  // inherited from underlying compute and undetermined (hosted agents).
  isAccessibleFromInternet?: boolean | null;
  isOpenToAllInternet?: boolean | null;
  hasSensitiveData?: boolean;
  hasAccessToSensitiveData?: boolean;
  hasAdminPrivileges?: boolean;
  hasHighPrivileges?: boolean;
  // DSPM classification, on a datastore (BUCKET / DATABASE / DATABASE_SERVER) only.
  // `hasSensitiveData` says Wiz classified something here; these say how much and how bad.
  // Absent (not 0) when the sensitive-data traversal never ran or the tenant rejected it —
  // "no findings" and "never asked" must stay distinguishable.
  dataFindingCount?: number;
  dataFindingSeverities?: Record<string, number>; // severity → count
  // Guardrail-coverage scan result (PROTECTED_BY with negate:true): the protective
  // edge is ABSENT. A node flag, not a negated edge — there is no real guardrail
  // endpoint to point at; the client renders it as a dashed "no guardrail" stub.
  guardrailMissing?: boolean;
  /**
   * ENDPOINT rows only — the Wiz dynamic scanner's two verdicts, read from the response and
   * never stamped from a filter. That distinction is load-bearing: ENDPOINT nodes reach the
   * ledger from BOTH exposure steps, and only the endpoint one filtered on these values.
   * The host step returns an exposed workload's `applicationEndpoints` unfiltered, and in
   * the capture they come back rated `Low` — so trusting the query rather than the payload
   * would relabel a Low-rated endpoint as a validated exposure.
   * `isRatedExposure` (domain/exposureQuery.ts) is the one place they are judged.
   */
  exposureLevel?: string;   // exposureLevel_name — High | Medium | Low | None
  portValidation?: string;  // portValidationResult — Open | …
  /**
   * How internet reachability was established for this node beyond its own two flags.
   *
   * ABSENT means the exposure steps never ran (or reached nothing), never "not exposed" —
   * the same "clean" vs "never asked" split `dataFindingCount` keeps. Folded once at commit
   * by `withExposureEvidence`, because `mergeParts` overwrites scalars rather than
   * accumulating them and a per-page stamp would become whatever the last page saw.
   */
  exposureEvidence?: {
    /** Internet-reachable VIRTUAL_MACHINE / SERVERLESS nodes that RUN this asset. */
    hostIds?: string[];
    /** ENDPOINTs this asset serves (directly or via its host) that clear the rated bar. */
    endpointIds?: string[];
    /** Worst level across those endpoints, for the register column. */
    exposureLevel?: string;
    /** publicExposures[].portRange, deduped — e.g. ["80", "443"]. */
    ports?: string[];
    /** publicExposures[].sourceIpRange, deduped — e.g. ["0.0.0.0/0"]. */
    sourceIpRanges?: string[];
  };
  cloudAccount?: { id: string; name: string; externalId?: string; cloudProvider?: string };
  projects?: ProjectRef[];
  tags?: Array<{ key: string; value: string }>;
  /**
   * The business domain owning this resource — the value of its `Wiz/Domain` tag.
   *
   * READ-TIME ONLY. Never a column, never written by `assetToRow`, never read back from the
   * sheet. `graphEnrich.withDomains` folds it on every read from `tags` above, because the
   * tag key is configurable and a baked value would mean re-syncing a landscape to change a
   * string. See domain/domainTag.ts for the whole argument.
   */
  domain?: string | null;
  technologyCategories?: string[]; // Wiz technology.categories[].name (e.g. "AI Service")
  /**
   * Who published the AI asset, and how Wiz found it — both out of the properties bag, both
   * on AI assets rather than identities.
   *
   * `publisher` is frequently null in the real tenant (14 of the 20 agents in
   * exemples/get_ai_agents_reponse.js carry no publisher at all), so absent means "Wiz did not
   * report one", never "unpublished". `discoveryMethods` takes `MethodCloudScanning` or
   * `MethodWorkloadScanning` in that same capture; it is a list because the field is plural in
   * Wiz's schema even where the tenant only ever sends one.
   *
   * These reach the ledger from their own OPTIONAL sync step. The mandatory inventory query
   * cannot carry them: `properties` is an opaque map that cannot be sub-selected, so asking for
   * it there would drag in `snippet` — verbatim agent source code, and most of the 396 KB that
   * capture weighs — and would put the one step the whole app depends on at risk of rejection.
   */
  publisher?: string;
  discoveryMethods?: string[];
  // Agentic-identity enrichment (cloudResourcesV2 + identityPurpose:AGENTIC):
  identityPurpose?: string; // "AGENTIC" for agent execution identities
  /**
   * Identity rows only, both from the properties bag the agentic-identities step already asks
   * for. `displayName` is the human title an operator gave the account ("Vertex AI Agent
   * Service Account"); `name` is the resource path, which is the machine's answer to the same
   * question and unreadable in a table cell. Neither is derived from the other — a tenant that
   * left the display name blank gets an absent field, not a guess at one.
   */
  displayName?: string;
  email?: string;
  /**
   * Identity rows only. `inactiveInLast90Days` / `inactiveTimeframe` out of the properties
   * bag — Wiz's own dormancy read, from cloud audit events.
   *
   * Absent means the identity steps never carried it, never "in use". A dormant identity
   * holding admin access to an AI asset is the finding; a dormant one that reaches nothing is
   * housekeeping, so the flag is only ever interesting joined to `humanAccess` below.
   */
  inactive?: boolean;
  inactiveTimeframe?: string;   // e.g. "Active", "Inactive90Days"
  /**
   * Who can reach this AI asset, folded onto it at commit by `withHumanAccess`.
   *
   * HUMAN identities only (USER_ACCOUNT). An agent's own execution identity reaching it is
   * normal operation rather than a finding — the rule `withIdentityAccessNodes` already
   * applies to decide whether to draw a stub, applied once here so the register, the graph
   * and the Scans figure cannot disagree about it.
   *
   * Absent means IDENTITY_ACCESS reached nothing, never "nobody can reach this".
   */
  humanAccess?: {
    identityIds: string[];
    /** True when at least one of them holds ADMIN rather than merely HIGH_PRIVILEGE. */
    admin?: boolean;
    /** How many of them Wiz reports dormant — the join that makes the flag worth having. */
    inactiveCount?: number;
    /** How many carry an open no-MFA finding (IDENTITY_HYGIENE). */
    noMfaCount?: number;
    /** How many carry an open dormancy FINDING, which is Wiz's rule rather than its flag. */
    dormantFindingCount?: number;
    /**
     * Identities with EFFECTIVE access to this asset's data.
     *
     * A separate list from `identityIds` on purpose, and the separation is the design. That
     * one is the binding topology, whose vocabulary is ADMIN / HIGH_PRIVILEGE; this is
     * `entityEffectiveAccessEntries`, whose vocabulary is DATA. They are different axes that
     * share a word, and folding them into one list would produce a count nobody could caption
     * — see effectiveAccess.ts and the header of riskConditions.ts.
     */
    effectiveIds?: string[];
    /** Distinct permission strings across those entries — the "what they can do" evidence. */
    permissionCount?: number;
    /** The principal/resource policies granting it: the remediation target. */
    policyIds?: string[];
  };
  issueAnalytics?: {        // per-identity related-issue severity rollup (display-only)
    total: number;
    info: number;
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  // Enrichment, computed once at sync time and persisted:
  /**
   * Worst business-impact tier across this asset's OWN projects (HBI beats MBI beats LBI),
   * folded from `projects[].businessImpact` by `enrichGraphDoc` so the register and the
   * AARS Rules page can read one column instead of walking the project list on every row.
   *
   * Absent means Wiz reported NO business impact for any of the asset's projects — an
   * unattributed project, or an asset with no projects at all — and must NEVER be read as
   * "low impact": that would silently promote "nobody classified this" into a claim about
   * the asset's importance. The same "not reported vs not true" split `inactive` and
   * `dataFindingCount` already keep in this file. Display-only: AARS does not price it
   * (ai/AARS_ASSESSMENT.md §7), and the score-identity assertions in
   * scoreOrdinality.test.ts are what pin that this field never moves a score.
   */
  businessImpact?: string;
  severity?: Severity;      // worst attached open-issue severity (ISSUE nodes: own severity)
  /**
   * The two counts the register leads with, now that no derived verdict does: open issues
   * attached to this asset, and failing configuration findings evaluated against it
   * (`isOpenGap`, the app's single definition of a compliance gap).
   *
   * DERIVED ON READ, NEVER PERSISTED — the same contract the risk-topology nodes follow,
   * but for a different reason than theirs. A count IS a fact about one asset and would
   * survive being snapshotted; what it would not survive is the tabs moving underneath it.
   * Both populations live in their own tabs and change without `ai_assets` being rewritten
   * — a finding that resolves is an edit to `ai_findings` — so a stored copy here would go
   * stale exactly when someone had fixed something. `syncStore.withOpenCounts` attaches
   * them on every read path and nothing on the write path sets them.
   *
   * Absent on a node the fold never reached (ISSUE / SUMMARY / risk-topology stubs).
   * Zero means "counted, and there are none" — never "not counted".
   */
  openIssues?: number;
  openFindings?: number;
  aars?: number;            // findings score 0–100 (AI assets only) — see AARS_DISPLAY_LABEL
  aarsSeverity?: AarsSeverity;
  aarsPillars?: { toxic: number; compliance: number; data: number; exposure?: number };
  /**
   * What the score was computed FROM, minus the issue severities (those stay in the issues
   * tab and are read back from it). Persisted because the inputs are not otherwise
   * recoverable: a dry-run sync scores from hints pinned to ai/custom_score.md, and a live
   * sync from findings that may since have changed. Re-pricing these under a new rule is
   * what "recompute" means — re-deriving them would answer a different question.
   */
  /**
   * The AARS rule version that produced `aars` on THIS asset.
   *
   * Per-asset rather than one number for the register, because a rescore can be scoped to a
   * project: two assets can carry scores from two different rules at the same time, and a
   * score is only comparable to another computed under the same rule. `undefined` means the
   * row predates the column — unknown, never "the current rule".
   */
  aarsRuleVersion?: number;
  aarsInput?: {
    gaps: AarsGap[];
    dataExposure: DataExposure;
    /** Absent on rows persisted before pillar D existed; re-derived on the next enrich. */
    internetExposure?: InternetExposure;
    /**
     * The classified findings this asset can actually REACH, summed over every datastore
     * on its RUNS_AS → ALLOWS_ACCESS_TO path. Absent when the traversal never ran, which
     * is why the pillar-C knob prices an absent list as zero rather than as "no findings".
     */
    dataFindings?: Array<{ severity: string; count: number }>;
    /**
     * Fingerprint of the derivation knobs (`aars.derivationSignature`) this input was
     * computed under — what `syncStore.enrichFromTabs` checks before reusing a persisted
     * input on a rescore, so a `gapSources` change re-derives instead of silently reusing
     * gaps priced under the old rule.
     *
     * Absent means the row was written before this field existed. It is treated as
     * reusable rather than forced through a re-derivation — the same grandfather rule
     * `derivedUnder`'s sibling fields follow — so upgrading to this version never
     * re-scores a tenant's landscape on its own. A pinned dry-run hint
     * (`sampleData.SEED_AARS_HINTS`) carries no signature for the same reason it is never
     * stamped with one at enrich time: it was transcribed from ai/custom_score.md, not
     * derived by any rule, so no signature could honestly describe it.
     */
    derivedUnder?: string;
  };
  comboGroups?: string[];   // toxic-combination group ids this node participates in

  // ---- Phase 6: the Asset Posture Tier (posture.ts, postureRule.ts) ----
  //
  // A CAPABILITY ENVELOPE, NOT AN AGGREGATE OF `problemOutcome`s. Folded onto every real
  // asset node by `graphEnrich.withPostureTiers`, a fold SEPARATE from both `enrichGraphDoc`
  // (AARS) and `withProblemVerdicts` (the decision tree) — same independent-rerunnability
  // reason those two are separate from each other. See posture.ts's own header for why a
  // posture tier is deliberately not derived from what has been FOUND on the asset.
  /**
   * 1–4, 4 = worst. Absent for THREE distinct reasons, never one collapsed into another:
   * a synthetic node (ISSUE / SUMMARY) the fold never reached; a real node never enriched
   * at all; or a real node the fold DID reach and derive a vector for, but could not PLACE
   * on a numbered tier because at least one of capability/containment/consequence was
   * never observed for it — `posture.tierEstablished` says no, and `graphEnrich.
   * withPostureTiers` withholds the tier rather than deciding one from a defaulted axis.
   * That third case still carries `postureInput` (below) with a non-empty `unknowns`, so
   * "why no tier" is always answerable; only the first two leave `postureInput` absent too.
   */
  postureTier?: number;
  /**
   * What the tier was decided FROM — `PostureVector` plus which axes came back UNKNOWN.
   * Persisted for the same reason `aarsInput` is: a rule change can RE-DECIDE this exact
   * vector without re-deriving it (posture derivation is rule-independent — see
   * `derivePostureInput`'s own comment for why it therefore carries no `derivedUnder`
   * signature the way `problemInput` does).
   */
  postureInput?: { capability: string; containment: string; consequence: string; unknowns?: string[] };
  /**
   * The worst `problemOutcome` across this asset's own open issues and failing findings —
   * folded here from the Phase 4/5 verdicts, and read BESIDE `postureTier`, never blended
   * into it: the whole argument for a tier is that it is not a summary of problems. Absent
   * for an asset with no open issues or findings, which is a real state (`posture.ts`'s own
   * header: "zero open findings" is not "zero risk"), not an unscored placeholder.
   */
  worstOpenProblem?: string;

  // SUMMARY nodes only:
  summaryOf?: NodeKind;
  summaryCount?: number;
  memberIds?: string[];
}

export interface GEdge {
  id: string; // deterministic: edgeId(src, type, dst, negated)
  src: string;
  dst: string;
  type: EdgeType;
  negated?: boolean;   // PROTECTED_BY negate:true — the protective edge is ABSENT
  accessType?: AccessType;
}

export interface GraphDoc {
  nodes: GNode[];
  edges: GEdge[];
  syncedAt: string;
}

/** Deterministic edge identity — dedupe key across sync steps. */
export function edgeId(src: string, type: EdgeType, dst: string, negated?: boolean): string {
  return `${src}|${type}|${dst}${negated ? "|neg" : ""}`;
}

/** Open-issue row shape shared by the issues tab, fixtures, and enrichment. */
export interface IssueRow {
  id: string;
  ruleId: string;
  ruleName: string;
  comboGroup: string;          // ComboGroup.id; OTHER_GROUP_ID when no rule pattern matched
  nativeSeverity: Severity;
  adjustedSeverity: Severity;
  status: string;              // OPEN / RESOLVED / ...
  /**
   * The entity Wiz raised the issue on. NEVER rewritten by attribution — the register has to
   * keep naming what the console names, or a drill-down stops matching the tenant's own view.
   */
  assetId: string;
  /**
   * The AI assets this issue describes, which is not always the entity it was raised on.
   *
   * On the reference tenant 691 of 840 AI-category issues land on a SERVICE_ACCOUNT and only
   * 120 on an AI_AGENT — because the rule that fires most (`wc-id-2742`, 659 of them) is about
   * an identity's permission to invoke a model, not about the agent. The consequence was
   * measured and it is not subtle: only 22 of 99 in-scope issues resolved to a synced AI asset,
   * so `deriveProblemInput` was handed `node: undefined` for the other 77 and forced
   * `impact -> unknown` and `exposure -> UNVERIFIED` on every one of them. The measured
   * impact-unknown rate was exactly 77 of 99 — the same number — and row 7 of
   * DEFAULT_PROBLEM_RULE (`{exposure: UNVERIFIED} -> TRACK_STAR`) then decided 83 of 99.
   *
   * So "5 of 54 leaves occupied, one rule row decides 84% of the register" was never a cascade
   * that needed retuning. It was a join that was not being made.
   *
   * Includes the direct asset when THAT is AI-kinded, so a consumer can group on this field
   * alone rather than unioning it with `assetId`. Empty when the issue reaches no AI asset at
   * all, which is a real state and is counted (`kpis.issuesUnattributed`) rather than hidden.
   */
  attributedAssetIds?: string[];
  /**
   * How those ids were reached: `direct` when Wiz already named an AI asset, `RUNS_AS` when
   * the hop found one, `none` when it reached nothing. This is the audit trail — a score that
   * moved because of a traversal must be able to say which traversal.
   *
   * ABSENT is a fourth state and a different one: the fold never ran over this row at all (a
   * ledger synced before attribution existed). `none` says we looked; absent says we did not.
   */
  attributionHop?: "direct" | "RUNS_AS" | "none";
  /**
   * Where this row sits relative to the AI estate — `DIRECT` on an AI asset, `ADJACENT` one
   * edge away along `ADJACENCY_EDGE_TYPES`, `UNLINKED` neither. Set by `withAiAdjacency`.
   *
   * A WIDER QUESTION THAN `attributedAssetIds`, not a duplicate of it. Attribution walks one
   * edge type (`RUNS_AS`) and answers "which AI asset does this issue DESCRIBE"; adjacency
   * walks twelve and answers "is this row anywhere near the estate at all". A row can be
   * ADJACENT and attributed to nothing — reachable, but not about an AI asset.
   *
   * ABSENT means no adjacency pass ran, which is what a row synced before this existed
   * carries, and `rank.adjacencyOf` reads as unmeasured. `UNLINKED` is a measurement.
   */
  aiAdjacency?: AiAdjacency;
  /**
   * The edge type the adjacency came through, on an `ADJACENT` row only — the audit trail,
   * for the same reason `attributionHop` is one. Absent on `DIRECT` (the row is ON the asset,
   * no edge was walked) and on `UNLINKED` (no edge reached one).
   */
  adjacencyVia?: string;
  /**
   * The AI assets reached in that one hop, sorted so a re-run cannot reorder a persisted list
   * and look like a change. EMPTY on `DIRECT` as well as on `UNLINKED`: the AI asset a DIRECT
   * row sits on is `assetId` itself and is already on the row, and this field means "assets
   * one edge away" throughout rather than meaning two different things by state.
   */
  adjacentAssetIds?: string[];
  /**
   * The exploitation evidence folded onto this issue from the vulnerability findings that
   * NAME it (`domain/exploitation.ts`), and the three fields `rank.RankInput` already reads
   * under exactly these names — the vocabulary is matched deliberately so the ranker needs no
   * join and no translation layer between the ledger and the model.
   *
   * ALL THREE ABSENT IS A FOURTH STATE, and the load-bearing one: no evidence pass ran over
   * this register at all (VULN_FINDINGS refused, or a row synced before the step existed).
   * `rank.exploitationOf` prices an absent tier as `null` — the term drops out of the blend —
   * where `"none"` is a measurement that scores. A row that WAS looked at and joined no
   * exploited finding carries `tier: "none"`; one that joined a finding whose three signals
   * were all null carries `"unknown"`. Absent, none and unknown are three different claims
   * and nothing here may collapse them.
   *
   * `epssPeak` is the HIGHEST EPSS seen across the folded findings, never a mean: the question
   * the register answers is whether anything under this issue should have been prioritised.
   */
  exploitationTier?: ExploitationTier;
  epssPeak?: number | null;
  /** How many findings the tier was folded from — the reasons text, and the audit trail. */
  exploitationFindingCount?: number;
  assetName: string;
  /**
   * The risk categories this issue was FETCHED under — the register's own scope stamp.
   *
   * Wiz says nothing about it: `Issue` carries 51 fields and not one names a category, so
   * the only record of which question a row answers is which step asked it (see
   * domain/registerScope.ts). Widening the category list without this field would turn
   * "AI issues" into "issues" with no field able to catch it.
   *
   * More than one entry when an issue sits in several selected categories: it arrives once
   * per category and mergeParts unions the stamps. Absent only on a row written before the
   * column existed, which reads back as the AI category — the only scope those syncs ran.
   */
  categories?: string[];
  region?: string;
  account?: string;
  projects?: string[];
  /**
   * The SAME projects as `projects` above, as the objects Wiz returned rather than as names.
   *
   * Two fields for one fact, and the split is load-bearing in both directions. `projects`
   * stays the name list because the facets and the asset table read it and names are what an
   * operator recognises. This one exists because names are NOT the project switcher's key:
   * they are not unique across a thousand-project tenant and they carry no ancestry, so only
   * the id can answer "is this row inside VALUE-CHAIN" (see `ProjectRef`).
   *
   * The defect it fixes: the project view scoped issues by their ASSET alone, and an issue
   * raised on a VM, a container or an identity has no asset row at all — `kindFromWizType`
   * refuses those types, so no node is written. Every one of those issues disappeared under
   * any project view, silently, which is the worst shape a security register can take: a
   * filtered list that looks complete. The row's own attribution is the second way in.
   *
   * ABSENT is not empty. A row written before this column existed carries unknown refs, and
   * reading that as "belongs to no project" would assert something no sync ever measured;
   * an empty ARRAY is a live sync saying Wiz attributed this issue to nothing.
   */
  projectRefs?: ProjectRef[];
  frameworks?: {
    owaspLlm?: string[];
    owaspAgentic?: string[];
    owaspMl?: string[];
    fiveRs?: string[];
  };
  justification?: string;
  createdAt?: string;
  dueAt?: string;                    // issuesV2 dueAt (SLA deadline)
  resolutionRecommendation?: string; // sourceRule control recommendation (issuesV2)
  remediation?: string;              // config-finding remediation text (Phase 2)

  // ---- issuesV2 lifecycle and context (exemples/risk_issues_response.js)
  // All optional: a tenant or a query revision can omit any of them, so absent means
  // "not captured" and never "not true". Until 2026-08-23 the reason given here was the
  // per-rule Q_RULE_ASSETS fallback, which synthesised issues from the inventory API;
  // that path is gone and ai_issues is now exactly what issuesV2 returned.
  issueType?: string;                // TOXIC_COMBINATION | CLOUD_CONFIGURATION
  updatedAt?: string;
  resolvedAt?: string;
  resolutionReason?: string;
  resolvedBy?: string;               // user name/email, else service-account name
  assignee?: string;
  environments?: string[];
  validatedAsExploitable?: boolean;
  businessImpact?: string;           // worst of projects[].riskProfile.businessImpact
  entityStatus?: string;             // entitySnapshot.status — Active | Inactive
  subscriptionId?: string;
  /** The "Ignored (By Design) …" rationale, when one is on the note log. */
  ignoreNote?: string;
  /** rejectionExpiredAt — when an accepted-risk decision lapsed and reopened the issue. */
  ignoreExpiredAt?: string;
  ticketUrls?: string[];
  aiVerdict?: string;                // aiRemediationAnalysis.verdict, e.g. REMEDIATE
  aiRecommendedSeverity?: Severity;

  // ---- Phase 4: the Problem/Decision-Vector verdict (problem.ts, problemRule.ts) ----
  // All three absent on a resolved issue (isUnresolvedIssue false) — see
  // graphEnrich.withProblemVerdicts. Absent also means "not decided yet" for any row
  // synced before this phase, which is exactly what an absent read gives for free.
  /**
   * `Outcome` (ACT | ATTEND | TRACK_STAR | TRACK), stored as a bare string rather than the
   * union type: a ledger written by a NEWER version — a fifth outcome this version has
   * never heard of — must still parse and round-trip rather than fail the read.
   */
  problemOutcome?: string;
  /**
   * What the verdict was made FROM — the `DecisionVector` plus which axes came back
   * UNKNOWN, whether exposure was evidenced, and which door exploitation came through
   * (`problem.ProblemVerdictInput`). Persisted for the same reason `aarsInput` is: it is
   * what lets a rule change RE-DECIDE exactly these facts rather than re-derive a possibly
   * different set, and it is what makes a whole-landscape preview cost zero Wiz calls.
   */
  problemInput?: ProblemVerdictInput;
  /** The `problem_rule` version (settingsLogic.getProblemRule) this verdict was decided under. */
  problemRuleVersion?: number;
}

/**
 * A compliance-configuration finding (configurationFindings), keyed to the resource it
 * was evaluated against. Feeds AARS pillar B (one gap per distinct failing control),
 * carries the human remediation text, and backs the Cloud Configuration register.
 * `frameworkCodes` are the AARS gap codes the finding contributes (rule shortId + any
 * recognizable OWASP token on the rule).
 *
 * NOT every row is a gap. The register stores whatever the filter returns — including
 * RESOLVED rows, which come back with `result: "PASS"` — and `isOpenGap` in
 * domain/config.ts is the single place that decides which of them count as a failing
 * control. Anything that prices a score or reports a number goes through that predicate;
 * reading `severity` off a row without it counts findings that already closed.
 *
 * The first six fields are the original record and keep their exact meaning, so a row
 * written before the widening still parses.
 */
export interface FindingRow {
  id: string;
  resourceId: string;
  ruleShortId: string;
  severity: Severity;
  remediation?: string;
  frameworkCodes: string[];

  /** Lifecycle. Wiz sends NO resolvedAt on a configuration finding — `firstSeenAt` plus
   *  this app's sync history is the only way to date a closure. */
  name?: string;
  status?: string;          // OPEN | RESOLVED | REJECTED
  result?: string;          // PASS | FAIL | ERROR | NOT_ASSESSED
  deleted?: boolean;
  firstSeenAt?: string;
  analyzedAt?: string;      // last evaluation, not last change

  /** The control. One rule fails on many resources, which is why the register rolls up
   *  by `ruleShortId` before it lists rows. */
  ruleId?: string;
  ruleGraphId?: string;
  ruleName?: string;
  ruleDescription?: string;
  remediationInstructions?: string;  // the rule's template, with {{placeholders}}
  opaPolicy?: string;                // the Rego the evaluation actually ran
  risks?: string[];
  threats?: string[];

  /** The resource it was evaluated against. `resourceType` is a raw Wiz type such as
   *  REGION or RAW_ACCESS_POLICY — deliberately NOT a NodeKind, because most of these
   *  types are not in the graph at all and forcing them through kindFromWizType would
   *  drop the row. */
  resourceName?: string;
  resourceType?: string;
  resourceStatus?: string;
  targetExternalId?: string;
  source?: string;                   // e.g. WIZ_CSPM

  subscriptionId?: string;
  subscriptionName?: string;
  cloudProvider?: string;
  projects?: ProjectRef[];
  businessImpact?: string;           // worst of projects[].riskProfile.businessImpact

  /** An accepted-risk decision covering this finding. Present ids mean the tenant chose
   *  to ignore it, which the register shows rather than silently counting. */
  ignoreRuleIds?: string[];
  /** sourceMappedIacFindings — the IaC that produced the misconfiguration, when Wiz
   *  traced one. The finding's link back to the code that caused it. */
  iacFindingIds?: string[];

  // ---- Phase 4: the Problem/Decision-Vector verdict — see IssueRow's own block above for
  // the full doc comment; identical shape and identical reasoning, gated on `isOpenGap`
  // rather than `isUnresolvedIssue` (graphEnrich.withProblemVerdicts).
  problemOutcome?: string;
  problemInput?: ProblemVerdictInput;
  problemRuleVersion?: number;
}

/**
 * One DSPM data finding — Wiz classified something in a datastore — keyed to that store.
 *
 * Deliberately NOT a FindingRow and deliberately not in the `ai_findings` tab. That tab
 * holds failing compliance CONTROLS: it feeds AARS pillar B and `kpis.complianceGaps`, and
 * a classification finding mixed in would inflate both while claiming a control failed
 * that never ran. Two kinds of "finding" that price differently need two stores.
 *
 * The graph draws the aggregate (`DATA_FINDING`, one per store); these rows exist so the
 * store's detail sheet can name what is actually in it.
 */
export interface DataFindingRow {
  id: string;
  resourceId: string;
  name: string;
  severity: Severity;
}

/**
 * Why a posture cell is empty. Wiz's own reasons, carried through verbatim.
 *
 * This exists so a null posture can never be read as a zero. "Nothing failed because
 * nothing was assessed" and "everything assessed failed" are opposite facts that both
 * arrive as an absent percentage, and PRODUCT.md's Honest-State principle makes telling
 * them apart load-bearing rather than a nicety. `null` here means a real posture exists.
 */
export type EmptyPostureReason = "NO_RESOURCES" | "NO_POLICIES" | string;

/** Which level of the framework tree a posture row describes. */
export type PostureLevel = "framework" | "category" | "subcategory";

/**
 * One node of the compliance tree, flattened. `level` discriminates; the external ids
 * rebuild the hierarchy (a category row carries only `categoryExternalId`, a subcategory
 * row carries both).
 *
 * `posturePct` is Wiz's `averageCompliancePosture` / `compliancePosture` stored as sent —
 * never recomputed. It is null exactly when `emptyPostureReason` is set.
 */
export interface PostureRow {
  frameworkId: string;
  level: PostureLevel;
  categoryExternalId?: string;
  subcategoryExternalId?: string;
  /** The Wiz object id (wf-id-… / wct-id-… / wsct-id-…). */
  nodeId?: string;
  title: string;
  description?: string;
  posturePct: number | null;
  passCount: number;
  failCount: number;
  passSubCategoryCount?: number;
  failSubCategoryCount?: number;
  emptyPostureReason: EmptyPostureReason | null;
  assessmentScope?: string;
  mappingRationale?: string;
  tags?: { key: string; value: string }[];
}

/** Which of the three mutually exclusive policy shapes a policyAnalytics row carried. */
export type PolicyKind = "CONTROL" | "CLOUD_RULE" | "HOST_RULE";

/**
 * One (framework, subcategory, policy) edge — the many-to-many mapping, as a row.
 *
 * The same policy appears under several subcategories (a prompt-injection control maps to
 * ASI01, ASI02 and ASI10 in the sample tenant), so a table keyed by `policyId` alone would
 * silently collapse three facts into one. Policy metadata therefore repeats across rows;
 * that is the intended trade, and it is what makes the join cheap: `policyId` / `shortId`
 * are the SAME identifiers `FindingRow.ruleId` / `ruleShortId` carry, so a failing finding
 * can be labelled with the framework codes it actually violates instead of the ones a
 * regex happened to find in a tag.
 */
export interface FrameworkPolicyRow {
  frameworkId: string;
  categoryExternalId: string;
  subcategoryExternalId: string;
  policyId: string;
  policyKind: PolicyKind;
  shortId?: string;
  name: string;
  severity: Severity;
  enabled?: boolean;
  builtin?: boolean;
  /** Wiz sends null for "none", which is not the same as 0 for a policy it never ran. */
  passCount: number;
  failCount: number;
  assessedCount: number;
  rejectedCount: number;
  noResourceToAssess: boolean;
  targetNativeType?: string;
  subjectEntityType?: string;
  cloudProvider?: string;
  hasAutoRemediation?: boolean;
}

/** One row of the framework catalogue — what the tenant has, for the Settings picker. */
export interface FrameworkRow {
  id: string;
  name: string;
  description?: string;
  builtin: boolean;
  enabled: boolean;
  policyTypes: string[];
  /** Whether this app syncs posture for it. Resolved from settings, not from Wiz. */
  selected: boolean;
}

/**
 * One rule from Wiz's cloud-configuration rule catalogue — the vocabulary, not a finding.
 *
 * REFERENCE DATA, and the distinction is the whole reason it has its own tab and its own
 * refresh gate: a rule exists whether or not this tenant has a resource it applies to. The
 * catalogue changes when Wiz ships rules; the findings change when the landscape moves.
 *
 * It answers two questions nothing else could. `shortId → name` is the gloss for a code that
 * otherwise reaches the AARS cascade opaque — codebook.js says so in its own header, and
 * `SUB-082` is priced today with no way to render what it means. And `subjectEntityType` is
 * the rule's OWN declaration of what it is evaluated against, which is a cleaner source for
 * the Cloud Configuration page's "most of these are not on an AI asset" claim than inferring
 * it per finding.
 */
export interface ConfigRuleRow {
  id: string;
  shortId: string;
  name: string;
  /** REGION, USER_ACCOUNT, DB_SERVER, IAC_BACKEND … a raw Wiz type, never a NodeKind. */
  subjectEntityType?: string;
  /** externalReferences[].id — CIS / AVD / CKV / Prisma cross-walk ids. */
  externalRefs: string[];
}

/**
 * A configuration finding on a HUMAN IDENTITY — no MFA, dormant, stale credentials.
 *
 * Deliberately NOT a `FindingRow` and deliberately not in the `ai_findings` tab, for the
 * reason `DataFindingRow` gives one type up. That tab prices AARS pillar B through
 * `buildAarsHintsFromFindings`, which keys its hints by `resourceId` — and a `USER_ACCOUNT`
 * IS a row in `ai_assets`, reached by the identity-access traversal. Folding these in would
 * make `enrichGraphDoc`'s `scorable` test true for a person and put an AI Asset Risk Score on
 * a human being.
 *
 * `hygiene` is stamped from the matcher that resolved the rule, not read from the response —
 * Wiz has no such concept. It is what makes the join countable without re-matching rule names
 * at every read.
 */
export interface IdentityFindingRow {
  id: string;
  /** The identity the rule was evaluated against. */
  resourceId: string;
  resourceName?: string;
  ruleId?: string;
  ruleShortId: string;
  ruleName?: string;
  severity: Severity;
  status?: string;
  result?: string;
  firstSeenAt?: string;
  analyzedAt?: string;
  remediation?: string;
  hygiene: HygieneKind;
}

/** What an identity-hygiene rule is about. Stamped by the matcher, never returned by Wiz. */
export type HygieneKind = "MFA" | "DORMANT";

/** One row of the project switcher's list: a project, and how much of the register it holds. */
export interface ProjectCatalogueEntry {
  id: string;
  name: string;
  isFolder?: boolean;
  /** Assets in the CURRENT register carrying this project. Not a Wiz-side total. */
  assets: number;
}

/**
 * The distinct projects the synced assets belong to, folders first, then by name.
 *
 * Derived from the register rather than from a live `projects` catalogue query, and that is
 * the property worth keeping: this list can only offer a project there IS data for, so the
 * switcher cannot render a never-synced project as an empty one. A project outside the fetch
 * scope is absent from the picker rather than present and answering zero — which is the same
 * "absent is not zero" rule the rest of this app is built on, applied to a control.
 *
 * `isFolder` merges first-non-undefined-wins. Every row already in the ledger predates the
 * field, and one such row must not erase what a freshly synced row knows; `undefined` stays
 * `undefined` only when nothing has ever said otherwise.
 */
export function projectCatalogue(assets: readonly GNode[]): ProjectCatalogueEntry[] {
  const byId = new Map<string, ProjectCatalogueEntry>();
  for (const a of assets) {
    for (const p of a.projects ?? []) {
      const seen = byId.get(p.id);
      if (!seen) {
        byId.set(p.id, { id: p.id, name: p.name, isFolder: p.isFolder, assets: 1 });
        continue;
      }
      seen.assets += 1;
      if (seen.isFolder === undefined && p.isFolder !== undefined) seen.isFolder = p.isFolder;
    }
  }
  return [...byId.values()].sort((x, y) =>
    x.isFolder === y.isFolder ? x.name.localeCompare(y.name) : (x.isFolder ? -1 : 1));
}

export interface DomainCatalogueEntry {
  /** The tag's value as the tenant wrote it. There is no id — a domain IS its name. */
  name: string;
  /** Assets in the CURRENT register carrying this domain. Not a Wiz-side total. */
  assets: number;
}

/**
 * The distinct domains the synced assets carry, by name.
 *
 * The sibling of `projectCatalogue` above, and derived from the register for the same reason:
 * a list built this way can only offer a domain there IS data for, so the switcher cannot
 * render a domain nobody tagged as an empty one.
 *
 * NO UNTAGGED BUCKET, deliberately. An untagged resource has a blank domain and contributes
 * nothing to a facet, exactly as a blank cloud or region already does (`domainTag.ts` states
 * the rule); a synthetic "no domain" row here would be a scope whose population is "the
 * assets we know least about", offered as though it were an owner. Absence is reported as
 * `domainCoverage` instead — a count, which can tell "nobody tagged any" from "we never
 * successfully asked", where a sentinel row could tell neither.
 *
 * Flat, and never nested under a project. A project spans domains in the seeded landscape by
 * construction, so a tree here would assert a hierarchy the data does not have.
 */
export function domainCatalogue(assets: readonly GNode[]): DomainCatalogueEntry[] {
  const byName = new Map<string, DomainCatalogueEntry>();
  for (const a of assets) {
    const name = a.domain;
    if (!name) continue;
    const seen = byName.get(name);
    if (seen) seen.assets += 1;
    else byName.set(name, { name, assets: 1 });
  }
  return [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * One `vulnerabilityFindings` row, normalized — the raw exploitation observation before it is
 * folded onto an issue (`domain/exploitation.ts`).
 *
 * NOT A LEDGER ROW. Nothing writes these to a tab: 7,368 of them fold into at most a few
 * thousand `ExploitationRow`s, and the finding itself belongs to the OS-vulnerability register
 * that already owns that population. What survives the sync is the fold.
 *
 * THE THREE SIGNALS ARE TRI-STATE and stay that way from here to the sheet. Wiz answers `null`
 * for a flag it never evaluated, and collapsing that to `false` is what makes an unassessed
 * finding read as a clean one — the same failure `measurability.ts` exists to prevent one
 * register over. `triBool` / `triNum` in the normalizer are the only things allowed to produce
 * these values.
 */
export interface NormalizedVulnFinding {
  id: string;
  name?: string;
  status?: string;
  severity?: string;
  /** `null` = Wiz never evaluated it. Never `false` by default. */
  hasKev: boolean | null;
  /** `null` = Wiz never evaluated it. Never `false` by default. */
  hasExploit: boolean | null;
  /** `null` = no EPSS score was captured. Never `0` by default. */
  epss: number | null;
  epssPercentile?: number | null;
  epssSeverity?: string;
  firstDetectedAt?: string;
  resolvedAt?: string;
  /**
   * The issues this finding names, from whichever shape the tenant's schema uses — see
   * `relatedIssueIdsOf`. EMPTY is a real reading and is counted (`unjoined`): the filter asked
   * for `hasRelatedIssue: true`, so a row arriving with no id is the join field being absent
   * or differently shaped, which is a finding about the query rather than about the estate.
   */
  issueIds: string[];
  /** The vulnerable asset, when the union member carried an id. Absent is not empty. */
  assetId?: string;
  assetType?: string;
  assetName?: string;
}
