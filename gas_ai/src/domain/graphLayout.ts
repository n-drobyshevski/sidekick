// Deterministic graph layouts. TWO INDEPENDENT DIMENSIONS, no randomness anywhere.
//
// GROUPING (`groupBy`, none / one / two dimensions) partitions the nodes into labelled boxes.
// THE ARRANGEMENT (`mode`, one of five) decides how nodes are placed — over the whole canvas
// when there is no grouping, and inside each box when there is. They compose: every pair means
// something, and neither is a special case of the other.
//
// Grouping used to BE an arrangement ("grouped"), which made the two mutually exclusive and left
// the arrangement meaningless whenever grouping was on. The answer is that the arrangement is
// what happens INSIDE a box; "grouped" is now `grid`, the compact row-major packing it always
// actually drew, and grouping is free to sit on top of any of the five.
//
// The five arrangements:
//
// - "rows": the Wiz security-graph visual language, transposed to run
//   top-to-bottom instead of left-to-right — 5 category swimlanes become
//   horizontal bands stacked findings/issues → AI assets → identities → data →
//   compute/supply, with nodes spread left-to-right within each band. Wider
//   than it is tall, which fits typical widescreen viewports better than the
//   vertical "lanes" layout it's derived from.
// - "lanes": the same 5 category swimlanes as vertical columns placed
//   left-to-right, with nodes stacked top-to-bottom within each. "rows" is
//   its horizontal transpose — both share the same lane assignment and
//   barycenter/sort ordering; only the final x/y positioning differs.
// - "grid" (default): every node in one compact row-major grid, categories
//   ignored. The densest of the five, and the interior every grouped picture
//   used to have.
//
// GRID IS THE DEFAULT BECAUSE OF WHAT "FIT TO VIEW" LANDS ON. Density is the
// whole difference between a first paint you can read and one you have to zoom
// into, and the gap is not marginal — measured on three sample projections
// against a 1180x660 canvas:
//
//     nodes    rows    lanes    grid    organic   radial
//        42     34%      36%     66%        56%      19%
//        69     23%      35%     61%        36%      13%
//        96     21%      24%     53%        36%      15%
//
// The category arrangements spend the canvas on structure: a band is as long as
// its busiest kind, so five bands are as long as the worst one and four of them
// carry whitespace to match. Grid roughly doubles the zoom on every fixture,
// which is the difference between cards showing their names and cards showing a
// smear. What that costs is real and worth stating: grid says nothing about
// category, and its row-major wrap breaks up connected components, so it draws
// FEWER cluster outlines than rows does (8 of 12 components at 69 nodes against
// rows' 12). Both are one keypress away — the trade is only about which picture
// answers first, and "all of it, legible" beats "some of it, arranged".
// - "radial": the whole estate as one ring system. The worst-risk AI agent is
//   the center and every other node sits on the ring of its BFS distance from
//   it, so a ring IS "n hops from the thing most likely to hurt you". Ring
//   radii come from occupancy, never from a constant: the circumference has to
//   fit its own cards, which is what makes the layout overlap-free at any size.
// - "organic": force-directed — repulsion between every pair, springs along the
//   edges, weak gravity toward the center. Clusters emerge from the edges
//   instead of being declared, which is what finds structure the five fixed
//   category bands cannot express.
//
// "organic" IS forces, and this header used to say there were none. What it was
// really promising is DETERMINISM — "the same URL always draws the same picture"
// — and that survives intact: the seed is each node's radial ring position, a
// computed order, and `Math.random` appears nowhere in this file. Two calls with
// the same projection and options are byte-identical, which a test asserts.
//
// All are reduced-motion friendly by construction (nothing animates), and all
// support explicit row-ordering ("sort") so the same URL always draws the same
// picture.
//
// GROUPING RUNS EACH ARRANGEMENT ON A SUBSET rather than reimplementing it. A group's block is
// the arrangement's own output over a sub-projection, measured and framed — so "rows grouped by
// cloud" is the rows engine, five times, and there is one implementation of rows. The two
// exceptions are `grid`, which is already block-shaped, and `radial`, which uses the
// hub-and-spoke `radialBlock` inside a group: a whole estate is one component with real hop
// structure to show, while a six-node group usually is not, and rank rings pack tighter when
// every member is one hop out. Both are rings around the most important node.
//
// "rows" and "lanes" additionally CLUSTER under the default "smart" order: connected
// nodes are packed into a contiguous stripe of slots across every band, and the next
// cluster starts a wider gutter away than the step between cards inside one. Proximity
// then does the grouping for free — the eye reads an attack path as one thing without a
// box drawn around it — which is the same trade layered layouts make when they lay out
// connected components separately and pack them with a component-to-component spacing.
// An explicit sort (severity / AARS / name) asks for one global order instead, so it
// turns clustering off rather than interleaving gutters into the sequence.
//
// The run of clusters WRAPS onto shelves — repeats of the whole band set, stacked below
// (rows) or beside (lanes) each other — chosen so the canvas comes out roughly the shape
// of the viewport. A tenant laid out in one line is a ribbon thousands of pixels long and
// a few hundred deep, which "fit to view" can only show by shrinking every card past
// reading; wrapping trades that length for depth and roughly doubles the zoom.

import { SEVERITY_ORDER } from "./config";
import type { GNode, NodeKind } from "./graphTypes";
import { AI_ASSET_KINDS, NODE_KINDS, isRiskKind, severityRank } from "./graphTypes";
import type { Projection } from "./graphProject";
import { nodeOrder } from "./graphProject";
import { comboGroupById, REGISTER_GROUPS } from "./toxicCombos";

export const LAYOUT_MODES = ["lanes", "rows", "grid", "organic", "radial"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

/**
 * The arrangement a caller that names none gets — see the header for the measurement.
 *
 * Named once, and exported, because the default is a CROSS-LAYER AGREEMENT rather than a local
 * fallback: the resolver falls back to it, both halves of the dispatch below default to it, and
 * the page omits `layout=` from the hash precisely when it means this one. Three copies of a bare
 * `?? "rows"` is how a default gets changed in two of its three homes.
 */
export const DEFAULT_LAYOUT: LayoutMode = "grid";

export const GROUP_KEYS = ["asset", "combo", "project", "cloud", "kind", "severity"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const SORT_KEYS = ["smart", "severity", "aars", "name"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** Sentinel bucket for nodes without a value for the grouping key. Always last. */
export const GROUP_NONE = "__none__";

const LANE_OF: Record<string, number> = {
  ISSUE: 0,
  EXCESSIVE_ACCESS_FINDING: 0,
  IDENTITY_ACCESS_FINDING: 0,
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
  DATABASE_SERVER: 3,
  SENSITIVE_DATA: 3,
  // The bands ARE the path, read left to right, and the data-exposure chain ends here:
  // agent (1) → identity (2) → classified store (3) → what was found in it (4). Filing data
  // findings with the other evidence in band 0 would make the graph's most important edge
  // its longest, running back across the whole canvas from the store it describes.
  DATA_FINDING: 4,
  VIRTUAL_MACHINE: 5,
  SERVERLESS: 5,
  CONTAINER_IMAGE: 5,
  REPOSITORY: 5,
  // Beside the compute that serves it. An endpoint is the far edge of the estate, but it is
  // inventory rather than evidence, so it belongs in the infrastructure band and not in the
  // risk band where INTERNET_EXPOSURE sits.
  ENDPOINT: 5,
};
const LANE_COUNT = 6;

export function laneOf(kind: NodeKind, summaryOf?: NodeKind): number {
  if (kind === "SUMMARY" && summaryOf) return LANE_OF[summaryOf] ?? 2;
  return LANE_OF[kind] ?? 2;
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  /** Category band in "lanes"/"rows"; grid row in "grid" (the default, so the commonest
   *  answer); hops from the hub in "radial"/"organic"; the containing box's index when
   *  grouped. Whatever the mode calls it, it is the axis keyboard nav walks with two of its
   *  four arrows — so every mode has to answer with something a reader could step along and
   *  recognise, never a filler zero. */
  lane: number;
  /** Cluster rank in lanes/rows mode under the smart order — 0 is the worst-severity
   *  cluster, the last rank is the pooled bucket of lone nodes. Absent when clustering
   *  is off (an explicit sort, or grouped mode, which draws its blocks instead). */
  cluster?: number;
  /** Which shelf — repeat of the full band set — this node sits on. Absent when the
   *  clusters all fit on one, which is every unwrapped layout. */
  shelf?: number;
}

/** A cluster block in "grouped" mode — the client draws it as a labelled hull. */
export interface LayoutGroup {
  id: string;    // `${by}:${key}`, or `${by1}:${key1}/${by2}:${key2}` for a sub-group
  key: string;   // raw key value, GROUP_NONE for the ungrouped bucket
  label: string; // display label (kind keys are formatted client-side)
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
  /** Which dimension THIS rectangle partitions. The two levels can be different
   *  dimensions, so the client cannot read one page-level `groupBy` to decide how to
   *  format a label — it has to ask the box. */
  by: GroupKey;
  depth: 0 | 1;
  /** Index of the enclosing group, on sub-groups only. Parents are always emitted
   *  before their children, so this points backwards and the client can draw the
   *  array in order and get correct paint layering for free. */
  parent?: number;
}

/**
 * One connected component's outline — the only structure on this canvas that is about the EDGES
 * rather than about a property or a position.
 *
 * A component, not the `clusterRanks` unit the arrangements space by. That one splits a component
 * across several clusters by nearest agent (its own comment says so: "the database three agents
 * all read"), so an outline around it would be crossed by edges — and an outline that edges cross
 * is worse than none. A component is edge-closed by definition.
 */
export interface LayoutCluster {
  /** Convex polygon in layout space, already padded to clear the node cards. */
  points: Array<[number, number]>;
  count: number;
  /** Index into `groups` of the leaf box holding it. Absent when nothing is grouping. */
  group?: number;
}

export interface Layout {
  nodes: LayoutNode[];
  width: number;
  height: number;
  laneGap: number;
  rowGap: number;
  mode: LayoutMode;
  groups?: LayoutGroup[];
  clusters?: LayoutCluster[];
}

export interface LayoutOptions {
  laneGap?: number; // horizontal distance between lane centers (lanes mode)
  rowGap?: number;  // vertical distance between row centers (lanes mode)
  margin?: number;
  mode?: LayoutMode;
  /** One or two dimensions. Two nests the second inside the first. EMPTY MEANS NO GROUPING —
   *  it is a real value, not a missing one, which is what lets grouping be a dimension the
   *  arrangement composes with rather than one of the arrangements. */
  groupBy?: GroupKey[];
  sort?: SortKey;
  /**
   * Place only the bands that hold something, at consecutive offsets.
   *
   * OFF for the whole canvas, where the six bands are a fixed frame of reference and an empty
   * one is information — "this estate has no compute in view" reads off the gap. ON inside a
   * group, where a box holding assets and data alone would otherwise reserve all six band gaps
   * and come out mostly air. The reported `lane` is the true category band either way.
   */
  compactBands?: boolean;
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

// Wrapping: the run of clusters breaks onto a new shelf — a fresh set of bands below (or
// beside) the last — so the canvas ends up roughly the shape of the viewport rather than a
// ribbon nothing can be read at. Both gaps are wider than the band spacing inside a shelf,
// so a shelf boundary never reads as just another band.
const ROW_SHELF_GAP = 200; // rows mode: vertical space between shelves (bands are 150 apart)
const LANE_SHELF_GAP = 200; // lanes mode: horizontal space between shelves (lanes are 280 apart)
// The workbench body's shape (the window minus the sidebar rail and the top bar). Only the
// aspect is needed: "fit to view" scales by whichever axis binds first, and scaling the
// viewport scales every candidate wrap alike.
const VIEWPORT_ASPECT = 1.9;

// Grouped-mode geometry: cells fit the 196×56 node card plus gutters.
const CELL_W = 240;
const CELL_H = 84;
const GROUP_PAD = 24;
const HEADER_H = 30;
const BLOCK_GAP_X = 48;
const BLOCK_GAP_Y = 64;
const MAX_SHELF_W = 1600;


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

/**
 * Undirected adjacency over the projected subgraph.
 *
 * EDGES ARE WALKED IN ID ORDER, which is not decoration: every BFS built on this map reaches
 * ties in a fixed sequence, so "which hub claimed this node" and "which ring it landed on" are
 * facts about the graph rather than about whatever order the projection happened to emit. The
 * same sort appears in `componentRoots` and `parentIndex` for the same reason.
 */
function adjacency(p: Projection): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of [...p.edges].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!adj.has(e.src)) adj.set(e.src, []);
    if (!adj.has(e.dst)) adj.set(e.dst, []);
    adj.get(e.src)!.push(e.dst);
    adj.get(e.dst)!.push(e.src);
  }
  return adj;
}

/**
 * Hops from the estate's worst-risk AI agent — the axis "radial" and "organic" are both built on.
 *
 * The root is `assignToHubs`' first hub, which that function has already sorted worst-first by
 * `nodeOrder`; where the projection holds no AI asset at all it falls back to the first node in
 * projection order, which is itself severity-sorted. So ring 0 is never an arbitrary node.
 *
 * A node BFS cannot reach gets `maxDepth + 1` rather than 0. Filing the unreachable at the centre
 * would put the nodes with no path to the risk in the position the layout reserves for its
 * source; one ring beyond the last real hop says what they are. In this product that set is
 * normally small — see `clusterRanks` on why an unfiltered view is usually one component.
 *
 * Returned depths double as `LayoutNode.lane`, which is what keeps the canvas walkable by
 * keyboard: `graphView.js` moves along `lane` with two arrows and follows edges with the other
 * two, so the lane axis becomes "distance from the hub" instead of a category band.
 */
function hopDepth(p: Projection): { depth: Map<string, number>; root: GNode | null; max: number } {
  const { hubs } = assignToHubs(p, parentIndex(p));
  const root = hubs[0] ?? p.nodes[0] ?? null;
  const depth = new Map<string, number>();
  if (!root) return { depth, root: null, max: 0 };

  const adj = adjacency(p);
  depth.set(root.id, 0);
  const queue = [root.id];
  let max = 0;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const d = depth.get(id)! + 1;
    for (const next of adj.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, d);
      max = Math.max(max, d);
      queue.push(next);
    }
  }
  // The unreachable ring is `max + 1` even when nothing is unreachable — `max` below is the
  // outermost ring that actually HAS occupants, computed after the fill, so an empty ring is
  // never sized or drawn.
  const orphanRing = max + 1;
  let used = max;
  for (const n of p.nodes) {
    if (depth.has(n.id)) continue;
    depth.set(n.id, orphanRing);
    used = orphanRing;
  }
  return { depth, root, max: used };
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
 * Without clustering this is what it always was: one slot per node in a single shelf,
 * shorter bands centered against the longest. With it, every cluster claims as many slots
 * as its busiest band needs and keeps them in EVERY band, so a cluster occupies one
 * contiguous stripe and its members line up across bands; each band's members are centered
 * inside that stripe, the next stripe starts a gutter later, and the run of stripes WRAPS
 * onto a new shelf — a fresh set of bands below (or beside, in lanes mode) the last —
 * once it has claimed a shelf's worth of length.
 */
function packLanes(
  lanes: string[][],
  rankOf: Map<string, number> | null,
  step: number,
  gap: number,
  bandSpan: number,
  shelfGap: number,
  pad: number,
  horizontal: boolean,
): { pos: Map<string, number>; shelfOf: Map<string, number>; extent: number; shelves: number } {
  const pos = new Map<string, number>();
  const shelfOf = new Map<string, number>();
  if (!rankOf) {
    const widest = Math.max(1, ...lanes.map((l) => l.length));
    for (const lane of lanes) {
      const offset = ((widest - lane.length) * step) / 2;
      lane.forEach((id, i) => {
        pos.set(id, offset + i * step);
        shelfOf.set(id, 0);
      });
    }
    return { pos, shelfOf, extent: (widest - 1) * step, shelves: 1 };
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

  const ranks = [...slots.keys()].sort((a, b) => a - b);
  // Nothing to pack. Reachable whenever a filter set admits no nodes at all, which live
  // filtering hits often — and without this the wrap search below never runs, leaves
  // `best` null, and the whole request fails with a destructure error instead of an
  // empty graph.
  if (!ranks.length) return { pos, shelfOf, extent: 0, shelves: 1 };
  const runLength = ranks.reduce((acc, r) => acc + slots.get(r)! * step + gap, 0) - gap;

  // Wrap at every length a shelf could actually end at — a cluster is never split, so the
  // only meaningful targets are the cumulative lengths of the first m clusters — and keep
  // whichever the viewport can zoom in on furthest. Scoring by the zoom directly, rather
  // than by how square the canvas came out, is what picks the right wrap: "fit to view"
  // scales by whichever axis binds, so a canvas that is too LONG and one that is too DEEP
  // by the same ratio do not cost the same. Dividing the run by a shelf count would miss
  // the good wraps as well, since uneven clusters spill past the count aimed for and an
  // overflow shelf is paid for twice, in breadth gained and length left unused.
  let best: WrapPlan | null = null;
  let bestFit = 0;
  let cumulative = 0;
  for (let i = 0; i < ranks.length; i++) {
    cumulative += slots.get(ranks[i])! * step + (i ? gap : 0);
    const plan = wrapRun(ranks, slots, step, gap, cumulative);
    const along = plan.longest + pad;
    const across = (plan.shelves - 1) * (bandSpan + shelfGap) + bandSpan + pad;
    // Only the viewport's SHAPE matters here: scaling it scales every candidate alike.
    const fit = horizontal
      ? Math.min(VIEWPORT_ASPECT / along, 1 / across)
      : Math.min(VIEWPORT_ASPECT / across, 1 / along);
    if (fit > bestFit * (1 + 1e-9)) { // strict: ties keep the fewer, shorter shelves
      bestFit = fit;
      best = plan;
    }
  }
  const { start, shelfOfRank } = best!;
  const shelf = best!.shelves - 1;

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
        shelfOf.set(lane[k], shelfOfRank.get(r)!);
        extent = Math.max(extent, at);
      }
      i = j;
    }
  }
  return { pos, shelfOf, extent, shelves: shelf + 1 };
}

interface WrapPlan {
  start: Map<number, number>;      // cluster rank → offset along its shelf
  shelfOfRank: Map<number, number>;
  shelves: number;
  longest: number;                 // length of the longest shelf
}

/**
 * Greedy wrap of the cluster run at a target shelf length. Clusters are never split, so a
 * cluster longer than the target simply takes a shelf of its own; the caller decides which
 * target to keep by measuring what each one produces.
 */
function wrapRun(
  ranks: number[],
  slots: Map<number, number>,
  step: number,
  gap: number,
  target: number,
): WrapPlan {
  const start = new Map<number, number>();
  const shelfOfRank = new Map<number, number>();
  let shelf = 0;
  let cursor = 0;
  let longest = 0;
  for (const r of ranks) {
    const length = slots.get(r)! * step;
    if (cursor > 0 && cursor + length > target) {
      shelf++;
      cursor = 0;
    }
    shelfOfRank.set(r, shelf);
    start.set(r, cursor);
    cursor += length + gap;
    longest = Math.max(longest, cursor - gap);
  }
  return { start, shelfOfRank, shelves: shelf + 1, longest };
}

/**
 * GROUPING DECIDES THE OUTER STRUCTURE; THE MODE DECIDES THE INTERIOR.
 *
 * With no grouping the arrangement gets the whole canvas. With grouping it gets each box, and the
 * boxes are shelf-packed — so `mode` is never ignored, which is what makes the two controls
 * genuinely independent rather than one masking the other.
 */
export function layoutGraph(p: Projection, opts: LayoutOptions = {}): Layout {
  const laid = (opts.groupBy ?? []).length
    ? layoutGrouped(p, opts)
    : layoutWhole(p, opts, opts.mode ?? DEFAULT_LAYOUT);
  // Outlined AFTER placement, from the positions, so one implementation covers all five
  // arrangements and both halves of the dispatch above — see `clusterHulls`. The key is omitted
  // when there are none, the way `groups` and `altOf` are: an empty array in the payload reads as
  // a fact about the picture rather than as an absence.
  const clusters = clusterHulls(p, laid);
  return clusters.length ? { ...laid, clusters } : laid;
}

/** One arrangement over every node. The ungrouped half of the dispatch above. */
function layoutWhole(p: Projection, opts: LayoutOptions, mode: LayoutMode): Layout {
  if (mode === "radial") return layoutRadial(p, opts);
  if (mode === "organic") return layoutOrganic(p, opts);
  if (mode === "grid") return layoutGrid(p, opts);
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
  const bandGap = horizontal ? ROW_BAND_GAP : laneGap;
  // Which offset each band is drawn at. Normally its own index, so the six bands are a fixed
  // frame; compacted, its position among the bands that actually hold something.
  const occupied = lanes.map((lane, i) => (lane.length ? i : -1)).filter((i) => i >= 0);
  const slotOfBand = (i: number) => (opts.compactBands ? occupied.indexOf(i) : i);
  const bandCount = opts.compactBands ? Math.max(occupied.length, 1) : LANE_COUNT;
  const bandSpan = (bandCount - 1) * bandGap;
  const shelfPitch = bandSpan + (horizontal ? ROW_SHELF_GAP : LANE_SHELF_GAP);
  const { pos, shelfOf, extent, shelves } = packLanes(
    lanes, rankOf, step, rankOf ? gap : 0, bandSpan,
    horizontal ? ROW_SHELF_GAP : LANE_SHELF_GAP, margin * 2, horizontal,
  );

  // Emitted shelf by shelf, band by band: the reading order of the picture, and the order
  // arrow-key navigation walks a band in.
  const nodes: LayoutNode[] = [];
  for (let shelf = 0; shelf < shelves; shelf++) {
    lanes.forEach((lane, laneIdx) => {
      for (const id of lane) {
        if (shelfOf.get(id) !== shelf) continue;
        const along = margin + pos.get(id)!;
        const across = margin + shelf * shelfPitch + slotOfBand(laneIdx) * bandGap;
        nodes.push({
          id,
          lane: laneIdx,
          cluster: rankOf?.get(id),
          shelf: shelves > 1 ? shelf : undefined,
          x: horizontal ? along : across,
          y: horizontal ? across : along,
        });
      }
    });
  }

  const alongSize = margin * 2 + extent;
  const acrossSize = margin * 2 + (shelves - 1) * shelfPitch + bandSpan;
  return horizontal
    ? {
        nodes,
        width: alongSize,
        height: acrossSize,
        laneGap: ROW_BAND_GAP,
        rowGap: ROW_COL_STEP,
        mode: "rows",
      }
    : {
        nodes,
        width: acrossSize,
        height: alongSize,
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
    // REGISTER_GROUPS, not COMBO_GROUPS: the Other bucket is a real group the graph can
    // be grouped by, and it belongs at a declared position (last) rather than falling
    // through the unknown-key branch alongside genuinely unrecognised ids.
    if (groupBy === "combo") return REGISTER_GROUPS.findIndex((g) => g.id === key);
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
 *  top-left corner. Blocks are shelf-packed onto the canvas afterwards.
 *
 *  The shape composes, which is the whole trick behind nesting: a sub-block is just
 *  another BlockSpec, so a parent is built by packing its children with the same
 *  packer that puts parents on the canvas, then translating their cells up into the
 *  parent's own coordinates. `subs` remembers where each child landed. */
interface BlockSpec {
  key: string;
  label: string;
  width: number;
  height: number;
  cells: Array<{ id: string; x: number; y: number }>;
  subs?: Array<{
    key: string; label: string; count: number;
    x: number; y: number; width: number; height: number;
  }>;
}

/** Where one block landed on a shelf. */
interface Placement { spec: BlockSpec; x: number; y: number }

/**
 * Greedy first-fit shelf pack, left to right, wrapping at `wrapW`.
 *
 * Lifted out of layoutGrouped so a parent block can arrange its children with the
 * same algorithm that arranges parents on the canvas — one packer, two scales.
 * Blocks keep their incoming (canonical) order; a shelf is as tall as its tallest
 * member. `origin` is where the first shelf starts, which is the canvas margin at the
 * top level and the header + padding inset inside a parent.
 */
function packBlocks(specs: BlockSpec[], wrapW: number, origin: number): {
  at: Placement[]; width: number; height: number;
} {
  const at: Placement[] = [];
  let shelfX = origin;
  let shelfY = origin;
  let shelfH = 0;
  let maxX = 0;
  for (const spec of specs) {
    if (shelfX > origin && shelfX + spec.width > origin + wrapW) {
      shelfY += shelfH + BLOCK_GAP_Y;
      shelfX = origin;
      shelfH = 0;
    }
    at.push({ spec, x: shelfX, y: shelfY });
    shelfX += spec.width + BLOCK_GAP_X;
    shelfH = Math.max(shelfH, spec.height);
    maxX = Math.max(maxX, at[at.length - 1].x + spec.width);
  }
  return { at, width: maxX, height: shelfY + shelfH };
}

/** The wrap width that keeps a pack roughly screen-shaped rather than one tall column. */
function shelfWidth(specs: BlockSpec[], floor: number): number {
  const area = specs.reduce(
    (acc, s) => acc + (s.width + BLOCK_GAP_X) * (s.height + BLOCK_GAP_Y),
    0,
  );
  return Math.max(floor, Math.ceil(Math.sqrt(area * 1.8)));
}

/**
 * A block whose interior is other blocks — the second grouping level.
 *
 * Its own header sits above the children's, so the sub-labels never collide with the
 * parent's: the children are packed from `HEADER_H + GROUP_PAD` down, and each child
 * carries its own HEADER_H from gridBlock.
 */
function nestBlock(key: string, label: string, children: BlockSpec[]): BlockSpec {
  const inset = HEADER_H + GROUP_PAD;
  // A smaller floor than the canvas uses: a parent that wrapped at 1600px would be
  // wider than most screens before the outer pack even started.
  const packed = packBlocks(children, shelfWidth(children, 900), inset);
  const cells: BlockSpec["cells"] = [];
  const subs: NonNullable<BlockSpec["subs"]> = [];
  for (const place of packed.at) {
    for (const c of place.spec.cells) {
      cells.push({ id: c.id, x: place.x + c.x, y: place.y + c.y });
    }
    subs.push({
      key: place.spec.key, label: place.spec.label, count: place.spec.cells.length,
      x: place.x, y: place.y, width: place.spec.width, height: place.spec.height,
    });
  }
  return {
    key, label, cells, subs,
    width: packed.width + GROUP_PAD,
    height: packed.height + GROUP_PAD,
  };
}

/**
 * The sub-graph a group holds: its nodes, the edges among them, and the summaries it carries.
 *
 * Grouping runs an arrangement on this rather than reimplementing it per group — so "organic
 * grouped by cloud" is the organic engine, once per cloud, and there stays exactly one organic.
 * Edges to nodes OUTSIDE the group are dropped, which is the point: what pulls a box's members
 * together is what connects them to each other, and a spring to a node three boxes away would
 * drag the whole block off its packed position.
 */
function subProjection(p: Projection, list: GNode[]): Projection {
  const ids = new Set(list.map((n) => n.id));
  return {
    nodes: list,
    edges: p.edges.filter((e) => ids.has(e.src) && ids.has(e.dst)),
    summaries: p.summaries.filter((s) => ids.has(s.id)),
    counts: p.counts,
  };
}

/**
 * A whole-canvas layout, framed as a block: shift its node centres so the tightest box around
 * them starts after the header and the padding, and report the size that box needs.
 *
 * Measured rather than taken from `layout.width`/`height` — an engine sizes its canvas for a
 * viewport and can leave slack, and slack inside a labelled box reads as an empty region of the
 * group rather than as margin.
 */
function blockOf(key: string, label: string, layout: Layout): BlockSpec {
  const pts = layout.nodes;
  const minX = Math.min(...pts.map((n) => n.x));
  const minY = Math.min(...pts.map((n) => n.y));
  const maxX = Math.max(...pts.map((n) => n.x));
  const maxY = Math.max(...pts.map((n) => n.y));
  const originX = GROUP_PAD + CELL_W / 2;
  const originY = HEADER_H + GROUP_PAD + CELL_H / 2;
  return {
    key,
    label,
    width: GROUP_PAD * 2 + CELL_W + (maxX - minX),
    height: HEADER_H + GROUP_PAD * 2 + CELL_H + (maxY - minY),
    cells: pts.map((n) => ({
      id: n.id,
      x: round2(originX + n.x - minX),
      y: round2(originY + n.y - minY),
    })),
  };
}

/**
 * One group's interior, in whichever arrangement is in force.
 *
 * `grid` is already block-shaped, so it is used directly. `radial` uses HUB-AND-SPOKE rather than
 * the whole-canvas engine's BFS rings, and the asymmetry is deliberate: an estate is one
 * component with real hop structure to show, while a group of six is usually all one hop out —
 * which BFS would draw as a single enormous ring where rank rings nest tightly. Both are rings
 * around the most important node, which is what Radial promises.
 *
 * The rest run their own engine over `subProjection`, with `compactBands` on so a box holding two
 * categories is two bands tall rather than six.
 */
function blockFor(
  mode: LayoutMode,
  key: string,
  label: string,
  list: GNode[],
  p: Projection,
  opts: LayoutOptions,
  hub?: GNode,
): BlockSpec {
  if (!list.length || mode === "grid") return gridBlock(key, label, list);
  if (mode === "radial") {
    // The CENTRE is named by the caller where the grouping already knows it — under "asset" the
    // box IS an agent's neighbourhood, and letting the sort pick would put a CRITICAL issue at
    // the middle of a block labelled with the agent's name. Elsewhere the group has no
    // distinguished member, so the worst one takes the centre.
    const centre = hub ?? list[0];
    return radialBlock(key, label, centre, list.filter((n) => n.id !== centre.id));
  }
  const sub = subProjection(p, list);
  const inner: LayoutOptions = { ...opts, margin: 0, groupBy: [], compactBands: true };
  return blockOf(key, label, layoutWhole(sub, inner, mode));
}

/**
 * Compact row-major grid — the default block interior.
 *
 * `columns` overrides the count for a caller that knows better. The default caps at 4, which suits
 * a group's interior: a box is one item in a shelf-packed row, and a wide one pushes every box
 * after it down. `layoutGrid` fills a whole canvas instead and passes its own.
 */
function gridBlock(key: string, label: string, list: GNode[], columns?: number): BlockSpec {
  const cols = columns ?? Math.min(4, Math.max(1, Math.ceil(Math.sqrt(list.length))));
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

  const adj = adjacency(p);

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
  const levels = opts.groupBy ?? [];
  const groupBy = levels[0];
  // Two ways a second level is not one. "asset" has no key of its OWN to be subdivided by —
  // `ownGroupKey` answers GROUP_NONE for it, so as an inner level it would file everything under
  // one "Ungrouped" box. And a dimension nested in itself yields one child identical to its
  // parent, a box drawn twice. The resolver rejects both; this guard makes the engine total, so
  // a direct caller cannot produce a picture that lies.
  //
  // Note what is NO LONGER a reason: "asset" used to be called an arrangement rather than a
  // partition, because it also dictated hub-and-spoke interiors. It always was a partition —
  // `assignToHubs` gives every node exactly one hub — and the interior is now the layout's job,
  // so the only objection left is the missing key.
  const second = levels[1] ?? null;
  const inner: GroupKey | null =
    groupBy === "asset" || second === "asset" || second === groupBy ? null : second;
  const sort = opts.sort ?? "smart";
  const mode = opts.mode ?? DEFAULT_LAYOUT;

  const parentOf = parentIndex(p);
  // Box interiors take the same order the ungrouped arrangements take, so a component inside a box
  // is contiguous and can be outlined — under the smart order only, for the reason `memberOrder`
  // gives. This is why a grouped picture shows cluster outlines at all.
  const cmp = memberOrder(p, sort);
  const block = (key: string, label: string, list: GNode[], hub?: GNode) =>
    blockFor(mode, key, label, [...list].sort(cmp), p, opts, hub);

  // One block spec per top-level group, in canonical group order — and when a second level is
  // asked for, each bucket is re-bucketed and becomes a block of blocks. What goes INSIDE each
  // block is `mode`'s business, not this function's.
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
    for (const hub of hubs) specs.push(block(hub.id, hub.name, members.get(hub.id)!, hub));
    if (strays.length) specs.push(block(GROUP_NONE, "Ungrouped", strays));
  } else {
    const members = new Map<string, GNode[]>();
    for (const node of p.nodes) {
      const key = groupKeyOf(node, groupBy, parentOf);
      if (!members.has(key)) members.set(key, []);
      members.get(key)!.push(node);
    }
    for (const key of orderGroups([...members.keys()], groupBy, members)) {
      const list = members.get(key)!;
      const label = groupLabel(key, groupBy);
      if (!inner) {
        specs.push(block(key, label, list));
        continue;
      }
      // Same bucketing and same canonical ordering, one level down. A node still lands
      // in exactly one leaf — the partition stays hard, so counts still conserve.
      const subs = new Map<string, GNode[]>();
      for (const node of list) {
        const k2 = groupKeyOf(node, inner, parentOf);
        if (!subs.has(k2)) subs.set(k2, []);
        subs.get(k2)!.push(node);
      }
      const children = orderGroups([...subs.keys()], inner, subs).map((k2) =>
        block(k2, groupLabel(k2, inner), subs.get(k2)!));
      specs.push(nestBlock(key, label, children));
    }
  }

  // Shelf-pack the blocks left-to-right. The wrap width adapts to the total
  // block area so the canvas stays roughly screen-shaped (16:9-ish) instead of
  // degenerating into one tall column when blocks are large (asset hubs).
  const packed = packBlocks(specs, shelfWidth(specs, MAX_SHELF_W), margin);

  const nodes: LayoutNode[] = [];
  const groups: LayoutGroup[] = [];

  for (const { spec, x: gx, y: gy } of packed.at) {
    const parentIdx = groups.length;
    groups.push({
      id: `${groupBy}:${spec.key}`,
      key: spec.key,
      label: spec.label,
      x: gx,
      y: gy,
      width: spec.width,
      height: spec.height,
      count: spec.cells.length,
      by: groupBy,
      depth: 0,
    });
    // Children right after their parent, so `parent` points backwards and a client
    // drawing the array in order paints every hull behind the ones nested in it.
    for (const sub of spec.subs ?? []) {
      groups.push({
        id: `${groupBy}:${spec.key}/${inner}:${sub.key}`,
        key: sub.key,
        label: sub.label,
        x: gx + sub.x,
        y: gy + sub.y,
        width: sub.width,
        height: sub.height,
        count: sub.count,
        by: inner!,
        depth: 1,
        parent: parentIdx,
      });
    }
    // `lane` is the group that IMMEDIATELY holds the node — the leaf. Arrow keys walk
    // the innermost cluster, and `groups[n.lane]` stays the box that contains it.
    for (const c of spec.cells) {
      const px = gx + c.x;
      const py = gy + c.y;
      let lane = parentIdx;
      for (let i = 0; i < (spec.subs?.length ?? 0); i++) {
        const sub = spec.subs![i];
        if (c.x >= sub.x && c.x <= sub.x + sub.width
          && c.y >= sub.y && c.y <= sub.y + sub.height) {
          lane = parentIdx + 1 + i;
          break;
        }
      }
      nodes.push({ id: c.id, lane, x: px, y: py });
    }
  }

  return {
    nodes,
    width: packed.width + margin,
    height: packed.height + margin,
    laneGap: CELL_W,
    rowGap: CELL_H,
    // The ARRANGEMENT, which is what `mode` means everywhere now — a grouped layout used to
    // report "grouped" and swallow the arrangement with it. `groups` being present is what says
    // this picture is grouped, and the renderer reads it that way.
    mode,
    groups,
  };
}

/**
 * Every node in one compact grid, categories ignored — the densest of the five.
 *
 * This is `gridBlock` over the whole projection, which is exactly the interior every grouped
 * picture had before grouping and arrangement came apart. So `grid` + a grouping reproduces the
 * old "grouped" layout byte for byte, and `grid` alone is the one new picture the split adds.
 */
function layoutGrid(p: Projection, opts: LayoutOptions): Layout {
  const margin = opts.margin ?? 120;
  // Component-first, for the reason `layoutRadial` gives: a dense grid interleaving two components
  // cell by cell has no outline that could be drawn without claiming the other's nodes.
  const cmp = memberOrder(p, opts.sort ?? "smart");
  // ITS OWN COLUMN COUNT, not gridBlock's. That helper caps at 4 columns, which is right for the
  // small interior of a group box and wrong for a whole canvas: 120 nodes came out as a 4×30
  // ribbon, the shape this file's header complains about for unwrapped lanes — "a ribbon thousands
  // of pixels long and a few hundred deep, which fit to view can only show by shrinking every card
  // past reading". Solving cols²·CELL_W / (n·CELL_H) = VIEWPORT_ASPECT gives a canvas roughly the
  // shape of the window, and it also lays a component's run across fewer, wider rows — which is
  // what lets its outline survive the membership guard.
  const cols = Math.max(1, Math.round(Math.sqrt((VIEWPORT_ASPECT * CELL_H * p.nodes.length) / CELL_W)));
  const spec = gridBlock("", "", [...p.nodes].sort(cmp), cols);
  // The grid's rows ARE its lane axis — read off the distinct y values rather than recomputing
  // the column count, so this cannot disagree with where gridBlock actually put the cells. Two
  // of the four arrow keys walk `lane`, and a layout answering 0 for every node would leave them
  // stepping through the whole grid one cell at a time.
  const rows = [...new Set(spec.cells.map((c) => c.y))].sort((a, b) => a - b);
  return {
    nodes: spec.cells.map((c) => ({
      id: c.id,
      // No header to clear and no box to sit inside: the block's own header offset is subtracted
      // back off so the grid starts at the margin like every other ungrouped layout.
      x: round2(margin + c.x - GROUP_PAD),
      y: round2(margin + c.y - GROUP_PAD - HEADER_H),
      lane: rows.indexOf(c.y),
    })),
    width: round2(margin * 2 + spec.width - GROUP_PAD * 2),
    height: round2(margin * 2 + spec.height - GROUP_PAD * 2 - HEADER_H),
    laneGap: CELL_W,
    rowGap: CELL_H,
    mode: "grid",
  };
}

// ------------------------------------------------------------ radial / organic

// Card footprint plus the gutter a reader needs between two of them. The renderer draws
// 196×56 (graphNode.js NODE_W/NODE_H); these are what the two free-form layouts keep every
// pair at least, and they are deliberately the grouped-mode cell size — one number for
// "how much room does a card want", not a second opinion about it.
const FREE_W = CELL_W;
const FREE_H = CELL_H;
// The narrowest a ring may sit inside the one before it.
//
// Two cards overlap only when |dx| < 196 AND |dy| < 56, which together put them closer than
// sqrt(196² + 56²) ≈ 204 — so any pair at least that far apart is clear whatever direction it
// lies in. Two points on concentric circles are never closer than the radial gap, so a step past
// 204 makes cross-ring overlap impossible; 220 takes it with a gutter. This floor only binds on
// sparse rings, since a busy ring is pushed further out by its own occupancy anyway.
const RING_STEP = 220;
// Repulsion is all-pairs, so one organic pass costs n². Iterations are traded against that so
// the 400-node ceiling (MAX_NODES_CEILING) costs about what the 100-node default does; the
// clamp keeps a tiny graph from being iterated pointlessly and a huge one from being iterated
// too few times to settle at all.
const FR_PAIR_BUDGET = 6000;
const FR_MIN_STEPS = 30;
const FR_MAX_STEPS = 120;
// How hard the centre pulls, relative to a spring. Fruchterman–Reingold says nothing about
// disconnected nodes, so without this term they are pushed outward by repulsion alone and never
// pulled back — a handful of orphans would fly to the far corners and take the canvas bounds,
// and therefore the zoom, with them.
const FR_GRAVITY = 0.06;
// How hard a node is pulled toward its OWN component's centre of mass.
//
// Fruchterman–Reingold holds a component together only through its edges, so a long chain stretches
// and two components with no edge between them interpenetrate at the rim — pushed apart by
// repulsion, pulled back together by the gravity above, with nothing distinguishing "my cluster"
// from "the canvas". This term is what makes the clusters organic mode promises actually emerge as
// separable blobs; it is also what lets each one be outlined (see `clusterHulls`).
const FR_COHESION = 0.1;
// Overlap resolution after the forces settle. FR gives no non-overlap guarantee at all — it
// treats nodes as points — so these passes are what actually hold the invariant every layout in
// this file is tested for. Each pass separates along the axis of LEAST overlap, which moves a
// pair the shortest distance that frees it.
const SEPARATE_PASSES = 24;

/**
 * Ring `d` holds every node `d` hops from the estate's worst-risk agent.
 *
 * THE RADIUS COMES FROM THE OCCUPANCY, and that is the whole design. A ring of 30 nodes at a
 * constant radius overlaps; a constant radius large enough for 30 leaves a ring of 3 floating in
 * the middle of nowhere. Sizing each ring to exactly what it holds makes the layout overlap-free
 * for any graph with no cap on ring size, which is what lets this run on the whole 400-node
 * ceiling rather than on a hand-tuned sample.
 *
 * The spacing constraint is on the CHORD between neighbours, not the arc: `2r·sin(π/n) ≥ FREE_W`.
 * Arc length is the tempting formula and it is wrong — the two agree only for large n, and on a
 * ring of two the arc is π/2 times the gap that actually exists, which is how a ring that
 * measured as spaced still drew one card over another.
 *
 * Nodes are placed in `sort` order, clockwise from 12 o'clock — the same convention
 * `radialBlock` uses for the hub-and-spoke groups, so the two radial pictures in this product
 * read the same way round.
 */
function layoutRadial(p: Projection, opts: LayoutOptions): Layout {
  const margin = opts.margin ?? 120;
  // Component-first WITHIN a ring under the smart order, so one component takes a contiguous arc
  // rather than being scattered around it — which is what lets its outline come out tight enough
  // to be drawn at all (see `clusterHulls`). Inside a component the order is the usual one.
  const cmp = memberOrder(p, opts.sort ?? "smart");
  const { depth, max } = hopDepth(p);

  const rings: GNode[][] = Array.from({ length: max + 1 }, () => []);
  for (const node of p.nodes) rings[depth.get(node.id) ?? 0].push(node);
  for (const ring of rings) ring.sort(cmp);

  /** The smallest radius on which `n` cards fit side by side, by chord. One node needs none. */
  const fits = (count: number) => (count < 2 ? 0 : FREE_W / (2 * Math.sin(Math.PI / count)));

  // Radii first, so the canvas can be sized before anything is placed.
  const radii: number[] = [];
  let prev = 0;
  for (let d = 0; d < rings.length; d++) {
    if (d === 0) {
      // Ring 0 is the root alone unless the projection has no edges at all, in which case
      // everything is an orphan out on the last ring and this one is empty.
      prev = fits(rings[0].length);
      radii.push(round2(prev));
      continue;
    }
    prev = Math.max(prev + RING_STEP, fits(rings[d].length));
    radii.push(round2(prev));
  }

  const outer = radii[radii.length - 1] ?? 0;
  const half = outer + FREE_W / 2;
  const cx = round2(margin + half);
  const cy = round2(margin + outer + FREE_H / 2);

  const nodes: LayoutNode[] = [];
  rings.forEach((ring, d) => {
    if (!ring.length) return;
    if (d === 0 && ring.length === 1) {
      nodes.push({ id: ring[0].id, x: cx, y: cy, lane: 0 });
      return;
    }
    const r = radii[d];
    const step = (Math.PI * 2) / ring.length;
    ring.forEach((node, k) => {
      const a = -Math.PI / 2 + k * step;
      nodes.push({
        id: node.id,
        x: round2(cx + r * Math.cos(a)),
        y: round2(cy + r * Math.sin(a)),
        lane: d,
      });
    });
  });

  return {
    nodes,
    width: round2(cx + half + margin),
    height: round2(cy + outer + FREE_H / 2 + margin),
    // Reported for the renderer's edge routing and keyboard steps, not used for placement here.
    laneGap: RING_STEP,
    rowGap: FREE_H,
    mode: "radial",
  };
}

/**
 * Force-directed, and reproducible.
 *
 * Fruchterman–Reingold: every pair repels by `k²/d`, every edge pulls by `d²/k`, and a
 * temperature caps how far a node may travel per step, cooling linearly to nothing so the
 * picture settles instead of oscillating. Two departures from the paper, both because a security
 * projection is not the connected graph FR assumes:
 *
 * - THE SEED IS THE RADIAL LAYOUT, not random placement. That is what makes this deterministic
 *   — the property the file header trades on — and it also starts the solver from a picture that
 *   already encodes hop distance, so the forces refine real structure rather than untangling an
 *   arbitrary one.
 * - GRAVITY toward the centre. FR pushes disconnected nodes apart forever; this product's views
 *   routinely carry a few orphans, and without a restoring term they leave for the corners and
 *   drag the canvas bounds — and the fit-to-view zoom — out with them.
 *
 * Then `separate` resolves the overlaps FR cannot see, since it models nodes as points.
 */
function layoutOrganic(p: Projection, opts: LayoutOptions): Layout {
  const margin = opts.margin ?? 120;
  const n = p.nodes.length;
  const seed = layoutRadial(p, { ...opts, margin: 0 });
  const component = componentRoots(p);
  const at = new Map(seed.nodes.map((s) => [s.id, { x: s.x, y: s.y }]));
  const lane = new Map(seed.nodes.map((s) => [s.id, s.lane]));
  const ids = p.nodes.map((node) => node.id).filter((id) => at.has(id));

  if (ids.length > 1) {
    const area = Math.max(seed.width, 1) * Math.max(seed.height, 1);
    const k = Math.sqrt(area / ids.length);
    const cx = seed.width / 2;
    const cy = seed.height / 2;
    const steps = Math.min(FR_MAX_STEPS, Math.max(FR_MIN_STEPS, Math.round(FR_PAIR_BUDGET / n)));
    const disp = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    // Edges as index pairs once, rather than re-resolving ids inside the hot loop.
    const springs = p.edges
      .filter((e) => at.has(e.src) && at.has(e.dst) && e.src !== e.dst)
      .map((e) => [e.src, e.dst] as const);

    for (let step = 0; step < steps; step++) {
      // Temperature starts at a tenth of the ideal separation: the seed is already a sensible
      // picture, so the first step should refine it rather than throw every node across the
      // canvas the way a cold-start FR run has to.
      const temp = (k / 10) * (1 - step / steps);
      for (const d of disp.values()) { d.x = 0; d.y = 0; }

      for (let i = 0; i < ids.length; i++) {
        const a = at.get(ids[i])!;
        const da = disp.get(ids[i])!;
        for (let j = i + 1; j < ids.length; j++) {
          const b = at.get(ids[j])!;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.01) {
            // Coincident nodes have no direction to be pushed along. Nudging by INDEX rather
            // than at random keeps the tie-break deterministic, which is the whole contract.
            dx = (i - j) || 1;
            dy = 1;
            dist = Math.sqrt(dx * dx + dy * dy);
          }
          const force = (k * k) / dist;
          const ux = (dx / dist) * force;
          const uy = (dy / dist) * force;
          da.x += ux;
          da.y += uy;
          const db = disp.get(ids[j])!;
          db.x -= ux;
          db.y -= uy;
        }
      }

      for (const [src, dst] of springs) {
        const a = at.get(src)!;
        const b = at.get(dst)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const force = (dist * dist) / k;
        const ux = (dx / dist) * force;
        const uy = (dy / dist) * force;
        disp.get(src)!.x -= ux;
        disp.get(src)!.y -= uy;
        disp.get(dst)!.x += ux;
        disp.get(dst)!.y += uy;
      }

      // Component centres of mass, recomputed each step: cohesion has to chase the cluster as it
      // moves, or it pulls every node toward where the cluster used to be.
      const hub = new Map<string, { x: number; y: number; n: number }>();
      for (const id of ids) {
        const key = component.get(id)!;
        const acc = hub.get(key) ?? { x: 0, y: 0, n: 0 };
        const a = at.get(id)!;
        acc.x += a.x;
        acc.y += a.y;
        acc.n += 1;
        hub.set(key, acc);
      }
      for (const id of ids) {
        const a = at.get(id)!;
        const d = disp.get(id)!;
        const own = hub.get(component.get(id)!)!;
        d.x += (own.x / own.n - a.x) * FR_COHESION * k;
        d.y += (own.y / own.n - a.y) * FR_COHESION * k;
        // The whole cloud still answers to the middle, which is what keeps a component with no
        // edges at all — cohesive with itself, repelled by everything — on the canvas.
        d.x += (cx - a.x) * FR_GRAVITY * k;
        d.y += (cy - a.y) * FR_GRAVITY * k;
        const len = Math.sqrt(d.x * d.x + d.y * d.y);
        if (len < 0.01) continue;
        const travel = Math.min(len, temp);
        a.x += (d.x / len) * travel;
        a.y += (d.y / len) * travel;
      }
    }
  }

  separate(ids, at);

  // Translate the settled cloud so its top-left card edge sits exactly at the margin. Bounds are
  // measured rather than predicted: the forces decide the extent, so anything computed up front
  // would be a guess that clips.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const a = at.get(id)!;
    minX = Math.min(minX, a.x);
    minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x);
    maxY = Math.max(maxY, a.y);
  }
  if (!ids.length) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  const offX = margin + FREE_W / 2 - minX;
  const offY = margin + FREE_H / 2 - minY;

  return {
    nodes: ids.map((id) => ({
      id,
      x: round2(at.get(id)!.x + offX),
      y: round2(at.get(id)!.y + offY),
      lane: lane.get(id) ?? 0,
    })),
    width: round2(maxX - minX + FREE_W + margin * 2),
    height: round2(maxY - minY + FREE_H + margin * 2),
    laneGap: RING_STEP,
    rowGap: FREE_H,
    mode: "organic",
  };
}

/**
 * Push apart every pair whose cards intersect, along the axis of least overlap.
 *
 * Iterated because separating one pair can push a node into a third; bounded because a
 * pathological graph must not spin here, and `SEPARATE_PASSES` is generous enough that the loop
 * exits early on anything real. Pairs are visited in `ids` order and moved symmetrically, so the
 * result depends only on the input order — no randomness, no `Date`, nothing to make two runs
 * differ.
 */
function separate(ids: string[], at: Map<string, { x: number; y: number }>): void {
  for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      const a = at.get(ids[i])!;
      for (let j = i + 1; j < ids.length; j++) {
        const b = at.get(ids[j])!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = FREE_W - Math.abs(dx);
        const overlapY = FREE_H - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        // Least-overlap axis: separating along the other one would move the pair further than
        // it has to. `|| 1` covers exactly coincident cards, which have no side to be on.
        if (overlapX / FREE_W < overlapY / FREE_H) {
          const push = (overlapX / 2) * (dx < 0 ? -1 : 1);
          a.x -= push;
          b.x += push;
        } else {
          const push = (overlapY / 2) * (dy < 0 ? -1 : 1);
          a.y -= push;
          b.y += push;
        }
      }
    }
    if (!moved) return;
  }
}

// ------------------------------------------------------------- cluster outlines

// How far the outline stands off a card. Room enough to read as a boundary rather than as a
// border on the card itself, and well inside the tightest step between two cards (the grid's
// 240 and rows' 150 band gap), so padding never pushes a hull over a neighbour's centre.
const CLUSTER_PAD = 12;

/**
 * A convex outline per connected component, per box — or nothing, wherever nothing would be true.
 *
 * COMPUTED FROM THE PLACED NODES, once, for every arrangement. By the time this runs, rows,
 * columns, grid, organic and radial have all answered in the same currency — positions — so
 * outlining is one implementation rather than five, and it works identically whether the picture
 * is grouped or not.
 *
 * The research this follows (an ~800-subject evaluation of group overlays on node-link diagrams)
 * found hulls are the best encoding for "which group is this in" AND that any such overlay costs
 * about a quarter of the accuracy on tasks that mean following a path. Following a path is what
 * this product is for, so every rule below is about drawing FEWER outlines: the client paints them
 * under the edges, and this function refuses to emit one that would not earn its ink.
 */
function clusterHulls(p: Projection, laid: Layout): LayoutCluster[] {
  if (laid.nodes.length < 2) return [];
  const roots = componentRoots(p);
  const boxes = laid.groups ?? [];
  // The boxes a node can actually sit in: the innermost level, since a nested picture puts every
  // node in a depth-1 box and a hull belongs to the box that holds it.
  const nested = boxes.some((g) => g.depth === 1);
  const leaves = boxes
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => (nested ? g.depth === 1 : g.depth === 0));
  const boxOf = (n: LayoutNode): number => {
    for (const { g, i } of leaves) {
      if (n.x >= g.x && n.x <= g.x + g.width && n.y >= g.y && n.y <= g.y + g.height) return i;
    }
    return -1;
  };

  // Bucketed by component AND by box. The pair is load-bearing: grouping partitions by a
  // property, so one component's nodes can land in several boxes, and a single hull spanning two
  // of them would draw a shape that is inside neither.
  const buckets = new Map<string, { members: LayoutNode[]; group: number }>();
  const perBox = new Map<number, number>();
  for (const n of laid.nodes) {
    const group = boxOf(n);
    const key = (roots.get(n.id) ?? n.id) + "|" + group;
    if (!buckets.has(key)) buckets.set(key, { members: [], group });
    buckets.get(key)!.members.push(n);
    perBox.set(group, (perBox.get(group) ?? 0) + 1);
  }

  const out: LayoutCluster[] = [];
  // Biggest first, then by key. Two outlines can hold only their own nodes and still CROSS in the
  // empty space between them, and a pair of crossing boundaries is the opposite of the distinction
  // they exist to draw — so an outline is refused if it overlaps one already accepted, and the
  // bigger cluster wins the ground. Size-then-key rather than insertion order, so which one gives
  // way is a fact about the graph.
  const candidates = [...buckets.keys()].sort((a, b) =>
    buckets.get(b)!.members.length - buckets.get(a)!.members.length || (a < b ? -1 : 1));
  for (const key of candidates) {
    const { members, group } = buckets.get(key)!;
    // A hull around one card says nothing that the card does not already say.
    if (members.length < 2) continue;
    // Nor does a hull around everything in its box: if there is only one component here, there is
    // nothing to tell it apart from.
    if (members.length === (perBox.get(group) ?? 0)) continue;

    const hull = convexHull(members.flatMap((n) => ([
      [n.x - NODE_HALF_W, n.y - NODE_HALF_H],
      [n.x + NODE_HALF_W, n.y - NODE_HALF_H],
      [n.x + NODE_HALF_W, n.y + NODE_HALF_H],
      [n.x - NODE_HALF_W, n.y + NODE_HALF_H],
    ] as Array<[number, number]>)));
    if (hull.length < 3) continue;

    // THE RULE THAT KEEPS AN OUTLINE HONEST. A convex hull over scattered members can enclose a
    // node that is not one of them — an arrangement that interleaves components, or one wide
    // outlier stretching the hull across a neighbour. Such an outline claims a node it does not
    // hold, so it is dropped rather than drawn: an interleaved picture degrades to silence.
    //
    // Only same-box outsiders need testing. Boxes at one level never overlap, so a hull built
    // from points inside one box cannot reach into another.
    const mine = new Set(members.map((n) => n.id));
    const claimsAnother = laid.nodes.some((n) =>
      !mine.has(n.id) && boxOf(n) === group && inPolygon(n.x, n.y, hull));
    if (claimsAnother) continue;
    if (out.some((c) => !convexDisjoint(hull, c.points))) continue;

    out.push({
      points: hull.map(([x, y]) => [round2(x), round2(y)] as [number, number]),
      count: members.length,
      ...(group === -1 ? {} : { group }),
    });
  }
  // Emitted biggest-first above; re-sorted so the payload reads in the picture's own order and two
  // runs cannot differ by which cluster happened to be measured first.
  return out.sort((a, b) => a.points[0][0] - b.points[0][0] || a.points[0][1] - b.points[0][1]);
}

/**
 * Are two CONVEX polygons disjoint? Separating-axis test — exact, since every hull here is convex
 * by construction, and cheaper than clipping.
 *
 * Vertex-in-polygon alone would miss the case that matters most: two long thin hulls crossing like
 * an X, where neither has a vertex inside the other.
 */
function convexDisjoint(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      // The edge normal, as the axis to project both shapes onto.
      const nx = -(y2 - y1);
      const ny = x2 - x1;
      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const [x, y] of a) {
        const d = x * nx + y * ny;
        aMin = Math.min(aMin, d);
        aMax = Math.max(aMax, d);
      }
      for (const [x, y] of b) {
        const d = x * nx + y * ny;
        bMin = Math.min(bMin, d);
        bMax = Math.max(bMax, d);
      }
      // A gap on any one axis is proof of separation; touching exactly is not overlapping.
      if (aMax <= bMin || bMax <= aMin) return true;
    }
  }
  return false;
}

// The node card the renderer draws (graphNode.js NODE_W/NODE_H), plus the standoff — the hull is
// built from card CORNERS rather than centres, so the outline clears the cards instead of running
// through them.
const NODE_HALF_W = 196 / 2 + CLUSTER_PAD;
const NODE_HALF_H = 56 / 2 + CLUSTER_PAD;

/**
 * Convex hull by monotone chain — sort by x then y, sweep the lower and upper hulls.
 *
 * O(n log n), no floating-point tolerance anywhere, and deterministic for a given point list,
 * which is the property this whole file is built on. Collinear points are dropped (`<= 0`), so the
 * result is the minimal polygon rather than one carrying redundant vertices along a straight edge —
 * a grid of cards produces a great many of those.
 */
function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Array<[number, number]>): Array<[number, number]> => {
    const chain: Array<[number, number]> = [];
    for (const pt of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], pt) <= 0) {
        chain.pop();
      }
      chain.push(pt);
    }
    return chain;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  // Each chain repeats the other's endpoints, so both give up their last point.
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Ray casting — is the point strictly inside the polygon? Used only by the membership guard. */
function inPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The member order for an arrangement: component-first under the smart order, the reader's chosen
 * sequence otherwise.
 *
 * SMART ONLY, and `layoutLanes` states the rule this follows: "clustering the smart order, and only
 * the smart order: an explicit sort is a request for one global sequence, which gutters cut
 * through." A box whose control says "Name (A–Z)" has to read alphabetically; grouping components
 * first while claiming alphabetical order would be exactly the kind of quiet lie a cluster
 * outline is supposed to prevent. So an explicit sort keeps its sequence and simply gets fewer
 * outlines — components interleave, and `clusterHulls`' membership guard drops what it cannot
 * draw honestly.
 */
function memberOrder(p: Projection, sort: SortKey): (a: GNode, b: GNode) => number {
  const cmp = comparator(sort);
  return sort === "smart" ? byComponent(p, cmp) : cmp;
}

/**
 * A comparator that keeps one component's nodes together, then falls back to `cmp`.
 *
 * Contiguity is what lets a component's outline come out tight enough to pass the membership
 * guard above — scattered members produce a hull that reaches across its neighbours and is
 * dropped. Components lead in the order of their best member, so the worst risk still opens the
 * picture.
 */
function byComponent(p: Projection, cmp: (a: GNode, b: GNode) => number): (a: GNode, b: GNode) => number {
  const roots = componentRoots(p);
  const rank = new Map<string, number>();
  [...p.nodes].sort(cmp).forEach((n) => {
    const root = roots.get(n.id) ?? n.id;
    if (!rank.has(root)) rank.set(root, rank.size);
  });
  const of = (n: GNode) => rank.get(roots.get(n.id) ?? n.id) ?? rank.size;
  return (a, b) => of(a) - of(b) || cmp(a, b);
}
