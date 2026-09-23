// The scoped viewer's shell: a summary page and a read-only findings list, plus the locked
// scope badge in the header. Shared by gas and gas_devsecops — the summary shape is common
// (gas/src/domain/scopeSummary.ts), and the findings table takes its columns and its fetch
// from the app.
//
// READ-ONLY BY CONSTRUCTION, NOT BY HIDING. Nothing here calls a write endpoint, and the
// server refuses a scoped caller every RPC outside the short list these pages use
// (access.ts `SCOPED_RPCS`), so a control someone re-enabled in devtools would still be
// answered "forbidden".

import { call } from "../api.js";
import { bootstrap, swrCall } from "../store.js";
import { el, clear, downloadText } from "./dom.js";
import { errorState, measuredEmpty, skeletonStack, syncCaption, toast } from "./feedback.js";
import { kpiCard } from "./controls.js";
import { dataTable, tableFooter } from "./data.js";
import { num } from "./figures.js";
import { sevBadge, sevSegmentBar, sevKeyRow } from "./severity.js";
import { sparkline } from "./sparkline.js";
import { fmtDate } from "./format.js";
import { tipAnchor } from "./tip.js";
import { scopeLabel, scopeSentence, summarySeries, summaryTiles } from "./scopedViewModel.js";

/** The header's locked scope: what this viewer sees, and that they cannot change it. */
export function scopeBadge(data) {
  const scope = data && data.scope;
  if (!scope) return null;
  return tipAnchor(
    el("span", { class: "scope-badge", "aria-label": "Your scope: " + scopeSentence(scope) },
      el("span", { class: "scope-badge__lock", "aria-hidden": "true" }, "🔒"),
      el("span", {}, scopeLabel(scope))),
    () => [scopeSentence(scope), "Your access is limited to this scope. Ask an admin to change it."],
  );
}

function pageHead(title, scope, lede) {
  return el("div", { class: "page-header page-header--solo" },
    // The same markup `pageHeader` draws, with the scope where the lane name would sit — the
    // scoped table is not in the app's PAGES, so `pageHeader({route})` cannot title it.
    el("div", { class: "page-titles" },
      el("div", { class: "kpi-label" }, scopeLabel(scope, 3)),
      el("h1", { class: "page-title" }, title),
      lede ? el("div", { class: "page-hero-sub" }, lede) : null));
}

function tileValue(v) {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v.toLocaleString() : String(v);
}

/**
 * The summary page. `opts.sevOrder` is the register's severity order; `opts.findingsRoute` the
 * findings page's route key, for the "see the findings" links.
 */
export async function renderScopeSummary(main, _params, opts = {}) {
  const boot = await bootstrap();
  const scope = boot && boot.scope;
  const findingsHref = "#/" + (opts.findingsRoute || "findings");
  main.append(pageHead("My scope", scope, scopeSentence(scope)));
  const host = el("div", { class: "scoped-summary" });
  main.append(host);

  let summary = boot && boot.summary;
  if (!summary) {
    host.append(skeletonStack(4));
    try {
      summary = await call("api_getScopeSummary", {});
    } catch (e) {
      clear(host).append(errorState("Your summary could not be loaded.", {
        detail: String((e && e.message) || e),
        onRetry: () => { clear(main); renderScopeSummary(main, _params, opts); },
      }));
      return;
    }
    clear(host);
  }

  const at = (summary.scan && summary.scan.ts) || null;
  host.append(el("p", { class: "small muted" }, syncCaption(at)));

  if (!num(summary.open) && !num(summary.resolved)) {
    host.append(measuredEmpty("Nothing in your scope yet.", {
      at,
      hint: "No finding in the register falls in these domains or teams. If that is wrong, " +
        "ask an admin to check your scope in Settings → Access.",
    }));
    return;
  }

  // THE TILES. Each figure is the MTTR page's own estimator over this viewer's rows.
  host.append(el("div", { class: "kpi-row" },
    ...summaryTiles(summary).map((t) => kpiCard(t.label, tileValue(t.value), t.sub || ""))));

  // OPEN BY SEVERITY, as a shape and as words.
  const order = opts.sevOrder || ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];
  const entries = order
    .map((sev) => {
      const hit = (summary.perSev || []).find((r) => r.sev === sev);
      return { sev, count: (hit && num(hit.open)) || 0 };
    })
    .filter((e) => e.count > 0);
  if (entries.length) {
    host.append(el("section", { class: "scoped-section" },
      el("h2", { class: "section-label" }, "Open by severity"),
      sevSegmentBar(entries, { size: "lg", label: entries.map((e) => `${e.count} ${e.sev}`).join(", ") }),
      sevKeyRow(entries)));
  }

  // THE TREND, as two sparklines — enough to see a direction, which is all this page claims.
  const series = summarySeries(summary);
  if (series.open.length > 1) {
    const range = series.from && series.to ? `${fmtDate(series.from)} – ${fmtDate(series.to)}` : "";
    host.append(el("section", { class: "scoped-section" },
      el("h2", { class: "section-label" }, "Trend"),
      el("div", { class: "scoped-trend" },
        el("div", { class: "scoped-trend__item" },
          el("span", { class: "small muted" }, "Open findings"),
          sparkline(series.open, { label: "Open findings", w: 240, h: 48 })),
        el("div", { class: "scoped-trend__item" },
          el("span", { class: "small muted" }, "Median days to fix"),
          sparkline(series.median, { label: "Median days to fix", unit: "days", w: 240, h: 48 }))),
      range ? el("p", { class: "small muted" }, range) : null));
  }

  // PER SEVERITY, the table the MTTR page leads with, cut to what this reader needs.
  const rows = (summary.perSev || []).map((r) => ({ ...r }));
  if (rows.length) {
    const days = (v) => (num(v) === null ? "—" : `${Math.round(num(v) * 10) / 10} d`);
    host.append(el("section", { class: "scoped-section" },
      el("h2", { class: "section-label" }, "By severity"),
      dataTable({
        panel: true,
        columns: [
          { key: "sev", label: "Severity", cell: (r) => sevBadge(r.sev) },
          { key: "open", label: "Open", className: "num", cell: (r) => (r.open || 0).toLocaleString() },
          { key: "pastSla", label: "Past SLA", className: "num",
            cell: (r) => (r.pastSla || 0).toLocaleString() },
          { key: "kmMedian", label: "MTTR median", className: "num", cell: (r) => days(r.kmMedian) },
          { key: "kmP90", label: "MTTR p90", className: "num", cell: (r) => days(r.kmP90) },
          { key: "slaPct", label: "Closed within SLA", className: "num",
            cell: (r) => (num(r.slaPct) === null ? "—" : `${Math.round(r.slaPct)}%`) },
          { key: "slaTarget", label: "SLA target", className: "num", cell: (r) => days(r.slaTarget) },
        ],
        rows,
      })));
  }

  host.append(el("p", {}, el("a", { href: findingsHref, class: "button" }, "See my findings →")));
}

/**
 * The findings list. `spec`:
 *   columns          dataTable columns (sortable keys must be ones the server sorts on)
 *   rpc              the paged endpoint name ("api_getRegisterRows")
 *   baseParams()     params every request carries (status, severities, …)
 *   csv()            optional: resolves `{filename, content}`
 *   onRowOpen(r, rows, kind), rowLabel(r, kind)   optional drill-down
 *   defaultSort, defaultDir
 *   kinds            optional `[{value, label}]`: a register switcher (gas_devsecops's SCA /
 *                    SAST / Secrets). `columns`, `baseParams` and `csv` then take the kind.
 */
export async function renderScopedFindings(main, params, spec) {
  const boot = await bootstrap();
  const scope = boot && boot.scope;
  main.append(pageHead("My findings", scope,
    "Every finding in your scope, open first. Read-only: ask the owning team to act on one."));

  const kinds = Array.isArray(spec.kinds) && spec.kinds.length ? spec.kinds : null;
  const askedKind = params && params.kind;
  const state = {
    status: params && ["open", "resolved", "all"].indexOf(params.status) >= 0 ? params.status : "open",
    kind: kinds ? (kinds.some((k) => k.value === askedKind) ? askedKind : kinds[0].value) : null,
    page: 0, pageSize: 50, sort: spec.defaultSort, dir: spec.defaultDir || "desc",
  };
  const pick = (v) => (typeof v === "function" ? v(state.kind) : v);
  const toolbar = el("div", { class: "toolbar" });
  const host = el("div", { class: "table-host" });
  main.append(toolbar, host);

  if (kinds) {
    const kindBtns = kinds.map((k) => el("button", {
      type: "button", class: "kind-pill", "aria-pressed": state.kind === k.value ? "true" : "false",
      onclick: () => {
        state.kind = k.value;
        state.page = 0;
        // A column this register does not have would be sorted on silently by nothing.
        state.sort = spec.defaultSort;
        state.dir = spec.defaultDir || "desc";
        kindBtns.forEach((b, i) => b.setAttribute("aria-pressed", kinds[i].value === k.value ? "true" : "false"));
        load(false);
      },
    }, k.label));
    toolbar.append(el("div", { class: "toolbar-group", role: "group", "aria-label": "Register" },
      el("span", { class: "small muted" }, "Register"), ...kindBtns));
  }

  const statusBtns = ["open", "resolved", "all"].map((v) => el("button", {
    type: "button", class: "kind-pill", "aria-pressed": state.status === v ? "true" : "false",
    onclick: () => {
      state.status = v;
      state.page = 0;
      statusBtns.forEach((b, i) => b.setAttribute("aria-pressed",
        ["open", "resolved", "all"][i] === v ? "true" : "false"));
      load(false);
    },
  }, v === "open" ? "Open" : v === "resolved" ? "Resolved" : "All"));
  toolbar.append(el("div", { class: "toolbar-group", role: "group", "aria-label": "State" },
    el("span", { class: "small muted" }, "State"), ...statusBtns));

  if (spec.csv) {
    const csvBtn = el("button", { type: "button", class: "secondary" }, "Export CSV");
    csvBtn.addEventListener("click", async () => {
      csvBtn.disabled = true;
      try {
        const res = await spec.csv(state.kind);
        downloadText(res.filename, res.content, "text/csv;charset=utf-8");
      } catch (e) {
        toast(`Export failed: ${(e && e.message) || e}`, "error");
      } finally {
        csvBtn.disabled = false;
      }
    });
    toolbar.append(el("div", { class: "toolbar-group" }, csvBtn));
  }

  function load(first) {
    host.replaceChildren(skeletonStack(5));
    const p = {
      ...(spec.baseParams ? spec.baseParams(state.kind) : {}),
      status: state.status, page: state.page, pageSize: state.pageSize,
      sort: state.sort, dir: state.dir,
    };
    (first ? swrCall(spec.rpc, p) : call(spec.rpc, p)).then((data) => paint(data || {})).catch((e) => {
      host.replaceChildren(errorState("Your findings could not be loaded.", {
        detail: String((e && e.message) || e),
        onRetry: () => load(false),
      }));
    });
  }

  function paint(data) {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    state.page = num(data.page) ?? state.page;
    state.pageSize = num(data.pageSize) ?? state.pageSize;
    state.sort = data.sort || state.sort;
    state.dir = data.dir === "asc" ? "asc" : "desc";
    const table = dataTable({
      columns: pick(spec.columns),
      rows,
      stickyHeader: true,
      sort: { key: state.sort, descending: state.dir === "desc" },
      onSort: (key) => {
        state.dir = state.sort === key && state.dir === "desc" ? "asc" : "desc";
        state.sort = key;
        state.page = 0;
        load(false);
      },
      onRowOpen: spec.onRowOpen ? (r) => spec.onRowOpen(r, rows, state.kind) : null,
      rowLabel: spec.rowLabel ? (r) => spec.rowLabel(r, state.kind) : null,
      emptyText: state.status === "open" ? "Nothing open in your scope." : "Nothing here.",
    });
    const footer = tableFooter({
      page: state.page,
      pageCount: num(data.pageCount) || 1,
      total: num(data.total) ?? rows.length,
      pageSize: state.pageSize,
      onPage: (pg) => { state.page = pg; load(false); },
      onPageSize: (size, next) => { state.pageSize = size; state.page = next; load(false); },
    });
    host.replaceChildren(table, footer);
  }

  load(true);
}
