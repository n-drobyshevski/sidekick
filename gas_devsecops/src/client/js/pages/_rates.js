// The rate vocabulary, in one place instead of three.
//
// `fmtPct`, `denominatorNode`, `rateCell` and `scopeParam` were declared identically (or
// near-identically) in mttr.js, program.js and — for `scopeParam` — executive.js as well.
// None of the four reads anything app-specific; they are formatting and DOM helpers over a
// `rateView`/`boundedRateView` result, so one copy is what "one vocabulary for figures" means
// for rates specifically.
//
// `guard()` STAYS COPIED IN executive.js/mttr.js/program.js, ON PURPOSE, and does not move
// here. The `emptyStates` contract (`gas_shared/test/contracts/emptyStates.js`) pins
// `function guard(` + `render failed:` + `errorState(` inside EACH guarded route's own
// source — hoisting it would make that per-file assertion vacuous on two of the three files
// it exists to check.
//
// `fmtPct` IS NOT `pct1`. `pct1` (ui/figures.js) is the shared numeric-core percentage
// formatter used across every register's data tables; `fmtPct` is this page-pair's own,
// documented rate-in-prose format — `test/pagesProgram.test.js` pins its whole-number output
// ("0%", "50%", "25%") for a rate whose base is a round number, and collapsing the two would
// be a correctness question, not a vocabulary one. Kept here as the third deliberate format,
// alongside `fmtDays` (prose/KPI tiles) and `days1` (table cells).

import { el } from "../ui.js";

/** A percentage to one decimal. Only ever called through `rateView`/`boundedRateView`, which
 *  own the nulls — this never sees one. */
export function fmtPct(p) {
  const n = Number(p);
  return (Math.round(n * 10) / 10) + "%";
}

/**
 * A `[data-denominator]` node — every rate on the two program-lane pages is followed by one
 * of these.
 *
 * The ATTRIBUTE always carries the number, including a zero: a test and a reader who asks
 * both get the base. The visible text does not restate a zero base, because "not measured"
 * followed by "0 resolved" reads as a measurement of nothing rather than as an absence.
 */
export function denominatorNode(rate) {
  return el("span", {
    class: "small muted",
    "data-denominator": rate.denominator === null ? "none" : String(rate.denominator),
  }, rate.baseEmpty ? "— " + rate.emptyLabel : rate.denominatorLabel);
}

/**
 * A rate and its base as one cell: the figure, its interval when it has one, then the base
 * under it. `boundsText` only ever arrives on a `boundedRateView` result (program.js), so this
 * renders identically to mttr.js's old bounds-less cell wherever it is absent.
 */
export function rateCell(rate) {
  return el("span", {},
    el("span", { class: "num" }, rate.text),
    rate.boundsText ? el("span", { class: "small muted" }, " (" + rate.boundsText + ") ") : " ",
    denominatorNode(rate));
}

/** The one valid scope a deep link may narrow a scoped page to. */
export function scopeParam(params) {
  const s = params && params.scope;
  return s === "sca" || s === "sast" || s === "secrets" ? s : null;
}
