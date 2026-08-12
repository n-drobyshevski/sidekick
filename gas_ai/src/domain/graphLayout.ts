// Deterministic graph layouts. Three modes, no forces, no randomness:
//
// - "rows" (default): the Wiz security-graph visual language, transposed to run
//   top-to-bottom instead of left-to-right — 5 category swimlanes become
//   horizontal bands stacked findings/issues → AI assets → identities → data →
//   compute/supply, with nodes spread left-to-right within each band. Wider
//   than it is tall, which fits typical widescreen viewports better than the
//   vertical "lanes" layout it's derived from.
// - "lanes": the same 5 category swimlanes as vertical columns placed
//   left-to-right, with nodes stacked top-to-bottom within each. "rows" is
//   its horizontal transpose — both share the same lane assignment and
//   barycenter/sort ordering; only the final x/y positioning differs.
// - "grouped": nodes clustered into labelled blocks by a key (asset, toxic
//   combo, project, cloud, kind, or severity); blocks are shelf-packed
//   left-to-right. Most keys arrange members in a compact grid; the "asset"
//   key is hub-and-spoke — each AI agent sits at the center of its block with
//   its BFS-nearest neighbors (issues, identities, data, compute) on rings
//   around it.
//
// All are reduced-motion friendly by construction (nothing animates), and all
// support explicit row-ordering ("sort") so the same URL always draws the same
// picture.
//
// "rows" and "lanes" additionally CLUSTER under the default "smart" order: connected
// nodes are packed into a contiguous stripe of slots across every band, and the next
// cluster starts a wider gutter away than the step between cards inside one. Proximity
// then does the grouping for free — the eye reads an attack path as one thing without a
// box drawn around it — which is the same trade layered layouts make when they lay out
// connected components separately and pack them with a component-to-component spacing.
// An explicit sort (severity / AARS / name) asks for one global order instead, so it
// turns clustering off rather than interleaving gutters into the sequence.

import { SEVERITY_ORDER } from "./config";
import type { GNode, NodeKind } from "./graphTypes";
import { AI_ASSET_KINDS, NODE_KINDS, isRiskKind } from "./graphTypes";
import type { Projection } from "./graphProject";
import { nodeOrder } from "./graphProject";
import { COMBO_GROUPS, comboGroupById } from "./toxicCombos";

export const LAYOUT_MODES = ["lanes", "grouped", "rows"] as const;
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
  EXCESSIVE_PRIVILEGE: 0,
  MISSING_GUARDRAIL: 0,
  INTERNET_EXPOSURE: 0,
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
  SENSITIVE_DATA: 3,
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
  /** Cluster rank in lanes/rows mode under the smart order — 0 is the worst-severity
   *  cluster, the last rank is the pooled bucket of lone nodes. Absent when clustering
   *  is off (an explicit sort, or grouped mode, which draws its blocks instead). */
  cluster?: number;
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

// Rows-mode geometry: the horizontal transpose of the lanes-mode gaps above.
const ROW_COL_STEP = 260; // horizontal distance between node centers within a band (clears the 196px card + right-edge markers)
const ROW_BAND_GAP = 150; // vertical distance between band centers (clears the 56px card + labels)

// Extra space inserted between clusters, on top of the within-cluster step. Grouping is
// only perceived when the gap BETWEEN groups clearly beats the gap inside one, so both
// values put roughly three times as much empty space between neighboring clusters as
// between two cards of the same cluster (260→400 across, 84→132 down).
const ROW_CLUSTER_GAP = 140;
const LANE_CLUSTER_GAP = 48;

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

// ------------------------------------------------------------- cluster packing

/**
 * Which node each derived node hangs off, so risk evidence and "+N more" stubs can
 * inherit a bucket they have no fields of their own for. Risk evidence is always the
 * `dst` of its edge; edges are walked in id order and the first parent wins, so a node
 * reachable from two assets still lands deterministically.
 */
function parentIndex(p: Projection): Map<string, GNode> {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parentOf = new Map<string, GNode>();
  for (const e of [...p.edges].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const dst = byId.get(e.dst);
    const src = byId.get(e.src);
    if (!dst || !src || !isRiskKind(dst.kind) || parentOf.has(dst.id)) continue;
    parentOf.set(dst.id, src);
  }
  for (const s of p.summaries) {
    const parent = byId.get(s.parentId);
    if (parent) parentOf.set(s.id, parent);
  }
  return parentOf;
}

/** Connected components of the projected subgraph, as a node id → root id map. */
function componentRoots(p: Projection): Map<string, string> {
  const parent = new Map<string, string>();
  for (const n of p.nodes) parent.set(n.id, n.id);
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  for (const e of [...p.edges].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!parent.has(e.src) || !parent.has(e.dst)) continue;
    const a = find(e.src);
    const b = find(e.dst);
    if (a !== b) parent.set(a, b);
  }
  const roots = new Map<string, string>();
  for (const n of p.nodes) roots.set(n.id, find(n.id));
  return roots;
}

/**
 * Cluster rank per node: 0 is the worst-severity cluster, and the highest rank is the
 * pool of nodes that have no cluster to belong to.
 *
 * A cluster starts as a connected component, then splits by nearest AI agent where one
 * component holds several — an unfiltered view of this product is usually ONE component,
 * since shared service accounts and buckets join every agent up, and "the paths around
 * this agent" is the unit an analyst actually reads. Lone nodes are pooled into a single
 * trailing bucket instead of each claiming a gutter of their own: a screen of evenly
 * spread singletons is the layout we already had, and spreading it further would say
 * "these are all separate groups" about nodes that are simply unconnected.
 */
function clusterRanks(p: Projection): Map<string, number> {
  const { hubOf } = assignToHubs(p, parentIndex(p));
  const roots = componentRoots(p);
  const degree = new Map<string, number>();
  for (const e of p.edges) {
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
  }

  const keyOf = new Map<string, string>();
  for (const node of p.nodes) {
    keyOf.set(node.id, hubOf.get(node.id) ?? "cc:" + roots.get(node.id));
  }
  const sharedEdges = (key: (id: string) => string): Map<string, Map<string, number>> => {
    const out = new Map<string, Map<string, number>>();
    for (const e of [...p.edges].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const a = key(e.src);
      const b = key(e.dst);
      if (!a || !b || a === b) continue;
      if (!out.has(a)) out.set(a, new Map());
      if (!out.has(b)) out.set(b, new Map());
      out.get(a)!.set(b, (out.get(a)!.get(b) ?? 0) + 1);
      out.get(b)!.set(a, (out.get(b)!.get(a) ?? 0) + 1);
    }
    return out;
  };

  // A cluster of one that still has edges is not a lone node — it is a node whose
  // neighbors were all claimed by some other agent's path. Fold it into whichever cluster
  // it shares the most edges with, so it travels with what it is connected to; only nodes
  // with no edges at all reach the pool.
  const merged = new Map<string, string>([...keyOf.values()].map((k) => [k, k]));
  const resolve = (k: string): string => {
    let root = k;
    while (merged.get(root) !== root) root = merged.get(root)!;
    return root;
  };
  const groupBy = (key: (id: string) => string): Map<string, GNode[]> => {
    const out = new Map<string, GNode[]>();
    for (const node of p.nodes) {
      const k = key(node.id);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(node);
    }
    return out;
  };
  const initial = groupBy((id) => keyOf.get(id)!);
  const initialShared = sharedEdges((id) => keyOf.get(id)!);
  for (const key of [...initial.keys()].sort()) {
    const list = initial.get(key)!;
    if (list.length !== 1 || !(degree.get(list[0].id) ?? 0)) continue;
    let best = 0;
    let target = "";
    for (const [other, weight] of [...(initialShared.get(key) ?? new Map())].sort()) {
      if (resolve(other) === resolve(key) || weight <= best) continue;
      best = weight;
      target = other;
    }
    if (target) merged.set(resolve(key), resolve(target));
  }

  const finalKey = (id: string): string => resolve(keyOf.get(id)!);
  const members = groupBy(finalKey);
  const shared = sharedEdges(finalKey);

  const worst = (key: string): number => {
    let rank: number = SEVERITY_ORDER.length;
    for (const n of members.get(key) ?? []) rank = Math.min(rank, severityRank(n.severity));
    return rank;
  };
  // Worst first, then the bigger path, then id — the same "most alarming leads" rule the
  // rest of the product sorts by, applied to whole clusters instead of single nodes.
  const keys = [...members.keys()]
    .filter((k) => members.get(k)!.length > 1)
    .sort((a, b) =>
      worst(a) - worst(b) ||
      members.get(b)!.length - members.get(a)!.length ||
      (a < b ? -1 : a > b ? 1 : 0));

  // Splitting a component by agent leaves edges that cross between clusters: the database
  // three agents all read, the identity two of them run as. Laying the stripes out in
  // severity order alone would strand those edges across the whole canvas, so each cluster
  // is instead slotted NEXT TO whichever placed cluster it shares the most edges with —
  // insertion, not appending, so all three readers of that database end up around it. The
  // worst cluster still opens the canvas, and severity order fills every opening where
  // nothing is shared.
  const chain: string[] = [];
  const unplaced = new Set(keys);
  while (unplaced.size) {
    let pick = "";
    let anchor = chain.length - 1;
    let best = 0;
    for (const k of keys) { // base order first, so equal weights resolve by severity
      if (!unplaced.has(k)) continue;
      const links = shared.get(k);
      if (!links) continue;
      for (let i = 0; i < chain.length; i++) {
        const weight = links.get(chain[i]) ?? 0;
        if (weight > best) {
          best = weight;
          pick = k;
          anchor = i;
        }
      }
    }
    if (!pick) {
      pick = keys.find((k) => unplaced.has(k))!;
      anchor = chain.length - 1;
    }
    chain.splice(anchor + 1, 0, pick);
    unplaced.delete(pick);
  }

  const rankOfKey = new Map<string, number>(chain.map((k, i) => [k, i]));
  const tail = chain.length; // the pooled lone nodes always sit last
  const ranks = new Map<string, number>();
  for (const node of p.nodes) {
    ranks.set(node.id, rankOfKey.get(finalKey(node.id)) ?? tail);
  }
  return ranks;
}

/**
 * Along-axis coordinate for every node, relative to the margin.
 *
 * Without clustering this is what it always was: one slot per node, shorter bands centered
 * against the longest. With it, every cluster claims as many slots as its busiest band
 * needs and keeps them in EVERY band, so a cluster occupies one contiguous stripe of the
 * canvas and its members line up across bands; each band's members are centered inside
 * that stripe, and the next stripe starts a gutter later.
 */
function packLanes(
  lanes: string[][],
  rankOf: Map<string, number> | null,
  step: number,
  gap: number,
): { pos: Map<string, number>; extent: number } {
  const pos = new Map<string, number>();
  if (!rankOf) {
    const widest = Math.max(1, ...lanes.map((l) => l.length));
    for (const lane of lanes) {
      const offset = ((widest - lane.length) * step) / 2;
      lane.forEach((id, i) => pos.set(id, offset + i * step));
    }
    return { pos, extent: (widest - 1) * step };
  }

  const slots = new Map<number, number>(); // cluster rank → slots, its busiest band
  for (const lane of lanes) {
    const perRank = new Map<number, number>();
    for (const id of lane) {
      const r = rankOf.get(id) ?? 0;
      perRank.set(r, (perRank.get(r) ?? 0) + 1);
    }
    for (const [r, count] of perRank) slots.set(r, Math.max(slots.get(r) ?? 0, count));
  }
  const start = new Map<number, number>();
  let cursor = 0;
  for (const r of [...slots.keys()].sort((a, b) => a - b)) {
    start.set(r, cursor);
    cursor += slots.get(r)! * step + gap;
  }

  let extent = 0;
  for (const lane of lanes) {
    // Lanes arrive sorted by rank, so each cluster's members are one contiguous run.
    let i = 0;
    while (i < lane.length) {
      const r = rankOf.get(lane[i]) ?? 0;
      let j = i;
      while (j < lane.length && (rankOf.get(lane[j]) ?? 0) === r) j++;
      const offset = start.get(r)! + ((slots.get(r)! - (j - i)) * step) / 2;
      for (let k = i; k < j; k++) {
        const at = offset + (k - i) * step;
        pos.set(lane[k], at);
        extent = Math.max(extent, at);
      }
      i = j;
    }
  }
  return { pos, extent };
}

export function layoutGraph(p: Projection, opts: LayoutOptions = {}): Layout {
  const mode = opts.mode ?? "rows";
  if (mode === "grouped") return layoutGrouped(p, opts);
  return layoutLanes(p, opts, mode !== "lanes"); // horizontal unless explicitly "lanes"
}

// ------------------------------------------------------------------ lanes mode

function layoutLanes(p: Projection, opts: LayoutOptions, horizontal: boolean): Layout {
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

  // Cluster the smart order, and only the smart order: an explicit sort is a request for
  // one global sequence, which gutters cut through. Sorting by rank is stable, so the
  // barycenter order survives INSIDE each cluster — which is the only place it can
  // matter, since edges never leave a connected component.
  const rankOf = sort === "smart" ? clusterRanks(p) : null;
  if (rankOf) {
    for (const lane of lanes) {
      lane.sort((a, b) => (rankOf.get(a) ?? 0) - (rankOf.get(b) ?? 0));
    }
  }

  const step = horizontal ? ROW_COL_STEP : rowGap;
  const gap = horizontal ? ROW_CLUSTER_GAP : LANE_CLUSTER_GAP;
  const { pos, extent } = packLanes(lanes, rankOf, step, rankOf ? gap : 0);
  const clusterOf = (id: string): number | undefined => rankOf?.get(id);

  const nodes: LayoutNode[] = [];
  if (horizontal) {
    // Bands stacked top-to-bottom, nodes spread left-to-right within each.
    lanes.forEach((lane, laneIdx) => {
      for (const id of lane) {
        nodes.push({
          id,
          lane: laneIdx,
          cluster: clusterOf(id),
          x: margin + pos.get(id)!,
          y: margin + laneIdx * ROW_BAND_GAP,
        });
      }
    });
    return {
      nodes,
      width: margin * 2 + extent,
      height: margin * 2 + (LANE_COUNT - 1) * ROW_BAND_GAP,
      laneGap: ROW_BAND_GAP,
      rowGap: ROW_COL_STEP,
      mode: "rows",
    };
  }
  // Lanes (vertical): columns left-to-right, nodes stacked top-to-bottom within each.
  lanes.forEach((lane, laneIdx) => {
    for (const id of lane) {
      nodes.push({
        id,
        lane: laneIdx,
        cluster: clusterOf(id),
        x: margin + laneIdx * laneGap,
        y: margin + pos.get(id)!,
      });
    }
  });
  return {
    nodes,
    width: margin * 2 + (LANE_COUNT - 1) * laneGap,
    height: margin * 2 + extent,
    laneGap,
    rowGap,
    mode: "lanes",
  };
}

// ---------------------------------------------------------------- grouped mode

/** Grouping key for a node. SUMMARY nodes group by the kind they collapse in
 *  kind grouping; for every other key they inherit their parent's bucket. Risk
 *  evidence follows the same rule — a "Sensitive data" or "Excessive rights" node
 *  has no combo, project, or cloud of its own, so grouping it on its own fields
 *  would exile the whole attack path to "Ungrouped".
 *  ("asset" is assigned by hub proximity in assignToHubs, never here.) */
function groupKeyOf(node: GNode, groupBy: GroupKey, parentOf: Map<string, GNode>): string {
  if ((node.kind === "SUMMARY" || isRiskKind(node.kind)) && groupBy !== "kind") {
    // Own key first: an ISSUE knows its own combo group, and an asset carrying two
    // combos must not drag its issues into whichever one sorts first.
    const own = ownGroupKey(node, groupBy);
    if (own !== GROUP_NONE) return own;
    const parent = parentOf.get(node.id);
    return parent ? groupKeyOf(parent, groupBy, parentOf) : GROUP_NONE;
  }
  return ownGroupKey(node, groupBy);
}

function ownGroupKey(node: GNode, groupBy: GroupKey): string {
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
  parentOf: Map<string, GNode>,
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
  // SUMMARY and risk nodes always follow their parent, whatever path BFS took.
  for (const [childId, parent] of parentOf) {
    const h = hubOf.get(parent.id);
    if (h) hubOf.set(childId, h);
  }
  return { hubOf, hubs };
}

function layoutGrouped(p: Projection, opts: LayoutOptions): Layout {
  const margin = opts.margin ?? 120;
  const groupBy = opts.groupBy ?? "combo";
  const sort = opts.sort ?? "smart";

  const parentOf = parentIndex(p);
  const cmp = comparator(sort);

  // Build one block spec per group. "asset" is hub-and-spoke; everything else
  // buckets by key into grids, in canonical group order.
  const specs: BlockSpec[] = [];
  if (groupBy === "asset") {
    const { hubOf, hubs } = assignToHubs(p, parentOf);
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
      const key = groupKeyOf(node, groupBy, parentOf);
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
