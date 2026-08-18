// Priorities: every unresolved issue and every open configuration finding, ranked
// together across the whole landscape — outcome first, then asset posture, then how soon it
// is due, then how much it would amplify. `combos.js` scopes issues to one expanded
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
  clear, dataTable, debounce, el, emptyState, errorState, fmtDate, kpiCard, outcomeBadge,
  outcomeLabel, pager, plural, sectionLabel, segmented, select, selectField, sevBadge,
  sevEntries, sevSegmentBar, sevSpoken, sheetRow, sheetSection, skeleton, statusPill,
  tierBadge, togglePills,
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
    el("p", { class: "page-sub" },
      "Every unresolved issue and every open configuration finding, ranked together on " +
      "one scale: outcome first, then the asset's posture tier, then how soon it is due, " +
      "then how much it would amplify if it went wrong."),
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
  view.aOutcome = "";
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

  function kpiRow(fresh) {
    const counts = fresh.outcomeCounts || {};
    const undecided = counts[""] || 0;
    const cards = [
      kpiCard("Act", String(counts.ACT || 0), "a human interrupts today"),
      kpiCard("Attend", String(counts.ATTEND || 0), "on this week's plan"),
      kpiCard("Track ★", String(counts.TRACK_STAR || 0), "an unresolved coverage gap"),
      kpiCard("Track", String(counts.TRACK || 0), "no action implied"),
    ];
    if (undecided) {
      // Nothing in this union is ever dropped for lacking a verdict (src/domain/problems.ts's
      // own invariant) — an undecided row still needs a place on the page rather than
      // silently vanishing from every count.
      cards.push(kpiCard("Undecided", String(undecided), "never reached a verdict"));
    }
    return el("div", { class: "kpi-row" }, ...cards);
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
        { outcome: view.outcome, page: view.page, pageSize: PAGE_SIZE },
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
      options: options.outcomes.map((o) => ({ value: o, label: outcomeLabel(o) })),
      selected: view.outcome,
      ariaLabel: "Filter by priority",
      sevClass: false,
      onToggle: (o) => {
        view.outcome = view.outcome === o ? "" : o;
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
    if (view.outcome || view.kind || view.q) {
      bar.append(el("button", {
        class: "link",
        onclick: () => {
          view.outcome = "";
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
      { key: "priority", label: "Priority", cell: (r) => outcomeBadge(r.problemOutcome) },
      {
        key: "kind", label: "Kind",
        cell: (r) => statusPill("neutral", r.kind === "ISSUE" ? "Issue" : "Finding"),
      },
      { key: "title", label: "Rule", cell: (r) => r.title },
      { key: "asset", label: "Asset", cell: (r) => r.assetName },
      { key: "posture", label: "Posture", cell: (r) => tierBadge(r.postureTier) },
      { key: "severity", label: "Severity", cell: (r) => sevBadge(r.severity) },
      { key: "due", label: "Due", cell: (r) => dueChip(r.dueAt) || "—" },
    ];
    const descending = view.sort && (PROBLEM_SORT_DESC[view.sort] ? view.dir === 1 : view.dir === -1);

    return el("div", {},
      el("div", { class: "filter-meta" },
        el("span", { class: "count" },
          shownCount === totalCount
            ? totalCount + " problem" + (totalCount === 1 ? "" : "s")
            : shownCount + " of " + totalCount)),
      dataTable({
        columns: COLS.map((col) => ({
          key: col.key, label: col.label, sortable: true, cell: col.cell,
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
        "The estate has nothing to remediate right now — every issue and finding is resolved.",
      ));
      return;
    }

    host.append(actionHeadline(data), coverChartCard(data));

    const rows = data.rows || [];
    const options = actionFilterOptions(rows);
    host.append(actionToolbar(options));

    const filtered = applyActionFilters(rows, {
      outcome: view.aOutcome, kind: view.aKind, q: view.aQ,
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
    const sentence = plural(problems, "open problem") + " collapse to " +
      plural(actions, "action") + " — the top 10 close " + pctText + ".";

    return el("div", { style: "margin-bottom:14px" },
      el("p", { class: "page-sub", style: "font-size:15px; font-weight:500; color:var(--ink)" },
        sentence),
      el("div", { class: "kpi-row" },
        kpiCard("Open problems", String(problems), "issues ∪ findings, the whole union"),
        kpiCard("Collapse to", String(actions), "distinct remediation actions"),
        kpiCard("Top 10 close", pctText, "of every open problem, ranked by cover")));
  }

  /** 94.7%, not 94.7000000000001% or a bare "95%" that hides how close the top 10 came to
   *  the whole board — one decimal, trimmed only when it would read as ".0". */
  function formatShare(share) {
    const v = Math.round((Number(share) || 0) * 1000) / 10;
    return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + "%";
  }

  /** The `.chart-card`/`.chart-note`/`.chart-box` shell `inventory.js`'s trend chart uses,
   *  degrading to `.chart-empty` below ~3 actions the same way that chart degrades below 2
   *  syncs — a curve with one or two points has no shape worth drawing. */
  function coverChartCard(data) {
    const curve = data.curve || [];
    const enough = curve.length >= 3;
    const canvas = el("canvas", {
      "aria-label": "Cumulative share of open problems closed as actions are taken, ranked by cover",
      role: "img",
    });

    const card = el("div", { class: "chart-card", style: "margin-bottom:16px" },
      el("h3", {}, "Cumulative cover"),
      el("p", { class: "chart-note" },
        enough
          ? plural(curve.length, "ranked action")
          : "Too few actions to shape a curve"),
      enough
        ? el("div", { class: "chart-box", style: "height:220px" }, canvas)
        : el("div", { class: "chart-empty", role: "status" },
            "Fewer than three actions close the whole board here — there is no curve to draw."),
    );

    if (enough) {
      // The canvas must be laid out before Chart.js measures it, or it reads a 0×0 box —
      // the same reason inventory.js's own trend chart defers its draw one frame.
      requestAnimationFrame(() => coverCurve(canvas, curve));
    }

    return card;
  }

  function actionToolbar(options) {
    const pills = togglePills({
      options: options.outcomes.map((o) => ({ value: o, label: outcomeLabel(o) })),
      selected: view.aOutcome,
      ariaLabel: "Filter by priority",
      sevClass: false,
      onToggle: (o) => {
        view.aOutcome = view.aOutcome === o ? "" : o;
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
    if (view.aOutcome || view.aKind || view.aQ) {
      bar.append(el("button", {
        class: "link",
        onclick: () => {
          view.aOutcome = "";
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
      { key: "priority", label: "Priority", cell: (r) => outcomeBadge(r.worstOutcome) },
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
      sectionLabel(plural(rows.length, "action") + ", ranked by cover"),
      dataTable({
        columns: COLS.map((col) => ({
          key: col.key, label: col.label,
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
    if (r.autoRemediable) chips.push(statusPill("good", "Auto-remediable"));
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
        "This estate holds more open problems than the browser keeps in hand at once, so " +
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
        badge: outcomeBadge(r.problemOutcome),
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
