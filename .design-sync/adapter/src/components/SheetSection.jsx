import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { sheetSection } from "../../../../gas_devsecops/src/client/js/ui/sheet.js";

/**
 * One titled section of a record sheet.
 *
 */
export function SheetSection(props) {
  const p = useStableProps(props || {}, []);
  const S = {
    children: useSlot(p.children !== undefined && p.children !== null),
  };
  const sig = sigOf(p, ["children"]);
  return (
    <>
      <Mounted sig={sig} build={() => sheetSection(p.label, S.children)} />
      <Slots pairs={[[S.children, p.children]]} />
    </>
  );
}
