// The nav panel: the second tier of the rail, listing what lives under the item you are
// pointing at.
//
// IT IS A COLUMN, NOT A POPUP. It runs the full height of the body row at a fixed width and
// a fixed left edge, so there is no placement problem to solve — no viewport collision, no
// flip, no measurement. That is why it does not go through openPopover(), which portals to
// <body> at --z-popover and would float this over a record sheet. It lives in .app-body
// instead (already the positioning context for the route overlay), at a z-index above that
// overlay — a panel open while a page refetches must stay readable and clickable — and below
// the scrim, so a sheet still covers it.
//
// WHAT IT DOES REUSE is the dismissal contract (popoverDismiss: outside pointerdown AND
// click, Escape with stopPropagation, focusout, one release()) and the hover physiology the
// tip already settled: 220ms cold, nothing at all inside the warm window, and a close grace
// long enough to cross the dead space between the rail and the panel. Two surfaces in one app
// that open on hover have to feel like one decision, and SC 1.4.13 is not optional on either.
//
// STATE LIVES HERE, not on the nodes. renderSidebar() clears and rebuilds the rail wholesale
// on every refresh() and on every experimental-flag change, so anything held on a rail item
// would be dropped mid-hover.

import { hasPanel, panelBlocks } from "./navModel.js";
import { buildHash, defaultRoute } from "../../../../gas_shared/store.js";
import { coarse, el } from "../../../../gas_shared/ui/dom.js";
import { popoverDismiss } from "../../../../gas_shared/ui/popover.js";
import { portalClosed, portalOpened } from "../../../../gas_shared/ui/portals.js";
import { CLOSE_GRACE, tipDelay } from "../../../../gas_shared/ui/tipPlace.js";
import { uiIcon } from "../../../../gas_shared/ui/uiIcons.js";
import { LANE_ICONS, ROUTE_ICONS } from "./routeIcons.js";

// The pinned preference rides the key the collapsed rail used to own, and reads the same way
// round: "0" was an explicitly expanded rail, which is what a pinned panel now is. A reader
// who had widened the rail keeps a wide left edge across the change rather than being reset
// to the default by a rename.
const PIN_KEY = "sidebarCollapsed";
function loadPinned() {
  try { return localStorage.getItem(PIN_KEY) === "0"; } catch { return false; }
}
function savePinned(v) {
  try { localStorage.setItem(PIN_KEY, v ? "0" : "1"); } catch { /* sandboxed */ }
}

let hostEl = null;          // the panel
let ctxProvider = null;     // what the shell holds, asked for rather than cached at boot
let ctx = {};               // its last answer — see refreshCtx()
let pinned = loadPinned();
let hoverItem = null;       // what the pointer/keyboard is asking for right now
let hoverAnchor = null;     // the rail item it came from, for focus restore
let stickyItem = null;      // what the PINNED column shows — see pinTarget()
let release = null;         // popoverDismiss teardown
let counted = false;        // whether this panel is currently counted as an open portal
let openTimer = 0;
let closeTimer = 0;
let lastCloseAt = 0;

/** Blocks for an item, resolved against whatever the shell currently holds. */
function blocksFor(item) {
  return panelBlocks(item, ctx);
}

/**
 * Re-ask the shell what it holds.
 *
 * Once per open rather than once per boot, because half of what the panel lists is written by
 * the reader while the app is running: save a view on the Inventory and it has to be in the
 * Landscape panel the next time that panel opens, not the next time the whole app reloads.
 * Not once per row, either — railItems() asks every item whether it has a panel, and reading
 * localStorage twice per item on every rail repaint is a cost with nothing behind it.
 */
function refreshCtx() {
  if (ctxProvider) ctx = ctxProvider() || {};
}

export function itemHasPanel(item) {
  return hasPanel(item, blocksFor(item));
}

/**
 * What the pinned column shows.
 *
 * Not simply "the lane you are in": three of the rail's items are chrome pages with no panel
 * of their own, and letting the column empty itself on the way to Settings would collapse a
 * 280px column and shove the page sideways for as long as you were there. So the pinned
 * column keeps the last lane that had something to show, and a route into a lane with a panel
 * moves it.
 */
function pinTarget() {
  return stickyItem;
}

function effectiveItem() {
  if (hoverItem) return hoverItem;
  return pinned ? pinTarget() : null;
}

// ------------------------------------------------------------------------------ the panel

/** One row: a real link, so route()'s active pass and the AARS dirty-guard both reach it. */
function panelRow(label, route, params, icon) {
  const row = el(
    "a",
    {
      class: "nav-link",
      href: buildHash(route, params),
      target: "_self", // index.html sets <base target="_top"> for the GAS sandbox
    },
    icon
      ? iconSpan(icon)
      : el("span", { class: "nav-icon nav-icon-blank", "aria-hidden": "true" }),
    el("span", { class: "nav-label" }, label),
  );
  return row;
}

function iconSpan(svg) {
  const s = el("span", { class: "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

let pinBtn = null;

function pinButton() {
  pinBtn = el("button", {
    class: "nav-flyout-pin",
    type: "button",
    onclick: () => {
      // Pinning from a hovered panel keeps THAT panel: the click is a statement about the
      // thing under the pointer, and reverting to the route's lane would answer a question
      // nobody asked.
      if (!pinned && hoverItem) stickyItem = hoverItem;
      setPinned(!pinned);
    },
  });
  syncPinButton();
  return pinBtn;
}

/**
 * The pin's own state, PATCHED rather than repainted.
 *
 * The panel cannot be rebuilt from inside a click on one of its own buttons: the node under
 * the pointer is destroyed mid-click, focus falls to <body>, and the focusout half of the
 * dismissal contract closes the thing you were using. queryPalette.js carries the same scar
 * and the same rule — build once, move state.
 */
function syncPinButton() {
  if (!pinBtn) return;
  pinBtn.setAttribute("aria-pressed", String(pinned));
  pinBtn.setAttribute("aria-label", pinned ? "Unpin the panel" : "Keep the panel open");
  pinBtn.replaceChildren(uiIcon(pinned ? "undock" : "dock", 15));
}

/** Rebuild the panel's contents for `item`. Called only when what it shows changes. */
function paintPanel(item) {
  pinBtn = null;
  hostEl.replaceChildren();
  hostEl.setAttribute("aria-label", item.label);
  hostEl.append(
    el("div", { class: "nav-flyout-head" },
      el("h2", { class: "nav-flyout-title" }, item.label),
      pinButton()),
  );
  const body = el("div", { class: "nav-flyout-body" });
  for (const page of item.pages) {
    body.append(panelRow(page.title, page.key, {}, ROUTE_ICONS[page.key]));
  }
  for (const block of blocksFor(item)) {
    body.append(el("h3", { class: "nav-group" }, block.label));
    for (const row of block.rows) {
      body.append(panelRow(row.label, row.route, row.params, row.icon ? ROUTE_ICONS[row.icon] : null));
    }
  }
  hostEl.append(body);
  markActive(hostEl);
}

/**
 * Mark the row for the current route, the way route() does for the rail.
 *
 * route() already runs this pass over every `.nav-link` on every navigation — this repeats it
 * for a panel painted BETWEEN navigations, which is most of them.
 */
function markActive(scope) {
  const here = location.hash.replace(/\?.*$/, "").replace(/^#\/?/, "") || defaultRoute();
  scope.querySelectorAll(".nav-link").forEach((a) => {
    const isActive = a.getAttribute("href") === `#/${here}`;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

// --------------------------------------------------------------------------- open / close

let shownItem = null;

function show(item) {
  if (!hostEl) return;
  if (shownItem !== item) {
    refreshCtx();
    paintPanel(item);
    shownItem = item;
  }
  hostEl.hidden = false;
  // PORTALS.JS IS HOW THIS APP'S OVERLAYS TELL EACH OTHER THEY EXIST, and a panel full of
  // links is exactly what it is for. Without it the graph page's own Escape handler — which
  // stands down only for `portalsOpen()` — answers the same keystroke as this panel and
  // throws focus back into the query card. Counted once: show() runs on every repaint.
  if (!counted) { portalOpened(); counted = true; }
  // One frame between "in the DOM" and "open", or the transition has nothing to run from.
  requestAnimationFrame(() => { if (!hostEl.hidden) hostEl.classList.add("open"); });
  syncRailState();
  wireDismiss();
}

function hide() {
  if (!hostEl) return;
  if (counted) { portalClosed(); counted = false; }
  hostEl.hidden = true;
  hostEl.classList.remove("open");
  shownItem = null;
  releaseDismiss();
  syncRailState();
}

/** The panel is only dismissible while it is floating; pinned, it is furniture. */
function wireDismiss() {
  releaseDismiss();
  if (pinned && !hoverItem) return;
  release = popoverDismiss({
    pop: hostEl,
    anchor: null, // a full-height column has no anchor rect to fall out of the viewport
    isInside: (node) => !!node && !!node.closest
      && (hostEl.contains(node) || !!node.closest(".rail-item")),
    close: () => closeNow(),
    onEscape: () => closeNow({ restoreFocus: true }),
    onReposition: null,
    hosts: [hostEl],
  });
}

function releaseDismiss() {
  if (release) { release(); release = null; }
}

/** Reflect the open panel back onto the rail item that owns it. */
function syncRailState() {
  const open = effectiveItem();
  document.querySelectorAll(".rail-item").forEach((node) => {
    const isOpen = !!open && node.getAttribute("data-nav-item") === open.id;
    node.classList.toggle("open", isOpen);
    // On the link, because the link is the trigger — there is no caret beside it to carry
    // this, and an item with no panel carries no aria-expanded at all rather than a
    // permanent "false" promising a panel that does not exist.
    const link = node.querySelector(".rail-link");
    if (link && link.hasAttribute("aria-haspopup")) {
      link.setAttribute("aria-expanded", String(isOpen));
    }
  });
}

/**
 * Open for `item`, after the delay the tip already argued for: 220ms cold so crossing the rail
 * on the way somewhere else opens nothing, and instantly inside the warm window so moving
 * between lanes is one gesture rather than four waits. Focus never waits at all.
 */
export function openFlyoutFor(item, anchor, opts) {
  if (!hostEl || !itemHasPanel(item)) return;
  window.clearTimeout(closeTimer);
  closeTimer = 0;
  if (hoverItem === item) return;
  const viaFocus = !!(opts && opts.viaFocus);
  const delay = tipDelay({ viaFocus, sinceLastClose: Date.now() - lastCloseAt });
  window.clearTimeout(openTimer);
  const run = () => {
    hoverItem = item;
    hoverAnchor = anchor || null;
    if (itemHasPanel(item)) stickyItem = item;
    show(item);
  };
  if (!delay) run();
  else openTimer = window.setTimeout(run, delay);
}

/** Leaving the rail or the panel: a grace period, because the pointer has dead space to cross. */
function scheduleFlyoutClose() {
  window.clearTimeout(openTimer);
  openTimer = 0;
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => closeNow(), CLOSE_GRACE);
}

export function closeNow(opts) {
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
  openTimer = 0;
  closeTimer = 0;
  const anchor = hoverAnchor;
  const wasOpen = !!hoverItem;
  hoverItem = null;
  hoverAnchor = null;
  if (wasOpen) lastCloseAt = Date.now();
  const item = effectiveItem();
  if (item) show(item); else hide();
  if (opts && opts.restoreFocus && anchor) {
    const link = anchor.querySelector(".nav-link") || anchor;
    link.focus();
  }
}

function isFlyoutOpen() {
  return !!hostEl && !hostEl.hidden;
}

// ---------------------------------------------------------------------------------- pin

export function setPinned(v) {
  const wasShowing = effectiveItem();
  pinned = !!v;
  savePinned(pinned);
  applyPinned();
  syncPinButton();
  // Unpinning does not yank the panel out from under the pointer that just clicked the
  // control: it becomes the hovered panel it would have been, and leaves when the pointer
  // does. Anything else punishes a reader for changing their mind.
  if (!pinned && !hoverItem && wasShowing) {
    hoverItem = wasShowing;
    hoverAnchor = document.querySelector(`.rail-item[data-nav-item="${wasShowing.id}"]`);
  }
  const item = effectiveItem();
  if (item) show(item); else hide();
}

/**
 * The left edge, in one place.
 *
 * `--rail-w` goes on meaning what it has always meant — how much chrome is on the left — so
 * `.route-overlay { left: var(--rail-w) }` keeps working with no change at all. The rail's own
 * track is `--rail-icon-w` now, because that is the part that never moves.
 */
function applyPinned() {
  if (hostEl) hostEl.classList.toggle("pinned", pinned);
  const root = document.documentElement;
  if (pinned) {
    root.style.setProperty("--rail-w", "calc(var(--rail-icon-w) + var(--nav-flyout-w))");
  } else {
    root.style.removeProperty("--rail-w");
  }
}

// ------------------------------------------------------------------------------- wiring

/**
 * Hand the panel its host and its pointer wiring. Called once per boot, since boot() builds a
 * fresh shell; the listeners go with the node.
 */
export function mountNavFlyout(host) {
  hostEl = host;
  shownItem = null;
  hostEl.hidden = true;
  hostEl.classList.remove("open");
  // The pointer has to cross the gap between rail and panel without the panel going out from
  // under it — the reason CLOSE_GRACE exists, and the same pair tip.js puts on its card.
  hostEl.addEventListener("pointerenter", () => {
    window.clearTimeout(closeTimer);
    closeTimer = 0;
  });
  hostEl.addEventListener("pointerleave", () => {
    if (hoverItem) scheduleFlyoutClose();
  });
  hostEl.addEventListener("keydown", onPanelKey);
  applyPinned();
}

/** Arrow keys walk the panel; Escape hands focus back to the rail item that opened it. */
function onPanelKey(e) {
  if (e.key === "Escape") { closeNow({ restoreFocus: true }); return; }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp"
    && e.key !== "Home" && e.key !== "End") return;
  const rows = [...hostEl.querySelectorAll(".nav-link")];
  if (!rows.length) return;
  const at = rows.indexOf(document.activeElement);
  let next = 0;
  if (e.key === "Home") next = 0;
  else if (e.key === "End") next = rows.length - 1;
  else if (e.key === "ArrowDown") next = at < 0 ? 0 : Math.min(at + 1, rows.length - 1);
  else next = at < 0 ? rows.length - 1 : Math.max(at - 1, 0);
  rows[next].focus();
  e.preventDefault();
}

/**
 * The rail's side of it, delegated from the rail element itself.
 *
 * pointerover/pointerout rather than enter/leave because only the first pair bubbles, which is
 * the same reason tip.js delegates the way it does — and delegation is required here for a
 * second reason: renderSidebar() rebuilds every rail item on refresh, so a listener held on
 * one would not survive the next sync.
 */
export function wireRail(sidebar, itemsFor) {
  sidebar.addEventListener("pointerover", (e) => {
    if (coarse()) return; // a tap does this work where there is no hover
    const node = e.target.closest && e.target.closest(".rail-item");
    if (!node) return;
    const item = itemsFor(node.getAttribute("data-nav-item"));
    if (!item) return;
    if (!itemHasPanel(item)) { scheduleFlyoutClose(); return; }
    openFlyoutFor(item, node);
  });
  sidebar.addEventListener("pointerout", (e) => {
    const node = e.target.closest && e.target.closest(".rail-item");
    if (!node) return;
    // Moving within one item, or onto its own caret, is not leaving it.
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".rail-item") === node) return;
    if (hoverItem) scheduleFlyoutClose();
  });
}

export function setNavContext(provider) {
  ctxProvider = typeof provider === "function" ? provider : null;
  refreshCtx();
  // The blocks may have gained or lost rows, so what is on screen is stale by definition.
  shownItem = null;
  const item = effectiveItem();
  if (item && isFlyoutOpen()) show(item);
}

/** Called by route(): the pinned column follows you into a lane that has one. */
export function setActiveItem(item) {
  if (item && itemHasPanel(item)) stickyItem = item;
  else if (!stickyItem) stickyItem = null;
  if (pinned && !hoverItem) {
    const target = pinTarget();
    if (target) show(target); else hide();
  }
  if (hostEl && !hostEl.hidden) markActive(hostEl);
  syncRailState();
}

/** Move focus onto the panel's first row — what ArrowRight and the caret both promise. */
export function focusFirstRow() {
  if (!hostEl || hostEl.hidden) return;
  const first = hostEl.querySelector(".nav-link");
  if (first) first.focus();
}

/** A tap on a coarse pointer: first opens the panel, second follows the link. */
export function tapOpensPanel(item, node) {
  if (!coarse() || !itemHasPanel(item)) return false;
  if (hoverItem === item) return false; // already open — let the link through
  hoverItem = item;
  hoverAnchor = node;
  stickyItem = item;
  show(item);
  return true;
}
