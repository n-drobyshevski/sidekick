// The bar across the top: whose product this is, and which slice of the register it shows.
//
// DELIBERATELY TWO THINGS. Both describe the whole app rather than any one page — the scope
// switcher governs every figure on every page, so it reads as chrome rather than as one
// page's filter. The reference screens' search box, notification bell and avatar are absent
// because none of them has anything behind it here.
//
// IT DOES NOT KNOW WHAT A SCOPE IS, and that is the seam. The three registers disagree on
// arity and on where the value lives: gas has two CLIENT-side filters and no round trip,
// gas_ai has two SERVER-side filters behind one `api_setSettings`, gas_devsecops has one
// behind `api_setProjectView`. Unifying that would have meant a shared module knowing three
// persistence models. So the appbar takes a NODE the app already built (or null) and decides
// only where it goes.
//
// Rebuilt wholesale rather than patched, and from one payload, so the switcher's label, its
// caption and its accent are always three readings of the same state.

import { appConfig } from "../appConfig.js";
import { brandMark } from "../ui/brandMark.js";
import { clear, el } from "../ui/dom.js";

/**
 * @param {HTMLElement} appbar     the <header class="appbar"> the shell built
 * @param {Node|null}  scopeNode   the app's scope control, or null when there is nothing to
 *                                 slice — including the boot-failure path, where offering a
 *                                 picker over data we could not fetch would be a control
 *                                 with nothing behind it
 */
export function renderAppbar(appbar, scopeNode) {
  if (!appbar) return;
  clear(appbar);
  // Decorative, because the name is right there beside it in text and never hidden — the
  // shell's other copy of the mark (the splash) is decorative for the same reason. The rail
  // carries no mark at all, so nothing in the shell names the product twice.
  appbar.append(
    brandMark(22, { compact: true }),
    el("span", { class: "appbar-name" }, appConfig().productName),
  );
  // The rule goes with the control: a separator with one side missing separates nothing.
  if (scopeNode) {
    appbar.append(el("span", { class: "appbar-sep", "aria-hidden": "true" }), scopeNode);
  }
}
