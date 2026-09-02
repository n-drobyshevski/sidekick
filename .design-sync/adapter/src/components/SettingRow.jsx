import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { settingRow } from "../../../../gas_devsecops/src/client/js/ui/settings.js";

/**
 * One setting: its name, a sentence saying what it does, and the control that changes it.
 *
 * @param children The control - normally a SwitchToggle.
 * @param htmlFor The control id, so the label associates with it.
 */
export function SettingRow(props) {
  const p = useStableProps(props || {}, []);
  const S = {
    children: useSlot(p.children !== undefined && p.children !== null),
  };
  const sig = sigOf(p, ["children"]);
  return (
    <>
      <Mounted sig={sig} build={() => settingRow({ label: p.label, description: p.description, control: S.children, htmlFor: p.htmlFor })} />
      <Slots pairs={[[S.children, p.children]]} />
    </>
  );
}
