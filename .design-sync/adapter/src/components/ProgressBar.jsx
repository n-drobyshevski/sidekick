import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { progressBar } from "../../../../gas_devsecops/src/client/js/ui/data.js";

/**
 * Determinate when given a number, indeterminate when not - the running-scan case.
 *
 * @param pct A number draws a determinate bar; null or NaN draws the indeterminate one.
 * @param state Extra state class on the track.
 */
export function ProgressBar(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => progressBar(p.pct, p.state || "")} />;
}
