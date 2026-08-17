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
import { conditionState } from "./riskConditions";
import { cmp, pushInto, type Rec } from "./util";

// ------------------------------------------------------------------------- the model

/** A kind slot in a query. "ANY" matches every kind — the wildcard the ANY-hops step needs. */
export type QueryKind = NodeKind | "ANY";

/**
 * The kinds a node names, always as a list. THE one narrowing point for `QueryNode.kind`.
 *
 * Everything downstream reads kinds through this, so nothing else has to know that a single
 * kind is stored as a bare string — and adding a reader that forgets is a type error rather
 * than a branch that quietly works for one shape and not the other.
 */
export function kindsOf(node: QueryNode): QueryKind[] {
  return Array.isArray(node.kind) ? node.kind : [node.kind];
}

/** The character between kinds in `find=`. See the grammar note in the client's graphQuery.js. */
export const KIND_SEP = "-";

/**
 * A node's kinds as one stable string — `"AI_AGENT"`, `"AI_AGENT-AI_DEPLOYMENT"`.
 *
 * The identity two sides of the wire compare (`ColumnGroup.kind` here, the builder row's `kind`
 * there) and the key per-kind column preferences are stored under. A one-kind node answers the
 * bare kind, which is why nothing about an existing payload moves.
 */
export function kindKey(node: QueryNode): string {
  return kindsOf(node).join(KIND_SEP);
}
/** An edge slot. "ANY" means "related somehow", walked undirected up to `hops`. */
export type QueryEdge = EdgeType | "ANY";

/**
 * One property constraint. Separate filters AND; within one filter, the two flags below say how
 * its values are quantified. Unflagged, values OR — which is what every filter written before
 * these existed means, and what the inventory's facets mean on the page next door.
 *
 * TWO AXES, DELIBERATELY SEPARATE. `op` says how ONE value is compared to the field; `all` and
 * `negate` say how the SET of values is quantified over. Keeping them apart is what lets the
 * four readings a multi-valued field wants — contains any / all / none / not all — fall out of
 * two booleans instead of an operator enum that would have to spell out every combination, and
 * it keeps substring matching orthogonal to both.
 */
export interface PropFilter {
  key: string;
  values: string[];
  /**
   * How each value is compared. `eq` (the default, and what every existing filter means) is
   * whole-value equality; `contains` is a substring, which is the only useful reading of a
   * filter on a name — "prod" should find "prod-agent-01", and until this existed it did not.
   */
  op?: "eq" | "contains";
  /**
   * EVERY value must match, not just one. Only meaningful where a node can hold several at once
   * — a joined list like `projects`, or the key/value `pairs` of `tags`. A single-valued field
   * can never satisfy two different values, so the builder does not offer this there.
   */
  all?: boolean;
  /**
   * The match is asserted ABSENT: the filter keeps exactly the nodes it would otherwise drop.
   *
   * Applied as a plain inversion of the whole test, INCLUDING the unknown-field case — so a node
   * with no cloud at all does match "cloud is not GCP". That is the reading a negation carries
   * everywhere else, and the one that makes "is" and "is not" partition the landscape between them
   * rather than leaving a silent third group in neither. It is knowingly in tension with the
   * tri-state rule the boolean fields follow, where absent is its own answer; the difference is
   * that there you ASK for `unknown` by name, and here you would be excluded by it without
   * anything on screen saying so.
   */
  negate?: boolean;
}

export interface QueryNode {
  /**
   * What this node is looking for. An array names SEVERAL kinds and matches any of them —
   * "AI agents and AI deployments that reach classified data" is one node, not two queries.
   *
   * Scalar-or-array rather than always-array so that a one-kind node stays the object it has
   * always been on the wire, which keeps every existing link, saved view and golden payload
   * byte-identical. `validateQuery` canonicalises the two spellings into one, and `kindsOf` is
   * the single place anything narrows them — no reader below this line asks which it got.
   */
  kind: QueryKind | QueryKind[];
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

/** A step is either one hop along a relationship, or a boolean grouping of other steps. */
export type QueryStep = RelationStep | GroupStep;

export interface RelationStep {
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
  /**
   * Follow the edge that RECORDS AN ABSENCE rather than the ones that record a relationship —
   * the negated `PROTECTED_BY` that a MISSING_GUARDRAIL stub hangs off.
   *
   * INTERNAL, and it has to be: `THAT is PROTECTED_BY a guardrail` must not match an asset whose
   * only such edge is the absence marker, which is exactly why `stepTargets` skips negated edges
   * for every ordinary step. Witnesses are the one caller that wants precisely that edge, because
   * for them the absence IS the evidence — "no guardrail" is a node in this graph, and the only
   * way to it is the edge saying it is not there.
   *
   * `readStep` copies a whitelist of fields onto a fresh object, so a client cannot set this by
   * sending it; the flag exists only for the witnesses built in this file.
   */
  viaAbsence?: boolean;
  node: QueryNode;
}

/**
 * A boolean block over other steps. The steps of a node are ANDed implicitly, so `and` is only
 * ever needed to nest inside an `or`; `or` is the one that adds expressive power.
 *
 * A group occupies NO binding slot of its own — it is punctuation, not an entity. Its children
 * occupy theirs, and for an `or` group EVERY branch reserves its slots even though only one
 * branch fills them on any given row. That is what keeps the table rectangular: a row always
 * has the same cells in the same order, showing values under the branch that matched and `—`
 * under the others, which is the visual language `optional` already established.
 */
export interface GroupStep {
  op: "and" | "or";
  /** No branch matched? Null the whole group's slots and keep the row, instead of dropping it. */
  optional?: boolean;
  steps: QueryStep[];
}

export function isGroup(step: QueryStep): step is GroupStep {
  return (step as GroupStep).op !== undefined;
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
// be filtered on, which columns a group offers, and what a cell holds. The graph's old table
// fallback and `inventory.js` were already two independent column lists over the same nodes.

export type FieldValue = string | number | boolean | null;

/**
 * What KIND of value a field holds, which decides how it is filtered and how the palette
 * draws it: free text takes an input and a substring match, a choice takes a value list with
 * counts, a yes/no takes three states because absent is its own answer.
 */
export type FieldType = "text" | "choice" | "boolean" | "number" | "pairs";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  /** Kinds that offer this field. Absent = every kind. */
  kinds?: readonly NodeKind[];
  /**
   * A node can hold SEVERAL of these at once — the getter joins them with ", ".
   *
   * Declared rather than inferred, because the client needs it and can only see the rendered
   * string: `"GCP"` and `"CE-DPCP"` look identical from there, and guessing from whether a comma
   * happens to appear would make a filter's operator list depend on which tenant is loaded. It
   * is what decides whether "all of these" is offered at all — a node has one cloud, so asking
   * for two would be asking for nothing.
   */
  multi?: boolean;
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
  { key: "name", label: "Name", type: "text", get: (n) => n.name },
  { key: "kind", label: "Kind", type: "choice", get: (n) => n.kind },
  {
    key: "publisher", label: "Publisher", type: "text", kinds: AI_ASSET_KINDS,
    get: (n) => orNull(n.publisher),
  },
  {
    key: "discoveredBy", label: "Discovered by", type: "choice", multi: true, kinds: AI_ASSET_KINDS,
    get: (n) => {
      const m = n.discoveryMethods ?? [];
      return m.length ? m.map(humanDiscoveryMethod).join(", ") : null;
    },
  },
  {
    key: "displayName", label: "Display name", type: "text", kinds: IDENTITY_KINDS,
    get: (n) => orNull(n.displayName),
  },
  { key: "email", label: "Email", type: "text", kinds: IDENTITY_KINDS, get: (n) => orNull(n.email) },
  {
    // Three states, not two. Absent means the identity steps never carried a dormancy read;
    // rendering that as "No" would assert the opposite of what is known.
    key: "inactive", label: "Inactive for the last 90 days", type: "boolean", kinds: IDENTITY_KINDS,
    get: (n) => (n.inactive === undefined ? null : n.inactive),
  },
  {
    key: "identityPurpose", label: "Purpose", type: "choice", kinds: IDENTITY_KINDS,
    get: (n) => orNull(n.identityPurpose),
  },
  { key: "cloud", label: "Cloud", type: "choice", get: (n) => orNull(n.cloudPlatform) },
  { key: "region", label: "Region", type: "choice", get: (n) => orNull(n.region) },
  // The cloud tags, rendered `key: value` and joined like any other list cell so the table and
  // the column chooser need to know nothing about them. They were synced and shown on the asset
  // sheet long before this — `tags_json` round-trips through the ledger — but with no entry here
  // you could read a tag and not ask about it, which is the gap this closes.
  //
  // `pairs` rather than `choice` because the value space is the landscape's, not the schema's: a
  // real tenant has thousands of distinct `key: value` strings, far past VALUE_CARDINALITY_MAX,
  // so `fieldValuesFor` offers no list and the builder asks for a key and a value instead.
  {
    key: "tags",
    label: "Tags",
    type: "pairs",
    multi: true,
    get: (n) => orNull((n.tags ?? [])
      .map((t) => (t.value ? `${t.key}: ${t.value}` : t.key))
      .join(", ")),
  },
  { key: "status", label: "Status", type: "choice", get: (n) => orNull(n.status) },
  { key: "severity", label: "Issue severity", type: "choice", get: (n) => orNull(n.severity) },
  { key: "aars", label: "AARS", type: "number", numeric: true, get: (n) => (n.aars ?? null) },
  { key: "aarsSeverity", label: "AARS level", type: "choice", get: (n) => orNull(n.aarsSeverity) },
  {
    key: "projects", label: "Projects", type: "choice", multi: true,
    get: (n) => {
      const names = (n.projects ?? []).map((p) => p.name).filter(Boolean);
      return names.length ? names.join(", ") : null;
    },
  },
  {
    key: "guardrail", label: "Guardrail", type: "choice", kinds: AI_ASSET_KINDS,
    get: (n) => (n.guardrailMissing === undefined ? null : (n.guardrailMissing ? "missing" : "present")),
  },
  {
    key: "combos", label: "Toxic combinations", type: "number", numeric: true,
    get: (n) => {
      const g = n.comboGroups ?? [];
      return g.length ? g.length : null;
    },
  },
  {
    // The combination patterns BY NAME, where `combos` only ever counted them. "Show me the
    // members of the privileged managed-agent pattern" is the question the register is built
    // around, and a count cannot answer it.
    key: "comboGroup", label: "Toxic combination", type: "choice", multi: true,
    get: (n) => {
      const g = n.comboGroups ?? [];
      return g.length ? g.join(", ") : null;
    },
  },
  {
    // Read through the SAME predicate the canvas draws from. Reading only
    // `isAccessibleFromInternet` — which is what this did — disagreed with the graph on a node
    // that is open to all internet but not flagged accessible: the table said no while an
    // INTERNET_EXPOSURE node hung off it two panes away. One reading, one answer.
    key: "internet", label: "Internet reachable", type: "boolean",
    get: (n) => conditionState(n, "INTERNET_EXPOSURE"),
  },
  {
    key: "sensitiveAccess", label: "Reaches classified data", type: "boolean",
    get: (n) => (n.hasAccessToSensitiveData === undefined ? null : n.hasAccessToSensitiveData),
  },
  {
    // HOLDS classified data, which is a different claim from reaching it — a bucket holds, an
    // agent reaches. The pair is what makes the data-exposure path readable from either end.
    key: "sensitiveData", label: "Holds classified data", type: "boolean",
    get: (n) => (n.hasSensitiveData === undefined ? null : n.hasSensitiveData),
  },
  {
    // Kept apart rather than folded into one "privileged" flag: ADMIN is the stronger claim,
    // and `withExcessivePrivilegeNodes` names its stub differently for it. EXCESSIVE_PRIVILEGE
    // is their disjunction, so anyone wanting that reads the risk condition instead.
    key: "highPriv", label: "High privileges", type: "boolean",
    get: (n) => (n.hasHighPrivileges === undefined ? null : n.hasHighPrivileges),
  },
  {
    key: "adminPriv", label: "Admin privileges", type: "boolean",
    get: (n) => (n.hasAdminPrivileges === undefined ? null : n.hasAdminPrivileges),
  },
];

const FIELD_BY_KEY = new Map(QUERY_FIELDS.map((f) => [f.key, f]));

// ------------------------------------------------------------------- witnesses
//
// THE EVIDENCE FOR A FILTER, AS A PATH.
//
// A filtered query used to answer with bare cards. "AI agents that reach classified data" is
// `FIND AI_AGENT WHERE sensitiveAccess is true` — a node with no steps — so `solutions` bound
// one slot per agent and the canvas drew 11 agents, 0 edges, 11 isolated components: the answer
// to a question about a PATH, drawn with no path in it. Meanwhile the shortcut carrying the very
// same label ("Reaches classified data", QUERY_SHORTCUTS below) spelled the path out and drew
// 39 nodes in 5 clusters. One name, two pictures.
//
// The fix is that a filter naming a risk property also names, implicitly, the subgraph that
// PROVES it — and that subgraph is drawn even though the question never asked for it as a step.
//
// WHY THIS IS A `QueryStep[]` AND NOT A TRAVERSAL. Every edge below is already in `EDGE_TYPES`,
// so a witness is expressible in the grammar this file already evaluates: `solutions` starts
// from `[{slots:[node]}]` without re-matching its root, handles `optional`, collects the edges
// it walks, and honours the scan budget. So there is no new walker here — a witness is a query,
// run from an already-bound node, and the engine is the one that was already here.
//
// WHY NOT GRAFT THESE ONTO THE USER'S QUERY, which would be less code still: A ROW IS A PATH.
// The shortcut above returns 24 rows for 10 agents, because an agent reaching three buckets is
// three paths. Grafting the witness would multiply the table the same way — and would rewrite
// the question showing in the builder. So the witness rides the CANVAS half only: `runQuery`
// keeps it in its own id sets, and `rows`, `groups` and `total` never see it.
//
// TWO SPELLINGS PER ROW, deliberately. `graphEnrich` draws the derived stub only where the real
// chain could not be traced (its own comment: "stub wherever the real thing exists"), so which
// of the two exists is a per-asset fact and a witness that named one would miss half the landscape.
// They are sibling steps, both optional, so whichever is present binds and the other null-binds.
interface Witness {
  /** The `QUERY_FIELDS` key whose filter arms this. */
  key: string;
  /**
   * The field values that arm it, lowercased. Only the AFFIRMATIVE reading gets a witness:
   * "is false" and "is unknown" are answers about the absence of a path, and there is no path
   * to draw for them. `negate` disarms too — see `witnessFor`.
   */
  when: string[];
  /** What proves it, from the node the filter is on. */
  steps: QueryStep[];
}

/** Every node in a witness is hidden: it is evidence on the canvas, never a table column. */
function ev(kind: QueryKind | QueryKind[], steps?: QueryStep[]): QueryNode {
  return steps ? { kind, show: false, steps } : { kind, show: false };
}

const WITNESSES: Witness[] = [
  {
    // The four-hop chain, which is why "one hop of evidence" was never an option: the data end
    // sits at RUNS_AS → ALLOWS_ACCESS_TO → BUCKET → HAS_DATA_FINDING. Same shape as the
    // `reaches-classified` shortcut, carried one hop further to the findings — the shortcut stops
    // at the bucket because that is where its table column wants to stop, and a canvas does not.
    key: "sensitiveAccess",
    when: ["true"],
    steps: [
      {
        edge: "RUNS_AS",
        optional: true,
        node: ev("SERVICE_ACCOUNT", [{
          edge: "ALLOWS_ACCESS_TO",
          optional: true,
          node: ev(["BUCKET", "DATABASE"], [
            { edge: "HAS_DATA_FINDING", optional: true, node: ev("DATA_FINDING") },
          ]),
        }]),
      },
      { edge: "HAS_ACCESS_TO_SENSITIVE_DATA", optional: true, node: ev("SENSITIVE_DATA") },
    ],
  },
  {
    // Holding it rather than reaching it — the other end of the same chain, read from the store.
    key: "sensitiveData",
    when: ["true"],
    steps: [
      { edge: "HAS_DATA_FINDING", optional: true, node: ev("DATA_FINDING") },
      { edge: "HAS_SENSITIVE_DATA", optional: true, node: ev("SENSITIVE_DATA") },
    ],
  },
  {
    key: "internet",
    when: ["true"],
    steps: [{ edge: "EXPOSED_TO_INTERNET", optional: true, node: ev("INTERNET_EXPOSURE") }],
  },
  {
    // A choice field, not a boolean: "missing" is the affirmative here and "present" is the
    // absence of a finding, so only one of its two values arms anything.
    //
    // `viaAbsence` because the edge is a NEGATED `PROTECTED_BY` — enrich's own words — and every
    // ordinary step skips negated edges on purpose. This witness is the one thing that wants it:
    // the stub is only reachable by the edge that says the guardrail is not there. Without the
    // flag this row armed correctly and then drew nothing, which is how it was caught.
    key: "guardrail",
    when: ["missing"],
    steps: [{
      edge: "PROTECTED_BY", optional: true, viaAbsence: true, node: ev("MISSING_GUARDRAIL"),
    }],
  },
  ...(["highPriv", "adminPriv"] as const).map((key) => ({
    // Both flags are witnessed by one stub — `conditionState` reads EXCESSIVE_PRIVILEGE as their
    // disjunction — and `HAS_FINDING` is the second spelling: enrich suppresses its own stub on
    // an asset already carrying Wiz's real EXCESSIVE_ACCESS_FINDING.
    //
    // The two land on different nodes rather than being alternatives for the same one:
    // `HAS_FINDING` runs identity → finding, so it fires when the filter is on a SERVICE_ACCOUNT,
    // while the stub is what an AI asset carries. Both listed, so either end of the same claim
    // draws its evidence.
    key,
    when: ["true"],
    steps: [
      { edge: "HAS_EXCESSIVE_PRIVILEGE", optional: true, node: ev("EXCESSIVE_PRIVILEGE") },
      { edge: "HAS_FINDING", optional: true, node: ev("EXCESSIVE_ACCESS_FINDING") },
    ] as QueryStep[],
  })),
];

const WITNESS_BY_KEY = new Map(WITNESSES.map((w) => [w.key, w]));

/**
 * How many witness bindings one bound node contributes. An agent reaching forty buckets would
 * otherwise spend a whole canvas on one cluster.
 *
 * 6, matching the `BUCKET` / `DATABASE` entries in `graphProject.DEFAULT_PER_KIND_CAP` — the same
 * judgement about the same fan-out, made in the other projection. No "+N more" stub goes with it:
 * `inducedProjection` draws none by design, and the capped indicator is what says rows are
 * missing.
 */
export const WITNESS_FANOUT_CAP = 6;

/**
 * The evidence subgraph a node's filters ask for, as a query to run FROM that node — or null.
 *
 * Every armed filter contributes, so two of them on one node draw both witnesses. The arming
 * rules are the load-bearing part: get them wrong and the canvas contradicts the question.
 *
 *   - `negate` disarms. "does NOT reach classified data" is a claim about an absent path, and
 *     drawing the chain would assert the opposite of what was asked.
 *   - only `when` values arm. `is false` and `is unknown` are the same case as negation.
 *   - values are compared lowercased, because `matchesFilter` compares them lowercased — a
 *     filter written `TRUE` matches nodes and so must arm the witness that explains them.
 */
function witnessFor(node: QueryNode): QueryNode | null {
  const steps: QueryStep[] = [];
  for (const f of node.where ?? []) {
    if (f.negate) continue;
    const w = WITNESS_BY_KEY.get(f.key);
    if (!w) continue;
    if (!f.values.some((v) => w.when.includes(String(v).toLowerCase()))) continue;
    steps.push(...w.steps);
  }
  // `kind: "ANY"` is not a wildcard match here — `solutions` never re-matches its root — it is
  // just the honest kind for "whatever node this was bound to".
  return steps.length ? { kind: "ANY", show: false, steps } : null;
}

/**
 * Every field a node of these kinds can answer — the INTERSECTION where there are several.
 *
 * Intersect rather than union, and the asymmetry with the union used for relationships is
 * deliberate: a filter on a field only some of the kinds carry would read as narrowing and
 * actually EXCLUDE the rest, since a node that cannot answer a field matches only "unknown". A
 * relationship is a step you take on purpose with a count beside it; a field is a promise the
 * whole set has to keep.
 *
 * "ANY" offering only the kind-agnostic specs is the same rule, not an exception to it — the
 * wildcard is the intersection over every kind there is.
 */
export function fieldsForKind(kind: QueryKind | QueryKind[]): FieldSpec[] {
  const kinds = Array.isArray(kind) ? kind : [kind];
  return QUERY_FIELDS.filter((f) => {
    if (!f.kinds) return true;
    return kinds.every((k) => k !== "ANY" && f.kinds!.includes(k));
  });
}

/**
 * What a column group shows before anyone touches the chooser.
 *
 * These three sets are the screenshot: an AI-asset group reads name / publisher / discovered
 * by, an identity group reads name / display name / inactive-for-90-days. Everything else gets
 * the columns that are true of any node.
 *
 * EVERY member has to be in a family for that family's columns, which is the same intersection
 * rule `fieldsForKind` applies — asking for AI agents and deployments together keeps the
 * AI-asset columns, asking for agents and buckets falls back to the generic three, because
 * `publisher` is not a column a bucket can fill.
 */
export function defaultFieldsForKind(kind: QueryKind | QueryKind[]): string[] {
  const kinds = Array.isArray(kind) ? kind : [kind];
  const all = (family: readonly string[]) =>
    kinds.every((k) => k !== "ANY" && family.includes(k));
  if (all(AI_ASSET_KINDS as readonly string[])) return ["name", "publisher", "discoveredBy"];
  if (all(IDENTITY_KINDS as readonly string[])) return ["name", "displayName", "inactive"];
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
 * your landscape"), and the two structural caps stop a pathological tree from spending the
 * execution budget before the first row.
 */
export function validateQuery(raw: unknown): QueryNode {
  const counter = { nodes: 0 };
  const q = readNode(raw, 1, counter);
  return q;
}

/**
 * The kinds one node names, canonicalised so a selection has exactly one spelling.
 *
 * One kind collapses to the bare string, which is what keeps a single-kind query the same object
 * it has always been. Duplicates drop. A set holding "ANY" collapses to "ANY" alone, because the
 * union of everything with anything is everything — offering both would be a query that reads as
 * narrower than it is.
 *
 * THE ORDER IS LEFT AS WRITTEN, and that is deliberate. Sorting into NODE_KINDS order here would
 * be the obvious canonicalisation, but `kindKey` — the joined string — is compared ACROSS THE
 * WIRE by value: the client derives a row's identity from its own parsed tree and looks up this
 * node's `ColumnGroup` by it (test/graphQueryWalk.test.js pins the pair). The client's parser and
 * `setKinds` keep the order they were given, so reordering on this side alone would make a link
 * written `AI_DEPLOYMENT-AI_AGENT` describe two different nodes to the two halves of the app —
 * losing the row's field specs and its saved columns, silently. Agreement by construction is
 * worth more than a normalised spelling for a hand-edited URL, and the palette already emits its
 * selection in the vocabulary's order, so anything built in the UI has one spelling anyway.
 */
function readKinds(raw: unknown): QueryKind | QueryKind[] {
  const list = Array.isArray(raw) ? raw : [raw];
  if (!list.length) fail("node names no kind");
  const out: QueryKind[] = [];
  for (const one of list) {
    if (typeof one !== "string" || (one !== "ANY" && !KIND_SET.has(one))) {
      fail(`unknown node kind: ${String(one)}`);
    }
    if (!out.includes(one as QueryKind)) out.push(one as QueryKind);
  }
  if (out.includes("ANY")) return "ANY";
  return out.length === 1 ? out[0] : out;
}

function readNode(raw: unknown, depth: number, counter: { nodes: number }): QueryNode {
  if (!raw || typeof raw !== "object") fail("query node must be an object");
  if (depth > MAX_QUERY_DEPTH) fail(`query nests deeper than ${MAX_QUERY_DEPTH} levels`);
  if (++counter.nodes > MAX_QUERY_NODES) fail(`query has more than ${MAX_QUERY_NODES} nodes`);

  const r = raw as Rec;
  const node: QueryNode = { kind: readKinds(r["kind"]) };

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
      const op = (f as Rec)["op"];
      if (op !== undefined && op !== "eq" && op !== "contains") {
        fail(`unknown filter operator: ${String(op)}`);
      }
      const all = (f as Rec)["all"];
      const negate = (f as Rec)["negate"];
      if (all !== undefined && typeof all !== "boolean") {
        fail(`filter ${key}: all must be a boolean`);
      }
      if (negate !== undefined && typeof negate !== "boolean") {
        fail(`filter ${key}: negate must be a boolean`);
      }
      // Rebuilt key by key, so anything not named here is DROPPED rather than carried — which is
      // the point of a validator at a trust boundary, and the reason every flag has to be written
      // TWICE: once in a guard above and once in an assignment here. One accepted by the guard
      // and forgotten here is not an error anyone sees; it is a quietly different query.
      const filter: PropFilter = { key, values: values.map((v) => String(v)) };
      if (op === "contains") filter.op = "contains";
      if (all === true) filter.all = true;
      if (negate === true) filter.negate = true;
      filters.push(filter);
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
  if (r["op"] !== undefined) return readGroup(r, depth, counter);
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

/**
 * An AND / OR block.
 *
 * A group is counted against `MAX_QUERY_DEPTH` like any other level but against no node budget
 * of its own — it binds nothing, and its children are already counted. One branch is allowed:
 * a group is built by adding it and then adding branches to it, and rejecting the intermediate
 * state would make the builder unusable for the sake of a rule nothing depends on.
 */
function readGroup(r: Rec, depth: number, counter: { nodes: number }): GroupStep {
  const op = r["op"];
  if (op !== "and" && op !== "or") fail(`unknown group operator: ${String(op)}`);
  if (depth > MAX_QUERY_DEPTH) fail(`query nests deeper than ${MAX_QUERY_DEPTH} levels`);
  const steps = r["steps"];
  if (!Array.isArray(steps) || !steps.length) {
    fail(`an ${op.toUpperCase()} group needs at least one branch`);
  }
  const group: GroupStep = { op, steps: steps.map((s) => readStep(s, depth + 1, counter)) };
  if (r["optional"] === true) group.optional = true;
  return group;
}

// ------------------------------------------------------------------------- vocabulary

export interface VocabEntry {
  edge: QueryEdge;
  reverse: boolean;
  kind: NodeKind;
  /** How many edges of this shape exist — the builder shows it, so a dead end is visible. */
  count: number;
}

/**
 * The distinct values one choice field takes, with how many nodes carry each.
 *
 * Capped: past `VALUE_CARDINALITY_MAX` a picker is worse than a text box, and shipping five
 * hundred region names to every builder would cost more than the control is worth. A field
 * over the cap simply offers no list, and the palette falls back to a contains search — which
 * is why `contains` had to exist before this could.
 */
export const VALUE_CARDINALITY_MAX = 40;

export interface FieldValues {
  key: string;
  values: Array<{ value: string; count: number }>;
}

export interface Vocabulary {
  /** Kinds present in the graph, with their node counts, worst-populated first is NOT the order —
   *  declaration order is, so the picker reads the same way the legend does. */
  kinds: Array<{ kind: NodeKind; count: number }>;
  /** For each kind, the steps that can actually match from it. */
  stepsFrom: Record<string, VocabEntry[]>;
  /**
   * The choice fields a kind can be filtered on and the values they actually take IN THIS
   * TENANT — offering "GCP, AWS, Azure" to a landscape that is entirely GCP would be describing
   * the schema rather than the graph.
   *
   * Populated for ONE kind at a time, on request. Every kind's lists together came to 22 KB of
   * the 28 KB vocabulary on a 119-node dry run, all of it unused until someone opens the
   * palette — and then only ever one kind's worth is read. So the page fetches the vocabulary
   * bare and the palette asks for the kind it is about; `swrCall` keys on the params, so each
   * is fetched once per session.
   */
  valuesFor: Record<string, FieldValues[]>;
  /**
   * The curated questions, each with `kinds` NARROWED to the root kinds this tenant's graph
   * can actually answer it from. A shortcut no kind can answer is dropped.
   *
   * They ride the vocabulary because the client is vanilla JS and cannot import this module —
   * and because the reachability rule belongs next to the shortcuts it judges, not in a second
   * implementation on the other side of the wire. Six entries; the palette filters by kind.
   */
  shortcuts: QueryShortcut[];
  /**
   * The fields a kind can be filtered on, with the type that decides which control to draw.
   * Filled for ONE kind at a time, beside `valuesFor` and for the same reason.
   */
  fieldsFor: Record<string, Array<{ key: string; label: string; type: FieldType; multi?: boolean }>>;
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
  // one click, and a landscape's most-travelled relationship is the best guess at the next step —
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

  const base: Vocabulary = { kinds, stepsFrom, valuesFor: {}, fieldsFor: {}, shortcuts: [] };
  const shortcuts: QueryShortcut[] = [];
  for (const shortcut of QUERY_SHORTCUTS) {
    const answerable = shortcut.kinds.filter((k) => shortcutsFor(k, base).some((s) => s.id === shortcut.id));
    if (answerable.length) shortcuts.push({ ...shortcut, kinds: answerable });
  }
  return { ...base, shortcuts };
}

/**
 * What each choice field actually holds, per kind.
 *
 * Multi-value cells are counted per VALUE, not per cell: an asset in two projects contributes
 * to both, because "how many assets are in PROJECT-ALPHA" is the question the number answers.
 * A `null` becomes the literal "unknown" bucket, which `matchesFilter` already accepts as a
 * filter value — "Wiz never told us" is a real answer and has to be selectable.
 *
 * ANY IS A REAL KIND HERE, over every node in the graph. The worry that stopped it before was a
 * picker "offering the union of things that do not co-occur" — but that cannot happen, because
 * `fieldsForKind("ANY")` already drops every spec carrying a `kinds` list. What survives is the
 * kind-agnostic set: cloud, region, status, severity, the AARS level, projects, tags. Every node
 * answers those, so their union is exactly the question "which clouds does this landscape use".
 * Without this a wildcard node got no lists at all, and `FIND ANY(…)` is a shape the app writes
 * for itself whenever someone focuses an asset from the inventory.
 */
export function fieldValuesFor(doc: GraphDoc, kind: QueryKind): FieldValues[] {
  const nodes = kind === "ANY" ? doc.nodes : doc.nodes.filter((n) => n.kind === kind);
  const perField: FieldValues[] = [];
  for (const spec of QUERY_FIELDS) {
    if (spec.type !== "choice" && spec.type !== "boolean") continue;
    // A kind-specific field on a wildcard node is not offered at all — the same rule
    // `fieldsForKind` applies, so the values and the field list cannot disagree about what
    // exists.
    if (spec.kinds && (kind === "ANY" || !spec.kinds.includes(kind))) continue;
    // `kind` is a no-op here: this list is keyed BY kind, so it could only ever offer the one
    // value, filtering a thing by what it already is. A node asking for ANY kind gets its
    // options from `vocab.kinds`, which carries every kind with a count already.
    if (spec.key === "kind") continue;
    const counts = new Map<string, number>();
    let overflow = false;
    for (const node of nodes) {
      const raw = spec.get(node);
      const parts = raw === null
        ? ["unknown"]
        : (spec.type === "choice" ? String(raw).split(", ") : [String(raw)]);
      for (const part of parts) {
        if (!part) continue;
        if (!counts.has(part) && counts.size >= VALUE_CARDINALITY_MAX) {
          overflow = true;
          continue;
        }
        counts.set(part, (counts.get(part) ?? 0) + 1);
      }
    }
    // Over the cap the list would be a worse control than a search box, and a TRUNCATED list
    // is the worst of the three — it looks complete and is not. Offer nothing instead.
    if (overflow || !counts.size) continue;
    perField.push({
      key: spec.key,
      values: [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => (b.count - a.count) || cmp(a.value, b.value)),
    });
  }
  return perField;
}

// ------------------------------------------------------------------------- shortcuts

/**
 * A named question, expanded into a real subtree.
 *
 *   steps    appended under the node the palette was opened from
 *   filters  property filters on nodes INSIDE those steps, addressed by a path relative to
 *            the first appended step — `[0]` is that step's target node, `[0, 0]` is the
 *            target of its first child step. The client turns those into `where=` entries at
 *            the right slot numbers, so a shortcut's filters land in the URL where anyone can
 *            see them and take them off again; a filter baked invisibly into the tree would be
 *            a query narrowed by something nothing on screen admits to.
 *   kinds    the root kinds the question means anything for. Reachability in THIS tenant is
 *            checked separately, by `shortcutsFor`.
 *
 * WHY THESE SIX, AND NOT THE OBVIOUS ONES. `graphEnrich.withDerivedNodes` SUPPRESSES a risk
 * stub wherever the real thing exists — `SENSITIVE_DATA` where a walkable data path exists,
 * `EXCESSIVE_PRIVILEGE` where a real EXCESSIVE_ACCESS_FINDING exists. A shortcut that walked to
 * either stub would return the RESIDUE and report it as the population, which is the worst kind
 * of wrong: a confident number nobody can tell is short. So each of these reads either a flag
 * on the node, or the real chain, and never a suppressed stub. `MISSING_GUARDRAIL` and
 * `INTERNET_EXPOSURE` are the two that are never suppressed, and both are used directly.
 */
export interface QueryShortcut {
  id: string;
  label: string;
  /** The line under the label — what it asks, in the app's own words. */
  phrase: string;
  blurb: string;
  /** An entry in the help book, where one covers this. */
  helpId?: string;
  kinds: readonly NodeKind[];
  steps: QueryStep[];
  filters?: Array<{ path: number[]; key: string; values: string[] }>;
}

export const QUERY_SHORTCUTS: readonly QueryShortcut[] = [
  {
    id: "no-guardrail",
    label: "Has no guardrail",
    phrase: "Wiz reports the guardrail missing",
    blurb:
      "Reads the asset's own guardrail flag, which is what the canvas draws its "
      + "MISSING_GUARDRAIL stub from — so the two always agree.\n\n"
      + "Deliberately not the “NOT protected by a guardrail” traversal, which answers a wider "
      + "question: it counts every asset with no guardrail relationship in the graph, "
      + "including ones Wiz reports as protected without naming the guardrail. Add a NOT on a "
      + "PROTECTED_BY step if that wider question is the one you want.",
    helpId: "missing-guardrail",
    kinds: AI_ASSET_KINDS,
    steps: [],
    filters: [{ path: [], key: "guardrail", values: ["missing"] }],
  },
  {
    id: "runs-as-privileged",
    label: "Runs as a privileged identity",
    phrase: "its service account holds high privileges",
    blurb:
      "Reads the identity's own privilege flag rather than walking to the EXCESSIVE_PRIVILEGE "
      + "stub, which is suppressed wherever a real access finding exists — walking to it would "
      + "quietly answer with the leftovers. Admin privilege is the stronger claim and has its "
      + "own field.",
    helpId: "excessive-privilege",
    kinds: AI_ASSET_KINDS,
    steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } }],
    filters: [{ path: [0], key: "highPriv", values: ["true"] }],
  },
  {
    id: "runs-as-dormant",
    label: "Runs as a dormant identity",
    phrase: "its service account has been idle 90 days",
    blurb:
      "An identity nobody has used in ninety days, still able to act on the asset's behalf. "
      + "The dormancy is a field Wiz reports, not something derived here.",
    helpId: "agentic-identity",
    kinds: AI_ASSET_KINDS,
    steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } }],
    filters: [{ path: [0], key: "inactive", values: ["true"] }],
  },
  {
    id: "reaches-classified",
    label: "Reaches classified data",
    phrase: "through its identity, to a bucket",
    blurb:
      "The real path — asset to identity to bucket — with the identity hidden, so the table "
      + "reads asset beside data. Deliberately NOT the SENSITIVE_DATA stub, which "
      + "graphEnrich suppresses exactly where this chain exists: walking to the stub would "
      + "return only the assets whose path could not be traced.",
    helpId: "sensitive-data",
    kinds: AI_ASSET_KINDS,
    steps: [{
      edge: "RUNS_AS",
      node: {
        kind: "SERVICE_ACCOUNT",
        show: false,
        steps: [{ edge: "ALLOWS_ACCESS_TO", node: { kind: "BUCKET" } }],
      },
    }],
  },
  {
    id: "internet-reachable",
    label: "Reachable from the internet",
    phrase: "an exposure path reaches it",
    blurb:
      "Assets carrying an internet exposure node. Exposure is inherited from the compute "
      + "underneath, so this is the topology answer rather than a flag read off the asset.",
    helpId: "internet-exposure",
    kinds: AI_ASSET_KINDS,
    steps: [{ edge: "EXPOSED_TO_INTERNET", node: { kind: "INTERNET_EXPOSURE" } }],
  },
  {
    id: "dormant-human-access",
    label: "A dormant person can reach it",
    phrase: "a human account, idle 90 days, still has access",
    blurb:
      "Human access read backwards: the accounts that ALLOW_ACCESS_TO this asset, narrowed to "
      + "the ones nobody has signed into in ninety days. Standing access that no longer has a "
      + "person behind it.",
    kinds: AI_ASSET_KINDS,
    steps: [{ edge: "ALLOWS_ACCESS_TO", reverse: true, node: { kind: "USER_ACCOUNT" } }],
    filters: [{ path: [0], key: "inactive", values: ["true"] }],
  },
];

/**
 * The shortcuts this tenant's graph can actually answer from `kind`.
 *
 * Semantic scope comes from the shortcut (`kinds`); whether the relationships exist HERE comes
 * from the vocabulary. Offering "reaches classified data" to a landscape whose identities touch
 * no buckets would be a button that always answers nothing.
 *
 * Negated steps are exempt from the reachability check, and have to be: "has no guardrail" is
 * most worth offering in a landscape where NOTHING is protected — which is exactly the landscape
 * whose vocabulary carries no PROTECTED_BY edge to require.
 */
export function shortcutsFor(kind: QueryKind | QueryKind[], vocab: Vocabulary): QueryShortcut[] {
  // SEVERAL KINDS UNION, where the fields a set offers intersect — and the asymmetry is the
  // point. A field has to be answerable by every kind or filtering on it silently excludes the
  // ones that cannot; a shortcut is a step someone takes deliberately, so offering one that only
  // part of the selection can walk is a choice with a visible consequence (the other kinds drop
  // out of the results) rather than a hidden narrowing of the question already asked.
  const from = kindsOf({ kind } as QueryNode).filter((k) => k !== "ANY") as NodeKind[];
  // The wildcard is not a kind and has no relationships of its own; `stepsFrom` has no "ANY" key
  // at all, so there is nothing to check reachability against.
  if (!from.length) return [];
  // The kind has to be IN the landscape. Without this, a shortcut whose every step is negated —
  // or which is a bare property filter — passes the reachability check against a graph with
  // nothing in it at all, and an unsynced tenant is offered six buttons that answer nothing.
  const present = from.filter((k) => vocab.kinds.some((v) => v.kind === k));
  if (!present.length) return [];
  return QUERY_SHORTCUTS.filter((s) => present.some((k) =>
    s.kinds.includes(k) && s.steps.every((step) => reachable(k, step, vocab))));
}

function reachable(from: NodeKind, step: QueryStep, vocab: Vocabulary): boolean {
  if (isGroup(step)) return step.steps.every((s) => reachable(from, s, vocab));
  if (step.negate) return true;
  if (step.edge === "ANY") return true;
  // A step naming several target kinds is reachable if ANY of them is — the same union the
  // palette offers relationships by. Shortcuts are all authored single-kind, so this only ever
  // runs one way today; written as a fold because `e.kind === step.node.kind` against an array
  // is type-legal and silently false, which would judge such a shortcut unanswerable.
  const targets = kindsOf(step.node);
  const from2 = vocab.stepsFrom[from] ?? [];
  return targets.some((target) => {
    const hit = from2.some((e) =>
      e.edge === step.edge && e.reverse === !!step.reverse && e.kind === target);
    if (!hit) return false;
    if (target === "ANY") return true;
    return (step.node.steps ?? []).every((s) => reachable(target as NodeKind, s, vocab));
  });
}

// ------------------------------------------------------------------------- columns

export interface ColumnGroup {
  /** Pre-order index among SHOWN nodes — the row's cell index. */
  index: number;
  /**
   * `kindKey` of the node this group describes — one kind, or several joined by KIND_SEP.
   * A string rather than a QueryKind because it is an IDENTITY, compared across the wire
   * against the builder row's own and used as the per-kind column-preference key.
   */
  kind: string;
  label: string;
  fields: Array<{ key: string; label: string; numeric?: boolean }>;
  /** Every field this kind could show, for the column chooser. */
  available: Array<{ key: string; label: string }>;
  /**
   * Set on groups that are ALTERNATIVES rather than a sequence: they belong to different
   * branches of one OR, so no row ever fills more than one of them. The table rules between
   * them and says OR, because presenting them as consecutive column groups would read as
   * "all of this happened" when the truth is "one of these did".
   */
  altOf?: string;
  altIndex?: number;
}

/**
 * One group per shown node, in pre-order. `selected` is the chooser's state — a parallel array
 * of field-key lists, short-circuiting to the kind's defaults where it has nothing to say.
 */
export function queryColumnGroups(query: QueryNode, selected?: Array<string[] | null>): ColumnGroup[] {
  const groups: ColumnGroup[] = [];
  for (const slot of bindingSlots(query)) {
    const node = slot.node;
    if (node.show === false) continue;
    const index = groups.length;
    const offered = fieldsForKind(node.kind);
    const offeredKeys = new Set(offered.map((f) => f.key));
    const picked = (selected?.[index] ?? []).filter((k) => offeredKeys.has(k));
    const keys = picked.length ? picked : defaultFieldsForKind(node.kind).filter((k) => offeredKeys.has(k));
    groups.push({
      index,
      // `kindKey`, not `node.kind`: the builder row derives its own identity the same way, and
      // graphQueryWalk.test.js compares the two by value across the wire. A one-kind node
      // answers the bare kind, so no existing payload moves.
      kind: kindKey(node),
      label: kindsOf(node).map((k) => (k === "ANY" ? "Any node" : k)).join(" or "),
      fields: keys.map((k) => {
        const f = FIELD_BY_KEY.get(k) as FieldSpec;
        return { key: f.key, label: f.label, numeric: f.numeric };
      }),
      available: offered.map((f) => ({ key: f.key, label: f.label })),
      // Only when the group IS an alternative. Most queries have no OR in them, and stamping
      // every column group with two undefined keys would put them in the wire payload and in
      // the golden snapshot, where they read as a fact about the group rather than an absence.
      ...(slot.altOf === undefined ? {} : { altOf: slot.altOf, altIndex: slot.altIndex }),
    });
  }
  return groups;
}

/**
 * THE walk. Every node that occupies a binding slot, in pre-order.
 *
 * There used to be two of these — this one and a `walkShown` that re-derived the same order
 * while skipping hidden nodes — and everything downstream depended on them agreeing. They are
 * one now, and "shown" is read off the slot rather than being a second traversal's opinion:
 * `queryColumnGroups` filters this list, `runQuery` builds its mask from it, and `toCells`
 * indexes into it. One order, four readers, no convention to remember.
 *
 * The rule that makes this subtle: a NEGATED step asserts absence, so it binds nothing and
 * consumes no slot — and neither does anything under it. The client's `queryRows` and
 * `applyWhere` walk the same shape for the same reason; if the two sides ever disagree, every
 * filter past the divergence lands on the wrong node and the query quietly answers a different
 * question. That is what `test/graphQueryWalk.test.ts` exists to catch.
 */
function bindingSlots(node: QueryNode, path = "", alt?: Alternation): SlotInfo[] {
  const out: SlotInfo[] = [{ node, altOf: alt?.of, altIndex: alt?.index }];
  (node.steps ?? []).forEach((step, i) => out.push(...stepSlots(step, path + "." + i, alt)));
  return out;
}

interface Alternation { of: string; index: number }

export interface SlotInfo {
  node: QueryNode;
  /** The OR group whose branch this slot sits in, identified by its path. */
  altOf?: string;
  /** Which branch. Slots from different branches of one group never co-occur in a row. */
  altIndex?: number;
}

/**
 * The slots one step contributes.
 *
 * `path` only has to be STABLE and unique per group, never parsed — it is the identity two
 * column groups compare to discover they are alternatives of each other. Callers that want
 * nothing but the count pass a placeholder.
 */
function stepSlots(step: QueryStep, path: string, alt?: Alternation): SlotInfo[] {
  if (isGroup(step)) {
    const out: SlotInfo[] = [];
    step.steps.forEach((child, i) => {
      // An `and` group is transparent to alternation — its children belong to whatever branch
      // the group itself sits in. An `or` group starts a new one, innermost winning.
      const inner = step.op === "or" ? { of: path, index: i } : alt;
      out.push(...stepSlots(child, path + "." + i, inner));
    });
    return out;
  }
  if (step.negate) return [];
  return bindingSlots(step.node, path, alt);
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
  /**
   * The evidence for the query's own filters — see `WITNESSES`. Nodes and edges the question did
   * not name as steps, but which prove the properties it filtered on: the bucket chain behind
   * "reaches classified data", the exposure node behind "internet reachable".
   *
   * SEPARATE FROM `nodeIds`, not folded in, for one reason: the canvas budget must never drop a
   * MATCHED node to make room for an attachment. The two sets say different things — one is the
   * answer, the other is why — and `inducedProjection` spends the budget accordingly.
   *
   * `paths` is what makes that spending possible at all: one entry per surviving binding, holding
   * that binding's nodes AND its evidence, so the projection can admit a cluster whole or not at
   * all instead of slicing a flat list and decapitating every path in it.
   */
  witnessNodeIds: string[];
  witnessEdgeIds: string[];
  /** One per surviving binding, in row order: every node id that binding put on the canvas. */
  paths: string[][];
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

/**
 * Case-insensitive, because a filter typed as "gcp" must find `GCP`.
 *
 * ONE PER-VALUE TEST, QUANTIFIED ONCE. The comparison lives in `hit` and the quantifier sits
 * outside it, so `all` and `negate` apply identically to every field type instead of each branch
 * having to remember them. The unflagged path is `some` — exactly what this function did before
 * the flags existed, which is what keeps every stored link meaning what it meant.
 */
function matchesFilter(node: GNode, f: PropFilter): boolean {
  const v = fieldValue(node, f.key);
  const hit = (x: string): boolean => {
    if (v === null) {
      // "unknown" is a value a user can legitimately filter FOR — it is the whole point of the
      // three-state columns. Anything else does not match an absent field. This sits INSIDE the
      // per-value test now: it used to return early, above the operator branch, which made it
      // the one path a flag could not reach.
      return x === "unknown" || x === "";
    }
    const s = String(v).toLowerCase();
    const want = String(x).toLowerCase();
    // A key/value field is compared pair by pair rather than over its rendered join, so
    // `env:prod` cannot match an `env:production` by prefix and a bare `env` matches whatever
    // that key holds. Substring matching is left to `contains`, where it is asked for.
    if (f.op !== "contains" && fieldIsPairs(f.key)) return matchesTag(node, want);
    if (f.op === "contains") {
      // Substring, over the whole rendered value. A multi-value cell is already joined, so
      // "portal" finds a project list containing CE-DPCP-PORTAL without needing the split below.
      return s.indexOf(want) !== -1;
    }
    if (want === s) return true;
    // Multi-valued cells (projects, discovery methods) are joined with ", " by their getter,
    // so an exact compare would never match one project inside a list of three.
    return s.split(", ").includes(want);
  };
  const held = f.all ? f.values.every(hit) : f.values.some(hit);
  return f.negate ? !held : held;
}

/** Whether a field is a key/value list — see the `pairs` type. */
function fieldIsPairs(key: string): boolean {
  return FIELD_BY_KEY.get(key)?.type === "pairs";
}

/**
 * One tag term against a node's tags. `key:value` wants both; a bare `key` wants the key at any
 * value, which is how "has an owner tag at all" gets asked.
 */
function matchesTag(node: GNode, want: string): boolean {
  const at = want.indexOf(":");
  const wantKey = (at === -1 ? want : want.slice(0, at)).trim();
  const wantValue = at === -1 ? null : want.slice(at + 1).trim();
  return (node.tags ?? []).some((t) => {
    if (String(t.key).toLowerCase() !== wantKey) return false;
    return wantValue === null || String(t.value ?? "").toLowerCase() === wantValue;
  });
}

function matchesNode(node: GNode, q: QueryNode): boolean {
  // Several kinds match ANY of them — the whole evaluator cost of multi-kind is this line.
  const kinds = kindsOf(q);
  if (!kinds.includes("ANY") && !(kinds as string[]).includes(node.kind)) return false;
  for (const f of q.where ?? []) {
    if (!matchesFilter(node, f)) return false;
  }
  return true;
}

/** Candidate targets of one relation step, each with the edges walked to reach it. */
function stepTargets(from: GNode, step: RelationStep, adj: Adjacency): Array<{ node: GNode; edges: GEdge[] }> {
  if (step.edge === "ANY") return anyHopTargets(from, step, adj);

  const edges = (step.reverse ? adj.in.get(from.id) : adj.out.get(from.id)) ?? [];
  const seen = new Set<string>();
  const hits: Array<{ node: GNode; edges: GEdge[] }> = [];
  for (const e of edges) {
    if (e.type !== step.edge) continue;
    // A negated edge is an absence, not a relationship. Walking one would answer
    // "protected by" with a guardrail that is specifically NOT attached — so an ordinary step
    // skips them, and a `viaAbsence` witness takes ONLY them. Not a union of the two: a step
    // asking for the absence marker would be lying if it matched a real relationship as well.
    if (Boolean(e.negated) !== Boolean(step.viaAbsence)) continue;
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
function anyHopTargets(from: GNode, step: RelationStep, adj: Adjacency): Array<{ node: GNode; edges: GEdge[] }> {
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
    const sub = solveStep(step, node, adj, scan);
    // null means this step cannot be satisfied, which kills the whole binding — the steps of a
    // node are ANDed. An empty slot list is a different thing entirely (a negated step that
    // held), and must not be confused with it.
    if (sub === null) return [];
    acc = crossProduct(acc, sub, scan);
    // Truncated mid-way, so `acc` is a PREFIX: it has been through the steps so far and not
    // the rest, and every solution in it is short by the remaining steps' slots. Shipping
    // those would put rows in the table with fewer cells than the header has columns, each
    // one claiming a path that was never checked to the end. The budget is spent, so this
    // root contributes nothing; `truncated` is what tells the reader the count is a floor.
    if (scan.truncated) return [];
  }
  return acc;
}

/** The AND combine: every pairing of a left binding with a right one, under the scan budget. */
function crossProduct(left: Solution[], right: Solution[], scan: ScanState): Solution[] {
  const out: Solution[] = [];
  for (const a of left) {
    for (const b of right) {
      if (++scan.scanned > scan.max) {
        scan.truncated = true;
        return out;
      }
      out.push({ slots: a.slots.concat(b.slots), edges: a.edges.concat(b.edges) });
    }
  }
  return out;
}

/** A binding that fills `width` slots with nothing — an unmatched optional, or an OR sibling. */
function nullSolution(width: number): Solution {
  return { slots: new Array(width).fill(null) as Array<GNode | null>, edges: [] };
}

/**
 * Every way ONE step can be satisfied from `from`, or `null` if it cannot be.
 *
 * The null-versus-empty distinction is the whole contract: `null` fails the enclosing binding,
 * `[{slots: [], …}]` succeeds while contributing no columns (what a held negation looks like),
 * and anything longer contributes that many slots.
 */
function solveStep(step: QueryStep, from: GNode, adj: Adjacency, scan: ScanState): Solution[] | null {
  if (isGroup(step)) return solveGroup(step, from, adj, scan);

  const targets = stepTargets(from, step, adj);
  if (step.negate) {
    // Absence asserted. It binds nothing, so it contributes one zero-width solution — the
    // identity of the cross product — rather than no solutions, which would annihilate the row.
    return targets.length ? null : [{ slots: [], edges: [] }];
  }

  const out: Solution[] = [];
  for (const t of targets) {
    for (const sub of solutions(step.node, t.node, adj, scan)) {
      out.push({ slots: sub.slots, edges: t.edges.concat(sub.edges) });
    }
    if (scan.truncated) break;
  }
  if (out.length) return out;
  // The row survives with the whole subtree null-bound, so its column group stays in place and
  // reads as "nothing here" rather than shifting every later column one to the left.
  return step.optional ? [nullSolution(stepSlots(step, "").length)] : null;
}

/**
 * A boolean block.
 *
 * `and` is the ordinary cross product over its branches. `or` is a UNION: each branch is solved
 * independently and its bindings are padded with nulls into the group's full width, so a
 * solution always describes every branch — the one that matched, and the ones that did not.
 * Without that padding the branches would return rows of different widths and the table's
 * columns would slide out from under their headers.
 */
function solveGroup(group: GroupStep, from: GNode, adj: Adjacency, scan: ScanState): Solution[] | null {
  const widths = group.steps.map((s) => stepSlots(s, "").length);

  if (group.op === "and") {
    let acc: Solution[] = [{ slots: [], edges: [] }];
    for (const child of group.steps) {
      const sub = solveStep(child, from, adj, scan);
      if (sub === null) {
        return group.optional ? [nullSolution(total(widths))] : null;
      }
      acc = crossProduct(acc, sub, scan);
      if (scan.truncated) return [];   // a prefix, not an answer — see `solutions`
    }
    return acc;
  }

  const bound: Solution[] = [];
  const empty: Solution[] = [];
  for (let i = 0; i < group.steps.length; i++) {
    if (scan.truncated) break;
    const sub = solveStep(group.steps[i], from, adj, scan);
    if (sub === null) continue; // this branch simply did not match; the others still can
    const before = total(widths.slice(0, i));
    const after = total(widths.slice(i + 1));
    for (const s of sub) {
      const solution: Solution = {
        slots: (new Array(before).fill(null) as Array<GNode | null>)
          .concat(s.slots, new Array(after).fill(null) as Array<GNode | null>),
        edges: s.edges,
      };
      (s.slots.some((n) => n !== null) ? bound : empty).push(solution);
    }
  }

  // A branch that HELD WITHOUT BINDING — a negation, or an all-optional subtree — produces a
  // row with every cell empty. Such a row is subsumed by any bound row for the same asset: it
  // agrees everywhere and shows less, so "runs as an identity OR has no model" would list an
  // agent that does both twice, once with the identity and once with nothing, and the second
  // row could not say why it was there. Bound answers win; the empty one is the fallback, and
  // collapses to a single row so that "no model OR no guardrail" does not report an agent
  // missing both as two identical blanks.
  if (bound.length) return bound;
  if (empty.length) return [empty[0]];
  return group.optional ? [nullSolution(total(widths))] : null;
}

function total(ns: number[]): number {
  let sum = 0;
  for (const n of ns) sum += n;
  return sum;
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
  const slots = bindingSlots(query);
  const shownMask = slots.map((slot) => slot.node.show !== false);
  // The evidence each slot's own filters ask for, over the SAME pre-order — so slot i's witness
  // runs from slot i's bound node and a filter on a non-root node hangs its evidence off that
  // node, not off the root. Built once beside `shownMask` because it is the same walk.
  const witnessOf = slots.map((slot) => witnessFor(slot.node));
  const anyWitness = witnessOf.some(Boolean);
  const groupFields = groups.map((g) => g.fields.map((f) => f.key));

  const roots = doc.nodes
    .filter((n) => matchesNode(n, query))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity)
      || (b.aars ?? -1) - (a.aars ?? -1)
      || cmp(a.name, b.name));

  const rows: QueryRow[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const witnessNodeIds = new Set<string>();
  const witnessEdgeIds = new Set<string>();
  const paths: string[][] = [];
  let total = 0;

  for (const root of roots) {
    for (const sol of solutions(query, root, adj, scan)) {
      total += 1;
      if (rows.length < rowMax) {
        rows.push({ cells: toCells(sol.slots, shownMask, groupFields) });
        // This binding's own nodes, kept as a group as well as merged into the flat set. The
        // group is what lets the canvas budget admit a path whole — see `QueryResult.paths`.
        const mine: string[] = [];
        const mineAdd = (id: string) => {
          if (!mine.includes(id)) mine.push(id);
        };
        // Only surviving, SHIPPED paths contribute to the canvas. A path counted past the row
        // cap is real, but drawing nodes the table cannot show would put the two views out of
        // step with no way for the reader to tell which one to believe.
        for (const n of sol.slots) if (n) { nodeIds.add(n.id); mineAdd(n.id); }
        for (const e of sol.edges) {
          edgeIds.add(e.id);
          // Both endpoints, not just the bound slots. A multi-hop ANY step walks THROUGH nodes
          // the query never named — agent → service account → bucket names two of the three —
          // and shipping an edge whose middle node is absent leaves the canvas with an edge
          // pointing at nothing.
          nodeIds.add(e.src);
          nodeIds.add(e.dst);
          mineAdd(e.src);
          mineAdd(e.dst);
        }
        // THE EVIDENCE, if any filter armed one. Run from each bound node rather than from the
        // root, so slot i's filter explains slot i. Same engine, same scan budget: a witness is
        // a query, and this is the query engine.
        if (anyWitness) {
          sol.slots.forEach((bound, i) => {
            const witness = witnessOf[i];
            if (!bound || !witness) return;
            let taken = 0;
            for (const found of solutions(witness, bound, adj, scan)) {
              if (taken++ >= WITNESS_FANOUT_CAP) break;
              // The witness root IS `bound`, already counted above — `solutions` seeds its first
              // slot with the node it was handed. Only what it reached is evidence.
              for (const n of found.slots) {
                if (!n || n.id === bound.id) continue;
                witnessNodeIds.add(n.id);
                mineAdd(n.id);
              }
              for (const e of found.edges) {
                witnessEdgeIds.add(e.id);
                for (const end of [e.src, e.dst]) {
                  if (end !== bound.id) witnessNodeIds.add(end);
                  mineAdd(end);
                }
              }
            }
          });
        }
        paths.push(mine);
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
    witnessNodeIds: [...witnessNodeIds],
    witnessEdgeIds: [...witnessEdgeIds],
    paths,
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
