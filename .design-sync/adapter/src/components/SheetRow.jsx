import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { sheetRow } from "../../../../gas_devsecops/src/client/js/ui/sheet.js";

/**
 * One row of a record sheet's issue / finding / relationship list. Becomes a button when
 * onOpen is given, so a row that leads somewhere is reachable by keyboard.
 *
 * @param fix Rendered as a "Recommended fix" block.
 * @param badge Normally a SevBadge.
 * @param onOpen Makes the whole row a button.
 */
export function SheetRow(props) {
  const p = useStableProps(props || {}, ["onOpen"]);
  const S = {
    badge: useSlot(p.badge !== undefined && p.badge !== null),
  };
  const sig = sigOf(p, ["badge"]);
  return (
    <>
      <Mounted sig={sig} build={() => sheetRow({ title: p.title, note: p.note, fix: p.fix, badge: S.badge, onOpen: p.onOpen || null, ariaLabel: p.ariaLabel, extraClass: p.extraClass })} />
      <Slots pairs={[[S.badge, p.badge]]} />
    </>
  );
}
