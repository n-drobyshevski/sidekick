// Chart.js wrappers themed to DESIGN.md. Chart.js 4 is bundled (no CDN) so the app
// works behind proxies that block or rewrite third-party script hosts. Only the
// components these chart types use are registered — chart.js/auto would roughly
// double the bundle's Chart.js footprint.

import {
  BarController,
  BarElement,
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
  BarController, BarElement, CategoryScale, Filler, Legend,
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

/** Draws each bar's value just past its end. */
const barEndLabels = {
  id: "barEndLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    ctx.save();
    ctx.font = `600 11px ${FONT.family}`;
    ctx.fillStyle = INK2;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    meta.data.forEach((bar, i) => {
      const v = chart.data.datasets[0].data[i];
      if (v == null) return;
      ctx.fillText(Number(v).toLocaleString(), bar.x + 6, bar.y);
    });
    ctx.restore();
  },
};

/**
 * Horizontal categorical bar (AARS bands, severities, …): labels + counts + one
 * color per category from `colors`. Clicking a bar fires onClickLabel(label).
 */
export function categoryBar(canvas, labels, counts, colors, onClickLabel) {
  destroyExisting(canvas);
  const shown = labels.filter((l) => counts[l]);
  const opts = baseOptions();
  opts.indexAxis = "y";
  opts.scales.x.beginAtZero = true;
  opts.scales.x.ticks.precision = 0;
  // Headroom so the end-of-bar value labels aren't clipped at the axis edge.
  opts.scales.x.grace = "8%";
  opts.scales.y.grid = { display: false };
  opts.onClick = (_evt, elements) => {
    if (elements.length && onClickLabel) onClickLabel(shown[elements[0].index]);
  };
  opts.onHover = (evt, elements) => {
    evt.native.target.style.cursor = elements.length && onClickLabel ? "pointer" : "default";
  };
  return new Chart(canvas, {
    type: "bar",
    data: {
      labels: shown,
      datasets: [
        {
          data: shown.map((l) => counts[l]),
          backgroundColor: shown.map((l) => colors[l]),
          borderRadius: 4,
          barThickness: 22,
        },
      ],
    },
    options: opts,
    plugins: [barEndLabels],
  });
}

/** Single line over ISO dates (sync trend), accent-colored. */
export function trendLine(canvas, points, { yLabel } = {}) {
  destroyExisting(canvas);
  const opts = baseOptions();
  opts.scales.y.beginAtZero = true;
  if (yLabel) {
    opts.scales.y.title = { display: true, text: yLabel, font: FONT, color: INK2 };
  }
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((p) => p.x.slice(0, 10)),
      datasets: [
        {
          data: points.map((p) => p.y),
          borderColor: ACCENT,
          backgroundColor: "rgba(190, 18, 60, 0.08)",
          fill: true,
          tension: 0.25,
          pointRadius: points.length > 40 ? 0 : 3,
          borderWidth: 2,
        },
      ],
    },
    options: opts,
  });
}
