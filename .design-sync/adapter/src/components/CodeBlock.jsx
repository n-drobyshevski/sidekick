import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { codeBlock } from "../../../../gas_devsecops/src/client/js/ui/code.js";

/**
 * A monospaced block for a command, a path or a blob, with an optional label.
 *
 */
export function CodeBlock(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => codeBlock(p.text, { label: p.label || "", maxHeight: p.maxHeight || "" })} />;
}
