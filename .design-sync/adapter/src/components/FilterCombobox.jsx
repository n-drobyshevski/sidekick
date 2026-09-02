import React from "react";
import { Mounted, Slots, sigOf, useSlot, useStableProps } from "../mount.jsx";
import { filterCombobox } from "../../../../gas_devsecops/src/client/js/ui/combobox.js";

/**
 * A filtering combobox. editable:true swaps the trigger button for a real text input carrying
 * role=combobox, per the ARIA editable-combobox pattern - DOM focus never leaves the input and
 * the active row travels as aria-activedescendant. Three extras are opt-in and inert unless
 * asked for, so a list that wants to be a plain list stays one.
 *
 * @param searchPlaceholder Default "Search…".
 * @param fallbackLabel Shown for a value the list does not carry.
 * @param searchThreshold Rows before a search box appears. Default 7.
 * @param editable Real text input rather than a trigger button.
 * @param allowCustom Synthesise a "use what you typed" row. Editable mode only.
 * @param checkSelected Mark the chosen row with a glyph rather than colour and weight alone.
 * @param header A heading and a sentence above the search.
 */
export function FilterCombobox(props) {
  const p = useStableProps(props || {}, ["onChange"]);
  const S = {};
  const sig = sigOf(p, []);
  return <Mounted sig={sig} build={() => filterCombobox({ value: p.value, options: p.options, onChange: p.onChange || (() => {}), ariaLabel: p.ariaLabel, searchPlaceholder: p.searchPlaceholder === undefined ? "Search…" : p.searchPlaceholder, defaultLabel: p.defaultLabel, fallbackLabel: p.fallbackLabel || "", searchThreshold: p.searchThreshold === undefined ? 7 : p.searchThreshold, editable: !!p.editable, allowCustom: !!p.allowCustom, checkSelected: !!p.checkSelected, header: p.header || null })} />;
}
