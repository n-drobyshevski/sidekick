// Scan History — the durable ledger: saved scans (paginated, newest-first, multi-select
// delete with sealed protection) and remediation trend charts. This is the page whose whole
// job is history and recency, so it leans on humanized mode / sample-vs-live labels,
// freshness cues, and colored posture deltas rather than raw enums.

import { call } from "../../../../../gas_shared/api.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import {
  absent, chartTable, clear, confirmDialog, dataTable, el, emptyState, errorState, firstRunNotice, fmtDateTime, fmtSpan, kpiCard, num, pageHeader, relativeAge, sectionLabel, statusPill, tableFooter, tipAnchor, toast,
} from "../ui.js";
import { trendTableModel } from "./_charts.js";
import { movementView } from "./historyModel.js";

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

export async function renderHistory(main, _params, ctx) {
  const boot = await bootstrap();

  main.append(pageHeader({
    route: "history",
    lede: "Every saved scan retained in the durable ledger, with remediation trends.",
  }));

  // NOTHING HAS BEEN READ YET, and a page whose whole subject is history owes that fact
  // ahead of anything else: no KPI band of zeros, no "No scans saved yet." table, no
  // "Not enough scan history yet" chart — three separate absences restating the one thing
  // `firstRunNotice` already says. `await bootstrap()` above, never a cached read, so
  // `latestScan` is never a stale null.
  if (!boot.latestScan) {
    main.append(firstRunNotice({
      synced: false,
      hint: "Use “Run scan” in the sidebar to take the first measurement.",
    }));
    return;
  }

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
    paintMovement(fresh);
  });

  const noticeHost = el("div", {});
  const freshLine = el("p", { class: "section-note" });
  const kpiRow = el("div", { class: "kpi-row" });
  const scansHost = el("div", {});
  const movementHost = el("div", {});
  const chartsHost = el("div", { class: "chart-grid", style: "margin-top:20px" });
  main.append(
    noticeHost, freshLine, kpiRow, sectionLabel("Saved scans", { term: "scan" }), scansHost,
    sectionLabel("What moved the number", { lines: [
      "Two tables, not one: an API-confirmed resolution and a finding that merely stopped "
      + "appearing in a scan are counted separately, because only one of them is a confirmed "
      + "remediation.",
    ] }),
    el("p", { class: "section-note" },
      "The change in the open count over the last 28-day window bounded by two saved scans, "
      + "split into the causes that moved it — and which of them are remediation the register "
      + "actually observed."),
    movementHost,
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
      .catch((e) => {
        // A failure, not an absence: the placeholder above says "Computing trends…" forever
        // otherwise, which reads as a hang rather than as the fetch that actually failed.
        console.error("[history] trends failed:", e);
        clear(chartsHost).append(errorState("Couldn't load trends.",
          { detail: String((e && e.message) || e) }));
      });
  }
  loadTrends();

  try {
    const data = await historyPromise;
    paintKpis(data.kpis, data.scans);
    paintScans(data.scans);
    paintMovement(data);
  } catch (e) {
    // A failure, not an absence — this page's whole subject is what HAS been measured, so
    // announcing a fetch failure in the same voice as "nothing measured yet" would be the
    // worst place in the register to confuse the two.
    console.error("[history] api_getScanHistory failed:", e);
    clear(kpiRow).append(errorState("Couldn't load scan history.", {
      detail: String((e && e.message) || e),
      onRetry: () => ctx.refresh(),
    }));
  }

  function paintKpis(kpis, scans) {
    clear(noticeHost);
    // A scan has run (the page-wide gate above already refused otherwise), but it saved no
    // lifecycle the ledger tracks — a measured "nothing here", dated to that scan. `firstRunNotice`
    // here, not `emptyState`: the KPI band is the one section this notice actually replaces,
    // never the table or the trend charts, which keep their own honest empty states below.
    if (kpis.tracked === 0) {
      noticeHost.append(firstRunNotice({
        synced: true,
        at: boot.latestScan.ts,
        hint: "The saved scan tracked no findings, so there is nothing here to measure yet.",
      }));
      clear(kpiRow);
      freshLine.textContent = "";
      freshLine.style.display = "none";
      return;
    }
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

  // ---- what moved the number (see pages/historyModel.js for the reading, and
  // domain/program.ts's movementDecomposition for the arithmetic).
  //
  // TWO TABLES, NOT ONE TABLE WITH A COLUMN. The section exists to keep "the API said this was
  // fixed" and "the scan stopped seeing it" apart; a single table sorted by count invites a
  // total across them, and that total is precisely the number a narrowed severity gate
  // inflates for free.
  const CAUSE_COLUMNS = [
    {
      key: "cause",
      label: "Cause",
      help: ["Which of the two measured pathways moved the open count between the two scans."],
      cell: (r) => r.cause,
    },
    {
      key: "basis",
      label: "How the date was arrived at",
      help: ["What kind of evidence dates this row: an API-confirmed resolution, or a finding "
        + "that simply stopped appearing in a scan — an upper bound, not an exact date."],
      cell: (r) => r.basis,
    },
    {
      key: "count",
      label: "Findings",
      help: ["Findings that moved by this cause, in the measured window."],
      cell: (r) => r.count.toLocaleString(),
    },
  ];

  function causeTable(title, rows) {
    return el("div", { class: "chart-card" },
      el("h3", {}, title),
      dataTable({
        columns: CAUSE_COLUMNS,
        rows,
        cellClass: (_row, col) => (col.key === "count" ? "num" : ""),
      }));
  }

  function paintMovement(payload) {
    const view = movementView(payload.movement, payload.movementNote);
    clear(movementHost);
    if (view.empty) {
      // The server's own words, verbatim: it is the only thing that knows WHY it declined,
      // and a reason invented here would print in the same ink as a measurement.
      movementHost.append(emptyState(
        view.empty,
        "The decomposition compares two saved scans at least 28 days apart."));
      return;
    }
    movementHost.append(
      el("p", { class: "section-note" }, view.sentence),
      el("div", {
        style: "display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(280px,1fr))",
      },
      causeTable("Measured remediation", view.measuredRows),
      causeTable("Administrative", view.administrativeRows)),
    );
    if (view.asideRows.length) {
      movementHost.append(el("ul", { class: "small", style: "margin:12px 0 0; padding-left:18px" },
        ...view.asideRows.map((r) => el("li", {},
          `${r.label}: `, el("span", { class: "num" }, r.count.toLocaleString())))));
    }
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

      // `dataTable` NOW, AND TWO SHARED ADDITIONS ARE WHAT MADE IT POSSIBLE. This block was
      // the last hand-built `<table class="data">` in the three apps, and the comment that
      // stood here named the exact blocker: the sticky heading that actually works in this app
      // is pinned by `.history-table th` — a class on the TABLE element — and `dataTable`
      // hardcoded `class: "data"` there, able to class only the `.table-wrap` it returns. Its
      // own `stickyHeader` is a different treatment (gated at 1100px, offset by
      // `--sticky-inset`), so taking it would have un-pinned a heading that works. `dataTable`
      // takes `tableClassName` now, and both CSS rules — `.history-table th` and
      // `.history-table-wrap` — are unchanged and still the ones that match.
      //
      // THE SECOND ADDITION IS `cellClass`, AND THIS TABLE IS WHY IT IS SEPARATE FROM
      // `col.className`. A column class lands on the header AND the cells; the six numeric
      // columns here want `num` on the cells only, because `table.data th.num` right-aligns a
      // heading and this table's headings are not right-aligned. Expressing it as a column
      // class would have moved eight header labels. `cellClass` says what THIS VALUE is, where
      // `className` says what the COLUMN is, and only one of the two is true here.
      //
      // WHAT THE COMPONENT ADDS, beyond deleting forty lines: `aria-sort` on the active header
      // (this had none — the direction rode inside the button's aria-label, which a screen
      // reader reads as part of the column NAME), and the sort glyph in its own
      // `.th-sort-glyph` span rather than concatenated into the button's text.
      const NUM_CELLS = new Set(["when", "total", "new", "resolved", "reopened"]);
      const columns = [
        {
          key: "select",
          label: selectAll,
          help: ["Select every deletable scan on this page. Sealed scans can't be selected."],
          cell: (s) => selectCell(s),
        },
        {
          key: "when",
          label: "When",
          sortable: true,
          help: ["When this scan ran."],
          cell: (s) => {
            const when = el("span", {}, fmtDateTime(s.ts));
            if (s.scan_id !== newestId) return when;
            return el("span", {}, when,
              el("span", { class: "domain-chip", style: "margin-left:8px" }, "Latest"));
          },
        },
        {
          key: "mode",
          label: "Mode",
          help: ["Whether this scan read live Wiz data or bundled sample data, and whether it "
            + "was a full scan or a quick incremental refresh."],
          cell: (s) => modeCell(s.mode),
        },
        {
          key: "shape",
          label: "Shape",
          help: ["Whether the scan saved one row per finding, or counts only. A counts-only "
            + "scan can't feed insights, MTTR or attribution."],
          cell: (s) => shapeLabel(s.shape),
        },
        {
          key: "total",
          label: "Findings",
          help: ["Findings this scan tracked, across every severity in scope."],
          cell: (s) => s.total.toLocaleString(),
        },
        {
          key: "new",
          label: "+New",
          help: ["Findings first seen in this scan that were not present in the previous one."],
          cell: (s) => deltaCell(s.new_count, { sign: "+" }),
        },
        {
          key: "resolved",
          label: "−Resolved",
          help: ["Findings that left the register between the previous scan and this one."],
          cell: (s) => deltaCell(s.resolved_count, { good: true, sign: "−" }),
        },
        {
          key: "reopened",
          label: "Reopened",
          help: { term: "returned" },
          cell: (s) => deltaCell(s.reopened_count, { sign: "+" }),
        },
        {
          key: "scope",
          label: "Scope",
          help: ["The severities this scan covered — \"all\" when every selectable severity "
            + "was in scope."],
          cell: (s) => (s.severities ? JSON.parse(s.severities).join(", ") : "all"),
        },
        // The sentence used to ride on a `title` attribute, which el() now throws on: a native
        // tooltip cannot be reached by keyboard and does not exist on touch, so the one
        // explanation of why a row's checkbox is disabled was unreadable for anyone not
        // hovering a mouse. tipAnchor puts it in the app's own hover card; the pill is not a
        // control, so it takes the anchor form rather than becoming a second tab stop inside a
        // row that already has one.
        {
          key: "status",
          label: "Status",
          help: { term: "sealed" },
          cell: (s) => (s.sealed
            ? tipAnchor(
              el("span", { class: "pill neutral",
                "aria-label": "Sealed — part of the compacted baseline; can't be deleted." },
                "Sealed"),
              () => ["Sealed scans are part of the compacted baseline and can't be deleted."])
            : ""),
        },
      ];

      function selectCell(s) {
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
        return cb;
      }

      clear(tableHost).append(dataTable({
        columns,
        rows: slice,
        // ONE SORTABLE COLUMN, so the active key is always this one; the direction is the
        // state. `dataTable` puts it on the <th> as `aria-sort` and draws the glyph itself.
        sort: { key: "when", descending: sortDir === "desc" },
        onSort: () => { sortDir = sortDir === "desc" ? "asc" : "desc"; draw(); },
        tableClassName: "history-table",
        className: "history-table-wrap",
        cellClass: (row, col) => (NUM_CELLS.has(col.key) ? "num" : ""),
      }));
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
    // Named once — the same reference both charts.openResolvedLines below and this card's
    // chartTable are handed, so the two can never disagree about the population plotted.
    const rows = trends.trend;
    const kmMedianPoints = rows
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
          "still-open findings censored."),
        chartTable({
          canvas: mttrCanvas,
          caption: "Every point of the line above: date, and the Kaplan–Meier median days to "
            + "remediation as of that date.",
          model: trendTableModel(kmMedianPoints, [
            { key: "y", label: "Half-life", format: "days" },
          ], { dateKey: "x" }),
        }))
      : el("p", { class: "chart-empty muted" },
        "Not enough remediation history to estimate a KM median trend yet.");

    chartsHost.append(
      el("div", { class: "chart-card" }, el("h3", {}, "Open vs resolved"),
        el("div", { class: "chart-box" }, openResolvedCanvas),
        chartTable({
          canvas: openResolvedCanvas,
          caption: "Every point of the line above: date, open findings and resolved findings.",
          model: trendTableModel(rows, [
            { key: "open", label: "Open", format: "count" },
            { key: "resolved", label: "Resolved", format: "count" },
          ]),
        })),
      el("div", { class: "chart-card" }, el("h3", {}, "MTTR trend (KM median)"), mttrBody),
    );
    loadCharts().then((charts) => {
      charts.openResolvedLines(openResolvedCanvas, rows);
      if (hasKm) charts.trendLine(mttrCanvas, kmMedianPoints, { yLabel: "days" });
    }).catch(() => {
      chartUnavailable(openResolvedCanvas);
      if (hasKm) chartUnavailable(mttrCanvas);
    });
  }
}
