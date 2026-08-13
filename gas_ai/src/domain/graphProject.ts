// Depth-limited graph projection — the server-side depth control. BFS from the seed
// nodes over an adjacency index, with per-kind neighbor caps that collapse overflow
// into SUMMARY nodes, and global node/edge budgets. Fully deterministic: neighbor
// order is (worse severity, higher AARS, name), so the same document + options always
// yield the same projection.
//
// The budgets bound the PAYLOAD, not just the real nodes in it: the SUMMARY stubs and
// their parent edges are drawn like anything else, so they spend budget like anything
// else. `nodes.length <= maxNodes` and `edges.length <= maxEdges` hold for every
// projection, whatever the tenant's size.

import { MAX_EDGES_DEFAULT, MAX_NODES_DEFAULT, SEED_WAVE_RATIO } from "./config";
import type { GEdge, GNode, GraphDoc, NodeKind } from "./graphTypes";
import { isRiskKind, severityRank } from "./graphTypes";
import { cmp, cmpBy, indexBy } from "./util";

export interface ProjectFilters {
  severities?: string[];
  kinds?: string[];
  projects?: string[];
  clouds?: string[];
}

export interface ProjectOptions {
  seedIds: string[];
  depth: number;
  expandIds?: string[];
  filters?: ProjectFilters;
  perKindCap?: Partial<Record<string, number>>;
  maxNodes?: number;
  maxEdges?: number;
  filterSeeds?: boolean; // scored bulk-seed mode: apply `filters` to seeds too
}

export interface SummaryInfo {
  id: string;
  of: NodeKind;
  count: number;
  parentId: string;
  memberIds: string[];
}

export interface ProjectionCounts {
  totalNodes: number;
  shownNodes: number;
  totalEdges: number;
  shownEdges: number;
  capped: boolean;
}

export interface Projection {
  nodes: GNode[]; // admitted real nodes + synthetic SUMMARY nodes
  edges: GEdge[]; // induced subgraph edges + parent→SUMMARY stubs
  summaries: SummaryInfo[];
  counts: ProjectionCounts;
}

// High-fanout kinds get tighter caps so one hub can't flood the view.
export const DEFAULT_PER_KIND_CAP: Partial<Record<string, number>> = {
  USER_ACCOUNT: 8,
  BUCKET: 6,
  // Same cap as BUCKET: the sensitive-data chain makes databases a real fan-out target for
  // the first time — before it, no live query produced one at all.
  DATABASE: 6,
  DATABASE_SERVER: 6,
  ACCESS_ROLE_BINDING: 5,
};
export const DEFAULT_KIND_CAP = 12;


/** Deterministic neighbor priority: worse severity, then higher AARS, then name. */
export function nodeOrder(a: GNode, b: GNode): number {
  const sev = severityRank(a.severity) - severityRank(b.severity);
  if (sev !== 0) return sev;
  const aars = (b.aars ?? -1) - (a.aars ?? -1);
  if (aars !== 0) return aars;
  return cmp(a.name, b.name);
}

function passesFilters(node: GNode, f: ProjectFilters | undefined): boolean {
  if (!f) return true;
  // Risk evidence rides along with whatever asset survived the filters. These nodes are
  // statements ABOUT an admitted asset, not inventory of their own: they carry no cloud
  // or project, and the derived ones carry no severity, so putting them through the
  // inventory filters would sever the attack path every filter is meant to narrow.
  // The one exception is a filter that explicitly names a risk kind — there the user is
  // curating the evidence itself ("show me only issues"), so it is honored verbatim.
  if (isRiskKind(node.kind) && !f.kinds?.some(isRiskKind)) return true;
  if (f.severities?.length && !f.severities.includes(node.severity ?? "")) return false;
  if (f.kinds?.length && !f.kinds.includes(node.kind)) return false;
  if (f.clouds?.length && !f.clouds.includes(node.cloudPlatform ?? "")) return false;
  if (f.projects?.length) {
    const names = (node.projects ?? []).map((p) => p.name);
    if (!names.some((n) => f.projects!.includes(n))) return false;
  }
  return true;
}

export function projectGraph(doc: GraphDoc, opts: ProjectOptions): Projection {
  const byId = indexBy(doc.nodes, (n) => n.id);

  // Adjacency (both directions), deterministic by edge id.
  const adjacency = new Map<string, Array<{ edge: GEdge; otherId: string }>>();
  const sortedEdges = [...doc.edges].sort(cmpBy((e) => e.id));
  for (const edge of sortedEdges) {
    if (!byId.has(edge.src) || !byId.has(edge.dst)) continue;
    if (!adjacency.has(edge.src)) adjacency.set(edge.src, []);
    if (!adjacency.has(edge.dst)) adjacency.set(edge.dst, []);
    adjacency.get(edge.src)!.push({ edge, otherId: edge.dst });
    adjacency.get(edge.dst)!.push({ edge, otherId: edge.src });
  }

  const maxNodes = opts.maxNodes ?? MAX_NODES_DEFAULT;
  const maxEdges = opts.maxEdges ?? MAX_EDGES_DEFAULT;
  const expand = new Set(opts.expandIds ?? []);
  let capped = false;

  const shown = new Set<string>();
  const summaries: SummaryInfo[] = [];
  const summaryNodes: GNode[] = [];
  const summaryEdges: GEdge[] = [];
  const queue: Array<{ id: string; depth: number }> = [];

  // A "+N more" stub is drawn, focusable and serialized exactly like a real node, so it
  // spends budget like one. Counting both keeps the promise the budget makes: the payload
  // never carries more nodes than the number the setting names.
  const atNodeBudget = () => shown.size + summaryNodes.length >= maxNodes;

  // Seeds are admitted regardless of depth. For the bulk "scored" start
  // (filterSeeds), the active filters DO apply, so a node-type/severity filter
  // narrows the seed set; explicit asset/combo seeds are always admitted.
  //
  // A bulk start — every toxic-combination asset, every scored asset — can name more
  // seeds than the whole budget holds, and a view spent entirely on seeds is a field of
  // disconnected dots: the paths BETWEEN them are what the page is for. So seeds go in
  // worst-first (severity, then AARS), a wave at a time, each wave drained by the BFS
  // below before the next is admitted — the graph fills with paths before it fills with
  // more starting points, and `capped` reports the seeds that never made it.
  const orderedSeeds = opts.seedIds
    .map((id) => byId.get(id))
    .filter((n): n is GNode => !!n && (!opts.filterSeeds || passesFilters(n, opts.filters)))
    .sort(nodeOrder);
  const seedWave = Math.max(1, Math.floor(maxNodes * SEED_WAVE_RATIO));
  let seedCursor = 0;

  function admitSeedWave(): void {
    let admitted = 0;
    while (admitted < seedWave && seedCursor < orderedSeeds.length) {
      const seed = orderedSeeds[seedCursor];
      if (shown.has(seed.id)) {
        seedCursor++;
        continue;
      }
      if (atNodeBudget()) return;
      shown.add(seed.id);
      queue.push({ id: seed.id, depth: 0 });
      seedCursor++;
      admitted++;
    }
  }

  do {
    admitSeedWave();

    while (queue.length) {
      const { id, depth } = queue.shift()!;
      // An explicitly expanded node traverses even at the depth frontier — otherwise
      // "Expand neighbors" is a silent no-op on exactly the nodes a user clicks, since the
      // depth check fires before the per-kind caps expandIds was lifting.
      if (depth >= opts.depth && !expand.has(id)) continue;

      // Fresh neighbors, grouped by kind.
      const groups = new Map<string, GNode[]>();
      for (const { otherId } of adjacency.get(id) ?? []) {
        if (shown.has(otherId)) continue;
        const other = byId.get(otherId)!;
        if (!passesFilters(other, opts.filters)) continue;
        if (!groups.has(other.kind)) groups.set(other.kind, []);
        const group = groups.get(other.kind)!;
        if (!group.some((n) => n.id === otherId)) group.push(other);
      }

      for (const kind of [...groups.keys()].sort()) {
        const members = groups.get(kind)!.sort(nodeOrder);
        const cap = expand.has(id)
          ? Infinity
          : (opts.perKindCap?.[kind] ?? DEFAULT_PER_KIND_CAP[kind] ?? DEFAULT_KIND_CAP);

        const overflow = members.length > cap;
        const kept = overflow ? members.slice(0, Math.max(1, cap - 1)) : members;
        for (const member of kept) {
          if (atNodeBudget()) {
            capped = true;
            break;
          }
          shown.add(member.id);
          // Neighbors pulled in past the frontier stay ON it, so one expand adds exactly
          // one hop instead of cascading a whole extra level of the graph.
          queue.push({
            id: member.id,
            depth: expand.has(id) ? Math.max(depth + 1, opts.depth) : depth + 1,
          });
        }

        const hidden = members.filter((m) => !shown.has(m.id));
        if (hidden.length) {
          if (!overflow) {
            // Hidden purely by the global budget — no summary stub, just the flag.
            capped = true;
            continue;
          }
          // A stub costs one node and one edge to its parent, so it is only worth making
          // when both budgets can afford it — an orphaned "+N more" would be worse than
          // the ⚠ capped flag, which is what says rows are missing when there is no room.
          if (atNodeBudget() || summaryEdges.length >= maxEdges) {
            capped = true;
            continue;
          }
          const sumId = `sum|${id}|${kind}`;
          summaries.push({
            id: sumId,
            of: kind as NodeKind,
            count: hidden.length,
            parentId: id,
            memberIds: hidden.map((m) => m.id),
          });
          summaryNodes.push({
            id: sumId,
            kind: "SUMMARY",
            name: `+${hidden.length} more`,
            summaryOf: kind as NodeKind,
            summaryCount: hidden.length,
            memberIds: hidden.map((m) => m.id),
          });
          const viaEdge = (adjacency.get(id) ?? []).find(
            (a) => a.otherId === hidden[0].id,
          )?.edge;
          summaryEdges.push({
            id: `${id}|SUMMARY|${sumId}`,
            src: id,
            dst: sumId,
            type: viaEdge?.type ?? "USES",
          });
        }
      }
    }
    // Another wave only when the last one left room: the budget is spent on paths first.
  } while (seedCursor < orderedSeeds.length && !atNodeBudget());
  if (seedCursor < orderedSeeds.length) capped = true;

  // Induced subgraph: every edge between two admitted nodes. The parent→SUMMARY stubs are
  // already committed, so they come out of the same budget — an edge count that excluded
  // them would understate what the payload weighs.
  const inducedBudget = Math.max(0, maxEdges - summaryEdges.length);
  const edges: GEdge[] = [];
  const seenEdge = new Set<string>();
  for (const edge of sortedEdges) {
    if (!shown.has(edge.src) || !shown.has(edge.dst)) continue;
    if (seenEdge.has(edge.id)) continue;
    seenEdge.add(edge.id);
    if (edges.length >= inducedBudget) {
      capped = true;
      break;
    }
    edges.push(edge);
  }

  const nodes = doc.nodes.filter((n) => shown.has(n.id));
  return {
    nodes: [...nodes, ...summaryNodes],
    edges: [...edges, ...summaryEdges],
    summaries,
    counts: {
      totalNodes: doc.nodes.length,
      shownNodes: nodes.length,
      totalEdges: doc.edges.length,
      shownEdges: edges.length,
      capped,
    },
  };
}
