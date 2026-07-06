// Wiz Sidekick SPA shell: sidebar navigation, scan zone, hash router.

import { call } from "./api.js";
import { bootstrap, invalidateBootstrap, parseHash } from "./store.js";
import { clear, el, statusPill, toast } from "./ui.js";
import { renderOverview } from "./pages/overview.js";
import { renderMttr } from "./pages/mttr.js";
import { renderHistory } from "./pages/history.js";
import { renderReports } from "./pages/reports.js";
import { renderExports } from "./pages/exports.js";
import { renderSettings } from "./pages/settings.js";

const PAGES = {
  overview: { title: "OS vulnerabilities", group: "Security", render: renderOverview },
  mttr: { title: "MTTR & SLA", group: "Security", render: renderMttr },
  scan_history: { title: "Scan History", group: "Security", render: renderHistory },
  reports: { title: "Reports", group: "Data", render: renderReports },
  exports: { title: "Exports", group: "Data", render: renderExports },
  settings: { title: "Settings", group: "Preferences", render: renderSettings },
};

const app = document.getElementById("app");
let mainEl = null;
let jobPoller = null;

async function boot() {
  clear(app);
  const sidebar = el("nav", { class: "sidebar", "aria-label": "Main navigation" });
  mainEl = el("main", { id: "main" });
  app.append(sidebar, mainEl);
  mainEl.append(el("p", { class: "muted" }, "Loading…"));

  let data;
  try {
    data = await bootstrap();
  } catch (e) {
    clear(mainEl).append(
      el("div", { class: "empty" },
        el("div", {}, "Couldn't reach the server."),
        el("div", { class: "small", style: "margin-top:6px" }, String(e.message || e)),
      ),
    );
    renderSidebar(sidebar, null);
    return;
  }
  renderSidebar(sidebar, data);
  route();
}

function renderSidebar(sidebar, data) {
  clear(sidebar);
  sidebar.append(
    el("div", { class: "wordmark" }, el("span", { class: "wordmark-dot", "aria-hidden": "true" }), "Wiz Sidekick"),
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
        page.title,
      ),
    );
  }

  // Scan zone
  const zone = el("div", { class: "scan-zone" });
  const runBtn = el("button", { class: "primary", onclick: () => startScan(false, runBtn) }, "Run scan");
  const quickBtn = el(
    "button",
    {
      onclick: () => startScan(true, quickBtn),
      title: "Fetch only findings changed since the last full scan and merge them in. " +
        "Deletions aren't detected — run a full scan for those.",
    },
    "Quick refresh",
  );
  zone.append(runBtn, quickBtn);
  if (data) {
    zone.append(
      el("div", { class: "scan-caption" },
        data.hasCredentials
          ? statusPill("ok", "Credentials loaded")
          : statusPill("neutral", "Dry-run (no credentials)"),
      ),
    );
    if (data.latestScan) {
      const age = Math.floor((Date.now() - Date.parse(data.latestScan.ts)) / 86400000);
      zone.append(
        el("div", { class: "scan-caption" },
          `Last scan ${data.latestScan.ts.slice(0, 16).replace("T", " ")} UTC` +
            (age >= 2 ? ` — ${age} days ago` : ""),
        ),
      );
    } else {
      zone.append(el("div", { class: "scan-caption" }, "No scan saved yet."));
    }
    if (data.activeJob) watchJob(data.activeJob.job_id);
  }
  sidebar.append(zone);
}

async function startScan(incremental, btn) {
  btn.disabled = true;
  try {
    const res = await call("api_runScan", { incremental });
    toast(res.message);
    if (res.jobId) watchJob(res.jobId);
    else refresh();
  } catch (e) {
    toast(String(e.message || e), "error");
  } finally {
    btn.disabled = false;
  }
}

function watchJob(jobId) {
  if (jobPoller) clearInterval(jobPoller);
  jobPoller = setInterval(async () => {
    try {
      const job = await call("api_getJobStatus", { jobId });
      if (!job) return stopWatch();
      if (job.phase === "DONE") {
        stopWatch();
        toast("Scan complete.");
        refresh();
      } else if (job.phase === "FAILED") {
        stopWatch();
        toast(job.error || "Scan failed.", "error");
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
  await boot();
}

async function route() {
  const { route: key, params } = parseHash();
  const page = PAGES[key] || PAGES.overview;
  document.title = `${page.title} — Wiz Sidekick`;
  // active nav state
  document.querySelectorAll(".nav-link").forEach((a) => {
    const isActive = a.getAttribute("href") === `#/${key}`;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  clear(mainEl);
  try {
    await page.render(mainEl, params, { refresh });
  } catch (e) {
    clear(mainEl).append(
      el("div", { class: "empty" },
        el("div", {}, "This page failed to load."),
        el("div", { class: "small", style: "margin-top:6px" }, String(e.message || e)),
      ),
    );
  }
}

window.addEventListener("hashchange", route);
boot();
