// The signed delta chip: how a figure moved against the scan before it.
//
// LOCAL BECAUSE THE DIRECTION IS THIS REGISTER'S CLAIM, not the design system's. Every other
// app in the family draws a number; this one draws a number that is BETTER OR WORSE, and
// which way is which is a property of the metric ("open CRITICAL went up" is bad, "coverage
// went up" is good). `invert` is that decision, and it belongs to a register that measures
// risk rather than to a shared component library that measures nothing.
//
// The `.chg` / `.chg.up` / `.chg.down` / `.chg.flat` classes ARE shared
// (gas_shared/styles/components.css) — the dressing is the family's, the semantics are ours.

import { el } from "../../../../../gas_shared/ui/dom.js";

/** One decimal, for a magnitude with no formatter of its own. Private: changeChip is the
 *  only caller, and a second rounding helper in the barrel is how two of them start. */
function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * Signed change chip vs a previous value. up = worse (red) for counts of risk.
 * `fmt` formats the (unsigned) magnitude in the value's own unit — e.g.
 * `changeChip(median, prev, { fmt: fmtSpan })` -> "+2.3mo" — so the delta never
 * contradicts the scale of the figure it annotates. `suffix` appends a unit to a plain
 * number ("%"). An `aria-label` restates the direction in words for screen readers.
 */
export function changeChip(current, previous, { invert = false, fmt = null, suffix = "" } = {}) {
  if (previous === null || previous === undefined || Number.isNaN(previous)) return null;
  const delta = current - previous;
  if (!delta) return el("span", { class: "chg flat", "aria-label": "unchanged" }, "±0");
  const worse = invert ? delta < 0 : delta > 0;
  const cls = worse ? "up" : "down";
  const sign = delta > 0 ? "+" : "−";
  const mag = fmt ? fmt(Math.abs(delta)) : `${round1(Math.abs(delta))}${suffix}`;
  return el("span", { class: `chg ${cls}`, "aria-label": `${worse ? "up" : "down"} ${mag}` },
    `${sign}${mag}`);
}
