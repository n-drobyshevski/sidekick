// Scan History — the durable ledger: saved scans (multi-select delete with sealed
// protection) and trend charts.

import { call } from "../api.js";
import { openResolvedLines, trendLine } from "../charts.js";
import { swrCall } from "../store.js";
import {
  clear, confirmDialog, el, emptyState, fmtDays, fmtDateTime,
  kpiCard, sectionLabel, toast,
} from "../ui.js";

export async function renderHistory(main, _params, ctx) {
  // One batched RPC serves the whole page (scans + KPIs + trends); server-side the
  // parts share a single ledger-state load. Revisits paint instantly from the session
  // cache and repaint only if revalidated data differs.
  const pagePromise = swrCall(
    "api_getHistoryPage",
    {},
    (fresh) => {
      paintKpis(fresh.history.kpis);
      paintScans(fresh.history.scans);
      paintTrends(fresh.trends);
    },
  );

  main.append(
    el("h1", {}, "Scan History"),
    el("p", { class: "page-sub" },
      "Every saved scan retained in the durable ledger, with remediation trends."),
  );

  const kpiRow = el("div", { class: "kpi-row" });
  const scansHost = el("div", {});
  const chartsHost = el("div", { class: "chart-grid", style: "margin-top:20px" });
  main.append(kpiRow, sectionLabel("Saved scans"), scansHost, chartsHost);

  const pageData = await pagePromise;
  const data = pageData.history;
  paintKpis(data.kpis);
  paintScans(data.scans);

  function paintKpis(kpis) {
    clear(kpiRow).append(
      kpiCard("Tracked (all-time)", kpis.tracked.toLocaleString()),
      kpiCard("Currently open", kpis.open.toLocaleString()),
      kpiCard("Resolved all-time", kpis.resolvedAllTime.toLocaleString()),
      kpiCard("Median MTTR", fmtDays(kpis.medianMttr)),
    );
  }

  // ---- saved scans table with delete flow
  function paintScans(scans) {
    if (scans.length) renderScans(scans);
    else clear(scansHost).append(emptyState("No scans saved yet."));
  }

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
  paintTrends(pageData.trends);

  function paintTrends(trends) {
    clear(chartsHost);
    if (!trends.trend.length) return;
    const openResolvedCanvas = el("canvas", { id: "hist-open-resolved" });
    const mttrCanvas = el("canvas", { id: "hist-mttr" });

    chartsHost.append(
      el("div", { class: "chart-card" }, el("h3", {}, "Open vs resolved"),
        el("div", { class: "chart-box" }, openResolvedCanvas)),
      el("div", { class: "chart-card" }, el("h3", {}, "MTTR trend"),
        el("div", { class: "chart-box" }, mttrCanvas)),
    );
    requestAnimationFrame(() => {
      openResolvedLines(openResolvedCanvas, trends.trend);
      trendLine(mttrCanvas,
        trends.trend.filter((t) => t.median_days !== null)
          .map((t) => ({ x: t.date, y: t.median_days })), { yLabel: "days" });
    });
  }
}
