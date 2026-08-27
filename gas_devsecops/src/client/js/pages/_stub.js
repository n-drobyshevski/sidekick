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

import { el, heroStat, pageHeader } from "../ui.js";

/**
 * Render one not-yet-wired page.
 *
 * The hero slot is for a NUMBER — "the number is the product" is the first design
 * principle, and `.hero-value` is sized for one. A stub has no number, so it puts the page
 * TITLE there and the question the page answers underneath, rather than setting a sentence
 * at 32px. The lane name rides the eyebrow, which is what it is for.
 *
 * @param {HTMLElement} host  the content pane
 * @param {object}      spec  { lane, title, lede, sections: string[], note?: string }
 */
export function renderStub(host, spec) {
  host.append(pageHeader({ hero: heroStat(spec.lane, spec.title, spec.lede) }));

  const card = el("section", { class: "card stub" });
  card.append(el("h2", { class: "section-label" }, "Что будет на этой странице"));

  const list = el("ul", { class: "stub-list" });
  for (const line of spec.sections) list.append(el("li", {}, line));
  card.append(list);

  if (spec.note) {
    card.append(el("p", { class: "stub-note" }, spec.note));
  }

  card.append(el(
    "p",
    { class: "stub-status" },
    "Данные не подключены: слой домена переносится из brick/devsecops на втором этапе.",
  ));
  host.append(card);
}
