// Settings — scan scope, display filter, domain rules editor, data retention.

import { call } from "../api.js";
import { bootstrap } from "../store.js";
import { confirmDialog, el, sectionLabel, toast } from "../ui.js";
import { renderDomainsEditor } from "./domainsEditor.js";

export async function renderSettings(main, _params, ctx) {
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
    { onChange: syncDisplayCoupling });
  main.append(fetchPills.node);

  // ------------------------------------------------------------- display filter
  main.append(sectionLabel("Display filter"));
  main.append(el("p", { class: "muted small" },
    "Which severities every page shows — always a subset of the scan scope. A severity " +
    "outside the scan scope is locked here until you add it above."));
  const displayPills = pillGroup(boot.palette.selectable, [...boot.settings.displaySeverities]);
  main.append(displayPills.node);
  syncDisplayCoupling(); // enforce display ⊆ fetch on first paint

  const saveScopeBtn = el("button", { class: "primary", onclick: saveScope }, "Save severity scope");
  main.append(el("div", { style: "margin-top:12px" }, saveScopeBtn));

  function pillGroup(options, selected, { onChange } = {}) {
    const pills = {};
    const node = el("div", { class: "pill-row", role: "group" });
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

  // Sibling saves (scope / retention / support groups / compaction) all call ctx.refresh(),
  // which rebuilds the page and throws away the domains editor's in-memory draft. Warn first
  // so unsaved value-chain edits aren't lost silently.
  async function guardDomainsDraft() {
    if (!domainsEditor || !domainsEditor.isDirty()) return true;
    return confirmDialog({
      title: "Discard unsaved domain changes?",
      body: "The Domains editor has unsaved edits. Saving here reloads the page and discards " +
        "them — save your domains first to keep them.",
      confirmLabel: "Discard & continue",
      danger: true,
    });
  }

  async function saveScope() {
    if (!(await guardDomainsDraft())) return;
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
    if (!(await guardDomainsDraft())) return;
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
  const domainsHost = el("div", {});
  main.append(domainsHost);
  const domainsEditor = renderDomainsEditor(domainsHost, boot, ctx);

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
        el("button", { onclick: compactNow }, "Compact now…"),
      ),
    ),
  );

  async function saveRetention() {
    if (!(await guardDomainsDraft())) return;
    if (retentionToggle.checked) {
      const days = Number(retentionDays.value);
      if (!Number.isFinite(days) || days < 30) {
        toast("Retention window must be at least 30 days.", "warn");
        return;
      }
    }
    saveRetentionBtn.disabled = true; // block a double-submit across the two sequential calls
    try {
      await call("api_setRetention", {
        days: retentionToggle.checked ? Number(retentionDays.value) : null,
      });
      await call("api_setAutoCompact", { on: autoCompact.checked });
      toast("Retention settings saved.");
      ctx.refresh();
    } catch (e) {
      toast(`Save failed: ${e.message}`, "error");
      saveRetentionBtn.disabled = false;
    }
  }

  async function compactNow() {
    if (!(await guardDomainsDraft())) return;
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
  } catch {
    /* stats are decorative */
  }
}
