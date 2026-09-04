import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { sectionLabel } from "../../../../gas_shared/ui/sheet.js";

/**
 * A section heading that can carry its own definition, so a term is defined where it is read
 * rather than in a paragraph underneath.
 *
 */
export function SectionLabel(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => sectionLabel(p.text, p.help)} />;
}
