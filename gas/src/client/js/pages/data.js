// Data — the report generator, raw exports, and the one-time legacy migration
// import, merged from the former Reports and Exports pages.

import { call } from "../api.js";
import { MAX_BUNDLE_BYTES, gzipToBase64, parseMigrationBundle } from "../migrationImport.js";
import { bootstrap } from "../store.js";
import {
  clear,
  confirmDialog,
  downloadText,
  el,
  fmtDays,
  sectionLabel,
  toast,
} from "../ui.js";

export async function renderData(main, params, ctx) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "Data"),
    el("p", { class: "page-sub" }, "Reports out, raw data out, legacy history in."),
  );

  main.append(sectionLabel("Report"));
  if (boot.latestScan) {
    await renderReportSection(main, boot);
  } else {
    main.append(el("p", { class: "muted small" },
      "No scan saved yet — run a scan to generate a report."));
  }

  main.append(sectionLabel("Export"));
  if (boot.latestScan) {
    renderExportSection(main, boot);
  } else {
    main.append(el("p", { class: "muted small" },
      "No scan saved yet — run a scan to export findings."));
  }

  main.append(sectionLabel("Import"));
  renderImportSection(main, ctx);
}

// ------------------------------------------------------------------------- report

async function renderReportSection(main, boot) {
  let format = "markdown";
  const controls = el("div", { class: "filter-bar", role: "radiogroup", "aria-label": "Report format" });
  for (const [value, label] of [["markdown", "Markdown"], ["csv", "CSV"], ["json", "JSON"]]) {
    const btn = el("button", {
      "aria-pressed": format === value ? "true" : "false",
      onclick: () => {
        format = value;
        controls.querySelectorAll("button[aria-pressed]").forEach((b) =>
          b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      },
    }, label);
    controls.append(btn);
  }
  const generateBtn = el("button", { class: "primary", onclick: generate }, "Generate & download");
  controls.append(generateBtn);

  const previewHost = el("div", {});
  main.append(controls, previewHost);

  // Severity matrix preview
  const preview = await call("api_getReport", { format: "json" });
  renderMatrix(preview.matrix);

  function renderMatrix(matrix) {
    clear(previewHost);
    if (!matrix.length) return;
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
      const res = await call("api_getReport", { format });
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

function renderExportSection(main, boot) {
  const card = el("div", { class: "card" });
  card.append(
    el("h3", {}, "OS vulnerabilities"),
    el("p", { class: "muted small" },
      `Scan ${boot.latestScan.ts.slice(0, 16).replace("T", " ")} UTC — ` +
      `${boot.latestScan.total.toLocaleString()} finding(s), ${boot.latestScan.mode}.`),
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
      const res = await call("api_getExportCsv", { source: "findings" });
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
  );
  const fileInput = el("input", {
    type: "file", accept: "application/json", style: "display:none",
    "aria-hidden": "true", tabindex: "-1",
  });
  fileInput.addEventListener("change", importBundle);
  const importBtn = el("button", { class: "primary", onclick: () => fileInput.click() },
    "Import migration bundle…");
  const statusHost = el("div", { style: "margin-top:10px" });
  card.append(el("div", { style: "display:flex; gap:8px" }, importBtn, fileInput), statusHost);
  main.append(card);

  async function importBundle() {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ""; // re-selecting the same file must re-fire change
    if (!file) return;
    if (file.size > MAX_BUNDLE_BYTES) {
      const mb = (n) => (n / (1024 * 1024)).toFixed(1);
      toast(`The bundle is ${mb(file.size)} MB — over the ${mb(MAX_BUNDLE_BYTES)} MB ` +
        "single-request limit. Compact the old ledger to shrink it, then re-export.",
        "error");
      return;
    }
    const res = parseMigrationBundle(await file.text());
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
    importBtn.disabled = true;
    clear(statusHost).append(el("p", { class: "muted small" },
      "Importing… replaying existing scans over the bundle."));
    try {
      // Compress the payload before it crosses google.script.run — a raw multi-MB object
      // argument fails opaquely. Fall back to the plain object when gzip isn't available.
      const gzipB64 = await gzipToBase64(JSON.stringify(res.bundle));
      const out = await call("api_importMigration",
        gzipB64 ? { gzipB64 } : { bundle: res.bundle });
      toast(`Imported ${out.scans_imported} scan(s), ${out.vulns_imported} tracked ` +
        `vulnerabilities, ${out.history_added} history point(s).`);
      ctx.refresh();
    } catch (e) {
      clear(statusHost);
      importBtn.disabled = false;
      toast(`Import failed: ${e.message}`, "error");
    }
  }
}
