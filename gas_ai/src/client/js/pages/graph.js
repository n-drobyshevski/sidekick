// Security Graph — the centerpiece, as a full-page workbench. The server computes
// a depth-limited projection + deterministic layout (lanes or grouped clusters);
// this page owns the slim top bar (search, arrange, order, filters, view toggle),
// the applied-filter chips, the Filters panel, and the SVG canvas with its
// accessible table fallback. All state is hash params, so any view is shareable.
//
// Filter changes update in place — the top bar and panel are never rebuilt, so focus
// stays put while the graph repaints live. That is also why the Filters panel docks
// beside the canvas rather than covering it: these filters have no Apply button, so the
// result of every toggle has to be visible as it happens. Below 800px, where there is no
// room to dock, it falls back to the modal sheet.

import {
  bootstrap, listJoin, listSplit, navigate, parseHash, setParams, swrCall,
} from "../store.js";
import { openAssetSheet, openIssueSheet } from "../detailSheets.js";
import { renderGraph } from "../graphView.js";
import { queryTable, DEFAULT_PAGE_SIZE } from "../queryTable.js";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "../icons.js";
import { appliedCount, filterEntries, isNarrowingSet, sectionOf } from "./graphChips.js";
import {
  applyWhere, defaultQuery, migrateLegacyParams, parseQuery, parseWhere, serializeQuery,
  serializeWhere,
} from "./graphQuery.js";
import { queryBar } from "./graphQueryBar.js";
import {
  clear, confirmDialog, debounce, el, emptyState, filterChipRow, helpTip, openSheet, segmented,
  selectField, sevBadge, skeleton, toast, togglePills, uiIcon,
} from "../ui.js";

const GROUP_LABELS = {
  asset: "asset",
  combo: "toxic combo",
  project: "project",
  cloud: "cloud",
  kind: "node type",
  severity: "severity",
};

// Legend starts collapsed on each visit; once the user opens it we keep it open
// across in-place repaints (filter changes rebuild the legend, and a key that
// snapped shut on every tweak would be worse than useless).
let legendOpen = false;

// Params that change the server payload (vs. client-only view/q/panel).
const DATA_KEYS = [
  "find", "where", "maxNodes",
  "severities", "projects", "clouds",
  "layout", "groupBy", "sort", "columns",
];

// The filter panel docks beside the canvas on desktop. Below this the canvas is already
// capped at 70vh inside a scrolling page (see the <=800px block in styles.css), so there
// is nothing to dock beside and the panel falls back to the modal sheet.
const NARROW_VIEWPORT = "(max-width: 800px)";

const FILTER_PANEL_ID = "graph-filter-panel";
/** Table-only view state: repainted from the rows already fetched, never refetched. */
const TABLE_KEYS = ["page", "pageSize", "sortCol", "dir"];
const VIEWS_KEY = "sidekickai.graphQueries";
/** What a saved query remembers. The whole page state, minus transient panel/focus intent. */
const VIEW_PARAMS = [
  "find", "where", "columns", "view", "severities", "projects", "clouds",
  "layout", "groupBy", "sort", "sortCol", "dir", "pageSize", "maxNodes",
];

function isNarrowViewport() {
  return window.matchMedia(NARROW_VIEWPORT).matches;
}

function graphParams(params, defaults) {
  return {
    // The question. `find` is the structure and `where` the per-node property filters; see
    // graphQuery.js for the grammar of both.
    find: params.find || "",
    where: params.where || "",
    // This view's node budget: "" means the deployment's configured one. "Load more"
    // writes the next step here, so a widened view is shareable like any other.
    maxNodes: Number(params.maxNodes) || defaults.maxNodes || 0,
    maxNodesRaw: params.maxNodes == null ? "" : String(params.maxNodes),
    severities: params.severities || "",
    projects: params.projects || "",
    clouds: params.clouds || "",
    // Table view state. In the hash like everything else, so a configured table is a link.
    columns: params.columns || "",
    page: Math.max(1, Number(params.page) || 1),
    pageSize: Number(params.pageSize) || DEFAULT_PAGE_SIZE,
    sortCol: params.sortCol || "",
    dir: params.dir === "desc" ? "desc" : "asc",
    layout: (params.layout === "grouped" || params.layout === "lanes") ? params.layout : "",
    groupBy: params.groupBy || "",
    sort: params.sort || "",
    view: params.view === "table" ? "table" : "graph",
    q: params.q || "",
    pos: params.pos || "",
  };
}

// Manual node offsets (drag / Shift+arrows), hash-encoded as
// "encodedId:dx:dy,…" — deltas from the computed layout, so untouched nodes
// keep following the layout and moved nodes keep their nudge. Ids are
// URI-encoded per entry, which makes ":" and "," safe delimiters.
function parseOffsets(s) {
  const map = new Map();
  for (const entry of String(s || "").split(",")) {
    if (!entry) continue;
    const parts = entry.split(":");
    if (parts.length !== 3) continue;
    const dx = Number(parts[1]);
    const dy = Number(parts[2]);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
    try {
      map.set(decodeURIComponent(parts[0]), { dx, dy });
    } catch {
      /* malformed entry — skip */
    }
  }
  return map;
}

function encodeOffsets(map) {
  const parts = [];
  for (const [id, o] of map) {
    if (o.dx || o.dy) {
      parts.push(encodeURIComponent(id) + ":" + Math.round(o.dx) + ":" + Math.round(o.dy));
    }
  }
  return parts.join(",");
}

/**
 * The hash, as the endpoint's parameters.
 *
 * The two halves of the question are separate in the URL — `find` is rewritten by the builder,
 * `where` by the filter panel, and neither should churn the other — and one object on the
 * wire, because the server validates and evaluates a single tree.
 *
 * The filter panel's three dimensions fold onto node 0: they narrow what was FOUND, which is
 * the node the panel has always been about.
 */
function rpcParams(p) {
  const where = parseWhere(p.where);
  const put = (key, values) => {
    if (!values.length) return;
    if (!where.has(0)) where.set(0, new Map());
    where.get(0).set(key, values);
  };
  put("severity", listSplit(p.severities));
  put("cloud", listSplit(p.clouds));
  put("projects", listSplit(p.projects));
  return {
    query: applyWhere(queryOf(p), where),
    columns: parseColumns(p.columns),
    // Raw hash value; "" = use the server-configured default. Keeping the RPC params free of
    // bootstrap-derived values lets the initial fetch run in parallel with bootstrap.
    maxNodes: p.maxNodesRaw,
    layout: p.layout,
    groupBy: p.groupBy,
    sort: p.sort,
  };
}

/**
 * The query in the hash, or the default lens if it cannot be read.
 *
 * A truncated or hand-edited `find` must not blank the workbench — the page draws the default
 * and says so. `queryOf` is called from the render path as well as the RPC path, so it stays
 * silent here and the notice is raised once, where the page can see it.
 */
function queryOf(p) {
  try {
    return parseQuery(p.find);
  } catch {
    return defaultQuery();
  }
}

function queryIsBroken(p) {
  if (!p.find) return false;
  try {
    parseQuery(p.find);
    return false;
  } catch {
    return true;
  }
}

/** `columns` is "0:name.publisher,1:name" — per shown node, in pre-order. */
function parseColumns(text) {
  if (!text) return undefined;
  const out = [];
  for (const part of String(text).split(",")) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    const index = Number(part.slice(0, at));
    if (!Number.isInteger(index) || index < 0) continue;
    out[index] = part.slice(at + 1).split(".").filter(Boolean);
  }
  return out.length ? [...out].map((v) => v || null) : undefined;
}

function serializeColumns(groups) {
  return groups
    .map((g, i) => (g && g.length ? i + ":" + g.join(".") : ""))
    .filter(Boolean)
    .join(",");
}

export async function renderGraphPage(main, params, _ctx) {
  // Links written against the old page still arrive: inventory.js navigates with
  // `{seed: row.id}`, the asset sheet with `{seed, seedKind}`, and anything saved months ago
  // with `depth` / `kinds` / the three facets. They are translated once, here, into the query
  // that means the same thing and written back canonically — no caller has to change, and a
  // saved link still opens the view it described.
  const migrated = migrateLegacyParams(params);
  if (migrated) {
    params = { ...params, ...migrated };
    for (const k of ["seed", "seedKind", "depth", "expand", "kinds"]) delete params[k];
    setParams(params);
  }
  // A fresh visit opens on the product's primary lens — the same AI-agent view it always did,
  // now spelled out in the builder as `FIND AI Agent` rather than hidden in two facets.
  // Written into the hash so it is explicit, shareable and editable.
  if (params.find == null) {
    params = { ...params, find: serializeQuery(defaultQuery()) };
    setParams(params);
  }

  // Prefetch in parallel with bootstrap: two serial round trips become one. swrCall shares
  // the in-flight promise with load() below, and the vocabulary the builder needs rides along
  // beside it rather than costing a third.
  swrCall("api_runGraphQuery", rpcParams(graphParams(params, {}))).catch(() => {});
  swrCall("api_getQueryVocabulary", {}).catch(() => {});

  const boot = await bootstrap();
  const defaults = boot.settings || {};
  let state = graphParams(params, defaults);
  legendOpen = false; // hidden by default on each visit to the page

  // ------------------------------------------------------------------- frame
  const title = el("h1", { class: "workbench-title" }, "Security Graph");
  // The counts and "Load more" sit over the canvas, bottom-left, rather than in the
  // top bar: they describe what is drawn, so they belong beside it. Kept as one
  // element across repaints and re-attached after each clear(body).
  // Only the counts half is a live region; the controls beside it are not, or a screen
  // reader hears "Load more" read out as status on every filter change.
  const metaStatus = el("div", { class: "workbench-meta-status", role: "status" });
  const metaActions = el("div", { class: "workbench-meta-actions" });
  const meta = el("div", { class: "workbench-meta overlay is-empty" }, metaStatus, metaActions);
  let lastStatusText = "";
  const headActions = el("div", { class: "gq-head-actions" });
  const bar = el("div", { class: "workbench-bar" }, title, headActions);
  // The result count sits on the builder's first line, right-aligned, the way Wiz puts it:
  // it describes the question above it, not the picture below.
  const countText = el("span", { class: "num", role: "status" });
  const countNote = el("span", {});
  const countBox = el("div", { class: "gq-count" }, countText, countNote);
  const viewbar = el("div", { class: "gq-viewbar" });
  const controls = el("div", { class: "gq-viewbar-end" });
  // Two hit targets per chip: the label opens the panel at that filter's own section, only
  // the ✕ clears. `emptyText` keeps the band's height when nothing is applied — it sits
  // between the bar and the canvas, and showing/hiding it moved the whole picture the
  // first time a filter was applied.
  const chipsRow = filterChipRow({
    onPatch: (patch) => update(patch),
    onEdit: (e) => openFilters(true, sectionOf(e)),
    onClearAll: () => clearAllFilters(),
    emptyText: "No filters applied",
    fallbackFocus: null, // assigned below, once filterBtn exists
  });
  const body = el("div", { class: "workbench-body" });
  // The canvas and the filter panel are flex siblings inside the split, so an open panel
  // narrows the canvas rather than covering it — filters apply live, and a scrim over the
  // thing being filtered defeats the point. `body` stays the containing block, so the
  // overlays, the table, the empty states and the boot skeleton all follow it in for free.
  // The panel host is DOM-ordered after the canvas, matching its position on screen.
  const panelHost = el("div", { class: "filter-panel-host" });
  const split = el("div", { class: "workbench-split" }, body, panelHost);
  const barHost = el("div", {});
  const root = el("div", { class: "workbench" }, bar, barHost, viewbar, chipsRow, split);
  main.append(root);

  if (!boot.latestSync) {
    body.append(el("div", { class: "workbench-empty" }, emptyState(
      "No sync yet.",
      "Run “Sync now” in the sidebar — without credentials it loads the sample dataset.",
    )));
    return;
  }

  // ---------------------------------------------------------------- controls
  let lastData = null;
  // The kinds and relationships this tenant's graph actually holds. Fetched beside the first
  // query rather than folded into bootstrap, and the builder renders from whatever it has —
  // an empty vocabulary offers "any node" and "is related to", which is still a usable query.
  let vocab = { kinds: [], stepsFrom: {} };
  let graphApi = null;
  let matchIds = null;
  // The open panel, whichever way it is hosted: { close, docked }. Docked is the desktop
  // case (a flex sibling of the canvas); the modal sheet is the <=800px fallback.
  let filtersHost = null;
  let panelSync = null;
  let seq = 0;

  // Search (client-side highlight; graph view only).
  const searchInput = el("input", {
    type: "search",
    class: "graph-search",
    placeholder: "Search nodes",
    "aria-label": "Search nodes by name",
    value: state.q,
  });
  const onSearch = debounce(() => update({ q: searchInput.value }), 150);
  searchInput.addEventListener("input", onSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !graphApi || !matchIds || !matchIds.size || !lastData) return;
    e.preventDefault();
    const first = (lastData.layout.nodes || []).find((n) => matchIds.has(n.id));
    if (first) graphApi.focusNode(first.id);
  });
  const searchField = el("div", { class: "workbench-search" }, searchInput);

  // Arrange (layout mode) + Order (row sort).
  const arrangeSel = el("select", { "aria-label": "Arrange nodes" },
    el("option", { value: "" }, "Rows"),
    el("option", { value: "lanes" }, "Columns"),
    el("option", { value: "grouped:asset" }, "Group: asset (hub view)"),
    el("option", { value: "grouped:combo" }, "Group: toxic combo"),
    el("option", { value: "grouped:project" }, "Group: project"),
    el("option", { value: "grouped:cloud" }, "Group: cloud"),
    el("option", { value: "grouped:kind" }, "Group: node type"),
    el("option", { value: "grouped:severity" }, "Group: severity"),
  );
  arrangeSel.addEventListener("change", () => {
    // A new arrangement recomputes the whole picture — manual nudges reset.
    const v = arrangeSel.value;
    if (v === "") update({ layout: "", groupBy: "", pos: "" });           // Rows (default, horizontal)
    else if (v === "lanes") update({ layout: "lanes", groupBy: "", pos: "" }); // Columns (vertical)
    else update({ layout: "grouped", groupBy: v.slice(8), pos: "" });
  });

  const orderSel = el("select", { "aria-label": "Order nodes" },
    el("option", { value: "" }, "Smart order"),
    el("option", { value: "severity" }, "Severity first"),
    el("option", { value: "aars" }, "Highest AARS"),
    el("option", { value: "name" }, "Name (A–Z)"),
  );
  orderSel.addEventListener("change", () => update({ sort: orderSel.value, pos: "" }));

  // Filters panel trigger, with an applied-count badge (the number is the signal).
  const filterCount = el("span", { class: "filter-count", "aria-hidden": "true" });
  const filterBtn = el("button", {
    "aria-expanded": "false",
    "aria-controls": FILTER_PANEL_ID,
    onclick: () => (filtersHost ? closeFilters() : openFilters(true)),
  }, "Filters", filterCount);

  // Graph | Table as two always-visible segments rather than one button whose label named
  // the destination while aria-pressed named the origin — and whose width changed on every
  // toggle, shifting the whole right-aligned row. It moves onto its own labelled VIEW row,
  // where the reference screen puts it, but Graph stays the default: this page's canvas is
  // the product's centrepiece, and the toggle is one key away.
  const viewToggle = segmented({
    options: [
      { value: "table", label: "Table", icon: "table" },
      { value: "graph", label: "Graph", icon: "graph" },
    ].map((o) => ({
      value: o.value,
      label: el("span", {}, el("span", { class: "gq-view-icon" }, uiIcon(o.icon, 13)), o.label),
    })),
    value: state.view,
    onChange: (v) => update({ view: v }),
    ariaLabel: "View",
  });

  // Column chooser — table view only, since it configures the table.
  const columnsBtn = el("button", {
    "aria-haspopup": "dialog",
    onclick: () => openColumns(),
  }, uiIcon("columns", 14), el("span", { style: "margin-left:6px" }, "Columns"));

  // The chip row is built above the trigger it falls back to, so the reference is set here.
  chipsRow.fallbackFocus = filterBtn;

  // The builder owns the question; this row owns how the answer is read.
  viewbar.append(
    el("span", { class: "gq-kw" }, "View"),
    viewToggle,
    controls,
  );
  controls.append(searchField, selectField("Arrange", arrangeSel), selectField("Order", orderSel),
    columnsBtn, filterBtn);

  // ------------------------------------------------------------- header actions
  headActions.append(
    el("button", {
      onclick: () => {
        update({ find: serializeQuery(defaultQuery()), where: "", columns: "", page: "", sortCol: "" });
        toast("New search");
      },
    }, "New search"),
    // May be null when the browser blocks localStorage; `append` would stringify that to the
    // literal text "null" in the header.
    savedViewsControl() || el("span", {}),
    helpTip(
      el("span", { class: "helptip-mark", "aria-hidden": "true" }, "?"),
      [
        "A query reads FIND <entity> THAT <relationship> <entity>.",
        "Each row adds a step along the graph, and each shown step adds a group of columns to the table — so a row is one PATH, not one asset.",
        "The eye keeps a step in the traversal but drops its columns; NOT asserts the relationship is absent.",
      ],
      { label: "How the query builder works", term: "graph-query" },
    ),
  );

  // ------------------------------------------------------------- query builder
  const builder = queryBar({
    getQuery: () => queryOf(state),
    getVocab: () => vocab,
    getWhere: () => parseWhere(state.where),
    // The column groups the last answer carried, which is where a field's human label lives —
    // the builder's filter chips read it from there rather than keeping a second copy of the
    // field table on the client.
    getGroups: () => (lastData && lastData.groups) || [],
    onChange: (next, where) => {
      const patch = { find: serializeQuery(next), columns: "", page: "" };
      // Only written when the builder actually touched it. `where` is otherwise the filter
      // panel's to own, and rewriting it on every structural edit would fight that.
      if (where) patch.where = serializeWhere(where);
      update(patch);
    },
    countNode: countBox,
  });
  barHost.append(builder.node);

  // ------------------------------------------------------------ update cycle
  function update(patch) {
    const { params: current } = parseHash();
    const merged = { ...current, ...patch };
    setParams(merged);
    const prev = state;
    state = graphParams(merged, defaults);
    syncControls();
    if (DATA_KEYS.some((k) => String(prev[k]) !== String(state[k]))) {
      load();
    } else if (prev.view !== state.view) {
      paint(lastData);
    } else if (TABLE_KEYS.some((k) => String(prev[k]) !== String(state[k]))) {
      // Sort, page and page size are answered from the rows already in hand — no refetch, but
      // they DO need a repaint. `setParams` uses replaceState, which fires no hashchange, so
      // without this branch the URL changed and the table did not.
      paint(lastData);
    } else if (prev.q !== state.q) {
      applyHighlight();
      updateMeta(lastData);
    } else if (prev.pos !== state.pos) {
      // Drag commits already moved the DOM; a cleared pos snaps nodes back.
      if (state.pos) updateMeta(lastData);
      else paint(lastData);
    }
  }

  async function load() {
    const mySeq = ++seq;
    body.classList.add("updating");
    try {
      const data = await swrCall("api_runGraphQuery", rpcParams(state), (fresh) => {
        if (mySeq === seq) paint(fresh);
      });
      if (mySeq === seq) paint(data);
    } catch (e) {
      if (mySeq !== seq) return;
      body.classList.remove("updating");
      // A rejected query is the common case here now, and its message names the offending
      // kind or relationship — far more use than "couldn't load".
      clear(body).append(el("div", { class: "workbench-empty" },
        emptyState("This query didn't run.", String(e.message || e))));
    }
  }

  /**
   * The nodes on the canvas right now, minus the collapse placeholders — what the detail
   * sheet's prev/next walks. A SUMMARY node expands its parent rather than opening a
   * record, so stepping onto one would be a dead stop.
   */
  function openableNodes() {
    return ((lastData && lastData.nodes) || []).filter((n) => n.kind !== "SUMMARY");
  }

  const handlers = {
    onNodeOpen: (node) => {
      const nodes = openableNodes();
      const index = nodes.findIndex((n) => n.id === node.id);
      // One list across both record types: onNodeOpen dispatches by kind, so stepping from
      // an asset onto an issue opens the right sheet without the caller knowing which.
      const records = index === -1 ? null : {
        ids: nodes.map((n) => n.id),
        index,
        label: "node",
        open: (id, i) => handlers.onNodeOpen(nodes[i]),
      };
      // An ISSUE node carries the issue's own id (graphEnrich materializes one per open
      // issue), so it opens its issue sheet rather than doing nothing at all.
      if (node.kind === "ISSUE") {
        openIssueSheet(node.id, { title: node.name, records });
        return;
      }
      openAssetSheet(node.id, {
        seed: node,
        records,
        // "Focus in graph" is a query now: everything within two hops of this asset. Both
        // callbacks land on the same place — with the projection built from matched paths
        // rather than a BFS horizon, "expand" and "focus" are the same request.
        onFocusGraph: (id) => focusAsset(id),
        onExpand: (id) => focusAsset(id),
      });
    },
    // A query's projection is the set of matched paths, so it emits no "+N more" stubs and
    // this never fires. Kept as a no-op rather than removed: renderGraph calls it
    // unconditionally, and a missing handler would throw where a summary can still arrive
    // from a cached payload written by an older bundle.
    onSummaryExpand: () => {},
    onNodeMove: (id, dx, dy) => {
      const map = parseOffsets(state.pos);
      if (dx || dy) map.set(id, { dx, dy });
      else map.delete(id); // dragged back to its computed spot
      update({ pos: encodeOffsets(map) });
    },
    // Escape used to teleport focus to the Filters button, which made sense when Filters
    // was a modal you had to escape *to*. With the panel docked and persistent, leaving
    // the canvas is the browser's job — Tab. Escape here does nothing.
    onEscape: () => {},
  };

  /** Tear down the previous renderer before the canvas is cleared out from under it. */
  function releaseCanvas() {
    if (graphApi && graphApi.destroy) graphApi.destroy();
    graphApi = null;
  }

  /**
   * Nothing to draw, and three different reasons why. `payload.empty` is set only when the
   * whole graph document is missing; a filter set that admits no nodes comes back as a
   * perfectly ordinary payload with an empty node list, which used to render as a blank
   * canvas and a "0 of 812" in the corner — indistinguishable from a broken render, and
   * the state live filtering reaches most often.
   */
  function emptyCanvas(payload) {
    releaseCanvas();
    clear(body);
    const host = el("div", { class: "workbench-empty" });
    if (payload.empty) {
      host.append(emptyState("The last sync produced no graph.",
        "The sync completed but wrote no nodes. Check the Scans page for what it covered."));
    } else if (isNarrowing()) {
      host.append(
        emptyState("Nothing matches these filters.",
          "Widen one of them, or start from somewhere else in the estate."),
        el("div", { class: "workbench-empty-action" },
          el("button", { onclick: () => clearAllFilters() }, "Clear all filters")),
      );
    } else {
      // A query that matches nothing is the ordinary outcome of asking a precise question, and
      // it is a real answer — the estate holds no such path. Say that, and offer the way back.
      host.append(
        emptyState("No paths match this query.",
          "Every step has to match for a row to exist. Remove the last relationship, or mark it optional to keep the rows it would drop."),
        el("div", { class: "workbench-empty-action" },
          el("button", {
            onclick: () => update({ find: serializeQuery(defaultQuery()), where: "", columns: "", page: "" }),
          }, "Start a new search")),
      );
    }
    body.append(host, meta);
    updateMeta(payload.empty ? null : payload);
  }

  function paint(payload) {
    if (!payload) return;
    lastData = payload;
    body.classList.remove("updating");
    // The builder's filter chips read their field LABELS off the answer's column groups, and
    // the answer lands after the repaint that added the filter. Without this the chip shows
    // the raw key ("inactive") until the next unrelated edit. `sync` is idempotent and the
    // focus hand-off it can do is one-shot, so re-running it here costs nothing.
    builder.sync();
    if (payload.empty || (!(payload.nodes || []).length && !(payload.rows || []).length)) {
      emptyCanvas(payload);
      return;
    }
    payload.palette = boot.palette;
    payload.offsets = parseOffsets(state.pos);
    releaseCanvas();
    clear(body);
    if (state.view === "table") {
      body.append(el("div", { class: "workbench-table" }, queryTable(payload, {
        page: state.page,
        pageSize: state.pageSize,
        sort: state.sortCol,
        dir: state.dir,
        onPage: (p) => update({ page: p === 1 ? "" : String(p) }),
        onPageSize: (n) => update({ pageSize: String(n), page: "" }),
        onSort: (key) => update({
          sortCol: key,
          dir: state.sortCol === key && state.dir === "asc" ? "desc" : "asc",
          page: "",
        }),
        onOpen: (cell) => handlers.onNodeOpen({ id: cell.id, kind: cell.kind, name: cell.name }),
      })));
    } else {
      graphApi = renderGraph(body, payload, handlers);
      body.append(buildLegend(boot, payload));
      applyHighlight();
    }
    // The counts overlay describes the CANVAS — how much of the match set it managed to
    // draw. In table view it would float over the table's own footer saying nothing the
    // result count above has not already said, so it stays with the picture it is about.
    if (state.view !== "table") body.append(meta);
    updateMeta(payload);
  }

  // -------------------------------------------------------------------- meta
  /**
   * "Load more": raise THIS view's node budget by one step and refetch, leaving the
   * deployment's configured budget alone. Only offered on a capped view — an uncapped one
   * is already showing everything depth and filters admit, so a bigger budget would change
   * nothing. The step is one default budget's worth, and the server's clamp is the last
   * step: at the ceiling the button gives way to a note saying so, since a button that
   * can't do anything is worse than a sentence explaining why.
   */
  function loadMoreControl(payload) {
    const budget = Number(payload.options?.maxNodes) || Number(defaults.maxNodes) || 0;
    const ceiling = Number(defaults.maxNodesCeiling) || 400;
    if (!budget || budget >= ceiling) {
      return el("span", { class: "muted" }, `at the ${ceiling}-node maximum`);
    }
    const step = Math.max(25, Number(defaults.maxNodes) || 100);
    const next = Math.min(ceiling, budget + step);
    const more = next - budget;
    const btn = el("button", {
      class: "link",
      "aria-label":
        `Load ${more} more nodes, raising this view to ${next}. ` +
        `Showing ${payload.counts.shownNodes} of ${payload.counts.totalNodes}.`,
      onclick: () => {
        // The meta bar is rebuilt when the payload lands; until then the button must not
        // take a second press and skip a step.
        btn.disabled = true;
        btn.textContent = "Loading…";
        update({ maxNodes: String(next) });
      },
    }, `Load ${more} more`);
    return btn;
  }

  /**
   * The counts line and the controls beside it. They live in two elements because only the
   * first is a live region: the whole bar used to be `role="status"` with Load-more and
   * Reset-positions inside it, so every filter change re-announced the buttons as status
   * text — and rebuilding it wholesale destroyed the button that had just been pressed.
   *
   * Only the half that changed is rewritten, and the status text only when the sentence
   * actually differs: a search change routes through here too, so an unguarded rewrite
   * re-announced the whole line on every debounced keystroke.
   */
  function updateMeta(payload) {
    if (!payload || payload.empty) {
      metaStatus.textContent = "";
      lastStatusText = "";
      clear(metaActions);
      meta.classList.add("is-empty");
      updateCount(payload);
      return;
    }
    meta.classList.remove("is-empty");
    updateCount(payload);
    const c = payload.counts;
    const parts = [
      `${c.shownNodes.toLocaleString()} of ${c.totalNodes.toLocaleString()} nodes`,
      `${c.shownEdges.toLocaleString()} of ${c.totalEdges.toLocaleString()} edges`,
    ];
    if (payload.summaries && payload.summaries.length) {
      parts.push(`${payload.summaries.length} collapsed group${payload.summaries.length > 1 ? "s" : ""}`);
    }
    if (state.q.trim() && state.view !== "table") {
      const n = matchIds ? matchIds.size : 0;
      parts.push(`${n} match${n === 1 ? "" : "es"}`);
    }
    const text = parts.join(" · ");
    if (text !== lastStatusText) {
      lastStatusText = text;
      clear(metaStatus).append(el("span", { class: "num" }, text));
      if (c.capped) {
        metaStatus.append(helpTip(
          el("span", { class: "pill warn" }, "capped"),
          [
            `This view is capped at ${payload.options?.maxNodes || "its"} nodes to stay light.`,
            "Some neighbours — or, on a whole-estate view, some starting points — are not drawn.",
            "Load more to widen it a step at a time, or narrow the filters, start from a single asset or combination, or raise the node budget in Settings.",
          ],
          { label: "Why this view is capped", term: "depth-budget" },
        ));
      }
    }

    clear(metaActions);
    metaActions.append(...[
      c.capped ? loadMoreControl(payload) : null,
      movedCount()
        ? el("button", {
            class: "link", "data-nav": "reset-pos", onclick: () => update({ pos: "" }),
          }, `Reset positions (${movedCount()})`)
        : null,
    ].filter(Boolean));
  }

  function movedCount() {
    return parseOffsets(state.pos).size;
  }

  // ------------------------------------------------------------- result count
  /**
   * "41 results" — the number of matched PATHS, which is the number of rows the table holds
   * and not the number of nodes on the canvas. The two genuinely differ (fourteen agents and
   * fourteen identities are fourteen results over twenty-eight nodes), so the count sits with
   * the query that produced it and the node/edge counts stay in the overlay on the canvas.
   *
   * Both caveats are stated rather than implied: a capped row list still reports the true
   * total, and a truncated enumeration says the total is a floor instead of quietly printing
   * a number it cannot stand behind.
   */
  function updateCount(payload) {
    if (!payload || payload.empty) {
      countText.textContent = "";
      countNote.textContent = "";
      return;
    }
    const total = Number(payload.total) || 0;
    const prefix = payload.truncated ? "over " : "";
    countText.textContent = prefix + total.toLocaleString() + (total === 1 ? " result" : " results");
    clear(countNote);
    if (payload.truncated) {
      countNote.append(helpTip(el("span", { class: "pill warn" }, "partial"), [
        "This query has more matches than one pass can enumerate.",
        "The count is a floor, not a total. Narrow a step — or mark one optional — to get an exact answer.",
      ], { label: "Why the count is approximate" }));
    } else if (payload.capped) {
      countNote.append(helpTip(el("span", { class: "pill neutral" }, "showing first " + (payload.rows || []).length), [
        "Every match is counted, but only the first rows are shown.",
        "They are ordered worst-first, so the top of the list is the interesting end.",
      ], { label: "Why some rows are not listed" }));
    }
  }

  // ------------------------------------------------------------- saved views
  /** Saved views live per browser; a sandboxed iframe or private mode may refuse. */
  function readViews() {
    try {
      const raw = window.localStorage.getItem(VIEWS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((v) => v && v.name) : [];
    } catch {
      return null; // storage refused — the caller offers nothing rather than a broken control
    }
  }

  function savedViewsControl() {
    const views = readViews();
    if (views === null) return null;

    const sel = el("select", { "aria-label": "Saved queries" },
      el("option", { value: "" }, views.length ? "Saved queries…" : "No saved queries"),
      ...views.map((v, i) => el("option", { value: String(i) }, v.name)),
    );
    sel.addEventListener("change", () => {
      const v = views[Number(sel.value)];
      sel.value = "";
      if (!v) return;
      // A wholesale state change deserves a history entry, so Back returns to the query the
      // reader was on. Same call inventory.js makes for the same reason.
      navigate("graph", v.params);
    });

    const save = el("button", {
      onclick: async () => {
        const input = el("input", {
          type: "text", placeholder: "e.g. Agents running as a dormant identity",
          "aria-label": "Query name", style: "width:100%; margin-bottom:4px",
        });
        const ok = await confirmDialog({
          title: "Save this query",
          body: el("div", {},
            el("p", { class: "muted small" },
              "Saves the query, its columns and its filters in this browser. "
              + "To share it, copy the page link instead — the URL already carries all of it."),
            input),
          confirmLabel: "Save",
        });
        const name = input.value.trim();
        if (!ok || !name) return;
        const { params: hash } = parseHash();
        const params = {};
        for (const k of VIEW_PARAMS) if (hash[k]) params[k] = hash[k];
        const next = (readViews() || []).filter((v) => v.name !== name);
        next.unshift({ name, params });
        try {
          window.localStorage.setItem(VIEWS_KEY, JSON.stringify(next.slice(0, 12)));
        } catch {
          toast("Couldn't save — this browser is blocking local storage.", "error");
          return;
        }
        const rebuilt = savedViewsControl();
        if (rebuilt) headActions.replaceChild(rebuilt, headActions.children[1]);
        toast("Saved “" + name + "”");
      },
    }, "Save query");

    return el("div", { class: "saved-views" }, sel, save);
  }

  // ----------------------------------------------------------- column chooser
  /**
   * Which fields each column group shows. One toggle set per group, because a column belongs
   * to a NODE of the query — "Name" on its own would be ambiguous the moment a second group
   * exists, which is the same reason the table carries a two-level header.
   */
  function openColumns() {
    const groups = (lastData && lastData.groups) || [];
    if (!groups.length) return;
    const chosen = groups.map((g) => g.fields.map((f) => f.key));
    openSheet((body2, close) => {
      const host = el("div", { class: "gq-columns" });
      groups.forEach((group, gi) => {
        const pills = togglePills({
          options: group.available.map((f) => ({ value: f.key, label: f.label })),
          selected: chosen[gi],
          ariaLabel: group.label + " columns",
          pillClass: "kind-pill",
          sevClass: false,
          onToggle: (key) => {
            const at = chosen[gi].indexOf(key);
            if (at === -1) chosen[gi].push(key);
            // Never all the way to nothing: a group with no columns is a group that vanishes
            // from the table with no way to bring it back.
            else if (chosen[gi].length > 1) chosen[gi].splice(at, 1);
            pills.set(chosen[gi]);
            update({ columns: serializeColumns(chosen), page: "" });
          },
        });
        host.append(el("div", { class: "gq-columns-group" },
          el("h3", { class: "label" }, group.label), pills));
      });
      host.append(el("div", {},
        el("button", { class: "link", onclick: () => { update({ columns: "", page: "" }); close(); } },
          "Reset to defaults")));
      body2.append(host);
    }, { title: "Columns", ariaLabel: "Choose columns", width: "min(420px, 94vw)" });
  }

  // ------------------------------------------------------------------ search
  function applyHighlight() {
    const q = state.q.trim().toLowerCase();
    if (!graphApi || !lastData || lastData.empty) {
      matchIds = null;
      return;
    }
    if (!q) {
      matchIds = null;
      graphApi.setHighlight(null);
      return;
    }
    matchIds = new Set(
      lastData.nodes
        .filter((n) => String(n.name).toLowerCase().includes(q))
        .map((n) => n.id),
    );
    graphApi.setHighlight(matchIds);
  }

  // ------------------------------------------------------------------- chips
  function chipEntries() {
    return filterEntries(state, defaults);
  }

  /** Is anything constraining the query — including the defaults the page seeded itself? */
  function isNarrowing() {
    return isNarrowingSet(chipEntries());
  }

  function syncControls() {
    // Top bar.
    arrangeSel.value = state.layout === "grouped" ? "grouped:" + (state.groupBy || "combo")
      : state.layout === "lanes" ? "lanes"
      : "";
    orderSel.value = state.sort;
    if (document.activeElement !== searchInput && searchInput.value !== state.q) {
      searchInput.value = state.q;
    }
    // Search highlights nodes on the canvas, and Arrange/Order lay them out. None of the
    // three means anything to a table of paths, so they are hidden there rather than left
    // sitting inert beside a control that does work.
    const graphOnly = state.view === "table" ? "none" : "";
    searchField.style.display = graphOnly;
    for (const f of controls.querySelectorAll(".select-field")) f.style.display = graphOnly;
    columnsBtn.style.display = state.view === "table" ? "" : "none";
    viewToggle.set(state.view);
    builder.sync();

    // Chips + count badge. The badge counts what the USER applied — the AI-agent lens the
    // page seeds on a fresh visit is shown as a chip and clearable, but it is not a filter
    // anyone chose, and counting it had the page opening with "2 filters applied".
    const entries = chipEntries();
    const applied = appliedCount(entries);
    filterCount.textContent = applied ? String(applied) : "";
    filterBtn.setAttribute("aria-label", applied ? `Filters, ${applied} applied` : "Filters");
    chipsRow.sync(entries);

    if (panelSync) panelSync();
  }

  /**
   * Clears the FILTERS, not the question. The query in the builder is the thing the user
   * typed; wiping it from a control labelled "clear all filters" would throw away work that
   * the chip row never claimed to own.
   */
  function clearAllFilters() {
    update({ maxNodes: "", severities: "", projects: "", clouds: "", page: "" });
    filterBtn.focus();
  }

  /** Everything within two hops of one asset — the old seed-and-depth view, as a query. */
  function focusAsset(id) {
    update({
      find: "ANY(*ANY2.ANY)",
      where: "0.id." + encodeURIComponent(id),
      columns: "", page: "", sortCol: "",
    });
  }

  // --------------------------------------------------------- filters panel
  /**
   * On desktop the panel is part of the workbench: a flex sibling of the canvas, no
   * scrim, no focus trap, `role="region"` rather than `dialog`. That is the whole point —
   * these filters apply live, and the modal sheet it replaces put a scrim over the exact
   * graph the user was filtering. Below 800px the canvas is already capped at 70vh inside
   * a scrolling page, so there is nothing to dock beside and the modal sheet is right.
   *
   * `section` optionally names the field group to put focus on (a chip's label opens the
   * panel "at" its own filter). It is deliberately not a hash param: transient focus
   * intent does not belong in a link someone else will open.
   */
  function openFilters(takeFocus, section) {
    if (filtersHost) {
      if (section) focusSection(section);
      else if (takeFocus) focusPanelStart();
      return;
    }
    update({ panel: "filters" });
    const fc = buildFilterControls();
    panelSync = fc.sync;
    filtersHost = isNarrowViewport() ? openModalFilters(fc, takeFocus) : dockFilters(fc, takeFocus);
    filterBtn.setAttribute("aria-expanded", "true");
    if (section) focusSection(section);
  }

  function closeFilters() {
    if (!filtersHost) return;
    filtersHost.close();
  }

  // Set while the panel is being moved between hosts across the breakpoint, so the close
  // half of the move doesn't clear `panel=filters` or yank focus back to the trigger.
  let rehosting = false;

  function afterClose(returnFocus) {
    filtersHost = null;
    panelSync = null;
    if (rehosting) return;
    filterBtn.setAttribute("aria-expanded", "false");
    update({ panel: "" });
    // Guarded: the panel outlives many repaints, so anything captured at open time may
    // have been destroyed by now. The trigger is the honest place to come back to.
    if (returnFocus && filterBtn.isConnected) filterBtn.focus();
  }

  function dockFilters(fc, takeFocus) {
    const heading = el("h2", { class: "filter-panel-title", id: FILTER_PANEL_ID + "-title" }, "Filters");
    const closeBtn = el("button", {
      class: "sheet-close", "aria-label": "Close filters", onclick: () => closeFilters(),
    }, "✕");
    const panelBody = el("div", { class: "filter-panel-body" }, fc.root);
    const panel = el("aside", {
      class: "filter-panel", id: FILTER_PANEL_ID,
      role: "region", "aria-labelledby": FILTER_PANEL_ID + "-title",
    },
      el("div", { class: "filter-panel-header" }, heading, closeBtn),
      panelBody);

    // Escape is scoped to the panel. A document-level handler (what openSheet uses, which
    // is correct for a modal) would also fire for an Escape pressed on the canvas, closing
    // the panel out from under someone who meant to leave the graph.
    panel.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeFilters();
    });

    panelHost.append(panel);
    root.classList.add("panel-open");
    if (takeFocus) focusPanelStart();
    return {
      docked: true,
      focusStart: () => closeBtn.focus(),
      close: () => {
        panel.remove();
        root.classList.remove("panel-open");
        afterClose(true);
      },
    };
  }

  function openModalFilters(fc, takeFocus) {
    let sheet = null;
    sheet = openSheet((sheetBody) => sheetBody.append(fc.root), {
      title: "Filters",
      subtitle: "Changes apply immediately",
      width: "min(400px, 92vw)",
      autoFocus: !!takeFocus,
      onClose: () => afterClose(false),
    });
    return { docked: false, focusStart: () => {}, close: () => sheet.close() };
  }

  function focusPanelStart() {
    if (filtersHost) filtersHost.focusStart();
  }

  function focusSection(key) {
    const target = (filtersHost && filtersHost.docked ? panelHost : document)
      .querySelector(`[data-filter-section="${key}"] .filter-section-focus`);
    if (target) target.focus();
    else focusPanelStart();
  }

  // A viewport that crosses the breakpoint while the panel is open would leave a docked
  // panel inside a page that no longer has room for it (or a modal sheet on a desktop that
  // does). Re-host in the other mode, keeping the panel open. There is no page-teardown
  // hook in the router — it just clears `main` — so the listener retires itself once the
  // workbench it belongs to is off the document.
  const narrowQuery = window.matchMedia(NARROW_VIEWPORT);
  const onBreakpoint = () => {
    if (!root.isConnected) {
      narrowQuery.removeEventListener("change", onBreakpoint);
      return;
    }
    const shouldDock = !isNarrowViewport();
    if (!filtersHost || filtersHost.docked === shouldDock) return;
    rehosting = true;
    closeFilters();
    rehosting = false;
    openFilters(false);
  };
  if (narrowQuery.addEventListener) narrowQuery.addEventListener("change", onBreakpoint);

  function buildFilterControls() {
    const fields = el("div", { class: "filter-fields" });

    // Severity chips.
    const sevRow = togglePills({
      options: (boot.palette?.order || []).filter((x) => x !== "UNKNOWN"),
      selected: listSplit(state.severities),
      ariaLabel: "Severity filter",
      onToggle: (s) => {
        const active = new Set(listSplit(state.severities));
        if (active.has(s)) active.delete(s);
        else active.add(s);
        update({ severities: listJoin([...active]) });
      },
    });
    const sevBtns = sevRow.buttons;

    const opts = boot.filterOptions || { kinds: [], clouds: [], projects: [] };

    // Project / cloud selects (single-value quick filters; "" = all).
    const projSel = plainSelect("Project", opts.projects);
    projSel.addEventListener("change", () => update({ projects: projSel.value }));
    const cloudSel = plainSelect("Cloud", opts.clouds);
    cloudSel.addEventListener("change", () => update({ clouds: cloudSel.value }));

    const sevCount = el("span", { class: "filter-section-count" });
    fields.append(
      section("severity", "Severity", sevRow, null, sevCount),
      section("projects", "Project", projSel),
      section("clouds", "Cloud", cloudSel),
      el("div", { class: "filter-fields-footer" },
        el("button", { class: "link", onclick: () => clearAllFilters() }, "Clear all filters")),
    );

    // Reflect chip-clears and Clear-all while the panel stays open. Everything the panel
    // shows about state is written here — nothing is left to build time, or it goes stale
    // the moment a chip is cleared from the other side of the page.
    function sync() {
      const active = new Set(listSplit(state.severities));
      for (const [s, btn] of sevBtns) {
        btn.setAttribute("aria-pressed", active.has(s) ? "true" : "false");
      }
      sevCount.textContent = active.size ? String(active.size) : "";

      projSel.value = state.projects;
      cloudSel.value = state.clouds;
    }
    sync();

    return { root: fields, sync };
  }

  function plainSelect(labelText, options, format) {
    const sel = el("select", { "aria-label": labelText },
      el("option", { value: "" }, `All ${labelText.toLowerCase()}s`),
      ...options.map((o) => el("option", { value: o }, format ? format(o) : o)),
    );
    const current = { "Project": state.projects, "Cloud": state.clouds }[labelText];
    if (current) sel.value = current;
    return sel;
  }

  // ---------------------------------------------------------------- boot-up
  // The first load is awaited so the route overlay covers it; later loads are
  // in-place and keep the previous view visible while updating.
  // A full-bleed skeleton fills the canvas until the first paint, so the boot
  // splash reveals a laid-out workbench rather than an empty pane; paint()/load()
  // clear the body and swap in the graph.
  body.append(el("div", {
    class: "graph-skeleton", role: "status", "aria-label": "Loading graph",
    style: "position:absolute; inset:12px; border-radius:var(--radius-lg); overflow:hidden",
  }, skeleton("chart")));
  // The builder renders immediately from whatever vocabulary it has and re-renders when the
  // real one lands, so a slow tenant never blocks the first paint.
  swrCall("api_getQueryVocabulary", {}).then((v) => {
    if (!root.isConnected || !v || v.empty) return;
    vocab = v;
    builder.sync();
  }).catch(() => {});

  // A `find` that could not be parsed has already fallen back to the default lens. Say so once
  // — a link that quietly opens a different query than it names is worse than an error.
  if (queryIsBroken(state)) {
    toast("That link's query couldn't be read — showing the default search instead.", "warn");
  }

  syncControls();
  await load();
  if (params.panel === "filters") openFilters(false);
}

/**
 * One field group in the filter panel: a hairline-ruled section with an uppercase title
 * (DESIGN.md names sheet section titles as the label role), an optional count of what is
 * selected, an optional per-section action, and the controls.
 *
 * `key` is the anchor a filter chip's label jumps to, and `.filter-section-focus` marks
 * the element that takes focus when it does — the heading, which is made programmatically
 * focusable so the jump lands on the section's name rather than on its first control.
 */
function section(key, labelText, control, action, count) {
  return el("div", { class: "filter-section", "data-filter-section": key },
    el("div", { class: "filter-section-head" },
      el("h3", { class: "label filter-section-focus", tabindex: "-1" }, labelText, count || null),
      action || null),
    control,
  );
}

function buildLegend(boot, payload) {
  const grouped = payload.layout && payload.layout.mode === "grouped";
  const groupBy = (payload.options && payload.options.groupBy) || "combo";

  // Native <details> disclosure: standard, keyboard-accessible, and works with
  // no script. Collapsed shows only the toggle; the overlay is bottom-anchored
  // (see .graph-legend.overlay) so the key grows upward over the canvas.
  const legend = el("details", { class: "graph-legend overlay", open: legendOpen });
  legend.addEventListener("toggle", () => { legendOpen = legend.open; });

  const body = el("div", { class: "legend-body" });
  body.append(
    el("span", { class: "legend-item" },
      el("span", { class: "legend-swatch-halo", "aria-hidden": "true" }),
      "TC = toxic combination member"),
    el("span", { class: "legend-item" },
      el("span", { class: "legend-swatch-negated", "aria-hidden": "true" }),
      "dashed = missing guardrail"),
  );
  if (grouped) {
    body.append(el("span", { class: "legend-item" },
      el("span", { class: "legend-swatch-group", "aria-hidden": "true" }),
      `box = ${GROUP_LABELS[groupBy] || groupBy} group`));
  }
  // Node-category color key (color reinforces the kind icon + label).
  for (const cat of CATEGORY_ORDER) {
    body.append(el("span", { class: "legend-item" },
      el("span", {
        class: "legend-swatch-cat", "aria-hidden": "true",
        style: `--swatch: var(--cat-${cat}-ink)`,
      }),
      CATEGORY_LABELS[cat]));
  }
  for (const s of (boot.palette?.order || []).filter((x) => x !== "UNKNOWN" && x !== "INFO")) {
    body.append(el("span", { class: "legend-item" }, sevBadge(s)));
  }
  body.append(
    el("span", { class: "legend-item muted" },
      "“+N more” pills expand collapsed neighbors"),
    el("span", { class: "legend-item muted" },
      "drag (or Shift+arrows) repositions a node"),
  );

  // Collapsed, this is a labelled pill in the corner opposite the counts. It used to be a
  // round "?", which everywhere else in software means help — while what is behind it is
  // the definition of the canvas's entire vocabulary: what the crimson halo means, what a
  // dashed edge means, what each category colour is. The word does that work; a glyph
  // could not.
  legend.append(el("summary", { class: "legend-toggle" }, "Key"), body);
  return legend;
}
