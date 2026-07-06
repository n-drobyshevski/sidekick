// Exports — raw per-source downloads: display-filtered CSV and the verbatim raw
// JSON archive (served as Drive links; page archives are too big for the RPC).

import { call } from "../api.js";
import { bootstrap } from "../store.js";
import { clear, downloadText, el, emptyState, toast } from "../ui.js";

export async function renderExports(main) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "Exports"),
    el("p", { class: "page-sub" }, "Raw data out, for spreadsheets and other tools."),
  );

  if (!boot.latestScan) {
    main.append(emptyState("No scan saved yet — run a scan first."));
    return;
  }

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
