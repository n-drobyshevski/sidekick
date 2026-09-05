// What THIS register's nav panels list under their page rows — the lane's own instances,
// which is what makes a panel worth opening rather than a second copy of the rail.
//
// SPLIT OUT OF navModel.js WHEN THAT MODULE WAS PROMOTED. The rail's arithmetic (which lane a
// page belongs to, which items earn a panel, the collapse rule) is the same in all three
// sidekicks and lives in `gas_shared/shell/navModel.js` now. THESE ROWS ARE NOT: a saved
// graph query and a toxic-combination pattern are facts about an asset graph, and neither
// sibling register has one. So the shape is shared and the content is here, handed over as
// `MANIFEST.panelBlocks`.
//
// TWO RULES THE SHARED HALF ENFORCES, so this file does not repeat them:
//   * Only a LANE is offered to a builder — a chrome page and a collapsed lane have no
//     collection under them.
//   * A BLOCK WITH NO ROWS IS DROPPED rather than drawn as a heading over nothing. That used
//     to be an `if (rows.length)` around each push here; a builder may now return a block
//     unconditionally and shared decides.
//
// THE ONE RULE THIS FILE STILL OWES: every row has to be a destination that ALREADY
// deep-links. A panel that navigated somewhere a shared URL cannot reach would be inventing a
// nav surface the app cannot honour on the way back. And nothing here fetches — hovering a
// rail item costs a localStorage read and an object walk, never a round trip.

/**
 * @param {{kind: string, id: string}} item  a rail item from railItems()
 * @param {{savedViews?: Array, combos?: Array}} ctx  what the shell already holds
 * @returns {Array<{id: string, label: string, rows: Array<object>}>}
 */
export function panelBlocksFor(item, ctx) {
  const c = ctx || {};
  const blocks = [];

  if (item.id === "Landscape") {
    // The reader's own: saved graph queries and saved inventory views, merged into one list
    // because they are one idea — a question you asked once and want back — and told apart
    // by the icon of the page each replays into.
    blocks.push({
      id: "saved",
      label: "Saved",
      rows: (c.savedViews || []).map((v) => ({
        label: v.name, route: v.route, params: v.params || {}, icon: v.route,
      })),
    });
  }

  if (item.id === "Risk") {
    // shortLabel, not title: the panel is 280px and the titles run to "AWS Bedrock: model
    // invocation without guardrails". The short forms are written for exactly this — a label
    // that has to land in one line beside its siblings.
    blocks.push({
      id: "patterns",
      label: "Combination patterns",
      rows: (c.combos || []).map((g) => ({
        label: g.shortLabel || g.title, route: "combos", params: { open: g.id }, icon: null,
      })),
    });
  }

  // ASSURANCE HAS NO SECOND BLOCK, and the reason is worth writing down because the obvious
  // one is a trap. Its instances are the collected compliance frameworks, and their names
  // arrive only with `api_getCompliance` — a payload the shell does not hold until someone
  // opens that page. The panel never fetches (hovering a rail item must not cost a round
  // trip), so a Frameworks block would materialise on the second visit and be absent on the
  // first: a nav that changes shape depending on where you have already been is worse than
  // one that offers two pages and means it. The other candidate, the ten Wiz scan areas, is
  // not deep-linkable at all — no `?area=` param exists — and inventing one to fill a panel
  // would be the tail wagging the page.

  return blocks;
}
