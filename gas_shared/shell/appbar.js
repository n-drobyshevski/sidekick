// The bar across the top: whose product this is, which slice of the register it shows, and
// the way back out to the hub.
//
// DELIBERATELY THREE THINGS, AND THE THIRD EARNS ITS PLACE THE SAME WAY THE SECOND DOES. The
// scope switcher governs every figure on every page, so it reads as chrome rather than as one
// page's filter; the hub link leads OUT of the app entirely, which is a fact about the whole
// app and about no page in it. The reference screens' search box, notification bell and avatar
// are still absent because none of them has anything behind it here — and the hub link is held
// to exactly that bar: it is drawn only when it has somewhere to go (see below), so it never
// becomes the control-with-nothing-behind-it this chrome is careful never to offer.
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
import { safeHubUrl } from "../hubUrl.js";
import { brandMark } from "../ui/brandMark.js";
import { clear, el } from "../ui/dom.js";
import { tipAnchor } from "../ui/tip.js";
import { uiIcon } from "../ui/uiIcons.js";

/**
 * The link back out to the launcher, or null when this register has no hub to go to.
 *
 * NULL IS THE ORDINARY ANSWER, NOT AN ERROR PATH. A register whose operator has not pasted a
 * hub URL — a fresh deployment, or one where only the other two were set — is a normal state,
 * and the honest rendering of it is no button: the header is not a place a missing Script
 * Property can be acted on, so a disabled control here would explain a problem to the one
 * audience who cannot fix it while sitting on every page of the app. Settings > System is
 * where the unset state is stated, next to the field that resolves it.
 *
 * `safeHubUrl` collapses "absent" and "present but refused" into that same answer on purpose.
 * A value can reach the property without passing the save endpoint — a hand edit in the GAS
 * editor's Project Settings runs no validation at all — and this is the last gate before it
 * becomes an href in the app's own page. See gas_shared/hubUrl.js for what that refuses and
 * why the list is a security boundary rather than a typo-catcher.
 *
 * NO `target` ATTRIBUTE, AND THAT IS NOT AN OVERSIGHT. HtmlService serves these pages inside a
 * sandbox iframe on googleusercontent.com, so an un-targeted link would open the hub INSIDE
 * that frame — the launcher rendered in a box, inside the register it was meant to leave.
 * gas_shared/shell/index.template.html carries `<base target="_top">` for the whole document,
 * which is what navRail.js and navFlyout.js already rely on for their outbound links; adding a
 * second, per-link copy of the same decision here would be a second place for it to drift.
 */
function hubLink(data) {
  const href = safeHubUrl(data && data.hubUrl);
  if (!href) return null;
  // ICON ONLY, SO THE NAME HAS TO COME FROM SOMEWHERE ELSE. `uiIcon()` marks its glyph
  // `aria-hidden` by contract — it is decorative and the caller owns the accessible name — so
  // without `aria-label` this is a link announced as nothing at all, which is worse than the
  // word it replaced. The label is on the <a>, not on the glyph, so it survives any change of
  // mark.
  //
  // AND A SIGHTED READER GETS THE SAME SENTENCE, through `tipAnchor` rather than `title`:
  // `el()` throws on `title` (a native tooltip is unreachable by keyboard, absent on touch and
  // truncated by the OS), and an icon-only control with no text is precisely the case tip.js
  // exists for. `tipAnchor` is a no-op wrapper on an <a> — its disabled-control wrapping only
  // applies to form elements — so this is a plain anchor with `data-tip` on it.
  return tipAnchor(
    el(
      "a",
      { class: "appbar-hub", href, "aria-label": "Hub" },
      uiIcon("grid", 16),
    ),
    "Hub — open the launcher for the other registers.",
  );
}

/**
 * @param {HTMLElement} appbar     the <header class="appbar"> the shell built
 * @param {Node|null}  scopeNode   the app's scope control, or null when there is nothing to
 *                                 slice — including the boot-failure path, where offering a
 *                                 picker over data we could not fetch would be a control
 *                                 with nothing behind it
 * @param {object|null} [data]     the bootstrap payload, for the hub link's address. Absent on
 *                                 the boot-failure path for the same reason `scopeNode` is:
 *                                 there is no payload, so there is no URL, so there is no
 *                                 button — rather than a button pointing at `undefined`.
 */
export function renderAppbar(appbar, scopeNode, data) {
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
  // Last in the DOM as well as last on screen, so tab order follows reading order: identity,
  // then the scope governing what you are reading, then the way out. `.appbar-hub`'s
  // `margin-left: auto` does the pushing — no spacer element, so there is nothing to keep in
  // sync with the presence of the button itself.
  const hub = hubLink(data);
  if (hub) appbar.append(hub);
}
