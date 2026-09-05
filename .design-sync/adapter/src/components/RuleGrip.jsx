import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { ruleGrip } from "../../../../gas_shared/ui/rowReorder.js";

/**
 * The drag handle for a reorderable rule row.
 */
export function RuleGrip(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => ruleGrip()} />;
}
