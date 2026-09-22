// A verdict as a dot AND a word.
//
// PROMOTED FROM gas_devsecops/src/client/js/ui/verdict.js, which had itself been promoted out
// of `renderProgram` when a second page in that app wanted the same mark, and which credits
// gas_ai's `.cap-verdict` (inventory.css) as the original. That module's own header set the
// bar it has now cleared: "Two pages independently wanting the same shape is what promotes a
// private inner function into a module." Two APPS now want it. `gas/src/client/js/pages/
// coldZone.js` carried a second copy of both the table and the function, and the two
// stylesheets carried BYTE-IDENTICAL rulesets — `gas/src/client/styles/pages.css` even said
// so in its own comment, and added "NOT PROMOTED TO gas_shared. One app draws it today; a
// second consumer is what promotes a rule." This is that consumer, arriving from the other
// side.
//
// THE WORD IS THE SIGNAL AND THE DOT IS THE REDUNDANCY, never the other way round. States told
// apart by hue alone survive neither greyscale nor a dichromat, which DESIGN.md's
// accessibility bar forbids outright; the dot is `aria-hidden` for the same reason — it says
// nothing the word beside it does not.
//
// A VERDICT OF NULL OR UNRECOGNISED STILL DRAWS. A caller's own view function may render
// `absentText` as the word for a group with no defined flow (no observation window, nothing to
// compare), and a neutral dot beside an em dash is the honest picture of a verdict nobody
// could reach — never a blank space where a reading used to be.
//
// THE CSS MOVED WITH IT, to gas_shared/styles/components.css, which is where
// gas_shared/README.md's placement rule puts the stylesheet half of a `ui/` export with a
// domain-free API. `.verdict-word`'s `font-weight: 650` came across UNCHANGED and is wrong —
// 650 is not one of the four named weight steps. Repointing it is a shipped-pixel change and
// belongs in its own measured commit, not in the one that moves the file; this is the same
// discipline splitBar.js states for its hatch.

import { el } from "./dom.js";
// `absent()` is the one muted em-dash NODE (cells.js); `absentText` is the em dash as a STRING
// (figures.js). Both are needed here because a caller passes the string and the mark draws the
// node — inside an app they arrive together through its ui.js barrel, but a shared module
// reaches each at its own home.
import { absent } from "./cells.js";
import { absentText } from "./figures.js";

/**
 * verdict slug -> the dot's tone. The mapping lives here rather than being re-typed once per
 * page; an unrecognised slug falls to "neutral", the same tone a null verdict takes.
 *
 * TWO FAMILIES SHARE ONE TABLE, and that is deliberate rather than accidental. The first three
 * slugs are a CAPACITY verdict (`capacityView` in program.js and repos.js): is remediation
 * keeping up with arrivals. The seven below them are a COLD-ZONE verdict (`src/domain/
 * coldZone.ts` in both registers): one subject's state (`cold`/`warm`/`clear`/`watching`/
 * `unobserved`) and a rollup of it (`fully-cold`/`partly-cold`, plus `warm` and `clear`, which
 * the two families spell the same way and mean compatibly). One table because one dot
 * vocabulary — the word beside the dot is what says WHICH question is being answered, and a
 * second mapping keyed by the same slugs would let the two drift. That drift is exactly what
 * this promotion ends: the two apps' tables were kept in step by hand until now.
 *
 * WHY `unobserved` AND `watching` ARE NEUTRAL RATHER THAN BAD. Neither is a statement about a
 * team. `unobserved` says the SCANNER stopped returning the subject — a fact about the
 * pipeline, which `coldZone.ts` tests first precisely so a drop-out is never read as
 * remediation — and `watching` says the clock has not run long enough to say anything yet.
 * Painting either red would publish a verdict nobody measured; both are still counted,
 * separately, and the word says which.
 *
 * `partly-cold` IS THE ONE `warn` TONE, and it is why `.verdict-dot--warn` exists at all: a
 * group where SOME of its members have gone quiet is not the same claim as one where every
 * member with open findings has, and collapsing the two into `bad` would lose the only
 * distinction the rollup table's verdict column is there to draw.
 */
export const VERDICT_KINDS = {
  gaining: "ok",
  "keeping-up": "neutral",
  "falling-behind": "bad",
  // The cold-zone family — five subject states and two rollups.
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
 *   "unobserved" | "fully-cold" | "partly-cold"), or null/undefined for a subject with no
 *   defined verdict
 * @param {string|Node} word  the label already resolved by the caller — `absentText` draws the
 *   app's one absence mark instead of a bare dash in the verdict word's own weight
 */
export function verdictMark(verdict, word) {
  const kind = VERDICT_KINDS[verdict] || "neutral";
  return el("span", { class: "verdict-mark" },
    el("span", { class: "verdict-dot verdict-dot--" + kind, "aria-hidden": "true" }),
    // `kpiCard`'s own `valueOrAbsent` cannot reach an em dash wrapped in a node, so the absent
    // case is resolved here, exactly as it was inside program.js before the first move.
    el("span", { class: "verdict-word" }, word === absentText ? absent() : word));
}
