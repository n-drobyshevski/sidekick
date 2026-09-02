import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { axisBar, axisSegments } from "../../../../gas_devsecops/src/client/js/ui/axisBar.js";

/**
 * One distribution drawn along a fixed axis: a segment per axis VALUE, grown by its share.
 * `unknown` is hatched inside the value it belongs to rather than split off as a fifth segment
 * — for most axes a row without an established reading still has a value, and a separate
 * segment would claim it did not.
 *
 * @param values The axis values, in rank order — the segment names, NOT counts.
 * @param reading The tally. Without it the bar reads "not measured yet".
 * @param unit What the rows are. Default "rows".
 */
export function AxisBar(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => {
        const node = axisBar({ values: p.values, unit: p.unit === undefined ? "rows" : p.unit });
        node.paint(axisSegments(p.reading, p.values));
        return node;
      }} />;
}
