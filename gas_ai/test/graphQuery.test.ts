// The path query engine: validation at the RPC boundary, the vocabulary the builder offers,
// and the binding rules that make a ROW A PATH rather than a node.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  MAX_QUERY_NODES,
  QueryError,
  type QueryNode,
  defaultFieldsForKind,
  fieldsForKind,
  humanDiscoveryMethod,
  queryColumnGroups,
  queryVocabulary,
  runQuery,
  validateQuery,
} from "../src/domain/graphQuery";
import { enrichGraphDoc, withMissingGuardrailNodes } from "../src/domain/graphEnrich";
import { SEED_AARS_HINTS, SEED_ISSUES, seedGraphDoc } from "../src/server/sampleData";
import type { GraphDoc } from "../src/domain/graphTypes";

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
    // Silently answering zero would read as "your estate is clean", which is the one wrong
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
    expect(q.steps?.[0].hops).toBe(3);
    const typed = validateQuery({ kind: "AI_AGENT", steps: [{ edge: "RUNS_AS", hops: 3, node: { kind: "SERVICE_ACCOUNT" } }] });
    expect(typed.steps?.[0].hops).toBeUndefined();
  });
});

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
