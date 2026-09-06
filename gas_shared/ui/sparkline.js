// A series as one line, at the size of a word.
//
// WHAT IT IS FOR. A register's figure cards say where a number IS; almost none of them say
// where it is GOING, and the two facts are read together or not at all — "41 days" over a
// half-life that has been falling for four scans is a different reading from the same 41
// days over one that has doubled. The trend was on the wire already (every KPI these pages
// draw comes out of a scan history); what was missing was somewhere to put it that does not
// cost the card a chart.
//
// THE GAP IS THE POINT, AND IT IS WHY THE REFUSAL COMES FIRST. A scan that never ran is not
// a scan that measured zero. `Number(null)`, `Number("")`, `Number([])` and `Number(false)`
// are all `0` AND finite — CLAUDE.md names that set three times — so the tempting
// `points.map(Number).filter(Number.isFinite)` rewrite silently plots every missing reading
// on the floor of the chart and draws a confident crash. Each point is refused by TYPE
// before any cast, exactly the way `figures.js`'s `num()` and `relativeAge()` do it, and a
// refused point becomes a BREAK in the path rather than a value: the line stops, and starts
// again at the next reading it actually has. `test/contracts/sparkline.js` reproduces the
// cast-first rewrite inline and shows it plotting the floor.
//
// NO ANIMATION, AND NOTHING TO REDUCE. There is no transition and no draw-on animation, so
// there is no `prefers-reduced-motion` alternative to keep in step — the picture is static
// the first time it paints. That is deliberate rather than unfinished: a sparkline animating
// beside a figure is motion spent on a value that did not change.
//
// THE CLASS IS `.sparkline`, NOT `.spark`, AND THAT IS A COLLISION RATHER THAN A PREFERENCE.
// `gas/src/client/styles/pages.css` already owns `.spark` — a bordered CARD holding a canvas,
// a glyph, a label and a value, one per tier on the Overview page's small multiples. A shared
// `.spark` in components.css would land ABOVE that app's own sheet in the cascade and reach
// every one of those cards: `color: var(--text-2)` alone would grey out `.spark__value`, which
// sets a size and a weight and inherits its ink. Same shape as the `.health-` / `.diag-` split
// CLAUDE.md already records, and the same resolution — take the unclaimed name and say why.
//
// THE FUNCTION NAME OVERLAPS TOO, and that one is left alone deliberately. `gas` and
// `gas_devsecops` each have a CANVAS `sparkline(canvas, values, opts)` in their own
// `charts.js`, reached as `charts.sparkline(...)` through a namespace import, so nothing
// resolves ambiguously today. Those two are near-duplicates of each other and are the obvious
// next promotion; folding them into this module is a behaviour change to two shipped charts
// and belongs in its own round, not in the commit that adds an SVG one.
//
// `svgEl` RATHER THAN A LOCAL createElementNS, AND THE REASON IS THE BUILD, not taste. The
// SVG namespace is a URL containing a literal `//`, and `esbuild.config.mjs`'s middlebox
// guard FAILS THE BUILD on any bare `//` that survives comment stripping inside a string —
// SSL-inspecting middleboxes have been observed truncating served lines there. `icons.js`
// builds `SVG_NS` by joining the parts for exactly that reason, and it is already in every
// app's bundle (`ui/uiIcons.js` and `ui/nodeCell.js` both import it), so reaching for its
// `svgEl` drags nothing new in.

import { svgEl } from "../icons.js";
import { fmtCount, num } from "./figures.js";

/** Two decimals is under a tenth of a pixel at these sizes, and keeps `d` diffable. */
function xy(v) {
  return Math.round(v * 100) / 100;
}

/**
 * The path, and everything a caption needs to say about it — pure.
 *
 * @param {Array<*>} points  one slot per reading, in order. A slot holding null / undefined /
 *   "" / [] / false / anything that was never a number is a GAP: it keeps its place on the x
 *   axis and breaks the line, rather than being dropped (which would silently compress time)
 *   or cast (which would plot it at zero).
 * @param {{w?: number, h?: number, pad?: number}} [opts]  the box the line is drawn in, and
 *   the inset that keeps a stroke at the extremes from being clipped by the viewBox edge.
 * @returns {{d: string, n: number, gaps: number, first: *, last: *, min: *, max: *,
 *            end: ({x: number, y: number}|null)}}
 *   `n` counts the readings that were really numbers and `gaps` the slots that were not, so
 *   a caller can say what the picture left out. `first`/`last`/`min`/`max` are over the
 *   MEASURED readings only, and are null when there were none. FEWER THAN TWO measured
 *   readings yields `d: ""` — one point is not a trend, and a line drawn through it would
 *   claim a direction nothing measured — but `end` still carries the one reading's
 *   coordinates, so a lone dot can be drawn where a line cannot. The geometry lives HERE and
 *   only here: the end dot re-derived from a second copy of this arithmetic is a drift
 *   waiting for the first caller who changes `pad`.
 */
export function sparkPath(points, opts = {}) {
  const { w = 96, h = 24, pad = 2 } = opts;
  const slots = Array.isArray(points) ? points : [];

  // REFUSED BY TYPE, BEFORE ANY CAST. `num()` is the same allowlist every figure in this
  // package goes through: only a real number or a non-empty numeric string is a candidate.
  const values = slots.map((p) => num(p));
  const measured = values.filter((v) => v !== null);
  const n = measured.length;
  const gaps = values.length - n;

  const first = n ? measured[0] : null;
  const last = n ? measured[n - 1] : null;
  const min = n ? Math.min(...measured) : null;
  const max = n ? Math.max(...measured) : null;

  const innerW = Math.max(0, w - pad * 2);
  const innerH = Math.max(0, h - pad * 2);
  const span = n ? max - min : 0;
  // A FLAT SERIES IS A REAL READING, not a degenerate one: eight scans that all said 41 days
  // draw a straight line down the middle. Dividing by a zero span would put every point at
  // NaN, so the flat case is answered explicitly rather than guarded against.
  const yOf = (v) => (span === 0 ? pad + innerH / 2 : pad + innerH - ((v - min) / span) * innerH);
  const xOf = (i) => (slots.length < 2 ? pad + innerW / 2 : pad + (i / (slots.length - 1)) * innerW);

  let lastIndex = values.length - 1;
  while (lastIndex >= 0 && values[lastIndex] === null) lastIndex--;
  const end = lastIndex < 0
    ? null
    : { x: xy(xOf(lastIndex)), y: xy(yOf(values[lastIndex])) };

  if (n < 2) return { d: "", n, gaps, first, last, min, max, end };

  // A RUN OF ONE would be an `M` with nothing after it — invisible under `fill: none`. The
  // stroke's round cap turns a zero-length segment into a dot, so an isolated reading still
  // shows up as the reading it is.
  //
  // CLOSED ON EVERY EXIT, NOT ONLY AT THE END, and that is a defect this file shipped for one
  // draft: the first version only patched the run still open when the loop finished, so a
  // series whose FIRST reading was followed by a gap — `[12, null, 9, 7, 41]`, the shape a
  // register with one missed scan actually has — emitted `M2,19.06 M48,20.82 …` and painted
  // that reading nowhere. Found by rendering it, not by reading it; `contracts/sparkline.js`
  // now checks every run rather than the last one.
  const parts = [];
  let open = false;
  let runStart = -1;
  let runLength = 0;
  const closeRun = () => {
    if (open && runLength === 1) parts.push("L" + parts[runStart].slice(1));
    open = false;
    runStart = -1;
    runLength = 0;
  };
  values.forEach((v, i) => {
    if (v === null) { closeRun(); return; }
    const point = xy(xOf(i)) + "," + xy(yOf(v));
    if (!open) { runStart = parts.length; parts.push("M" + point); open = true; runLength = 1; return; }
    parts.push("L" + point);
    runLength += 1;
  });
  closeRun();

  return { d: parts.join(" "), n, gaps, first, last, min, max, end };
}

/**
 * The line itself, as an inline `role="img"` SVG.
 *
 * THE LABEL ALWAYS CARRIES THE FIGURES, and a caller-supplied `label` NAMES the series
 * rather than replacing them. That asymmetry is deliberate: DESIGN.md's accessibility bar
 * asks every chart for a text alternative stating its own values, and a component that let a
 * caller pass "Half-life trend" as the whole label would let the figures out of the
 * alternative one call site at a time.
 *
 * @param {Array<*>} points  as `sparkPath`
 * @param {{label?: string, w?: number, h?: number, pad?: number, unit?: string,
 *          className?: string}} [opts]
 */
export function sparkline(points, opts = {}) {
  const { label = "", w = 96, h = 24, pad = 2, unit = "", className = "" } = opts;
  const model = sparkPath(points, { w, h, pad });

  const svg = svgEl("svg", {
    class: "sparkline" + (className ? " " + className : ""),
    width: w,
    height: h,
    viewBox: "0 0 " + w + " " + h,
    role: "img",
    "aria-label": sparkLabel(model, label, unit),
    // Nothing was drawn at all — a caller styling the empty case (a dashed baseline, say)
    // needs to be able to see the difference between "no readings" and "one reading".
    "data-empty": model.n === 0 ? "" : null,
  });

  if (model.d) {
    svg.append(svgEl("path", {
      class: "sparkline__line",
      d: model.d,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.5,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      // The stroke keeps its weight however the SVG is scaled by its box — without it a
      // 96x24 viewBox stretched into a wider card thins the line along one axis only.
      "vector-effect": "non-scaling-stroke",
    }));
  }
  // WHERE THE SERIES ENDED, emphasised, because that is the value the figure beside it is
  // showing: the line is context and the dot is the reading. Drawn whenever there IS a last
  // reading, line or no line — a series of exactly one reading is a dot and nothing else.
  if (model.end) {
    svg.append(svgEl("circle", {
      class: "sparkline__dot", cx: model.end.x, cy: model.end.y, r: 2, fill: "currentColor",
    }));
  }
  return svg;
}

/**
 * The sentence a screen reader gets instead of the picture: first, last, low, high, and how
 * many readings there were — plus, when there were any, how many slots nobody measured.
 *
 * An unmeasured series says so. A single reading says it is a single reading rather than
 * pretending to a shape, which is the same claim `d: ""` makes in the picture.
 */
export function sparkLabel(model, name = "", unit = "") {
  const lead = name ? name + ": " : "";
  const tail = unit ? " " + unit : "";
  const v = (x) => fmtCount(x) + tail;
  if (model.n === 0) return lead + "not measured";
  if (model.n === 1) return lead + "one reading, " + v(model.first);
  const missing = model.gaps ? ", " + fmtCount(model.gaps) + " not measured" : "";
  return lead + "starts at " + v(model.first) + ", ends at " + v(model.last)
    + ", low " + v(model.min) + ", high " + v(model.max)
    + ", " + fmtCount(model.n) + " readings" + missing;
}
