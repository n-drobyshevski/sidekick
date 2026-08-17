// Security Graph — the centerpiece, as a full-page workbench. The server computes
// a depth-limited projection + deterministic layout (lanes or grouped clusters);
// this page owns the slim top bar (order, view toggle), the query builder, and the SVG
// canvas with its accessible table fallback. All state is hash params, so any view is
// shareable.
//
// THE LAYOUT CONTROL IS CANVAS CHROME. Arrange was a select in the top bar that fused the
// mode and the grouping dimension into one eight-way enum and split it back out with a
// string slice — while being hidden in table view, i.e. already admitting it described the
// canvas. It is a button on the canvas now, in the rail beside the zoom, and the mode and
// the dimensions are the separate things they always were: three exclusive arrangements,
// and (for groups) one or two dimensions to nest.
//
// THERE IS NO NODE SEARCH. A box that dimmed everything whose name did not contain a
// substring was the query builder's question asked worse: `WHERE Name contains …` says
// the same thing, on any node in the query rather than all of them, alongside every other
// field, and REMOVES the rows instead of greying them — so the count, the table and the
// canvas finally agree on what matched. The dim was also the one filter that could not be
// read off the page: nothing named it, and "42 of 812 nodes · 3 matches" was the only
// evidence that two thirds of the picture had been turned down.
//
// THE BUILDER IS AN OVERLAY, not a band. It floats over the canvas from an "Edit query"
// toggle, so putting the question away gives the answer the whole viewport. It hangs off
// `.workbench-split` rather than inside the canvas — `renderGraph` opens by clearing its
// container, which is why the legend and the counts are re-appended on every paint — and
// being out of flow it never resizes the canvas, so toggling it does not re-fit the graph.
//
// THERE IS NO FILTERS PANEL. It offered severity, cloud and project — three of the
// twenty-three fields the query knows — as a severity pill row and two SINGLE-value
// selects, with no counts, always on the root node, and only ever as whole-value
// equality. `rpcParams` then folded them onto node 0 as `where` filters, which is what
// they always were. The builder's WHERE segment says the same thing with counts, several
// values, every field, any node in the query, and is/is not/all/none — and once both
// could write `severity` on node 0, the fold silently overwrote whatever the builder
// said, so the bar displayed a filter that was not the one being applied.
//
// Changes update in place — the top bar is never rebuilt, so focus stays put while the
// graph repaints live.

import {
  bootstrap, navigate, parseHash, setParams, swrCall,
} from "../store.js";
import { openAssetSheet, openIssueSheet } from "../detailSheets.js";
import { renderGraph } from "../graphView.js";
import { queryTable, DEFAULT_PAGE_SIZE } from "../queryTable.js";
import {
  CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, kindIconSvg, kindLabel,
} from "../icons.js";
import { filterEntries } from "./graphChips.js";
import {
  applyWhere, defaultQuery, migrateLegacyParams, parseQuery, parseWhere, queryRows,
  serializeQuery, serializeWhere,
} from "./graphQuery.js";
import { queryBar } from "./graphQueryBar.js";
import {
  clear, confirmDialog, el, emptyState, filterChipRow, helpTip, onPageTeardown,
  openPopover, portalsOpen, segmented, selectField, sevBadge, skeleton, toast, togglePills,
  uiIcon,
} from "../ui.js";

const GROUP_LABELS = {
  asset: "asset",
  combo: "toxic combo",
  project: "project",
  cloud: "cloud",
  kind: "node type",
  severity: "severity",
};

/**
 * The layouts, in the order the list offers them — the page's whole vocabulary for `layout=`.
 *
 * `mode: ""` is Rows, because rows is the default and the hash carries an absent param rather
 * than a redundant `layout=rows`. Every other entry names its engine exactly as
 * `LAYOUT_MODES` does, so the value in the URL and the row in the list are the same word.
 *
 * The blurb is not decoration. Five rows reading "Rows / Columns / Organic / Radial / Groups"
 * say nothing about which one answers the question in hand, and a layout picker is exactly
 * where someone is guessing — so each one says what it arranges BY, in the estate's own terms.
 */
const LAYOUTS = [
  {
    mode: "", label: "Rows", icon: "rows",
    blurb: "Category bands across — risk, AI assets, identities, data, compute",
  },
  {
    mode: "lanes", label: "Columns", icon: "lanes",
    blurb: "The same bands, running down instead of across",
  },
  {
    mode: "organic", label: "Organic", icon: "organic",
    blurb: "Force-directed — clusters emerge from the connections",
  },
  {
    mode: "radial", label: "Radial", icon: "radial",
    blurb: "Rings out from the worst-risk agent, one ring per hop",
  },
  {
    mode: "grid", label: "Grid", icon: "group",
    blurb: "Every node packed densely, categories ignored",
  },
];

/** Every layout the hash may name — Rows is the absent value, so it is not one of them. */
const LAYOUT_MODES = LAYOUTS.map((l) => l.mode).filter(Boolean);

/**
 * Old layout values, mapped onto the arrangement that draws what they drew.
 *
 * `grouped` was an arrangement before grouping and arrangement came apart, and what it drew was
 * the compact grid. Mirrors `resolveLayoutParams`, which does the same mapping server-side —
 * mirrored rather than shared because the client bundle cannot import the domain layer, the same
 * reason egoLayout.js keeps its own copy of SEVERITY_ORDER. test/graphLayout.test.ts holds the
 * two together.
 */
const LAYOUT_ALIAS = { grouped: "grid" };

/** The key that opens the Layouts list, as the reference screen prints it. */
const LAYOUT_KEY = "y";

// Legend starts collapsed on each visit; once the user opens it we keep it open
// across in-place repaints (filter changes rebuild the legend, and a key that
// snapped shut on every tweak would be worse than useless).
let legendOpen = false;

/**
 * Is the query builder showing? Sticky for the session, and deliberately NOT a hash param.
 *
 * `VIEW_PARAMS` below calls itself "the whole page state, minus transient panel/focus intent",
 * which is exactly what this is — a shared link or a saved view should replay the question, not
 * whether the person who saved it had the editor open. `sessionStorage` rather than a bare
 * module variable because replaying a saved view is a `navigate` (store.js), a real hashchange
 * that rebuilds the page; the choice should survive that and a reload, but not the tab.
 *
 * Storage can throw outright inside the Apps Script sandbox iframe, so every access is guarded
 * and the module variable is the answer when it does.
 */
const EDIT_KEY = "sidekickai.graphEdit";
let editing = true;
function readEditing() {
  try {
    const raw = sessionStorage.getItem(EDIT_KEY);
    if (raw != null) editing = raw === "1";
  } catch (_e) { /* storage refused; keep whatever we had */ }
  return editing;
}
function writeEditing(next) {
  editing = next;
  try {
    sessionStorage.setItem(EDIT_KEY, next ? "1" : "0");
  } catch (_e) { /* storage refused; the module variable still holds for this page */ }
}

// Params that change the server payload (vs. client-only view/q/panel).
const DATA_KEYS = ["find", "where", "maxNodes", "layout", "groupBy", "sort", "columns"];

/** Table-only view state: repainted from the rows already fetched, never refetched. */
const TABLE_KEYS = ["page", "pageSize", "sortCol", "dir"];
const VIEWS_KEY = "sidekickai.graphQueries";
/** Per-KIND column preferences, beside the saved queries. See readColumnDefaults. */
const COLS_KEY = "sidekickai.graphColumns";
/** What a saved query remembers. The whole page state, minus transient panel/focus intent. */
const VIEW_PARAMS = [
  "find", "where", "columns", "view",
  "layout", "groupBy", "sort", "sortCol", "dir", "pageSize", "maxNodes",
];

/** A hash `layout` value as this page understands it: an alias resolved, anything else dropped. */
function normalizeLayout(raw) {
  const v = LAYOUT_ALIAS[raw] || raw;
  return LAYOUT_MODES.includes(v) ? v : "";
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
    // Table view state. In the hash like everything else, so a configured table is a link.
    columns: params.columns || "",
    page: Math.max(1, Number(params.page) || 1),
    pageSize: Number(params.pageSize) || DEFAULT_PAGE_SIZE,
    sortCol: params.sortCol || "",
    dir: params.dir === "desc" ? "desc" : "asc",
    // Whitelisted against LAYOUTS rather than against a hand-written pair. The literal this
    // replaces named "grouped" and "lanes" and nothing else, so a new engine in the domain and a
    // new row in the list both landed — and the URL still carried it — while THIS silently
    // rewrote it to rows on the way to the request. One list, so a layout cannot be added to
    // four places and forgotten in the fifth.
    layout: normalizeLayout(params.layout),
    groupBy: params.groupBy || "",
    sort: params.sort || "",
    view: params.view === "table" ? "table" : "graph",
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
 * The two halves of the question are separate in the URL — `find` is the structure and `where`
 * the per-node property filters, and neither should churn the other — and one object on the
 * wire, because the server validates and evaluates a single tree.
 *
 * Nothing is folded in on the way past any more. The filter panel's three dimensions used to be
 * merged onto node 0 here, from their own hash params, with an unconditional `set` that
 * overwrote whatever the builder had put under the same key. `migrateLegacyParams` folds those
 * params into `where` once, on entry, so by the time anything reaches here there is one copy of
 * the question and it is the one on screen.
 */
function rpcParams(p, columnDefaults) {
  return {
    query: applyWhere(queryOf(p), parseWhere(p.where)),
    columns: columnsFor(p, columnDefaults),
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

/**
 * The column selection to send: the URL's if it has one, otherwise this browser's per-kind
 * preferences mapped onto THIS query's groups.
 *
 * The URL always wins, so a shared link opens the table its author configured rather than the
 * reader's habits. The mapping is possible without a round trip because the client can derive
 * the group order itself — `queryRows` is the same pre-order walk the server binds against, so
 * "the third shown node" means the same thing on both sides. That is what lets the preference
 * be a client-side one with no server change at all.
 */
function storedColumnDefaults() {
  try {
    const raw = window.localStorage.getItem(COLS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null; // storage refused — fall through to the domain defaults
  }
}

function columnsFor(p, defaults) {
  const explicit = parseColumns(p.columns);
  if (explicit) return explicit;
  if (!defaults) return undefined;
  const shown = queryRows(queryOf(p))
    .filter((r) => !r.group && !r.hidden && r.index !== null);
  const out = shown.map((r) => defaults[r.kind] || null);
  return out.some(Boolean) ? out : undefined;
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
    for (const k of ["seed", "seedKind", "depth", "expand", "kinds",
      "severities", "projects", "clouds"]) delete params[k];
    setParams(params);
  }
  // `layout=grouped` is the other kind of old link, and it is REWRITTEN rather than translated on
  // every read. Grouping used to be one of the arrangements and chose its own interior — the
  // compact grid, except under `asset`, where it forced hub-and-spoke. Modernising the hash once,
  // here, is what keeps a single value flowing through everything after it: the row the list
  // marks, the badge, the legend, and the request. Left as-is, this page would normalise `layout`
  // for its own display and send the normalised value on, so the resolver's own migration would
  // never see the legacy word and a saved view would open with no boxes at all.
  //
  // Mirrors `resolveLayoutParams`, which keeps the same mapping as the server-side safety net.
  // Two copies because the client bundle cannot import the domain layer; the pair is held together
  // by test/graphLayout.test.ts (the alias) and by the browser walk (the `asset` branch).
  if (LAYOUT_ALIAS[params.layout]) {
    params = { ...params };
    // An absent `groupBy` is what grouped mode defaulted to internally, so it still groups.
    const groupBy = params.groupBy || "combo";
    params.groupBy = groupBy;
    params.layout = groupBy.split(",")[0].trim() === "asset"
      ? "radial"
      : LAYOUT_ALIAS[params.layout];
    setParams(params);
  }
  // The retired canvas search. Stripped from any link that still names it rather than left
  // sitting inert: a URL that carries `q=agent` reads like a page that does something with it.
  if (params.q != null) {
    params = { ...params };
    delete params.q;
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
  swrCall("api_runGraphQuery", rpcParams(graphParams(params, {}), storedColumnDefaults()))
    .catch(() => {});
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
  // The result count rides the VIEW strip, not the builder. It used to sit on the builder's
  // first line, which was right while the builder was always there — and became a way to lose
  // the count the moment the builder could be put away. It is the one fact the canvas cannot
  // tell you, so it lives on the row that never leaves.
  const countText = el("span", { class: "num", role: "status" });
  const countNote = el("span", {});
  const countBox = el("div", { class: "gq-count" }, countText, countNote);
  const viewbar = el("div", { class: "gq-viewbar" });
  const controls = el("div", { class: "gq-viewbar-end" });
  // What differs from the default VIEW, which since the Filters panel retired is the node
  // budget and nothing else. No `emptyText`: the band used to hold a line reading "No filters
  // applied" to keep its height, and with the property filters now written as chips in the
  // builder directly above it, that line sat under a visible filter calling itself nothing.
  // One rare chip is not worth a standing lie, so the band collapses when there is none.
  const chipsRow = filterChipRow({
    onPatch: (patch) => update(patch),
    // Clears what this ROW shows, which since the Filters panel retired is the node budget
    // alone. The property filters are chips in the builder, each with its own ✕.
    onClearAll: () => update({ maxNodes: "", page: "" }),
    fallbackFocus: null, // assigned below, once the Columns button exists
  });
  const body = el("div", { class: "workbench-body" });
  const barHost = el("div", {});
  const panelClose = el("button", {
    class: "gq-iconbtn gq-panel-close",
    "aria-label": "Close the query editor",
    onclick: () => setEditing(false, true),
  }, uiIcon("close", 13));
  // The builder's own card, floating over the canvas. A sibling of `body` rather than a child:
  // `renderGraph` clears its container on every repaint, and out of flow it leaves the canvas
  // box alone, so revealing it neither destroys it nor re-fits the graph underneath.
  const panel = el("div", {
    class: "gq-panel", id: "gq-panel", hidden: true, "aria-label": "Query editor",
  }, panelClose, barHost);
  // ------------------------------------------------------- layout + grouping, in the rail
  // Arrange used to be a select up here, fusing the mode and the dimension into one
  // eight-way enum and splitting it back out with a string slice. It is canvas chrome —
  // already hidden in table view — so it moves onto the canvas, beside the zoom it
  // belongs with, and the mode and the dimensions get to be the separate things they are.
  //
  // TWO BUTTONS, AND TWO INDEPENDENT QUESTIONS. One control used to hold the arrangement AND the
  // grouping dimensions, with a badge counting the dimensions — a single trigger describing two
  // unrelated things, whose badge answered for only one of them. Splitting them in two was the
  // first half; the second is that NEITHER constrains the other. Grouping is not one of the
  // arrangements any more, so this button is always live, and every pair of values means
  // something: grouping partitions, the arrangement fills each partition.
  let layoutPop = null;
  const layoutBtn = el("button", {
    class: "graph-tool", "aria-haspopup": "listbox",
    onclick: () => toggleLayout(),
  }, uiIcon("layout", 15));

  const groupBadge = el("span", { class: "graph-tool-badge", "aria-hidden": "true" });
  const groupBtn = el("button", {
    class: "graph-tool", "aria-haspopup": "dialog",
    onclick: () => openGroups(),
  }, uiIcon("group", 15), groupBadge);

  /** How many grouping levels are in force — what the badge counts. Zero is a real answer. */
  function groupLevels() {
    return String(state.groupBy || "").split(",").map((s) => s.trim()).filter(Boolean);
  }

  function syncLayoutBtn() {
    // `state.layout` is "" for rows, which is Rows' own `mode` — so this matches exactly rather
    // than leaning on the fallback to be right about the default.
    const spec = LAYOUTS.find((l) => l.mode === (state.layout || "")) || LAYOUTS[0];
    layoutBtn.setAttribute("aria-label", `Layout: ${spec.label}`);
    const levels = groupLevels();
    // "" rather than "0", so `:empty` hides it — the recipe the filter badge uses.
    groupBadge.textContent = levels.length ? String(levels.length) : "";
    groupBtn.setAttribute("aria-label", levels.length
      ? "Grouped by " + levels.map((k) => GROUP_LABELS[k] || k).join(", then ")
      : "Group by");
  }

  // The canvas rail: the page's two canvas tools on top, the renderer's zoom controls below.
  //
  // It hangs off the split rather than the canvas because `renderGraph` clears its own
  // container on every repaint — and both buttons open popovers, which measure their
  // anchor. Rebuilt mid-flight, the anchor detaches, the popover reads a zeroed rect
  // and closes itself, so a live-apply control inside the canvas would dismiss on its own
  // first use. Out here it simply persists, and the renderer refills its slot.
  const railZoom = el("div", { class: "graph-rail-zoom" });
  const rail = el("div", { class: "graph-rail" }, layoutBtn, groupBtn, railZoom);
  // `body` is the containing block for the canvas overlays, the table, the empty states and the
  // boot skeleton; the panel is positioned against the split so it can sit over all of them.
  const split = el("div", { class: "workbench-split" }, panel, rail, body);
  const root = el("div", { class: "workbench" }, bar, viewbar, chipsRow, split);
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
  /** Guards against a slow answer painting over a faster one that was asked for later. */
  let seq = 0;

  const orderSel = el("select", { "aria-label": "Order nodes" },
    el("option", { value: "" }, "Smart order"),
    el("option", { value: "severity" }, "Severity first"),
    el("option", { value: "aars" }, "Highest AARS"),
    el("option", { value: "name" }, "Name (A–Z)"),
  );
  orderSel.addEventListener("change", () => update({ sort: orderSel.value, pos: "" }));

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
  // Where focus lands when the last chip is cleared out from under it. The Filters button used
  // to be the answer; the nearest surviving control on that row is Columns.
  chipsRow.fallbackFocus = columnsBtn;

  // Reveals the builder. It lives here rather than in the header actions because the header is
  // right-aligned and its saved-views control is swapped by positional index below — an
  // inserted sibling there would silently replace the wrong node.
  const editBtn = el("button", {
    class: "gq-edit-btn",
    "aria-expanded": "false",
    "aria-controls": "gq-panel",
    onclick: () => setEditing(!editing, false),
  }, uiIcon("pencil", 14), el("span", { style: "margin-left:6px" }, "Edit query"));

  // The one row that never leaves: how to change the question, how to read the answer, and how
  // many there are. The question itself is in the card this row opens.
  viewbar.append(
    editBtn,
    el("span", { class: "gq-viewbar-sep", "aria-hidden": "true" }),
    el("span", { class: "gq-kw" }, "View"),
    viewToggle,
    controls,
  );
  controls.append(countBox, selectField("Order", orderSel), columnsBtn);

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
    // One round trip per kind per session — `swrCall` keys on the params, and the palette only
    // asks when someone opens its Properties tab. Every kind's fields and value lists together
    // were 22 KB of a 28 KB vocabulary, unread until then and then only for the one kind.
    loadFields: (k) => swrCall("api_getQueryVocabulary", { kind: k }).then((v) => ({
      fields: (v && v.fieldsFor && v.fieldsFor[k]) || [],
      values: (v && v.valuesFor && v.valuesFor[k]) || [],
    })),
    onChange: (next, where) => {
      const patch = { find: serializeQuery(next), columns: "", page: "" };
      // Only written when the builder actually touched it. `where` is otherwise the filter
      // panel's to own, and rewriting it on every structural edit would fight that.
      if (where) patch.where = serializeWhere(where);
      update(patch);
    },
  });
  barHost.append(builder.node);
  readEditing();

  /**
   * Show or hide the card. `toTrigger` returns focus to the "Edit query" button, which is what
   * Escape and the card's own ✕ want and what an outside click does not — the same split
   * openPopover draws between `close(true)` and `close()`.
   */
  function setEditing(next, toTrigger) {
    if (next === editing) return;
    writeEditing(next);
    syncControls();
    // Opening is always a request to edit, so the keyboard goes with it — onto the row that was
    // last focused, which the bar remembers across a close.
    if (next) builder.focus();
    else if (toTrigger) editBtn.focus();
  }

  // Dismissal. Two listeners by hand rather than `popoverDismiss`, which also closes on scroll,
  // resize and focusout — anchor semantics for a popover chasing a trigger that can move. This
  // card is pinned to the layout and is not modal, so tabbing to the View toggle must not shut it.
  function insidePanel(node) {
    if (!(node instanceof Element)) return false;
    // The VIEW strip counts as inside: it holds the trigger and the count, and switching Table
    // for Graph is not leaving the editor. Without the trigger in particular the toggle is dead
    // — this handler would close the card and the button's own click would reopen it.
    // The palette and the filter editors portal themselves to <body>, so a click in one is
    // geometrically outside the card while being entirely inside the editing task.
    return !!node.closest(".gq-panel, .gq-viewbar, .popover, .sheet, .sheet-scrim, dialog");
  }
  function onOutsidePointer(e) {
    if (!editing || insidePanel(e.target)) return;
    setEditing(false, false);
  }
  function onEscape(e) {
    if (e.key !== "Escape" || !editing) return;
    // Both this and popover.js listen on document in the capture phase, and ours registers
    // first — at page render, before any popover exists. Without this guard Escape inside an
    // open palette would close the whole card instead of the palette it was aimed at.
    if (portalsOpen()) return;
    setEditing(false, true);
  }
  /**
   * `Y` opens the Layouts list — the app's first page-level shortcut, so the guards matter.
   *
   * A bare letter on `document` is a key someone is otherwise entitled to TYPE, and this page is
   * mostly text fields: the query builder's search, the filter editors, the saved-query name. So
   * it stands down for anything editable, for any modifier (Cmd-Y is the browser's), for an open
   * portal (a letter aimed at a palette's search box must reach it), and in table view, where the
   * rail this belongs to is hidden and a layout is not a thing the page is showing.
   *
   * Registered here, beside Escape, and torn down the same way — `onPageTeardown` runs on
   * navigation, and a listener that outlived its page would answer for a canvas that is gone.
   */
  function onLayoutKey(e) {
    if (e.key.toLowerCase() !== LAYOUT_KEY) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (state.view === "table") return;
    const t = e.target;
    if (t instanceof Element && (t.closest("input, select, textarea, [contenteditable]"))) return;
    // The trigger's own popover is the exception to `portalsOpen` — pressing the key again has to
    // close what the key opened, which is exactly what a toggle means.
    if (portalsOpen() && !(layoutPop && layoutPop.isOpen())) return;
    e.preventDefault();
    toggleLayout();
  }
  document.addEventListener("pointerdown", onOutsidePointer, true);
  document.addEventListener("keydown", onEscape, true);
  document.addEventListener("keydown", onLayoutKey, true);
  onPageTeardown(() => {
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    document.removeEventListener("keydown", onEscape, true);
    document.removeEventListener("keydown", onLayoutKey, true);
  });

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
      const data = await swrCall("api_runGraphQuery", rpcParams(state, readColumnDefaults()), (fresh) => {
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
    // The renderer fills its slot in the page's rail instead of building one inside the
    // canvas it clears — see the comment on `rail` above for why that matters.
    railZoomHost: railZoom,
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
      // Both ways out leave the reader needing to say something new, so both bring the editor
      // back up — the alternative is a cleared query and a collapsed card with nothing to act on.
      host.append(
        emptyState("Nothing matches these filters.",
          "Widen one of them, or start from somewhere else in the estate."),
        el("div", { class: "workbench-empty-action" },
          el("button", {
            onclick: () => { clearAllFilters(); setEditing(true, false); },
          }, "Clear all filters")),
      );
    } else {
      // A query that matches nothing is the ordinary outcome of asking a precise question, and
      // it is a real answer — the estate holds no such path. Say that, and offer the way back.
      host.append(
        emptyState("No paths match this query.",
          "Every step has to match for a row to exist. Remove the last relationship, or mark it optional to keep the rows it would drop."),
        el("div", { class: "workbench-empty-action" },
          el("button", {
            onclick: () => {
              update({ find: serializeQuery(defaultQuery()), where: "", columns: "", page: "" });
              setEditing(true, false);
            },
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
   * actually differs — a repaint that lands on the same counts must not re-announce them.
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
  /**
   * Which fields each column group shows — a compact popover, anchored to the button.
   *
   *   [x] Enable custom column selection
   *   ┌────────────────────────────────────────────┐
   *   │ (icon) AI Agent                            │
   *   │        Name, Publisher, Discovered by  ▾   │
   *   └────────────────────────────────────────────┘
   *   Save as defaults          Reset defaults
   *
   * A column belongs to a NODE of the query, not to the table — "Name" on its own would be
   * ambiguous the moment a second group exists, which is the same reason the table carries a
   * two-level header. So one row per group, each expanding INLINE rather than into a second
   * panel: the reference opens a nested dialog, and a dialog over a popover is a stack nobody
   * can Escape out of predictably.
   *
   * THE MASTER SWITCH is not decoration. Off means the domain's per-kind defaults and NOTHING
   * in the URL, so a shared link carries a question rather than a table layout; on means an
   * explicit choice, in the URL, that travels with the link. Those are genuinely different
   * states and the old panel could not express the first one — any click put columns in the URL
   * forever.
   */
  /**
   * The layouts, as the reference draws it: a flat list of named arrangements, one glyph each,
   * the one in force marked, and the shortcut printed beside the heading.
   *
   *   Layouts                Shortcut: Y
   *     ▤  Rows          ✓
   *     ▥  Columns
   *     ✳  Organic
   *     ◌  Radial
   *     ▦  Groups
   *
   * A LIST, not the segmented control this replaces. Segments are for two or three peers that fit
   * on one line; five do not, and the third of them ("Groups") was carrying two `<select>`s in the
   * same popover — an arrangement picker and a dimension picker wearing one trigger. The
   * dimensions moved to their own button, which is what lets this be a list at all.
   *
   * The marked row carries BOLD AND A TICK, never the reference's blue alone. Five rows in one
   * tint with the current one merely coloured is exactly the colour-only signal the design bar
   * forbids, and the tick is the part a monochrome or forced-colours reader still gets.
   *
   * `role="listbox"` with `aria-activedescendant`: the arrangement is a single exclusive choice
   * out of five, which is what a listbox means, and the arrow keys move the active row without
   * moving DOM focus off the container.
   */
  function toggleLayout() {
    // Pressing the trigger — or the shortcut — a second time closes. Without this the key would
    // stack a second popover over the first, and `openSheet`'s singleton rule has no equivalent
    // for popovers.
    if (layoutPop && layoutPop.isOpen()) {
      layoutPop.close(true);
      return;
    }
    openLayout();
  }

  function openLayout() {
    const active = state.layout || "";
    const listId = "graph-layouts-list";
    const rows = [];
    let at = Math.max(0, LAYOUTS.findIndex((l) => l.mode === active));

    const list = el("div", {
      class: "graph-layouts", id: listId, role: "listbox", "aria-label": "Layouts",
      tabindex: "0",
    });
    LAYOUTS.forEach((spec, i) => {
      const on = spec.mode === active;
      const row = el("div", {
        class: "graph-layouts-row" + (on ? " is-on" : ""),
        id: listId + "-" + i, role: "option", "aria-selected": on ? "true" : "false",
        onmousedown: (e) => { e.preventDefault(); choose(i); },
      },
        el("span", { class: "graph-layouts-glyph", "aria-hidden": "true" }, uiIcon(spec.icon, 15)),
        el("span", { class: "graph-layouts-text" },
          el("span", { class: "graph-layouts-label" }, spec.label),
          el("span", { class: "graph-layouts-blurb" }, spec.blurb)),
        on ? el("span", { class: "graph-layouts-check" }, uiIcon("check", 13)) : null,
      );
      rows.push(row);
      list.append(row);
    });

    function highlight() {
      rows.forEach((row, i) => row.classList.toggle("is-active", i === at));
      list.setAttribute("aria-activedescendant", listId + "-" + at);
    }

    /**
     * Live-apply, and `pos` clears with the layout: a new arrangement recomputes every position,
     * so the manual nudges `pos` records no longer describe anything on screen.
     *
     * `groupBy` IS NOT TOUCHED. Changing the arrangement while grouping is on keeps the boxes and
     * rearranges what is inside them — which is the whole point of the two being independent.
     * This used to clear it on every pick, so choosing a layout silently threw the grouping away.
     */
    function choose(i) {
      const spec = LAYOUTS[i];
      if (layoutPop) layoutPop.close(true);
      if (spec.mode === (state.layout || "")) return;
      update({ layout: spec.mode, pos: "" });
    }

    list.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(at + 1, rows.length - 1); highlight(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(at - 1, 0); highlight(); }
      else if (e.key === "Home") { e.preventDefault(); at = 0; highlight(); }
      else if (e.key === "End") { e.preventDefault(); at = rows.length - 1; highlight(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(at); }
    });
    highlight();

    const body = el("div", { class: "graph-layout" },
      el("div", { class: "graph-layouts-head" },
        el("span", { class: "graph-layouts-title" }, "Layouts"),
        el("span", { class: "graph-layouts-key" },
          "Shortcut: ", el("kbd", {}, LAYOUT_KEY.toUpperCase()))),
      list);

    layoutPop = openPopover({
      anchor: layoutBtn,
      className: "graph-layout-pop",
      ariaLabel: "Layouts",
      // The trigger sits at the bottom of the viewport, so there is never room below it.
      // Left at the default this would try downward first and flip only on measurement.
      position: { width: 320, minWidth: 280, maxHeight: 420, minHeight: 220, flipBelow: 10000 },
      build: () => body,
      onClose: () => { layoutPop = null; },
    });
    // Focus goes INTO the panel: it is portaled to the end of <body>, so Tab from the trigger
    // would walk the page behind it rather than its contents. The LIST takes it, not a row —
    // this is the editable-listbox pattern the palette uses, where the container holds focus and
    // `aria-activedescendant` carries the cursor.
    if (layoutPop.isOpen()) list.focus();
  }

  /**
   * What grouped mode groups BY — its own control, because it is its own question.
   *
   * Level 2 offers what level 1 has not taken, minus `asset` — hub-and-spoke is an
   * arrangement rather than a partition, with no key of its own to subdivide by, so it
   * is outermost-or-nothing and the resolver drops it anywhere else.
   */
  function openGroups() {
    const DIMS = ["asset", "combo", "project", "cloud", "kind", "severity"];
    const levels = groupLevels();
    let g1 = levels[0] || "";
    let g2 = levels[1] || "";

    // Every change goes straight to the URL — live-apply, no OK button, same as Columns.
    // `pos` clears with it: a regrouping recomputes the picture, so manual node nudges no longer
    // describe anything.
    //
    // `layout` IS NOT TOUCHED. Grouping is not an arrangement any more, so choosing a dimension
    // writes `groupBy` and leaves the arrangement someone picked alone — it used to force
    // `layout: "grouped"`, which is the coupling this whole change undoes.
    const apply = () => {
      const list = !g1 ? []
        : g2 && g2 !== g1 && g1 !== "asset" && g2 !== "asset" ? [g1, g2] : [g1];
      update({ groupBy: list.join(","), pos: "" });
    };

    // Built ONCE, then updated in place. A rebuild-on-every-change draft dismissed the
    // popover on its own first use: `clear()` detached the `<select>` that had just been
    // changed, and detaching the focused element fires `focusout`, which is one of the
    // seven ways popoverDismiss closes. Same lesson `updateMeta` records a few hundred
    // lines up — rewrite the half that moved, never the container.
    const sel1 = el("select", { "aria-label": "Group by 1" });
    const sel2 = el("select", { "aria-label": "Group by 2" });
    const fill = (sel, second) => {
      clear(sel);
      // Level 1's empty option is how grouping is turned OFF, and it has to live here: the
      // control that switches grouping on is the only place a reader will look to switch it off,
      // and there is no longer a layout to leave in order to stop grouping.
      sel.append(el("option", { value: "" }, second ? "Select…" : "No grouping"));
      for (const k of DIMS) {
        if (second && (k === "asset" || k === g1)) continue;
        sel.append(el("option", { value: k }, GROUP_LABELS[k] || k));
      }
    };
    const clear2 = el("button", {
      class: "gq-iconbtn", "aria-label": "Clear Group by 2",
      onclick: () => { g2 = ""; apply(); sync(); },
    }, uiIcon("close", 12));
    const row1 = el("div", { class: "graph-layout-row" },
      el("span", { class: "graph-layout-label" }, "Group by 1"), sel1);
    const row2 = el("div", { class: "graph-layout-row" },
      el("span", { class: "graph-layout-label" }, "Group by 2"), sel2, clear2);
    const note = el("p", { class: "graph-layout-note" },
      "Asset grouping puts each agent at the centre of its own neighbours, so there is nothing inside a group to subdivide.");
    const body = el("div", { class: "graph-layout" }, row1, row2, note);

    let panel = null;
    function sync() {
      // No second level without a first, and none under `asset`, which is outermost-or-nothing —
      // the note says why rather than leaving a control mysteriously missing.
      row2.hidden = !g1 || g1 === "asset";
      note.hidden = g1 !== "asset";
      fill(sel1, false);
      sel1.value = g1;
      fill(sel2, true);
      sel2.value = g2;
      clear2.hidden = !g2;
      if (panel) panel.reposition();
    }
    sel1.addEventListener("change", () => {
      g1 = sel1.value;
      // Turning level 1 off, or onto `asset`, takes level 2 with it — a nesting with no outer
      // box is not a nesting, and `asset` has no key to subdivide by.
      if (!g1 || g2 === g1 || g1 === "asset") g2 = "";
      apply(); sync();
    });
    sel2.addEventListener("change", () => { g2 = sel2.value; apply(); sync(); });
    sync();

    panel = openPopover({
      anchor: groupBtn,
      className: "graph-layout-pop",
      ariaLabel: "Group by",
      position: { width: 300, minWidth: 260, maxHeight: 380, minHeight: 160, flipBelow: 10000 },
      build: () => body,
    });
    const first = panel.pop && panel.pop.querySelector("button, select");
    if (first && panel.isOpen()) first.focus();
  }

  function openColumns() {
    const groups = (lastData && lastData.groups) || [];
    if (!groups.length) return;

    // The name column is ALWAYS on, and is not offered as a toggle. This deletes the old
    // "a group can never go to zero columns" special case rather than working around it: the
    // reason a group must keep one column is that it would otherwise vanish with no way back,
    // and the column it should keep is the one that says which node the group is.
    const PINNED = "name";
    let custom = !!state.columns;
    const chosen = groups.map((g) => g.fields.map((f) => f.key).filter((k) => k !== PINNED));

    function apply() {
      if (!custom) {
        update({ columns: "", page: "" });
        return;
      }
      update({
        columns: serializeColumns(chosen.map((keys) => [PINNED].concat(keys))),
        page: "",
      });
    }

    function optionsFor(group) {
      return group.available.filter((f) => f.key !== PINNED);
    }

    /** What a group currently shows, as prose — the reference's own summary line. */
    function summary(gi) {
      const labels = optionsFor(groups[gi])
        .filter((f) => chosen[gi].indexOf(f.key) !== -1)
        .map((f) => f.label);
      if (!labels.length) return "Name only";
      return "Name, " + labels.join(", ");
    }

    let master = null;
    const panel = openPopover({
      anchor: columnsBtn,
      className: "gq-cols-pop",
      ariaLabel: "Choose columns",
      position: { width: 380, minWidth: 320, maxHeight: 460, minHeight: 220 },
      build: (api) => {
        const body2 = el("div", { class: "gq-cols" });

        master = el("input", { type: "checkbox", id: "gq-cols-master" });
        master.checked = custom;
        const rowsHost = el("div", { class: "gq-cols-list" });
        // Declared before the master handler, which enables and disables it — "Save as
        // defaults" means nothing while the defaults are what is already in force.
        const saveBtn = el("button", { class: "link" }, "Save as defaults");
        function setEnabled() {
          rowsHost.classList.toggle("is-off", !custom);
          for (const control of rowsHost.querySelectorAll("button, input")) {
            control.disabled = !custom;
          }
          saveBtn.disabled = !custom;
        }
        master.addEventListener("change", () => {
          custom = master.checked;
          setEnabled();
          apply();
          api.reposition();
        });
        body2.append(el("label", { class: "gq-cols-master", for: "gq-cols-master" },
          master, el("span", {}, "Enable custom column selection")));

        groups.forEach((group, gi) => {
          // The domain labels a group with the raw enum — it has no label table, which lives
          // in icons.js on the client. The table header already resolves it; so does this, or
          // the panel and the header would name the same group two different ways.
          const heading = group.kind === "ANY" ? "Any node" : kindLabel(group.kind);
          const summaryEl = el("span", { class: "gq-cols-summary" }, summary(gi));
          const pills = togglePills({
            options: optionsFor(group).map((f) => ({ value: f.key, label: f.label })),
            selected: chosen[gi],
            ariaLabel: heading + " columns",
            pillClass: "kind-pill",
            sevClass: false,
            onToggle: (key) => {
              const at = chosen[gi].indexOf(key);
              if (at === -1) chosen[gi].push(key);
              else chosen[gi].splice(at, 1);
              pills.set(chosen[gi]);
              summaryEl.textContent = summary(gi);
              apply();
            },
          });
          const icon = kindIconSvg(group.kind === "ANY" ? "UNKNOWN" : group.kind, 14);
          icon.setAttribute("class", "gq-cols-icon");
          // A native <details>, so the disclosure keyboard contract is the browser's — the
          // sheet's `.disclosure` recipe is the same bargain one layer up.
          rowsHost.append(el("details", { class: "gq-cols-group" },
            el("summary", { class: "gq-cols-head" },
              el("span", { class: "gq-cols-tile", "data-category": categoryOf(group.kind) }, icon),
              el("span", { class: "gq-cols-text" },
                el("span", { class: "gq-cols-kind" }, heading),
                summaryEl)),
            pills));
        });
        body2.append(rowsHost);

        saveBtn.addEventListener("click", () => {
          writeColumnDefaults(chosen.map((keys, gi) => ({
            kind: groups[gi].kind, keys: [PINNED].concat(keys),
          })));
          toast("Saved as your defaults");
        });
        body2.append(el("div", { class: "gq-cols-foot" },
          saveBtn,
          el("button", {
            class: "link",
            onclick: () => {
              clearColumnDefaults();
              custom = false;
              master.checked = false;
              apply();
              api.close(true);
              toast("Back to the standard columns");
            },
          }, "Reset defaults"),
        ));
        setEnabled();
        return body2;
      },
    });
    // Focus goes INTO the panel, or Tab walks straight past it into the page behind — the
    // popover is portaled to the end of <body>, so "the next control" is not what it looks
    // like from the button. The master switch first: it is the one that decides whether the
    // rest of the panel does anything.
    if (master && panel.isOpen()) master.focus();
  }

  /**
   * Per-kind column choices, remembered per browser beside the saved queries.
   *
   * Keyed by KIND rather than by position, because "show me the publisher on every AI asset" is
   * a preference about a kind; which slot that kind occupies changes with every query. Applied
   * by the client only when the URL carries no `columns`, so a shared link still wins and the
   * server needs to know nothing about any of it.
   */
  const readColumnDefaults = storedColumnDefaults;

  function writeColumnDefaults(perGroup) {
    const stored = readColumnDefaults() || {};
    for (const entry of perGroup) stored[entry.kind] = entry.keys;
    try {
      window.localStorage.setItem(COLS_KEY, JSON.stringify(stored));
    } catch {
      toast("This browser refused to save the preference", "warn");
    }
  }

  function clearColumnDefaults() {
    try {
      window.localStorage.removeItem(COLS_KEY);
    } catch {
      // Nothing to undo — the write never landed either.
    }
  }

  // ------------------------------------------------------------------- chips
  function chipEntries() {
    return filterEntries(state, defaults);
  }

  /** Is anything constraining the query — including the defaults the page seeded itself? */
  /**
   * Is anything narrowing the ANSWER, as opposed to shaping the question?
   *
   * It used to mean "the filter panel has something set". With the panel retired that is the
   * `where` half of the query — the property filters written as chips in the builder. The node
   * budget is deliberately not counted: raising or lowering it can only ever show more or less
   * of a match set, never change what matches, which is the distinction graphChips draws.
   */
  function isNarrowing() {
    return !!state.where;
  }

  function syncControls() {
    // Top bar.
    orderSel.value = state.sort;
    // The rail describes the canvas, so it leaves with it. It is a sibling of the canvas
    // rather than a child (so a popover on it survives a repaint), which means nothing
    // hides it for free — the table view has to say so.
    rail.hidden = state.view === "table";
    syncLayoutBtn();
    // Order sequences nodes on a canvas, which means nothing to a table of paths —
    // hidden there rather than left sitting inert beside a control that does work.
    const graphOnly = state.view === "table" ? "none" : "";
    for (const f of controls.querySelectorAll(".select-field")) f.style.display = graphOnly;
    columnsBtn.style.display = state.view === "table" ? "" : "none";
    viewToggle.set(state.view);

    // The builder. Reflecting the state only — moving focus is `setEditing`'s job, because it
    // must happen when the READER opens the card and not when the page merely repaints with it
    // already open, and not on the first render either: the card is up by default, and a page
    // that grabs the keyboard on arrival drops a screen reader into the middle of itself.
    builder.sync();
    panel.hidden = !editing;
    editBtn.setAttribute("aria-expanded", editing ? "true" : "false");

    // Chips + count badge. The badge counts what the USER applied — the AI-agent lens the
    // page seeds on a fresh visit is shown as a chip and clearable, but it is not a filter
    // anyone chose, and counting it had the page opening with "2 filters applied".
    const entries = chipEntries();
    chipsRow.sync(entries);

  }

  /**
   * Clears the FILTERS, not the question. The query in the builder is the thing the user
   * typed; wiping it from a control labelled "clear all filters" would throw away work that
   * the chip row never claimed to own.
   */
  /** The empty state's way out: drop every property filter, and the budget with them. */
  function clearAllFilters() {
    update({ where: "", maxNodes: "", page: "" });
  }

  /** Everything within two hops of one asset — the old seed-and-depth view, as a query. */
  function focusAsset(id) {
    update({
      find: "ANY(*ANY2.ANY)",
      where: "0.id." + encodeURIComponent(id),
      columns: "", page: "", sortCol: "",
    });
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
}


function buildLegend(boot, payload) {
  // Read off the BOXES, which is as close to "what was drawn" as this can get. There is no
  // longer a mode that means grouped — grouping is orthogonal to the arrangement, so the
  // presence of boxes is the only thing that says a picture is grouped. And each box names the
  // dimension IT partitions (`by`), so a two-level nesting needs no second source: the outer
  // level is any depth-0 box, the inner any depth-1 one.
  //
  // The old reading was `options.groupBy || "combo"`, echoing the request. Its own comment said
  // to read the answer instead, and that `|| "combo"` was the last guess left in it — harmless
  // while grouping was a layout, and with grouping now defaulting to none it would have printed
  // a key for a picture that has no boxes at all.
  const boxes = (payload.layout && payload.layout.groups) || [];
  const grouped = boxes.length > 0;
  const byDepth = (d) => (boxes.find((g) => g.depth === d) || {}).by;
  const levels = [byDepth(0), byDepth(1)].filter(Boolean);

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
    // One line per level: with two, "box" alone no longer says which box.
    const name = (k) => GROUP_LABELS[k] || k;
    body.append(el("span", { class: "legend-item" },
      el("span", { class: "legend-swatch-group", "aria-hidden": "true" }),
      levels.length > 1 ? `outer box = ${name(levels[0])} group` : `box = ${name(levels[0])} group`));
    if (levels.length > 1) {
      body.append(el("span", { class: "legend-item" },
        el("span", { class: "legend-swatch-group is-sub", "aria-hidden": "true" }),
        `inner box = ${name(levels[1])} group`));
    }
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
