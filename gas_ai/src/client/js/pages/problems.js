// Priorities: every unresolved issue and every open configuration finding, ranked
// together across the whole landscape — outcome first, then asset posture, then how soon it
// is due, then how much it would amplify. `combos.js` scopes issues to one expanded
// toxic-combination pattern; `config.js` scopes findings to the Cloud Configuration
// register. Neither can answer "what do I work on Monday" — this page is the union.
//
// All view state (filters, sort, page) lives in `view`, outside paint(), and is mirrored
// into the hash — the same fix that keeps a background SWR revalidation from silently
// collapsing an open table, which `combos.js`'s own header explains at length.
//
// The server does the real ranking (`src/domain/problems.ts`'s `compareProblems`) and
// ships it already sorted; this page's own column headers offer independent single-key
// sorts on top of that (see `problemView.js`'s header for why it never re-derives the
// server's cascade). "No column selected" — the default on load — means the table reads
// exactly the order `getProblems` sent.

import { bootstrap, setParams, swrCall } from "../store.js";
import { dueChip, openConfigFindingSheet, openIssueSheet } from "../detailSheets.js";
import {
  clear, dataTable, debounce, el, emptyState, errorState, kpiCard, outcomeBadge,
  outcomeLabel, pager, select, selectField, sevBadge, skeleton, statusPill, tierBadge,
  togglePills,
} from "../ui.js";
import {
  PAGE_SIZE, PROBLEM_SORT_DESC,
  applyProblemFilters, problemFilterOptions, problemParamPatch,
  readProblemParams, sortProblems,
} from "./problemView.js";

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
  host.append(problemsSkeleton());

  // Seeded from the URL so a filtered, sorted view is shareable — and held out here so an
  // SWR repaint restores it instead of throwing it away.
  const view = readProblemParams(params);
  let payload = null;

  function persist() {
    setParams(problemParamPatch(view));
  }

  let data;
  try {
    data = await swrCall("api_getProblems", {}, (fresh) => paint(fresh));
  } catch (e) {
    clear(host).append(errorState("Couldn't load priorities.", {
      detail: String((e && e.message) || e),
    }));
    return;
  }
  paint(data);

  // --------------------------------------------------------------------------- paint

  function paint(fresh) {
    payload = fresh;
    clear(host);
    host.append(kpiRow(fresh));
    if (fresh.all) renderAll(fresh); else renderPaged(fresh);
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
        paint(payload);
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
    host.append(problemsSkeleton());
    try {
      const fresh = await swrCall(
        "api_getProblems",
        { outcome: view.outcome, page: view.page, pageSize: PAGE_SIZE },
        (f) => paint(f),
      );
      paint(fresh);
    } catch (e) {
      clear(host).append(errorState("Couldn't load priorities.", {
        detail: String((e && e.message) || e),
      }));
    }
  }

  // ------------------------------------------------------------------------- toolbar

  function toolbar(options, serverPaged) {
    const rerankRemote = () => (serverPaged ? refetch() : paint(payload));

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
        paint(payload); // kind is always client-side, even in paged mode
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
      paint(payload); // search is always client-side, even in paged mode
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
          paint(payload);
        },
        onRowOpen: (r) => openRow(r),
        rowLabel: (r) => (r.kind === "ISSUE" ? "Issue on " : "Finding on ") + r.assetName,
        emptyText: "No problem matches the current filters.",
      }));
  }
}
