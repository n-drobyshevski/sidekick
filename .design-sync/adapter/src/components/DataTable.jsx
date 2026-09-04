import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { dataTable } from "../../../../gas_shared/ui/data.js";

/**
 * The sortable record table: .table-wrap > table.data, with sortable headers and rows that
 * open a record. Sort direction stays with the caller - this only needs to know which column
 * is active and whether it reads descending.
 *
 * @param sort The active column, or null for unsorted.
 * @param onRowOpen Makes each row a keyboard-operable button.
 * @param rowLabel That row button's accessible name.
 */
export function DataTable(props) {
  const p = useStableProps(props || {}, ["onSort","onRowOpen","rowLabel"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => dataTable({ columns: p.columns, rows: p.rows || [], sort: p.sort || null, onSort: p.onSort || null, onRowOpen: p.onRowOpen || null, rowLabel: p.rowLabel || null, emptyText: p.emptyText || "", className: p.className || "" })} />;
}
