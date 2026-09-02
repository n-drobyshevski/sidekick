import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { absent } from "../../../../gas_devsecops/src/client/js/ui/cells.js";

/**
 * The em-dash cell. Absent is not zero - this is what a value that was never measured looks
 * like.
 */
export function Absent(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => absent()} />;
}
