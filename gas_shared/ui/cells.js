// What a table cell says when the answer is "nothing" or "maybe".
//
// The three renderers every register needs and only one of them had. They arrive from
// src/client/js/queryTable.js, where they were the private half of a switch on the Security
// Graph's own field names — a vocabulary trapped inside one page's schema. Inverted here: the
// renderers are named exports that any `cell(row)` can call, and the graph's switch becomes
// one caller of them rather than their home.
//
// THE THIRD RENDERER LIVES NEXT DOOR. `nameCell` — "this is a node" — moved to
// ui/nodeCell.js when this package was cut, because it reaches ../icons.js for the kind
// medallion and that file is 512 lines of node-kind SVG. `absent()` is imported by every
// register on every page, including ones with no node kinds at all; making the cheapest
// helper in the tree drag the most expensive module in it is a cost with no reader.
//
// This is the smallest of the shared halves and the one with the widest reach: an em dash is
// written six ways across eighteen files today, and the difference between the spellings is
// not a style question. `absent()` is the register saying "we were never told"; a bare "—" in
// black says the same thing in the same weight as a value.

import { el } from "./dom.js";
import { triState } from "./tableModel.js";

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
