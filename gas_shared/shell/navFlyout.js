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
// WHAT IT DOES REUSE is the dismissal contract (`popoverDismiss`: outside pointerdown AND
// click, Escape with stopPropagation, focusout, one release()) and the hover physiology the
// tip already settled: 220ms cold, nothing at all inside the warm window, and a close grace
// long enough to cross the dead space between the rail and the panel. Two surfaces in one app
// that open on hover have to feel like one decision, and SC 1.4.13 is not optional on either.
//
// STATE LIVES HERE, not on the nodes. renderSidebar() clears and rebuilds the rail wholesale
// on every refresh() and on every experimental-flag change, so anything held on a rail item
// would be dropped mid-hover.
//
// PROMOTED FROM THREE COPIES, AND THE OLDEST ONE WAS NOT THE BASE. gas_ai's and
// gas_devsecops's were byte-identical and already built on `ui/dom.js`, `ui/popover.js`,
// `ui/portals.js`, `ui/tipPlace.js` and `ui/uiIcons.js`; gas's was a separate implementation
// that reimplemented `coarse()`, the 220/400/120 delay policy and the whole dismissal wiring
// locally — and never called portalOpened()/portalClosed(). The two siblings' version is the
// right structural base, so it is the one here.
//
// WHAT THE PORTAL COUNT IS ACTUALLY FOR HERE, MEASURED. The obvious reading — that gas's
// missing `portalOpened()` left `ui/sheet.js`'s Tab trap failing to stand down for the panel —
// is FALSE, and the browser says so: `openSheet` sets `inert` on `#app` (sheet.js), and this
// panel lives INSIDE `#app` by design (it is a column in `.app-body`, not a portaled popover),
// so with a sheet open a panel row cannot take focus at all. Probed in gas's dev harness: with
// the panel open and a sheet then opened, `row.focus()` leaves `document.activeElement` in the
// sheet. The trap's `!sheet.contains(at)` branch can therefore never see a panel row, and gas
// was not carrying the defect that reading predicts.
//
// The count IS load-bearing, for a different consumer: gas_ai's `pages/graph.js` stands its own
// Escape handler down on `portalsOpen()` (graph.js:726, :749), and without the handshake one
// Escape closes the panel AND throws focus back into the graph's query card. That is why it
// stays.
//
// AND IT HAS A COST WORTH WRITING DOWN, because `portalsOpen()` is one global number answering
// two different questions. A PINNED panel is counted for the whole session, and the sheet's Tab
// trap is `if (portalsOpen()) return;` — so with the panel pinned, a sheet's Tab no longer wraps
// from its last focusable back to its first. Measured, same harness: unpinned, Tab from the last
// control gives `defaultPrevented: true` and wraps; pinned, `false` and does not. `inert` still
// confines Tab to the sheet and its scrim, so what is lost is the wrap, not the containment.
// This is pre-existing in both siblings and gas now shares it. The fix is to split the one count
// into the two questions it is being asked, which belongs with `ui/sheet.js` rather than here.
//
// Two things gas's copy did BETTER travelled the other way and are here:
//   * markActive() resolves the current route through the shared `parseHash()`. The siblings
//     hand-rolled `location.hash.replace(/\?.*$/,"").replace(/^#\/?/,"") || defaultRoute()`,
//     a second parser for the one string store.js already owns.
//   * `panelBlocks` is asked for blocks and the empty ones are dropped — see navModel.js,
//     which is where that rule lives now.
//
// And two things the siblings carried that meant nothing are gone: an unused `LANE_ICONS`
// import, and `else if (!stickyItem) stickyItem = null;` in setActiveItem, which assigns null
// to a variable the branch has already established is falsy.

import { appConfig } from "../appConfig.js";
import { buildHash, parseHash } from "../store.js";
import { coarse, el } from "../ui/dom.js";
import { popoverDismiss } from "../ui/popover.js";
import { portalClosed, portalOpened } from "../ui/portals.js";
import { CLOSE_GRACE, tipDelay } from "../ui/tipPlace.js";
import { uiIcon } from "../ui/uiIcons.js";
import { hasPanel, panelBlocks } from "./navModel.js";

/**
 * The pin's stored preference.
 *
 * PREFIXED, AND IT USED NOT TO BE. All three apps carried `PIN_KEY = "sidebarCollapsed"`
 * verbatim, while `MANIFEST.storagePrefix`'s own comment says "Two sidekicks served from the
 * same origin must not share a key". A copy-pasted file getting that wrong is latent; a
 * SHARED module getting it wrong is where the collision actually starts, so the key is
 * composed from the manifest here.
 *
 * THE OLD UNPREFIXED VALUE IS ABANDONED, NOT MIGRATED, and that is a decision rather than an
 * oversight. Reading it forward once would look like continuity, but the value under
 * `sidebarCollapsed` was written by whichever of the three apps the reader last used — there
 * is no way to tell which — so importing it would carry one register's preference into
 * another and propagate the collision the prefix exists to end. The cost is that a reader who
 * had pinned the panel re-pins it once, which is one click; the old key is simply left unread
 * rather than deleted, because clearing a key three apps share is the same mistake again.
 *
 * Reads the same way round as the collapsed rail it inherited from: "0" was an explicitly
 * expanded rail, which is what a pinned panel now is. Its own try/catch, since a GAS iframe
 * sandbox can refuse web storage outright.
 */
function pinKey() {
  return appConfig().storagePrefix + "sidebarCollapsed";
}
function loadPinned() {
  try { return localStorage.getItem(pinKey()) === "0"; } catch { return false; }
}
function savePinned(v) {
  try { localStorage.setItem(pinKey(), v ? "0" : "1"); } catch { /* sandboxed */ }
}

let hostEl = null;          // the panel
let ctxProvider = null;     // what the shell holds, asked for rather than cached at boot
let ctx = {};               // its last answer — see refreshCtx()
// LAZY, because the manifest is not readable at import time (appConfig.js's rule 2): under
// esbuild's bundling order this module body runs BEFORE app.js's configureApp(). `null` is
// "not asked yet", which is why every read goes through isPinned().
let pinned = null;
let hoverItem = null;       // what the pointer/keyboard is asking for right now
let hoverAnchor = null;     // the rail item it came from, for focus restore
let stickyItem = null;      // what the PINNED column shows — see pinTarget()
let release = null;         // popoverDismiss teardown
let counted = false;        // whether this panel is currently counted as an open portal
let openTimer = 0;
let closeTimer = 0;
let lastCloseAt = 0;
let shownItem = null;
let pinBtn = null;

function isPinned() {
  if (pinned === null) pinned = loadPinned();
  return pinned;
}

/** Blocks for an item, resolved against whatever the shell currently holds. */
function blocksFor(item) {
  return panelBlocks(item, ctx, appConfig().panelBlocks);
}

/**
 * Re-ask the shell what it holds.
 *
 * Once per open rather than once per boot, because half of what a panel can list is written
 * by the reader while the app is running: save a view on the Inventory and it has to be in
 * the Landscape panel the next time that panel opens, not the next time the whole app
 * reloads. Not once per row, either — railItems() asks every item whether it has a panel, and
 * reading localStorage twice per item on every rail repaint is a cost with nothing behind it.
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
 * Not simply "the lane you are in": the rail's chrome-tail items are pages with no panel of
 * their own, and letting the column empty itself on the way to Settings would collapse a
 * 280px column and shove the page sideways for as long as you were there. So the pinned
 * column keeps the last lane that had something to show, and a route into a lane with a panel
 * moves it.
 */
function pinTarget() {
  return stickyItem;
}

function effectiveItem() {
  if (hoverItem) return hoverItem;
  return isPinned() ? pinTarget() : null;
}

// ------------------------------------------------------------------------------ the panel

function iconSpan(svg) {
  const s = el("span", { class: "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

/** One row: a real link, so route()'s active pass and any dirty-guard both reach it. */
function panelRow(label, route, params, icon) {
  return el(
    "a",
    {
      class: "nav-link",
      href: buildHash(route, params),
      // index.html sets <base target="_top"> so external links escape the GAS sandbox iframe.
      // Without an explicit _self, hash links inherit it and navigate the top window to the
      // sandbox's own googleusercontent URL — which, loaded bare, is a blank page.
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
      // Pinning from a hovered panel keeps THAT panel: the click is a statement about the
      // thing under the pointer, and reverting to the route's lane would answer a question
      // nobody asked.
      if (!isPinned() && hoverItem) stickyItem = hoverItem;
      setPinned(!isPinned());
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
 * dismissal contract closes the thing you were using. Build once, move state.
 *
 * `aria-label` and NO `title`. gas's copy set both; a native tooltip cannot be reached by
 * keyboard, does not exist on touch and arrives half a second late, which is exactly why
 * `ui/dom.js`'s `el()` throws on a `title` attribute — that copy only got away with it by
 * calling setAttribute directly. The accessible name is unchanged.
 */
function syncPinButton() {
  if (!pinBtn) return;
  const on = isPinned();
  pinBtn.setAttribute("aria-pressed", String(on));
  pinBtn.setAttribute("aria-label", on ? "Unpin the panel" : "Keep the panel open");
  pinBtn.replaceChildren(uiIcon(on ? "undock" : "dock", 15));
}

/** Rebuild the panel's contents for `item`. Called only when what it shows changes. */
function paintPanel(item) {
  const { ROUTE_ICONS } = appConfig();
  const marks = ROUTE_ICONS || {};
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
    body.append(panelRow(page.title, page.key, {}, marks[page.key]));
  }
  // Every block here already has rows — navModel.panelBlocks drops the empty ones, because an
  // empty heading says "you have none" where the truth is often "we could not ask".
  for (const block of blocksFor(item)) {
    body.append(el("h3", { class: "nav-group" }, block.label));
    for (const row of block.rows) {
      body.append(panelRow(row.label, row.route, row.params, row.icon ? marks[row.icon] : null));
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
 *
 * Through the shared `parseHash()`, which already resolves an empty hash to the manifest's
 * front door. Two of the three copies hand-rolled the same two regexes and an `||
 * defaultRoute()` beside it: a second parser for the one string store.js owns.
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
  // PORTALS.JS IS HOW THE OVERLAYS TELL EACH OTHER THEY EXIST. Its live consumer for this panel
  // is gas_ai's graph page, whose Escape handler stands down while a portal is open — see the
  // measured note in the header for what this does and, just as importantly, what it does not.
  // Counted once, because show() runs on every repaint.
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
  if (isPinned() && !hoverItem) return;
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
    // this, and an item with no panel carries no aria-expanded at all rather than a permanent
    // "false" promising a panel that does not exist.
    const link = node.querySelector(".rail-link");
    if (link && link.hasAttribute("aria-haspopup")) {
      link.setAttribute("aria-expanded", String(isOpen));
    }
  });
}

/**
 * Open for `item`, after the delay the tip already argued for: 220ms cold so crossing the
 * rail on the way somewhere else opens nothing, and instantly inside the warm window so
 * moving between lanes is one gesture rather than four waits. Focus never waits at all.
 *
 * `tipDelay` is the shared policy (`ui/tipPlace.js`). gas's copy had its own OPEN_COLD 220 /
 * WARM_WINDOW 400 / CLOSE_GRACE 120 constants beside the same arithmetic, which is three
 * numbers that had to agree with the hover card's by hand.
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

/** Leaving the rail or the panel: a grace period, because the pointer has dead space to
 *  cross. That grace is WCAG 2.1 SC 1.4.13's "hoverable" requirement, not a preference — a
 *  zero-grace close makes the panel unreachable by pointer. */
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
 * `.route-overlay { left: var(--rail-w) }` keeps working with no change at all. The rail's
 * own track is `--rail-icon-w`, because that is the part that never moves.
 */
function applyPinned() {
  const on = isPinned();
  if (hostEl) hostEl.classList.toggle("pinned", on);
  const root = document.documentElement;
  if (on) {
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
 * pointerover/pointerout rather than enter/leave because only the first pair bubbles, which
 * is the same reason tip.js delegates the way it does — and delegation is required here for a
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
  if (isPinned() && !hoverItem) {
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
