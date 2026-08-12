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
      tooltip: {
        backgroundColor: "#0a0a0a",
        titleFont: FONT,
        bodyFont: FONT,
        cornerRadius: 6,
        padding: 10,
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
