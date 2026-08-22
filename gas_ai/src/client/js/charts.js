// Chart.js wrappers themed to DESIGN.md. Chart.js 4 is bundled (no CDN) so the app
// works behind proxies that block or rewrite third-party script hosts. Only the
// components these chart types use are registered — chart.js/auto would roughly
// double the bundle's Chart.js footprint.

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

import { chartTipHandler } from "./ui/tip.js";

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

/**
 * Lines over ISO dates (sync trend). `series` is [{ label, color, data }] — one entry
 * draws the accent-colored single line the sync trend uses; several draw one line per
 * severity, each in its own severity token, with the legend on (the only way to tell
 * them apart, so color is never carrying it alone).
 */
export function trendLine(canvas, points, { yLabel, series } = {}) {
  destroyExisting(canvas);
  const opts = baseOptions();
  opts.scales.y.beginAtZero = true;
  if (yLabel) {
    opts.scales.y.title = { display: true, text: yLabel, font: FONT, color: INK2 };
  }
  const multi = Array.isArray(series) && series.length > 1;
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
      backgroundColor: multi ? s.color || ACCENT : "rgba(190, 18, 60, 0.08)",
      fill: !multi,
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
