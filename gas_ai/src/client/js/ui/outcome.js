// The problem tree's outcome (src/domain/problem.ts), rendered the same way severity is:
// a tinted pill + word, never colour alone (DESIGN.md). Mirrors OUTCOME_VALUES — ACT,
// ATTEND, TRACK_STAR, TRACK, worst first — and problemRule.test.ts pins that order; if it
// ever changes there, OUTCOME_META below has to change with it or a queue reads wrong.
//
// THE FOUR NAMES ARE CISA'S, NOT OURS, and the asterisk is theirs too. This was borrowed
// verbatim from CISA's SSVC decision tree and went undocumented for long enough that
// "why is it called Track*" had no answer anywhere in the repo. CISA's own definitions:
//
//   Track   — does not require action at this time; keep tracking and reassess if new
//             information becomes available.
//   Track*  — "contains specific characteristics that MAY REQUIRE CLOSER MONITORING for
//             changes". The asterisk is CISA's notation for exactly that, and it is why
//             this outcome outranks plain Track instead of being a footnote to it.
//   Attend  — needs attention from internal, supervisory-level individuals.
//   Act     — needs attention from supervisory-level AND leadership-level individuals.
//
// So it is written `Track*`, the way CISA writes it and the way this repo's own design note
// writes it (ai/AARS_SCORING_ASSESSMENT.md). It used to render as `Track ★` — a filled star
// is a local embellishment that reads as decoration or as a footnote marker, which is the
// opposite of what the mark means, and it made the term harder to recognise for the
// analysts most likely to already know it.
// https://www.cisa.gov/stakeholder-specific-vulnerability-categorization-ssvc
//
// AN OUTCOME IS ORDINAL, AND IT IS PAINTED ON THE ORDINAL RAMP (--rank-N-* in tokens.css),
// NOT ON THE FOUR .pill KINDS. This file used to argue the opposite — that TRACK_STAR was
// "a coverage gap, neither good nor bad" and so earned the neutral grey. That sentence is
// true about the outcome's MEANING and silent about its RANK, and the rank is what the app
// actually sorts on: problem.ts documents OUTCOME_VALUES as worst-first with an order that
// is "load-bearing wherever a caller sorts by it", and both compareProblems (problems.ts)
// and pickAction (actions.ts) spell out ACT < ATTEND < TRACK_STAR < TRACK.
//
// So TRACK_STAR ranks WORSE than plain TRACK, and grey-then-green painted it as the quieter
// of the two — inverting, in colour, the one relationship the column beside it is sorted by.
//
// TRACK_STAR is both a rung and an epistemic state ("nobody has checked something that
// matters"). The ★ in its label already carries the epistemic half, which frees the fill to
// carry the rank. Both facts are encoded and neither is carried by colour alone.
//
// The ramp is SHARED with the posture tiers rather than forked from them, because the two
// are the same kind of scale — four steps, worst first — and because problems.js draws an
// outcome, a tier and a severity in ONE table row: a second warm ramp there would be three
// ordinal ramps competing in one line. The word says which scale you are reading; the fill
// says where on it you are. .pill.ok/.warn/.bad/.neutral stay for statusPill, whose labels
// ("Failing", "In progress", "Issue") really are categorical.

import { el } from "../../../../../gas_shared/ui/dom.js";
import { bookTip } from "../../../../../gas_shared/ui/tip.js";

// `spoken` exists only where the written label contains a mark a screen reader cannot make
// sense of. The badge's accessible name used to be built from the label alone, so TRACK_STAR
// announced as "Priority Track black star" — the one outcome whose name carries meaning in a
// glyph was the one whose meaning was lost when read aloud. Everything else falls back to
// `label`, so this stays a two-line exception rather than a parallel vocabulary.
const OUTCOME_META = {
  // `note` is CISA's own wording, verbatim from the header above. It sat in a source comment
  // where the analysts reading the column could never get at it; now it is what the card says.
  ACT: {
    kind: "pill--rank4", label: "Act",
    note: "Act — needs attention from supervisory-level AND leadership-level individuals.",
  },
  ATTEND: {
    kind: "pill--rank3", label: "Attend",
    note: "Attend — needs attention from internal, supervisory-level individuals.",
  },
  TRACK_STAR: {
    kind: "pill--rank2", label: "Track*", spoken: "Track, closer monitoring",
    note: "Track* — CISA's notation for a case with characteristics that may require closer "
      + "monitoring. It outranks plain Track rather than being a footnote to it.",
  },
  TRACK: {
    kind: "pill--rank1", label: "Track",
    note: "Track — no action needed at this time; keep tracking and reassess if new "
      + "information arrives.",
  },
};

/** CISA's own sentence for one outcome, for a heading or a card that defines it. */
export function outcomeNote(outcome) {
  const meta = OUTCOME_META[String(outcome || "").toUpperCase()];
  return meta ? meta.note : "";
}

/** The outcome's plain-text label, for a `<select>` option or a sentence. */
export function outcomeLabel(outcome) {
  const meta = OUTCOME_META[String(outcome || "").toUpperCase()];
  return meta ? meta.label : "";
}

/**
 * One outcome as a pill: tinted kind + word, matching sevBadge's contract. An
 * unrecognised or absent outcome — an issue or finding the tree has not decided, or is
 * not eligible for one — renders as an explicit dash rather than guessing a queue.
 */
export function outcomeBadge(outcome) {
  const meta = OUTCOME_META[String(outcome || "").toUpperCase()];
  if (!meta) return el("span", { class: "small muted" }, "—");
  return bookTip(el(
    "span",
    { class: `pill ${meta.kind}`, role: "img", "aria-label": `Priority ${meta.spoken || meta.label}` },
    meta.label,
  ), "priorities-rank", meta.note);
}
