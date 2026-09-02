import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { copyButton } from "../../../../gas_devsecops/src/client/js/ui/code.js";

/**
 * Copies what getText returns. getText is a function rather than a string so the button can
 * sit beside content that changes without being rebuilt and losing focus. title becomes the
 * accessible name, answering "copy WHAT".
 *
 * @param label Default "Copy".
 * @param copiedLabel Default "Copied".
 * @param title The accessible name - says what is being copied.
 */
export function CopyButton(props) {
  const p = useStableProps(props || {}, ["getText"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => copyButton(p.getText || (() => ""), { label: p.label === undefined ? "Copy" : p.label, copiedLabel: p.copiedLabel === undefined ? "Copied" : p.copiedLabel, title: p.title || "" })} />;
}
