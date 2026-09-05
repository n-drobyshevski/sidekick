import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { tipMark } from "../../../../gas_shared/ui/tip.js";

/**
 * The bare "?" affordance, for a control whose explanation has no chip to ride on.
 */
export function TipMark(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => tipMark()} />;
}
