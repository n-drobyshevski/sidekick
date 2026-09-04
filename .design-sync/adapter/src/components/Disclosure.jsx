import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { disclosure } from "../../../../gas_shared/ui/settings.js";

/**
 * A native details/summary fold, for detail that should be available without being in the way.
 *
 */
export function Disclosure(props) {
  const p = useStableProps(props || {}, []);
  const S = {
    children: useSlot(p.children !== undefined && p.children !== null),
  };
  const sig = sigOf(p, ["children"]);
  return (
    <>
      <Mounted sig={sig} build={() => disclosure(p.summary, S.children)} />
      <Slots pairs={[[S.children, p.children]]} />
    </>
  );
}
