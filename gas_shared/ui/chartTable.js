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
// PAGING IS A VIEWPORT, NOT A FILTER, and the pager is what keeps that true. The rule above
// says the model holds one row per point with no truncation, and it still does —
// `chartTableModel` is untouched by any of this. What a long curve needed was somewhere to
// put 130 rows other than "all of them, always": `#/mttr`'s Kaplan-Meier disclosure ran the
// page several screens past the chart it describes, and the reader who opened it to find one
// step had to scroll through every other one to get back. So the DISCLOSURE pages its own
// model, and the pager states the total on every page ("Page 1 of 9 — 130 rows") so the
// population the canvas drew is still named where the rows are read. A table that quietly
// showed the first fifteen with nothing saying so would be the truncation this file bans.
//
// THE PAGER'S PRESENCE IS DECIDED ONCE, from the row count against DEFAULT_PAGE_SIZE, and
// never again from the size in force. Deciding it from the CURRENT size is the trap: pick
// "250 / page" on a 130-row curve and the footer that offered the choice has no more pages to
// show, so it removes itself and takes the only route back to 15 with it. `chartTablePaged`
// is that decision, pure and tested; a table at or under the default keeps exactly the markup
// it had before pagination existed.
//
// THE PURE / DOM SPLIT, and why the pure half is the bigger one. `chartTableModel` is
// DOM-free and does all of the formatting; `chartTable` only dresses its output. This
// project's vitest run has no `environment` set (no jsdom), so the half that can actually be
// WRONG — "does a null render as an em dash or as a confident 0" — is the half that can be
// held by a test. CLAUDE.md's `Number(null)` rule is the whole reason: every numeric cell
// goes through `ui/figures.js`, which refuses null BEFORE the cast, so an absent figure
// prints an em dash and a measured zero prints "0", and the two never trade places.

import { el, motionOk } from "./dom.js";
import { dataTable, tableFooter } from "./data.js";
import { DEFAULT_PAGE_SIZE, pageOf } from "./tableModel.js";
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

/**
 * Does this table get a pager? DOM-free, so the one decision that can be WRONG has a test
 * that needs no jsdom.
 *
 * Answered from the row count alone, against `DEFAULT_PAGE_SIZE` — deliberately NOT against
 * whatever size is in force. See the header: a footer that disappears when the reader widens
 * the page is a control that eats itself. `chartTable` calls this once, at build time, and
 * the answer is fixed for the life of the node.
 *
 * At or under the default the disclosure renders exactly what it rendered before paging
 * existed: the whole model, no footer, no row count. A four-bucket aging table does not need
 * to be told it has four rows.
 *
 * @param {number} rowCount rows in the built model
 * @param {number} [defaultSize] the size the table opens on
 * @returns {boolean}
 */
export function chartTablePaged(rowCount, defaultSize = DEFAULT_PAGE_SIZE) {
  const rows = Math.floor(Number(rowCount)) || 0;
  const size = Math.max(1, Math.floor(Number(defaultSize)) || 0);
  return rows > size;
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
 *
 * `pageSize` overrides the size the table OPENS on; it does not change whether a footer is
 * offered, which is `chartTablePaged`'s answer and is taken against the default regardless.
 */
export function chartTable(spec) {
  const {
    canvas = null, caption = "", model = null, id = null, pageSize = DEFAULT_PAGE_SIZE,
  } = spec || {};
  const built = model && Array.isArray(model.columns) && Array.isArray(model.rows)
    ? model
    : chartTableModel({});

  seq += 1;
  const nodeId = id || `chart-table-${seq}`;

  const paged = chartTablePaged(built.rows.length);
  let page = 0;
  let size = Math.max(1, Math.floor(Number(pageSize)) || DEFAULT_PAGE_SIZE);

  const table = dataTable({
    columns: built.columns.map((col, i) => ({
      key: col.key,
      label: col.label,
      className: col.align === "num" ? "num" : null,
      cell: (row) => row[i],
    })),
    rows: paged ? pageOf(built.rows, page, size).rows : built.rows,
    panel: true,
    emptyText: "This chart has no points to list.",
  });

  // The strip lives in its own host so a page change repaints the footer WITHOUT rebuilding
  // the table's header — `dataTable` hands back `setRows` for exactly this, and rebuilding
  // the whole wrap would throw away the sort state and the scroll position of the wrap the
  // reader is mid-way through.
  const footerHost = paged ? el("div", { class: "chart-table__footer" }) : null;

  /**
   * Paging replaces the control that was just pressed, so keyboard focus falls back to the
   * document — the same defect `pages/inventory.js` fixed for the register tables, fixed the
   * same way. `pager` stamps `data-nav` on its two buttons; put focus back on the one that
   * was used, or on its neighbour where the move disabled it (first / last page).
   */
  function repaint(nav) {
    const view = pageOf(built.rows, page, size);
    page = view.page;
    table.setRows(view.rows);
    while (footerHost.firstChild) footerHost.removeChild(footerHost.firstChild);
    footerHost.append(tableFooter({
      page,
      pageCount: view.pageCount,
      total: built.rows.length,
      pageSize: size,
      onPage: (p) => { page = p; repaint("page"); },
      onPageSize: (next, nextPage) => { size = next; page = nextPage; repaint("size"); },
    }));
    if (nav !== "page") return;
    const active = document.activeElement;
    const wanted = active && active.getAttribute ? active.getAttribute("data-nav") : null;
    if (!wanted) return;
    const same = footerHost.querySelector(`[data-nav="${wanted}"]`);
    const other = footerHost.querySelector(
      `[data-nav="${wanted === "prev" ? "next" : "prev"}"]`);
    const target = same && !same.disabled ? same : (other && !other.disabled ? other : null);
    if (target) target.focus();
  }

  const node = el("details", { class: "chart-table", id: nodeId },
    el("summary", {},
      el("span", { class: "chart-table__caret", "aria-hidden": "true" }, "▸"),
      "Show the figures"),
    el("div", { class: "chart-table__body" },
      caption ? el("p", { class: "chart-table__caption" }, caption) : null,
      table,
      footerHost));
  if (paged) repaint(null);
  if (motionOk()) node.classList.add("chart-table--motion");
  if (canvas && canvas.setAttribute) canvas.setAttribute("aria-details", nodeId);
  return node;
}
