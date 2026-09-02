import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { nameCell } from "../../../../gas_devsecops/src/client/js/ui/cells.js";

/**
 * A record name with its kind medallion, truncated with the full string available on the
 * clipped span. Takes name AND kind rather than a row, because callers disagree about what the
 * fields are called.
 *
 * @param kind No kind, no medallion.
 * @param badge Appended after the name.
 */
export function NameCell(props) {
  const p = useStableProps(props || {}, []);
  const S = {
    badge: useSlot(p.badge !== undefined && p.badge !== null),
  };
  const sig = sigOf(p, ["badge"]);
  return (
    <>
      <Mounted sig={sig} build={() => nameCell(p.name, p.kind, { badge: S.badge, className: p.className })} />
      <Slots pairs={[[S.badge, p.badge]]} />
    </>
  );
}
