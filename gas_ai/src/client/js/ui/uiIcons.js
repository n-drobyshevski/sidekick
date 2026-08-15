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
