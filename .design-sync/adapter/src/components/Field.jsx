import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { field } from "../../../../gas_shared/ui/controls.js";

/**
 * A labelled field. The visible label IS the accessible name (a real label-for), and the hint
 * rides along as aria-describedby - so voice control can address the field by the words next
 * to it. Give your control the same id you pass here.
 *
 * @param id Must match the id on the control you pass as children.
 * @param children The input. Set its id to `id` so the label associates.
 */
export function Field(props) {
  const p = useStableProps(props || {}, []);
  const S = {
    children: useSlot(p.children !== undefined && p.children !== null),
  };
  const sig = sigOf(p, ["children"]);
  return (
    <>
      <Mounted sig={sig} build={() => field(p.id, p.label, S.children, p.hint)} />
      <Slots pairs={[[S.children, p.children]]} />
    </>
  );
}
