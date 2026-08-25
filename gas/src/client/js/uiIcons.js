// The chrome glyph set: small stroke marks for controls, on a 16-grid.
//
// Separate from routeIcons.js, which draws nav destinations on a 24-grid at 18px. These are
// smaller and sit inside controls — a combobox row, the panel's pin — so they are built as
// real SVG elements rather than inlined markup strings: a row's glyph is one node beside a
// text label, and `el()` composes nodes.
//
// DECORATIVE BY CONTRACT. Every one of these is `aria-hidden`, and the caller supplies the
// accessible name (a button's aria-label, a row's own text). A glyph that had to be understood
// would be the shorthand the labels exist to avoid.

// ASSEMBLED AT RUNTIME, NEVER WRITTEN OUT. A literal here would put a bare `//` inside a
// string in the bundle, and esbuild.config.mjs's middlebox guard fails the build on exactly
// that: an SSL-inspecting proxy has been observed stripping "comments" from the served bundle
// with a tokenizer that truncates the line at the first `//` it finds, whether or not it is
// inside a string. One join, once at module load, and the hazard cannot exist.
export const SVG_NS = ["http:", "", "www.w3.org", "2000", "svg"].join("/");

/**
 * Namespaced SVG element with attributes. Exported for brandMark.js, which builds the same
 * kind of node from its own geometry.
 *
 * Nullish and `false` are SKIPPED, on the same contract as `el()` in ui.js: an omitted
 * attribute is how a caller says "not this one", and `String(null)` would write the literal
 * text "null" into `role` and `aria-label` — which an assistive technology then reads out.
 */
export function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

const PATHS = {
  // The scope switcher's marks. A funnel for a manual group, because that is what one is here —
  // a rule that admits some findings and not others — and it is the mark the rail's own Value
  // Chain filter drew before the switcher took the job and the name changed, so a reader who
  // knew the old control recognises the new one.
  funnel: ["M2.2 3.2 H13.8 L9.6 8.1 V13.2 L6.4 11.5 V8.1 Z"],
  // Two figures for a support group: the dimension is a team, not a filter, and the difference
  // matters on a list where the two kinds sit under separate headings.
  users: [
    "M10.6 13.6 v-1.1 a3 3 0 0 0 -3 -3 H4.9 a3 3 0 0 0 -3 3 v1.1",
    "M6.25 3.4 a2.6 2.6 0 1 0 0 5.2 a2.6 2.6 0 0 0 0 -5.2",
    "M14.1 13.6 v-1.1 a3 3 0 0 0 -2.25 -2.9",
    "M10.6 3.6 a2.6 2.6 0 0 1 0 4.8",
  ],
  // A label with a punched hole, for a VC Domain. NOT a folder and not a funnel, because
  // it is neither: `Wiz/Domain` is a tag a person wrote on a resource, not a container Wiz
  // nests things in and not a rule this app evaluates. The hole is what separates it from a
  // plain rotated square at 14px.
  tag: [
    "M8.3 2.2 H12.9 a0.9 0.9 0 0 1 0.9 0.9 V7.7 L7.7 13.8 a0.9 0.9 0 0 1 -1.3 0 L2.2 9.6 "
      + "a0.9 0.9 0 0 1 0 -1.3 z",
    "M10.9 5.1 h0.01",
  ],
  // One folder with another behind it: the switcher's reset row, which is the whole register
  // rather than any one slice of it. Read as one-versus-many beside the two marks above; the
  // row's words carry the meaning either way, which is why a 14px difference may be this quiet.
  folders: [
    "M4.5 3.5 V2.8 a0.8 0.8 0 0 1 0.8 -0.8 h2.4 l1.1 1.4 H13.5",
    "M1.5 13 V5.4 a0.9 0.9 0 0 1 0.9 -0.9 h3 l1.3 1.6 h5.4 a0.9 0.9 0 0 1 0.9 0.9 V13 "
      + "a0.9 0.9 0 0 1 -0.9 0.9 H2.4 A0.9 0.9 0 0 1 1.5 13 z",
  ],
  // Marks the chosen row in a list that offers a check rather than colour and weight alone —
  // the scope in force is a standing fact about the app, not a highlight in an open menu.
  check: ["M3 8.4 L6.4 11.8 L13 5.2"],
  // The nav panel's pin control: an arrow docking against a wall, and the same arrow leaving
  // it. Direction carries the whole meaning here, so the two are mirror images rather than one
  // glyph rotated by a class — a rotation is a transform a reduced-motion reader may never see
  // change, and a control whose state you cannot read is worse than two glyphs.
  dock: ["M2.5 8 H9.8", "M7 5.2 L9.8 8 L7 10.8", "M13 3 V13"],
  undock: ["M13.5 8 H6.2", "M9 5.2 L6.2 8 L9 10.8", "M3 3 V13"],
};

// An unknown name reads as "more" rather than throwing — a typo must not blank a page — which
// is precisely why a typo is otherwise invisible. `UI_ICON_NAMES` is what the tests hold every
// `uiIcon("…")` call against, so a name nothing draws fails instead of rendering an empty box.
const FALLBACK = ["M8 8 h0.01"];

/** Every glyph this set draws. */
export const UI_ICON_NAMES = Object.keys(PATHS);

/** A standalone 16x16 stroke <svg> for UI chrome. Decorative — the caller names the control. */
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
