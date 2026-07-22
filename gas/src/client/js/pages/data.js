// Data — the report generator, raw exports, and the one-time legacy migration
// import, merged from the former Reports and Exports pages.

import { call } from "../api.js";
import {
  MAX_BUNDLE_BYTES,
  classifyImportFiles,
  gzipToBase64,
  parseMigrationBundle,
} from "../migrationImport.js";
import { bootstrap } from "../store.js";
import {
  clear,
  confirmDialog,
  downloadText,
  el,
  emptyState,
  fmtDateTime,
  fmtDays,
  scopeBar,
  sectionLabel,
  toast,
} from "../ui.js";

// A one-line description of the global scope a report/export is generated under, so a
// downloaded audit artifact says what population it covers instead of leaving it to guess.
function scopeLine(domain, supportGroup) {
  const parts = [];
  if (domain) parts.push(`Value chain: ${domain}`);
  if (supportGroup) parts.push(`Support group: ${supportGroup}`);
  return parts.length ? `Scoped to ${parts.join(" · ")}.` : "All value chains and support groups.";
}

export async function renderData(main, params, ctx) {
  const boot = await bootstrap();
  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";
  main.append(
    el("h1", {}, "Data"),
    el("p", { class: "page-sub" }, "Reports out, raw data out, legacy history in."),
  );
  const scopeChips = scopeBar({ domain, supportGroup, onClear: ctx.clearScope });
  if (scopeChips) main.append(scopeChips);

  main.append(sectionLabel("Report"));
  if (boot.latestScan) {
    // Synchronous mount + lazy preview: the report preview must never block (or, on error,
    // blank) the Export and Import sections below, which don't even need a scan.
    renderReportSection(main, boot, domain, supportGroup);
  } else {
    main.append(el("p", { class: "muted small" },
      "No scan saved yet — run a scan to generate a report."));
  }

  main.append(sectionLabel("Export"));
  if (boot.latestScan) {
    renderExportSection(main, boot, domain, supportGroup);
  } else {
    main.append(el("p", { class: "muted small" },
      "No scan saved yet — run a scan to export findings."));
  }

  main.append(sectionLabel("Import"));
  renderImportSection(main, ctx);
}

// ------------------------------------------------------------------------- report

function renderReportSection(main, boot, domain, supportGroup) {
  // Scope the report to the global Value Chain + Support group filters ("" = no filter).
  const domains = domain ? [domain] : [];
  const supportGroups = supportGroup ? [supportGroup] : [];
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
    el("p", { class: "muted small", style: "margin:-2px 0 8px" }, scopeLine(domain, supportGroup)),
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
      const preview = await call("api_getReport", { format: "json", domains, supportGroups });
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
      const res = await call("api_getReport", { format, domains, supportGroups });
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

function renderExportSection(main, boot, domain, supportGroup) {
  // Honor the same global filters as the Report block so the two never export different
  // populations of the same ledger, and say which scope was applied.
  const domains = domain ? [domain] : [];
  const supportGroups = supportGroup ? [supportGroup] : [];
  const card = el("div", { class: "card" });
  card.append(
    el("h3", {}, "OS vulnerabilities"),
    el("p", { class: "muted small" },
      `Scan ${fmtDateTime(boot.latestScan.ts)} — ` +
      `${boot.latestScan.total.toLocaleString()} finding(s), ${boot.latestScan.mode}.`),
    el("p", { class: "muted small", style: "margin-top:-4px" }, scopeLine(domain, supportGroup)),
  );
  const row = el("div", { style: "display:flex; gap:8px; flex-wrap:wrap" });
  const csvBtn = el("button", { onclick: csv }, "Download CSV");
  const rawBtn = el("button", { onclick: raw }, "Raw JSON (Drive)");
  row.append(csvBtn, rawBtn);
  const rawHost = el("div", { style: "margin-top:10px" });
  card.append(row, rawHost);
  main.append(card);

  async function csv() {
    csvBtn.disabled = true;
    try {
      const res = await call("api_getExportCsv", { source: "findings", domains, supportGroups });
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
