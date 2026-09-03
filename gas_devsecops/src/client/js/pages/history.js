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

import { swrCall } from "../store.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import {
  DEFAULT_PAGE_SIZE, clear, dataTable, el, emptyState, fmtDate, fmtDateTime, glossaryTip,
  heroStat, kpiCard, onPageTeardown, pageHeader, pageOf, sectionLabel, skeletonStack, sortRows,
  tableFooter,
} from "../ui.js";

const SCOPE_LABELS = { sca: "Dependencies (SCA)", sast: "Code (SAST)", secrets: "Secrets" };

// ---------------------------------------------------------------------------- formatting

/**
 * A number from an untrusted payload, or the fallback — and NEVER a silent zero.
 * `Number(null) === 0` is finite, so null/blank must be refused before the cast, not after;
 * see repos.js's copy of this helper for the bug that shape produced.
 */
export function num(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function fmtCount(v) {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString();
}

export function days1(v) {
  const n = num(v);
  return n === null ? "—" : `${n.toFixed(1)} d`;
}

/** The denominator node every rate on this page carries — see `sca.js`'s `denomNote`. */
export function denomNote(sentence) {
  return el("p", { class: "small muted", "data-denominator": sentence }, sentence);
}

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
  host.append(pageHeader({
    hero: heroStat(
      "Data",
      "Scan history",
      "What was actually measured and when, and how the register moved between measurements.",
    ),
  }));

  const observedHost = el("p", { class: "small muted" });
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
    renderObserved(payload);
    renderKpis(payload);
    renderPerScope(payload);
    renderTable(payload);
    renderTrends(payload);
  };

  try {
    paint(await promise);
  } catch (e) {
    console.error("[history] api_getScanHistory failed:", e);
    clear(kpiHost).append(emptyState("Couldn't load scan history.", String((e && e.message) || e)));
  }

  function renderObserved(payload) {
    const from = payload && payload.observedFrom;
    clear(observedHost);
    observedHost.textContent = from
      ? `Watching since ${fmtDate(from)} — the first saved scan dates the observation window.`
      : "No observation window yet: no scan has been saved, so nothing dates when watching began.";
  }

  function renderKpis(payload) {
    const v = kpiView(payload && payload.kpis);
    clear(kpiHost);
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

  function renderPerScope(payload) {
    const rows = perScopeView(payload && payload.perScope);
    clear(perScopeHost);
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
        el("div", { class: "chart-box" }, orCanvas)),
      el("div", { class: "chart-card" },
        el("h3", { class: "section-label" }, glossaryTip("MTTR trend (KM median)", "half-life")),
        kmPoints.length > 1
          ? el("div", { class: "chart-box" }, kmCanvas)
          : el("p", { class: "chart-empty muted" },
              "Not enough remediation history to estimate a KM median trend yet.")),
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
