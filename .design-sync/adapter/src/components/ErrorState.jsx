import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { errorState } from "../../../../gas_devsecops/src/client/js/ui/feedback.js";

/**
 * Failure, not emptiness: announced via role=alert, retryable in place, and the raw exception
 * demoted into a disclosure instead of printed at the reader as body copy.
 *
 * @param onRetry Draws a "Try again" button.
 * @param detail The raw exception, folded into a "Technical details" disclosure.
 */
export function ErrorState(props) {
  const p = useStableProps(props || {}, ["onRetry"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => errorState(p.message, { onRetry: p.onRetry || null, detail: p.detail || null })} />;
}
