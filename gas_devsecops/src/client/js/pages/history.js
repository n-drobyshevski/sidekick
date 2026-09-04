// Scan History — the durable ledger's own log: what was actually measured, when, and how the
// register moved between measurements.
//
// THREE ROWS PER SYNC, ONE PER SCOPE. One job walks all three registers (sca, sast, secrets)
// and each gets its own `scans` row, sharing the sync's id (`scan_id`) with `scope` as the
// other half of the key (readModels.ts's `buildHistory`, `api.ts`'s module header). So the
// table below is deliberately flat, one row per (scan_id, scope) pair, rather than one row
// per sync with the scope folded away — folding it away is exactly what would make a
// partial three-scope sweep look identical to a full one.
//
// A NULL `severities` READS AS "ALL", NEVER AS "NONE" — this is the one thing on this page
// that inverts if it is read backwards. `secrets` scans this register with the severity gate
// OFF (`DEFAULT_FETCH_SEVERITIES.secrets = []`), and ledgerCore.ts's `serializeSeverities`
// turns that empty selection into a stored `severities: null` — "unscoped", not "nothing
// requested". `sca`/`sast` normally carry a real list (`'["CRITICAL","HIGH"]'`). A reader
// told only WHEN a scan ran cannot tell a partial sweep from a full one; `severitiesLabel`
// below is the one function that has to get the null case right.
//
// THE KM-MEDIAN TREND ALREADY RESPECTS `kmSkipMask` — SERVER-SIDE. `historyModel`'s trend
// comes from `ledgerStore.loadTrend`, which runs `trend.withKmMedian(..., {maxReconstructed:
// KM_TREND_MAX_RECONSTRUCTED})`; a point that mask skips arrives here with
// `km_median_days: null` already. So this page's job is exactly gas/'s: filter the nulls out
// of the KM line and let the real + sampled points draw a continuous curve. Importing
// `domain/trend.ts`'s `kmSkipMask` itself would pull a server/domain module into the client
// bundle for a mask this payload has already applied.
//
// THE OPEN-PAST-SLA TREND IS NOT IN THIS PAYLOAD. `historyTrendSlice` (domain/pagePayload.ts)
// narrows `getScanHistory`'s trend to `["date", "reconstructed", "open", "resolved",
// "km_median_days"]` — `open_past_sla` is on `MTTR_TREND_KEYS` (the MTTR page's slice) only.
// So this page draws the two series it was actually sent and says, in words, where the third
// one lives, rather than drawing an empty axis under a promise nothing here can keep.

// `fmtCount` WAS MISSING FROM THIS IMPORT LIST and the whole page threw on every render.
// The figure-module consolidation moved `num`/`fmtCount`/`days1`/`denomNote` out of this file
// into `ui/figures.js` (see the note below) and re-imported three of the four; `fmtCount` is
// called four times in `renderKpis` and `renderPerScope` and was never brought back, so
// `renderKpis` raised `ReferenceError: fmtCount is not defined` before drawing a single card
// and the page rendered its fetch-failure box instead — seeded and empty alike. Nothing
// caught it because the catch printed "Couldn't load scan history." in a calm `role="status"`
// box that looks like an empty register, which is the exact confusion the first-run package
// was opened to end. Swapping that box for `errorState` is what made it visible.
import { bootstrap, swrCall } from "../store.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import {
  DEFAULT_PAGE_SIZE, chartTable, chartTableModel, clear, dataTable, days1, denomNote, el,
  emptyState, errorState, firstRunNotice, fmtCount, fmtDate, fmtDateTime, glossaryTip,
  heroStat, kpiCard, num,
  onPageTeardown, pageHeader, pageOf, registerWideNote, sectionLabel, skeletonStack, sortRows,
  tableFooter,
} from "../ui.js";

const SCOPE_LABELS = { sca: "Dependencies (SCA)", sast: "Code (SAST)", secrets: "Secrets" };

// ---------------------------------------------------------------------------- formatting
//
// `num`, `fmtCount`, `days1` and `denomNote` used to be DEFINED here — this file had the
// corrected refuse-before-cast shape from the start, which is why `ui/figures.js` (the one
// shared implementation every page in this package now imports) is a copy of THIS file's
// shape and not `sca.js`'s. See that module's header for the defect it replaces.

/**
 * A scan row's severity coverage, in words. `null` means the scan looked at EVERY severity
 * (the gate was off, or nothing narrowed it); an array names exactly what it looked at. Never
 * collapse the two — see the module header.
 */
export function severitiesLabel(raw) {
  if (raw === null || raw === undefined || raw === "") return "All severities";
  if (Array.isArray(raw)) return raw.length ? raw.join(", ") : "All severities";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed.join(", ");
  } catch (e) {
    /* not JSON — fall through to the honest default below */
  }
  return "All severities";
}

// ------------------------------------------------------------------------- pure view models

/** Whether a scan row is unscoped by severity — the exact predicate `severitiesLabel` uses. */
export function isAllSeverities(raw) {
  if (raw === null || raw === undefined || raw === "") return true;
  const arr = Array.isArray(raw) ? raw : (() => {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  })();
  return !Array.isArray(arr) || arr.length === 0;
}

/**
 * The scan log's rows, one per (scan_id, scope) — exactly the payload's shape, sorted newest
 * first. `groupBySync` below is what proves three rows share one sync; this stays flat
 * because that IS the table.
 */
export function scanRowsView(scans) {
  return (Array.isArray(scans) ? scans : []).map((s) => ({
    scanId: s.scan_id,
    ts: s.ts,
    scope: s.scope,
    scopeLabel: SCOPE_LABELS[s.scope] || String(s.scope || "—"),
    mode: s.mode,
    total: num(s.total, 0),
    newCount: num(s.new_count, 0),
    resolvedCount: num(s.resolved_count, 0),
    reopenedCount: num(s.reopened_count, 0),
    sealed: s.sealed === 1 || s.sealed === true,
    severitiesRaw: s.severities ?? null,
    severitiesText: severitiesLabel(s.severities),
    allSeverities: isAllSeverities(s.severities),
  }));
}

/**
 * Scan rows grouped by `scan_id` — the sync. On a healthy register every group has exactly
 * three members (sca, sast, secrets); a group with fewer is a partial sweep, and `scopes`
 * says which registers it actually covered.
 */
export function groupBySync(scans) {
  const bySync = new Map();
  for (const s of Array.isArray(scans) ? scans : []) {
    const key = s.scan_id;
    const list = bySync.get(key);
    if (list) list.push(s);
    else bySync.set(key, [s]);
  }
  return [...bySync.entries()].map(([scanId, rows]) => ({
    scanId,
    rows,
    scopes: rows.map((r) => r.scope).sort(),
    ts: rows.reduce((max, r) => (max && max > r.ts ? max : r.ts), null),
  }));
}

/** The headline KPIs: tracked / open / resolved, plus the derived resolved SHARE with its
 *  own denominator — the one rate this page's KPI band can honestly publish. */
export function kpiView(kpis) {
  const k = kpis || {};
  const tracked = num(k.tracked, 0);
  const resolved = num(k.resolvedAllTime, 0);
  return {
    tracked,
    open: num(k.open, 0),
    resolvedAllTime: resolved,
    medianMttr: k.medianMttr === null || k.medianMttr === undefined ? null : num(k.medianMttr),
    resolvedSharePct: tracked > 0 ? (resolved / tracked) * 100 : null,
  };
}

/** The KM-median line, nulls filtered — the client half of "kmSkipMask respected" (see the
 *  module header: the skip is already baked into `km_median_days: null` server-side). */
export function kmMedianPoints(trend) {
  return (Array.isArray(trend) ? trend : [])
    .filter((p) => p.km_median_days !== null && p.km_median_days !== undefined)
    .map((p) => ({ x: p.date, y: num(p.km_median_days), reconstructed: !!p.reconstructed }));
}

/** The open/resolved dual line, as `openResolvedLines` reads it — verbatim, reconstructed
 *  flag included. */
export function openResolvedPoints(trend) {
  return (Array.isArray(trend) ? trend : []).map((p) => ({
    date: p.date,
    open: num(p.open, 0),
    resolved: num(p.resolved, 0),
    reconstructed: !!p.reconstructed,
  }));
}

/**
 * Whether the scan-side tables owe the reader a register-wide note. `scans` and `perScope` are
 * per-scan/per-day facts with no project dimension (`readModels.ts::buildHistory`'s own
 * comment) — they never narrow to the view-project scope even though `kpis` and `trends`
 * beside them do. The server sets `scanScopeNote` to a non-null string exactly when a project
 * view is set (and to `null` otherwise), so its own presence — not a second client-side scope
 * check — is the gate.
 */
export function scanScopeNoteShown(payload) {
  return !!(payload && payload.scanScopeNote);
}

/** One scope's row for the "what was measured" strip. */
export function perScopeView(perScope) {
  const out = [];
  for (const scope of ["sca", "sast", "secrets"]) {
    const s = (perScope && perScope[scope]) || {};
    out.push({
      scope,
      label: SCOPE_LABELS[scope] || scope,
      scans: num(s.scans, 0),
      sealed: num(s.sealed, 0),
      firstScanTs: s.firstScanTs ?? null,
      lastScanTs: s.lastScanTs ?? null,
      lastTotal: s.lastTotal === null || s.lastTotal === undefined ? null : num(s.lastTotal),
    });
  }
  return out;
}

// ----------------------------------------------------------------------------- the page

export async function renderHistory(host, _params, _ctx) {
  const boot = await bootstrap();
  host.append(pageHeader({
    hero: heroStat(
      "Data",
      "Scan history",
      "What was actually measured and when, and how the register moved between measurements.",
    ),
  }));

  // A DIV, not a <p>: on the first run this slot holds the shared first-run notice, which is
  // a block with its own children, and a <p> cannot legally contain one.
  const observedHost = el("div", { class: "small muted" });
  const kpiHost = el("div", { class: "kpi-row" });
  const perScopeHost = el("div", {});
  const tableHost = el("div", {});
  const chartsHost = el("div", { class: "chart-grid" });

  host.append(
    observedHost,
    kpiHost,
    sectionLabel("Coverage by register"),
    perScopeHost,
    sectionLabel("Saved scans"),
    tableHost,
    sectionLabel("Trends"),
    chartsHost,
  );

  kpiHost.append(skeletonStack(4, { variant: "stat" }));

  let sortSpec = { key: "ts", descending: true, value: (r) => Date.parse(r.ts) || 0 };
  let page = 0;
  let pageSize = DEFAULT_PAGE_SIZE;

  let paint = null;
  const promise = swrCall("api_getScanHistory", {}, (fresh) => paint && paint(fresh));

  paint = (payload) => {
    // `observedFrom` is the page's own honest signal and it is already what `renderObserved`
    // gates on: it is the first saved scan's date, so a null there means nothing has ever
    // been measured and every figure below is a count over a window that does not exist.
    const first = !(payload && payload.observedFrom);
    renderObserved(payload);
    renderKpis(payload, first);
    renderPerScope(payload, first);
    renderTable(payload);
    renderTrends(payload);
  };

  try {
    paint(await promise);
  } catch (e) {
    console.error("[history] api_getScanHistory failed:", e);
    // A failure, not an absence — this page's whole subject is what HAS been measured, so
    // announcing a fetch failure in the same voice as "nothing measured yet" was the worst
    // place in the register to confuse the two.
    clear(kpiHost).append(errorState(
      "Couldn't load scan history.",
      { detail: String((e && e.message) || e) },
    ));
  }

  function renderObserved(payload) {
    const from = payload && payload.observedFrom;
    clear(observedHost);
    if (from) {
      observedHost.append(el("p", { class: "small muted" },
        `Watching since ${fmtDate(from)} — the first saved scan dates the observation window.`));
      return;
    }
    // The SAME notice every other page carries, rather than this page's own wording for the
    // same state. A reader moving between pages should meet one sentence, not four.
    observedHost.append(firstRunNotice({
      synced: !!boot.latestSync,
      hint: "Nothing dates when watching began, so there is no observation window for the"
        + " figures below to sit inside. Run a sync from the scan zone in the rail.",
    }));
  }

  function renderKpis(payload, first) {
    const v = kpiView(payload && payload.kpis);
    clear(kpiHost);
    // SUPPRESSED, not dashed — the convention the Program lane already uses. "Tracked
    // (all-time) 0" over a register that has never been read is the same confident zero the
    // front door was printing, and this page is where a reader comes to check that.
    if (first) {
      kpiHost.append(emptyState(
        "Nothing has been tracked yet.",
        "These four are all-time counts over saved scans, so the first sync is what starts"
        + " them.",
      ));
      return;
    }
    kpiHost.append(
      kpiCard("Tracked (all-time)", fmtCount(v.tracked)),
      kpiCard("Currently open", fmtCount(v.open)),
      (() => {
        const card = kpiCard("Resolved (all-time)", fmtCount(v.resolvedAllTime));
        card.append(denomNote(
          v.resolvedSharePct === null
            ? "No findings tracked yet."
            : `${v.resolvedSharePct.toFixed(1)}% of ${v.tracked.toLocaleString()} tracked.`,
        ));
        return card;
      })(),
      kpiCard(glossaryTip("Median MTTR", "half-life"), days1(v.medianMttr)),
    );
  }

  function renderPerScope(payload, first) {
    const rows = perScopeView(payload && payload.perScope);
    clear(perScopeHost);
    if (first) {
      perScopeHost.append(emptyState(
        "No register has been scanned yet.",
        "This table is the record of what each register was asked for and when, so it fills"
        + " in one row per register per sync.",
      ));
      return;
    }
    perScopeHost.append(dataTable({
      columns: [
        { key: "label", label: "Register", cell: (r) => r.label },
        { key: "scans", label: "Scans", className: "num", cell: (r) => r.scans.toLocaleString() },
        { key: "sealed", label: "Sealed", className: "num", cell: (r) => r.sealed.toLocaleString() },
        { key: "first", label: "First scan", cell: (r) => (r.firstScanTs ? fmtDateTime(r.firstScanTs) : "—") },
        { key: "last", label: "Last scan", cell: (r) => (r.lastScanTs ? fmtDateTime(r.lastScanTs) : "—") },
        { key: "total", label: "Last total", className: "num", cell: (r) => fmtCount(r.lastTotal) },
      ],
      rows,
      emptyText: "No scans saved yet.",
    }));
    // `perScope` (`loadScanRows()` counted per register) carries no project dimension — see
    // scanScopeNoteShown's doc comment. Worded for THIS table specifically, not a copy of the
    // KPI band's own scope.
    if (scanScopeNoteShown(payload)) {
      perScopeHost.append(registerWideNote(
        "Scan counts across every register, not narrowed to the selected project — a scan "
        + "battery carries no project dimension to narrow by.",
      ));
    }
  }

  function renderTable(payload) {
    const scans = scanRowsView(payload && payload.scans);
    const groups = groupBySync(scans);
    const partial = groups.filter((g) => g.scopes.length < 3);
    clear(tableHost);
    if (!scans.length) {
      tableHost.append(emptyState(
        "No scans saved yet.",
        "Every figure on this page is empty until one runs.",
      ));
      return;
    }
    const sorted = sortRows(scans, sortSpec);

    function draw() {
      const cut = pageOf(sorted, page, pageSize);
      page = cut.page;
      const table = dataTable({
        columns: [
          { key: "ts", label: "When", sortable: true, cell: (r) => fmtDateTime(r.ts) },
          { key: "scope", label: "Register", sortable: true, cell: (r) => r.scopeLabel },
          {
            key: "severities", label: "Severities covered", help: { term: "coverage" },
            cell: (r) => (r.allSeverities
              ? el("span", {}, "All severities", el("span", { class: "domain-chip" }, "gate off"))
              : r.severitiesText),
          },
          { key: "total", label: "Findings", className: "num", sortable: true, cell: (r) => r.total.toLocaleString() },
          { key: "new", label: "+New", className: "num", cell: (r) => r.newCount.toLocaleString() },
          { key: "resolved", label: "−Resolved", className: "num", cell: (r) => r.resolvedCount.toLocaleString() },
          { key: "reopened", label: "Reopened", className: "num", cell: (r) => r.reopenedCount.toLocaleString() },
          { key: "sealed", label: "Sealed", cell: (r) => (r.sealed ? "Sealed" : "") },
        ],
        rows: cut.rows,
        sort: sortSpec,
        onSort: (key) => {
          const value = key === "scope" ? (r) => r.scopeLabel
            : key === "ts" ? (r) => Date.parse(r.ts) || 0
            : key === "total" ? (r) => r.total
            : (r) => r[key];
          sortSpec = sortSpec.key === key
            ? { key, descending: !sortSpec.descending, value }
            : { key, descending: true, value };
          renderTable(payload);
        },
        emptyText: "No scans saved yet.",
      });
      const footer = tableFooter({
        page,
        pageCount: cut.pageCount,
        total: sorted.length,
        pageSize,
        onPage: (p) => { page = p; draw(); },
        onPageSize: (size, nextPage) => { pageSize = size; page = nextPage; draw(); },
      });
      clear(tableHost).append(table, footer, denomNote(
        `${sorted.length.toLocaleString()} scan row(s) across ${groups.length.toLocaleString()} sync(s)`
        + " — three rows per sync, one per register, unless a sweep was partial.",
      ));
      if (partial.length) {
        tableHost.append(el("p", { class: "small muted" },
          `${partial.length.toLocaleString()} sync(s) covered fewer than all three registers: `
          + partial.map((g) => `${fmtDate(g.ts)} (${g.scopes.join(", ")})`).join("; ") + "."));
      }
      // THIS TABLE SPECIFICALLY, not the KPI band or the trend below it — `scans` is a
      // per-scan fact with no project dimension, so it never narrows with the view-project
      // scope even while a project is selected; the KPIs above and the trend below both do.
      if (scanScopeNoteShown(payload)) {
        tableHost.append(registerWideNote(
          "This table lists every scan ever run, not narrowed to the selected project — a "
          + "scan battery carries no project dimension to narrow by. The KPIs above and the "
          + "trend below ARE scoped to it.",
        ));
      }
    }
    draw();
  }

  function renderTrends(payload) {
    const trend = (payload && payload.trends && payload.trends.trend) || [];
    clear(chartsHost);
    if (!trend.length) {
      chartsHost.append(emptyState("Not enough scan history yet to chart trends."));
      return;
    }
    const kmPoints = kmMedianPoints(trend);
    const openResolved = openResolvedPoints(trend);

    const orCanvas = el("canvas");
    const kmCanvas = el("canvas");
    chartsHost.append(
      el("div", { class: "chart-card" },
        el("h3", { class: "section-label" }, "Open vs resolved"),
        el("div", { class: "chart-box" }, orCanvas),
        // `openResolved` — the array handed to the wrapper below — listed, not re-derived.
        chartTable({
          canvas: orCanvas,
          caption: "Both lines as figures: open and resolved counts at each date. A"
            + " reconstructed row predates the first saved scan, where closures are"
            + " under-counted.",
          model: chartTableModel({
            columns: [
              {
                key: "date",
                label: "Date",
                format: "text",
                value: (p) => String(p.date).slice(0, 10),
              },
              { key: "open", label: "Open", format: "count" },
              { key: "resolved", label: "Resolved", format: "count" },
              {
                key: "reconstructed",
                label: "Reconstructed",
                format: "text",
                align: "text",
                value: (p) => (p.reconstructed ? "yes" : "no"),
              },
            ],
            rows: openResolved,
          }),
        })),
      el("div", { class: "chart-card" },
        el("h3", { class: "section-label" }, glossaryTip("MTTR trend (KM median)", "half-life")),
        kmPoints.length > 1
          ? el("div", { class: "chart-box" }, kmCanvas)
          : el("p", { class: "chart-empty muted" },
              "Not enough remediation history to estimate a KM median trend yet."),
        kmPoints.length > 1
          ? chartTable({
            canvas: kmCanvas,
            caption: "The Kaplan-Meier median, in days, as of each replayed date — the same"
              + " points the line above plots.",
            model: chartTableModel({
              columns: [
                {
                  key: "x",
                  label: "Date",
                  format: "text",
                  value: (p) => String(p.x).slice(0, 10),
                },
                { key: "y", label: "Half-life", format: "days" },
                {
                  key: "reconstructed",
                  label: "Reconstructed",
                  format: "text",
                  align: "text",
                  value: (p) => (p.reconstructed ? "yes" : "no"),
                },
              ],
              rows: kmPoints,
            }),
          })
          : null),
    );
    if (kmPoints.length > 1) {
      chartsHost.append(el("p", { class: "small muted" },
        glossaryTip("Still-open findings", "censoring"),
        " stay in the curve behind this line rather than being dropped, which is what makes "
        + "the median honest as of each replayed date."));
    }
    chartsHost.append(el("p", { class: "small muted", style: "grid-column:1/-1" },
      "The open-past-SLA trend is not in this page's payload — historyTrendSlice ships date, "
      + "reconstructed, open, resolved and km_median_days only. It is on the MTTR & SLA page."));

    loadCharts()
      .then((api) => {
        api.openResolvedLines(orCanvas, openResolved);
        onPageTeardown(() => { try { api.destroyChart(orCanvas); } catch (e) { /* detached */ } });
        if (kmPoints.length > 1) {
          api.trendLine(kmCanvas, kmPoints, { yLabel: "days" });
          onPageTeardown(() => { try { api.destroyChart(kmCanvas); } catch (e) { /* detached */ } });
        }
      })
      .catch(() => {
        chartUnavailable(orCanvas);
        if (kmPoints.length > 1) chartUnavailable(kmCanvas);
      });
  }
}
