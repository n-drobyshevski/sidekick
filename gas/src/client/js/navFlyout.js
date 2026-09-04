// The nav panel: the second tier of the rail, listing what lives under the item you are
// pointing at.
//
// IT IS A COLUMN, NOT A POPUP. It runs the full height of the body row at a fixed width and a
// fixed left edge, so there is no placement problem to solve — no viewport collision, no flip,
// no measurement. That is why it is not portaled to <body> the way filterCombobox's popover
// is: it lives in .app-body (already the positioning context for the route overlay), at a
// z-index above that overlay — a panel open while a page refetches must stay readable and
// clickable — and below the scrim, so a finding sheet still covers it.
//
// THE HOVER PHYSIOLOGY IS NOT NEGOTIABLE. 220ms cold so crossing the rail on the way somewhere
// else opens nothing, instant inside the warm window so moving between lanes is one gesture
// rather than four waits, and a close grace long enough for the pointer to cross the dead space
// between the rail and the panel. That last one is WCAG 2.1 SC 1.4.13's "hoverable"
// requirement, not a preference: a zero-grace close makes the panel unreachable by pointer.
//
// STATE LIVES HERE, not on the nodes. renderSidebar() clears and rebuilds the rail wholesale on
// every refresh(), so anything held on a rail item would be dropped mid-hover.

import { hasPanel, panelBlocks } from "./navModel.js";
import { ROUTE_ICONS } from "./routeIcons.js";
import { buildHash, parseHash } from "../../../../gas_shared/store.js";
import { el } from "./ui.js";
import { uiIcon } from "./uiIcons.js";

/**
 * Cold open delay, and the window after a close in which the next one opens instantly.
 * Scanning the rail is one gesture, not four, and re-serving the cold delay on each would read
 * as the interface lagging.
 */
const OPEN_COLD = 220;
const WARM_WINDOW = 400;
/** The grace between leaving the rail and the panel closing — SC 1.4.13, see the header. */
const CLOSE_GRACE = 120;

// The pinned preference rides the key the collapsed rail used to own, and reads the same way
// round: "0" was an explicitly expanded rail, which is what a pinned panel now is. A reader who
// had widened the rail keeps a wide left edge across the change rather than being reset to the
// default by a rename. Own try/catch, since a GAS iframe sandbox can refuse web storage.
const PIN_KEY = "sidebarCollapsed";
function loadPinned() {
  try { return localStorage.getItem(PIN_KEY) === "0"; } catch { return false; }
}
function savePinned(v) {
  try { localStorage.setItem(PIN_KEY, v ? "0" : "1"); } catch { /* sandboxed */ }
}

/** Where there is no hover, a tap has to do the revealing — see tapOpensPanel(). */
function coarse() {
  return !!(window.matchMedia && window.matchMedia("(hover: none)").matches);
}

let hostEl = null;          // the panel
let ctxProvider = null;     // what the shell holds, asked for rather than cached at boot
let ctx = {};               // its last answer — see refreshCtx()
let pinned = loadPinned();
let hoverItem = null;       // what the pointer/keyboard is asking for right now
let hoverAnchor = null;     // the rail item it came from, for focus restore
let stickyItem = null;      // what the PINNED column shows — see pinTarget()
let release = null;         // dismissal teardown
let openTimer = 0;
let closeTimer = 0;
let lastCloseAt = 0;
let shownItem = null;
let pinBtn = null;

/** Blocks for an item, resolved against whatever the shell currently holds. */
function blocksFor(item) {
  return panelBlocks(item, ctx);
}

/**
 * Re-ask the shell what it holds.
 *
 * Once per open rather than once per boot, because a panel's blocks can be written while the
 * app is running. Not once per row either — railItems() asks every item whether it has a panel,
 * and re-reading the shell's state on every rail repaint is a cost with nothing behind it.
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
 * Not simply "the lane you are in": two of the rail's items are pages with no panel of their
 * own, and letting the column empty itself on the way to Settings would collapse a 280px column
 * and shove the page sideways for as long as you were there. So the pinned column keeps the
 * last lane that had something to show, and a route into a lane with a panel moves it.
 */
function pinTarget() {
  return stickyItem;
}

function effectiveItem() {
  if (hoverItem) return hoverItem;
  return pinned ? pinTarget() : null;
}

// ------------------------------------------------------------------------------ the panel

function iconSpan(svg) {
  const s = el("span", { class: "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

/** One row: a real link, so route()'s active pass reaches it like any other nav link. */
function panelRow(label, route, params, icon) {
  return el(
    "a",
    {
      class: "nav-link",
      href: buildHash(route, params),
      // index.html sets <base target="_top"> so external links escape the GAS sandbox iframe.
      // Without an explicit _self, hash links inherit it and navigate the top window to the
      // sandbox's own URL, which loaded bare is a blank page.
      target: "_self",
    },
    icon
      ? iconSpan(icon)
      : el("span", { class: "nav-icon nav-icon-blank", "aria-hidden": "true" }),
    el("span", { class: "nav-label" }, label),
  );
}

function pinButton() {
  pinBtn = el("button", {
    class: "nav-flyout-pin",
    type: "button",
    onclick: () => {
      // Pinning from a hovered panel keeps THAT panel: the click is a statement about the thing
      // under the pointer, and reverting to the route's lane would answer a question nobody
      // asked.
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
 * The panel cannot be rebuilt from inside a click on one of its own buttons: the node under the
 * pointer is destroyed mid-click, focus falls to <body>, and the focusout half of the dismissal
 * contract closes the thing you were using. Build once, move state.
 */
function syncPinButton() {
  if (!pinBtn) return;
  pinBtn.setAttribute("aria-pressed", String(pinned));
  pinBtn.setAttribute("aria-label", pinned ? "Unpin the panel" : "Keep the panel open");
  pinBtn.setAttribute("title", pinned ? "Unpin the panel" : "Keep the panel open");
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
  // A block with no rows is omitted rather than drawn empty — an empty heading would say "you
  // have none" where the truth is "we could not ask". panelBlocks() returns none today; see the
  // note there for which candidates were rejected and why.
  for (const block of blocksFor(item)) {
    if (!block.rows.length) continue;
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
  const here = parseHash().route;
  scope.querySelectorAll(".nav-link").forEach((a) => {
    const isActive = a.getAttribute("href") === `#/${here}`;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

// --------------------------------------------------------------------------- open / close

function show(item) {
  if (!hostEl) return;
  if (shownItem !== item) {
    refreshCtx();
    paintPanel(item);
    shownItem = item;
  }
  hostEl.hidden = false;
  // One frame between "in the DOM" and "open", or the transition has nothing to run from.
  requestAnimationFrame(() => { if (!hostEl.hidden) hostEl.classList.add("open"); });
  syncRailState();
  wireDismiss();
}

function hide() {
  if (!hostEl) return;
  hostEl.hidden = true;
  hostEl.classList.remove("open");
  shownItem = null;
  releaseDismiss();
  syncRailState();
}

/**
 * The dismissal contract: outside pointerdown AND click, Escape, focus leaving the panel.
 *
 * pointerdown as well as click because a drag that ends outside the window never delivers the
 * click that would otherwise dismiss this. Escape calls stopPropagation so one keystroke does
 * not also close a sheet underneath — the reader meant the panel.
 *
 * The panel is only dismissible while it is FLOATING. Pinned, it is furniture: an outside click
 * is just a click on the page beside it.
 */
function wireDismiss() {
  releaseDismiss();
  if (pinned && !hoverItem) return;
  const isInside = (node) => !!node && !!node.closest
    && (hostEl.contains(node) || !!node.closest(".rail-item"));
  const onDocPointer = (e) => { if (!isInside(e.target)) closeNow(); };
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    closeNow({ restoreFocus: true });
  };
  const onFocusOut = (e) => { if (!isInside(e.relatedTarget)) closeNow(); };
  document.addEventListener("pointerdown", onDocPointer, true);
  document.addEventListener("click", onDocPointer, true);
  document.addEventListener("keydown", onKey, true);
  hostEl.addEventListener("focusout", onFocusOut);
  release = () => {
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("click", onDocPointer, true);
    document.removeEventListener("keydown", onKey, true);
    hostEl.removeEventListener("focusout", onFocusOut);
  };
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
    // On the link, because the link is the trigger — there is no caret beside it to carry this,
    // and an item with no panel carries no aria-expanded at all rather than a permanent "false"
    // promising a panel that does not exist.
    const link = node.querySelector(".rail-link");
    if (link && link.hasAttribute("aria-haspopup")) {
      link.setAttribute("aria-expanded", String(isOpen));
    }
  });
}

/** The delay a given open earns. Focus never waits at all. */
function openDelay(viaFocus) {
  if (viaFocus) return 0;
  if (Date.now() - lastCloseAt <= WARM_WINDOW) return 0;
  return OPEN_COLD;
}

export function openFlyoutFor(item, anchor, opts) {
  if (!hostEl || !itemHasPanel(item)) return;
  window.clearTimeout(closeTimer);
  closeTimer = 0;
  if (hoverItem === item) return;
  const delay = openDelay(!!(opts && opts.viaFocus));
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
  // Unpinning does not yank the panel out from under the pointer that just clicked the control:
  // it becomes the hovered panel it would have been, and leaves when the pointer does. Anything
  // else punishes a reader for changing their mind.
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
  // under it — the reason CLOSE_GRACE exists.
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
 * pointerover/pointerout rather than enter/leave because only the first pair bubbles — and
 * delegation is required here for a second reason: renderSidebar() rebuilds every rail item on
 * refresh, so a listener held on one would not survive the next scan.
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
    // Moving within one item is not leaving it.
    if (e.relatedTarget && e.relatedTarget.closest
      && e.relatedTarget.closest(".rail-item") === node) return;
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
  if (pinned && !hoverItem) {
    const target = pinTarget();
    if (target) show(target); else hide();
  }
  if (hostEl && !hostEl.hidden) markActive(hostEl);
  syncRailState();
}

/** Move focus onto the panel's first row — what ArrowRight promises. */
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
