// The per-agent expansion spec, and the positional decoder derived from it.
//
// The arity assertion below is the one that matters. `entities` is a positional array —
// slot i holds the i-th `select: true` node of the query in depth-first pre-order — so a
// spec that disagrees with the document by even one slot decodes every later entity onto
// the wrong node. Pinning the count against the real capture
// (exemples/ai_agent_expand_response.js, 43 slots) is what makes positional decoding safe.
//
// The exemples/*.js files are raw captures, not modules, so the fixture rows are inlined
// here the way test/syncNormalize.test.ts and test/riskIssuesCapture.test.ts inline theirs.

import { describe, expect, it } from "vitest";
import {
  AGENT_EXPANSION,
  decodeExpansion,
  flattenSlots,
  toGraphEntityQuery,
  type Slot,
} from "../src/domain/graphExpand";

type Raw = Record<string, unknown>;

const SLOTS = flattenSlots(AGENT_EXPANSION);

/** A row with `entities` of the right arity, filled at the given slot indices. */
function row(at: Record<number, Raw>): Raw {
  const entities: Array<Raw | null> = new Array(SLOTS.length).fill(null);
  for (const [i, e] of Object.entries(at)) entities[Number(i)] = e;
  return { entities };
}

function entity(id: string, type: string, over: Raw = {}): Raw {
  return { id, name: id, type, ...over };
}

describe("flattenSlots", () => {
  it("emits exactly one slot per selected node — 43, matching the capture", () => {
    expect(SLOTS.length).toBe(43);
  });

  it("walks depth-first pre-order, as the capture's non-null positions prove", () => {
    // These six are read straight off exemples/ai_agent_expand_response.js: the four
    // matched entities landed at 0/1/2/7 and the READS_DATA_FROM subtree occupied 3-6.
    const shape = SLOTS.slice(0, 9).map((s) => s.types.join("|"));
    expect(shape).toEqual([
      "AI_AGENT",
      "PRINCIPAL",
      "EXCESSIVE_ACCESS_FINDING",
      "AI_DATASET|BUCKET",
      "BUCKET|DATABASE",
      "DATA_FINDING",
      "DATA_FINDING",
      "BUCKET",
      "DATA_FINDING",
    ]);
  });

  it("gives an unselected node no slot and reparents its children", () => {
    // The IAM_BINDING under AI_TOOL -> SERVERLESS -> SERVICE_ACCOUNT is select:false, so
    // the DATA_RESOURCE beneath it attaches to the service account, not to the binding.
    const sa = SLOTS[11];
    const resource = SLOTS[12];
    expect(sa.types).toEqual(["SERVICE_ACCOUNT"]);
    expect(resource.types).toEqual(["DATA_RESOURCE"]);
    expect(resource.parentIndex).toBe(11);
    expect(SLOTS.some((s) => s.parentIndex !== null && s.types.includes("IAM_BINDING") && s.index < 39))
      .toBe(false);
  });

  it("keeps the console's asymmetry: the kubernetes IAM_BINDING IS selected", () => {
    expect(SLOTS[39].types).toEqual(["IAM_BINDING"]);
    expect(SLOTS[40].parentIndex).toBe(39);
  });

  it("carries the edge and its direction onto every slot", () => {
    expect(SLOTS[1].edgeType).toBe("ACTING_AS");
    expect(SLOTS[1].reverse).toBeFalsy();
    expect(SLOTS[30].edgeType).toBe("RUNS");
    expect(SLOTS[30].reverse).toBe(true);
    expect(SLOTS[0].edgeType).toBeUndefined();
  });

  it("repeats types across subtrees — the reason type-matching cannot work here", () => {
    const at = (t: string) => SLOTS.filter((s) => s.types.join("|") === t).map((s) => s.index);
    expect(at("SERVICE_ACCOUNT")).toEqual([11, 32, 38]);
    expect(at("DATA_RESOURCE")).toEqual([12, 33, 40]);
    expect(at("DATA_FINDING")).toEqual([5, 6, 8, 13, 34]);
    expect(at("AI_AGENT")).toEqual([0, 15]);
  });
});

describe("toGraphEntityQuery", () => {
  const q = toGraphEntityQuery(AGENT_EXPANSION, "agent-1") as Raw;

  it("pins the root by _vertexID", () => {
    expect(q["type"]).toEqual(["AI_AGENT"]);
    expect(q["select"]).toBe(true);
    expect(q["where"]).toEqual({ _vertexID: { EQUALS: "agent-1" } });
  });

  it("puts `optional` on the relationship and `select` on the `with`", () => {
    const rel = (q["relationships"] as Raw[])[0];
    expect(rel["type"]).toEqual([{ type: "ACTING_AS" }]);
    expect(rel["optional"]).toBe(true);
    expect((rel["with"] as Raw)["type"]).toEqual(["PRINCIPAL"]);
    expect((rel["with"] as Raw)["select"]).toBe(true);
  });

  it("renders a reverse edge the way the gateway spells it", () => {
    const compute = (q["relationships"] as Raw[]).find(
      (r) => ((r["with"] as Raw)["type"] as string[])[0] === "VIRTUAL_MACHINE",
    ) as Raw;
    expect(compute["type"]).toEqual([{ type: "RUNS", reverse: true }]);
  });

  it("omits `select` for an unselected intermediate but keeps its subtree", () => {
    const tool = (q["relationships"] as Raw[]).find(
      (r) => ((r["with"] as Raw)["type"] as string[])[0] === "AI_TOOL",
    ) as Raw;
    const runner = ((tool["with"] as Raw)["relationships"] as Raw[])[0];
    const sa = ((runner["with"] as Raw)["relationships"] as Raw[])[0];
    const binding = ((sa["with"] as Raw)["relationships"] as Raw[])[0];
    const bindingWith = binding["with"] as Raw;
    expect(bindingWith["type"]).toEqual(["IAM_BINDING"]);
    expect(bindingWith["select"]).toBeUndefined();
    expect((bindingWith["relationships"] as Raw[]).length).toBe(1);
  });
});

describe("decodeExpansion — against the captured response", () => {
  // exemples/ai_agent_expand_response.js, trimmed to the fields the decoder reads. Slots
  // 0/1/2/7 matched; the other 39 are null.
  const captured = row({
    0: entity("11111111-1111-5111-a111-111111111111", "AI_AGENT", { name: "example-agent" }),
    1: entity("22222222-2222-5222-a222-222222222222", "SERVICE_ACCOUNT"),
    2: entity("33333333-3333-5333-a333-333333333333", "EXCESSIVE_ACCESS_FINDING"),
    7: entity("44444444-4444-5444-a444-444444444444", "BUCKET", { name: "agent-staging" }),
  });

  const out = decodeExpansion(SLOTS, [captured]);

  it("recovers the four matched entities and nothing else", () => {
    expect(out.rowsDecoded).toBe(1);
    expect(out.arityMismatches).toBe(0);
    expect(out.nodes.map((n) => n.kind).sort()).toEqual([
      "AI_AGENT",
      "BUCKET",
      "EXCESSIVE_ACCESS_FINDING",
      "SERVICE_ACCOUNT",
    ]);
  });

  it("rebuilds the edges the traversal implies, on the right parents", () => {
    const e = out.edges.map((x) => `${x.src}|${x.type}|${x.dst}`);
    expect(e).toContain(
      "11111111-1111-5111-a111-111111111111|ACTING_AS|22222222-2222-5222-a222-222222222222",
    );
    // The finding hangs off the SERVICE_ACCOUNT (slot 1), not off the agent.
    expect(e).toContain(
      "22222222-2222-5222-a222-222222222222|CONTAINS|33333333-3333-5333-a333-333333333333",
    );
    expect(e).toContain(
      "11111111-1111-5111-a111-111111111111|STORES_DATA_IN|44444444-4444-5444-a444-444444444444",
    );
    expect(e.length).toBe(3);
  });

  it("draws no edge into an unmatched slot", () => {
    // Slot 8 (the bucket's DATA_FINDING) is null, so the bucket gets no outgoing edge.
    expect(out.edges.some((x) => x.type === "HAS_DATA_FINDING")).toBe(false);
  });
});

describe("decodeExpansion — attribution", () => {
  it("attaches each subtree's resource to ITS OWN service account", () => {
    // The load-bearing case. Two service accounts in one row: slot 11 under the AI_TOOL
    // runner, slot 32 under the compute the agent runs on, each with its own data
    // resource at 12 and 33. syncNormalize's entities.find(e => e.kind === X) would bind
    // both resources to whichever account came first; position gets it right.
    const out = decodeExpansion(SLOTS, [
      row({
        0: entity("agent", "AI_AGENT"),
        9: entity("tool", "AI_TOOL"),
        10: entity("fn", "SERVERLESS"),
        11: entity("sa-tool", "SERVICE_ACCOUNT"),
        12: entity("res-tool", "DATA_RESOURCE"),
        30: entity("vm", "VIRTUAL_MACHINE"),
        32: entity("sa-vm", "SERVICE_ACCOUNT"),
        33: entity("res-vm", "DATA_RESOURCE"),
      }),
    ]);
    const e = out.edges.map((x) => `${x.src}|${x.type}|${x.dst}`);
    expect(e).toContain("sa-tool|ALLOWS_ACCESS_TO|res-tool");
    expect(e).toContain("sa-vm|ALLOWS_ACCESS_TO|res-vm");
    expect(e).not.toContain("sa-tool|ALLOWS_ACCESS_TO|res-vm");
    expect(e).not.toContain("sa-vm|ALLOWS_ACCESS_TO|res-tool");
  });

  it("flips src/dst for a reverse edge", () => {
    // RUNS is reverse: the compute RUNS the agent, so the edge points compute -> agent.
    const out = decodeExpansion(SLOTS, [
      row({ 0: entity("agent", "AI_AGENT"), 30: entity("vm", "VIRTUAL_MACHINE") }),
    ]);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].src).toBe("vm");
    expect(out.edges[0].dst).toBe("agent");
    expect(out.edges[0].type).toBe("RUNS");
  });

  it("resolves the agent-to-agent trust chain the register could not model before", () => {
    const out = decodeExpansion(SLOTS, [
      row({
        0: entity("agent-a", "AI_AGENT"),
        9: entity("tool", "AI_TOOL"),
        10: entity("fn", "SERVERLESS"),
        15: entity("agent-b", "AI_AGENT"),
      }),
    ]);
    const e = out.edges.map((x) => `${x.src}|${x.type}|${x.dst}`);
    expect(e).toContain("agent-a|USES|tool");
    expect(e).toContain("fn|INVOKES|agent-b");
    expect(out.nodes.filter((n) => n.kind === "AI_AGENT")).toHaveLength(2);
  });
});

describe("decodeExpansion — robustness", () => {
  it("skips and counts a row whose arity disagrees with the spec", () => {
    // If the tenant's schema and the spec diverge, every index is meaningless. Refusing
    // the row is the point: the alternative is plausible, wrong edges and no signal.
    const out = decodeExpansion(SLOTS, [{ entities: [entity("a", "AI_AGENT"), null] }]);
    expect(out.arityMismatches).toBe(1);
    expect(out.rowsDecoded).toBe(0);
    expect(out.nodes).toHaveLength(0);
    expect(out.edges).toHaveLength(0);
  });

  it("keeps an unmodeled kind under its raw Wiz type, flagged", () => {
    const out = decodeExpansion(SLOTS, [
      row({ 0: entity("agent", "AI_AGENT"), 28: entity("ep", "ENDPOINT") }),
    ]);
    const agent = out.nodes.find((n) => n.id === "agent");
    const endpoint = out.nodes.find((n) => n.id === "ep");
    expect(agent?.unmodeled).toBe(false);
    // ENDPOINT is not in NODE_KINDS; it must survive rather than be dropped, because the
    // sheet renders it and the client already falls back for unknown kinds.
    expect(endpoint?.kind).toBe("ENDPOINT");
    expect(endpoint?.unmodeled).toBe(true);
  });

  it("reads the properties bag when the CloudResource fragment gave nothing", () => {
    // An entity that is not a CloudResource gets nothing from that fragment, and this
    // traversal reaches several — ENDPOINT, IAM_BINDING, CONTAINER. `properties` is on
    // the GraphEntity interface and the capture shows it populated for every entity, so
    // it is what keeps those nodes from arriving as a bare id.
    const out = decodeExpansion(SLOTS, [
      row({
        0: entity("agent", "AI_AGENT", {
          properties: {
            nativeType: "aiplatform#ReasoningEngine",
            cloudPlatform: "GCP",
            region: "europe-west1",
            status: "Active",
            externalId: "projects/x/reasoningEngines/1",
            hasAdminPrivileges: true,
            "accessibleFrom.internet": false,
            openToAllInternet: false,
          },
        }),
      }),
    ]);
    const agent = out.nodes[0];
    expect(agent.nativeType).toBe("aiplatform#ReasoningEngine");
    expect(agent.cloud).toBe("GCP");
    expect(agent.region).toBe("europe-west1");
    expect(agent.status).toBe("Active");
    expect(agent.adminPriv).toBe(true);
    // The bag spells the two exposure flags differently from the fragment.
    expect(agent.internet).toBe(false);
    expect(agent.openInternet).toBe(false);
  });

  it("prefers the flat field over the bag when both arrive", () => {
    const out = decodeExpansion(SLOTS, [
      row({
        0: entity("agent", "AI_AGENT", {
          cloudPlatform: "AWS",
          properties: { cloudPlatform: "GCP" },
        }),
      }),
    ]);
    expect(out.nodes[0].cloud).toBe("AWS");
  });

  it("survives a missing or malformed properties bag", () => {
    const out = decodeExpansion(SLOTS, [
      row({
        0: entity("a", "AI_AGENT"),
        28: entity("ep", "ENDPOINT", { properties: "not-an-object" }),
      }),
    ]);
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes[1].cloud).toBeNull();
  });

  it("dedupes nodes and edges across rows", () => {
    const r = row({ 0: entity("agent", "AI_AGENT"), 28: entity("ep", "ENDPOINT") });
    const out = decodeExpansion(SLOTS, [r, r, r]);
    expect(out.rowsDecoded).toBe(3);
    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toHaveLength(1);
  });

  it("survives junk rows without throwing", () => {
    const out = decodeExpansion(SLOTS, [null, 42, {}, { entities: "nope" }, undefined]);
    expect(out.nodes).toHaveLength(0);
    expect(out.arityMismatches).toBe(0);
  });

  it("tolerates an empty slot list and non-array input", () => {
    expect(decodeExpansion([] as Slot[], null).nodes).toHaveLength(0);
    expect(decodeExpansion(SLOTS, "nope").rowsDecoded).toBe(0);
  });
});
