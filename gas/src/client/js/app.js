// Wiz Sidekick OS: the manifest, the route table, the two client-side scopes, and the scan
// battery.
//
// THE SHELL AROUND ALL THREE IS SHARED. `gas_shared/shell/` owns the boot splash, the app
// header, the two-tier nav, the flyout panel, the route overlay and the hash router — one
// copy for three registers, where there were three copies of ~1,500 lines that had already
// drifted in four places that mattered. ONE OF THEM ARRIVED HERE AS A FIX: `<main>` is REPLACED
// per route rather than cleared in place, so a slow page's late `.append()` lands in a detached
// node instead of in the next page's DOM.
//
// Two travelled the other way, out of this file into the two siblings: route() dismisses the
// combobox popover as well as the hover card, and a failure — boot or render — is `errorState`
// rather than a `.empty` div wearing `role="status"`. See gas_shared/shell/appShell.js.

import { configureApp } from "../../../../gas_shared/appConfig.js";
import { call } from "../../../../gas_shared/api.js";
import { createAppShell } from "../../../../gas_shared/shell/appShell.js";
import { renderScanCard, openScanDetails } from "./scanProgress.js";
import { scopeChrome, scopeKinds, scopeSwitchView } from "./scopeKinds.js";
import {
  bookTip, clear, el, scopeControl, scopePayload, statusPill, syncCaption, tip, tipAnchor,
  toast,
} from "./ui.js";
import { LANE_ICONS, ROUTE_ICONS, RUN_ICON } from "./routeIcons.js";
import { renderExecutive } from "./pages/executive.js";
import { renderOverview } from "./pages/overview.js";
import { renderMttr } from "./pages/mttr.js";
import { renderProgram } from "./pages/program.js";
import { renderHistory } from "./pages/history.js";
import { renderData } from "./pages/data.js";
import { renderSettings } from "./pages/settings.js";
import { renderAttribution } from "./pages/attribution.js";
import { renderHelp } from "./pages/help.js";
import { findEntry } from "./helpContent.js";

// ============================================================================ the manifest
//
// WHAT THIS APP IS, handed to the shared core (gas_shared/appConfig.js) before anything else
// in this module body runs.
//
// The shared modules cannot reach sideways into an app: `gas_shared/ui/tip.js` has no
// `../helpContent.js` to import and `gas_shared/store.js` cannot know which route is this
// register's front door. Those answers travel as data instead. `configureApp()` is
// DELIBERATELY THE FIRST STATEMENT of the module body — imports run before it, but no shared
// module reads the manifest at import time (see appConfig.js's rule 2), so the first read of
// it can only happen after this line.
const MANIFEST = {
  productName: "Wiz Sidekick OS",
  // What the boot splash says it is opening. "ledger", not "register": devsecops already
  // owns that noun for a shape this app doesn't have — three independent finding populations
  // sitting side by side. This app's front door is the single deduplicated structure every
  // scan writes into and every lifecycle reads out of, and it has always called itself that:
  // the "Reset ledger" control, the "Ledger spreadsheet" card, and TABLE_NAMES's own "ledger"
  // tab (migrationImport.js) all name the same object the splash is about to open. Two
  // registers sharing "register" would flatten a real difference — one dedup ledger here,
  // three independent registers there — so the words staying apart is right, not an accident.
  // It reaches the STATIC first paint too: gas_shared/shell/renderIndex.js substitutes it into
  // the shared index template at build time, so the splash cannot say one thing before the
  // bundle loads and another after.
  openingNoun: "ledger",
  // Trailing dot included. Two sidekicks served from the same origin must not share a key.
  storagePrefix: "sidekickos.",
  // The first key of PAGES below, and the only place the two can disagree — which is what
  // test/shared.test.js's navGroups contract checks. It used to be a bare "executive"
  // literal inside store.js's parseHash AND a second `|| PAGES.executive` in route(); the
  // two agreed by hand and test/navGroups.test.js existed to keep them agreeing.
  defaultRoute: "executive",
  // THIS REGISTER HAS A HELP BOOK NOW, and this line used to be the placeholder that said it
  // did not: `findHelpEntry: () => null` — a resolver that resolves nothing, which made every
  // glossary trigger degrade to a plain label (`glossaryTipLines(null)` is null) because there
  // was nothing to resolve against and no `#/help` route to arrive at. Both ends landed
  // together: `helpContent.js` holds the 21 definitions that were already written inside this
  // app's own tip call sites, and PAGES below registers the route those tips have always named.
  // `ui/tip.js` calls this as a FUNCTION, so a literal null would throw rather than degrade —
  // which is why the placeholder was a function too, and why this is a reference and not a
  // call. gas_shared/test/testConfig.js still ships the resolves-nothing shape, on purpose:
  // a manifest fixture has no book.
  findHelpEntry: findEntry,
  // WHAT FILLS THIS REGISTER IS A SCAN, NOT A SYNC, and the shared first-run notice used to
  // say otherwise. `firstRunNotice` (gas_shared/ui/feedback.js) hard-coded "No sync has run
  // yet"; this app's endpoint is `api_runScan`, its bootstrap field is `latestScan` and the
  // button in its rail says "Run scan", so that sentence sent a reader looking for a control
  // this app does not have. The two siblings keep the default.
  sync: { noun: "scan", unit: "findings" },
  // The nav marks, read by gas_shared/shell/navRail.js (the rail and the stacked list) and
  // gas_shared/shell/navFlyout.js (the panel's rows). routeIcons.js is still the only place
  // they are drawn; the manifest is how the shared shell reaches them.
  LANE_ICONS,
  ROUTE_ICONS,
  // No `panelBlocks`. The candidates were considered and each fails the one rule that
  // matters: every row in a panel has to be a destination that ALREADY deep-links, because a
  // panel that navigated somewhere a shared URL cannot reach would be inventing a nav surface
  // the app cannot honour on the way back.
  //   - The Security lane's instances would be saved filter states (`#/overview?sev=…&q=…`).
  //     Those deep-link, but nothing in this app saves one yet — there is no saved-view store
  //     to read, and a block drawn over nothing would say "you have none" where the truth is
  //     "we never offered".
  //   - The Data lane's would be the manual groups, whose names arrive with the bootstrap
  //     payload the shell already holds — but a manual group is a SCOPE, and the scope
  //     switcher in the header is where scopes live. Listing them here as destinations would
  //     be the rail re-asserting the thing the header was built to take off it.
  // When a saved-view store lands, this key is the one line that changes.
};
configureApp(MANIFEST);

// THE ONE SOURCE for both the router and the nav. Order matters twice over: pages are drawn
// in this insertion order, LANES ARE THE CONTIGUOUS RUNS OF ONE `group` (navModel.railItems
// walks it once and joins a page to the item still open, so a lane split in two would draw
// two items with one name), and the first key is the app's default landing page — which
// MANIFEST.defaultRoute above names, and test/shared.test.js holds the two together.
//
// `group: null` is the CHROME TAIL: pages that name themselves, drawn under a rule rather
// than under a heading. Settings is the whole tail here — a "Preferences" heading over one
// item would restate the link it sits on.
//
// EXECUTIVE IS IN THE SECURITY LANE, AND IT USED TO HAVE AN "Overview" LANE OF ITS OWN.
// A labelled lane earns its heading by holding two pages. navModel.railItems collapses a
// lane holding one visible page to that page, so on the icon rail "Overview" was never drawn
// — but renderStackedNav below 800px draws every lane heading UNCONDITIONALLY, and there it
// really did render the word "Overview" directly above a single link reading "Executive".
// The old test/navGroups.test.js knew about the collapse and asked multi-page lanes only for
// a mark, so nothing caught the stacked case. Executive belongs here anyway: it, MTTR and
// Program performance are all programme-level reads over the population that OS
// vulnerabilities lists.
const PAGES = {
  executive: { title: "Executive", group: "Security", render: renderExecutive },
  mttr: { title: "MTTR & SLA", group: "Security", render: renderMttr },
  program: { title: "Program performance", group: "Security", render: renderProgram },
  overview: { title: "OS vulnerabilities", group: "Security", render: renderOverview },
  data: { title: "Data", group: "Data", render: renderData },
  // `history`, not `scan_history`, and the rename is what makes the route table checkable.
  // gas_shared/test/contracts/navGroups.js resolves each route to `pages/<route>.js`, and
  // this one was the only route in the app whose key did not name its own module — the page
  // has always been pages/history.js. ROUTE_ALIASES below keeps every existing
  // #/scan_history link working and rewrites it, so no bookmark is broken by the fix.
  history: { title: "Scan History", group: "Data", render: renderHistory },
  attribution: { title: "Attribution", group: "Data", render: renderAttribution },
  // The book, not the record: helpContent.js's whole glossary, searchable and deep-linkable —
  // where every glossary tip's "Enter for the full definition" has always pointed
  // (gas_shared/ui/tip.js's markTerm), landing on nothing until this route existed. LAST in the
  // lane because a reader reaches for it only after wanting to check a word, never on the way
  // in; in the Data lane rather than the chrome tail because the key sheet IS a page of this
  // register's content. gas_devsecops files it identically and gas_ai does not — the two
  // existing answers disagreed, and this is the one taken here.
  help: { title: "Key sheet", group: "Data", render: renderHelp },
  settings: { title: "Settings", group: null, render: renderSettings },
};

// Old bookmarks and links to the two pages that were merged into Data keep working. This was
// `ROUTE_ALIASES` inside gas's own store.js; the shared store cannot carry one app's aliases,
// so the shared router applies them and REWRITES the hash — a stale link that silently
// renders a different page than the address bar names is three answers to "where am I". This
// is the only app with any, which is why it is an argument rather than a shared table.
const ROUTE_ALIASES = { reports: "data", exports: "data", scan_history: "history" };

// A span carrying an inline SVG (el() builds HTML nodes, so SVG goes in via innerHTML).
function iconSpan(svg) {
  const s = el("span", { class: "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

// ------------------------------------------------------------------------- the two scopes

// The last bootstrap payload, so the header can be re-derived on a pick without re-fetching.
let bootData = null;

// The global "Domain" scope, shared by every page. "" = the whole register. Module-level so
// it survives route() (which only re-renders the content pane, never the shell) and page
// navigation — nav links carry no state.
//
// ONE VALUE FOR ONE QUESTION. A domain arrives from the resource's `Wiz/Domain` tag where the
// tenant wrote one and from a manual group's rules where it did not, resolved server-side into
// a single `_domain` (src/domain/resolveDomain.ts) — so this is one scope, not two. It briefly
// was two, and the second is gone: "which domain owns this" asked twice is a control that
// cannot answer "what am I looking at" in one line.
let activeDomain = "";
// The global "Support group" scope, shared by every page the same way. "" = all groups.
//
// EXACTLY ONE OF THESE TWO IS EVER SET. They used to be independent filters that could
// intersect, each with its own combobox at the bottom of the rail; both are groups in one
// header control now, and one scope is what a header can honestly name. pickScope() is where
// that rule lives — clearScope() and the page chips only ever clear.
let activeSupportGroup = "";

/** The two scopes as the pages take them. One object, so no caller can pass both. */
function activeScope() {
  return { domain: activeDomain, supportGroup: activeSupportGroup };
}

// Toggle the scan-zone's "filtering" accent to match the active scope.
function syncScanZoneFiltering() {
  const zone = document.querySelector(".scan-zone");
  const scoped = !!(activeDomain || activeSupportGroup);
  if (zone) zone.classList.toggle("filtering", scoped);
}

/**
 * The header switcher's pick: set one scope, clear the others, and re-read the page.
 *
 * No server round trip and no re-boot. This app scopes CLIENT-SIDE — both values ride the
 * page context and each page passes them into its own RPC — so the bootstrap payload is
 * unchanged by a pick, and only the header's own label, caption and accent need re-deriving.
 * `renderChrome` does that by rebuilding from the same payload rather than patching, which is
 * what keeps the caption and the trigger from ever disagreeing.
 */
function pickScope(payload) {
  // THE SHAPE OF `payload` IS THE OLD `activeScope()` OBJECT, byte for byte — `{domain,
  // supportGroup}` with exactly one of them non-empty. It is built by the kind's own
  // `payload(id)` in scopeKinds.js rather than reconstructed here from a `{kind, value}` pair,
  // which is what makes "one at a time" structural: there is no branch in this function that
  // could leave both set, because it does not compose the object at all.
  // The registerScopeContract block in test/shared.test.js pins every one of those objects
  // against what the deleted scopeSwitch.js produced for the same pick.
  const pick = payload || { domain: "", supportGroup: "" };
  activeDomain = pick.domain || "";
  activeSupportGroup = pick.supportGroup || "";
  shell.renderChrome(bootData);
  syncScanZoneFiltering();
  shell.route();
}

// Clear the scope from a page-header chip. The header is rebuilt so its trigger drops the
// accent and its caption returns to the register-wide figure.
function clearScope(kind) {
  if (kind === "domain") activeDomain = "";
  else if (kind === "supportGroup") activeSupportGroup = "";
  shell.renderChrome(bootData);
  syncScanZoneFiltering();
  shell.route();
}

/**
 * The header's scope control, or null when there is no register to slice — including the
 * boot-failure path, where offering a picker over data we could not fetch would be a control
 * with nothing behind it.
 *
 * ONE CONTROL, THREE REGISTERS. `scopeControl` (gas_shared/ui/scopeControl.js) draws it and
 * `scopeKinds.js` says what this register's two dimensions are; the appbar only decides where
 * it goes.
 */
function appbarScope(data) {
  bootData = data;
  const kinds = scopeKinds(data);
  const chrome = scopeChrome(data);
  return scopeControl(
    scopeSwitchView(data, activeScope()),
    { ...chrome, kinds },
    (value) => pickScope(scopePayload(kinds, chrome, value)),
  );
}

// --------------------------------------------------------------------- the scan battery

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

/**
 * The scan zone under the nav.
 *
 * Carries a subtle "filtering" accent when a scope is active, so the source of a scoped view
 * is visible where the scan controls live (the header switcher and the scopeBar in the
 * content pane are the primary cues).
 *
 * The two global filters that used to live here — domain and Support group — are one control
 * in the app header now. They were the only things in the rail that were not destinations,
 * and a scope is not a destination. A SCOPE THAT FELL OUT OF THE REGISTER IS NO LONGER
 * SILENTLY DROPPED, which is what the two comboboxes did on every rebuild: deleting a manual
 * group in Settings and coming back to a whole-register view looks exactly like never having
 * scoped at all. The switcher keeps the stale value in force and says so in words instead
 * ("Not in this register — showing 0 of N", scopeSwitchView).
 */
function renderScanZone(data) {
  const zone = el("div",
    { class: `scan-zone${activeDomain || activeSupportGroup ? " filtering" : ""}` });
  const runBtn = el("button", { class: "primary", onclick: () => startScan(false, runBtn) },
    iconSpan(RUN_ICON), el("span", { class: "btn-label" }, "Run scan"));
  const quickBtn = el(
    "button",
    { onclick: () => startScan(true, quickBtn) },
    "Quick refresh",
  );
  // Was a `title` attribute, which el() now refuses: a native tooltip cannot be reached by
  // keyboard, does not exist on touch, and arrives half a second late. The card attaches to
  // the button IN PLACE (it is already interactive), so this adds a hover card and no tab stop.
  //
  // `bookTip`, NOT `tip(..., { term })`, AND THE DIFFERENCE IS MEASURED RATHER THAN STYLISTIC.
  // A term tip calls markTerm(), which registers the anchor in tip.js's ACTIVATE map; tip.js's
  // delegated click handler then runs `act(e)` — navigate("help", { term }) — and does NOT
  // preventDefault or stopPropagation. This button already has a click action of its own
  // (startScan), so a term tip here would start a quick refresh AND route away from the page
  // that is about to report it, on one click. bookTip reads the same entry out of the same book
  // and attaches no activation, so the sentence still lives once in helpContent.js and the
  // button still does the one thing it says. The trade is the "Enter for the full definition"
  // affordance, which bookTip does not offer and therefore does not promise.
  bookTip(quickBtn, "quick-refresh");
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
    const credDot = el("span", {
      class: `rail-status-dot ${data.hasCredentials ? "ok" : "neutral"}`,
      "aria-hidden": "true",
    });
    tipAnchor(credDot, () => [
      data.hasCredentials ? "Credentials loaded" : "Dry-run (no credentials)",
    ]);
    zone.append(
      el("div", { class: "scan-caption" },
        data.hasCredentials
          ? statusPill("ok", "Credentials loaded")
          : statusPill("neutral", "Dry-run (no credentials)"),
      ),
      // Compact stand-in for the pill above, shown on the icon rail (where the captions do not
      // fit) so the credentials/dry-run state stays glanceable at 76px.
      //
      // tipAnchor, NOT tip(): tip() wraps a non-interactive node in a `.tip-trigger` button,
      // and this dot is aria-hidden decoration whose words are already on the pill beside it
      // — a tab stop here would announce nothing and stop everyone. tipAnchor is the shared
      // answer for an anchor that cannot host a wrapper.
      credDot,
    );
    // `syncCaption` (gas_shared/ui/feedback.js), unified across all three apps: "Last <noun>
    // <datetime> · <relativeAge>" once a scan is saved, "No <noun>s yet." before the first
    // one. It used to be a bare Math.floor day count gated at `age >= 2` — a scan an hour old
    // showed no age at all, and this app's own Scan History page had finer just-now/min/hour
    // granularity that this caption never got. `sync.noun` in this app's MANIFEST ("scan") is
    // what turns the shared sentence's default "sync"/"syncs" into "scan"/"scans" here.
    zone.append(
      el("div", { class: "scan-caption" }, syncCaption(data.latestScan && data.latestScan.ts)),
    );
    // Seed the card immediately from the bootstrap job, then keep it live — this is
    // what makes progress survive a page reload mid-scan.
    if (data.activeJob) {
      paintCard(data.activeJob);
      watchJob(data.activeJob.job_id);
    }
  }
  return zone;
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

// ------------------------------------------------------------------------------ the shell

const shell = createAppShell({
  pages: PAGES,
  routeAliases: ROUTE_ALIASES,
  appbarScope,
  railFooter: renderScanZone,
  // The panel asks the shell what it holds each time it opens. Nothing yet — see the
  // manifest's `panelBlocks` note for which candidates were considered and why none of them
  // qualifies — but the provider is the seam a saved-view store would arrive through, and
  // wiring it now is what keeps that a one-function change rather than a re-derivation.
  navContext: () => ({}),
  // The two client-side scopes and the two callbacks every page's header chip needs. The
  // siblings pass nothing here: their scope is server state, so their pages never see it.
  pageContext: () => ({ clearScope, startScan, ...activeScope() }),
});

export const refresh = shell.refresh;

window.addEventListener("hashchange", shell.route);
shell.boot();
