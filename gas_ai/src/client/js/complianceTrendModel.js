// "Compliance posture over time" as pure logic: which series the header's chart draws, what
// each point's hover card has to say beside the percentage, and what the card is allowed to
// claim about the population it describes.
//
// ITS OWN MODULE, for the reason `postureTrendModel.js` states one register over: the pages
// that draw this transitively reach `chartsLoader.js` and `ui.js`, so anything exported from
// them can only be exercised inside a DOM environment. Everything here is data in, data out,
// and `test/complianceTrendModel.test.js` runs it in the pure project.
//
// WHAT IT REPLACED, AND WHAT IT HAD TO KEEP. The header's second column used to hold the
// four-segment state strip — scored / no resources / no policies / not reported, as a bar
// with a key. That bar answers "what did Wiz score", which a reader learns once, and never
// "is this getting better", which is the question a compliance register is opened with twice
// a quarter. The chart answers the second.
//
// But the strip was also the ONLY place the subcategories the register does not list were
// counted (compliancePosture.ts drops the unscored ones before the tree reaches a page), and
// a register listing twelve of twenty rows with nothing saying so is the implied confidence
// PRODUCT.md forbids. So the counts did not go away with the bar: `coverageFoot` states them
// in words under the chart, and `coverageNotes` puts the same pair on EVERY point, which is
// strictly more than the bar could say — a rising line over a shrinking denominator is the
// one way this chart could lie, and it is now visible at every point rather than only at the
// latest one.
//
// ABSENT IS NEVER ZERO, inherited whole from `postureTrendModel.js` and enforced again here.
// A framework Wiz did not score at some sync carries `null`, the line breaks there, and the
// card says so in words rather than letting a gap read as a collapse.

import { valueAt } from "./postureTrendModel.js";

/**
 * The series key the cross-framework mean travels under — `domain/complianceTrend.ts`'s
 * `LANDSCAPE_KEY`, mirrored rather than shipped.
 *
 * A hand-kept mirror, and the mirror is one string. The client bundle cannot import the
 * domain layer at all (see `getCompliance`'s own note on why `rail`/`weakestAreas` are
 * computed server-side), and `test/complianceTrendModel.test.js` asserts the two are equal
 * by reading both, which is the machinery this app already uses for every other mirror it
 * keeps (assetQuery.js, configView.js).
 */
export const LANDSCAPE_KEY = "__landscape";

/**
 * The accent every posture line is drawn in.
 *
 * ONE HUE, because these charts draw ONE series — the framework in view, or the landscape
 * mean — and a lone line needs no palette. `postureTrendModel.js`'s own cycling palette is
 * for the category chart, where six lines have to be told apart; borrowing it here would
 * make an arbitrary hue look like it meant something. This is `charts.js`'s `ACCENT`, which
 * the page cannot import (it lives in the second bundle) and so restates.
 */
export const POSTURE_LINE = "#be123c";

/** The series for the cross-framework mean — the Overview's own hero figure, over time. */
export function landscapeSeries() {
  return [{ key: LANDSCAPE_KEY, label: "Landscape mean", color: POSTURE_LINE }];
}

/** The series for one framework's own percentage. Named for the framework, never "Posture". */
export function frameworkSeries(frameworkId, name) {
  return [{ key: frameworkId, label: name || frameworkId, color: POSTURE_LINE }];
}

/**
 * THE AXIS WINDOW, and why this is a decision rather than a default.
 *
 * Compliance posture does not use the range it is measured on. A landscape anybody is
 * actually running this against sits between about 85% and 100%, so the two obvious axes
 * both fail, in opposite directions:
 *
 *   - 0-100 is honest and useless. Five sixths of the plot is empty, every framework's line
 *     is pinned to the top of the box, and a four-point slide — the whole reason to draw
 *     this at all — is a few pixels tall and invisible next to the hero percentage above it.
 *   - Chart.js's own auto-fit is the opposite failure, and the worse one. It fits the data
 *     exactly, so a line that wobbles between 94 and 95 fills the full height of the card
 *     and reads as a collapse. An axis that magnifies noise is not more informative than one
 *     that hides signal; it is a chart that lies in a more exciting way.
 *
 * So: fit the data, then PAD it, then refuse to go below a minimum span. `MIN_SPAN` is what
 * stops the magnification — 10 points of range means a one-point move is drawn as a tenth of
 * the card's height, which is a one-point move — and the pad keeps the line off the frame.
 * Both ends snap to a multiple of 5 so the ticks read as round numbers, and the window is
 * clamped into 0-100, because there is no such thing as 104% compliant.
 *
 * THE READER IS TOLD. A truncated axis is a legitimate instrument and a notorious one, and
 * the difference is entirely whether it is disclosed — so `complianceTrendView` publishes
 * `range` and `baselineNote`, and the card carries that sentence on the chart's own tip.
 * Never draw this window without publishing the baseline somewhere the reader can reach it.
 */
const MIN_SPAN = 10;
const MIN_PAD = 2;
const SNAP = 5;

export function percentRange(points, series) {
  const keys = (series || []).map((s) => s.key);
  const values = [];
  for (const p of points || []) {
    for (const key of keys) {
      const v = valueAt(p, key);
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
  }
  // Nothing to fit: the full range, which is what a chart with no data would draw anyway.
  if (!values.length) return { min: 0, max: 100 };

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(MIN_PAD, (hi - lo) * 0.15);
  let min = lo - pad;
  let max = hi + pad;

  // The floor on the span, applied BEFORE the snap and the clamp so the widening is
  // symmetrical about the data rather than lopsided by whichever edge got clamped first.
  const short = MIN_SPAN - (max - min);
  if (short > 0) {
    min -= short / 2;
    max += short / 2;
  }

  min = Math.floor(min / SNAP) * SNAP;
  max = Math.ceil(max / SNAP) * SNAP;
  if (max > 100) max = 100;
  if (min < 0) min = 0;

  // Clamping can eat the span back below the floor — a framework flat at 100% is the case,
  // where everything above it is cut away. Give the span back at whichever end has room.
  if (max - min < MIN_SPAN) {
    if (max < 100) max = Math.min(100, min + MIN_SPAN);
    if (max - min < MIN_SPAN) min = Math.max(0, max - MIN_SPAN);
  }
  return { min, max };
}

/**
 * The axis baseline, in words, or null when it is zero and there is nothing to disclose.
 *
 * THE SENTENCE THAT MAKES THE TRUNCATED AXIS LEGITIMATE. A y axis that does not start at
 * zero exaggerates every movement drawn on it, which is exactly why it is the standard way
 * to mislead with a line chart — and exactly why it is the right instrument here, where the
 * full range would hide the movement instead. What separates the two is that the reader can
 * find out: the card carries this on the chart's tip, beside the rest of what the series is
 * and is not.
 */
export function baselineNote(range) {
  const min = range && Number.isFinite(range.min) ? range.min : 0;
  if (min <= 0) return null;
  return `The axis runs ${min}%–${range.max}%, not from zero: compliance posture sits near `
    + "the top of its range, and the full scale would flatten the movement this chart is "
    + "for. Read the shape, not the height.";
}

/** One point's coverage for a series key, or null where the point recorded none. */
export function coverageAt(point, key) {
  const map = (point && point.coverage) || {};
  const entry = map[key];
  return entry && typeof entry === "object" ? entry : null;
}

/**
 * `scored of subcategories` in words, or null when the point carries no coverage.
 *
 * THE DENOMINATOR IS THE WHOLE POINT. A framework percentage is a share of the subcategories
 * Wiz scored, and the unscored ones are left out rather than counted as failures — so a line
 * that climbs because the landscape improved and one that climbs because Wiz stopped scoring
 * the failing subcategories draw identically. Stating the pair on every point is what tells
 * them apart. Same rule as `adjacencyPointNotes`' `edgesKnown`, one register over.
 */
export function coverageText(entry) {
  if (!entry) return null;
  const scored = Number(entry.scored);
  const total = Number(entry.subcategories);
  if (!Number.isFinite(scored) || !Number.isFinite(total) || total <= 0) return null;
  const lead = Number.isFinite(Number(entry.scoredFrameworks))
    ? `Mean of ${Number(entry.scoredFrameworks).toLocaleString()} scored `
      + `${Number(entry.scoredFrameworks) === 1 ? "framework" : "frameworks"}, `
    : "";
  return `${lead}${scored.toLocaleString()} of ${total.toLocaleString()} `
    + `${total === 1 ? "subcategory" : "subcategories"} scored`;
}

/** One note per POINT, in order — what `charts.js::trendLine` hangs off each hover card. */
export function coverageNotes(points, key) {
  return (points || []).map((p) => {
    const text = coverageText(coverageAt(p, key));
    return text === null ? "Coverage not recorded" : text;
  });
}

/**
 * The sentence under the chart: what the LATEST point measured, and whether the denominator
 * moved across the window.
 *
 * The second half is the one that earns the slot. A percentage over a denominator that has
 * itself changed is not comparable with the one before it, and a reader looking at a line
 * that rose eight points has no way to know that from the line.
 */
export function coverageFoot(points, key) {
  const list = (points || []).filter((p) => coverageAt(p, key));
  if (!list.length) {
    return "No sync in this window recorded how many subcategories it scored, so a change in "
      + "this line cannot be told apart from a change in what was measured.";
  }
  const last = coverageAt(list[list.length - 1], key);
  const text = coverageText(last);
  const totals = list.map((p) => Number(coverageAt(p, key).subcategories));
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const moved = max !== min
    ? ` Wiz reported between ${min.toLocaleString()} and ${max.toLocaleString()} `
      + "subcategories across this window, so two points are not shares of the same thing."
    : " The number Wiz reported did not move across this window.";
  return `Latest sync: ${text || "coverage not recorded"}.` + moved;
}

/**
 * What the card is allowed to claim about the population, given the view in force.
 *
 * REGISTER-WIDE, ALWAYS, and this is the sentence that says so. Every other figure on the
 * Compliance page narrows to the project in view — the server re-asks Wiz for it and rebuilds
 * the payload (api.ts `scopedPosture`) — but the PAST cannot be re-asked, and a history row
 * carries no asset id to re-slice by. Drawing the register's own history under a project
 * filter with nothing saying so would put the hero and the chart beside it in two different
 * populations, which is the single reading this page exists to prevent.
 *
 * Null when nothing is in view, because a permanent "register-wide" badge on a register-wide
 * page is noise rather than honesty — the rule `postureScopeView` already follows.
 */
export function trendScopeNote(postureScope) {
  const scope = postureScope || {};
  const project = String(scope.projectId || "");
  const domain = String(scope.domainId || "");
  if (!project && !domain) return null;
  return "This chart is the whole register's history. "
    + (domain
      ? "A domain narrows the rows on this page, but a past sync recorded no domain to "
      : "The figures above re-scope because Wiz re-scores them on request; a past sync "
        + "recorded no project to ")
    + "narrow by, and history cannot be re-asked.";
}

/**
 * Everything the card needs to decide what to draw, in one object — so the two pages that
 * call it cannot disagree about when a chart is honest enough to render.
 *
 * TWO POINTS IS THE FLOOR, the same floor `postureTrendCard` keeps: one point is a reading,
 * not a trend, and a single dot on a time axis invites a slope that is not there. `series` is
 * narrowed to the keys that have a number SOMEWHERE in the window — a framework collected
 * only since last week has no line before it, and an empty legend entry invites "why is that
 * line at zero".
 */
export function complianceTrendView({ points, series, postureScope } = {}) {
  const list = Array.isArray(points) ? points : [];
  const wanted = series || [];
  const present = wanted.filter((s) => list.some((p) => valueAt(p, s.key) !== null));
  const draw = list.length >= 2 && present.length > 0;
  const key = wanted.length ? wanted[0].key : null;
  // A series with a number at some points and not others: the line breaks, and the card says
  // why rather than leaving the reader to read a gap as a collapse.
  const gappy = draw && list.some((p) => valueAt(p, present[0].key) === null);
  // Fitted to what is actually drawn (`present`), never to the series that were asked for:
  // a framework with no reading in this window must not widen the window it is absent from.
  const range = percentRange(list, present);
  return {
    draw,
    points: list,
    series: present,
    range,
    baseline: draw ? baselineNote(range) : null,
    // WHY there is no chart, never a silent empty box. The three cases are genuinely
    // different and the fix for each is different: wait for the next sync, collect this
    // framework, or nothing was ever recorded.
    reason: draw
      ? null
      : list.length === 1
        ? "One sync has recorded compliance posture — the line draws from the second."
        : list.length
          // NAMED, because "nothing was recorded" and "nothing was recorded FOR THIS ONE" are
          // different facts and the reader is standing in front of a framework they chose.
          ? `No sync in this window recorded a percentage for ${wanted.length ? wanted[0].label : "this series"}.`
          : "No sync has recorded compliance posture yet. It is recorded going forward, one "
            + "point per sync, and cannot be reconstructed from what the register holds now.",
    gappy,
    notes: key ? coverageNotes(list, key) : [],
    foot: key && draw ? coverageFoot(list, key) : null,
    scopeNote: trendScopeNote(postureScope),
  };
}
