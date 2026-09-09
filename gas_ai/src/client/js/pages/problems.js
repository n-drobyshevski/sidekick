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

import { bootstrap, setParams, swrCall } from "../../../../../gas_shared/store.js";
import { dueChip, openConfigFindingSheet, openIssueSheet } from "../detailSheets.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import {
  absent, absentText, chartTable, clear, dataTable, debounce, el, emptyState, errorState,
  fmtCount, fmtDate,
  heroLines, heroStat, measuredEmpty, num, pageHeader, pct1, plural, sectionLabel, segmented,
  select, selectField, sevBadge,
  sevEntries, sevSegmentBar, sevSpoken, sheetRow, sheetSection, skeleton, statRow,
  statusPill, syncCaption, tableFooter, tipLabel, togglePills,
} from "../ui.js";
import { coverTableModel } from "./_charts.js";
import {
  PAGE_SIZE, PROBLEM_SORT_DESC, RANK_REASON_LABEL, SEVERITY_RANK,
  applyProblemFilters, defaultProblemSort, halfLifeView, movementView,
  prioritiesFirstRunView, problemFilterOptions,
  problemParamPatch,
  rankCellModel, rankReasonLines, readProblemParams, sortProblems,
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
  // `pageHeader({ route })`, not a bare `el("h1", ...)` and not a title in the hero VALUE —
  // the same conversion `pages/compliance.js` made, and the same correction. F3 put "Risk"
  // (this route's PAGES lane) in the h1 and "Priorities" in the 2rem hero slot, which left
  // three pages of this lane all announcing "Risk" as their heading. The lane is the eyebrow
  // and the h1 is the route's PAGES title now; the two `heroStat` calls further down carry
  // figures and no `route`, so the page still owns exactly one h1.
  main.append(pageHeader({
    route: "problems",
    // NINE WORDS, unchanged. The cascade this page ranks by — Wiz's severity, then how soon
    // it is due, then how long it has been open — is a definition, and DESIGN.md is explicit
    // that a definition belongs in the tip that routes to its Help entry rather than in a
    // paragraph above the thing it describes. P1.4 moved that tip off the lede (which used to
    // carry it as a second array element) and onto the header's own `help`, the slot every
    // other route's page-title tip already uses.
    lede: "Every open issue and finding, ranked on one scale.",
    help: { term: "priorities-rank" },
  }));

  // Seeded from the URL so a filtered, sorted, moded view is shareable — and held out here
  // so an SWR repaint restores it instead of throwing it away. `openActions` and the
  // action table's own filter/sort fields are page-local additions to the same object —
  // ephemeral, per this file's own header, so they ride along with `view` without ever
  // being read by `problemParamPatch`.
  //
  // READ BEFORE THE FIRST-RUN GATE BELOW, not after it: the one `renderHeader` both modes
  // share reads `view.mode` to choose its stat strip, and the gate calls it too.
  const view = readProblemParams(params);
  view.openActions = new Set();
  // Which problem rows have their "Why this rank" disclosure open, by row id. Page-local and
  // ephemeral like `openActions`, and multi-open for the same reason: comparing why one row
  // outranks another is the question the disclosure exists to answer, and it cannot be asked
  // one row at a time.
  view.openRanks = new Set();
  view.aSeverity = "";
  view.aKind = "";
  view.aQ = "";
  view.aSort = "";
  view.aDir = 1;

  // The front door earns the itemised panel — see problemView.js's own header for why this
  // page gets one and the others get the generic firstRunNotice. `show` is exactly
  // `!boot.latestSync`, so this is the same whole-page gate every other route uses, just
  // drawn with the full unlock list rather than one sentence.
  //
  // THE HEADER IS THE SAME FUNCTION HERE AS ON A SYNCED REGISTER, handed a null payload:
  // `renderHeader` reads `first.show` itself and renders the dash hero over an EMPTY stat
  // strip and no movement aside. A second, first-run-only header block would be a second
  // place for the hero's label to drift from the one beside it.
  const first = prioritiesFirstRunView(boot);
  if (first.show) {
    main.append(renderHeader(view, null));
    main.append(emptyState(first.heading, first.hint, {
      items: first.items,
      variant: "notice",
    }));
    return;
  }

  const host = el("div", {});
  main.append(host);
  host.append(actionsSkeleton());

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

  // One failing section must not blank the rest of the page. Copied from the same shape
  // gas/pages/mttr.js uses: try/render, and on a throw the section's own host gets
  // `errorState` — an alert with a "Technical details" disclosure — rather than the page
  // silently dropping content or the whole route dying on one section's exception.
  function guard(label, sectionHost, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[problems] " + label + " render failed:", e);
      clear(sectionHost).append(errorState("Couldn't render " + label + ".", {
        detail: String((e && e.message) || e),
      }));
    }
  }

  // ONE HEADER, ONE BODY, ONE FOOT — in both modes. The hosts are created here rather than
  // inside each branch so the two modes cannot end up with different page furniture: the
  // header block and the last-sync block belong to the PAGE, and only the middle is a
  // function of which register mode a reader chose.
  function paint() {
    clear(host);
    host.append(modeSwitch());
    const headerHost = el("div", {});
    const bodyHost = el("div", {});
    const footHost = el("div", {});
    host.append(headerHost, bodyHost, footHost);

    const data = view.mode === "problems" ? problemsData : actionsData;
    if (!data) return; // unreached on a real load path; both loaders await before painting
    guard("the header figures", headerHost, () => headerHost.append(renderHeader(view, data)));
    if (view.mode === "problems") {
      guard("the priorities table", bodyHost, () => {
        if (data.all) renderAll(data, bodyHost);
        else renderPaged(data, bodyHost);
      });
    } else {
      guard("the ranked actions", bodyHost, () => renderActions(data, bodyHost));
    }
    guard("the last-sync block", footHost, () => footHost.append(lastSyncBlock()));
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
  // Unrated rows get a row only when there are any, the same rule the Undecided card
  // followed: nothing in this union is ever dropped for lacking a rating
  // (src/domain/problems.ts's own invariant), so a row Wiz never rated still needs a place
  // on the page rather than silently vanishing from every count.
  function severityRows(fresh) {
    const counts = fresh.severityCounts || {};
    // `counts[sev] || 0` stays a bare reducer: it is a census lookup over the fetched union,
    // and a severity nobody has right now IS a measured zero, not an absence. `fresh.total`
    // is a different kind of field — a scalar the server sends once, not derived from a
    // lookup — so it refuses before it casts, the same as every other top-level figure below.
    const total = num(fresh.total);
    const rated = SEVERITY_CARDS.reduce((n, sev) => n + (counts[sev] || 0), 0);
    const rows = SEVERITY_CARDS.map((sev) =>
      statRow(sevLabel(sev), String(counts[sev] || 0), "open problems", null,
        { term: "severity" }));
    if (total !== null && total > rated) {
      rows.push(statRow("Unrated", String(total - rated), "no severity from Wiz"));
    }
    return rows;
  }

  /**
   * The two figures the collapse-to-actions mode adds, and nothing else.
   *
   * `??` already refuses to fall through on a real zero — the terminal fallback is what used
   * to be a bare `0` rather than "never measured". `share` is a 0..1 fraction and `pct1` takes
   * a percentage, so the multiply happens AFTER the refusal, never before: `num(c.top10Share)
   * * 100` on a null share is `null * 100 === 0`, the exact "cast reads a real zero" trap.
   */
  function actionStats(data) {
    const c = data.concentration || {};
    const actions = num(c.actions ?? data.total);
    const top10Share = num(c.top10Share);
    const pctText = top10Share === null ? absentText : pct1(top10Share * 100);
    return [
      statRow("Collapse to", fmtCount(actions), "distinct remediation actions"),
      statRow("Top 10 close", pctText, "of every open problem, ranked by cover"),
    ];
  }

  /**
   * How many open problems there are, read from whichever payload is in hand.
   *
   * THE TWO ENDPOINTS SPELL IT DIFFERENTLY AND THE DIFFERENCE MATTERS. `getProblems.total`
   * is the union; `getActions.total` is the count of distinct ACTIONS, and the union arrives
   * there as `concentration.problems` (with `totalProblems` as its twin). Reading `.total`
   * in both modes would put the action count under the label "Open problems" and make one
   * page state two different sizes for one population.
   */
  function openProblemCount(activeView, data) {
    if (activeView.mode === "problems") return num(data.total);
    const c = data.concentration || {};
    return num(c.problems ?? data.totalProblems);
  }

  /**
   * ONE HEADER, BOTH MODES, AND THE FIRST RUN.
   *
   * The two modes used to build their own header each — the pre-wave `kpiRow` and
   * `actionHeadline` — and this file's own comment already named the result as a defect:
   * "it left the two modes of one page looking like two different pages". They differed in
   * the hero LABEL, in whether there was an aside at all, and in the stat strip; only the
   * last of those is a real function of the mode, and it is the only one that varies here.
   *
   * THE HERO IS THE HALF-LIFE, not the count. The count is a census the table below already
   * shows in full; the half-life is the one figure on this page that says whether the
   * register is getting anywhere, and it is the exact survival estimate `measureSpec.ts`
   * refused to publish until `issueSurvival.ts` existed. "Open problems" keeps its place as
   * the first stat row, in both modes.
   *
   * A NULL `data` IS THE FIRST RUN. `halfLifeView(undefined)` returns `absentText`, which
   * `heroStat` promotes to the muted dash (a bare null would render an EMPTY hero value —
   * measured, see that function's own header), and `first.show` empties the strip and drops
   * the aside: a row of zeros over a register nobody has synced would be four measurements
   * nobody took, and the panel below already names what each of them waits on.
   */
  function renderHeader(activeView, data) {
    const hl = halfLifeView(data && data.halfLife);
    return pageHeader({
      // NO `route`, SO NO h1: the page's heading is in the header above this one.
      hero: heroStat(
        "Issue half-life",
        hl.value,
        hl.asOfNote ? heroLines(hl.qualifier, hl.asOfNote) : hl.qualifier,
        { term: "half-life" },
      ),
      aside: first.show ? null : renderMovement(data && data.movement),
      stats: first.show ? [] : [
        // NO `help` ON THIS ROW, deliberately. `priorities-rank` is the obvious term and it
        // is pinned as EXPERIMENTAL and drawn only on the Scoring Models page
        // (helpContent.js, and test/helpContent.test.js holds `drawnOn` to exactly that), so
        // hanging it here would make the key sheet hide a definition this row points at. The
        // sub-line already says what the figure counts.
        statRow("Open problems", fmtCount(openProblemCount(activeView, data)),
          "issues ∪ findings, the whole union"),
        ...(activeView.mode === "problems" ? severityRows(data) : actionStats(data)),
      ],
    });
  }

  /**
   * One movement row: the label, the chip, and the pair the chip is FROM.
   *
   * THE GLYPH NEVER CARRIES THE MEANING. The triangle is `aria-hidden` and the pill's own
   * visible text spells the direction in words ("down 2", "up 14", "unchanged"), so neither
   * the shape nor the tint is the only cue — the same rule every severity mark on this page
   * follows.
   */
  function movementRow(r) {
    const glyph = r.chip.direction === "up" ? "▲" : r.chip.direction === "down" ? "▼" : "=";
    return el("div", { class: "movement-row" },
      el("span", { class: "movement-label small" }, r.label),
      el("span", {
        class: "pill " + r.chip.kind,
        "aria-label": r.label + ", " + r.chip.word,
      }, el("span", { "aria-hidden": "true" }, glyph), " " + r.chip.word),
      // THE ENDPOINT RIDES WITH THE PAIR, on the row's own line. It was a separate muted
      // line under each row for one measured pass, and at 1280 that line sat in the same
      // uniform grid gap as the next row's label, where an unindented sentence between two
      // rows reads as a caption for the row BELOW it. It cannot become one shared caption
      // either: the two rows reach back to different dates.
      el("span", { class: "small muted movement-counts" },
        r.dates ? r.text + " · " + r.dates : r.text));
  }

  /**
   * The movement aside: what the open ISSUE backlog did, and the reasons it cannot say more.
   *
   * Every sentence here comes out of `movementView` (problemView.js), which is where the
   * claims are testable without a DOM. This function decides only how they look.
   */
  function renderMovement(movement) {
    const model = movementView(movement);
    const box = el("div", { class: "page-strip" },
      el("div", { class: "kpi-label" }, tipLabel("Movement", { term: "movement" })));
    if (model.rows.length) {
      box.append(el("div", { class: "movement-rows" }, ...model.rows.map(movementRow)));
    }
    for (const note of model.notes) box.append(el("div", { class: "small muted" }, note));
    return box;
  }

  /**
   * When the register last looked, and where to read what it found.
   *
   * THE CONTROL TO LOOK AGAIN IS THE RAIL'S SYNC NOW BUTTON — one button in one place, so a
   * reader is never offered two that could disagree about what is already running. This
   * block answers what the rail's own caption does not: which pages hold the detail behind
   * the freshness line. A cross-link is a link, not a sentence about a link.
   */
  function lastSyncBlock() {
    const box = el("div", {});
    box.append(sectionLabel("Last sync", { term: "sync" }));
    box.append(el("p", { class: "scan-caption" },
      syncCaption(boot.latestSync && boot.latestSync.finished_at)));
    // A STATE, DRAWN AS A STATE. "Dry run" is what these figures ARE, and a pill is the
    // component this design system already has for a state: two words plus a tint, with the
    // sentence behind it.
    if (!boot.hasCredentials) {
      box.append(el("p", { class: "small muted" }, statusPill("neutral", "Dry run", {
        lines: ["No Wiz credentials; syncs load the sample dataset."],
      })));
    }
    box.append(el("p", { class: "small muted" },
      el("a", { class: "linklike", href: "#/data" }, "sync history"),
      " · ",
      el("a", { class: "linklike", href: "#/scans" }, "what each scan area reported")));
    return box;
  }

  // ------------------------------------------------------ all-mode: whole union in hand

  /**
   * Under PROBLEMS_CLIENT_ALL_MAX the server ships every row, already ranked, and every
   * filter/sort/page below runs against the browser's own copy — the exact shape
   * `combos.js`'s issue table already uses for one pattern's rows, applied here to the
   * whole union.
   */
  function renderAll(fresh, target) {
    const rows = fresh.rows || [];
    const options = problemFilterOptions(rows);
    target.append(toolbar(options, false));

    const filtered = applyProblemFilters(rows, view);
    const sorted = view.sort ? sortProblems(filtered, view.sort, view.dir) : filtered;
    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (view.page >= pageCount) view.page = pageCount - 1;
    const slice = sorted.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);

    if (!sorted.length) {
      target.append(measuredEmpty(
        "No problem matches these filters.",
        {
          at: boot.latestSync.finished_at,
          hint: "Clear the priority, kind or search filter to see all " + rows.length + ".",
        },
      ));
      return;
    }

    target.append(
      table(slice, filtered.length, rows.length),
      tableFooter({
        page: view.page,
        pageCount,
        total: sorted.length,
        onPage: (next) => {
          view.page = next;
          persist();
          paint();
        },
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
  function renderPaged(fresh, target) {
    const rows = fresh.rows || [];
    target.append(toolbar(problemFilterOptions(rows), true));

    const filtered = applyProblemFilters(rows, { kind: view.kind, q: view.q });
    const sorted = view.sort ? sortProblems(filtered, view.sort, view.dir) : filtered;

    if (!sorted.length) {
      target.append(measuredEmpty("No problem on this page matches the kind or search filter.", {
        at: boot.latestSync.finished_at,
      }));
    } else {
      target.append(table(sorted, filtered.length, rows.length));
    }
    target.append(tableFooter({
      page: fresh.page,
      pageCount: fresh.pageCount,
      total: fresh.filtered,
      onPage: (next) => {
        view.page = next;
        persist();
        refetch();
      },
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
        help: { lines: [
          "Whether this row is a Wiz issue or a Cloud Configuration finding — the two " +
          "populations Priorities unions into one queue.",
        ] },
        cell: (r) => statusPill("neutral", r.kind === "ISSUE" ? "Issue" : "Finding"),
      },
      {
        key: "title", label: "Rule",
        help: { lines: ["The Wiz rule or policy this row failed."] },
        cell: (r) => r.title,
      },
      {
        key: "asset", label: "Asset",
        help: { lines: ["The AI asset this row is attached to, blank for an unlinked finding."] },
        cell: (r) => r.assetName,
      },
      // Null for an unlinked finding, for the same reason its asset id is — there is no
      // node to read a tag from. Same em dash every other absent cell uses.
      {
        key: "domain", label: "Domain",
        help: { lines: ["Which Wiz/Domain tag the affected asset carries."] },
        cell: (r) => r.domain || absent(),
      },
      { key: "severity", label: "Severity", help: { term: "adjusted-severity" },
        cell: (r) => sevBadge(r.severity) },
      {
        key: "due", label: "Due",
        help: { lines: [
          "The SLA verdict for this row's due date — Overdue, Due soon or on track — " +
          "against Wiz's own deadline. Blank means Wiz set no deadline, not that one was met.",
        ] },
        cell: (r) => dueChip(r.dueAt) || absent(),
      },
      // The ranking's third level, shown because a reader should be able to see the order
      // they are being given rather than take it on trust.
      {
        key: "firstSeen", label: "First seen", help: { term: "first-seen" },
        cell: (r) => fmtDate(r.firstSeenAt) || absent(),
      },
      // The minimal model's own number, and the clauses behind it. Last column on purpose:
      // it is the newest reading on this row and the one a reader is least likely to be
      // looking for, and putting it left of Wiz's own severity would imply a precedence the
      // shipped default (`rank_leads_sort` off) does not give it.
      {
        key: "rank", label: "Rank", className: "num",
        help: { lines: [
          "The experimental blended score — rule, clock, exploitation, adjacency — defined " +
          "on the Scoring Models page. Nothing here sorts or filters by it unless Rank leads " +
          "is turned on in Settings.",
        ] },
        cell: (r) => rankCell(r),
      },
    ];
    // Which column reads as the active sort when the reader has chosen none: the server sends
    // one of two orders now, and an unmarked header cannot say which one arrived.
    const leadKey = defaultProblemSort(problemsData && problemsData.rankLeadsSort);
    const activeKey = view.sort || leadKey;
    const descending = activeKey
      && (PROBLEM_SORT_DESC[activeKey]
        ? (view.sort ? view.dir === 1 : true)
        : view.dir === -1);

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
        sort: activeKey ? { key: activeKey, descending } : null,
        onSort: (key) => {
          view.dir = view.sort === key ? -view.dir : 1;
          view.sort = key;
          view.page = 0;
          persist();
          paint();
        },
        onRowOpen: (r) => openRow(r),
        rowLabel: (r) => (r.kind === "ISSUE" ? "Issue on " : "Finding on ") + r.assetName,
        // The disclosure lives in the rank CELL, not on the row: activating a problem row
        // opens its record sheet, and a row that meant two things by one press would be
        // offering a reader a coin flip. data.js's own key handler is written for exactly
        // this — it ignores Enter and Space from a focused descendant so a cell can hold its
        // own control, the same shape the config register's rule tip already uses.
        rowDetail: (r) => (view.openRanks.has(r.id) ? rankDetail(r) : null),
        emptyText: "No problem matches the current filters.",
      }));
  }

  /**
   * The rank cell: the score, a word where the clock behind it was not measured, and the
   * disclosure that opens the clauses.
   *
   * The untimed note is a WORD in an `.sr-only` span plus a visible em dash rather than a
   * tint: a score computed from fewer terms than the rule asked for is a different claim
   * about a similar-looking number, and colour alone never carries a claim here.
   */
  function rankCell(r) {
    const model = rankCellModel(r);
    const parts = [el("span", {}, model.score)];
    if (model.untimed) {
      parts.push(el("span", { class: "muted", "aria-hidden": "true" }, " —"));
      parts.push(el("span", { class: "sr-only" }, ", " + model.note));
    }
    if (!model.scored || !rankReasonLines(r).length) {
      return el("span", {}, ...parts);
    }
    const open = view.openRanks.has(r.id);
    return el("span", {},
      ...parts,
      el("button", {
        class: "link",
        // NAMED PER ROW. Twenty-five buttons all reading "Why" is one control repeated, not
        // twenty-five controls, to anyone navigating by the button list — the visible word is
        // short because the column is narrow, and the accessible name carries the row.
        "aria-label": (open ? "Hide why this rank: " : RANK_REASON_LABEL + ": ")
          + r.title + " on " + r.assetName,
        "aria-expanded": String(open),
        onclick: (e) => {
          // The row is a button too, and this one sits inside it.
          e.stopPropagation();
          if (open) view.openRanks.delete(r.id);
          else view.openRanks.add(r.id);
          paint();
        },
      }, open ? "Hide why" : "Why"));
  }

  /** The clauses that produced the score, one line each, in the model's own blend order. */
  function rankDetail(r) {
    const lines = rankReasonLines(r);
    return el("div", { class: "action-detail" },
      sheetSection(RANK_REASON_LABEL,
        lines.length
          ? el("ul", { class: "small" }, ...lines.map((line) => el("li", {}, line)))
          : el("p", { class: "muted small" },
              "The model read nothing on this row, so it ranked by the rule weight alone.")));
  }

  // =====================================================================================
  // action mode
  // =====================================================================================

  function renderActions(data, target) {
    const total = data.total || 0;
    if (!total) {
      target.append(measuredEmpty(
        "No open problems.",
        {
          at: boot.latestSync.finished_at,
          hint: "The landscape has nothing to remediate right now — every issue and finding "
            + "is resolved.",
        },
      ));
      return;
    }

    target.append(coverCard(data));

    const rows = data.rows || [];
    const options = actionFilterOptions(rows);
    target.append(actionToolbar(options));

    const filtered = applyActionFilters(rows, {
      severity: view.aSeverity, kind: view.aKind, q: view.aQ,
    });
    const sorted = view.aSort ? sortActions(filtered, view.aSort, view.aDir) : filtered;

    target.append(el("div", { class: "filter-meta" },
      el("span", { class: "count" },
        sorted.length === rows.length
          ? plural(rows.length, "action")
          : sorted.length + " of " + plural(rows.length, "action"))));

    if (!sorted.length) {
      target.append(measuredEmpty(
        "No action matches these filters.",
        {
          at: boot.latestSync.finished_at,
          hint: "Clear the priority, kind or search filter to see all " + rows.length + ".",
        },
      ));
      return;
    }

    target.append(actionTable(sorted));
  }

  /**
   * The cumulative-cover curve, IN THE BODY rather than in the header aside.
   *
   * It used to be the header's aside, beside a hero reading the same union count the strip
   * repeated — and the aside slot is now the movement reading, which qualifies the hero
   * (the half-life) rather than restating a figure below it. A curve over the ranked list is
   * a picture OF THE LIST, so it belongs where the list is: a `chart-card` opening the
   * action body, the same card shape `inventory.js`'s own trends take.
   *
   * BELOW THREE ACTIONS THERE IS NO CURVE, and the card says so instead of drawing an empty
   * box. No canvas is created on that path either: a `chartTable` over a dangling,
   * unattached canvas would wire `aria-details` to a node nothing on screen points at.
   */
  function coverCard(data) {
    const curve = data.curve || [];
    if (curve.length < 3) {
      return el("div", { class: "chart-card" },
        el("h3", {}, "Cumulative cover"),
        el("p", { class: "chart-note" },
          "Fewer than three actions close the whole board here."));
    }
    const canvas = el("canvas", {
      "aria-label":
        "Cumulative share of open problems closed as actions are taken, ranked by cover",
      role: "img",
    });
    const card = el("div", { class: "chart-card" },
      el("h3", {}, "Cumulative cover"),
      el("p", { class: "chart-note" },
        "How much of the board each further action closes, ranked by cover"),
      el("div", { class: "chart-box", style: "height:200px" }, canvas),
      // THE SAME `curve` THE CHART WRAPPER READS BELOW, named once above and handed to
      // both — `gas_shared/ui/chartTable.js`'s one rule.
      chartTable({ canvas, caption: "Cumulative cover", model: coverTableModel(curve) }));
    // Laid out before Chart.js measures it, or it reads a 0x0 box — the same reason
    // inventory.js's trend chart defers its draw one frame. The rAF waits on the bundle as
    // well: Chart.js is fetched on the first route that draws a chart rather than shipped
    // with every one, and if this deployment's policy will not run it, the card keeps its
    // heading, its note and its figures table and says so. See chartsLoader.js.
    loadCharts().then((charts) => {
      if (!canvas.isConnected) return;
      requestAnimationFrame(() => charts.coverCurve(canvas, curve, { yLabel: "" }));
    }).catch(() => {
      if (!canvas.isConnected) return;
      chartUnavailable(canvas);
    });
    return card;
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
      {
        key: "title", label: "Action",
        help: { lines: [
          "The remediation this row collapses one or more problems into — a rule fix, a " +
          "control change, one action that closes every problem sharing it.",
        ] },
        cell: (r) => r.title,
      },
      {
        key: "kind", label: "Kind",
        help: { lines: [
          "Whether this action closes a Wiz issue, a Cloud Configuration finding, or both — " +
          "the two populations Priorities unions into one queue.",
        ] },
        cell: (r) => statusPill("neutral", r.kind === "ISSUE" ? "Issue" : "Finding"),
      },
      {
        key: "closes", label: "Closes", className: "num",
        help: { lines: ["How many open problems this one action would close at once."] },
        cell: (r) => String(r.problems),
      },
      {
        key: "assets", label: "Assets", className: "num",
        help: { lines: ["How many distinct assets this action touches."] },
        cell: (r) => String(r.assets),
      },
      {
        key: "severityMix", label: "Severity", sortable: false,
        help: { lines: ["The severity mix across every problem this action collapses, worst first."] },
        cell: (r) => {
          const entries = sevEntries(r.severityMix, SEVERITY_RANK);
          return entries.length
            ? sevSegmentBar(entries, { size: "xs", label: sevSpoken(entries) })
            : absent();
        },
      },
      {
        // Whose problems this one action collapses. An action spanning three domains is
        // a coordination cost the "N collapse to M" headline hides.
        key: "domains", label: "Domain", sortable: false,
        help: { lines: ["Which Wiz/Domain tags the affected assets carry."] },
        cell: (r) => ((r.domains || []).length
          ? el("span", {}, r.domains.join(", "))
          : absent()),
      },
      {
        key: "impact", label: "Business impact", sortable: false,
        help: { lines: ["Which business-impact tags Wiz attached to the assets this action touches."] },
        cell: (r) => ((r.businessImpacts || []).length
          ? el("span", {}, r.businessImpacts.join(", "))
          : absent()),
      },
      {
        key: "signals", label: "Signals", sortable: false,
        help: { lines: [
          "The risk signals behind this action's problems — exploitation evidence, adjacency " +
          "to the AI estate, a missing guardrail.",
        ] },
        cell: (r) => actionSignalChips(r),
      },
      {
        key: "firstSeen", label: "First seen", help: { term: "first-seen" },
        cell: (r) => (r.firstSeenAt
          ? el("span", { class: "small" }, fmtDate(r.firstSeenAt))
          : absent()),
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
    if (!chips.length) return absent();
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
