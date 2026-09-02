import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { skeleton } from "../../../../gas_devsecops/src/client/js/ui/feedback.js";

/**
 * Loading placeholder block: a calm opacity pulse, no shimmer sweep - DESIGN.md forbids the
 * SaaS tell. aria-hidden, so screen readers hear the page role=status label instead. Reduced
 * motion drops the pulse for a static hairline block.
 *
 * @param variant Sets default height and radius.
 */
export function Skeleton(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => skeleton(p.variant || "", { width: p.width, height: p.height, radius: p.radius })} />;
}
