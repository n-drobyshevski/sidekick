import { renderStub } from "./_stub.js";

/** Did the effort land where it mattered, and can it keep up. */
export function renderProgram(host) {
  renderStub(host, {
    lane: "Program",
    title: "Coverage & efficiency",
    lede: "Whether remediation effort lands on what matters, and whether it keeps up with arrivals.",
    sections: [
      "Coverage and efficiency — always published as a pair, and always with the width of their doubt: the bounds come from the extreme relabellings of the unclassified rows.",
      "The confusion matrix, with unclassified rows held OUTSIDE the four quadrants rather than folded into them.",
      "Monthly capacity: open at start, arrived, closed, and a verdict with a ±2% dead band.",
      "Rule sensitivity: a sweep across every non-empty subset of the risk signals.",
    ],
  });
}
