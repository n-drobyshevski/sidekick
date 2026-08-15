// Quantity display: meters, the sortable data table, and the table pager.

import { clear, el } from "./dom.js";
import { pluralize } from "./format.js";

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
  const { max = 100, label = "", decorative = false, className = "" } = opts;
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
  } = spec;

  const headCells = new Map();
  const headRow = el("tr", {});
  for (const col of columns) {
    if (!col.sortable || !onSort) {
      headRow.append(el("th", { scope: "col" }, col.label));
      continue;
    }
    const th = el("th", { scope: "col" },
      el("button", {
        class: "th-sort",
        "data-sort": col.key,
        "aria-label": `Sort by ${col.label}`,
        onclick: () => onSort(col.key),
      },
        col.label,
        el("span", { class: "th-sort-glyph", "aria-hidden": "true" }),
      ),
    );
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
      const cells = columns.map((col) =>
        el("td", { class: col.className || null }, col.cell(row)));
      const extra = rowClass ? rowClass(row) : "";
      if (!onRowOpen) {
        tbody.append(el("tr", { class: extra || null }, ...cells));
        continue;
      }
      tbody.append(el("tr", {
        class: `clickable${extra ? " " + extra : ""}`,
        tabindex: "0",
        role: "button",
        "aria-label": rowLabel ? rowLabel(row) : null,
        onclick: () => onRowOpen(row),
        onkeydown: (e) => { if (e.key === "Enter") onRowOpen(row); },
      }, ...cells));
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
