import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { statRow } from "../../../../gas_devsecops/src/client/js/ui/controls.js";

/**
 * One cell of a .stat-list strip: uppercase name, the figure (optionally with a meter), and a
 * muted sub-line saying what it counts. Borderless by design - a stat strip takes its emphasis
 * from position and hairlines, not from surfaces.
 *
 * @param name The uppercase dimension name.
 * @param value The figure.
 * @param sub Muted sub-line saying what the figure counts.
 * @param meterPct 0-100 draws a meter beside the figure; null or undefined draws none.
 */
export function StatRow(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => statRow(p.name, p.value, p.sub, p.meterPct, p.help)} />;
}
