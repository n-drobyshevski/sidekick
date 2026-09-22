// Chart.js wrappers themed to DESIGN.md. Chart.js 4 is bundled (no CDN) so the app
// works behind proxies that block or rewrite third-party script hosts.
//
// WHAT THE NARROW REGISTRATION BELOW DOES AND DOES NOT BUY, because the comment that used
// to sit here claimed more than it delivered and sent at least one reader looking for a
// tree-shaking bug that does not exist.
//
// It said "only the components these chart types use are registered — chart.js/auto would
// roughly double the bundle's Chart.js footprint". The first half is true. The second is
// wrong by about five times, and the implication that registering narrowly keeps the
// SHIPPED bytes down is wrong outright. Measured with esbuild against this project's own
// settings:
//
//   import { Chart } alone                 122,518 b
//   the nine named imports below           170,667 b
//   import Chart from "chart.js/auto"      205,084 b   (+20%, not +100%)
//
// So the floor is 122 KB whatever you import, and auto costs a fifth more rather than
// double. In the real client bundle chart.js accounts for 170,785 bytes of 732,267 —
// 23.3%, across chart.js/dist/chart.js (131,494), its helpers.dataset chunk (31,566) and
// @kurkle/color (7,725), from an esbuild metafile rather than a byte scan.
//
// THE UNREGISTERED COMPONENTS SHIP ANYWAY, AND NO IMPORT STYLE CHANGES THAT. The bundle
// carries RadialLinearScale (`pointLabels`, `angleLines`), TimeScale and TimeSeriesScale
// (`isoWeek`, `millisecond`) and LogarithmicScale, none of them registered. The reason is
// that the chart.js package ships ONE pre-bundled ESM file: `dist/chart.js` is a single
// 131 KB module in the graph, `dist/scales/` contains only `.d.ts` type files, and the
// package's `exports` map blocks any deeper path. There are no per-component modules for a
// bundler to drop, and inside that one file the component classes carry static property
// assignments a bundler must treat as side-effectful. Importing `Chart` on its own pulls
// all of them in, which is the measurement that settles it.
//
// Registering narrowly is still right — it is what keeps those components from being
// INITIALIZED and from widening the default config — but it is not a size lever, and the
// only lever that remains is not shipping this module on routes that draw no chart.

import {
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";

/**
 * The app's hover card, INJECTED rather than imported.
 *
 * This module is built twice — into the main bundle for the dev harness and the type
 * checker, and into `dist/js_charts.html` as a standalone bundle fetched on the first route
 * that draws a chart. `ui/tip.js` reaches helpContent.js, store.js and the popover stack
 * behind it, so importing it here would pull a large slice of the app into that second
 * bundle and ship it twice. The loader hands the handler over instead
 * (`chartsLoader.js` → `setChartTipHandler`), which keeps ONE hover vocabulary in the app
 * and one copy of it in the bundle.
 *
 * Null until it is set: a chart drawn before the handoff shows no card rather than throwing
 * inside Chart.js's render loop.
 */
let tipHandler = null;

export function setChartTipHandler(fn) {
  tipHandler = typeof fn === "function" ? fn : null;
}

function chartTipHandler(ctx) {
  if (tipHandler) tipHandler(ctx);
}

Chart.register(
  CategoryScale, Filler, Legend,
  LinearScale, LineController, LineElement, PointElement, Tooltip,
);

// Brand accent (crimson) — data color for non-severity series only.
export const ACCENT = "#be123c";

const FONT = {
  family:
    '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  size: 12,
};
const INK2 = "rgba(0,0,0,0.65)";
const HAIRLINE = "#e6e6e9";

const reducedMotion =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion ? false : { duration: 300 },
    plugins: {
      legend: { display: false },
      // Chart.js paints a dark box on the canvas; ui/tip.js paints the app's own card in the
      // DOM instead, so a value read off a chart looks like every other explanation in the
      // register rather than like a fourth vocabulary. Chart.js still owns the hit-testing
      // and the model — only the drawing moves. `enabled: false` turns off the canvas box
      // without turning off the plugin that builds what the card says.
      tooltip: {
        enabled: false,
        external: chartTipHandler,
      },
    },
    scales: {
      x: {
        ticks: { font: FONT, color: INK2 },
        grid: { color: HAIRLINE, drawTicks: false },
        border: { color: HAIRLINE },
      },
      y: {
        ticks: { font: FONT, color: INK2, precision: 0 },
        grid: { color: HAIRLINE, drawTicks: false },
        border: { display: false },
        beginAtZero: true,
      },
    },
  };
}

function destroyExisting(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

/** `#rrggbb` at an alpha — the stacked bands' fill, from the same hue as their line. */
function withAlpha(hex, alpha) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
  if (!m) return `rgba(190, 18, 60, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

// ------------------------------------------------------------------- the day axis, ported
// PORTED FROM `gas/src/client/js/charts.js`, WHICH IS THE REFERENCE REGISTER. This file had
// no day axis at all: every date series here was drawn on Chart.js's default CATEGORY scale,
// which spaces points BY INDEX. That is a lie on every one of this app's trends, because all
// of them are "one point per successful sync" (`domain/aarsTrend.ts`, `domain/complianceTrend.ts`,
// both of which say in their own headers that they cannot be backfilled) — so a fortnight the
// scheduled sync missed draws exactly as wide as the day after it. The compliance card is the
// worst of them: its y axis is a deliberately magnified percent window, so a spacing lie there
// is magnified with it.
//
// Trend x-values are whole UTC days (epoch-day numbers) on a LINEAR scale, so horizontal
// distance is proportional to elapsed time.
const DAY_MS = 86400000;
const dayOf = (iso) => Math.floor(Date.parse(iso) / DAY_MS);
// Axis/tooltip date format: "01-jul-2026" — unambiguous day-month order without locale
// dependence (toLocaleDateString varies by viewer), month spelled so it can't be misread
// as US-style month-first.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function fmtDay(day) {
  const d = new Date(day * DAY_MS);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** The width of a `fmtDay` label, in multiples of the tick font size.
 *
 *  MEASURED, not estimated: `measureText` at the axis's own 12px system stack over a spread of
 *  real labels gave 65.5px ("10-feb-2026") to 68.4px ("29-aug-2026") — 5.7 font sizes at the
 *  widest. Every `fmtDay` string is exactly eleven characters of digits, lowercase and hyphens,
 *  so this is a property of the FORMAT, not of one date. */
export const DAY_LABEL_EMS = 5.7;

/** Clear space demanded between two day labels on top of their own width. Chart.js's own
 *  `autoSkipPadding` default is 3px per side; this is that, both sides. */
export const TICK_LABEL_GUTTER_PX = 6;

/** The centre-to-centre pixel distance two `fmtDay` labels need to clear each other. */
export function dayLabelPitchPx(fontSize) {
  return fontSize * DAY_LABEL_EMS + TICK_LABEL_GUTTER_PX;
}

/**
 * Drop the second-to-last tick when the last one is a REMAINDER rather than a full step.
 *
 * WHY THIS IS UNAVOIDABLE WITH `bounds: "data"`. Chart.js's `generateTicks` anchors the tick
 * grid on the bounds it is given: with `bounds: "data"` it sets `niceMin = rmin` and
 * `niceMax = rmax` outright — the data's own min and max — and then steps from `rmin` by a nice
 * `spacing` and appends `rmax` at the end. So the final gap is `span % spacing`, which is
 * whatever the data happens to leave over: anywhere from 0 to a full step. Nothing about that
 * is a misconfiguration; it is what pinning an axis to real data means.
 *
 * WHY CHART.JS DOES NOT CATCH IT ITSELF. It tries: the generator merges the last stepped tick
 * INTO `rmax` when the two are within `relativeLabelSize(max, minSpacing, …)`. But that size is
 * `0.75 * minSpacing * ('' + value).length` — measured on the RAW NUMBER. Our x values are epoch
 * days, so `'' + 20704` is five characters, while `fmtDay` draws "29-aug-2026", eleven. Chart.js
 * budgets for a label less than half the width of the one it will paint. `autoSkip` cannot
 * rescue it either: it measures real label widths but assumes ticks are EVENLY spaced, and the
 * remainder tick is precisely the one that is not.
 *
 * MEASURED on the dev harness at 2026-09-08, `#/mttr` → "Open vs resolved", 578px axis over
 * 20494..20704 (210 days): ticks `[20494, 20544, 20594, 20644, 20694, 20704]`, gaps
 * `[50, 50, 50, 50, 10]`. Ten days is 27px where the label is ~66px, so "29-aug-2026" and
 * "08-sep-2026" printed directly on top of each other. The same axis on "SLA quality" left a
 * 52-day final gap and read fine, which is the same generator on different data — the defect is
 * the REMAINDER, not the chart.
 *
 * WHY THE SECOND-TO-LAST GOES, NOT THE LAST. The last tick is the data's own end — the "as of"
 * date the reader is looking for, and the one the plotted line actually reaches. Dropping it
 * instead would leave the axis labelled ten days short of where the series visibly ends, which
 * reads as a chart cut off mid-series. Dropping its crowded neighbour just widens one gap.
 *
 * `bounds: "ticks"` was the other candidate and is worse: it rounds the axis out to the nice
 * grid, which here would add 46 days of empty space past the last scan on a 210-day range and
 * make a current register look a month stale. `dayAxis`'s own comment already rejects it.
 *
 * BOTH CONDITIONS ARE LOAD-BEARING, and a ratio alone was not enough — the first cut of this
 * asked only whether the final gap was under half the step, and the 90d window walked straight
 * through it: step 20 days, remainder 10, ratio exactly 0.5, and 10 days at that zoom is 64px
 * under a 68px label. Pixels are the unit the collision actually happens in. The `< step` test
 * stays beside it so this only ever touches the REMAINDER: an axis whose ticks are evenly
 * spaced and merely crowded is autoSkip's job, and autoSkip does that one correctly.
 *
 * @param {Array<{value: number}>} ticks  as `generateTicks` built them, in ascending order
 * @param {number} pxPerUnit  drawn pixels per axis unit (a day, here)
 * @param {number} minPitchPx  centre-to-centre pixels two labels need — `dayLabelPitchPx()`
 * @returns {Array<{value: number}>} the same array, or a copy one tick shorter
 */
export function dropRemainderTick(ticks, pxPerUnit, minPitchPx) {
  if (!Array.isArray(ticks) || ticks.length < 3) return ticks;
  const last = ticks[ticks.length - 1].value;
  const prev = ticks[ticks.length - 2].value;
  const step = prev - ticks[ticks.length - 3].value;
  const finalGap = last - prev;
  // Anything not measurable is left alone: a non-positive or non-finite step is not an evenly
  // stepped axis, and with no usable pixel scale there is no collision to judge.
  if (!Number.isFinite(step) || step <= 0) return ticks;
  if (!Number.isFinite(finalGap) || finalGap <= 0) return ticks;
  if (!Number.isFinite(pxPerUnit) || pxPerUnit <= 0) return ticks;
  if (!Number.isFinite(minPitchPx) || minPitchPx <= 0) return ticks;
  if (finalGap >= step) return ticks; // a full step: not a remainder
  if (finalGap * pxPerUnit >= minPitchPx) return ticks; // a remainder, but a legible one
  return [...ticks.slice(0, -2), ticks[ticks.length - 1]];
}

/** Switch a baseOptions() x scale to the proportional day axis. `xRange` ({min,max} in
 *  epoch days) pins the visible span — e.g. a "30d" window stays 30 days wide even when
 *  the data only reaches back a fortnight, showing honest empty space instead.
 *
 *  `afterBuildTicks` is here because `bounds: "data"` GUARANTEES an uneven final gap, and this
 *  axis draws labels far wider than the numbers Chart.js sizes them by. See `dropRemainderTick`
 *  for the whole mechanism and the measurement. */
function dayAxis(opts, xRange) {
  opts.scales.x.type = "linear";
  opts.scales.x.bounds = "data"; // don't stretch the axis past the data to a "nice" tick
  opts.scales.x.ticks.precision = 0; // whole days — a tick between two dates is nonsense
  opts.scales.x.ticks.maxTicksLimit = 8;
  opts.scales.x.ticks.callback = (v) => fmtDay(v);
  // `setDimensions()` and the data-limits pass both run before `buildTicks()` (Chart.js's
  // `Scale.update`), so `width`, `min` and `max` are all real by the time this fires — which is
  // what lets the decision be made in PIXELS rather than in a ratio that has to guess at zoom.
  opts.scales.x.afterBuildTicks = (scale) => {
    const span = scale.max - scale.min;
    const fontSize = scale.options?.ticks?.font?.size || FONT.size;
    scale.ticks = dropRemainderTick(
      scale.ticks,
      span > 0 ? scale.width / span : 0,
      dayLabelPitchPx(fontSize),
    );
  };
  if (xRange) {
    opts.scales.x.min = xRange.min;
    opts.scales.x.max = xRange.max;
  }
  // ONE LINE OFF `gas/`'s: this app's `baseOptions()` builds `tooltip` with no `callbacks`
  // object at all (the `percent` branch below creates one), so assigning into it would throw.
  // Spreading keeps whatever a caller-driven branch has already put there.
  opts.plugins.tooltip.callbacks = {
    ...(opts.plugins.tooltip.callbacks || {}),
    title: (items) => (items.length ? fmtDay(items[0].parsed.x) : ""),
  };
}

/**
 * Flip a `baseOptions()` chart to horizontal bars — and UNDO the numeric defaults it put on
 * the y scale, which is the whole reason this is a function rather than one assignment.
 *
 * `baseOptions()` builds y as the VALUE axis: `precision: 0`, `beginAtZero`, and
 * `callback: localeNum`. Setting `indexAxis = "y"` makes y the CATEGORY axis, and Chart.js
 * hands a category scale's tick callback the tick's INDEX, not its label — so `localeNum`
 * formatted 0, 1, 2, 3, 4 and every bar chart drawn this way lost its category names. MEASURED
 * on the dev harness at 2026-09-08, `#/mttr` → By domain: five coloured bars against a y axis
 * reading "0 1 2 3 4", with the domain names nowhere on the card. The bars were identified by
 * HUE ALONE, which is the one thing DESIGN.md's non-colour-signal rule forbids outright, and
 * the reader could not name a single domain the chart was about.
 *
 * It went unseen because the two charts it hit lived inside a drawer, and the third
 * (`severityBar`) is exported but drawn by no page here. Deleting the three keys is the fix:
 * `beginAtZero` and `precision` are meaningless on a category scale, and with no `callback`
 * Chart.js falls back to `getLabelForValue`, which is the label.
 */
function horizontalBars(opts) {
  opts.indexAxis = "y";
  delete opts.scales.y.ticks.callback;
  delete opts.scales.y.ticks.precision;
  delete opts.scales.y.beginAtZero;
  opts.scales.y.grid = { display: false };
  return opts;
}

/**
 * Lines over ISO dates (sync trend). `series` is [{ label, color, data }] — one entry
 * draws the accent-colored single line the sync trend uses; several draw one line per
 * severity, each in its own severity token, with the legend on (the only way to tell
 * them apart, so color is never carrying it alone).
 *
 * `stacked` draws them as bands summing to the population instead of as independent lines —
 * for a series that IS a partition (every issue is in exactly one adjacency state), where
 * the total is as much of the reading as the parts.
 *
 * `pointNotes` is one string per POINT, appended to that point's tooltip title. It exists for
 * a denominator that must never become a series: `edgesKnown` beside the adjacency counts is
 * a count of EDGES, and putting it on an axis counting issues is the other way to lose it
 * (aarsTrend.ts TrendPoint.annotations). The app's hover card renders the title lines, so the
 * note arrives in the same card as the values rather than in a second vocabulary.
 *
 * `percent` suffixes every tick and every hovered value with `%`. A bare "96" beside a line
 * labelled with a framework's name reads as ninety-six of something; the unit has to be on
 * the axis, because it is the only place a reader looks for it.
 *
 * `yRange` ({min, max}) pins the axis the caller computed. THE CALLER COMPUTES IT, not this
 * function, and not Chart.js — both of the obvious alternatives are wrong for a share:
 *
 *   - A 0-100 axis is honest and useless here. Compliance posture lives between 85% and 100%
 *     on any landscape anybody is running this against, so five sixths of the plot is empty
 *     and the movement the chart exists to show is four pixels tall.
 *   - Chart.js's own auto-fit is the opposite failure. It fits the data exactly, so a flat
 *     line wobbling by one point fills the full height and reads as a collapse.
 *
 * The answer is a padded window with a floor on its span, which is a DECISION about how much
 * movement is worth showing — so it lives in the page's own model beside the sentence that
 * discloses it (`complianceTrendModel.js` percentRange, which is tested; this function only
 * draws whatever window it is handed). A caller passing no `yRange` gets 0-100, which is the
 * right default for a series that genuinely spans it.
 */
export function trendLine(
  canvas, points, { yLabel, series, stacked, pointNotes, percent, yRange } = {},
) {
  destroyExisting(canvas);
  const opts = baseOptions();
  opts.scales.y.beginAtZero = true;
  // THE X VALUE IS THE DATE. See `dayAxis`'s own header for why the category scale this
  // replaced was wrong for every series this function draws. It runs FIRST so the branches
  // below — `percent`'s label callback, `pointNotes`' title — spread over what it set rather
  // than being overwritten by it; `pointNotes` deliberately takes the title back, because it
  // prints the same date and a note under it.
  const days = points.map((p) => dayOf(p.x));
  dayAxis(opts);
  // Points hide (pointRadius 0) above 40 samples, so a nearest/intersect tooltip has nothing
  // to hit; index mode reveals every series' value at the nearest date on hover.
  opts.interaction = { mode: "index", intersect: false };
  if (percent) {
    const fitted = yRange
      && Number.isFinite(yRange.min) && Number.isFinite(yRange.max)
      && yRange.max > yRange.min;
    opts.scales.y.min = fitted ? yRange.min : 0;
    opts.scales.y.max = fitted ? yRange.max : 100;
    // Explicit bounds and `beginAtZero` are contradictory instructions; Chart.js resolves
    // them in the bounds' favour, but leaving the flag set invites a later reader to
    // "fix" the axis by trusting it.
    opts.scales.y.beginAtZero = false;
    opts.scales.y.ticks.callback = (v) => `${v}%`;
    opts.plugins.tooltip.callbacks = {
      ...(opts.plugins.tooltip.callbacks || {}),
      // The dataset's own name stays on the line, because a multi-series percent chart with
      // three bare numbers in its card names none of them.
      label: (item) => {
        const name = item.dataset && item.dataset.label ? `${item.dataset.label}: ` : "";
        return `${name}${item.parsed.y}%`;
      },
    };
  }
  if (yLabel) {
    // An empty yLabel means the caller already names the axis outside the canvas (the
  // header's own "Cumulative cover" label). A rotated title in a 124px-tall chart clips.
  opts.scales.y.title = yLabel
    ? { display: true, text: yLabel, font: FONT, color: INK2 }
    : { display: false };
  }
  const multi = Array.isArray(series) && series.length > 1;
  if (stacked) opts.scales.y.stacked = true;
  if (Array.isArray(pointNotes) && pointNotes.length) {
    opts.plugins.tooltip.callbacks = {
      ...(opts.plugins.tooltip.callbacks || {}),
      // An ARRAY of title lines: ui/tip.js walks `model.title` and then the body, so the note
      // sits above the values in the same card. A point with no note keeps the bare date.
      title: (items) => {
        const i = items && items.length ? items[0].dataIndex : -1;
        const date = i >= 0 ? String((points[i] || {}).x || "").slice(0, 10) : "";
        const note = i >= 0 ? pointNotes[i] : "";
        return note ? [date, note] : [date];
      },
    };
  }
  if (multi) {
    opts.plugins.legend = {
      display: true,
      position: "bottom",
      labels: { font: FONT, color: INK2, boxWidth: 10, boxHeight: 10, usePointStyle: true },
    };
    opts.plugins.tooltip.mode = "index";
    opts.plugins.tooltip.intersect = false;
  }
  const datasets = (series && series.length ? series : [{ color: ACCENT, data: points.map((p) => p.y) }])
    .map((s) => ({
      label: s.label,
      // A NULL STAYS A NULL, AND IT KEEPS ITS SLOT. `inventory.js` builds these arrays with
      // `null` rather than `?? 0` on purpose — Chart.js breaks the line at a null, which is
      // the reading — and `{x, y: null}` still breaks it on a linear scale. Filtering the
      // nulls out here instead would be the trap: `pointNotes` below finds its note by
      // `dataIndex`, so a shorter dataset than `points` desyncs every note from its mark.
      data: s.data.map((y, i) => ({ x: days[i], y })),
      borderColor: s.color || ACCENT,
      // A stacked band is a SURFACE and takes a translucent fill; an unstacked multi-series
      // line is a line and its background only colours the legend swatch.
      backgroundColor: stacked
        ? withAlpha(s.color || ACCENT, 0.35)
        : (multi ? s.color || ACCENT : "rgba(190, 18, 60, 0.08)"),
      // A SHARE IS A LEVEL, NOT AN AREA, so a percent line is never filled. The fill under a
      // single counting series reads as "how much" and is the right cue for one; under a
      // percentage pinned to a 0-100 axis it is a solid block from the floor to the line,
      // which reads as a quantity and swamps the only thing on the chart worth looking at —
      // where the line sits and which way it is going.
      fill: percent ? false : (stacked || !multi),
      tension: 0.25,
      pointRadius: points.length > 40 ? 0 : 3,
      pointBackgroundColor: s.color || ACCENT,
      borderWidth: 2,
    }));
  return new Chart(canvas, {
    type: "line",
    // No `labels`: the x value carries the date, and a label array beside {x, y} data would
    // be a second, index-ordered claim about the same points.
    data: { datasets },
    options: opts,
  });
}

/**
 * The cumulative-cover curve (P1b): one stepped, filled line over `{rank, cumulative,
 * share}[]` — `actions.ts`'s `coverCurve`, drawn. Stepped because the underlying quantity
 * IS a step function: the curve only moves at an integer rank (one more action taken), so a
 * smoothed line between two ranks would imply a fractional action closing a fractional
 * share, which is not a thing. Filled for the same reason the sync trend's single-series
 * line is filled — the area under a Pareto-style curve is what reads as "how much of the
 * board is covered" at a glance, before a reader has found the axis labels.
 *
 * Degrading a too-thin curve to `.chart-empty` is the CALLER's job, the same split
 * `inventory.js`'s own `trendSection` keeps for `trendLine` — this function draws whatever
 * `curve` it is given and does not second-guess its length.
 *
 * `opts.yLabel` names the y axis, matching `trendLine`'s own option; the y axis is always
 * a 0–100 percentage (the `share` field, not the raw `cumulative` count) so the curve reads
 * on the same scale regardless of how many total problems the landscape carries.
 */
export function coverCurve(canvas, curve, { yLabel = "cumulative share of problems closed" } = {}) {
  destroyExisting(canvas);
  const points = curve || [];
  const opts = baseOptions();
  opts.scales.y.beginAtZero = true;
  opts.scales.y.max = 100;
  opts.scales.y.ticks.callback = (v) => `${v}%`;
  opts.scales.y.title = { display: true, text: yLabel, font: FONT, color: INK2 };
  opts.scales.x.title = { display: true, text: "actions taken, ranked", font: FONT, color: INK2 };
  opts.plugins.tooltip.callbacks = {
    title: (items) => `Top ${points[items[0].dataIndex].rank}`,
    label: (item) => {
      const pt = points[item.dataIndex];
      return `${pt.cumulative.toLocaleString()} problems closed (${Math.round(pt.share * 100)}%)`;
    },
  };
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((p) => String(p.rank)),
      datasets: [{
        data: points.map((p) => Math.round(p.share * 1000) / 10),
        stepped: true,
        fill: true,
        borderColor: ACCENT,
        backgroundColor: "rgba(190, 18, 60, 0.14)",
        borderWidth: 2,
        pointRadius: points.length > 30 ? 0 : 3,
        pointBackgroundColor: ACCENT,
      }],
    },
    options: opts,
  });
}
