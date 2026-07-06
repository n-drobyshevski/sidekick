// Reports — ad-hoc security summary across loaded sources (Markdown / CSV / JSON).

import { call } from "../api.js";
import { bootstrap } from "../store.js";
import { clear, downloadText, el, emptyState, fmtDays, toast } from "../ui.js";

export async function renderReports(main) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "Reports"),
    el("p", { class: "page-sub" }, "A defensible summary of the current risk picture, ready to hand off."),
  );

  if (!boot.latestScan) {
    main.append(emptyState("No scan saved yet — run a scan first."));
    return;
  }

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
