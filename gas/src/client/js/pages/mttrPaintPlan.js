// WHICH SECTIONS OF THE MTTR PAGE TO REPAINT, given what has arrived so far.
//
// The page runs two RPCs in parallel and that is deliberate, not redundant. `api_getMttr` is
// the summary alone — no trend reconstruction — so the hero, the survival curve, the
// per-severity fan, the SLA table and the open-backlog age bars land as soon as the cheap
// Kaplan-Meier summary is ready. `api_getMttrPage` carries the heavy
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
 * @returns {{hero: boolean, survival: boolean, fan: boolean, sla: boolean, aging: boolean,
 *            charts: boolean, byDomain: boolean, historyChips: boolean}}
 */
export function mttrPaintPlan({ mttr, page, pagePainted, summaryChanged, pageChanged, scoped }) {
  const nothing = {
    hero: false, survival: false, fan: false, sla: false, aging: false, charts: false,
    byDomain: false, historyChips: false,
  };
  // THE INVARIANT. Every section below reads the summary — the hero for its value, survival and
  // SLA wholly, and the charts for `rowCount` and the contribution baseline — so with no
  // summary there is nothing truthful to draw and the skeleton stands.
  if (!mttr) return nothing;

  // THE PAGE ADDS TWO THINGS TO THE HERO NOW, and only one of them is scope-sensitive.
  //
  // `trends.history` feeds the change chips, and those ARE suppressed under any scope: the
  // mttr_history snapshots are register-wide while the current values are scoped, so diffing
  // them shows a fake delta. That is what `historyChips` says, and it has not changed.
  //
  // `trends.trend` is the other one — the reconstructed half-life series the header's
  // sparkline draws — and it is SCOPED ALREADY (api.ts's `mttrTrendData` hands `loadTrend` the
  // pre-filtered base rows). This line used to read `pageChanged && historyChips`, which made
  // the hero skip its repaint on any scoped visit and left the aside painting whatever the
  // summary-only tick gave it: an empty series.
  //
  // MEASURED on the dev harness at 2026-09-07, which runs `displaySeverities: [CRITICAL,
  // HIGH]` against five selectable — so `chipsSuppressed()` is true on a plain visit, not only
  // on a hand-picked scope. `api_getMttrPage` returned 211 trend points, one of which carried
  // a `km_median_days`; the header's aside rendered the words "not measured", which is a claim
  // that nobody looked, over a series that had been computed and shipped. One reading of 211 is
  // a thin picture; "not measured" is a wrong one.
  const historyChips = Boolean(page) && !scoped;
  const heroFromPage = pageChanged && Boolean(page);

  return {
    hero: summaryChanged || heroFromPage,
    // Pure functions of the summary. Driving them from the page arrival too — as the old
    // paintFull did — was a Chart.js destroy-and-rebuild of an identical curve on every load.
    //
    // THE FAN AND THE AGING BARS ARE IN THIS GROUP, not in the page group, and that is a fact
    // about which RPC carries them rather than about where they sit on screen. Both read the
    // SUMMARY (`remediation.kmPerSev`, `remediation.aging`) — nothing on either is
    // reconstructed from scan history — so a page arrival adds nothing to them and repainting
    // would be six Chart.js destroy-and-rebuilds of identical curves plus a bar chart, for no
    // changed figure. They arrive with the hero, which is the point: `api_getMttr` is the
    // cheap RPC and every section it can honestly fill lands on its tick.
    survival: summaryChanged,
    fan: summaryChanged,
    sla: summaryChanged,
    aging: summaryChanged,
    // `pagePainted` is what covers page-arrives-first: the payload is held until a summary
    // exists, then drawn on the tick that delivers it.
    charts: Boolean(page) && (pageChanged || !pagePainted),
    byDomain: Boolean(page) && (pageChanged || !pagePainted),
    historyChips,
  };
}
