// WHAT MOVED THE NUMBER — the sentence, and the two tables that keep it honest.
//
// The domain half is `program.movementDecomposition`; this is the reading of it. The whole
// point of the section is a distinction a trend line cannot draw: an open count that fell
// because findings were fixed, and an open count that fell because the register stopped
// looking. So the sentence names both halves in the same breath — "N is measured remediation
// and N is administrative" — and the two tables below it are separate rather than one table
// with a column, because a total across them is the number this section exists to refuse.
//
// `outsideGate` RIDES IN THE ASIDE, NEVER IN A TABLE ROW. It is a stock (open findings
// currently outside the gate), not a flow over the window, so it cannot be added to either
// half without double-counting it on every subsequent window. It still has to be said out
// loud, because it is the exact quantity a narrowed gate hides.
//
// Pure and lifted out of the page for the reason overviewModel.js and mttrPaintPlan.js
// already are: the interesting cases here are payload shapes — an older cached payload with
// no movement block, a server that refused to compute one, a gap that must appear only when
// it is non-zero — and those are enumerable in node.

import { fmtCount, num } from "../../../../../gas_shared/ui/figures.js";

/** The five figures the sentence cannot be written without. */
const REQUIRED = ["arrivals", "observed", "bounded", "reopened", "netChange"];

/** A signed movement: direction is the point, so 0 stays bare and the minus is a real one. */
function signed(n) {
  if (n === 0) return "0";
  return (n > 0 ? "+" : "−") + Math.abs(n).toLocaleString();
}

/**
 * The section's whole content, or `{ empty }` with the server's own reason.
 *
 * The refusal comes FIRST and it is an allowlist: every figure in the sentence must already
 * be a finite number. A payload cached before this figure existed carries none of them, and
 * `Number(undefined)`-style coercion would render that as a confident "Arrivals 0, closed by
 * observation 0 … the open count moved 0" — four claims about a window nobody decomposed.
 * `movementNote` travels VERBATIM from the server because the server is the only thing that
 * knows why it declined (one scan only, no scan far enough back); a note invented here would
 * be a guess printed in the same ink as a measurement.
 */
export function movementView(movement, note) {
  const fallback = typeof note === "string" && note.trim()
    ? note
    : "No movement decomposition in this payload.";
  if (!movement || typeof movement !== "object") return { empty: fallback };
  const v = {};
  for (const k of REQUIRED) {
    const n = num(movement[k]);
    if (n === null) return { empty: fallback };
    v[k] = n;
  }
  const measured = num(movement.measured) ?? v.observed;
  const administrative = num(movement.administrative) ?? v.bounded;
  const gap = num(movement.identityGap) ?? 0;
  const outsideGate = num(movement.outsideGate) ?? 0;
  const unattributed = num(movement.unattributed) ?? 0;
  const partialCounts = num(movement.partialCounts) ?? 0;
  const skippedScans = num(movement.skippedScans) ?? 0;
  const unplacedRows = num(movement.unplacedRows) ?? 0;

  const sentences = [
    `Arrivals ${fmtCount(v.arrivals)}, closed by observation ${fmtCount(v.observed)}, `
    + `dated gone by absence ${fmtCount(v.bounded)}, returned ${fmtCount(v.reopened)}; `
    + `the open count moved ${signed(v.netChange)}. Of that movement, `
    + `${fmtCount(measured)} is measured remediation and ${fmtCount(administrative)} `
    + "is administrative.",
  ];
  // Only when it is non-zero: "the books do not balance by 0" is a sentence that trains a
  // reader to skip the line that matters.
  if (gap !== 0) {
    sentences.push(
      `The books do not balance by ${signed(gap)} — that gap is published, not hidden.`,
    );
  }
  if (outsideGate > 0) {
    sentences.push(outsideGate === 1
      ? "1 open finding sits outside the current gate and was not measured by the last scan."
      : `${fmtCount(outsideGate)} open findings sit outside the current gate and were not `
        + "measured by the last scan.");
  }

  const asideRows = [];
  const aside = (n, label) => { if (n > 0) asideRows.push({ label, count: n }); };
  aside(outsideGate, "Open, outside the last scan's severity gate");
  aside(unattributed, "Resolved in the window with no recorded provenance");
  aside(partialCounts, "Scan counts refused — not a number, so not a zero");
  aside(skippedScans, "Scans with an unreadable timestamp, placed in no window");
  aside(unplacedRows, "Rows with no readable first_seen, absent from the replay");

  return {
    sentence: sentences.join(" "),
    sentences,
    measuredRows: [{
      cause: "Closed by observation",
      basis: "the API reported the finding resolved",
      count: v.observed,
    }],
    administrativeRows: [{
      cause: "Dated gone by absence",
      basis: "the scan stopped seeing it — an upper bound on the date, not a measurement",
      count: v.bounded,
    }],
    asideRows,
  };
}
