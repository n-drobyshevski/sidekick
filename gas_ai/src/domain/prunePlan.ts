// Which assets survive a prune down to one project, and why each of the others does not.
//
// The register is pruned by DECIDING ON ASSETS ONCE and letting every other tab follow the
// asset id. Issues, findings, data findings and identity findings all hang off an asset;
// edges join two. Deciding each tab on its own would let them disagree, and a disagreement
// here is an issue row pointing at an asset that no longer exists.
//
// Kept out of syncStore so the decision can be tested without GAS globals, and out of api.ts
// so the sync path and the read path cannot grow two different answers to "does this asset
// belong to VALUE-CHAIN".

import type { ProjectRef } from "./graphTypes";

/** The shape this module needs of an asset. `GNode` satisfies it structurally. */
export interface PrunableAsset {
  id: string;
  projects?: readonly ProjectRef[];
}

/** The shape this module needs of an edge. `GEdge` satisfies it structurally. */
export interface PrunableEdge {
  src: string;
  dst: string;
}

/**
 * Every asset the prune touched, split by the reason it was touched.
 *
 * Four buckets rather than a kept/dropped pair, because the two DROPPED reasons call for
 * different reactions from whoever is reading the preview: an attributed asset is
 * out-of-scope inventory and going is the whole point, while an orphan going is the one
 * outcome an operator might want to stop and think about.
 */
export interface PruneCensus {
  total: number;
  /** Carries the project id in its ancestry. */
  direct: number;
  /** Carries no project at all, but an edge reaches a direct asset. */
  attached: number;
  /** Belongs to some other project. */
  droppedAttributed: number;
  /** Carries no project and nothing kept reaches it. */
  droppedOrphan: number;
  keep: number;
}

export interface PrunePlan {
  keep: Set<string>;
  census: PruneCensus;
}

/**
 * Does this asset belong to the project.
 *
 * One id match, no tree walk: an asset carries its WHOLE ancestor chain (see `ProjectRef` in
 * graphTypes.ts), so naming a folder's id reaches every asset beneath it. Keyed on id and
 * never on name — names are not unique across a thousand-project tenant and carry no
 * ancestry.
 *
 * The single definition of the question, shared by the project view filter in api.ts and by
 * the prune below. Two copies of it would be two answers to "what is inside VALUE-CHAIN",
 * and the first sign of that would be a prune deleting rows the dashboard was showing.
 */
export function inProject(
  projects: readonly ProjectRef[] | undefined, projectId: string,
): boolean {
  if (!projectId) return false;
  return (projects ?? []).some((p) => p.id === projectId);
}

/** An asset Wiz attributed to at least one project. */
function attributed(a: PrunableAsset): boolean {
  return (a.projects ?? []).length > 0;
}

/**
 * The keep-set, and the arithmetic behind it.
 *
 * Two rules, and the second one is the interesting half:
 *
 * 1. Keep what carries the project id.
 *
 * 2. Keep an UNATTRIBUTED asset when one edge joins it to something kept. Wiz attributes
 *    inventory, not people: the identity traversal writes USER_ACCOUNT rows that belong to no
 *    project, and dropping them for that would sever the identity to AI-asset paths this app
 *    exists to draw. Any synthetic risk row that ever lands in the asset tab falls in here
 *    too, and for the same reason — evidence rides along with the asset it is about.
 *
 * ONE hop, from `direct` only, never transitively. In a connected graph a transitive rule
 * keeps very nearly everything, so the panel would run, report a large number and change
 * nothing an operator could feel. And the reprieve is for the unattributed alone: an asset
 * Wiz placed in some OTHER project is exactly the out-of-scope data being shed, so it goes
 * even when an edge reaches it.
 *
 * Throws on a blank project id. A prune with no scope keeps nothing, which is `resetData`
 * wearing a different label, and the one shape of this call that must never quietly succeed.
 */
export function planPrune(
  assets: readonly PrunableAsset[],
  edges: readonly PrunableEdge[],
  projectId: string,
): PrunePlan {
  if (!projectId || !projectId.trim()) {
    throw new Error("Pruning needs a project to keep. Naming none would empty the register.");
  }
  const id = projectId.trim();

  const known = new Set<string>();
  const unattributed = new Set<string>();
  const direct = new Set<string>();
  for (const a of assets) {
    known.add(a.id);
    if (!attributed(a)) unattributed.add(a.id);
    if (inProject(a.projects, id)) direct.add(a.id);
  }

  // `known` guards both ends: a dangling edge must not conjure an id the asset tab has never
  // held into the keep-set, where it would then keep edge and finding rows alive around an
  // asset that does not exist.
  const attached = new Set<string>();
  for (const e of edges) {
    if (direct.has(e.src) && unattributed.has(e.dst) && known.has(e.dst)) attached.add(e.dst);
    if (direct.has(e.dst) && unattributed.has(e.src) && known.has(e.src)) attached.add(e.src);
  }

  const keep = new Set<string>(direct);
  for (const attachedId of attached) keep.add(attachedId);

  let droppedAttributed = 0;
  let droppedOrphan = 0;
  for (const a of assets) {
    if (keep.has(a.id)) continue;
    if (attributed(a)) droppedAttributed += 1;
    else droppedOrphan += 1;
  }

  return {
    keep,
    census: {
      total: assets.length,
      direct: direct.size,
      attached: attached.size,
      droppedAttributed,
      droppedOrphan,
      keep: keep.size,
    },
  };
}
