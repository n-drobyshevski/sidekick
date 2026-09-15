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
// `.verdict-mark` / `.verdict-word` / `.verdict-dot(--ok|--neutral|--bad|--warn)` live in
// `styles/pages.css`, credited there to gas_ai's original. Only the JS half moved in the
// commit that promoted this function; the DOM it builds has not changed since. `--warn` is
// the one tone added after that move, for the cold zone's `partly-cold` project verdict.

import { absent, absentText, el } from "../ui.js";

/**
 * verdict slug -> the dot's tone. The mapping lives here rather than being re-typed once per
 * page; an unrecognised slug falls to "neutral", the same tone a null verdict takes.
 *
 * TWO FAMILIES SHARE ONE TABLE, and that is deliberate rather than accidental. The first
 * three slugs are a CAPACITY verdict (`capacityView` in both program.js and repos.js): is
 * remediation keeping up with arrivals. The seven below them are a COLD-ZONE verdict
 * (`src/domain/coldZone.ts`): a repository's state (`cold`/`warm`/`clear`/`watching`/
 * `unobserved`) and a project's rollup of it (`fully-cold`/`partly-cold`, plus `warm` and
 * `clear`, which the two families spell the same way and mean compatibly). One table because
 * one dot vocabulary — the word beside the dot is what says WHICH question is being answered,
 * and a second mapping keyed by the same slugs would let the two drift.
 *
 * WHY `unobserved` AND `watching` ARE NEUTRAL RATHER THAN BAD. Neither is a statement about a
 * team. `unobserved` says the SCANNER stopped returning the repository — a fact about the
 * pipeline, which `coldZone.ts` tests first precisely so a drop-out is never read as
 * remediation — and `watching` says the clock has not run long enough to say anything yet.
 * Painting either of them red would publish a verdict nobody measured; both are still
 * counted, separately, and the word says which.
 *
 * `partly-cold` IS THE ONE `warn` TONE, and it is why `.verdict-dot--warn` exists at all
 * (styles/pages.css, beside the other three): a project where SOME repositories have gone
 * quiet is not the same claim as one where every repository with open findings has, and
 * collapsing the two into `bad` would lose the only distinction the team table's verdict
 * column is there to draw.
 */
const VERDICT_KINDS = {
  gaining: "ok",
  "keeping-up": "neutral",
  "falling-behind": "bad",
  // The cold-zone family — five repository states and two project rollups.
  cold: "bad",
  "fully-cold": "bad",
  "partly-cold": "warn",
  unobserved: "neutral",
  watching: "neutral",
  warm: "ok",
  clear: "ok",
};

/**
 * A verdict as a dot AND a word.
 *
 * @param {string|null|undefined} verdict  a capacity slug ("gaining" | "keeping-up" |
 *   "falling-behind") or a cold-zone slug ("cold" | "warm" | "clear" | "watching" |
 *   "unobserved" | "fully-cold" | "partly-cold"), or null/undefined for a group with no
 *   defined verdict
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
