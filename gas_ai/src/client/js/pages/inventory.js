// AI Inventory: the landscape's posture up top, a faceted filter drawer, and the asset
// register as a sortable table or a card grid. Row click opens the shared asset sheet;
// "Open in graph" deep-links.
//
// The page never holds the whole landscape unless it's cheap to. api_getAssets answers with
// every row (`all: true`) only while the inventory fits under the server's row ceiling —
// then the filters, the sort, the pager and the facet counts all run in the browser with
// no further RPCs, which is what a Google Apps Script round trip per keystroke deserves.
// Past the ceiling it answers one page at a time and the same controls become server round
// trips: search is debounced harder, a filter change resets to page 1, and each page and
// its facet counts are fetched on demand.
//
// Either way the posture header and the filter vocabulary describe the WHOLE inventory,
// not the page and not the filtered subset — the server aggregates them once per sync, so
// they stay honest when the client is holding 50 rows out of 5,000.
//
// The filter/sort/facet logic itself lives in ../assetQuery.js, a hand-kept mirror of
// src/domain/assetTable.ts that test/assetQueryMirror.test.ts holds to it.

import { bootstrap, buildHash, listJoin, navigate, setParams, swrCall } from "../store.js";
import { SAVED_VIEW_KEYS, readSavedViews } from "../savedViews.js";
import { openAssetSheet } from "../detailSheets.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import {
  CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, kindIconSvg, kindLabel,
} from "../icons.js";
import { facetGroup, filterUI } from "../filters.js";
import {
  ADJACENCY_SERIES, EXPLOITATION_SERIES, adjacencyPointNotes, capacityReadout,
  categorySeries, exploitationPointNotes, gappySeries, labelList, presentSeries, seriesData,
} from "../postureTrendModel.js";
import {
  ASSET_FLAGS, DEFAULT_SORT_DIR, FACET_KEYS,
  facetCounts, filterAssetRows, pageOf, resolveAssetQuery, sortAssetRows,
} from "../assetQuery.js";
import {
  absent, clear, closeActiveSheet, confirmDialog, dataTable, debounce, el,
  emptyState, errorState,
  DEFAULT_PAGE_SIZE, PAGE_SIZES, fmtDate, kpiCard, plural,
  nameCell, sectionLabel, sevBadge, sevEntries, sevKeyRow,
  sevSegmentBar, sevSpoken, skeleton, skeletonStack, statRow, tableFooter, toast,
  trendScopeNote,
} from "../ui.js";

import { tipAnchor } from "../ui.js";

/** Every issue severity the strip can show. An asset with no open issue carries no
 *  severity at all and belongs to no segment — it is counted in the strip's note instead,
 *  which is the honest place for "these have nothing wrong that we found". */
const STRIP_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

const FLAG_LABELS = {
  combo: "In a toxic combination",
  guardrail: "Missing a guardrail",
  agentic: "Agentic identity",
  datafindings: "Reaches classified data",
};

const FACET_LABELS = {
  severities: "Issue severity",
  kinds: "Asset kind",
  clouds: "Cloud",
  regions: "Region",
  projects: "Project",
  domains: "Domain",
  flags: "Risk signals",
};

/** Which columns can be sorted, and what each one is called in the header. */
const COLUMNS = [
  { key: "name", label: "Name", sort: "name" },
  { key: "kind", label: "Kind", sort: "kind" },
  { key: "cloud", label: "Cloud", sort: "cloud" },
  { key: "region", label: "Region", sort: "region" },
  // The two counts, and the column that says how bad the worst of them is. Three columns
  // rather than one graded verdict: "4 open issues, worst of them HIGH, and 2 failing
  // controls" is three facts a reader can check against Wiz, where a single 0-100 score
  // was one number they had to take on trust. Sorting by "Issues" sorts by the COUNT and
  // by "Severity" by the worst — the same split, offered twice, because both are real
  // questions and neither implies the other.
  { key: "severity", label: "Severity", sort: "severity" },
  { key: "issues", label: "Issues", sort: "issues" },
  { key: "findings", label: "Cloud findings", sort: "findings" },
  { key: "combos", label: "Toxic combo", sort: "combos" },
  { key: "guardrail", label: "Guardrail", sort: null },
  // The owning business domain, off the resource's own Wiz/Domain tag. Sortable because
  // it is an identity column like Cloud and Region, and read the same way: A-Z first.
  { key: "domain", label: "Domain", sort: "domain" },
  { key: "projects", label: "Projects", sort: null },
  { key: "actions", label: "", sort: null },
];

const VIEWS_KEY = SAVED_VIEW_KEYS.inventory;
/** Params a saved view carries. Never `page` (a view opens at the top) and never `panel`. */
const VIEW_PARAMS = [
  "q", "severities", "kinds", "clouds", "regions", "projects", "domains", "flags",
  "sort", "dir", "view", "size",
];

// -------------------------------------------------------------------- small helpers

/**
 * Open issues on this asset, split by severity. The row's severity badge says which is
 * worst; this says how many of each, which is the difference between one stray HIGH and
 * a pile of them. Both come from the same issue rows, so they cannot disagree.
 */
function issueBars(counts, noun) {
  const entries = sevEntries(counts, STRIP_SEVERITIES.concat(["UNKNOWN"]));
  if (!entries.length) return null;
  const total = entries.reduce((n, e) => n + e.count, 0);
  // Length carries the volume and the segments carry the mix, so one issue and eight of
  // them don't draw the same bar — a normalized bar would make them identical and say the
  // opposite of what it looks like it says.
  //
  // The noun is a parameter because two columns draw this bar over two different
  // populations. A findings bar announcing "3 open issues" would be a plain lie to a
  // screen reader while looking perfectly right to everyone else.
  return sevSegmentBar(entries, {
    size: "xs",
    width: `${Math.min(46, 10 + total * 4)}px`,
    label: `${plural(total, noun || "open issue")}: ${sevSpoken(entries, { lower: true })}`,
  });
}

/** Saved views live per browser; a sandboxed iframe or private mode may refuse. */
// The parse lives in savedViews.js, which owns both keys — the nav panel lists these views
// too. Storage unavailable still answers null, and this caller still hides the control.
function readViews() {
  return readSavedViews(VIEWS_KEY);
}

function writeViews(views) {
  try {
    window.localStorage.setItem(VIEWS_KEY, JSON.stringify(views.slice(0, 12)));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Synchronous placeholder shown until api_getAssets resolves — mirrors the posture header,
 * the toolbar and the table so the boot splash reveals a laid-out page (not a blank pane),
 * and later navigations show structure under the route-overlay veil. Keep its shape in
 * step with paint(): the stub IS the layout, and a stub that predicts the wrong page
 * makes the real content jump when it lands.
 */
function inventorySkeleton() {
  const header = el("div", { class: "inv-header" },
    el("div", { class: "inv-hero" },
      skeleton("line", { width: "70%" }),
      skeleton("stat", { width: "45%" }),
      skeleton("line", { width: "85%" })),
    el("div", { class: "sev-strip" },
      skeleton("line", { width: "40%" }),
      skeleton("line", { height: "10px", radius: "999px" }),
      skeleton("line", { width: "90%" })),
    el("div", { class: "card stat-list" },
      ...Array.from({ length: 4 }, () => skeleton("line", { height: "18px" }))),
  );
  const toolbar = el("div", { class: "inv-toolbar" }, skeleton("line", { height: "34px" }));
  const rows = skeletonStack(8, { height: "18px" });
  return el("div", { role: "status", "aria-label": "Loading inventory" }, header, toolbar, rows);
}

// ------------------------------------------------------------------------ the page

export async function renderInventory(main, params) {
  // A drawer left open by the previous render of this page belongs to that render's state.
  // Drop it before building a new one; `panel=filters` below reopens it against this one.
  closeActiveSheet();
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "AI Inventory"),
    el("p", { class: "page-sub" },
      "Every AI asset and its supporting identity/data surface from the last sync, " +
      "ranked by how many issues and failing controls are open on it."),
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
  host.append(inventorySkeleton()); // replaced by paint() once api_getAssets resolves

  // Filter, sort, paging and view state live here (outside paint) so they survive SWR
  // repaints; seeded from the URL so a filtered page is shareable and reloadable. The
  // single-select spellings (?kind=, ?cloud=, ?band=…) still resolve — resolveAssetQuery
  // folds each into its plural dimension.
  let query = paramsToQuery(params);
  let view = params.view === "cards" ? "cards" : "table";
  let panelName = params.panel === "filters" ? "filters" : "";

  function paramsToQuery(p) {
    return resolveAssetQuery({
      ...p,
      page: p.page ? Math.max(0, Number(p.page) - 1) : 0,
      pageSize: PAGE_SIZES.indexOf(Number(p.size)) >= 0 ? Number(p.size) : DEFAULT_PAGE_SIZE,
    });
  }

  function persistParams() {
    setParams({
      q: query.q,
      severities: listJoin(query.severities),
      kinds: listJoin(query.kinds),
      clouds: listJoin(query.clouds),
      regions: listJoin(query.regions),
      projects: listJoin(query.projects),
      domains: listJoin(query.domains),
      flags: listJoin(query.flags),
      // The single-select spellings were folded into the plural dimensions above; blank
      // them so a link carries one spelling of each filter rather than two. The three
      // AARS-level spellings are blanked for a different reason: they name a facet this
      // register no longer has, `resolveAssetQuery` drops them, and leaving them in the
      // address bar would advertise a filter that is not applied.
      kind: "", cloud: "", region: "", project: "", severity: "", domain: "",
      aarsSeverities: "", aarsSeverity: "", band: "",
      sort: query.sort === "issues" ? "" : query.sort,
      dir: query.dir === DEFAULT_SORT_DIR[query.sort] ? "" : query.dir,
      view: view === "table" ? "" : view,
      panel: panelName,
      page: query.page ? query.page + 1 : "",
      size: query.pageSize === DEFAULT_PAGE_SIZE ? "" : query.pageSize,
    });
  }

  // Every fetch takes a ticket. A response — including a background SWR revalidation of an
  // older request — is dropped unless it's still the newest, so a slow page 2 can't land
  // on top of the page 3 the user has already asked for.
  let ticket = 0;

  function requestParams() {
    return {
      all: true, // the server downgrades this to one page when the landscape is too big
      q: query.q,
      severities: query.severities,
      kinds: query.kinds, clouds: query.clouds, regions: query.regions,
      projects: query.projects, domains: query.domains, flags: query.flags,
      sort: query.sort, dir: query.dir, page: query.page, pageSize: query.pageSize,
    };
  }

  // ---- state shared between paint() and the controls that outlive it
  let payload = null;
  let allMode = true;
  let facets = null;      // current facet counts, whichever side computed them
  // The rows currently on screen, in the order they are shown — what the detail sheet's
  // prev/next steps through. A page's worth, not the whole filtered set: the cluster's
  // ends should mean "the end of what you are looking at". Declared up here with the rest
  // of the page's state because renderResults() is hoisted and runs before its own line.
  let visibleRows = [];
  let countText = null;   // the one live region on the page
  let resultsHost = null;
  let footerCount = null; // the drawer's running result count
  let syncStrip = null;   // re-marks the distribution strip when the AARS filter changes
  const facetGroups = new Map();

  /** Options for one dimension: the whole-inventory vocabulary, each with its count. */
  function facetOptions(key) {
    const vocab = key === "flags"
      ? ASSET_FLAGS.slice()
      : ((payload && payload.facets && payload.facets[key]) || []);
    const counts = new Map(
      ((facets && facets[key]) || []).map((f) => [f.value, f.count]),
    );
    // A selected value the vocabulary no longer knows (stale link, re-synced landscape) is
    // still listed, so it can be switched off rather than silently filtering the table.
    const values = vocab.slice();
    for (const v of query[key]) if (values.indexOf(v) < 0) values.push(v);
    const options = values.map((value) => ({
      value,
      label: key === "kinds" ? kindLabel(value)
        : key === "flags" ? (FLAG_LABELS[value] || value)
        : value,
      count: counts.get(value) || 0,
      sev: key === "severities" ? value : "",
      group: key === "kinds" ? (CATEGORY_LABELS[categoryOf(value)] || "Other") : "",
    }));
    // Kinds carry a category heading, so they have to arrive grouped — the vocabulary is
    // alphabetical, which would otherwise repeat "AI assets & compute" five times down
    // the list instead of once.
    if (key === "kinds") {
      const rank = (v) => {
        const i = CATEGORY_ORDER.indexOf(categoryOf(v.value));
        return i < 0 ? CATEGORY_ORDER.length : i;
      };
      options.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
    }
    return options;
  }

  // ---- the filter surface, created once so an open drawer survives a repaint
  const panel = filterUI({
    title: "Filter assets",
    subtitle: "Changes apply immediately",
    width: "min(420px, 92vw)",
    entries: () => filterEntries(),
    onPatch: (patch) => {
      for (const key of Object.keys(patch)) query[key] = patch[key];
      onFilterChange();
    },
    onClearAll: () => {
      for (const key of FACET_KEYS) query[key] = [];
      query.q = "";
      onFilterChange();
    },
    onPanelChange: (name) => {
      panelName = name;
      persistParams();
    },
    buildBody: (body, ctx) => buildDrawer(body, ctx),
  });

  /** What is applied right now — one chip per selected value, plus the search term. */
  /**
   * What is narrowing the view right now. `label` is the dimension and `value` is what was
   * picked, kept apart so the shared chip row can print "Findings score level · CRITICAL" with
   * the dimension muted — the same shape graphChips.js emits.
   */
  function filterEntries() {
    const out = [];
    if (query.q) {
      out.push({ key: "q", label: "Name", value: query.q, patch: { q: "" } });
    }
    for (const key of FACET_KEYS) {
      for (const value of query[key]) {
        const sev = key === "severities" ? value : "";
        const shown = key === "kinds" ? kindLabel(value)
          : key === "flags" ? (FLAG_LABELS[value] || value)
          : value;
        out.push({
          key: `${key}-${value}`,
          label: FACET_LABELS[key] || key,
          value: shown,
          sev,
          patch: { [key]: query[key].filter((v) => v !== value) },
        });
      }
    }
    return out;
  }

  const firstTicket = ++ticket;
  let data;
  try {
    data = await swrCall("api_getAssets", requestParams(), (fresh) => {
      // A revalidation that landed before any interaction: the data itself changed, so
      // repaint the aggregates too.
      if (ticket === firstTicket) paint(fresh);
    });
  } catch (e) {
    clear(host).append(errorState("Couldn't load the inventory.", {
      detail: String(e.message || e),
      onRetry: () => renderInventory(clear(main), params),
    }));
    return;
  }
  paint(data);

  // ------------------------------------------------------------------ painting

  function paint(fresh) {
    payload = fresh;
    allMode = fresh.all !== false;
    clear(host);

    const kpis = fresh.kpis || {};

    // NO STALE-SCORES BANNER. It used to live here, because the scores it warned about set
    // this page's sort order and filled its strip. Nothing on this page reads a score now,
    // so a warning that some of them are behind the current rule is news about a model the
    // reader cannot see from here — it belongs beside the model, and that is where it went.

    host.append(countHeader(kpis, fresh));
    const reachCard = reachHeadline(fresh.reach);
    if (reachCard) host.append(reachCard);
    host.append(toolbar());
    host.append(panel.chips);
    panel.chips.classList.add("inv-chips");

    resultsHost = el("div", { class: "table-host" });
    host.append(resultsHost);
    host.append(trendSection(fresh));
    const posture = postureTrendSection(fresh);
    if (posture) host.append(posture);

    renderResults(fresh);
    panel.sync();
    // Rewrite the URL into the canonical spelling: a link carrying ?kind= or ?band= (or a
    // value the landscape no longer has) has already been folded into the plural dimensions,
    // so leave the address bar describing the filters that are actually applied.
    persistParams();
    if (panelName === "filters") panel.open(false);
  }

  // ---- one-glance reach headline, linking to the Scans page's full stage ladder. Placed
  // beside the count header rather than inside it: countHeader answers "what did we
  // find"; this answers "how much of the landscape did the pipeline ever reach" — a different
  // question, and folding it into the same header would read as one more posture number
  // rather than the coverage caveat it actually is.
  function reachHeadline(reach) {
    if (!reach) return null;
    const observed = reach.stages.find((s) => s.key === "observed");
    if (!observed) return null;
    const known = observed.total > 0;
    const link = el(
      "a",
      { class: "link", href: buildHash("scans", { anchor: "reach" }), target: "_self" },
      known ? observed.covered + " of " + observed.total : "—",
    );
    return el("div", { class: "kpi-row" },
      kpiCard(
        "Landscape reach — observed",
        link,
        "AI-kinded assets carrying any signal, of the register's AI landscape — open Wiz Scans "
          + "for the full five-stage ladder.",
      ));
  }

  // ---- header: one hero, the three counts, one distribution, one stat list
  function countHeader(kpis, fresh) {
    const counts = fresh.severityCounts || {};
    const deltas = fresh.countDeltas || null;
    const withIssues = STRIP_SEVERITIES.reduce((n, sev) => n + (counts[sev] || 0), 0);

    const hero = el("div", { class: "inv-hero" },
      el("div", { class: "kpi-label" }, "AI assets"),
      el("div", { class: "hero-value num" }, String(kpis.aiAssets ?? 0)),
      el("div", { class: "inv-hero-sub" },
        `${kpis.agents ?? 0} agents · ${kpis.agenticIdentities ?? 0} agentic identities`),
    );

    // The three counts, which is what this header claims now that it claims no verdict.
    // Each is a number a reader can go and check in Wiz: open issues, failing
    // configuration findings, and distinct policies with a failing evaluation.
    //
    // The third has NO PER-ASSET GRAIN and never will — Wiz reports posture per framework,
    // category, subcategory and policy, never per resource — so it appears here and in no
    // table column. Saying "landscape-wide" out loud is cheaper than letting a reader
    // assume the column is missing.
    //
    // Read-outs, not toggles: only the strip below filters, and a number that looked like
    // a filter key but did nothing would be worse than a plain number.
    const posture = kpis.frameworkPosture || null;
    const postureFails = posture && posture.frameworks ? posture.failingPolicies : null;
    const deltaChip = (key) => {
      const d = deltas && deltas.counts ? deltas.counts[key] : undefined;
      if (d === undefined || d === null || d === 0) return null;
      const since = `since the sync of ${fmtDate(deltas.since)}`;
      return tipAnchor(el("span", { class: "chg " + (d > 0 ? "up" : "down") },
        (d > 0 ? "+" : "") + d,
        el("span", { class: "sr-only" }, ", " + since)), since);
    };
    const countStat = (label, value, key, term) => el("div", { class: "inv-count" },
      el("div", { class: "kpi-label" }, label),
      el("div", { class: "inv-count-row" },
        el("span", { class: "inv-count-n num" }, value === null ? "—" : String(value)),
        deltaChip(key)),
      term);
    const verdict = el("div", { class: "inv-verdict" },
      el("div", { class: "inv-count-row" },
        countStat("Open issues", kpis.openIssues ?? 0, "issues"),
        countStat("Cloud findings", kpis.complianceGaps ?? 0, "findings"),
        countStat("Posture fails", postureFails, "postureFails")),
      el("p", { class: "sev-strip-note" },
        "Counts, not a score" +
        (kpis.complianceGapsUnlinked
          ? ` · ${kpis.complianceGapsUnlinked} findings are not on an AI asset`
          : "") +
        (postureFails === null
          ? " · no framework posture collected"
          : " · posture fails are landscape-wide, with no per-asset grain")),
    );

    // The distribution strip: the page's cross-filter, and the keyboard-reachable twin of
    // clicking a bar. The bar itself is decoration (the keys carry the same numbers as
    // text), and every key is a real toggle button, so nothing here is mouse-only.
    //
    // It counts ASSETS BY WORST OPEN ISSUE, not issues, because the `severities` facet it
    // toggles filters rows by exactly that field. A strip counting issues would add up to
    // the KPI above it and then hand a reader segments whose click could not reproduce the
    // number they had just read.
    const entries = sevEntries(counts, STRIP_SEVERITIES);
    const selected = () => new Set(query.severities);
    const track = sevSegmentBar(entries, { size: "md", selected: selected() });
    const keys = sevKeyRow(entries, {
      variant: "toggle",
      ariaLabel: "Filter by issue severity",
      isOn: (sev) => query.severities.indexOf(sev) >= 0,
      describe: (e) => `${e.sev}, ${plural(e.count, "asset")}`,
      onToggle: (sev) => toggleFacet("severities", sev),
    });
    const segs = new Map();
    const keyBtns = new Map();
    entries.forEach((e, i) => {
      segs.set(e.sev, track.children[i]);
      keyBtns.set(e.sev, keys.children[i]);
    });

    const strip = el("div", { class: "sev-strip" },
      el("div", { class: "kpi-label" }, "Worst open issue"),
      track,
      keys,
      // The note says what the strip IS, because the widest misreading of a severity
      // distribution is that its top segment is a work queue. It is the shape of one
      // distribution over the landscape, counted one asset at a time.
      el("p", { class: "sev-strip-note" },
        `${withIssues} of ${fresh.total || 0} assets carry an open issue` +
        " · assets, not issues — the bar in each row counts those"),
    );

    const coverage = kpis.guardrailCoveragePct;
    const stats = el("div", { class: "card stat-list" },
      statRow("Guardrail coverage",
        coverage === null || coverage === undefined ? "—" : `${coverage}%`,
        "agents protected by a guardrail",
        coverage === null || coverage === undefined ? null : coverage,
        { term: "missing-guardrail" }),
      statRow("Sensitive data access", String(kpis.sensitiveAccess ?? 0), "AI assets",
        null, { term: "sensitive-data" }),
      statRow("Reaches classified data", String(kpis.dataFindings ?? 0),
        "classified findings reachable from an AI asset", null, { term: "sensitive-data" }),
      statRow("Frameworks scored",
        posture && posture.scoredFrameworks !== undefined ? String(posture.scoredFrameworks) : "—",
        "of " + (posture ? posture.frameworks ?? 0 : 0) + " collected",
        null, { term: "coverage-state" }),
    );

    // The strip is a control, so it has to reflect state it did not itself change — a
    // chip cleared outside it, or the drawer's own severity facet. Marked in place rather
    // than rebuilt, so the key you just pressed keeps focus.
    syncStrip = () => {
      const active = query.severities;
      // Dimming lives on the bar, not on the strip wrapper: the bar is the thing that
      // recedes, and the class that does it now belongs to the shared .sevbar component.
      track.classList.toggle("sevbar--dim", active.length > 0);
      for (const [sev, seg] of segs) {
        seg.setAttribute("data-on", active.indexOf(sev) >= 0 ? "true" : "false");
      }
      for (const [sev, btn] of keyBtns) {
        btn.setAttribute("aria-pressed", active.indexOf(sev) >= 0 ? "true" : "false");
      }
    };

    // hero and the counts share the top row; the distribution sits under them.
    return el("div", { class: "inv-header" }, hero, verdict, strip, stats);
  }

  // ---- toolbar
  function toolbar() {
    const searchInput = el("input", {
      type: "search",
      "aria-label": "Search assets by name",
      placeholder: "Search name…",
      value: query.q,
    });
    // Local filtering can keep up with typing; a server round trip per keystroke can't.
    searchInput.addEventListener("input", debounce(() => {
      query.q = searchInput.value.trim().toLowerCase();
      onFilterChange();
    }, allMode ? 150 : 400));

    const tableBtn = el("button", {
      "aria-pressed": view === "table" ? "true" : "false",
      onclick: () => setView("table"),
    }, "Table");
    const cardsBtn = el("button", {
      "aria-pressed": view === "cards" ? "true" : "false",
      onclick: () => setView("cards"),
    }, "Cards");
    const viewmode = el("div", {
      class: "viewmode", role: "group", "aria-label": "Result layout",
    }, tableBtn, cardsBtn);

    // role=status so the result count is announced when a filter changes what is shown.
    // It is the ONLY live region on this page: the chips, the facet counts and the badges
    // all change together, and announcing each would be a storm, not information.
    countText = el("span", { class: "count", role: "status" });

    return el("div", { class: "inv-toolbar" },
      el("div", { class: "workbench-search" }, searchInput),
      panel.trigger,
      savedViewsControl(),
      viewmode,
      el("div", { class: "inv-toolbar-end" }, countText),
    );
  }

  function setView(next) {
    if (view === next) return;
    view = next;
    persistParams();
    renderResults(payload);
    // Only the results were replaced; the toggle itself survives, so focus stays put.
    for (const btn of document.querySelectorAll(".viewmode button")) {
      btn.setAttribute("aria-pressed", btn.textContent.toLowerCase() === next ? "true" : "false");
    }
  }

  // ---- saved views (per browser; the URL is the shareable form)
  function savedViewsControl() {
    const views = readViews();
    if (views === null) return null; // storage refused — offer nothing rather than a broken control

    const sel = el("select", { "aria-label": "Saved views" },
      el("option", { value: "" }, views.length ? "Saved views…" : "No saved views"),
      ...views.map((v, i) => el("option", { value: String(i) }, v.name)),
    );
    sel.addEventListener("change", () => {
      const v = views[Number(sel.value)];
      sel.value = "";
      if (!v) return;
      // navigate(), not setParams(): a wholesale state change deserves a history entry, so
      // Back returns to the view they were on.
      navigate("inventory", v.params);
    });

    const save = el("button", {
      onclick: async () => {
        const input = el("input", {
          type: "text", placeholder: "e.g. Agents missing a guardrail",
          "aria-label": "View name",
          style: "width:100%; margin-bottom:4px",
        });
        const ok = await confirmDialog({
          title: "Save this view",
          body: el("div", {},
            el("p", { class: "muted small" },
              "Saves the current filters, sort and layout in this browser. " +
              "To share the view, copy the page link instead."),
            input),
          confirmLabel: "Save",
        });
        const name = input.value.trim();
        if (!ok || !name) return;
        const current = readViews() || [];
        const params = {};
        const hash = {};
        persistParams();
        const qs = location.hash.split("?")[1] || "";
        for (const pair of qs.split("&")) {
          if (!pair) continue;
          const [k, val] = pair.split("=");
          hash[decodeURIComponent(k)] = decodeURIComponent(val || "");
        }
        for (const k of VIEW_PARAMS) if (hash[k]) params[k] = hash[k];
        const next = current.filter((v) => v.name !== name);
        next.unshift({ name, params });
        if (!writeViews(next)) {
          toast("Couldn't save the view — this browser is blocking local storage.", "error");
          return;
        }
        if (next.length > 12) toast("Keeping the 12 most recent views.", "warn");
        // Rebuild the toolbar so the new view is listed.
        paint(payload);
      },
    }, "Save view");

    return el("div", { class: "saved-views" }, sel, save);
  }

  // ---- the filter drawer body
  function buildDrawer(body, ctx) {
    const root = el("div", { class: "sheet-filters" });
    facetGroups.clear();
    for (const key of FACET_KEYS) {
      const group = facetGroup({
        label: FACET_LABELS[key],
        // Named because it is the one dimension that narrows as you add to it.
        hint: key === "flags" ? "all of" : "any of",
        onToggle: (value) => toggleFacet(key, value),
      });
      facetGroups.set(key, group);
      root.append(group.root);
    }
    body.append(root);

    footerCount = el("span", { class: "count num" });
    ctx.footer().append(
      footerCount,
      el("button", {
        class: "link",
        onclick: () => {
          for (const k of FACET_KEYS) query[k] = [];
          query.q = "";
          onFilterChange();
          // Focus deliberately stays in the drawer: the app root is inert while the sheet
          // is open, so handing it to the trigger would drop it on the document.
        },
      }, "Clear all"),
    );

    const sync = () => {
      for (const [key, group] of facetGroups) group.update(facetOptions(key), query[key]);
      if (footerCount) {
        const shown = facets ? facets.matched : 0;
        const total = payload ? payload.total : 0;
        footerCount.textContent = `${shown} of ${total} assets`;
      }
    };
    sync();
    return sync;
  }

  function toggleFacet(key, value) {
    const current = query[key];
    query[key] = current.indexOf(value) >= 0
      ? current.filter((v) => v !== value)
      : current.concat([value]);
    onFilterChange();
  }

  // ------------------------------------------------------------------ update cycle

  function onFilterChange() {
    query.page = 0; // a narrower set makes the old page number meaningless
    persistParams();
    if (allMode) renderResults(payload);
    else reload(null);
    panel.sync();
    if (syncStrip) syncStrip();
  }

  /** Server-mode page/filter change: refetch, keeping the rest of the page in place. */
  function reload(navFocus) {
    const mine = ++ticket;
    resultsHost.setAttribute("aria-busy", "true");
    const settle = (fresh) => {
      if (mine !== ticket) return; // superseded while in flight
      resultsHost.removeAttribute("aria-busy");
      payload = fresh;
      renderResults(fresh);
      panel.sync();
      restoreFocus(navFocus);
    };
    swrCall("api_getAssets", requestParams(), settle)
      .then(settle)
      .catch((e) => {
        if (mine !== ticket) return;
        resultsHost.removeAttribute("aria-busy");
        clear(resultsHost).append(errorState("Couldn't load this page.", {
          detail: String(e.message || e),
          onRetry: () => reload(null),
        }));
      });
  }

  /**
   * Paging and sorting replace the controls that were just used, so keyboard focus falls
   * back to the document. Put it on the same control afterwards, or on its neighbor when
   * the move disabled it (first/last page).
   */
  function restoreFocus(token) {
    if (!token) return;
    if (token.sort) {
      const th = resultsHost.querySelector(`[data-sort="${token.sort}"]`);
      if (th) th.focus();
      return;
    }
    const same = resultsHost.querySelector(`[data-nav="${token.nav}"]`);
    const other = resultsHost.querySelector(
      `[data-nav="${token.nav === "prev" ? "next" : "prev"}"]`);
    const target = same && !same.disabled ? same : (other && !other.disabled ? other : null);
    if (target) target.focus();
  }

  function goToPage(next) {
    const active = document.activeElement;
    const nav = active && active.getAttribute ? active.getAttribute("data-nav") : null;
    query.page = Math.max(0, next);
    persistParams();
    if (allMode) {
      renderResults(payload);
      restoreFocus(nav ? { nav } : null);
    } else {
      reload(nav ? { nav } : null);
    }
  }

  function setSort(key) {
    if (query.sort === key) query.dir = query.dir === "asc" ? "desc" : "asc";
    else {
      query.sort = key;
      query.dir = DEFAULT_SORT_DIR[key];
    }
    query.page = 0;
    persistParams();
    if (allMode) {
      renderResults(payload);
      restoreFocus({ sort: key });
    } else {
      reload({ sort: key });
    }
  }

  // ------------------------------------------------------------------ the results

  function renderResults(current) {
    if (!current) return;
    clear(resultsHost);
    const requested = query.page;

    // All-mode holds every row and slices locally; server-mode is handed exactly the page
    // it asked for, already filtered and sorted by the shared domain module.
    let pageRows;
    let shown;
    let pageCount;
    if (allMode) {
      facets = facetCounts(current.rows, query);
      const filtered = sortAssetRows(
        filterAssetRows(current.rows, query), query.sort, query.dir);
      shown = filtered.length;
      const sliced = pageOf(filtered, query.page, query.pageSize);
      query.page = sliced.page; // a filter can strand the page number
      pageRows = sliced.rows;
      pageCount = sliced.pageCount;
    } else {
      facets = current.facetCounts || null;
      pageRows = current.rows;
      shown = current.filtered;
      pageCount = current.pageCount;
      query.page = current.page; // the server clamps out-of-range pages; mirror it back
    }

    // Either path can land on a different page than was asked for (a filter narrowed the
    // set, or the server clamped a deep link); keep the URL on the page in view.
    if (query.page !== requested) persistParams();

    countText.textContent = `${shown} of ${current.total} assets`;

    resultsHost.append(sectionLabel("Assets"));

    if (!shown) {
      const applied = filterEntries().length;
      resultsHost.append(el("div", { class: "empty", role: "status" },
        el("div", {}, "No assets match these filters."),
        el("p", { class: "small muted" },
          `${applied} filter${applied === 1 ? "" : "s"} applied.`),
        el("div", { class: "empty-actions" },
          el("button", {
            onclick: () => {
              for (const k of FACET_KEYS) query[k] = [];
              query.q = "";
              onFilterChange();
            },
          }, "Clear all filters")),
      ));
      return;
    }

    visibleRows = pageRows;
    resultsHost.append(view === "cards" ? cardGrid(pageRows) : assetTable(pageRows));

    // The "keep the top of the page in view" recompute this used to do inline now lives in
    // `tableFooter`, which is where the graph's copy of this strip was missing it.
    resultsHost.append(tableFooter({
      page: query.page,
      pageCount,
      total: shown,
      pageSize: query.pageSize,
      sizes: PAGE_SIZES,
      onPage: goToPage,
      onPageSize: (size, page) => { query.pageSize = size; goToPage(page); },
    }));
  }

  function openAsset(row) {
    // The row already holds everything the sheet's header shows, so pass it as the seed:
    // identity and verdict paint on the same frame as the slide-in, and only the body
    // waits for the RPC.
    const rows = visibleRows;
    const index = rows.indexOf(row);
    openAssetSheet(row.id, {
      seed: row,
      records: index === -1 ? null : {
        ids: rows.map((r) => r.id),
        index,
        label: "asset",
        open: (id, i) => openAsset(rows[i]),
      },
    });
  }

  function openRow(row) {
    return () => openAsset(row);
  }

  function graphButton(row) {
    return el("button", {
      class: "link",
      onclick: (e) => {
        e.stopPropagation();
        navigate("graph", { seed: row.id });
      },
    }, "Graph");
  }

  /**
   * The Domain cell, as the way into the graph for that domain.
   *
   * This is where a reader already sees the domain and asks to be shown it, and the text is
   * drawn either way — so it costs no new element. A LINK and not a button for the same reason
   * the Graph column is one button and not one per fact: ~4 distinct domains spread over 87 rows
   * would otherwise become 87 buttons, and a register that shouts is a register nobody scans.
   *
   * It navigates with the `seedKind` vocabulary rather than assembling query DSL here. The graph
   * page translates that on arrival and rewrites the hash canonically, so what a reader ends up
   * holding IS the builder-native `find`/`where` — an editable Where chip, shareable — while this
   * page keeps knowing nothing about the DSL. Same shape as the toxic-combination page's own
   * "Open in graph", and it means the link form `graphApiParams.ts` documents is the one the app
   * itself writes rather than a second spelling nothing produces.
   */
  function domainLink(row) {
    return el("button", {
      class: "link",
      "aria-label": `Open ${row.domain} in the Security Graph`,
      onclick: (e) => {
        e.stopPropagation();
        navigate("graph", { seed: row.domain, seedKind: "domain" });
      },
    }, row.domain);
  }

  function assetTable(rows) {
    /** Cell renderers, keyed to COLUMNS above so header and body cannot drift apart. */
    const CELLS = {
      // The kind medallion the Security Graph's results table carries, so a row and a node
      // read as the same thing in two views. It does not restate the Kind column beside it —
      // that column is the word, this is the shape, and the shape is what a reader scanning
      // 250 rows for "which of these are buckets" actually uses. The graph pairs the two the
      // same way whenever a query selects its `kind` field.
      //
      // It costs the name about 26px out of a cell tables.css clips at 320px, which is why
      // the column asks for a wider cap by name (`.inv-name-col`) rather than spending the
      // room. `badge` is what keeps the Agentic pill, and retires the one inline `style`
      // attribute left in a table cell.
      name: (row) => nameCell(row.name, row.kind, {
        // `pill neutral`, not a bare `pill`. A bare one carries no kind, and the four
        // kinds are where components.css puts the background — so this chip drew as text
        // with a dot inheriting the cell's colour. Neutral is the right kind: agentic is a
        // fact about the asset, not a verdict on it.
        badge: row.agentic ? el("span", { class: "pill neutral" }, "Agentic") : null,
      }),
      kind: (row) => kindLabel(row.kind),
      cloud: (row) => row.cloud || absent(),
      region: (row) => row.region || absent(),
      // The worst open issue's severity — Wiz's own rating, carried through, not a grade
      // this app computed. A dash means no open issue, which is a real state and not an
      // unscored one.
      severity: (row) => (row.severity ? sevBadge(row.severity) : absent()),
      // The count, with the same severity split drawn as a bar: the badge beside it says
      // which is worst, this says how many of each, and the two come from one set of issue
      // rows so they cannot disagree.
      issues: (row) => (row.openIssues
        ? el("span", { class: "issue-cell" },
            el("span", { class: "num" }, String(row.openIssues)),
            issueBars(row.issuesBySeverity))
        : el("span", { class: "muted small" }, "0")),
      // Failing configuration findings evaluated against this asset. Most of the
      // landscape's findings are evaluated against a region or an access policy no asset
      // models, so this column reads lower than the register total by design — the header
      // stat says how many are off-inventory rather than leaving the gap to look like a bug.
      findings: (row) => (row.openFindings
        ? el("span", { class: "issue-cell" },
            el("span", { class: "num" }, String(row.openFindings)),
            issueBars(row.findingsBySeverity, "cloud finding"))
        : el("span", { class: "muted small" }, "0")),
      combos: (row) => (row.combos ? el("span", { class: "pill bad" }, `TC ×${row.combos}`) : absent()),
      guardrail: (row) => (row.guardrailMissing ? el("span", { class: "pill warn" }, "missing") : absent()),
      domain: (row) => (row.domain ? domainLink(row) : absent()),
      projects: (row) => (row.projects || []).join(", ") || absent(),
      actions: (row) => graphButton(row),
    };

    return dataTable({
      stickyHeader: true,
      columns: COLUMNS.map((col) => ({
        key: col.sort || col.key,
        label: col.label,
        sortable: !!col.sort,
        className: col.key === "name" ? "inv-name-col" : null,
        cell: CELLS[col.key],
      })),
      rows,
      // `dir` is this page's own convention ("asc"/"desc", seeded from the URL); the shared
      // table only needs to know which way the active column currently reads.
      sort: query.sort ? { key: query.sort, descending: query.dir === "desc" } : null,
      onSort: setSort,
      onRowOpen: (row) => openRow(row)(),
      rowLabel: (row) => `${row.name}, ${kindLabel(row.kind)}`,
    });
  }

  function cardGrid(rows) {
    const grid = el("div", { class: "asset-grid" });
    for (const row of rows) {
      const svg = kindIconSvg(row.kind, 16);
      svg.setAttribute("class", "asset-card-icon");
      grid.append(el("button", {
        class: "asset-card",
        // The two counts are spoken, not just drawn: a card's marks are pills and bars,
        // and a screen reader would otherwise get the name and nothing about the state.
        "aria-label": `${row.name}, ${kindLabel(row.kind)}, ` +
          `${plural(row.openIssues || 0, "open issue")}, ` +
          `${plural(row.openFindings || 0, "cloud finding")}` +
          (row.severity ? `, worst ${sevSpoken(row.severity)}` : ""),
        onclick: openRow(row),
      },
        el("div", { class: "asset-card-head" },
          svg,
          el("span", { class: "asset-card-name" }, row.name)),
        el("div", { class: "asset-card-marks" },
          row.severity ? sevBadge(row.severity) : null,
          issueBars(row.issuesBySeverity),
          row.combos ? el("span", { class: "pill bad" }, `TC ×${row.combos}`) : null,
          row.guardrailMissing ? el("span", { class: "pill warn" }, "no guardrail") : null,
          row.agentic ? el("span", { class: "pill neutral" }, "Agentic") : null),
        el("div", { class: "asset-card-meta" },
          el("span", {}, kindLabel(row.kind)),
          row.cloud ? el("span", {}, row.cloud) : null,
          row.region ? el("span", {}, row.region) : null),
      ));
    }
    return grid;
  }

  // ---- history: one point per sync, and it cannot be backfilled
  function trendSection(fresh) {
    const trend = fresh.countTrend || [];
    // A stale SWR payload from before this shipped carries no trendScope at all, which reads
    // as unscoped — the same degradation the rest of the page's optional fields take.
    const trendScope = fresh.trendScope || null;
    const scopedGap = Boolean(trendScope && trendScope.scoped
      && trendScope.points < trendScope.registerPoints);
    // Non-severity series, so they take categorical hues rather than the severity palette
    // (charts.js's own rule). Each is named in the legend, so colour is never the only cue.
    const SERIES = [
      { key: "issues", label: "Open issues", color: "#be123c" },
      { key: "findings", label: "Cloud findings", color: "#3b82f6" },
      { key: "postureFails", label: "Posture fails", color: "#8b5cf6" },
    ];
    // Which series this window actually has a number for. A series that is null at every
    // point is not charted at all — an empty legend entry invites "why is that line zero".
    const present = SERIES.filter((s) =>
      trend.some((pt) => (pt.counts || {})[s.key] !== null
        && (pt.counts || {})[s.key] !== undefined));
    // Points a series is missing INSIDE its own window: the two newer columns start part
    // way through a ledger that already had issue counts, and the note says so rather than
    // letting a line that begins in mid-air look like a rendering fault.
    const partial = present.filter((s) =>
      trend.some((pt) => (pt.counts || {})[s.key] === null
        || (pt.counts || {})[s.key] === undefined));

    const canvas = el("canvas", {
      "aria-label": "Open issues, cloud findings and compliance posture fails over time, "
        + "one line per count",
      role: "img",
    });

    const card = el("div", { class: "chart-card" },
      el("h3", {}, "Counts over time"),
      el("p", { class: "chart-note" },
        trend.length >= 2 ? `${trend.length} syncs` : "One point per sync"),
      // This series FOLLOWS the project view: sync_history carries a per-project blob
      // beside its register-wide columns, so a scoped read is a different column rather
      // than a filter. `null` when no view is set.
      trendScopeNote(fresh.trendScope),
      trend.length >= 2
        ? el("div", { class: "chart-box", style: "height:220px" }, canvas)
        : el("div", { class: "chart-empty", role: "status" },
            trend.length === 1
              ? "One sync recorded so far — the trend draws from the second."
              // "No history yet" would be a lie under a project view on a ledger that HAS
              // history: what is missing is the breakdown, not the syncs, and the note above
              // already carries the count.
              : scopedGap
                ? "No sync has recorded totals for this project yet — the series starts at " +
                  "the next one."
                : "No history yet. Each sync adds a point; earlier syncs can't be recovered."),
      // A GAP IS NOT A ZERO, and this is where that distinction becomes visible. Two of the
      // three counts were added to sync_history after the issue count, and history cannot
      // be backfilled, so their lines simply begin later. Saying which ones stops a reader
      // reading "the line starts here" as "this was zero until then".
      trend.length >= 2 && partial.length
        ? el("p", { class: "chart-note" },
            (partial.length === 1
              ? `${partial[0].label} has`
              : `${partial.map((s) => s.label).join(" and ")} have`) +
            " no figure for every sync in this window — earlier syncs predate the column, " +
            "and a sync that collected no framework posture records none. Those points " +
            "are gaps, not zeros.")
        : null,
      trend.length >= 2 && present.length < SERIES.length
        ? el("p", { class: "chart-note" },
            SERIES.filter((s) => present.indexOf(s) < 0).map((s) => s.label).join(" and ") +
            (present.length === SERIES.length - 1 ? " is" : " are") +
            " not charted: no sync in this window recorded a figure.")
        : null,
    );

    if (trend.length >= 2) {
      // CHART.JS ARRIVES HERE, not with the page — it is ~19% of what a reader waits for on
      // every route, and eight of the ten draw nothing. `loadCharts` fetches it once per
      // session and memoizes; the rAF that used to be the whole deferral now waits on it.
      //
      // The rejection branch is the honest half. A deployment whose policy refuses to run
      // code obtained at runtime keeps this card, its heading, its sync count and its scope
      // note, and gains one line saying the drawing is missing — not a blank box, and not
      // silence. See chartsLoader.js.
      loadCharts().then((charts) => {
        if (!canvas.isConnected) return;
        requestAnimationFrame(() => charts.trendLine(canvas, trend.map((pt) => ({ x: pt.at })), {
          yLabel: "count",
          series: present.map((s) => ({
            label: s.label,
            color: s.color,
            // NULL, not `?? 0` — Chart.js breaks the line at a null, which is exactly the
            // reading we want. Coercing to zero here would undo the whole nullable-count
            // design one line before it reached the screen.
            data: trend.map((pt) => {
              const v = (pt.counts || {})[s.key];
              return v === undefined ? null : v;
            }),
          })),
        }));
      }).catch(() => {
        if (!canvas.isConnected) return;
        chartUnavailable(canvas);
      });
    }

    return el("div", { class: "inv-history" }, sectionLabel("History"), card);
  }

  // ---- posture over time: the four series a sync records beside its counts
  //
  // BESIDE the counts trend, in the same History region and off the same `sync_history`
  // rows, because they answer the question the counts raise: the counts say the register
  // moved, these say what moved in it. Four cards rather than one chart with fifteen lines —
  // they are four different populations and only the first is a partition.
  //
  // REGISTER-WIDE, and it says so under the heading. `project_totals_json` carries the AARS
  // and outcome distributions per project and nothing else, so none of these four can follow
  // the project switcher; a scoped read would draw an empty chart, which reads as "this
  // project has no posture" rather than "the ledger never held the dimension".
  function postureTrendSection(fresh) {
    const trend = fresh.postureTrend || null;
    if (!trend) return null;
    const adjacency = trend.adjacency || [];
    const exploitation = trend.exploitation || [];
    const categoryPoints = trend.categoryPoints || [];
    const capacity = trend.capacity || null;
    const readout = capacityReadout(capacity);
    // AN UNMEASURED REGISTER IS NOT A REGISTER OF ZEROES. Four empty cards over a ledger
    // nobody has synced twice state four facts about a population nothing has looked at, so
    // the section says that once and draws nothing.
    if (!adjacency.length && !exploitation.length && !categoryPoints.length
      && !readout.rows.length) {
      return el("div", { class: "inv-history" },
        sectionLabel("Posture over time"),
        el("div", { class: "chart-card" },
          el("p", { class: "chart-empty", role: "status" },
            "Nothing recorded yet. Each sync adds a point to these series; earlier syncs "
            + "can't be recovered.")));
    }

    const cards = el("div", { class: "posture-trend-grid" },
      chartCard({
        title: "Where issues sit",
        points: adjacency,
        series: ADJACENCY_SERIES,
        stacked: true,
        notes: adjacencyPointNotes(adjacency),
        label: "Open issues by how close they sit to an AI asset, stacked, over time",
        // The denominator, in the card as well as in every point's hover: a reader who never
        // hovers must not take an UNLINKED band as a measurement of relatedness.
        foot: adjacencyFoot(adjacency),
      }),
      chartCard({
        title: "Exploitation evidence",
        points: exploitation,
        series: EXPLOITATION_SERIES,
        notes: exploitationPointNotes(exploitation),
        label: "Open issues by exploitation tier over time, one line per tier",
        // A refused evidence pass writes no census at all, so a missing point here is a sync
        // that never asked — not a sync that found nothing.
        foot: "A sync whose exploitation pass was refused records no census and has no point "
          + "on this chart.",
      }),
      chartCard({
        title: "Open issues by category",
        points: categoryPoints,
        series: categorySeries(trend.categories),
        label: "Open issues per risk category over time, one line per category",
        foot: "One line per category the register collects now. A sync run under a narrower "
          + "scope never counted the others, so those lines start where the scope did — a "
          + "gap, not a zero. An issue in two categories is counted in both, so the lines "
          + "do not sum to the register.",
      }),
      capacityCard(readout),
    );
    return el("div", { class: "inv-history" },
      sectionLabel("Posture over time"),
      el("p", { class: "chart-note" },
        "The whole register. These four are recorded per sync and have no project grain, so "
        + "they do not follow the project view."),
      cards);
  }

  /** How many edges the last point traversed — the adjacency counts' denominator, in words. */
  function adjacencyFoot(points) {
    const last = points.length ? points[points.length - 1] : null;
    const known = last && last.annotations ? last.annotations.edgesKnown : null;
    if (known === null || known === undefined) {
      return "No sync in this window recorded how many adjacency edges it could traverse, so "
        + "“not linked” cannot be read as “unrelated”.";
    }
    return `Latest sync traversed ${known.toLocaleString()} adjacency edges. Where the graph `
      + "holds few, “not linked” means untraversed rather than unrelated — each "
      + "point carries its own edge count.";
  }

  /** One trend card: heading, sync count, the chart or the reason there isn't one, a note. */
  function chartCard({ title, points, series, stacked, notes, label, foot }) {
    const present = presentSeries(points, series);
    const gappy = gappySeries(points, present);
    const canvas = el("canvas", { "aria-label": label, role: "img" });
    const card = el("div", { class: "chart-card" },
      el("h3", {}, title),
      el("p", { class: "chart-note" },
        points.length >= 2 ? `${points.length} syncs` : "One point per sync"),
      points.length >= 2 && present.length
        ? el("div", { class: "chart-box", style: "height:200px" }, canvas)
        : el("div", { class: "chart-empty", role: "status" },
            points.length === 1
              ? "One sync has recorded this — the series draws from the second."
              : points.length
                ? "No sync in this window recorded a figure for any of these."
                : "No sync has recorded this yet."),
      // A GAP IS NOT A ZERO, said in words wherever a line breaks or begins in mid-air.
      points.length >= 2 && gappy.length
        ? el("p", { class: "chart-note" },
            `${labelList(gappy)} ${gappy.length === 1 ? "has" : "have"} no `
            + "figure for every sync in this window. Those points are gaps, not zeros.")
        : null,
      foot ? el("p", { class: "chart-note" }, foot) : null,
    );

    if (points.length >= 2 && present.length) {
      // Chart.js arrives on demand, and a refusal keeps the card — see trendSection's own
      // note for why the rejection branch is the honest half.
      loadCharts().then((charts) => {
        if (!canvas.isConnected) return;
        requestAnimationFrame(() => charts.trendLine(canvas, points.map((pt) => ({ x: pt.at })), {
          yLabel: "count",
          series: seriesData(points, present),
          stacked: Boolean(stacked),
          pointNotes: notes,
        }));
      }).catch(() => {
        if (!canvas.isConnected) return;
        chartUnavailable(canvas);
      });
    }
    return card;
  }

  /**
   * The capacity readout: a WORD, a dot that repeats it, and the syncs it could not use.
   *
   * The word is the signal and the dot is the redundancy, never the other way round — the
   * verdict has to survive being read in greyscale, and a hue on its own would be the only
   * carrier of a three-valued fact.
   */
  function capacityCard(readout) {
    const dotClass = readout.verdict ? `cap-dot cap-dot--${readout.verdict}` : "cap-dot";
    const recent = readout.rows.slice(-6).reverse();
    return el("div", { class: "chart-card" },
      el("h3", {}, "Remediation capacity"),
      el("p", { class: "cap-verdict" },
        el("span", { class: dotClass, "aria-hidden": "true" }),
        el("span", { class: "cap-verdict-word" }, readout.word)),
      el("p", { class: "chart-note" }, readout.detail),
      recent.length
        ? el("table", { class: "cap-table" },
            el("thead", {},
              el("tr", {},
                el("th", { scope: "col" }, "Sync"),
                el("th", { scope: "col", class: "num" }, "Opened"),
                el("th", { scope: "col", class: "num" }, "Closed"),
                el("th", { scope: "col", class: "num" }, "Net"),
                el("th", { scope: "col" }, "Verdict"))),
            el("tbody", {}, ...recent.map((r) => el("tr", {},
              el("td", {}, fmtDate(r.at)),
              el("td", { class: "num" }, String(r.opened)),
              el("td", { class: "num" }, String(r.closed)),
              el("td", { class: "num" }, r.net > 0 ? `+${r.net}` : String(r.net)),
              el("td", {}, r.verdict)))))
        : null,
      el("p", { class: "chart-note" },
        "Opened counts new and reopened issues; closed counts the ledger's own "
        + "disappearance-dated resolutions. A sync that changed the register's scope, or "
        + "resolved nothing by absence, is plotted but not compared."),
    );
  }
}
