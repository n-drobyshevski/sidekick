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
  /** Lane index in "lanes" mode; group index in "grouped" mode (keyboard nav
   *  walks this axis either way). */
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
  /** One or two dimensions. Two nests the second inside the first. Empty means the
   *  default single "combo" level. */
  groupBy?: GroupKey[];
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
  const bandGap = horizontal ? ROW_BAND_GAP : laneGap;
  const bandSpan = (LANE_COUNT - 1) * bandGap;
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
        const across = margin + shelf * shelfPitch + laneIdx * bandGap;
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
  const levels = (opts.groupBy ?? []).length ? opts.groupBy! : (["combo"] as GroupKey[]);
  const groupBy = levels[0];
  // Three ways a second level is not one. "asset" is an ARRANGEMENT (hub-and-spoke BFS)
  // rather than a partition by a property: there is nothing coherent to subdivide inside
  // it, AND it has no key of its own to subdivide by — `ownGroupKey` answers GROUP_NONE
  // for it, so as an inner level it would file everything under one "Ungrouped" box. And
  // a dimension nested in itself yields one child identical to its parent, a box drawn
  // twice. The resolver rejects all three — this guard makes the engine total, so a
  // direct caller cannot produce a picture that lies.
  const second = levels[1] ?? null;
  const inner: GroupKey | null =
    groupBy === "asset" || second === "asset" || second === groupBy ? null : second;
  const sort = opts.sort ?? "smart";

  const parentOf = parentIndex(p);
  const cmp = comparator(sort);

  // Build one block spec per top-level group. "asset" is hub-and-spoke; everything else
  // buckets by key into grids, in canonical group order — and when a second level is
  // asked for, each bucket is re-bucketed and becomes a block of blocks.
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
      const list = members.get(key)!;
      const label = groupLabel(key, groupBy);
      if (!inner) {
        specs.push(gridBlock(key, label, [...list].sort(cmp)));
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
        gridBlock(k2, groupLabel(k2, inner), [...subs.get(k2)!].sort(cmp)));
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
    mode: "grouped",
    groups,
  };
}
