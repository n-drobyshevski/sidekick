// Generic UI-chrome icon set: close / chevron / grip / etc. glyphs for controls that
// aren't a graph node kind. The client had no such API — app.js built its nav glyphs
// as one-off inline SVG strings (see the comment at app.js:33) and sheet.js grew its own
// I_SHEET_CLOSE / I_SHEET_WIDEN strings rather than duplicate a pattern that didn't exist
// yet. This is that pattern: same 16x16 stroke-path construction as icons.js, built with
// its svgEl() rather than innerHTML, just for chrome instead of node kinds. Unlike
// icons.js's kindIcon (which leans on the .gnode-icon CSS class for stroke styling), these
// carry fill/stroke as attributes on the root <svg> so a caller gets a usable icon with no
// stylesheet dependency — paths below inherit it and only ever specify "d".

import { svgEl } from "../icons.js";

const PATHS = {
  close: ["M4 4 L12 12 M12 4 L4 12"],
  "chevron-up": ["M3 6.5 L8 2.5 L13 6.5"],
  "chevron-down": ["M3 9.5 L8 13.5 L13 9.5"],
  "chevron-left": ["M6.5 3 L2.5 8 L6.5 13"],
  "chevron-right": ["M9.5 3 L13.5 8 L9.5 13"],
  // Both halves at once: the widen toggle points outward in both directions because it
  // means "more width", not "go left".
  widen: ["M6.5 3 L2.5 8 L6.5 13", "M9.5 3 L13.5 8 L9.5 13"],
  grip: ["M6 5 V11", "M10 5 V11"],
  braces: [
    "M8 2.5 C6.5 2.5 6 3.2 6 4.5 V6.3 C6 7.3 5.3 7.8 4.3 8 C5.3 8.2 6 8.7 6 9.7 V11.5 " +
      "C6 12.8 6.5 13.5 8 13.5",
    "M8 2.5 C9.5 2.5 10 3.2 10 4.5 V6.3 C10 7.3 10.7 7.8 11.7 8 C10.7 8.2 10 8.7 10 9.7 " +
      "V11.5 C10 12.8 9.5 13.5 8 13.5",
  ],
  link: [
    "M6.5 8.5 a3.5 3.5 0 0 0 5 0.5 l2 -2 a3.5 3.5 0 0 0 -4.5 -4.5 l-1 1",
    "M9.5 7.5 a3.5 3.5 0 0 0 -5 -0.5 l-2 2 a3.5 3.5 0 0 0 4.5 4.5 l1 -1",
  ],
  external: [
    "M9 3 H4 a1 1 0 0 0 -1 1 v7 a1 1 0 0 0 1 1 h7 a1 1 0 0 0 1 -1 V8",
    "M8 8 L13.5 2.5",
    "M9.5 2.5 H13.5 V6.5",
  ],
  info: ["M8 1.5 a6.5 6.5 0 1 0 0 13 a6.5 6.5 0 0 0 0 -13", "M8 5.3 h0.01", "M8 7.3 V11"],
  graph: [
    "M4 10.7 a1.3 1.3 0 1 0 0 2.6 a1.3 1.3 0 0 0 0 -2.6",
    "M8 3.7 a1.3 1.3 0 1 0 0 2.6 a1.3 1.3 0 0 0 0 -2.6",
    "M12 9.7 a1.3 1.3 0 1 0 0 2.6 a1.3 1.3 0 0 0 0 -2.6",
    "M4.6 10.9 L7.4 6.1",
    "M8.7 6.1 L11.3 9.9",
  ],
  // The Security Graph's query builder. `plus` adds a relationship or a filter; the two eyes
  // are the show/hide toggle on a node's column group; `table` and `columns` dress the VIEW
  // control and the column chooser beside it.
  plus: ["M8 3.5 V12.5", "M3.5 8 H12.5"],
  minus: ["M3.5 8 H12.5"],
  // Grouping: a box holding a smaller box, which is what grouped mode draws and what a second
  // level adds. Not `fit` (four corners, and already in the same rail) and not `filter` (a
  // funnel — grouping does not narrow a set).
  group: ["M2.5 2.5 h11 v11 h-11 z", "M5.5 5.5 h5 v5 h-5 z"],
  // ---------------------------------------------------------------- layouts
  // The rail's Layouts button, and one glyph per entry in the list it opens. Each DRAWS ITS OWN
  // ARRANGEMENT in miniature — bands across, bands down, a burst, a ring — because the list is
  // five rows of near-identical prose ("Rows", "Columns", …) and the picture is what a reader
  // recognises before reading. Same reason the reference screen puts a glyph on every row.
  //
  // `layout` is the trigger: a two-level tree, the neutral "an arrangement exists" mark, distinct
  // from the specific four so the button never looks like it is already claiming one of them.
  layout: [
    "M8 2.5 V5.5", "M3.5 8 H12.5", "M3.5 8 V10.5", "M8 8 V10.5", "M12.5 8 V10.5",
    "M8 5.5 V8",
  ],
  rows: ["M2.5 4 H13.5", "M2.5 8 H13.5", "M2.5 12 H13.5"],
  lanes: ["M4 2.5 V13.5", "M8 2.5 V13.5", "M12 2.5 V13.5"],
  // Force-directed: a burst of spokes from a centre, the shape the layout actually settles into.
  organic: [
    "M8 6.4 a1.6 1.6 0 1 0 0 3.2 a1.6 1.6 0 0 0 0 -3.2",
    "M8 2.5 V6.4", "M8 9.6 V13.5", "M2.5 8 H6.4", "M9.6 8 H13.5",
    "M4.6 4.6 L6.9 6.9", "M11.4 11.4 L9.1 9.1", "M11.4 4.6 L9.1 6.9", "M4.6 11.4 L6.9 9.1",
  ],
  // Concentric: a hub and the ring of nodes one hop out. Four satellites rather than a plain
  // circle, so it reads as "nodes arranged around one" and not as a status dot.
  radial: [
    "M8 6.9 a1.1 1.1 0 1 0 0 2.2 a1.1 1.1 0 0 0 0 -2.2",
    "M8 1.9 a1.1 1.1 0 1 0 0 2.2 a1.1 1.1 0 0 0 0 -2.2",
    "M8 11.9 a1.1 1.1 0 1 0 0 2.2 a1.1 1.1 0 0 0 0 -2.2",
    "M2.9 6.9 a1.1 1.1 0 1 0 0 2.2 a1.1 1.1 0 0 0 0 -2.2",
    "M13.1 6.9 a1.1 1.1 0 1 0 0 2.2 a1.1 1.1 0 0 0 0 -2.2",
  ],
  // Fit the graph to the view: four corners closing on the content, the frame-it idiom. Not
  // `widen`, which is a one-dimensional "more width" gesture and belongs to the sheet.
  fit: ["M6 2.5 H2.5 V6", "M10 2.5 H13.5 V6", "M6 13.5 H2.5 V10", "M10 13.5 H13.5 V10"],
  eye: [
    "M1.8 8 C3.6 4.8 5.7 3.2 8 3.2 C10.3 3.2 12.4 4.8 14.2 8 " +
      "C12.4 11.2 10.3 12.8 8 12.8 C5.7 12.8 3.6 11.2 1.8 8 Z",
    "M8 6.2 a1.8 1.8 0 1 0 0 3.6 a1.8 1.8 0 0 0 0 -3.6",
  ],
  // Hidden is not the same glyph dimmed: colour and opacity are not signals on their own, so
  // the struck-through eye carries the state in its shape.
  "eye-off": [
    "M3.1 5.4 C2.6 6.1 2.1 7 1.8 8 C3.6 11.2 5.7 12.8 8 12.8 C9 12.8 9.9 12.6 10.8 12.1",
    "M13.2 10.4 C13.6 9.7 13.9 8.9 14.2 8 C12.4 4.8 10.3 3.2 8 3.2 C7.5 3.2 7 3.3 6.5 3.4",
    "M2.5 2.5 L13.5 13.5",
  ],
  table: ["M2.5 3.5 h11 v9 h-11 z", "M2.5 6.5 H13.5", "M6.5 6.5 V12.5"],
  columns: ["M2.5 3.5 h11 v9 h-11 z", "M6.5 3.5 V12.5", "M10.5 3.5 V12.5"],
  // The graph's "Edit query" toggle. A pencil rather than the funnel `filter` or the field-list
  // `property`: the control reveals the builder, and the builder writes the whole question —
  // structure, steps and filters — so a glyph naming only the filtering half would undersell it.
  pencil: ["M2.5 13.5 L3.4 10.4 L10.8 3 L13 5.2 L5.6 12.6 Z", "M9.4 4.4 L11.6 6.6"],
  // The `+` palette. `search` heads its field; `property` marks a filterable field in the list
  // and `check` a choice already made; `not` is the negation operator — a slashed circle, the
  // one shape that reads as "absent" rather than as "wrong".
  search: ["M7.2 2.7 a4.5 4.5 0 1 0 0 9 a4.5 4.5 0 0 0 0 -9", "M10.6 10.6 L13.5 13.5"],
  // A funnel — what a query shortcut and a property filter both do to a result set.
  filter: ["M2.5 3.5 H13.5 L9.5 8.2 V13 L6.5 11.4 V8.2 Z"],
  property: ["M2.5 4 H13.5", "M4.5 8 H11.5", "M6.5 12 H9.5"],
  check: ["M3 8.4 L6.4 11.8 L13 5.2"],
  not: ["M8 2.2 a5.8 5.8 0 1 0 0 11.6 a5.8 5.8 0 0 0 0 -11.6", "M4 12 L12 4"],
  // A boolean block: one path arriving, two leaving. A fork is the shape of a choice, which is
  // what both OR and AND insert — the keyword beside it says which.
  branch: ["M8 13.5 V8", "M8 8 L3.8 3.5", "M8 8 L12.2 3.5"],
  // The app header's project-scope trigger. A folder because that is what the register's
  // projects nest as — `scopeOptions` groups them under "Business units" and "Projects", and a
  // business unit reaches its whole subtree.
  folder: ["M2 12.5 V4 a1 1 0 0 1 1 -1 h3.2 l1.4 1.8 H13 a1 1 0 0 1 1 1 V12.5 a1 1 0 0 1 -1 1 H3 a1 1 0 0 1 -1 -1 z"],
  // The graph's title-row actions. `doc` heads "New search" — a fresh sheet of paper, the
  // thing the button hands you; `bookmark` heads the saved-queries menu, because what that
  // control keeps is a place to come back to rather than a file.
  doc: ["M4 2.5 h5 L12.5 6 v7.5 h-8.5 z", "M8.8 2.6 V6.2 H12.4"],
  bookmark: ["M4 2.5 h8 v11 L8 10.6 L4 13.5 z"],
  // The nav panel's pin control: an arrow docking against a wall, and the same arrow leaving
  // it. Direction carries the whole meaning here, so the two are mirror images rather than
  // one glyph rotated by a class — a rotation is a transform a reduced-motion reader may
  // never see change, and a control whose state you cannot read is worse than two glyphs.
  dock: ["M2.5 8 H9.8", "M7 5.2 L9.8 8 L7 10.8", "M13 3 V13"],
  undock: ["M13.5 8 H6.2", "M9 5.2 L6.2 8 L9 10.8", "M3 3 V13"],
};

// Same fallback posture as kindIcon(): an unknown name reads as "more" rather than throwing.
// Deliberate — a typo must not blank a page — and precisely why a typo is otherwise invisible.
// `UI_ICON_NAMES` is what test/icons.test.js holds every `uiIcon("…")` in the client against,
// so a name nothing draws fails the build instead of rendering an empty square.
const FALLBACK = ["M8 8 h0.01"];

/** Every glyph this set draws. */
export const UI_ICON_NAMES = Object.keys(PATHS);

/** A standalone 16x16 stroke <svg> for UI chrome (buttons, actions) — decorative only;
 * the caller supplies the accessible name (button aria-label/title), not this icon. */
export function uiIcon(name, size = 16) {
  const svg = svgEl("svg", {
    viewBox: "0 0 16 16",
    width: size,
    height: size,
    "aria-hidden": "true",
    focusable: "false",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  const paths = PATHS[name] || FALLBACK;
  for (const d of paths) svg.append(svgEl("path", { d }));
  return svg;
}
