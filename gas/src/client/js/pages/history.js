// Scan History — the durable ledger: saved scans (multi-select delete with sealed
// protection), the vulnerability base with filters + CSV, and trend charts.

import { call } from "../api.js";
import { openResolvedLines, trendLine } from "../charts.js";
import { bootstrap } from "../store.js";
import {
  clear, confirmDialog, downloadText, el, emptyState, fmtDays, fmtDate, fmtDateTime,
  kpiCard, pager, sectionLabel, sevBadge, toast,
} from "../ui.js";

export async function renderHistory(main, _params, ctx) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "Scan History"),
    el("p", { class: "page-sub" },
      "Every saved scan and the deduplicated vulnerability base reconciled from them."),
  );

  const kpiRow = el("div", { class: "kpi-row" });
  const scansHost = el("div", {});
  const chartsHost = el("div", { class: "chart-grid", style: "margin-top:20px" });
  const baseHost = el("div", {});
  main.append(kpiRow, sectionLabel("Saved scans"), scansHost, chartsHost,
    sectionLabel("Vulnerability base"), baseHost);

  const data = await call("api_getScanHistory", {});
  if (!data.scans.length) {
    clear(scansHost).append(emptyState("No scans saved yet."));
  }

  kpiRow.append(
    kpiCard("Tracked (all-time)", data.kpis.tracked.toLocaleString()),
    kpiCard("Currently open", data.kpis.open.toLocaleString()),
    kpiCard("Resolved all-time", data.kpis.resolvedAllTime.toLocaleString()),
    kpiCard("Median MTTR", fmtDays(data.kpis.medianMttr)),
  );

  // ---- saved scans table with delete flow
  if (data.scans.length) renderScans(data.scans);

  function renderScans(scans) {
    clear(scansHost);
    const selected = new Set();
    const deleteBtn = el("button", { class: "danger", disabled: true, onclick: onDelete },
      "Delete selected");

    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, ""),
        ...["When", "Mode", "Shape", "Findings", "+New", "−Resolved", "Reopened", "Scope", "Sealed"]
          .map((h) => el("th", { scope: "col" }, h)))),
    );
    const tbody = el("tbody", {});
    for (const s of scans) {
      const cb = el("input", {
        type: "checkbox",
        "aria-label": `Select scan ${s.ts}`,
        disabled: s.sealed ? true : null,
        title: s.sealed ? "Sealed scans are part of the compacted baseline and can't be deleted." : null,
      });
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(s.scan_id);
        else selected.delete(s.scan_id);
        deleteBtn.disabled = !selected.size;
        deleteBtn.textContent = selected.size
          ? `Delete selected (${selected.size})` : "Delete selected";
      });
      tbody.append(el("tr", {},
        el("td", {}, cb),
        el("td", { class: "num" }, fmtDateTime(s.ts)),
        el("td", {}, s.mode),
        el("td", {}, s.shape),
        el("td", { class: "num" }, s.total.toLocaleString()),
        el("td", { class: "num" }, s.new_count ? `+${s.new_count}` : "0"),
        el("td", { class: "num" }, s.resolved_count ? `−${s.resolved_count}` : "0"),
        el("td", { class: "num" }, s.reopened_count || "0"),
        el("td", {}, s.severities ? JSON.parse(s.severities).join(", ") : "all"),
        el("td", {}, s.sealed ? "Sealed" : ""),
      ));
    }
    table.append(tbody);
    scansHost.append(el("div", { class: "table-wrap" }, table),
      el("div", { style: "margin-top:10px" }, deleteBtn));

    async function onDelete() {
      const ids = [...selected];
      const ok = await confirmDialog({
        title: `Delete ${ids.length} scan(s)?`,
        body: el("div", {},
          el("p", {}, "The vulnerability ledger is rebuilt by replaying the surviving scans — " +
            "as if the deleted scans never happened. MTTR and trends are recomputed."),
          el("p", { class: "small muted" }, ids.join(", "))),
        confirmLabel: "Delete and rebuild",
        danger: true,
      });
      if (!ok) return;
      deleteBtn.disabled = true;
      deleteBtn.textContent = "Rebuilding…";
      try {
        const res = await call("api_deleteScans", { scanIds: ids });
        toast(`Deleted ${res.deleted} scan(s); ${res.tracked.toLocaleString()} vulnerabilities tracked.`);
        ctx.refresh();
      } catch (e) {
        toast(e.kind === "sealed" ? e.message : `Delete failed: ${e.message}`, "error");
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete selected";
      }
    }
  }

  // ---- trend charts
  const trends = await call("api_getMttrTrend", {});
  if (trends.trend.length) {
    chartsHost.append(
      el("div", { class: "chart-card" }, el("h3", {}, "Open vs resolved"),
        el("div", { class: "chart-box" }, el("canvas", { id: "hist-open-resolved" }))),
      el("div", { class: "chart-card" }, el("h3", {}, "MTTR trend"),
        el("div", { class: "chart-box" }, el("canvas", { id: "hist-mttr" }))),
    );
    openResolvedLines(document.getElementById("hist-open-resolved"), trends.trend);
    trendLine(document.getElementById("hist-mttr"),
      trends.trend.filter((t) => t.median_days !== null)
        .map((t) => ({ x: t.date, y: t.median_days })), { yLabel: "days" });
  }

  // ---- vulnerability base
  const filters = { statuses: [], severities: [], domains: [], q: "", page: 0 };
  const filterBar = el("div", { class: "filter-bar" });
  const tableHost = el("div", {});
  baseHost.append(filterBar, tableHost);

  filterBar.append(
    select("Status", ["OPEN", "RESOLVED"], (v) => { filters.statuses = v ? [v] : []; reload(); }),
    select("Severity", boot.palette.selectable, (v) => { filters.severities = v ? [v] : []; reload(); }),
  );
  if (boot.domainNames.length > 1) {
    filterBar.append(select("Domain", boot.domainNames,
      (v) => { filters.domains = v ? [v] : []; reload(); }));
  }
  const search = el("input", { type: "search", placeholder: "CVE or asset…",
    "aria-label": "Search the vulnerability base" });
  let deb;
  search.addEventListener("input", () => {
    clearTimeout(deb);
    deb = setTimeout(() => { filters.q = search.value; reload(); }, 300);
  });
  filterBar.append(
    el("div", { class: "field" }, el("label", { class: "field-label" }, "Search"), search),
    el("button", { onclick: exportBaseCsv }, "Download CSV"),
  );

  await loadBase();

  function reload() { filters.page = 0; loadBase(); }

  function select(label, options, onChange) {
    const sel = el("select", { "aria-label": label },
      el("option", { value: "" }, "All"),
      ...options.map((o) => el("option", { value: o }, o)));
    sel.addEventListener("change", () => onChange(sel.value));
    return el("div", { class: "field" }, el("label", { class: "field-label" }, label), sel);
  }

  async function loadBase() {
    clear(tableHost).append(el("p", { class: "muted" }, "Loading base…"));
    const res = await call("api_getBaseRows", { ...filters, pageSize: 100 });
    clear(tableHost);
    if (!res.rows.length) {
      tableHost.append(emptyState("Nothing tracked matches these filters."));
      return;
    }
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        ...["Severity", "CVE", "Asset", "Status", "First seen", "Resolved", "MTTR",
          "Open age", "Reopens", "Source"].map((h) => el("th", { scope: "col" }, h)))),
    );
    const tbody = el("tbody", {});
    for (const r of res.rows) {
      tbody.append(el("tr", {},
        el("td", {}, sevBadge(r.severity)),
        el("td", {}, r.cve
          ? el("a", { href: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(r.cve)}`,
              target: "_blank", rel: "noopener" }, r.cve)
          : "—"),
        el("td", { title: r.asset_name || "" }, r.asset_name || "—"),
        el("td", {}, r.status),
        el("td", { class: "num" }, fmtDate(r.first_seen)),
        el("td", { class: "num" }, fmtDate(r.resolved_at)),
        el("td", { class: "num" }, fmtDays(r.mttr_days)),
        el("td", { class: "num" }, fmtDays(r.age_days)),
        el("td", { class: "num" }, r.reopened_count || "0"),
        el("td", {}, r.resolution_src || ""),
      ));
    }
    table.append(tbody);
    tableHost.append(el("div", { class: "table-wrap" }, table));
    tableHost.append(pager(res.page, res.pageCount, res.total, (p) => {
      filters.page = p;
      loadBase();
    }));
  }

  async function exportBaseCsv() {
    try {
      const res = await call("api_getExportCsv", { source: "base" });
      downloadText(res.filename, res.content, "text/csv;charset=utf-8");
    } catch (e) {
      toast(`Export failed: ${e.message}`, "error");
    }
  }
}
