// THE DATA-TABLE ALTERNATIVE THAT SITS UNDER EVERY CANVAS.
//
// THE DEFECT. Eight canvases in this register carried `role="img"`, an `aria-label` and a
// prose caption, and nothing else. That is a sentence, not the figures: a screen-reader
// reader was told a curve exists and never told where it crosses half; a keyboard reader
// could not reach the values at all, because a canvas is not focusable and Chart.js's
// tooltips only answer a pointer; and a sighted reader who wanted the number behind a point
// had nowhere to read it. Deque's "How to make interactive charts accessible", the USWDS
// data-visualization guidance and GOV.UK's chart practice all land on the same remedy — ship
// the same series as a table — and this is that table.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE. The table is built from the SAME array the chart
// wrapper receives, named once at the call site and handed to both. Deriving it a second time
// from the payload is how a chart and its "equivalent" table start disagreeing: one gets a
// filter, a sort, a null-handling fix, and the other does not, and nothing on screen says so.
// Every call site here passes one `rows` reference into `chartTableModel` and the identical
// reference (or the arrays it was read from) into the chart wrapper, in the same statement.
//
// THE PURE / DOM SPLIT, and why the pure half is the bigger one. `chartTableModel` is
// DOM-free and does all of the formatting; `chartTable` only dresses its output. This
// project's vitest run has no `environment` set (no jsdom), so the half that can actually be
// WRONG — "does a null render as an em dash or as a confident 0" — is the half that can be
// held by a test. CLAUDE.md's `Number(null)` rule is the whole reason: every numeric cell
// goes through `ui/figures.js`, which refuses null BEFORE the cast, so an absent figure
// prints an em dash and a measured zero prints "0", and the two never trade places.

import { el, motionOk } from "./dom.js";
import { dataTable } from "./data.js";
import { days1, fmtCount, num, pct1 } from "./figures.js";

/**
 * The cell formatters, by name.
 *
 * `count` / `pct` / `days` are `ui/figures.js` unchanged — em dash on null, unit letter
 * where the figure carries one. `num1` is one decimal with NO unit, for a column whose unit
 * is already in its heading ("Weeks"); it refuses null through the same `num` allowlist
 * rather than reimplementing the refusal. `text` is the only non-numeric one, and it prints
 * the em dash for an absent label for the same reason the numeric three do.
 */
const FORMATTERS = {
  count: fmtCount,
  pct: pct1,
  days: days1,
  num1: (v) => {
    const n = num(v);
    return n === null ? "—" : n.toFixed(1);
  },
  text: (v) => (v === null || v === undefined || v === "" ? "—" : String(v)),
};

/**
 * A chart's series, as a table model. DOM-free on purpose — see the header.
 *
 *   columns  [{ key, label, format, align, value }]
 *              format  "count" (default) | "pct" | "days" | "num1" | "text"
 *              value   (row, index) => raw — defaults to `row[key]`
 *              align   "num" (default for every format but "text") | "text"
 *   rows     THE ARRAY THE CHART WRAPPER WAS GIVEN. One model row per entry, in order:
 *            no filtering, no sorting, no truncation, so the table and the canvas answer
 *            with the same population in the same sequence.
 *
 * Returns `{ columns: [{ key, label, align }], rows: [[cell, …]] }` — every cell a string.
 */
export function chartTableModel(spec) {
  const { columns = [], rows = [] } = spec || {};
  const readers = columns.map((col) => {
    const fmt = FORMATTERS[col.format || "count"] || FORMATTERS.count;
    const read = typeof col.value === "function"
      ? col.value
      : (row) => (row && typeof row === "object" ? row[col.key] : row);
    return (row, i) => fmt(read(row, i));
  });
  return {
    columns: columns.map((col) => ({
      key: col.key,
      label: col.label,
      align: col.align || (col.format === "text" ? "text" : "num"),
    })),
    rows: rows.map((row, i) => readers.map((f) => f(row, i))),
  };
}

/**
 * The Kaplan-Meier curve as a built model, shared by the two pages that draw one.
 *
 * WHAT THE CURVE CARRIES AND WHAT IT DOES NOT — AND IT IS NOT THE SAME ON BOTH PAGES.
 * `KMPoint` is `{t, s, atRisk, events}` (`src/domain/remediation.ts`); there is no per-point
 * censor count on it, so this does not invent one. But the risk set does not always reach the
 * client either: `readModels.ts::shipKM` narrows the MTTR page's curve to `{t, s}` on purpose
 * ("the chart plots two fields… narrowed here because it is a transfer concern"), while the
 * secrets page reads `ttr.km.curve` straight off the domain result and keeps all four fields.
 *
 * MEASURED, not assumed: the first draft of this function published "At risk" and "Closed
 * here" unconditionally, and on `#/mttr` every one of the 130 rows rendered an em dash in
 * both — two columns that could not be anything else. An always-absent column is not an
 * honest absence, it is a claim that something was measured and lost. So the two columns are
 * offered only where the curve actually carries them, which is exactly the secrets page.
 * Where they ARE carried they matter: a drop over a small risk set is a different claim from
 * the same drop over a large one, and the canvas cannot say which.
 *
 * `t` is days; the chart's x axis is weeks (`t / 7`), so both are columns — the weeks one so
 * a reader can find on the canvas the point they are reading, the days one because that is
 * the unit every other figure on these pages is quoted in.
 */
export function survivalTableModel(curve) {
  const points = curve || [];
  const carriesRiskSet = points.some((p) => p && num(p.atRisk) !== null);
  return chartTableModel({
    columns: [
      {
        key: "weeks",
        label: "Weeks",
        format: "num1",
        value: (p) => (num(p.t) === null ? null : p.t / 7),
      },
      { key: "t", label: "Days", format: "days", value: (p) => p.t },
      {
        key: "s",
        label: "Still open",
        format: "pct",
        value: (p) => (num(p.s) === null ? null : p.s * 100),
      },
      ...(carriesRiskSet
        ? [
          { key: "atRisk", label: "At risk", format: "count", value: (p) => p.atRisk },
          { key: "events", label: "Closed here", format: "count", value: (p) => p.events },
        ]
        : []),
    ],
    rows: points,
  });
}

let seq = 0;

/**
 * The disclosure the canvas points at: a closed-by-default `<details>` holding the model as
 * a real table.
 *
 *   canvas   the chart's canvas — gets `aria-details` pointing at this node's id, which is
 *            the association assistive tech follows from the image to its long description.
 *            Wired HERE rather than at each call site so the two cannot be attached to
 *            different nodes.
 *   caption  one sentence naming what the table lists (and its units where the headings
 *            cannot carry them)
 *   model    a `chartTableModel(...)` / `survivalTableModel(...)` result
 *
 * `<summary>` is a real, focusable control by construction, which is what gives the keyboard
 * reader the route the canvas never had; `base.css` already rings every
 * `summary:focus-visible` in `--accent-text`, so the focus ring is inherited, not restated.
 *
 * The caret rotation is gated on `motionOk()` — a marker that swings is decoration, and a
 * reader who asked for reduced motion gets the same disclosure with a caret that simply
 * changes state.
 */
export function chartTable(spec) {
  const { canvas = null, caption = "", model = null, id = null } = spec || {};
  const built = model && Array.isArray(model.columns) && Array.isArray(model.rows)
    ? model
    : chartTableModel({});

  seq += 1;
  const nodeId = id || `chart-table-${seq}`;

  const table = dataTable({
    columns: built.columns.map((col, i) => ({
      key: col.key,
      label: col.label,
      className: col.align === "num" ? "num" : null,
      cell: (row) => row[i],
    })),
    rows: built.rows,
    panel: true,
    emptyText: "This chart has no points to list.",
  });

  const node = el("details", { class: "chart-table", id: nodeId },
    el("summary", {},
      el("span", { class: "chart-table__caret", "aria-hidden": "true" }, "▸"),
      "Show the figures"),
    el("div", { class: "chart-table__body" },
      caption ? el("p", { class: "chart-table__caption" }, caption) : null,
      table));
  if (motionOk()) node.classList.add("chart-table--motion");
  if (canvas && canvas.setAttribute) canvas.setAttribute("aria-details", nodeId);
  return node;
}
