import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { sevSegmentBar, sevEntries } from "../../../../gas_shared/ui/severity.js";
const DEFAULT_SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

/**
 * A severity distribution drawn as one bar: a segment per level, grown by its count. Levels
 * with nothing in them are not segments.
 *
 * @param counts A tally. Empty levels are dropped.
 * @param order Segment order. Defaults to CRITICAL..UNKNOWN.
 * @param size Default "md".
 * @param label The accessible name. Omit for a bar whose numbers are already written beside it - it then goes aria-hidden rather than announcing the same figures twice.
 * @param width Inline width, for a bar whose LENGTH carries the total.
 * @param emptyHatch Draw a hatched full-width segment when there is nothing to show.
 */
export function SevSegmentBar(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => sevSegmentBar(sevEntries(p.counts, p.order || DEFAULT_SEV_ORDER), { size: p.size === undefined ? "md" : p.size, label: p.label || "", width: p.width || "", emptyHatch: !!p.emptyHatch })} />;
}
