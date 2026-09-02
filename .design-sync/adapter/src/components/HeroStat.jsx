import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { heroStat } from "../../../../gas_devsecops/src/client/js/ui/controls.js";

/**
 * The page subject figure. At most ONE per page: a second hero means neither is. Takes its
 * emphasis from size and position, never from a card, a gradient or an accent stripe.
 *
 */
export function HeroStat(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => heroStat(p.label, p.value, p.sub, p.help)} />;
}
