// The remediation split's cut note — the one sentence that says a bounded table is bounded,
// shared by the two pages that draw the split (`mttr.js`, `executive.js`).
//
// WHY A SHARED MODULE FOR ONE SENTENCE. The split's dimension follows the header scope, and
// only one of its three dimensions is capped: domains and support groups are operator-
// configured, assets are estate-sized, so the server keeps the top ASSET_TOP_N and ships what
// it dropped as `cut`. Two pages then have to say the same true thing about the same cut. A
// footnote that drifts between them is worse than no footnote on one of them — a reader who
// sees "12 more assets" on one page and "8 more assets" on the other has learned that neither
// number is to be trusted. One function, one sentence.
//
// WHY IT LIVES IN `pages/`, NOT `ui/`: the same reason `_rates.js` does — `shared.test.js`'s
// parity contract pins `src/client/js/ui/` to a fixed list of register primitives, and this is
// copy for one section that two pages happen to share, not a design-system part.
//
// ON THE SURFACE, NEVER IN A TIP OR A DISCLOSURE. A bound is an honesty statement about the
// population the section is drawn over, and DESIGN.md §6 keeps those on the surface of their
// section; only the explanation of how to READ the section moves one level down. Both callers
// append the return of this function as a sibling `<p class="small muted">` under the table,
// and `test/wordsOneLevelDown.test.js` holds them to it.

import { fmtCount, pluralize } from "../ui.js";

/**
 * What the split's cap dropped, as a sentence — or null when nothing was dropped.
 *
 * Null for the two uncapped dimensions (the server sends no `cut` at all) and null for a capped
 * dimension that fit inside its cap, which read the same on the page and should: "nothing fell
 * off" and "nothing could have" are both silence.
 *
 * @param {{groups: number, open: number}|null|undefined} cut  the payload's `cut` block
 * @param {string} noun  the dimension's singular noun ("asset"), pluralized against the count
 * @returns {string|null}
 */
export function groupCutNote(cut, noun) {
  const groups = (cut && cut.groups) || 0;
  if (groups <= 0) return null;
  const open = (cut && cut.open) || 0;
  return fmtCount(groups) + " more " + pluralize(groups, noun) + " holding "
    + fmtCount(open) + " open " + pluralize(open, "finding")
    + (groups === 1 ? " is" : " are")
    + " not shown; the register lists every open finding.";
}
