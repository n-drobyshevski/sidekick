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
//   import { Chart } alone                 122,864 b
//   the thirteen named imports below       191,176 b
//   import Chart from "chart.js/auto"      205,465 b   (+7.5%, not the +20% this comment
//                                                        used to report over nine imports)
//
// So the floor is ~123 KB whatever you import, and auto's premium over registering by hand
// keeps shrinking as this file grows: it was a fifth more when nine components were
// registered (severity/trend charts only) and is an eighth more now that bar, pie and arc
// controllers are registered too for the severity/group/survival charts below — narrow
// registration is closing in on `auto` from underneath as more chart types are ported, which
// is itself worth knowing rather than assuming the old percentage still held.
//
// In the real client bundle chart.js accounts for 170,785 bytes of 732,267 —
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
 *
 * EVERY chart below routes its tooltip through this handler (`enabled: false, external:
 * chartTipHandler`), including the ones ported from gas/ (the OS-vuln register), which draws
 * its own native canvas tooltip box instead. That is a real chassis difference between the
 * two registers, not an oversight: this app has one hover vocabulary
 * (helpContent.js/ui/tip.js) and a second, Chart.js-drawn box would be a second one.
 * `callbacks.title`/`callbacks.label`/`callbacks.afterLabel` still compute what the card
 * shows either way — Chart.js builds the same tooltip MODEL regardless of who paints it, so
 * porting a chart's callback logic verbatim and swapping only the paint path is correct.
 */
let tipHandler = null;

export function setChartTipHandler(fn) {
  tipHandler = typeof fn === "function" ? fn : null;
}

function chartTipHandler(ctx) {
  if (tipHandler) tipHandler(ctx);
}

Chart.register(
  ArcElement, BarController, BarElement, CategoryScale, Filler, Legend,
  LinearScale, LineController, LineElement, PieController, PointElement, Tooltip,
);

// Brand accent (crimson) — data color for non-severity series only.
// The chart series colour is --accent-text, NOT --accent: #ffcb13 is 1.52:1 on the
// canvas ground and a 2px line in it is invisible. Canvas cannot read CSS custom
// properties, so this literal mirrors styles/tokens.css --accent-text by convention.
export const ACCENT = "#7c4a0a";

const FONT = {
  family:
    '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  size: 12,
};
const INK2 = "rgba(0,0,0,0.65)";
const HAIRLINE = "#e6e6e9";

// Group digits, so figures inside charts follow the same "tabular, thousands-separated,
// the-number-is-the-product" rule as the rest of the app (canvas ignores
// font-variant-numeric, so a formatter callback is the only way to get grouping).
const localeNum = (v) => (typeof v === "number" ? Number(v).toLocaleString() : v);

const reducedMotion =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Human-readable duration for chart tooltips: break a fractional day/week count into a
 * compound "big unit + next unit" figure so a hover never shows a bare "0.4 days" / "1.5
 * weeks" (hard to eyeball). Tiers by magnitude, the way a person would say it:
 *   >= 7d  -> "Xw Y.Yd"  (1.5 weeks -> "1w 3.5d")
 *   1-7d   -> "Xd Yh"    (2.3 days  -> "2d 7h")
 *   1h-1d  -> "Xh"       (0.4 days  -> "10h")
 *   < 1h   -> "<1h"
 * Rounding carries up so a boundary value never prints a full next unit: 6.98d rounds its
 * hour component up to "7d" rather than "6d 24h" (measured; it stays in the day tier since
 * 6.98 < 7, it does not jump to "1w"), and 23.7h is "1d", not "0d 24h" (measured: h =
 * round(0.9875*24) = 24, which trips the >=24 branch). `days` is a non-negative day count;
 * nullish/NaN -> "—" (tooltips always pass a number, but stay defensive). Decimal points
 * use "." to match fmtDays and the rest of the app's duration formatting.
 */
export function fmtDuration(days) {
  if (days === null || days === undefined || Number.isNaN(days)) return "—";
  const d = Number(days);
  if (d <= 0) return "0d";
  if (d < 1 / 24) return "<1h";
  if (d < 1) {
    const h = Math.round(d * 24);
    return h >= 24 ? "1d" : `${h}h`;
  }
  if (d < 7) {
    let dd = Math.floor(d);
    let h = Math.round((d - dd) * 24);
    if (h >= 24) { dd += 1; h = 0; }
    return h ? `${dd}d ${h}h` : `${dd}d`;
  }
  let w = Math.floor(d / 7);
  let rem = Math.round((d - w * 7) * 10) / 10; // remaining days, 1 decimal
  if (rem >= 7) { w += 1; rem = 0; }
  return rem ? `${w}w ${rem}d` : `${w}w`;
}

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
}

function baseOptions(unit = "") {
  const suffix = unit ? " " + unit : "";
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
        callbacks: {
          label: (ctx) => {
            const horiz = ctx.chart && ctx.chart.options && ctx.chart.options.indexAxis === "y";
            const raw = horiz ? ctx.parsed.x : ctx.parsed.y;
            const name = ctx.dataset && ctx.dataset.label ? `${ctx.dataset.label}: ` : "";
            // Duration units render as a compound figure (2d 7h, not "2.3 days"); every other
            // unit keeps the grouped number + unit suffix.
            if (unit === "days" || unit === "weeks") {
              return `${name}${fmtDuration(unit === "weeks" ? raw * 7 : raw)}`;
            }
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

// A subtle shaded rect over the reconstructed (pre-first-scan) prefix of a trend, drawn
// behind the datasets. Reconstructed points are always the contiguous leading run, so the
// band spans from the first plotted point to the midpoint between the last reconstructed
// and first real point (in day-value space — the x scale is linear, so pixels come from
// values, not indices). Meaning is carried by the shading + the caption beneath the chart
// (and hollow points on the line), never by colour alone. Null when nothing is
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
    // An empty yLabel means the caller already names the axis outside the canvas (the
  // header's own "Cumulative cover" label). A rotated title in a 124px-tall chart clips.
  opts.scales.y.title = yLabel
    ? { display: true, text: yLabel, font: FONT, color: INK2 }
    : { display: false };
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
      backgroundColor: multi ? s.color || ACCENT : "rgba(124, 74, 10, 0.08)",
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
        backgroundColor: "rgba(124, 74, 10, 0.14)",
        borderWidth: 2,
        pointRadius: points.length > 30 ? 0 : 3,
        pointBackgroundColor: ACCENT,
      }],
    },
    options: opts,
  });
}

// ---------------------------------------------------------------- severity / age charts

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
 * Diagonal hatch so a fill can read as "not measured" rather than a flat colour, the way
 * DESIGN.md's non-colour-signal rule wants for a value that is a measurement gap, not a low
 * score. Ported from gas/'s `hatchPattern` (there it backs `tierPalette`'s "unclassified
 * exploit likelihood" swatch — a different register's concept, not this one's).
 *
 * NOTHING IN THIS PACKAGE CALLS IT YET. `stackedAgeBar` below accepts an optional
 * `palette.fills(canvas, key)` hook exactly like gas/'s does, so a future palette builder
 * (e.g. the verdict-hatched capacity split in `brick/devsecops/figures.py::capacity_split`,
 * not yet ported) can reach for this instead of re-deriving it. Kept private and unexported,
 * same as gas/ keeps it, so it stays an implementation detail of whichever palette adopts it.
 */
function hatchPattern(canvas, color) {
  const ctx = canvas.getContext && canvas.getContext("2d");
  if (!ctx || !ctx.createPattern) return color;
  const tile = document.createElement("canvas");
  tile.width = 6;
  tile.height = 6;
  const t = tile.getContext("2d");
  if (!t) return color;
  t.fillStyle = "#e4e4e9";
  t.fillRect(0, 0, 6, 6);
  t.strokeStyle = color;
  t.lineWidth = 2;
  t.beginPath();
  t.moveTo(0, 6);
  t.lineTo(6, 0);
  t.moveTo(-2, 2);
  t.lineTo(2, -2);
  t.moveTo(4, 8);
  t.lineTo(8, 4);
  t.stroke();
  return ctx.createPattern(tile, "repeat") || color;
}

/** Vertical hairline drawn between two categories, labelled above the plot. */
function slaEdgeLine(afterIndex, label) {
  return {
    id: "slaEdge",
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const x = scales.x;
      if (!x || afterIndex < 0 || afterIndex >= x.ticks.length - 1) return;
      const px = (x.getPixelForTick(afterIndex) + x.getPixelForTick(afterIndex + 1)) / 2;
      ctx.save();
      ctx.strokeStyle = "#a16207";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#a16207";
      ctx.font = "600 10px " + FONT.family;
      ctx.textAlign = "left";
      ctx.fillText(label, px + 5, chartArea.top + 10);
      ctx.restore();
    },
  };
}

/**
 * Stacked bar of per-severity bucket counts (open ages by default; pass `desc` when the
 * buckets mean something else, e.g. time-to-resolve). Severity is color + legend label +
 * tooltip title — never color alone.
 */
export function stackedAgeBar(canvas, labels, perSev, palette, desc, opts2 = {}) {
  destroyExisting(canvas);
  describe(canvas, desc || "Open findings by age bucket and severity.");
  const opts = baseOptions("findings");
  opts.scales.x.stacked = true;
  opts.scales.y.stacked = true;
  opts.scales.x.grid = { display: false };
  opts.plugins.legend = { display: true, labels: { font: FONT, color: INK2, boxWidth: 12 } };
  const plugins = [];
  // `slaEdgeAfter` marks the boundary between the in-SLA bucket and the breaches to its
  // right. On a single-severity register every bucket past the first IS a breach, which the
  // old severity-stacked chart implied and never said.
  if (typeof opts2.slaEdgeAfter === "number") {
    plugins.push(slaEdgeLine(opts2.slaEdgeAfter, opts2.slaEdgeLabel || "SLA"));
  }
  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: palette.order
        .filter((s) => perSev[s])
        .map((s) => ({
          label: palette.labels ? palette.labels[s] || s : s,
          data: perSev[s],
          backgroundColor: palette.fills ? palette.fills(canvas, s) : palette.colors[s],
          borderRadius: 3,
          barThickness: 36,
        })),
    },
    options: opts,
    plugins,
  });
}

/**
 * A sparkline: one series, its own y-scale, no axes, an emphasised endpoint.
 *
 * Small multiples rather than one shared axis is the point — magnitude is carried by the
 * count printed beside it, never by this chart's own scale, so tiers spanning orders of
 * magnitude don't flatten the small ones onto the baseline.
 */
export function sparkline(canvas, values, { color, desc } = {}) {
  destroyExisting(canvas);
  describe(canvas, desc || "Trend sparkline.");
  const ink = color || "#6b7280";
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: values.map((_, i) => i),
      datasets: [{
        data: values,
        borderColor: ink,
        borderWidth: 2,
        tension: 0.25,
        fill: false,
        pointRadius: values.map((_, i) => (i === values.length - 1 ? 3 : 0)),
        pointBackgroundColor: ink,
        pointBorderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion ? false : { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        // NOT beginAtZero: these read as shape, and pinning to zero would flatten a tier
        // whose whole range sits well above it.
        y: { display: false, grace: "12%" },
      },
      layout: { padding: { top: 4, bottom: 4, left: 2, right: 4 } },
    },
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
  // Points hide (pointRadius 0) above 40 samples, so a nearest/intersect tooltip has nothing
  // to hit; index mode reveals every series' value at the nearest date on hover. Matches
  // openResolvedLines.
  opts.interaction = { mode: "index", intersect: false };
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
  // Both lines use pointRadius 0, so the default nearest/intersect tooltip has nothing to
  // hit. Index mode reveals both Open and Resolved at the nearest date in one tooltip when
  // hovering anywhere along the x.
  opts.interaction = { mode: "index", intersect: false };
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
          pointHoverRadius: 4,
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
          pointHoverRadius: 4,
          tension: 0.25,
        },
      ],
    },
    options: opts,
    plugins: band ? [band] : [],
  });
}

// -------------------------------------------------------------- survival curve (KM)

// Marker glossary for the KM survival chart: key into the {naiveMedian, median, naiveMean,
// mean} day values, its legend label, hex color, and a Chart.js pointStyle distinct from
// every other marker on the chart. KM (all-findings) markers take this register's accent
// INK (`--accent-text`, never the `--accent` fill — DESIGN.md's Split-Accent Rule: #ffcb13
// is 1.52:1 on white and cannot carry a line or a point stroke); naive (closed-only)
// markers are plain ink. gas/'s own survivalCurve uses ITS brand blue here — that is the
// one substitution this port makes throughout the file, not a stylistic choice repeated per
// chart. Meaning is carried by label + point-style too, matching the rest of the app's
// "never color alone" rule.
const KM_MARKERS = [
  { key: "naiveMedian", label: "Median (closed)", color: "#171717", pointStyle: "circle" },
  { key: "median", label: "Median (KM, all)", scopeSuffix: "all)", color: ACCENT, pointStyle: "triangle" },
  { key: "naiveMean", label: "Mean (closed)", color: "#171717", pointStyle: "rect" },
  { key: "mean", label: "Mean (KM · RMST, all)", scopeSuffix: "all)", color: ACCENT, pointStyle: "rectRot" },
];

/**
 * A marker's legend text, with its POPULATION word replaced where the caller named one.
 *
 * The two KM markers say what they were estimated OVER — "all" meaning all findings, closed
 * and open — and on a per-severity small multiple that word is simply false: the diamond on
 * the CRITICAL card is CRITICAL's own restricted mean, not the register's. So `scopeSuffix`
 * marks the two labels whose parenthetical ends in a population, and `viewOpts.scope` swaps it.
 *
 * THE CLOSED-ONLY MARKERS ARE LEFT ALONE ON PURPOSE. "(closed)" says how the estimate was
 * made, not over what; rewriting it to "(CRITICAL)" would delete the one word that
 * distinguishes the naive statistic from the Kaplan-Meier one beside it.
 *
 * Unscoped callers get `m.label` back unchanged, byte for byte — the overall curve on this
 * page and the one on `#/secrets` still read "Median (KM, all)".
 */
function markerLabel(m, scope) {
  if (!scope || !m.scopeSuffix || !m.label.endsWith(m.scopeSuffix)) return m.label;
  return m.label.slice(0, m.label.length - m.scopeSuffix.length) + scope + ")";
}

// S(day) off a KM curve (distinct event times ascending, implicit S(0)=1). The staircase is
// right-continuous ("after"): survival holds at its pre-drop level until an event time, then
// drops and holds at the new level — so the answer is the last point with t <= day.
function stepAt(curve, day) {
  let s = 1;
  for (const p of curve) {
    if (p.t <= day) s = p.s;
    else break;
  }
  return s;
}

/**
 * Kaplan-Meier survival curve: an S(t) staircase (x in weeks, y = S(t)*100) with four
 * annotated markers — median/mean, each closed-only (naive) vs all-findings (KM) — sitting
 * on the curve at their day value. No new Chart.js registrations: the staircase is a
 * `type:'line'` dataset (`stepped:'after'`, right-continuous), and the markers are
 * `showLine:false` line datasets (PointElement/LineController are already registered;
 * ScatterController is not, and isn't needed). `curve` is KMResult.curve
 * (`[{t,s,atRisk,events}]`); `markers` is the four day values
 * (`{ naiveMedian, median, naiveMean, mean }` — any may be null, which skips that marker's
 * point rather than plotting a fake one).
 *
 * `viewOpts.color` REPAINTS THE STAIRCASE ONLY, and exists for the per-severity small
 * multiples on the MTTR page: six curves drawn in one grid have to be told apart, and the
 * only palette allowed to do that here is the severity one (`--sev-*`, byte-identical across
 * all four sidekicks). It defaults to `ACCENT`, so every existing caller is unchanged. The
 * MARKERS keep accent ink whatever the line is: they mean "median" and "mean", not "this
 * severity", and giving them the series colour would make one glyph carry two meanings.
 * `viewOpts.subject` names whose curve it is inside the `describe()` text, because six
 * canvases that all announce "survival curve of time to remediation" are six identical
 * announcements to a screen reader. `viewOpts.scope` names the POPULATION the two KM markers
 * were estimated over — see `markerLabel`; without it every card's legend claims "all".
 */
export function survivalCurve(canvas, curve, markers, viewOpts = {}) {
  destroyExisting(canvas);
  const points = curve || [];
  const lineColor = typeof viewOpts.color === "string" && viewOpts.color
    ? viewOpts.color
    : ACCENT;
  const subject = typeof viewOpts.subject === "string" && viewOpts.subject
    ? " " + viewOpts.subject
    : "";
  const scope = typeof viewOpts.scope === "string" && viewOpts.scope ? viewOpts.scope : null;
  // A positive maxWeeks hard-crops the x-axis to that window (the 30w/15w/5w view filter);
  // absent it, keep the auto-extending 26w default. Points/markers past the max clip out —
  // the describe() aria text below still names every marker's day value, so nothing is lost.
  const maxWeeks = Number.isFinite(viewOpts.maxWeeks) && viewOpts.maxWeeks > 0 ? viewOpts.maxWeeks : null;
  const survivalPoints = [{ x: 0, y: 100 }, ...points.map((p) => ({ x: p.t / 7, y: p.s * 100 }))];

  // Only build a dataset for markers the caller actually supplied — a null value means the
  // marker is omitted entirely (no plotted point AND no dead legend entry). This lets a
  // caller pass e.g. {median, mean} to show just the two KM markers.
  const markerDatasets = KM_MARKERS
    .filter((m) => {
      const day = markers ? markers[m.key] : null;
      return day !== null && day !== undefined;
    })
    .map((m) => {
      const day = markers[m.key];
      return {
        label: markerLabel(m, scope),
        data: [{ x: day / 7, y: stepAt(points, day) * 100, day }],
        showLine: false,
        pointRadius: 6,
        pointHoverRadius: 7,
        pointStyle: m.pointStyle,
        backgroundColor: m.color,
        borderColor: m.color,
      };
    });

  const named = KM_MARKERS
    .map((m) => ({ ...m, label: markerLabel(m, scope), day: markers ? markers[m.key] : null }))
    .filter((m) => m.day !== null && m.day !== undefined);
  describe(
    canvas,
    "Kaplan-Meier survival curve of time to remediation" + subject + "." +
      (named.length
        ? " Markers: " + named.map((m) => `${m.label} at ${Math.round(m.day)} day(s)`).join(", ") + "."
        : ""),
  );

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion ? false : { duration: 300 },
    plugins: {
      legend: {
        display: true,
        labels: {
          font: FONT, color: INK2, usePointStyle: true, boxWidth: 8,
          // The staircase itself doesn't need a legend swatch — meaning attaches to the
          // four markers (label + point-style), not to the curve's color.
          filter: (item) => item.datasetIndex !== 0,
        },
      },
      // See the module-level note on `chartTipHandler`: this register paints tooltips in
      // its own DOM card rather than Chart.js's canvas box, so `external` replaces gas/'s
      // `backgroundColor`/`titleFont`/`cornerRadius` styling — the callbacks that decide
      // WHAT the card says are otherwise unchanged from gas/'s survivalCurve.
      tooltip: {
        enabled: false,
        external: chartTipHandler,
        callbacks: {
          title: () => "",
          label: (ctx) =>
            ctx.datasetIndex === 0
              ? `${fmtDuration(ctx.parsed.x * 7)}: ${Math.round(ctx.parsed.y)}% still open`
              : `${ctx.dataset.label}: ${fmtDuration(ctx.raw.day)} (${Math.round(ctx.parsed.y)}% still open)`,
        },
      },
    },
    scales: {
      x: {
        type: "linear",
        min: 0,
        // Hard max when a window is chosen; else auto-extend past the 26w default.
        ...(maxWeeks !== null ? { max: maxWeeks } : { suggestedMax: 26 }),
        title: { display: true, text: "weeks", font: FONT, color: INK2 },
        ticks: { font: FONT, color: INK2 },
        grid: { color: HAIRLINE, drawTicks: false },
        border: { color: HAIRLINE },
      },
      y: {
        min: 0,
        max: 100,
        ticks: { font: FONT, color: INK2, callback: (v) => v + "%" },
        grid: { color: HAIRLINE, drawTicks: false },
        border: { display: false },
      },
    },
  };

  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "S(t)",
          data: survivalPoints,
          stepped: "after",
          borderColor: lineColor,
          pointRadius: 0,
          borderWidth: 2,
        },
        ...markerDatasets,
      ],
    },
    options: opts,
  });
}

// ------------------------------------------------------------------- grouping charts

// Categorical hues for the grouping charts (pie + group trend). Deliberately kept OUTSIDE
// the severity red/orange/amber/blue band (see --sev-* in src/domain/config.ts) so a group
// is never read as a severity.
//
// cat-1 is THIS register's own brand ink, `--accent-text` (#7c4a0a) — NOT gas/'s brand blue
// (#2563eb). gas/'s own CATEGORICAL literally reuses its brand blue as cat-1 ("the shared
// brand/data blue"), and the direct translation of that convention here is this register's
// own brand ink, not a copy of gas/'s hex: #ffcb13 (this register's actual accent) fails as
// ink outright (1.52:1 on white — DESIGN.md's Split-Accent Rule), so it was never a
// candidate for cat-1, and gas/'s literal blue would collide with this register's own
// SEVERITY_COLORS.LOW, which is that same blue.
//
// Re-checked pairwise (CIE76 dE76 in Lab, plus a Viénot/Brettel-style deuteranopia
// simulation matrix — a directional check, not the project's canonical dataviz-skill
// validator, which has not been run over this substitution): swapping cat-1 from #2563eb to
// #7c4a0a leaves the worst-case pair among the other four hues unchanged (#90396a vs
// #f66bb9, dE76 33.4 normal vision; #90396a vs #7fba04, dE76 11.1 simulated deuteranopia —
// identical before and after the swap, since neither pair touches cat-1), and cat-1 itself
// sits far from both severity LOW blue (dE76 117.5) and the OTHER grey (dE76 65.1). FIVE
// hues, not more, for the same reason gas/ caps at five: eight failed the colorblind check
// hard (violet≈blue under deuteranopia).
const CATEGORICAL = [
  ACCENT, "#0d9488", "#90396a", "#7fba04", "#f66bb9",
];
// Neutral gray for the folded-in "Other" bucket — reads as "everything else", not a hue,
// and never collides with a real group's color.
const OTHER_COLOR = "#94a3b8";
// One distinct marker per group series so each vertex carries a shape cue, not color alone
// (mirrors SEV_POINT_STYLE). More styles than hues so the pooled "Other" series (a 6th line
// past the 5 groups) still gets its own marker rather than reusing slot 1's.
const GROUP_POINT_STYLES = [
  "circle", "triangle", "rect", "rectRot",
  "star", "crossRot", "cross", "dash",
];

/**
 * Canonical name->color Map for a set of group names, so the pie and the trend line paint
 * the same group with the same hue. Names take CATEGORICAL in fixed order (the caller caps at
 * CATEGORICAL.length and folds the rest into `otherLabel`); any name past the palette falls
 * back to OTHER_COLOR rather than cycling a hue, so a cap/palette mismatch degrades to a gray
 * "Other" instead of two groups sharing a color. `otherLabel` always maps to OTHER_COLOR.
 */
export function groupPalette(names, otherLabel = "Other") {
  const map = new Map();
  names.forEach((name, i) => map.set(name, CATEGORICAL[i] ?? OTHER_COLOR));
  map.set(otherLabel, OTHER_COLOR);
  return map;
}

// Ink vs white for a label sitting ON a fill: pick whichever keeps the on-fill text legible.
// White reads on the dark/mid fills, but the categorical palette also carries two light fills
// (lime, pink) where white text would wash out — those take near-black. Threshold is where
// white text drops below 3:1 on the fill (WCAG relative luminance).
function onFillText(hex) {
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * lin(parseInt(hex.slice(3, 5), 16)) +
    0.0722 * lin(parseInt(hex.slice(5, 7), 16));
  return 1.05 / (L + 0.05) < 3 ? "#0a0a0a" : "#ffffff"; // white contrast < 3:1 → use ink
}

// Draws each slice's share as a % at its arc centroid, but only for slices with enough
// sweep to hold a legible label (>= ~8%); the legend, tooltip, and aria label cover the
// thin ones. Modeled on barEndLabels. Label ink adapts per slice so it reads on light fills too.
const arcPercentLabels = {
  id: "arcPercentLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const data = chart.data.datasets[0].data;
    const colors = chart.data.datasets[0].backgroundColor || [];
    const total = data.reduce((a, b) => a + (Number(b) || 0), 0);
    if (!total) return;
    ctx.save();
    ctx.font = "600 11px " + FONT.family;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    meta.data.forEach((arc, i) => {
      const share = (Number(data[i]) || 0) / total;
      if (share < 0.08) return; // too thin for a label; legend + tooltip cover it
      const p = arc.tooltipPosition();
      ctx.fillStyle = typeof colors[i] === "string" ? onFillText(colors[i]) : "#ffffff";
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
        // See the module-level note on `chartTipHandler` — external DOM card, not a canvas
        // box; the label/afterLabel logic is unchanged from gas/'s groupPie.
        tooltip: {
          enabled: false,
          external: chartTipHandler,
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
  // Points hide (pointRadius 0) above 40 samples, so a nearest/intersect tooltip has nothing
  // to hit; index mode reveals every series' value at the nearest date on hover. Matches
  // openResolvedLines.
  opts.interaction = { mode: "index", intersect: false };
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

// Draws each horizontal bar's KM median just past its end, as a compound duration (2d 7h, not
// "2.3"). Sibling of barEndLabels, but formats days through fmtDuration instead of a bare count.
function medianDayLabels(groups) {
  return {
    id: "medianDayLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.font = `600 11px ${FONT.family}`;
      ctx.fillStyle = INK2;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      meta.data.forEach((bar, i) => {
        const v = groups[i] && groups[i].value;
        if (v == null) return;
        ctx.fillText(fmtDuration(Number(v)), bar.x + 6, bar.y);
      });
      ctx.restore();
    },
  };
}

// A dashed vertical rule at the overall KM median, with an inked chip naming it. This is the
// baseline the bars are read against — a bar past the rule is a group slower than the register
// median. Drawn on top of the bars (afterDatasetsDraw) so the rule and chip stay legible over a
// fill. Skipped when the median falls outside the drawn range (defensive; the caller only passes
// a finite value). Graphite ink (`--graphite`), not the accent — this is a neutral reference
// mark, the same colour on every sidekick.
function medianReferenceLine(overall) {
  return {
    id: "medianReferenceLine",
    afterDatasetsDraw(chart) {
      const xs = chart.scales.x;
      const area = chart.chartArea;
      if (!xs || !area) return;
      const x = xs.getPixelForValue(overall);
      if (!Number.isFinite(x) || x < area.left || x > area.right) return;
      const { ctx } = chart;
      ctx.save();
      ctx.strokeStyle = "#0a0a0a";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      // Inked chip naming the rule — placed to the right of the line, flipped left when it would
      // spill past the plot edge so the text never clips.
      const label = `overall ${fmtDuration(overall)}`;
      ctx.font = `600 10px ${FONT.family}`;
      const pad = 4;
      const tw = ctx.measureText(label).width;
      let lx = x + 5;
      if (lx + tw + pad * 2 > area.right) lx = x - 5 - tw - pad * 2;
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(lx, area.top + 2, tw + pad * 2, 15);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(label, lx + pad, area.top + 2 + 7.5);
      ctx.restore();
    },
  };
}

/**
 * Horizontal bars of each group's Kaplan–Meier median time-to-remediation (days), ranked
 * slowest-first, against a dashed reference line at the overall KM median. This is the honest
 * "what pulls our MTTR up" view: a bar reaching past the line is a group whose findings take
 * longer than the register median — the groups dragging the headline figure up; bars short of the
 * line pull it down.
 *
 * `groups` = [{ label, value (KM median, days), resolved, color }], sorted desc by the caller.
 * `opts.overall` is the overall KM median (days) for the reference line — omit or pass null to skip
 * it (e.g. when the overall median is itself censored). Meaning never rides on colour alone: bar
 * length vs the labeled rule, the direct day labels, the tooltip, and the text alternative all
 * carry the up/down read.
 */
export function mttrContributionBars(canvas, groups, opts = {}) {
  destroyExisting(canvas);
  const subject = opts.subject || "Median MTTR by group";
  const overall = opts.overall;
  const hasRef = overall !== null && overall !== undefined && Number.isFinite(Number(overall));
  // The up/down clause shared by the tooltip and the text alternative, relative to the reference.
  const dir = (v) => {
    if (!hasRef) return "";
    const d = Number(v) - Number(overall);
    if (Math.abs(d) < 0.05) return ", at the overall median";
    return d > 0
      ? `, ${fmtDuration(d)} above overall — pulls MTTR up`
      : `, ${fmtDuration(-d)} below overall — pulls MTTR down`;
  };
  describe(canvas, `${subject}: ` +
    (groups.map((g) => `${g.label} ${fmtDuration(Number(g.value))}${dir(g.value)}`).join("; ") || "none") +
    (hasRef ? `; overall KM median ${fmtDuration(Number(overall))}.` : "."));

  const opt = baseOptions("days");
  opt.indexAxis = "y";
  opt.scales.x.beginAtZero = true;
  opt.scales.x.grace = "12%"; // headroom so the end-of-bar day labels aren't clipped
  opt.scales.x.title = { display: true, text: "KM median (days)", font: FONT, color: INK2 };
  opt.scales.y.grid = { display: false };
  opt.plugins.tooltip.callbacks.label = (ctx) => {
    const g = groups[ctx.dataIndex];
    const n = g.resolved ?? 0;
    return ` ${fmtDuration(Number(g.value))} · ${localeNum(n)} resolved${dir(g.value)}`;
  };

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels: groups.map((g) => g.label),
      datasets: [
        {
          data: groups.map((g) => g.value),
          backgroundColor: groups.map((g) => g.color),
          borderRadius: 3,
          maxBarThickness: 34,
        },
      ],
    },
    options: opt,
    plugins: hasRef
      ? [medianDayLabels(groups), medianReferenceLine(Number(overall))]
      : [medianDayLabels(groups)],
  });
}

// A solid vertical rule at x = 0 for a diverging bar chart — the origin the bars split around,
// with an inked chip naming what zero means. Sibling of medianReferenceLine, but solid (an origin,
// not a threshold) and always at zero. Drawn on top of the bars so the rule and chip stay legible.
function zeroReferenceLine(labelText) {
  return {
    id: "zeroReferenceLine",
    afterDatasetsDraw(chart) {
      const xs = chart.scales.x;
      const area = chart.chartArea;
      if (!xs || !area) return;
      const x = xs.getPixelForValue(0);
      if (!Number.isFinite(x)) return;
      const { ctx } = chart;
      ctx.save();
      ctx.strokeStyle = "#0a0a0a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.stroke();
      if (labelText) {
        ctx.font = `600 10px ${FONT.family}`;
        const pad = 4;
        const tw = ctx.measureText(labelText).width;
        let lx = x + 5;
        if (lx + tw + pad * 2 > area.right) lx = x - 5 - tw - pad * 2;
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(lx, area.top + 2, tw + pad * 2, 15);
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText(labelText, lx + pad, area.top + 2 + 7.5);
      }
      ctx.restore();
    },
  };
}

// Signed magnitude at each diverging bar's *outer* end — right of a positive bar, left of a
// negative one — so the label never lands on the zero rule. Sibling of medianDayLabels; formats a
// plain grouped count with an explicit "+" on positives (localeNum already carries the − sign).
function divergingBarLabels(rows) {
  return {
    id: "divergingBarLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.font = `600 11px ${FONT.family}`;
      ctx.fillStyle = INK2;
      ctx.textBaseline = "middle";
      meta.data.forEach((bar, i) => {
        const v = Number(rows[i].value) || 0;
        const label = (v > 0 ? "+" : "") + localeNum(v);
        if (v >= 0) {
          ctx.textAlign = "left";
          ctx.fillText(label, bar.x + 6, bar.y);
        } else {
          ctx.textAlign = "right";
          ctx.fillText(label, bar.x - 6, bar.y);
        }
      });
      ctx.restore();
    },
  };
}

/**
 * Diverging horizontal bars of each group's signed contribution to the overall MTTR: resolved
 * findings × (that group's KM median − the overall KM median), in finding·days. A bar right of the
 * zero line (positive) means the group's resolved findings ran slower than the register median and,
 * weighted by how many it closed, dragged the headline figure UP; a bar left of it (negative) means
 * it closed faster than the register median and held the figure DOWN.
 *
 * `rows` = [{ label, value (signed finding·days), median (days), resolved, color }] sorted desc by
 * the caller (most drag-up first). `opts.subject` leads the text alternative. Meaning never rides on
 * colour alone: the side of the zero line, the signed value labels, the tooltip, and the text
 * alternative all carry the up/down read, so bars keep their group hue for cross-chart identity.
 */
export function mttrImpactBars(canvas, rows, opts = {}) {
  destroyExisting(canvas);
  const subject = opts.subject || "Contribution to MTTR by group";
  const signed = (v) => (v > 0 ? "+" : "") + localeNum(v); // localeNum keeps the − on negatives
  const dir = (v) => (v > 0 ? "pulls MTTR up" : v < 0 ? "pulls MTTR down" : "at the overall median");
  describe(canvas, `${subject} (excess finding·days vs the overall median): ` +
    (rows.map((r) => `${r.label} ${signed(Number(r.value) || 0)} — ${dir(Number(r.value) || 0)}`)
      .join("; ") || "none") + ".");

  const opt = baseOptions("finding·days");
  opt.indexAxis = "y";
  // No beginAtZero on the value (x) axis — bars grow from 0 in both directions, so forcing a
  // zero floor would clip the negative (held-down) bars. Chart.js includes 0 for a bar chart anyway.
  opt.scales.x.grace = "12%"; // headroom so the outer value labels aren't clipped on either side
  opt.scales.x.title = {
    display: true, text: "excess finding·days vs overall median", font: FONT, color: INK2,
  };
  opt.scales.y.grid = { display: false };
  opt.plugins.tooltip.callbacks.label = (ctx) => {
    const r = rows[ctx.dataIndex];
    const v = Number(r.value) || 0;
    return ` ${signed(v)} finding·days · median ${fmtDuration(Number(r.median))} · `
      + `${localeNum(r.resolved ?? 0)} resolved — ${dir(v)}`;
  };

  return new Chart(canvas, {
    type: "bar",
    data: {
      labels: rows.map((r) => r.label),
      datasets: [
        {
          data: rows.map((r) => r.value),
          backgroundColor: rows.map((r) => r.color),
          borderRadius: 3,
          maxBarThickness: 34,
        },
      ],
    },
    options: opt,
    plugins: [zeroReferenceLine("at overall median"), divergingBarLabels(rows)],
  });
}

/**
 * Coverage and efficiency over time — the P2P pair on one axis, both in percent.
 *
 * Two series rather than two charts because the whole point of the pair is the trade-off
 * between them: a coverage line climbing while efficiency falls is the story, and it is only
 * legible when they share a y axis. Identity is doubled by dash pattern and point style, so
 * the two read apart without colour (DESIGN.md non-colour-signal rule).
 *
 * Nulls are gaps, not zeros: a date where nothing was high risk yet has no coverage, and
 * drawing that as 0% would invent a failure that did not happen.
 */
export function coverageEfficiencyLines(canvas, points, { xRange } = {}) {
  destroyExisting(canvas);
  const reconCount = points.filter((p) => p.reconstructed).length;
  describe(
    canvas,
    "Remediation coverage and efficiency over time, in percent." +
      (reconCount
        ? ` The first ${reconCount} point(s) are reconstructed from first-detection dates before the first saved scan, where closures are under-counted.`
        : ""),
  );
  const opts = baseOptions("%");
  opts.scales.y.min = 0;
  opts.scales.y.max = 100;
  opts.scales.y.title = { display: true, text: "percent", font: FONT, color: INK2 };
  opts.plugins.legend = {
    display: true,
    labels: { font: FONT, color: INK2, usePointStyle: true, boxWidth: 8 },
  };
  opts.interaction = { mode: "index", intersect: false };
  const days = points.map((p) => dayOf(p.date));
  dayAxis(opts, xRange);
  const band = reconstructedBand(points.map((p) => p.reconstructed), days);
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Coverage",
          data: points.map((p, i) => ({ x: days[i], y: p.coverage_pct })),
          borderColor: CATEGORICAL[0],
          borderWidth: 2,
          pointStyle: "circle",
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.25,
          spanGaps: false,
        },
        {
          label: "Efficiency",
          data: points.map((p, i) => ({ x: days[i], y: p.efficiency_pct })),
          borderColor: CATEGORICAL[1],
          borderDash: [6, 4],
          borderWidth: 2,
          pointStyle: "rect",
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.25,
          spanGaps: false,
        },
      ],
    },
    options: opts,
    plugins: band ? [band] : [],
  });
}

/**
 * The coverage-vs-efficiency scatter — the signature P2P figure: coverage on x, efficiency
 * on y, up-and-to-the-right is better.
 *
 * Implemented as `type: "line"` with `showLine: false` **on purpose**. charts.js registers
 * only the controllers it uses, and ScatterController is not among them; a genuine
 * `type: "scatter"` would fail at runtime in the bundle. LineController + PointElement +
 * LinearScale are all registered, and a line dataset with no line drawn is exactly a
 * scatter. Do not "fix" this into type: "scatter" without also registering the controller.
 *
 * Colour is rationed (DESIGN.md): the active rule is the one accent point (this register's
 * accent INK, `--accent-text` — never the unreadable `--accent` fill), everything else is
 * neutral, and every point is direct-labelled so identity never rides on colour.
 */
export function coverageEfficiencyScatter(canvas, points) {
  destroyExisting(canvas);
  describe(
    canvas,
    "Coverage versus efficiency for each combination of risk signals: " +
      points
        .map(
          (p) =>
            `${p.label}, coverage ${p.coverage === null ? "not measurable" : Math.round(p.coverage) + "%"}, ` +
            `efficiency ${p.efficiency === null ? "not measurable" : Math.round(p.efficiency) + "%"}` +
            (p.active ? " (the active rule)" : ""),
        )
        .join("; ") + ".",
  );
  const plotted = points.filter((p) => p.coverage !== null && p.efficiency !== null);
  const opts = baseOptions("%");
  opts.scales.x.type = "linear";
  opts.scales.x.min = 0;
  opts.scales.x.max = 100;
  opts.scales.x.title = { display: true, text: "coverage %", font: FONT, color: INK2 };
  opts.scales.x.ticks.callback = (v) => v + "%";
  opts.scales.y.min = 0;
  opts.scales.y.max = 100;
  opts.scales.y.title = { display: true, text: "efficiency %", font: FONT, color: INK2 };
  opts.scales.y.ticks.callback = (v) => v + "%";
  opts.plugins.tooltip.callbacks.title = (items) =>
    items.length ? plotted[items[0].dataIndex].label : "";
  opts.plugins.tooltip.callbacks.label = (ctx) => {
    const p = plotted[ctx.dataIndex];
    return [
      `Coverage ${Math.round(p.coverage)}%`,
      `Efficiency ${Math.round(p.efficiency)}%`,
      `${localeNum(p.highRisk)} flagged high risk`,
    ];
  };
  // Direct labels beside each point — the identity cue that survives greyscale and the
  // colour-blind check, and the reason this chart needs no legend.
  //
  // Rules routinely land on identical coordinates (adding a signal that flags nothing new
  // moves neither rate), so labels are decluttered vertically before drawing: without it the
  // co-located ones overprint into an unreadable smear. Greedy top-down separation, and the
  // leader line is drawn whenever a label has been pushed off its point.
  const LABEL_H = 13;
  const labels = {
    id: "scatterLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.font = "600 11px " + FONT.family;
      ctx.textBaseline = "middle";

      // Place labels in ascending y, nudging each one down until it clears the previous.
      const placed = meta.data
        .map((pt, i) => ({ pt, i, y: pt.y }))
        .sort((a, b) => a.y - b.y);
      let lastY = -Infinity;
      for (const item of placed) {
        item.y = Math.max(item.y, lastY + LABEL_H);
        lastY = item.y;
      }
      // If the stack overflowed the plot, slide the whole run back up.
      const overflow = lastY - (chart.chartArea.bottom - 4);
      if (overflow > 0) for (const item of placed) item.y -= overflow;

      for (const item of placed) {
        const p = plotted[item.i];
        // Flip the label inside the plot near the right edge so it never clips.
        const right = item.pt.x > chart.chartArea.right - 100;
        const x = item.pt.x + (right ? -9 : 9);
        // Leader line back to the point, so a displaced label still reads as belonging to it.
        if (Math.abs(item.y - item.pt.y) > 1) {
          ctx.strokeStyle = HAIRLINE;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(item.pt.x, item.pt.y);
          ctx.lineTo(x, item.y);
          ctx.stroke();
        }
        ctx.fillStyle = p.active ? "#171717" : INK2;
        ctx.textAlign = right ? "right" : "left";
        ctx.fillText(p.label, x, item.y);
      }
      ctx.restore();
    },
  };
  return new Chart(canvas, {
    type: "line", // see the note above — NOT "scatter"
    data: {
      datasets: [
        {
          data: plotted.map((p) => ({ x: p.coverage, y: p.efficiency })),
          showLine: false,
          pointRadius: plotted.map((p) => (p.active ? 7 : 5)),
          pointHoverRadius: 9,
          // The active rule is the single accent; the alternatives stay neutral.
          pointBackgroundColor: plotted.map((p) => (p.active ? CATEGORICAL[0] : "#ffffff")),
          pointBorderColor: plotted.map((p) => (p.active ? CATEGORICAL[0] : OTHER_COLOR)),
          pointBorderWidth: 2,
          // A second, non-colour cue for the active rule.
          pointStyle: plotted.map((p) => (p.active ? "rectRot" : "circle")),
        },
      ],
    },
    options: opts,
    plugins: [labels],
  });
}
