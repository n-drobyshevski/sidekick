// WHICH SECTIONS OF THE MTTR PAGE TO REPAINT, given what has arrived so far.
//
// The page runs two RPCs in parallel and that is deliberate, not redundant. `api_getMttr` is
// the summary alone — no trend reconstruction — so the hero, survival curve and SLA table land
// as soon as the cheap Kaplan-Meier summary is ready. `api_getMttrPage` carries the heavy
// slices (the per-point KM replay over reconstructed history, and the per-group split) and
// fills the chart cards, the by-domain section, and the hero's history-based change chips.
//
// What WAS redundant is that `getMttrPage` also returned the summary, byte-identical to the
// other RPC's whole payload — 9,372 bytes on the seeded estate, two Kaplan-Meier curves
// included, serialized and transferred twice per load. Worse, on a cold cache the two are
// separate GAS executions, so both computed it. The page now composes: the summary comes from
// its own RPC, and `getMttrPage` ships only what nothing else carries.
//
// THE ORDERING HAZARD IS THE WHOLE REASON THIS IS A PURE FUNCTION. Once the page payload no
// longer carries a summary, a paint driven by its arrival can run with no summary in hand —
// and it genuinely can arrive first, when the page entry is warm and the summary is cold, or
// when a stale-while-revalidate revisit resolves the cached page instantly. `mttr` being
// present is now the load-bearing invariant, replacing the old `fullDone` flag.
//
// Awaiting the summary promise inside the page handler would have been the obvious fix and is
// wrong: `swrCall` fires its callback again on every revalidation, independently per RPC, so
// an awaited promise pins the charts to the FIRST summary forever and a later summary would
// repaint the hero from data the charts no longer agree with. Two latest-value slots and a
// reducer keep each section reading the newest of its own inputs.
//
// Pure and lifted out of the page so the interleavings can be enumerated in node — the split
// scanProgress.js, capacity.js and pages/executive.js already use.

/**
 * @param {object} s
 * @param {object|null} s.mttr          latest api_getMttr payload, or null if none has landed
 * @param {object|null} s.page          latest api_getMttrPage payload {trends, byDomain}
 * @param {boolean} s.pagePainted       whether the page slices have ever been drawn
 * @param {boolean} s.summaryChanged    this tick delivered a new summary
 * @param {boolean} s.pageChanged       this tick delivered a new page payload
 * @param {boolean} [s.scoped]          any scope in force — suppresses the history chips
 * @returns {{hero: boolean, survival: boolean, sla: boolean, charts: boolean,
 *            byDomain: boolean, historyChips: boolean}}
 */
export function mttrPaintPlan({ mttr, page, pagePainted, summaryChanged, pageChanged, scoped }) {
  const nothing = {
    hero: false, survival: false, sla: false, charts: false, byDomain: false, historyChips: false,
  };
  // THE INVARIANT. Every section below reads the summary — the hero for its value, survival and
  // SLA wholly, and the charts for `rowCount` and the contribution baseline — so with no
  // summary there is nothing truthful to draw and the skeleton stands.
  if (!mttr) return nothing;

  // The page adds exactly one thing to the hero: `trends.history`, which feeds the change
  // chips. Those are suppressed under any scope, because the mttr_history snapshots are
  // register-wide while the current values are scoped, and diffing them shows a fake delta.
  // So under a scope a page arrival adds nothing to the hero and need not repaint it.
  const historyChips = Boolean(page) && !scoped;
  const heroFromPage = pageChanged && historyChips;

  return {
    hero: summaryChanged || heroFromPage,
    // Pure functions of the summary. Driving them from the page arrival too — as the old
    // paintFull did — was a Chart.js destroy-and-rebuild of an identical curve on every load.
    survival: summaryChanged,
    sla: summaryChanged,
    // `pagePainted` is what covers page-arrives-first: the payload is held until a summary
    // exists, then drawn on the tick that delivers it.
    charts: Boolean(page) && (pageChanged || !pagePainted),
    byDomain: Boolean(page) && (pageChanged || !pagePainted),
    historyChips,
  };
}
