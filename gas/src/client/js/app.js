// Wiz Sidekick OS SPA shell: sidebar navigation, scan zone, hash router.

import { call } from "./api.js";
import { renderScanCard, openScanDetails } from "./scanProgress.js";
import { bootstrap, invalidateBootstrap, invalidateRpcCache, parseHash } from "./store.js";
import { clear, el, filterCombobox, fmtDateTime, progressBar, statusPill, toast } from "./ui.js";
import { renderOverview } from "./pages/overview.js";
import { renderMttr } from "./pages/mttr.js";
import { renderHistory } from "./pages/history.js";
import { renderData } from "./pages/data.js";
import { renderSettings } from "./pages/settings.js";
import { renderAttribution } from "./pages/attribution.js";

// Order matters: the sidebar nav renders pages in this insertion order (grouped by
// `group`), and the first key is the app's default landing page (see store.parseHash).
const PAGES = {
  mttr: { title: "MTTR & SLA", group: "Security", render: renderMttr },
  overview: { title: "OS vulnerabilities", group: "Security", render: renderOverview },
  scan_history: { title: "Scan History", group: "Security", render: renderHistory },
  attribution: { title: "Attribution", group: "Security", render: renderAttribution },
  data: { title: "Data", group: "Data", render: renderData },
  settings: { title: "Settings", group: "Preferences", render: renderSettings },
};

// Inline nav icons (one per page) — the client has no icon system, so these are small
// stroke SVGs drawn on currentColor, inlined (the GAS/CSP sandbox blocks icon fonts/CDNs).
// 24-grid, rendered at 18px. Used both expanded (icon + label) and collapsed (icon only).
const NAV_ICONS = {
  mttr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5"/><path d="M12 13.5l3 2"/><path d="M9.5 3.5h5"/></svg>',
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2l7 2.4v5.2c0 4.2-2.9 7-7 8.4-4.1-1.4-7-4.2-7-8.4V5.6z"/><path d="M12 8.5v3.4"/><path d="M12 15h.01"/></svg>',
  scan_history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M3.5 4.5V9h4.5"/><path d="M12 8.5v4l2.8 1.7"/></svg>',
  attribution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5h6.5l9 9-6.5 6.5-9-9z"/><path d="M8 8.5h.01"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.3" ry="2.8"/><path d="M4.7 5.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/><path d="M4.7 11.5v6c0 1.55 3.27 2.8 7.3 2.8s7.3-1.25 7.3-2.8v-6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5h8"/><path d="M16 7.5h4"/><circle cx="14" cy="7.5" r="2"/><path d="M4 16.5h4"/><path d="M12 16.5h8"/><circle cx="10" cy="16.5" r="2"/></svg>',
};
const RUN_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>';
const CHEVRON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>';

// A span carrying an inline SVG (el() builds HTML nodes, so SVG goes in via innerHTML).
function iconSpan(svg, cls) {
  const s = el("span", { class: cls || "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

// Collapsed-rail preference — persisted like the MTTR trend window (own try/catch, since a
// GAS iframe sandbox can block web storage). Desktop-only: the <=800px top-bar layout
// ignores the .collapsed class (see styles.css), so a stored flag is simply inert there.
const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";
function loadCollapsed() {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"; } catch { return false; }
}
function saveCollapsed(v) {
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? "1" : "0"); } catch { /* sandboxed */ }
}
// Reflect the flag onto the (rebuilt-on-refresh) rail DOM. Width rides the shared --rail-w
// custom property so the flex main pane and the reload overlay's left edge track it for
// free. Collapsed nav links get a native title = their label (the visible text is hidden).
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
// The global "Value Chain" filter, shared by every page. "" = the whole chain (no
// filter). Module-level so it survives route() (which only re-renders mainEl, never
// the sidebar) and page navigation — nav links carry no state.
let activeDomain = "";
// The global "Support group" filter, shared by every page the same way. "" = all groups.
let activeSupportGroup = "";
// Live handles to the two sidebar filterCombobox() wrappers, rebuilt each refresh() —
// held so clearScope() can reset their shown label/active state via wrapper.setValue()
// without hunting the DOM (a combobox has no <select> to look up by id/value).
let domainCombobox = null;
let supportCombobox = null;

// Toggle the scan-zone's "filtering" accent to match the active global filters.
function syncScanZoneFiltering() {
  const zone = document.querySelector(".scan-zone");
  if (zone) zone.classList.toggle("filtering", !!(activeDomain || activeSupportGroup));
}

// Clear one global filter from a page-header scope chip: reset the state, sync the
// matching sidebar combobox (shown label + active accent) via its setValue(), and
// re-render the active page.
function clearScope(kind) {
  if (kind === "domain") activeDomain = "";
  else if (kind === "supportGroup") activeSupportGroup = "";
  if (domainCombobox) domainCombobox.setValue(activeDomain);
  if (supportCombobox) supportCombobox.setValue(activeSupportGroup);
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
        el("span", { class: "wordmark-dot", "aria-hidden": "true" }),
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
      el("span", { class: "wordmark-label" }, "Wiz Sidekick OS"),
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
          // sandbox iframe. Without an explicit _self, hash links inherit it and
          // navigate the top window to the sandbox's own googleusercontent URL —
          // which, loaded bare, is a blank page. _self keeps routing in-frame.
          target: "_self",
          "aria-current": key === active ? "page" : null,
        },
        iconSpan(NAV_ICONS[key]),
        el("span", { class: "nav-label" }, page.title),
      ),
    );
  }

  // Scan zone — carries a subtle "filtering" accent when a global filter is active, so
  // the source of a scoped view is visible where the selects live (the scopeBar in the
  // content pane is the primary cue).
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
      // Compact stand-in for the pill above, shown only while the rail is collapsed (the
      // captions are hidden then) so the credentials/dry-run state stays glanceable.
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

  // Global "Value Chain" filter — one searchable combobox shared by every page, at the
  // top of the bottom cluster (above the scan controls). Only shown when more than one
  // value chain is configured; otherwise every page is already the whole chain. The
  // sidebar (and this filter with it) is rebuilt wholesale on every refresh(), so the
  // handle is re-created and re-stashed here each time too.
  domainCombobox = null;
  if (data && data.domainNames && data.domainNames.length > 1) {
    // Drop a stale selection if its value chain was removed from settings.
    if (activeDomain && !data.domainNames.includes(activeDomain)) activeDomain = "";
    domainCombobox = filterCombobox({
      value: activeDomain,
      options: data.domainNames,
      defaultLabel: "Value Chain",
      ariaLabel: "Filter by value chain",
      variant: "domain",
      onChange: (v) => {
        activeDomain = v;
        syncScanZoneFiltering();
        route();
      },
    });
    // No visible label — the default option reads "Value Chain" and the trigger keeps
    // its aria-label for assistive tech. The --domain modifier (set by filterCombobox)
    // keeps this filter reachable in the collapsed icon rail (as a funnel trigger);
    // Support group has its own --support modifier for the same purpose, below.
    zone.prepend(domainCombobox);
  }

  // Global "Support group" filter — a second sidebar combobox alongside Value Chain,
  // driven by the subscriptions' Wiz/provisioning tag. Shown only when the scan surfaced
  // at least one support group (i.e. the map has been refreshed and joined). A
  // deployment can have ~20 groups, so this is the one that actually needs the
  // combobox's adaptive search box (searchThreshold defaults to 7).
  const groups = (data && data.filterOptions && data.filterOptions.supportGroups) || [];
  supportCombobox = null;
  if (groups.length) {
    if (activeSupportGroup && !groups.includes(activeSupportGroup)) activeSupportGroup = "";
    supportCombobox = filterCombobox({
      value: activeSupportGroup,
      options: groups,
      defaultLabel: "All support groups",
      searchPlaceholder: "Search support groups…",
      ariaLabel: "Filter by support group",
      variant: "support",
      onChange: (v) => {
        activeSupportGroup = v;
        syncScanZoneFiltering();
        route();
      },
    });
    // Visible "Support group" label above the trigger, expanded-rail only — the combobox
    // wrapper already carries the sidebar-filter--support modifier the collapsed CSS
    // hides this label inside (matching the funnel filter, which has no visible label).
    supportCombobox.prepend(el("label", { class: "field-label" }, "Support group"));
    zone.prepend(supportCombobox);
  }
  sidebar.append(zone);
  // Re-apply the persisted collapsed state — the rail is rebuilt wholesale on every
  // refresh(), so the class + width + per-link titles must be re-stamped each time.
  applyCollapsed(sidebarCollapsed);
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

/** Render the progress card for a job and hide the Run/Quick buttons. */
function paintCard(job) {
  if (!scanCardHost) return;
  lastJob = job;
  const stopping = stoppingJobId === job.job_id && job.phase !== "CANCELLED";
  renderScanCard(scanCardHost, job, {
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
  if (scanButtonsRow) scanButtonsRow.style.display = "none";
}

function clearCard() {
  scanDetails = null; // drop the stale drawer handle once the card is gone
  if (scanCardHost) clear(scanCardHost);
  if (scanButtonsRow) scanButtonsRow.style.display = "";
}

async function requestStop(jobId) {
  stoppingJobId = jobId;
  if (lastJob && lastJob.job_id === jobId) paintCard(lastJob); // instant "Stopping…"
  try {
    const res = await call("api_cancelScan", { jobId });
    toast(res.message || "Stopping scan…");
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
  const page = PAGES[key] || PAGES.mttr;
  document.title = `${page.title} — Wiz Sidekick OS`;
  // active nav state
  document.querySelectorAll(".nav-link").forEach((a) => {
    const isActive = a.getAttribute("href") === `#/${key}`;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  clear(mainEl);
  // The first render after a boot is covered by the boot splash → page skeleton, so it skips
  // the veil to avoid stacking two loaders; later navigations use it as normal.
  const useOverlay = !firstRoute;
  if (useOverlay) beginRouteLoading();
  try {
    await page.render(mainEl, params, {
      refresh, clearScope, domain: activeDomain, supportGroup: activeSupportGroup,
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
