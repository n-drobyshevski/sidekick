import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { saveBar } from "../../../../gas_devsecops/src/client/js/ui/settings.js";

/**
 * The unsaved-changes bar: what changed, a jump to each changed field, discard and save.
 * Sticky to the bottom of its container. It is HIDDEN until `changes` is non-empty — a bar
 * offering to save nothing is worse than no bar.
 *
 * @param changes What is unsaved. An empty list hides the bar.
 * @param countText The lead, e.g. "3 unsaved changes".
 * @param onJump Jump to a changed field, by tab id.
 * @param saveLabel Default "Save changes".
 */
export function SaveBar(props) {
  const p = useStableProps(props || {}, ["onSave","onDiscard","onJump"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => {
        const node = saveBar({ onSave: p.onSave || (() => {}), onDiscard: p.onDiscard || (() => {}), onJump: p.onJump || null, saveLabel: p.saveLabel === undefined ? "Save changes" : p.saveLabel });
        node.update(p.countText || ((p.changes || []).length + " unsaved changes"), p.changes || []);
        return node;
      }} />;
}
