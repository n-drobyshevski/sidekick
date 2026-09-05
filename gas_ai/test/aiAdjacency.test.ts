// AI adjacency: where a row sits relative to the estate, ONE HOP, and the denominator that
// makes the answer readable.
//
// WHY THE DENOMINATOR IS PART OF THE CONTRACT AND NOT A CONVENIENCE. `ai_edges` holds 68 asset
// edges on the reference tenant (AARS_LIVE_MEASUREMENTS.md §4 row A) — RUNS_AS 40, BOUND_TO 12,
// ALLOWS_ACCESS_TO 11, PRODUCES 3, READS_DATA_FROM 1, STORES_DATA_IN 1 — because 585 of 590
// lineage rows arrive as a bare root with every optional leg null. So an UNLINKED count from
// that estate is overwhelmingly "not traversed", never "unrelated to the AI estate", and
// `edgesKnown` rides beside the three counts so no reader can quote one without the other.
// §6.4 is the same shape one register over: KEV findings sit on VMs and container images this
// register does not hold, so a direct asset join is ~0% and the reach has to be stated.
//
// What this file pins:
//
//   1. DIRECT beats ADJACENT — the strongest true statement about the row wins.
//   2. The hop reads BOTH directions: the AI asset may be the edge's src or its dst.
//   3. Exactly one hop. Two is UNLINKED, and that cap is the model, not an optimisation.
//   4. An edge-less doc is all-UNLINKED WITH `edgesKnown: 0` — the pair, always.
//   5. An edge type outside ADJACENCY_EDGE_TYPES neither links nor counts.
//   6. `adjacentAssetIds` is sorted and de-duplicated, so a re-run cannot look like a change.

import { describe, expect, it } from "vitest";
import { ADJACENCY_EDGE_TYPES, withAiAdjacency } from "../src/domain/graphEnrich";
import type { EdgeType, GEdge, GNode, GraphDoc, IssueRow } from "../src/domain/graphTypes";
import { EDGE_TYPES } from "../src/domain/graphTypes";

const node = (id: string, kind: GNode["kind"]): GNode => ({ id, kind, name: id });
const edge = (src: string, type: EdgeType, dst: string, negated?: boolean): GEdge => ({
  id: `${src}|${type}|${dst}${negated ? "|neg" : ""}`, src, dst, type, ...(negated ? { negated } : {}),
});

let seq = 0;
function issue(assetId: string, over: Partial<IssueRow> = {}): IssueRow {
  seq += 1;
  return {
    id: `i-${seq}`, ruleId: "wc-id-2742", ruleName: "Allow model invoke without Guardrail",
    comboGroup: "bedrock-no-guardrail", nativeSeverity: "MEDIUM", adjustedSeverity: "HIGH",
    status: "OPEN", assetId, assetName: assetId, ...over,
  } as IssueRow;
}

/**
 * One AI agent wired the way a real one is: an execution identity, a host, an endpoint, a
 * model it invokes — plus a bucket that is two hops out and a container image reachable only
 * over an edge type adjacency does not read.
 */
function estateDoc(): GraphDoc {
  return {
    nodes: [
      node("agent-1", "AI_AGENT"),
      node("agent-2", "AI_AGENT"),
      node("model-1", "AI_MODEL"),
      node("sa-shared", "SERVICE_ACCOUNT"),
      node("vm-1", "VIRTUAL_MACHINE"),
      node("bucket-1", "BUCKET"),
      node("image-1", "CONTAINER_IMAGE"),
      node("sa-orphan", "SERVICE_ACCOUNT"),
    ],
    edges: [
      // The AI asset is the SRC: reached by reading the edge backwards.
      edge("agent-1", "RUNS_AS", "sa-shared"),
      edge("agent-2", "RUNS_AS", "sa-shared"),
      edge("agent-1", "HOSTED_ON", "vm-1"),
      // The AI asset is the DST: reached by reading the edge forwards.
      edge("sa-shared", "ALLOWS_ACCESS_TO", "model-1"),
      // Two hops from any AI asset — vm-1 is adjacent, bucket-1 is not.
      edge("vm-1", "ALLOWS_ACCESS_TO", "bucket-1"),
      // An adjacency-shaped link over an edge type the walk does not read.
      edge("agent-1", "BUILT_FROM", "image-1"),
    ],
    syncedAt: "2026-09-05T09:00:00.000Z",
  };
}

describe("ADJACENCY_EDGE_TYPES", () => {
  it("names only edge types the model actually declares", () => {
    for (const t of ADJACENCY_EDGE_TYPES) {
      expect([t, (EDGE_TYPES as readonly string[]).includes(t)]).toEqual([t, true]);
    }
  });

  it("carries CAN_INVOKE — the Bedrock spelling of the relationship the register is about", () => {
    // Measured, not assumed: without it the whole sample landscape censuses
    // {DIRECT: 24, ADJACENT: 0, UNLINKED: 8}, and all eight UNLINKED rows are ACCESS_ROLE
    // nodes one CAN_INVOKE edge from model-bedrock-claude. Admitting ALLOWS_ACCESS_TO and
    // refusing its Bedrock twin was an asymmetry — an identity's permission to invoke a model
    // is what wc-id-2742 (659 of 840 AI-category issues) is about.
    expect(ADJACENCY_EDGE_TYPES).toContain("CAN_INVOKE");
    expect(ADJACENCY_EDGE_TYPES).toContain("ALLOWS_ACCESS_TO");
  });

  it("excludes the evidence edges — a row is not adjacent to its own issue", () => {
    // HAS_ISSUE / HAS_FINDING join a row to what was said ABOUT it. Admitting either would
    // make almost everything ADJACENT and the reading would carry no information at all.
    expect(ADJACENCY_EDGE_TYPES).not.toContain("HAS_ISSUE");
    expect(ADJACENCY_EDGE_TYPES).not.toContain("HAS_FINDING");
    // PROTECTED_BY is emitted NEGATED to say a guardrail is absent, and an absence is not a
    // link. It is out of the list and the walk skips negated edges besides.
    expect(ADJACENCY_EDGE_TYPES).not.toContain("PROTECTED_BY");
    // BUILT_FROM is out for a different reason: it is a real adjacency (the image an agent was
    // built from, which is where §6.4 says the KEV findings sit) and a widening with its own
    // measurement to do. Pinned so the next round has to state its case rather than drift in.
    expect(ADJACENCY_EDGE_TYPES).not.toContain("BUILT_FROM");
  });
});

describe("withAiAdjacency", () => {
  it("calls a row on an AI asset DIRECT even when edges also reach others", () => {
    // agent-1 is AI-kinded AND has three adjacency edges. The strongest true statement wins.
    const { issues } = withAiAdjacency(estateDoc(), [issue("agent-1")]);
    expect(issues[0]!.aiAdjacency).toBe("DIRECT");
    // Empty, not [agent-1]: the field means "AI assets ONE EDGE AWAY" in every state, and
    // the asset a DIRECT row sits on is `assetId`, already on the row.
    expect(issues[0]!.adjacentAssetIds).toEqual([]);
    expect(issues[0]!.adjacencyVia).toBeUndefined();
  });

  it("reads the hop BACKWARDS — an identity two agents run as is adjacent to both", () => {
    const { issues } = withAiAdjacency(estateDoc(), [issue("sa-shared")]);
    expect(issues[0]!.aiAdjacency).toBe("ADJACENT");
    // Sorted and de-duplicated, so a re-run over the same graph cannot reorder a persisted
    // list and read as a change. model-1 arrives over ALLOWS_ACCESS_TO, the two agents over
    // RUNS_AS read backwards.
    expect(issues[0]!.adjacentAssetIds).toEqual(["agent-1", "agent-2", "model-1"]);
  });

  it("reads the hop FORWARDS too — the AI asset may be the edge's dst", () => {
    // vm-1 is only ever a destination (agent-1 HOSTED_ON vm-1), so a walk that read src->dst
    // alone would call it UNLINKED.
    const { issues } = withAiAdjacency(estateDoc(), [issue("vm-1")]);
    expect([issues[0]!.aiAdjacency, issues[0]!.adjacentAssetIds]).toEqual([
      "ADJACENT", ["agent-1"],
    ]);
    expect(issues[0]!.adjacencyVia).toBe("HOSTED_ON");
  });

  it("names the edge the adjacency came through, tie-broken by declaration order", () => {
    // sa-shared is reached by RUNS_AS (backwards) and ALLOWS_ACCESS_TO (forwards). The label
    // is deterministic rather than whichever edge the iteration happened to see first.
    const { issues } = withAiAdjacency(estateDoc(), [issue("sa-shared")]);
    expect(issues[0]!.adjacencyVia).toBe("RUNS_AS");
    const order = ADJACENCY_EDGE_TYPES.indexOf("RUNS_AS");
    expect(order).toBeLessThan(ADJACENCY_EDGE_TYPES.indexOf("ALLOWS_ACCESS_TO"));
  });

  it("stops at ONE hop — two is UNLINKED, and the cap is the model", () => {
    // bucket-1 <- ALLOWS_ACCESS_TO - vm-1 <- HOSTED_ON - agent-1. A second hop would turn
    // "beside an AI asset" into "connected to the cloud", which is true of everything.
    const { issues } = withAiAdjacency(estateDoc(), [issue("bucket-1")]);
    expect(issues[0]!.aiAdjacency).toBe("UNLINKED");
    expect(issues[0]!.adjacentAssetIds).toEqual([]);
  });

  it("does not link over an edge type outside the subset, and does not count it either", () => {
    // image-1 is one BUILT_FROM edge from agent-1. If BUILT_FROM ever joins the subset this
    // fails, which is the point: the population is a decision, not an accident.
    const { issues, census } = withAiAdjacency(estateDoc(), [issue("image-1")]);
    expect(issues[0]!.aiAdjacency).toBe("UNLINKED");
    // Five of the six fixture edges are adjacency types; BUILT_FROM is the sixth.
    expect(census.edgesKnown).toBe(5);
  });

  it("counts an entity nothing reaches as UNLINKED — we looked, as against we never ran", () => {
    const { issues } = withAiAdjacency(estateDoc(), [issue("sa-orphan")]);
    expect(issues[0]!.aiAdjacency).toBe("UNLINKED");
    // Absent is the fourth state and a different one: it means no pass ran, and
    // rank.adjacencyOf prices it as null rather than mid-scale.
    expect(issues[0]!.aiAdjacency).not.toBeUndefined();
  });

  it("an edge-less doc is all-UNLINKED AND says edgesKnown is 0", () => {
    // The pair, always. Three UNLINKED against 0 known edges is a statement about the sync,
    // not about the rows — 68 asset edges on the reference tenant is the same reading one
    // order of magnitude up.
    const bare: GraphDoc = { ...estateDoc(), edges: [] };
    const rows = [issue("sa-shared"), issue("vm-1"), issue("bucket-1")];
    const { issues, census } = withAiAdjacency(bare, rows);
    expect(issues.every((i) => i.aiAdjacency === "UNLINKED")).toBe(true);
    expect(census).toEqual({ DIRECT: 0, ADJACENT: 0, UNLINKED: 3, edgesKnown: 0 });
  });

  it("does not traverse a NEGATED edge, though the census still counts the type", () => {
    // A negated edge is emitted to say the relationship is ABSENT. Treating one as a link
    // would report a missing wire as a connection.
    const doc: GraphDoc = {
      ...estateDoc(),
      edges: [edge("agent-1", "RUNS_AS", "sa-orphan", true)],
    };
    const { issues, census } = withAiAdjacency(doc, [issue("sa-orphan")]);
    expect(issues[0]!.aiAdjacency).toBe("UNLINKED");
    expect(census.edgesKnown).toBe(1);
  });

  it("censuses every row exactly once, and the three counts sum to the population", () => {
    const rows = [
      issue("agent-1"), issue("model-1"),           // DIRECT
      issue("sa-shared"), issue("vm-1"),            // ADJACENT
      issue("bucket-1"), issue("image-1"), issue("sa-orphan"), // UNLINKED
    ];
    const { issues, census } = withAiAdjacency(estateDoc(), rows);
    expect(census).toEqual({ DIRECT: 2, ADJACENT: 2, UNLINKED: 3, edgesKnown: 5 });
    expect(census.DIRECT + census.ADJACENT + census.UNLINKED).toBe(issues.length);
  });

  it("never rewrites assetId, and is stable across a re-run", () => {
    const doc = estateDoc();
    const first = withAiAdjacency(doc, [issue("sa-shared")]).issues;
    // Re-runnable over rows already carrying the fields — the fold has to be usable against a
    // graph already in the sheet without re-deriving everything around it.
    const second = withAiAdjacency(doc, first).issues;
    expect(second[0]!.assetId).toBe("sa-shared");
    expect(second[0]!.adjacentAssetIds).toEqual(first[0]!.adjacentAssetIds);
    expect(second[0]!.aiAdjacency).toBe(first[0]!.aiAdjacency);
  });

  it("clears a stale via label when a re-run changes the row's state", () => {
    // The graph loses its edges between runs; a spread alone would carry the old edge label
    // forward under the new state and the row would claim a hop nobody walked.
    const wasAdjacent = withAiAdjacency(estateDoc(), [issue("sa-shared")]).issues;
    expect(wasAdjacent[0]!.adjacencyVia).toBe("RUNS_AS");
    const bare: GraphDoc = { ...estateDoc(), edges: [] };
    const now = withAiAdjacency(bare, wasAdjacent).issues;
    expect([now[0]!.aiAdjacency, now[0]!.adjacencyVia]).toEqual(["UNLINKED", undefined]);
  });
});
