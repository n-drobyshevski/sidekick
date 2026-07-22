// Settings — scan scope, display filter, domain rules editor, data retention.

import { call } from "../api.js";
import { decodePrefill, PREFILL_KEY } from "../attributionPrefill.js";
import { bootstrap, setParams } from "../store.js";
import {
  clear, confirmDialog, el, emptyState, fmtDateTime, openSheet, settingRow, settingsPanel,
  statusPill, switchToggle, toast, usageMeter,
} from "../ui.js";
import { renderDomainsEditor } from "./domainsEditor.js";

export async function renderSettings(main, params, ctx) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "Settings"),
    el("p", { class: "page-sub" }, "Scan scope, display filter, domains, and data retention."),
  );

  // ---------------------------------------------- severity scope (scan + display)
  // Scan scope and display filter are one coupled control (display ⊆ fetch), so they live in
  // one panel with two labeled sub-blocks and a single Save in the footer.
  const fetchPills = pillGroup(boot.palette.selectable, [...boot.settings.fetchSeverities],
    { ariaLabel: "Severities each scan pulls",
      onChange: () => { syncDisplayCoupling(); refreshScopeDirty(); } });
  const displayPills = pillGroup(boot.palette.selectable, [...boot.settings.displaySeverities],
    { ariaLabel: "Severities every page shows", onChange: () => refreshScopeDirty() });
  syncDisplayCoupling(); // enforce display ⊆ fetch on first paint

  // Snapshot the normalized scope so pill edits show an "Unsaved changes" cue and a sibling
  // save can warn before ctx.refresh() discards them — symmetric with the domains editor.
  const scopeSnap = () =>
    JSON.stringify([[...fetchPills.selected].sort(), [...displayPills.selected].sort()]);
  const scopeSaved = scopeSnap();
  const scopeDirty = () => scopeSnap() !== scopeSaved;
  const scopeDirtyHost = el("span", {});
  function refreshScopeDirty() {
    clear(scopeDirtyHost);
    if (scopeDirty()) scopeDirtyHost.append(statusPill("warn", "Unsaved changes"));
  }

  const saveScopeBtn = el("button", { class: "primary", onclick: saveScope }, "Save severity scope");
  main.append(settingsPanel({
    title: "Severity scope",
    description: "Which severities each scan pulls from Wiz, and which of those every page " +
      "shows. Display is always a subset of the scan scope.",
    body: [
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
    ],
    footer: [saveScopeBtn, scopeDirtyHost],
  }));

  function pillGroup(options, selected, { onChange, ariaLabel } = {}) {
    const pills = {};
    const node = el("div", { class: "pill-row", role: "group", "aria-label": ariaLabel });
    for (const sev of options) {
      const btn = el("button", {
        class: `sev-pill sev-${sev}`, type: "button",
        "aria-pressed": selected.includes(sev) ? "true" : "false",
        onclick: () => {
          if (btn.getAttribute("aria-disabled") === "true") return; // locked (out of scan scope)
          const i = selected.indexOf(sev);
          if (i >= 0) selected.splice(i, 1);
          else selected.push(sev);
          btn.setAttribute("aria-pressed", selected.includes(sev) ? "true" : "false");
          if (onChange) onChange();
        },
      }, sev);
      pills[sev] = btn;
      node.append(btn);
    }
    return { node, selected, pills };
  }

  // Display must be a subset of the scan scope: a severity the scan no longer fetches can't
  // be shown, so lock (and drop) any display pill outside the current fetch selection —
  // keeping the "always a subset" promise the copy makes instead of relying on the server.
  function syncDisplayCoupling() {
    const fetchSet = new Set(fetchPills.selected);
    for (const sev of boot.palette.selectable) {
      const btn = displayPills.pills[sev];
      if (fetchSet.has(sev)) {
        btn.removeAttribute("aria-disabled");
        btn.removeAttribute("title");
      } else {
        const i = displayPills.selected.indexOf(sev);
        if (i >= 0) displayPills.selected.splice(i, 1);
        btn.setAttribute("aria-pressed", "false");
        btn.setAttribute("aria-disabled", "true");
        btn.title = "Not in the scan scope — add it above to show it.";
      }
    }
  }

  // Every save on this page calls ctx.refresh(), which rebuilds the page and throws away the
  // in-memory severity-scope and domains drafts. Warn first. `ignore*` skips the draft the
  // current save owns (saving scope shouldn't warn about scope; saving domains, about domains).
  async function guardUnsavedDrafts({ ignoreDomains = false, ignoreScope = false } = {}) {
    const domainsBad = !ignoreDomains && domainsEditor && domainsEditor.isDirty();
    const scopeBad = !ignoreScope && scopeDirty();
    if (!domainsBad && !scopeBad) return true;
    const what = domainsBad && scopeBad ? "domains and severity scope"
      : domainsBad ? "domains" : "the severity scope";
    return confirmDialog({
      title: "Discard unsaved changes?",
      body: `This page has unsaved changes to ${what}. Saving here reloads the page and ` +
        "discards them — save those first to keep them.",
      confirmLabel: "Discard & continue",
      danger: true,
    });
  }

  async function saveScope() {
    if (!(await guardUnsavedDrafts({ ignoreScope: true }))) return;
    if (!fetchPills.selected.length) {
      toast("At least one severity must stay in the scan scope.", "warn");
      return;
    }
    if (!displayPills.selected.length) {
      toast("At least one severity must stay visible in the display filter.", "warn");
      return;
    }
    if (!fetchPills.selected.includes("CRITICAL")) {
      const go = await confirmDialog({
        title: "Drop CRITICAL from scans?",
        body: "Scans will stop measuring critical findings entirely. This is rarely intended.",
        confirmLabel: "Drop CRITICAL",
        danger: true,
      });
      if (!go) return;
    }
    saveScopeBtn.disabled = true;
    try {
      const res = await call("api_setSeverities", {
        fetch: fetchPills.selected,
        display: displayPills.selected,
      });
      toast(`Saved — scanning ${res.fetchSeverities.join(", ")}; showing ${res.displaySeverities.join(", ")}.`);
      ctx.refresh();
    } catch (e) {
      toast(`Save failed: ${e.message}`, "error");
      saveScopeBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------- vendor-fix filter
  const showNoFix = switchToggle({
    checked: boot.settings.showNoFix !== false, id: "show-no-fix",
    ariaLabel: "Show findings awaiting a vendor fix",
  });
  const saveNoFixBtn = el("button", { class: "primary", onclick: saveShowNoFix }, "Save vendor-fix filter");
  main.append(settingsPanel({
    title: "Vendor-fix filter",
    description: "Findings with no vendor fix available yet sit outside the SLA clock. " +
      "Turning this off hides them from every chart, table, KPI, and export across the " +
      "whole register.",
    body: settingRow({
      label: "Show findings awaiting a vendor fix",
      description: "Off = excluded from every chart, table, KPI, and export.",
      control: showNoFix.node,
      htmlFor: "show-no-fix",
    }),
    footer: saveNoFixBtn,
  }));

  async function saveShowNoFix() {
    if (!(await guardUnsavedDrafts())) return;
    saveNoFixBtn.disabled = true;
    try {
      await call("api_setShowNoFix", { on: showNoFix.input.checked });
      toast("Vendor-fix filter saved.");
      ctx.refresh();
    } catch (e) {
      toast(`Save failed: ${e.message}`, "error");
      saveNoFixBtn.disabled = false;
    }
  }

  // ------------------------------------------------------- end-of-life OS filter
  const includeEol = switchToggle({
    checked: boot.settings.includeEol !== false, id: "include-eol",
    ariaLabel: "Include findings on end-of-life operating systems",
  });
  const saveEolBtn = el("button", { class: "primary", onclick: saveIncludeEol }, "Save end-of-life filter");
  main.append(settingsPanel({
    title: "End-of-life OS filter",
    description: "Findings on end-of-life operating systems can't be remediated by patching — " +
      "the OS itself must be replaced — so they sit open indefinitely and skew MTTR and SLA.",
    body: settingRow({
      label: "Include findings on end-of-life operating systems",
      description: "Off = excluded from every chart, table, KPI, and export.",
      control: includeEol.node,
      htmlFor: "include-eol",
    }),
    footer: saveEolBtn,
  }));

  async function saveIncludeEol() {
    if (!(await guardUnsavedDrafts())) return;
    saveEolBtn.disabled = true;
    try {
      await call("api_setIncludeEol", { on: includeEol.input.checked });
      toast("End-of-life filter saved.");
      ctx.refresh();
    } catch (e) {
      toast(`Save failed: ${e.message}`, "error");
      saveEolBtn.disabled = false;
    }
  }

  // -------------------------------------------------------------- support groups
  const sgStatus = el("span", { class: "muted small" });
  const refreshSgBtn = el("button", {
    onclick: refreshSupportGroups,
    disabled: boot.hasCredentials ? null : true,
    title: boot.hasCredentials ? null : "Live Wiz credentials are required.",
  }, "Refresh support groups");
  if (!boot.hasCredentials) {
    sgStatus.textContent = "Dry-run mode — connect Wiz credentials to refresh.";
  }
  main.append(settingsPanel({
    title: "Support groups",
    description: "A support group is the value of a subscription's Wiz/provisioning tag " +
      "(e.g. CS-SUPPLY-MONITORING). Refreshing pulls every tagged subscription from Wiz and " +
      "joins it onto findings, powering the Support group filter, breakdown, and domain " +
      "condition. Also refreshes automatically after each scan.",
    body: el("div", { style: "display:flex; align-items:center; gap:10px; flex-wrap:wrap" },
      refreshSgBtn, sgStatus),
  }));

  async function refreshSupportGroups() {
    if (!(await guardUnsavedDrafts())) return;
    refreshSgBtn.disabled = true;
    sgStatus.textContent = "Refreshing from Wiz…";
    try {
      const res = await call("api_refreshSupportGroups", {});
      sgStatus.textContent =
        `Mapped ${res.subscriptions} subscription(s) → ${res.groups} support group(s) ` +
        `(tag ${res.tagKey}).`;
      toast("Support groups refreshed.");
      ctx.refresh();
    } catch (e) {
      sgStatus.textContent = "";
      toast(`Refresh failed: ${e.message}`, "error");
      refreshSgBtn.disabled = false;
    }
  }

  // -------------------------------------------------------------------- domains
  const domainsHost = el("div", {});
  const domainsBody = [];
  if (typeof boot.unassignedCount === "number" && boot.unassignedCount > 0) {
    domainsBody.push(el("p",
      { class: "small", style: "display:flex; align-items:center; gap:8px; margin:0 0 12px" },
      statusPill("warn", `${boot.unassignedCount.toLocaleString()} findings unassigned`),
      el("a", { href: "#/attribution", target: "_self" }, "Review in Attribution →")));
  }
  domainsBody.push(domainsHost);
  main.append(settingsPanel({
    title: "Domains",
    description: "Rule-based triage: route findings to named domains by tag, asset-name " +
      "pattern, subscription, or support group. Order is priority — the first matching " +
      "domain wins.",
    body: domainsBody,
  }));
  // Saving domains also reloads the page, so it must warn about unsaved severity-scope edits.
  const domainsEditor = renderDomainsEditor(domainsHost, boot, ctx,
    { guardOtherDrafts: () => guardUnsavedDrafts({ ignoreDomains: true }) });

  // Closed-loop handoff from Attribution's "Attribute…" action: the resource travels via
  // sessionStorage (attributionPrefill.js), with the hash flag only signalling "go look".
  // Read-then-strip so a reload of Settings never re-triggers the chooser. Falls back to
  // minimal hash params when sessionStorage is unavailable (e.g. the GAS iframe sandbox).
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
    setParams({});
    if (resource) domainsEditor.openWithPrefill(resource);
  }

  // ------------------------------------------------------------- data retention
  const r = boot.settings;
  const retentionSwitch = switchToggle({
    checked: r.retentionDays !== null, id: "ret-on",
    ariaLabel: "Seal scans older than the retention window",
  });
  const retentionDays = el("input", {
    type: "number", min: "30", step: "1", value: r.retentionDays ?? 180,
    style: "width:96px", "aria-label": "Retention window in days",
    disabled: r.retentionDays === null ? true : null,
  });
  retentionSwitch.input.addEventListener("change", () => {
    retentionDays.disabled = !retentionSwitch.input.checked;
  });
  const autoCompactSwitch = switchToggle({
    checked: !!r.autoCompact, id: "auto-compact",
    ariaLabel: "Compact automatically after each scan",
  });
  const saveRetentionBtn = el("button", { class: "primary", onclick: saveRetention }, "Save retention");
  const compactBtn = el("button", { onclick: compactNow }, "Compact now…");

  main.append(settingsPanel({
    title: "Data retention",
    description: "Sealing rolls closed findings into exact episode rows and prunes raw " +
      "archives; MTTR and every trend stay identical. The two most recent full scans always stay.",
    body: [
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
    ],
    footer: [saveRetentionBtn, compactBtn],
  }));

  async function saveRetention() {
    if (!(await guardUnsavedDrafts())) return;
    if (retentionSwitch.input.checked) {
      const days = Number(retentionDays.value);
      if (!Number.isFinite(days) || days < 30) {
        toast("Retention window must be at least 30 days.", "warn");
        return;
      }
    }
    saveRetentionBtn.disabled = true;
    try {
      // One atomic write — no partial-commit window where retention persists but auto-compact
      // fails while the toast says "Save failed".
      await call("api_setRetentionSettings", {
        days: retentionSwitch.input.checked ? Number(retentionDays.value) : null,
        autoCompact: autoCompactSwitch.input.checked,
      });
      toast("Retention settings saved.");
      ctx.refresh();
    } catch (e) {
      toast(`Save failed: ${e.message}`, "error");
      saveRetentionBtn.disabled = false;
    }
  }

  async function compactNow() {
    if (!(await guardUnsavedDrafts())) return;
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
            `unchanged before the compaction commits.`)),
        confirmLabel: "Compact",
      });
      if (!ok) return;
      try {
        const res = await call("api_compact", { dryRun: false });
        toast(`Compacted ${res.scans_sealed} scan(s) — ${res.episodes_created} episode(s) created.`);
        ctx.refresh();
      } catch (e) {
        toast(`Compaction failed: ${e.message}`, "error");
      }
    } finally {
      compactBtn.disabled = false;
    }
  }

  // ------------------------------------------------------------- storage stats
  try {
    const stats = await call("api_getStorageStats", {});
    const near = stats.cellCount > 6_000_000;
    const storageBody = [
      usageMeter({
        used: stats.cellCount, total: stats.cellLimit, label: "Spreadsheet cells",
        state: near ? "warn" : "",
        note: near ? "Approaching the 10M-cell ceiling — lower the retention window." : null,
      }),
      el("p", { class: "muted small", style: "margin:12px 0 0" },
        `${stats.scanCount} scan(s), ${stats.sealedCount} sealed, ` +
        `${stats.trackedVulns.toLocaleString()} tracked vulnerabilities.`),
    ];
    // Data-quality line: tracked vulnerabilities whose severity never normalized to a real
    // value. distinctSeverities/unknownSeverityCount are additive fields on this payload —
    // guarded defensively so a stale pre-rollout cache (missing both) simply omits the line.
    if (stats.unknownSeverityCount) {
      const n = stats.unknownSeverityCount;
      storageBody.push(el("p", { class: "muted small", style: "margin:6px 0 0" },
        `${n.toLocaleString()} tracked vulnerabilit${n === 1 ? "y" : "ies"} have an ` +
        "unrecognized severity. Severity values seen this scan: " +
        `${(stats.distinctSeverities || []).join(", ")}.`));
    }
    main.append(settingsPanel({ title: "Storage", body: storageBody }));
  } catch {
    /* stats are decorative */
  }

  // ------------------------------------------------------------- diagnostics
  // Recent server-side errors, surfaced in-app so a failure — especially a background one
  // that never shows a toast (post-scan support-group refresh, MTTR snapshot, auto-compaction)
  // — is visible without opening the Apps Script execution log the web app can't reach.
  const errCountHost = el("span", { class: "muted small" });
  const recentErrorsBtn = el("button", { onclick: openRecentErrors }, "Recent errors");
  main.append(settingsPanel({
    title: "Diagnostics",
    description: "The last 25 server-side errors across scan, support-group refresh, import, " +
      "compaction, and other operations — including background failures that never surface a toast.",
    body: el("div", { style: "display:flex; align-items:center; gap:10px; flex-wrap:wrap" },
      recentErrorsBtn, errCountHost),
  }));

  // Best-effort count badge so a silent failure is discoverable at a glance (the log itself
  // is decorative — a failed fetch just leaves the badge blank).
  (async () => {
    try {
      const errs = await call("api_getRecentErrors", {});
      clear(errCountHost);
      if (errs && errs.length) errCountHost.append(statusPill("bad", `${errs.length} recorded`));
      else errCountHost.textContent = "None recorded.";
    } catch {
      /* decorative */
    }
  })();

  function openRecentErrors() {
    openSheet(renderRecentErrors, {
      title: "Recent errors",
      subtitle: "Newest first — the last 25 server-side errors.",
      width: "min(680px, 94vw)",
      minWidth: 420,
      storageKey: "sheetWidthDiagnostics",
    });
  }

  async function renderRecentErrors(body) {
    clear(body).append(el("p", { class: "muted" }, "Loading…"));
    let errs;
    try {
      errs = await call("api_getRecentErrors", {});
    } catch (e) {
      clear(body).append(el("p", { class: "muted" }, `Couldn't load errors: ${e.message}`));
      return;
    }
    clear(body);
    body.append(el("div", { style: "display:flex; gap:8px; margin-bottom:12px" },
      el("button", { onclick: () => renderRecentErrors(body) }, "Refresh"),
      el("button", {
        disabled: errs.length ? null : true,
        onclick: async () => {
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
            errCountHost.textContent = "None recorded.";
            renderRecentErrors(body);
          } catch (e) {
            toast(`Clear failed: ${e.message}`, "error");
          }
        },
      }, "Clear log")));
    if (!errs.length) {
      body.append(emptyState("No errors recorded.",
        "Background and foreground failures will appear here as they happen."));
      return;
    }
    const tbody = el("tbody", {});
    for (const e of errs) {
      tbody.append(el("tr", {},
        el("td", { class: "small muted", style: "white-space:nowrap" }, fmtDateTime(e.ts)),
        el("td", {}, el("strong", {}, e.op || "—")),
        el("td", {}, statusPill(e.kind === "error" ? "bad" : "warn", e.kind || "error")),
        el("td", {},
          el("code", { class: "small", style: "white-space:pre-wrap; word-break:break-word" },
            e.message || "—")),
      ));
    }
    body.append(el("div", { class: "table-wrap" },
      el("table", { class: "data" },
        el("thead", {}, el("tr", {},
          ...["When", "Operation", "Kind", "Message"].map((h) => el("th", { scope: "col" }, h)))),
        tbody)));
  }
}
