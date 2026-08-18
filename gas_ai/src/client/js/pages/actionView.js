// The Priorities page's ACTION mode, as pure functions of state — the DISPLAY-column sort,
// filtering and facets over `ActionRow` (src/domain/actions.ts). Same split as
// problemView.js, for the same reason: this is the part that is wrong in ways a screenshot
// won't show, and it is the part testable without a DOM. problems.js turns what these
// return into elements and does nothing else clever.
//
// One thing this file deliberately does NOT do — carried forward from problemView.js:10-19,
// verbatim in spirit and restated here because the stakes are higher on this table, not
// lower. `src/domain/actions.ts`'s `rankActionsByCover` is a greedy MARGINAL set-cover: on
// every round it re-scores every remaining action against the problems the ROUNDS BEFORE IT
// haven't already claimed, worst-outcome first, then remaining-problems-closed, then
// distinct-assets-touched, then key. That is not a static three-key sort a client-side
// comparator can reproduce — the "remaining problems" a round scores against shrink after
// every earlier pick, so the true rank of action #7 depends on which six actions already
// went before it. The client bundle cannot import `actions.ts` (the same wall
// problemView.js names for `compareProblems`), so this file does not attempt a client-side
// re-derivation of the cover order. What it offers instead is the same shape
// `PROBLEM_COMPARATORS` offers over problems: INDEPENDENT single-column sorts, each one a
// simple, honest fact about one field of one row, with no claim to reproduce the server's
// marginal ranking. "No sort selected" — the default on load — means "trust the cover order
// `getActions` sent", exactly as problemView.js's own rule reads.
//
// WHAT BREAKS IF SOMEONE FAKES IT. The one number this whole feature exists to be honest
// about is the headline: "N problems collapse to M actions — the top 10 close K%." That
// figure (`concentrationRatio`, `coverCurve`) is computed server-side over the TRUE cover
// order. If a client-side sort were dressed up as a "smart" default — even a plausible one,
// even one that agrees with the server on most rows — the table above the chart and the
// number in the chart would silently start describing two different rankings, and nobody
// reading the page would be able to tell which one is real. A reader who wants the cover
// order gets it by clearing every column sort, not by trusting a client-side stand-in for it.

export const OUTCOME_RANK = ["ACT", "ATTEND", "TRACK_STAR", "TRACK"];
export const KIND_VALUES = ["ISSUE", "FINDING"];

// ------------------------------------------------------------------------- filtering

/** Position on the outcome scale, worst first; undecided (`""`) sorts last — mirrors
 *  problemView.js's own `outcomeIndex` at the action's own `worstOutcome` grain. */
function outcomeIndex(o) {
  const i = OUTCOME_RANK.indexOf(String(o || "").toUpperCase());
  return i < 0 ? OUTCOME_RANK.length : i;
}

/**
 * Row-level filters over the whole ranked action list `getActions` already sent — every
 * action fits in one payload (the landscape collapses 38 problems to 12 actions on the seed
 * tenant), so unlike `applyProblemFilters` there is no server-paged half to defer to.
 */
export function applyActionFilters(rows, state) {
  const s = state || {};
  const q = String(s.q || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (s.outcome && String(r.worstOutcome || "").toUpperCase() !== s.outcome) return false;
    if (s.kind && r.kind !== s.kind) return false;
    if (q) {
      const hay = [r.title, r.ruleShortId].filter(Boolean).join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

/** The outcome and kind values actually present, for the filter pills — worst-outcome-first,
 *  mirroring `problemFilterOptions`. */
export function actionFilterOptions(rows) {
  const outcomes = new Set();
  const kinds = new Set();
  for (const r of rows || []) {
    if (r.worstOutcome) outcomes.add(String(r.worstOutcome).toUpperCase());
    if (r.kind) kinds.add(r.kind);
  }
  return {
    outcomes: OUTCOME_RANK.filter((o) => outcomes.has(o)),
    kinds: KIND_VALUES.filter((k) => kinds.has(k)),
  };
}

// ----------------------------------------------------------------------------- sorting

/**
 * Earliest-first sortable number; an action with no readable `firstSeenAt` sorts last
 * either way. `Number.MAX_SAFE_INTEGER`, not `Infinity`, for the exact reason
 * problemView.js's own `dueRank` gives: two rows that both lack a date must subtract to
 * `0`, or the comparator returns `NaN` and the sort silently stops moving that pair.
 */
function firstSeenRank(row) {
  const t = Date.parse((row && row.firstSeenAt) || "");
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/**
 * Each comparator is the column's natural FIRST-click order — worst/most first for the
 * leverage columns, A-first for the identity columns, oldest first for `firstSeen` — the
 * same shape `PROBLEM_COMPARATORS` and comboView.js's `ISSUE_COMPARATORS` both use. `dir`
 * flips it.
 */
export const ACTION_COMPARATORS = {
  priority: (a, b) => outcomeIndex(a.worstOutcome) - outcomeIndex(b.worstOutcome),
  title: (a, b) => String(a.title || "").localeCompare(String(b.title || "")),
  kind: (a, b) => String(a.kind || "").localeCompare(String(b.kind || "")),
  // The leverage figure this whole feature exists to surface — most problems closed first.
  closes: (a, b) => (b.problems || 0) - (a.problems || 0),
  assets: (a, b) => (b.assets || 0) - (a.assets || 0),
  firstSeen: (a, b) => firstSeenRank(a) - firstSeenRank(b),
};

/** Columns whose natural order reads as descending — for aria-sort and the glyph. */
export const ACTION_SORT_DESC = { priority: true, closes: true, assets: true };

export function sortActions(rows, key, dir) {
  const cmp = ACTION_COMPARATORS[key];
  const list = (rows || []).slice();
  if (!cmp) return list;
  const sign = dir === -1 ? -1 : 1;
  return list.sort((a, b) => {
    const d = cmp(a, b) * sign;
    if (d !== 0) return d;
    // A stable tiebreak, so a re-sort of equal rows never reshuffles them under the eye —
    // the same idiom `sortProblems` and `sortIssues` both close with. `key` (the
    // `ActionKey`) is the field to break on here: an `ActionRow` carries no asset name of
    // its own to fall back to the way a `ProblemRow` does, but `key` is guaranteed unique
    // per action (`actions.ts`'s own `actionKeyOf`), so it is a total order all by itself.
    return String(a.key || "").localeCompare(String(b.key || ""));
  });
}
