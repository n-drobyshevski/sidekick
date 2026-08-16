// The applied-chip layer of the Security Graph, as a pure function of state.
//
// Split out of graph.js because it is the one part of that page testable without a DOM:
// `filterEntries` takes plain values and returns plain objects; the page turns them into
// buttons.
//
// WHAT IS LEFT HERE IS ONE CHIP, and the history of that is the point.
//
// The seed, the depth and the node-type lens went first: they are not filters, they are the
// QUERY, spelled out in the builder above this row where the user can see and edit them. A chip
// restating "Type: AI Agent" beside a bar already reading `FIND [AI Agent]` would be a second
// control answering one question.
//
// Severity, cloud and project followed, for exactly the same reason once the builder grew a
// WHERE segment. They were never anything but `where` filters on node 0 — `rpcParams` folded
// them onto it — so they now live there openly, as chips on the row they narrow, with counts and
// operators the panel never had. `migrateLegacyParams` folds the old hash params in on entry, so
// a saved view or a shared link keeps meaning what it meant.
//
// The node budget stays, because it is the one thing here that was never part of the question.

/**
 * @param {object} state    the resolved graph params (see graphParams in graph.js)
 * @param {object} defaults the deployment settings ({maxNodes})
 * @returns {Array<{key, label, value, isNarrowing?, patch}>}
 */
export function filterEntries(state, defaults) {
  const entries = [];

  // A widened budget is view state like any other: visible as a chip, clearable back to the
  // configured one, and carried in a shared link. It is NOT narrowing — raising the budget can
  // only ever show more of a match set, never change what matches. That distinction is why the
  // empty state asks `graph.js`'s `isNarrowing`, which reads the query's `where` half, rather
  // than asking whether this row has anything on it.
  if (state.maxNodesRaw && state.maxNodes !== (defaults.maxNodes || 0)) {
    entries.push({
      key: "maxNodes",
      label: "Budget",
      value: `${state.maxNodes} nodes`,
      patch: { maxNodes: "" },
    });
  }

  return entries;
}
