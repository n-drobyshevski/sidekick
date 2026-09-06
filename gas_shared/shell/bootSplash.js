// The branded veil over the first paint, and the way it leaves.
//
// TWO COPIES OF ONE THING, BY PLATFORM NECESSITY. `shell/index.template.html` paints the
// first one before a single byte of JavaScript has run — that is the whole point of it — and
// this module recreates it for `refresh()`, which re-runs boot() and would otherwise flash a
// cleared pane. `gas_shared/test/contracts/brandMark.js` holds the two to one drawing and to
// one set of words; the template takes both words from the manifest at build time and this
// file reads them from the same manifest at runtime, so there is no third copy to drift.
//
// It reuses the indeterminate progress bar rather than drawing its own, so the splash reads as
// the same loader family as the route overlay — and inherits that bar's reduced-motion striped
// fallback for free.
//
// AND IT DEALS THE ALERT DOTS, exactly as the template's inline script does to the copy the
// browser painted first. Without that call this splash would still animate — but with all 97
// alerts in one phase group, so the mark refresh() rebuilds would move differently from the
// one the reader saw two seconds earlier, on the same page, for no reason they could name.

import { appConfig } from "../appConfig.js";
import { progressBar } from "../ui/data.js";
import { el } from "../ui/dom.js";
import { brandMark, dealAlerts } from "../ui/brandMark.js";

/** The splash, as a detached node. Keep this markup in sync with the HTML template. */
export function bootSplash() {
  const { productName, openingNoun } = appConfig();
  const bar = progressBar(null);
  bar.classList.add("boot-splash-bar");
  bar.setAttribute("aria-label", "Opening the " + openingNoun);
  // dealAlerts() wraps the mark rather than taking a temporary: base.css phases the alert
  // loop by --i, a phase needs an element to sit on, and keeping `brandMark(112)` inside the
  // tree is what keeps this function one expression the contract can read.
  return el(
    "div",
    { class: "boot-splash", role: "status", "aria-live": "polite" },
    el("div", { class: "boot-splash-inner" },
      el("div", { class: "boot-brand" },
        dealAlerts(brandMark(112)),
        el("span", { class: "boot-brand-label" }, productName)),
      bar,
      el("p", { class: "boot-splash-note" }, "Opening the " + openingNoun + "…")),
  );
}

/**
 * Fade the splash out and remove it.
 *
 * `transitionend` removes it; the timeout is the fallback for a transition that never fires
 * (a splash removed while the tab is backgrounded, say). Under reduced motion there is no
 * fade at all, so it goes immediately rather than sitting through a 240ms nothing.
 */
export function hideBootSplash() {
  const splash = document.querySelector(".boot-splash");
  if (!splash) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { splash.remove(); return; }
  splash.classList.add("hiding");
  let done = false;
  const finish = () => { if (done) return; done = true; splash.remove(); };
  splash.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 240);
}
