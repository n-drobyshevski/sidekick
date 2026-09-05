// Settings — five task tabs (Register / Risk / Attribution / Lifecycle / System) over one
// batched save bar. settingsModel.js owns the draft/dirty/validate model; settingsReadouts.js
// owns the live "what is this control doing right now" readouts; this file wires DOM controls
// to the draft and repaints both on every edit.

import { call } from "../../../../../gas_shared/api.js";
import { backfillStatusView } from "../backfillStatus.js";
import { capacityView } from "../capacity.js";
import { decodePrefill, PREFILL_KEY } from "../attributionPrefill.js";
import { bootstrap, invalidateBootstrap, invalidateRpcCache, setParams } from "../../../../../gas_shared/store.js";
import {
  changeCountText, changeSummary, changedFields, clampDisplayToFetch, dirtyTabs, draftWarnings,
  normalizeTab, SETTINGS_TABS, settingsDraft, settingsPatch, validateDraft,
} from "../settingsModel.js";
import {
  createRiskReadout, renderRetentionReadout, severityScopeReadout, toggleHeadline,
  toggleReadoutBar, toggleReadoutNote,
} from "../settingsReadouts.js";
import {
  absent, clear, confirmDialog, diagnosticsPanel, disclosure, el, errorCountBadge, errorLogBody,
  fmtDateTime, heroStat, normalizeErrorLog, openSheet, pageHeader, saveBar, settingRow,
  settingsPanel, statusPill, storageBody, switchToggle, tabList, tip, tipAnchor, toast,
} from "../ui.js";
import { renderAccessPanel } from "./accessEditor.js";
import { renderDomainsEditor } from "./domainsEditor.js";

export async function renderSettings(main, params, ctx) {
  const boot = await bootstrap();
  const accessPanelNode = await renderAccessPanel();

  main.append(pageHeader({
    hero: heroStat(
      "Settings",
      "Scan scope, risk, attribution, retention",
      "One save bar covers every panel below it; access and the system readouts save "
        + "themselves, on their own controls.",
    ),
  }));

  // ------------------------------------------------------------------------ draft model
  // `savedShape` is the nested shape settingsDraft() reads (boot.settings, or api_saveSettings's
  // return value after a save) — kept separately from `saved` (the flat draft `saved` is
  // rebuilt FROM) so a later Discard can rebuild a fresh draft the same way a save does.
  let savedShape = boot.settings;
  const saved = settingsDraft(savedShape);
  let draft = settingsDraft(savedShape);

  let impact = null; // the api_getSettingsImpact payload — decorative; every control below
                      // works without it, per the storage-stats precedent lower on this page.
  async function loadImpact() {
    try {
      impact = await call("api_getSettingsImpact", {});
    } catch (e) {
      console.warn("[settings] impact unavailable:", e);
      impact = null;
    }
    repaintReadouts();
  }

  // ============================================================================ REGISTER TAB
  function pillGroup(options, getArr, { onChange, ariaLabel } = {}) {
    const pills = {};
    const node = el("div", { class: "pill-row", role: "group", "aria-label": ariaLabel });
    for (const sev of options) {
      const btn = el("button", {
        class: `sev-pill sev-${sev}`, type: "button",
        "aria-pressed": getArr().includes(sev) ? "true" : "false",
        onclick: () => {
          if (btn.getAttribute("aria-disabled") === "true") return; // locked (out of scan scope)
          const arr = getArr();
          const i = arr.indexOf(sev);
          if (i >= 0) arr.splice(i, 1); else arr.push(sev);
          sync();
          if (onChange) onChange();
        },
      }, sev);
      pills[sev] = btn;
      node.append(btn);
    }
    function sync() {
      const arr = getArr();
      for (const sev of options) pills[sev].setAttribute("aria-pressed", arr.includes(sev) ? "true" : "false");
    }
    return { node, sync, pills };
  }

  // `getArr` reads `draft` (a `let`) fresh on every call, not a snapshot — so a Discard that
  // reassigns `draft` to a brand-new object is picked up automatically, with no separate
  // rebinding step for the pill widgets themselves.
  const fetchPills = pillGroup(boot.palette.selectable, () => draft.fetchSeverities, {
    ariaLabel: "Severities each scan pulls",
    onChange: () => { clampDisplayToFetch(draft); displayPills.sync(); syncDisplayLock(); onEdit(); },
  });
  const displayPills = pillGroup(boot.palette.selectable, () => draft.displaySeverities, {
    ariaLabel: "Severities every page shows",
    onChange: () => onEdit(),
  });
  // Display must be a subset of the scan scope: lock (and, via clampDisplayToFetch, drop) any
  // display pill outside the current fetch selection, so the "always a subset" promise the copy
  // makes is kept by the control rather than relying on the server to quietly clamp it after.
  function syncDisplayLock() {
    const fetchSet = new Set(draft.fetchSeverities);
    for (const sev of boot.palette.selectable) {
      const btn = displayPills.pills[sev];
      if (fetchSet.has(sev)) btn.removeAttribute("aria-disabled");
      else btn.setAttribute("aria-disabled", "true");
    }
  }
  syncDisplayLock();
  // Why a pill is locked used to be a native `title` assigned straight onto the button, which
  // is the one form el()'s ban cannot catch and the one no keyboard or touch reader could
  // ever summon — the rule the copy above states in prose was, in the control itself, visible
  // only to a mouse. Anchored ONCE per pill rather than inside syncDisplayLock: the card's
  // copy is read at reveal time, so a single anchor answers for both states and an unlocked
  // pill (null lines) simply shows nothing.
  for (const sev of boot.palette.selectable) {
    const pill = displayPills.pills[sev];
    tip(pill, () => (pill.getAttribute("aria-disabled") === "true"
      ? ["Not in the scan scope — add it above to show it."]
      : null));
  }

  const scopeReadoutHost = el("div", {});
  const scopePanel = settingsPanel({
    title: "Severity scope",
    description: "Which severities each scan pulls from Wiz, and which of those every page shows.",
    body: [
      disclosure("Why this matters", el("p", {},
        "Display is always a subset of the scan scope — a severity the scan no longer fetches " +
        "can't be shown, so it is locked (and dropped) here the moment it leaves the scope above.")),
      el("div", { class: "scope-block" },
        el("span", { class: "label" }, "Pulled from every scan"),
        el("p", { class: "muted small scope-block__note" },
          "Fewer severities = faster scans; a severity outside the scope pauses its " +
          "lifecycle tracking."),
        fetchPills.node),
      el("div", { class: "scope-block scope-block--divided" },
        el("span", { class: "label" }, "Shown across the app"),
        el("p", { class: "muted small scope-block__note" },
          "A subset of the scan scope. A severity outside the scan scope is locked here " +
          "until you add it above."),
        displayPills.node),
      scopeReadoutHost,
    ],
  });

  const vfHeadline = el("span", {}, "Findings with no vendor fix available yet sit outside the SLA clock.");
  const vfBarHost = el("div", {});
  const vfNote = el("p", { class: "muted small" });
  const showNoFix = switchToggle({
    checked: draft.showNoFix, id: "show-no-fix",
    ariaLabel: "Show findings awaiting a vendor fix",
    onChange: (checked) => { draft.showNoFix = checked; onEdit(); },
  });
  const vendorFixPanel = settingsPanel({
    title: "Vendor-fix filter",
    description: vfHeadline,
    body: [
      disclosure("Why this matters", el("p", {},
        "Findings with no vendor fix available yet sit outside the SLA clock. Turning this off " +
        "hides them from every chart, table, KPI, and export across the whole register.")),
      settingRow({
        label: "Show findings awaiting a vendor fix",
        description: "Off = excluded from every chart, table, KPI, and export.",
        control: showNoFix.node,
        htmlFor: "show-no-fix",
      }),
      vfBarHost,
      vfNote,
    ],
  });

  const eolHeadline = el("span", {}, "Findings on end-of-life operating systems can't be remediated by patching alone.");
  const eolBarHost = el("div", {});
  const eolNote = el("p", { class: "muted small" });
  const includeEol = switchToggle({
    checked: draft.includeEol, id: "include-eol",
    ariaLabel: "Include findings on end-of-life operating systems",
    onChange: (checked) => { draft.includeEol = checked; onEdit(); },
  });
  const eolPanel = settingsPanel({
    title: "End-of-life OS filter",
    description: eolHeadline,
    body: [
      disclosure("Why this matters", el("p", {},
        "Findings on end-of-life operating systems can't be remediated by patching — the OS " +
        "itself must be replaced — so they sit open indefinitely and skew MTTR and SLA.")),
      settingRow({
        label: "Include findings on end-of-life operating systems",
        description: "Off = excluded from every chart, table, KPI, and export.",
        control: includeEol.node,
        htmlFor: "include-eol",
      }),
      eolBarHost,
      eolNote,
    ],
  });

  const filterGrid = el("div", { class: "settings-grid-2" }, vendorFixPanel, eolPanel);

  // ================================================================================ RISK TAB
  const riskKev = switchToggle({
    checked: draft.riskRule.kev, id: "risk-kev",
    ariaLabel: "Count a CISA KEV listing as high risk",
    onChange: (c) => { draft.riskRule.kev = c; onEdit(); },
  });
  const riskExploit = switchToggle({
    checked: draft.riskRule.exploit, id: "risk-exploit",
    ariaLabel: "Count a known public exploit as high risk",
    onChange: (c) => { draft.riskRule.exploit = c; onEdit(); },
  });
  const riskEpss = switchToggle({
    checked: draft.riskRule.epss, id: "risk-epss",
    ariaLabel: "Count an EPSS score above the threshold as high risk",
    onChange: (c) => { draft.riskRule.epss = c; onEdit(); },
  });
  const riskThreshold = el("input", {
    type: "number", id: "risk-epss-threshold", min: "0", max: "1", step: "0.01",
    value: draft.riskRule.epssThreshold.toFixed(2), style: "width:96px",
    oninput: (e) => setEpssThreshold(e.target.value),
    onchange: () => { riskThreshold.value = draft.riskRule.epssThreshold.toFixed(2); },
  });
  const riskReadout = createRiskReadout();

  const riskPanel = settingsPanel({
    title: "High-risk classifier",
    description: "Which findings the Program performance page counts as high risk.",
    body: [
      disclosure("Why this matters", el("p", {},
        "A finding qualifies when ANY enabled signal fires — the research behind these metrics " +
        "is clear that no single source catches everything (the CISA KEV catalog alone misses " +
        "roughly four fifths of what is exploited in the wild). Changing this re-derives every " +
        "figure on that page, history included; nothing is re-scanned.")),
      settingRow({
        label: "Listed in the CISA KEV catalog",
        description: "Vulnerabilities CISA has confirmed as exploited in the wild.",
        control: riskKev.node,
        htmlFor: "risk-kev",
      }),
      settingRow({
        label: "A public exploit exists",
        description: "Wiz reports known exploit code for the vulnerability.",
        control: riskExploit.node,
        htmlFor: "risk-exploit",
      }),
      settingRow({
        label: "EPSS at or above the threshold",
        description: "The Exploit Prediction Scoring System estimate of exploitation " +
          "likelihood in the next 30 days. 0.10 is the conventional operational cut.",
        control: riskEpss.node,
        htmlFor: "risk-epss",
      }),
      settingRow({
        label: "EPSS threshold",
        description: "Between 0 and 1. Raising it flags fewer findings as high risk.",
        control: riskThreshold,
        htmlFor: "risk-epss-threshold",
      }),
      riskReadout.node,
    ],
  });

  // ========================================================================= ATTRIBUTION TAB
  const domainsHost = el("div", {});
  const unassignedHost = el("div", {});
  if (typeof boot.unassignedCount === "number" && boot.unassignedCount > 0) {
    unassignedHost.append(el("p",
      { class: "small", style: "display:flex; align-items:center; gap:8px; margin:0 0 12px" },
      statusPill("warn", `${boot.unassignedCount.toLocaleString()} findings unassigned`),
      el("a", { href: "#/attribution", target: "_self" }, "Review in Attribution →")));
  }
  const domainsPanel = settingsPanel({
    title: "Manual groups",
    description: "THE FALLBACK, not the primary.",
    body: [
      disclosure("Why this matters", el("p", {},
        "A finding takes its domain from the Wiz/Domain tag wherever the tenant wrote one; a " +
        "manual group claims only what is left untagged. Rule-based triage: route those " +
        "findings to named groups by tag, asset-name pattern, subscription, or support group. " +
        "Order is priority — the first matching group wins. As tagging in Wiz improves, these " +
        "rules should have less to do.")),
      unassignedHost,
      domainsHost,
    ],
  });
  // onSaved replaces the old ctx.refresh(): the domains draft already repaints its own list, so
  // all the page needs to do is make sure every OTHER page refetches on its own next visit.
  const domainsEditor = renderDomainsEditor(domainsHost, boot, ctx, {
    onSaved: () => { invalidateBootstrap(); invalidateRpcCache(); },
  });

  const attributionCrossRef = el("p", { class: "muted small" },
    "Support group refresh runs from the jobs console on ",
    el("button", { class: "link", type: "button", onclick: () => tabs.select("lifecycle") }, "Lifecycle"),
    ".");

  // ========================================================================== LIFECYCLE TAB
  const retentionSwitch = switchToggle({
    checked: draft.retentionDays !== null, id: "ret-on",
    ariaLabel: "Seal scans older than the retention window",
    onChange: (checked) => {
      draft.retentionDays = checked ? (Number(retentionDays.value) || 180) : null;
      retentionDays.disabled = !checked;
      onEdit();
    },
  });
  const retentionDays = el("input", {
    type: "number", min: "30", step: "1", value: draft.retentionDays ?? 180,
    style: "width:96px", "aria-label": "Retention window in days",
    disabled: draft.retentionDays === null ? true : null,
    oninput: (e) => {
      const n = Number(e.target.value);
      if (Number.isFinite(n)) { draft.retentionDays = n; onEdit(); }
    },
  });
  const autoCompactSwitch = switchToggle({
    checked: draft.autoCompact, id: "auto-compact",
    ariaLabel: "Compact automatically after each scan",
    onChange: (c) => { draft.autoCompact = c; onEdit(); },
  });
  const retentionReadoutHost = el("div", {});
  const compactBtn = el("button", { onclick: compactNow }, "Compact now…");

  const retentionPanel = settingsPanel({
    title: "Data retention",
    description: "Sealing rolls closed findings into exact episode rows and prunes raw " +
      "archives; MTTR and every trend stay identical.",
    body: [
      disclosure("Why this matters", el("p", {}, "The two most recent full scans always stay.")),
      settingRow({
        label: "Seal old scans",
        description: "Compact scans past the retention window into episode rows.",
        control: retentionSwitch.node,
        htmlFor: "ret-on",
      }),
      settingRow({
        label: "Retention window",
        description: "Scans older than this are sealed (minimum 30 days).",
        control: el("div", { style: "display:flex; align-items:center; gap:6px" },
          retentionDays, el("span", { class: "muted small" }, "days")),
      }),
      settingRow({
        label: "Compact automatically after each scan",
        description: "Runs the sealing pass whenever a scan finishes.",
        control: autoCompactSwitch.node,
        htmlFor: "auto-compact",
      }),
      retentionReadoutHost,
    ],
    footer: compactBtn,
  });

  async function compactNow() {
    compactBtn.disabled = true; // guard against a double-click stacking two preview dialogs
    try {
      let preview;
      try {
        preview = await call("api_compact", { dryRun: true });
      } catch (e) {
        toast(`Preview failed: ${e.message}`, "error");
        return;
      }
      if (preview.no_op) {
        toast("Nothing is old enough to compact.");
        return;
      }
      const ok = await confirmDialog({
        title: "Compact old scans?",
        body: el("div", {},
          el("p", {}, `${preview.scans_sealed} scan(s) will be sealed and ` +
            `${preview.episodes_created} closed finding(s) rolled into episode rows. ` +
            `${preview.observations_pruned} observation(s) and their raw archives are pruned.`),
          el("p", { class: "small muted" },
            `Floor: ${preview.floor_ts ?? "—"}. MTTR, SLA, and trends are verified ` +
            "unchanged before the compaction commits.")),
        confirmLabel: "Compact",
      });
      if (!ok) return;
      try {
        const res = await call("api_compact", { dryRun: false });
        toast(`Compacted ${res.scans_sealed} scan(s) — ${res.episodes_created} episode(s) created.`);
        invalidateBootstrap();
        invalidateRpcCache();
        await loadImpact(); // scan ages / sealed flags moved
        await reloadStorageStats(); // cell usage moved
      } catch (e) {
        toast(`Compaction failed: ${e.message}`, "error");
      }
    } finally {
      compactBtn.disabled = false;
    }
  }

  // --------------------------------------------------------------------------- jobs console
  // History backfill, Domain-tag backfill and Support group refresh, one row each. A job's full
  // former paragraph lives verbatim in its row's disclosure rather than sitting open on the page.
  const historyStatusCell = el("td", { class: "job-status-cell" });
  const historyBtn = el("button", { onclick: runBackfill }, "Recover history signals");

  function paintHistoryStatus(b) {
    const view = backfillStatusView(b);
    let kind = "neutral";
    let label = "Never run";
    if (b) {
      if (b.phase === "BACKFILLING") {
        kind = view.busy ? "neutral" : "warn";
        label = view.busy ? "Running" : "Stalled";
      } else if (b.phase === "FAILED") {
        kind = "bad"; label = "Failed";
      } else {
        kind = "ok"; label = "Complete";
      }
    }
    clear(historyStatusCell);
    historyStatusCell.append(statusPill(kind, label));
    if (view.text) {
      historyStatusCell.append(el("div", { class: "muted small", style: "margin-top:3px" }, view.text));
    }
    historyBtn.disabled = view.busy;
    // The job hops on a one-shot trigger, so poll rather than assume it finished.
    if (view.poll) setTimeout(loadHistoryStatus, 4000);
  }
  async function loadHistoryStatus() {
    try {
      const res = await call("api_getRiskBackfillStatus", {});
      paintHistoryStatus(res.backfill);
    } catch {
      // A missing status is not worth an error surface — the button still works.
    }
  }
  async function runBackfill() {
    historyBtn.disabled = true;
    clear(historyStatusCell);
    historyStatusCell.append(statusPill("neutral", "Starting…"));
    try {
      const res = await call("api_startRiskBackfill", {});
      paintHistoryStatus(res);
      toast("History backfill started.");
    } catch (e) {
      historyBtn.disabled = false;
      clear(historyStatusCell);
      historyStatusCell.append(statusPill("bad", "Failed to start"));
      toast(`History backfill failed to start: ${e.message}`, "error");
    }
  }
  const historyRow = el("tr", {},
    el("td", {},
      el("div", { class: "job-name" }, el("strong", {}, "History backfill")),
      disclosure("Why this matters", el("p", {},
        "Replays the saved scan archives to fill in two things for findings recorded before " +
        "the ledger stored them: the CISA KEV / exploit / EPSS signals behind Program " +
        "performance, and the Wiz/Domain tag bag behind every by-domain figure — history with " +
        "no bag reads as Not attributable. Safe to re-run: signals only accumulate and a tag " +
        "bag is never overwritten, so a repeated or interrupted run converges on the same " +
        "result. Scans already sealed by compaction had their archives pruned; for those, use " +
        "Domain-tag backfill below, which reads the checkpoints instead."))),
    el("td", { class: "num" }, absent()),
    historyStatusCell,
    el("td", {}, historyBtn));

  const tagStatusCell = el("td", { class: "job-status-cell" }, statusPill("neutral", "Not run this session"));
  const tagBtn = el("button", { onclick: runTagBackfill }, "Recover domain tags");
  async function runTagBackfill() {
    tagBtn.disabled = true;
    clear(tagStatusCell);
    tagStatusCell.append(statusPill("neutral", "Recovering…"));
    try {
      const res = await call("api_backfillEpisodeTags", {});
      clear(tagStatusCell);
      // All three figures, always — "recovered 0" and "there was nothing to recover" are
      // different answers, and only the unrecoverable count tells them apart.
      tagStatusCell.append(
        statusPill(res.recovered ? "ok" : "neutral", res.recovered ? "Recovered" : "Nothing to recover"),
        el("div", { class: "muted small", style: "margin-top:3px" },
          `${res.recovered.toLocaleString()} recovered · ${res.alreadyHad.toLocaleString()} ` +
          `already had tags · ${res.unrecoverable.toLocaleString()} not in any checkpoint`));
      if (res.recovered) toast(`Recovered domain tags for ${res.recovered} finding(s).`);
      else toast("Nothing to recover — every sealed episode already carries its tags.");
    } catch (e) {
      clear(tagStatusCell);
      tagStatusCell.append(statusPill("bad", "Failed"));
      toast(`Domain-tag backfill failed: ${e.message}`, "error");
    } finally {
      tagBtn.disabled = false;
    }
  }
  const tagRow = el("tr", {},
    el("td", {},
      el("div", { class: "job-name" }, el("strong", {}, "Domain-tag backfill")),
      disclosure("Why this matters", el("p", {},
        "Recovers the Wiz/Domain tag for resolved findings that were compacted before the " +
        "ledger kept it — they read as Not attributable in every by-domain figure until this " +
        "runs. Reads the compaction checkpoints in Drive, which still hold them. Safe to " +
        "re-run: a row that already carries its tags is never overwritten, and a run that " +
        "recovers nothing writes nothing."))),
    el("td", { class: "num" }, absent()),
    tagStatusCell,
    el("td", {}, tagBtn));

  const sgStatusCell = el("td", { class: "job-status-cell" });
  if (!boot.hasCredentials) {
    sgStatusCell.append(statusPill("neutral", "Dry-run"),
      el("div", { class: "muted small", style: "margin-top:3px" }, "Connect Wiz credentials to refresh."));
  } else {
    sgStatusCell.append(statusPill("neutral", "Not run this session"));
  }
  // This `title` was a LIVE CRASH, not just an unreachable tooltip: el() throws on the key,
  // and the ternary only evaluated to null on a tenant that HAS credentials — so the Settings
  // page rendered fine everywhere the attribute was dropped and blew up on exactly the
  // tenants the sentence was written for. `tipAnchor`, not `tip`: the button is disabled in
  // that state, so it is out of the tab order and Chromium dispatches no pointer events over
  // it; the card is best-effort and the status cell beside it says the same thing in text.
  const sgBtn = el("button", {
    onclick: refreshSupportGroups,
    disabled: boot.hasCredentials ? null : true,
  }, "Refresh support groups");
  if (!boot.hasCredentials) tipAnchor(sgBtn, () => ["Live Wiz credentials are required."]);
  async function refreshSupportGroups() {
    sgBtn.disabled = true;
    clear(sgStatusCell);
    sgStatusCell.append(statusPill("neutral", "Refreshing…"));
    try {
      const res = await call("api_refreshSupportGroups", {});
      clear(sgStatusCell);
      sgStatusCell.append(statusPill("ok", "Refreshed"),
        el("div", { class: "muted small", style: "margin-top:3px" },
          `Mapped ${res.subscriptions} subscription(s) → ${res.groups} support group(s) ` +
          `(tag ${res.tagKey}).`));
      toast("Support groups refreshed.");
      invalidateBootstrap();
      invalidateRpcCache();
    } catch (e) {
      clear(sgStatusCell);
      sgStatusCell.append(statusPill("bad", "Failed"));
      toast(`Refresh failed: ${e.message}`, "error");
    } finally {
      sgBtn.disabled = boot.hasCredentials ? false : true;
    }
  }
  const sgRow = el("tr", {},
    el("td", {},
      el("div", { class: "job-name" }, el("strong", {}, "Support group refresh")),
      disclosure("Why this matters", el("p", {},
        "A support group is the value of a subscription's Wiz/provisioning tag (e.g. " +
        "CS-SUPPLY-MONITORING). Refreshing pulls every tagged subscription from Wiz and joins " +
        "it onto findings, powering the Support group filter, breakdown, and domain condition. " +
        "Also refreshes automatically after each scan."))),
    el("td", { class: "num" }, absent()),
    sgStatusCell,
    el("td", {}, sgBtn));

  const jobsPanel = settingsPanel({
    title: "Maintenance jobs",
    description: "Register-wide backfills and refreshes, run on demand.",
    body: el("div", { class: "table-wrap" },
      el("table", { class: "data jobs-table" },
        el("thead", {}, el("tr", {},
          ...["Job", "Last run", "Status", ""].map((h) => el("th", { scope: "col" }, h)))),
        el("tbody", {}, historyRow, tagRow, sgRow))),
  });

  // ============================================================================= SYSTEM TAB
  // The three read-outs this register publishes, drawn by gas_shared/ui/diagnostics.js. Every
  // section in that module is optional and this app passes exactly the three it already had:
  // storage, the error log, the build stamp. IT GAINS NOTHING. There is no credential card —
  // `hasCredentials` in this app only disables a Lifecycle job button — and no last-sync line,
  // because no `latestSync` field exists in this bootstrap at all.
  const storageHost = el("div", {});
  async function reloadStorageStats() {
    try {
      const stats = await call("api_getStorageStats", {});
      // capacity.js owns the thresholds and the wording so this card and the Data page's
      // breakdown can never disagree about when the ledger is "nearly full".
      const cap = capacityView(stats);
      // The sentences under the meter stay HERE rather than in the shared module: this register
      // counts scans and tracked vulnerabilities, a code register counts findings, and one
      // vocabulary spoken on another's page is the drift the shared package exists to stop.
      //
      // Data-quality line: tracked vulnerabilities whose severity never normalized to a real
      // value. Additive fields on this payload — guarded defensively so a stale pre-rollout
      // cache (missing both) simply omits the line, and storageBody() drops a blank one.
      const lines = [
        `${stats.scanCount} scan(s), ${stats.sealedCount} sealed, `
          + `${stats.trackedVulns.toLocaleString()} tracked vulnerabilities.`,
      ];
      if (stats.unknownSeverityCount) {
        const n = stats.unknownSeverityCount;
        lines.push(
          `${n.toLocaleString()} tracked vulnerabilit${n === 1 ? "y" : "ies"} have an `
          + "unrecognized severity. Severity values seen this scan: "
          + `${(stats.distinctSeverities || []).join(", ")}.`,
        );
      }
      clear(storageHost);
      storageHost.append(...storageBody({
        used: cap.used, total: cap.total, label: "Spreadsheet cells",
        state: cap.state, note: cap.note, lines,
      }));
    } catch {
      /* stats are decorative */
    }
  }

  // Recent server-side errors, surfaced in-app so a failure — especially a background one that
  // never shows a toast (post-scan support-group refresh, MTTR snapshot, auto-compaction) — is
  // visible without opening the Apps Script execution log the web app can't reach.
  const errCountHost = el("span", {});
  const recentErrorsBtn = el("button", { onclick: openRecentErrors }, "Recent errors");

  // Best-effort count badge so a silent failure is discoverable at a glance (the log itself is
  // decorative — a failed fetch just leaves the badge BLANK, which is deliberately not the same
  // node as errorCountBadge([])'s "None recorded."; that is why the catch appends nothing).
  (async () => {
    try {
      const log = normalizeErrorLog(await call("api_getRecentErrors", {}));
      clear(errCountHost);
      errCountHost.append(errorCountBadge(log.items));
    } catch {
      /* decorative */
    }
  })();

  function openRecentErrors() {
    openSheet(renderRecentErrors, {
      title: "Recent errors",
      subtitle: "Newest first — the last 25 server-side errors.",
      width: "min(680px, 94vw)",
      // `minWidth` and `storageKey` were gas's own sheet options and the shared openSheet has
      // neither — it destructures a fixed list and ignores the rest, so this sheet had
      // silently lost its drag-to-resize edge. `resizable: true` is the shared spelling; the
      // sheet persists its width itself under one app-wide key rather than a per-sheet one,
      // and its floor comes from the --sheet-w-record-min custom property (520px by default)
      // rather than from a number passed per call.
      resizable: true,
    });
  }
  async function renderRecentErrors(body) {
    clear(body).append(el("p", { class: "muted" }, "Loading…"));
    let log;
    try {
      // A BARE ARRAY is what this app's api_getRecentErrors answers, and normalizeErrorLog
      // unwraps that as readily as the {errors, covers, note} envelope a narrower log sends.
      // `covers` and `note` come back null here, so neither line is drawn — this log covers
      // everything the server records.
      log = normalizeErrorLog(await call("api_getRecentErrors", {}));
    } catch (e) {
      clear(body).append(el("p", { class: "muted" }, `Couldn't load errors: ${e.message}`));
      return;
    }
    clear(body).append(...errorLogBody({
      items: log.items, covers: log.covers, note: log.note, fmtDateTime,
      onRefresh: () => renderRecentErrors(body),
      // Clear is a CAPABILITY: this app has api_clearRecentErrors, so the control exists.
      // gas_devsecops has no clear RPC, passes no onClear, and draws no button at all rather
      // than a disabled one offering an operation that does not exist.
      onClear: async () => {
        const ok = await confirmDialog({
          title: "Clear the error log?",
          body: el("p", {}, "Removes all recorded errors. It doesn't affect any scan or ledger data."),
          confirmLabel: "Clear",
        });
        if (!ok) return;
        try {
          await call("api_clearRecentErrors", {});
          toast("Error log cleared.");
          clear(errCountHost);
          errCountHost.append(errorCountBadge([]));
          renderRecentErrors(body);
        } catch (e) {
          toast(`Clear failed: ${e.message}`, "error");
        }
      },
    }));
  }

  const diagnostics = diagnosticsPanel({
    heading: "System health",
    storage: { body: storageHost },
    errors: {
      badge: errCountHost,
      action: recentErrorsBtn,
      note: "The last 25 server-side errors across scan, support-group refresh, import, "
        + "compaction, and other operations — including background failures that never surface "
        + "a toast.",
    },
    // Deployed code stamp — confirm at a glance whether a `clasp push` actually took effect. It
    // rides on the cached bootstrap, but the cache key is itself stamped with the build id
    // (serverCache.ts), so a cached payload can never report a build that is no longer live.
    // Reads "dev" when running locally, where there is no esbuild define step.
    //
    // ONE STAMP, SO NO MISMATCH CHECK. This app has no client-side build stamp to compare
    // against — there is no buildInfo.js here — and passing no `client` is what tells the
    // shared section to print the id rather than a Client/Server comparison whose second half
    // does not exist. A missing id still reads as absent(), never as a value in code type:
    // that absence is the whole point of the card, because it means the deploy stamp did not
    // reach the client.
    build: { server: boot.buildId },
  });

  // ================================================================ tabs, save bar, assembly
  function tabPanel(key, ...children) {
    return el("div", {
      id: `settings-panel-${key}`, role: "tabpanel",
      "aria-labelledby": `settings-${key}`, tabindex: "0",
    }, ...children);
  }
  const registerTab = tabPanel("register", scopePanel, filterGrid);
  const riskTab = tabPanel("risk", riskPanel);
  const attributionTab = tabPanel("attribution", domainsPanel, attributionCrossRef);
  const lifecycleTab = tabPanel("lifecycle", retentionPanel, jobsPanel);
  // The Access roster editor is NOT a diagnostic — it is an editor with its own save control —
  // so it stays a sibling of the read-out grid rather than moving inside it.
  const systemTab = tabPanel("system", diagnostics.node, accessPanelNode);

  const panels = {
    register: registerTab, risk: riskTab, attribution: attributionTab,
    lifecycle: lifecycleTab, system: systemTab,
  };

  // Deep-linkable via `#/settings?tab=risk`, not a sub-path (parseHash splits on "?" and looks
  // up PAGES[pathPart], so a sub-path would fall through to a different page). The Attribution
  // handoff (below) forces this tab regardless of any ?tab= already in the hash.
  const initialTab = params.attribute ? "attribution" : normalizeTab(params.tab);

  const tabs = tabList({
    tabs: SETTINGS_TABS.map((t) => ({ key: t.key, label: t.label })),
    active: initialTab,
    ariaLabel: "Settings sections",
    idPrefix: "settings",
    onSelect: (key) => {
      for (const t of SETTINGS_TABS) panels[t.key].hidden = t.key !== key;
      // history.replaceState — does not fire hashchange, does not re-render. This also covers
      // the Attribution handoff's "read-then-strip": the very first onSelect (fired during
      // tabList's own construction, for `initialTab`) replaces the whole query string,
      // stripping ?attribute=1&sub=…&asset=… down to just ?tab=attribution.
      setParams({ tab: key });
    },
  });

  const bar = saveBar({ onSave, onDiscard, onJump: (tab) => tabs.select(tab) });

  main.append(tabs.node, registerTab, riskTab, attributionTab, lifecycleTab, systemTab, bar.node);

  // ------------------------------------------------------------------------ shared repainting
  function syncDirty() {
    const changed = changedFields(saved, draft);
    bar.update(changeCountText(changed), changeSummary(changed));
    const dt = new Set(dirtyTabs(changed));
    for (const t of SETTINGS_TABS) tabs.setDirty(t.key, dt.has(t.key));
  }

  function onEdit() {
    repaintReadouts();
    syncDirty();
  }

  function repaintReadouts() {
    if (!impact) return; // decorative — every control above already applied its own edit
    clear(scopeReadoutHost);
    scopeReadoutHost.append(severityScopeReadout(impact.census, draft, boot.palette.selectable));

    vfHeadline.textContent = toggleHeadline(impact.toggles.noFix, impact.toggles.openTotal,
      "have no vendor fix available");
    clear(vfBarHost);
    vfBarHost.append(toggleReadoutBar(impact.toggles.noFix, impact.toggles.openTotal,
      "Has a vendor fix", "No vendor fix"));
    vfNote.textContent = toggleReadoutNote(impact.toggles.noFix, impact.toggles.openTotal, draft.showNoFix);

    eolHeadline.textContent = toggleHeadline(impact.toggles.eolOpen, impact.toggles.openTotal,
      "are on an end-of-life operating system");
    clear(eolBarHost);
    eolBarHost.append(toggleReadoutBar(impact.toggles.eolOpen, impact.toggles.openTotal,
      "Supported OS", "End-of-life OS"));
    eolNote.textContent = toggleReadoutNote(impact.toggles.eolOpen, impact.toggles.openTotal, draft.includeEol);

    riskReadout.update(impact.risk.cube, draft.riskRule, { onThresholdChange: setEpssThreshold });

    clear(retentionReadoutHost);
    retentionReadoutHost.append(renderRetentionReadout(impact.scans, draft));
  }

  function setEpssThreshold(raw) {
    let n = Number(raw);
    if (!Number.isFinite(n)) n = draft.riskRule.epssThreshold;
    n = Math.min(1, Math.max(0, n));
    draft.riskRule.epssThreshold = Math.round(n * 100) / 100;
    onEdit();
  }

  function setSwitch(sw, val) {
    sw.input.checked = val;
    // Programmatic — doesn't fire "change", so switchToggle's own listener won't sync this.
    sw.input.setAttribute("aria-checked", val ? "true" : "false");
  }

  function repaintControlsFromDraft() {
    fetchPills.sync();
    displayPills.sync();
    syncDisplayLock();
    setSwitch(showNoFix, draft.showNoFix);
    setSwitch(includeEol, draft.includeEol);
    setSwitch(riskKev, draft.riskRule.kev);
    setSwitch(riskExploit, draft.riskRule.exploit);
    setSwitch(riskEpss, draft.riskRule.epss);
    if (document.activeElement !== riskThreshold) {
      riskThreshold.value = draft.riskRule.epssThreshold.toFixed(2);
    }
    setSwitch(retentionSwitch, draft.retentionDays !== null);
    retentionDays.disabled = draft.retentionDays === null;
    if (document.activeElement !== retentionDays) retentionDays.value = draft.retentionDays ?? 180;
    setSwitch(autoCompactSwitch, draft.autoCompact);
    onEdit();
  }

  async function onSave() {
    const v = validateDraft(draft);
    if (!v.ok) {
      toast(v.message, "warn");
      tabs.select(v.tab);
      return;
    }
    const warnings = draftWarnings(saved, draft);
    for (const w of warnings) {
      const ok = await confirmDialog({
        title: w.title, body: w.body, confirmLabel: w.confirmLabel, danger: true,
      });
      if (!ok) return;
    }
    bar.setBusy(true);
    try {
      const patch = settingsPatch(saved, draft);
      const res = await call("api_saveSettings", { patch });
      savedShape = res;
      Object.assign(saved, settingsDraft(savedShape));
      // Nothing on this page is torn down: every other page just has to refetch on its own
      // next visit, which is what these two do — no ctx.refresh(), no discarded draft.
      invalidateBootstrap();
      invalidateRpcCache();
      await loadImpact();
      syncDirty();
      toast("Settings saved.");
    } catch (e) {
      toast(`Save failed: ${e.message}`, "error");
    } finally {
      bar.setBusy(false);
    }
  }

  function onDiscard() {
    draft = settingsDraft(savedShape);
    repaintControlsFromDraft();
  }

  // ------------------------------------------------------------------------------ first paint
  repaintControlsFromDraft();
  loadHistoryStatus();
  reloadStorageStats();
  await loadImpact();

  // Closed-loop handoff from Attribution's "Attribute…" action: the resource travels via
  // sessionStorage (attributionPrefill.js); the hash flag only signals "go look", and the
  // Attribution tab is already selected and the hash already stripped by the tabList's own
  // initial onSelect above. Read-then-strip so a reload of Settings never re-triggers the
  // chooser. Falls back to minimal hash params when sessionStorage is unavailable (e.g. the
  // GAS iframe sandbox).
  if (params.attribute) {
    let resource = null;
    try {
      const raw = sessionStorage.getItem(PREFILL_KEY);
      sessionStorage.removeItem(PREFILL_KEY);
      resource = decodePrefill(raw);
    } catch {
      resource = null;
    }
    if (!resource && params.sub) resource = { subscription: params.sub, asset: params.asset };
    else if (!resource && params.asset) resource = { asset: params.asset };
    if (resource) domainsEditor.openWithPrefill(resource);
  }
}
