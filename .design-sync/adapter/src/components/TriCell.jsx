import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { triCell } from "../../../../gas_devsecops/src/client/js/ui/cells.js";

/**
 * A tri-state cell: true, false, or absent. Wiz returns null for a flag it never evaluated,
 * and collapsing that to false is what makes an unassessed asset render as clean.
 *
 */
export function TriCell(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => triCell(p.value)} />;
}
