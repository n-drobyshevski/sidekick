import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { emptyState } from "../../../../gas_shared/ui/feedback.js";

/**
 * Nothing to show, and why - distinct from ErrorState, which is a failure.
 *
 * @param hint What the reader could do about it.
 */
export function EmptyState(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => emptyState(p.message, p.hint)} />;
}
