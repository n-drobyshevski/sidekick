// Per-agent graph expansion: one spec tree, from which BOTH the graphSearch traversal and
// the decoder for its response are derived.
//
// WHY ONE TREE. A graphSearch row returns `entities`, a POSITIONAL array: a depth-first
// pre-order walk of every `select: true` node in the query, padded with a literal `null`
// wherever an `optional` leg found no match. The capture in
// exemples/ai_agent_expand_response.js proves it — 43 slots, 4 real entities, 39 nulls,
// and the non-null ones land exactly where the query's pre-order puts them:
//
//   0  root AI_AGENT                                    the agent
//   1  ACTING_AS -> PRINCIPAL                            a SERVICE_ACCOUNT (concrete subtype)
//   2    CONTAINS -> EXCESSIVE_ACCESS_FINDING            the finding
//   3-6 READS_DATA_FROM subtree (4 selects)              null x4
//   7  STORES_DATA_IN -> BUCKET                          the staging bucket
//   8    HAS_DATA_FINDING -> DATA_FINDING                null
//
// The rest of this tree reads that array by TYPE, not by position — syncNormalize's
// `entities.find(e => e.kind === "AI_AGENT")`. That is sound for the sync battery, where
// every step is a 2-4 hop chain in which each type appears at most once. It is unusable
// here: this traversal contains SERVICE_ACCOUNT in 3 distinct subtrees, DATA_RESOURCE in 3,
// DATA_FINDING in 4, PRINCIPAL in 3, ENDPOINT in 3, AI_MODEL in 3 and AI_AGENT twice (the
// root, and again through USES -> AI_TOOL -> INVOKES). A `.find()` would bind a nested
// tool's identity to the root agent and hang a store's finding off the wrong store — wrong
// edges, silently, with no error to notice.
//
// Decoding by position is only safe if the query and the decoder cannot drift apart. Hence
// one literal: `toGraphEntityQuery` renders it into the $query variable, `flattenSlots`
// renders it into the slot list, and a test pins the slot count against the real capture.

import { type Rec } from "./util";
import { kindFromWizType } from "./graphTypes";

/**
 * One node in the traversal. `select` defaults to TRUE — the common case in the capture,
 * where only the two intermediate IAM_BINDINGs opt out. `edge` describes the relationship
 * from the PARENT to this node, which is what makes an edge reconstructible from a slot.
 */
export interface SelectSpec {
  type: string | string[];
  select?: boolean;
  optional?: boolean;
  negate?: boolean;
  where?: Rec;
  edge?: { type: string; reverse?: boolean };
  relationships?: SelectSpec[];
}

/**
 * One position in the response's `entities` array.
 *
 * `parentIndex` points at the nearest SELECTED ancestor, not the structural parent: a
 * `select: false` node consumes no slot, so its children attach to whatever selected node
 * sits above it. Q_IDENTITY_ACCESS already has that shape (ACCESS_ROLE_BINDING is
 * select:false with two selected children), and this traversal has it twice — the
 * IAM_BINDING under each ENTITLES leg.
 */
export interface Slot {
  index: number;
  parentIndex: number | null;
  types: string[];
  edgeType?: string;
  reverse?: boolean;
}

function typeList(t: string | string[]): string[] {
  return Array.isArray(t) ? t : [t];
}

function isSelected(spec: SelectSpec): boolean {
  return spec.select !== false;
}

// --------------------------------------------------------------- the traversal itself

/**
 * The per-agent expansion, transcribed verbatim from the Wiz console capture
 * (exemples/ai_agent_expand_request.js): ten top-level relationship subtrees, 43 selected
 * nodes. Kept whole rather than pruned to the kinds this app models, so the slot arity
 * matches what the tenant actually returns — a pruned traversal would be a different
 * query and the capture would stop being evidence for it.
 *
 * Every leg is optional. That is the console's choice and it is the right one: an agent
 * with no guardrail, no MCP server and no k8s deployment must still return its identity
 * and data legs rather than matching nothing at all.
 */
export const AGENT_EXPANSION: SelectSpec = {
  type: "AI_AGENT",
  relationships: [
    // 1. Execution identity and its CIEM findings.
    {
      type: "PRINCIPAL",
      optional: true,
      edge: { type: "ACTING_AS" },
      relationships: [
        {
          type: "EXCESSIVE_ACCESS_FINDING",
          optional: true,
          edge: { type: "CONTAINS" },
        },
      ],
    },
    // 2. Data the agent reads, and what has been classified in it.
    {
      type: ["AI_DATASET", "BUCKET"],
      optional: true,
      edge: { type: "READS_DATA_FROM" },
      relationships: [
        {
          type: ["BUCKET", "DATABASE"],
          optional: true,
          edge: { type: "READS_DATA_FROM" },
          relationships: [
            { type: "DATA_FINDING", optional: true, edge: { type: "HAS_DATA_FINDING" } },
          ],
        },
        { type: "DATA_FINDING", optional: true, edge: { type: "HAS_DATA_FINDING" } },
      ],
    },
    // 3. Data the agent writes.
    {
      type: "BUCKET",
      optional: true,
      edge: { type: "STORES_DATA_IN" },
      relationships: [
        { type: "DATA_FINDING", optional: true, edge: { type: "HAS_DATA_FINDING" } },
      ],
    },
    // 4. Tooling: the tool, whatever runs it, that runner's identity and reachable data,
    //    and any agent the tool invokes in turn. The INVOKES leg is the agent-to-agent
    //    trust chain ai/ai_agents_discovery_queries.md names as unmodeled.
    {
      type: "AI_TOOL",
      optional: true,
      edge: { type: "USES" },
      relationships: [
        {
          type: ["SERVERLESS", "WEB_SERVICE"],
          optional: true,
          edge: { type: "RUNS", reverse: true },
          relationships: [
            {
              type: "SERVICE_ACCOUNT",
              optional: true,
              edge: { type: "ACTING_AS" },
              relationships: [
                {
                  // Not selected: the binding is the mechanism, the resource is the point.
                  type: "IAM_BINDING",
                  select: false,
                  optional: true,
                  edge: { type: "ENTITLES", reverse: true },
                  where: { accessTypes: { EQUALS: ["Data"] } },
                  relationships: [
                    {
                      type: "DATA_RESOURCE",
                      optional: true,
                      edge: { type: "ALLOWS_ACCESS_TO" },
                      where: {
                        _or: [
                          { publicAccessTypes: { IS_SET: false } },
                          { publicAccessTypes: { LIST_DOES_NOT_CONTAIN_ANY: ["Data"] } },
                        ],
                        hasSensitiveData: { EQUALS: true },
                      },
                      relationships: [
                        {
                          type: "DATA_FINDING",
                          optional: true,
                          edge: { type: "HAS_DATA_FINDING" },
                          where: {
                            severity: {
                              EQUALS: [
                                "DataFindingSeverityCritical",
                                "DataFindingSeverityHigh",
                              ],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            { type: "PRINCIPAL", optional: true, edge: { type: "ACTING_AS" } },
            { type: "AI_AGENT", optional: true, edge: { type: "INVOKES" } },
          ],
        },
      ],
    },
    // 5. Models and services, their guardrails, endpoints, identities, and the pipeline
    //    that produced them.
    {
      type: ["AI_MODEL", "AI_SERVICE"],
      optional: true,
      edge: { type: "USES" },
      relationships: [
        {
          type: "AI_MODEL",
          optional: true,
          edge: { type: "USES" },
          relationships: [
            {
              type: "AI_GUARDRAIL",
              optional: true,
              edge: { type: "PROTECTS", reverse: true },
            },
            { type: "ENDPOINT", optional: true, edge: { type: "SERVES" } },
            {
              type: "PRINCIPAL",
              optional: true,
              edge: { type: "ACTING_AS" },
              relationships: [
                {
                  type: "EXCESSIVE_ACCESS_FINDING",
                  optional: true,
                  edge: { type: "ALERTED_ON", reverse: true },
                },
              ],
            },
          ],
        },
        {
          type: "AI_PIPELINE",
          optional: true,
          edge: { type: "PRODUCES", reverse: true },
          relationships: [
            { type: "AI_MODEL", optional: true, edge: { type: "USES" } },
            {
              type: ["AI_DATASET", "BUCKET"],
              optional: true,
              edge: { type: "READS_DATA_FROM" },
              relationships: [
                {
                  type: ["BUCKET", "DATABASE"],
                  optional: true,
                  edge: { type: "READS_DATA_FROM" },
                },
              ],
            },
          ],
        },
      ],
    },
    // 6. The agent's own guardrail and its misconfigurations.
    {
      type: "AI_GUARDRAIL",
      optional: true,
      edge: { type: "PROTECTS", reverse: true },
      relationships: [
        {
          type: "CONFIGURATION_FINDING",
          optional: true,
          edge: { type: "ALERTED_ON", reverse: true },
        },
      ],
    },
    // 7. Network reachability.
    { type: "ENDPOINT", optional: true, edge: { type: "SERVES" } },
    // 8. The agent's own configuration findings.
    {
      type: "CONFIGURATION_FINDING",
      optional: true,
      edge: { type: "ALERTED_ON", reverse: true },
    },
    // 9. Compute the agent runs on, that compute's identity and reachable data, and the
    //    kubernetes chain up to the cluster's own identity.
    {
      type: ["VIRTUAL_MACHINE", "SERVERLESS", "CONTAINER_IMAGE"],
      optional: true,
      edge: { type: "RUNS", reverse: true },
      relationships: [
        { type: "ENDPOINT", optional: true, edge: { type: "SERVES" } },
        {
          type: "SERVICE_ACCOUNT",
          optional: true,
          edge: { type: "ACTING_AS" },
          relationships: [
            {
              type: "IAM_BINDING",
              select: false,
              optional: true,
              edge: { type: "ENTITLES", reverse: true },
              where: { accessTypes: { EQUALS: ["Data"] } },
              relationships: [
                {
                  type: "DATA_RESOURCE",
                  optional: true,
                  edge: { type: "ALLOWS_ACCESS_TO" },
                  where: {
                    _or: [
                      { publicAccessTypes: { IS_SET: false } },
                      { publicAccessTypes: { LIST_DOES_NOT_CONTAIN_ANY: ["Data"] } },
                    ],
                    hasSensitiveData: { EQUALS: true },
                  },
                  relationships: [
                    {
                      type: "DATA_FINDING",
                      optional: true,
                      edge: { type: "HAS_DATA_FINDING" },
                      where: {
                        severity: {
                          EQUALS: [
                            "DataFindingSeverityCritical",
                            "DataFindingSeverityHigh",
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "CONTAINER",
          optional: true,
          edge: { type: "INSTANCE_OF", reverse: true },
          relationships: [
            {
              type: "DEPLOYMENT",
              optional: true,
              edge: { type: "CONTAINS", reverse: true },
              relationships: [
                {
                  type: "KUBERNETES_CLUSTER",
                  optional: true,
                  edge: { type: "CONTAINS", reverse: true },
                  relationships: [
                    {
                      type: "SERVICE_ACCOUNT",
                      optional: true,
                      edge: { type: "ACTING_AS" },
                      relationships: [
                        {
                          // Selected here, unlike the two above it. The console's own
                          // asymmetry, kept: dropping it would shift every later slot.
                          type: "IAM_BINDING",
                          optional: true,
                          edge: { type: "ENTITLES", reverse: true },
                          relationships: [
                            {
                              type: "DATA_RESOURCE",
                              optional: true,
                              edge: { type: "ALLOWS_ACCESS_TO" },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    // 10. MCP servers and the tools they expose.
    {
      type: "MCP_SERVER",
      optional: true,
      edge: { type: "USES" },
      relationships: [
        { type: "AI_TOOL", optional: true, edge: { type: "EXPOSES" } },
      ],
    },
  ],
};

// ------------------------------------------------------------------- query generation

/**
 * The spec tree as a GraphEntityQueryInput value, for the $query variable.
 *
 * Passed as a VARIABLE, not string-built into the document: pinning the vertex id into
 * document text would give the gateway a distinct query per agent (defeating its query
 * cache) and would splice caller input into GraphQL source. wizQueriesAi.ts:72 records the
 * same conclusion reached the other way round — inline filter literals proved fragile
 * against this tenant's gateway, and the working capture passes the filter as a variable.
 */
export function toGraphEntityQuery(spec: SelectSpec, vertexId?: string): Rec {
  const out: Rec = { type: typeList(spec.type) };
  if (isSelected(spec)) out["select"] = true;
  const where = vertexId ? { _vertexID: { EQUALS: vertexId } } : spec.where;
  if (where) out["where"] = where;
  const rels = spec.relationships ?? [];
  if (rels.length) {
    out["relationships"] = rels.map((child) => {
      const edge = child.edge ?? { type: "RELATED_TO" };
      const rel: Rec = {
        type: [edge.reverse ? { type: edge.type, reverse: true } : { type: edge.type }],
        with: toGraphEntityQuery(child),
      };
      if (child.optional) rel["optional"] = true;
      if (child.negate) rel["negate"] = true;
      return rel;
    });
  }
  return out;
}

/**
 * The spec tree flattened into the positional slot list the response aligns to.
 *
 * Depth-first, pre-order, emitting a slot only for selected nodes but descending through
 * unselected ones so their children keep their place in the walk.
 */
export function flattenSlots(spec: SelectSpec): Slot[] {
  const slots: Slot[] = [];

  function walk(node: SelectSpec, parentIndex: number | null): void {
    let ownIndex = parentIndex;
    if (isSelected(node)) {
      ownIndex = slots.length;
      slots.push({
        index: ownIndex,
        parentIndex,
        types: typeList(node.type),
        edgeType: node.edge?.type,
        reverse: node.edge?.reverse,
      });
    }
    for (const child of node.relationships ?? []) walk(child, ownIndex);
  }

  walk(spec, null);
  return slots;
}

// -------------------------------------------------------------------------- decoding

export interface ExpandedNode extends Rec {
  id: string;
  name: string;
  kind: string;
  /** True when Wiz returned a type NODE_KINDS does not declare — see decodeExpansion. */
  unmodeled: boolean;
}

export interface ExpandedEdge extends Rec {
  id: string;
  src: string;
  dst: string;
  type: string;
}

export interface ExpandResult {
  nodes: ExpandedNode[];
  edges: ExpandedEdge[];
  /** Rows whose entity count did not match the slot count, and were therefore skipped. */
  arityMismatches: number;
  rowsDecoded: number;
}

/**
 * Mirrors graphTypes.edgeId's format so the two id spaces stay comparable, but takes a raw
 * Wiz relationship name rather than an EdgeType.
 *
 * The relationship vocabulary here is Wiz's own — ACTING_AS, ALERTED_ON, ENTITLES, SERVES,
 * EXPOSES — and only four of the twelve names in this traversal appear in EDGE_TYPES. They
 * are deliberately NOT translated into the model's vocabulary: the obvious mappings
 * (ACTING_AS -> RUNS_AS, PROTECTS -> PROTECTED_BY) are fine, but CONTAINS means
 * "principal holds finding" in one subtree and "cluster holds deployment" in another, so a
 * name-to-name table would be wrong exactly where it mattered. edgeLabel already falls back
 * to the raw enum for unknown types (client/js/icons.js), so the sheet renders them as-is.
 */
function expandEdgeId(src: string, type: string, dst: string): string {
  return `${src}|${type}|${dst}`;
}

function str(v: unknown): string | undefined {
  return v === null || v === undefined || v === "" ? undefined : String(v);
}

function triBool(v: unknown): boolean | null {
  return v === true ? true : v === false ? false : null;
}

/**
 * One raw graphSearch entity into the row shape the detail sheet already renders
 * (api.assetRow's keys), without routing through normalizeCloudResource.
 *
 * Bypassing it is the point. normalizeCloudResource drops any entity whose type is not in
 * NODE_KINDS, and this traversal returns seven kinds the model does not declare — ENDPOINT,
 * CONFIGURATION_FINDING, IAM_BINDING, CONTAINER, DEPLOYMENT, KUBERNETES_CLUSTER,
 * WEB_SERVICE. Adding them to NODE_KINDS would admit them into the sync and persistence
 * path too, and that list's declaration order is load-bearing for the grouped layout. So an
 * unmodeled kind keeps its raw Wiz type and is flagged; the client already degrades for it
 * (kindIcon falls back to the SUMMARY glyph, categoryOf to "asset").
 */
function toExpandedNode(raw: Rec): ExpandedNode | null {
  const id = str(raw["id"]);
  if (!id) return null;
  const rawType = str(raw["type"]);
  const known = kindFromWizType(rawType);
  const projects = Array.isArray(raw["projects"])
    ? (raw["projects"] as Rec[]).map((p) => str(p?.["name"]) ?? "").filter(Boolean)
    : [];
  return {
    id,
    name: str(raw["name"]) ?? id,
    kind: known ?? (rawType ? rawType.toUpperCase().replace(/[^A-Z0-9]+/g, "_") : "UNKNOWN"),
    unmodeled: !known,
    nativeType: str(raw["nativeType"]) ?? null,
    cloud: str(raw["cloudPlatform"]) ?? null,
    region: str(raw["region"]) ?? null,
    status: str(raw["status"]) ?? null,
    firstSeen: str(raw["firstSeen"]) ?? null,
    lastSeen: str(raw["lastSeen"]) ?? null,
    externalId: str(raw["externalId"]) ?? null,
    projects,
    // DataFinding is the one entity here carrying its own severity; everything else is
    // inventory and gets its severity from the register, which this path does not touch.
    severity: str(raw["severity"]) ?? null,
    internet: triBool(raw["isAccessibleFromInternet"]),
    openInternet: triBool(raw["isOpenToAllInternet"]),
    sensitiveData: raw["hasSensitiveData"] === true,
    sensitiveAccess: raw["hasAccessToSensitiveData"] === true,
    highPriv: raw["hasHighPrivileges"] === true,
    adminPriv: raw["hasAdminPrivileges"] === true,
  };
}

/**
 * Decode graphSearch rows against the slot list.
 *
 * The arity check is the safety valve. If a tenant's gateway returns an entity array of a
 * different length than the query's selected-node count, every downstream index is
 * meaningless — so the row is skipped and counted rather than decoded into plausible,
 * wrong edges. A non-zero count is surfaced to the operator; it means the spec and the
 * tenant's schema have diverged, which is worth knowing loudly.
 */
export function decodeExpansion(slots: Slot[], rows: unknown): ExpandResult {
  const nodes = new Map<string, ExpandedNode>();
  const edges = new Map<string, ExpandedEdge>();
  let arityMismatches = 0;
  let rowsDecoded = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const entities = (row as Rec)?.["entities"];
    if (!Array.isArray(entities)) continue;
    if (entities.length !== slots.length) {
      arityMismatches += 1;
      continue;
    }
    rowsDecoded += 1;

    const resolved: Array<ExpandedNode | null> = [];
    for (let i = 0; i < slots.length; i += 1) {
      const raw = entities[i];
      const node = raw && typeof raw === "object" ? toExpandedNode(raw as Rec) : null;
      resolved.push(node);
      if (node && !nodes.has(node.id)) nodes.set(node.id, node);
    }

    for (const slot of slots) {
      const self = resolved[slot.index];
      if (!self || slot.parentIndex === null || !slot.edgeType) continue;
      const parent = resolved[slot.parentIndex];
      if (!parent || parent.id === self.id) continue;
      const src = slot.reverse ? self.id : parent.id;
      const dst = slot.reverse ? parent.id : self.id;
      const id = expandEdgeId(src, slot.edgeType, dst);
      if (!edges.has(id)) edges.set(id, { id, src, dst, type: slot.edgeType });
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    arityMismatches,
    rowsDecoded,
  };
}
