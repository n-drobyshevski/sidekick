// The node rule the canvas depends on.
//
// This is the part of project scoping that can look broken rather than fail loudly. A graph
// narrowed by strict membership still renders — it renders severed stubs, and an absent path
// reads as an absent risk. So each rule here is pinned separately, and the multi-hop case is
// pinned as a whole path rather than as three independent nodes.

import { describe, expect, it } from "vitest";
import { scopeGraphDoc } from "../src/domain/graphScope";
import type { GEdge, GNode, GraphDoc } from "../src/domain/graphTypes";

const UNIT = "proj-unit";
const OTHER = "proj-other";

/** `projects: undefined` is the substrate case — Wiz attributed the node to nothing. */
function node(id: string, projectIds?: string[]): GNode {
  return {
    id, kind: "AI_AGENT", name: id,
    ...(projectIds ? { projects: projectIds.map((p) => ({ id: p, name: p })) } : {}),
  } as GNode;
}

// RUNS_AS, not ACTING_AS: the latter is the vocabulary this app SENDS to Wiz, the former is
// what it persists. An edge type the ledger never holds would make this fixture untypeable.
function edge(src: string, dst: string): GEdge {
  return { id: `${src}|RUNS_AS|${dst}`, src, dst, type: "RUNS_AS" };
}

const doc = (nodes: GNode[], edges: GEdge[]): GraphDoc =>
  ({ nodes, edges, syncedAt: "2026-08-21T00:00:00Z" });

const ids = (d: GraphDoc) => d.nodes.map((n) => n.id).sort();

describe("scopeGraphDoc", () => {
  it("returns the same object when there is no project to narrow to", () => {
    // By identity, not by equality: every unscoped read must keep relying on loadGraphDoc's
    // memoized reference rather than paying for a copy of the whole register.
    const d = doc([node("a", [UNIT])], []);
    expect(scopeGraphDoc(d, "")).toBe(d);
  });

  it("keeps a whole path through substrate that belongs to no project", () => {
    // The case the product exists to show, and the one strict membership destroys: an agent
    // reaching sensitive data through a service account and a bucket, neither of which Wiz
    // attributes to any project. Two project-less hops, so a one-hop rule would fail this too.
    const d = doc(
      [node("agent", [UNIT]), node("sa"), node("bucket"), node("sensitive")],
      [edge("agent", "sa"), edge("sa", "bucket"), edge("bucket", "sensitive")],
    );
    expect(ids(scopeGraphDoc(d, UNIT))).toEqual(["agent", "bucket", "sa", "sensitive"]);
    // And the path itself survives, not just its nodes.
    expect(scopeGraphDoc(d, UNIT).edges).toHaveLength(3);
  });

  it("never admits another project's assets, however reachable", () => {
    // The guard on the other half of the rule. Two units sharing one bucket is ordinary, and
    // without this, selecting either would drag in the other's agents through it — the view
    // would quietly stop being a view of one project.
    const d = doc(
      [node("mine", [UNIT]), node("bucket"), node("theirs", [OTHER])],
      [edge("mine", "bucket"), edge("theirs", "bucket")],
    );
    const out = scopeGraphDoc(d, UNIT);
    expect(ids(out)).toEqual(["bucket", "mine"]);
    // The edge into the other project's asset goes with it — an edge to a node that is not
    // drawn is a line to nowhere.
    expect(out.edges.map((e) => e.id)).toEqual([edge("mine", "bucket").id]);
  });

  it("drops substrate that no in-view asset reaches", () => {
    // "Belongs to no project" is not on its own a reason to draw something. Reachability from
    // an anchored asset is what admits it.
    const d = doc(
      [node("mine", [UNIT]), node("orphan"), node("far"), node("theirs", [OTHER])],
      [edge("theirs", "far")],
    );
    expect(ids(scopeGraphDoc(d, UNIT))).toEqual(["mine"]);
  });

  it("keeps the read-time risk stubs hanging off an in-view asset", () => {
    // SENSITIVE_DATA, MISSING_GUARDRAIL and the rest are minted at read time from a condition
    // holding on an asset; they carry id/kind/name and no projects at all. Dropping them would
    // delete the toxic combinations from a scoped canvas while leaving the assets in place.
    const stub = { id: "sens|agent", kind: "SENSITIVE_DATA", name: "Sensitive data" } as GNode;
    const d = doc([node("agent", [UNIT]), stub], [edge("agent", "sens|agent")]);
    expect(ids(scopeGraphDoc(d, UNIT))).toEqual(["agent", "sens|agent"]);
  });

  it("reaches substrate through an edge pointing the other way", () => {
    // Direction is an artefact of which end the traversal recorded first. An agent is as often
    // the destination of a relationship as its source.
    const d = doc([node("agent", [UNIT]), node("host")], [edge("host", "agent")]);
    expect(ids(scopeGraphDoc(d, UNIT))).toEqual(["agent", "host"]);
  });

  it("selects a folder's whole subtree, because ancestry is on the row", () => {
    // An asset carries its ancestor chain, so naming a folder id reaches everything beneath it
    // with one id match and no tree walk.
    const leafA = node("a", ["proj-unit", "proj-leaf-a"]);
    const leafB = node("b", ["proj-unit", "proj-leaf-b"]);
    const d = doc([leafA, leafB], []);
    expect(ids(scopeGraphDoc(d, UNIT))).toEqual(["a", "b"]);
    expect(ids(scopeGraphDoc(d, "proj-leaf-a"))).toEqual(["a"]);
  });

  it("returns an empty graph for a project the register does not hold", () => {
    // Honest for that project, and it must not fall back to the whole register.
    const d = doc([node("a", [UNIT]), node("sub")], [edge("a", "sub")]);
    const out = scopeGraphDoc(d, "proj-nowhere");
    expect(out.nodes).toHaveLength(0);
    expect(out.edges).toHaveLength(0);
  });
});
