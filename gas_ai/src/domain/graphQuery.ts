// The security-graph query engine: a Wiz-style path query, evaluated against the graph the
// sync already persisted.
//
// WHAT A QUERY IS. Wiz's Security Graph screen reads
//
//   FIND  AI Agent
//    THAT is acting as  Service Account
//
// and answers with a table whose ROW IS A PATH, not an entity. An agent bound to two service
// accounts is two rows, and its name repeats down the first column. Columns are grouped by
// node in the query: the agent's fields, then the service account's. Adding a THAT step adds
// a column group. That is the whole information architecture, and it is why this module
// returns bindings rather than a node list — `graphProject.ts` already answers the other
// question ("what is near this seed"), and answers it well.
//
// WHERE IT RUNS. Over `GraphDoc` — the doc `syncStore.loadGraphDoc()` hands back — and nothing
// else. No Wiz call, no new traversal: a question this graph cannot answer must come back
// empty and say why, rather than quietly reaching for the API mid-render.
//
// WHAT COMES OVER THE WIRE. The client owns the hash DSL and posts the PARSED tree as an RPC
// object, so this file holds no parser and there is no JS/TS mirror to keep in step (the
// machinery `assetQuery.js` / `assetTable.ts` exists to manage). `validateQuery` is therefore
// a real trust boundary, not a formality: everything below assumes it ran.

import type { EdgeType, GEdge, GNode, GraphDoc, NodeKind } from "./graphTypes";
import { AI_ASSET_KINDS, EDGE_TYPES, NODE_KINDS, severityRank } from "./graphTypes";
import { cmp, pushInto, type Rec } from "./util";

// ------------------------------------------------------------------------- the model

/** A kind slot in a query. "ANY" matches every kind — the wildcard the ANY-hops step needs. */
export type QueryKind = NodeKind | "ANY";
/** An edge slot. "ANY" means "related somehow", walked undirected up to `hops`. */
export type QueryEdge = EdgeType | "ANY";

/**
 * One property constraint. Values OR together; separate filters AND. That is the same rule
 * the inventory's facets use (`assetTable.ts`), so a user who learned it there is not learning
 * it twice — except that page's `flags` dimension, which ANDs inside itself for a documented
 * reason that does not apply here.
 */
export interface PropFilter {
  key: string;
  values: string[];
}

export interface QueryNode {
  kind: QueryKind;
  where?: PropFilter[];
  /**
   * Whether this node contributes rows and a column group — the eye toggle in the builder.
   * Defaults to true. A hidden node is still traversed and still constrains the match; it just
   * stops taking up table width, which is what you want for a waypoint like an
   * ACCESS_ROLE_BINDING that nobody wants a column of.
   */
  show?: boolean;
  steps?: QueryStep[];
}

export interface QueryStep {
  edge: QueryEdge;
  /** Follow the edge dst→src. "service account USED BY agent" is the same edge, read backwards. */
  reverse?: boolean;
  /**
   * Assert ABSENCE. The subtree binds nothing and contributes no columns — there is no node to
   * put in them. This is how "AI agent that is NOT protected by a guardrail" is expressed.
   */
  negate?: boolean;
  /** Keep the row when nothing matches, null-binding the column group. */
  optional?: boolean;
  /** ANY edges only: how far to walk. 1–MAX_HOPS. This is where the old depth slider landed. */
  hops?: number;
  node: QueryNode;
}

/** What a fresh visit asks: the product's primary lens, unchanged from the old default. */
export const DEFAULT_QUERY: QueryNode = { kind: "AI_AGENT" };

// ------------------------------------------------------------------------- the bounds
//
// Three different ceilings, because they stop three different things going wrong.

/**
 * Rows shipped to the client. `getAssets` ships up to CLIENT_ALL_MAX = 3000 and pages past it;
 * this is the same bargain at a lower number, because a path row is wider than an asset row.
 * `total` stays exact past the cap, so the count never lies about what matched.
 */
export const QUERY_ROW_MAX = 2000;

/**
 * Bindings ENUMERATED, cap included. A cross product is multiplicative: five steps that each
 * match ten neighbours is 100 000 rows off one root, and an Apps Script execution has six
 * minutes for everything. Past this the result reports `truncated`, and `total` becomes a
 * floor rather than a count — which the UI has to say out loud.
 */
export const QUERY_SCAN_MAX = 100000;

/** Structural limits on the tree itself, checked at the boundary. */
export const MAX_QUERY_NODES = 12;
export const MAX_QUERY_DEPTH = 6;
export const MAX_HOPS = 3;

// ------------------------------------------------------------------------- fields
//
// ONE registry drives three things that used to drift apart on this page: which properties can
// be filtered on, which columns a group offers, and what a cell holds. `graphTable`'s column
// list and `inventory.js`'s were already two independent answers over the same nodes.

export type FieldValue = string | number | boolean | null;

export interface FieldSpec {
  key: string;
  label: string;
  /** Kinds that offer this field. Absent = every kind. */
  kinds?: readonly NodeKind[];
  /** Right-align in the table — numbers only. */
  numeric?: boolean;
  get(n: GNode): FieldValue;
}

const IDENTITY_KINDS: readonly NodeKind[] = [
  "SERVICE_ACCOUNT", "USER_ACCOUNT", "ACCESS_ROLE", "ACCESS_ROLE_BINDING", "ACCESS_KEY",
];

/**
 * `undefined` and `null` are the same answer here — "Wiz did not tell us" — and both must stay
 * distinct from `false` and from `""`. Every getter funnels through this so no field invents a
 * value the payload did not carry.
 */
function orNull(v: unknown): FieldValue {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

/** `MethodCloudScanning` → `Cloud Scanning`. Unknown values de-camel rather than leaking raw. */
export function humanDiscoveryMethod(raw: string): string {
  const body = raw.replace(/^Method/, "");
  const spaced = body.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return spaced || raw;
}

export const QUERY_FIELDS: readonly FieldSpec[] = [
  { key: "name", label: "Name", get: (n) => n.name },
  { key: "kind", label: "Kind", get: (n) => n.kind },
  {
    key: "publisher", label: "Publisher", kinds: AI_ASSET_KINDS,
    get: (n) => orNull(n.publisher),
  },
  {
    key: "discoveredBy", label: "Discovered by", kinds: AI_ASSET_KINDS,
    get: (n) => {
      const m = n.discoveryMethods ?? [];
      return m.length ? m.map(humanDiscoveryMethod).join(", ") : null;
    },
  },
  {
    key: "displayName", label: "Display name", kinds: IDENTITY_KINDS,
    get: (n) => orNull(n.displayName),
  },
  { key: "email", label: "Email", kinds: IDENTITY_KINDS, get: (n) => orNull(n.email) },
  {
    // Three states, not two. Absent means the identity steps never carried a dormancy read;
    // rendering that as "No" would assert the opposite of what is known.
    key: "inactive", label: "Inactive for the last 90 days", kinds: IDENTITY_KINDS,
    get: (n) => (n.inactive === undefined ? null : n.inactive),
  },
  {
    key: "identityPurpose", label: "Purpose", kinds: IDENTITY_KINDS,
    get: (n) => orNull(n.identityPurpose),
  },
  { key: "cloud", label: "Cloud", get: (n) => orNull(n.cloudPlatform) },
  { key: "region", label: "Region", get: (n) => orNull(n.region) },
  { key: "status", label: "Status", get: (n) => orNull(n.status) },
  { key: "severity", label: "Issue severity", get: (n) => orNull(n.severity) },
  { key: "aars", label: "AARS", numeric: true, get: (n) => (n.aars ?? null) },
  { key: "aarsSeverity", label: "AARS level", get: (n) => orNull(n.aarsSeverity) },
  {
    key: "projects", label: "Projects",
    get: (n) => {
      const names = (n.projects ?? []).map((p) => p.name).filter(Boolean);
      return names.length ? names.join(", ") : null;
    },
  },
  {
    key: "guardrail", label: "Guardrail", kinds: AI_ASSET_KINDS,
    get: (n) => (n.guardrailMissing === undefined ? null : (n.guardrailMissing ? "missing" : "present")),
  },
  {
    key: "combos", label: "Toxic combinations",
    get: (n) => {
      const g = n.comboGroups ?? [];
      return g.length ? g.length : null;
    },
    numeric: true,
  },
  {
    key: "internet", label: "Internet reachable",
    get: (n) => (n.isAccessibleFromInternet === undefined || n.isAccessibleFromInternet === null
      ? null
      : n.isAccessibleFromInternet),
  },
  {
    key: "sensitiveAccess", label: "Reaches classified data",
    get: (n) => (n.hasAccessToSensitiveData === undefined ? null : n.hasAccessToSensitiveData),
  },
];

const FIELD_BY_KEY = new Map(QUERY_FIELDS.map((f) => [f.key, f]));

/** Every field a node of this kind can answer. "ANY" offers only the kind-agnostic ones. */
export function fieldsForKind(kind: QueryKind): FieldSpec[] {
  return QUERY_FIELDS.filter((f) => {
    if (!f.kinds) return true;
    if (kind === "ANY") return false;
    return f.kinds.includes(kind);
  });
}

/**
 * What a column group shows before anyone touches the chooser.
 *
 * These three sets are the screenshot: an AI-asset group reads name / publisher / discovered
 * by, an identity group reads name / display name / inactive-for-90-days. Everything else gets
 * the columns that are true of any node.
 */
export function defaultFieldsForKind(kind: QueryKind): string[] {
  if (kind !== "ANY" && (AI_ASSET_KINDS as readonly string[]).includes(kind)) {
    return ["name", "publisher", "discoveredBy"];
  }
  if (kind !== "ANY" && (IDENTITY_KINDS as readonly string[]).includes(kind)) {
    return ["name", "displayName", "inactive"];
  }
  return ["name", "kind", "cloud"];
}

// ------------------------------------------------------------------------- validation

export class QueryError extends Error {}

function fail(msg: string): never {
  throw new QueryError(msg);
}

const KIND_SET = new Set<string>(NODE_KINDS as readonly string[]);
const EDGE_SET = new Set<string>(EDGE_TYPES as readonly string[]);

/**
 * Turn whatever arrived over `google.script.run` into a QueryNode, or throw.
 *
 * This is the only thing standing between a hand-edited URL and the evaluator, so it is
 * exhaustive rather than polite: unknown kinds and edges are rejected by name (they cannot
 * match anything anyway, and silently returning zero rows would read as "nothing is wrong with
 * your estate"), and the two structural caps stop a pathological tree from spending the
 * execution budget before the first row.
 */
export function validateQuery(raw: unknown): QueryNode {
  const counter = { nodes: 0 };
  const q = readNode(raw, 1, counter);
  return q;
}

function readNode(raw: unknown, depth: number, counter: { nodes: number }): QueryNode {
  if (!raw || typeof raw !== "object") fail("query node must be an object");
  if (depth > MAX_QUERY_DEPTH) fail(`query nests deeper than ${MAX_QUERY_DEPTH} levels`);
  if (++counter.nodes > MAX_QUERY_NODES) fail(`query has more than ${MAX_QUERY_NODES} nodes`);

  const r = raw as Rec;
  const kind = r["kind"];
  if (typeof kind !== "string" || (kind !== "ANY" && !KIND_SET.has(kind))) {
    fail(`unknown node kind: ${String(kind)}`);
  }
  const node: QueryNode = { kind: kind as QueryKind };

  if (r["show"] === false) node.show = false;

  const where = r["where"];
  if (where !== undefined) {
    if (!Array.isArray(where)) fail("where must be an array");
    const filters: PropFilter[] = [];
    for (const f of where) {
      if (!f || typeof f !== "object") fail("filter must be an object");
      const key = (f as Rec)["key"];
      const values = (f as Rec)["values"];
      // `id` is not in QUERY_FIELDS — it is not a column anyone wants — but it IS the filter a
      // deep link from the inventory or a detail sheet lands on, so it is allowed by name.
      if (typeof key !== "string" || (key !== "id" && !FIELD_BY_KEY.has(key))) {
        fail(`unknown filter field: ${String(key)}`);
      }
      if (!Array.isArray(values) || !values.length) fail(`filter ${key} has no values`);
      filters.push({ key, values: values.map((v) => String(v)) });
    }
    if (filters.length) node.where = filters;
  }

  const steps = r["steps"];
  if (steps !== undefined) {
    if (!Array.isArray(steps)) fail("steps must be an array");
    const out: QueryStep[] = [];
    for (const s of steps) out.push(readStep(s, depth + 1, counter));
    if (out.length) node.steps = out;
  }
  return node;
}

function readStep(raw: unknown, depth: number, counter: { nodes: number }): QueryStep {
  if (!raw || typeof raw !== "object") fail("step must be an object");
  const r = raw as Rec;
  const edge = r["edge"];
  if (typeof edge !== "string" || (edge !== "ANY" && !EDGE_SET.has(edge))) {
    fail(`unknown relationship: ${String(edge)}`);
  }
  const step: QueryStep = { edge: edge as QueryEdge, node: readNode(r["node"], depth, counter) };
  if (r["reverse"] === true) step.reverse = true;
  if (r["negate"] === true) step.negate = true;
  if (r["optional"] === true) step.optional = true;
  if (edge === "ANY") {
    const hops = Number(r["hops"]);
    step.hops = Number.isFinite(hops) ? Math.min(MAX_HOPS, Math.max(1, Math.round(hops))) : 1;
  }
  // A negated step asserts absence, so nothing downstream of it can bind. Rejecting the
  // combination is kinder than silently dropping the subtree the user built.
  if (step.negate && step.node.steps?.length) {
    fail("a negated relationship cannot carry further steps — there is nothing to walk from");
  }
  if (step.negate && step.optional) fail("a relationship cannot be both negated and optional");
  return step;
}

// ------------------------------------------------------------------------- vocabulary

export interface VocabEntry {
  edge: QueryEdge;
  reverse: boolean;
  kind: NodeKind;
  /** How many edges of this shape exist — the builder shows it, so a dead end is visible. */
  count: number;
}

export interface Vocabulary {
  /** Kinds present in the graph, with their node counts, worst-populated first is NOT the order —
   *  declaration order is, so the picker reads the same way the legend does. */
  kinds: Array<{ kind: NodeKind; count: number }>;
  /** For each kind, the steps that can actually match from it. */
  stepsFrom: Record<string, VocabEntry[]>;
}

/**
 * What the pickers are allowed to offer, derived from the graph rather than from the enums.
 *
 * Offering all 38 kinds and all 24 relationships would be honest about the model and useless
 * about the tenant: most pairs do not occur, and a builder that lets you construct a query
 * guaranteed to return nothing is a builder that wastes your afternoon. Wiz solves this the
 * same way — "only the filters and connections that are valid for the selected node type".
 */
export function queryVocabulary(doc: GraphDoc): Vocabulary {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const kindCounts = new Map<NodeKind, number>();
  for (const n of doc.nodes) kindCounts.set(n.kind, (kindCounts.get(n.kind) ?? 0) + 1);

  const stepsFrom: Record<string, VocabEntry[]> = {};
  const seen = new Map<string, VocabEntry>();
  const note = (from: NodeKind, edge: EdgeType, reverse: boolean, to: NodeKind) => {
    const key = `${from}|${edge}|${reverse ? "r" : "f"}|${to}`;
    const hit = seen.get(key);
    if (hit) {
      hit.count += 1;
      return;
    }
    const entry: VocabEntry = { edge, reverse, kind: to, count: 1 };
    seen.set(key, entry);
    (stepsFrom[from] ??= []).push(entry);
  };

  for (const e of doc.edges) {
    // A negated edge records an ABSENCE (PROTECTED_BY with negate:true is the guardrail gap).
    // It is not a relationship anyone can walk, so it must not appear in the vocabulary as one
    // — the way to ask that question is the negate toggle on a normal PROTECTED_BY step.
    if (e.negated) continue;
    const src = byId.get(e.src);
    const dst = byId.get(e.dst);
    if (!src || !dst) continue;
    note(src.kind, e.type, false, dst.kind);
    note(dst.kind, e.type, true, src.kind);
  }

  // Commonest first, not alphabetical. The picker's job is to get someone to a useful query in
  // one click, and an estate's most-travelled relationship is the best guess at the next step —
  // alphabetical order just puts whatever begins with A at the top of every list.
  for (const list of Object.values(stepsFrom)) {
    list.sort((a, b) => (b.count - a.count)
      || cmp(a.reverse, b.reverse)
      || cmp(a.edge, b.edge)
      || cmp(a.kind, b.kind));
  }

  const kinds = (NODE_KINDS as readonly NodeKind[])
    .filter((k) => kindCounts.has(k))
    .map((kind) => ({ kind, count: kindCounts.get(kind) ?? 0 }));

  return { kinds, stepsFrom };
}

// ------------------------------------------------------------------------- columns

export interface ColumnGroup {
  /** Pre-order index among SHOWN nodes — the row's cell index. */
  index: number;
  kind: QueryKind;
  label: string;
  fields: Array<{ key: string; label: string; numeric?: boolean }>;
  /** Every field this kind could show, for the column chooser. */
  available: Array<{ key: string; label: string }>;
}

/**
 * One group per shown node, in pre-order. `selected` is the chooser's state — a parallel array
 * of field-key lists, short-circuiting to the kind's defaults where it has nothing to say.
 */
export function queryColumnGroups(query: QueryNode, selected?: Array<string[] | null>): ColumnGroup[] {
  const groups: ColumnGroup[] = [];
  walkShown(query, (node) => {
    const index = groups.length;
    const offered = fieldsForKind(node.kind);
    const offeredKeys = new Set(offered.map((f) => f.key));
    const picked = (selected?.[index] ?? []).filter((k) => offeredKeys.has(k));
    const keys = picked.length ? picked : defaultFieldsForKind(node.kind).filter((k) => offeredKeys.has(k));
    groups.push({
      index,
      kind: node.kind,
      label: node.kind === "ANY" ? "Any node" : node.kind,
      fields: keys.map((k) => {
        const f = FIELD_BY_KEY.get(k) as FieldSpec;
        return { key: f.key, label: f.label, numeric: f.numeric };
      }),
      available: offered.map((f) => ({ key: f.key, label: f.label })),
    });
  });
  return groups;
}

/** The shown nodes, pre-order — the same walk the binder uses, so slots and groups line up. */
function walkShown(node: QueryNode, visit: (n: QueryNode) => void): void {
  if (node.show !== false) visit(node);
  for (const step of node.steps ?? []) {
    if (step.negate) continue;
    walkShown(step.node, visit);
  }
}

/** Every binding slot, shown or not — one per traversed node, pre-order. */
function bindingSlots(node: QueryNode): QueryNode[] {
  const out: QueryNode[] = [node];
  for (const step of node.steps ?? []) {
    if (step.negate) continue;
    out.push(...bindingSlots(step.node));
  }
  return out;
}

// ------------------------------------------------------------------------- evaluation

export interface QueryCell {
  id: string;
  kind: NodeKind;
  name: string;
  fields: Record<string, FieldValue>;
}

export interface QueryRow {
  /** One entry per SHOWN node, pre-order. null = an optional leg matched nothing. */
  cells: Array<QueryCell | null>;
}

export interface QueryResult {
  rows: QueryRow[];
  groups: ColumnGroup[];
  /** Exact match count, unless `truncated` — then a floor. */
  total: number;
  /** true when `rows` was cut at QUERY_ROW_MAX; `total` is still exact. */
  capped: boolean;
  /** true when enumeration hit QUERY_SCAN_MAX; `total` is a floor and the UI must say so. */
  truncated: boolean;
  /** Every node on a surviving path, shown or not — the Graph view's node set. */
  nodeIds: string[];
  /** Every edge actually traversed by a surviving path. */
  edgeIds: string[];
}

export interface RunOptions {
  rowMax?: number;
  scanMax?: number;
  /** Column selection, parallel to the shown-node pre-order. */
  columns?: Array<string[] | null>;
}

interface Adjacency {
  byId: Map<string, GNode>;
  out: Map<string, GEdge[]>;
  in: Map<string, GEdge[]>;
}

interface Solution {
  slots: Array<GNode | null>;
  edges: GEdge[];
}

function buildAdjacency(doc: GraphDoc): Adjacency {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GEdge[]>();
  const inn = new Map<string, GEdge[]>();
  for (const e of doc.edges) {
    // An edge whose endpoints the projection never admitted is not walkable. The sync writes
    // nodes and edges as separate tabs, so a half-written ledger can carry one without the other.
    if (!byId.has(e.src) || !byId.has(e.dst)) continue;
    pushInto(out, e.src, e);
    pushInto(inn, e.dst, e);
  }
  return { byId, out, in: inn };
}

function fieldValue(node: GNode, key: string): FieldValue {
  if (key === "id") return node.id;
  const spec = FIELD_BY_KEY.get(key);
  return spec ? spec.get(node) : null;
}

/** Case-insensitive, because a filter typed as "gcp" must find `GCP`. */
function matchesFilter(node: GNode, f: PropFilter): boolean {
  const v = fieldValue(node, f.key);
  if (v === null) {
    // "unknown" is a value a user can legitimately filter FOR — it is the whole point of the
    // three-state columns. Anything else does not match an absent field.
    return f.values.some((x) => x === "unknown" || x === "");
  }
  const s = String(v).toLowerCase();
  return f.values.some((x) => {
    const want = String(x).toLowerCase();
    if (want === s) return true;
    // Multi-valued cells (projects, discovery methods) are joined with ", " by their getter,
    // so an exact compare would never match one project inside a list of three.
    return s.split(", ").includes(want);
  });
}

function matchesNode(node: GNode, q: QueryNode): boolean {
  if (q.kind !== "ANY" && node.kind !== q.kind) return false;
  for (const f of q.where ?? []) {
    if (!matchesFilter(node, f)) return false;
  }
  return true;
}

/** Candidate targets of one step from one node, each with the edges walked to reach it. */
function stepTargets(from: GNode, step: QueryStep, adj: Adjacency): Array<{ node: GNode; edges: GEdge[] }> {
  if (step.edge === "ANY") return anyHopTargets(from, step, adj);

  const edges = (step.reverse ? adj.in.get(from.id) : adj.out.get(from.id)) ?? [];
  const seen = new Set<string>();
  const hits: Array<{ node: GNode; edges: GEdge[] }> = [];
  for (const e of edges) {
    if (e.type !== step.edge) continue;
    // A negated edge is an absence, not a relationship. Walking one would answer
    // "protected by" with a guardrail that is specifically NOT attached.
    if (e.negated) continue;
    const other = adj.byId.get(step.reverse ? e.src : e.dst);
    if (!other || seen.has(other.id)) continue;
    if (!matchesNode(other, step.node)) continue;
    seen.add(other.id);
    hits.push({ node: other, edges: [e] });
  }
  return hits;
}

/**
 * "Related somehow, within N hops" — undirected BFS, carrying the path back so the Graph view
 * can draw the route rather than a floating pair. This is where the old depth slider lives now:
 * `FIND <that asset> THAT relates within 2 hops to ANY` is the neighbourhood view, expressed as
 * a query like everything else on the page.
 */
function anyHopTargets(from: GNode, step: QueryStep, adj: Adjacency): Array<{ node: GNode; edges: GEdge[] }> {
  const limit = Math.min(MAX_HOPS, Math.max(1, step.hops ?? 1));
  const prev = new Map<string, { via: GEdge; from: string }>();
  const seen = new Set<string>([from.id]);
  let frontier = [from.id];
  const hits: Array<{ node: GNode; edges: GEdge[] }> = [];

  for (let depth = 0; depth < limit && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const touching = [...(adj.out.get(id) ?? []), ...(adj.in.get(id) ?? [])];
      for (const e of touching) {
        if (e.negated) continue;
        const otherId = e.src === id ? e.dst : e.src;
        if (seen.has(otherId)) continue;
        seen.add(otherId);
        prev.set(otherId, { via: e, from: id });
        next.push(otherId);
        const other = adj.byId.get(otherId);
        if (other && matchesNode(other, step.node)) {
          hits.push({ node: other, edges: pathEdges(otherId, from.id, prev) });
        }
      }
    }
    frontier = next;
  }
  return hits;
}

function pathEdges(toId: string, rootId: string, prev: Map<string, { via: GEdge; from: string }>): GEdge[] {
  const edges: GEdge[] = [];
  let cursor = toId;
  while (cursor !== rootId) {
    const hop = prev.get(cursor);
    if (!hop) break;
    edges.push(hop.via);
    cursor = hop.from;
  }
  return edges.reverse();
}

interface ScanState {
  scanned: number;
  max: number;
  truncated: boolean;
}

/**
 * Every way this subtree can bind, given its root is `node`.
 *
 * Each returned solution is the pre-order slot list for the subtree INCLUDING its own root, so
 * a caller can concatenate without knowing the shape. A negated step contributes no slots at
 * all, which is why `bindingSlots` skips it too — the two walks must agree or the columns
 * slide off their values.
 */
function solutions(q: QueryNode, node: GNode, adj: Adjacency, scan: ScanState): Solution[] {
  let acc: Solution[] = [{ slots: [node], edges: [] }];

  for (const step of q.steps ?? []) {
    const targets = stepTargets(node, step, adj);

    if (step.negate) {
      if (targets.length) return [];
      continue;
    }

    const stepSolutions: Solution[] = [];
    for (const t of targets) {
      for (const sub of solutions(step.node, t.node, adj, scan)) {
        stepSolutions.push({ slots: sub.slots, edges: t.edges.concat(sub.edges) });
      }
      if (scan.truncated) break;
    }

    if (!stepSolutions.length) {
      if (!step.optional) return [];
      // The row survives with the whole subtree null-bound, so its column group stays in place
      // and reads as "nothing here" rather than shifting every later column one to the left.
      stepSolutions.push({ slots: bindingSlots(step.node).map(() => null), edges: [] });
    }

    const combined: Solution[] = [];
    for (const left of acc) {
      for (const right of stepSolutions) {
        if (++scan.scanned > scan.max) {
          scan.truncated = true;
          return combined;
        }
        combined.push({ slots: left.slots.concat(right.slots), edges: left.edges.concat(right.edges) });
      }
    }
    acc = combined;
    if (scan.truncated) return acc;
  }

  return acc;
}

/**
 * Run a validated query against a synced graph.
 *
 * Roots are enumerated in the graph's own worst-first order so that a capped result set is the
 * interesting end of the list rather than an arbitrary slice — the same instinct
 * `graphProject.nodeOrder` encodes for the canvas.
 */
export function runQuery(doc: GraphDoc, query: QueryNode, opts: RunOptions = {}): QueryResult {
  const rowMax = opts.rowMax ?? QUERY_ROW_MAX;
  const scan: ScanState = { scanned: 0, max: opts.scanMax ?? QUERY_SCAN_MAX, truncated: false };
  const adj = buildAdjacency(doc);
  const groups = queryColumnGroups(query, opts.columns);

  // Which slots are shown, as a mask over the pre-order slot list. Built once: the binder emits
  // every traversed node (the Graph view wants the waypoints) and only the table drops them.
  const slotQueries = bindingSlots(query);
  const shownMask = slotQueries.map((q) => q.show !== false);
  const groupFields = groups.map((g) => g.fields.map((f) => f.key));

  const roots = doc.nodes
    .filter((n) => matchesNode(n, query))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity)
      || (b.aars ?? -1) - (a.aars ?? -1)
      || cmp(a.name, b.name));

  const rows: QueryRow[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  let total = 0;

  for (const root of roots) {
    for (const sol of solutions(query, root, adj, scan)) {
      total += 1;
      if (rows.length < rowMax) {
        rows.push({ cells: toCells(sol.slots, shownMask, groupFields) });
        // Only surviving, SHIPPED paths contribute to the canvas. A path counted past the row
        // cap is real, but drawing nodes the table cannot show would put the two views out of
        // step with no way for the reader to tell which one to believe.
        for (const n of sol.slots) if (n) nodeIds.add(n.id);
        for (const e of sol.edges) {
          edgeIds.add(e.id);
          // Both endpoints, not just the bound slots. A multi-hop ANY step walks THROUGH nodes
          // the query never named — agent → service account → bucket names two of the three —
          // and shipping an edge whose middle node is absent leaves the canvas with an edge
          // pointing at nothing.
          nodeIds.add(e.src);
          nodeIds.add(e.dst);
        }
      }
    }
    if (scan.truncated) break;
  }

  return {
    rows,
    groups,
    total,
    capped: total > rows.length,
    truncated: scan.truncated,
    nodeIds: [...nodeIds],
    edgeIds: [...edgeIds],
  };
}

function toCells(
  slots: Array<GNode | null>,
  shownMask: boolean[],
  groupFields: string[][],
): Array<QueryCell | null> {
  const cells: Array<QueryCell | null> = [];
  for (let i = 0; i < slots.length; i++) {
    if (!shownMask[i]) continue;
    const node = slots[i];
    const keys = groupFields[cells.length] ?? [];
    if (!node) {
      cells.push(null);
      continue;
    }
    const fields: Record<string, FieldValue> = {};
    for (const key of keys) fields[key] = fieldValue(node, key);
    cells.push({ id: node.id, kind: node.kind, name: node.name, fields });
  }
  return cells;
}
