// A points rail: one value drawn on the page's shared 0–100 score axis, and edited on it.
//
// The band rail on the AARS Rules page already established the division of labour this
// borrows — the rail shows the shape, the number sets the value — and the reason it uses a
// real `<input type="range">` rather than a div and a pointer listener: keyboard (arrows,
// Home/End, PageUp/Down) and screen-reader semantics arrive native and nothing is
// re-implemented.
//
// Three things are drawn that a number field cannot say:
//   - the BASE, on the same axis as every other value on the page, so a MEDIUM 20 in
//     pillar A is exactly as long as a SENSITIVE 20 in pillar C and both sit over 20 on the
//     band rail below;
//   - the JUMP a multiplier causes, as a hatched extension, so "20 ×1.2 = 24" is one figure
//     rather than two fields and a mental sum;
//   - the CAP, as the line it is, with everything past it hatched out — the clamp, shown.
//
// Two structural rules, both learned the hard way from the band rail:
//   - the range lives OUTSIDE the clipped track, or its focus ring is cut off — and the
//     focus ring is a named non-negotiable;
//   - the range and the number field get DIFFERENT accessible names, or a screen-reader
//     user tabs between two controls that introduce themselves identically.
//
// Nothing here creates a node after construction. `setValue` / `setJump` / `setCap` write
// widths, text and attributes in place, so a repaint can never drop a keystroke — the rule
// the page this serves exists to keep.

import { el } from "./dom.js";

let _railSeq = 0;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function num(raw, fallback) {
  const s = String(raw).trim();
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Write a value into an input — unless the user is in it. Never fight the cursor. */
function setValue(input, value) {
  if (document.activeElement === input) return;
  const s = String(value);
  if (input.value !== s) input.value = s;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function setAttr(node, name, value) {
  const v = String(value);
  if (node.getAttribute(name) !== v) node.setAttribute(name, v);
}

/**
 * One labelled lane on the 0–`max` axis.
 *
 * `onChange(value)` fires from either control. `draggable: false` keeps the drawing and
 * drops the thumb — for a value the model derives rather than one anybody sets.
 *
 * Returns the row node, carrying:
 *   setValue(v)                     reflect state; never fires onChange
 *   setJump(multiplier, label)      the extension an amplifier adds
 *   setCap(cap, {derived, label})   the clamp line, and whether it has a handle
 *   setChanged(changed, saved)      the unsaved-value mark, same idiom as field()
 *   focusExact()                    put the caret in the number field
 */
export function pointRail({
  name,
  value = 0,
  max = 100,
  draggable = true,
  ariaLabel,
  exactLabel,
  onChange,
}) {
  const id = `rail-${++_railSeq}`;
  const sliderName = ariaLabel || `${name} points`;
  let v = clamp(Math.round(value) || 0, 0, max);
  let jump = 1;
  let jumpLabel = "";
  let cap = max;
  let capDerived = false;
  let capLabel = "";

  const base = el("div", { class: "rail-base" });
  const ampText = el("span", { class: "rail-amp-txt", "aria-hidden": "true" });
  const amp = el("div", { class: "rail-amp" }, ampText);
  const over = el("div", { class: "rail-over" });
  const clip = el("div", { class: "rail-clip" }, base, amp, over);
  // The cap line sits OUTSIDE the clip so it can overhang the track it cuts, and reads as a
  // boundary rather than as a mark painted inside one band.
  const capLine = el("div", { class: "rail-cap" });
  const track = el("div", { class: "rail-track" }, clip, capLine);

  const lane = el("div", { class: "rail-lane" }, track);

  let stop = null;
  if (draggable) {
    stop = el("input", {
      type: "range", class: "rail-stop",
      min: "0", max: String(max), step: "1", value: String(v),
      "aria-label": sliderName,
    });
    stop.addEventListener("input", () => {
      set(num(stop.value, v), "range");
      if (onChange) onChange(v);
    });
    // height:0 wrapper, outside the track — see the file header.
    lane.append(el("div", { class: "rail-stops" }, stop));
  }

  const exact = el("input", {
    type: "number", id, class: "rail-num",
    min: "0", max: String(max), step: "1", value: String(v),
    // No aria-label: the visible <label for> below IS this control's name, so voice control
    // can address it by the words next to it — the same contract field() keeps. The slider
    // carries the fuller name, which is what keeps the two controls distinct: tabbing
    // between them announces "CRITICAL" and "CRITICAL issue points", not one name twice.
    "aria-label": exactLabel || null,
  });
  exact.addEventListener("input", () => {
    set(num(exact.value, v), "exact");
    if (onChange) onChange(v);
  });

  const label = el("label", { class: "rail-name", for: id }, name);
  const readout = el("span", { class: "rail-rd" });
  const row = el("div", { class: "rail" }, label, lane, exact, readout);

  /** The one setter both controls route through. */
  function set(next, from) {
    v = clamp(Math.round(next) || 0, 0, max);
    if (from !== "exact") setValue(exact, v);
    if (from !== "range" && stop) setValue(stop, v);
    paint();
  }

  function paint() {
    const pct = (n) => `${clamp((n / max) * 100, 0, 100)}%`;
    const amplified = Math.round(v * jump);
    const scored = Math.min(cap, amplified);

    base.style.width = pct(v);
    const ampFrom = Math.min(v, max);
    const ampTo = Math.min(amplified, max);
    amp.style.left = pct(ampFrom);
    amp.style.width = pct(Math.max(0, ampTo - ampFrom));
    ampText.style.left = pct(ampFrom);
    ampText.style.width = pct(Math.max(0, ampTo - ampFrom));
    // The label only when the segment is wide enough to hold it — a clipped "×1." is worse
    // than nothing, and the readout says the same thing in full either way.
    setText(ampText, ampTo - ampFrom >= max * 0.06 ? jumpLabel : "");

    const overFrom = Math.min(cap, max);
    over.style.left = pct(overFrom);
    over.style.width = pct(Math.max(0, ampTo - overFrom));

    capLine.style.left = pct(Math.min(cap, max));
    capLine.classList.toggle("rail-cap--derived", capDerived);
    // A cap at the top of the axis constrains nothing, and a dashed line pinned to the
    // track's own edge would read as a border rather than as a limit.
    capLine.hidden = cap >= max;
    setAttr(capLine, "title", capLabel || `cap ${cap}`);

    // The readout is the words. It never depends on the hatching being visible, because
    // "clamped" is exactly the state a reader who cannot see the hatch most needs told.
    let text = String(v);
    if (amplified !== v) text += ` → ${amplified}`;
    if (amplified > cap) text += ` · scores ${scored}`;
    setText(readout, text);

    if (stop) {
      setAttr(stop, "aria-valuetext",
        `${v} points` +
        (amplified !== v ? `, ${amplified} with the multiplier` : "") +
        (amplified > cap ? `, capped at ${scored}` : ""));
    }
  }

  row.setValue = (next) => set(next, null);
  row.setJump = (multiplier, text) => {
    jump = Number(multiplier) || 1;
    jumpLabel = text || (jump > 1 ? `×${jump}` : "");
    paint();
  };
  row.setCap = (next, opts) => {
    const o = opts || {};
    cap = clamp(Number(next) || 0, 0, max);
    capDerived = !!o.derived;
    capLabel = o.label || "";
    paint();
  };
  /** The unsaved-value mark, same idiom as field(): a dot AND the saved value in words. */
  row.setChanged = (changed, savedValue) => {
    label.classList.toggle("field--changed", !!changed);
    if (changed) label.title = `Saved value: ${savedValue}`;
    else label.removeAttribute("title");
  };
  row.focusExact = () => exact.focus();
  row.exactInput = exact;

  paint();
  return row;
}

/**
 * The 0–`max` scale under a group of rails, aligned to their track column. Purely a legend
 * — every rail already states its own value in words — so it is hidden from assistive tech.
 */
export function railScale(max = 100) {
  return el(
    "div",
    { class: "rail-axis", "aria-hidden": "true" },
    el("span", {}),
    el("span", { class: "rail-axis__ticks" },
      el("span", {}, "0"),
      el("span", {}, String(Math.round(max / 2))),
      el("span", {}, String(max))),
    el("span", {}),
    el("span", {}),
  );
}
