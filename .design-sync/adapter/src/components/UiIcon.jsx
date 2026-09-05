import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { uiIcon } from "../../../../gas_shared/ui/uiIcons.js";

/**
 * One stroked interface icon from the set.
 *
 * @param size Default 16.
 */
export function UiIcon(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => uiIcon(p.name, p.size === undefined ? 16 : p.size)} />;
}
