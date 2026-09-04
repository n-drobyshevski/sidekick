import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { statusPill } from "../../../../gas_shared/ui/controls.js";

/**
 * OK / warn / bad / neutral state, with a dot the colour never carries alone.
 *
 * @param kind Which state token dresses the pill.
 * @param text One or two words naming the state.
 * @param help What the state actually means - a pill rarely tells the whole story.
 */
export function StatusPill(props) {
  const p = useStableProps(props || {}, []);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => statusPill(p.kind, p.text, p.help)} />;
}
