// Scan History — the durable ledger: saved scans (paginated, newest-first, multi-select
// delete with sealed protection) and remediation trend charts. This is the page whose whole
// job is history and recency, so it leans on humanized mode / sample-vs-live labels,
// freshness cues, and colored posture deltas rather than raw enums.

import { call } from "../../../../../gas_shared/api.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import {
  absent, chartTable, clear, confirmDialog, dataTable, denomNote, el, emptyState, errorState,
  firstRunNotice, fmtDateTime, glossaryTip, kpiCard, num, pageHeader, pluralize, relativeAge,
  sectionLabel, sparkPath, sparkline, statusPill, tableFooter, tipAnchor, toast,
} from "../ui.js";
import { trendTableModel } from "./_charts.js";
import {
  kmSparkCaption, kpiSparkSeries, kpiView, movementView, sparkCaption,
} from "./historyModel.js";

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

  // Held so a trend arriving AFTER the KPI band's own fetch has already painted can redraw
  // the four sparklines without the KPI band waiting on the heavier fetch — see paintTrends.
  let latestTrend = [];
  let lastKpis = null;
  let lastScans = [];

  // Severity scope for the trend charts: the app-wide display setting, so the two trends
  // here read the same severities the rest of the app does. It scopes only the charts; the
  // KPI band and saved-scans table stay the raw ledger, which is all-severity by design —
  // both carry the "All severities" pill below for exactly that reason.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];
  // Null when every selectable severity is chosen (no filter → shares the default cache
  // entry); otherwise the chosen subset, which the server keeps alongside UNKNOWN.
  const scopeParam = () =>
    sevScope.length === boot.palette.selectable.length ? null : [...sevScope];

  /**
   * "All severities", ON THE SECTION'S OWN HEADING — the state as a pill, the sentence behind
   * it. The KPI band and the saved-scans table read the raw ledger regardless of the display-
   * severity setting (see the comment above); the trend charts at the foot of the page are the
   * ones scoped to it. The pill is rebuilt each time rather than appended once so a re-paint
   * (a background SWR refresh) never leaves a second copy behind.
   */
  function severityWidePill(heading, lines) {
    const existing = heading.querySelector(".heading-pill");
    if (existing) existing.remove();
    heading.append(el("span", { class: "heading-pill" },
      statusPill("neutral", "All severities", { lines })));
    return heading;
  }

  // KPI band + saved-scans table (the primary content, and the cheaper slice). Unscoped by
  // severity: the table is the raw scan ledger and its KPIs are all-severity by design.
  const historyPromise = swrCall("api_getScanHistory", {}, (fresh) => {
    paintKpis(fresh.kpis, fresh.scans);
    paintScans(fresh.scans);
    paintMovement(fresh);
  });

  const noticeHost = el("div", {});
  const freshLine = el("p", { class: "section-note" });
  // HELD, NOT STATIC. `kpiLabelHost` carries the "Snapshot" heading and its pill — the KPI
  // band was the one section on this page with no heading of its own, so it also had nowhere
  // for the "All severities" pill (below) to live; `scansLabelHost` carries the saved-scans
  // heading, whose denominator and pill both depend on the row count a paint delivers.
  const kpiLabelHost = el("div", {});
  const kpiRow = el("div", { class: "kpi-row" });
  const scansLabelHost = el("div", {});
  const scansHost = el("div", {});
  const movementHost = el("div", {});
  const chartsHost = el("div", { class: "chart-grid", style: "margin-top:20px" });
  main.append(
    noticeHost, freshLine, kpiLabelHost, kpiRow, scansLabelHost, scansHost,
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

  /**
   * A card, and the series it is the last reading of. Ported from
   * gas_devsecops/src/client/js/pages/history.js's own `sparkCard` — see that module's header
   * for the shape's full rationale (fewer than two measured readings draws the words, never
   * an empty box; the aria-label on `sparkline` itself always states first/last/low/high/how
   * many, so the caption is not carrying that job alone).
   *
   * `opts.caption`, WHEN GIVEN, IS A PRE-COMPUTED STRING rather than a callback — unlike the
   * ported original. The one caller that needs anything beyond the values array
   * (`kmSparkCaption`, the half-life card) reads the raw trend rows for their DATES, which a
   * `sparkPath` model no longer carries; computing that string once, before calling this
   * function, is simpler than growing a second signature just for that one card.
   */
  function sparkCard(card, values, name, opts) {
    const o = opts || {};
    const model = sparkPath(values, { w: 120, h: 28 });
    const strip = el("div", { class: "kpi-spark" });
    if (model.n >= 2) {
      strip.append(sparkline(values, { label: name, w: 120, h: 28, unit: o.unit || "" }));
    }
    strip.append(el("span", { class: "kpi-spark__cap" }, o.caption || sparkCaption(model)));
    card.append(strip);
    return card;
  }

  function paintKpis(kpis, scans) {
    lastKpis = kpis;
    lastScans = scans;
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
      clear(kpiLabelHost);
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

    clear(kpiLabelHost).append(severityWidePill(sectionLabel("Snapshot"), [
      "Tracked, open, resolved and the remediation half-life cover every severity in the "
      + "ledger — they are not narrowed to the display severities set in Settings.",
      "The trend charts at the foot of the page ARE scoped to them.",
    ]));

    const v = kpiView(kpis);
    const series = kpiSparkSeries(latestTrend);
    clear(kpiRow).append(
      sparkCard(kpiCard("Tracked (all-time)", v.tracked.toLocaleString()),
        series.tracked, "Findings tracked over time"),
      sparkCard(kpiCard("Currently open", v.open.toLocaleString()),
        series.open, "Open findings over time"),
      sparkCard((() => {
        const card = kpiCard("Resolved (all-time)", v.resolvedAllTime.toLocaleString());
        card.append(denomNote(
          v.resolvedSharePct === null
            ? "No findings tracked yet."
            : `${v.resolvedSharePct.toFixed(1)}% of ${v.tracked.toLocaleString()} tracked.`,
        ));
        return card;
      })(), series.resolved, "Findings resolved over time"),
      // ONE STATISTIC, ONE NAME. This card used to publish `kpis.medianMttr` — the plain
      // median over CLOSED rows — under this exact label, while the only line ever drawn
      // under it was the Kaplan–Meier series. `kpiView`'s own doc comment has the full
      // account; `v.halfLife` is the same three-outcome decision the MTTR page's hero
      // renders, over the same population.
      sparkCard(
        kpiCard(glossaryTip("Remediation half-life", "half-life"), v.halfLife.value),
        series.halfLife,
        "Remediation half-life over time",
        { unit: "days", caption: kmSparkCaption(latestTrend) },
      ),
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
      // `.chart-row--pair`, not the hand-rolled inline grid this used to carry: the same
      // narrower-than-`.chart-row` floor (300px, measured against a TABLE's own content
      // rather than a chart's — pages.css's own comment) that this page's Trends charts
      // already share, so the two-tables-not-one layout below is drawn with the page's own
      // grid rule instead of a private copy of it.
      el("div", { class: "chart-row chart-row--pair" },
        causeTable("Measured remediation", view.measuredRows),
        causeTable("Administrative", view.administrativeRows)),
    );
    if (view.asideRows.length) {
      movementHost.append(el("ul", { class: "small", style: "margin:12px 0 0; padding-left:18px" },
        ...view.asideRows.map((r) => el("li", {},
          `${r.label}: `, el("span", { class: "num" }, r.count.toLocaleString())))));
    }
  }

  /**
   * The saved-scans heading — "Saved scans", the row count as its own denominator sentence
   * (in `data-denominator` as well as the tip, so a test can read what a reader reads), and
   * the same "All severities" pill the KPI band carries: this table is the raw scan ledger,
   * one row per saved scan at whatever severities THAT scan covered, never narrowed to the
   * display-severity setting.
   */
  function scansHeading(rowCount) {
    const denominator = rowCount
      ? `${rowCount.toLocaleString()} scan ${pluralize(rowCount, "row")} saved.`
      : null;
    const heading = denominator
      ? sectionLabel("Saved scans", { term: "scan", lines: [denominator] })
      : sectionLabel("Saved scans", { term: "scan" });
    if (denominator) heading.setAttribute("data-denominator", denominator);
    return severityWidePill(heading, [
      "This table lists every saved scan — it is not narrowed to the display severities set "
      + "in Settings. The trend charts below ARE scoped to them.",
    ]);
  }

  // ---- saved scans table (paginated, sortable, sticky delete bar) with delete flow
  function paintScans(scans) {
    anySample = scans.some((s) => isSample(s.mode));
    clear(scansLabelHost).append(scansHeading(scans.length));
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
    // HELD FOR THE KPI BAND'S OWN SPARKLINES, and repainted here rather than waited on there:
    // `api_getScanHistory` (the KPI band's fetch) is the cheaper of the two calls and must not
    // block on this heavier one, so the four cards draw first with whatever `latestTrend`
    // already holds (nothing, on a cold load) and redraw the moment a trend arrives — the same
    // "cheap slice first" shape `historyPromise` / `loadTrends` already run in parallel for.
    latestTrend = Array.isArray(trends.trend) ? trends.trend : [];
    if (lastKpis) paintKpis(lastKpis, lastScans);
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
      // `.chart-empty` IS `position: absolute; inset: 0` (pages.css) — an OVERLAY meant to sit
      // inside a `.chart-box` (`position: relative; height: 240px`, tables.css), which is
      // exactly the box the `hasKm` branch above builds. This branch used to hand the bare
      // `<p class="chart-empty">` straight to `.chart-card` (no `.chart-box` in between), so
      // its nearest POSITIONED ancestor was `.app-body` (gas_shared/styles/base.css, the shell
      // around `main`, which itself scrolls and is never positioned) — the note pinned itself
      // to the top of that ancestor's box, painted across whatever `main`'s own scroll had at
      // the top (the KPI band / Saved scans table), and stayed there while the real page
      // content scrolled underneath it. Wrapping it in its own `.chart-box` gives it the same
      // local containing block `chartUnavailable` (chartsLoader.js) and the `hasKm` branch
      // both rely on, so it centers inside ITS OWN 240px card instead of escaping the page.
      : el("div", { class: "chart-box" },
        el("p", { class: "chart-empty muted" },
          "Not enough remediation history to estimate a KM median trend yet."));

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
