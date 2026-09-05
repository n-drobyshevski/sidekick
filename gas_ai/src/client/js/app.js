// Wiz Sidekick AI: the manifest, the route table, and the sync battery.
//
// THE SHELL AROUND ALL THREE IS SHARED. `gas_shared/shell/` owns the boot splash, the app
// header, the two-tier nav, the flyout panel, the route overlay and the hash router — one
// copy for three registers, where there were three copies of ~1,500 lines that had already
// drifted in four places that mattered. What is left in this file is what is genuinely this
// app's: what it is called, which pages it has, its scope seam, and the sync battery.
//
// THE HEADER CARRIES IDENTITY AND SCOPE, and nothing else. The reference screen puts a
// search box, notification icons and an avatar along the same bar; none of those has
// anything behind it here, and a control with nothing behind it is the one thing this app's
// chrome is careful never to offer (see ui/projectScope.js). The sync controls stay in the
// rail, where they have always been and where the last-sync caption can afford its words.

import { configureApp } from "../../../../gas_shared/appConfig.js";
import { call } from "../../../../gas_shared/api.js";
import { bootstrapCached } from "../../../../gas_shared/store.js";
import { createAppShell } from "../../../../gas_shared/shell/appShell.js";
import { renderSyncCard, openSyncDetails } from "./syncProgress.js";
import { clear, el, statusPill, syncCaption, tipAnchor, toast } from "./ui.js";
import { projectScopeView, scopeChrome, scopeKinds } from "./ui/projectScope.js";
import { scopeControl } from "../../../../gas_shared/ui/scopeControl.js";
import { scopePayload } from "../../../../gas_shared/ui/scopeModel.js";
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
import { panelBlocksFor } from "./navPanels.js";
import { SAVED_VIEW_KEYS, readSavedViews } from "./savedViews.js";
import { findEntry } from "./helpContent.js";

// ============================================================================ the manifest
//
// WHAT THIS APP IS, handed to the shared core (gas_shared/appConfig.js) before anything
// else in this module body runs.
//
// The shared modules cannot reach sideways into an app: `gas_shared/ui/tip.js` has no
// `../helpContent.js` to import and `gas_shared/store.js` cannot know which route is this
// register's front door. Those answers travel as data instead, handed over by the
// `configureApp()` call BELOW THE PAGES TABLE — the manifest now carries PAGES, which is
// declared after it, and everything between the two is a declaration rather than a call. That
// is what appConfig.js's rule 1 is actually about: nothing may READ the manifest before it is
// set, and no shared module reads it at import time (rule 2), so the first possible read is
// still after `configureApp` runs.
const MANIFEST = {
  // ONE SPELLING, and it used to be two. The shell said "Wiz SIDEKICK AI" in three places
  // (splash label, appbar wordmark, document.title) while the mark's own doc comment and
  // src/server/pageShell.ts spelled it in prose; the caps were a leftover from the PoC
  // header, not a wordmark rule — nothing sets text-transform on .appbar-name. The manifest
  // is now the only place the product is named, so the surfaces cannot drift again.
  productName: "Wiz Sidekick AI",
  // What the splash says it is opening. This register's front door IS a graph — the asset
  // graph every page is a lens on — so unlike the DevSecOps sibling, the inherited noun is
  // the right one here. It reaches the STATIC first paint too:
  // gas_shared/shell/renderIndex.js substitutes it into the shared index template at build
  // time, so the two copies of the splash cannot disagree.
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
  // The nav marks, read by gas_shared/shell/navRail.js (the rail and the stacked list) and
  // gas_shared/shell/navFlyout.js (the panel's rows). routeIcons.js is still the only place
  // they are drawn; the manifest is how the shared shell reaches them.
  LANE_ICONS,
  ROUTE_ICONS,
  // What this register's panels list beyond their page rows. The only one of the three that
  // has any — see navPanels.js for why they are the app's knowledge and not the shell's.
  panelBlocks: panelBlocksFor,
};
// The rail's information architecture, stated once.
//
// THREE LANES, A GATE AND A TAIL. Every page in this app is a security page, so "Security"
// as a heading distinguished nothing while holding six of them; what a reader actually
// chooses between is the landscape (what we have), the risk in it (what is open, and what
// to do first) and what we can state about it (how we score, and where the figures came
// from). Those are the three labelled lanes. `Labs` is the gate. The tail — `group: null` —
// is chrome, separated by a rule and never labelled.
//
// Two rules the shared shell depends on, both held by test/shared.test.js:
//   * A LABELLED LANE EARNS ITS HEADING BY HOLDING TWO PAGES. `Labs` is the one exception,
//     because there the heading IS the statement — it says the page sits outside the
//     security workflow rather than beside it — and it is drawn only when the gate is open.
//     That carve-out is `singletonLanes: ["Labs"]` in test/shared.test.js.
//   * LANES ARE CONTIGUOUS. The lastGroup detector emits a fresh heading every time
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
// page is drawn as that page rather than as a lane — see gas_shared/shell/navModel.js, which
// is where the three meet. Both of those are why hiding routes degrades the rail gracefully
// instead of leaving lane headings standing over nothing.
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

// PAGES JOINS THE MANIFEST, AND THAT IS WHY THIS CALL MOVED DOWN A TABLE.
// `gas_shared/ui/controls.js`'s `pageHeader({ route })` reads a route's own title and lane out
// of `appConfig().PAGES`, so the `<h1>` on every page IS the PAGES title by construction
// rather than by a second copy of the string sitting in the page module. PAGES is declared
// below the manifest, so it is spread in here instead of named inside it.
//
// STILL BEFORE ANY SHARED FUNCTION RUNS, which is the rule appConfig.js's rule 1 actually
// protects: everything between the manifest literal and this line is a declaration or an
// object literal — no call — and no shared module reads the manifest at import time (rule 2).
configureApp({ ...MANIFEST, PAGES });

// Nav icons (ROUTE_ICONS, LANE_ICONS) live in routeIcons.js — see that module for why.
// Circular-arrows glyph for the primary "Sync now" button; on the icon rail it is the icon
// alone (its .btn-label is hidden there by CSS).
const SYNC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 0-13.7-5L4 8.5"/><path d="M4 4.5v4h4"/><path d="M4 12.5a8 8 0 0 0 13.7 5L20 15.5"/><path d="M20 19.5v-4h-4"/></svg>';

// A span carrying an inline SVG (el() builds HTML nodes, so SVG goes in via innerHTML).
function iconSpan(svg) {
  const s = el("span", { class: "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

// --------------------------------------------------------------------- the sync battery

let jobPoller = null;
let syncCardHost = null;
let syncButtonsRow = null;
let stoppingJobId = null;
let lastJob = null;
let syncDetails = null; // open sync-details drawer handle, kept live by the poller

/** The sync zone under the nav: the freshness caption, the credentials state, and the run
 *  control. Rebuilt on every rail render, so the two hosts are re-pointed each time. */
function renderSyncZone(data) {
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
    // `syncCaption` (gas_shared/ui/feedback.js), unified across all three apps: "Last <noun>
    // <datetime> · <relativeAge>" once a sync is saved, "No <noun>s yet." before the first
    // one. It used to be a bare Math.floor day count gated at `age >= 2` — a sync an hour old
    // showed no age at all.
    zone.append(
      el("div", { class: "scan-caption" },
        syncCaption(data.latestSync && data.latestSync.finished_at)),
    );
    if (data.activeJob) {
      paintCard(data.activeJob);
      watchJob(data.activeJob.job_id);
    }
  }
  return zone;
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

// ------------------------------------------------------------------------- the scope seam

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

/**
 * The header's scope control, or null when there is no register to slice — including the
 * boot-failure path, where offering a picker over data we could not fetch would be a control
 * with nothing behind it.
 *
 * The control is `gas_shared/ui/scopeControl.js`; `ui/projectScope.js` says what this
 * register's two dimensions are. `scopePayload` turns the picked option value straight into
 * the `api_setSettings` argument — `{projectView}` or `{domainView}` — so the prefix stays
 * the control's own and nothing below the seam learned a new encoding.
 */
function appbarScope(data) {
  const kinds = scopeKinds(data);
  const chrome = scopeChrome(data);
  return scopeControl(
    projectScopeView(data),
    { ...chrome, kinds },
    (value) => pickProjectScope(scopePayload(kinds, chrome, value)),
  );
}

/**
 * What the nav panel has to list, gathered from what the shell already holds.
 *
 * A function rather than a snapshot: `comboLegend` is settled once per boot, but the saved
 * views are written by the reader mid-session, and a panel that only learned about them on
 * the next full reload would be a menu that forgets what you just told it. Nothing here
 * fetches — hovering a rail item costs a localStorage read and an object walk, never a round
 * trip. navPanels.js turns this into the panel's blocks.
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

// ------------------------------------------------------------------------------ the shell

const shell = createAppShell({
  pages: PAGES,
  appbarScope,
  railFooter: renderSyncZone,
  navContext,
});

export const refresh = shell.refresh;

window.addEventListener("hashchange", shell.route);
shell.boot();
