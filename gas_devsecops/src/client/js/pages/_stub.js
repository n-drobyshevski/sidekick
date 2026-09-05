// The Phase 1 page body.
//
// Every route in PAGES resolves, renders its own heading, and says plainly what is not
// wired yet. That is deliberate and it is the honest state (PRODUCT.md, principle 5): the
// interface base and the page composition are the deliverable for this phase, and the
// domain layer arrives in Phase 2 as a port of brick/devsecops. A page that drew a
// plausible-looking empty chart instead would be claiming a pipeline that does not exist.
//
// Each stub names the metrics its page will own, so the composition can be reviewed on its
// merits before a single query is written.

import { el, pageHeader } from "../ui.js";

/**
 * Render one not-yet-wired page.
 *
 * The hero slot is for a NUMBER — "the number is the product" is the first design principle,
 * and `.hero-value` is sized for one. A stub has no number, so it renders the header's title
 * block alone: `pageHeader({ route })` reads the page's own name and lane out of PAGES, and
 * the question the page answers rides the lede rather than being set at 32px.
 *
 * NOTHING IMPORTS THIS ANY MORE — `test/pagesLit.test.js` asserts exactly that, route by
 * route, and `test/pagesData.test.js` again per page. It is kept as the Phase 1 record and is
 * updated with the component it calls so it cannot rot into an example of an API that is gone.
 *
 * @param {HTMLElement} host  the content pane
 * @param {object}      spec  { route, lede, sections: string[], note?: string }
 */
export function renderStub(host, spec) {
  host.append(pageHeader({ route: spec.route, lede: spec.lede }));

  const card = el("section", { class: "card stub" });
  card.append(el("h2", { class: "section-label" }, "What this page will answer"));

  const list = el("ul", { class: "stub-list" });
  for (const line of spec.sections) list.append(el("li", {}, line));
  card.append(list);

  if (spec.note) {
    card.append(el("p", { class: "stub-note" }, spec.note));
  }

  card.append(el(
    "p",
    { class: "stub-status" },
    "No data connected — the domain layer ports from brick/devsecops in Phase 2.",
  ));
  host.append(card);
}
