// The Security Graph's results table: ONE ROW PER MATCHED PATH.
//
// This is the part of the Wiz screen worth copying most carefully. Its columns are grouped by
// NODE in the query — the agent's fields, then the identity's — so an agent bound to two
// service accounts is two rows with its name repeated, and adding a THAT step adds a column
// group rather than a column. It is also the canvas's keyboard fallback: everything the SVG
// shows is reachable here, which is why the view toggle is a peer control and not a
// progressive enhancement.
//
// Built on the shared `dataTable`, so sticky headers, aria-sort, the `.th-sort` buttons, the
// in-place `setRows`/`setSort` repaint and the clickable `role="button"` rows all come for free
// — the same bargain inventory.js took.

import {
  absent, dataTable, el, nameCell, sevBadge, sortRows, tableFooter, triCell,
} from "./ui.js";
import { kindLabel, kindsLabel } from "./icons.js";
// Re-exported so graph.js keeps one import for the table it draws. The list itself is
// ui/tableModel.js's — two registers had shipped the same four numbers independently.
export { DEFAULT_PAGE_SIZE } from "./ui.js";

/**
 * WHICH treatment a field gets. The treatments themselves are ui/cells.js's, shared with every
 * other register; this switch is the graph's alone and stays here.
 *
 * It cannot be caller-supplied per column the way every other page writes `cell(row)`, because
 * these columns are built at runtime from the query's own groups — there is no author to write
 * a renderer for a column the reader just asked into existence. And `name`, `kind`, `severity`
 * and `guardrail` are this payload's field names, not a vocabulary: moving the switch into
 * ui/ would put one page's schema in the shared layer, which is the drift dataTable's own
 * docblock was written to end.
 */
function renderValue(key, value, cell) {
  if (key === "name") return nameCell(cell.name, cell.kind);
  if (value === null || value === undefined || value === "") return absent();
  if (typeof value === "boolean") return triCell(value);
  if (key === "kind") return kindLabel(cell.kind);
  if (key === "severity") return sevBadge(String(value));
  if (key === "guardrail") {
    return value === "missing"
      ? el("span", { class: "pill warn" }, "missing")
      : el("span", { class: "muted" }, "present");
  }
  return String(value);
}

/** The value a column sorts on. `null` covers both an unbound optional leg and an absent field. */
function sortValue(row, groupIndex, key) {
  const cell = row.cells[groupIndex];
  if (!cell) return null;
  const v = cell.fields[key];
  return v === undefined ? null : v;
}

/**
 * @param {object} payload  the runGraphQuery answer ({rows, groups, total, capped, truncated})
 * @param {object} opts     {page, pageSize, sort, dir, onPage, onPageSize, onSort, onOpen}
 */
export function queryTable(payload, opts = {}) {
  const groups = payload.groups || [];
  const allRows = payload.rows || [];

  // Column identity is "which node, which field" — two groups can both offer `name`, and a
  // sort key of "name" alone would move the wrong column's arrow.
  const columns = [];
  const headerGroups = [];
  groups.forEach((group, gi) => {
    const fields = group.fields || [];
    if (!fields.length) return;
    // Two groups belonging to the same OR are ALTERNATIVES: no row fills both. Saying so in
    // the header is the difference between "an agent, its identity and its model" and "an
    // agent, and either its identity or its model" — the second is what the query asked.
    //
    // SAME OR, DIFFERENT BRANCH. Comparing `altOf` alone was enough while a branch was always one
    // node, but a branch whose entity carries its own hop produces two column groups inside ONE
    // branch — same `altOf`, same `altIndex` — and the second was getting an "or" that claimed
    // its own branch had alternated with itself. Those two are conjunctive; only a change of
    // `altIndex` is an alternation.
    const prev = groups[gi - 1];
    const alternative = group.altOf !== undefined && prev && prev.altOf === group.altOf
      && prev.altIndex !== group.altIndex;
    headerGroups.push({
      label: alternative
        ? el("span", {}, el("span", { class: "gq-alt-kw" }, "or"), groupLabel(group, gi, groups))
        : groupLabel(group, gi, groups),
      span: fields.length,
      className: "gq-group-head" + (alternative ? " is-alt" : ""),
    });
    fields.forEach((field, fi) => {
      columns.push({
        key: gi + "." + field.key,
        label: field.label,
        sortable: true,
        className: (field.numeric ? "num" : "") + (fi === 0 && gi > 0 ? " gq-group-start" : ""),
        cell: (row) => {
          const cell = row.cells[gi];
          if (!cell) return absent();
          return renderValue(field.key, cell.fields[field.key], cell);
        },
        groupIndex: gi,
        fieldKey: field.key,
      });
    });
  });

  const sortKey = opts.sort || "";
  const descending = opts.dir === "desc";
  let rows = allRows;
  const active = columns.find((c) => c.key === sortKey);
  if (active) {
    // The tiebreak is passed rather than defaulted: "group 0's name" is THIS payload's stable
    // key — a path's leading node — and the shared sorter has no business guessing it. Without
    // one, two rows tied on the sorted column swap places between repaints and the table
    // appears to shuffle itself when nothing changed.
    rows = sortRows(allRows, {
      value: (row) => sortValue(row, active.groupIndex, active.fieldKey),
      descending,
      tiebreak: (row) => sortValue(row, 0, "name"),
    });
  }

  const pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, opts.page || 1), pageCount);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  const table = dataTable({
    className: "gq-table",
    stickyHeader: true,
    groups: headerGroups.length > 1 ? headerGroups : null,
    columns,
    rows: pageRows,
    sort: active ? { key: sortKey, descending } : null,
    onSort: (key) => opts.onSort && opts.onSort(key),
    onRowOpen: opts.onOpen ? (row) => {
      // The first bound node on the path — an optional leg can null the leading group.
      const first = (row.cells || []).find(Boolean);
      if (first) opts.onOpen(first);
    } : null,
    rowLabel: (row) => (row.cells || [])
      .filter(Boolean)
      .map((c) => c.name + ", " + kindLabel(c.kind))
      .join("; "),
    emptyText: "No paths match this query.",
  });

  // `tableFooter` counts from ZERO, as `pager` always has. Our page state is one-based
  // because that is what belongs in a shareable URL, so the two are converted at this
  // boundary rather than left to disagree by one — including the page the footer hands back
  // when the size changes, which used to be discarded here in favour of a reset to page 1.
  const footer = tableFooter({
    page: page - 1,
    pageCount,
    total: rows.length,
    pageSize,
    onPage: (p) => opts.onPage && opts.onPage(p + 1),
    onPageSize: (size, nextPage) => opts.onPageSize && opts.onPageSize(size, nextPage + 1),
  });

  return el("div", { class: "gq-results" }, table, footer);
}

/**
 * The group heading — the kind, and an ordinal ONLY where the same kind appears twice in one
 * query. "Service Account" twice over says nothing about which step each belongs to; a lone
 * one needs no number, and adding it anyway reads as though a first group is missing.
 */
function groupLabel(group, index, groups) {
  // `kindsLabel`, not `kindLabel`: a group's kind is the node's IDENTITY, which for a node naming
  // several kinds is the list joined by `-`. `kindLabel` has no entry for that and echoed the raw
  // "AI_AGENT-BUCKET" into the header. It handles the wildcard too.
  const base = kindsLabel(group.kind);
  const sameKind = groups.filter((g) => g.kind === group.kind);
  if (sameKind.length < 2) return base;
  return base + " (" + (sameKind.indexOf(group) + 1) + ")";
}
