import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { pager } from "../../../../gas_devsecops/src/client/js/ui/data.js";

/**
 * Prev/Next controls, or a bare row count when a single page fits.
 *
 * @param page Zero-based.
 * @param total Rows across every page.
 */
export function Pager(props) {
  const p = useStableProps(props || {}, ["onPage"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => pager(p.page, p.pageCount, p.total, p.onPage || (() => {}))} />;
}
