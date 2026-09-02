import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { tableFooter } from "../../../../gas_devsecops/src/client/js/ui/data.js";

/**
 * The pager plus a rows-per-page select. onPageSize receives the page already recomputed for
 * the new size.
 *
 * @param page Zero-based.
 * @param sizes Defaults to PAGE_SIZES (25/50/100/250).
 */
export function TableFooter(props) {
  const p = useStableProps(props || {}, ["onPage","onPageSize"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => tableFooter({ page: p.page, pageCount: p.pageCount, total: p.total, pageSize: p.pageSize, sizes: p.sizes, onPage: p.onPage || null, onPageSize: p.onPageSize || null })} />;
}
