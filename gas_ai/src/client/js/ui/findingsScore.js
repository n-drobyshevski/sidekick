// The findings score, as an asset surface renders it: the PERCENTILE leads, the raw score
// follows, and the band trails as muted context.
//
// WHY THIS IS NOT A FLAG ON aarsChip. `aarsChip` (ui/severity.js) paints the score on its
// BAND's severity token — the same vivid ground an open CRITICAL issue gets — and that is
// exactly the claim ai/AARS_SCORING_ASSESSMENT.md §3 says the band cannot support: on live
// data 19 of 30 scored assets land CRITICAL while HIGH and MEDIUM hold none, so nineteen
// red chips out of thirty sort nothing and name no action. Worse, a red band chip sitting
// beside a red issue badge on the same row asserts a distinction the two scales do not
// share. Splitting the renderer rather than parameterising the old one is what keeps the
// two readings apart AT THE CALL SITE: after this change `aarsChip` survives only on the
// AARS Rules page and its Help specimen, where a band is the subject — a model diagnostic —
// and every surface that implies action about an asset reaches for the neutral chip below.
//
// The band is demoted, not stripped. It still reads as a word, because a reader holding the
// rule's thresholds in mind should be able to see which side of them a score fell on. It
// just stops being the loudest thing in the cell, and it stops being a colour.
//
// The label and the two prose helpers live in ./scoreLabel.js — DOM-free, because
// recordSections.js needs the label and imports no document. Re-exported here so a page
// gets all four from one import.

import { el } from "./dom.js";
import { FINDINGS_SCORE_LABEL, ordinal, percentileText } from "./scoreLabel.js";

export { FINDINGS_SCORE_LABEL, ordinal, percentileText };

const hasNumber = (v) => typeof v === "number" && isFinite(v);

/**
 * The score as an asset surface shows it: `p60  72  CRITICAL`, in that order of weight.
 *
 * Neutral by construction — no `sev-*` class anywhere on it, which is what removes the
 * tint. The band keeps a WORD rather than a colour, which is also what DESIGN.md's "never
 * colour alone" rule asks for, arrived at from the opposite direction: there is no colour
 * here for a word to be paired with.
 *
 * `role="img"` with a full name, for the reason `sevBadge` gives: one announcement per
 * cell, not three separate spans read as three facts.
 *
 * An unscored asset renders as a dash, exactly as `aarsChip` does — "not in the scored
 * population" is a real state (only AI assets and what they reach are scored) and must not
 * look like a zero. A scored asset with no percentile is also real, on a payload cached
 * before this field existed, so that segment is omitted rather than faked.
 */
export function scoreChip(score, percentile, band) {
  if (!hasNumber(score)) return el("span", { class: "muted small" }, "—");
  const label = FINDINGS_SCORE_LABEL + " " + score +
    (hasNumber(percentile) ? ", " + ordinal(percentile) + " percentile" : "") +
    (band ? ", level " + band : "");
  return el(
    "span",
    { class: "score-chip", role: "img", "aria-label": label },
    hasNumber(percentile)
      ? el("span", { class: "score-chip__pct num" }, "p" + Math.round(percentile))
      : null,
    el("span", { class: "score-chip__score num" }, String(score)),
    band ? el("span", { class: "score-chip__band" }, band) : null,
  );
}
