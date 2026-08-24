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

import { dataTable, el, pager, sevBadge } from "./ui.js";
import { categoryOf, kindIconSvg, kindLabel, kindsLabel } from "./icons.js";

import { truncTip } from "./ui.js";
const PAGE_SIZES = [25, 50, 100, 250];
export const DEFAULT_PAGE_SIZE = 50;

/** The app's one way of saying "nothing here", used by every register on every page. */
const EMPTY = "—";

/**
 * A yes/no/unknown cell. Three states, never two: the codebase is emphatic that an absent
 * property means Wiz never reported one, and printing that as "No" asserts the opposite of
 * what is known. The word carries the state — colour never does it alone.
 */
function triCell(v) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return el("span", { class: "muted" }, EMPTY);
}

/** The node's kind icon in its category tint, then the name. Mirrors the graph's medallion. */
function nameCell(cell) {
  const icon = kindIconSvg(cell.kind, 14);
  icon.setAttribute("class", "gq-cell-icon");
  // The tip hangs off the clipped span, not its wrapper: .gq-name-text is the box the
  // ellipsis happens in, so it is the box that knows whether anything was lost.
  const text = truncTip(el("span", { class: "gq-name-text" }, cell.name), cell.name);
  return el("span", {
    class: "gq-name",
    "data-category": categoryOf(cell.kind),
  }, icon, text);
}

function renderValue(key, value, cell) {
  if (key === "name") return nameCell(cell);
  if (value === null || value === undefined || value === "") {
    return el("span", { class: "muted" }, EMPTY);
  }
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

/** Ordinary comparison for two present values. Nulls are handled by the caller. */
function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Nulls sink to the bottom in BOTH directions, which is why this sits outside the ascending /
 * descending flip. An unknown is not a small value: letting it lead the ascending page would
 * bury the rows someone sorted the column to find, and reversing would then bury the others.
 * Returns null when both values are present and the caller should compare them normally.
 */
function nullOrder(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return null;
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
          if (!cell) return el("span", { class: "muted" }, EMPTY);
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
    rows = allRows.slice().sort((ra, rb) => {
      const va = sortValue(ra, active.groupIndex, active.fieldKey);
      const vb = sortValue(rb, active.groupIndex, active.fieldKey);
      const nulls = nullOrder(va, vb);
      if (nulls !== null && nulls !== 0) return nulls;
      if (nulls === null) {
        const d = compare(va, vb);
        if (d !== 0) return descending ? -d : d;
      }
      // A stable secondary key, or two rows that tie swap places between repaints and the
      // table appears to shuffle itself when nothing changed.
      const na = sortValue(ra, 0, "name");
      const nb = sortValue(rb, 0, "name");
      const nn = nullOrder(na, nb);
      return nn === null ? compare(na, nb) : nn;
    });
  }

  const pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, opts.page || 1), pageCount);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  const table = dataTable({
    className: "gq-table",
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

  const sizeSelect = el("select", { "aria-label": "Rows per page" },
    ...PAGE_SIZES.map((n) => el("option", { value: String(n) }, String(n))));
  sizeSelect.value = String(pageSize);
  sizeSelect.addEventListener("change", () => opts.onPageSize && opts.onPageSize(Number(sizeSelect.value)));

  // `pager` counts from ZERO — it prints `page + 1` and disables Next at `pageCount - 1`.
  // Our page state is one-based because that is what belongs in a shareable URL, so the two
  // are converted at this boundary rather than left to disagree by one.
  const footer = el("div", { class: "table-footer" },
    pager(page - 1, pageCount, rows.length, (p) => opts.onPage && opts.onPage(p + 1)),
    el("label", { class: "small muted" }, "Rows ", sizeSelect),
  );

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
