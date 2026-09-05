// Wiz SIDEKICK AI SPA shell: app header, sidebar navigation, sync zone, hash router.
//
// THE HEADER CARRIES IDENTITY AND SCOPE, and nothing else. The reference screen puts a
// search box, notification icons and an avatar along the same bar; none of those has
// anything behind it here, and a control with nothing behind it is the one thing this app's
// chrome is careful never to offer (see ui/projectScope.js). The sync controls stay in the
// rail, where they have always been and where the last-sync caption can afford its words.

import { configureApp } from "../../../../gas_shared/appConfig.js";
import { call } from "../../../../gas_shared/api.js";
import { renderSyncCard, openSyncDetails } from "./syncProgress.js";
import {
  bootstrap, bootstrapCached, buildHash, defaultRoute, invalidateBootstrap,
  invalidateRpcCache, parseHash,
} from "../../../../gas_shared/store.js";
import { onExperimentalChange, showExperimental } from "./experimental.js";
import {
  clear, closeTip, el, fmtDateTime, progressBar, runPageTeardown, statusPill, tipAnchor,
} from "./ui.js";
import { brandMark } from "../../../../gas_shared/ui/brandMark.js";
import { projectScopeView, scopeChrome, scopeKinds } from "./ui/projectScope.js";
import { scopeControl } from "../../../../gas_shared/ui/scopeControl.js";
import { scopePayload } from "../../../../gas_shared/ui/scopeModel.js";
import { toast } from "./ui.js";
import { renderGraphPage } from "./pages/graph.js";
import { renderInventory } from "./pages/inventory.js";
import { renderProblems } from "./pages/problems.js";
import { renderCombos } from "./pages/combos.js";
import { renderConfigFindings } from "./pages/config.js";
import { renderCompliance } from "./pages/compliance.js";
import { renderAarsRules } from "./pages/aars.js";
import { renderScans } from "./pages/scans.js";
import { renderData } from "./pages/data.js";
import { renderSettings } from "./pages/settings.js";
import { renderHelp } from "./pages/help.js";
import { LANE_ICONS, ROUTE_ICONS } from "./routeIcons.js";
import { itemForRoute, railItems } from "./navModel.js";
import {
  focusFirstRow, itemHasPanel, mountNavFlyout, openFlyoutFor, setActiveItem, setNavContext,
  tapOpensPanel, wireRail,
} from "./navFlyout.js";
import { SAVED_VIEW_KEYS, readSavedViews } from "./savedViews.js";
import { findEntry } from "./helpContent.js";

// ============================================================================ the manifest
//
// WHAT THIS APP IS, handed to the shared core (gas_shared/appConfig.js) before anything
// else in this module body runs.
//
// The shared modules cannot reach sideways into an app: `gas_shared/ui/tip.js` has no
// `../helpContent.js` to import and `gas_shared/store.js` cannot know which route is this
// register's front door. Those answers travel as data instead. `configureApp()` is
// DELIBERATELY THE FIRST STATEMENT of the module body — imports run before it, but no
// shared module reads the manifest at import time (see appConfig.js's rule 2), so the first
// read of it can only happen after this line.
const MANIFEST = {
  // ONE SPELLING, and it used to be two. The shell said "Wiz SIDEKICK AI" in three places
  // (splash label, appbar wordmark, document.title) while the mark's own doc comment and
  // src/server/pageShell.ts spelled it in prose; the caps were a leftover from the PoC
  // header, not a wordmark rule — nothing sets text-transform on .appbar-name. The manifest
  // is now the only place the product is named, so the surfaces cannot drift again.
  productName: "Wiz Sidekick AI",
  // What the boot splash says it is opening. This register's front door IS a graph — the
  // asset graph every page is a lens on — so unlike the DevSecOps sibling, the inherited
  // noun is the right one here.
  openingNoun: "graph",
  // Trailing dot included. Two sidekicks served from the same origin must not share a key.
  storagePrefix: "sidekickai.",
  // The `problems` key of PAGES below, and the only place the two can disagree — which is
  // what test/shared.test.js's navGroups contract checks. It is not the FIRST key here
  // (`graph` is): this register's front door was moved to Priorities on purpose, and the
  // map no longer decides it by position.
  defaultRoute: "problems",
  // This register's own vocabulary. gas_shared/ui/tip.js asks; helpContent.js answers.
  findHelpEntry: findEntry,
};
configureApp(MANIFEST);

// The rail's information architecture, stated once.
//
// THREE LANES, A GATE AND A TAIL. Every page in this app is a security page, so "Security"
// as a heading distinguished nothing while holding six of them; what a reader actually
// chooses between is the landscape (what we have), the risk in it (what is open, and what
// to do first) and what we can state about it (how we score, and where the figures came
// from). Those are the three labelled lanes. `Labs` is the gate. The tail — `group: null` —
// is chrome, separated by a rule and never labelled.
//
// Two rules renderSidebar depends on, both held by test/shared.test.js:
//   * A LABELLED LANE EARNS ITS HEADING BY HOLDING TWO PAGES. `Labs` is the one exception,
//     because there the heading IS the statement — it says the page sits outside the
//     security workflow rather than beside it — and it is drawn only when the gate is open.
//   * LANES ARE CONTIGUOUS. The lastGroup detector below emits a fresh heading every time
//     the value changes, so a lane split in two would quietly draw its heading twice.
//
// THREE FLAGS, THREE DIFFERENT QUESTIONS, and they compose:
//   `hidden`        keeps a route off the nav while leaving it routable. NOTHING CARRIES IT
//                   TODAY — the whole register is on the rail — but the flag stays supported
//                   because the PoC cut that introduced it (seven routes off the nav, so a
//                   demo could show that the minimal model needs no graph) is one line per
//                   route to reinstate. It was a flag rather than seven deletions in the
//                   first place because helpContent.js points at these routes about sixty
//                   times and helpContent.test.js asserts every one resolves; a hidden route
//                   still resolves, still renders if someone types its hash, and costs
//                   nothing. The landing route stayed at Priorities when the seven came
//                   back: the front door is its own decision, and the queue is a defensible
//                   front door whatever else is on the rail.
//   `experimental`  gates a route behind Settings → Show experimental content, for everyone.
//   `group`         which lane it sits in, which is about arrangement and not availability.
// A lane the first two empty out never reaches the rail, and a lane left holding ONE visible
// page is drawn as that page rather than as a lane — see navModel.js, which is where the
// three meet. Both of those are why hiding routes degrades the rail gracefully instead of
// leaving lane headings standing over nothing.
const PAGES = {
  // fullBleed: the page owns the whole content pane (no main padding/max-width).
  graph: { title: "Security Graph", group: "Landscape", render: renderGraphPage, fullBleed: true },
  inventory: { title: "AI Inventory", group: "Landscape", render: renderInventory },
  // Phase 7: issues UNION findings, ranked together across the whole landscape — neither
  // `combos` (one toxic-combination pattern) nor `config` (findings only) can answer
  // "what do I work on Monday". It opens the Risk lane for that reason: it is the page an
  // analyst lives in, and the two under it are lenses on subsets of what it ranks. It is
  // also this branch's front door — MANIFEST.defaultRoute names it.
  problems: { title: "Priorities", group: "Risk", render: renderProblems },
  combos: { title: "Toxic Combinations", group: "Risk", render: renderCombos },
  config: { title: "Cloud Configuration", group: "Risk", render: renderConfigFindings },
  // Stays directly under Cloud Configuration — the two are the same subject at two grains,
  // what is failing and what that scores against — and the lane boundary between them is the
  // claim rather than a separation: one register is worked, the other is stated.
  compliance: { title: "Compliance Posture", group: "Assurance", render: renderCompliance },
  // Assurance, not the lone "Coverage" heading this used to carry. One page under one
  // heading was a line of furniture; and this page answers the question Compliance Posture
  // answers, one step further back — "where did this figure come from" beside "how do we
  // score" — which is the same reader on the same errand.
  scans: { title: "Wiz Scans", group: "Assurance", render: renderScans },
  // "Scoring Models", not "AARS Rules": this page has hosted three models since the Problem
  // and Posture tabs landed, and it is now the ONLY consumer of all three — the title is
  // the boundary as much as the name. Deliberately not "Risk Models": this codebase is
  // careful that these are not risk scores (the glossary says so in as many words), and
  // bare "Models" would collide with the MODEL node kind the graph draws.
  //
  // The route key stays `aars`. Every hash link, ROUTE_ICONS entry and helpContent
  // `route`/`drawnOn` value keys on it, and renaming the key would break shared links to
  // buy nothing a reader can see.
  //
  // Group "Labs", not "Scoring": the rail itself should say these sit outside the security
  // workflow rather than beside it.
  //
  // `experimental: true`, and deliberately NOT `hidden`: the two flags answer different
  // questions. Gated, never removed — the key stays in this map so shared `#/aars` links
  // keep working for anyone who has asked for them, and so helpContent's "routes only to
  // pages that exist" guard still has a page to point at.
  // ONE LINE, and it has to stay one line: the shared navGroups contract reads this table
  // as TEXT (app.js touches `document` at module scope, so importing it would drag the whole
  // SPA into a node test) and its parser takes `title`/`group` off the same line as the key.
  // Wrapped across three lines, this entry parsed as a route with no title and no lane.
  aars: { title: "Scoring Models", group: "Labs", render: renderAarsRules, fullBleed: true, experimental: true },
  // The tail: chrome, not a lane. A rule separates it and nothing labels it — "Data" under
  // a heading reading DATA, and "Help" under HELP, were two lines that restated the link
  // beneath them, and "Preferences" over "Settings" was the same line in a synonym.
  data: { title: "Data", group: null, render: renderData },
  settings: { title: "Settings", group: null, render: renderSettings },
  // Last on purpose. MANIFEST.defaultRoute names the front door, and this map no longer
  // decides it by position — which is what made the old coupling worth stating and then
  // worth retiring: the fallback said "problems" while route() still said graph.
  help: { title: "Help", group: null, render: renderHelp },
};

// Nav icons (ROUTE_ICONS, LANE_ICONS) now live in routeIcons.js — see that module for why.
// Circular-arrows glyph for the primary "Sync now" button; on the icon rail it is the icon
// alone (its .btn-label is hidden there by CSS).
const SYNC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 0-13.7-5L4 8.5"/><path d="M4 4.5v4h4"/><path d="M4 12.5a8 8 0 0 0 13.7 5L20 15.5"/><path d="M20 19.5v-4h-4"/></svg>';

// A span carrying an inline SVG (el() builds HTML nodes, so SVG goes in via innerHTML).
function iconSpan(svg, cls) {
  const s = el("span", { class: cls || "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

// Below this width the rail is not a rail at all — it becomes a wrapping top bar, where a
// panel has nowhere to fly out to and a 76px icon column would be a column of one. So the nav
// has two shapes, and this is the switch between them: the icon rail plus its panel above
// 800px, and the plain stacked list (lane headings as words, one rule above the chrome tail)
// below it. The query is the one queryPalette.js already makes for the same reason — it
// renders into a sheet instead of a popover at exactly this width.
const NARROW_NAV = "(max-width: 800px)";
function narrowNav() {
  return !!(window.matchMedia && window.matchMedia(NARROW_NAV).matches);
}

const app = document.getElementById("app");
let mainEl = null;
// Held past boot() so the rail can be redrawn on its own. Flipping "show experimental
// content" changes which pages the rail lists and nothing else — a full refresh() would
// re-fetch the whole bootstrap payload to answer a question already settled locally.
let sidebarEl = null;

// The Settings toggle reaches the rail through here rather than by importing app.js, which
// would close the app.js → pages/settings.js import into a cycle. No re-route: the toggle
// lives on Settings, so the page being hidden is never the page you are on.
onExperimentalChange(() => {
  if (!sidebarEl) return;
  renderSidebar(sidebarEl, bootstrapCached());
});

// Route-reload overlay: veils the content pane (not the sidebar) with a progress bar
// while the active page refetches. Shown only if the load outlasts a short delay, so
// cached switches never flash; a sequence guard keeps it up across rapid changes.
let routeOverlay = null;
let routeSeq = 0;
let routeLoadingTimer = null;
const ROUTE_LOADING_DELAY_MS = 120;
// The first page render after each boot is covered by the boot splash → page skeleton, so it
// skips the route-overlay veil; every subsequent navigation uses the veil as normal.
let firstRoute = true;

function beginRouteLoading() {
  clearTimeout(routeLoadingTimer);
  routeLoadingTimer = setTimeout(() => {
    if (!routeOverlay) return;
    routeOverlay.classList.add("visible");
    const label = routeOverlay.querySelector(".route-overlay-label");
    if (label) label.textContent = "Updating…";
  }, ROUTE_LOADING_DELAY_MS);
}

function endRouteLoading() {
  clearTimeout(routeLoadingTimer);
  if (!routeOverlay) return;
  routeOverlay.classList.remove("visible");
  const label = routeOverlay.querySelector(".route-overlay-label");
  if (label) label.textContent = "";
}

let jobPoller = null;
let syncCardHost = null;
let syncButtonsRow = null;
let stoppingJobId = null;
let lastJob = null;
let syncDetails = null; // open sync-details drawer handle, kept live by the poller

// Recreate the branded boot splash index.html paints on first load, so refresh() (which
// re-runs boot()) shows the same veil. Keep this markup in sync with the static copy in
// index.html. Reuses the indeterminate progress bar so it reads as the same loader family
// as the route-overlay (and inherits its reduced-motion striped fallback).
function bootSplash() {
  const bar = progressBar(null);
  bar.classList.add("boot-splash-bar");
  bar.setAttribute("aria-label", "Opening the " + MANIFEST.openingNoun);
  return el(
    "div",
    { class: "boot-splash", role: "status", "aria-live": "polite" },
    el("div", { class: "boot-splash-inner" },
      el("div", { class: "boot-brand" },
        brandMark(112),
        el("span", { class: "boot-brand-label" }, MANIFEST.productName)),
      bar,
      el("p", { class: "boot-splash-note" }, "Opening the " + MANIFEST.openingNoun + "…")),
  );
}

// Fade the splash out and remove it. transitionend removes it; a timeout is the fallback if
// that never fires. Under reduced motion there's no fade, so remove immediately.
function hideBootSplash() {
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

async function boot() {
  firstRoute = true;
  // Keep the splash index.html painted (first load) or recreate it (refresh) and remove only
  // the *previous* app underneath it — so a refresh never flashes a cleared pane. clear(app)
  // is deliberately avoided here: the splash must survive to cover the rebuild.
  let splash = app.querySelector(".boot-splash");
  if (!splash) { splash = bootSplash(); app.append(splash); }
  for (const node of [...app.children]) if (node !== splash) node.remove();

  const appbar = el("header", { class: "appbar" });
  const sidebar = el("nav", { class: "sidebar", "aria-label": "Main navigation" });
  sidebarEl = sidebar;
  mainEl = el("main", { id: "main" });
  routeOverlay = el(
    "div",
    { class: "route-overlay", role: "status", "aria-live": "polite" },
    el("div", { class: "route-overlay-bar", "aria-hidden": "true" },
      el("div", { class: "route-overlay-fill" })),
    el("span", { class: "route-overlay-label" }),
  );
  // The nav panel is a sibling of the rail rather than a child of it: .sidebar is
  // overflow-y:auto and would clip it, and .app-body is already the positioning context the
  // route overlay uses. Unpinned it floats over the content pane; pinned it is an in-flow
  // column and `main` shrinks beside it.
  const flyout = el("nav", { class: "nav-flyout", "aria-label": "Section pages" });
  // The overlay is a child of the BODY row, not of `app`: it veils the content pane while a
  // page refetches, and the header above it has to stay live — the rail already does, by
  // sitting outside the overlay's box.
  app.append(appbar, el("div", { class: "app-body" }, sidebar, flyout, mainEl, routeOverlay));
  mountNavFlyout(flyout);
  setNavContext(navContext);
  wireRail(sidebar, (id) => currentRailItems().filter((i) => i.id === id)[0] || null);

  let data;
  try {
    data = await bootstrap();
  } catch (e) {
    // A denied user normally never reaches this file at all — doGet's own access.deniedPage()
    // stops them before the SPA bundle ships. This branch is for the narrower case where
    // access is REVOKED (removed from ALLOWED_USERS, or the property flipped) while a tab is
    // already open: the next RPC's forbidden envelope surfaces here as err.kind (api.js), and
    // "Couldn't reach the server / Retry" would be actively misleading — retrying re-sends the
    // same identity and can only fail the same way.
    const card = e && e.kind === "forbidden"
      ? el("div", { class: "empty" },
          el("div", {}, "You don't have access to this app."),
          el("div", { class: "small", style: "margin:6px 0 4px" }, String(e.message || e)),
          // Same offer as the denied page doGet serves, so the two surfaces a locked-out
          // person can land on say the same thing. The href is built server-side (access.ts)
          // so the prefilled subject exists once rather than in both bundles.
          e.contact
            ? el("div", { class: "small", style: "margin:0 0 14px" },
                "If you think you should have access, contact ",
                el("a", { href: e.contactUrl || ("mailto:" + e.contact) }, e.contact),
                ".")
            : null,
        )
      : el("div", { class: "empty" },
          el("div", {}, "Couldn't reach the server."),
          el("div", { class: "small", style: "margin:6px 0 14px" }, String(e.message || e)),
          el("button", { class: "primary", onclick: () => refresh() }, "Retry"),
        );
    clear(mainEl).append(card);
    renderAppbar(appbar, null);
    renderSidebar(sidebar, null);
    hideBootSplash(); // reveal the error card
    return;
  }
  renderAppbar(appbar, data);
  renderSidebar(sidebar, data);
  route(); // paints the page's skeleton synchronously up to its first data await
  // Fade the splash only after the skeleton has laid out — double rAF flushes the (cached)
  // bootstrap microtasks and one layout tick, so the splash reveals the skeleton, never a blank pane.
  requestAnimationFrame(() => requestAnimationFrame(hideBootSplash));
}

/**
 * The bar across the top: whose product this is, and which register it is showing.
 *
 * Rebuilt wholesale like the rail is, and from the same payload — `pickProjectScope` ends in
 * a `refresh()`, so the switcher's own label and caption are re-derived rather than patched.
 *
 * @param {HTMLElement} appbar
 * @param {object|null} data  the bootstrap payload, or null when boot failed
 */
function renderAppbar(appbar, data) {
  clear(appbar);
  // Decorative, because the name is right there beside it in text and never hidden — the
  // shell's other mark (the splash) is decorative for the same reason. The rail used to hold
  // a labelled copy for its 56px width, where the mark was the only identity on screen; the
  // rail carries no mark at all now, so nothing in this file names the product twice.
  appbar.append(
    brandMark(22, { compact: true }),
    el("span", { class: "appbar-name" }, MANIFEST.productName),
  );
  // Null when there is no register to slice — including the boot-failure path, where offering
  // a picker over data we could not fetch would be a control with nothing behind it. The rule
  // goes with it: a separator with one side missing separates nothing.
  // The control is `gas_shared/ui/scopeControl.js`; `ui/projectScope.js` says what this
  // register's two dimensions are. `scopePayload` turns the picked option value straight into
  // the `api_setSettings` argument — `{projectView}` or `{domainView}` — so the prefix stays
  // the control's own and nothing below the seam learned a new encoding.
  const kinds = scopeKinds(data);
  const chrome = scopeChrome(data);
  const scopeSwitch = scopeControl(
    projectScopeView(data),
    { ...chrome, kinds },
    (value) => pickProjectScope(scopePayload(kinds, chrome, value)),
  );
  if (scopeSwitch) {
    appbar.append(el("span", { class: "appbar-sep", "aria-hidden": "true" }), scopeSwitch);
  }
}

/**
 * A lane heading.
 *
 * An h2 rather than a div, and the label inside a span rather than loose in it, for the
 * same reason: the collapsed rail is the DEFAULT, and it used to `display: none` these
 * outright — so the one state most readers see had no grouping in it at all, on screen or
 * in the accessibility tree. Collapsed, the span is what goes (clipped, not removed) and the
 * h2 itself draws as the hairline between two icon clusters. The heading stays announced and
 * navigable in every state; only its pixels change.
 */
function navGroupHeading(label) {
  return el("h2", { class: "nav-group" }, el("span", { class: "nav-group-label" }, label));
}

// The chrome tail's separator. Data, Settings and Help name themselves, so the tail is
// marked rather than labelled — presentational, because it says nothing a reader could not
// see, and the pages under it are already three ordinary links.
function navRule() {
  return el("div", { class: "nav-rule", role: "presentation" });
}

/**
 * One rail item: a link that navigates, and — where the item has a panel — the trigger that
 * opens it.
 *
 * ONE CONTROL, and no caret beside it. The rail carried a disclosure button for a while and
 * it earned its place at 12px on a 76px item: a second target crowding a label, drawing a
 * mark on the chrome that the panel it opens draws again as a heading. What it was for
 * survives without it — `aria-haspopup` and `aria-expanded` say a panel is there and whether
 * it is open, ArrowRight opens it and lands focus inside, Escape closes it and hands focus
 * back — so the announcement and the keyboard path are unchanged and only the pixels are
 * gone. Enter still navigates, because this is still a link: the panel is a way in, never the
 * only one.
 */
function railItem(item) {
  const icon = item.kind === "lane" ? LANE_ICONS[item.id] : ROUTE_ICONS[item.route];
  const node = el("div", { class: "rail-item", "data-nav-item": item.id });
  const link = el(
    "a",
    {
      class: "nav-link rail-link",
      href: `#/${item.route}`,
      // index.html sets <base target="_top"> so external links escape the GAS
      // sandbox iframe; _self keeps hash routing in-frame.
      target: "_self",
      // Only where there is one. A rail item that announced a popup it does not have would
      // send a screen-reader user hunting for a panel that never opens.
      "aria-haspopup": itemHasPanel(item) ? "true" : null,
      "aria-expanded": itemHasPanel(item) ? "false" : null,
      onclick: (e) => {
        // Where there is no hover there is no flyout, so the first tap has to do the
        // revealing — the same bargain tip.js strikes with its cards.
        if (tapOpensPanel(item, node)) e.preventDefault();
      },
      onkeydown: (e) => {
        if (e.key !== "ArrowRight" || !itemHasPanel(item)) return;
        e.preventDefault();
        openFlyoutFor(item, node, { viaFocus: true });
        focusFirstRow();
      },
    },
    iconSpan(icon),
    el("span", { class: "nav-label" }, item.label),
  );
  node.append(link);
  return node;
}

/** The two-tier rail: one item per lane, then a rule, then the chrome pages. */
function renderRail(sidebar, items) {
  let ruled = false;
  for (const item of items) {
    // The tail is chrome rather than a lane, and the rule is what says so — the same rule the
    // stacked list draws, for the same reason. Keyed on `lane`, never on `kind`: a lane left
    // holding one visible page is drawn AS that page, so kind alone would put the rule in
    // front of the first collapsed lane instead of in front of the chrome.
    if (item.lane === null && !ruled) { sidebar.append(navRule()); ruled = true; }
    sidebar.append(railItem(item));
  }
}

/**
 * The stacked list, for the top-bar layout below 800px: every page, lane headings as words,
 * one rule above the chrome tail. This is the rail as it shipped before the panel existed,
 * and it stays because at that width it is still the right answer.
 */
function renderStackedNav(sidebar) {
  const { route: active } = parseHash();
  // `undefined`, not null: null is a real group — the unlabelled chrome tail — and a detector
  // seeded with it would start the list inside that tail and never draw its rule.
  let lastGroup;
  for (const [key, page] of Object.entries(PAGES)) {
    // Hidden routes still resolve and still render — they are only off the nav. See the
    // PAGES header for why this branch is a flag rather than seven deletions.
    if (page.hidden) continue;
    // A gated page is absent, not disabled: the rest of this list is the security workflow,
    // and a greyed-out row inside it would still be telling every reader that a model they
    // cannot open exists. The "Labs" heading goes with it for free — the lastGroup detector
    // only emits a header when a page that is actually being drawn changes group.
    if (page.experimental && !showExperimental()) continue;
    if (page.group !== lastGroup) {
      sidebar.append(page.group ? navGroupHeading(page.group) : navRule());
      lastGroup = page.group;
    }
    sidebar.append(
      el(
        "a",
        {
          class: `nav-link${key === active ? " active" : ""}`,
          href: `#/${key}`,
          target: "_self",
          "aria-current": key === active ? "page" : null,
        },
        iconSpan(ROUTE_ICONS[key]),
        el("span", { class: "nav-label" }, page.title),
      ),
    );
  }
}

function renderSidebar(sidebar, data) {
  clear(sidebar);
  if (narrowNav()) renderStackedNav(sidebar);
  else renderRail(sidebar, currentRailItems());

  // Sync zone
  const zone = el("div", { class: "scan-zone" });
  const runBtn = el("button", { class: "primary", onclick: () => startSync(runBtn) },
    iconSpan(SYNC_ICON), el("span", { class: "btn-label" }, "Sync now"));
  syncButtonsRow = el("div", { class: "scan-buttons" }, runBtn);
  syncCardHost = el("div", {});
  zone.append(syncCardHost, syncButtonsRow);
  if (data) {
    zone.append(
      el("div", { class: "scan-caption" },
        data.hasCredentials
          ? statusPill("ok", "Credentials loaded")
          : statusPill("neutral", "Dry-run (no credentials)"),
      ),
      // Compact stand-in for the pill above, shown only while the rail is collapsed (the
      // captions are hidden then) so the credentials/dry-run state stays glanceable.
      tipAnchor(el("span", {
        class: `rail-status-dot ${data.hasCredentials ? "ok" : "neutral"}`,
        "aria-hidden": "true",
      }), data.hasCredentials ? "Credentials loaded" : "Dry-run (no credentials)"),
    );
    if (data.latestSync) {
      const ts = data.latestSync.finished_at;
      const age = Math.floor((Date.now() - Date.parse(ts)) / 86400000);
      zone.append(
        el("div", { class: "scan-caption" },
          `Last sync ${fmtDateTime(ts)}` + (age >= 2 ? ` — ${age} days ago` : ""),
        ),
      );
    } else {
      zone.append(el("div", { class: "scan-caption" }, "No sync saved yet."));
    }
    if (data.activeJob) {
      paintCard(data.activeJob);
      watchJob(data.activeJob.job_id);
    }
  }
  sidebar.append(zone);
  // The rail is rebuilt wholesale on every refresh() and on every experimental-flag change,
  // so the panel's marks on it — which item is open, which lane holds the current page — have
  // to be re-stamped onto the new nodes each time. The panel's own state survives in
  // navFlyout.js, which is why it is held there rather than on a rail item.
  setActiveItem(itemForRoute(currentRailItems(), parseHash().route));
}

/** The rail's items for the gate as it stands right now. */
function currentRailItems() {
  return railItems(PAGES, { experimental: showExperimental() });
}

/**
 * What the nav panel has to list, gathered from what the shell already holds.
 *
 * A function rather than a snapshot: `comboLegend` is settled once per boot, but the saved
 * views are written by the reader mid-session, and a panel that only learned about them on
 * the next full reload would be a menu that forgets what you just told it. Nothing here
 * fetches — hovering a rail item costs a localStorage read and an object walk, never a round
 * trip.
 */
function navContext() {
  const data = bootstrapCached();
  const savedViews = [];
  for (const route of ["graph", "inventory"]) {
    for (const v of readSavedViews(SAVED_VIEW_KEYS[route]) || []) {
      savedViews.push({ name: v.name, route, params: v.params || {} });
    }
  }
  return { savedViews, combos: (data && data.comboLegend) || [] };
}

/**
 * Server-side, not a client filter. The scope has to hold for every payload the pages
 * read — including the ones computed server-side from the whole register — so it is stored
 * and applied at the read boundary, and the client's job is to invalidate what it cached
 * under the old scope. `refresh()` is that seam: it clears the bootstrap AND the RPC cache
 * before re-booting, which is exactly what a population change invalidates. Filtering in
 * the client instead would leave every server-computed count answering for the old scope.
 */
let scopeSwitchInFlight = false;
async function pickProjectScope(pick) {
  // The rail is rebuilt by refresh(), so a second pick mid-flight would race a control
  // that is about to be replaced underneath it.
  if (scopeSwitchInFlight) return;
  scopeSwitchInFlight = true;
  try {
    // ONE FIELD, NEVER BOTH. The two settings clear each other server-side (settingsLogic's
    // withProjectView / withDomainView), so sending both would leave which one survived to
    // the order the setter happened to run them in.
    //
    // `pick` IS THAT OBJECT ALREADY, built by the chosen kind's own `payload(id)` in
    // ui/projectScope.js rather than composed here from a `{kind, value}` pair — which is what
    // makes "one field" structural: there is no branch left that could emit two.
    // The registerScopeContract block in test/shared.test.js pins both objects against what
    // the deleted control produced.
    await call("api_setSettings", pick);
    await refresh();
  } catch (e) {
    toast(`Couldn't change project scope: ${e.message || e}`);
  } finally {
    scopeSwitchInFlight = false;
  }
}

async function startSync(btn) {
  btn.disabled = true;
  try {
    const res = await call("api_runSync", {});
    toast(res.message);
    if (res.jobId) {
      stoppingJobId = null;
      watchJob(res.jobId);
    } else {
      refresh();
    }
  } catch (e) {
    toast(String(e.message || e), "error");
  } finally {
    btn.disabled = false;
  }
}

function paintCard(job) {
  if (!syncCardHost) return;
  lastJob = job;
  const stopping = stoppingJobId === job.job_id && job.phase !== "CANCELLED";
  renderSyncCard(syncCardHost, job, {
    // Read lastJob at click time, not the job captured when this Details button was built —
    // renderSyncCard reuses the button across polls, so a captured job would be stale and the
    // drawer would flash 0 rows/query 1 for one tick before the poller updates it.
    onDetails: () => {
      syncDetails = openSyncDetails(lastJob, { onStop: () => requestStop(lastJob.job_id) });
    },
    onStop: stopping ? null : () => requestStop(job.job_id),
    stopping,
  });
  // Keep an open details drawer in step with the poll — otherwise its values freeze at open time.
  if (syncDetails) syncDetails.update(job);
  if (syncButtonsRow) syncButtonsRow.style.display = "none";
}

function clearCard() {
  syncDetails = null; // drop the stale drawer handle once the card is gone
  if (syncCardHost) clear(syncCardHost);
  if (syncButtonsRow) syncButtonsRow.style.display = "";
}

async function requestStop(jobId) {
  stoppingJobId = jobId;
  if (lastJob && lastJob.job_id === jobId) paintCard(lastJob);
  try {
    const res = await call("api_cancelSync", { jobId });
    toast(res.message || "Stopping sync…");
  } catch (e) {
    stoppingJobId = null;
    toast(String(e.message || e), "error");
  }
}

function watchJob(jobId) {
  if (jobPoller) clearInterval(jobPoller);
  jobPoller = setInterval(async () => {
    try {
      const job = await call("api_getJobStatus", { jobId });
      if (!job) {
        stopWatch();
        clearCard();
        return;
      }
      if (job.phase === "DONE") {
        stopWatch();
        if (syncDetails) syncDetails.update(job); // let an open drawer settle on "Complete"
        toast("Sync complete.");
        refresh();
      } else if (job.phase === "CANCELLED") {
        stopWatch();
        stoppingJobId = null;
        if (syncDetails) syncDetails.update(job); // an open drawer settles on "Cancelled"
        toast("Sync stopped.");
        refresh();
      } else if (job.phase === "FAILED") {
        stopWatch();
        paintCard(job);
        if (syncButtonsRow) syncButtonsRow.style.display = "";
        toast(job.error || "Sync failed.", "error");
      } else {
        paintCard(job);
      }
    } catch {
      /* transient poll errors are fine */
    }
  }, 3000);
}

function stopWatch() {
  if (jobPoller) clearInterval(jobPoller);
  jobPoller = null;
}

export async function refresh() {
  invalidateBootstrap();
  invalidateRpcCache();
  await boot();
}

async function route() {
  // Every route render takes a ticket, and `routeSeq` is the only thing that says which
  // render is current. It used to be consulted in exactly ONE place — the `endRouteLoading`
  // call in the `finally` below — so it gated the loading veil and nothing else, while the
  // awaited `page.render` beneath it ran to completion whatever the reader did next. Pages
  // that hold their own request tickets (graph.js, inventory.js) were protected by those;
  // every other page could resolve an RPC after the next route had already cleared `mainEl`
  // and append into the live DOM of the page that replaced it. See the two checks below.
  const seq = ++routeSeq;
  const parsed = parseHash();
  // RESOLVE ONCE, then use the resolved key for everything. An unknown path (a stale link, a
  // typo) lands on the front door rather than on whatever page this line happened to name
  // when it was written — see MANIFEST.defaultRoute above. The nav highlight used to key off
  // the RAW path, so an unresolved hash rendered a page while marking no nav item current.
  let key = PAGES[parsed.route] ? parsed.route : defaultRoute();
  let params = parsed.params;
  // A gated route is a link the reader followed in good faith, so unlike the fallback above
  // this one REWRITES the hash: leaving `#/aars` in the address bar over a different page
  // with no nav item current is three answers to "where am I", two of them wrong.
  if (PAGES[key] && PAGES[key].experimental && !showExperimental()) {
    key = defaultRoute();
    params = {};
    history.replaceState(null, "", buildHash(key, params));
  }
  const page = PAGES[key];
  document.title = `${page.title} — ${MANIFEST.productName}`;
  document.querySelectorAll(".nav-link").forEach((a) => {
    const isActive = a.getAttribute("href") === `#/${key}`;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  // The rail's own pass, which the one above cannot do: a lane is marked while you are on ANY
  // of its pages, and its link points at only one of them. It is deliberately a different
  // mark and NOT aria-current — a lane that merely contains the page you are on is not itself
  // the page, and saying so would put two "you are here" answers in one nav.
  const here = itemForRoute(currentRailItems(), key);
  document.querySelectorAll(".rail-item").forEach((node) => {
    node.classList.toggle("current", !!here && node.getAttribute("data-nav-item") === here.id);
  });
  setActiveItem(here);
  // Before the DOM goes: cancel the outgoing page's pending work, so a debounced
  // callback cannot fire into a page that no longer exists.
  runPageTeardown();
  // The hover card is portaled to <body>, so it is the one piece of UI a page teardown does
  // not reach on its own. A definition left hanging over the next page would be explaining
  // something that is no longer on screen.
  closeTip();
  // A FRESH <main> PER ROUTE, rather than clearing the one that is there.
  //
  // Clearing removed the outgoing page's nodes but left the ELEMENT, and every page is handed
  // that element to append into. So a render that had not finished — one still awaiting an
  // RPC — went on appending into the very node the next page was now using. Demonstrated in
  // the browser under `?slow=1200` by entering Data and leaving before its two RPCs resolve:
  // Priorities came back 2,106 -> 2,659 characters carrying Data's whole Maintenance section,
  // "Reset synced data" and "Prune to project" included. A destructive control painted onto a
  // page that does not own it.
  //
  // Replacing the element instead means the outgoing render keeps a reference to a DETACHED
  // <main>: its late appends still happen and simply land nowhere, which is what a superseded
  // render's output should do. Nothing else has to change, because no page uses this argument
  // for anything but `append` — checked across all eleven.
  //
  // Replaced rather than wrapped in a container, and that is not cosmetic: `main.full-bleed`
  // is `display: flex` and `main.full-bleed > .empty` is a direct-child selector, so a wrapper
  // would break the graph workbench's layout and its empty state. A new element with the same
  // tag and id keeps every rule, including the `#main` focus target sheet.js restores to.
  const stale = mainEl;
  mainEl = el("main", { id: "main" });
  mainEl.classList.toggle("full-bleed", !!page.fullBleed);
  stale.replaceWith(mainEl);
  // The first render after a boot is covered by the boot splash → page skeleton, so it skips
  // the veil to avoid stacking two loaders; later navigations use it as normal.
  const useOverlay = !firstRoute;
  if (useOverlay) beginRouteLoading();
  try {
    await page.render(mainEl, params, { refresh });
  } catch (e) {
    // GUARDED, like the paint below it. A rejection from a route the reader has already
    // left would otherwise replace the page they are now looking at with this message —
    // the failure is real but it belongs to a render whose DOM was cleared long ago.
    if (seq !== routeSeq) return;
    mainEl.classList.remove("full-bleed"); // error states get normal padding back
    clear(mainEl).append(
      el("div", { class: "empty" },
        el("div", {}, "This page failed to load."),
        el("div", { class: "small", style: "margin-top:6px" }, String(e.message || e)),
      ),
    );
  } finally {
    if (useOverlay && seq === routeSeq) endRouteLoading();
    firstRoute = false;
  }
}

window.addEventListener("hashchange", route);
boot();
