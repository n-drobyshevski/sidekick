// Wiz Sidekick DevSecOps: the manifest, the route table, and the sync battery.
//
// THE SHELL AROUND ALL THREE IS SHARED. `gas_shared/shell/` owns the boot splash, the app
// header, the two-tier nav, the flyout panel, the route overlay and the hash router — one
// copy for three registers, where there were three copies of ~1,500 lines that had already
// drifted in four places that mattered. What is left in this file is what is genuinely this
// app's: what it is called, which pages it has, and the sync battery.
//
// THE HEADER CARRIES IDENTITY AND SCOPE, AND NOTHING ELSE. The reference screen puts a search
// box, notification icons and an avatar along the same bar; none of those has anything behind
// it here, and a control with nothing behind it is the one thing this app's chrome is careful
// never to offer. The project-scope switcher (ui/projectScope.js) earns the exception a page
// filter would not: it governs every page rather than leading to one, so it is chrome in the
// same sense the wordmark is. The sync controls stay in the rail, where the last-sync caption
// can afford its words.

import { configureApp } from "../../../../gas_shared/appConfig.js";
import { call } from "../../../../gas_shared/api.js";
import { swrCall } from "../../../../gas_shared/store.js";
import { createAppShell } from "../../../../gas_shared/shell/appShell.js";
import { openSyncDetails, renderSyncCard, shouldContinuePolling } from "./syncProgress.js";
import {
  clear, confirmDialog, el, statusPill, syncCaption, tipAnchor, toast,
} from "./ui.js";
import { projectScopeView, scopeChrome, scopeKinds } from "./ui/projectScope.js";
import { scopeControl } from "../../../../gas_shared/ui/scopeControl.js";
import { scopePayload } from "../../../../gas_shared/ui/scopeModel.js";
import { renderExecutive } from "./pages/executive.js";
import { renderMttr } from "./pages/mttr.js";
import { renderProgram } from "./pages/program.js";
import { renderSca } from "./pages/sca.js";
import { renderSast } from "./pages/sast.js";
import { renderSecrets } from "./pages/secrets.js";
import { renderRepos } from "./pages/repos.js";
import { renderHistory } from "./pages/history.js";
import { renderData } from "./pages/data.js";
import { renderHelp } from "./pages/help.js";
import { renderSettings } from "./pages/settings.js";
import { LANE_ICONS, ROUTE_ICONS } from "./routeIcons.js";
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
  productName: "Wiz Sidekick DevSecOps",
  // What the splash says it is opening. "register", not "graph": this app has no graph, and
  // the word was inherited from the sibling it was forked from. It reaches the STATIC first
  // paint too — gas_shared/shell/renderIndex.js substitutes it into the shared index template
  // at build time, so the two copies of the splash cannot disagree again.
  openingNoun: "register",
  // Trailing dot included. Two sidekicks served from the same origin must not share a key.
  storagePrefix: "sidekickdso.",
  // The first key of PAGES below, and the only place the two can disagree — which is what
  // test/shared.test.js's navGroups contract checks.
  defaultRoute: "executive",
  // This register's own vocabulary. ui/tip.js asks; helpContent.js answers.
  findHelpEntry: findEntry,
  // The nav marks, read by gas_shared/shell/navRail.js (the rail and the stacked list) and
  // gas_shared/shell/navFlyout.js (the panel's rows). routeIcons.js is still the only place
  // they are drawn; the manifest is how the shared shell reaches them.
  LANE_ICONS,
  ROUTE_ICONS,
  // No `panelBlocks`: none of this app's three lanes has instances of its own beyond the
  // pages it already groups — no saved queries, no per-lane collection to list — so every
  // panel is plain page links. gas_shared/shell/navModel.js returns no blocks for an app that
  // supplies no builder, which is the honest answer rather than a stub.
};
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
// word "Overview" directly above a single link reading "Executive". shared.test.js
// caught it. Executive belongs with the other two anyway: all three are programme-level
// reads over the whole population, and the registers below ARE that population.
//
// Two rules the shared shell depends on, both held by test/shared.test.js:
//   * A LABELLED LANE EARNS ITS HEADING BY HOLDING TWO PAGES. A lane left holding one
//     visible page is drawn AS that page — see gas_shared/shell/navModel.js.
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
// rail — see gas_shared/shell/navModel.js, which is where the three meet.
const PAGES = {
  // The front door, and MANIFEST.defaultRoute names it. A leader opens the app wanting
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
  // The book, not the record: helpContent.js's whole glossary, searchable and deep-linkable
  // — where every glossaryTip's "Enter for the full definition" has always pointed
  // (ui/tip.js), landing on nothing until this route existed. Last in the lane because a
  // reader reaches for it only after wanting to check a word, never on the way in.
  help: { title: "Key sheet", group: "Data", render: renderHelp },

  // The tail: chrome, not a lane. A rule separates it and nothing labels it.
  settings: { title: "Settings", group: null, render: renderSettings },
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

// A span carrying an inline SVG (el() builds HTML nodes, so SVG goes in via innerHTML).
function iconSpan(svg) {
  const s = el("span", { class: "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

// The Run Sync button's glyph — two arrows chasing each other, the universal "sync" mark. Not
// in routeIcons.js (that module is PAGES/lane marks only, held one-for-one by
// test/shared.test.js) and not in gas_shared/ui/uiIcons.js (this file may compose from the
// shared package but not edit it), so it lives here, drawn in the same
// 24-grid/currentColor/aria-hidden convention routeIcons.js uses.
const SYNC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5l2.4 2.2"/><path d="M17.6 5.4V9h-3.6"/>' +
  '<path d="M19.5 12a7.5 7.5 0 0 1-12.6 5.5l-2.4-2.2"/><path d="M6.4 18.6V15H10"/></svg>';

// --------------------------------------------------------------------- the sync battery

// The sync zone rebuilds these two nodes on every rail render (boot, refresh, and every
// experimental-flag flip), so they are held at module scope and re-pointed each time — the
// poll interval and the job it is watching outlive any one rail render.
let syncCardHost = null;
let syncButtonsRow = null;
let jobPoller = null;
let lastJob = null; // the most recent job summary the poll has seen, or null between syncs
let stoppingJobId = null; // set while a Stop request is in flight, so the card can say so
let syncDetails = null; // the open details-drawer handle, kept live by the poller
// Guards the one-time "is a sync already running" probe: a page LOAD (not a route change,
// not an experimental-flag flip) is the only moment worth asking, since nothing else on this
// page can start a sync out from under the client without the client itself starting it.
let resumeChecked = false;

/**
 * THE SYNC ZONE, under the nav. Where the register's freshness caption lives, and where a
 * reader starts a sync and watches it walk sca, then sast, then secrets.
 *
 * Named for the act, not for the record it writes (README.md, above the Pages table). The
 * CSS class is still `.scan-zone` — renaming it is not a copy change, and nothing a reader
 * sees says "scan zone".
 */
function renderSyncZone(data) {
  const zone = el("div", { class: "scan-zone" });
  const hasCreds = !!(data && data.hasCredentials);
  const runBtn = el("button", {
    class: "primary",
    disabled: !hasCreds,
    onclick: () => startSync(runBtn),
  }, iconSpan(SYNC_ICON), el("span", { class: "btn-label" }, "Run sync"));
  // A button that fails on click is worse than no button (PRODUCT.md, principle 5: honest
  // state) — so with nothing to sync WITH, the button says so on hover/focus rather than
  // being clicked once to learn it. `.tip-disabled-wrap` (components.css), not the button
  // itself: a disabled element does not reliably take pointer/focus events for the tip to
  // hang off in every browser — see syncProgress.js's Stop button for the same wrap.
  const runControl = hasCreds
    ? runBtn
    : tipAnchor(el("span", { class: "tip-disabled-wrap" }, runBtn),
        "No Wiz credentials are configured — run setup() before syncing.");
  syncButtonsRow = el("div", { class: "scan-buttons" }, runControl);
  syncCardHost = el("div", {});
  zone.append(
    syncCardHost,
    syncButtonsRow,
    el("div", { class: "scan-caption" },
      hasCreds ? statusPill("ok", "Credentials loaded") : statusPill("neutral", "No credentials")),
    tipAnchor(el("span", {
      class: `rail-status-dot ${hasCreds ? "ok" : "neutral"}`,
      "aria-hidden": "true",
    }), hasCreds ? "Credentials loaded" : "No Wiz credentials configured"),
    // `syncCaption` (gas_shared/ui/feedback.js), unified across all three apps: "Last <noun>
    // <datetime> · <relativeAge>" once a sync is saved, "No <noun>s yet." before the first
    // one — this rail used to show the datetime with no relative age at all. `ts`, not
    // `finished_at`: the field is named for the `scans` column it is read from, and the old
    // name existed on neither side of the wire.
    el("div", { class: "scan-caption" },
      syncCaption(data && data.latestSync && data.latestSync.ts)),
  );
  // A rail rebuild (boot, refresh, or an experimental-flag flip) throws away the old
  // syncCardHost/syncButtonsRow nodes; if a sync is live, repaint the poller's last-known job
  // onto the fresh ones right away rather than showing an empty card until the next 3s tick.
  if (lastJob && shouldContinuePolling(lastJob)) paintCard(lastJob);
  // A page LOAD is the only moment worth asking "is a sync already running behind my back" —
  // nothing else that rebuilds the rail (a route change, an experimental-flag flip) can be
  // the reason one started, so this runs once per app lifetime, not once per rebuild.
  if (!resumeChecked) {
    resumeChecked = true;
    resumeActiveJob();
  }
  return zone;
}

// The sync battery's client half: start a sync, poll it, paint the card, and let a reader
// stop it. The pure state logic (which phase/scope reads as what) lives in syncProgress.js —
// ported from gas_ai/src/client/js/syncProgress.js — so only the RPC plumbing is here.

/** Run button handler: fire the RPC, then start (or hand off to) the poll. */
async function startSync(btn) {
  btn.disabled = true;
  try {
    const res = await call("api_runSync", {});
    toast(res.message);
    if (res.jobId) {
      stoppingJobId = null;
      watchJob(res.jobId);
    }
    // No jobId: nothing started (no credentials, or nothing selected in Settings) — the
    // toast already said why, and the button re-enables in the `finally` below.
  } catch (e) {
    toast(String(e.message || e), "error");
  } finally {
    btn.disabled = false;
  }
}

/** Paint the poller's latest job summary onto the card, and keep an open details drawer
 *  in step with it — otherwise its values freeze at the moment it was opened. */
function paintCard(job) {
  if (!syncCardHost) return;
  lastJob = job;
  const stopping = stoppingJobId === job.job_id && job.phase !== "CANCELLED";
  renderSyncCard(syncCardHost, job, {
    // Read lastJob at click time, not the job captured when this Details button was built —
    // renderSyncCard reuses the button across polls, so a captured job would be stale and the
    // drawer would flash 0 rows for one tick before the poller updates it.
    onDetails: () => {
      syncDetails = openSyncDetails(lastJob, { onStop: () => requestStop(lastJob.job_id) });
    },
    onStop: stopping ? null : () => requestStop(job.job_id),
    stopping,
  });
  if (syncDetails) syncDetails.update(job);
  if (syncButtonsRow) syncButtonsRow.style.display = "none";
}

/** Drop the card and any open drawer, and bring the Run button back. */
function clearCard() {
  lastJob = null;
  syncDetails = null;
  if (syncCardHost) clear(syncCardHost);
  if (syncButtonsRow) syncButtonsRow.style.display = "";
}

function stopWatch() {
  if (jobPoller) clearInterval(jobPoller);
  jobPoller = null;
}

/**
 * The 3s poll. THE STOP CONDITION IS `shouldContinuePolling` AND NOWHERE ELSE — a null job
 * (nothing running) and every terminal phase (DONE / FAILED / CANCELLED) clear the interval
 * before this function does anything else, which is what stops a poll outliving its job.
 *
 * Only DONE re-fetches the bootstrap payload and every cached RPC: a cancelled sync commits
 * nothing (scanJobs.ts — persistSync's append is the only commit, and Stop is cooperative only
 * during FETCHING, before it), so there is nothing on the ledger for `refresh()` to catch up on.
 */
function applyJob(job) {
  if (!shouldContinuePolling(job)) {
    stopWatch();
    if (job && job.phase === "DONE") {
      if (syncDetails) syncDetails.update(job); // let an open drawer settle on "Complete"
      toast("Sync complete.");
      clearCard();
      refresh();
    } else if (job && job.phase === "CANCELLED") {
      stoppingJobId = null;
      if (syncDetails) syncDetails.update(job); // an open drawer settles on "Cancelled"
      toast("Sync stopped.");
      clearCard();
    } else if (job && job.phase === "FAILED") {
      paintCard(job); // leave the failure on screen, with its error and a Details button
      if (syncButtonsRow) syncButtonsRow.style.display = ""; // let a retry start right away
      toast(job.error || "Sync failed.", "error");
    } else {
      clearCard(); // job === null: nothing running — never started, or the row was reclaimed
    }
    return;
  }
  paintCard(job);
}

/**
 * One poll tick, through store.js's `swrCall` rather than a bare `call()` — a revisit with the
 * same `{jobId}` resolves instantly from the session cache while the RPC refetches in the
 * background, and `onFresh` repaints the moment the revalidated summary actually differs. The
 * awaited return handles the very first tick (a cache miss, so it IS the fresh fetch); every
 * tick after that is a cache hit and its real update arrives through `onFresh` instead — both
 * paths funnel through the same `applyJob`, so the poll's stop condition is asked in one place.
 */
async function pollTick(jobId) {
  try {
    const job = await swrCall("api_getJobStatus", { jobId }, (fresh) => applyJob(fresh));
    applyJob(job);
  } catch {
    /* a transient poll failure is fine — the next tick tries again */
  }
}

function watchJob(jobId) {
  stopWatch();
  pollTick(jobId); // paint immediately rather than leaving the card blank for the first 3s
  jobPoller = setInterval(() => pollTick(jobId), 3000);
}

/** A page LOAD is the only time worth asking whether a sync is already running (a reload
 *  mid-walk, or a second tab) — `getJobStatus` with no jobId returns the server's own
 *  single-flight `activeJob()`, so this resumes the SAME poll a fresh Run click would start. */
async function resumeActiveJob() {
  try {
    const job = await swrCall("api_getJobStatus", {}, () => {});
    if (job && shouldContinuePolling(job)) watchJob(job.job_id);
  } catch {
    /* unreachable, or nothing active — nothing to resume either way */
  }
}

/** Stop button handler, behind a confirm — nothing fetched so far is committed until the
 *  scopes finish and persistSync runs, so stopping mid-fetch discards the walk so far. */
async function requestStop(jobId) {
  const ok = await confirmDialog({
    title: "Stop this sync?",
    body: "Nothing fetched so far has been saved — stopping now discards this run, and the " +
      "next sync starts over from the top of the register.",
    confirmLabel: "Stop sync",
    danger: true,
  });
  if (!ok) return;
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

// ------------------------------------------------------------------------- the scope seam

// Re-entry guard: the combobox commits on a single click/Enter, but the round trip to
// `api_setProjectView` and the `refresh()` after it are not instant, and the control does not
// disable itself mid-pick. Without this a fast double-pick could fire two `setProjectView`
// calls and two overlapping `refresh()`s racing to rebuild the same `<main>`.
let scopePickInFlight = false;

/**
 * The project-scope switcher's onPick: persist the new view scope, then let `refresh()` do
 * everything else. STORES NOTHING CLIENT-SIDE — the scope is server state (`settingsStore
 * .projectView`), so the client's only job here is to write it and invalidate what it cached.
 * A client-held copy would be a second source of truth for exactly the value this control
 * exists to keep singular.
 */
async function pickProjectScope(slug) {
  if (scopePickInFlight) return;
  scopePickInFlight = true;
  try {
    await call("api_setProjectView", { projectView: slug });
    await refresh();
  } catch (e) {
    toast(String(e.message || e), "error");
  } finally {
    scopePickInFlight = false;
  }
}

/**
 * The header's scope control, or null.
 *
 * `null` (boot failed) or an empty `filterOptions.projectList` (nothing synced yet) both
 * resolve to `show: false` inside projectScopeView — see that module for why an empty picker
 * is a promise the register cannot keep.
 *
 * The control is `gas_shared/ui/scopeControl.js`; `ui/projectScope.js` says what this
 * register's one dimension is. `scopePayload` turns the picked option value back into the
 * `{projectView}` object `api_setProjectView` has always taken, so nothing below the seam
 * learned a new encoding.
 */
function appbarScope(data) {
  const kinds = scopeKinds(data);
  const chrome = scopeChrome(data);
  return scopeControl(
    projectScopeView(data),
    { ...chrome, kinds },
    (value) => pickProjectScope(scopePayload(kinds, chrome, value).projectView),
  );
}

/**
 * What the nav panel has to list, gathered from what the shell already holds.
 *
 * Empty, and deliberately still a function rather than a constant: navModel's rule is that a
 * rail item EARNS a panel by having something to put in it, so returning nothing here is what
 * makes every lane draw as a plain list today. Saved views are the intended first occupant.
 */
function navContext() {
  return { savedViews: [] };
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
