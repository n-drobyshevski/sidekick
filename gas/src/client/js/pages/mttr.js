// MTTR & SLA — remediation performance from the durable ledger. Hero stat, trend
// charts, per-severity SLA table, posture bars. Never fetches from Wiz.

import { groupPalette, hideChartWhenSettled } from "../charts.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import { mttrPaintPlan } from "./mttrPaintPlan.js";
import { denominatorNode, fmtPct, rateCell } from "./_rates.js";
import { agingTableModel, barsTableModel, trendTableModel } from "./_charts.js";
import {
  absent, absentText, boundedDays, changeChip, chartTable, clear, dataTable,
  el, emptyState, errorState, firstRunNotice, fmtCount, fmtDays, fmtSpan, heroLines,
  heroStat, meter, num, pageHeader, pluralize, scopeBar, sectionLabel,
  segmented, sevBadge, skeleton, sparkLabel, sparkPath, sparkline, statRow, survivalTableModel,
  tip, tipLabel,
} from "../ui.js";

// Keep in sync with RESOLUTION_BUCKET_LABELS in src/domain/remediation.ts (the client
// bundle can't import the TS domain module) — used only if an older cached payload
// somehow carries buckets without labels.
const RESOLUTION_LABELS = ["≤1d", "2–7d", "8–30d", "31–90d", "90+d"];

// The breakdown section (renderByDomain) serves two dimensions from one renderer, chosen by
// the server payload's `dimension`: per-domain at the unscoped view, per-support-group
// when a domain is selected (that split would be a single row then). These carry the
// visible copy; the group-name reads go through a `.group ?? .domain` accessor so the same code
// paints both. Keep the phrasing parallel so the two views read the same.
//
// "By domain", not "By manual group": the split is over the RESOLVED domain — the `Wiz/Domain`
// tag where the tenant wrote one, a manual group where it did not — so naming it after the
// fallback mechanism would describe the smaller half of its own rows.
//
// `help` is the section label's tip, not a paragraph under it. The two lines it replaces were
// a `<p class="small muted">` advertising what sat behind a "Open domain breakdown →" button;
// with the section drawn on the page there is nothing left to advertise, and DESIGN.md §6's
// rule applies — the population statement stays on the surface (it is what the split is over),
// the explanation of how to read the two lenses moves onto the label's tip, where "The clock,
// by severity" and "Open findings by age" directly above already keep theirs.
const DOMAIN_DIM = {
  noun: "domain",
  Noun: "Domain",
  title: "By domain",
  help: [
    "Every domain in the register, split by the resolved Wiz/Domain tag where the tenant"
    + " wrote one and by manual group where it did not.",
    "The two cards read the same medians differently: contribution weights each domain's"
    + " median by how much it closed, the median lens is the rate on its own.",
  ],
};
const SUPPORT_GROUP_DIM = {
  noun: "support group",
  Noun: "Support group",
  title: "By support group",
  help: [
    "Every support group inside the selected scope — the split by domain would be a single"
    + " row here, so this one takes its place.",
    "The two cards read the same medians differently: contribution weights each group's"
    + " median by how much it closed, the median lens is the rate on its own.",
  ],
};

// Timeframe presets for the Trends charts. null = no window (full history).
const TREND_WINDOWS = [
  ["5d", 5], ["2w", 14], ["30d", 30], ["60d", 60], ["90d", 90], ["All", null],
];

// The chosen window persists across visits in localStorage, stored by preset label so a
// stale or hand-edited value degrades to All. Some GAS iframe sandboxes block web storage
// (see attributionPrefill.js), hence the try/catch — blocked storage just means no recall.
const TREND_WINDOW_KEY = "mttrTrendWindow";
function loadTrendWindow() {
  try {
    const hit = TREND_WINDOWS.find(([label]) => label === localStorage.getItem(TREND_WINDOW_KEY));
    return hit ? hit[1] : null;
  } catch {
    return null;
  }
}
function saveTrendWindow(label) {
  try {
    localStorage.setItem(TREND_WINDOW_KEY, label);
  } catch {
    // Sandbox without storage — the choice simply won't survive the visit.
  }
}

// X-axis width presets for the survival curve (weeks). Purely a view zoom — the full
// curve is already in the payload, so switching windows never re-requests. Persisted by
// label like the Trends window; a stale/blocked value degrades to the widest (30w).
const SURVIVAL_WINDOWS = [["30w", 30], ["15w", 15], ["5w", 5]];
const SURVIVAL_WEEKS_KEY = "mttrSurvivalWeeks";
function loadSurvivalWeeks() {
  try {
    const hit = SURVIVAL_WINDOWS.find(([label]) => label === localStorage.getItem(SURVIVAL_WEEKS_KEY));
    return hit ? hit[1] : 30;
  } catch {
    return 30;
  }
}
function saveSurvivalWeeks(label) {
  try {
    localStorage.setItem(SURVIVAL_WEEKS_KEY, label);
  } catch {
    // Sandbox without storage — the choice simply won't survive the visit.
  }
}

// Generic recall/persist for the two-option in-card toggles (MTTR clock, SLA-quality
// series, distribution view). Same sandbox-tolerant try/catch as the window prefs above;
// an unknown or blocked value degrades to `fallback`.
function loadPref(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sandbox without storage — the choice simply won't survive the visit.
  }
}

// A compact toggle over a small option set — a thin wrapper over the shared segmented()
// control (gas_shared/ui/controls.js) rather than the hand-rolled .seg-row / .seg-btn--sm
// pair this used to build directly. Every call site below re-renders its whole section on
// a pick, so the fresh `segmented()` node the next render builds is enough; nothing here
// needs `.set()`. `options` is [[label, value], …]; `onPick` gets the chosen value and is
// expected to persist + repaint.
function toggleRow(ariaLabel, options, current, onPick) {
  return segmented({
    options: options.map(([label, value]) => ({ value, label })),
    value: current,
    ariaLabel,
    onChange: onPick,
  });
}

// THE ONE CHART CARD ON THIS PAGE, and it is now the only one in the register.
//
// `./_charts.js` carried a SECOND `chartCard(title, note, draw, table, help)` — ported from
// gas_devsecops/pages/sca.js for parity and, by its own header's admission, never called by
// any of this app's four chart pages. That file is deleted of it now rather than kept as an
// unused export: two functions of one name, one of them dead, is the shape a later reader
// picks the wrong one out of.
//
// WHY THIS ONE SURVIVED THE MERGE RATHER THAN THAT ONE. The ported card OWNS its canvas and
// its `loadCharts()` call, which is right for a chart drawn unconditionally off data already
// in hand — and wrong for every one of this page's eight call sites. Six of them hand in a
// pre-built `.chart-box` because the card carries an inline toggle (`opts.toggle`, the
// KM/naive clock, the survival window, the distribution view) or swaps two canvases inside one
// box for the by-domain lens; the `renderCharts` grid batches every one of its `loadCharts()`
// resolutions into a single `painters` pass rather than one promise per card. Taking the
// ported shape would have meant dropping a feature at each of those sites or writing the
// conditional twice. So the survivor is the one that takes a `box` and leaves the drawing to
// the caller.
//
// WHAT IT GAINED FOR THE PER-SEVERITY FAN. `opts.head` replaces the `<h3>` outright, which is
// what lets a fan card lead with a severity BADGE instead of a text title — colour is never
// the only cue on a grid of six curves (PRODUCT.md, Accessibility), so the badge's dot AND
// word have to be the card's heading. `opts.note` is the `.chart-note` line under it, which is
// where each card states its own half-life in words. Both are optional and every existing call
// site is byte-unchanged.
//
// `opts.table` IS THE CANVAS'S DATA-TABLE ALTERNATIVE — a `chartTable(...)` node, appended
// after `box`.
function chartCard(title, box, opts = {}) {
  const h3 = opts.head
    ? null
    : opts.helpLines ? el("h3", {}, tip(title, opts.helpLines)) : el("h3", {}, title);
  const head = opts.head
    ? opts.head
    : opts.toggle ? el("div", { class: "chart-head" }, h3, opts.toggle) : h3;
  return el("div", { class: "chart-card" },
    head, opts.note ? el("p", { class: "chart-note" }, opts.note) : null, box, opts.table || null);
}

// ------------------------------------------------------------------------- view models
//
// Ported from gas_devsecops/src/client/js/pages/mttr.js, which states the general rule this
// register was still breaking: a duration whose curve never crosses the estimator's threshold
// is a LOWER BOUND, not a missing value, and it is written "at least N days" in prose — never
// "> N d" (the glyph this page used to print, in kmMedianText below, before this port).

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
 * IDENTICAL TO gas_devsecops's COPY — this register's KMResult (`remediation.km`, see
 * src/server/api.ts) carries the same `{median, medianLowerBound, ...}` shape, so nothing
 * here needed adapting.
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
 * A rate and the base it was taken over, as one object. Ported unchanged from
 * gas_devsecops/mttr.js — see that module's header for the full rationale (a denominator of
 * zero is not a zero percent; `baseEmpty` names the missing population instead of gluing a
 * "0 resolved" onto "not measured").
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
 * ADAPTED FOR THIS REGISTER'S SHAPE. gas_devsecops ships the overall P90 nested on the KM
 * result itself (`km.p90`); this server ships it as a SIBLING of `km`
 * (`remediation.kmP90`, src/server/api.ts) — so this takes the p90 value and the KM result
 * separately rather than reading a `.p90` field that does not exist here. The three-state
 * shape (present / curve-never-reaches-it / nothing-closed) is otherwise identical.
 *
 *   p90 present        "41 days"  "nine in ten close by here"
 *   events, no p90     "—"        the curve never reached nine in ten inside the window
 *   no events at all   "—"        nothing has closed, so there is no percentile to place
 *
 * @param {number|null|undefined} p90  `remediation.kmP90`
 * @param {object|null|undefined} km   `remediation.km`, read here only for its event count
 */
export function kmP90View(p90, km) {
  // `num`, not `Number`. `Number("")` is 0 and 0 is finite, so a blank P90 arriving from a
  // hand-edited cell would have rendered "0 days" under "nine in ten close by here" — the
  // exact shape CLAUDE.md names, one line below a comment about not doing it.
  const raw = num(p90);
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

/**
 * The percentage a `meter` may be filled to — or NULL, which draws no meter at all.
 *
 * Ported unchanged. `ui/data.js`'s `meter(value)` opens with `Number(value) || 0`, so a null,
 * blank or absent rate resolves to a confident 0% fill without this guard — CLAUDE.md's
 * `Number(null)` trap wearing a meter.
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
 * The restricted mean, and the "≥" it earns when survival never reached zero. Ported unchanged
 * — this register's KMResult carries `mean` / `meanTruncated` / `restrictionTime` in the same
 * shape (src/domain/remediation.ts). Not currently drawn on this page (see the render
 * functions below); exported so a caller — this page's own future RMST stat, or a sibling
 * page — has one implementation to reach for rather than a second copy.
 */
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
 * The hero: the register's half-life, with the estimator's own three counts beside it.
 *
 * Ported from gas_devsecops's copy and adapted to this register's summary shape — `rowCount`
 * is the tracked-lifecycle count here and the qualifier names it, because "56 observations"
 * over a page whose every other figure is counted in lifecycles reads as a second population.
 *
 * The CENSORED count IS the qualifier. The estimate is only honest because the still-open
 * findings stayed in as right-censored observations, so the sentence never prints the median
 * without them.
 */
export function mttrHeroView(mttr) {
  const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
  const half = kmHalfLifeView(km);
  const events = num(km && km.events, 0);
  const censored = num(km && km.censored, 0);
  const total = num(km && km.total, 0);
  const rowCount = num(mttr && mttr.rowCount, 0);
  const resolved = num(mttr && mttr.overall && mttr.overall.resolved, 0);
  const open = num(mttr && mttr.overall && mttr.overall.open, 0);
  const unknown = (mttr && mttr.perSev && mttr.perSev.UNKNOWN) || {};
  const unclassified = num(unknown.open, 0) + num(unknown.resolved, 0);
  return {
    ...half,
    events,
    censored,
    total,
    rowCount,
    resolved,
    open,
    unclassified,
    qualifier: rowCount
      ? fmtCount(rowCount) + " tracked " + pluralize(rowCount, "lifecycle")
        + " in the durable base · " + fmtCount(resolved) + " resolved · "
        + fmtCount(open) + " open"
        + (unclassified > 0
          ? " · " + fmtCount(unclassified) + " unclassified severity"
          : "")
      : "No tracked lifecycles yet.",
    // The estimator's own split, said separately from the register's counts above. `total` is
    // what the curve was fitted over and it is NOT `rowCount`: a row with no readable clock is
    // in the register and outside the estimate.
    estimator: total
      ? fmtCount(total) + " observations · " + fmtCount(events) + " closed (events) · "
        + fmtCount(censored) + " still open (censored)"
      : "No observations yet.",
  };
}

/**
 * The half-life trend, as ONE array read by two things.
 *
 * `renderCharts` plots it as the "MTTR over time" line; `renderHero` draws the same readings
 * as a `sparkline` in the header's aside slot, because "297 days" over a half-life that has
 * been falling for four readings is a different fact from the same 297 over one that doubled
 * — and the trend was already on the wire. `ui/chartTable.js`'s one rule is that a picture and
 * its table are handed the SAME array; the same reasoning covers two pictures, so the filter
 * lives here and the page passes the result to both rather than each deriving its own.
 *
 * A slot with no `date` is dropped rather than plotted: the x axis is the date. A slot whose
 * `km_median_days` is null is KEPT — that is a gap in the line, and dropping it would compress
 * time and get the slope wrong in both pictures.
 */
export function halfLifeTrendPoints(trends) {
  const raw = trends && Array.isArray(trends.trend) ? trends.trend : [];
  return raw.filter((p) => p && p.date);
}

/**
 * One small-multiple card per severity: the curve, and the sentence that has to carry the card
 * if the colour cannot.
 *
 * THE COLOUR IS NEVER THE ONLY CUE, and on a grid of six curves that rule bites hardest — the
 * red/orange/amber severity band is a measured colourblind risk (HIGH and MEDIUM sit 1.6 apart
 * under deuteranopia). So every card carries the severity BADGE (dot plus the word) and a
 * caption that states the half-life in words. A reader who sees no colour at all reads the
 * same six facts.
 *
 * `caption` says "at least N days" wherever the median is absent and a bound is not — the
 * middle case `kmHalfLifeView` exists for, restated per card because a card is read on its own
 * and a dash beside a drawn curve reads as a broken chart rather than as a censored one.
 *
 * A SEVERITY WITH NO CURVE IS SKIPPED RATHER THAN DRAWN EMPTY. `kmPerSev` only holds the
 * severities that had rows, and a severity whose curve came back with no steps has nothing to
 * plot — an axis with no staircase asserts "measured, and flat", which is a different claim
 * from "nothing here". `skipped` names them so the page can say so in one line, rather than
 * letting a severity vanish from a grid whose own summary table still lists it.
 *
 * @param {object|null|undefined} remediation  `mttr.remediation`
 * @param {string[]} order                     boot.palette.order
 */
export function severityCurvesView(remediation, order) {
  const per = (remediation && remediation.kmPerSev) || {};
  const levels = (order || []).concat(["UNKNOWN"]).filter((s, i, a) => a.indexOf(s) === i);
  const present = levels.filter((sev) => per[sev]);
  const hasSteps = (sev) => Array.isArray(per[sev].curve) && per[sev].curve.length > 0;
  const cards = present.filter(hasSteps).map((sev) => {
    const km = per[sev];
    const half = kmHalfLifeView(km);
    const events = num(km.events, 0);
    const censored = num(km.censored, 0);
    return {
      sev,
      curve: km.curve,
      median: km.median === undefined ? null : km.median,
      mean: km.mean === undefined ? null : km.mean,
      half,
      events,
      censored,
      total: num(km.total, 0),
      caption: (half.measured ? "Half-life " + half.value : "Half-life not measured")
        + ". " + fmtCount(events) + " " + pluralize(events, "event") + ", "
        + fmtCount(censored) + " censored.",
    };
  });
  cards.skipped = present.filter((sev) => !hasSteps(sev));
  return cards;
}

/** `insights.AGE_BUCKET_LABELS`, mirrored — the client bundle cannot import the TypeScript
 *  domain. Only a FALLBACK: the server ships `remediation.aging.labels` from that same
 *  constant and `agingView` prefers what it was sent, so a bucket edit reaches this page from
 *  one place. */
export const AGE_BUCKET_LABELS = ["0-7d", "8-30d", "31-90d", "90+d"];

/** How each severity's SLA deadline reads against a bucket boundary. `exact` severities sit ON
 *  an edge (7 / 30 / 90), so everything to the right of their bucket is wholly late; the other
 *  two land mid-bucket and their own bucket is part in, part out. */
const SLA_EDGE_WORDS = [
  "the first bucket", "the 8-30d bucket", "the 31-90d bucket", "the 90+d bucket",
];

/**
 * Open findings by age, against the per-severity SLA edge.
 *
 * WHY THIS SECTION EXISTS BESIDE "Remediation by severity". That table is the same open
 * population reduced to one ratio per severity, and a ratio cannot say whether the breaches
 * are eight days late or eight hundred.
 *
 * THE EDGE IS PER SEVERITY, WHICH IS WHY THERE IS USUALLY NO SINGLE LINE TO DRAW.
 * `SLA_TARGETS` is 7 / 14 / 30 / 90 / 180 days, so CRITICAL's deadline falls at the end of the
 * first bar and INFO's past the end of the last one. `charts.js::stackedAgeBar` takes ONE
 * `slaEdgeAfter` index, so a rule is emitted only when every severity drawn agrees on it AND
 * that shared edge is exact — otherwise one drawn line would claim an edge five sixths of the
 * chart does not have. The legend line under the chart and the table's "Past SLA for" column
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

  // The same filter `stackedAgeBar` applies to its datasets (`palette.order.filter((s) =>
  // perSev[s])`), so the table lists the bars that were drawn and no others.
  const sevs = (order || []).concat(["UNKNOWN"])
    .filter((s, i, a) => a.indexOf(s) === i)
    .filter((s) => perSev[s]);

  const edgeOf = (sev) => num(slaEdge[sev]);

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
  // that bucket an exact boundary. Otherwise null, and the legend below the chart carries the
  // edge — a single dashed line over six severities with five different deadlines would be a
  // claim the data does not support.
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
    // The origin, carried on the heading. PRODUCT.md's sixth principle: a clock says what it
    // measured from and what it did with the rows it could not measure.
    denominator: fmtCount(totalOpen) + " open "
      + pluralize(totalOpen, "finding") + " with a readable age, measured from first detection"
      + " to now. Resolved findings are not in this chart at all."
      + (unaged > 0
        ? " " + fmtCount(unaged) + " further open " + pluralize(unaged, "finding")
          + (unaged === 1 ? " carries" : " carry")
          + " no first-seen date and " + (unaged === 1 ? "is" : "are") + " bucketed nowhere."
        : ""),
  };
}

/**
 * "CRITICAL 7 d, HIGH 14 d, ..." — the SLA-edge sentences as one line of figures.
 *
 * WHAT IT REPLACES: a list of one ~22-word sentence per severity, which is a table drawn as
 * paragraphs — rows whose only varying content is a severity and a number. Those numbers, in
 * the bars' own order, read against the bucket labels the chart's x axis already prints, place
 * every edge; `sla-edge` in the glossary carries what the sentences said in general.
 *
 * THE TARGETS ARE THE PAYLOAD'S, NEVER A LITERAL. `agingView` reads them from
 * `aging.slaTargets`, which the domain's `SLA_TARGETS` writes, so a deadline edited there
 * moves this line. A severity with NO target says so rather than being dropped or rendered
 * "null d": no target is exactly why that severity has no edge, and it is the one thing this
 * line could say that the chart cannot.
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

// ------------------------------------------------------------------------ page formatters

// Open-past-SLA cell, shared by the per-severity table and the
// by-domain table: "632 (77%)" — the breached count with its share of the open
// population in parentheses. "0" when nothing is open (pct is null then, not a fake
// 0%); the muted em dash when the payload doesn't carry this metric at all (e.g. a
// stale pre-remediation cache).
//
// BOTH CALL SITES ARE NODE CHILD POSITIONS, which is what lets the missing case be
// `absent()` — a stale cache used to put a black dash beside three live counts, in the ink of a
// measurement. The dash INSIDE the parenthesis stays a string, and it is `absentText` now
// rather than a hand-typed literal — the one spelling ui/figures.js exists to make universal
// (it is interpolated into the template below, where a Node would render as
// "[object HTMLSpanElement]").
//
// NOT ROUTED THROUGH `rateView`/`rateCell` (this page's own rate vocabulary, above, and
// ./_rates.js): this is a COUNT with its rate glued into the same string ("632 (77%)"), not a
// rate alone, and `rateCell`'s shape (the figure, then a denominator SENTENCE on its own line)
// has no slot for a leading count. Forcing this into that shape would add a denominator line
// under every cell in a dense table for no reader benefit the existing parenthetical doesn't
// already give.
function fmtOpenPastSla(o) {
  if (!o || o.open === null || o.open === undefined) return absent();
  if (!o.open) return "0";
  const pct = num(o.pct);
  const pctText = pct === null ? absentText : `${pct.toFixed(0)}%`;
  // `num(v, 0)`, not `?? 0`: a stale payload that carries `open` but somehow not `breached`
  // (a shape this metric has never actually shipped, but the allowlist costs nothing) now
  // refuses a non-numeric `breached` the same way every other formatter in this file does,
  // instead of `??`'s narrower null/undefined-only check.
  const breached = num(o.breached, 0);
  return `${breached.toLocaleString()} (${pctText})`;
}

// `fmtAwaiting` USED TO LIVE HERE - "N (x% of open)", glued onto the end of the hero's
// source sentence. Awaiting-a-vendor-fix is a `statRow` in the header strip now
// (`awaitingStatRow`), which splits the count from its share: the count is the figure, the
// share is the meter, and the sub-line names the open backlog they were taken over. One
// formatter producing one string out of two figures had nowhere to put a denominator,
// which is exactly why it carried none.

// The wait for a vendor fix to EXIST, as the last of the hero's qualifying lines. Reads the same KMResult
// shape `kmHalfLifeView` above reads (the server ships the KM summary without its curve — no
// chart plots these), so the bound wording ("at least X days", never the old "> X d" glyph) is
// shared with the hero and with gas_devsecops's identical helper.
//
// Renders NOTHING rather than a dash when the payload predates the clocks (a stale cache) or
// when nothing in the population could be measured at all: a row whose fix availability was
// never observed is unmeasured, and a page that printed "0 d" for it would be inventing the
// one number this whole metric exists to stop inventing. `kmHalfLifeView` itself would print
// "Not measured" for that state — a fine hero answer, and the wrong one for a clause that
// would rather say nothing than qualify a "from" with nothing behind it ("Not measured from
// our first detection" reads as a sentence fragment, not an absence).
function latencyClause(l) {
  if (!l || !l.segments) return null; // stale pre-latency cache
  if (!l.events && !l.censored) return null; // nothing measured — say nothing, not zero
  return kmHalfLifeView(l).value;
}

// Both clocks on one line, with the segment split in the help tip. Null when neither clock
// has anything to say.
function latencyLine(vendor, disclosure) {
  const v = latencyClause(vendor);
  const d = latencyClause(disclosure);
  if (!v && !d) return null;
  const parts = [];
  if (v) parts.push(`${v} from our first detection`);
  if (d) parts.push(`${d} from CVE publication`);
  const seg = (vendor && vendor.segments) || (disclosure && disclosure.segments) || {};
  const detail = [
    "Kaplan\u2013Meier median wait for a vendor fix to become available. Findings still " +
      "awaiting one are censored, not dropped \u2014 excluding them would leave only the " +
      "vulnerabilities that got fixed and measure how fast the fixed ones were fixed.",
    "This is the vendor's half of the exposure. Our half is the actionable clock, which " +
      "starts where this one ends: exposure = this wait + time to deploy.",
    `Population: ${(seg.events || 0).toLocaleString()} with a fix observed, ` +
      `${(seg.censored || 0).toLocaleString()} still awaiting one, ` +
      `${(seg.closedBeforeFix || 0).toLocaleString()} closed before any fix appeared, ` +
      `${(seg.unmeasured || 0).toLocaleString()} unmeasured.`,
    "Unmeasured means the origin or the availability date was never captured \u2014 a " +
      "legacy row predating broadened ingestion, or a CVE with no publication date on " +
      "record. Those are excluded rather than counted as a zero-length wait.",
    "Measured over every finding in scope, including ones the \"show findings without a " +
      "vendor fix\" setting hides elsewhere on this page: they are exactly this metric's " +
      "censored population, so hiding them here would bias it toward zero.",
  ];
  // `tip(..., { term })` rather than `glossaryTip`: three of the five lines above are THIS
  // scan's own population counts, which no glossary entry can carry. So the card keeps its
  // sharper words and `term` only adds the route to the general definition.
  return tip(
    // `.hero-line`, not `.hero-src`: this sits inside `heroStat`'s sub slot now, where
    // components.css's `.page-hero-sub .hero-line` is what makes it read as its own
    // statement rather than as a continuation of the sentence above it.
    [el("div", { class: "hero-line" }, `Wait for a vendor fix \u2014 ${parts.join(" \u00b7 ")}`)],
    detail,
    { term: "vendor-fix-wait" },
  );
}

// `kmMedianText` / `fmtKmMedian` / `kmMedianCell` USED TO LIVE HERE. They read the same
// `{median, medianLowerBound}` shape `kmHalfLifeView` (above) does, and the missing branch
// printed "> X d" — the WRONG GLYPH: a curve that never falls to half puts the median AT LEAST
// that far out, an inclusive lower bound, and ">" claims something stronger the estimator never
// showed. `kmHalfLifeView(km).value` is the direct replacement at both call sites below (the
// hero, a Node position, and `latencyClause` above, a sentence position) — it already returns a
// plain string ("41 days" / "at least 41 days" / "Not measured"), so no cell/text split is
// needed here any more.

// Circular-arrows (refresh) glyph for the by-domain panel's single lens-swap button. Inline
// SVG with stroke:currentColor so it inherits the button's ink, like NAV_ICONS / CHEVRON_ICON.
const SWAP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'
  + '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>';

// App-shell skeleton for the cold-load MTTR page — mirrors the real hero / Trends / Distribution
// / SLA hosts so the swap to live content doesn't reflow. Blocks are aria-hidden; the hero host
// carries the "Computing MTTR" announcement the old muted "Computing…" text used to give. The
// caller leaves the by-domain host (below the fold, whole-chain only) cleared.
function renderMttrSkeleton({ heroHost, chartsHost, survivalHost, slaHost }) {
  // The `.page-header` shape the real hero is now, not the `.hero`/`.hero-minis` block it used
  // to be: label, hero figure, two sub-lines, the aside strip, and a five-cell stat list.
  // A skeleton that mirrors a layout the page no longer builds is a reflow on every load.
  clear(heroHost).append(
    el("div", { class: "page-header", role: "status", "aria-label": "Computing MTTR" },
      el("div", { class: "page-hero" },
        el("div", { style: "margin-bottom:8px" }, skeleton("line", { width: "150px" })),
        skeleton("stat", { width: "180px" }),
        el("div", { style: "margin-top:10px" }, skeleton("line", { width: "70%" }))),
      el("div", { class: "page-strip trend-aside" },
        el("div", { style: "margin-bottom:8px" }, skeleton("line", { width: "120px" })),
        skeleton("line", { width: "220px" })),
      el("div", { class: "stat-list" },
        ...[0, 1, 2, 3, 4].map(() => el("div", { class: "stat-row" },
          el("div", { style: "margin-bottom:8px" }, skeleton("line", { width: "84px" })),
          skeleton("stat", { width: "56px" }))))),
  );
  clear(chartsHost).append(
    el("div", { class: "section-head" },
      skeleton("line", { width: "110px" }),
      skeleton("pill", { width: "180px" })),
    el("div", { class: "chart-grid chart-grid--2", style: "align-items:start" },
      ...[0, 1].map(() => el("div", { class: "chart-card" },
        el("div", { style: "margin-bottom:12px" }, skeleton("line", { width: "140px" })),
        el("div", { class: "chart-box" }, skeleton("chart"))))),
  );
  clear(survivalHost).append(
    el("div", { style: "margin:28px 0 12px" }, skeleton("line", { width: "130px" })),
    el("div", { class: "chart-card" },
      el("div", { style: "margin-bottom:12px" }, skeleton("line", { width: "220px" })),
      el("div", { class: "chart-box chart-box--tall" }, skeleton("chart"))),
  );
  clear(slaHost).append(
    el("div", { style: "margin:28px 0 12px" }, skeleton("line", { width: "180px" })),
    el("div", { class: "table-wrap", style: "padding:14px" },
      ...[0, 1, 2, 3, 4].map(() => el("div", { style: "margin:10px 0" }, skeleton("line")))),
  );
}

export async function renderMttr(main, _params, ctx) {
  const boot = await bootstrap();

  // Which severities feed every metric on this page: the app-wide display setting
  // ("which severities every page shows"), falling back to all selectable if that setting
  // is somehow empty. Read-only here — the setting is the only place it changes.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];

  main.append(pageHeader({
    route: "mttr",
    help: { term: "km-median" },
    lede: "How fast risk gets closed, measured over observed lifecycles. The SLA clock starts "
      + "once a vendor fix is available.",
  }));

  const scopeChips = scopeBar({
    domain: ctx.domain, supportGroup: ctx.supportGroup, onClear: ctx.clearScope,
  });
  if (scopeChips) main.append(scopeChips);

  const heroHost = el("div", {});
  const chartsHost = el("div", {});
  const survivalHost = el("div", {});
  // The per-severity survival fan and the open-backlog age distribution. Both are pure
  // functions of the SUMMARY payload (`remediation.kmPerSev` and `remediation.aging`), so both
  // get their own host and their own `mttrPaintPlan` slot rather than riding on the
  // Distribution card's toggle — the fan is not a second view of the overall curve, it is six
  // curves the overall one cannot show, and the aging bars measure the OPEN population the
  // survival curve deliberately excludes.
  const fanHost = el("div", {});
  const agingHost = el("div", {});
  const slaHost = el("div", {});
  const byDomainHost = el("div", {});
  main.append(heroHost, chartsHost, survivalHost, fanHost, slaHost, agingHost, byDomainHost);

  // Scope comes from the header switcher — a domain or a support group, at most one of them;
  // "" = no filter on that dimension.
  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";

  // Trends timeframe (days back from now; null = full history). Recalled from
  // localStorage across visits; falls back to All where storage is unavailable.
  let trendWindowDays = loadTrendWindow();
  // Survival-curve x-axis window (weeks); recalled across visits, defaults to 30w.
  let survivalWeeks = loadSurvivalWeeks();
  // In-card toggle modes, recalled across visits. MTTR-over-time clock (KM headline vs the
  // naive closed-only comparison), SLA-quality series (cohort attainment vs net-flow burn),
  // and the distribution view (survival curve vs time-to-resolve histogram).
  let overTimeMode = loadPref("mttrOverTimeMode", ["km", "naive"], "km");
  let slaQualMode = loadPref("mttrSlaQualMode", ["attainment", "burn"], "attainment");
  let distMode = loadPref("mttrDistMode", ["survival", "histogram"], "survival");
  // By-domain "MTTR by domain" chart clock: KM median (censoring-aware, the default) vs the
  // naive closed-only comparison. Persisted across visits like the other in-card toggles.
  let byDomainClock = loadPref("mttrByDomainClock", ["km", "naive"], "km");
  // Which lens the merged by-domain panel shows: "impact" (signed contribution to MTTR — the
  // default) or "median" (per-group KM median vs the overall). Persisted across visits like the
  // clock above; a stale value from an earlier layout degrades to "impact".
  let byDomainLens = loadPref("mttrByDomainLens", ["impact", "median"], "impact");

  // Bumped by every load(); a callback whose seq is stale belongs to a superseded load.
  // DECLARED ABOVE THE FIRST `await load()` DELIBERATELY: `load` is a hoisted function
  // declaration but this is not a hoisted binding, so declaring it after that call put
  // `++loadSeq` in the temporal dead zone and the page died on boot with "Cannot access
  // 'loadSeq' before initialization" — while every unit test still passed, because none of
  // them boots the page.
  let loadSeq = 0;

  await load();

  // Null when every selectable severity is chosen (no filter → shares the default cache
  // entry); otherwise the chosen subset, which the server keeps alongside UNKNOWN.
  function scopeParam() {
    return sevScope.length === boot.palette.selectable.length ? null : [...sevScope];
  }

  // Whether the hero's change chips must be suppressed. ONE DEFINITION ON PURPOSE: the comment
  // at its only former call site records that a scope was once threaded through this page's RPC
  // without joining this predicate, so a domain-scoped median was diffed against a
  // whole-register snapshot. `mttrPaintPlan` needs the same answer — to know whether a page
  // arrival adds anything to the hero — and a second copy is precisely how that recurs.
  function chipsSuppressed() {
    // The prev snapshot (mttr_history) is register-wide across domain/support/severity, while
    // the current values are scoped, so diffing them shows a fake delta. The vendor-fix filter
    // folds in too: with it off the current values exclude no-fix findings while the snapshots
    // never did, which is the same mismatch as any other scope.
    return boot.settings.showNoFix === false
      || scopeParam() !== null || Boolean(domain) || Boolean(supportGroup);
  }


  // One failing section must not blank the rest of the page. Copied from the same shape
  // gas_devsecops/pages/executive.js uses: try/render, and on a throw the section's own host
  // gets `errorState` — an alert with a "Technical details" disclosure — rather than the
  // page silently dropping content or the whole route dying on one section's exception.
  function guard(label, host, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[mttr] " + label + " render failed:", e);
      clear(host).append(errorState("Couldn't render " + label + ".", {
        detail: String((e && e.message) || e),
      }));
    }
  }

  async function load() {
    // Put every section into a pending state before the await, so a severity change never
    // leaves the charts / SLA table showing the old scope's numbers. The skeleton mirrors the
    // real layout so the swap to live content doesn't reflow; by-domain stays cleared.
    renderMttrSkeleton({ heroHost, chartsHost, survivalHost, slaHost });
    clear(fanHost);
    clear(agingHost);
    clear(byDomainHost);
    const params = { domain, supportGroup, severities: scopeParam() };

    // Progressive paint over two parallel RPCs that share the same server cache entries (so a
    // warm revisit is still a single-shot repaint):
    //   - api_getMttr is the summary alone — no trend reconstruction — so the hero, survival
    //     curve and SLA table land as soon as the (cheaper) KM summary is ready.
    //   - api_getMttrPage carries trends + byDomain, the heaviest slice (per-point KM over the
    //     reconstructed history); it fills the chart cards, the per-domain section, and the
    //     hero's history-based change chips when the reconstruction finishes.
    //
    // getMttrPage NO LONGER CARRIES THE SUMMARY — it was byte-identical to the other RPC's
    // whole payload and shipped twice per load. So the two are composed here instead, as two
    // latest-value slots feeding a reducer: `mttrPaintPlan` decides which sections a given
    // arrival should repaint, and every section reads the newest of its OWN inputs. Awaiting
    // the summary promise inside the page handler would be the obvious alternative and is
    // wrong — swrCall re-fires per RPC on revalidation, so an await pins the charts to the
    // first summary forever.
    //
    // `seq` guards re-entrancy: nothing calls load() twice today (the severity scope is
    // fixed for the visit), but every callback below is async and unordered, so the guard
    // stays — without it an older load's callbacks would paint stale numbers over a newer
    // skeleton the moment anything re-enters.
    const seq = ++loadSeq;
    let mttr = null;
    let pageData = null;
    let pagePainted = false;

    const apply = ({ summaryChanged = false, pageChanged = false } = {}) => {
      if (seq !== loadSeq) return;
      const plan = mttrPaintPlan({
        mttr, page: pageData, pagePainted, summaryChanged, pageChanged, scoped: chipsSuppressed(),
      });
      // THE WHOLE `trends` OBJECT TRAVELS TO THE HERO NOW, and under a scope too. This read
      // `plan.historyChips ? pageData.trends : { history: [] }`, which blanked the trend
      // whenever the chips were suppressed — but `historyChips` is a fact about the
      // `mttr_history` SNAPSHOTS, which are register-wide and cannot be diffed against a
      // scoped figure. The reconstructed `trend` beside them IS scoped (api.ts's
      // `mttrTrendData` hands `loadTrend` the pre-filtered base rows), and it is what the
      // header's sparkline draws — so blanking it under a scope cost the aside its entire
      // picture for a reason that was never about it. `renderHero` re-derives the chip
      // suppression from `chipsSuppressed()` itself, which is why one flag can go.
      const heroTrends = pageData ? pageData.trends : { history: [], trend: [] };
      if (plan.hero) guard("the MTTR hero", heroHost, () => renderHero(mttr, heroTrends));
      if (plan.survival) guard("the distribution", survivalHost, () => renderSurvivalCurve(mttr));
      if (plan.fan) guard("the per-severity clock", fanHost, () => renderFan(mttr));
      if (plan.sla) guard("the SLA table", slaHost, () => renderSla(mttr));
      if (plan.aging) guard("open findings by age", agingHost, () => renderAging(mttr));
      if (plan.charts) renderCharts(pageData.trends, mttr);
      if (plan.byDomain) {
        guard("the by-domain breakdown", byDomainHost, () => renderByDomain(pageData.byDomain, mttr));
      }
      if (plan.charts || plan.byDomain) pagePainted = true;
    };
    const onSummary = (next) => { if (next) { mttr = next; apply({ summaryChanged: true }); } };
    const onPage = (next) => { if (next) { pageData = next; apply({ pageChanged: true }); } };

    // THE TWO CATCHES HAVE SWAPPED ROLES, and getting this wrong is the regression this change
    // could ship. The summary is now the only source of the hero, survival curve and SLA
    // table, so if it fails while the page succeeds, nothing renders and all four skeletons
    // pulse forever — it has to be the loud one. The page failing is now survivable: the
    // summary still paints three of five sections, and clearing the two chart hosts also fixes
    // a pre-existing bug where only renderCharts ever cleared chartsHost, so a getMttrPage
    // rejection left it pulsing indefinitely.
    const summary = swrCall("api_getMttr", params, onSummary)
      .then(onSummary).catch((e) => {
        if (seq !== loadSeq) return;
        console.error("[mttr] getMttr failed:", e);
        clear(chartsHost); clear(survivalHost); clear(fanHost); clear(slaHost);
        clear(agingHost); clear(byDomainHost);
        clear(heroHost).append(errorState("Couldn't load remediation data.", {
          detail: String((e && e.message) || e),
        }));
      });
    const full = swrCall("api_getMttrPage", params, onPage)
      .then(onPage).catch((e) => {
        if (seq !== loadSeq) return;
        console.error("[mttr] getMttrPage failed:", e);
        clear(chartsHost).append(errorState("Couldn't load trends.",
          { detail: String((e && e.message) || e) }));
        clear(byDomainHost);
      });
    await Promise.allSettled([summary, full]);
  }

  /** Remediation breakdown that adapts to the sidebar scope (the server tags the payload with
   *  `dimension`): at the unscoped view it splits by manual group — so this is how each
   *  component is doing — and when a single manual group is selected
   *  the by-domain split would be one row, so it splits that domain by SUPPORT GROUP instead.
   *  One renderer serves both; `dim` carries the labels and `groupOf` reads the group name.
   *
   *  Above the table, a chart pair shows how the groups participate in MTTR — both keyed to the
   *  same canonical `byDomain.trend.groups` (resolved-desc, capped at 5 + pooled "Other") so a
   *  group wears one hue across them. One card carries two switchable lenses: "contribution to
   *  MTTR" (default) — signed diverging bars of resolved × (group median − overall median), the
   *  volume-weighted read of who drags the headline figure up vs down — and "median MTTR by …",
   *  each group's KM median ranked against a reference line at the overall KM median (the pure
   *  rate). Beside it, an "MTTR by …" line replays each group's median in days over scan history.
   *  The overall KM median (the baseline both lenses read against) comes from `mttr`, same scope as
   *  these rows. This section is all-time like its table — the Trends timeframe toggle is not wired in. */
  function renderByDomain(byDomain, mttr) {
    clear(byDomainHost);
    if (!byDomain || !byDomain.rows.length) return;
    // The dimension follows the sidebar scope (server-tagged): per-domain at the whole-chain
    // view, per-support-group when a manual group is selected. `dim` carries the copy and
    // `groupOf` reads the group name regardless of which payload shape arrived.
    const isSg = byDomain.dimension === "supportGroup";
    if (isSg) {
      if (byDomain.rows.length < 2) return; // a single support group isn't a split
    } else if (boot.domainNames.length < 2) {
      return;
    }
    const dim = isSg ? SUPPORT_GROUP_DIM : DOMAIN_DIM;
    const groupOf = (r) => r.group ?? r.domain;
    // The overall KM median (same scope as these rows) — the reference line the contribution bars
    // are read against. Null when the payload is a stale pre-KM cache or the overall median is
    // itself censored; the bars then rank without a reference line (see mttrContributionBars).
    const overallKm = mttr?.remediation?.km?.median ?? null;

    // Chart pair over the group trend the server ships alongside the table. Each card swaps
    // its canvas for a muted message when there's nothing to draw (copied from overview.js's
    // Breakdown helpers). Both share one groupPalette so a domain's hue is stable across them.
    const impactCanvas = el("canvas", {});
    const impactMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    const lineCanvas = el("canvas", {});
    const lineMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    const lineCaption = el("p", { class: "chart-caption muted" });
    const medianCanvas = el("canvas", {});
    const medianMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    // The two lenses (contribution / median) share one switchable card, so they share one caption.
    const lensCaption = el("p", { class: "chart-caption muted" });
    // Each canvas's data-table alternative gets its own host, rebuilt on every paint alongside
    // the message-swap above — a `chartTable` built once from a stale `impactRows`/`medianRows`
    // would drift the moment a fresh trend arrives or the lens swaps.
    const lineTableHost = el("div", {});
    const impactTableHost = el("div", {});
    const medianTableHost = el("div", {});

    // Swap a card between its live canvas and a centered muted message.
    function showChart(canvas, msg) {
      msg.style.display = "none";
      canvas.style.display = "";
    }
    function showMsg(canvas, msg, text) {
      // Still fire-and-forget — the message swap below does not wait on the teardown, and
      // there is nothing to destroy if Chart.js never loaded. What it is NOT is a plain
      // `display = "none"`: Chart.js's destroy restores the canvas's pre-chart inline
      // `display` and lands after this line, so the hidden canvas reappears above the message
      // as a bare 300x150 box (see `hideChartWhenSettled`'s own measurement). The canvas stays
      // hidden for exactly as long as the message is up, which is what the predicate reads.
      hideChartWhenSettled(canvas, loadCharts, () => msg.style.display !== "none");
      msg.textContent = text;
      msg.style.display = "";
    }

    // EVERYTHING BELOW DERIVES FROM `trend`, WHICH DOES NOT ARRIVE WITH THE PAGE. The two
    // per-scan x per-group series behind these charts are the per-point KM replay — the heavy
    // half of what this section costs — so `api_getMttrPage` does not carry them and
    // `api_getMttrByDomainTrend` fetches them beside it. The section's page-payload cost is the
    // table and the footnote, both bounded by group count.
    //
    // The split is by data dependency, not by convenience: the table reads `byDomain.rows`, so
    // it paints with the page and the charts land underneath it a beat later, and the awaiting
    // footnote sums those same rows before any trend exists.
    function buildCharts(trend) {
      const groups = (trend && trend.groups) || [];
      const colors = groupPalette(groups);
      const inGroups = new Set(groups);
      // Rows outside the canonical groups pool into an "Other" line series iff any exist — the same
      // pooled remainder the server replays as its "Other" trend point. (The two snapshot lenses show
      // named groups only; this pooled check is just for the trend line's series list.)
      const resolvedOther = byDomain.rows
        .filter((r) => !inGroups.has(groupOf(r)))
        .reduce((a, r) => a + (r.resolved ?? 0), 0);
      const series = groups.map((name) => ({ name, color: colors.get(name) }));
      if (resolvedOther > 0) series.push({ name: "Other", color: colors.get("Other") });

      // Both lenses read the same per-group row (canonical groups only, capped at 5 + a pooled tail
      // the table below carries) with the same median accessor: KM median, falling back to the naive
      // closed-only median when KM is censored to null. Groups with no resolved work or no observable
      // median (too much still open) can't be placed on either chart and are dropped; the count is
      // surfaced in each lens's caption.
      const byName = new Map(byDomain.rows.map((r) => [groupOf(r), r]));
      const medianOf = (r) => r && (r.kmMedian ?? r.median);
      const omittedCount = groups.filter((name) => {
        const r = byName.get(name);
        return r && (r.resolved ?? 0) > 0 && medianOf(r) == null;
      }).length;

      // "Median MTTR by …" lens (secondary): each group's KM median in days, ranked slowest-first and
      // read against the overall-median reference line. NO pooled "Other" bar — medians don't pool, so
      // a fabricated pooled-remainder median would be meaningless.
      const medianRows = groups
        .map((name) => {
          const r = byName.get(name);
          return { label: name, value: medianOf(r), resolved: (r && r.resolved) ?? 0, color: colors.get(name) };
        })
        .filter((g) => g.value != null && g.resolved > 0)
        .sort((a, b) => b.value - a.value);

      // "Contribution to MTTR" lens (default): each group's signed excess finding·days vs the overall
      // median — resolved × (group median − overall median). Positive = the group's resolved findings
      // ran slower than the register median and, weighted by volume, dragged MTTR up; negative = faster,
      // held it down. Unlike a pooled median, this per-row product IS additive, but it still needs the
      // overall baseline, so the whole lens is unavailable when the overall median is itself censored.
      // Sorted desc so the biggest up-drivers sit at the top and the biggest down-drivers at the bottom.
      const impactRows = overallKm == null ? [] : groups
        .map((name) => {
          const r = byName.get(name);
          const med = medianOf(r);
          const n = (r && r.resolved) ?? 0;
          if (med == null || n <= 0) return null;
          return { label: name, value: Math.round(n * (med - overallKm)), median: med, resolved: n, color: colors.get(name) };
        })
        .filter(Boolean)
        .sort((a, b) => b.value - a.value);

      const naivePts = (trend && trend.points) || [];
      const kmPts = (trend && trend.kmPoints) || [];
      // ≥2 scan points = a drawable trend. kmPoints and points share one point-per-flat-scan
      // backbone, so when one is drawable both are — the toggle appears together with the chart.
      const canToggleClock = kmPts.length >= 2 && naivePts.length >= 2;

      // Line: per-domain median MTTR (days) replayed over scan history — KM by default (open
      // findings censored), with the naive closed-only median available via the card toggle.
      function paintLine() {
        const usingKm = byDomainClock === "km";
        const pts = usingKm ? kmPts : naivePts;
        lineCaption.textContent = usingKm
          ? `Kaplan–Meier median time-to-remediation (days) by ${dim.noun}, per scan — still-open findings censored.`
          : `Naive median MTTR (days) by ${dim.noun}, per scan — closed findings only.`;
        if (pts.length < 2) {
          showMsg(lineCanvas, lineMsg, "Trend appears after the second saved scan.");
          clear(lineTableHost);
          return;
        }
        showChart(lineCanvas, lineMsg);
        // `pts` / `series` — the same references the wrapper below is handed.
        clear(lineTableHost).append(chartTable({
          canvas: lineCanvas,
          caption: `Every point of the lines above: date and each ${dim.noun}'s median MTTR, `
            + "in days.",
          model: trendTableModel(pts, series.map((s) => ({
            key: s.name,
            label: s.name,
            format: "days",
            value: (p) => (p && p.byGroup ? (p.byGroup[s.name] ?? null) : null),
          }))),
        }));
        loadCharts().then((charts) => {
          charts.groupTrendLines(lineCanvas, pts, series, {
            unit: "days",
            nullAsGap: true,
            describe: usingKm
              ? `Kaplan–Meier median time-to-remediation in days per ${dim.noun} over scan history.`
              : `Naive median MTTR in days per ${dim.noun} over scan history.`,
          });
        }).catch(() => {
          chartUnavailable(lineCanvas);
        });
      }

      // KM ⇄ Naive clock toggle for the by-domain line — the shared segmented() control, same
      // as the "MTTR over time" card. Repaints the one canvas via `.set()` rather than
      // rebuilding the whole sheet, unlike every OTHER toggle on this page.
      const lineToggle = canToggleClock
        ? segmented({
          options: [{ value: "km", label: "KM" }, { value: "naive", label: "Naive" }],
          value: byDomainClock,
          ariaLabel: `MTTR by ${dim.noun} clock`,
          onChange: pickClock,
        })
        : null;
      function pickClock(v) {
        byDomainClock = v;
        savePref("mttrByDomainClock", v);
        if (lineToggle) lineToggle.set(v);
        paintLine();
      }
      const lineHelp = [
        `KM: Kaplan–Meier median days from first detection to remediation per ${dim.noun}, replayed `
          + "as of each scan; still-open findings censored, so a wave of fresh open findings can't "
          + "bias it down. The principal figure.",
        `Naive: median of closed findings only per ${dim.noun}, per scan — the biased comparison KM `
          + "corrects for, kept only to compare.",
      ];
      // The lines name the ACTIVE dimension ("MTTR by domain"), which is the state of a
      // control rather than part of the definition -- so they stay, and `term` adds the
      // route to the dimension-neutral entry.
      const lineTitle = el("h3", {},
        tip(`MTTR by ${dim.noun}`, lineHelp, { term: "mttr-by-dimension" }));
      const lineHead = lineToggle ? el("div", { class: "chart-head" }, lineTitle, lineToggle) : lineTitle;

      // Unified by-domain panel: "Contribution to MTTR" (signed impact) and "Median MTTR by …" (rate)
      // are two lenses on the same groups — who drags the headline figure up/down, weighted by volume,
      // vs how slow each group is on its own — so they share one card switched by a segmented toggle
      // instead of two separate cards. It sits in a row with the "MTTR by domain" line; the lens persists.
      const impactHelp = [
        `Each ${dim.noun}'s resolved findings × (its KM median − the overall KM median), in finding·days. `
          + `Right of the zero line the ${dim.noun} closed slower than the register median and — scaled by `
          + `how much it closed — dragged the headline MTTR up; left of it the ${dim.noun} closed faster and `
          + "held MTTR down. The zero line is the overall median: no drag.",
        `Leverage, not just rate: a slightly-slow ${dim.noun} that closes a lot outweighs a very-slow one `
          + `that closes little, and a fast high-volume ${dim.noun} reads as the down-driver it is. A proxy, `
          + "not an exact split — the overall KM median is a censored-survival statistic, not a weighted "
          + `average of per-${dim.noun} medians — so read the magnitudes as relative, not an exact day count.`,
      ];
      const medianHelp = [
        `Each ${dim.noun}'s Kaplan–Meier median time-to-remediation, ranked slowest first against the `
          + `dashed line at the overall KM median. Bars past the line take longer than the register `
          + `median — these ${dim.noun}s pull the headline MTTR up; bars short of it pull it down.`,
        `The pure rate, ignoring volume: a very-slow ${dim.noun} tops this even if it closed only a `
          + `handful. The contribution lens weights the same medians by resolved count for real leverage; `
          + "hover a bar here for that count.",
      ];
      const lensTitleHost = el("h3", {}); // retitled per lens by applyLens
      // A single circular-arrows button swaps the two lenses (contribution ⇄ median). The card title
      // names the active lens, so one icon toggle reads cleaner than two buttons; its aria-label /
      // title announce what the next click switches to (updated in applyLens).
      const swapBtn = el("button", { type: "button", class: "chart-swap" });
      swapBtn.innerHTML = SWAP_ICON;
      swapBtn.addEventListener("click", () =>
        pickLens(byDomainLens === "impact" ? "median" : "impact"));
      // Both canvases live in one box (same height as the line card so the row aligns); the inactive
      // one starts hidden so there's no flash before the first paint in the rAF below.
      impactCanvas.style.display = byDomainLens === "impact" ? "" : "none";
      medianCanvas.style.display = byDomainLens === "median" ? "" : "none";
      const lensCard = el("div", { class: "chart-card" },
        el("div", { class: "chart-head" }, lensTitleHost, swapBtn),
        el("div", { class: "chart-box" }, impactCanvas, impactMsg, medianCanvas, medianMsg),
        lensCaption, impactTableHost, medianTableHost);

      // Switch the lens: flip aria-pressed, retitle with the matching help, tear down the hidden
      // chart, and paint the active one (each paint fn shows its own canvas / empty message).
      function applyLens(view) {
        byDomainLens = view;
        // The label names what the *next* click switches to (the title already names the current lens).
        const nextLabel = view === "impact"
          ? `Show median MTTR by ${dim.noun}` : `Show ${dim.noun} contribution to MTTR`;
        swapBtn.setAttribute("aria-label", nextLabel);
        swapBtn.title = nextLabel;
        clear(lensTitleHost).append(
          view === "impact"
            ? tip(`${dim.Noun} contribution to MTTR`, impactHelp,
              { term: "mttr-contribution" })
            : tip(`Median MTTR by ${dim.noun}`, medianHelp,
              { term: "median-mttr-by-dimension" }));
        const [hideCanvas, hideMsg, hideTableHost] = view === "impact"
          ? [medianCanvas, medianMsg, medianTableHost]
          : [impactCanvas, impactMsg, impactTableHost];
        // Tear the outgoing lens down and keep it hidden — Chart.js's destroy restores the
        // canvas's pre-chart inline `display` and lands after any synchronous hide, which is
        // what put a 300x150 ghost canvas inside this card's 240px box. The predicate re-reads
        // `byDomainLens` rather than trusting `view`, so a swap back while the first teardown
        // is still in flight leaves the live canvas alone.
        hideChartWhenSettled(hideCanvas, loadCharts,
          () => hideCanvas !== (byDomainLens === "impact" ? impactCanvas : medianCanvas));
        hideMsg.style.display = "none";
        clear(hideTableHost);
        if (view === "impact") paintImpact(); else paintMedian();
      }
      function pickLens(view) {
        savePref("mttrByDomainLens", view);
        applyLens(view);
      }

      // `chart-grid--2`, matching the skeleton this replaces and the Trends row above it. The
      // bare `chart-grid` it used to carry is a 3-up template, which auto-fit collapses to two
      // halves for two cards anyway — indistinguishable inside an 820px drawer, and a needless
      // second answer to "how wide is a two-card row" now that the row is on the page.
      const chartPair = el("div", { class: "chart-grid chart-grid--2", style: "align-items:start" },
        lensCard,
        el("div", { class: "chart-card" },
          lineHead,
          el("div", { class: "chart-box" }, lineCanvas, lineMsg),
          lineCaption, lineTableHost),
      );

      // Shared omission note for both lenses — named groups with resolved work but no observable
      // median (too much still open) are dropped from either chart.
      const omittedNote = omittedCount > 0
        ? ` ${omittedCount} ${dim.noun}${omittedCount === 1 ? "" : "s"} omitted — too much still open `
          + "to estimate a median."
        : "";

      // Contribution lens (default): signed excess finding·days vs the overall median — right of the
      // zero line drags MTTR up, left holds it down. Needs the overall baseline, so when the overall
      // median is itself censored (overallKm null) the whole lens shows a muted note instead.
      function paintImpact() {
        lensCaption.textContent = `Each ${dim.noun}'s resolved findings × (its median − the overall `
          + `median), in finding·days — right of the line drags MTTR up, left holds it down.${omittedNote}`;
        if (overallKm == null) {
          showMsg(impactCanvas, impactMsg,
            "The overall KM median isn't observable yet — too much is still open to baseline contribution.");
          clear(impactTableHost);
          return;
        }
        if (!impactRows.length) {
          showMsg(impactCanvas, impactMsg, "No resolved findings with an observable median to attribute.");
          clear(impactTableHost);
          return;
        }
        showChart(impactCanvas, impactMsg);
        // `impactRows` — the same array the wrapper below is handed.
        clear(impactTableHost).append(chartTable({
          canvas: impactCanvas,
          caption: `Every bar above: ${dim.noun} and its signed contribution to MTTR, in `
            + "finding·days.",
          model: barsTableModel(impactRows, "Contribution (finding·days)", { labelHeading: dim.Noun }),
        }));
        loadCharts().then((charts) => {
          charts.mttrImpactBars(impactCanvas, impactRows, { subject: `${dim.Noun} contribution to MTTR` });
        }).catch(() => {
          chartUnavailable(impactCanvas);
        });
      }

      // Median lens (secondary): each group's KM median MTTR against the overall-median reference line —
      // a bar past the line is a group slower than the register median. Slowest-first (medianRows is
      // pre-sorted desc), so the up-drivers read top-down.
      function paintMedian() {
        const refClause = overallKm != null
          ? " vs the overall median (dashed) — bars past the line pull the headline MTTR up."
          : " — ranked slowest first.";
        lensCaption.textContent = `Each ${dim.noun}'s KM median MTTR${refClause}${omittedNote}`;
        if (!medianRows.length) {
          showMsg(medianCanvas, medianMsg, "No resolved findings with an observable median to rank.");
          clear(medianTableHost);
          return;
        }
        showChart(medianCanvas, medianMsg);
        // `medianRows` — the same array the wrapper below is handed.
        clear(medianTableHost).append(chartTable({
          canvas: medianCanvas,
          caption: `Every bar above: ${dim.noun} and its Kaplan–Meier median MTTR, in days.`,
          model: barsTableModel(medianRows, "Median MTTR", { format: "days", labelHeading: dim.Noun }),
        }));
        loadCharts().then((charts) => {
          charts.mttrContributionBars(medianCanvas, medianRows, {
            overall: overallKm,
            subject: `${dim.Noun} median MTTR vs overall`,
          });
        }).catch(() => {
          chartUnavailable(medianCanvas);
        });
      }
      return {
        chartPair,
        paint: () => { applyLens(byDomainLens); paintLine(); },
      };
    }
    // `dataTable`, not a hand-rolled `<table class="data">`: eight static columns, one header
    // row, no colspan. The column definitions carried their help copy already, so the only
    // change a reader sees is that the seven numeric headings now sit over their own figures
    // (`col.className` reaches the <th>, and `table.data th.num` right-aligns it) and a group
    // name too long for the 320px cell cap can be read from its truncTip instead of ending in
    // an ellipsis. It returns the `.table-wrap` — the old code wrapped the table by hand, and
    // wrapping this again would nest two.
    const tableWrap = dataTable({
      columns: [
        {
          key: "group",
          label: dim.Noun,
          help: [`The ${dim.noun} this row summarizes remediation for.`],
          cell: groupOf,
        },
        {
          key: "kmMedian",
          label: "Median MTTR (KM)",
          className: "num num--key",
          help: [`Kaplan–Meier median time-to-remediation for this ${dim.noun} — the principal MTTR figure. `
            + "Still-open findings count as censored instead of being ignored, so it isn't biased "
            + "low by fresh fast-patched vulns."],
          cell: (r) => fmtSpan(r.kmMedian),
        },
        {
          key: "median",
          label: "Median (naive)",
          className: "num",
          help: [`Median days from first detection to remediation for this ${dim.noun}, counting closed `
            + "findings only — no censoring. Biased low by a wave of fresh open findings, which is "
            + "what the KM median corrects for; kept only for comparison."],
          // `.muted small` rides on a span rather than on the column, because `col.className`
          // reaches the heading too: `.small` is 12px against a heading's 11px and `.muted` a
          // lighter grey, so spending them there would restyle one heading out of eight.
          cell: (r) => el("span", { class: "muted small" }, fmtSpan(r.median)),
        },
        {
          key: "p90",
          label: "MTTR p90",
          className: "num",
          help: ["Kaplan–Meier 90th-percentile time-to-remediation — the slow tail. Nine in ten " +
            "findings beat it; one in ten is slower. Censoring-aware like the KM median (read off " +
            "the same survival curve), so the tail isn't biased low by fresh fast-patched vulns; " +
            "shows \"—\" when too much is still open to observe it."],
          cell: (r) => fmtSpan(r.p90),
        },
        {
          key: "slaPct",
          label: "In SLA (of resolved)",
          className: "num",
          help: ["Share of resolved findings closed within their severity's SLA target — " +
            "CRITICAL 7d · HIGH 14d · MEDIUM 30d · LOW 90d · INFO 180d."],
          // Null here means the group has closed nothing yet, so there is no share to state.
          cell: (r) => (r.slaPct != null ? `${r.slaPct.toFixed(0)}%` : absent()),
        },
        {
          key: "openPastSla",
          label: "Open past SLA",
          className: "num",
          help: ["Open findings already older than their severity's SLA target, measured from when " +
            "a vendor fix became available. Unlike In-SLA % (which only scores resolved " +
            "findings), an aged-out open CRITICAL counts here."],
          cell: (r) => fmtOpenPastSla(r.openPastSla),
        },
        {
          key: "open",
          label: "Open",
          className: "num",
          help: [`Findings in this ${dim.noun} not yet resolved.`],
          cell: (r) => (r.open ?? 0).toLocaleString(),
        },
        {
          key: "resolved",
          label: "Resolved",
          className: "num",
          help: [`Findings in this ${dim.noun} already resolved.`],
          cell: (r) => (r.resolved ?? 0).toLocaleString(),
        },
      ],
      rows: byDomain.rows,
    });

    // Awaiting-vendor-fix findings aren't a column (they don't breach any SLA) — a footnote
    // sums the per-domain `awaiting` counts so the excluded population is still visible.
    // Hidden entirely when the vendor-fix filter is off (the counts arrive zeroed anyway, and
    // the page-level honesty note already covers it).
    const awaitingTotal = byDomain.rows.reduce((a, r) => a + (r.awaiting ?? 0), 0);
    const footnote = boot.settings.showNoFix !== false && awaitingTotal > 0
      ? el("p", { class: "small muted", style: "margin:8px 0 0" },
        `${awaitingTotal.toLocaleString()} open finding${awaitingTotal === 1 ? "" : "s"} across `
        + `these ${dim.noun}s are awaiting a vendor fix — excluded from Open past SLA until a fix appears.`)
      : null;

    // NOTHING IS SET ASIDE ANY MORE, and this is where a footnote used to say otherwise.
    // Resolved history carrying no attribution input — compacted episodes and imported rows —
    // was dropped from the split and reported here, because counting it as Unassigned would
    // have swamped the breakdown with a bucket that has no live counterpart. It now gets a
    // bucket of its own, "Not attributable", sorted last, so the population is a row you can
    // read rather than a number in a note under a table it is missing from.

    // ON THE PAGE, NOT BEHIND A BUTTON. This section spent a while in a right-drawer opened by
    // an "Open domain breakdown →" button, on a progressive-disclosure argument. It reads worse
    // there than it does here, for three reasons the drawer could not fix: it is the last
    // section of the page, so it stacks under nothing and crowds nothing; its table is eight
    // columns wide and the drawer had to be widened to 820px to stop it cramping, which is a
    // page's width asked for inside an overlay; and the two cards answer "who is dragging the
    // headline figure" — the question the hero above raises — which is a poor thing to hide
    // one click away from the figure that raises it. The drawer stays for a RECORD (one
    // finding, one scan's query): a thing you inspect and dismiss, not a section of the page.
    //
    // THE PAYLOAD SPLIT SURVIVES THE MOVE, and deliberately. `api_getMttrPage` still does not
    // carry the two per-scan × per-group series behind these charts — the per-point KM replay
    // is the heavy half — so the table and the footnote paint from the page payload already in
    // hand and the charts fill in from their own RPC underneath. The visible cost of that is
    // one skeleton pair on a cold load rather than a section that arrives late whole. What
    // changed is only WHEN that RPC fires: on render, since there is no longer a drawer-open
    // event to hang it on.
    const chartHost = el("div", { role: "status", "aria-label": "Loading trend charts" },
      el("div", { class: "chart-grid chart-grid--2", style: "align-items:start" },
        ...[0, 1].map(() => el("div", { class: "chart-card" },
          el("div", { style: "margin-bottom:12px" }, skeleton("line", { width: "140px" })),
          el("div", { class: "chart-box" }, skeleton("chart"))))));

    byDomainHost.append(sectionLabel(dim.title, { lines: dim.help }));
    byDomainHost.append(chartHost, tableWrap);
    if (footnote) byDomainHost.append(footnote);

    swrCall("api_getMttrByDomainTrend",
      { domain, supportGroup, severities: scopeParam() },
      (fresh) => absorbTrend(chartHost, fresh))
      .then((t) => absorbTrend(chartHost, t))
      .catch((e) => {
        console.error("[mttr] getMttrByDomainTrend failed:", e);
        if (!chartHost.isConnected) return;
        clear(chartHost).append(errorState("Couldn't load the trend charts.",
          { detail: String((e && e.message) || e) }));
      });

    /** Swap the skeleton for the real chart pair. Re-entrant: swrCall fires again on
     *  revalidation, and a second arrival must replace the first rather than stack beneath it.
     *
     *  The `isConnected` guard is MORE load-bearing here than it was in the drawer, not less.
     *  It used to cover one race — the reader closing the sheet mid-flight. On the page it also
     *  covers the section's own repaint: `renderByDomain` runs again on every `plan.byDomain`
     *  tick and opens with `clear(byDomainHost)`, so a request in flight from the previous run
     *  resolves against a `chartHost` that has been detached, and appending to it would paint
     *  the old scope's charts into nothing. */
    function absorbTrend(host, trend) {
      if (!host.isConnected) return;
      const built = buildCharts(trend || {});
      clear(host).removeAttribute("aria-label");
      host.append(built.chartPair);
      requestAnimationFrame(built.paint);
    }
  }

  /**
   * The hero strip: ONE figure, one qualifying curve, and the supporting facts as a stat row.
   *
   * WHAT MOVED AND WHY. This page used to build its own `.hero` block: a 2rem KM median, a
   * second `kpi-value` naive median beside it, a `.hero-src` sentence, a `latencyLine`, and a
   * four-tile `.hero-minis` band — five different figure weights invented on this page and
   * nowhere else in the register, against the shared `pageHeader({hero, aside, stats})` that
   * Executive and Coverage & efficiency already use. It is that component now: `heroStat` is
   * the single hero value (DESIGN.md: at most one per page), the two secondary sentences are
   * `heroLines` under it, and the minis are `statRow`s — which is what buys them a `meter`
   * slot the hand-rolled tile never had.
   *
   * NO `route` HERE. The page's `<h1>` is in the title block appended once at the top of
   * `renderMttr`; `test/contracts/pageHeader.js` allows exactly one `route:` header per page,
   * so this one carries the figure and its stats and no heading. Two stacked `.page-header`
   * blocks is the shape gas_devsecops's own MTTR page has.
   *
   * WHAT DID NOT MOVE. The change chips stay, and stay suppressed under a scope — the
   * `mttr_history` snapshots are register-wide while these values are scoped, so diffing them
   * shows a fake delta (`chipsSuppressed`, which records the release where a scope was added
   * to the RPC and never joined that predicate). "not measured" stays the visible VALUE
   * wherever a base is empty, and "at least N days" stays the visible hero value on a bound.
   */
  function renderHero(mttr, trends) {
    clear(heroHost);
    if (!mttr.rowCount) {
      if (!boot.latestScan) {
        // Nothing has been READ yet — the shared first-run notice, not this page's own words
        // for the same state.
        heroHost.append(firstRunNotice({
          synced: !!boot.latestScan,
          at: boot.latestScan?.ts,
          hint: "MTTR needs at least one saved scan with resolved findings.",
        }));
      } else {
        // A scan exists but tracked no lifecycle this page can measure MTTR over — a
        // structural absence (the register may genuinely have nothing resolved yet), not a
        // claim that the ledger has never been read.
        heroHost.append(emptyState(
          "No lifecycle data yet.",
          "MTTR needs at least one saved scan with resolved findings.",
        ));
      }
      return;
    }

    const hist = (trends && trends.history) || [];
    const prev = hist.length > 1 ? hist[hist.length - 2] : null;
    // The prev snapshot (mttr_history) is global across domain/support/severity, while the
    // current values are scoped by the active filters. Diffing them would show a fake delta
    // (a small domain's 5d vs the global 45d prev reads as "−40d"), so only show the change
    // chips at the unscoped whole-register / all-severities view where the populations match.
    // EVERY SCOPE THE SHELL CAN HOLD HAS TO BE LISTED IN `chipsSuppressed`, and for one release
    // one was not: the VC Domain dimension was threaded through this page's RPC but never
    // joined that predicate, so a domain-scoped median was diffed against the whole-register
    // snapshot and drew exactly the fake "−40d" this paragraph warns about.
    const scoped = chipsSuppressed();

    // `remediation` is additive on the server (see the plan) — a stale cached response from
    // before a rollout won't carry it, so every read below is optional-chained and every
    // affected row degrades to "not measured" rather than throwing.
    const rem = mttr.remediation;
    const km = rem?.km; // KMResult — the primary MTTR methodology
    const view = mttrHeroView(mttr);
    // Actionable-clock open-past-SLA, falling back to the from-detection value for a stale
    // pre-actionable cache (both share the {open, breached, pct} shape).
    const openPastSla = rem?.openPastSlaActionable?.overall ?? rem?.openPastSla?.overall;
    const overallPctiles = rem?.pctiles?.overall; // {p50, p90, count}
    // Censoring-aware overall p90 (same survival curve as the KM median). `undefined` means a
    // stale pre-kmP90 cache → fall back to the naive p90; `null` means present but
    // unobservable under censoring, which `kmP90View` renders as an absence with a reason.
    const overallKmP90 = rem?.kmP90;
    const awaiting = rem?.awaiting; // {perSev, overall, openTotal, pctOfOpen}

    const overallSla = rateView(
      mttr.slaPct, view.resolved, fmtCount(view.resolved) + " resolved",
    );

    heroHost.append(pageHeader({
      hero: heroStat(
        "Remediation half-life" + (domain ? " — " + domain : ""),
        view.value,
        heroLines(
          view.qualifier,
          naiveClause(km, prev, scoped),
          latencyLine(rem?.vendorLatency, rem?.disclosureLatency),
        ),
        heroHelp(view),
      ),
      aside: trendAside(halfLifeTrendPoints(trends)),
      stats: [
        slaStatRow(overallSla, prev, scoped),
        pastSlaStatRow(openPastSla, prev, scoped),
        p90StatRow(overallKmP90 !== undefined ? overallKmP90 : overallPctiles?.p90, km),
        openAgeStatRow(mttr, prev, scoped),
        ...(awaiting && awaiting.overall !== null && awaiting.overall !== undefined
          && boot.settings.showNoFix !== false
          ? [awaitingStatRow(awaiting)]
          : []),
      ],
    }));
  }

  /**
   * The naive closed-only median, as the hero's second sentence rather than a second figure.
   *
   * It used to be a `kpi-value` beside the 2rem hero, which is two headline figures on one
   * page — DESIGN.md allows one. It is the BIASED comparison the Kaplan–Meier headline exists
   * to correct for, so it belongs beside the estimate as a qualifier, not opposite it as a
   * rival. It is also the one MTTR figure with a persisted history series, so it keeps its
   * change chip — at the unscoped view only, where the snapshot describes the same population.
   */
  function naiveClause(km, prev, scoped) {
    const naive = km?.naiveMedian ?? null;
    const chip = !scoped && prev && prev.median_days !== null && prev.median_days !== undefined
      && naive !== null
      ? changeChip(naive, prev.median_days, { fmt: fmtSpan })
      : null;
    return el("span", {},
      tipLabel("Median (naive, closed)", { term: "naive-median" }),
      ": ",
      el("span", { class: "num" }, fmtSpan(naive)),
      chip);
  }

  /**
   * The hero label's tip: the STATE picks the lines, and the LABEL picks the term.
   *
   * `kmHalfLifeView` puts "at least 297 days" in the 2rem slot, so the words are already on the
   * surface and only the explanation moves. The term stays `half-life` in every state — the
   * trigger is on the words "Remediation half-life", so that is the entry Enter goes to, and a
   * control whose destination changes with the data is one a reader cannot learn. The bound's
   * own sentence LEADS the lines instead; `lower-bound` stays reachable from the Key sheet, and
   * `km-median` from this page's own title header.
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
   * `pageHeader({aside})` is documented for exactly this ("a small curve"), and it was empty on
   * this page while the series it wants sat in the "MTTR over time" card a screen further down.
   * `sparkline` is inline SVG with no library, `role="img"`, and an `aria-label` that always
   * states first / last / low / high — so the picture has a text alternative and the caption
   * underneath does not have to be one.
   *
   * BORDERLESS AND CAPPED (`.trend-aside`, pages.css): DESIGN.md's Hero Stat rule is that the
   * hero's dominance comes from size and whitespace, so a bordered card here would out-weigh it.
   *
   * FEWER THAN TWO READINGS DRAWS THE LABEL, NEVER NOTHING. `sparkPath` returns `d: ""` for a
   * single reading (one point is not a trend) and for none at all; `sparkLabel` is the words for
   * both cases, and they are printed as the caption rather than the picture silently
   * disappearing from a slot that is there on every other paint. AND WHEN NOTHING IS DRAWN THE
   * BOX GOES WITH IT: this aside is a single strip, so an empty 220x40 box between the label and
   * the caption is a hole with nothing to align to.
   *
   * A NULL READING IS A GAP, NOT A ZERO. `km_median_days` is null on every reconstructed date
   * whose curve never reached half, and `halfLifeTrendPoints` keeps those slots so the x axis
   * stays time rather than compressing to the measured readings; `sparkPath` counts them and
   * the caption prints the count.
   */
  function trendAside(points) {
    const list = Array.isArray(points) ? points : [];
    const values = list.map((p) => p.km_median_days);
    const model = sparkPath(values, { w: 220, h: 40 });
    const measured = model.gaps
      ? fmtCount(model.n) + " of " + fmtCount(values.length) + " readings measured"
      : fmtCount(model.n) + " readings";
    // A FLAT SERIES SAYS IT IS FLAT. "199 days to 199 days" is two readings of one fact; the
    // sparkline draws a straight line for exactly this case and the caption should agree with
    // the picture rather than restate an endpoint twice.
    const range = model.first === model.last
      ? "flat at " + fmtDays(model.first)
      : fmtDays(model.first) + " to " + fmtDays(model.last);
    // FEWER THAN TWO READINGS STILL OWES A DENOMINATOR, and on this register that is the
    // NORMAL case rather than the edge one. Measured on the dev harness: 211 evaluated dates,
    // exactly ONE of which carries a half-life — the register's curve does not reach half on
    // any earlier date, so `km_median_days` is null on the other 210. `sparkLabel` alone says
    // "one reading, 31.9 days", which reads as a young series rather than as an old one nobody
    // could measure, so the gap count joins it whenever there are gaps to name.
    const caption = model.n >= 2
      ? measured + ", " + range
      : model.gaps
        ? sparkLabel(model, "", "days") + " (" + measured + ")"
        : sparkLabel(model, "", "days");
    return el("div", { class: "page-strip trend-aside" },
      el("div", { class: "kpi-label" }, tipLabel("Half-life over time", {
        lines: [
          "One reading per saved scan, plus one per day of pre-scan history reconstructed from"
          + " first-detection dates.",
          "The full line, and which readings are reconstructed, is in the MTTR over time card"
          + " below.",
        ],
      })),
      (model.d || model.end)
        ? sparkline(values, {
          label: "Remediation half-life over time", unit: "days", w: 220, h: 40,
        })
        : null,
      el("div", { class: "small muted" }, caption));
  }

  /**
   * "In SLA (of resolved)" as a stat cell rather than a bare percentage.
   *
   * The `meter` is `statRow`'s own slot and takes the rate; a rate with no base gets NO meter
   * rather than an empty track, because `meter(null)` would resolve to a confident 0% fill —
   * `Number(null)` is 0 and finite, CLAUDE.md's third recording of it — over a population
   * nobody measured. The empty case keeps its own words in both places: "not measured" is the
   * value (`rateView.text`), and the missing population is named in the sub-line.
   */
  function slaStatRow(rate, prev, scoped) {
    const chip = !scoped && prev && prev.sla_pct !== null && prev.sla_pct !== undefined
      && rate.measured
      ? changeChip(rate.value, prev.sla_pct, { invert: true, suffix: "%" })
      : null;
    return statRow(
      "In SLA (of resolved)",
      chip ? el("span", {}, rate.text, chip) : rate.text,
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
          "The clock starts when a vendor fix became available, and the comparison is"
          + " inclusive — on or before the target.",
        ],
      },
    );
  }

  /**
   * "Open past SLA" — the COUNT, with its share of the open backlog as the meter.
   *
   * TWO DIFFERENT DENOMINATORS SIT IN THIS STRIP and mixing them is the mistake this shape
   * stops. "In SLA" is taken over RESOLVED findings; this one is taken over OPEN findings — of
   * the ones still running, how many have already blown it. A single "SLA %" over everything
   * would be neither, and the two sub-lines name their own base for that reason.
   */
  function pastSlaStatRow(openPastSla, prev, scoped) {
    const open = num(openPastSla && openPastSla.open, 0);
    const breached = num(openPastSla && openPastSla.breached);
    const rate = rateView(
      openPastSla && openPastSla.pct, open, fmtCount(open) + " open",
      "no finding is open",
    );
    const chip = !scoped && prev && prev.open_past_sla !== null
      && prev.open_past_sla !== undefined && breached !== null
      ? changeChip(breached, prev.open_past_sla)
      : null;
    const value = fmtCount(breached);
    return statRow(
      "Open past SLA",
      chip ? el("span", {}, value, chip) : value,
      rate.baseEmpty ? rate.emptyLabel : rate.text + " of " + rate.denominatorLabel,
      meterPctFor(rate),
      {
        term: "sla-target",
        lines: [
          "Taken over what is still RUNNING: of the findings still open, the share already past"
          + " their severity's target, measured from when a vendor fix became available.",
          "Unlike In SLA — which only scores findings that closed — an aged-out open CRITICAL"
          + " counts here.",
        ],
      },
    );
  }

  /** The slow tail, and the sub-line it is allowed to carry — `kmP90View` owns the three-state
   *  decision (measured / the curve never reached it / nothing has closed at all). */
  function p90StatRow(p90, km) {
    const p = kmP90View(p90, km);
    return statRow("MTTR p90", p.value, p.note, null, {
      term: "half-life",
      lines: [
        "Kaplan–Meier 90th-percentile time-to-remediation — the slow tail, read off the same"
        + " survival curve as the half-life above.",
        "Censoring-aware, so a wave of fresh fast-patched findings cannot bias it low.",
      ],
    });
  }

  /** How old the open backlog is — the p90 of open-finding age, not the single oldest. */
  function openAgeStatRow(mttr, prev, scoped) {
    const chip = !scoped && prev && prev.oldest_open_days !== null
      && prev.oldest_open_days !== undefined && mttr.oldestDays !== null
      ? changeChip(mttr.oldestDays, prev.oldest_open_days, { fmt: fmtSpan })
      : null;
    const value = fmtSpan(mttr.oldestDays);
    return statRow(
      "Open age p90",
      chip ? el("span", {}, value, chip) : value,
      "nine in ten open findings are younger",
      null,
      { term: "age" },
    );
  }

  /**
   * "Awaiting vendor fix" as a stat cell, with its share of the open backlog as the meter.
   *
   * The figure is the COUNT of open findings with no published fix; the meter is that count's
   * share of the open backlog, which is the rate the old source-line sentence carried. Both
   * were in one clause before, and the count was the only one of the two a reader could act on.
   * Dropped entirely when the vendor-fix filter is off — the count arrives zeroed then, and a
   * zero that means "we excluded them" is exactly the zero this register refuses to print.
   */
  function awaitingStatRow(awaiting) {
    const openTotal = num(awaiting.openTotal, 0);
    const rate = rateView(
      awaiting.pctOfOpen, openTotal, fmtCount(openTotal) + " open findings",
      "no finding is open",
    );
    return statRow(
      "Awaiting vendor fix",
      fmtCount(awaiting.overall),
      rate.baseEmpty ? rate.emptyLabel : rate.text + " of " + rate.denominatorLabel,
      meterPctFor(rate),
      {
        term: "awaiting-fix",
        lines: [
          "Open findings with no published fix. Those sit outside every deadline until a fix"
          + " exists, which is why the actionable clock starts there and not at detection.",
          "They are still counted in the survival estimate above as censored observations —"
          + " dropping them would leave only the findings that got fixed.",
        ],
      },
    );
  }

  /**
   * The fan: one small-multiple survival curve per severity, above the summary table that
   * reduces each of them to three numbers.
   *
   * WHY IT EXISTS. `remediation.kmMedianPerSev` / `kmP90PerSev` have shipped for releases and
   * the staircase they were read off was thrown away on the server — so no surface in this
   * register could compare severity survival SHAPES, and three fixed statistics cannot say
   * that CRITICAL closes fast and then stalls, or that LOW never moves at all. `kmPerSev` is
   * that same curve, narrowed by the SAME `shipKM` on the server, so the fan and the table are
   * two views of ONE estimate rather than two estimates.
   *
   * COLOUR IS NEVER THE ONLY CUE. Six curves in one grid is where PRODUCT.md's accessibility
   * bar bites hardest — the red/orange/amber band separates by 1.6 under deuteranopia — so
   * every card carries the severity BADGE as its heading and a caption stating the half-life
   * in words, and the marker legend inside each canvas names the severity rather than "all".
   *
   * A SEVERITY WITH NO STEPS IS SKIPPED AND SAID. An axis with no staircase asserts
   * "measured, and flat"; the severity simply had nothing to plot. Vanishing from a grid whose
   * own table still lists the severity is the absence a reader would read as a bug, so the
   * skipped ones are named in one line under the fan.
   */
  function renderFan(mttr) {
    clear(fanHost);
    // See `renderAging` for why: on an unread ledger the hero's first-run notice is the whole
    // page, and a heading with nothing under it reads as a measured emptiness.
    if (!mttr.rowCount) return;
    const cards = severityCurvesView(mttr.remediation, boot.palette.order);
    const skipped = cards.skipped || [];
    if (!cards.length && !skipped.length) return;

    fanHost.append(sectionLabel("The clock, by severity", {
      term: "half-life",
      lines: [
        "Each severity's curve here and its row in the table below are one estimate read two"
        + " ways — the table is that curve's median, its lower bound and its P90.",
        "Open findings are in every curve as right-censored observations, so a staircase that"
        + " stops stepping is a severity that stopped closing.",
      ],
    }));

    if (cards.length) {
      const grid = el("div", { class: "sev-fan" });
      const pending = [];
      for (const card of cards) {
        const canvas = el("canvas", {
          "aria-label": "Kaplan–Meier survival curve for " + card.sev + " findings",
        });
        grid.append(chartCard(null, el("div", { class: "chart-box" }, canvas), {
          head: el("div", { class: "sev-fan__head" }, sevBadge(card.sev)),
          note: card.caption,
          // The same `card.curve` reference the wrapper below is handed, named once — the one
          // rule ui/chartTable.js exists to enforce.
          table: chartTable({
            canvas,
            caption: "Every step of this severity's curve: weeks and days since detection, and"
              + " the share of " + card.sev + " findings still open after that step.",
            model: survivalTableModel(card.curve),
          }),
        }));
        pending.push({ canvas, card });
      }
      fanHost.append(grid);
      loadCharts().then((charts) => {
        for (const { canvas, card } of pending) {
          charts.survivalCurve(
            canvas,
            card.curve,
            // Two KM markers and no closed-only comparison: `shipKM` does not send
            // `naiveMedian`/`naiveMean` per severity, and inventing a marker the payload does
            // not carry is how a card would claim a statistic nobody computed.
            { median: card.median, mean: card.mean },
            // The severity FILL, read off the bootstrap palette — never the register blue,
            // which would make six cards one colour. `scope` is what stops each card's legend
            // claiming "all": the diamond here is THIS severity's restricted mean.
            {
              color: boot.palette.colors[card.sev],
              subject: "for " + card.sev + " findings",
              scope: card.sev,
            },
          );
        }
      }).catch(() => {
        for (const { canvas } of pending) chartUnavailable(canvas);
      });
    }

    if (skipped.length) {
      // NOT A DASH AND NOT A GAP IN THE GRID. These severities have rows and an estimate; what
      // they have not got is a single event to step down on, so there is no staircase to draw.
      fanHost.append(el("p", { class: "small muted" },
        "No curve drawn for " + skipped.join(", ") + " — "
        + (skipped.length === 1 ? "that severity has" : "those severities have")
        + " no closed finding to step the estimate down on yet."));
    }
  }

  /**
   * The open backlog as a SHAPE, with the SLA edge said out loud.
   *
   * WHY THIS SECTION EXISTS BESIDE the per-severity table above it. That table's "Open past
   * SLA" is the same open population reduced to one ratio per severity, and a ratio cannot say
   * whether the breaches are eight days late or eight hundred.
   *
   * The table under the canvas is built from the SAME `vm.labels` / `vm.perSev` the chart
   * wrapper is handed, named once here — `ui/chartTable.js`'s one rule. Its "Past SLA for"
   * column is the accessible half of the edge: a reader who cannot see a dashed rule, or for
   * whom no rule was drawn because the five deadlines disagree, still reads which severities
   * are wholly late in each bar.
   *
   * NO TOTAL COLUMN, deliberately, and `pages/_charts.js`'s `agingTableModel` header has the
   * reason: a stacked total looks obvious and is not, because a null bucket count would have
   * to be summed as a zero to produce one. `agingView` computes a null-poisoned `row.total`
   * for exactly that case and the section's own `chart-note` carries the population instead.
   */
  function renderAging(mttr) {
    clear(agingHost);
    // FIRST RUN STOPS AT THE NOTICE. On an unread ledger every section below the hero reads a
    // population of exactly zero, and `renderHero`'s `firstRunNotice` already carries the one
    // sentence this page owes a reader — so a heading over an "no open findings to age yet"
    // box would be a second answer to a question already answered, in words that sound like a
    // measurement ("there are none") rather than like an absence ("nobody has looked").
    // `renderCharts` has made this same test since it was written; the two new sections join
    // it rather than inventing a third convention.
    if (!mttr.rowCount) return;
    const vm = agingView(mttr.remediation, boot.palette.order);
    const heading = sectionLabel("Open findings by age", {
      term: "age",
      lines: [
        "Open findings only, aged from first detection to now — a resolved finding stopped"
        + " ageing and its lifetime is the survival curve's subject, not this one's.",
        vm.denominator,
      ],
    });
    // The base every bar is counted over, on the heading itself — the same
    // `[data-denominator]` contract every rate on this page carries, for a section whose
    // figure is a distribution rather than a single rate.
    heading.setAttribute("data-denominator", String(vm.totalOpen));
    agingHost.append(heading);

    if (!vm.show) {
      agingHost.append(emptyState(
        "No open findings to age yet.",
        "This chart counts open findings only, measured from first detection to now.",
      ));
      return;
    }

    const canvas = el("canvas", {
      "aria-label": "Open findings by age bucket and severity",
    });
    // `agingTableModel` builds the bucket column and one column per severity DRAWN, filtered
    // exactly the way `stackedAgeBar` filters its datasets. The breach column is appended
    // rather than folded into that shared builder: it is a fact about THIS register's SLA
    // targets, and the same builder serves the resolution-bucket histogram above, which has
    // no deadline to be past.
    const model = agingTableModel(vm.labels, vm.perSev, vm.sevs, "Age bucket");
    model.columns.push({ key: "past", label: "Past SLA for", align: "text" });
    model.rows.forEach((row, i) => {
      const breaches = vm.rows[i] ? vm.rows[i].breaches : [];
      row.push(breaches.length ? breaches.join(", ") : absentText);
    });
    const card = el("div", { class: "chart-card" },
      // BOTH COUNTS, NO SENTENCE. "N open with a readable age" is the denominator and
      // "M undated" is the population the bars cannot hold — the second is an honesty
      // statement and stays on the surface as a number and the word for it, while the full
      // origin sentence it came from is a line on the heading above.
      el("p", { class: "chart-note" },
        fmtCount(vm.totalOpen) + " open with a readable age"
        + (vm.unaged > 0 ? " · " + fmtCount(vm.unaged) + " undated" : "")),
      el("div", { class: "chart-box" }, canvas),
      chartTable({
        canvas,
        caption: "Every bar of the stack as a count: one row per age bucket, one column per"
          + " severity drawn, and which severities are already past their deadline in that"
          + " bucket.",
        model,
      }));
    agingHost.append(card);

    // ONE LEGEND LINE INSTEAD OF FIVE SENTENCES. `agingView` writes a ~22-word sentence per
    // severity and they are near-identical — a table drawn as paragraphs, whose only varying
    // content is a severity and a number. The numbers themselves, in the order the bars are
    // stacked and read against the bucket labels the x axis already prints, place every edge;
    // `sla-edge` carries what the sentences said in general. NOTHING IS HARD-CODED: `e.target`
    // is whatever the payload's `slaTargets` holds, so a deadline edited in the domain moves
    // this line with it, and a severity with no target says so rather than printing "null d".
    const legend = slaEdgeLegend(vm.edges);
    if (legend) {
      agingHost.append(el("p", { class: "small muted" },
        tipLabel("SLA edges", { term: "sla-edge" }), ": ", legend));
    }

    loadCharts().then((charts) => {
      charts.stackedAgeBar(
        canvas,
        vm.labels,
        vm.perSev,
        // EXACTLY the severities the table lists — `stackedAgeBar`'s own
        // `palette.order.filter((s) => perSev[s])` cannot then draw a series the table omits
        // or omit one it lists.
        { order: vm.sevs, colors: boot.palette.colors },
        "Open findings by age bucket and severity, measured from first detection.",
        vm.edgeAfter === null ? {} : { slaEdgeAfter: vm.edgeAfter, slaEdgeLabel: "SLA" },
      );
    }).catch(() => {
      chartUnavailable(canvas);
    });
  }

  /** The distribution — one card that toggles between the Kaplan–Meier survival curve
   *  (cumulative S(t)) and its binned-density companion, the time-to-resolve histogram.
   *  `rem` missing entirely means a stale pre-KM cache (nothing shown); a curve with no
   *  points AND no buckets means genuinely no resolved findings yet (a muted note instead
   *  of an empty chart). The survival curve keeps only its two KM markers (median + RMST
   *  mean) — the naive closed-only comparison now lives on the "MTTR over time" toggle. */
  function renderSurvivalCurve(mttr) {
    clear(survivalHost);
    const rem = mttr.remediation;
    if (!rem) return;
    // THE SAME FIRST-RUN GATE THE TWO SECTIONS BELOW NOW MAKE, and this one is a fix rather
    // than a new rule. MEASURED at `?noseed#/mttr`: the page rendered the first-run notice and
    // then a "Distribution" heading over "Not enough resolved findings yet to draw the
    // distribution — it appears once the first remediation is recorded", which is a true
    // sentence about a register that HAS been read and a misleading one about a register that
    // has not. `renderCharts` already returned early on this exact test; this section did not,
    // and adding two more sections beside it would have made three headings over three empty
    // boxes under one notice.
    if (!mttr.rowCount) return;
    const hasCurve = !!rem.km?.curve?.length;
    const hasBuckets = !!(rem.buckets && rem.buckets.total);
    if (!hasCurve && !hasBuckets) {
      survivalHost.append(sectionLabel("Distribution"));
      survivalHost.append(el("p", { class: "muted small" },
        "Not enough resolved findings yet to draw the distribution — it appears once the " +
        "first remediation is recorded."));
      return;
    }

    const modes = [];
    if (hasCurve) modes.push("survival");
    if (hasBuckets) modes.push("histogram");
    const mode = modes.includes(distMode) ? distMode : modes[0];

    // Section-head controls: the view toggle (survival ⇄ histogram, only when both draw)
    // plus the survival x-axis width control, the latter shown only while the curve is up.
    const controls = el("div", { style: "display:flex; gap:12px; flex-wrap:wrap" });
    if (modes.length > 1) {
      controls.append(toggleRow("Distribution view",
        [["Survival", "survival"], ["Time to resolve", "histogram"]], mode, (v) => {
          distMode = v; savePref("mttrDistMode", v); renderSurvivalCurve(mttr);
        }));
    }
    if (mode === "survival") {
      controls.append(segmented({
        options: SURVIVAL_WINDOWS.map(([label, weeks]) => ({ value: weeks, label })),
        value: survivalWeeks,
        ariaLabel: "Survival window",
        onChange: (weeks) => {
          const label = SURVIVAL_WINDOWS.find(([, w]) => w === weeks)[0];
          survivalWeeks = weeks; saveSurvivalWeeks(label); renderSurvivalCurve(mttr);
        },
      }));
    }
    survivalHost.append(el("div", { class: "section-head" },
      sectionLabel("Distribution"), controls));

    const box = el("div", { class: "chart-box chart-box--tall" });
    if (mode === "survival") {
      const canvas = el("canvas", { id: "survival-curve" });
      box.append(canvas);
      // `rem.km.curve` — the same array the wrapper below is handed — read once, into both.
      survivalHost.append(chartCard("S(t): share of findings still open", box, {
        helpLines: [
          "Time from first detection to remediation, as a Kaplan–Meier survival curve. " +
            "Markers: Median (KM) and Mean (KM · RMST) — still-open findings censored — plus " +
            "Median (closed), the naive closed-only median KM corrects for.",
        ],
        table: chartTable({
          canvas,
          caption: "Every step of the curve above: weeks and days since detection, and the "
            + "share still open after that step.",
          model: survivalTableModel(rem.km.curve),
        }),
      }));
      loadCharts().then((charts) => {
        // The two KM markers plus the naive closed-only median dot, so the curve shows the
        // bias KM corrects for in place (naiveMean stays off the "MTTR over time" toggle).
        charts.survivalCurve(canvas, rem.km.curve,
          { naiveMedian: rem.km.naiveMedian, median: rem.km.median, naiveMean: null, mean: rem.km.mean },
          { maxWeeks: survivalWeeks });
      }).catch(() => {
        chartUnavailable(canvas);
      });
    } else {
      const canvas = el("canvas", { id: "resolution-buckets" });
      box.append(canvas);
      // Named once, so the table and `charts.stackedAgeBar` below cannot read two different
      // fallbacks for a stale pre-label cache.
      const bucketLabels = rem.buckets.labels || RESOLUTION_LABELS;
      survivalHost.append(chartCard("Time to resolve", box, {
        helpLines: [
          "How long resolved findings actually took, bucketed by severity. The right-hand " +
            "bars are the tail the median hides.",
        ],
        table: chartTable({
          canvas,
          caption: "Every bar of the stack as a count: one row per time-to-resolve bucket, one "
            + "column per severity drawn.",
          model: agingTableModel(bucketLabels, rem.buckets.perSev, boot.palette.order,
            "Time to resolve"),
        }),
      }));
      loadCharts().then((charts) => {
        charts.stackedAgeBar(canvas, bucketLabels, rem.buckets.perSev,
          boot.palette, "Resolved findings by time-to-resolve bucket and severity.");
      }).catch(() => {
        chartUnavailable(canvas);
      });
    }
  }

  function renderCharts(trends, mttr) {
    clear(chartsHost);
    // With no lifecycle data the hero already shows the single, unified empty state — don't
    // stack a second "Trends appear…" panel beneath it.
    if (!mttr.rowCount) return;

    // Window the already-loaded series client-side (no RPC): the charts use a category
    // x-axis, so filtering the arrays before mapping is the whole job. The cutoff comes
    // from the client clock; a ±1-day skew at the window edge is fine for a view filter.
    const cutoff = trendWindowDays === null ? null : Date.now() - trendWindowDays * 86400000;
    const inWindow = (iso) => cutoff === null || Date.parse(iso) >= cutoff;
    const trend = trends.trend.filter((t) => inWindow(t.date));
    const history = trends.history.filter((h) => inWindow(h.date));
    // Pin the x-axis to the chosen window (epoch days) — the charts' day axis is
    // time-proportional, so a 30d window stays 30 days wide even when the data only
    // reaches back a fortnight: short history reads as empty space, not a full chart.
    const xRange = cutoff === null
      ? null
      : { min: Math.floor(cutoff / 86400000), max: Math.floor(Date.now() / 86400000) };

    // Compact timeframe toggle inline with the section label — the shared segmented()
    // control, not a radiogroup: the buttons are toggle buttons, not mutually exclusive
    // radios in the ARIA sense. Clicking repaints from the closed-over payload.
    const segRow = segmented({
      options: TREND_WINDOWS.map(([label, days]) => ({ value: days, label })),
      value: trendWindowDays,
      ariaLabel: "Trends timeframe",
      onChange: (days) => {
        const label = TREND_WINDOWS.find(([, d]) => d === days)[0];
        trendWindowDays = days; saveTrendWindow(label); renderCharts(trends, mttr);
      },
    });
    const sectionHead = el("div", { class: "section-head" }, sectionLabel("Trends"), segRow);

    // With the vendor-fix filter off, mttr_history's snapshots were captured before any
    // no-fix exclusion existed — falling back to them would paint an unfiltered register on
    // a young ledger with too few reconstructed-trend points. Use the recomputed `trend`
    // array only in that case, even if it leaves the chart with fewer (or zero) points.
    const hideNoFix = boot.settings.showNoFix === false;
    const points = trend.length
      ? trend.map((t) => ({ x: t.date, y: t.median_days, reconstructed: t.reconstructed }))
      : hideNoFix ? [] : history.map((h) => ({ x: h.date, y: h.median_days, reconstructed: false }));

    // KM median trend — reconstructed-trend only (mttr_history snapshots don't carry it: KM
    // needs the full base of events + censoring replayed as-of each date, not a scalar that
    // was persisted at snapshot time).
    const kmMedianPoints = trend
      .map((t) => ({ x: t.date, y: t.km_median_days, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);

    // Same fallback shape as `points` above, but for open_past_sla — a column that doesn't
    // exist on history rows saved before this feature shipped. Those rows carry `null`
    // (never a false 0, see historyStore.loadHistory), so they're filtered out here rather
    // than drawn as a dip to zero.
    const openSlaPoints = (trend.length
      ? trend.map((t) => ({ x: t.date, y: t.open_past_sla, reconstructed: t.reconstructed }))
      : hideNoFix ? [] : history.map((h) => ({ x: h.date, y: h.open_past_sla, reconstructed: false })))
      .filter((p) => p.y !== null && p.y !== undefined);

    // Backlog-flow series — reconstructed-trend only, like the tail median (mttr_history
    // snapshots don't carry them). sla_net is a signed per-window flow (can be negative);
    // sla_attainment_pct is the unbiased cohort In-SLA. Null points (first point / stale
    // history rows) are dropped rather than drawn as a dip to zero.
    const slaBurnPoints = trend
      .map((t) => ({ x: t.date, y: t.sla_net, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);
    const slaAttainmentPoints = trend
      .map((t) => ({ x: t.date, y: t.sla_attainment_pct, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);

    // A "trend" needs at least two points — one lone dot is not a trajectory. This matches the
    // Open-vs-resolved gate and the "after two saved scans" copy below.
    const hasTrend = points.length > 1;
    const hasKmTrend = kmMedianPoints.length > 1;
    const hasOpenSlaTrend = openSlaPoints.length > 1;
    const hasSlaBurn = slaBurnPoints.length > 1;
    const hasSlaAttainment = slaAttainmentPoints.length > 1;
    // Four cards, two of them carrying a two-option toggle that folds in the comparison
    // series (KM vs naive; attainment vs burn) — the methodology moves from an always-on
    // caption onto the card-title helpTip. Chart draws are deferred into `painters` and run
    // in one rAF after layout, so a card's canvas is in the DOM before it's sized.
    const grid = el("div", { class: "chart-grid chart-grid--2", style: "align-items:start" });
    const painters = [];

    // Card 1 — MTTR over time: the KM headline vs the naive closed-only comparison, one
    // card. Only the modes that have ≥2 points offer a button; if just one does, no toggle.
    {
      const modes = [];
      if (hasKmTrend) modes.push("km");
      if (hasTrend) modes.push("naive");
      if (modes.length) {
        const mode = modes.includes(overTimeMode) ? overTimeMode : modes[0];
        const canvas = el("canvas", { id: "mttr-over-time" });
        const toggle = modes.length > 1
          ? toggleRow("MTTR clock", [["KM", "km"], ["Naive", "naive"]], mode, (v) => {
            overTimeMode = v; savePref("mttrOverTimeMode", v); renderCharts(trends, mttr);
          })
          : null;
        // Named once — the ACTIVE mode's series, read into the table and the paint callback
        // both, so a toggle flip can never leave the two disagreeing about which clock is on
        // screen.
        const plotted = mode === "km" ? kmMedianPoints : points.filter((p) => p.y !== null);
        grid.append(chartCard("MTTR over time", el("div", { class: "chart-box" }, canvas), {
          toggle,
          helpLines: [
            "KM: Kaplan–Meier median days from first detection to remediation, replayed as " +
              "of each scan; still-open findings censored, so a wave of fresh open findings " +
              "can't bias it down.",
            "Naive: median of closed findings only, per scan — the biased comparison KM " +
              "corrects for.",
          ],
          table: chartTable({
            canvas,
            caption: "Every point of the line above: date and " +
              (mode === "km" ? "Kaplan–Meier median" : "naive median") +
              " days to remediation.",
            model: trendTableModel(plotted, [
              { key: "y", label: "Half-life", format: "days" },
            ], { dateKey: "x" }),
          }),
        }));
        painters.push({ canvas, paint: (charts) => charts.trendLine(canvas, plotted, { yLabel: "days", xRange }) });
      }
    }

    // Card 2 — Open vs resolved (the red/green dual line already encodes color + dash +
    // point-shape, so it stays its own card rather than a third overlay on anything).
    if (trend.length > 1) {
      const canvas = el("canvas", { id: "open-resolved" });
      grid.append(chartCard("Open vs resolved", el("div", { class: "chart-box" }, canvas), {
        table: chartTable({
          canvas,
          caption: "Every point of the lines above: date, open findings and resolved findings.",
          model: trendTableModel(trend, [
            { key: "open", label: "Open", format: "count" },
            { key: "resolved", label: "Resolved", format: "count" },
          ]),
        }),
      }));
      painters.push({ canvas, paint: (charts) => charts.openResolvedLines(canvas, trend, { xRange }) });
    }

    // Card 3 — Open past SLA (aged backlog level).
    if (hasOpenSlaTrend) {
      const canvas = el("canvas", { id: "open-sla-trend" });
      grid.append(chartCard("Open past SLA", el("div", { class: "chart-box" }, canvas), {
        helpLines: [
          "Open findings past their SLA deadline, measured from when a vendor fix became " +
            "available rather than first detection. Counts step up at the fix-tracking " +
            "rollout — findings awaiting a vendor fix are now included in the register.",
        ],
        table: chartTable({
          canvas,
          caption: "Every point of the line above: date and open findings past their SLA.",
          model: trendTableModel(openSlaPoints, [
            { key: "y", label: "Open past SLA", format: "count" },
          ], { dateKey: "x" }),
        }),
      }));
      painters.push({ canvas, paint: (charts) => charts.trendLine(canvas, openSlaPoints, { yLabel: "findings", xRange }) });
    }

    // Card 4 — SLA quality: cohort attainment (rate) vs net-flow burn (direction), one card.
    {
      const modes = [];
      if (hasSlaAttainment) modes.push("attainment");
      if (hasSlaBurn) modes.push("burn");
      if (modes.length) {
        const mode = modes.includes(slaQualMode) ? slaQualMode : modes[0];
        const canvas = el("canvas", { id: "sla-quality" });
        const toggle = modes.length > 1
          ? toggleRow("SLA quality series",
            [["Attainment", "attainment"], ["Burn", "burn"]], mode, (v) => {
              slaQualMode = v; savePref("mttrSlaQualMode", v); renderCharts(trends, mttr);
            })
          : null;
        // Named once, for the same reason as Card 1's `plotted` above.
        const plotted = mode === "attainment" ? slaAttainmentPoints : slaBurnPoints;
        grid.append(chartCard("SLA quality", el("div", { class: "chart-box" }, canvas), {
          toggle,
          helpLines: [
            "Attainment (cohort): of findings whose SLA deadline has passed, the share met " +
              "on time — unlike In-SLA (of resolved), unaffected by how much is still open.",
            "Burn (net flow): findings crossing their SLA deadline minus breached findings " +
              "cleared, per scan. Above zero = the past-SLA backlog is growing.",
          ],
          table: chartTable({
            canvas,
            caption: "Every point of the line above: date and " +
              (mode === "attainment" ? "SLA attainment, in percent." : "net SLA flow, in findings."),
            model: trendTableModel(plotted, [
              mode === "attainment"
                ? { key: "y", label: "Attainment", format: "pct" }
                : { key: "y", label: "Net flow", format: "count" },
            ], { dateKey: "x" }),
          }),
        }));
        painters.push({ canvas, paint: (charts) => charts.trendLine(canvas, plotted, { yLabel: mode === "attainment" ? "%" : "findings", xRange }) });
      }
    }

    if (!grid.hasChildNodes()) {
      if (trendWindowDays === null) {
        // Nothing to plot at all — same single empty state as before the filter existed.
        chartsHost.append(emptyState("Trends appear after two saved scans."));
      } else {
        // The window is what emptied the section — keep the control so it can be widened.
        chartsHost.append(sectionHead, emptyState("No trend points in this window."));
      }
      return;
    }
    // A labelled section so the page has no h1 → h3 heading skip (the cards are h3).
    chartsHost.append(sectionHead, grid);
    // Caption keyed to the windowed set — no note about shading that isn't on screen.
    if (trend.some((t) => t.reconstructed)) {
      chartsHost.append(el("p", { class: "small muted", style: "margin:4px 0 0" },
        "Shaded days precede the first saved scan — reconstructed from first-detection dates. "
          + "Open counts there are exact; resolved and MTTR are lower bounds."));
    }

    loadCharts().then((charts) => {
      for (const { paint } of painters) paint(charts);
    }).catch(() => {
      for (const { canvas } of painters) chartUnavailable(canvas);
    });
  }

  /**
   * The `meter--stat` that goes beside a rate — or NOTHING at all where there is no rate.
   *
   * The decision is `meterPctFor` and lives at module scope, pure, because `ui/data.js`'s
   * `meter(value)` opens with `Number(value) || 0`: a null fills to 0%, and a 0% track beside
   * the words "not measured" is a confident zero in picture form. `decorative` because the
   * percentage is printed next to it — `ui/data.js`'s own contract for a meter whose figure is
   * already in words.
   */
  function rateMeter(rate) {
    const pct = meterPctFor(rate);
    return pct === null ? null : meter(pct, { className: "meter--stat", decorative: true });
  }

  /** `rateCell` with the meter folded in — the shared cell, plus this table's third encoding. */
  function withMeter(rate) {
    const cell = rateCell(rate);
    const bar = rateMeter(rate);
    if (bar) cell.insertBefore(bar, cell.childNodes[1] || null);
    cell.className = "rate-with-meter";
    return cell;
  }

  /**
   * Open-past-SLA as a count, its share, a meter and the base — the four encodings of one
   * fact, where `fmtOpenPastSla` gave two of them glued into one string.
   *
   * `fmtOpenPastSla` stays, at the by-domain table, whose own comment argues for it: a dense
   * per-group table with a denominator sentence under every cell buys a reader nothing the
   * parenthetical does not already give. This table is five rows of severity, where the base
   * genuinely differs per row and the meter is what makes the column comparable at a glance.
   */
  function pastSlaCell(o) {
    if (!o || o.open === null || o.open === undefined) return absent();
    const open = num(o.open, 0);
    const rate = rateView(o.pct, open, fmtCount(open) + " open", "no finding is open here");
    return el("span", { class: "rate-with-meter" },
      el("span", { class: "num" }, fmtCount(num(o.breached, 0))),
      el("span", { class: "small muted" }, " (" + rate.text + ") "),
      rateMeter(rate),
      denominatorNode(rate));
  }

  function renderSla(mttr) {
    clear(slaHost);
    // The per-severity breakdown (table + posture bars) follows the severity dropdown,
    // so it always matches the severities feeding the hero and trend above.
    const sevs = boot.palette.order.filter((s) => mttr.perSev[s] && sevScope.includes(s));
    if (!sevs.length) return;

    slaHost.append(sectionLabel("Remediation by severity", { term: "sla-band" }));
    // Trimmed to the high-signal columns — Resolved, Awaiting, Open age p90 and the SLA
    // target column are dropped from the default view (the target folds into the In-SLA
    // header helpTip). Column headers carry each metric's definition via helpTip so the
    // hero minis can stay plain.
    // KM median / p90 per severity fall back to the naive closed-only figures for a stale
    // pre-kmMedianPerSev / pre-kmP90PerSev cache. `undefined` is the stale-cache signal, so the
    // fallback tests for it specifically — a present-but-`null` value means the curve never got
    // far enough to observe the statistic, and fmtSpan renders that rather than substituting a
    // naive number that answers a different question.
    const kmMedianOf = (sev) => {
      const km = mttr.remediation?.kmMedianPerSev?.[sev];
      return km !== undefined ? km : mttr.perSev[sev].mttr_median;
    };
    /**
     * The half-life cell, and the bound it is finally allowed to publish.
     *
     * P1.1 left this column printing a bare dash wherever the curve never fell to half,
     * because the server shipped `kmMedianPerSev` and nothing else — so a severity whose
     * median is genuinely unobservable was indistinguishable from one nobody measured. The
     * bound is on the wire now (`kmLowerBoundPerSev`), and a bound is a TRUE STATEMENT: the
     * median is at LEAST that far out.
     *
     * "≥ N d" here, not the hero's "at least N days", and README.md fixes that split on
     * purpose: prose says "at least N" (`kmHalfLifeView`, the hero and each fan caption), a
     * numeric CELL says "≥ N" (`ui/figures.js`'s `boundedDays`, which is the one
     * implementation of it). The glyph is "≥" and never ">" — the bound is inclusive, and ">"
     * claims something strictly stronger than the estimator showed.
     *
     * `bounded` rides beside the string so the cell can mute what it is not, rather than a
     * caller parsing the text back out of it.
     */
    const kmMedianCell = (sev) => {
      const median = kmMedianOf(sev);
      const bound = mttr.remediation?.kmLowerBoundPerSev?.[sev];
      const view = boundedDays(median, bound);
      if (view.text === absentText) return absent();
      return view.bounded
        ? el("span", { class: "num" }, view.text,
          el("span", { class: "small muted" }, " (lower bound)"))
        : view.text;
    };
    const kmP90Of = (sev) => {
      const km = mttr.remediation?.kmP90PerSev?.[sev];
      return km !== undefined ? km : mttr.remediation?.pctiles?.perSev?.[sev]?.p90;
    };
    // Same conversion as the by-domain table above: six static columns, one header row, no
    // colspan, so the hand-rolled table had nothing the shared component lacks — and gains the
    // right-aligned numeric headings its own `td.num` cells always implied.
    slaHost.append(dataTable({
      columns: [
        {
          key: "sev",
          label: "Severity",
          help: ["This row's severity band — the population the remediation figures beside it "
            + "are measured over."],
          cell: (sev) => sevBadge(sev),
        },
        {
          key: "kmMedian",
          label: "Median MTTR (KM)",
          className: "num",
          help: {
            term: "half-life",
            lines: [
              "Kaplan–Meier median time-to-remediation for this severity — the principal MTTR "
              + "figure. Still-open findings count as censored instead of being ignored, so it "
              + "isn't biased low by fresh fast-patched vulns.",
              "\u201c\u2265 N d\u201d means this severity's curve never fell to half inside the "
              + "observed window, so the median is at least that far out and no exact figure "
              + "exists to print.",
            ],
          },
          cell: kmMedianCell,
        },
        {
          key: "kmP90",
          label: "MTTR p90",
          className: "num",
          help: ["Kaplan–Meier 90th-percentile time-to-remediation — the slow tail. Nine in ten " +
            "findings beat it; one in ten is slower. Censoring-aware like the KM median (read off " +
            "the same survival curve), so the tail isn't biased low by fresh fast-patched vulns; " +
            "shows \"—\" when too much is still open to observe it."],
          cell: (sev) => fmtSpan(kmP90Of(sev)),
        },
        {
          key: "open",
          label: "Open",
          className: "num",
          help: ["Findings at this severity not yet resolved."],
          cell: (sev) => mttr.perSev[sev].open,
        },
        {
          key: "openPastSla",
          label: "Open past SLA",
          // TWO DIFFERENT DENOMINATORS SIT IN THIS TABLE and mixing them is the mistake this
          // shape stops, so each column says its own rather than a paragraph under the table
          // saying both. A column heading is asked once, which is `ui/tip.js`'s whole rule for
          // where a definition lives — and it is one tab stop for the column instead of one
          // per row.
          help: {
            lines: [
              "Taken over what is still RUNNING: of the findings still open at this severity, "
              + "the share already past the target, measured from when a vendor fix became "
              + "available.",
              "Unlike In SLA — which only scores findings that CLOSED — an aged-out open "
              + "CRITICAL counts here. A single SLA percentage over everything would be "
              + "neither of the two.",
            ],
          },
          // The count AND the rate AND the base. The count alone hides how big the backlog it
          // came out of is; the rate alone hides how many findings that actually is; the meter
          // is the third encoding and the only one that can be compared down a column at a
          // glance. It is `decorative` because both figures are printed beside it.
          cell: (sev) => pastSlaCell(
            mttr.remediation?.openPastSlaActionable?.perSev?.[sev]
            ?? mttr.remediation?.openPastSla?.perSev?.[sev]),
        },
        {
          key: "slaPct",
          label: "In SLA (of resolved)",
          help: {
            term: "sla-target",
            lines: [
              "Taken over what CLOSED: of the findings that resolved at this severity, the "
              + "share that resolved on or before the target. The comparison is inclusive.",
              "Targets are CRITICAL 7d · HIGH 14d · MEDIUM 30d · LOW 90d · INFO 180d.",
            ],
          },
          // `rateCell(rateView(...))` — the figure, then the base it was taken over in a
          // `[data-denominator]` node under it. A null `sla_pct` is "nothing resolved at this
          // severity yet", which `rateView` reports as `baseEmpty`: the cell then reads "not
          // measured" over the population it WOULD have been taken over, rather than a bare
          // dash that cannot say which of the two absences it is.
          cell: (sev) => withMeter(rateView(
            mttr.perSev[sev].sla_pct,
            num(mttr.perSev[sev].resolved, 0),
            fmtCount(num(mttr.perSev[sev].resolved, 0)) + " resolved",
            "nothing has closed at this severity",
          )),
        },
      ],
      // The UNKNOWN severity (findings whose severity never normalized to a real value) is
      // deliberately not among these rows — it's still folded into every hero/table total
      // above, and the hero source line surfaces the count as "unclassified severity".
      rows: sevs,
    }));
  }
}
