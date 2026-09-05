import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { select } from "../../../../gas_shared/ui/controls.js";

/**
 * The select element itself: options as strings or {value,label}, with value preselected.
 *
 */
export function Select(props) {
  const p = useStableProps(props || {}, ["onChange"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => select({ options: p.options, value: p.value, onChange: p.onChange || (() => {}), ariaLabel: p.ariaLabel, placeholder: p.placeholder })} />;
}
