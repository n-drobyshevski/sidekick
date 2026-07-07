// Deterministic layered left-to-right layout (the Wiz security-graph visual
// language): findings/issues → AI assets → identities → data → compute/supply-chain.
// No forces, no randomness — a few barycenter sweeps reduce crossings, rows are
// evenly spaced. Reduced-motion friendly by construction (nothing animates).

import type { NodeKind } from "./graphTypes";
import type { Projection } from "./graphProject";

const LANE_OF: Record<string, number> = {
  ISSUE: 0,
  EXCESSIVE_ACCESS_FINDING: 0,
  LATERAL_MOVEMENT_FINDING: 0,
  AI_AGENT: 1,
  AI_MODEL: 1,
  AI_GUARDRAIL: 1,
  AI_PIPELINE: 1,
  AI_DATASET: 1,
  MCP_SERVER: 1,
  SERVICE_ACCOUNT: 2,
  USER_ACCOUNT: 2,
  ACCESS_ROLE: 2,
  ACCESS_ROLE_BINDING: 2,
  BUCKET: 3,
  DATABASE: 3,
  VIRTUAL_MACHINE: 4,
  SERVERLESS: 4,
  CONTAINER_IMAGE: 4,
  REPOSITORY: 4,
};
const LANE_COUNT = 5;

export function laneOf(kind: NodeKind, summaryOf?: NodeKind): number {
  if (kind === "SUMMARY" && summaryOf) return LANE_OF[summaryOf] ?? 2;
  return LANE_OF[kind] ?? 2;
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  lane: number;
}

export interface Layout {
  nodes: LayoutNode[];
  width: number;
  height: number;
  laneGap: number;
  rowGap: number;
}

export interface LayoutOptions {
  laneGap?: number; // horizontal distance between lane centers
  rowGap?: number;  // vertical distance between row centers
  margin?: number;
}

const BARYCENTER_SWEEPS = 3;

export function layoutGraph(p: Projection, opts: LayoutOptions = {}): Layout {
  const laneGap = opts.laneGap ?? 280;
  const rowGap = opts.rowGap ?? 84;
  const margin = opts.margin ?? 120;

  // Initial per-lane order = projection order (already severity/AARS sorted).
  const lanes: string[][] = Array.from({ length: LANE_COUNT }, () => []);
  const laneIndex = new Map<string, number>();
  for (const node of p.nodes) {
    const lane = laneOf(node.kind, node.summaryOf);
    laneIndex.set(node.id, lane);
    lanes[lane].push(node.id);
  }

  // Neighbor map for barycenter ordering.
  const neighbors = new Map<string, string[]>();
  for (const edge of p.edges) {
    if (!neighbors.has(edge.src)) neighbors.set(edge.src, []);
    if (!neighbors.has(edge.dst)) neighbors.set(edge.dst, []);
    neighbors.get(edge.src)!.push(edge.dst);
    neighbors.get(edge.dst)!.push(edge.src);
  }

  const rowOf = new Map<string, number>();
  const refreshRows = () => {
    for (const lane of lanes) lane.forEach((id, i) => rowOf.set(id, i));
  };
  refreshRows();

  // Barycenter sweeps: order each lane by the mean row of its (already placed)
  // neighbors in OTHER lanes; stable tie-break on current row keeps determinism.
  for (let sweep = 0; sweep < BARYCENTER_SWEEPS; sweep++) {
    for (const lane of lanes) {
      if (lane.length < 2) continue;
      const score = new Map<string, number>();
      for (const id of lane) {
        const others = (neighbors.get(id) ?? []).filter(
          (n) => laneIndex.get(n) !== laneIndex.get(id) && rowOf.has(n),
        );
        score.set(
          id,
          others.length
            ? others.reduce((acc, n) => acc + (rowOf.get(n) ?? 0), 0) / others.length
            : rowOf.get(id) ?? 0,
        );
      }
      lane.sort((a, b) => {
        const d = (score.get(a) ?? 0) - (score.get(b) ?? 0);
        if (d !== 0) return d;
        return (rowOf.get(a) ?? 0) - (rowOf.get(b) ?? 0);
      });
      refreshRows();
    }
  }

  // Center shorter lanes vertically against the tallest lane.
  const tallest = Math.max(1, ...lanes.map((l) => l.length));
  const nodes: LayoutNode[] = [];
  lanes.forEach((lane, laneIdx) => {
    const offset = ((tallest - lane.length) * rowGap) / 2;
    lane.forEach((id, row) => {
      nodes.push({
        id,
        lane: laneIdx,
        x: margin + laneIdx * laneGap,
        y: margin + offset + row * rowGap,
      });
    });
  });

  return {
    nodes,
    width: margin * 2 + (LANE_COUNT - 1) * laneGap,
    height: margin * 2 + (tallest - 1) * rowGap,
    laneGap,
    rowGap,
  };
}
