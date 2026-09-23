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
import { bootstrap, setParams, swrCall } from "../store.js";
import { el, clear, downloadText } from "./dom.js";
import { errorState, measuredEmpty, skeletonStack, syncCaption, toast } from "./feedback.js";
import { heroLines, heroStat, pageHeader, segmented, statRow } from "./controls.js";
import { collapsibleSection } from "./sheet.js";
import { dataTable, tableFooter } from "./data.js";
import { fmtDays, num } from "./figures.js";
import { sevBadge, sevSegmentBar, sevKeyRow } from "./severity.js";
import { sparkline } from "./sparkline.js";
import { fmtDate } from "./format.js";
import { tipAnchor } from "./tip.js";
import { wizCveUrl } from "./wizLinks.js";
import { uiIcon } from "./uiIcons.js";
import {
  splitCutNote, splitRowsView,
  groupLine, mttrHeroView, scopeLabel, scopeSentence, secondaryStats, sevMttrRows, summarySeries,
} from "./scopedViewModel.js";

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
 * The summary page — MTTR FIRST. One headline figure (the Kaplan-Meier median time to
 * remediate), MTTR per severity against its SLA target beside it, and MTTR over time as the
 * page's one real chart. Everything else is secondary and drawn smaller: the stat strip under
 * the hero, the open-by-severity shape, and a folded per-severity table.
 *
 * The same `pageHeader` shape the Executive front door uses (gas/DESIGN.md §6): hero, aside,
 * stat strip closed by a hairline — so a viewer who later gets full access reads the same page
 * grammar they already know. `opts.sevOrder` is the register's severity order;
 * `opts.findingsRoute` the findings page's route key.
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
  if (!num(summary.open) && !num(summary.resolved)) {
    host.append(measuredEmpty("Nothing in your scope yet.", {
      at,
      hint: "No finding in the register falls in these domains or teams. If that is wrong, " +
        "ask an admin to check your scope in Settings → Access.",
    }));
    return;
  }

  // ---------------------------------------------------------------- the headline: MTTR
  const hero = mttrHeroView(summary);
  const sevRows = sevMttrRows(summary);
  const aside = sevRows.length
    ? el("div", { class: "scoped-mttr-aside" },
      el("div", { class: "kpi-label" }, "MTTR by severity"),
      ...sevRows.map((r) => {
        // "Not yet" rather than the absent dash: a severity with nothing fixed has no median to
        // print, and saying so in words keeps an empty row from reading as a rendering fault.
        const row = statRow(r.sev, r.value || "Not yet", r.sub, r.meterPct);
        if (r.over) row.classList.add("stat-row--over");
        return row;
      }))
    : null;
  const header = pageHeader({
    hero: heroStat(
      "Time to remediate",
      hero.value,
      heroLines(hero.qualifier, hero.detail),
      ["Kaplan-Meier median: findings still open count as still waiting, so a wave of fresh " +
        "quick fixes cannot flatter it. Where fewer than half are fixed yet, it is a lower bound."],
    ),
    aside,
    stats: secondaryStats(summary).map((t) => statRow(t.label, tileValue(t.value), t.sub || "")),
  });
  // The hero IS this page, so it gets the wider column: a lower bound reads "at least 210
  // days", and the shared 0.5fr hero column broke that over two lines.
  header.classList.add("page-header--mttr");
  host.append(header);

  // ------------------------------------------------------ MTTR over time: the one chart
  const series = summarySeries(summary);
  const range = series.from && series.to ? `${fmtDate(series.from)} – ${fmtDate(series.to)}` : "";
  const measured = series.median.filter((v) => v !== null);
  if (!measured.length && series.open.length > 1) {
    host.append(el("section", { class: "scoped-section" },
      el("h2", { class: "section-label" }, "MTTR over time"),
      el("p", { class: "small muted" },
        "Not measurable yet: at no scan had half of your scope's findings been fixed, so there " +
        "is no median to plot — only the lower bound the headline states.")));
  }
  if (measured.length) {
    const first = measured[0];
    const last = measured[measured.length - 1];
    host.append(el("section", { class: "scoped-section" },
      el("div", { class: "scoped-trend__head" },
        el("h2", { class: "section-label" }, "MTTR over time"),
        el("span", { class: "small muted num" },
          first === last ? `${fmtDays(last)} throughout` : `${fmtDays(first)} → ${fmtDays(last)}`)),
      el("div", { class: "scoped-trend scoped-trend--primary" },
        sparkline(series.median, { label: "Median days to remediate", unit: "days", w: 640, h: 96 })),
      range ? el("p", { class: "small muted" }, range + " · median days to remediate, as of each scan") : null));
  }

  // ---------------------------------------------------------- MTTR by group: where it lags
  const splits = Array.isArray(summary.splits) ? summary.splits : [];
  if (splits.length) host.append(mttrSplitSection(splits));

  // ------------------------------------------------------------- secondary: the backlog
  const order = opts.sevOrder || ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];
  const entries = order
    .map((sev) => {
      const hit = (summary.perSev || []).find((r) => r.sev === sev);
      return { sev, count: (hit && num(hit.open)) || 0 };
    })
    .filter((e) => e.count > 0);
  const backlog = el("section", { class: "scoped-section scoped-section--secondary" },
    el("h2", { class: "section-label" }, "Open backlog"));
  if (entries.length) {
    backlog.append(
      sevSegmentBar(entries, { size: "md", label: entries.map((e) => `${e.count} ${e.sev}`).join(", ") }),
      sevKeyRow(entries));
  }
  if (series.open.length > 1) {
    backlog.append(el("div", { class: "scoped-trend__item" },
      el("span", { class: "small muted" }, "Open findings over time"),
      sparkline(series.open, { label: "Open findings", w: 240, h: 36 })));
  }
  backlog.append(el("p", { class: "small muted" }, syncCaption(at)));
  host.append(backlog);

  // ------------------------------------------------ the detail, folded until asked for
  const rows = (summary.perSev || []).map((r) => ({ ...r }));
  if (rows.length) {
    const days = (v) => (num(v) === null ? "—" : fmtDays(num(v)));
    const detail = collapsibleSection("Details by severity", {
      hint: `${rows.length} ${rows.length === 1 ? "severity" : "severities"}`,
      remember: "scopedSevDetail",
    });
    detail.body.append(dataTable({
      panel: true,
      columns: [
        { key: "sev", label: "Severity", cell: (r) => sevBadge(r.sev) },
        { key: "kmMedian", label: "MTTR median", className: "num", cell: (r) => days(r.kmMedian) },
        { key: "kmP90", label: "MTTR p90", className: "num", cell: (r) => days(r.kmP90) },
        { key: "slaTarget", label: "SLA target", className: "num", cell: (r) => days(r.slaTarget) },
        { key: "slaPct", label: "Closed within SLA", className: "num",
          cell: (r) => (num(r.slaPct) === null ? "—" : `${Math.round(r.slaPct)}%`) },
        { key: "open", label: "Open", className: "num", cell: (r) => (r.open || 0).toLocaleString() },
        { key: "pastSla", label: "Past SLA", className: "num",
          cell: (r) => (r.pastSla || 0).toLocaleString() },
      ],
      rows,
    }));
    host.append(detail.node);
  }

  host.append(el("p", {}, el("a", { href: findingsHref, class: "button" }, "See my findings →")));
}

/**
 * "MTTR by …": the headline's estimator, one row per support group / domain / asset (or team /
 * domain / repository). A segmented switch picks the dimension when there is more than one;
 * the table sorts in place. The bar is each group's median against the slowest group shown.
 */
function mttrSplitSection(splits) {
  let active = splits[0].dimension;
  let sort = { key: "open", descending: true };
  const tableHost = el("div", {});
  const noteHost = el("p", { class: "small muted" });
  const head = el("div", { class: "scoped-trend__head" },
    el("h2", { class: "section-label" }, "MTTR by " + splits[0].label.toLowerCase()));
  const section = el("section", { class: "scoped-section" }, head);
  if (splits.length > 1) {
    section.append(el("div", {}, segmented({
      options: splits.map((s) => ({ value: s.dimension, label: s.label })),
      value: active,
      ariaLabel: "Split MTTR by",
      onChange: (v) => {
        active = v;
        sort = { key: "open", descending: true };
        head.firstChild.textContent = "MTTR by " + current().label.toLowerCase();
        paint();
      },
    })));
  }
  section.append(tableHost, noteHost);
  const current = () => splits.find((s) => s.dimension === active) || splits[0];
  const cmp = (a, b) => {
    const x = a[sort.key];
    const y = b[sort.key];
    // Nulls last in both directions: an unmeasured median is not the fastest nor the slowest.
    if (x === null || x === undefined) return (y === null || y === undefined) ? 0 : 1;
    if (y === null || y === undefined) return -1;
    const d = typeof x === "string" ? String(x).localeCompare(String(y)) : x - y;
    return sort.descending ? -d : d;
  };
  function paint() {
    const split = current();
    const rows = splitRowsView(split).slice().sort(cmp);
    const num0 = (v) => (v || 0).toLocaleString();
    tableHost.replaceChildren(dataTable({
      panel: true,
      className: "scoped-split",
      sort,
      onSort: (key) => {
        sort = { key, descending: sort.key === key ? !sort.descending : key !== "group" };
        paint();
      },
      columns: [
        { key: "group", label: split.label, sortable: true,
          cell: (r) => (r.group === "(none)" ? el("span", { class: "muted" }, "(none)") : r.group) },
        {
          key: "days", label: "MTTR median", sortable: true,
          cell: (r) => el("span", { class: "scoped-split__mttr" },
            el("span", { class: "num" + (r.bounded ? " muted" : "") }, r.median || "Not yet"),
            r.barPct !== null
              ? el("span", { class: "scoped-split__bar", "aria-hidden": "true" },
                el("span", { style: `width:${r.barPct}%` }))
              : null),
        },
        { key: "p90", label: "p90", className: "num", sortable: true,
          cell: (r) => (r.p90 === null ? "—" : fmtDays(r.p90)) },
        { key: "open", label: "Open", className: "num", sortable: true, cell: (r) => num0(r.open) },
        { key: "resolved", label: "Fixed", className: "num", sortable: true, cell: (r) => num0(r.resolved) },
        { key: "pastSla", label: "Past SLA", className: "num", sortable: true, cell: (r) => num0(r.pastSla) },
      ],
      rows,
    }));
    noteHost.textContent = [
      "Same Kaplan-Meier median as the headline, per group; “≥” where fewer than half are fixed.",
      splitCutNote(split),
    ].filter(Boolean).join(" ");
  }
  paint();
  return section;
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
 *   groupable        optional `[{key, label}]` (or `(kind) => [...]`): the columns a reader may
 *                    group by. The SERVER groups (`groupBy` → `{groups}`; `groupValue` → that
 *                    group's rows, paged), because a page of fifty cannot count a group.
 */
export async function renderScopedFindings(main, params, spec) {
  const boot = await bootstrap();
  const scope = boot && boot.scope;
  main.append(pageHead("My findings", scope,
    "Every finding in your scope, open first. Read-only: ask the owning team to act on one."));

  const kinds = Array.isArray(spec.kinds) && spec.kinds.length ? spec.kinds : null;
  const groupableFor = (kind) => {
    const g = typeof spec.groupable === "function" ? spec.groupable(kind) : spec.groupable;
    return Array.isArray(g) ? g : [];
  };
  const askedKind = params && params.kind;
  const state = {
    status: params && ["open", "resolved", "all"].indexOf(params.status) >= 0 ? params.status : "open",
    kind: kinds ? (kinds.some((k) => k.value === askedKind) ? askedKind : kinds[0].value) : null,
    page: 0, pageSize: 50, sort: spec.defaultSort, dir: spec.defaultDir || "desc",
    groupBy: "",
  };
  if (params && params.group && groupableFor(state.kind).some((g) => g.key === params.group)) {
    state.groupBy = params.group;
  }
  const pick = (v) => (typeof v === "function" ? v(state.kind) : v);
  /** Groups the reader has opened, by group value; their tables survive a repaint. */
  let expanded = new Map();
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
        // A group-by this register does not carry falls back to no grouping.
        if (!groupableFor(state.kind).some((g) => g.key === state.groupBy)) state.groupBy = "";
        paintGroupSelect();
        expanded = new Map();
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
      expanded = new Map();
      statusBtns.forEach((b, i) => b.setAttribute("aria-pressed",
        ["open", "resolved", "all"][i] === v ? "true" : "false"));
      load(false);
    },
  }, v === "open" ? "Open" : v === "resolved" ? "Resolved" : "All"));
  toolbar.append(el("div", { class: "toolbar-group", role: "group", "aria-label": "State" },
    el("span", { class: "small muted" }, "State"), ...statusBtns));

  // GROUP BY. A native <select>: one choice from a short list, keyboard and screen-reader
  // behaviour for free, and it sits in the toolbar at the same weight as its neighbours.
  const groupSelect = el("select", { "aria-label": "Group findings by", class: "scoped-group-select" });
  groupSelect.addEventListener("change", () => {
    state.groupBy = groupSelect.value;
    state.page = 0;
    expanded = new Map();
    setParams({ ...(params || {}), group: state.groupBy || undefined });
    load(false);
  });
  const groupWrap = el("div", { class: "toolbar-group" },
    el("span", { class: "small muted" }, "Group by"), groupSelect);
  function paintGroupSelect() {
    const opts = groupableFor(state.kind);
    groupSelect.replaceChildren(el("option", { value: "" }, "None"),
      ...opts.map((g) => el("option", { value: g.key }, g.label)));
    groupSelect.value = state.groupBy;
    groupWrap.hidden = !opts.length;
  }
  paintGroupSelect();
  toolbar.append(groupWrap);

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
    if (state.groupBy) p.groupBy = state.groupBy;
    const paintAny = (data) => (state.groupBy && Array.isArray(data.groups) ? paintGroups(data) : paint(data));
    (first ? swrCall(spec.rpc, p) : call(spec.rpc, p)).then((data) => paintAny(data || {})).catch((e) => {
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

  /** A group's label, drawn by the column's OWN cell renderer so "Awaiting vendor" or a
   *  severity badge reads exactly as it does in the ungrouped table. */
  function groupValueCell(g) {
    if (g.raw === null || g.raw === undefined || g.raw === "") return el("span", { class: "muted" }, "(none)");
    const col = pick(spec.columns).find((c) => c.key === state.groupBy);
    const label = col && col.cell ? col.cell({ [state.groupBy]: g.raw }) : String(g.raw);
    // A CVE group links to Wiz's page for that CVE — one place to read how it is exploited
    // before opening its findings. Stops propagation: the row itself toggles the group.
    const cveHref = wizCveUrl(typeof g.raw === "string" ? g.raw : "");
    if (!cveHref) return label;
    return el("span", { class: "scoped-group-label" },
      label,
      el("a", {
        class: "wiz-link", href: cveHref, target: "_blank", rel: "noopener noreferrer",
        "aria-label": `${g.raw} in the Wiz vulnerability database (new tab)`,
        onclick: (e) => e.stopPropagation(),
      }, "Wiz CVE", uiIcon("external", 12)));
  }

  /** One opened group: its own server-paged, server-sorted rows. Built once per open. */
  function groupRowsTable(g) {
    const sub = { page: 0, sort: state.sort, dir: state.dir };
    const box = el("div", { class: "scoped-group-rows" });
    function loadSub() {
      box.replaceChildren(skeletonStack(3));
      call(spec.rpc, {
        ...(spec.baseParams ? spec.baseParams(state.kind) : {}),
        status: state.status, page: sub.page, pageSize: 25, sort: sub.sort, dir: sub.dir,
        groupBy: state.groupBy, groupValue: g.value,
      }).then((data) => {
        const rows = Array.isArray(data.rows) ? data.rows : [];
        sub.page = num(data.page) ?? sub.page;
        sub.sort = data.sort || sub.sort;
        sub.dir = data.dir === "asc" ? "asc" : "desc";
        box.replaceChildren(...[
          dataTable({
            panel: true,
            columns: pick(spec.columns).filter((c) => c.key !== state.groupBy),
            rows,
            sort: { key: sub.sort, descending: sub.dir === "desc" },
            onSort: (key) => {
              sub.dir = sub.sort === key && sub.dir === "desc" ? "asc" : "desc";
              sub.sort = key;
              sub.page = 0;
              loadSub();
            },
            onRowOpen: spec.onRowOpen ? (r) => spec.onRowOpen(r, rows, state.kind) : null,
            rowLabel: spec.rowLabel ? (r) => spec.rowLabel(r, state.kind) : null,
            emptyText: "Nothing in this group under the current filter.",
          }),
          (num(data.pageCount) || 1) > 1
            ? tableFooter({
              page: sub.page, pageCount: num(data.pageCount) || 1,
              total: num(data.total) ?? rows.length, pageSize: 25,
              onPage: (pg) => { sub.page = pg; loadSub(); },
            })
            : null,
        ].filter(Boolean));
      }).catch((e) => {
        box.replaceChildren(errorState("This group could not be loaded.", {
          detail: String((e && e.message) || e), onRetry: loadSub,
        }));
      });
    }
    loadSub();
    return box;
  }

  function paintGroups(data) {
    const groups = data.groups;
    const label = (groupableFor(state.kind).find((g) => g.key === state.groupBy) || {}).label || "Group";
    const draw = () => {
      const table = dataTable({
        columns: [
          {
            key: "value", label,
            cell: (g) => el("span", { class: "scoped-group-head" },
              el("span", { class: "scoped-group-caret", "aria-hidden": "true" }, expanded.has(g.value) ? "▾" : "▸"),
              groupValueCell(g)),
          },
          { key: "worstSeverity", label: "Worst", cell: (g) => (g.worstSeverity ? sevBadge(g.worstSeverity) : "—") },
          { key: "open", label: "Open", className: "num", cell: (g) => (g.open || 0).toLocaleString() },
          { key: "count", label: "Findings", className: "num", cell: (g) => (g.count || 0).toLocaleString() },
          { key: "oldestOpenDays", label: "Oldest open", className: "num",
            cell: (g) => (num(g.oldestOpenDays) === null ? "—" : fmtDays(g.oldestOpenDays)) },
        ],
        rows: groups,
        stickyHeader: true,
        onRowOpen: (g) => {
          if (expanded.has(g.value)) expanded.delete(g.value);
          else expanded.set(g.value, groupRowsTable(g));
          draw();
        },
        rowExpanded: (g) => expanded.has(g.value),
        rowDetail: (g) => expanded.get(g.value) || null,
        rowLabel: (g) => `${g.raw === null ? "(none)" : String(g.raw)}: ${groupLine(g)}`,
        emptyText: state.status === "open" ? "Nothing open in your scope." : "Nothing here.",
      });
      const total = num(data.total) || 0;
      const note = el("p", { class: "small muted" },
        `${groups.length.toLocaleString()} ${groups.length === 1 ? "group" : "groups"} · ` +
        `${total.toLocaleString()} ${total === 1 ? "finding" : "findings"} · worst severity first` +
        (num(data.truncated) ? ` · ${Number(data.truncated).toLocaleString()} smaller groups not shown` : ""));
      host.replaceChildren(note, table);
    };
    draw();
  }

  load(true);
}
