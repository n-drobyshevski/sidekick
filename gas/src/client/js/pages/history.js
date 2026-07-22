// Scan History — the durable ledger: saved scans (paginated, newest-first, multi-select
// delete with sealed protection) and remediation trend charts. This is the page whose whole
// job is history and recency, so it leans on humanized mode / sample-vs-live labels,
// freshness cues, and colored posture deltas rather than raw enums.

import { call } from "../api.js";
import { openResolvedLines, trendLine } from "../charts.js";
import { bootstrap, swrCall } from "../store.js";
import {
  clear, confirmDialog, el, emptyState, fmtDays, fmtDateTime,
  eolHiddenNote, kpiCard, noFixHiddenNote, pager, sectionLabel, statusPill, toast,
} from "../ui.js";

const PAGE_SIZE = 25;

// A saved scan's raw mode enum -> human labels. "dry-run*" is bundled sample data; the
// "-incremental" variants are a Quick refresh (deltas only).
function isSample(mode) {
  return String(mode || "").startsWith("dry-run");
}
function modeCell(mode) {
  const parts = [isSample(mode) ? statusPill("warn", "Sample") : statusPill("neutral", "Live")];
  if (String(mode || "").includes("incremental")) {
    parts.push(el("span", { class: "domain-chip" }, "Incremental"));
  }
  return el("span", { style: "display:inline-flex; gap:6px; align-items:center; flex-wrap:wrap" },
    ...parts);
}
function shapeLabel(shape) {
  return shape === "flat" ? "Per-finding" : shape === "grouped" ? "Counts only" : String(shape || "—");
}

// A signed posture delta cell: rising risk (new / reopened) reads bad, resolutions read good;
// direction is carried by the sign, not color alone. Zero stays muted.
function deltaCell(n, { good = false, sign = "" } = {}) {
  const v = Number(n || 0);
  if (!v) return el("span", { class: "muted num" }, "0");
  return el("span",
    { class: "num", style: `color:var(--${good ? "ok" : "bad"})` },
    `${sign}${v.toLocaleString()}`);
}

function relativeAge(ts) {
  const ms = Date.now() - Date.parse(ts);
  if (Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? "s" : ""} ago`;
  const d = Math.floor(hr / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

export async function renderHistory(main, _params, ctx) {
  const boot = await bootstrap();

  // Sort/page persist across SWR repaints so a background refresh doesn't reset the view.
  let sortDir = "desc";
  let page = 0;
  let anySample = false;

  // Progressive paint over two parallel RPCs that reuse the same cache entries getHistoryPage
  // batched: api_getScanHistory is the KPI band + saved-scans table (the primary content, and
  // the cheaper slice), api_getMttrTrend is the remediation-trend reconstruction (the heavier
  // per-point KM slice) that fills the charts when it resolves — it no longer blocks the table.
  const historyPromise = swrCall("api_getScanHistory", {}, (fresh) => {
    paintKpis(fresh.kpis, fresh.scans);
    paintScans(fresh.scans);
  });
  const trendPromise = swrCall("api_getMttrTrend", {}, paintTrends);

  main.append(
    el("h1", {}, "Scan History"),
    el("p", { class: "page-sub" },
      "Every saved scan retained in the durable ledger, with remediation trends."),
  );
  if (boot.settings.showNoFix === false) main.append(noFixHiddenNote());
  if (boot.settings.includeEol === false) main.append(eolHiddenNote());

  const freshLine = el("p", { class: "section-note" });
  const kpiRow = el("div", { class: "kpi-row" });
  const scansHost = el("div", {});
  const chartsHost = el("div", { class: "chart-grid", style: "margin-top:20px" });
  main.append(freshLine, kpiRow, sectionLabel("Saved scans"), scansHost, chartsHost);

  const data = await historyPromise;
  paintKpis(data.kpis, data.scans);
  paintScans(data.scans);

  function paintKpis(kpis, scans) {
    // Freshness: the ledger's whole value is recency, so state it plainly.
    const newest = scans && scans.length
      ? scans.reduce((m, s) => (!m || s.ts > m.ts ? s : m), null)
      : null;
    freshLine.textContent = newest
      ? `Last scan ${relativeAge(newest.ts)} — ${fmtDateTime(newest.ts)}.`
      : "";
    freshLine.style.display = newest ? "" : "none";
    clear(kpiRow).append(
      kpiCard("Tracked (all-time)", kpis.tracked.toLocaleString()),
      kpiCard("Currently open", kpis.open.toLocaleString()),
      kpiCard("Resolved all-time", kpis.resolvedAllTime.toLocaleString()),
      kpiCard("Median MTTR", fmtDays(kpis.medianMttr)),
    );
  }

  // ---- saved scans table (paginated, sortable, sticky delete bar) with delete flow
  function paintScans(scans) {
    anySample = scans.some((s) => isSample(s.mode));
    if (scans.length) renderScans(scans);
    else clear(scansHost).append(emptyState(
      "No scans saved yet.",
      "Use “Run scan” in the sidebar to take the first measurement."));
  }

  function renderScans(scans) {
    clear(scansHost);
    const selected = new Set(); // scan_ids, persists across page turns
    const newestId = scans.reduce((m, s) => (!m || s.ts > m.ts ? s : m), null).scan_id;

    const deleteBtn = el("button", { class: "danger", disabled: true, onclick: onDelete },
      "Delete selected");
    const actionBar = el("div", { class: "history-actionbar" }, deleteBtn);
    const tableHost = el("div", {});
    const pagerHost = el("div", {});
    scansHost.append(actionBar, tableHost, pagerHost);

    function syncDeleteBtn() {
      deleteBtn.disabled = !selected.size;
      deleteBtn.textContent = selected.size
        ? `Delete selected (${selected.size})` : "Delete selected";
    }

    function draw() {
      const sorted = [...scans].sort((a, b) =>
        sortDir === "desc" ? (a.ts < b.ts ? 1 : -1) : (a.ts > b.ts ? 1 : -1));
      const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
      if (page >= pageCount) page = 0;
      const slice = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      const selectable = slice.filter((s) => !s.sealed);

      const selectAll = el("input", {
        type: "checkbox",
        "aria-label": "Select all deletable scans on this page",
        disabled: selectable.length ? null : true,
      });
      // indeterminate is a property, not an attribute — set it (and checked) from one source.
      const allSelected = selectable.length && selectable.every((s) => selected.has(s.scan_id));
      selectAll.checked = !!allSelected;
      selectAll.indeterminate = !allSelected && selectable.some((s) => selected.has(s.scan_id));
      selectAll.addEventListener("change", () => {
        for (const s of selectable) {
          if (selectAll.checked) selected.add(s.scan_id);
          else selected.delete(s.scan_id);
        }
        syncDeleteBtn();
        draw();
      });

      const sortBtn = el("button", {
        class: "th-sort", type: "button",
        "aria-label": `Sort by time, currently ${sortDir === "desc" ? "newest first" : "oldest first"}`,
        onclick: () => { sortDir = sortDir === "desc" ? "asc" : "desc"; draw(); },
      }, "When ", el("span", { "aria-hidden": "true" }, sortDir === "desc" ? "▼" : "▲"));

      const table = el("table", { class: "data history-table" },
        el("thead", {}, el("tr", {},
          el("th", { scope: "col" }, selectAll),
          el("th", { scope: "col" }, sortBtn),
          ...["Mode", "Shape", "Findings", "+New", "−Resolved", "Reopened", "Scope", "Status"]
            .map((h) => el("th", { scope: "col" }, h)))),
      );
      const tbody = el("tbody", {});
      for (const s of slice) {
        const cb = el("input", {
          type: "checkbox",
          "aria-label": `Select scan ${fmtDateTime(s.ts)}`,
          checked: selected.has(s.scan_id) ? true : null,
          disabled: s.sealed ? true : null,
        });
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(s.scan_id);
          else selected.delete(s.scan_id);
          syncDeleteBtn();
          // Keep the header select-all box (checked + indeterminate) in step without a redraw.
          const rest = slice.filter((x) => !x.sealed);
          const all = rest.length && rest.every((x) => selected.has(x.scan_id));
          selectAll.checked = !!all;
          selectAll.indeterminate = !all && rest.some((x) => selected.has(x.scan_id));
        });
        const whenCell = el("td", { class: "num" }, fmtDateTime(s.ts));
        if (s.scan_id === newestId) {
          whenCell.append(el("span", { class: "domain-chip", style: "margin-left:8px" }, "Latest"));
        }
        tbody.append(el("tr", {},
          el("td", {}, cb),
          whenCell,
          el("td", {}, modeCell(s.mode)),
          el("td", {}, shapeLabel(s.shape)),
          el("td", { class: "num" }, s.total.toLocaleString()),
          el("td", { class: "num" }, deltaCell(s.new_count, { sign: "+" })),
          el("td", { class: "num" }, deltaCell(s.resolved_count, { good: true, sign: "−" })),
          el("td", { class: "num" }, deltaCell(s.reopened_count, { sign: "+" })),
          el("td", {}, s.severities ? JSON.parse(s.severities).join(", ") : "all"),
          el("td", {}, s.sealed
            ? el("span", { class: "pill neutral",
                "aria-label": "Sealed — part of the compacted baseline; can't be deleted.",
                title: "Sealed scans are part of the compacted baseline and can't be deleted." },
                "Sealed")
            : ""),
        ));
      }
      table.append(tbody);
      clear(tableHost).append(el("div", { class: "table-wrap history-table-wrap" }, table));
      clear(pagerHost).append(pager(page, pageCount, sorted.length, (p) => { page = p; draw(); }));
    }

    draw();

    async function onDelete() {
      const ids = [...selected];
      const chosen = scans.filter((s) => ids.includes(s.scan_id))
        .sort((a, b) => (a.ts < b.ts ? 1 : -1));
      const ok = await confirmDialog({
        title: `Delete ${ids.length} scan(s)?`,
        body: el("div", {},
          el("p", {}, "The vulnerability ledger is rebuilt by replaying the surviving scans — " +
            "as if the deleted scans never happened. MTTR and trends are recomputed."),
          el("ul", { class: "small", style: "margin:8px 0 0; padding-left:18px" },
            ...chosen.map((s) => el("li", {},
              `${fmtDateTime(s.ts)} — ${s.total.toLocaleString()} finding(s)` +
              (isSample(s.mode) ? " · sample" : "")))),
        ),
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

  // ---- trend charts (filled when the trend reconstruction resolves; see trendPromise above).
  // Until then a placeholder stands in — paintTrends clears chartsHost when it runs.
  chartsHost.append(el("p", { class: "muted", style: "grid-column:1/-1" }, "Computing trends…"));
  trendPromise
    .then(paintTrends)
    // eslint-disable-next-line no-console
    .catch((e) => console.error("[history] trends failed:", e));

  function paintTrends(trends) {
    clear(chartsHost);
    if (!trends.trend.length) {
      chartsHost.append(emptyState(
        "Not enough scan history yet to chart trends.",
        "Trends appear once a few scans are saved."));
      return;
    }
    if (anySample) {
      chartsHost.append(el("p", { class: "section-note", style: "grid-column:1/-1" },
        "Includes sample (dry-run) data — these trends aren't all from live scans."));
    }
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
