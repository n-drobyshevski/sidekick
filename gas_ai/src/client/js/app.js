// Wiz SIDEKICK AI SPA shell: sidebar navigation, sync zone, hash router.

import { call } from "./api.js";
import { renderSyncCard, openSyncDetails } from "./syncProgress.js";
import { bootstrap, invalidateBootstrap, invalidateRpcCache, parseHash } from "./store.js";
import { clear, el, fmtDateTime, progressBar, statusPill } from "./ui.js";
import { toast } from "./ui.js";
import { renderGraphPage } from "./pages/graph.js";
import { renderInventory } from "./pages/inventory.js";
import { renderCombos } from "./pages/combos.js";
import { renderScans } from "./pages/scans.js";
import { renderData } from "./pages/data.js";
import { renderSettings } from "./pages/settings.js";

const PAGES = {
  // fullBleed: the page owns the whole content pane (no main padding/max-width).
  graph: { title: "Security Graph", group: "Security", render: renderGraphPage, fullBleed: true },
  inventory: { title: "AI Inventory", group: "Security", render: renderInventory },
  combos: { title: "Toxic Combinations", group: "Security", render: renderCombos },
  scans: { title: "Wiz Scans", group: "Coverage", render: renderScans },
  data: { title: "Data", group: "Data", render: renderData },
  settings: { title: "Settings", group: "Preferences", render: renderSettings },
};

// Inline nav icons (one per page) — the client has no icon system, so these are small
// stroke SVGs drawn on currentColor, inlined (the GAS/CSP sandbox blocks icon fonts/CDNs).
// 24-grid, rendered at 18px. Used both expanded (icon + label) and collapsed (icon only).
const NAV_ICONS = {
  graph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="7" r="2.3"/><circle cx="18.5" cy="6" r="2.3"/><circle cx="12" cy="17.5" r="2.3"/><path d="M7.6 8.1l3 7.3"/><path d="M16.6 7.7l-3.3 8"/><path d="M7.7 7.2l8.6-0.7"/></svg>',
  inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4-8 4-8-4z"/><path d="M4 11l8 4 8-4"/><path d="M4 15l8 4 8-4"/></svg>',
  combos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5l8 14H4z"/><path d="M12 10v4.2"/><path d="M12 16.8h.01"/></svg>',
  scans: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-4.3-7.1"/><path d="M12 12l5.2-3.2"/><circle cx="12" cy="12" r="1"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.3" ry="2.8"/><path d="M4.7 5.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/><path d="M4.7 11.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5h8"/><path d="M16 7.5h4"/><circle cx="14" cy="7.5" r="2"/><path d="M4 16.5h4"/><path d="M12 16.5h8"/><circle cx="10" cy="16.5" r="2"/></svg>',
};
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
    toggle.setAttribute("title", collapsed ? "Expand sidebar" : "Collapse sidebar");
  }
  sidebar.querySelectorAll(".nav-link").forEach((a) => {
    const label = a.querySelector(".nav-label");
    if (collapsed && label) a.setAttribute("title", label.textContent);
    else a.removeAttribute("title");
  });
}

const app = document.getElementById("app");
let mainEl = null;
let sidebarCollapsed = loadCollapsed();

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
        el("span", { class: "wordmark-dot", "aria-hidden": "true" }),
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
      el("span", { class: "wordmark-dot", "aria-hidden": "true" }),
      el("span", { class: "wordmark-label" }, "Wiz SIDEKICK AI"),
      railToggle),
  );
  const { route: active } = parseHash();
  let lastGroup = null;
  for (const [key, page] of Object.entries(PAGES)) {
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
        iconSpan(NAV_ICONS[key]),
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
      el("span", {
        class: `rail-status-dot ${data.hasCredentials ? "ok" : "neutral"}`,
        "aria-hidden": "true",
        title: data.hasCredentials ? "Credentials loaded" : "Dry-run (no credentials)",
      }),
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
  const { route: key, params } = parseHash();
  const page = PAGES[key] || PAGES.graph;
  document.title = `${page.title} — Wiz SIDEKICK AI`;
  document.querySelectorAll(".nav-link").forEach((a) => {
    const isActive = a.getAttribute("href") === `#/${key}`;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
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
