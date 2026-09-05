// A node's name behind its kind icon — the one table renderer that needs the node-kind
// vocabulary, and the reason it is not in ui/cells.js.
//
// ../icons.js is 512 lines of per-kind SVG. `absent()` and `triCell()` next door are two of
// the most-imported helpers in the tree and neither of them has a kind; keeping them in the
// same module as this one would have put the whole icon set into the graph of every page
// that only wanted an em dash. Splitting on the import, not on the theme.

import { el } from "./dom.js";
import { truncTip } from "./tip.js";
import { categoryOf, kindIconSvg } from "../icons.js";

/**
 * A node's name behind its kind icon, in that kind's category tint — the same cue the graph
 * canvas's medallion carries, so a row and a node read as the same thing in two views.
 *
 * TAKES name AND kind, NOT A ROW, because the callers disagree about what the fields are
 * called: the graph's path cells carry `name`/`kind`, an asset row carries `name`/`kind`, and
 * a problem row carries `assetName` and no node kind at all. A row-shaped signature would have
 * to know all three, which is how a shared helper starts accumulating one page's schema.
 *
 * `opts.badge` is a Node appended after the name — inventory's "Agentic" pill is the case that
 * forced it, and it retires the one inline `style` attribute left in a table cell.
 *
 * The tip hangs off the clipped span, not the wrapper: `.cell-name-text` is the box the
 * ellipsis happens in, so it is the box that knows whether anything was lost.
 */
export function nameCell(name, kind, opts) {
  const options = opts || {};
  const text = truncTip(el("span", { class: "cell-name-text" }, name), name);
  const kids = [text];
  if (options.badge) kids.push(options.badge);
  if (kind === null || kind === undefined || kind === "") {
    // No kind, no medallion. A tile with nothing to say still costs the name its width, and
    // `categoryOf` would answer nothing to tint it with — see the register comment above.
    return el("span", {
      class: "cell-name" + (options.className ? " " + options.className : ""),
    }, ...kids);
  }
  const icon = kindIconSvg(kind, 14);
  icon.setAttribute("class", "cell-icon");
  return el("span", {
    class: "cell-name" + (options.className ? " " + options.className : ""),
    "data-category": categoryOf(kind),
  }, icon, ...kids);
}
