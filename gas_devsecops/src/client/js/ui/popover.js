// Portaled popovers: where they sit, and how they close.
//
// The combobox was the only portaled popover in this app, and its positioning, its
// seven-listener dismissal block and its portal bookkeeping were inlined in one closure. The
// query palette needs the same three things with different geometry, so they move here rather
// than being copied — one dismissal CONTRACT for every popover the app grows, instead of two
// that agree until one of them is edited.
//
// THE ESCAPE RULE. `sheet.js` gates only its Tab trap on `portalsOpen()`; its Escape handler is
// ungated. A popover opened over a sheet that lets Escape bubble therefore dismisses the sheet
// underneath it as well — one keystroke, two things closed, and the one the reader meant to
// keep is the one that went. `popoverDismiss` calls `stopPropagation()` on Escape for every
// caller, so a new popover cannot forget it.

import { el } from "./dom.js";
import { portalClosed, portalOpened } from "./portals.js";

/**
 * Place `pop` against `anchor`, and report how much room its scrolling region may take.
 *
 * Opens downward by default — these triggers sit at the top of a panel, not at the bottom of
 * a rail — and flips above only when there is genuinely no room below AND more above. The
 * width is either the anchor's (`"anchor"`, floored at `minWidth`, for a control whose list
 * should line up under it) or a fixed number, and either way is clamped to the viewport.
 *
 * `onRoom(px, flipped)` receives the height the popover's scrolling child may occupy, so the
 * LIST scrolls rather than the popover running off the bottom of the screen.
 */
export function positionPopover(pop, anchor, opts = {}) {
  const {
    width = "anchor", minWidth = 240, gap = 6, margin = 8,
    flipBelow = 200, minHeight = 120, maxHeight = 320, onRoom = null,
  } = opts;
  const rect = anchor.getBoundingClientRect();
  const want = width === "anchor" ? Math.max(rect.width, minWidth) : width;
  const popWidth = Math.min(want, window.innerWidth - margin * 2);
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - popWidth - margin));
  const below = window.innerHeight - rect.bottom - margin * 2;
  const above = rect.top - margin * 2;
  const flipped = below < flipBelow && above > below;
  pop.style.width = popWidth + "px";
  pop.style.left = left + "px";
  if (flipped) {
    pop.style.top = "";
    pop.style.bottom = (window.innerHeight - rect.top + gap) + "px";
  } else {
    pop.style.bottom = "";
    pop.style.top = (rect.bottom + gap) + "px";
  }
  const room = Math.min(maxHeight, Math.max(minHeight, flipped ? above : below));
  if (onRoom) onRoom(room, flipped);
  return { flipped, room, width: popWidth };
}

/**
 * The seven listeners that dismiss a popover, wired in one call. Returns `release()`.
 *
 *   isInside(node)   what counts as "still in the control" — usually trigger OR popover
 *   close()          outside pointerdown / click
 *   onEscape()       defaults to close; the combobox also returns focus to its trigger
 *   onFocusOut(e)    defaults to close; fires only when focus left everything `isInside`
 *   onReposition()   scroll or resize while the anchor is still on screen
 *   hosts            elements to watch focus leaving (the trigger's wrapper AND the popover)
 *
 * pointerdown as well as click, because the graph canvas takes a pointer capture to pan: a pan
 * that ends outside the window never delivers the click that would otherwise dismiss this.
 *
 * Scroll REPOSITIONS rather than closes. These popovers open from inside scrolling panels, and
 * closing on scroll would dismiss the thing the reader scrolled in order to reach. Only an
 * anchor that has left the viewport entirely closes.
 */
export function popoverDismiss(spec) {
  const { pop = null, anchor = null, isInside, close, hosts = [] } = spec;
  const escape = spec.onEscape || close;
  const focusOut = spec.onFocusOut || close;
  const reposition = spec.onReposition || null;

  function onDocPointer(e) { if (!isInside(e.target)) close(); }
  function onDocClick(e) { if (!isInside(e.target)) close(); }
  function onKey(e) {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    escape(e);
  }
  function onFocusOut(e) {
    if (isInside(e.relatedTarget)) return;
    focusOut(e);
  }
  function onScrollOrResize(e) {
    // `e.target` is the `Window` itself for a `resize` event, not a Node — `Node#contains`
    // throws `TypeError: Failed to execute 'contains' on 'Node'` on anything else, which
    // this app hit on every resize once a popover was open. `instanceof Node` is what tells
    // the two events apart: a scroll's target is always a Node (its own list, or an
    // ancestor), a resize's never is, so a resize simply cannot be "its own list" and this
    // guard is meant to fall through rather than fire for it.
    if (e && e.target instanceof Node && pop && pop.contains && pop.contains(e.target)) return; // its own list
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) { close(); return; }
    }
    if (reposition) reposition();
  }

  document.addEventListener("pointerdown", onDocPointer, true);
  document.addEventListener("click", onDocClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);
  for (const host of hosts) host.addEventListener("focusout", onFocusOut);

  return function release() {
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
    for (const host of hosts) host.removeEventListener("focusout", onFocusOut);
  };
}

/**
 * Mount a popover on `<body>`, positioned against `anchor`, dismissed the standard way.
 *
 * `build(api)` returns the content and may hold on to `api.close` / `api.reposition`; the
 * handle it gets back is the same object, so a caller can close from outside too.
 *
 * `close(true)` returns focus to the anchor — what Escape and a committed choice both want.
 * `close()` leaves focus alone, which is what an outside click and a Tab away want: the
 * pointer or the Tab has already chosen where focus goes, and pulling it back to the trigger
 * would undo that.
 *
 * The combobox deliberately does NOT use this: it owns a longer lifecycle (two popover shapes,
 * a debounce to cancel, an editable mode that commits on blur). It shares the two primitives
 * above instead, which is where the duplication actually was.
 */
export function openPopover(spec) {
  const {
    anchor, className = "", ariaLabel = "", role = "dialog", build,
    onClose = null, position = {},
  } = spec;
  let closed = false;

  const pop = el("div", {
    class: "popover" + (className ? " " + className : ""),
    role,
    "aria-label": ariaLabel || null,
  });

  function reposition() {
    if (!closed) positionPopover(pop, anchor, position);
  }

  function close(focusAnchor) {
    if (closed) return;
    closed = true;
    release();
    pop.remove();
    portalClosed();
    if (onClose) onClose();
    if (focusAnchor === true && anchor && anchor.isConnected) anchor.focus();
  }

  const api = { pop, close, reposition, isOpen: () => !closed };
  const content = build(api);
  if (content) pop.append(content);
  document.body.append(pop);
  portalOpened();
  reposition();

  const release = popoverDismiss({
    pop,
    anchor,
    isInside: (node) => !!node && (pop.contains(node) || (!!anchor && anchor.contains(node))),
    close: () => close(),
    onEscape: () => close(true),
    onReposition: reposition,
    hosts: [pop],
  });

  return api;
}
