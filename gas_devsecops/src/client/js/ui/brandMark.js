// The product mark: a dot-matrix globe under a shield, ringed by a broken orbit.
//
// WHY IT IS DRAWN AND NOT LOADED. The mark arrived as a 955 KB PNG and could not ship as
// one. There is no asset pipeline here — esbuild.config.mjs declares no loader, no
// assetNames and no publicPath, the subproject holds zero binary files, and no stylesheet
// contains a `url(` — because HtmlService serves one inline document and the GAS sandbox
// blocks external fetches (see routeIcons.js). A data URI is worse, not better: base64's
// alphabet includes `/`, so a payload of that size all but certainly contains a bare `//`,
// and the middlebox guard in esbuild.config.mjs exists precisely because an SSL-inspecting
// proxy has been observed truncating served lines at one. So the mark is geometry, traced
// off the source raster and replayed as paths: about 5 KB, and crisp at any size.
//
// TWO VARIANTS, ONE COORDINATE SYSTEM. Everything below is authored in a single 96x96
// frame; `compact` is not a second drawing but a cropped viewBox over the same paths, with
// the globe left out. That is a legibility decision, not a stylistic one: 307 dots inside
// a 20 px sidebar glyph render at a third of a pixel each and read as grey noise, while
// the shield and the orbit are chunky black forms that survive it.
//
// COLOUR. The three colours are the artwork's own and are deliberately NOT severity
// tokens. They ride `--mark-*` custom properties (tokens.css) applied by class from
// base.css, with the literal hex kept on the presentation attribute underneath — the same
// arrangement as ui/uiIcons.js, so the mark still draws correctly with no stylesheet at
// all. That matters here more than anywhere else in the app: the first copy of this mark
// paints from index.html before any JavaScript has run.

import { svgEl } from "../icons.js";

/** The authoring frame. Every path constant below is in these units. */
export const MARK_VIEWBOX = "0 0 96 96";

/**
 * The compact crop, as a viewBox over the SAME geometry: the bounding box of the shield,
 * the orbit and the two nodes, plus a little air. Aspect is ~0.71, so a caller asking for
 * a compact mark of height H gets a box H * MARK_COMPACT_RATIO wide.
 */
export const MARK_COMPACT_VIEWBOX = "12.2 8.4 52.7 74";
export const MARK_COMPACT_RATIO = 52.7 / 74;

/**
 * The globe, as two paths rather than 307 <circle> elements.
 *
 * Each dot is a ZERO-LENGTH SUBPATH — `M x y h0` — stroked with `stroke-linecap="round"`.
 * SVG 1.1 s11.4 makes this exact case normative: a zero-length subpath with a round cap
 * renders as a filled circle of the stroke width. It costs about a third of the bytes of
 * the equivalent circles and two DOM nodes instead of three hundred, which is why the
 * static copy in index.html is readable at all.
 *
 * Dots are ordered top row down, left to right within a row, so a diff of these strings
 * lands where the change is.
 */
export const MARK_DOTS_BLUE =
  "M45.97 1.76h0M42.66 1.8h0M50.44 1.8h0M53.78 1.81h0M57.08 1.87h0M45.97 4.77h0M42.65 4.78h0" +
  "M39.26 4.79h0M35.94 4.84h0M60.49 4.86h0M32.57 4.92h0M29.29 5.0h0M63.8 5.01h0M67.12 5.12h0" +
  "M39.24 7.92h0M42.62 7.92h0M35.84 7.97h0M57.23 7.98h0M32.45 8.01h0M29.06 8.09h0M25.74 8.17h0" +
  "M70.58 8.25h0M22.48 8.28h0M73.84 8.35h0M42.38 10.76h0M39.18 11.07h0M57.34 11.12h0M35.8 11.13h0" +
  "M60.73 11.15h0M32.38 11.17h0M29.0 11.24h0M25.58 11.31h0M22.25 11.38h0M18.92 11.46h0" +
  "M39.14 14.26h0M35.78 14.31h0M32.29 14.37h0M60.83 14.38h0M25.43 14.53h0M22.15 14.6h0" +
  "M18.78 14.65h0M15.46 14.73h0M38.88 16.84h0M35.68 17.49h0M57.45 17.6h0M32.23 17.61h0" +
  "M60.91 17.64h0M64.28 17.69h0M25.4 17.79h0M21.97 17.82h0M15.32 17.94h0M11.98 18.03h0" +
  "M31.73 20.21h0M57.52 20.91h0M60.96 20.93h0M64.36 20.96h0M11.82 21.29h0M8.52 21.37h0" +
  "M50.64 24.17h0M54.09 24.21h0M57.55 24.24h0M61.0 24.29h0M64.42 24.3h0M25.22 24.33h0" +
  "M21.8 24.38h0M18.39 24.43h0M15.06 24.48h0M11.72 24.56h0M8.42 24.61h0M50.67 27.56h0" +
  "M54.13 27.59h0M57.62 27.61h0M61.02 27.63h0M64.5 27.65h0M28.6 27.7h0M21.76 27.74h0" +
  "M18.33 27.76h0M14.99 27.8h0M90.97 28.11h0M57.63 30.99h0M61.03 30.99h0M64.55 31.01h0" +
  "M78.1 31.17h0M81.44 31.24h0M84.67 31.29h0M87.92 31.32h0M91.11 31.37h0M57.83 34.0h0" +
  "M68.05 34.4h0M71.43 34.43h0M74.81 34.51h0M78.18 34.51h0M81.54 34.54h0M84.78 34.58h0" +
  "M88.03 34.62h0M91.17 34.65h0M94.33 34.69h0M68.08 37.78h0M71.49 37.79h0M74.87 37.82h0" +
  "M14.83 37.83h0M78.22 37.84h0M81.59 37.9h0M94.42 38.02h0M14.42 40.62h0M68.1 41.17h0" +
  "M71.53 41.17h0M74.91 41.2h0M78.28 41.21h0M4.77 41.27h0M1.48 41.29h0M68.1 44.55h0M71.54 44.58h0" +
  "M74.93 44.58h0M78.32 44.58h0M1.45 44.6h0M4.73 44.61h0M8.01 44.61h0M94.52 44.62h0M68.13 47.91h0" +
  "M11.36 47.92h0M71.56 47.93h0M94.55 47.93h0M74.95 47.94h0M8.03 47.95h0M78.33 47.95h0" +
  "M14.5 48.31h0M18.19 51.28h0M74.95 51.29h0M68.13 51.3h0M21.58 51.32h0M25.02 51.32h0" +
  "M65.08 51.43h0M1.48 54.54h0M94.4 54.57h0M11.47 54.65h0M21.62 54.68h0M28.5 54.69h0M25.02 54.7h0" +
  "M1.54 57.81h0M94.33 57.85h0M11.5 57.95h0M21.62 57.99h0M31.97 58.06h0M61.4 58.19h0M17.5 58.27h0" +
  "M1.66 61.08h0M94.2 61.08h0M4.92 61.15h0M22.09 61.21h0M11.53 61.24h0M71.54 61.39h0" +
  "M61.26 61.47h0M58.02 61.68h0M5.02 64.4h0M15.03 64.63h0M74.86 64.72h0M68.1 64.76h0M61.26 64.8h0" +
  "M32.0 64.81h0M57.8 64.83h0M5.12 67.61h0M25.83 67.61h0M90.82 67.61h0M8.35 67.7h0M87.63 67.72h0" +
  "M15.08 67.89h0M18.46 67.98h0M74.81 68.02h0M28.64 68.07h0M68.1 68.07h0M57.82 68.15h0" +
  "M87.5 70.89h0M8.43 70.93h0M84.27 70.97h0M15.2 71.18h0M57.81 71.52h0M25.04 71.6h0M87.34 74.1h0" +
  "M8.62 74.15h0M84.19 74.17h0M80.95 74.29h0M64.61 74.68h0M84.03 77.36h0M80.82 77.49h0" +
  "M77.56 77.54h0M80.68 80.65h0M77.4 80.77h0M15.58 80.78h0M74.17 80.86h0M22.19 81.05h0" +
  "M77.28 83.91h0M74.06 84.02h0M25.68 84.24h0M22.5 87.08h0M29.0 90.33h0M61.32 91.04h0" +
  "M58.06 91.12h0M54.8 91.2h0M35.16 91.78h0M51.54 91.82h0M38.5 91.86h0M41.74 91.86h0" +
  "M45.03 91.88h0M48.29 91.88h0M54.81 93.93h0M38.55 94.15h0M44.99 94.24h0M51.47 94.25h0" +
  "M48.28 94.26h0";

export const MARK_DOTS_RED =
  "M77.36 11.56h0M74.36 14.67h0M77.58 14.73h0M80.84 14.82h0M67.7 17.72h0M71.09 17.78h0" +
  "M74.45 17.85h0M77.74 17.94h0M81.02 18.03h0M84.25 18.1h0M67.77 21.01h0M71.21 21.1h0" +
  "M74.55 21.15h0M77.84 21.22h0M81.14 21.28h0M84.37 21.37h0M87.57 21.46h0M67.86 24.36h0" +
  "M71.29 24.39h0M74.65 24.44h0M77.95 24.49h0M81.25 24.56h0M84.47 24.64h0M87.69 24.74h0" +
  "M67.91 27.7h0M71.35 27.72h0M74.74 27.78h0M78.07 27.81h0M11.62 27.89h0M81.38 27.9h0" +
  "M8.33 27.95h0M84.63 27.97h0M5.09 28.01h0M87.84 28.02h0M71.41 31.07h0M18.29 31.11h0" +
  "M14.93 31.16h0M11.57 31.2h0M8.26 31.24h0M4.99 31.28h0M14.86 34.48h0M11.51 34.53h0M8.18 34.55h0" +
  "M4.91 34.59h0M1.63 34.6h0M11.46 37.88h0M8.1 37.92h0M84.86 37.92h0M4.83 37.93h0M1.55 37.96h0" +
  "M88.11 37.96h0M91.3 38.02h0M84.94 41.28h0M88.16 41.29h0M91.36 41.31h0M94.49 41.33h0" +
  "M88.2 44.59h0M91.37 44.62h0M91.42 47.94h0M71.59 51.32h0M14.82 51.34h0M14.84 54.64h0" +
  "M71.57 54.66h0M68.16 54.67h0M64.73 54.68h0M14.85 57.97h0M71.57 58.01h0M68.15 58.03h0" +
  "M64.75 58.04h0M25.06 58.05h0M28.5 58.05h0M14.89 61.31h0M25.09 61.42h0M68.15 61.43h0" +
  "M28.56 61.44h0M32.0 61.44h0M64.72 61.44h0M18.11 61.45h0M18.33 64.67h0M25.13 64.74h0" +
  "M28.61 64.78h0M64.72 64.8h0M21.75 68.08h0M64.68 68.11h0M61.24 68.13h0M18.56 71.23h0" +
  "M21.91 71.29h0M64.64 71.39h0M61.24 71.46h0M18.64 74.47h0M21.99 74.54h0M25.38 74.61h0" +
  "M61.22 74.74h0M18.79 77.7h0M22.12 77.8h0M18.93 80.89h0M19.07 84.02h0";

/** Stroke width of a globe dot, i.e. its diameter. */
export const MARK_DOT_WIDTH = 2.2;

/**
 * The orbit: two arc segments of one circle (c 49.74 48.55, r 32.1), broken twice. The
 * breaks are in the source and are load-bearing — the smaller node sits inside one of
 * them, which is what makes it read as a node ON the ring rather than a blob beside it.
 */
export const MARK_ORBIT =
  "M47.64 80.58A32.1 32.1 0 0 1 17.83 52.04M19.82 36.92A32.1 32.1 0 0 1 54.21 16.76";
export const MARK_ORBIT_WIDTH = 2.41;

/** The two nodes on the orbit, [cx, cy, r]. Both centres sit on the circle above. */
export const MARK_NODES = [[17.22, 44.33, 4.41], [45.96, 16.55, 7.56]];

/**
 * The shield. Traced from the raster and fitted as three cubics down the right edge, then
 * mirrored about x = 48.56 — the source is a hair asymmetric and the symmetric fit is the
 * one a reader expects. Sub-pixel against the original at the size it was drawn.
 */
export const MARK_SHIELD =
  "M48.56 29.88C52.79 34.78 58.69 37.87 64.33 37.81C64.44 45.48 63.64 48.51 62.11 51.96" +
  "C61.32 54.62 56.36 61.55 48.56 64.18C40.76 61.55 35.8 54.62 35.01 51.96" +
  "C33.48 48.51 32.68 45.48 32.79 37.81C38.43 37.87 44.33 34.78 48.56 29.88Z";

/** The check, knocked out of the shield as a round-capped, round-joined stroke. */
export const MARK_CHECK = "M42.3 48.81 46.19 52.7 54.89 43.99";
export const MARK_CHECK_WIDTH = 3.04;

/**
 * The mark as an <svg>.
 *
 * `size` is the HEIGHT in px, always: the full mark is square, so it is the width too, but
 * the compact crop is taller than it is wide and pinning height is what keeps the two
 * interchangeable beside a line of text.
 *
 * Decorative by default — this thing sits next to the words "Wiz Sidekick DevSecOps" almost
 * everywhere it appears, and announcing the picture as well as the name would say it
 * twice. Pass `label` at the ONE place the wordmark is hidden (the collapsed rail), where
 * the mark is the only identity on screen.
 */
export function brandMark(size = 96, opts = {}) {
  const compact = !!opts.compact;
  const height = Number(size) || 96;
  const width = compact ? Math.round(height * MARK_COMPACT_RATIO * 100) / 100 : height;
  const svg = svgEl("svg", {
    class: "brand-mark" + (compact ? " brand-mark--compact" : ""),
    viewBox: compact ? MARK_COMPACT_VIEWBOX : MARK_VIEWBOX,
    width, height, focusable: "false",
    role: opts.label ? "img" : null,
    "aria-label": opts.label || null,
    "aria-hidden": opts.label ? null : "true",
  });
  if (!compact) {
    svg.append(
      dots(MARK_DOTS_BLUE, "mark-map", "#5cb2e3"),
      dots(MARK_DOTS_RED, "mark-map mark-map--warm", "#f32b2b"),
    );
  }
  svg.append(svgEl("path", {
    class: "mark-ink", d: MARK_ORBIT, fill: "none", stroke: "#0a0a0a",
    "stroke-width": MARK_ORBIT_WIDTH, "stroke-linecap": "round",
  }));
  for (const [cx, cy, r] of MARK_NODES) {
    svg.append(svgEl("circle", { class: "mark-ink-fill", cx, cy, r, fill: "#0a0a0a" }));
  }
  svg.append(svgEl("path", { class: "mark-ink-fill", d: MARK_SHIELD, fill: "#0a0a0a" }));
  svg.append(svgEl("path", {
    class: "mark-knockout", d: MARK_CHECK, fill: "none", stroke: "#ffffff",
    "stroke-width": MARK_CHECK_WIDTH, "stroke-linecap": "round", "stroke-linejoin": "round",
  }));
  return svg;
}

function dots(d, cls, stroke) {
  return svgEl("path", {
    class: cls, d, fill: "none", stroke,
    "stroke-width": MARK_DOT_WIDTH, "stroke-linecap": "round",
  });
}
