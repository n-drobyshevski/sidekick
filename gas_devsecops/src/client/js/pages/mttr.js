// MTTR & SLA — how long a finding actually lives, once you stop discarding everything that
// is still open.
//
// THE CLOCK IS THE PRODUCT, AND A CLOCK HAS TO SAY WHERE IT STARTED (PRODUCT.md's sixth
// principle). Every figure on this page states what it measured from and what it did with
// the rows it could not measure:
//
//   * the survival estimate keeps still-open findings as RIGHT-CENSORED observations rather
//     than dropping them, and the censored count is printed beside the estimate;
//   * where the curve never falls to half there is no median, so `medianLowerBound` is
//     published as "at least N days" and flagged as a bound — `kmHalfLifeView` below is the
//     one place that decision is made, for this page AND for Executive, which imports it;
//   * every rate carries a visible denominator node, because a percentage whose base is
//     invisible is the failure this register exists to avoid.
//
// THE SECOND CLOCK IS SCA-ONLY AND SAYS SO IN ITS OWN HEADING. `ledgerCore.baseRows`
// collapses `fix_available_at` onto `first_seen` for sast and secrets — they have no vendor
// to wait on — so `mttr_actionable_days === mttr_days` and `awaiting_vendor_fix === false`
// there BY CONSTRUCTION. The server already refuses to average it across three scopes
// (`readModels.buildMttr` computes `remediation.actionable` over sca rows only and ships
// `scope`, `rowCount` and `notMeasured` with it); `actionableClockView` refuses the same
// framing on the client, loudly, rather than trusting a caller to remember.
//
// THE PER-SEVERITY CURVES ARE ON THE WIRE. `remediation.kmPerSev` carries one `shipKM`-
// narrowed Kaplan-Meier curve per severity, from the SAME `kaplanMeier(rs)` call that
// produces `kmMedianPerSev` / `kmP90PerSev` / `kmLowerBoundPerSev` — so the fan of small
// multiples and the summary table under it are two views of one estimate rather than two
// estimates. This header used to say the opposite, and the per-severity view was three fixed
// statistics for that reason; three statistics cannot show that CRITICAL closes fast and then
// stalls, or that LOW never moves.
//
// WHAT THE PAYLOAD STILL DOES NOT CARRY. `shipKM` narrows every curve to `{t, s}`: `atRisk`
// and `events` do not travel, which is why `survivalTableModel` publishes three columns here
// and five on the secrets page. It also drops `naiveMedian` / `naiveMean`, so every survival
// chart on this page draws the two Kaplan-Meier markers and no closed-only comparison.

import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
// The severity palette is READ OFF THE STYLESHEET, never retyped — CLAUDE.md's "byte-identical
// across all four surfaces" rule. `sevPalette` is defined once in `sca.js`; `sast.js` already
// imports it from there, and this is the same import rather than a second copy.
import { agingTableModel, sevPalette } from "./sca.js";
// `fmtPct`, `denominatorNode`, `rateCell` and `scopeParam` used to be DEFINED here. They now
// live in `./_rates.js` — the same four helpers program.js declared byte-for-byte
// (fmtPct/denominatorNode/scopeParam) or near-identically (rateCell, which there also renders
// a `boundsText`). See that module's header for why `fmtPct` stays its own format rather than
// collapsing onto `pct1`.
import { denominatorNode, fmtPct, rateCell, scopeParam } from "./_rates.js";
import {
  absentText, axisBar, axisSegments, chartTable, chartTableModel, clear, dataTable, el,
  emptyState, errorState, firstRunNotice, fmtCount, fmtDays, heroStat, kpiCard, meter, num,
  onPageTeardown, pageHeader, pluralize, sectionLabel, sevBadge, sevEntries, sevSegmentBar,
  skeleton, sparkLabel, sparkPath, sparkline, statRow, survivalTableModel, tipLabel,
} from "../ui.js";

// ---------------------------------------------------------------------------- formatting
//
// `fmtDays` and `fmtCount` used to be DEFINED here. They now live in `ui/figures.js`, the one
// shared implementation every page in this package imports — this file re-exports both
// because `test/pagesProgram.test.js` (which this package may not edit) imports them from
// here by name, and `executive.js` and `program.js` also keep importing them from this file
// rather than from `../ui.js` directly. `fmtDays`'s prose format ("41 days", "3.2 days") is
// distinct from `ui/figures.js`'s `days1` ("41.0 d") — see that module's header for why both
// exist.
export { fmtCount, fmtDays };

// ------------------------------------------------------------------------- view models

/**
 * The half-life decision, in ONE place, for every surface that draws it.
 *
 * Three outcomes, three different claims:
 *
 *   median present         "41 days"           a measured median
 *   median null + bound    "at least 41 days"  the curve never reached half. The bound is the
 *                                              longest observation, so the median is at LEAST
 *                                              that far out. `isLowerBound` is true.
 *   neither                "Not measured"      nothing to rest on. NOT zero.
 *
 * Rendering the middle case as a bare number would publish a median nobody observed;
 * collapsing it to a dash would throw away a true statement. So it is published, prefixed,
 * and flagged — and the flag is what a caller styles or captions off, never the string.
 *
 * @param {object|null|undefined} km  a shipped KMResult (`{median, medianLowerBound, …}`)
 * @returns {{measured: boolean, value: string, isLowerBound: boolean, days: number|null}}
 */
export function kmHalfLifeView(km) {
  const median = km && km.median !== null && km.median !== undefined ? Number(km.median) : null;
  const bound = km && km.medianLowerBound !== null && km.medianLowerBound !== undefined
    ? Number(km.medianLowerBound)
    : null;
  if (median !== null && Number.isFinite(median)) {
    return { measured: true, value: fmtDays(median), isLowerBound: false, days: median };
  }
  if (bound !== null && Number.isFinite(bound)) {
    return {
      measured: true,
      value: "at least " + fmtDays(bound),
      isLowerBound: true,
      days: bound,
    };
  }
  return { measured: false, value: "Not measured", isLowerBound: false, days: null };
}

/**
 * A rate and the base it was taken over, as one object.
 *
 * A DENOMINATOR OF ZERO IS NOT A ZERO PERCENT. `num / 0` is not a rate at all, and both
 * `NaN%` and a confident `0%` would be claims about a population that does not exist. So the
 * text degrades to "not measured" and `measured` is false, while `denominator` and
 * `denominatorLabel` still travel — the reader is told what the figure would have been taken
 * over, which is the part that makes the absence legible.
 *
 * Every rate on this page goes through here, and every rendered rate puts
 * `denominator`/`denominatorLabel` into a `[data-denominator]` node beside the figure.
 *
 * A BASE OF ZERO IS ITS OWN CASE, and `baseEmpty` is why. `denominatorLabel` is written by
 * the caller as a count plus a noun — `"0 resolved"`, `"0 open findings"` — so on an unread
 * ledger the rendered sentence came out as "not measured 0 resolved": an unmeasured claim
 * with a number glued to it, which a reader reads as data. PRODUCT.md's corollary is exact
 * — never a zero that means "unknown" — so where the base is empty the renderer uses
 * `emptyLabel`, which names the missing population WITHOUT restating its size. The
 * denominator itself still travels in `denominator` and in the `[data-denominator]`
 * attribute, so nothing is lost to a test or to a reader who asks.
 *
 * `measured: false` with a base that DOES exist (`rateView(undefined, 12, …)`) is a different
 * state — the server did not compute the rate over a population that is really there — and
 * keeps the caller's label, because there the number is a fact.
 *
 * @param {number|null|undefined} pct  a percentage the server already computed, or null
 * @param {number} denominator         the base it was taken over
 * @param {string} denominatorLabel    what that base counts, in words
 * @param {string} [emptyLabel]        what to say instead when that base is empty
 */
export function rateView(pct, denominator, denominatorLabel, emptyLabel) {
  const den = Number(denominator);
  const value = pct === null || pct === undefined ? null : Number(pct);
  const hasBase = Number.isFinite(den) && den > 0;
  const usable = hasBase && value !== null && Number.isFinite(value);
  return {
    measured: usable,
    value: usable ? value : null,
    text: usable ? fmtPct(value) : "not measured",
    denominator: Number.isFinite(den) ? den : null,
    denominatorLabel,
    baseEmpty: !hasBase,
    emptyLabel: emptyLabel || "nothing has been measured to take it over",
  };
}

/**
 * P90, and the sub-line it is allowed to carry.
 *
 * "nine in ten close by here" WAS PRINTED UNDER AN EM DASH, on the seeded page as well as
 * the empty one — a sentence describing a value that is not there. The two absences are not
 * the same absence and the caption says which:
 *
 *   p90 present        "41 days"  "nine in ten close by here"
 *   events, no p90     "—"        the curve never reached nine in ten inside the window
 *   no events at all   "—"        nothing has closed, so there is no percentile to place
 *
 * The middle case is the normal state of this register — the same reason the hero publishes
 * a lower bound instead of a median — and it is a statement about the WINDOW, not about the
 * findings. Collapsing the two would say "nothing closed" over a register where 138 things
 * did.
 */
export function kmP90View(km) {
  // `num`, not `Number`. `Number("")` is 0 and 0 is finite, so a blank P90 arriving from a
  // hand-edited cell would have rendered "0 days" under "nine in ten close by here" — the
  // exact shape CLAUDE.md names, one line below a comment about not doing it.
  const raw = num(km && km.p90);
  const events = num(km && km.events, 0);
  if (raw !== null) {
    return { measured: true, value: fmtDays(raw), days: raw, note: "nine in ten close by here" };
  }
  return {
    measured: false,
    value: absentText,
    days: null,
    note: events > 0
      ? "the curve never reaches nine in ten inside the observed window"
      : "nothing has closed yet, so there is no percentile to place",
  };
}

/** The hero: the register's half-life, with the estimator's own three counts beside it. */
export function mttrHeroView(mttr) {
  const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
  const half = kmHalfLifeView(km);
  const events = Number((km && km.events) || 0);
  const censored = Number((km && km.censored) || 0);
  const total = Number((km && km.total) || 0);
  return {
    ...half,
    events,
    censored,
    total,
    rowCount: Number((mttr && mttr.rowCount) || 0),
    // The censored count IS the qualifier — the estimate is only honest because those rows
    // stayed in, so the page never prints the number without them.
    qualifier: total
      ? fmtCount(total) + " observations · " + fmtCount(events) + " closed (events) · "
        + fmtCount(censored) + " still open (censored)"
      : "No observations yet.",
  };
}

/**
 * The half-life trend, as ONE array read by two things.
 *
 * `renderTrend` plots it as a line at the bottom of the page; `renderHero` draws the same
 * readings as a `sparkline` in the header's aside slot, because "297 days" over a half-life
 * that has been falling for four readings is a different fact from the same 297 over one that
 * doubled — and the trend was already on the wire. `ui/chartTable.js`'s one rule is that a
 * picture and its table are handed the SAME array; the same reasoning covers two pictures, so
 * the filter lives here and `paint` passes the result to both rather than each deriving its
 * own.
 *
 * A slot with no `date` is dropped rather than plotted: the x axis is the date.
 */
export function halfLifeTrendPoints(trends) {
  const raw = trends && Array.isArray(trends.trend) ? trends.trend : [];
  return raw.filter((p) => p && p.date);
}

/** The restricted mean, and the "≥" it earns when survival never reached zero. */
export function rmstView(km) {
  const mean = km && km.mean !== null && km.mean !== undefined ? Number(km.mean) : null;
  if (mean === null || !Number.isFinite(mean)) {
    return { measured: false, text: "Not measured", truncated: false, restrictionTime: null };
  }
  const truncated = !!(km && km.meanTruncated);
  return {
    measured: true,
    truncated,
    text: (truncated ? "≥ " : "") + fmtDays(mean),
    restrictionTime: km && km.restrictionTime !== null && km.restrictionTime !== undefined
      ? Number(km.restrictionTime)
      : null,
  };
}

/**
 * The remediation clock per severity: the Kaplan-Meier statistics, not the naive closed-only
 * ones. `kmLowerBoundPerSev` is shipped alongside `kmMedianPerSev`, so a severity whose curve
 * never falls to half gets "at least N days" here too rather than a dash.
 */
export function mttrSeverityRows(mttr, order) {
  const rem = (mttr && mttr.remediation) || {};
  const perSev = (mttr && mttr.perSev) || {};
  const medians = rem.kmMedianPerSev || {};
  const bounds = rem.kmLowerBoundPerSev || {};
  const p90s = rem.kmP90PerSev || {};
  const levels = (order || []).concat(["UNKNOWN"]).filter((s, i, a) => a.indexOf(s) === i);
  return levels
    .filter((sev) => perSev[sev] || medians[sev] !== undefined)
    .map((sev) => {
      const s = perSev[sev] || {};
      const half = kmHalfLifeView({
        median: medians[sev] === undefined ? null : medians[sev],
        medianLowerBound: bounds[sev] === undefined ? null : bounds[sev],
      });
      return {
        sev,
        half,
        p90: p90s[sev] === undefined ? null : p90s[sev],
        resolved: Number(s.resolved || 0),
        open: Number(s.open || 0),
      };
    });
}

/**
 * One small-multiple card per severity: the curve, its colour, and the sentence that has to
 * carry the card if the colour cannot.
 *
 * THE COLOUR IS NEVER THE ONLY CUE, and on a grid of six curves that rule bites hardest —
 * the red/orange/amber severity band is a measured colourblind risk (HIGH and MEDIUM sit 1.6
 * apart under deuteranopia). So every card carries the severity BADGE (dot plus the word) and
 * a caption that states the half-life in words. A reader who sees no colour at all reads the
 * same six facts.
 *
 * `caption` says "at least N days" wherever the median is absent and a bound is not — the
 * middle case `kmHalfLifeView` exists for, restated per card because a card is read on its
 * own and "—" beside a drawn curve reads as a broken chart rather than as a censored one.
 *
 * A SEVERITY WITH NO CURVE IS SKIPPED RATHER THAN DRAWN EMPTY. `kmPerSev` only holds the
 * severities that had rows, and a severity whose curve came back with no steps has nothing to
 * plot — an axis with no staircase asserts "measured, and flat", which is a different claim
 * from "nothing here".
 *
 * @param {object|null|undefined} remediation  `mttr.remediation`
 * @param {string[]} order                     SEVERITY_ORDER
 */
export function severityCurvesView(remediation, order) {
  const per = (remediation && remediation.kmPerSev) || {};
  const levels = (order || []).concat(["UNKNOWN"]).filter((s, i, a) => a.indexOf(s) === i);
  return levels
    .filter((sev) => {
      const km = per[sev];
      return !!km && Array.isArray(km.curve) && km.curve.length > 0;
    })
    .map((sev) => {
      const km = per[sev];
      const half = kmHalfLifeView(km);
      const events = Number(km.events || 0);
      const censored = Number(km.censored || 0);
      return {
        sev,
        curve: km.curve,
        median: km.median === undefined ? null : km.median,
        mean: km.mean === undefined ? null : km.mean,
        half,
        events,
        censored,
        total: Number(km.total || 0),
        caption: (half.measured ? "Half-life " + half.value : "Half-life not measured")
          + ". " + fmtCount(events) + " " + pluralize(events, "event") + ", "
          + fmtCount(censored) + " censored.",
      };
    });
}

/** `insights.AGE_BUCKET_LABELS`, mirrored — the client cannot import the TypeScript domain.
 *  Only a FALLBACK: the server ships `remediation.aging.labels` from the same constant, and
 *  `agingView` prefers what it was sent so a bucket edit reaches the page from one place. */
export const AGE_BUCKET_LABELS = ["0-7d", "8-30d", "31-90d", "90+d"];

/** How each severity's SLA deadline reads against a bucket boundary. `exact` severities sit
 *  ON an edge (7 / 30 / 90), so everything to the right of their bucket is wholly late; the
 *  other two land mid-bucket and their own bucket is part in, part out. */
const SLA_EDGE_WORDS = ["the first bucket", "the 8-30d bucket", "the 31-90d bucket", "the 90+d bucket"];

/**
 * Open findings by age, against the per-severity SLA edge.
 *
 * WHY THIS SECTION EXISTS BESIDE "SLA by severity". That table is the same open population
 * reduced to one ratio per severity, and a ratio cannot say whether the breaches are eight
 * days late or eight hundred. Two of the vendors surveyed for this register publish the
 * distribution (GitLab's "Vulnerabilities by age", Sonatype Lifecycle's MTTR-by-month);
 * everyone else compresses it to the compliance percentage this page already prints.
 *
 * THE EDGE IS PER SEVERITY, WHICH IS WHY THERE IS USUALLY NO SINGLE LINE TO DRAW.
 * `SLA_TARGETS` is 7 / 14 / 30 / 90 / 180 days, so CRITICAL's deadline falls at the end of
 * the first bar and INFO's past the end of the last one. `charts.js::stackedAgeBar` takes ONE
 * `slaEdgeAfter` index, so a rule is emitted only when every severity drawn agrees on it AND
 * that shared edge is exact — otherwise one drawn line would claim an edge five sixths of
 * the chart does not have. The per-severity sentences and the table's "Past SLA for" column
 * carry it in every other case, which is also the non-colour route to the same fact.
 *
 * `unaged` IS A ROW COUNT, NOT A ZERO. The server counts open findings with no readable
 * `first_seen` separately rather than bucketing them as young; `sum(row.total) + unaged` is
 * the open population, and the caption prints the remainder whenever it is non-zero.
 */
export function agingView(remediation, order) {
  const aging = (remediation && remediation.aging) || {};
  const perSev = aging.perSev || {};
  const labels = Array.isArray(aging.labels) && aging.labels.length
    ? aging.labels.slice()
    : AGE_BUCKET_LABELS.slice();
  const slaEdge = aging.slaEdge || {};
  const slaTargets = aging.slaTargets || {};
  const slaEdgeExact = aging.slaEdgeExact || {};
  const unaged = num(aging.unaged, 0);
  const totalOpen = num(aging.totalOpen, 0);

  // The same filter `stackedAgeBar` applies to its datasets (`order.filter((s) => perSev[s])`),
  // so the table lists the bars that were drawn and no others.
  const sevs = (order || []).concat(["UNKNOWN"])
    .filter((s, i, a) => a.indexOf(s) === i)
    .filter((s) => perSev[s]);

  const edgeOf = (sev) => {
    const e = num(slaEdge[sev]);
    return e === null ? null : e;
  };

  const rows = labels.map((label, i) => {
    const counts = {};
    let total = 0;
    let totalKnown = true;
    for (const sev of sevs) {
      const v = num((perSev[sev] || [])[i]);
      counts[sev] = v;
      // A total is only a total if every cell in the row was measured. Summing a null as a
      // zero to keep the column tidy is the exact move `ui/figures.js` exists to refuse.
      if (v === null) totalKnown = false;
      else total += v;
    }
    return {
      label,
      counts,
      total: totalKnown ? total : null,
      // Severities for which EVERY finding in this bucket is already past its deadline.
      breaches: sevs.filter((sev) => {
        const e = edgeOf(sev);
        return e !== null && i > e;
      }),
    };
  });

  const edges = sevs.map((sev) => {
    const bucket = edgeOf(sev);
    const target = num(slaTargets[sev]);
    const exact = slaEdgeExact[sev] === true;
    return {
      sev,
      target,
      bucket,
      exact,
      sentence: bucket === null || target === null
        ? sev + " has no SLA target, so no edge is stated for it."
        : sev + " deadline " + target + " d falls "
          + (exact ? "at the end of " : "inside ")
          + (SLA_EDGE_WORDS[bucket] || "the last bucket")
          + (exact
            ? " — everything to its right is late."
            : " — that bucket is part in, part out, and everything to its right is late."),
    };
  });

  // One rule only when it is true of every bar drawn: the same bucket for all of them, and
  // that bucket an exact boundary. Otherwise null, and the sentences above carry the edge —
  // a single dashed line over six severities with five different deadlines would be a claim
  // the data does not support.
  const edgeAfter = edges.length
    && edges.every((e) => e.exact && e.bucket !== null && e.bucket === edges[0].bucket)
    ? edges[0].bucket
    : null;

  return {
    show: !(totalOpen === 0 && unaged === 0),
    labels,
    perSev,
    sevs,
    rows,
    edges,
    edgeAfter,
    unaged,
    totalOpen,
    // The origin, printed under the chart. PRODUCT.md's sixth principle: a clock says what it
    // measured from and what it did with the rows it could not measure.
    denominator: fmtCount(totalOpen) + " open "
      + pluralize(totalOpen, "finding") + " with a readable age, measured from first_seen to"
      + " now. Resolved findings are not in this chart at all."
      + (unaged > 0
        ? " " + fmtCount(unaged) + " further open " + pluralize(unaged, "finding")
          + (unaged === 1 ? " carries" : " carry")
          + " no first-seen date and " + (unaged === 1 ? "is" : "are") + " bucketed nowhere."
        : ""),
  };
}

/**
 * The SLA window consumed, in tenths — the same open population as `agingView`, measured
 * against each finding's OWN deadline instead of the shared 7/30/90 bucket edges.
 *
 * WHY THIS IS A SECOND CHART AND NOT A RESHAPE OF THE FIRST. `agingView`'s edges are fixed
 * while `SLA_TARGETS` runs 7/14/30/90/180, which is why it can usually draw no single SLA
 * hairline at all (see `edgeAfter`): one rule cannot stand for five deadlines. Dividing by the
 * row's own window removes the problem rather than hiding it — every severity shares one
 * axis, and NO EDGE IS NEEDED BECAUSE EVERY DRAWN BAR IS INSIDE ITS WINDOW. Hence no
 * `slaEdgeAfter` at the call site.
 *
 * `show` is false only for a payload that carries no block at all — an older cached entry, or
 * a page state with no `remediation`. That is not the same as a measured zero: a register
 * whose rows were read and none of which landed inside a window still has `pastWindow` /
 * `noWindow` to state, and the section says so rather than disappearing.
 */
export function slaConsumedView(remediation, order) {
  const block = (remediation && remediation.slaConsumed) || null;
  const has = !!block && Array.isArray(block.labels) && block.labels.length > 0;
  const perSev = (has && block.perSev) || {};
  const labels = has ? block.labels.slice() : [];
  // The same filter `stackedAgeBar` applies to its datasets (`palette.order.filter(...)`), so
  // the table lists the bars that were drawn and no others. UNKNOWN is here for completeness
  // and is never populated in practice: it has no SLA_TARGETS entry, so the domain files
  // every UNKNOWN row under `noWindow` rather than in a bucket.
  const sevs = (order || []).concat(["UNKNOWN"])
    .filter((s, i, a) => a.indexOf(s) === i)
    .filter((s) => perSev[s]);
  const pastTotal = pastWindowTotal(block);
  return {
    show: has,
    block,
    labels,
    perSev,
    sevs,
    // A MEASURED ZERO IS STILL A MEASUREMENT. `drawn === 0` with rows past the window or
    // without one is a register whose whole open backlog is outside the bars; `drawn === 0`
    // with neither is a register with no open findings. Both keep the section — only an
    // absent block loses it.
    drawn: num(block && block.totalOpen, 0),
    outside: (pastTotal === null ? 0 : pastTotal) + num(block && block.noWindow, 0),
  };
}

/**
 * `pastWindow` summed across severities, or null when any part of it was never measured.
 *
 * A non-finite entry is an UNMEASURED severity, not a zero one, so it poisons the total
 * rather than being added as 0 — `fmtCount` then prints the em dash for the whole sum. And a
 * payload written before this block existed carries no `pastWindow` at all:
 * `Object.values(undefined)` throws, while `Number(undefined)` would have quietly printed a
 * confident "0 past the window" over a population nobody counted.
 */
function pastWindowTotal(slaConsumed) {
  const past = slaConsumed && slaConsumed.pastWindow;
  if (!past || typeof past !== "object") return null;
  let total = 0;
  for (const v of Object.values(past)) {
    const n = num(v);
    if (n === null) return null;
    total += n;
  }
  return total;
}

/**
 * The caption under the SLA-window-consumed chart: the sentence naming what the bars mean and
 * WHAT THEY LEAVE OUT — or null when there is no block to caption.
 *
 * Two populations sit outside the bars and neither can be inferred from them. A finding at or
 * past its window has no tenth left to plot, so it is counted and not drawn; a finding with no
 * age or no target for its severity was never measurable against a deadline at all. Both would
 * otherwise be invisible — the bars would still add up, to a smaller number, and nothing on
 * screen would say so.
 *
 * Both counts go through `fmtCount`, which refuses null/undefined/""/[]/false BEFORE the cast
 * and renders the em dash instead of a zero nobody measured.
 */
export function slaConsumedCaption(slaConsumed) {
  if (!slaConsumed || typeof slaConsumed !== "object") return null;
  return "Bucket k is time used; 9−k is time left. "
    + fmtCount(pastWindowTotal(slaConsumed)) + " past the window are not drawn; "
    + fmtCount(slaConsumed.noWindow) + " carry no window.";
}

/**
 * SLA per severity: the share met, the overdue count, and how old the open backlog is.
 *
 * TWO DIFFERENT DENOMINATORS SIT IN ONE ROW and mixing them is the mistake this shape stops.
 * "In SLA" is taken over RESOLVED findings — of the ones that closed, how many closed inside
 * the window. "Open past SLA" is taken over OPEN findings — of the ones still running, how
 * many have already blown it. A single "SLA %" over everything would be neither.
 */
export function slaSeverityRows(mttr, order) {
  const perSev = (mttr && mttr.perSev) || {};
  const past = ((mttr && mttr.remediation && mttr.remediation.openPastSla) || {}).perSev || {};
  const levels = (order || []).concat(["UNKNOWN"]).filter((s, i, a) => a.indexOf(s) === i);
  return levels
    .filter((sev) => perSev[sev] || past[sev])
    .map((sev) => {
      const s = perSev[sev] || {};
      const p = past[sev] || {};
      const resolved = Number(s.resolved || 0);
      const open = Number(p.open === undefined ? s.open || 0 : p.open);
      return {
        sev,
        target: s.sla_target === null || s.sla_target === undefined ? null : Number(s.sla_target),
        inSla: rateView(s.sla_pct, resolved, fmtCount(resolved) + " resolved"),
        breached: Number(p.breached || 0),
        pastSla: rateView(p.pct, open, fmtCount(open) + " open"),
        openP50: s.open_age_p50 === undefined ? null : s.open_age_p50,
        openP90: s.open_age_p90 === undefined ? null : s.open_age_p90,
        resolved,
        open,
      };
    });
}

/**
 * Time-to-close as a distribution, with each bucket's share taken over the resolved
 * population the histogram actually covers.
 *
 * `buckets.total` is the count of RESOLVED lifecycles that landed in a bucket — open
 * findings are not in this figure at all, which is exactly why the survival curve above it
 * exists. The caption says so; the share's denominator node says so again next to the number.
 */
export function resolutionBucketView(buckets) {
  const labels = (buckets && buckets.labels) || [];
  const perSev = (buckets && buckets.perSev) || {};
  const total = Number((buckets && buckets.total) || 0);
  const rows = labels.map((label, i) => {
    const counts = {};
    let count = 0;
    for (const [sev, arr] of Object.entries(perSev)) {
      const n = Number((arr && arr[i]) || 0);
      if (n) counts[sev] = n;
      count += n;
    }
    return {
      label,
      count,
      counts,
      share: rateView(total > 0 ? (count / total) * 100 : null, total, fmtCount(total) + " resolved"),
    };
  });
  return { show: labels.length > 0, labels, rows, total };
}

/**
 * The awaiting-a-vendor-fix segment: open SCA findings with no published fix.
 *
 * `notApplicable` is the count of open sast/secrets rows whose flag read true anyway — the
 * server refuses to trust it, and so does this. Rendering it keeps "we did not count these"
 * distinct from "there were none".
 */
export function awaitingView(mttr) {
  const a = (mttr && mttr.remediation && mttr.remediation.awaiting) || null;
  if (!a) return { show: false };
  const openTotal = Number(a.openTotal || 0);
  return {
    show: true,
    overall: Number(a.overall || 0),
    notApplicable: Number(a.notApplicable || 0),
    share: rateView(a.pctOfOpen, openTotal, fmtCount(openTotal) + " open findings"),
  };
}

/**
 * The second clock, and the framing it refuses.
 *
 * `remediation.actionable` is computed over SCA rows ONLY (readModels.buildMttr) and carries
 * `scope: "sca"`, its own `rowCount`, and `notMeasured` — the rows it declined to price. SAST
 * and secrets have no vendor to wait on, so their `fix_available_at` collapses onto
 * `first_seen`: their actionable clock is their MTTR, identically, by construction. A
 * register-wide "actionable MTTR" would therefore be two-thirds a restatement of the figure
 * in the hero, dressed as a second measurement.
 *
 * So this THROWS on `{registerWide: true}` rather than quietly obliging. The server already
 * scopes the computation; a client that relabels it is the remaining way the mistake could
 * ship, and a caller who wants a register-wide actionable figure is asking for something that
 * does not exist rather than for a different presentation of something that does.
 */
export function actionableClockView(mttr, opts) {
  if (opts && opts.registerWide) {
    throw new Error(
      "The actionable clock is SCA-only. sast and secrets have no vendor to wait on, so their "
      + "actionable clock is identical to their MTTR by construction and a register-wide "
      + "figure would be two thirds a restatement of it.",
    );
  }
  const a = (mttr && mttr.remediation && mttr.remediation.actionable) || null;
  const base = {
    appliesTo: "sca",
    coversRegister: false,
    scopeLabel: "SCA only",
    heading: "The two clocks — SCA only",
    note: "SAST and secrets have no vendor to wait on, so their fix-available date collapses "
      + "onto first detection: their actionable clock is identical to their MTTR by "
      + "construction. Only SCA can leave a fix date unknown, and a null there is what puts a "
      + "finding in the awaiting-a-vendor bucket rather than in the actionable one.",
  };
  if (!a) return { ...base, show: false, populated: false };
  const rowCount = Number(a.rowCount || 0);
  const notMeasured = Number(a.notMeasured || 0);
  const half = kmHalfLifeView(a.km);
  const latency = a.vendorLatency || null;
  const segments = (latency && latency.segments) || null;
  return {
    ...base,
    show: true,
    // The block EXISTS but has no SCA population behind it — which is not the same as the
    // server not shipping it, and is not "0 SCA lifecycles measured" either. Rendering the
    // KPI row here printed a bare `0` under "Measured here" over a register nobody has read.
    populated: rowCount + notMeasured > 0,
    rowCount,
    notMeasured,
    half,
    // Deliberately a rate view like every other: the denominator is the SCA population, not
    // the register, and the node beside the figure has to say which.
    coverage: rateView(
      rowCount + notMeasured > 0 ? (rowCount / (rowCount + notMeasured)) * 100 : null,
      rowCount + notMeasured,
      fmtCount(rowCount + notMeasured) + " findings in scope, " + fmtCount(notMeasured)
        + " of them outside this clock",
    ),
    latency: latency ? kmHalfLifeView(latency) : null,
    segments,
  };
}

// --------------------------------------------------- the pure half of Wave A's pictures
//
// Three figures on this page stopped being sentences and became a meter, a legend line and a
// bar. Each of the three has a DECISION in it that can be wrong in a way a screenshot will
// not show, so each decision lives here, pure, where vitest can perturb it — the same split
// `agingView` and `slaConsumedCaption` above already make between what a section decides and
// how it is drawn.

/**
 * The percentage a `meter` may be filled to — or NULL, which draws no meter at all.
 *
 * THIS IS THE `Number(null)` TRAP WEARING A METER. `ui/data.js`'s `meter(value)` opens with
 * `Number(value) || 0`, so a null, a blank or an absent rate resolves to a confident 0% fill:
 * an empty track beside the words "not measured", which is a picture asserting that nothing
 * is in SLA rather than that nobody could tell. `rateView` already separates the two states —
 * `measured: false` with a real base is "the server did not compute it", `baseEmpty` is "there
 * is no population" — and both of them get no meter. A MEASURED ZERO does get one, empty: 0 of
 * 10 resolved findings inside their window is a measurement, and the empty track is its
 * picture.
 *
 * @param {{measured?: boolean, value?: number}|null|undefined} rate  a `rateView` result
 * @returns {number|null}
 */
export function meterPctFor(rate) {
  if (!rate || rate.measured !== true) return null;
  const pct = num(rate.value);
  return pct === null ? null : pct;
}

/**
 * "CRITICAL 7 d · HIGH 14 d · …" — the six SLA-edge sentences as one line of figures.
 *
 * WHAT IT REPLACES: a `<ul>` of one ~22-word sentence per severity ("HIGH deadline 14 d falls
 * inside the 8-30d bucket — that bucket is part in, part out, and everything to its right is
 * late"), which is a table drawn as paragraphs: six rows whose only varying content is a
 * severity and a number. Those numbers, in the bars' own order, read against the bucket labels
 * the chart's x axis already prints, place every edge — and `sla-edge` in the glossary carries
 * what the sentences said in general.
 *
 * THE TARGETS ARE THE PAYLOAD'S, NEVER A LITERAL. `agingView` reads them from
 * `aging.slaTargets`, which is what Settings writes, so a deadline edited there moves this
 * line. A severity with NO target says so rather than being dropped or rendered "null d": no
 * target is exactly why that severity has no edge, and it is the one thing this line could
 * say that the chart cannot.
 *
 * @param {Array<{sev: string, target: number|null}>} edges  `agingView(...).edges`
 * @returns {string|null}  null when there is nothing to draw a legend for
 */
export function slaEdgeLegend(edges) {
  const list = Array.isArray(edges) ? edges : [];
  if (!list.length) return null;
  return list
    .map((e) => e.sev + " " + (num(e.target) === null ? "no target" : e.target + " d"))
    .join(" · ");
}

/**
 * How the vendor-wait population divides, in the `{total, counts, unknowns}` shape
 * `axisSegments` reads.
 *
 * WHAT IT REPLACES: one 50-word sentence carrying five counts in series. Five figures inside a
 * sentence are read one at a time and cannot be compared; the same five as one bar are read at
 * a glance, and the legend still prints every count in words.
 *
 * `zeroAtOrigin` IS DELIBERATELY NOT A SEGMENT, and that is arithmetic rather than taste: it
 * is a SUBSET of `events` — a fix that already existed on the day the finding was detected —
 * so adding it as a fifth count would put the same rows in the bar twice and inflate the
 * total every share is taken against. It keeps its own line under the bar, with its number.
 *
 * `unmeasured` IS THE ONLY HATCHED VALUE. Those rows carry no readable origin and sit outside
 * the estimate entirely rather than being counted as a zero-day wait, and the hatch is this
 * design system's one mark for "this part is not a measurement" — so the value's whole count
 * is also its `unknowns` entry.
 *
 * Every count is refused BEFORE the cast (`num(v, 0)`), so a segment the server never sent is
 * a zero it declared rather than a `Number(undefined)` that became one.
 *
 * @param {object|null|undefined} segments  `actionableClockView(...).segments`
 * @returns {{values: string[], total: number, counts: object, unknowns: object}}
 */
export const VENDOR_WAIT_VALUES = [
  "Fix observed", "Open, no fix", "Closed before a fix", "No readable origin",
];

export function vendorWaitReading(segments) {
  const s = segments || {};
  const counts = {
    "Fix observed": num(s.events, 0),
    "Open, no fix": num(s.censored, 0),
    "Closed before a fix": num(s.closedBeforeFix, 0),
    "No readable origin": num(s.unmeasured, 0),
  };
  return {
    values: VENDOR_WAIT_VALUES.slice(),
    total: VENDOR_WAIT_VALUES.reduce((a, v) => a + counts[v], 0),
    counts,
    // Only the unmeasured value is hatched — see the doc comment.
    unknowns: { "No readable origin": counts["No readable origin"] },
  };
}

// ----------------------------------------------------------------------------- the page
//
// `scopeParam`, `denominatorNode` and `rateCell` moved to `./_rates.js` (imported above).

export async function renderMttr(host, params, _ctx) {
  const boot = await bootstrap();
  const scope = scopeParam(params);

  let paint = null;
  const data = swrCall(
    "api_getMttrPage",
    scope ? { scope } : {},
    (fresh) => paint && paint(fresh),
  );

  const noticeHost = el("div", {});
  const heroHost = el("div", {});
  const curveHost = el("div", {});
  const sevHost = el("div", {});
  const slaHost = el("div", {});
  const agingHost = el("div", {});
  const slaConsumedHost = el("div", {});
  const bucketHost = el("div", {});
  const clockHost = el("div", {});
  const trendHost = el("div", {});
  // THE TITLE BLOCK IS STATIC, AND THE h1 DOES NOT WAIT ON AN RPC. The metric header below is
  // built inside `renderHero`, which runs only once the fetch resolves — so the loading
  // skeleton, the fetch-failure errorState and (on Coverage & efficiency) the no-figures empty
  // state each rendered a page with NO `<h1>` in it at all. Appended here instead, once, ahead
  // of every host: the page's name is not a function of its data. Two stacked `.page-header`
  // blocks is the shape gas_ai's `problems` / `combos` / `config` already have — a title
  // header, then the figure and its stat strip.
  host.append(
    pageHeader({ route: "mttr" }),
    noticeHost, heroHost, curveHost, sevHost, slaHost, agingHost, slaConsumedHost,
    bucketHost, clockHost, trendHost,
  );

  let live = true;
  onPageTeardown(() => { live = false; });

  function guard(label, target, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[mttr] " + label + " render failed:", e);
      // A render that THREW is a defect, not an absence. errorState announces it as an alert
      // and files the exception under a disclosure; emptyState would have said it calmly, in
      // a role="status" box, in the same words this page uses for "nothing here yet".
      clear(target).append(errorState(
        "Couldn't render " + label + ".",
        { detail: String((e && e.message) || e) },
      ));
    }
  }

  clear(heroHost).append(
    el("div", { role: "status", "aria-label": "Computing the remediation clock" },
      skeleton("line", { width: "220px" }),
      skeleton("stat", { width: "260px", height: "56px" })),
  );

  paint = (payload) => {
    const mttr = payload && payload.mttr;
    const first = Number((mttr && mttr.rowCount) || 0) === 0;
    // ONE ARRAY, TWO PICTURES — see `halfLifeTrendPoints`. The sparkline in the header aside
    // and the line chart at the foot of the page are two readings of the same series, so it
    // is derived once here rather than filtered independently in each renderer.
    const trendPoints = halfLifeTrendPoints(payload && payload.trends);
    guard("the first-run notice", noticeHost, () => renderFirstRun(first));
    guard("the half-life", heroHost, () => renderHero(mttr, first, trendPoints));
    // FIRST RUN STOPS HERE — one notice above, not ten section headings each over its own
    // empty box. Every section below reads a population of exactly zero on an unread ledger;
    // `firstRunNotice`, rendered by `renderFirstRun` above, already carries the one sentence
    // this page owes a reader. Same shape as executive.js's `paint` (labels live inside each
    // renderX, so clearing the host removes label and box together).
    if (first) {
      [curveHost, sevHost, slaHost, agingHost, slaConsumedHost, bucketHost, clockHost, trendHost]
        .forEach(clear);
      return;
    }
    guard("the survival curve", curveHost, () => renderCurve(mttr));
    guard("the per-severity clock", sevHost, () => renderSeverity(mttr));
    guard("SLA by severity", slaHost, () => renderSla(mttr));
    guard("open findings by age", agingHost, () => renderAging(mttr));
    guard("the SLA window consumed", slaConsumedHost, () => renderSlaConsumed(mttr));
    guard("the time-to-close distribution", bucketHost, () => renderBuckets(mttr));
    guard("the two clocks", clockHost, () => renderClocks(mttr));
    guard("the half-life trend", trendHost, () => renderTrend(trendPoints));
  };

  try {
    paint(await data);
  } catch (e) {
    console.error("[mttr] api_getMttrPage failed:", e);
    clear(heroHost).append(errorState(
      "Couldn't load remediation data.",
      { detail: String((e && e.message) || e) },
    ));
  }

  /**
   * The origin, before any figure.
   *
   * Every section below already says what IT is missing. What none of them could say is that
   * the ledger has never been read at all — and a page of dashes with no such line leaves a
   * reader choosing between a broken app and an empty one.
   */
  function renderFirstRun(first) {
    clear(noticeHost);
    if (!first) return;
    noticeHost.append(firstRunNotice({
      synced: !!boot.latestSync,
      at: boot.latestSync ? boot.latestSync.ts : null,
      hint: "The clock on this page starts at the first finding a sync saves, and a duration"
        + " needs a second sync to close against. Run one with the Run sync button in the rail.",
    }));
  }

  // ------------------------------------------------------------------------------ hero

  /**
   * The hero, and the four paragraphs that used to hang under it.
   *
   * WHAT MOVED AND WHY. Below the header sat up to four `<p class="small muted">` blocks: the
   * SLA rate as a sentence, the awaiting-a-vendor count as a sentence, the lower-bound
   * explanation, and (on an empty base) two "not measured" explanations. Four sentences, three
   * of which contained a figure the page then never showed anywhere else — so a reader
   * scanning the header met three stat cells and had to read prose to find two more numbers
   * of equal standing. The two rates are now `statRow`s in the same strip, each with a
   * `meter--stat` beside the figure, and every sentence that explained one is a tip line on
   * that row's own name.
   *
   * WHAT DID NOT MOVE (R2). "not measured" stays the visible VALUE wherever a base is empty;
   * "at least N days" stays the visible hero value on a bound; and the refused-flag count —
   * open findings outside SCA that carried `awaiting_vendor_fix` anyway and were declined —
   * stays on the surface as "· N refused" in the row's sub-line. A refused count is a
   * measurement decision a reader is entitled to see without hovering anything.
   */
  function renderHero(mttr, first, trendPoints) {
    const view = mttrHeroView(mttr);
    const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
    const rmst = rmstView(km);
    const resolved = Number((mttr && mttr.overall && mttr.overall.resolved) || 0);
    const overallSla = rateView(
      mttr && mttr.slaPct,
      resolved,
      fmtCount(resolved) + " resolved",
    );
    const awaiting = awaitingView(mttr);

    clear(heroHost);
    // NO `route`: the page's h1 is in the title block appended once at the top of
    // `renderMttr`, so this header carries the figure and its stats and no heading.
    heroHost.append(pageHeader({
      hero: heroStat("Remediation half-life", view.value, view.qualifier, heroHelp(view)),
      aside: trendAside(trendPoints),
      // SUPPRESSED, not dashed — the same choice Executive and Coverage & efficiency make, so
      // one reader moving between the three pages meets one convention. "Censored 0 · open
      // findings kept in as evidence" is a claim about an estimator that has never run.
      stats: first ? [] : [
        statRow(
          "Censored",
          fmtCount(view.censored),
          "open findings kept in as evidence",
          null,
          { term: "censoring" },
        ),
        (() => { const p = kmP90View(km); return statRow("P90 (KM)", p.value, p.note); })(),
        statRow(
          "Restricted mean",
          rmst.text,
          rmst.truncated
            ? "a lower bound — survival had not reached zero at " + fmtDays(rmst.restrictionTime)
            : "area under the curve to " + fmtDays(rmst.restrictionTime),
        ),
        slaStatRow(overallSla),
        ...(awaiting.show ? [awaitingStatRow(awaiting)] : []),
      ],
    }));
  }

  /**
   * "Resolved in SLA" as a stat cell rather than as a sentence.
   *
   * The `meter` is `statRow`'s own slot and takes the rate; a rate with no base gets NO meter
   * rather than an empty track, because `meter(null)` would resolve to a confident 0% fill —
   * `Number(null)` is 0 and finite, CLAUDE.md's third recording of it — over a population
   * nobody measured. The empty case keeps its own words in both places: "not measured" is the
   * value (`rateView.text`), the missing population is named in the sub-line, and the whole
   * sentence rides in the tip.
   */
  function slaStatRow(rate) {
    return statRow(
      "Resolved in SLA",
      rate.text,
      rate.baseEmpty ? "nothing has closed yet" : "of " + rate.denominatorLabel,
      meterPctFor(rate),
      {
        term: "sla-target",
        lines: [
          rate.baseEmpty
            ? "Resolved inside the SLA window: not measured — nothing has closed yet, so there"
              + " is no resolved population to compare against the target."
            : "Taken over what CLOSED: of the findings that resolved, the share that resolved"
              + " on or before their severity's target.",
          "The comparison is inclusive — on or before the target.",
        ],
      },
    );
  }

  /**
   * "Awaiting a vendor" as a stat cell, with the refused count still on the surface.
   *
   * The figure is the COUNT of open SCA findings with no published fix; the meter is that
   * count's share of the open backlog, which is the rate the old sentence carried. Both were
   * in one paragraph before, and the count was the only one of the two a reader could act on.
   */
  function awaitingStatRow(awaiting) {
    const rate = awaiting.share;
    const refused = awaiting.notApplicable
      ? " · " + fmtCount(awaiting.notApplicable) + " refused"
      : "";
    return statRow(
      "Awaiting a vendor",
      rate.baseEmpty ? rate.text : fmtCount(awaiting.overall),
      (rate.baseEmpty
        ? "no SCA finding is open"
        : rate.text + " of " + rate.denominatorLabel) + refused,
      meterPctFor(rate),
      {
        term: "awaiting-fix",
        lines: [
          rate.baseEmpty
            ? "Awaiting a vendor fix: not measured — no SCA finding is open, so there is no"
              + " backlog to take a share of."
            : "Open SCA findings with no published fix. Those sit outside every deadline until"
              + " a fix exists.",
          ...(awaiting.notApplicable
            ? ["Refused: " + fmtCount(awaiting.notApplicable) + " open findings outside SCA"
              + " carried the flag anyway. SAST and secrets have no vendor to wait on, so the"
              + " flag cannot be true there and the rows were declined rather than counted."]
            : []),
        ],
      },
    );
  }

  /**
   * The hero label's tip: the STATE picks the lines, and the LABEL picks the term.
   *
   * Same decision Executive's own hero makes, and for the same reason: `kmHalfLifeView` puts
   * "at least 297 days" in the 2rem slot, so the words are already on the surface and only
   * the explanation moves. The term stays `half-life` in every state — the trigger is on the
   * words "Remediation half-life", so that is the entry Enter goes to, and a control whose
   * destination changes with the data is one a reader cannot learn. The bound's own sentence
   * LEADS the lines instead; `lower-bound` stays reachable from the Key sheet.
   */
  function heroHelp(view) {
    if (!view.isLowerBound) return { term: "half-life" };
    return {
      term: "half-life",
      lines: [
        "The curve never falls to half within the observed window, so there is no median to"
        + " publish.",
        "More than half of what is tracked is still open; the bound above is what is actually"
        + " true.",
      ],
    };
  }

  /**
   * The header's one qualifying aside: where this number is GOING.
   *
   * `pageHeader({aside})` is documented for exactly this ("a small curve"), and it was empty
   * on this page while the series it wants sat at the foot of the same page in a 170 KB
   * Chart.js line. `sparkline` is inline SVG with no library, `role="img"`, and an
   * `aria-label` that always states first / last / low / high — so the picture has a text
   * alternative and the caption underneath does not have to be one.
   *
   * BORDERLESS AND CAPPED (`.trend-aside`, pages.css): DESIGN.md's Hero Stat rule is that the
   * hero's dominance comes from size and whitespace, so a bordered card here would out-weigh
   * it — the same defect `4cdd472` fixed by capping the Coverage page's aside card.
   *
   * FEWER THAN TWO READINGS DRAWS THE LABEL, NEVER NOTHING. `sparkPath` returns `d: ""` for a
   * single reading (one point is not a trend) and for none at all; `sparkLabel` is the words
   * for both cases, and they are printed as the caption rather than the picture silently
   * disappearing from a slot that is there on every other paint.
   */
  function trendAside(points) {
    const list = Array.isArray(points) ? points : [];
    const values = list.map((p) => p.km_median_days);
    const model = sparkPath(values, { w: 220, h: 40 });
    // THE GAPS ARE IN THE CAPTION, NOT ONLY IN THE aria-label. Measured on the dev seed: 208
    // evaluated dates, 3 of which carry a half-life — the register's curve does not reach half
    // on any earlier date, so `km_median_days` is null there and the line is three readings
    // wide at the right-hand edge. That is the honest picture (the Chart.js line at the foot
    // of this page draws exactly the same shape), but a caption reading "3 readings" over a
    // 220px box would let a reader take the empty 97% for a flat line rather than for dates
    // nobody could measure. `sparkPath` counts the gaps; this prints them.
    const measured = model.gaps
      ? fmtCount(model.n) + " of " + fmtCount(values.length) + " readings measured"
      : fmtCount(model.n) + " readings";
    // A FLAT SERIES SAYS IT IS FLAT. "199 days to 199 days" is two readings of one fact; the
    // sparkline draws a straight line for exactly this case (`sparkPath`'s zero-span branch)
    // and the caption should agree with the picture rather than restate an endpoint twice.
    const range = model.first === model.last
      ? "flat at " + fmtDays(model.first)
      : fmtDays(model.first) + " to " + fmtDays(model.last);
    const caption = model.n >= 2
      ? measured + ", " + range
      : sparkLabel(model, "", "days");
    return el("div", { class: "page-strip trend-aside" },
      el("div", { class: "kpi-label" }, tipLabel("Half-life over time", {
        lines: [
          "One reading per saved scan, plus one per day of pre-scan history reconstructed from"
          + " first-detection dates.",
          "The full line, and which readings are reconstructed, is at the foot of this page.",
        ],
      })),
      sparkline(values, {
        label: "Remediation half-life over time", unit: "days", w: 220, h: 40,
      }),
      el("div", { class: "small muted" }, caption));
  }

  // ------------------------------------------------------------------- the survival curve

  function renderCurve(mttr) {
    const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
    clear(curveHost);
    // THE METHOD SENTENCE IS THE HEADING'S DEFINITION. What the chart-note said first —
    // "closed findings are events; open findings enter as right-censored observations at their
    // current age" — is what `censoring` means on this chart, and the second half is
    // provenance about the payload. Both are lines here; the two COUNTS stay under the canvas,
    // where they qualify the picture.
    curveHost.append(sectionLabel("Survival curve", {
      term: "censoring",
      lines: [
        "Closed findings are events; open findings enter as right-censored observations at"
        + " their current age.",
        "The closed-only comparison markers are not in this payload, so the two markers drawn"
        + " are both Kaplan-Meier.",
      ],
    }));

    if (!km || !Array.isArray(km.curve) || !km.curve.length) {
      curveHost.append(el("div", { class: "card" }, emptyState(
        "No curve yet.",
        "The estimator needs at least one closed finding with a readable clock. Open findings"
        + " alone give a censored population and no event to step down on.",
      )));
      return;
    }

    const canvas = el("canvas", { "aria-label": "Kaplan-Meier survival curve" });
    const card = el("section", { class: "chart-card" },
      // The two numbers, and nothing else — the sentences around them are on the heading.
      el("p", { class: "chart-note" },
        fmtCount(km.events) + " " + pluralize(km.events, "event")
        + " · " + fmtCount(km.censored) + " censored"),
      el("div", { class: "chart-box" }, canvas),
      // The same `km.curve` the wrapper below is handed, not a second read of the payload.
      chartTable({
        canvas,
        caption: "Every step of the curve above: weeks and days since detection, the share"
          + " still open after that step, the risk set it was computed over, and how many"
          + " findings closed at that time.",
        model: survivalTableModel(km.curve),
      }));
    curveHost.append(card);

    loadCharts().then((charts) => {
      if (!live) return;
      onPageTeardown(() => charts.destroyChart(canvas));
      charts.survivalCurve(canvas, km.curve, { median: km.median, mean: km.mean }, {});
    }).catch(() => {
      if (live) chartUnavailable(canvas);
    });
  }

  // ------------------------------------------------------------ the clock, per severity

  function renderSeverity(mttr) {
    const rows = mttrSeverityRows(mttr, SEVERITY_ORDER);
    clear(sevHost);
    // The 68-word note under the table said three things, all of them about METHOD: that the
    // fan and the table are one estimate read twice, what "at least N days" means here, and
    // that a staircase which stops stepping is a severity that stopped closing. None of them
    // is a figure or a constraint, so all three sit on the heading. Every card still states
    // its own half-life in words in its caption, which is the non-colour route to the same
    // fact and the one thing that could not move.
    sevHost.append(sectionLabel("The clock, by severity", {
      term: "half-life",
      lines: [
        "Each severity's curve and its row in the table below are one estimate read two ways —"
        + " the table is that curve's median, its lower bound and its P90.",
        "“at least N days” means that curve never fell to half. Open findings are in"
        + " every curve as right-censored observations, so a staircase that stops stepping is"
        + " a severity that stopped closing.",
      ],
    }));
    if (!rows.length) {
      sevHost.append(emptyState(
        "No per-severity clock yet.",
        "It appears once a finding of at least one severity has resolved.",
      ));
      return;
    }

    // The fan, ABOVE the summary table. Shape first, then the three statistics that summarise
    // it — a reader who wants the number reads down, a reader who wants to know whether a
    // severity stalls reads the staircase, and neither has to take the other on trust.
    const fan = severityCurvesView(mttr && mttr.remediation, SEVERITY_ORDER);
    if (fan.length) {
      const palette = sevPalette(SEVERITY_ORDER);
      const grid = el("div", { class: "sev-fan" });
      const pending = [];
      for (const card of fan) {
        const canvas = el("canvas", {
          "aria-label": "Kaplan-Meier survival curve for " + card.sev + " findings",
        });
        grid.append(el("section", { class: "chart-card" },
          el("div", { class: "sev-fan__head" }, sevBadge(card.sev)),
          el("p", { class: "chart-note" }, card.caption),
          el("div", { class: "chart-box" }, canvas),
          // Same `card.curve` reference the wrapper below is handed, named once — the one rule
          // ui/chartTable.js exists to enforce.
          chartTable({
            canvas,
            caption: "Every step of this severity's curve: weeks and days since detection, and"
              + " the share of " + card.sev + " findings still open after that step.",
            model: survivalTableModel(card.curve),
          })));
        pending.push({ canvas, card });
      }
      sevHost.append(grid);
      loadCharts().then((charts) => {
        if (!live) return;
        for (const { canvas, card } of pending) {
          onPageTeardown(() => charts.destroyChart(canvas));
          charts.survivalCurve(
            canvas,
            card.curve,
            { median: card.median, mean: card.mean },
            // The severity FILL token, read off the stylesheet — never the brand accent, which
            // is 1.52:1 and cannot carry a 2px line. Markers stay accent ink inside the wrapper.
            // `scope` is what stops each card's legend claiming "all": the diamond here is
            // THIS severity's restricted mean, not the register's.
            {
              color: palette.colors[card.sev],
              subject: "for " + card.sev + " findings",
              scope: card.sev,
            },
          );
        }
      }).catch(() => {
        if (!live) return;
        for (const { canvas } of pending) chartUnavailable(canvas);
      });
    }

    sevHost.append(dataTable({
      columns: [
        { key: "sev", label: "Severity", cell: (r) => sevBadge(r.sev) },
        {
          key: "half",
          label: "Half-life",
          className: "num",
          help: { term: "half-life" },
          cell: (r) => r.half.value,
        },
        { key: "p90", label: "P90", className: "num", cell: (r) => fmtDays(r.p90) },
        { key: "resolved", label: "Resolved", className: "num", cell: (r) => fmtCount(r.resolved) },
        { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.open) },
      ],
      rows,
    }));
  }

  // ------------------------------------------------------------------------------- SLA

  function renderSla(mttr) {
    const rows = slaSeverityRows(mttr, SEVERITY_ORDER);
    clear(slaHost);
    slaHost.append(sectionLabel("SLA by severity", { term: "sla-target" }));
    if (!rows.length) {
      slaHost.append(emptyState(
        "No SLA figures yet.",
        "It appears once a finding has closed against a severity's SLA target.",
      ));
      return;
    }
    slaHost.append(dataTable({
      columns: [
        { key: "sev", label: "Severity", cell: (r) => sevBadge(r.sev) },
        {
          key: "target",
          label: "Target",
          className: "num",
          help: { term: "sla-target" },
          cell: (r) => fmtDays(r.target),
        },
        {
          key: "inSla",
          label: "Resolved in SLA",
          // THE TWO DENOMINATORS ARE A FACT ABOUT THESE TWO COLUMNS, so each one says its own
          // rather than a paragraph under the table saying both. A column heading is asked
          // once, which is `ui/tip.js`'s whole rule for where a definition lives — and it is
          // one tab stop for the column instead of one per row.
          help: {
            term: "sla-target",
            lines: [
              "Taken over what CLOSED: of the findings that resolved, the share that resolved"
              + " on or before the target. The comparison is inclusive.",
            ],
          },
          cell: (r) => withMeter(r.inSla),
        },
        {
          key: "breached",
          label: "Open past SLA",
          help: {
            lines: [
              "Taken over what is still RUNNING: of the findings still open, the share already"
              + " past the target.",
              "The two denominators in this table are not interchangeable — a single SLA"
              + " percentage over everything would be neither.",
            ],
          },
          // The count AND the rate AND the base. The count alone hides how big the backlog
          // it came out of is; the rate alone hides how many findings that actually is. The
          // meter is the third encoding and the only one that can be compared down a column
          // at a glance; it is `decorative` because both figures are printed beside it.
          cell: (r) => el("span", { class: "rate-with-meter" },
            el("span", { class: "num" }, fmtCount(r.breached)),
            el("span", { class: "small muted" }, " (" + r.pastSla.text + ") "),
            rateMeter(r.pastSla),
            denominatorNode(r.pastSla)),
        },
        { key: "p50", label: "Open age P50", className: "num", cell: (r) => fmtDays(r.openP50) },
        { key: "p90", label: "Open age P90", className: "num", cell: (r) => fmtDays(r.openP90) },
      ],
      rows,
    }));
  }

  /**
   * The `meter--stat` that goes beside a rate — or nothing at all where there is no rate.
   *
   * The decision is `meterPctFor` and lives at module scope, pure, because `meter(null)` fills
   * to 0% and a 0% track beside the words "not measured" is a confident zero in picture form.
   * `decorative` because the percentage is printed next to it — `ui/data.js`'s own contract
   * for a meter whose figure is already in words.
   */
  function rateMeter(rate) {
    const pct = meterPctFor(rate);
    return pct === null ? null : meter(pct, { className: "meter--stat", decorative: true });
  }

  /** `rateCell` with the meter folded in — the shared cell, plus this page's third encoding. */
  function withMeter(rate) {
    const cell = rateCell(rate);
    const bar = rateMeter(rate);
    if (bar) cell.insertBefore(bar, cell.childNodes[1] || null);
    cell.className = "rate-with-meter";
    return cell;
  }

  // ------------------------------------------------------- open findings by age

  /**
   * The open backlog as a shape, with the SLA edge said out loud.
   *
   * The table under the canvas is built from the SAME `vm.perSev` / `vm.labels` the chart
   * wrapper is handed, named once here — `ui/chartTable.js`'s one rule. Its "Past SLA for"
   * column is the accessible half of the edge: a reader who cannot see a dashed rule, or for
   * whom no rule was drawn because the six deadlines disagree, still reads which severities
   * are wholly late in each bar.
   */
  function renderAging(mttr) {
    const vm = agingView(mttr && mttr.remediation, SEVERITY_ORDER);
    clear(agingHost);
    // NO GLOSSARY TERM HERE ANY MORE. "sla-band" rode this label until the section below it
    // existed: its two lines are "how much of the window each open finding has consumed, and
    // how many are already past it", which is a description of the deciles chart and not of
    // this one — these bars are fixed at 7/30/90 days and consume no window at all. It has
    // moved to "SLA window consumed", where the words and the figure agree. "sla-target"
    // stays where it was, on the "SLA by severity" table above.
    // The 62-word method note that used to close this section is here now. It says what the
    // bars are OF (open findings only, aged from first_seen to now) and what they are NOT (a
    // resolved finding stopped ageing and belongs to the survival curve) — a definition of the
    // population, not a figure, so the heading is where it belongs. `vm.denominator` is the
    // full origin sentence, unchanged and still pinned by test/mttrAging.test.js; the compact
    // form of the same two counts is under the canvas.
    agingHost.append(sectionLabel("Open findings by age", {
      lines: [
        "Open findings only, aged from first_seen to now — a resolved finding stopped ageing"
        + " and its lifetime is the survival curve's subject, not this one's.",
        vm.denominator,
      ],
    }));
    if (!vm.show) {
      agingHost.append(emptyState(
        "No open findings to age yet.",
        "This chart counts open findings only, measured from first_seen to now.",
      ));
      return;
    }

    const canvas = el("canvas", {
      "aria-label": "Open findings by age bucket and severity",
    });
    const card = el("section", { class: "chart-card" },
      // BOTH COUNTS, NO SENTENCE. "N open with a readable age" is the denominator and
      // "M undated" is the population the bars cannot hold — the second is an honesty
      // statement and stays on the surface as a number and the word for it (R2), while the
      // 55-word origin sentence it came from is a line on the heading above.
      el("p", { class: "chart-note" },
        fmtCount(vm.totalOpen) + " open with a readable age"
        + (vm.unaged > 0 ? " · " + fmtCount(vm.unaged) + " undated" : "")),
      el("div", { class: "chart-box" }, canvas),
      chartTable({
        canvas,
        caption: "Every bar of the stack as a count: one row per age bucket, one column per"
          + " severity drawn, the row total, and which severities are already past their"
          + " deadline in that bucket.",
        model: chartTableModel({
          columns: [
            { key: "bucket", label: "Age", format: "text", value: (r) => r.label },
            ...vm.sevs.map((sev) => ({
              key: sev,
              label: sev,
              format: "count",
              value: (r) => r.counts[sev],
            })),
            { key: "total", label: "Total", format: "count", value: (r) => r.total },
            {
              key: "past",
              label: "Past SLA for",
              format: "text",
              value: (r) => (r.breaches.length ? r.breaches.join(", ") : null),
            },
          ],
          rows: vm.rows,
        }),
      }));
    agingHost.append(card);

    // ONE LEGEND LINE INSTEAD OF SIX SENTENCES.
    //
    // What was here: an unordered list of one sentence per severity, each ~22 words, each
    // saying the same thing about a different deadline — "HIGH deadline 14 d falls inside the
    // 8-30d bucket — that bucket is part in, part out, and everything to its right is late."
    // Six of those is ~130 words of near-identical prose whose only varying content is a
    // severity name and a number, which is the definition of a table drawn as paragraphs.
    //
    // What replaces it: the numbers themselves, in the same order the bars are stacked, read
    // against the bucket labels the chart's own x axis already prints. "MEDIUM 30 d" beside a
    // bucket labelled "8-30d" places the edge exactly; "HIGH 14 d" places it inside one. The
    // `sla-edge` tip carries what the sentences said in general (a deadline rarely lands on a
    // boundary; a rule is drawn only where every severity shares an exact edge), and the
    // chartTable's own "Past SLA for" column carries the per-bucket verdict row by row.
    //
    // NOTHING IS HARD-CODED: `e.target` is whatever the payload's `slaTargets` holds, so a
    // deadline edited in Settings moves this line with it. A severity with no target says so
    // rather than being dropped — an absent deadline is why that severity has no edge at all.
    const legend = slaEdgeLegend(vm.edges);
    if (legend) {
      agingHost.append(el("p", { class: "small muted" },
        tipLabel("SLA edges", { term: "sla-edge" }), ": ", legend));
    }

    loadCharts().then((charts) => {
      if (!live) return;
      onPageTeardown(() => charts.destroyChart(canvas));
      charts.stackedAgeBar(
        canvas,
        vm.labels,
        vm.perSev,
        // The severity fills, read off the stylesheet, over EXACTLY the severities the table
        // lists — so `stackedAgeBar`'s own `order.filter((s) => perSev[s])` cannot draw a
        // series the table omits or omit one it lists.
        sevPalette(vm.sevs),
        "Open findings by age bucket and severity, measured from first detection.",
        vm.edgeAfter === null
          ? {}
          : { slaEdgeAfter: vm.edgeAfter, slaEdgeLabel: "SLA" },
      );
    }).catch(() => {
      if (!live) return;
      chartUnavailable(canvas);
    });
  }

  // -------------------------------------------------- SLA window consumed, in tenths

  /**
   * The same open findings as the section above, against their OWN deadline.
   *
   * Bucket k is the k-th tenth of the window that has been used and 9-k is what is left, so
   * a 3-day CRITICAL (7-day window) and a 39-day LOW (90-day window) stand in the same bar
   * while the age chart above puts them three buckets apart. NO `slaEdgeAfter` IS PASSED, and
   * that is the point rather than an omission: every bar drawn is inside its window, so there
   * is no edge left on this axis to mark.
   *
   * The two populations that are counted and NOT drawn reach the reader in the caption, which
   * is the only place either appears — a finding at or past its window has no tenth left to
   * plot, and one with no age or no target was never measurable against a deadline. Neither
   * is a zeroth tenth.
   *
   * The stack is by SEVERITY because severity is what picks the denominator: the colour names
   * the deadline each bar was measured against.
   */
  function renderSlaConsumed(mttr) {
    const vm = slaConsumedView(mttr && mttr.remediation, SEVERITY_ORDER);
    clear(slaConsumedHost);
    // THE BAND, NOT THE WALL — "SLA by severity" above reads the deadline per severity
    // (term: "sla-target"); this is the same deadline read as a DISTRIBUTION, which is what
    // "sla-band" defines.
    slaConsumedHost.append(sectionLabel("SLA window consumed", {
      term: "sla-band",
      // What normalising by the row's OWN window buys, and why this axis needs no SLA rule.
      // The axis key itself ("Bucket k is time used; 9−k is time left") stays on the surface
      // in `slaConsumedCaption`, which is also where the two counts that are NOT drawn are
      // stated — so it is deliberately not restated here.
      lines: [
        "A 3-day CRITICAL and a 39-day LOW stand in the same bar: each is placed by the"
        + " fraction of its OWN deadline it has used, not by its age.",
        "Every bar drawn is inside its own window, which is why this axis carries no SLA rule"
        + " the way the age chart above can.",
      ],
    }));
    // NO SECTION BODY AT ALL rather than an empty state: "no open findings with a window"
    // would be a measurement, and a payload with no block never measured anything. Mirrors
    // renderAging's `vm.show` gate, which is also what covers the first run.
    if (!vm.show) {
      slaConsumedHost.append(emptyState(
        "No SLA windows measured yet.",
        "This chart needs open findings with a readable age and an SLA target for their"
          + " severity.",
      ));
      return;
    }
    // A MEASURED ZERO, unlike the case above: rows were read and none of them landed inside
    // a window. The caption still has both counts to state, so it is printed rather than
    // dropped with the chart.
    if (!vm.drawn) {
      slaConsumedHost.append(emptyState(
        "No open findings are still inside their SLA window.",
        slaConsumedCaption(vm.block) || undefined,
      ));
      return;
    }

    const canvas = el("canvas", {
      "aria-label": "Open findings by tenth of their SLA window consumed",
    });
    slaConsumedHost.append(el("section", { class: "chart-card" },
      // One clause: the count and what it is a count OF. The rest of the sentence described
      // the axis, which is the heading's job now.
      el("p", { class: "chart-note" },
        fmtCount(vm.drawn) + " open " + pluralize(vm.drawn, "finding")
        + " still inside " + (vm.drawn === 1 ? "its" : "their") + " window"),
      el("div", { class: "chart-box" }, canvas),
      chartTable({
        canvas,
        caption: "Every bar of the stack as a count: one row per tenth of the SLA window"
          + " consumed, one column per severity drawn.",
        // The SAME `vm.labels` / `vm.perSev` the chart wrapper is handed, named once here —
        // `ui/chartTable.js`'s one rule. `agingTableModel` is generic over its label array;
        // the header word is passed because these labels are tenths, not age buckets.
        model: agingTableModel(vm.labels, vm.perSev, vm.sevs, "Tenth of window consumed"),
      }),
    ));
    slaConsumedHost.append(el("p", { class: "small muted" }, slaConsumedCaption(vm.block)));

    loadCharts().then((charts) => {
      if (!live) return;
      onPageTeardown(() => charts.destroyChart(canvas));
      charts.stackedAgeBar(
        canvas,
        vm.labels,
        vm.perSev,
        sevPalette(vm.sevs),
        "Open findings by tenth of their SLA window consumed, stacked by severity.",
        // No `slaEdgeAfter`: every bar here is inside its window, so there is no edge.
        {},
      );
    }).catch(() => {
      if (!live) return;
      chartUnavailable(canvas);
    });
  }

  // ------------------------------------------------------------------- time to close

  function renderBuckets(mttr) {
    const view = resolutionBucketView(mttr && mttr.remediation && mttr.remediation.buckets);
    clear(bucketHost);
    bucketHost.append(sectionLabel("Time to close", {
      term: "censoring",
      lines: [
        "Resolved lifecycles only. Open findings are not in this distribution at any bucket —"
        + " they are in the curve above, as censored observations.",
      ],
    }));
    if (!view.show || !view.total) {
      bucketHost.append(emptyState(
        "Nothing has closed yet.",
        "This histogram covers resolved lifecycles only — which is exactly why the survival"
        + " curve above it exists.",
      ));
      return;
    }
    bucketHost.append(dataTable({
      columns: [
        { key: "label", label: "Closed within", cell: (r) => r.label },
        { key: "count", label: "Findings", className: "num", cell: (r) => fmtCount(r.count) },
        { key: "share", label: "Share", cell: (r) => rateCell(r.share) },
        {
          key: "mix",
          label: "Severity mix",
          cell: (r) => {
            const entries = sevEntries(r.counts, SEVERITY_ORDER);
            return sevSegmentBar(entries, {
              size: "md",
              label: entries.length
                ? entries.map((e) => e.count + " " + e.sev).join(", ")
                : "no findings in this bucket",
              emptyHatch: true,
            });
          },
        },
      ],
      rows: view.rows,
    }));
    // The one clause that is a fact about the FIGURES rather than about the method: what this
    // table's shares are taken over. The rest of the old note is on the heading.
    bucketHost.append(el("p", { class: "small muted" },
      fmtCount(view.total) + " resolved " + pluralize(view.total, "lifecycle") + " only"));
  }

  // ------------------------------------------------------------------- the two clocks

  /**
   * The second clock — and `view.note` printed ONCE.
   *
   * It was printed up to three times on one page: under the empty state, under the
   * not-populated state, and under the populated KPI row. All three are the same 50-word
   * paragraph explaining why this section says "SCA only", which is what the HEADING already
   * says in two words. So it is a line on the heading now, on every path, and the section
   * body carries figures.
   */
  function renderClocks(mttr) {
    const view = actionableClockView(mttr);
    clear(clockHost);
    clockHost.append(sectionLabel(view.heading, { term: "two-clocks", lines: [view.note] }));
    if (!view.show) {
      clockHost.append(emptyState("No actionable clock to show yet."));
      return;
    }
    if (!view.populated) {
      clockHost.append(emptyState(
        "No SCA finding has entered this clock yet.",
        "It starts counting the day a fixed version exists for a dependency finding, so it"
        + " needs a sync that saves at least one SCA row.",
      ));
      return;
    }

    const row = el("div", { class: "kpi-row" });
    row.append(kpiCard(
      "Actionable half-life",
      view.half.value,
      "measured from the day a fix became available — " + view.scopeLabel,
      null,
      { term: "two-clocks" },
    ));
    row.append(kpiCard(
      "Waiting for a vendor",
      view.latency ? view.latency.value : absentText,
      "detection to a fix existing, over the pre-toggle SCA population",
      null,
      { term: "awaiting-fix" },
    ));
    row.append(kpiCard(
      "Measured here",
      fmtCount(view.rowCount),
      "SCA lifecycles",
    ));
    clockHost.append(row);

    // `.rate-with-meter`, not a bare paragraph: `.meter` is `display: block` (a percentage
    // width on an inline box is ignored, which is why), so dropped into a `<p>` it takes a
    // line of its own and the denominator falls below the figure it belongs to.
    clockHost.append(el("p", { class: "small muted rate-with-meter" },
      "Coverage of this clock: ",
      el("span", { class: "num" }, view.coverage.text),
      rateMeter(view.coverage),
      denominatorNode(view.coverage)));

    if (view.segments) clockHost.append(vendorWaitBar(view.segments));
  }

  /**
   * How the vendor-wait population divides — as a bar, because it is a division.
   *
   * WHAT IT REPLACES: one 50-word sentence carrying five counts in a row. Five figures inside
   * a sentence is the shape a reader has to parse serially and cannot compare; the same five
   * as one bar with a legend is read in a glance and still states every count in words.
   *
   * THE FOURTH SEGMENT IS HATCHED BECAUSE IT IS NOT A MEASUREMENT. `unmeasured` counts rows
   * with no readable origin — outside the estimate entirely rather than counted as zero — so
   * it is passed as this value's own `unknowns` entry, which is `axisBar`'s one mark for
   * "nothing established this". `axisSegments` is what turns the reading into shares; nothing
   * here re-derives them.
   *
   * `zeroAtOrigin` IS NOT A SEGMENT, and that is arithmetic rather than taste: it is a SUBSET
   * of the fixes observed (a fix that already existed the day the finding was detected), so
   * drawing it beside them would double-count the population the shares are taken over. It
   * keeps its own line under the legend, in words, with its number.
   */
  function vendorWaitBar(s) {
    const reading = vendorWaitReading(s);
    const bar = axisBar({ values: reading.values, unit: "SCA lifecycles" });
    bar.paint(axisSegments(reading, reading.values));
    const box = el("div", {},
      el("div", { class: "kpi-label" },
        tipLabel("How the vendor wait divides", {
          term: "awaiting-fix",
          lines: [
            "The population the wait-for-a-vendor estimate was taken over, split by how each"
            + " finding left it.",
            "The hatched part is not a measurement: those rows carry no readable origin and"
            + " sit outside the estimate rather than being counted as a zero-day wait.",
          ],
        })),
      bar);
    if (num(s.zeroAtOrigin, 0) > 0) {
      box.append(el("p", { class: "small muted" },
        fmtCount(s.zeroAtOrigin) + " of the fixes observed were already available at"
        + " detection — a zero-length wait, not a missing one."));
    }
    return box;
  }

  // ---------------------------------------------------------------- half-life over time

  function renderTrend(points) {
    clear(trendHost);
    trendHost.append(sectionLabel("Half-life over time", {
      term: "reconstructed",
      lines: [
        "The Kaplan-Meier median re-evaluated as of each date — the same series the sparkline"
        + " beside the hero draws.",
        "One point per saved scan, plus one per day of pre-scan history rebuilt from"
        + " first-detection dates, where closures are under-counted.",
      ],
    }));
    if (points.length < 2) {
      trendHost.append(el("div", { class: "card" }, emptyState(
        "Not enough history to draw a line.",
        "The backbone emits one point per saved scan plus one per day of pre-scan history;"
        + " two points are the minimum.",
      )));
      return;
    }
    const reconstructed = points.filter((p) => p.reconstructed).length;
    const canvas = el("canvas", { "aria-label": "Remediation half-life over time, in days" });
    trendHost.append(el("section", { class: "chart-card" },
      // THE LEGEND IS THE COUNT AND THE WORD, not the sentence. "reconstructed" is the
      // honesty word and it stays on the surface with its number beside it (R2); what the
      // word MEANS — rebuilt rather than observed, closures under-counted, read as not
      // measured — is the `reconstructed` entry the trigger routes to.
      //
      // NOT "shaded = reconstructed": `charts.trendLine` draws one flat series and shades
      // nothing, so a legend claiming a shading nobody can see would be a picture described
      // rather than a picture drawn. `charts.js`'s `hatchPattern()` is the hook that would
      // make that legend true, and wiring it is a change to a shipped chart rather than to
      // this page's words.
      el("p", { class: "chart-note" },
        "Kaplan-Meier median days, as of each date. ",
        reconstructed
          ? tipLabel(
            fmtCount(reconstructed) + " of " + fmtCount(points.length) + " points"
            + " reconstructed",
            { term: "reconstructed" },
          )
          : null),
      el("div", { class: "chart-box" }, canvas),
      // `points` — the same array the wrapper below plots — read once, into both.
      chartTable({
        canvas,
        caption: "The half-life the line above plots, one row per evaluated date. A"
          + " reconstructed row is one dated before the first saved scan, where closures are"
          + " under-counted.",
        model: chartTableModel({
          columns: [
            {
              key: "date",
              label: "Date",
              format: "text",
              value: (p) => String(p.date).slice(0, 10),
            },
            { key: "km_median_days", label: "Half-life", format: "days" },
            {
              key: "reconstructed",
              label: "Reconstructed",
              format: "text",
              align: "text",
              value: (p) => (p.reconstructed ? "yes" : "no"),
            },
          ],
          rows: points,
        }),
      })));

    loadCharts().then((charts) => {
      if (!live) return;
      onPageTeardown(() => charts.destroyChart(canvas));
      charts.trendLine(
        canvas,
        points.map((p) => ({ x: p.date, y: p.km_median_days })),
        {
          yLabel: "days",
          series: [{
            label: "Half-life (KM)",
            color: charts.ACCENT,
            data: points.map((p) => p.km_median_days),
          }],
        },
      );
    }).catch(() => {
      if (live) chartUnavailable(canvas);
    });
  }
}

/**
 * The severity order this page ranks by.
 *
 * Hard-coded rather than read off `bootstrap()` on purpose: this page's only use for it is
 * ROW ORDER, and a table that silently reordered itself because a bootstrap key moved would
 * be worse than one that states its order. `src/domain/config.ts` holds the same list and
 * `test/shared.test.js` pins it there.
 */
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
