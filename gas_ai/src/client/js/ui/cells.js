// What a table cell says when the answer is "nothing", "maybe", or "this is a node".
//
// The three renderers every register needs and only one of them had. They arrive from
// src/client/js/queryTable.js, where they were the private half of a switch on the Security
// Graph's own field names — a vocabulary trapped inside one page's schema. Inverted here: the
// renderers are named exports that any `cell(row)` can call, and the graph's switch becomes
// one caller of them rather than their home.
//
// This is the smallest of the shared halves and the one with the widest reach: an em dash is
// written six ways across eighteen files today, and the difference between the spellings is
// not a style question. `absent()` is the register saying "we were never told"; a bare "—" in
// black says the same thing in the same weight as a value.

import { el } from "./dom.js";
import { truncTip } from "./tip.js";
import { triState } from "./tableModel.js";
import { categoryOf, kindIconSvg } from "../icons.js";

/** The app's one way of writing "nothing here", used by every register on every page. */
const EMPTY = "—";

/**
 * Absence, in the one weight that means it.
 *
 * MUTED IS THE WHOLE POINT, and it is why this is a function rather than a constant string.
 * CLAUDE.md's rule is that absent is never zero: Wiz returns nothing for a property it never
 * evaluated, and a register that prints that in the same ink as a measured value has quietly
 * asserted a measurement. The dash says there is no value; the grey says nobody is claiming
 * there should be one.
 *
 * No aria treatment: an em dash is read out as a pause or skipped, which is the right amount
 * of attention for a cell whose row already has an accessible name.
 */
export function absent() {
  return el("span", { class: "muted" }, EMPTY);
}

/**
 * A yes/no/unknown cell. Three states, never two.
 *
 * The codebase is emphatic that an absent property means Wiz never reported one, and printing
 * that as "No" asserts the opposite of what is known. THE WORD CARRIES THE STATE — colour
 * never does it alone, which is also why the unknown case is the shared dash rather than a
 * third colour nobody has been taught.
 *
 * The decision itself is `triState` in ui/tableModel.js, where vitest can reach it; this is
 * only the span it renders into.
 */
export function triCell(v) {
  const state = triState(v);
  if (state === "yes") return "Yes";
  if (state === "no") return "No";
  return absent();
}

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
