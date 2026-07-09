// Security Graph — the centerpiece, as a full-page workbench. The server computes
// a depth-limited projection + deterministic layout (lanes or grouped clusters);
// this page owns the slim top bar (search, arrange, order, filters, view toggle),
// the applied-filter chips, the Filters drawer, and the SVG canvas with its
// accessible table fallback. All state is hash params, so any view is shareable.
// Filter changes update in place — the top bar and drawer are never rebuilt, so
// focus stays put while the graph repaints live.

import { bootstrap, listJoin, listSplit, parseHash, setParams, swrCall } from "../store.js";
import { openAssetSheet } from "../detailSheets.js";
import { graphTable, renderGraph } from "../graphView.js";
import { CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, kindLabel } from "../icons.js";
import { clear, el, emptyState, openSheet, sevBadge } from "../ui.js";

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
  "seed", "seedKind", "depth", "expand",
  "severities", "kinds", "projects", "clouds",
  "layout", "groupBy", "sort",
];

function graphParams(params, defaults) {
  return {
    seed: params.seed || "",
    seedKind: params.seedKind || "",
    depth: Number(params.depth) || defaults.defaultDepth || 2,
    depthRaw: params.depth == null ? "" : String(params.depth),
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
    if (params.seedKind == null) next.seedKind = "scored";
    if (params.kinds == null) next.kinds = "AI_AGENT";
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
  const meta = el("div", { class: "workbench-meta", role: "status" });
  const controls = el("div", { class: "workbench-controls" });
  const bar = el("div", { class: "workbench-bar" }, title, meta, controls);
  const chipsRow = el("div", { class: "filter-chips", role: "group", "aria-label": "Applied filters" });
  const body = el("div", { class: "workbench-body" });
  main.append(el("div", { class: "workbench" }, bar, chipsRow, body));

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
  let filtersSheet = null;
  let sheetSync = null;
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

  // Filters drawer trigger, with an applied-count badge (the number is the signal).
  const filterCount = el("span", { class: "filter-count", "aria-hidden": "true" });
  const filterBtn = el("button", {
    "aria-haspopup": "dialog",
    onclick: () => openFilters(true),
  }, "Filters", filterCount);

  const viewToggle = el("button", {
    "aria-pressed": state.view === "table" ? "true" : "false",
    onclick: () => update({ view: state.view === "table" ? "graph" : "table" }),
  }, state.view === "table" ? "View as graph" : "View as table");

  controls.append(searchField, arrangeSel, orderSel, filterBtn, viewToggle);

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
      if (node.kind === "ISSUE") return; // issues open from the combos page
      openAssetSheet(node.id, {
        title: node.name,
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
    onEscape: () => filterBtn.focus(),
  };

  function paint(payload) {
    if (!payload) return;
    lastData = payload;
    body.classList.remove("updating");
    if (payload.empty) {
      updateMeta(null);
      clear(body).append(el("div", { class: "workbench-empty" },
        emptyState("No graph data — run a sync first.")));
      return;
    }
    payload.palette = boot.palette;
    payload.offsets = parseOffsets(state.pos);
    clear(body);
    if (state.view === "table") {
      graphApi = null;
      body.append(el("div", { class: "workbench-table" }, graphTable(payload, handlers)));
    } else {
      graphApi = renderGraph(body, payload, handlers);
      body.append(buildLegend(boot, payload));
      applyHighlight();
    }
    updateMeta(payload);
  }

  // -------------------------------------------------------------------- meta
  function updateMeta(payload) {
    clear(meta);
    if (!payload || payload.empty) return;
    const c = payload.counts;
    meta.append(...[
      el("span", { class: "num" },
        `${c.shownNodes} of ${c.totalNodes} nodes · ${c.shownEdges} of ${c.totalEdges} edges`),
      c.capped
        ? el("span", { class: "pill warn", title:
            "The view is capped to stay light. Raise depth, expand a node, or narrow filters." },
            "⚠ capped")
        : null,
      payload.summaries && payload.summaries.length
        ? el("span", { class: "muted" },
            `${payload.summaries.length} collapsed group${payload.summaries.length > 1 ? "s" : ""}`)
        : null,
      state.q.trim() && state.view !== "table"
        ? el("span", { class: "muted num" },
            `${matchIds ? matchIds.size : 0} match${matchIds && matchIds.size === 1 ? "" : "es"}`)
        : null,
      movedCount()
        ? el("button", { class: "link", onclick: () => update({ pos: "" }) },
            `Reset positions (${movedCount()})`)
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
  function filterEntries() {
    const entries = [];
    const defaultDepth = defaults.defaultDepth || 2;
    if (state.seedKind === "scored") {
      entries.push({ key: "seed", label: "Start: All scored assets", patch: { seed: "", seedKind: "", expand: "" } });
    } else if (state.seed) {
      let label = "Start: " + state.seed;
      if (state.seedKind === "combo") {
        const g = (boot.comboLegend || []).find((x) => x.id === state.seed);
        label = "Start: " + (g ? g.shortLabel : state.seed);
      }
      entries.push({ key: "seed", label, patch: { seed: "", seedKind: "", expand: "" } });
    }
    if (state.depth !== defaultDepth) {
      entries.push({
        key: "depth",
        label: `Depth: ${state.depth}`,
        patch: { depth: String(defaultDepth), expand: "" },
      });
    }
    for (const s of listSplit(state.severities)) {
      entries.push({
        key: "sev-" + s,
        label: s,
        sev: s,
        patch: { severities: listJoin(listSplit(state.severities).filter((x) => x !== s)) },
      });
    }
    for (const k of listSplit(state.kinds)) {
      entries.push({
        key: "kind-" + k,
        label: "Type: " + kindLabel(k),
        patch: { kinds: listJoin(listSplit(state.kinds).filter((x) => x !== k)) },
      });
    }
    if (state.projects) entries.push({ key: "projects", label: "Project: " + state.projects, patch: { projects: "" } });
    if (state.clouds) entries.push({ key: "clouds", label: "Cloud: " + state.clouds, patch: { clouds: "" } });
    return entries;
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
    viewToggle.textContent = state.view === "table" ? "View as graph" : "View as table";
    viewToggle.setAttribute("aria-pressed", state.view === "table" ? "true" : "false");

    // Chips + count badge.
    const entries = filterEntries();
    filterCount.textContent = entries.length ? String(entries.length) : "";
    filterBtn.setAttribute("aria-label",
      entries.length ? `Filters, ${entries.length} applied` : "Filters");
    clear(chipsRow);
    chipsRow.hidden = !entries.length;
    for (const e of entries) {
      chipsRow.append(el("button", {
        class: "filter-chip" + (e.sev ? " sev-" + e.sev : ""),
        "aria-label": "Clear filter: " + e.label,
        onclick: () => {
          update(e.patch);
          const next = chipsRow.querySelector(".filter-chip");
          (next || filterBtn).focus();
        },
      },
        e.sev ? el("span", { class: "sev-dot", "aria-hidden": "true" }) : null,
        e.label,
        el("span", { class: "filter-chip-x", "aria-hidden": "true" }, "✕"),
      ));
    }
    if (entries.length) {
      chipsRow.append(el("button", {
        class: "link filter-clear-all",
        onclick: () => clearAllFilters(),
      }, "Clear all"));
    }

    if (sheetSync) sheetSync();
  }

  function clearAllFilters() {
    update({
      seed: "", seedKind: "", expand: "",
      severities: "", kinds: "", projects: "", clouds: "",
      depth: String(defaults.defaultDepth || 2),
    });
    filterBtn.focus();
  }

  // --------------------------------------------------------- filters drawer
  function openFilters(takeFocus) {
    if (filtersSheet) return;
    update({ panel: "filters" });
    filtersSheet = openSheet((sheetBody) => {
      const fc = buildFilterControls();
      sheetBody.append(fc.root);
      sheetSync = fc.sync;
    }, {
      title: "Filters",
      subtitle: "Changes apply immediately",
      width: "min(400px, 92vw)",
      autoFocus: !!takeFocus,
      onClose: () => {
        filtersSheet = null;
        sheetSync = null;
        update({ panel: "" });
      },
    });
  }

  function buildFilterControls() {
    const root = el("div", { class: "sheet-filters" });

    // Seed selector: all combos / all scored assets / one combo group / one asset
    // (from inventory).
    const seedSel = el("select", { "aria-label": "Graph starting point" });
    seedSel.append(el("option", { value: "" }, "All toxic combinations"));
    seedSel.append(el("option", { value: "scored" }, "All scored assets (AARS > 0)"));
    for (const g of boot.comboLegend || []) {
      seedSel.append(el("option", { value: `combo:${g.id}` }, `Combo: ${g.shortLabel}`));
    }
    const assetGroup = el("optgroup", { label: "Assets" });
    seedSel.append(assetGroup);
    if (state.seed && state.seedKind !== "combo") {
      assetGroup.append(el("option", { value: `asset:${state.seed}` }, state.seed));
    }
    // Lazily fill the asset list so the drawer opens without waiting on inventory.
    swrCall("api_getAssets", {}).then((inv) => {
      const current = state.seedKind !== "combo" ? state.seed : "";
      assetGroup.textContent = "";
      for (const row of inv.rows) {
        assetGroup.append(el("option", { value: `asset:${row.id}` },
          `${row.name} (${kindLabel(row.kind)})`));
      }
      if (current) seedSel.value = `asset:${current}`;
    }).catch(() => {});
    seedSel.addEventListener("change", () => {
      const v = seedSel.value;
      if (v === "scored") update({ seed: "", seedKind: "scored", expand: "" });
      else if (!v) update({ seed: "", seedKind: "", expand: "" });
      else if (v.startsWith("combo:")) update({ seed: v.slice(6), seedKind: "combo", expand: "" });
      else update({ seed: v.slice(6), seedKind: "asset", expand: "" });
    });

    // Depth slider.
    const depthValue = el("span", { class: "depth-value" }, String(state.depth));
    const depthInput = el("input", {
      type: "range", min: "1", max: "3", step: "1", value: String(state.depth),
      "aria-label": "Visualization depth",
      "aria-valuetext": DEPTH_TEXT[state.depth],
    });
    depthInput.addEventListener("input", () => {
      depthValue.textContent = depthInput.value;
      depthInput.setAttribute("aria-valuetext", DEPTH_TEXT[Number(depthInput.value)]);
    });
    depthInput.addEventListener("change", () => update({ depth: depthInput.value, expand: "" }));

    // Severity chips.
    const sevRow = el("div", { class: "pill-row", role: "group", "aria-label": "Severity filter" });
    const sevBtns = new Map();
    for (const s of (boot.palette?.order || []).filter((x) => x !== "UNKNOWN")) {
      const btn = el("button", {
        class: `sev-pill sev-${s}`,
        "aria-pressed": listSplit(state.severities).includes(s) ? "true" : "false",
        onclick: () => {
          const active = new Set(listSplit(state.severities));
          if (active.has(s)) active.delete(s);
          else active.add(s);
          update({ severities: listJoin([...active]) });
        },
      }, s);
      sevBtns.set(s, btn);
      sevRow.append(btn);
    }

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
    for (const cat of cats) {
      const kinds = byCategory.get(cat);
      if (!kinds || !kinds.length) continue;
      kinds.sort((a, b) => kindLabel(a).localeCompare(kindLabel(b)));
      const pillRow = el("div", {
        class: "pill-row", role: "group", "aria-label": (CATEGORY_LABELS[cat] || cat) + " node types",
      });
      for (const k of kinds) {
        const btn = el("button", {
          class: "kind-pill",
          "aria-pressed": listSplit(state.kinds).includes(k) ? "true" : "false",
          onclick: () => {
            const active = new Set(listSplit(state.kinds));
            if (active.has(k)) active.delete(k); else active.add(k);
            update({ kinds: listJoin([...active]) });
          },
        }, kindLabel(k));
        kindBtns.set(k, btn);
        pillRow.append(btn);
      }
      kindFilterRoot.append(el("div", { class: "pill-group" },
        el("div", { class: "pill-group-label" }, CATEGORY_LABELS[cat] || cat),
        pillRow));
    }

    // Project / cloud selects (single-value quick filters; "" = all).
    const projSel = plainSelect("Project", opts.projects);
    projSel.addEventListener("change", () => update({ projects: projSel.value }));
    const cloudSel = plainSelect("Cloud", opts.clouds);
    cloudSel.addEventListener("change", () => update({ clouds: cloudSel.value }));

    root.append(
      field("Start from", seedSel),
      field("Depth", el("div", { class: "depth-field" }, depthInput, depthValue)),
      field("Severity", sevRow),
      field("Node type", kindFilterRoot),
      field("Project", projSel),
      field("Cloud", cloudSel),
      el("div", { class: "sheet-filters-footer" },
        el("button", { class: "link", onclick: () => clearAllFilters() }, "Clear all filters")),
    );

    // Reflect chip-clears and Clear-all while the drawer stays open.
    function sync() {
      if (state.seedKind === "scored") seedSel.value = "scored";
      else if (!state.seed) seedSel.value = "";
      else if (state.seedKind === "combo") seedSel.value = `combo:${state.seed}`;
      else seedSel.value = `asset:${state.seed}`;
      depthInput.value = String(state.depth);
      depthValue.textContent = String(state.depth);
      depthInput.setAttribute("aria-valuetext", DEPTH_TEXT[state.depth]);
      const active = new Set(listSplit(state.severities));
      for (const [s, btn] of sevBtns) {
        btn.setAttribute("aria-pressed", active.has(s) ? "true" : "false");
      }
      const activeKinds = new Set(listSplit(state.kinds));
      for (const [k, btn] of kindBtns) {
        btn.setAttribute("aria-pressed", activeKinds.has(k) ? "true" : "false");
      }
      projSel.value = state.projects;
      cloudSel.value = state.clouds;
    }

    return { root, sync };
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
  syncControls();
  await load();
  if (params.panel === "filters") openFilters(false);
}

function field(labelText, control) {
  return el("div", { class: "field" },
    el("label", { class: "field-label" }, labelText),
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

  legend.append(el("summary", { class: "legend-toggle" }, "Legend"), body);
  return legend;
}
