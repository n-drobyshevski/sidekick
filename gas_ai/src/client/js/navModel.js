// What the two-tier rail draws: the items on the icon rail, and what each one's panel holds.
//
// Pure and DOM-free, the split prunePanelView.test.js argues for — the decisions here (which lane
// a page belongs to, which items earn a panel, what a panel lists once the payload has
// landed) are the part worth testing, and none of them needs a document.
//
// THE ONE SOURCE IS `PAGES`. app.js keeps the route table and passes it in; this module never
// carries a second list of pages that could disagree with it, and test/shared.test.js
// holds that boundary from the other side.

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
 * AND A LANE LEFT HOLDING ONE VISIBLE PAGE IS DRAWN AS THAT PAGE. With seven routes hidden,
 * "Risk" means Priorities and "Assurance" means Wiz Scans — a rail naming lanes there would
 * be labelling every item with a category instead of its name, and its panel would open onto
 * a single row repeating what was just clicked. It is the same rule that stops a labelled
 * lane holding one page in the stacked list, applied one tier up: a lane earns its name by
 * having more than one thing under it.
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
 * only row repeats the rail item you opened it from is furniture. So Landscape, Risk and
 * Assurance have panels; Labs (one gated page) and the three chrome pages have none, and are
 * plain links. Nothing on the rail advertises the difference — the panel is what shows up,
 * and `aria-haspopup` is what says so to a reader who cannot see it.
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
 * A block with no rows is omitted rather than drawn empty: the saved-view readers this
 * borrows from return null when web storage is refused and their callers hide the control
 * outright, and an empty heading would say "you have none" where the truth is "we could not
 * ask".
 *
 * @param {object} item  a rail item from railItems()
 * @param {{savedViews?: Array, combos?: Array}} ctx
 * @returns {Array<{id: string, label: string, rows: Array<{label: string, route: string,
 *                  params: object, icon: string|null}>}>}
 */
export function panelBlocks(item, ctx) {
  const c = ctx || {};
  const blocks = [];
  if (!item || item.kind !== "lane") return blocks;

  if (item.id === "Landscape") {
    // The reader's own: saved graph queries and saved inventory views, merged into one list
    // because they are one idea — a question you asked once and want back — and told apart
    // by the icon of the page each replays into.
    const rows = (c.savedViews || []).map((v) => ({
      label: v.name, route: v.route, params: v.params || {}, icon: v.route,
    }));
    if (rows.length) blocks.push({ id: "saved", label: "Saved", rows });
  }

  if (item.id === "Risk") {
    // shortLabel, not title: the panel is 280px and the titles run to "AWS Bedrock: model
    // invocation without guardrails". The short forms are written for exactly this — a label
    // that has to land in one line beside its siblings.
    const rows = (c.combos || []).map((g) => ({
      label: g.shortLabel || g.title, route: "combos", params: { open: g.id }, icon: null,
    }));
    if (rows.length) blocks.push({ id: "patterns", label: "Combination patterns", rows });
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
