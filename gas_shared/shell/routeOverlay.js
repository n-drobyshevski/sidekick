// The route-reload veil: a progress bar over the CONTENT PANE while the active page refetches.
//
// Over the pane and not the window, which is the whole design: the rail and the header stay
// live under a reload, so the control that caused it (a scope pick, most visibly) is still
// there to change again. The overlay is therefore a child of the body ROW rather than of
// `#app`, and it sits OUTSIDE `<main>` so replacing `<main>` per route cannot take it with it.
//
// SHOWN ONLY IF THE LOAD OUTLASTS 120ms, so a cached switch never flashes a loader, and the
// live-region text is set only once it is actually visible — a `role="status"` that fills in
// while hidden announces an update the reader never sees. The shell's own sequence guard keeps
// it up across rapid successive changes; this module only knows how to show and hide.

import { el } from "../ui/dom.js";

const ROUTE_LOADING_DELAY_MS = 120;

let overlay = null;
let timer = null;

/** Build the overlay and take ownership of it. Called once per boot, with the shell. */
export function mountRouteOverlay() {
  clearTimeout(timer);
  timer = null;
  overlay = el(
    "div",
    { class: "route-overlay", role: "status", "aria-live": "polite" },
    el("div", { class: "route-overlay-bar", "aria-hidden": "true" },
      el("div", { class: "route-overlay-fill" })),
    el("span", { class: "route-overlay-label" }),
  );
  return overlay;
}

export function beginRouteLoading() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!overlay) return;
    // Set the live-region text only after the overlay is visible so it announces.
    overlay.classList.add("visible");
    const label = overlay.querySelector(".route-overlay-label");
    if (label) label.textContent = "Updating…";
  }, ROUTE_LOADING_DELAY_MS);
}

export function endRouteLoading() {
  clearTimeout(timer);
  if (!overlay) return;
  overlay.classList.remove("visible");
  const label = overlay.querySelector(".route-overlay-label");
  if (label) label.textContent = "";
}
