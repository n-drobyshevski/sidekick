import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { meter } from "../../../../gas_devsecops/src/client/js/ui/data.js";

/**
 * A proportion drawn as a track and a fill. Decorative when the number is already written
 * beside it, a real progressbar when it is not.
 *
 * @param max Default 100.
 * @param label The accessible name. Omit only when decorative.
 * @param decorative aria-hidden instead of a second announcement of a figure already on screen.
 */
export function Meter(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => meter(p.value, { max: p.max === undefined ? 100 : p.max, label: p.label || "", decorative: !!p.decorative, className: p.className || "", help: p.help || null })} />;
}
