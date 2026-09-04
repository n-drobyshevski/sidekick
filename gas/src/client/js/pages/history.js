// Scan History — the durable ledger: saved scans (paginated, newest-first, multi-select
// delete with sealed protection) and remediation trend charts. This is the page whose whole
// job is history and recency, so it leans on humanized mode / sample-vs-live labels,
// freshness cues, and colored posture deltas rather than raw enums.

import { call } from "../../../../../gas_shared/api.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import {
  absent, clear, confirmDialog, el, emptyState, fmtDateTime, fmtSpan, heroStat, kpiCard, num,
  pageHeader, sectionLabel, statusPill, tableFooter, tipAnchor, toast,
} from "../ui.js";

// The rows-per-page the table OPENS on. It is no longer the only size available: the footer
// below carries a rows-per-page select, so this is a starting point rather than a ceiling.
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
// The em dash for an unrecorded shape is the shared muted one, not a black one typed in
// place: a scan whose shape the ledger never stored is not a scan whose shape is "—", and a
// dash in the same ink as "Per-finding" says otherwise. Returning a Node is safe because the
// only call site is the Shape cell below, which takes an el() child.
function shapeLabel(shape) {
  if (shape === "flat") return "Per-finding";
  if (shape === "grouped") return "Counts only";
  return shape ? String(shape) : absent();
}

// A signed posture delta cell: rising risk (new / reopened) reads bad, resolutions read good;
// direction is carried by the sign, not color alone. Zero stays muted.
function deltaCell(n, { good = false, sign = "" } = {}) {
  // `num(n, 0)` rather than `Number(n || 0)`: the cast is where "absent is never zero" stops
  // being obvious, so the fallback is stated instead of inherited. Zero IS the intent here —
  // ScanRow's new / resolved / reopened counts are required numbers written when the scan is
  // saved (src/domain/ledgerCore.ts), so the only way one arrives missing is a payload that
  // predates the column, and "nothing moved" is the honest reading of that.
  const v = num(n, 0);
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

  // Sort, page and page size persist across SWR repaints so a background refresh doesn't
  // reset the view.
  let sortDir = "desc";
  let page = 0;
  let pageSize = PAGE_SIZE;
  let anySample = false;

  // Severity scope for the trend charts: the app-wide display setting, so the two trends
  // here read the same severities the rest of the app does. It scopes only the charts; the
  // KPI band and saved-scans table stay the raw ledger, which is all-severity by design.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];
  // Null when every selectable severity is chosen (no filter → shares the default cache
  // entry); otherwise the chosen subset, which the server keeps alongside UNKNOWN.
  const scopeParam = () =>
    sevScope.length === boot.palette.selectable.length ? null : [...sevScope];

  // KPI band + saved-scans table (the primary content, and the cheaper slice). Unscoped by
  // severity: the table is the raw scan ledger and its KPIs are all-severity by design.
  const historyPromise = swrCall("api_getScanHistory", {}, (fresh) => {
    paintKpis(fresh.kpis, fresh.scans);
    paintScans(fresh.scans);
  });

  main.append(pageHeader({
    hero: heroStat(
      "Data",
      "Scan History",
      "Every saved scan retained in the durable ledger, with remediation trends.",
    ),
  }));

  const freshLine = el("p", { class: "section-note" });
  const kpiRow = el("div", { class: "kpi-row" });
  const scansHost = el("div", {});
  const chartsHost = el("div", { class: "chart-grid", style: "margin-top:20px" });
  main.append(
    freshLine, kpiRow, sectionLabel("Saved scans"), scansHost,
    sectionLabel("Remediation trends"),
    el("p", { class: "section-note" },
      "Open vs resolved and the Kaplan–Meier MTTR median, scoped to the display "
      + "severities set in Settings."),
    chartsHost,
  );

  // Trend charts: the remediation-trend reconstruction (the heavier per-point KM slice) that
  // fills the charts when it resolves — it never blocks the table. Both charts read
  // api_getMttrTrend scoped to the display severities. A placeholder stands in until the
  // first reconstruction resolves.
  chartsHost.append(el("p", { class: "muted", style: "grid-column:1/-1" }, "Computing trends…"));
  function loadTrends() {
    swrCall("api_getMttrTrend", { severities: scopeParam() }, paintTrends)
      .then(paintTrends)
      .catch((e) => console.error("[history] trends failed:", e));
  }
  loadTrends();

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
      kpiCard("Median MTTR", fmtSpan(kpis.medianMttr)),
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
    const footerHost = el("div", {});
    scansHost.append(actionBar, tableHost, footerHost);

    function syncDeleteBtn() {
      deleteBtn.disabled = !selected.size;
      deleteBtn.textContent = selected.size
        ? `Delete selected (${selected.size})` : "Delete selected";
    }

    function draw() {
      const sorted = [...scans].sort((a, b) =>
        sortDir === "desc" ? (a.ts < b.ts ? 1 : -1) : (a.ts > b.ts ? 1 : -1));
      const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
      if (page >= pageCount) page = 0;
      const slice = sorted.slice(page * pageSize, page * pageSize + pageSize);
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

      // STILL HAND-BUILT, and the reason is the `history-table` class on the <table> itself.
      // This is the one sticky table heading in the app that actually works: pages.css pins
      // it with `.history-table th { position: sticky; top: 53px }` and takes the wrap out of
      // its own scroll context above 801px, which is why the declaration the base sheet
      // dropped survives here. `dataTable` can only class the `.table-wrap` it returns — it
      // hardcodes `class: "data"` on the table — and its own `stickyHeader` is a different
      // treatment (gated at 1100px, offset by `--sticky-inset`). Converting would therefore
      // un-pin a heading that works, silently, for a component that cannot express it.
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
          // The sentence used to ride on a `title` attribute, which el() now throws on: a
          // native tooltip cannot be reached by keyboard and does not exist on touch, so the
          // one explanation of why a row's checkbox is disabled was unreadable for anyone not
          // hovering a mouse. tipAnchor puts it in the app's own hover card; the pill is not a
          // control, so it takes the anchor form rather than becoming a second tab stop inside
          // a row that already has one.
          el("td", {}, s.sealed
            ? tipAnchor(
              el("span", { class: "pill neutral",
                "aria-label": "Sealed — part of the compacted baseline; can't be deleted." },
                "Sealed"),
              () => ["Sealed scans are part of the compacted baseline and can't be deleted."])
            : ""),
        ));
      }
      table.append(tbody);
      clear(tableHost).append(el("div", { class: "table-wrap history-table-wrap" }, table));
      // `tableFooter`, not the bare `pager` this used to call, and it fixes two things. The
      // pager alone printed the row count unpluralised, so a ledger holding one scan read
      // "1 rows"; and there was no way to see more than 25 scans at a time on a page whose
      // whole subject is history. The footer also recomputes the page from the row that was
      // at the top, so changing the size does not teleport the reader somewhere else.
      clear(footerHost).append(tableFooter({
        page,
        pageCount,
        total: sorted.length,
        pageSize,
        onPage: (p) => { page = p; draw(); },
        onPageSize: (size, nextPage) => { pageSize = size; page = nextPage; draw(); },
      }));
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

  // ---- trend charts (filled when the trend reconstruction resolves; see loadTrends above).
  // paintTrends clears chartsHost when it runs — the "Computing trends…" placeholder, or the
  // previously drawn charts on a severity re-apply, are replaced with the fresh scoped pair.
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
    // KM median trend — the same censoring-aware series the MTTR page plots (still-open
    // findings right-censored, so a wave of fresh open findings can't bias it down), replacing
    // the old naive closed-only median. Null where the median is unobservable under censoring;
    // hollow vertices + a shaded band mark the reconstructed pre-first-scan prefix (see trendLine).
    const kmMedianPoints = trends.trend
      .map((t) => ({ x: t.date, y: t.km_median_days, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);
    // A trend needs at least two points; KM can be censored at every point on a young ledger,
    // so show an honest note there rather than an empty axis.
    const hasKm = kmMedianPoints.length > 1;

    const openResolvedCanvas = el("canvas", { id: "hist-open-resolved" });
    const mttrCanvas = el("canvas", { id: "hist-mttr" });
    const mttrBody = hasKm
      ? el("div", {},
        el("div", { class: "chart-box" }, mttrCanvas),
        el("p", { class: "chart-caption muted" },
          "Kaplan–Meier median days to remediation, replayed as of each scan; " +
          "still-open findings censored."))
      : el("p", { class: "chart-empty muted" },
        "Not enough remediation history to estimate a KM median trend yet.");

    chartsHost.append(
      el("div", { class: "chart-card" }, el("h3", {}, "Open vs resolved"),
        el("div", { class: "chart-box" }, openResolvedCanvas)),
      el("div", { class: "chart-card" }, el("h3", {}, "MTTR trend (KM median)"), mttrBody),
    );
    loadCharts().then((charts) => {
      charts.openResolvedLines(openResolvedCanvas, trends.trend);
      if (hasKm) charts.trendLine(mttrCanvas, kmMedianPoints, { yLabel: "days" });
    }).catch(() => {
      chartUnavailable(openResolvedCanvas);
      if (hasKm) chartUnavailable(mttrCanvas);
    });
  }
}
