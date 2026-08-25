// The two lists a reader builds themselves: saved graph queries and saved inventory views.
//
// One reader, because there were already two — pages/graph.js and pages/inventory.js each
// carried a byte-identical parse whose only difference was the key, and the nav panel would
// have made a third. What they store is theirs and the writers stay where they are; this owns
// the KEYS and the one rule that matters about reading them:
//
//   A REFUSED STORAGE ANSWERS null, NOT [].  An empty list means "you have saved nothing" and
//   a null means "we could not ask" — a GAS iframe sandbox can deny web storage outright, and
//   both callers hide their control entirely on null rather than showing an empty menu that
//   blames the reader for a browser setting.

export const SAVED_VIEW_KEYS = {
  graph: "sidekickai.graphQueries",
  inventory: "sidekickai.inventoryViews",
};

/**
 * The saved entries under `key`, or null when storage refused.
 *
 * Entries are `{ name, params }`. Anything without a name is dropped: it cannot be drawn as a
 * row and cannot be picked, so carrying it would only put a blank line in a menu.
 *
 * @returns {Array<{name: string, params: object}>|null}
 */
export function readSavedViews(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => v && v.name) : [];
  } catch {
    return null;
  }
}
