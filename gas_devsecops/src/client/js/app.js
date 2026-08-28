// Wiz Sidekick DevSecOps SPA shell: app header, sidebar navigation, scan zone, hash router.
//
// THE HEADER CARRIES IDENTITY, and nothing else. The reference screen puts a search box,
// notification icons and an avatar along the same bar; none of those has anything behind it
// here, and a control with nothing behind it is the one thing this app's chrome is careful
// never to offer. The scan controls stay in the rail, where the last-scan caption can afford
// its words.
//
// THE SCAN ZONE IS A MEASUREMENT NOW. It used to draw a hardcoded grey dot reading
// "Collection not wired — Phase 2" and no button, which was honest while there was no
// battery and became a second surface disagreeing with Settings once there was. The state
// comes from `railStatus()` — credentials, per-scope freshness and the job in flight — and
// the button starts a real scan. See README.md.

import { call } from "./api.js";
import {
  DEFAULT_ROUTE, bootstrap, bootstrapCached, buildHash, invalidateBootstrap,
  invalidateRpcCache, parseHash,
} from "./store.js";
import { onExperimentalChange, showExperimental } from "./experimental.js";
import {
  clear, closeActiveSheet, closeTip, el, fmtDateTime, progressBar, runPageTeardown,
  statusPill, tipAnchor,
} from "./ui.js";
import { railStatus, withLabels } from "./railStatus.js";
import { openScanDetails, renderScanCard } from "./scanProgress.js";
import { brandMark } from "./ui/brandMark.js";
import { toast } from "./ui.js";
import { renderExecutive } from "./pages/executive.js";
import { renderMttr } from "./pages/mttr.js";
import { renderProgram } from "./pages/program.js";
import { renderSca } from "./pages/sca.js";
import { renderSast } from "./pages/sast.js";
import { renderSecrets } from "./pages/secrets.js";
import { renderRepos } from "./pages/repos.js";
import { renderHistory } from "./pages/history.js";
import { renderData } from "./pages/data.js";
import { renderSettings } from "./pages/settings.js";
import { LANE_ICONS, ROUTE_ICONS } from "./routeIcons.js";
import { itemForRoute, railItems } from "./navModel.js";
import {
  focusFirstRow, itemHasPanel, mountNavFlyout, openFlyoutFor, setActiveItem, setNavContext,
  tapOpensPanel, wireRail,
} from "./navFlyout.js";

// The rail's information architecture, stated once.
//
// THREE LANES AND A TAIL. Every page here is a security page, so "Security" as a heading
// would distinguish nothing. What a reader actually chooses between is: how the programme
// is doing (Program), what is actually in the register (Registers), and what has been
// stored about it (Data). The tail — `group: null` — is chrome, separated by a rule and
// never labelled.
//
// The first draft had four lanes, with Executive alone under an "Overview" heading.
// navModel collapses a lane of one to that page on the rail, so it looked fine there — but
// renderStackedNav below 800px draws the heading unconditionally, which would have put the
// word "Overview" directly above a single link reading "Executive". navGroups.test.js
// caught it. Executive belongs with the other two anyway: all three are programme-level
// reads over the whole population, and the registers below ARE that population.
//
// Two rules renderSidebar depends on, both held by test/navGroups.test.js:
//   * A LABELLED LANE EARNS ITS HEADING BY HOLDING TWO PAGES. A lane left holding one
//     visible page is drawn AS that page — see navModel.js.
//   * LANES ARE CONTIGUOUS. The lastGroup detector emits a fresh heading every time the
//     value changes, so a lane split in two would quietly draw its heading twice.
//
// THREE REGISTERS, THREE PAGES, and that is the composition decision worth defending.
// SAST, SCA and secrets are not one list under a filter: SAST keys on a rule at a file and
// line and is fixed by changing code; SCA keys on a CVE in a package and cannot be fixed at
// all until a fixed version exists; a secret is fixed by ROTATION, and a secret Wiz reports
// as resolved may still be live. One merged register would have to lie about at least two
// of them — and the MTTR clock differs across all three, which is the whole product.
//
// Two flags are supported and neither is used today:
//   `hidden`        keeps a route off the nav while leaving it routable.
//   `experimental`  gates a route behind Settings -> show experimental content.
// `group` is arrangement, not availability. A lane the flags empty out never reaches the
// rail — see navModel.js, which is where the three meet.
const PAGES = {
  // The front door, and DEFAULT_ROUTE in store.js names it. A leader opens the app wanting
  // one number; an analyst passes straight through to a register.
  executive: { title: "Executive", group: "Program", render: renderExecutive },

  // The product. Everything else on the rail exists to make these two legible and to let a
  // reader check them.
  mttr: { title: "MTTR & SLA", group: "Program", render: renderMttr },
  // "Coverage & efficiency", not "Program performance": it sits in a lane already called
  // Program, and the pair of figures IS the page — they are never published apart.
  program: { title: "Coverage & efficiency", group: "Program", render: renderProgram },

  // The three registers. Ordered by how much of the backlog they carry in this tenant —
  // one repository alone holds 6,894 SCA findings against 11,406 SAST findings across all
  // of them — and by which one a reader can actually act on soonest.
  sca: { title: "Dependencies", group: "Registers", render: renderSca },
  sast: { title: "Code", group: "Registers", render: renderSast },
  secrets: { title: "Secrets", group: "Registers", render: renderSecrets },

  // The estate and the record. `repos` is one page rather than gas/'s Attribution plus
  // brick/'s Estate: for a code register subscriptionName is always null, so there is no
  // second attribution dimension to separate out — ownership IS the repository, through the
  // projects[] hierarchy.
  repos: { title: "Repositories", group: "Data", render: renderRepos },
  history: { title: "Scan history", group: "Data", render: renderHistory },
  // "Storage", not "Data": the lane is already called Data, and gas/ shipping a Data page
  // inside a Data lane is a repetition worth not inheriting.
  data: { title: "Storage", group: "Data", render: renderData },

  // The tail: chrome, not a lane. A rule separates it and nothing labels it.
  settings: { title: "Settings", group: null, render: renderSettings },
};

// Nav icons (ROUTE_ICONS, LANE_ICONS) live in routeIcons.js — see that module for why.

// The Run scan button's mark: an arrow travelling into a store, not a "play" triangle. What
// the button does is fetch a population and put it somewhere, and a play glyph would promise
// something that starts and runs rather than something that collects and commits.
const RUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5v10.5"/><path d="M8.2 10.3L12 14.1l3.8-3.8"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/></svg>';

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

// The scan battery's client state. `lastJob` exists so the Details handler reads the CURRENT
// job at click time rather than the one captured when the handler was built — the poller has
// almost certainly moved on by then.
let jobPoller = null;
let scanCardHost = null;
let scanButtonsRow = null;
let stoppingJobId = null;
let stoppingSince = 0;
let lastJob = null;
let scanDetails = null;

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


// Recreate the branded boot splash index.html paints on first load, so refresh() (which
// re-runs boot()) shows the same veil. Keep this markup in sync with the static copy in
// index.html. Reuses the indeterminate progress bar so it reads as the same loader family
// as the route-overlay (and inherits its reduced-motion striped fallback).
function bootSplash() {
  const bar = progressBar(null);
  bar.classList.add("boot-splash-bar");
  bar.setAttribute("aria-label", "Opening the graph");
  return el(
    "div",
    { class: "boot-splash", role: "status", "aria-live": "polite" },
    el("div", { class: "boot-splash-inner" },
      el("div", { class: "boot-brand" },
        brandMark(112),
        el("span", { class: "boot-brand-label" }, "Wiz Sidekick DevSecOps")),
      bar,
      el("p", { class: "boot-splash-note" }, "Opening the graph…")),
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
 * Rebuilt wholesale like the rail is, and from the same payload — a refresh ends in
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
    el("span", { class: "appbar-name" }, "Wiz Sidekick DevSecOps"),
  );
  // Phase 1 carries no scope switcher. The register has one population until the sync
  // battery lands, and a picker over a population of one is a control with nothing behind
  // it — which is the one thing this shell is careful never to offer.
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

  // The scan zone. Its state is derived, never asserted — see railStatus.js for why that
  // sentence needed writing down.
  const status = railStatus({
    hasCredentials: data ? data.hasCredentials : false,
    lastScanByScope: withLabels(data && data.lastScanByScope, data && data.scopeLabels),
    scopes: (data && data.settings && data.settings.scopes) || [],
    job: data ? data.activeJob : null,
  });

  const zone = el("div", { class: "scan-zone" });
  scanCardHost = el("div", {});

  // NO DRY-RUN BEHIND THIS BUTTON. Without credentials it refuses rather than quietly
  // running the sample source: pressing "Run scan" and getting invented figures back under a
  // real-looking scan row is worse than a disabled control that says why.
  const runnable = Boolean(data && data.hasCredentials);
  const runBtn = el("button", {
    class: "primary",
    disabled: runnable ? null : true,
    onclick: runnable ? () => startScan(runBtn) : null,
  }, iconSpan(RUN_ICON), el("span", { class: "btn-label" }, "Run scan"));
  scanButtonsRow = runnable
    ? el("div", { class: "scan-buttons" }, runBtn)
    : el("div", { class: "scan-buttons" }, tipAnchor(
      el("span", { class: "tip-disabled-wrap" }, runBtn),
      "No Wiz credentials are set, so there is nothing to scan.",
    ));

  zone.append(
    scanCardHost,
    scanButtonsRow,
    // The status sentence, and the dot that is its glance version. The sentence comes FIRST
    // in the DOM and is only visually hidden in the rail (base.css), so it is in the
    // accessibility tree at every width — above 800px it is the only status a screen reader
    // or a keyboard user can reach, because the dot is nine pixels of colour.
    el("div", { class: "scan-caption" }, statusPill(
      status.state === "warn" ? "warn" : status.state === "bad" ? "bad"
        : status.state === "ok" ? "ok" : "neutral",
      status.label,
    )),
    tipAnchor(el("span", {
      class: `rail-status-dot ${status.state}`,
      "aria-hidden": "true",
      tabindex: "0",
    }), [status.label, status.detail].filter(Boolean).join(" — ")),
    ...(status.detail ? [el("div", { class: "scan-caption" }, status.detail)] : []),
  );
  sidebar.append(zone);

  // A reload in the middle of a scan picks the card back up: the job rides in the bootstrap
  // payload, so there is nothing to reconstruct from the URL and no window where the scan is
  // running with nothing on screen saying so.
  if (data && data.activeJob) {
    paintCard(data.activeJob);
    watchJob(data.activeJob.job_id);
  }
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
 * Empty in Phase 1, and deliberately still a function rather than a constant: navModel's
 * rule is that a rail item EARNS a panel by having something to put in it, so returning
 * nothing here is what makes every lane draw as a plain list today. Saved views are the
 * intended first occupant.
 */
function navContext() {
  return { savedViews: [] };
}

/* --------------------------------------------------------------- the scan battery */

/**
 * How long an optimistic "Stopping…" is allowed to stand.
 *
 * It used to be permanent in the sibling: it hid the Stop button and cleared only on a
 * CANCELLED the server might never produce, so a job that died between hops left the reader
 * with no Stop and no Run. Expiring it puts the action back.
 */
const STOPPING_GRACE_MS = 45_000;

async function startScan(btn) {
  btn.disabled = true;
  try {
    const res = await call("api_runScan", {});
    toast(res.message);
    if (res.jobId) { stoppingJobId = null; watchJob(res.jobId); }
    else await refresh();
  } catch (e) {
    toast(String(e.message || e), "error");
  } finally {
    btn.disabled = false;
  }
}

function paintCard(job) {
  lastJob = job;
  if (stoppingJobId === job.job_id && Date.now() - stoppingSince > STOPPING_GRACE_MS) {
    stoppingJobId = null;
  }
  const view = renderScanCard(scanCardHost, job, {
    scopeLabels: (bootstrapCached() || {}).scopeLabels || {},
    onDetails: () => {
      // `lastJob` at CLICK time, not the job captured when the handler was made: the poller
      // has almost certainly moved on, and opening the drawer on a job from three seconds
      // ago shows a stale page that then jumps on the next tick.
      scanDetails = openScanDetails(lastJob, {
        // The same labels the card uses. Without them the drawer's Register row printed the
        // raw scope key ("sca") beside a card that said "Dependencies".
        scopeLabels: (bootstrapCached() || {}).scopeLabels || {},
        onStop: () => requestStop(lastJob.job_id),
      });
    },
    onStop: stoppingJobId === job.job_id ? null : () => requestStop(job.job_id),
  });
  if (scanDetails) scanDetails.update(job);
  // The run button comes back when the job has gone quiet. Hiding it unconditionally — which
  // is what the sibling does — takes away the only way out of a wedged job, while the card
  // itself advises "stop it, then run a new scan".
  if (scanButtonsRow) scanButtonsRow.style.display = view && view.stale ? "" : "none";
}

function stopWatch() {
  if (jobPoller) clearInterval(jobPoller);
  jobPoller = null;
}

/**
 * Watch a job until it reaches a terminal phase.
 *
 * THE FIRST POLL IS IMMEDIATE, and that is a fix rather than a detail. Written as a plain
 * `setInterval`, the card's first frame lands three seconds after the click — so pressing
 * Run scan produced no visible change at all, on the one control in the app whose whole job
 * is to say that something is now happening. Caught in the browser with the continuation
 * trigger frozen, which is the only way to hold a scan still long enough to look at it.
 */
function watchJob(jobId) {
  stopWatch();
  const tick = async () => {
    try {
      const job = await call("api_getJobStatus", { jobId });
      if (!job) { stopWatch(); clear(scanCardHost); return; }
      if (job.phase === "DONE") {
        stopWatch();
        if (scanDetails) scanDetails.update(job);
        toast("Scan complete.");
        await refresh();
      } else if (job.phase === "CANCELLED") {
        stopWatch();
        stoppingJobId = null;
        if (scanDetails) scanDetails.update(job);
        toast("Scan stopped.");
        await refresh();
      } else if (job.phase === "FAILED") {
        // The card STAYS UP on a failure, holding the error where it happened. A refresh
        // here would clear it and leave a toast as the only account of what went wrong.
        stopWatch();
        paintCard(job);
        if (scanButtonsRow) scanButtonsRow.style.display = "";
        toast(job.error || "Scan failed.", "error");
      } else {
        paintCard(job);
      }
    } catch {
      // A poll that fails is not a scan that failed — the next tick asks again.
    }
  };
  tick();
  jobPoller = setInterval(tick, 3000);
}

async function requestStop(jobId) {
  stoppingJobId = jobId;
  stoppingSince = Date.now();
  if (lastJob && lastJob.job_id === jobId) paintCard(lastJob);
  try {
    const res = await call("api_cancelScan", { jobId });
    if (res.stopped) { stoppingJobId = null; stopWatch(); await refresh(); }
    toast(res.message || "Stopping the scan…");
  } catch (e) {
    stoppingJobId = null;
    toast(String(e.message || e), "error");
  }
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
  // when it was written — see DEFAULT_ROUTE in store.js. The nav highlight used to key off
  // the RAW path, so an unresolved hash rendered a page while marking no nav item current.
  let key = PAGES[parsed.route] ? parsed.route : DEFAULT_ROUTE;
  let params = parsed.params;
  // A gated route is a link the reader followed in good faith, so unlike the fallback above
  // this one REWRITES the hash: leaving `#/aars` in the address bar over a different page
  // with no nav item current is three answers to "where am I", two of them wrong.
  if (PAGES[key] && PAGES[key].experimental && !showExperimental()) {
    key = DEFAULT_ROUTE;
    params = {};
    history.replaceState(null, "", buildHash(key, params));
  }
  const page = PAGES[key];
  document.title = `${page.title} — Wiz Sidekick DevSecOps`;
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
  // THE SHEET IS THE OTHER ONE, and it went unnoticed until a page finally opened one. It is
  // portaled to <body> too, so a filter drawer or a drill-down left open survives the route
  // change — and its SCRIM survives with it, sitting over the next page and swallowing every
  // click. Measured in the browser: opening Dependencies' filter drawer and navigating to
  // Secrets left the new page unclickable, with nothing on screen explaining why. Neither
  // sibling app calls this either; neither had a page that opened a sheet.
  closeActiveSheet();
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
