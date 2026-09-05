import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { filterChipRow } from "../../../../gas_shared/ui/controls.js";

/**
 * The applied-filter chips: what is narrowing the view right now, each dismissible. A chip
 * splits into a label that opens the panel at that filter and a cross that clears it, so
 * clicking the thing you want to change does not delete it.
 *
 * @param entries isDefault prefixes 'Default ·' so the row does not claim the reader applied it.
 * @param emptyText Keeps the band height when no filters are applied.
 */
export function FilterChipRow(props) {
  const p = useStableProps(props || {}, ["onPatch","onEdit","onClearAll"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => {
        const node = filterChipRow({ onPatch: p.onPatch || (() => {}), onEdit: p.onEdit || null, onClearAll: p.onClearAll || null, emptyText: p.emptyText || "", className: p.className || "", ariaLabel: p.ariaLabel || "Applied filters" });
        node.sync(p.entries || []);
        return node;
      }} />;
}
