import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { kpiCard } from "../../../../gas_devsecops/src/client/js/ui/controls.js";

/**
 * A KPI tile: label, the figure, an optional chip beside it and a muted sub-line.
 *
 * @param chip Rendered inside the value line - normally a StatusPill.
 */
export function KpiCard(props) {
  const p = useStableProps(props || {}, []);
  const S = {
    chip: useSlot(p.chip !== undefined && p.chip !== null),
  };
  const sig = sigOf(p, ["chip"]);
  return (
    <>
      <Mounted sig={sig} build={() => kpiCard(p.label, p.value, p.sub, S.chip, p.help)} />
      <Slots pairs={[[S.chip, p.chip]]} />
    </>
  );
}
