// Quantity display: meters, the sortable data table, and the table pager.

import { clear, el } from "./dom.js";
import { PAGE_SIZES, pageForSize } from "./tableModel.js";
import { pluralize } from "./format.js";
import { tip, tipLabel, tipLines, truncTip } from "./tip.js";

/**
 * A proportional fill in a rounded track — the AARS score meter, the stat-list meters, the
 * detail sheet's pillar bars and the facet count bars were four hand-built copies of this.
 *
 * `decorative: true` yields the aria-hidden form, for a meter whose figure is already
 * written out beside it; otherwise it is a real `progressbar` with the value triple.
 * `progressbar`, not `meter`: `meter` has uneven NVDA/VoiceOver support.
 *
 * The returned node carries `.fill`, so a caller that updates in place (the facet rows,
 * which must not be rebuilt or they lose focus) can set a width without re-querying.
 */
export function meter(value, opts = {}) {
  const { max = 100, label = "", decorative = false, className = "", help = null } = opts;
  const n = Number(value) || 0;
  const cap = Number(max) || 0;
  const pct = cap > 0 ? Math.max(0, Math.min(100, (n / cap) * 100)) : 0;

  const attrs = { class: `meter${className ? " " + className : ""}` };
  if (decorative) {
    attrs["aria-hidden"] = "true";
  } else {
    attrs.role = "progressbar";
    attrs["aria-valuemin"] = "0";
    attrs["aria-valuemax"] = String(cap);
    attrs["aria-valuenow"] = String(n);
    if (label) attrs["aria-label"] = label;
  }
  const fill = el("span", { class: "meter-fill" });
  fill.style.width = `${pct}%`;
  const track = el("span", attrs, fill);
  track.fill = fill;
  if (help) tipLabel(track, help);
  return track;
}

/**
 * A track/fill progress bar. `pct` 0–100 renders a determinate fill; `null` renders an
 * indeterminate (animated, with a static reduced-motion fallback) bar. `state` tints
 * the fill ("" | "failed" | "cancelled" | "done").
 */
export function progressBar(pct, state = "") {
  const determinate = typeof pct === "number" && !Number.isNaN(pct);
  const attrs = {
    class: `progress-track${determinate ? "" : " indeterminate"}${state ? " " + state : ""}`,
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": "100",
  };
  if (determinate) attrs["aria-valuenow"] = String(Math.round(pct));
  const fill = el("div", { class: "progress-fill" });
  if (determinate) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  return el("div", attrs, fill);
}

/**
 * The sortable record table: `.table-wrap > table.data`, with sortable headers and rows
 * that open a record.
 *
 * Three of these existed — the inventory's asset table, the combos page's issue table and
 * the graph's table view — each with its own column spec, its own header builder and its
 * own copy of the clickable-row block. They had drifted apart in accessibility, so this
 * takes the strongest version of each part: `aria-sort` on the active header (the graph
 * had none), a real header button carrying `Sort by …` (the graph and combos had no
 * accessible name on it), and a `.th-sort-glyph` span rather than a glyph concatenated
 * into the button's text (combos appended " ▼" to its label, so screen readers read the
 * arrow as part of the column name).
 *
 * Sort direction stays with the caller: the three pages genuinely disagree about what a
 * first click means per column, and two of those rules are unit-tested. This only needs
 * to know which column is active and whether it currently reads descending.
 *
 *   columns  [{ key, label, sortable, cell(row), className }] — `key` is what onSort gets
 *   sort     { key, descending } — the active column, or null for unsorted
 *   onSort   (key) => void
 *   onRowOpen(row) => void — makes each row a keyboard-operable button
 *   rowLabel (row) => string — that row button's accessible name
 *
 * The returned wrapper carries `setRows(rows)` and `setSort(sort)`, which repaint in place
 * for a caller that sorts client-side and must not rebuild its own header.
 */
export function dataTable(spec) {
  const {
    columns, rows = [], sort = null, onSort = null,
    onRowOpen = null, rowLabel = null, emptyText = "", className = "",
    // Per-row class, for tables whose rows are not all the same KIND of row — the
    // compliance register's category rows and their subcategory children share one set of
    // columns and one keyboard path, and differ only in how they are dressed. Returning
    // nothing leaves the row exactly as it was.
    rowClass = null,
    // Optional two-level header: `[{label, span, className}]`, one entry per group of
    // adjacent columns, spans summing to columns.length. The Security Graph's path table needs
    // it — its columns belong to different NODES of the query, and a flat header would present
    // "Name" twice with nothing saying which is the agent and which the identity.
    // Opt-in, so every existing caller renders byte-identically.
    groups = null,
    // (row) => Node | null. Non-null appends a full-width detail <tr> immediately after the
    // row, one <td colspan={columns.length}>. Return null to render nothing — the CALLER owns
    // expansion state, so a collapsed row simply has no detail to draw.
    rowDetail = null,
    // (row) => boolean. Sets aria-expanded on a clickable row. Only meaningful with onRowOpen.
    rowExpanded = null,
  } = spec;

  const headCells = new Map();
  const headRow = el("tr", {});
  // A column heading is where a metric gets DEFINED: it is asked once per table rather than
  // once per row, so this is the one place a definition can be a real control without
  // multiplying the tab order by the row count. `col.help` takes any of tipLabel's shapes.
  for (const col of columns) {
    // `col.className` lands on the HEADER as well as the cells. Two rules in the stylesheet
    // were already written for it and had never once matched: `table.data th.num`, added for
    // the prune census because a numeric heading otherwise sits adrift from its own figures,
    // and `.gq-table table.data th.gq-group-start`, the graph's column-group boundary. Both
    // were dead selectors waiting for this line.
    if (!col.sortable || !onSort) {
      headRow.append(el("th", {
        scope: "col",
        class: col.className || null,
      }, tipLabel(col.label, col.help)));
      continue;
    }
    const sortBtn = el("button", {
      class: "th-sort",
      "data-sort": col.key,
      "aria-label": `Sort by ${col.label}`,
      onclick: () => onSort(col.key),
    },
      col.label,
      el("span", { class: "th-sort-glyph", "aria-hidden": "true" }),
    );
    const th = el("th", { scope: "col", class: col.className || null }, sortBtn);
    // Attached to the sort button rather than wrapping it: pressing a heading sorts, and a
    // second control inside it would offer two meanings for one press. The description hangs
    // off the <th>, which is outside the button's own name.
    const helpLines = tipLines(col.help);
    if (helpLines) tip(sortBtn, helpLines, { describeIn: th });
    headCells.set(col.key, th);
    headRow.append(th);
  }

  const tbody = el("tbody", {});

  function paintSort(s) {
    for (const [key, th] of headCells) {
      const active = !!s && s.key === key;
      if (active) th.setAttribute("aria-sort", s.descending ? "descending" : "ascending");
      else th.removeAttribute("aria-sort");
      const glyph = th.querySelector(".th-sort-glyph");
      if (glyph) glyph.textContent = active ? (s.descending ? "▼" : "▲") : "";
    }
  }

  function paintRows(list) {
    clear(tbody);
    for (const row of list) {
      // EVERY cell, because every cell clips: tables.css gives `table.data td` a 320px cap
      // with an ellipsis, and rule names, resource ids and GraphQL fragments run past it all
      // day. truncTip arms itself only when the cell actually overflowed, measured at hover
      // time, so a column that fits stays silent and a resized window is respected without
      // repainting the table.
      const cells = columns.map((col) => {
        const td = el("td", { class: col.className || null }, col.cell(row));
        const text = td.textContent;
        if (text && text.length > 12) truncTip(td, text);
        return td;
      });
      const extra = rowClass ? rowClass(row) : "";
      if (!onRowOpen) {
        tbody.append(el("tr", { class: extra || null }, ...cells));
      } else {
        tbody.append(el("tr", {
          class: `clickable${extra ? " " + extra : ""}`,
          tabindex: "0",
          role: "button",
          "aria-label": rowLabel ? rowLabel(row) : null,
          "aria-expanded": rowExpanded ? String(rowExpanded(row)) : null,
          onclick: () => onRowOpen(row),
          onkeydown: (e) => { if (e.key === "Enter") onRowOpen(row); },
        }, ...cells));
      }
      // No `aria-controls`: the detail row immediately follows its trigger in DOM order,
      // which is the same disclosure shape compliance.js's category toggle already ships
      // (`aria-expanded`, no `aria-controls`, children following in DOM order). Matching it
      // beats inventing a second convention.
      const detail = rowDetail ? rowDetail(row) : null;
      if (detail) {
        tbody.append(el("tr", { class: "detail-row" },
          el("td", { colspan: String(columns.length) }, detail)));
      }
    }
    if (!list.length && emptyText) {
      tbody.append(el("tr", {},
        el("td", { colspan: String(columns.length), class: "table-empty" }, emptyText)));
    }
  }

  paintSort(sort);
  paintRows(rows);

  // `scope="colgroup"` is what makes the grouping real rather than visual: a screen reader
  // announces "AI Agent, Name" for the cell instead of leaving the reader to infer the owner
  // of the third "Name" column from its position.
  const groupRow = groups && groups.length
    ? el("tr", { class: "th-groups" }, ...groups.map((g) => el("th", {
        scope: "colgroup",
        colspan: String(g.span),
        class: g.className || null,
      }, g.label)))
    : null;

  const wrap = el("div", { class: `table-wrap${className ? " " + className : ""}` },
    el("table", { class: "data" },
      el("thead", {}, ...(groupRow ? [groupRow, headRow] : [headRow])),
      tbody));
  wrap.setRows = paintRows;
  wrap.setSort = paintSort;
  return wrap;
}

/**
 * Prev/Next controls, or a bare row count when a single page fits. The buttons carry
 * `data-nav` so a caller that rebuilds the pager on every page change can put keyboard
 * focus back on the control that was just used.
 */
export function pager(page, pageCount, total, onPage) {
  if (pageCount <= 1) {
    return el("div", { class: "pager" },
      `${total.toLocaleString()} ${pluralize(total, "row")}`);
  }
  return el(
    "div",
    { class: "pager" },
    el("button", {
      "data-nav": "prev",
      onclick: () => onPage(page - 1),
      disabled: page <= 0,
    }, "‹ Prev"),
    `Page ${page + 1} of ${pageCount} — ${total.toLocaleString()} rows`,
    el("button", {
      "data-nav": "next",
      onclick: () => onPage(page + 1),
      disabled: page >= pageCount - 1,
    }, "Next ›"),
  );
}

/**
 * The pager and the rows-per-page control, as one strip under a paged table.
 *
 * Two copies of this shipped — inventory.js and the Security Graph's queryTable.js — and each
 * had half of the right answer, so this is assembled the way `dataTable` above was: take the
 * stronger part of each rather than pick a file to win.
 *
 *   FROM THE GRAPH: the pager leads and the size control follows. The count is the primary
 *   fact ("Page 1 of 8 — 200 rows"); how many fit on a page is an adjustment to it.
 *   FROM THE INVENTORY: `N / page` options, so the control names its own unit and needs no
 *   separate label beside it — and, more importantly, the page recompute below.
 *
 * CHANGING HOW MANY ROWS YOU CAN SEE IS NOT A REQUEST TO GO SOMEWHERE ELSE. The graph's copy
 * reset to page 1 on every size change; on page 12 of a register at 25 rows that is the
 * difference between a control and a trap. `onPageSize` therefore receives the size AND the
 * page still holding the row that was at the top, computed once here rather than by each
 * caller — which is what stopped the two copies agreeing in the first place.
 *
 * `page` is ZERO-BASED, matching `pager` above and `pageOf`. A caller whose own page state is
 * one-based (the graph, because that is what belongs in a shareable URL) converts at this
 * boundary rather than leaving the two to disagree by one.
 *
 *   page      zero-based index of the page on screen
 *   pageCount total pages, >= 1
 *   total     rows across every page, for the count the pager prints
 *   pageSize  rows per page now
 *   sizes     the options to offer; PAGE_SIZES unless a caller has a reason
 *   onPage    (page) => void, zero-based
 *   onPageSize(size, page) => void — `page` is already recomputed
 */
export function tableFooter(spec) {
  const {
    page = 0, pageCount = 1, total = 0, pageSize = 0,
    sizes = PAGE_SIZES, onPage = null, onPageSize = null,
  } = spec || {};

  const kids = [pager(page, pageCount, total, (p) => onPage && onPage(p))];

  if (onPageSize) {
    const sizeSelect = el("select", { "aria-label": "Rows per page" },
      ...sizes.map((n) => el("option", { value: String(n) }, n + " / page")));
    sizeSelect.value = String(pageSize);
    sizeSelect.addEventListener("change", () => {
      const next = Number(sizeSelect.value);
      onPageSize(next, pageForSize(page, pageSize, next));
    });
    kids.push(sizeSelect);
  }

  return el("div", { class: "table-footer" }, ...kids);
}
