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

const app = document.getElementById("app");
let mainEl = null;

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
  sidebar.append(
    el("div", { class: "wordmark" },
      el("span", { class: "wordmark-dot", "aria-hidden": "true" }),
      "Wiz SIDEKICK AI"),
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
        page.title,
      ),
    );
  }

  // Sync zone
  const zone = el("div", { class: "scan-zone" });
  const runBtn = el("button", { class: "primary", onclick: () => startSync(runBtn) }, "Sync now");
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
