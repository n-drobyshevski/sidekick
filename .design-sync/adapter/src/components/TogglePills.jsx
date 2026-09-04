import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { togglePills } from "../../../../gas_shared/ui/controls.js";

/**
 * A row of aria-pressed toggle pills over a set of values. pillClass keeps each row its own
 * vocabulary, so a chosen node type and a chosen LOW never look like the same thing.
 *
 * @param pillClass Defaults to "sev-pill".
 * @param sevClass Append sev-<value> to each pill. Default true.
 */
export function TogglePills(props) {
  const p = useStableProps(props || {}, ["onToggle"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => togglePills({ options: p.options, selected: p.selected, onToggle: p.onToggle || (() => {}), ariaLabel: p.ariaLabel || "", pillClass: p.pillClass === undefined ? "sev-pill" : p.pillClass, sevClass: p.sevClass !== false })} />;
}
