// Security Graph — the centerpiece. Server computes a depth-limited projection +
// layered layout; this page owns the toolbar (seed, depth, filters), the count/cap
// indicator, the legend, and the SVG canvas with its accessible table fallback.
// All state is hash params, so any view is shareable.

import { bootstrap, listJoin, listSplit, parseHash, setParams, swrCall } from "../store.js";
import { openAssetSheet } from "../detailSheets.js";
import { graphTable, renderGraph } from "../graphView.js";
import { kindLabel } from "../icons.js";
import { clear, el, emptyState, sectionLabel, sevBadge } from "../ui.js";

const DEPTH_TEXT = {
  1: "Depth 1: seeds and their direct relationships",
  2: "Depth 2: assets, identities and findings",
  3: "Depth 3: full reach — data, compute and supply chain",
};

function graphParams(params, defaults) {
  return {
    seed: params.seed || "",
    seedKind: params.seedKind || "",
    depth: Number(params.depth) || defaults.defaultDepth || 2,
    expand: params.expand || "",
    severities: params.severities || "",
    kinds: params.kinds || "",
    projects: params.projects || "",
    clouds: params.clouds || "",
    view: params.view || "graph",
  };
}

function rpcParams(p) {
  return {
    seed: p.seed,
    seedKind: p.seedKind,
    depth: p.depth,
    expand: listSplit(p.expand),
    severities: listSplit(p.severities),
    kinds: listSplit(p.kinds),
    projects: listSplit(p.projects),
    clouds: listSplit(p.clouds),
  };
}

export async function renderGraphPage(main, params, ctx) {
  const boot = await bootstrap();
  const state = graphParams(params, boot.settings || {});

  main.append(
    el("h1", {}, "Security Graph"),
    el("p", { class: "page-sub" },
      "AI assets, their identities, data and compute — with toxic combinations highlighted. " +
      "Depth is limited server-side so every view stays light."),
  );

  if (!boot.latestSync) {
    main.append(emptyState(
      "No sync yet.",
      "Run “Sync now” in the sidebar — without credentials it loads the sample dataset.",
    ));
    return;
  }

  // ------------------------------------------------------------------- toolbar
  const toolbar = el("div", { class: "graph-toolbar", role: "group", "aria-label": "Graph controls" });

  // Seed selector: all combos / one combo group / one asset (from inventory).
  const seedSel = el("select", { "aria-label": "Graph starting point" });
  seedSel.append(el("option", { value: "" }, "All toxic combinations"));
  for (const g of boot.comboLegend || []) {
    seedSel.append(el("option", {
      value: `combo:${g.id}`,
      selected: state.seedKind === "combo" && state.seed === g.id || null,
    }, `Combo: ${g.shortLabel}`));
  }
  const assetGroup = el("optgroup", { label: "Assets" });
  seedSel.append(assetGroup);
  if (state.seed && state.seedKind !== "combo") {
    assetGroup.append(el("option", { value: `asset:${state.seed}`, selected: true }, state.seed));
  }
  // Lazily fill the asset list so the page renders without waiting on inventory.
  swrCall("api_getAssets", {}).then((inv) => {
    const current = state.seedKind !== "combo" ? state.seed : "";
    assetGroup.textContent = "";
    for (const row of inv.rows) {
      assetGroup.append(el("option", {
        value: `asset:${row.id}`,
        selected: row.id === current || null,
      }, `${row.name} (${kindLabel(row.kind)})`));
    }
  }).catch(() => {});

  seedSel.addEventListener("change", () => {
    const v = seedSel.value;
    if (!v) update({ seed: "", seedKind: "", expand: "" });
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
  const activeSevs = new Set(listSplit(state.severities));
  const sevRow = el("div", { class: "pill-row", role: "group", "aria-label": "Severity filter" });
  for (const s of (boot.palette?.order || []).filter((x) => x !== "UNKNOWN")) {
    const btn = el("button", {
      class: `sev-pill sev-${s}`,
      "aria-pressed": activeSevs.has(s) ? "true" : "false",
      onclick: () => {
        if (activeSevs.has(s)) activeSevs.delete(s);
        else activeSevs.add(s);
        update({ severities: listJoin([...activeSevs]) });
      },
    }, s);
    sevRow.append(btn);
  }

  // Kind / project / cloud selects (single-value quick filters; "" = all).
  const opts = boot.filterOptions || { kinds: [], clouds: [], projects: [] };
  const kindSel = filterSelect("Node type", opts.kinds, state.kinds, (v) => update({ kinds: v }), kindLabel);
  const projSel = filterSelect("Project", opts.projects, state.projects, (v) => update({ projects: v }));
  const cloudSel = filterSelect("Cloud", opts.clouds, state.clouds, (v) => update({ clouds: v }));

  const viewToggle = el("button", {
    "aria-pressed": state.view === "table" ? "true" : "false",
    onclick: () => update({ view: state.view === "table" ? "graph" : "table" }),
  }, state.view === "table" ? "View as graph" : "View as table");

  toolbar.append(
    field("Start from", seedSel),
    field("Depth", el("div", { style: "display:flex; align-items:center; gap:8px" }, depthInput, depthValue)),
    field("Severity", sevRow),
    kindSel, projSel, cloudSel,
    el("div", { class: "field", style: "margin-left:auto" }, viewToggle),
  );
  main.append(toolbar);

  // -------------------------------------------------------------- meta + frame
  const meta = el("div", { class: "graph-meta", role: "status" });
  const frame = el("div", { class: state.view === "table" ? "" : "graph-frame" });
  main.append(meta, frame);

  // Legend.
  main.append(buildLegend(boot));

  // ---------------------------------------------------------------- data load
  let data;
  try {
    data = await swrCall("api_getGraph", rpcParams(state), (fresh) => paint(fresh));
  } catch (e) {
    clear(frame).append(emptyState("Couldn't load the graph.", String(e.message || e)));
    return;
  }
  paint(data);

  function paint(payload) {
    if (payload.empty) {
      clear(frame).append(emptyState("No graph data — run a sync first."));
      return;
    }
    payload.palette = boot.palette;
    const c = payload.counts;
    // Native append() stringifies null children (unlike el()), so filter them.
    clear(meta).append(...[
      el("span", { class: "num" },
        `${c.shownNodes} of ${c.totalNodes} nodes · ${c.shownEdges} of ${c.totalEdges} edges`),
      c.capped
        ? el("span", { class: "pill warn", title:
            "The view is capped to stay light. Raise depth, expand a node, or narrow filters." },
            "⚠ capped")
        : null,
      payload.summaries && payload.summaries.length
        ? el("span", { class: "muted" },
            `${payload.summaries.length} collapsed group${payload.summaries.length > 1 ? "s" : ""} — open a “+N more” node to expand`)
        : null,
    ].filter(Boolean));

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
      onEscape: () => depthInput.focus(),
    };

    clear(frame);
    if (state.view === "table") {
      frame.className = "";
      frame.append(graphTable(payload, handlers));
    } else {
      frame.className = "graph-frame";
      renderGraph(frame, payload, handlers);
    }
  }

  function update(patch) {
    const { params: current } = parseHash();
    setParams({ ...current, ...patch });
    ctx.refreshRoute ? ctx.refreshRoute() : rerender();
  }

  async function rerender() {
    clear(main);
    await renderGraphPage(main, parseHash().params, ctx);
  }
}

function field(labelText, control) {
  return el("div", { class: "field" },
    el("label", { class: "field-label" }, labelText),
    control,
  );
}

function filterSelect(labelText, options, current, onChange, format) {
  const sel = el("select", { "aria-label": labelText },
    el("option", { value: "" }, `All ${labelText.toLowerCase()}s`),
    ...options.map((o) => el("option", { value: o, selected: o === current || null },
      format ? format(o) : o)),
  );
  sel.addEventListener("change", () => onChange(sel.value));
  return field(labelText, sel);
}

function buildLegend(boot) {
  const legend = el("div", { class: "graph-legend", "aria-label": "Legend" });
  legend.append(el("span", { class: "label" }, "Legend"));
  legend.append(
    el("span", { class: "legend-item" },
      el("span", { class: "legend-swatch-halo", "aria-hidden": "true" }),
      "TC = toxic combination member"),
    el("span", { class: "legend-item" },
      el("span", { class: "legend-swatch-negated", "aria-hidden": "true" }),
      "dashed = missing guardrail"),
  );
  for (const s of (boot.palette?.order || []).filter((x) => x !== "UNKNOWN" && x !== "INFO")) {
    legend.append(el("span", { class: "legend-item" }, sevBadge(s)));
  }
  legend.append(
    el("span", { class: "legend-item muted" },
      "“+N more” pills expand collapsed neighbors"),
  );
  return legend;
}
