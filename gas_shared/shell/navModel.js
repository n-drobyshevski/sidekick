// What the two-tier rail draws: the items on the icon rail, and what each one's panel holds.
//
// Pure and DOM-free by design — the decisions here (which lane a page belongs to, which items
// earn a panel, what a panel lists once the payload has landed) are the part worth testing,
// and none of them needs a document. That is also why this module reads NO manifest: it takes
// everything it needs as arguments, so a node test can exercise it without configureApp().
//
// THE ONE SOURCE IS `PAGES`. Each app keeps the route table in its own app.js and passes it
// in; this module never carries a second list of pages that could disagree with it, and every
// app's `test/shared.test.js` (through `gas_shared/test/contracts/navGroups.js`) holds that
// boundary from the other side.
//
// PROMOTED FROM THREE COPIES, and the two places they had drifted are resolved here:
//
//   * `railItems` took `(pages)` in gas and `(pages, opts)` in the two siblings, where `opts
//     .experimental` is the Settings gate. The opts form wins: it degrades to a no-op for an
//     app whose table sets the flag nowhere, which is exactly gas's case.
//   * `panelBlocks` returned `[]` unconditionally in gas and gas_devsecops and built two
//     lanes' worth of rows from `ctx.savedViews` / `ctx.combos` in gas_ai. Those rows are
//     gas_ai DOMAIN KNOWLEDGE — a saved graph query is not a thing a vulnerability register
//     has — so the SHAPE is here and the CONTENT arrives as a builder. See panelBlocks.

/**
 * The rail's items, in order.
 *
 * A labelled lane collapses to ONE rail item carrying its pages; the unlabelled tail
 * (`group: null`) stays one item per page, because those pages name themselves and a lane
 * over them would only restate the link.
 *
 * TWO FLAGS TAKE PAGES OUT BEFORE ANY OF THAT HAPPENS: `hidden` (off the nav, still routable)
 * and `experimental` (behind a setting). Both are applied first, so a lane they empty never
 * reaches the rail — the way a gated lane's heading has always vanished with its page.
 *
 * AND A LANE LEFT HOLDING ONE VISIBLE PAGE IS DRAWN AS THAT PAGE. A rail naming a lane there
 * would label the item with a category instead of its name, and its panel would open onto a
 * single row repeating what was just clicked. It is the same rule that stops a labelled lane
 * holding one page in the stacked list, applied one tier up: a lane earns its name by having
 * more than one thing under it.
 *
 * THE STACKED LIST BELOW 800px DOES NOT COLLAPSE, and that coupling is deliberate: it draws
 * `page.group ? navGroupHeading(...) : navRule()` unconditionally per group change, so a
 * labelled lane of one restates its own link there. That is why every app folded its
 * one-page "Overview" lane into a real lane, and why `singletonLanes` in the navGroups
 * contract is an explicit carve-out rather than a default.
 *
 * @param {object} pages  the PAGES route table
 * @param {{experimental?: boolean}} [opts]
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
    // Lanes are contiguous (the navGroups contract pins it), so the item still open is the
    // only one a page can join.
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
  // A lane of one is that one page. Its `lane` is kept, because the rail still marks the lane
  // a route belongs to and the stacked list below 800px still draws the heading — only the
  // rail item's own name and mark come from the page instead.
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
 * only row repeats the rail item you opened it from is furniture. So a lane holding more than
 * one page has a panel; a collapsed lane and a chrome tail page have none, and are plain
 * links. Nothing on the rail advertises the difference — the panel is what shows up, and
 * `aria-haspopup` is what says so to a reader who cannot see it.
 */
export function hasPanel(item, blocks) {
  if (!item) return false;
  return item.pages.length > 1 || (blocks || []).length > 0;
}

/**
 * The blocks under a panel's page rows — the lane's own instances, which is what makes a
 * panel worth opening rather than a second copy of the rail.
 *
 * THE SHAPE IS SHARED, THE CONTENT IS THE APP'S. `build` is the app's own block builder,
 * handed over as `MANIFEST.panelBlocks` and passed through by `shell/navFlyout.js`. Only
 * gas_ai has one today (saved graph/inventory views under Landscape, combination patterns
 * under Risk); an app that supplies none gets no blocks, which is the honest answer rather
 * than a stub — and hardcoding one register's lanes here would have put "Landscape" and
 * "Risk" into a package two apps have never heard of.
 *
 * Two rules ARE shared, because they are true of any panel:
 *
 *   * ONLY A LANE HAS INSTANCES. A chrome page is one destination; a collapsed lane is drawn
 *     as its page. Neither has a collection under it, so neither is offered to the builder.
 *   * A BLOCK WITH NO ROWS IS OMITTED RATHER THAN DRAWN EMPTY. An empty heading says "you
 *     have none" where the truth is often "we could not ask" — the saved-view readers this
 *     borrows from return null when web storage is refused, and blaming a reader for a
 *     browser setting is the failure the omission avoids. This filter is the one place that
 *     rule lives now; it was gas's `if (!block.rows.length) continue;` in the renderer and
 *     gas_ai's per-builder `if (rows.length)` before, i.e. in two of three apps and in two
 *     different layers. A builder may now return a block unconditionally.
 *
 * Every row a builder returns has to be a destination that ALREADY deep-links: a panel that
 * navigated somewhere a shared URL cannot reach would be inventing a nav surface the app
 * cannot honour on the way back. `ctx` carries what the shell already holds — nothing here,
 * and nothing a builder does, may fetch.
 *
 * @param {object} item  a rail item from railItems()
 * @param {object} ctx   what the shell already holds
 * @param {(item: object, ctx: object) => Array<object>} [build]  the app's block builder
 * @returns {Array<{id: string, label: string, rows: Array<{label: string, route: string,
 *                  params: object, icon: string|null}>}>}
 */
export function panelBlocks(item, ctx, build) {
  if (!item || item.kind !== "lane") return [];
  if (typeof build !== "function") return [];
  const blocks = build(item, ctx || {}) || [];
  return blocks.filter((b) => b && b.rows && b.rows.length);
}
