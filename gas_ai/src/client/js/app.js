// Wiz SIDEKICK AI SPA shell: sidebar navigation, sync zone, hash router.

import { call } from "./api.js";
import { renderSyncCard, openSyncDetails } from "./syncProgress.js";
import {
  bootstrap, bootstrapCached, buildHash, invalidateBootstrap, invalidateRpcCache, parseHash,
} from "./store.js";
import { onExperimentalChange, showExperimental } from "./experimental.js";
import {
  clear, closeTip, el, fmtDateTime, progressBar, runPageTeardown, statusPill, tipAnchor,
} from "./ui.js";
import { brandMark } from "./ui/brandMark.js";
import { projectScopeControl } from "./ui/projectScope.js";
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
import { ROUTE_ICONS } from "./routeIcons.js";

const PAGES = {
  // fullBleed: the page owns the whole content pane (no main padding/max-width).
  graph: { title: "Security Graph", group: "Security", render: renderGraphPage, fullBleed: true },
  inventory: { title: "AI Inventory", group: "Security", render: renderInventory },
  // Phase 7: issues UNION findings, ranked together across the whole landscape — neither
  // `combos` (one toxic-combination pattern) nor `config` (findings only) can answer
  // "what do I work on Monday". Sits right after inventory: both name the landscape, this one
  // orders what is wrong with it.
  problems: { title: "Priorities", group: "Security", render: renderProblems },
  combos: { title: "Toxic Combinations", group: "Security", render: renderCombos },
  config: { title: "Cloud Configuration", group: "Security", render: renderConfigFindings },
  // After config, never first: the FIRST key is the default landing route (parseHash's
  // fallback is coupled to it), so inserting a page at the top silently changes the app's
  // front door. Sits beside Cloud Configuration because the two are the same subject at
  // two grains — what is failing, and what that scores against.
  compliance: { title: "Compliance Posture", group: "Security", render: renderCompliance },
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
  // Group "Labs", not "Scoring": the sidebar itself should say these sit outside the
  // security workflow rather than beside it.
  //
  // `experimental: true` gates it behind Settings → Show experimental content, which is OFF
  // by default — so a first-time reader has no Labs group at all, and the models are opt-in
  // rather than merely labelled. Gated, never removed: the key stays in this map so shared
  // `#/aars` links keep working for anyone who has asked for them, and so helpContent's
  // "routes only to pages that exist" guard still has a page to point at.
  aars: {
    title: "Scoring Models", group: "Labs", render: renderAarsRules, fullBleed: true,
    experimental: true,
  },
  scans: { title: "Wiz Scans", group: "Coverage", render: renderScans },
  data: { title: "Data", group: "Data", render: renderData },
  settings: { title: "Settings", group: "Preferences", render: renderSettings },
  // Last on purpose. The FIRST key is the default landing route, and parseHash's
  // `|| "graph"` fallback is coupled to it — a page inserted at the top silently
  // becomes the app's front door.
  help: { title: "Help", group: "Help", render: renderHelp },
};

// Nav-route icons (ROUTE_ICONS) now live in routeIcons.js — see that module for why.
// Circular-arrows glyph for the primary "Sync now" button; shrinks to the icon alone when
// the rail is collapsed (its .btn-label is hidden by the collapsed CSS).
const SYNC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 0-13.7-5L4 8.5"/><path d="M4 4.5v4h4"/><path d="M4 12.5a8 8 0 0 0 13.7 5L20 15.5"/><path d="M20 19.5v-4h-4"/></svg>';
const CHEVRON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>';

// A span carrying an inline SVG (el() builds HTML nodes, so SVG goes in via innerHTML).
function iconSpan(svg, cls) {
  const s = el("span", { class: cls || "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

// Collapsed-rail preference — persisted like a user setting, with its own try/catch since a
// GAS iframe sandbox can block web storage. Desktop-only: the <=800px top-bar layout ignores
// the .collapsed class (see styles.css), so a stored flag is simply inert there.
const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";
// Collapsed by default: an absent preference reads as collapsed, and only an explicit expand
// (stored "0" by saveCollapsed) reopens it — so the rail stays out of the way until a user
// deliberately widens it. A sandbox that blocks storage also lands on collapsed.
function loadCollapsed() {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== "0"; } catch { return true; }
}
function saveCollapsed(v) {
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? "1" : "0"); } catch { /* sandboxed */ }
}
// Reflect the flag onto the (rebuilt-on-refresh) rail DOM. Width rides the shared --rail-w
// custom property so the flex main pane and the route overlay's left edge track it for free.
// Collapsed nav links get a native title = their label (the visible text is hidden).
function applyCollapsed(collapsed) {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("collapsed", collapsed);
  if (collapsed) document.documentElement.style.setProperty("--rail-w", "56px");
  else document.documentElement.style.removeProperty("--rail-w");
  const toggle = sidebar.querySelector(".rail-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    tipAnchor(toggle, collapsed ? "Expand sidebar" : "Collapse sidebar");
  }
  // The collapsed rail is the default, and a native title was the only thing naming these
  // links in it: unreachable by touch, and half a second late for everyone else. Re-registered
  // rather than removed when the rail expands, because an expanded link says its own name.
  sidebar.querySelectorAll(".nav-link").forEach((a) => {
    const label = a.querySelector(".nav-label");
    tipAnchor(a, collapsed && label ? label.textContent : null);
  });
}

const app = document.getElementById("app");
let mainEl = null;
// Held past boot() so the rail can be redrawn on its own. Flipping "show experimental
// content" changes which pages the rail lists and nothing else — a full refresh() would
// re-fetch the whole bootstrap payload to answer a question already settled locally.
let sidebarEl = null;
let sidebarCollapsed = loadCollapsed();

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
  bar.setAttribute("aria-label", "Opening the graph");
  return el(
    "div",
    { class: "boot-splash", role: "status", "aria-live": "polite" },
    el("div", { class: "boot-splash-inner" },
      el("div", { class: "boot-brand" },
        brandMark(112),
        el("span", { class: "boot-brand-label" }, "Wiz SIDEKICK AI")),
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
  app.append(sidebar, mainEl, routeOverlay);

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
    renderSidebar(sidebar, null);
    hideBootSplash(); // reveal the error card
    return;
  }
  renderSidebar(sidebar, data);
  route(); // paints the page's skeleton synchronously up to its first data await
  // Fade the splash only after the skeleton has laid out — double rAF flushes the (cached)
  // bootstrap microtasks and one layout tick, so the splash reveals the skeleton, never a blank pane.
  requestAnimationFrame(() => requestAnimationFrame(hideBootSplash));
}

function renderSidebar(sidebar, data) {
  clear(sidebar);
  const railToggle = el("button", {
    class: "rail-toggle", type: "button",
    onclick: () => {
      sidebarCollapsed = !sidebarCollapsed;
      saveCollapsed(sidebarCollapsed);
      applyCollapsed(sidebarCollapsed);
    },
  });
  railToggle.innerHTML = CHEVRON_ICON;
  sidebar.append(
    el("div", { class: "wordmark" },
      // Two marks, one shown at a time: the expanded rail pairs the compact mark with the
      // name, and the collapsed rail hides the name — so THAT copy carries the accessible
      // label and this one stays decorative, rather than the picture and the word saying
      // the same thing twice to a screen reader. CSS picks which is visible; both are in
      // the DOM because the rail toggles without a re-render.
      brandMark(20, { compact: true }),
      el("span", { class: "wordmark-label" }, "Wiz SIDEKICK AI"),
      brandMark(28, { compact: true, label: "Wiz SIDEKICK AI" }),
      railToggle),
  );
  // Above the nav, below the wordmark: the scope applies to every page in the list under
  // it, so it reads as a heading for the nav rather than as one page's filter. Returns
  // null when there is no register to slice — including the `renderSidebar(sidebar, null)`
  // boot-failure path, where offering a picker over data we could not fetch would be a
  // control with nothing behind it.
  const scopeSwitch = projectScopeControl(data, pickProjectScope);
  if (scopeSwitch) sidebar.append(scopeSwitch);
  const { route: active } = parseHash();
  let lastGroup = null;
  for (const [key, page] of Object.entries(PAGES)) {
    // A gated page is absent, not disabled: the rest of this rail is the security workflow,
    // and a greyed-out row inside it would still be telling every reader that a model they
    // cannot open exists. The "Labs" heading goes with it for free — the lastGroup detector
    // below only emits a header when a page that is actually being drawn changes group.
    if (page.experimental && !showExperimental()) continue;
    if (page.group !== lastGroup) {
      sidebar.append(el("div", { class: "nav-group" }, page.group));
      lastGroup = page.group;
    }
    sidebar.append(
      el(
        "a",
        {
          class: `nav-link${key === active ? " active" : ""}`,
          href: `#/${key}`,
          // index.html sets <base target="_top"> so external links escape the GAS
          // sandbox iframe; _self keeps hash routing in-frame.
          target: "_self",
          "aria-current": key === active ? "page" : null,
        },
        iconSpan(ROUTE_ICONS[key]),
        el("span", { class: "nav-label" }, page.title),
      ),
    );
  }

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
  // Re-apply the persisted collapsed state — the rail is rebuilt wholesale on every
  // refresh(), so the class + width + per-link titles must be re-stamped each time.
  applyCollapsed(sidebarCollapsed);
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
async function pickProjectScope(id) {
  // The rail is rebuilt by refresh(), so a second pick mid-flight would race a control
  // that is about to be replaced underneath it.
  if (scopeSwitchInFlight) return;
  scopeSwitchInFlight = true;
  try {
    await call("api_setSettings", { projectView: id });
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
  const seq = ++routeSeq;
  const parsed = parseHash();
  let key = parsed.route;
  let params = parsed.params;
  // A gated route is not merely unavailable, it is a link the reader followed in good faith
  // — so unlike the unknown-route fallback below, this one REWRITES the hash. The bare
  // fallback would leave `#/aars` in the address bar over a page titled "Security Graph"
  // with no nav item marked current: three answers to "where am I", two of them wrong. The
  // stale params go with it; they were addressed to a page that is not rendering.
  // replaceState rather than a navigate(): no spurious history entry, no second route pass,
  // and store.js's setParams already proves it works inside the HtmlService iframe.
  if (PAGES[key] && PAGES[key].experimental && !showExperimental()) {
    key = "graph";
    params = {};
    history.replaceState(null, "", buildHash(key, params));
  }
  const page = PAGES[key] || PAGES.graph;
  document.title = `${page.title} — Wiz SIDEKICK AI`;
  document.querySelectorAll(".nav-link").forEach((a) => {
    const isActive = a.getAttribute("href") === `#/${key}`;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  // Before the DOM goes: cancel the outgoing page's pending work, so a debounced
  // callback cannot fire into a page that no longer exists.
  runPageTeardown();
  // The hover card is portaled to <body>, so it is the one piece of UI a page teardown does
  // not reach on its own. A definition left hanging over the next page would be explaining
  // something that is no longer on screen.
  closeTip();
  clear(mainEl);
  mainEl.classList.toggle("full-bleed", !!page.fullBleed);
  // The first render after a boot is covered by the boot splash → page skeleton, so it skips
  // the veil to avoid stacking two loaders; later navigations use it as normal.
  const useOverlay = !firstRoute;
  if (useOverlay) beginRouteLoading();
  try {
    await page.render(mainEl, params, { refresh });
  } catch (e) {
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
