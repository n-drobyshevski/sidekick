// The rate vocabulary, ported from gas_devsecops/src/client/js/pages/_rates.js — one copy of
// `fmtPct`, `denominatorNode` and `rateCell` instead of a third hand-rolled pair growing here.
//
// WHY THIS LIVES IN `pages/`, NOT `ui/`. `gas/test/shared.test.js`'s parity contract pins
// `src/client/js/ui/` to exactly five modules — `changeChip.js`, `nvd.js`, `scopeBar.js`,
// `span.js`, `splitBar.js` — each a fact about an OS-vulnerability register that means nothing
// in a sibling. This file is neither: it is formatting and DOM helpers over a `rateView()`
// result (`./mttr.js`, ported from the same source), read by `mttr.js` and `program.js`.
// Adding it to `ui/` would grow that pinned list for a module two pages share, not a shared
// design-system primitive every register needs — `gas_devsecops` made the identical call for
// the identical reason, and this is that file, unchanged in shape.
//
// `scopeParam` DROPPED ON PURPOSE. gas_devsecops's copy carried a fourth export — "the one
// valid scope a deep link may narrow a scoped page to" (`sca`/`sast`/`secrets`). gas has no
// register scopes of that kind; its own scope is the header's domain/support-group switcher,
// read a different way on every page (`ctx.domain`/`ctx.supportGroup`) and never a `?scope=`
// param. Porting a function with no caller would be dead code from the first commit.
//
// `fmtPct` IS NOT `pct1`. `pct1` (`gas_shared/ui/figures.js`) is the shared numeric-core
// percentage formatter used across every register's data tables; `fmtPct` is this page pair's
// own prose rate format, rounded to one decimal the same way, kept separate for the same
// reason gas_devsecops keeps it separate from `pct1` there — a caller reads it only through
// `rateView`/`rateCell`, which already own the nulls, so this never sees one.

import { el } from "../ui.js";

/** A percentage to one decimal. Only ever called through `rateView`, which owns the nulls —
 *  this never sees one. */
export function fmtPct(p) {
  const n = Number(p);
  return (Math.round(n * 10) / 10) + "%";
}

/**
 * A `[data-denominator]` node — every rate that carries a `rateView` result is followed by
 * one of these.
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
 * under it. `boundsText` only ever arrives on a bounded rate view; this renders identically to
 * a bounds-less cell wherever it is absent.
 */
export function rateCell(rate) {
  return el("span", {},
    el("span", { class: "num" }, rate.text),
    rate.boundsText ? el("span", { class: "small muted" }, " (" + rate.boundsText + ") ") : " ",
    denominatorNode(rate));
}
