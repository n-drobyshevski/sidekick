import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { sevKeyRow, sevEntries } from "../../../../gas_devsecops/src/client/js/ui/severity.js";
const DEFAULT_SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

/**
 * The key that reads a SevSegmentBar: each level, its dot and its count.
 *
 */
export function SevKeyRow(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => sevKeyRow(sevEntries(p.counts, p.order || DEFAULT_SEV_ORDER), {})} />;
}
