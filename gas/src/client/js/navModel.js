// What the two-tier rail draws: the items on the icon rail, and what each one's panel holds.
//
// Pure and DOM-free, which is the whole point of the split — the decisions here (which lane a
// page belongs to, which items earn a panel, what a panel lists) are the part worth testing,
// and none of them needs a document. It is the same line `scanProgressView` and `capacityView`
// already draw in this codebase: the view model is testable in node, the nodes are not.
//
// THE ONE SOURCE IS `PAGES`. app.js keeps the route table and passes it in; this module never
// carries a second list of pages that could disagree with it, and test/navGroups.test.js holds
// that boundary from the other side.

/**
 * The rail's items, in order.
 *
 * A labelled lane collapses to ONE rail item carrying its pages; the unlabelled tail
 * (`group: null`) stays one item per page, because those pages name themselves and a lane over
 * them would only restate the link.
 *
 * AND A LANE LEFT HOLDING ONE VISIBLE PAGE IS DRAWN AS THAT PAGE. "Overview" means Executive
 * and nothing else — a rail naming the lane there would be labelling the item with a category
 * instead of its name, and its panel would open onto a single row repeating what was just
 * clicked. It is the same rule that stops a labelled lane holding one page in the stacked
 * list, applied one tier up: a lane earns its name by having more than one thing under it.
 *
 * `hidden` takes a page out before any of that happens, so a lane it empties never reaches the
 * rail. Nothing in this app sets it today; it is the seam a gated page would use, and it costs
 * one line to keep rather than a re-derivation later.
 *
 * @param {object} pages  the PAGES route table
 * @returns {Array<{kind: "lane"|"page", id: string, label: string, route: string,
 *                  lane: string|null, pages: Array<{key: string, title: string}>}>}
 */
export function railItems(pages) {
  const items = [];
  for (const [key, page] of Object.entries(pages || {})) {
    if (page.hidden) continue;
    const entry = { key, title: page.title };
    const last = items[items.length - 1];
    // Lanes are contiguous (navGroups.test.js pins it), so the item still open is the only one
    // a page can join.
    if (page.group && last && last.lane === page.group) {
      last.pages.push(entry);
      continue;
    }
    items.push({
      kind: page.group ? "lane" : "page",
      id: page.group || key,
      label: page.group || page.title,
      // A lane leads to its first page: the panel is never the only way through, and the first
      // page is the one the lane's order already argues for.
      route: key,
      lane: page.group || null,
      pages: [entry],
    });
  }
  // A lane of one is that one page. Its `lane` is kept, because the rail still marks the lane a
  // route belongs to and the stacked list below 800px still draws the heading — only the rail
  // item's own name and mark come from the page instead.
  return items.map((item) => (
    item.kind === "lane" && item.pages.length === 1
      ? { ...item, kind: "page", id: item.pages[0].key, label: item.pages[0].title }
      : item
  ));
}

/**
 * The rail item a route belongs to — what the rail marks while you are on that page.
 *
 * @returns {object|null}
 */
export function itemForRoute(items, route) {
  for (const item of items || []) {
    for (const page of item.pages) if (page.key === route) return item;
  }
  return null;
}

/**
 * A rail item earns a panel by having something to put in it.
 *
 * The same rule as "a labelled lane earns its heading by holding two pages": a panel whose only
 * row repeats the rail item you opened it from is furniture. So Security and Data have panels;
 * Executive and Settings are plain links. Nothing on the rail advertises the difference — the
 * panel is what shows up, and `aria-haspopup` is what says so to a reader who cannot see it.
 */
export function hasPanel(item, blocks) {
  if (!item) return false;
  return item.pages.length > 1 || (blocks || []).length > 0;
}

/**
 * The blocks under a panel's page rows — a lane's own instances, which is what would make a
 * panel worth opening rather than a second copy of the rail.
 *
 * THIS REGISTER HAS NONE YET, and the empty array is the honest answer rather than a stub
 * waiting to be filled. The candidates were considered and each fails the one rule that
 * matters: every row in a panel has to be a destination that ALREADY deep-links, because a
 * panel that navigated somewhere a shared URL cannot reach would be inventing a nav surface
 * the app cannot honour on the way back.
 *
 *   - The Security lane's instances would be saved filter states (`#/overview?sev=…&q=…`).
 *     Those deep-link, but nothing in this app saves one yet — there is no saved-view store to
 *     read, and a block drawn over nothing would say "you have none" where the truth is "we
 *     never offered".
 *   - The Data lane's would be the manual groups, whose names arrive with the bootstrap payload
 *     the shell already holds — but a manual group is a SCOPE, and the scope switcher in the
 *     header is where scopes live. Listing them here as destinations would be the rail
 *     re-asserting the thing the header was built to take off it.
 *
 * The parameter stays because the seam is real: when a saved-view store lands, this is the one
 * function that changes, and `hasPanel` already asks for the answer.
 *
 * @param {object} item  a rail item from railItems()
 * @param {object} ctx   what the shell already holds — nothing here fetches
 * @returns {Array<{id: string, label: string, rows: Array<{label: string, route: string,
 *                  params: object, icon: string|null}>}>}
 */
export function panelBlocks(item, ctx) {
  return [];
}
