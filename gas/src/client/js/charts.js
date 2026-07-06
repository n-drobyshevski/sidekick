// Chart.js wrappers themed to DESIGN.md: severity bar (click-to-filter), MTTR trend
// line, open-vs-resolved dual line. Chart.js 4 is loaded from CDN as a global.

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
  const existing = window.Chart.getChart(canvas);
  if (existing) existing.destroy();
}

/** Horizontal severity bar; clicking a bar toggles that severity filter. */
export function severityBar(canvas, counts, palette, onClickSeverity) {
  destroyExisting(canvas);
  const sevs = palette.order.filter((s) => counts[s]);
  const opts = baseOptions();
  opts.indexAxis = "y";
  opts.scales.x.beginAtZero = true;
  opts.scales.y.grid = { display: false };
  opts.onClick = (_evt, elements) => {
    if (elements.length && onClickSeverity) onClickSeverity(sevs[elements[0].index]);
  };
  opts.onHover = (evt, elements) => {
    evt.native.target.style.cursor = elements.length && onClickSeverity ? "pointer" : "default";
  };
  return new window.Chart(canvas, {
    type: "bar",
    data: {
      labels: sevs,
      datasets: [
        {
          data: sevs.map((s) => counts[s]),
          backgroundColor: sevs.map((s) => palette.colors[s]),
          borderRadius: 4,
          barThickness: 22,
        },
      ],
    },
    options: opts,
  });
}

/** Single line over ISO dates (MTTR median trend). */
export function trendLine(canvas, points, { yLabel } = {}) {
  destroyExisting(canvas);
  const opts = baseOptions();
  opts.scales.y.beginAtZero = true;
  if (yLabel) {
    opts.scales.y.title = { display: true, text: yLabel, font: FONT, color: INK2 };
  }
  return new window.Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((p) => p.x.slice(0, 10)),
      datasets: [
        {
          data: points.map((p) => p.y),
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.08)",
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

/** Open vs resolved dual line (color + dash encoded — not color alone). */
export function openResolvedLines(canvas, points) {
  destroyExisting(canvas);
  const opts = baseOptions();
  opts.plugins.legend = { display: true, labels: { font: FONT, color: INK2, boxHeight: 2 } };
  return new window.Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((p) => p.date.slice(0, 10)),
      datasets: [
        {
          label: "Open",
          data: points.map((p) => p.open),
          borderColor: "#b91c1c",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
        },
        {
          label: "Resolved",
          data: points.map((p) => p.resolved),
          borderColor: "#15803d",
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
        },
      ],
    },
    options: opts,
  });
}
