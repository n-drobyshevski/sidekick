import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { settingsPanel } from "../../../../gas_shared/ui/settings.js";

/**
 * A titled panel grouping related settings, with an optional footer for its actions.
 *
 * @param children The panel body - normally a stack of SettingRow.
 */
export function SettingsPanel(props) {
  const p = useStableProps(props || {}, []);
  const S = {
    children: useSlot(p.children !== undefined && p.children !== null),
    footer: useSlot(p.footer !== undefined && p.footer !== null),
  };
  const sig = sigOf(p, ["children","footer"]);
  return (
    <>
      <Mounted sig={sig} build={() => settingsPanel({ title: p.title, description: p.description, body: S.children, footer: S.footer })} />
      <Slots pairs={[[S.children, p.children], [S.footer, p.footer]]} />
    </>
  );
}
