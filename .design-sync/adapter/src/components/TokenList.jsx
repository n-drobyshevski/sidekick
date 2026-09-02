import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { tokenList } from "../../../../gas_devsecops/src/client/js/ui/tokenList.js";

/**
 * A set of values as removable chips with a picker to add more. The picker is built ONCE and
 * only the chips are rebuilt - a rebuilt input is a dropped keystroke and focus on body.
 *
 * @param options Picker rows.
 * @param placeholder Default "Add…".
 */
export function TokenList(props) {
  const p = useStableProps(props || {}, ["onChange"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => tokenList({ values: p.values || [], options: p.options || [], ariaLabel: p.ariaLabel, placeholder: p.placeholder === undefined ? "Add…" : p.placeholder, emptyText: p.emptyText || "", onChange: p.onChange || (() => {}) })} />;
}
