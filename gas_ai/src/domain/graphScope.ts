// Narrowing the graph to one project — the node rule the canvas depends on.
//
// Filtering a graph by membership is not the same problem as filtering a table by it. A table
// row that fails the test is simply absent and nothing else changes; a graph node that fails it
// takes every path through it with it. And the paths are the product: an agent that reaches
// sensitive data through a service account and a bucket IS the finding.
//
// The substrate those paths run through belongs to no project. Buckets, service accounts, hosts
// and user accounts arrive from the exposure and identity traversals as reachable context
// rather than as inventory (see `reach.ts`), so Wiz attributes them to nothing. Neither do the
// ISSUE nodes, the SUMMARY stubs, or any of the six derived risk kinds — those are minted at
// read time from a condition holding on an asset and carry `id`/`kind`/`name` and nothing else.
//
// So a strict "must carry the project id" filter would keep the agents and delete everything
// they reach, and the canvas would report a clean project by drawing severed stubs. That failure
// mode is worse than not scoping at all, because an absent path reads as an absent risk.
//
// The rule instead: a node is in view if it belongs to the project, OR it belongs to NO project
// and is reachable from something that does. Evidence rides along with whatever asset survived.
//
// The second half of that disjunction is deliberately narrow. A node attributed to a DIFFERENT
// project is never admitted, however reachable — otherwise selecting one business unit would
// drag in another's assets through any bucket they happen to share, and the view would quietly
// stop being a view of that project.

import { inProject } from "./prunePlan";
import type { GEdge, GNode, GraphDoc } from "./graphTypes";

/** A node Wiz attributed to nothing — substrate, or a node minted at read time. */
function unattributed(n: GNode): boolean {
  return (n.projects ?? []).length === 0;
}

/**
 * `doc` narrowed to `projectId`, or `doc` itself when there is no project to narrow to.
 *
 * Returned by identity in the unscoped case so callers can keep relying on `loadGraphDoc`'s
 * memoized reference — the common path must not pay for a copy of the whole register.
 */
export function scopeGraphDoc(doc: GraphDoc, projectId: string): GraphDoc {
  if (!projectId) return doc;
  return scopeBy(doc, (n) => inProject(n.projects, projectId), unattributed);
}

/**
 * `doc` narrowed to one business domain — the `Wiz/Domain` tag — on the same rule.
 *
 * The two halves map across exactly. A node is in view if it CARRIES that domain, or it
 * carries none and is reachable from something that does; a node tagged with a DIFFERENT
 * domain is never admitted however reachable, which is the same guard that stops one business
 * unit dragging in another's assets through a shared bucket.
 *
 * That second rule is the whole reason a domain is worth scoping by, and the seeded landscape
 * is built to show it: `bucket-customer-pii` is owned by SAP while `agent-a`, which reads it,
 * is CROSS. Scoped to either, the path between them is visibly cut — which is what makes the
 * dimension something other than a second spelling of the project.
 *
 * Untagged nodes ride along, and there are many more of them here than there are unattributed
 * nodes under a project scope — a domain is a tag a tenant may write on some resources and not
 * others, where `projects` is filled in by Wiz. That is correct rather than lax: an SAP agent's
 * attack path runs through whatever it reaches, and dropping the untagged hops would draw
 * severed stubs. The coverage figure beside the picker is what keeps that honest.
 */
export function scopeGraphDocToDomain(doc: GraphDoc, domain: string): GraphDoc {
  if (!domain) return doc;
  return scopeBy(doc, (n) => n.domain === domain, (n) => !n.domain);
}

/**
 * The walk both scopes share: anchor on the nodes the scope names, then cross only nodes the
 * scope cannot attribute to anyone.
 *
 * One engine rather than two, because the interesting part is not the predicate — it is the
 * traversal and the induced-subgraph step, and two copies of those would be two chances to
 * get "an absent path reads as an absent risk" wrong.
 */
function scopeBy(
  doc: GraphDoc,
  anchored: (n: GNode) => boolean,
  ridesAlong: (n: GNode) => boolean,
): GraphDoc {
  const keep = new Set<string>();
  const open: string[] = [];
  for (const n of doc.nodes) {
    if (anchored(n)) {
      keep.add(n.id);
      open.push(n.id);
    }
  }

  // Walk outward from the anchored assets, crossing only unattributed nodes. Both directions:
  // an edge's meaning does not depend on which end the traversal happened to record first, and
  // an agent is as often the destination of a relationship as its source.
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const seen = adjacency.get(from);
    if (seen) seen.push(to);
    else adjacency.set(from, [to]);
  };
  for (const e of doc.edges) {
    link(e.src, e.dst);
    link(e.dst, e.src);
  }
  while (open.length) {
    for (const nextId of adjacency.get(open.pop()!) ?? []) {
      if (keep.has(nextId)) continue;
      const next = byId.get(nextId);
      // `!next` drops a dangling endpoint, which the induced-subgraph step below would drop
      // anyway. `!ridesAlong` is the guard against leaking another scope's assets.
      if (!next || !ridesAlong(next)) continue;
      keep.add(nextId);
      open.push(nextId);
    }
  }

  const nodes: GNode[] = doc.nodes.filter((n) => keep.has(n.id));
  // Induced subgraph — both endpoints, the same test projectGraph applies after its own walk.
  const edges: GEdge[] = doc.edges.filter((e) => keep.has(e.src) && keep.has(e.dst));
  return { nodes, edges, syncedAt: doc.syncedAt };
}
