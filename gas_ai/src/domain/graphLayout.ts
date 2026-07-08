// Deterministic graph layouts. Two modes, no forces, no randomness:
//
// - "lanes" (default): layered left-to-right (the Wiz security-graph visual
//   language): findings/issues → AI assets → identities → data → compute/supply.
//   A few barycenter sweeps reduce crossings; rows are evenly spaced.
// - "grouped": nodes clustered into labelled blocks by a key (asset, toxic
//   combo, project, cloud, kind, or severity); blocks are shelf-packed
//   left-to-right. Most keys arrange members in a compact grid; the "asset"
//   key is hub-and-spoke — each AI agent sits at the center of its block with
//   its BFS-nearest neighbors (issues, identities, data, compute) on rings
//   around it.
//
// Both are reduced-motion friendly by construction (nothing animates), and both
// support explicit row-ordering ("sort") so the same URL always draws the same
// picture.

import { SEVERITY_ORDER } from "./config";
import type { GNode, NodeKind } from "./graphTypes";
import { AI_ASSET_KINDS, NODE_KINDS } from "./graphTypes";
import type { Projection } from "./graphProject";
import { nodeOrder } from "./graphProject";
import { COMBO_GROUPS, comboGroupById } from "./toxicCombos";

export const LAYOUT_MODES = ["lanes", "grouped"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export const GROUP_KEYS = ["asset", "combo", "project", "cloud", "kind", "severity"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const SORT_KEYS = ["smart", "severity", "aars", "name"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** Sentinel bucket for nodes without a value for the grouping key. Always last. */
export const GROUP_NONE = "__none__";

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
  AI_AGENT_REGISTRY: 1,
  AI_DEPLOYMENT: 1,
  AI_EXTENSION: 1,
  AI_GATEWAY: 1,
  AI_SERVICE: 1,
  AI_SKILL: 1,
  AI_SKILL_TEMPLATE: 1,
  AI_TOOL: 1,
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
  /** Lane index in "lanes" mode; group index in "grouped" mode (keyboard nav
   *  walks this axis either way). */
  lane: number;
}

/** A cluster block in "grouped" mode — the client draws it as a labelled hull. */
export interface LayoutGroup {
  id: string;    // `${groupBy}:${key}`
  key: string;   // raw key value, GROUP_NONE for the ungrouped bucket
  label: string; // display label (kind keys are formatted client-side)
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

export interface Layout {
  nodes: LayoutNode[];
  width: number;
  height: number;
  laneGap: number;
  rowGap: number;
  mode: LayoutMode;
  groups?: LayoutGroup[];
}

export interface LayoutOptions {
  laneGap?: number; // horizontal distance between lane centers (lanes mode)
  rowGap?: number;  // vertical distance between row centers (lanes mode)
  margin?: number;
  mode?: LayoutMode;
  groupBy?: GroupKey;
  sort?: SortKey;
}

const BARYCENTER_SWEEPS = 3;

// Grouped-mode geometry: cells fit the 196×56 node card plus gutters.
const CELL_W = 240;
const CELL_H = 84;
const GROUP_PAD = 24;
const HEADER_H = 30;
const BLOCK_GAP_X = 48;
const BLOCK_GAP_Y = 64;
const MAX_SHELF_W = 1600;

function severityRank(s: string | undefined): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(s ?? "");
  return i === -1 ? SEVERITY_ORDER.length : i; // lower = worse
}

function cmpName(a: GNode, b: GNode): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function cmpId(a: GNode, b: GNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Explicit ordering comparator; "smart" falls back to the projection's
 *  (severity, AARS, name) priority. Final tie-break is always id. */
function comparator(sort: SortKey): (a: GNode, b: GNode) => number {
  if (sort === "severity") {
    return (a, b) => severityRank(a.severity) - severityRank(b.severity) || cmpName(a, b) || cmpId(a, b);
  }
  if (sort === "aars") {
    return (a, b) => (b.aars ?? -1) - (a.aars ?? -1) || cmpName(a, b) || cmpId(a, b);
  }
  if (sort === "name") {
    return (a, b) => cmpName(a, b) || cmpId(a, b);
  }
  return (a, b) => nodeOrder(a, b) || cmpId(a, b);
}

export function layoutGraph(p: Projection, opts: LayoutOptions = {}): Layout {
  if ((opts.mode ?? "lanes") === "grouped") return layoutGrouped(p, opts);
  return layoutLanes(p, opts);
}

// ------------------------------------------------------------------ lanes mode

function layoutLanes(p: Projection, opts: LayoutOptions): Layout {
  const laneGap = opts.laneGap ?? 280;
  const rowGap = opts.rowGap ?? 84;
  const margin = opts.margin ?? 120;
  const sort = opts.sort ?? "smart";

  // Initial per-lane order = projection order (already severity/AARS sorted).
  const lanes: string[][] = Array.from({ length: LANE_COUNT }, () => []);
  const laneIndex = new Map<string, number>();
  for (const node of p.nodes) {
    const lane = laneOf(node.kind, node.summaryOf);
    laneIndex.set(node.id, lane);
    lanes[lane].push(node.id);
  }

  if (sort === "smart") {
    // Barycenter sweeps: order each lane by the mean row of its (already placed)
    // neighbors in OTHER lanes; stable tie-break on current row keeps determinism.
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
  } else {
    // Explicit ordering wins: sort each lane by the chosen comparator, no sweeps.
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const cmp = comparator(sort);
    for (const lane of lanes) {
      lane.sort((a, b) => cmp(byId.get(a)!, byId.get(b)!));
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
    mode: "lanes",
  };
}

// ---------------------------------------------------------------- grouped mode

/** Grouping key for a node. SUMMARY nodes group by the kind they collapse in
 *  kind grouping; for every other key they inherit their parent's bucket.
 *  ("asset" is assigned by hub proximity in assignToHubs, never here.) */
function groupKeyOf(node: GNode, groupBy: GroupKey, parentOfSummary: Map<string, GNode>): string {
  if (node.kind === "SUMMARY" && groupBy !== "kind") {
    const parent = parentOfSummary.get(node.id);
    return parent ? groupKeyOf(parent, groupBy, parentOfSummary) : GROUP_NONE;
  }
  switch (groupBy) {
    case "combo": {
      const groups = [...(node.comboGroups ?? [])].sort();
      return groups[0] ?? GROUP_NONE;
    }
    case "project": {
      const names = (node.projects ?? []).map((p) => p.name).sort();
      return names[0] ?? GROUP_NONE;
    }
    case "cloud":
      return node.cloudPlatform ?? GROUP_NONE;
    case "kind":
      return node.kind === "SUMMARY" ? (node.summaryOf ?? "SUMMARY") : node.kind;
    case "severity":
      return node.severity ?? GROUP_NONE;
    case "asset":
      return GROUP_NONE; // unreachable — asset grouping is BFS-assigned
  }
}

function groupLabel(key: string, groupBy: GroupKey): string {
  if (key === GROUP_NONE) return "Ungrouped";
  if (groupBy === "combo") return comboGroupById(key)?.shortLabel ?? key;
  return key;
}

/** Canonical, deterministic group ordering; GROUP_NONE is always last. */
function orderGroups(
  keys: string[],
  groupBy: GroupKey,
  members: Map<string, GNode[]>,
): string[] {
  const canonical = (key: string): number => {
    if (groupBy === "severity") return (SEVERITY_ORDER as readonly string[]).indexOf(key);
    if (groupBy === "kind") return (NODE_KINDS as readonly string[]).indexOf(key);
    if (groupBy === "combo") return COMBO_GROUPS.findIndex((g) => g.id === key);
    return -1;
  };
  const worstSeverity = (key: string): number => {
    let worst: number = SEVERITY_ORDER.length;
    for (const n of members.get(key) ?? []) worst = Math.min(worst, severityRank(n.severity));
    return worst;
  };
  return [...keys].sort((a, b) => {
    if (a === GROUP_NONE) return b === GROUP_NONE ? 0 : 1;
    if (b === GROUP_NONE) return -1;
    const ca = canonical(a);
    const cb = canonical(b);
    if (ca !== -1 || cb !== -1) {
      if (ca === -1) return 1;
      if (cb === -1) return -1;
      return ca - cb;
    }
    return worstSeverity(a) - worstSeverity(b) || (a < b ? -1 : a > b ? 1 : 0);
  });
}

// Hub-and-spoke ("asset") geometry: ring i holds RING_CAP*i satellites on an
// ellipse of RING_RX*i by RING_RY*i. These constants were chosen so adjacent
// 196×56 cards on any ring (and across rings) can never overlap.
const RING_CAP = 8;
const RING_RX = 300;
const RING_RY = 150;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A group block before placement: size + node centers relative to its
 *  top-left corner. Blocks are shelf-packed onto the canvas afterwards. */
interface BlockSpec {
  key: string;
  label: string;
  width: number;
  height: number;
  cells: Array<{ id: string; x: number; y: number }>;
}

/** Compact row-major grid — the default block interior. */
function gridBlock(key: string, label: string, list: GNode[]): BlockSpec {
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(list.length))));
  const rows = Math.ceil(list.length / cols);
  return {
    key,
    label,
    width: GROUP_PAD * 2 + cols * CELL_W,
    height: HEADER_H + GROUP_PAD * 2 + rows * CELL_H,
    cells: list.map((node, i) => ({
      id: node.id,
      x: GROUP_PAD + (i % cols) * CELL_W + CELL_W / 2,
      y: HEADER_H + GROUP_PAD + Math.floor(i / cols) * CELL_H + CELL_H / 2,
    })),
  };
}

/** Hub at the block center, satellites on concentric elliptical rings starting
 *  at 12 o'clock. Satellite order = the sort comparator, so the highest-risk
 *  neighbors sit on the innermost ring. */
function radialBlock(key: string, label: string, hub: GNode, satellites: GNode[]): BlockSpec {
  const rings: GNode[][] = [];
  for (let i = 0, ring = 1; i < satellites.length; ring++) {
    rings.push(satellites.slice(i, i + RING_CAP * ring));
    i += RING_CAP * ring;
  }
  const n = rings.length;
  const halfW = RING_RX * n + CELL_W / 2;
  const halfH = RING_RY * n + CELL_H / 2;
  const width = GROUP_PAD * 2 + halfW * 2;
  const height = HEADER_H + GROUP_PAD * 2 + halfH * 2;
  const cx = width / 2;
  const cy = HEADER_H + GROUP_PAD + halfH;
  const cells = [{ id: hub.id, x: cx, y: cy }];
  rings.forEach((ringNodes, ri) => {
    const rx = RING_RX * (ri + 1);
    const ry = RING_RY * (ri + 1);
    // Spread the ring's actual occupants evenly — wider gaps than the capacity
    // spacing the collision analysis assumed, so always safe, and balanced.
    const step = (Math.PI * 2) / ringNodes.length;
    ringNodes.forEach((node, k) => {
      const a = -Math.PI / 2 + k * step;
      cells.push({
        id: node.id,
        x: round2(cx + rx * Math.cos(a)),
        y: round2(cy + ry * Math.sin(a)),
      });
    });
  });
  return { key, label, width, height, cells };
}

/** Multi-source BFS from the hub assets: every node joins its nearest hub;
 *  distance ties go to the higher-risk hub (it enters the queue first).
 *  Hubs are AI agents; if the projection has none, any AI asset qualifies. */
function assignToHubs(
  p: Projection,
  parentOfSummary: Map<string, GNode>,
): { hubOf: Map<string, string>; hubs: GNode[] } {
  const cmp = (a: GNode, b: GNode) => nodeOrder(a, b) || cmpId(a, b);
  let hubs = p.nodes.filter((n) => n.kind === "AI_AGENT");
  if (!hubs.length) {
    hubs = p.nodes.filter((n) => (AI_ASSET_KINDS as readonly string[]).includes(n.kind));
  }
  hubs = [...hubs].sort(cmp);

  const adj = new Map<string, string[]>();
  const sortedEdges = [...p.edges].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const e of sortedEdges) {
    if (!adj.has(e.src)) adj.set(e.src, []);
    if (!adj.has(e.dst)) adj.set(e.dst, []);
    adj.get(e.src)!.push(e.dst);
    adj.get(e.dst)!.push(e.src);
  }

  const hubOf = new Map<string, string>();
  const queue: string[] = [];
  for (const h of hubs) {
    hubOf.set(h.id, h.id);
    queue.push(h.id);
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (hubOf.has(next)) continue;
      hubOf.set(next, hubOf.get(id)!);
      queue.push(next);
    }
  }
  // SUMMARY nodes always follow their parent, whatever path BFS took.
  for (const [sumId, parent] of parentOfSummary) {
    const h = hubOf.get(parent.id);
    if (h) hubOf.set(sumId, h);
  }
  return { hubOf, hubs };
}

function layoutGrouped(p: Projection, opts: LayoutOptions): Layout {
  const margin = opts.margin ?? 120;
  const groupBy = opts.groupBy ?? "combo";
  const sort = opts.sort ?? "smart";

  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parentOfSummary = new Map<string, GNode>();
  for (const s of p.summaries) {
    const parent = byId.get(s.parentId);
    if (parent) parentOfSummary.set(s.id, parent);
  }
  const cmp = comparator(sort);

  // Build one block spec per group. "asset" is hub-and-spoke; everything else
  // buckets by key into grids, in canonical group order.
  const specs: BlockSpec[] = [];
  if (groupBy === "asset") {
    const { hubOf, hubs } = assignToHubs(p, parentOfSummary);
    const members = new Map<string, GNode[]>(hubs.map((h) => [h.id, []]));
    const strays: GNode[] = [];
    for (const node of p.nodes) {
      const key = hubOf.get(node.id);
      if (key) members.get(key)!.push(node);
      else strays.push(node);
    }
    for (const hub of hubs) {
      const sats = members.get(hub.id)!.filter((n) => n.id !== hub.id).sort(cmp);
      specs.push(radialBlock(hub.id, hub.name, hub, sats));
    }
    if (strays.length) specs.push(gridBlock(GROUP_NONE, "Ungrouped", [...strays].sort(cmp)));
  } else {
    const members = new Map<string, GNode[]>();
    for (const node of p.nodes) {
      const key = groupKeyOf(node, groupBy, parentOfSummary);
      if (!members.has(key)) members.set(key, []);
      members.get(key)!.push(node);
    }
    for (const key of orderGroups([...members.keys()], groupBy, members)) {
      specs.push(gridBlock(key, groupLabel(key, groupBy), [...members.get(key)!].sort(cmp)));
    }
  }

  // Shelf-pack the blocks left-to-right. The wrap width adapts to the total
  // block area so the canvas stays roughly screen-shaped (16:9-ish) instead of
  // degenerating into one tall column when blocks are large (asset hubs).
  const totalArea = specs.reduce(
    (acc, s) => acc + (s.width + BLOCK_GAP_X) * (s.height + BLOCK_GAP_Y),
    0,
  );
  const shelfW = Math.max(MAX_SHELF_W, Math.ceil(Math.sqrt(totalArea * 1.8)));

  const nodes: LayoutNode[] = [];
  const groups: LayoutGroup[] = [];
  let shelfX = margin;
  let shelfY = margin;
  let shelfH = 0;
  let maxX = 0;

  specs.forEach((spec, groupIdx) => {
    if (shelfX > margin && shelfX + spec.width > margin + shelfW) {
      shelfY += shelfH + BLOCK_GAP_Y;
      shelfX = margin;
      shelfH = 0;
    }
    const gx = shelfX;
    const gy = shelfY;
    shelfX += spec.width + BLOCK_GAP_X;
    shelfH = Math.max(shelfH, spec.height);
    maxX = Math.max(maxX, gx + spec.width);

    groups.push({
      id: `${groupBy}:${spec.key}`,
      key: spec.key,
      label: spec.label,
      x: gx,
      y: gy,
      width: spec.width,
      height: spec.height,
      count: spec.cells.length,
    });
    for (const c of spec.cells) {
      nodes.push({ id: c.id, lane: groupIdx, x: gx + c.x, y: gy + c.y });
    }
  });

  return {
    nodes,
    width: maxX + margin,
    height: shelfY + shelfH + margin,
    laneGap: CELL_W,
    rowGap: CELL_H,
    mode: "grouped",
    groups,
  };
}
