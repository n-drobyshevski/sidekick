// Chart.js wrappers themed to DESIGN.md: severity bar (click-to-filter), MTTR trend
// line, open-vs-resolved dual line. Chart.js 4 is bundled (no CDN) so the app works
// behind proxies that block or rewrite third-party script hosts. Only the components
// these three chart types use are registered — chart.js/auto would pull in every
// controller/scale/plugin and roughly double the bundle's Chart.js footprint.

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Tooltip,
} from "chart.js";

Chart.register(
  ArcElement, BarController, BarElement, CategoryScale, Filler, Legend,
  LinearScale, LineController, LineElement, PieController, PointElement, Tooltip,
);

const FONT = {
  family:
    '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  size: 12,
};
const INK2 = "rgba(0,0,0,0.65)";
const HAIRLINE = "#e6e6e9";

const reducedMotion =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Group digits and append a unit, so figures inside charts follow the same "tabular,
// thousands-separated, the-number-is-the-product" rule as the rest of the app (canvas
// ignores font-variant-numeric, so a formatter callback is the only way to get grouping).
const localeNum = (v) => (typeof v === "number" ? Number(v).toLocaleString() : v);

// Trend x-values are whole UTC days (epoch-day numbers) on a LINEAR scale, so horizontal
// distance is proportional to elapsed time: a sparse fortnight of scans no longer fills a
// 30-day window edge to edge, and gaps in the scan cadence read as gaps rather than
// silently compressing away (a category axis spaces points by index, not by date).
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

/** Switch a baseOptions() x scale to the proportional day axis. `xRange` ({min,max} in
 *  epoch days) pins the visible span — e.g. a "30d" window stays 30 days wide even when
 *  the data only reaches back a fortnight, showing honest empty space instead. */
function dayAxis(opts, xRange) {
  opts.scales.x.type = "linear";
  opts.scales.x.bounds = "data"; // don't stretch the axis past the data to a "nice" tick
  opts.scales.x.ticks.precision = 0; // whole days — a tick between two dates is nonsense
  opts.scales.x.ticks.maxTicksLimit = 8;
  opts.scales.x.ticks.callback = (v) => fmtDay(v);
  if (xRange) {
    opts.scales.x.min = xRange.min;
    opts.scales.x.max = xRange.max;
  }
  opts.plugins.tooltip.callbacks.title = (items) => (items.length ? fmtDay(items[0].parsed.x) : "");
}

function baseOptions(unit = "") {
  const suffix = unit ? " " + unit : "";
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
        callbacks: {
          label: (ctx) => {
            const horiz = ctx.chart && ctx.chart.options && ctx.chart.options.indexAxis === "y";
            const raw = horiz ? ctx.parsed.x : ctx.parsed.y;
            const name = ctx.dataset && ctx.dataset.label ? `${ctx.dataset.label}: ` : "";
            return `${name}${localeNum(raw)}${suffix}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { font: FONT, color: INK2 },
        grid: { color: HAIRLINE, drawTicks: false },
        border: { color: HAIRLINE },
      },
      y: {
        ticks: { font: FONT, color: INK2, precision: 0, callback: localeNum },
        grid: { color: HAIRLINE, drawTicks: false },
        border: { display: false },
        beginAtZero: true,
      },
    },
  };
}

/** Tag a chart canvas as an image with a concise text alternative for assistive tech. */
function describe(canvas, text) {
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", text);
}

function destroyExisting(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

/** Tear down any chart bound to a canvas (e.g. before showing an empty state). */
export function destroyChart(canvas) {
  destroyExisting(canvas);
}

/** Draws each bar's value just past its end (like the Streamlit severity chart). */
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

// A subtle shaded rect over the reconstructed (pre-first-scan) prefix of a trend, drawn
// behind the datasets. Reconstructed points are always the contiguous leading run, so the
// band spans from the first plotted point to the midpoint between the last reconstructed
// and first real point (in day-value space — the x scale is linear, so pixels come from
// values, not indices). Meaning is carried by the shading + the caption beneath the chart
// (and hollow points on the MTTR line), never by colour alone. Null when nothing is
// reconstructed. `xDays` is the per-point epoch-day array parallel to `flags`.
function reconstructedBand(flags, xDays) {
  if (!flags.some(Boolean)) return null;
  const firstReal = flags.findIndex((r) => !r); // -1 → every point reconstructed
  return {
    id: "reconstructedBand",
    beforeDatasetsDraw(chart) {
      const xs = chart.scales.x;
      const area = chart.chartArea;
      if (!xs || !area) return;
      let right = area.right;
      if (firstReal > 0) {
        right = (xs.getPixelForValue(xDays[firstReal - 1]) + xs.getPixelForValue(xDays[firstReal])) / 2;
      }
      // Start at the first plotted point, not the axis edge: with a pinned window the
      // chart can have honest empty space on the left, and that space isn't "reconstructed
      // data" — it's no data.
      const left = Math.max(area.left, xs.getPixelForValue(xDays[0]));
      right = Math.min(Math.max(right, left), area.right);
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = "rgba(100, 116, 139, 0.10)";
      ctx.fillRect(left, area.top, right - left, area.height);
      ctx.restore();
    },
  };
}

/** Horizontal severity bar; clicking a bar toggles that severity filter. */
export function severityBar(canvas, counts, palette, onClickSeverity) {
  destroyExisting(canvas);
  const sevs = palette.order.filter((s) => counts[s]);
  describe(canvas, `Open findings by severity: ${
    sevs.map((s) => `${s} ${counts[s]}`).join(", ") || "none"}`);
  const opts = baseOptions("findings");
  opts.indexAxis = "y";
  opts.scales.x.beginAtZero = true;
  opts.scales.x.ticks.precision = 0;
  opts.scales.x.ticks.callback = localeNum;
  // Headroom so the end-of-bar value labels aren't clipped at the axis edge.
  opts.scales.x.grace = "8%";
  opts.scales.y.grid = { display: false };
  opts.onClick = (_evt, elements) => {
    if (elements.length && onClickSeverity) onClickSeverity(sevs[elements[0].index]);
  };
  opts.onHover = (evt, elements) => {
    evt.native.target.style.cursor = elements.length && onClickSeverity ? "pointer" : "default";
  };
  return new Chart(canvas, {
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
    plugins: [barEndLabels],
  });
}

/**
 * Stacked bar of per-severity bucket counts (open ages by default; pass `desc` when the
 * buckets mean something else, e.g. time-to-resolve). Severity is color + legend label +
 * tooltip title — never color alone.
 */
export function stackedAgeBar(canvas, labels, perSev, palette, desc) {
  destroyExisting(canvas);
  describe(canvas, desc || "Open findings by age bucket and severity.");
  const opts = baseOptions("findings");
  opts.scales.x.stacked = true;
  opts.scales.y.stacked = true;
  opts.scales.x.grid = { display: false };
  opts.plugins.legend = { display: true, labels: { font: FONT, color: INK2, boxWidth: 12 } };
  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: palette.order
        .filter((s) => perSev[s])
        .map((s) => ({
          label: s,
          data: perSev[s],
          backgroundColor: palette.colors[s],
          borderRadius: 3,
          barThickness: 36,
        })),
    },
    options: opts,
  });
}

/** Single line over ISO dates (MTTR median trend) on the proportional day axis. Points
 * before the first saved scan (`p.reconstructed`) are drawn hollow under a shaded band;
 * see `reconstructedBand`. `xRange` (epoch days) pins the visible window when set. */
export function trendLine(canvas, points, { yLabel, xRange } = {}) {
  destroyExisting(canvas);
  const reconCount = points.filter((p) => p.reconstructed).length;
  describe(
    canvas,
    `${yLabel ? yLabel + " " : ""}trend across ${points.length} point(s)` +
      (reconCount ? `, ${reconCount} reconstructed from first-detection dates before the first saved scan` : "") +
      ".",
  );
  const opts = baseOptions(yLabel || "");
  opts.scales.y.beginAtZero = true;
  if (yLabel) {
    opts.scales.y.title = { display: true, text: yLabel, font: FONT, color: INK2 };
  }
  const days = points.map((p) => dayOf(p.x));
  dayAxis(opts, xRange);
  const band = reconstructedBand(points.map((p) => p.reconstructed), days);
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          data: points.map((p, i) => ({ x: days[i], y: p.y })),
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.08)",
          fill: true,
          tension: 0.25,
          pointRadius: points.length > 40 ? 0 : 3,
          // Reconstructed vertices are hollow (white fill), measured ones solid — a shape cue
          // that reads without colour, matching the shaded band and caption.
          pointBackgroundColor: (c) =>
            points[c.dataIndex] && points[c.dataIndex].reconstructed ? "#ffffff" : "#2563eb",
          pointBorderColor: "#2563eb",
          pointBorderWidth: 1.5,
          borderWidth: 2,
        },
      ],
    },
    options: opts,
    plugins: band ? [band] : [],
  });
}

// Distinct point marker per severity so each vertex carries a shape cue, not color
// alone — the red/orange/amber severity cluster is a known colorblind risk.
const SEV_POINT_STYLE = {
  CRITICAL: "circle",
  HIGH: "triangle",
  MEDIUM: "rect",
  LOW: "rectRot",
  INFO: "star",
  UNKNOWN: "crossRot",
};

function sevLabel(s) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/**
 * Open findings per severity over time: one line per severity, encoded by color +
 * legend/tooltip label + a distinct point marker (never color alone). `points` are
 * `{ date, bySev }` rows; `sevScope` limits which severities are drawn (matching the
 * card and the page's display-severity scope).
 */
export function severityTrendLines(canvas, points, palette, sevScope) {
  destroyExisting(canvas);
  const scope = new Set(sevScope || palette.order);
  // Draw a severity only if it's in scope and had at least one open finding at some
  // point in the window — a severity that's all-zero across the series adds a flat
  // baseline that's noise, not signal.
  const sevs = palette.order.filter(
    (s) => scope.has(s) && points.some((p) => (p.bySev[s] || 0) > 0),
  );
  describe(canvas, "Open findings per severity over time.");
  const opts = baseOptions("findings");
  opts.plugins.legend = {
    display: true,
    labels: { font: FONT, color: INK2, boxWidth: 12, usePointStyle: true },
  };
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((p) => p.date.slice(0, 10)),
      datasets: sevs.map((s) => ({
        label: sevLabel(s),
        data: points.map((p) => p.bySev[s] || 0),
        borderColor: palette.colors[s],
        backgroundColor: palette.colors[s],
        pointStyle: SEV_POINT_STYLE[s] || "circle",
        pointRadius: points.length > 40 ? 0 : 3,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.25,
      })),
    },
    options: opts,
  });
}

/**
 * Open vs resolved dual line on the proportional day axis. Red/green is the worst
 * colorblind pair, so it's encoded three ways: color, a dash on Resolved, and a distinct
 * legend point-style (circle vs rect) shown via usePointStyle — the swatches differ by
 * shape, not color alone. `xRange` (epoch days) pins the visible window when set.
 */
export function openResolvedLines(canvas, points, { xRange } = {}) {
  destroyExisting(canvas);
  const reconCount = points.filter((p) => p.reconstructed).length;
  describe(
    canvas,
    "Open vs resolved findings over time." +
      (reconCount ? ` The first ${reconCount} point(s) are reconstructed from first-detection dates before the first saved scan.` : ""),
  );
  const opts = baseOptions("findings");
  opts.plugins.legend = {
    display: true,
    labels: { font: FONT, color: INK2, usePointStyle: true, boxWidth: 8 },
  };
  const days = points.map((p) => dayOf(p.date));
  dayAxis(opts, xRange);
  const band = reconstructedBand(points.map((p) => p.reconstructed), days);
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Open",
          data: points.map((p, i) => ({ x: days[i], y: p.open })),
          borderColor: "#b91c1c",
          borderWidth: 2,
          pointStyle: "circle",
          pointRadius: 0,
          tension: 0.25,
        },
        {
          label: "Resolved",
          data: points.map((p, i) => ({ x: days[i], y: p.resolved })),
          borderColor: "#15803d",
          borderDash: [6, 4],
          borderWidth: 2,
          pointStyle: "rect",
          pointRadius: 0,
          tension: 0.25,
        },
      ],
    },
    options: opts,
    plugins: band ? [band] : [],
  });
}

// ------------------------------------------------------------------- grouping charts

// Categorical hues for the grouping charts (pie + group trend). Deliberately kept OUTSIDE
// the severity red/orange/amber band (see --sev-* in styles.css) so a group is never read
// as a severity; #2563eb is the shared brand/data blue. This order was validated with the
// dataviz skill's palette check on the light surface: all eight sit in the lightness band
// and clear 3:1 on the surface, worst adjacent CVD ΔE 10.3, worst adjacent normal-vision
// ΔE 22.6. A pie is an all-pairs form, so eight hues can't all separate under CVD at once —
// the on-arc %, legend point-styles, and tooltip carry identity when a pair is close.
// Kept in sync with --cat-* in styles.css by convention (canvas can't read CSS vars).
const CATEGORICAL = [
  "#2563eb", "#0d9488", "#c026d3", "#4d7c0f",
  "#7c3aed", "#0891b2", "#db2777", "#9333ea",
];
// Neutral gray for the folded-in "Other" bucket — reads as "everything else", not a hue,
// and never collides with a real group's color.
const OTHER_COLOR = "#94a3b8";
// One distinct marker per group series so each vertex carries a shape cue, not color alone
// (mirrors SEV_POINT_STYLE). Cycled only past eight, which the caller never reaches.
const GROUP_POINT_STYLES = [
  "circle", "triangle", "rect", "rectRot",
  "star", "crossRot", "cross", "dash",
];

/**
 * Canonical name->color Map for a set of group names, so the pie and the trend line paint
 * the same group with the same hue. Names take CATEGORICAL in fixed order (never cycled —
 * the caller caps at eight and folds the rest into `otherLabel`); `otherLabel` always maps
 * to the neutral OTHER_COLOR.
 */
export function groupPalette(names, otherLabel = "Other") {
  const map = new Map();
  names.forEach((name, i) => map.set(name, CATEGORICAL[i % CATEGORICAL.length]));
  map.set(otherLabel, OTHER_COLOR);
  return map;
}

// Draws each slice's share as a % at its arc centroid, but only for slices with enough
// sweep to hold a legible label (>= ~8%); the legend, tooltip, and aria label cover the
// thin ones. Modeled on barEndLabels. White text reads on every CATEGORICAL/OTHER fill.
const arcPercentLabels = {
  id: "arcPercentLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const data = chart.data.datasets[0].data;
    const total = data.reduce((a, b) => a + (Number(b) || 0), 0);
    if (!total) return;
    ctx.save();
    ctx.font = "600 11px " + FONT.family;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    meta.data.forEach((arc, i) => {
      const share = (Number(data[i]) || 0) / total;
      if (share < 0.08) return; // too thin for a label; legend + tooltip cover it
      const p = arc.tooltipPosition();
      ctx.fillText(Math.round(share * 100) + "%", p.x, p.y);
    });
    ctx.restore();
  },
};

/**
 * Pie partitioning a population across the top-level groups. `slices` = [{label, value,
 * color, detail?}] (the caller appends an "Other" slice when present). Plain pie, not a
 * doughnut — the total already lives in the KPI band. Meaning never rides on color alone: a
 * right-side legend (point-style swatches), on-arc percentages, tooltip, and a text
 * alternative all name each group. `opts.subject` is the leading noun of the text
 * alternative (default "Open findings by group"); a slice's optional `detail` string is
 * shown as a second tooltip line and folded into that slice's aria part.
 */
export function groupPie(canvas, slices, opts = {}) {
  destroyExisting(canvas);
  const subject = opts.subject || "Open findings by group";
  const total = slices.reduce((a, s) => a + (Number(s.value) || 0), 0);
  const parts = slices.map((s) => {
    const pct = total ? Math.round((Number(s.value) || 0) / total * 100) : 0;
    const base = s.label + " " + localeNum(s.value) + " (" + pct + "%)";
    return s.detail ? base + ", " + s.detail : base;
  });
  describe(canvas, subject + ": " + (parts.join(", ") || "none") + ".");
  return new Chart(canvas, {
    type: "pie",
    data: {
      labels: slices.map((s) => s.label),
      datasets: [
        {
          data: slices.map((s) => s.value),
          backgroundColor: slices.map((s) => s.color),
          borderColor: "#ffffff",
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion ? false : { duration: 300 },
      plugins: {
        legend: {
          display: true,
          position: "right",
          labels: { font: FONT, color: INK2, usePointStyle: true, boxWidth: 8 },
        },
        tooltip: {
          backgroundColor: "#0a0a0a",
          titleFont: FONT,
          bodyFont: FONT,
          cornerRadius: 6,
          padding: 10,
          callbacks: {
            // Slice label is the tooltip title; the body adds the grouped count + share.
            label: (ctx) => {
              const v = Number(ctx.parsed) || 0;
              const pct = total ? Math.round(v / total * 100) : 0;
              return " " + localeNum(v) + " (" + pct + "%)";
            },
            // A second line carrying the slice's optional detail (e.g. that group's median
            // MTTR) — undefined when the slice has none, so Breakdown slices are unchanged.
            afterLabel: (ctx) => slices[ctx.dataIndex].detail,
          },
        },
      },
    },
    plugins: [arcPercentLabels],
  });
}

/**
 * A value per group over time: one line per series, encoded by color + legend/tooltip
 * label + a distinct point marker (never color alone). Mirrors severityTrendLines — a
 * category x axis of ISO days, not the proportional day axis. `points` are
 * `{ date, byGroup }` rows; `series` = [{name, color}] (Other last when present), the same
 * canonical set the pie uses. `cfg`: `unit` labels the y axis and tooltip (default
 * "findings", which adds no y-axis title); `nullAsGap` plots missing/`null` values as line
 * breaks (spanGaps) rather than fake zeros — for a median that has no sample yet; `describe`
 * overrides the text alternative.
 */
export function groupTrendLines(canvas, points, series, cfg = {}) {
  destroyExisting(canvas);
  const { unit = "findings", nullAsGap = false, describe: aria } = cfg;
  describe(canvas, aria || "Open findings per group over time.");
  const opts = baseOptions(unit);
  // A magnitude unit gets a y-axis title (mirrors trendLine); "findings" stays untitled,
  // matching the Breakdown call site's original look.
  if (unit !== "findings") {
    opts.scales.y.title = { display: true, text: unit, font: FONT, color: INK2 };
  }
  opts.plugins.legend = {
    display: true,
    labels: { font: FONT, color: INK2, boxWidth: 12, usePointStyle: true },
  };
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((p) => p.date.slice(0, 10)),
      datasets: series.map((s, i) => ({
        label: s.name,
        data: points.map((p) => (nullAsGap ? (p.byGroup[s.name] ?? null) : (p.byGroup[s.name] || 0))),
        spanGaps: nullAsGap,
        borderColor: s.color,
        backgroundColor: s.color,
        pointStyle: GROUP_POINT_STYLES[i % GROUP_POINT_STYLES.length],
        pointRadius: points.length > 40 ? 0 : 3,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.25,
      })),
    },
    options: opts,
  });
}
