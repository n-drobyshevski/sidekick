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
import { sevPalette } from "./sca.js";
import {
  chartTable, chartTableModel, clear, dataTable, el, emptyState, errorState, firstRunNotice,
  fmtCount, fmtDays, heroStat, kpiCard, num, onPageTeardown, pageHeader, pluralize,
  sectionLabel, sevBadge, sevEntries, sevSegmentBar, skeleton, statRow, survivalTableModel,
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

/** A percentage to one decimal. Only ever called through `rateView`, which owns the nulls. */
function fmtPct(p) {
  const n = Number(p);
  return (Math.round(n * 10) / 10) + "%";
}

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
    value: "—",
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

// ----------------------------------------------------------------------------- the page

function scopeParam(params) {
  const s = params && params.scope;
  return s === "sca" || s === "sast" || s === "secrets" ? s : null;
}

/**
 * A `[data-denominator]` node — every rate on this page is followed by one of these.
 *
 * The ATTRIBUTE always carries the number, including a zero: a test and a reader who asks
 * both get the base. The visible text does not restate a zero base, because "not measured"
 * followed by "0 resolved" reads as a measurement of nothing rather than as an absence.
 */
function denominatorNode(rate) {
  return el("span", {
    class: "small muted",
    "data-denominator": rate.denominator === null ? "none" : String(rate.denominator),
  }, rate.baseEmpty ? "— " + rate.emptyLabel : rate.denominatorLabel);
}

/** A rate and its base as one cell: the figure, then the base under it. */
function rateCell(rate) {
  return el("span", {}, el("span", { class: "num" }, rate.text), " ", denominatorNode(rate));
}

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
  const bucketHost = el("div", {});
  const clockHost = el("div", {});
  const trendHost = el("div", {});
  host.append(
    noticeHost, heroHost, curveHost, sevHost, slaHost, agingHost, bucketHost, clockHost,
    trendHost,
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
    guard("the first-run notice", noticeHost, () => renderFirstRun(first));
    guard("the half-life", heroHost, () => renderHero(mttr, first));
    guard("the survival curve", curveHost, () => renderCurve(mttr));
    guard("the per-severity clock", sevHost, () => renderSeverity(mttr));
    guard("SLA by severity", slaHost, () => renderSla(mttr));
    guard("open findings by age", agingHost, () => renderAging(mttr));
    guard("the time-to-close distribution", bucketHost, () => renderBuckets(mttr));
    guard("the two clocks", clockHost, () => renderClocks(mttr));
    guard("the half-life trend", trendHost, () => renderTrend(payload && payload.trends));
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
      hint: "The clock on this page starts at the first finding a sync saves, and a duration"
        + " needs a second sync to close against. Run one with the Run sync button in the rail.",
    }));
  }

  // ------------------------------------------------------------------------------ hero

  function renderHero(mttr, first) {
    const view = mttrHeroView(mttr);
    const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
    const rmst = rmstView(km);
    const overallSla = rateView(
      mttr && mttr.slaPct,
      Number((mttr && mttr.overall && mttr.overall.resolved) || 0),
      fmtCount(Number((mttr && mttr.overall && mttr.overall.resolved) || 0)) + " resolved",
    );

    clear(heroHost);
    heroHost.append(pageHeader({
      hero: heroStat("Remediation half-life", view.value, view.qualifier, { term: "half-life" }),
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
      ],
    }));

    // NOT "not measured 0 resolved". Where the base is empty the sentence names the missing
    // population rather than printing its size beside a claim that nothing was measured.
    const slaLine = overallSla.baseEmpty
      ? el("p", { class: "small muted" },
          "Resolved inside the SLA window: not measured — nothing has closed yet, so there is"
          + " no resolved population to compare against the target.")
      : el("p", { class: "small muted" },
          "Resolved inside the SLA window: ",
          el("span", { class: "num" }, overallSla.text),
          " ",
          denominatorNode(overallSla),
          ". ",
          el("span", {}, "The comparison is inclusive — on or before the target."));
    heroHost.append(slaLine);

    if (view.isLowerBound) {
      heroHost.append(el("p", { class: "small muted" },
        "The curve never falls to half within the observed window, so there is no median to"
        + " publish. More than half of what is tracked is still open; the bound above is what"
        + " is actually true."));
    }
    const awaiting = awaitingView(mttr);
    if (awaiting.show && awaiting.share.baseEmpty) {
      heroHost.append(el("p", { class: "small muted" },
        "Awaiting a vendor fix: not measured — no SCA finding is open, so there is no backlog"
        + " to take a share of. A finding with no published fix sits outside every deadline"
        + " until one exists."));
    } else if (awaiting.show) {
      heroHost.append(el("p", { class: "small muted" },
        "Awaiting a vendor fix: ",
        el("span", { class: "num" }, fmtCount(awaiting.overall)),
        " open SCA findings — ",
        el("span", { class: "num" }, awaiting.share.text),
        " ",
        denominatorNode(awaiting.share),
        ". Those sit outside every deadline until a fix exists."
        + (awaiting.notApplicable
          ? " " + fmtCount(awaiting.notApplicable) + " open findings outside SCA carried the"
            + " flag anyway and were refused rather than counted."
          : "")));
    }
  }

  // ------------------------------------------------------------------- the survival curve

  function renderCurve(mttr) {
    const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
    clear(curveHost);
    curveHost.append(sectionLabel("Survival curve", { term: "censoring" }));

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
      el("p", { class: "chart-note" },
        "Closed findings are events; open findings enter as right-censored observations at"
        + " their current age. " + fmtCount(km.events) + " " + pluralize(km.events, "event")
        + ", " + fmtCount(km.censored) + " censored. The closed-only comparison markers are not"
        + " in this payload, so the two markers drawn are both Kaplan-Meier."),
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
    sevHost.append(sectionLabel("The clock, by severity"));
    if (!rows.length) {
      sevHost.append(emptyState("No per-severity clock yet."));
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
    sevHost.append(el("p", { class: "small muted" },
      "Each severity gets its own curve, and the table is that same curve's median, its lower"
      + " bound and its P90 — one estimate read two ways, not two estimates. \"at least N"
      + " days\" means that severity's curve never fell to half, on the card and in the"
      + " column alike; open findings are in every curve as right-censored observations, so a"
      + " staircase that stops stepping is a severity that stopped closing."));
  }

  // ------------------------------------------------------------------------------- SLA

  function renderSla(mttr) {
    const rows = slaSeverityRows(mttr, SEVERITY_ORDER);
    clear(slaHost);
    slaHost.append(sectionLabel("SLA by severity", { term: "sla-target" }));
    if (!rows.length) {
      slaHost.append(emptyState("No SLA figures yet."));
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
        { key: "inSla", label: "Resolved in SLA", cell: (r) => rateCell(r.inSla) },
        {
          key: "breached",
          label: "Open past SLA",
          // The count AND the rate AND the base. The count alone hides how big the backlog
          // it came out of is; the rate alone hides how many findings that actually is.
          cell: (r) => el("span", {},
            el("span", { class: "num" }, fmtCount(r.breached)),
            el("span", { class: "small muted" }, " (" + r.pastSla.text + ") "),
            denominatorNode(r.pastSla)),
        },
        { key: "p50", label: "Open age P50", className: "num", cell: (r) => fmtDays(r.openP50) },
        { key: "p90", label: "Open age P90", className: "num", cell: (r) => fmtDays(r.openP90) },
      ],
      rows,
    }));
    slaHost.append(el("p", { class: "small muted" },
      "Two denominators sit in this table and they are not interchangeable. \"Resolved in"
      + " SLA\" is taken over what closed; \"Open past SLA\" is taken over what is still"
      + " running. A single SLA percentage over everything would be neither."));
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
    agingHost.append(sectionLabel("Open findings by age", { term: "sla-target" }));
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
      el("p", { class: "chart-note" }, vm.denominator),
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

    agingHost.append(el("ul", { class: "small muted" },
      ...vm.edges.map((e) => el("li", {}, e.sentence))));
    agingHost.append(el("p", { class: "small muted" },
      "Open findings only, aged from first_seen to now — a resolved finding stopped ageing"
      + " and its lifetime is the survival curve's subject, not this one's."
      + (vm.unaged > 0
        ? " " + fmtCount(vm.unaged) + " open " + pluralize(vm.unaged, "finding")
          + (vm.unaged === 1 ? " carries" : " carry")
          + " no first-seen date; they are counted here in words and drawn in no bar, because"
          + " an undated finding is not a young one."
        : "")));

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

  // ------------------------------------------------------------------- time to close

  function renderBuckets(mttr) {
    const view = resolutionBucketView(mttr && mttr.remediation && mttr.remediation.buckets);
    clear(bucketHost);
    bucketHost.append(sectionLabel("Time to close"));
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
    bucketHost.append(el("p", { class: "small muted" },
      "Resolved lifecycles only. Open findings are not in this distribution at any bucket —"
      + " they are in the curve above, as censored observations."));
  }

  // ------------------------------------------------------------------- the two clocks

  function renderClocks(mttr) {
    const view = actionableClockView(mttr);
    clear(clockHost);
    clockHost.append(sectionLabel(view.heading, { term: "two-clocks" }));
    if (!view.show) {
      clockHost.append(emptyState("No actionable clock in this payload."));
      clockHost.append(el("p", { class: "small muted" }, view.note));
      return;
    }
    if (!view.populated) {
      clockHost.append(emptyState(
        "No SCA finding has entered this clock yet.",
        "It starts counting the day a fixed version exists for a dependency finding, so it"
        + " needs a sync that saves at least one SCA row.",
      ));
      clockHost.append(el("p", { class: "small muted" }, view.note));
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
      view.latency ? view.latency.value : "—",
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

    clockHost.append(el("p", { class: "small muted" },
      "Coverage of this clock: ",
      el("span", { class: "num" }, view.coverage.text),
      " ",
      denominatorNode(view.coverage),
      "."));
    clockHost.append(el("p", { class: "small muted" }, view.note));

    if (view.segments) {
      const s = view.segments;
      clockHost.append(el("p", { class: "small muted" },
        "The vendor-wait population divides as: " + fmtCount(s.events) + " fixes observed ("
        + fmtCount(s.zeroAtOrigin) + " of them already available at detection), "
        + fmtCount(s.censored) + " still open with no fix, " + fmtCount(s.closedBeforeFix)
        + " closed before any fix was seen, and " + fmtCount(s.unmeasured)
        + " with no readable origin — outside the estimate entirely rather than counted as"
        + " zero."));
    }
  }

  // ---------------------------------------------------------------- half-life over time

  function renderTrend(trends) {
    const points = (trends && Array.isArray(trends.trend) ? trends.trend : [])
      .filter((p) => p && p.date);
    clear(trendHost);
    trendHost.append(sectionLabel("Half-life over time"));
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
      el("p", { class: "chart-note" },
        "Kaplan-Meier median days, evaluated as of each date."
        + (reconstructed
          ? " The first " + fmtCount(reconstructed) + " "
            + pluralize(reconstructed, "point") + " " + (reconstructed === 1 ? "is" : "are")
            + " reconstructed from first-detection dates before the first saved scan, where"
            + " closures are under-counted — read those as not measured."
          : "")),
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
