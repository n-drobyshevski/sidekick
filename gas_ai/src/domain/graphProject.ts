// Depth-limited graph projection — the server-side depth control. BFS from the seed
// nodes over an adjacency index, with per-kind neighbor caps that collapse overflow
// into SUMMARY nodes, and global node/edge budgets. Fully deterministic: neighbor
// order is (worse severity, higher AARS, name), so the same document + options always
// yield the same projection.

import { SEVERITY_ORDER } from "./config";
import { MAX_EDGES_DEFAULT, MAX_NODES_DEFAULT } from "./config";
import type { GEdge, GNode, GraphDoc, NodeKind } from "./graphTypes";

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
  ACCESS_ROLE_BINDING: 5,
};
export const DEFAULT_KIND_CAP = 12;

function severityRank(s: string | undefined): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(s ?? "");
  return i === -1 ? SEVERITY_ORDER.length : i; // lower = worse
}

/** Deterministic neighbor priority: worse severity, then higher AARS, then name. */
export function nodeOrder(a: GNode, b: GNode): number {
  const sev = severityRank(a.severity) - severityRank(b.severity);
  if (sev !== 0) return sev;
  const aars = (b.aars ?? -1) - (a.aars ?? -1);
  if (aars !== 0) return aars;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function passesFilters(node: GNode, f: ProjectFilters | undefined): boolean {
  if (!f) return true;
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
  const byId = new Map<string, GNode>();
  for (const n of doc.nodes) byId.set(n.id, n);

  // Adjacency (both directions), deterministic by edge id.
  const adjacency = new Map<string, Array<{ edge: GEdge; otherId: string }>>();
  const sortedEdges = [...doc.edges].sort((a, b) => (a.id < b.id ? -1 : 1));
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

  // Seeds are admitted regardless of depth. For the bulk "scored" start
  // (filterSeeds), the active filters DO apply, so a node-type/severity filter
  // narrows the seed set; explicit asset/combo seeds are always admitted.
  for (const seedId of opts.seedIds) {
    const seedNode = byId.get(seedId);
    if (!seedNode || shown.has(seedId)) continue;
    if (opts.filterSeeds && !passesFilters(seedNode, opts.filters)) continue;
    if (shown.size >= maxNodes) {
      capped = true;
      break;
    }
    shown.add(seedId);
    queue.push({ id: seedId, depth: 0 });
  }

  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (depth >= opts.depth) continue;

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
        if (shown.size >= maxNodes) {
          capped = true;
          break;
        }
        shown.add(member.id);
        queue.push({ id: member.id, depth: depth + 1 });
      }

      const hidden = members.filter((m) => !shown.has(m.id));
      if (hidden.length) {
        if (!overflow) {
          // Hidden purely by the global budget — no summary stub, just the flag.
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

  // Induced subgraph: every edge between two admitted nodes.
  const edges: GEdge[] = [];
  const seenEdge = new Set<string>();
  for (const edge of sortedEdges) {
    if (!shown.has(edge.src) || !shown.has(edge.dst)) continue;
    if (seenEdge.has(edge.id)) continue;
    seenEdge.add(edge.id);
    if (edges.length >= maxEdges) {
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
