// The one dot-and-word for a capacity verdict — falling behind / keeping up / gaining — ported
// from gas_ai's `.cap-verdict` (inventory.css), and promoted here in Wave C because a SECOND
// page (`pages/repos.js`, the per-repository Capacity column) needed the identical mark
// `pages/program.js` had already built for its own Verdict card. Two pages independently
// wanting the same shape is what promotes a private inner function into a module; before this
// it lived as `function verdictMark(verdict, word)` inside `renderProgram`, unreachable from
// anywhere else in the tree.
//
// THE WORD IS THE SIGNAL AND THE DOT IS THE REDUNDANCY, never the other way round. Three
// states told apart by hue alone survive neither greyscale nor a dichromat, which DESIGN.md's
// accessibility bar forbids outright; the dot is `aria-hidden` for the same reason — it says
// nothing the word beside it does not.
//
// A verdict of null or unrecognised still draws: a caller's own view function may render
// `absentText` as the word for a group with no defined flow (no observation window, nothing to
// compare), and a neutral dot beside an em dash is the honest picture of a verdict nobody
// could reach — never a blank space where a reading used to be.
//
// `.verdict-mark` / `.verdict-word` / `.verdict-dot(--ok|--neutral|--bad)` already live in
// `styles/pages.css`, credited there to gas_ai's original. Only the JS half moved in this
// commit; the DOM this function builds, and the classes it builds it with, are unchanged.

import { absent, absentText, el } from "../ui.js";

/**
 * verdict slug -> the dot's tone. Every caller on this register uses these three slugs
 * (`capacityView` in both program.js and repos.js), so the mapping lives here rather than
 * being re-typed once per page; an unrecognised slug falls to "neutral", the same tone a null
 * verdict takes.
 */
const VERDICT_KINDS = { gaining: "ok", "keeping-up": "neutral", "falling-behind": "bad" };

/**
 * A capacity verdict as a dot AND a word.
 *
 * @param {string|null|undefined} verdict  "gaining" | "keeping-up" | "falling-behind", or
 *   null/undefined for a group with no defined flow
 * @param {string} word  the label already resolved by the caller — `absentText` draws this
 *   app's one absence mark instead of a bare dash in the verdict word's own weight
 */
export function verdictMark(verdict, word) {
  const kind = VERDICT_KINDS[verdict] || "neutral";
  return el("span", { class: "verdict-mark" },
    el("span", { class: "verdict-dot verdict-dot--" + kind, "aria-hidden": "true" }),
    // `kpiCard`'s own `valueOrAbsent` cannot reach an em dash wrapped in a node, so the
    // absent case is resolved here, exactly as it was inside program.js before the move.
    el("span", { class: "verdict-word" }, word === absentText ? absent() : word));
}
