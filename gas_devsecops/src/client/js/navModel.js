// What the two-tier rail draws: the items on the icon rail, and what each one's panel holds.
//
// Pure and DOM-free by design — the decisions here (which lane a page belongs to, which
// items earn a panel, what a panel lists once the payload has landed) are the part worth
// testing, and none of them needs a document.
//
// THE ONE SOURCE IS `PAGES`. app.js keeps the route table and passes it in; this module never
// carries a second list of pages that could disagree with it, and test/shared.test.js
// holds that boundary from the other side. This app's `PAGES` groups nine routes into three
// labelled lanes — Program (Executive, MTTR & SLA, Coverage & efficiency), Registers
// (Dependencies, Code, Secrets) and Data (Repositories, Scan history, Storage) — plus one
// unlabelled tail page, Settings, that stays a plain rail link rather than a lane of one.

/**
 * The rail's items, in order.
 *
 * A labelled lane collapses to ONE rail item carrying its pages; the unlabelled tail
 * (`group: null`) stays one item per page, because those three name themselves and a lane
 * over them would only restate the link.
 *
 * TWO FLAGS TAKE PAGES OUT BEFORE ANY OF THAT HAPPENS: `hidden` (off this branch's PoC nav)
 * and `experimental` (behind a setting). Both are applied first, so a lane they empty never
 * reaches the rail — the way the Labs heading has always vanished with its page.
 *
 * AND A LANE LEFT HOLDING ONE VISIBLE PAGE IS DRAWN AS THAT PAGE. None of this app's three
 * lanes is down to one page today — Program, Registers and Data each hold three — but if
 * `hidden` or a disabled `experimental` flag ever thinned one to a single route, a rail
 * naming the lane would label that item with a category instead of its name, and its panel
 * would open onto a single row repeating what was just clicked. It is the same rule that
 * stops a labelled lane holding one page in the stacked list, applied one tier up: a lane
 * earns its name by having more than one thing under it.
 *
 * @param {object} pages  the PAGES route table
 * @param {{experimental?: boolean}} opts
 * @returns {Array<{kind: "lane"|"page", id: string, label: string, route: string,
 *                  lane: string|null, pages: Array<{key: string, title: string}>}>}
 */
export function railItems(pages, opts) {
  const experimental = !!(opts && opts.experimental);
  const items = [];
  for (const [key, page] of Object.entries(pages || {})) {
    if (page.hidden) continue;
    if (page.experimental && !experimental) continue;
    const entry = { key, title: page.title };
    const last = items[items.length - 1];
    // Lanes are contiguous (shared.test.js pins it), so the item still open is the only
    // one a page can join.
    if (page.group && last && last.lane === page.group) {
      last.pages.push(entry);
      continue;
    }
    items.push({
      kind: page.group ? "lane" : "page",
      id: page.group || key,
      label: page.group || page.title,
      // A lane leads to its first page: the panel is never the only way through, and the
      // first page is the one the lane's order already argues for.
      route: key,
      lane: page.group || null,
      pages: [entry],
    });
  }
  // A lane of one is that one page. Its `lane` is kept, because the rail still marks the
  // lane a route belongs to and the stacked list below 800px still draws the heading — only
  // the rail item's own name and mark come from the page instead.
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
 * The same rule as "a labelled lane earns its heading by holding two pages": a panel whose
 * only row repeats the rail item you opened it from is furniture. So Program, Registers and
 * Data — each holding more than one page — have panels; Settings, the one unlabelled tail
 * page, has none and is a plain link. Nothing on the rail advertises the difference — the
 * panel is what shows up, and `aria-haspopup` is what says so to a reader who cannot see it.
 */
export function hasPanel(item, blocks) {
  if (!item) return false;
  return item.pages.length > 1 || (blocks || []).length > 0;
}

/**
 * The blocks under a panel's page rows — the lane's own instances, which is what makes a
 * panel worth opening rather than a second copy of the rail.
 *
 * Every row here has to be a destination that ALREADY deep-links: a panel that navigated
 * somewhere a shared URL cannot reach would be inventing a nav surface the app cannot honour
 * on the way back. `ctx` carries what the shell already holds — nothing here fetches.
 *
 * A block with no rows is omitted rather than drawn empty: an empty heading would say "you
 * have none" where the truth may be "we could not ask".
 *
 * NONE OF THIS APP'S THREE LANES (Program, Registers, Data) has instances of its own beyond
 * the pages they already group — no saved queries, no per-lane collection to list — so this
 * currently returns no blocks for any of them, and every panel is plain page links. The
 * function stays lane-shaped rather than a stub so a lane that later gains one (a Registers
 * page saving its own views, say) has a place to add it without touching navFlyout.js's
 * contract.
 *
 * @param {object} item  a rail item from railItems()
 * @param {object} ctx
 * @returns {Array<{id: string, label: string, rows: Array<{label: string, route: string,
 *                  params: object, icon: string|null}>}>}
 */
export function panelBlocks(item, ctx) {
  if (!item || item.kind !== "lane") return [];
  void ctx; // read by a future block; no lane fills one yet
  return [];
}
