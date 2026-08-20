// The Phase 6 posture tier (src/domain/posture.ts), rendered the same way the problem
// tree's outcome is: a tinted pill + word, never colour alone (DESIGN.md). Mirrors
// TIER_VALUES — 1..4, 4 = worst — and postureRule.test.ts pins that a live-derived tier is
// always one of the four; if the tier's meaning ever changes there, TIER_META below has to
// change with it or the Inventory's Posture column reads wrong.
//
// A SCALE OF ITS OWN, where the outcome badge reuses the four .pill kinds. The divergence is
// the point rather than an oversight. An outcome scale is categorical and has a real unknown
// bucket — `Track ★` means "a coverage gap, neither good nor bad", and a neutral grey is the
// honest paint for that. A tier scale is ordinal: tier 2 is the middle rung of four, not an
// unknown, and grey there reads as DISABLED. That is what an operator reported, and it is a
// property of the encoding rather than of the particular grey.
//
// The four steps live in tokens.css as --tier-N-*, adopted against a measurement: every
// adjacent pair of solids clears the OKLab separation floor (15) and the dichromatic floor
// (8), which the previous amber/orange pair missed by more than half.

import { el } from "./dom.js";

const TIER_META = {
  4: { kind: "pill--tier4", label: "Tier 4" },
  3: { kind: "pill--tier3", label: "Tier 3" },
  2: { kind: "pill--tier2", label: "Tier 2" },
  1: { kind: "pill--tier1", label: "Tier 1" },
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
