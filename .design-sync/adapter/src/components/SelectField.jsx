import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { selectField } from "../../../../gas_devsecops/src/client/js/ui/controls.js";

/**
 * A native select with its dimension named beside it, so a sighted reader sees what the
 * control selects rather than a bare box floating with only an aria-label.
 *
 * @param children The control itself - normally a Select.
 */
export function SelectField(props) {
  const p = useStableProps(props || {}, []);
  const S = {
    children: useSlot(p.children !== undefined && p.children !== null),
  };
  const sig = sigOf(p, ["children"]);
  return (
    <>
      <Mounted sig={sig} build={() => selectField(p.label, S.children)} />
      <Slots pairs={[[S.children, p.children]]} />
    </>
  );
}
