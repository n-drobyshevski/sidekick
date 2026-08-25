// Data — the report generator, raw exports, and the one-time legacy migration
// import, merged from the former Reports and Exports pages.

import { call } from "../api.js";
import { renderCapacity } from "../capacity.js";
import {
  MAX_BUNDLE_BYTES,
  classifyImportFiles,
  gzipToBase64,
  parseMigrationBundle,
} from "../migrationImport.js";
import { bootstrap } from "../store.js";
import { purgeStatusView } from "../purgeStatus.js";
import {
  clear,
  confirmDialog,
  downloadText,
  el,
  emptyState,
  fmtDateTime,
  fmtDays,
  progressBar,
  scopeBar,
  sectionLabel,
  settingRow,
  settingsPanel,
  switchToggle,
  toast,
} from "../ui.js";

// A one-line description of the global scope a report/export is generated under, so a
// downloaded audit artifact says what population it covers instead of leaving it to guess.
function scopeLine(domain, supportGroup, bizDomain) {
  const parts = [];
  if (domain) parts.push(`Manual group: ${domain}`);
  if (bizDomain) parts.push(`VC Domain: ${bizDomain}`);
  if (supportGroup) parts.push(`Support group: ${supportGroup}`);
  return parts.length ? `Scoped to ${parts.join(" · ")}.` : "The whole register.";
}

export async function renderData(main, params, ctx) {
  const boot = await bootstrap();
  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";
  const bizDomain = ctx.bizDomain || "";
  main.append(
    el("h1", {}, "Data"),
    el("p", { class: "page-sub" }, "Reports out, raw data out, legacy history in."),
  );
  const scopeChips = scopeBar({ domain, supportGroup, bizDomain, onClear: ctx.clearScope });
  if (scopeChips) main.append(scopeChips);

  main.append(sectionLabel("Report"));
  if (boot.latestScan) {
    // Synchronous mount + lazy preview: the report preview must never block (or, on error,
    // blank) the Export and Import sections below, which don't even need a scan.
    renderReportSection(main, boot, domain, supportGroup, bizDomain);
  } else {
    main.append(el("p", { class: "muted small" },
      "No scan saved yet — run a scan to generate a report."));
  }

  main.append(sectionLabel("Export"));
  if (boot.latestScan) {
    renderExportSection(main, boot, domain, supportGroup, bizDomain);
  } else {
    main.append(el("p", { class: "muted small" },
      "No scan saved yet — run a scan to export findings."));
  }

  main.append(sectionLabel("Import"));
  renderImportSection(main, ctx);

  // Maintenance above Storage, and Storage stays last, for the reason already written down at
  // renderStorageSection: the meter belongs directly under the actions that move it. These
  // are the actions that move it the most.
  //
  // Deliberately NOT scoped, unlike Report and Export above and like the migration bundle:
  // it acts on the register, not on a view of it. A purge that removed only the rows visible
  // under the current Manual group / VC Domain / Support group would delete a slice nobody
  // asked for, and the archive rewrite behind it has no way to express that slice at all —
  // it walks whole scans.
  main.append(sectionLabel("Maintenance"));
  renderMaintenanceSection(main, boot, ctx);

  main.append(sectionLabel("Storage"));
  renderStorageSection(main);
}

// ------------------------------------------------------------------------ storage

/**
 * How much of the ledger spreadsheet's 10M-cell ceiling is left, and which tabs are spending
 * it. It belongs on this page rather than only in Settings because the actions that move the
 * number — export and archive, import a bundle, keep more history — are the ones directly
 * above it.
 *
 * Mounted synchronously and filled lazily: the stats call walks every sheet, and it must never
 * delay (or, on error, blank) the sections above, which is why the whole block is best-effort.
 */
function renderStorageSection(main) {
  const card = el("div", { class: "card" });
  card.append(el("h3", {}, "Ledger spreadsheet"));
  const host = el("div", {});
  card.append(host);
  main.append(card);

  (async () => {
    try {
      renderCapacity(host, await call("api_getStorageStats", {}));
    } catch {
      clear(host).append(el("p", { class: "muted small" },
        "Storage usage is unavailable right now."));
    }
  })();
}

// ------------------------------------------------------------------------- report

function renderReportSection(main, boot, domain, supportGroup, bizDomain) {
  // Scope the report to whatever the header switcher holds ("" = no filter).
  const domains = domain ? [domain] : [];
  const supportGroups = supportGroup ? [supportGroup] : [];
  // The report and export endpoints have always taken arrays; the header switcher sets at
  // most one of the three, so each is a list of nothing or a list of one.
  const bizDomains = bizDomain ? [bizDomain] : [];
  let format = "markdown";
  // A segmented toggle group (aria-pressed), not a radiogroup — the buttons are toggle
  // buttons, so radiogroup semantics (role=radio + arrow keys) would misannounce them.
  const controls = el("div", { class: "filter-bar", role: "group", "aria-label": "Report format" });
  for (const [value, label] of [["markdown", "Markdown"], ["csv", "CSV"], ["json", "JSON"]]) {
    const btn = el("button", {
      class: "seg-btn", type: "button",
      "aria-pressed": format === value ? "true" : "false",
      onclick: () => {
        format = value;
        controls.querySelectorAll("button.seg-btn").forEach((b) =>
          b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      },
    }, label);
    controls.append(btn);
  }
  const generateBtn = el("button", { class: "primary", onclick: generate }, "Generate & download");
  controls.append(generateBtn);

  main.append(
    el("p", { class: "muted small", style: "margin:-2px 0 8px" },
      scopeLine(domain, supportGroup, bizDomain)),
    controls,
  );
  const previewHost = el("div", {});
  main.append(previewHost);

  // Severity matrix preview — loaded lazily and guarded, so a failed/slow report RPC leaves
  // Export and Import mounted rather than blanking the whole page.
  loadPreview();
  async function loadPreview() {
    clear(previewHost).append(el("p", { class: "muted small" }, "Loading report preview…"));
    try {
      const preview = await call("api_getReport", { format: "json", domains, supportGroups, bizDomains });
      renderMatrix(preview.matrix);
    } catch (e) {
      clear(previewHost).append(el("p", { class: "small" },
        `Report preview unavailable: ${e.message} `,
        el("button", { class: "link", type: "button", onclick: loadPreview }, "Retry")));
    }
  }

  function renderMatrix(matrix) {
    clear(previewHost);
    previewHost.append(el("div", { class: "label", style: "margin:2px 0 6px" },
      "Report preview — severity by source"));
    if (!matrix.length) {
      previewHost.append(emptyState("No findings in the current scope."));
      return;
    }
    const sevCols = boot.palette.order;
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, "Source"),
        ...sevCols.map((s) => el("th", { scope: "col" }, s)),
        el("th", { scope: "col" }, "Total"),
        el("th", { scope: "col" }, "Median MTTR"),
        el("th", { scope: "col" }, "Open"))),
    );
    const tbody = el("tbody", {});
    for (const row of matrix) {
      tbody.append(el("tr", {},
        el("td", {}, row.source),
        ...sevCols.map((s) => el("td", { class: "num" }, row[s] ?? 0)),
        el("td", { class: "num" }, row.total),
        el("td", { class: "num" }, fmtDays(row.medianMttr)),
        el("td", { class: "num" }, row.open),
      ));
    }
    table.append(tbody);
    previewHost.append(el("div", { class: "table-wrap", style: "margin-top:4px" }, table));
  }

  async function generate() {
    generateBtn.disabled = true;
    try {
      const res = await call("api_getReport", { format, domains, supportGroups, bizDomains });
      const mime = format === "json" ? "application/json"
        : format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8";
      downloadText(res.filename, res.content, mime);
    } catch (e) {
      toast(`Report failed: ${e.message}`, "error");
    } finally {
      generateBtn.disabled = false;
    }
  }
}

// ------------------------------------------------------------------------- export

function renderExportSection(main, boot, domain, supportGroup, bizDomain) {
  // Honor the same global filters as the Report block so the two never export different
  // populations of the same ledger, and say which scope was applied.
  const domains = domain ? [domain] : [];
  const supportGroups = supportGroup ? [supportGroup] : [];
  // The report and export endpoints have always taken arrays; the header switcher sets at
  // most one of the three, so each is a list of nothing or a list of one.
  const bizDomains = bizDomain ? [bizDomain] : [];
  const card = el("div", { class: "card" });
  card.append(
    el("h3", {}, "OS vulnerabilities"),
    el("p", { class: "muted small" },
      `Scan ${fmtDateTime(boot.latestScan.ts)} — ` +
      `${boot.latestScan.total.toLocaleString()} finding(s), ${boot.latestScan.mode}.`),
    el("p", { class: "muted small", style: "margin-top:-4px" },
      scopeLine(domain, supportGroup, bizDomain)),
  );
  const row = el("div", { style: "display:flex; gap:8px; flex-wrap:wrap" });
  const csvBtn = el("button", { onclick: csv }, "Download CSV");
  const rawBtn = el("button", { onclick: raw }, "Raw JSON (Drive)");
  const bundleBtn = el("button", { onclick: bundle }, "Migration bundle (Drive)");
  row.append(csvBtn, rawBtn, bundleBtn);
  const rawHost = el("div", { style: "margin-top:10px" });
  const bundleHost = el("div", { style: "margin-top:10px" });
  card.append(row, rawHost, bundleHost);
  // The bundle is the whole register, not the filtered frame — say so, because it sits
  // under a heading whose other two buttons honor the global filters.
  card.append(el("p", { class: "muted small" },
    "The migration bundle carries the entire durable ledger — every scan, lifecycle and " +
    "resolved episode — ignoring the filters above. It is the file another surface " +
    "imports, and this app can re-import it too."));
  main.append(card);

  async function csv() {
    csvBtn.disabled = true;
    try {
      const res = await call("api_getExportCsv", { source: "findings", domains, supportGroups, bizDomains });
      downloadText(res.filename, res.content, "text/csv;charset=utf-8");
    } catch (e) {
      toast(`Export failed: ${e.message}`, "error");
    } finally {
      csvBtn.disabled = false;
    }
  }

  async function raw() {
    rawBtn.disabled = true;
    clear(rawHost).append(el("p", { class: "muted small" }, "Locating archive…"));
    try {
      const res = await call("api_getExportRawUrl", { scanId: boot.latestScan.scanId });
      clear(rawHost);
      if (!res.urls.length) {
        rawHost.append(el("p", { class: "muted small" },
          "No raw archive is available for this scan (it may have been compacted)."));
        return;
      }
      rawHost.append(el("p", { class: "small" },
        el("a", { href: res.folderUrl, target: "_blank", rel: "noopener" },
          "Open the archive folder in Drive ↗"),
        ` — ${res.urls.length} gzipped page file(s):`));
      const ul = el("ul", { class: "small" });
      for (const u of res.urls) {
        ul.append(el("li", {}, el("a", { href: u.url, target: "_blank", rel: "noopener" }, u.name)));
      }
      rawHost.append(ul);
    } catch (e) {
      clear(rawHost);
      toast(`Raw export failed: ${e.message}`, "error");
    } finally {
      rawBtn.disabled = false;
    }
  }

  async function bundle() {
    bundleBtn.disabled = true;
    clear(bundleHost).append(el("p", { class: "muted small" }, "Assembling the bundle…"));
    try {
      const res = await call("api_exportMigrationBundle", {});
      const c = res.counts;
      clear(bundleHost).append(
        el("p", { class: "small" },
          el("a", { href: res.url, target: "_blank", rel: "noopener" }, `Download ${res.name} ↗`),
          ` — ${Math.round(res.bytes / 1024).toLocaleString()} KB gzipped`),
        el("p", { class: "muted small" },
          `${c.ledger.toLocaleString()} lifecycle(s), ${c.episodes.toLocaleString()} sealed ` +
          `episode(s), ${c.scans.toLocaleString()} scan(s), ` +
          `${c.mttr_history.toLocaleString()} history point(s).`),
      );
    } catch (e) {
      clear(bundleHost);
      toast(`Bundle export failed: ${e.message}`, "error");
    } finally {
      bundleBtn.disabled = false;
    }
  }
}

// ------------------------------------------------------------------------- import

function renderImportSection(main, ctx) {
  const card = el("div", { class: "card" });
  card.append(
    el("h3", {}, "Import from the legacy dashboard"),
    el("p", { class: "muted small" },
      "Merge a migration bundle exported from the Streamlit app's Exports page into " +
      "this ledger. Imported scans arrive sealed — their raw archives stay on the old " +
      "machine — and the merge is one-time: it can't be undone from here."),
    el("p", { class: "muted small" },
      "A large export arrives as several .json files (a manifest plus shards) — select all " +
      "of them together. A sharded import needs a fresh, never-scanned ledger: if this ledger " +
      "already has scans, use Reset ledger first, then import and run a Wiz scan to refill " +
      "open-vulnerability detail."),
  );
  const fileInput = el("input", {
    type: "file", accept: "application/json", multiple: "", style: "display:none",
    "aria-hidden": "true", tabindex: "-1",
  });
  fileInput.addEventListener("change", importFiles);
  const importBtn = el("button", { class: "primary", onclick: () => fileInput.click() },
    "Import migration bundle…");
  const resetBtn = el("button", { class: "danger", onclick: resetLedger }, "Reset ledger…");
  const statusHost = el("div", { style: "margin-top:10px" });
  card.append(
    el("div", { style: "display:flex; gap:8px; flex-wrap:wrap" }, importBtn, resetBtn, fileInput),
    statusHost,
  );
  main.append(card);

  const setStatus = (msg) =>
    clear(statusHost).append(el("p", { class: "muted small" }, msg));

  // The server's fresh-ledger guard (one-shot or sharded) rejects a non-empty ledger. Detect
  // it so the import path can offer an inline reset-and-retry instead of a dead-end error.
  const isNotEmptyError = (e) =>
    /fresh|already has (scans|a compaction)/i.test((e && e.message) || "");

  // Standalone reset: wipe the ledger to a fresh, never-compacted state.
  async function resetLedger() {
    const ok = await confirmDialog({
      title: "Reset the GAS ledger?",
      body: "Permanently clears ALL scans, tracked vulnerabilities, resolved episodes, and " +
        "MTTR history from this GAS ledger. Raw archives on the old machine are unaffected. " +
        "Use this before importing a migration bundle into a ledger that already has data, " +
        "then run a Wiz scan to refill open-vulnerability detail. This can't be undone.",
      confirmLabel: "Reset ledger",
      danger: true,
    });
    if (!ok) return;
    resetBtn.disabled = true;
    setStatus("Resetting ledger…");
    try {
      const out = await call("api_resetLedger");
      toast(`Cleared ${out.scans} scan(s), ${out.vulns} tracked vulnerabilities, ` +
        `${out.episodes} resolved episode(s), ${out.compactions} compaction record(s).`);
      clear(statusHost);
      ctx.refresh();
    } catch (e) {
      clear(statusHost);
      toast(`Reset failed: ${e.message}`, "error");
    } finally {
      resetBtn.disabled = false;
    }
  }

  // Import-result suffix naming rows whose severity didn't normalize to a real value at
  // ingestion (coerceLedger/coerceEpisode now write an explicit "UNKNOWN" instead of the
  // raw literal). Optional-chained: unclassified_severity is an additive field, so a
  // stale pre-rollout server build simply omits the suffix rather than throwing.
  function unclassifiedSuffix(out) {
    const n = out?.unclassified_severity;
    return n ? ` ${n.toLocaleString()} row(s) had an unrecognized severity.` : "";
  }

  // On a fresh-ledger rejection, offer to reset and retry the same (already-parsed) import.
  // Returns true when the caller should retry; false to surface the original error.
  async function offerResetRetry(e) {
    if (!isNotEmptyError(e)) return false;
    const ok = await confirmDialog({
      title: "Reset ledger and import?",
      body: "This ledger isn't empty, so the import can't run. Reset it — permanently clearing " +
        "all scans, tracked vulnerabilities, resolved episodes, and MTTR history in GAS — then " +
        "import? Raw archives on the old machine are unaffected; run a Wiz scan afterward to " +
        "refill open-vulnerability detail.",
      confirmLabel: "Reset & import",
      danger: true,
    });
    if (!ok) return false;
    setStatus("Resetting ledger…");
    await call("api_resetLedger");
    return true;
  }

  async function importFiles() {
    const files = [...(fileInput.files || [])];
    fileInput.value = ""; // re-selecting the same files must re-fire change
    if (!files.length) return;
    // Read each file. The single-bundle guard still applies per file; a shard is ≤25MB.
    const withText = [];
    for (const f of files) {
      if (f.size > MAX_BUNDLE_BYTES) {
        const mb = (n) => (n / (1024 * 1024)).toFixed(1);
        toast(`${f.name} is ${mb(f.size)} MB — over the ${mb(MAX_BUNDLE_BYTES)} MB per-file ` +
          "limit. Use the sharded export — a manifest plus smaller .json shards — for a very " +
          "large ledger.", "error");
        return;
      }
      withText.push({ name: f.name, text: await f.text() });
    }
    const cls = classifyImportFiles(withText);
    if (cls.error) {
      toast(cls.error, "warn");
      return;
    }
    if (cls.mode === "single") return importSingle(cls.text);
    return importSharded(cls);
  }

  async function importSingle(text) {
    const res = parseMigrationBundle(text);
    if (res.error) {
      toast(res.error, "warn");
      return;
    }
    const c = res.counts;
    const ok = await confirmDialog({
      title: "Import migration bundle?",
      body: `${c.scans} scan(s), ${c.vulns} tracked vulnerabilities, ${c.episodes} resolved ` +
        `episode(s), ${c.history} MTTR history point(s). Existing scans will be replayed ` +
        "over the imported history — this can take a minute and can't be undone from the UI.",
      confirmLabel: "Import",
      danger: true,
    });
    if (!ok) return;
    return runSingle(res.bundle);
  }

  async function runSingle(bundle) {
    importBtn.disabled = true;
    setStatus("Importing… replaying existing scans over the bundle.");
    try {
      // Compress the payload before it crosses google.script.run — a raw multi-MB object
      // argument fails opaquely. Fall back to the plain object when gzip isn't available.
      const gzipB64 = await gzipToBase64(JSON.stringify(bundle));
      const out = await call("api_importMigration",
        gzipB64 ? { gzipB64 } : { bundle });
      toast(`Imported ${out.scans_imported} scan(s), ${out.vulns_imported} tracked ` +
        `vulnerabilities, ${out.history_added} history point(s).` + unclassifiedSuffix(out));
      clear(statusHost);
      ctx.refresh();
    } catch (e) {
      clear(statusHost);
      importBtn.disabled = false;
      if (await offerResetRetry(e)) return runSingle(bundle);
      toast(`Import failed: ${e.message}`, "error");
    }
  }

  async function importSharded(cls) {
    const c = cls.counts;
    const n = cls.shards.length;
    const ok = await confirmDialog({
      title: "Import sharded migration bundle?",
      body: `${c.scans} scan(s), ${c.vulns} tracked vulnerabilities, ${c.episodes} resolved ` +
        `episode(s), ${c.history} MTTR history point(s) across ${n} shard(s). GAS rebuilds ` +
        "the history in several steps into a fresh, never-imported ledger — this can't be " +
        "undone from the UI. Re-select the same files to resume if it's interrupted.",
      confirmLabel: "Import",
      danger: true,
    });
    if (!ok) return;
    return runSharded(cls);
  }

  async function runSharded(cls) {
    const n = cls.shards.length;
    importBtn.disabled = true;
    try {
      setStatus("Starting import…");
      const begGz = await gzipToBase64(cls.manifestText);
      const beg = await call("api_importBegin",
        begGz ? { gzipB64: begGz } : { manifest: cls.manifest });
      let applied = beg.appliedShards || 0;
      for (const s of cls.shards) {
        if (s.index < applied) continue; // already applied (resume)
        setStatus(`Applying shard ${s.index + 1} of ${n}…`);
        const gz = await gzipToBase64(s.text);
        const prog = await call("api_importShard",
          gz ? { sessionId: beg.sessionId, index: s.index, gzipB64: gz }
             : { sessionId: beg.sessionId, index: s.index, shard: JSON.parse(s.text) });
        applied = prog.appliedShards;
      }
      setStatus("Finalizing…");
      const out = await call("api_importFinalize", { sessionId: beg.sessionId });
      toast(`Imported ${out.scans_imported} scan(s), ${out.vulns_imported} tracked ` +
        `vulnerabilities, ${out.history_added} history point(s).` + unclassifiedSuffix(out));
      clear(statusHost);
      ctx.refresh();
    } catch (e) {
      importBtn.disabled = false;
      // A fresh-ledger rejection happens at begin, before any shard is applied — reset and retry.
      if (await offerResetRetry(e)) return runSharded(cls);
      setStatus("Import interrupted — re-select the same files to resume where it stopped.");
      toast(`Import failed: ${e.message}`, "error");
    }
  }
}

// -------------------------------------------------------------------- maintenance

// Days presets for the two age-based cleanups. Plain numbers rather than a free text field:
// every one of these is destructive, and "90" mistyped as "9" is a very different action.
const AGE_CHOICES = [
  [90, "90 days"],
  [180, "180 days"],
  [365, "1 year"],
  [730, "2 years"],
];

/** A severity pill row — the settings-page control, minus the coupling it doesn't need. */
function severityPills(options, selected, { onChange, ariaLabel } = {}) {
  const node = el("div", { class: "pill-row", role: "group", "aria-label": ariaLabel });
  for (const sev of options) {
    const btn = el("button", {
      class: `sev-pill sev-${sev}`, type: "button",
      "aria-pressed": selected.includes(sev) ? "true" : "false",
      onclick: () => {
        const i = selected.indexOf(sev);
        if (i >= 0) selected.splice(i, 1);
        else selected.push(sev);
        btn.setAttribute("aria-pressed", selected.includes(sev) ? "true" : "false");
        if (onChange) onChange();
      },
    }, sev);
    node.append(btn);
  }
  return { node, selected };
}

function daysSelect(id, value, onChange) {
  const sel = el("select", { id, "aria-label": "Age threshold" },
    ...AGE_CHOICES.map(([v, label]) =>
      el("option", { value: String(v), selected: v === value ? true : null }, label)));
  if (onChange) sel.addEventListener("change", onChange);
  return sel;
}

/** `{CRITICAL: 12, HIGH: 3}` → "12 CRITICAL · 3 HIGH", in severity order. */
function bySeverityLine(order, counts) {
  const parts = order
    .filter((s) => counts && counts[s])
    .map((s) => `${counts[s].toLocaleString()} ${s}`);
  return parts.join(" · ");
}

/**
 * The three manual cleanups. Each follows the same shape as Settings → Compact now: a
 * dry-run preview whose numbers are computed by the very functions that will commit, then a
 * danger confirm, then apply. Nothing here offers a button before it can say what the button
 * would remove.
 */
function renderMaintenanceSection(main, boot, ctx) {
  const order = (boot.palette && boot.palette.order) || [];
  const selectable = (boot.palette && boot.palette.selectable) || [];

  // Preview state, shared by all three panels: one RPC reads the ledger once and answers for
  // all of them (the state load is the expensive part, not the three predicates).
  let preview = null;
  const purgeSel = [];
  const episodeSel = [];
  let episodeDays = 365;
  let historyDays = 365;

  // ---- purge findings by severity
  const purgeCounts = el("p", { class: "muted small" }, "Pick one or more severities.");
  const purgeBtn = el("button", { class: "danger", disabled: true, onclick: onPurge },
    "Purge findings…");
  const purgeProgress = el("div", { class: "maint-progress" });
  const purgePills = severityPills(order, purgeSel, {
    ariaLabel: "Severities to purge", onChange: () => refreshPreview(),
  });

  main.append(settingsPanel({
    title: "Purge findings by severity",
    description:
      "Removes every trace of the chosen severities — open and resolved lifecycles, the " +
      "sealed episode records, the compaction baseline, and the saved scan archives in " +
      "Drive. Rewriting the archives is what makes it stick: without it, deleting a scan " +
      "replays the findings straight back. The archive pass runs in the background and " +
      "blocks scanning while it does.",
    body: [purgePills.node, purgeCounts, purgeProgress],
    footer: purgeBtn,
  }));

  // ---- prune resolved episodes
  const episodeCounts = el("p", { class: "muted small" }, "Loading…");
  const episodeBtn = el("button", { class: "danger", disabled: true, onclick: onPrune },
    "Prune episodes…");
  const episodePills = severityPills(selectable, episodeSel, {
    ariaLabel: "Limit the prune to these severities", onChange: () => refreshPreview(),
  });

  main.append(settingsPanel({
    title: "Prune resolved episodes",
    description:
      "Drops sealed lifecycles that were closed long enough ago to stop being interesting. " +
      "Compaction moves closed findings into episode rows but never removes them, so this " +
      "is the only thing that shortens that tab. Unlike compaction, it CHANGES THE PAST: " +
      "episodes feed MTTR and remediation coverage, so historical figures will move.",
    body: [
      settingRow({
        label: "Resolved more than",
        description: "Only episodes closed before this are pruned.",
        control: daysSelect("maint-ep-days", episodeDays, (e) => {
          episodeDays = Number(e.target.value);
          refreshPreview();
        }),
        htmlFor: "maint-ep-days",
      }),
      el("div", { class: "scope-block" },
        el("span", { class: "label" }, "Limit to severities"),
        el("p", { class: "muted small scope-block__note" },
          "Leave all unselected to prune every severity."),
        episodePills.node),
      episodeCounts,
    ],
    footer: episodeBtn,
  }));

  // ---- trim trend history
  const historyCounts = el("p", { class: "muted small" }, "Loading…");
  const historyBtn = el("button", { class: "danger", disabled: true, onclick: onTrim },
    "Trim history…");

  main.append(settingsPanel({
    title: "Trim trend history",
    description:
      "Drops daily KPI snapshots older than the window. The only cleanup here with no " +
      "knock-on: the snapshots are written once per scan and never replayed, so trimming " +
      "them shortens the history-based series and changes nothing else.",
    body: [
      settingRow({
        label: "Keep the last",
        description: "Snapshots older than this are dropped.",
        control: daysSelect("maint-hist-days", historyDays, (e) => {
          historyDays = Number(e.target.value);
          refreshPreview();
        }),
        htmlFor: "maint-hist-days",
      }),
      historyCounts,
    ],
    footer: historyBtn,
  }));

  // ---- preview plumbing
  let previewSeq = 0;
  async function refreshPreview() {
    const seq = ++previewSeq;
    try {
      const res = await call("api_previewMaintenance", {
        severities: [...purgeSel],
        episodeDays,
        episodeSeverities: [...episodeSel],
        historyDays,
      });
      if (seq !== previewSeq) return; // a newer request already answered
      preview = res;
      paintPreview();
    } catch (e) {
      if (seq !== previewSeq) return;
      preview = null;
      purgeCounts.textContent = `Preview unavailable: ${e.message}`;
      episodeCounts.textContent = `Preview unavailable: ${e.message}`;
      historyCounts.textContent = `Preview unavailable: ${e.message}`;
      purgeBtn.disabled = true;
      episodeBtn.disabled = true;
      historyBtn.disabled = true;
    }
  }

  function paintPreview() {
    if (!preview) return;

    const p = preview.purge;
    const total = p.ledgerRows + p.episodeRows;
    if (!purgeSel.length) {
      purgeCounts.textContent = "Pick one or more severities.";
      purgeBtn.disabled = true;
      purgeBtn.textContent = "Purge findings…";
    } else if (!total) {
      purgeCounts.textContent = "Nothing to purge at those severities.";
      purgeBtn.disabled = true;
      purgeBtn.textContent = "Purge findings…";
    } else {
      const detail = bySeverityLine(order, p.bySeverity);
      purgeCounts.textContent =
        `${total.toLocaleString()} lifecycle(s) — ${detail}. ` +
        `${p.scansToRewrite} scan archive(s) will be rewritten` +
        (p.sealedScans ? `; ${p.sealedScans} sealed scan(s) have none left to rewrite.` : ".");
      purgeBtn.disabled = false;
      purgeBtn.textContent = `Purge ${total.toLocaleString()} finding(s)…`;
    }

    const ep = preview.episodes;
    episodeCounts.textContent = ep.rows
      ? `${ep.rows.toLocaleString()} episode(s) — ${bySeverityLine(order, ep.bySeverity)}. ` +
        `Oldest ${ep.oldest ? ep.oldest.slice(0, 10) : "—"}, newest ` +
        `${ep.newest ? ep.newest.slice(0, 10) : "—"}. ${ep.remaining.toLocaleString()} would remain.`
      : "No episodes are old enough to prune.";
    episodeBtn.disabled = !ep.rows;
    episodeBtn.textContent = ep.rows ? `Prune ${ep.rows.toLocaleString()} episode(s)…` : "Prune episodes…";

    const h = preview.history;
    historyCounts.textContent = h.rows
      ? `${h.rows.toLocaleString()} snapshot(s) before ${h.oldest ? h.oldest : "—"}… ` +
        `${h.remaining.toLocaleString()} would remain.`
      : "No snapshots are old enough to trim.";
    historyBtn.disabled = !h.rows;
    historyBtn.textContent = h.rows ? `Trim ${h.rows.toLocaleString()} snapshot(s)…` : "Trim history…";
  }

  // ---- purge: confirm + start + progress
  async function onPurge() {
    const p = preview && preview.purge;
    if (!p) return;
    const total = p.ledgerRows + p.episodeRows;
    // Only selectable severities can be dropped from the scan scope — UNKNOWN is a local
    // normalization bucket the settings layer refuses, so offering the toggle for an
    // UNKNOWN-only purge would promise something the server can't do.
    const narrowable = purgeSel.filter((s) => selectable.includes(s));
    const scopeToggle = switchToggle({
      checked: narrowable.length > 0,
      id: "purge-narrow-scope",
      ariaLabel: "Also stop scanning for these severities",
      disabled: !narrowable.length,
    });

    const ok = await confirmDialog({
      title: `Purge ${total.toLocaleString()} finding(s)?`,
      body: el("div", {},
        el("p", {}, `${p.ledgerRows.toLocaleString()} tracked lifecycle(s) and ` +
          `${p.episodeRows.toLocaleString()} resolved episode(s) will be deleted — ` +
          `${bySeverityLine(order, p.bySeverity)}.`),
        el("p", {}, `${p.scansToRewrite} saved scan archive(s) in Drive are rewritten so a ` +
          `later scan deletion can't replay these findings back. That runs in the background ` +
          `and blocks scanning until it finishes.` +
          (p.sealedScans
            ? ` ${p.sealedScans} sealed scan(s) have no archive left to rewrite.`
            : "")),
        el("div", { style: "margin:10px 0" },
          settingRow({
            label: "Also stop scanning for these severities",
            description: narrowable.length
              ? `Drops ${narrowable.join(", ")} from the scan scope, so the next scan doesn't ` +
                `re-ingest what you just deleted.`
              : "Not available — the scan scope can't be narrowed to these.",
            control: scopeToggle.node,
            htmlFor: "purge-narrow-scope",
          })),
        el("p", { class: "small muted" },
          "MTTR history snapshots carry no severity breakdown, so past daily figures keep " +
          "counting these findings and will disagree with the recomputed trend. A migration " +
          "bundle exported before now would restore everything if re-imported. This can't " +
          "be undone."),
      ),
      confirmLabel: "Purge",
      danger: true,
    });
    if (!ok) return;

    purgeBtn.disabled = true;
    try {
      const res = await call("api_startSeverityPurge", {
        severities: [...purgeSel],
        alsoNarrowScope: scopeToggle.input.checked,
      });
      paintPurgeStatus(res);
      toast("Purge started — rewriting scan archives in the background.");
    } catch (e) {
      purgeBtn.disabled = false;
      toast(`Purge failed to start: ${e.message}`, "error");
    }
  }

  function paintPurgeStatus(status) {
    const view = purgeStatusView(status);
    clear(purgeProgress);
    if (!status) return;
    if (view.pct !== null || view.busy) purgeProgress.append(progressBar(view.pct));
    purgeProgress.append(
      el("p", { class: view.warn ? "small field-error" : "muted small", role: "status" }, view.text));
    purgeBtn.disabled = view.busy;
    if (view.poll) {
      setTimeout(loadPurgeStatus, 4000);
    } else if (status.phase !== "PURGING" && status.phase !== "PERSISTING") {
      // Terminal: the ledger changed under every other panel on the page.
      refreshPreview();
    }
  }

  async function loadPurgeStatus() {
    try {
      const res = await call("api_getPurgeStatus", {});
      paintPurgeStatus(res.purge);
    } catch {
      // A status blip must not kill the poll loop or blank the card.
      setTimeout(loadPurgeStatus, 8000);
    }
  }

  async function onPrune() {
    const ep = preview && preview.episodes;
    if (!ep || !ep.rows) return;
    const ok = await confirmDialog({
      title: `Prune ${ep.rows.toLocaleString()} resolved episode(s)?`,
      body: el("div", {},
        el("p", {}, `Sealed lifecycles resolved before ` +
          `${ep.newest ? ep.newest.slice(0, 10) : "the cutoff"} will be deleted — ` +
          `${bySeverityLine(order, ep.bySeverity)}. ${ep.remaining.toLocaleString()} remain.`),
        el("p", {}, "This rewrites history. Episodes are part of the remediation record, so " +
          "MTTR, the trend, and remediation coverage will show different past numbers " +
          "afterwards — that is the difference between this and compaction, which is gated " +
          "on leaving those figures identical."),
        el("p", { class: "small muted" },
          "A pruned lifecycle that reappears in a later scan counts as new rather than " +
          "reopened. This can't be undone."),
      ),
      confirmLabel: "Prune",
      danger: true,
    });
    if (!ok) return;
    episodeBtn.disabled = true;
    try {
      const res = await call("api_pruneEpisodes", {
        days: episodeDays, severities: [...episodeSel],
      });
      toast(`Pruned ${res.removed.toLocaleString()} episode(s); ` +
        `${res.remaining.toLocaleString()} remain.`);
      ctx.refresh();
    } catch (e) {
      episodeBtn.disabled = false;
      toast(`Prune failed: ${e.message}`, "error");
    }
  }

  async function onTrim() {
    const h = preview && preview.history;
    if (!h || !h.rows) return;
    const ok = await confirmDialog({
      title: `Trim ${h.rows.toLocaleString()} history snapshot(s)?`,
      body: `Daily KPI snapshots older than ${historyDays} days will be deleted, leaving ` +
        `${h.remaining.toLocaleString()}. The history-based change chips stop reaching past ` +
        `the cutoff; the reconstructed MTTR trend is unaffected. This can't be undone.`,
      confirmLabel: "Trim",
      danger: true,
    });
    if (!ok) return;
    historyBtn.disabled = true;
    try {
      const res = await call("api_trimHistory", { days: historyDays });
      toast(`Trimmed ${res.removed.toLocaleString()} snapshot(s); ` +
        `${res.remaining.toLocaleString()} remain.`);
      ctx.refresh();
    } catch (e) {
      historyBtn.disabled = false;
      toast(`Trim failed: ${e.message}`, "error");
    }
  }

  // First paint, and re-adopt a purge already running (a reload mid-walk must not lose it).
  refreshPreview();
  loadPurgeStatus();
}
