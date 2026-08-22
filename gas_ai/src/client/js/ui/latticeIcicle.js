// A lattice drawn as a tree: one nested band per axis, partitioned left to right, ending in
// one leaf sliver per cell — four bands and 54 leaves for the Problem tree, three and 27 for
// Posture. The second painter over `lattice.js`'s geometry, behind the Matrix/Tree switch,
// and it exposes the SAME handle shape the grid painter does — `node`, `paint`, `light`,
// `pulse`, `focusCell`, `descriptorFor` — so swapping views is a swap and never a fork in the
// section that owns them.
//
// IT DRAWS `nestingAxes(spec)`, NOT `spec.axes`. The tree's whole claim is that the nesting
// is the picture, so the nesting it draws has to be the one the matrix behind the same toggle
// reads: rows outermost, then columns. Those coincide for the Problem tree and do not for
// Posture, whose enumeration nests containment inside consequence while its grid reads them
// the other way round. See `nestingAxes` for why display order and enumeration order are two
// different questions.
//
// WHY THIS ONE IS SVG WHEN THE GRID IS NOT. ui/lattice.js argues at length that a lattice is
// a regular grid of interactive targets and therefore wants DOM. An icicle is the opposite
// case and gets the opposite answer: its rectangles are FREE geometry, each one's height a
// fraction of its parent's, none of them aligned to a track. Expressing that in CSS grid
// would mean either a track per leaf (54 rows, and the aggregate bands spanning them by
// hand) or absolute positioning, which is SVG with extra steps. So this follows the house
// SVG recipe instead — `svgEl`, drawn 1:1 at the container's measured pixel width so labels
// never scale, rebuilt on a real resize — the same one `egoGraph` and `scans`'s provenance
// diagram already use.
//
// WHAT THE TREE SHOWS THAT THE MATRIX CANNOT. The matrix flattens the axis nesting into a
// grouping convention: exploitation is "the outer row axis" and you have to know that to
// read it. Here the nesting IS the picture — a whole ACTIVE branch resolving to Act and
// Attend is one contiguous block, and you can see the cascade's first three rows carve it
// up. That is the best available explanation of why cascade ORDER is meaning, which is why
// it earns a view even though it costs height a grid does not: ~650px for the Problem tree's
// 54 leaves and ~350px for Posture's 27, a leaf sliver being a fixed 12px and the leaf count
// the thing that varies.
//
// KEYBOARD. One tab stop, ArrowUp/ArrowDown walking the leaf column, Home/End to its ends —
// the same roving-tabindex contract the grid keeps, minus the second dimension the tree does
// not have. The aggregate bands are NOT focusable: they carry no verdict of their own, and a
// tab stop that announces "Active" and nothing else is a stop that costs a keypress and pays
// nothing.

import { el } from "./dom.js";
import { svgEl } from "../icons.js";
import { onPageTeardown } from "./timing.js";
import { icicleLayout, nestingAxes, vectorSentence } from "../lattice.js";

import { tipAnchor } from "./tip.js";
/** Column widths are equal by construction (`icicleLayout`), so only the height is tuned here. */
const LEAF_H = 12;
const HEAD_H = 22;
const MIN_W = 560;

export function latticeIcicle({ spec, ariaLabel, hooks }) {
  const byKey = new Map();
  const sentences = new Map();
  const node = el("div", {
    class: "lat-scroll",
    // The scroll wrapper takes a tab stop ONLY when its contents are not focusable. Here
    // they are, so it does not — egoGraph.js states the rule: otherwise it is a second,
    // pointless landing before them.
  });

  let svg = null;
  let painted = new Map();
  let lastWidth = 0;
  let lit = null;
  let pulsed = null;

  function build(width) {
    byKey.clear();
    const leafCount = icicleLayout(spec, 1, 1).bands.filter((b) => b.kind === "outcome").length;
    const height = leafCount * LEAF_H;
    const layout = icicleLayout(spec, width, height);

    svg = svgEl("svg", {
      class: "lat-icicle",
      width: String(width),
      height: String(height + HEAD_H + 6),
      viewBox: `0 0 ${width} ${height + HEAD_H + 6}`,
      role: "group",
      "aria-label": ariaLabel,
    });

    // Column heads — one per axis, plus the verdict column the layout appends. `nestingAxes`,
    // not `spec.axes`: the layout descends in that order, so heads read from it too or a
    // column is labelled with the axis next to it.
    const axes = nestingAxes(spec);
    const colW = width / (axes.length + 1);
    axes.forEach((axis, i) => {
      const t = svgEl("text", { x: String(i * colW), y: "12", class: "lat-colhead" });
      t.textContent = axis.label;
      svg.append(t);
    });
    const vt = svgEl("text", { x: String(axes.length * colW), y: "12", class: "lat-colhead" });
    vt.textContent = "Verdict";
    svg.append(vt);

    const ordered = [];
    for (const band of layout.bands) {
      const isLeaf = band.kind === "outcome";
      // The GROUP must not carry `lat-band` — that class paints a stroke, and stroke
      // inherits onto the <text> inside it, outlining every glyph at 10px into a smear.
      // Only the <rect> wears it.
      const g = svgEl("g", { class: isLeaf ? "lat-leaf" : "lat-bandgroup" });
      const rect = svgEl("rect", {
        x: String(band.x), y: String(band.y + HEAD_H),
        width: String(band.w - 1), height: String(Math.max(1, band.h - 1)),
        rx: "3",
        class: isLeaf ? "lat-band lat-band--leaf" : "lat-band",
      });
      g.append(rect);

      // A label only where a label fits. Below ~11px the text would collide with its
      // neighbours, and a clipped word is worse than none — the <title> still carries it.
      if (band.h >= 11) {
        const t = svgEl("text", {
          x: String(band.x + 7),
          y: String(band.y + HEAD_H + band.h / 2 + 3.5),
          class: isLeaf ? "lat-leaf__label" : "lat-band__label",
        });
        t.textContent = isLeaf ? "" : labelFor(band);
        g.append(t);
        if (isLeaf) g.dataset.label = "1";
      }

      if (isLeaf) {
        g.dataset.key = band.key;
        rect.dataset.key = band.key;
        g.setAttribute("tabindex", "-1");
        g.setAttribute("role", "button");
        if (!sentences.has(band.key)) sentences.set(band.key, vectorSentence(spec, band.vector));
        // The vector sentence, off the SVG <title> that took a second to arrive and could not
        // be styled, keyboarded or tapped, and onto the app's own card.
        tipAnchor(g, [sentences.get(band.key)]);
        byKey.set(band.key, g);
        ordered.push(g);

        const enter = () => hooks.onCellEnter({ key: band.key, vector: band.vector }, g);
        g.addEventListener("mouseenter", enter);
        g.addEventListener("focus", enter);
        g.addEventListener("mouseleave", hooks.onCellLeave);
        g.addEventListener("blur", hooks.onCellLeave);
        g.addEventListener("click", () => hooks.onActivate({ key: band.key, vector: band.vector }, g));
        g.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter" && ev.key !== " ") return;
          ev.preventDefault();
          hooks.onActivate({ key: band.key, vector: band.vector }, g);
        });
      } else {
        tipAnchor(g, [labelFor(band)]);
      }
      svg.append(g);
    }

    wireRoving(ordered);
    node.replaceChildren(svg);
    if (painted.size) paint([...painted.values()]);
    applyLit();
  }

  function labelFor(band) {
    const axis = spec.axes.find((a) => a.key === band.axisKey);
    if (!axis) return String(band.value ?? "");
    const word = String(band.value ?? "");
    return word.charAt(0) + word.slice(1).toLowerCase();
  }

  /** One tab stop; the tree has one dimension, so only the vertical keys are bound. */
  function wireRoving(cells) {
    cells.forEach((g, i) => {
      g.setAttribute("tabindex", i === 0 ? "0" : "-1");
      g.addEventListener("keydown", (ev) => {
        let next = null;
        if (ev.key === "ArrowDown") next = i + 1;
        else if (ev.key === "ArrowUp") next = i - 1;
        else if (ev.key === "Home") next = 0;
        else if (ev.key === "End") next = cells.length - 1;
        else return;
        ev.preventDefault();
        if (next < 0 || next >= cells.length) return;
        g.setAttribute("tabindex", "-1");
        cells[next].setAttribute("tabindex", "0");
        cells[next].focus();
      });
    });
  }

  function paint(descriptors) {
    painted = new Map(descriptors.map((d) => [d.key, d]));
    for (const d of descriptors) {
      const g = byKey.get(d.key);
      if (!g) continue;
      const rect = g.querySelector("rect");
      rect.dataset.tone = d.tone;
      if (d.hatched) rect.dataset.bucket = "0";
      else if (d.count === null) delete rect.dataset.bucket;
      else rect.dataset.bucket = d.count < 10 ? "1" : d.count < 45 ? "2" : "3";
      rect.classList.toggle("is-receded", !!d.receded);
      const label = g.querySelector("text");
      if (label) label.textContent = d.count === null ? d.word : `${d.word} · ${d.count}`;
      const title = g.querySelector("title");
      if (title) title.textContent = `${sentences.get(d.key)} — ${d.aria}`;
      g.setAttribute("aria-label", `${sentences.get(d.key)} — ${d.aria}`);
      g.dataset.rule = String(d.ruleIndex);
    }
  }

  function applyLit() {
    byKey.forEach((g) => {
      const rect = g.querySelector("rect");
      rect.classList.toggle("is-lit", lit !== null && lit !== undefined && Number(g.dataset.rule) === lit);
      rect.classList.toggle("is-traced", pulsed === g.dataset.key);
    });
  }

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver((entries) => {
      const box = entries[0] && entries[0].contentRect;
      // A hidden pane reports width 0, and sub-pixel churn is not a resize worth a rebuild.
      if (!box || !box.width) return;
      const width = Math.max(MIN_W, Math.round(box.width));
      if (Math.abs(width - lastWidth) < 8) return;
      lastWidth = width;
      build(width);
    });
    ro.observe(node);
    onPageTeardown(() => ro.disconnect());
  }
  build(MIN_W); // drawn once before insertion so the container is never an empty box

  return {
    node,
    get cells() {
      return icicleLayout(spec, 1, 1).bands
        .filter((b) => b.kind === "outcome")
        .map((b) => ({ key: b.key, vector: b.vector }));
    },
    paint,
    recede(keys) {
      const set = new Set(keys);
      byKey.forEach((g, key) => g.querySelector("rect").classList.toggle("is-receded", set.has(key)));
    },
    light(i) { lit = i; applyLit(); },
    pulse(key) { pulsed = key; applyLit(); },
    focusCell(key) {
      const g = byKey.get(key);
      if (!g) return;
      byKey.forEach((x) => x.setAttribute("tabindex", "-1"));
      g.setAttribute("tabindex", "0");
      g.focus();
    },
    setMode() {},
    setUpdating() {},
    setDiverged(on) {
      if (svg) svg.classList.toggle("is-diverged", !!on);
    },
    descriptorFor(key) { return painted.get(key) || null; },
  };
}
