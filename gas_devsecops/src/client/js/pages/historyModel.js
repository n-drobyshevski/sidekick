// WHAT MOVED THE NUMBER — the sentence, the picture, and the split that keeps both honest.
//
// The domain half is `domain/movementDecomposition.ts`; this is the reading of it. The whole
// point of the section is a distinction a trend line cannot draw: an open count that fell
// because findings were fixed, and an open count that fell because the register stopped
// looking. So both readings name both halves — `movementView`'s sentence in one breath ("N is
// measured remediation and N is administrative"), `movementBarsModel`'s four rows by carrying
// the half's name on the row itself — and neither ever offers a total across them, because
// that total is the number this section exists to refuse.
//
// TWO READINGS, ONE REFUSAL. The two are drawn side by side for the same register, so they
// share `readFigures`: a payload one could read and the other could not would put a chart
// under an empty-branch notice, or an empty chart under a sentence. The words are still
// built even where the picture is what is drawn — the page prints the gap clause and the
// gate clause from `movementView`, because those are honesty rather than arithmetic and a
// bar chart has nowhere to put them.
//
// `outsideGate` RIDES IN THE ASIDE, NEVER IN A TABLE ROW. It is a stock (open findings
// currently outside the gate), not a flow over the window, so it cannot be added to either
// half without double-counting it on every subsequent window. It still has to be said out
// loud, because it is the exact quantity a narrowed gate hides.
//
// ONE BLOCK PER REGISTER, and the empty branch is per register too. Three scopes share one
// scans tab here, so `sca` can have a 28-day window on the same day `sast` has one scan and
// nothing to compare it against — and the note that says which is the SERVER's, verbatim,
// because the server is the only thing that knows why it declined.
//
// Pure and lifted out of the page for the reason `registerModel.js` and `accessModel.js`
// already are: the interesting cases here are payload shapes — an older cached payload with
// no movement block, a server that refused to compute one, a gap that must appear only when
// it is non-zero — and those are enumerable in node.

import { fmtCount, num } from "../../../../../gas_shared/ui/figures.js";

/** The five figures the sentence cannot be written without. */
const REQUIRED = ["arrivals", "observed", "bounded", "reopened", "netChange"];

/** A signed movement: direction is the point, so 0 stays bare and the minus is a real one. */
function signed(n) {
  if (n === 0) return "0";
  return (n > 0 ? "+" : "−") + fmtCount(Math.abs(n));
}

/**
 * The five figures, refused as a set — or null.
 *
 * ONE REFUSAL, TWO READINGS. `movementView` (the words) and `movementBarsModel` (the picture)
 * are drawn side by side for the same register, so a payload one of them can read and the
 * other cannot would print a sentence over an empty chart, or a chart under an empty-branch
 * notice. Lifted here so there is one allowlist rather than two that agree by accident — the
 * failure CLAUDE.md calls "an ordering two packages agreed on and nothing held".
 *
 * It is an ALLOWLIST, and it comes first: a payload cached before this figure existed carries
 * none of these keys, and `Number(undefined)`-style coercion would render that as a confident
 * "Arrivals 0, closed by observation 0 … the open count moved 0" — four claims about a window
 * nobody decomposed.
 */
function readFigures(movement) {
  if (!movement || typeof movement !== "object") return null;
  const v = {};
  for (const k of REQUIRED) {
    const n = num(movement[k]);
    if (n === null) return null;
    v[k] = n;
  }
  return v;
}

/**
 * One register's section content, or `{ empty }` with the server's own reason.
 *
 * `movementNote` travels VERBATIM from the server because the server is the only thing that
 * knows why it declined (one scan only, no scan of THIS register far enough back); a note
 * invented here would be a guess printed in the same ink as a measurement.
 */
export function movementView(movement, note) {
  const fallback = typeof note === "string" && note.trim()
    ? note
    : "No movement decomposition in this payload.";
  const v = readFigures(movement);
  if (!v) return { empty: fallback };
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

/**
 * THE FOUR CAUSES AS ONE SIGNED SERIES — the array the chart and its figures table share.
 *
 * WHAT IT REPLACES, per register: a 32-word sentence naming six figures and two three-column
 * tables under it. The sentence is still built (`movementView` above is untouched, and the
 * page still prints its gap and gate clauses, which are honesty rather than arithmetic); what
 * this adds is the same six figures as a shape. Arrivals and returns push the open count UP,
 * so they are positive; closures and disappearances pull it DOWN, so they are negative; the
 * net is what is left, and `charts.movementBars` direct-labels it on the zero rule.
 *
 * THE SIGN IS THE MODEL'S, NOT THE CHART'S. A wrapper that negated two of four rows itself
 * would be a second place the direction is decided, and the figures TABLE hanging off the
 * canvas reads the same array — so a reader comparing the table to the bars would be
 * comparing two derivations. `value` is signed here, once; `count` stays the magnitude the
 * server reported, because "40 findings closed" is what the row is about and −40 is what it
 * did to the count.
 *
 * THE TWO HALVES ARE NOT SUMMED, and the row order is what keeps them legible: the two
 * additions, then the measured removal, then the administrative one. `half` names which is
 * which in words on every row, so neither the chart's y axis nor the table needs a colour to
 * say it — the section exists to refuse a total across "the API said this was fixed" and "the
 * scan stopped seeing it", and a shape that invited one would be worse than the tables were.
 *
 * Null when the payload cannot be read, on the SAME allowlist `movementView` refuses on
 * (`readFigures`), so the picture and the words can never disagree about whether there is a
 * window here at all.
 */
export function movementBarsModel(movement) {
  const v = readFigures(movement);
  if (!v) return null;
  const measured = num(movement.measured) ?? v.observed;
  const administrative = num(movement.administrative) ?? v.bounded;
  return {
    rows: [
      {
        cause: "Arrivals",
        half: "Added",
        basis: "first seen inside the window by a scan of this register",
        count: v.arrivals,
        value: v.arrivals,
      },
      {
        cause: "Returned",
        half: "Added",
        basis: "seen again after it had been resolved — its clock restarted",
        count: v.reopened,
        value: v.reopened,
      },
      {
        cause: "Closed by observation",
        half: "Measured remediation",
        basis: "the API reported the finding resolved",
        count: v.observed,
        value: -v.observed || 0,
      },
      {
        cause: "Dated gone by absence",
        half: "Administrative",
        basis: "the scan stopped seeing it — an upper bound on the date, not a measurement",
        count: v.bounded,
        value: -v.bounded || 0,
      },
    ],
    net: v.netChange,
    netLabel: signed(v.netChange),
    measured,
    administrative,
    // The one line the register's card keeps on the surface: which way the count went, and
    // how much of that move anybody actually observed. Every figure in it is in the chart too
    // — as a bar, as a direct label, or as the rule's own label — so this is a summary, never
    // the only carrier.
    headline: `Open moved ${signed(v.netChange)} · measured remediation `
      + `${fmtCount(measured)} · administrative ${fmtCount(administrative)}`,
  };
}

/**
 * The three blocks the section draws, in register order.
 *
 * `movement` and `movementNote` are objects keyed by scope; a payload that predates this
 * figure has neither, and each register then falls to its own empty branch rather than the
 * section disappearing. The order is the page's own SCOPE_LABELS order, passed in, so this
 * module does not grow a second copy of the register list.
 */
export function movementBlocks(payload, labels) {
  const movement = (payload && payload.movement) || {};
  const notes = (payload && payload.movementNote) || {};
  return Object.keys(labels).map((scope) => ({
    scope,
    label: labels[scope],
    view: movementView(movement[scope], notes[scope]),
  }));
}
