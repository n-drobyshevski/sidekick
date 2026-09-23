// The open backlog's present/unobserved split — one shape, read on every page that shows an
// open count, off `BacklogSplit` (`insights.backlogSplit`, `src/domain/insights.ts`).
//
// WHAT THIS IS FOR. Half this register's open rows can sit on an asset the scanner has not
// answered for in weeks — still open, because `coldZone.ts` is right to refuse calling a
// finding fixed just because it went quiet, but not live exposure either. `observed` is the
// rows a reader can act on today; `unobserved` is the rows nobody can currently confirm either
// way. Every figure that used to fold the two together now counts them apart, and this module
// is the one place that turns the split into words — so the hero on Executive, the hero on
// MTTR, the open-count strip on Overview and the two "open findings by age" charts all say it
// in the same voice, in the cold zone's own vocabulary ("unobserved", never "resolved", never
// silence).
//
// THE COPY IS FIXED, not styled per caller: the split LINE ("N present · M unobserved since
// <date>") and the shared CAPTION explaining what "counted apart" means. A caller that wants
// only the count for a footer sentence of its own (the oldest-open panel's link to the cold
// zone) reads `unobserved`/`assets` off the view directly rather than this module inventing a
// second sentence shape for one caller.
//
// HIDES CLEANLY WHEN THERE IS NOTHING UNOBSERVED. `show` is false whenever `unobserved` is 0 —
// including a payload with no `backlog` block at all (an older cache, or a page that has not
// loaded yet) — and every caller checks it before drawing anything, so a register with no
// blind spot renders exactly as it did before this package existed.

import { fmtCount, fmtDate, num, pluralize } from "../ui.js";

/**
 * @param {{observed?: number, unobserved?: number, unobservedAssets?: number,
 *          unobservedSince?: string|null}|null|undefined} backlog  `insights.backlogSplit`'s
 *   shape, as shipped on `insightsData()` / `mttrData()`.
 * @returns {{show: boolean, observed: number, unobserved: number, assets: number,
 *            sinceIso: string|null, line: string|null, caption: string|null}}
 */
export function backlogSplitView(backlog) {
  const observed = num(backlog && backlog.observed, 0);
  const unobserved = num(backlog && backlog.unobserved, 0);
  if (!unobserved) {
    return {
      show: false, observed, unobserved: 0, assets: 0, sinceIso: null, line: null, caption: null,
    };
  }
  const assets = num(backlog.unobservedAssets, 0);
  // Null when every unobserved row's `last_seen` failed to parse — an edge the domain layer
  // guards against but a formatter still has to answer for. Dropping the clause rather than
  // printing "since —" keeps the sentence readable without asserting a date nobody has.
  const sinceIso = (backlog && backlog.unobservedSince) || null;
  const since = sinceIso ? fmtDate(sinceIso) : null;
  return {
    show: true,
    observed,
    unobserved,
    assets,
    sinceIso,
    // "N present · M unobserved since <date>" — fixed at plan time.
    line: fmtCount(observed) + " present · " + fmtCount(unobserved) + " unobserved"
      + (since ? " since " + since : ""),
    // The shared caption, fixed at plan time, word for word — "have" agrees with the plural
    // the fixed copy was written against; a one-finding blind spot (rare, but not impossible)
    // takes "has" rather than repeat the plural verb over a singular subject.
    caption: fmtCount(unobserved) + " " + pluralize(unobserved, "finding") + " on "
      + fmtCount(assets) + " " + pluralize(assets, "asset")
      + (unobserved === 1 ? " has" : " have") + " not been in a scan"
      + (since ? " since " + since : "") + ". Counted apart: the scanner has not answered for "
      + "them, which is not the same as nobody fixing them.",
  };
}

/**
 * The oldest-open panel's one sentence: how many further open findings the ranking above it
 * left out because they are unobserved, never ranked as "oldest" among rows a reader can act
 * on today (see `insights.oldestOpen`'s own `openAge`). Null when there is nothing to say —
 * the panel then looks exactly as it did before this package.
 *
 * @param {number|null|undefined} unobserved
 */
export function oldestUnobservedNote(unobserved) {
  const n = num(unobserved, 0);
  if (!n) return null;
  return fmtCount(n) + " more open " + pluralize(n, "finding") + " "
    + (n === 1 ? "is" : "are") + " unobserved and not ranked here.";
}
