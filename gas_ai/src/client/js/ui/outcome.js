// The problem tree's outcome (src/domain/problem.ts), rendered the same way severity is:
// a tinted pill + word, never colour alone (DESIGN.md). Mirrors OUTCOME_VALUES — ACT,
// ATTEND, TRACK_STAR, TRACK, worst first — and problemRule.test.ts pins that order; if it
// ever changes there, OUTCOME_META below has to change with it or a queue reads wrong.
//
// The four .pill kinds (bad/warn/neutral/ok) already exist for this app's other verdicts
// (statusPill's "Failing" / "In progress" / "Open"), so this reuses them rather than
// inventing a fifth severity-shaped palette: ACT is bad, ATTEND is warn, TRACK_STAR is
// neutral (a coverage gap, neither good nor bad), and TRACK — nothing here needs action —
// is the one outcome that earns "ok".

import { el } from "./dom.js";

const OUTCOME_META = {
  ACT: { kind: "bad", label: "Act" },
  ATTEND: { kind: "warn", label: "Attend" },
  TRACK_STAR: { kind: "neutral", label: "Track ★" },
  TRACK: { kind: "ok", label: "Track" },
};

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
  return el(
    "span",
    { class: `pill ${meta.kind}`, role: "img", "aria-label": `Priority ${meta.label}` },
    meta.label,
  );
}
