// What Settings → Access needs to never lose an edit silently. One copy for the four
// accessEditor.js files (gas, gas_devsecops, gas_ai, gas_hub).
//
// THE BUG THIS EXISTS FOR. An owner typed a new admin's address, clicked "Save access" without
// pressing Add, and was told "Access updated." — no RPC had run, and the address was gone on
// the next reload. The editors now flush typed-but-not-added text before saving, refuse to
// claim a save that did nothing, check what the server actually kept, and ask before a reload
// throws unsaved edits away. The two helpers below are the parts that are the same everywhere.

/**
 * The addresses in `sent` that `stored` does not hold — what a save asked for and did not get.
 * Case- and whitespace-blind, like the server's own allowlist matching. Empty means all kept.
 *
 * @param {string[]} sent
 * @param {string[]} stored
 * @returns {string[]}
 */
export function notKept(sent, stored) {
  const norm = (e) => String(e || "").trim().toLowerCase();
  const have = new Set((stored || []).map(norm));
  return (sent || []).map(norm).filter((e) => e && !have.has(e));
}

/**
 * Ask before leaving the page while `isDirty()` holds. Inert once `node` is no longer in the
 * document, so a panel that has been navigated away from never blocks an unrelated reload —
 * and it removes itself at that point rather than accumulating one listener per visit.
 *
 * @param {Node} node       the panel whose edits are at stake
 * @param {() => boolean} isDirty
 */
export function guardUnsaved(node, isDirty) {
  if (typeof window === "undefined") return;
  const onBeforeUnload = (e) => {
    if (!node.isConnected) {
      window.removeEventListener("beforeunload", onBeforeUnload);
      return;
    }
    if (!isDirty()) return;
    e.preventDefault();
    // Legacy browsers read the prompt from returnValue; its text is ignored everywhere now.
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);
}
