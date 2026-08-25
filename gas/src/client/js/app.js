// Wiz Sidekick OS SPA shell: app header, two-tier navigation, scan zone, hash router.

import { call } from "./api.js";
import { brandMark } from "./brandMark.js";
import {
  focusFirstRow,
  itemHasPanel,
  mountNavFlyout,
  openFlyoutFor,
  setActiveItem,
  setNavContext,
  tapOpensPanel,
  wireRail,
} from "./navFlyout.js";
import { itemForRoute, railItems } from "./navModel.js";
import { LANE_ICONS, ROUTE_ICONS, RUN_ICON } from "./routeIcons.js";
import { renderScanCard, openScanDetails } from "./scanProgress.js";
import { scopeSwitchControl } from "./scopeSwitch.js";
import { bootstrap, invalidateBootstrap, invalidateRpcCache, parseHash } from "./store.js";
import { clear, el, fmtDateTime, progressBar, statusPill, toast } from "./ui.js";
import { renderExecutive } from "./pages/executive.js";
import { renderOverview } from "./pages/overview.js";
import { renderMttr } from "./pages/mttr.js";
import { renderProgram } from "./pages/program.js";
import { renderHistory } from "./pages/history.js";
import { renderData } from "./pages/data.js";
import { renderSettings } from "./pages/settings.js";
import { renderAttribution } from "./pages/attribution.js";

// THE ONE SOURCE for both the router and the nav. Order matters twice over: pages are drawn
// in this insertion order, LANES ARE THE CONTIGUOUS RUNS OF ONE `group` (navModel.railItems
// walks it once and joins a page to the item still open, so a lane split in two would draw
// two items with one name), and the first key is the app's default landing page — which
// store.parseHash hardcodes as "executive"; test/navGroups.test.js holds the two together.
//
// `group: null` is the CHROME TAIL: pages that name themselves, drawn under a rule rather
// than under a heading. Settings is the whole tail here — a "Preferences" heading over one
// item would restate the link it sits on.
const PAGES = {
  executive: { title: "Executive", group: "Overview", render: renderExecutive },
  mttr: { title: "MTTR & SLA", group: "Security", render: renderMttr },
  program: { title: "Program performance", group: "Security", render: renderProgram },
  overview: { title: "OS vulnerabilities", group: "Security", render: renderOverview },
  data: { title: "Data", group: "Data", render: renderData },
  scan_history: { title: "Scan History", group: "Data", render: renderHistory },
  attribution: { title: "Attribution", group: "Data", render: renderAttribution },
  settings: { title: "Settings", group: null, render: renderSettings },
};

// Below this the rail is a stacked list instead of an icon rail with a panel: at that width
// there is nothing to fly out from and nowhere to put it.
const NARROW_NAV = "(max-width: 800px)";
function narrowNav() {
  return !!(window.matchMedia && window.matchMedia(NARROW_NAV).matches);
}

/** The rail's items for the current PAGES table. Recomputed rather than cached — it is a
 *  walk over eight entries, and a cached copy is a second list that could disagree. */
function currentRailItems() {
  return railItems(PAGES);
}

// A span carrying an inline SVG (el() builds HTML nodes, so SVG goes in via innerHTML).
function iconSpan(svg, cls) {
  const s = el("span", { class: cls || "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

const app = document.getElementById("app");
let mainEl = null;
let appbarEl = null;
let bootData = null; // the last bootstrap payload, so renderAppbar can re-derive on a pick
// The global "Value Chain" scope, shared by every page. "" = the whole register. Module-level
// so it survives route() (which only re-renders mainEl, never the shell) and page navigation —
// nav links carry no state.
let activeDomain = "";
// The global "Support group" scope, shared by every page the same way. "" = all groups.
let activeSupportGroup = "";
// The global "Business domain" scope — the owner named by a resource's `Wiz/Domain` tag.
// Orthogonal to the two above rather than nested under either: a domain can cut across value
// chains and support groups alike, which is why the switcher lists three flat groups.
//
// EXACTLY ONE OF THESE THREE IS EVER SET. The first two used to be independent filters that
// could intersect, each with its own combobox at the bottom of the rail; all three are groups
// in one header control now, and one scope is what a header can honestly name. pickScope() is
// where that rule lives — clearScope() and the page chips only ever clear.
let activeBizDomain = "";

/** The three scopes as the pages take them. One object, so no caller can pass two of three. */
function activeScope() {
  return { domain: activeDomain, supportGroup: activeSupportGroup, bizDomain: activeBizDomain };
}

// Toggle the scan-zone's "filtering" accent to match the active scope.
function syncScanZoneFiltering() {
  const zone = document.querySelector(".scan-zone");
  const scoped = !!(activeDomain || activeSupportGroup || activeBizDomain);
  if (zone) zone.classList.toggle("filtering", scoped);
}

/**
 * The header switcher's pick: set one scope, clear the others, and re-read the page.
 *
 * No server round trip and no re-boot. This app scopes CLIENT-SIDE — the three values ride the
 * page context and each page passes them into its own RPC — so the payload the switcher itself
 * reads (`bootData`) is unchanged by a pick, and only the header's own label, caption and
 * accent need re-deriving. `renderAppbar` does that by rebuilding from the same payload rather
 * than patching, which is what keeps the caption and the trigger from ever disagreeing.
 */
function pickScope(pick) {
  // Set one, clear the other two. Written as a clear-then-set rather than three branches so
  // the "one at a time" rule is structural: there is no path through this function that leaves
  // two of them non-empty.
  activeDomain = "";
  activeSupportGroup = "";
  activeBizDomain = "";
  if (pick.kind === "supportGroup") activeSupportGroup = pick.value || "";
  else if (pick.kind === "bizDomain") activeBizDomain = pick.value || "";
  else activeDomain = pick.value || "";
  renderAppbar(appbarEl, bootData);
  syncScanZoneFiltering();
  route();
}

// Clear the scope from a page-header chip. The header is rebuilt so its trigger drops the
// accent and its caption returns to the register-wide figure.
function clearScope(kind) {
  if (kind === "domain") activeDomain = "";
  else if (kind === "supportGroup") activeSupportGroup = "";
  else if (kind === "bizDomain") activeBizDomain = "";
  renderAppbar(appbarEl, bootData);
  syncScanZoneFiltering();
  route();
}

// Route-reload overlay: veils the content pane (not the sidebar) with a progress bar
// while the active page refetches — most visibly after a Value Chain change, which
// otherwise reloads silently. Shown only if the load outlasts a short delay, so cached
// switches never flash; a sequence guard keeps it up across rapid successive changes.
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
    // Set the live-region text only after the overlay is visible so it announces.
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
let scanCardHost = null; // the progress-card slot in the current scan zone
let scanButtonsRow = null; // the Run/Quick buttons, hidden while a job runs
let stoppingJobId = null; // optimistic "Stopping…" until the server confirms CANCELLED
let stoppingSince = 0; // when Stop was pressed — the optimistic state expires (see paintCard)
// How long "Stopping…" is allowed to stand before the action comes back. A live fetch hop
// honors the cooperative flag at its next page boundary, which can take a page's worth of
// time; past that, a request that hasn't landed isn't going to, and the button must return
// rather than leave the user staring at a state with no exit.
const STOPPING_GRACE_MS = 45000;
let lastJob = null; // most recent JobRow, for an immediate repaint on Stop
let scanDetails = null; // open scan-details drawer handle, kept live by the poller

// Recreate the branded boot splash index.html paints on first load, so refresh() (which
// re-runs boot()) shows the same veil. Keep this markup in sync with the static copy in
// index.html. Reuses the indeterminate progress bar so it reads as the same loader family
// as the route-overlay (and inherits its reduced-motion striped fallback).
function bootSplash() {
  const bar = progressBar(null);
  bar.classList.add("boot-splash-bar");
  bar.setAttribute("aria-label", "Opening the ledger");
  return el(
    "div",
    { class: "boot-splash", role: "status", "aria-live": "polite" },
    el("div", { class: "boot-splash-inner" },
      el("div", { class: "boot-brand" },
        brandMark(112),
        el("span", { class: "boot-brand-label" }, "Wiz Sidekick OS")),
      bar,
      el("p", { class: "boot-splash-note" }, "Opening the ledger…")),
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
  appbarEl = appbar;
  const sidebar = el("nav", { class: "sidebar", "aria-label": "Main navigation" });
  mainEl = el("main", { id: "main" });
  // Kept out of <main> so clear(mainEl) never removes it and it always covers the
  // pane regardless of scroll. role=status makes "Updating…" a polite announcement.
  routeOverlay = el(
    "div",
    { class: "route-overlay", role: "status", "aria-live": "polite" },
    el("div", { class: "route-overlay-bar", "aria-hidden": "true" },
      el("div", { class: "route-overlay-fill" })),
    el("span", { class: "route-overlay-label" }),
  );
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
  // The panel asks the shell what it holds each time it opens. Nothing yet — see
  // navModel.panelBlocks for which candidates were considered and why none of them qualifies
  // — but the provider is the seam a saved-view store would arrive through, and wiring it now
  // is what keeps that a one-function change rather than a re-derivation.
  setNavContext(() => ({}));
  wireRail(sidebar, (id) => currentRailItems().filter((i) => i.id === id)[0] || null);

  let data;
  try {
    data = await bootstrap();
  } catch (e) {
    clear(mainEl).append(
      el("div", { class: "empty" },
        el("div", {}, "Couldn't reach the server."),
        el("div", { class: "small", style: "margin:6px 0 14px" }, String(e.message || e)),
        el("button", { class: "primary", onclick: () => refresh() }, "Retry"),
      ),
    );
    bootData = null;
    renderAppbar(appbar, null);
    renderSidebar(sidebar, null);
    hideBootSplash(); // reveal the error card
    return;
  }
  bootData = data;
  renderAppbar(appbar, data);
  renderSidebar(sidebar, data);
  route(); // paints the page's skeleton synchronously up to its first data await
  // Fade the splash only after the skeleton has laid out — double rAF flushes the (cached)
  // bootstrap microtasks and one layout tick, so the splash reveals the skeleton, never a blank pane.
  requestAnimationFrame(() => requestAnimationFrame(hideBootSplash));
}

/**
 * The bar across the top: whose product this is, and which slice of the register it is showing.
 *
 * DELIBERATELY TWO THINGS. Both describe the whole app rather than any one page — the switcher
 * scopes every figure on every page, so it reads as chrome rather than as one page's filter.
 * The reference screens' search box, notification bell and avatar are absent because none of
 * them has anything behind it here. Everything else stays in the rail: the nav, Run scan, the
 * credentials pill and the last-scan line.
 *
 * Rebuilt wholesale rather than patched, and from one payload, so the switcher's label, its
 * caption and its accent are always three readings of the same state.
 *
 * @param {HTMLElement} appbar
 * @param {object|null} data  the bootstrap payload, or null when boot failed
 */
function renderAppbar(appbar, data) {
  if (!appbar) return;
  clear(appbar);
  // Decorative, because the name is right there beside it in text and never hidden — the
  // shell's other copy of the mark (the splash) is decorative for the same reason. The rail
  // carries no mark at all now, so nothing in this file names the product twice.
  appbar.append(
    brandMark(22, { compact: true }),
    el("span", { class: "appbar-name" }, "Wiz Sidekick OS"),
  );
  // Null when there is no register to slice — including the boot-failure path, where offering
  // a picker over data we could not fetch would be a control with nothing behind it. The rule
  // goes with it: a separator with one side missing separates nothing.
  const scopeSwitch = scopeSwitchControl(data, activeScope(), pickScope);
  if (scopeSwitch) {
    appbar.append(el("span", { class: "appbar-sep", "aria-hidden": "true" }), scopeSwitch);
  }
}

/**
 * A lane heading.
 *
 * An h2 rather than a div, and the label inside a span rather than loose in it, so the icon
 * rail can clip the words (rather than remove them) and draw the h2 itself as the hairline
 * between two icon clusters. The heading stays announced and navigable in every state; only
 * its pixels change.
 */
function navGroupHeading(label) {
  return el("h2", { class: "nav-group" }, el("span", { class: "nav-group-label" }, label));
}

// The chrome tail's separator. Settings names itself, so the tail is marked rather than
// labelled — presentational, because it says nothing a reader could not see, and the page
// under it is already an ordinary link.
function navRule() {
  return el("div", { class: "nav-rule", role: "presentation" });
}

/**
 * One rail item: a link that navigates, and — where the item has a panel — the trigger that
 * opens it.
 *
 * ONE CONTROL, and no caret beside it. `aria-haspopup` and `aria-expanded` say a panel is there
 * and whether it is open, ArrowRight opens it and lands focus inside, Escape closes it and
 * hands focus back. Enter still navigates, because this is still a link: the panel is a way in,
 * never the only one.
 */
function railItem(item) {
  const icon = item.kind === "lane" ? LANE_ICONS[item.id] : ROUTE_ICONS[item.route];
  const node = el("div", { class: "rail-item", "data-nav-item": item.id });
  const link = el(
    "a",
    {
      class: "nav-link rail-link",
      href: `#/${item.route}`,
      // index.html sets <base target="_top"> so external links escape the GAS sandbox iframe.
      // Without an explicit _self, hash links inherit it and navigate the top window to the
      // sandbox's own googleusercontent URL — which, loaded bare, is a blank page.
      target: "_self",
      // Only where there is one. A rail item that announced a popup it does not have would
      // send a screen-reader user hunting for a panel that never opens.
      "aria-haspopup": itemHasPanel(item) ? "true" : null,
      "aria-expanded": itemHasPanel(item) ? "false" : null,
      onclick: (e) => {
        // Where there is no hover there is no flyout, so the first tap has to do the revealing.
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

/** The two-tier rail: one item per lane, then a rule, then the chrome tail. */
function renderRail(sidebar, items) {
  let ruled = false;
  for (const item of items) {
    // Keyed on `lane`, never on `kind`: a lane holding one visible page is drawn AS that page,
    // so kind alone would put the rule in front of the first collapsed lane instead of in front
    // of the chrome.
    if (item.lane === null && !ruled) { sidebar.append(navRule()); ruled = true; }
    sidebar.append(railItem(item));
  }
}

/**
 * The stacked list, for the top-bar layout below 800px: every page, lane headings as words, one
 * rule above the chrome tail. This is the rail as it shipped before the panel existed, and it
 * stays because at that width it is still the right answer.
 */
function renderStackedNav(sidebar) {
  const { route: active } = parseHash();
  // `undefined`, not null: null is a real group — the unlabelled chrome tail — and a detector
  // seeded with it would start the list inside that tail and never draw its rule.
  let lastGroup;
  for (const [key, page] of Object.entries(PAGES)) {
    if (page.hidden) continue;
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

  // Scan zone — carries a subtle "filtering" accent when a scope is active, so the source of a
  // scoped view is visible where the scan controls live (the header switcher and the scopeBar
  // in the content pane are the primary cues).
  const zone = el("div",
    { class: `scan-zone${activeDomain || activeSupportGroup ? " filtering" : ""}` });
  const runBtn = el("button", { class: "primary", onclick: () => startScan(false, runBtn) },
    iconSpan(RUN_ICON), el("span", { class: "btn-label" }, "Run scan"));
  const quickBtn = el(
    "button",
    {
      onclick: () => startScan(true, quickBtn),
      title: "Fetch only findings changed since the last full scan and merge them in. " +
        "Deletions aren't detected — run a full scan for those.",
    },
    "Quick refresh",
  );
  // The controls wrapper (buttons + a persistent caveat) is hidden as a unit while a job
  // runs. The caveat states the Quick refresh trap in visible copy, not just a hover title.
  scanButtonsRow = el("div", { class: "scan-controls" },
    el("div", { class: "scan-buttons" }, runBtn, quickBtn),
    el("div", { class: "scan-caption" },
      "Quick refresh merges changes only — run a full scan to clear resolved findings."),
  );
  scanCardHost = el("div", {}); // filled by the poller while a job runs
  zone.append(scanCardHost, scanButtonsRow);
  if (data) {
    zone.append(
      el("div", { class: "scan-caption" },
        data.hasCredentials
          ? statusPill("ok", "Credentials loaded")
          : statusPill("neutral", "Dry-run (no credentials)"),
      ),
      // Compact stand-in for the pill above, shown on the icon rail (where the captions do not
      // fit) so the credentials/dry-run state stays glanceable at 76px.
      el("span", {
        class: `rail-status-dot ${data.hasCredentials ? "ok" : "neutral"}`,
        "aria-hidden": "true",
        title: data.hasCredentials ? "Credentials loaded" : "Dry-run (no credentials)",
      }),
    );
    if (data.latestScan) {
      const age = Math.floor((Date.now() - Date.parse(data.latestScan.ts)) / 86400000);
      zone.append(
        el("div", { class: "scan-caption" },
          `Last scan ${fmtDateTime(data.latestScan.ts)}` +
            (age >= 2 ? ` — ${age} days ago` : ""),
        ),
      );
    } else {
      zone.append(el("div", { class: "scan-caption" }, "No scan saved yet."));
    }
    // Seed the card immediately from the bootstrap job, then keep it live — this is
    // what makes progress survive a page reload mid-scan.
    if (data.activeJob) {
      paintCard(data.activeJob);
      watchJob(data.activeJob.job_id);
    }
  }

  // The two global filters that used to live here — Value Chain and Support group — are one
  // control in the app header now. They were the only things in the rail that were not
  // destinations, and a scope is not a destination.
  //
  // A SCOPE THAT FELL OUT OF THE REGISTER IS NO LONGER SILENTLY DROPPED, which is what the two
  // comboboxes did on every rebuild. Deleting a value chain in Settings and coming back to a
  // whole-register view looks exactly like never having scoped at all — the numbers change,
  // nothing says why, and the reader is left to work out which of the two happened. The
  // switcher keeps the stale value in force and says so in words instead ("Not in this
  // register — showing 0 of N", scopeSwitchView), so the empty pages behind it are explained
  // by the control that caused them.
  sidebar.append(zone);
}

async function startScan(incremental, btn) {
  btn.disabled = true;
  try {
    const res = await call("api_runScan", { incremental });
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

/** Render the progress card for a job and hide the Run/Quick buttons (unless it's wedged). */
function paintCard(job) {
  if (!scanCardHost) return;
  lastJob = job;
  // "Stopping…" is optimistic, and it used to be permanent: it hid the Stop button and only
  // cleared on a CANCELLED the server might never produce. Expire it so the action returns.
  if (stoppingJobId === job.job_id && Date.now() - stoppingSince > STOPPING_GRACE_MS) {
    stoppingJobId = null;
  }
  const stopping = stoppingJobId === job.job_id && job.phase !== "CANCELLED";
  const view = renderScanCard(scanCardHost, job, {
    // Read lastJob at click time, not the job captured when this Details button was built —
    // renderScanCard reuses the button across polls, so a captured job would be stale and the
    // drawer would flash 0 findings/0 pages for one tick before the poller updates it.
    onDetails: () => {
      scanDetails = openScanDetails(lastJob, { onStop: () => requestStop(lastJob.job_id) });
    },
    onStop: stopping ? null : () => requestStop(job.job_id),
    stopping,
  });
  // Keep an open details drawer in step with the poll — otherwise its values freeze at open time.
  if (scanDetails) scanDetails.update(job);
  // Hiding Run/Quick behind a live job is single-flight housekeeping — but a job that has gone
  // quiet for half an hour isn't live, and startScan() is the path that reclaims a stale job
  // and recovers a killed mid-write. Hiding it there took away the last way out.
  if (scanButtonsRow) scanButtonsRow.style.display = view.stuck ? "" : "none";
}

function clearCard() {
  scanDetails = null; // drop the stale drawer handle once the card is gone
  if (scanCardHost) clear(scanCardHost);
  if (scanButtonsRow) scanButtonsRow.style.display = "";
}

async function requestStop(jobId) {
  stoppingJobId = jobId;
  stoppingSince = Date.now();
  if (lastJob && lastJob.job_id === jobId) paintCard(lastJob); // instant "Stopping…"
  try {
    const res = await call("api_cancelScan", { jobId });
    toast(res.message || "Stopping scan…");
    // The server reaps a dead job synchronously and reports it. Drop the optimistic state at
    // once rather than sitting in "Stopping…" for a job that is already terminal; the poller
    // picks up the terminal phase on its next tick.
    if (res.stopped) stoppingJobId = null;
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
        if (scanDetails) scanDetails.update(job); // let an open drawer settle on "Complete"
        toast("Scan complete.");
        refresh();
      } else if (job.phase === "CANCELLED") {
        stopWatch();
        stoppingJobId = null;
        if (scanDetails) scanDetails.update(job); // an open drawer settles on "Cancelled"
        toast("Scan stopped.");
        refresh();
      } else if (job.phase === "FAILED") {
        stopWatch();
        paintCard(job); // leave the failure visible; buttons return for a retry
        if (scanButtonsRow) scanButtonsRow.style.display = "";
        toast(job.error || "Scan failed.", "error");
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
  const seq = ++routeSeq;
  const { route: key, params } = parseHash();
  const page = PAGES[key] || PAGES.executive;
  document.title = `${page.title} — Wiz Sidekick OS`;
  // active nav state — every link, wherever it is drawn: the stacked list, the icon rail, and
  // the panel's rows are all `.nav-link`, and all three have to agree on where you are.
  document.querySelectorAll(".nav-link").forEach((a) => {
    const isActive = a.getAttribute("href") === `#/${key}`;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  // The rail marks the ITEM the route belongs to — a lane, usually. Deliberately a class and
  // not `aria-current="page"`: the lane is not the page, and the page's own row inside the
  // panel is already carrying that.
  const here = itemForRoute(currentRailItems(), key);
  document.querySelectorAll(".rail-item").forEach((node) => {
    node.classList.toggle("current", !!here && node.getAttribute("data-nav-item") === here.id);
  });
  setActiveItem(here);
  clear(mainEl);
  // The first render after a boot is covered by the boot splash → page skeleton, so it skips
  // the veil to avoid stacking two loaders; later navigations use it as normal.
  const useOverlay = !firstRoute;
  if (useOverlay) beginRouteLoading();
  try {
    await page.render(mainEl, params, {
      refresh, clearScope, startScan, ...activeScope(),
    });
  } catch (e) {
    clear(mainEl).append(
      el("div", { class: "empty" },
        el("div", {}, "This page failed to load."),
        el("div", { class: "small", style: "margin-top:6px" }, String(e.message || e)),
      ),
    );
  } finally {
    // Only the latest route settles the overlay; a newer change keeps it up.
    if (useOverlay && seq === routeSeq) endRouteLoading();
    firstRoute = false;
  }
}

window.addEventListener("hashchange", route);
boot();
