// The four hero tiles on the Registers page — one launcher per sibling register, plus the
// "coming soon" placeholder. The app's one local ui/ module: no sibling draws a launcher tile,
// so nothing here belongs in gas_shared.
//
// A REAL <a>, NOT A CLICK HANDLER. HtmlService's iframe sandbox does not grant
// allow-top-navigation, so a JS `location = url` fails silently — only a real anchor is
// rescued by the `<base target="_top">` gas_shared/shell/index.template.html already carries.
//
// AND THE ANCHOR CARRIES NO `target` ATTRIBUTE OF ITS OWN. gas_shared/shell/navRail.js:95
// sets `target="_self"` on the rail's INTERNAL hash links precisely so those stay inside the
// sandboxed iframe; copying that convention onto an OUTBOUND tile link would trap the
// navigation in the same iframe and render a blank googleusercontent page instead of leaving
// the app. Do not "fix" this by adding one back — this behaviour is only testable inside a
// real deployment (see gas_hub's plan doc, "Risks and open items").
//
// NEVER `title=` — el() throws on it (gas_shared/ui/dom.js). The tile's only affordance
// beyond itself is the external-link glyph in the footer, uiIcon("external")
// (gas_shared/ui/uiIcons.js), which already exists and needs no new name added to that set.

import { el, uiIcon } from "../ui.js";

/** One CSS modifier per tile key — the fill/ink pair styles/tokens.css defines for it. */
const MODIFIER = {
  os: "tile--os",
  ai: "tile--ai",
  devsecops: "tile--dso",
  soon: "tile--soon",
};

const UNSET_NOTE =
  "This sidekick's URL has not been set. An admin can add it in Settings → Sidekick URLs.";

/**
 * One tile, from a hubModel.js `tileModel()` row: `{ key, productName, headline, scope,
 * state, url }`, `state` one of "link" / "unset" / "soon".
 *
 * "soon" and "unset" are both a `<div>`, never a link and never a disabled control — a
 * disabled-looking element that is not actually a `<button>`/`<a>` invites a click that does
 * nothing, and PRODUCT.md's honest-state principle is exactly that a control that fails on
 * click is worse than no control.
 */
export function tile(spec) {
  const modifier = MODIFIER[spec.key];
  const eyebrow = el("div", { class: "tile-eyebrow" }, spec.productName);
  const headline = el("div", { class: "tile-headline" }, spec.headline);

  if (spec.state === "soon") {
    return el("div", { class: "tile " + modifier },
      eyebrow, headline,
      el("div", { class: "tile-footer" }, spec.scope));
  }

  if (spec.state === "unset") {
    return el("div", { class: "tile " + modifier + " tile--unset" },
      eyebrow, headline,
      el("div", { class: "tile-footer" }, UNSET_NOTE));
  }

  return el("a", { class: "tile " + modifier, href: spec.url },
    eyebrow, headline,
    el("div", { class: "tile-footer" }, el("span", {}, spec.scope), uiIcon("external")));
}
