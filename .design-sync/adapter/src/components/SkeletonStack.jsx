import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { skeletonStack } from "../../../../gas_devsecops/src/client/js/ui/feedback.js";

/**
 * Several skeleton blocks in a column, for a list or a table that has not arrived.
 *
 * @param gap Default "12px".
 * @param widths Per-row widths, cycled.
 * @param variant Default "line".
 */
export function SkeletonStack(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => skeletonStack(p.count, { gap: p.gap === undefined ? "12px" : p.gap, height: p.height, widths: p.widths, variant: p.variant === undefined ? "line" : p.variant })} />;
}
