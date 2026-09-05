// The SPA shell: boot, the chrome around the page, and the hash router.
//
// This is the third of three near-identical copies, merged. What is left in each app.js is
// the part that genuinely differs — the manifest, PAGES, its scope family, its whole
// scan/sync battery, and what its nav panel lists — handed over as the spec below.
//
// FOUR REAL FIXES TRAVELLED IN THE MERGE, and two of them went the unusual direction (from
// gas, the OLDEST fork, into the two newer ones). Each is marked at its site:
//
//   1. route() dismisses BOTH portaled surfaces (`closeTip` and `closeCombobox`).  gas → all
//   2. A boot failure is `errorState` (role="alert"), not a `.empty` div.          gas → all
//   3. `<main>` is REPLACED per route rather than cleared in place.         siblings → gas
//   4. A page render that throws is `errorState` with a retry, not a `.empty` div. gas → all
//
// A fifth was expected and is NOT one: the nav flyout's `portalOpened()` handshake, which gas
// alone lacked. Measured in the harness, it fixes nothing for gas and costs something small —
// see the header of shell/navFlyout.js for the two numbers.
//
// WHAT IS DELIBERATELY NOT HERE. The scan/sync zone is not one thing with three vocabularies:
// the endpoints differ (`api_runScan`/`api_cancelScan` against `api_runSync`/`api_cancelSync`),
// the state machines differ (gas_devsecops resumes an active job and puts Stop behind a
// confirm; gas has a Quick-refresh button with a caveat and a credentials dot), and the
// progress modules differ. Likewise the scope control: three arities across two persistence
// models. Both arrive as app-supplied nodes through `railFooter` and `appbarScope`.

import { appConfig } from "../appConfig.js";
import {
  bootstrap, bootstrapCached, buildHash, defaultRoute, invalidateBootstrap, invalidateRpcCache,
  parseHash,
} from "../store.js";
import { clear, el } from "../ui/dom.js";
import { errorState } from "../ui/feedback.js";
import { closeCombobox } from "../ui/combobox.js";
import { closeTip } from "../ui/tip.js";
import { runPageTeardown } from "../ui/timing.js";
import { bootSplash, hideBootSplash } from "./bootSplash.js";
import { onExperimentalChange, showExperimental } from "./experimental.js";
import { renderAppbar } from "./appbar.js";
import { itemForRoute, railItems } from "./navModel.js";
import { renderNav } from "./navRail.js";
import {
  mountNavFlyout, setActiveItem, setNavContext, wireRail,
} from "./navFlyout.js";
import { beginRouteLoading, endRouteLoading, mountRouteOverlay } from "./routeOverlay.js";

/**
 * @typedef {object} ShellSpec
 * @property {object}   pages          the app's PAGES route table — the ONE IA list
 * @property {object}   [routeAliases] old route keys → current ones. Applied before the
 *                                     defaultRoute fallback and REWRITTEN into the address
 *                                     bar; only gas has any.
 * @property {(data: object|null) => (Node|null)} [appbarScope]
 *                                     the scope control for the current payload, or null
 * @property {(data: object|null) => (Node|null)} [railFooter]
 *                                     the scan/sync zone under the nav, or null
 * @property {() => object}  [navContext]  what the nav panel's blocks are built from
 * @property {() => object}  [pageContext] extra fields merged into every page.render's third
 *                                     argument (gas passes its two client-side scopes and
 *                                     two callbacks; the siblings pass nothing)
 */

/**
 * Build the shell for this app. Called once, at the bottom of app.js.
 *
 * Returns the handful of things app.js still drives: `boot` and `route` for the trailer,
 * `refresh` for the pages, and `renderChrome` for a scope pick that changes only the header.
 *
 * @param {ShellSpec} spec
 */
export function createAppShell(spec) {
  const pages = spec.pages;
  const aliases = spec.routeAliases || {};

  const app = document.getElementById("app");
  let mainEl = null;
  let appbarEl = null;
  let sidebarEl = null;
  let routeSeq = 0;
  // The first page render after each boot is covered by the boot splash → page skeleton, so
  // it skips the route-overlay veil; every subsequent navigation uses the veil as normal.
  let firstRoute = true;

  /** The rail's items for the gate as it stands right now. Recomputed rather than cached —
   *  it is a walk over a dozen entries, and a cached copy is a second list that could
   *  disagree with PAGES. */
  function currentRailItems() {
    return railItems(pages, { experimental: showExperimental() });
  }

  function renderChrome(data) {
    renderAppbar(appbarEl, spec.appbarScope ? spec.appbarScope(data) : null);
  }

  function renderSidebar(data) {
    if (!sidebarEl) return;
    renderNav(sidebarEl, pages, currentRailItems(), showExperimental());
    const footer = spec.railFooter ? spec.railFooter(data) : null;
    if (footer) sidebarEl.append(footer);
    // The rail is rebuilt wholesale on every refresh() and on every experimental-flag change,
    // so the panel's marks on it — which item is open, which lane holds the current page —
    // have to be re-stamped onto the new nodes each time. The panel's own state survives in
    // navFlyout.js, which is why it is held there rather than on a rail item.
    setActiveItem(itemForRoute(currentRailItems(), parseHash().route));
  }

  // The Settings toggle reaches the rail through here rather than by importing app.js, which
  // would close the app.js → pages/settings.js import into a cycle. No re-route: the toggle
  // lives on Settings, so the page being hidden is never the page you are on. Registered for
  // every app; in one with no gated page it can only ever redraw the same rail.
  onExperimentalChange(() => renderSidebar(bootstrapCached()));

  async function boot() {
    firstRoute = true;
    // Keep the splash the HTML painted (first load) or recreate it (refresh) and remove only
    // the *previous* app underneath it — so a refresh never flashes a cleared pane. clear(app)
    // is deliberately avoided here: the splash must survive to cover the rebuild.
    let splash = app.querySelector(".boot-splash");
    if (!splash) { splash = bootSplash(); app.append(splash); }
    for (const node of [...app.children]) if (node !== splash) node.remove();

    const appbar = el("header", { class: "appbar" });
    appbarEl = appbar;
    const sidebar = el("nav", { class: "sidebar", "aria-label": "Main navigation" });
    sidebarEl = sidebar;
    mainEl = el("main", { id: "main" });
    // Kept out of <main> so replacing <main> per route never takes it, and so it always
    // covers the pane regardless of scroll.
    const routeOverlay = mountRouteOverlay();
    // The nav panel is a SIBLING of the rail rather than a child of it: .sidebar is
    // overflow-y:auto and would clip it, and .app-body is already the positioning context the
    // route overlay uses. Unpinned it floats over the content pane; pinned it is an in-flow
    // column and `main` shrinks beside it.
    const flyout = el("nav", { class: "nav-flyout", "aria-label": "Section pages" });
    // The overlay is a child of the BODY row, not of `app`: it veils the content pane while a
    // page refetches, and the header above it has to stay live — the rail already does, by
    // sitting outside the overlay's box.
    app.append(appbar, el("div", { class: "app-body" }, sidebar, flyout, mainEl, routeOverlay));
    mountNavFlyout(flyout);
    setNavContext(spec.navContext || (() => ({})));
    wireRail(sidebar, (id) => currentRailItems().filter((i) => i.id === id)[0] || null);

    let data;
    try {
      data = await bootstrap();
    } catch (e) {
      // A denied user normally never reaches this file at all — doGet's own
      // access.deniedPage() stops them before the SPA bundle ships. This branch is for the
      // narrower case where access is REVOKED (removed from ALLOWED_USERS, or the property
      // flipped) while a tab is already open: the next RPC's forbidden envelope surfaces here
      // as err.kind (api.js), and "Couldn't reach the server / Retry" would be actively
      // misleading — retrying re-sends the same identity and can only fail the same way.
      //
      // FIX 2, AND IT TRAVELLED FROM THE OLDEST APP. BOTH BRANCHES ARE FAILURES, so both are
      // errorState — `role="alert"`, not the `role="status"` a bare `.empty` div carries. A
      // boot that could not reach the server, and an identity the server refuses, are defects
      // in the reader's session rather than states the register is legitimately in;
      // announcing them as calm news is the exact confusion ui/feedback.js was split to end.
      // gas_ai and gas_devsecops both still hand-rolled the `.empty` div here.
      let card;
      if (e && e.kind === "forbidden") {
        card = errorState("You don't have access to this app.", { detail: String(e.message || e) });
        // Same offer as the denied page doGet serves, so the two surfaces a locked-out person
        // can land on say the same thing. The href is built server-side (access.ts) so the
        // prefilled subject exists once rather than in both bundles. No retry: retrying
        // re-sends the same identity and can only fail the same way.
        if (e.contact) {
          card.append(el("div", { class: "small", style: "margin:8px 0 0" },
            "If you think you should have access, contact ",
            el("a", { href: e.contactUrl || ("mailto:" + e.contact) }, e.contact),
            "."));
        }
      } else {
        card = errorState("Couldn't reach the server.", {
          detail: String(e.message || e),
          onRetry: () => refresh(),
        });
      }
      clear(mainEl).append(card);
      renderChrome(null);
      renderSidebar(null);
      hideBootSplash(); // reveal the error card
      return;
    }
    renderChrome(data);
    renderSidebar(data);
    route(); // paints the page's skeleton synchronously up to its first data await
    // Fade the splash only after the skeleton has laid out — double rAF flushes the (cached)
    // bootstrap microtasks and one layout tick, so the splash reveals the skeleton, never a
    // blank pane.
    requestAnimationFrame(() => requestAnimationFrame(hideBootSplash));
  }

  async function refresh() {
    invalidateBootstrap();
    invalidateRpcCache();
    await boot();
  }

  /**
   * Resolve the hash to a route key, rewriting the address bar where the link the reader
   * followed is no longer the one they should keep.
   *
   * THREE OUTCOMES, and only two of them rewrite. An ALIAS is rewritten because a stale link
   * that silently renders a different page than the address bar names is three answers to
   * "where am I". A GATED route is rewritten for the same reason. An UNKNOWN path is not:
   * there is nothing to rewrite it to that the reader asked for, so it falls to the
   * manifest's front door and leaves the typo visible.
   */
  function resolveRoute(parsed) {
    let key = aliases[parsed.route] || parsed.route;
    let params = parsed.params;
    if (key !== parsed.route && pages[key]) {
      history.replaceState(null, "", buildHash(key, params));
    }
    if (!pages[key]) key = defaultRoute();
    if (pages[key].experimental && !showExperimental()) {
      key = defaultRoute();
      params = {};
      history.replaceState(null, "", buildHash(key, params));
    }
    return { key, params };
  }

  async function route() {
    // Every route render takes a ticket, and `routeSeq` is the only thing that says which
    // render is current. It gates the loading veil AND the failure paint below, so a
    // rejection from a route the reader has already left cannot replace the page they are now
    // looking at.
    const seq = ++routeSeq;
    const { key, params } = resolveRoute(parseHash());
    const page = pages[key];
    document.title = `${page.title} — ${appConfig().productName}`;
    // Active nav state — every link, wherever it is drawn: the stacked list, the icon rail
    // and the panel's rows are all `.nav-link`, and all three have to agree on where you are.
    document.querySelectorAll(".nav-link").forEach((a) => {
      const isActive = a.getAttribute("href") === `#/${key}`;
      a.classList.toggle("active", isActive);
      if (isActive) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    // The rail's own pass, which the one above cannot do: a lane is marked while you are on
    // ANY of its pages, and its link points at only one of them. Deliberately a different
    // mark and NOT aria-current — a lane that merely contains the page you are on is not
    // itself the page, and saying so would put two "you are here" answers in one nav.
    const here = itemForRoute(currentRailItems(), key);
    document.querySelectorAll(".rail-item").forEach((node) => {
      node.classList.toggle("current", !!here && node.getAttribute("data-nav-item") === here.id);
    });
    setActiveItem(here);
    // Before the DOM goes: cancel the outgoing page's pending work, so a debounced callback
    // cannot fire into a page that no longer exists.
    runPageTeardown();
    // FIX 1, AND IT TRAVELLED FROM THE OLDEST APP. THE TWO SURFACES A PAGE TEARDOWN CANNOT
    // REACH are both portaled to <body> and both sit above the route overlay on the merged z
    // scale, so either one left open floats over the veil explaining something that is no
    // longer on screen. The hover card has always been closed here. The COMBOBOX popover was
    // not, in gas_ai or gas_devsecops: it dismisses itself on a CLICKED navigation — its
    // dismissal is a capture-phase document click, and clicking a nav link is one — but not
    // on a hashchange with no click behind it: the back button, a typed URL, a programmatic
    // `location.hash =`. Measured in gas's dev harness: open the header scope switcher, set
    // location.hash, and the panel was still in the DOM over the next page. Both siblings
    // build their scope switcher on the same shared `filterCombobox`, so the defect was
    // structurally present in both.
    closeTip();
    closeCombobox();
    // FIX 3, TRAVELLING THE USUAL DIRECTION: A FRESH <main> PER ROUTE, rather than clearing
    // the one that is there.
    //
    // Clearing removed the outgoing page's nodes but left the ELEMENT, and every page is
    // handed that element to append into. So a render that had not finished — one still
    // awaiting an RPC — went on appending into the very node the next page was now using.
    // Demonstrated in gas_ai's browser harness under `?slow=1200` by entering Data and
    // leaving before its two RPCs resolve: Priorities came back 2,106 → 2,659 characters
    // carrying Data's whole Maintenance section, "Reset synced data" and "Prune to project"
    // included. A destructive control painted onto a page that does not own it. gas still
    // only did `clear(mainEl)`.
    //
    // Replacing the element instead means the outgoing render keeps a reference to a DETACHED
    // <main>: its late appends still happen and simply land nowhere, which is what a
    // superseded render's output should do. Nothing else has to change, because no page uses
    // this argument for anything but `append`.
    //
    // Replaced rather than wrapped in a container, and that is not cosmetic: `main.full-bleed`
    // is `display: flex` and `main.full-bleed > .empty` is a direct-child selector, so a
    // wrapper would break a full-bleed page's layout and its empty state. A new element with
    // the same tag and id keeps every rule, including the `#main` focus target sheet.js
    // restores to.
    const stale = mainEl;
    mainEl = el("main", { id: "main" });
    mainEl.classList.toggle("full-bleed", !!page.fullBleed);
    stale.replaceWith(mainEl);
    // The first render after a boot is covered by the boot splash → page skeleton, so it skips
    // the veil to avoid stacking two loaders; later navigations use it as normal.
    const useOverlay = !firstRoute;
    if (useOverlay) beginRouteLoading();
    try {
      await page.render(mainEl, params, {
        refresh,
        ...(spec.pageContext ? spec.pageContext() : null),
      });
    } catch (e) {
      // GUARDED. A rejection from a route the reader has already left belongs to a render
      // whose DOM was replaced long ago.
      if (seq !== routeSeq) return;
      // A render that THREW is a defect, not an absence: errorState announces it
      // (role="alert"), offers the retry in place, and demotes the exception into a
      // disclosure instead of printing it at the reader as body copy. Both siblings had this
      // as a bare `.empty` div with no role and no retry — the same defect as the boot
      // failure above, one layer down.
      mainEl.classList.remove("full-bleed"); // error states get normal padding back
      clear(mainEl).append(errorState("This page failed to load.", {
        detail: String(e.message || e),
        onRetry: () => route(),
      }));
    } finally {
      // Only the latest route settles the overlay; a newer change keeps it up.
      if (useOverlay && seq === routeSeq) endRouteLoading();
      firstRoute = false;
    }
  }

  return {
    boot,
    route,
    refresh,
    /** Re-derive the header alone, for a scope pick that changes nothing else. */
    renderChrome,
    /** Redraw the nav and its zone, for an app that changed what the rail should list. */
    renderSidebar,
    /** The rail items for the gate as it stands — what a page's own chrome may need. */
    railItems: currentRailItems,
  };
}
