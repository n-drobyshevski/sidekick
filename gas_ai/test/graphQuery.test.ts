// The path query engine: validation at the RPC boundary, the vocabulary the builder offers,
// and the binding rules that make a ROW A PATH rather than a node.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  MAX_QUERY_NODES,
  QueryError,
  QUERY_FIELDS,
  QUERY_SHORTCUTS,
  VALUE_CARDINALITY_MAX,
  type QueryNode,
  type QueryStep,
  type RelationStep,
  isGroup,
  defaultFieldsForKind,
  fieldValuesFor,
  fieldsForKind,
  humanDiscoveryMethod,
  queryColumnGroups,
  queryVocabulary,
  runQuery,
  shortcutsFor,
  validateQuery,
  validateQueryWithWarnings,
  type QueryShortcut,
} from "../src/domain/graphQuery";
import { EDGE_TYPES, NODE_KINDS } from "../src/domain/graphTypes";
import { conditionHolds } from "../src/domain/riskConditions";
import { enrichGraphDoc, withMissingGuardrailNodes } from "../src/domain/graphEnrich";
import { SEED_AARS_HINTS, SEED_ISSUES, seedGraphDoc } from "../src/server/sampleData";
import type { GraphDoc, NodeKind } from "../src/domain/graphTypes";

const DOC: GraphDoc = enrichGraphDoc(seedGraphDoc("2026-06-28T05:00:00Z"), SEED_ISSUES, SEED_AARS_HINTS);

/** The screenshot's query: FIND AI Agent THAT runs as Service Account. */
const AGENT_RUNS_AS_SA: QueryNode = {
  kind: "AI_AGENT",
  steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } }],
};

describe("validateQuery", () => {
  it("accepts the default lens and the screenshot query", () => {
    expect(validateQuery(DEFAULT_QUERY)).toEqual({ kind: "AI_AGENT" });
    expect(validateQuery(AGENT_RUNS_AS_SA)).toEqual(AGENT_RUNS_AS_SA);
  });

  it("rejects an unknown kind by name rather than returning nothing", () => {
    // Silently answering zero would read as "your landscape is clean", which is the one wrong
    // answer a security tool must never give.
    expect(() => validateQuery({ kind: "AI_ROBOT" })).toThrow(QueryError);
    expect(() => validateQuery({ kind: "AI_ROBOT" })).toThrow(/unknown node kind/);
  });

  it("rejects an unknown relationship and an unknown filter field", () => {
    expect(() => validateQuery({ kind: "AI_AGENT", steps: [{ edge: "BEFRIENDS", node: { kind: "AI_AGENT" } }] }))
      .toThrow(/unknown relationship/);
    expect(() => validateQuery({ kind: "AI_AGENT", where: [{ key: "vibes", values: ["good"] }] }))
      .toThrow(/unknown filter field/);
  });

  it("allows filtering on id, which is what every deep link lands on", () => {
    const q = validateQuery({ kind: "AI_AGENT", where: [{ key: "id", values: ["agent-a"] }] });
    expect(q.where).toEqual([{ key: "id", values: ["agent-a"] }]);
  });

  it("caps the tree so a hand-edited URL cannot spend the execution budget", () => {
    let deep: QueryNode = { kind: "AI_AGENT" };
    for (let i = 0; i < MAX_QUERY_NODES + 2; i++) deep = { kind: "AI_AGENT", steps: [{ edge: "USES", node: deep }] };
    expect(() => validateQuery(deep)).toThrow(QueryError);
  });

  it("refuses a negated step that carries further steps", () => {
    // Nothing bound, so there is nothing to walk from; dropping the subtree silently would
    // lose work the user did in the builder.
    expect(() => validateQuery({
      kind: "AI_AGENT",
      steps: [{
        edge: "PROTECTED_BY", negate: true,
        node: { kind: "AI_GUARDRAIL", steps: [{ edge: "USES", node: { kind: "AI_MODEL" } }] },
      }],
    })).toThrow(/negated relationship cannot carry further steps/);
  });

  it("clamps hops and only reads them on an ANY edge", () => {
    const q = validateQuery({ kind: "AI_AGENT", steps: [{ edge: "ANY", hops: 99, node: { kind: "ANY" } }] });
    expect(relation(q.steps?.[0]).hops).toBe(3);
    const typed = validateQuery({ kind: "AI_AGENT", steps: [{ edge: "RUNS_AS", hops: 3, node: { kind: "SERVICE_ACCOUNT" } }] });
    expect(relation(typed.steps?.[0]).hops).toBeUndefined();
  });
});

/** Narrow a step to a relation, failing loudly if a group turned up where one was not expected. */
function relation(step: QueryStep | undefined): RelationStep {
  if (!step || isGroup(step)) throw new Error("expected a relation step, got " + JSON.stringify(step));
  return step;
}

describe("queryVocabulary", () => {
  const vocab = queryVocabulary(DOC);

  it("offers only kinds the graph actually holds, in declaration order", () => {
    const kinds = vocab.kinds.map((k) => k.kind);
    expect(kinds).toContain("AI_AGENT");
    expect(kinds).toContain("SERVICE_ACCOUNT");
    expect(kinds.indexOf("AI_AGENT")).toBeLessThan(kinds.indexOf("SERVICE_ACCOUNT"));
    for (const entry of vocab.kinds) expect(entry.count).toBeGreaterThan(0);
  });

  it("knows an AI agent can run as a service account, forwards and backwards", () => {
    const fromAgent = vocab.stepsFrom["AI_AGENT"] ?? [];
    expect(fromAgent).toContainEqual(expect.objectContaining({ edge: "RUNS_AS", reverse: false, kind: "SERVICE_ACCOUNT" }));
    const fromSa = vocab.stepsFrom["SERVICE_ACCOUNT"] ?? [];
    expect(fromSa).toContainEqual(expect.objectContaining({ edge: "RUNS_AS", reverse: true, kind: "AI_AGENT" }));
  });

  it("never offers a negated edge as something to walk", () => {
    // A negated PROTECTED_BY records that no guardrail is attached. Offering it as a step
    // would let the builder construct "protected by the guardrail that isn't there".
    const onlyNegated: GraphDoc = {
      syncedAt: DOC.syncedAt,
      nodes: [
        { id: "a", kind: "AI_AGENT", name: "unguarded" },
        { id: "g", kind: "AI_GUARDRAIL", name: "absent" },
      ],
      edges: [{ id: "e1", src: "a", dst: "g", type: "PROTECTED_BY", negated: true }],
    };
    expect(queryVocabulary(onlyNegated).stepsFrom).toEqual({});
  });
});

describe("runQuery", () => {
  it("FIND AI Agent returns one row per agent", () => {
    const agents = DOC.nodes.filter((n) => n.kind === "AI_AGENT");
    const res = runQuery(DOC, validateQuery({ kind: "AI_AGENT" }));
    expect(res.total).toBe(agents.length);
    expect(res.rows).toHaveLength(agents.length);
    expect(res.capped).toBe(false);
    expect(res.truncated).toBe(false);
  });

  it("adding a THAT step turns entities into paths", () => {
    const res = runQuery(DOC, validateQuery(AGENT_RUNS_AS_SA));
    // Not every RUNS_AS lands on a service account — the seed also gives one agent an
    // agentic ACCESS_KEY, and the query asked for identities of one kind.
    const byId = new Map(DOC.nodes.map((n) => [n.id, n]));
    const bindings = DOC.edges.filter((e) =>
      e.type === "RUNS_AS" && !e.negated && byId.get(e.dst)?.kind === "SERVICE_ACCOUNT");
    expect(res.total).toBe(bindings.length);
    // Two cells per row: the agent's group and the service account's.
    for (const row of res.rows) {
      expect(row.cells).toHaveLength(2);
      expect(row.cells[0]?.kind).toBe("AI_AGENT");
      expect(row.cells[1]?.kind).toBe("SERVICE_ACCOUNT");
    }
  });

  it("an agent bound to two identities is two rows carrying the same name", () => {
    const doc: GraphDoc = {
      syncedAt: DOC.syncedAt,
      nodes: [
        { id: "a", kind: "AI_AGENT", name: "twin" },
        { id: "sa1", kind: "SERVICE_ACCOUNT", name: "sa-one" },
        { id: "sa2", kind: "SERVICE_ACCOUNT", name: "sa-two" },
      ],
      edges: [
        { id: "e1", src: "a", dst: "sa1", type: "RUNS_AS" },
        { id: "e2", src: "a", dst: "sa2", type: "RUNS_AS" },
      ],
    };
    const res = runQuery(doc, validateQuery(AGENT_RUNS_AS_SA));
    expect(res.total).toBe(2);
    expect(res.rows.map((r) => r.cells[0]?.name)).toEqual(["twin", "twin"]);
    expect(res.rows.map((r) => r.cells[1]?.name).sort()).toEqual(["sa-one", "sa-two"]);
    expect(res.nodeIds.sort()).toEqual(["a", "sa1", "sa2"]);
    expect(res.edgeIds.sort()).toEqual(["e1", "e2"]);
  });

  it("a required step with no match drops the row; optional keeps it null-bound", () => {
    const doc: GraphDoc = {
      syncedAt: DOC.syncedAt,
      nodes: [
        { id: "a", kind: "AI_AGENT", name: "bound" },
        { id: "b", kind: "AI_AGENT", name: "lonely" },
        { id: "sa1", kind: "SERVICE_ACCOUNT", name: "sa-one" },
      ],
      edges: [{ id: "e1", src: "a", dst: "sa1", type: "RUNS_AS" }],
    };
    const required = runQuery(doc, validateQuery(AGENT_RUNS_AS_SA));
    expect(required.rows.map((r) => r.cells[0]?.name)).toEqual(["bound"]);

    const optional = runQuery(doc, validateQuery({
      kind: "AI_AGENT",
      steps: [{ edge: "RUNS_AS", optional: true, node: { kind: "SERVICE_ACCOUNT" } }],
    }));
    expect(optional.total).toBe(2);
    const lonely = optional.rows.find((r) => r.cells[0]?.name === "lonely");
    // The group stays in place, so later columns do not slide left by one.
    expect(lonely?.cells).toHaveLength(2);
    expect(lonely?.cells[1]).toBeNull();
  });

  it("negate asserts absence, binds nothing, and contributes no column", () => {
    const q = validateQuery({
      kind: "AI_AGENT",
      steps: [{ edge: "PROTECTED_BY", negate: true, node: { kind: "AI_GUARDRAIL" } }],
    });
    const res = runQuery(DOC, q);
    for (const row of res.rows) expect(row.cells).toHaveLength(1);

    // Every AGENT the read-time topology hangs a MISSING_GUARDRAIL stub off must also answer
    // this query — the two derive "no guardrail" from different places (a synced flag vs. the
    // absence of an edge) and must not disagree. The stubs also cover non-agent AI assets,
    // which this query never asked for, so the comparison is scoped to agents.
    const agentIds = new Set(DOC.nodes.filter((n) => n.kind === "AI_AGENT").map((n) => n.id));
    const unguarded = withMissingGuardrailNodes(DOC).nodes
      .filter((n) => n.kind === "MISSING_GUARDRAIL")
      .map((n) => n.id.split("|")[1])
      .filter((id) => agentIds.has(id));
    expect(unguarded.length).toBeGreaterThan(0);
    const found = new Set(res.rows.map((r) => r.cells[0]?.id));
    for (const id of unguarded) expect(found.has(id)).toBe(true);
  });

  it("a hidden node still constrains the match but takes no column", () => {
    const shown = runQuery(DOC, validateQuery(AGENT_RUNS_AS_SA));
    const hidden = runQuery(DOC, validateQuery({
      kind: "AI_AGENT",
      steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT", show: false } }],
    }));
    expect(hidden.total).toBe(shown.total);
    for (const row of hidden.rows) expect(row.cells).toHaveLength(1);
    // The waypoint is still on the canvas — it is on the path.
    expect(hidden.nodeIds.length).toBe(shown.nodeIds.length);
  });

  it("filters narrow the node they sit on, case-insensitively, and match inside list cells", () => {
    const one = runQuery(DOC, validateQuery({ kind: "AI_AGENT", where: [{ key: "id", values: ["agent-a"] }] }));
    expect(one.total).toBe(1);
    expect(one.rows[0].cells[0]?.id).toBe("agent-a");

    const gcp = runQuery(DOC, validateQuery({ kind: "AI_AGENT", where: [{ key: "cloud", values: ["gcp"] }] }));
    expect(gcp.total).toBeGreaterThan(0);
    expect(gcp.total).toBe(DOC.nodes.filter((n) => n.kind === "AI_AGENT" && n.cloudPlatform === "GCP").length);
  });

  it("ANY hops is the old depth slider, and carries the route back for the canvas", () => {
    const q = validateQuery({
      kind: "AI_AGENT",
      where: [{ key: "id", values: ["agent-a"] }],
      steps: [{ edge: "ANY", hops: 2, node: { kind: "BUCKET" } }],
    });
    const res = runQuery(DOC, q);
    expect(res.total).toBeGreaterThan(0);
    // agent-a -RUNS_AS-> sa-agent-a -ALLOWS_ACCESS_TO-> bucket: the waypoint is on the canvas
    // even though the query never named it.
    expect(res.nodeIds).toContain("sa-agent-a");
    expect(res.edgeIds.length).toBeGreaterThanOrEqual(2);
  });

  it("caps rows while keeping the total exact", () => {
    const res = runQuery(DOC, validateQuery({ kind: "AI_AGENT" }), { rowMax: 3 });
    const agents = DOC.nodes.filter((n) => n.kind === "AI_AGENT").length;
    expect(res.rows).toHaveLength(3);
    expect(res.total).toBe(agents);
    expect(res.capped).toBe(true);
    expect(res.truncated).toBe(false);
  });

  it("reports truncation rather than silently enumerating forever", () => {
    const res = runQuery(DOC, validateQuery(AGENT_RUNS_AS_SA), { scanMax: 2 });
    expect(res.truncated).toBe(true);
  });

  it("ships no row it did not check to the END, however the budget runs out", () => {
    // Truncating mid-way used to return the accumulator built so far — a PREFIX that had been
    // through the first steps and not the rest. Those rows reached the table short of cells,
    // each one claiming a path nothing had verified: a three-group query answered with
    // two-cell rows, and `total` counted them. Under-reporting is the honest failure here;
    // over-reporting unchecked paths is not.
    // The WIDE step first: an agent with several issues exhausts the budget inside step one,
    // leaving step two unevaluated. Ordered the other way the budget happens to run out after
    // the last step, and the prefix never forms — which is why this case is written by hand
    // rather than trusted to whichever query came to mind.
    const deep: QueryNode = {
      kind: "AI_AGENT",
      steps: [
        { edge: "HAS_ISSUE", node: { kind: "ISSUE" } },
        { edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } },
      ],
    };
    const width = queryColumnGroups(validateQuery(deep)).length;
    expect(width).toBe(3);
    const uncapped = runQuery(DOC, validateQuery(deep));
    for (const scanMax of [1, 2, 3, 5, 10, 25, 50]) {
      const res = runQuery(DOC, validateQuery(deep), { scanMax });
      expect(res.rows.length, "scanMax " + scanMax).toBe(res.total);
      expect(res.total, "scanMax " + scanMax).toBeLessThanOrEqual(uncapped.total);
      for (const row of res.rows) {
        expect(row.cells.length, "scanMax " + scanMax).toBe(width);
        // NEITHER step is optional, so every group on a returned row must be BOUND. A blank
        // one is a step the evaluator never got to, on a row it counted anyway — the exact
        // shape of the bug: `toCells` pads a short binding out to the column count, so the
        // row looks whole and only the blank cell says the path was never checked.
        for (let i = 0; i < width; i++) {
          expect(row.cells[i], "scanMax " + scanMax + ", group " + i).toBeTruthy();
        }
      }
    }
  });
});

describe("columns", () => {
  it("defaults reproduce the screenshot's two column groups", () => {
    const groups = queryColumnGroups(validateQuery(AGENT_RUNS_AS_SA));
    expect(groups.map((g) => g.kind)).toEqual(["AI_AGENT", "SERVICE_ACCOUNT"]);
    expect(groups[0].fields.map((f) => f.key)).toEqual(["name", "publisher", "discoveredBy"]);
    expect(groups[1].fields.map((f) => f.key)).toEqual(["name", "displayName", "inactive"]);
  });

  it("only offers a field the kind can answer, and ignores a chooser asking for one it cannot", () => {
    expect(fieldsForKind("SERVICE_ACCOUNT").map((f) => f.key)).not.toContain("publisher");
    expect(defaultFieldsForKind("BUCKET")).toEqual(["name", "kind", "cloud"]);
    const groups = queryColumnGroups(validateQuery({ kind: "SERVICE_ACCOUNT" }), [["publisher", "name"]]);
    expect(groups[0].fields.map((f) => f.key)).toEqual(["name"]);
  });

  it("an absent property is null, never a fabricated false or empty string", () => {
    const doc: GraphDoc = {
      syncedAt: DOC.syncedAt,
      nodes: [{ id: "sa", kind: "SERVICE_ACCOUNT", name: "svc" }],
      edges: [],
    };
    const res = runQuery(doc, validateQuery({ kind: "SERVICE_ACCOUNT" }));
    expect(res.rows[0].cells[0]?.fields).toEqual({ name: "svc", displayName: null, inactive: null });
  });

  it("reads Wiz's discovery methods as words", () => {
    expect(humanDiscoveryMethod("MethodCloudScanning")).toBe("Cloud Scanning");
    expect(humanDiscoveryMethod("MethodWorkloadScanning")).toBe("Workload Scanning");
    expect(humanDiscoveryMethod("SomethingNew")).toBe("Something New");
  });
});

// ---------------------------------------------------------------- AND / OR groups

/**
 * A four-node fixture with a deliberate asymmetry: `both` satisfies either branch, `sa-only`
 * and `model-only` satisfy exactly one, and `neither` satisfies none. Every OR assertion below
 * reads off that shape, so a change in semantics shows up as a specific row moving rather than
 * as a count nobody can reason about.
 */
const BRANCHES: GraphDoc = {
  syncedAt: DOC.syncedAt,
  nodes: [
    { id: "both", kind: "AI_AGENT", name: "both" },
    { id: "sa-only", kind: "AI_AGENT", name: "sa-only" },
    { id: "model-only", kind: "AI_AGENT", name: "model-only" },
    { id: "neither", kind: "AI_AGENT", name: "neither" },
    { id: "sa1", kind: "SERVICE_ACCOUNT", name: "sa-one" },
    { id: "sa2", kind: "SERVICE_ACCOUNT", name: "sa-two" },
    { id: "m1", kind: "AI_MODEL", name: "model-one" },
  ],
  edges: [
    { id: "e1", src: "both", dst: "sa1", type: "RUNS_AS" },
    { id: "e2", src: "both", dst: "m1", type: "USES_MODEL" },
    { id: "e3", src: "sa-only", dst: "sa2", type: "RUNS_AS" },
    { id: "e4", src: "model-only", dst: "m1", type: "USES_MODEL" },
  ],
};

const OR_QUERY = {
  kind: "AI_AGENT",
  steps: [{
    op: "or",
    steps: [
      { edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } },
      { edge: "USES_MODEL", node: { kind: "AI_MODEL" } },
    ],
  }],
};

describe("AND / OR groups", () => {
  it("validates a group and rejects a bad operator or an empty one", () => {
    expect(validateQuery(OR_QUERY)).toEqual(OR_QUERY);
    expect(() => validateQuery({ kind: "AI_AGENT", steps: [{ op: "xor", steps: [] }] }))
      .toThrow(/unknown group operator/);
    expect(() => validateQuery({ kind: "AI_AGENT", steps: [{ op: "or", steps: [] }] }))
      .toThrow(/needs at least one branch/);
  });

  it("OR is a union, not a cross product", () => {
    const res = runQuery(BRANCHES, validateQuery(OR_QUERY));
    // both(2) + sa-only(1) + model-only(1); `neither` satisfies no branch and is dropped.
    expect(res.total).toBe(4);
    expect(res.rows.map((r) => r.cells[0]?.name).sort())
      .toEqual(["both", "both", "model-only", "sa-only"]);
  });

  it("reserves every branch's slots and nulls the ones that did not match", () => {
    const res = runQuery(BRANCHES, validateQuery(OR_QUERY));
    // Three groups on every row: the agent, then one per branch — even though no row can ever
    // fill both branches at once. That is what keeps the table rectangular.
    for (const row of res.rows) expect(row.cells).toHaveLength(3);

    const saOnly = res.rows.find((r) => r.cells[0]?.name === "sa-only");
    expect(saOnly?.cells[1]?.name).toBe("sa-two");
    expect(saOnly?.cells[2]).toBeNull();

    const modelOnly = res.rows.find((r) => r.cells[0]?.name === "model-only");
    expect(modelOnly?.cells[1]).toBeNull();
    expect(modelOnly?.cells[2]?.name).toBe("model-one");
  });

  it("marks the branches as alternatives so the table can say OR rather than AND", () => {
    const groups = queryColumnGroups(validateQuery(OR_QUERY));
    expect(groups[0].altOf).toBeUndefined();
    expect(groups[1].altOf).toBeDefined();
    expect(groups[1].altOf).toBe(groups[2].altOf);
    expect([groups[1].altIndex, groups[2].altIndex]).toEqual([0, 1]);
  });

  it("drops the row when no branch matches, unless the group is optional", () => {
    const optional = validateQuery({ ...OR_QUERY, steps: [{ ...OR_QUERY.steps[0], optional: true }] });
    const res = runQuery(BRANCHES, optional);
    const neither = res.rows.find((r) => r.cells[0]?.name === "neither");
    expect(neither).toBeDefined();
    expect(neither?.cells).toHaveLength(3);
    expect(neither?.cells[1]).toBeNull();
    expect(neither?.cells[2]).toBeNull();
  });

  it("AND inside OR still cross-products, and mixes with a plain step", () => {
    // "an agent that uses a model AND (runs as an identity OR uses a model)" — the plain step
    // narrows to the two model users, then the OR unions over them.
    const mixed = validateQuery({
      kind: "AI_AGENT",
      steps: [
        { edge: "USES_MODEL", node: { kind: "AI_MODEL" } },
        OR_QUERY.steps[0],
      ],
    });
    const res = runQuery(BRANCHES, mixed);
    expect(res.rows.map((r) => r.cells[0]?.name).sort()).toEqual(["both", "both", "model-only"]);
    // agent + model + two OR branches
    for (const row of res.rows) expect(row.cells).toHaveLength(4);
  });

  it("a negated branch holds without binding anything", () => {
    // "runs as an identity OR has no model" — `neither` qualifies on the second branch.
    const res = runQuery(BRANCHES, validateQuery({
      kind: "AI_AGENT",
      steps: [{
        op: "or",
        steps: [
          { edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } },
          { edge: "USES_MODEL", negate: true, node: { kind: "AI_MODEL" } },
        ],
      }],
    }));
    expect(res.rows.map((r) => r.cells[0]?.name).sort()).toEqual(["both", "neither", "sa-only"]);
    // The negated branch reserves no slot, so there are only two groups.
    for (const row of res.rows) expect(row.cells).toHaveLength(2);
  });

  it("keeps every walk in step: slots, mask, column groups and cells agree", () => {
    // The invariant the whole design rests on. If these ever disagree, values slide off their
    // headers silently — no error, just a table quietly describing something else.
    for (const q of [OR_QUERY, { kind: "AI_AGENT", steps: [OR_QUERY.steps[0], { edge: "USES_MODEL", node: { kind: "AI_MODEL", show: false } }] }]) {
      const query = validateQuery(q);
      const res = runQuery(BRANCHES, query);
      const groups = queryColumnGroups(query);
      expect(groups).toHaveLength(res.groups.length);
      for (const row of res.rows) expect(row.cells).toHaveLength(groups.length);
    }
  });
});

describe("OR subsumption", () => {
  it("prefers a bound branch over one that merely held, and collapses blanks to one", () => {
    // "runs as an identity OR has no model". `sa-only` satisfies both — it must appear once,
    // carrying the identity, not twice with the second row unable to say why it matched.
    const res = runQuery(BRANCHES, validateQuery({
      kind: "AI_AGENT",
      steps: [{
        op: "or",
        steps: [
          { edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } },
          { edge: "USES_MODEL", negate: true, node: { kind: "AI_MODEL" } },
        ],
      }],
    }));
    const names = res.rows.map((r) => r.cells[0]?.name).sort();
    expect(names).toEqual(["both", "neither", "sa-only"]);
    expect(res.rows.find((r) => r.cells[0]?.name === "sa-only")?.cells[1]?.name).toBe("sa-two");
    // `neither` matched on the negation alone, so its identity cell is empty rather than absent.
    expect(res.rows.find((r) => r.cells[0]?.name === "neither")?.cells[1]).toBeNull();
  });

  it("an agent failing two negated branches at once is still one row", () => {
    const res = runQuery(BRANCHES, validateQuery({
      kind: "AI_AGENT",
      steps: [{
        op: "or",
        steps: [
          { edge: "RUNS_AS", negate: true, node: { kind: "SERVICE_ACCOUNT" } },
          { edge: "USES_MODEL", negate: true, node: { kind: "AI_MODEL" } },
        ],
      }],
    }));
    // `neither` has no identity AND no model; both branches hold, and it appears once.
    expect(res.rows.filter((r) => r.cells[0]?.name === "neither")).toHaveLength(1);
    expect(res.rows.map((r) => r.cells[0]?.name).sort()).toEqual(["model-only", "neither", "sa-only"]);
  });
});

describe("filter vocabulary", () => {
  it("gives every field a type, so the palette knows what control to draw", () => {
    for (const f of QUERY_FIELDS) {
      expect(["text", "choice", "boolean", "number", "pairs"]).toContain(f.type);
    }
    const typeOf = (key: string) => QUERY_FIELDS.find((f) => f.key === key)?.type;
    expect(typeOf("name")).toBe("text");
    expect(typeOf("cloud")).toBe("choice");
    expect(typeOf("inactive")).toBe("boolean");
    expect(typeOf("openIssues")).toBe("number");
    // The verdicts are gone from the vocabulary, not renamed inside it.
    expect(typeOf("aars")).toBeUndefined();
    expect(typeOf("postureTier")).toBeUndefined();
    expect(typeOf("tags")).toBe("pairs");
  });

  it("contains is a substring where eq is the whole value", () => {
    const exact = runQuery(DOC, validateQuery({
      kind: "AI_AGENT", where: [{ key: "name", values: ["agent"] }],
    }));
    expect(exact.total).toBe(0); // no agent is named exactly "agent"

    const sub = runQuery(DOC, validateQuery({
      kind: "AI_AGENT", where: [{ key: "name", values: ["agent"], op: "contains" }],
    }));
    expect(sub.total).toBeGreaterThan(0);
    for (const row of sub.rows) {
      expect(String(row.cells[0]?.name).toLowerCase()).toContain("agent");
    }
  });

  it("rejects an operator it does not implement", () => {
    expect(() => validateQuery({
      kind: "AI_AGENT", where: [{ key: "name", values: ["x"], op: "startsWith" }],
    })).toThrow(/unknown filter operator/);
  });

  // The two quantifier flags. What matters most here is the FIRST test: every filter written
  // before these existed carries neither, and has to keep meaning exactly what it meant.
  describe("all and negate", () => {
    const run = (where: unknown[]) =>
      runQuery(DOC, validateQuery({ kind: "AI_AGENT", where }));
    const names = (r: ReturnType<typeof runQuery>) =>
      r.rows.map((x) => x.cells[0]?.name).sort();

    it("leaves an unflagged filter meaning what it always meant", () => {
      const clouds = [...new Set(DOC.nodes.filter((n) => n.kind === "AI_AGENT")
        .map((n) => n.cloudPlatform).filter(Boolean))] as string[];
      expect(clouds.length).toBeGreaterThan(0);
      // Values OR: the union of the single-value answers, exactly.
      const both = run([{ key: "cloud", values: clouds }]);
      const union = new Set(clouds.flatMap((c) => names(run([{ key: "cloud", values: [c] }]))));
      expect(names(both)).toEqual([...union].sort());
    });

    it("negate keeps precisely the rows the same filter drops", () => {
      const yes = run([{ key: "cloud", values: ["GCP"] }]);
      const no = run([{ key: "cloud", values: ["GCP"], negate: true }]);
      const all = run([]);
      expect(yes.total + no.total).toBe(all.total);
      expect([...names(yes), ...names(no)].sort()).toEqual(names(all));
    });

    it("negate keeps a node whose field is absent, rather than leaving it in neither half", () => {
      // The tension named on PropFilter.negate: absent is its own answer for a tri-state
      // column, but a node with no cloud at all genuinely is not GCP, and "is" plus "is not"
      // have to partition the landscape or something is silently in neither.
      const noCloud = DOC.nodes.find((n) => n.kind === "AI_AGENT" && !n.cloudPlatform);
      if (noCloud) {
        expect(names(run([{ key: "cloud", values: ["GCP"], negate: true }])))
          .toContain(noCloud.name);
      }
    });

    it("all requires every value where the default requires one", () => {
      // The getter renders projects by NAME and joins them, which is what a filter compares to.
      const listed = DOC.nodes.find((n) => n.kind === "AI_AGENT"
        && (n.projects ?? []).filter((p) => p.name).length > 1);
      if (!listed) return;
      const two = (listed.projects ?? []).map((p) => p.name).filter(Boolean).slice(0, 2);
      const any = run([{ key: "projects", values: two }]);
      const every = run([{ key: "projects", values: two, all: true }]);
      expect(every.total).toBeLessThanOrEqual(any.total);
      expect(names(every)).toContain(listed.name);
      // A value the node cannot have makes `all` fail while `any` still holds.
      const impossible = run([{ key: "projects", values: [two[0], "NO-SUCH-PROJECT"], all: true }]);
      expect(names(impossible)).not.toContain(listed.name);
      expect(names(run([{ key: "projects", values: [two[0], "NO-SUCH-PROJECT"] }])))
        .toContain(listed.name);
    });

    it("composes the two into 'has none of these'", () => {
      const listed = DOC.nodes.find((n) => n.kind === "AI_AGENT"
        && (n.projects ?? []).some((p) => p.name));
      if (!listed) return;
      const mine = (listed.projects ?? []).map((p) => p.name).filter(Boolean)[0];
      expect(names(run([{ key: "projects", values: [mine], negate: true }])))
        .not.toContain(listed.name);
    });

    it("rejects a flag that is not a boolean", () => {
      expect(() => validateQuery({
        kind: "AI_AGENT", where: [{ key: "name", values: ["x"], all: "yes" }],
      })).toThrow(/all must be a boolean/);
      expect(() => validateQuery({
        kind: "AI_AGENT", where: [{ key: "name", values: ["x"], negate: 1 }],
      })).toThrow(/negate must be a boolean/);
    });

    it("carries the flags through validation instead of dropping them", () => {
      // The validator rebuilds a filter key by key, so a flag has to be named in the guard AND
      // in the assignment. One without the other is a silently different query.
      expect(validateQuery({
        kind: "AI_AGENT", where: [{ key: "cloud", values: ["GCP"], all: true, negate: true }],
      }).where).toEqual([{ key: "cloud", values: ["GCP"], all: true, negate: true }]);
    });
  });

  // Tags were synced and shown on the asset sheet long before they were askable. The sample
  // landscape now carries three tagged agents with DELIBERATELY OVERLAPPING sets, because that is
  // the only shape that can tell the four readings apart:
  //
  //   Agent-A   env:prod     team:ml       owner:platform
  //   Agent-B   env:prod     team:search
  //   dev-agent-D  env:staging  team:ml
  //
  describe("tags", () => {
    const hit = (values: string[], extra: object = {}) =>
      runQuery(DOC, validateQuery({ kind: "AI_AGENT", where: [{ key: "tags", values, ...extra }] }))
        .rows.map((r) => r.cells[0]?.name).sort();

    it("has a tagged fixture at all, so the rest of this block is not vacuous", () => {
      expect(DOC.nodes.filter((n) => (n.tags ?? []).length > 0).length).toBeGreaterThanOrEqual(3);
    });

    it("matches a key and value together, and a bare key at any value", () => {
      expect(hit(["env:prod"])).toEqual(["Agent-A", "Agent-B"]);
      // The key alone asks "has this tag at all", which is the question a value list cannot pose.
      expect(hit(["env"])).toEqual(["Agent-A", "Agent-B", "dev-agent-D"]);
      // A value that only shares a prefix must not match — pairs are compared pair by pair,
      // never as a substring of the rendered join, which is what `contains` would have done.
      expect(hit(["env:prod-nope"])).toEqual([]);
      expect(hit(["env:pro"])).toEqual([]);
    });

    it("tells the four readings apart on the same two terms", () => {
      const terms = ["env:prod", "team:ml"];
      expect(hit(terms)).toEqual(["Agent-A", "Agent-B", "dev-agent-D"]);   // any
      expect(hit(terms, { all: true })).toEqual(["Agent-A"]);              // all
      const none = hit(terms, { negate: true });                          // none
      expect(none).not.toContain("Agent-A");
      expect(none).not.toContain("Agent-B");
      const notAll = hit(terms, { all: true, negate: true });              // not all
      expect(notAll).not.toContain("Agent-A");
      expect(notAll).toContain("Agent-B");
    });

    it("counts an untagged node as holding none of them", () => {
      const bare = DOC.nodes.find((n) => n.kind === "AI_AGENT" && !(n.tags ?? []).length);
      expect(bare).toBeDefined();
      expect(hit(["env:prod"])).not.toContain(bare!.name);
      expect(hit(["env:prod"], { negate: true })).toContain(bare!.name);
    });

    it("offers no value list, because a real landscape has far too many", () => {
      expect(fieldValuesFor(DOC, "AI_AGENT").map((f) => f.key)).not.toContain("tags");
    });
  });

  it("reads internet reachability through the same predicate the canvas draws", () => {
    // The old getter read only `isAccessibleFromInternet`, so a node open to all internet but
    // not flagged accessible said "No" in the table while the graph hung an exposure node off
    // it. One reading, one answer.
    const doc: GraphDoc = {
      syncedAt: DOC.syncedAt,
      nodes: [{
        id: "open", kind: "AI_AGENT", name: "open-to-all",
        isAccessibleFromInternet: false, isOpenToAllInternet: true,
      }],
      edges: [],
    };
    const res = runQuery(doc, validateQuery({ kind: "AI_AGENT" }), { columns: [["name", "internet"]] });
    expect(res.rows[0].cells[0]?.fields.internet).toBe(true);
  });

  it("can filter the combination patterns by name, not just count them", () => {
    const withCombo = DOC.nodes.find((n) => (n.comboGroups ?? []).length);
    if (!withCombo) throw new Error("the seed carries no combination membership");
    const group = (withCombo.comboGroups ?? [])[0];
    const res = runQuery(DOC, validateQuery({
      kind: withCombo.kind, where: [{ key: "comboGroup", values: [group] }],
    }));
    expect(res.total).toBeGreaterThan(0);
    for (const row of res.rows) {
      const node = DOC.nodes.find((n) => n.id === row.cells[0]?.id);
      expect(node?.comboGroups).toContain(group);
    }
  });

  it("narrows each shortcut to the kinds this tenant can answer it from", () => {
    const vocab = queryVocabulary(DOC);
    expect(vocab.shortcuts.length).toBeGreaterThan(0);
    for (const shortcut of vocab.shortcuts) {
      expect(shortcut.kinds.length, shortcut.id).toBeGreaterThan(0);
      for (const kind of shortcut.kinds) {
        expect(shortcutsFor(kind, vocab).map((s) => s.id), shortcut.id + " on " + kind)
          .toContain(shortcut.id);
      }
    }
    // The seed's AI assets are agents; nothing runs as a service account from a BUCKET.
    const runsAs = vocab.shortcuts.find((s) => s.id === "runs-as-dormant");
    expect(runsAs?.kinds).toContain("AI_AGENT");
    expect(runsAs?.kinds).not.toContain("BUCKET");
  });

  it("keeps the value lists off the bare vocabulary, to be asked for per kind", () => {
    // Every kind's lists together were 22 KB of a 28 KB vocabulary, none of it read until the
    // palette opens and then only for one kind. The page fetches the vocabulary bare.
    expect(queryVocabulary(DOC).valuesFor).toEqual({});
  });

  it("offers the values a kind actually takes, counted, commonest first", () => {
    const forAgent = fieldValuesFor(DOC, "AI_AGENT");
    const cloud = forAgent.find((f) => f.key === "cloud");
    if (!cloud) throw new Error("no cloud values offered for AI_AGENT");
    expect(cloud.values.map((v) => v.value)).toContain("GCP");
    // Counts descend, so the picker leads with what the landscape is mostly made of.
    for (let i = 1; i < cloud.values.length; i++) {
      expect(cloud.values[i - 1].count).toBeGreaterThanOrEqual(cloud.values[i].count);
    }
    // A field a kind cannot answer is not offered for it.
    expect(fieldValuesFor(DOC, "BUCKET").find((f) => f.key === "publisher")).toBeUndefined();
  });

  it("counts a multi-value cell once per value, and offers `unknown` as a real choice", () => {
    const forAgent = fieldValuesFor(DOC, "AI_AGENT");
    const projects = forAgent.find((f) => f.key === "projects");
    if (projects) {
      const total = projects.values.reduce((a, v) => a + v.count, 0);
      const agents = DOC.nodes.filter((n) => n.kind === "AI_AGENT").length;
      // More entries than assets, because an asset in two projects is counted under both.
      expect(total).toBeGreaterThanOrEqual(agents);
    }
    const publisher = forAgent.find((f) => f.key === "publisher");
    expect(publisher).toBeUndefined(); // text, not a choice — no value list
    const guardrail = forAgent.find((f) => f.key === "guardrail");
    expect(guardrail?.values.map((v) => v.value).sort()).toEqual(["missing", "present"]);
  });

  it("offers no list at all past the cardinality cap, rather than a truncated one", () => {
    // A truncated list is the worst of the three options: it looks complete and is not.
    const many: GraphDoc = {
      syncedAt: DOC.syncedAt,
      nodes: Array.from({ length: VALUE_CARDINALITY_MAX + 5 }, (_, i) => ({
        id: "n" + i, kind: "AI_AGENT" as const, name: "n" + i, region: "region-" + i,
      })),
      edges: [],
    };
    expect(fieldValuesFor(many, "AI_AGENT").find((f) => f.key === "region")).toBeUndefined();
  });
});

/**
 * The curated shortcuts, held to the model.
 *
 * A shortcut is a promise printed on a button, and its failure mode is silence: a
 * relationship the model dropped turns it into a query that can no longer match, and nothing
 * says so — the palette still offers it and it answers zero. So each one is validated, run
 * against the seed, and where the app asserts the same thing another way, the two answers are
 * required to agree.
 */
describe("QUERY_SHORTCUTS", () => {
  const VOCAB = queryVocabulary(DOC);

  /** The shortcut as a whole query, rooted at `kind` — what the palette builds. */
  function asQuery(shortcut: QueryShortcut, kind: NodeKind): QueryNode {
    const root: QueryNode = { kind, steps: shortcut.steps };
    for (const f of shortcut.filters ?? []) {
      const node = nodeAtPath(root, f.path);
      node.where = [...(node.where ?? []), { key: f.key, values: f.values }];
    }
    return validateQuery(JSON.parse(JSON.stringify(root)));
  }

  /** `[0]` is the first appended step's target node; `[0, 1]` its second child's target. */
  function nodeAtPath(root: QueryNode, path: number[]): QueryNode {
    let at = root;
    for (const i of path) {
      const step = (at.steps ?? [])[i];
      if (!step || isGroup(step)) throw new Error("shortcut filter path misses a node: " + path);
      at = step.node;
    }
    return at;
  }

  it("every shortcut validates and runs, on every kind it claims", () => {
    for (const shortcut of QUERY_SHORTCUTS) {
      for (const kind of shortcut.kinds) {
        const query = asQuery(shortcut, kind);
        // A throw here is the build failing rather than the palette failing at 3pm.
        const res = runQuery(DOC, query);
        expect(res.total, shortcut.id + " on " + kind).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("names only relationships and kinds the model still has", () => {
    for (const shortcut of QUERY_SHORTCUTS) {
      for (const step of shortcut.steps) walkStep(step);
    }
    function walkStep(step: QueryStep) {
      if (isGroup(step)) { step.steps.forEach(walkStep); return; }
      expect(EDGE_TYPES as readonly string[], shortcut(step)).toContain(step.edge);
      expect(NODE_KINDS as readonly string[]).toContain(step.node.kind);
      (step.node.steps ?? []).forEach(walkStep);
    }
    function shortcut(step: RelationStep) { return "unknown edge " + step.edge; }
  });

  it("filters name fields the target kind can actually answer", () => {
    for (const s of QUERY_SHORTCUTS) {
      for (const f of s.filters ?? []) {
        const node = nodeAtPath({ kind: s.kinds[0], steps: s.steps }, f.path);
        const keys = fieldsForKind(node.kind).map((x) => x.key);
        expect(keys, s.id + ": " + f.key + " on " + node.kind).toContain(f.key);
      }
    }
  });

  it("agrees with the condition the canvas draws, where the app asserts it twice", () => {
    // MISSING_GUARDRAIL is never suppressed, so the stub count IS the population and the two
    // must match exactly. If they ever diverge, one of them is lying.
    const shortcut = QUERY_SHORTCUTS.find((s) => s.id === "no-guardrail");
    if (!shortcut) throw new Error("no-guardrail went missing");
    const res = runQuery(DOC, asQuery(shortcut, "AI_AGENT"));
    const drawn = DOC.nodes.filter((n) =>
      n.kind === "AI_AGENT" && conditionHolds(n, "MISSING_GUARDRAIL")).length;
    expect(res.total).toBe(drawn);
    expect(drawn).toBeGreaterThan(0);
  });

  it("does not use the NOT traversal for the guardrail question, which answers wider", () => {
    // This is why `no-guardrail` is a property filter and not `!PROTECTED_BY.AI_GUARDRAIL`.
    //
    // The two disagree because the FLAG and the TOPOLOGY are not the same claim: Wiz reports
    // some assets as protected without the graph carrying a PROTECTED_BY edge to name the
    // guardrail. The traversal counts those as unguarded; the flag does not, and the canvas
    // draws the flag. Locked in — a future simplification back to the negated step would
    // over-report, and quietly.
    const viaTraversal = runQuery(DOC, validateQuery({
      kind: "AI_AGENT",
      steps: [{ edge: "PROTECTED_BY", negate: true, node: { kind: "AI_GUARDRAIL" } }],
    }));
    const drawn = DOC.nodes.filter((n) =>
      n.kind === "AI_AGENT" && conditionHolds(n, "MISSING_GUARDRAIL")).length;
    expect(viaTraversal.total).toBeGreaterThan(drawn);

    const withEdge = new Set(DOC.edges
      .filter((e) => e.type === "PROTECTED_BY" && !e.negated)
      .map((e) => e.src));
    const flaggedProtectedWithoutEdge = DOC.nodes.filter((n) =>
      n.kind === "AI_AGENT" && n.guardrailMissing === false && !withEdge.has(n.id)).length;
    expect(flaggedProtectedWithoutEdge).toBeGreaterThan(0);
    expect(viaTraversal.total).toBe(drawn + flaggedProtectedWithoutEdge);
  });

  it("reaches classified data by the real chain, not the suppressed stub", () => {
    const shortcut = QUERY_SHORTCUTS.find((s) => s.id === "reaches-classified");
    if (!shortcut) throw new Error("reaches-classified went missing");
    const res = runQuery(DOC, asQuery(shortcut, "AI_AGENT"));
    expect(res.total).toBeGreaterThan(0);
    // The waypoint is hidden, so the table reads asset beside data: two column groups, not
    // three. That is the whole point of `show: false` on the identity.
    expect(res.groups).toHaveLength(2);
    expect(res.groups.map((g) => g.kind)).toEqual(["AI_AGENT", "BUCKET"]);
    // And it must NOT be the stub: a SENSITIVE_DATA walk would answer with the residue.
    const viaStub = runQuery(DOC, validateQuery({
      kind: "AI_AGENT",
      steps: [{ edge: "HAS_SENSITIVE_DATA", node: { kind: "SENSITIVE_DATA" } }],
    }));
    expect(res.total).not.toBe(viaStub.total);
  });

  it("is offered only where the tenant's graph can answer it", () => {
    // A kind with nothing in the graph gets nothing offered, rather than six dead buttons.
    const empty = queryVocabulary({ syncedAt: DOC.syncedAt, nodes: [], edges: [] });
    expect(empty.shortcuts).toEqual([]);
    expect(shortcutsFor("AI_AGENT", empty)).toEqual([]);
    // ANY is a wildcard root, not a kind — no shortcut is written against it.
    expect(shortcutsFor("ANY", VOCAB)).toEqual([]);
  });
});

// A wildcard node used to get no value lists at all, which made every choice filter on it a
// bare text box. `FIND ANY(…)` is a shape the app writes for itself when someone focuses an
// asset, so that was the common case, not a corner.
describe("value lists for a wildcard node", () => {
  it("counts across the whole landscape, not one kind", () => {
    const any = fieldValuesFor(DOC, "ANY").find((v) => v.key === "cloud");
    const agent = fieldValuesFor(DOC, "AI_AGENT").find((v) => v.key === "cloud");
    expect(any).toBeDefined();
    const total = (f?: { values: Array<{ count: number }> }) =>
      (f?.values ?? []).reduce((n, v) => n + v.count, 0);
    expect(total(any)).toBeGreaterThan(total(agent));
  });

  it("offers only fields a wildcard node actually has", () => {
    // The worry that kept this empty was a picker "offering the union of things that do not
    // co-occur". It cannot happen: `fieldsForKind("ANY")` drops every kind-specific spec first,
    // and these two lists have to agree or the palette lists a field with no values.
    const offered = new Set(fieldsForKind("ANY").map((f) => f.key));
    for (const v of fieldValuesFor(DOC, "ANY")) expect(offered).toContain(v.key);
    // `publisher` and `email` are kind-specific, so neither may appear.
    const keys = fieldValuesFor(DOC, "ANY").map((v) => v.key);
    expect(keys).not.toContain("identityPurpose");
    expect(keys).not.toContain("guardrail");
  });
});

// ------------------------------------------------- several kinds at one position
//
// "FIND AI Agents and AI Models that reach sensitive data" is ONE node looking for either kind,
// not two queries and not a wildcard narrowed by a `kind` filter. The wildcard was the old
// workaround and it lost three things: `stepsFrom` has no "ANY" key so it offered no
// relationships at all, `shortcutsFor("ANY")` is empty so the shortcut that IS this question was
// unbuildable, and `fieldsForKind("ANY")` drops the AI-asset specs so the table opened on
// name/kind/cloud instead of the product's signature name/publisher/discovered by.
describe("a node naming several kinds", () => {
  const VOCAB = queryVocabulary(DOC);
  const both = (...kinds: NodeKind[]) => kinds.reduce(
    (n, k) => n + DOC.nodes.filter((x) => x.kind === k).length, 0);

  it("matches either kind, and counts them all", () => {
    const res = runQuery(DOC, validateQuery({ kind: ["AI_AGENT", "AI_MODEL"] }));
    expect(res.total).toBe(both("AI_AGENT", "AI_MODEL"));
    const kinds = new Set(res.rows.map((r) => r.cells[0]?.kind));
    expect(kinds).toEqual(new Set(["AI_AGENT", "AI_MODEL"]));
    // Not the union of two queries by accident: it is still one node, so one cell per row.
    for (const row of res.rows) expect(row.cells).toHaveLength(1);
  });

  it("works at the far end of a step as well as at the root", () => {
    const wide = runQuery(DOC, validateQuery({
      kind: "AI_AGENT",
      steps: [{ edge: "RUNS_AS", node: { kind: ["SERVICE_ACCOUNT", "ACCESS_KEY"] } }],
    }));
    const narrow = runQuery(DOC, validateQuery(AGENT_RUNS_AS_SA));
    // The seed gives one agent an agentic ACCESS_KEY rather than a service account — the row
    // the single-kind query drops is exactly the row widening the set gets back.
    expect(wide.total).toBe(narrow.total + 1);
    expect(new Set(wide.rows.map((r) => r.cells[1]?.kind)))
      .toEqual(new Set(["SERVICE_ACCOUNT", "ACCESS_KEY"]));
  });

  it("canonicalises the list, so one selection has one spelling", () => {
    // One kind is the bare string it has always been — which is what keeps every existing
    // payload, and every golden, byte-identical.
    expect(validateQuery({ kind: ["AI_AGENT"] })).toEqual({ kind: "AI_AGENT" });
    expect(validateQuery({ kind: ["BUCKET", "BUCKET"] })).toEqual({ kind: "BUCKET" });
    // ANY is the union of everything, so it cannot be one of several: a set holding it reads as
    // narrower than it is, and collapsing says what the query actually does.
    expect(validateQuery({ kind: ["AI_AGENT", "ANY"] })).toEqual({ kind: "ANY" });
    // The written order survives. `kindKey` is compared across the wire by value, and the client
    // does not reorder either — see the note on readKinds.
    expect(validateQuery({ kind: ["AI_MODEL", "AI_AGENT"] }).kind).toEqual(["AI_MODEL", "AI_AGENT"]);
  });

  it("rejects an unknown member by name rather than dropping it", () => {
    // Dropping it would answer a wider question than the link asked for, silently.
    expect(() => validateQuery({ kind: ["AI_AGENT", "AI_ROBOT"] })).toThrow(/unknown node kind/);
    expect(() => validateQuery({ kind: [] })).toThrow(/names no kind/);
  });

  it("INTERSECTS the fields, because a field only some kinds answer would exclude the rest", () => {
    // Two AI assets keep the AI-asset specs — including the ones the ANY workaround lost.
    const asset = fieldsForKind(["AI_AGENT", "AI_MODEL"]).map((f) => f.key);
    expect(asset).toEqual(fieldsForKind("AI_AGENT").map((f) => f.key));
    expect(asset).toContain("publisher");
    expect(asset).toContain("discoveredBy");
    expect(asset).toContain("guardrail");
    // ACROSS CATEGORIES it falls to what both can answer — and the intersection reading is what
    // `fieldsForKind("ANY")` has always been: the intersection over every kind there is.
    const mixed = fieldsForKind(["AI_AGENT", "BUCKET"]).map((f) => f.key);
    expect(mixed).toEqual(fieldsForKind("ANY").map((f) => f.key));
    expect(mixed).not.toContain("publisher");
  });

  it("opens on the columns the whole set has, not the first kind's", () => {
    expect(defaultFieldsForKind(["AI_AGENT", "AI_MODEL"])).toEqual(["name", "publisher", "discoveredBy"]);
    expect(defaultFieldsForKind(["SERVICE_ACCOUNT", "USER_ACCOUNT"])).toEqual(["name", "displayName", "inactive"]);
    // Mixed categories have no signature columns in common, so it is the generic three.
    expect(defaultFieldsForKind(["AI_AGENT", "BUCKET"])).toEqual(["name", "kind", "cloud"]);
  });

  it("names the column group by the whole set, and labels it in prose", () => {
    const groups = queryColumnGroups(validateQuery({
      kind: ["AI_AGENT", "AI_MODEL"],
      steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } }],
    }));
    // The IDENTITY is the joined list — the client derives the same string from its own tree and
    // matches this group by it (test/graphQueryWalk.test.js pins the pair).
    expect(groups.map((g) => g.kind)).toEqual(["AI_AGENT-AI_MODEL", "SERVICE_ACCOUNT"]);
    // "or", not "and": the node matches any one of them, and "AI_AGENT and AI_MODEL" would
    // promise a node that is both. The raw tokens are what this layer has always emitted —
    // `kindLabel` lives on the client, which glosses each one before it reaches a header.
    expect(groups[0].label).toBe("AI_AGENT or AI_MODEL");
    // A single kind is untouched, which is why no golden moves.
    expect(queryColumnGroups(validateQuery(AGENT_RUNS_AS_SA))[0].kind).toBe("AI_AGENT");
  });

  it("UNIONS the shortcuts, because a step is taken deliberately", () => {
    // Offered when ANY selected kind can answer it. Buckets answer none of these, but the
    // question "agents or buckets that reach classified data" is still worth a button — and
    // taking it visibly drops the buckets, where an intersected field silently drops rows.
    const agent = shortcutsFor("AI_AGENT", VOCAB).map((s) => s.id);
    expect(shortcutsFor(["AI_AGENT", "BUCKET"], VOCAB).map((s) => s.id)).toEqual(agent);
    expect(shortcutsFor("BUCKET", VOCAB)).toEqual([]);
    expect(agent).toContain("reaches-classified");
    // A set entirely outside the landscape is still nothing, not everything.
    const empty = queryVocabulary({ syncedAt: DOC.syncedAt, nodes: [], edges: [] });
    expect(shortcutsFor(["AI_AGENT", "BUCKET"], empty)).toEqual([]);
  });

  it("is still ONE node — one slot, one column, one where index", () => {
    // The whole point of putting this in the grammar rather than writing `ANY` plus a kind
    // filter: the reader sees one term, so the machinery underneath must agree.
    const q = validateQuery({
      kind: ["AI_AGENT", "AI_MODEL"],
      steps: [{ edge: "HAS_ISSUE", node: { kind: "ISSUE" } }],
    });
    // Two column groups for a two-node query, whatever the first node names.
    expect(queryColumnGroups(q)).toHaveLength(2);
    for (const row of runQuery(DOC, q).rows) expect(row.cells).toHaveLength(2);
    // ONE `where` index for the whole term: slot 0 is the term, not one slot per kind — so a
    // filter on it narrows the set rather than landing on whichever kind was written first.
    const open = runQuery(DOC, validateQuery({ kind: ["AI_AGENT", "AI_MODEL"] }));
    const narrowed = runQuery(DOC, validateQuery({
      kind: ["AI_AGENT", "AI_MODEL"],
      where: [{ key: "kind", values: ["AI_MODEL"] }],
    }));
    expect(open.total).toBe(both("AI_AGENT", "AI_MODEL"));
    expect(narrowed.total).toBe(both("AI_MODEL"));
  });
});

// The one compat path in this app where getting it wrong blanks a page rather than
// degrading a result: `readNode` THROWS on an unknown filter field, and it sits in front
// of the whole query. A saved view or a shared `where=` naming a retired verdict would
// have taken the Security Graph down with "unknown filter field: aars".
describe("retired filter fields", () => {
  const withFilter = (key: string) => ({
    kind: "AI_AGENT",
    where: [{ key, values: ["70"] }],
  });

  it("drops a retired field and names it, instead of refusing the query", () => {
    for (const key of ["aars", "aarsPercentile", "aarsSeverity", "postureTier", "problemOutcome"]) {
      const { query, retired } = validateQueryWithWarnings(withFilter(key));
      expect(retired, key).toEqual([key]);
      // The filter is gone, not silently kept under a name nothing evaluates.
      expect(query.where ?? [], key).toEqual([]);
      expect(() => validateQuery(withFilter(key)), key).not.toThrow();
    }
  });

  it("still refuses a field that was never real", () => {
    expect(() => validateQuery(withFilter("nonsense"))).toThrow(/unknown filter field/);
  });

  it("keeps the filters that are still real, beside a retired one", () => {
    const { query, retired } = validateQueryWithWarnings({
      kind: "AI_AGENT",
      where: [
        { key: "aars", values: ["70"] },
        { key: "openIssues", values: ["2"] },
      ],
    });
    expect(retired).toEqual(["aars"]);
    expect((query.where ?? []).map((f) => f.key)).toEqual(["openIssues"]);
  });

  it("names a repeated retired field once, not once per node", () => {
    const { retired } = validateQueryWithWarnings({
      kind: "AI_AGENT",
      where: [{ key: "aars", values: ["70"] }],
      steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT", where: [{ key: "aars", values: ["1"] }] } }],
    });
    expect(retired).toEqual(["aars"]);
  });
});
