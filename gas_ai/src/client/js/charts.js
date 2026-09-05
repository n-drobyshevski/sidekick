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
 */
export function trendLine(canvas, points, { yLabel, series, stacked, pointNotes } = {}) {
  destroyExisting(canvas);
  const opts = baseOptions();
  opts.scales.y.beginAtZero = true;
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
      data: s.data,
      borderColor: s.color || ACCENT,
      // A stacked band is a SURFACE and takes a translucent fill; an unstacked multi-series
      // line is a line and its background only colours the legend swatch.
      backgroundColor: stacked
        ? withAlpha(s.color || ACCENT, 0.35)
        : (multi ? s.color || ACCENT : "rgba(190, 18, 60, 0.08)"),
      fill: stacked || !multi,
      tension: 0.25,
      pointRadius: points.length > 40 ? 0 : 3,
      pointBackgroundColor: s.color || ACCENT,
      borderWidth: 2,
    }));
  return new Chart(canvas, {
    type: "line",
    data: { labels: points.map((p) => String(p.x).slice(0, 10)), datasets },
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
