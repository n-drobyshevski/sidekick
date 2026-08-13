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

import { bootstrap, listJoin, listSplit, parseHash, setParams, swrCall } from "../store.js";
import { openAssetSheet, openIssueSheet } from "../detailSheets.js";
import { graphTable, renderGraph } from "../graphView.js";
import { CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, kindLabel } from "../icons.js";
import { appliedCount, filterEntries, isNarrowingSet, sectionOf } from "./graphChips.js";
import {
  clear, el, emptyState, filterChipRow, filterCombobox, helpTip, openSheet, segmented,
  selectField, sevBadge, skeleton, togglePills,
} from "../ui.js";

const DEPTH_TEXT = {
  1: "Depth 1: seeds and their direct relationships",
  2: "Depth 2: assets, identities and findings",
  3: "Depth 3: full reach — data, compute and supply chain",
};

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
  "seed", "seedKind", "depth", "expand", "maxNodes",
  "severities", "kinds", "projects", "clouds",
  "layout", "groupBy", "sort",
];

const MIN_DEPTH = 1;
const MAX_DEPTH = 3;

// The filter panel docks beside the canvas on desktop. Below this the canvas is already
// capped at 70vh inside a scrolling page (see the <=800px block in styles.css), so there
// is nothing to dock beside and the panel falls back to the modal sheet.
const NARROW_VIEWPORT = "(max-width: 800px)";

// What a fresh visit seeds into the hash — the product's primary lens. Named here so the
// chip layer can label those chips as defaults rather than counting them as filters the
// user applied.
const DEFAULT_SEED_KIND = "scored";
const DEFAULT_KINDS = "AI_AGENT";
const FILTER_PANEL_ID = "graph-filter-panel";

function isNarrowViewport() {
  return window.matchMedia(NARROW_VIEWPORT).matches;
}

function clampDepth(n) {
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.round(n) || MIN_DEPTH));
}

function graphParams(params, defaults) {
  return {
    seed: params.seed || "",
    seedKind: params.seedKind || "",
    // Clamped to the range the UI can express. The server clamps its own copy, but the
    // client's used to run free: a hash carrying depth=7 left the depth control with no
    // stop selected and DEPTH_TEXT[7] undefined.
    depth: clampDepth(Number(params.depth) || defaults.defaultDepth || 2),
    depthRaw: params.depth == null ? "" : String(params.depth),
    // This view's node budget: "" means the deployment's configured one. "Load more"
    // writes the next step here, so a widened view is shareable like any other.
    maxNodes: Number(params.maxNodes) || defaults.maxNodes || 0,
    maxNodesRaw: params.maxNodes == null ? "" : String(params.maxNodes),
    expand: params.expand || "",
    severities: params.severities || "",
    kinds: params.kinds || "",
    projects: params.projects || "",
    clouds: params.clouds || "",
    layout: (params.layout === "grouped" || params.layout === "lanes") ? params.layout : "",
    groupBy: params.groupBy || "",
    sort: params.sort || "",
    view: params.view || "graph",
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

function rpcParams(p) {
  return {
    seed: p.seed,
    seedKind: p.seedKind,
    // Raw hash value; "" = use the server-configured default. Keeping the RPC
    // params free of bootstrap-derived values lets the initial graph fetch run
    // in parallel with bootstrap (same cache key either way).
    depth: p.depthRaw,
    maxNodes: p.maxNodesRaw,
    expand: listSplit(p.expand),
    severities: listSplit(p.severities),
    kinds: listSplit(p.kinds),
    projects: listSplit(p.projects),
    clouds: listSplit(p.clouds),
    layout: p.layout,
    groupBy: p.groupBy,
    sort: p.sort,
  };
}

export async function renderGraphPage(main, params, _ctx) {
  // A fresh visit opens on a default view: the Start-from set to all scored
  // assets (AARS > 0) plus the node-type filter set to AI agents — the product's
  // primary lens. Each default is independent and only fills in when its own
  // control is unset; a deep-link (which carries a seed) suppresses both so the
  // linked asset's own neighborhood shows unfiltered. Written into the hash so
  // the defaults are explicit, shareable, and clearable (clearing shows all
  // until the next fresh visit). Applied before the prefetch so the first load
  // still takes a single round trip.
  if (params.seed == null) {
    const next = { ...params };
    if (params.seedKind == null) next.seedKind = DEFAULT_SEED_KIND;
    if (params.kinds == null) next.kinds = DEFAULT_KINDS;
    if (next.seedKind !== params.seedKind || next.kinds !== params.kinds) {
      params = next;
      setParams(params);
    }
  }

  // Prefetch the graph in parallel with bootstrap: two serial round trips
  // become one. swrCall shares the in-flight promise with load() below.
  swrCall("api_getGraph", rpcParams(graphParams(params, {}))).catch(() => {});

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
  const controls = el("div", { class: "workbench-controls" });
  const bar = el("div", { class: "workbench-bar" }, title, controls);
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
  const root = el("div", { class: "workbench" }, bar, chipsRow, split);
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
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => update({ q: searchInput.value }), 150);
  });
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
  // toggle, shifting the whole right-aligned row.
  const viewToggle = segmented({
    options: [{ value: "graph", label: "Graph" }, { value: "table", label: "Table" }],
    value: state.view,
    onChange: (v) => update({ view: v }),
    ariaLabel: "View",
  });

  // The chip row is built above the trigger it falls back to, so the reference is set here.
  chipsRow.fallbackFocus = filterBtn;

  // Three zones, hairline-ruled: what to draw, how to narrow it, how to read it. Five
  // identical controls in one uniform gap was density without hierarchy.
  controls.append(
    el("div", { class: "workbench-controls__group" },
      searchField, selectField("Arrange", arrangeSel), selectField("Order", orderSel)),
    el("div", { class: "workbench-controls__group" }, filterBtn),
    el("div", { class: "workbench-controls__group" }, viewToggle),
  );

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
      const data = await swrCall("api_getGraph", rpcParams(state), (fresh) => {
        if (mySeq === seq) paint(fresh);
      });
      if (mySeq === seq) paint(data);
    } catch (e) {
      if (mySeq !== seq) return;
      body.classList.remove("updating");
      clear(body).append(el("div", { class: "workbench-empty" },
        emptyState("Couldn't load the graph.", String(e.message || e))));
    }
  }

  const handlers = {
    onNodeOpen: (node) => {
      // An ISSUE node carries the issue's own id (graphEnrich materializes one per open
      // issue), so it opens its issue sheet rather than doing nothing at all.
      if (node.kind === "ISSUE") {
        openIssueSheet(node.id, { title: node.name });
        return;
      }
      openAssetSheet(node.id, {
        seed: node,
        onFocusGraph: (id) => update({ seed: id, seedKind: "asset", expand: "" }),
        onExpand: (id) => {
          const expanded = new Set(listSplit(state.expand));
          expanded.add(id);
          update({ expand: listJoin([...expanded]) });
        },
      });
    },
    onSummaryExpand: (node) => {
      // Expanding a summary lifts its parent's caps.
      const parentId = node.id.split("|")[1];
      const expanded = new Set(listSplit(state.expand));
      expanded.add(parentId);
      update({ expand: listJoin([...expanded]) });
    },
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
      const deeper = state.depth < MAX_DEPTH;
      host.append(
        emptyState(`This starting point has no connections at depth ${state.depth}.`,
          deeper ? "Nothing reaches it within that many hops." : null),
        deeper
          ? el("div", { class: "workbench-empty-action" },
              el("button", { onclick: () => update({ depth: String(state.depth + 1), expand: "" }) },
                `Try depth ${state.depth + 1}`))
          : null,
      );
    }
    body.append(host, meta);
    updateMeta(payload.empty ? null : payload);
  }

  function paint(payload) {
    if (!payload) return;
    lastData = payload;
    body.classList.remove("updating");
    if (payload.empty || !(payload.nodes || []).length) {
      emptyCanvas(payload);
      return;
    }
    payload.palette = boot.palette;
    payload.offsets = parseOffsets(state.pos);
    releaseCanvas();
    clear(body);
    if (state.view === "table") {
      body.append(el("div", { class: "workbench-table" }, graphTable(payload, handlers)));
    } else {
      graphApi = renderGraph(body, payload, handlers);
      body.append(buildLegend(boot, payload));
      applyHighlight();
    }
    body.append(meta);
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
      return;
    }
    meta.classList.remove("is-empty");
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
          { label: "Why this view is capped" },
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
    return filterEntries(state, defaults, {
      comboLegend: boot.comboLegend,
      defaultSeedKind: DEFAULT_SEED_KIND,
      defaultKinds: DEFAULT_KINDS,
    });
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
    searchField.style.display = state.view === "table" ? "none" : "";
    viewToggle.set(state.view);

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

  function clearAllFilters() {
    update({
      seed: "", seedKind: "", expand: "", maxNodes: "",
      severities: "", kinds: "", projects: "", clouds: "",
      depth: String(defaults.defaultDepth || 2),
    });
    filterBtn.focus();
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

    // Start from: two presets, then one row per toxic combination, then every asset in
    // the estate. This was a native <select> carrying one <option> per asset — the page's
    // most important control and its least usable one at any real tenant size.
    const comboOptions = (boot.comboLegend || []).map((g) => ({
      value: `combo:${g.id}`, label: g.shortLabel, group: "Toxic combinations",
    }));
    const seedBox = filterCombobox({
      value: seedValue(),
      pinnedRows: [
        { value: "", label: "All toxic combinations" },
        { value: "scored", label: "All scored assets (AARS > 0)" },
      ],
      options: comboOptions,
      // A graph seeded from a derived risk node (via "Focus graph here") has an id the
      // asset options endpoint never returns, so the list cannot name it. Show the id
      // rather than reading as "nothing selected".
      fallbackLabel: state.seed || "",
      defaultLabel: "All toxic combinations",
      ariaLabel: "Graph starting point",
      searchPlaceholder: "Search assets and combinations…",
      onChange: (v) => {
        if (v === "scored") update({ seed: "", seedKind: "scored", expand: "" });
        else if (!v) update({ seed: "", seedKind: "", expand: "" });
        else if (v.startsWith("combo:")) update({ seed: v.slice(6), seedKind: "combo", expand: "" });
        else update({ seed: v.slice(6), seedKind: "asset", expand: "" });
      },
    });
    // Lazily fill the asset list so the panel opens without waiting on inventory. The
    // picker needs every asset but only its id/name/kind, so it asks for the slim option
    // list rather than the inventory table's rows (which arrive one page at a time).
    // setOptions keeps any open popover usable — no focus move, no onChange.
    swrCall("api_getAssetOptions", {}).then((inv) => {
      seedBox.setOptions([
        ...comboOptions,
        ...inv.rows.map((row) => ({
          value: `asset:${row.id}`, label: row.name, hint: kindLabel(row.kind), group: "Assets",
        })),
      ]);
    }).catch(() => {});

    // Depth: three stops and the sentence that explains the one you picked. A three-stop
    // slider is a segmented control in costume, and DEPTH_TEXT existed only as
    // aria-valuetext — written, and invisible to everyone who could see the screen.
    const depthHintId = "graph-depth-hint";
    const depthHint = el("div", { class: "field-hint small muted", id: depthHintId },
      DEPTH_TEXT[state.depth]);
    const depthBtns = new Map();
    const depthGroup = el("div", {
      class: "segmented", role: "group",
      "aria-label": "Visualization depth", "aria-describedby": depthHintId,
    });
    for (let d = MIN_DEPTH; d <= MAX_DEPTH; d += 1) {
      const btn = el("button", {
        "aria-pressed": state.depth === d ? "true" : "false",
        onclick: () => update({ depth: String(d), expand: "" }),
      }, String(d));
      depthBtns.set(d, btn);
      depthGroup.append(btn);
    }

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

    // Node type: multi-select toggle pills grouped by semantic category, mirroring
    // the severity pill pattern above (as opposed to project/cloud, which stay
    // single-value quick filters below).
    const opts = boot.filterOptions || { kinds: [], clouds: [], projects: [] };
    const kindBtns = new Map();
    const kindFilterRoot = el("div", { class: "kind-filter" });
    const byCategory = new Map();
    for (const k of opts.kinds) {
      const cat = categoryOf(k);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(k);
    }
    const cats = [...CATEGORY_ORDER, ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];
    // One collapsible group per category, each summary counting its own selection, so the
    // longest facet in the panel stops being an undifferentiated wall of pills. Native
    // <details> — the legend already proves the pattern, and it costs no keyboard wiring.
    const kindGroups = [];
    for (const cat of cats) {
      const kinds = byCategory.get(cat);
      if (!kinds || !kinds.length) continue;
      kinds.sort((a, b) => kindLabel(a).localeCompare(kindLabel(b)));
      const label = CATEGORY_LABELS[cat] || cat;
      const pillRow = togglePills({
        options: kinds.map((k) => ({ value: k, label: kindLabel(k) })),
        selected: listSplit(state.kinds),
        ariaLabel: label + " node types",
        // Neutral base, crimson when selected: a chosen "AI Agent" must not look like a
        // chosen severity level, which is what the shared sev- tint would make it.
        pillClass: "kind-pill",
        sevClass: false,
        onToggle: (k) => {
          const active = new Set(listSplit(state.kinds));
          if (active.has(k)) active.delete(k); else active.add(k);
          update({ kinds: listJoin([...active]) });
        },
      });
      for (const [k, btn] of pillRow.buttons) kindBtns.set(k, btn);
      const count = el("span", { class: "pill-group-count" });
      const box = el("details", { class: "disclosure pill-group" },
        el("summary", { class: "disclosure-toggle" },
          el("span", { class: "pill-group-label" }, label), count),
        pillRow);
      // A user who opens a group by hand keeps it open: sync() may force a group OPEN
      // (a selection must never hide inside a collapsed section) but never force it shut.
      box.addEventListener("toggle", () => { if (box.open) box.dataset.userOpened = "1"; });
      kindGroups.push({ kinds, box, count });
      kindFilterRoot.append(box);
    }
    // Always rendered, enabled only when there is something to clear. Inserting and
    // removing it on a filter change would delete the control under the pointer that just
    // used it, and drop focus to the body.
    const clearKinds = el("button", {
      class: "link", onclick: () => update({ kinds: "" }),
    }, "Clear node types");

    // Project / cloud selects (single-value quick filters; "" = all).
    const projSel = plainSelect("Project", opts.projects);
    projSel.addEventListener("change", () => update({ projects: projSel.value }));
    const cloudSel = plainSelect("Cloud", opts.clouds);
    cloudSel.addEventListener("change", () => update({ clouds: cloudSel.value }));

    const sevCount = el("span", { class: "filter-section-count" });
    const kindCount = el("span", { class: "filter-section-count" });
    fields.append(
      section("start", "Start from", seedBox),
      section("depth", "Depth", el("div", { class: "depth-field" }, depthGroup, depthHint)),
      section("severity", "Severity", sevRow, null, sevCount),
      section("kinds", "Node type", kindFilterRoot, clearKinds, kindCount),
      section("projects", "Project", projSel),
      section("clouds", "Cloud", cloudSel),
      el("div", { class: "filter-fields-footer" },
        el("button", { class: "link", onclick: () => clearAllFilters() }, "Clear all filters")),
    );

    // Reflect chip-clears and Clear-all while the panel stays open. Everything the panel
    // shows about state is written here — nothing is left to build time, or it goes stale
    // the moment a chip is cleared from the other side of the page.
    function sync() {
      seedBox.setValue(seedValue());
      for (const [d, btn] of depthBtns) {
        btn.setAttribute("aria-pressed", state.depth === d ? "true" : "false");
      }
      depthHint.textContent = DEPTH_TEXT[state.depth];

      const active = new Set(listSplit(state.severities));
      for (const [s, btn] of sevBtns) {
        btn.setAttribute("aria-pressed", active.has(s) ? "true" : "false");
      }
      sevCount.textContent = active.size ? String(active.size) : "";

      const activeKinds = new Set(listSplit(state.kinds));
      for (const [k, btn] of kindBtns) {
        btn.setAttribute("aria-pressed", activeKinds.has(k) ? "true" : "false");
      }
      kindCount.textContent = activeKinds.size ? String(activeKinds.size) : "";
      clearKinds.disabled = !activeKinds.size;
      for (const g of kindGroups) {
        const picked = g.kinds.filter((k) => activeKinds.has(k)).length;
        g.count.textContent = picked ? `${picked} of ${g.kinds.length}` : String(g.kinds.length);
        if (picked && !g.box.open) g.box.open = true; // open-only: never collapse by hand
      }

      projSel.value = state.projects;
      cloudSel.value = state.clouds;
    }
    sync();

    return { root: fields, sync };
  }

  /** The seed as one combobox value: "" | "scored" | "combo:<id>" | "asset:<id>". */
  function seedValue() {
    if (state.seedKind === "scored") return "scored";
    if (!state.seed) return "";
    return state.seedKind === "combo" ? `combo:${state.seed}` : `asset:${state.seed}`;
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
