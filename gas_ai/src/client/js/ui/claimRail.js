// How much of a closed space one cascade row claims, drawn on ONE shared axis down the
// column — the replacement for the per-row bar this page used to draw.
//
// WHY THE OLD ONE HAD TO GO. It was a 44px track filled left-to-right by `count / total`.
// Over 54 leaves that renders 1 as 0.8px and 6 as 4.9px: two claims a reader cannot tell
// apart, on a column whose entire job is to make "order is meaning" checkable. Widening it
// alone would not have fixed the real problem, which is that a left-anchored bar answers
// "how big is this row" when the question a first-match cascade actually raises is "what is
// left by the time this row is tried".
//
// SO THE CLAIM IS A SEGMENT AT ITS CUMULATIVE OFFSET. Row 1 takes [0, 3), row 2 takes
// [3, 5), and the fallback takes whatever tail is left. Read top to bottom the column shows
// the space being CONSUMED in cascade order, which is the same fact the rule table is
// arranged around: a row can only claim what no earlier row already took. A shadowed row is
// then not merely a zero — it is a visibly empty lane between two neighbours that meet, and
// the hatch says so without needing the number.
//
// The bar is `aria-hidden` beside its own printed number, per ui/data.js's rule that a
// decorative meter must not also be announced: the count is the reading, and the `td`
// carries the sentence.
//
// All three cascades on this page use this — the AARS gap ladder, the Problem tree's
// outcome cascade and the Posture tier cascade — because all three are first-match-wins
// partitions of a closed set (live gap instances, 54 leaves, 27 cells), so the cumulative
// reading means the same thing in each. That is also why it takes an explicit `offset`
// rather than computing one: only the caller knows the row order the tally came in.

import { el } from "../../../../../gas_shared/ui/dom.js";

/**
 * Paint one row's claim in place. Built once per cell and thereafter mutated — rule 2 of
 * pages/aars.js: a rebuilt control drops the keystroke of anyone typing beside it.
 *
 * `count === null` means NOT MEASURED YET (no preview has landed), which is a different
 * statement from a measured zero — the same distinction the function this replaces already
 * kept, and the one the lattice's landscape mode turns on.
 *
 * It used to make that distinction by hiding the cell. That worked while the column sat in
 * the middle of the table; as the spine immediately after `#` it would reflow the whole
 * ladder the first time a preview landed. So the lane is always drawn and the UNMEASURED
 * state is a lane with nothing in it — an outline, no fill, no number — which says "no
 * answer yet" where the hatch says "the answer is none". Three states, three marks, and the
 * table stops moving underneath the reader.
 */
export function claimRail(td, { count, total, offset = 0, unit = "leaves", dead = false }) {
  if (!td) return;
  if (!td.firstChild) {
    td.append(
      el("span", { class: "claim-rail", "aria-hidden": "true" },
        el("span", { class: "claim-rail__track" }, el("i", { class: "claim-rail__fill" }))),
      el("span", { class: "claim-rail__n" }),
    );
  }
  td.hidden = false;

  const rail = td.firstChild;
  const fill = rail.firstChild.firstChild;
  const measured = count !== null && count !== undefined;
  rail.classList.toggle("is-unmeasured", !measured);
  if (!measured) {
    fill.style.display = "none";
    rail.classList.remove("is-dead");
    td.lastChild.textContent = "";
    td.setAttribute("aria-label", `not measured yet, in ${unit}`);
    return;
  }
  const span = total ? (count / total) * 100 : 0;
  const start = total ? (Math.min(offset, total) / total) * 100 : 0;
  fill.style.left = `${start}%`;
  fill.style.width = `${span}%`;
  // A zero-claim row keeps its lane and hatches it: "this row never fires" is a finding to
  // report, not an absence to leave blank.
  rail.classList.toggle("is-dead", dead || count === 0);
  fill.style.display = count === 0 ? "none" : "";

  td.lastChild.textContent = String(count);
  td.setAttribute("aria-label", total
    ? `claims ${count} of ${total} ${unit}`
    : `claims ${count} ${unit}`);
}

/**
 * Running offsets for a first-match tally — `[0, byRow[0], byRow[0]+byRow[1], ...]`, one
 * more entry than rows so the last is the fallback's own start. Exported rather than left
 * to each caller because getting it subtly wrong (an off-by-one, or summing the fallback
 * into the middle) would draw a plausible column that lies about which row consumed what.
 */
export function claimOffsets(byRow) {
  const out = [];
  let running = 0;
  for (const n of byRow) {
    out.push(running);
    running += n || 0;
  }
  out.push(running);
  return out;
}
