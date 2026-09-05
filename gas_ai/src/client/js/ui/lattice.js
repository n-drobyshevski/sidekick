// The decision lattice, drawn: a CSS grid of <button> cells over `lattice.js`'s pure
// geometry. One painter serves both tabs — the Problem tree's 54 leaves as a 6x9 grid and
// Posture's 27 cells as a 3x9 one — because they are the same picture at two sizes, not two
// pictures. Same header grammar, same cell, same footprint: the two grids differ only in how
// many rows they have, and `spec.rowPx` is what makes the shorter one's cell band come to the
// same height as the taller one's (POSTURE_LATTICE carries that arithmetic).
//
// DOM, NOT SVG, and the reason is worth stating because the three other pictures in this
// app went the other way. `graphView`, `egoGraph` and `scans`'s provenance diagram are SVG
// because they draw EDGES between irregularly placed boxes: Béziers, arrowheads, labels
// evaluated along a curve. A lattice has none of that. It is a regular grid of interactive
// targets, and everything SVG would be good at here is already free in DOM — `base.css`
// rings `button` on :focus-visible, a <button> answers Enter and Space without help, text
// wraps and truncates by itself, and a popover anchors off getBoundingClientRect()
// identically either way. `.combo-matrix` (combos.css) made this same call for this same
// reason. The icicle view IS free geometry, and that one is SVG; see ui/latticeIcicle.js.
//
// WHY `display: contents` ON THE ROW WRAPPERS. `role="grid"` requires its cells to sit
// inside `role="row"` elements, and a real DOM row would break CSS grid placement — the
// cells would lay out inside the row rather than in the grid. `display: contents` makes the
// wrapper contribute nothing to layout while keeping it in the accessibility tree, so the
// grid sees the cells directly and a screen reader still sees rows. (The old bug where
// `display: contents` dropped semantics was fixed in every engine this app runs on years
// ago.) Every child is explicitly placed via grid-row/grid-column anyway, which is also how
// gutter tracks work: they are empty tracks nothing is placed into, so an axis boundary
// costs a track and no element.
//
// BUILT ONCE, THEREAFTER MUTATED — rule 2 of pages/aars.js, and it applies with full force
// here. 54 cells that get recreated on every keystroke would drop focus into <body> the
// moment anyone tabbed into the grid. `paint()` below writes `data-*`, textContent and
// aria-label in place and never touches structure.

import { el } from "../../../../../gas_shared/ui/dom.js";
import { LATTICE_GUTTER_PX, latticeCells, latticeHeaders, vectorSentence } from "../lattice.js";

import { tipAnchor } from "../../../../../gas_shared/ui/tip.js";
/**
 * One tab stop per grid, arrows moving in two dimensions — the APG grid pattern, and the
 * same roving-tabindex shape `graphView`'s canvas, the sheet's section rail and
 * `graphQueryBar`'s tree already use.
 *
 * This deliberately diverges from `.combo-matrix`, which uses `role="table"` and lets each
 * cell's button be its own tab stop. That is right at its size and wrong at 54: it would
 * put 54 stops between the lattice and the cascade table below it. Same semantics, plus a
 * navigation model.
 */
function wireRoving(cells, nCols) {
  if (!cells.length) return;
  cells.forEach((btn, i) => {
    btn.setAttribute("tabindex", i === 0 ? "0" : "-1");
    btn.addEventListener("keydown", (ev) => {
      let next = null;
      if (ev.key === "ArrowRight") next = i + 1;
      else if (ev.key === "ArrowLeft") next = i - 1;
      else if (ev.key === "ArrowDown") next = i + nCols;
      else if (ev.key === "ArrowUp") next = i - nCols;
      else if (ev.key === "Home") next = ev.ctrlKey ? 0 : i - (i % nCols);
      else if (ev.key === "End") next = ev.ctrlKey ? cells.length - 1 : i - (i % nCols) + nCols - 1;
      else return;
      ev.preventDefault();
      // Clamp rather than wrap: an arrow that silently jumped to the other edge would read
      // as a different cell than the one the geometry says is next.
      if (next < 0 || next >= cells.length) return;
      btn.setAttribute("tabindex", "-1");
      cells[next].setAttribute("tabindex", "0");
      cells[next].focus();
    });
  });
}

/**
 * Build one grid — the whole lattice for a spec with no `panel`, or one panel of it.
 * `cells` is the subset of `latticeCells(spec)` belonging to this panel, already in
 * row-major order.
 */
function buildGrid(spec, cells, ariaLabel, byKey, hooks) {
  const { rowBands, colBands, key: axisKey } = latticeHeaders(spec);
  const rowLevels = rowBands.length;
  const colLevels = colBands.length;

  // Distinct row/col combos in emission order — Set preserves insertion order, and
  // `latticeCells` emits row-major, so these come out in exactly grid order.
  const rowKeys = [...new Set(cells.map((c) => c.row))];
  const colKeys = [...new Set(cells.map((c) => c.col))];
  const nRows = rowKeys.length;
  const nCols = colKeys.length;

  // How many cells sit between two gutters. With a single-axis dimension there is no outer
  // band to separate, so the whole dimension is one group and no gutter track is emitted.
  const colGroup = colLevels > 1 ? colBands[0].cells[0].span : nCols;
  const rowGroup = rowLevels > 1 ? rowBands[0].cells[0].span : nRows;

  const colAt = (c) => rowLevels + 1 + Math.floor(c / colGroup) * (colGroup + 1) + (c % colGroup);
  const rowAt = (r) => colLevels + 1 + Math.floor(r / rowGroup) * (rowGroup + 1) + (r % rowGroup);

  // A gutter is a track nothing is placed into, so an axis boundary costs width (or height)
  // and no element. `rowPx` comes off the spec because the two lattices have different row
  // counts and are meant to end at the same line — see POSTURE_LATTICE for the arithmetic.
  const gutter = LATTICE_GUTTER_PX + "px";
  const rowPx = (spec.rowPx || 38) + "px";

  const colTracks = [];
  for (let i = 0; i < rowLevels; i++) colTracks.push("auto");
  for (let g = 0; g * colGroup < nCols; g++) {
    if (g > 0) colTracks.push(gutter);
    for (let i = 0; i < colGroup; i++) colTracks.push("minmax(42px, 1fr)");
  }
  const rowTracks = [];
  for (let i = 0; i < colLevels; i++) rowTracks.push("auto");
  for (let g = 0; g * rowGroup < nRows; g++) {
    if (g > 0) rowTracks.push(gutter);
    for (let i = 0; i < rowGroup; i++) rowTracks.push(rowPx);
  }

  const grid = el("div", {
    class: "lat",
    role: "grid",
    "aria-label": ariaLabel,
    "aria-rowcount": String(nRows),
    "aria-colcount": String(nCols),
  });
  grid.style.gridTemplateColumns = colTracks.join(" ");
  grid.style.gridTemplateRows = rowTracks.join(" ");

  // ---------------------------------------------------------------- column header rows
  colBands.forEach((level, li) => {
    const row = el("div", { class: "lat-rowwrap", role: "row" });
    if (li === 0) {
      // The corner is the one part of this grid that was reserved and never used, so the key
      // goes there: directly above the row labels it explains, which means the mapping is
      // read by the same downward movement as the values themselves. A key that sits where
      // you already are is not really a key. It spans every header row, the way a table's
      // top-left corner spans its header band.
      const corner = el("div", { class: "lat-key", role: "columnheader" });
      if (axisKey.rows.length) {
        corner.append(el("span", { class: "lat-key__line" },
          el("span", { class: "lat-key__dir", "aria-hidden": "true" }, "\u2193"),
          el("b", {}, axisKey.rows.join(" \u00d7 "))));
      }
      if (axisKey.cols.length) {
        corner.append(el("span", { class: "lat-key__line" },
          el("span", { class: "lat-key__dir", "aria-hidden": "true" }, "\u2192"),
          el("b", {}, axisKey.cols.join(" \u00d7 "))));
      }
      corner.style.gridRow = `1 / span ${colLevels}`;
      corner.style.gridColumn = `1 / span ${rowLevels}`;
      row.append(corner);
    }
    level.cells.forEach((band) => {
      const head = el("div", { class: li === 0 && colLevels > 1 ? "lat-hgroup" : "lat-hsub", role: "columnheader" });
      // A band wide enough to hold its own axis name carries it; the name is the quiet half
      // and the VALUE stays the loud word, because nine repetitions of "Exposure" must not
      // become the most prominent thing in the header.
      if (level.inlineName) head.append(el("span", { class: "lat-ax" }, level.shortLabel));
      head.append(band.label);
      // "Active", "Total", "Open", "Broad", "Weak", "Severe" — one word each, and the axis
      // they belong to is spelled out nowhere on the page. It is spelled out here.
      if (level.label) tipAnchor(head, [level.label + ": " + band.label]);
      head.style.gridRow = String(li + 1);
      head.style.gridColumn = `${colAt(band.start)} / span ${band.span}`;
      row.append(head);
    });
    grid.append(row);
  });

  // ------------------------------------------------------------------------- cell rows
  const ordered = [];
  rowKeys.forEach((rowKey, r) => {
    const row = el("div", { class: "lat-rowwrap", role: "row", "aria-rowindex": String(r + 1) });

    rowBands.forEach((level, li) => {
      // An outer row band is drawn once per group, spanning its rows; the inner level draws
      // one label per row. Placement is explicit, so a spanning header is a span, not a
      // repeated label the reader has to mentally dedupe.
      const band = level.cells.find((b) => b.start <= r && r < b.start + b.span);
      if (!band || band.start !== r) return;
      const head = el("div", { class: li === 0 && rowLevels > 1 ? "lat-rgroup" : "lat-rsub", role: "rowheader" }, band.label);
      if (level.label) tipAnchor(head, [level.label + ": " + band.label]);
      head.style.gridColumn = String(li + 1);
      head.style.gridRow = `${rowAt(band.start)} / span ${band.span}`;
      row.append(head);
    });

    colKeys.forEach((colKey, c) => {
      const cell = cells.find((x) => x.row === rowKey && x.col === colKey);
      const btn = el("button", {
        type: "button",
        class: "lat-cell",
        role: "gridcell",
        tabindex: "-1",
        "aria-colindex": String(c + 1),
        "data-key": cell.key,
      }, el("span", { class: "lat-cell__mark" }), el("span", { class: "lat-cell__count" }));
      btn.style.gridRow = String(rowAt(r));
      btn.style.gridColumn = String(colAt(c));
      byKey.set(cell.key, btn);
      ordered.push(btn);

      const enter = () => hooks.onCellEnter(cell, btn);
      btn.addEventListener("mouseenter", enter);
      btn.addEventListener("focus", enter);
      btn.addEventListener("mouseleave", hooks.onCellLeave);
      btn.addEventListener("blur", hooks.onCellLeave);
      btn.addEventListener("click", () => hooks.onActivate(cell, btn));

      row.append(btn);
    });

    grid.append(row);
  });

  wireRoving(ordered, nCols);
  return grid;
}

/**
 * The lattice as a mounted component.
 *
 * `hooks.onCellEnter(cell, btn)` / `onCellLeave()` fire on hover AND focus, never hover
 * alone — the rule `scans.js`'s provenance diagram already keeps, so a keyboard user gets
 * the same row-to-cell link a mouse user does. `onActivate(cell, btn)` fires on click or
 * Enter/Space.
 *
 * Returns a handle whose only structural operation is construction. Everything else writes
 * in place:
 *   paint(descriptors)  — `paintCells(...)` output; the one way pixels change
 *   light(ruleIndex)    — outline every cell that row claims as first match; null clears
 *   pulse(key)          — the tracer's "this vector lands here"; null clears
 *   focusCell(key)      — move the roving tab stop, for restoring focus after a rebuild
 *   setMode(mode)       — stamps `data-mode`, which is what lets only landscape mode dim
 *   setUpdating(on)     — a preview is in flight
 *   setDiverged(on)     — the mirror and the server disagree; the picture stops claiming
 */
export function latticeGrid({ spec, ariaLabel, hooks }) {
  const byKey = new Map();
  const all = latticeCells(spec);
  // Computed once — the sentence depends only on the vector, never on the rule or the mode.
  const sentences = new Map(all.map((c) => [c.key, vectorSentence(spec, c.vector)]));
  const node = el("div", { class: "lat-scroll" });

  // NOTHING MOUNTS THE PANELLED BRANCH TODAY. Posture was its only caller and moved its
  // consequence axis into the column nesting instead, for reasons POSTURE_LATTICE records.
  // It stays for the same reason `[data-tone="neutral"]` stays in lattice.css: the facility
  // works, `latticeCells` and `latticeHeaders` are tested against it, and a third lattice
  // that genuinely wants small multiples should not have to re-derive them. What it must NOT
  // grow is a second caller added without first checking the measurement that removed the
  // first one — a panel is a shrink-to-fit flex item and cannot fill the row it sits in.
  if (spec.panel) {
    const panelAxis = spec.axes.find((a) => a.key === spec.panel);
    const panels = el("div", { class: "lat-panels" });
    panelAxis.values.forEach((value) => {
      const subset = all.filter((c) => c.panel === value);
      const label = `${panelAxis.label} ${subset[0].vector[spec.panel]}`;
      panels.append(el(
        "div", { class: "lat-panel" },
        el("div", { class: "lat-panel-title" }, label),
        buildGrid(spec, subset, `${ariaLabel}, ${label}`, byKey, hooks),
      ));
    });
    node.append(panels);
  } else {
    node.append(buildGrid(spec, all, ariaLabel, byKey, hooks));
  }

  const grids = () => node.querySelectorAll(".lat");
  let painted = new Map();

  return {
    node,
    cells: all,

    paint(descriptors) {
      painted = new Map(descriptors.map((d) => [d.key, d]));
      for (const d of descriptors) {
        const btn = byKey.get(d.key);
        if (!btn) continue;
        btn.dataset.tone = d.tone;
        btn.querySelector(".lat-cell__mark").textContent = d.word;
        btn.querySelector(".lat-cell__count").textContent = d.count === null ? "" : String(d.count);
        // "not measured yet" and "zero" are different claims and must not share a mark.
        btn.classList.toggle("is-unmeasured", d.unmeasured);
        if (d.hatched) btn.dataset.bucket = "0";
        else if (d.count === null) delete btn.dataset.bucket;
        else btn.dataset.bucket = d.count < 10 ? "1" : d.count < 45 ? "2" : "3";
        // The vector in words leads, so the cell is readable without the picture; the
        // mode-specific half comes from `paintCells` so it can never describe a different
        // mode than the one that painted it.
        btn.setAttribute("aria-label", `${sentences.get(d.key)} — ${d.aria}`);
        // The same two halves, on the card. Hovering a heat cell used to light its neighbours
        // and say nothing; the words were a click away in the cell popover, and in the
        // accessible name a sighted reader never hears.
        tipAnchor(btn, [sentences.get(d.key), d.aria]);
        btn.dataset.rule = String(d.ruleIndex);
      }
    },

    /** Change mode recedes what the draft does not move, so the unchanged shape stays legible behind the diff. */
    recede(keys) {
      const set = new Set(keys);
      byKey.forEach((btn, key) => btn.classList.toggle("is-receded", set.has(key)));
    },

    light(ruleIndex) {
      byKey.forEach((btn) => {
        const lit = ruleIndex !== null && ruleIndex !== undefined && Number(btn.dataset.rule) === ruleIndex;
        btn.classList.toggle("is-lit", lit);
      });
    },

    pulse(key) {
      byKey.forEach((btn, k) => btn.classList.toggle("is-traced", k === key));
    },

    focusCell(key) {
      const btn = byKey.get(key);
      if (!btn) return;
      byKey.forEach((b) => b.setAttribute("tabindex", "-1"));
      btn.setAttribute("tabindex", "0");
      btn.focus();
    },

    setMode(mode) {
      grids().forEach((g) => { g.dataset.mode = mode; });
    },

    setUpdating(on) {
      grids().forEach((g) => g.classList.toggle("is-updating", !!on));
    },

    setDiverged(on) {
      grids().forEach((g) => g.classList.toggle("is-diverged", !!on));
    },

    descriptorFor(key) {
      return painted.get(key) || null;
    },
  };
}
