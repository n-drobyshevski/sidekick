import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { pointRail } from "../../../../gas_devsecops/src/client/js/ui/rail.js";

/**
 * One labelled lane on a 0-max axis, with a slider and an exact number field over the same
 * value. draggable:false keeps the drawing and drops the thumb - for a value the model derives
 * rather than one anybody sets.
 *
 * @param value Default 0.
 * @param max Default 100.
 * @param draggable Default true.
 */
export function PointRail(props) {
  const p = useStableProps(props || {}, ["onChange"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => pointRail({ name: p.name, value: p.value === undefined ? 0 : p.value, max: p.max === undefined ? 100 : p.max, draggable: p.draggable !== false, ariaLabel: p.ariaLabel, exactLabel: p.exactLabel, onChange: p.onChange || (() => {}) })} />;
}
