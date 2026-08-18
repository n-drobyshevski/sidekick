// Prose for the REACH panel (Wiz Scans) and its Inventory headline — kept apart from
// scans.js and inventory.js the same reason scanContent.js is: labels and warnings a
// reviewer should be able to read without also reading the render code.

/** The decision tree's four axes, in problem.ts's own declared order. */
export const REACH_AXES = [
  { key: "exploitation", label: "Exploitation" },
  { key: "impact", label: "Technical impact" },
  { key: "exposure", label: "System exposure" },
  { key: "mission", label: "Mission / business impact" },
];

/**
 * Same warning problem-axis-unknown-rate (measureSpec.ts) carries, restated for the KNOWN
 * framing this panel reports instead of the unknown one — see reach.ts's own header for why
 * the conversion happens at all. Repeated here in full rather than referenced, because this
 * is the one sentence in the whole panel most likely to be read out of context.
 */
export const AXIS_KNOWN_WARNING =
  "A low known% here does NOT mean the landscape is safe — it means the decision tree cannot " +
  "prioritise, because the evidence one of its four axes needs was never collected. Reading " +
  "it as reassurance is the single most dangerous misuse of this number.";

/** The one sentence that keeps the scan-area register and this section from reading as duplicates. */
export const REACH_VS_SCAN_AREA_NOTE =
  "Scan area coverage above answers “did the collection run.” Landscape reach below answers " +
  "“how much of the landscape did it touch” — a scan area can report a live figure while most " +
  "of the AI landscape it feeds still sits unobserved, if the traversal that step runs never " +
  "reached those particular assets.";
