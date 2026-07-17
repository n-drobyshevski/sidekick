// Settings — scan scope, display filter, domain rules editor, data retention.

import { call } from "../api.js";
import { decodePrefill, PREFILL_KEY } from "../attributionPrefill.js";
import { bootstrap, setParams } from "../store.js";
import { clear, confirmDialog, el, sectionLabel, statusPill, toast } from "../ui.js";
import { renderDomainsEditor } from "./domainsEditor.js";

export async function renderSettings(main, params, ctx) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "Settings"),
    el("p", { class: "page-sub" }, "Scan scope, display filter, domains, and data retention."),
  );

  // ---------------------------------------------------------------- scan scope
  main.append(sectionLabel("Scan scope"));
  main.append(el("p", { class: "muted small" },
    "Which severities each scan pulls from Wiz. Narrower scope = faster scans; " +
    "severities outside the scope pause their lifecycle tracking."));
  const fetchPills = pillGroup(boot.palette.selectable, [...boot.settings.fetchSeverities],
    { ariaLabel: "Severities each scan pulls",
      onChange: () => { syncDisplayCoupling(); refreshScopeDirty(); } });
  main.append(fetchPills.node);

  // ------------------------------------------------------------- display filter
  main.append(sectionLabel("Display filter"));
  main.append(el("p", { class: "muted small" },
    "Which severities every page shows — always a subset of the scan scope. A severity " +
    "outside the scan scope is locked here until you add it above."));
  const displayPills = pillGroup(boot.palette.selectable, [...boot.settings.displaySeverities],
    { ariaLabel: "Severities every page shows", onChange: () => refreshScopeDirty() });
  main.append(displayPills.node);
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
  main.append(el("div",
    { style: "display:flex; align-items:center; gap:10px; margin-top:12px" },
    saveScopeBtn, scopeDirtyHost));

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
  main.append(sectionLabel("Vendor-fix filter"));
  main.append(el("p", { class: "muted small" },
    "Findings with no vendor fix available yet sit outside the SLA clock. Unchecking this " +
    "hides them from every chart, table, KPI, and export across the whole register."));
  const showNoFixToggle = el("input", {
    type: "checkbox", id: "show-no-fix",
    checked: boot.settings.showNoFix !== false ? true : null,
  });
  const saveNoFixBtn = el("button", { class: "primary", onclick: saveShowNoFix }, "Save vendor-fix filter");
  main.append(
    el("div", { class: "card", style: "display:flex; flex-direction:column; gap:10px" },
      el("label", { for: "show-no-fix", style: "display:flex; align-items:center; gap:8px" },
        showNoFixToggle,
        "Show findings awaiting a vendor fix ",
        el("span", { class: "muted small" },
          "(unchecking hides them from every chart, table, KPI, and export)")),
      saveNoFixBtn,
    ),
  );

  async function saveShowNoFix() {
    if (!(await guardUnsavedDrafts())) return;
    saveNoFixBtn.disabled = true;
    try {
      await call("api_setShowNoFix", { on: showNoFixToggle.checked });
      toast("Vendor-fix filter saved.");
      ctx.refresh();
    } catch (e) {
      toast(`Save failed: ${e.message}`, "error");
      saveNoFixBtn.disabled = false;
    }
  }

  // -------------------------------------------------------------- support groups
  main.append(sectionLabel("Support groups"));
  main.append(el("p", { class: "muted small" },
    "A support group is the value of a subscription's Wiz/provisioning tag " +
    "(e.g. CS-SUPPLY-MONITORING). Refreshing pulls every tagged subscription from Wiz " +
    "and joins it onto findings, powering the Support group filter, breakdown, and " +
    "domain condition. Also refreshes automatically after each scan."));
  const sgStatus = el("span", { class: "muted small", style: "margin-left:10px" });
  const refreshSgBtn = el("button", {
    onclick: refreshSupportGroups,
    disabled: boot.hasCredentials ? null : true,
    title: boot.hasCredentials ? null : "Live Wiz credentials are required.",
  }, "Refresh support groups");
  main.append(el("div", { style: "display:flex; align-items:center; gap:4px" },
    refreshSgBtn, sgStatus));
  if (!boot.hasCredentials) {
    sgStatus.textContent = "Dry-run mode — connect Wiz credentials to refresh.";
  }

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
  main.append(sectionLabel("Domains"));
  main.append(el("p", { class: "muted small" },
    "Rule-based triage: route findings to named domains by tag, asset-name pattern, " +
    "subscription, or support group. Order is priority — the first matching domain wins."));
  if (typeof boot.unassignedCount === "number" && boot.unassignedCount > 0) {
    main.append(el("p", { class: "small", style: "display:flex; align-items:center; gap:8px" },
      statusPill("warn", `${boot.unassignedCount.toLocaleString()} findings unassigned`),
      el("a", { href: "#/attribution", target: "_self" }, "Review in Attribution →")));
  }
  const domainsHost = el("div", {});
  main.append(domainsHost);
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
  main.append(sectionLabel("Data retention"));
  const r = boot.settings;
  const retentionToggle = el("input", {
    type: "checkbox", id: "ret-on", checked: r.retentionDays !== null ? true : null,
  });
  const retentionDays = el("input", {
    type: "number", min: "30", step: "1", value: r.retentionDays ?? 180,
    style: "width:90px", "aria-label": "Retention window in days",
    disabled: r.retentionDays === null ? true : null,
  });
  retentionToggle.addEventListener("change", () => {
    retentionDays.disabled = !retentionToggle.checked;
  });
  const autoCompact = el("input", { type: "checkbox", id: "auto-compact",
    checked: r.autoCompact ? true : null });
  const saveRetentionBtn = el("button", { class: "primary", onclick: saveRetention }, "Save retention");
  const compactBtn = el("button", { onclick: compactNow }, "Compact now…");

  main.append(
    el("div", { class: "card", style: "display:flex; flex-direction:column; gap:10px" },
      el("label", { for: "ret-on", style: "display:flex; align-items:center; gap:8px" },
        retentionToggle,
        "Seal scans older than ", retentionDays, " days ",
        el("span", { class: "muted small" },
          "(closed findings roll into exact episode rows; MTTR and trends stay identical)")),
      el("label", { for: "auto-compact", style: "display:flex; align-items:center; gap:8px" },
        autoCompact, "Compact automatically after each scan"),
      el("div", { style: "display:flex; gap:8px" },
        saveRetentionBtn,
        compactBtn,
      ),
    ),
  );

  async function saveRetention() {
    if (!(await guardUnsavedDrafts())) return;
    if (retentionToggle.checked) {
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
        days: retentionToggle.checked ? Number(retentionDays.value) : null,
        autoCompact: autoCompact.checked,
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
    const pct = ((stats.cellCount / stats.cellLimit) * 100).toFixed(1);
    main.append(sectionLabel("Storage"));
    main.append(el("p", { class: "muted small" },
      `${stats.cellCount.toLocaleString()} of ${stats.cellLimit.toLocaleString()} spreadsheet ` +
      `cells in use (${pct}%) — ${stats.scanCount} scan(s), ${stats.sealedCount} sealed, ` +
      `${stats.trackedVulns.toLocaleString()} tracked vulnerabilities.` +
      (stats.cellCount > 6_000_000
        ? " ⚠ Approaching the 10M-cell ceiling — lower the retention window."
        : "")));
    // Data-quality line: tracked vulnerabilities whose severity never normalized to a real
    // value. distinctSeverities/unknownSeverityCount are additive fields on this payload —
    // guarded defensively so a stale pre-rollout cache (missing both) simply omits the line.
    if (stats.unknownSeverityCount) {
      const n = stats.unknownSeverityCount;
      main.append(el("p", { class: "muted small" },
        `${n.toLocaleString()} tracked vulnerabilit${n === 1 ? "y" : "ies"} have an ` +
        "unrecognized severity. Severity values seen this scan: " +
        `${(stats.distinctSeverities || []).join(", ")}.`));
    }
  } catch {
    /* stats are decorative */
  }
}
