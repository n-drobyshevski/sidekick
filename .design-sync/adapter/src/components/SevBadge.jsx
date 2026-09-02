import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { sevBadge } from "../../../../gas_devsecops/src/client/js/ui/severity.js";

/**
 * One severity level as a badge: a dot plus the level in words. role=img, not role=status - a
 * detail sheet paints a dozen of these, and a dozen live regions is an announcement storm.
 *
 */
export function SevBadge(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => sevBadge(p.severity)} />;
}
