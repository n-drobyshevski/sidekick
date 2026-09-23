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
//
// THE SYNC ZONE'S DOT IS A MEASUREMENT NOW, not an assertion. It used to be
// `hasCredentials ? "ok" : "neutral"` — a literal reading one field, agreeing with Settings
// only by accident and never noticing a register that ran once and then went quiet for a
// week. `railStatus()` (below, via renderSyncZone) takes the WORST over the scopes Settings
// collects — a register nobody has ever scanned outranks a merely stale one — and every state
// carries a sentence, because above 800px the dot IS the whole status readout.

import { configureApp } from "../../../../gas_shared/appConfig.js";
import { call } from "../../../../gas_shared/api.js";
import { bootstrapCached, navigate, swrCall } from "../../../../gas_shared/store.js";
import { createAppShell } from "../../../../gas_shared/shell/appShell.js";
import { openSyncDetails, renderSyncCard, resumePlan, shouldContinuePolling } from "./syncProgress.js";
import {
  clear, confirmDialog, el, statusPill, syncCaption, tipAnchor, toast,
} from "./ui.js";
import { projectScopeView, scopeChrome, scopeKinds } from "./ui/projectScope.js";
import { scopeControl } from "../../../../gas_shared/ui/scopeControl.js";
import { scopePayload } from "../../../../gas_shared/ui/scopeModel.js";
import { railStatus, withLabels } from "./railStatus.js";
import { PAGES } from "./pages.js";
import { LANE_ICONS, ROUTE_ICONS } from "./routeIcons.js";
import { findEntry } from "./helpContent.js";
import { installExperimentalFanout } from "./experimental.js";

// ============================================================================ the manifest
//
// WHAT THIS APP IS, handed to the shared core (gas_shared/appConfig.js) before anything
// else in this module body runs.
//
// The shared modules cannot reach sideways into an app: `gas_shared/ui/tip.js` has no
// `../helpContent.js` to import and `gas_shared/store.js` cannot know which route is this
// register's front door. Those answers travel as data instead, handed over by the
// `configureApp()` call BELOW THE MANIFEST — which now carries PAGES, imported from
// ./pages.js, and everything between the two is a declaration rather than a call. That
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

// PAGES JOINS THE MANIFEST, AND THAT IS WHY THIS CALL SITS BELOW IT.
// `gas_shared/ui/controls.js`'s `pageHeader({ route })` reads a route's own title and lane out
// of `appConfig().PAGES`, so the `<h1>` on every page IS the PAGES title by construction
// rather than by a second copy of the string sitting in the page module. PAGES is its own
// module (./pages.js) so a node test can import it, so it is spread in here rather than
// named inside the manifest literal.
//
// STILL BEFORE ANY SHARED FUNCTION RUNS, which is the rule appConfig.js's rule 1 actually
// protects: everything between the manifest literal and this line is a declaration or an
// object literal — no call — and no shared module reads the manifest at import time (rule 2).
configureApp({ ...MANIFEST, PAGES });

// The Run scan button's mark: an arrow travelling into a store, not a "play" triangle. What
// the button does is fetch a population and put it somewhere, and a play glyph would promise
// something that starts and runs rather than something that collects and commits.
const RUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5v10.5"/><path d="M8.2 10.3L12 14.1l3.8-3.8"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/></svg>';

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
 *
 * THE DOT IS DERIVED, NEVER ASSERTED — see railStatus.js for why that sentence needed writing
 * down. It used to be `hasCreds ? "ok" : "neutral"`: a literal reading one field, agreeing
 * with Settings only by accident and never noticing a register that ran once and then went
 * silent for a week. `railStatus()` takes the WORST over the scopes Settings collects — `never
 * scanned` beats `stale`, because a register nobody has looked at is not a stale one — and
 * ABOVE 800px THE DOT IS THE WHOLE STATUS READOUT (the caption text is visually hidden, not
 * removed), so every state carries a sentence rather than only a colour.
 */
function renderSyncZone(data) {
  const zone = el("div", { class: "scan-zone" });
  const hasCreds = !!(data && data.hasCredentials);
  const runBtn = el("button", {
    class: "primary",
    disabled: !hasCreds,
    // The icon rail (`.sidebar .btn-label { display: none }` above 800px, base.css) hides
    // the text this button's accessible name would otherwise come from, leaving an icon-only
    // control axe flags as button-name — measured on every route at 1280px. The tip already
    // carries the disabled reason; this is the name for the enabled state too.
    "aria-label": "Run sync",
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
  const status = railStatus({
    hasCredentials: hasCreds,
    lastScanByScope: withLabels(data && data.lastScanByScope, data && data.scopeLabels),
    // The scopes SETTINGS COLLECTS, never the constant list of all three — a register the
    // reader turned off is not "never scanned", it is out of scope, and railStatus() would
    // flag it as the worst offender on every load otherwise.
    scopes: (data && data.settings && data.settings.scopes) || [],
    job: data ? data.activeJob : null,
  });
  zone.append(
    syncCardHost,
    syncButtonsRow,
    // The sentence comes FIRST in the DOM and is only visually hidden above 800px (base.css),
    // so it is in the accessibility tree at every width.
    el("div", { class: "scan-caption" }, statusPill(
      status.state === "warn" ? "warn" : status.state === "bad" ? "bad"
        : status.state === "ok" ? "ok" : "neutral",
      status.label,
    )),
    // A REAL BUTTON, not a span wearing aria-hidden + tabindex=0 — axe's aria-hidden-focus
    // flagged the old markup (a focusable node hidden from the accessibility tree, which is
    // a contradiction axe treats as a violation) and WCAG 2.2 SC 2.5.8 wants 24px of target
    // even for a 9px mark. Scan history is the page `rail-status`'s glossary entry
    // summarises, and app.js's own header already forbids a control with nothing behind it —
    // so it navigates there rather than only opening its tip.
    tipAnchor(el("button", {
      type: "button",
      class: `rail-status-dot ${status.state}`,
      "aria-label": status.label,
      onclick: () => navigate("history"),
    }), [status.label, status.detail].filter(Boolean).join(" — ")),
    ...(status.detail ? [el("div", { class: "scan-caption" }, status.detail)] : []),
    // `syncCaption` (gas_shared/ui/feedback.js), unified across all three apps: "Last <noun>
    // <datetime> · <relativeAge>" once a sync is saved, "No <noun>s yet." before the first
    // one. A DIFFERENT fact from the dot above: this is when the register last ran ANYTHING,
    // not the worst per-scope freshness the dot is deliberately weighted toward. `ts`, not
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
    resumeActiveJob(data);
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
 *  mid-walk, or a second tab). The bootstrap that came with the page already answers it from the
 *  server's own single-flight `activeJob()` (see `resumePlan`), so a running job resumes the SAME
 *  poll a fresh Run click would start without a second execution; only a load with no bootstrap
 *  asks `getJobStatus` with no jobId. */
async function resumeActiveJob(bootData) {
  const plan = resumePlan(bootData);
  if (!plan.ask) {
    if (plan.jobId) watchJob(plan.jobId);
    return;
  }
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
// `api_setProjectView` / `api_setDomainView` and the `refresh()` after it are not instant, and
// the control does not disable itself mid-pick. Without this a fast double-pick could fire two
// scope writes and two overlapping `refresh()`s racing to rebuild the same `<main>` — and with
// two kinds it could fire them at two different endpoints, which is the same race with a
// worse outcome: the loser's write lands second and silently wins.
let scopePickInFlight = false;

/**
 * The scope switcher's onPick: persist the new view scope, then let `refresh()` do everything
 * else. STORES NOTHING CLIENT-SIDE — the scope is server state (`settingsStore.projectView` /
 * `.domainView`), so the client's only job here is to write it and invalidate what it cached.
 * A client-held copy would be a second source of truth for exactly the value this control
 * exists to keep singular.
 *
 * ONE ENDPOINT PER KIND, CHOSEN FROM THE PAYLOAD rather than from the option value, because
 * the value's encoding is `scopeModel.js`'s business and decoding it a second time here is how
 * the two drift. `scopePayload` already resolved the pick into the app's own `{projectView,
 * domainView}` shape; which of the two this write is about is then just which field is set.
 *
 * THE RESET ROW CLEARS BOTH, and it reaches here with both fields `""`. That falls to
 * `api_setProjectView`, whose `withProjectView` clears the domain as a matter of course — so
 * one call discharges the whole reset and there is no second round trip to race with it.
 */
async function pickScope(payload) {
  if (scopePickInFlight) return;
  scopePickInFlight = true;
  try {
    const domainView = (payload && payload.domainView) || "";
    if (domainView) await call("api_setDomainView", { domainView });
    else await call("api_setProjectView", { projectView: (payload && payload.projectView) || "" });
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
 * `null` (boot failed), or a payload with neither a project nor a domain to offer (nothing
 * synced yet), both resolve to `show: false` inside projectScopeView — see that module for why
 * an empty picker is a promise the register cannot keep.
 *
 * The control is `gas_shared/ui/scopeControl.js`; `ui/projectScope.js` says what this
 * register's two dimensions are. `scopePayload` turns the picked option value back into the
 * `{projectView, domainView}` object this app's endpoints take, so nothing below the seam
 * learned a new encoding — including the `d:` prefix, which never leaves the shared model.
 */
function appbarScope(data) {
  const kinds = scopeKinds(data);
  const chrome = scopeChrome(data);
  return scopeControl(
    projectScopeView(data),
    { ...chrome, kinds },
    (value) => pickScope(scopePayload(kinds, chrome, value)),
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

// THE EXPERIMENTAL GATE HAS ONE LISTENER SLOT and createAppShell already claimed it, for the
// rail rebuild. Claiming it back HERE, with that same rebuild as the base, is what lets a page
// subscribe without silently costing the rail its redraw — `subscribeExperimental` hands each
// page its own unsubscribe, and the base listener is never disturbed. See experimental.js.
installExperimentalFanout(() => shell.renderSidebar(bootstrapCached()));

export const refresh = shell.refresh;

window.addEventListener("hashchange", shell.route);
shell.boot();
