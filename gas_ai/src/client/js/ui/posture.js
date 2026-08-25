// The Phase 6 posture tier (src/domain/posture.ts), rendered the same way the problem
// tree's outcome is: a tinted pill + word, never colour alone (DESIGN.md). Mirrors
// TIER_VALUES — 1..4, 4 = worst — and postureRule.test.ts pins that a live-derived tier is
// always one of the four; if the tier's meaning ever changes there, TIER_META below has to
// change with it or the Inventory's Posture column reads wrong.
//
// THE ORDINAL RAMP (--rank-N-* in tokens.css), which is what a tier is: four steps read in
// one direction. It used to be the four .pill kinds, which made tier 2 the neutral grey —
// and grey for a middle rung reads as DISABLED, which is what an operator reported. That is
// a property of the encoding, not of the particular grey.
//
// The ramp is SHARED with the problem outcomes, which turn out to be ordinal too; ui/outcome.js
// carries that argument and the reason one ramp beats two. A tier and an outcome can appear in
// the SAME table row (problems.js's Priority and Posture columns), so they are told apart by
// their words — "Tier 4" against "Act" — while the fill says the same thing in both places:
// this is the bad end of the scale.
//
// The steps were adopted against a measurement rather than a preference: every adjacent pair
// of solids clears the OKLab separation floor (15) and the dichromatic floor (8), which the
// previous amber/orange pair missed by more than half.

import { el } from "./dom.js";
import { bookTip } from "./tip.js";

const TIER_META = {
  4: { kind: "pill--rank4", label: "Tier 4" },
  3: { kind: "pill--rank3", label: "Tier 3" },
  2: { kind: "pill--rank2", label: "Tier 2" },
  1: { kind: "pill--rank1", label: "Tier 1" },
};

/** The tier's plain-text label, for a `<select>` option or a sentence. */
export function tierLabel(tier) {
  const meta = TIER_META[Number(tier)];
  return meta ? meta.label : "";
}

/**
 * WHY a row has no tier, in words — because a dash cannot say it, and on a live register the
 * overwhelming majority of rows have no tier.
 *
 * The two are not the same fact and must not read as one. `WITHHELD` is a COVERAGE gap: the
 * lattice applies here, Wiz has simply never evaluated the flags it reads, and someone can go
 * and close that. `OUT_OF_SCOPE` is a SCOPE statement: capability means identity power and a
 * dataset has no identity, so there is nothing to measure and never will be.
 *
 * Rendering both as one dash is what made the register look broken rather than honestly
 * unrated — the reader sees ~93% blank and concludes the feature is failing, when most of
 * those rows are things this model was never meant to describe.
 */
const STATE_META = {
  WITHHELD: {
    label: "Not measured",
    tip: "In scope for the posture lattice, but Wiz has not evaluated the flags it reads — "
      + "so no tier is claimed. This is a coverage gap: a sync that fills those flags resolves it.",
  },
  OUT_OF_SCOPE: {
    label: "Not applicable",
    tip: "The posture lattice does not describe this kind of asset — its capability axis reads "
      + "identity power, and this asset has no execution identity. Not a coverage gap: there is "
      + "nothing to measure.",
  },
};

/**
 * One posture tier as a pill: tinted kind + word, matching `outcomeBadge`'s contract.
 *
 * With no tier, `state` decides what is said instead. It is optional so every existing call
 * site keeps working unchanged — those fall back to the dash, which is still the right mark
 * for a row whose asset the graph never carried at all, a third kind of absence again.
 */
export function tierBadge(tier, state) {
  const meta = TIER_META[Number(tier)];
  if (!meta) {
    const reason = STATE_META[state];
    if (!reason) return el("span", { class: "small muted" }, "—");
    // Deliberately NOT a pill and NOT on the ordinal ramp. A tier says where on a scale this
    // asset sits; these two say the scale was not applied, which is a different kind of claim
    // and must not be mistaken for a fifth, best-looking rung.
    return bookTip(
      el("span", { class: "small muted" }, reason.label),
      state === "WITHHELD" ? "posture-withheld" : "posture-not-applicable",
      reason.tip,
    );
  }
  // "Tier 2" says nothing about which end of the scale it is on, and the ordinal fill can
  // only say so to a reader who can see it. The lead says it in words.
  return bookTip(el(
    "span",
    { class: `pill ${meta.kind}`, role: "img", "aria-label": `Posture ${meta.label}` },
    meta.label,
  ), "posture-tier", meta.label + " of 4 — tier 1 is the best posture, tier 4 the worst.");
}
