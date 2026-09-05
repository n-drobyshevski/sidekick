import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { switchToggle } from "../../../../gas_shared/ui/settings.js";

/**
 * A two-state switch. Pair it with a SettingRow whose htmlFor matches this id.
 *
 * @param checked Default false.
 */
export function SwitchToggle(props) {
  const p = useStableProps(props || {}, ["onChange"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => switchToggle({ checked: !!p.checked, id: p.id, ariaLabel: p.ariaLabel, disabled: !!p.disabled, onChange: p.onChange || (() => {}) })} />;
}
