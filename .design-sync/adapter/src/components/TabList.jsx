import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { tabList } from "../../../../gas_shared/ui/settings.js";

/**
 * A real ARIA tablist with roving tabindex and arrow-key cycling.
 *
 * @param idPrefix Default "tab".
 */
export function TabList(props) {
  const p = useStableProps(props || {}, ["onSelect"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => tabList({ tabs: p.tabs, active: p.active, onSelect: p.onSelect || (() => {}), ariaLabel: p.ariaLabel, idPrefix: p.idPrefix === undefined ? "tab" : p.idPrefix })} />;
}
