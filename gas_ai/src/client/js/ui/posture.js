// The Phase 6 posture tier (src/domain/posture.ts), rendered the same way the problem
// tree's outcome is: a tinted pill + word, never colour alone (DESIGN.md). Mirrors
// TIER_VALUES — 1..4, 4 = worst — and postureRule.test.ts pins that a live-derived tier is
// always one of the four; if the tier's meaning ever changes there, TIER_META below has to
// change with it or the Inventory's Posture column reads wrong.
//
// Same four .pill kinds `outcomeBadge` reuses, for the same reason: tier 4 is bad, tier 3
// is warn, tier 2 is neutral (the landscape's typical middle, not a verdict either way), and
// tier 1 — minimal capability inside a confirmed-strong containment — is the one tier that
// earns "ok".

import { el } from "./dom.js";

const TIER_META = {
  4: { kind: "bad", label: "Tier 4" },
  3: { kind: "warn", label: "Tier 3" },
  2: { kind: "neutral", label: "Tier 2" },
  1: { kind: "ok", label: "Tier 1" },
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
