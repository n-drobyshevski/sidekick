// Priorities: every unresolved issue and every open configuration finding, ranked
// together across the whole landscape — severity first, then how soon it is due, then how
// long it has been open. `combos.js` scopes issues to one expanded
// toxic-combination pattern; `config.js` scopes findings to the Cloud Configuration
// register. Neither can answer "what do I work on Monday" — this page is the union.
//
// Two register modes now, a `segmented()` switch above the toolbar mirroring `config.js`'s
// own BY CONTROL / BY FINDING pattern for exactly the same reason: 221 open problems on a
// live tenant are mostly the SAME fix repeated across many resources, and the question a
// reader actually has is "which handful of fixes clears the board" — BY ACTION groups
// problems by the remediation that closes them (`src/domain/actions.ts`'s marginal
// set-cover) and is what the page opens on; BY PROBLEM is the original one-row-per-problem
// table, unchanged, for the reader who wants the raw list.
//
// All view state (mode, filters, sort, page, which action rows are expanded) lives in
// `view`, outside paint(), and is mirrored into the hash where it's worth a deep link — the
// same fix that keeps a background SWR revalidation from silently collapsing an open table,
// which `combos.js`'s own header explains at length. Only `mode`/`outcome`/`kind`/`q`/
// `sort`/`dir`/`page` round-trip through the URL (`problemParamPatch`); the action table's
// own filter/sort/expansion state is page-local and ephemeral, the same "not worth a deep
// link" call `complianceOverview.js`'s `weakOpen` Set makes for its own row expansion.
//
// The server does the real ranking for BOTH modes — `compareProblems` for problems,
// `rankActionsByCover` for actions — and ships each already sorted; this page's own column
// headers offer independent single-key sorts on top of that (see `problemView.js`'s and
// `actionView.js`'s headers for why neither re-derives the server's cascade). "No column
// selected" — the default on load, in either mode — means the table reads exactly the
// order the server sent.

import { bootstrap, setParams, swrCall } from "../store.js";
import { dueChip, openConfigFindingSheet, openIssueSheet } from "../detailSheets.js";
import { coverCurve } from "../charts.js";
import {
  absent, clear, dataTable, debounce, el, emptyState, errorState, fmtDate, glossaryTip, heroStat,
  pageHeader, pager, plural, segmented, select, selectField, sevBadge,
  sevEntries, sevSegmentBar, sevSpoken, sheetRow, sheetSection, skeleton, statRow,
  statusPill, tipMark, togglePills,
} from "../ui.js";
import {
  PAGE_SIZE, PROBLEM_SORT_DESC, SEVERITY_RANK,
  applyProblemFilters, problemFilterOptions, problemParamPatch,
  readProblemParams, sortProblems,
} from "./problemView.js";
import {
  ACTION_COMPARATORS, ACTION_SORT_DESC,
  applyActionFilters, actionFilterOptions, sortActions,
} from "./actionView.js";

const SEARCH_DEBOUNCE_MS = 200;

// Placeholder shown until api_getProblems resolves; paint() clears the host. Mirrors the
// real page shape — KPI row, then the toolbar + table — the same "reveal a laid-out page,
// don't grow one" idiom combosSkeleton (combos.js) uses.
function problemsSkeleton() {
  const kpis = el("div", { class: "kpi-row" });
  for (let i = 0; i < 4; i++) {
    kpis.append(el("div", { class: "kpi-card" },
      el("div", { class: "skeleton-stack", style: "gap:9px" },
        skeleton("line", { width: "62%" }),
        skeleton("stat", { width: "45%" }),
        skeleton("line", { width: "78%" }))));
  }
  const bar = el("div", { class: "filter-bar" },
    skeleton("pill", { width: "280px" }),
    skeleton("pill", { width: "120px" }),
    skeleton("line", { width: "220px" }));
  const rows = el("div", { class: "skeleton-stack", style: "margin-top:14px" });
  for (let i = 0; i < 6; i++) rows.append(skeleton("line", { height: "22px" }));
  return el("div", { role: "status", "aria-label": "Loading priorities" }, kpis, bar, rows);
}

/** Same shape, sized for the action table: the headline KPIs, the chart card, then rows. */
function actionsSkeleton() {
  const kpis = el("div", { class: "kpi-row" });
  for (let i = 0; i < 3; i++) {
    kpis.append(el("div", { class: "kpi-card" },
      el("div", { class: "skeleton-stack", style: "gap:9px" },
        skeleton("line", { width: "62%" }),
        skeleton("stat", { width: "45%" }))));
  }
  const chart = el("div", { class: "chart-card" },
    skeleton("line", { width: "220px" }),
    skeleton("line", { height: "200px", width: "100%" }));
  const rows = el("div", { class: "skeleton-stack", style: "margin-top:14px" });
  for (let i = 0; i < 6; i++) rows.append(skeleton("line", { height: "22px" }));
  return el("div", { role: "status", "aria-label": "Loading actions" }, kpis, chart, rows);
}

export async function renderProblems(main, params) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "Priorities"),
    // NINE WORDS. The cascade this page ranks by — Wiz's severity, then how soon it is due,
    // then how long it has been open — is a definition, and DESIGN.md is explicit that a
    // definition belongs in the tip that routes to its Help entry rather than in a paragraph
    // above the thing it describes. The term already existed; only the paragraph was new.
    el("p", { class: "page-sub" },
      "Every open issue and finding, ranked on one scale.",
      glossaryTip(tipMark(), "priorities-rank")),
  );

  if (!boot.latestSync) {
    main.append(emptyState(
      "No sync yet.",
      "Run “Sync now” in the sidebar — without credentials it loads the sample dataset.",
    ));
    return;
  }

  const host = el("div", {});
  main.append(host);
  host.append(actionsSkeleton());

  // Seeded from the URL so a filtered, sorted, moded view is shareable — and held out here
  // so an SWR repaint restores it instead of throwing it away. `openActions` and the
  // action table's own filter/sort fields are page-local additions to the same object —
  // ephemeral, per this file's own header, so they ride along with `view` without ever
  // being read by `problemParamPatch`.
  const view = readProblemParams(params);
  view.openActions = new Set();
  view.aSeverity = "";
  view.aKind = "";
  view.aQ = "";
  view.aSort = "";
  view.aDir = 1;

  let problemsData = null;
  let actionsData = null;

  // The member-list hazard's own cache: the whole `getProblems` union, fetched lazily on
  // the FIRST action row a reader expands, never up front — most opens of this page never
  // expand a single row, and action mode's own fetch already answers the headline and the
  // table without it. See `memberListNode` below for what happens while (or if) this never
  // resolves, and for the `all === false` case it exists to guard against.
  let memberRows = null;
  let memberAll = null;
  let memberFailed = false;
  let memberInFlight = false;

  function persist() {
    setParams(problemParamPatch(view));
  }

  async function loadProblems() {
    clear(host);
    host.append(modeSwitch(), problemsSkeleton());
    try {
      problemsData = await swrCall("api_getProblems", {}, (fresh) => {
        problemsData = fresh;
        if (view.mode === "problems") paint();
      });
    } catch (e) {
      clear(host).append(modeSwitch(), errorState("Couldn't load priorities.", {
        detail: String((e && e.message) || e),
      }));
      return;
    }
    paint();
  }

  async function loadActions() {
    clear(host);
    host.append(modeSwitch(), actionsSkeleton());
    try {
      actionsData = await swrCall("api_getActions", {}, (fresh) => {
        actionsData = fresh;
        if (view.mode === "actions") paint();
      });
    } catch (e) {
      clear(host).append(modeSwitch(), errorState("Couldn't load actions.", {
        detail: String((e && e.message) || e),
      }));
      return;
    }
    paint();
  }

  /** Fetch whatever the CURRENT mode needs, only if it hasn't been fetched yet — a mode
   *  switch reuses what's already in hand rather than re-requesting it every click. */
  function ensureDataForMode() {
    if (view.mode === "problems") {
      if (problemsData) paint();
      else loadProblems();
    } else if (actionsData) {
      paint();
    } else {
      loadActions();
    }
  }

  // --------------------------------------------------------------------------- paint

  function paint() {
    clear(host);
    host.append(modeSwitch());
    if (view.mode === "problems") {
      if (!problemsData) return; // unreached on a real load path; loadProblems() awaits first
      host.append(kpiRow(problemsData));
      if (problemsData.all) renderAll(problemsData); else renderPaged(problemsData);
    } else {
      if (!actionsData) return;
      renderActions(actionsData);
    }
  }

  function modeSwitch() {
    return el("div", { class: "toolbar", style: "margin-bottom:14px" },
      segmented({
        options: [
          { value: "actions", label: "By action" },
          { value: "problems", label: "By problem" },
        ],
        value: view.mode,
        ariaLabel: "Priorities view",
        onChange: (v) => {
          if (v === view.mode) return;
          view.mode = v;
          view.page = 0;
          persist();
          ensureDataForMode();
        },
      }));
  }

  // The four severities that get a headline card. UNKNOWN is not among them: a row Wiz
  // rated UNKNOWN and a row it never rated at all are both "no usable rating", and the
  // Unrated card below counts them together rather than splitting one idea across two.
  const SEVERITY_CARDS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

  /** "CRITICAL" -> "Critical" — a card title, not a badge, so it takes sentence case. */
  function sevLabel(sev) {
    const s = String(sev || "");
    return s ? s.charAt(0) + s.slice(1).toLowerCase() : "";
  }

  // The union by Wiz severity, where this used to be the four decision-tree queues. The
  // cascade that produced them is experimental and lives on the Scoring Models page; what
  // is left is the register's own shape, counted, and it still answers the question the
  // queues were standing in for — how much of this is bad.
  //
  // Unrated rows get a card only when there are any, the same rule the Undecided card
  // followed: nothing in this union is ever dropped for lacking a rating
  // (src/domain/problems.ts's own invariant), so a row Wiz never rated still needs a place
  // on the page rather than silently vanishing from every count.
  function kpiRow(fresh) {
    const counts = fresh.severityCounts || {};
    const total = Number(fresh.total || 0);
    const rated = SEVERITY_CARDS.reduce((n, sev) => n + (counts[sev] || 0), 0);
    const stats = SEVERITY_CARDS.map((sev) =>
      statRow(sevLabel(sev), String(counts[sev] || 0), "open problems", null,
        { term: "severity" }));
    if (total > rated) {
      stats.push(statRow("Unrated", String(total - rated), "no severity from Wiz"));
    }
    // The union's SIZE is the page's subject; the severity split is what qualifies it. As
    // four or five equal .kpi-card tiles this was the hero-metric template PRODUCT.md's
    // anti-references reject, and it left the two modes of one page looking like two
    // different pages. Each level keeps the tip it already carried.
    return pageHeader({
      hero: heroStat("Open problems", String(total), "issues ∪ findings, the whole union"),
      stats,
    });
  }

  // ------------------------------------------------------ all-mode: whole union in hand

  /**
   * Under PROBLEMS_CLIENT_ALL_MAX the server ships every row, already ranked, and every
   * filter/sort/page below runs against the browser's own copy — the exact shape
   * `combos.js`'s issue table already uses for one pattern's rows, applied here to the
   * whole union.
   */
  function renderAll(fresh) {
    const rows = fresh.rows || [];
    const options = problemFilterOptions(rows);
    host.append(toolbar(options, false));

    const filtered = applyProblemFilters(rows, view);
    const sorted = view.sort ? sortProblems(filtered, view.sort, view.dir) : filtered;
    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (view.page >= pageCount) view.page = pageCount - 1;
    const slice = sorted.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);

    if (!sorted.length) {
      host.append(emptyState(
        "No problem matches these filters.",
        "Clear the priority, kind or search filter to see all " + rows.length + ".",
      ));
      return;
    }

    host.append(
      table(slice, filtered.length, rows.length),
      pager(view.page, pageCount, sorted.length, (next) => {
        view.page = next;
        persist();
        paint();
      }),
    );
  }

  // --------------------------------------------------- paged mode: a large landscape only

  /**
   * Past PROBLEMS_CLIENT_ALL_MAX the server already applied the outcome filter and the
   * page; kind and search narrow only what's on screen, and changing the outcome or the
   * page re-fetches — the same degrade `getConfigFindings`'s own paged path accepts for
   * its client-only affordances (its own comment: "the client rebuilds it from the rows
   * it actually holds").
   */
  function renderPaged(fresh) {
    const rows = fresh.rows || [];
    host.append(toolbar(problemFilterOptions(rows), true));

    const filtered = applyProblemFilters(rows, { kind: view.kind, q: view.q });
    const sorted = view.sort ? sortProblems(filtered, view.sort, view.dir) : filtered;

    if (!sorted.length) {
      host.append(emptyState("No problem on this page matches the kind or search filter."));
    } else {
      host.append(table(sorted, filtered.length, rows.length));
    }
    host.append(pager(fresh.page, fresh.pageCount, fresh.filtered, (next) => {
      view.page = next;
      persist();
      refetch();
    }));
  }

  async function refetch() {
    clear(host);
    host.append(modeSwitch(), problemsSkeleton());
    try {
      const fresh = await swrCall(
        "api_getProblems",
        { severity: view.severity, page: view.page, pageSize: PAGE_SIZE },
        (f) => { problemsData = f; if (view.mode === "problems") paint(); },
      );
      problemsData = fresh;
      paint();
    } catch (e) {
      clear(host).append(modeSwitch(), errorState("Couldn't load priorities.", {
        detail: String((e && e.message) || e),
      }));
    }
  }

  // ------------------------------------------------------------------------- toolbar

  function toolbar(options, serverPaged) {
    const rerankRemote = () => (serverPaged ? refetch() : paint());

    const pills = togglePills({
      options: options.severities.map((sv) => ({ value: sv, label: sevLabel(sv) })),
      selected: view.severity,
      ariaLabel: "Filter by severity",
      sevClass: true,
      onToggle: (o) => {
        view.severity = view.severity === o ? "" : o;
        view.page = 0;
        persist();
        rerankRemote();
      },
    });

    const kindField = selectField("Kind", select({
      options: options.kinds.map((k) => ({ value: k, label: k === "ISSUE" ? "Issue" : "Finding" })),
      value: view.kind,
      ariaLabel: "Kind",
      placeholder: "All",
      onChange: (v) => {
        view.kind = v;
        view.page = 0;
        persist();
        paint(); // kind is always client-side, even in paged mode
      },
    }));

    const search = el("input", {
      type: "search",
      value: view.q,
      placeholder: "Rule or asset",
      "aria-label": "Search priorities",
    });
    search.addEventListener("input", debounce(() => {
      view.q = search.value;
      view.page = 0;
      persist();
      paint(); // search is always client-side, even in paged mode
      const refocus = host.querySelector("input[type=search]");
      if (refocus) {
        refocus.focus();
        refocus.setSelectionRange(refocus.value.length, refocus.value.length);
      }
    }, SEARCH_DEBOUNCE_MS));

    const bar = el("div", { class: "filter-bar" }, pills, kindField, el("div", { class: "field" }, search));
    if (view.severity || view.kind || view.q) {
      bar.append(el("button", {
        class: "link",
        onclick: () => {
          view.severity = "";
          view.kind = "";
          view.q = "";
          view.page = 0;
          persist();
          rerankRemote();
        },
      }, "Clear filters"));
    }
    return bar;
  }

  // ---------------------------------------------------------------------------- table

  function openRow(row) {
    if (row.kind === "FINDING") openConfigFindingSheet(row.id);
    else openIssueSheet(row.id, { title: row.title });
  }

  function table(rows, shownCount, totalCount) {
    const COLS = [
      // A column heading is asked once per table, so this is where a metric can be DEFINED
      // by a real control without multiplying the tab order by the row count.
      {
        key: "kind", label: "Kind",
        cell: (r) => statusPill("neutral", r.kind === "ISSUE" ? "Issue" : "Finding"),
      },
      { key: "title", label: "Rule", cell: (r) => r.title },
      { key: "asset", label: "Asset", cell: (r) => r.assetName },
      // Null for an unlinked finding, for the same reason its asset id is — there is no
      // node to read a tag from. Same em dash every other absent cell uses.
      { key: "domain", label: "Domain", cell: (r) => r.domain || absent() },
      { key: "severity", label: "Severity", help: { term: "adjusted-severity" },
        cell: (r) => sevBadge(r.severity) },
      { key: "due", label: "Due", cell: (r) => dueChip(r.dueAt) || absent() },
      // The ranking's third level, shown because a reader should be able to see the order
      // they are being given rather than take it on trust.
      { key: "firstSeen", label: "First seen", cell: (r) => fmtDate(r.firstSeenAt) || absent() },
    ];
    const descending = view.sort && (PROBLEM_SORT_DESC[view.sort] ? view.dir === 1 : view.dir === -1);

    return el("div", {},
      el("div", { class: "filter-meta" },
        el("span", { class: "count" },
          shownCount === totalCount
            ? totalCount + " problem" + (totalCount === 1 ? "" : "s")
            : shownCount + " of " + totalCount)),
      dataTable({
        stickyHeader: true,
        columns: COLS.map((col) => ({
          key: col.key, label: col.label, help: col.help, sortable: true, cell: col.cell,
        })),
        rows,
        sort: view.sort ? { key: view.sort, descending } : null,
        onSort: (key) => {
          view.dir = view.sort === key ? -view.dir : 1;
          view.sort = key;
          view.page = 0;
          persist();
          paint();
        },
        onRowOpen: (r) => openRow(r),
        rowLabel: (r) => (r.kind === "ISSUE" ? "Issue on " : "Finding on ") + r.assetName,
        emptyText: "No problem matches the current filters.",
      }));
  }

  // =====================================================================================
  // action mode
  // =====================================================================================

  function renderActions(data) {
    const total = data.total || 0;
    if (!total) {
      host.append(emptyState(
        "No open problems.",
        "The landscape has nothing to remediate right now — every issue and finding is resolved.",
      ));
      return;
    }

    host.append(actionHeadline(data));

    const rows = data.rows || [];
    const options = actionFilterOptions(rows);
    host.append(actionToolbar(options));

    const filtered = applyActionFilters(rows, {
      severity: view.aSeverity, kind: view.aKind, q: view.aQ,
    });
    const sorted = view.aSort ? sortActions(filtered, view.aSort, view.aDir) : filtered;

    host.append(el("div", { class: "filter-meta" },
      el("span", { class: "count" },
        sorted.length === rows.length
          ? plural(rows.length, "action")
          : sorted.length + " of " + plural(rows.length, "action"))));

    if (!sorted.length) {
      host.append(emptyState(
        "No action matches these filters.",
        "Clear the priority, kind or search filter to see all " + rows.length + ".",
      ));
      return;
    }

    host.append(actionTable(sorted));
  }

  /** "N open problems collapse to M actions — the top 10 close K%." — the self-evidencing
   *  headline this whole feature exists to produce (`concentrationRatio`, actions.ts). */
  function actionHeadline(data) {
    const c = data.concentration || {};
    const problems = c.problems ?? data.totalProblems ?? 0;
    const actions = c.actions ?? data.total ?? 0;
    const pctText = formatShare(c.top10Share);

    const curve = data.curve || [];
    const enough = curve.length >= 3;
    const canvas = el("canvas", {
      "aria-label":
        "Cumulative share of open problems closed as actions are taken, ranked by cover",
      role: "img",
    });
    const aside = el("div", { class: "page-strip" },
      el("div", { class: "kpi-label" }, "Cumulative cover"),
      enough
        ? el("div", { class: "chart-box", style: "height:124px" }, canvas)
        : el("p", { class: "page-hero-sub" },
            "Fewer than three actions close the whole board here."),
    );
    // Laid out before Chart.js measures it, or it reads a 0x0 box — the same reason
    // inventory.js's trend chart defers its draw one frame.
    if (enough) requestAnimationFrame(() => coverCurve(canvas, curve, { yLabel: "" }));

    // The sentence that used to lead here said "N open problems collapse to M actions, the
    // top 10 close K%", and the three tiles beneath it repeated all three of those numbers.
    // The count is the hero, the curve is what qualifies it, the other two are the strip:
    // three levels of emphasis instead of four blocks saying one thing.
    return pageHeader({
      hero: heroStat("Open problems", String(problems), "issues ∪ findings, the whole union"),
      aside,
      stats: [
        statRow("Collapse to", String(actions), "distinct remediation actions"),
        statRow("Top 10 close", pctText, "of every open problem, ranked by cover"),
      ],
    });
  }

  /** 94.7%, not 94.7000000000001% or a bare "95%" that hides how close the top 10 came to
   *  the whole board — one decimal, trimmed only when it would read as ".0". */
  function formatShare(share) {
    const v = Math.round((Number(share) || 0) * 1000) / 10;
    return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + "%";
  }

  function actionToolbar(options) {
    const pills = togglePills({
      options: options.severities.map((sv) => ({ value: sv, label: sevLabel(sv) })),
      selected: view.aSeverity,
      ariaLabel: "Filter by severity",
      sevClass: true,
      onToggle: (o) => {
        view.aSeverity = view.aSeverity === o ? "" : o;
        paint();
      },
    });

    const kindField = selectField("Kind", select({
      options: options.kinds.map((k) => ({ value: k, label: k === "ISSUE" ? "Issue" : "Finding" })),
      value: view.aKind,
      ariaLabel: "Kind",
      placeholder: "All",
      onChange: (v) => {
        view.aKind = v;
        paint();
      },
    }));

    const search = el("input", {
      type: "search",
      value: view.aQ,
      placeholder: "Rule name or id",
      "aria-label": "Search actions",
    });
    search.addEventListener("input", debounce(() => {
      view.aQ = search.value;
      paint();
      const refocus = host.querySelector("input[type=search]");
      if (refocus) {
        refocus.focus();
        refocus.setSelectionRange(refocus.value.length, refocus.value.length);
      }
    }, SEARCH_DEBOUNCE_MS));

    const bar = el("div", { class: "filter-bar" }, pills, kindField, el("div", { class: "field" }, search));
    if (view.aSeverity || view.aKind || view.aQ) {
      bar.append(el("button", {
        class: "link",
        onclick: () => {
          view.aSeverity = "";
          view.aKind = "";
          view.aQ = "";
          paint();
        },
      }, "Clear filters"));
    }
    return bar;
  }

  function actionTable(rows) {
    const COLS = [
      { key: "worstSeverity", label: "Worst", help: { term: "severity" },
        cell: (r) => (r.worstSeverity ? sevBadge(r.worstSeverity) : absent()) },
      { key: "title", label: "Action", cell: (r) => r.title },
      {
        key: "kind", label: "Kind",
        cell: (r) => statusPill("neutral", r.kind === "ISSUE" ? "Issue" : "Finding"),
      },
      { key: "closes", label: "Closes", className: "num", cell: (r) => String(r.problems) },
      { key: "assets", label: "Assets", className: "num", cell: (r) => String(r.assets) },
      {
        key: "severityMix", label: "Severity", sortable: false,
        cell: (r) => {
          const entries = sevEntries(r.severityMix, SEVERITY_RANK);
          return entries.length
            ? sevSegmentBar(entries, { size: "xs", label: sevSpoken(entries) })
            : el("span", { class: "muted small" }, "—");
        },
      },
      {
        // Whose problems this one action collapses. An action spanning three domains is
        // a coordination cost the "N collapse to M" headline hides.
        key: "domains", label: "Domain", sortable: false,
        cell: (r) => ((r.domains || []).length
          ? el("span", {}, r.domains.join(", "))
          : el("span", { class: "muted small" }, "—")),
      },
      {
        key: "impact", label: "Business impact", sortable: false,
        cell: (r) => ((r.businessImpacts || []).length
          ? el("span", {}, r.businessImpacts.join(", "))
          : el("span", { class: "muted small" }, "—")),
      },
      {
        key: "signals", label: "Signals", sortable: false,
        cell: (r) => actionSignalChips(r),
      },
      {
        key: "firstSeen", label: "First seen", cell: (r) => (r.firstSeenAt
          ? el("span", { class: "small" }, fmtDate(r.firstSeenAt))
          : el("span", { class: "small muted" }, "—")),
      },
    ];
    const descending = view.aSort && (ACTION_SORT_DESC[view.aSort] ? view.aDir === 1 : view.aDir === -1);

    return el("div", {},
      // No section label here. The .filter-meta count directly above the table already reads
      // "12 actions" (or "6 of 12 actions" when filtered, which the label could not say), and
      // a heading repeating the same count 30px below it was the page saying one thing twice.
      dataTable({
        stickyHeader: true,
        columns: COLS.map((col) => ({
          key: col.key, label: col.label, help: col.help,
          sortable: col.sortable !== false && !!ACTION_COMPARATORS[col.key],
          className: col.className, cell: col.cell,
        })),
        rows,
        sort: view.aSort ? { key: view.aSort, descending } : null,
        onSort: (key) => {
          view.aDir = view.aSort === key ? -view.aDir : 1;
          view.aSort = key;
          paint();
        },
        onRowOpen: (r) => {
          // Multi-open by design (view.openActions header, above): an analyst comparing
          // two remediations wants both expanded at once, unlike the single-open sheets
          // elsewhere on this app.
          if (view.openActions.has(r.key)) view.openActions.delete(r.key);
          else {
            view.openActions.add(r.key);
            ensureMemberProblemsLoaded();
          }
          paint();
        },
        rowLabel: (r) => r.title + ", " + plural(r.problems, "problem") + " closed",
        rowExpanded: (r) => view.openActions.has(r.key),
        rowDetail: (r) => (view.openActions.has(r.key) ? actionDetail(r) : null),
        emptyText: "No action matches the current filters.",
      }));
  }

  function actionSignalChips(r) {
    const chips = [];
    // "ok", not "good": there is no `.pill.good` in components.css, and statusPill
    // interpolates the kind it is handed — so this chip drew with no fill at all.
    if (r.autoRemediable) chips.push(statusPill("ok", "Auto-remediable"));
    if (r.iac) chips.push(statusPill("neutral", "IaC ×" + r.iac));
    if (r.ignored) chips.push(statusPill("warn", "Ignored ×" + r.ignored));
    if (!chips.length) return el("span", { class: "muted small" }, "—");
    return el("div", { style: "display:flex; gap:6px; flex-wrap:wrap" }, ...chips);
  }

  // ------------------------------------------------------------- action row detail

  function actionDetail(action) {
    return el("div", { class: "action-detail" },
      sheetSection("Remediation",
        action.remediation
          ? el("p", {}, action.remediation)
          : el("p", { class: "muted small" },
              "No rule-level remediation text carried on this action's own rule.")),
      sheetSection(plural(action.problems, "problem") + " this action closes",
        memberListNode(action)));
  }

  /**
   * The member-list hazard, spelled out because it is real (this file's own header names
   * it). `memberRows` is the WHOLE `getProblems` union, fetched once and reused for every
   * action a reader expands — never per-action, since there is no server filter to fetch
   * by rule (`getProblems` only narrows by outcome/page). Filtering it client-side by the
   * same (kind, ruleId, ruleShortId) triple `actionKeyOf` builds is exactly right AS LONG
   * AS that union is the WHOLE union — `memberAll` is what says whether it actually is.
   *
   * When it is not (a tenant past PROBLEMS_CLIENT_ALL_MAX, north of a thousand open
   * problems), the browser is holding exactly one page of it, in outcome/posture/SLA/
   * amplification order — an order that has nothing to do with which rule a row belongs
   * to, so an action's own problems are scattered arbitrarily across however many pages
   * exist. Filtering that one page would silently under-report what the action closes:
   * a "3 of 13" list that reads as complete. Reconstructing the true list would mean
   * walking every page of the union regardless of outcome, which is not a targeted
   * fetch — it is the whole board, paid for just to expand one row. Rather than pay
   * that cost speculatively (and rather than lie with a partial list, which this file's
   * task explicitly forbids), this states the situation plainly and points at the exact,
   * authoritative count the action's own row already carries.
   */
  function memberListNode(action) {
    if (memberFailed) {
      return el("p", { class: "muted small" }, "Couldn't load the problems this action closes.");
    }
    if (memberRows === null) {
      ensureMemberProblemsLoaded();
      return el("div", { role: "status", "aria-label": "Loading problems" },
        skeleton("line", { height: "16px", width: "70%" }));
    }
    if (memberAll === false) {
      return el("p", { class: "muted small" },
        "This landscape holds more open problems than the browser keeps in hand at once, so " +
        "the individual rows can't be listed here without pulling the whole board across " +
        "many requests. The " + plural(action.problems, "problem") + " above is this " +
        "action's own exact count — to see the rows themselves, switch to “By problem” " +
        "and search “" + action.title + "”.");
    }
    const members = memberRows.filter((r) =>
      r.kind === action.kind &&
      (r.ruleId || "") === (action.ruleId || "") &&
      (r.ruleShortId || "") === (action.ruleShortId || ""));
    if (!members.length) {
      return el("p", { class: "muted small" },
        "No matching problem in the current union — the board may have moved since this " +
        "action was ranked. Refresh the page to re-rank.");
    }
    return el("div", { class: "action-members" },
      ...members.map((r) => sheetRow({
        badge: r.severity ? sevBadge(r.severity) : null,
        title: r.title + " on " + r.assetName,
        onOpen: () => openRow(r),
        ariaLabel: (r.kind === "ISSUE" ? "Issue on " : "Finding on ") + r.assetName,
      })));
  }

  /** Fetches the whole `getProblems` union exactly once, lazily, on the first action row a
   *  reader expands — see `memberListNode`'s own header for why there is no per-action
   *  fetch to make instead. Guarded like `combos.js`'s own `loadIssues`: a background SWR
   *  revalidation, or the fetch itself, repaints only if action mode is still showing and
   *  at least one row is still open — "the analyst closed it (or left the page) while we
   *  were fetching" must not repaint a table nobody is looking at any more. */
  function ensureMemberProblemsLoaded() {
    if (memberRows !== null || memberFailed || memberInFlight) return;
    memberInFlight = true;
    swrCall("api_getProblems", {}, (fresh) => {
      // The cache always takes the fresh copy — the same split combos.js's own
      // `loadIssues` keeps between "update what's held" and "repaint what's shown": a
      // revalidation that lands while every action row is closed still refreshes what the
      // NEXT expand will read, it just doesn't repaint a table nobody has open right now.
      memberRows = fresh.rows || [];
      memberAll = !!fresh.all;
      if (view.mode === "actions" && view.openActions.size) paint();
    })
      .then((data) => {
        memberRows = data.rows || [];
        memberAll = !!data.all;
      })
      .catch(() => {
        memberFailed = true;
      })
      .finally(() => {
        memberInFlight = false;
        if (view.mode === "actions" && view.openActions.size) paint();
      });
  }

  // ------------------------------------------------------------------------- kickoff

  if (view.mode === "problems") await loadProblems(); else await loadActions();
}
