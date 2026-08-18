// What the findings score is CALLED, and how a percentile of it is spoken. No DOM here on
// purpose: recordSections.js needs the label to title a rail section and states in its own
// header that nothing it imports touches a document, so the label cannot live in a module
// that builds elements. findingsScore.js re-exports all three beside the chip that draws
// them, so a page still reaches everything through one import.
//
// A MIRROR of `AARS_DISPLAY_LABEL` in src/domain/aars.ts. The client bundle cannot import a
// TS module — esbuild builds the server and the client as two independent IIFEs — so the
// string exists twice, and test/assetQueryMirror.test.ts imports both sides and asserts
// they agree. That is the same arrangement measureContent.js and assetQuery.js already use;
// see the constant's own comment for why the label and the persisted `aars*` identifiers
// are deliberately different.

/** Mirrors `AARS_DISPLAY_LABEL` (src/domain/aars.ts). */
export const FINDINGS_SCORE_LABEL = "Findings score";

/**
 * "60th", "1st", "22nd", "13th" — the ordinal a percentile is spoken with. The teens are
 * the whole reason this is not a lookup on the last digit: 11/12/13 take "th" even though
 * 1/2/3 take "st"/"nd"/"rd".
 */
export function ordinal(n) {
  const v = Math.round(Number(n));
  const tens = v % 100;
  if (tens >= 11 && tens <= 13) return v + "th";
  const ones = v % 10;
  if (ones === 1) return v + "st";
  if (ones === 2) return v + "nd";
  if (ones === 3) return v + "rd";
  return v + "th";
}

/**
 * "60th percentile of 30 scored assets" — the percentile WITH its denominator, which is the
 * only honest way to publish one: ai/AARS_SCORING_ASSESSMENT.md §3's S-test asks that no
 * scored aggregate ship without the population it was computed over, and "60th percentile"
 * on its own is exactly the number that invites the reader to supply their own.
 *
 * Falls back to the bare ordinal when the count has not been loaded — a stale cached
 * payload predating the denominator should still place the asset — and to "" when there is
 * no percentile at all, so a caller can append it unconditionally.
 */
export function percentileText(percentile, scored) {
  if (typeof percentile !== "number" || !isFinite(percentile)) return "";
  const rank = ordinal(percentile) + " percentile";
  return typeof scored === "number" && scored > 0
    ? rank + " of " + scored + " scored assets"
    : rank;
}
