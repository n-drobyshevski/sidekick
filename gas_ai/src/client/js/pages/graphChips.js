// The applied-filter chip layer of the Security Graph, as a pure function of state.
//
// Split out of graph.js because it answers three questions the page keeps getting
// subtly wrong — what is applied, what did the *user* apply, and is anything actually
// narrowing the query — and because it is the one part of that page testable without a
// DOM. `filterEntries` takes plain values and returns plain objects; the page turns them
// into buttons.
//
// The three notions are not the same, and conflating them is the bug this replaces:
//
//   - every entry is a chip, so the user can see and clear it;
//   - `isDefault` marks the ones the page wrote into the hash itself on a fresh visit
//     (the AI-agent lens). They are chips, but they are not "filters you applied", so
//     they stay out of the count badge — a page that opens announcing "2 filters
//     applied" that nobody applied is lying about its own state;
//   - `isNarrowing` marks the ones that constrain the server query, defaults included.
//     A default-narrowed view that comes back empty is still an empty *filtered* view,
//     and the empty state has to say so rather than blaming the starting point.

import { listJoin, listSplit } from "../store.js";

/**
 * The starting point, the depth and the node-type lens used to be chips here. They are not
 * filters any more — they are the QUERY, spelled out in the builder above this row, where the
 * user can see and edit them directly. A chip restating "Type: AI Agent" beside a bar already
 * reading `FIND [AI Agent]` would be the second control answering one question that the
 * `isDefault` machinery below was invented to apologise for.
 *
 * What remains is what genuinely narrows the ANSWER rather than shaping the question.
 *
 * @param {object} state    the resolved graph params (see graphParams in graph.js)
 * @param {object} defaults the deployment settings ({maxNodes})
 * @returns {Array<{key, label, sev?, isDefault?, isNarrowing?, patch}>}
 */
export function filterEntries(state, defaults) {
  const entries = [];

  for (const s of listSplit(state.severities)) {
    entries.push({
      key: "sev-" + s,
      label: "Severity",
      value: s,
      sev: s,
      isNarrowing: true,
      patch: { severities: listJoin(listSplit(state.severities).filter((x) => x !== s)) },
    });
  }

  // A widened budget is view state like any other: visible as a chip, clearable back to
  // the configured one, and carried in a shared link. It is not narrowing — raising the
  // budget can only ever show more.
  if (state.maxNodesRaw && state.maxNodes !== (defaults.maxNodes || 0)) {
    entries.push({
      key: "maxNodes",
      label: "Budget",
      value: `${state.maxNodes} nodes`,
      patch: { maxNodes: "" },
    });
  }

  if (state.projects) {
    entries.push({
      key: "projects", label: "Project", value: state.projects,
      isNarrowing: true, patch: { projects: "" },
    });
  }
  if (state.clouds) {
    entries.push({
      key: "clouds", label: "Cloud", value: state.clouds,
      isNarrowing: true, patch: { clouds: "" },
    });
  }
  return entries;
}

/** How many filters the *user* applied — what the count badge on the button reports. */
export function appliedCount(entries) {
  return entries.filter((e) => !e.isDefault).length;
}

/** Whether anything is constraining the query, defaults included. */
export function isNarrowingSet(entries) {
  return entries.some((e) => e.isNarrowing);
}

/** Which field group in the filter panel a chip belongs to. */
export function sectionOf(entry) {
  if (entry.key.startsWith("sev-")) return "severity";
  return entry.key;
}
