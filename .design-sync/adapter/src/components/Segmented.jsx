import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { segmented } from "../../../../gas_shared/ui/controls.js";

/**
 * One joined group of aria-pressed buttons - the exclusive-choice recipe. Uses aria-pressed
 * rather than role=radiogroup deliberately: a conformant radiogroup needs a roving tabindex
 * plus arrow cycling, and running two keyboard patterns for one visual recipe is the
 * invented-control problem.
 *
 * @param value The currently pressed option's value.
 */
export function Segmented(props) {
  const p = useStableProps(props || {}, ["onChange"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => segmented({ options: p.options, value: p.value, onChange: p.onChange || (() => {}), ariaLabel: p.ariaLabel || "", className: p.className || "" })} />;
}
