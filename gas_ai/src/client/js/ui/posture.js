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
 * One posture tier as a pill: tinted kind + word, matching `outcomeBadge`'s contract. An
 * unrecognised or absent tier (a node the posture fold never reached) renders as an
 * explicit dash rather than guessing a tier.
 */
export function tierBadge(tier) {
  const meta = TIER_META[Number(tier)];
  if (!meta) return el("span", { class: "small muted" }, "—");
  return el(
    "span",
    { class: `pill ${meta.kind}`, role: "img", "aria-label": `Posture ${meta.label}` },
    meta.label,
  );
}
